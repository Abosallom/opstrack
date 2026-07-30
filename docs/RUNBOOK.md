# OpsTrack — runbook

The things you will actually have to do, written for you rather than for a
developer. Every procedure below was re-verified against the live project on
**30 July 2026**; where a claim depends on something that can drift, there is a
query you can run to check it yourself instead of trusting this page.

Nothing here needs the app to be working. Every recovery path ends in the
Supabase Dashboard or the GitHub Actions tab, both of which stay reachable when
OpsTrack does not.

**Rule of thumb:** if a procedure asks you for a password, an API key or a
recovery code, type it yourself. Don't paste it into a chat, a note, or a file
in this repo.

---

## 0. The five facts

| | |
| --- | --- |
| Live app | <https://abosallom.github.io/opstrack/> |
| Repo | <https://github.com/Abosallom/opstrack> (branch `main` deploys) |
| Supabase project | `opstrack`, ref `lrysgpbkmuqgzsjesfkr`, region `ap-northeast-2` (Seoul) |
| Supabase dashboard | <https://supabase.com/dashboard/project/lrysgpbkmuqgzsjesfkr> |
| Admin | `az.alsaloom@gmail.com` — one admin, `profiles.role = 'admin'` |

Two kinds of account exist, and almost every procedure below depends on which
one you are dealing with:

- **Your account** is a real email address. It can sign in with a password *or*
  with a magic link mailed to you.
- **Everyone else** has a **username** (no email), signs in with a password they
  chose, and got that password by redeeming a one-time invite code at `/claim`.
  Their account address is `<username>@opstrack.internal`, which is a reserved
  domain that can never receive mail — deliberately, so nothing in the product
  can ever quietly depend on emailing them.

---

## 1. Add a member

There is **no Members screen yet** (Settings › Members says "coming soon"). The
`admin-members` edge function is the only way an account comes into existence,
and today you call it by hand. Three steps.

### 1.1 Get your access token

Sign in to the live app in Chrome, open DevTools (⌥⌘I) → **Console**, paste:

```js
JSON.parse(localStorage.getItem('sb-lrysgpbkmuqgzsjesfkr-auth-token')).access_token
```

Copy the string it prints. It is your own session token, it expires in an hour,
and it is not your password — but treat it like one while you have it.

### 1.2 Create the account

In Terminal, from anywhere:

```bash
TOKEN='<paste the token>'
URL='https://lrysgpbkmuqgzsjesfkr.supabase.co/functions/v1/admin-members'
ANON='<the VITE_SUPABASE_ANON_KEY from .env>'

curl -s -X POST "$URL" \
  -H "apikey: $ANON" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"action":"create","username":"ahmed.otaibi","displayName":"Ahmed Al-Otaibi","role":"member"}'
```

Rules the function enforces, so you don't have to guess:

- **Username**: 3–32 characters, lowercase letters, digits, and `.` `-` `_` in
  the middle only. Must start and end with a letter or a digit. `ahmed.otaibi`
  and `it-ops` are fine; `-ops`, `Ahmed` and `ops.` are not.
- **`displayName` is optional.** Leave it out and the username is used.
- **`role`** is `member` or `admin`. Note that making someone an `admin` lets
  them edit tracks and vocabulary, but **not** provision members — that stays
  with the hardcoded list inside the function. See §1.5.

The reply looks like this, and the `inviteCode` is shown **exactly once**:

```json
{"ok":true,"id":"…","username":"ahmed.otaibi","displayName":"Ahmed Al-Otaibi",
 "role":"member","inviteCode":"K7QM-3XPT","expiresAt":"2026-08-13T…Z"}
```

Only a SHA-256 of `username:CODE` is stored. There is no "show it again" — if
you lose it, you reissue (§1.4).

### 1.3 Hand it over

Tell the person, in person or on a call — not by email, because the whole point
of these accounts is that they have no inbox:

> Go to the app, tap **First time here? Claim your account**, enter
> `ahmed.otaibi`, the code `K7QM-3XPT`, and pick a password of at least 8
> characters.

The code is good for **14 days** and works **once**. After they claim it, their
password is the only credential, and the code is deleted.

### 1.4 They lost the code, or forgot their password

