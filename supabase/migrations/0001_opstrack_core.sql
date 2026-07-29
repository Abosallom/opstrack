-- OpsTrack core schema: profiles, tracks, entries, the append-only update
-- thread, meetings, and recurring templates — plus RLS, the activity/staleness
-- machinery, and the recurrence materializer.
--
-- Signups are DISABLED on this project. Members are provisioned by the
-- admin-members edge function (service role), which creates the auth user and
-- lets the on_auth_user_created trigger below write the matching profiles row.
-- Every RLS policy therefore keys off "has a profiles row", not merely
-- "authenticated" — a JWT without a profile sees nothing.
--
-- Deploy once: Supabase Dashboard → SQL Editor → paste + Run.
-- The file is written to be re-runnable: create table if not exists,
-- drop policy if exists before every create policy, create or replace on
-- every function, drop trigger if exists before every create trigger.

create extension if not exists pgcrypto;  -- gen_random_uuid()

-- ── helpers: identity predicates ────────────────────────────────────────────
-- These are SECURITY DEFINER on purpose. A policy on public.profiles that
-- selects from public.profiles inline recurses (Postgres re-evaluates the
-- table's own policies for the subquery and errors with "infinite recursion
-- detected in policy"). A definer function runs with the owner's rights, skips
-- RLS on the lookup, and breaks the cycle. `set search_path = public` is
-- mandatory on definer functions so a caller cannot shadow `profiles` with a
-- temp table of their own.

create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid());
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

comment on function public.is_admin() is
  'Admin check for RLS. SECURITY DEFINER to avoid recursive policy evaluation on profiles.';

-- ── profiles ────────────────────────────────────────────────────────────────
-- One row per provisioned member, created by the auth.users trigger below.
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  role         text not null default 'member' check (role in ('admin', 'member')),
  locale       text not null default 'en',
  created_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Small trusted team: everyone with a profile can see the roster (owner
-- avatars, initials, and the assignee pickers all need it).
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (public.is_member());

-- Only admins hand-create profiles; the normal path is the definer trigger,
-- and the edge function uses the service role, so both bypass this anyway.
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert with check (public.is_admin());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles
  for delete using (public.is_admin());

-- RLS is row-level, not column-level: profiles_update lets a member edit their
-- own row, which would also let them set role='admin' on it. Pin the column in
-- a trigger instead — only an admin can move anyone between roles.
create or replace function public.guard_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only pin the column when a real END USER is acting. auth.uid() is NULL for
  -- the service role (the admin-members edge function) and in the SQL Editor,
  -- and those are precisely the two privileged paths that are SUPPOSED to set
  -- a role. Without the auth.uid() test both of them had their write silently
  -- reverted to the old value, the statement still reported success, and no
  -- admin could ever be provisioned — which made every is_admin() policy in
  -- this file permanently unsatisfiable.
  --
  -- This is safe because RLS runs before the trigger: profiles_update requires
  -- `id = auth.uid() or public.is_admin()`, and both are false without a JWT,
  -- so an anon or profile-less caller is rejected at the policy layer and
  -- never reaches this function. The only writers that arrive here with
  -- auth.uid() null are ones that already bypass RLS by design.
  if auth.uid() is not null
     and new.role is distinct from old.role
     and not public.is_admin() then
    new.role := old.role;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_role on public.profiles;
create trigger profiles_guard_role
  before update on public.profiles
  for each row execute function public.guard_profile_role();

-- ── profile provisioning ────────────────────────────────────────────────────
-- Fires for every new auth.users row, whoever created it (edge function,
-- dashboard, or CLI), so an auth user can never exist without a profile — a
-- profile-less user passes JWT checks but fails every policy above and would
-- see an empty, unexplained app.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, role, locale)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      split_part(coalesce(new.email, ''), '@', 1)
    ),
    -- ALWAYS 'member'. Never read the role out of raw_user_meta_data: that is
    -- the client-writable `options.data` bag on the public Auth API, so a
    -- POST /auth/v1/signup with {"data":{"role":"admin"}} and the anon key
    -- that ships in the built frontend would mint an admin. The only thing
    -- standing in the way is the project's "allow new users to sign up"
    -- toggle, which lives in the dashboard and is asserted nowhere in this
    -- schema — flip it back on to debug OTP delivery or restore the project
    -- from a template and self-signup silently becomes self-promotion.
    -- Roles are assigned AFTER creation by a principal that bypasses RLS: the
    -- admin-members edge function (service role) or the SQL Editor. The
    -- guard_profile_role() trigger above deliberately lets both through.
    'member',
    coalesce(nullif(new.raw_user_meta_data ->> 'locale', ''), 'en')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── tracks ──────────────────────────────────────────────────────────────────
