# 0026 and 0027 — the stage ladder, the progress row, goals, and the first aggregate

> ⚠ **SUPERSEDED AS A RUNBOOK by [`RUN-0026-0027-0028.md`](RUN-0026-0027-0028.md).** That page is
> what the owner follows: it covers all three files including `0028`, its checklists are verified
> against the client as merged rather than as promised, and it carries the post-apply checks and
> the runnable verification queries. **This page is kept as the DESIGN handoff** — the contract the
> SQL and the client halves were built from, and the record of why each name is matched by string.
> Where the two disagree, the run page is right. One deviation is already known and is corrected
> in §5 below.

**This was the runbook for the two migration files that ship with map-revamp waves 2 and 3.**
It is written for the one reader who matters here: the owner, alone at the Supabase SQL Editor,
pasting a file and reading what comes back.

Read [`PENDING-MIGRATIONS.md`](PENDING-MIGRATIONS.md) first if you have not today. Its rule stands
and nothing below softens it: **`0023`, `0024` and `0025` are applied and are never re-run.**
`0026` and `0027` ADD; they restate nothing either file owns, which is what keeps the `w_0025` /
`f_0025` canary green after they land.

---

## 1. What the two files do

### `0026_map_node_stages.sql`

| Object | What it is |
|---|---|
| `map_node_stages` | The onboarding ladder — `name`, `name_ar`, `sort_order`, `hidden`, `terminal`, `paused`, `expected_days`. Member-read, `structure.edit`-write, **audited**. No colour column (probe 1 fails the file if one appears). |
| seed: 7 rungs | Not started → Kickoff → Integrating → Testing/UAT → Go-live ready → Live (terminal) → Paused (paused). **Arabic blank on purpose** — those words are yours. `expected_days` set on nothing. |
| `reorder_map_node_stages(p_ids uuid[])` | One-statement atomic reorder, `security invoker`, guarded on `has_perm('structure.edit')`. ⚠ Reordering restates every count-form goal. |
| `map_node_progress` | Where each node got to: `node_id` (PK) · `stage_id` · `stage_changed_at` · `updated_at` · `updated_by`. **MEMBER-WRITE** — the three account managers are members, and recording progress is fieldwork. **Not audited**, deliberately. |
| `map_node_progress_stage_stamp()` | The only writer of `stage_changed_at`. A client value is overruled, not rejected. |
| `map_node_progress_touch()` | `updated_at` / `updated_by`, diffed, both pinned on a no-op. |

**There is no backfill.** After 0026 applies, every organization has *no progress row at all*, and
that is the decision: "no row" means *nobody has said anything yet*, which is a different fact from
the "Not started" rung an AM looked at an organization and chose. Probe 1 fails the migration if any
row was written by it. Bulk starting positions go through the importer, which is undoable.

### `0027_map_node_goals_and_counts.sql`

| Object | What it is |
|---|---|
| `map_node_goals` | "40 organizations beneath this Phase are Live by 31 Dec". `node_id` · `label` / `label_ar` (≤ 60) · nullable `stage_id` · `target` (> 0 or null) · `target_date` (a `date`). **`structure.edit`-write, member-read, audited.** No `metric` column, no unique index — both deliberate, both asserted. |
| `v_map_node_open_counts` | The first aggregate view in the schema: `node_id, open, overdue, breached, unassigned`, one row per map_node *including nodes with zero entries*. **`security_invoker = true` is mandatory** — without it the view runs as its owner, RLS on `entries` is skipped, and it is a data leak with no symptom. |

The boundary rule this view exists for: **a number a human reads as a FACT comes from the server
aggregate; a size a human reads as a SHAPE comes from the working set.**

---

## 2. Before you run anything

1. **`0023`, `0024`, `0025` must already be applied.** Both files preflight-check this and refuse
   with a sentence naming the missing file rather than a bare `42P01`.
2. **The wave-2 client arms must be merged** (§5). Every one of them is matched *by string*; a name
   that exists on one side only degrades a precise sentence to `common.error`, silently.
