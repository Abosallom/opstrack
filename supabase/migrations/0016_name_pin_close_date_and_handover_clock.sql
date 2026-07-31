-- 0016 — three columns a member could write that nobody meant them to write:
--        their own NAME, a closed entry's CLOSE DATE, and, by side effect, the
--        STALENESS CLOCK of every item they are handed.
--
-- All three are the same shape as 0004/0008/0014/0015: RLS is row-level, the
-- policies say "any member, their own row" or "any member, any row", and the
-- only column-level control in this schema is a BEFORE trigger. Where a trigger
-- forgot a column, PostgREST accepts it — there is no column-level grant or
-- revoke on `profiles` or on `entries` anywhere in the sixteen files, so
-- Supabase's default table-wide grant to `authenticated` stands and any column
-- named in a PATCH body is written.
--
--
-- ── R3-SEC-1 — a member could permanently rename themselves to a colleague ──
--
-- `profiles_update` is `id = auth.uid() or is_admin()` (0001:78-82, restated
-- 0009:165-168) and `guard_profile_role()` (0001:90-122) — the only BEFORE
-- UPDATE trigger on the table — pinned `role` and nothing else. `display_name`
-- is bare `text not null default ''` (0001:23): no CHECK, no unique index, no
-- length cap in any migration, and no audit trigger on `profiles` at all
-- (`config_audit` covers tracks, vocab and, since 0014, recurring_templates).
-- So one authenticated request —
--
--   PATCH /rest/v1/profiles?id=eq.<self>   {"display_name": "Aziz Alsaloom"}
--
-- — and the workspace has two department heads.
--
-- WHAT MAKES IT LAND EVERYWHERE is the anti-forgery mitigation 0004:196-207
-- built against the OTHER variant of this. That paragraph anticipated a member
-- renaming themselves, causing a notification, and renaming BACK, and defeated
-- it by resolving attribution from the LIVE profile instead of the snapshot —
-- in the client (src/api/notifications.ts:46-54, src/store/members.ts:136,
-- src/components/NotificationBell.tsx:145) and in the push sender (0011:309,
-- `coalesce(nullif(btrim(a.display_name), ''), n.actor_name)`). Against a
-- PERMANENT rename that same live lookup is what renders the impersonated name
-- on every attribution surface in the product, including colleagues' lock
-- screens. The mitigation for the transient case is the delivery mechanism for
-- the permanent one.
--
-- 0013:33-42 already rejected an entire `profiles.username` column on exactly
-- this reasoning — "a member who can write their own username can write
-- somebody else's" — and never applied it to the column next to it.
--
-- THE PIN COSTS THE APP NOTHING. The app makes two statements against
-- `profiles`: a read (src/store/auth.ts:360) and `update({ locale })`
-- (src/store/settings.ts:66-69). `locale` stays writable. Nothing in the
-- product writes `display_name` under a member's JWT — not even an admin's:
-- `admin-members` has no rename action at all (`list`, `create`,
-- `reissue-code`, `set-role`, `delete`), and the two places it does write a
-- name (index.ts:527, :601) run on the service-role client, whose JWT carries
-- no `sub`, so `auth.uid()` is null and this guard passes them through
-- untouched — exactly as the `role` pin already does. Same for the SQL Editor.
-- If self-service renaming is ever wanted, it belongs in `admin-members` as an
-- action, where it is server-mediated and auditable.
--
-- Pinned for ADMINS TOO, unlike `role`. The `role` pin exempts admins because
-- moving someone between roles is a thing an admin does from the Members
-- screen. Renaming is not: there is no such screen, so an admin-shaped hole
-- would be a hole with no user behind it.
--
--
-- ── R3-DB-2 — a member could re-date a closed entry ─────────────────────────
--
-- `entries_guard_update()` pins `created_at`, `created_by`, `template_id` and
-- `updated_by` (0015:191-235) and NOT `closed_at`. `entries_touch()` writes
-- that column only inside `if new.status is distinct from old.status`
-- (0007:96-102), so a PATCH that changes only `closed_at` passes both triggers
-- untouched and is stored verbatim, on any row, by any member
-- (`entries_update` is `is_member()` in both clauses, 0009:82-85).
--
-- 0015:106-110 looked straight at this column and cleared it, on an argument
-- that is true only for the case the INSERT guard covers: "a forged close date
-- ON AN OPEN ROW surfaces nowhere", because `listClosedSince()` filters on
-- status AND closed_at together. On an ALREADY-CLOSED row that filter is
-- precisely what reads the forged value. `listClosedSince()`
-- (src/api/entries.ts:223-233) is `status in ('done','cancelled') and
-- closed_at >= since`, and it feeds throughput (src/lib/aggregate.ts:264), SLA
-- compliance (aggregate.ts:444 — both window membership and the lead time) and
-- the digest's Closed section (src/lib/digest/build.ts:202). EntrySheet renders
-- it back as "Closed on ⟨date⟩" (EntrySheet.tsx:582-587). The note at
-- 0015:106-110 is corrected in place by this file's companion edit.
--
-- WHY THE SANCTIONED PATH IS NOT THE SAME CAPABILITY. `ENTRIES_UPDATE_IS_OPEN`
-- already lets any member close or reopen any entry, so a member can move these
-- numbers today — but only forward, visibly, and with a trail: closing stamps
-- `closed_at := now()`, moves the card, and the app writes an `entry_updates`
-- transition row. The one-column PATCH adds arbitrary RETRO-dating with no
-- status change and no thread row: a June closure counted in July's throughput,
-- or a shrunken `closed_at - created_at` turning a breached item into a met one
-- (`created_at` is pinned, so `closed_at` is the only lever on lead time, and
-- reopen/re-close can only ever make lead time longer). The only trace is
-- `entries.updated_by`, which `Entry` does not even declare (src/types.ts:190-220,
-- src/lib/export.ts:553-556) and no screen renders.
--
-- THE PIN IS SAFE BY TRIGGER ORDER. `entries_guard_update` sorts before
-- `entries_touch_trg`, so `entries_touch()` still owns the column: new→done
-- still gets `coalesce(null, now())`, done→open still clears it, done→cancelled
-- still preserves it. Nothing references `closed_at`, so no FK-style `case`
-- exception is needed, unlike `created_by`/`template_id`. Bonus: with the pin, a
-- `closed_at`-only PATCH becomes an empty diff, so the clocks correctly stop
-- moving for it too.
--
--
-- ── R3-LEAD-1 — handing an item over reset its staleness clock ──────────────
--
-- MEASURED IN A LIVE SESSION, 2026-07-31, not deduced: "Portal onboarding guide
-- needs an Arabic version" sat in Follow-ups under "Going quiet" reading
-- `New · 33d · Stale · Unassigned`. One change — Owner: Unassigned → Lina Qasem
-- — and it left the screen (header 10 → 9 items, dashboard "Going quiet" tile
-- 2 → 1). On "Storage array capacity at 88%" the sheet badges went from
-- `Infrastructure · Stale · 7d` to `Infrastructure · On track · 0d` the instant
-- an owner was picked. The only request sent was `PATCH entries {owner_id,
-- owner_name}`.
--
-- CAUSE: `entries_touch()`'s activity diff (0007:87-90) subtracts `updated_at`,
-- `last_activity_at`, `updated_by` and `track_id` — so an owner-only UPDATE is
-- a real diff and falls through to `new.last_activity_at := now()`. 0007's own
-- comment at :84-86 states the principle and applies it to one column: "a
-- reassignment is bookkeeping, so it moves the bookkeeping clock above but must
-- leave the staleness clock where it is. A stale item stays stale through a
-- move." It fixed the TRACK move and left the OWNER move, which is the
-- reassignment a department head actually performs.
--
-- THE REPO HAS ALREADY RULED ON THIS, in its own voice. 0012:191-208: "an owner
-- change is a real column change — so the FK's `set null` ALREADY reset the
-- staleness clock on every entry a departing member owned. That is the 0007
-- failure class exactly." 0012 then spends an extra UPDATE and a jsonb clock
-- snapshot defending against owner-change-resets-clock — on the member-DELETION
-- path only. Every interactive assignment was left open: EntrySheet.tsx:500,
-- Board.tsx:389, FollowUps.tsx:782 ("Take it") and TracksIndex.tsx:261, the
-- bulk bar that launders up to 30 rows in one gesture — "precisely the outcome
-- 0002's comment promises cannot happen" (0007:29-34, about the track case).
--
-- Visible in a single screen: on the board, a drag across the `track` axis
-- preserves staleness and the identical drag across the `owner` axis resets it.
--
-- BOTH HALVES OF THE XOR PAIR ARE SUBTRACTED. `toEntryPatchRow()`
-- (src/api/entries.ts:445-454) sends `{owner_id, owner_name}` together —
-- assigning a teammate clears the vendor name in the same statement — so
-- subtracting `owner_id` alone would leave every real assignment still bumping
-- the clock through `owner_name`.
--
-- WHAT STILL COUNTS AS ACTIVITY, so the handover is not silent: `updated_at`
-- still moves (bookkeeping), `entries_notify()` (0004:287-288) still fires on
-- `owner_id is distinct from old.owner_id` and still tells the new owner, and
-- any patch that changes anything else in the same statement still stamps the
-- staleness clock. What stops happening is a neglected item looking attended to
-- because it was handed to someone.
--
-- KNOWN AND DELIBERATELY NOT CHANGED HERE: `applyPatchLocal()`
-- (src/store/entries.ts:278-279) bumps `last_activity_at` optimistically for
-- every patch, so an owner-only assignment still flickers for one round trip
-- before `applyServerRow()` settles the true value. That mirror has always been
-- wrong for `track_id` too, it is self-correcting, and src/ belongs to another
-- fixer this round.
--
--
-- IDEMPOTENT. Three `create or replace function`s on unchanged signatures, and
-- `drop trigger if exists` before each `create trigger`. `entries_touch_trg`
-- (0001:454-457) binds `entries_touch()` by name and is not restated, the way
-- 0007 left it. Running this file twice changes nothing the second time, and the
-- three probe blocks re-prove all three behaviours on every run.
--
-- APPLY AFTER 0014 AND 0015, both of which are also PENDING APPLICATION on
-- lrysgpbkmuqgzsjesfkr as of 2026-07-31 (measured over PostgREST with the anon
-- key: `recurring_templates.created_by` and `meeting_lines.updated_by` both
-- answer 42703, while `entries.closed_at` and `profiles.display_name` answer
-- 200). PART 2 below restates the whole of 0015's `entries_guard_update()`, so
-- applying this file out of order would silently revert 0015's PART 1.
--
-- REVERSIBLE by re-running 0001 (PART 1), 0015 (PART 2) and 0007 (PART 3),
-- though the only thing that buys is the three defects back.


