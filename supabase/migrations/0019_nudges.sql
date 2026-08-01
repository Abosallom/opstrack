-- 0019 — nudges: the chase, recorded.
--
-- The third of the four pains, and the one the app has had NO feature for:
-- chasing people for updates. Today that chase happens in WhatsApp and in
-- corridors, which means it is invisible — nobody can tell "I asked twice and
-- got nothing" from "I keep meaning to ask". One tap here does three things at
-- once, in one transaction, or none of them:
--
--   1. the owner is TOLD           → a `notifications` row of the new kind 'nudged'
--   2. the ask is in the RECORD    → an immutable `entry_updates` row in the audit thread
--   3. the row can SHOW the ask    → `entries.nudged_at` / `nudged_by`
--
-- All three, or none: a notification without a thread row is an interruption
-- nobody can point at afterwards, and a thread row without a notification is a
-- complaint filed into a drawer. That is why this is an RPC and not three
-- client writes — the client cannot be trusted to complete a three-step
-- sequence over a phone connection in a lift.
--
-- ⚠ A NUDGE BUTTON IS A WAY TO ANNOY PEOPLE, and the plan says so. Three
-- refusals are built into the database rather than into the UI, because the UI
-- is one client of several and a disabled button is not a rule:
--
--   * not a member          → 42501
--   * your own item         → 22023  `nudge_self`          (and `nudge_no_owner`, same code)
--   * asked within 24 hours → PT429  `nudge_rate_limited`  (+ DETAIL = when)
--
-- Deploy: Supabase Dashboard -> SQL Editor -> paste + Run, or the management
-- API. Re-runnable from the top in any partial state, same discipline as
-- 0001-0018: `add column if not exists`, `drop constraint if exists` before the
-- add, `create or replace` on every function, `drop trigger if exists` before
-- every create, and probe blocks that roll themselves back. APPLIED TWICE
-- against the live project (lrysgpbkmuqgzsjesfkr) on 2026-08-01, in exactly this
-- text; the second run changed nothing and all three probes passed both times.
--
-- THREE EARLIER ATTEMPTS WERE REFUSED BY THE PROBES IN THIS FILE, which is the
-- best argument for writing them: two live defects in the schema as it stood
-- (PART 6, and the `else` branch in PART 3 — both R2-DB-1, both hard 23503s on
-- retiring a member) and one in the first draft of PART 3's own pin, which used
-- 0015's `current_user` test inside a SECURITY DEFINER trigger where it can
-- never be true. None of the three would have been visible from reading.
--
-- Depends on 0001 (entries, entry_updates), 0004 (notifications), 0015 and 0016
-- (the two guard functions this file restates). NO dependency on 0018
-- (track_groups) in either direction — the two files touch disjoint objects and
-- may be applied in either order.
--
--
-- ═══ WIDENING `notifications.kind` IS NOT TOUCHING THE FROZEN VOCABULARY ═══
--
-- The brief asked for this to be confirmed against 0004 before the CHECK was
-- widened, so here is the confirmation, with both definitions read:
--
--   0004:159   notifications.kind  check (kind in ('assigned', 'completed'))
--   0003:37    vocab_options.kind  check (kind in ('status', 'priority', 'type'))
--
-- THE FROZEN VOCABULARY IS THE SECOND ONE. 0003:6 states it — "six statuses,
-- four priorities, seven types, forever" — 17 rows whose KEYS never change so
-- that a rename is a label edit and never a data migration, and every one of
-- them describes an ENTRY. `notifications.kind` is a different column on a
-- different table with a different meaning: it is the internal enum of SENTENCES
-- THE INBOX CAN SAY, written only by the database, read only by
-- src/api/notifications.ts to pick a string. It is not in `vocab_options`, no
-- entry ever holds it, no admin screen edits it, and nothing in the app filters
-- or reports on it.
--
-- So adding 'nudged' adds a third sentence to the inbox. It changes no entry, no
-- vocabulary row, and no user-editable list, and there is no way to express this
-- feature without it: `recipient_id` is `not null`, so the ask has to arrive as
-- a notification, and it must be distinguishable from "you were assigned this"
-- or the inbox will say the wrong thing.
--
--
-- ═══ THE THREE DECISIONS WORTH ARGUING WITH ═══
--
-- 1. A NUDGE MUST NOT RESET THE STALENESS CLOCK. This is R3-LEAD-1's sibling and
--    it is the single most important line in the file. `last_activity_at` is
--    what makes an item stale (src/lib/health.ts:164), what sorts the list
--    (src/lib/entryFilter.ts:270), and what puts a row on Follow-ups at all. Two
--    separate mechanisms would otherwise move it: `entries_touch()` diffs the
--    row and would see the new nudge columns, and `entry_updates_touch_entry()`
--    (0001:479) bumps it unconditionally on every thread row. Left alone, the
--    button whose whole purpose is chasing a neglected item would have made that
--    item look attended-to, dropped it off the screen that chases it, and hidden
--    "asked 3 days ago, no reply" — the exact sentence the feature exists to
--    show. PART 4 subtracts the columns from the activity diff; PART 5 puts the
--    clock back by hand after the thread row moved it. PROBE 1 fails the
--    migration if either half regresses.
--
--    `updated_at` DOES move, and `updated_by` DOES become the nudger. Same
--    reasoning 0016 gives for a handover: the row was really written, so the
--    bookkeeping clock and the editor stamp are honest; what must not move is
--    the clock that measures SILENCE FROM THE OWNER, and a nudge is not the
--    owner speaking.
--
-- 2. THE STAMPS ARE THE SERVER'S, NOT THE PAYLOAD'S. `ENTRIES_UPDATE_IS_OPEN`
--    (src/lib/permissions.ts:30) means any member may PATCH any entry, and the
--    workspace is about to hold two teams instead of one. Unpinned,
--    `{"nudged_at": "2099-01-01"}` is a one-line request that makes an item
--    unnudgeable forever, and `{"nudged_at": null}` erases the visible evidence
--    that anyone ever asked. That is precisely the defect 0016 had to fix on
--    `closed_at`, and the answer is the same shape: pin it in
--    `entries_guard_update()`, using 0015's `current_user` allow-list so the
--    RPC's own write — which runs as the function owner — is the one writer that
--    gets through. See PART 3 for why an allow-list and not a GUC.
--
-- 3. THE RATE LIMIT IS PER ENTRY, NOT PER ASKER. The owner is the person being
--    interrupted, and two colleagues chasing the same item in one afternoon is
--    still two interruptions about one thing. Per-asker would let a team of
--    three ping somebody three times an hour and call each one the first. The
--    window is 24 hours, hardcoded: it is the interval a person reads as "you
--    already asked today", and a configurable annoyance budget is a setting
--    nobody would ever open.
--
--
-- ═══ WHAT THIS FILE DELIBERATELY DOES NOT DO ═══
--
--   * NO INDEX on nudged_at. Nothing queries it: every screen that shows the ask
--     already holds the entry row in the store, and Follow-ups filters
--     client-side (src/lib/entryFilter.ts). An index that no query names is
--     write amplification with a maintenance cost, and 0009 is the file that
--     taught this schema to count its indexes.
--   * NO REFUSAL FOR A CLOSED ENTRY. Nudging a `done` item is pointless rather
--     than harmful, the button is only offered on stale/blocked/overdue rows,
--     and every refusal added here is another sentence the client has to own and
--     an intern has to understand. The refusal list is kept to the three that
--     protect a PERSON.
--   * NO PER-KIND PUSH PREFERENCE. `claim_push_batch()` (0011:325-328) reads
--     `push_completed` for 'completed' and `push_assigned` for everything else,
--     so a nudge push follows the 'assigned' toggle. That is the closest
--     existing meaning — "something needs you" — and it still respects
--     `push_enabled`. A `push_nudged` column would mean a new prefs column, a new
--     row in NotificationPrefs.tsx and a redefinition of 0011's claim function,
--     for a toggle nobody has asked for yet. Recorded here so the next person
--     knows it was a choice.