3. **There must be at least one unarchived track.** Both files' probes hang their fixtures under
   one, and both now *refuse to apply* rather than skip when there is none — a probe that passes
   vacuously is worse than none, and this is a file whose probes are the only proof that the view is
   not a data leak.
4. **Do not rename the stage rungs until both runs of 0026 are done** (§4).

---

## 3. The apply, step by step

Supabase Dashboard → **SQL Editor** → paste the whole file → **Run**. Read the NOTICEs. Then paste
and Run **the same file again**, and read them again.

| Step | File | What you should see |
|---|---|---|
| 1 | `0026_map_node_stages.sql` | 4 probe notices, no errors |
| 2 | `0026_map_node_stages.sql` **again, same sitting** | the same 4 notices — the run is a complete no-op |
| 3 | `0027_map_node_goals_and_counts.sql` | 4 probe notices, no errors |
| 4 | `0027_map_node_goals_and_counts.sql` **again, same sitting** | the same 4 notices |

The second run is not ceremony. It is the test: every table create skips, every column add skips,
every constraint/policy/trigger is dropped and recreated identically, every function is replaced
with itself, the seed's `on conflict … do nothing` inserts nothing — and all eight probes still
pass. If run 2 differs from run 1 in any way other than counts of pre-existing rows, stop and say so.

### What the NOTICEs say when it worked

**0026**

```
NOTICE:  NphiesCore 0026 probe 1: 7 stages present (1 terminal, 1 paused), all seven seeded
         names exist, no colour column, the Arabic index is partial, both progress FKs act as
         designed (cascade on node, set null on stage), map_node_progress_pkey is (node_id),
         the stamp is BEFORE INSERT OR UPDATE and sorts before the touch trigger,
         reorder_map_node_stages(p_ids uuid[]) resolves by argument name, and this file wrote
         0 progress rows.
NOTICE:  NphiesCore 0026 probe 2: the stamp overruled a client-supplied stage_changed_at …
         one stage insert wrote exactly 1 config_audit row and the progress writes wrote 0.
         Rolled back.
NOTICE:  NphiesCore 0026 probe 3: a structure.edit holder (not an admin) created, edited and
         reordered a rung with the audit row landing; a plain member read 7 stages,
         recorded/moved/removed a progress row, moved a pre-existing one with updated_by
         resolving to themselves, and could neither create, reposition, delete nor reorder a
         stage. Rolled back.
NOTICE:  NphiesCore 0026 probe 4: writing a node's existing stage left the progress row
         byte-identical …, and re-saving an unchanged stage — updated_at included — left the
         ladder row byte-identical and wrote no second audit row. Rolled back.
```

**0027**

```
NOTICE:  NphiesCore 0027 probe 1: map_node_goals present (every expected column, node_id
         CASCADE, stage_id SET NULL, exactly 1 unique index = the PK, RLS on, 4 policies,
         BEFORE INSERT order {…guard,…stamp}, BEFORE UPDATE order {…guard,…touch}),
         v_map_node_open_counts is a view with security_invoker=true and columns
         {node_id,open,overdue,breached,unassigned}.
NOTICE:  NphiesCore 0027 probe 2: fixture node read open=3 overdue=1 breached=1 unassigned=1
         (4 entries: 3 open, 1 done and ignored), and an entry-less node read exactly one row
         of zeros. All rolled back.
NOTICE:  NphiesCore 0027 probe 3: a member read N goals and M aggregate rows and could not
         write a goal; the Director arm wrote a goal and emitted 1 config_audit row(s); a
         non-member read 0 goals and 0 aggregate rows through the invoker view. All rolled back.
NOTICE:  NphiesCore 0027 probe 4: a one-field updated_at PATCH and a full unchanged re-save
         both left the goal byte-identical … and wrote no audit row beyond the insert.
         Rolled back.
```

### Two notices that are legitimate, and what they mean

* **`probe 3 SKIPPED: this role cannot 'set role authenticated'`** — the SQL Editor role could not
  switch roles, so the RLS half could not run. The policies *are* installed; the notice tells you
  the two things to check by hand (a member PATCHing `map_node_stages` must affect zero rows; a
  member POSTing `map_node_progress` must succeed).
