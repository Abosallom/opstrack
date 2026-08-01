# Phase A — live proof

**Date:** 2026-08-01 · **Commit under test:** `f8ee26f` *(feat(phase-a): Technical/Business groups, nudge, AI capture assist)*
**Target:** the deployed app at <https://abosallom.github.io/opstrack/> and the live Supabase project `lrysgpbkmuqgzsjesfkr`.
**Driver:** a real Chrome session signed in as `az.alsaloom@gmail.com`, plus the Supabase Management API for server-side ground truth.

Times are **UTC** unless marked. Riyadh (the workspace timezone) is UTC+3, so `14:48:36Z` is `17:48:36` on the wall clock in the screenshots.

---

## 0. Live == HEAD, byte for byte

Before testing anything, the deployment was proved to be the commit under test:

| Check | Result |
|---|---|
| `dist/index.html` vs live `index.html` | **identical** (`diff` clean) |
| All 86 built assets (`dist/assets/*.js`, `*.css`) fetched from live and compared by MD5 | **86/86 identical, 0 diffs, 0 misses** |
| `Capture-CM5fVztC.js` MD5 (local / live) | `ce6f8f78ffdc379e7cd4e74981bde805` / `ce6f8f78ffdc379e7cd4e74981bde805` |
| Edge functions | `capture-assist` **v2 ACTIVE**, `admin-members` v13, `claim-account` v13, `send-push` v7 — all `verify_jwt=true` |

> ⚠️ **The first page load served a stale service-worker bundle.** The tab showed "A new version is available. Reload" and `/#/settings/ai` bounced to `/#/followups` because the running JS predated Phase A. Everything below was captured *after* taking that update. Anyone spot-checking this release on a browser that had the app open beforehand must take the update first, or they will be testing the previous version.

---

## 1. AI capture assist — **BLOCKED, and the blocker is not in this codebase**

### The worked example does not work, for exactly one reason

Typing `sprint 38 deployment next friday` into the live capture box produces **no suggestion row**. The reason is not the client, the function, the prompt, the model id, or the validator. It is billing.

The function's own log, pulled from the live project:

```
[assist] upstream upstream_error: 400 {"type":"error","error":{"type":"invalid_request_error",
"message":"Your credit balance is too low to access the Anthropic API. Please go to Plans &
Billing to upgrade or purchase credits."},"request_id":"req_011CdcD3kURkfdn6YLrndpDN"}
```

A second, independent call reproduced it (`request_id: req_011CdcCwCUfanEn9jBTtHteH`). Calling the function directly with a valid member JWT:

```
POST /functions/v1/capture-assist  {"line":"sprint 38 deployment next friday","locale":"en"}
→ HTTP 502  {"error":"The suggestion service is unavailable.","code":"upstream_error"}   (4.8 s)
```

**What this proves works, right up to the paywall:** the client fires, CORS preflight passes, the JWT is accepted, the caller is resolved to a member, the workspace tracks/members/vocab are read, the system prompt and tool schema are built, and an HTTPS request reaches `api.anthropic.com` and is answered. Every link in the chain is live except the last one.

**What could not be tested, and must be re-run once credit exists:** the suggestion row itself — its type, its computed date, its track — for the worked example and for Aziz's three other sentences. `ai_usage` currently holds **0 rows**, which is the honest statement that no call has ever completed.

### Verified as correct by inspection (so the retest should pass first time)

The request shape was checked against the current Anthropic API rather than assumed:

| Parameter | Value in `capture-assist/index.ts` | Verdict |
|---|---|---|
| `model` | `claude-sonnet-5` | valid, current |
| `thinking` | `{type:'disabled'}` | accepted on Sonnet 5 |
| `output_config` | `{effort:'low'}` | valid (`low`…`max` supported) |
| `tool_choice` | `{type:'tool', name, disable_parallel_tool_use:true}` | valid |
| `max_tokens` | `700` | fine for a small tool call |
| `ANTHROPIC_API_KEY` | present as a function secret | confirmed set (never read) |

### ⛔ What Aziz has to do — 2 minutes, and nothing else in this section can be re-run without it

Add credit at <https://console.anthropic.com> → **Plans & Billing**. No code change, no redeploy, no migration. The moment a balance exists the feature is live, because everything else already is.

