# CoreTrack — runbook

The things you will actually have to do, written for you rather than for a
developer. Every procedure below was re-verified against the live project on
**30 July 2026**; where a claim depends on something that can drift, there is a
query you can run to check it yourself instead of trusting this page.

Nothing here needs the app to be working. Every recovery path ends in the
Supabase Dashboard or the GitHub Actions tab, both of which stay reachable when
CoreTrack does not.

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
- **Treat a username as semi-public. Do not encode anything sensitive in one.**
  Not a national ID, not an employee number you would not print, not a phone
  number, not a contractor's client name, not "ceo.pa" if who assists whom is
  something you would rather not publish. Three reasons, and only the third is
  subtle: the username is printed beside the person on **Settings › Team
  members**, its owner types it in front of whoever is standing there at every
  sign-in, and — the one that surprises people — an outsider holding nothing but
  the public anon key from the app bundle can ask Supabase's own password-recovery
  endpoint whether a given username exists, and get an answer. That last one is a
  platform behaviour we cannot switch off without giving up your emailed sign-in
  link; it was found, escalated and **accepted** on 31 July 2026 (`S5-1` in
  [`FIX-BACKLOG.md`](FIX-BACKLOG.md)) precisely because a username was never
  meant to be a secret here. The invite **code** is the secret. Names of the
  `ahmed.otaibi` / `it-ops` shape are exactly right; keep it to that.
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

Only an **HMAC-SHA-256** of `username:CODE` is stored, keyed by the
`INVITE_PEPPER` function secret that the database never holds (§4.1) — so a dump
of `user_metadata` is worth nothing on its own. There is no "show it again": the
workspace genuinely cannot recover the code, only replace it. If you lose it, you
reissue (§1.4).

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
| **anon key** | The JS bundle, `.env`, and the `VITE_SUPABASE_ANON_KEY` GitHub secret | Against the **database**, nothing happens: it is public by design and grants exactly what RLS grants a signed-out visitor, which is nothing. It does reach Supabase's own auth endpoints, which no policy of ours governs — one of them will confirm whether a username exists (`S5-1`, accepted; §1.2). Rotating it does not change that, because the new key is just as public. See the README. |
| **service_role key** | Only in the edge functions' environment, injected by Supabase | Total compromise — it bypasses RLS entirely. Rotate it immediately from **Project Settings › API**, then redeploy **all three** functions (§4). Never put it in `.env`; Vite would inline it into the browser bundle. |
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
verify that a message claiming to come from CoreTrack really did.

**It is one P-256 keypair, split across two homes:**

| Half | Where it lives | Secret? |
| --- | --- | --- |
| private (32-byte scalar, base64url) | `VAPID_PRIVATE_KEY` function secret, and nowhere else | **yes** — it is the whole authority |
| public (65-byte point, base64url) | `DEFAULT_VAPID_PUBLIC_KEY` in `src/lib/push.ts`, overridable by `VITE_VAPID_PUBLIC_KEY` | no — it ships in the browser bundle by design |

The public half is **compiled in with an environment override**, and the order
matters: a key that lived only in the environment would be empty in any build that
forgot to pass it, and push would be quietly unavailable rather than loudly broken.
So `DEFAULT_VAPID_PUBLIC_KEY` always works, and `VITE_VAPID_PUBLIC_KEY` wins when
it is set.

The override is wired through the deploy workflow, so **rotating does not need a
source edit** — see "Rotating" below. Measured on this repo: building with
`VITE_VAPID_PUBLIC_KEY` set puts that key in `dist/assets/*.js` and drops the
constant from the bundle entirely; building without it puts the constant there and
nothing else. Vite inlines `import.meta.env.*` as a literal, so the `|| DEFAULT`
fallback is folded away at build time rather than evaluated at runtime.

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

Then get the public key to the client. **The routine way is a GitHub secret, not a
source edit:**

```bash
gh secret set VITE_VAPID_PUBLIC_KEY --repo Abosallom/opstrack --body '<the printed public key>'
gh workflow run deploy.yml --repo Abosallom/opstrack     # or just push
```

`.github/workflows/deploy.yml` passes it into `npm run build`; Vite inlines it and
the compiled-in constant disappears from the bundle. It is **not** in the
workflow's required-secrets check, because unset is the normal state — so removing
the secret is also how you revert to the compiled-in key.

