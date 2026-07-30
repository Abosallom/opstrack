# Wave 4 — live proof ledger

**Status: TEMPLATE. Written by the Wave-4b documentation pass; filled by the Prove
agent.** Everything below the *Environment fingerprint* is a skeleton with empty
artifact blocks. A section is finished when its artifact block holds something a
third party could re-derive without asking anyone a question.

This file exists because the Wave-4 critic rejected the previous proof round. Not
because the work was wrong — because the *record* of it was a set of assertions.
"Verified in the browser", "confirmed live", "tested on the phone" are all
unfalsifiable a week later, and a wave that cannot be re-checked cannot be
released.

---

## 0. The rules of evidence

Six rules. They are short because every one of them was broken at least once in
Waves 1–4.

1. **An artifact, or it did not happen.** Every claim carries a pasted SQL
   result, a captured id, a digest, or a described screenshot. A sentence with
   no artifact under it is a to-do, not a proof.
2. **Ids, not adjectives.** "Created a member" is not evidence; `uuid
   7bd33430-…` is. Every row this ledger touches is named by primary key, so the
   next person can `select … where id = …` and see for themselves.
3. **Verbatim output.** Paste what the tool printed, including the parts that
   are boring. Reformatting is how a `NO` becomes a `yes`.
4. **The probe must be able to fail.** Before trusting a check, break it on
   purpose once and watch it go red. `0009`'s first probe block passed against a
   wholly unconverted policy catalogue; `0007`'s first probe passed against the
   *broken* function. Both were written in good faith. Record the negative
   control beside the positive one.
5. **Destructive probes run in `begin; … rollback;`** — unless this ledger says
   the evidence is meant to be durable, in which case say so *in the section*,
   name the rows, and say who cleans them up and when.
6. **State what you could not prove.** An honest gap is worth more than a
   confident sentence, because the gap gets scheduled and the sentence does not.

### What does *not* count

- A green test suite. It proves the code agrees with the tests. Every item in
  this ledger is about the code agreeing with the *live project*.
- A screenshot with no described content. If the reader has to open the PNG to
  learn what it shows, describe it in text as well — see §0.2.
- `console.log` in a dev build. The bundle that matters is the one GitHub Pages
  is serving; name the run id.
- Anything phrased "should". Either it did, or the section is unfinished.

### 0.1 The capture kit

The four artifact types this ledger uses, and how to produce each one.

**SQL.** Read-only checks go through the management API; the project ref and
token live in `.env.supabase-admin` (never committed — `git check-ignore -v
.env.supabase-admin` must print a rule).

```bash
cd /Users/aziz/Claude/opstrack
set -a; . ./.env.supabase-admin; set +a
curl -s -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"query":"select 1 as ok"}'
```

Paste the JSON it returns. It runs as the table owner, so **RLS is bypassed** —
any claim *about a policy* has to be made with `set local role authenticated`
and a `request.jwt.claims` setting inside a transaction, not with a bare select.
Say which of the two you used; they answer different questions.

**Ids.** Every row created, changed or deleted during the proof run gets a line
in §7's manifest: table, id, why it exists, and whether it stays.

**Digests, for anything that leaves the app.** A clipboard copy, an export file
or a rendered digest is proved by hashing it, not by describing it:

```bash
pbpaste | shasum -a 256            # what the app actually put on the clipboard
shasum -a 256 ~/Downloads/opstrack-export-*.json
```

Then hash the expected string the same way and show both. Two matching digests
survive a reformat of this document; "the Arabic looked right" does not.

**Screenshots, described.** Save the file under `docs/EVIDENCE/shots/` with a
name that says what it shows, and write the description in the section. A
description is: the viewport size, the locale and direction, the exact strings
visible in the region that matters, and the one thing the shot is evidence *of*.
The image is the backup; the text is the evidence.

### 0.2 Section skeleton

Every numbered section below uses this shape. Do not add prose above **Claim**.

> **Claim** — one sentence, falsifiable, present tense.
> **Method** — the command, the route, the taps. Enough to repeat it.
> **Artifact** — pasted output / ids / digest / described shot.
> **Negative control** — what you broke to prove the check discriminates.
> **Verdict** — `PROVEN` · `PARTIAL — <what is missing>` · `NOT PROVEN — <why>`.

---

## Environment fingerprint

Captured 2026-07-30 by the Wave-4b documentation pass. Re-capture at the top of
the proof run and paste both; if they differ, say what moved.

