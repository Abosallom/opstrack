-- 0012 — a member leaves, their name stays on the work.
--
-- Deploy: Supabase Dashboard -> SQL Editor -> paste + Run. Re-runnable from the
-- top in any state, same discipline as 0001-0011: `create or replace function`,
-- `drop trigger if exists` before `create trigger`, and self-verifying probe
-- blocks at the bottom that roll themselves back and fail the whole migration if
-- the behaviour this file claims is not the behaviour the database has.
--
-- NO EXPLICIT `begin;`/`commit;`, on purpose and like 0006 and 0008-0011. The
-- SQL Editor runs a pasted file as one implicit transaction, which is what lets
-- a probe fail the WHOLE migration — the promise RUNBOOK 5.2 makes about
-- probe-bearing files: "a probe failure means the migration did not take."
--
-- NOTHING IS BACKFILLED, because there is nothing to backfill from. A member
-- deleted before this file ran took their display name out of the database with
-- them (`profiles` cascades away with `auth.users`), and no row anywhere else
-- kept a copy. This file changes what happens on the way OUT from here on.
--
--
-- ═══ WHY ═══ FIX-BACKLOG R3: a written promise the code did not keep
--
-- The Members screen's delete confirmation said, in both languages, and in the
-- release this file follows:
--
--     "⁨{name}⁩ loses access immediately. Their entries … stay, credited to
--      their name."
--
-- What actually happened is that `entries.owner_id` is `references
-- public.profiles (id) on delete set null`, so the delete nulled the only
-- pointer to the person and NOTHING wrote their name anywhere. The entry stayed
-- — that half was true — and rendered "Unassigned". `entries.owner_name` exists
-- exactly to hold a name with no account behind it (that is how vendors and
-- other departments are owners today); the deletion path simply never used it.
--
-- The precedent for the shape of the fix is already in this schema:
-- `notifications.actor_name` (0004) is a DENORMALIZED SNAPSHOT of
-- `profiles.display_name` taken at write time, so an inbox line survives the
-- actor's account, and 0011's push payload reads
-- `coalesce(live display_name, snapshot actor_name)`. This file does the same
-- thing one step later — at delete time, which for an owner is the only moment
-- the name is still there to copy.
--
--
-- ═══ THE SEMANTICS, EXACTLY ═══ what a row looks like afterwards
--
-- For every `entries` row and every `recurring_templates` row owned by the
-- member being deleted, in the same transaction as the delete and before it:
--
--   owner_id    uuid -> NULL          (the account is gone; nothing may point
--                                      at a profile that no longer exists)
--   owner_name  NULL -> display_name  (a snapshot, trimmed, taken from the
--                                      profiles row as it stands at deletion)
--
-- BOTH COLUMNS MOVE IN ONE STATEMENT and they have to: `entries_single_owner`
-- (0001) is `check (owner_id is null or owner_name is null)`, so an entry may
-- never carry an id and a name at once. Writing the name first would violate the
-- constraint; writing it after the FK's `set null` had already fired would be
-- too late, because by then no row remembers whose it was.
--
-- THE NAME IS A SNAPSHOT AND NEVER UPDATES AGAIN. There is nothing left to
-- update it from. If the same human is provisioned again later they are a new
-- account with new rows; their old work stays under the old spelling of their
-- name, which is what a record of what happened should do.
--
-- A BLANK display_name WRITES NOTHING. `nullif(btrim(...), '')` — an empty name
-- credits nobody, and `owner_name = ''` would render "Unassigned" anyway (see
-- the resolver below) while making a free-text owner that is not one. The row
-- keeps the shape it already had: both columns null, honestly unassigned.
--
-- THE ENTRY ITSELF IS NEVER TOUCHED. Nothing here deletes work. `entries` has no
-- cascade from `profiles` in either direction; the row, its update thread, its
-- tags and its history are exactly as they were.
--
--
-- ═══ AND THE UI RENDERS THAT IDENTICALLY ═══ read, not assumed
--
-- The claim above is only worth making if a name-owned row is indistinguishable
-- from an id-owned one everywhere a reader meets an owner. Checked by reading
-- each of them, not by assuming the pair is symmetric:
--
--   store/members.ts:124      memberLabel(byId, ownerId, ownerName) —
--                             `ownerId -> displayName` then `ownerName` then
--                             `t('entry.unassigned')`. THE one resolver.
--   components/entry/atoms.tsx:357  OwnerBadge — same call, same initials disc,
--                             `data-assigned="true"` for a name.
--   lib/entrySections.ts:124  "unassigned" needs owner_id null AND a blank
--                             owner_name, so a carried name keeps the row out of
--                             the Unassigned section on Follow-ups.
--   lib/entryFilter.ts:150    hasOwner() counts free text; :170 the `name` facet
--                             matches on the folded name.
--   lib/aggregate.ts:312      loadPerOwner() keys a named owner as `name:<n>`,
--                             so the departed member keeps their own load row
--                             rather than merging into the unowned bucket.
--   pages/Board.tsx:366       bucketOf() gives a named owner its own column…
--   pages/Board.tsx:380       …and patchFor() returns null for it, so that
--                             column is not a drop target. Correct by accident
--                             and worth keeping deliberately: you cannot hand
--                             new work to somebody who no longer has an account.
--   lib/minutes.ts:492        personName(owner_id, owner_name) in the minutes.
--   lib/export.ts:633         the CSV owner column resolves the same way, and
--                             :635 exports the raw owner_name beside it.
--
-- (Paths under src/. Line numbers are as of this file's writing; the symbol
-- names are the durable half.)
--
-- src/store/departedOwner.test.ts pins all of that against a "post-0012" entry,
-- so a later change to the resolver cannot quietly turn this migration back into
-- the bug it fixes. (It sits under store/ and not beside the lib/ readers it
-- calls because it needs the real `memberLabel`, and src/lib/ is the layer that
-- may not import a store — the standing layering grep enforces that.)
--
--
-- ═══ WHAT IS *NOT* CARRIED, AND WHY THE CONFIRM COPY CHANGED ═══
--
-- Every other reference to a member is an id column with NO name column beside
-- it, so there is nowhere to put the name:
--
--   entries.created_by, entries.updated_by, entry_updates.author_id,
--   meetings.created_by, meeting_lines.created_by, tracks.created_by,
--   vocab_options.updated_by, config_audit.actor_id
--
-- All of them are `on delete set null`, so THE ROWS ALL SURVIVE — the update
-- thread, the meeting and its notes, the minutes, the audit line. What does not
-- survive is the name on them: `UpdateThread.tsx:165` renders
-- `t('entry.authorUnknown')` for a null author, and `minutes.ts:452` drops the
-- "Recorded by" line entirely when `personName(created_by)` comes back null.
--
-- Making those keep a name means a new column on each table AND a change in
-- every reader that renders one — a wider change than this fix, in files this
-- change does not own. So the confirm dialog stops promising it: it now says the
-- entries stay credited and that the updates and meeting notes stay WITHOUT the
-- name. Two true sentences instead of one that was two-thirds true.
--
-- Nothing is written for them here on the way out either, and that is a real
-- cost worth stating plainly: `display_name` is gone the instant the profile row
-- is, so a wave that later wires an `author_name` cannot recover the names of
-- anybody deleted before it lands. Adding the columns now and rendering them
-- never would be dead schema — the honest trade, taken deliberately. When that
-- wave comes, the copy belongs in THIS trigger: one function, one moment, one
-- transaction.
--
--
-- ═══ WHY A TRIGGER, AND NOT THE EDGE FUNCTION ═══
--
-- `admin-members` deletes an account with the GoTrue admin API
-- (`auth.admin.deleteUser`), which deletes the `auth.users` row; `profiles`
-- cascades from it, and `entries.owner_id` is nulled by ITS foreign key in the
-- same statement chain. Doing the copy in TypeScript before that call would
-- work for that one caller and quietly fail for every other way an account
-- dies:
--
--   · Supabase Dashboard -> Authentication -> Users -> Delete user, which is
--     where an admin ends up whenever the app or the function is the thing that
--     is broken,
--   · a SQL Editor `delete from auth.users` — the dashboard is already this
--     project's documented escape hatch, and RUNBOOK 3 sends an admin there to
--     recover a lost role precisely because nothing inside the app can,
--   · `delete from profiles` straight over PostgREST, which 0001's
--     `profiles_delete` policy allows any admin to do with the anon key and no
--     edge function anywhere near it,
--   · any future caller — a bulk offboard, a support script.
--
-- A BEFORE DELETE trigger on `public.profiles` is the one place all of those
-- pass through, it runs inside the deleting transaction (so the copy cannot
-- half-happen — if the delete rolls back, so does the credit), and it runs
-- BEFORE the row is gone, which is the only window in which `entries.owner_id`
-- still says whose the work was. The FK's own `set null` then finds nothing left
-- to null and is a no-op, which is also how the clocks below stay put.
--
-- The referential action fires the trigger too: `on delete cascade` from
-- `auth.users` to `profiles` performs a real DELETE on `profiles`, and a real
-- DELETE fires that table's row triggers. PROBE 1 deletes the `auth.users` row
-- rather than the profile, so it proves that chain rather than assuming it.
--
-- SECURITY DEFINER because the role that executes the cascade is GoTrue's
-- `supabase_auth_admin`, which has no business holding write privileges on
-- `public.entries` and does not. Owned by `postgres` (BYPASSRLS), so the copy is
-- not filtered by the entries policies of a caller who is not acting as anybody.
-- `set search_path = public` is mandatory on a definer function so a caller
-- cannot shadow `entries` with a temp table of their own — the same rule 0001's
-- `is_member()` header states.
--
-- NO `revoke execute`, deliberately, and unlike 0010's helpers: a trigger
-- function cannot be called as an ordinary function (Postgres refuses with
-- "trigger functions can only be called as triggers"), so PUBLIC holding EXECUTE
-- on it grants nobody anything. Revoking it would instead risk the cascade
-- failing under a role that is not `postgres`.
--
--
-- ═══ THE CLOCKS ═══ a handover is bookkeeping, not activity
--
-- `entries_touch()` (0001, corrected in 0007) stamps `updated_at` and
-- `last_activity_at` on any real column change, and an owner change is a real
-- column change — so the FK's `set null` ALREADY reset the staleness clock on
-- every entry a departing member owned. That is the 0007 failure class exactly:
-- "a reassignment is bookkeeping, so it moves the bookkeeping clock but must
-- leave the staleness clock where it is."
--
-- Here it is not even a reassignment. The same human still owns the row; only
-- the way the row spells them has changed. So this function remembers both
-- stamps and puts them back, and a stale item stays stale through the handover
-- instead of a member's departure making forty quiet entries look attended to.
--
-- The restore is a second UPDATE and it has to be: `entries_touch()` is a BEFORE
-- trigger that overwrites whatever the first statement passes it. The second
-- statement touches ONLY `updated_at` and `last_activity_at`, which both of that
-- function's diffs subtract, so it reads as "no real change" and the values
-- written survive. PROBE 1 asserts both stamps to the microsecond.


