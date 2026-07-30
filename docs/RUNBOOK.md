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

**The normal way is in the app: Settings › Team members.** Create the account,
copy the invite code it shows once, hand it over. That screen calls the
`admin-members` edge function for you, which is the only way an account comes into
existence — signups are off project-wide.

**The rest of this section is the same operations by hand**, with `curl`. Use it
when the app is the thing that is broken, when you need to script something, or
when you want to see exactly what the screen is sending. Everything below and the
Team members screen are the same endpoint; neither can do anything the other
cannot.

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
- **`role`** is `member` or `admin`. An `admin` can edit tracks and vocabulary
  **and** provision members — the function looks the caller's `profiles.role` up
  with the service role, so a second admin is a full admin. The `ADMIN_EMAILS`
  list inside the function is a bootstrap door for when the database cannot answer,
  not the gate. Use `{"action":"set-role","userId":"…","role":"admin"}` to change
  someone afterwards; it refuses to demote you, the last admin, or the bootstrap
  address.

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

You get a fresh code with a fresh 14 days, and two side effects that are both
deliberate:

- **The account is un-claimed.** Until the new code is redeemed, the old password
  does not work. A reissue is a *reset*, not a spare key — if it left the old
  password working, "I forgot my password" would have no answer.
- **That username's failed-guess counter is cleared**, so the member can use the
  new code immediately. Your remedy is "here is a new code, try again", and it has
  to work the moment you say it. The caller's *address* counter is untouched: a
  reissue must not hand a machine that has been spraying guesses a free reset.

Nobody is ever locked out by failed guesses, incidentally. Wrong codes buy a
capped delay (two free, then a quarter second doubling to four seconds, in a
rolling 15-minute window), never a refusal — so a member holding a real code
always gets in, however many times someone has guessed at their username.

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

### 1.7 Promote or demote someone

```bash
curl -s -X POST "$URL" \
  -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"action":"set-role","userId":"<their id>","role":"admin"}'
```

An admin promoted this way is a full admin, provisioning included. **They must
sign out and back in** — the role is read once per sign-in, so an open tab shows
member chrome while the server accepts admin writes, which reads as a failed
promotion when it is a stale session.

Three refusals, all guarding against a workspace with no admins left, which cannot
create another account and so cannot be fixed from inside the app: no demoting
yourself (`self_demote`), no demoting the last admin (`last_admin`), no demoting
the bootstrap address (`bootstrap_admin`).

### 1.8 The errors you will actually see

Every response carries a machine-readable `code` alongside the English prose. The
prose is for you and the logs; the app maps the `code` to a translated message.

| `code` | Means | Do |
| --- | --- | --- |
| `not_signed_in` | the token expired — it lasts about an hour | re-copy it, §1.1 |
| `forbidden` | your session is neither `profiles.role = 'admin'` nor in the function's bootstrap list | promote yourself (`ADMIN.md` → *Recovery*), or add the address and redeploy (§4) |
| `username_taken` | that username exists, claimed or not | pick another, or `delete` first |
| `no_pepper` | `INVITE_PEPPER` is not set on the project, so the function refuses to mint an invite rather than store a weaker digest | §4.1 |
| `last_admin` / `self_demote` / `bootstrap_admin` | the three role guards, §1.7 | |
| `not_found` | no such `userId` | re-run `list`; the id is `auth.users.id` |

A cold start is not an error. The first call after a deploy fetches the Supabase
client library and can take a few seconds or time out once — call it again.

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

Three functions exist and all three are live. You need this after editing any of
them, after changing `ADMIN_EMAILS`, or after rotating the service_role key.

| Function | What it does | Extra secrets it needs |
| --- | --- | --- |
| `admin-members` | list · create · delete · reissue-code · set-role | `INVITE_PEPPER` |
| `claim-account` | redeems an invite code, sets the member's password | `INVITE_PEPPER` (+ `INVITE_PEPPER_PREVIOUS` while rotating) |
| `send-push` | drains `push_outbox` and sends Web Push | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `PUSH_DRAIN_SECRET` |

```bash
cd /Users/aziz/Claude/opstrack
export SUPABASE_ACCESS_TOKEN='<your management token>'
npx supabase functions deploy admin-members --project-ref lrysgpbkmuqgzsjesfkr --use-api
npx supabase functions deploy claim-account --project-ref lrysgpbkmuqgzsjesfkr --use-api
npx supabase functions deploy send-push     --project-ref lrysgpbkmuqgzsjesfkr --use-api
```