Same thing, one action. There is no self-service reset for a username account,
because a reset mail would have to go to an address that cannot exist.

```bash
curl -s -X POST "$URL" \
  -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"action":"reissue-code","username":"ahmed.otaibi"}'
```

You get a fresh code with a fresh 14 days. Reissuing also clears the account's
failed-attempt counter, so a member who burned through ten wrong guesses can use
the new code immediately rather than waiting out a 15-minute lockout.

### 1.5 See who exists, and who has not claimed yet

```bash
curl -s -X POST "$URL" \
  -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"action":"list"}'
```

Each row carries `username`, `claimed`, `invite_expires_at`, `last_sign_in_at`
and `has_profile`. Anyone with `claimed: false` still has an outstanding invite.
`has_profile: false` means an auth user exists without the `profiles` row that
RLS keys off — they can sign in and will see nothing. Delete and re-create them.

### 1.6 Remove someone

```bash
curl -s -X POST "$URL" \
  -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"action":"delete","userId":"<their id from the list call>"}'
```

The function refuses to delete you, and refuses to delete the last remaining
admin. Their entries survive — `owner_id` and `created_by` are nullable, so the
work stays and the name goes.

> **If you get `403 Only the app admin can manage members`**, the address on your
> session is not in `ADMIN_EMAILS` inside
> `supabase/functions/admin-members/index.ts`. That list is the gate for member
> provisioning **only**, it is not the app's admin gate, and changing it means
> editing the file and redeploying the function (§4).

---

## 2. Rotate the Supabase management token

The token in `.env.supabase-admin` is a **personal access token** from your
Supabase account. It can do anything to any project you own, it is not scoped,
and the file's own header says to revoke it after release. Do that.

1. Go to <https://supabase.com/dashboard/account/tokens>.
2. **Revoke** the token named for this build (created 29 July 2026).
3. If you still need one, **Generate new token**, copy it once, and paste it into
   `/Users/aziz/Claude/opstrack/.env.supabase-admin` replacing the old value.
4. Confirm the file is still ignored by git — it must never be committed:

   ```bash
   cd /Users/aziz/Claude/opstrack && git check-ignore -v .env.supabase-admin
   ```

   That should print a line naming `.gitignore`. If it prints nothing, stop and
   fix `.gitignore` before doing anything else.

Nothing in the running app uses this token. Revoking it breaks only the
migration/automation tooling, never the live site.

**The other three keys, and what each one is:**

| Key | Where it lives | If it leaks |
| --- | --- | --- |
| **anon key** | The JS bundle, `.env`, and the `VITE_SUPABASE_ANON_KEY` GitHub secret | Nothing happens. It is public by design and grants exactly what RLS grants a signed-out visitor, which is nothing. See the README. |
| **service_role key** | Only in the edge functions' environment, injected by Supabase | Total compromise — it bypasses RLS entirely. Rotate it immediately from **Project Settings › API**, then redeploy both functions. Never put it in `.env`; Vite would inline it into the browser bundle. |
| **management PAT** | `.env.supabase-admin` only | Rotate as above. |

Rotating the **anon** key (only if you have to) is three steps: rotate in
**Project Settings › API**, update the `VITE_SUPABASE_ANON_KEY` repository secret
under **Settings › Secrets and variables › Actions**, then re-run the deploy
workflow. Vite bakes the key in at *build* time, so a secret change with no
rebuild changes nothing.

---

## 3. Recover a lost admin

**Symptom:** the admin screens are gone, or they render and every save fails with
"you do not have permission".

Nobody can fix this from inside the app, and that is deliberate. A trigger called
`guard_profile_role()` silently reverts any role change made by someone holding a
session who is not already an admin — the write reports success and the value
does not move. The two callers it lets through are the ones with no session at
all: the **SQL Editor** and the **service role**.

Open **Dashboard → SQL Editor** and run:

```sql
update public.profiles p
   set role = 'admin'
  from auth.users u
 where u.id = p.id
   and lower(u.email) = 'az.alsaloom@gmail.com';
```

Then confirm:

```sql
select u.email, p.role
  from public.profiles p
  join auth.users u on u.id = p.id
 order by p.role, u.email;
```

**Sign out and back in.** The role is read once per sign-in; an open tab keeps
the old answer.