-- The five domains the lead owns. `color` mirrors the --track-* design tokens
-- so a track's bar in the UI matches whether the value comes from CSS or the
-- database.
create table if not exists public.tracks (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  name_ar    text not null default '',
  color      text not null default '#6b7280',
  icon       text not null default 'circle',
  sort_order int not null default 0,
  archived   boolean not null default false
);

create unique index if not exists tracks_name_uidx on public.tracks (lower(name));
create index if not exists tracks_sort_idx on public.tracks (sort_order);

alter table public.tracks enable row level security;

drop policy if exists tracks_select on public.tracks;
create policy tracks_select on public.tracks
  for select using (public.is_member());

drop policy if exists tracks_insert on public.tracks;
create policy tracks_insert on public.tracks
  for insert with check (public.is_admin());

drop policy if exists tracks_update on public.tracks;
create policy tracks_update on public.tracks
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists tracks_delete on public.tracks;
create policy tracks_delete on public.tracks
  for delete using (public.is_admin());

-- Seed. `do nothing` rather than `do update`: tracks are editable in Settings
-- and re-running the migration must not stomp a renamed track or a recoloured
-- one.
insert into public.tracks (name, name_ar, color, icon, sort_order) values
  ('PMO',            'مكتب إدارة المشاريع',   '#8b5cf6', 'clipboard-list', 1),
  ('IT Operations',  'عمليات تقنية المعلومات', '#3b82f6', 'server-cog',     2),
  ('Network',        'الشبكات',               '#06b6d4', 'network',        3),
  ('Infrastructure', 'البنية التحتية',         '#f59e0b', 'server',         4),
  ('SRE',            'هندسة موثوقية الأنظمة',  '#f43f5e', 'activity',       5)
on conflict (lower(name)) do nothing;

-- ── meetings ────────────────────────────────────────────────────────────────
-- Declared before entries because entries.meeting_id points at it.
create table if not exists public.meetings (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  track_id   uuid references public.tracks (id) on delete set null,
  attendees  text[] not null default '{}',
  started_at timestamptz not null default now(),
  ended_at   timestamptz,
  notes      text not null default '',
  created_by uuid references public.profiles (id) on delete set null
);

create index if not exists meetings_started_idx on public.meetings (started_at desc);
create index if not exists meetings_track_idx on public.meetings (track_id);

alter table public.meetings enable row level security;

drop policy if exists meetings_select on public.meetings;
create policy meetings_select on public.meetings
  for select using (public.is_member());

drop policy if exists meetings_insert on public.meetings;
create policy meetings_insert on public.meetings
  for insert with check (public.is_member() and created_by = auth.uid());

drop policy if exists meetings_update on public.meetings;
create policy meetings_update on public.meetings
  for update using (created_by = auth.uid() or public.is_admin())
  with check (created_by = auth.uid() or public.is_admin());

drop policy if exists meetings_delete on public.meetings;
create policy meetings_delete on public.meetings
  for delete using (public.is_admin());

-- ── recurring_templates ─────────────────────────────────────────────────────
-- A template is a recipe, not an entry. materialize_due_recurring() below
-- turns it into real entries on schedule.
create table if not exists public.recurring_templates (
  id                   uuid primary key default gen_random_uuid(),
  track_id             uuid references public.tracks (id) on delete set null,
  title                text not null,
  type                 text not null default 'action'
                         check (type in ('action','decision','issue','request','change','escalation','note')),
  priority             text not null default 'medium'
                         check (priority in ('low','medium','high','critical')),
  owner_id             uuid references public.profiles (id) on delete set null,
  owner_name           text,
  cadence              text not null default 'weekly'
                         check (cadence in ('daily','weekly','biweekly','monthly','quarterly','custom')),
  custom_interval_days int,
  day_of_week          int check (day_of_week between 0 and 6),   -- 0 = Sunday, matches JS getDay()
  day_of_month         int check (day_of_month between 1 and 31),
  next_run_on          date not null default current_date,
  lead_days            int not null default 0,
  active               boolean not null default true,
  -- Same either/or rule as entries: a template owner is a teammate or a name.
  constraint recurring_templates_single_owner
    check (owner_id is null or owner_name is null)
);

