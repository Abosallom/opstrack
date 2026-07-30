// Supabase Edge Function: claim-account (v3 — S1)
//
// First registration for a predefined username account: exchange
// {username, inviteCode, password} for a set password and a claimed account.
//
// UNAUTHENTICATED BY NECESSITY. The caller has no session yet — that is the
// whole point of claiming — so the invite code is the only credential and every
// privileged step happens here, behind the service role, never in the browser.
// The gateway's "Verify JWT" setting stays ON: supabase-js sends the project's
// anon key as the bearer token when there is no session, which satisfies the
// gateway while keeping the endpoint unreachable without an apikey.
//
// Deploy:
//   npx supabase@latest functions deploy claim-account --project-ref <ref> --use-api
//
// REQUIRES: migration 0010 (claim_counters + claim_bump/peek/reset/lookup) and
// the INVITE_PEPPER function secret. Both are hard requirements — this function
// answers 500 rather than degrading quietly if either is missing, because both
// degradations are silent security downgrades.
//
//
// ═══ WHAT V3 CHANGED, AND WHY ═══ FIX-BACKLOG S1a–S1e
//
// S1a — ONE FAILURE, ONE ANSWER. v2's header promised that no error would
// distinguish "no such username" from "wrong code", and the control flow did
// the opposite in three places: a missing user returned 403 with no counter
// touched, `already_claimed` returned **409** before the throttle even ran, and
// a pending account returned 403 up to ten times and then 429. Three states,
// three observable behaviours, and the middle one was defended in the source as
// "a product decision: a member who forgot they had set a password needs to be
// told to sign in instead". That is overruled. Every outcome that depends on
// the TARGET ACCOUNT now takes `reject()` below: the same 403, the same body,
// the same counter bump, the same work. The member who forgot is told, by
// `claim.errInviteInvalid`, to check both fields or ask their admin — which is
// also what they should do, because the admin's reissue is the password reset.
//
// Making the RESPONSES identical is only half of it. v2 found the account by
// paging `listUsers({perPage: 200})` up to five times, so a hit on page 1
// returned after one round trip and a miss after five: the RESPONSE was
// constant and the LATENCY was the oracle. 0010's `claim_lookup()` is one
// indexed read on `auth.users.email`, which answers in the same time either way
// (and lifts v2's silent 1000-account cap).
//
// S1b — DELAY, NEVER REFUSAL. v2 refused a known username for fifteen minutes
// after ten wrong guesses, and `admin-members` cleared the counter on reissue,
// so the admin's remedy was re-burnable in ten more requests: a renewable
// denial of service against a member who did nothing. The counter now buys
// EXPONENTIAL BACKOFF and nothing else — capped, applied before the work, and
// the request is then processed. A member holding a real code always gets in.
//
// There are two dimensions, and the second is new: the account (keyed on the
// SUBMITTED STRING, so a nonexistent username throttles identically — see
// 0010) and the caller's address PREFIX, /24 or /48, so that rotating inside a
// subnet is not free. The larger of the two decides the delay.
//
// The one hard refusal left is deliberately not account-shaped: a per-IP volume
// ceiling far above anything a human reaches, answering 429. It keys on the
// caller's own address, so it can only shut out the machine doing the spraying
// and it says nothing about any account.
//
// S1c/S1d — THE COUNTER IS A ROW. v2 counted in `user_metadata` through an
// admin API with no compare-and-set, and said so: "It does not make it ATOMIC,
// and it cannot be." Two parallel guesses read the same n and both wrote n+1.
// 0010's `claim_bump()` is `insert … on conflict do update set n = c.n + 1 …
// returning c.n` — one statement, one row lock, re-evaluated against the
// committed row. It also ends S1d outright: no path in this file writes
// `user_metadata` any more except the single success write, so there is no
// stale snapshot left to restore a revoked `invite_hash` with.
//
// S1e — THE DIGEST IS AN HMAC. v2 stored a bare SHA-256 of `username:CODE`.
// The code is 40 uniform bits, so a dumped metadata bag was about a minute of
// GPU per account. The digest is now HMAC-SHA-256 under `INVITE_PEPPER`, a
// function secret this database never holds, which makes a metadata dump worth
// nothing on its own. See `verifyCode()` for the rotation and legacy paths and
// RUNBOOK §4.1 for how to rotate.
//
//
// WHAT IT STILL WILL NOT DO. It never logs the invite code or the password, it
// never echoes the code back, and it never returns an error that distinguishes
// one account's state from another's.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

