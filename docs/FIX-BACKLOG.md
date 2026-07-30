# OpsTrack — fix backlog

**Consolidation of 8 deep audits, opened after Wave 2 and dispositioned at the
Wave-4b close.** Baseline is now HEAD `8a0b2f2`+ (Wave 4's fix reconciliation);
`npm run test` = **47 files / 1217 tests green**, re-run 2026-07-30. Every item
below carries a **Disposition** — the state of the *finding*, which is not the
same thing as the auditor's proposed fix. The line the auditors wrote as
*"Disposition: …"* has been renamed *"Prescribed fix: …"* throughout, because
three passes read it as a status and it never was one.

The original text of each finding is preserved verbatim, including the file:line
references, which are **as-audited at `64af420`** and have drifted. Do not follow
a line number in this document into an editor without grepping for the symbol
first — several files have moved by hundreds of lines since. Where a re-location
was already done it is marked *(re-located)* inline.

Everything the auditors claimed was re-checked against the code at `64af420`;
parser, dates, entryFilter and sort claims were re-executed, and the DB/PostgREST
claims re-probed read-only against `lrysgpbkmuqgzsjesfkr`. The dispositions below
were established at `8a0b2f2` by reading the code and the live database again —
not by trusting the commit messages that claimed the fixes — and then re-checked
against the Wave-4b working tree, which is where the whole **S1** cluster moved.

Baseline caveat worth stating plainly: `47 files / 1217 tests` is the count at
`8a0b2f2`. The Wave-4b tree adds the command palette, export, web push, the
Members screen and migrations `0010`/`0011`, so the number at merge will be
higher. Re-run `npm run test` and update this line rather than assuming it.

---

## How to read a Disposition

| Token | Means |
| --- | --- |
| `fixed-in-<sha>` | The defect is gone at that commit, verified by reading the code (or the live database) again — not by trusting the commit message. |
| `fixed-in-<wave4b>` | Fixed in the Wave-4b pass, in the commit that carries this file. **The integrator replaces `<wave4b>` with the sha** — only the integrator commits, so nobody writing these rows could know it. |
| `open` | Still true at the Wave-4b close. Nobody has decided against it; it has not been done. |
| `rejected-with-reason` | The finding is accurate and the fix was **declined** on purpose, with the argument recorded in the code next to the thing that was not changed. **No item is in this state today** — **S1c** was, and Wave 4b reversed it. |
| `superseded` | A later decision made the finding moot. No item is in this state today. |

Three things a disposition deliberately does **not** say.

It does not say the *prescribed* fix was the one applied. Several were resolved
differently and a few were resolved better; where that happened the note says so.

It is not a promise about **production**. An edge-function fix lands in the repo
and reaches users only on redeploy, and none of the three functions under
`supabase/functions/` is covered by `tsc` or `oxlint` — see **S1d** and **S1e**,
and Wave-4 acceptance gate (f).

And it is not permanent. **S1c** spent a wave as `rejected-with-reason` with a
genuinely good argument (the boundary is the credential, not the counter) and was
then fixed anyway, because migration `0010` made the atomic version cheap. A
disposition records a decision, not a verdict; re-read the `open` and
`rejected-with-reason` rows whenever the cost of the fix changes.

---

## Label collisions, disambiguated

Three overlapping naming schemes exist for these findings. This is the whole
mapping; nothing else in the repo records it.

**1. `M1` / `M2` / `M3` mean two entirely different sets of things.** Commit
`c4bf788`'s message has a `BACKLOG` block listing `C3`–`C8`, then `M1`, `M2`,
`M3`. The `C` labels are this document's. **The `M` labels are not.** They came
from the Wave-2 verification pass, whose list was never written down here, and
they name three different defects:

| Label | In **this document** | In **`c4bf788`'s commit message** |
| --- | --- | --- |
| `M1` | parser: a punctuation/emoji-only *quoted* value takes the "quoted empty" path — consumed, no field, no problem reported | store: an RLS-filtered read returns `200 []`, so an unauthenticated load cached `[]` and `loadedAt` short-circuited the rest of the session |
| `M2` | parser: `ESCAPED_SIGIL_RE` covers the five sigils but not the keyed prefixes, so `capture.hintEscape`'s promised workaround does not exist for `d:`/`f:`/`due:` | store: `members` was never warmed by a list screen, so owned entries read "Unassigned" until a sheet opened |
| `M3` | dates: `addDays`/`addMonths`/`diffDays`/`toIsoDate` re-enter the two-digit-year trap `parseIsoDate` guards | parser: an unquoted multi-word `#track` left the tail in the title |

Both sets are real and both were fixed; they are simply different work. `c4bf788`
fixed *its* three (they are the `M1`/`M2`/`M3` in tasks #22–#24), and this
document's three were fixed later, in `8a0b2f2`. A reader who assumes one set is
the other will conclude that either the parser fixes or the store fixes never
happened.

**2. The Wave-4 fixers renamed this document's minors to mnemonic slugs**, in
code comments, precisely to escape the collision above — and never wrote the
mapping back here. If you grep the source for a backlog label you will find
these, not `M1`:

| This document | Slug used in code comments | Where |
| --- | --- | --- |
| **M1** | `PARSE-PUNCT` | `src/lib/capture/parse.ts:500` |
| **M2** | `PARSE-ESCAPE` | `src/lib/capture/parse.ts:312` |
| **M3** | `DATE-YEAR` | `src/lib/dates.ts:83`, `src/lib/dates.test.ts:170` |
| **S2** | `PERM-BRANCH` | `src/lib/permissions.ts:49`, `src/lib/permissions.test.ts:20` |
| **S3a** | `SLA-MATRIX` | `src/store/entries.ts:184`, `src/lib/aggregate.ts:30,413`, `src/pages/Dashboard.tsx:26`, `src/pages/settings/TrackEditor.tsx:361` |
| **S3b** | `DERIVE-HEALTH` | `src/store/entries.test.ts:495` |
| **S3c** | `BATCH-SETSTATE` | `src/store/entries.ts:1270`, `src/store/entries.test.ts:683` |
| **S4** | `OUTBOX-DRAIN` | `src/store/outbox.test.ts:432` |

Slugs are the better scheme and new findings should use them. The `S`/`C`/`M`/`P`/`D`
labels are kept here because eight audits, four commit messages and the execution
plan all cite them.

**3. `S1`–`S5` are cluster labels, not severities.** They come from the dedup
table below: `S1` is the claim-account cluster (five sub-items `a`–`e`), `S3` the
`derive()` health cluster, `S5` the Arabic bidi cluster. `S2` and `S4` are
single items that were numbered into the same sequence. There is no `S1`, `S3`
or `S5` item as such — only their letters.

---

## Disposition table

Every item, its state, and — where the fix differed from what the auditor
prescribed — what was actually done. **9 of 46 are open** and 37 are fixed;
nothing is `rejected-with-reason` or `superseded` any longer. Nothing open is a
blocker, and every major except **P2** is closed.

### Exploitable security

| Item | Sev | Disposition | Note |
| --- | --- | --- | --- |
| **S1a** | major | `fixed-in-<wave4b>` | Fixed twice over, and the second half is the one the auditor did not see. **Responses:** every outcome that depends on the target account now takes one `reject()` — same `403`, same body, same counter bump. The `already_claimed` `409` carve-out that `8a0b2f2` had defended in-source as "a product decision" is **overruled and gone**; the member who forgot is told by `claim.errInviteInvalid` to check both fields or ask their admin, which is the correct advice anyway since reissue *is* the reset. **Latency:** v2 found the account by paging `listUsers({perPage: 200})` up to five times, so a hit on page 1 answered after one round trip and a miss after five — the response was constant and the *timing* was the oracle. `0010`'s `claim_lookup()` is one indexed read, constant either way, and it lifts a silent 1000-account cap nobody had noticed. |
| **S1b** | major | `fixed-in-<wave4b>` | Resolved by **deleting the refusal**, which is better than the prescribed exponential-delay-plus-limit because it removes the DoS rather than pricing it. The counter now buys backoff and nothing else: capped, applied before the work, then the request is processed — a member holding a real code always gets in. Two dimensions, and the second is new: the submitted username *string* and the caller's address prefix (/24 or /48, so rotating inside a subnet is not free); the larger decides the delay. One hard refusal remains and it is deliberately not account-shaped — a per-IP volume ceiling far above human reach, answering `429`, which can only shut out the machine spraying. |
| **S1c** | major | `fixed-in-<wave4b>` | **Previously `rejected-with-reason`; that decision was reversed.** Migration `0010` moves the counter into `public.claim_counters` and `claim_bump()` is `insert … on conflict do update set n = c.n + 1 … returning c.n` — one statement, one row lock, re-evaluated against the committed row, so two parallel guesses return 1 and 2 rather than 1 and 1. The table is RLS-on with **no policies**, revoked from `anon`/`authenticated`, and all three functions are `EXECUTE`-granted only to `service_role`; without that, the anon key in the shipped bundle would let anyone inflate a stranger's backoff. Applied live and verified: `to_regclass('public.claim_counters')` is non-null. |
| **S1d** | minor | `fixed-in-8a0b2f2`, then **eliminated** in `<wave4b>` | `8a0b2f2` stopped both writes from spreading a stale snapshot and named only the keys they meant to change. The Wave-4b rewrite removes the class of bug instead of the instance: no path in `claim-account` writes `user_metadata` any anymore except the single success write, so there is no snapshot left to restore a revoked `invite_hash` from. ⚠️ **In the repo, not necessarily in production** — both functions were at `version: 3` at fingerprint time. Wave-4 gate (f) is the check, and for these two files a successful invocation is the only type check there is. |
| **S1e** | minor | `fixed-in-<wave4b>` | HMAC-SHA-256 under `INVITE_PEPPER`, a **function secret the database never holds**, so a metadata dump is worth nothing on its own — which is exactly the property a bare SHA-256 over 40 known-format bits could not have. Stored digests carry `invite_alg: 'hmac-sha256-v1'`, and `verifyCode()` uses the tag to decide whether an untagged legacy digest may be tried at all, plus `INVITE_PEPPER_PREVIOUS` for rotation without killing outstanding invites — the failure mode the original note warned about. `admin-members` **refuses to mint** an invite when the pepper is unset rather than silently downgrading. ⚠️ New operational requirement: the secret must exist on the project. RUNBOOK §4.1. |

### Correctness & data integrity

| Item | Sev | Disposition | Note |
| --- | --- | --- | --- |
| **C1** | major | `fixed-in-c4bf788` | Migration `0007`. Live-verified at `8a0b2f2`: `position('updated_by' in pg_get_functiondef('public.entries_touch()'))` > 0. The migration proves itself on live data at apply time, and the first cut of that probe passed against the broken function — it now pairs the entry with an actor distinct from its current `updated_by`. The three false comments (`0002` ×2, `ADMIN.md`) were corrected in the same commit; `ADMIN.md` carries the incident note. |
| **C2** | major | `fixed-in-e4b9b62` | Clamped forward, not warned about — the safer of the two options the auditor offered, because a warning the user ignores still ships 60 rows. `clampFirstRun()` in `src/lib/recurrence.ts:310`, applied by `src/api/templates.ts`; the auditor's own reproduction is pinned verbatim in `recurrence.test.ts:282+`. |
| **C3** | major | `fixed-in-c4bf788` | Resolved better than prescribed: rather than dropping `d`/`f` from `KEYED_RE`, an abbreviation is now a keyword **only when it resolves**. `d:`/`f:`/`fu:`/`ev:` that fail to parse were never tokens; `due:`/`every:` keep the red-chip behaviour, because a misspelled explicit keyword is a typo and should say so. All four reported shapes fixed. |
| **C4** | major | `fixed-in-c4bf788` | `quoted && unterminated` now warns for `@` and `+` specifically — the two kinds that never fail on their own. Every other kind already surfaces its own miss. |
| **C5** | major | `fixed-in-c4bf788` | Routed through `lib/dates.parseIsoDate`, and the test that claimed to cover it (whose input carried a trailing `x`) was fixed in the same commit. Cross-reference **M3**: the strict parser C5 now uses is the one M3 repaired. |
| **C6** | major | `fixed-in-c4bf788` | Eviction now takes the oldest **auto-dismissing** toast, so the sticky update prompt cannot be evicted — its button is the only reference to `updateSW` in the app. Still compounded by **M6**, which is open: nothing re-checks for an update in a long-lived session, so the prompt that can no longer be lost also does not reliably appear. |
| **C7** | major | `fixed-in-c4bf788` | One boundary, placed **inside** `Shell` so the tab bar survives the crash, resetting on navigation. Verified by making a route throw. Wave 3 then added ten more lazy routes under it. |
| **C8** | major | `fixed-in-c4bf788` | `MAX_ROWS = 1000`, and both reads share one ceiling **and one ordering** — the sharper version of the finding: `listHealth()` returned an *arbitrary* thousand, a different thousand from `listEntries()`, which is why most rows looked uncovered. Truncation is now state; `src/api/digestCollect.ts:24` and `digest.truncatedNote` carry it to the user. |
| **S3a** | major | `fixed-in-8a0b2f2` | The matrix moved into `store/entries`; `derive()` resolves track × priority through `resolveSlaDays()`. Dashboard's private duplicate fetch was deleted in the same commit, so there is one Map from one fetch. **Still latent in production** — `select count(*) from track_slas` → **0** on the live project, so the override branch has never executed against real data. `docs/EVIDENCE/wave4-live-proof.md` §4 exists to close that. |
| **S3b** | major | `fixed-in-8a0b2f2` | Both halves of `derive()`'s reconciliation are asserted through the store now (`entries.test.ts:495+`), not through a helper. |
| **S3c** | major | `fixed-in-8a0b2f2` | `entries.test.ts:683+` mocks `../api/realtime` to capture the callback and counts zustand notifications, as prescribed. |
| **S4** | major | `fixed-in-8a0b2f2` | `outbox.test.ts:432+` covers both drain-concurrency invariants. Wave 4 then found three more defects in the same machinery that these tests now hold (temp-id resolution surviving a drain, `removeIfUnchanged()`, bounded backoff) — evidence the tests were the right ones to demand. |
| **S2** | major | `fixed-in-8a0b2f2` | `canEditEntryUnder(open, …)` extracted so both policy branches are reachable from a test with no runtime branching. `permissions.test.ts:20` records what the bug was, so the pattern cannot come back by accident. |
| **M1** | minor | `fixed-in-8a0b2f2` | Slug `PARSE-PUNCT`. The guard is now `!read.quoted && !HAS_WORD_CHAR.test(read.value)` — a quoted value can never take the "quoted empty" path, which is the invariant the auditor asked for. |
| **M2** | minor | `fixed-in-8a0b2f2` | Slug `PARSE-ESCAPE`. `ESCAPED_SIGIL_RE` is now **derived** from the two tables that define what a sigil is (`SIGIL_KIND` + `KEYED_ALTERNATION`) rather than being a literal, so adding a sigil extends the escape in the same edit. Case-insensitive, because `KEYED_RE` is. The auditor's note that this was reconstructed from a truncated report stands; the reconstruction was correct. |
| **M3** | minor | `fixed-in-8a0b2f2` | Slug `DATE-YEAR`. Resolved with a **year range** plus `pad4` in the four formatters, not with `pad4` alone — `dates.ts:93` explains why the range has to come first. Boundaries pinned at `dates.test.ts:170+`. |

### Performance

| Item | Sev | Disposition | Note |
| --- | --- | --- | --- |
| **P1** | major (escalated) | `fixed-in-8a0b2f2` | Migration `0009`. Live-verified: **37 of 37** policies are in InitPlan form — 35 wrapping `is_member`/`is_admin`, and the two `notifications` policies wrapping `auth.uid()`. The migration's first probe block had a lookbehind with no discriminating power and passed a wholly unconverted catalogue; it was replaced with a whitespace-insensitive strike-then-test against one shared pattern constant, and the explicit `begin;`/`commit;` removed so a probe failure fails the whole file. |
| **P2** | major | `open` | **The amplifier is fixed; the sort is not.** `derive()` no longer churns the `health` Map identity on every commit (that was **S3a**/**S3b**), which was the reason this mattered. `compareBy` still calls `Date.parse()` twice per comparison for `'activity'`/`'created'` and `normalizeSearch()` twice for `'title'` (`entryFilter.ts:267-300`). The auditor re-measured the title case at **11.4×** (13.76 ms vs 1.21 ms at 2000 rows) and **doubted their own activity figure** — 0.338 ms, comfortably under a frame. Fix the title comparator; the activity one is a nicety. |
| **P3** | minor | `open` | `TITLE_EDGE` is still the trailing-alternative regex (`parse.ts:361`, applied at `:1051`). Reproduced: 331.8 ms at 20 000 interior bidi marks, clean 4× per doubling, versus 0.83 ms for the same length in spaces. A paste of RTL-heavy text hangs the capture box, and `Capture.tsx` re-parses on every keystroke. Arabic is a first-class locale here — treat this as major-adjacent despite the label. |
| **P4** | minor | `open` | `new Map(st.byId)` per row is still there (`store/entries.ts:1401,1422,1660,1739,1829`), so a staged batch clones the previous clone. Ship with a test that counts clones, or it will come back. |
| **P5** | minor | `open` | `matchesSearch` still recomputes `normalizeSearch(search).split(' ')` inside the per-entry predicate (`entryFilter.ts:182`). Trivial; hoist into `selectEntries`. |
| **P6** | minor | `fixed-in-8a0b2f2` | Migration `0009`, and **better than prescribed**: `entries_closed_idx (closed_at desc, id)` partial `where closed_at is not null` — the `id` tiebreak matches the ordering `api/entries.ts` actually sends. Live-verified present. |
| **P7** | minor | `open` | Live-verified still present at `8a0b2f2`: `entries_search_idx` (GIN), `entries_tags_idx` (GIN), `entry_updates_created_idx`. The grep evidence is what carries this finding — the auditor's `idx_scan = 0` argument was **refuted** by the re-probe (three *reachable* indexes are also at 0 on a 9-row table). Reversible; re-add the day server-side search ships. |
| **P8** | minor | `open` | **Still undecided, and the auditor's "decide, don't defer" still stands.** Verified at `8a0b2f2`: `entries.updated_by` has no index, no UI reader, and is **absent from the `Entry` interface** — the `updated_by` at `src/types.ts:418` belongs to `VocabRow`, which is what makes this easy to mis-close. Note that dropping the column is no longer the cheap route to **C1**: `0007` already fixed C1 the other way, so this is now purely "surface it or drop it". |

### Docs

| Item | Sev | Disposition | Note |
| --- | --- | --- | --- |
| **D1** | major | `fixed-in-<wave4b>` | README §2 and §6 rewritten around the magic link, cross-referencing `WAVE2-NOTES.md`. The `{{ .Token }}` instruction and the "receive a six-digit code" line are gone; the free-tier refusal is stated where the operator would otherwise waste an afternoon on it, and the code-entry disclosure is described as what it is — wired, and waiting for custom SMTP. |
| **D2** | major | `fixed-in-<wave4b>` | The instruction to keep `ADMIN_EMAILS` "identical to the one in `src/lib/admin.ts`" is deleted, along with README step 5.3. Both gates and their different jobs are now named in one place, in README §4 and again in `ADMIN.md`. This is the doc half of Wave-4 acceptance gate **(g)**; the code half (whether the function's gate stays an allow-list) is Wave 4's. |
| **D3** | major | `fixed-in-<wave4b>` | Landed in two halves. The operator half was already in `RUNBOOK.md` §1 and §4 at `8a0b2f2` — issue, hand over, reissue, list, remove, and the deploy. Wave 4b extends it: §1.7 (`set-role`), §1.8 (the error-code table) and **§4.1 (function secrets)**, which the rewritten `claim-account` and `0011` both point at by name. The *reasoning* half is new: `ADMIN.md` gains a **Member accounts** section covering the 14-day TTL, the 8-character password floor, single-use codes, the reserved `@opstrack.internal` domain, what a wrong code costs, and the fact that reissue-code **is** the password reset — including that it *un-claims* the account, which nothing said before. README §4 deploys all three functions. |
| **D4** | minor | `fixed-in-<wave4b>` | The `--use-api` form is the single documented path. README was the last outlier — `RUNBOOK.md` §4 and both function headers already agreed. `supabase link` is gone, which also removes the contradiction with plan §5.2 S2 ("the DB password is needed by nothing"). |
| **D5** | minor | `fixed-in-<wave4b>` | The escape hatch now names `src/locales/{en,ar}/status.json` and the registration step in `src/locales/index.ts` that the 4-edit count was silently missing. Following it literally now works. |
| **D6** | minor | `fixed-in-<wave4b>` | The whole "once sitting 2 lands" conditional is gone — both halves shipped (`0003` seeds 17 rows live; `VocabularyAdmin.tsx` has been committed since `64af420`). The vocabulary seed row is now an unconditional part of the cost, which is what it is. |
| **D7** | major | `fixed-in-c4bf788` | Not a doc fix, as the auditor said: `0007` made the sentence true again, and `ADMIN.md` carries a block quote dating the regression to the `0004`→`0007` window and stating plainly that nothing repairs the history. |

### Localization & polish

| Item | Sev | Disposition | Note |
| --- | --- | --- | --- |
| **S5a** | major | `fixed-in-e4b9b62` | LRI…PDI applied to 10 of the 12 named strings, verified individually. The two exceptions are **deliberate and documented**: `capture.exampleFull` and `capture.exampleRecurring` are inserted into the capture input verbatim when tapped, so isolates in the locale string would feed U+2066 to the parser. They are isolated at render time by `lib/bidi.isolateTokens()` instead — see that function's header and the comment at `Capture.tsx:838`. |
| **S5b** | major | `fixed-in-e4b9b62` | FSI…PDI around interpolated user values, and — the part that outlasts the fix — a **gate**. `lib/bidi.test.ts` fails the build on a bare interpolation, generalised in `135bbd6` from quoted interpolations to a user-value token set, and widened in `8a0b2f2` from `ar/` to both trees (101 bare English strings corrected). 570 isolate characters across 31 namespace files now, from zero. |
| **S5c** | major | `fixed-in-e4b9b62` | `!عاجل` → `!عالية` in both `capture.placeholder` and `capture.exampleFull`. The screen no longer demonstrates a priority level it does not document. |
| **S5d** | minor | `fixed-in-e4b9b62` | The auditor's gender-neutral rewrite, as prescribed: `تكرّر إدخال ⁨{kind}⁩ — تُعتمد القيمة الأخيرة.` |
| **S5e** | minor | `fixed-in-e4b9b62` | `سويتش الكور` → `المحوّل الأساسي`. Severity was downgraded from the auditor's MAJOR to polish by the consolidation — it is register, not a defect — and it was fixed anyway. |
| **S5f** | minor | `fixed-in-e4b9b62` | `الحالة الصحية` → `مؤشّر الحالة` in both `entry.json` and `filter.json`. |
| **S5g** | minor | `fixed-in-e4b9b62` | `محجوب` → `متعثّر`. The auditor's report was truncated before their proposed wording; this is the replacement that shipped, and `store/vocab.test.ts:89` pins it with a comment naming the reading that was retired. |
| **M5** | minor | `open` | `vite.config.ts` still has bare `navigateFallback: 'index.html'` with no allowlist. Reach is genuinely low under HashRouter, but the SW strictly makes GitHub's 404 worse than having none. |
| **M6** | minor | `open` | No `onRegisteredSW`, no periodic `registration.update()`. **This is now the binding constraint on the update path**, because **C6** made the prompt unloseable and nothing makes it appear. A long-lived session on a phone still never re-checks. |
| **M7** | minor | `open` | No `globPatterns`. Latent — the auditor diffed 51 precache entries against 51 files, zero missing — and Wave 4 has since added icon and splash assets, which moves it from latent towards live. Set it explicitly. |

---
## Deduped cross-references (before the list)

| Cluster | Auditors | Merged into |
|---|---|---|
| `derive()` health fallback — wrong SLA arg **and** zero tests **and** identity churn driving re-sorts | perf#3 + test-quality#2 + perf#2's amplifier | **S3** (one fix, one owner) |
| claim-account — all four defects are one root: claim/throttle state lives in `user_metadata`, mutated by non-atomic `listUsers`→`updateUserById`, keyed on username only | edge-fn MAJOR-1/2/3 + MINOR-4 | **S1** (one rewrite) |
| Arabic bidi — one root: **zero** isolate characters exist anywhere in `src/locales/ar/**` (verified: 0 of U+2066–2069 across all 23 files) | arabic#1 + arabic#2 | **S5** |
| Unreachable indexes — filtering is 100% client-side by design, so no GIN index has or can have a caller | perf#7 + schema-drift#4 | **P7** |
| Admin truth has three sources and three documents disagree | docs#2 + docs#7 | **D2** |
| A shipped update can never be applied | pwa F1 + pwa F3 | **C6** (F3 compounds F1) |
| Parser silently loses typed text — one violated module invariant, four instances | parser#1, #2, #4, #7 | **C3/C4/M1/M2** (kept split: different fixes) |
| `updated_by` — schema#3's fix (drop the column) resolves schema#1 outright | schema#1 + schema#3 | **C1** + **P8** (alternative fix noted) |

---

## THE BACKLOG

### Exploitable security

- **[fixed-in-<wave4b>]** `[major][security] supabase/functions/claim-account/index.ts:238-276` — **S1a** Three-state username enumeration oracle: `!target`→403 with **no** `recordFailure`, `already_claimed`→409 **before** the throttle, pending→403×10 then 429. Header comment at `:13-18` promises the opposite. — **CONFIRMED** (read the control flow; `invalid()` at `:238-241` returns before any counter, `:248-255` returns before the throttle block at `:268`). *Prescribed fix: fold into S1 rewrite — identical 403 for all three states.*
- **[fixed-in-<wave4b>]** `[major][security] supabase/functions/claim-account/index.ts:44-45,268-290` — **S1b** Ten wrong guesses lock a known username out of claiming for 15 min; nothing rate-limits the attacker, and `admin-members/index.ts:240` (`claim_fail_count: 0`) means the admin's remedy is re-lockable in 10 requests. Renewable DoS. — **CONFIRMED** (verified `issueCode` clears both counters). *Prescribed fix: per-(account × IP-prefix) with exponential delay, not a hard refusal.*
- **[fixed-in-<wave4b>]** `[major][security] supabase/functions/claim-account/index.ts:279-290` — **S1c** "Durable throttle" is a non-atomic read-modify-write: `claim_fail_count: failCount + 1` from a `listUsers` snapshot, no CAS. Budget is 10 *rounds*, each arbitrarily wide. — **CONFIRMED** (literal code; no conditional update anywhere in the file). *Prescribed fix: move counter to a Postgres row with `update … set n = n+1 … returning n`.*
- **[fixed-in-<wave4b>]** `[minor][security] supabase/functions/claim-account/index.ts:279-290` — **S1d** Reissue race: `recordFailure` writes `{...meta}` from the pre-comparison snapshot, restoring a just-revoked `invite_hash`/`invite_issued_at`. Same non-atomicity breaks "single-use" for concurrent claims. — *Prescribed fix: same fix as S1c; conditional `where invite_hash = $expected`.*
- **[fixed-in-<wave4b>]** `[minor][security] supabase/functions/admin-members/index.ts:118-134` — **S1e** `inviteHash()` is one bare SHA-256 over 40 bits with a known salt; a dumped hash is ~a minute of GPU per account. Exposure is genuinely narrow (verified `list` at `:266-293` maps explicit fields, never `invite_hash`). *Prescribed fix: HMAC with a function-secret pepper. Defence-in-depth, not a live hole.*

### Correctness & data integrity

- **[fixed-in-c4bf788]** `[major][data-integrity] supabase/migrations/0002_config_foundation.sql:91-93` (cause at `0004_workspace_data.sql:522,556-563`) — **C1** `entries_touch()`'s second diff subtracts `updated_at`/`last_activity_at`/`track_id` but **not** `updated_by`, so `entries_guard_update`'s stamp counts as "a change" and a pure track move bumps the staleness clock — the exact outcome 0002 exists to prevent. — **CONFIRMED**: live `select position('updated_by' in pg_get_functiondef('public.entries_touch()'))` → **0**; live trigger order on `entries` is `entries_guard_update` → `entries_touch_trg` (name order, as 0004:569-573 documents). Three comments now assert the opposite (`0002:61-71`, `0002:527-529`, **`ADMIN.md:359-363`** — re-located, was cited at 002d5ae). Note the nuance the auditor missed: it fires whenever `updated_by` *changes*, i.e. always on the first move (live: 2 of 9 rows have it set) and always when a different actor moves it. *Prescribed fix: 0007 — subtract `updated_by` from both diffs. Do this before any Wave-3 digest work.*
- **[fixed-in-e4b9b62]** `[major][data-integrity] src/lib/capture/parse.ts:781,819-834,882` + `0002:615-633` — **C2** `firstRunOn = dueDate ?? todayIso()` is never checked for being in the past and has no `PROBLEM_KEYS` entry; `run_due_templates`'s `while v_next <= current_date and v_guard < 60` then mints one entry per missed occurrence. — **CONFIRMED, reproduced**: `Monthly report every:monthly due:1/9` at `now=2026-12-01` → `nextRunOn: "2026-09-01"`, `problems: []` (91 days back); `every:daily due:-30d` → 30 rows; a 2020 anchor hits the 60 cap. *Prescribed fix: clamp `firstRunOn` forward, or add `PROBLEM_KEYS.recurrencePast`. Clamping is safer — a warning the user ignores still ships 60 rows.*
- **[fixed-in-c4bf788]** `[major][correctness] src/lib/capture/parse.ts:247` (consumed at `:741`) — **C3** `KEYED_RE = /^(due|d|fu|f|every|ev):/i` makes any `d:`/`f:`/`ev:` word a keyed token, and failed keyed date tokens are consumed anyway — so Windows drive letters are **deleted from the stored title** in an IT-ops tracker. — **CONFIRMED, reproduced**: `Restore D:\backup to F:\data` → title `"Restore to"`, two `capture.errDate`. Also `Mount d:/mnt/share` → `"Mount"`, `Set F:1 flag` → `"Set flag"`, `check ev:1 ratio` → `"check ratio"`. Only `a d:tomorrow`/`a f:thu` are pinned by tests. *Prescribed fix: drop `d`/`f` from `KEYED_RE`, or refuse to consume a failed keyed token whose value contains `\` or `/`. Cheapest real fix in the list.*
- **[fixed-in-c4bf788]** `[major][correctness] src/lib/capture/parse.ts:414-424` (owner `:653-682`, tag `:714-722`) — **C4** One unterminated `"` runs `readValue` to end of input; `@` never fails (free text is a success) and `+` never fails, so the rest of the line is absorbed with **zero** red signal. — **CONFIRMED, reproduced**: `Call @"Ahmed due:thu !high #network` → title `"Call"`, `ownerName: "Ahmed due:thu !high #network"`, problems `["capture.newOwner"]` (informational). `Escalate +"outage @sara due:fri` → tag `["outage @sara due:fri"]`, `problems: []`. *Prescribed fix: mark `quoted && unterminated` and warn on `@`/`+`; refuse a tag containing whitespace + a sigil.*
- **[fixed-in-c4bf788]** `[major][correctness] src/lib/entryFilter.ts:147,508-510` — **C5** `parseIso` shape-checks with `ISO_DATE_RE` instead of `lib/dates.parseIsoDate`, so a calendar-impossible `from=` is accepted and `matchesFilter` (`:244`, string compare) then rejects every row — the list silently empties. The test that claims to prevent this (`entryFilter.test.ts:402`) uses `from=yesterday` and `to=2026-13-99x`; drop the `x` and it flips. — **CONFIRMED, reproduced**: `from=2026-13-99` → `f.from === "2026-13-99"`; `from=2026-02-30` also accepted. *Prescribed fix: route through `parseIsoDate` (already strict — see M3) and fix the test's inputs.*
- **[fixed-in-c4bf788]** `[major][availability] src/main.tsx:70` (mechanism `src/components/toast.tsx:39,72`) — **C6** The "new version available" prompt is a sticky toast (`duration: 0`), but `items = [...items, …].slice(-MAX_STACK)` evicts unconditionally, sparing nothing. **38** `toast()` call sites outside `main.tsx`; `updateSW` is captured in a closure and exposed nowhere else (grep for `updateSW|registerSW|virtual:pwa` in `src/` → `main.tsx` only). Three ordinary toasts and the update can never be applied. — **CONFIRMED** (read both files; `schedule()` no-ops on `ms <= 0`, so the prompt is genuinely sticky and genuinely evictable). *Prescribed fix: evict the oldest **auto-dismissing** toast, or lift the prompt out of the stack. Compounded by M6 (no periodic `registration.update()`).*
- **[fixed-in-c4bf788]** `[major][availability] src/App.tsx:392,414,463` — **C7** 14 `lazy()` routes behind bare `<Suspense>`, **no error boundary anywhere** (`grep ErrorBoundary|componentDidCatch|getDerivedStateFromError|vite:preloadError|unhandledrejection src/` → **0 hits**), and `registerType: 'prompt'` means no `clientsClaim` (verified: `grep -c clientsClaim dist/sw.js` → **0**), so the whole first visit is uncontrolled. `deploy-pages` replaces the site, so a mid-session deploy 404s the old chunk → white screen, no toast, no reload affordance. — **CONFIRMED**. *Prescribed fix: one boundary around the two route-level Suspense trees rendering `common.error`/`common.reload`. Wave 3 adds 6 more lazy routes — do this first.*
- **[fixed-in-c4bf788]** `[major][correctness] src/api/entries.ts:73,195-197` — **C8** PostgREST clamps every response at **1000** (live `GET /v1/projects/…/postgrest` → `"max_rows": 1000`, re-verified by me), so `MAX_ROWS = 2000` is unreachable and truncation is silent (200 + `Content-Range`). `listHealth()` carries **no `.limit()` at all**. Past 1000 open entries, `healthMatches(undefined, e)` → `false` (`store/entries.ts:327-335`), so every uncovered row lands in `derive()`'s `stale` set and runs the client `computeHealth` mirror **on every commit** — the app silently and permanently falls back off the authoritative view. — **CONFIRMED** (live config + code path traced end to end). *Prescribed fix: `MAX_ROWS = 1000`, add `.limit()` to `listHealth()`, surface `Content-Range` truncation as state.*
- **[fixed-in-8a0b2f2]** `[major][correctness] src/store/entries.ts:374` — **S3a** `computeHealth(entry, staleDays(…), slaDays(snapshot, entry.priority))` passes the **priority default**, but `lib/health.ts:129-133` says the third argument must be `resolveSlaDays()`'s answer, and the live view does `coalesce(ts.sla_days, vp.sla_days)`. Nothing in `src/store/**` or `src/api/**` ever builds the matrix — **CONFIRMED** by grep: `buildTrackSlaMap`/`listTrackSlas`/`resolveSlaDays` callers are only `health.test.ts`, `pages/settings/TrackEditor.tsx` (one track) and comments in `FollowUps.tsx:43-63` explaining why it *isn't* called there. Latent today (live `select count(*) from track_slas` → **0**), lights up the first time an admin uses 0006. — *Prescribed fix: load the matrix into the entries store; same commit as S3b.*
- **[fixed-in-8a0b2f2]** `[major][test-gap] src/store/entries.ts:354-378` — **S3b** Both halves of `derive()`'s health reconciliation are unguarded: the stale-recompute (which the file's own header at `:346-353` documents as a shipped regression) and the closed-row deletion. `entries.test.ts` never reads `getEntriesSnapshot().health`. — **CONFIRMED**: the test file's `health()` helper is only used for `countEntries` fixtures (`:197-231`); no test exercises the store's derive. *Prescribed fix: export `healthMatches`, assert through the store. Ship with S3a.*
- **[fixed-in-8a0b2f2]** `[major][test-gap] src/store/entries.ts:1687-1744` — **S3c** §2.14's frozen "a 20-row bulk commit produces one setState, not twenty" and the whole `staged`/`stagedDirty`/`finally` machinery have **no test**. — **CONFIRMED**: no file in `src/` other than `App.tsx`, `api/realtime.ts` and `entries.ts` itself names `startEntriesRealtime` or `onRealtimeBatch`. *Prescribed fix: mock `../api/realtime` to capture the callback, count zustand notifications.*
- **[fixed-in-8a0b2f2]** `[major][test-gap] src/store/outbox.ts:284,307` — **S4** The single-flush guard and the re-read-per-item rule are the two things between the queue and duplicate/lost sends; neither is asserted. — **CONFIRMED**: `outbox.test.ts` has 14 `flushOutbox` references and one `discardOutboxItem` (`:303`) but it is a static queue-management test, not mid-drain; no test compares two flush promises. *Prescribed fix: two tests — same-promise on a race, and discard-mid-drain.*
- **[fixed-in-8a0b2f2]** `[major][test-gap] src/lib/permissions.test.ts:55` — **S2** The test branches on `ENTRIES_UPDATE_IS_OPEN` at runtime, so the narrow-policy assertions (`:62-67`) are dead code and `permissions.ts:45` is never executed. Everything that runs reduces to `meId !== null`. — **CONFIRMED** (read both files; `permissions.ts:30` ships `true`). *Prescribed fix: extract `canEditEntryUnder(open, …)` and test both branches unconditionally — this is the module the board's drag affordance and every disabled control read.*
- **[fixed-in-8a0b2f2]** `[minor][correctness] src/lib/capture/parse.ts:397-400` (default branch `:760-766`) — **M1** The bare-sigil guard tests `HAS_WORD_CHAR`, not emptiness, so a punctuation/emoji-only quoted value takes the "quoted empty" path: consumed, no field set, **no problem**. — **CONFIRMED, reproduced**: `Fix #"---" now` / `+"***"` / `@"???"` all → title `"Fix now"`, `problems: []`. Only `#""` is pinned (`parse.test.ts:316`). *Prescribed fix: take the `unknown` path only when the cleaned value is `''`.*
- **[fixed-in-8a0b2f2]** `[minor][correctness] src/lib/capture/parse.ts:266-267,806` — **M2** *(reconstructed — parser-fuzz finding #7 arrived truncated at "### 7 · The escape"; I re-derived it.)* `ESCAPED_SIGIL_RE = /\\([#@!+/])/g` covers only the five sigils, **not** keyed prefixes, and an unmatched `\` is left literal in the title. So `capture.hintEscape`'s promised workaround does not exist for C3: `Restore \D:\backup` → title `"Restore \D:\backup"` (stray backslash shipped to the DB), while `Restore D:\backup` loses the path entirely. Verified by probe. *Prescribed fix: fix C3 rather than extend the escape; re-run the parser-fuzz auditor to recover their actual #7 wording.*
- **[fixed-in-8a0b2f2]** `[minor][correctness] src/lib/dates.ts:176-182,205-212,132,192-202` — **M3** `parseIsoDate` guards the two-digit-year trap with `setFullYear` (`:158-160`); `addDays`, `addMonths`, `diffDays`, `toIsoDate` all re-enter it via `Date.UTC(d.getFullYear(), …)` and none pad to four digits. — **CONFIRMED, reproduced verbatim**: `due:0026-08-14` accepted with `problems: []`; `formatDate` → `"14/08/26"`; `formatDue` → `"36509 d overdue"`; `addDays(+1)` → `"1926-08-15"`; `addMonths('0050-01-31', -12)` → `"49-01-31"` (not `YYYY-MM-DD`, and `parseIsoDate` then rejects its own output); `diffDays('0099-06-15','2026-06-15')` → `9862`. *Prescribed fix: `new Date(0)` + `setUTCFullYear`, plus a `pad4` in the four formatters. Cross-ref C5 — this is the strict parser C5 should be using.*

### Performance

- **[fixed-in-8a0b2f2]** `[major][perf] supabase/migrations/0001_opstrack_core.sql:69-70` (pattern repeated in every policy, 0001–0006) — **P1** Every RLS policy is bare `using (public.is_member())`; security quals are not eligible for pseudoconstant gating, so it runs **once per surviving row**, and `security_invoker = on` makes `v_entry_health` pay it on three tables. Measured by the auditor: 10.5 ms as owner → **92 ms** at 5k rows → **220 ms** at 10k as `authenticated`; the `(select …)` InitPlan form is **7 ms** at 10k. — **CONFIRMED** shape (I re-read the policies; the measurement is the auditor's, from rolled-back `EXPLAIN ANALYZE`). Filed as *minor* by the auditor; **I escalate to major** — it is the app's primary read, the fix is purely mechanical and semantics-free, and 220 ms is the difference between working and not at the documented ceiling. Latent at 9 live rows. *Prescribed fix: wrap every `is_member()`/`is_admin()` in `(select …)`. One sed-able migration. Do it before Wave 3 adds meetings/timeline policies in the same style.*
- **[open]** `[major][perf] src/lib/entryFilter.ts:264-300` — **P2** `compareBy` does per-comparison work: `Date.parse()` ×2 for `'activity'` (the `EMPTY_FILTER` default) and `normalizeSearch()` ×2 for `'title'`. `store/entries.byActivityDesc:307-312` already compares the same ISO strings lexicographically. — **CONFIRMED, re-benchmarked at 2000 rows / 30 runs**: `'title'` **13.76 ms** vs 1.21 ms Schwartzian (**11.4×**, matches the auditor's 10.4×). But **DOUBTED on the `'activity'` half**: I measure **0.338 ms** vs 0.029 ms — the ratio holds (11.6×) but the absolute is 3.8× lower than the reported 1.28 ms and is comfortably under a frame. The amplifier is real and is the reason this matters: `derive()` returns the same `serverHealth` reference only while `stale.length === 0` (`:365`), so from the first optimistic write until the next `listHealth()` **every** commit mints a new `health` Map and invalidates `useFilteredEntries`' memo. *Prescribed fix: string-compare the ISO columns; Schwartzian the title. Treat as **one** item with S3 — fixing the health-identity churn is what actually removes the repeated passes.*
- **[open]** `[minor][perf] src/lib/capture/parse.ts:298,806` — **P3** `TITLE_EDGE`'s trailing alternative backtracks quadratically inside an *interior* run of bidi/zero-width marks (whitespace is collapsed first, so only these stay long — by design). `Capture.tsx` re-parses in a `useMemo` on every keystroke. — **CONFIRMED, reproduced**: N=5 000 → **21.0 ms**, 10 000 → **86.2 ms**, 20 000 → **331.8 ms** (clean 4× per doubling); the same length in spaces is **0.83 ms**. A paste of RTL-heavy text hangs the capture box. *Prescribed fix: two-pointer index walk instead of the regex trim. Cheap, and Arabic is a first-class locale here — I'd treat this as major-adjacent despite the label.*
- **[open]** `[minor][perf] src/store/entries.ts:1405` — **P4** `applyServerRow` does `new Map(st.byId)` per row, so inside a staged batch each row clones the previous clone — quadratic in batch size, defeating half the point of `applyRealtimeBatch`. Same shape in `applyServerUpdate` and `removeEntryLocal` (five clones per row). — **CONFIRMED** (read the code path; `staged` is the `st` during a batch). Auditor measured 20-row 1.03 ms vs 0.05 ms, 500-row 23.76 ms. *Prescribed fix: mutate `staged.byId` in place, clone once in the `finally`. Ship with S3c so the new test proves both.*
- **[open]** `[minor][perf] src/lib/entryFilter.ts:184-189` — **P5** `matchesSearch` recomputes `normalizeSearch(search).split(' ')` inside the per-entry predicate. 19% of the filter pass (0.59 ms/keystroke at 2000 rows). *Prescribed fix: hoist into `selectEntries`, pass `terms` down. Trivial.*
- **[fixed-in-8a0b2f2]** `[minor][perf] supabase/migrations/0001_opstrack_core.sql:333-355` — **P6** No index on `entries.closed_at`, the only queried column without one — **CONFIRMED live**: `select indexname from pg_indexes where tablename='entries' and indexdef ilike '%closed_at%'` → **empty**. Consumed by `api/entries.ts:172-186`; auditor's `EXPLAIN` on 20k synthetic rows: 3083 buffers + full sort to return 517. *Prescribed fix: `create index entries_closed_idx on public.entries (closed_at desc) where closed_at is not null;` — same migration as C1/P1.*
- **[open]** `[minor][perf] supabase/migrations/0001_opstrack_core.sql:344,349-350,403-404` — **P7** `entries_search_idx` (GIN), `entries_tags_idx` (GIN) and `entry_updates_created_idx` are unreachable: repo-wide grep finds no `textSearch`/`.contains(`/`.overlaps(`/`.ilike(`/`to_tsvector`, and `entryFilter.ts:6-8` makes client-side filtering the architectural decision. Auditor measured 150 ms vs 56 ms on 1000-row updates with/without the two GIN (no HOT updates possible — `entries_touch()` bumps `last_activity_at` every time). — **CONFIRMED on the grep evidence**; **DOUBTED on the `idx_scan = 0` evidence** — I re-probed live and `entries_due_idx`, `entries_followup_idx` and `entries_track_idx` are *also* at 0 on a 9-row table where `entries_pkey` has 6040 scans. `idx_scan` proves nothing here; the grep does. *Prescribed fix: drop the two GIN + the standalone `(created_at desc)`. Reversible; re-add the day server-side search ships.*
- **[open]** `[minor][schema] supabase/migrations/0004_workspace_data.sql:522-526` — **P8** `entries.updated_by` is stamped on every update, has no index, is absent from the `Entry` interface, and has zero readers — **CONFIRMED** (live: 2 of 9 rows stamped; grep for `updated_by` in `src/` hits only `types.ts`'s `VocabOption`, a `config.ts` comment and `vocab.test.ts`). *Prescribed fix: **decide, don't defer** — dropping the column and its stamp resolves C1 outright and is the cheaper of the two fixes. Surfacing it means an index + an `Entry` field + a UI.*

### Docs

- **[fixed-in-<wave4b>]** `[major][docs] README.md:42-44,53-55,133` (+ `docs/EXECUTION-PLAN.md` §5.2 S4/S5, §5.5 A, Wave-0 gate (d)) — **D1** README instructs the operator to put `{{ .Token }}` in the Magic Link template and to expect a six-digit code — a step that is **impossible on this project**: `docs/WAVE2-NOTES.md:3-8` records the live API rejection ("Email template modification is not available for free tier projects"). Also tells you to turn Confirm email *off*; live has it on and it is harmless either way. — **CONFIRMED** (README text + the repo's own WAVE2-NOTES contradict each other). Wave 2's SignIn rewrite fixed the *screen*; nothing fixed these docs. *Prescribed fix: rewrite README §2/§6 around the magic link, cross-ref WAVE2-NOTES.*
- **[fixed-in-<wave4b>]** `[major][docs] README.md:79-83,121` ∥ `src/lib/admin.ts` ∥ `ADMIN.md:14-18` — **D2** README says keep `ADMIN_EMAILS` "identical to the one in `src/lib/admin.ts`" — a file that is `export {}` plus a 20-line comment explaining that re-adding it is exactly the failure the README describes. Meanwhile `ADMIN.md:14-18` says `profiles.role` is "the only admin signal in the entire system", which `admin-members/index.ts:184` (403 gate) and `:281` (`role: ADMIN_EMAILS.includes(email) ? 'admin' : …`) and `:494` contradict. — **CONFIRMED** (all four files read). *Prescribed fix: one paragraph naming the two gates and their different jobs; delete README step 5.3.*
- **[fixed-in-<wave4b>]** `[major][docs] README.md:72-93` + `ADMIN.md` — **D3** No setup document deploys `claim-account`, and the entire username/invite lifecycle is undocumented — **CONFIRMED**: `grep -n claim-account README.md ADMIN.md docs/*.md` → **one** hit, in `WAVE1-ADDENDUM.md:22`. Without the function every username member is permanently unclaimable, and nothing operator-facing mentions the 14-day TTL, `MIN_PASSWORD_LENGTH`, or that reissue-code *is* the password-reset path. *Prescribed fix: README §4 deploys both; new "Member accounts" section in ADMIN.md. Blocks Wave 4's Members page.*
- **[fixed-in-<wave4b>]** `[minor][docs] README.md:85-90` ∥ both function headers ∥ plan §5.2 S9 — **D4** Three mutually inconsistent deploy procedures (`supabase link` + deploy / `--project-ref … --use-api` / "Deploy via Editor"). README's `supabase link` also contradicts plan §5.2 S2 ("the DB password is needed by nothing"). — **CONFIRMED**. *Prescribed fix: the `--use-api` form is the single documented path.*
- **[fixed-in-<wave4b>]** `[minor][docs] ADMIN.md:245-246` *(re-located from 002d5ae:136-137)* — **D5** The 4-edit escape-hatch names `src/locales/en.json` / `ar.json`; those files were deleted in Wave 1 (`WAVE1-ADDENDUM.md:166`) and the tree is `src/locales/{en,ar}/<namespace>.json`. Following it literally creates two files `index.ts` never imports — the exact failure `ADMIN.md` itself warns about. — **CONFIRMED**.
- **[fixed-in-<wave4b>]** `[minor][docs] ADMIN.md:216,270,283` *(re-located from 002d5ae:107,155,168)* — **D6** Treats the vocabulary work as unshipped ("Sitting 2 **adds** a vocabulary screen", "Once sitting 2 **lands**: +1", "once the vocabulary table **exists**"). — **CONFIRMED, and now worse than the auditor found**: they noted only the table half was stale (`0003` shipped, `vocab_options` live with 17 seed rows); as of `64af420` **`src/pages/settings/VocabularyAdmin.tsx` is committed too**, so the screen half is stale as well and the whole conditional section should go.
- **[fixed-in-c4bf788]** `[minor][docs] ADMIN.md:359-363` — **D7** "Moving entries between tracks does not count as activity" is now **false in production**. Not a doc fix — it is the acceptance criterion for **C1**. *Prescribed fix: land C1, leave the doc.*

### Localization & polish

- **[fixed-in-e4b9b62]** `[major][a11y-i18n] src/locales/ar/{capture,admin,entry,vocabadmin}.json` — **S5a** Latin tokens in *teaching* strings render back-to-front under `dir="rtl"`: `capture.placeholder`, `hintDue`, `hintFollowUp`, `hintRecurring`, `hintQuoted`, `hintEscape`, `hintDates`, `exampleFull`, `exampleRecurring`, `admin.tracks.errColor`, `vocabadmin.errColor`, `entry.linkUrlPlaceholder`. Worst: `hintDates`' ISO example `2026-08-14` renders as `14-08-2026` — a *different, plausible* format, and the parser really does accept day-first `14/8`. — **CONFIRMED**: I verified `src/lib/i18n.ts` sets `dir="rtl"` unconditionally, that every listed string contains a neutral between an Arabic run and a Latin run, and — decisively — that the **entire `ar/` tree contains 0 occurrences of U+2066–U+2069**. Note `TrackEditor.tsx:644` already applies `dir="ltr"` for the standalone case, proving the team knows the failure mode; mid-sentence tokens can only be fixed in the string. *Prescribed fix: LRI…PDI (`\u2066…\u2069`) per the auditor's ready-to-paste table.*
- **[fixed-in-e4b9b62]** `[major][a11y-i18n] all ar namespaces (~18 keys)` — **S5b** `«{value}»` inverts its guillemets whenever the interpolated value is Latin — i.e. the normal case (entry titles, track names, every username/email). — **CONFIRMED** (same 0-isolates evidence; `errTrackUnknown` = `'لا يوجد مسار يطابق «{value}».'`). *Prescribed fix: FSI…PDI (`\u2068…\u2069`) around every interpolated user value. Ship with S5a as one commit.*
- **[fixed-in-e4b9b62]** `[major][correctness] src/locales/ar/capture.json` (`placeholder`, `exampleFull`) — **S5c** Both Arabic examples use `!عاجل`, which `parse.ts:199` maps to **critical**, while both English counterparts use `!high` — and `عاجل` appears nowhere in `capture.hintPriority` (`منخفضة، متوسطة، عالية، حرجة`). The screen documents four words and demonstrates a fifth, at a different level. — **CONFIRMED**: dumped both locales side by side and read the alias table. *Prescribed fix: `!عالية`. One-word fix; it is currently teaching Arabic users to file everything critical.*
- **[fixed-in-e4b9b62]** `[minor][i18n] src/locales/ar/capture.json` (`warnDuplicate`) — **S5d** `'حُدِّد {kind} مرّتين — تُعتمد الأخيرة.'` hardcodes a masculine verb and a feminine predicate; `{kind}` is one of eight chip labels of mixed gender, so one half is always wrong. — **CONFIRMED** (string read; `{kind}` is substituted with the localized chip label). *Prescribed fix: the auditor's gender-neutral rewrite (`تكرّر إدخال {kind} … تُعتمد القيمة الأخيرة`).*
- **[fixed-in-e4b9b62]** `[minor][polish] src/locales/ar/capture.json` — **S5e** `"سويتش الكور"` / `"السويتش"` are raw transliterations on the two most-read strings. — **CONFIRMED present**; **severity downgraded** from the auditor's MAJOR to polish — it is register, not a defect. *Prescribed fix: `المحوّل الأساسي` / `المحوّل`.*
- **[fixed-in-e4b9b62]** `[minor][polish] src/locales/ar/{entry,filter}.json` — **S5f** `health` = `"الحالة الصحية"` (medical register), one line from `entry.status` = `"الحالة"`. *Prescribed fix: `"مؤشر الحالة"`.*
- **[fixed-in-e4b9b62]** `[minor][polish] src/locales/ar/{status,followups,entry}.json` — **S5g** `status.blocked` = `"محجوب"` reads as *access-blocked/censored* in Saudi usage. *(Auditor's text truncated before the proposed replacement — re-run for the wording.)*
- **[open]** `[minor][pwa] vite.config.ts:49` — **M5** `navigateFallback: 'index.html'` with no denylist converts GitHub's 404 into a white screen under `/opstrack/` (`base: './'` makes the shell's module script resolve against the bogus path). — **CONFIRMED** mechanism; reach is genuinely low under HashRouter, but the SW strictly makes this worse than having none. *Prescribed fix: `navigateFallbackAllowlist: [/^\/opstrack\/(index\.html)?$/]`.*
- **[open]** `[minor][pwa] src/main.tsx:66-88` — **M6** No `onRegisteredSW`, no periodic `registration.update()`, and HashRouter means every route change is a hashchange, not a navigation — so a long-lived session never re-checks. Compounds **C6**. *Prescribed fix: hourly `r.update()` + one on `visibilitychange → visible`.*
- **[open]** `[minor][pwa] vite.config.ts:47-59` — **M7** No `globPatterns`, so workbox's default `**/*.{js,wasm,css,html}` applies; the first `.woff2`/`.webp`/JSON imported into `dist/assets/` is silently left out of the precache, and an over-2 MiB chunk is dropped with a warning CI never reads (`index-*.js` is 498 KB today). Latent — auditor diffed 51 precache entries against 51 files, zero missing. *Prescribed fix: set it explicitly.*

---

## The 5 things Wave 3+ builders had to know BEFORE they built — closed out

This section was written for the Wave-3 fleet and is kept because it is the
record of what was true then. **Four of the five are now closed.** Read the
verdicts, not the warnings.

1. ~~**`last_activity_at` is currently lying, and the digest/dashboard/follow-ups
   all read it.**~~ **CLOSED** — `0007` landed in `c4bf788`, before Wave 3 built
   on the column, which is what this warning was for. Live-verified at
   `8a0b2f2`. The history from the `0004`→`0007` window is *not* repaired and
   never will be; `ADMIN.md` says so where an operator will meet it.

2. ~~**`snapshot.health` is wrong, churning, and untested — do not treat it as
   authoritative.**~~ **CLOSED** — **S3a** moved the matrix into the store,
   **S3b** and **S3c** tested both halves, and the Map-identity churn that made
   every `useMemo` useless is gone. One residue: `track_slas` is still empty on
   the live project, so the override branch has never run against real data.
   That is a proof gap, not a code gap — `docs/EVIDENCE/wave4-live-proof.md` §4.

3. **STILL TRUE, in a narrower way: PostgREST silently clamps every read at
   1000 rows.** `MAX_ROWS` is 1000 now and both entry reads share one ceiling and
   one ordering (**C8**), and the digest surfaces truncation to the user. But the
   *rule* has not changed and it binds every loader written from here on: a
   response arrives as a `200` with fewer rows, never as an error. Meeting
   windows, timeline pages and digest ranges must page or check `Content-Range`.
   "One working-set fetch" is not a safe assumption above 1000 open entries.

4. ~~**553 green tests are not evidence about the store.**~~ **CLOSED as
   written** — all four named seams (**S2**, **S3b**, **S3c**, **S4**) are
   covered, and the suite is 1217 tests. The *lesson* survives and is worth more
   than the four fixes: Wave 4 found three further defects in exactly the outbox
   machinery **S4** had just forced tests onto (temp-id resolution surviving a
   drain, replaced-payload deletion, unbounded parking on a 500). A green suite
   is evidence about the code's agreement with the tests and nothing else. Every
   claim about the live project belongs in `docs/EVIDENCE/`.

5. ~~**The Arabic tree has zero bidi isolate characters.**~~ **CLOSED, and
   converted into a gate** — 570 isolate characters across 31 namespace files,
   and `lib/bidi.test.ts` now fails the build on a bare interpolation in
   **either** tree. The convention is no longer something to remember: FSI…PDI
   (`⁨…⁩`) around interpolated values, LRI…PDI (`⁦…⁩`) around
   literal Latin tokens, and the gate enforces it. Two locale strings are exempt
   on purpose (**S5a**) — read that row before "fixing" them.

*And the Wave-4-specific note — **it happened, on the second attempt**:* the
warning was not to build the Members page against `meta.invite_hash` /
`claim_fail_count`, because **S1** would move them into a Postgres table with
atomic CAS. `8a0b2f2` declined that move and argued its case; migration `0010`
then made it anyway, and the throttle now lives in `public.claim_counters`
behind `claim_bump()` / `claim_peek()` / `claim_reset()`. The warning was right
and worth having been given: a Members page written against the metadata bag
would have needed rewriting.

What survives of it as a standing rule: **`user_metadata` is not an interface.**
Read `claimed`, `invite_expires_at` and the rest through the edge function's
`list` action, which is the one sanctioned reader. The counters are a different
table now, reachable only by `service_role`, and the digest is an HMAC whose
pepper the database does not hold — so there is nothing left in that bag worth
reading directly even if RLS let you.

---

## What is still open, ranked

Nine items, one major (**P2**) and eight minors. None is a blocker; the ranking
is by what will hurt first, not by severity label.

1. **M6** — nothing re-checks for a new version, so **C6**'s unloseable update
   prompt is also an unreliable one. Cheapest real user-facing win in the list,
   and the two halves of the update path are now split across a fixed item and
   an open one, which is the worst place to leave it.
2. **P3** — a paste of RTL-heavy text hangs the capture box. Arabic is a
   first-class locale; 331.8 ms at 20 000 marks, quadratic.
3. **P8** — decide `entries.updated_by`: surface it (index + `Entry` field + UI)
   or drop it and its stamp. It has been "deferred" for three waves, and the
   auditor's cheaper option (drop it, which also fixed **C1**) expired when
   `0007` fixed C1 the other way.
4. **P2** — the title comparator, 11.4× on the measurement that survived
   scrutiny. Skip the activity half unless a profile disagrees.
5. **M5**, **M7** — two `vite.config.ts` lines: the navigate-fallback allowlist
   and an explicit `globPatterns`. M7 moved from latent towards live when Wave 4
   added icon and splash assets.
6. **P4**, **P5** — quadratic Map cloning in staged batches; a hoist in
   `matchesSearch`. Both need a test that would notice the regression.
7. **P7** — drop two unreachable GIN indexes and a standalone `(created_at
   desc)`. Reversible; the write cost is real and the read benefit is zero while
   filtering is client-side by design.

And two that are closed but not *finished*, both for the same reason. **S1d** and
**S1e** are fixed in the repo and reach users only when the edge functions are
redeployed — and **S1e** additionally requires the `INVITE_PEPPER` function
secret to exist, or `admin-members` refuses to mint an invite (deliberately: a
silent downgrade to the unpeppered digest is the thing it exists to prevent).
Neither function is covered by `tsc` or `oxlint`, so for those files deployment
**is** the type check. RUNBOOK §4.1 has the secret; Wave-4 acceptance gate (f) is
where the deploy gets proven.
