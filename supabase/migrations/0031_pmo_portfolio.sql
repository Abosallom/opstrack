-- 0031 — the PMO portfolio: projects, initiatives, actions, risks, revenue, OKRs.
--
-- ═══ WHAT THIS IS, AND WHY IT IS NOT map_nodes ═══
--
-- The PMO section of this app was built by reading `map_nodes` and calling each
-- organization a "project". It is not one. The owner's live PMO dashboard tracks
-- THIRTEEN projects — "Healthcare Facility Funding", "National Health Insurance
-- Centre", "Approvals Management System" — each with a manager, a budget in SAR,
-- a start and an end date, a four-step phase ladder and an actual-versus-planned
-- percentage. This workspace's map tracks a hundred and four HEALTHCARE
-- ORGANIZATIONS moving along a seven-rung onboarding ladder.
--
-- They are different objects at different grain and they share only people. So
-- the PMO gets its own tables rather than a second reading of somebody else's.
-- The onboarding view keeps its name — `pmo.delivery`, "Onboarding delivery" —
-- and stops pretending to be a project register.
--
--
-- ═══ EVERYTHING HERE CAN NAME A JIRA ISSUE ═══
--
-- Every table below carries `source` + `external_ref`, which is 0023's and
-- 0024's contract verbatim: `source in ('local','jira')` and a nullable issue
-- key. A project, an initiative, an action, a risk, a revenue line, an objective
-- and a key result can each point at the Jira issue it mirrors.
--
-- ⚠ THE URL IS NOT STORED, and that is the one place this file departs from
--   `map_nodes`, which carries `external_url` beside the key. A Jira browse URL
--   is `<site>/browse/<KEY>` and nothing else; `lib/jira/types.ts`'s
--   `browseUrlFor()` already computes it, is pure, and is tested. Storing it
--   would put the SITE ADDRESS in six more tables, and the day that address
--   changes — a rename, a migration to a new Atlassian tenant — every stored URL
--   in the workspace becomes a dead link with no way to tell which. A key plus
--   one setting is one edit; a key plus six tables of URLs is a data migration.
--
--
-- ═══ THE PERMISSION SENTENCE ═══
--
--   What the programme IS, is the Directors'. How it is GOING, is the team's.
--
-- 0027 drew this line for goals and this file keeps it on the same side:
--
--   `structure.edit`  projects, initiatives, revenue lines, objectives, key
--                     results, milestones — the definitions, and every one of
--                     them audited. "Who moved the budget" is the question these
--                     tables will be asked.
--   `capture.write`   actions and risks — day-to-day fieldwork, the register a
--                     huddle edits live, and deliberately NOT audited: an audit
--                     row per checkbox is noise that buries the rows that matter.
--
-- ⚠ NO NEW PERMISSION KEY. 0025's probe 1 refuses to apply if Admin holds fewer
--   than five keys, so a sixth would turn that count into a coded value inside
--   an already-applied file. The two existing keys carry this whole file.
--
--
-- ═══ VARIANCE IS DERIVED AND IS NEVER A COLUMN ═══
--
-- The source dashboard prints a variance chip — `0%`, `−16%`, `−30%` — on every
-- project card. It is `actual − planned` and it is computed at read time here.
-- A stored `variance` is a third number that can disagree with the two it comes
-- from, and the first PATCH that sets one without the others makes the card lie
-- in a way nothing can detect. `lib/pmo/summary.ts` already refuses the same
-- thing for lateness.
--
--
-- ═══ TWO REGISTERS, ONE TABLE ═══
--
-- The dashboard lists "Challenges" and "Risks" as two tables with identical
-- columns — project, description, level, impact, mitigation, status. That is one
-- shape read two ways, so it is one table with a `register` column. Two tables
-- would mean two sets of policies, two triggers and two of every query, to
-- express a difference that is a single word.
--
--
-- ═══ WHAT THIS FILE DOES NOT TOUCH ═══
--
-- `map_nodes`, `map_node_goals`, `entries`, `profiles`, `roles`,
-- `role_permissions`, `is_member()`, `has_perm()`, `log_config_audit()`, or any
-- policy 0023/0024/0025/0026/0027 owns. It is additive: seven new tables, one
-- view, and nothing else changes.

begin;

-- ═══════════════════════ 0. refuse rather than half-apply ═══════════════════