Editing `DEFAULT_VAPID_PUBLIC_KEY` in `src/lib/push.ts` is the other way, and it is
the right one when the new key is meant to be the permanent default rather than an
override. `src/lib/push.test.ts` asserts the constant decodes to 65 bytes starting
`0x04`, so a truncated or mis-encoded paste fails the build rather than failing at
every user's subscribe call. That test does **not** see the environment override —
a mis-pasted secret is caught by the check in §9.3 instead, so run it after a
rotation.

**Rotating is not free, and there is no overlap window.** A subscription is bound
to the key it was created with, so the moment the private half changes, every
existing subscription is undeliverable — the push service answers 403 and the queue
retries until it abandons. Rotate only for a suspected compromise, and expect:

1. Set all three secrets and redeploy `send-push` (§4).
2. `gh secret set VITE_VAPID_PUBLIC_KEY` and re-run the deploy (above). Confirm
   the new key actually shipped:
   `curl -s https://abosallom.github.io/opstrack/ | grep -o 'assets/index-[^"]*\.js'`
   then `curl -s https://abosallom.github.io/opstrack/assets/index-….js | grep -c '<the new public key>'` → `1`.
3. Confirm the two halves agree, without printing either — §9.3, check 6.
4. **Every device must visit Settings → Push notifications and turn it off and on
   again.** Nothing can do this for them; the browser will not re-key a
   subscription. Tell people first.
5. Clear the stale rows so the queue stops retrying them:
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
union all select '0012 owner name',  case when exists (select 1 from pg_trigger where tgname = 'profiles_preserve_owner_name') then 'yes' else 'NO' end
union all select '0013 usernames',   case when to_regprocedure('public.member_directory()') is not null then 'yes' else 'NO' end
order by file;
```

Verified against the live project on 30 July 2026: the first ten rows returned
`yes`. **Re-verified 31 July 2026 with `0012` and `0013` added: all twelve `yes`.**
Both new files were applied twice that day, probes passing on both runs.

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
template through "Run now" twice, `0009` re-reads every policy, `0012` deletes a
throwaway account three different ways and checks the credit and the clocks
afterwards, `0013` proves its function is unreadable by `anon` and complete for a
member. A probe failure means the migration did **not** take. Re-read the error,
fix, re-run.

The probes in `0012` and `0013` create their own fixtures and discard them by
raising a sentinel exception inside a subtransaction, so they touch no real row
and leave nothing behind — that is why they are safe to re-run on a live
workspace, and why "run it twice" is the standing check rather than a risk.

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

**`v1.0.0` is the anchor when "the last good run" is not obvious.** The tag marks
the commit that passed the full release smoke
([`docs/EVIDENCE/wave5-release-smoke.md`](EVIDENCE/wave5-release-smoke.md)), so
`gh run list --limit 20 --json headSha,databaseId,conclusion` and then re-running
the run whose `headSha` is `git rev-list -n1 v1.0.0` puts the site back on a build
that is known to work rather than one that merely went green in CI. Later releases
should carry their own tag for the same reason.

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

Yes, this message tells a stranger whether an address has an account — the same
property `S5-1` records for usernames, and accepted for the same reason (§1.2).
The alternative is a sign-in screen that lies to the one person who typed their
own address correctly, and the address was never the secret.

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

**6. Do the two halves of the VAPID key agree?** This is the failure with no
symptom other than `abandoned` climbing, and nothing at runtime can check it: the
client's half is in the bundle, the function's half is a secret. The Management API
answers `GET /v1/projects/<ref>/secrets` with the **SHA-256 hex digest** of every
secret value rather than the value, which is exactly enough to compare without
handling either key.

```bash
cd /Users/aziz/Claude/opstrack
set -a; . ./.env.supabase-admin; set +a
CLIENT=$(grep -o "'B[A-Za-z0-9_-]\{80,\}'" src/lib/push.ts | head -1 | tr -d "'")
curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
     "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/secrets" \
  | python3 -c 'import json,sys,hashlib
want = hashlib.sha256(sys.argv[1].encode()).hexdigest()
got  = {s["name"]: s["value"] for s in json.load(sys.stdin)}
print("VAPID public halves agree:      ", got.get("VAPID_PUBLIC_KEY") == want)
print("VAPID_SUBJECT is owner mailbox: ",
      got.get("VAPID_SUBJECT") == hashlib.sha256(b"mailto:az.alsaloom@gmail.com").hexdigest())' "$CLIENT"
