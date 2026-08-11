# Migrations written but NOT applied

**This file is the answer to "what still has to be run?" — check it before every deploy.**

It exists because the critic caught the failure it prevents: `README`, `ADMIN.md` and
`RUNBOOK.md` all stopped at `0013`, and the RUNBOOK's own verification query checked twelve
things ending at `0013` and reported **"all twelve yes"** — while four migrations sat unapplied.
A verification that cannot fail is worse than none.

## Status — 11 August 2026

**`0023_map_nodes.sql`, `0024_map_use_cases.sql` and `0025_roles_permissions.sql` are PENDING.
None has ever been run against any database.** They must be applied **in order** — `0024`
references `map_nodes` and carries a preflight block that refuses to apply without it; `0023` in
turn probes `information_schema` for `entries.node_id` so it applies standalone and starts
counting entries the moment `0024` lands, with no re-apply. `0025` goes last because it
**redefines `is_admin()`**, which every policy in `0023` and `0024` calls, and — since the
amendment below — because it **re-points policies on `map_nodes`, `map_node_kinds` and
`use_cases`**, which those two files create. That dependency is now enforced by a preflight
block at the top of `0025` rather than merely recommended here.

### ⚠ 0025 CHANGED ON 11 AUGUST 2026, BEFORE ITS FIRST APPLY

`0025` was **amended in place, not superseded by an 0026**, because it has never been run
against any database. There is no applied state to migrate from, no checksum to invalidate (this
project has no `supabase_migrations.schema_migrations` table — see the `0010` note below), and
amending an unapplied file is free where amending an applied one costs a new file forever.
**If you copied `0025` out of the repo before this date, discard that copy and take the file
again.**

What changed, and why it had to:

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
* **`0025` gained a preflight** and now refuses to apply before `0023`/`0024` with a sentence
  instead of a bare `42P01` from the middle of the file.
* **The eight admin RPCs are restated too** — `reorder_tracks`, `delete_track`,
  `reorder_map_node_kinds`, `reorder_map_nodes`, `move_map_node` on `structure.edit`;
  `reorder_vocab`, `reset_vocab`, `reset_label_overrides` on `vocab.edit`. Re-pointing the
  policies alone left a Director who could create, rename and delete a map node and could not
  **drag** one: RLS willing, the RPC refusing with `42501`. Added at the Wave-B gate, after the
  policy half; see "What 0025 does NOT do" below for why they live in `0025` and not in the four
  files that own them.
* **PROBE 5 is new**, and `PROBE 2` gained two assertions. See the probe list below.

| # | File | What it does | Verify live by |
|---|---|---|---|
| 0023 | `map_nodes.sql` | The hierarchy below tracks: `map_nodes`, `map_node_kinds`, the deferred tree check, `reorder_map_nodes` / `move_map_node`, and a redefinition of two 0002 objects | `map_nodes` + `map_node_kinds` tables present; 3 rows in `map_node_kinds`; `map_nodes.vendor` column present; `map_nodes_tree_ck_trg` is `tgdeferrable`; `map_nodes_sibling_name_uidx` definition contains `NULLS NOT DISTINCT` |
| 0024 | `map_use_cases.sql` | The capability catalogue and the entry's finer grain: `use_cases`, `map_node_use_cases`, `entries.node_id`, and the `entries_map_sync` trigger that DERIVES `track_id` from the node | 10 rows in `use_cases`; `map_node_use_cases` table present; `entries.node_id` column present; `entries_map_sync` BEFORE INSERT OR UPDATE trigger on `entries` |
| 0025 | `roles_permissions.sql` | Custom roles: `roles`, `role_permissions`, `profiles.role_id`, `profiles.position`; the redefinition of `is_admin()` into `has_perm('workspace.admin')` that makes permissions data without editing 183 policies; **and (amended) the 21 write policies on the seven configuration tables re-pointed at `structure.edit` / `vocab.edit`** | 3 rows in `roles`; 9 rows in `role_permissions`; 0 profiles with a null `role_id`; `pg_get_functiondef('public.is_admin()')` contains `has_perm`; `role_permissions_key_ck` lists all five keys; **`map_nodes_insert`'s `with_check` in `pg_policies` contains `structure.edit`, and `role_permissions_update`'s does NOT** |

### ⚠ 0025 redefines three functions — and now 21 policies — this repo owns elsewhere

`is_admin()` and `guard_profile_role()` are **0001**'s (the guard last rewritten by **0016**), and
`log_config_audit()` is **0002**'s. All three are restated in full inside `0025`, so
**re-running 0001, 0002 or 0016 after 0025 silently reverts part of it** and the fix is to
re-apply `0025`. `0025`'s own PROBE 1 detects exactly this and names it: it reads
`pg_get_functiondef('public.is_admin()')` and fails if the body no longer calls `has_perm`.