/** Must stay byte-identical to USERNAME_EMAIL_DOMAIN in src/store/auth.ts. */
const USERNAME_EMAIL_DOMAIN = '@opstrack.internal'

/** Matches INVITE_TTL_DAYS in admin-members. */
const INVITE_TTL_DAYS = 14
const INVITE_TTL_MS = INVITE_TTL_DAYS * 86_400_000

/** Matches MIN_PASSWORD_LENGTH in src/store/auth.ts. */
const MIN_PASSWORD_LENGTH = 8

/**
 * Longest username this endpoint will even look up.
 *
 * Not a validation rule — `admin-members`' USERNAME_RE caps real usernames at
 * 32, and this deliberately does NOT re-apply that regex, because an account
 * minted before the rule tightened must still be claimable. It is a bound on
 * what can become a counter bucket, so a spray of megabyte strings cannot turn
 * the throttle table into the denial of service.
 */
const USERNAME_MAX = 64

/** The rolling window both counters share. Matches 0010's callers. */
const WINDOW_SECONDS = 15 * 60

/**
 * The backoff curve: free, free, then doubling from a quarter second to four.
 *
 * FREE_ATTEMPTS is 2 because a person mistyping a hand-written code twice is
 * ordinary and should not be punished for it. From the third failure the delay
 * doubles — 0.25s, 0.5s, 1s, 2s, 4s — and stops at BACKOFF_MAX_MS.
 *
 * The cap is what keeps this from becoming a self-inflicted outage: a sleeping
 * request holds a worker, so an uncapped curve would let an attacker park the
 * function's whole concurrency budget by failing a lot. Four seconds is enough
 * to make guessing pointless against a 40-bit single-use code that dies in
 * fourteen days (2^40 at 4 s apiece, fully parallel at a thousand connections,
 * is still on the order of a century) and short enough that a legitimate member
 * on their fifth attempt does not think the app has hung.
 */
const FREE_ATTEMPTS = 2
const BACKOFF_BASE_MS = 250
const BACKOFF_MAX_MS = 4_000

/**
 * Failures from one address prefix, in one window, before the volume shield
 * closes.
 *
 * Two hundred is unreachable by hand and unreachable by an office behind one
 * NAT: it counts FAILURES only, and a member who cannot type their code two
 * hundred times in fifteen minutes has a different problem. Unlike v2's
 * per-account lock this cannot be aimed at a victim — the bucket is the
 * attacker's own subnet — and it decays with the window rather than needing an
 * admin to clear it.
 */
const IP_VOLUME_CEILING = 200

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

/**
 * Every failure a client is allowed to tell apart, and the axis each one is
 * about. The axis is the security property: nothing here varies with the state
 * of the account being claimed.
 *
 *   invalid_request  the caller's own body, checked before any lookup
 *   weak_password    the caller's own password, same
 *   rate_limited     the caller's own address, and only ever the volume ceiling
 *   server_error     this function, or its dependencies, being broken
 *   invalid_invite   EVERYTHING ELSE — see reject()
 */
type ClaimCode =
  | 'invalid_request'
  | 'invalid_invite'
  | 'weak_password'
  | 'rate_limited'
  | 'server_error'

function failure(code: ClaimCode, message: string, status: number): Response {
  return json({ error: message, code }, status)
}

interface ClaimBody {
  username?: string
  inviteCode?: string
  password?: string
}

/** What 0010's claim_lookup() hands back. Four columns, no metadata bag. */
interface LookupRow {
  user_id: string
  invite_hash: string | null
  invite_issued_at: string | null
  invite_alg: string | null
  claimed: boolean
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// ── addresses ───────────────────────────────────────────────────────────────

function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for') ?? ''
  // The left-most entry is the original client; everything after it was appended
  // by a proxy we do not control.
  const first = fwd.split(',')[0]?.trim()
  return first || req.headers.get('cf-connecting-ip') || 'unknown'
}

