# CoreTrack

> **Pending database migrations:** see [`docs/PENDING-MIGRATIONS.md`](docs/PENDING-MIGRATIONS.md). Migrations `0014`–`0017` are written, tested and **not yet
> applied**; four user-facing guarantees are broken until they are run.


A multi-track action and decision tracker for an operations lead who owns several
domains at once (PMO, IT Operations, Network, Infrastructure, SRE) and delegates
most of the execution.

> **On the name.** The product is **CoreTrack** for the team-testing period. Every
> technical identifier still reads `opstrack` on purpose — the repo, the Pages URL,
> the `package.json` name, the `opstrack_*` storage keys, the CSS prefixes, the
> Supabase project, the iOS bundle id and the `@opstrack.internal` auth domain.
> Renaming those mid-testing would break installed PWAs, bookmarks and stored
> sessions for no gain. They are swapped in one clean cut at launch, under the
> launch name — see [`docs/WAVE5-NOTES.md`](docs/WAVE5-NOTES.md) §1.

Two things it optimises for, and everything else bends around them:

1. **Capture takes under five seconds.** If logging an item is slow, the tool is
   abandoned within a week.
2. **Staleness is visible without being asked for.** The real failure mode is not
   a forgotten task, it is an item sitting untouched for three weeks.

Built with **React 19 + TypeScript + Vite**, `react-router-dom` (HashRouter),
`zustand`, plain CSS, and **Supabase** for Postgres, Auth, Realtime and
Row-Level Security. Fully bilingual English/Arabic with RTL layout — Arabic is a
first-class locale here, not a translation layer, down to the bidi isolates that
keep a mixed-direction sentence reading in the right order.

It ships as an **installable PWA with an offline write queue**: captures and edits
made with no network are held locally and flush in dependency order on reconnect.
There is also a committed **Capacitor iOS shell** for the App Store path; every
native call sits behind a no-op that a browser tab takes instead.

---

## Status at v1.0.1

Released 30 July 2026 as v1.0.0; **v1.0.1 on 31 July 2026**. Live at
<https://abosallom.github.io/opstrack/>, built from `main` by GitHub Actions,
backed by a real Supabase project. The v1.0.0 release smoke — every screen in
both languages, both themes, at 1280 and 375, against the deployed origin rather
than a dev server — is
[`docs/EVIDENCE/wave5-release-smoke.md`](docs/EVIDENCE/wave5-release-smoke.md);
its §7 is the v1.0.1 gate.

**v1.0.1 is four fixes and no new features**, cut before the team started
testing. Two came out of that smoke: `@username` now assigns (it is the
identifier an admin hands out, and typing it used to file a free-text owner —
no assignment, no notification, nothing red), and deleting a member now leaves
their name on their entries, which is what the confirm dialog had been promising.
The other two are cosmetic: the offline strip no longer covers the header, and
downloaded files are named `coretrack-…`. It also carries migrations `0012` and
`0013` — **apply both before or with the deploy**; `RUNBOOK.md` §5 is the
procedure and both files re-run cleanly.

Four things are commonly assumed about a release like this one, and the honest
answer differs for each.

**How you install it: as a PWA.** Add to Home Screen from Safari on iOS or Chrome
on Android and it runs standalone, offline-capable, from that URL. That is the
supported distribution channel today and the one the team should use.

**Web push: real, and proven on desktop.** The whole chain is built and was
exercised end to end against the live project on 30 July 2026 — a browser
subscribed through the product's own button, the trigger enqueued, `pg_net` woke
the sender, FCM accepted the VAPID token, and the browser decrypted the payload
and displayed the notification. The ledger, with row ids, is
[`docs/RUNBOOK.md`](docs/RUNBOOK.md) §9.4. What is **not** proven: iOS/Safari (a
notification there requires the PWA to be installed to the Home Screen first, and
that path has no headless equivalent), delivery to a locked screen, and clicking
a notification focusing the right entry. Treat push on a phone as unverified until
someone verifies it — §9.4 ends with the five-minute manual procedure.

**iOS as a native App Store app: not shipped, and not close.** The Capacitor shell
compiles, installs and launches in the Simulator, repeatedly and with evidence
([`docs/APP-STORE.md`](docs/APP-STORE.md) §2). It has never run on a physical
iPhone. There is no signing team in the project, no `PrivacyInfo.xcprivacy`, no
Release-configuration build, no archive, no TestFlight build and no store listing;
§4 of that file is the full outstanding list, and the largest items on it are
Apple's paperwork rather than code. The Apple Developer account exists, so this is
work that can start — it just has not.

