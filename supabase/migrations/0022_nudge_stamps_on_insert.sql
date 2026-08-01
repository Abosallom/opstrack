-- 0022 — the nudge stamps are the server's on INSERT too, and 0010 stops
--        being able to disarm the AI burst limiter.
--
-- Two small holes left open by the wave that added the features they belong to.
-- Neither is a design change; both are a column list that stopped being complete
-- the moment a later file added a column.
--
--
-- ═══ PART 1 — WHY entries_guard_insert() WAS HALF A GUARD ═══
--
-- 0019 PART 3 pinned `nudged_at` / `nudged_by` on UPDATE and explained itself at
-- 0019:96-104: *`{"nudged_at": "2099-01-01"}` is a one-line request that makes
-- an item unnudgeable forever, and `{"nudged_at": null}` erases the visible
-- evidence.* Both true. Both also reachable by a route 0019 never looked at.
--
-- `entries_guard_insert()` is 0015's function and PREDATES the two columns, so
-- its list — created_at, updated_at, last_activity_at, closed_at, updated_by,
-- template_id — cannot mention them. An INSERT is not an UPDATE, so PART 3's
-- trigger never fires, and `entries_insert`'s WITH CHECK is
-- `is_member() and created_by = auth.uid()`: it says WHO may write a row, never
-- WHAT may be in one.
--
-- Proven on the live project before this file was written, inside a rolled-back
-- subtransaction, as a plain member with `set local role authenticated` and a
-- `request.jwt.claims` sub:
--
--     insert into entries (…, created_at, nudged_at, nudged_by)
--     values (…, '2099-01-01', '2099-01-01', <a colleague's id>)
--     → created_at  pinned to now()      ← the guard DID run
--       nudged_at   2099-01-01 00:00:00+00
--       nudged_by   f0e18875-…           ← a colleague who never asked
--
-- `created_at` coming back pinned is what makes this a gap rather than a
-- misreading: the trigger fired, did its six columns, and had nothing to say
-- about the two it had never heard of.
--
-- WHAT IT COSTS, in the app's own terms. `nudged_at` in the future means
-- `nudge_entry()`'s 24-hour rate limit (0019 PART 5) refuses every ask until
-- 2099 with PT429 — the entry becomes permanently unchaseable, and the button
-- the whole feature is named after answers "someone already asked about this
-- one today" forever. `nudged_by` means the follow-ups row and the entry sheet
-- attribute the ask to a colleague who never made it, and 0019's own PROBE 3
-- calls that out: *"Attributing somebody else's ask is worse than allowing
-- none."* Same sentence, other write path.
--
-- WHY NO nudge-flag EXEMPTION HERE, unlike PART 3's UPDATE guard. `nudge_entry()`
-- only ever UPDATEs a row that already exists — it selects the entry, checks the
-- owner, checks the 24h window and stamps. Nothing in this schema INSERTs an
-- entry that is already nudged, so the INSERT branch can be unconditional, and
-- an unconditional rule is one fewer way to be wrong than a conditional one.
--
-- WHY THE TWO EARLY RETURNS STAY. `auth.uid() is null` is the SQL Editor,
-- pg_cron, the service role and `npm run seed`; a non-client `current_user` is a
-- SECURITY DEFINER materialiser acting for a member. 0015:273-303 argues both at
-- length, including why the role test is an ALLOW-list and not a deny-list, and
-- none of that reasoning changes by adding two columns to the list below.
--
--
-- ═══ PART 2 — WHY 0010 IS EDITED RATHER THAN PATCHED OVER ═══
--
-- 0020:53-64 states a hazard and then leaves it armed: *"⚠ HAZARD, STATED RATHER
-- THAN DISCOVERED LATER. 0010_claim_counters.sql is re-runnable and drops-then-
-- adds that same constraint with its own two-value list. Running 0010 again
-- AFTER this file silently reverts the widening, and every
-- claim_bump('ai_user', …) then fails with 23514. … The fix is a one-line edit
-- to 0010's constraint list; it is named in the W-AI handoff note because 0010
-- is not this file's to edit."*
--
-- The handoff note did not exist. This file is the other half of writing it:
-- `0010_claim_counters.sql` now carries all four scopes in its own `add
-- constraint`, so re-running any migration in any order leaves the constraint
-- correct. Editing an applied migration is normally taboo; it is right here for
-- three reasons that all have to hold, and do:
--
--   1. this project has NO migration ledger — `supabase_migrations` does not
--      exist on the live database, files are applied by hand from the SQL Editor
--      or the management API — so there is no checksum to invalidate;
--   2. 0010 is re-runnable BY DESIGN and the edit only changes what a RE-RUN
--      does. The live constraint already allows all four values (0020 widened
--      it), so applying the edited 0010 today is a no-op;
--   3. the failure it prevents is SILENT. `bump()` at capture-assist/index.ts
--      :1017-1027 logs its error and returns, so a reverted constraint costs the
--      per-minute abuse ceiling with no signal anywhere a person looks.
--
-- PART 3 below asserts the constraint rather than trusting it, so if anyone ever
-- narrows it again this migration is where they find out.
--
--
-- Re-runnable from the top in any partial state, same discipline as 0001-0021:
-- `create or replace` on the function, `drop trigger if exists` before the
-- create, and probe blocks that roll themselves back. Depends on 0015 (the
-- function this file restates), 0019 (the two columns) and 0020 (the widened
-- scope list PART 3 checks).


-- ═══ PART 1 ═══ entries_guard_insert(): two more columns the client may not choose

-- Restated IN FULL because `create or replace` rewrites the whole body. Dropping
-- any of 0015's six pins here would silently re-open what 0015 exists to close:
-- a member POSTing a future `created_at` (never breaches its SLA), a future
-- `last_activity_at` (never goes stale), or squatting
-- `entries_template_due_uidx` on a future occurrence so a recurring item
-- silently skips.
create or replace function public.entries_guard_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- The JWT-less passthrough the whole schema uses: the SQL Editor, pg_cron,
  -- the service role and `npm run seed` — which writes `created_at` and
  -- `last_activity_at` explicitly and by design (scripts/seed.mjs:21-25) —
  -- all act without a `sub` claim and are the only writers meant to choose
  -- these values.
  if auth.uid() is null then
    return new;
  end if;

  -- A JWT plus a non-client role is a definer function acting for a member:
  -- materialize_due_recurring(), materialize_template(). Those are the only
  -- legitimate writers of `template_id`, and they set the clocks from now()
  -- anyway.
  if current_user not in ('authenticated', 'anon', 'authenticator') then
    return new;
  end if;

  -- Everything below is server-side truth about the write, not a field the
  -- capture screen offers. `id`, `meeting_id`, `due_date`, `owner_*`, `tags`,
  -- `links`, `status`, `type`, `priority`, `title`, `description`, `requester`
  -- and `follow_up_date` are untouched — that is the whole of capture.
  new.created_at       := now();
  new.updated_at       := now();
  new.last_activity_at := now();
  new.closed_at        := null;
  new.updated_by       := null;
  new.template_id      := null;

  -- 0022 — THE NUDGE STAMPS, on the write path 0019 did not cover. A brand new
  -- entry has by definition never been chased, so there is exactly one correct
  -- value for both and it is NULL. Nulled rather than refused, for 0019 PART 3's
  -- reason: nothing in the app sends these columns (src/api/entries.ts's
  -- toEntryRow names neither), so the only caller that can reach this line is
  -- one that meant to, and an error would tell it which columns exist.
  new.nudged_at        := null;
  new.nudged_by        := null;

  return new;
end;
$$;

-- NAME ORDER IS LOAD-BEARING, again: `entries_guard_insert` sorts before
-- `entries_insert_trg`, so this clears `closed_at` first and
-- entries_set_closed_at() then stamps it for a row captured directly as done or
-- cancelled. Reverse the order and every entry captured closed would land with
-- a null close date and vanish from the recently-closed list.
drop trigger if exists entries_guard_insert on public.entries;
create trigger entries_guard_insert
  before insert on public.entries
  for each row execute function public.entries_guard_insert();

comment on function public.entries_guard_insert() is
  'Server-stamps created_at/updated_at/last_activity_at and clears closed_at/updated_by/template_id and (0022) nudged_at/nudged_by on an INSERT arriving from a PostgREST client role. entries_insert is row-level only — it says who may write a row, never what may be in one — so before 0015 a member could POST a future created_at (never breaches its SLA), a future last_activity_at (never goes stale), or squat entries_template_due_uidx on a future occurrence and make a recurring item silently skip; and before 0022 they could POST nudged_at = 2099-01-01, which makes nudge_entry()''s 24h rate limit refuse every future ask and leaves the item permanently unchaseable, with nudged_by naming a colleague who never asked. SECURITY INVOKER on purpose: current_user is the test that tells a client apart from a member-invoked materialiser.';


-- ═══ PART 2 ═══ the AI scope list, asserted rather than assumed

-- 0020 widened this and 0010 can narrow it back. 0010 is now fixed at source;
-- this statement is the belt to that pair of braces, and it is idempotent.
alter table public.claim_counters drop constraint if exists claim_counters_scope_ck;
alter table public.claim_counters
  add constraint claim_counters_scope_ck
  check (scope in ('username', 'ip', 'ai_user', 'ai_ip'));


-- ═══ PROBE 1 ═══ a member cannot pre-stamp a nudge on the way in
--
-- The exact write the header reproduces, run through the REAL client path:
-- PostgREST's role, a member's JWT claims, `entries_insert`'s WITH CHECK, and
-- this file's trigger. Rolled back in a subtransaction, so the table is
-- untouched whether it passes or fails.
--
-- If the role is not grantable to whoever is running this file, the probe SKIPS
-- rather than failing: the guard is installed either way, and a false failure
-- would send an operator hunting a bug that is not there. 0015 probe 3, 0017
-- probe 3 and 0019 probe 3 make the same allowance. The skip test is SCOPED TO
-- THE ROLE SWITCH ALONE — an earlier draft of 0017 learned that wrapping the
-- whole client half in `exception when insufficient_privilege` swallows a real
-- RLS refusal and reports a broken policy as "skipped".
do $prove$
declare
  v_member  uuid := gen_random_uuid();
  v_other   uuid := gen_random_uuid();
  v_entry   uuid := gen_random_uuid();
  v_nudged  timestamptz;
  v_by      uuid;
  v_created timestamptz;
  v_skipped boolean := false;
begin
  begin
    -- handle_new_user() writes the matching `profiles` row, exactly as 0019's
    -- probes rely on. Two members, because the interesting forgery names
    -- SOMEBODY ELSE as the asker.
    insert into auth.users (id, email, raw_user_meta_data) values
      (v_member, 'probe-1-member-' || v_member || '@0022.invalid',
       jsonb_build_object('display_name', '0022 Probe Member')),
      (v_other,  'probe-1-other-'  || v_other  || '@0022.invalid',
       jsonb_build_object('display_name', '0022 Probe Colleague'));

    perform set_config('request.jwt.claims',
                       json_build_object('sub', v_member, 'role', 'authenticated')::text, true);

    begin
      set local role authenticated;
    exception when insufficient_privilege then
      v_skipped := true;
    end;

    if not v_skipped then
      -- THE REQUEST: a capture POST that also names the two columns nothing in
      -- the app names. Forward-dating nudged_at makes the item unnudgeable
      -- until 2099; nudged_by pins the ask on somebody who never made it.
      -- created_at is sent forward-dated too, as the CONTROL: it is 0015's own
      -- pin, so if it comes back rewritten the trigger definitely ran and a
      -- surviving nudge stamp cannot be blamed on the probe.
      insert into public.entries (id, title, created_by, created_at, nudged_at, nudged_by)
      values (v_entry, 'OpsTrack 0022 probe 1', v_member,
              timestamptz '2099-01-01 00:00:00+00',
              timestamptz '2099-01-01 00:00:00+00',
              v_other);

      reset role;

      select e.created_at, e.nudged_at, e.nudged_by
        into v_created, v_nudged, v_by
        from public.entries e where e.id = v_entry;
    end if;

    raise exception 'OPSTRACK_0022_ROLLBACK';
  exception when others then
    begin reset role; exception when others then null; end;
    if sqlerrm <> 'OPSTRACK_0022_ROLLBACK' then raise; end if;
  end;

  if v_skipped then
    raise notice
      'OpsTrack 0022 probe 1 SKIPPED: this role cannot `set role authenticated`, so the client half could not run. The pin IS installed. Verify by hand: POST /rest/v1/entries as a member with {"nudged_at":"2099-01-01"} and re-read the row — nudged_at must come back null.';
    return;
  end if;

  if v_created is null or v_created > timestamptz '2090-01-01' then
    raise exception
      'OpsTrack 0022 FAILED: created_at came back % — the guard did not run at all, so nothing below this line means anything. Check that the entries_guard_insert trigger exists and that this role is `authenticated`.',
      coalesce(v_created::text, 'NULL');
  end if;

  if v_nudged is not null then
    raise exception
      'OpsTrack 0022 FAILED: a member''s INSERT stored entries.nudged_at = %. One capture POST now makes an item unnudgeable until 2099 — nudge_entry()''s 24h window (0019 PART 5) refuses every ask with PT429, the button the feature is named after answers "someone already asked about this one today" forever, and the chase the whole feature exists to make visible is silently impossible on that row.',
      v_nudged;
  end if;

  if v_by is not null then
    raise exception
      'OpsTrack 0022 FAILED: a member''s INSERT stored entries.nudged_by = %, a colleague who never asked. 0019 probe 3 says it in one line: attributing somebody else''s ask is worse than allowing none.',
      v_by;
  end if;

  raise notice
    'OpsTrack 0022 probe 1: a member POSTed an entry naming created_at, nudged_at and nudged_by — created_at was pinned to now() (so the guard ran), and both nudge stamps came back NULL. Rolled back.';
end
$prove$;


-- ═══ PROBE 2 ═══ nudge_entry() can still write what the client cannot
--
-- The mirror of probe 1, and the reason it has to exist: a pin that also blocked
-- the RPC would leave the columns permanently null and quietly delete the
-- feature. This asserts the guard is narrow — it refuses the CLIENT, not the
-- write.
do $prove$
declare
  v_owner  uuid := gen_random_uuid();
  v_asker  uuid := gen_random_uuid();
  v_entry  uuid := gen_random_uuid();
  v_stamp  timestamptz;
  v_by     uuid;
begin
  begin
    insert into auth.users (id, email, raw_user_meta_data) values
      (v_owner, 'probe-2-owner-' || v_owner || '@0022.invalid',
       jsonb_build_object('display_name', '0022 Probe Owner')),
      (v_asker, 'probe-2-asker-' || v_asker || '@0022.invalid',
       jsonb_build_object('display_name', '0022 Probe Asker'));

    -- Inserted with no JWT, so the guard's first early return applies and the
    -- fixture is set up exactly as intended rather than by the code under test.
    insert into public.entries (id, title, owner_id)
    values (v_entry, 'OpsTrack 0022 probe 2', v_owner);

    perform set_config('request.jwt.claims',
                       json_build_object('sub', v_asker, 'role', 'authenticated')::text, true);

    perform public.nudge_entry(v_entry);

    select e.nudged_at, e.nudged_by into v_stamp, v_by
      from public.entries e where e.id = v_entry;

    raise exception 'OPSTRACK_0022_ROLLBACK';
  exception when others then
    if sqlerrm <> 'OPSTRACK_0022_ROLLBACK' then raise; end if;
  end;

  if v_stamp is null or v_by is distinct from v_asker then
    raise exception
      'OpsTrack 0022 FAILED: after nudge_entry() the row holds nudged_at = %, nudged_by = % (expected a timestamp and %). PART 1 has been written too widely and is nulling the RPC''s own write, which deletes the nudge feature rather than protecting it.',
      coalesce(v_stamp::text, 'NULL'), coalesce(v_by::text, 'NULL'), v_asker;
  end if;

  raise notice
    'OpsTrack 0022 probe 2: nudge_entry() still stamped nudged_at/nudged_by for the asker, so PART 1 refuses the client and not the write. Rolled back.';
end
$prove$;


-- ═══ PROBE 3 ═══ the four counter scopes, read from the catalog
--
-- Not "0020 widened it" — the constraint as Postgres holds it right now. This is
-- what turns 0020's stated hazard into something that cannot be re-armed
-- silently: if 0010 is ever narrowed again, this raises here instead of the AI
-- burst limiter disappearing into a console.error nobody reads.
do $prove$
declare
  v_def  text;
  v_scope text;
begin
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conname = 'claim_counters_scope_ck'
     and c.conrelid = 'public.claim_counters'::regclass;

  if v_def is null then
    raise exception
      'OpsTrack 0022 FAILED: claim_counters_scope_ck does not exist. PART 2 did not run, or 0010 has been altered.';
  end if;

  foreach v_scope in array array['username', 'ip', 'ai_user', 'ai_ip'] loop
    if position(quote_literal(v_scope) in v_def) = 0 then
      raise exception
        'OpsTrack 0022 FAILED: claim_counters_scope_ck is % and does not allow %. Every claim_bump(''%'', …) from capture-assist now fails with 23514 — and bump() logs and returns (index.ts:1026), so the per-minute abuse ceiling is gone with no signal anywhere. Re-apply PART 2, and check that 0010''s own add constraint still lists all four scopes.',
        v_def, v_scope, v_scope;
    end if;
  end loop;

  -- The write itself, not just the constraint text: a scope the CHECK allows but
  -- the function cannot bump is the same outage with a different cause.
  begin
    perform public.claim_bump('ai_user', 'opstrack-0022-probe', 60);
    perform public.claim_bump('ai_ip', '0.0.0.0/24', 60);
    delete from public.claim_counters
     where (scope, bucket) in (('ai_user', 'opstrack-0022-probe'), ('ai_ip', '0.0.0.0/24'));
  exception when others then
    raise exception
      'OpsTrack 0022 FAILED: claim_bump on an AI scope raised % / %. The constraint reads correctly, so this is the function or its grants.',
      sqlstate, sqlerrm;
  end;

  raise notice
    'OpsTrack 0022 probe 3: claim_counters_scope_ck allows all four scopes (%), and claim_bump succeeded on both AI scopes.',
    v_def;
end
$prove$;