do $$
begin
  if to_regprocedure('public.has_perm(text)') is null then
    raise exception
      'NphiesCore 0031 CANNOT APPLY: public.has_perm(text) does not exist. Apply 0025_roles_permissions.sql first — every write policy in this file is has_perm(''structure.edit'') or has_perm(''capture.write''), and this file adds NO new permission key precisely so 0025 never has to be re-run.';
  end if;

  if to_regprocedure('public.is_member()') is null then
    raise exception
      'NphiesCore 0031 CANNOT APPLY: public.is_member() does not exist. Apply 0001 first — every select policy in this file is is_member().';
  end if;

  if to_regprocedure('public.log_config_audit(text,uuid,text,jsonb,jsonb)') is null then
    raise exception
      'NphiesCore 0031 CANNOT APPLY: public.log_config_audit(...) does not exist. Apply 0002_config_foundation.sql first — the definition tables in this file are audited, which is the whole reason they sit behind structure.edit.';
  end if;
end $$;

-- ═══════════════════════ 1. projects ════════════════════════════════════════

create table if not exists public.pmo_projects (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  name_ar      text not null default '',
  -- The person answerable for it. `set null` rather than cascade, for
  -- `map_nodes.account_manager_id`'s reason: a project does not stop existing
  -- because somebody left, it becomes a project with nobody named on it.
  manager_id   uuid references public.profiles (id) on delete set null,
  -- SAR, as a whole number. `numeric` rather than a float: this is money, and
  -- 54,848,411 has to come back as 54,848,411. NULL is "no budget recorded",
  -- which is different from a budget of zero and is the commonest state on the
  -- source dashboard's own initiative cards.
  budget       numeric(14, 2),
  currency     text not null default 'SAR',
  start_date   date,
  end_date     date,
  -- THE FOUR-STEP LADDER, as the source dashboard draws it. A closed check
  -- rather than a lookup table: unlike the onboarding ladder — which the owner
  -- renames, reorders and adds expected-days to — this one is a fixed project
  -- lifecycle. The WORDS are i18n keys and are renameable through Terminology;
  -- the four steps are not data.
  phase        text not null default 'start'
               check (phase in ('start', 'planning', 'execution', 'closure')),
  -- 0..100, both of them, and NEITHER defaults to zero. NULL means "nobody has
  -- said", which the honesty rule this workspace runs on requires: a project at
  -- 0% because nothing has happened and one at 0% because nobody has updated it
  -- are different sentences, and the source dashboard shows ten initiatives all
  -- reading 0% precisely because it cannot tell them apart.
  actual_pct   int check (actual_pct between 0 and 100),
  planned_pct  int check (planned_pct between 0 and 100),
  -- "This week's tasks" on the card. Free text, '' rather than null for
  -- `map_nodes.vendor`'s reason: a three-state string/null/'' is a bug waiting
  -- for the first filter.
  note         text not null default '',
  note_ar      text not null default '',
  source       text not null default 'local' check (source in ('local', 'jira')),
  external_ref text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.profiles (id) on delete set null,
  updated_by   uuid references public.profiles (id) on delete set null
);

comment on table public.pmo_projects is
  'A PMO project — manager, budget in SAR, dates, a four-step phase and an actual-versus-planned reading. NOT a map_nodes row: the map tracks healthcare organizations onboarding, this tracks the programme''s own projects. Variance is actual_pct - planned_pct and is deliberately not a column.';

comment on column public.pmo_projects.actual_pct is
  'NULL means nobody has said. It is NOT zero. A project at 0% because nothing has happened and one nobody has updated are different facts, and a NOT NULL DEFAULT 0 here would erase the difference on every row ever inserted.';

comment on column public.pmo_projects.external_ref is
  'The Jira issue key this project mirrors, or NULL. The browse URL is COMPUTED from it by lib/jira/types.ts browseUrlFor() against the configured site address — deliberately not stored, so moving Atlassian tenants is one setting rather than a data migration across six tables.';

-- ═══════════════════════ 2. initiatives ═════════════════════════════════════

