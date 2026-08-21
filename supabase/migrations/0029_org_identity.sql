-- 0029 — who this organization IS to NPHIES: its Organization ID, and the
-- facility IDs of the branches underneath it.
--
-- WHAT THIS IS
-- 0023 gave the map an arbitrary-depth tree of organizations, 0024 gave each one
-- a use-case scorecard. Between them they can answer "where does Riyadh General
-- sit, and what is flowing". Neither can answer the question a NPHIES
-- CERTIFICATE OF COMPLETION is made of: "which registered entity is this, and
-- which of its facilities are covered?" A certificate names an Organization ID
-- and lists facility IDs. Today those two facts live in a spreadsheet somebody
-- opens next to the tracker, which is the same sentence that justified building
-- the tracker in the first place.
--
-- This file adds them: `map_nodes.org_id` (one per organization, the NPHIES
-- Organization ID) and `public.map_node_branches` (N per organization, each
-- carrying a facility ID). Nothing else. No sector, no status, no sync state —
-- and each of those omissions is argued below rather than left to be discovered.
--
--
-- ═══ WHY org_id IS A NEW COLUMN AND NOT `external_ref` ═══
--
-- `map_nodes.external_ref` already exists, is nullable, is empty on all 400+
-- imported rows, and is indexed. It looks exactly like the column this feature
-- needs, and putting the Organization ID in it would break four things at once.
--
--   ① IT IS ALREADY SPOKEN FOR. src/lib/jira/map.ts says so twice — "external_ref
--      is what will hold the issue key once a sync exists" (map.ts:43) and
--      `ResolvedIssue.externalRef` is documented as "What external_ref would
--      hold: the issue key" (map.ts:216). The v1 Jira resolver matches issues to
--      nodes BY NAME, and it is allowed to do something that crude precisely
--      because external_ref is empty on every row. Fill it with Org IDs and the
--      first sync either overwrites 400 Organization IDs with issue keys or
--      refuses to write and reports 400 conflicts.
--
--   ② IT POISONS map_nodes_external_idx. That index is `(source, external_ref)
--      where external_ref is not null` (0023:483) and it is the sync's remote-id
--      lookup — the thing it scans once per node per run. Organization IDs stored
--      there put four hundred `source = 'local'` rows into the index the sync
--      reads, which is the exact state the partial predicate exists to keep it
--      out of.
--
--   ③ IT MAKES `source` LIE. `source` is a closed two-value vocabulary,
--      `local | jira`, and 0024:416 duplicates the CHECK on its own table
--      deliberately so the two tables cannot disagree about provenance. A row
--      reading `source = 'local'` with a populated `external_ref` is a row whose
--      provenance columns contradict each other.
--
--   ④ IT MAKES `overrides` AMBIGUOUS. `overrides` is a list of COLUMN NAMES a
--      person edited in-app that the sync must not stomp; map.ts:589 compares its
--      entries against the literal column name. `'external_ref'` appearing there
--      would then mean "a person typed an Organization ID" on one row and "a
--      person pinned an issue key" on another, and no reader — human or code —
--      can tell which.
--
-- So: a NEW column, with its own name, its own CHECK, its own index and its own
-- meaning. Two identities, two columns. The one that costs a migration is the
-- one that stays legible.
--
--
-- ═══ WHAT ADDING A COLUMN TO map_nodes ACTUALLY COSTS, PAID DELIBERATELY ═══
--
-- 0026:169 declined to add a column to `map_nodes` and wrote down the bill:
-- it changes the `to_jsonb` touch diff and the audit diff, it changes the
-- localStorage row shape behind `nphiescore_map_nodes_v1`, and it moves the
-- importer's fixed-column boundary. 0026 could decline because a stage is
-- fieldwork and belonged on a side table. 0029 CANNOT decline, and here is why
-- each line of that bill is the right thing to pay rather than a cost to route
-- around:
--
--   * THE TOUCH AND AUDIT DIFFS. `map_nodes_touch()` and `map_nodes_audit()`
--     (0023:643, 0023:670) both diff `to_jsonb(new) - 'updated_at' -
--     'synced_at'`, so `org_id` joins the diff automatically and correctly:
--     setting an Organization ID moves `updated_at` and writes a `config_audit`
--     row carrying the before and after image. THAT IS WANTED. "Who typed this
--     Org ID, and what was there before" is the first question asked when a
--     certificate comes back rejected. Neither function is redefined here — the
--     new column rides the existing diff for free, which is exactly the argument
--     FOR the column and against a side table. Probe 2 asserts the audit row
--     lands and that its `after` image carries `org_id`, rather than assuming it.
--
--   * THE CLIENT ROW SHAPE. `src/api/map.ts:138` reads `select('*')` and
--     `MapNode` in src/types.ts declares every field REQUIRED, so a new column
--     that is not in the type means the type is lying about the rows PostgREST
--     returns. `org_id?: string | null` lands in src/types.ts in the SAME WAVE as
--     this file — it is listed in the client-wave block below, not left implied.
--
--   * THE IMPORTER. `FIXED_COLUMNS` in scripts/lib/structurePlan.mjs:170 is
--     POSITIONAL and any new column is APPENDED, never inserted, or every
--     spreadsheet already filled in re-reads its cells as the wrong field. An
--     `org_id` column, if it is ever added there, is the ELEVENTH fixed column
--     and goes after `target`. This file does not add it and does not need it.
--
-- A side table (`map_node_identity(node_id primary key, org_id)`) would have
-- dodged the bill and been wrong: an Organization ID is not fieldwork recorded
-- against a node, it IS the node's identity, and splitting it off would mean
-- every read of the map that wants to render an identity does a second round
-- trip, and every audit question about "when did this organization's identity
-- change" reads a different trail from the one that holds its name. 0026's side
-- table exists because of a PERMISSION split (members write progress, the owner
-- writes the shape); there is no permission split here. Org ID is shape.
--
--
-- ═══ WHY THE BRANCHES ARE A TABLE AND NOT A text[] ON map_nodes ═══
--
-- `map_nodes.overrides` is already a `text[]`, so the array shape is not foreign
-- to this schema and the temptation is real: one more column, no new RLS, no new
-- triggers, no new policies. It is wrong for four reasons that all become
-- expensive after the data lands rather than before.
--
--   ① A BRANCH IS NOT ONE STRING. It has a facility ID, a name, and a position in
--      the list the certificate prints. An array of scalars forces either three
--      parallel arrays that can silently fall out of alignment on any write, or a
--      delimiter convention inside each element — which is a schema expressed as
--      a string, enforced by nobody, parsed in two languages.
--
--   ② UNIQUENESS. "A facility ID must not appear twice under one organization" is
--      one unique index on a table. On an array it is a trigger that re-reads and
--      re-validates the whole array on every write, or it is a rule the client
--      remembers — which is the same as saying a duplicate ships the first time
--      two people edit the same organization in the same minute.
--
--   ③ THE REVERSE QUESTION. "Which organization owns facility 10000123?" is the
--      question the certificate generator asks, and it is the question somebody
--      asks when a claim is rejected against a facility nobody recognises. On a
--      table it is one index lookup. On an array it is a sequential scan of every
--      row in `map_nodes` with an unnest in the middle.
--
--   ④ THE AUDIT TRAIL. `map_nodes_audit()` compares whole row images, so an array
--      edit records "the array was [A,B,C] and is now [A,B,D]" — the reader has to
--      diff it themselves. A row per branch means "branch D was inserted" is one
--      `config_audit` row with an action on it.
--
-- The cost of the table is one more table's worth of policies, grants and
-- triggers, all of which this file writes once. The cost of the array is paid by
-- whoever is holding it when a certificate is wrong.
--
--
-- ═══ THE SURROGATE `id` ON map_node_branches, AND THE RULE IT BENDS ═══
--
-- 0024:326 is explicit: a many-per-node relation is keyed by THE PAIR — `primary
-- key (node_id, use_case_id)`, no surrogate — "because the pair IS the identity
-- and a surrogate lets two rows say different things about the same
-- organization". 0026:636 restates it one column narrower for
-- `map_node_progress`. `map_node_branches` has a surrogate `id uuid` anyway, and
-- the reason is not taste:
--
--   `public.config_audit.row_id` IS `uuid` (0002:287).
--
-- This table is CONFIGURATION and is audited (see the next block), and
-- `log_config_audit(text, uuid, text, jsonb, jsonb)` takes a single uuid as the
-- row's identity. A composite `(node_id, facility_id)` key has no uuid to hand
-- it; a trigger would have to invent one, or pass `node_id` — at which point the
-- trail says "something about this organization changed" and every branch edit
-- on a 30-facility hospital is indistinguishable from every other. 0028 made the
-- same call in the other direction, choosing a fixed uuid over the literal text
-- `'jira'` as the singleton's key, for this exact reason.
--
-- 0024's PROPERTY IS KEPT, it is just not the primary key that keeps it: a
-- unique index on `(node_id, lower(btrim(facility_id)))` makes "two rows saying
-- different things about the same facility" unrepresentable, which is the whole
-- content of 0024's argument. What the surrogate buys on top is a stable handle
-- for the audit trail and for a client that renames a facility ID it typed wrong
-- — an edit that, under a natural key, would be a delete plus an insert and would
-- read in the trail as a branch disappearing.
--
--
-- ═══ THIS TABLE IS AUDITED, WHICH MEANS IT CANNOT BE MEMBER-WRITABLE ═══
--
-- 0024:544 and 0026:53 both argue an OMISSION: fieldwork tables get no
-- `config_audit` trigger. This file argues the opposite for `map_node_branches`,
-- and the argument is forced rather than chosen.
--
-- A NPHIES Organization ID and a facility ID are not this week's fieldwork. They
-- are stable identity facts issued by an external authority, typed in once,
-- rarely corrected, and consequential when wrong: a certificate generated
-- against a wrong facility ID is a document sent to a regulator naming the wrong
-- building. That is `config_audit`'s case word for word — rare, consequential,
-- one person, nobody watching (0003:285).
--
-- And once it is audited, the permission split is DECIDED, not chosen:
-- `log_config_audit()` raises 42501 when `auth.uid()` is non-null and the caller
-- holds none of `workspace.admin | structure.edit | vocab.edit | members.manage`
-- (0025:1858). An audit trigger on a member-writable table therefore rolls back
-- every legitimate member write with a permission error blamed on the wrong
-- thing. AUDIT TRIGGER ⟺ structure.edit-WRITE. The two are one decision and this
-- file makes it once:
--
--     map_node_branches   member READ · structure.edit WRITE · AUDITED
--     map_nodes.org_id    member READ · structure.edit WRITE · AUDITED
--                         (0025:752 already put map_nodes' three write policies
--                          on structure.edit; the new column inherits that and
--                          this file re-points nothing)
--
-- The consequence is stated so nobody meets it as a surprise: the three account
-- managers CANNOT type an Organization ID. That is the right answer here and the
-- wrong answer for a stage (0026:13). A stage is a judgement the person on site
-- makes and can correct in one click; an Organization ID is a fact copied off a
-- NPHIES record, and a wrong one propagates into a signed document. If that turns
-- out to be the wrong call in practice, the fix is a role — Aziz grants
-- `structure.edit` to whoever is doing the typing — and NOT a widened policy,
-- because widening `map_nodes_update` to `is_member()` gives members every column
-- including `parent_id` (0026:23).
--
--
-- ═══ SECTOR IS NOT A COLUMN IN THIS FILE, AND THAT IS THE DECISION ═══
--
-- "Private / Government / MOH" was asked about in the same breath as the Org ID,
-- and it is deliberately absent. Three reasons, in the order they bite:
--
--   ① THE COLUMN LIST IS NOT KNOWN YET. The NPHIES Master Status Report has not
--      arrived. Nobody in this repository has seen the vocabulary it uses, how
--      many values it has, or whether "sector" is one field or two (ownership and
--      funding are different questions in Saudi healthcare and the report may
--      well carry both). A column added now is a guess that four hundred rows get
--      imported into, and correcting a guessed vocabulary after the import is a
--      data migration against live data, not an edit. The word "sector" does not
--      appear anywhere in src/, docs/ or scripts/ today — this would be
--      INTRODUCING the concept, not extending one, and there is no cost to
--      introducing it in 0030 with the report open on the desk.
--
--   ② IT IS ALREADY EXPRESSIBLE, TODAY, WITH NO SCHEMA CHANGE. `map_node_kinds`
--      is a flat label vocabulary seeded with three rows and `on conflict
--      (lower(btrim(name))) do nothing` (0023:259), so a fourth row named
--      "Sector" is a SEED, not a migration — and a sector node is then an ordinary
--      `map_nodes` row with children under it. That costs one rung of tree depth,
--      and the depth cap is 6 (0023:733) with the demo portfolio already at 5, so
--      it is the LAST spare rung and spending it is a real decision about which
--      filing axis the tree is for. This file does not spend it and does not
--      forbid spending it.
--
--   ③ AN ATTRIBUTE AND A LEVEL ARE DIFFERENT SHAPES AND ONLY ONE OF THEM IS FREE
--      TO CHANGE LATER. If sector turns out to be an attribute, it wants a column
--      here or a small vocabulary table referenced from here. If it turns out to
--      be a filing level, it wants a kind row and a tier in the tree. Guessing
--      wrong in this file means the wrong one ships with 400 rows in it. Guessing
--      nothing costs a second sitting.
--
-- Probe 1 FAILS THE MIGRATION if a `sector` column appears on either table, so
-- that adding one stays a conversation rather than a merge — the same device
-- 0026:1050 uses to keep a colour column off the stage ladder.
--
--
-- ═══ NO SYNC STATE, AND NO SECOND MATCHING KEY ═══
--
-- `map_node_branches` has NO `source`, NO `external_ref`, NO `synced_at` and NO
-- `overrides`. 0028 already owns the Jira side of organization identity through
-- `jira_settings.organization_field` — which Jira field names the organization —
-- and holds no sync state itself (0028:237). Adding provenance columns to this
-- table would create a SECOND story about how an organization is matched to an
-- external system, told in a different vocabulary, before the first one has ever
-- run against a real Jira project.
--
-- If a nightly process ever writes branches, the columns it needs are `source`
-- (spelling the same closed two-value list under its own constraint name,
-- 0024:416's rule), `synced_at`, and a `synced_at` subtraction in BOTH the touch
-- and the audit diff on this table (0023:643) — because a sync that stamps only
-- its own timestamp must not report every branch in the workspace as edited every
-- night. That is written down here so the next person adds all four together or
-- none. Probe 1 asserts their absence today.
--
--
-- ═══ THERE IS NO BACKFILL AND NO SEED. THIS FILE WRITES ZERO ROWS ═══
--
-- Not one `update public.map_nodes set org_id = …`, not one branch row, not one
-- seeded vocabulary. After this file applies, all 400+ imported organizations
-- have `org_id is null` and no branches, and that is the correct state.
--
-- NULL IS THE ANSWER "we have not been told yet", and it is a real answer the
-- product needs to be able to give — the first number anybody wants out of this
-- feature is "how many of the 400 do we not yet have an Organization ID for". A
-- placeholder string would destroy that number on the way in, which is 0026:72's
-- reasoning about the absent progress row and 0003's about `sla_days`. It is also
-- src/types.ts:789's rule: `UseCaseStatus` has three members and no `'none'`,
-- because absence is the absence of the row, never a sentinel value.
--
-- The CHECK below therefore refuses a BLANK org_id as well as a too-long one. A
-- nullable column plus an empty string is three states for a two-state question,
-- and `''` versus `null` is exactly the ambiguity 0023:359 refused for `vendor`
-- in the other direction — `vendor` is `not null default ''` because a filter
-- reads it and "not recorded" must be a value; `org_id` is nullable with `''`
-- forbidden because it is an identity and "not recorded" must be the absence of
-- one. Both files ban the three-state column; they land on opposite sides of it
-- because one is a filter and one is a key.
--
-- The supported way to land Organization IDs in bulk is the importer, which is
-- UNDOABLE THROUGH ITS MANIFEST. An `update` statement in a migration is not.
-- Probe 1 asserts the absence rather than trusting it, by counting rows this
-- transaction wrote.
--
--
-- ═══ NO RPC IN THIS FILE, AND THE ESCAPE HATCH IS NAMED ═══
--
-- `map_node_branches.sort_order` exists and nothing reorders it atomically. That
-- is deliberate: a `reorder_map_node_branches(p_ids uuid[])` modelled on
-- 0026:593 would be a new guarded RPC, a new runtime token, a new pgError.ts arm
-- and a new i18n key — invented for a screen nobody has seen. A hospital has a
-- handful of branches, not four hundred, and setting their order on the form that
-- creates them is one PATCH per row.
--
-- When the branch list gets a drag handle, the RPC is 0030's and it is
-- `reorder_map_node_stages` (0026:593) with the table name changed: `security
-- invoker`, `set search_path = public`, an explicit `has_perm('structure.edit')`
-- guard raising a `token:` prefixed message with `errcode = '42501'`, then
-- `revoke all … from public`, `revoke all … from anon`, `grant execute … to
-- authenticated`. Writing that down is cheaper than the next person deriving it.
--
--
-- ═══ WHAT THIS FILE DOES NOT REDEFINE ═══
--
-- 0029 ADDS. It restates nothing. `map_nodes_touch()`, `map_nodes_audit()`,
-- `map_nodes_derive_track()`, `map_nodes_check_tree()`,
-- `map_nodes_block_delete()`, `is_admin()`, `has_perm()`, `is_member()`,
-- `log_config_audit()` and every one of the twenty-one policies 0025 owns are
-- CALLED here and defined nowhere here — INCLUDING the four `map_nodes` policies,
-- which 0025:752 already re-pointed at `has_perm('structure.edit')` and which the
-- new `org_id` column inherits without a line of policy DDL. That is what keeps
-- 0025's probe 5 half A green and leaves the `w_0025` / `f_0025` reversion canary
-- in docs/PENDING-MIGRATIONS.md exactly where it is after this file runs.
--
-- ⚠ IT ALSO DOES NOT TOUCH 0026, 0027 OR 0028, AND DOES NOT REQUIRE THEM. None
--   of those three has ever been applied to any database; all five of their
--   objects 404 on the live project. This file names none of them in its
--   preflight, references none of their tables, and applies cleanly to a project
--   that stops at 0025 — which is the project that exists. It is equally correct
--   after they land, because it shares no object with them.
--
-- If a later cut of this file finds itself typing `create or replace function
-- public.map_nodes_touch`, the change belongs in a new file, never here — and
-- never by re-running 0023 or 0024, which would restore `is_admin()` on
-- `map_nodes` and silently strip the Director role of the whole tree
-- (docs/PENDING-MIGRATIONS.md:47).
--
-- ⚠ ONE KNOWN DEFECT IS LEFT ALONE HERE ON PURPOSE, AND IT IS 0030'S.
--   `map_node_use_cases_touch()` (0024:527-534) pins `created_by` and the else
--   arm's `updated_by` FLAT, which is FIX-BACKLOG R2-DB-1 — the same defect 0015
--   and 0019 fixed on `entries`, and the one this file's own
--   map_node_branches_touch() fixes below with 0015:206's `case`. 0024 IS
--   APPLIED LIVE, so retiring a member today leaves `map_node_use_cases` rows
--   pointing at a profile that no longer exists. 0029 does not restate it,
--   because restating a live function from a file whose subject is a different
--   table is how 0023/0024 re-runs strip the Director role in the first place.
--   It is named here so the next file inherits a task and not a surprise:
--   0030 restates map_node_use_cases_touch() with the `case` and the third
--   branch, and probes it the way probe 5 below probes this table.
--   `map_node_goals_touch()` (0027:485 and 0027:500, both columns) and
--   `map_node_progress_touch()` (0026:871, the updated_by half only — that table
--   has no created_by) carry it too, and both files are still unapplied, so
--   whoever runs them next can fix it in place rather than in 0030.
--
--
-- ═══ THE TOKEN CONTRACT WITH src/lib/pgError.ts ═══
--
-- THIS FILE RAISES NO RUNTIME `token:` MESSAGES, and that is a consequence of the
-- block above rather than an oversight: a token is raised by an RPC or a trigger
-- guard, and this file adds neither. Every failure a client can provoke here is a
-- constraint or an index violation, and pgError.ts matches those BY NAME. So the
-- handshake is a list of names rather than a list of tokens, and renaming any one
-- of them silently demotes a precise sentence to the generic `common.error`:
--
--   map_nodes_org_id_uidx              → mapadmin.errOrgIdTaken
--                                        23505. TWO ORGANIZATIONS CLAIMING ONE
--                                        NPHIES ID, and it is the likeliest error
--                                        in this feature: the report is copied
--                                        row by row and one line gets pasted
--                                        twice. The sentence must name the OTHER
--                                        organization, or the admin goes looking
--                                        through 400 rows for a duplicate they
--                                        cannot see.
--   map_nodes_org_id_chk               → mapadmin.errOrgIdInvalid
--                                        23514. Blank, whitespace-only, or longer
--                                        than 40 characters.
--   map_node_branches_facility_uidx    → mapadmin.errBranchFacilityTaken
--                                        23505. The same facility ID twice under
--                                        one organization. SCOPED TO THE NODE, so
--                                        the sentence must say "under this
--                                        organization" — a workspace-wide
--                                        duplicate is NOT what this fires on.
--   map_node_branches_facility_len_chk → mapadmin.errBranchFacilityLength
--   map_node_branches_name_len_chk     → mapadmin.errBranchNameLength
--   map_node_branches_node_id_fkey     → mapadmin.errNodeGone (23503: a stale tab
--                                        adding a branch to an organization a
--                                        colleague just deleted — the same arm
--                                        0026 registered for map_node_progress)
--
-- The probe blocks at the bottom raise with a `NphiesCore 0029 FAILED:` prefix
-- instead. Those are apply-time refusals read by whoever is running the file,
-- never by a client, and they are deliberately NOT tokens.
--
--
-- ═══ WHAT THE CLIENT WAVE MUST LAND ═══
--
-- The pgError arms above; the six `mapadmin.*` keys in EN and AR; `org_id?:
-- string | null` on `MapNode` in src/types.ts (because src/api/map.ts:138 reads
-- `select('*')` and `MapNode` declares every field required, so the type is lying
-- about live rows until it lands); a `MapNodeBranch` type and its store read
-- behind the cache key `nphiescore_map_node_branches_v1` (the
-- `nphiescore_<table>_v1` pattern — the `opstrack_*` keys, `@opstrack.internal`,
-- the `opstrack-live` channel and the format tags are FROZEN and src/lib/
-- brand.test.ts enforces them); and one change that is easy to miss:
--
--   ⚠ `MapNodeUsage` / `getMapNodeUsage()` (src/api/map.ts:399) MUST COUNT
--     BRANCHES. 0023's `map_nodes_block_delete()` counts children and entries and
--     refuses; branches CASCADE instead, so deleting an organization DESTROYS its
--     facility IDs without the guard saying a word. `useCases` is already counted
--     there for the same reason and is the template. A delete confirmation that
--     does not say "and 7 facility IDs" is a dialog that lies by omission.
--
--
-- ═══ APPLY IT TWICE ═══
--
-- Supabase Dashboard → SQL Editor → paste + Run. READ THE NOTICES — there are
-- FIVE of them on a healthy run, one per probe, and the runbook counts them. Then
-- paste and Run THE SAME FILE AGAIN, and read them again.
--
-- The second run must be a complete no-op that still passes every probe: the
-- table create skips, every column add skips, every constraint and policy and
-- trigger is dropped and recreated identically, every index is rebuilt or
-- skipped, and every function is replaced with itself. That is what makes "apply
-- it twice" a real test rather than a formality (0018:356), and it is what makes
-- the fix-and-re-run loop free if a probe does fail.
--
-- Re-runnable from the top in any partial state, same discipline as 0001–0028:
-- `create table if not exists` PLUS a separate `add column if not exists` per
-- column (0017:129 / 0018:136 — for a project where an earlier cut of this file
-- already landed), `drop constraint if exists` before every add, `drop index` +
-- `create unique index` where the index's PREDICATE is load-bearing (0023:456),
-- `create index if not exists` where it is not, `drop policy if exists` before
-- every create, `drop trigger if exists` before every create, `create or replace`
-- on every function, no seeds at all, and probe blocks at the bottom that roll
-- their fixtures back through the `OT029` sentinel. A probe failure raises and
-- the whole migration rolls back — no explicit begin/commit here, for the reason
-- 0009's header spells out.


-- ── preflight: 0023, 0025, 0002 and 0001. NOT 0026/0027/0028 ────────────────
-- `map_node_branches.node_id` references `public.map_nodes` (0023), its write
-- policies are written in terms of `public.has_perm()` (0025), its audit trigger
-- calls `public.log_config_audit()` (0002), and its authorship columns reference
-- `public.profiles` (0001). Each is checked BY NAME, and functions are checked by
-- their EXACT signature with `to_regprocedure` rather than by the table that
-- happens to come with them — a policy predicate naming a function that is not
-- there fails as a bare 42883 from the middle of a CREATE POLICY, which reads
-- like a broken file rather than a missing prerequisite.
--
-- 0026, 0027 and 0028 are deliberately ABSENT from this list. None of them has
-- been applied to any database, this file shares no object with any of them, and
-- requiring one here would make organization identity wait on the stage ladder
-- for no reason at all.
do $preflight$
begin
  if to_regclass('public.map_nodes') is null then
    raise exception
      'NphiesCore 0029 CANNOT APPLY: public.map_nodes does not exist. Apply 0023_map_nodes.sql first — this file gives those nodes their NPHIES identity and hangs their branches off them.';
  end if;

  if to_regclass('public.profiles') is null then
    raise exception
      'NphiesCore 0029 CANNOT APPLY: public.profiles does not exist. Apply 0001_opstrack_core.sql first — created_by and updated_by on map_node_branches reference it.';
  end if;

  if to_regprocedure('public.is_member()') is null then
    raise exception
      'NphiesCore 0029 CANNOT APPLY: public.is_member() does not exist. Apply 0001_opstrack_core.sql first — every read policy below is written in terms of it.';
  end if;

  if to_regprocedure('public.has_perm(text)') is null then
    raise exception
      'NphiesCore 0029 CANNOT APPLY: public.has_perm(text) does not exist. Apply 0025_roles_permissions.sql first — branches are written by whoever holds structure.edit, and without has_perm() there is no way to say that.';
  end if;

  if to_regprocedure('public.log_config_audit(text, uuid, text, jsonb, jsonb)') is null then
    raise exception
      'NphiesCore 0029 CANNOT APPLY: public.log_config_audit(text, uuid, text, jsonb, jsonb) does not exist. Apply 0002_config_foundation.sql first — map_node_branches is configuration and is audited, and a certificate generated against a wrong facility ID needs a trail saying who typed it.';
  end if;

  if to_regclass('public.config_audit') is null then
    raise exception
      'NphiesCore 0029 CANNOT APPLY: public.config_audit does not exist. Apply 0002_config_foundation.sql first — it is the table log_config_audit() writes into.';
  end if;
end
$preflight$;


-- ════════════════════════════════════════════════════════════════════════════
-- ═══ PART 1 — map_nodes.org_id ══════════════════════════════════════════════
-- ════════════════════════════════════════════════════════════════════════════

-- One column. NULLABLE, because most nodes in this tree are not organizations at
-- all — a Programme, a Phase, a directorate, an account book and a type tier all
-- legitimately have no NPHIES Organization ID, and so does every organization
-- whose ID has not reached us yet. NULL means "we have not been told", and the
-- CHECK below makes sure it is the ONLY way to say that.
--
-- ⚠ NOT NAMED `nphies_id` OR `external_id`, on purpose. `external_*` is already
--   taken by the Jira provenance block (0023:339) and a second `external_`
--   prefix on the same table would be read as belonging to it. `org_id` says
--   what it is in the vocabulary the people using this product speak.
--
-- ⚠ NO DB-LEVEL RULE SAYING "ONLY Organization NODES MAY CARRY ONE." It would be
--   the first thing in the product to branch on `kind_id`, and src/types.ts:822
--   states outright that nothing in the renderer does. `kind_id` is nullable and
--   `on delete set null` (0023:324), so such a rule would start refusing writes
--   the moment somebody retires a kind — a delete in the catalogue screen
--   breaking data entry on a screen three rings away, with nothing on either
--   screen connecting the two. The tree's own shape is the guidance; the database
--   does not enforce a taxonomy it was told nothing branches on.
alter table public.map_nodes add column if not exists org_id text;

comment on column public.map_nodes.org_id is
  'The NPHIES Organization ID for this node (0029). NOT external_ref, which is reserved for the Jira issue key (src/lib/jira/map.ts:43) and whose index map_nodes_external_idx is the sync''s remote-id lookup — an Org ID there would collide with the issue key, poison that index and make source=''local'' co-exist with a populated external_ref. NULL means "we have not been told yet", which is the state all 400+ imported organizations are in and a number the product reports; the empty string is REFUSED by map_nodes_org_id_chk so that "not recorded" has exactly one spelling. Unique across the workspace, archived rows included, via map_nodes_org_id_uidx. Editing it moves updated_at and writes a config_audit row through the existing 0023 triggers, which is wanted: a certificate rejected on a wrong Org ID starts with "who typed this, and what was here before".';

-- The bound is LENGTH ONLY, and there is deliberately no regex.
--
-- `map_nodes_external_url_chk` (0023:423) carries `^https?://` because anything
-- else is a dead link or a `javascript:` injection in an admin's browser — the
-- pattern is defending against something. Here there is nothing to defend
-- against and the format IS NOT KNOWN: the NPHIES Master Status Report has not
-- arrived, and a guessed `^[0-9]+$` refuses a legitimate ID at 3am during an
-- import, with an error message asserting a rule nobody agreed to. Length is the
-- only claim this file can honestly make.
--
-- 40, matching the schema-wide identifier bound rather than the 60 `map_nodes`
-- allows for `name` (0023's 60 exists because hospital names run to 48
-- characters; an issued identifier does not).
--
-- `btrim` before measuring, so `'   '` is refused: it is an empty value wearing a
-- hat, and it would otherwise be a second spelling of "not recorded" that the
-- unique index would also happily accept once.
alter table public.map_nodes drop constraint if exists map_nodes_org_id_chk;
alter table public.map_nodes add constraint map_nodes_org_id_chk
  check (org_id is null or char_length(btrim(org_id)) between 1 and 40);

-- PARTIAL (`where org_id is not null`) so that four hundred organizations can all
-- be un-identified at once, and UNIQUE so that two of them can never claim the
-- same registered entity.
--
-- ⚠ DROPPED AND RECREATED RATHER THAN `create unique index if not exists`, for
--   0023:456's reason: the guarded form would silently keep an index left by an
--   earlier cut of this file WITHOUT the partial predicate, or worse WITH a
--   `nulls not distinct` clause — either of which reports success while leaving
--   the exact hole this index exists to close. On `nulls not distinct` every
--   un-identified organization after the first would be rejected on insert, and
--   the error would name a duplicate Organization ID on a row that has none. The
--   table is four hundred rows; the rebuild is free and the guarantee is not.
--
-- `lower(btrim(...))`: the same organization pasted as `10000123A` and
-- `10000123a` is one organization, and finding out otherwise costs somebody a
-- rejected certificate rather than a double-take.
--
-- WORKSPACE-WIDE, NOT SIBLING-SCOPED, and that is the difference from
-- `map_nodes_sibling_name_uidx` (0023:456). Two organizations called "Emergency"
-- under two different phases are two real things; two organizations carrying one
-- NPHIES Organization ID are one thing filed twice, no matter where in the tree
-- they hang.
--
-- ARCHIVED ROWS PARTICIPATE, deliberately, which is 0023's call about sibling
-- names word for word: an archived organization still exists in the audit trail,
-- in every breadcrumb and on every certificate already issued, and letting a live
-- row re-claim its Organization ID makes all of those ambiguous with no way for a
-- reader to tell which entity a document refers to. Restoring the archived row is
-- the supported move.
drop index if exists public.map_nodes_org_id_uidx;
create unique index map_nodes_org_id_uidx
  on public.map_nodes (lower(btrim(org_id))) where org_id is not null;


-- ════════════════════════════════════════════════════════════════════════════
-- ═══ PART 2 — map_node_branches ═════════════════════════════════════════════
-- ════════════════════════════════════════════════════════════════════════════

-- N facility IDs per organization, ordered.
--
-- MODELLED ON `map_node_use_cases` (0024:326) and it is named here because the
-- rule is "copy whichever table the new one is modelled on, and say which":
-- `node_id … on delete cascade`, the pair as the identity, `created_at /
-- updated_at / created_by / updated_by` all four (which `map_nodes` and
-- `map_node_kinds` do NOT carry — they have `created_by` and no `updated_by`).
-- The four are carried because "who typed this facility ID, and who last
-- corrected it" is the question this table exists to be able to answer, and a
-- table whose whole purpose is provenance that records only half of it is worse
-- than one that records none.
--
-- THE DIFFERENCES FROM 0024, BOTH ARGUED ABOVE: a surrogate `id` (because
-- config_audit.row_id is uuid and this table is audited), and structure.edit
-- writes rather than member writes (because it is audited, which under
-- log_config_audit()'s guard is the same sentence).
--
-- ON DELETE CASCADE on node_id, and it is 0024:333's argument: "some deleted
-- organization had a facility called X" is not a fact worth keeping. There is one
-- consequence 0024 did not have and it is in the client-wave block above —
-- 0023's node delete guard counts children and entries, NOT branches, so a node
-- with branches and nothing else deletes cleanly and takes them with it. That is
-- correct behaviour for the database and a hole in the CONFIRMATION DIALOG, which
-- is why `getMapNodeUsage()` has to count them.
--
-- There is deliberately NO second FK. A branch points at its organization and at
-- nothing else: no vocabulary table to restrict, no status, no stage. When the
-- Master Status Report arrives and says what else a facility carries, that is a
-- column here or a table beside it, decided with the document open.
create table if not exists public.map_node_branches (
  id          uuid primary key default gen_random_uuid(),
  node_id     uuid not null references public.map_nodes (id) on delete cascade,
  facility_id text not null,
  name        text not null default '',
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.profiles (id) on delete set null,
  updated_by  uuid references public.profiles (id) on delete set null
);

comment on table public.map_node_branches is
  'The branches/facilities of one organization, each carrying its NPHIES facility ID (0029). One organization, N facilities, ordered by sort_order — the shape a NPHIES Certificate of Completion prints. A TABLE and not a text[] on map_nodes: a branch is three fields and not one string, "this facility ID twice under one organization" is a unique index rather than a rule a client remembers, "which organization owns facility X" is an index lookup rather than an unnest over every row, and an inserted branch is one config_audit row rather than a whole-array before/after the reader has to diff themselves. Member-read, structure.edit-write, AUDITED — and the last two are one decision, because log_config_audit() raises 42501 for a caller holding none of the four configuration keys (0025:1858), so an audit trigger on a member-writable table rolls back every legitimate member write.';

comment on column public.map_node_branches.facility_id is
  'The NPHIES facility ID for this branch (0029). Unique WITHIN ITS ORGANIZATION (map_node_branches_facility_uidx), case-insensitively and btrim''d — not workspace-wide, because nothing in this repository has yet seen the Master Status Report and a global constraint on a format nobody has looked at would refuse a legitimate import with a sentence asserting a rule nobody agreed to. Length-bounded only, with NO regex, for the reason map_nodes.org_id has none.';

comment on column public.map_node_branches.name is
  'What this branch is called, for the certificate and for the panel. NOT NULL DEFAULT '''' — 0023:359''s rule for vendor: a screen reads this column, and a three-state string/null/'''' makes "unnamed" and "unknown" two answers to one question. Deliberately has no name_ar sibling: the facility names arrive from NPHIES in one language and adding an Arabic column now would invent a field nobody has data for — and would force a partial unique index the moment anyone wanted it unique (0023:466).';

comment on column public.map_node_branches.sort_order is
  'The order the branches print in. Set on the same form that creates them; there is deliberately no reorder RPC in 0029 — see the header for what one would cost and what it would look like (0026:593 with the table name changed).';

comment on column public.map_node_branches.updated_by is
  'Who last corrected this facility ID. Server truth, resolved THROUGH profiles from auth.uid(), never a field the screen offers (0024:484). NULL when the write had no JWT — the SQL Editor, the service role and the importer all write rows honestly attributed to nobody.';

-- For a project where an earlier cut of this file already landed: `create table
-- if not exists` above is a no-op there, so every non-PK column has to be added
-- separately or the constraints below fail against a table that lacks them.
-- Same reasoning as 0017:129 and 0018:136.
alter table public.map_node_branches add column if not exists name        text not null default '';
alter table public.map_node_branches add column if not exists sort_order  int  not null default 0;
alter table public.map_node_branches add column if not exists created_at  timestamptz not null default now();
alter table public.map_node_branches add column if not exists updated_at  timestamptz not null default now();
alter table public.map_node_branches add column if not exists created_by  uuid references public.profiles (id) on delete set null;
alter table public.map_node_branches add column if not exists updated_by  uuid references public.profiles (id) on delete set null;

-- `node_id` and `facility_id` are NOT NULL WITH NO DEFAULT, and a NOT NULL column
-- with no default cannot ride `add column if not exists` — Postgres would have to
-- invent a value for every existing row. They are therefore asserted as separate
-- idempotent `set not null` statements instead. If an earlier cut of this file
-- left the table with a nullable `facility_id` AND rows in it that have none,
-- this line fails loudly, and that is the correct outcome: a branch row with no
-- facility ID is a line on a certificate with a blank where the identifier goes,
-- and it must be found and fixed by a person rather than quietly kept.
alter table public.map_node_branches add column if not exists node_id     uuid;
alter table public.map_node_branches add column if not exists facility_id text;
alter table public.map_node_branches alter column node_id     set not null;
alter table public.map_node_branches alter column facility_id set not null;

-- The FK is restated under its own name for the same partially-landed case: an
-- `add column if not exists node_id uuid` above creates the column without the
-- reference, and `map_node_branches_node_id_fkey` is a name src/lib/pgError.ts
-- matches (23503 → mapadmin.errNodeGone), so it must exist under exactly that
-- name whichever path produced the table.
alter table public.map_node_branches drop constraint if exists map_node_branches_node_id_fkey;
alter table public.map_node_branches add constraint map_node_branches_node_id_fkey
  foreign key (node_id) references public.map_nodes (id) on delete cascade;

-- 1..40 after btrim, so `'   '` is refused: a whitespace-only facility ID renders
-- as a blank cell on a certificate and satisfies `not null`. Same bound as
-- map_nodes.org_id and for the same reason — it is an issued identifier, not a
-- name somebody chose.
alter table public.map_node_branches drop constraint if exists map_node_branches_facility_len_chk;
alter table public.map_node_branches add constraint map_node_branches_facility_len_chk
  check (char_length(btrim(facility_id)) between 1 and 40);

-- 60, matching map_nodes_name_len_chk rather than the schema-wide 40, and for
-- 0023:159's reason: this is a name a HOSPITAL chose, not a word the admin
-- picked, and Saudi facility names run long. `<= 60` and not `between 1 and 60`
-- because the empty string is the legitimate "not recorded" state for this
-- column.
alter table public.map_node_branches drop constraint if exists map_node_branches_name_len_chk;
alter table public.map_node_branches add constraint map_node_branches_name_len_chk
  check (char_length(btrim(name)) <= 60);

-- THE PAIR IS STILL THE IDENTITY (0024:326) — it just is not the primary key,
-- because config_audit.row_id is uuid. This index is what makes "two rows saying
-- different things about the same facility" unrepresentable, which is the whole
-- content of 0024's argument, and src/lib/pgError.ts matches its NAME to turn the
-- 23505 into "that facility ID is already listed under this organization".
--
-- `lower(btrim(...))` for map_nodes_org_id_uidx's reason. NOT partial and NOT
-- `nulls not distinct`: both columns are NOT NULL, so there are no nulls to have
-- an opinion about.
--
-- ⚠ DROPPED AND RECREATED ANYWAY, exactly like map_nodes_org_id_uidx above, and
--   an earlier cut of this file got this wrong: it used `create unique index if
--   not exists` and argued that was safe because "nothing about this index's
--   shape can be silently lost the way a missing `where` clause could be". THE
--   EXPRESSION IS SUCH A SHAPE. `lower(btrim(facility_id))` is exactly as
--   silently-losable as a predicate — the guarded form keeps, verbatim and
--   without a word, an index of this name created over the bare `(node_id,
--   facility_id)` by an earlier cut or by a hand-made hotfix, and this file
--   ADVERTISES that it is re-runnable in exactly that partial state. A
--   case-sensitive index of the right name then passes probe 1's shape check
--   (which sees UNIQUE, NODE_ID and FACILITY_ID in the indexdef and is satisfied
--   by all three), and `10000123a` and `10000123A` become two branches of one
--   hospital — one building on one certificate, twice. The table is small; the
--   rebuild is free and the guarantee is not. Probe 1 additionally asserts LOWER
--   and BTRIM are IN the indexdef, so neither half of this can be lost quietly.
drop index if exists public.map_node_branches_facility_uidx;
create unique index map_node_branches_facility_uidx
  on public.map_node_branches (node_id, lower(btrim(facility_id)));

-- The panel's question — "what facilities does this organization have, in
-- order" — read once per organization panel open.
create index if not exists map_node_branches_node_idx
  on public.map_node_branches (node_id, sort_order);

-- THE REVERSE DIRECTION, and it is not optional (0024:425). The index above
-- serves "what does this organization have"; this one serves "WHICH ORGANIZATION
-- OWNS FACILITY 10000123", which is the question the certificate generator asks
-- and the question somebody asks at speed when a claim is rejected against a
-- facility nobody recognises. Without it that is a sequential scan with a
-- `lower(btrim(...))` per row over every branch in the workspace.
create index if not exists map_node_branches_facility_lookup_idx
  on public.map_node_branches (lower(btrim(facility_id)));

alter table public.map_node_branches enable row level security;

-- ═══ CONFIGURATION TABLE: MEMBER READ, structure.edit WRITE ═════════════════
--
-- This is a CONFIGURATION table, not a fieldwork table, and the header argues it
-- at length: a facility ID is a stable identity fact issued by an external
-- authority, typed once, rarely corrected, consequential when wrong. It gets the
-- ladder's permissions (0026:408) and not the scorecard's (0024:458).
--
-- The choice is also FORCED by the audit trigger below. log_config_audit()
-- (0025:1858) raises 42501 when auth.uid() is non-null and the caller holds none
-- of workspace.admin / structure.edit / vocab.edit / members.manage — so a
-- member-writable audited table rolls back every legitimate member write with a
-- permission error blamed on the wrong thing. Audited and member-writable is not
-- a trade-off; it is a table that does not work.
--
-- Read must be member-wide: an account manager looking at an organization has to
-- see which facilities it covers, and a panel that renders "0 branches" because
-- of RLS is worse than one that does not render branches at all.
--
-- Write is `structure.edit` FROM BIRTH, never `is_admin()` with a restatement to
-- come later. 0023 wrote is_admin() because has_perm() did not exist yet and 0025
-- had to go back and re-point eleven policies; has_perm() exists now, so this
-- file skips that dance entirely and 0025's probe 5 half A never has to learn
-- about this table.
--
-- NO NEW PERMISSION KEY. The catalogue is frozen at five by
-- role_permissions_key_ck (0025:436) and 0025's probe 1 refuses if Admin holds
-- fewer than five. A sixth key — `identity.edit`, say — would force an edit
-- INSIDE AN APPLIED FILE plus roles.ts, the PERMISSIONS meta, two locale keys,
-- the CommandPalette map and the Admin seed grant. `structure.edit` already means
-- "owns the shape of the programme", and an organization's identity is its shape.
--
-- Every predicate is in 0009's InitPlan form `(select public.is_member())` /
-- `(select public.has_perm(...))` so it is evaluated ONCE PER STATEMENT rather
-- than once per surviving row.
drop policy if exists map_node_branches_select on public.map_node_branches;
create policy map_node_branches_select on public.map_node_branches
  for select using ((select public.is_member()));

drop policy if exists map_node_branches_insert on public.map_node_branches;
create policy map_node_branches_insert on public.map_node_branches
  for insert with check ((select public.has_perm('structure.edit')));

drop policy if exists map_node_branches_update on public.map_node_branches;
create policy map_node_branches_update on public.map_node_branches
  for update using ((select public.has_perm('structure.edit')))
  with check ((select public.has_perm('structure.edit')));

drop policy if exists map_node_branches_delete on public.map_node_branches;
create policy map_node_branches_delete on public.map_node_branches
  for delete using ((select public.has_perm('structure.edit')));

-- Explicit rather than relying on Supabase's default privileges for new tables in
-- `public`; `anon` is left exactly as the project's defaults have it, matching
-- every other table since 0002, and cannot pass is_member() in any case.
grant select, insert, update, delete on public.map_node_branches to authenticated;


-- ── stamp: authorship on insert ─────────────────────────────────────────────
-- `map_node_use_cases_stamp()` (0024:484) on this table, and the shape is copied
-- rather than reinvented because the column set is the same one.
--
-- created_by/updated_by are SERVER TRUTH about the write, not fields the screen
-- offers, so they are OVERWRITTEN rather than trusted — entries_guard_insert()'s
-- rule (0015:330) at one table's scale.
--
-- `security definer` + `set search_path = public` because it reads `auth.uid()`
-- and `public.profiles`, and it resolves the actor THROUGH profiles rather than
-- from raw `auth.uid()` for the FK reason vocab_touch() gives: a JWT with no
-- profile row would violate `map_node_branches_created_by_fkey` from inside a
-- trigger and roll back a legitimate edit, which is a permission error where
-- there is no permission problem.
--
-- THE JWT-LESS PASSTHROUGH IS LOAD-BEARING and is the first `if` in the body: the
-- SQL Editor, the service role and the CSV importer all write without a `sub`
-- claim and must be able to write rows honestly attributed to nobody. It is also
-- what makes probe 4's planted `updated_by` possible.
create or replace function public.map_node_branches_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  new.created_by := (select p.id from public.profiles p where p.id = auth.uid());
  new.updated_by := null;
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists map_node_branches_stamp_trg on public.map_node_branches;
create trigger map_node_branches_stamp_trg
  before insert on public.map_node_branches
  for each row execute function public.map_node_branches_stamp();


-- ── touch: updated_at / updated_by, diffed, with the else arm PINNING BOTH ──
-- Diffed rather than stamped unconditionally, for track_groups_touch()'s reason
-- (0018:217): a form that saves several branches in one go must not report the
-- ones it did not change as edited, and — because this table IS audited — must
-- not emit a config_audit row for each of them either.
--
-- ⚠ THE `else` ARM PINS **BOTH** COLUMNS BACK — against a CLIENT, which is the
--   only writer that arm has to defend against; the one non-client writer that
--   reaches it is the foreign key's own `on delete set null`, and that one is
--   argued two blocks down. This is deliberately NOT what
--   0024's map_node_use_cases_touch() does. That one pins `updated_by` and leaves
--   `updated_at` alone, which hands a client that PATCHes a row carrying the
--   `updated_at` it read a minute ago (the shape of EVERY store that holds a row
--   and saves it back on blur) a false diff: the subtraction makes the comparison
--   equal, the `if` body is skipped, and the client's timestamp lands on the row.
--   0026:453 already argued this one table over and fixed it there; this is the
--   third table agreeing rather than a new idiom.
--
--   IT IS WORSE HERE THAN IT WAS THERE, because the audit trigger below compares
--   the FULL row images. Without the pin, that same blur-save also writes a
--   config_audit row whose before and after differ in one bookkeeping column —
--   the trail filling with rows recording that nothing happened, which is how an
--   audit log stops being read. Probe 4 sends a bogus `updated_at` on an
--   unchanged re-save and asserts BOTH halves: the row comes back byte-identical
--   AND no second audit row appears. Deleting these two lines fails the file.
--
--   THE CLIENT CONTRACT IS STILL "do not send them": `created_at`, `created_by`,
--   `updated_at` and `updated_by` are server-owned on this table.
--
-- `created_at` is pinned back UNCONDITIONALLY, on both arms: the moment the row
-- was created is not editable by anyone, including by a legitimate edit to the
-- facility ID.
--
-- ⚠ `created_by` AND THE else-ARM `updated_by` ARE **NOT** PINNED FLAT, AND THAT
--   IS FIX-BACKLOG R2-DB-1 APPLIED HERE BEFORE IT CAN BE FOUND LIVE AGAIN. Both
--   columns are `on delete set null` references to `public.profiles`, and the
--   FK's own action is an UPDATE — `update public.map_node_branches set
--   created_by = null where created_by = $1` — issued by Postgres itself, which
--   fires this BEFORE ROW trigger like any other. A flat `new.created_by :=
--   old.created_by;` writes the dead uuid straight back over the FK's NULL; the
--   old and new key values then compare equal, so RI_FKey_fk_upd_check_required
--   skips the re-check and NOTHING COMPLAINS. The row keeps a reference to a
--   profile that no longer exists, on the one table in this schema whose stated
--   purpose is provenance, and the constraint still reports itself as validated
--   until a pg_dump reload refuses the table.
--
--   The path is not hypothetical: an admin removes a colleague through
--   deleteMember() (src/api/members.ts) → the edge function deletes the
--   auth.users row → public.profiles cascades (0001:22) → the two referential
--   actions above run against every branch that person typed. The `updated_by`
--   half is the silent one, because the diff SUBTRACTS updated_by: the FK's
--   null-out lands in the `else` every single time, the pin restores it, the
--   audit trigger sees new == old and no config_audit row records that anything
--   happened at all. That is the identical shape 0019 PART 6 found live on
--   `entries` — where it 23503'd a plain PATCH through the PostgREST door — and
--   the fix here is 0015:206 / 0019:276's word for word: accept a NULL only when
--   the referent is GONE, which is the one state a client cannot manufacture.
--   A client's `{"created_by": null}` on a row whose author still exists is
--   still refused, which is the whole point of the pin.
--
--   The `updated_by` half is written as a THIRD BRANCH rather than as the `case`
--   the created_by half uses, so that the tail of the `else` stays literally
--   `new.updated_by := old.updated_by;` — 0019:318's reason, one table over.
--   Probe 5 asserts both halves: the pin still refuses a client, and the FK's
--   own NULL gets through.
--
--   ⚠ WHAT A MEMBER DELETION NOW COSTS THESE ROWS, stated so nobody meets it as
--     a surprise: the created_by null-out IS a real change to the row, so the
--     diff's change arm runs, `updated_at` moves to the deletion's now() and one
--     config_audit `update` row is written per affected branch recording that
--     the author was cleared. That is an honest record of a real change — the
--     facility ID lost its provenance — and not the trail pollution probe 4
--     exists to prevent, which is a row whose before and after differ in NOTHING
--     but bookkeeping.
--
-- Nothing is subtracted from the diff except the two columns the function writes
-- itself. In particular there is no `synced_at` subtraction because there is no
-- `synced_at` column — see the header's block on sync state, and note that adding
-- one later means adding the subtraction HERE and in the audit trigger below, or
-- a nightly run reports every branch in the workspace as edited every night
-- (0023:643).
create or replace function public.map_node_branches_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (to_jsonb(new) - 'updated_at' - 'updated_by')
       is distinct from (to_jsonb(old) - 'updated_at' - 'updated_by') then
    new.updated_at := now();
    new.updated_by := coalesce(
      (select p.id from public.profiles p where p.id = auth.uid()),
      old.updated_by
    );
  else
    -- Neither branch below moves updated_at: by definition nothing about this
    -- row changed, so the client's timestamp is discarded on both of them.
    new.updated_at := old.updated_at;

    if new.updated_by is null and old.updated_by is not null
       and not exists (select 1 from public.profiles p where p.id = old.updated_by) then
      -- The FK's own `on delete set null`, not a client edit: the profile this
      -- named is gone. Leave NEW exactly as it arrived — null — and let the
      -- delete complete. (0019:329, the third branch this file inherits.)
      null;
    else
      -- Never from the payload: subtracting updated_by from the diff and then
      -- leaving it alone hands a client a one-line `{"updated_by": null}` PATCH
      -- that erases the mark without changing anything else (0014:176-179).
      new.updated_by := old.updated_by;
    end if;
  end if;

  -- A value, not a reference: no FK ever writes it, so it is pinned outright.
  new.created_at := old.created_at;

  -- A REFERENCE, so it is pinned against clients and not against the foreign
  -- key (0015:206, 0019:276). The `not exists` read runs under SECURITY DEFINER
  -- and therefore sees profiles regardless of the caller's RLS.
  new.created_by := case
    when new.created_by is null and old.created_by is not null
     and not exists (select 1 from public.profiles p where p.id = old.created_by)
    then null
    else old.created_by
  end;
  return new;
end;
$$;

-- ⚠ NO NAME-ORDER DEPENDENCY HERE, unlike 0026:799. Postgres fires BEFORE ROW
--   triggers in NAME order, and 0026's stamp/touch pair had to be ordered because
--   both fire on UPDATE and one writes a column the other diffs. These two fire
--   on DISJOINT EVENTS — the stamp on INSERT only, the touch on UPDATE only — so
--   they can never both run on one write and there is nothing to order. If a
--   later cut ever widens the stamp to `before insert or update`, THAT is the
--   moment the names become load-bearing, and it must add the pg_trigger name
--   comparison probe 1 of 0026 carries.
drop trigger if exists map_node_branches_touch_trg on public.map_node_branches;
create trigger map_node_branches_touch_trg
  before update on public.map_node_branches
  for each row execute function public.map_node_branches_touch();


-- ── audit: this table IS configuration ──────────────────────────────────────
-- AFTER, not BEFORE: the row image recorded must be the one that survived every
-- other trigger and constraint on the table. Identical in shape to
-- map_node_stages_audit() (0026:507) and map_nodes_audit() (0023:670).
--
-- THE OMISSION ARGUED IN 0024:544 AND 0026:53 IS DELIBERATELY NOT MADE HERE, and
-- the contrast is the whole permission design in one trigger. `map_node_use_cases`
-- and `map_node_progress` are fieldwork — day-to-day data entry by account
-- managers, which would produce a configuration trail dominated by routine writes
-- and stop being read. A facility ID is the opposite kind of change: rare,
-- consequential, made by one person with nobody watching, and printed onto a
-- document sent to a regulator. `before` is the only record of what the facility
-- ID used to be when a certificate comes back rejected.
--
-- The UPDATE arm compares the FULL row images with NOTHING subtracted, which is
-- safe only because the touch trigger above pins both bookkeeping columns in its
-- else arm (BEFORE beats AFTER regardless of names, so the touch has already
-- run). A save that changed nothing therefore writes no audit row — asserted by
-- probe 4, not assumed. If a `synced_at` column is ever added, this comparison
-- has to start subtracting it.
--
-- The ONE write that reaches here having genuinely changed only an authorship
-- column is the foreign key's own `on delete set null`, which the touch trigger
-- now lets through instead of overwriting (probe 5). It writes an `update` row,
-- and that is right: "this facility ID lost the record of who typed it" is
-- exactly the kind of thing this trail exists to have said.
--
-- Explicit `null::jsonb` casts on the null side: with a single candidate Postgres
-- resolves an untyped null anyway, but an overload added later would make this
-- ambiguous at runtime, inside a trigger, on someone else's write.
create or replace function public.map_node_branches_audit()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_config_audit('map_node_branches', new.id, 'insert', null::jsonb, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    if to_jsonb(new) is distinct from to_jsonb(old) then
      perform public.log_config_audit('map_node_branches', new.id, 'update', to_jsonb(old), to_jsonb(new));
    end if;
    return new;
  else
    perform public.log_config_audit('map_node_branches', old.id, 'delete', to_jsonb(old), null::jsonb);
    return old;
  end if;
end;
$$;

drop trigger if exists map_node_branches_audit_trg on public.map_node_branches;
create trigger map_node_branches_audit_trg
  after insert or update or delete on public.map_node_branches
  for each row execute function public.map_node_branches_audit();


-- ════════════════════════════════════════════════════════════════════════════
-- ═══ PROBES ═════════════════════════════════════════════════════════════════
-- ════════════════════════════════════════════════════════════════════════════
--
-- Every one of these can FAIL, which is the rule docs/PENDING-MIGRATIONS.md ends
-- on: 0019's probe 1 asserted that a row existed and never what it said, and a
-- wrong notification shipped. Each assertion below is written so that deleting
-- the code it tests makes it raise. A probe that passes vacuously is worse than
-- no probe at all.
--
-- ⚠ ONE LIMIT, STATED SO NOBODY MISTAKES IT FOR AN OVERSIGHT. `now()` is the
--   TRANSACTION timestamp and is constant for the whole of this file, so no probe
--   here can observe a timestamp MOVING between two writes — both land on the
--   same value. The probes therefore assert the strictly stronger thing that IS
--   observable inside one transaction: that a value the CLIENT supplied did not
--   survive, and that the trigger's own value is what came back. The one failure
--   that would otherwise hide behind a motionless clock — a touch diff that
--   stopped reacting to a real edit — is caught in probe 3 instead, through
--   `updated_by`: a branch is planted with a null author, a structure.edit holder
--   renames it, and only the diff's change arm can put their id there.
--
-- ⚠ EVERY FIXTURE STRING IS DELIBERATELY SHORT — a readable prefix plus the first
--   eight characters of a uuid, never a whole 36-character one.
--   `map_node_branches_facility_len_chk` and `map_nodes_org_id_chk` both cap at
--   40, and a full uuid on the end of any readable prefix clears it. That raises
--   23514, which none of the `insufficient_privilege` handlers below catch, so
--   the probe would fail the whole migration while appearing to test permissions.
--   Eight hex characters is ample for a fixture rolled back before the next probe
--   runs. Fixture NODE names may be longer: map_nodes allows 60.
--
-- ⚠ THE ROLLBACK SENTINEL IS `OT029`, following OT026 / OT027 / OT028. Literal
--   'OT' plus the file number, and nothing else.
--
-- FIVE NOTICES on a healthy run. The runbook counts them.


-- ── probe 1: the shape landed, and the absences the header argued for ───────
-- Runs as whoever applies the file (the SQL Editor, i.e. no JWT), which is the
-- right role here: this probe tests STRUCTURE and NAMES. RLS is probe 3's job.
--
-- It checks client-facing NAMES and not merely existence, because a constraint or
-- index created under a different name by an earlier cut of this file leaves a
-- pgError.ts arm dead with no other symptom — a precise sentence silently
-- demoted to common.error, discovered by a user.
do $shape$
declare
  v_nullable   text;
  v_type       text;
  v_idx        text;
  v_facidx     text;
  v_extidx     text;
  v_confdel    text;
  v_qual       text;
  v_check      text;
  v_nodes_qual text;
  v_notnull    boolean;
  v_orgs       int;
  v_branches   int;
  v_refs       int;
begin
  if to_regclass('public.map_node_branches') is null then
    raise exception 'NphiesCore 0029 FAILED: public.map_node_branches does not exist.';
  end if;

  -- ── map_nodes.org_id: present, text, and NULLABLE ──
  select c.is_nullable, c.data_type into v_nullable, v_type
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'map_nodes' and c.column_name = 'org_id';

  if v_nullable is null then
    raise exception
      'NphiesCore 0029 FAILED: map_nodes has no org_id column. Nothing in the tree can name a NPHIES organization, and a Certificate of Completion cannot be generated from tracker data at all.';
  end if;

  if v_type <> 'text' then
    raise exception
      'NphiesCore 0029 FAILED: map_nodes.org_id is % and not text. A NPHIES Organization ID has no known format — the Master Status Report has not arrived — and typing it as anything narrower asserts a rule nobody agreed to.',
      v_type;
  end if;

  -- NULLABLE is an assertion, not an accident: NULL is the answer "we have not
  -- been told yet", which is the state all 400+ imported organizations are in and
  -- a number the product reports. A NOT NULL org_id would force a placeholder on
  -- every non-organization node in the tree.
  if v_nullable <> 'YES' then
    raise exception
      'NphiesCore 0029 FAILED: map_nodes.org_id is NOT NULL. Most nodes in this tree are programmes, phases, directorates and type tiers with no NPHIES Organization ID at all, and every organization starts with none — NULL is the answer "we have not been told yet", and forcing a value replaces it with a placeholder the product would then have to filter out everywhere.';
  end if;

  if not exists (
    select 1 from pg_constraint con
      join pg_class c on c.oid = con.conrelid
     where c.relname = 'map_nodes' and con.conname = 'map_nodes_org_id_chk'
  ) then
    raise exception
      'NphiesCore 0029 FAILED: map_nodes_org_id_chk is missing. Without it the empty string is a second spelling of "not recorded" alongside NULL, and src/lib/pgError.ts has no name to match for a blank or over-long Organization ID.';
  end if;

  -- ── the org_id unique index: exists, unique, and PARTIAL ──
  select pg_get_indexdef(i.indexrelid) into v_idx
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
   where c.relname = 'map_nodes_org_id_uidx';

  if v_idx is null then
    raise exception
      'NphiesCore 0029 FAILED: map_nodes_org_id_uidx does not exist. Two organizations could then claim the same NPHIES Organization ID, and src/lib/pgError.ts has no name to match for mapadmin.errOrgIdTaken.';
  end if;

  if position('UNIQUE' in upper(v_idx)) = 0 then
    raise exception
      'NphiesCore 0029 FAILED: map_nodes_org_id_uidx is not UNIQUE (%). Its entire job is to stop one registered entity being filed twice.',
      v_idx;
  end if;

  -- PARTIAL is the half that lets four hundred organizations be un-identified at
  -- once. It is also the half `create unique index if not exists` would silently
  -- lose against an index left by an earlier cut, which is why the DDL above
  -- drops and recreates instead (0023:456).
  -- THE PREDICATE ITSELF IS READ, not merely the presence of the word WHERE. An
  -- index left under this name by an earlier cut carrying some OTHER predicate
  -- is still "partial" and would satisfy a bare ' WHERE ' test while indexing a
  -- different set of rows entirely.
  if position(' WHERE ' in upper(v_idx)) = 0
     or position('ORG_ID IS NOT NULL' in upper(v_idx)) = 0 then
    raise exception
      'NphiesCore 0029 FAILED: map_nodes_org_id_uidx is not partial on org_id IS NOT NULL (%). Without that predicate an index carrying NULLS NOT DISTINCT would reject every un-identified organization after the first — and report it as a duplicate Organization ID on a row that has none.',
      v_idx;
  end if;

  if position('NULLS NOT DISTINCT' in upper(v_idx)) > 0 then
    raise exception
      'NphiesCore 0029 FAILED: map_nodes_org_id_uidx carries NULLS NOT DISTINCT (%). Every organization whose Organization ID has not arrived yet would then collide with every other one.',
      v_idx;
  end if;

  -- THE CASE-FOLDING EXPRESSION, asserted for the same reason the predicate is:
  -- `lower(btrim(...))` is a SHAPE, and a shape is exactly what survives, silent
  -- and unmentioned, when somebody replaces the drop-and-rebuild above with the
  -- guarded form. Losing it makes `10000123A` and `10000123a` two registered
  -- entities, which is a rejected certificate rather than a double-take.
  if position('LOWER' in upper(v_idx)) = 0
     or position('BTRIM' in upper(v_idx)) = 0 then
    raise exception
      'NphiesCore 0029 FAILED: map_nodes_org_id_uidx is not over lower(btrim(org_id)) (%). The same organization pasted as 10000123A and 10000123a is ONE organization; without the folding the tree files it twice and every certificate generated from it is ambiguous about which row it describes.',
      v_idx;
  end if;

  -- ── external_ref is UNTOUCHED, and its index still means what it meant ──
  -- The single most likely "improvement" to this file is somebody deciding org_id
  -- was unnecessary and putting the Organization ID in external_ref after all.
  -- These two assertions are what makes that fail here rather than the first time
  -- a Jira sync runs.
  select pg_get_indexdef(i.indexrelid) into v_extidx
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
   where c.relname = 'map_nodes_external_idx';

  if v_extidx is null then
    raise exception
      'NphiesCore 0029 FAILED: map_nodes_external_idx has disappeared. It is the Jira sync''s remote-id lookup (0023:483) and this file must leave it exactly as it found it.';
  end if;

  if position('EXTERNAL_REF' in upper(v_extidx)) = 0
     or position(' WHERE ' in upper(v_extidx)) = 0 then
    raise exception
      'NphiesCore 0029 FAILED: map_nodes_external_idx is no longer (source, external_ref) WHERE external_ref IS NOT NULL. It reads: %. That index belongs to the Jira sync, and 0029 repurposing it would put source=''local'' rows into the set the sync scans.',
      v_extidx;
  end if;

  select count(*) into v_refs
    from public.map_nodes where external_ref is not null and updated_at = now();

  if v_refs <> 0 then
    raise exception
      'NphiesCore 0029 FAILED: this migration wrote external_ref on % row(s). external_ref is reserved for the Jira ISSUE KEY (src/lib/jira/map.ts:43) and is empty on every row today — which is the only reason the v1 resolver is allowed to match by name. Putting an Organization ID there collides with the issue key, poisons map_nodes_external_idx, makes source=''local'' co-exist with a populated external_ref, and makes an "overrides" entry mean two different provenances. Use org_id.',
      v_refs;
  end if;

  -- ── map_node_branches: the not-nulls that make a certificate line legible ──
  -- `relkind = 'r'` because relname is not unique across the catalog — an index
  -- or a view carrying the same name would otherwise be joined in and the
  -- assertion would read a column list that is not the table's.
  select a.attnotnull into v_notnull
    from pg_attribute a join pg_class c on c.oid = a.attrelid
   where c.relname = 'map_node_branches' and c.relkind = 'r'
     and a.attname = 'facility_id' and a.attnum > 0;

  if v_notnull is null then
    raise exception
      'NphiesCore 0029 FAILED: map_node_branches has no facility_id column. A branch without a facility ID is a line on a certificate with a blank where the identifier goes.';
  end if;

  if not v_notnull then
    raise exception
      'NphiesCore 0029 FAILED: map_node_branches.facility_id is nullable. The whole row exists to carry that value; a null one is a branch nobody can put on a document.';
  end if;

  select a.attnotnull into v_notnull
    from pg_attribute a join pg_class c on c.oid = a.attrelid
   where c.relname = 'map_node_branches' and c.relkind = 'r'
     and a.attname = 'node_id' and a.attnum > 0;

  if v_notnull is null or not v_notnull then
    raise exception
      'NphiesCore 0029 FAILED: map_node_branches.node_id is missing or nullable. A branch belonging to no organization is a row nothing can ever read.';
  end if;

  if not exists (
    select 1 from pg_constraint con join pg_class c on c.oid = con.conrelid
     where c.relname = 'map_node_branches'
       and con.conname in ('map_node_branches_facility_len_chk', 'map_node_branches_name_len_chk')
     group by c.relname having count(*) = 2
  ) then
    raise exception
      'NphiesCore 0029 FAILED: map_node_branches is missing map_node_branches_facility_len_chk and/or map_node_branches_name_len_chk. Both names are matched by src/lib/pgError.ts, and without the facility check a whitespace-only facility ID satisfies NOT NULL and renders as a blank cell.';
  end if;

  -- ── the pair index, by NAME and by COLUMNS ──
  select pg_get_indexdef(i.indexrelid) into v_facidx
    from pg_index i join pg_class c on c.oid = i.indexrelid
   where c.relname = 'map_node_branches_facility_uidx';

  if v_facidx is null then
    raise exception
      'NphiesCore 0029 FAILED: map_node_branches_facility_uidx does not exist. The pair (node_id, facility_id) IS the identity of a branch (0024:326) — without this index one organization can list the same facility twice and every count on a certificate is ambiguous.';
  end if;

  if position('UNIQUE' in upper(v_facidx)) = 0
     or position('NODE_ID' in upper(v_facidx)) = 0
     or position('FACILITY_ID' in upper(v_facidx)) = 0 then
    raise exception
      'NphiesCore 0029 FAILED: map_node_branches_facility_uidx is not a UNIQUE index over (node_id, facility_id). It reads: %. Scoped to anything wider and two hospitals in different parts of the tree stop being allowed to be filed independently; scoped to anything narrower and the duplicate this file exists to prevent gets in.',
      v_facidx;
  end if;

  -- ⚠ AND THE FOLDING, WHICH THE THREE ASSERTIONS ABOVE CANNOT SEE. A plain
  --   `CREATE UNIQUE INDEX … USING btree (node_id, facility_id)` left by an
  --   earlier cut of this file contains UNIQUE, NODE_ID and FACILITY_ID and
  --   satisfies every one of them. It is a case-SENSITIVE index wearing the
  --   right name, and under it `10000123a` and `10000123A` are two branches of
  --   one hospital — one building printed twice on one certificate, with the
  --   covered-facility count off by one and nothing on screen to explain it.
  --   This is why the DDL above drops and rebuilds rather than guarding.
  if position('LOWER' in upper(v_facidx)) = 0
     or position('BTRIM' in upper(v_facidx)) = 0 then
    raise exception
      'NphiesCore 0029 FAILED: map_node_branches_facility_uidx is not over lower(btrim(facility_id)) (%). A facility ID differing only in case or in surrounding whitespace is the SAME facility; an index that does not fold them lets one building onto a NPHIES certificate twice.',
      v_facidx;
  end if;

  if not exists (select 1 from pg_class where relname = 'map_node_branches_facility_lookup_idx') then
    raise exception
      'NphiesCore 0029 FAILED: map_node_branches_facility_lookup_idx does not exist. The pair index answers "what does this organization have"; this one answers "WHICH organization owns facility 10000123" — the certificate generator''s question and the one somebody asks at speed when a claim is rejected — and without it that is a sequential scan with a lower(btrim(...)) per row.';
  end if;

  -- ── the FK action: CASCADE, and the reason it is right ──
  select con.confdeltype::text into v_confdel
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_class f on f.oid = con.confrelid
   where c.relname = 'map_node_branches' and f.relname = 'map_nodes' and con.contype = 'f'
     and con.conname = 'map_node_branches_node_id_fkey';

  if v_confdel is null then
    raise exception
      'NphiesCore 0029 FAILED: map_node_branches has no foreign key named map_node_branches_node_id_fkey to map_nodes. Without the FK a branch can name an organization that does not exist; without that NAME, src/lib/pgError.ts cannot turn the 23503 a stale tab produces into mapadmin.errNodeGone.';
  end if;

  if v_confdel <> 'c' then
    raise exception
      'NphiesCore 0029 FAILED: map_node_branches.node_id is ON DELETE % , expected c (cascade). "Some deleted organization had a facility called X" is not a fact worth keeping (0024:333). Note the consequence this file states in its header: 0023''s node delete guard counts children and entries, NOT branches, so getMapNodeUsage() has to count them or the confirmation dialog lies by omission.',
      v_confdel;
  end if;

  -- ── the four policies, read out of pg_policies ──
  select p.qual into v_qual from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'map_node_branches'
     and p.policyname = 'map_node_branches_select';

  if v_qual is null or position('is_member' in v_qual) = 0 then
    raise exception
      'NphiesCore 0029 FAILED: map_node_branches_select is missing or does not read is_member(). Its predicate is: %. An account manager who cannot read this table sees an organization panel claiming zero facilities, which is worse than showing none at all.',
      coalesce(v_qual, '(no policy)');
  end if;

  select p.with_check into v_check from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'map_node_branches'
     and p.policyname = 'map_node_branches_insert';

  if v_check is null or position('structure.edit' in v_check) = 0 then
    raise exception
      'NphiesCore 0029 FAILED: map_node_branches_insert is missing or is not gated on has_perm(''structure.edit''). Its check is: %. This table is AUDITED, and log_config_audit() (0025:1858) raises 42501 for a caller holding none of the four configuration keys — so a member-writable audited table does not merely leak, it rolls back every legitimate member write with a permission error blamed on the wrong thing.',
      coalesce(v_check, '(no policy)');
  end if;

  select p.qual into v_qual from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'map_node_branches'
     and p.policyname = 'map_node_branches_update';

  if v_qual is null or position('structure.edit' in v_qual) = 0 then
    raise exception
      'NphiesCore 0029 FAILED: map_node_branches_update is missing or is not gated on has_perm(''structure.edit''). Its predicate is: %.',
      coalesce(v_qual, '(no policy)');
  end if;

  select p.qual into v_qual from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'map_node_branches'
     and p.policyname = 'map_node_branches_delete';

  if v_qual is null or position('structure.edit' in v_qual) = 0 then
    raise exception
      'NphiesCore 0029 FAILED: map_node_branches_delete is missing or is not gated on has_perm(''structure.edit''). Its predicate is: %.',
      coalesce(v_qual, '(no policy)');
  end if;

  if not exists (
    select 1 from pg_class c where c.relname = 'map_node_branches' and c.relrowsecurity
  ) then
    raise exception
      'NphiesCore 0029 FAILED: row level security is not enabled on map_node_branches. Four correct policies on a table with RLS off are four comments.';
  end if;

  -- ── the three triggers, READ OUT OF tgtype AND NOT OUT OF THE RENDERED TEXT ──
  --
  -- ⚠ AN EARLIER CUT OF THIS FILE MATCHED `pg_get_triggerdef()` FOR THE LITERAL
  --   STRING 'AFTER INSERT OR UPDATE OR DELETE' AND COULD NEVER APPLY TO ANY
  --   DATABASE. pg_get_triggerdef() DOES NOT ECHO THE ORDER THE EVENTS WERE
  --   WRITTEN. `tgtype` is a bitmask with no order in it at all, and
  --   pg_get_triggerdef_worker() in ruleutils.c renders the bits it finds in one
  --   fixed sequence — INSERT, then DELETE, then UPDATE, then TRUNCATE. The
  --   trigger created above therefore reads back as `AFTER INSERT OR DELETE OR
  --   UPDATE`, the searched-for substring never occurs, `not exists` is
  --   unconditionally true, and the probe raises on a trigger that is CORRECT —
  --   rolling the whole file back on run 1, run 2 and every run after. A probe
  --   that cannot pass is worse than a probe that passes vacuously: it makes the
  --   migration unappliable and blames an object that is right.
  --   (0028_jira_settings.sql:561 carries the identical defect, is likewise
  --   unapplied, and is fixed in the same wave as this file.)
  --
  --   So the shape is asserted against the bitmask, which cannot be reordered by
  --   any version of ruleutils.c:
  --       1 = FOR EACH ROW      2 = BEFORE      4 = INSERT
  --       8 = DELETE           16 = UPDATE     32 = TRUNCATE     64 = INSTEAD OF
  --   `& 60` is the whole event set, so `= 28` means INSERT|DELETE|UPDATE AND
  --   NOTHING ELSE rather than "at least these three".
  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relname = 'map_node_branches' and t.tgname = 'map_node_branches_audit_trg'
       and (t.tgtype::int & 60) = 28   -- INSERT | DELETE | UPDATE, exactly those three
       and (t.tgtype::int &  1) =  1   -- FOR EACH ROW, not FOR EACH STATEMENT
       and (t.tgtype::int &  2) =  0   -- AFTER, not BEFORE
       and (t.tgtype::int & 64) =  0   -- …and not INSTEAD OF
  ) then
    raise exception
      'NphiesCore 0029 FAILED: map_node_branches_audit_trg is missing or is not AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW (tgtype reads %). A facility ID is printed onto a document sent to a regulator, and `before` is the only record of what it used to be when that document comes back rejected. AFTER and not BEFORE, so the image recorded is the one that survived every other trigger; FOR EACH ROW, or seven branch inserts write one trail row between them.',
      coalesce((select t.tgtype::text from pg_trigger t join pg_class c on c.oid = t.tgrelid
                 where c.relname = 'map_node_branches' and t.tgname = 'map_node_branches_audit_trg'), '(absent)');
  end if;

  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relname = 'map_node_branches' and t.tgname = 'map_node_branches_touch_trg'
       and (t.tgtype::int & 60) = 16   -- UPDATE, and ONLY update
       and (t.tgtype::int &  1) =  1   -- FOR EACH ROW
       and (t.tgtype::int &  2) =  2   -- BEFORE
  ) then
    raise exception
      'NphiesCore 0029 FAILED: map_node_branches_touch_trg is missing or is not BEFORE UPDATE FOR EACH ROW (tgtype reads %). updated_at and updated_by would then be whatever the client sent, and — because this table is audited on the full row images — every blur-save would write a config_audit row recording that nothing happened.',
      coalesce((select t.tgtype::text from pg_trigger t join pg_class c on c.oid = t.tgrelid
                 where c.relname = 'map_node_branches' and t.tgname = 'map_node_branches_touch_trg'), '(absent)');
  end if;

  -- INSERT AND ONLY INSERT (`& 60 = 4`), which is not a stylistic assertion: the
  -- DDL block above argues that these two BEFORE ROW triggers need no name
  -- ordering BECAUSE their events are disjoint. Widen the stamp to `before
  -- insert or update` and both fire on one write, in name order, with one
  -- writing a column the other diffs — the dependency 0026:799 had to manage.
  -- This is the assertion that makes that widening fail HERE instead.
  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relname = 'map_node_branches' and t.tgname = 'map_node_branches_stamp_trg'
       and (t.tgtype::int & 60) =  4   -- INSERT, and ONLY insert
       and (t.tgtype::int &  1) =  1   -- FOR EACH ROW
       and (t.tgtype::int &  2) =  2   -- BEFORE
  ) then
    raise exception
      'NphiesCore 0029 FAILED: map_node_branches_stamp_trg is missing, is not BEFORE INSERT FOR EACH ROW, or has been widened to fire on UPDATE as well (tgtype reads %). "Who typed this facility ID" is the question this table exists to answer — and if it now fires on UPDATE too, it and map_node_branches_touch_trg both run on one write in NAME order, one of them writing a column the other diffs, which is the dependency this file was built to not have (0026:799).',
      coalesce((select t.tgtype::text from pg_trigger t join pg_class c on c.oid = t.tgrelid
                 where c.relname = 'map_node_branches' and t.tgname = 'map_node_branches_stamp_trg'), '(absent)');
  end if;

  -- ── THE ABSENCES THE HEADER ARGUED FOR ──
  --
  -- Asserted so that the next person adding one fails the migration and it stays
  -- a conversation rather than a merge (0026:1050's device, two tables over).
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name in ('map_nodes', 'map_node_branches')
       and column_name in ('sector', 'sector_id', 'sector_code')
  ) then
    raise exception
      'NphiesCore 0029 FAILED: a sector column has appeared on map_nodes or map_node_branches. 0029 deliberately does not model sector: the NPHIES Master Status Report has not arrived, nobody here has seen the vocabulary it uses, and a guessed column is one that 400 rows get imported into before it can be corrected. It is ALSO already expressible today with no schema change at all — a fourth map_node_kinds row named "Sector" is a seed (0023:259), and a sector node is then an ordinary map_nodes row — which costs the last spare rung of the depth-6 cap (0023:733) and is therefore a decision about which filing axis the tree is for. Make it with the report open, in 0030.';
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'map_node_branches'
       and column_name in ('synced_at', 'external_ref', 'source', 'overrides')
  ) then
    raise exception
      'NphiesCore 0029 FAILED: map_node_branches has grown a provenance/sync column. 0028 already owns the Jira side of organization identity (jira_settings.organization_field) and holds no sync state; a second matching story told here in a different vocabulary is one nobody can reconcile. If a nightly process really must write branches, ALL FOUR pieces land together: source with its own CHECK spelling the same closed list (0024:416), synced_at, a synced_at subtraction in map_node_branches_touch(), AND one in map_node_branches_audit() — or the run reports every branch in the workspace as edited every night (0023:643).';
  end if;

  -- ── NO BACKFILL AND NO SEED, asserted ──
  -- A backfill written into this file would insert or update rows inside THIS
  -- transaction, and now() is the transaction timestamp, so those rows — and only
  -- those rows — carry updated_at = now(). Rows written by the app in any earlier
  -- transaction are strictly older. Equality, not `>=`: a row written by a
  -- DIFFERENT transaction that commits while this file is running carries that
  -- transaction's now(), which is never this one's, so an admin editing the map
  -- during the deploy cannot fail the apply.
  select count(*) into v_orgs
    from public.map_nodes where org_id is not null and updated_at = now();

  if v_orgs <> 0 then
    raise exception
      'NphiesCore 0029 FAILED: this migration wrote an org_id onto % map_nodes row(s). THERE IS NO BACKFILL, deliberately: NULL means "we have not been told yet", which is the state all 400+ imported organizations are in and the first number this feature is asked for — "how many do we still not have an Organization ID for". A placeholder destroys that number on the way in (0026:72, 0003''s sla_days). Bulk Organization IDs go through the importer, which is undoable through its manifest; an update statement in a migration is not.',
      v_orgs;
  end if;

  select count(*) into v_branches
    from public.map_node_branches where updated_at = now();

  if v_branches <> 0 then
    raise exception
      'NphiesCore 0029 FAILED: this migration wrote % map_node_branches row(s). There is no seed and no backfill on this table either: a branch nobody entered is a facility asserted onto a certificate by a migration.',
      v_branches;
  end if;

  -- ── a WARNING, not a refusal: 0025 must still own map_nodes' write policies ──
  -- Refusing here would roll back the whole file — including whatever fix a
  -- re-run was carrying — over a condition this file did not cause and does not
  -- own. It is reported loudly instead, which is the seed-value rule (0026:1032)
  -- applied to somebody else's object.
  select p.qual into v_nodes_qual from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'map_nodes'
     and p.policyname = 'map_nodes_update';

  if v_nodes_qual is null or position('has_perm' in v_nodes_qual) = 0 then
    raise notice
      'NphiesCore 0029 probe 1 ⚠ map_nodes_update does not read has_perm() — its predicate is: %. 0025 re-pointed map_nodes'' three write policies at has_perm(''structure.edit''), so this almost certainly means 0023 or 0024 was re-run after 0025 and restored the dead is_admin() text, which silently strips the Director role of the whole tree (docs/PENDING-MIGRATIONS.md:47). org_id writes are gated by that same policy, so the new column is affected too. RE-APPLY 0025_roles_permissions.sql. 0029 itself applied correctly and is not the cause.',
      coalesce(v_nodes_qual, '(no policy)');
  end if;

  raise notice
    'NphiesCore 0029 probe 1: map_nodes.org_id is a NULLABLE text column with map_nodes_org_id_chk and a UNIQUE PARTIAL map_nodes_org_id_uidx (no NULLS NOT DISTINCT); external_ref and map_nodes_external_idx are exactly as 0023 left them and this file wrote neither; map_node_branches has NOT NULL node_id and facility_id, both length CHECKs, the (node_id, facility_id) unique index, the reverse facility lookup index, ON DELETE CASCADE under the name pgError.ts matches, RLS on with all four policies reading is_member / structure.edit, and its stamp, touch and audit triggers in the right shapes; no sector column and no sync columns exist; and this file wrote 0 org_id values and 0 branch rows.';
end
$shape$;


-- ── probe 2: seven branches under one organization, and the rules around them ─
-- The claims that cannot be verified by reading the file:
--
--   (a) an organization can hold N branches, ordered, and reading them back gives
--       the order the certificate prints;
--   (b) the same facility ID twice under ONE organization is refused, and the
--       same facility ID under a DIFFERENT organization is allowed — the index is
--       scoped to the node, which is the whole reason it is scoped that way;
--   (c) two organizations cannot claim one Organization ID, case-insensitively,
--       and a blank one is refused so that "not recorded" has one spelling;
--   (d) setting org_id rides 0023's EXISTING map_nodes audit diff — the audit row
--       lands and its `after` image carries the value. That is the argument FOR
--       the column and against a side table, asserted rather than assumed;
--   (e) seven branch inserts write exactly seven config_audit rows;
--   (f) deleting the organization takes its branches with it.
--
-- Everything is rolled back through the OT029 sentinel, fixtures included. Every
-- value the assertions need is captured into a variable declared above BEFORE the
-- sentinel raise; the assertions themselves run after the fixture block ends.
do $branches$
declare
  v_track       uuid;
  v_node        uuid;
  v_other       uuid;
  -- ⚠ THE PREFIXES ARE LOWER-CASE ON PURPOSE AND MUST STAY THAT WAY. The two
  --   case-folding assertions below are the ONLY behavioural test of
  --   case-insensitivity anywhere in 0023–0029, and they work by re-inserting
  --   `upper(<the value already stored>)`. An earlier cut wrote these prefixes as
  --   '0029-FAC-' / '0029-ORG-', which are already upper-case and digits — so the
  --   ONLY source of case variation was the eight hex characters of the uuid, and
  --   whenever those happened to be all digits (10/16 ^ 8 ≈ 2.3% of runs, per
  --   fixture) `upper()` returned a byte-identical string. The "case is not a way
  --   around it" insert then degenerated into a second copy of the exact-duplicate
  --   test above it, was refused by any unique index at all — including a
  --   case-SENSITIVE one — and the probe printed its notice claiming case had been
  --   tested. Roughly one run in 22 was green about something it never ran.
  --   A lower-case literal in the prefix makes upper() differ on EVERY run,
  --   by construction rather than by luck.
  v_fac         text := '0029-fac-' || left(gen_random_uuid()::text, 8);
  v_org         text := '0029-org-' || left(gen_random_uuid()::text, 8);
  v_order       text[];
  v_count       int := 0;
  v_after_del   int := -1;
  v_audit0_b    int;
  v_audit_b     int := -1;
  v_org_audit   int := 0;
  v_dup         boolean := false;
  v_cross       boolean := false;
  v_org_dup     boolean := false;
  v_org_case    boolean := false;
  v_org_blank   boolean := false;
begin
  -- `archived = false`: a probe that runs under an archived track is testing a
  -- shape nobody uses. An EXCEPTION and not a notice-and-return, for the reason
  -- this section opens on — a probe that does not run is a probe that passes.
  select id into v_track from public.tracks
   where archived = false order by sort_order, id limit 1;
  if v_track is null then
    raise exception 'NphiesCore 0029 FAILED: there is no unarchived track, so this probe has nowhere to hang a fixture organization and every assertion below it would pass without running. Create (or unarchive) one track and re-run.';
  end if;

  select count(*) into v_audit0_b from public.config_audit where table_name = 'map_node_branches';

  begin
    insert into public.map_nodes (track_id, name)
      values (v_track, '0029 Branch Probe ' || left(gen_random_uuid()::text, 8))
      returning id into v_node;

    insert into public.map_nodes (track_id, name)
      values (v_track, '0029 Branch Probe B ' || left(gen_random_uuid()::text, 8))
      returning id into v_other;

    -- ── (a) seven branches, ordered ──
    -- Seven and not one: a table that accepts a single child proves nothing about
    -- N, and "one organization, N facility IDs" is the whole shape being claimed.
    insert into public.map_node_branches (node_id, facility_id, name, sort_order)
    select v_node, v_fac || '-' || g, 'Branch ' || g, g
      from generate_series(1, 7) as g;

    select count(*) into v_count from public.map_node_branches where node_id = v_node;

    select array_agg(facility_id order by sort_order, id) into v_order
      from public.map_node_branches where node_id = v_node;

    -- ── (e) the audit delta, measured HERE, before anything else writes ──
    select count(*) - v_audit0_b into v_audit_b
      from public.config_audit where table_name = 'map_node_branches';

    -- ── (b) the same facility twice under ONE organization is refused ──
    begin
      insert into public.map_node_branches (node_id, facility_id)
        values (v_node, v_fac || '-3');
      v_dup := true;   -- wrongly succeeded; reported below
    exception when unique_violation then
      null;  -- 23505 from map_node_branches_facility_uidx, as intended
    end;

    -- …and case is not a way around it.
    begin
      insert into public.map_node_branches (node_id, facility_id)
        values (v_node, upper(v_fac || '-3'));
      v_dup := true;
    exception when unique_violation then
      null;
    end;

    -- ── (b) the same facility under a DIFFERENT organization IS allowed ──
    -- The index is scoped to the node on purpose: nothing here has seen the
    -- Master Status Report, and a workspace-wide constraint on a format nobody
    -- has looked at would refuse a legitimate import.
    begin
      insert into public.map_node_branches (node_id, facility_id)
        values (v_other, v_fac || '-3');
      v_cross := true;
    exception when unique_violation then
      null;  -- wrongly refused; reported below
    end;

    -- ── (c) org_id uniqueness, case-insensitive, and the blank refusal ──
    update public.map_nodes set org_id = v_org where id = v_node;

    begin
      update public.map_nodes set org_id = v_org where id = v_other;
      v_org_dup := true;
    exception when unique_violation then
      null;  -- 23505 from map_nodes_org_id_uidx, as intended
    end;

    begin
      update public.map_nodes set org_id = upper(v_org) where id = v_other;
      v_org_case := true;
    exception when unique_violation then
      null;
    end;

    begin
      update public.map_nodes set org_id = '   ' where id = v_other;
      v_org_blank := true;
    exception when check_violation then
      null;  -- 23514 from map_nodes_org_id_chk, as intended
    end;

    -- ── (d) org_id is inside map_nodes' EXISTING audit diff ──
    -- Not "an audit row exists" — 0019's probe 1 asserted that a row existed and
    -- never what it said. This reads the `after` image and checks the value.
    --
    -- The table is ALIASED and both jsonb columns are qualified. `before` and
    -- `after` are keywords that happen to be legal column names here (0002:293),
    -- and a bare `after ->> 'org_id'` is exactly the expression a future
    -- Postgres could stop parsing — in a probe, on somebody else's upgrade.
    select count(*) into v_org_audit
      from public.config_audit ca
     where ca.table_name = 'map_nodes' and ca.row_id = v_node and ca.action = 'update'
       and (ca.after ->> 'org_id') = v_org;

    -- ── (f) the cascade ──
    delete from public.map_nodes where id = v_node;

    select count(*) into v_after_del from public.map_node_branches where node_id = v_node;

    raise exception using errcode = 'OT029', message = 'probe rollback';
  exception
    when sqlstate 'OT029' then
      null;
  end;

  if v_count <> 7 then
    raise exception
      'NphiesCore 0029 FAILED: seven branches were inserted under one organization and % came back. One organization holding N facility IDs is the entire shape this table exists for; if it cannot hold seven it cannot describe a hospital group.',
      v_count;
  end if;

  if v_order is null
     or v_order[1] is distinct from (v_fac || '-1')
     or v_order[7] is distinct from (v_fac || '-7') then
    raise exception
      'NphiesCore 0029 FAILED: reading the branches back by sort_order did not return them in the order they were written. Got: %. The certificate prints this list in this order, so an order nobody controls is a document whose facilities are shuffled.',
      coalesce(v_order::text, '(null)');
  end if;

  if v_audit_b <> 7 then
    raise exception
      'NphiesCore 0029 FAILED: inserting seven branches wrote % config_audit rows, expected exactly 7. Fewer means map_node_branches_audit_trg is missing or not FOR EACH ROW, and "who added this facility ID" is unanswerable the day a certificate is rejected; more means something else is writing the row in the same statement.',
      v_audit_b;
  end if;

  if v_dup then
    raise exception
      'NphiesCore 0029 FAILED: the same facility ID was accepted twice under one organization. map_node_branches_facility_uidx is missing, is not unique, or is not lower(btrim(...)) — and a certificate then lists one building twice while a count of covered facilities is off by one with nothing on screen to explain it.';
  end if;

  if not v_cross then
    raise exception
      'NphiesCore 0029 FAILED: the same facility ID was REFUSED under a different organization. map_node_branches_facility_uidx must be scoped to (node_id, facility_id), not to facility_id alone: nothing in this repository has yet seen the NPHIES Master Status Report, and a workspace-wide constraint on a format nobody has looked at refuses a legitimate import at 3am with a sentence asserting a rule nobody agreed to.';
  end if;

  if v_org_dup or v_org_case then
    raise exception
      'NphiesCore 0029 FAILED: two organizations were allowed to claim the same NPHIES Organization ID (duplicate accepted: %, different case accepted: %). map_nodes_org_id_uidx is missing its UNIQUE, its lower(btrim(...)) or its scope — and one registered entity filed twice makes every certificate generated from this tree ambiguous about which row it describes.',
      v_org_dup, v_org_case;
  end if;

  if v_org_blank then
    raise exception
      'NphiesCore 0029 FAILED: a whitespace-only Organization ID was accepted. map_nodes_org_id_chk must btrim before measuring, or "not recorded" has two spellings — NULL and blank — and the number this feature is first asked for ("how many do we still not have an ID for") counts one of them and not the other.';
  end if;

  if v_org_audit < 1 then
    raise exception
      'NphiesCore 0029 FAILED: setting an org_id wrote no config_audit row carrying that value in its `after` image. org_id is supposed to ride 0023''s EXISTING map_nodes audit diff (0023:670) for free — that is the argument for putting it on map_nodes instead of a side table. If it does not, "who typed this Organization ID and what was there before" is unanswerable, which is the first question asked when a certificate comes back rejected.';
  end if;

  if v_after_del <> 0 then
    raise exception
      'NphiesCore 0029 FAILED: deleting an organization left % of its branch rows behind. node_id must be ON DELETE CASCADE — "some deleted organization had a facility called X" is not a fact worth keeping (0024:333). ⚠ The other half of this is a CLIENT change and is not asserted here: 0023''s node delete guard counts children and entries, NOT branches, so getMapNodeUsage() must count them or the confirmation dialog destroys facility IDs without mentioning them.',
      v_after_del;
  end if;

  raise notice
    'NphiesCore 0029 probe 2: one organization held 7 ordered branches reading back in sort_order, seven inserts wrote exactly 7 config_audit rows, a duplicate facility ID under the same organization was refused in both cases (exact and upper-cased) while the same ID under a different organization was accepted, a second organization could not claim the same Organization ID in either case and a whitespace-only one was refused, setting org_id wrote a map_nodes audit row whose after-image carries it, and deleting the organization cascaded all 7 branches away. All rolled back.';
end
$branches$;


-- ── probe 3: a member cannot write identity, a structure.edit holder can ────
-- The claim the permission half of this file rests on, and the one that cannot be
-- verified by reading it. Both directions fail differently and both are asserted:
--
--   * a member who CAN write branches is a member whose write will 42501 anyway
--     the moment log_config_audit()'s guard sees them (0025:1858) — the policy and
--     the audit trigger have to agree or the table is broken for that person in a
--     way that reads as a bug in something else;
--   * a member who CANNOT READ branches sees an organization panel claiming zero
--     facilities, which is worse than a panel with no branch section.
--
-- The Director arm doubles as the check on log_config_audit() itself: a
-- structure.edit holder who is NOT an admin must be able to insert a branch AND
-- set an org_id, and both of those writes go through an audit trigger into that
-- guard. If the guard ever narrows back to is_admin(), THIS is where it shows up
-- — as a 42501 on a legitimate save, blamed on the wrong thing.
--
-- The skip test is SCOPED TO THE ROLE SWITCH ALONE, and that scoping is the point
-- (0018:559 learned it the expensive way): a broken INSERT policy raises 42501
-- too, and wrapping the whole client half would report it as "skipped" — a green
-- migration with a Director who cannot record a facility ID.
do $rls$
declare
  v_dir          uuid := gen_random_uuid();
  v_member       uuid := gen_random_uuid();
  v_dir_role     uuid;
  v_track        uuid;
  v_node         uuid;
  v_branch       uuid;
  v_fac          text := '0029-RLS-' || left(gen_random_uuid()::text, 8);
  v_read         int  := 0;
  v_branch_by    uuid;
  v_mem_wrote    boolean := false;
  v_mem_org      boolean := false;
  v_dir_insert   boolean := false;
  v_dir_update   boolean := false;
  v_dir_org      boolean := false;
  v_skipped      boolean := false;
  v_no_dir_role  boolean := false;
begin
  select id into v_track from public.tracks
   where archived = false order by sort_order, id limit 1;
  if v_track is null then
    raise exception 'NphiesCore 0029 FAILED: there is no unarchived track, so the RLS probe cannot run — and a permissions probe that does not run is a permissions probe that passes. Create (or unarchive) one track and re-run.';
  end if;

  -- The privileged fixture is found BY PERMISSION, not by role key: 0025's whole
  -- point is that the 'director' role can be renamed or replaced, and a probe
  -- pinned to the literal key turns that rename into a migration that refuses to
  -- re-apply. `not exists workspace.admin` is what makes the arm prove that THE
  -- KEY is enough rather than proving that an admin can do anything.
  select r.id into v_dir_role
    from public.roles r
    join public.role_permissions rp
      on rp.role_id = r.id and rp.permission_key = 'structure.edit' and rp.granted
   where not exists (
     select 1 from public.role_permissions rp2
      where rp2.role_id = r.id and rp2.permission_key = 'workspace.admin' and rp2.granted
   )
   order by r.sort_order, r.key
   limit 1;

  if v_dir_role is null then
    v_no_dir_role := true;
  end if;

  begin
    insert into auth.users (id, email, raw_user_meta_data) values
      (v_dir,    'probe-dir-'    || v_dir    || '@0029.invalid',
       jsonb_build_object('display_name', '0029 Probe Director')),
      (v_member, 'probe-member-' || v_member || '@0029.invalid',
       jsonb_build_object('display_name', '0029 Probe Member'));

    if (select count(*) from public.profiles where id in (v_dir, v_member)) <> 2 then
      raise exception 'NphiesCore 0029 PROBE 3 SETUP FAILED: handle_new_user() did not create the fixture profiles, so neither half of this probe has an actor to act as.';
    end if;

    -- No JWT yet, so guard_profile_role() lets this through: the privileged path
    -- the SQL Editor and the edge function use.
    if not v_no_dir_role then
      update public.profiles set role_id = v_dir_role where id = v_dir;
    end if;

    -- The fixture organization and ONE fixture branch, both written as the
    -- applying role (no JWT), because creating them is structure.edit's job and
    -- is this probe's instrument rather than its subject.
    --
    -- The branch is written with a NULL updated_by, and that null IS the
    -- instrument: when the Director renames it below, updated_by must come back
    -- as the Director. The touch trigger writes updated_by only on the arm where
    -- the diff actually saw a change, so a null coming back means the diff missed
    -- a real edit — the one failure the stamp/touch pair cannot be caught in any
    -- other way inside a single transaction, because now() does not move and
    -- every timestamp assertion is therefore vacuous.
    insert into public.map_nodes (track_id, name)
      values (v_track, '0029 RLS Probe ' || left(gen_random_uuid()::text, 8))
      returning id into v_node;

    insert into public.map_node_branches (node_id, facility_id, name, sort_order)
      values (v_node, v_fac, 'Seed branch', 1)
      returning id into v_branch;

    if (select updated_by from public.map_node_branches where id = v_branch) is not null then
      raise exception
        'NphiesCore 0029 PROBE 3 SETUP FAILED: a branch written with no JWT came back with an updated_by. The instrument this probe depends on is not null, so the assertion below would pass for the wrong reason.';
    end if;

    begin
      perform set_config('request.jwt.claims',
                         json_build_object('sub', v_dir, 'role', 'authenticated')::text, true);
      set local role authenticated;
    exception when insufficient_privilege then
      v_skipped := true;
    end;

    if not v_skipped then
      -- ── as the structure.edit holder ──
      if not v_no_dir_role then
        -- The controls that stop this arm passing because the fixture had no
        -- permissions rather than because the policy is right (0025's probe 5).
        if not public.has_perm('structure.edit') then
          raise exception
            'NphiesCore 0029 PROBE 3 SETUP FAILED: the fixture Director does not resolve to structure.edit, so nothing asserted below would mean anything.';
        end if;
        if public.is_admin() then
          raise exception
            'NphiesCore 0029 PROBE 3 SETUP FAILED: the fixture Director resolves to workspace.admin. The probe would then prove only that an admin can do anything.';
        end if;

        begin
          insert into public.map_node_branches (node_id, facility_id, name, sort_order)
            values (v_node, v_fac || '-D', 'Director branch', 2);
          v_dir_insert := true;
        exception when insufficient_privilege then
          null;  -- 42501, reported below
        end;

        -- The instrumented row: null updated_by in, the Director's id out.
        update public.map_node_branches set name = 'Renamed by the Director'
         where id = v_branch;
        if found then v_dir_update := true; end if;

        select updated_by into v_branch_by
          from public.map_node_branches where id = v_branch;

        -- The org_id half. This is a map_nodes write gated by 0025's policy, and
        -- it fires map_nodes_audit_trg into log_config_audit()'s guard — so it is
        -- also the assertion that catches that guard narrowing.
        update public.map_nodes set org_id = '0029-ORG-' || left(v_dir::text, 8)
         where id = v_node;
        if found then v_dir_org := true; end if;
      end if;

      -- ── as a plain member ──
      perform set_config('request.jwt.claims',
                         json_build_object('sub', v_member, 'role', 'authenticated')::text, true);

      select count(*) into v_read from public.map_node_branches where node_id = v_node;

      -- ⚠ THE NEGATIVE ARMS ARE UNCONDITIONAL AND TARGET v_branch, which was
      --   created by the applying role above and therefore exists whether or not
      --   a Director fixture could be built. Hanging them off `if v_dir_insert
      --   then` would mean that on a workspace where every structure.edit role
      --   also holds workspace.admin, NEITHER ran — and the notice below would
      --   still report that the member "could not write branches" without having
      --   tried. Had map_node_branches_update been copy-pasted as `is_member()`
      --   from 0024's scorecard block, this file would have shipped green with
      --   every member able to edit facility IDs on a document sent to a
      --   regulator.
      --
      --   `sort_order`, not `facility_id`: a write that WRONGLY succeeded must
      --   LAND rather than trip map_node_branches_facility_uidx, or the failure
      --   disguises itself as a duplicate-key error and `found` is never read.
      --   A blocked UPDATE/DELETE affects zero rows rather than raising, which is
      --   the whole reason src/lib/permissions.ts exists — count rows, do not
      --   catch.
      update public.map_node_branches set sort_order = sort_order + 1000 where id = v_branch;
      if found then v_mem_wrote := true; end if;

      delete from public.map_node_branches where id = v_branch;
      if found then v_mem_wrote := true; end if;

      -- A blocked INSERT DOES raise, so this one is caught.
      begin
        insert into public.map_node_branches (node_id, facility_id, sort_order)
          values (v_node, v_fac || '-M', 9);
        v_mem_wrote := true;
      exception when insufficient_privilege then
        null;  -- 42501, as intended
      end;

      -- …and identity on the node itself is closed to them too. This is 0025's
      -- policy rather than this file's, but org_id is this file's column and a
      -- member who can set it is a member who can rename a registered entity.
      update public.map_nodes set org_id = '0029-MEM-' || left(v_member::text, 8)
       where id = v_node;
      if found then v_mem_org := true; end if;

      reset role;
    end if;

    raise exception using errcode = 'OT029', message = 'probe rollback';
  exception
    when sqlstate 'OT029' then
      null;
  end;

  if v_skipped then
    raise notice
      'NphiesCore 0029 probe 3 SKIPPED: this role cannot `set role authenticated`, so the RLS half could not run. The policies ARE installed and probe 1 read all four predicates out of pg_policies. Verify by hand: sign in as a plain member and GET /rest/v1/map_node_branches (must return the rows), then PATCH one (must affect zero rows), POST one (must 42501), and PATCH /rest/v1/map_nodes?id=eq.<node> with an org_id (must affect zero rows); then sign in as a Director and repeat — all four must succeed.';
    return;
  end if;

  if v_read < 1 then
    raise exception
      'NphiesCore 0029 FAILED: a plain member read % branch rows for an organization that has one. map_node_branches_select is too strict — an account manager opening an organization would see a panel claiming zero facilities, which is a wrong answer rather than a missing one, and nothing on screen would explain it.',
      v_read;
  end if;

  if v_mem_wrote then
    raise exception
      'NphiesCore 0029 FAILED: a plain member created, edited or deleted a branch. These write policies must be gated on has_perm(''structure.edit''), and not only for the obvious reason: this table is AUDITED, so a member write also goes through log_config_audit()''s guard (0025:1858), which raises 42501 for anyone holding none of the four configuration keys — the member''s legitimate-looking write would then roll back with a permission error blamed on the wrong thing. Audited and member-writable is not a trade-off, it is a table that does not work.';
  end if;

  if v_mem_org then
    raise exception
      'NphiesCore 0029 FAILED: a plain member set an org_id on a map_nodes row. map_nodes'' write policies are 0025''s and are supposed to be has_perm(''structure.edit'') (0025:752) — if this fired, either they have been widened or 0023/0024 was re-run after 0025 and restored the dead is_admin() text. A member who can type an Organization ID can rename which registered entity a certificate describes.';
  end if;

  if v_no_dir_role then
    raise notice
      'NphiesCore 0029 probe 3 PARTIAL: a member could read the branches and could not create, edit or delete one, and could not set an org_id — but this workspace has no role holding structure.edit WITHOUT workspace.admin, so the Director half could not be exercised. Verify by hand after granting one.';
    return;
  end if;

  if not v_dir_insert then
    raise exception
      'NphiesCore 0029 FAILED: a structure.edit holder who is NOT an admin could not insert a branch. Either map_node_branches_insert checks the wrong thing, or log_config_audit()''s guard (0025:1858) has narrowed back to is_admin() and is refusing the audit row for a legitimate edit — the second one 42501s on the write and blames the wrong thing entirely.';
  end if;

  if not v_dir_update then
    raise exception
      'NphiesCore 0029 FAILED: a structure.edit holder could not UPDATE a branch. Correcting a facility ID that was typed wrong is the second commonest thing that will ever happen to this table.';
  end if;

  if not v_dir_org then
    raise exception
      'NphiesCore 0029 FAILED: a structure.edit holder could not set map_nodes.org_id. That write is gated by 0025''s map_nodes_update policy and fires map_nodes_audit_trg into log_config_audit() — so either the policy has moved off structure.edit, or the audit guard has narrowed and is refusing the trail row for a legitimate save.';
  end if;

  -- The one assertion in this file that catches a touch diff that stopped
  -- reacting to a real edit. updated_by was null before the Director's rename and
  -- the diff's change arm is the only code that fills it.
  if v_branch_by is distinct from v_dir then
    raise exception
      'NphiesCore 0029 FAILED: after a structure.edit holder renamed a branch, updated_by is % and not the Director (%). Either map_node_branches_touch()''s diff no longer sees the change — in which case updated_at stops moving on real edits and the audit trigger, which compares full images, stops recording them — or updated_by has stopped being resolved through profiles from auth.uid() and is whatever the client sent.',
      coalesce(v_branch_by::text, 'null'), v_dir;
  end if;

  raise notice
    'NphiesCore 0029 probe 3: a structure.edit holder who is not an admin inserted a branch, renamed one with updated_by resolving to themselves, and set an org_id with the audit rows landing; a plain member read the branches (%) and could neither insert, reposition nor delete one, nor set an org_id on the node. Fixtures rolled back.',
    v_read;
end
$rls$;


-- ── probe 4: re-saving a branch unchanged is a complete no-op ───────────────
-- The property the audit trigger's honesty rests on. A re-save that carries
-- deliberately wrong values for the two columns the diff SUBTRACTS — updated_at
-- and updated_by, the pair the else arm is responsible for — must leave the row
-- BYTE-IDENTICAL and must write no second config_audit row.
--
-- This is not hypothetical traffic. Every store that holds the row it read and
-- saves it back on blur sends `updated_at` with it, because `updated_at` is in
-- the row it read; the 30-second focus refetch means it holds a fresh one all
-- day. Without the else arm pinning both columns in map_node_branches_touch(),
-- the diff (which subtracts updated_at) is false, the `if` body is skipped, the
-- client's timestamp lands on the row — and the audit trigger, which compares the
-- FULL images, then writes a config_audit row whose before and after differ in
-- one bookkeeping column. The trail fills with rows recording that nothing
-- happened, which is how an audit log stops being read (0018:217).
--
-- Compared as whole-row `to_jsonb`, so a column added to this table by a later
-- migration is covered by this assertion for free.
do $noop$
declare
  v_track   uuid;
  v_node    uuid;
  v_branch  uuid;
  v_actor   uuid;
  v_fac     text := '0029-NOP-' || left(gen_random_uuid()::text, 8);
  v_before  jsonb;
  v_after   jsonb;
  v_audit0  int;
  v_audit   int := -1;
  v_bogus   timestamptz := timestamptz '2001-09-09 01:46:40+00';
  v_planted boolean := true;
begin
  select id into v_track from public.tracks
   where archived = false order by sort_order, id limit 1;
  if v_track is null then
    raise exception 'NphiesCore 0029 FAILED: there is no unarchived track, so the no-op probe has nowhere to hang a fixture organization. Create (or unarchive) one track and re-run.';
  end if;

  select count(*) into v_audit0 from public.config_audit where table_name = 'map_node_branches';

  -- Any real profile will do. It is planted as updated_by so that the no-op's
  -- attempt to write null over it has something to destroy: with a null already
  -- there, "null in, null out" would pass whether or not the else arm pinned it.
  select id into v_actor from public.profiles order by id limit 1;

  -- REFUSED BY NAME when the fixture cannot be built, the way the unarchived
  -- track is above it. `v_planted` starts true and an earlier cut only cleared it
  -- inside `if v_actor is not null and …` — so on a database with no profile rows
  -- the plant was NULL, the SETUP-FAILED refusal below never fired, and the probe
  -- inserted null, re-saved null and got null back. The `new.updated_by :=
  -- old.updated_by;` line this probe exists to protect could have been DELETED
  -- and the notice would still have printed "left the row byte-identical". The
  -- updated_at half stayed honest (v_bogus is never null), so the hole was silent
  -- and partial rather than total, which is the worst shape for it to have.
  if v_actor is null then
    raise exception
      'NphiesCore 0029 FAILED: there are no rows in public.profiles, so probe 4 cannot plant an updated_by — and without the plant, the assertion that the else arm pins updated_by passes whether or not the line is there. Create one profile (provision one member) and re-run.';
  end if;

  begin
    insert into public.map_nodes (track_id, name)
      values (v_track, '0029 No-op Probe ' || left(gen_random_uuid()::text, 8))
      returning id into v_node;

    -- No JWT here (the applying role), so map_node_branches_stamp() returns NEW
    -- untouched and the planted updated_by survives — which is the passthrough
    -- the SQL Editor, the service role and the importer all rely on.
    insert into public.map_node_branches (node_id, facility_id, name, sort_order, updated_by)
      values (v_node, v_fac, 'No-op branch', 4, v_actor)
      returning id into v_branch;

    if (select updated_by from public.map_node_branches where id = v_branch) is distinct from v_actor then
      v_planted := false;
    end if;

    select to_jsonb(b) into v_before from public.map_node_branches b where b.id = v_branch;

    -- Every column re-saved as exactly what it already is — AND a bogus
    -- updated_at and a null updated_by riding along, which is the shape of every
    -- blur-save that echoes back the row it read.
    --
    -- ⚠ THE TWO WRONG VALUES ARE DELIBERATELY BOTH COLUMNS THE DIFF SUBTRACTS,
    --   and that is what makes this probe test the ELSE arm rather than the
    --   change arm. Send a bogus `created_at` here as well and the subtraction no
    --   longer hides it: the diff becomes TRUE, the change arm runs, `created_at`
    --   is pinned back by the unconditional line after it, and the row still
    --   comes back byte-identical — a green probe that never once executed the
    --   two lines it exists to protect. The `created_at`/`created_by` pins are
    --   unconditional and hold on both arms; they are not what is under test
    --   here.
    update public.map_node_branches
       set facility_id = v_fac,
           name        = 'No-op branch',
           sort_order  = 4,
           updated_at  = v_bogus,
           updated_by  = null
     where id = v_branch;

    select to_jsonb(b) into v_after from public.map_node_branches b where b.id = v_branch;

    select count(*) - v_audit0 into v_audit
      from public.config_audit where table_name = 'map_node_branches';

    raise exception using errcode = 'OT029', message = 'probe rollback';
  exception
    when sqlstate 'OT029' then
      null;
  end;

  if not v_planted then
    raise exception
      'NphiesCore 0029 PROBE 4 SETUP FAILED: a JWT-less insert did not preserve the updated_by it was given. The SQL Editor, the service role and the CSV importer all write that way and none of them can be attributed to a person — and without the plant, this probe''s "the client''s null did not survive" assertion would pass vacuously.';
  end if;

  if v_after is distinct from v_before then
    raise exception
      'NphiesCore 0029 FAILED: re-saving a branch unchanged — with a bogus updated_at and a null updated_by riding along, which is what a store sends back the row it read — changed the row. Before: %. After: %. map_node_branches_touch() is not pinning BOTH columns in its else arm (0024''s version pins only updated_by; 0026:453 argued the other half and this file is the third table agreeing). A client can then date any facility ID''s last edit to any time it likes and erase who last corrected it, and — because the audit trigger compares the FULL images — the trail gets a row for a change that never happened.',
      v_before, v_after;
  end if;

  -- Exactly 1: the INSERT above. The re-save must have added nothing.
  if v_audit <> 1 then
    raise exception
      'NphiesCore 0029 FAILED: creating a branch and then re-saving it unchanged wrote % config_audit rows, expected exactly 1 (the insert). Either the touch diff or the audit trigger''s comparison is firing unconditionally — and a 30-second focus refetch on a screen that saves on blur would then bury the one row that says "somebody changed a facility ID" under a hundred rows recording that nothing happened.',
      v_audit;
  end if;

  raise notice
    'NphiesCore 0029 probe 4: re-saving a branch with every value it already held — plus a bogus updated_at and a null updated_by over a planted author — left the row byte-identical and wrote no second config_audit row. Rolled back.';
end
$noop$;


-- ── probe 5: the authorship pins refuse a client and YIELD TO THE FOREIGN KEY ─
-- FIX-BACKLOG R2-DB-1 on this table, asserted in BOTH directions — because a pin
-- that only goes one way is either a hole (a client rewrites authorship) or a
-- dangling foreign key (the FK's own null-out is written straight back over), and
-- the two failures look nothing alike:
--
--   HALF A — THE PIN STILL REFUSES A CLIENT. While the author's profile exists, a
--     PATCH carrying {"created_by": null, "updated_by": null} must leave both
--     columns exactly where they were. That is the property 0015:206 protects,
--     and it is the half a careless reading of the `case` expression deletes.
--
--   HALF B — THE FOREIGN KEY'S OWN ACTION GETS THROUGH. Deleting a profile makes
--     Postgres issue `update public.map_node_branches set created_by = null where
--     created_by = $1` (and the same for updated_by) as a referential action, and
--     that UPDATE fires map_node_branches_touch() like any other. Pinned flat,
--     the trigger writes the dead uuid back; the old and new key values then
--     compare equal, RI_FKey_fk_upd_check_required skips the re-check, and the
--     row keeps a reference to a profile that no longer exists — with the
--     constraint still reporting itself validated and nothing to notice it until
--     a pg_dump reload refuses the table. The live path is deleteMember()
--     (src/api/members.ts) → auth.users → profiles cascade → here.
--
-- ⚠ WHAT THIS PROBE DELIBERATELY DOES **NOT** ASSERT: `alter table … validate
--   constraint map_node_branches_created_by_fkey`. Both FKs are created already
--   validated, and ALTER TABLE … VALIDATE CONSTRAINT returns immediately when
--   `convalidated` is already true — it never scans a row, so it would report
--   success against a table full of dangling references. It is precisely the
--   vacuous assertion this section opens by refusing. The two columns are read
--   back instead, which is the thing that is actually observable.
--
-- The fixture author is created here rather than borrowed from the workspace,
-- for the obvious reason: this probe DELETES it. Everything, the auth.users row
-- included, rolls back through OT029.
do $authorship$
declare
  v_track    uuid;
  v_node     uuid;
  v_branch   uuid;
  v_actor    uuid := gen_random_uuid();
  v_fac      text := '0029-aut-' || left(gen_random_uuid()::text, 8);
  v_pin_c    uuid;
  v_pin_u    uuid;
  v_after_c  uuid;
  v_after_u  uuid;
  v_authored boolean := false;
begin
  select id into v_track from public.tracks
   where archived = false order by sort_order, id limit 1;
  if v_track is null then
    raise exception 'NphiesCore 0029 FAILED: there is no unarchived track, so the authorship probe has nowhere to hang a fixture organization and both halves below would pass without running. Create (or unarchive) one track and re-run.';
  end if;

  begin
    insert into auth.users (id, email, raw_user_meta_data) values
      (v_actor, 'probe-author-' || v_actor || '@0029.invalid',
       jsonb_build_object('display_name', '0029 Probe Author'));

    if not exists (select 1 from public.profiles where id = v_actor) then
      raise exception
        'NphiesCore 0029 PROBE 5 SETUP FAILED: handle_new_user() did not create the fixture profile, so there is no author to attribute a branch to, no client attempt to refuse, and nothing to delete.';
    end if;

    insert into public.map_nodes (track_id, name)
      values (v_track, '0029 Authorship Probe ' || left(gen_random_uuid()::text, 8))
      returning id into v_node;

    -- No JWT (the applying role), so map_node_branches_stamp() returns NEW
    -- untouched and both authorship columns are exactly what is written here —
    -- the same passthrough probe 4 leans on.
    insert into public.map_node_branches
      (node_id, facility_id, name, sort_order, created_by, updated_by)
      values (v_node, v_fac, 'Authored branch', 1, v_actor, v_actor)
      returning id into v_branch;

    select (created_by is not distinct from v_actor and updated_by is not distinct from v_actor)
      into v_authored
      from public.map_node_branches where id = v_branch;

    -- ── HALF A: the author is ALIVE, so the client's nulls are refused ──
    -- `name` moves as well, deliberately: it puts the write on the diff's CHANGE
    -- arm, which is where updated_by is resolved rather than pinned. The else arm
    -- is probe 4's subject; this is the other one.
    update public.map_node_branches
       set created_by = null,
           updated_by = null,
           name       = 'Renamed, not re-attributed'
     where id = v_branch;

    select created_by, updated_by into v_pin_c, v_pin_u
      from public.map_node_branches where id = v_branch;

    -- ── HALF B: the author is DELETED, so the FK's own nulls must get through ──
    delete from public.profiles where id = v_actor;

    select created_by, updated_by into v_after_c, v_after_u
      from public.map_node_branches where id = v_branch;

    raise exception using errcode = 'OT029', message = 'probe rollback';
  exception
    when sqlstate 'OT029' then
      null;
  end;

  if not v_authored then
    raise exception
      'NphiesCore 0029 PROBE 5 SETUP FAILED: a JWT-less insert did not keep the created_by and updated_by it was handed, so the fixture row never had an author — and both assertions below would then be comparing two nulls and passing for the wrong reason.';
  end if;

  if v_pin_c is distinct from v_actor or v_pin_u is distinct from v_actor then
    raise exception
      'NphiesCore 0029 FAILED: a PATCH carrying {"created_by": null, "updated_by": null} erased the authorship of a branch whose author still exists — created_by came back %, updated_by came back %, both should be %. created_by/updated_by are SERVER TRUTH about the write (0015:330) and no client may set them: this is the table whose whole purpose is answering "who typed this facility ID", and a one-line PATCH that blanks the answer makes every later question about a rejected certificate unanswerable.',
      coalesce(v_pin_c::text, 'null'), coalesce(v_pin_u::text, 'null'), v_actor;
  end if;

  if v_after_c is not null or v_after_u is not null then
    raise exception
      'NphiesCore 0029 FAILED: deleting the profile that authored a branch left created_by = % and updated_by = % on the row, and both must be NULL. map_node_branches_touch() is pinning them FLAT and is therefore writing a dead uuid back over the `on delete set null` UPDATE that Postgres itself issued — after which the old and new key values compare equal, RI_FKey_fk_upd_check_required skips the re-check, and map_node_branches keeps a reference to a profile that no longer exists while the constraint still reports itself as validated. Nothing detects it until a dump/restore refuses the table, every "who typed this facility ID" join returns no row while the column is non-null, and the live path is one admin removing one colleague (deleteMember → auth.users → profiles cascade). Accept a NULL only when the referent is GONE — 0015:206 and 0019:276, which is the same defect found live on entries.',
      coalesce(v_after_c::text, 'null'), coalesce(v_after_u::text, 'null');
  end if;

  raise notice
    'NphiesCore 0029 probe 5: a client PATCH nulling created_by and updated_by on a branch whose author is alive was refused and both came back as the author; deleting that author then let the foreign keys'' own ON DELETE SET NULL through, and the row came back with created_by and updated_by NULL rather than pointing at a profile that no longer exists. Fixtures, the auth.users row included, rolled back.';
end
$authorship$;
