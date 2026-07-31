-- 0014 — the attribution hole in recurring templates: work assigned to a
-- colleague, delivered to their phone, authored by nobody.
--
-- Deploy: Supabase Dashboard -> SQL Editor -> paste + Run. Re-runnable from the
-- top in any state, same discipline as 0001-0013: `add column if not exists`,
-- `create or replace function` on unchanged signatures, `drop trigger if
-- exists` before `create trigger`, grants restated every run, and three
-- self-verifying probe blocks at the bottom that roll themselves back.
--
-- ⚠ PENDING APPLICATION. This file has never been run: the Supabase management
-- token is revoked, so the fixer who wrote it could not apply it. Nothing in it
-- is live until the owner pastes it into the SQL Editor. The probes are how the
-- file proves itself at apply time; a failure raises and rolls back.
--
-- ⚠ AND IT MUST BE THE LAST ONE APPLIED, which is the ordinary rule and worth
-- saying out loud here because this file is the SECOND to redefine
-- `materialize_template()`. Re-running 0008 on its own after this reinstates
-- 0008's version and silently takes `created_by` back out of the INSERT — the
-- exact defect, restored, with no error. Every migration in this directory is
-- re-runnable individually; re-run them IN ORDER, or re-run this one after.
--
--
-- ═══ WHAT WAS WRONG (FIX-BACKLOG R1-SEC-2) ═══
--
-- Three grants lined up into a hole with no floor:
--
--   1. `recurring_templates` is member-writable — `insert with check
--      (is_member())` and `update using (is_member())` (0001:286,290; restated
--      0009:180,184) — and the table carried NO author column, no audit
--      trigger, and no `log_config_audit` call. It was the only configuration
--      table with no record of who wrote it; 0002 covers tracks, 0003
--      vocab_options, 0006 track_slas.
--
--   2. `materialize_template()` — the "Run now" button, `grant execute … to
--      authenticated` (0008:216) — inserted its entry WITHOUT `created_by`
--      (0008:172). `entries.created_by` has no column default (0001:319), so
--      the row landed NULL.
--
--   3. `entries_notify()` reads exactly that as "the schedule did it":
--      `v_scheduled := tg_op = 'INSERT' and new.created_by is null` (0004:323),
--      then `v_actor := null`. The inbox row and the Web Push built from it use
--      `assignedNoActor` — "You were assigned ⟨title⟩" — naming nobody.
--
-- The reproduction was entirely through the shipped UI, as a plain member.
-- /settings/recurring is deliberately not admin-gated (App.tsx:588; only the
-- Delete button is, RecurringAdmin.tsx:1092), which is correct — the table's own
-- policies say any member may author and tune a template. Create one aimed at a
-- colleague, press "Run now", edit the template back. The colleague gets an
-- inbox line and a lock-screen push; the entry's `created_by` is NULL and
-- `entries_guard_update()` (0004:554) pins it, so it can never be corrected;
-- `entries.updated_by` is NULL too; and the template row that carried the title
-- and the owner never named an author to begin with.
--
-- 0004 asserts the guarantee this broke, twice, in its own comments:
-- "for all of those the truthful actor is nobody" (0004:315-321) and "Who
-- changed what stays answerable" (0004:604-608). The first is true of
-- `materialize_due_recurring()` — the cron/sign-in pass — and was false of
-- `materialize_template()`, which is a button a member presses.
--
--
-- ═══ WHY THE FIX IS AT THE RECIPE AND NOT ONLY AT THE BUTTON ═══
--
-- Setting `created_by` inside `materialize_template()` closes "Run now" and
-- nothing else. The same hole is reachable one step slower with no button at
-- all: a member creates a template with `next_run_on = current_date` aimed at a
-- colleague and waits. `store/auth.ts:434` calls `materializeRecurring()` on
-- EVERY sign-in, `materialize_due_recurring()` mints the identical entry, and
-- because that path legitimately has no author the notification is legitimately
-- actor-less. The only durable answer is that the row which carried the title
-- and the owner names an author, whichever materialiser fires.
--
-- So this file does both, and deliberately does NOT touch
-- `materialize_due_recurring()`: `entries.created_by` stays NULL on the cron
-- path, because there the "schedule did it" semantics are TRUE and they are a
-- regression 0004 already fixed once (0004:305-321).
--
--
-- ═══ WHAT THIS FILE ADDS ═══
--
--   PART 1  recurring_templates.created_by / .updated_by, server-stamped and
--           pinned by a BEFORE trigger, so a client can neither omit nor forge
--           them.
--   PART 2  recurring_templates_audit(), the append-only history in
--           config_audit — which is what survives "edit the template back".
--   PART 3  materialize_template() records the member who pressed the button.
--
-- Rollback, if it is ever wanted:
--   drop trigger recurring_templates_audit_trg on public.recurring_templates;
--   drop trigger recurring_templates_guard_write_trg on public.recurring_templates;
--   drop function public.recurring_templates_audit();
--   drop function public.recurring_templates_guard_write();
--   alter table public.recurring_templates drop column updated_by, drop column created_by;
-- and re-run 0008 to restore its materialize_template().