create table if not exists public.pmo_initiatives (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  name_ar      text not null default '',
  manager_id   uuid references public.profiles (id) on delete set null,
  -- ⚠ A DIFFERENT LADDER FROM A PROJECT'S, and this is the whole reason an
  --   initiative is its own table rather than a `kind` column on the one above.
  --   The source dashboard runs initiatives through Planning → Execution →
  --   Evaluation → Dissemination. Sharing a table would mean one check
  --   constraint holding eight values of which four are illegal for each row —
  --   a constraint that cannot state the rule it exists for.
  phase        text not null default 'planning'
               check (phase in ('planning', 'execution', 'evaluation', 'dissemination')),
  -- Internal or external. Where a project carries a budget, an initiative
  -- carries this: the source dashboard filters on it and shows no money.
  kind         text not null default 'internal' check (kind in ('internal', 'external')),
  start_date   date,
  end_date     date,
  actual_pct   int check (actual_pct between 0 and 100),
  planned_pct  int check (planned_pct between 0 and 100),
  -- "This week's goal", where a project has "this week's tasks".
  note         text not null default '',
  note_ar      text not null default '',
  source       text not null default 'local' check (source in ('local', 'jira')),
  external_ref text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.profiles (id) on delete set null,
  updated_by   uuid references public.profiles (id) on delete set null
);

comment on table public.pmo_initiatives is
  'An initiative — its own four-step ladder (planning/execution/evaluation/dissemination), an internal-or-external kind where a project has a budget, and the same honest nullable percentages. A separate table from pmo_projects because the two ladders are different and one check constraint cannot state both.';

-- ═══════════════════════ 3. actions ═════════════════════════════════════════

create table if not exists public.pmo_actions (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  detail       text not null default '',
  -- TWO OWNERS, NAMED SEPARATELY. The source dashboard shows one or two owner
  -- chips on a follow-up row and this is the honest shape for that: an array
  -- would need its own check for length and its own FK story, and a join table
  -- would be three more objects to express "at most two".
  owner_id     uuid references public.profiles (id) on delete set null,
  owner2_id    uuid references public.profiles (id) on delete set null,
  -- The project or initiative it belongs to, or neither. Both nullable: the
  -- huddle list on the source dashboard carries rows that belong to no project.
  project_id   uuid references public.pmo_projects (id) on delete cascade,
  initiative_id uuid references public.pmo_initiatives (id) on delete cascade,
  -- `date`, not `timestamptz`: a due date is a calendar day somebody said out
  -- loud, and a time zone would render "10 Aug" as 9 Aug for a reader in the
  -- wrong offset. 0027's target_date makes the same call.
  due_date     date,
  done_at      timestamptz,
  source       text not null default 'local' check (source in ('local', 'jira')),
  external_ref text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.profiles (id) on delete set null,
  updated_by   uuid references public.profiles (id) on delete set null
);

comment on table public.pmo_actions is
  'A follow-up action from the PMO huddle: a title, up to two owners, a due date and a done stamp. Member-writable (capture.write) and NOT audited — this is the register a meeting edits live, and an audit row per checkbox would bury the rows that matter.';

comment on column public.pmo_actions.done_at is
  'NULL is open. A timestamp is the moment it was closed — kept rather than a boolean so "7 open, 5 complete" can become "closed this week" without a schema change.';

-- ═══════════════════════ 4. risks and challenges ════════════════════════════

create table if not exists public.pmo_risks (
  id           uuid primary key default gen_random_uuid(),
  -- THE ONE WORD THAT SEPARATES THE DASHBOARD'S TWO TABLES. See the header.
  register     text not null default 'risk' check (register in ('risk', 'challenge')),
  project_id   uuid references public.pmo_projects (id) on delete cascade,
  initiative_id uuid references public.pmo_initiatives (id) on delete cascade,
  summary      text not null,
  -- How bad, and how likely it is to matter. Both closed and both nullable:
  -- "nobody has graded this yet" is a real state on a fresh register.
  level        text check (level in ('low', 'medium', 'high')),
  impact       text check (impact in ('low', 'medium', 'high')),
  mitigation   text not null default '',
  status       text not null default 'open' check (status in ('open', 'watching', 'closed')),
  source       text not null default 'local' check (source in ('local', 'jira')),
  external_ref text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.profiles (id) on delete set null,
  updated_by   uuid references public.profiles (id) on delete set null
);

comment on table public.pmo_risks is
  'Both of the source dashboard''s registers in one table. `register` is the only difference between a Risk and a Challenge — identical columns, read separately — so two tables would be two sets of policies and triggers to express one word.';

