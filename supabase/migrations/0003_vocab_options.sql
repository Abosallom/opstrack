-- OpsTrack vocabulary: renameable, recolourable status/priority/type options,
-- the staleness thresholds that used to be hardcoded in a view, the per-priority
-- SLA, and the v_entry_health rewrite that reads both.
--
-- The point of this file, stated once: the four unions in src/types.ts stay
-- FROZEN — six statuses, four priorities, seven types, forever — while their
-- labels, colours, order, visibility and thresholds become configuration. Keys
-- are what entries and entry_updates.status_from/status_to store, so renaming
-- "waiting_on" to "Awaiting vendor" costs ZERO writes and rewrites no history.
-- Adding a seventh status would rewrite history, silently, with no undo, which
-- is exactly why the admin screen can never do it.
--
-- SLA SHIPS OFF. `sla_days` is seeded NULL on all four priority rows and nothing
-- in this file ever writes a number into it — see the note where the old backfill
-- block used to be, roughly a hundred lines down. Turning SLA on is an admin's
-- act, through the vocabulary screen or one UPDATE.
--
-- Deploy: Supabase Dashboard -> SQL Editor -> paste + Run. Re-runnable from the
-- top in any partial state, same discipline as 0001/0002: create table/index if
-- not exists, add column if not exists, drop constraint/policy/trigger if exists
-- before every create, create or replace on every function, seeds with
-- on conflict do nothing. That claim is load-bearing and is checked: a re-run
-- must not change a single configured value, in either direction.


-- ── vocab_options ───────────────────────────────────────────────────────────
-- Primary key is (kind, key), not a surrogate uuid: the pair IS the identity,
-- it is what every entry row already stores, and a uuid would only add a lookup
-- between the two things that actually matter.
--
-- label/label_ar are `not null default ''` and seeded EMPTY on purpose. An empty
-- label means "no override", so t('status.blocked') keeps winning until an admin
-- types something. That is what lets 0003 land on a live workspace and change
-- nothing visible, and it is why every resolver tests for EMPTY rather than for
-- null (see the label resolution order in src/store/vocab.ts).
create table if not exists public.vocab_options (
  kind             text not null check (kind in ('status', 'priority', 'type')),
  key              text not null,
  label            text not null default '',
  label_ar         text not null default '',
  color            text,
  sort_order       int not null default 0,
  hidden           boolean not null default false,
  stale_after_days int,
  sla_days         int,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.profiles (id) on delete set null,
  primary key (kind, key)
);

-- For a project where an earlier cut of this file already landed: the table
-- exists without the SLA column and `create table if not exists` is a no-op, so
-- the column has to be added separately or every statement below it fails.
alter table public.vocab_options add column if not exists sla_days int;

-- Both thresholds are PRIORITY-ONLY. A "stale after 8 days" on the `type` row
-- for `decision` would be silently ignored by the view and would read, to the
-- next person, like a feature that stopped working.
--
-- Note the hazard 0002 documents for named constraints: dropping before adding
-- leaves the table unconstrained if the add then fails on live data. Both adds
-- below are satisfied by every row this file seeds, and by any row an admin can
-- produce through the RPCs, so the window is theoretical here — but check the
-- data first if you ever widen these bounds downward.
alter table public.vocab_options drop constraint if exists vocab_stale_only_priority;
alter table public.vocab_options add constraint vocab_stale_only_priority
  check (kind = 'priority' or stale_after_days is null);

alter table public.vocab_options drop constraint if exists vocab_stale_range;
alter table public.vocab_options add constraint vocab_stale_range
  check (stale_after_days is null or stale_after_days between 1 and 365);

alter table public.vocab_options drop constraint if exists vocab_sla_only_priority;
alter table public.vocab_options add constraint vocab_sla_only_priority
  check (kind = 'priority' or sla_days is null);

-- 3650 rather than 365: staleness is a nudge measured in days, an SLA is a
-- service commitment and "10 years" is a legitimate way to say "effectively
-- none, but written down". The lower bound is 1 because a zero-day SLA breaches
-- the instant the row is created, which is not a commitment, it is a bug.
alter table public.vocab_options drop constraint if exists vocab_sla_range;
alter table public.vocab_options add constraint vocab_sla_range
  check (sla_days is null or sla_days between 1 and 3650);

-- Every read is "all options of one kind, in order" — the pickers, the board
-- columns, the admin editor. 17 rows will never need an index for speed; this
-- one exists so the planner keeps returning them in a stable order under a
-- seq scan too.
create index if not exists vocab_options_kind_sort_idx
  on public.vocab_options (kind, sort_order);