| | |
| --- | --- |
| Repo HEAD | `8a0b2f2` — *fix(wave4): audit, refute and verifier findings* |
| Working tree | clean |
| Test suite | `npm run test` → **47 files / 1217 tests passed**, 1.85 s, at `8a0b2f2` |
| Supabase project | `lrysgpbkmuqgzsjesfkr`, PostgreSQL 17.6, region ap-northeast-2 |
| Migrations applied | **0001–0011**, all ten fingerprints `yes` (RUNBOOK §5.1 query, run 2026-07-30) |
| Edge functions | `admin-members` v11 · `claim-account` v11 · `send-push` v6 — all ACTIVE, all `verify_jwt: true` |
| Last Pages deploy | run `30539193155`, success, 2026-07-30T11:36:11Z, `main` @ `8a0b2f2` |
| Auth | `disable_signup: true` · `mailer_autoconfirm: false` · `mailer_otp_exp: 600` · `rate_limit_email_sent: 2/hour` |
| RLS | on for all 11 public tables |
| Policies | 37 total, 37 in InitPlan form (`(select …)`) — 35 `is_member`/`is_admin`, 2 `auth.uid()` |

**Live row counts at fingerprint time** — the denominator for every "it appeared
in the database" claim below:

```
entries 10 (9 open) · entry_updates 6 · tracks 6 · vocab_options 17 · track_slas 0
meetings 1 · meeting_lines 1 · recurring_templates 0 · notifications 6
config_audit 74 · profiles 3
push_subscriptions 0 · push_outbox 0 (0 sent, 0 abandoned) · claim_counters 0
```

**Four of those numbers are traps, and every one of them is a zero that reads as
"working" and means "never exercised".**

- `track_slas 0` — the SLA matrix has never been armed here, so everything
  downstream of `resolveSlaDays()` is running the priority-default branch and the
  override branch is unproven. §4 has to arm one.
- `recurring_templates 0` — the nightly `pg_cron` job has had nothing to
  materialise. Its last run succeeded at `03:15:00Z` returning `1 row`, which is
  the *job* running, not the *feature* working.
- `push_subscriptions 0` — no device has ever subscribed, so nothing has ever
  been sent. `opstrack-drain-push` is running every minute and succeeding, which
  again is the scheduler working against an empty queue. `private.push_config`
  does hold its one row (inserted `12:15:45Z`), so the plumbing is complete and
  untested.
- `claim_counters 0` — `0010`'s throttle table has never been written to, so the
  atomic bump that the whole S1c fix rests on has not run against live data.
  §5.5's negative control is what closes this.

---

## 1. Housekeeping performed by this pass

Recorded here rather than in a commit message because it changed live data.

### 1.1 The stale live meeting — CLOSED

> **Claim** — meeting `Mobile 375 verification sync` was left running by the
> Wave-4 browser-proof run and is no longer open.
> **Method** — `update public.meetings set ended_at = …, notes = … where id = …`,
> via the management API (owner role, RLS bypassed).

**Before:**

```json
[{"id":"3da06294-e945-4a84-bdef-30cbf73f42e0","title":"Mobile 375 verification sync",
  "started_at":"2026-07-30 10:19:58.029904+00","ended_at":null,"notes":"","attendees":[],
  "track_id":null,"created_by":"397d3122-7e3c-4046-ab4d-b45d154c7ac4",
  "line_count":1,"pending_lines":1}]
```

**After:**

```json
[{"id":"3da06294-e945-4a84-bdef-30cbf73f42e0","title":"Mobile 375 verification sync",
  "started_at":"2026-07-30 10:19:58.029904+00","ended_at":"2026-07-30 10:23:25.419316+00",
  "pending_lines":1}]

[{"live_meetings":0}]
```

**Ended, not deleted, and the three choices behind that.** *Ended* rather than
deleted because the meeting is the only surviving proof that live capture wrote
to `meeting_lines` on a real device — deleting it would have destroyed the
evidence the critic asked for while claiming to tidy. *`ended_at` set to the
timestamp of its last line* (`10:23:25.419316+00`) rather than to now, so the
row does not report a two-hour meeting that never happened. *The pending line
left pending*, because triaging it would manufacture an entry nobody asked for;
one untriaged line on an ended meeting is the honest state and the minutes
document renders it correctly.

`notes` now carries a plain-English provenance sentence, so the owner opening
`/meetings` finds an explanation instead of a mystery. If Wave 5 would rather
the row were gone:

```sql
delete from public.meeting_lines where meeting_id = '3da06294-e945-4a84-bdef-30cbf73f42e0';
delete from public.meetings      where id         = '3da06294-e945-4a84-bdef-30cbf73f42e0';
```

**Verdict** — `PROVEN`. `select count(*) from public.meetings where ended_at is
null` → `0`.

### 1.2 Live fixtures that are NOT real members

Two accounts on this project are probe residue. They are named in bright colours
on purpose, and the Prove agent must not count them as members, delete them
mid-run, or read their state as evidence of the edge function's behaviour —
their metadata was written directly, and the giveaway is that
`zzprobe.claimed.claimed_at` and `zzprobe.pending.invite_issued_at` are the same
microsecond.

| Account | `profiles.display_name` | State |
| --- | --- | --- |
| `zzprobe.pending@opstrack.internal` | Probe Pending | unclaimed, invite outstanding, **no `invite_alg`**, legacy `claim_fail_count: 10` still in the metadata bag |
| `zzprobe.claimed@opstrack.internal` | Probe Claimed | claimed, `invite_hash` present but null, never signed in |

**`Probe Pending` is the single most useful row on this project, and it is about
to be deleted by whoever tidies up.** Read this before you do.

It carries two pieces of *legacy* state that the Wave-4b rewrite made
unreachable, and it is therefore the only live fixture that can prove the
migration path rather than the new happy path:

- **`claim_fail_count: 10` in `user_metadata`.** That was the old hard ceiling. The
  counter now lives in `public.claim_counters` and nothing reads this field any
  more, so the account is claimable despite it. Worth one assertion: a stale
  metadata counter must not throttle anybody.
- **No `invite_alg` tag**, so its stored digest is a **bare pre-pepper SHA-256**.
  This is the only account on the project that exercises `verifyCode()`'s legacy
  branch. Redeem it once and the branch is proven; delete it and the branch has
  never run outside a unit test. Do that in §5.4 *before* §7's cleanup.

**Cleanup owner:** Wave 5, after §5.4 has used the legacy digest and the Members
screen is proven. Delete through the edge function's `delete` action, not by hand —
that path is itself under test.

---

## 2. Gate (a) — the build

> **Claim** — `main` @ HEAD builds, lints, tests and deploys clean, and the
> bundle GitHub Pages serves is the one built from that commit.
> **Method** — `npm run lint`, `npm run test`, `npm run build`; `gh run list`;
> fetch the live `index.html` and match the hashed entry chunk.
> **Artifact** —
> **Negative control** —
> **Verdict** —

---

## 3. Gate (b)/(c) — offline, the outbox, and conflict

The wave's centre of gravity, and the one part no unit test can close: the
queue's contract is with the network, and the network is what the test mocks.

### 3.1 Airplane mode on the installed PWA

> **Claim** — with the device offline, the installed app opens from cache,
> three captures and two updates queue with a visible pending count, and all
> five reach Postgres exactly once on reconnect.
> **Method** — installed PWA (not a browser tab), airplane mode on, the five
> operations, airplane mode off, then count in SQL.
> **Artifact** — pending-count screenshot described (viewport, locale, the exact
> `.offline-banner-count` text); the five entry ids; the `select id, title,
> created_at from public.entries where id in (…) order by created_at` output.
> **Negative control** — capture a sixth item offline and **discard** it from
> the outbox; prove no row exists for it.
> **Verdict** —

### 3.2 Dependency order and temp-id rewriting

> **Claim** — a `create → update` pair queued offline flushes in dependency
> order and the update lands on the created row, not on a temp id.
> **Method** —
> **Artifact** — the entry id; its `entry_updates` rows with `created_at`; proof
> that no row anywhere carries a `tmp-` id (`select count(*) from
> public.entry_updates where entry_id::text like 'tmp-%'` → 0).
> **Negative control** —
> **Verdict** —

### 3.3 Duplicate suppression across a drain

> **Claim** — a flush interrupted mid-drain and resumed produces no duplicate
> row.
> **Method** — kill the network mid-flush (DevTools offline toggle during the
> drain), restore, let it resume.
> **Artifact** — `select title, count(*) from public.entries group by 1 having
> count(*) > 1` → empty.
> **Negative control** —
> **Verdict** —

### 3.4 Last-write-wins on a two-device conflict

> **Claim** — two devices editing the same field converge on the later write,
> and both UIs settle on the same value without a reload.
> **Method** — two profiles, one entry, the same field, writes ordered
> deliberately.
> **Artifact** — the entry id; `select title, updated_at, updated_by,
> last_activity_at from public.entries where id = …`; both screens described.
> **Negative control** —
> **Verdict** —

