# W-AI handoff — what the AI wave left open, and where it is

**Four files pointed at this document before it existed.** `0020_ai_usage.sql:64`,
`supabase/functions/capture-assist/index.ts:1271`, `src/store/ai.ts:266` and `src/store/ai.ts:578`
each deferred a decision "to the W-AI handoff note", and there was no such note anywhere in the
repository. Three accepted risks were therefore left to be discovered rather than recorded, which
is the opposite of what naming them was supposed to achieve.

This is that note. Every item below says what it is, whether it is closed, and — when it is not —
exactly what closing it costs.

**Status date:** 1 August 2026. Live project `lrysgpbkmuqgzsjesfkr`.

---

## ⛔ THE ONE THING THAT NEEDS AZIZ — 2 minutes, and nothing else is waiting on him

**The Anthropic account behind the `ANTHROPIC_API_KEY` function secret has no credit, so the AI
capture assist has a 0% success rate in production and has never produced a suggestion.**

Re-verified live today, after this pass's changes were deployed, with a real member JWT
(`nasser@opstrack.internal`, minted via admin `generate_link` + `POST /auth/v1/verify`):

```
POST https://lrysgpbkmuqgzsjesfkr.supabase.co/functions/v1/capture-assist
{"line":"sprint 38 deployment next friday","locale":"en"}
→ HTTP 502  {"error":"The suggestion service is unavailable.","code":"upstream_error"}
```

The edge log says why, and it is not this codebase:

```
[assist] upstream upstream_error: 400 {"type":"error","error":{"type":"invalid_request_error",
"message":"Your credit balance is too low to access the Anthropic API. Please go to Plans &
Billing to upgrade or purchase credits."},"request_id":"req_011CdcGbXBxUznGCF4X7Gdfb"}
```

Independent corroboration that no call has EVER completed: `public.ai_usage` holds **0 rows**, and
the edge function reaches `ai_usage_record` only after the upstream call returns billed work. An
empty table is a database fact, not an inference.

**The failure is a 400, not a 401** — Anthropic authenticated the key and refused the request on
billing. So the fix is a top-up or a re-point at a funded workspace
(console.anthropic.com → Plans & Billing), **not** a re-key and **not** a code change. The request
shape was checked against the current API and is correct: `claude-sonnet-5`,
`thinking: {type:'disabled'}`, `output_config: {effort:'low'}`, `disable_parallel_tool_use`, and
`strict: true` structured tool use are all valid for this model.

**What is still true while it is down.** The degradation contract holds and was exercised harder
than any test could have arranged: every AI call has 502'd for hours and capture has not noticed.
`src/lib/capture/parse.ts` is untouched, `Capture.tsx` behaves exactly as it does today, and
`src/store/ai.ts` swallows the failure to the Settings screen only.

**What must not be claimed until a 200 is on record.** Verification items 4 (a live worked example
in both languages) and 5 (*"cost measured, not estimated: token counts from real calls"*) are
unsatisfiable. Prompt quality, real latency, real `inputTokens`/`outputTokens` and the `refusal`
path are all unexercised against the live model. The request size can be measured without credit
— roughly 4,386 characters per call, ≈1,370 input tokens — but that is a measurement of the
**request**, not of the bill, and the evidence pack must say so.

---

## The three risks 0020 and `capture-assist` deferred here

### (a) Re-running `0010` disarmed the AI burst limiter — **CLOSED**

`0020:53-64` stated it and left it armed: `0010_claim_counters.sql` is re-runnable and
drops-then-adds `claim_counters_scope_ck` with its own list, so re-running 0010 after 0020 reverted
the widening and every `claim_bump('ai_user', …)` failed with `23514`. `bump()`
(`capture-assist/index.ts:1017-1027`) logs and returns by design, so the per-minute abuse ceiling
on a metered upstream would simply stop existing with no signal anywhere a person looks.

It was measured on the live project rather than argued about, and the measurement sharpened the
claim — **the shape of the failure depends on whether the table happens to hold AI rows**:

| State of `claim_counters` | Re-running the OLD 0010 | Verdict |
|---|---|---|
| `ai_user`/`ai_ip` rows present | aborts: `23514 … is violated by some row`, whole migration rolls back | loud, harmless |
| those rows absent | applies cleanly; constraint becomes `CHECK (scope = ANY (ARRAY['username','ip']))`; the next `claim_bump('ai_user', …)` writes no row and raises nothing anyone sees | **silent** |

The buckets are 60-second rolling windows with a GC pass by age, so **absent is the normal state**
and the silent half is the likely half.

**Fix, in three places so it cannot come back:**

1. `0010_claim_counters.sql` now lists all four scopes in its own `add constraint`, with a comment
   saying the list is the union of every scope any migration uses and a new scope must be added
   there as well as in the file that introduces it.