-- ═══ PART 1 ═══ guard_profile_role(): identity is not a self-service field
--
-- Body is 0001's, with the `role` test moved inside a shared `auth.uid() is not
-- null` block and two pins added. `create or replace` rewrites the whole body,
-- so anything not repeated here would be silently dropped.
create or replace function public.guard_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only pin the columns when a real END USER is acting. auth.uid() is NULL for
  -- the service role (the admin-members edge function) and in the SQL Editor,
  -- and those are precisely the privileged paths that are SUPPOSED to set a
  -- role and a name. Without the auth.uid() test both of them had their write
  -- silently reverted to the old value, the statement still reported success,
  -- and no admin could ever be provisioned — which made every is_admin() policy
  -- in 0001 permanently unsatisfiable.
  --
  -- This is safe because RLS runs before the trigger: profiles_update requires
  -- `id = auth.uid() or public.is_admin()`, and both are false without a JWT,
  -- so an anon or profile-less caller is rejected at the policy layer and never
  -- reaches this function. The only writers that arrive here with auth.uid()
  -- null are ones that already bypass RLS by design.
  if auth.uid() is not null then

    -- RLS is row-level, not column-level: profiles_update lets a member edit
    -- their own row, which would also let them set role='admin' on it. Only an
    -- admin can move anyone between roles. (0001, unchanged.)
    if new.role is distinct from old.role and not public.is_admin() then
      new.role := old.role;
    end if;

    -- …and the same policy let them write their own display_name, which is the
    -- name every attribution surface in the product resolves LIVE (0011:309 for
    -- push, src/store/members.ts:136 and NotificationBell.tsx:145 in the app).
    -- One PATCH and a member appears, everywhere and on everyone's phone, to be
    -- somebody else. NOT exempted for admins, unlike `role`: no screen in the
    -- product renames anybody, so the only callers this could inconvenience are
    -- the two JWT-less ones above, which the outer `if` already lets through.
    new.display_name := old.display_name;

    -- Provenance, for the same reason it is pinned on `entries` (0015:191): it
    -- is server-side truth about the row, not a field anybody edits.
    new.created_at := old.created_at;

  end if;
  return new;
end;
$$;

-- Unchanged from 0001 and restated because `create trigger` is not idempotent.
drop trigger if exists profiles_guard_role on public.profiles;
create trigger profiles_guard_role
  before update on public.profiles
  for each row execute function public.guard_profile_role();

comment on function public.guard_profile_role() is
  'BEFORE UPDATE on profiles. Pins role (except for an admin), display_name and created_at against any writer holding a JWT; leaves locale — the only column the app writes — free. auth.uid() is null for the service role and the SQL Editor, which are the two paths that are supposed to set a name or a role. 0016: without the display_name pin, one PATCH renamed a member to the department head on every attribution surface, including push notifications, because 0004:196-207 resolves the name LIVE.';


-- ═══ PART 2 ═══ entries_guard_update(): a close date is not a client field
--
-- Body is 0015's — both `case` expressions, the diff, and the `else` branch —
-- with one line added. Restated in full because `create or replace` rewrites
-- everything; dropping any of it would re-open R2-DB-1 or the `{"updated_by":
-- null}` erase.
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
  new.created_at  := old.created_at;

  -- R3-LEAD-1's sibling, and the one 0015:106-110 waved through. `closed_at` is
  -- written by entries_touch() and only ever on a real status change; a client
  -- that names the column directly was re-dating a closed item into or out of
  -- last week's throughput, lead time and SLA-compliance numbers. No `case`
  -- exception is needed here — nothing references closed_at, so no FK ever
  -- writes it — and the pin is invisible to entries_touch(), which runs AFTER
  -- this function (name order) and still sets the column on new→done, clears it
  -- on reopen, and preserves it on done→cancelled.
  new.closed_at   := old.closed_at;

  -- …but a NULL arriving on a column whose referent has just been deleted is
  -- not a client edit, it is the FK's `on delete set null` action passing
  -- through this trigger on its way to the row. Distinguishing the two is the
  -- whole of R2-DB-1. The `not exists` reads run under SECURITY DEFINER, so
  -- they see the referenced tables regardless of the caller's RLS.
  new.created_by := case
    when new.created_by is null and old.created_by is not null
     and not exists (select 1 from public.profiles p where p.id = old.created_by)
    then null
    else old.created_by
  end;

  new.template_id := case
    when new.template_id is null and old.template_id is not null
     and not exists (select 1 from public.recurring_templates t where t.id = old.template_id)
    then null
    else old.template_id
  end;

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
  --
  -- NOTE this diff deliberately does NOT subtract owner_id/owner_name, which
  -- PART 3 subtracts from the ACTIVITY diff one function over. A handover is a
  -- real edit and gets a real editor stamp; what it must not do is pretend the
  -- work was attended to. The two questions are different and so are the two
  -- diffs.
  if (to_jsonb(new) - 'updated_at' - 'last_activity_at' - 'updated_by')
     is distinct from
     (to_jsonb(old) - 'updated_at' - 'last_activity_at' - 'updated_by') then
    new.updated_by := coalesce(
      (select p.id from public.profiles p where p.id = auth.uid()),
      old.updated_by
    );
  else
    -- The `else` 0004 did not have. `updated_by` is never taken from the
    -- payload: subtracting it from the diff and then leaving it alone handed a
    -- member a one-line PATCH — `{"updated_by": null}` — that erased the mark
    -- without changing anything else. 0014:176-179, one table over.
    new.updated_by := old.updated_by;
  end if;

  return new;
end;
$$;

-- Unchanged from 0004/0015 and restated because `create trigger` is not
-- idempotent. BEFORE UPDATE, and it runs ahead of entries_touch(): Postgres
-- fires BEFORE row triggers in NAME order, and `entries_guard_update` sorts
-- before `entries_touch_trg`. That ordering is load-bearing — entries_touch()
-- diffs the row to decide whether to move the clocks, and it has to see the
-- pinned values, not the ones the client sent.
drop trigger if exists entries_guard_update on public.entries;
create trigger entries_guard_update
  before update on public.entries
  for each row execute function public.entries_guard_update();

comment on function public.entries_guard_update() is
  'Pins created_at, closed_at, created_by, template_id and updated_by on a client UPDATE, and stamps updated_by from the JWT when anything else changed. The two `case` expressions let the foreign keys own `on delete set null` action through — pinning it unconditionally (0004:554-556) silently reverted it and left dangling FKs behind an admin''s delete. closed_at was added in 0016: unpinned, a one-column PATCH re-dated a closed entry into or out of every reported number.';


-- ═══ PART 3 ═══ entries_touch(): a handover is bookkeeping, whichever column
--                spells the owner
--
-- Body is 0007's, with `- 'owner_id' - 'owner_name'` added to the ACTIVITY diff
-- only, and the closed_at block carried through verbatim (create or replace
-- rewrites the whole body, so anything not repeated here would be silently
-- dropped).
create or replace function public.entries_touch()
returns trigger
language plpgsql
as $$
begin
  -- THREE COLUMNS ARE SUBTRACTED FROM BOTH DIFFS, for two different reasons.
  --
  -- updated_at / last_activity_at: so that the AFTER INSERT trigger on
  -- entry_updates — which issues an UPDATE that lands right back here — is seen
  -- as "no real change" instead of stamping now() a second time.
  --
  -- updated_by: because entries_guard_update() has already written it into NEW
  -- by the time this function runs (BEFORE triggers fire in name order, and
  -- that name sorts first). It is the server's record of WHO made the change,
  -- not part of the change, and diffing it makes this function react to its own
  -- bookkeeping. See 0007's header — that is the whole point of that file.
  if (to_jsonb(new) - 'updated_at' - 'last_activity_at' - 'updated_by')
     is distinct from
     (to_jsonb(old) - 'updated_at' - 'last_activity_at' - 'updated_by') then
    new.updated_at := now();
  end if;

  -- …and THE THREE REASSIGNMENT COLUMNS as well, which is 0002's original fix
  -- (track_id) extended by 0016 to the owner pair: a reassignment is
  -- bookkeeping, so it moves the bookkeeping clock above but must leave the
  -- staleness clock where it is. A stale item stays stale through a move — and
  -- through a handover, which is the move a department head actually performs.
  --
  -- owner_id AND owner_name, because they are one field written as two:
  -- `entries_single_owner` forbids holding both, so assigning a teammate CLEARS
  -- the free-text name in the same statement (src/api/entries.ts:445-454) and
  -- subtracting only owner_id would leave every real assignment still bumping
  -- the clock through the other half.
  --
  -- The handover is still visible: updated_at moves above, entries_notify()
  -- (0004:287-288) still tells the new owner, and a patch that changes anything
  -- else in the same statement still stamps this clock. What stops is a
  -- neglected item disappearing from Follow-ups because it was delegated.
  if (to_jsonb(new) - 'updated_at' - 'last_activity_at' - 'updated_by'
                    - 'track_id' - 'owner_id' - 'owner_name')
     is distinct from
     (to_jsonb(old) - 'updated_at' - 'last_activity_at' - 'updated_by'
                    - 'track_id' - 'owner_id' - 'owner_name') then
    new.last_activity_at := now();
  end if;

  -- closed_at tracks the terminal statuses in both directions, so reopening an
  -- item clears it rather than leaving a stale close date on the dashboard.
  -- Unchanged from 0001/0002/0007, and now the ONLY writer of the column that a
  -- client can reach: PART 2 pins it against the payload, so what this block
  -- computes is what the row ends up with.
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

comment on function public.entries_touch() is
  'BEFORE UPDATE on entries. Moves updated_at on any real column change and last_activity_at on any real column change other than a reassignment (track_id, owner_id, owner_name); maintains closed_at. updated_at, last_activity_at and updated_by are excluded from both diffs — they are the server''s own bookkeeping. 0007 exists because diffing updated_by let a pure track move reset the staleness clock; 0016 exists because handing an item to a teammate did the same, so delegating a neglected item erased the evidence it was neglected.';


-- ═══ PROBE 1 ═══ a member cannot rename themselves, and the paths that are
--                supposed to set a name still can
-- Everything below happens inside a subtransaction thrown away by a sentinel
-- exception — the 0007/0008/0012/0014/0015 pattern. No row survives, and every
-- scratch row is created here rather than borrowed, so the probe works on an
-- empty workspace and can never touch a real one.
do $prove$
declare
  v_me       uuid := gen_random_uuid();
  v_renamed  text;
  v_role     text;
  v_locale   text;
  v_admin    text;
  v_created  timestamptz;
  v_created0 timestamptz;
begin
  begin
    insert into auth.users (id, email, raw_user_meta_data)
      values (v_me, 'probe-1-' || v_me || '@0016.invalid',
              jsonb_build_object('display_name', '0016 Probe Member'));
    if not exists (select 1 from public.profiles where id = v_me) then
      raise exception 'OpsTrack 0016 PROBE 1 SETUP FAILED: handle_new_user() did not create the fixture profile.';
    end if;
    select created_at into v_created0 from public.profiles where id = v_me;

    -- Become a client. auth.uid() reads request.jwt.claims ->> 'sub'; `true`
    -- makes the setting local to this transaction so it dies with the rollback.
    perform set_config('request.jwt.claims',
                       json_build_object('sub', v_me)::text, true);

    -- THE REQUEST: PATCH /rest/v1/profiles?id=eq.<self> {"display_name": …}
    update public.profiles
       set display_name = '0016 Probe Department Head',
           created_at   = timestamptz '2020-01-01 00:00:00+00'
     where id = v_me;
    select display_name, created_at into v_renamed, v_created
      from public.profiles where id = v_me;

    -- 0001's pin, re-proved because this file rewrote the function around it.
    update public.profiles set role = 'admin' where id = v_me;
    select role into v_role from public.profiles where id = v_me;

    -- The one column the app really writes must still be writable, or the
    -- language toggle stops persisting (src/store/settings.ts:66-69).
    update public.profiles set locale = 'ar' where id = v_me;
    select locale into v_locale from public.profiles where id = v_me;

    -- And the privileged, JWT-less path — the SQL Editor and admin-members on
    -- the service role — must still be able to set a name, or no member can
    -- ever be provisioned with one.
    perform set_config('request.jwt.claims', '', true);
    update public.profiles set display_name = '0016 Probe Renamed By Service' where id = v_me;
    select display_name into v_admin from public.profiles where id = v_me;

    raise exception using errcode = 'OT016', message = 'probe rollback';
  exception
    when sqlstate 'OT016' then
      null; -- subtransaction discarded; the reads above survive
  end;

  if v_renamed is distinct from '0016 Probe Member' then
    raise exception
      'OpsTrack 0016 FAILED: a member renamed themselves to %. guard_profile_role() is not pinning display_name, and every attribution surface resolves the live name (0011:309).',
      v_renamed;
  end if;

  if v_created is distinct from v_created0 then
    raise exception
      'OpsTrack 0016 FAILED: a member rewrote profiles.created_at (% -> %).',
      v_created0, v_created;
  end if;

  if v_role is distinct from 'member' then
    raise exception
      'OpsTrack 0016 FAILED: a member made themselves %. 0001''s role pin was lost when this file rewrote the function.',
      v_role;
  end if;

  if v_locale is distinct from 'ar' then
    raise exception
      'OpsTrack 0016 FAILED: a member could not write their own locale (still %). The pin is too wide — settings.ts:66-69 is the app''s only profiles write.',
      v_locale;
  end if;

  if v_admin is distinct from '0016 Probe Renamed By Service' then
    raise exception
      'OpsTrack 0016 FAILED: the JWT-less path could not set display_name (got %). auth.uid() must be null for the service role and the SQL Editor, or admin-members cannot provision a named member.',
      coalesce(v_admin, 'NULL');
  end if;

  raise notice
    'OpsTrack 0016 probe 1: a member''s rename and created_at rewrite were both refused, the role pin held, locale stayed writable, and the service-role path still set a name. Rolled back.';
end
$prove$;


-- ═══ PROBE 2 ═══ a closed entry's close date survives a member's PATCH, and
--                entries_touch() still owns the column on a real transition
do $prove$
declare
  v_me       uuid := gen_random_uuid();
  v_entry    uuid := gen_random_uuid();
  v_closed   timestamptz;
  v_forged   timestamptz;
  v_act_pre  timestamptz;
  v_act_post timestamptz;
  v_reopened timestamptz;
  v_reclosed timestamptz;
begin
  begin
    insert into auth.users (id, email, raw_user_meta_data)
      values (v_me, 'probe-2-' || v_me || '@0016.invalid',
              jsonb_build_object('display_name', '0016 Probe Closer'));
    insert into public.entries (id, title) values (v_entry, '0016 probe close date');

    perform set_config('request.jwt.claims',
                       json_build_object('sub', v_me)::text, true);

    -- Close it the way the app closes it.
    update public.entries set status = 'done' where id = v_entry;
    select closed_at, last_activity_at into v_closed, v_act_pre
      from public.entries where id = v_entry;
    if v_closed is null then
      raise exception 'OpsTrack 0016 PROBE 2 SETUP FAILED: closing the entry left closed_at null.';
    end if;

    -- THE REQUEST: one column, no status change — the closure re-dated into
    -- another month, which is what throughput, lead time and SLA compliance
    -- read (aggregate.ts:264, :444; digest/build.ts:202).
    update public.entries
       set closed_at = timestamptz '2020-01-02 00:00:00+00'
     where id = v_entry;
    select closed_at, last_activity_at into v_forged, v_act_post
      from public.entries where id = v_entry;

    -- Reopening must still clear it…
    update public.entries set status = 'in_progress' where id = v_entry;
    select closed_at into v_reopened from public.entries where id = v_entry;

    -- …and a terminal status must still stamp it.
    update public.entries set status = 'cancelled' where id = v_entry;
    select closed_at into v_reclosed from public.entries where id = v_entry;

    raise exception using errcode = 'OT016', message = 'probe rollback';
  exception
    when sqlstate 'OT016' then
      null;
  end;

  if v_forged is distinct from v_closed then
    raise exception
      'OpsTrack 0016 FAILED: a member re-dated a closed entry (% -> %). entries_guard_update() is not pinning closed_at.',
      v_closed, v_forged;
  end if;

  if v_act_post is distinct from v_act_pre then
    raise exception
      'OpsTrack 0016 FAILED: a closed_at-only PATCH moved last_activity_at (% -> %). With the pin the statement is an empty diff and no clock may move.',
      v_act_pre, v_act_post;
  end if;

  if v_reopened is not null then
    raise exception
      'OpsTrack 0016 FAILED: reopening an entry left closed_at = %. The pin has taken the column away from entries_touch(), which must still clear it — check the trigger name order.',
      v_reopened;
  end if;

  if v_reclosed is null then
    raise exception
      'OpsTrack 0016 FAILED: cancelling a reopened entry left closed_at null, so it will never appear in a closed list again. The pin is being applied to a real status change.';
  end if;

  raise notice
    'OpsTrack 0016 probe 2: a member''s close-date rewrite was refused and moved no clock, reopening still cleared the date, and cancelling stamped a fresh one. Rolled back.';
end
$prove$;


-- ═══ PROBE 3 ═══ a handover moves the bookkeeping clock and not the staleness
--                clock — and a real edit still moves both
-- The second half is not decoration. Subtracting a column from a diff can only
-- ever make the function LESS sensitive, so a probe that checks only "the clock
-- did not move" is satisfied by a function that never moves it at all. 0007's
-- probe 2 makes the same point.
do $prove$
declare
  v_me      uuid := gen_random_uuid();
  v_mate    uuid := gen_random_uuid();
  v_entry   uuid := gen_random_uuid();
  v_act0    timestamptz;
  v_upd0    timestamptz;
  v_act1    timestamptz;
  v_upd1    timestamptz;
  v_act2    timestamptz;
  v_act3    timestamptz;
begin
  begin
    insert into auth.users (id, email, raw_user_meta_data)
      values (v_me,   'probe-3a-' || v_me   || '@0016.invalid',
              jsonb_build_object('display_name', '0016 Probe Lead')),
             (v_mate, 'probe-3b-' || v_mate || '@0016.invalid',
              jsonb_build_object('display_name', '0016 Probe Teammate'));
    insert into public.entries (id, title) values (v_entry, '0016 probe handover');

    -- Make it a month quiet. This lands verbatim: both clocks are subtracted
    -- from both diffs, so entries_touch() reads the statement as no change and
    -- leaves the values alone (the same property 0012:205-208 relies on).
    update public.entries
       set last_activity_at = now() - interval '30 days',
           updated_at       = now() - interval '30 days'
     where id = v_entry;
    select last_activity_at, updated_at into v_act0, v_upd0
      from public.entries where id = v_entry;

    perform set_config('request.jwt.claims',
                       json_build_object('sub', v_me)::text, true);

    -- THE GESTURE: hand it to a teammate and change nothing else. This is the
    -- exact request EntrySheet, the board, "Take it" and the bulk bar send.
    update public.entries set owner_id = v_mate where id = v_entry;
    select last_activity_at, updated_at into v_act1, v_upd1
      from public.entries where id = v_entry;

    -- The other half of the XOR pair, sent as one statement the way
    -- toEntryPatchRow() sends it: hand it to a vendor by name.
    update public.entries
       set owner_id = null, owner_name = '0016 Probe Vendor'
     where id = v_entry;
    select last_activity_at into v_act2 from public.entries where id = v_entry;

    -- A real edit MUST still move the staleness clock.
    update public.entries set title = '0016 probe handover (edited)' where id = v_entry;
    select last_activity_at into v_act3 from public.entries where id = v_entry;

    raise exception using errcode = 'OT016', message = 'probe rollback';
  exception
    when sqlstate 'OT016' then
      null;
  end;

  if v_act1 is distinct from v_act0 then
    raise exception
      'OpsTrack 0016 FAILED: assigning an owner moved last_activity_at (% -> %). A 30-day-quiet item just left Follow-ups because somebody delegated it.',
      v_act0, v_act1;
  end if;

  if v_upd1 is not distinct from v_upd0 then
    raise exception
      'OpsTrack 0016 FAILED: assigning an owner did not move updated_at (still %). The bookkeeping clock must still tick — owner_id is subtracted from the ACTIVITY diff only.',
      v_upd0;
  end if;

  if v_act2 is distinct from v_act0 then
    raise exception
      'OpsTrack 0016 FAILED: handing the item to a free-text owner moved last_activity_at (% -> %). owner_name is the other half of the same field and must be subtracted with owner_id.',
      v_act0, v_act2;
  end if;

  if v_act3 is not distinct from v_act0 then
    raise exception
      'OpsTrack 0016 FAILED: editing the title left last_activity_at at % — the staleness clock has stopped working entirely.',
      v_act0;
  end if;

  raise notice
    'OpsTrack 0016 probe 3: a 30-day-quiet entry stayed 30 days quiet through an assignment and a vendor handover, updated_at moved for both, and a title edit still moved the staleness clock. Rolled back.';
end
$prove$;
