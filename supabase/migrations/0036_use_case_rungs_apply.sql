-- 0036 — each use case gets its own ladder, by saying which rungs apply to it.
--
-- ── THE OWNER'S SENTENCE ───────────────────────────────────────────────────
--
--   "each use case has its own phases"
--
-- and, asked what differs: the FIVE ARE THE SAME FIVE, but some do not apply to
-- some use cases. Intake → DEV → STG/TEST → COC → PROD stays the vocabulary of
-- the whole programme; what varies is which stops a given capability actually
-- makes. Vital Signs may never have a separate test stage. ADT has all five.
--
-- ⚠ SO THIS FILE DOES NOT MAKE THE LADDER CONFIGURABLE, AND THAT IS THE WHOLE
--   DESIGN. `map_node_use_cases.rung`'s CHECK still lists exactly five values
--   and 0032's event log still records those five, because renaming DEV for one
--   capability and not another would make "how many are past DEV" a question
--   with no answer. `map_node_stages` (0026) is a table because those seven
--   words are Aziz's to rename; these five are the programme's, shared with
--   CHI, and printed in the announcement in both languages.
--
--   What is configurable is MEMBERSHIP: a row here means "this rung applies to
--   this use case". That is why the table has no `name`, no `name_ar` and no
--   `sort_order` — the five already have all three, in code, identically for
--   everybody. A table that repeated them would be five more places for the
--   word "STG/TEST" to drift.
--
-- ── AND WHY IT IS A TABLE AT ALL ──────────────────────────────────────────
--
-- The alternative was a seeded list in SQL, changed by a migration. Aziz chose
-- the table, and the reason it is the right call is `map_node_stages`' own: the
-- shape of the programme is edited by the person running it, at the hour they
-- learn something, not by whoever is free to write a migration that week.
--
-- ── expected_days RIDES ALONG, AND EARNS ITS KEEP ─────────────────────────
--
-- OPERATING-MODEL §11.3.2's rung budget is per (use case × rung) or it is
-- nothing: ten days at STG/TEST for a Lab Result is not ten days at STG/TEST
-- for ADT, and one number for the whole estate would fire on the wrong half of
-- it. This is the only table where that number has a home, so it is added now
-- rather than in an 0038 that has to re-open every row.
--
-- ⚠ NULL MEANS NO BUDGET, exactly as `map_node_stages.expected_days` does, and
--   nothing may print a day count from it yet in any case — every one of the
--   1,540 links still carries `updated_by = null`, so `buildObMonitor`'s
--   `budgetMeasurable` is false and stays false until a person moves a rung.
--   The column is the threshold, not the permission to use it.
--
-- ── WHAT THIS FILE REFUSES TO LET ANYBODY DO ──────────────────────────────
--
-- Two guards, and both exist because the failure they prevent is silent:
--
--  1. A RUNG CANNOT BE SWITCHED OFF WHILE A PAIR IS STANDING ON IT. Otherwise
--     Vital Signs at STG/TEST becomes a row whose own use case says that rung
--     does not exist — it draws nowhere, sorts nowhere, and is counted by
--     everything. The delete is refused and names how many rows are in the way.
--
--  2. `intake` AND `prod` CANNOT BE SWITCHED OFF AT ALL. 1,029 of the 1,540
--     links sit at intake today, so removing it would orphan two thirds of the
--     estate in one click; and a ladder with no PROD is a ladder a capability
--     can never finish — 211 pairs are already standing on it. A use case that
--     genuinely never goes live is `scope = 'not_applicable'` on the pair,
--     which 0032 already has.
--
-- ── THE TOKEN CONTRACT WITH src/lib/pgError.ts ────────────────────────────
--
-- Every runtime `raise` below carries a token, and the TOKEN — not the SQLSTATE
-- — is what pgError.ts matches to an i18n key. Both files are edited together:
--
--   use_case_rung_in_use        the rung is switched off while pairs stand on it
--   use_case_rung_required      somebody tried to remove intake or prod
--   use_case_rung_not_applicable a pair was moved to a rung its use case does
--                               not have — the write guard, which is the half
--                               that makes the whole table mean something
--
-- Plus the constraint names pgError.ts matches directly:
--
--   use_case_rungs_use_case_id_rung_key  → mapadmin.errRungAlreadyApplies
--   use_case_rungs_expected_days_chk     → mapadmin.errRungExpectedDays