-- ═══ PART 1 ═══ entries.nudged_at / nudged_by
--
-- BOTH NULLABLE, and null is the honest default: it means "nobody has asked",
-- which is the state of every entry that exists today and of most entries
-- forever. There is no backfill and there is nothing to backfill FROM — the
-- chase has never been recorded anywhere.
--
-- These two are a DENORMALISED CACHE of the newest 'nudged' notification, in
-- exactly the sense 0004:150 uses for `entry_title`: the durable record of every
-- ask is the thread row plus the notification, and this pair exists so that
-- "asked 3 days ago" can be drawn on a list of 200 rows without 200 joins. What
-- makes the cache trustworthy is PART 3 — only `nudge_entry()` can write it.
alter table public.entries add column if not exists nudged_at timestamptz;
alter table public.entries add column if not exists nudged_by uuid
  references public.profiles (id) on delete set null;

comment on column public.entries.nudged_at is
  'When somebody last asked the owner for an update, stamped by nudge_entry(). NULL = nobody has asked. Written ONLY by that RPC — entries_guard_update() pins it against a client PATCH — and read by the UI to draw "asked N days ago, no reply" and by the RPC itself as the 24h rate limit.';

comment on column public.entries.nudged_by is
  'Who asked, for the same ask nudged_at dates. `on delete set null`, like every other profiles reference on this table: a departed colleague''s ask stays visible on the row and in the thread, it just stops naming a profile that is gone.';


-- ═══ PART 2 ═══ notifications.kind gains 'nudged'
--
-- Named explicitly rather than left to the inline CHECK's generated name, so
-- that this file and the live project agree about what to drop on a re-run.
-- `notifications_kind_check` IS the live name (verified against pg_constraint on
-- lrysgpbkmuqgzsjesfkr before this file was written), which is what a fresh
-- 0004 also produces — so the drop below hits the same object whether the
-- project was built from 0004 or has already run this file.
--
-- The hazard 0002 and 0003 both document applies and is worth restating: DROP
-- before ADD leaves the table unconstrained if the ADD then fails on live data.
-- WIDENING cannot fail that way — every row that satisfied the two-value CHECK
-- satisfies the three-value one — which is why this direction is safe and the
-- reverse would need the data checked first.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('assigned', 'completed', 'nudged'));

comment on constraint notifications_kind_check on public.notifications is
  'The three sentences the inbox can say. NOT the frozen entry vocabulary (that is vocab_options, 0003) — this column is internal, written only by triggers and nudge_entry(), and read only to pick an i18n key. Widening it is additive; narrowing it would need the existing rows checked first.';


