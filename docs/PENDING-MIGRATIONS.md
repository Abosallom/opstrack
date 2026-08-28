# Migrations: what has run, and what has not

**This file is the answer to "what still has to be run?" — check it before every deploy.**

It exists because the critic caught the failure it prevents: `README`, `ADMIN.md` and
`RUNBOOK.md` all stopped at `0013`, and the RUNBOOK's own verification query checked twelve
things ending at `0013` and reported **"all twelve yes"** — while four migrations sat unapplied.
A verification that cannot fail is worse than none.

**Then this file went stale in the more dangerous direction**, which is why it now carries an
*applied* table and a *pending* one instead of a single list. Until 13 August 2026 the status
section read *"`0023_map_nodes.sql`, `0024_map_use_cases.sql` and `0025_roles_permissions.sql`
are PENDING. None has ever been run against any database"* — after the owner had applied all
three and after the importer had written 22 nodes and 67 use-case links through them. A runbook
that says "run these, in order" about migrations that are already on the database is not merely
out of date. **Following it re-runs `0023` after `0025`**, which restores `is_admin()` on
`map_nodes` and `map_node_kinds` and silently strips the Director role of the entire tree — the
exact defect the `w_0025 = 0` warning at the bottom of this page describes, delivered by the page
that warns about it, to the one reader who is alone at a SQL Editor and trusting it. **A stale
"pending" is a live instruction.**

## Status — 28 August 2026

**One file is pending: `0030_map_view_settings.sql`.** Every other migration written to date is
applied to the live project (`lrysgpbkmuqgzsjesfkr`), 0036 included — it went on on 28 August.

**0036's guards were tested against the live database rather than assumed**, which is the standard
this page asks for and the reason it is worth writing down: removing `intake` is refused with
*"intake is on every ladder and cannot be removed"*, and removing STG/TEST from Lab Order is
refused with *"36 organizations are at this rung for this use case"*. That second number is the
guard doing its job on real rows — 36 pairs that would otherwise have been left standing on a rung
their own capability no longer had.

Re-probed over REST against the live project on **28 August 2026**, object by object rather than
by trusting any apply: `map_node_stages` (7 rows), `map_node_progress`, `map_node_goals`,
`v_map_node_open_counts`, `jira_settings`, `map_node_branches`, `map_nodes.org_id`, the nine
`pmo_*` tables, `map_node_use_cases.rung` / `.scope` / `.overrides`, `map_node_use_case_events`,
`map_node_readiness`, `his_products` (seeded) and `map_nodes.his_id` all answer. Only
`map_view_settings` answers **404**, and it has never existed anywhere.

**0032, 0033, 0034 and 0035 were applied by the owner at the SQL Editor on 27–28 August 2026.**
0035 failed its first paste on a syntax error — a trailing comma inside the `array[…]`
constructor, which Postgres reported as `syntax error at or near "]"`. The Supabase SQL Editor
runs a file in a transaction, so **nothing of 0035 landed on that attempt**; the comma was removed
and the whole file re-run clean. Worth keeping: the failure was in the `create or replace function`
validator, which is the one place in that file where a partial apply would have been invisible.

### ⛔ 0023, 0024 and 0025 are APPLIED. None of them is ever re-run.

The owner applied all three at the SQL Editor on **12 August 2026**, in order. The evidence is
not the apply — it is the state:

* **`0023` and `0024`**: the demo import wrote **22 nodes and 67 use-case links** to the live
  project at `19:54:32Z` on 12 August, through `map_nodes` and `map_node_use_cases`, and recorded
  every id it wrote in
  `docs/EVIDENCE/import-runs/import-20260812T195432Z-lrysgpbkmuqgzsjesfkr.json`. Those tables do
  not exist without `0023`/`0024`. The workspace held exactly one node (`UHR > OB`) before it.
* **`0025`**: `roles`, `role_permissions` and `profiles.role_id` are live, seeded, and the
  Director grants are real — `has_perm('structure.edit')` is what reaches `map_nodes` today, not
  `is_admin()`.

| # | File | Applied | What it did | Verify live by (runnable today) |
|---|---|---|---|---|
| 0023 | `map_nodes.sql` | 12 Aug 2026 | The hierarchy below tracks: `map_nodes`, `map_node_kinds`, the deferred tree check, `reorder_map_nodes` / `move_map_node`, and a redefinition of two 0002 objects | `map_nodes` + `map_node_kinds` tables present; 3 rows in `map_node_kinds`; `map_nodes.vendor` column present; `map_nodes_tree_ck_trg` is `tgdeferrable`; `map_nodes_sibling_name_uidx` definition contains `NULLS NOT DISTINCT` |
| 0024 | `map_use_cases.sql` | 12 Aug 2026 | The capability catalogue and the entry's finer grain: `use_cases`, `map_node_use_cases`, `entries.node_id`, and the `entries_map_sync` trigger that DERIVES `track_id` from the node | 10 rows in `use_cases`; `map_node_use_cases` table present; `entries.node_id` column present; `entries_map_sync` BEFORE INSERT OR UPDATE trigger on `entries` |
| 0025 | `roles_permissions.sql` | 12 Aug 2026 | Custom roles: `roles`, `role_permissions`, `profiles.role_id`, `profiles.position`; the redefinition of `is_admin()` into `has_perm('workspace.admin')` that makes permissions data without editing 183 policies; and the 21 write policies on the seven configuration tables re-pointed at `structure.edit` / `vocab.edit` | 3 rows in `roles`; 9 rows in `role_permissions`; 0 profiles with a null `role_id`; `pg_get_functiondef('public.is_admin()')` contains `has_perm`; `role_permissions_key_ck` lists all five keys; **`map_nodes_insert`'s `with_check` in `pg_policies` contains `structure.edit`, and `role_permissions_update`'s does NOT** |