### 3.5 `last_activity_at` is not lied to by a track move

> **Claim** — moving an entry between tracks bumps `updated_at` and leaves
> `last_activity_at` alone (migration `0007`), on live data, through the UI.
> **Method** — pick an entry with an old `last_activity_at`, move it on the
> board with group-by = Track, re-read.
> **Artifact** — the entry id and the before/after of both columns in one
> select.
> **Negative control** — a real edit on the same entry, showing
> `last_activity_at` *does* move when it should.
> **Verdict** —

---

## 4. The SLA matrix — the unproven branch

`track_slas` is empty on this project, so `resolveSlaDays()`'s override branch
has never executed against live data and `v_entry_health` has never joined a
non-empty override table. This section arms one, proves the resolution order,
and disarms it.

> **Claim** — a track override wins over the priority default in *both*
> implementations, and the two agree row for row.
> **Method** — arm `vocab_options.sla_days` for one priority, arm a
> `track_slas` row for one (track, priority), then compare `v_entry_health`
> against `lib/health.resolveSlaDays()` for every open entry.
> **Artifact** — ADMIN.md's "what is in force, everywhere" query before and
> after; the per-entry comparison; the `config_audit` rows both writes produced
> (`table_name = 'track_slas'`, `row_id` = the **track** id).
> **Negative control** — clear the override and show the same entry falls back
> to the priority default rather than to null.
> **Verdict** —

**Durable or rolled back?** State which. If armed values are left in place, say
so loudly — arming an SLA is retroactive by construction and every open item
older than the threshold reports as breached the moment it is saved.

---

## 5. Gate (e)/(g) — members, the second admin, and the claim lifecycle

### 5.1 An admin provisions and removes a member

> **Claim** — the admin can create, list, reissue and delete through the app's
> Members screen, and every action goes through `admin-members` rather than the
> browser.
> **Method** —
> **Artifact** — the created user's id and username; the `list` response with
> `claimed: false`; the `profiles` row; the delete response; proof the row is
> gone from both `auth.users` and `public.profiles`.
> **Negative control** —
> **Verdict** —

### 5.2 A member cannot

> **Claim** — a non-admin calling `admin-members` gets `403`, and a non-admin
> attempting an admin-only write in the app gets `42501` — an error from the
> server, not a hidden button.
> **Method** — sign in as a member; call the function with that session; attempt
> a track write.
> **Artifact** — both raw responses, status codes included.
> **Negative control** — the same two calls as the admin, succeeding.
> **Verdict** —

### 5.3 The second admin

> **Claim** — an account promoted to `profiles.role = 'admin'` can/cannot
> provision members, and `ADMIN.md` says which.
> **Method** — promote a second account in the SQL Editor, sign in, try to
> provision.
> **Artifact** — the promoting statement, the sign-in, the response from
> `admin-members`, and the paragraph in `ADMIN.md` that predicted it.
> **Negative control** —
> **Verdict** —

This is Wave-4 acceptance gate **(g)** and it is a fork, not a checkbox: either
the function's gate became a service-role `profiles.role` lookup, or it stayed
an allow-list and the limitation is documented. Whichever landed, this section
records the *behaviour* and `ADMIN.md` records the *rule*, and the two must say
the same thing.

### 5.4 The invite/claim lifecycle, end to end

> **Claim** — issue → hand over → claim → sign in works once, and the code is
> dead afterwards.
> **Method** — create a username account, redeem the code at `/claim`, sign in
> with the chosen password, then replay the same code.
> **Artifact** — the account id; the metadata before and after the claim
> (`invite_hash` present → null, `claimed` false → true, `claimed_at` set); the
> replay response (`403 invalid_invite`); the successful sign-in.
> **Negative control** — a wrong code against the same account, showing
> `claim_fail_count` increment and the identical 403 body.
> **Verdict** —

Never paste an invite code or a password into this file. Paste the **first eight
hex characters** of `invite_hash` and the response bodies; that is enough to show
the state moved and not enough to redeem anything.

### 5.5 The throttle delays and never refuses — and the counter is atomic

`public.claim_counters` is at **0 rows**, so nothing below has ever happened
against live data. This is the section that closes migration `0010`.

