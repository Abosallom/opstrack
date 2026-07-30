-- 0007 — the staleness clock stops counting its own bookkeeping.
--
-- WHAT WAS WRONG
-- 0002 split entries_touch()'s single diff in two so that a track move would
-- bump `updated_at` (bookkeeping) without bumping `last_activity_at`
-- (staleness). That is the whole reason the function exists, and it worked —
-- until 0004 added `entries.updated_by` and stamped it from
-- entries_guard_update().
--
-- The two triggers are both BEFORE UPDATE and fire in NAME order:
-- `entries_guard_update` sorts before `entries_touch_trg`, so by the time
-- entries_touch() diffs the row, the guard has already written `updated_by`
-- into NEW. entries_touch()'s second diff subtracted `updated_at`,
-- `last_activity_at` and `track_id` — but not `updated_by`. So a pure track
-- move arrived at the second diff carrying a changed column after all, and
-- `last_activity_at := now()`.
--
-- The clock was being reset by the stamp that records who reset it.
--
-- WHEN IT FIRED: whenever `updated_by` CHANGED, which for a track move is
-- (a) always the first time an entry is moved by a signed-in member, since the
-- column ships NULL, and (b) always when a different member moves it than last
-- touched it. Live at the time of writing: 3 of 10 rows carried a stamp, so
-- most moves were case (a). Reproduced against the live project before this
-- file was written — one open entry, `last_activity_at` seven days old, moved
-- to another track and nothing else: the clock jumped to now().
--
-- WHY IT MATTERS MORE THAN IT LOOKS
-- delete-with-reassign (0002's delete_track) repoints EVERY entry on a retired
-- track in one UPDATE. Under the bug, retiring a track laundered every stale
-- item under it into a freshly-worked one, which is precisely the outcome
-- 0002's comment promises cannot happen. The follow-ups screen, the dashboard
-- and the Wave-3 digest all read `last_activity_at`; every staleness threshold
-- calibrated against it was being calibrated against corrupted data.
--
-- THE FIX is one token: subtract `updated_by` from the diffs, the same way
-- entries_guard_update() already subtracts it from its own. Both diffs, not
-- just the activity one — `updated_by` is a stamp the server writes about the
-- write, never a field a client edits, so it is not evidence that anything
-- changed. In practice the guard only ever stamps it alongside a real change,
-- so the `updated_at` half is belt-and-braces rather than a behaviour change.
--
-- ALTERNATIVE CONSIDERED AND REJECTED: dropping `entries.updated_by` outright
-- (the backlog's P8). It has no reader in the app today, so deleting the column
-- would also close this hole. Rejected because the column answers "who last
-- edited this" for a field edit that writes no thread row — 0004 added it for
-- that reason and Wave 4's members work wants it — and because a schema change
-- is a much larger blast radius than a diff subtraction for the same outcome.
--
-- IDEMPOTENT. `create or replace function` on the same signature; the trigger
-- from 0001 (entries_touch_trg) binds by name and is untouched. Running this
-- file twice changes nothing the second time, and the assertion block at the
-- bottom re-proves the behaviour on live data on every run.
--
-- REVERSIBLE by re-running 0002's body, though there is no reason to.


-- ── entries_touch(), corrected ──────────────────────────────────────────────
-- Body is 0002's, with `- 'updated_by'` added to both diffs and the closed_at
-- block carried through verbatim (create or replace rewrites the whole body,
-- so anything not repeated here would be silently dropped).
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
  -- bookkeeping. See the header — this is the whole point of 0007.
  if (to_jsonb(new) - 'updated_at' - 'last_activity_at' - 'updated_by')
     is distinct from
     (to_jsonb(old) - 'updated_at' - 'last_activity_at' - 'updated_by') then
    new.updated_at := now();
  end if;

  -- …and track_id as well, which is the original 0002 fix: a reassignment is
  -- bookkeeping, so it moves the bookkeeping clock above but must leave the
  -- staleness clock where it is. A stale item stays stale through a move.
  if (to_jsonb(new) - 'updated_at' - 'last_activity_at' - 'updated_by' - 'track_id')
     is distinct from
     (to_jsonb(old) - 'updated_at' - 'last_activity_at' - 'updated_by' - 'track_id') then
    new.last_activity_at := now();
  end if;

  -- closed_at tracks the terminal statuses in both directions, so reopening an
  -- item clears it rather than leaving a stale close date on the dashboard.
  -- Unchanged from 0001/0002.
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
  'BEFORE UPDATE on entries. Moves updated_at on any real column change and last_activity_at on any real column change other than track_id; maintains closed_at. updated_at, last_activity_at and updated_by are excluded from both diffs — they are the server''s own bookkeeping, and 0007 exists because diffing updated_by let a pure track move reset the staleness clock.';


-- ── the assertion block ─────────────────────────────────────────────────────
-- The claim this file makes is behavioural, so it is proved behaviourally, on
-- this project's real rows, every time the migration runs — the same policy
-- 0006's row-count block follows.
--
-- HOW IT AVOIDS LEAVING A TRACE: the UPDATE runs inside an inner BEGIN…
-- EXCEPTION block, which Postgres implements as a subtransaction. The block
-- ends by raising a sentinel SQLSTATE, so the subtransaction is rolled back and
-- the row is left exactly as it was found. plpgsql variables are NOT rolled
-- back with it, so the four timestamps read inside the block survive to be
-- compared after it.
--
-- WHY IT STAMPS updated_by BY HAND: entries_guard_update() returns early when
-- `auth.uid()` is null, and it is null here — a migration runs with no JWT. So
-- the probe writes the column itself, reproducing exactly the row image that a
-- signed-in member's track move presents to entries_touch().
--
-- AND WHY THE ROW IS CHOSEN THE WAY IT IS. The stamp has to actually CHANGE, or
-- the probe passes against the BROKEN function and proves nothing — the first
-- cut of this block picked `order by id limit 1`, landed on a row already
-- stamped with the workspace's only profile, wrote the same value back, and
-- came up green against 0002's body. So the entry and the actor are chosen
-- TOGETHER, by the lateral join below, such that the actor is distinct from
-- whatever that row already carries. Verified by re-running this block against
-- 0002's body in a rolled-back transaction: it raises.
--
-- The second probe is the other half of the claim. Subtracting a column from a
-- diff is a change that can only ever make the function LESS sensitive, so a
-- test that only checks "the clock did not move" is satisfied by a function
-- that never moves it at all. Probe 2 edits a real field and requires the clock
-- to move.
--
-- Both raise on failure rather than noticing. A silently unfixed staleness
-- clock is what got us here.
do $prove$
declare
  v_id            uuid;
  v_from_track    uuid;
  v_to_track      uuid;
  v_actor         uuid;
  v_upd_before    timestamptz;
  v_upd_after     timestamptz;
  v_act_before    timestamptz;
  v_act_after     timestamptz;
  v_title         text;
begin
  -- An open entry paired with a profile that is NOT its current updated_by, so
  -- that stamping it is a genuine change. `cross join lateral` rather than two
  -- separate selects precisely so the pairing is a property of the chosen row.
  select e.id, e.track_id, e.updated_at, e.last_activity_at, e.title, a.id
    into v_id, v_from_track, v_upd_before, v_act_before, v_title, v_actor
    from public.entries e
    cross join lateral (
      select p.id
        from public.profiles p
       where p.id is distinct from e.updated_by
       limit 1
    ) a
   where e.status not in ('done', 'cancelled')
   order by e.id
   limit 1;

  select t.id into v_to_track
    from public.tracks t
   where t.archived = false and t.id is distinct from v_from_track
   order by t.sort_order
   limit 1;

  -- A workspace with nothing to move, nowhere to move it, or nobody to blame
  -- for moving it cannot be probed. Say so rather than failing: the function
  -- above is still correct, and the DB guards guarantee at least one track in
  -- normal operation.
  if v_id is null or v_to_track is null or v_actor is null then
    raise notice
      'OpsTrack 0007: entries_touch() replaced; probe skipped (entry=%, target track=%, actor=%).',
      v_id, v_to_track, v_actor;
    return;
  end if;

  -- ── probe 1: a pure track move must NOT move the staleness clock ──────────
  begin
    update public.entries
       set track_id   = v_to_track,
           updated_by = v_actor
     where id = v_id;

    select e.updated_at, e.last_activity_at
      into v_upd_after, v_act_after
      from public.entries e
     where e.id = v_id;

    raise exception using errcode = 'OT007', message = 'probe rollback';
  exception
    when sqlstate 'OT007' then
      null; -- subtransaction discarded; the row is untouched, the reads survive
  end;

  if v_act_after is distinct from v_act_before then
    raise exception
      'OpsTrack 0007 FAILED: moving only track_id moved last_activity_at (% -> %) on entry %',
      v_act_before, v_act_after, v_id;
  end if;

  if v_upd_after is not distinct from v_upd_before then
    raise exception
      'OpsTrack 0007 FAILED: moving track_id did not move updated_at (still %) on entry % — the bookkeeping clock must still tick',
      v_upd_before, v_id;
  end if;

  raise notice
    'OpsTrack 0007 probe 1: entry % moved track % -> % with an updated_by stamp; last_activity_at held at %, updated_at moved % -> %.',
    v_id, v_from_track, v_to_track, v_act_after, v_upd_before, v_upd_after;

  -- ── probe 2: a real edit MUST still move it ───────────────────────────────
  begin
    update public.entries
       set title      = v_title || ' (0007 probe)',
           updated_by = v_actor
     where id = v_id;

    select e.last_activity_at into v_act_after
      from public.entries e
     where e.id = v_id;

    raise exception using errcode = 'OT007', message = 'probe rollback';
  exception
    when sqlstate 'OT007' then
      null;
  end;

  if v_act_after is not distinct from v_act_before then
    raise exception
      'OpsTrack 0007 FAILED: editing the title left last_activity_at at % on entry % — the staleness clock has stopped working entirely',
      v_act_before, v_id;
  end if;

  raise notice
    'OpsTrack 0007 probe 2: a title edit on entry % moved last_activity_at % -> %. Both probes rolled back.',
    v_id, v_act_before, v_act_after;
end
$prove$;