`--use-api` bundles server-side, so **Docker is not required** — that is the only
reason this one flag matters, and it is why this is the single documented deploy
path. `supabase link` is not needed and asks for a database password nothing here
uses.

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected
automatically. The ones in the table above are not — see §4.1.

Leave **Verify JWT ON** for all three. `claim-account` is called by people who
have no session yet, and it works anyway because supabase-js sends the project's
anon key as the bearer token — which satisfies the gateway while keeping the
endpoint unreachable without an apikey. `send-push` is called by the database with
the same anon key and gates on its own `x-push-drain` header instead. Turning
verification off would expose all three to the open internet for no gain.

**Invoke each one twice after deploying**, and read both answers. The first call
fetches the Supabase client library and can take a few seconds or time out once;
that is a cold start, not a failure. This matters more here than anywhere else in
the repo: `.oxlintrc.json` ignores `supabase/functions` and `tsconfig.app.json` is
`src`-only, so **nothing type-checks these three files** and a successful
invocation is the only proof the deploy is sound. A fix that sits in the repo
un-deployed is not live.

Check what is deployed, and when:

```bash
npx supabase functions list --project-ref lrysgpbkmuqgzsjesfkr
```

It prints JSON, one object per function. `version` increments on every deploy and
`updated_at` is epoch milliseconds — compare it against your last commit's
timestamp. If you edited a function and those numbers did not move, you are
running the old code.

### 4.1 Function secrets

**Dashboard → Edge Functions → Secrets**, or
`npx supabase secrets set NAME=value --project-ref lrysgpbkmuqgzsjesfkr`. They are
per-project, shared by all three functions, and injected as environment variables.
None of them belongs in `.env`, in the repo, or in the database.

| Secret | Used by | If it is missing |
| --- | --- | --- |
| `INVITE_PEPPER` | `admin-members`, `claim-account` | `admin-members` **refuses to mint an invite** and answers `no_pepper`; existing invites stop verifying |
| `INVITE_PEPPER_PREVIOUS` | `claim-account` | only needed *during* a rotation; absent is normal |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | `send-push` | pushes fail to sign; `push_outbox` rows retry and eventually abandon |
| `PUSH_DRAIN_SECRET` | `send-push` | every drain request is rejected; must match `private.push_config.drain_secret` (§9.3) |

**`INVITE_PEPPER` is what makes a stolen invite digest worthless.** The code
itself is never stored — `user_metadata` holds `HMAC-SHA256(pepper,
"username:CODE")` and the database never holds the pepper, so a full dump of
`auth.users` is not enough to recover anyone's code. Before this existed the digest
was a bare SHA-256 over 40 known-format bits, which is about a minute of GPU per
account.

Generate one once, from something with real entropy, and never print it into a
shell history you keep:

```bash
openssl rand -base64 48
```

**Rotating it** is a two-step, and doing it in one step invalidates every
outstanding invite:

1. Set `INVITE_PEPPER_PREVIOUS` to the current value, then set `INVITE_PEPPER` to
   the new one. Redeploy both `admin-members` and `claim-account`.
   `claim-account` tries the current pepper, then the previous one, so codes
   issued before the rotation still redeem.
2. After the longest outstanding invite has expired — **14 days** is the ceiling —
   remove `INVITE_PEPPER_PREVIOUS` and redeploy `claim-account` again.

Codes minted before the pepper existed at all carry no `invite_alg` tag, and
`claim-account` will try an unpeppered SHA-256 for exactly those. Tagged digests
never fall back, so the legacy path cannot be used to downgrade a current invite.
Once every pre-pepper invite has expired or been redeemed, that path is dead
weight and can be deleted.

### 4.2 The VAPID keypair — generating and rotating it

This is the debt §9.3 recorded as owed. The keypair is what a push service uses to
verify that a message claiming to come from OpsTrack really did.

**It is one P-256 keypair, split across two homes:**

| Half | Where it lives | Secret? |
| --- | --- | --- |
| private (32-byte scalar, base64url) | `VAPID_PRIVATE_KEY` function secret, and nowhere else | **yes** — it is the whole authority |
| public (65-byte point, base64url) | `DEFAULT_VAPID_PUBLIC_KEY` in `src/lib/push.ts`, overridable by `VITE_VAPID_PUBLIC_KEY` | no — it ships in the browser bundle by design |