-- ═══ PART 1 ═══ the recipe gets an author
--
-- Nullable, and NULL means "not a person" — the same sentinel
-- `entries.updated_by` uses (0004:536). The SQL Editor, the service role and
-- the 0012 handover all act without a JWT and are the only writers meant to
-- leave these alone.
--
-- `on delete set null` rather than cascade, for the reason 0012 gives about
-- owner_name: a template outlives the person who wrote it, and losing the
-- recipe because its author left would be the larger wrong. What is lost when a
-- member is deleted is the pointer, not the history — config_audit below keeps
-- whole row images.
alter table public.recurring_templates
  add column if not exists created_by uuid references public.profiles (id) on delete set null;
alter table public.recurring_templates
  add column if not exists updated_by uuid references public.profiles (id) on delete set null;

comment on column public.recurring_templates.created_by is
  'Who wrote this recipe, stamped by recurring_templates_guard_write() and pinned thereafter. NULL for the SQL editor and the service role. FIX-BACKLOG R1-SEC-2: without this a member could aim a template at a colleague, have it delivered as a push, and leave no trace of who did it.';
comment on column public.recurring_templates.updated_by is
  'Who last edited the CONTENT of this recipe. Deliberately NOT moved by a next_run_on-only write — see recurring_templates_guard_write().';

