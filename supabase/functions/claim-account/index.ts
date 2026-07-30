// Supabase Edge Function: claim-account
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
// WHAT IT WILL NOT DO. It never logs the invite code or the password, it never
// echoes the code back, and it never returns an error that distinguishes "no
// such username" from "wrong code" — usernames here are guessable by
// construction (they are handed out in person), so the code is the secret, and
// an oracle confirming a username exists hands an attacker the only half of the
// pair they could not otherwise check.
//
// Deploy:
//   npx supabase functions deploy claim-account --project-ref <ref> --use-api

import { createClient } from 'npm:@supabase/supabase-js@2'

/** Must stay byte-identical to USERNAME_EMAIL_DOMAIN in src/store/auth.ts. */
const USERNAME_EMAIL_DOMAIN = '@opstrack.internal'

/** Matches INVITE_TTL_DAYS in admin-members. */
const INVITE_TTL_DAYS = 14
const INVITE_TTL_MS = INVITE_TTL_DAYS * 86_400_000

/** Matches MIN_PASSWORD_LENGTH in src/store/auth.ts. */
const MIN_PASSWORD_LENGTH = 8

const RATE_WINDOW_MS = 15 * 60_000
const RATE_MAX_ATTEMPTS = 12
// Bound on distinct IPs held at once, so a spray can never turn the limiter
// itself into the memory leak that kills the function.
const RATE_MAX_KEYS = 5_000

// The durable half of the throttle: wrong guesses against ONE account, counted
// in that account's own metadata. See recordFailure() for why this exists on
// top of the in-memory map.
//
// It is a read-modify-write through an admin API with no compare-and-set, so
// guesses issued in PARALLEL can read the same count and each write the same
// increment: the ceiling below bounds rounds of concurrent guessing, not
// individual guesses. That is deliberate and it is bounded by the credential,
// not by this number — the code is 40 uniform bits (2^40 ≈ 1.1e12), single-use,
// and dead after 14 days, so even a hundredfold widening of this ceiling leaves
// a guessing run astronomically short. If the throttle ever has to bound
// guesses exactly, the counter has to move out of the metadata bag and into a
// row this project can `update … returning` atomically.
const ACCOUNT_MAX_FAILURES = 10
const ACCOUNT_WINDOW_MS = 15 * 60_000

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
 * Every failure a client is allowed to tell apart.
 *
 * `invalid_invite` deliberately covers five different internal outcomes — no
 * such user, not a username account, no code issued, wrong code, expired code —
 * because each of them is a fact about someone else's account.
 * `already_claimed` is the one exception and it is a product decision: a member
 * who forgot they had set a password needs to be told to sign in instead, and
 * the account is already behind that password, so what leaks is claim status
 * and nothing more.
 */
type ClaimCode =
  | 'invalid_request'
  | 'invalid_invite'
  | 'already_claimed'
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

interface InviteMeta {
  display_name?: string
  username?: string
  account_kind?: string
  invite_hash?: string | null
  invite_issued_at?: string | null
  claimed?: boolean
  claimed_at?: string | null
  created_by?: string
  claim_fail_count?: number
  claim_fail_since?: string | null
}

interface RateEntry {
  count: number
  windowStart: number
}

// In-memory, per-isolate, best-effort — and MEASURED, not assumed: on this
// project every invocation of this function got a fresh isolate (five probes,
// five different isolate ids, map size 1 every time), so this map catches only
// the bursts that happen to share one warm instance. It is kept because it is
// free and it does catch a hot loop, and it is documented as what it is: a
// speed bump, never a security boundary. The boundary is the pair below it —
// the per-account failure counter, which survives isolate recycling because it
// lives in the account's own row, and the code itself: 40 uniform bits,
// single-use, dead after 14 days.
const attempts = new Map<string, RateEntry>()

function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for') ?? ''
  // The left-most entry is the original client; everything after it was appended
  // by a proxy we do not control.
  const first = fwd.split(',')[0]?.trim()
  return first || req.headers.get('cf-connecting-ip') || 'unknown'
}

function rateLimited(ip: string): boolean {
  const now = Date.now()
  if (attempts.size > RATE_MAX_KEYS) {
    for (const [key, entry] of attempts) {
      if (now - entry.windowStart > RATE_WINDOW_MS) attempts.delete(key)
    }
    // Still full of live windows: refuse rather than grow without bound.
    if (attempts.size > RATE_MAX_KEYS) return true
  }
  const entry = attempts.get(ip)
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    attempts.set(ip, { count: 1, windowStart: now })
    return false
  }
  entry.count += 1
  return entry.count > RATE_MAX_ATTEMPTS
}