The public half is compiled in rather than left to the environment on purpose: the
GitHub Pages workflow injects only `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY`, so a key that lived only in the environment would be
empty in production and push would be quietly unavailable there.

**Generate a pair** (node 18+; no dependency, and the private half never reaches
the terminal):

```bash
node - "$PWD/vapid.private" <<'EOF'
import { writeFileSync } from 'node:fs'
const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign','verify'])
const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))
writeFileSync(process.argv[2], (await crypto.subtle.exportKey('jwk', kp.privateKey)).d, { mode: 0o600 })
console.log(Buffer.from(pub).toString('base64url'))   // the PUBLIC half, printed
EOF
```

The printed string is the public key. `vapid.private` holds the private one; set
the secret from the file and then destroy it:

```bash
npx supabase secrets set VAPID_PRIVATE_KEY="$(cat vapid.private)" \
  VAPID_PUBLIC_KEY='<the printed public key>' \
  VAPID_SUBJECT='mailto:az.alsaloom@gmail.com' \
  --project-ref lrysgpbkmuqgzsjesfkr
rm -P vapid.private        # -P overwrites before unlinking
```

`VAPID_SUBJECT` must be a `mailto:` or `https:` URL that reaches a human. It is
not decoration: push services use it to contact the sender before blocking an
origin that misbehaves.

Then paste the public key into `DEFAULT_VAPID_PUBLIC_KEY` in `src/lib/push.ts`,
commit, and let the deploy run. `src/lib/push.test.ts` asserts the constant decodes
to 65 bytes starting `0x04`, so a truncated or mis-encoded paste fails the build
rather than failing at every user's subscribe call.

**Rotating is not free, and there is no overlap window.** A subscription is bound
to the key it was created with, so the moment the private half changes, every
existing subscription is undeliverable — the push service answers 403 and the queue
retries until it abandons. Rotate only for a suspected compromise, and expect:

1. Set both secrets and redeploy `send-push` (§4).
2. Update the constant and deploy the app.
3. **Every device must visit Settings → Push notifications and turn it off and on
   again.** Nothing can do this for them; the browser will not re-key a
   subscription. Tell people first.
4. Clear the stale rows so the queue stops retrying them:
   `delete from public.push_subscriptions;`

If you only need to change `VAPID_SUBJECT`, that is a secret change and a
redeploy, with no client impact at all.

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
union all select '0010 claim ctrs',  case when to_regclass('public.claim_counters')     is not null then 'yes' else 'NO' end
union all select '0011 web push',    case when to_regclass('public.push_outbox')        is not null then 'yes' else 'NO' end
order by file;
```

Verified against the live project on 30 July 2026: all ten rows returned `yes`.

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
that is the reset, and there is no other one.

Warn them of the one sharp edge before you send the code: **reissuing un-claims
the account**, so their old password stops working the moment you do it. If they
turn out to have remembered it after all, they still have to redeem the new code
before they can get in.

---

## 9. Something is wrong and you don't know what

### 9.1 The five queries

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

### 9.2 Then the app side

```bash
cd /Users/aziz/Claude/opstrack
gh run list --limit 5      # did the last deploy pass?
npm run test               # does the suite still pass locally?
```

**A note on the nightly job.** `materialize_due_recurring()` is scheduled in
Postgres by pg_cron at **03:15 UTC daily** — it is installed and running on this
project, verified: the most recent run at the time of writing succeeded at
`03:15:00Z` and returned `1 row`. The app also calls the same function once per
sign-in as a safety net. Both running is harmless: a unique index on
`(template_id, due_date)` absorbs the duplicate. If query 4 above returns nothing
at all, the schedule is missing; re-running `0001_opstrack_core.sql` restores it,
and the app's own call keeps recurring entries appearing in the meantime.

### 9.3 Push notifications are not arriving

Push has more moving parts than anything else here, so work down the list — each
step rules out one of them. `0011` created the queue but deliberately did **not**
insert its config row, because that row holds a secret and secrets are not
committed.

**1. Is the config row there?** `drain_push_queue()` degrades to a `warning` and
sends nothing while it is missing, which is silent from the app's side.

```sql
select id, function_url, updated_at,
       length(anon_key)     as anon_key_len,
       length(drain_secret) as drain_secret_len
  from private.push_config;