* **`probe 3: … the structure.edit half was SKIPPED`** (0026) / **`the Director arm was SKIPPED`**
  (0027) — no role grants `structure.edit` without `workspace.admin`, or no role has key
  `director`. The member half still ran **in full**, including every negative assertion.

### What a failure looks like

```
ERROR:  NphiesCore 0026 FAILED: <a sentence saying exactly what is wrong and why it matters>
```

* Every probe raise carries the `NphiesCore 00xx FAILED:` prefix. Those are apply-time refusals
  meant for you, never for a client.
* **A failure rolls the WHOLE file back.** There is no explicit transaction, so the statement that
  Supabase runs is the file, and nothing lands. That is why re-running after a fix is free.
* `CANNOT APPLY:` means a prerequisite file has not been applied here. `CANNOT VERIFY:` means the
  workspace has nothing to hang a probe fixture on (no unarchived track) — create or unarchive one
  and re-run.
* `OT026` / `OT027` are the probe rollback sentinels. They never reach a client and you will never
  see them; if one ever surfaces as an error, that is a bug in the probe, not in your workspace.

---

## 4. ⚠ Run 0026 twice BACK TO BACK, before you rename anything

The seed's conflict target is `lower(btrim(name))`. If you rename the seven rungs to the real
programme vocabulary and *then* re-run 0026, none of the new names collides, so the seed inserts the
seven English originals **again** — a 14-rung ladder, seven of them orphans nobody picked, showing
up in every stage picker and every portfolio roll-up.

So: **both runs of 0026 first, in one sitting. Rename afterwards. Never re-run 0026 after a
rename.** If it happens anyway, probe 1 prints a notice on that run naming the rung count and
telling you to delete the duplicates — it is not silent, but it is not prevented either.

The same discipline is why the probes no longer look up their fixture rungs by the words "Kickoff"
and "Integrating": renaming a rung is a thing you are *expected* to do, and it must never make a
migration refuse to re-apply.

**What you own after the files land** (all one edit each, in the stage admin screen):

1. The real stage words + Arabic for all seven.
2. `terminal` and `paused` where they belong (shipped on Live and Paused).
3. `expected_days` — the stalled threshold — on the rungs that should have one. It ships **unset
   everywhere**, deliberately: a threshold nobody chose is a number the app would chase people with.
   Setting it does **not** stop 0026 from re-applying.

---

## 5. The wave-2 client checklist — ALL of it lands BEFORE step 1

Every name below is matched by string. A rename on one side alone does not break a build, does not
fail a test, and does not raise: it turns a precise sentence into `common.error` months later.

### `src/lib/pgError.ts`

**23505 (unique) — Arabic arm first, house order**

| Match | Key |
|---|---|
| `map_node_stages_name_ar_uidx` | `mapadmin.errStageNameArTaken` |
| `map_node_stages_name_uidx` | `mapadmin.errStageNameTaken` |
| `map_node_progress_pkey` | `mapadmin.errStageAlreadyRecorded` |

`map_node_progress_pkey` is the one an AM is likeliest to meet: `node_id` is the primary key, so a
plain `insert` against an organization that already has a progress row raises 23505 naming it. **The
write path must be `.upsert(row, { onConflict: 'node_id' })`, never `.insert(row)`** — the upsert
path is a complete no-op when nothing changed (probe 4 proves it). The arm exists for the tab that
got it wrong anyway.

**23514 (check)**

| Match | Key | Bound the client must enforce |
|---|---|---|
| `map_node_stages_expected_days_chk` | `mapadmin.errStageExpectedDays` | 1 … 3650 |
| `map_node_stages_name_len_chk` | `mapadmin.errStageNameLength` | `STAGE_NAME_MAX = 40` (btrim 1..40), sibling to `CatalogueAdmin.tsx`'s `KIND_NAME_MAX` |
| `map_node_stages_name_ar_len_chk` | `mapadmin.errStageNameArLength` | btrim ≤ 40 |
| `map_node_progress_stage_chk` | `mapadmin.errStageStampMismatch` | unreachable through the app; it must still say something |