/**
 * The address, widened to the block an attacker gets for free.
 *
 * /24 for IPv4 and /48 for IPv6, because a single host is not the unit of
 * abuse: anyone with a residential IPv6 allocation holds 2^16 /64s and can
 * present a new one per request, and cloud IPv4 comes in contiguous blocks.
 * Widening costs a false-sharing risk — one office behind one NAT shares a
 * bucket — which is exactly why the account dimension can only ever delay and
 * the IP ceiling sits at two hundred failures.
 */
function ipPrefix(ip: string): string {
  if (ip.includes(':')) {
    const groups = ip.split(':')
    return `${groups.slice(0, 3).join(':')}::/48`
  }
  const octets = ip.split('.')
  if (octets.length === 4) return `${octets.slice(0, 3).join('.')}.0/24`
  return ip
}

// ── digests ─────────────────────────────────────────────────────────────────

function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * HMAC-SHA-256 as hex. Must produce the same digest as admin-members' hmacHex().
 *
 * A fresh key import per call. `crypto.subtle.importKey` on 32-odd bytes is
 * microseconds, this function runs at most three times per request, and caching
 * a CryptoKey in an isolate that (measured, five probes, five ids) never
 * survives a request would be caching nothing.
 */
async function hmacHex(pepper: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return toHex(sig)
}