2. `0022_nudge_stamps_on_insert.sql` PART 2 re-asserts the same four values idempotently.
3. `0022` PROBE 3 reads the constraint out of `pg_constraint`, refuses if any of the four is
   missing, and then actually calls `claim_bump` on both AI scopes — a constraint that allows a
   scope the function cannot bump is the same outage with a different cause.

Verified: 0010 applied twice and 0022 applied twice against the live project; PROBE 3 confirmed
load-bearing by narrowing the constraint by hand and watching it refuse.

### (b) A billed call that was never recorded — **MOSTLY CLOSED**, one residual

`ai_usage_record` used to run only on `result.ok`. That is the wrong test in both directions, and
the direction that mattered was expensive: **a refusal and an unusable reply are HTTP 200s with
real `usage` blocks** — the model ran, the tokens are on the invoice — and neither was recorded.
A prompt that reliably produced replies the validator could not use could therefore be retried
against the daily ceiling *forever, for free, at the owner's expense*, which is precisely the
runaway `AI_DAILY_CALL_CEILING` exists to bound.

`capture-assist/index.ts` now has a pure, tested `isBilled()` and records against the invoice's
rule rather than the feature's:

| Outcome | Recorded? | Why |
|---|---|---|
| completed call | yes, with real token counts | it worked and it was billed |
| `upstream_refused` (200, `stop_reason: refusal`) | yes, with real token counts | the model ran |
| `unusable_reply` (200, no `tool_use` block) | yes, with real token counts | the model ran |
| `upstream_timeout` (aborted at 8s) | yes, **as one call with zero tokens** | the model does not stop generating because this function stopped listening; `calls` is a rate ceiling and must count it, the token columns are the bill and must not be invented |
| `rate_limited` (429) or any 4xx | **no** | refused before inference, no `usage` block — a project whose key has run out must not burn its own daily quota discovering that on every keystroke |

Proven live today: two calls returning 502 from the 400 credit-balance error left `ai_usage` at
**0 rows** while `claim_counters` bumped to `n=2` on both AI scopes — attempts throttled, spend
correctly not recorded. The positive branch is covered by unit tests
(`supabase/functions/capture-assist/index.test.ts`) and **cannot be proven live until the blocker
above is cleared**.

**RESIDUAL, still open and deliberately so.** A failure of `ai_usage_record` itself is logged and
swallowed (`index.ts`, step 9). The money is already spent, so failing the request would lose both
the accounting row *and* the answer the member is waiting for. If the ledger is *persistently*
broken the daily ceiling stops rising and only `AI_USER_MINUTE_CEILING` (30/min) remains — a
theoretical ~43,200 calls/user/day against a ceiling documented as 400. Closing it properly means
recording the attempt *before* the upstream call and reconciling token counts after, which is two
round trips on the keystroke path and a new RPC signature. **Not done. Decide deliberately, not by
accident.**

### (c) There is no feedback table, so "Not right" cannot persist — **OPEN**

`src/store/ai.ts:565-607` (`reportSuggestionMiss`) dismisses the row, evicts the cache entry so the
same words are asked about afresh, and `console.warn`s the field names. It does not persist, and
the button is honest about that — it says the suggestion was ignored and does not claim a record it
cannot show. But the Preview convention's whole argument is *"a feature that cannot be corrected
cannot be improved"*, and a correction that survives only in a browser console is not collected.

**The shape it needs**, so nobody has to re-derive it:

```sql
create table public.ai_feedback (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  day        date not null default public.ai_usage_day(),
  model      text not null,
  -- FIELD NAMES ONLY. Never the capture line, never the proposed values.
  proposed   text[] not null default '{}',
  dropped    text[] not null default '{}',
  created_at timestamptz not null default now()
);
```

**The constraint that makes it safe is what it does NOT store.** `0020`'s header refuses prompt and
response text for the ledger and the same rule holds here, for a sharper reason: the reporting path
must not become a way to persist a capture line that `validate()` refused on the capture path. Field
names and a timestamp; nothing a model wrote.

RLS to match `ai_usage`: insert via a `security definer` RPC under the service role, self-select for
`authenticated`, no direct write grants.

---

## Found during the db-edge fix pass, recorded here rather than left to be discovered

### 1. `ownerName` is refused by the client validator on every good suggestion — **minor, open**

Not a security hole and not a wrong assignment: `ownerId` is validated independently and survives,
so a suggestion that names a person still assigns correctly.

It is **noise in the channel the Preview convention depends on**. The edge function emits
`ownerName` for display (`capture-assist/index.ts:613`); `REFUSED_FIELDS`
(`src/lib/ai/types.ts:263`) refuses that key outright. So every successful suggestion that names an
owner arrives at `validate()` carrying a key it refuses, `dropped` gains a
`{field:'ownerName', reason:'unsupported'}` record, and `src/store/ai.ts:444` console.warns. A
"this suggestion was wrong" signal that always fires cannot tell anyone which prompt to fix.