**The amendment widened that list to policies, and then to eight more functions.** `0025` now
owns the INSERT/UPDATE/DELETE policies on `tracks` and `vocab_options` (**0001**/**0009**),
`label_overrides` (**0017**), `track_groups` (**0018**), `map_nodes` and `map_node_kinds`
(**0023**) and `use_cases` (**0024**) — 21 in all — **plus `reorder_tracks` (0002),
`reorder_vocab` + `reset_vocab` (0003), `reset_label_overrides` (0017) and `delete_track` +
`reorder_map_node_kinds` + `reorder_map_nodes` + `move_map_node` (0023)**. Eleven functions and
21 policies. Re-running one of the *function* files leaves a LOUD failure rather than a silent
one — RLS accepts the write and the RPC refuses it with a clean `42501` — but it is still the
role failing to do what its name says, and **probe 5 half A(iii) reads `pg_get_functiondef` and
names all eight**. Re-running any of those six files after `0025` restores the `is_admin()`
version of its policies and **the Director role silently grants nothing on that table**. There is
no error and no visible symptom: a Director's writes simply affect zero rows. `0025`'s PROBE 5
half A checks all 21 by name against `pg_policies` and cannot be skipped, and `w_0025` in the
verification query below is the one-column version. **Fix by re-applying `0025` — always last.**

The damage from that reversion is bounded ON PURPOSE. `profiles.role` is **kept and kept
derived** — `role = 'admin'` ⟺ `role_id` is the system Admin role — so a restored 0001
`is_admin()` reading the text column still answers correctly for every holder of a system role.
The workspace does not lock itself out; it stops honouring custom roles until 0025 is re-applied.

`log_config_audit()`'s guard is **widened** from `is_admin()` to "holds any configuration
permission". Without that, the first custom role carrying `members.manage` without
`workspace.admin` would pass the RLS policy on `roles`, reach the audit trigger, and be refused
by the audit writer — a 42501 on a legitimate edit, blamed on the wrong thing.

### What 0025 does NOT do, and must be said before Aziz sees a permissions screen

* **One of the five permission keys is still DECLARED, NOT YET ENFORCED — `capture.write`.**
  Nothing reads it: `entries` is gated on `is_member()`, which is what it should be, because
  filing work *is* what membership is. It is seeded so that the day a read-only role is wanted it
  is a policy change and not a schema change. **A roles screen must render that one switch as
  not-yet-live.** The other four — `workspace.admin`, `structure.edit`, `vocab.edit`,
  `members.manage` — are all read by policies today and may be rendered as live.
* ~~**A Director can shape the map but cannot DRAG it.**~~ **CLOSED at the Wave-B gate.** The
  eight admin RPCs are now restated **inside `0025`**, each with its guard swapped to the key its
  table's policy checks: `reorder_tracks`, `delete_track`, `reorder_map_node_kinds`,
  `reorder_map_nodes` and `move_map_node` on `structure.edit`; `reorder_vocab`, `reset_vocab` and
  `reset_label_overrides` on `vocab.edit`. Every body is the owning file's own text copied byte
  for byte with one line changed, and the message reworded to name the key — `pgError.ts` maps
  `42501` by SQLSTATE, not by text, so no screen sees the rewording.
  **Why restated in `0025` rather than edited in place in the four owning files**, even though
  `0023` is unapplied and free to edit: `has_perm()` does not exist until `0025` runs, and
  `0025`'s own preflight requires `0023` first. A `0023` that called `has_perm()` could not work
  on the database it is applied to for the length of the sitting. One file owns the re-pointing
  and it is the one that goes last.
  **The cost**: re-running `0002`, `0003`, `0017` or `0023` after `0025` restores an `is_admin()`
  guard that now *contradicts* the policy beside it — RLS accepts the Director's drag and the RPC
  refuses it. **Probe 5 half A(iii) reads `pg_get_functiondef` and fails on exactly this**, for
  all eight by name. `0023`'s own probe assertion was reworded to *"accepted a NON-ADMIN"* in the
  same pass, since the fixture is a plain member either way.
* ⚠ **THE ONE THING STILL MISSING, AND IT IS THE BLOCKER: THE CLIENT NEVER OFFERS ANY OF THIS.**
  Every configuration screen guards on a local `useIsAdmin()` — nine byte-identical copies of
  `profile?.role === 'admin'` — and `0025` keeps `profiles.role` derived from the **system role
  only**. A Director's legacy text is `'member'`, so **a Director signing in today is redirected
  to `/settings` from every screen the database now lets them write.** The database half is
  complete, probe-backed and **invisible**.
  The sites: `StructureAdmin.tsx:921`, `TracksAdmin.tsx:63`, `TrackEditor.tsx:193`,
  `GroupsAdmin.tsx:176`, `CatalogueAdmin.tsx:169`, `VocabularyAdmin.tsx:312`,
  `Terminology.tsx:315`, plus `RolesAdmin.tsx:154` and `Members.tsx:257` (**those two keep
  `canAdmin` — they are `members.manage`, and only Admin holds it**), plus the route ternaries in
  `src/App.tsx:527`, the sections in `src/pages/Settings.tsx:164` and `ADMIN_SCREENS` in
  `src/components/CommandPalette.tsx:464`.
  The shape of the fix: a permission-aware hook reading `role_permissions` for the signed-in
  profile — the two tables are member-readable **by design, precisely so the client can mirror
  the policy** — seeded from the legacy role so a project without `0025` behaves exactly as it
  does today, and **tri-state**, because a hook that answers `false` while the read is in flight
  redirects the Director away before the answer arrives. Then `isAdmin` becomes
  `canEditStructure` / `canEditVocab` at the sites above.
  ⚠ **DO NOT PUT ANYBODY IN THE DIRECTOR ROLE UNTIL THAT LANDS.** `scripts/provision-people.mjs`
  will happily do it (`roleIntent: 'director'`, seven people). Today it would take seven people
  who are currently admins and leave them with **no configuration screens at all** — the database
  would accept their writes and the app would offer them nowhere to make one. Provision the
  roster with `0025` unapplied (everyone lands Admin/Member from the legacy column, which is
  today's behaviour), or apply `0025` and assign the Directors **after** the client gate ships.
* **It seeds no people.** Roles exist; who holds which is a separate step, and every profile is
  backfilled onto Admin or Member from the legacy column so nobody's access changes on apply.
* **`admin-members/index.ts` still gates on `profiles.role = 'admin'`**, in TypeScript. A custom
  role carrying `members.manage` can therefore edit roles but still cannot create or delete a
  member. That is a deliberate floor — provisioning is the one power that reaches `auth.users` —
  but the Members screen has to say it.
* **`profiles.role` is NOT dropped.** Dropping the old column in the same migration that adds its
  replacement is how a rollback becomes impossible. It goes when (a) no policy reads it,
  (b) the edge function gates on `has_perm`, and (c) `src/types.ts`'s `UserRole` and
  `src/lib/permissions.ts` no longer branch on it.

**Read 0025's FIVE probe blocks' notices.** Written without a Postgres to run against, like
0023/0024 — nothing in the file has executed:

* **probe 1** — the seed landed, Director DOES carry `structure.edit` + `vocab.edit` +
  `capture.write` and does NOT carry `members.manage`, Admin carries all five, no profile has a
  null `role_id`, the key catalogue CHECK exists, and `is_admin()` really is the alias.
* **probe 2** — **the whole migration's safety net.** It impersonates every profile that was an
  admin before the migration and asserts `is_admin()` still answers TRUE, plus a negative
  control. If this one fails, every admin policy in the app has *silently closed*: no error, no
  failed statement, just an admin whose writes affect zero rows and whose screens report success.
  It needs no `set role authenticated` — `auth.uid()` reads the claims GUC — so unlike an RLS
  probe it **cannot be skipped**. **The amendment added a second question to the same loop**:
  each admin must also hold `structure.edit` and `vocab.edit`, because those keys — not
  `is_admin()` — are now what reaches `tracks` and `use_cases`. Without it, a seed that landed
  `workspace.admin` and missed the other two would leave probe 2 green and Settings › Structure
  closed to the owner of the workspace.
* **probe 3** — the guards, each exercised until it refuses: a new profile lands on Member
  unasked; the legacy column and `role_id` stay in step in both directions; a member cannot
  escalate themselves, move anyone else, or write their own `position`; a `members.manage` holder
  can do all three; a no-op write emits no audit row and a real revocation does; revoking the last
  `workspace.admin`, deleting a system role and deleting a held role are all refused.
* **probe 4** — member read, `members.manage` write, over RLS. Skips (with a notice) if the
  applying role cannot `set role authenticated`, 0018's pattern.
* **probe 5 (NEW with the amendment)** — **the Director role does what its name says, and
  nothing more.** Two halves:
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

⚠ **`0024` decides an entry's `track_id` for it.** `entries_map_sync` is `SECURITY DEFINER` with
a `found` guard, so a client that sends a `node_id` and a contradicting `track_id` has the
`track_id` overwritten rather than being trusted — that is the whole point, and it means the
first apply changes what an existing INSERT does. Nothing writes `node_id` yet (the map-node
store is Wave B), so today the trigger is inert on every real row.

**Read all four probe blocks' notices.** They are the only evidence this file works —
it was written without a Postgres to run it against, so nothing in it has executed:

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

`map_nodes.vendor` was added at integration, not by the unit that wrote 0023. Three separate
units reported its absence as an open hole in a named requirement — *"Each Org has a vendor doing
the integration, and he must be able to filter by vendor"* — and 0023 had never run, so adding
the column to an unapplied file was strictly cheaper than a `0025` against live rows. It is
`text not null default ''`, free text and not a foreign key, because a vendor is a company
outside the workspace with no profile to point at. Nothing reads it yet; `FilterState.mapNodeIds`
is Wave B.

Two things to check by hand after applying, because no probe can see them:

1. `delete_track(id, other)` on a track that has map nodes — the reassign must move the nodes
   too, and the returned jsonb must now carry a `"nodes"` key.
2. Deleting a track that has map nodes with **no** reassignment target must raise
   `track_in_use:` and name the node count.

`0023` ships probe 1's **RPC signature check** for a failure no type gate can see: PostgREST
resolves a function by the *names* of the arguments in the JSON body, so a client calling
`move_map_node({p_id, p_parent_id, p_track_id})` against a function declared
`(p_id, p_parent, p_track)` gets a 404 the first time an admin drags a node — months after both
halves were reviewed and found correct on their own. The migration is the authority on the
three signatures; probe 1 fails if any of them is absent or spelled differently.

### 0014–0022 are applied

`0014`–`0022` are applied to the live project (`lrysgpbkmuqgzsjesfkr`),
each twice, and verified by querying the catalog rather than by trusting the apply:

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

## How to run one

1. Supabase dashboard → `opstrack` project → **SQL Editor**.
2. Open `supabase/migrations/<file>`, copy all, paste, **Run**. In numeric order.
3. Every migration here is re-runnable — running one twice is safe and is how they are tested.
4. Read the `NOTICE` lines. They are the migration's own self-checks; a `FAILED` notice means it
   refused to apply and nothing changed.

## How to confirm afterwards

`RUNBOOK.md` §5 has a verification query, but it **stops at 0013** — treat a clean run of it as
necessary, not sufficient, until it is extended. Prefer checking the specific object a migration
creates, as the table above does. One statement covering everything from `0018` on:

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

Expected: `2, 1, 1, 1, 1, true`, `scopes` listing all four of `username`, `ip`, `ai_user`,
`ai_ip`, then `3, 1, true`, then `10, 1, 1, 1`, then `3, 9, 0, true, 1, 1, 0`. A narrowed `scopes` means someone re-ran a
pre-fix `0010`; re-apply `0022`. `d_0023 = 0` means the tree check is installed but **not
deferred**, which does not fail any probe in this file's own terms and does break the first
cross-track subtree move somebody tries. `n_0023 = false` means two roots named "OB" under one
track are both legal. `g_0024 = 0` with `c_0024 = 1` is the dangerous half-state: the column
exists and nothing derives `track_id` from it, so the two filing axes the design forbids become
representable again.

`f_0025 = false` is the one to act on immediately: `is_admin()` no longer calls `has_perm`, so
0001 or 0002 was re-run after 0025 and every custom role has quietly stopped being honoured —
re-apply 0025. `n_0025 > 0` means somebody has a profile with no `role_id`; they are not locked
out (`has_perm()` falls back to the legacy `role` text) but `profiles_role_sync()` is not firing
and the legacy column cannot be dropped until it is. `r_0025`/`p_0025` above 3/9 is normal and
expected — those are Aziz's own roles.

`w_0025 = 0` means **0023 was re-run after 0025** and took `map_nodes_insert` back to
`is_admin()`: the Director role silently grants nothing on the tree, exactly the defect the
amendment exists to fix, and the same reversion hazard the `is_admin()` note above describes.
Re-apply 0025. The same reversion is possible from 0001/0009 (`tracks`, `vocab_options`), 0017
(`label_overrides`), 0018 (`track_groups`) and 0024 (`use_cases`) — `w_0025` is the cheapest
single probe for the whole class, and 0025's PROBE 5 half A checks all 21 by name.

`x_0025 = 1` is the **escalation breach** and is the most serious result this query can return:
`role_permissions` is writable by a Director key, so anyone holding Director can open the roles
screen and grant themselves `workspace.admin`. Nothing in this repo writes that policy; if it
appears, somebody edited it by hand or a later migration did. Fix it before anything else.

### Probes must be able to fail

`0019`'s PROBE 1 asserted that a `push_outbox` row **existed** and never what it **said**, and a
`nudged` notification rendered as *"X assigned you …"* in production for hours as a result. A probe
that cannot fail is worse than no probe, exactly as this file's opening paragraph says about the
RUNBOOK query. When a migration's effect is only visible outside SQL — in an edge function, in the
client — the assertion belongs there too: `supabase/functions/send-push/index.test.ts` is where
that particular sentence is now pinned.

## The rule this file encodes

A migration is not "done" when it is written and tested. It is done when it has **run against the
live project**. Anything between those two states belongs in this table, and this table belongs in
the same commit as the migration.