**23503 (FK)** — `map_node_progress_node_id_fkey` → `mapadmin.errNodeGone`,
`map_node_progress_stage_id_fkey` → `mapadmin.errStageGone`.

**42501 (token, matched ahead of any generic 42501 arm)** — `map_node_stage_reorder_denied` →
`mapadmin.errStageReorderDenied`.

### The RPC — **by argument name**

`rpc('reorder_map_node_stages', { p_ids: string[] })`, returns `int`. PostgREST resolves the
function from the JSON body's keys; probe 1 reads `proargnames` and fails the migration if it is not
exactly `p_ids`.

### Types / API / store

* `map_node_stages` — `id, name, name_ar, sort_order, hidden, terminal, paused, expected_days,
  created_at, updated_at, created_by` (no `updated_by`, matching `map_node_kinds`).
* `map_node_progress` — `node_id, stage_id, stage_changed_at, updated_at, updated_by`.
* Indexes that exist and may be relied on: `map_node_stages_sort_idx`, `map_node_progress_stage_idx`.
* Cache keys: `nphiescore_map_node_stages_v1`, `nphiescore_map_node_progress_v1`.

### The write contract

* **Upsert progress on the PK**: `.upsert(row, { onConflict: 'node_id' })`.
* **Never send `stage_changed_at`, `updated_at` or `updated_by` on a progress write** — all three
  are server-written, and a sent value is silently *overruled*, not rejected. It will read as working.
* **Never send `updated_at`, `created_at` or `created_by` on a stages write.** The touch now pins
  `updated_at` back on a no-op, so a sent value cannot corrupt the row — but a store that PATCHes
  the whole row it read is sending three columns the server owns.
* `stage_id: null` on an existing row and **no row at all** both render as unstaged and are
  different facts: no row = "nobody has said"; `stage_id null` = "somebody cleared it". To return a
  node to "nobody has said", **DELETE** the progress row.