It went unnoticed because it is silent when no owner is proposed — `absent()` treats `null` as "not
proposed".

Pinned by a test that **goes red when it is fixed**, on purpose:
`supabase/functions/capture-assist/handoff.test.ts` → *"the one field the two sides disagree
about"*. The fix is a wire-shape decision spanning `src/api/ai.ts` and `src/lib/ai/types.ts`, which
the db-edge area does not own.

### 2. The two validators are NOT duplicates, and the comment saying they are is misleading

`capture-assist/index.ts:535-540` calls `validateProposal()` *"a deliberate duplicate of
src/lib/ai/validate.ts"* and asks for the two to be kept in step by hand, with "the fixture cases
named in the plan" as the shared contract. Read side by side they are two links of one chain, not
two copies of one link:

* the edge reads the **model's tool arguments** — `track_id`, `owner_id`, `due_date`,
  `follow_up_date`, snake_case, plus `confidence`, plus the title-subsequence rule;
* the client reads the **edge's reply** — `trackId`, `ownerId`, `dueDate`, `followUpDate`,
  camelCase, plus `tags` and `REFUSED_FIELDS`, and no `confidence` at all.

A fixture table run through both would fail for reasons that are not defects. What is worth pinning
is the **handoff**, and that is what `handoff.test.ts` does: everything the edge approves survives
the client, everything it refused stays refused, no refused value crosses the wire in any field —
plus the two things only the client can know (whether a real track is addressable by a `#token` at
all, and the browser's own clock).

### 3. Nudges ride the "Assigned to me" push switch

`claim_push_batch` filters on `case when n.kind = 'completed' then push_completed else
push_assigned end`, so `nudged` follows `notification_prefs.push_assigned`. **Intentional and now
documented** — `src/locales/{en,ar}/push.json` says *"Something became mine, or a colleague is
asking me for an update. Both ride this one switch."* A third preference column is a migration plus
a Settings row; nobody has asked for one. Recorded so the next reader knows it was a choice.

### 4. Widening `notifications.kind` now requires a `send-push` redeploy

`buildPayload()` returns `null` for a kind this build has no sentence for, and the drain suppresses
it exactly as it suppresses a recipient with no registered device — obligation complete, inbox row
intact, one `console.warn` naming the kind. That is the right polarity (a lock-screen banner
stating something untrue is worse than no banner), but it means **a future migration that widens
`notifications_kind_check` must ship a `send-push` deploy in the same breath**, or the new kind
will be silently push-less. The warning line is `[send-push] no sentence for kind "…" — suppressed`.

### 5. Edge function sources and their tests are outside `tsc -b`

`tsconfig.app.json` includes `src` only and `tsconfig.node.json` includes the two config files, so
nothing under `supabase/functions/` is typechecked by the build gate — which was already true of
the function sources and is now also true of their tests. They ARE run: `vitest.config.ts` collects
`supabase/functions/**/*.test.ts` and rewrites the `npm:@supabase/supabase-js@2` specifier so a test
can import the deployed file rather than a copy of it. `oxlint` skips the directory too
(`.oxlintrc.json` `ignorePatterns`).

Adding a third TS project reference would fix it, but it has to resolve the `npm:` specifier through
a `paths` mapping and would put previously-unchecked Deno code inside the gate everyone else is
waiting on. **Deliberately not done in a concurrent fix pass.** Worth doing on a quiet branch.

### 6. `[assist] peek(…) failed: JWT issued at future` — transient, fails open, not reproducible

Seen twice in the edge logs, both times on the FIRST call made with a JWT minted seconds earlier;
`handle()` logs and continues, so the per-minute ceiling fails open for that request.

Not reproducible in steady state: three consecutive calls with a ~90-second-old JWT produced no
such line and `claim_counters` showed `n=3` on both `ai_user` and `ai_ip`, so the burst limiter
demonstrably works. The service-role key's own `iat` is old and a direct `claim_peek` through
PostgREST with that key returns `200 / 0`, so the key is not the cause. Best explanation remains
clock skew between the auth issuer and PostgREST on a freshly minted token. **Left as an
observation with evidence rather than a fix**; if it ever becomes frequent, the symptom to look for
is that log line and the absent counter row.

### 7. Two stale comments in `src/store/ai.ts` (another area's file)

* `:266` — *"`notification_prefs.ai_enabled` is this wave's one outstanding migration"*. It is not
  outstanding: `0021_ai_prefs.sql` is applied and the column exists live. The `42703` handling
  below it is still correct defence-in-depth; only the sentence is out of date.
* `:266` and `:578` still say **"W-AI-APP handoff"**. This file is `docs/W-AI-HANDOFF.md` and
  covers both; the references should point at it by path.

---

## Migrations

`0018`–`0022` are all applied to the live project, each twice, and verified from the catalog rather
than from the apply. See `docs/PENDING-MIGRATIONS.md` for the table and the verification query.