alter table public.vocab_options enable row level security;

-- Everyone reads it — a member cannot render a single status pill without it.
drop policy if exists vocab_options_select on public.vocab_options;
create policy vocab_options_select on public.vocab_options
  for select using (public.is_member());

-- Writes are admin-only, exactly like tracks. INSERT and DELETE have policies
-- for completeness, but nothing in the app calls them: the 17 rows are the
-- frozen unions, and the trigger below plus the CHECK on `kind` make an
-- invented eighteenth row unusable anyway.
drop policy if exists vocab_options_insert on public.vocab_options;
create policy vocab_options_insert on public.vocab_options
  for insert with check (public.is_admin());

drop policy if exists vocab_options_update on public.vocab_options;
create policy vocab_options_update on public.vocab_options
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists vocab_options_delete on public.vocab_options;
create policy vocab_options_delete on public.vocab_options
  for delete using (public.is_admin());


-- ── the seed, as a function ─────────────────────────────────────────────────
-- The seed lives in ONE place because two things need it: the insert below, and
-- reset_vocab() which restores a row to it. Two copies of a 17-row table drift
-- the first time somebody tunes a threshold, and the drift is invisible until an
-- admin hits "reset" and gets a value nobody ever seeded.
--
-- sort_order matches the union order in src/types.ts exactly, so the pickers
-- read in the same order as the code: new -> cancelled, low -> critical,
-- action -> note.
create or replace function public.vocab_seed()
returns table (kind text, key text, sort_order int, stale_after_days int, sla_days int)
language sql
immutable
as $$
  select v.k_kind, v.k_key, v.k_sort, v.k_stale, v.k_sla
    from (values
      -- kind        key             sort  stale  sla
      ('status'::text,   'new'::text,         1, null::int, null::int),
      ('status',         'in_progress',       2, null,      null),
      ('status',         'blocked',           3, null,      null),
      ('status',         'waiting_on',        4, null,      null),
      ('status',         'done',              5, null,      null),
      ('status',         'cancelled',         6, null,      null),

      -- The staleness numbers are 0001's hardcoded case expression, lifted out
      -- of the view verbatim (2/4/8/15) — a fallback, not a policy.
      --
      -- sla_days is NULL on all four, and that is the binding contract
      -- (WAVE1-ADDENDUM §2.2): SLA is OFF until an admin turns it on, per
      -- priority. This file originally seeded 1/3/7/14 and 0005 cleared them
      -- again; the two are reconciled HERE, in the seed itself, because
      -- v_entry_health.sla_breached is `now() > created_at + sla_days` with no
      -- regard for when the number was chosen — so a seeded default reports
      -- every critical item older than a day as a missed commitment, against a
      -- target nobody set. See the note above the removed backfill block below.
      ('priority',       'low',               1, 15,        null),
      ('priority',       'medium',            2, 8,         null),
      ('priority',       'high',              3, 4,         null),
      ('priority',       'critical',          4, 2,         null),

      ('type',           'action',            1, null,      null),
      ('type',           'decision',          2, null,      null),
      ('type',           'issue',             3, null,      null),
      ('type',           'request',           4, null,      null),
      ('type',           'change',            5, null,      null),
      ('type',           'escalation',        6, null,      null),
      ('type',           'note',              7, null,      null)
    ) as v(k_kind, k_key, k_sort, k_stale, k_sla);
$$;

comment on function public.vocab_seed() is
  'The 17 frozen vocabulary rows with their seeded order and thresholds. Single source of truth for the seed insert and for reset_vocab().';

revoke all on function public.vocab_seed() from public;
revoke all on function public.vocab_seed() from anon;
-- reset_vocab() is SECURITY INVOKER, so the signed-in admin needs EXECUTE here
-- for their own reset to run.
grant execute on function public.vocab_seed() to authenticated;

insert into public.vocab_options (kind, key, sort_order, stale_after_days, sla_days)
select s.kind, s.key, s.sort_order, s.stale_after_days, s.sla_days
  from public.vocab_seed() s
on conflict (kind, key) do nothing;

