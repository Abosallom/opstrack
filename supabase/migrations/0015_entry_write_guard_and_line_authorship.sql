-- 0015 — three holes on the same seam: a column guard that only ever looked at
-- UPDATE, a guard that fought the foreign keys it was meant to protect, and a
-- meeting line anybody could quietly erase or reword with nobody's name on it.
--
-- Deploy: Supabase Dashboard -> SQL Editor -> paste + Run. Re-runnable from the
-- top in any state, same discipline as 0001-0014: `add column if not exists`,
-- `create or replace function` on unchanged signatures, `drop trigger if
-- exists` before `create trigger`, an idempotent repair statement, and four
-- self-verifying probe blocks at the bottom that roll themselves back.
--
-- ⚠ PENDING APPLICATION. This file has never been run: the Supabase management
-- token is revoked, so the fixer who wrote it could not apply it. Nothing in it
-- is live until the owner pastes it into the SQL Editor. The probes are how the
-- file proves itself at apply time; a failure raises and rolls back.
--
-- ⚠ APPLY IT AFTER 0014, which is the ordinary rule and worth restating because
-- this file is the SECOND to redefine `entries_guard_update()` (0004 is the
-- first) and the SECOND to redefine `meeting_lines_guard_update()` (0008 is the
-- first). Re-running 0004 or 0008 on their own afterwards silently reinstates
-- the defective bodies with no error. Re-run them IN ORDER, or re-run this one
-- after.
--
--
-- ═══ WHAT WAS WRONG ═══
--
-- ── R2-DB-1 — the guard reverted the foreign keys' own `on delete set null` ──
--
-- `entries.template_id` and `entries.created_by` are both declared `references
-- … on delete set null` (0001:325, 0001:319). Postgres implements that action
-- as an RI AFTER-DELETE trigger on the referenced table which runs, through
-- SPI, `update only public.entries set template_id = null where template_id =
-- $1`. That UPDATE fires user BEFORE-ROW triggers on `entries` — including
-- `entries_guard_update()`, whose only escape hatch is `auth.uid() is null`
-- (0004:547). SECURITY DEFINER and the RI role switch change the ROLE, not the
-- request: `auth.uid()` reads the `request.jwt.claims` GUC, which is still the
-- deleting admin's. So the early return was skipped and 0004:556's
-- `new.template_id := old.template_id` restored the value the FK action had
-- just cleared.
--
-- Nothing rechecked afterwards. `ri_set()` does not verify its own UPDATE, and
-- the AFTER-UPDATE FK-check trigger short-circuits because the keys are now
-- equal again. The DELETE therefore SUCCEEDED, silently, leaving `entries` rows
-- pointing at a `recurring_templates` row that no longer exists — a dangling
-- foreign key that Postgres still marks validated, which is why nothing on the
-- project reports it.
--
-- REPRODUCED on real Postgres (PG 18.3 via PGlite), schema copied from 0001:325
-- + 0004:540-589, the DELETE issued the way PostgREST issues it (`set_config
-- ('request.jwt.claims', …, true)` + `set local role authenticated` in the same
-- transaction). The admin's delete returned success and `entries.template_id`
-- still held the deleted template's id. The same delete with NO JWT correctly
-- nulled it — which isolates the cause to the skipped early return. Re-adding
-- the constraint the way `pg_restore` does then FAILED with `Key
-- (template_id)=(…) is not present in table "recurring_templates"`.
--
-- Two shipped promises were false because of it. `src/api/templates.ts:358-360`
-- — "The entries it already created SURVIVE with `template_id` set to null.
-- That is the FK's `on delete set null`" — and the confirmation dialog the admin
-- actually reads, `src/locales/en/recurring.json:107-108`: "The {count} items it
-- already created stay, and stop naming this schedule." They did not stop
-- naming it.
--
-- `created_by` had the identical defect with a THIRD failure mode on top. When
-- the departing member both OWNS and FILED an entry, 0012's BEFORE DELETE
-- trigger updates that row first (owner_id → null, owner_name → the preserved
-- name); the update makes the row's xmin current, which defeats the RI
-- equal-keys shortcut, so the FK check fires for real and the whole delete
-- HARD-FAILS with 23503 instead of corrupting quietly. 0012's own PROBE 3
-- misses it because its probe entry has `created_by` null. The shipped Members
-- screen does not hit any of this — it goes through the admin-members Edge
-- Function (src/api/members.ts:274), whose service-role JWT carries no `sub`,
-- so auth.uid() is null and the guard passes through — but the `profiles_delete`
-- policy (0009:170-172) is `is_admin()`, so the plain PostgREST door is open to
-- every admin with the anon key, which is exactly what 0012:157-162 warns about.
--
-- ── R2-DB-2 — the column guard was never installed on INSERT ────────────────
--
-- `entries_guard_update` is registered `before update` (0004:587-589) and the
-- only BEFORE INSERT trigger on the table is `entries_insert_trg` →
-- `entries_set_closed_at()` (0001:471-474), which touches `closed_at` and
-- nothing else. `entries_insert` is a row-level check and nothing more —
-- `is_member() and created_by = auth.uid()` (0001:365-366, restated 0009:76-77)
-- — and there is no column-level grant or revoke on `entries` anywhere in the
-- migration set, so Supabase's default table-wide grant to `authenticated`
-- stands and PostgREST accepts any column in an insert body.
--
-- So everything 0004:508-516 closed for UPDATE was open at capture time:
--
--   * `created_at`. `v_entry_health` derives BOTH `sla_due_at` and
--     `sla_breached` from `e.created_at + make_interval(days => …)`
--     (0006:233-243). A `POST /rest/v1/entries` carrying a future `created_at`
--     produces an item that can never breach — the exact erasure 0004:513-516
--     records as verified live, described there only for UPDATE.
--   * `last_activity_at`. `v_entry_health.health` computes 'stale' from
--     `current_date - last_activity_at::date` (0006:206, 0006:218-227), so a
--     future value defeats the staleness badge the same way.
--   * `template_id`. `materialize_due_recurring()` inserts `on conflict
--     (template_id, due_date) … do nothing` (0002:631-638) against
--     `entries_template_due_uidx` (0001:355-356). `recurring_templates_select`
--     is `is_member()` (0001:279-281), so any member can read `next_run_on` and
--     `lead_days`, compute the next occurrence's pair, and insert a squatter row
--     on it. The scheduler's insert is absorbed, `found` is false, and 0002:649
--     advances `next_run_on` regardless. The occurrence is skipped for good.
--     Give the squatter `status = 'cancelled'` and it is excluded from
--     `v_entry_health` and from the open set, so nothing on any screen shows it.
--   * `closed_at` and `updated_by`. Neither has a live consequence today —
--     `listClosedSince()` filters on status AND closed_at together
--     (src/api/entries.ts:224-232), so a forged close date on an open row
--     surfaces nowhere — and they are pinned here as belt-and-braces, not
--     because a reproduction exists.
--
-- The app itself is clean: `toEntryRow()` (src/api/entries.ts:401-421) sends
-- none of these five. This was purely a schema gap, reachable only by a crafted
-- PostgREST call from a member's own JWT — the same insider threat model 0004's
-- own guard and 0008 were written for.
--
-- ── R2-SEC-2 — a meeting line nobody could prove had ever said anything ─────
--
-- `meeting_lines_delete` is `created_by = auth.uid() or is_admin()` (0004:121),
-- justified at 0004:112: "Deleting someone else's line removes it from the
-- record with no trace, so it stays with the author (or an admin)." 0008 closed
-- the obvious bypass — rewrite `created_by`, then delete — by pinning
-- id/meeting_id/created_by/created_at, and stated at 0008:48 that "raw, parsed,
-- state, entry_id and seq" stay writable on purpose, because triage is
-- collaborative (0004:104-107).
--
-- `raw` writable by any member turns out to include writing it EMPTY, and an
-- empty line is not a blank line — it is a deleted one. `lineItem()`
-- (src/lib/minutes.ts:538-540) is `const text = cleanLine(line.raw); if (text
-- === '') return null`, and `buildMinutes()` routes every non-committed line
-- through it (src/lib/minutes.ts:355-367). The minutes model is the single
-- source for the on-screen document, the clipboard copy and the exported text,
-- so `PATCH /rest/v1/meeting_lines?id=eq.<a colleague's line>` with `{"raw":""}`
-- drops that sentence out of all three — achieving precisely what
-- `meeting_lines_delete` exists to forbid.
--
-- And the load-bearing half, which is larger than the empty-string case:
-- rewriting a colleague's line to say something DIFFERENT was already allowed
-- on purpose, and was equally unattributed. `meeting_lines` has no `updated_by`
-- column in any of the fourteen migrations and no audit trigger, while `entries`
-- got `updated_by` (0004:534-538) and `recurring_templates` got
-- created_by/updated_by plus whole-row `config_audit` history (0014) for the
-- near-identical "aim it at a colleague, then edit it back" threat.
-- `meeting_lines_touch()` moves `updated_at`, so the row shows that it changed
-- and nothing anywhere says who changed it or what it used to say.
--
-- Not reachable through the app — store/meetings.ts:821-822 rejects empty text
-- and MeetingLive.tsx:580 reverts a blank draft — so, again, a crafted
-- PostgREST call from a member's own JWT.
--
-- ── one more, unfiled, found while writing the above ────────────────────────
--
-- `entries_guard_update()` subtracts `updated_by` from its diff and then, when
-- the diff is empty, leaves NEW.updated_by exactly as the client sent it. So
-- `PATCH /rest/v1/entries?id=eq.<any row>` with `{"updated_by": null}` erases
-- the "who last wrote this row" stamp without changing anything else and
-- without moving a clock. 0014:176-179 closed the identical hole on
-- `recurring_templates` and says why; the same `else` branch is added below.