```

One row, both lengths non-zero. If it is empty, insert it — the `drain_secret`
must be **byte-identical** to the `PUSH_DRAIN_SECRET` function secret (§4.1), or
every drain is rejected:

```sql
insert into private.push_config (function_url, anon_key, drain_secret)
values ('https://lrysgpbkmuqgzsjesfkr.supabase.co/functions/v1/send-push',
        '<the project anon key>',
        '<the same value as the PUSH_DRAIN_SECRET function secret>')
on conflict (id) do update
   set function_url = excluded.function_url,
       anon_key     = excluded.anon_key,
       drain_secret = excluded.drain_secret,
       updated_at   = now();
```

The anon key here is the public one that already ships in the browser bundle;
`private.push_config` is revoked from `anon` and `authenticated` and the schema
itself is revoked too, so nothing reachable with that key can read it back.

**2. Is anything queued, and is it being sent or abandoned?**

```sql
select count(*) filter (where sent_at is not null)      as sent,
       count(*) filter (where abandoned_at is not null) as abandoned,
       count(*) filter (where sent_at is null and abandoned_at is null) as pending
  from public.push_outbox;
```

`pending` climbing while `sent` stays flat means the sender is not running or is
being refused. `abandoned` climbing means it ran and the push service rejected the
message — usually expired subscriptions, which is normal churn, or a VAPID key
mismatch, which is not.

**3. Is the drain scheduled?** The trigger's wake-up is best-effort; the cron job
is the one that guarantees delivery.

```sql
select j.jobname, d.status, d.start_time, d.return_message
  from cron.job j left join cron.job_run_details d using (jobid)
 where j.jobname in ('opstrack-drain-push', 'opstrack-materialize-recurring')
 order by d.start_time desc limit 10;
```

**4. Does the device still have a subscription?** A subscription is per browser
per VAPID key, so rotating the VAPID keypair invalidates every existing one and
each device has to re-subscribe.

```sql
select p.display_name, s.created_at, left(s.endpoint, 40) || '…' as endpoint
  from public.push_subscriptions s
  join public.profiles p on p.id = s.user_id
 order by s.created_at desc;
