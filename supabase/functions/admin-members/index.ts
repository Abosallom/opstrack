// Supabase Edge Function: admin-members (v3 — the Members page's server)
//
// The single server-side gate for ALL member management: list, create, delete,
// set-role, reissue-code. Signups are disabled on the project, so this is the
// only way an account comes into existence. The web app's admin checks
// (profiles.role) are cosmetic UI gating — anyone can call this endpoint with
// any anon-key session, so it re-verifies the caller before touching the
// service-role client.
//
// Deploy:
//   npx supabase@latest functions deploy admin-members --project-ref <ref> --use-api
//
// REQUIRES the INVITE_PEPPER function secret (see below) and migration 0010.
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are injected
// automatically.
//
//
// ═══ WHAT V3 CHANGED ═══
//
// 1. THE ADMIN GATE IS RESOLVED (plan gate 4(g), FIX-BACKLOG D2). v1 and v2
//    gated on a hardcoded `ADMIN_EMAILS` while the rest of the system had moved
//    to `profiles.role`, and the file's own header called it a known gap owned
//    by "the wave that owns the Members page" — this one. The gate is now
//    EITHER: the bootstrap address, OR `profiles.role = 'admin'` read with the
//    service role.
//
//    That is safe because a member cannot give themselves the row.
//    `guard_profile_role()` (0001) reverts any role change made by a caller who
//    is not already an admin, and `handle_new_user()` hardcodes 'member' rather
//    than reading the client-writable signup metadata bag. The only writers who
//    can set a role are the ones that bypass RLS by design: this function and
//    the SQL Editor. And the two guards below — no self-demotion, no removing
//    the last admin — mean the set cannot be emptied from inside the app.
//
//    ADMIN_EMAILS survives as a FLOOR, not as the gate: a bootstrap address is
//    an admin even if its profiles row is missing or wrong, so a workspace can
//    always be recovered without SQL. README.md:80-81, README.md:121 and
//    ADMIN.md:14-18 still describe the old arrangement; see the W4-ADMIN
//    handoff note.
//
// 2. THE INVITE DIGEST IS AN HMAC (FIX-BACKLOG S1e). v2 stored a bare SHA-256
//    of `username:CODE`, and the code is 40 uniform bits — a dumped metadata
//    bag was about a minute of GPU per account. It is now HMAC-SHA-256 under
//    `INVITE_PEPPER`, a function secret the database never holds, so the dump
//    is worth nothing on its own. Every invite this version mints is tagged
//    `invite_alg: 'hmac-sha256-v1'`; `claim-account` uses the tag to decide
//    whether a legacy unpeppered digest may be tried at all. Rotation:
//    RUNBOOK §4.1.
//
// 3. THE FAILURE COUNTER MOVED OUT (S1c). `claim_fail_count` /
//    `claim_fail_since` are gone from `user_metadata`; the throttle is
//    `public.claim_counters` (migration 0010). Issuing a code clears the
//    USERNAME bucket through `claim_reset()` so that "here is a new code, try
//    again" is true of the very next attempt — and clears nothing else, because
//    clearing the IP bucket would hand a sprayer a free reset.
//
// 4. `set-role` EXISTS, with both guards. The Members page needs to promote and
//    demote, and a demote control with no server-side floor under it is a way
//    to lock every admin out of a workspace whose only provisioning path is
//    this endpoint.
//
// 5. EVERY ERROR CARRIES A MACHINE `code`. v2 answered in English prose, which
//    the browser could only log — an untranslated sentence in an RTL layout is
//    the exact failure the i18n key convention exists to prevent. The prose
//    stays (it is what a curl probe and a server log want); `src/api/members.ts`
//    reads the `code` and picks a `members.err*` key.
//
//
// THE CODE IS NEVER STORED IN THE CLEAR. user_metadata carries an HMAC of
// `username:CODE`, so this endpoint can verify a claim but cannot show the code
// again — there is deliberately no "show it once more" path, only reissue.

import { createClient } from 'npm:@supabase/supabase-js@2'