-- ── preflight ───────────────────────────────────────────────────────────────
do $preflight$
begin
  if to_regclass('public.use_cases') is null then
    raise exception
      'NphiesCore 0036 CANNOT APPLY: public.use_cases does not exist. Apply 0024_map_use_cases.sql first.';
  end if;
  if to_regclass('public.map_node_use_cases') is null then
    raise exception
      'NphiesCore 0036 CANNOT APPLY: public.map_node_use_cases does not exist. Apply 0024_map_use_cases.sql first.';
  end if;
  -- 0032 is what makes `rung` a column at all; without it the guard below has
  -- nothing to guard and the seed has no meaning.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'map_node_use_cases' and column_name = 'rung'
  ) then
    raise exception
      'NphiesCore 0036 CANNOT APPLY: map_node_use_cases.rung does not exist. Apply 0032_use_case_rungs.sql first.';
  end if;
  if to_regprocedure('public.log_config_audit(text, uuid, text, jsonb, jsonb)') is null then
    raise exception
      'NphiesCore 0036 CANNOT APPLY: public.log_config_audit() does not exist. Apply 0002_config_foundation.sql first — which rungs a capability has is configuration, and it is audited.';
  end if;
end
$preflight$;


-- ── use_case_rungs ──────────────────────────────────────────────────────────
--
-- A SURROGATE uuid AND a unique pair, not a composite primary key, for one
-- concrete reason: `log_config_audit(text, uuid, ...)` takes a single uuid as
-- the row it is recording, and a composite key has none to give it. 0018:113
-- made the same call for the same kind of table.
create table if not exists public.use_case_rungs (
  id            uuid primary key default gen_random_uuid(),
  use_case_id   uuid not null references public.use_cases (id) on delete cascade,
  rung          text not null,
  expected_days int,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.profiles (id) on delete set null,
  updated_by    uuid references public.profiles (id) on delete set null
);

-- `create table if not exists` PLUS a separate `add column if not exists` per
-- column, on 0026's and 0027's habit: a partial earlier cut of this file leaves
-- a table whose later columns are missing, and the `if not exists` on the table
-- would then skip them forever in silence.
alter table public.use_case_rungs add column if not exists use_case_id   uuid references public.use_cases (id) on delete cascade;
alter table public.use_case_rungs add column if not exists rung          text;
alter table public.use_case_rungs add column if not exists expected_days int;
alter table public.use_case_rungs add column if not exists created_at    timestamptz not null default now();
alter table public.use_case_rungs add column if not exists updated_at    timestamptz not null default now();
alter table public.use_case_rungs add column if not exists created_by    uuid references public.profiles (id) on delete set null;
alter table public.use_case_rungs add column if not exists updated_by    uuid references public.profiles (id) on delete set null;

-- THE SAME FIVE AS 0032's CHECK, WORD FOR WORD. If a sixth rung is ever added
-- to the programme it is added in both places in one migration, or this table
-- can hold a membership the links column cannot represent.
alter table public.use_case_rungs drop constraint if exists use_case_rungs_rung_chk;
alter table public.use_case_rungs
  add constraint use_case_rungs_rung_chk
  check (rung in ('intake', 'dev', 'stg', 'coc', 'prod'));

alter table public.use_case_rungs drop constraint if exists use_case_rungs_expected_days_chk;
alter table public.use_case_rungs
  add constraint use_case_rungs_expected_days_chk
  check (expected_days is null or expected_days > 0);

-- One row per (capability, rung). The UNIQUE is what makes "does this rung
-- apply" a lookup rather than a count, and pgError.ts maps its name.
create unique index if not exists use_case_rungs_use_case_id_rung_key
  on public.use_case_rungs (use_case_id, rung);

comment on table public.use_case_rungs is
  'Which of the five rungs each capability actually passes through. A row means the rung APPLIES. The five names and their order live in code (src/types.ts USE_CASE_RUNGS) and are deliberately not repeated here: they are the programme''s shared vocabulary, not this workspace''s to rename. expected_days is §11.3.2''s per-(use case, rung) budget and is null until somebody sets one.';

alter table public.use_case_rungs enable row level security;

-- WHICH RUNGS A CAPABILITY HAS IS CONFIGURATION, so it is `structure.edit` to
-- write and every member to read — 0026's split, not 0024's. The contrast with
-- `map_node_use_cases` one table over is the whole permission design: the admin
-- owns the SHAPE of the ladder, the team owns where a hospital got to on it.
drop policy if exists use_case_rungs_select on public.use_case_rungs;
create policy use_case_rungs_select on public.use_case_rungs
  for select using ((select public.is_member()));

drop policy if exists use_case_rungs_insert on public.use_case_rungs;
create policy use_case_rungs_insert on public.use_case_rungs
  for insert with check ((select public.has_perm('structure.edit')));

drop policy if exists use_case_rungs_update on public.use_case_rungs;
create policy use_case_rungs_update on public.use_case_rungs
  for update using ((select public.has_perm('structure.edit')))
  with check ((select public.has_perm('structure.edit')));

drop policy if exists use_case_rungs_delete on public.use_case_rungs;
create policy use_case_rungs_delete on public.use_case_rungs
  for delete using ((select public.has_perm('structure.edit')));

grant select, insert, update, delete on public.use_case_rungs to authenticated;