-- THERE IS DELIBERATELY NO SLA BACKFILL HERE, and the block that used to sit at
-- this line is worth a paragraph so nobody puts it back.
--
-- It backfilled the seeded SLA numbers onto all four priority rows whenever
-- `not exists (select 1 from vocab_options where sla_days is not null)` — i.e.
-- whenever no priority row had an SLA at all, which it read as "never
-- configured". That is exactly the state this file now ships and 0005 restores:
-- all four NULL. So on a workspace running the intended configuration, re-running
-- 0003 — which this file's own header advertises as safe — silently switched SLA
-- back on at 1/3/7/14 and, because sla_breached is computed from created_at with
-- no regard for when the number was chosen, retroactively marked every open
-- critical item older than a day as a missed commitment.
--
-- "All four NULL" cannot distinguish "never configured" from "deliberately off",
-- and an admin clearing all four is the honest way to switch SLA off
-- workspace-wide. So the inference is dropped rather than patched: the seed above
-- is NULL, the insert is `on conflict do nothing`, and an admin's numbers are
-- never touched by a re-run in either direction. 0005 remains in the tree as
-- history (it is what corrected a project that already took the earlier cut of
-- this file) and is now a no-op on any project that runs 0003 from here.


-- ── bookkeeping trigger ─────────────────────────────────────────────────────
-- Diffed rather than stamped unconditionally, for the reason tracks_touch()
-- gives: reorder_vocab() writes several rows in one statement, and an
-- unconditional stamp would report the whole kind as edited and emit a full set
-- of audit rows on a drag that moved one option.
--
-- updated_by is resolved THROUGH profiles rather than taken raw from auth.uid():
-- a JWT without a profile row would violate the FK, and the failure would
-- surface as the admin's perfectly legitimate label edit being rejected.
create or replace function public.vocab_touch()
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
  end if;
  return new;
end;
$$;

drop trigger if exists vocab_touch_trg on public.vocab_options;
create trigger vocab_touch_trg
  before update on public.vocab_options
  for each row execute function public.vocab_touch();


-- ── "you cannot hide them all" guard ────────────────────────────────────────
-- Hiding every status empties the board of columns and the capture form of
-- choices, and the only way back is the SQL Editor — the same trap
-- tracks_keep_one_active() exists to close. One visible option per kind is the
-- floor.
--
-- The 'last_visible_option' token is a contract with src/lib/pgError.ts, which
-- pattern-matches it to vocabadmin.errLastVisible. errcode 23514 because this is
-- a check-constraint violation in spirit; it just cannot be expressed as one,
-- since the rule spans rows.
create or replace function public.vocab_keep_one_visible()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining int;
begin
  -- An update that is not a hiding (relabel, recolour, reorder, unhide) is none
  -- of this trigger's business.
  if not (new.hidden and not old.hidden) then
    return new;
  end if;

  select count(*) into v_remaining
    from public.vocab_options v
   where v.kind = old.kind
     and v.hidden = false
     and v.key <> old.key;

  if v_remaining = 0 then
    raise exception
      'last_visible_option: % must keep at least one visible option', old.kind
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists vocab_keep_one_visible_trg on public.vocab_options;
create trigger vocab_keep_one_visible_trg
  before update on public.vocab_options
  for each row execute function public.vocab_keep_one_visible();