create index if not exists recurring_templates_due_idx
  on public.recurring_templates (next_run_on) where active;

alter table public.recurring_templates enable row level security;

drop policy if exists recurring_templates_select on public.recurring_templates;
create policy recurring_templates_select on public.recurring_templates
  for select using (public.is_member());

-- Templates carry no created_by column, so there is no creator to scope
-- writes to: any member may author and tune one, admins alone may destroy one.
drop policy if exists recurring_templates_insert on public.recurring_templates;
create policy recurring_templates_insert on public.recurring_templates
  for insert with check (public.is_member());

drop policy if exists recurring_templates_update on public.recurring_templates;
create policy recurring_templates_update on public.recurring_templates
  for update using (public.is_member()) with check (public.is_member());

drop policy if exists recurring_templates_delete on public.recurring_templates;
create policy recurring_templates_delete on public.recurring_templates
  for delete using (public.is_admin());

-- ── entries ─────────────────────────────────────────────────────────────────
-- The central table. Note last_activity_at: staleness is measured from it and
-- never from updated_at, because updated_at moves for bookkeeping writes
-- (backfills, tag cleanups) that are not activity on the item.
create table if not exists public.entries (
  id               uuid primary key default gen_random_uuid(),
  track_id         uuid references public.tracks (id) on delete set null,
  title            text not null,
  description      text not null default '',
  type             text not null default 'action'
                     check (type in ('action','decision','issue','request','change','escalation','note')),
  status           text not null default 'new'
                     check (status in ('new','in_progress','blocked','waiting_on','done','cancelled')),
  priority         text not null default 'medium'
                     check (priority in ('low','medium','high','critical')),
  owner_id         uuid references public.profiles (id) on delete set null,
  owner_name       text,
  requester        text,
  due_date         date,
  follow_up_date   date,
  tags             text[] not null default '{}',
  links            jsonb not null default '[]'::jsonb,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  closed_at        timestamptz,
  last_activity_at timestamptz not null default now(),
  meeting_id       uuid references public.meetings (id) on delete set null,
  template_id      uuid references public.recurring_templates (id) on delete set null,
  -- An owner is EITHER a provisioned teammate or a free-text name (vendor,
  -- another department). Both null is legitimate: unassigned is a first-class
  -- state and has its own section on the Follow-ups screen.
  constraint entries_single_owner
    check (owner_id is null or owner_name is null)
);

create index if not exists entries_track_idx        on public.entries (track_id);
create index if not exists entries_status_idx       on public.entries (status);
create index if not exists entries_owner_idx        on public.entries (owner_id);
create index if not exists entries_created_by_idx   on public.entries (created_by);
create index if not exists entries_due_idx          on public.entries (due_date)
  where due_date is not null;
create index if not exists entries_followup_idx     on public.entries (follow_up_date)
  where follow_up_date is not null;
create index if not exists entries_activity_idx     on public.entries (last_activity_at desc);
create index if not exists entries_created_idx      on public.entries (created_at desc);
create index if not exists entries_meeting_idx      on public.entries (meeting_id);
create index if not exists entries_tags_idx         on public.entries using gin (tags);

-- 'simple' rather than 'english': it does no stemming and no stopword removal,
-- so Arabic titles are searchable by the same index. An English-stemmed config
-- silently drops Arabic terms.
create index if not exists entries_search_idx on public.entries
  using gin (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, '')));

