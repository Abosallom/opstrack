// Supabase Edge Function: admin-members
//
// The single server-side gate for ALL member management: list, create, delete.
// Signups are disabled on the project, so this is the only way an account comes
// into existence. The web app's admin checks (src/lib/admin.ts, profiles.role)
// are cosmetic UI gating — anyone can call this endpoint with any anon-key
// session, so it re-verifies the caller's JWT against the admin list below
// before touching the service-role client.
//
// Deploy (one time): Supabase Dashboard → Edge Functions → Deploy new function
// → name it `admin-members` → paste this file. Or CLI:
//   npx supabase functions deploy admin-members
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are injected
// automatically — no extra secrets needed.

import { createClient } from 'npm:@supabase/supabase-js@2'

// Keep in sync with ADMIN_EMAILS in src/lib/admin.ts.
const ADMIN_EMAILS = ['az.alsaloom@gmail.com']

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
  action?: 'list' | 'create' | 'delete'
  email?: string
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
        return {
          id: u.id,
          email: u.email ?? '',
          // Fall back to the signup metadata when the profiles row is missing —
          // an account without a profile still needs to be visible so the admin
          // can see it and delete it.
          display_name:
            profile?.display_name ??
            (u.user_metadata?.display_name as string | undefined) ??
            null,
          // A hardcoded admin is an admin regardless of what the row says; the
          // edge function trusts the list, and the UI should show the same truth.
          role: (ADMIN_EMAILS.includes(email) ? 'admin' : (profile?.role ?? 'member')) as MemberRole,
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at ?? null,
          has_profile: Boolean(profile),
        }
      })
      return json({ members })
    }

    case 'create': {
      const email = body.email?.trim().toLowerCase()
      const displayName = body.displayName?.trim() ?? ''
      const role: MemberRole = body.role === 'admin' ? 'admin' : 'member'
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
