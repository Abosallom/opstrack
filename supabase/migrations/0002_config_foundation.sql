-- OpsTrack configuration foundation: everything the admin Track Manager needs
-- on the server, plus two corrections to 0001 that only became visible once
-- tracks were editable.
--
-- What this file does NOT do: widen or narrow the entry vocabulary. The
-- type/status/priority value lists below are copied from 0001 CHARACTER FOR
-- CHARACTER. All that changes is that they stop being anonymous, so the day
-- someone does need to widen one it is a one-line edit against a name we chose
-- instead of archaeology against a Postgres-generated identifier. See ADMIN.md
-- for why the vocabulary is frozen and what the escape hatch costs.
--
-- Deploy once: Supabase Dashboard → SQL Editor → paste + Run.
-- Apply 0001 first. Like 0001 this file is written to be re-runnable: add
-- column if not exists, drop constraint if exists before add constraint,
-- create or replace on every function, drop trigger if exists before every
-- create trigger, and seed repairs scoped so a second pass matches nothing.

-- ── named vocabulary constraints ────────────────────────────────────────────
-- 0001 declared these inline, so Postgres named them <table>_<column>_check.
-- Dropping and re-adding re-validates the table, which is free today (the
-- tables are empty or nearly so) and is the cheapest moment this will ever
-- happen. The value lists are IDENTICAL to 0001 — this is a rename, not a
-- vocabulary change. If a list here ever diverges from src/types.ts, the app
-- will send a value the database rejects with a raw 23514 nobody has mapped.

alter table public.entries drop constraint if exists entries_status_check;
alter table public.entries drop constraint if exists entries_status_chk;
alter table public.entries add constraint entries_status_chk
  check (status in ('new','in_progress','blocked','waiting_on','done','cancelled'));

alter table public.entries drop constraint if exists entries_type_check;
alter table public.entries drop constraint if exists entries_type_chk;
alter table public.entries add constraint entries_type_chk
  check (type in ('action','decision','issue','request','change','escalation','note'));

alter table public.entries drop constraint if exists entries_priority_check;
alter table public.entries drop constraint if exists entries_priority_chk;
alter table public.entries add constraint entries_priority_chk
  check (priority in ('low','medium','high','critical'));

alter table public.recurring_templates drop constraint if exists recurring_templates_type_check;
alter table public.recurring_templates drop constraint if exists recurring_templates_type_chk;
alter table public.recurring_templates add constraint recurring_templates_type_chk
  check (type in ('action','decision','issue','request','change','escalation','note'));

alter table public.recurring_templates drop constraint if exists recurring_templates_priority_check;
alter table public.recurring_templates drop constraint if exists recurring_templates_priority_chk;
alter table public.recurring_templates add constraint recurring_templates_priority_chk
  check (priority in ('low','medium','high','critical'));

alter table public.recurring_templates drop constraint if exists recurring_templates_cadence_check;
alter table public.recurring_templates drop constraint if exists recurring_templates_cadence_chk;
alter table public.recurring_templates add constraint recurring_templates_cadence_chk
  check (cadence in ('daily','weekly','biweekly','monthly','quarterly','custom'));

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles drop constraint if exists profiles_role_chk;
alter table public.profiles add constraint profiles_role_chk
  check (role in ('admin','member'));