-- ── the function ────────────────────────────────────────────────────────────

create or replace function public.profiles_preserve_owner_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- The name as it stood at the moment of deletion.
  v_name   text;
  -- entry id -> [updated_at, last_activity_at], read before the handover.
  v_clocks jsonb;
begin
  v_name := nullif(btrim(old.display_name), '');
  if v_name is null then
    -- Nobody to credit. Leave every row exactly as it is and let the FK do its
    -- ordinary `set null`; an unnamed owner becoming "Unassigned" is honest.
    return old;
  end if;

  -- 1. The two clocks, for exactly the rows about to change.
  select jsonb_object_agg(e.id::text, jsonb_build_array(e.updated_at, e.last_activity_at))
    into v_clocks
    from public.entries e
   where e.owner_id = old.id;

  -- 2. The handover. ONE statement, because `entries_single_owner` will not
  --    hold an id and a name at the same time and is checked per row.
  update public.entries
     set owner_id   = null,
         owner_name = v_name
   where owner_id = old.id;

  -- 3. The clocks, put back. Only these two columns move, and entries_touch()
  --    subtracts both from its diffs, so it leaves them alone.
  if v_clocks is not null then
    update public.entries e
       set updated_at       = (c.value ->> 0)::timestamptz,
           last_activity_at = (c.value ->> 1)::timestamptz
      from jsonb_each(v_clocks) c
     where e.id = c.key::uuid;
  end if;

  -- Templates carry the same either/or owner pair and the same constraint, and
  -- the same one-statement rule therefore applies. A template owned by a name
  -- keeps materializing entries owned by that name (0008's materializer copies
  -- both columns straight across), which is right: the schedule is the
  -- workspace's, and an admin who wants it to stop can deactivate it on the
  -- Recurring screen. There are no clocks on this table to preserve.
  update public.recurring_templates
     set owner_id   = null,
         owner_name = v_name
   where owner_id = old.id;

  return old;