-- ═══════════════════════ 5. revenue ═════════════════════════════════════════

create table if not exists public.pmo_revenue (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.pmo_projects (id) on delete cascade,
  -- A calendar year and a quarter, rather than a date range. The source
  -- dashboard's table is literally Q1..Q4 columns per project per year, and a
  -- range would let two rows overlap and make the column sums wrong with no
  -- constraint able to notice.
  year         int not null check (year between 2000 and 2100),
  quarter      int not null check (quarter between 1 and 4),
  planned      numeric(14, 2),
  achieved     numeric(14, 2),
  currency     text not null default 'SAR',
  source       text not null default 'local' check (source in ('local', 'jira')),
  external_ref text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.profiles (id) on delete set null,
  updated_by   uuid references public.profiles (id) on delete set null,
  -- ONE ROW PER PROJECT PER QUARTER. Without this a second row for Q1 double
  -- counts silently into every total on the page, and the failure is invisible
  -- because both rows are individually correct.
  unique (project_id, year, quarter)
);

comment on table public.pmo_revenue is
  'Planned and achieved revenue per project per quarter, in SAR. Unique on (project, year, quarter) because a duplicate quarter double-counts into every total on the page and both rows look right on their own.';

comment on column public.pmo_revenue.achieved is
  'NULL means the quarter has not been reported, which is different from a quarter that earned nothing. The source dashboard footnotes one of its own figures as covering only the first half of the year for exactly this reason.';

-- ═══════════════════════ 6. OKRs ════════════════════════════════════════════

create table if not exists public.pmo_objectives (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  name_ar      text not null default '',
  owner_id     uuid references public.profiles (id) on delete set null,
  -- The window it is committed for. Free text on purpose — "2026", "H1 2026",
  -- "Q3" — because every organization names its own periods and a frozen
  -- vocabulary here would be wrong for somebody by the second quarter.
  period       text not null default '',
  status       text not null default 'active' check (status in ('active', 'closed')),
  source       text not null default 'local' check (source in ('local', 'jira')),
  external_ref text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.profiles (id) on delete set null,
  updated_by   uuid references public.profiles (id) on delete set null
);

create table if not exists public.pmo_key_results (
  id           uuid primary key default gen_random_uuid(),
  objective_id uuid not null references public.pmo_objectives (id) on delete cascade,
  name         text not null,
  name_ar      text not null default '',
  -- ⚠ MEASURABLE, WHICH IS THE WHOLE POINT OF A KEY RESULT. `target` is NOT
  --   NULL: a key result without a number to reach is an objective wearing the
  --   wrong hat, and the view below could not roll it up. `start_value` is where
  --   the measure stood when the commitment was made — without it a KR going
  --   from 40 to 60 against a target of 100 reads as 60% done when it is 33%.
  start_value  numeric(14, 2) not null default 0,
  target_value numeric(14, 2) not null,
  current_value numeric(14, 2),
  unit         text not null default '',
  source       text not null default 'local' check (source in ('local', 'jira')),
  external_ref text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.profiles (id) on delete set null,
  updated_by   uuid references public.profiles (id) on delete set null,
  -- A target equal to the start is a measure that cannot move, and every
  -- percentage derived from it divides by zero. Refused at the door.
  constraint pmo_key_results_measurable check (target_value <> start_value)
);

comment on table public.pmo_key_results is
  'The measurable half of an OKR. target_value is NOT NULL and must differ from start_value: a key result with nothing to reach cannot be rolled up, and a target equal to the start divides by zero in every percentage derived from it.';

-- Objective progress, ROLLED UP AND NEVER TYPED.
--
-- An objective has no percentage column and must not grow one. Its progress is
-- the mean of its key results' progress, each clamped to 0..100 — a KR that
-- overshot its target is done, not 140% done, and letting one run past 100 would
-- let a single overachieving measure hide two that never moved.
--
-- `current_value` NULL means nobody has checked in; such a KR contributes 0
-- rather than being dropped from the denominator, because "not started" is
-- progress information and excluding it would make an objective with one live KR
-- and five untouched ones read as complete.
create or replace view public.v_pmo_objective_progress as
  select
    o.id as objective_id,
    count(kr.id) as key_results,
    count(kr.current_value) as checked_in,
    case
      when count(kr.id) = 0 then null
      else round(avg(
        least(100, greatest(0,
          ((coalesce(kr.current_value, kr.start_value) - kr.start_value)
            / (kr.target_value - kr.start_value)) * 100
        ))
      ))
    end as progress_pct
  from public.pmo_objectives o
  left join public.pmo_key_results kr on kr.objective_id = o.id
  group by o.id;