-- ═══ PART 1 ═══ entries_guard_update(): pin against clients, not against the
--               foreign keys
--
-- The shape is the finding's and it was validated against real Postgres before
-- it was written here: a client re-pointing `template_id` at another template
-- is still refused, a client PATCHing `template_id: null` while the template
-- still exists is still refused, and the FK's own null-out now lands, because
-- the only way `new.X is null` can coincide with `old.X` no longer existing is
-- that the referenced row was deleted in this very statement.
--
-- The one behaviour it adds beyond that: a member PATCHing `template_id: null`
-- on a row that is ALREADY dangling will now succeed and clean it up. That is
-- the correct outcome for a value that points at nothing.
--
-- Everything else about this function is 0004's — `create or replace` rewrites
-- the whole body, so anything not repeated here would be silently dropped.
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

-- Unchanged from 0004 and restated because `create trigger` is not idempotent.
-- BEFORE UPDATE, and it runs ahead of entries_touch(): Postgres fires BEFORE row
-- triggers in NAME order, and `entries_guard_update` sorts before
-- `entries_touch_trg`. That ordering is load-bearing — entries_touch() diffs the
-- row to decide whether to move the clocks, and it has to see the pinned values,
-- not the ones the client sent.
drop trigger if exists entries_guard_update on public.entries;
create trigger entries_guard_update
  before update on public.entries
  for each row execute function public.entries_guard_update();

