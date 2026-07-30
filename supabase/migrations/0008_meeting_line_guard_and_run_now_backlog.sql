-- 0008 — two holes 0004 left open: a deletable meeting line, and a "Run now"
-- that eats the backlog it just promised to create.
--
-- Deploy: Supabase Dashboard -> SQL Editor -> paste + Run. Re-runnable from the
-- top in any state, same discipline as 0001-0007: `create or replace function`
-- on unchanged signatures, `drop trigger if exists` before `create trigger`,
-- and two self-verifying probe blocks at the bottom that roll themselves back.


-- ═══ PART 1 ═══ meeting_lines: the column guard the delete policy depends on
--
-- WHAT WAS WRONG
-- 0004 wrote two policies that only make sense together:
--
--   meeting_lines_update  using (is_member()) with check (is_member())
--   meeting_lines_delete  using (created_by = auth.uid() or is_admin())
--
-- and annotated the second "Deleting someone else's line removes it from the
-- record with no trace, so it stays with the author (or an admin)."
--
-- It did not stay with the author. RLS is ROW-level: the permissive UPDATE has
-- no column guard behind it, so any member could
--
--   update public.meeting_lines set created_by = auth.uid() where id = <theirs>
--
-- and then pass their own delete policy. Reproduced against the live project
-- inside begin;…rollback; before this file was written: member B's direct
-- DELETE of member A's line was refused (0 rows), the created_by rewrite
-- SUCCEEDED (1 row), and the DELETE that followed removed the line (1 row).
-- Three statements to erase somebody else's sentence from the minutes.
--
-- The same UPDATE also let a member repoint another member's line at a
-- different meeting_id — moving a sentence from the meeting where it was said
-- into one where it was not — or rewrite its created_at.
--
-- WHY A TRIGGER AND NOT A NARROWER POLICY
-- Narrowing meeting_lines_update to the author is exactly what 0004 refused,
-- for a good reason it still holds: "triage is collaborative — the person
-- running the meeting fixes the owner on a line somebody else typed while they
-- type the next one." Scoping the policy to the author makes the feature
-- single-player. What is actually wanted is "any member may edit the CONTENT,
-- nobody may edit the PROVENANCE", and a policy cannot express a column list.
-- A BEFORE UPDATE trigger can, and 0004 already installs precisely this shape
-- twice — entries_guard_update() pins created_by/created_at/template_id and
-- notifications_guard_update() pins six columns. meeting_lines was the one that
-- got the permissive policy without the guard behind it.
--
-- WHAT STAYS WRITABLE, deliberately: raw, parsed, state, entry_id and seq. That
-- is the whole of collaborative triage — fix the words, fix the plan, discard a
-- line, link the entry the commit created, settle a seq race.