comment on view public.v_pmo_objective_progress is
  'Objective progress as the mean of its key results, each clamped to 0..100. There is deliberately no progress column on pmo_objectives: a typed number and a computed one disagree the first time somebody edits a key result and forgets the parent.';

-- ═══════════════════════ 7. milestones ══════════════════════════════════════

create table if not exists public.pmo_milestones (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid references public.pmo_projects (id) on delete cascade,
  initiative_id uuid references public.pmo_initiatives (id) on delete cascade,
  name         text not null,
  name_ar      text not null default '',
  due_date     date not null,
  done_at      timestamptz,
  source       text not null default 'local' check (source in ('local', 'jira')),
  external_ref text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.profiles (id) on delete set null,
  updated_by   uuid references public.profiles (id) on delete set null
);

comment on table public.pmo_milestones is
  'The next dated things — the source dashboard''s runway strip. due_date is NOT NULL because a milestone with no date is not a milestone; "days remaining" is computed at read time against the reader''s own today, never stored.';

-- ═══════════════════════ 8. indexes ═════════════════════════════════════════

-- The reads this page actually makes: everything for a project, the open
-- actions, the register split, and the quarter columns in order.
create index if not exists pmo_actions_open_idx
  on public.pmo_actions (due_date) where done_at is null;
create index if not exists pmo_actions_project_idx on public.pmo_actions (project_id);
create index if not exists pmo_risks_register_idx on public.pmo_risks (register, status);
create index if not exists pmo_revenue_project_idx on public.pmo_revenue (project_id, year, quarter);
create index if not exists pmo_key_results_objective_idx on public.pmo_key_results (objective_id);
create index if not exists pmo_milestones_due_idx
  on public.pmo_milestones (due_date) where done_at is null;

-- The Jira join, mirroring 0023:484. Partial, because the overwhelming majority
-- of rows will never name an issue.
create index if not exists pmo_projects_external_idx
  on public.pmo_projects (source, external_ref) where external_ref is not null;
create index if not exists pmo_initiatives_external_idx
  on public.pmo_initiatives (source, external_ref) where external_ref is not null;
create index if not exists pmo_actions_external_idx
  on public.pmo_actions (source, external_ref) where external_ref is not null;
create index if not exists pmo_risks_external_idx
  on public.pmo_risks (source, external_ref) where external_ref is not null;

-- ═══════════════════════ 9. RLS ═════════════════════════════════════════════
--
-- SELECT is `is_member()` on every table: a signed-in member reads the whole
-- portfolio, which is what a PMO report is for. Writes split on the sentence in
-- the header — definitions to structure.edit, fieldwork to capture.write.

alter table public.pmo_projects    enable row level security;
alter table public.pmo_initiatives enable row level security;
alter table public.pmo_actions     enable row level security;
alter table public.pmo_risks       enable row level security;
alter table public.pmo_revenue     enable row level security;
alter table public.pmo_objectives  enable row level security;
alter table public.pmo_key_results enable row level security;
alter table public.pmo_milestones  enable row level security;

do $$
declare
  t text;
  definition_tables text[] := array[
    'pmo_projects', 'pmo_initiatives', 'pmo_revenue',
    'pmo_objectives', 'pmo_key_results', 'pmo_milestones'
  ];
  fieldwork_tables text[] := array['pmo_actions', 'pmo_risks'];