-- ── entries_touch(): stop a track move from resetting the staleness clock ───
-- 0001 bumped updated_at and last_activity_at off ONE diff, which was correct
-- while nothing could move an entry between tracks. The Track Manager's
-- delete-with-reassign repoints every entry on a retired track in a single
-- UPDATE, and under the old body that would have made a dozen genuinely stale
-- items look freshly worked — the follow-ups screen and the digest both read
-- last_activity_at and would have gone quiet for days.
--
-- So the diff is split. updated_at still moves on any real column change
-- (it is the bookkeeping clock, and a reassignment IS bookkeeping).
-- last_activity_at moves only when something OTHER than track_id changed.
--
-- The trigger from 0001 (entries_touch_trg) already points at this function by
-- name, so replacing the body is the whole change; re-creating the trigger
-- would rebind it to exactly the same thing.
--
-- ▲ SUPERSEDED BY 0007 — the body below did NOT deliver what this comment
-- promises, from the moment 0004 landed. 0004 added `entries.updated_by` and
-- stamps it in entries_guard_update(), which is a BEFORE trigger that sorts
-- ahead of entries_touch_trg by name; the diffs below never subtract that
-- column, so a pure track move reached the second diff carrying a changed
-- `updated_by` and reset last_activity_at anyway. 0007 subtracts it from both
-- diffs and proves the fix against live data. Read this block as the intent and
-- 0007 as the implementation.
create or replace function public.entries_touch()
returns trigger
language plpgsql
as $$
begin
  -- updated_at and last_activity_at are subtracted from BOTH sides of both
  -- diffs so the AFTER INSERT trigger on entry_updates — which issues an
  -- UPDATE that lands right back here — is seen as "no real change" instead of
  -- stamping now() a second time.
  if (to_jsonb(new) - 'updated_at' - 'last_activity_at')
     is distinct from
     (to_jsonb(old) - 'updated_at' - 'last_activity_at') then
    new.updated_at := now();
  end if;

  if (to_jsonb(new) - 'updated_at' - 'last_activity_at' - 'track_id')
     is distinct from
     (to_jsonb(old) - 'updated_at' - 'last_activity_at' - 'track_id') then
    new.last_activity_at := now();
  end if;

  -- closed_at tracks the terminal statuses in both directions, so reopening an
  -- item clears it rather than leaving a stale close date on the dashboard.
  -- Unchanged from 0001 — repeated here because create or replace rewrites the
  -- whole body.
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

-- ── tracks: the columns an editable track needs ─────────────────────────────
-- color_light is nullable on purpose: null means "this track has no light
-- theme override", and the UI falls back to color. Making it not-null with a
-- default would force a colour nobody chose onto every future track.
alter table public.tracks add column if not exists description    text not null default '';
alter table public.tracks add column if not exists description_ar text not null default '';
alter table public.tracks add column if not exists color_light    text;
alter table public.tracks add column if not exists created_at     timestamptz not null default now();
alter table public.tracks add column if not exists updated_at     timestamptz not null default now();
alter table public.tracks add column if not exists created_by     uuid references public.profiles (id) on delete set null;
alter table public.tracks add column if not exists archived_at    timestamptz;

-- Hex only, six digits. The colour is written straight into a CSS custom
-- property by the frontend, so anything else is either an invisible bar or —
-- with a value like `red; background: url(...)` — a style injection. Six
-- digits rather than 3-or-6 because the light/dark pair is compared and
-- documented as full hex everywhere else in this project.
alter table public.tracks drop constraint if exists tracks_color_chk;
alter table public.tracks add constraint tracks_color_chk
  check (color ~* '^#[0-9a-f]{6}$');

alter table public.tracks drop constraint if exists tracks_color_light_chk;
alter table public.tracks add constraint tracks_color_light_chk
  check (color_light is null or color_light ~* '^#[0-9a-f]{6}$');

-- btrim before measuring: '   ' is an empty name wearing a hat, and it would
-- otherwise pass a naive length check and render as a blank row.
alter table public.tracks drop constraint if exists tracks_name_len_chk;
alter table public.tracks add constraint tracks_name_len_chk
  check (char_length(btrim(name)) between 1 and 40);

-- 0001 has tracks_name_uidx on lower(name) but nothing on the Arabic name, so
-- two tracks could share one — indistinguishable to an Arabic reader, who sees
-- name_ar and nothing else. PARTIAL, because name_ar defaults to '' and a
-- plain unique index would let exactly one track go untranslated and reject
-- the second with a baffling duplicate-name error.
create unique index if not exists tracks_name_ar_uidx
  on public.tracks (lower(name_ar)) where name_ar <> '';