```

Two `True`s. **If the build is using `VITE_VAPID_PUBLIC_KEY` (§4.2), compare the
secret's value rather than the constant** — the constant is not in the bundle at
all in that case. The same trick confirms `PUSH_DRAIN_SECRET`:
`select encode(digest(drain_secret,'sha256'),'hex') from private.push_config;`
must equal the `PUSH_DRAIN_SECRET` digest.

This proves the two **public** halves match. It says nothing about the private
half; only a delivery does, and §9.4 is that delivery.

Generating and rotating the VAPID keypair — the item this section previously
recorded as owed — is now **§4.2**.

### 9.4 What push has been proven to do, live

Written by the worker who built it and extended at the Wave-5 close, on
**2026-07-30**, against the live project. This matters when you are diagnosing:
every link in the chain has now been exercised for real, end to end, so a failure
is a regression rather than an unknown.

**The headline: one real notification was delivered to a real browser and
displayed.** It is recorded in full under "The delivery" below, and it is the
proof that supersedes the "not proven" caveat this section used to carry.

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

Note what that table did **not** establish. Every send above went to a *fake*
subscription, so `sent` counted a POST that a push service then rejected, and the
one queue row that reached a live drain had **no subscriber at all** — the sender
recorded it `sent_at` because a recipient with no device is a completed obligation
(`suppressed`), not a delivery. A `sent_at` is therefore not by itself evidence
that anything arrived. `suppressed` vs `sent` in the drain's own JSON is the
discriminator, and it is the number to read.

#### The delivery — 2026-07-30

A real subscription at a real push service, encrypted by the deployed function,
decrypted and displayed by the browser. Reproduced with headless Chrome, which is
sufficient because the only thing a human was needed for was the permission grant,
and CDP `Browser.grantPermissions` grants it for real rather than stubbing it — the
subscription, the FCM registration, the RFC 8291 decryption and the
`showNotification` call are all the genuine article.

| Step | Evidence |
| --- | --- |
| A browser subscribed **through the product's own button** | Settings → Push notifications → *Turn on for this device*; card flipped to *On for this device*, **Registered devices** listed `Mac · Chrome — This device` |
| The subscription is a live FCM registration | `push_subscriptions` row `2939daf8…`, endpoint `https://fcm.googleapis.com/fcm/send/dH4klPiPbdQ:APA91bEdWf0u…` |
| A notification enqueued a delivery in the same transaction | `notifications.id = 50` (`assigned`, actor `Wave 5 proof`) → `push_outbox.id = 8`, `created_at 16:43:49.807Z` |
| The **trigger's** `pg_net` wake-up drained it | `net._http_response` `200 {"ok":true,"claimed":1,"sent":1,"failed":0,"suppressed":0,"pruned":0}` at `16:43:49.908Z` — **`suppressed:0` with `sent:1` is the subscriber-count proof**; contrast the vacuous 14:03 row, `sent:0, suppressed:1` |
| FCM accepted the VAPID token and the body | a 2xx is the only way `sent` increments; `push_outbox.id = 8` settled `attempts 1`, `sent_at 16:43:51.399Z`, `last_error null` |
| **The browser decrypted it and showed it** | `registration.getNotifications()` on the live origin returned exactly one: title `Assigned to you`, body `⁨Wave 5 proof⁩ assigned you “⁨التقرير الأسبوعي لتشغيل الشبكة · Weekly network ops report⁩”`, tag `opstrack-n-50`, data `{"id":"50","path":"#/entry/302d281e-…"}` |
| The bidi isolates survive to the OS layer | the body above carries U+2068/U+2069 around both interpolations, verbatim, in a mixed Arabic/Latin title |
| The auth gate, re-run against the deployed function | no `x-push-drain` → `403 {"code":"forbidden"}`; wrong secret → `403 {"code":"forbidden"}`; no project key → `401 UNAUTHORIZED_NO_AUTH_HEADER`; correct → `200` |

**This is also the proof that the VAPID keypair is a pair.** FCM binds a
subscription to the `applicationServerKey` it was created with and verifies the
ES256 signature against the `k=` in the `Authorization` header; a private key that
did not match would have produced a `403`, `sent:0` and an abandoned row. Combined
with §9.3 check 6 — which shows the function's `VAPID_PUBLIC_KEY` secret is
byte-identical to the key in the bundle — the private half is proven to pair with
the public half that ships to browsers. No rotation is owed.

