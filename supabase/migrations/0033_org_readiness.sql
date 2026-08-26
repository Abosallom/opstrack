-- 0033 — the three things a hospital does before any use case can start
--
-- Patient Registry, Provider Portal and SSO. The owner named them when asked
-- what gates ADT, and was precise about their shape: "1 and to be just tick box
-- in the tool", and "just tick boxes, but for SSO i can list (Not Started, UAT,
-- PRD)".
--
-- ── WHY THEY ARE NOT USE CASES ──────────────────────────────────────────────
--
-- A use case is a thing a hospital exchanges with the platform, and there are
-- eleven. These three are the ground the eleven stand on: they happen ONCE per
-- hospital, not once per use case. Modelling them as use cases would make the
-- grid 141 x 14 = 1,974 and file 423 facts as 1,974, most of them repetitions of
-- the same three answers.
--
-- ── WHY A SIDE TABLE AND NOT COLUMNS ON map_nodes ───────────────────────────
--
-- `map_nodes` is generic — it holds the programme, the six departments and the
-- 141 organizations, and a Patient Registry tick means nothing on a department.
-- This is `map_node_progress`'s shape and its argument, one table over: a fact
-- ABOUT an organization that only organizations have.
--
-- ⚠ AND THEY WARN RATHER THAN BLOCK. The owner ruled that a use case advancing
--   past STG/TEST at a hospital whose three are not done costs ONE EXTRA CLICK
--   that names what is missing — not a refusal. A block would make the tool an
--   obstacle on its first day, and a silent warning trains people to ignore
--   warnings. Nothing in this migration enforces an order; the confirmation
--   lives in the client, where the person who may know better is standing.

create table if not exists public.map_node_readiness (
  node_id          uuid primary key references public.map_nodes (id) on delete cascade,
  patient_registry boolean not null default false,
  provider_portal  boolean not null default false,
  -- SSO is the one with more than two states, and the owner listed them:
  -- Not Started, UAT, PRD. A closed check, so a fourth arrives by migration.
  sso              text not null default 'not_started'
                     check (sso in ('not_started', 'uat', 'prd')),
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.profiles (id) on delete set null
);

comment on table public.map_node_readiness is
  'The three foundations a hospital lays before any use case can proceed: Patient Registry, Provider Portal and SSO. ONE ROW PER ORGANIZATION — 423 facts across 141 hospitals, not 1,974. NO ROW means nobody has said, which is different from all three being false; the client must tell those apart, on the same rule that governs a missing map_node_use_cases row.';

comment on column public.map_node_readiness.sso is
  'not_started | uat | prd. SSO appears in 31 open tickets and whitelisting in 10 — these are hospital-level foundations that stall everything behind them, and no view in this product has ever drawn one.';

alter table public.map_node_readiness enable row level security;

-- Member-write, matching map_node_progress: this is fieldwork, not configuration.
-- The PMO fills these (the owner's ruling — they are governance facts about a
-- hospital's readiness, owned the way COC is owned), but the policy is the
-- workspace's usual one and the ownership is a convention the screen carries.
drop policy if exists map_node_readiness_select on public.map_node_readiness;
create policy map_node_readiness_select on public.map_node_readiness
  for select using ((select public.is_member()));

drop policy if exists map_node_readiness_insert on public.map_node_readiness;
create policy map_node_readiness_insert on public.map_node_readiness
  for insert with check ((select public.is_member()));

drop policy if exists map_node_readiness_update on public.map_node_readiness;
create policy map_node_readiness_update on public.map_node_readiness
  for update using ((select public.is_member())) with check ((select public.is_member()));

drop policy if exists map_node_readiness_delete on public.map_node_readiness;
create policy map_node_readiness_delete on public.map_node_readiness
  for delete using ((select public.is_member()));

grant select, insert, update, delete on public.map_node_readiness to authenticated;

-- `updated_by` is server truth about the write, never a field the screen offers
-- — 0026's rule, and the same one portfolio/fields.ts now leans on to tell a
-- clock a person started from a clock a script wrote.
create or replace function public.map_node_readiness_touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := (select p.id from public.profiles p where p.id = auth.uid());
  return new;
end;
$$;

revoke all on function public.map_node_readiness_touch() from public, anon;

drop trigger if exists map_node_readiness_touch_trg on public.map_node_readiness;
create trigger map_node_readiness_touch_trg
  before insert or update on public.map_node_readiness
  for each row execute function public.map_node_readiness_touch();

-- ⚠ NO BACKFILL. 141 rows of three falses would assert that somebody looked at
--   every hospital and found nothing done, which nobody has. Absence is the
--   honest state and it is the state this ships in.