* Clearing must use the `!== undefined` discipline (`api/map.ts:181`'s lesson): `null` is a real
  instruction, and a truthiness test turns every clearing into a silent no-op.

### Locale

⚠ **CORRECTED AS BUILT.** This section asked for `src/locales/{en,ar}/stages.json`. The sentences
landed in **`src/locales/{en,ar}/mapadmin.json`** instead, and had to: the key names `pgError.ts`
matches are `mapadmin.*`, so a `stages.json` would have had to be rooted at `mapadmin` and would
then collide with the existing file at `src/locales/index.ts`'s flat spread. The screen's own
strings are in `catalogue.json` beside the two lists they sit under. Ten `errStage*` / `errNodeGone`
keys and three wave-3 `errGoal*` keys are in both bundles; the reorder confirmation
(`catalogue.reorderStagesBody`) states the count-form-goal consequence, as required below.

The original text, for the record:

`src/locales/{en,ar}/stages.json` with LITERAL key tables, carrying the six `mapadmin.errStage*`
sentences plus the reorder confirmation — **whose copy must state that reordering the ladder
restates every count-form goal.** Stage names are database text and go through a
`stageLabel` / `useStageLabel` pair in `lib/labels.ts` with `nodeLabel`'s `name_ar.trim() || name`
rule.

---

## 6. The wave-3 client checklist — lands BEFORE step 3

### Tokens (`pgError.ts`)

| Token | SQLSTATE | Key |
|---|---|---|
| `map_node_goal_target` | 23514 | `mapadmin.errGoalTarget` — **the one new locale key** (en + ar). e.g. "A goal has to name a positive number of organizations." |
| `map_node_goal_node_missing` | P0002 | reuse `mapadmin.errNotFound` |

⚠ Checked deliberately: `map_node_goal_node_missing` does **not** contain the substring
`map_node_missing`, so 0023's existing arm will not catch it. The new arm is required, not optional.
Put the two adjacent.

### Constraint names (`pgError.ts`)

| Match | Key | Note |
|---|---|---|
| `map_node_goals_target_chk` | `mapadmin.errGoalTarget` | 23514 backstop under the token |
| `map_node_goals_label_len_chk` | `mapadmin.errGoalLabelLength` | **required, not optional** |
| `map_node_goals_label_ar_len_chk` | `mapadmin.errGoalLabelArLength` | **required, not optional** |
| `map_node_goals_node_id_fkey` / `map_node_goals_stage_id_fkey` | 23503 | optional |

The two label constraints have **no token behind them** — a label over 60 characters arrives as a
raw `23514 … "map_node_goals_label_ar_len_chk"` on a form with two label fields, in an RTL layout,
with nothing saying which field is wrong. **`GOAL_LABEL_MAX = 60` in the goal editor as a maxlength
on both fields, and the two must agree.** Labels go over 60 when somebody pastes a phrase out of a
planning deck.

There are **no unique indexes** on `map_node_goals`. Do not write a duplicate-name arm.

### Names the API / store / types layer must spell exactly

* table `public.map_node_goals`; columns `id, node_id, label, label_ar, stage_id, target,
  target_date, created_at, updated_at, created_by, updated_by`.
* view `public.v_map_node_open_counts`; columns `node_id, open, overdue, breached, unassigned`,
  selected **by name** (`listTrackSlas`' precedent). All four counts are `int`, never null, one row
  per map_node including nodes with zero entries. A rename here is a silent `undefined` in a panel,
  not an error.
* indexes `map_node_goals_node_idx`, `map_node_goals_date_idx` — never surface in an error; listed
  so nobody renames them casually.

### Semantics the folds must honour

* `stage_id` NULL = "a terminal stage"; a value = "that stage **or beyond**", i.e.
  `map_node_stages.sort_order >= that stage's sort_order`. **Reordering the ladder restates every
  count-form goal.**
* `target` NULL = a pure date goal about the node itself; a positive int = a count of DESCENDANTS.
  Never 0 — the DB refuses it.
* `target_date` is `date`, not `timestamptz`. Do not put it through a timezone-aware formatter.
* Goal writes need `structure.edit`; `src/lib/permissions.ts` must disable the goal editor for a
  plain member, because an RLS-blocked UPDATE affects **zero rows** rather than raising.
* The view is for FACTS; the truncated working set stays the source for SHAPES. Two arithmetics for
  one question is the failure the rule exists to prevent.
* `getMapNodeUsage()` (`api/map.ts:360`) gains a fourth count, `goals` — `node_id` is
  `ON DELETE CASCADE`, so goals are destroyed rather than refused.
* `invalidateConfig()`'s comment/list gains goals.

No new permission key, no new RPC, no new cache key from 0027. `map_node_goals` is **not** on the
boot path — it belongs in the lazy portfolio store, not `store/config`.

---

## 7. After both files are live

Run the `PENDING-MIGRATIONS.md` verification query unchanged and confirm **`f_0025 = true` and
`w_0025 > 0`.** Neither file redefines anything `0023` / `0024` / `0025` owns — no
`create or replace` and no `drop` in either file targets an object those files created — so the
canary must be exactly what it was before. If it moved, something else ran.

Then, in the app (these are the things a probe cannot see, because `now()` does not move inside one
transaction):

1. **A stage change moves the clock.** Set an organization's stage, wait, set it to a *different*
   stage: `stage_changed_at` must move on the second write and `updated_at` with it.
2. **A no-op does not.** Save the stage it already has: nothing moves, and no `config_audit` row
   appears for `map_node_stages`.
3. **Exactly one audit row per goal edit**, and **zero** for any progress write.
4. **The aggregate agrees with the panel.** Open a node with entries: the panel's "N open" comes
   from `v_map_node_open_counts`, and it must match what the node actually holds — this is the
   number that used to be silently low past 1,000 rows.
5. **A member cannot edit the ladder**: sign in as a plain member, try to rename a stage — the
   screen must refuse it (permissions.ts), and the API must affect zero rows.

---

## 8. Where the reasoning lives

Both files carry their arguments in the file, at the top and beside the object. If you want to know
*why* the stage is a side table rather than a column on `map_nodes`, why there is no backfill, why
there is no colour column, why `map_node_progress` is not audited while `map_node_stages` is, or why
`security_invoker` is the one thing a reviewer must check — read the headers. They are the record,
and this page is only the runbook.