**Security: audited hard, with one hole in the audit itself.** Eight deep audits
ran across the waves and every finding is dispositioned one by one in
[`docs/FIX-BACKLOG.md`](docs/FIX-BACKLOG.md); the claim/invite flow was rewritten
under a lens told to break it, then re-probed against the live project. Two
things not to assume from that. **The last security pass is incomplete** — it
reported four items and one arrived before the pass died: `S5-1`, now `accepted`
by the owner (a username is confirmable through a Supabase platform endpoint —
§*Is it safe to ship the anon key?* has it). Its config finding, its correctness
finding and its residuals are recorded as **not received**, which is a gap in the
review and not a clean bill; re-running those two passes is named work for a
future wave, in that file. **And no human has ever pen-tested this.** Every audit
here was run by an agent against code and a live project, which finds a different
set of things than a person with a week and an intent does.

**Known defects and their dispositions** are
[`docs/FIX-BACKLOG.md`](docs/FIX-BACKLOG.md). Nothing there is a release blocker;
several entries are deliberate "won't fix, here is why" records rather than debt.

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
- Leave **Email** enabled. **Confirm email** can stay on or go off — it makes no
  difference here, because every account is created pre-confirmed by the edge
  function or by you in the dashboard, and no address ever confirms itself. The
  live project runs with it on.

Disabling signups is load-bearing, not a hardening extra. CoreTrack has no public
sign-up flow: members are provisioned by an admin through the `admin-members`
edge function, which creates the auth user and its `profiles` row together.
Sign-in calls `signInWithOtp` with `shouldCreateUser: false`, so an unknown
address gets a "signups not allowed" error from Supabase — the app translates
that into *"No account with that email — accounts are created by the admin"*,
because that error is what an unknown address actually produces.

**Do not go looking for the email template.** An earlier version of this file
told you to put `{{ .Token }}` into **Email Templates › Magic Link** so the mail
would carry a six-digit code. On the free tier that is impossible: the API
answers *"Email template modification is not available for free tier projects"* —
recorded live, with the exact refusal, in
[`docs/WAVE2-NOTES.md`](docs/WAVE2-NOTES.md). The mail is therefore always the
stock magic **link**, and the sign-in screen says so.

Two consequences worth knowing before you first sign in:

- **The link signs in whichever device opens it**, and it always lands on the
  project's Site URL — so a link requested on a laptop and opened on a phone
  signs the phone in. Set **Authentication › URL Configuration › Site URL** to
  your deployed origin.
- **The screen's "enter a code instead" disclosure is wired and works.** It is
  waiting for the day a custom SMTP provider makes the code visible in the mail;
  until then it has nothing to receive. Configuring SMTP is the one change that
  turns it back into the primary path.