comment on function public.entries_guard_update() is
  'Pins created_at, created_by, template_id and updated_by on a client UPDATE, and stamps updated_by from the JWT when anything else changed. The two `case` expressions let the foreign keys own `on delete set null` action through — pinning it unconditionally (0004:554-556) silently reverted it and left dangling FKs behind an admin''s delete.';


-- ═══ PART 2 ═══ the same guard, on INSERT
--
-- WHY A SECOND FUNCTION AND NOT `before insert or update`
-- The two branches share no line. An UPDATE guard pins NEW to OLD; an INSERT has
-- no OLD, so the job is to overwrite six columns with server-side values. A
-- single function with a `tg_op` fork reads as two functions in a trenchcoat,
-- and the trigger names are what orders them anyway.
--
-- WHY IT IS NOT `security definer`, unlike every other guard in this schema
-- This is the one function in the set that has to know WHO IS CALLING, and
-- SECURITY DEFINER would answer "the owner" every time and break the test
-- below. It reads nothing privileged, so INVOKER costs nothing.
--
-- THE `template_id` TEST IS THE CAREFUL PART, and the finding's prescription
-- ("if auth.uid() is not null then new.template_id := null") would have been a
-- catastrophe: `auth.uid()` is NOT null inside the materialisers. SECURITY
-- DEFINER changes the ROLE, not the request — 0014:163-166 says so out loud —
-- and BOTH writers of that column run under a member's JWT:
-- `materialize_due_recurring()` is called from store/auth.ts on every sign-in,
-- and `materialize_template()` is a button a member presses. Nulling the column
-- there would disarm `entries_template_due_uidx`, and the idempotency guard
-- 0001:352-356 exists for would stop working: every sign-in would mint a
-- duplicate entry for every due template.
--
-- What actually separates them is the ROLE. PostgREST does `set local role
-- authenticated` (or `anon`) for the request; a SECURITY DEFINER function owned
-- by the migration role runs its INSERT as that owner, so `current_user` inside
-- this trigger reads `postgres`, not `authenticated`. Verified on real Postgres
-- with the Supabase role set (authenticator -> set local role authenticated):
-- a direct client insert saw `authenticated`, the same member's call into a
-- definer materialiser saw `postgres`, and both probes below re-prove it here.
--
-- The list is an ALLOW-list of client roles rather than a deny-list of
-- privileged ones, so the failure polarity is right: if Supabase ever renames
-- these roles this guard quietly stops applying — the hole comes back and is
-- caught by review — whereas a deny-list that stopped recognising `postgres`
-- would start nulling `template_id` inside the scheduler and duplicate every
-- recurring item on every sign-in. Of the two ways to be wrong, only one of
-- them corrupts data.
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
  'Server-stamps created_at/updated_at/last_activity_at and clears closed_at/updated_by/template_id on an INSERT arriving from a PostgREST client role. entries_insert is row-level only, so before this a member could POST a future created_at (never breaches its SLA), a future last_activity_at (never goes stale), or squat entries_template_due_uidx on a future occurrence and make a recurring item silently skip. SECURITY INVOKER on purpose: current_user is the test that tells a client apart from a member-invoked materialiser.';


-- ═══ PART 3 ═══ meeting_lines: a line that remembers who last wrote it
--
-- Same column, same shape and same nullability as `entries.updated_by`
-- (0004:534-538) and `recurring_templates.updated_by` (0014). NULL means "not a
-- person" — the SQL Editor, the service role, commitMeetingLines()' server-side
-- paths — not "unknown".
alter table public.meeting_lines add column if not exists updated_by uuid
  references public.profiles (id) on delete set null;

comment on column public.meeting_lines.updated_by is
  'Who last wrote this line, stamped by meeting_lines_guard_update(). NULL for the SQL editor and the service role. created_by stays the author of the sentence; this is the answer to "who changed what it says".';

