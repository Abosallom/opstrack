-- OpsTrack workspace data: the sixth track, per-track suggested tags, the
-- meeting capture buffer, the notification inbox and its triggers, the
-- run-one-template RPC, the entries column guard, and the entries_update
-- widening.
--
-- Everything here is additive. Nothing in this file drops a column, rewrites a
-- row an admin could have edited, or changes the meaning of an existing one —
-- with exactly one exception, the entries_update policy at the bottom, which is
-- fenced and labelled so it can be removed before the file is run.
--
-- Deploy: Supabase Dashboard -> SQL Editor -> paste + Run. Re-runnable from the
-- top in any partial state, same discipline as 0001/0002/0003.


-- ── Onboarding, the sixth track ─────────────────────────────────────────────
-- The decided requirement that exists nowhere in the codebase: onboarding a new
-- entity is either a direct integration or a portal handover, and until now that
-- work had no track to live in.
--
-- color/color_light are the `green` pair from the preset swatch palette in
-- src/styles/global.css (--swatch-green-dark / --swatch-green-light). It is the
-- free pair with the most hue separation from the five seeded tracks (violet,
-- blue, cyan, amber, rose) — teal and indigo both sit within ~25 degrees of a
-- colour already in use, which at a 3px unlabelled track bar is not a
-- distinction anyone can make. The light half doubles as the --track-infra token
-- in global.css, but no track ROW uses it: 0002's seed repair matched the five
-- existing tracks BY HUE and Infrastructure came out amber. Token names and seed
-- colours drifted apart in 0001; that is documented there and not re-litigated
-- here.
--
-- color_light MUST be supplied: 0002's repair block only covers the original
-- five, and a null would drop this track back to `color` on the light theme,
-- where #46c26a sits at roughly 2:1 on white.
alter table public.tracks add column if not exists suggested_tags text[] not null default '{}';

comment on column public.tracks.suggested_tags is
  'Tags the capture form and filters offer first for this track. Per-track rather than global: nothing in the app names a track, so the mechanism generalises to any track an admin creates.';

insert into public.tracks (name, name_ar, color, color_light, icon, sort_order) values
  ('Onboarding', 'التهيئة والربط', '#46c26a', '#2c7a45', 'plug', 6)
on conflict (lower(name)) do nothing;

-- Scoped to `suggested_tags = '{}'` so a later admin edit is never clobbered by
-- a re-run — the same shape as 0002's `color_light is null` seed repair. An
-- admin who deliberately clears the list back to empty gets it re-seeded on the
-- next run; that is the accepted cost of not adding a "has been configured"
-- column whose only reader would be this statement.
update public.tracks
   set suggested_tags = '{direct-integration,portal}'::text[]
 where lower(name) = 'onboarding'
   and suggested_tags = '{}'::text[];

-- No new GIN index on entries.tags here. 0001:344 already created
-- entries_tags_idx on exactly `using gin (tags)`; a second index on the same
-- column would be paid for on every entry write and read by nothing. The tag
-- filters on board and follow-ups use the existing one.