---

## 2. Fires only on prose — proved from the server, not the console

The browser console **cannot be trusted for this** — its reader duplicated one call into ten identical-timestamped warnings. The authority used instead is `claim_counters`, which `capture-assist` bumps once, server-side, immediately before the upstream call.

| # | Line in the box | Settled for | `ai_user` bump? |
|---|---|---|---|
| A | `Firewall rule DC2 #network !high /action due:thu +verify` — 5 chips, **no problems** | 14:48:36 → 14:51:45 (**3 m 09 s**) | **none** |
| B | `تجديد شهادة SSL لبوابة الدفع قبل نهاية الشهر` (prose, Arabic) | ~10 s | **exactly one**, at `14:52:04.564Z` |

The negative is proved by *absence over three minutes*, not by a single snapshot. A line that already parses is free.

**Two honest corrections to how this looked at first:**

1. An earlier candidate for the "clean" line, `… #network @ahmed !high /action due:thu`, **did** call the API — correctly. `@ahmed` is not a member, so the preview showed *"ahmed" isn't a teammate — keeping it as free text*, and an unresolved `problems` entry is prose by `shouldSuggest()`'s definition. The negative test needs a line with **zero** problems, not merely one with chips.
2. Synthetic keystroke typing pauses long enough to cross the 700 ms debounce, so intermediate half-typed states fire on their own. Setting the value in one shot is the only way to test the *settled* line.

`ipPrefix()` also confirmed working: the IP bucket recorded is `178.87.5.0/24`, a /24 prefix rather than a bare address.

### The off switch stops it dead

`notification_prefs` had **no row** for Aziz (so the `true` default applied). Inserting `ai_enabled = false`:

| Step | Result |
|---|---|
| Set `ai_enabled=false`, then hash-only navigation, prose typed | bump at `14:54:06` — **the switch appeared not to work** |
| …because a hash change does not reload a `HashRouter` SPA, and `loadAiPrefs()` is deduped per session, so the store still held the cached `true` | — |
| Full document load (`?aiofftest=1`), prose `Nasser to finish the DC2 rack audit before the weekend` left in the box **60 s** | **no bump** — last bump still `14:54:06` |

**The switch is enforced: with it off, the line never leaves the browser.** The row was then deleted, restoring `notification_prefs` to its original state (0 rows).

> Worth knowing operationally: because the preference is read once per session, turning the switch off in one tab does not take effect in another already-open tab until it reloads.

---

## 3. Degradation — proved, not asserted

This wave got the degradation test for free and under the harshest possible conditions: **every** AI call during this session failed with a 502, in production, for hours. Capture did not notice.

With the service down, `ZZ PROOF rack audit for DC2 #network @zz.nudgeprobe !high /action due:+2d +proofrun` was typed into the live box and submitted with **Enter**:

- All six chips resolved — `# Network`, `@ ZZ Nudge Probe`, `! High`, `/ Action`, `due: 03/08/2026`, `+ proofrun` — including a member created ninety seconds earlier, resolved by username.
- Preview read *"Creates one item in Network."*
- **No error row, no spinner, no stuck pending state, no layout shift.** The capture screen is byte-identical in behaviour to the one that shipped before this wave.
- The row landed in the live database:

```
id         b9ad0b9b-71fe-4fb4-bd0b-11f578dc4408
title      ZZ PROOF rack audit for DC2
track_id   70b2ef94-…11176 (Network)   owner_id 056f5b29-… (ZZ Nudge Probe)
priority   high    type action    due_date 2026-08-03    status new
created_at 2026-08-01 14:59:05.603Z
```

`due:+2d` from 2026-08-01 → 2026-08-03. Correct.

The structural guarantee behind this is unchanged: `src/lib/capture/parse.ts` is byte-identical to its pre-wave commit (`md5 90930276771dc16e2ecb3d3db6d1874b`) and the submit path was never touched.

---

## 4. Nudge — end to end, including the refusal