begin
  -- WRITTEN AS A LOOP rather than fifty hand-copied policies. Every table here
  -- takes exactly one of two shapes, and forty lines of near-identical SQL is
  -- where a single wrong key hides — 0025's own header makes this argument
  -- about its policy rewrite.
  foreach t in array definition_tables || fieldwork_tables loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format(
      'create policy %I_select on public.%I for select using ((select public.is_member()))', t, t);
  end loop;

  foreach t in array definition_tables loop
    execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format('drop policy if exists %I_delete on public.%I', t, t);
    execute format(
      'create policy %I_insert on public.%I for insert with check ((select public.has_perm(''structure.edit'')))', t, t);
    execute format(
      'create policy %I_update on public.%I for update using ((select public.has_perm(''structure.edit''))) with check ((select public.has_perm(''structure.edit'')))', t, t);
    execute format(
      'create policy %I_delete on public.%I for delete using ((select public.has_perm(''structure.edit'')))', t, t);
  end loop;

  foreach t in array fieldwork_tables loop
    execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format('drop policy if exists %I_delete on public.%I', t, t);
    execute format(
      'create policy %I_insert on public.%I for insert with check ((select public.has_perm(''capture.write'')))', t, t);
    execute format(
      'create policy %I_update on public.%I for update using ((select public.has_perm(''capture.write''))) with check ((select public.has_perm(''capture.write'')))', t, t);
    -- ⚠ DELETE IS STILL structure.edit ON THE FIELDWORK TABLES. A member may
    --   raise a risk, grade it, mitigate it and close it; removing the row so
    --   that nobody can see it was ever raised is a different act, and it is the
    --   one the register exists to prevent. Closing is `status = 'closed'`.
    execute format(
      'create policy %I_delete on public.%I for delete using ((select public.has_perm(''structure.edit'')))', t, t);
  end loop;
end $$;

-- ═══════════════════════ 10. touch and audit ════════════════════════════════
--
-- One generic touch function rather than eight copies of 0027's. It is written
-- once against `to_jsonb(new)` and attached to every table, and it pins BOTH
-- `updated_at` and `updated_by` on the no-change branch for the reason 0027
-- spells out at length: subtracting them from the diff and then leaving NEW
-- alone hands a client a one-field PATCH that erases the mark, moves the clock
-- backwards, and writes no audit row at all.

create or replace function public.pmo_touch()
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
    new.updated_by := old.updated_by;
    new.updated_at := old.updated_at;
  end if;
  new.created_at := old.created_at;
  new.created_by := old.created_by;
  return new;
end;
$$;

create or replace function public.pmo_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.created_by := coalesce(
    (select p.id from public.profiles p where p.id = auth.uid()), new.created_by);
  new.updated_by := new.created_by;
  return new;
end;
$$;