create or replace function public.recurring_templates_guard_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    -- Resolved from the JWT, never from the payload. `recurring_templates_insert`
    -- is a bare `is_member()` check with no column list behind it, so a client
    -- that supplied its own `created_by` would simply be believed; overwriting
    -- it here is what makes the column an attribution rather than a suggestion.
    --
    -- Through `profiles` rather than raw from auth.uid(), for the FK reason
    -- log_config_audit() spells out (0002:355): a JWT without a profile row
    -- would violate the FK and the failure would surface as a legitimate write
    -- being rejected.
    --
    -- The JWT-less passthrough leaves the column alone rather than nulling it,
    -- so a seed or an import may set it explicitly. A client always carries a
    -- JWT, so a client is always stamped.
    if auth.uid() is not null then
      new.created_by := (select p.id from public.profiles p where p.id = auth.uid());
      new.updated_by := new.created_by;
    end if;
    return new;
  end if;

  -- UPDATE. Same JWT-less passthrough as notifications_guard_update(),
  -- meeting_lines_guard_update() and guard_profile_role().
  if auth.uid() is null then
    return new;
  end if;

  -- Identity and provenance are not editable by anyone acting as a user. `id` is
  -- pinned for the reason 0008 gives about meeting_lines: re-keying a row is
  -- another way to detach it from its author, and nothing in a PATCH stops it.
  new.id         := old.id;
  new.created_by := old.created_by;

  -- WHY `next_run_on` IS SUBTRACTED FROM THE DIFF, and this is the one
  -- judgement call in the file.
  --
  -- Both materialisers advance that column and nothing else:
  -- `materialize_due_recurring()` (0002:649) and `materialize_template()`
  -- (0008:204). SECURITY DEFINER changes the ROLE, not the request, so
  -- auth.uid() inside them is whichever member's browser happened to call —
  -- and materializeRecurring() runs from store/auth.ts on EVERY sign-in. Left
  -- in the diff, every member who opens the app would be recorded as having
  -- edited every template that came due, which is entries_notify()'s
  -- "naming a bystander is worse than naming no one" (0004:326) one table over.
  --
  -- The cost is real and is stated rather than hidden: the "Skip to ⟨date⟩"
  -- button writes next_run_on and nothing else (api/templates.ts:313), so a
  -- deliberate skip is not attributed either. The two are indistinguishable
  -- from the row image — same column, same shape — and of the two mistakes,
  -- silently crediting a bystander is the one that misleads.
  --
  -- `updated_by` is never taken from the payload, in EITHER branch. Subtracting
  -- it from the diff and then leaving it alone would hand a member a one-line
  -- PATCH — `{"updated_by": null}` — that erases the mark without changing
  -- anything else, which is the same erasure this file exists to close.
  if (to_jsonb(new) - 'next_run_on' - 'updated_by')
     is distinct from
     (to_jsonb(old) - 'next_run_on' - 'updated_by') then
    new.updated_by := coalesce(
      (select p.id from public.profiles p where p.id = auth.uid()),
      old.updated_by
    );
  else
    new.updated_by := old.updated_by;
  end if;

  return new;
end;
$$;

drop trigger if exists recurring_templates_guard_write_trg on public.recurring_templates;
create trigger recurring_templates_guard_write_trg
  before insert or update on public.recurring_templates
  for each row execute function public.recurring_templates_guard_write();

comment on function public.recurring_templates_guard_write() is
  'Stamps created_by/updated_by from the JWT on a client write and pins id/created_by on UPDATE. recurring_templates_insert/_update are deliberately any-member so a template is not an admin-only object; this is what makes the author of a recipe answerable anyway. Ignores next_run_on when deciding whether anything changed, because both materialisers advance it under a bystander JWT.';