Email is only ever *your* problem, incidentally. Every other account is a
username with a password and no inbox at all — see
[`ADMIN.md`](ADMIN.md#member-accounts-usernames-invites-and-claiming).

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

### 4. Deploy the three edge functions

Two are required to have accounts at all, and the third is what makes a
notification leave the building. Deploying `admin-members` without
`claim-account` is the mistake that costs an afternoon: every account you then
create is permanently unclaimable, and the failure shows up as a member who
cannot sign in rather than as an error you can search for.

| Function | What it does | Who calls it |
| --- | --- | --- |
| [`admin-members`](supabase/functions/admin-members/index.ts) | list · create · delete · reissue-code · set-role. The only way an account comes into existence, because signups are off. | an admin, with their own session |
| [`claim-account`](supabase/functions/claim-account/index.ts) | redeems a one-time invite code and sets the member's chosen password | the member, **with no session at all** |
| [`send-push`](supabase/functions/send-push/index.ts) | drains `push_outbox` and sends Web Push | the **database** — a trigger for latency, a `cron` tick for truth |

All three hold the service-role key; nothing else in this project does.

Two of them also need **function secrets**, which are not optional and are not in
this file because they are operational rather than setup:
`admin-members` and `claim-account` share `INVITE_PEPPER` — without it
`admin-members` **refuses to mint an invite** rather than silently downgrading
the digest — and `send-push` needs a VAPID keypair plus `PUSH_DRAIN_SECRET`.
[`docs/RUNBOOK.md`](docs/RUNBOOK.md) §4.1 lists every one with its failure mode,
and §4.2 generates the VAPID pair. Skip `send-push` and its secrets and the app
works in every respect except that no notification is ever delivered; the
in-product bell still fills.

**Set the provisioning allow-list before you deploy.** Open
[`supabase/functions/admin-members/index.ts`](supabase/functions/admin-members/index.ts)
and put your own address in its `ADMIN_EMAILS` array.

That list is **not** the app's admin gate, and there is no second copy of it to
keep in sync. Two different gates exist and they answer different questions:

- **`profiles.role = 'admin'`** decides who is an admin. RLS reads it
  (`is_admin()`), and the browser reads the same column to decide which controls
  to render. It is the single source of truth.
- **`ADMIN_EMAILS` inside `admin-members`** decides only who may call *that
  function* with the service role. Adding an address there does not make anyone
  an admin, and promoting someone to admin does not let them provision members.

[`src/lib/admin.ts`](src/lib/admin.ts) is deliberately `export {}` plus a note
explaining this. A browser copy of the allow-list used to exist; it made the two
gates disagree, so the admin screens rendered for an address on the list and
every write it issued came back `42501`. A gate that shows you a form the server
will always reject is worse than no gate. Do not re-add it —
[`ADMIN.md`](ADMIN.md#who-can-provision-members) has the rest of the argument and
what it means for a second admin.

```bash
cd /path/to/opstrack
export SUPABASE_ACCESS_TOKEN='<a personal access token from supabase.com/dashboard/account/tokens>'
npx supabase functions deploy admin-members  --project-ref <your-project-ref> --use-api
npx supabase functions deploy claim-account  --project-ref <your-project-ref> --use-api
npx supabase functions deploy send-push      --project-ref <your-project-ref> --use-api
npx supabase functions list --project-ref <your-project-ref>
```

`--use-api` bundles server-side, so **Docker is not required** — that is the only
reason the flag matters, and it is why this is the one documented deploy path in
this repo. (`supabase link` is not needed and asks for a database password that
nothing here uses.)

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected
into functions automatically. The secrets named above are not — set them, or the
function that needs one refuses to work.

Leave **Verify JWT ON** for all three. `claim-account` is called by people who
have no session yet and works anyway, because supabase-js sends the project's
anon key as the bearer token — which satisfies the gateway while keeping the
endpoint unreachable without an apikey. `send-push` is called by the database
with that same anon key and gates on its own `x-push-drain` header instead.

**Invoke each one twice after deploying.** The first call fetches
`npm:@supabase/supabase-js@2` and can take a few seconds or time out once; that
is a cold start, not a failure. None of the three files is covered by `tsc` or
`oxlint` (`.oxlintrc.json` ignores `supabase/functions`, `tsconfig.app.json` is
`src`-only), so for these files a successful invocation **is** the type
check. Redeploy after every edit — a fix that sits in the repo is not live.

### 5. Create the first admin account

Chicken-and-egg: only an admin can provision members, and there is no admin yet.
Bootstrap one by hand.

[`0002_config_foundation.sql`](supabase/migrations/0002_config_foundation.sql)
ends with a bootstrap block that promotes **one hardcoded address** and prints a
`NOTICE` saying which of "promoted", "already an admin" or "no profile yet"
happened. On your own project that address is not yours, so either change it in
the file before running 0002, or ignore the block and do this:

1. **Authentication › Users › Add user**, enter your email, and tick
   *Auto Confirm User*. Set a password while you are there — you will want it:
   the magic link is the *alternative* sign-in path, not the only one, and a
   password works when the mail rate limit does not.
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
3. Make sure that same address is in `ADMIN_EMAILS` in
   `supabase/functions/admin-members/index.ts` — the one place it lives — or you
   will be an admin who cannot provision members. Step 4 explains why those are
   two separate questions.

Every subsequent member is created from **Settings › Team members**
(`/#/settings/members`), which calls `admin-members` for you. The same function
is callable directly with `curl`, and [`docs/RUNBOOK.md`](docs/RUNBOOK.md) §1 has
the exact requests — that is the path to use when you need to provision or remove
an account while the app itself is broken.

### 6. Configure and run locally

```bash
cp .env.example .env     # then paste the two values from step 1
npm install
npm run dev              # http://localhost:5173
```

Sign in at `/#/signin`. Your account is an email address, so you get two ways in:
type your password, or ask for a magic link and open it. Everyone else you
provision is a **username** with a password and no inbox — a different form on
the same screen. Those are the only two ways in: there is no external identity
provider, and the admin-managed member list *is* the directory
([`ADMIN.md`](ADMIN.md#member-accounts-usernames-invites-and-claiming)).

Two things about the link that surprise people. It signs in whichever device
opens it, and it always lands on the project's Site URL — so **it will not sign
you into `localhost`**; use your password for local development. And the built-in
mailer is capped at **two emails per hour, project-wide**, so the third request
in an hour is refused. Both are covered in
[`docs/RUNBOOK.md`](docs/RUNBOOK.md) §8.

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

The anon key identifies the *project*, not a *user*. Against **the database** it
grants exactly what the RLS policies grant to an unauthenticated role, which here
is nothing. Real access begins after sign-in, when Supabase issues a JWT for a
specific user, and every policy is written against `auth.uid()` and that user's
`profiles` row.

**One honest qualification, because "nothing" is about the database only.** The
same key also reaches Supabase's own auth endpoints on the same host, and those
are GoTrue's, not PostgREST's — no policy of ours governs them. One of them,
`POST /auth/v1/recover`, will tell an unauthenticated caller whether a given
username exists, which makes the member directory enumerable by anyone holding a
key that ships in the bundle by design. **This is known, it was escalated, and
the owner accepted it** — a username in this product is not a secret: it is
printed beside every person on the Members screen and typed by its owner at every
sign-in. What *is* secret is the invite code and the password, and neither is
reachable this way. The reasoning, and the two fixes that were turned down and
why, are **S5-1** in [`docs/FIX-BACKLOG.md`](docs/FIX-BACKLOG.md). The practical
consequence for an admin is one line, and it lives in
[`docs/RUNBOOK.md`](docs/RUNBOOK.md) §1.2: do not put anything sensitive in a
username.

Which is why the rules to keep are:

- **RLS on every table, always.** The policies *are* the security model. A table
  without RLS is public.
- **The service_role key never leaves the server.** It bypasses RLS entirely. It
  lives only in the three edge functions' environments, injected by Supabase — it
  is never in `.env`, because Vite would inline it into the browser bundle.
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
  api/         Supabase client + one module per table; every call returns ApiResult<T>
  components/  shared UI — entry/ sheet/ fields/ pickers/ charts/, each with its own CSS
  lib/         pure modules: i18n, dates, plural, bidi, the capture parser, digest/
  locales/     en/ and ar/, one JSON per namespace + index.ts (integrator-owned)
  pages/       one .tsx + co-located .css per route; settings/ meetings/ tracks/ nest
  store/       zustand stores — auth, entries, outbox, config, vocab, members, …
  styles/      global.css — the design-token ladder and the class-name registry
supabase/
  migrations/  numbered SQL: schema, RLS, triggers, views, seed. Run in order.
  functions/   admin-members + claim-account + send-push (all hold the service-role key)
ios/           Capacitor Xcode project — generated by `npm run ios:sync`, committed
assets/        source icon + splash art and the generator that fans them out
docs/          the build record: execution plan, wave notes, fix backlog, runbook
docs/parked/   modules written but not wired in, with a note saying what adoption owes
docs/EVIDENCE/ live-proof ledgers — claims about the running project, with artifacts
docs/templates/ the spreadsheets the admin fills in, and the guide beside them
```

Two conventions that are load-bearing rather than stylistic. **Every string goes
through `t()`** with an entry in both `en/` and `ar/`; a gate fails the build on a
missing key, a bad plural node, or a mixed-direction string with no bidi isolate.
And **each CSS file owns exactly one class prefix** — the registry is at the head
of `global.css` and in the execution plan; nothing may style another sheet's
prefix.

## Scripts

| Command             | What it does                                              |
| ------------------- | --------------------------------------------------------- |
| `npm run dev`       | Vite dev server, exposed on the LAN                       |
| `npm run build`     | `tsc -b` then a production build to `dist/`               |
| `npm run lint`      | oxlint                                                    |
| `npm run test`      | vitest, once. It prints its own totals — see below        |
| `npm run preview`   | serve the built `dist/` locally                           |
| `npm run seed`      | insert demo tracks and entries into the configured project |
| `npm run icons`     | regenerate PWA and iOS icons from `assets/icon.png`       |
| `npm run ios:sync`  | build, then `cap sync ios` — do this before opening Xcode  |
| `npm run ios:open`  | open the Capacitor project in Xcode                       |
| `npm run ios:run`   | sync and run on a simulator or device                     |

The suite is large enough that its size is worth knowing, and hardcoding the
number here is how this line went stale twice. Ask it instead:

```bash
npm run test 2>&1 | grep -E '^ *(Test Files|Tests) '
#  Test Files  59 passed (59)
#       Tests  1615 passed (1615)
```

That is the output at the `v1.0.1` tag (`git rev-parse 'v1.0.1^{}'`), measured
31 July 2026; `v1.0.0` was `58 / 1586` at `79391d1` the same day. If your run
disagrees, your run is right and this comment is old.

The deploy workflow runs lint, test and build; a red suite stops the deploy before
it starts. **None of the three `supabase/functions/` files is covered by `tsc` or
`oxlint`** — see §4.

## Operating it

Setup is this file. **Everything after setup is [`docs/RUNBOOK.md`](docs/RUNBOOK.md)** —
adding and removing members, rotating keys, recovering a lost admin role, applying
a migration, rolling back a bad deploy, reading the audit log, and what to do when
sign-in mail misbehaves. Every procedure there is written for the operator rather
than for a developer, and every one was re-verified against the live project.

Why the app is shaped the way it is — what an admin can and cannot change, how SLAs
resolve, what widening a frozen value list actually costs — is
[`ADMIN.md`](ADMIN.md). Known defects and their dispositions are
[`docs/FIX-BACKLOG.md`](docs/FIX-BACKLOG.md).