**Not covered by this run, and still owed to the manual pass:** iOS/Safari (the
installed-PWA path has no headless equivalent), a physically locked screen, and
`notificationclick` focusing the right entry.

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
   the entry's title. Click it: the browser focuses (or opens) CoreTrack **on that
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
   notifications shows *"Add CoreTrack to your Home Screen first"* — Safari in a tab
   cannot receive Web Push at all, and that card is the app telling the truth rather
   than a broken switch. Install it (Share → Add to Home Screen), open it **from the
   Home Screen**, and the same screen now offers the enable button. Then repeat
   steps 3–5 with the phone locked.
9. **Sign out on the laptop and check what sign-out actually cleaned up.**
   ```sql
   select count(*) from public.push_subscriptions;
   ```
   **The count must drop by one.** Sign-out drops the browser subscription *and*
   deletes the row, so the next person to use that machine cannot receive the
   previous user's notifications. If it does not drop, treat that as a blocker —
   it means the previous user's endpoint and both of their subscription keys are
   still in the table, and the failure is silent by construction (see below).

   **This was measured broken on 2026-07-30 and the history is worth keeping.**
   `resetPush()` in `src/store/push.ts` cleared the store and called
   `unsubscribeThisDevice()`, which is browser-side only; nothing deleted the row.
   In the ordinary case that was stale data rather than a live channel — the
   browser unsubscribe lands first, the endpoint is dead at the push service, and
   the next send's `410` makes the drain prune the row. **The exception was the
   one that mattered:** `unsubscribeThisDevice()` swallows its own failure, so an
   *offline* sign-out left the row **and** a still-valid registration, and the
   previous user kept receiving notifications on a machine somebody else was now
   using.

   **Fixed in `<push-signout>`**, and the fix is in two files rather than one,
   because a delete alone would not have worked. `push_subscriptions` is
   owner-only RLS (migration `0011`), so a delete issued after the session is
   gone matches no rows and **returns no error** — indistinguishable from
   success. `resetPush()` runs from App.tsx's sign-out teardown, which is reached
   only *after* `session` has gone null, so it could never have been the place.
   So `store/auth.signOut()` now awaits `releasePushForSignOut()` **before**
   `supabase.auth.signOut()`, with the endpoint read up front (from the store, or
   from the browser when Settings was never opened this session) so the delete
   still happens when the unsubscribe throws. `resetPush()` remains as the
   backstop for sign-outs that never go through `signOut()` — an expired session,
   a revoked token, a sign-out in another tab — where an unsubscribe is the only
   cleanup a signed-out tab can still perform. `src/store/push.test.ts` pins it,
   and pins the **ordering** specifically, for the RLS reason above.

   Two things that are still true after the fix. An **offline** sign-out cannot
   delete the row, because nothing can reach PostgREST — the cleanup is bounded
   at 4 s so sign-out never hangs on a dead network, and a shared machine should
   still be signed out online. And a row that survives anyway is removed with
   `delete from public.push_subscriptions where user_id = '<uuid>';`.

If step 5 produces nothing, work §9.3 from the top — the config row is the most
common cause, and it is silent.

#### Reproducing the headless run

The whole of "The delivery" above was produced from a terminal, and can be again.
Chrome, a throwaway profile, and CDP for the permission grant:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --remote-debugging-port=9222 \
  --user-data-dir="$(mktemp -d)" --no-first-run --no-default-browser-check about:blank &
```

Then, over the browser-level WebSocket from `http://127.0.0.1:9222/json/version`:

1. `Browser.grantPermissions {origin:"https://abosallom.github.io",
   permissions:["notifications"]}`. **Hold that WebSocket open for the entire
   run** — Chrome reverts permission overrides the moment the client that set them
   disconnects, and headless then auto-*denies* the app's
   `Notification.requestPermission()`, which is sticky and needs a re-grant plus a
   reload to clear.
2. Open the app at a magic link minted through the GoTrue admin
   `generate_link` endpoint (§3), so no credential is ever typed.
3. `Runtime.evaluate` a click on the *Turn on for this device* button — drive the
   product's path, not `pushManager.subscribe()` directly, or you prove the
   browser works and nothing about the app.
4. Insert a `notifications` row for that user and let the trigger's wake-up drain
   it; read `net._http_response` for the summary.
5. `Runtime.evaluate` `registration.getNotifications()` against the `…/push/`
   scope. What it returns is what the OS was asked to show.

Headless Chrome does register with FCM and does receive pushes; the endpoint is a
real one and it dies with the profile directory, so delete the profile when you are
finished and let the next drain prune the row.

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
