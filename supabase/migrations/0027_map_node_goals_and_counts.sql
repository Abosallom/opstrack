-- 0027 — goals against a node, and the first server-side aggregate on the map.
--
-- WHAT THIS IS
-- 0026 gave the map a stage ladder and a member-writable place to record where
-- an organization has got to. This file adds the other half of the same
-- sentence — where it is SUPPOSED to have got to, and by when —
--
--   1. `map_node_goals`: "40 organizations beneath this Phase are Live by
--      31 Dec". A commitment about a department, written by the two ADs.
--   2. `v_map_node_open_counts`: the first aggregate VIEW in the schema, so the
--      numbers an executive reads stop being computed from a client-side working
--      set that PostgREST silently clamped at 1,000 rows.
--
-- Nothing here is member-writable and nothing here is on the boot path. Goals
-- are a handful of rows; the view is opened by a portfolio surface on demand.
--
--
-- ═══ THE PERMISSION SENTENCE, AND WHY THIS FILE SITS ON THE OTHER SIDE OF IT ═══
--
--   Shape and commitments are the owner's; where-we-got-to is the team's.
--
-- 0026 put the STAGE of a node on `map_node_progress`, member-writable, because
-- the three account managers are plain members and recording progress is
-- day-to-day fieldwork (`map_node_use_cases`' precedent, 0024:544). A GOAL is
-- the opposite kind of fact: it is a promise made about a department by the
-- people who own the programme shape, and it is exactly what `config_audit`
-- exists to remember. So `map_node_goals` writes are gated on
-- `has_perm('structure.edit')` — the Directors — and it DOES carry an audit
-- trigger, where `map_node_progress` deliberately does not.
--
-- "Who moved the date" is the question this table will be asked, and the audit
-- row is the only thing that can answer it.
--
-- ⚠ No new permission key. `structure.edit` already exists (0025) and 0025's
--   probe 1 refuses the migration if Admin holds fewer than five keys — a sixth
--   key would turn that count into a coded value to edit inside an applied file.
--
--
-- ═══ A TABLE, NOT TWO COLUMNS ON `map_nodes` ═══
--
-- `map_nodes.target_date` + `map_nodes.target` is the tempting answer and it is
-- wrong on three counts:
--
--   1. "40 orgs live by 31 Dec AND 15 by 30 Sep" is what a rollout plan IS — a
--      phased ramp. Two columns cannot hold it, and the fix later is this table
--      plus a data migration against live rows.
--   2. Every column on `map_nodes` is paid 400 times to be used about six times:
--      it widens `to_jsonb(new)` in the touch and audit diffs, widens the cached
--      localStorage blob, and widens the importer's fixed-column boundary. Goals
--      are low-cardinality — a handful of Phases carry one.
--   3. `map_nodes` already carries a deferred tree trigger whose diffs walk every
--      column. Adding two more is not free there.
--
--
-- ═══ ONE ROW SHAPE ANSWERS ALL THREE PHRASINGS — AND ADDS ZERO CODED VALUES ═══
--
-- THE CRITICAL DESIGN MOVE, reproduced here because a reviewer will look for the
-- `metric` column and has to find the argument instead: there is no `metric`
-- column and no `check (metric in (…))`. A vocabulary column here would be a
-- sixth frozen union. `stage_id` does the job, because the stage list is already
-- configurable:
--
--   stage_id      target   reads as
--   ───────────── ──────── ─────────────────────────────────────────────────────
--   null          null     "this node reaches a TERMINAL stage by target_date"
--                          — the per-org go-live date, the commonest goal at 400
--                          organizations
--   null          40       "40 organizations beneath this node are at a terminal
--                          stage by target_date" — target counts
--   Go-live ready 40       "40 organizations beneath this node are at Go-live
--                          ready OR BEYOND by target_date"
--   Testing/UAT   null     "this node reaches Testing/UAT or beyond by
--                          target_date"
--
-- "Or beyond" means `stage.sort_order >= the goal stage's sort_order`, which
-- couples goal meaning to the ladder's ORDER. ⚠ REORDERING THE STAGE LIST
-- RESTATES EVERY COUNT-FORM GOAL. That sentence lives in
-- `reorder_map_node_stages`' own comment (0026) and in the admin screen's
-- confirm; it is repeated here because this is the table it restates.
--
--
-- ═══ NO UNIQUENESS, AND IT IS A DECISION ═══
--
-- There is no unique index on (node_id, target_date), on (node_id, stage_id), or
-- on any combination. Two goals with the same date and different stages is legal
-- AND MEANINGFUL — "15 at Testing/UAT and 40 at Live, both by 31 Dec" is one
-- ramp described at two altitudes. A unique index here would refuse the second
-- half of a plan somebody actually has. Probe 1 asserts the ABSENCE of the
-- index, because "add a unique constraint" is the single most likely well-meant
-- edit to this table.
--
--
-- ═══ THE BOUNDARY RULE FOR `v_map_node_open_counts` ═══
--
--   A NUMBER A HUMAN READS AS A FACT COMES FROM THE SERVER AGGREGATE.
--   A SIZE A HUMAN READS AS A SHAPE COMES FROM THE WORKING SET.
--
-- This is a written rule and not a preference. Past 1,000 open entries the
-- client's working set is truncated by PostgREST's clamp, and every count folded
-- from it is silently low — a correct-looking wrong number in front of an
-- executive, which is the worst failure this system can produce.
--
-- So: the panel's "12 open · 3 overdue" reads THIS VIEW. The canvas's
-- size-encoding keeps reading the (truncated, flagged) working set, because a
-- 10% error is invisible at grain size and the truncation banner is on screen.
-- Without the rule there are two arithmetics for one question that disagree
-- under exactly the conditions nobody tests.
--
-- DIRECT COUNTS, NOT ROLLED UP. The server does the expensive join over
-- thousands of entries; the client rolls up over ~400 nodes in the O(n) pass it
-- already runs. One row per node, one read.
--
-- ⚠ `security_invoker = true` IS NOT OPTIONAL AND IS THE ONE THING A REVIEWER
--   MUST CHECK. A Postgres view runs with its OWNER's privileges by default and
--   RLS on the base tables is NOT applied — the default silently exposes every
--   entry in the workspace to every reader regardless of `entries_select`. The
--   difference between an aggregate and a data leak is one reloption, so probe 1
--   reads it back out of `pg_class.reloptions` and probe 3 proves the invoker
--   path is live rather than decorative by having a NON-MEMBER read zero rows.
--
--   `v_entry_health` is itself a `security_invoker` view (0006:257), so the two
--   stack: RLS is applied once, at `entries`, and the join cannot widen it.
--
--
-- ═══ THIS FILE REDEFINES NOTHING ═══
--
-- It adds one table, four triggers of its own, and one view. It does NOT restate
-- `map_nodes_touch()`, `map_nodes_audit()`, `is_admin()`, `has_perm()`,
-- `log_config_audit()`, `v_entry_health`, or any policy 0023/0024/0025 owns. So
-- 0025's probe 5 half A stays green and the `w_0025` / `f_0025` reversion canary
-- is unaffected — which is exactly what makes "never re-run 0023/0024/0025" a
-- rule the build can keep. If you find yourself adding a `create or replace` for
-- a function named in that list, stop: it belongs in its own file, last.
--
--
-- ═══ THE TOKEN CONTRACT WITH src/lib/pgError.ts ═══
--
-- Every `raise` in this file's guard carries a `token:` prefix, and the TOKEN —
-- not the SQLSTATE — is what pgError.ts matches to an i18n key. Renaming one
-- here silently demotes a precise sentence to the generic `common.error`, so
-- this list is the handshake and both files have to be edited together:
--
--   map_node_goal_target        a target that is present and not positive.
--                               "40 organizations live" is a count; 0 and -3 are
--                               not goals, they are typos, and a goal of 0 would
--                               read as permanently met.
--   map_node_goal_node_missing  a goal pointed at a node that does not exist —
--                               a stale tab saving against a branch a colleague
--                               deleted while it was open.
--
-- Plus the constraint names pgError.ts may match directly, which is why they
-- must not be renamed casually either:
--
--   map_node_goals_target_chk       the 23514 backstop under the token above
--   map_node_goals_label_len_chk    → mapadmin.errGoalLabelLength
--   map_node_goals_label_ar_len_chk → mapadmin.errGoalLabelArLength
--   map_node_goals_node_id_fkey     23503, node vanished between check and write
--   map_node_goals_stage_id_fkey    23503, stage vanished likewise
--
-- ⚠ THE TWO LABEL CONSTRAINTS ARE NOT OPTIONAL ARMS, and the reason is that
--   there is NO TOKEN behind them: a label over 60 characters is refused by the
--   CHECK itself, so what reaches the AD is a bare
--   `23514 … violates check constraint "map_node_goals_label_ar_len_chk"` —
--   an identifier they have never heard of, in a fully-Arabic RTL layout, on a
--   form with TWO label fields, and nothing on screen says which one is wrong.
--   That is the exact failure this whole token section exists to prevent, so the
--   arms are required and they must be two, not one.
--
--   THE NUMBER IS 60 AND THE CLIENT MUST ENFORCE IT FIRST: the goal editor gains
--   `GOAL_LABEL_MAX = 60` (0026's STAGE_NAME_MAX = 40 has the same contract with
--   the stages screen) as a maxlength on both fields, and the two must agree. A
--   goal label is normally typed; it goes over 60 when somebody PASTES a phrase
--   out of a planning deck, which is a thing ADs do.
--
-- The SQLSTATEs are the natural ones: 23514 for the target and the labels,
-- P0002 for a vanished row. They are NOT flattened onto one code.
--
--
-- Deploy: Supabase Dashboard → SQL Editor → paste + Run, AFTER 0026. Re-runnable
-- from the top in any partial state, same discipline as 0001–0026: `create table
-- if not exists`, `add column if not exists` per column, `drop constraint if
-- exists` before every add, `drop policy if exists` before every create, `drop
-- trigger if exists` before every create, `create or replace` on every function,
-- and probe blocks at the bottom that roll themselves back through a sentinel.
-- A probe failure raises and the whole migration rolls back — no explicit
-- begin/commit here, for the reason 0009's header spells out.
--
-- APPLY IT TWICE. The second run must be a no-op that still passes every probe;
-- that is what makes "apply it twice" a real test rather than a formality
-- (0018:356).


-- ── preflight: 0026 first ───────────────────────────────────────────────────
-- `map_node_goals.stage_id` references `public.map_node_stages`, which 0026
-- creates. Without this block the first failure is a bare 42P01 from the middle
-- of a CREATE TABLE, which reads like a broken file rather than a missing
-- prerequisite. 0024:99 makes the same call for the same reason.
--
-- `map_nodes` is checked too rather than assumed transitively: a database where
-- 0026 landed but 0023 was somehow rolled back is not a database this file
-- should half-apply to.
do $preflight$
begin
  if to_regclass('public.map_nodes') is null then
    raise exception
      'NphiesCore 0027 CANNOT APPLY: public.map_nodes does not exist. Apply 0023_map_nodes.sql first.';
  end if;

  if to_regclass('public.map_node_stages') is null then
    raise exception
      'NphiesCore 0027 CANNOT APPLY: public.map_node_stages does not exist. Apply 0026_map_node_stages.sql first — every goal in this file may name a stage, and the stage ladder is what "or beyond" is measured against.';
  end if;

  if to_regclass('public.v_entry_health') is null then
    raise exception
      'NphiesCore 0027 CANNOT APPLY: public.v_entry_health does not exist. It is 0001''s view, rewritten by 0003 and 0006, and v_map_node_open_counts reads overdue and SLA breach from it rather than recomputing either.';
  end if;

  -- 0025, checked by the FUNCTION rather than by a table, because that is what
  -- this file uses: every write policy below is `has_perm('structure.edit')`.
  -- Without it the first failure is a 42883 from inside a CREATE POLICY, which
  -- reads like a typo in a predicate rather than "the permissions migration has
  -- not been applied here".
  if to_regprocedure('public.has_perm(text)') is null then
    raise exception
      'NphiesCore 0027 CANNOT APPLY: public.has_perm(text) does not exist. Apply 0025_roles_permissions.sql first — goals are gated on has_perm(''structure.edit''), and this file adds NO new permission key precisely so 0025 never has to be re-run.';
  end if;
end
$preflight$;


-- ── map_node_goals ──────────────────────────────────────────────────────────
create table if not exists public.map_node_goals (
  id          uuid primary key default gen_random_uuid(),
  -- CASCADE, and it is `map_node_use_cases.node_id`'s reasoning verbatim: "a
  -- goal for a deleted organization" is not a fact worth keeping. In practice
  -- this rarely fires — 0023's delete guard refuses to delete a node that still
  -- has work under it — so the cascade is the tidy-up for a leaf, not a way to
  -- lose a plan.
  node_id     uuid not null references public.map_nodes (id) on delete cascade,
  -- "Phase 2 go-live". OPTIONAL: '' means unnamed, and an unnamed goal is a
  -- perfectly good goal — the date and the target say what it is. Empty string
  -- rather than null for `map_nodes.vendor`'s reason (0023:359): a three-state
  -- string/null/'' is a bug waiting for the first filter.
  label       text not null default '',
  label_ar    text not null default '',
  -- NULLABLE, AND THIS ONE FK CARRIES THE WHOLE GENERALISATION. See the table in
  -- the header. `on delete set null` matches `map_nodes.kind_id` (0023:136) and
  -- `map_node_progress.stage_id` (0026): retiring a stage must not delete
  -- somebody's commitment, and a goal whose stage went away falls back to the
  -- terminal reading, which is the reading it would have had if nobody had
  -- narrowed it. `restrict` would make retiring a stage impossible for as long
  -- as one goal in the workspace mentioned it.
  stage_id    uuid references public.map_node_stages (id) on delete set null,
  -- NULL = a pure date goal ("this node is there by D"). A number = a count of
  -- descendants. There is no zero: see map_node_goal_target in the header.
  target      int,
  -- THE COMMITMENT. `date`, not `timestamptz`: a go-live date is a calendar day
  -- somebody said out loud in a meeting, and giving it a time zone would make
  -- "31 Dec" render as 30 Dec for a reader in the wrong offset.
  target_date date not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.profiles (id) on delete set null,
  updated_by  uuid references public.profiles (id) on delete set null
);

comment on table public.map_node_goals is
  'Commitments about a node: "40 organizations beneath this Phase are Live by 31 Dec". One row shape covers date-only, count and stage-qualified goals through a NULLABLE stage_id and a NULLABLE target — there is deliberately no `metric` column and no frozen vocabulary. Written by structure.edit (the ADs), audited in config_audit, and NOT unique on anything: two goals with one date and two stages describe one ramp at two altitudes.';

comment on column public.map_node_goals.stage_id is
  'NULL means "a terminal stage" — the default reading and the commonest goal. A value means "this stage OR BEYOND", where beyond is map_node_stages.sort_order >= this stage''s. Reordering the stage ladder therefore restates every count-form goal; reorder_map_node_stages says so in its own comment.';

comment on column public.map_node_goals.target is
  'NULL = a pure date goal about this node itself. A positive integer = a count of DESCENDANTS at or beyond stage_id. Never 0 — a goal of zero reads as permanently met, so it is refused with the map_node_goal_target token rather than stored.';

comment on column public.map_node_goals.target_date is
  'The calendar day the commitment names. `date`, not `timestamptz`: a go-live date has no time zone and giving it one makes 31 Dec render as 30 Dec for somebody.';

-- For a project where an earlier cut of this file already landed: `create table
-- if not exists` above is a no-op there, so the columns have to be added
-- separately or the constraints below fail against a table that lacks them.
-- Same reasoning as 0017:129, 0018:136-139 and 0024:140-143.
alter table public.map_node_goals add column if not exists node_id     uuid references public.map_nodes (id) on delete cascade;
alter table public.map_node_goals add column if not exists label       text not null default '';
alter table public.map_node_goals add column if not exists label_ar    text not null default '';
alter table public.map_node_goals add column if not exists stage_id    uuid references public.map_node_stages (id) on delete set null;
alter table public.map_node_goals add column if not exists target      int;
alter table public.map_node_goals add column if not exists target_date date;
alter table public.map_node_goals add column if not exists created_at  timestamptz not null default now();
alter table public.map_node_goals add column if not exists updated_at  timestamptz not null default now();
alter table public.map_node_goals add column if not exists created_by  uuid references public.profiles (id) on delete set null;
alter table public.map_node_goals add column if not exists updated_by  uuid references public.profiles (id) on delete set null;

-- `add column if not exists … not null` cannot be written for a column with no
-- default, so the two NOT NULLs are applied separately and idempotently. On a
-- healthy table this is a no-op; on a table an earlier partial cut left holding
-- nulls it FAILS LOUDLY, which is the correct outcome — a goal with no node or
-- no date is not a goal, and silently keeping it would put a row in front of an
-- AD that renders as a blank commitment.
alter table public.map_node_goals alter column node_id     set not null;
alter table public.map_node_goals alter column target_date set not null;

-- The backstop under the map_node_goal_target token. The guard trigger below is
-- what the client SEES (a precise sentence in the user's language); this is what
-- makes the state unrepresentable even if the trigger is ever dropped. Both, not
-- either: a constraint cannot carry a token and a trigger is not a guarantee.
alter table public.map_node_goals drop constraint if exists map_node_goals_target_chk;
alter table public.map_node_goals add constraint map_node_goals_target_chk
  check (target is null or target > 0);

-- Labels are 60, matching `use_cases` rather than `map_node_kinds`' 40: a goal
-- label is a phrase somebody writes in a planning meeting ("Riyadh cluster,
-- second wave"), not a one-word container. btrim before measuring on the English
-- side is unnecessary here because '' is legal — the length cap is the only
-- claim, and '   ' is a label the AD can see and fix.
alter table public.map_node_goals drop constraint if exists map_node_goals_label_len_chk;
alter table public.map_node_goals add constraint map_node_goals_label_len_chk
  check (char_length(label) <= 60);

alter table public.map_node_goals drop constraint if exists map_node_goals_label_ar_len_chk;
alter table public.map_node_goals add constraint map_node_goals_label_ar_len_chk
  check (char_length(label_ar) <= 60);

-- "the goals on this node", which is every read the panel makes.
create index if not exists map_node_goals_node_idx on public.map_node_goals (node_id);

-- "what is due this quarter, across the portfolio" — the one question asked
-- ACROSS nodes rather than within one, and the reason this second index exists
-- on a table that will hold tens of rows.
create index if not exists map_node_goals_date_idx on public.map_node_goals (target_date);

-- ⚠ THERE IS DELIBERATELY NO UNIQUE INDEX HERE. See the header. Probe 1 asserts
--   that the primary key is the ONLY unique index on this table, so adding one
--   fails the migration rather than quietly refusing half of somebody's ramp.

alter table public.map_node_goals enable row level security;

-- MEMBER READ, structure.edit WRITE — and both halves matter.
--
-- A member MUST be able to READ goals. The whole point of a commitment is that
-- the people doing the work can see it; a member who cannot read this table gets
-- a portfolio with progress and no target, which is a number with nothing to
-- mean anything against.
--
-- A member must NOT be able to WRITE one. A goal is a promise made to an
-- executive about a department. If the person whose progress is measured against
-- the goal can move the goal, the number stops being evidence.
--
-- 0009's InitPlan form `(select …)` on every predicate, so each is evaluated
-- once per statement rather than once per surviving row.
drop policy if exists map_node_goals_select on public.map_node_goals;
create policy map_node_goals_select on public.map_node_goals
  for select using ((select public.is_member()));

drop policy if exists map_node_goals_insert on public.map_node_goals;
create policy map_node_goals_insert on public.map_node_goals
  for insert with check ((select public.has_perm('structure.edit')));

drop policy if exists map_node_goals_update on public.map_node_goals;
create policy map_node_goals_update on public.map_node_goals
  for update using ((select public.has_perm('structure.edit')))
  with check ((select public.has_perm('structure.edit')));

drop policy if exists map_node_goals_delete on public.map_node_goals;
create policy map_node_goals_delete on public.map_node_goals
  for delete using ((select public.has_perm('structure.edit')));

-- Explicit, rather than relying on Supabase's default privileges for new tables
-- in `public` — 0018:207-214's reasoning verbatim. `anon` is left exactly as the
-- project's defaults have it, matching every other table here; the anon key
-- cannot pass is_member() in any case.
grant select, insert, update, delete on public.map_node_goals to authenticated;


-- ── the guard: the two tokens ───────────────────────────────────────────────
-- BEFORE INSERT OR UPDATE, and it fires before every other trigger on this table
-- because Postgres fires BEFORE triggers in NAME order and
-- `map_node_goals_guard_trg` sorts ahead of `map_node_goals_stamp_trg` and
-- `map_node_goals_touch_trg`. THAT ORDERING IS LOAD-BEARING and is enforced by
-- nothing but the names, so probe 1 asserts it — the same rule 0023:566 states
-- for `map_nodes` and 0024's probe 1 asserts for `entries`.
--
-- Why a trigger at all when a CHECK and an FK already refuse both cases: a
-- constraint violation arrives at the client as `23514 … violates check
-- constraint "map_node_goals_target_chk"`, an identifier the user has never
-- heard of, rendered inside a fully-Arabic RTL layout. The token is what
-- src/lib/pgError.ts turns into a sentence. The constraints stay as the
-- guarantee; this is the message.
create or replace function public.map_node_goals_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.target is not null and new.target <= 0 then
    raise exception
      'map_node_goal_target: a goal target must be a positive number of organizations, got %', new.target
      using errcode = '23514';
  end if;

  -- SECURITY DEFINER so this lookup is not itself filtered by map_nodes_select:
  -- the answer must be "does this row exist", not "can you see it". A member who
  -- could not see the node could not have got a goal onto it anyway — RLS on
  -- THIS table refuses the write first — so nothing is widened by asking
  -- honestly, and a definer lookup means a stale tab gets "that branch is gone"
  -- rather than a bare foreign-key identifier.
  if not exists (select 1 from public.map_nodes n where n.id = new.node_id) then
    raise exception
      'map_node_goal_node_missing: node % not found', new.node_id
      using errcode = 'P0002';
  end if;

  return new;
end;
$$;

drop trigger if exists map_node_goals_guard_trg on public.map_node_goals;
create trigger map_node_goals_guard_trg
  before insert or update on public.map_node_goals
  for each row execute function public.map_node_goals_guard();


-- ── created_by / updated_by are server truth ────────────────────────────────
-- Overwritten rather than trusted — `entries_guard_insert()`'s rule (0015:330)
-- and `map_node_use_cases_stamp()`'s shape (0024:484) at one table's scale. The
-- JWT-less passthrough is the same one the whole schema uses: the SQL Editor,
-- the service role and the importer all act without a `sub` claim and must be
-- able to write rows that are honestly attributed to nobody.
--
-- Resolved THROUGH profiles rather than taken raw from auth.uid(): a JWT without
-- a profile row would violate the FK, and the failure would surface as the AD's
-- perfectly legitimate goal being rejected. vocab_touch()'s reasoning (0003:208).
create or replace function public.map_node_goals_stamp()
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

drop trigger if exists map_node_goals_stamp_trg on public.map_node_goals;
create trigger map_node_goals_stamp_trg
  before insert on public.map_node_goals
  for each row execute function public.map_node_goals_stamp();


-- Diffed rather than stamped unconditionally, for the reason use_cases_touch()
-- and track_groups_touch() give: a screen that saves the whole goal on a blur
-- must not report it as edited — and must not emit an audit row — when nothing
-- moved. "Who moved the date" is only answerable if the trail is not full of
-- saves that moved nothing.
create or replace function public.map_node_goals_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (to_jsonb(new) - 'updated_at' - 'updated_by')
     is distinct from
     (to_jsonb(old) - 'updated_at' - 'updated_by') then
    new.updated_at := now();
    new.updated_by := coalesce(
      (select p.id from public.profiles p where p.id = auth.uid()),
      old.updated_by
    );
  else
    -- The `else` 0015:239-244 had to add to entries_guard_update(). Subtracting
    -- updated_by from the diff and then leaving NEW alone hands a client a
    -- one-field PATCH — {"updated_by": null} — that erases the mark without
    -- changing anything else and without moving a clock.
    new.updated_by := old.updated_by;
    -- ⚠ AND updated_at, WHICH 0024:514-537 DOES NOT PIN. On that table the hole
    --   is survivable; on this one it eats the file's own thesis. `updated_at`
    --   is subtracted from the diff here AND from the audit trigger's compare
    --   below, so a one-field PATCH {"updated_at": "2001-09-09T…"} takes the
    --   else arm, lands on the row, and writes NO config_audit row at all. The
    --   goal then reads as last edited in 2001 and the trail that is supposed to
    --   be the only answer to "who moved the date, and when" contains nothing
    --   about it. 0026's map_node_progress_touch() already pins both columns, so
    --   this is the two files agreeing rather than a new idiom, and probe 4
    --   sends exactly that PATCH.
    new.updated_at := old.updated_at;
  end if;
  -- Identity and provenance of the row's creation are not editable by anyone.
  new.created_at := old.created_at;
  new.created_by := old.created_by;
  return new;
end;
$$;

drop trigger if exists map_node_goals_touch_trg on public.map_node_goals;
create trigger map_node_goals_touch_trg
  before update on public.map_node_goals
  for each row execute function public.map_node_goals_touch();


-- AFTER, not BEFORE: the row image recorded must be the one that survived every
-- other trigger and constraint on the table. Identical in shape to
-- use_cases_audit() (0024:270) and track_groups_audit() (0018:243).
--
-- ⚠ THIS TRIGGER IS THE POINT OF THE TABLE, not decoration. `map_node_progress`
--   (0026) deliberately has NO audit trigger, because recording where an org got
--   to is routine fieldwork and auditing it produces a trail dominated by data
--   entry (0024:544). A goal is the opposite: rare, consequential, made by one
--   person with nobody watching, and the question it will be asked six months
--   from now is "who moved the date, and when". `config_audit` is the only place
--   that answer can live.
--
-- The guard inside log_config_audit() accepts structure.edit (0025:1859), which
-- is exactly the permission this table's write policies require — so a Director
-- writing a goal passes the audit writer instead of meeting a 42501 on a
-- legitimate edit. Probe 3's Director arm is what proves that, and it is the
-- probe that would have caught the same hazard on the member-write design.
create or replace function public.map_node_goals_audit()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    -- Casts on the null: with a single candidate Postgres resolves an untyped
    -- null anyway, but an overload added later would make this ambiguous at
    -- runtime, inside a trigger, on someone else's write. 0018:250-252.
    perform public.log_config_audit('map_node_goals', new.id, 'insert', null::jsonb, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    if (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
      perform public.log_config_audit('map_node_goals', new.id, 'update', to_jsonb(old), to_jsonb(new));
    end if;
    return new;
  else
    perform public.log_config_audit('map_node_goals', old.id, 'delete', to_jsonb(old), null::jsonb);
    return old;
  end if;
end;
$$;

drop trigger if exists map_node_goals_audit_trg on public.map_node_goals;
create trigger map_node_goals_audit_trg
  after insert or update or delete on public.map_node_goals
  for each row execute function public.map_node_goals_audit();


-- ── v_map_node_open_counts ──────────────────────────────────────────────────
-- The first aggregate view in this schema. 0023 and 0024 define none; see the
-- header for the boundary rule that decides what may read it.
--
-- `drop` then `create` rather than `create or replace view`, and it is 0003:426
-- and 0006:193's discipline: replace cannot alter the definition of an existing
-- column, so a re-run against an earlier cut with a different column list fails
-- in a way that reads like a syntax error. Dropping discards BOTH the reloption
-- and the grant, so both are re-applied below — omit the first and the view runs
-- as its owner and leaks every entry past the RLS on `entries`; omit the second
-- and every member gets a permission error on a screen that worked an hour ago.
-- Neither failure has a compile-time signal.
drop view if exists public.v_map_node_open_counts;

create view public.v_map_node_open_counts
with (security_invoker = true) as
select
  n.id as node_id,
  -- The open test is spelled out rather than delegated to v_entry_health's own
  -- WHERE clause, because `open` must be countable for an entry that has no
  -- health row at all. `e.id is not null` is what keeps a node with zero entries
  -- at 0 rather than 1 under the left join.
  --
  -- ('done','cancelled') is lib/health.ts's CLOSED_STATUSES, and it is the one
  -- literal in this file that is duplicated from TypeScript. It is already
  -- duplicated in v_entry_health (0006:255); this is the third copy and it is
  -- named here so a fourth is a decision rather than an accident.
  (count(*) filter (
     where e.id is not null and e.status not in ('done','cancelled')
   ))::int as open,
  (count(*) filter (
     where e.id is not null and e.status not in ('done','cancelled')
       and coalesce(h.days_overdue, 0) > 0
   ))::int as overdue,
  (count(*) filter (
     where e.id is not null and e.status not in ('done','cancelled')
       and coalesce(h.sla_breached, false)
   ))::int as breached,
  -- "Unassigned" is entrySections.ts:124's test verbatim: neither a provisioned
  -- teammate nor a free-text name. `entries_single_owner` already forbids both
  -- being set, so this is one condition, not two.
  (count(*) filter (
     where e.id is not null and e.status not in ('done','cancelled')
       and e.owner_id is null and coalesce(btrim(e.owner_name), '') = ''
   ))::int as unassigned
from public.map_nodes n
-- LEFT, so EVERY node gets a row, including one with no entries at all. That is
-- deliberate and the client depends on it: "this node has zero open items" and
-- "this node is not in the result" are different facts, and only the first is
-- something the panel may render as 0. A missing row means the read did not
-- reach the node, and the client renders an em-dash.
left join public.entries e on e.node_id = n.id
-- AT MOST ONE ROW, by construction: v_entry_health selects one row per entry
-- (0006:247 re-proves it on live data). A many-side join here would multiply the
-- counts silently.
left join public.v_entry_health h on h.entry_id = e.id
group by n.id;

comment on view public.v_map_node_open_counts is
  'Per-node DIRECT counts of open entries — open, overdue, breached, unassigned — for the numbers a human reads as FACTS. Not rolled up: the client folds ~400 rows in the O(n) pass it already runs. security_invoker = true is mandatory; without it this view runs as its owner and returns every entry in the workspace to every reader regardless of entries_select. One row per map_node, including nodes with no entries.';

-- Re-applied because `drop view` above discarded it. `anon` is left exactly as
-- the project defaults have it; the anon key cannot pass is_member() and, with
-- security_invoker, would read zero rows in any case.
grant select on public.v_map_node_open_counts to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- PROBE 1 — the shape, including the reloption that is the difference between
--           an aggregate and a data leak
-- ════════════════════════════════════════════════════════════════════════════
-- Runs as whoever applies the file (the SQL Editor, i.e. no JWT), which is the
-- right role here: this probe tests the OBJECTS. RLS is probe 3's job and the
-- arithmetic is probe 2's.
--
-- Three assertions in here are enforced by nothing else in the system and are
-- the reason this block is long rather than a smoke test:
--
--   * `security_invoker` on the view. Absent, the view is a data leak with no
--     symptom — it returns MORE rows, never fewer, so every screen looks right.
--   * the ABSENCE of a unique index on map_node_goals. Present, half of a
--     phased ramp is silently refused months after this file was reviewed.
--   * the BEFORE-trigger NAME ORDER. A rule about a name, enforced by nothing —
--     no constraint, no type, no TypeScript test can see it.
do $shape$
declare
  v_opts      text[];
  v_invoker   text;
  v_relkind   "char";
  v_missing   text;
  v_cols      text[];
  v_uniq      int;
  v_pol       int;
  v_ins_names text[];
  v_upd_names text[];
  v_guard_i   int;
  v_stamp_i   int;
  v_guard_u   int;
  v_touch_u   int;
  v_audit     int;
  v_confdel   "char";
begin
  -- ── the table ────────────────────────────────────────────────────────────
  if to_regclass('public.map_node_goals') is null then
    raise exception 'NphiesCore 0027 FAILED: public.map_node_goals does not exist.';
  end if;

  select string_agg(want, ', ') into v_missing
    from (values
      ('id'), ('node_id'), ('label'), ('label_ar'), ('stage_id'),
      ('target'), ('target_date'),
      ('created_at'), ('updated_at'), ('created_by'), ('updated_by')
    ) as w(want)
   where not exists (
     select 1 from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = 'map_node_goals'
        and c.column_name = w.want
   );

  if v_missing is not null then
    raise exception
      'NphiesCore 0027 FAILED: map_node_goals is missing these columns: %. An earlier partial cut of this file landed and the `add column if not exists` block did not cover them.',
      v_missing;
  end if;

  if exists (
    select 1 from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = 'map_node_goals'
       and c.column_name in ('node_id','target_date') and c.is_nullable = 'YES'
  ) then
    raise exception
      'NphiesCore 0027 FAILED: map_node_goals.node_id or .target_date is nullable. A goal with no node or no date renders as a blank commitment in front of an AD.';
  end if;

  -- ── the two FK actions, which are OPPOSITE on purpose ────────────────────
  select con.confdeltype into v_confdel
    from pg_constraint con
   where con.conrelid = 'public.map_node_goals'::regclass
     and con.contype = 'f'
     and con.conkey = array[
       (select a.attnum from pg_attribute a
         where a.attrelid = 'public.map_node_goals'::regclass and a.attname = 'node_id')
     ]::smallint[];

  if v_confdel is distinct from 'c' then
    raise exception
      'NphiesCore 0027 FAILED: map_node_goals.node_id is not ON DELETE CASCADE (confdeltype = %). A goal for a deleted organization is not a fact worth keeping, and `restrict` here would make deleting a leaf node impossible for a reason nobody would find.',
      coalesce(v_confdel::text, '(no fk at all)');
  end if;

  select con.confdeltype into v_confdel
    from pg_constraint con
   where con.conrelid = 'public.map_node_goals'::regclass
     and con.contype = 'f'
     and con.conkey = array[
       (select a.attnum from pg_attribute a
         where a.attrelid = 'public.map_node_goals'::regclass and a.attname = 'stage_id')
     ]::smallint[];

  if v_confdel is distinct from 'n' then
    raise exception
      'NphiesCore 0027 FAILED: map_node_goals.stage_id is not ON DELETE SET NULL (confdeltype = %). Retiring a stage must fall a goal back to the terminal reading, not delete the commitment and not block the retirement.',
      coalesce(v_confdel::text, '(no fk at all)');
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.map_node_goals'::regclass
       and contype = 'c' and conname = 'map_node_goals_target_chk'
  ) then
    raise exception
      'NphiesCore 0027 FAILED: map_node_goals_target_chk is missing. The guard trigger carries the MESSAGE; this constraint is the GUARANTEE, and a goal of 0 reads as permanently met.';
  end if;

  -- BY NAME, exactly like 0026's index assertions and for the same reason: these
  -- two constraints have no token in front of them, so src/lib/pgError.ts
  -- matches the constraint NAME itself to say which of the two label fields is
  -- too long. A rename on either side leaves an AD reading a raw 23514 inside an
  -- RTL form with two label fields and no indication which one to shorten.
  select string_agg(want, ', ') into v_missing
    from (values ('map_node_goals_label_len_chk'), ('map_node_goals_label_ar_len_chk')) as w(want)
   where not exists (
     select 1 from pg_constraint
      where conrelid = 'public.map_node_goals'::regclass
        and contype = 'c' and conname = w.want
   );

  if v_missing is not null then
    raise exception
      'NphiesCore 0027 FAILED: these label-length constraints are missing or renamed: %. Each caps its field at 60 characters and each is matched BY NAME in src/lib/pgError.ts (mapadmin.errGoalLabelLength / errGoalLabelArLength) — without the name the message degrades to common.error on a form with two label fields.',
      v_missing;
  end if;

  -- ── the index that must NOT be there ─────────────────────────────────────
  select count(*) into v_uniq
    from pg_index i
   where i.indrelid = 'public.map_node_goals'::regclass and i.indisunique;

  if v_uniq <> 1 then
    raise exception
      'NphiesCore 0027 FAILED: map_node_goals carries % unique indexes; the primary key must be the only one. Somebody added uniqueness on (node_id, target_date) or similar — that refuses "15 at Testing/UAT and 40 at Live, both by 31 Dec", which is one ramp described at two altitudes and is the shape this table exists to hold.',
      v_uniq;
  end if;

  if to_regclass('public.map_node_goals_node_idx') is null
     or to_regclass('public.map_node_goals_date_idx') is null then
    raise exception
      'NphiesCore 0027 FAILED: map_node_goals_node_idx and/or map_node_goals_date_idx is missing. The first is every read the panel makes; the second is "what is due this quarter" across the whole portfolio.';
  end if;

  -- ── RLS on, and four policies ────────────────────────────────────────────
  if not exists (
    select 1 from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public' and c.relname = 'map_node_goals' and c.relrowsecurity
  ) then
    raise exception
      'NphiesCore 0027 FAILED: row level security is not enabled on map_node_goals. Every policy below it is decoration.';
  end if;

  select count(*) into v_pol
    from pg_policies
   where schemaname = 'public' and tablename = 'map_node_goals'
     and policyname in ('map_node_goals_select','map_node_goals_insert',
                        'map_node_goals_update','map_node_goals_delete');

  if v_pol <> 4 then
    raise exception
      'NphiesCore 0027 FAILED: % of the 4 expected policies on map_node_goals are present.', v_pol;
  end if;

  -- ── the NAME-ORDER assertion ─────────────────────────────────────────────
  -- tgtype bits: 1=ROW, 2=BEFORE, 4=INSERT, 8=DELETE, 16=UPDATE. 0024's probe 1
  -- reads the same bits for the same reason.
  select array_agg(t.tgname order by t.tgname) into v_ins_names
    from pg_trigger t
   where t.tgrelid = 'public.map_node_goals'::regclass
     and not t.tgisinternal
     and (t.tgtype & 2) <> 0 and (t.tgtype & 4) <> 0;

  select array_agg(t.tgname order by t.tgname) into v_upd_names
    from pg_trigger t
   where t.tgrelid = 'public.map_node_goals'::regclass
     and not t.tgisinternal
     and (t.tgtype & 2) <> 0 and (t.tgtype & 16) <> 0;

  v_guard_i := array_position(v_ins_names, 'map_node_goals_guard_trg');
  v_stamp_i := array_position(v_ins_names, 'map_node_goals_stamp_trg');
  v_guard_u := array_position(v_upd_names, 'map_node_goals_guard_trg');
  v_touch_u := array_position(v_upd_names, 'map_node_goals_touch_trg');

  if v_guard_i is null or v_stamp_i is null or v_guard_i > v_stamp_i then
    raise exception
      'NphiesCore 0027 FAILED: BEFORE INSERT order on map_node_goals is %. The guard must fire before the stamp, or a refused goal has already had authorship written onto it and the token arrives after a write that should never have started.',
      v_ins_names;
  end if;

  if v_guard_u is null or v_touch_u is null or v_guard_u > v_touch_u then
    raise exception
      'NphiesCore 0027 FAILED: BEFORE UPDATE order on map_node_goals is %. The guard must fire before the touch, or a rejected edit still moved updated_at.',
      v_upd_names;
  end if;

  select count(*) into v_audit
    from pg_trigger t
   where t.tgrelid = 'public.map_node_goals'::regclass
     and not t.tgisinternal
     and t.tgname = 'map_node_goals_audit_trg'
     and (t.tgtype & 2) = 0          -- AFTER
     and (t.tgtype & 4) <> 0         -- INSERT
     and (t.tgtype & 8) <> 0         -- DELETE
     and (t.tgtype & 16) <> 0;       -- UPDATE

  if v_audit <> 1 then
    raise exception
      'NphiesCore 0027 FAILED: map_node_goals_audit_trg is not installed AFTER INSERT OR UPDATE OR DELETE. "Who moved the date" is the question this table exists to answer and config_audit is the only place that answer can live.';
  end if;

  -- ── the view, and THE RELOPTION ──────────────────────────────────────────
  select c.relkind, c.reloptions into v_relkind, v_opts
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and c.relname = 'v_map_node_open_counts';

  if v_relkind is null then
    raise exception
      'NphiesCore 0027 FAILED: public.v_map_node_open_counts does not exist.';
  end if;

  if v_relkind <> 'v' then
    raise exception
      'NphiesCore 0027 FAILED: public.v_map_node_open_counts is relkind %, not a view.', v_relkind;
  end if;

  if v_opts is not null then
    select substring(o from 'security_invoker=(.*)$') into v_invoker
      from unnest(v_opts) as o
     where o like 'security_invoker=%'
     limit 1;
  end if;

  -- Postgres stores whatever spelling was written — `true` here, `on` in 0001
  -- and 0006 — so every truthy spelling is accepted rather than one.
  if v_invoker is null or lower(v_invoker) not in ('true','on','1','yes') then
    raise exception
      'NphiesCore 0027 FAILED: v_map_node_open_counts does not carry security_invoker (reloptions = %). WITHOUT IT THIS VIEW IS A DATA LEAK, NOT AN AGGREGATE: it runs with its owner''s privileges, RLS on `entries` is not applied, and every entry in the workspace is returned to every reader — including one whose own entries policy would have shown them nothing. There is no symptom, because the failure returns MORE rows and never fewer.',
      coalesce(array_to_string(v_opts, ', '), '(none)');
  end if;

  select string_agg(want, ', ') into v_missing
    from (values ('node_id'), ('open'), ('overdue'), ('breached'), ('unassigned')) as w(want)
   where not exists (
     select 1 from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = 'v_map_node_open_counts'
        and c.column_name = w.want
   );

  if v_missing is not null then
    raise exception
      'NphiesCore 0027 FAILED: v_map_node_open_counts is missing these columns: %. The client selects them BY NAME, so a rename here is a silent undefined in a panel rather than an error.',
      v_missing;
  end if;

  -- ── grants ───────────────────────────────────────────────────────────────
  if not has_table_privilege('authenticated', 'public.map_node_goals', 'select')
     or not has_table_privilege('authenticated', 'public.map_node_goals', 'insert')
     or not has_table_privilege('authenticated', 'public.map_node_goals', 'update')
     or not has_table_privilege('authenticated', 'public.map_node_goals', 'delete') then
    raise exception
      'NphiesCore 0027 FAILED: the authenticated role is missing a grant on map_node_goals. RLS decides WHO; the grant decides whether the request reaches RLS at all.';
  end if;

  if not has_table_privilege('authenticated', 'public.v_map_node_open_counts', 'select') then
    raise exception
      'NphiesCore 0027 FAILED: the authenticated role cannot select from v_map_node_open_counts. `drop view` discards the grant; it has to be re-applied after every create.';
  end if;

  select array_agg(c.column_name::text order by c.ordinal_position) into v_cols
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'v_map_node_open_counts';

  raise notice
    'NphiesCore 0027 probe 1: map_node_goals present (every expected column, node_id CASCADE, stage_id SET NULL, exactly 1 unique index = the PK, RLS on, 4 policies, BEFORE INSERT order %, BEFORE UPDATE order %), v_map_node_open_counts is a view with security_invoker=% and columns %.',
    v_ins_names, v_upd_names, v_invoker, v_cols;
end
$shape$;


-- ════════════════════════════════════════════════════════════════════════════
-- PROBE 2 — the view tells the truth
-- ════════════════════════════════════════════════════════════════════════════
-- The claim that cannot be verified by reading the file: that the four numbers
-- are the four numbers. A view that compiles and returns plausible rows is the
-- most dangerous object in this migration, because every consumer renders it as
-- a fact.
--
-- ⚠ NOT ONE LIVE ROW IS WRITTEN. The fixture creates its own node, its own
--   entries and its own SLA row; a live track is read only to point at, which is
--   0024:769's discipline. Everything rolls back through a sentinel exception
--   (the subtransaction idiom 0007:117-122 documents), so the workspace is
--   untouched whether this passes or fails.
--
-- The fixture is FOUR entries, not three, and the fourth is the control:
--
--   A  open, owned, no due date, no SLA breach      → open only
--   B  open, owned, due 3 days ago, SLA breached    → open + overdue + breached
--   C  open, NO owner, no due date                  → open + unassigned
--   D  status 'done'                                → NOTHING
--
-- Without D the `open` filter is untested — a view that counted every entry
-- would pass a three-open-entry fixture perfectly. Every probe must be able to
-- fail.
--
-- A SECOND node with no entries at all is created too, and the assertion that it
-- returns a row of zeros rather than no row is not decoration: the client draws
-- "0 open" and "no data" differently, and the left join is the only thing
-- keeping those two apart.
do $truth$
declare
  v_track    uuid;
  v_kind     uuid;
  v_kind_req boolean;
  v_node     uuid;
  v_empty    uuid;
  v_open     int;
  v_overdue  int;
  v_breach   int;
  v_unassign int;
  v_empty_rows int;
  v_empty_open int;
  v_prio     text := 'low';
  v_back     timestamptz := now() - interval '30 days';
begin
  -- AN EXCEPTION, NOT A NOTICE-AND-RETURN. An earlier cut skipped the probe
  -- here, which meant a workspace with no unarchived track got a green 0027 with
  -- the view's arithmetic, its security_invoker path and the whole goals RLS
  -- matrix untested — two of three probes vacuous, on a file whose own header
  -- calls that reloption "the one thing a reviewer must check". 0026 raises in
  -- the same situation and the two files are applied in one sitting, so they say
  -- the same thing.
  select t.id into v_track from public.tracks t
   where t.archived = false order by t.sort_order, t.id limit 1;

  if v_track is null then
    raise exception
      'NphiesCore 0027 CANNOT VERIFY: there is no unarchived track to hang a fixture node under, so probe 2 could not run — and a migration that cannot exercise its own probes must refuse rather than report a green run with an untested aggregate. Create (or unarchive) one track and re-run this file.';
  end if;

  begin
    -- 0023 owns map_nodes' column list, so kind_id is probed for rather than
    -- assumed — 0024:826's pattern. If it exists and is NOT NULL, a kind must be
    -- available, and saying so by name beats a bare 23502 from inside a fixture.
    select (c.is_nullable = 'NO') into v_kind_req
      from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = 'map_nodes' and c.column_name = 'kind_id';

    if v_kind_req is null then
      insert into public.map_nodes (name, track_id)
        values ('0027 probe node', v_track) returning id into v_node;
      insert into public.map_nodes (name, track_id)
        values ('0027 probe empty node', v_track) returning id into v_empty;
    else
      select k.id into v_kind from public.map_node_kinds k order by k.sort_order limit 1;
      if v_kind is null and v_kind_req then
        raise exception
          'NphiesCore 0027 PROBE 2 SETUP FAILED: map_nodes.kind_id is NOT NULL but map_node_kinds is empty. 0023''s kind seed did not land.';
      end if;
      insert into public.map_nodes (name, track_id, kind_id)
        values ('0027 probe node', v_track, v_kind) returning id into v_node;
      insert into public.map_nodes (name, track_id, kind_id)
        values ('0027 probe empty node', v_track, v_kind) returning id into v_empty;
    end if;

    -- An SLA for this track at ONE priority, so `breached` has something to be
    -- true about. 0005 turned SLA off by default and this file does not change
    -- that: the row is written here, inside the block that is thrown away, and
    -- whatever the workspace had before is restored by the rollback itself
    -- rather than by any statement of ours. `on conflict` because a workspace
    -- may already carry an override on this pair.
    insert into public.track_slas (track_id, priority, sla_days)
      values (v_track, v_prio, 1)
    on conflict (track_id, priority) do update set sla_days = excluded.sla_days;

    -- created_at is written explicitly, which is legitimate ONLY without a JWT:
    -- entries_guard_insert() returns early when auth.uid() is null (0015:330),
    -- and that is the path the SQL Editor, the service role and `npm run seed`
    -- all take. Backdated 30 days so `now() > created_at + 1 day` is true and
    -- the breach is real rather than asserted.
    insert into public.entries (title, track_id, node_id, status, priority, owner_name, created_at)
      values ('0027 probe A — open, owned', v_track, v_node, 'in_progress', 'medium', 'Probe Owner', now());

    insert into public.entries (title, track_id, node_id, status, priority, owner_name, due_date, created_at)
      values ('0027 probe B — overdue and breached', v_track, v_node, 'in_progress', v_prio,
              'Probe Owner', current_date - 3, v_back);

    insert into public.entries (title, track_id, node_id, status, priority, created_at)
      values ('0027 probe C — unassigned', v_track, v_node, 'new', 'medium', now());

    -- THE CONTROL. Closed, overdue, unowned and on an SLA'd priority: every
    -- filter in the view would count it if the open test were missing.
    insert into public.entries (title, track_id, node_id, status, priority, due_date, created_at)
      values ('0027 probe D — done, must count for nothing', v_track, v_node, 'done', v_prio,
              current_date - 9, v_back);

    select v.open, v.overdue, v.breached, v.unassigned
      into v_open, v_overdue, v_breach, v_unassign
      from public.v_map_node_open_counts v
     where v.node_id = v_node;

    select count(*), coalesce(max(v.open), -1)
      into v_empty_rows, v_empty_open
      from public.v_map_node_open_counts v
     where v.node_id = v_empty;

    raise exception using errcode = 'OT027', message = 'probe rollback';
  exception
    when sqlstate 'OT027' then
      null; -- subtransaction discarded; plpgsql variables survive it
  end;

  if v_open is distinct from 3 then
    raise exception
      'NphiesCore 0027 FAILED: the view reports % open entries on a node carrying 3 open and 1 done. %.',
      coalesce(v_open::text, 'NO ROW AT ALL'),
      case
        when v_open is null then 'The node produced no row at all, so the LEFT JOIN has become an inner one and a node with entries has vanished from the aggregate'
        when v_open = 4 then 'The closed entry was counted — the ''done''/''cancelled'' test is missing, and every count on every ring is high by the size of the workspace''s finished work'
        else 'Neither 3 nor 4, so the join to v_entry_health is multiplying or dropping rows'
      end;
  end if;

  if v_overdue is distinct from 1 then
    raise exception
      'NphiesCore 0027 FAILED: the view reports % overdue on a node with exactly one open entry due 3 days ago (and one DONE entry due 9 days ago that must not count). v_entry_health.days_overdue is not reaching the aggregate.',
      v_overdue;
  end if;

  if v_breach is distinct from 1 then
    raise exception
      'NphiesCore 0027 FAILED: the view reports % SLA breaches on a node with exactly one open entry created 30 days ago against a 1-day SLA. Either the join to v_entry_health is wrong or coalesce(h.sla_breached, false) is swallowing a true.',
      v_breach;
  end if;

  if v_unassign is distinct from 1 then
    raise exception
      'NphiesCore 0027 FAILED: the view reports % unassigned on a node with exactly one open entry that has neither owner_id nor owner_name. The test must be BOTH null/blank — entries_single_owner already forbids both being set, so checking one is checking half.',
      v_unassign;
  end if;

  if v_empty_rows <> 1 or v_empty_open <> 0 then
    raise exception
      'NphiesCore 0027 FAILED: a node with NO entries produced % row(s) with open=%. It must produce exactly one row of zeros. "This node has zero open items" and "this node is not in the result" are different facts and the client renders only the first as 0 — the second is an em-dash, and losing the distinction is how a partial read renders as good news.',
      v_empty_rows, v_empty_open;
  end if;

  raise notice
    'NphiesCore 0027 probe 2: fixture node read open=% overdue=% breached=% unassigned=% (4 entries: 3 open, 1 done and ignored), and an entry-less node read exactly one row of zeros. All rolled back.',
    v_open, v_overdue, v_breach, v_unassign;
end
$truth$;


-- ════════════════════════════════════════════════════════════════════════════
-- PROBE 3 — RLS: the view leaks nothing, and the goals are the ADs'
-- ════════════════════════════════════════════════════════════════════════════
-- Three claims this file makes that cannot be verified by reading it, asserted
-- in the directions they fail:
--
--   ① A NON-MEMBER reads ZERO rows through the view. This is the assertion that
--     proves `security_invoker` is LIVE rather than decorative — probe 1 read
--     the reloption, and a reloption is a string until somebody selects through
--     it with the wrong JWT. To make it falsifiable the same read is taken as a
--     MEMBER first and must be > 0: against an empty map both numbers would be
--     zero and the probe would pass without testing anything.
--   ② A plain MEMBER reads goals and cannot write one. Both halves matter and
--     they fail in opposite directions: a member who cannot READ gets progress
--     with no target, which is a number with nothing to mean anything against;
--     a member who CAN write moves the goal they are measured against.
--   ③ A DIRECTOR (structure.edit, not admin) CAN write one, AND THE WRITE LANDS
--     THROUGH THE AUDIT TRIGGER. That second half is the one worth the fixture:
--     log_config_audit() raises 42501 at any caller holding none of the four
--     configuration keys, and an audit trigger that refuses is a 42501 on a
--     legitimate edit, blamed on the wrong thing. This probe is what says the
--     policy and the audit writer agree.
--
-- Same fixture discipline as probe 2: nothing live is written, everything rolls
-- back through the OT027 sentinel, and the role-switch skip is SCOPED TO THE
-- SWITCH ALONE — wrapping the whole block would report a broken policy as
-- "skipped", which is 0018:559's lesson and a green-looking migration with a
-- portfolio nobody can read.
do $rls$
declare
  v_member    uuid := gen_random_uuid();
  v_dir       uuid := gen_random_uuid();
  v_ghost     uuid := gen_random_uuid();
  v_dir_role  uuid;
  v_track     uuid;
  v_kind      uuid;
  v_kind_req  boolean;
  v_node      uuid;
  v_goal      uuid;
  v_mem_goals int := -1;
  v_mem_view  int := -1;
  v_mem_wrote boolean := false;
  v_dir_wrote boolean := false;
  v_dir_ran   boolean := false;
  v_dir_audit int := 0;
  v_audit0    int := 0;
  v_ghost_view  int := -1;
  v_ghost_goals int := -1;
  v_skipped   boolean := false;
begin
  -- An EXCEPTION, for probe 2's reason and more sharply: this is the probe that
  -- proves security_invoker is LIVE rather than a string in reloptions. Skipping
  -- it silently is how an untested data leak ships green.
  select t.id into v_track from public.tracks t
   where t.archived = false order by t.sort_order, t.id limit 1;

  if v_track is null then
    raise exception
      'NphiesCore 0027 CANNOT VERIFY: there is no unarchived track to hang a fixture node under, so probe 3 — the one that proves a NON-MEMBER reads zero rows through v_map_node_open_counts — could not run. A migration that cannot exercise its own security probe must refuse rather than report success. Create (or unarchive) one track and re-run this file.';
  end if;

  select r.id into v_dir_role from public.roles r where r.key = 'director';

  begin
    select (c.is_nullable = 'NO') into v_kind_req
      from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = 'map_nodes' and c.column_name = 'kind_id';

    if v_kind_req is null then
      insert into public.map_nodes (name, track_id)
        values ('0027 rls probe node', v_track) returning id into v_node;
    else
      select k.id into v_kind from public.map_node_kinds k order by k.sort_order limit 1;
      insert into public.map_nodes (name, track_id, kind_id)
        values ('0027 rls probe node', v_track, v_kind) returning id into v_node;
    end if;

    -- A goal to read. Written as the migration role, so the stamp trigger's
    -- JWT-less passthrough leaves created_by null — honest attribution to
    -- nobody, which is what the SQL Editor path is.
    insert into public.map_node_goals (node_id, label, target, target_date)
      values (v_node, '0027 probe goal', 40, current_date + 90)
      returning id into v_goal;

    insert into auth.users (id, email, raw_user_meta_data) values
      (v_member, 'probe27-mem-'   || v_member || '@0027.invalid',
       jsonb_build_object('display_name', '0027 Probe Member')),
      (v_dir,    'probe27-dir-'   || v_dir    || '@0027.invalid',
       jsonb_build_object('display_name', '0027 Probe Director')),
      (v_ghost,  'probe27-ghost-' || v_ghost  || '@0027.invalid',
       jsonb_build_object('display_name', '0027 Probe Ghost'));

    if (select count(*) from public.profiles where id in (v_member, v_dir, v_ghost)) <> 3 then
      raise exception
        'NphiesCore 0027 PROBE 3 SETUP FAILED: handle_new_user() did not create the fixture profiles.';
    end if;

    -- No JWT yet, so guard_profile_role() lets this through: the privileged path
    -- the SQL Editor and the edge function use. 0025:2790's move.
    if v_dir_role is not null then
      update public.profiles set role_id = v_dir_role where id = v_dir;
    end if;

    -- The ghost's PROFILE is removed while its auth.users row stays, so it holds
    -- a valid JWT and is not a member — which is exactly what a signed-in person
    -- who was removed from the workspace looks like, and the reader the view
    -- must return nothing to. 0025:2795 explains why the auth row has to stay.
    delete from public.profiles where id = v_ghost;

    select count(*) into v_audit0
      from public.config_audit
     where table_name = 'map_node_goals';

    -- ── cycle 1: the MEMBER ──────────────────────────────────────────────
    begin
      perform set_config('request.jwt.claims',
                         json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
      set local role authenticated;
    exception when insufficient_privilege then
      v_skipped := true;
    end;

    if not v_skipped then
      select count(*) into v_mem_goals from public.map_node_goals;
      select count(*) into v_mem_view  from public.v_map_node_open_counts;

      -- A blocked INSERT under RLS RAISES 42501 rather than affecting zero rows,
      -- so this is caught, not counted.
      begin
        insert into public.map_node_goals (node_id, label, target, target_date)
          values (v_node, '0027 member goal', 5, current_date + 30);
        v_mem_wrote := true;
      exception when insufficient_privilege then
        null; -- 42501, as intended
      end;

      reset role;
      perform set_config('request.jwt.claims', '', true);

      -- ── cycle 2: the DIRECTOR ─────────────────────────────────────────
      if v_dir_role is not null then
        perform set_config('request.jwt.claims',
                           json_build_object('sub', v_dir, 'role', 'authenticated')::text, true);

        -- The fixture has to actually BE a Director, or the assertion below is
        -- vacuous — this is the control that stops the probe passing because the
        -- fixture had no permissions rather than because the policy held.
        if public.has_perm('structure.edit') and not public.is_admin() then
          v_dir_ran := true;
          set local role authenticated;

          begin
            insert into public.map_node_goals (node_id, label, target, target_date)
              values (v_node, '0027 director goal', 15, current_date + 60);
            v_dir_wrote := true;
          exception when insufficient_privilege then
            null; -- 42501 — either from the policy or, worse, from log_config_audit()
          end;

          reset role;
        end if;

        perform set_config('request.jwt.claims', '', true);

        select count(*) - v_audit0 into v_dir_audit
          from public.config_audit
         where table_name = 'map_node_goals';
      end if;

      -- ── cycle 3: the GHOST — a JWT with no membership ─────────────────
      perform set_config('request.jwt.claims',
                         json_build_object('sub', v_ghost, 'role', 'authenticated')::text, true);
      set local role authenticated;

      select count(*) into v_ghost_view  from public.v_map_node_open_counts;
      select count(*) into v_ghost_goals from public.map_node_goals;

      reset role;
      perform set_config('request.jwt.claims', '', true);
    end if;

    raise exception using errcode = 'OT027', message = 'probe rollback';
  exception
    when sqlstate 'OT027' then
      null;
  end;

  if v_skipped then
    raise notice
      'NphiesCore 0027 probe 3 SKIPPED: this role cannot `set role authenticated`, so no client path could be exercised. The policies and the view ARE installed. Verify by hand: as a MEMBER, GET /rest/v1/map_node_goals must return rows and POST must return 42501; as a DIRECTOR, POST must succeed; and a signed-in person with no profile must read [] from /rest/v1/v_map_node_open_counts.';
    return;
  end if;

  if v_mem_goals < 1 then
    raise exception
      'NphiesCore 0027 FAILED: a plain member read % goals when at least the fixture goal exists. map_node_goals_select is too strict, and a portfolio showing progress with no target is a number with nothing to mean anything against.',
      v_mem_goals;
  end if;

  if v_mem_view < 1 then
    raise exception
      'NphiesCore 0027 FAILED: a plain member read % rows from v_map_node_open_counts. A member who cannot read the aggregate falls back to the truncated working set, which is the exact failure this view exists to end.',
      v_mem_view;
  end if;

  if v_mem_wrote then
    raise exception
      'NphiesCore 0027 FAILED: a plain MEMBER wrote a goal. Goals are structure.edit BY DESIGN — a commitment the measured party can move is not evidence. Check that the insert/update/delete policies say has_perm(''structure.edit'') and not is_member().';
  end if;

  if v_dir_role is null then
    raise notice
      'NphiesCore 0027 probe 3: the Director arm was SKIPPED — no role with key ''director'' exists, so 0025''s seed has not landed here. The member half passed.';
  elsif not v_dir_ran then
    raise notice
      'NphiesCore 0027 probe 3: the Director arm was SKIPPED — the fixture profile did not resolve to structure.edit-without-admin, so the assertion would have been vacuous. The member half passed.';
  else
    if not v_dir_wrote then
      raise exception
        'NphiesCore 0027 FAILED: a DIRECTOR (structure.edit, not admin) could not write a goal — 42501. Two things raise that code here and both are this file''s problem: the write policy is gated on is_admin() rather than has_perm(''structure.edit''), OR log_config_audit()''s guard no longer accepts structure.edit and the AUDIT TRIGGER is rolling back a legitimate edit. Check the policy first, then 0025:1859. This is a 42501 on a legitimate edit, blamed on the wrong thing.';
    end if;

    if v_dir_audit < 1 then
      raise exception
        'NphiesCore 0027 FAILED: the Director''s goal landed but wrote % config_audit rows. "Who moved the date" is the question this table exists to answer, and an audit trigger that does not fire is worse than none because the trail looks complete.',
        v_dir_audit;
    end if;
  end if;

  if v_ghost_view <> 0 then
    raise exception
      'NphiesCore 0027 FAILED: a signed-in NON-MEMBER read % rows from v_map_node_open_counts. security_invoker is not in force — the view is running with its owner''s privileges, RLS on map_nodes and entries is being skipped, and the shape of the entire portfolio is readable by anybody holding a valid JWT. THIS IS THE DATA LEAK PROBE 1''S RELOPTION CHECK EXISTS TO PREVENT, caught here on the path that matters.',
      v_ghost_view;
  end if;

  if v_ghost_goals <> 0 then
    raise exception
      'NphiesCore 0027 FAILED: a signed-in NON-MEMBER read % goals. map_node_goals_select must be (select public.is_member()).',
      v_ghost_goals;
  end if;

  raise notice
    'NphiesCore 0027 probe 3: a member read % goals and % aggregate rows and could not write a goal; the Director arm %; a non-member read 0 goals and 0 aggregate rows through the invoker view. All rolled back.',
    v_mem_goals, v_mem_view,
    case
      when v_dir_role is null then 'was skipped (no role with key ''director'')'
      when not v_dir_ran then 'was skipped (the fixture did not resolve to structure.edit-without-admin)'
      else 'wrote a goal and emitted ' || v_dir_audit || ' config_audit row(s)'
    end;
end
$rls$;


-- ════════════════════════════════════════════════════════════════════════════
-- PROBE 4 — saving a goal that changed nothing changes nothing
-- ════════════════════════════════════════════════════════════════════════════
-- The property the audit trail's value rests on, and it fails in a way no
-- screen would ever show: this table's whole thesis is "who moved the date, and
-- when", and BOTH of those columns are ones a client can put in a PATCH body.
--
--   * `updated_at` — subtracted from the touch diff AND from the audit compare.
--     A one-field PATCH {"updated_at": "2001-09-09T…"} therefore takes the
--     touch's else arm, and unless that arm pins the column back, the client's
--     value lands AND no config_audit row is written. The goal reads as last
--     edited in 2001 and the trail says nothing at all.
--   * `updated_by`, `created_at`, `created_by` — the same shape, already pinned;
--     the fixture plants a real `created_by` first so that "null in, null out"
--     cannot pass for a pin that is not there.
--
-- Compared as jsonb, so a column added to this table in a later migration is
-- covered by this assertion for free. Everything rolls back through OT027.
do $noop$
declare
  v_track    uuid;
  v_kind     uuid;
  v_kind_req boolean;
  v_node     uuid;
  v_goal     uuid;
  v_actor    uuid;
  v_before   jsonb;
  v_after    jsonb;
  v_audit0   int;
  v_audit    int := 0;
  v_bogus    timestamptz := timestamptz '2001-09-09 01:46:40+00';
begin
  select t.id into v_track from public.tracks t
   where t.archived = false order by t.sort_order, t.id limit 1;

  if v_track is null then
    raise exception
      'NphiesCore 0027 CANNOT VERIFY: there is no unarchived track to hang a fixture node under, so probe 4 could not run.';
  end if;

  select count(*) into v_audit0 from public.config_audit where table_name = 'map_node_goals';

  -- Any real profile will do; it is planted as created_by so the no-op's attempt
  -- to write null over it has something to destroy.
  select id into v_actor from public.profiles order by id limit 1;

  begin
    select (c.is_nullable = 'NO') into v_kind_req
      from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = 'map_nodes' and c.column_name = 'kind_id';

    if v_kind_req is null then
      insert into public.map_nodes (name, track_id)
        values ('0027 noop probe node', v_track) returning id into v_node;
    else
      select k.id into v_kind from public.map_node_kinds k order by k.sort_order limit 1;
      insert into public.map_nodes (name, track_id, kind_id)
        values ('0027 noop probe node', v_track, v_kind) returning id into v_node;
    end if;

    -- Written without a JWT, so map_node_goals_stamp() passes straight through
    -- and the planted created_by survives — the SQL Editor / service role path.
    -- BOTH author columns are planted, not just created_by: the no-op below
    -- writes null over each of them, and against a row that already held null
    -- "null in, null out" would pass whether or not the else arm pinned anything.
    insert into public.map_node_goals (node_id, label, target, target_date, created_by, updated_by)
      values (v_node, '0027 noop goal', 40, current_date + 90, v_actor, v_actor)
      returning id into v_goal;

    if v_actor is not null
       and (select coalesce(created_by = v_actor, false) and coalesce(updated_by = v_actor, false)
              from public.map_node_goals where id = v_goal) is not true then
      raise exception
        'NphiesCore 0027 PROBE 4 SETUP FAILED: a JWT-less insert did not preserve the created_by / updated_by it was given, so the pins below would be asserted against nulls and would pass for the wrong reason.';
    end if;

    select to_jsonb(g) into v_before from public.map_node_goals g where g.id = v_goal;

    -- ① the one-field PATCH. This is the shape a hostile or merely careless
    --    client sends, and it is the one the audit trigger cannot see.
    update public.map_node_goals set updated_at = v_bogus where id = v_goal;

    -- ② the whole-row re-save a save-on-blur editor sends: every column exactly
    --    as it already is, with the four server-owned ones deliberately wrong.
    update public.map_node_goals
       set node_id     = v_node,
           label       = '0027 noop goal',
           label_ar    = '',
           stage_id    = null,
           target      = 40,
           target_date = current_date + 90,
           created_at  = v_bogus,
           updated_at  = v_bogus,
           created_by  = null,
           updated_by  = null
     where id = v_goal;

    select to_jsonb(g) into v_after from public.map_node_goals g where g.id = v_goal;

    select count(*) - v_audit0 into v_audit
      from public.config_audit where table_name = 'map_node_goals';

    raise exception using errcode = 'OT027', message = 'probe rollback';
  exception
    when sqlstate 'OT027' then
      null;
  end;

  if v_after is distinct from v_before then
    raise exception
      'NphiesCore 0027 FAILED: saving a goal that changed nothing changed the row. Before: %. After: %. map_node_goals_touch() is not pinning one of updated_at / updated_by / created_at / created_by in its else arm — and because the audit trigger subtracts updated_at from its compare, a client that moves ONLY that column leaves no trail at all. "Who moved the date, and when" is the question this table exists to answer.',
      v_before, v_after;
  end if;

  -- Exactly 1: the INSERT. Neither no-op update may add a second.
  if v_audit <> 1 then
    raise exception
      'NphiesCore 0027 FAILED: creating a goal and then saving it twice unchanged wrote % config_audit rows, expected exactly 1 (the insert). The trail is filling with rows recording that nothing happened, which is how an audit log stops being read — and this is the table whose audit trigger is the point of the table.',
      v_audit;
  end if;

  raise notice
    'NphiesCore 0027 probe 4: a one-field updated_at PATCH and a full unchanged re-save both left the goal byte-identical (updated_at, updated_by, created_at and created_by were all pinned back) and wrote no audit row beyond the insert. Rolled back.';
end
$noop$;