If the update matched **no rows**, there is no `profiles` row for that address —
usually because the account has never signed in. Fix it in two statements:

```sql
-- 1. find the auth user
select id, email, created_at from auth.users order by created_at;

-- 2. create or repair the profile
insert into public.profiles (id, display_name, role, locale)
values ('<paste the uuid>', 'Aziz', 'admin', 'en')
on conflict (id) do update set role = 'admin';
```

Re-running the whole of `supabase/migrations/0002_config_foundation.sql` does the
same thing for that one address and is safe at any time — it prints a `NOTICE`
saying which of "promoted", "already an admin" or "no profile yet" happened.

**If there is no auth user either** (the account itself is gone):
**Authentication › Users › Add user**, enter the address, tick *Auto Confirm
User*, set a password you choose, then run the insert above with the new UUID.
Adding the user fires a trigger that writes `role = 'member'`, so the
`on conflict … do update` branch is what actually makes you an admin.

---

## 4. Deploy or redeploy an edge function

Two functions exist and both are live. You need this when you change
`ADMIN_EMAILS`, or after rotating the service_role key.

```bash
cd /Users/aziz/Claude/opstrack
export SUPABASE_ACCESS_TOKEN='<your management token>'
npx supabase functions deploy admin-members --project-ref lrysgpbkmuqgzsjesfkr --use-api
npx supabase functions deploy claim-account --project-ref lrysgpbkmuqgzsjesfkr --use-api
```

`--use-api` bundles server-side, so **Docker is not required** — that is the only
reason this one flag matters. There are no secrets to set: `SUPABASE_URL`,
`SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

Leave **Verify JWT ON** for both. `claim-account` is called by people who have no
session yet, and it works anyway because supabase-js sends the project's anon key
as the bearer token — which satisfies the gateway while keeping the endpoint
unreachable without an apikey. Turning verification off would expose it to the
open internet for no gain.

Check what is deployed:

```bash
npx supabase functions list --project-ref lrysgpbkmuqgzsjesfkr
```

---

## 5. Apply a migration

Supabase keeps **no ledger** of which files you have run — there is no
`schema_migrations` table on this project. So: check, run, verify.

### 5.1 What is applied right now

Paste this into the SQL Editor. Every row should say `yes`.

```sql
select '0001 core'        as file, case when to_regclass('public.entries')        is not null then 'yes' else 'NO' end as applied
union all select '0002 config',      case when to_regclass('public.config_audit')     is not null then 'yes' else 'NO' end
union all select '0003 vocab',       case when to_regclass('public.vocab_options')    is not null then 'yes' else 'NO' end
union all select '0004 workspace',   case when to_regclass('public.notifications')    is not null then 'yes' else 'NO' end
union all select '0006 track SLAs',  case when to_regclass('public.track_slas')       is not null then 'yes' else 'NO' end
union all select '0007 activity',    case when position('updated_by' in pg_get_functiondef('public.entries_touch()'::regprocedure)) > 0 then 'yes' else 'NO' end
union all select '0008 run-now',     case when exists (select 1 from pg_trigger where tgname = 'meeting_lines_guard_update_trg') then 'yes' else 'NO' end
union all select '0009 RLS/index',   case when to_regclass('public.entries_closed_idx') is not null then 'yes' else 'NO' end
order by file;
```

`0005` has no fingerprint on purpose: it is a one-time correction that clears the
SLA numbers 0003 used to seed, and it refuses to act if you have since chosen
your own. Running it again on a workspace with armed SLAs does nothing.

### 5.2 Running one

**Dashboard → SQL Editor → paste the whole file → Run.** One file at a time, in
numeric order, and read the output.

Every file in `supabase/migrations/` is written to be run twice: `create table if
not exists`, `drop policy if exists` before every `create policy`, `create or
replace` on every function, and seeds that match nothing on a second pass. If a
file errors halfway, the fix is **correct the statement and re-run the whole
file**, not a hand-repair of the half that landed.

Several files end in a **self-verifying probe** that raises an exception on
purpose if the migration did not achieve what it claims — `0006` checks that its
new join did not change the row count of `v_entry_health`, `0008` runs a fake
template through "Run now" twice, `0009` re-reads every policy. A probe failure
means the migration did **not** take. Re-read the error, fix, re-run.

One hazard that is real on a populated database: a file that drops a named
constraint and re-adds it leaves the table **without** that constraint if the
re-add fails on existing data. Check the data first if a `23514` appears.

### 5.3 After

Nothing in the app needs redeploying — migrations change the database, not the
bundle. But **hard-refresh** the app (⇧⌘R) so cached config and vocabulary
re-read.

---

## 6. Roll back a bad deploy

The site is a static build published by GitHub Actions from `main`. Two ways
back, in order of preference.

### 6.1 Re-publish the last good build (about a minute)

```bash
cd /Users/aziz/Claude/opstrack
gh run list --limit 10
gh run rerun <the id of the last good run>
gh run watch
```

Re-running a workflow checks out **that run's commit** and publishes it again, so
the live site returns to exactly what it was. It does not touch `main`, which
means the bad commit is still there and the next push will re-deploy it — this
buys you time, it is not the fix.

### 6.2 Undo the commit (the actual fix)

```bash
cd /Users/aziz/Claude/opstrack
git log --oneline -5
git revert <bad sha>          # writes a new commit that undoes it
git push
gh run watch
```

The workflow lints, runs the full test suite, checks that both Supabase secrets
are present, and only then builds and deploys. A red suite stops the deploy
before it starts, which is why a broken build almost never reaches the site.

### 6.3 If the deploy itself is stuck

The workflow's concurrency group never cancels a run in flight, precisely because
cancelling inside `deploy-pages` can wedge the Pages lock and break the *next*
push. If a run is genuinely hung, wait for it to time out rather than cancelling
it, then push again.

### 6.4 What a rollback cannot undo

**Migrations.** Reverting the app does not revert the database. If the bad
release included a migration, work out what that file changed and write the
inverse by hand — and check `config_audit` (§7) first to see what configuration
moved while the bad build was live.

---

## 7. Read the audit log

Every track, vocabulary and SLA change writes a row to `config_audit` with who
did it and full before/after images of the row. There is no screen for it; it is
a SQL Editor query. Whole rows are stored on purpose, so the log still reads
"Deleted Network (#06b6d4)" after the track itself is gone.

**The last fifty changes, in English:**

```sql
select a.created_at,
       coalesce(p.display_name, '(system)') as who,
       a.table_name,
       a.action,
       coalesce(a.after ->> 'name', a.after ->> 'key',
                a.before ->> 'name', a.before ->> 'key') as what
  from public.config_audit a
  left join public.profiles p on p.id = a.actor_id
 order by a.created_at desc
 limit 50;