Those "verify live by" columns are not history. They are the single-column form of the query in
[How to confirm](#how-to-confirm-what-is-live), they run today, and each one goes false the moment
somebody re-runs the file below it.

**`0023` and `0024` are never re-run again — full stop.** Both are internally re-runnable and were
built to be applied twice; that property expired the moment `0025` landed on top of them, because
each one owns the `is_admin()` version of policies that `0025` has since re-pointed at
`structure.edit` / `vocab.edit`. Replaying either restores its own policies and **the Director role
silently grants nothing on that table**: no error, no failed statement, a Director's writes simply
affect zero rows. There is also live data in those tables now, which the original re-run argument
never had to consider.

**`0025` alone may be re-applied — always last, and only as a repair.** It is the documented fix
when the verification query returns `f_0025 = false` (something re-ran `0001`/`0002` and
`is_admin()` no longer calls `has_perm`) or `w_0025 = 0` (something re-ran `0023`, `0024`,
`0009`, `0017` or `0018` and took a configuration table's write policies back to `is_admin()`).
Re-applying `0025` replays all five of its probe blocks, which is the second reason it is the safe
one to replay: it re-asserts the whole permission surface on the way through.

### 0025 was amended on 11 August, and applied on 12 August as amended

`0025` was **amended in place, not superseded by an 0026**, on 11 August 2026 — the day before it
first ran. That was free at the time: no applied state to migrate from, no checksum to invalidate
(this project has no `supabase_migrations.schema_migrations` table — see the `0010` note below),
and amending an unapplied file costs nothing where amending an applied one costs a new file
forever. **That window is closed. The file on this branch is the file the live project has**; if
you are holding a copy of `0025` taken before 11 August, it is not what ran — throw it away.

What the amendment changed, and why it had to:

* **The Director role granted nothing.** The first cut defined `has_perm(key)`, seeded five keys
  and shipped `structure.edit` / `vocab.edit` / `capture.write` with **no policy anywhere reading
  them** — every write policy still said `is_admin()`, which `0025` redefines as
  `has_perm('workspace.admin')`. A Director could therefore write exactly what a plain member
  can: nothing. The roles screen would have rendered three of its five switches wired to nothing,
  which is the precise failure the file's own header spends a page warning about.
* **Seven configuration tables now check a key.** `tracks`, `track_groups`, `map_nodes` and
  `map_node_kinds` write on `has_perm('structure.edit')`; `use_cases`, `vocab_options` and
  `label_overrides` on `has_perm('vocab.edit')`. Twenty-one policies in total, INSERT/UPDATE/
  DELETE each. Every `select` policy is untouched — reading is `is_member()`.
* **The predicate is the key alone, not `key or is_admin()`.** Admin holds all five keys, so an
  admin passes by *holding the key*; `or is_admin()` would make `structure.edit` a switch wired
  to nothing for the Admin role, which is the same defect one level up. Revoking it from Admin is
  recoverable in-app because Admin still holds `members.manage`, which gates `role_permissions`.
* **`profiles`, `roles` and `role_permissions` were deliberately NOT moved.** That is the
  escalation boundary: a role that can edit permissions can grant itself anything, so
  `role_permissions` stays on `members.manage` (Admin only) and `profiles` stays on `is_admin()`.
  Without that, "Director" is one click from "Admin".
* **`is_admin()` keeps its meaning** and every policy not in the list above is untouched.
* **`0025` gained a preflight** and refuses to apply before `0023`/`0024` with a sentence instead
  of a bare `42P01` from the middle of the file. It is still armed, and it is what makes a
  re-apply of `0025` safe to attempt in any state.
* **The eight admin RPCs are restated too** — `reorder_tracks`, `delete_track`,
  `reorder_map_node_kinds`, `reorder_map_nodes`, `move_map_node` on `structure.edit`;
  `reorder_vocab`, `reset_vocab`, `reset_label_overrides` on `vocab.edit`. Re-pointing the
  policies alone left a Director who could create, rename and delete a map node and could not
  **drag** one: RLS willing, the RPC refusing with `42501`. Added at the Wave-B gate, after the
  policy half; see "What 0025 does NOT do" below for why they live in `0025` and not in the four
  files that own them.
* **PROBE 5 is new**, and `PROBE 2` gained two assertions. See the probe list below.

### ⚠ 0025 owns three functions, eight more, and 21 policies that other files wrote

`is_admin()` and `guard_profile_role()` are **0001**'s (the guard last rewritten by **0016**), and
`log_config_audit()` is **0002**'s. All three are restated in full inside `0025`, so
**re-running 0001, 0002 or 0016 silently reverts part of it** and the fix is to re-apply `0025`.
`0025`'s own PROBE 1 detects exactly this and names it: it reads
`pg_get_functiondef('public.is_admin()')` and fails if the body no longer calls `has_perm`.

**The amendment widened that list to policies, and then to eight more functions.** `0025` owns the
INSERT/UPDATE/DELETE policies on `tracks` and `vocab_options` (**0001**/**0009**),
`label_overrides` (**0017**), `track_groups` (**0018**), `map_nodes` and `map_node_kinds`
(**0023**) and `use_cases` (**0024**) — 21 in all — **plus `reorder_tracks` (0002),
`reorder_vocab` + `reset_vocab` (0003), `reset_label_overrides` (0017) and `delete_track` +
`reorder_map_node_kinds` + `reorder_map_nodes` + `move_map_node` (0023)**. Eleven functions and
21 policies. Re-running one of the *function* files leaves a LOUD failure rather than a silent
one — RLS accepts the write and the RPC refuses it with a clean `42501` — but it is still the
role failing to do what its name says, and **probe 5 half A(iii) reads `pg_get_functiondef` and
names all eight**. Re-running any of those six files restores the `is_admin()` version of its
policies and **the Director role silently grants nothing on that table**. There is no error and no
visible symptom: a Director's writes simply affect zero rows. `0025`'s PROBE 5 half A checks all
21 by name against `pg_policies` and cannot be skipped, and `w_0025` in the verification query
below is the one-column version. **Fix by re-applying `0025` — always last.**

The damage from that reversion is bounded ON PURPOSE. `profiles.role` is **kept and kept
derived** — `role = 'admin'` ⟺ `role_id` is the system Admin role — so a restored 0001
`is_admin()` reading the text column still answers correctly for every holder of a system role.
The workspace does not lock itself out; it stops honouring custom roles until 0025 is re-applied.

`log_config_audit()`'s guard is **widened** from `is_admin()` to "holds any configuration
permission". Without that, the first custom role carrying `members.manage` without
`workspace.admin` would pass the RLS policy on `roles`, reach the audit trigger, and be refused
by the audit writer — a 42501 on a legitimate edit, blamed on the wrong thing.

### What 0025 does NOT do, and must be said before Aziz opens the permissions screen

* **One of the five permission keys is DECLARED and NOT ENFORCED — `capture.write`.**
  Nothing reads it: `entries` is gated on `is_member()`, which is what it should be, because
  filing work *is* what membership is. It is seeded so that the day a read-only role is wanted it
  is a policy change and not a schema change. **The roles screen must render that one switch as
  not-yet-live.** The other four — `workspace.admin`, `structure.edit`, `vocab.edit`,
  `members.manage` — are all read by policies today and may be rendered as live.
* ~~**A Director can shape the map but cannot DRAG it.**~~ **CLOSED at the Wave-B gate.** The
  eight admin RPCs are restated **inside `0025`**, each with its guard swapped to the key its
  table's policy checks: `reorder_tracks`, `delete_track`, `reorder_map_node_kinds`,
  `reorder_map_nodes` and `move_map_node` on `structure.edit`; `reorder_vocab`, `reset_vocab` and
  `reset_label_overrides` on `vocab.edit`. Every body is the owning file's own text copied byte
  for byte with one line changed, and the message reworded to name the key — `pgError.ts` maps
  `42501` by SQLSTATE, not by text, so no screen sees the rewording.
  **Why restated in `0025` rather than edited in place in the four owning files**, back when
  `0023` was still unapplied and free to edit: `has_perm()` does not exist until `0025` runs, and
  `0025`'s own preflight requires `0023` first. A `0023` that called `has_perm()` could not work
  on the database it is applied to for the length of the sitting. One file owns the re-pointing
  and it is the one that goes last.
  **The cost, and it is live now**: re-running `0002`, `0003`, `0017` or `0023` restores an
  `is_admin()` guard that *contradicts* the policy beside it — RLS accepts the Director's drag and
  the RPC refuses it. **Probe 5 half A(iii) fails on exactly this**, for all eight by name.
* ✅ **THE CLIENT GATE — SHIPPED, AND NOW BACKED BY A DATABASE THAT AGREES WITH IT.** This entry
  once read "the client never offers any of this": nine byte-identical copies of `useIsAdmin()`
  over `profile?.role === 'admin'`, a column `0025` keeps derived from the **system role only**, so
  a Director's legacy text is `'member'` and every screen the database had just opened redirected
  them back to `/settings`. All nine copies are gone. There is one hook — `useHasPerm(key)` /
  `useIsAdmin()` in `src/store/auth.ts:267` — reading `role_permissions` for the signed-in profile
  (both tables are member-readable **by design, precisely so the client can mirror the policy**),
  and the sites ask for the key the policy asks for:
  `structure.edit` at `TracksAdmin`, `TrackEditor`, `GroupsAdmin`, `StructureAdmin`;
  `vocab.edit` at `CatalogueAdmin`, `VocabularyAdmin`, `Terminology`;
  `workspace.admin` at `RolesAdmin` and `Members` (**those two do not move — they are
  `members.manage`, and only Admin holds it**). The same three-way split is in `src/App.tsx`'s
  route table, `src/pages/Settings.tsx`'s cards and `ADMIN_SCREENS` in
  `src/components/CommandPalette.tsx`, which carries a permission key **per row**.
  `CommandPalette.test.tsx` scrapes `App.tsx` and fails if a palette row's key and its route's
  gate disagree.
  **The hook still falls back to the legacy `profiles.role` column** whenever the roles tables are
  absent, the read fails, or `role_id` is null — the same coalesce `has_perm()` itself does — and
  it publishes that fallback **synchronously**, so there is no window in which a signed-in admin
  is treated as a member. With `0025` applied that fallback is no longer the everyday path; it is
  the failure path, and it is the reason a bad `role_permissions` read degrades to
  "admin sees everything, member sees nothing" instead of to a locked-out workspace.
  ✅ **THE DIRECTOR ROLE IS LIVE.** The warning that used to sit here — *do not put anybody in the
  Director role* — is retired in both halves: the client stopped needing it at Wave B, the
  database stopped needing it on 12 August. `scripts/provision-people.mjs` probes for
  `profiles.role_id` and degrades honestly rather than assuming
  (`scripts/provision-people.mjs:99-111`); with `0025` applied it now writes the Director role
  **directly**, in one pass, instead of creating the seven as members and printing them under
  STILL TO DO. A Director gains the six configuration screens on their next sign-in — or
  immediately, since `refreshProfile()` re-reads the keys.
* **It seeds no people.** Roles exist; who holds which is a separate step, and every profile was
  backfilled onto Admin or Member from the legacy column on apply, so nobody's access changed.
* **`admin-members/index.ts` still gates on `profiles.role = 'admin'`**, in TypeScript. A custom
  role carrying `members.manage` can therefore edit roles but still cannot create or delete a
  member. That is a deliberate floor — provisioning is the one power that reaches `auth.users` —
  but the Members screen has to say it.
* **`profiles.role` is NOT dropped.** Dropping the old column in the same migration that adds its
  replacement is how a rollback becomes impossible. It goes when (a) no policy reads it,
  (b) the edge function gates on `has_perm`, and (c) `src/types.ts`'s `UserRole` and
  `src/lib/permissions.ts` no longer branch on it.

### What 0025's five probes asserted on the way in

These blocks ran with the apply. A `FAILED` notice means a migration refused and nothing changed,
so a successful apply is itself the proof that every **unskippable** probe passed — probes 1, 2, 3
and 5 half A. The two that *can* skip are `probe 4` and `probe 5 half B`; they skip with a notice
when the applying role cannot `set role authenticated`, and whether they ran on 12 August is in
the notices the owner read, not in this file. They are kept in full because re-applying `0025` —
the one repair above — replays all five, and because half of them assert that something did **not**
change, which is a question that keeps being asked long after the apply.

* **probe 1** — the seed landed, Director DOES carry `structure.edit` + `vocab.edit` +
  `capture.write` and does NOT carry `members.manage`, Admin carries all five, no profile has a
  null `role_id`, the key catalogue CHECK exists, and `is_admin()` really is the alias.
* **probe 2** — **the whole migration's safety net.** It impersonates every profile that was an
  admin before the migration and asserts `is_admin()` still answers TRUE, plus a negative
  control. If this one had failed, every admin policy in the app would have *silently closed*: no
  error, no failed statement, just an admin whose writes affect zero rows and whose screens report
  success. It needs no `set role authenticated` — `auth.uid()` reads the claims GUC — so unlike an
  RLS probe it **cannot be skipped**. **The amendment added a second question to the same loop**:
  each admin must also hold `structure.edit` and `vocab.edit`, because those keys — not
  `is_admin()` — are now what reaches `tracks` and `use_cases`. Without it, a seed that landed
  `workspace.admin` and missed the other two would have left probe 2 green and Settings › Structure
  closed to the owner of the workspace.
* **probe 3** — the guards, each exercised until it refuses: a new profile lands on Member
  unasked; the legacy column and `role_id` stay in step in both directions; a member cannot
  escalate themselves, move anyone else, or write their own `position`; a `members.manage` holder
  can do all three; a no-op write emits no audit row and a real revocation does; revoking the last
  `workspace.admin`, deleting a system role and deleting a held role are all refused.
* **probe 4** — member read, `members.manage` write, over RLS. Skips (with a notice) if the
  applying role cannot `set role authenticated`, 0018's pattern.
* **probe 5** — **the Director role does what its name says, and nothing more.** Two halves:
  * **half A reads `pg_policies` and `pg_get_functiondef`, and cannot be skipped.** Three
    lists: (i) all 21 configuration write policies name their key; (ii) all 8 restated admin
    RPCs guard on the same key their table's policy does **and no longer mention `is_admin`**;
    (iii) the 9 policies on `profiles` / `roles` / `role_permissions` still name `is_admin` or
    `members.manage` and mention **neither** Director key. That third list is an assertion that
    something did **not** change — the failure it catches is somebody later "tidying up"
    `role_permissions` to match the rest, which turns Director into Admin with no error and no
    symptom. List (ii) catches the other re-run: an owning file replayed over the top of `0025`,
    leaving RLS willing and the RPC refusing.
  * **half B** creates a real Director fixture over RLS and requires that it **can** insert a
    `map_nodes` row, **reorder** it through `reorder_map_nodes()`, and update a `use_cases` row
    — **all three refused before the amendment**, which is what makes them assertions rather
    than decoration — and **cannot** create a profile, delete a colleague, re-role anyone, walk
    its own row up to Admin, or write `role_permissions`. Fixtures and all, rolled back through
    the `OT025` sentinel. Skips half B (with a notice, half A having passed) if
    `set role authenticated` is not grantable.

The last-admin guard refuses the **transition** from at least one admin to none, not the *state*
of zero — a `before` count stashed by a BEFORE STATEMENT trigger, compared by an AFTER STATEMENT
one. The absolute version was written first and probe 3 refuted it on paper: on a workspace with
no members yet the probe's own fixtures take the count 0 → 0 and an absolute guard would fail the
migration — and so would the first real member anybody provisions. An absent stash is read as
"somebody had access", never as "carry on", so the guard cannot fail open.

### What 0023 and 0024 asserted, and what they now decide every day

⚠ **`0024` decides an entry's `track_id` for it.** `entries_map_sync` is `SECURITY DEFINER` with
a `found` guard, so a client that sends a `node_id` and a contradicting `track_id` has the
`track_id` overwritten rather than being trusted — that is the whole point. **This is no longer
theoretical**: `src/api/entries.ts:409` writes `node_id` on insert and `:450` on patch, and
`QuickAdd.tsx:209` carries `mapNodeId` from the map, so the trigger fires on every entry filed
against a node. An entry whose `track_id` looks "wrong" beside what the client sent is the trigger
working, not a bug.

`0023`'s four probes:

* **probe 1** — the seed landed, `map_node_kinds` has no colour column, the sibling index is
  `NULLS NOT DISTINCT`, and the tree trigger is `DEFERRABLE INITIALLY DEFERRED`.
* **probe 2** — six levels are legal, a 7th is refused, a cycle is refused, a cross-track parent
  is refused **at a forced commit point**, `org1`/`ORG1` collide, and a node with a child cannot
  be deleted. This one leans on `set constraints all immediate` to drain the deferred queue
  inside a `DO` block; **if it errors rather than passing or failing cleanly, that mechanism is
  the first suspect**, not the rules it tests.
* **probe 3** — member read, admin write, and a child inserted with **no `track_id`** comes back
  on its parent's track. That last assertion is the whole design in one line.
* **probe 4** — the reorder scope predicate matches only ids whose parent matches. Labelled in
  the file as the weak version: it exercises the predicate, not the RPC, because the applying
  role has no JWT and cannot pass `is_admin()`.

`0023` also ships probe 1's **RPC signature check** for a failure no type gate can see: PostgREST
resolves a function by the *names* of the arguments in the JSON body, so a client calling
`move_map_node({p_id, p_parent_id, p_track_id})` against a function declared
`(p_id, p_parent, p_track)` gets a 404 the first time an admin drags a node — months after both
halves were reviewed and found correct on their own. The migration is the authority on the
three signatures; probe 1 fails if any of them is absent or spelled differently.

`map_nodes.vendor` was added at integration, not by the unit that wrote 0023. Three separate
units reported its absence as an open hole in a named requirement — *"Each Org has a vendor doing
the integration, and he must be able to filter by vendor"* — and 0023 had not yet run, so adding
the column to an unapplied file was strictly cheaper than a `0025` against live rows. It is
`text not null default ''` (`0023:335`), free text and not a foreign key, because a vendor is a
company outside the workspace with no profile to point at. **It is read now**: `entryFilter.ts:367`
matches on it and `FilterBar` offers the picker, so the demo import's four vendors across fourteen
organizations are what that control lists today.

**Two things still to check by hand, because no probe can see them.** Nothing in
`docs/EVIDENCE/` records either one, so treat both as open — and do them against a demo track,
since `delete_track` now has real rows to destroy:

1. `delete_track(id, other)` on a track that has map nodes — the reassign must move the nodes
   too, and the returned jsonb must carry a `"nodes"` key (`0023:1136`).
2. Deleting a track that has map nodes with **no** reassignment target must raise
   `track_in_use:` and name the node count.

## Pending — 0030, and nothing else

> The step-by-step apply that carried 0026, 0027 and 0028 lives in
> [`RUN-0026-0027-0028.md`](RUN-0026-0027-0028.md), and 0031's in [`RUN-0031.md`](RUN-0031.md).
> Both are history now; this section stays the register of what has **not** been run.

`0030_map_view_settings.sql` is written, reviewed, probed on paper, and **has never been run
against any database**. There is no client half waiting on it — the map reads its drawing settings
from code today — so it blocks nothing, which is precisely why it has sat here while six later
files went past it. It stays on this page rather than being quietly forgotten.



The "verify live by" column is filled per the rule at the bottom of this page: **the row lands in
the same commit as the SQL, with a query that runs today and goes false if the file is ever
reverted.** Move a row out of this table and into the applied table in the same sitting it is
applied in — the other half of that rule, and the half that once cost this file three days.

| # | File | Written by | What it contains | Owner runs it | Verify live by (runnable the moment it is applied) |
|---|---|---|---|---|---|
| 0030 | `map_view_settings.sql` | wave ? | How the map draws, **ONE ROW**: `layout`/`open_depth`/card size/gaps/`sibling_wrap`/`grouping`/`sibling_sort`/`colour_by` (`track` only)/`node_fields` jsonb/`label_budget`. Checked singleton key ending `…0030`; member-read, `structure.edit`-write, touch + `config_audit`; **NO seed row**. Depends only on 0001/0002/0025 — never on 0026-0029 | any time — no client half exists yet | `map_view_settings` present; `pg_get_expr` of `layout`'s default contains `'worlds'`; `map_view_settings_singleton_chk` exists; `map_view_settings_select`'s `qual` contains `is_member` **and** `map_view_settings_update`'s contains `structure.edit`; `select count(*) from map_view_settings` is 0 |

**0028 is the one file on this page whose client half is safe to ship before it is applied**, and
that is a property of the design rather than a licence to be casual: `loadJiraSettings()` fails
with `common.errMissingTable` on a project without the table, `src/store/config.ts` keeps
`jiraSettings` null on any failed read, and `useJiraEnabled()` therefore answers **false**. The
off-switch fails CLOSED through the failure path as well as the happy one, so the visible effect
of "0028 not applied" is exactly the visible effect of "Jira not turned on": nothing. The Settings
card names that state rather than reporting an error.

**The binding constraint on all three, and it is a seam with this page:** `0026`, `0027` and `0028`
**redefine nothing** that `0023`, `0024` or `0025` owns — no policy on the seven configuration
tables, none of the eleven functions, not `is_admin()`. Their tables are new, so their policies
are new. If any of the three ever re-points something `0025` owns, `w_0025` and probe 5 stop being
canaries for "somebody re-ran an old file" and start being ambiguous, which costs more than the
tidiness it would buy. All three are re-runnable, all three get applied twice, and all three carry
probe blocks whose failure keys ship in `pgError.ts` in the same commit — `0028`'s are constraint
NAMES rather than raised tokens (`jira_settings_singleton_chk`, `jira_settings_site_base_url_chk`,
`jira_settings_field_len_chk`, `jira_settings_jql_len_chk`, `jira_settings_status_map_chk`), and
the file's header carries the same list so the two halves are edited together.

## How to run one (0026, 0027 and 0028)

1. Supabase dashboard → `opstrack` project → **SQL Editor**.
2. Open `supabase/migrations/<file>`, copy all, paste, **Run**. In numeric order.
3. All three are re-runnable — running one twice is safe and is how they are tested.
   **This does not extend backwards to `0023`, `0024` or `0025`**: see the ⛔ block above, where
   `0023` and `0024` are never re-run and `0025` is re-applied only as a repair and only last.
4. Read the `NOTICE` lines. They are the migration's own self-checks; a `FAILED` notice means it
   refused to apply and nothing changed.

## How to confirm what is live

`RUNBOOK.md` §5 has a verification query, but it **stops at 0013** — treat a clean run of it as
necessary, not sufficient, until it is extended. Prefer checking the specific object a migration
creates, as the tables above do. One statement covering everything from `0018` on, and every
column of it is answerable today:

```sql
select
  (select count(*) from public.track_groups)                                              as g_0018,
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='tracks'  and column_name='group_id')     as c_0018,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='nudge_entry')                                as f_0019,
  (select count(*) from information_schema.tables
     where table_schema='public' and table_name='ai_usage')                               as t_0020,
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='notification_prefs'
       and column_name='ai_enabled')                                                      as c_0021,
  (pg_get_functiondef('public.entries_guard_insert()'::regprocedure)
     like '%nudged_by        := null%')                                                   as f_0022,
  (select pg_get_constraintdef(oid) from pg_constraint
     where conname='claim_counters_scope_ck')                                             as scopes,
  (select count(*) from public.map_node_kinds)                                            as k_0023,
  (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid
     where c.relname='map_nodes' and t.tgname='map_nodes_tree_ck_trg'
       and t.tgdeferrable and t.tginitdeferred)                                           as d_0023,
  (select pg_get_indexdef(i.indexrelid) ilike '%nulls not distinct%'
     from pg_index i join pg_class c on c.oid=i.indexrelid
    where c.relname='map_nodes_sibling_name_uidx')                                        as n_0023,
  (select count(*) from public.use_cases)                                                 as u_0024,
  (select count(*) from information_schema.tables
     where table_schema='public' and table_name='map_node_use_cases')                     as t_0024,
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='entries' and column_name='node_id')      as c_0024,
  (select count(*) from pg_trigger
     where tgrelid='public.entries'::regclass and tgname='entries_map_sync')              as g_0024,
  (select count(*) from public.roles)                                                     as r_0025,
  (select count(*) from public.role_permissions where granted)                            as p_0025,
  (select count(*) from public.profiles where role_id is null)                            as n_0025,
  (pg_get_functiondef('public.is_admin()'::regprocedure) like '%has_perm%')                as f_0025,
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='profiles' and column_name='position')    as c_0025,
  -- the amendment, both directions. The first must be true and the second false;
  -- `w_0025 = false` means the Director role grants nothing, and `x_0025 = true`
  -- means a Director can grant themselves workspace.admin.
  (select count(*) from pg_policies
     where schemaname='public' and tablename='map_nodes' and policyname='map_nodes_insert'
       and coalesce(with_check,'') like '%structure.edit%')                               as w_0025,
  (select count(*) from pg_policies
     where schemaname='public' and tablename='role_permissions'
       and policyname='role_permissions_update'
       and (coalesce(qual,'')||coalesce(with_check,'')) like '%structure.edit%')          as x_0025;
```

A healthy live project returns `2, 1, 1, 1, 1, true`, `scopes` listing all four of `username`,
`ip`, `ai_user`, `ai_ip`, then `3, 1, true`, then `10, 1, 1, 1`, then `3, 9, 0, true, 1, 1, 0`.
Every one of those is a seeded or structural count, so none of them moves as the workspace fills
up — the demo import's 22 nodes and 67 links change no column of this query, which is the point of
counting catalogue rows rather than data rows.

A narrowed `scopes` means someone re-ran a pre-fix `0010`; re-apply `0022`. `d_0023 = 0` means the
tree check is installed but **not deferred**, which does not fail any probe in this file's own
terms and does break the first cross-track subtree move somebody tries. `n_0023 = false` means two
roots named "OB" under one track are both legal. `g_0024 = 0` with `c_0024 = 1` is the dangerous
half-state: the column exists and nothing derives `track_id` from it, so the two filing axes the
design forbids become representable again — and entries are being filed with `node_id` today, so
that state now produces wrong rows rather than merely permitting them.

`f_0025 = false` is the one to act on immediately: `is_admin()` no longer calls `has_perm`, so
0001 or 0002 was re-run after 0025 and every custom role has quietly stopped being honoured —
re-apply 0025. `n_0025 > 0` means somebody has a profile with no `role_id`; they are not locked
out (`has_perm()` falls back to the legacy `role` text) but `profiles_role_sync()` is not firing
and the legacy column cannot be dropped until it is. `r_0025`/`p_0025` above 3/9 is normal and
expected — those are Aziz's own roles.

`w_0025 = 0` means **0023 was re-run after 0025** and took `map_nodes_insert` back to
`is_admin()`: the Director role silently grants nothing on the tree, exactly the defect the
amendment exists to fix, and the same reversion hazard the `is_admin()` note above describes.
**And this is why nothing ever re-runs 0023.** Re-apply 0025. The same reversion is possible from
0001/0009 (`tracks`, `vocab_options`), 0017 (`label_overrides`), 0018 (`track_groups`) and 0024
(`use_cases`) — `w_0025` is the cheapest single probe for the whole class, and 0025's PROBE 5
half A checks all 21 by name.

`x_0025 = 1` is the **escalation breach** and is the most serious result this query can return:
`role_permissions` is writable by a Director key, so anyone holding Director can open the roles
screen and grant themselves `workspace.admin`. Nothing in this repo writes that policy; if it
appears, somebody edited it by hand or a later migration did. Fix it before anything else.

## The applied record, 0014 onward

`0014`–`0022` are applied to the live project (`lrysgpbkmuqgzsjesfkr`), each twice, and
`0026`–`0029` and `0031`–`0035` are applied to the same project — all verified by querying the
catalog, or by asking PostgREST for the object, rather than by trusting the apply:

| # | File | Verified live by |
|---|---|---|
| 0014 | `recurring_template_authorship.sql` | `materialize_template` present |
| 0015 | `entry_write_guard_and_line_authorship.sql` | `entries_guard_update` BEFORE UPDATE trigger on `entries` |
| 0016 | `name_pin_close_date_and_handover_clock.sql` | `guard_profile_role` present |
| 0017 | `label_overrides.sql` | `label_overrides_norm(text)` + `reset_label_overrides(text)` present |
| 0018 | `track_groups.sql` | 2 rows in `track_groups`, `tracks.group_id` column present |
| 0019 | `nudges.sql` | `nudge_entry(uuid)` present; `notifications_kind_check` allows `'nudged'` |
| 0020 | `ai_usage.sql` | `ai_usage` table + `ai_usage_day()` / `ai_usage_today()` / `ai_usage_record()` present |
| 0021 | `ai_prefs.sql` | `notification_prefs.ai_enabled` column present |
| 0022 | `nudge_stamps_on_insert.sql` | `entries_guard_insert()` body contains the two nudge pins; `claim_counters_scope_ck` lists all four scopes |
| 0026 | `map_node_stages.sql` | 7 rows in `map_node_stages`, exactly 1 `terminal`; `map_node_progress` present |
| 0027 | `map_node_goals_and_counts.sql` | `map_node_goals` present; `v_map_node_open_counts`'s `reloptions` contains `security_invoker=true` |
| 0028 | `jira_settings.sql` | `jira_settings` present; `jira_settings_singleton_chk` exists; 0 rows until somebody saves on the Jira screen |
| 0029 | `org_identity.sql` | `map_nodes.org_id` column present; `map_node_branches` table present |
| 0031 | `pmo_portfolio.sql` | `pmo_projects`, `pmo_initiatives`, `pmo_actions`, `pmo_risks`, `pmo_revenue`, `pmo_objectives`, `pmo_key_results`, `pmo_milestones` present; `v_pmo_objective_progress` present |
| 0032 | `use_case_rungs.sql` | `map_node_use_cases.rung` + `.scope` columns present; `map_node_use_case_events` table present; `map_node_use_cases_stamp()` body contains `status_changed_at := now()` |
| 0033 | `org_readiness.sql` | `map_node_readiness` table present |
| 0034 | `his_catalogue.sql` | `his_products` seeded (Careware, Vida Plus, InterSystems, TrakCare, MedicaCloud …); `map_nodes.his_id` column present |
| 0035 | `overrides_are_server_owned.sql` | `map_node_use_cases_stamp()` body contains `array_agg(distinct field)` **and still contains** `status_changed_at := now()` and `map_node_use_case_events` — the two things 0032 owns that a `create or replace` would silently drop |
| 0036 | `use_case_rungs_apply.sql` | `use_case_rungs` present, 75 rows = 15 capabilities × 5; deleting an `intake` row raises `use_case_rung_required`; deleting a rung with pairs on it raises `use_case_rung_in_use` naming the count; `map_node_use_cases_stamp()` still contains `array_agg(distinct field)` and `map_node_use_case_events` |

**`0010` was edited after it had already been applied**, which normally must not happen and is
justified in the file itself and in `docs/W-AI-HANDOFF.md` §(a). Short version: this project has
no migration ledger — `supabase_migrations.schema_migrations` does not exist on the live database
— so there is no checksum to invalidate; `0010` is re-runnable by design and the edit changes only
what a **re-run** does; and the failure it prevents (a re-run silently narrowing
`claim_counters_scope_ck` and disarming the AI burst limiter with no signal) was reproduced live.
The edited `0010` was applied twice and is a no-op against the current constraint.

### 0022 exists because 0019's own probe could not see the defect

`0019` pinned `nudged_at`/`nudged_by` on UPDATE and proved it with three probes. Nothing pinned
them on **INSERT** — `entries_guard_insert()` is `0015`'s function and predates the columns — so a
member could POST an entry pre-stamped `nudged_at = '2099-01-01'` (permanently unchaseable: the
24-hour rate limit refuses every future ask) with `nudged_by` naming a colleague who never asked.
Reproduced live in a rolled-back subtransaction before the fix was written, with `created_at`
coming back correctly pinned as the control that proves the trigger *did* run.

`0022`'s PROBE 1 was then confirmed load-bearing the only way that means anything: the old
`entries_guard_insert()` was restored on the live database, the probe was run against it, and it
refused with the intended message. `PROBE 3` was confirmed the same way by narrowing
`claim_counters_scope_ck` by hand.

### 0017 refused itself first, and was right to

Its own probe block raised `btrim stored NULL — expected the ends trimmed and the interior
spacing intact`. The cause: `v_trim` was **declared and asserted on, but never assigned**, so it
was always NULL and the assertion was unconditionally true. The migration could not apply, ever.

Reading the file did not reveal it — the declaration, the header's fixture comment and the
assertion all read like a complete probe; only the missing `insert`/`select` between them was
absent. **Running it against a real database is what found it**, which is the whole argument for
applying twice and reading the notices rather than trusting a green file.

The missing probe was written (insert `'  Assigned  to  '`, read it back), and the fixture keeps
its doubled interior space deliberately: a normaliser that collapsed interior whitespace would
pass a single-space fixture and silently rewrite what the owner typed.

## Probes must be able to fail

`0019`'s PROBE 1 asserted that a `push_outbox` row **existed** and never what it **said**, and a
`nudged` notification rendered as *"X assigned you …"* in production for hours as a result. A probe
that cannot fail is worse than no probe, exactly as this file's opening paragraph says about the
RUNBOOK query. When a migration's effect is only visible outside SQL — in an edge function, in the
client — the assertion belongs there too: `supabase/functions/send-push/index.test.ts` is where
that particular sentence is now pinned.

## The rules this file encodes

A migration is not "done" when it is written and tested. It is done when it has **run against the
live project**. Anything between those two states belongs in the pending table, and that table
belongs in the same commit as the migration.

**And it comes back out of the pending table in the same sitting it is applied in.** That half was
implicit and cost this file three days of saying "run these" about three migrations that were
already live. A pending list is read as a set of instructions by the one person who follows it
alone; leaving an applied file in it is not a stale note, it is an instruction to do damage.
