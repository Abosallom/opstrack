-- 0006 — SLA becomes a track × priority matrix.
--
-- WHAT CHANGED AND WHY
-- Wave 1 shipped one SLA number per PRIORITY (0003's `vocab_options.sla_days`,
-- seeded NULL by 0005 so nothing was retroactively breached). The owner then
-- upgraded the requirement, and the reason is the product's own shape: "critical
-- is 4 hours" is true of a network outage and false of a PMO decision, and both
-- are `priority = 'critical'` in the same table. A single number per priority
-- forces every track to answer at the pace of the fastest one, which in practice
-- means the number gets set to the slowest one and stops meaning anything.
--
-- So: a per-track override table, and a three-step resolution in the view.
--
--   track_slas(track_id, priority)  →  vocab_options.sla_days  →  NULL
--
-- Read as: this track's promise for this priority, else the workspace's default
-- for this priority, else this priority has no SLA. NULL still propagates all
-- the way to `sla_due_at = null` / `sla_breached = false`; the matrix adds a
-- narrower place to say a number, never a place a number appears from nowhere.
-- WAVE2-NOTES §"SLA is a track × priority matrix" is the binding spec.
--
-- SLA IS STILL OFF BY DEFAULT. This file seeds NO rows. An empty track_slas is
-- the shipped state and means "every track inherits", which on a workspace that
-- has not armed any priority default means "no SLA anywhere" — 0005's guarantee,
-- unchanged. Turning one on is one INSERT, or the Track editor's SLA overrides
-- section.
--
-- THE JOIN MUST NOT CHANGE THE ROW COUNT of v_entry_health, and that is not a
-- hope: `(track_id, priority)` is the primary key, so the left join matches at
-- most one row per entry, and the assertion block at the bottom of this file
-- proves it against the live data every time the migration runs.
--
-- Deploy: Supabase Dashboard → SQL Editor → paste + Run. Re-runnable from the
-- top in any partial state, same discipline as 0001–0005: create table/index if
-- not exists, drop constraint/policy/trigger if exists before every create,
-- create or replace on every function, and no seed that can stomp a decision.


-- ── track_slas ──────────────────────────────────────────────────────────────
-- The primary key IS the identity, exactly as in vocab_options: the pair
-- (track_id, priority) is what a reader asks about and what the view joins on,
-- and a surrogate uuid would only add a lookup between the two columns that
-- actually matter. It is also what makes the view's join provably one-to-at-
-- most-one.
--
-- `on delete cascade`, not `set null`: a per-track override for a track that no
-- longer exists is not data, it is litter. Every other track_id FK in this
-- schema is `set null` because those rows (entries, meetings, templates) carry
-- their own content and outlive the filing cabinet they sat in. A row here has
-- no content beyond the track it names.
--
-- There is deliberately no `updated_at` / `updated_by` pair. vocab_options
-- carries one because its rows exist from the seed onward and an admin needs to
-- know when a label last moved; a row here is created, edited or deleted as a
-- whole, and config_audit below records the actor, the instant and both row
-- images for all three. A second, weaker copy of that record on the row would
-- be one more thing to keep in step.
create table if not exists public.track_slas (
  track_id uuid not null references public.tracks (id) on delete cascade,
  priority text not null,
  sla_days int  not null,
  primary key (track_id, priority)
);

-- Named constraints added separately rather than inline, so a re-run re-asserts
-- them on a table that `create table if not exists` just skipped. 0003's
-- pattern, and the same caveat applies: dropping before adding leaves a window
-- where the table is unconstrained if the add then fails on live data. Every
-- row this file can produce satisfies both, so the window is theoretical here —
-- but check the data first if you ever widen either bound downward.

-- The frozen four, byte-identical to entries.priority's CHECK in 0001:257 and
-- to EntryPriority in src/types.ts. Spelled out rather than referenced because
-- a text column with no CHECK accepts 'urgent', which would then be a row that
-- can never join to anything and never explain why.
alter table public.track_slas drop constraint if exists track_slas_priority_frozen;
alter table public.track_slas add constraint track_slas_priority_frozen
  check (priority in ('low', 'medium', 'high', 'critical'));