-- ── touch ───────────────────────────────────────────────────────────────────
-- Diffed rather than stamped, and the else arm PINS updated_at back — 0026's
-- lesson verbatim: every store that holds a row and saves it back on blur sends
-- `updated_at`, and without the pin that PATCH lands the client's value on the
-- row and writes an audit entry recording that nothing happened.
create or replace function public.use_case_rungs_touch()
returns trigger
language plpgsql
as $$
begin
  if to_jsonb(new) - 'updated_at' - 'updated_by' is distinct from to_jsonb(old) - 'updated_at' - 'updated_by' then
    new.updated_at := now();
    new.updated_by := auth.uid();
  else
    new.updated_at := old.updated_at;
    new.updated_by := old.updated_by;
  end if;
  return new;
end;
$$;

drop trigger if exists use_case_rungs_touch_trg on public.use_case_rungs;
create trigger use_case_rungs_touch_trg
  before update on public.use_case_rungs
  for each row execute function public.use_case_rungs_touch();


-- ── audit ───────────────────────────────────────────────────────────────────
-- Switching STG/TEST off for Lab Result restates what "how many are past DEV"
-- means for every Lab Result row, retroactively, for everybody — the exact
-- class of one-person change with no second pair of eyes that config_audit
-- exists for. AFTER, so the image recorded is the one that survived the guard.
create or replace function public.use_case_rungs_audit()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_config_audit('use_case_rungs', new.id, 'insert', null::jsonb, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    if to_jsonb(new) is distinct from to_jsonb(old) then
      perform public.log_config_audit('use_case_rungs', new.id, 'update', to_jsonb(old), to_jsonb(new));
    end if;
    return new;
  else
    perform public.log_config_audit('use_case_rungs', old.id, 'delete', to_jsonb(old), null::jsonb);
    return old;
  end if;
end;
$$;

drop trigger if exists use_case_rungs_audit_trg on public.use_case_rungs;
create trigger use_case_rungs_audit_trg
  after insert or update or delete on public.use_case_rungs
  for each row execute function public.use_case_rungs_audit();


-- ── guard 1: you cannot remove the ground somebody is standing on ───────────
create or replace function public.use_case_rungs_guard_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_standing int;
begin
  -- intake and prod are not switchable. See the header: two thirds of the
  -- estate sits at intake today, and a ladder with no PROD cannot be finished.
  if old.rung in ('intake', 'prod') then
    raise exception
      'use_case_rung_required: % is on every ladder and cannot be removed', old.rung
      using errcode = '23514';
  end if;

  select count(*) into v_standing
    from public.map_node_use_cases l
   where l.use_case_id = old.use_case_id
     and l.rung = old.rung
     -- A pair somebody ruled out is not standing anywhere. 0032's `scope` is
     -- exactly the escape hatch for "this capability does not apply here", so
     -- it must not also block the ladder being narrowed.
     and coalesce(l.scope, 'in_scope') <> 'not_applicable';

  if v_standing > 0 then
    raise exception
      'use_case_rung_in_use: % organizations are at this rung for this use case', v_standing
      using errcode = '23514';
  end if;

  return old;
end;
$$;

drop trigger if exists use_case_rungs_guard_delete_trg on public.use_case_rungs;
create trigger use_case_rungs_guard_delete_trg
  before delete on public.use_case_rungs
  for each row execute function public.use_case_rungs_guard_delete();


-- ── guard 2: a pair cannot move to a rung its use case does not have ────────
--
-- ⚠ THIS IS THE HALF THAT MAKES THE TABLE MEAN ANYTHING. Without it the
--   membership is decoration: the client offers four rungs, and anything that
--   writes without asking — the importer, a future Jira sync, a curl — puts a
--   pair on the fifth and nothing notices.
--
-- ⚠ AND ITS `no rows at all` ARM IS PERMISSIVE ON PURPOSE. A capability with
--   NO rows here is one nobody has configured — a new row added before the
--   seeding trigger below existed, or after somebody deleted its whole set. The
--   choice is between refusing every write against it (a capability that cannot
--   be used and gives no clue why) and allowing all five (its behaviour before
--   this migration). The second is recoverable and the first is not.
create or replace function public.map_node_use_cases_rung_applies()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_configured int;
begin
  if new.rung is null then return new; end if;
  -- Unchanged rungs are not re-checked: narrowing a ladder must not make every
  -- later edit of an unrelated field on a standing row impossible. Guard 1 is
  -- what stops the ladder narrowing under a standing row in the first place.
  if tg_op = 'UPDATE' and new.rung is not distinct from old.rung then return new; end if;

  select count(*) into v_configured
    from public.use_case_rungs r
   where r.use_case_id = new.use_case_id;

  if v_configured = 0 then return new; end if;

  if not exists (
    select 1 from public.use_case_rungs r
     where r.use_case_id = new.use_case_id and r.rung = new.rung
  ) then
    raise exception
      'use_case_rung_not_applicable: this use case does not pass through %', new.rung
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists map_node_use_cases_rung_applies_trg on public.map_node_use_cases;
create trigger map_node_use_cases_rung_applies_trg
  before insert or update on public.map_node_use_cases
  for each row execute function public.map_node_use_cases_rung_applies();


-- ── seed: all five, for every capability that exists ────────────────────────
-- NOTHING CHANGES ON THE DAY THIS RUNS, and that is the point. Every capability
-- gets the full ladder, which is exactly the behaviour before this file; Aziz
-- then switches off what does not apply, one capability at a time, on a screen.
--
-- `do nothing` rather than `do update`, on 0026's seed habit: re-running this
-- migration must not restore a rung somebody deliberately switched off.
insert into public.use_case_rungs (use_case_id, rung)
select u.id, r.rung
  from public.use_cases u
  cross join (values ('intake'), ('dev'), ('stg'), ('coc'), ('prod')) as r(rung)
on conflict (use_case_id, rung) do nothing;


-- ── and a capability created later starts with all five ─────────────────────
-- Without this, adding a capability on the admin screen produces one with an
-- empty ladder. The permissive arm of guard 2 keeps that usable, but "usable
-- because unconfigured" is not a state to leave a new row in.
create or replace function public.use_cases_seed_rungs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.use_case_rungs (use_case_id, rung)
  select new.id, r.rung
    from (values ('intake'), ('dev'), ('stg'), ('coc'), ('prod')) as r(rung)
  on conflict (use_case_id, rung) do nothing;
  return new;
end;
$$;

drop trigger if exists use_cases_seed_rungs_trg on public.use_cases;
create trigger use_cases_seed_rungs_trg
  after insert on public.use_cases
  for each row execute function public.use_cases_seed_rungs();


-- ══════════════════════════════════════════════════════════════════════════
-- PROBES — each raises rather than returning quietly, so a partial apply
-- announces itself instead of leaving a table that looks configured.
-- ══════════════════════════════════════════════════════════════════════════
do $probe$
declare
  v_cases  int;
  v_rows   int;
  v_missing int;
begin
  select count(*) into v_cases from public.use_cases;
  select count(*) into v_rows  from public.use_case_rungs;

  -- 1. Every capability got all five. A capability short of a rung on the day
  --    this runs is a seed that half-applied, and it would silently forbid
  --    moving those pairs through guard 2.
  select count(*) into v_missing
    from public.use_cases u
    cross join (values ('intake'), ('dev'), ('stg'), ('coc'), ('prod')) as r(rung)
    where not exists (
      select 1 from public.use_case_rungs x
       where x.use_case_id = u.id and x.rung = r.rung
    );
  if v_missing > 0 then
    raise exception
      '0036 probe 1: % (capability, rung) pairs are missing from use_case_rungs. The seed did not complete.', v_missing;
  end if;
  if v_rows < v_cases * 5 then
    raise exception '0036 probe 1: use_case_rungs holds % rows for % capabilities; expected at least %.', v_rows, v_cases, v_cases * 5;
  end if;

  -- 2. Both guards are attached. A table with the rows and neither trigger is
  --    the worst of the three states: it looks configured and enforces nothing.
  if not exists (
    select 1 from pg_trigger where tgname = 'use_case_rungs_guard_delete_trg' and not tgisinternal
  ) then
    raise exception '0036 probe 2: use_case_rungs_guard_delete_trg is missing — a rung could be switched off under a standing pair.';
  end if;
  if not exists (
    select 1 from pg_trigger where tgname = 'map_node_use_cases_rung_applies_trg' and not tgisinternal
  ) then
    raise exception '0036 probe 2: map_node_use_cases_rung_applies_trg is missing — the membership would be decoration.';
  end if;

  -- 3. 0035 AND 0032 ARE STILL THERE. This file adds a SECOND trigger to
  --    map_node_use_cases and does not touch the first, but a later edit that
  --    reached for `create or replace function map_node_use_cases_stamp()` to
  --    fold the two together would silently drop the overrides union and the
  --    event log. Checked here because this is the file that made a second
  --    trigger on that table normal.
  if position('array_agg(distinct field)' in
       coalesce((select prosrc from pg_proc where proname = 'map_node_use_cases_stamp'), '')) = 0 then
    raise exception '0036 probe 3: 0035''s overrides union is gone from map_node_use_cases_stamp().';
  end if;
  if position('map_node_use_case_events' in
       coalesce((select prosrc from pg_proc where proname = 'map_node_use_cases_stamp'), '')) = 0 then
    raise exception '0036 probe 3: 0032''s event log write is gone from map_node_use_cases_stamp().';
  end if;
end
$probe$;