-- ═══ PART 3 ═══ entries_guard_update(): the nudge stamps are the server's
--
-- Body is 0016's — the created_at/closed_at pins, both `case` expressions, the
-- diff and its `else` branch — with ONE block added. Restated in full because
-- `create or replace` rewrites everything: dropping any of it would re-open
-- R2-DB-1 (the FK's own null-out reverted, dangling keys behind an admin's
-- delete), R3-DB-2 (a closed entry re-dated by a one-column PATCH) or the
-- `{"updated_by": null}` erase.
--
-- WHY A GUC AND NOT `current_user`, WHICH IS WHAT THIS FILE TRIED FIRST. The new
-- block has to separate two callers that both arrive with a JWT: a member's
-- PATCH (must be refused) and this file's own RPC (must be allowed).
-- `auth.uid()` cannot tell them apart — SECURITY DEFINER changes the ROLE, not
-- the request, which 0014:163 and 0015:280 both say out loud.
--
-- So the first draft reused 0015's mechanism verbatim: `if current_user in
-- ('authenticated', 'anon', 'authenticator') then pin`. PROBE 3 failed it on the
-- live project — the member's PATCH moved `nudged_at` to 2099 — and the reason
-- is written in 0015 itself, at :273-277, about why `entries_guard_insert()` is
-- the ONE guard in this schema that is not SECURITY DEFINER: *"This is the one
-- function in the set that has to know WHO IS CALLING, and SECURITY DEFINER
-- would answer 'the owner' every time."* `entries_guard_update()` IS security
-- definer, so `current_user` inside it reads `postgres` for every caller,
-- including the PATCH — the test was true for nobody and the pin never ran.
-- Making this function INVOKER to fix that is not on: its two `not exists`
-- lookups have to see `profiles` and `recurring_templates` regardless of the
-- caller's RLS, which is why it was made definer in the first place.
--
-- `session_user` cannot help either: PostgREST connects as `authenticator` and
-- does `set local role authenticated` per request, so session_user reads
-- `authenticator` for the PATCH and for the RPC alike.
--
-- What is left is the request-scoped flag below. `set_config(…, is_local =>
-- true)` is TRANSACTION-local, so it dies at commit and cannot leak across a
-- pooled connection to the next request; nudge_entry() clears it explicitly
-- anyway; and it carries the ENTRY ID, so the exemption it grants is one row
-- wide, not table-wide. A REST client cannot set it: PostgREST namespaces
-- everything it derives from a request under `request.*`, there is no exposed
-- function in this schema that calls set_config with caller-supplied arguments,
-- and a client has no other way to run SQL.
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
  -- that named the column directly was re-dating a closed item into or out of
  -- last week's throughput, lead time and SLA-compliance numbers.
  new.closed_at   := old.closed_at;

  -- 0019 — THE NUDGE STAMPS. Only nudge_entry() may write these, and it says so
  -- by naming this entry in a transaction-local flag immediately before its
  -- UPDATE (see the header above for why the flag and not the role). Every other
  -- writer — a member's PATCH, a bulk edit, the FK's own action — is pinned back
  -- silently: nothing in the app sends these columns (src/api/entries.ts's
  -- toEntryRow/toEntryPatchRow name neither), so the only caller that can reach
  -- this branch is one that meant to, and refusing loudly would teach it which
  -- columns exist.
  --
  -- WHY nudged_by NEEDS THE SAME `case` AS created_by. `on delete set null`
  -- is implemented as an RI trigger that issues a plain UPDATE, and that UPDATE
  -- carries no nudge flag, so it lands squarely in this branch. An unconditional
  -- pin would restore the id the FK had just cleared, the FK's after-check would
  -- short-circuit on now-equal keys, and the delete would SUCCEED leaving a
  -- dangling reference Postgres still marks validated. That is R2-DB-1,
  -- discovered on `template_id`, and it would have been reintroduced here by
  -- three careless words.
  if coalesce(current_setting('opstrack.nudge_entry', true), '') is distinct from old.id::text then
    new.nudged_at := old.nudged_at;
    new.nudged_by := case
      when new.nudged_by is null and old.nudged_by is not null
       and not exists (select 1 from public.profiles p where p.id = old.nudged_by)
      then null
      else old.nudged_by
    end;
  end if;

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
  -- surface as the member's perfectly legitimate edit being rejected.
  --
  -- THE NUDGE COLUMNS ARE NOT SUBTRACTED HERE, and that is deliberate: a real
  -- nudge (which is the only write of them that survives the pin above) stamps
  -- `updated_by` with the asker, exactly as 0016 lets a handover stamp it. The
  -- row was genuinely written, the thread row names the same person, and the
  -- "updated by X" flash on the owner's screen (EntryRow.tsx:177) is the second
  -- half of being told. A member's rejected PATCH stamps nothing, because the
  -- pin has already restored both columns and the diff sees no change at all.
  -- 0019 — AND THIS `if` NEEDS A THIRD BRANCH, which is the second half of the
  -- defect PART 6 describes. `entries.updated_by` is `on delete set null` too,
  -- and the FK's own action — `update entries set updated_by = null where
  -- updated_by = $1` — changes ONLY the column both sides of this diff subtract.
  -- So it lands in the `else` every single time, where 0015's fix restored the
  -- id the FK had just cleared, the FK's after-check found the key present, and
  -- retiring a member who had last edited ANY entry failed with a hard 23503
  -- through the plain PostgREST door. Found live by PROBE 3 of this file.
  --
  -- Written as a third branch rather than as the `case` the two columns above
  -- use, so that the tail of the `else` stays literally `new.updated_by :=
  -- old.updated_by;`: src/lib/migrationContract.test.ts:211 pins that line, and
  -- it is the only automated guard this repo has over the erase hole, because
  -- nothing in `npm run test` can execute a probe. Same three cases either way —
  -- a real edit, the foreign key's own null-out, and everything else.
  if (to_jsonb(new) - 'updated_at' - 'last_activity_at' - 'updated_by')
     is distinct from
     (to_jsonb(old) - 'updated_at' - 'last_activity_at' - 'updated_by') then
    new.updated_by := coalesce(
      (select p.id from public.profiles p where p.id = auth.uid()),
      old.updated_by
    );
  elsif new.updated_by is null and old.updated_by is not null
    and not exists (select 1 from public.profiles p where p.id = old.updated_by) then
    -- The FK's action, not a client edit: the profile this named is gone. Leave
    -- NEW exactly as it arrived — null — and let the delete complete.
    null;
  else
    -- Never from the payload: subtracting updated_by from the diff and then
    -- leaving it alone handed a member a one-line `{"updated_by": null}` PATCH
    -- that erased the mark without changing anything else. 0014:176-179.
    new.updated_by := old.updated_by;
  end if;

  return new;
end;
$$;

-- Unchanged from 0004/0015/0016 and restated because `create trigger` is not
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
  'Pins created_at, closed_at, created_by, template_id, updated_by and (0019) nudged_at/nudged_by on a client UPDATE, and stamps updated_by from the JWT when anything else changed. The three `case` expressions let the foreign keys own `on delete set null` action through — pinning unconditionally (0004:554) reverted it and left dangling FKs, or a hard 23503, behind an admin''s delete. The nudge pair is exempt only for the statement that names its entry id in the transaction-local `opstrack.nudge_entry`, which nudge_entry() sets and clears around its own UPDATE: unpinned, one member''s PATCH made an item unnudgeable forever or erased the record that anyone had asked.';


-- ═══ PART 4 ═══ entries_touch(): being asked is not the owner answering
--
-- Body is 0016's, with `- 'nudged_at' - 'nudged_by'` added to the ACTIVITY diff
-- ONLY, and everything else carried through verbatim (create or replace rewrites
-- the whole body, so anything not repeated here would be silently dropped).
--
-- The same subtraction 0007 made for `updated_by` and 0016 made for the owner
-- pair, for the same reason and with a sharper consequence: `last_activity_at`
-- measures SILENCE. Asking for an update is not an answer to it. Without this
-- line the nudge stamp itself counts as activity, the item stops being stale the
-- instant it is chased, and it leaves Follow-ups until the staleness window
-- comes round again — so the one screen that exists to say "you asked and
-- nobody replied" would be the one screen that could never show it.
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
  -- …AND THE NUDGE PAIR (0019). Being chased is not being answered. This is the
  -- subtraction that lets nudge_entry() hand the pre-nudge value of
  -- last_activity_at back to the row after the thread row moved it: with the
  -- columns out of this diff the statement reads as "no real change", so the
  -- explicit value survives instead of being overwritten with now().
  if (to_jsonb(new) - 'updated_at' - 'last_activity_at' - 'updated_by'
                    - 'track_id' - 'owner_id' - 'owner_name'
                    - 'nudged_at' - 'nudged_by')
     is distinct from
     (to_jsonb(old) - 'updated_at' - 'last_activity_at' - 'updated_by'
                    - 'track_id' - 'owner_id' - 'owner_name'
                    - 'nudged_at' - 'nudged_by') then
    new.last_activity_at := now();
  end if;

  -- closed_at tracks the terminal statuses in both directions, so reopening an
  -- item clears it rather than leaving a stale close date on the dashboard.
  -- Unchanged from 0001/0002/0007/0016, and the ONLY writer of the column that a
  -- client can reach: PART 3 pins it against the payload, so what this block
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
  'BEFORE UPDATE on entries. Moves updated_at on any real column change and last_activity_at on any real column change other than a reassignment (track_id, owner_id, owner_name) or a nudge (nudged_at, nudged_by); maintains closed_at. updated_at, last_activity_at and updated_by are excluded from both diffs — they are the server''s own bookkeeping. 0007 exists because diffing updated_by let a pure track move reset the staleness clock; 0016 because a handover did the same; 0019 because the button that chases a neglected item would otherwise have been the fastest way to make it look attended to.';


-- ═══ PART 5 ═══ nudge_entry(): one tap, three writes, or nothing
--
-- SECURITY DEFINER, for two reasons that are both structural rather than
-- convenient:
--   * `notifications` has NO insert policy, deliberately (0004:195-224) — every
--     row in that table is written by the database at the moment the thing
--     happened, so a client cannot mint an inbox line out of nothing. This
--     function is now the second writer, and it earns the same exemption by
--     being the only path that also writes the thread row and the stamp.
--   * the nudge stamps are pinned against client roles (PART 3), and running as
--     the owner is exactly what distinguishes this writer from a PATCH.
--
-- `set search_path = public, pg_temp` — 0011's form rather than 0004's bare
-- `public`. Postgres searches pg_temp FIRST for tables unless the schema is
-- named explicitly, so pinning it last is what stops a caller who can create a
-- temp table from shadowing `entries` or `notifications` inside a function that
-- runs as the owner.
--
-- NO JWT-LESS PASSTHROUGH, which is a deliberate break from the house pattern.
-- Every other guard in this schema opens with `if auth.uid() is null then return`
-- so the SQL Editor, the service role and the scheduler can act. A nudge has no
-- meaning without a person: the notification would be attributed to nobody, the
-- thread row would have no author, and the rate limit would have nothing to
-- protect. So a JWT-less caller is refused like anyone else, and the probes set
-- `request.jwt.claims` rather than relying on a bypass.
create or replace function public.nudge_entry(p_entry uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor      uuid;
  v_actor_name text;
  v_owner      uuid;
  v_title      text;
  v_nudged     timestamptz;
  v_activity   timestamptz;
  -- now() is the TRANSACTION timestamp, so every clock this function writes and
  -- compares is the same instant. That is what makes "stamp it, then hand the
  -- old activity clock back" exact rather than approximately exact.
  v_now        timestamptz := now();
begin
  -- ── 1. is this a member, and who ────────────────────────────────────────
  -- Resolved THROUGH profiles, not raw from auth.uid(): both inserts below
  -- reference the actor, and a JWT without a profile row would fail their
  -- foreign keys with a 23503 the caller could do nothing about. This one query
  -- answers "may you?" and "who are you?" together — is_member() would ask the
  -- same table a second time.
  select p.id, coalesce(nullif(btrim(p.display_name), ''), '')
    into v_actor, v_actor_name
    from public.profiles p
   where p.id = auth.uid();

  if v_actor is null then
    raise exception 'nudge_not_a_member: only a signed-in member may ask for an update'
      using errcode = '42501';
  end if;

  -- ── 2. the entry, locked ────────────────────────────────────────────────
  -- `for update` is not decoration. Two taps on a slow connection, or two people
  -- chasing the same item in the same second, are two transactions that would
  -- both read `nudged_at is null`, both pass the rate limit and both notify. The
  -- lock makes the second one wait, and READ COMMITTED then re-reads the row it
  -- was waiting for — so it sees the first stamp and is refused by the rate
  -- limit below. The whole function is three statements long, so nothing waits
  -- on this lock for meaningfully longer than a round trip.
  select e.owner_id, e.title, e.nudged_at, e.last_activity_at
    into v_owner, v_title, v_nudged, v_activity
    from public.entries e
   where e.id = p_entry
   for update;

  if not found then
    -- The house code for "it was there when the screen loaded" — 0002 uses it
    -- for a track deleted by another session. PostgREST answers 404.
    raise exception 'nudge_entry_missing: that item no longer exists'
      using errcode = 'P0002';
  end if;

  -- ── 3. somebody has to be asked ─────────────────────────────────────────
  -- An unassigned item, or one owned by a free-text name (a vendor, another
  -- department — `entries_single_owner`, 0001:328), has no inbox to write to.
  -- `notifications.recipient_id` is `not null`, so without this the caller would
  -- get a raw 23502 and the UI a shrug. The right answer for those rows is to
  -- assign them, which Follow-ups already offers (R3-PRODUCT-5).
  if v_owner is null then
    raise exception 'nudge_no_owner: that item has nobody assigned to ask'
      using errcode = '22023';
  end if;

  -- ── 4. never yourself ───────────────────────────────────────────────────
  -- Being told you did the thing you just did is what mutes a notification
  -- system (0004:264). Being told to update yourself is worse: it is the one
  -- message that proves the app is not paying attention. Same errcode as the
  -- no-owner case, different token — pgErrorKey() switches on the token inside
  -- the code, exactly as it does for reassign_archived/reassign_self.
  if v_owner = v_actor then
    raise exception 'nudge_self: you own this item, so there is nobody to ask'
      using errcode = '22023';
  end if;

  -- ── 5. once a day, per item, from anybody ───────────────────────────────
  -- DETAIL carries the timestamp of the ask that is blocking this one, so the
  -- client can say "already asked 3 hours ago" from the error alone rather than
  -- trusting a possibly stale copy of the row — the blocking nudge is often
  -- somebody else's, sent since this screen loaded.
  --
  -- 'PT429' is PostgREST's own convention: a SQLSTATE of PTxxx sets the HTTP
  -- status to xxx, so this arrives as a real 429 rather than a 500. If that
  -- convention ever goes away the status degrades to 500 while `code` in the
  -- body stays 'PT429', so the client's mapping keeps working either way.
  if v_nudged is not null and v_nudged > v_now - interval '24 hours' then
    raise exception 'nudge_rate_limited: this item was already nudged in the last 24 hours'
      using errcode = 'PT429',
            detail  = to_char(v_nudged at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  end if;

  -- ── 6. the ask goes in the record FIRST ─────────────────────────────────
  -- Order matters and it is the opposite of the obvious one. This insert fires
  -- entry_updates_touch_entry() (0001:479), which bumps `last_activity_at` to
  -- now() unconditionally — so it has to happen BEFORE the update in step 7,
  -- which hands the pre-nudge value back.
  --
  -- `body` IS A TOKEN, NOT A SENTENCE, and that is a contract with the client.
  -- The thread renders `update.body` verbatim (UpdateThread.tsx:265,
  -- TrackTimeline.tsx:337), so an English sentence written here would appear
  -- untranslated in a fully-Arabic thread — this app has an Arabic-first user
  -- and every other string in it goes through t(). '[nudge]' is a marker the
  -- client maps to a localised line; a client that does not yet know it renders
  -- the token, which is ugly for one deploy but never wrong and never in the
  -- wrong language. A `kind` column on entry_updates would be tidier and costs
  -- four more files (types, api, export, timeline) plus a guard against members
  -- forging one — worth revisiting when a second machine-written update kind
  -- appears, and not before.
  insert into public.entry_updates (entry_id, author_id, body)
    values (p_entry, v_actor, '[nudge]');

  -- ── 7. the stamp, and the staleness clock put back ──────────────────────
  -- `last_activity_at = v_activity` is the load-bearing assignment in this
  -- function. entries_touch() sees this statement as "no real change" — PART 4
  -- subtracts both nudge columns from its activity diff — so the explicit value
  -- stands and the item is exactly as stale as it was a millisecond ago, which
  -- is the truth: nobody has answered. `updated_at` still moves and `updated_by`
  -- still becomes the asker, by the same trigger, on purpose (PART 3).
  --
  -- THE FLAG IS THE PERMISSION SLIP. entries_guard_update() pins nudged_at and
  -- nudged_by against every writer that has not named this exact entry id in
  -- `opstrack.nudge_entry` — which is every writer but this one. It is set as
  -- late as possible and cleared immediately after, so the exemption covers one
  -- statement on one row and nothing else in the transaction; `is_local => true`
  -- would discard it at commit regardless, which is what keeps it from surviving
  -- into the next request on a pooled connection.
  perform set_config('opstrack.nudge_entry', p_entry::text, true);

  update public.entries
     set nudged_at        = v_now,
         nudged_by        = v_actor,
         last_activity_at = v_activity
   where id = p_entry;

  perform set_config('opstrack.nudge_entry', '', true);

  -- ── 8. and the owner is told ────────────────────────────────────────────
  -- Same shape as entries_notify() (0004:348): entry_title and actor_name are
  -- SNAPSHOTS, so the inbox line stays readable after a retitle or after the
  -- asker's profile is deleted, while actor_id remains the durable identity the
  -- reader resolves the live name from (src/api/notifications.ts:46-54).
  --
  -- This insert fires notifications_enqueue_push_trg (0011:559), so the push
  -- path is inherited whole: no new sender, no new subscription, no new secret.
  insert into public.notifications
    (recipient_id, kind, entry_id, entry_title, actor_id, actor_name)
  values
    (v_owner, 'nudged', p_entry, v_title, v_actor, v_actor_name);

  -- The stamp, so the caller can render "asked just now" without a refetch.
  return v_now;
end;
$$;

-- A function in `public` is a PostgREST endpoint, so its grants are its access
-- control. PUBLIC and `anon` are revoked: the browser holds the anon key before
-- anybody signs in, and while step 1 would refuse such a call anyway, refusing it
-- at the privilege layer means the body never runs at all.
--
-- `service_role` KEEPS the EXECUTE that Supabase's default privileges give every
-- function in this schema — verified on the live ACL after applying, rather than
-- assumed: `postgres=X/postgres authenticated=X/postgres service_role=X/postgres`.
-- Revoking it would be a deviation that buys nothing, because a service-role JWT
-- carries no `sub`: auth.uid() is null, step 1 finds no profile, and the call is
-- refused with 42501. There is no server-side caller today in any case — nothing
-- in this app nudges on anyone's behalf.
revoke all on function public.nudge_entry(uuid) from public;
revoke all on function public.nudge_entry(uuid) from anon;
grant execute on function public.nudge_entry(uuid) to authenticated;

comment on function public.nudge_entry(uuid) is
  'Ask the owner of an entry for an update: stamps entries.nudged_at/nudged_by, appends an immutable entry_updates row with body ''[nudge]'', and inserts a notifications row of kind ''nudged'' for the owner — all three or none. Refuses a non-member (42501), an entry with no owner or your own entry (22023, tokens nudge_no_owner / nudge_self), an entry that has gone (P0002) and a second ask within 24 hours (PT429, DETAIL = the blocking timestamp). Returns the stamp. Deliberately does NOT move last_activity_at: chasing an item must not make it look attended to.';


-- ═══ PART 6 ═══ notifications_guard_update(): R2-DB-1, one table over
--
-- NOT A NUDGE FEATURE. This is a live defect that PROBE 3 of this file hit on
-- the first apply attempt, in the schema as it stood, and it sits directly on
-- the path this file adds writes to — so it is fixed here rather than left for
-- somebody to find as a support ticket.
--
--     ERROR 23503: insert or update on table "notifications" violates foreign
--     key constraint "notifications_actor_id_fkey"
--     CONTEXT: SQL statement "delete from public.profiles where id = …"
--
-- `notifications.actor_id` is `references profiles (id) on delete set null`
-- (0004:162). Postgres implements that action as an RI trigger issuing `update
-- notifications set actor_id = null where actor_id = $1`, and that UPDATE runs
-- under the DELETING SESSION — so `auth.uid()` is still the admin's and
-- notifications_guard_update() (0004:240-248) restores the id the FK had just
-- cleared. The FK's own after-check then sees the key still present and the
-- whole DELETE fails. Identical in mechanism to R2-DB-1 on `entries`, which 0015
-- fixed for `created_by` and `template_id`; this instance was missed because
-- 0015 was scoped to `entries` and to `meeting_lines`.
--
-- WHO THIS BITES. Not the Members screen: that goes through the admin-members
-- Edge Function (src/api/members.ts:274), whose service-role JWT carries no
-- `sub`, so auth.uid() is null and the guard takes its passthrough. It bites the
-- plain PostgREST door, which `profiles_delete` (0009:170) leaves open to every
-- admin holding the anon key — and it fails HARD rather than corrupting, which
-- is the better of the two failure modes and the reason nothing is dangling
-- today. Retiring anyone who has ever caused a notification simply does not
-- work through that door, and 0019 makes causing one strictly more common.
--
-- Body is 0004's, verbatim, with `actor_id` given the same `case` 0016 uses for
-- `created_by`. The other five pins keep their unconditional form on purpose:
-- `recipient_id` and `entry_id` are `on delete cascade` (0004:158, 0004:160), so
-- the row goes away rather than being updated and no RI update ever reaches this
-- trigger; `kind`, `entry_title` and `actor_name` are referenced by nothing.
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
    new.actor_name   := old.actor_name;
    new.created_at   := old.created_at;

    -- 0019 — the one pin that has to make an exception for the foreign key's own
    -- action. A NULL arriving on a column whose referent has just been deleted
    -- is not a recipient editing the evidence; it is `on delete set null`
    -- passing through on its way to the row. Everything else about the pin is
    -- unchanged: a recipient still cannot re-attribute a live actor, because
    -- that profile still exists and the `not exists` test is false.
    new.actor_id := case
      when new.actor_id is null and old.actor_id is not null
       and not exists (select 1 from public.profiles p where p.id = old.actor_id)
      then null
      else old.actor_id
    end;
  end if;
  return new;
end;
$$;

-- Unchanged from 0004 and restated because `create trigger` is not idempotent.
drop trigger if exists notifications_guard_update_trg on public.notifications;
create trigger notifications_guard_update_trg
  before update on public.notifications
  for each row execute function public.notifications_guard_update();

comment on function public.notifications_guard_update() is
  'Pins every column of a notification except read_at against a recipient''s own UPDATE — the recipient owns "I have read this" and nothing else. actor_id carries the R2-DB-1 exception added by 0019: pinned unconditionally, it reverted the FK''s `on delete set null` and a plain PostgREST DELETE of any member who had ever caused a notification failed with 23503.';


-- ═══ PROBE 1 ═══ the happy path: it stamps, it tells, it writes it down —
--                and the item is exactly as stale as it was
--
-- Everything below happens inside a subtransaction thrown away by a sentinel
-- exception — the 0007/0008/0012/0014/0015/0016/0017 pattern. No row survives,
-- and every scratch row is created here rather than borrowed, so the probe works
-- on an empty workspace and can never touch a real one.
--
-- Fixtures come in through auth.users and handle_new_user(), the way 0012's,
-- 0015's, 0016's and 0017's probes build theirs: profiles.id references
-- auth.users (id), so a synthetic profile id cannot be inserted at all.
--
-- THE ENTRY IS BACKDATED BY 30 DAYS ON PURPOSE. now() is fixed for the whole
-- transaction, so an entry inserted here would have last_activity_at = now() and
-- "the clock did not move" would be indistinguishable from "the clock was set to
-- now()" — the assertion would pass whether or not PART 4 exists. Backdating is
-- what gives it teeth. The insert happens BEFORE the claims are set, so
-- entries_guard_insert() takes its JWT-less passthrough (0015:311) and the
-- explicit clocks survive.
do $prove$
declare
  v_owner    uuid := gen_random_uuid();
  v_asker    uuid := gen_random_uuid();
  v_entry    uuid := gen_random_uuid();
  v_old      timestamptz := now() - interval '30 days';
  v_returned timestamptz;
  v_stamp    timestamptz;
  v_by       uuid;
  v_activity timestamptz;
  v_updated  timestamptz;
  v_editor   uuid;
  v_notes    int;
  v_kind     text;
  v_recip    uuid;
  v_nactor   uuid;
  v_ntitle   text;
  v_thread   int;
  v_body     text;
  v_author   uuid;
  v_pushed   int;
begin
  begin
    insert into auth.users (id, email, raw_user_meta_data) values
      (v_owner, 'probe-1-owner-' || v_owner || '@0019.invalid',
       jsonb_build_object('display_name', '0019 Probe Owner')),
      (v_asker, 'probe-1-asker-' || v_asker || '@0019.invalid',
       jsonb_build_object('display_name', '0019 Probe Asker'));

    if (select count(*) from public.profiles where id in (v_owner, v_asker)) <> 2 then
      raise exception 'OpsTrack 0019 PROBE 1 SETUP FAILED: handle_new_user() did not create the fixture profiles.';
    end if;

    insert into public.entries (id, title, owner_id, status, created_at, updated_at, last_activity_at)
      values (v_entry, '0019 probe: the thing nobody updated', v_owner, 'in_progress',
              v_old, v_old, v_old);

    -- Become the asker. auth.uid() reads request.jwt.claims ->> 'sub'; `true`
    -- makes the setting local to this transaction so it dies with the rollback.
    perform set_config('request.jwt.claims',
                       json_build_object('sub', v_asker)::text, true);

    v_returned := public.nudge_entry(v_entry);

    select e.nudged_at, e.nudged_by, e.last_activity_at, e.updated_at, e.updated_by
      into v_stamp, v_by, v_activity, v_updated, v_editor
      from public.entries e where e.id = v_entry;

    select count(*) into v_notes
      from public.notifications where entry_id = v_entry and kind = 'nudged';
    select n.kind, n.recipient_id, n.actor_id, n.entry_title
      into v_kind, v_recip, v_nactor, v_ntitle
      from public.notifications n where n.entry_id = v_entry order by n.id desc limit 1;

    select count(*) into v_thread from public.entry_updates where entry_id = v_entry;
    select u.body, u.author_id into v_body, v_author
      from public.entry_updates u where u.entry_id = v_entry order by u.created_at desc limit 1;

    -- The push path is inherited, not rebuilt — this only checks the handshake
    -- fired, not that anything was sent. Scoped to the NUDGE notification: the
    -- entry insert above already produced an 'assigned' one, which has an outbox
    -- row of its own.
    select count(*) into v_pushed
      from public.push_outbox o
      join public.notifications n on n.id = o.notification_id
     where n.entry_id = v_entry and n.kind = 'nudged';

    raise exception using errcode = 'OT019', message = 'probe rollback';
  exception
    when sqlstate 'OT019' then
      null; -- subtransaction discarded; the reads above survive
  end;

  if v_stamp is null or v_returned is distinct from v_stamp then
    raise exception
      'OpsTrack 0019 FAILED: nudge_entry() returned % and stored % in entries.nudged_at. The ask was not stamped, so no screen can say "asked N days ago".',
      coalesce(v_returned::text, 'NULL'), coalesce(v_stamp::text, 'NULL');
  end if;

  if v_by is distinct from v_asker then
    raise exception
      'OpsTrack 0019 FAILED: entries.nudged_by is % instead of the asker. The ask has nobody''s name on it.',
      coalesce(v_by::text, 'NULL');
  end if;

  -- THE ONE THAT MATTERS MOST.
  if v_activity is distinct from v_old then
    raise exception
      'OpsTrack 0019 FAILED: a nudge moved last_activity_at from % to %. Chasing a neglected item just made it look attended to: it stops being stale (health.ts:164), it drops off Follow-ups, it re-sorts to the top of the list (entryFilter.ts:270), and "asked 3 days ago, no reply" can never be shown. Check that PART 4 subtracts nudged_at/nudged_by from the ACTIVITY diff and that step 7 hands the old value back after the thread row moved it.',
      v_old, v_activity;
  end if;

  if v_updated <= v_old then
    raise exception
      'OpsTrack 0019 FAILED: updated_at is still % after a nudge. The row really was written, and the bookkeeping clock is supposed to say so.',
      v_updated;
  end if;

  if v_editor is distinct from v_asker then
    raise exception
      'OpsTrack 0019 FAILED: entries.updated_by is % after a nudge, expected the asker. The realtime "updated by X" flash (EntryRow.tsx:177) is the second half of being told.',
      coalesce(v_editor::text, 'NULL');
  end if;

  if v_notes <> 1 or v_kind is distinct from 'nudged' then
    raise exception
      'OpsTrack 0019 FAILED: % notification(s) of kind % for this entry, expected exactly one ''nudged''. If this is a CHECK violation the PART 2 widening did not run.',
      v_notes, coalesce(v_kind, 'NULL');
  end if;

  if v_recip is distinct from v_owner or v_nactor is distinct from v_asker then
    raise exception
      'OpsTrack 0019 FAILED: the notification went to % from % — expected owner % from asker %.',
      coalesce(v_recip::text, 'NULL'), coalesce(v_nactor::text, 'NULL'), v_owner, v_asker;
  end if;

  if v_ntitle is distinct from '0019 probe: the thing nobody updated' then
    raise exception
      'OpsTrack 0019 FAILED: the notification carries entry_title = %. The inbox line has to stay readable on its own (0004:150).',
      coalesce(quote_literal(v_ntitle), 'NULL');
  end if;

  if v_thread <> 1 or v_body is distinct from '[nudge]' or v_author is distinct from v_asker then
    raise exception
      'OpsTrack 0019 FAILED: the audit thread got % row(s), body %, author %. The ask has to be in the record, not only in somebody''s inbox — an inbox can be marked read, entry_updates cannot be edited or deleted at all (0001:416).',
      v_thread, coalesce(quote_literal(v_body), 'NULL'), coalesce(v_author::text, 'NULL');
  end if;

  -- A NOTICE AND NOT A FAILURE, deliberately. notifications_enqueue_push()
  -- (0011:538) wraps its own body in `exception when others`, so an unconfigured
  -- pg_net or a missing function URL discards the outbox row silently — a
  -- condition this file neither creates nor can fix, and one that must not stop
  -- an operator applying a migration about something else. Nudges are recorded,
  -- notified in-app and rate-limited whether or not a push ever leaves.
  if v_pushed <> 1 then
    raise notice
      'OpsTrack 0019 probe 1: % push_outbox row(s) queued for the nudge (expected 1). The in-app path is unaffected; check the push configuration (0011) if devices are supposed to be getting these.',
      v_pushed;
  end if;

  raise notice
    'OpsTrack 0019 probe 1: a nudge stamped nudged_at/nudged_by, wrote one ''nudged'' notification to the owner from the asker, appended one immutable [nudge] row to the audit thread, queued % push row(s) — and left last_activity_at 30 days old, so the item is still as stale as it really is. Rolled back.',
    v_pushed;
end
$prove$;


-- ═══ PROBE 2 ═══ the refusals, all five, each with its own code
--
-- Each attempt gets its own subtransaction so that a caught failure discards
-- only itself; the successful first nudge above it survives, which is what makes
-- the rate-limit case testable in a single transaction. now() being fixed for
-- the transaction is not a problem here — it is the point: the second ask is
-- necessarily "within 24 hours" of the first.
do $prove$
declare
  v_owner   uuid := gen_random_uuid();
  v_asker   uuid := gen_random_uuid();
  v_ghost   uuid := gen_random_uuid();
  v_entry   uuid := gen_random_uuid();
  v_orphan  uuid := gen_random_uuid();
  v_second  text;
  v_self    text;
  v_noowner text;
  v_missing text;
  v_stranger text;
  v_notes   int;
begin
  begin
    insert into auth.users (id, email, raw_user_meta_data) values
      (v_owner, 'probe-2-owner-' || v_owner || '@0019.invalid',
       jsonb_build_object('display_name', '0019 Probe Owner 2')),
      (v_asker, 'probe-2-asker-' || v_asker || '@0019.invalid',
       jsonb_build_object('display_name', '0019 Probe Asker 2'));

    insert into public.entries (id, title, owner_id) values
      (v_entry,  '0019 probe: rate limited', v_owner),
      -- Unassigned is a first-class state (0001:326-328), and it is the one
      -- shape with nobody to notify.
      (v_orphan, '0019 probe: nobody owns this', null);

    perform set_config('request.jwt.claims',
                       json_build_object('sub', v_asker)::text, true);

    -- The first ask must succeed, or every assertion below is vacuous.
    perform public.nudge_entry(v_entry);

    -- (a) a second ask inside the window
    begin
      perform public.nudge_entry(v_entry);
      v_second := 'NO ERROR';
    exception when others then
      v_second := sqlstate || ' ' || sqlerrm;
    end;

    -- (b) nudging an item with no owner
    begin
      perform public.nudge_entry(v_orphan);
      v_noowner := 'NO ERROR';
    exception when others then
      v_noowner := sqlstate || ' ' || sqlerrm;
    end;

    -- (c) an entry that is not there
    begin
      perform public.nudge_entry(gen_random_uuid());
      v_missing := 'NO ERROR';
    exception when others then
      v_missing := sqlstate || ' ' || sqlerrm;
    end;

    -- (d) the owner nudging himself
    perform set_config('request.jwt.claims',
                       json_build_object('sub', v_owner)::text, true);
    begin
      perform public.nudge_entry(v_entry);
      v_self := 'NO ERROR';
    exception when others then
      v_self := sqlstate || ' ' || sqlerrm;
    end;

    -- (e) a JWT whose subject has no profile — a deleted member's live session,
    -- or a token minted for somebody who was never provisioned.
    perform set_config('request.jwt.claims',
                       json_build_object('sub', v_ghost)::text, true);
    begin
      perform public.nudge_entry(v_entry);
      v_stranger := 'NO ERROR';
    exception when others then
      v_stranger := sqlstate || ' ' || sqlerrm;
    end;

    -- Exactly one ask got through all of that.
    select count(*) into v_notes
      from public.notifications where entry_id in (v_entry, v_orphan) and kind = 'nudged';

    raise exception using errcode = 'OT019', message = 'probe rollback';
  exception
    when sqlstate 'OT019' then
      null;
  end;

  if v_second not like 'PT429 nudge_rate_limited%' then
    raise exception
      'OpsTrack 0019 FAILED: a second nudge inside 24 hours returned "%" instead of PT429 nudge_rate_limited. The rate limit is the difference between a chase and a pile-on, and the client needs a code of its own to say "already asked N hours ago" rather than "something went wrong".',
      v_second;
  end if;

  if v_noowner not like '22023 nudge_no_owner%' then
    raise exception
      'OpsTrack 0019 FAILED: nudging an unassigned item returned "%" instead of 22023 nudge_no_owner. notifications.recipient_id is not null, so without the explicit refusal this reaches the user as a raw 23502.',
      v_noowner;
  end if;

  if v_missing not like 'P0002 nudge_entry_missing%' then
    raise exception
      'OpsTrack 0019 FAILED: nudging an entry that does not exist returned "%" instead of P0002 nudge_entry_missing.',
      v_missing;
  end if;

  if v_self not like '22023 nudge_self%' then
    raise exception
      'OpsTrack 0019 FAILED: the owner nudged his own item and got "%" instead of 22023 nudge_self. Telling somebody to chase themselves is the message that proves an app is not paying attention.',
      v_self;
  end if;

  if v_stranger not like '42501 nudge_not_a_member%' then
    raise exception
      'OpsTrack 0019 FAILED: a JWT with no profile row nudged and got "%" instead of 42501 nudge_not_a_member. Every write in this function references the actor; a caller who is not a member has no business reaching any of them.',
      v_stranger;
  end if;

  if v_notes <> 1 then
    raise exception
      'OpsTrack 0019 FAILED: % ''nudged'' notifications survived five refused asks and one accepted one, expected exactly 1. A refusal that still notifies is not a refusal.',
      v_notes;
  end if;

  raise notice
    'OpsTrack 0019 probe 2: refused a second ask inside 24h (PT429), an unassigned item (22023 nudge_no_owner), a missing entry (P0002), the owner nudging himself (22023 nudge_self) and a JWT with no profile (42501) — and exactly one notification exists. Rolled back.';
end
$prove$;


-- ═══ PROBE 3 ═══ a member cannot forge the stamp, and deleting the asker
--                still nulls the reference
--
-- This probe takes the REAL client path rather than a convincing imitation of
-- it: PostgREST's role, the member's JWT, an RPC called across that boundary,
-- and a DELETE that has to satisfy `profiles_delete`. The pin itself no longer
-- depends on the role — PART 3's flag is role-blind, which is exactly why the
-- first draft's `current_user` test failed here and this one does not — but the
-- grants, the RLS policies and the definer boundary do, and this is the only
-- probe in the file that exercises any of them.
--
-- If the role is not grantable to whoever is running this file, the probe says
-- so and SKIPS rather than failing the migration: the guard is installed either
-- way, and a false failure here would send an operator hunting a bug that is not
-- there. 0015's probe 3 and 0017's probe 3 make the same allowance for the same
-- reason.
--
-- The skip test is SCOPED TO THE ROLE SWITCH ALONE. An earlier draft of 0017
-- learned this the hard way: wrapping the whole client half in `exception when
-- insufficient_privilege` swallows a real RLS refusal and reports a broken
-- policy as "skipped".
do $prove$
declare
  v_admin    uuid := gen_random_uuid();
  v_owner    uuid := gen_random_uuid();
  v_asker    uuid := gen_random_uuid();
  v_entry    uuid := gen_random_uuid();
  v_stamp    timestamptz;
  v_forged   timestamptz;
  v_by       uuid;
  v_orphaned uuid;
  v_left     int;
  v_skipped  boolean := false;
begin
  begin
    insert into auth.users (id, email, raw_user_meta_data) values
      (v_admin, 'probe-3-admin-' || v_admin || '@0019.invalid',
       jsonb_build_object('display_name', '0019 Probe Admin')),
      (v_owner, 'probe-3-owner-' || v_owner || '@0019.invalid',
       jsonb_build_object('display_name', '0019 Probe Owner 3')),
      (v_asker, 'probe-3-asker-' || v_asker || '@0019.invalid',
       jsonb_build_object('display_name', '0019 Probe Asker 3'));

    -- handle_new_user() hardcodes 'member'; this write is the SQL-Editor path
    -- guard_profile_role() allows.
    update public.profiles set role = 'admin' where id = v_admin;

    insert into public.entries (id, title, owner_id)
      values (v_entry, '0019 probe: forged stamps', v_owner);

    perform set_config('request.jwt.claims',
                       json_build_object('sub', v_asker, 'role', 'authenticated')::text, true);

    begin
      set local role authenticated;
    exception when insufficient_privilege then
      v_skipped := true;
    end;

    if not v_skipped then
      -- The real client path, end to end: PostgREST's role, the member's JWT,
      -- and an RPC that has to write two columns that same member cannot.
      v_stamp := public.nudge_entry(v_entry);

      -- THE REQUEST: two columns, no RPC. Forward-dating nudged_at makes the
      -- item unnudgeable by anybody for 79 years; nulling it erases the record
      -- that anyone ever asked. RLS lets the statement run — ENTRIES_UPDATE_IS_OPEN
      -- is the app's trusted-team model — so it is the trigger that has to hold.
      update public.entries
         set nudged_at = timestamptz '2099-01-01 00:00:00+00',
             nudged_by = v_owner
       where id = v_entry;
      select e.nudged_at, e.nudged_by into v_forged, v_by
        from public.entries e where e.id = v_entry;

      -- …and now the FK's own action, issued the way an admin's PostgREST DELETE
      -- issues it. The pin must NOT revert this one, or the delete succeeds and
      -- leaves a dangling reference (R2-DB-1, 0015).
      perform set_config('request.jwt.claims',
                         json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
      delete from public.profiles where id = v_asker;

      select e.nudged_by into v_orphaned from public.entries e where e.id = v_entry;
      select count(*) into v_left
        from public.entries e
       where e.nudged_by is not null
         and not exists (select 1 from public.profiles p where p.id = e.nudged_by);

      reset role;
    end if;

    raise exception using errcode = 'OT019', message = 'probe rollback';
  exception
    when sqlstate 'OT019' then
      null;
  end;

  if v_skipped then
    raise notice
      'OpsTrack 0019 probe 3 SKIPPED: this role cannot `set role authenticated`, so the client half could not run. The pin IS installed. Verify by hand: PATCH /rest/v1/entries?id=eq.<id> with {"nudged_at":"2099-01-01"} as a member and re-read the row — nudged_at must be unchanged.';
    return;
  end if;

  if v_stamp is null then
    raise exception
      'OpsTrack 0019 FAILED: nudge_entry() returned NULL when called as `authenticated` — most likely EXECUTE is not granted to that role, since every other path raises rather than returning null.';
  end if;

  if v_forged is distinct from v_stamp then
    raise exception
      'OpsTrack 0019 FAILED: a member''s PATCH moved entries.nudged_at to %. One request now makes an item unnudgeable until 2099, or erases the record that anyone asked — the same defect 0016 fixed on closed_at, on a column whose whole job is being trustworthy.',
      v_forged;
  end if;

  if v_by is distinct from v_asker then
    raise exception
      'OpsTrack 0019 FAILED: a member''s PATCH rewrote entries.nudged_by to %. Attributing somebody else''s ask is worse than allowing none.',
      coalesce(v_by::text, 'NULL');
  end if;

  if v_orphaned is not null or v_left <> 0 then
    raise exception
      'OpsTrack 0019 FAILED: deleting the asker''s profile left entries.nudged_by = % (% dangling row(s) on the table). The pin is reverting the foreign key''s own `on delete set null`, so the DELETE succeeds and leaves a reference Postgres still marks validated — R2-DB-1, reintroduced.',
      coalesce(v_orphaned::text, 'NULL'), v_left;
  end if;

  raise notice
    'OpsTrack 0019 probe 3: as a real `authenticated` client the RPC stamped the ask, the same member''s direct PATCH of nudged_at/nudged_by was pinned back to it, and deleting the asker''s profile still nulled nudged_by with no dangling rows. Rolled back.';
end
$prove$;