-- ═══ PART 2 ═══ the recipe gets a history
--
-- WHY THIS DOES NOT CALL log_config_audit(), which is what the other three
-- config tables do and what the finding prescribed.
--
-- log_config_audit() opens with `if auth.uid() is not null and not
-- public.is_admin() then raise exception` (0002:345). That guard is correct for
-- tracks, vocab_options and track_slas — all three are admin-only tables. It is
-- fatal here: recurring_templates is member-writable BY DESIGN, so routing this
-- through it would make every ordinary member's template write fail with 42501,
-- which is a worse bug than the one being fixed. Relaxing that guard to
-- is_member() was the other option and is strictly worse: it is granted to
-- `authenticated`, so any member could then forge an audit row about any table.
--
-- So the row is written directly, and the properties log_config_audit() buys are
-- reproduced here rather than borrowed:
--   * SECURITY DEFINER, for the RLS exemption — config_audit has no INSERT
--     policy on purpose, and its owner is exempt from its own RLS (0002:311).
--     `force row level security` must never be added to that table; 0002 says
--     why.
--   * `set search_path = public`, mandatory on a definer function so a caller
--     cannot shadow the table it writes.
--   * actor resolved THROUGH profiles, so a JWT without a profile row cannot
--     turn one audit row into a rolled-back template edit.
--
-- It is not reachable as an RPC: a function returning `trigger` cannot be
-- called from SQL (Postgres answers 0A000, "trigger functions can only be
-- called as triggers") and PostgREST does not expose one. That is the same
-- protection the anon revoke buys log_config_audit(), obtained from the return
-- type instead of from a grant.
create or replace function public.recurring_templates_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
begin
  v_actor := (select p.id from public.profiles p where p.id = auth.uid());

  if tg_op = 'INSERT' then
    insert into public.config_audit (table_name, row_id, action, actor_id, before, after)
    values ('recurring_templates', new.id, 'insert', v_actor, null::jsonb, to_jsonb(new));
    return new;

  elsif tg_op = 'UPDATE' then
    -- The same subtraction the guard makes, for the same reason: a bare
    -- next_run_on advance is the scheduler, running under whoever signed in.
    -- Auditing it would write one misattributed row per due template per
    -- sign-in — an unbounded table filled with the wrong name.
    if (to_jsonb(new) - 'next_run_on' - 'updated_by')
       is distinct from
       (to_jsonb(old) - 'next_run_on' - 'updated_by') then
      insert into public.config_audit (table_name, row_id, action, actor_id, before, after)
      values ('recurring_templates', new.id, 'update', v_actor, to_jsonb(old), to_jsonb(new));
    end if;
    return new;

  else
    insert into public.config_audit (table_name, row_id, action, actor_id, before, after)
    values ('recurring_templates', old.id, 'delete', v_actor, to_jsonb(old), null::jsonb);
    return old;
  end if;
end;
$$;

-- AFTER, not BEFORE: the row image recorded must be the one that survived every
-- other trigger and constraint — including the guard above, which is a BEFORE
-- trigger and rewrites two of these columns.
drop trigger if exists recurring_templates_audit_trg on public.recurring_templates;
create trigger recurring_templates_audit_trg
  after insert or update or delete on public.recurring_templates
  for each row execute function public.recurring_templates_audit();

comment on function public.recurring_templates_audit() is
  'Appends recurring_templates writes to config_audit with whole row images. Writes the row directly instead of calling log_config_audit(), whose is_admin() guard would reject every member write on this deliberately member-writable table. FIX-BACKLOG R1-SEC-2: this is what survives "aim a template at a colleague, Run now, edit it back".';


-- ═══ PART 3 ═══ "Run now" records the member who pressed it
--
-- ONE LINE OF BEHAVIOUR CHANGE: `created_by` joins the INSERT column list, with
-- the value `(select p.id from public.profiles p where p.id = auth.uid())`.
--
-- That expression is NULL exactly when auth.uid() is null — the SQL Editor and
-- the service role — which is precisely the case entries_notify()'s NULL
-- sentinel was designed for (0004:315-321). A member pressing the button now
-- has their name on the entry and on the notification the colleague receives;
-- `materialize_due_recurring()` is untouched and keeps writing NULL, so the
-- deliberate actor-less "the schedule handed you this week's item" line is
-- unchanged.
--
-- Two consequences worth stating because they are behaviour, not bookkeeping:
--   * Running a template you own no longer notifies you. entries_notify()
--     suppresses self-assignment (`new.owner_id is distinct from v_actor`), and
--     being told you did the thing you just did is what mutes an inbox. Before
--     this the NULL author made every Run now look scheduled, so it did notify.
--   * Completing a Run-now entry now notifies its creator. `v_completed`
--     carries `and new.created_by is not null` (0004:293), so that rule simply
--     had nothing to fire on before.
--
-- Body is 0008's verbatim apart from those two lines — `create or replace`
-- rewrites the whole function, so anything not repeated here would be silently
-- dropped, and the 0008 backlog fix (advance exactly ONE occurrence) is carried
-- forward with it.
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
    due_date, template_id, status, created_by
  ) values (
    r.track_id, r.title, r.type, r.priority, r.owner_id, r.owner_name,
    v_due, r.id, 'new',
    -- FIX-BACKLOG R1-SEC-2. This is a BUTTON A MEMBER PRESSES, so the truthful
    -- actor is that member — unlike materialize_due_recurring(), where it is
    -- genuinely nobody. Resolved through profiles for the FK reason above.
    (select p.id from public.profiles p where p.id = auth.uid())
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


-- ═══ PROBE 1 ═══ the recipe names its author, and a client cannot forge it
-- Everything below happens inside a subtransaction thrown away by a sentinel
-- exception — the 0007/0008 pattern. No row survives, and every scratch row is
-- created here rather than borrowed, so the probe works on an empty workspace
-- and can never touch a real one.
do $prove$
declare
  v_me       uuid;
  v_other    uuid;
  v_forged   uuid;
  v_tpl      uuid := gen_random_uuid();
  v_created  uuid;
  v_updated  uuid;
  v_created2 uuid;
  v_updated2 uuid;
  v_erased   uuid;
  v_title    text;
  v_run      date;
  v_after    uuid;
begin
  -- A REAL profile id, because created_by is a FK: with a synthetic uuid a
  -- forged value would abort on 23503 and the probe would "pass" for the wrong
  -- reason. A second member is used as the forgery target when one exists;
  -- falling back to a random uuid still works, because the guard overwrites the
  -- column before the FK is ever checked — which is the thing being proved.
  select p.id into v_me    from public.profiles p order by p.created_at limit 1;
  select p.id into v_other from public.profiles p where p.id is distinct from v_me limit 1;
  v_forged := coalesce(v_other, gen_random_uuid());

  if v_me is null then
    raise notice
      'OpsTrack 0014 probe 1: SKIPPED — no profiles on this project, so there is no member to act as. Re-run after the first member exists.';
    return;
  end if;

  begin
    -- Become a client. auth.uid() reads request.jwt.claims ->> 'sub'; no
    -- auth.users row is involved, and `true` makes the setting local to this
    -- subtransaction so it dies with the rollback below.
    perform set_config('request.jwt.claims', json_build_object('sub', v_me)::text, true);

    -- A forged author, exactly as a raw PostgREST POST could send one.
    insert into public.recurring_templates
      (id, title, cadence, next_run_on, lead_days, active, created_by, updated_by)
    values
      (v_tpl, '0014 probe recipe', 'weekly', current_date, 0, false, v_forged, v_forged);

    select created_by, updated_by into v_created, v_updated
      from public.recurring_templates where id = v_tpl;

    -- A content edit: created_by must hold, updated_by must move, and a forged
    -- created_by in the PATCH must be ignored.
    update public.recurring_templates
       set title      = 'Explain the outage to the CEO',
           created_by = v_forged
     where id = v_tpl;

    select created_by, updated_by, title into v_created2, v_updated2, v_title
      from public.recurring_templates where id = v_tpl;

    -- The one-line erasure. `updated_by` is subtracted from the diff, so a PATCH
    -- carrying only that column changes nothing else — it must still be refused.
    update public.recurring_templates set updated_by = null where id = v_tpl;
    select updated_by into v_erased from public.recurring_templates where id = v_tpl;

    -- Now plant a DIFFERENT editor with no JWT (the SQL-Editor passthrough), so
    -- the next assertion can tell "held" from "coincidentally already v_me".
    perform set_config('request.jwt.claims', '', true);
    update public.recurring_templates set updated_by = null where id = v_tpl;

    -- A schedule-only write — what both materialisers do, under whichever
    -- member's browser happened to call. It must NOT restamp updated_by.
    perform set_config('request.jwt.claims', json_build_object('sub', v_me)::text, true);
    update public.recurring_templates set next_run_on = current_date + 7 where id = v_tpl;
    select updated_by, next_run_on into v_after, v_run
      from public.recurring_templates where id = v_tpl;

    raise exception using errcode = 'OT014', message = 'probe rollback';
  exception
    when sqlstate 'OT014' then
      null; -- subtransaction discarded; the reads above survive
  end;

  if v_created is distinct from v_me then
    raise exception
      'OpsTrack 0014 FAILED: an INSERT stored created_by = % instead of the acting member %. A client can still author a template as somebody else.',
      v_created, v_me;
  end if;

  if v_updated is distinct from v_me then
    raise exception
      'OpsTrack 0014 FAILED: an INSERT stored updated_by = % instead of %.', v_updated, v_me;
  end if;

  if v_created2 is distinct from v_me then
    raise exception
      'OpsTrack 0014 FAILED: an UPDATE rewrote created_by (% -> %). The author of a recipe is not pinned.',
      v_me, v_created2;
  end if;

  if v_updated2 is distinct from v_me then
    raise exception
      'OpsTrack 0014 FAILED: a content edit left updated_by = % instead of %.', v_updated2, v_me;
  end if;

  if v_erased is distinct from v_me then
    raise exception
      'OpsTrack 0014 FAILED: a client PATCH of updated_by alone erased the mark (% -> %). The last editor is still deniable.',
      v_me, v_erased;
  end if;

  -- The other half. A guard that blocked legitimate edits would be a
  -- regression, not a fix: any member may tune a template, by design.
  if v_title is distinct from 'Explain the outage to the CEO' then
    raise exception
      'OpsTrack 0014 FAILED: the guard blocked a legitimate title edit (title = %).', v_title;
  end if;

  if v_run is distinct from current_date + 7 then
    raise exception
      'OpsTrack 0014 FAILED: the guard blocked a schedule advance (next_run_on = %).', v_run;
  end if;

  if v_after is not null then
    raise exception
      'OpsTrack 0014 FAILED: a next_run_on-only write stamped updated_by = %. Every sign-in would credit whoever opened the app.',
      v_after;
  end if;

  raise notice
    'OpsTrack 0014 probe 1: created_by/updated_by stamped from the JWT on INSERT, a forged value ignored, created_by pinned across an UPDATE, updated_by moved by a content edit and NOT by a next_run_on advance, and ordinary edits still allowed. Rolled back.';
end
$prove$;


-- ═══ PROBE 2 ═══ every template write leaves an audit row an admin can read
do $prove$
declare
  v_me      uuid;
  v_tpl     uuid := gen_random_uuid();
  v_ins     bigint;
  v_upd     bigint;
  v_del     bigint;
  v_sched   bigint;
  v_actor   uuid;
  v_before  jsonb;
begin
  select p.id into v_me from public.profiles p order by p.created_at limit 1;
  if v_me is null then
    raise notice 'OpsTrack 0014 probe 2: SKIPPED — no profiles on this project.';
    return;
  end if;

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_me)::text, true);

    insert into public.recurring_templates (id, title, cadence, next_run_on, lead_days, active)
      values (v_tpl, '0014 audit recipe', 'weekly', current_date, 0, false);
    select count(*) into v_ins from public.config_audit
     where table_name = 'recurring_templates' and row_id = v_tpl and action = 'insert';

    update public.recurring_templates set title = 'aimed at a colleague' where id = v_tpl;
    select count(*) into v_upd from public.config_audit
     where table_name = 'recurring_templates' and row_id = v_tpl and action = 'update';

    -- The row that survives "edit it back": the BEFORE image still carries the
    -- title the colleague was pushed.
    -- Columns qualified: `before` is a keyword in plenty of dialects and reads
    -- like one here even though Postgres allows it bare.
    select ca.actor_id, ca.before into v_actor, v_before
      from public.config_audit ca
     where ca.table_name = 'recurring_templates' and ca.row_id = v_tpl and ca.action = 'update'
     order by ca.created_at desc limit 1;

    -- A schedule-only advance must NOT be audited — one misattributed row per
    -- due template per sign-in is an unbounded table filled with wrong names.
    update public.recurring_templates set next_run_on = current_date + 7 where id = v_tpl;
    select count(*) into v_sched from public.config_audit
     where table_name = 'recurring_templates' and row_id = v_tpl and action = 'update';

    delete from public.recurring_templates where id = v_tpl;
    select count(*) into v_del from public.config_audit
     where table_name = 'recurring_templates' and row_id = v_tpl and action = 'delete';

    raise exception using errcode = 'OT014', message = 'probe rollback';
  exception
    when sqlstate 'OT014' then
      null;
  end;

  if v_ins <> 1 or v_upd <> 1 or v_del <> 1 then
    raise exception
      'OpsTrack 0014 FAILED: config_audit holds % insert / % update / % delete rows for one template, expected 1 each. recurring_templates is still the config table with no history.',
      v_ins, v_upd, v_del;
  end if;

  if v_sched <> v_upd then
    raise exception
      'OpsTrack 0014 FAILED: a next_run_on-only advance wrote an audit row (% -> % update rows). The scheduler would fill config_audit with a bystander name.',
      v_upd, v_sched;
  end if;

  if v_actor is distinct from v_me then
    raise exception
      'OpsTrack 0014 FAILED: the audit row names actor % instead of the acting member %.', v_actor, v_me;
  end if;

  if v_before is null or v_before ->> 'title' is distinct from '0014 audit recipe' then
    raise exception
      'OpsTrack 0014 FAILED: the audit row''s BEFORE image does not carry the original title (%). Editing a template back would erase the evidence.',
      v_before ->> 'title';
  end if;

  raise notice
    'OpsTrack 0014 probe 2: insert/update/delete on recurring_templates each wrote exactly one config_audit row naming the acting member, the BEFORE image kept the original title, and a schedule-only advance wrote none. Rolled back.';