-- ── meeting_lines ───────────────────────────────────────────────────────────
-- Every line typed during a live meeting, PERSISTED AS TYPED. This table exists
-- because the alternative — holding the meeting in client state until triage —
-- loses the entire meeting when a phone locks, a tab crashes, or the room's wifi
-- drops. A meeting is the one screen where the user cannot simply do it again.
--
-- `state` carries the triage lifecycle: pending (captured, not yet triaged),
-- committed (became an entry, entry_id set), discarded (triaged away but KEPT —
-- a discarded line stays readable as a note in the minutes), note (captured as
-- context from the start, never destined to be an entry).
create table if not exists public.meeting_lines (
  id         uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  seq        int not null,
  raw        text not null default '',
  parsed     jsonb,
  state      text not null default 'pending'
               check (state in ('pending', 'committed', 'discarded', 'note')),
  entry_id   uuid references public.entries (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Ordering within a meeting is the seq, not created_at: two attendees typing at
-- once produce timestamps a millisecond apart and a minutes document whose lines
-- interleave differently on every render. The unique index is what lets the
-- client mint the next seq optimistically and find out immediately if it lost
-- the race.
create unique index if not exists meeting_lines_seq_uidx
  on public.meeting_lines (meeting_id, seq);

create index if not exists meeting_lines_entry_idx
  on public.meeting_lines (entry_id) where entry_id is not null;

alter table public.meeting_lines enable row level security;

drop policy if exists meeting_lines_select on public.meeting_lines;
create policy meeting_lines_select on public.meeting_lines
  for select using (public.is_member());

drop policy if exists meeting_lines_insert on public.meeting_lines;
create policy meeting_lines_insert on public.meeting_lines
  for insert with check (public.is_member() and created_by = auth.uid());

-- UPDATE is any member, unlike insert and delete. Triage is collaborative: the
-- person running the meeting fixes the owner on a line somebody else typed,
-- while they type the next one. Scoping this to the author would make the
-- feature single-player.
drop policy if exists meeting_lines_update on public.meeting_lines;
create policy meeting_lines_update on public.meeting_lines
  for update using (public.is_member()) with check (public.is_member());

-- Deleting someone else's line removes it from the record with no trace, so it
-- stays with the author (or an admin). Triage does not delete anyway — it moves
-- a line to 'discarded', which keeps it in the minutes.
--
-- THIS POLICY WAS UNENFORCEABLE AS SHIPPED, and 0008 is what closes it: the
-- permissive UPDATE above had no column guard behind it, so any member could
-- rewrite `created_by` to their own id and then pass this `using` clause. See
-- 0008 for the reproduction and the meeting_lines_guard_update() trigger.
drop policy if exists meeting_lines_delete on public.meeting_lines;
create policy meeting_lines_delete on public.meeting_lines
  for delete using (created_by = auth.uid() or public.is_admin());

create or replace function public.meeting_lines_touch()
returns trigger
language plpgsql
as $$
begin
  if (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists meeting_lines_touch_trg on public.meeting_lines;
create trigger meeting_lines_touch_trg
  before update on public.meeting_lines
  for each row execute function public.meeting_lines_touch();


-- ── notifications ───────────────────────────────────────────────────────────
-- The in-app inbox. Two facts a person needs to be told: something became yours,
-- and something you asked for is done.
--
-- bigint identity rather than uuid: rows are written by triggers at a rate of a
-- few per day, read newest-first, and never referenced from elsewhere. A
-- monotonic key sorts and pages for free.
--
-- entry_title and actor_name are DENORMALIZED SNAPSHOTS, not joins. An inbox
-- line has to stay readable after the entry is retitled or the actor's profile
-- is deleted, and the alternative is every notification row triggering a lookup
-- in a store the bell may not have loaded. The cost is that a renamed entry
-- reads with its old title in old notifications, which is what an email inbox
-- does too.
create table if not exists public.notifications (
  id           bigint generated always as identity primary key,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  kind         text not null check (kind in ('assigned', 'completed')),
  entry_id     uuid not null references public.entries (id) on delete cascade,
  entry_title  text not null default '',
  actor_id     uuid references public.profiles (id) on delete set null,
  actor_name   text not null default '',
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);

-- The inbox query, verbatim: one recipient, newest first.
create index if not exists notifications_recipient_idx
  on public.notifications (recipient_id, created_at desc);

-- The badge query. Partial, because the unread set is the small one and it is
-- read on every screen in the app.
create index if not exists notifications_unread_idx
  on public.notifications (recipient_id) where read_at is null;

create index if not exists notifications_entry_idx
  on public.notifications (entry_id);

alter table public.notifications enable row level security;

-- Recipient-only, and that is the entire access model. There is no "see who else
-- was notified".
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select using (recipient_id = auth.uid());

-- The recipient may mark their own row read. Column-level pinning is the
-- trigger's job below — RLS is row-level and cannot say "only read_at".
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

-- There is intentionally NO insert policy and NO delete policy.
--   * INSERT: rows arrive only through entries_notify() below, which is
--     SECURITY DEFINER and therefore runs as this table's owner — and a table's
--     owner is exempt from its own RLS. So a client cannot mint a notification
--     out of nothing: every row here corresponds to a real change to a real
--     entry, written by the database at the moment it happened.
--
--     WHAT THIS DOES NOT BUY, stated plainly because an earlier version of this
--     comment claimed it did: it is not proof against an ATTRIBUTED forgery.
--     `actor_name` is a snapshot of profiles.display_name, profiles_update lets
--     a member edit their own row, and guard_profile_role() pins only `role` —
--     so a member can rename themselves, cause a notification, and rename back,
--     leaving an inbox line permanently attributed to a name they no longer
--     hold. The trigger path is honest about WHAT happened; WHO is only as
--     trustworthy as a self-chosen display name.
--
--     The mitigation is on the read side and it is a contract, not a policy:
--     `actor_id` is the durable identity and the inbox resolves the display name
--     from it live, falling back to this snapshot only for a profile that no
--     longer exists. src/api/notifications.ts states the order; the Wave-3
--     notification centre implements it.
--   * DELETE: an inbox you can empty is an inbox that can be emptied by someone
--     else's bug. Read is a state, not a deletion; if volume ever matters, a
--     retention job runs as the owner and needs no policy either.
-- Under RLS, an operation with no permissive policy is denied for everyone, so
-- both guarantees are enforced by the database rather than by app code a raw
-- REST call could route around. Which is also why `force row level security`
-- must never be added here: forcing RLS applies the policies to the owner too,
-- and every trigger-written notification would then be denied — surfacing as the
-- user's perfectly legitimate entry edit being rejected.

create or replace function public.notifications_guard_update()
returns trigger
language plpgsql
as $$
begin
  -- notifications_update lets the recipient write their row, which without this
  -- would also let them rewrite kind, title and actor — i.e. edit the evidence.
  -- read_at is the only field a recipient owns. Same shape, and the same
  -- reasoning, as guard_profile_role() in 0001: the auth.uid() test lets the
  -- JWT-less paths (the SQL Editor, the service role, a future retention job)
  -- through, and those are the only writers that are supposed to touch the rest.
  --
  -- `id` is absent on purpose: it is GENERATED ALWAYS AS IDENTITY, so Postgres
  -- rejects any statement that tries to set it before this trigger ever runs.
  if auth.uid() is not null then
    new.recipient_id := old.recipient_id;
    new.kind         := old.kind;
    new.entry_id     := old.entry_id;
    new.entry_title  := old.entry_title;
    new.actor_id     := old.actor_id;
    new.actor_name   := old.actor_name;
    new.created_at   := old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists notifications_guard_update_trg on public.notifications;
create trigger notifications_guard_update_trg
  before update on public.notifications
  for each row execute function public.notifications_guard_update();

-- The writer. Notifications are written HERE, in the database, and never by the
-- client — not as a matter of taste: the client that made the change is one of
-- several (another tab, a second device, the recurrence RPC, an edge function),
-- and a notification that only exists when a particular screen happened to be
-- open is worse than having no notifications at all.
--
-- Two rules, both of which include "not to yourself". Being told you did the
-- thing you just did is how a notification system gets muted in week one.
--   1. owner_id set or changed  -> tell the NEW owner.
--   2. status becomes 'done'    -> tell the entry's CREATOR, the person who
--      asked for it. Not the owner: the owner is the one who just finished it.
--
-- SECURITY DEFINER because there is no insert policy on notifications, by
-- design (see above). `set search_path = public` is mandatory on a definer
-- function so a caller cannot shadow the tables it writes.
create or replace function public.entries_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assigned    boolean;
  v_completed   boolean;
  v_scheduled   boolean;
  v_actor       uuid;
  v_actor_name  text;
begin
  v_assigned :=
    new.owner_id is not null
    and (tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id);

  v_completed :=
    tg_op = 'UPDATE'
    and new.status = 'done'
    and old.status is distinct from 'done'
    and new.created_by is not null;

  -- Resolved once, and only when something is actually going to be written:
  -- this trigger runs on every entry update in the workspace, and most of them
  -- are a title edit nobody needs to hear about.
  if not (v_assigned or v_completed) then
    return null;
  end if;

  -- IS A PERSON DOING THIS, OR IS IT THE SCHEDULE? Everything below turns on the
  -- answer, and it must not be inferred from auth.uid().
  --
  -- auth.uid() reads the request.jwt.claims GUC, and SECURITY DEFINER does not
  -- clear it — it changes the ROLE, not the request. So inside
  -- materialize_due_recurring() auth.uid() is whichever member's browser happened
  -- to call it, and that member is a bystander, not an author. api/entries.ts's
  -- materializeRecurring() runs from store/auth.ts on every sign-in, so this is
  -- the normal path, not an edge case. Reading a NULL actor there — as an earlier
  -- version of this comment asserted — meant a member who owns a recurring
  -- template never heard about their own scheduled assignment, and a template
  -- owned by someone else was announced as "⟨whoever opened the app⟩ assigned
  -- you this".
  --
  -- `new.created_by is null` on an INSERT is the honest signal, and the database
  -- guarantees it: entries_insert is `with check (is_member() and created_by =
  -- auth.uid())`, so a client insert ALWAYS carries its author. The only writers
  -- that can leave it null are the SECURITY DEFINER materialisers and the SQL
  -- editor — and for all of those the truthful actor is nobody. An UPDATE always
  -- has a real writer; the materialisers only ever insert.
  v_scheduled := tg_op = 'INSERT' and new.created_by is null;

  if v_scheduled then
    -- Nobody did this. Naming a bystander is worse than naming no one, and the
    -- inbox renders an actor-less line from the kind alone.
    v_actor      := null;
    v_actor_name := '';
  else
    -- Through profiles rather than raw from auth.uid(), for the FK reason
    -- log_config_audit() spells out: an auth user without a profile row would
    -- violate actor_id's FK, and because this is an AFTER trigger that violation
    -- would roll back the user's perfectly legitimate entry edit.
    select p.id, p.display_name into v_actor, v_actor_name
      from public.profiles p where p.id = auth.uid();
    v_actor_name := coalesce(v_actor_name, '');
  end if;

  -- The self-notify suppression applies only to a real interactive writer. Being
  -- told you did the thing you just did is what mutes a notification system; being
  -- told the schedule handed you this week's item is the whole point of having one.
  --
  -- `is distinct from` rather than `<>` in the interactive branch: v_actor is still
  -- NULL for the service role and the SQL Editor, and NULL <> uuid is NULL, which
  -- reads as false and would silence those writes too.
  if v_assigned and (v_scheduled or new.owner_id is distinct from v_actor) then
    insert into public.notifications (recipient_id, kind, entry_id, entry_title, actor_id, actor_name)
    values (new.owner_id, 'assigned', new.id, new.title, v_actor, v_actor_name);
  end if;

  if v_completed and new.created_by is distinct from v_actor then
    insert into public.notifications (recipient_id, kind, entry_id, entry_title, actor_id, actor_name)
    values (new.created_by, 'completed', new.id, new.title, v_actor, v_actor_name);
  end if;

  return null;  -- AFTER trigger: the return value is ignored.
end;
$$;

-- One AFTER trigger for both rules rather than two `update of` triggers. `update
-- of owner_id` fires on the SET list, not on a real change, so it would both
-- miss and over-fire depending on how a client shapes its PATCH; the
-- is-distinct-from guards above cannot miss.
drop trigger if exists entries_notify_trg on public.entries;
create trigger entries_notify_trg
  after insert or update on public.entries
  for each row execute function public.entries_notify();


-- ── materialize_template ────────────────────────────────────────────────────
-- "Run now" on the recurring-templates screen: one template, one entry, right
-- now. materialize_due_recurring() in 0001/0002 is the scheduled path and catches
-- up on missed occurrences; this is the deliberate single act.
--
-- THE DUE DATE IS ANCHORED TO TODAY (current_date + lead_days), not to
-- next_run_on, and that is what makes the function idempotent. Anchor it to
-- next_run_on and the second click computes a different date — because the first
-- click advanced the schedule — and mints a second entry. Anchored to today, the
-- (template_id, due_date) unique index from 0001 absorbs the second call and
-- returns the same entry id. Click it five times, get one entry.
--
-- next_run_on advances only when the template was actually DUE (next_run_on <=
-- today). Running an ad-hoc copy of a template scheduled for next Monday must not
-- silently cancel Monday's; consuming an occurrence that was already due must not
-- leave the scheduler to create a near-duplicate tomorrow.
--
-- SECURITY DEFINER for the same reason as materialize_due_recurring(): it
-- inserts entries with created_by null — nobody created them, the schedule did —
-- which entries_insert would otherwise reject.
create or replace function public.materialize_template(
  p_id      uuid,
  p_advance boolean default true
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  r       public.recurring_templates%rowtype;
  v_due   date;
  v_next  date;
  v_entry uuid;
begin
  -- The JWT-less passthrough log_config_audit() documents: the SQL Editor and
  -- the service role act without auth.uid() and are supposed to reach this. A
  -- JWT without a profile is not.
  if auth.uid() is not null and not public.is_member() then
    raise exception 'only a member may run a recurring template' using errcode = '42501';
  end if;

  select * into r from public.recurring_templates where id = p_id;
  if not found then
    -- 'template_not_found' is a token for src/lib/pgError.ts, following the
    -- 'track_in_use' / 'last_active_track' convention in 0002.
    raise exception 'template_not_found: no recurring template %', p_id
      using errcode = 'P0002';
  end if;

  v_due := current_date + r.lead_days;

  insert into public.entries (
    track_id, title, type, priority, owner_id, owner_name,
    due_date, template_id, status
  ) values (
    r.track_id, r.title, r.type, r.priority, r.owner_id, r.owner_name,
    v_due, r.id, 'new'
  )
  on conflict (template_id, due_date) where template_id is not null do nothing
  returning id into v_entry;

  -- The absorb path. Return the entry that already exists rather than null: the
  -- caller wants "the entry for this run", and a null would send the templates
  -- screen looking for a failure that did not happen.
  if v_entry is null then
    select e.id into v_entry
      from public.entries e
     where e.template_id = r.id and e.due_date = v_due
     limit 1;
    return v_entry;
  end if;

  if p_advance and r.next_run_on <= current_date then
    v_next := public.advance_recurrence(
      r.next_run_on, r.cadence, r.custom_interval_days, r.day_of_week, r.day_of_month);

    -- SUPERSEDED BY 0008 — this loop is wrong and the comment below is wrong
    -- about itself. Walking next_run_on past today made one "Run now" click
    -- cancel every overdue occurrence the screen had just promised to create,
    -- and there is no guard here at all (materialize_due_recurring has one;
    -- this never did). 0008 replaces the whole function with a single
    -- advance_recurrence() step. Left in place because migrations are history.
    --
    -- advance_recurrence() steps exactly one occurrence. A template that has
    -- been due for a fortnight needs several steps to get past today, and the
    -- guard caps a pathological one (bad cadence data, next_run_on years back)
    -- the same way the scheduler's catch-up loop does.
    while v_next <= current_date loop
      v_next := public.advance_recurrence(
        v_next, r.cadence, r.custom_interval_days, r.day_of_week, r.day_of_month);
    end loop;

    update public.recurring_templates set next_run_on = v_next where id = r.id;
  end if;

  return v_entry;
end;
$$;

revoke all on function public.materialize_template(uuid, boolean) from public;
revoke all on function public.materialize_template(uuid, boolean) from anon;
grant execute on function public.materialize_template(uuid, boolean) to authenticated;


-- ── realtime ────────────────────────────────────────────────────────────────
-- Teammates' work should appear without a refresh, and two of these four are the
-- reason the feature exists at all: meeting_lines makes a live meeting
-- multi-device, notifications makes the bell ring on the device that did not
-- cause the change.
--
-- Guarded, because the supabase_realtime publication only exists on a real
-- Supabase project and adding a table twice is an error rather than a no-op. The
-- whole block degrades to a notice: a project without realtime is a project with
-- a slightly staler UI, not a broken migration.
do $realtime$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['entries', 'entry_updates', 'meeting_lines', 'notifications'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
        raise notice 'OpsTrack: added public.% to supabase_realtime.', t;
      end if;
    end loop;
  else
    raise notice 'OpsTrack: supabase_realtime publication not found — realtime disabled.';
  end if;
exception when others then
  raise notice 'OpsTrack: could not configure realtime (%).', sqlerrm;
end;
$realtime$;


-- ── entries: immutable identity columns, and who last wrote the row ─────────
-- RLS is row-level. A policy says which ROWS a member may write; it says nothing
-- about which COLUMNS. Under EITHER version of entries_update — 0001's
-- creator/owner/admin or the widening below — that leaves `created_by`,
-- `created_at` and `template_id` writable by whoever can write the row at all:
-- authorship can be taken, and `created_at` is what v_entry_health measures
-- sla_due_at from, so writing `created_at = now()` erases a missed SLA. Verified
-- through RLS as a plain member on the live project before this trigger existed:
-- `created_by_now_B=true`, `sla_breached before=true after=false`.
--
-- This block sits OUTSIDE the owner-decision fence deliberately. The widening
-- makes the hole reachable by every member instead of by two, but the hole is
-- not the widening's — it is there either way, and so is the fix.
--
-- Same shape and same reasoning as notifications_guard_update() above and 0001's
-- guard_profile_role(): the auth.uid() test lets the JWT-less privileged paths
-- (the SQL Editor, the service role, the SECURITY DEFINER materialisers) through,
-- and those are the only writers that are supposed to touch these three.
--
-- `updated_by` is stamped in the same pass, so "who edited what" has a
-- server-side answer for a plain field edit that appends no thread row at all —
-- which is what the widening's accountability argument below quietly assumed and
-- the schema did not provide. Nullable, and null means "not a person".
--
-- Everything the feature actually needs stays writable: status, owner, dates,
-- tags, title, description, priority, type, links.
alter table public.entries add column if not exists updated_by uuid
  references public.profiles (id) on delete set null;

comment on column public.entries.updated_by is
  'Who last wrote this row, stamped by entries_guard_update(). NULL for the scheduler, the SQL editor and the service role. The thread in entry_updates remains the narrative record; this is the answer for a field edit that writes no thread row.';

create or replace function public.entries_guard_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  -- Identity and provenance are not editable by anyone acting as a user. Pinned
  -- FIRST, so a rejected attempt to rewrite them cannot also count as "something
  -- changed" in the diff below and bump the activity clock.
  new.created_by  := old.created_by;
  new.created_at  := old.created_at;
  new.template_id := old.template_id;

  -- The diff is entries_touch()'s diff, minus updated_by — deliberately the same
  -- test, because the two triggers have to agree on what "an edit" is. A member
  -- re-saving a row unchanged (dropping a board card back in the column it came
  -- from) must not stamp a new editor and, through entries_touch(), drag
  -- last_activity_at forward and make a stale item look attended to.
  --
  -- updated_by is resolved THROUGH profiles rather than taken raw from auth.uid():
  -- a JWT without a profile row would violate the FK, and the failure would
  -- surface as the member's perfectly legitimate edit being rejected. Same
  -- reasoning as vocab_touch() in 0003.
  if (to_jsonb(new) - 'updated_at' - 'last_activity_at' - 'updated_by')
     is distinct from
     (to_jsonb(old) - 'updated_at' - 'last_activity_at' - 'updated_by') then
    new.updated_by := coalesce(
      (select p.id from public.profiles p where p.id = auth.uid()),
      old.updated_by
    );
  end if;

  return new;
end;
$$;

-- BEFORE UPDATE, and it runs ahead of entries_touch(): Postgres fires BEFORE row
-- triggers in NAME order, and `entries_guard_update` sorts before
-- `entries_touch_trg`. That ordering is load-bearing — entries_touch() diffs the
-- row to decide whether to move the clocks, and it has to see the pinned values,
-- not the ones the client sent.
drop trigger if exists entries_guard_update on public.entries;
create trigger entries_guard_update
  before update on public.entries
  for each row execute function public.entries_guard_update();


-- ▼ OWNER DECISION — entries_update widening ─────────────────────────────────
-- DELETE THIS BLOCK WHOLESALE (down to the ▲ fence) IF THE OWNER DECLINES, and
-- set ENTRIES_UPDATE_IS_OPEN = false in src/lib/permissions.ts in the same
-- commit. 0001's policy is never dropped in that path, so it simply survives.
-- The column guard above is NOT part of this decision and stays either way.
--
-- 0001 scoped UPDATE to creator, owner or admin — deliberately narrower than
-- SELECT. In practice that means a member cannot drag another member's board
-- card, cannot snooze another member's follow-up, and cannot mark another
-- member's item done, while every screen in phases 4-6 is designed as if they
-- can. On a small trusted team that is friction, not safety.
--
-- The accountability layer is not this policy — it is entry_updates, which has
-- no UPDATE and no DELETE policy at all, plus entries.updated_by for the field
-- edits that write no thread row. Who was ALLOWED to change something becomes
-- "any member", which is what the team already is.
--
-- WHAT "ANSWERABLE" ACTUALLY MEANS HERE, corrected. This paragraph used to say
-- entry_updates "records every status transition with its author" and offer that
-- as the thing the widening was traded for. The database does not enforce it and
-- was never going to: 0001:497-499 leaves the transition row to the app on
-- purpose, because a trigger would race the client's own insert and write two
-- rows for one transition. src/api/entries.ts's updateEntry() is therefore two
-- requests — the PATCH, then the entry_updates insert — and the second can fail
-- on its own. FIX-BACKLOG R1-DB-2.
--
-- Two of the three columns are enforced and one is not, and the split is worth
-- knowing before anyone leans on this again:
--
--   * entries.updated_by IS server-stamped, by entries_guard_update() above, on
--     every write that changes anything. It cannot be omitted, forged or
--     cleared. "Who touched this row last" is a database guarantee.
--   * entry_updates rows are IMMUTABLE once written — no UPDATE policy, no
--     DELETE policy, and author_id must equal auth.uid(). Nothing can be
--     rewritten or removed after the fact.
--   * That a transition row EXISTS at all is a best-effort client write. It is
--     not a schema invariant and must not be described as one.
--
-- The app closes the realistic gap rather than the theoretical one: a failed
-- transition insert is handed to the offline queue (store/outbox.ts's
-- queueOrphanedTransition, wired in main.tsx), which retries with backoff,
-- survives a reload and surfaces in the outbox sheet if it keeps failing. What
-- remains open is the insider case — a raw PATCH with a member's own JWT, which
-- this policy permits and no trigger compensates for. That is deliberately out
-- of scope, for the reason four paragraphs up: on a small trusted team it is
-- friction, not safety. updated_by still names them.
--
-- DELETE stays admin-only. Widening UPDATE loses nothing that cannot be read
-- back out of the thread or off updated_by; widening DELETE loses the row.
drop policy if exists entries_update on public.entries;
create policy entries_update on public.entries
  for update using (public.is_member()) with check (public.is_member());
-- ▲ END OWNER DECISION ───────────────────────────────────────────────────────
