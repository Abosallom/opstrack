# OpsTrack

A multi-track action and decision tracker for an operations lead who owns several
domains at once (PMO, IT Operations, Network, Infrastructure, SRE) and delegates
most of the execution.

Two things it optimises for, and everything else bends around them:

1. **Capture takes under five seconds.** If logging an item is slow, the tool is
   abandoned within a week.
2. **Staleness is visible without being asked for.** The real failure mode is not
   a forgotten task, it is an item sitting untouched for three weeks.

Built with **React 19 + TypeScript + Vite**, `react-router-dom` (HashRouter),
`zustand`, plain CSS, and **Supabase** for Postgres, Auth, Realtime and
Row-Level Security. Fully bilingual English/Arabic with RTL layout.

---

## Setup

Follow these in order. Steps 1–5 are one-time server-side setup; you cannot sign
in before step 5 because signups are disabled by design.

### 1. Create the Supabase project

Create a free project at [supabase.com](https://supabase.com). Pick a region near
your team — every read in this app is a round trip.

From **Project Settings › API**, note two values for later:

- **Project URL** → `VITE_SUPABASE_URL`
- **anon / public key** → `VITE_SUPABASE_ANON_KEY`

Leave the **service_role** key where it is. It never goes into the client.

### 2. Disable signups

**Authentication › Sign In / Providers › Email**:

- Turn **Allow new users to sign up** *off*.
- Leave **Email** enabled, and turn **Confirm email** off (OTP is the
  confirmation).

This is load-bearing, not a hardening extra. OpsTrack has no public sign-up flow:
members are provisioned by an admin through the `admin-members` edge function,
which creates the auth user and its `profiles` row together. Sign-in calls
`signInWithOtp` with `shouldCreateUser: false`, so an unknown address gets a
"signups not allowed" error from Supabase — the app translates that into
*"No account with that email — accounts are created by the admin"*, because that
error is what an unknown address actually produces.

While you are in Auth settings, open **Email Templates › Magic Link** and make
sure the body contains `{{ .Token }}`. Without it Supabase sends a magic *link*
and the six-digit code never reaches the user.

### 3. Run the migration

Open the **SQL Editor** and run each file in [`supabase/migrations/`](supabase/migrations)
in numeric order, one at a time. They create the tables (`profiles`, `tracks`,
`entries`, `entry_updates`, `meetings`, `recurring_templates`), the RLS policies,
the `updated_at` / `last_activity_at` triggers, the `v_entry_health` view, and the
seed tracks.

The migrations are written to be re-runnable: `create table if not exists`, and a
`drop policy if exists` before every `create policy`. Running one twice is safe.

Confirm afterwards that **Database › Tables** shows RLS enabled on every table.
An exposed table with RLS off would be readable by anyone holding the anon key,
which is everyone.

### 4. Deploy the `admin-members` edge function

This function is the only place the service-role key is ever used. It re-verifies
the caller's JWT against a hardcoded `ADMIN_EMAILS` list before touching the
service-role client — the admin checks inside the React app are cosmetic UI
gating and nothing more.

Edit [`supabase/functions/admin-members/index.ts`](supabase/functions/admin-members/index.ts)
and put your admin email addresses in its `ADMIN_EMAILS` array. Keep that list
identical to the one in [`src/lib/admin.ts`](src/lib/admin.ts); they serve
different purposes (server gate vs. hiding buttons) but a mismatch means an admin
sees controls that then fail.

```bash
npm i -g supabase                     # or: brew install supabase/tap/supabase
supabase login
supabase link --project-ref <your-project-ref>
supabase functions deploy admin-members
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected into functions
automatically; you do not need to set any secrets.

### 5. Create the first admin account

Chicken-and-egg: only an admin can provision members, and there is no admin yet.
Bootstrap one by hand.

1. **Authentication › Users › Add user**, enter your email, and tick
   *Auto Confirm User*. Leave the password blank or random — OpsTrack signs in
   with OTP and never uses it.
2. Copy the new user's UUID, then in the **SQL Editor**:

   ```sql
   insert into public.profiles (id, display_name, role, locale)
   values ('<paste-the-uuid>', 'Your Name', 'admin', 'en')
   on conflict (id) do update set role = 'admin';
   ```

   The `profiles` row is what the RLS policies key off. An auth user without one
   can authenticate but will see nothing.

   This lands on the `do update` branch, because adding the user in step 1
   already fired the `on_auth_user_created` trigger and that always writes
   `role = 'member'` — deliberately, since the role must never be readable from
   client-supplied signup metadata. The `guard_profile_role` trigger skips its
   revert when `auth.uid()` is null, which is the case in the SQL Editor and for
   the service role, so this statement and the `admin-members` function are the
   only two ways a role is ever set.
3. Make sure that same email is in `ADMIN_EMAILS` in both places from step 4.

Every subsequent member is created from **Settings › Team** inside the app.

### 6. Configure and run locally

```bash
cp .env.example .env     # then paste the two values from step 1
npm install
npm run dev              # http://localhost:5173
```

Sign in at `/#/signin`: enter your email, receive a six-digit code, enter it.

The app also runs with an empty `.env` — the Supabase client is nullable and
every call site is guarded, so a credential-less build renders the shell and a
"not configured" message instead of a white screen. That is deliberate: a broken
env var in CI should produce a legible app, not a crash.

### 7. Deploy to GitHub Pages

1. Push the repo to GitHub with the default branch named `main`.
2. **Settings › Secrets and variables › Actions › New repository secret**, add
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
3. **Settings › Pages › Build and deployment › Source**, choose **GitHub Actions**.
4. Push. [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) lints,
   builds with the secrets injected, and publishes `dist/` via
   `actions/deploy-pages`.

Two things make the Pages deployment work that are easy to undo by accident:
`base: './'` in `vite.config.ts`, so assets resolve under the `/<repo-name>/`
subpath; and `HashRouter`, so deep links like `/#/board` do not need server-side
rewrites that Pages cannot do.

Vite inlines `VITE_*` variables **at build time**. Changing a secret means
re-running the workflow, not just redeploying.

---

## Is it safe to ship the anon key?

Yes, and there is no way to avoid it — any browser client must hold a public key
to reach the API, and anything in the bundle is readable.

The anon key identifies the *project*, not a *user*. On its own it grants exactly
what the RLS policies grant to an unauthenticated role, which here is nothing.
Real access begins after sign-in, when Supabase issues a JWT for a specific user,
and every policy is written against `auth.uid()` and that user's `profiles` row.

Which is why the rules to keep are:

- **RLS on every table, always.** The policies *are* the security model. A table
  without RLS is public.
- **The service_role key never leaves the server.** It bypasses RLS entirely. It
  lives only in the `admin-members` edge function's environment.
- **Every `security definer` function is revoked from `anon`.** RLS is not the
  boundary for these — a definer function runs as its owner, who is exempt from
  the policies. And `revoke ... from public` is not enough on Supabase: the
  project's default privileges give `anon` its own EXECUTE grant, which a revoke
  from PUBLIC leaves untouched. Both revokes, or the function is an
  unauthenticated RPC. See the note over `log_config_audit()` in migration 0002.
- **Membership is server-verified.** `profiles.role` in the client only decides
  which buttons render; RLS gates every write on `is_admin()`, which reads that
  same column, and the edge function re-checks the caller's JWT before doing
  anything privileged.

## Project layout

```
src/
  api/         Supabase client + data access
  components/  shared UI
  lib/         theme, i18n, admin helpers
  locales/     en.json, ar.json
  pages/       one .tsx + co-located .css per route
  store/       zustand stores (auth, settings, …)
  styles/      global.css — the design-token ladder
supabase/
  migrations/  numbered SQL: schema, RLS, triggers, views, seed
  functions/   admin-members edge function
```

## Scripts

| Command           | What it does                              |
| ----------------- | ----------------------------------------- |
| `npm run dev`     | Vite dev server, exposed on the LAN        |
| `npm run build`   | `tsc -b` then a production build to `dist/` |
| `npm run lint`    | oxlint                                    |
| `npm run preview` | Serve the built `dist/` locally           |