end;
$$;

comment on function public.profiles_preserve_owner_name() is
  'BEFORE DELETE on profiles. Copies display_name into entries.owner_name and recurring_templates.owner_name for every row the member owns, nulling owner_id in the same statement, so work stays credited to the person after their account is gone. Preserves updated_at/last_activity_at: a handover is bookkeeping, not activity. FIX-BACKLOG R3.';

drop trigger if exists profiles_preserve_owner_name on public.profiles;
create trigger profiles_preserve_owner_name
  before delete on public.profiles
  for each row execute function public.profiles_preserve_owner_name();

comment on trigger profiles_preserve_owner_name on public.profiles is
  'Runs ahead of the owner_id foreign keys'' own ON DELETE SET NULL, which is the only window in which the database still knows whose work it was.';


-- ═══ PROBE 1 ═══ the credit survives a real account deletion
-- Everything below happens inside a subtransaction that is thrown away by a
-- sentinel exception — the 0007/0008 pattern. No row survives this block, and
-- every fixture is created here rather than borrowed from real data, so the
-- probe runs on an empty workspace and can never touch a live member.
--
-- It deletes the `auth.users` row, NOT the profile, because the claim being
-- proved is about the whole chain: GoTrue's delete -> the cascade to profiles ->
-- this trigger -> the FK finding nothing left to null.
do $prove$
declare
  v_leaver   uuid := gen_random_uuid();
  v_stayer   uuid := gen_random_uuid();
  v_entry    uuid;
  v_other    uuid;
  v_tpl      uuid;
  v_name     text := '0012 Probe Leaver';
  -- read back after the delete
  v_owner_id     uuid;
  v_owner_name   text;
  v_updated      timestamptz;
  v_activity     timestamptz;
  v_rows         int;
  v_other_owner  uuid;
  v_tpl_name     text;
  -- read before the delete
  v_updated_0    timestamptz;
  v_activity_0   timestamptz;