```

**5. Then check the obvious things at the device.** Notifications must be allowed
for the origin; on iOS the app must be **installed to the home screen** (Safari in
a tab cannot receive Web Push at all); and a notification you have already read in
another tab will not be re-delivered.

Generating and rotating the VAPID keypair — the item this section previously
recorded as owed — is now **§4.2**.

### 9.4 What push has already been proven to do, and the one part it has not

Written by the worker who built it, on **2026-07-30**, against the live project.
The distinction matters when you are diagnosing: most of this chain has been
exercised for real, so a failure is probably in the part that has not.

**Proven live, headlessly:**

| Link | How | Result |
| --- | --- | --- |
| The encryption is RFC-conformant | `encryptPayload()` replayed against the worked example in **RFC 8291 §5** (fixed keys, fixed salt, published expected body) | byte-identical **match** |
| The encryption is self-consistent | encrypt with a random salt, decrypt with the UA private key | round-trip match |
| The VAPID token is a valid ES256 JWS | signature verified against the public key; `aud` is the endpoint's origin; `exp` 12 h | verifies |
| Three real push services accept the token and the body | POST to FCM, Mozilla autopush and Apple with a **nonexistent** subscription | FCM `410`, Mozilla `404`, Apple `400 BadWebPushToken` — all three rejected only the fake registration, none rejected the JWT (that would be `401`/`403`/`BadJwtToken`) or the body (`400` with no reason) |
| Trigger → queue → wake-up → sender | one synthetic `notifications` row inserted; `pg_net` response recorded | `200 {"ok":true,"claimed":1,"sent":1,"suppressed":0,"pruned":2}` |
| Dead subscriptions are pruned, not retried forever | same run, two fake endpoints | both rows deleted, `push_outbox.last_error` = `410 push subscription has unsubscribed or expired.` |
| The auth gates | four requests to `send-push` | no `x-push-drain` → `403`; wrong secret → `403`; no project key → `401` at the gateway; correct → `200` |
| The client's data path under RLS | every query `store/push.ts` makes, executed as the `authenticated` role with a member's JWT claims, in a rolled-back transaction | own rows only; the takeover RPC moved a shared endpoint; a second upsert did not duplicate; `claim_push_batch` and `settle_push` **refused**; `push_outbox` invisible |

All probe rows were removed afterwards; `push_subscriptions`, `push_outbox` and
`notification_prefs` were left at 0.

**NOT proven, and it cannot be from a terminal:** a real browser subscription
being decrypted and displayed. That needs a device where a human grants the
notification permission, and the private key of that subscription never leaves
that device — which is the entire point of RFC 8291. Everything up to the push
service is verified; the last hop is the browser's own decryption, and it is
exercised by the manual pass below.

**The manual verification, in full. 5 minutes, one phone, one laptop.**

1. On a **laptop** (Chrome or Firefox), sign in and open **Settings → Push
   notifications**. The card reads "Before you turn this on". Press **Turn on for
   this device** and accept the browser's prompt. The card flips to a green "On for
   this device" pill and a **Registered devices** list appears with one row marked
   "This device".
2. Confirm the row reached the database:
   ```sql
   select p.display_name, s.user_agent, left(s.endpoint, 45) || '…'
     from public.push_subscriptions s join public.profiles p on p.id = s.user_id;
   ```
3. **Close the tab entirely** — the point of a push is that nothing is open.
4. From a **second account** (or the SQL editor as another member), assign an
   entry to the first account. Either edit an entry's owner in the app, or:
   ```sql
   update public.entries set owner_id = '<the first account''s uuid>'
    where id = '<some entry uuid>';
   ```
5. **Within about two seconds** an OS notification appears on the laptop, titled
   *Assigned to you* with the same sentence the inbox shows — the actor's name and
   the entry's title. Click it: the browser focuses (or opens) OpsTrack **on that
   entry**.
6. Prove which of the two drains delivered it:
   ```sql
   select id, attempts, sent_at, last_error from public.push_outbox
    order by id desc limit 3;
   ```
   `attempts = 1` and a `sent_at` within a second or two of `created_at` means the
   **trigger's wake-up** did it. A `sent_at` up to a minute later means the **cron
   drain** did — both are correct, and knowing which one ran tells you whether
   `pg_net` is working.
7. **The preference switches.** Turn **Assigned to me** off, repeat step 4. No
   notification arrives, and the new `push_outbox` row is still marked `sent_at`
   with no error — suppression is a completed obligation, not a failure. The inbox
   bell still increments, which is the fallback the UI promises. Turn it back on.
8. **iOS, and do this one separately.** In Safari on the phone, Settings → Push
   notifications shows *"Add OpsTrack to your Home Screen first"* — Safari in a tab
   cannot receive Web Push at all, and that card is the app telling the truth rather
   than a broken switch. Install it (Share → Add to Home Screen), open it **from the
   Home Screen**, and the same screen now offers the enable button. Then repeat
   steps 3–5 with the phone locked.
9. **Sign out on the laptop and check the row is gone.** Sign-out unsubscribes the
   browser and deletes the row, so the next person to use that machine cannot
   receive the previous user's notifications:
   ```sql
   select count(*) from public.push_subscriptions;
   ```
   This step depends on `resetPush()` being called from the shell's sign-out
   teardown in `src/App.tsx`, beside `resetNotifications()`. If the count does not
   drop, that call is missing — the subscription is still valid and the previous
   user keeps receiving pushes on a machine somebody else is now using, so treat a
   failure here as a blocker rather than a cosmetic gap.

If step 5 produces nothing, work §9.3 from the top — the config row is the most
common cause, and it is silent.

---

## 10. Where the reasoning lives

This page tells you *what to do*. When you want to know *why it is like that*:

- **[`README.md`](../README.md)** — setting the project up from nothing, and why
  shipping the anon key is safe.
- **[`ADMIN.md`](../ADMIN.md)** — what an admin can and cannot change, who can
  provision members and why that is a separate question, the full username /
  invite / claim lifecycle, how SLAs resolve, what widening a frozen list actually
  costs, and the three behaviours that surprise people.
- **[`docs/FIX-BACKLOG.md`](FIX-BACKLOG.md)** — every audit finding with a
  disposition: fixed in which commit, still open, or declined and why. Read this
  before concluding that something is a new bug.
- **[`docs/EVIDENCE/`](EVIDENCE/)** — proof ledgers. Claims about the *running*
  project live here with the artifact that establishes them, because a sentence
  in a commit message is not re-checkable a week later.
- **[`docs/EXECUTION-PLAN.md`](EXECUTION-PLAN.md)** and the wave notes beside it —
  the build record. Later files win over earlier ones.
- The migrations themselves. Every one opens with a plain-English account of what
  was wrong and what it changes; `0007` and `0008` in particular read as incident
  reports.