-- archived_at is maintained in BOTH directions, the same discipline
-- entries_touch() applies to closed_at: restoring a track must clear its
-- archive date, or the admin list shows a live track stamped with the day it
-- was retired.
create or replace function public.tracks_touch()
returns trigger
language plpgsql
as $$
begin
  -- Diffed rather than stamped unconditionally: reorder_tracks() writes every
  -- track in one statement, and an unconditional stamp would report the whole
  -- list as edited (and emit a full set of audit rows) on a no-op drag.
  if (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
    new.updated_at := now();
  end if;

  if new.archived is distinct from old.archived then
    if new.archived then
      new.archived_at := coalesce(new.archived_at, now());
    else
      new.archived_at := null;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists tracks_touch_trg on public.tracks;
create trigger tracks_touch_trg
  before update on public.tracks
  for each row execute function public.tracks_touch();

-- ── track guards ────────────────────────────────────────────────────────────
-- Every track_id FK in 0001 is `on delete set null`, so deleting a busy track
-- would not fail — it would silently orphan its entries, meetings and
-- templates into a null track that no filter and no digest section shows.
-- This trigger turns that into a refusal the client can explain.
--
-- SECURITY DEFINER so the counts are complete no matter whose policies are in
-- force. A guard that undercounts is a guard that lets you orphan rows, and
-- entries_select is one policy edit away from being narrower than
-- "every member sees everything".
create or replace function public.tracks_block_delete_when_referenced()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entries   int;
  v_meetings  int;
  v_templates int;
begin
  select count(*) into v_entries    from public.entries             where track_id = old.id;
  select count(*) into v_meetings   from public.meetings            where track_id = old.id;
  select count(*) into v_templates  from public.recurring_templates where track_id = old.id;

  if v_entries + v_meetings + v_templates > 0 then
    -- The 'track_in_use:' prefix is a contract with src/lib/pgError.ts, which
    -- pattern-matches it to an i18n key. The counts ride along in the message
    -- for the SQL Editor and the Postgres log; the UI gets its own counts from
    -- getTrackUsage() and never parses numbers out of this string.
    raise exception
      'track_in_use: % entries, % meetings, % recurring templates still reference this track',
      v_entries, v_meetings, v_templates
      using errcode = '23503';
  end if;

  return old;
end;
$$;

drop trigger if exists tracks_block_delete_trg on public.tracks;
create trigger tracks_block_delete_trg
  before delete on public.tracks
  for each row execute function public.tracks_block_delete_when_referenced();

-- Archiving is the primary retire action, so this guard has to cover archive
-- as well as delete: retiring the last active track leaves the capture form
-- with an empty track picker and nowhere to file work, and the only way back
-- is the SQL Editor. Deleting an already-archived track is fine as long as
-- something active remains.
create or replace function public.tracks_keep_one_active()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining int;
begin
  -- An UPDATE that is not a retirement (rename, recolour, reorder, restore) is
  -- none of this trigger's business.
  if tg_op = 'UPDATE' and not (new.archived and not old.archived) then
    return new;
  end if;

  select count(*) into v_remaining
    from public.tracks t
   where t.archived = false
     and t.id <> old.id;

  if v_remaining = 0 then
    -- 'last_active_track' is the token src/lib/pgError.ts matches on.
    raise exception
      'last_active_track: the workspace must keep at least one active track'
      using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists tracks_keep_one_active_trg on public.tracks;
create trigger tracks_keep_one_active_trg
  before update or delete on public.tracks
  for each row execute function public.tracks_keep_one_active();

-- ── config_audit ────────────────────────────────────────────────────────────
-- Configuration changes are rare, consequential, and done by one person with
-- no second pair of eyes. before/after hold whole row images so a delete is
-- still legible after the row is gone.
create table if not exists public.config_audit (
  id         uuid primary key default gen_random_uuid(),
  table_name text not null,
  row_id     uuid,
  action     text not null,
  actor_id   uuid references public.profiles (id) on delete set null,
  before     jsonb,
  after      jsonb,
  created_at timestamptz not null default now()
);

-- Deliberately NO check constraint on `action`. Every writer is in this file
-- (or the next migration), and a value list here would just be a second place
-- to edit — with a 23514 nobody has mapped as the cost of forgetting.
create index if not exists config_audit_created_idx on public.config_audit (created_at desc);
create index if not exists config_audit_row_idx     on public.config_audit (table_name, row_id);

alter table public.config_audit enable row level security;

drop policy if exists config_audit_select on public.config_audit;
create policy config_audit_select on public.config_audit
  for select using (public.is_admin());

grant select on public.config_audit to authenticated;

-- There is intentionally NO insert, update or delete policy on this table,
-- and it needs none:
--   * Under RLS, an operation with no permissive policy is denied for
--     everyone. That is the same immutability guarantee entry_updates relies
--     on, and it is enforced by the database rather than by app code a raw
--     REST call could route around.
--   * Rows arrive through log_config_audit() below, which is SECURITY DEFINER
--     and therefore runs as its owner — the role that created this table in
--     the SQL Editor. A table's OWNER is exempt from its own RLS.
-- Which is why `alter table public.config_audit force row level security` must
-- never be added: forcing RLS applies the policies to the owner too, every
-- audited write would then be denied, and because the write happens inside an
-- AFTER trigger the failure would surface as the admin's perfectly legitimate
-- track edit being rejected.

-- The single writer. SECURITY DEFINER for the RLS exemption above; the
-- auth.uid() test mirrors guard_profile_role() in 0001 for the same reason —
-- the SQL Editor and the service role act with no JWT, and those are exactly
-- the privileged paths that are supposed to be able to write here (the seed
-- repair at the bottom of this file is one of them).
create or replace function public.log_config_audit(
  p_table  text,
  p_row_id uuid,
  p_action text,
  p_before jsonb,
  p_after  jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'only an admin may write configuration audit rows'
      using errcode = '42501';
  end if;

  insert into public.config_audit (table_name, row_id, action, actor_id, before, after)
  values (
    p_table,
    p_row_id,
    p_action,
    -- Resolved through profiles rather than taken raw from auth.uid(): an
    -- auth user without a profile row would violate the FK, and because this
    -- runs inside an AFTER trigger that violation would roll back the admin's
    -- track edit rather than merely losing one audit row.
    (select p.id from public.profiles p where p.id = auth.uid()),
    p_before,
    p_after
  );
end;
$$;

-- `from public` is NOT enough on Supabase, and getting this wrong is how an
-- append-only table stops being append-only.
--
-- A new function is granted EXECUTE to the PUBLIC pseudo-role by Postgres, and
-- `revoke ... from public` takes exactly that back. But every Supabase project
-- also ships
--
--   alter default privileges in schema public
--     grant all on functions to postgres, anon, authenticated, service_role;
--
-- so `anon` holds its OWN explicit grant, which a revoke from PUBLIC does not
-- touch. Without the second line below, an unauthenticated
-- `POST /rest/v1/rpc/log_config_audit` with the shipped anon key runs with
-- auth.uid() null — which the guard above reads as "SQL Editor or service
-- role", i.e. privileged — and the SECURITY DEFINER body then inserts as the
-- table's owner, who is exempt from its RLS. That is a forged audit row, and an
-- unbounded table, from a key that is public by design.
--
-- The guard's JWT-less passthrough is still right for the paths it was written
-- for (the SQL Editor, the service role, the seed repair at the bottom of this
-- file); revoking anon is what makes those the ONLY ways to reach it.
--
-- `authenticated` must keep EXECUTE: tracks_audit() and delete_track() are both
-- SECURITY INVOKER, so their calls into this function run with the signed-in
-- admin's privileges. Revoking it here would fail every audited track write.
-- Those callers are covered by the is_admin() test above, which a JWT-bearing
-- caller cannot skip.
revoke all on function public.log_config_audit(text, uuid, text, jsonb, jsonb) from public;
revoke all on function public.log_config_audit(text, uuid, text, jsonb, jsonb) from anon;
grant execute on function public.log_config_audit(text, uuid, text, jsonb, jsonb) to authenticated;

-- AFTER, not BEFORE: the row image recorded must be the one that survived
-- every other trigger and constraint on the table.
create or replace function public.tracks_audit()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    -- Casts on the null: with a single candidate Postgres would resolve an
    -- untyped null anyway, but an overload added later would make this
    -- ambiguous at runtime, inside a trigger, on someone else's write.
    perform public.log_config_audit('tracks', new.id, 'insert', null::jsonb, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    if to_jsonb(new) is distinct from to_jsonb(old) then
      perform public.log_config_audit('tracks', new.id, 'update', to_jsonb(old), to_jsonb(new));
    end if;
    return new;
  else
    perform public.log_config_audit('tracks', old.id, 'delete', to_jsonb(old), null::jsonb);
    return old;
  end if;
end;
$$;

drop trigger if exists tracks_audit_trg on public.tracks;
create trigger tracks_audit_trg
  after insert or update or delete on public.tracks
  for each row execute function public.tracks_audit();

-- ── track RPCs ──────────────────────────────────────────────────────────────
-- Both are SECURITY INVOKER. They exist for ATOMICITY, not privilege: a
-- reorder is one statement instead of five round trips that can half-apply,
-- and a delete-with-reassign must not be able to move the entries and then
-- fail to remove the track. RLS therefore still evaluates against the caller
-- and rejects a member exactly as if they had typed the statements by hand.
-- Contrast materialize_due_recurring() in 0001, which is DEFINER for a real
-- reason: it inserts entries with created_by null, which no policy allows.
--
-- The is_admin() check at the top is not the authorization — RLS is. It is
-- there so a member gets a clean 42501 that pgError.ts maps to a translated
-- message, instead of a silent zero-row UPDATE reported as success.

create or replace function public.reorder_tracks(p_ids uuid[])
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count int;
begin
  if not public.is_admin() then
    raise exception 'only an admin may reorder tracks' using errcode = '42501';
  end if;

  -- One statement, ordinality as the new sort_order. The `is distinct from`
  -- filter skips tracks that are already in place so a drag that moves one row
  -- does not stamp updated_at on all five and write five audit rows.
  update public.tracks t
     set sort_order = o.ord::int
    from unnest(p_ids) with ordinality as o(id, ord)
   where t.id = o.id
     and t.sort_order is distinct from o.ord::int;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- anon is revoked explicitly for the reason spelled out over log_config_audit:
-- Supabase's default privileges give anon its own grant, which a revoke from
-- PUBLIC leaves in place. is_admin() already returns false without a JWT, so
-- this is defence in depth rather than a fix — but every RPC in this file
-- should be unreachable with the anon key, not merely unsuccessful.
revoke all on function public.reorder_tracks(uuid[]) from public;
revoke all on function public.reorder_tracks(uuid[]) from anon;
grant execute on function public.reorder_tracks(uuid[]) to authenticated;

-- Returns {"entries":n,"meetings":n,"templates":n} — what was moved, which is
-- what the toast reports. Reassignment happens BEFORE the delete so the
-- tracks_block_delete_when_referenced() guard finds nothing left to protect;
-- with p_reassign_to null the guard fires and the client offers the reassign
-- step.
create or replace function public.delete_track(
  p_id          uuid,
  p_reassign_to uuid default null
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_entries   int := 0;
  v_meetings  int := 0;
  v_templates int := 0;
  v_before    jsonb;
begin
  if not public.is_admin() then
    raise exception 'only an admin may delete a track' using errcode = '42501';
  end if;

  -- Every raise below carries a token ('reassign_self:', 'track_missing:',
  -- 'reassign_archived:') for the same reason the guard triggers do: without one
  -- src/lib/pgError.ts has nothing to match and falls through to the generic
  -- common.error, which tells an admin who just lost a destination nothing.

  -- Reassigning a track to itself would move nothing, delete the target, and
  -- report success — the exact shape of an accident that loses work.
  if p_reassign_to is not null and p_reassign_to = p_id then
    raise exception 'reassign_self: a track cannot be reassigned to itself'
      using errcode = '22023';
  end if;

  select to_jsonb(t) into v_before from public.tracks t where t.id = p_id;
  if v_before is null then
    raise exception 'track_missing: track % not found', p_id using errcode = 'P0002';
  end if;

  if p_reassign_to is not null then
    -- `and not archived` is load-bearing, not a tidiness check. An archived
    -- track is invisible to the whole app: listTracks() filters archived = false
    -- by default (src/api/tracks.ts), so every reassigned entry and meeting
    -- lands under a track no picker and no list shows, and
    -- materialize_due_recurring() above skips templates whose track is archived,
    -- so reassigned templates stop producing entries permanently — while this
    -- function returns its counts and the UI toasts "moved N entries". Losing
    -- work quietly is worse than refusing, so this refuses.
    if not exists (
      select 1 from public.tracks where id = p_reassign_to and archived = false
    ) then
      if exists (select 1 from public.tracks where id = p_reassign_to) then
        raise exception
          'reassign_archived: reassignment target % is archived', p_reassign_to
          using errcode = '22023';
      end if;
      raise exception 'track_missing: reassignment target % not found', p_reassign_to
        using errcode = 'P0002';
    end if;

    -- entries_touch() is what makes this safe: repointing track_id moves
    -- updated_at but leaves last_activity_at alone, so a stale item stays
    -- stale through the move. NOTE: true of the function AS AMENDED BY 0007,
    -- not of the body defined above — see the superseded note on it. Between
    -- 0004 and 0007 this bulk reassignment refreshed the staleness clock on
    -- every row it touched, which is the exact failure the split diff exists to
    -- prevent.
    update public.entries set track_id = p_reassign_to where track_id = p_id;
    get diagnostics v_entries = row_count;

    update public.meetings set track_id = p_reassign_to where track_id = p_id;
    get diagnostics v_meetings = row_count;

    update public.recurring_templates set track_id = p_reassign_to where track_id = p_id;
    get diagnostics v_templates = row_count;

    -- Logged as its own row, before the delete row, because "where did 40
    -- entries go" is a different question from "who deleted the track" and
    -- the answer to the first is these counts.
    perform public.log_config_audit(
      'tracks', p_id, 'move', v_before,
      jsonb_build_object(
        'reassign_to', p_reassign_to,
        'entries',     v_entries,
        'meetings',    v_meetings,
        'templates',   v_templates
      )
    );
  end if;

  -- The 'delete' audit row is written by tracks_audit_trg with to_jsonb(old)
  -- as `before`, so the log still reads "Deleted Network (#06b6d4)" long after
  -- the row itself is gone. Doing it here as well would double-log the
  -- deletion and miss any delete issued straight through PostgREST.
  delete from public.tracks where id = p_id;

  return jsonb_build_object(
    'entries',   v_entries,
    'meetings',  v_meetings,
    'templates', v_templates
  );
end;
$$;

revoke all on function public.delete_track(uuid, uuid) from public;
revoke all on function public.delete_track(uuid, uuid) from anon;
grant execute on function public.delete_track(uuid, uuid) to authenticated;

-- ── recurrence: archived tracks stop producing entries ──────────────────────
-- An archived track is retired, and a retired track quietly minting new work
-- every Monday is the whole reason archive exists. `active` on the template is
-- deliberately left alone: it is the author's switch, archived is the admin's,
-- and un-archiving the track resumes the schedule without anyone having to
-- remember which templates they turned off.
--
-- LEFT join, so a template with no track at all (track_id is null) still runs
-- — an inner join would silently retire those, which nobody asked for.
--
-- Everything else in this function is unchanged from 0001; create or replace
-- rewrites the whole body, so it is repeated here in full.
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
    select rt.*
      from public.recurring_templates rt
      left join public.tracks t on t.id = rt.track_id
     where rt.active
       and rt.next_run_on <= current_date
       and coalesce(t.archived, false) = false
     order by rt.next_run_on
  loop
    v_next  := r.next_run_on;
    v_guard := 0;

    -- Catch-up loop: if the job did not run for a fortnight, every missed
    -- occurrence still gets its entry rather than silently collapsing into
    -- one. The guard caps a pathological template (bad cadence data, a
    -- next_run_on set years back) at 60 rows instead of filling the table.
    -- Note this is also what un-archiving a track does: next_run_on was never
    -- advanced while the track was archived, so the missed occurrences are
    -- created on the next run, up to the same cap. ADMIN.md says so out loud.
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

-- This one is SECURITY DEFINER and inserts entries, so the anon revoke is not
-- decoration: with the shipped anon key still holding Supabase's default grant,
-- an unauthenticated caller could mint entries on every due template.
revoke all on function public.materialize_due_recurring() from public;
revoke all on function public.materialize_due_recurring() from anon;
grant execute on function public.materialize_due_recurring() to authenticated;

-- ── seed repair ─────────────────────────────────────────────────────────────
-- The five seeded tracks predate color_light, so in the light theme they fall
-- back to `color` — and three of those five (cyan, amber, rose on near-black)
-- sit at roughly 2.5:1 on white, which is the exact failure src/styles/
-- global.css redeclares its whole palette to avoid.
--
-- Every update is scoped to `color_light is null` AND the original name and
-- colour, so it can only touch a row nobody has edited: recolour PMO in the UI
-- and re-running this migration will not undo you.
--
-- The values come from the [data-theme='light'] --track-* block in global.css,
-- matched BY HUE rather than by token name — the seed and the token set drifted
-- apart in 0001 (--track-network is amber, the Network seed is cyan). A track
-- that is cyan in dark and amber in light is not one track with two shades, it
-- is two different tracks depending on the time of day. IT Operations is the
-- one seed with no counterpart at all: it is blue, and there is no blue in the
-- five track hues, so it takes the light theme's --blue (#1560c9) — same hue,
-- same contrast discipline.
--
-- The icon names ('clipboard-list', 'server-cog', 'network', 'server',
-- 'activity') are deliberately NOT touched. src/lib/trackIcons.ts is being
-- written to provide exactly these names, and its lookup falls back to a
-- circle glyph for anything else — which is also why there is no CHECK
-- constraint on tracks.icon. A value list here would put the frontend's
-- component registry in the database and turn adding a glyph into a migration.

update public.tracks set color_light = '#5b4bd6'   -- --track-pmo   (violet)
 where lower(name) = 'pmo'            and color = '#8b5cf6' and color_light is null;

update public.tracks set color_light = '#1560c9'   -- --blue        (blue)
 where lower(name) = 'it operations'  and color = '#3b82f6' and color_light is null;

update public.tracks set color_light = '#0a7d94'   -- --track-itops (cyan)
 where lower(name) = 'network'        and color = '#06b6d4' and color_light is null;

update public.tracks set color_light = '#9c6600'   -- --track-network (amber)
 where lower(name) = 'infrastructure' and color = '#f59e0b' and color_light is null;

update public.tracks set color_light = '#c2385f'   -- --track-sre   (rose)
 where lower(name) = 'sre'            and color = '#f43f5e' and color_light is null;

-- ── admin bootstrap ─────────────────────────────────────────────────────────
-- store/auth.ts is dropping the hardcoded isAdminEmail OR that currently makes
-- the admin screens appear for this address regardless of profiles.role, so
-- this update has to land BEFORE that deploy: otherwise the screens render and
-- every write comes back 42501.
--
-- This runs in the SQL Editor with auth.uid() null. guard_profile_role() only
-- pins the role column when a real end user is acting (0001:109) — the JWT-less
-- paths, the service role and the SQL Editor, are precisely the two that are
-- SUPPOSED to assign roles, and it lets them through by design. That is why
-- this works, and it is also why it is the only way to fix a lost admin role.
-- ADMIN.md carries the recovery statement.
do $bootstrap$
declare
  v_rows int;
begin
  update public.profiles p
     set role = 'admin'
    from auth.users u
   where u.id = p.id
     and lower(u.email) = 'az.alsaloom@gmail.com'
     and p.role <> 'admin';

  get diagnostics v_rows = row_count;

  if v_rows > 0 then
    raise notice 'OpsTrack: promoted az.alsaloom@gmail.com to admin.';
  elsif exists (
    select 1 from public.profiles p
      join auth.users u on u.id = p.id
     where lower(u.email) = 'az.alsaloom@gmail.com' and p.role = 'admin'
  ) then
    raise notice 'OpsTrack: az.alsaloom@gmail.com is already an admin.';
  else
    -- Expected on a brand new project: the profile only exists after the
    -- first OTP sign-in creates the auth user.
    raise notice 'OpsTrack: no profile for az.alsaloom@gmail.com yet — sign in once, then re-run this file (or the recovery statement in ADMIN.md).';
  end if;
end
$bootstrap$;