-- ── audit ───────────────────────────────────────────────────────────────────
-- Vocabulary edits are exactly the kind of change 0002 built config_audit for:
-- rare, consequential, done by one person with nobody watching. Renaming a
-- status changes what every screen in the product says.
--
-- row_id is null because config_audit.row_id is a uuid and this table's identity
-- is the (kind, key) text pair. The pair rides in the before/after row images,
-- which is where a reader looks anyway — `before` is the only thing that tells
-- you what the label used to say.
create or replace function public.vocab_audit()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_config_audit('vocab_options', null::uuid, 'insert', null::jsonb, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    if to_jsonb(new) is distinct from to_jsonb(old) then
      perform public.log_config_audit('vocab_options', null::uuid, 'update', to_jsonb(old), to_jsonb(new));
    end if;
    return new;
  else
    perform public.log_config_audit('vocab_options', null::uuid, 'delete', to_jsonb(old), null::jsonb);
    return old;
  end if;
end;
$$;

drop trigger if exists vocab_audit_trg on public.vocab_options;
create trigger vocab_audit_trg
  after insert or update or delete on public.vocab_options
  for each row execute function public.vocab_audit();


-- ── RPCs ────────────────────────────────────────────────────────────────────
-- Both are SECURITY INVOKER, following reorder_tracks() in 0002: they exist for
-- ATOMICITY, not privilege. RLS still evaluates against the caller and rejects a
-- member exactly as if they had typed the UPDATE by hand. The is_admin() test at
-- the top is not the authorization — it is there so a member gets a clean 42501
-- that pgError.ts translates, instead of a silent zero-row update reported as
-- success.

create or replace function public.reorder_vocab(p_kind text, p_keys text[])
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count int;
begin
  if not public.is_admin() then
    raise exception 'only an admin may reorder vocabulary' using errcode = '42501';
  end if;

  update public.vocab_options v
     set sort_order = o.ord::int
    from unnest(p_keys) with ordinality as o(key, ord)
   where v.kind = p_kind
     and v.key = o.key
     and v.sort_order is distinct from o.ord::int;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.reorder_vocab(text, text[]) from public;
revoke all on function public.reorder_vocab(text, text[]) from anon;
grant execute on function public.reorder_vocab(text, text[]) to authenticated;

-- p_key null resets the whole kind; a key resets one row. Returns how many rows
-- actually changed, so the toast can say "nothing to reset" honestly.
--
-- The row comparison at the end skips rows already at their seed values. Without
-- it, "reset all" on an untouched workspace would stamp updated_at on 17 rows
-- and write 17 audit entries recording that nothing happened.
create or replace function public.reset_vocab(p_kind text, p_key text default null)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count int;
begin
  if not public.is_admin() then
    raise exception 'only an admin may reset vocabulary' using errcode = '42501';
  end if;

  update public.vocab_options v
     set label            = '',
         label_ar         = '',
         color            = null,
         hidden           = false,
         sort_order       = s.sort_order,
         stale_after_days = s.stale_after_days,
         sla_days         = s.sla_days
    from public.vocab_seed() s
   where s.kind = v.kind
     and s.key  = v.key
     and v.kind = p_kind
     and (p_key is null or v.key = p_key)
     and (v.label, v.label_ar, v.color, v.hidden, v.sort_order, v.stale_after_days, v.sla_days)
         is distinct from
         ('', '', null::text, false, s.sort_order, s.stale_after_days, s.sla_days);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.reset_vocab(text, text) from public;
revoke all on function public.reset_vocab(text, text) from anon;
grant execute on function public.reset_vocab(text, text) to authenticated;


-- ── v_entry_health, rewritten ───────────────────────────────────────────────
-- Two changes, and the four statements below are not negotiable in count or in
-- order:
--
--   1. The hardcoded `case e.priority when 'critical' then 2 ...` becomes
--      coalesce(vp.stale_after_days, <the same case>). The fallback stays in the
--      view rather than being replaced by the table, so clearing a threshold in
--      the admin editor RESTORES the default instead of switching staleness off
--      — and so the view still works on a project where this file's seed was
--      wiped.
--
--   2. sla_due_at / sla_breached, from the same left join. SLA is measured from
--      created_at; staleness is measured from last_activity_at. They answer
--      different questions and neither substitutes for the other: an item
--      updated hourly for a month is never stale and can still blow its SLA.
--
-- `create or replace view` is NOT an option — the column list grows, and replace
-- cannot add columns in the middle or change the shape. So: drop, create, and
-- then RE-APPLY BOTH the security_invoker setting and the grant. `drop view`
-- discards both. Omit the first and the view runs as its owner and leaks every
-- row past the RLS on entries; omit the second and every member gets a
-- permission error on a screen nobody builds until the next wave. Neither
-- failure has a compile-time signal, which is why the Wave-1 gate selects from
-- this view as a plain member.
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
         coalesce(
           vp.stale_after_days,
           case e.priority
             when 'critical' then 2
             when 'high'     then 4
             when 'medium'   then 8
             else                 15
           end
         )
      then 'stale'
    else 'ok'
  end                                                        as health,
  -- NULL when this priority has no SLA configured, which propagates all the way
  -- to a badge that renders nothing. There is no default hiding in here.
  case
    when vp.sla_days is not null
      then e.created_at + make_interval(days => vp.sla_days)
  end                                                        as sla_due_at,
  -- "open and past its SLA" — the open half is the view's own WHERE clause, so
  -- a completed entry never reports a breach no matter how late it was. That is
  -- deliberate: this view answers "what is at risk right now", and Wave 3's
  -- compliance percentage is a different question asked of the entries table.
  (vp.sla_days is not null
   and now() > e.created_at + make_interval(days => vp.sla_days))              as sla_breached
from public.entries e
left join public.vocab_options vp
  on vp.kind = 'priority' and vp.key = e.priority
where e.status not in ('done', 'cancelled');

alter view public.v_entry_health set (security_invoker = on);

grant select on public.v_entry_health to authenticated;

comment on view public.v_entry_health is
  'Open entries with server-resolved age, overdue and SLA math. Thresholds come from vocab_options (priority rows), falling back to 2/4/8/15. security_invoker: the caller''s RLS on entries applies.';