/** v2's bare digest. Kept only to finish out invites minted before the pepper. */
async function legacyHash(username: string, code: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${username}:${normalizeCode(code)}`)
  return toHex(await crypto.subtle.digest('SHA-256', bytes))
}

/**
 * Compare two hex digests without an early exit.
 *
 * A plain `===` on strings returns as soon as it finds a differing character,
 * and how long that takes measures how many leading characters the guess got
 * right — enough, over enough requests, to walk a digest out one nibble at a
 * time. Both inputs here are always 64-character hex, so the length check leaks
 * nothing.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** The tag admin-members writes on every invite it mints under the pepper. */
const INVITE_ALG = 'hmac-sha256-v1'

/**
 * Does this code match the stored digest?
 *
 * THREE CANDIDATES, ALL EVALUATED, THEN OR-ED — never short-circuited. `a || b`
 * stops at the first true, so which candidate matched would be measurable, and
 * "you are on the previous pepper" is not something a caller should be able to
 * time.
 *
 *   current pepper   the normal path
 *   previous pepper  INVITE_PEPPER_PREVIOUS, set only during a rotation, so an
 *                    admin rotating the secret does not invalidate every code
 *                    already in somebody's hand. RUNBOOK §4.1 says to unset it
 *                    once the outstanding invites have aged out.
 *   legacy SHA-256   ONLY for a stored digest with no `invite_alg` tag, i.e.
 *                    minted by v2 before the pepper existed. Those all expire
 *                    within INVITE_TTL_DAYS of the S1 deploy and this branch
 *                    goes with them; it is gated on the tag rather than tried
 *                    universally so a peppered invite can never be verified by
 *                    the weaker digest.
 */
async function verifyCode(
  username: string,
  code: string,
  stored: string,
  alg: string | null,
  pepper: string,
  previousPepper: string,
): Promise<boolean> {
  const message = `${username}:${normalizeCode(code)}`
  const current = timingSafeEqual(await hmacHex(pepper, message), stored)
  const previous = previousPepper
    ? timingSafeEqual(await hmacHex(previousPepper, message), stored)
    : false
  const legacy = alg === null ? timingSafeEqual(await legacyHash(username, code), stored) : false
  return current || previous || legacy
}

// ── counters ────────────────────────────────────────────────────────────────

/**
 * Read a counter without changing it. Fails OPEN: a database that cannot answer
 * must not become a way to lock everyone out of claiming.
 */
async function peek(admin: SupabaseClient, scope: string, bucket: string): Promise<number> {
  const { data, error } = await admin.rpc('claim_peek', {
    p_scope: scope,
    p_bucket: bucket,
    p_window_seconds: WINDOW_SECONDS,
  })
  if (error) {
    console.error(`[claim] peek(${scope}) failed:`, error.message)
    return 0
  }
  return typeof data === 'number' ? data : 0
}

/** Count one failure. The atomicity is 0010's, not this function's. */
async function bump(admin: SupabaseClient, scope: string, bucket: string): Promise<void> {
  const { error } = await admin.rpc('claim_bump', {
    p_scope: scope,
    p_bucket: bucket,
    p_window_seconds: WINDOW_SECONDS,
  })
  if (error) console.error(`[claim] bump(${scope}) failed:`, error.message)
}

/** 0, 0, 250, 500, 1000, 2000, 4000, 4000, … milliseconds. */
function backoffMs(count: number): number {
  if (count <= FREE_ATTEMPTS) return 0
  return Math.min(BACKOFF_BASE_MS * 2 ** (count - FREE_ATTEMPTS - 1), BACKOFF_MAX_MS)
}

// ── the handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let body: ClaimBody
  try {
    body = await req.json()
  } catch {
    return failure('invalid_request', 'Invalid request body', 400)
  }

  // ── the caller's own input, judged before any account is touched ──────────
  //
  // Everything in this block is a fact about what the caller typed, so none of
  // it can be an oracle about anyone's account, and answering precisely here is
  // the difference between a usable form and a form that says "wrong" at
  // someone who left a field blank.

  const username = (body.username ?? '').trim().toLowerCase()
  const code = normalizeCode(body.inviteCode ?? '')
  const password = body.password ?? ''

  if (!username || !code) {
    return failure('invalid_request', 'Username and invite code are required', 400)
  }
  // Reject an address as input. Accepting one would let a caller aim the claim
  // at a different domain by typing it in.
  if (username.includes('@')) {
    return failure('invalid_request', 'Enter your username, not an email address', 400)
  }
  if (username.length > USERNAME_MAX) {
    return failure('invalid_request', 'That is not a username', 400)
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return failure(
      'weak_password',
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      400,
    )
  }

  const pepper = Deno.env.get('INVITE_PEPPER') ?? ''
  if (!pepper) {
    // Fail CLOSED, and loudly. Silently falling back to the unpeppered digest
    // would turn a missing secret into an undetectable downgrade of S1e — the
    // function would keep working and nobody would find out. This answer does
    // not vary by account, so it is not an oracle.
    console.error('[claim] INVITE_PEPPER is not set — refusing to verify anything')
    return failure('server_error', 'Could not verify the invite. Try again in a moment.', 500)
  }
  const previousPepper = Deno.env.get('INVITE_PEPPER_PREVIOUS') ?? ''

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const ipBucket = await hmacHex(pepper, `ip:${ipPrefix(clientIp(req))}`).then((h) => h.slice(0, 40))

  // ── the throttle, applied BEFORE the work and identically to every path ───
  //
  // Reading both counters before deciding anything is what makes the delay a
  // property of the request rather than of its outcome: a correct code and a
  // wrong one against the same username wait exactly as long. Bumping here
  // instead would make a successful claim count as a failure and would let a
  // throttled attacker buy a write per request.

  const [userCount, ipCount] = await Promise.all([
    peek(admin, 'username', username),
    peek(admin, 'ip', ipBucket),
  ])

  if (ipCount >= IP_VOLUME_CEILING) {
    // The one distinguishable refusal, and it is about the CALLER. Retry-After
    // is honest rather than useful — an attacker ignores it, a real client
    // behind a shared address gets a number to show a human.
    console.warn('[claim] refused: address volume ceiling')
    return new Response(
      JSON.stringify({
        error: 'Too many attempts from this network. Wait a few minutes and try again.',
        code: 'rate_limited' satisfies ClaimCode,
      }),
      {
        status: 429,
        headers: { ...CORS, 'Content-Type': 'application/json', 'Retry-After': `${WINDOW_SECONDS}` },
      },
    )
  }

  const delay = backoffMs(Math.max(userCount, ipCount))
  if (delay > 0) await sleep(delay)

  /**
   * THE ONLY ANSWER ANY ACCOUNT-DEPENDENT FAILURE GETS.
   *
   * Six internal outcomes end here — no such username, a real-email account, no
   * invite outstanding, an expired invite, a wrong code, and an account already
   * claimed — and they are indistinguishable to the caller by status, by body,
   * by side effect and (see claim_lookup) by latency. Five of those are facts
   * about someone else's account. The sixth used to be a 409 defended as a
   * product decision; it is the enumeration oracle S1a named, and the member it
   * was written for is served just as well by "check both, or ask your admin",
   * because asking the admin is the password reset.
   *
   * The bump is part of the answer, not an aside: a path that skipped it would
   * be visible in the NEXT request's backoff even though this one looked the
   * same.
   */
  async function reject(reason: string): Promise<Response> {
    // The reason, never the code, and never the password. Which failure
    // happened is what a bug report needs; the credential is not.
    console.warn(`[claim] rejected: ${reason}`)
    await Promise.all([bump(admin, 'username', username), bump(admin, 'ip', ipBucket)])
    return failure(
      'invalid_invite',
      'That invite code is wrong, already used, or expired',
      403,
    )
  }

  const email = `${username}${USERNAME_EMAIL_DOMAIN}`

  const { data: found, error: lookupErr } = await admin.rpc('claim_lookup', { p_email: email })
  if (lookupErr) {
    console.error('[claim] lookup failed:', lookupErr.message)
    return failure('server_error', 'Could not verify the invite. Try again in a moment.', 500)
  }
  const rows = (found ?? []) as LookupRow[]
  const target = rows[0] ?? null

  if (!target) return reject('no such username')
  if (target.claimed) return reject('already claimed')

  const storedHash = target.invite_hash ?? ''
  const issuedAt = target.invite_issued_at ?? ''
  if (!storedHash || !issuedAt) return reject('no invite outstanding')

  const issuedMs = new Date(issuedAt).getTime()
  if (!Number.isFinite(issuedMs) || Date.now() - issuedMs > INVITE_TTL_MS) {
    return reject('expired invite')
  }

  if (!(await verifyCode(username, code, storedHash, target.invite_alg, pepper, previousPepper))) {
    return reject('wrong code')
  }

  // ONE call sets the password AND burns the code. Two calls would leave a
  // window where the password is already changed but the invite still verifies,
  // and "the request crashed halfway" is exactly the case a single-use
  // credential has to survive: a reusable invite is a standing key to someone
  // else's account. `invite_hash: null` deletes the key from the metadata bag
  // rather than blanking it, so there is nothing left to compare against.
  //
  // It names ONLY the keys it means to change, and that is now the only
  // metadata write in the file. `updateUserById` MERGES `user_metadata` key by
  // key — verified against this project: a write naming one key leaves the
  // others untouched, and an explicit `null` deletes rather than blanks. In v2
  // the failure path re-asserted a stale snapshot over this one, which could
  // resurrect a hash `reissue-code` had just revoked (S1d). There is no such
  // path left: reject() writes to claim_counters and nothing else.
  const { error: updateErr } = await admin.auth.admin.updateUserById(target.user_id, {
    password,
    email_confirm: true,
    user_metadata: {
      username,
      account_kind: 'username',
      invite_hash: null,
      invite_issued_at: null,
      invite_alg: null,
      claimed: true,
      claimed_at: new Date().toISOString(),
      // v2's per-account counter, deleted rather than zeroed. It lives in
      // claim_counters now, and leaving a stale pair of keys in the bag would
      // invite the next reader to believe them.
      claim_fail_count: null,
      claim_fail_since: null,
    },
  })
  if (updateErr) {
    // Supabase's own password-policy rejection lands here (a project can require
    // more than this function does), and it is the one message worth passing
    // through, because the member can act on it — and it is about the password
    // the caller just chose, not about the account, so it is no oracle.
    console.error('[claim] update failed:', updateErr.message)
    const weak = /password/i.test(updateErr.message)
    return weak
      ? failure('weak_password', updateErr.message, 400)
      : failure('server_error', 'Could not complete the claim. Try again in a moment.', 500)
  }

  // The window this member burned belongs to nobody now. Clearing it is
  // hygiene, not security: the account is claimed, so every further attempt at
  // this username is a reject() anyway. The IP bucket is deliberately left
  // alone — a successful claim from a subnet is not a reason to forgive two
  // hundred failures from it.
  const { error: resetErr } = await admin.rpc('claim_reset', {
    p_scope: 'username',
    p_bucket: username,
  })
  if (resetErr) console.error('[claim] counter reset failed:', resetErr.message)

  // A profiles row already exists (handle_new_user fires on insert, and
  // admin-members upserts the role on top), so nothing is written here — a claim
  // changes credentials, never authorization.
  console.log(`[claim] ok (${username})`)
  return json({ ok: true, username })
})