Exercised through `nudge_entry()`, the single RPC `src/api/nudge.ts:175` calls (`{ p_entry: … }` — the migration's parameter name).

| Step | Result |
|---|---|
| Throwaway member created | `zz.nudgeprobe` / `ZZ Nudge Probe`, id `056f5b29-90fb-4eb7-9000-de5ed78506ab`, invite `9FWH-9GX8` |
| Entry assigned to them | via `@zz.nudgeprobe` in the capture line (§3) |
| **Nudge #1** | `HTTP 200` → `"2026-08-01T15:00:35.809215+00:00"` |
| **Nudge #2, same entry, minutes later** | `HTTP 429` · `{"code":"PT429","message":"nudge_rate_limited: this item was already nudged in the last 24 hours","details":"2026-08-01T15:00:35Z"}` |

The refusal is specific, not generic — and `details` carries the *first* nudge's timestamp, which is what lets the UI say "asked 3 days ago, no reply" instead of offering to send another.

**Both audit rows exist live:**

```
notifications  id 176  kind 'nudged'  entry_title 'ZZ PROOF rack audit for DC2'
               recipient_id 056f5b29-…  actor_id 397d3122-… (Aziz)  read_at null
               created_at 2026-08-01 15:00:35.809Z
               ── and id 175 kind 'assigned' from the capture itself at 14:59:05Z

entry_updates  id 7dd5b716-797b-421f-8458-1d864e5a9341
               author_id 397d3122-…  body '[nudge]'
               status_from null  status_to null   created_at 15:00:35.809Z
```

`[nudge]` is not a leak — it is `NUDGE_BODY_TOKEN` (`src/api/nudge.ts:68`), a sentinel that `threadBodyKey()` maps to the localized `nudge.threadLine`, so the audit thread renders a sentence in both languages.

**The clock claim holds.** This is the subtle one and it is correct:

```
nudged_at         2026-08-01 15:00:35.809Z   ← stamped
last_activity_at  2026-08-01 14:59:05.603Z   ← UNCHANGED
```

Chasing a neglected item does not make it look attended-to, so it does not drop off Follow-ups.

**Where the button is:** the nudge did **not** appear on the ZZ PROOF follow-up row — correctly, because that row was *Due soon*, not stale/blocked/overdue, which is the stated condition. It was not located in the entry sheet within this session; the sheet was opened on the wrong row twice and the budget went elsewhere. **The RPC and its guards are proven; the placement of the button in the entry sheet is the one item in this section still to be eyeballed.**

### Cleanup verified

| Object | After |
|---|---|
| `ZZ PROOF…` entry | 0 |
| `auth.users` for `zz.nudgeprobe` | 0 |
| `profiles` row | 0 |
| `notifications` for the entry | 0 (cascaded) |
| `notification_prefs` rows | 0 (as found) |
| Total entries | **23** — the pre-test count |

---

## 5. Groups — 2 groups, 9 tracks, and the filter actually hides the other half

Read from the live database:

| Group | `sort_order` | Colour | Tracks |
|---|---|---|---|
| **Technical** / التقنية | 1 | `#7586d5` | Ayenati PMO · IT Ops · Network · Infrastructure · SRE · Dev & QA (**6**) |
| **Business** / الأعمال | 2 | `#93a3b5` | Onboarding · Product Enhancements · Roadmap (**3**) |

**0 ungrouped tracks.** `Onboarding` carries `icon = 'plug'`, the icon added this wave.

### Board, filtered live

The Board's Filter panel shows **Group** as the first facet, above Track, offering *Any group · Technical · Business* with each group's colour. Selecting **Technical** put the group id in the URL (`?group=352b166e-a193-4b66-bb05-3a2c3430450a`) and changed the count:

> **24 items → 20 items**

That arithmetic is exact against the database:

| Bucket | Count |
|---|---|
| Technical (new 14, in_progress 2, blocked 2, waiting_on 1, done-in-window 1) | **20** |
| Business (all 3 in Onboarding) | 3 |
| No track at all | 1 |
| **Total in the Board's window** | **24** |

So filtering to Technical hides the 3 Business items **and** the 1 untracked item. The second part is deliberate and documented at `src/lib/entryFilter.ts:247` — *"an entry with no track has no group either; 'unfiled' is not a third group"* — but it is worth stating out loud, because "my half" quietly excludes anything nobody has filed yet.

**Tracks and Mindtree were not driven** in this session; the group dimension there is asserted by the commit and its tests but is not covered by this document.

### Observation worth a decision (not a defect)

With **Technical** selected, the Track facet below it still lists all nine tracks, including *Onboarding*, *Product Enhancements* and *Roadmap* — tracks that cannot match while the group filter is on. Offering a filter that is guaranteed to produce nothing is a small trap for the intern this app is built for.

---

## 6. Cost — measured where it can be, and honest where it cannot

**`ai_usage` holds 0 rows.** No call has ever completed, so there is no measured token count to report. Reporting one anyway would be inventing it.

What *can* be measured exactly is the request, because the prompt builders are pure and were executed against this workspace's real 9 tracks, 2 members, 7 types and 4 priorities:

| Component | Characters |
|---|---|
| System prompt | 2,427 |
| Tool JSON schema | 1,896 |
| User message (`sprint 38 deployment next friday`) | 63 |
| **Total sent per call** | **4,386** |

At roughly 3.2 chars/token for this mix (English prose plus UUID-dense JSON, which tokenizes poorly) that is **≈ 1,370 input tokens**. The reply is one small tool call of ≤ 8 short fields — **≈ 100 output tokens** (the `max_tokens: 700` ceiling can only be hit by something going wrong).

**Sonnet 5 pricing, today:** $2.00 / MTok input and $10.00 / MTok output under the introductory rate that runs to **2026-08-31**; $3.00 / $15.00 after.

```
per call  (intro)     1,370 × $2/1M   + 100 × $10/1M   = $0.00274 + $0.00100 = $0.0037
per call  (standard)  1,370 × $3/1M   + 100 × $15/1M   = $0.00411 + $0.00150 = $0.0056
```

**Projected to the stated team — 5 people × 20 items/day = 100 captures/day:**

| | Intro rate | Standard rate |
|---|---|---|
| Per day (worst case: every line is prose) | **$0.37** | **$0.56** |
| Per working month (22 days) | **$8.14** | **$12.32** |
| Per year (260 days) | **$96** | **$146** |

**This is the ceiling, and it is deliberately pessimistic**, because it assumes every one of the 100 captures is prose. Every line that uses the token grammar — which is most of what a trained user types, and all of §2's line A — costs **nothing at all**. The real number will be a fraction of the above.

Hard bound regardless: `AI_DAILY_CALL_CEILING = 400` calls per member per day, so five members cannot exceed 2,000 calls/day ≈ $7.40/day even if something goes badly wrong.

### One concrete saving, not taken

`cache_control` appears **0 times** in `capture-assist/index.ts`. The system prompt and tool schema — 4,323 of the 4,386 characters, ~98% of the payload — are **byte-identical on every call** for a given workspace, and at ~1,370 tokens the prefix clears Sonnet 5's 1,024-token minimum for prompt caching. Adding one `cache_control: {type:'ephemeral'}` breakpoint would bill that prefix at ~0.1× on every call after the first, cutting the per-call cost by roughly **70–80%** — to around **$0.001**. Worth doing before this ships to five people.

---

## Summary

| # | Item | Verdict |
|---|---|---|
| 0 | Live == HEAD | ✅ 86/86 assets byte-identical |
| 1 | AI worked example + 3 sentences | ⛔ **blocked on Anthropic credit** — whole chain verified up to the paywall |
| 2 | Clean line makes no call | ✅ proved server-side over 3 m 09 s |
| 2 | Toggle off stops it | ✅ proved after a real reload |
| 3 | Degradation | ✅ full capture, chips and submit with the service 502-ing |
| 4 | Nudge + 24 h refusal + audit rows | ✅ all live; `last_activity_at` correctly untouched |
| 4 | Nudge button in the entry sheet | ⚠️ not eyeballed |
| 5 | 2 groups / 9 tracks / filter hides Business | ✅ 24 → 20, arithmetic exact |
| 5 | Tracks + Mindtree group dimension | ⚠️ not driven |
| 6 | Cost | ⚠️ **not measurable** — 0 completed calls; request measured exactly at 4,386 chars and projected |

**One thing needs Aziz: add Anthropic credit.** Everything else in Phase A is either proved live above or named here as still to check.