> **Claim** — wrong guesses buy a capped delay against both the submitted
> username and the caller's address prefix, never a refusal; the window rolls;
> and two guesses issued in parallel count as **two**.
> **Method** — n wrong guesses against a disposable account, timing each; then a
> genuine code, which must still be accepted; then two guesses fired
> concurrently.
> **Artifact** — `select scope, bucket, n, window_start from
> public.claim_counters` after each phase — note `bucket` is the *submitted
> username string* for `scope = 'username'` and a peppered hash of the address
> prefix for `scope = 'ip'`, so neither reveals whether an account exists; the
> measured wall-clock delay per attempt against the documented curve (0, 0, 250,
> 500, 1000, 2000, 4000 ms, capped); the `429` body when the per-IP volume
> ceiling trips.
> **Negative control (the important one)** — **two guesses in parallel must leave
> `n` at 2, not 1.** This is the whole of **S1c**: the previous implementation
> read-modify-wrote `user_metadata` through an API with no compare-and-set and
> would have shown 1. A run that does not attempt the concurrent case has not
> tested the thing the migration was written for.
> **Second negative control** — guess wrongly at a username that **does not
> exist** and show a `claim_counters` row appears for it. If nonexistent
> usernames were not counted, "was I throttled?" would answer "does this account
> exist?", which is **S1a** wearing a different hat.
> **Verdict** —

Two things must remain untrue at the end of this section, and both are worth
asserting rather than assuming: no sequence of wrong guesses locks a member out
of claiming with a valid code, and no response or latency distinguishes a real
username from a fictional one.

---

## 6. Gates (d), (f), (h), (i)

### 6.1 (d) Keyboard and the command palette

> **Claim** — every shortcut in the spec works, is listed in the cheatsheet, and
> the palette reaches any track, entry or action.
> **Method** —
> **Artifact** — a table of shortcut → observed effect, in both locales; the
> cheatsheet described.
> **Negative control** — a shortcut fired inside a text input must **not** act.
> **Verdict** —

### 6.2 (f) The edge functions were redeployed and invoked twice

> **Claim** — both functions were redeployed after their last modification, and
> the deployed version is the source in this repo.
> **Method** — `npx supabase functions deploy … --use-api`, then
> `npx supabase functions list`, then two invocations.
> **Artifact** — the `list` JSON showing `version` and `updated_at` *after* the
> commit timestamp; both invocation responses (the first may cold-start).
> **Negative control** —
> **Verdict** —

At fingerprint time `admin-members` and `claim-account` were both at
`version: 11` and `send-push` at `version: 6` — they had been at `3`, `3` and
absent a few hours earlier, which is this gate visibly working rather than a
formality. **None of the three files is covered by `tsc` or `oxlint`**
(`.oxlintrc.json` ignores `supabase/functions`, `tsconfig.app.json` is `src`-only),
so deployment *is* the type check and a successful invocation is the only proof.
If a function changed and its `version` did not move, the fix is in the repo and
not in production.

Check the secrets in the same pass. `INVITE_PEPPER` missing does not break
anything visibly — `admin-members` answers `no_pepper` and refuses to mint,
which only shows up the next time somebody provisions. RUNBOOK §4.1.

### 6.3 (h) Export round-trips Arabic, commas and newlines

> **Claim** — JSON and CSV exports re-import byte-identical for a row
> containing Arabic text, an embedded comma, an embedded newline and a quote
> character.
> **Method** — craft the row, export both formats, hash, re-import, re-export,
> hash again.
> **Artifact** — the row id; both digests before and after; the CSV's raw bytes
> for the awkward field.
> **Negative control** —
> **Verdict** —

### 6.4 (i) The update prompt

> **Claim** — a new deploy raises the sticky "new version available" toast, it
> survives three ordinary toasts landing on top of it, and it applies only on
> tap.
> **Method** — deploy, keep a session open, fire three toasts, then tap.
> **Artifact** — described screenshots at each step; the Pages run id of the new
> deploy; the asset hash before and after the reload.
> **Negative control** — the three ordinary toasts must be the ones evicted.
> This is FIX-BACKLOG **C6**; the whole point is that the sticky one stays.
> **Verdict** —

### 6.5 Web push, end to end

Not in the original gate list — it arrived with Wave 4b — and it is the most
plumbing-per-feature in the repo, so it earns its own section.