end
$prove$;


-- ═══ PROBE 3 ═══ "Run now" names its presser; the scheduler still names nobody
do $prove$
declare
  v_me     uuid;
  v_tpl_a  uuid := gen_random_uuid();
  v_tpl_b  uuid := gen_random_uuid();
  v_entry  uuid;
  v_author uuid;
  v_entry2 uuid;
  v_anon   uuid;
  v_anon_is_null boolean;
begin
  select p.id into v_me from public.profiles p order by p.created_at limit 1;
  if v_me is null then
    raise notice 'OpsTrack 0014 probe 3: SKIPPED — no profiles on this project.';
    return;
  end if;

  begin
    -- `active = false` on both, so the workspace-wide scheduler cannot touch
    -- them and each path is measured deliberately.
    insert into public.recurring_templates (id, title, cadence, next_run_on, lead_days, active)
      values (v_tpl_a, '0014 run-now recipe', 'weekly', current_date, 0, false),
             (v_tpl_b, '0014 sql-editor recipe', 'weekly', current_date, 1, false);

    -- (a) a member presses the button
    perform set_config('request.jwt.claims', json_build_object('sub', v_me)::text, true);
    v_entry := public.materialize_template(v_tpl_a, false);
    select created_by into v_author from public.entries where id = v_entry;

    -- (b) the JWT-less path — the SQL Editor, the service role, and the shape
    -- materialize_due_recurring() runs in. The NULL sentinel must survive.
    perform set_config('request.jwt.claims', '', true);
    v_entry2 := public.materialize_template(v_tpl_b, false);
    select created_by, created_by is null into v_anon, v_anon_is_null
      from public.entries where id = v_entry2;

    raise exception using errcode = 'OT014', message = 'probe rollback';
  exception
    when sqlstate 'OT014' then
      null;
  end;

  if v_entry is null then
    raise exception 'OpsTrack 0014 FAILED: materialize_template() returned no entry for a due template.';
  end if;

  if v_author is distinct from v_me then
    raise exception
      'OpsTrack 0014 FAILED: "Run now" stored created_by = % instead of the member who pressed it (%). entries_notify() would still announce the assignment as coming from nobody.',
      v_author, v_me;
  end if;

  if not coalesce(v_anon_is_null, false) then
    raise exception
      'OpsTrack 0014 FAILED: the JWT-less materialiser stored created_by = % instead of NULL. The deliberate "the schedule did it" notification (0004:315-321) is broken.',
      v_anon;
  end if;

  raise notice
    'OpsTrack 0014 probe 3: "Run now" under a member JWT authored its entry as that member (%); the same call with no JWT left created_by NULL, so materialize_due_recurring()''s actor-less notification is unchanged. Rolled back.',
    v_me;
end
$prove$;