-- meeting_lines_touch(), with `updated_by` subtracted from its diff — 0007's
-- lesson applied before it can bite. The guard sorts first by name and writes
-- `updated_by` into NEW, so a diff that counted it would treat the stamp about
-- the write as evidence of the write. In practice the guard only ever stamps
-- alongside a real change, so this is belt-and-braces rather than a behaviour
-- change; 0007 is the cautionary tale for assuming that stays true.
create or replace function public.meeting_lines_touch()
returns trigger
language plpgsql
as $$
begin
  if (to_jsonb(new) - 'updated_at' - 'updated_by')
     is distinct from
     (to_jsonb(old) - 'updated_at' - 'updated_by') then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists meeting_lines_touch_trg on public.meeting_lines;
create trigger meeting_lines_touch_trg
  before update on public.meeting_lines
  for each row execute function public.meeting_lines_touch();

-- 0008's guard, with two additions. Body is 0008's verbatim apart from them,
-- because `create or replace` rewrites the whole function and the four pins are
-- what keep `meeting_lines_delete` enforceable.
--
-- SECURITY DEFINER is new here (0008's was INVOKER, because it read nothing).
-- It now resolves the actor through `profiles`, for the FK reason
-- log_config_audit() spells out at 0002:355: a JWT without a profile row would
-- violate the FK and the failure would surface as a member's perfectly
-- legitimate triage edit being rejected.
create or replace function public.meeting_lines_guard_update()
returns trigger
language plpgsql
security definer
set search_path = public
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
  if auth.uid() is null then
    return new;
  end if;

  new.id         := old.id;
  new.meeting_id := old.meeting_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;

  -- ADDITION 1 — blanking a line is deleting it, and delete is the author's.
  -- An empty `raw` is not a blank sentence in the minutes; lineItem() returns
  -- null for it (src/lib/minutes.ts:538-540) and the line leaves the document,
  -- the clipboard copy and the export. The product's own way to retire a line
  -- is `state = 'discarded'`, which the minutes deliberately KEEP (0004:65-68),
  -- and that stays writable by anyone. Silently pinning rather than raising,
  -- for the same reason the four pins above are silent: no app path can send an
  -- empty `raw` (store/meetings.ts:821-822, MeetingLive.tsx:580), so the only
  -- caller that can reach this is one that meant to.
  if btrim(new.raw) = '' and btrim(old.raw) <> '' then
    new.raw := old.raw;
  end if;

  -- ADDITION 2 — the line now names who last wrote it. Rewording somebody
  -- else's sentence stays allowed, because triage is collaborative
  -- (0004:104-107) and scoping it to the author makes a live meeting
  -- single-player; what changes is that it is no longer anonymous.
  --
  -- The `else` branch matters as much as the `if`: `updated_by` is never taken
  -- from the payload, or a one-line `{"updated_by": null}` PATCH would erase
  -- the mark without changing anything else (0014:176-179).
  if (to_jsonb(new) - 'updated_at' - 'updated_by')
     is distinct from
     (to_jsonb(old) - 'updated_at' - 'updated_by') then
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
  'Pins id, meeting_id, created_by, created_at and updated_by on a client UPDATE, refuses to blank a non-empty line, and stamps updated_by from the JWT on any other change. meeting_lines_update is deliberately any-member so triage is collaborative; this is what keeps meeting_lines_delete (author or admin) from being bypassed either by rewriting created_by first or by writing raw to the empty string, which drops the line out of the minutes entirely.';

-- ── the wording that was there before ───────────────────────────────────────
-- The column alone only ever holds the LATEST editor, which does not survive
-- "reword it, then reword it back". This is the same answer 0014 gave for
-- recurring_templates and for the same threat, narrowed to the one event worth
-- keeping: a change to `raw`.
--
-- DELIBERATELY NOT AUDITED, and both are judgement calls worth stating:
--   * state/entry_id/seq/parsed edits — that is ordinary triage, several per
--     line per meeting, and an audit table filled with "pending -> committed"
--     is one nobody reads.
--   * DELETE — `meeting_lines` cascades from `meetings` (0004:71), so auditing
--     deletes would write one whole-row image per line every time a meeting is
--     removed. Deleting a line you wrote is a sanctioned product decision
--     (0004:112-114) and 0008 closed the only bypass of it.
--
-- It does not call log_config_audit(), for the reason 0014:209-216 gives: that
-- function opens with `if auth.uid() is not null and not is_admin() then raise`
-- (0002:345-348), which is correct for the admin-only config tables and fatal
-- here, where every ordinary member writes. The properties it buys are
-- reproduced rather than borrowed — SECURITY DEFINER for the RLS exemption
-- (config_audit has no INSERT policy on purpose, 0002:312-325), `set
-- search_path = public` so a caller cannot shadow the table it writes, and the
-- actor resolved THROUGH profiles.
create or replace function public.meeting_lines_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.raw is distinct from old.raw then
    insert into public.config_audit (table_name, row_id, action, actor_id, before, after)
    values (
      'meeting_lines', old.id, 'update',
      (select p.id from public.profiles p where p.id = auth.uid()),
      to_jsonb(old), to_jsonb(new)
    );
  end if;
  return null;
end;
$$;

-- AFTER, not BEFORE: the row image recorded must be the one that survived every
-- other trigger — including the guard above, which is a BEFORE trigger and may
-- have put `raw` back. `return null` is correct for an AFTER ROW trigger; the
-- value is ignored.
drop trigger if exists meeting_lines_audit_trg on public.meeting_lines;
create trigger meeting_lines_audit_trg
  after update on public.meeting_lines
  for each row execute function public.meeting_lines_audit();

comment on function public.meeting_lines_audit() is
  'Appends a config_audit row with whole-row images when a meeting line''s text changes, and only then. Writes the row directly instead of calling log_config_audit(), whose is_admin() guard would reject every member write on this deliberately member-writable table. This is what survives "reword a colleague''s sentence, then reword it back".';


-- ═══ PART 4 ═══ the rows the old guard already broke
--
-- Runs with no JWT (the SQL Editor), so `entries_guard_update()` takes its
-- passthrough and these updates land. Idempotent: on a clean project both
-- statements match zero rows, and the notice says so.
--
-- `not exists` rather than `not in`: `not in` against a subquery containing a
-- NULL is null for every row, which would silently repair nothing.
do $repair$
declare
  v_tpl int;
  v_who int;
begin
  update public.entries e
     set template_id = null
   where e.template_id is not null
     and not exists (select 1 from public.recurring_templates t where t.id = e.template_id);
  get diagnostics v_tpl = row_count;

  update public.entries e
     set created_by = null
   where e.created_by is not null
     and not exists (select 1 from public.profiles p where p.id = e.created_by);
  get diagnostics v_who = row_count;

  if v_tpl = 0 and v_who = 0 then
    raise notice 'OpsTrack 0015 repair: no dangling entries.template_id or entries.created_by found. Nothing to fix.';
  else
    raise notice
      'OpsTrack 0015 repair: cleared % dangling entries.template_id and % dangling entries.created_by. These were rows an admin''s delete corrupted silently; a pg_dump/reload would have refused them.',
      v_tpl, v_who;
  end if;
end
$repair$;


-- ═══ PROBE 1 ═══ the FK's own null-out lands, and a client still cannot
--                re-point or clear template_id
-- Everything below happens inside a subtransaction that is thrown away by a
-- sentinel exception — the 0007/0008/0014 pattern. No row survives, and every
-- scratch row is created here rather than borrowed, so the probe works on an
-- empty workspace and can never touch a real one.
--
-- The member is minted here too, through `auth.users` and handle_new_user(),
-- the way 0012's probes build theirs. Borrowing "any existing profile" was the
-- first draft and it is a trap: on a project with no members yet the fallback
-- id has no profile row, the guard's `coalesce((select … from profiles), …)`
-- resolves to NULL, and every updated_by assertion passes vacuously.
do $prove$
declare
  v_me       uuid := gen_random_uuid();
  v_tpl_a    uuid := gen_random_uuid();
  v_tpl_b    uuid := gen_random_uuid();
  v_entry    uuid := gen_random_uuid();
  v_repoint  uuid;
  v_cleared  uuid;
  v_editor   uuid;
  v_erased   uuid;
  v_after    uuid;
  v_dangling int;
  v_failed   text := null;
begin
  begin
    insert into auth.users (id, email, raw_user_meta_data)
      values (v_me, 'probe-1-' || v_me || '@0015.invalid',
              jsonb_build_object('display_name', '0015 Probe Member'));
    if not exists (select 1 from public.profiles where id = v_me) then
      raise exception 'OpsTrack 0015 PROBE 1 SETUP FAILED: handle_new_user() did not create the fixture profile.';
    end if;

    insert into public.recurring_templates (id, title, cadence, next_run_on, lead_days, active)
      values (v_tpl_a, '0015 probe A', 'weekly', current_date, 0, false),
             (v_tpl_b, '0015 probe B', 'weekly', current_date, 0, false);
    insert into public.entries (id, title, template_id, due_date)
      values (v_entry, '0015 probe entry', v_tpl_a, current_date);

    -- Become a client. auth.uid() reads request.jwt.claims ->> 'sub'; `true`
    -- makes the setting local to this transaction so it dies with the rollback.
    perform set_config('request.jwt.claims',
                       json_build_object('sub', v_me)::text, true);

    update public.entries set template_id = v_tpl_b where id = v_entry;
    select template_id into v_repoint from public.entries where id = v_entry;

    update public.entries set template_id = null where id = v_entry;
    select template_id into v_cleared from public.entries where id = v_entry;

    -- A REAL edit, which is what puts an editor on the row. The two writes
    -- above changed nothing once the guard was done with them, so neither
    -- stamped anything — which is itself the correct behaviour and the reason
    -- this third statement has to exist.
    update public.entries set title = '0015 probe entry (edited)' where id = v_entry;
    select updated_by into v_editor from public.entries where id = v_entry;

    -- …and now the one-line PATCH that used to blank the mark without changing
    -- anything else.
    update public.entries set updated_by = null where id = v_entry;
    select updated_by into v_erased from public.entries where id = v_entry;

    -- …and now the FK action, issued exactly as PostgREST issues it: a DELETE
    -- with the member's claims still set. Captured rather than allowed to
    -- propagate: with the old unconditional pin this raises 23503 (the entry
    -- row's xmin is current after the updates above, which defeats the RI
    -- equal-keys shortcut), and a bare 23503 out of a migration is a worse
    -- diagnostic than the sentence below.
    begin
      delete from public.recurring_templates where id = v_tpl_a;
    exception when others then
      v_failed := sqlstate || ' ' || sqlerrm;
    end;
    select template_id into v_after from public.entries where id = v_entry;

    select count(*) into v_dangling
      from public.entries e
     where e.template_id is not null
       and not exists (select 1 from public.recurring_templates t where t.id = e.template_id);

    raise exception using errcode = 'OT015', message = 'probe rollback';
  exception
    when sqlstate 'OT015' then
      null; -- subtransaction discarded; the reads above survive
  end;

  if v_repoint is distinct from v_tpl_a then
    raise exception
      'OpsTrack 0015 FAILED: a member re-pointed entries.template_id (% -> %). The guard has stopped pinning.',
      v_tpl_a, v_repoint;
  end if;

  if v_cleared is distinct from v_tpl_a then
    raise exception
      'OpsTrack 0015 FAILED: a member cleared entries.template_id while the template still existed. The `not exists` test is too permissive.';
  end if;

  if v_editor is distinct from v_me then
    raise exception
      'OpsTrack 0015 FAILED: a member''s edit stored entries.updated_by = % instead of % — the stamp is not being written at all.',
      coalesce(v_editor::text, 'NULL'), v_me;
  end if;

  if v_erased is distinct from v_me then
    raise exception
      'OpsTrack 0015 FAILED: a bare {"updated_by": null} PATCH erased entries.updated_by (now %). The diff subtracts the column, so without the `else` branch the client''s value is simply stored.',
      coalesce(v_erased::text, 'NULL');
  end if;

  if v_failed is not null then
    raise exception
      'OpsTrack 0015 FAILED: deleting a recurring template raised %. entries_guard_update() is still pinning template_id against the FK''s own action.',
      v_failed;
  end if;

  if v_after is not null then
    raise exception
      'OpsTrack 0015 FAILED: deleting a recurring template left entries.template_id = %. The FK''s `on delete set null` is still being reverted (R2-DB-1) and the row is a dangling FK.',
      v_after;
  end if;

  if v_dangling <> 0 then
    raise exception
      'OpsTrack 0015 FAILED: % dangling entries.template_id rows after the delete.', v_dangling;
  end if;

  raise notice
    'OpsTrack 0015 probe 1: template_id held against a member''s re-point AND against a bare null, updated_by survived a bare erase, and the FK''s own null-out landed when the template was deleted. Rolled back.';
end
$prove$;


-- ═══ PROBE 2 ═══ retiring a member who both owns and filed an entry no longer
--                hard-fails, and 0012's preserved name still lands
-- This is the path 0012's PROBE 3 cannot see, because its scratch entry has
-- created_by null. With the old guard it raised 23503 and the admin's delete
-- was refused outright — the row 0012's BEFORE DELETE trigger has just updated
-- carries a current xmin, which defeats the RI equal-keys shortcut and makes
-- the FK check fire for real.
--
-- Fixtures come in through `auth.users` and handle_new_user(), the way 0012's
-- probes build theirs: `profiles.id` references `auth.users (id)` (0001:22), so
-- a synthetic profile id cannot be inserted at all.
do $prove$
declare
  v_admin  uuid := gen_random_uuid();
  v_leaver uuid := gen_random_uuid();
  v_name   text := '0015 Probe Leaver';
  v_entry  uuid := gen_random_uuid();
  v_owner  uuid;
  v_got    text;
  v_author uuid;
  v_failed text := null;
begin
  begin
    insert into auth.users (id, email, raw_user_meta_data) values
      (v_admin,  'probe-admin-'  || v_admin  || '@0015.invalid',
       jsonb_build_object('display_name', '0015 Probe Admin')),
      (v_leaver, 'probe-leaver-' || v_leaver || '@0015.invalid',
       jsonb_build_object('display_name', v_name));

    if (select count(*) from public.profiles where id in (v_admin, v_leaver)) <> 2 then
      raise exception 'OpsTrack 0015 PROBE 2 SETUP FAILED: handle_new_user() did not create the fixture profiles.';
    end if;

    -- handle_new_user() hardcodes 'member'; profiles_delete needs a real admin,
    -- and this write is the SQL-Editor path guard_profile_role() allows.
    update public.profiles set role = 'admin' where id = v_admin;

    -- Owned AND filed by the same leaver — the combination that hard-failed.
    insert into public.entries (id, title, owner_id, created_by)
      values (v_entry, '0015 probe owned+filed', v_leaver, v_leaver);

    -- Become that admin, exactly as PostgREST does.
    perform set_config('request.jwt.claims',
                       json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    set local role authenticated;

    begin
      delete from public.profiles where id = v_leaver;
    exception when others then
      v_failed := sqlstate || ' ' || sqlerrm;
    end;

    reset role;
    select owner_id, owner_name, created_by into v_owner, v_got, v_author
      from public.entries where id = v_entry;

    raise exception using errcode = 'OT015', message = 'probe rollback';
  exception
    when sqlstate 'OT015' then
      null;
  end;

  if v_failed is not null then
    raise exception
      'OpsTrack 0015 FAILED: deleting a member who owns AND filed an entry raised %. If that is 23503, entries_guard_update() is still pinning created_by against the FK action and the RI check fires on the row 0012 has just touched. If it is 42501, the role running this file simply cannot delete from profiles and the probe proved nothing — grant it and re-run.',
      v_failed;
  end if;

  if v_author is not null then
    raise exception
      'OpsTrack 0015 FAILED: entries.created_by still holds % after that profile was deleted — a dangling FK.', v_author;
  end if;

  if v_owner is not null or v_got is distinct from v_name then
    raise exception
      'OpsTrack 0015 FAILED: 0012''s owner_name handover broke (owner_id=%, owner_name=%).',
      coalesce(v_owner::text, 'NULL'), coalesce(quote_literal(v_got), 'NULL');
  end if;

  raise notice
    'OpsTrack 0015 probe 2: retiring a member who owned and filed the same entry succeeded, created_by went NULL, and the display name was preserved on the row. Rolled back.';
end
$prove$;


-- ═══ PROBE 3 ═══ the INSERT guard: a client cannot forge the clocks or squat
--                a recurring occurrence, and the materialiser is unaffected
--
-- The client half needs the ROLE, not just the JWT, so this is the one probe
-- that does `set local role authenticated`. If the role is not grantable to
-- whoever is running this file, the probe says so and skips that half rather
-- than failing the migration — the guard is still installed either way.
do $prove$
declare
  v_me       uuid := gen_random_uuid();
  v_tpl      uuid := gen_random_uuid();
  v_forged   uuid := gen_random_uuid();
  v_due      date := current_date + 30;
  v_skipped  boolean := false;
  v_created  timestamptz;
  v_activity timestamptz;
  v_closed   timestamptz;
  v_editor   uuid;
  v_tid      uuid;
  v_mat      uuid;
  v_mat_tid  uuid;
begin
  begin
    insert into auth.users (id, email, raw_user_meta_data)
      values (v_me, 'probe-3-' || v_me || '@0015.invalid',
              jsonb_build_object('display_name', '0015 Probe Capturer'));
    if not exists (select 1 from public.profiles where id = v_me) then
      raise exception 'OpsTrack 0015 PROBE 3 SETUP FAILED: handle_new_user() did not create the fixture profile.';
    end if;

    insert into public.recurring_templates (id, title, cadence, next_run_on, lead_days, active)
      values (v_tpl, '0015 probe template', 'weekly', current_date, 0, false);

    perform set_config('request.jwt.claims',
                       json_build_object('sub', v_me, 'role', 'authenticated')::text, true);

    -- (a) the member-invoked materialiser. Called BEFORE the role switch, which
    -- is what the app does too: SECURITY DEFINER runs it as the owner.
    v_mat := public.materialize_template(v_tpl, false);
    select template_id into v_mat_tid from public.entries where id = v_mat;

    -- (b) a raw client insert, with every guarded column forged. The role
    -- switch gets a sub-block of its own so that a 42501 from the switch is a
    -- skip, while a 42501 from the INSERT — an RLS refusal, which would mean
    -- the probe never tested anything — still fails the migration loudly.
    begin
      set local role authenticated;
    exception when insufficient_privilege then
      v_skipped := true;
    end;

    if not v_skipped then
      insert into public.entries
        (id, title, created_by, created_at, last_activity_at, closed_at, updated_by, template_id, due_date)
      values
        (v_forged, '0015 probe forged', v_me,
         now() + interval '400 days', now() + interval '400 days',
         now(), v_me, v_tpl, v_due);

      select created_at, last_activity_at, closed_at, updated_by, template_id
        into v_created, v_activity, v_closed, v_editor, v_tid
        from public.entries where id = v_forged;

      reset role;
    end if;

    raise exception using errcode = 'OT015', message = 'probe rollback';
  exception
    when sqlstate 'OT015' then
      null;
  end;

  if v_mat_tid is distinct from v_tpl then
    raise exception
      'OpsTrack 0015 FAILED: materialize_template() under a member JWT stored template_id = % instead of %. entries_guard_insert() is nulling the column inside the materialisers, which disarms entries_template_due_uidx and will duplicate every recurring item on every sign-in. FIX THIS BEFORE USING THE APP.',
      v_mat_tid, v_tpl;
  end if;

  if v_skipped then
    raise notice
      'OpsTrack 0015 probe 3: the materialiser half passed; the client half was SKIPPED because this role cannot `set role authenticated`. Verify the guard by hand: POST /rest/v1/entries with a future created_at and check it comes back as now().';
    return;
  end if;

  if v_created > now() then
    raise exception
      'OpsTrack 0015 FAILED: a client insert kept created_at = %, which is in the future. v_entry_health derives sla_due_at from it, so that item can never breach its SLA.',
      v_created;
  end if;

  if v_activity > now() then
    raise exception
      'OpsTrack 0015 FAILED: a client insert kept last_activity_at = %. That item can never go stale.', v_activity;
  end if;

  if v_closed is not null or v_editor is not null then
    raise exception
      'OpsTrack 0015 FAILED: a client insert kept closed_at = % / updated_by = %.', v_closed, v_editor;
  end if;

  if v_tid is not null then
    raise exception
      'OpsTrack 0015 FAILED: a client insert kept template_id = %. A member can squat entries_template_due_uidx on a future occurrence and the scheduler will skip it silently.',
      v_tid;
  end if;

  raise notice
    'OpsTrack 0015 probe 3: a client insert had created_at, last_activity_at, closed_at, updated_by and template_id overwritten server-side, and the same member''s call into materialize_template() kept its template_id. Rolled back.';
end
$prove$;


-- ═══ PROBE 4 ═══ a meeting line cannot be blanked out of the minutes, can
--                still be reworded, and now says who did it
do $prove$
declare
  v_me      uuid := gen_random_uuid();
  v_meet    uuid := gen_random_uuid();
  v_line    uuid := gen_random_uuid();
  v_said    text := 'Ahmed owns the delayed migration';
  v_blanked text;
  v_reword  text;
  v_editor  uuid;
  v_author  uuid;
  v_audit   int;
  v_before  text;
  v_state   text;
  v_erased  uuid;
begin
  begin
    insert into auth.users (id, email, raw_user_meta_data)
      values (v_me, 'probe-4-' || v_me || '@0015.invalid',
              jsonb_build_object('display_name', '0015 Probe Editor'));
    if not exists (select 1 from public.profiles where id = v_me) then
      raise exception 'OpsTrack 0015 PROBE 4 SETUP FAILED: handle_new_user() did not create the fixture profile.';
    end if;

    insert into public.meetings (id, title) values (v_meet, '0015 probe meeting');
    -- created_by left NULL on purpose, the way 0008's probe does: it is a FK to
    -- profiles and a probe that needed two real members could not run on a
    -- fresh project. NULL is the stronger witness anyway — "null became the
    -- caller's id" is the exact steal the pin exists to stop.
    insert into public.meeting_lines (id, meeting_id, seq, raw, state)
      values (v_line, v_meet, 1, v_said, 'pending');

    perform set_config('request.jwt.claims',
                       json_build_object('sub', v_me)::text, true);

    -- (a) the erasure
    update public.meeting_lines set raw = '' where id = v_line;
    select raw into v_blanked from public.meeting_lines where id = v_line;

    -- (b) the legitimate triage edit, which must still work
    update public.meeting_lines set raw = 'Sara owns the delayed migration' where id = v_line;
    select raw, updated_by, created_by into v_reword, v_editor, v_author
      from public.meeting_lines where id = v_line;

    select count(*), max(before ->> 'raw') into v_audit, v_before
      from public.config_audit
     where table_name = 'meeting_lines' and row_id = v_line;

    -- (c) the stamp must not be erasable on its own
    update public.meeting_lines set updated_by = null where id = v_line;
    select updated_by, state into v_erased, v_state from public.meeting_lines where id = v_line;

    raise exception using errcode = 'OT015', message = 'probe rollback';
  exception
    when sqlstate 'OT015' then
      null;
  end;

  if v_blanked is distinct from v_said then
    raise exception
      'OpsTrack 0015 FAILED: a member blanked a colleague''s meeting line (raw is now %). lineItem() drops an empty line, so that sentence is gone from the minutes, the clipboard copy and the export — which is what meeting_lines_delete exists to forbid.',
      coalesce(quote_literal(v_blanked), 'NULL');
  end if;

  if v_reword is distinct from 'Sara owns the delayed migration' then
    raise exception
      'OpsTrack 0015 FAILED: the guard blocked a legitimate triage edit (raw = %). Collaborative triage is broken.', v_reword;
  end if;

  if v_editor is distinct from v_me then
    raise exception
      'OpsTrack 0015 FAILED: rewording a line stored updated_by = % instead of the member who did it (%).', v_editor, v_me;
  end if;

  if v_author is not null then
    raise exception
      'OpsTrack 0015 FAILED: a member took authorship of a line (created_by = %).', v_author;
  end if;

  if coalesce(v_audit, 0) <> 1 or v_before is distinct from v_said then
    raise exception
      'OpsTrack 0015 FAILED: the reword left % config_audit rows (before = %). "Reword it, then reword it back" is still unrecoverable.',
      coalesce(v_audit, 0), coalesce(quote_literal(v_before), 'NULL');
  end if;

  if v_erased is distinct from v_me then
    raise exception
      'OpsTrack 0015 FAILED: a bare {"updated_by": null} PATCH erased the stamp (updated_by = %).', v_erased;
  end if;

  raise notice
    'OpsTrack 0015 probe 4: a colleague''s line survived a blanking PATCH, a reword still worked and now names its editor, the previous wording is in config_audit, and the stamp could not be erased on its own. Rolled back.';
end
$prove$;