> **Claim** — a notification written by a trigger reaches a real device, exactly
> once, and a device that has revoked permission is cleaned up rather than
> retried forever.
> **Method** — subscribe a device, cause a notification (reassign an entry to
> that user), observe delivery; then revoke permission at the OS and cause
> another.
> **Artifact** — the `push_subscriptions` row (endpoint truncated); the
> `push_outbox` row's `sent_at` and attempt count; the notification described as
> it appeared (title, body, which locale); the second row's `abandoned_at` and
> the subscription's removal.
> **Negative control** — the `x-push-drain` header omitted or wrong must be
> refused. Prove that, or the queue's only real gate is untested — the anon key
> it also requires is in every browser bundle.
> **Verdict** —

Two shapes to be careful about. The trigger's `net.http_post` wake-up is
best-effort and wrapped so a push failure can never roll back the user's edit, so
"it arrived in a second" proves the wake-up and "it arrived within a minute"
proves the cron drain — record which one you observed. And `claim_push_batch` is
`for update skip locked`, so the duplicate-suppression claim needs two drains
racing, not one drain running twice.

### 6.6 The Capacitor iOS shell

> **Claim** — `npm run ios:sync` produces a shell that launches in the
> simulator, renders the app, and every `lib/native.ts` export is a no-op in a
> browser tab.
> **Method** —
> **Artifact** — described simulator screenshots (device, iOS version, the first
> screen); the browser-tab console showing the no-op path taken.
> **Negative control** —
> **Verdict** —

---

## 7. Row manifest

Every row this proof run created or changed, so the next person can undo it.

| Table | Id | Why | Durable? | Cleanup owner |
| --- | --- | --- | --- | --- |
| `meetings` | `3da06294-e945-4a84-bdef-30cbf73f42e0` | stale live meeting from the Wave-4 proof run, ended by the Wave-4b docs pass (§1.1) | yes | Wave 5 |
| `meeting_lines` | `fb111b44-3118-4b98-aa48-ffa76320f13a` | its one untriaged line, left pending on purpose | yes | Wave 5, with the meeting |
| `auth.users` | `zzprobe.pending@opstrack.internal` | claim-lifecycle fixture, and the **only** live carrier of a pre-pepper digest and a legacy metadata counter (§1.2) | yes — **do not delete before §5.4** | Wave 5, via the function's `delete` |
| `auth.users` | `zzprobe.claimed@opstrack.internal` | claim-lifecycle fixture (§1.2) | yes | Wave 5, via the function's `delete` |
| `private.push_config` | the single `id = true` row | inserted 2026-07-30 12:15:45Z; holds `drain_secret`, which must match the `PUSH_DRAIN_SECRET` function secret | yes — **required for push to work at all** | permanent, not cleanup |

---

## 8. What this run could NOT prove

One line each, with the reason and who it lands on. This section being empty is
itself a finding — no proof run of this size ends with nothing open.

**Seeded by the documentation pass**, so they are not discovered twice. Each is a
gap in the *record*, not a known defect:

| Gap | Why it is open | Lands on |
| --- | --- | --- |
| The SLA override branch has never run live | `track_slas` is empty on this project; `resolveSlaDays()` has only ever taken the priority-default path against real data | §4 |
| `claim_counters` has never been written to | migration `0010` is applied but the atomic bump — the whole of **S1c** — has not executed live | §5.5 |
| Web push has never been delivered | `push_subscriptions` is 0, so the queue, the sender and the VAPID keys are plumbing that has been deployed and never exercised | §6.5 |
| The pre-pepper legacy digest path | only `zzprobe.pending` carries an untagged digest, and it has not been redeemed | §5.4, before §7 cleanup |
| No history of who was an admin when | `config_audit` covers tracks, vocabulary and SLA overrides; `profiles.role` changes are not audited anywhere | a decision, not a proof — `ADMIN.md` states it plainly |
| VAPID key generation and rotation | not written down; the private half is a function secret and the public half is compiled into the bundle, so a rotation is secret + rebuild + every device re-subscribing | whoever owns push, into RUNBOOK §4.1 |

---

## 9. Where the rest of the record lives

- **[`../FIX-BACKLOG.md`](../FIX-BACKLOG.md)** — every audit finding with its
  disposition and, where fixed, the commit that fixed it.
- **[`../RUNBOOK.md`](../RUNBOOK.md)** — the operator procedures this ledger
  exercises. If a procedure here needed a step the runbook does not have, the
  runbook is wrong; fix it in the same pass.
- **[`../../ADMIN.md`](../../ADMIN.md)** — the rules §4 and §5 are testing.
- **[`../EXECUTION-PLAN.md`](../EXECUTION-PLAN.md)** §5 — the wave acceptance
  gates these section numbers track.