function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** Must produce the same digest as admin-members' inviteHash(). */
async function inviteHash(username: string, code: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${username}:${normalizeCode(code)}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Compare two hex digests without an early exit.
 *
 * A plain `===` on strings returns as soon as it finds a differing character,
 * and how long that takes measures how many leading characters the guess got
 * right — enough, over enough requests, to walk a digest out one nibble at a
 * time. Both inputs here are always 64-character SHA-256 hex, so the length
 * check leaks nothing.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const ip = clientIp(req)
  const tooMany = () =>
    failure('rate_limited', 'Too many attempts. Wait a few minutes and try again.', 429)
  if (rateLimited(ip)) return tooMany()

  let body: ClaimBody
  try {
    body = await req.json()
  } catch {
    return failure('invalid_request', 'Invalid request body', 400)
  }

  const username = (body.username ?? '').trim().toLowerCase()
  const code = normalizeCode(body.inviteCode ?? '')
  const password = body.password ?? ''

  if (!username || !code) {
    return failure('invalid_request', 'Username and invite code are required', 400)
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return failure(
      'weak_password',
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      400,
    )
  }
  // Reject an address as input. Accepting one would let a caller aim the claim
  // at a different domain by typing it in.
  if (username.includes('@')) {
    return failure('invalid_request', 'Enter your username, not an email address', 400)
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const email = `${username}${USERNAME_EMAIL_DOMAIN}`

  // The admin API has no "get user by email"; page through, same cap as
  // admin-members.
  let target = null
  try {
    for (let page = 1; page <= 5; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
      if (error) throw new Error(error.message)
      const hit = data.users.find((u) => (u.email ?? '').toLowerCase() === email)
      if (hit) {
        target = hit
        break
      }
      if (data.users.length < 200) break
    }
  } catch (e) {
    console.error('[claim] lookup failed:', e instanceof Error ? e.message : 'unknown')
    return failure('server_error', 'Could not verify the invite. Try again in a moment.', 500)
  }

  const invalid = () =>
    failure('invalid_invite', 'That invite code is wrong, already used, or expired', 403)

  if (!target) {
    console.warn('[claim] rejected: no such username')
    return invalid()
  }

  // Rebound as a const so the closure below keeps the not-null narrowing the
  // guard above just established.
  const user = target
  const meta = (user.user_metadata ?? {}) as InviteMeta

  if (meta.claimed === true) {
    console.warn(`[claim] rejected: already claimed (${username})`)
    return failure(
      'already_claimed',
      'This account has already been claimed. Sign in with your password.',
      409,
    )
  }

  // ── the durable throttle ────────────────────────────────────────────────────
  //
  // The in-memory map above provably does not hold on this runtime (see its
  // comment), so the counter that actually bounds a guessing run lives in the
  // account's own metadata, where isolate recycling cannot reach it.
  //
  // It is per-ACCOUNT, not per-IP, because that is the shape of the threat: an
  // attacker guessing one member's code rotates IPs freely, and a legitimate
  // member never fails ten times. It is a rolling WINDOW rather than a
  // permanent lock so that burning someone's invite is a fifteen-minute
  // nuisance instead of a denial of service that needs an admin to clear.
  const failSince = meta.claim_fail_since ? new Date(meta.claim_fail_since).getTime() : 0
  const windowLive = Number.isFinite(failSince) && Date.now() - failSince < ACCOUNT_WINDOW_MS
  const failCount = windowLive ? (meta.claim_fail_count ?? 0) : 0
  if (failCount >= ACCOUNT_MAX_FAILURES) {
    // Return BEFORE writing: once throttled, further requests must not each cost
    // an admin-API write, or the throttle becomes the amplifier.
    console.warn(`[claim] rejected: account throttled (${username})`)
    return tooMany()
  }

  /**
   * Count this wrong guess against the account, then answer identically.
   *
   * IT NAMES ONLY THE TWO COUNTER KEYS, and that is the whole security
   * property. It used to spread the `meta` snapshot read at the top of the
   * request back into the write, which was a lost update with teeth:
   * `updateUserById` MERGES `user_metadata` key by key — verified against this
   * project, a write naming one key left the other nine untouched, and an
   * explicit `null` deletes a key rather than blanking it — so re-asserting a
   * stale snapshot re-asserts every key that snapshot held, `invite_hash` and
   * `claimed` among them.
   *
   * The window was not small: between the snapshot and this write sit up to
   * five paged admin-API round trips, a SHA-256, and the write itself. Two
   * outcomes, both reproduced against this project before the fix:
   *
   *   REISSUE UNDONE — the sharp one, because reissue IS the documented remedy
   *   for a leaked code. Attacker spams guesses with leaked code H1; the admin
   *   runs `reissue-code`, which mints H2 and hands it over in person; an
   *   in-flight guess whose snapshot predates the reissue lands and restores
   *   H1. The rotation is silently undone and the leaked code is live again for
   *   the rest of the 14-day TTL. The attacker chooses the timing and can
   *   prompt the reissue socially ("my code doesn't work, send a new one").
   *
   *   BURN UNDONE — the success path below clears `invite_hash` and sets
   *   `claimed` in one call, by design. A concurrent wrong guess whose snapshot
   *   predates it wrote back `claimed: false` and the original hash, leaving an
   *   account that has the member's password AND a still-redeemable single-use
   *   code.
   *
   * Naming only what it intends to change makes both impossible rather than
   * unlikely: this path can no longer write `invite_hash` or `claimed` at all,
   * whatever it races with.
   *
   * The counter is re-read immediately before the increment rather than reused
   * from the top-of-request snapshot, so it advances from the freshest value
   * the admin API will give us. That shrinks the read-modify-write to a single
   * round trip. It does not make it ATOMIC, and it cannot be — the admin API
   * has no compare-and-set. If two guesses interleave inside that trip, one
   * goes uncounted; see ACCOUNT_MAX_FAILURES for why that is a speed bump and
   * not the boundary.
   */
  async function recordFailure(reason: string): Promise<Response> {
    console.warn(`[claim] rejected: ${reason} (${username})`)

    // Fall back to this request's own snapshot if the re-read fails, so a
    // transient error still costs the attacker a count rather than zero.
    let baseCount = failCount
    let baseSince: string | null = windowLive ? (meta.claim_fail_since ?? null) : null

    const { data: fresh, error: readErr } = await admin.auth.admin.getUserById(user.id)
    if (readErr) {
      console.error('[claim] could not re-read before counting:', readErr.message)
    } else if (fresh?.user) {
      const freshMeta = (fresh.user.user_metadata ?? {}) as InviteMeta
      const since = freshMeta.claim_fail_since ? new Date(freshMeta.claim_fail_since).getTime() : 0
      const live = Number.isFinite(since) && since > 0 && Date.now() - since < ACCOUNT_WINDOW_MS
      baseCount = live ? (freshMeta.claim_fail_count ?? 0) : 0
      baseSince = live ? (freshMeta.claim_fail_since ?? null) : null
    }

    const { error } = await admin.auth.admin.updateUserById(user.id, {
      user_metadata: {
        claim_fail_count: baseCount + 1,
        claim_fail_since: baseSince ?? new Date().toISOString(),
      },
    })
    if (error) console.error('[claim] could not record failure:', error.message)
    return invalid()
  }

  const storedHash = meta.invite_hash ?? ''
  const issuedAt = meta.invite_issued_at ?? ''
  if (!storedHash || !issuedAt) return recordFailure('no invite outstanding')

  const issuedMs = new Date(issuedAt).getTime()
  if (!Number.isFinite(issuedMs) || Date.now() - issuedMs > INVITE_TTL_MS) {
    return recordFailure('expired invite')
  }

  if (!timingSafeEqual(await inviteHash(username, code), storedHash)) {
    return recordFailure('wrong code')
  }

  // ONE call sets the password AND burns the code. Two calls would leave a
  // window where the password is already changed but the invite still verifies,
  // and "the request crashed halfway" is exactly the case a single-use
  // credential has to survive: a reusable invite is a standing key to someone
  // else's account. `invite_hash: null` deletes the key from the metadata bag
  // rather than blanking it, so there is nothing left to compare against.
  //
  // Like recordFailure(), this names only the keys it means to change. The
  // merge keeps `display_name`, `created_by` and `email_verified`; spreading
  // the request's opening snapshot over them added nothing and would revert a
  // rename an admin made while the member was typing their password.
  const { error: updateErr } = await admin.auth.admin.updateUserById(user.id, {
    password,
    email_confirm: true,
    user_metadata: {
      username,
      account_kind: 'username',
      invite_hash: null,
      invite_issued_at: null,
      claimed: true,
      claimed_at: new Date().toISOString(),
      claim_fail_count: 0,
      claim_fail_since: null,
    },
  })
  if (updateErr) {
    // Supabase's own password-policy rejection lands here (a project can require
    // more than this function does), and it is the one message worth passing
    // through, because the member can act on it.
    console.error(`[claim] update failed (${username}):`, updateErr.message)
    const weak = /password/i.test(updateErr.message)
    return weak
      ? failure('weak_password', updateErr.message, 400)
      : failure('server_error', 'Could not complete the claim. Try again in a moment.', 500)
  }

  // A profiles row already exists (handle_new_user fires on insert, and
  // admin-members upserts the role on top), so nothing is written here — a claim
  // changes credentials, never authorization.
  console.log(`[claim] ok (${username})`)
  return json({ ok: true, username })
})