-- Lower bound 1 — a zero-day SLA breaches the instant the row is created, which
-- is not a commitment, it is a bug — and negative days are not a thing anyone
-- means. Upper bound 3650 mirrors vocab_sla_range in 0003 so an override cannot
-- express a promise the default it overrides could not: ten years is a
-- legitimate way to write down "effectively none, but recorded".
alter table public.track_slas drop constraint if exists track_slas_days_range;
alter table public.track_slas add constraint track_slas_days_range
  check (sla_days >= 1 and sla_days <= 3650);

comment on table public.track_slas is
  'Per-track SLA overrides, keyed (track_id, priority). Resolution order in v_entry_health: this table, then vocab_options.sla_days, then NULL (no SLA). Empty table = every track inherits.';

alter table public.track_slas enable row level security;

-- Everyone reads it. A member cannot see a correct SLA badge on their own list
-- without it, and the numbers are the workspace's stated commitments — they are
-- not a secret from the people expected to meet them.
drop policy if exists track_slas_select on public.track_slas;
create policy track_slas_select on public.track_slas
  for select using (public.is_member());

-- Writes are admin-only, exactly like tracks and vocab_options. All three of
-- insert / update / delete have policies because the editor uses all three: an
-- empty input in the SLA overrides section DELETES the row rather than writing
-- a sentinel, so "inherit" is the absence of a row and not a magic number.
drop policy if exists track_slas_insert on public.track_slas;
create policy track_slas_insert on public.track_slas
  for insert with check (public.is_admin());

drop policy if exists track_slas_update on public.track_slas;
create policy track_slas_update on public.track_slas
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists track_slas_delete on public.track_slas;
create policy track_slas_delete on public.track_slas
  for delete using (public.is_admin());

-- Supabase's default privileges already grant `authenticated` on new tables in
-- public, so this is a restatement rather than a change — but tracks and
-- vocab_options both rely on that default silently, and a project whose default
-- privileges were ever tightened would fail here with a 42501 that reads like an
-- RLS bug. RLS above is the actual gate; anon holds the same default grant and
-- is stopped by is_member() returning false for a JWT-less caller, identically
-- to every other table in this schema.
grant select, insert, update, delete on public.track_slas to authenticated;