begin
  begin
    -- Two accounts, so the probe also proves the WHERE clause is narrow: a
    -- statement missing `where owner_id = old.id` would strip the whole
    -- workspace, and a probe with one member could not see that.
    insert into auth.users (id, email, raw_user_meta_data) values
      (v_leaver, 'probe-leaver-'  || v_leaver || '@0012.invalid',
       jsonb_build_object('display_name', v_name)),
      (v_stayer, 'probe-stayer-'  || v_stayer || '@0012.invalid',
       jsonb_build_object('display_name', '0012 Probe Stayer'));
    -- handle_new_user() made both profiles; assert that rather than assume it,
    -- because everything below is meaningless if the fixtures are not real.
    if (select count(*) from public.profiles where id in (v_leaver, v_stayer)) <> 2 then
      raise exception 'OpsTrack 0012 PROBE SETUP FAILED: handle_new_user() did not create the fixture profiles.';
    end if;

    insert into public.entries (title, owner_id, description)
      values ('0012 probe entry', v_leaver, 'owned by the account about to be deleted')
      returning id into v_entry;
    insert into public.entries (title, owner_id)
      values ('0012 probe bystander', v_stayer)
      returning id into v_other;
    insert into public.recurring_templates (title, owner_id)
      values ('0012 probe template', v_leaver)
      returning id into v_tpl;

    -- Backdate the clocks so "unchanged" is a real assertion. now() is frozen
    -- for the whole transaction, so leaving them at their defaults would make
    -- an untouched stamp and a re-stamped one indistinguishable.
    update public.entries
       set updated_at = now() - interval '9 days', last_activity_at = now() - interval '9 days'
     where id = v_entry;
    select updated_at, last_activity_at into v_updated_0, v_activity_0
      from public.entries where id = v_entry;

    -- The deletion path itself.
    delete from auth.users where id = v_leaver;

    select count(*) into v_rows from public.entries where id = v_entry;
    select owner_id, owner_name, updated_at, last_activity_at
      into v_owner_id, v_owner_name, v_updated, v_activity
      from public.entries where id = v_entry;
    select owner_id into v_other_owner from public.entries where id = v_other;
    select owner_name into v_tpl_name from public.recurring_templates where id = v_tpl;

    raise exception using errcode = 'OT012', message = 'probe rollback';
  exception
    when sqlstate 'OT012' then
      null; -- subtransaction discarded; the reads above survive
  end;

  if v_rows <> 1 then
    raise exception
      'OpsTrack 0012 FAILED: the entry did not survive the deletion (% rows). Work is being destroyed with the account.',
      v_rows;
  end if;

  if v_owner_name is distinct from v_name then
    raise exception
      'OpsTrack 0012 FAILED: owner_name is % after the delete, expected %. This is R3 exactly: the confirm dialog promises credit the database does not keep.',
      coalesce(quote_literal(v_owner_name), 'NULL'), quote_literal(v_name);
  end if;

  if v_owner_id is not null then
    raise exception
      'OpsTrack 0012 FAILED: owner_id survived as % — it points at a profile that no longer exists.',
      v_owner_id;
  end if;

  if v_updated is distinct from v_updated_0 or v_activity is distinct from v_activity_0 then
    raise exception
      'OpsTrack 0012 FAILED: the handover moved a clock (updated_at % -> %, last_activity_at % -> %). A departure must not make stale work look attended to.',
      v_updated_0, v_updated, v_activity_0, v_activity;
  end if;

  if v_other_owner is distinct from v_stayer then
    raise exception
      'OpsTrack 0012 FAILED: deleting one member changed another member''s entry (owner_id is now %). The WHERE clause is not narrow.',
      coalesce(v_other_owner::text, 'NULL');
  end if;

  if v_tpl_name is distinct from v_name then
    raise exception
      'OpsTrack 0012 FAILED: recurring_templates.owner_name is % after the delete, expected %.',
      coalesce(quote_literal(v_tpl_name), 'NULL'), quote_literal(v_name);
  end if;

  raise notice
    'OpsTrack 0012 probe 1: a deleted member''s entry kept the name %, kept its clocks, and the bystander''s entry was untouched. Rolled back.',
    quote_literal(v_name);
