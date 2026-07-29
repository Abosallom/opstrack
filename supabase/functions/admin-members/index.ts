// Supabase Edge Function: admin-members (v2 — username accounts)
//
// The single server-side gate for ALL member management: list, create, delete,
// reissue-code. Signups are disabled on the project, so this is the only way an
// account comes into existence. The web app's admin checks (profiles.role) are
// cosmetic UI gating — anyone can call this endpoint with any anon-key session,
// so it re-verifies the caller's JWT against the admin list below before
// touching the service-role client.
//
// WHAT V2 ADDS. `create` now takes EITHER {username, role} or the legacy
// {email, displayName, role}. The username path mints an account that
// authenticates against a synthetic `<username>@opstrack.internal` address and
// hands back a ONE-TIME invite code the admin passes on in person; the member
// redeems it once through the `claim-account` function, choosing their own
// password. `reissue-code` mints a replacement — it is the password-reset path,
// because an @opstrack.internal address is RFC 6761 reserved and can never
// receive mail. `list` reports `username` and `claimed` so the admin page can
// show who is still pending.
//
// THE CODE IS NEVER STORED IN THE CLEAR. user_metadata carries a SHA-256 of
// `username:CODE`, so this endpoint can verify a claim but cannot show the code
// again — there is deliberately no "show it once more" path, only reissue.
//
// Deploy:
//   npx supabase functions deploy admin-members --project-ref <ref> --use-api
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are injected
// automatically — no extra secrets needed.

import { createClient } from 'npm:@supabase/supabase-js@2'

// Bootstrap allow-list for member PROVISIONING only — never a UI gate; see
// src/lib/admin.ts for why the browser copy was deleted.
//
// KNOWN GAP, owned by Wave 4 (plan gate 4(g)), deliberately NOT resolved here:
// a second admin promoted via profiles.role can manage tracks but cannot
// provision members. Widening this to a service-role profiles.role lookup is a
// one-line change in the guard below; it is left alone in Wave 1 so the wave
// that owns the Members page owns the security decision that page ships behind.
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

type MemberRole = 'admin' | 'member'

interface RequestBody {
  action?: 'list' | 'create' | 'delete' | 'reissue-code'
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
  claimed?: boolean
  claimed_at?: string | null
  created_by?: string
  /** claim-account's durable per-account failure throttle; reset on reissue. */
  claim_fail_count?: number
  claim_fail_since?: string | null
}

function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * What actually gets hashed.
 *
 * Binding the username into the digest means two accounts that happen to draw
 * the same code do not share a hash, so a leaked digest table can never be
 * reversed once and reused everywhere. SHA-256 is not a password KDF and is not
 * pretending to be one: unlike a password, this input is 40 uniform bits, valid
 * for 14 days, single-use, and rate-limited at the claim endpoint. The threat it
 * defends against is a metadata dump, and against that it is enough.
 */