-- Idempotency guard for recurrence: a template can only ever produce one entry
-- per due date, so materialize_due_recurring() is safe to run twice (pg_cron
-- and the app's RPC-on-load both call it, by design).
create unique index if not exists entries_template_due_uidx
  on public.entries (template_id, due_date) where template_id is not null;

alter table public.entries enable row level security;

drop policy if exists entries_select on public.entries;
create policy entries_select on public.entries
  for select using (public.is_member());

drop policy if exists entries_insert on public.entries;
create policy entries_insert on public.entries
  for insert with check (public.is_member() and created_by = auth.uid());

-- Creator, owner, or admin. Deliberately narrower than SELECT: everyone sees
-- everything, but you cannot silently rewrite someone else's item.
drop policy if exists entries_update on public.entries;
create policy entries_update on public.entries
  for update using (
    created_by = auth.uid() or owner_id = auth.uid() or public.is_admin()
  ) with check (
    created_by = auth.uid() or owner_id = auth.uid() or public.is_admin()
  );

-- Hard delete is admin-only and the UI never calls it — closing an item is
-- status='cancelled' so the audit thread never vanishes with the row.
drop policy if exists entries_delete on public.entries;
create policy entries_delete on public.entries
  for delete using (public.is_admin());

-- ── entry_updates (append-only) ─────────────────────────────────────────────
-- The audit thread. There is intentionally NO update policy and NO delete
-- policy on this table: under RLS an operation with no permissive policy is
-- denied for everyone, so immutability is enforced by the database itself and
-- not by application code that a future bug or a raw REST call could bypass.
-- If you ever add an update/delete policy here, you have removed the audit
-- guarantee the rest of the app assumes.
create table if not exists public.entry_updates (
  id          uuid primary key default gen_random_uuid(),
  entry_id    uuid not null references public.entries (id) on delete cascade,
  author_id   uuid references public.profiles (id) on delete set null,
  body        text not null default '',
  status_from text,
  status_to   text,
  created_at  timestamptz not null default now()
);

create index if not exists entry_updates_entry_idx
  on public.entry_updates (entry_id, created_at desc);
create index if not exists entry_updates_created_idx
  on public.entry_updates (created_at desc);

alter table public.entry_updates enable row level security;

drop policy if exists entry_updates_select on public.entry_updates;
create policy entry_updates_select on public.entry_updates
  for select using (public.is_member());

drop policy if exists entry_updates_insert on public.entry_updates;
create policy entry_updates_insert on public.entry_updates
  for insert with check (public.is_member() and author_id = auth.uid());

-- No entry_updates_update policy. No entry_updates_delete policy. On purpose.

-- ── activity + bookkeeping triggers ─────────────────────────────────────────
-- Two paths bump last_activity_at, and they must not fight each other:
--   1. the entry row itself changed  → this BEFORE UPDATE trigger
--   2. an update was appended        → the AFTER INSERT trigger on
--                                      entry_updates, which issues an UPDATE
--                                      that lands right back here.
-- The jsonb diff below ignores updated_at and last_activity_at, so path 2's
-- write is seen as "no real change" and is left alone instead of being
-- overwritten with now() a second time (harmless today, but it also stops the
-- pair from ping-ponging if either side ever grows more logic).
create or replace function public.entries_touch()
returns trigger
language plpgsql
as $$
begin
  if (to_jsonb(new) - 'updated_at' - 'last_activity_at')
     is distinct from
     (to_jsonb(old) - 'updated_at' - 'last_activity_at') then
    new.updated_at := now();
    new.last_activity_at := now();
  end if;

  -- closed_at tracks the terminal statuses in both directions, so reopening an
  -- item clears it rather than leaving a stale close date on the dashboard.
  if new.status is distinct from old.status then
    if new.status in ('done', 'cancelled') then
      new.closed_at := coalesce(new.closed_at, now());
    else
      new.closed_at := null;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists entries_touch_trg on public.entries;
create trigger entries_touch_trg
  before update on public.entries
  for each row execute function public.entries_touch();

create or replace function public.entries_set_closed_at()
returns trigger
language plpgsql
as $$
begin
  if new.status in ('done', 'cancelled') then
    new.closed_at := coalesce(new.closed_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists entries_insert_trg on public.entries;
create trigger entries_insert_trg
  before insert on public.entries
  for each row execute function public.entries_set_closed_at();

-- Path 2: appending to the thread is activity on the entry even when no
-- column of the entry changed. greatest() keeps an out-of-order backfill from
-- dragging last_activity_at backwards and making an item look stale.
create or replace function public.entry_updates_touch_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.entries
     set last_activity_at = greatest(last_activity_at, new.created_at)
   where id = new.entry_id;
  return new;
end;
$$;

drop trigger if exists entry_updates_touch_trg on public.entry_updates;
create trigger entry_updates_touch_trg
  after insert on public.entry_updates
  for each row execute function public.entry_updates_touch_entry();

-- Note: the status-transition row (status_from/status_to) is written by the
-- app alongside its own UPDATE, not by a trigger here. A trigger would race
-- with the client's own insert and produce two rows for one transition.

-- ── v_entry_health ──────────────────────────────────────────────────────────
-- Open entries only, with age and overdue math resolved server-side so every
-- client agrees on what "stale" means.
--   thresholds (days without activity): critical 2, high 4, medium 8, low 15
--   overdue always outranks stale; 'critical' = overdue AND priority critical
-- Day counts use the server's date, which is UTC on Supabase. Good enough for
-- an ageing pill; do not use it for a same-day SLA.
--
-- A view has no RLS of its own — by default it runs as its owner and would
-- leak every row past the policies above. security_invoker makes it evaluate
-- the *caller's* policies on public.entries, which is what we want.
drop view if exists public.v_entry_health;
create view public.v_entry_health as
select
  -- Exposed under both names: clients key rows by `id` and join on `entry_id`,
  -- and aliasing in every query got old fast.
  e.id                                        as id,
  e.id                                        as entry_id,
  e.track_id,
  e.status,
  e.priority,
  e.due_date,
  e.last_activity_at,
  greatest(0, (current_date - e.last_activity_at::date))::int as days_since_activity,
  case
    when e.due_date is not null and e.due_date < current_date
      then (current_date - e.due_date)::int
    else 0
  end                                                        as days_overdue,
  case
    when e.due_date is not null and e.due_date < current_date and e.priority = 'critical'
      then 'critical'
    when e.due_date is not null and e.due_date < current_date
      then 'overdue'
    when greatest(0, (current_date - e.last_activity_at::date)) >=
         case e.priority
           when 'critical' then 2
           when 'high'     then 4
           when 'medium'   then 8
           else                 15
         end
      then 'stale'
    else 'ok'
  end                                                        as health
from public.entries e
where e.status not in ('done', 'cancelled');

alter view public.v_entry_health set (security_invoker = on);

grant select on public.v_entry_health to authenticated;

-- ── recurrence ──────────────────────────────────────────────────────────────
-- Date arithmetic for the next occurrence. Month-length clamping is the whole
-- point of doing this in SQL: a monthly template on the 31st must land on Feb
-- 28 (29 in a leap year) instead of overflowing into March, which is what
-- naive `+ interval '1 month'` on Jan 31 does.
create or replace function public.advance_recurrence(
  p_from     date,
  p_cadence  text,
  p_interval int,
  p_dow      int,
  p_dom      int
) returns date
language plpgsql
immutable
as $$
declare
  v_next        date;
  v_month_start date;
  v_days        int;
  v_day         int;
begin
  case p_cadence
    when 'daily' then
      v_next := p_from + 1;

    when 'weekly' then
      v_next := p_from + 7;

    when 'biweekly' then
      v_next := p_from + 14;

    when 'monthly' then
      v_month_start := (date_trunc('month', p_from::timestamp) + interval '1 month')::date;
      v_days := extract(day from (date_trunc('month', v_month_start::timestamp)
                                  + interval '1 month' - interval '1 day'))::int;
      v_day  := least(coalesce(p_dom, extract(day from p_from)::int), v_days);
      v_next := v_month_start + (v_day - 1);

    when 'quarterly' then
      v_month_start := (date_trunc('month', p_from::timestamp) + interval '3 months')::date;
      v_days := extract(day from (date_trunc('month', v_month_start::timestamp)
                                  + interval '1 month' - interval '1 day'))::int;
      v_day  := least(coalesce(p_dom, extract(day from p_from)::int), v_days);
      v_next := v_month_start + (v_day - 1);

    else  -- 'custom'
      v_next := p_from + greatest(coalesce(p_interval, 1), 1);
  end case;

  -- Weekly cadences may pin a weekday; nudge forward to it (0 = Sunday).
  if p_dow is not null and p_cadence in ('weekly', 'biweekly') then
    v_next := v_next + ((p_dow - extract(dow from v_next)::int + 7) % 7);
  end if;

  -- Never return a non-advancing date: materialize_due_recurring() loops on
  -- this and a zero step would spin forever.
  if v_next <= p_from then
    v_next := p_from + 1;
  end if;

  return v_next;
end;
$$;

-- Creates the entries that are due, then parks next_run_on in the future.
-- Called daily by pg_cron AND on app load via RPC, because pg_cron is not
-- available on every Supabase tier. Running it twice in a day is a no-op: the
-- (template_id, due_date) unique index absorbs the second pass.
--
-- SECURITY DEFINER so it can insert entries with created_by null (nobody
-- created them — the schedule did), which entries_insert would otherwise
-- reject.
create or replace function public.materialize_due_recurring()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r         record;
  v_due     date;
  v_next    date;
  v_guard   int;
  v_created int := 0;
begin
  for r in
    select * from public.recurring_templates
    where active and next_run_on <= current_date
    order by next_run_on
  loop
    v_next  := r.next_run_on;
    v_guard := 0;

    -- Catch-up loop: if the job did not run for a fortnight, every missed
    -- occurrence still gets its entry rather than silently collapsing into
    -- one. The guard caps a pathological template (bad cadence data, a
    -- next_run_on set years back) at 60 rows instead of filling the table.
    while v_next <= current_date and v_guard < 60 loop
      v_due := v_next + r.lead_days;

      insert into public.entries (
        track_id, title, type, priority, owner_id, owner_name,
        due_date, template_id, status
      ) values (
        r.track_id, r.title, r.type, r.priority, r.owner_id, r.owner_name,
        v_due, r.id, 'new'
      )
      on conflict (template_id, due_date) where template_id is not null do nothing;

      if found then
        v_created := v_created + 1;
      end if;

      v_next  := public.advance_recurrence(
                   v_next, r.cadence, r.custom_interval_days, r.day_of_week, r.day_of_month);
      v_guard := v_guard + 1;
    end loop;

    update public.recurring_templates set next_run_on = v_next where id = r.id;
  end loop;

  return v_created;
end;
$$;

revoke all on function public.materialize_due_recurring() from public;
grant execute on function public.materialize_due_recurring() to authenticated;

-- ── pg_cron schedule ────────────────────────────────────────────────────────
-- Best-effort: pg_cron is unavailable on some tiers, and CREATE EXTENSION
-- needs privileges the SQL Editor role does not always hold. Everything is
-- wrapped so the migration still applies cleanly without it — the app calls
-- the same function by RPC on load, which is the actual safety net.
do $cron$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron';
    -- schedule() upserts by job name, so re-running the migration will not
    -- stack duplicate jobs. 03:15 UTC: before anyone's morning standup.
    execute $sched$
      select cron.schedule(
        'opstrack-materialize-recurring',
        '15 3 * * *',
        $job$select public.materialize_due_recurring();$job$
      )
    $sched$;
    raise notice 'OpsTrack: pg_cron job "opstrack-materialize-recurring" scheduled (03:15 UTC daily).';
  else
    raise notice 'OpsTrack: pg_cron unavailable — recurrence relies on the app''s RPC call on load.';
  end if;
exception when others then
  raise notice 'OpsTrack: could not schedule pg_cron job (%). Falling back to the app''s RPC call.', sqlerrm;
end;
$cron$;

-- ── realtime ────────────────────────────────────────────────────────────────
-- Teammates' updates should appear without a refresh. Guarded because the
-- supabase_realtime publication only exists on a real Supabase project, and
-- adding a table twice is an error rather than a no-op.
do $realtime$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'entries'
    ) then
      execute 'alter publication supabase_realtime add table public.entries';
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'entry_updates'
    ) then
      execute 'alter publication supabase_realtime add table public.entry_updates';
    end if;
  else
    raise notice 'OpsTrack: supabase_realtime publication not found — realtime disabled.';
  end if;
exception when others then
  raise notice 'OpsTrack: could not configure realtime (%).', sqlerrm;
end;
$realtime$;