create or replace function public.meeting_lines_guard_update()
returns trigger
language plpgsql
as $$
begin
  -- The `auth.uid() is not null` test is the same JWT-less passthrough
  -- notifications_guard_update() and guard_profile_role() use: the SQL Editor,
  -- the service role and commitMeetingLines()' server-side paths act without a
  -- JWT and are the only writers meant to touch the rest. A client always has
  -- one, so a client is always guarded.
  --
  -- `id` is pinned too. meeting_lines.id is a CLIENT-MINTED uuid (see
  -- src/api/meetings.ts's header), not an identity column, so unlike
  -- notifications there is nothing stopping a PATCH from setting it — and
  -- re-keying a row is another way to detach a line from its author.
  if auth.uid() is not null then
    new.id         := old.id;
    new.meeting_id := old.meeting_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

-- Name matters: BEFORE triggers fire in NAME order, and
-- `meeting_lines_guard_update_trg` sorts before `meeting_lines_touch_trg`. So
-- the guard restores the pinned columns FIRST and meeting_lines_touch() then
-- diffs the row the database is actually going to store. A pure created_by
-- steal therefore also fails to bump updated_at, which is correct: nothing
-- changed. (0007 is the cautionary tale for getting this order wrong.)
drop trigger if exists meeting_lines_guard_update_trg on public.meeting_lines;
create trigger meeting_lines_guard_update_trg
  before update on public.meeting_lines
  for each row execute function public.meeting_lines_guard_update();

comment on function public.meeting_lines_guard_update() is
  'Pins id, meeting_id, created_by and created_at on a client UPDATE. meeting_lines_update is deliberately any-member so triage is collaborative; this is what keeps meeting_lines_delete (author or admin) from being trivially bypassed by rewriting created_by first.';


-- ═══ PART 2 ═══ materialize_template: "Run now" stops cancelling the backlog
--
-- WHAT WAS WRONG
-- 0004's advance step walked next_run_on forward one occurrence at a time until
-- it passed today:
--
--   while v_next <= current_date loop
--     v_next := public.advance_recurrence(v_next, ...);
--   end loop;
--
-- One "Run now" click on a template that had been due for eleven weeks created
-- ONE entry and moved next_run_on past today, so the scheduler had nothing left
-- to catch up on. Reproduced live inside begin;…rollback; before this file was
-- written: a weekly template at next_run_on = current_date - 70 produced one
-- entry, next_run_on = current_date + 7, and a following
-- materialize_due_recurring() created zero more. Ten owed occurrences gone,
-- silently, from a button whose tooltip says only "Creates one item dated
-- today."
--
-- That directly contradicts what the screen has just told the user:
-- RecurringAdmin renders `recurring.behindCount` ("{count} runs are overdue")
-- with `recurring.behindBody` — "The next pass will create every one of them.
-- Skip ahead to keep only the next run." Discarding the backlog is what the
-- SEPARATE "Skip to {date}" button does, explicitly and with a toast. Run now
-- was doing it silently.
--
-- THE FIX is to delete the loop and advance exactly ONE occurrence, which is
-- also all `advance_recurrence` was ever built to do. Run now then consumes the
-- occurrence it just materialised and leaves the rest of the backlog to the
-- scheduler's catch-up loop (0002), which is precisely what the screen promises.
--
-- IDEMPOTENCY IS UNAFFECTED, and this is worth spelling out because it is the
-- property the loop looked like it was protecting. The due date is anchored to
-- current_date + lead_days, never to next_run_on, so a second click computes the
-- SAME date, the (template_id, due_date) unique index absorbs the insert, and
-- the function early-returns on the absorb path at the top — before reaching the
-- advance at all. Click it five times, get one entry and one advance.
--
-- AND THE OLD COMMENT WAS WRONG ABOUT ITSELF: it claimed the loop "caps a
-- pathological one … the same way the scheduler's catch-up loop does", but
-- materialize_due_recurring() has `and v_guard < 60` and this had no guard of
-- any kind. A daily template anchored years back ran one advance_recurrence()
-- call per elapsed day. It terminated — advance_recurrence floors at p_from + 1
-- — but the cap the comment described did not exist. With the loop gone the
-- question is moot: one step, no loop, nothing to cap.
--
-- Body is 0004's verbatim apart from that block (create or replace rewrites the
-- whole function, so anything not repeated here would be silently dropped).

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
    -- EXACTLY ONE OCCURRENCE. This click materialised one run, so it consumes
    -- one run. If the template is further behind than that, next_run_on is
    -- still <= current_date afterwards and materialize_due_recurring() creates
    -- the remaining occurrences on its next pass — which is what the overdue
    -- banner on the templates screen has already told the user will happen.
    -- Collapsing the whole backlog here is the "Skip to <date>" button's job,
    -- and that one says so out loud.
    v_next := public.advance_recurrence(
      r.next_run_on, r.cadence, r.custom_interval_days, r.day_of_week, r.day_of_month);

    update public.recurring_templates set next_run_on = v_next where id = r.id;
  end if;

  return v_entry;
end;
$$;

-- Repeated because create or replace does not carry grants across a signature
-- change and because they are cheap insurance if this file is ever run against
-- a project that only has 0001-0003.
revoke all on function public.materialize_template(uuid, boolean) from public;
revoke all on function public.materialize_template(uuid, boolean) from anon;
grant execute on function public.materialize_template(uuid, boolean) to authenticated;


-- ═══ PROBE 1 ═══ the guard actually pins, and does not break triage
-- Everything below happens inside a subtransaction that is thrown away by a
-- sentinel exception — the 0007 pattern. No row survives this block, and the
-- scratch meeting is created here rather than borrowed from real data so the
-- probe works on an empty workspace and can never touch a real one.
do $prove$
declare
  v_meet_a   uuid := gen_random_uuid();
  v_meet_b   uuid := gen_random_uuid();
  v_line     uuid := gen_random_uuid();
  v_thief    uuid;
  v_owner    uuid;
  v_meeting  uuid;
  v_created  timestamptz;
  v_stamp    timestamptz;
  v_state    text;
  v_raw      text;