-- The audit trigger, attached ONLY to the definition tables. `TG_TABLE_NAME`
-- carries the table into `log_config_audit`, so this is one function rather than
-- six that differ by a string literal.
create or replace function public.pmo_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_config_audit(tg_table_name, new.id, 'insert', null, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    -- `updated_at`/`updated_by` subtracted from BOTH sides for 0027's reason:
    -- otherwise every touch writes an audit row saying only that a clock moved.
    if (to_jsonb(new) - 'updated_at' - 'updated_by')
       is distinct from
       (to_jsonb(old) - 'updated_at' - 'updated_by') then
      perform public.log_config_audit(tg_table_name, new.id, 'update', to_jsonb(old), to_jsonb(new));
    end if;
    return new;
  else
    perform public.log_config_audit(tg_table_name, old.id, 'delete', to_jsonb(old), null);
    return old;
  end if;
end;
$$;

do $$
declare
  t text;
  all_tables text[] := array[
    'pmo_projects', 'pmo_initiatives', 'pmo_actions', 'pmo_risks',
    'pmo_revenue', 'pmo_objectives', 'pmo_key_results', 'pmo_milestones'
  ];
  audited_tables text[] := array[
    'pmo_projects', 'pmo_initiatives', 'pmo_revenue',
    'pmo_objectives', 'pmo_key_results', 'pmo_milestones'
  ];
begin
  foreach t in array all_tables loop
    execute format('drop trigger if exists %I_stamp_trg on public.%I', t, t);
    execute format(
      'create trigger %I_stamp_trg before insert on public.%I for each row execute function public.pmo_stamp()', t, t);
    execute format('drop trigger if exists %I_touch_trg on public.%I', t, t);
    execute format(
      'create trigger %I_touch_trg before update on public.%I for each row execute function public.pmo_touch()', t, t);
  end loop;

  foreach t in array audited_tables loop
    execute format('drop trigger if exists %I_audit_trg on public.%I', t, t);
    execute format(
      'create trigger %I_audit_trg after insert or update or delete on public.%I for each row execute function public.pmo_audit()', t, t);
  end loop;
end $$;

-- ═══════════════════════ 11. probes ═════════════════════════════════════════
--
-- Each one asserts a decision this file argued for above, so that applying it
-- against a project where one of them is untrue fails loudly here rather than
-- quietly on a screen three weeks later.

do $$
declare
  n int;
  ok boolean;
begin
  -- 1. Eight tables and one view exist.
  select count(*) into n from information_schema.tables
   where table_schema = 'public'
     and table_name in ('pmo_projects','pmo_initiatives','pmo_actions','pmo_risks',
                        'pmo_revenue','pmo_objectives','pmo_key_results','pmo_milestones');
  if n <> 8 then
    raise exception 'NphiesCore 0031 probe 1 FAILED: expected 8 pmo_* tables, found %.', n;
  end if;

  if to_regclass('public.v_pmo_objective_progress') is null then
    raise exception 'NphiesCore 0031 probe 1 FAILED: v_pmo_objective_progress was not created.';
  end if;

  -- 2. NO table grew a variance or a progress column. This is the file's
  --    loudest claim and the easiest one to undo by accident later.
  select count(*) into n from information_schema.columns
   where table_schema = 'public'
     and table_name in ('pmo_projects','pmo_initiatives','pmo_objectives')
     and column_name in ('variance', 'variance_pct', 'progress', 'progress_pct');
  if n <> 0 then
    raise exception
      'NphiesCore 0031 probe 2 FAILED: % derived column(s) were stored. Variance is actual_pct - planned_pct and objective progress is v_pmo_objective_progress; a stored copy disagrees with its inputs the first time somebody PATCHes one of them.', n;
  end if;

  -- 3. Every table can name a Jira issue — the owner's requirement, checked
  --    rather than assumed, because it is eight tables and one omission is
  --    invisible until somebody tries to link a row.
  select count(*) into n from information_schema.columns
   where table_schema = 'public'
     and table_name like 'pmo\_%'
     and column_name = 'external_ref';
  if n <> 8 then
    raise exception
      'NphiesCore 0031 probe 3 FAILED: only % of 8 pmo_* tables carry external_ref. Every one of them must be able to reference a Jira issue.', n;
  end if;

  -- 4. RLS is on everywhere. A table with policies and RLS disabled is a table
  --    with no policies at all, and it reads as configured.
  select bool_and(c.relrowsecurity) into ok
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and c.relname like 'pmo\_%' and c.relkind = 'r';
  if not coalesce(ok, false) then
    raise exception 'NphiesCore 0031 probe 4 FAILED: row level security is not enabled on every pmo_* table.';
  end if;

  -- 5. A key result cannot be unmeasurable. The constraint is the only thing
  --    standing between the view and a division by zero.
  begin
    insert into public.pmo_objectives (id, name) values
      ('00000000-0000-0000-0000-0000000031aa', 'probe');
    insert into public.pmo_key_results (objective_id, name, start_value, target_value)
      values ('00000000-0000-0000-0000-0000000031aa', 'probe', 10, 10);
    raise exception
      'NphiesCore 0031 probe 5 FAILED: a key result with target_value = start_value was accepted. Every percentage derived from it divides by zero.';
  exception
    when check_violation then null;
  end;
  delete from public.pmo_objectives where id = '00000000-0000-0000-0000-0000000031aa';

  -- 6. Two revenue rows for one quarter are refused. Without this the totals on
  --    the page are wrong and both rows look correct on their own.
  begin
    insert into public.pmo_projects (id, name) values
      ('00000000-0000-0000-0000-0000000031bb', 'probe');
    insert into public.pmo_revenue (project_id, year, quarter, planned)
      values ('00000000-0000-0000-0000-0000000031bb', 2026, 1, 100);
    insert into public.pmo_revenue (project_id, year, quarter, planned)
      values ('00000000-0000-0000-0000-0000000031bb', 2026, 1, 200);
    raise exception
      'NphiesCore 0031 probe 6 FAILED: a duplicate (project, year, quarter) revenue row was accepted and would double-count into every total.';
  exception
    when unique_violation then null;
  end;
  delete from public.pmo_projects where id = '00000000-0000-0000-0000-0000000031bb';

  raise notice 'NphiesCore 0031: 6 probes passed. 8 tables, 1 view, Jira reference on every table.';
end $$;

commit;