async function inviteHash(username: string, code: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${username}:${normalizeCode(code)}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
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
  if (!token) return json({ error: 'Not signed in' }, 401)
  const anonClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
  )
  const { data: caller, error: callerErr } = await anonClient.auth.getUser(token)
  const callerEmail = caller?.user?.email?.toLowerCase()
  const callerId = caller?.user?.id
  if (callerErr || !callerEmail || !callerId) return json({ error: 'Not signed in' }, 401)

  // 2. Admin only. This is the real gate — the hardcoded list, not profiles.role,
  //    because a member could in principle flip their own role row if an RLS
  //    policy is ever loosened by mistake.
  if (!ADMIN_EMAILS.includes(callerEmail)) {
    return json({ error: 'Only the app admin can manage members' }, 403)
  }

  let body: RequestBody
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request body' }, 400)
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // The admin API has no "get user by email", so we page through the list.
  // 1000 users is far past what this workspace will ever hold; the cap stops a
  // pathological project from turning one request into an unbounded loop.
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

  /**
   * Mint (or re-mint) an invite code onto an existing auth user.
   *
   * Reissue deliberately clears `claimed`: a reissued code IS the password
   * reset, so the claim endpoint has to accept it again. Leaving the flag set
   * would make every reset fail with "already claimed" — an honest-looking
   * error for a flow that can never succeed.
   *
   * It clears claim-account's failure counter for the same reason, and this one
   * was found the hard way: burn ten wrong guesses at a pending account and the
   * per-account throttle refuses everything for fifteen minutes, INCLUDING a
   * freshly issued code. The admin's whole remedy is "here is a new code, try
   * again", and it has to actually work the moment they say it.
   */
  async function issueCode(userId: string, username: string, meta: InviteMeta) {
    const code = generateInviteCode()
    const issuedAt = new Date().toISOString()
    const { error } = await admin.auth.admin.updateUserById(userId, {
      user_metadata: {
        ...meta,
        username,
        account_kind: 'username',
        invite_hash: await inviteHash(username, code),
        invite_issued_at: issuedAt,
        claimed: false,
        claimed_at: null,
        claim_fail_count: 0,
        claim_fail_since: null,
      },
    })
    if (error) return { error: error.message }
    // Returned to the caller ONCE, and never logged: the digest above is all
    // that survives this request.
    return { code, issuedAt, expiresAt: addDays(issuedAt, INVITE_TTL_DAYS) }
  }

  switch (body.action) {
    case 'list': {
      const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
      if (error) return json({ error: error.message }, 400)

      // auth.users and profiles live in different schemas, so there is no SQL
      // join to make here — fetch the profiles side and stitch by id.
      const { data: profiles, error: profErr } = await admin
        .from('profiles')
        .select('id, display_name, role')
      if (profErr) return json({ error: profErr.message }, 400)

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
          // A hardcoded admin is an admin regardless of what the row says; the
          // edge function trusts the list, and the UI should show the same truth.
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
        }
      })
      return json({ members })
    }

    case 'create': {
      const role: MemberRole = body.role === 'admin' ? 'admin' : 'member'
      const rawUsername = body.username?.trim().toLowerCase() ?? ''

      // ── username account (v2) ──────────────────────────────────────────────
      if (rawUsername) {
        if (rawUsername.includes('@') || !USERNAME_RE.test(rawUsername)) {
          return json(
            {
              error:
                'Username must be 3–32 characters: lowercase letters, digits, dot, dash or underscore, starting and ending with a letter or digit',
            },
            400,
          )
        }
        // Default the display name to the username rather than rejecting: the
        // admin creating five accounts before a meeting should not have to type
        // each person's full name twice, and the Members page can edit it after.
        const displayName = body.displayName?.trim() || rawUsername
        const email = usernameToEmail(rawUsername)

        let existing
        try {
          existing = await findUserByEmail(email)
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : 'Lookup failed' }, 400)
        }
        if (existing) {
          return json({ error: `The username ${rawUsername} is already taken` }, 409)
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
            invite_hash: await inviteHash(rawUsername, code),
            invite_issued_at: issuedAt,
            claimed: false,
            claimed_at: null,
            claim_fail_count: 0,
            claim_fail_since: null,
            created_by: callerEmail,
          },
        })
        if (error) return json({ error: error.message }, 400)
        const newUser = created?.user
        if (!newUser) return json({ error: 'User was not created' }, 400)

        // The profiles row is what RLS keys off — see the email branch below for
        // the full reasoning; this is the same upsert against the row
        // handle_new_user() already wrote.
        const { error: profErr } = await admin
          .from('profiles')
          .upsert({ id: newUser.id, display_name: displayName, role }, { onConflict: 'id' })
        if (profErr) {
          await admin.auth.admin.deleteUser(newUser.id)
          return json({ error: `Could not create profile: ${profErr.message}` }, 400)
        }

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
      const displayName = body.displayName?.trim() ?? ''
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return json({ error: 'Invalid email' }, 400)
      }
      if (!displayName) return json({ error: 'Display name is required' }, 400)

      // Idempotency guard: createUser throws a 422 on a duplicate address, which
      // surfaces to the admin as an opaque "Database error". Look first so a
      // double-submit (or a retried request after a flaky network) gets a
      // sentence a human can act on instead.
      let existing
      try {
        existing = await findUserByEmail(email)
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Lookup failed' }, 400)
      }
      if (existing) {
        return json({ error: `An account already exists for ${email}` }, 409)
      }

      // No password: sign-in is a 6-digit email OTP, and email_confirm skips the
      // confirmation mail that a provisioned account never needs to click.
      const { data: created, error } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { display_name: displayName, created_by: callerEmail },
      })
      if (error) return json({ error: error.message }, 400)
      const newUser = created?.user
      if (!newUser) return json({ error: 'User was not created' }, 400)

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
        return json({ error: `Could not create profile: ${profErr.message}` }, 400)
      }

      return json({ ok: true, id: newUser.id })
    }

    case 'reissue-code': {
      // Accept either handle: the Members page has the id, a support call over
      // the phone has the username.
      const rawUsername = body.username?.trim().toLowerCase() ?? ''
      if (!body.userId && !rawUsername) return json({ error: 'Missing userId or username' }, 400)

      let target
      if (body.userId) {
        const { data, error } = await admin.auth.admin.getUserById(body.userId)
        if (error || !data.user) return json({ error: 'Member not found' }, 404)
        target = data.user
      } else {
        try {
          target = await findUserByEmail(usernameToEmail(rawUsername))
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : 'Lookup failed' }, 400)
        }
        if (!target) return json({ error: 'Member not found' }, 404)
      }

      const username = emailToUsername(target.email)
      // Refuse on an email account rather than inventing a username for it: an
      // OTP account already has a self-service way back in, and issuing it a
      // code would create a second credential nobody asked for.
      if (!username) {
        return json({ error: 'That account signs in by email code, not by invite' }, 400)
      }

      const issued = await issueCode(target.id, username, (target.user_metadata ?? {}) as InviteMeta)
      if ('error' in issued) return json({ error: issued.error }, 400)

      return json({
        ok: true,
        id: target.id,
        username,
        inviteCode: issued.code,
        expiresAt: issued.expiresAt,
      })
    }

    case 'delete': {
      if (!body.userId) return json({ error: 'Missing userId' }, 400)

      // Guard 1: never let an admin lock themselves out mid-session.
      if (body.userId === callerId) {
        return json({ error: 'You cannot delete your own account' }, 403)
      }

      const { data: target, error: getErr } = await admin.auth.admin.getUserById(body.userId)
      if (getErr || !target.user) return json({ error: 'Member not found' }, 404)
      const targetEmail = (target.user.email ?? '').toLowerCase()

      const { data: profile } = await admin
        .from('profiles')
        .select('id, display_name, role')
        .eq('id', body.userId)
        .maybeSingle<ProfileRow>()

      const targetIsAdmin = profile?.role === 'admin' || ADMIN_EMAILS.includes(targetEmail)

      // Guard 2: keep at least one admin standing. Members are provisioned only
      // through this function, so a workspace with zero admins can never issue
      // another create call — it would be unrecoverable from inside the app.
      if (targetIsAdmin) {
        const { count, error: countErr } = await admin
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('role', 'admin')
        if (countErr) return json({ error: countErr.message }, 400)
        if ((count ?? 0) <= 1) {
          return json({ error: 'Cannot delete the last remaining admin' }, 403)
        }
      }

      // The profiles row cascades away with the user
      // (profiles.id references auth.users on delete cascade), and entries keep
      // their history because owner_id/created_by are nullable references.
      const { error } = await admin.auth.admin.deleteUser(body.userId)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    default:
      return json({ error: 'Unknown action' }, 400)
  }
})