begin
  -- A REAL profile id, because created_by is a FK to profiles: with a synthetic
  -- uuid an unguarded steal would abort on 23503 and the probe would "pass" for
  -- the wrong reason. Falling back to a random uuid keeps this runnable on a
  -- project with no profiles yet, where the FK is never checked because the
  -- guard leaves the column null.
  select p.id into v_thief from public.profiles p limit 1;
  v_thief := coalesce(v_thief, gen_random_uuid());

  begin
    insert into public.meetings (id, title) values
      (v_meet_a, '0008 probe A'),
      (v_meet_b, '0008 probe B');

    -- created_by is left NULL on purpose: it is a FK to profiles, and a probe
    -- that needed two real member rows could not run on a fresh project. NULL
    -- is just as good a witness — the guard's job is that the value does not
    -- CHANGE, and "null became the caller's id" is the exact steal.
    insert into public.meeting_lines (id, meeting_id, seq, raw, state)
      values (v_line, v_meet_a, 1, 'said by somebody else', 'pending');

    select created_at into v_created from public.meeting_lines where id = v_line;

    -- Become a client. auth.uid() reads request.jwt.claims ->> 'sub'; no
    -- auth.users row is involved, and `true` makes the setting local to this
    -- transaction so it dies with the rollback below.
    perform set_config('request.jwt.claims',
                       json_build_object('sub', v_thief)::text, true);

    update public.meeting_lines
       set created_by = v_thief,
           meeting_id = v_meet_b,
           created_at = v_created - interval '1 day',
           -- …and one legitimate edit in the same statement, so the probe also
           -- proves the guard did not turn triage read-only.
           state      = 'discarded',
           raw        = 'edited by a teammate'
     where id = v_line;

    select created_by, meeting_id, created_at, state, raw
      into v_owner, v_meeting, v_stamp, v_state, v_raw
      from public.meeting_lines where id = v_line;

    raise exception using errcode = 'OT008', message = 'probe rollback';
  exception
    when sqlstate 'OT008' then
      null; -- subtransaction discarded; the reads above survive
  end;

  if v_owner is not null then
    raise exception
      'OpsTrack 0008 FAILED: a member rewrote meeting_lines.created_by (null -> %). meeting_lines_delete is bypassable.',
      v_owner;
  end if;

  if v_meeting is distinct from v_meet_a then
    raise exception
      'OpsTrack 0008 FAILED: a member moved a line to another meeting (% -> %).',
      v_meet_a, v_meeting;
  end if;

  if v_stamp is distinct from v_created then
    raise exception
      'OpsTrack 0008 FAILED: a member rewrote meeting_lines.created_at (% -> %).',
      v_created, v_stamp;
  end if;

  -- The other half. A guard that pinned everything would be a regression, not a
  -- fix: triage is collaborative by design.
  if v_state is distinct from 'discarded' or v_raw is distinct from 'edited by a teammate' then
    raise exception
      'OpsTrack 0008 FAILED: the guard blocked a legitimate triage edit (state=%, raw=%). Collaborative triage is broken.',
      v_state, v_raw;
  end if;

  raise notice
    'OpsTrack 0008 probe 1: created_by/meeting_id/created_at held under a member UPDATE; state and raw still writable. Rolled back.';
end
$prove$;


-- ═══ PROBE 2 ═══ Run now advances one occurrence and keeps the backlog
do $prove$
declare
  v_tpl    uuid := gen_random_uuid();
  v_start  date := current_date - 70;
  v_first  uuid;
  v_again  uuid;
  v_next1  date;
  v_next2  date;
  v_made   int;
  v_total  int;
begin
  begin
    insert into public.recurring_templates (id, title, cadence, next_run_on, lead_days, active)
      values (v_tpl, '0008 probe template', 'weekly', v_start, 0, false);

    v_first := public.materialize_template(v_tpl, true);
    select next_run_on into v_next1 from public.recurring_templates where id = v_tpl;

    -- Second click, same day: the absorb path must return the same entry and
    -- must NOT advance again.
    v_again := public.materialize_template(v_tpl, true);
    select next_run_on into v_next2 from public.recurring_templates where id = v_tpl;

    -- `active = false` above keeps the workspace-wide scheduler off this row, so
    -- the catch-up is measured deliberately rather than as a side effect.
    update public.recurring_templates set active = true where id = v_tpl;
    v_made := public.materialize_due_recurring();

    select count(*) into v_total
      from public.entries where template_id = v_tpl;

    raise exception using errcode = 'OT008', message = 'probe rollback';
  exception
    when sqlstate 'OT008' then
      null;
  end;

  if v_next1 is distinct from v_start + 7 then
    raise exception
      'OpsTrack 0008 FAILED: Run now advanced next_run_on % -> % instead of one weekly occurrence (%). The backlog was cancelled.',
      v_start, v_next1, v_start + 7;
  end if;

  if v_next2 is distinct from v_next1 or v_again is distinct from v_first then
    raise exception
      'OpsTrack 0008 FAILED: a second Run now was not idempotent (entry % -> %, next_run_on % -> %).',
      v_first, v_again, v_next1, v_next2;
  end if;

  -- Ten owed occurrences plus the one Run now made. The exact number matters
  -- less than "more than one": before this file it was always exactly 1.
  if v_total <= 1 then
    raise exception
      'OpsTrack 0008 FAILED: after Run now the scheduler created % more rows and the template has % entries total — the catch-up is still being eaten.',
      v_made, v_total;
  end if;

  raise notice
    'OpsTrack 0008 probe 2: Run now advanced % -> % (one occurrence), a second click was a no-op, and the scheduler then created % of the remaining runs (% entries total). Rolled back.',
    v_start, v_next1, v_made, v_total;
end
$prove$;