end
$prove$;


-- ═══ PROBE 2 ═══ a blank display_name is left unassigned, not credited to ''
-- The other half of the contract. `owner_name = ''` would satisfy the check
-- constraint, render "Unassigned" anyway through memberLabel()'s trim, and lie
-- to every SQL reader that tests `owner_name is not null`.
do $prove$
declare
  v_id     uuid := gen_random_uuid();
  v_entry  uuid;
  v_owner  uuid;
  v_name   text;
  v_found  boolean;
begin
  begin
    -- No display_name in the metadata bag and an email whose local part is
    -- whitespace, so handle_new_user()'s own fallback also lands blank.
    insert into auth.users (id, email, raw_user_meta_data)
      values (v_id, '   @0012.invalid', '{}'::jsonb);
    update public.profiles set display_name = '   ' where id = v_id;

    insert into public.entries (title, owner_id)
      values ('0012 probe nameless', v_id)
      returning id into v_entry;

    delete from auth.users where id = v_id;

    select true, owner_id, owner_name into v_found, v_owner, v_name
      from public.entries where id = v_entry;

    raise exception using errcode = 'OT012', message = 'probe rollback';
  exception
    when sqlstate 'OT012' then
      null;
  end;

  if v_found is not true then
    raise exception 'OpsTrack 0012 FAILED: the entry of a nameless member did not survive the deletion.';
  end if;

  if v_owner is not null or v_name is not null then
    raise exception
      'OpsTrack 0012 FAILED: a blank display_name produced owner_id=%, owner_name=%. Expected both null — an empty name credits nobody.',
      coalesce(v_owner::text, 'NULL'), coalesce(quote_literal(v_name), 'NULL');
  end if;

  raise notice
    'OpsTrack 0012 probe 2: a member with a blank display_name left their entry honestly unassigned. Rolled back.';
