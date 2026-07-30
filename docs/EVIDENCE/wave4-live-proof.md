# Wave 4 — live proof ledger

**Status: PARTIALLY FILLED.** Skeleton written by the Wave-4b documentation
pass; sections **3.1, 3A, 4, 4A, 5.1, 5.4 and 5.5** filled by the GAP-6 proof run
on 2026-07-30 against the live project in a real browser. A section is finished
when its artifact block holds something a third party could re-derive without
asking anyone a question.

**Sections still empty, and nobody should read them as passing:** §2 (the build
gate), §3.2–3.5 (dependency order, duplicate suppression, two-device conflict,
`last_activity_at` under a track move), §6.1–6.6 (keyboard, function redeploy,
export round-trip, update prompt, web push, Capacitor). They carry a
`NOT RUN BY THE GAP-6 PASS` verdict rather than a blank one, so an empty
artifact block cannot be mistaken for a proven claim.

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

### Re-capture at the top of the GAP-6 proof run (2026-07-30, ~14:20Z)

Two things moved, and both are the wave advancing rather than drift:

| | Documentation pass | GAP-6 proof run |
| --- | --- | --- |
| Repo HEAD | `8a0b2f2` | **`2b51f1c`** — *feat(wave4b): keyboard layer, members+claim security, export, offline UI, push, SSO, iOS run* |
| Working tree | clean | clean |
| Test suite | 47 files / 1217 tests | **53 files / 1482 tests** (per `2b51f1c`'s commit message; not re-run by this pass — see §0 "what does not count") |
| PostgreSQL | 17.6 | 17.6 (`select version()` re-read live) |

**The row counts had also moved before this run started**, because a partial
proof round had already written to the live project without recording anything.
That is precisely the failure this ledger exists to stop, so it is stated here
rather than quietly absorbed: at documentation-pass time `entries` was 10,
`meetings` 1, `meeting_lines` 1 and `recurring_templates` 0; when the GAP-6 run
opened they were 18, 2, 11 and 1. §3A and §4A identify exactly which rows those
are, and this run adopted them as artifacts rather than manufacturing a second
set beside them.

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

### Two of those four traps are closed; the counts at the END of the GAP-6 run

```
entries 20 (19 open) · tracks 6 · track_slas 1 · meetings 2 · meeting_lines 11
recurring_templates 1 · claim_counters 7 · profiles 3 · config_audit 77
```

- **`track_slas 0 → 1`.** §4 armed `(Network, high) = 2` through the app and left
  it armed. `resolveSlaDays()`'s override branch and `v_entry_health`'s
  `coalesce(ts.sla_days, vp.sla_days)` have now both run against a non-empty
  override table.
- **`claim_counters 0 → 7`.** §5.5 drove `claim_bump()` from the live edge
  function, including the concurrent case S1c was written for.
- **`recurring_templates` is 1 and stays 1** — §4A, left active on purpose.
- **`push_subscriptions 0` is UNCHANGED.** Web push is still plumbing that has
  been deployed and never exercised. §6.5 remains empty and §8 still carries it.

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

**Status after the GAP-6 run: both fixtures are untouched, and `Probe Pending`
is now more load-bearing than when this was written.** §5.1 minted a throwaway
account and it came out `invite_alg: hmac-sha256-v1`; that throwaway has since
been deleted. So `zzprobe.pending` is the *only* row on this project whose
digest is a bare pre-pepper SHA-256, and `verifyCode()`'s legacy branch has
still never executed against live data. Deleting it retires that branch's only
live witness. §8 #3.

### 1.3 Live data this pass changed, at a glance

Recorded here for the same reason as §1.1 — it changed live rows, and a commit
message is not where that belongs. Full detail and undo statements are in §7.

- **Armed** `track_slas (Network, high) = 2` and left it armed (§4). Retroactive:
  one open entry now reports past its service deadline.
- **Resumed** recurring template `f3492bf8-…` from paused to active (§4A). It
  will create one Network entry on 2026-08-06 and weekly thereafter.
- **Added** two entries via the offline queue and kept them (§3.1).
- **Created and deleted** one member account, one probe entry and one
  temporary SLA cell (§7, second table). All three are verified gone.
- **Wrote** the first seven rows `public.claim_counters` has ever held (§5.5).
  They expire with their 15-minute window and are inert.

---

## 2. Gate (a) — the build

> **Claim** — `main` @ HEAD builds, lints, tests and deploys clean, and the
> bundle GitHub Pages serves is the one built from that commit.
> **Method** — `npm run lint`, `npm run test`, `npm run build`; `gh run list`;
> fetch the live `index.html` and match the hashed entry chunk.
> **Artifact** —
> **Negative control** —
> **Verdict** — `NOT RUN BY THE GAP-6 PASS`. That pass worked against the Vite
> dev server on `:5197`, not against the Pages bundle, so it has nothing to say
> about which bundle GitHub Pages is serving. Do not read `2b51f1c`'s commit
> message as this gate: a commit message is an assertion, which is the exact
> thing §0 rule 1 refuses.

---

## 3. Gate (b)/(c) — offline, the outbox, and conflict

The wave's centre of gravity, and the one part no unit test can close: the
queue's contract is with the network, and the network is what the test mocks.

### 3.1 Offline capture, the pending count, and the flush

> **Claim** — with the app offline, two captures queue behind a visible pending
> count, reach Postgres exactly once on reconnect, and nothing is written while
> the network is down.
> **Method** — Quick capture at `#/capture`, signed in as `Aziz` (admin),
> Chrome, 1280×720, locale EN/LTR, dev server `http://localhost:5197`.

**How "offline" was produced, exactly — read this before trusting the section.**
The assignment asked for the DevTools offline toggle. The automation surface
driving this browser exposes no CDP network emulation, so offline was produced
in the page instead, and it is **stricter** than the DevTools toggle rather than
weaker:

```js
Object.defineProperty(navigator, 'onLine', { get: () => false })  // 1
window.fetch = () => Promise.reject(new TypeError('Failed to fetch'))
XMLHttpRequest.prototype.open = function () { throw new Error('offline') }  // 2
window.dispatchEvent(new Event('offline'))                                  // 3
```

1 is **the whole of the app's offline signal** — `store/outbox.ts`'s
`isOffline()` is `navigator.onLine === false` and nothing else, and
`components/OfflineBanner.tsx` reads the same property through
`useSyncExternalStore`. 2 and 3 are what DevTools additionally does. 2 is why
this is stricter: with the transport itself rejecting, a queue that leaked a
write could not have hidden it — the row could not have been created by any
path. On restore, all three were reverted and an `online` event dispatched.
`window.__probeOffline.blocked` counted **24** network calls refused while the
shim was installed.

**Artifact — the banner, verbatim from the DOM**, after the first capture:

```
You're offline — showing the last loaded data.
1
```

after the second:

```
You're offline — showing the last loaded data.
2
2 changes waiting to sync
Show pending changes
```

`.offline-banner-count` = `"2"`. The live region is
`<div class="offline-region" role="status" aria-live="polite">`, so the count is
announced rather than only drawn. Each capture's optimistic row carried
*"Saved on this device — it'll sync when you're back online."* — the
`offline.queued` notice, not an error.

**The outbox sheet** (`Show pending changes` → `role="dialog"`), verbatim:

```
Pending changes
These are saved on this device and will be sent when you're back online.

New entry   ⁨ZZ-OFFLINE-1 UPS firmware audit⁩              1 min ago   Waiting to send   Discard
New entry   ⁨ZZ-OFFLINE-2 مراجعة سجلات الجدار الناري⁩       Just now    Waiting to send   Discard   Retry now
```

Both titles arrive wrapped in U+2068/U+2069, which is the bidi rule holding on a
surface that mixes an Arabic title with an English relative time.

**Artifact — Postgres, while still offline.** The denominator matters: the
workspace had 18 entries when the shim went in.

```json
[{"total":18,"zz_offline":0}]
```

**Artifact — Postgres, after restoring the network.** Both rows, once each,
with every token the parser was asked to read:

```json
[{"id":"cf7d4d12-31e9-4e69-a082-10d99c6214d7",
  "title":"ZZ-OFFLINE-1 UPS firmware audit","priority":"high",
  "track_id":"70b2ef94-f853-4990-974c-6b3027911176","due_date":"2026-08-14",
  "status":"new","created_at":"2026-07-30 14:38:12.838136+00"},
 {"id":"1ac8e152-a9db-429d-92a5-ee4db2d03d40",
  "title":"ZZ-OFFLINE-2 مراجعة سجلات الجدار الناري","priority":"medium",
  "track_id":"70b2ef94-f853-4990-974c-6b3027911176","due_date":null,
  "status":"new","created_at":"2026-07-30 14:38:13.587354+00"}]

[{"total":20}]
```

`#Network` resolved to the Network track on both, `!high`/`!medium` to the two
priorities, `due:2026-08-14` to the date. The flush ran in queue order 0.75 s
apart. After it, the banner element is **gone from the DOM entirely** —
`.offline-region` returns null — which is the fourth of the banner's four states
(no attention needed) rather than a zero being drawn.

**Negative control** — the discriminator is the *middle* reading, not the last
one. `total` was 18 with the shim installed and 20 after it was lifted, from the
same two clicks; a queue that had silently written through would have shown 20
at the point where the transport was rejecting every call. Two further checks
that would have caught a double-drain and a temp-id leak:

```
select title, count(*) from public.entries group by 1 having count(*) > 1  →  []
select count(*) from public.entry_updates where entry_id::text like 'tmp-%'  →  0
```

**Not proven here:** the *installed PWA* opening from cache with the device in
real airplane mode, and the discard path (queue a third item and discard it).
Both are in §8.

> **Verdict** — `PARTIAL — PROVEN for queue → visible count → flush → exactly-once
> in a browser tab with the transport hard-failed; NOT proven for the installed
> PWA under real airplane mode, nor for the outbox discard path.`

### 3.2 Dependency order and temp-id rewriting

> **Claim** — a `create → update` pair queued offline flushes in dependency
> order and the update lands on the created row, not on a temp id.
> **Method** —
> **Artifact** — the entry id; its `entry_updates` rows with `created_at`; proof
> that no row anywhere carries a `tmp-` id (`select count(*) from
> public.entry_updates where entry_id::text like 'tmp-%'` → 0).
> **Negative control** —
> **Verdict** — `NOT RUN BY THE GAP-6 PASS`. That pass queued two *creates* and
> no update, so the temp-id rewrite never had a dependent write to land. The
> `tmp-%` count is 0 in §3.1, but over a table where no update was queued that
> is a vacuous pass, not evidence — say so rather than borrowing it.

### 3.3 Duplicate suppression across a drain

> **Claim** — a flush interrupted mid-drain and resumed produces no duplicate
> row.
> **Method** — kill the network mid-flush (DevTools offline toggle during the
> drain), restore, let it resume.
> **Artifact** — `select title, count(*) from public.entries group by 1 having
> count(*) > 1` → empty.
> **Negative control** —
> **Verdict** — `NOT RUN BY THE GAP-6 PASS`. The duplicate query is empty in
> §3.1, but that drain was never interrupted, so nothing tested the resume.

### 3.4 Last-write-wins on a two-device conflict

> **Claim** — two devices editing the same field converge on the later write,
> and both UIs settle on the same value without a reload.
> **Method** — two profiles, one entry, the same field, writes ordered
> deliberately.
> **Artifact** — the entry id; `select title, updated_at, updated_by,
> last_activity_at from public.entries where id = …`; both screens described.
> **Negative control** —
> **Verdict** — `NOT RUN BY THE GAP-6 PASS`. Needs two signed-in profiles; that
> pass ran as one admin only.

### 3.5 `last_activity_at` is not lied to by a track move

> **Claim** — moving an entry between tracks bumps `updated_at` and leaves
> `last_activity_at` alone (migration `0007`), on live data, through the UI.
> **Method** — pick an entry with an old `last_activity_at`, move it on the
> board with group-by = Track, re-read.
> **Artifact** — the entry id and the before/after of both columns in one
> select.
> **Negative control** — a real edit on the same entry, showing
> `last_activity_at` *does* move when it should.
> **Verdict** — `NOT RUN BY THE GAP-6 PASS`.

---

## 3A. The meeting, end to end — capture, reload, triage, minutes

*Added by the GAP-6 pass; the skeleton had no section for the Wave-3 meeting
flow and the release gate asks for it.*

The subject is meeting **`0136ab58-5c33-4da5-98eb-82be5ff3e511`**,
*"اجتماع العمليات الأسبوعي · Weekly ops sync"*, started `13:34:57.803611+00`,
ended `13:45:49.086+00`, ten lines. It was captured by the partial round that
ran before this one; this pass **adopted it rather than staging a second
meeting beside it**, because a real ten-line bilingual meeting already sitting
in the workspace is better evidence than a fresh one typed to order — and
because a duplicate would have made the minutes digests below ambiguous.

### 3A.1 Ten lines, mixed AR/EN, every token kind

> **Claim** — the live capture screen wrote ten lines to Postgres, one row per
> sentence, carrying the full token vocabulary in both scripts.
> **Method** — `select seq, state, entry_id, raw, created_at from
> public.meeting_lines where meeting_id = '0136ab58-…' order by seq`.

**Artifact** (raw text abbreviated only where it repeats; state and seq verbatim):

| seq | state | raw (tokens in bold by hand) | created_at |
| --- | --- | --- | --- |
| 1 | committed | `تجديد شهادة SSL لبوابة الدفع #Network !high @Aziz due:2026-08-06` | 13:40:23.533508+00 |
| 2 | committed | `Core switch firmware rollback plan needs sign-off /decision #Network !critical` | 13:40:45.816210+00 |
| 3 | committed | `شكوى بطء الشبكة في فرع الملز — قياس زمن الاستجابة /issue #Network @Aziz` | 13:41:07.524471+00 |
| 4 | committed | `STC to confirm the new 10G uplink quote /request #Network due:2026-08-10 +vendor` | 13:41:30.027642+00 |
| 5 | **note** | `ملاحظة: الاجتماع القادم يوم الأحد بدلاً من الاثنين` | 13:42:10.202967+00 |
| 6 | committed | `تركيب مبدّل الوصول في غرفة الشبكة — أُنجز أثناء الاجتماع #Network !high @Aziz` | 13:43:37.841444+00 |
| 7 | committed | `Renew the Fortinet support contract before Q4 /action !medium due:2026-09-01` | 13:43:52.925916+00 |
| 8 | committed | `اختبار التحويل التلقائي للوصلة الاحتياطية /change @Aziz due:2026-08-20` | 13:44:07.115543+00 |
| 9 | **discarded** | `Coffee machine on floor 3 is broken again` | 13:44:21.983013+00 |
| 10 | **discarded** | `تأجيل مناقشة تقسيم الشبكات الفرعية إلى اجتماع الحوكمة` | 13:44:44.030265+00 |

Six of the ten are Arabic, four English, and one (`seq 1`) mixes scripts inside
a single line — `SSL` sits inside an RTL sentence. Between them the ten exercise
`#track`, `!priority`, `@owner`, `due:<iso>`, `+tag` and five of the `/type`
tokens (`/decision`, `/issue`, `/request`, `/action`, `/change`).

The timestamps are the load-bearing part: **ten separate server writes spread
over four minutes**, not one batch at the end. A meeting is not held in the
tab's memory.

> **Verdict** — `PROVEN`.

### 3A.2 The tab kill — what is proven and what is not

> **Claim** — a meeting survives its tab, because every line is a server write
> and the screen rebuilds from Postgres.
> **Method** — `#/meetings/0136ab58-…`, then a full `location.reload()` — a
> fresh JS context, empty module state, nothing carried over.

**Artifact** — after the reload, the `.mt-line-seq` values rendered, in DOM
order (the list is newest-first by design):

```json
{"seqsRenderedAfterFullReload":["10","9","8","7","6","5","4","3","2","1"],
 "count":10,"badge":"Ended"}
```

All ten sentences came back from the server. Nothing about the meeting lived
only in the tab.

**Be careful about what this does and does not show.** It proves the *recovery*
half. It does **not** prove a kill *mid-meeting* followed by appends continuing
at `seq 11`, because this meeting is ended and reopening it to add scratch lines
would have changed the very document §3A.4 hashes. There is a 1 m 27 s gap
between `seq 5` (13:42:10) and `seq 6` (13:43:37) which is *consistent* with a
tab dying and being reopened — and consistency is not evidence, so it is not
claimed as any. §8 carries the mid-meeting kill.

> **Verdict** — `PARTIAL — recovery from a cold reload is PROVEN; a mid-meeting
> tab kill with the sequence continuing afterwards is NOT PROVEN.`

### 3A.3 Triage: same-as-above, two discards, one bulk commit

> **Claim** — triage carried a value down from the row above, discarded two
> lines without deleting them, and committed the rest in a single write.
> **Method** — read the entries triage produced and compare them against the
> raw text that produced them.

**Artifact — the same-as-above fingerprint.** `seq 7` and `seq 8` carry **no
`#track` token at all**, yet both landed on the Network track:

```json
[{"id":"e52ed52e-fcf7-4350-9cfb-9428c6cbac47","title":"Renew the Fortinet support contract before Q4",
  "track_id":"70b2ef94-f853-4990-974c-6b3027911176"},
 {"id":"114fc9c9-7e40-42f8-9f29-ed4b0ed4cfd5","title":"اختبار التحويل التلقائي للوصلة الاحتياطية",
  "track_id":"70b2ef94-f853-4990-974c-6b3027911176"}]
```

`70b2ef94-…` is Network. The parser cannot have supplied it — there is no token
to parse — so it came from `TriageCell`'s "same as above" affordance copying the
plan of the row above (`MeetingTriage.tsx`: `previous={index > 0 ? open[index-1]
: undefined}`, `onSame={same}`). That is the whole discriminator: a track on a
line with no track token.

**Artifact — the two discards survive as notes.** `seq 9` and `seq 10` are
`state = 'discarded'`, `entry_id = null` — no entry was created, and the rows
are still there. They surface in the minutes under **Notes**, which is §4.6's
rule that "we discussed it and decided it was nothing" is a fact the next reader
needs.

**Artifact — one bulk commit.** All seven committed lines produced entries with
an **identical** `created_at`:

```
2026-07-30 13:50:13.857259+00   × 7
```

Seven rows to the microsecond is one statement, not seven clicks. The commit ran
at 13:50, after the meeting ended at 13:45 — triage is a separate sitting, which
is what the screen is for.

> **Verdict** — `PROVEN`.

### 3A.4 The minutes, copied four ways

> **Claim** — the minutes document copies to the clipboard as Markdown and as
> plain text, in English and in Arabic, from one model; every interpolated
> string carries bidi isolates; and the Arabic document renders while the UI is
> still English.
> **Method** — `#/meetings/0136ab58-…/minutes`, then the four buttons
> (`Copy as Markdown`, `Copy as text`) × (`English`, `Arabic`), each followed by
> `LC_ALL=en_US.UTF-8 pbpaste` into a file. **Read the encoding note**: a bare
> `pbpaste` in this shell transcoded every Arabic character to `?` and would
> have produced four worthless digests. The four below are of real UTF-8.

**Artifact — digests and sizes.**

| Document | bytes | chars | sha256 |
| --- | --- | --- | --- |
| EN · Markdown | 1499 | 1123 | `3f722e29731aca7d81f3c801074126f9437fb1b3d2c64c9f0909229a60b35f1c` |
| EN · plain | 1465 | 1083 | `0d1b6eb63949b0f912e617ba19854ecab8d0964866c126d62d70b585e44e0d49` |
| AR · Markdown | 1927 | 1207 | `494b727dc157618cd1b8556390d9e0747cdefbb64b32e2998f03eaab71b1cd1f` |
| AR · plain | 1893 | 1167 | `95e330612bb3488152cd7ecfc9857c2478311f95023c3afc3b60029dd15dad4c` |

**Bidi isolate census**, counted over the clipboard bytes — U+2068 FIRST STRONG
ISOLATE and U+2069 POP DIRECTIONAL ISOLATE, which must always balance:

| Document | FSI | PDI |
| --- | --- | --- |
| EN · Markdown | 9 | 9 |
| EN · plain | 9 | 9 |
| AR · Markdown | 33 | 33 |
| AR · plain | 33 | 33 |

The EN documents isolate only the values that are *foreign to the document's*
direction (the Arabic titles). The AR documents isolate every interpolation
including the Latin ones — `⁨Aziz⁩`, `⁨Core switch firmware rollback plan needs
sign-off⁩`. Nine versus thirty-three is the rule working, not two rules.

#### EN · Markdown

```markdown
# ⁨اجتماع العمليات الأسبوعي · Weekly ops sync⁩

- **Date:** 30 July 2026
- **Time:** 16:34 – 16:45
- **Track:** Network
- **Attendees:** Aziz, ⁨فيصل الحربي (STC)⁩
- **Recorded by:** Aziz

## Decisions (1)

1. Core switch firmware rollback plan needs sign-off — Priority: Critical

## Actions (3)

- [ ] ⁨تجديد شهادة SSL لبوابة الدفع⁩ — Owner: Aziz · Due: 06/08/2026 · Priority: High
- [ ] ⁨تركيب مبدّل الوصول في غرفة الشبكة — أُنجز أثناء الاجتماع⁩ — Owner: Aziz · Priority: High
- [ ] Renew the Fortinet support contract before Q4 — Owner: Unassigned · Due: 01/09/2026

## Other items (3)

1. ⁨شكوى بطء الشبكة في فرع الملز — قياس زمن الاستجابة⁩ — Type: Issue · Owner: Aziz
2. STC to confirm the new 10G uplink quote — Type: Request · Due: 10/08/2026
3. ⁨اختبار التحويل التلقائي للوصلة الاحتياطية⁩ — Type: Change · Owner: Aziz · Due: 20/08/2026

## Notes (3)

- ⁨ملاحظة: الاجتماع القادم يوم الأحد بدلاً من الاثنين⁩
- Coffee machine on floor 3 is broken again
- ⁨تأجيل مناقشة تقسيم الشبكات الفرعية إلى اجتماع الحوكمة⁩

## Closing notes

⁨اجتماع تشغيلي أسبوعي · قرار التمديد يحتاج موافقة الحوكمة. Vendor quote due next week.⁩
```

#### EN · plain text

```text
⁨اجتماع العمليات الأسبوعي · Weekly ops sync⁩
Date: 30 July 2026
Time: 16:34 – 16:45
Track: Network
Attendees: Aziz, ⁨فيصل الحربي (STC)⁩
Recorded by: Aziz

Decisions (1)
  1. Core switch firmware rollback plan needs sign-off — Priority: Critical

Actions (3)
  1. ⁨تجديد شهادة SSL لبوابة الدفع⁩ — Owner: Aziz · Due: 06/08/2026 · Priority: High
  2. ⁨تركيب مبدّل الوصول في غرفة الشبكة — أُنجز أثناء الاجتماع⁩ — Owner: Aziz · Priority: High
  3. Renew the Fortinet support contract before Q4 — Owner: Unassigned · Due: 01/09/2026

Other items (3)
  1. ⁨شكوى بطء الشبكة في فرع الملز — قياس زمن الاستجابة⁩ — Type: Issue · Owner: Aziz
  2. STC to confirm the new 10G uplink quote — Type: Request · Due: 10/08/2026
  3. ⁨اختبار التحويل التلقائي للوصلة الاحتياطية⁩ — Type: Change · Owner: Aziz · Due: 20/08/2026

Notes (3)
  • ⁨ملاحظة: الاجتماع القادم يوم الأحد بدلاً من الاثنين⁩
  • Coffee machine on floor 3 is broken again
  • ⁨تأجيل مناقشة تقسيم الشبكات الفرعية إلى اجتماع الحوكمة⁩

Closing notes
  ⁨اجتماع تشغيلي أسبوعي · قرار التمديد يحتاج موافقة الحوكمة. Vendor quote due next week.⁩
```

#### AR · Markdown

```markdown
# ⁨اجتماع العمليات الأسبوعي · Weekly ops sync⁩

- **التاريخ:** ⁨30 يوليو 2026⁩
- **الوقت:** ⁨16:34 – 16:45⁩
- **المسار:** ⁨الشبكات⁩
- **الحضور:** ⁨Aziz⁩، ⁨فيصل الحربي (STC)⁩
- **أعدّه:** ⁨Aziz⁩

## القرارات (1)

1. ⁨Core switch firmware rollback plan needs sign-off⁩ — الأولوية: ⁨حرجة⁩

## الإجراءات (3)

- [ ] ⁨تجديد شهادة SSL لبوابة الدفع⁩ — المسؤول: ⁨Aziz⁩ · الاستحقاق: ⁨06‏/08‏/2026⁩ · الأولوية: ⁨عالية⁩
- [ ] ⁨تركيب مبدّل الوصول في غرفة الشبكة — أُنجز أثناء الاجتماع⁩ — المسؤول: ⁨Aziz⁩ · الأولوية: ⁨عالية⁩
- [ ] ⁨Renew the Fortinet support contract before Q4⁩ — المسؤول: ⁨بلا مسؤول⁩ · الاستحقاق: ⁨01‏/09‏/2026⁩

## بنود أخرى (3)

1. ⁨شكوى بطء الشبكة في فرع الملز — قياس زمن الاستجابة⁩ — النوع: ⁨مشكلة⁩ · المسؤول: ⁨Aziz⁩
2. ⁨STC to confirm the new 10G uplink quote⁩ — النوع: ⁨طلب⁩ · الاستحقاق: ⁨10‏/08‏/2026⁩
3. ⁨اختبار التحويل التلقائي للوصلة الاحتياطية⁩ — النوع: ⁨تغيير⁩ · المسؤول: ⁨Aziz⁩ · الاستحقاق: ⁨20‏/08‏/2026⁩

## ملاحظات (3)

- ⁨ملاحظة: الاجتماع القادم يوم الأحد بدلاً من الاثنين⁩
- ⁨Coffee machine on floor 3 is broken again⁩
- ⁨تأجيل مناقشة تقسيم الشبكات الفرعية إلى اجتماع الحوكمة⁩

## ملاحظات ختامية

⁨اجتماع تشغيلي أسبوعي · قرار التمديد يحتاج موافقة الحوكمة. Vendor quote due next week.⁩
```

#### AR · plain text

```text
⁨اجتماع العمليات الأسبوعي · Weekly ops sync⁩
التاريخ: ⁨30 يوليو 2026⁩
الوقت: ⁨16:34 – 16:45⁩
المسار: ⁨الشبكات⁩
الحضور: ⁨Aziz⁩، ⁨فيصل الحربي (STC)⁩
أعدّه: ⁨Aziz⁩

القرارات (1)
  1. ⁨Core switch firmware rollback plan needs sign-off⁩ — الأولوية: ⁨حرجة⁩

الإجراءات (3)
  1. ⁨تجديد شهادة SSL لبوابة الدفع⁩ — المسؤول: ⁨Aziz⁩ · الاستحقاق: ⁨06‏/08‏/2026⁩ · الأولوية: ⁨عالية⁩
  2. ⁨تركيب مبدّل الوصول في غرفة الشبكة — أُنجز أثناء الاجتماع⁩ — المسؤول: ⁨Aziz⁩ · الأولوية: ⁨عالية⁩
  3. ⁨Renew the Fortinet support contract before Q4⁩ — المسؤول: ⁨بلا مسؤول⁩ · الاستحقاق: ⁨01‏/09‏/2026⁩

بنود أخرى (3)
  1. ⁨شكوى بطء الشبكة في فرع الملز — قياس زمن الاستجابة⁩ — النوع: ⁨مشكلة⁩ · المسؤول: ⁨Aziz⁩
  2. ⁨STC to confirm the new 10G uplink quote⁩ — النوع: ⁨طلب⁩ · الاستحقاق: ⁨10‏/08‏/2026⁩
  3. ⁨اختبار التحويل التلقائي للوصلة الاحتياطية⁩ — النوع: ⁨تغيير⁩ · المسؤول: ⁨Aziz⁩ · الاستحقاق: ⁨20‏/08‏/2026⁩

ملاحظات (3)
  • ⁨ملاحظة: الاجتماع القادم يوم الأحد بدلاً من الاثنين⁩
  • ⁨Coffee machine on floor 3 is broken again⁩
  • ⁨تأجيل مناقشة تقسيم الشبكات الفرعية إلى اجتماع الحوكمة⁩

ملاحظات ختامية
  ⁨اجتماع تشغيلي أسبوعي · قرار التمديد يحتاج موافقة الحوكمة. Vendor quote due next week.⁩
```

**Four things in those four documents that no unit test was going to catch.**

1. **The UI never left English.** The browser chrome, the sidebar and the page
   title were EN throughout; only the *document* switched. That is
   `lib/minutes.ts`'s locale-as-a-parameter design working on a live screen —
   an Arabic record produced for an Arabic-speaking team by someone working in
   English.
2. **The Arabic document localises the data, not just the labels.** `Network` →
   `الشبكات` (the track's own `name_ar`), `Critical` → `حرجة`, `Issue` →
   `مشكلة`, `Unassigned` → `بلا مسؤول`.
3. **Arabic dates carry U+200F.** `06‏/08‏/2026` has RIGHT-TO-LEFT MARKs between
   the fields; the EN document has `06/08/2026` with none. Both are in the
   digests above, so a later "tidy-up" that strips them changes the hash.
4. **Markdown and plain are the same content, differently shaped** — `- [ ]`
   checkboxes and `##` headings against indented `1.`/`•` — which is what
   `MeetingMinutes.tsx`'s header claims when it says the screen and the
   clipboard cannot drift.

> **Verdict** — `PROVEN`.

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

**Method, precisely.** `#/settings/tracks/70b2ef94-f853-4990-974c-6b3027911176`
(Edit track → *Service deadlines for this track*), field **High** set to `2`,
Save. A real admin action in the real screen, not an `insert` — which is why
there is a `config_audit` row with an actor on it.

**Artifact — before.** `select * from public.track_slas` → `[]`, and across
every open entry:

```json
[{"breached":0,"open_entries":17,"with_sla":0}]
```

Zero entries carried an SLA at all, because migration `0005` ships every
`vocab_options.sla_days` NULL. So the priority default is null everywhere and
**any** non-null `sla_due_at` after this write can only have come from
`track_slas`. That is what makes the override branch unambiguous here.

**Artifact — the write, and its audit row.**

```json
[{"track_id":"70b2ef94-f853-4990-974c-6b3027911176","name":"Network",
  "priority":"high","sla_days":2}]

[{"id":"8f31cd4c-db82-4154-b328-e79ee1ab0ecf","table_name":"track_slas",
  "row_id":"70b2ef94-f853-4990-974c-6b3027911176","action":"insert",
  "actor_id":"397d3122-7e3c-4046-ab4d-b45d154c7ac4","before":null,
  "after":{"priority":"high","sla_days":2,"track_id":"70b2ef94-f853-4990-974c-6b3027911176"},
  "created_at":"2026-07-30 14:27:13.325101+00"}]
```

`row_id` is the **track** id, not a synthetic key — `track_slas` is keyed
`(track_id, priority)` and has no id column, so the audit row identifies the
cell by track and puts the priority in the payload. Note also the two `delete`
rows already in that table from earlier rounds (`09:46:27`, and one at
`03:28:23` with `actor_id: null` — a SQL-Editor write, i.e. not through the
app): the audit trail distinguishes an admin using the screen from someone
using the console, which is the point of keeping `actor_id` nullable.

**Artifact — `v_entry_health`, after, for every Network entry.** Three rows
gained an SLA and exactly one breached:

| entry_id | priority | health | sla_due_at | sla_breached |
| --- | --- | --- | --- | --- |
| `7c0a62e8-…` *(rollback plan)* | critical | ok | `null` | false |
| **`3e98aedf-1076-4065-b7b7-2943f5470152`** *(firmware upgrade window)* | high | overdue | `2026-07-19 20:28:39.313591+00` | **true** |
| `46982c0a-…` | high | ok | `2026-08-01 13:50:13.857259+00` | false |
| `43edfd34-…` | high | ok | `2026-08-01 13:50:13.857259+00` | false |
| `57b3ca88-…`, `114fc9c9-…`, `e52ed52e-…`, `9b2e69a8-…`, `302d281e-…` | medium | ok | `null` | false |

```json
[{"breached":1,"with_sla":3,"open":17}]
```

The arithmetic is checkable by hand: `3e98aedf` was created
`2026-07-17 20:28:39.313591+00`; `+ 2 days` is exactly the `sla_due_at` above.
The two Network/high entries created today land on `2026-08-01` and have not
breached. **The Network/critical entry keeps `sla_due_at: null`** — the override
is a `(track, priority)` cell, not a track-wide setting, and a bug that widened
it to the track would have shown up right there.

**Artifact — the client agrees, on the same entry.** `lib/health.resolveSlaDays()`
is a separate implementation from the view's `coalesce(ts.sla_days, vp.sla_days)`,
so the two agreeing is the actual claim. Follow-ups, verbatim from the DOM,
gained a section it did not have before:

```
Past service deadline
1
Open longer than the service window set for their priority.

  ZZ-PROBE slaBreach bucket (Network/high, no due date)
  New · 0d · On track · SLA · Past its service deadline · Unassigned · Network · SLA 2d
```

The **`SLA 2d`** pill is the client having resolved 2 days for this entry — from
the track override, because the priority default is null and a client-side
fallback is forbidden by `lib/health.ts`'s contract.

**Why a probe entry and not the real breaching one — this is a finding, not a
convenience.** `lib/entrySections.ts` ranks the buckets
`overdue > slaBreach > dueSoon > stale > blocked > unassigned` and puts every
entry in exactly one. `3e98aedf` is ten days past its due date, so it renders
under **Overdue** and can never appear in the slaBreach bucket while that is
true. To exercise the bucket itself this pass inserted one entry that is SLA-
breached and *not* overdue —
`e91d88f3-aa4c-4423-8db4-c8aa6fc5b8fb`, Network/high, `due_date null`,
`created_at = now() - 5 days` — read the bucket, and **deleted it again**:

```json
[{"id":"e91d88f3-aa4c-4423-8db4-c8aa6fc5b8fb",
  "title":"ZZ-PROBE slaBreach bucket (Network/high, no due date)"}]   -- delete … returning
[{"still_there":0}]
[{"breached":1,"with_sla":3}]                                        -- back to the real one
```

With it gone, `Past service deadline` disappears from Follow-ups
(`hasBucket: false`) — so the section is driven by data and is not a heading
that renders unconditionally.

**Artifact — the dashboard compliance panel, and why it does NOT move.**
`lib/aggregate.slaCompliance()` measures **resolved** work
(`status = 'done'`, `closed_at` in the window), and this workspace has exactly
one resolved entry:

```json
[{"id":"eaff6bee-4b6f-4982-a6fd-0fb5da7f1039","title":"Branch VPN tunnel flap",
  "track_id":"70b2ef94-…","priority":"critical","status":"done",
  "created_at":"2026-07-14 20:28:39.313591+00",
  "closed_at":"2026-07-29 20:28:39.313591+00","days_to_close":15}]
```

It is Network/**critical** — a cell the armed override does not cover — so with
`(Network, high) = 2` in force the panel correctly reads:

```
—
No deadline was set
Service deadlines met
1 item was resolved, and no service deadline was set for it.
```

That is the panel *agreeing with the matrix*, not the panel being broken. But an
unchanging "—" is exactly the kind of reading that passes for the wrong reason,
so it was broken on purpose (§0 rule 4).

> **Negative control (executed)** — arm `(Network, critical) = 1` — the cell the
> resolved entry actually occupies — reload, read the panel, then remove it.
>
> ```
> with (Network, critical) = 1     →   0%
>                                      0 of 1 met · 1 missed      [Critical bar]
> after deleting that row          →   —
>                                      No deadline was set
>                                      1 item was resolved, and no service deadline was set for it.
> ```
>
> `eaff6bee` took 15 days against a 1-day promise, so `0 of 1 met` is the right
> answer and not merely a different one. The control row was inserted and
> deleted through the management API (owner role, hence `actor_id: null` if you
> go looking in `config_audit`) and **is not in force now** — the only surviving
> override is `(Network, high) = 2`.

**Durable or rolled back? DURABLE, and loudly.** `(Network, high) = 2` is
**left armed**. Arming an SLA is retroactive by construction: the moment it
saved, `Core switch firmware upgrade window` (`3e98aedf-…`, open since 17 July)
began reporting as past its service deadline, and every future Network/high item
gets two days from creation. One entry reports breached today. The undo is one
statement, in §7.

> **Verdict** — `PROVEN`. The override branch resolves in both implementations,
> they agree entry-for-entry, the cell does not leak to other priorities, and
> the compliance panel reads the same matrix — shown by making it change and
> change back.

---

## 4A. Recurring templates — Run now, the advance, and the pause

*Added by the GAP-6 pass; the skeleton had no section for `0008`'s Part 2 on
live data.*

The subject is template **`f3492bf8-b162-4f25-afd4-9cf453e1f1a8`**,
*"التقرير الأسبوعي لتشغيل الشبكة · Weekly network ops report"* — Network,
`type: action`, `priority: medium`, owner `Aziz`, **weekly on Thursday**
(`day_of_week: 4`), `lead_days: 2`. Created by the partial round that preceded
this pass; adopted here for the same reason as the meeting.

### 4A.1 Run now creates exactly one entry, and is idempotent

> **Claim** — "Run now" materialises exactly one entry per occurrence, and
> clicking it again the same day creates nothing.
> **Method** — `#/settings/recurring` → **Run now**, then re-read Postgres.

**Artifact — before and after are the same row.** The template's entries, after
the click this pass made:

```json
[{"id":"302d281e-ed21-4f99-8c4c-333baf5ba87e",
  "title":"التقرير الأسبوعي لتشغيل الشبكة · Weekly network ops report",
  "due_date":"2026-08-01","template_id":"f3492bf8-b162-4f25-afd4-9cf453e1f1a8",
  "created_at":"2026-07-30 14:03:10.149773+00"}]

[{"next_run_on":"2026-08-06","active":false,"entries":1}]
```

`created_at` is **14:03:10** — the earlier click. This pass clicked Run now at
roughly 14:33 and the row did not change, was not duplicated, and `next_run_on`
did not move. That is `materialize_template`'s absorb path: the due date is
anchored to `current_date + lead_days` (`2026-07-30 + 2 = 2026-08-01`), the
`(template_id, due_date)` unique index swallows the second insert, and the
function early-returns the existing entry before reaching the advance.

**The advance happened exactly once.** `2026-08-06` is `2026-07-30 + 7` — one
weekly occurrence from the creation date, not a loop that ran forward to clear
the backlog. That is the whole of `0008` Part 2; the pre-`0008` code would have
advanced past today in a `while` loop and eaten every owed occurrence.

> **Verdict** — `PROVEN`.

### 4A.2 Paused means the scheduler skips it

> **Claim** — `materialize_due_recurring()` skips a paused template, and the
> skip is because of the pause rather than because of the date.
> **Method** — a single `do $probe$ … $probe$` block that makes the template due
> **today**, runs the scheduler paused, then unpauses and runs it again, and
> ends by raising a sentinel exception so **every change is discarded**. The
> measurements ride out in the error message; nothing survives.

A naive version of this test passes against a broken `where rt.active`, because
the template's `next_run_on` is `2026-08-06` — in the future — and would be
skipped for the date whatever the flag said. So the probe moves the date first,
and deletes the existing entry so the unique index cannot disguise a genuine
creation as a skip.

**Artifact — the raised measurement, verbatim:**

```
ERROR:  P0001: PROBE-2 || start: next_run_on=2026-08-06 active=f entries=1
        || PAUSED due-today:   created=0  next_run_on=2026-07-30  entries=0
        || UNPAUSED due-today: created=1  next_run_on=2026-08-06  entries=1
CONTEXT:  PL/pgSQL function inline_code_block line 31 at RAISE
```

Paused and due today: **zero** entries created and `next_run_on` left where it
was. The identical state with the pause lifted: **one** entry created and
`next_run_on` advanced one weekly occurrence. The negative control is the second
half of the same block, which is what makes the first half mean anything.

**Artifact — the rollback held:**

```json
[{"id":"f3492bf8-b162-4f25-afd4-9cf453e1f1a8","next_run_on":"2026-08-06",
  "active":false,"entries":1}]
```

> **Verdict** — `PROVEN`.

### 4A.3 Left live, on purpose

The assignment says to leave this template as real workspace furniture, so it
was **resumed** after the proof — a paused recipe is not furniture, it is a
disabled one.

```json
[{"id":"f3492bf8-b162-4f25-afd4-9cf453e1f1a8",
  "title":"التقرير الأسبوعي لتشغيل الشبكة · Weekly network ops report",
  "cadence":"weekly","day_of_week":4,"lead_days":2,"next_run_on":"2026-08-06",
  "active":true,"track_id":"70b2ef94-f853-4990-974c-6b3027911176",
  "owner_id":"397d3122-7e3c-4046-ab4d-b45d154c7ac4","priority":"medium",
  "type":"action"}]
```

**What this will do on its own, so nobody is surprised by it:** on
**2026-08-06** the nightly `pg_cron` pass (03:15 UTC) creates one Network entry
titled *"التقرير الأسبوعي لتشغيل الشبكة · Weekly network ops report"* owned by
Aziz, due `2026-08-08`, and moves `next_run_on` to `2026-08-13`. Then every
Thursday after that. Nothing fires before 2026-08-06 — `next_run_on` is in the
future, which is why resuming it was safe to do today. §7 has the pause and the
delete.

> **Verdict** — `PROVEN`, durable, and deliberate.

---

## 5. Gate (e)/(g) — members, the second admin, and the claim lifecycle

### 5.1 An admin provisions and removes a member

> **Claim** — the admin can create, list, reissue and delete through the app's
> Members screen, and every action goes through `admin-members` rather than the
> browser.
> **Method** — `#/settings/members` as `Aziz` (admin): **Add member** →
> username `zzthrowaway.gap6`, display name `ZZ Throwaway GAP-6`, role Member →
> **Create and issue code**; then **Delete** on that row and confirm.

**Artifact — created.** The screen showed the one-time code panel:

```
One-time invite code
For ⁨zzthrowaway.gap6⁩
<code redacted — see §5.4's rule>
Expires ⁨13/08/2026, 17:40⁩
This is the only time this code is readable. … the server keeps no copy …
```

and Postgres agreed:

```json
[{"id":"9cf43cd8-bec8-46a4-9d28-91fb8c45ea51",
  "email":"zzthrowaway.gap6@opstrack.internal","username":"zzthrowaway.gap6",
  "claimed":"false","hash8":"67e1f4f6","alg":"hmac-sha256-v1",
  "display_name":"ZZ Throwaway GAP-6","role":"member"}]
```

`invite_alg: hmac-sha256-v1` is **S1e landing on live data**: a freshly minted
invite stores a peppered HMAC, not the bare SHA-256 that `zzprobe.pending` still
carries. The two fixtures now differ in exactly the way the migration path needs
them to.

**Artifact — deleted.** Delete opened the app's own confirmation
(`role="alertdialog"`, not `window.confirm`):

```
Remove this member?
⁨ZZ Throwaway GAP-6⁩ loses access immediately. Their entries, updates and meeting
notes stay, credited to their name.
Cancel   Delete
```

and after confirming, the row is gone from **both** tables:

```json
[{"in_auth_users":0}]
[{"in_profiles":0}]

[{"id":"397d3122-…","email":"az.alsaloom@gmail.com","display_name":"Aziz","role":"admin"},
 {"id":"7bd33430-…","email":"zzprobe.claimed@opstrack.internal","display_name":"Probe Claimed","role":"member"},
 {"id":"dbb9ef96-…","email":"zzprobe.pending@opstrack.internal","display_name":"Probe Pending","role":"member"}]
```

Deleting an `auth.users` row and leaving an orphan in `public.profiles` is the
obvious way for this to be half-done; it is not.

**Negative control** — the same screen refuses the admin's own row: *"You can't
remove your own admin role. You can't delete your own account."* rendered
against `Aziz` and only against `Aziz`, while the other three rows carry live
`Delete` and `Make admin` buttons.

> **Verdict** — `PARTIAL — create, list and delete are PROVEN through the app.
> Reissue ("New code") was NOT exercised.`

### 5.2 A member cannot

> **Claim** — a non-admin calling `admin-members` gets `403`, and a non-admin
> attempting an admin-only write in the app gets `42501` — an error from the
> server, not a hidden button.
> **Method** — sign in as a member; call the function with that session; attempt
> a track write.
> **Artifact** — both raw responses, status codes included.
> **Negative control** — the same two calls as the admin, succeeding.
> **Verdict** — `NOT RUN BY THE GAP-6 PASS`. It needs a signed-in non-admin
> session, and that pass never authenticated as anybody but the existing admin
> — see the note under §5.4.

### 5.3 The second admin

> **Claim** — an account promoted to `profiles.role = 'admin'` can/cannot
> provision members, and `ADMIN.md` says which.
> **Method** — promote a second account in the SQL Editor, sign in, try to
> provision.
> **Artifact** — the promoting statement, the sign-in, the response from
> `admin-members`, and the paragraph in `ADMIN.md` that predicted it.
> **Negative control** —
> **Verdict** — `NOT RUN BY THE GAP-6 PASS`. Same reason as §5.2: it requires
> signing in as a second account.

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

**The redemption half was deliberately NOT performed, and the reason is not a
technical one.** Redeeming an invite means choosing a password for an account
and then signing in with it. That is credential creation, and it is the one step
in this ledger an autonomous agent should not take on someone's behalf — so this
pass stopped at the boundary and is saying so instead of quietly doing it. What
that leaves unproven is listed in §8 with the exact steps, which take about two
minutes by hand:

1. `#/settings/members` → **New code** on `zzprobe.pending` (do **not** use the
   throwaway; it is deleted, and `zzprobe.pending` is the only carrier of the
   pre-pepper legacy digest — see §1.2).
2. `#/claim`, username `zzprobe.pending`, the code, a password.
3. Re-read the metadata: `invite_hash` present → null, `claimed` false → true,
   `claimed_at` set.
4. Replay the same code → must be `403 invalid_invite`, byte-identical to the
   bodies in §5.5.
5. Sign in with the chosen password.

Step 2 also exercises `verifyCode()`'s **legacy branch**, which no live request
has ever taken — `zzprobe.pending` has no `invite_alg` tag, so its stored digest
is a bare pre-pepper SHA-256, and every account minted since (including the
throwaway in §5.1, `alg: hmac-sha256-v1`) takes the HMAC branch instead.

**What IS proven here** is the half that needs no credential: every
account-dependent *failure* is indistinguishable. That is §5.5, and it is the
part S1a was actually about.

> **Verdict** — `PARTIAL — the rejection half is PROVEN in §5.5 across four
> distinct internal outcomes; issue → redeem → sign in → replay is NOT PROVEN,
> by choice, and is the one thing in this ledger that needs a human.`

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

**Method.** `POST {VITE_SUPABASE_URL}/functions/v1/claim-account` with the
**public anon key** (the one compiled into every browser bundle — this endpoint
has to be reachable by someone who has never signed in), body
`{username, inviteCode, password}`. Every `inviteCode` below is wrong on
purpose; no account was ever claimed. `password` was a ≥8-character placeholder,
which matters: a short one returns `weak_password` **before** the invite is
looked at, so a probe using `"x"` measures the password validator and not the
throttle. That mistake was made once here and is recorded so the next person
does not repeat it.

**Artifact — S1a, four different internal outcomes, one answer.**

| # | username | what it really is inside | status | body |
| --- | --- | --- | --- | --- |
| A | `zzthrowaway.gap6` | real, unclaimed, invite outstanding | `403` | `{"error":"That invite code is wrong, already used, or expired","code":"invalid_invite"}` |
| B | `zznosuchuser.gap6` | **no such user** | `403` | *identical* |
| C | `zzprobe.claimed` | real, **already claimed** | `403` | *identical* |
| D | `az.alsaloom` | real, but a **real-email** account that never had an invite | `403` | *identical* |

Four states that the pre-S1 code distinguished — including the `409` that
"already claimed" used to get — now produce one answer. Digest of the shared
body, so a later reword is detectable:

```
c00beebc5e1a4aeb03969b4bd4633708865889410a0ecc0476df91553b748141
```

**Artifact — not just the body: the whole response.** Two requests, one against
a real pending account and one against a fictional username, captured with
headers:

```
HTTP/2 403                                    (both)
sha256(body) = c00beebc…                      (both, identical)

diff of response headers, with only the genuinely volatile ones removed
(date, cf-ray, set-cookie/__cf_bm, sb-*, x-deno-*, server-timing, content-length):
  → no differences
```

The surviving header set is the same for both:

```
access-control-allow-headers: authorization, x-client-info, apikey, content-type
access-control-allow-methods: POST, OPTIONS
access-control-allow-origin: *
cf-cache-status: DYNAMIC
content-type: application/json
endpoint-load-metrics: application_utilization:4,named_metrics.queue_depth:4
server: cloudflare
strict-transport-security: max-age=31536000; includeSubDomains; preload
vary: Accept-Encoding
```

Status, body, digest and headers all agree. There is no oracle left in the
response.

**Artifact — `claim_counters` went from 0 rows to non-empty. Migration `0010`
has now executed against live data.**

```json
[{"scope":"ip","bucket":"42753f287f7fae3fa2ebc4d4ff256902d7e522c9","n":4,
  "window_start":"2026-07-30 14:41:32.661884+00"},
 {"scope":"username","bucket":"az.alsaloom","n":1,"window_start":"2026-07-30 14:41:37.752120+00"},
 {"scope":"username","bucket":"zznosuchuser.gap6","n":1,"window_start":"2026-07-30 14:41:34.357255+00"},
 {"scope":"username","bucket":"zzprobe.claimed","n":1,"window_start":"2026-07-30 14:41:36.030936+00"},
 {"scope":"username","bucket":"zzthrowaway.gap6","n":1,"window_start":"2026-07-30 14:41:32.676646+00"}]
```

Read the buckets. `scope = 'username'` holds the **submitted string** — so
`zznosuchuser.gap6`, a username that does not exist, **has a counter row of its
own**. That is the second negative control the skeleton asked for: if
nonexistent usernames were not counted, an attacker could ask "am I being
throttled?" and receive "does this account exist?". `scope = 'ip'` is a
peppered hash (`42753f28…`) and reveals no address.

**Artifact — the negative control that matters: S1c, two guesses in parallel.**
Two requests fired concurrently at a bucket that did not exist beforehand:

```
status=403 time=2.437822s   {"error":"That invite code is wrong, …","code":"invalid_invite"}
status=403 time=2.439603s   {"error":"That invite code is wrong, …","code":"invalid_invite"}

[{"scope":"username","bucket":"zzparallel.gap6","n":2,
  "window_start":"2026-07-30 14:42:14.987717+00"}]
```

**`n = 2`.** This is the whole of S1c and the reason `0010` exists: the previous
implementation read-modify-wrote `user_metadata` through an API with no
compare-and-set, and two overlapping requests would have left `n = 1` — a
throttle an attacker beats by opening two connections. `claim_bump()`'s
`insert … on conflict do update set n = c.n + 1` is atomic in the database, and
the two responses landing 1.8 ms apart is what makes this a real race rather
than a sequential pair with extra steps.

**Artifact — delay, never refusal, and capped.** Four sequential wrong guesses
at a fresh username bucket:

| attempt | status | wall clock |
| --- | --- | --- |
| 1 | `403 invalid_invite` | 3.370 s |
| 2 | `403 invalid_invite` | 5.335 s |
| 3 | `403 invalid_invite` | 5.428 s |
| 4 | `403 invalid_invite` | 5.414 s |

Nothing was ever refused — the answer stays `403 invalid_invite`, never a lock
and never a `429`, with the shared per-address counter at `n = 10` against a
volume ceiling of 200. The delay is flat at the top because
`delay = backoffMs(max(userCount, ipCount))` and the **address** counter was
already past the curve's cap from probes A–D, so every attempt draws
`BACKOFF_MAX_MS` (4 s) on top of a ~1.4 s baseline. That is the cap doing its
job — an uncapped curve is a self-inflicted outage, since a sleeping request
holds a worker.

**Honest limits of the timing evidence.** These are wall-clock times over the
public internet to `ap-northeast-2`, from one machine, single-sampled. Probe A
took 3.56 s on its first call (cold start) against ~1.6 s for B, C and D
immediately after — which is a *function* effect, not an *account* effect, but
it does mean this run cannot make a fine-grained constant-time claim. What it
does show is that the coarse behaviour is identical and that the delay is a
function of counter state, not of whether the account exists. A proper
constant-time argument would need many samples per state and a distribution
comparison; §8 carries it.

> **Verdict** — `PROVEN` for S1a (four internal states, identical status, body,
> digest and headers), S1b (delay, never refusal, capped) and **S1c (parallel
> guesses count as two)**. `PARTIAL` on latency indistinguishability, which is
> shown coarsely and not statistically.

Two things must remain untrue at the end of this section, and both are worth
asserting rather than assuming: no sequence of wrong guesses locks a member out
of claiming with a valid code, and no response or latency distinguishes a real
username from a fictional one.

**Of those two, only the second is shown above.** The first — "a member holding
a real code always gets in, however many times they mistyped it" — cannot be
proven without redeeming a real code, which §5.4 explains this pass did not do.
It is the single most important unproven claim in this ledger, because it is the
one whose failure locks a real person out of their own account. §8 carries it
first.

---

## 6. Gates (d), (f), (h), (i)

### 6.1 (d) Keyboard and the command palette

> **Claim** — every shortcut in the spec works, is listed in the cheatsheet, and
> the palette reaches any track, entry or action.
> **Method** —
> **Artifact** — a table of shortcut → observed effect, in both locales; the
> cheatsheet described.
> **Negative control** — a shortcut fired inside a text input must **not** act.
> **Verdict** — `NOT RUN BY THE GAP-6 PASS`. The palette and cheatsheet were exercised by the Wave-4b integration and reported in its commit message, which §0 rule 1 does not accept as evidence.

### 6.2 (f) The edge functions were redeployed and invoked twice

> **Claim** — both functions were redeployed after their last modification, and
> the deployed version is the source in this repo.
> **Method** — `npx supabase functions deploy … --use-api`, then
> `npx supabase functions list`, then two invocations.
> **Artifact** — the `list` JSON showing `version` and `updated_at` *after* the
> commit timestamp; both invocation responses (the first may cold-start).
> **Negative control** —
> **Verdict** — `NOT RUN BY THE GAP-6 PASS` as a redeploy check. Note that §5.1 and §5.5 both invoked `admin-members` and `claim-account` successfully against the live project, so the deployed versions are at least reachable and behaving — but no `functions list` was captured and no `version`/`updated_at` was compared against the commit timestamp, which is what this gate actually asks for.

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
> **Verdict** — `NOT RUN BY THE GAP-6 PASS`.

### 6.4 (i) The update prompt

> **Claim** — a new deploy raises the sticky "new version available" toast, it
> survives three ordinary toasts landing on top of it, and it applies only on
> tap.
> **Method** — deploy, keep a session open, fire three toasts, then tap.
> **Artifact** — described screenshots at each step; the Pages run id of the new
> deploy; the asset hash before and after the reload.
> **Negative control** — the three ordinary toasts must be the ones evicted.
> This is FIX-BACKLOG **C6**; the whole point is that the sticky one stays.
> **Verdict** — `NOT RUN BY THE GAP-6 PASS`. Needs a fresh Pages deploy, and that pass never left the dev server.

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
> **Verdict** — `NOT RUN BY THE GAP-6 PASS`. `push_subscriptions` is still 0 — see the fingerprint. Nothing here has moved.

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
> **Verdict** — `NOT RUN BY THE GAP-6 PASS`. Three simulator screenshots from an earlier round are in `shots/`; they are unnarrated files, which §0 says is not evidence until somebody describes them.

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

### Added by the GAP-6 proof run, 2026-07-30

| Table | Id | Why | Durable? | Cleanup owner |
| --- | --- | --- | --- | --- |
| `meetings` | `0136ab58-5c33-4da5-98eb-82be5ff3e511` | the ten-line bilingual meeting §3A is built on; ended `13:45:49+00` | **yes — keep** | permanent; deleting it voids §3A |
| `meeting_lines` | 10 rows, `meeting_id = 0136ab58-…`, `seq` 1–10 | the sentences themselves, incl. the two `discarded` and one `note` | yes, with the meeting | as above |
| `entries` | the 7 rows with `created_at = 2026-07-30 13:50:13.857259+00` | triage's bulk commit; the identical timestamp *is* the §3A.3 artifact | yes | workspace data now — treat as real |
| `recurring_templates` | `f3492bf8-b162-4f25-afd4-9cf453e1f1a8` | §4A. **Left `active = true`**; fires 2026-08-06 and every Thursday after | **yes, deliberately** | nobody — real furniture. Pause: `update public.recurring_templates set active = false where id = 'f3492bf8-…';` |
| `entries` | `302d281e-ed21-4f99-8c4c-333baf5ba87e` | the one entry that template's "Run now" produced, due 2026-08-01 | yes | workspace data |
| `track_slas` | `(70b2ef94-…, 'high')` = **2 days** | §4. **Left armed.** Retroactive: `3e98aedf-…` reports breached from the moment it saved | **yes, deliberately** | Wave 5 decides. Undo: `delete from public.track_slas where track_id = '70b2ef94-f853-4990-974c-6b3027911176' and priority = 'high';` |
| `config_audit` | `8f31cd4c-db82-4154-b328-e79ee1ab0ecf` | the audit row for that write, actor `Aziz` | yes | permanent by design |
| `entries` | `cf7d4d12-31e9-4e69-a082-10d99c6214d7`, `1ac8e152-a9db-429d-92a5-ee4db2d03d40` | §3.1's two offline captures (`ZZ-OFFLINE-1/2`). **Kept**, because "the rows reached Postgres" is the claim and deleting them makes §3.1 unre-checkable | yes | Wave 5, once §3.1 is accepted: `delete from public.entries where title like 'ZZ-OFFLINE-%';` |
| `claim_counters` | 7 rows: `ip/42753f28…` and `username/{az.alsaloom, zzcurve.gap6, zznosuchuser.gap6, zzparallel.gap6, zzprobe.claimed, zzthrowaway.gap6}` | §5.5. The first live rows this table has ever held | yes, but **self-expiring** — the window is 15 min, so they are inert; kept as the artifact | Wave 5: `delete from public.claim_counters;` — safe at any time |

**Created and already removed by this run** — listed so the ids in the body of
the ledger resolve to something, and so nobody hunts for rows that are gone:

| Table | Id | What it was | Removed |
| --- | --- | --- | --- |
| `auth.users` + `profiles` | `9cf43cd8-bec8-46a4-9d28-91fb8c45ea51` (`zzthrowaway.gap6`) | §5.1's throwaway member | yes — through the app's own delete; absent from both tables |
| `entries` | `e91d88f3-aa4c-4423-8db4-c8aa6fc5b8fb` | §4's `ZZ-PROBE` entry, the only way to make the slaBreach bucket render | yes — verified `still_there: 0` |
| `track_slas` | `(70b2ef94-…, 'critical')` = 1 day | §4's dashboard-compliance negative control | yes — only `(Network, high)` survives |

**Nothing in `zzprobe.pending` or `zzprobe.claimed` was touched.** §1.2 asked for
that and §5.4 explains why `zzprobe.pending` matters more than ever now: it is
the only account left carrying a pre-pepper digest, and the throwaway that could
have been compared against it has been deleted.

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

### Found or left open by the GAP-6 proof run, worst first

| # | Gap | Why it is open | Lands on |
| --- | --- | --- | --- |
| 1 | **A valid code is still accepted after wrong guesses** — S1b's whole promise | needs a real redemption, which means creating a password. This pass stopped at that boundary on purpose (§5.4). It is the failure mode that locks a real person out of their own account, so it should be closed by hand before release | a human, ~2 min, steps in §5.4 |
| 2 | The invite/claim happy path: issue → redeem → sign in → replay dies | same reason | same |
| 3 | `verifyCode()`'s **legacy pre-pepper branch** has never run live | only `zzprobe.pending` carries an untagged digest, and redeeming it needs a password. Every account minted since is `hmac-sha256-v1` (§5.1), so this branch is one deletion away from being untestable forever | same session as #2 — and **do not delete `zzprobe.pending` first** |
| 4 | Latency indistinguishability is coarse, not statistical | single-sampled wall clock over the public internet; a cold start made probe A 2 s slower than B/C/D, which is a function effect but does muddy the measurement (§5.5) | Wave 5, if a constant-time claim is wanted in writing |
| 5 | Mid-meeting tab kill with the sequence continuing at `seq 11` | recovery from a cold reload is proven (§3A.2); the kill *during* an open meeting is not. Proving it means reopening the meeting whose minutes §3A.4 hashes, or staging a scratch meeting | Wave 5, on a scratch meeting |
| 6 | The **installed PWA** offline, from cache, in real airplane mode | §3.1 ran in a browser tab with the transport hard-failed. That is stricter at the network layer but says nothing about the service worker serving the shell with no server at all | Wave 5, on a real device |
| 7 | The outbox **discard** path | §3.1 queued two and flushed two; nothing was discarded, so "discard leaves no row" is untested live | Wave 5 |
| 8 | §3.2–3.5 entirely: temp-id rewriting, duplicate suppression across an interrupted drain, two-device last-write-wins, `last_activity_at` under a track move | this pass queued two creates and no updates, never interrupted a drain, and ran as one signed-in user | Wave 5 |
| 9 | §5.2, §5.3 — the member's `403`, the `42501`, and the second admin | all three need a second signed-in session | Wave 5, after #2 gives it one |
| 10 | §2 the build gate, §6.1–6.4, §6.6 | not attempted; the pass never left the dev server | Wave 5 |
| 11 | Web push (§6.5) | untouched. `push_subscriptions` is still 0 | Wave 5 |
| 12 | **Screenshots are described but not filed** | the automation pane in use returned unstable region captures, so §3.1/§3A/§4 use verbatim DOM text and SQL instead of PNGs. That is arguably the better artifact — a hash-checkable string beats an image nobody re-reads — but `shots/` has no new files and §0.2's "described screenshot" is only half-satisfied | noted, not scheduled |

**One process finding, which is really a finding about this ledger.** When the
GAP-6 run opened, the live project already held a ten-line meeting, seven
committed entries and a recurring template that **no document mentioned** — the
row counts in the fingerprint above were stale by 8 entries. The work was real
and good; the record of it did not exist, which is the exact failure that caused
the Wave-4 critic to reject the previous round. This run adopted those rows and
wrote them up (§3A, §4A) rather than staging duplicates. The lesson for Wave 5:
**write the evidence in the same sitting as the action**, because a proof round
that ends without its artifacts leaves the next person unable to tell a finished
feature from an abandoned one.

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