```

**Everything that happened to one track, including its SLA overrides:**

```sql
select created_at, table_name, action, before, after
  from public.config_audit
 where row_id = (select id from public.tracks where name = 'Network')
 order by created_at;
```

`track_slas` rows record the **track** id in `row_id`, not the override's own id,
so that query returns one track's whole SLA history alongside its renames.

**Who has been changing things this week:**

```sql
select coalesce(p.display_name, '(system)') as who, a.table_name, count(*)
  from public.config_audit a
  left join public.profiles p on p.id = a.actor_id
 where a.created_at > now() - interval '7 days'
 group by 1, 2
 order by 3 desc;
```

The table is append-only and enforced as such: it has a SELECT policy and no
INSERT, UPDATE or DELETE policy, which under RLS denies those to everyone. Never
add `force row level security` to it — the rows are written by a `SECURITY
DEFINER` function that depends on the owner being exempt, and forcing RLS would
turn every audited track edit into a failure.

---

## 8. When the sign-in mail misbehaves

Mail only matters for **your** account. Members sign in with a username and
password and never touch email at all — so "nobody can sign in" and "the mail is
broken" are different incidents.

### 8.1 First: you don't need the mail

Your account has a password. Type your address and your password on the sign-in
screen and press **Sign in**. The magic link is the *alternative*, not the
primary path. If you don't know your password, set one: **Authentication › Users
→ your row → Edit user → set a password**. Do that yourself; don't dictate it to
anyone.

### 8.2 "Too many requests" / the second mail never arrives

This is the usual one and it is not a fault. The project uses Supabase's built-in
mailer, which is capped at **two emails per hour, project-wide**. The third
request in an hour is refused and the app shows a rate-limit message.

Wait it out, or use your password. Confirm the cap if you want to:

```bash
curl -s "https://api.supabase.com/v1/projects/lrysgpbkmuqgzsjesfkr/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" | python3 -m json.tool | grep -i rate_limit_email
```

### 8.3 The mail arrives but there is no six-digit code in it

Correct, and expected. The free tier **refuses email-template changes**, so the
mail Supabase sends is always the stock magic *link* and never renders the
`{{ .Token }}` code. The sign-in screen therefore says "check your email and open
the link". The "enter a code instead" disclosure is wired and works — it is just
waiting for the day a custom SMTP provider makes the code visible in the mail.

Do not spend an afternoon trying to edit the Magic Link template. It is a plan
limitation, not a setting you have missed.

### 8.4 The link opens the app and nothing happens

The link always lands on **`https://abosallom.github.io/opstrack/`**, because the
app doesn't pass a redirect and Supabase falls back to the project's Site URL. So:

- **A link opened on a phone signs you in on that phone**, not on the laptop that
  requested it. That is how magic links work, not a bug.
- **Running locally, the link will not sign you into `localhost`.** Use your
  password for local development.
- Links expire in **10 minutes** and work once.

If the link opens the app and bounces you back to the sign-in screen, the tokens
were consumed already (a mail scanner in your organisation pre-fetching the link
does this). Request a fresh one, or use your password.

### 8.5 "No account with that email"

The address has no account. Signups are disabled project-wide, so Supabase
answers an unknown address with "signups not allowed" and the app translates that
into the honest sentence. Check the spelling first; then check the list (§1.5).

### 8.6 A member says their password stopped working

They are almost certainly typing a username that doesn't exist, or the wrong
password — the app deliberately gives the same message for both, so that the form
cannot be used to discover who has an account. Reissue their invite code (§1.4);
that is the reset.

---

## 9. Something is wrong and you don't know what

Run these five, in order. Each one rules out a layer.

```sql
-- 1. Is anyone an admin?
select u.email, p.role from public.profiles p
  join auth.users u on u.id = p.id order by p.role, u.email;

-- 2. Is RLS still on everywhere? Every row must say true.
select relname, relrowsecurity from pg_class
 where relnamespace = 'public'::regnamespace and relkind = 'r' order by relname;

-- 3. Is there somewhere to file work? At least one row must be active.
select name, archived from public.tracks order by sort_order;

-- 4. Did the nightly recurring job run?
select jobname, status, start_time, return_message
  from cron.job_run_details d join cron.job j using (jobid)
 order by start_time desc limit 5;

-- 5. What changed recently? (§7 for the readable version)
select created_at, table_name, action from public.config_audit
 order by created_at desc limit 20;
```

Then the app side:

```bash
cd /Users/aziz/Claude/opstrack
gh run list --limit 5      # did the last deploy pass?
npm run test               # does the suite still pass locally?
```

**A note on the nightly job.** `materialize_due_recurring()` is scheduled in
Postgres by pg_cron at **03:15 UTC daily** — it is installed and running on this
project, verified. The app also calls the same function once per sign-in as a
safety net. Both running is harmless: a unique index on
`(template_id, due_date)` absorbs the duplicate. If query 4 above returns nothing
at all, the schedule is missing; re-running `0001_opstrack_core.sql` restores it,
and the app's own call keeps recurring entries appearing in the meantime.

---

## 10. Where the reasoning lives

This page tells you *what to do*. When you want to know *why it is like that*:

- **[`README.md`](../README.md)** — setting the project up from nothing, and why
  shipping the anon key is safe.
- **[`ADMIN.md`](../ADMIN.md)** — what an admin can and cannot change, how SLAs
  resolve, what widening a frozen list actually costs, and the three behaviours
  that surprise people.
- **[`docs/EXECUTION-PLAN.md`](EXECUTION-PLAN.md)** and the wave notes beside it —
  the build record. Later files win over earlier ones.
- The migrations themselves. Every one opens with a plain-English account of what
  was wrong and what it changes; `0007` and `0008` in particular read as incident
  reports.