/**
 * Bootstrap allow-list — the FLOOR under the admin gate, never the whole gate.
 *
 * An address here is an admin whatever `profiles` says, so a workspace whose
 * profiles row was lost or mis-set can still be repaired from inside the app.
 * Everyone else is an admin by virtue of `profiles.role`, which only an
 * existing admin (or the SQL Editor) can set — see the header.
 */
const ADMIN_EMAILS = ['az.alsaloom@gmail.com']

/**
 * The synthetic domain a predefined username authenticates against. Must stay
 * byte-identical to USERNAME_EMAIL_DOMAIN in src/store/auth.ts and to the copy
 * in claim-account — three files, one string, and nothing but this comment
 * holds them together (edge functions cannot import from src/).
 */
const USERNAME_EMAIL_DOMAIN = '@opstrack.internal'

/** How long a freshly issued invite code stays redeemable. */
const INVITE_TTL_DAYS = 14

const INVITE_CODE_LENGTH = 8

/** Must stay byte-identical to INVITE_ALG in claim-account. */
const INVITE_ALG = 'hmac-sha256-v1'

// 32 characters, no I/O/0/1 — these are read off a screen and typed in by hand,
// and those four are the pairs people transcribe wrong. Exactly 32 also means
// 256 % 32 === 0, so a random byte maps onto the alphabet with no modulo bias:
// every code is a uniform 40 bits.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

// Usernames are handed out in person and typed at a sign-in form: lowercase,
// 3–32 characters, starting and ending alphanumeric. Dots, dashes and
// underscores in the middle cover `ahmed.otaibi` and `it-ops` without allowing
// a leading dash (which reads as a flag in a CLI) or a trailing dot (which is
// invisible when copied).
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$/

const DISPLAY_NAME_MAX = 80

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
 * Every failure this endpoint can return, as a stable machine token.
 *
 * The browser never renders the English sentence beside it — see header note 5.
 * Adding a member here means adding a `members.err*` key in BOTH locale files;
 * `src/api/members.ts`'s ADMIN_ERROR_KEYS is the map and falls back to
 * `common.error` for a token it does not know, so an old client meeting a new
 * token degrades to a generic message rather than to a blank one.
 */
type AdminCode =
  | 'not_signed_in'
  | 'forbidden'
  | 'invalid_body'
  | 'invalid_username'
  | 'username_taken'
  | 'invalid_email'
  | 'email_taken'
  | 'display_name_required'
  | 'not_found'
  | 'email_account'
  | 'self_delete'
  | 'self_demote'
  | 'last_admin'
  | 'bootstrap_admin'
  | 'no_pepper'
  | 'server_error'
  | 'unknown_action'

function failure(code: AdminCode, message: string, status: number): Response {
  return json({ error: message, code }, status)
}

type MemberRole = 'admin' | 'member'

interface RequestBody {
  action?: 'list' | 'create' | 'delete' | 'reissue-code' | 'set-role'
  email?: string
  username?: string
  displayName?: string
  role?: MemberRole
  userId?: string
}

// Shape of the profiles row this function reads/writes. Deliberately narrow —
// the function never needs locale or created_at.
interface ProfileRow {
  id: string
  display_name: string | null
  role: MemberRole
}

/** The username-account bookkeeping this function keeps in user_metadata. */
interface InviteMeta {
  display_name?: string
  username?: string
  account_kind?: string
  invite_hash?: string | null
  invite_issued_at?: string | null
  invite_alg?: string | null
  claimed?: boolean
  claimed_at?: string | null
  created_by?: string
}

function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * HMAC-SHA-256 as hex. Must produce the same digest as claim-account's hmacHex().
 *
 * WHAT IS HASHED, AND WHY BOTH HALVES MATTER. Binding the USERNAME into the
 * message means two accounts that happen to draw the same code do not share a
 * digest, so a leaked table can never be reversed once and reused everywhere.
 * Binding the PEPPER — a secret that lives in the function's environment and
 * never in the database — means a metadata dump is not enough to attack the
 * digests at all: SHA-256 over 40 uniform bits is about a minute of GPU per
 * account, and that was S1e. Neither half is a password KDF and neither is
 * pretending to be one; this input is single-use, valid for 14 days, and
 * rate-limited at the claim endpoint.
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