-- ── audit ───────────────────────────────────────────────────────────────────
-- Audited like tracks (0002) and vocab_options (0003), and for the same reason:
-- this is a rare, consequential change made by one person with nobody watching.
-- Changing a track's critical SLA from 7 days to 1 re-colours every open
-- critical item in that track as breached, at once, with no other trace.
--
-- row_id is the TRACK id — a uuid, which is what config_audit.row_id is, and
-- which makes config_audit_row_idx (table_name, row_id) answer "what has been
-- done to this track's SLAs" directly. The priority half of the identity rides
-- in the before/after row images, where a reader is already looking. Contrast
-- vocab_audit(), which passes null because ITS key is a (text, text) pair with
-- no uuid in it at all.
create or replace function public.track_slas_audit()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    -- Casts on the null: with a single candidate Postgres resolves an untyped
    -- null anyway, but an overload added later would make this ambiguous at
    -- runtime, inside a trigger, on someone else's write.
    perform public.log_config_audit('track_slas', new.track_id, 'insert', null::jsonb, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    if to_jsonb(new) is distinct from to_jsonb(old) then
      perform public.log_config_audit('track_slas', new.track_id, 'update', to_jsonb(old), to_jsonb(new));
    end if;
    return new;
  else
    perform public.log_config_audit('track_slas', old.track_id, 'delete', to_jsonb(old), null::jsonb);
    return old;
  end if;
end;
$$;

-- AFTER, not BEFORE: the row image recorded must be the one that survived every
-- other trigger and constraint on the table.
drop trigger if exists track_slas_audit_trg on public.track_slas;
create trigger track_slas_audit_trg
  after insert or update or delete on public.track_slas
  for each row execute function public.track_slas_audit();


-- ── v_entry_health, rewritten again ─────────────────────────────────────────
-- ONE change from 0003: a second left join, and `coalesce(ts.sla_days,
-- vp.sla_days)` wherever `vp.sla_days` stood alone. Everything else in the
-- select list is 0003's, verbatim — staleness still reads vocab_options only
-- (staleness is a nudge about silence, not a promise the workspace made about a
-- track, and nobody asked for it per track), and the health CASE is untouched.
--
-- `create or replace view` is NOT an option even though the column list is
-- unchanged this time: replace cannot alter the definition of an existing
-- column, and sla_due_at's expression is exactly what changes. So the same four
-- statements as 0003, in the same order, for the same reasons:
--
--   drop → create → re-apply security_invoker → re-apply the grant.
--
-- `drop view` discards BOTH the setting and the grant. Omit the first and the
-- view runs as its owner and leaks every row past the RLS on entries; omit the
-- second and every member gets a permission error on a screen that was working
-- an hour ago. Neither failure has a compile-time signal, which is why the
-- Wave-2 gate selects from this view as a plain member.
--
-- The coalesce order is the whole feature and it reads correctly out loud: the
-- track's own number wins; failing that the priority default; failing that
-- there is no SLA and every downstream value is null/false.
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
  -- NULL when neither the track nor the priority carries a number, which
  -- propagates all the way to a badge that renders nothing. There is still no
  -- default hiding in here — coalesce over two nullable columns is null.
  case
    when coalesce(ts.sla_days, vp.sla_days) is not null
      then e.created_at + make_interval(days => coalesce(ts.sla_days, vp.sla_days))
  end                                                        as sla_due_at,
  -- "open and past its SLA" — the open half is the view's own WHERE clause, so
  -- a completed entry never reports a breach no matter how late it was. That is
  -- deliberate: this view answers "what is at risk right now", and Wave 3's
  -- compliance percentage is a different question asked of the entries table.
  (coalesce(ts.sla_days, vp.sla_days) is not null
   and now() > e.created_at + make_interval(days => coalesce(ts.sla_days, vp.sla_days)))
                                                             as sla_breached
from public.entries e
left join public.vocab_options vp
  on vp.kind = 'priority' and vp.key = e.priority
-- AT MOST ONE ROW, by primary key. This is the property the assertion block
-- below re-proves on live data: a many-side join here would duplicate entries in
-- every list in the app, and it would do it silently — the extra rows are
-- identical apart from the SLA columns, so the screens would just look busier.
-- e.track_id is nullable (`on delete set null` on entries.track_id), and a null
-- track_id simply matches nothing and falls through to the priority default.
left join public.track_slas ts
  on ts.track_id = e.track_id and ts.priority = e.priority
where e.status not in ('done', 'cancelled');

alter view public.v_entry_health set (security_invoker = on);

grant select on public.v_entry_health to authenticated;

comment on view public.v_entry_health is
  'Open entries with server-resolved age, overdue and SLA math. Staleness comes from vocab_options (priority rows), falling back to 2/4/8/15. SLA resolves track_slas -> vocab_options.sla_days -> NULL. security_invoker: the caller''s RLS on entries applies.';


-- ── the row-count assertion ─────────────────────────────────────────────────
-- The one claim in this file that a reader cannot verify by reading it, checked
-- against the live data at apply time instead of asserted in a comment.
--
-- It compares the view's row count against the count of open entries, which is
-- what the view was before either join existed. An equal count proves both left
-- joins are one-to-at-most-one HERE, on this project's actual rows — a PK
-- guarantees it in theory, and this catches the case where someone later
-- relaxes the key or adds a third join with a many side.
--
-- It raises rather than notices. A migration that silently doubled every list in
-- the product is a worse outcome than one that refuses to finish, and the
-- refusal costs nothing: everything above is idempotent, so the fix-and-re-run
-- loop is free.
do $row_count$
declare
  v_open int;
  v_view int;
begin
  select count(*) into v_open
    from public.entries e
   where e.status not in ('done', 'cancelled');

  select count(*) into v_view from public.v_entry_health;

  if v_open <> v_view then
    raise exception
      'v_entry_health row count changed: % open entries but % view rows — the track_slas join is not one-to-at-most-one',
      v_open, v_view;
  end if;

  raise notice 'OpsTrack 0006: v_entry_health returns % rows for % open entries — join preserves the row count.',
    v_view, v_open;
end
$row_count$;