end
$prove$;


-- ═══ PROBE 3 ═══ the other live door: an admin deleting the profiles row itself
-- PROBE 1 came in through GoTrue with no session at all. This one comes in the
-- way an admin's own browser could — `delete from profiles` over PostgREST, as
-- `authenticated`, under 0001's `profiles_delete` policy — and it exercises a
-- DIFFERENT trigger ordering: with a JWT present, `entries_guard_update()` is
-- awake and writes `updated_by` into the same row this function is handing over.
-- That is precisely the case in which a one-statement clock restore would fail,
-- so it is the case worth a probe of its own.
do $prove$
declare
  v_admin  uuid := gen_random_uuid();
  v_leaver uuid := gen_random_uuid();
  v_entry  uuid;
  v_name   text := '0012 Probe Rest-Path';
  v_owner  uuid;
  v_got    text;
  v_u      timestamptz;
  v_a      timestamptz;
  v_u0     timestamptz;
  v_a0     timestamptz;
begin
  begin
    insert into auth.users (id, email, raw_user_meta_data) values
      (v_admin,  'probe-admin-'  || v_admin  || '@0012.invalid',
       jsonb_build_object('display_name', '0012 Probe Admin')),
      (v_leaver, 'probe-rest-'   || v_leaver || '@0012.invalid',
       jsonb_build_object('display_name', v_name));
    -- handle_new_user() hardcodes 'member'; the policy needs a real admin, and
    -- this write is the SQL-Editor path guard_profile_role() deliberately allows.
    update public.profiles set role = 'admin' where id = v_admin;

    insert into public.entries (title, owner_id, updated_at, last_activity_at)
      values ('0012 probe rest-path entry', v_leaver,
              now() - interval '5 days', now() - interval '5 days')
      returning id into v_entry;
    select updated_at, last_activity_at into v_u0, v_a0
      from public.entries where id = v_entry;

    -- Become that admin, exactly as PostgREST does: the claims GUC is what
    -- auth.uid() reads, and the role is what RLS is evaluated as. Both are
    -- transaction-local and die with the rollback below.
    perform set_config('request.jwt.claims',
                       json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    set local role authenticated;

    delete from public.profiles where id = v_leaver;

    reset role;
    select owner_id, owner_name, updated_at, last_activity_at
      into v_owner, v_got, v_u, v_a
      from public.entries where id = v_entry;

    raise exception using errcode = 'OT012', message = 'probe rollback';
  exception
    when sqlstate 'OT012' then
      null;
  end;

  if v_got is distinct from v_name or v_owner is not null then
    raise exception
      'OpsTrack 0012 FAILED: deleting the profiles row over the REST path left owner_id=%, owner_name=%. The trigger is on profiles for exactly this reason.',
      coalesce(v_owner::text, 'NULL'), coalesce(quote_literal(v_got), 'NULL');
  end if;

  if v_u is distinct from v_u0 or v_a is distinct from v_a0 then
    raise exception
      'OpsTrack 0012 FAILED: the clocks moved on the REST path (updated_at % -> %, last_activity_at % -> %), which is entries_guard_update() and entries_touch() winning the second statement.',
      v_u0, v_u, v_a0, v_a;
  end if;

  raise notice
    'OpsTrack 0012 probe 3: an admin deleting the profiles row directly gets the same credit and the same clocks. Rolled back.';
end
$prove$;