function inviteHash(pepper: string, username: string, code: string): Promise<string> {
  return hmacHex(pepper, `${username}:${normalizeCode(code)}`)
}

/** A fresh code, grouped `XXXX-XXXX` because that is how it gets read aloud. */
function generateInviteCode(): string {
  const bytes = new Uint8Array(INVITE_CODE_LENGTH)
  crypto.getRandomValues(bytes)
  const chars = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length])
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`
}

function usernameToEmail(username: string): string {
  return `${username}${USERNAME_EMAIL_DOMAIN}`
}

/** username for a synthetic address, null for a real one. */
function emailToUsername(email: string | null | undefined): string | null {
  const e = (email ?? '').toLowerCase()
  return e.endsWith(USERNAME_EMAIL_DOMAIN) ? e.slice(0, -USERNAME_EMAIL_DOMAIN.length) : null
}

function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * 86_400_000).toISOString()
}

/** A password no one will ever use, so the account is never passwordless. */
function randomPassword(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  // 1. Identify the caller from their JWT.
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return failure('not_signed_in', 'Not signed in', 401)
  const anonClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
  )
  const { data: caller, error: callerErr } = await anonClient.auth.getUser(token)
  const callerEmail = caller?.user?.email?.toLowerCase()
  const callerId = caller?.user?.id
  if (callerErr || !callerEmail || !callerId) {
    return failure('not_signed_in', 'Not signed in', 401)
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // 2. Admin only, and this is the real gate — the browser's `profile.role`
  //    check decides what RENDERS and nothing else. Read with the service role
  //    so RLS cannot be the thing that answers; see the header for why a
  //    profiles.role admin is now trusted here and why the allow-list stays.
  const bootstrap = ADMIN_EMAILS.includes(callerEmail)
  let callerIsAdmin = bootstrap
  if (!callerIsAdmin) {
    const { data: callerProfile, error: roleErr } = await admin
      .from('profiles')
      .select('role')
      .eq('id', callerId)
      .maybeSingle<{ role: MemberRole }>()
    if (roleErr) {
      console.error('[admin-members] role lookup failed:', roleErr.message)
      return failure('server_error', 'Could not verify your role. Try again in a moment.', 500)
    }
    callerIsAdmin = callerProfile?.role === 'admin'
  }
  if (!callerIsAdmin) {
    return failure('forbidden', 'Only an admin can manage members', 403)
  }

  let body: RequestBody
  try {
    body = await req.json()
  } catch {
    return failure('invalid_body', 'Invalid request body', 400)
  }

  /**
   * The pepper, or the reason there is no pepper.
   *
   * Read lazily — `list` and `delete` do not need it, and a workspace whose
   * secret was lost should still be able to see and remove accounts while it is
   * being fixed. Minting an invite without it would be the silent S1e downgrade
   * the whole change exists to prevent, so the paths that mint refuse.
   */
  function requirePepper(): string | Response {
    const pepper = Deno.env.get('INVITE_PEPPER') ?? ''
    if (pepper) return pepper
    console.error('[admin-members] INVITE_PEPPER is not set — refusing to mint an invite')
    return failure(
      'no_pepper',
      'INVITE_PEPPER is not configured on this project. See RUNBOOK 4.1.',
      500,
    )
  }

  // The admin API has no "get user by email", so we page through. 1000 users is
  // far past what this workspace will ever hold; the cap stops a pathological
  // project from turning one request into an unbounded loop. (claim-account no
  // longer does this — it looks up through 0010's claim_lookup(), because there
  // the paging was a timing oracle. Here the caller is already an authenticated
  // admin, so there is nothing to leak and no reason to widen 0010's surface.)
  async function findUserByEmail(email: string) {
    for (let page = 1; page <= 5; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
      if (error) throw new Error(error.message)
      const hit = data.users.find((u) => (u.email ?? '').toLowerCase() === email)
      if (hit) return hit
      if (data.users.length < 200) break
    }
    return null
  }

  /** How many admins are standing right now, counting the bootstrap address. */
  async function countAdmins(): Promise<number | Response> {
    const { count, error } = await admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'admin')
    if (error) {
      console.error('[admin-members] admin count failed:', error.message)
      return failure('server_error', error.message, 500)
    }
    return count ?? 0
  }

  /**
   * Mint (or re-mint) an invite code onto an existing auth user.
   *
   * Reissue deliberately clears `claimed`: a reissued code IS the password
   * reset, so the claim endpoint has to accept it again. Leaving the flag set
   * would make every reset fail with "already claimed" — an honest-looking
   * error for a flow that can never succeed.
   *
   * It clears the USERNAME failure bucket for the same reason, and this one was
   * found the hard way in v2: burn wrong guesses at a pending account and the
   * throttle held against a freshly issued code too. The admin's whole remedy is
   * "here is a new code, try again", and it has to actually work the moment they
   * say it. The IP bucket is untouched — see header note 3.
   */
  async function issueCode(userId: string, username: string, meta: InviteMeta, pepper: string) {
    const code = generateInviteCode()
    const issuedAt = new Date().toISOString()
    const { error } = await admin.auth.admin.updateUserById(userId, {
      user_metadata: {
        ...meta,
        username,
        account_kind: 'username',
        invite_hash: await inviteHash(pepper, username, code),
        invite_issued_at: issuedAt,
        invite_alg: INVITE_ALG,
        claimed: false,
        claimed_at: null,
        // v2's counters, deleted rather than carried. They live in
        // claim_counters now (0010) and a stale pair here would invite the next
        // reader to believe them.
        claim_fail_count: null,
        claim_fail_since: null,
      },
    })
    if (error) return { error: error.message }

    const { error: resetErr } = await admin.rpc('claim_reset', {
      p_scope: 'username',
      p_bucket: username,
    })
    // Not fatal: the code is minted and valid either way, and the worst case is
    // that the member waits out a backoff of at most a few seconds.
    if (resetErr) console.error('[admin-members] counter reset failed:', resetErr.message)

    // Returned to the caller ONCE, and never logged: the digest above is all
    // that survives this request.
    return { code, issuedAt, expiresAt: addDays(issuedAt, INVITE_TTL_DAYS) }
  }

  switch (body.action) {
    case 'list': {
      const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
      if (error) return failure('server_error', error.message, 400)

      // auth.users and profiles live in different schemas, so there is no SQL
      // join to make here — fetch the profiles side and stitch by id.
      const { data: profiles, error: profErr } = await admin
        .from('profiles')
        .select('id, display_name, role')
      if (profErr) return failure('server_error', profErr.message, 400)

      const byId = new Map<string, ProfileRow>(
        ((profiles ?? []) as ProfileRow[]).map((p) => [p.id, p]),
      )

      const members = data.users.map((u) => {
        const profile = byId.get(u.id)
        const email = (u.email ?? '').toLowerCase()
        const meta = (u.user_metadata ?? {}) as InviteMeta
        const username = emailToUsername(email) ?? meta.username ?? null
        const issuedAt = meta.invite_issued_at ?? null
        return {
          id: u.id,
          email: u.email ?? '',
          // Fall back to the signup metadata when the profiles row is missing —
          // an account without a profile still needs to be visible so the admin
          // can see it and delete it.
          display_name: profile?.display_name ?? meta.display_name ?? null,
          // A bootstrap admin is an admin regardless of what the row says; the
          // gate above trusts the list, and the UI should show the same truth.
          role: (ADMIN_EMAILS.includes(email) ? 'admin' : (profile?.role ?? 'member')) as MemberRole,
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at ?? null,
          has_profile: Boolean(profile),
          username,
          // An email account is claimed BY DEFINITION — it has no invite to
          // redeem — so the admin page's "pending" badge keys off
          // `username && !claimed` and never lights for the owner's own account.
          claimed: username ? meta.claimed === true : true,
          invite_expires_at:
            username && meta.claimed !== true && issuedAt ? addDays(issuedAt, INVITE_TTL_DAYS) : null,
          // So the Members page can grey out the role and delete controls on an
          // account the server is going to refuse anyway. It is a HINT for the
          // UI, never the boundary: every guard is re-checked below.
          is_bootstrap_admin: ADMIN_EMAILS.includes(email),
          is_self: u.id === callerId,
        }
      })
      return json({ members })
    }

    case 'create': {
      const role: MemberRole = body.role === 'admin' ? 'admin' : 'member'
      const rawUsername = body.username?.trim().toLowerCase() ?? ''

      // ── username account ───────────────────────────────────────────────────
      if (rawUsername) {
        if (rawUsername.includes('@') || !USERNAME_RE.test(rawUsername)) {
          return failure(
            'invalid_username',
            'Username must be 3–32 characters: lowercase letters, digits, dot, dash or underscore, starting and ending with a letter or digit',
            400,
          )
        }
        const pepper = requirePepper()
        if (typeof pepper !== 'string') return pepper

        // Default the display name to the username rather than rejecting: the
        // admin creating five accounts before a meeting should not have to type
        // each person's full name twice, and the Members page can edit it after.
        const displayName = (body.displayName?.trim() || rawUsername).slice(0, DISPLAY_NAME_MAX)
        const email = usernameToEmail(rawUsername)

        let existing
        try {
          existing = await findUserByEmail(email)
        } catch (e) {
          return failure('server_error', e instanceof Error ? e.message : 'Lookup failed', 400)
        }
        if (existing) {
          return failure('username_taken', `The username ${rawUsername} is already taken`, 409)
        }

        const code = generateInviteCode()
        const issuedAt = new Date().toISOString()
        // A random password, not none: an account with no password at all is
        // one Supabase setting away from being signable-into, and the claim
        // flow replaces this value before anyone ever needs it.
        const { data: created, error } = await admin.auth.admin.createUser({
          email,
          email_confirm: true,
          password: randomPassword(),
          user_metadata: {
            display_name: displayName,
            username: rawUsername,
            account_kind: 'username',
            invite_hash: await inviteHash(pepper, rawUsername, code),
            invite_issued_at: issuedAt,
            invite_alg: INVITE_ALG,
            claimed: false,
            claimed_at: null,
            created_by: callerEmail,
          },
        })
        if (error) return failure('server_error', error.message, 400)
        const newUser = created?.user
        if (!newUser) return failure('server_error', 'User was not created', 400)

        // The profiles row is what RLS keys off — see the email branch below for
        // the full reasoning; this is the same upsert against the row
        // handle_new_user() already wrote.
        const { error: profErr } = await admin
          .from('profiles')
          .upsert({ id: newUser.id, display_name: displayName, role }, { onConflict: 'id' })
        if (profErr) {
          await admin.auth.admin.deleteUser(newUser.id)
          return failure('server_error', `Could not create profile: ${profErr.message}`, 400)
        }

        // A username freed by an earlier delete can be re-created, and it would
        // inherit whatever backoff the old holder's guessers had accumulated.
        const { error: resetErr } = await admin.rpc('claim_reset', {
          p_scope: 'username',
          p_bucket: rawUsername,
        })
        if (resetErr) console.error('[admin-members] counter reset failed:', resetErr.message)

        return json({
          ok: true,
          id: newUser.id,
          username: rawUsername,
          displayName,
          role,
          // The ONE time this value is ever readable. It is not logged here and
          // must not be logged by the caller.
          inviteCode: code,
          expiresAt: addDays(issuedAt, INVITE_TTL_DAYS),
        })
      }

      // ── legacy email/OTP account ───────────────────────────────────────────
      const email = body.email?.trim().toLowerCase()
      const displayName = (body.displayName?.trim() ?? '').slice(0, DISPLAY_NAME_MAX)
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return failure('invalid_email', 'Invalid email', 400)
      }
      if (!displayName) return failure('display_name_required', 'Display name is required', 400)

      // Idempotency guard: createUser throws a 422 on a duplicate address, which
      // surfaces to the admin as an opaque "Database error". Look first so a
      // double-submit (or a retried request after a flaky network) gets a
      // sentence a human can act on instead.
      let existing
      try {
        existing = await findUserByEmail(email)
      } catch (e) {
        return failure('server_error', e instanceof Error ? e.message : 'Lookup failed', 400)
      }
      if (existing) {
        return failure('email_taken', `An account already exists for ${email}`, 409)
      }

      // No password: sign-in is a 6-digit email OTP, and email_confirm skips the
      // confirmation mail that a provisioned account never needs to click.
      const { data: created, error } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { display_name: displayName, created_by: callerEmail },
      })
      if (error) return failure('server_error', error.message, 400)
      const newUser = created?.user
      if (!newUser) return failure('server_error', 'User was not created', 400)

      // The profiles row is what RLS keys off — an auth user without one can
      // sign in and then see nothing, which reads as a broken app. createUser
      // above already fired handle_new_user(), which always writes role
      // 'member', so this is in practice the UPDATE branch of the upsert and is
      // the ONLY thing that makes an admin exist.
      //
      // That depends on guard_profile_role() skipping its revert when
      // auth.uid() is null (this client is the service role, which carries no
      // `sub` claim). If that guard is ever tightened back to an unconditional
      // is_admin() check, this write is silently reverted to 'member', the
      // upsert still returns success, and the workspace can never have an
      // admin again. See supabase/migrations/0001_opstrack_core.sql.
      const { error: profErr } = await admin
        .from('profiles')
        .upsert({ id: newUser.id, display_name: displayName, role }, { onConflict: 'id' })
      if (profErr) {
        // Roll the auth user back. Leaving it behind would make the next attempt
        // hit the "already exists" branch above with no profile to go with it.
        await admin.auth.admin.deleteUser(newUser.id)
        return failure('server_error', `Could not create profile: ${profErr.message}`, 400)
      }

      return json({ ok: true, id: newUser.id })
    }

    case 'reissue-code': {
      // Accept either handle: the Members page has the id, a support call over
      // the phone has the username.
      const rawUsername = body.username?.trim().toLowerCase() ?? ''
      if (!body.userId && !rawUsername) {
        return failure('invalid_body', 'Missing userId or username', 400)
      }
      const pepper = requirePepper()
      if (typeof pepper !== 'string') return pepper

      let target
      if (body.userId) {
        const { data, error } = await admin.auth.admin.getUserById(body.userId)
        if (error || !data.user) return failure('not_found', 'Member not found', 404)
        target = data.user
      } else {
        try {
          target = await findUserByEmail(usernameToEmail(rawUsername))
        } catch (e) {
          return failure('server_error', e instanceof Error ? e.message : 'Lookup failed', 400)
        }
        if (!target) return failure('not_found', 'Member not found', 404)
      }

      const username = emailToUsername(target.email)
      // Refuse on an email account rather than inventing a username for it: an
      // OTP account already has a self-service way back in, and issuing it a
      // code would create a second credential nobody asked for.
      if (!username) {
        return failure(
          'email_account',
          'That account signs in by email code, not by invite',
          400,
        )
      }

      const issued = await issueCode(
        target.id,
        username,
        (target.user_metadata ?? {}) as InviteMeta,
        pepper,
      )
      if ('error' in issued) return failure('server_error', issued.error, 400)

      return json({
        ok: true,
        id: target.id,
        username,
        inviteCode: issued.code,
        expiresAt: issued.expiresAt,
      })
    }

    case 'set-role': {
      if (!body.userId) return failure('invalid_body', 'Missing userId', 400)
      const role: MemberRole = body.role === 'admin' ? 'admin' : 'member'

      // Guard 1: NO SELF-DEMOTION. An admin who demotes themselves loses the
      // Members page in the same breath, and if they were the only one holding
      // it open the workspace has no way back except SQL. Promotion of self is
      // a no-op and needs no guard.
      if (body.userId === callerId && role !== 'admin') {
        return failure('self_demote', 'You cannot remove your own admin role', 403)
      }

      const { data: target, error: getErr } = await admin.auth.admin.getUserById(body.userId)
      if (getErr || !target.user) return failure('not_found', 'Member not found', 404)
      const targetEmail = (target.user.email ?? '').toLowerCase()

      // The bootstrap address is an admin by the gate above whatever the row
      // says, so writing 'member' onto its profile would produce a screen that
      // disagrees with the server. Refuse and say why.
      if (ADMIN_EMAILS.includes(targetEmail) && role !== 'admin') {
        return failure(
          'bootstrap_admin',
          'That account is the workspace owner and is always an admin',
          403,
        )
      }

      const { data: profile, error: profErr } = await admin
        .from('profiles')
        .select('id, display_name, role')
        .eq('id', body.userId)
        .maybeSingle<ProfileRow>()
      if (profErr) return failure('server_error', profErr.message, 400)
      if (!profile) return failure('not_found', 'Member not found', 404)

      if (profile.role === role) return json({ ok: true, id: body.userId, role })

      // Guard 2: KEEP AT LEAST ONE ADMIN STANDING. Members are provisioned only
      // through this function, so a workspace with zero admins can never issue
      // another create call — it would be unrecoverable from inside the app.
      if (profile.role === 'admin' && role === 'member') {
        const admins = await countAdmins()
        if (typeof admins !== 'number') return admins
        if (admins <= 1) {
          return failure('last_admin', 'Cannot remove the last remaining admin', 403)
        }
      }

      const { error } = await admin.from('profiles').update({ role }).eq('id', body.userId)
      if (error) return failure('server_error', error.message, 400)
      return json({ ok: true, id: body.userId, role })
    }

    case 'delete': {
      if (!body.userId) return failure('invalid_body', 'Missing userId', 400)

      // Guard 1: never let an admin lock themselves out mid-session.
      if (body.userId === callerId) {
        return failure('self_delete', 'You cannot delete your own account', 403)
      }

      const { data: target, error: getErr } = await admin.auth.admin.getUserById(body.userId)
      if (getErr || !target.user) return failure('not_found', 'Member not found', 404)
      const targetEmail = (target.user.email ?? '').toLowerCase()

      if (ADMIN_EMAILS.includes(targetEmail)) {
        return failure(
          'bootstrap_admin',
          'That account is the workspace owner and cannot be removed here',
          403,
        )
      }

      const { data: profile } = await admin
        .from('profiles')
        .select('id, display_name, role')
        .eq('id', body.userId)
        .maybeSingle<ProfileRow>()

      // Guard 2: keep at least one admin standing — same reasoning as set-role.
      if (profile?.role === 'admin') {
        const admins = await countAdmins()
        if (typeof admins !== 'number') return admins
        if (admins <= 1) {
          return failure('last_admin', 'Cannot delete the last remaining admin', 403)
        }
      }

      // The profiles row cascades away with the user
      // (profiles.id references auth.users on delete cascade), and entries keep
      // their history because owner_id/created_by are nullable references.
      const { error } = await admin.auth.admin.deleteUser(body.userId)
      if (error) return failure('server_error', error.message, 400)

      // The username is free again; its backoff must not haunt whoever takes it.
      const freedUsername = emailToUsername(targetEmail)
      if (freedUsername) {
        const { error: resetErr } = await admin.rpc('claim_reset', {
          p_scope: 'username',
          p_bucket: freedUsername,
        })
        if (resetErr) console.error('[admin-members] counter reset failed:', resetErr.message)
      }

      return json({ ok: true })
    }

    default:
      return failure('unknown_action', 'Unknown action', 400)
  }
})
