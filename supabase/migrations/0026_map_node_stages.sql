-- 0026 — where each organization has got to: the stage ladder, and the row that
-- says which rung an organization is on.
--
-- WHAT THIS IS
-- 0023 gave the map a hierarchy and 0024 gave each node a use-case scorecard.
-- Neither can answer the one question the whole 400-org rollout is judged on:
-- "where is Riyadh General?" — not which capabilities are flowing, but which
-- rung of the onboarding ladder the organization itself is standing on. This
-- file adds that ladder (`map_node_stages`) and the row that records a node's
-- position on it (`map_node_progress`).
--
--
-- ═══ WHY THE STAGE IS A ROW IN A SIDE TABLE AND NOT A COLUMN ON map_nodes ═══
--
-- The obvious shape is `map_nodes.stage_id`. It is the wrong one HERE, and the
-- reason is a decision about people rather than a fact about schemas.
--
-- The three account managers who move organizations along this ladder are
-- MEMBERS. They report to the senior experts; they are not Directors and they
-- do not hold `structure.edit`. Putting the stage on `map_nodes` would mean one
-- of three things, and all three are bad:
--
--   1. Widen `map_nodes_update` to `is_member()`. RLS policies are OR'd, so this
--      does not give members "the stage column" — it gives them EVERY column,
--      including `parent_id`. The tree becomes member-writable to buy one field.
--   2. Give the AMs `structure.edit`. That is a real option and it is Aziz's to
--      take, but it hands three people the whole shape of the programme —
--      tracks, groups, the node tree, the kind catalogue — in exchange for a
--      dropdown.
--   3. A `security definer` RPC. THIS ONE LOOKS RIGHT AND IS NOT.
--      `security definer` changes the ROLE, not the JWT claims GUC, so
--      `auth.uid()` inside the function is still the member's. The write would
--      fire `map_nodes_audit_trg` → `log_config_audit()` (0025:1847), whose
--      guard raises 42501 when `auth.uid()` is non-null and the caller holds
--      none of the four configuration keys. A legitimate stage change would roll
--      back the entire statement with a permission error blamed on the wrong
--      thing.
--
-- So the stage VALUE lives on `map_node_progress`, a member-writable side table
-- whose RLS is `map_node_use_cases`' RLS verbatim (0024:430) — and for
-- 0024's stated reason: THE ADMIN OWNS THE SHAPE, THE TEAM OWNS THE FIELDWORK.
-- Which organizations exist is configuration. Where one of them got to this week
-- is a record of work, and the person who did the work has to be able to write
-- it without asking anybody.
--
-- The stage LIST is the other half of that sentence and stays with the owner:
-- `map_node_stages` is member-read, `structure.edit`-write, audited, and its
-- reorder RPC is guarded the same way. Renaming a rung or adding one changes
-- what every count in the portfolio MEANS; recording that Riyadh General reached
-- Testing/UAT does not.
--
--
-- ═══ NO config_audit TRIGGER ON map_node_progress, AND IT IS DELIBERATE ═══
--
-- `map_node_stages` IS audited — it is configuration, changed rarely by one
-- person with nobody watching, which is the case `config_audit` exists for.
-- `map_node_progress` is NOT, and the omission is 0024:544's argument applied to
-- the same kind of table: this is day-to-day fieldwork by three account
-- managers, and auditing it would produce a configuration trail dominated by
-- routine data entry, which is how an audit log stops being read. `entries` is
-- not audited there either, for the same reason.
--
-- The cost is named rather than hidden: "when did Riyadh General leave
-- Integrating" is NOT free here the way it would have been on `map_nodes`
-- (where `map_nodes_audit()` would have carried the before-image for nothing).
-- `stage_changed_at` answers "how long has it been where it is", which is the
-- question the Stalled lens actually asks; the full ladder history is not
-- recorded, and if it is ever wanted it is a `map_node_progress_history` table,
-- not a trigger bolted onto this one.
--
--
-- ═══ THERE IS NO BACKFILL, AND THAT IS THE DECISION ═══
--
-- This file writes ZERO rows into `map_node_progress`. Not one `update`, not one
-- `insert … select` over `map_nodes`. After it applies, all 400 imported
-- organizations have no progress row at all.
--
-- That is not an omission and it is the single thing a reviewer is most likely
-- to read as one, so it is stated first: a seeded default would have the
-- database assert a fact nobody stated. "Not started" is a rung an account
-- manager LOOKED at an organization and chose; no progress row means NOBODY HAS
-- SAID ANYTHING YET. On day one every one of the 400 is the second, and the
-- first number the directors want is "how many has nobody even looked at" — a
-- number that only exists while the two states are distinct. Seeding them all to
-- "Not started" would destroy it on the way in.
--
-- It would also stamp 400 `stage_changed_at` values dated to the deploy, which
-- poisons time-in-stage for the entire imported cohort for as long as those rows
-- live: every organization would read as "in this stage since the day we
-- deployed", and the Stalled lens' first month would be uniformly wrong.
--
-- This is 0003's call about `sla_days` word for word — SLA is OFF until an admin
-- turns it on, because a seeded default reports every critical item older than a
-- day as a missed commitment against a target nobody set — and 0003 deliberately
-- ships no backfill either. Probe 1 asserts the absence rather than trusting it.
--
-- The supported way to land 400 starting positions in bulk is the importer's
-- `stage` column and a re-import, WHICH IS UNDOABLE THROUGH THE MANIFEST. An
-- `update` statement in a migration is not.
--
-- For the same reason the seed sets `expected_days` on NO row. A stalled
-- threshold nobody chose is a number the app would then chase people with.
--
--
-- ═══ NO COLOUR COLUMN ON map_node_stages ═══
--
-- 0023:150 already refused one on `map_node_kinds` and the reason is stronger
-- here, not weaker. Colour on this map means TRACK at every depth; the map has
-- spent its two visual variables (size-for-count and the breach mark); and a
-- stage ladder is ORDERED, so its natural encoding is POSITION — how far along
-- the row sits — not hue. A reader cannot decode three simultaneous encodings on
-- one glyph.
--
-- The escape hatch is named so that adding one later is a decision and not a
-- discovery: a stage colour costs a `color` column on `tracks_color_chk`'s
-- regex, a ninth `SWATCHES` row in TrackEditor.tsx, a `--swatch-*` pair in
-- global.css and a contrast.test.ts entry. That is its own sitting. Probe 1
-- fails the migration if a colour column appears, so it stays a conversation.
--
--
-- ═══ TWO SUBTLETIES ABOUT THE STAMP, BOTH OF WHICH LOOK LIKE TRIVIA ═══
--
-- ① THE TRIGGER IS THE ONLY WRITER OF `stage_changed_at`. Not "the trigger
--    normally writes it" — the only writer. On INSERT it is set from the stage
--    (or forced to null when there is none); on UPDATE it is re-stamped only
--    when the stage actually changed, nulled when the stage is cleared, and
--    otherwise PINNED BACK TO THE OLD VALUE. A client that sends a
--    `stage_changed_at` is not rejected, it is overruled — which is 0024's
--    "unrepresentable rather than merely detected" discipline applied to a
--    timestamp. Probe 2 sends deliberately wrong values and asserts they did not
--    survive; that is the assertion, not "the column is not null".
--
-- ② THE TRIGGER NAMES ARE LOAD-BEARING. Postgres fires BEFORE ROW triggers in
--    NAME order (0023:566 says so about `map_nodes_archive_stamp_trg`). Here:
--
--        map_node_progress_stage_stamp_trg   <   map_node_progress_touch_trg
--
--    's' sorts before 't', so the stamp lands before the touch diff runs and the
--    diff therefore sees the FINAL `stage_changed_at` rather than the one the
--    client sent.
--
--    ⚠ THE CASE THIS PROTECTS IS THE NO-OP, NOT THE STAGE CHANGE, and getting
--      that backwards is how somebody talks themselves into renaming a trigger.
--      On a real stage change the order is irrelevant: the touch diff compares
--      `stage_id` itself, which moved, so `updated_at` moves either way. On a
--      NO-OP SAVE it decides everything. A client PATCHes the stage the node
--      already holds and rides a bogus `stage_changed_at` along with it (the
--      shape of every save-on-blur screen that echoes back the row it read). If
--      the touch ran first it would see that bogus value in NEW, call it a
--      change, move `updated_at` and rewrite `updated_by` — and only then would
--      the stamp pin `stage_changed_at` back to OLD, leaving a row that was
--      "edited" by somebody who changed nothing. With the stamp first, the diff
--      sees a row identical to the one on disk and the whole write is inert.
--      Probe 4 asserts the behaviour; probe 1 asserts the ordering by reading
--      both names out of `pg_trigger` and comparing them, so the property is
--      checked rather than assumed.
--
--
-- ═══ WHAT THIS FILE DOES NOT REDEFINE ═══
--
-- 0026 ADDS. It restates nothing. `map_nodes_touch()`, `map_nodes_audit()`,
-- `is_admin()`, `has_perm()`, `is_member()`, `log_config_audit()` and all
-- twenty-one policies 0025 owns are CALLED here and defined nowhere here. That
-- is what keeps 0025's probe 5 half A green and leaves the `w_0025` / `f_0025`
-- reversion canary in docs/PENDING-MIGRATIONS.md unchanged after this file runs.
-- If a later cut of this file finds itself typing `create or replace function
-- public.map_nodes_touch`, the change belongs in 0025 or in a 0028, never here.
--
-- Note what follows from that: `map_nodes` gains NO column in this file, so its
-- `to_jsonb` touch and audit diffs are untouched, its localStorage row shape is
-- untouched, and the importer's fixed-column boundary is untouched.
--
--
-- ═══ THE TOKEN CONTRACT WITH src/lib/pgError.ts ═══
--
-- Every runtime `raise` below carries a `token:` prefix, and the TOKEN — not the
-- SQLSTATE — is what pgError.ts matches to an i18n key. Renaming one here
-- silently demotes a precise sentence to the generic `common.error`, so this
-- list is the handshake and both files have to be edited together:
--
--   map_node_stage_reorder_denied   reorder_map_node_stages() refusing a caller
--                                   who does not hold structure.edit, so the
--                                   admin screen says "you cannot reorder the
--                                   ladder" instead of reporting zero rows moved
--                                   as a successful drag
--
-- Plus the INDEX and CONSTRAINT names pgError.ts matches DIRECTLY, which is why
-- none of them may be renamed casually:
--
--   map_node_stages_name_uidx            → mapadmin.errStageNameTaken
--   map_node_stages_name_ar_uidx         → mapadmin.errStageNameArTaken
--   map_node_stages_expected_days_chk    → mapadmin.errStageExpectedDays
--   map_node_stages_name_len_chk         → mapadmin.errStageNameLength
--   map_node_stages_name_ar_len_chk      → mapadmin.errStageNameArLength
--   map_node_progress_stage_chk          → mapadmin.errStageStampMismatch
--                                          (unreachable through the app: the
--                                          stamp trigger keeps both sides in
--                                          agreement. It is the backstop for a
--                                          direct SQL write with the trigger
--                                          disabled, and it must still say
--                                          something rather than common.error.)
--   map_node_progress_pkey               → mapadmin.errStageAlreadyRecorded
--                                          23505, AND IT IS THE ERROR THE
--                                          ACCOUNT MANAGERS ARE LIKELIEST TO
--                                          MEET. `node_id` is the primary key,
--                                          so a plain INSERT against a node that
--                                          already has a progress row — two AMs
--                                          on the portfolio at once, the second
--                                          one's 30-second refetch not yet
--                                          landed — raises 23505 naming this
--                                          constraint. THE WRITE PATH MUST BE
--                                          `.upsert(row, { onConflict:
--                                          'node_id' })`, NEVER `.insert(row)`:
--                                          the upsert path is a complete no-op
--                                          when nothing changed (PostgREST's
--                                          `do update set` fires the BEFORE
--                                          UPDATE arm, where the stamp's
--                                          `is distinct from` guard and the
--                                          touch's else arm both hold — probe 4
--                                          asserts exactly that). The arm exists
--                                          for the tab that got it wrong anyway,
--                                          because E4's "optimistic write + undo
--                                          toast, no dialog" degrades to an
--                                          unexplained failure otherwise.
--   map_node_progress_node_id_fkey       → mapadmin.errNodeGone (23503: a stale
--                                          tab recording a stage against a
--                                          branch a colleague just deleted)
--   map_node_progress_stage_id_fkey      → mapadmin.errStageGone (23503: the same
--                                          race against a retired rung)
--
-- The probe blocks raise with a `NphiesCore 0026 FAILED:` prefix instead. Those
-- are apply-time refusals read by whoever is running the file, never by a
-- client, and they are deliberately NOT tokens.
--
--
-- ═══ WHAT THE CLIENT WAVE MUST LAND BEFORE THIS FILE IS RUN ═══
--
-- The pgError arms above, the `stages` locale namespace carrying those six keys
-- in EN and AR, `MapNodeStage` / `MapNodeProgress` in src/types.ts, the two
-- store reads and their cache keys (`nphiescore_map_node_stages_v1`,
-- `nphiescore_map_node_progress_v1`), and the RPC call spelled
-- `rpc('reorder_map_node_stages', { p_ids })` — BY ARGUMENT NAME, because that
-- is how PostgREST resolves a function and a drifted name is a 404 the first
-- time somebody drags a rung, months after both halves were reviewed and found
-- correct on their own. Probe 1 checks the argument name for exactly that
-- reason.
--
--
-- ═══ APPLY IT TWICE, IN TWO SITTINGS ═══
--
-- Supabase Dashboard → SQL Editor → paste + Run. READ THE NOTICES. Then paste
-- and Run THE SAME FILE AGAIN, and read them again.
--
-- The second run must be a complete no-op that still passes every probe: the
-- table creates skip, every column add skips, every constraint and policy and
-- trigger is dropped and recreated identically, every function is replaced with
-- itself, and the seed's `on conflict … do nothing` inserts nothing. That is
-- what makes "apply it twice" a real test rather than a formality (0018:356) —
-- and it is what makes the fix-and-re-run loop free if a probe does fail.
--
-- Re-runnable from the top in any partial state, same discipline as 0001–0025:
-- `create table if not exists` PLUS a separate `add column if not exists` per
-- column (0017:129 / 0018:136 — for a project where an earlier cut of this file
-- already landed), `drop constraint if exists` before every add, `drop policy if
-- exists` before every create, `drop trigger if exists` before every create,
-- `create or replace` on every function, guarded seeds, `revoke` from
-- public/anon plus `grant execute` to authenticated on the RPC, and probe blocks
-- at the bottom that roll their fixtures back through the `OT026` sentinel. A
-- probe failure raises and the whole migration rolls back — no explicit
-- begin/commit here, for the reason 0009's header spells out.


-- ── preflight: 0023 and 0025 first ──────────────────────────────────────────
-- `map_node_progress.node_id` references `public.map_nodes` (0023) and every
-- write policy below is written in terms of `public.has_perm()` (0025). Without
-- this block the first failure is a bare 42P01 or 42883 from the middle of a
-- CREATE POLICY, which reads like a broken file rather than a missing
-- prerequisite.
do $preflight$
begin
  if to_regclass('public.map_nodes') is null then
    raise exception
      'NphiesCore 0026 CANNOT APPLY: public.map_nodes does not exist. Apply 0023_map_nodes.sql first — this file records where each of those nodes has got to.';
  end if;

  if to_regprocedure('public.has_perm(text)') is null then
    raise exception
      'NphiesCore 0026 CANNOT APPLY: public.has_perm(text) does not exist. Apply 0025_roles_permissions.sql first — the stage ladder is written by whoever holds structure.edit, and without has_perm() there is no way to say that.';
  end if;

  if to_regprocedure('public.is_member()') is null then
    raise exception
      'NphiesCore 0026 CANNOT APPLY: public.is_member() does not exist. Apply 0001_opstrack_core.sql first.';
  end if;

  if to_regprocedure('public.log_config_audit(text, uuid, text, jsonb, jsonb)') is null then
    raise exception
      'NphiesCore 0026 CANNOT APPLY: public.log_config_audit() does not exist. Apply 0002_config_foundation.sql first — map_node_stages is configuration and is audited.';
  end if;
end
$preflight$;


-- ── map_node_stages ─────────────────────────────────────────────────────────
-- The ladder. A surrogate uuid rather than the name as the key, for 0018:113's
-- reason and 0023:128's: the name is a LABEL and gets renamed — this list ships
-- as a STARTING POINT Aziz renames in the admin screen, which is the entire
-- reason it is a table and not a CHECK constraint — while
-- `map_node_progress.stage_id` has to keep pointing at the same rung across that
-- rename.
--
-- NO COLOUR COLUMN. See the header. This is the comment that is supposed to stop
-- the next person adding one, and probe 1 is the thing that stops them anyway.
--
-- `map_node_progress.stage_id` is `on delete set null`, so this table needs no
-- delete guard: retiring a rung un-stages the organizations that were on it and
-- the organizations survive, which is `kind_id`'s decision verbatim (0023:136)
-- — "removing a kind leaves its nodes kindless, which every reader has to render
-- anyway". The decisive half is that `stage_id is null` MUST be a legal ordinary
-- state regardless (400 imported organizations land with no progress row at
-- all), so `set null` invents no state that did not already exist. `hidden` is
-- the operation the admin almost always wants instead, and the delete
-- confirmation is expected to say "12 organizations are at this stage" BEFORE
-- the click.
create table if not exists public.map_node_stages (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  name_ar       text not null default '',
  sort_order    int not null default 0,
  hidden        boolean not null default false,
  terminal      boolean not null default false,
  paused        boolean not null default false,
  expected_days int,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.profiles (id) on delete set null
);

comment on table public.map_node_stages is
  'The onboarding ladder a map node climbs — Not started → Kickoff → Integrating → Testing/UAT → Go-live ready → Live (0026). Member-read, structure.edit-write, audited: renaming a rung changes what every portfolio count MEANS. Deliberately has NO colour column (0023:150): the map has spent its two visual variables and an ORDERED list draws as position, not hue.';

comment on column public.map_node_stages.terminal is
  'An organization at this stage HAS ARRIVED. The portfolio''s live count is count(*) where terminal, NEVER a comparison against the word "Live" — this is src/lib/mapNodes.ts''s "THE TERMINAL STATUS IS A PARAMETER, NEVER THE LITERAL" promoted from a TS constant to a column the admin owns. Not derived from the highest sort_order, because sort_order is draggable and adding "Post-go-live support" after Live would silently change what DONE means on a drag.';

comment on column public.map_node_stages.paused is
  'The clock is deliberately stopped here. The Stalled lens counts a node only when NOT terminal and NOT paused, so "blocked on the customer since March" is a fact the account manager recorded rather than an alarm the app raises at him every morning. A flag on a configurable row, never a name the code compares against.';

comment on column public.map_node_stages.expected_days is
  'How long a node is expected to sit on this rung before it counts as stalled. NULL = no expectation, and the seed sets it NOWHERE (0003''s SLA-off reasoning). It exists so the Stalled threshold is CONFIGURATION rather than a constant somebody has to invent in TypeScript. Bound 1..3650 — vocab_options.sla_days'' bound and its reason: "10 years" is a legitimate way to say "effectively none, but written down".';

comment on column public.map_node_stages.hidden is
  'use_cases.hidden''s contract exactly: the rung leaves the pickers and never un-stages the organizations already standing on it.';

-- For a project where an earlier cut of this file already landed: `create table
-- if not exists` above is a no-op there, so the columns have to be added
-- separately or the constraints below fail against a table that lacks them.
-- Same reasoning as 0017:129 and 0018:136.
alter table public.map_node_stages add column if not exists name_ar       text not null default '';
alter table public.map_node_stages add column if not exists sort_order    int not null default 0;
alter table public.map_node_stages add column if not exists hidden        boolean not null default false;
alter table public.map_node_stages add column if not exists terminal      boolean not null default false;
alter table public.map_node_stages add column if not exists paused        boolean not null default false;
alter table public.map_node_stages add column if not exists expected_days int;
alter table public.map_node_stages add column if not exists created_at    timestamptz not null default now();
alter table public.map_node_stages add column if not exists updated_at    timestamptz not null default now();
alter table public.map_node_stages add column if not exists created_by    uuid references public.profiles (id) on delete set null;

-- btrim before measuring: '   ' is an empty name wearing a hat. 40 and not the
-- 60 `map_nodes` uses, and it is `map_node_kinds`' reason verbatim (0023:159): a
-- STAGE name is a word the admin chooses, unlike an organization name chosen by
-- a hospital. src/pages/.../CatalogueAdmin.tsx's KIND_NAME_MAX gains a sibling
-- STAGE_NAME_MAX = 40 in the stages screen, and the two must agree.
alter table public.map_node_stages drop constraint if exists map_node_stages_name_len_chk;
alter table public.map_node_stages add constraint map_node_stages_name_len_chk
  check (char_length(btrim(name)) between 1 and 40);

alter table public.map_node_stages drop constraint if exists map_node_stages_name_ar_len_chk;
alter table public.map_node_stages add constraint map_node_stages_name_ar_len_chk
  check (char_length(btrim(name_ar)) <= 40);

-- 1..3650, `vocab_options.sla_days`' bound. NULL is the ordinary state and the
-- seeded state; the bound exists so a typo'd 4000000 is refused with a sentence
-- rather than silently meaning "never stalled".
alter table public.map_node_stages drop constraint if exists map_node_stages_expected_days_chk;
alter table public.map_node_stages add constraint map_node_stages_expected_days_chk
  check (expected_days is null or expected_days between 1 and 3650);

-- Case-insensitive and btrim'd, exactly like map_node_kinds_name_uidx: "Live"
-- and "live" are one rung, and finding out otherwise costs a reader a
-- double-take on every screen that lists stages. src/lib/pgError.ts matches this
-- name, so it must not be renamed casually.
create unique index if not exists map_node_stages_name_uidx
  on public.map_node_stages (lower(btrim(name)));

-- PARTIAL, and it is MANDATORY rather than a refinement, because name_ar is
-- seeded blank ON PURPOSE — these seven words are Aziz's to translate, not mine
-- to guess (0023:172). A non-partial unique index would let exactly ONE stage go
-- untranslated and reject the second with a duplicate-name error naming the
-- wrong field. Same shape as track_groups_name_ar_uidx (0018:174) and
-- map_node_kinds_name_ar_uidx (0023:176), and pgError.ts matches this name too.
create unique index if not exists map_node_stages_name_ar_uidx
  on public.map_node_stages (lower(btrim(name_ar))) where btrim(name_ar) <> '';

create index if not exists map_node_stages_sort_idx on public.map_node_stages (sort_order);

alter table public.map_node_stages enable row level security;

-- MEMBER READ, structure.edit WRITE — and both halves are deliberate.
--
-- Read must be member-wide: an account manager who cannot read the ladder gets a
-- stage picker with nothing in it and a portfolio with no columns, which is
-- worse than shipping no stages at all.
--
-- Write is `structure.edit` FROM BIRTH, not `is_admin()` with a restatement to
-- come later. 0023 wrote `is_admin()` because `has_perm()` did not exist yet and
-- 0025 had to go back and re-point eleven policies; `has_perm()` exists now, so
-- 0026 gets to skip that dance entirely and 0025's probe 5 half A never has to
-- learn about this table.
--
-- Every predicate is in 0009's InitPlan form `(select public.is_member())` /
-- `(select public.has_perm(...))` so it is evaluated ONCE PER STATEMENT rather
-- than once per surviving row. Seven rows make that academic on this table
-- today; writing it the other way would make this the one table in the schema
-- somebody has to find and fix later.
drop policy if exists map_node_stages_select on public.map_node_stages;
create policy map_node_stages_select on public.map_node_stages
  for select using ((select public.is_member()));

drop policy if exists map_node_stages_insert on public.map_node_stages;
create policy map_node_stages_insert on public.map_node_stages
  for insert with check ((select public.has_perm('structure.edit')));

drop policy if exists map_node_stages_update on public.map_node_stages;
create policy map_node_stages_update on public.map_node_stages
  for update using ((select public.has_perm('structure.edit')))
  with check ((select public.has_perm('structure.edit')));

drop policy if exists map_node_stages_delete on public.map_node_stages;
create policy map_node_stages_delete on public.map_node_stages
  for delete using ((select public.has_perm('structure.edit')));

-- Explicit rather than relying on Supabase's default privileges for new tables
-- in `public`; `anon` is left exactly as the project's defaults have it, matching
-- every other table since 0002, and cannot pass is_member() in any case.
grant select, insert, update, delete on public.map_node_stages to authenticated;

-- Diffed rather than stamped unconditionally, for the same reason
-- map_node_kinds_touch() is (0023:207, 0018:217): reorder_map_node_stages()
-- writes several rows in one statement, and an unconditional stamp would report
-- the whole ladder as edited — and emit a full set of audit rows — on a drag
-- that moved nothing.
--
-- ⚠ THE `else` ARM PINS updated_at BACK, and it is deliberately NOT what
--   map_node_kinds_touch() (0023:207) and track_groups_touch() (0018:221) do.
--   Those two subtract `updated_at` from the diff and then leave NEW alone,
--   which hands a client a PATCH that carries `updated_at` and nothing else
--   changed: the diff is false, the `if` body is skipped, and the client's value
--   lands on the row. Worse HERE than there, because the audit trigger below
--   compares the FULL row images — so that same PATCH also writes a config_audit
--   row whose before/after differ in one bookkeeping column, which is 1626's
--   "the trail fills with rows recording that nothing happened" arriving through
--   the front door. Every store that holds a row and saves it back on blur sends
--   `updated_at`, because it is in the row it read.
--
--   0026's own map_node_progress_touch() already pins both of its columns in the
--   else arm, so this is the two tables in one file agreeing rather than a new
--   idiom. Probe 4 sends `updated_at` on the unchanged re-save and asserts the
--   row comes back byte-identical, so deleting these two lines fails the file.
--   THE CLIENT CONTRACT IS STILL "do not send it": `updated_at`, `created_at`
--   and `created_by` are server-owned on this table.
create or replace function public.map_node_stages_touch()
returns trigger
language plpgsql
as $$
begin
  if (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
    new.updated_at := now();
  else
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;

drop trigger if exists map_node_stages_touch_trg on public.map_node_stages;
create trigger map_node_stages_touch_trg
  before update on public.map_node_stages
  for each row execute function public.map_node_stages_touch();

-- AFTER, not BEFORE: the row image recorded must be the one that survived every
-- other trigger and constraint on the table. Identical in shape to
-- map_node_kinds_audit() (0023:224).
--
-- THIS TABLE IS CONFIGURATION AND IS AUDITED, and the contrast with
-- map_node_progress twenty lines down is the whole permission design in two
-- triggers. Renaming "Integrating" to "In build" restates the meaning of every
-- number on every portfolio screen, retroactively, for everybody — the exact
-- class of change made by one person with no second pair of eyes that
-- config_audit exists for, and `before` is the only record of what the rung used
-- to be called.
--
-- The UPDATE arm compares the FULL row images with nothing subtracted, which is
-- safe because the touch trigger above ran first (BEFORE beats AFTER regardless
-- of names) and only moved `updated_at` if something else had already changed.
-- A save that changed nothing therefore writes no audit row — asserted by probe
-- 4, not assumed.
create or replace function public.map_node_stages_audit()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    -- Casts on the null: with a single candidate Postgres resolves an untyped
    -- null anyway, but an overload added later would make this ambiguous at
    -- runtime, inside a trigger, on someone else's write.
    perform public.log_config_audit('map_node_stages', new.id, 'insert', null::jsonb, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    if to_jsonb(new) is distinct from to_jsonb(old) then
      perform public.log_config_audit('map_node_stages', new.id, 'update', to_jsonb(old), to_jsonb(new));
    end if;
    return new;
  else
    perform public.log_config_audit('map_node_stages', old.id, 'delete', to_jsonb(old), null::jsonb);
    return old;
  end if;
end;
$$;

drop trigger if exists map_node_stages_audit_trg on public.map_node_stages;
create trigger map_node_stages_audit_trg
  after insert or update or delete on public.map_node_stages
  for each row execute function public.map_node_stages_audit();


-- ── seed: the seven rungs ───────────────────────────────────────────────────
-- `do nothing` rather than `do update`, exactly like 0001's track seed, 0018's
-- group seed and 0023's kind seed: these are editable in the admin screen and
-- re-running this migration must not stomp a renamed rung, a re-flagged one or
-- a re-ordered one.
--
-- ARABIC IS BLANK ON PURPOSE, which is why the name_ar index above had to be
-- partial. These seven words are the programme's own vocabulary and Aziz names
-- them in Arabic himself; a guessed translation would be indistinguishable from
-- a reviewed one on screen (0023:256).
--
-- `terminal` on Live and `paused` on Paused are the ONLY two flags set, and
-- `expected_days` is set on nothing. A ladder is a starting list, not a
-- constraint, and every one of these is one edit away in the admin screen.
--
-- Note what the list does NOT contain: a rung meaning "we have not looked at
-- this one yet". "Not started" is a rung an account manager PICKS. The absence
-- of a progress row is what "nobody has said" means, and the two are different
-- answers to different questions.
insert into public.map_node_stages (name, name_ar, sort_order, terminal, paused) values
  ('Not started',   '', 1, false, false),
  ('Kickoff',       '', 2, false, false),
  ('Integrating',   '', 3, false, false),
  ('Testing/UAT',   '', 4, false, false),
  ('Go-live ready', '', 5, false, false),
  ('Live',          '', 6, true,  false),
  ('Paused',        '', 7, false, true)
on conflict (lower(btrim(name))) do nothing;


-- ── reorder_map_node_stages ─────────────────────────────────────────────────
-- reorder_map_node_kinds (0023:275) on this table, which is reorder_groups
-- (0018:282) one generation further on. Flat and unscoped, and the difference
-- from reorder_map_nodes is the data rather than a lapse: there is exactly ONE
-- list of stages, so there is no other branch for a stray id to renumber.
--
-- `security invoker`, and it exists for ATOMICITY, not privilege — the same
-- reasoning as reorder_tracks (0002:435). A half-applied reorder leaves two
-- rungs sharing a position, and only a single statement is atomic under
-- PostgREST. RLS therefore still evaluates against the caller and rejects a
-- member exactly as if they had typed the UPDATE by hand.
--
-- The has_perm() check at the top is not the authorization. It is there so a
-- member gets a clean 42501 carrying a token that src/lib/pgError.ts maps to a
-- translated sentence, instead of a silent zero-row UPDATE reported to them as a
-- successful drag.
--
-- ⚠ REORDERING THE LADDER RESTATES EVERY COUNT-FORM GOAL, and this is the
--   sentence that has to survive into the admin screen's confirmation dialog.
--   A goal reading "40 organizations at Go-live ready OR BEYOND by 31 December"
--   is evaluated as `stage.sort_order >= that rung's sort_order`. Dragging
--   "Testing/UAT" above "Go-live ready" does not merely re-draw a list: it
--   changes which organizations count towards that commitment, retroactively,
--   for every goal in the workspace, with no edit to any goal row and no audit
--   row against any of them. It is the same coupling `reorder_vocab` has with
--   the board's column order, which this project already lives with — but
--   unstated it is a trap, and this comment plus the dialog are the statement.
create or replace function public.reorder_map_node_stages(p_ids uuid[])
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count int;
begin
  if not public.has_perm('structure.edit') then
    raise exception 'map_node_stage_reorder_denied: structure.edit is required to reorder the stage ladder'
      using errcode = '42501';
  end if;

  -- One statement, ordinality as the new sort_order. The `is distinct from`
  -- filter skips rungs already in place, so a drag that moved one row does not
  -- stamp updated_at on all seven and write seven audit rows.
  update public.map_node_stages s
     set sort_order = o.ord::int
    from unnest(p_ids) with ordinality as o(id, ord)
   where s.id = o.id
     and s.sort_order is distinct from o.ord::int;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.reorder_map_node_stages(uuid[]) is
  'Reorders the stage ladder in one atomic statement (0026). structure.edit only. ⚠ REORDERING THE LADDER RESTATES EVERY COUNT-FORM GOAL: "40 organizations at Go-live ready or beyond" is evaluated as sort_order >= that rung''s, so a drag silently changes which organizations count towards commitments nobody edited. The admin screen must say so before the drag is committed.';

-- `from public` is not enough on Supabase (0002:365): every project ships
-- `alter default privileges in schema public grant execute on functions to anon,
-- authenticated`, which gives anon its OWN grant that a revoke from PUBLIC
-- leaves in place. has_perm() already returns false without a JWT, so this is
-- defence in depth rather than a fix — but every RPC in this schema should be
-- unreachable with the anon key, not merely unsuccessful.
revoke all on function public.reorder_map_node_stages(uuid[]) from public;
revoke all on function public.reorder_map_node_stages(uuid[]) from anon;
grant execute on function public.reorder_map_node_stages(uuid[]) to authenticated;


-- ── map_node_progress ───────────────────────────────────────────────────────
-- Where one node has got to. ONE ROW PER NODE AT MOST — `node_id` is the primary
-- key, not a column with an index on it, because the pair "this node, this
-- stage" IS the identity and a surrogate key would let two rows say different
-- things about the same organization. That is 0024's `map_node_use_cases`
-- reasoning (0024:329) with one column instead of two.
--
-- THE TWO FK ACTIONS ARE OPPOSITE ON PURPOSE:
--
--   node_id … ON DELETE CASCADE. "Some deleted organization was at Testing/UAT"
--     is not a fact worth keeping. In practice this rarely fires — 0023's node
--     delete guard refuses to delete a node that still has work under it — so
--     the cascade is the tidy-up for a genuinely empty node, not a data-loss
--     path.
--
--   stage_id … ON DELETE SET NULL. Retiring a rung must never delete the record
--     that an organization exists and is being worked on. The row survives with
--     no stage, which is exactly the state every un-started organization is in
--     anyway, so `set null` invents nothing.
--
-- THIS TABLE IS NOT CONFIGURATION and has no audit trigger. See the header.
create table if not exists public.map_node_progress (
  node_id          uuid primary key references public.map_nodes (id) on delete cascade,
  stage_id         uuid references public.map_node_stages (id) on delete set null,
  stage_changed_at timestamptz,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.profiles (id) on delete set null
);

comment on table public.map_node_progress is
  'Which rung of map_node_stages a node is standing on, and since when (0026). MEMBER-WRITE, unlike map_node_stages: the owner owns the ladder, the account managers own where each organization got to — map_node_use_cases'' split (0024:430) on a second table. Deliberately NOT audited (0024:544): this is day-to-day fieldwork and a config trail dominated by routine data entry stops being read. THE ABSENCE OF A ROW IS MEANINGFUL — it is "nobody has said", which is a different answer from the "Not started" rung.';

comment on column public.map_node_progress.stage_changed_at is
  'When this node arrived on its current rung. WRITTEN ONLY BY map_node_progress_stage_stamp() — a value sent by a client is overruled, not rejected. Time-in-stage is now() - this, and the Stalled lens compares it against the stage''s expected_days. NULL exactly when stage_id is NULL, which map_node_progress_stage_chk enforces as a backstop.';

comment on column public.map_node_progress.updated_by is
  'Who last recorded this node''s position. Server truth, resolved through profiles from auth.uid(), never a field the screen offers. NULL when the write had no JWT — the SQL Editor, the service role and the CSV importer all write honestly attributed to nobody.';

-- For a project where an earlier cut of this file already landed.
alter table public.map_node_progress add column if not exists stage_id         uuid references public.map_node_stages (id) on delete set null;
alter table public.map_node_progress add column if not exists stage_changed_at timestamptz;
alter table public.map_node_progress add column if not exists updated_at       timestamptz not null default now();
alter table public.map_node_progress add column if not exists updated_by       uuid references public.profiles (id) on delete set null;

-- Written as the two-arm OR rather than as `(stage_id is null) = (stage_changed_at
-- is null)`, and it is map_nodes_archived_at_chk's exact form (0023:430) for its
-- exact reason: a row that names a stage with no arrival date is a row no
-- "in stage since" column can render, and a row carrying an arrival date for no
-- stage is a timestamp about nothing. The equality spelling is shorter and reads
-- as a puzzle; this one reads as the two states that are legal.
--
-- The stamp trigger keeps both sides in agreement on every path a client can
-- reach, so this constraint should never fire in production. It is the backstop
-- for a direct SQL write with the trigger disabled, and pgError.ts still maps it
-- so that if it ever does fire it says something.
alter table public.map_node_progress drop constraint if exists map_node_progress_stage_chk;
alter table public.map_node_progress add constraint map_node_progress_stage_chk
  check ((stage_id is not null and stage_changed_at is not null)
      or (stage_id is null and stage_changed_at is null));

-- The primary key indexes node_id, which serves "where is this organization" —
-- the panel's question. This one serves the OTHER direction: "which
-- organizations are at Testing/UAT", the director's question, and it is what the
-- portfolio's stage roll-up and every count-form goal read. One more B-tree on a
-- table that will hold at most one row per node.
create index if not exists map_node_progress_stage_idx
  on public.map_node_progress (stage_id);

alter table public.map_node_progress enable row level security;

-- ═══ MEMBER READ, **MEMBER WRITE** — the most consequential call in this file ═
--
-- `map_node_use_cases`' policy set verbatim (0024:458), and it is the reason
-- this table exists at all rather than being a column on `map_nodes`.
--
-- The three account managers are members. They sit with a hospital, establish
-- that it has cleared UAT, and record it. Gating this table on `structure.edit`
-- would make the two senior experts the data-entry bottleneck for the data their
-- account managers collect — the exact opposite of why the map is being built:
-- Aziz wants to LOOK at the answer, not type it in.
--
-- The blast radius of getting it wrong is asymmetric, which is the tiebreak: a
-- member who wrongly CAN write moves an organization to the wrong rung, which
-- anybody can see on the portfolio screen and fix in one click; a member who
-- wrongly CANNOT write hands the data collection back to one person and the map
-- goes stale silently, because nobody files a bug that says "I stopped
-- bothering".
--
-- Probe 3 asserts this POSITIVELY — a member inserting, updating AND deleting a
-- progress row — because a copy-pasted `has_perm('structure.edit')` here would
-- ship silently inverted and would look exactly like the policy block eighty
-- lines up.
drop policy if exists map_node_progress_select on public.map_node_progress;
create policy map_node_progress_select on public.map_node_progress
  for select using ((select public.is_member()));

drop policy if exists map_node_progress_insert on public.map_node_progress;
create policy map_node_progress_insert on public.map_node_progress
  for insert with check ((select public.is_member()));

drop policy if exists map_node_progress_update on public.map_node_progress;
create policy map_node_progress_update on public.map_node_progress
  for update using ((select public.is_member())) with check ((select public.is_member()));

drop policy if exists map_node_progress_delete on public.map_node_progress;
create policy map_node_progress_delete on public.map_node_progress
  for delete using ((select public.is_member()));

grant select, insert, update, delete on public.map_node_progress to authenticated;


-- ── the stamp, and it is the ONLY writer of stage_changed_at ────────────────
-- BEFORE INSERT OR UPDATE, and every arm is spelled out because the omissions
-- are what break it:
--
--   INSERT with a stage      → now(). WITHOUT THIS ARM an organization whose
--                              first recorded position is Integrating has no
--                              "in stage since", and time-in-stage is
--                              unanswerable for that node forever — which at
--                              400 rows landing through the importer is the
--                              entire cohort.
--   INSERT with no stage     → null, forced. A client that sends a timestamp
--                              with no stage is overruled.
--   UPDATE, stage changed    → now().
--   UPDATE, stage cleared    → null. The archive stamp's symmetry (0023:576),
--                              and it is also what keeps the CHECK true.
--   UPDATE, stage unchanged  → PINNED BACK TO OLD. This is the arm that makes
--                              "the trigger is the only writer" literally true
--                              rather than nearly true, and it is what makes a
--                              PATCH writing the stage a node already holds a
--                              complete no-op: no stamp, no diff, no updated_at
--                              bump. Probe 4 asserts the whole row comes back
--                              byte-identical.
--
-- No SECURITY DEFINER: it reads nothing and writes only NEW. Adding one would be
-- privilege for its own sake.
create or replace function public.map_node_progress_stage_stamp()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.stage_id is not null then
      new.stage_changed_at := now();
    else
      new.stage_changed_at := null;
    end if;
    return new;
  end if;

  if new.stage_id is distinct from old.stage_id then
    if new.stage_id is null then
      new.stage_changed_at := null;
    else
      new.stage_changed_at := now();
    end if;
  else
    new.stage_changed_at := old.stage_changed_at;
  end if;

  return new;
end;
$$;

-- ⚠ THE NAME IS LOAD-BEARING. Postgres fires BEFORE ROW triggers in NAME order,
--   so this must sort BEFORE map_node_progress_touch_trg. 's' < 't' gives that
--   for free here and would be silently lost with almost any other name.
--
--   What the order actually buys is THE NO-OP, not the stage change: on a real
--   change the touch diff sees `stage_id` move and stamps updated_at whichever
--   trigger ran first. Invert the order and a save that re-sends the stage the
--   node already holds — carrying the `stage_changed_at` the client read a
--   minute ago — reaches the touch BEFORE the stamp has pinned that column back,
--   so the diff calls it a change, moves updated_at and rewrites updated_by. The
--   row then reads as edited by somebody who edited nothing, on the write path a
--   save-on-blur screen takes twenty times an hour. Probe 1 asserts the ordering
--   out of pg_trigger; probe 4 asserts the behaviour it protects.
drop trigger if exists map_node_progress_stage_stamp_trg on public.map_node_progress;
create trigger map_node_progress_stage_stamp_trg
  before insert or update on public.map_node_progress
  for each row execute function public.map_node_progress_stage_stamp();


-- ── touch: updated_at / updated_by, diffed ──────────────────────────────────
-- BEFORE INSERT OR UPDATE, unlike map_node_use_cases which splits the two across
-- a stamp and a touch. The reason is this table's shape: it has no created_by,
-- and the COMMON case is a row written once and never touched again — an
-- organization whose stage was recorded and has not moved since. With an
-- update-only touch, that row's `updated_by` would be null forever and "who
-- recorded this?" would be unanswerable for exactly the rows the portfolio is
-- made of.
--
-- `updated_by` is SERVER TRUTH about the write, not a field the screen offers,
-- so it is overwritten rather than trusted — `entries_guard_insert()`'s rule
-- (0015:330) at one table's scale — and it is resolved THROUGH profiles for the
-- FK reason vocab_touch() gives: an auth user without a profile row would
-- violate the FK from inside a trigger and roll back the account manager's edit
-- rather than merely losing an attribution.
--
-- The JWT-less passthrough is the same one the whole schema uses: the SQL
-- Editor, the service role and the CSV importer all write without a `sub` claim
-- and must be able to write rows honestly attributed to nobody.
--
-- The UPDATE arm is DIFFED, subtracting only the two columns it writes itself.
-- `stage_changed_at` is deliberately NOT subtracted: it is set by the stamp
-- trigger, which ran first, so a stage change shows up in the diff and moves
-- updated_at — which is correct and wanted. "Somebody moved this organization to
-- Testing/UAT" is the single most important human touch this table records.
--
-- The else arm pins BOTH columns back to their old values. Without that pin a
-- client could move `updated_at` by sending one on a write that changed nothing
-- else, which is a lie about when the row was last worked on.
create or replace function public.map_node_progress_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.updated_at := now();
    if auth.uid() is not null then
      new.updated_by := (select p.id from public.profiles p where p.id = auth.uid());
    end if;
    return new;
  end if;

  if (to_jsonb(new) - 'updated_at' - 'updated_by')
       is distinct from (to_jsonb(old) - 'updated_at' - 'updated_by') then
    new.updated_at := now();
    new.updated_by := coalesce(
      (select p.id from public.profiles p where p.id = auth.uid()),
      old.updated_by
    );
  else
    new.updated_at := old.updated_at;
    new.updated_by := old.updated_by;
  end if;

  return new;
end;
$$;

drop trigger if exists map_node_progress_touch_trg on public.map_node_progress;
create trigger map_node_progress_touch_trg
  before insert or update on public.map_node_progress
  for each row execute function public.map_node_progress_touch();


-- ════════════════════════════════════════════════════════════════════════════
-- ═══ PROBES ═════════════════════════════════════════════════════════════════
-- ════════════════════════════════════════════════════════════════════════════
--
-- Every one of these can FAIL, which is the rule docs/PENDING-MIGRATIONS.md ends
-- on: 0019's probe 1 asserted that a row existed and never what it said, and a
-- wrong notification shipped. Each assertion below is written so that deleting
-- the code it tests makes it raise.
--
-- ⚠ ONE LIMIT, STATED SO NOBODY MISTAKES IT FOR AN OVERSIGHT. `now()` is the
--   TRANSACTION timestamp and is constant for the whole of this file, so no
--   probe here can observe a timestamp MOVING between two writes — both land on
--   the same value. The probes therefore assert the strictly stronger thing that
--   IS observable inside one transaction: that a value the CLIENT supplied did
--   not survive, and that the trigger's own value is what came back. "It moved"
--   is proved by the live checks in the handoff, against two writes in two
--   separate requests.
--
--   The one thing that limit would otherwise hide — a touch diff that stopped
--   reacting to a stage change, which cannot be seen through a timestamp that
--   does not move — is caught in probe 3 instead, through `updated_by`: a
--   progress row is planted with a null author, a MEMBER moves it to another
--   rung, and only the diff's change arm can put their id there.
--
-- ⚠ EVERY FIXTURE STAGE NAME IS DELIBERATELY SHORT — a prefix plus the first
--   eight characters of a uuid, not the whole one. `map_node_stages_name_len_chk`
--   caps a name at 40 characters, and a 36-character uuid on the end of any
--   readable prefix clears it. That raises 23514, which none of the
--   `insufficient_privilege` handlers below catch, so the probe would fail the
--   whole migration while appearing to test permissions. Eight hex characters is
--   ample for a fixture that is rolled back before the next probe runs. The
--   fixture NODE names are full uuids on purpose: map_nodes allows 60.


-- ── probe 1: the shape landed, including the two things a reader cannot see ──
-- Runs as whoever applies the file (the SQL Editor, i.e. no JWT), which is the
-- right role here: this probe tests the SEED and the STRUCTURE. RLS is probe 3's
-- job.
do $shape$
declare
  v_stages     int;
  v_missing    text;
  v_terminal   int;
  v_paused     int;
  v_both       int;
  v_idx        text;
  v_stamp_def  text;
  v_stamp_name text;
  v_touch_name text;
  v_confdel    text;
  v_args       text[];
  v_backfilled int;
begin
  if to_regclass('public.map_node_stages') is null then
    raise exception 'NphiesCore 0026 FAILED: public.map_node_stages does not exist.';
  end if;

  if to_regclass('public.map_node_progress') is null then
    raise exception 'NphiesCore 0026 FAILED: public.map_node_progress does not exist.';
  end if;

  select count(*) into v_stages from public.map_node_stages;

  -- Named, because "7 stages" would also be satisfied by seven of the wrong
  -- ones. On a workspace where the admin has already renamed a rung, the seed's
  -- `on conflict do nothing` re-inserts the original name on a re-run — the same
  -- accepted behaviour 0023's kind seed has — so this assertion stays true.
  select string_agg(want, ', ') into v_missing
    from (values
      ('Not started'), ('Kickoff'), ('Integrating'), ('Testing/UAT'),
      ('Go-live ready'), ('Live'), ('Paused')
    ) as w(want)
   where not exists (
     select 1 from public.map_node_stages s
      where lower(btrim(s.name)) = lower(w.want)
   );

  if v_missing is not null then
    raise exception
      'NphiesCore 0026 FAILED: these stages were not created: %. The seed did not land, so the ladder the whole portfolio is drawn against is incomplete.',
      v_missing;
  end if;

  if v_stages < 7 then
    raise exception
      'NphiesCore 0026 FAILED: % map_node_stages rows, expected at least 7.', v_stages;
  end if;

  select count(*) filter (where terminal), count(*) filter (where paused)
    into v_terminal, v_paused
    from public.map_node_stages;

  select count(*) into v_both from public.map_node_stages where terminal and paused;

  -- ── THE THREE ASSERTIONS BELOW ARE ABOUT THE SEED, NOT ABOUT THE TABLE ──────
  --
  -- They test the VALUES list eighty lines up: write two `true`s into the
  -- terminal column, or an expected_days, and a fresh apply fails here. They are
  -- therefore run ONLY against a table that is still exactly what the seed
  -- wrote, and `v_stages = 7` is NOT that test — it is a row count, and every
  -- edit the file's own comments tell the admin to make leaves it at 7. Renaming
  -- a rung, flagging a second one terminal, and above all SETTING expected_days
  -- (which 0026's own comment calls "one edit away in the admin screen, which is
  -- where the number should be chosen") all keep seven rows. Scoped on the count
  -- alone, this file would refuse to re-apply the moment Aziz did the thing it
  -- asked him to do — and because there is no explicit transaction, that refusal
  -- rolls back the WHOLE file, including whatever correction the re-run was
  -- carrying.
  --
  -- `updated_at is distinct from created_at` is the real test and the schema
  -- already keeps it: both columns default to now(), which is the TRANSACTION
  -- timestamp, so every seeded row lands with them equal to the microsecond, and
  -- map_node_stages_touch() moves updated_at on the first real change and never
  -- otherwise (its else arm pins it back, so even a no-op save leaves the row
  -- untouched). An edited workspace is REPORTED — a notice naming what it holds
  -- — rather than refused, because at that point the table is the admin's data
  -- and not this file's seed.
  if v_stages = 7 and not exists (
       select 1 from public.map_node_stages where updated_at is distinct from created_at
     ) then
    -- A rung cannot be both "the organization has arrived" and "the clock is
    -- deliberately stopped": the live count and the Stalled lens would disagree
    -- about the same row. On an untouched seed that can only mean the VALUES
    -- list is wrong.
    if v_both <> 0 then
      raise exception
        'NphiesCore 0026 FAILED: % of the seven seeded stages are flagged BOTH terminal and paused. A rung cannot mean "has arrived" and "the clock is stopped" at once. Nothing has edited this table since the seed wrote it, so the VALUES list in this file is wrong.',
        v_both;
    end if;

    if v_terminal <> 1 then
      raise exception
        'NphiesCore 0026 FAILED: the seven seeded stages carry % terminal flags, expected exactly 1 (Live). The portfolio''s live count is count(*) where terminal, so this number IS the definition of done.',
        v_terminal;
    end if;
    if v_paused <> 1 then
      raise exception
        'NphiesCore 0026 FAILED: the seven seeded stages carry % paused flags, expected exactly 1 (Paused). Without one the Stalled lens has no way to record "the clock is deliberately stopped".',
        v_paused;
    end if;

    -- The other half of the no-backfill decision, and it is the same decision:
    -- a stalled threshold nobody chose is a number the app would then chase
    -- people with. 0003 ships SLA off; this ships the ladder with no clock.
    if exists (select 1 from public.map_node_stages where expected_days is not null) then
      raise exception
        'NphiesCore 0026 FAILED: a seeded stage carries an expected_days value and nothing has edited this table since the seed ran. The seed sets it NOWHERE, deliberately — 0003''s reasoning about sla_days: a threshold nobody set turns every ordinary organization into a stalled one on day one. It is one edit away in the admin screen, which is where the number should be chosen.';
    end if;
  else
    -- The reported arm. Everything here is legitimate admin data; the only job
    -- left is to make sure the operator SEES it in the NOTICE stream, because
    -- two of these states are ones he would want to know about on the run that
    -- caused them.
    raise notice
      'NphiesCore 0026 probe 1: this workspace''s ladder has been edited (% rungs, % terminal, % paused, % with an expected_days), so the seed-value assertions were skipped — they are about this file''s VALUES list, not about your data.%',
      v_stages, v_terminal, v_paused,
      (select count(*) from public.map_node_stages where expected_days is not null),
      case
        when v_stages > 7 then
          ' ⚠ MORE THAN SEVEN RUNGS. If you renamed the seeded rungs and then re-ran this file, the seed''s `on conflict (lower(btrim(name))) do nothing` will have re-inserted the seven English originals alongside your renamed ones — they appear in every stage picker and every portfolio roll-up. Delete the duplicates, and never re-run 0026 after renaming: run it twice BACK TO BACK first.'
        when v_both <> 0 then
          ' ⚠ A rung is flagged BOTH terminal and paused. The live count and the Stalled lens will disagree about the organizations standing on it; clear one flag.'
        else ''
      end;
  end if;

  -- A colour column here would mean somebody added a third visual encoding to a
  -- map that has two. Failing the migration is the only way to make that a
  -- conversation rather than a merge (0023:1355's assertion, one table over).
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'map_node_stages'
       and column_name in ('color', 'colour', 'color_light')
  ) then
    raise exception
      'NphiesCore 0026 FAILED: map_node_stages has a colour column. The map has already spent its two visual variables and an ORDERED ladder draws as position, not hue — see this file''s header for what adding one actually costs.';
  end if;

  -- The Arabic index must be PARTIAL, or the blank seed makes exactly one stage
  -- translatable and rejects the second with an error naming the wrong field.
  select pg_get_indexdef(i.indexrelid) into v_idx
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
   where c.relname = 'map_node_stages_name_ar_uidx';

  if v_idx is null then
    raise exception
      'NphiesCore 0026 FAILED: map_node_stages_name_ar_uidx does not exist. src/lib/pgError.ts matches that name to mapadmin.errStageNameArTaken.';
  end if;

  if position(' WHERE ' in upper(v_idx)) = 0 then
    raise exception
      'NphiesCore 0026 FAILED: map_node_stages_name_ar_uidx is not partial (%). name_ar is seeded blank on all seven rows, so a non-partial unique index accepts exactly one of them and rejects the rest.',
      v_idx;
  end if;

  if not exists (
    select 1 from pg_class c where c.relname = 'map_node_stages_name_uidx'
  ) then
    raise exception
      'NphiesCore 0026 FAILED: map_node_stages_name_uidx does not exist. src/lib/pgError.ts matches that name to mapadmin.errStageNameTaken, and without it two rungs can be called Live.';
  end if;

  -- ── map_node_progress: the two FK actions, which are opposite on purpose ──
  select con.confdeltype::text into v_confdel
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_class f on f.oid = con.confrelid
   where c.relname = 'map_node_progress' and f.relname = 'map_nodes' and con.contype = 'f';

  if v_confdel is null then
    raise exception
      'NphiesCore 0026 FAILED: map_node_progress has no foreign key to map_nodes. A progress row for a node that does not exist is a number in the portfolio with nothing behind it.';
  end if;

  if v_confdel <> 'c' then
    raise exception
      'NphiesCore 0026 FAILED: map_node_progress.node_id is ON DELETE % , expected c (cascade). "Some deleted organization was at Testing/UAT" is not a fact worth keeping.',
      v_confdel;
  end if;

  select con.confdeltype::text into v_confdel
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_class f on f.oid = con.confrelid
   where c.relname = 'map_node_progress' and f.relname = 'map_node_stages' and con.contype = 'f';

  if v_confdel is null then
    raise exception
      'NphiesCore 0026 FAILED: map_node_progress has no foreign key to map_node_stages.';
  end if;

  if v_confdel <> 'n' then
    raise exception
      'NphiesCore 0026 FAILED: map_node_progress.stage_id is ON DELETE % , expected n (set null). Retiring a rung must un-stage its organizations, never delete the record that they are being worked on.',
      v_confdel;
  end if;

  if not exists (
    select 1 from pg_constraint con
      join pg_class c on c.oid = con.conrelid
     where c.relname = 'map_node_progress'
       and con.conname = 'map_node_progress_stage_chk'
  ) then
    raise exception
      'NphiesCore 0026 FAILED: map_node_progress_stage_chk is missing. A row naming a stage with no arrival date is a row no "in stage since" column can render.';
  end if;

  -- node_id must be the PRIMARY KEY, not merely indexed: two rows saying
  -- different things about one organization is the shape this table must not be
  -- able to hold.
  --
  -- The NAME is checked with it, and not as pedantry: `map_node_progress_pkey`
  -- is the string src/lib/pgError.ts matches to turn the 23505 an AM meets on a
  -- concurrent write — the commonest error in the product — into a sentence
  -- rather than common.error. A pkey created under any other name by an earlier
  -- cut of this file would leave that arm dead with no other symptom.
  if not exists (
    select 1 from pg_constraint con
      join pg_class c on c.oid = con.conrelid
     where c.relname = 'map_node_progress' and con.contype = 'p'
       and con.conname = 'map_node_progress_pkey'
       and (select array_agg(a.attname::text order by a.attnum)
              from pg_attribute a
             where a.attrelid = con.conrelid and a.attnum = any(con.conkey)) = array['node_id']::text[]
  ) then
    raise exception
      'NphiesCore 0026 FAILED: map_node_progress has no primary key named map_node_progress_pkey on exactly (node_id). Without the key, one organization can hold two contradictory positions and every count is ambiguous; without that NAME, pgError.ts cannot recognise the 23505 two account managers produce on the same organization and the undo toast degrades to a generic failure.';
  end if;

  -- ── the stamp trigger: present, BEFORE, and on BOTH events ──
  select pg_get_triggerdef(t.oid) into v_stamp_def
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where c.relname = 'map_node_progress' and t.tgname = 'map_node_progress_stage_stamp_trg';

  if v_stamp_def is null then
    raise exception
      'NphiesCore 0026 FAILED: map_node_progress_stage_stamp_trg does not exist. stage_changed_at would then be whatever a client typed, and time-in-stage would be fiction.';
  end if;

  if position('BEFORE INSERT OR UPDATE' in upper(v_stamp_def)) = 0
     or position('FOR EACH ROW' in upper(v_stamp_def)) = 0 then
    raise exception
      'NphiesCore 0026 FAILED: map_node_progress_stage_stamp_trg is not BEFORE INSERT OR UPDATE FOR EACH ROW. Its definition is: %. Dropping the INSERT half leaves every importer-created row with no "in stage since" — the whole 400-organization cohort, forever.',
      v_stamp_def;
  end if;

  -- ── the trigger NAME ORDER, asserted rather than trusted ──
  -- Postgres fires BEFORE ROW triggers in name order. Read both names out of the
  -- catalog and compare them, so that renaming either one in a future cut fails
  -- HERE rather than silently turning every no-op save into a write that moves
  -- updated_at and re-attributes the row (the header's ① and probe 4).
  select t.tgname into v_stamp_name
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where c.relname = 'map_node_progress' and t.tgname = 'map_node_progress_stage_stamp_trg';

  select t.tgname into v_touch_name
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where c.relname = 'map_node_progress' and t.tgname = 'map_node_progress_touch_trg';

  if v_touch_name is null then
    raise exception
      'NphiesCore 0026 FAILED: map_node_progress_touch_trg does not exist. updated_at/updated_by would then be whatever the client sent.';
  end if;

  if not (v_stamp_name < v_touch_name) then
    raise exception
      'NphiesCore 0026 FAILED: the stamp trigger (%) does not sort before the touch trigger (%). Postgres fires BEFORE ROW triggers in NAME order, so the touch diff would run against the stage_changed_at THE CLIENT SENT rather than the one the stamp settles on — and every save that re-sends a node''s existing stage would move updated_at and rewrite updated_by, silently, on the write path a save-on-blur screen takes all day.',
      v_stamp_name, v_touch_name;
  end if;

  -- ── the RPC, BY ARGUMENT NAME ──
  -- PostgREST resolves a function from the KEYS of the JSON body, so a signature
  -- that drifts from what src/api/map.ts sends is not a type error anywhere — it
  -- is a 404 the first time an admin drags a rung, months after both halves were
  -- reviewed and found correct on their own. to_regprocedure checks the TYPES;
  -- proargnames is the half that actually matters to the client.
  if to_regprocedure('public.reorder_map_node_stages(uuid[])') is null then
    raise exception
      'NphiesCore 0026 FAILED: public.reorder_map_node_stages(uuid[]) is missing or has a different argument list. src/api/map.ts calls it by name and would get a 404.';
  end if;

  select p.proargnames into v_args
    from pg_proc p
   where p.oid = to_regprocedure('public.reorder_map_node_stages(uuid[])');

  if v_args is null or array_length(v_args, 1) <> 1 or v_args[1] <> 'p_ids' then
    raise exception
      'NphiesCore 0026 FAILED: reorder_map_node_stages''s argument is named %, expected p_ids. PostgREST matches the JSON body''s keys to argument NAMES, so the client''s rpc(''reorder_map_node_stages'', { p_ids }) would 404.',
      coalesce(v_args::text, '(unnamed)');
  end if;

  -- ── NO BACKFILL, asserted ──
  -- A backfill written into this file would insert rows inside THIS transaction,
  -- and now() is the transaction timestamp, so those rows — and only those rows —
  -- carry updated_at = now(). Rows written by the app in any earlier transaction
  -- are strictly older. Adding an `insert … select` over map_nodes anywhere above
  -- therefore fails right here, which is the point: "no backfill" is a decision
  -- with reasons in the header, not an omission somebody can quietly correct.
  -- Equality, not `>=`: a row written by a DIFFERENT transaction that commits
  -- while this file is running carries that transaction's now(), which is never
  -- this one's. Only rows this migration wrote can match exactly, so an account
  -- manager recording a stage during the deploy cannot fail the apply.
  select count(*) into v_backfilled
    from public.map_node_progress where updated_at = now();

  if v_backfilled <> 0 then
    raise exception
      'NphiesCore 0026 FAILED: % map_node_progress row(s) were written by this migration. THERE IS NO BACKFILL, deliberately: a seeded stage asserts a fact nobody stated, destroys the "how many has nobody looked at" number on day one, and dates every stage_changed_at to the deploy — poisoning time-in-stage for the whole imported cohort. Bulk starting positions go through the importer, which is undoable.',
      v_backfilled;
  end if;

  raise notice
    'NphiesCore 0026 probe 1: % stages present (% terminal, % paused), all seven seeded names exist, no colour column, the Arabic index is partial, both progress FKs act as designed (cascade on node, set null on stage), map_node_progress_pkey is (node_id), the stamp is BEFORE INSERT OR UPDATE and sorts before the touch trigger, reorder_map_node_stages(p_ids uuid[]) resolves by argument name, and this file wrote 0 progress rows.',
    v_stages, v_terminal, v_paused;
end
$shape$;


-- ── probe 2: the stamp is the only writer, and the audit split holds ────────
-- Two claims that cannot be verified by reading the file:
--
--   (a) a client-supplied stage_changed_at does not survive — on insert, on a
--       real change, or on a no-op. This is the difference between a timestamp
--       that means "when this organization arrived on this rung" and one that
--       means "whatever the last request happened to contain".
--   (b) writing map_node_stages produces EXACTLY ONE config_audit row and
--       writing map_node_progress produces ZERO. That asymmetry IS the
--       permission design; if a future edit bolts an audit trigger onto
--       map_node_progress, every account manager's ordinary stage write starts
--       going through log_config_audit()'s guard and 42501s on a legitimate
--       edit, blamed on the wrong thing.
--
-- Everything is rolled back through the OT026 sentinel, fixtures included.
do $stamp$
declare
  v_track      uuid;
  v_node       uuid;
  v_stage_a    uuid;
  v_stage_b    uuid;
  v_probe      uuid;
  v_stamped    timestamptz;
  v_updated    timestamptz;
  v_audit0_s   int;
  v_audit0_p   int;
  v_audit_s    int := 0;
  v_audit_p    int := 0;
  v_bogus      timestamptz := timestamptz '2001-09-09 01:46:40+00';
begin
  -- `archived = false`, matching 0027's fixture selection: a probe that runs
  -- under an archived track is testing a shape nobody uses. An EXCEPTION and not
  -- a notice-and-return, for the reason this whole section opens on — a probe
  -- that passes vacuously is worse than none, and the two files must agree about
  -- that because they are applied in one sitting.
  select id into v_track from public.tracks
   where archived = false order by sort_order, id limit 1;
  if v_track is null then
    raise exception 'NphiesCore 0026 FAILED: there is no unarchived track, so the stamp probe has nowhere to hang a fixture node and every assertion below it would pass without running. Create (or unarchive) one track and re-run.';
  end if;

  -- Picked by POSITION, not by name. The names in the seed are a starting list
  -- Aziz renames, and a probe keyed to the literal 'kickoff' turns his first
  -- rename into a migration that refuses to re-apply — the same trap probe 1's
  -- seed-value assertions had. Any two distinct rungs prove the stamp; the seed
  -- guarantees seven.
  select id into v_stage_a from public.map_node_stages order by sort_order, id offset 0 limit 1;
  select id into v_stage_b from public.map_node_stages order by sort_order, id offset 1 limit 1;
  if v_stage_a is null or v_stage_b is null then
    raise exception 'NphiesCore 0026 FAILED: fewer than two stages exist, so the stamp probe cannot move a node between two rungs. The seed creates seven.';
  end if;

  -- Baselines taken BEFORE anything is written and OUTSIDE the fixture block:
  -- this file promises to be re-runnable, and a project that already holds a
  -- real audit trail must not fail on an absolute count.
  select count(*) into v_audit0_s from public.config_audit where table_name = 'map_node_stages';
  select count(*) into v_audit0_p from public.config_audit where table_name = 'map_node_progress';

  begin
    insert into public.map_nodes (track_id, name)
      values (v_track, '0026 Stamp Probe ' || gen_random_uuid())
      returning id into v_node;

    -- ── (a) INSERT: the client's timestamp is overruled ──
    insert into public.map_node_progress (node_id, stage_id, stage_changed_at)
      values (v_node, v_stage_a, v_bogus);

    select stage_changed_at, updated_at into v_stamped, v_updated
      from public.map_node_progress where node_id = v_node;

    if v_stamped is null then
      raise exception
        'NphiesCore 0026 FAILED: inserting a progress row WITH a stage left stage_changed_at null. The stamp''s INSERT arm is missing, and every row the importer creates would have no "in stage since" — the whole imported cohort, forever.';
    end if;

    if v_stamped = v_bogus then
      raise exception
        'NphiesCore 0026 FAILED: the stage_changed_at the client sent (%) survived the INSERT. The trigger is supposed to be the ONLY writer of that column; as it stands, time-in-stage is whatever the last request contained.',
        v_bogus;
    end if;

    if v_stamped is distinct from now() then
      raise exception
        'NphiesCore 0026 FAILED: stage_changed_at came back as % on insert, expected now() (%). Something other than map_node_progress_stage_stamp() wrote it.',
        v_stamped, now();
    end if;

    if v_updated is distinct from now() then
      raise exception
        'NphiesCore 0026 FAILED: updated_at came back as % on insert, expected now() (%). map_node_progress_touch()''s INSERT arm did not run, so a row written once and never touched again records no time and no author — which is most of this table.',
        v_updated, now();
    end if;

    -- ── (a) UPDATE to a DIFFERENT stage: still the trigger's value ──
    update public.map_node_progress
       set stage_id = v_stage_b, stage_changed_at = v_bogus, updated_at = v_bogus
     where node_id = v_node;

    select stage_changed_at, updated_at into v_stamped, v_updated
      from public.map_node_progress where node_id = v_node;

    if v_stamped = v_bogus then
      raise exception
        'NphiesCore 0026 FAILED: a stage change accepted the client''s stage_changed_at (%). The UPDATE arm is not overruling it.',
        v_bogus;
    end if;

    if v_stamped is distinct from now() then
      raise exception
        'NphiesCore 0026 FAILED: after moving the node to a different stage, stage_changed_at is % and not now() (%). The `is distinct from` arm did not re-stamp.',
        v_stamped, now();
    end if;

    if v_updated is distinct from now() then
      raise exception
        'NphiesCore 0026 FAILED: a stage change left updated_at at %, expected now() (%). Either the touch diff is not seeing stage_id / stage_changed_at, or the stamp trigger no longer sorts before it — "somebody moved this organization to Testing/UAT" is the most important human touch this table records.',
        v_updated, now();
    end if;

    -- ── (a) CLEARING the stage nulls the stamp, and the CHECK holds ──
    -- If the stamp failed to null it, this statement would raise 23514 from
    -- map_node_progress_stage_chk rather than reaching the assertion below —
    -- which is itself the proof that the constraint and the trigger agree.
    update public.map_node_progress
       set stage_id = null
     where node_id = v_node;

    select stage_changed_at into v_stamped
      from public.map_node_progress where node_id = v_node;

    if v_stamped is not null then
      raise exception
        'NphiesCore 0026 FAILED: clearing the stage left stage_changed_at at %. A timestamp about no stage is a timestamp about nothing, and map_node_progress_stage_chk should have refused the row.',
        v_stamped;
    end if;

    -- ── (b) the audit split ──
    -- One insert into the LADDER must produce exactly one config_audit row…
    insert into public.map_node_stages (name, sort_order)
      values ('0026 probe rung ' || left(gen_random_uuid()::text, 8), 900)
      returning id into v_probe;

    select count(*) - v_audit0_s into v_audit_s
      from public.config_audit where table_name = 'map_node_stages';

    -- …and everything done to the PROGRESS table above must have produced none.
    select count(*) - v_audit0_p into v_audit_p
      from public.config_audit where table_name = 'map_node_progress';

    raise exception using errcode = 'OT026', message = 'probe rollback';
  exception
    when sqlstate 'OT026' then
      null;
  end;

  if v_audit_s <> 1 then
    raise exception
      'NphiesCore 0026 FAILED: creating one stage wrote % config_audit rows, expected exactly 1. A rung rename with no trail is exactly what config_audit exists to prevent — and more than one means something else is writing the row in the same statement.',
      v_audit_s;
  end if;

  if v_audit_p <> 0 then
    raise exception
      'NphiesCore 0026 FAILED: writing map_node_progress produced % config_audit rows, expected 0. That table is deliberately NOT audited (0024:544): it is day-to-day fieldwork, and an audit trigger on it would ALSO send every account manager''s ordinary stage write through log_config_audit()''s permission guard — a 42501 on a legitimate edit, blamed on the wrong thing.',
      v_audit_p;
  end if;

  raise notice
    'NphiesCore 0026 probe 2: the stamp overruled a client-supplied stage_changed_at on insert and on a stage change, nulled it when the stage was cleared with the CHECK holding, updated_at tracked the stage change, one stage insert wrote exactly 1 config_audit row and the progress writes wrote 0. Rolled back.';
end
$stamp$;


-- ── probe 3: a member records progress and cannot touch the ladder ──────────
-- The claim the whole file rests on, and the one that cannot be verified by
-- reading it: THE LADDER IS THE OWNER'S, WHERE-WE-GOT-TO IS THE TEAM'S. Both
-- halves fail in opposite directions and both are asserted:
--
--   * a member who CANNOT write map_node_progress is the reason this table
--     exists instead of a column on map_nodes, so the positive assertion is the
--     point of the probe rather than a formality;
--   * a member who CAN write map_node_stages can rename "Live" and restate every
--     number in the portfolio.
--
-- The Director arm doubles as the check the design wrote a fourth probe for: a
-- structure.edit holder who is NOT an admin must be able to insert a stage, and
-- that write goes through map_node_stages_audit_trg → log_config_audit(), whose
-- guard (0025:1847) is the thing in the way. If that guard ever narrows back to
-- is_admin(), THIS is where it shows up.
--
-- The skip test is SCOPED TO THE ROLE SWITCH ALONE, and that scoping is the
-- point: a broken INSERT policy raises 42501 too, and wrapping the whole client
-- half would report it as "skipped" — a green migration with a Director who
-- cannot add a rung (0018:559 learned this the expensive way).
do $rls$
declare
  v_dir          uuid := gen_random_uuid();
  v_member       uuid := gen_random_uuid();
  v_dir_role     uuid;
  v_track        uuid;
  v_node         uuid;
  v_seeded       uuid;
  v_stage_a      uuid;
  v_stage_b      uuid;
  v_fixture      uuid;
  v_read         int  := 0;
  v_prog_read    int  := 0;
  v_prog_by      uuid;
  v_seeded_moved boolean := false;
  v_dir_insert   boolean := false;
  v_dir_update   boolean := false;
  v_dir_reorder  boolean := false;
  v_mem_wrote    boolean := false;
  v_mem_reorder  boolean := false;
  v_mem_prog_ins boolean := false;
  v_mem_prog_upd boolean := false;
  v_mem_prog_del boolean := false;
  v_skipped      boolean := false;
  v_no_dir_role  boolean := false;
begin
  select id into v_track from public.tracks
   where archived = false order by sort_order, id limit 1;
  if v_track is null then
    raise exception 'NphiesCore 0026 FAILED: there is no unarchived track, so the RLS probe cannot run — and a permissions probe that does not run is a permissions probe that passes. Create (or unarchive) one track and re-run.';
  end if;

  -- By POSITION rather than by name, for probe 2's reason: these rungs get
  -- renamed and a probe must not depend on the words.
  select id into v_stage_a from public.map_node_stages order by sort_order, id offset 0 limit 1;
  select id into v_stage_b from public.map_node_stages order by sort_order, id offset 1 limit 1;
  if v_stage_a is null or v_stage_b is null then
    raise exception 'NphiesCore 0026 FAILED: fewer than two stages exist, so the RLS probe cannot move a node between two rungs and its updated_by instrument would be vacuous.';
  end if;

  -- A role that grants structure.edit WITHOUT workspace.admin, so the probe
  -- proves the KEY is enough rather than proving that an admin can do anything.
  -- Looked up rather than pinned to the 'director' key, because 0025's whole
  -- point is that Aziz can rename or replace that role.
  select r.id into v_dir_role
    from public.roles r
    join public.role_permissions rp
      on rp.role_id = r.id and rp.permission_key = 'structure.edit' and rp.granted
   where not exists (
     select 1 from public.role_permissions rp2
      where rp2.role_id = r.id and rp2.permission_key = 'workspace.admin' and rp2.granted
   )
   order by r.sort_order, r.key
   limit 1;

  if v_dir_role is null then
    v_no_dir_role := true;
  end if;

  begin
    insert into auth.users (id, email, raw_user_meta_data) values
      (v_dir,    'probe-dir-'    || v_dir    || '@0026.invalid',
       jsonb_build_object('display_name', '0026 Probe Director')),
      (v_member, 'probe-member-' || v_member || '@0026.invalid',
       jsonb_build_object('display_name', '0026 Probe Member'));

    if (select count(*) from public.profiles where id in (v_dir, v_member)) <> 2 then
      raise exception 'NphiesCore 0026 PROBE 3 SETUP FAILED: handle_new_user() did not create the fixture profiles.';
    end if;

    -- No JWT yet, so guard_profile_role() lets this through: the privileged path
    -- the SQL Editor and the edge function use.
    if not v_no_dir_role then
      update public.profiles set role_id = v_dir_role where id = v_dir;
    end if;

    -- Two fixture nodes, created here as the applying role because creating
    -- nodes is structure.edit's job and is 0023's probe, not this one's.
    --
    --   v_node   — the member records a position on it from scratch.
    --   v_seeded — already carries a progress row written WITHOUT a JWT, so its
    --              updated_by is null. That null is the instrument: when the
    --              member moves this node to another rung, updated_by must come
    --              back as the MEMBER. The touch trigger only writes updated_by
    --              on the arm where the diff actually saw a change, so a null
    --              coming back means the diff missed the stage — which is the
    --              one failure the stamp/touch pair cannot be caught in any
    --              other way inside a single transaction, because now() does not
    --              move and every timestamp assertion is therefore vacuous.
    insert into public.map_nodes (track_id, name)
      values (v_track, '0026 RLS Probe ' || gen_random_uuid())
      returning id into v_node;

    insert into public.map_nodes (track_id, name)
      values (v_track, '0026 RLS Seeded ' || gen_random_uuid())
      returning id into v_seeded;

    insert into public.map_node_progress (node_id, stage_id)
      values (v_seeded, v_stage_a);

    if (select updated_by from public.map_node_progress where node_id = v_seeded) is not null then
      raise exception
        'NphiesCore 0026 PROBE 3 SETUP FAILED: a progress row written with no JWT came back with an updated_by. The instrument this probe depends on is not null, so the assertion below would pass for the wrong reason.';
    end if;

    begin
      perform set_config('request.jwt.claims',
                         json_build_object('sub', v_dir, 'role', 'authenticated')::text, true);
      set local role authenticated;
    exception when insufficient_privilege then
      v_skipped := true;
    end;

    if not v_skipped then
      -- ── as the structure.edit holder ──
      if not v_no_dir_role then
        -- The control that stops this arm passing because the fixture had no
        -- permissions rather than because the policy is right (0025's probe 5).
        if not public.has_perm('structure.edit') then
          raise exception
            'NphiesCore 0026 PROBE 3 SETUP FAILED: the fixture Director does not resolve to structure.edit, so nothing asserted below would mean anything.';
        end if;
        if public.is_admin() then
          raise exception
            'NphiesCore 0026 PROBE 3 SETUP FAILED: the fixture Director resolves to workspace.admin. The probe would then prove only that an admin can do anything.';
        end if;

        begin
          insert into public.map_node_stages (name, sort_order)
            values ('0026 dir rung ' || left(v_dir::text, 8), 901)
            returning id into v_fixture;
          v_dir_insert := true;
        exception when insufficient_privilege then
          null;  -- 42501, reported below
        end;

        if v_dir_insert then
          update public.map_node_stages set expected_days = 30 where id = v_fixture;
          if found then v_dir_update := true; end if;

          begin
            perform public.reorder_map_node_stages(
              array(select id from public.map_node_stages order by sort_order, name));
            v_dir_reorder := true;
          exception when insufficient_privilege then
            null;  -- 42501, reported below
          end;
        end if;
      end if;

      -- ── as a plain member ──
      perform set_config('request.jwt.claims',
                         json_build_object('sub', v_member, 'role', 'authenticated')::text, true);

      select count(*) into v_read from public.map_node_stages;

      -- THE POSITIVE HALF, and it is the reason map_node_progress exists.
      -- If an audit trigger is ever added to this table, THIS is the insert that
      -- starts raising 42501 through log_config_audit()'s guard.
      begin
        insert into public.map_node_progress (node_id, stage_id)
          values (v_node, v_stage_a);
        v_mem_prog_ins := true;
      exception when insufficient_privilege then
        null;
      end;

      if v_mem_prog_ins then
        update public.map_node_progress set stage_id = v_stage_b where node_id = v_node;
        if found then v_mem_prog_upd := true; end if;

        select count(*) into v_prog_read from public.map_node_progress;

        delete from public.map_node_progress where node_id = v_node;
        if found then v_mem_prog_del := true; end if;
      end if;

      -- The instrumented row: null updated_by in, the member's id out.
      update public.map_node_progress set stage_id = v_stage_b where node_id = v_seeded;
      if found then v_seeded_moved := true; end if;

      select updated_by into v_prog_by
        from public.map_node_progress where node_id = v_seeded;

      -- THE NEGATIVE HALF: the ladder itself is closed to them.
      -- A blocked UPDATE/DELETE affects zero rows rather than raising, which is
      -- the whole reason src/lib/permissions.ts exists. Count rows, do not catch.
      --
      -- ⚠ TARGETED AT A SEEDED RUNG, WHICH PROBE 1 HAS ALREADY PROVED EXISTS,
      --   and therefore UNCONDITIONAL. An earlier cut hung both statements off
      --   `if v_dir_insert then`, so on any workspace where the Director fixture
      --   could not be built — 0025's `director` role renamed or deleted, or
      --   every structure.edit role also holding workspace.admin — neither ran,
      --   and the notice below still reported that the member "could not touch
      --   the ladder". Had map_node_stages_update been copy-pasted as
      --   `is_member()` from the progress block eighty lines down (the exact
      --   mistake this probe exists to catch), the file would have shipped green
      --   with every member able to rename "Live" and restate every number in
      --   the portfolio.
      --
      --   `sort_order`, not `name`: a write that WRONGLY succeeded must land
      --   rather than trip map_node_stages_name_uidx, or the failure would
      --   disguise itself as a duplicate-name error and `found` would never be
      --   read. Both statements are inside the OT026 fixture block and roll back
      --   whatever they do.
      update public.map_node_stages set sort_order = sort_order + 1000 where id = v_stage_a;
      if found then v_mem_wrote := true; end if;

      delete from public.map_node_stages where id = v_stage_a;
      if found then v_mem_wrote := true; end if;

      -- The Director's own fixture rung too, when there was one: a policy that
      -- somehow distinguished rows by author would be caught here and not above.
      if v_dir_insert then
        update public.map_node_stages set sort_order = 9999 where id = v_fixture;
        if found then v_mem_wrote := true; end if;

        delete from public.map_node_stages where id = v_fixture;
        if found then v_mem_wrote := true; end if;
      end if;

      -- A blocked INSERT DOES raise, so this one is caught.
      begin
        insert into public.map_node_stages (name, sort_order)
          values ('0026 mem rung ' || left(v_member::text, 8), 902);
        v_mem_wrote := true;
      exception when insufficient_privilege then
        null;  -- 42501, as intended
      end;

      -- …and the RPC must refuse outright, by its explicit guard, rather than
      -- reporting zero rows moved as a successful drag.
      begin
        perform public.reorder_map_node_stages(
          array(select id from public.map_node_stages order by sort_order, name));
        v_mem_reorder := true;
      exception when insufficient_privilege then
        null;  -- 42501, as intended
      end;

      reset role;
    end if;

    raise exception using errcode = 'OT026', message = 'probe rollback';
  exception
    when sqlstate 'OT026' then
      null;
  end;

  if v_skipped then
    raise notice
      'NphiesCore 0026 probe 3 SKIPPED: this role cannot `set role authenticated`, so the RLS half could not run. The policies ARE installed. Verify by hand: sign in as a plain member and PATCH /rest/v1/map_node_stages (must affect zero rows) then POST /rest/v1/map_node_progress (must succeed).';
    return;
  end if;

  if v_read < 7 then
    raise exception
      'NphiesCore 0026 FAILED: a member read only % map_node_stages rows. map_node_stages_select is too strict — a member who cannot read the ladder gets a stage picker with nothing in it.',
      v_read;
  end if;

  if not v_mem_prog_ins then
    raise exception
      'NphiesCore 0026 FAILED: a plain member could not INSERT a map_node_progress row. That is the entire reason this table exists rather than a column on map_nodes: the three account managers are members, and gating this on structure.edit makes the two senior experts the data-entry bottleneck for data they do not collect.';
  end if;

  if not v_mem_prog_upd then
    raise exception
      'NphiesCore 0026 FAILED: a plain member could not UPDATE a map_node_progress row. Moving an organization to the next rung is the commonest write in the product.';
  end if;

  if not v_mem_prog_del then
    raise exception
      'NphiesCore 0026 FAILED: a plain member could not DELETE a map_node_progress row. Un-recording a position they recorded by mistake has to be theirs too, or the correction goes through an admin.';
  end if;

  if v_prog_read < 1 then
    raise exception
      'NphiesCore 0026 FAILED: a member read % map_node_progress rows after inserting one. map_node_progress_select is too strict and the portfolio would render every organization as unstaged.',
      v_prog_read;
  end if;

  if not v_seeded_moved then
    raise exception
      'NphiesCore 0026 FAILED: a member could not move a node that already had a progress row onto another rung. Correcting somebody else''s entry is the ordinary case, not the exception.';
  end if;

  -- The one assertion in this file that catches a touch trigger whose diff
  -- stopped reacting to a stage change. It was null before the member's write
  -- and the change arm is the only code that fills it.
  if v_prog_by is distinct from v_member then
    raise exception
      'NphiesCore 0026 FAILED: after a member moved an organization to another rung, updated_by is % and not the member (%). Either map_node_progress_touch()''s diff no longer sees stage_id / stage_changed_at — in which case updated_at stops moving on the single most important human touch this table records — or updated_by has stopped being resolved from auth.uid() and is whatever the client sent.',
      coalesce(v_prog_by::text, 'null'), v_member;
  end if;

  if v_mem_wrote then
    raise exception
      'NphiesCore 0026 FAILED: a plain member created, renamed or deleted a stage. The write policies are not gated on structure.edit — a member could rename "Live" and restate every number in the portfolio.';
  end if;

  if v_mem_reorder then
    raise exception
      'NphiesCore 0026 FAILED: reorder_map_node_stages() accepted a plain member. Its has_perm(''structure.edit'') guard is missing, so their drag would report success — and reordering the ladder restates every count-form goal.';
  end if;

  if v_no_dir_role then
    raise notice
      'NphiesCore 0026 probe 3: the member half passed IN FULL — read % stages, wrote/moved/removed a progress row with updated_by resolving to themselves, and could not insert, reposition or delete a seeded rung nor call reorder_map_node_stages. (Those negative arms target a seeded rung, so they run whether or not a Director fixture exists.) The structure.edit half was SKIPPED: no role grants structure.edit without workspace.admin. Verify by hand once a Director exists.',
      v_read;
    return;
  end if;

  if not v_dir_insert then
    raise exception
      'NphiesCore 0026 FAILED: a structure.edit holder who is NOT an admin could not insert a stage. Either map_node_stages_insert checks the wrong thing, or log_config_audit()''s guard has narrowed back to is_admin() and is refusing the audit row for a legitimate edit — the second one 42501s on the write and blames the wrong thing.';
  end if;

  if not v_dir_update then
    raise exception
      'NphiesCore 0026 FAILED: a structure.edit holder could not UPDATE a stage. Setting expected_days is how the Stalled threshold becomes configuration instead of a constant somebody invents in TypeScript.';
  end if;

  if not v_dir_reorder then
    raise exception
      'NphiesCore 0026 FAILED: reorder_map_node_stages() refused a structure.edit holder. A Director who can create a rung and cannot drag one has half a power and meets a 42501 on the gesture the ladder admin is mostly made of.';
  end if;

  raise notice
    'NphiesCore 0026 probe 3: a structure.edit holder (not an admin) created, edited and reordered a rung with the audit row landing; a plain member read % stages, recorded/moved/removed a progress row, moved a pre-existing one with updated_by resolving to themselves, and could neither create, reposition, delete nor reorder a stage. Rolled back.',
    v_read;
end
$rls$;


-- ── probe 4: writing the same value is a complete no-op ─────────────────────
-- The property everything else in this file rests on, on both tables:
--
--   * a PATCH writing the stage a node ALREADY holds must produce no stamp, no
--     diff, no updated_at bump and no author change — the row must come back
--     BYTE-IDENTICAL, even though the client sent deliberately wrong values for
--     all three of those columns. Compared as jsonb, so a new column added to
--     this table in a later migration is covered by this assertion for free.
--   * saving a stage with no change must leave THAT row byte-identical as well —
--     the re-save carries a bogus `updated_at`, because a store that holds the
--     row it read sends `updated_at` back with every blur — and must write no
--     config_audit row. The 30-second focus refetch and a screen that saves on
--     blur both re-send unchanged rows constantly; without this the audit trail
--     fills with rows recording that nothing happened, which is how an audit log
--     stops being read (0018:217's reason, asserted here rather than assumed).
--
-- This is the probe that a naive "stamp now() on every write" implementation
-- fails, and that implementation is the one somebody reaches for first.
do $noop$
declare
  v_track    uuid;
  v_node     uuid;
  v_stage_a  uuid;
  v_actor    uuid;
  v_probe    uuid;
  v_before   jsonb;
  v_after    jsonb;
  v_stage_before jsonb;
  v_stage_after  jsonb;
  v_name     text;
  v_audit0   int;
  v_audit    int := 0;
  v_bogus    timestamptz := timestamptz '2001-09-09 01:46:40+00';
begin
  select id into v_track from public.tracks
   where archived = false order by sort_order, id limit 1;
  if v_track is null then
    raise exception 'NphiesCore 0026 FAILED: there is no unarchived track, so the no-op probe has nowhere to hang a fixture node. Create (or unarchive) one track and re-run.';
  end if;

  -- By position, not by name (probe 2's reason).
  select id into v_stage_a from public.map_node_stages order by sort_order, id limit 1;
  if v_stage_a is null then
    raise exception 'NphiesCore 0026 FAILED: no stages exist, so the no-op probe cannot run.';
  end if;

  select count(*) into v_audit0 from public.config_audit where table_name = 'map_node_stages';

  -- Any real profile will do. It is planted as updated_by so that the no-op's
  -- attempt to write null over it has something to destroy: with a null already
  -- there, "null in, null out" would pass whether or not the else arm pinned it.
  select id into v_actor from public.profiles order by id limit 1;

  begin
    insert into public.map_nodes (track_id, name)
      values (v_track, '0026 No-op Probe ' || gen_random_uuid())
      returning id into v_node;

    -- No JWT here (the applying role), so map_node_progress_touch()'s INSERT arm
    -- leaves updated_by exactly as sent — which is what makes the plant possible.
    insert into public.map_node_progress (node_id, stage_id, updated_by)
      values (v_node, v_stage_a, v_actor);

    if v_actor is not null
       and (select updated_by from public.map_node_progress where node_id = v_node) is distinct from v_actor then
      raise exception
        'NphiesCore 0026 PROBE 4 SETUP FAILED: a JWT-less insert did not preserve the updated_by it was given. The SQL Editor, the service role and the CSV importer all write that way, and none of them can be attributed to a person.';
    end if;

    select to_jsonb(p) into v_before from public.map_node_progress p where p.node_id = v_node;

    -- The SAME stage, with three deliberately wrong values riding along. Every
    -- one of them must be discarded.
    update public.map_node_progress
       set stage_id         = v_stage_a,
           stage_changed_at = v_bogus,
           updated_at       = v_bogus,
           updated_by       = null
     where node_id = v_node;

    select to_jsonb(p) into v_after from public.map_node_progress p where p.node_id = v_node;

    if v_after is distinct from v_before then
      raise exception
        'NphiesCore 0026 FAILED: writing the stage a node already holds changed the row. Before: %. After: %. The `is distinct from` guard in the stamp, or the diff in the touch, is not holding — every no-op save would then move "in stage since" and time-in-stage would reset itself every time somebody opened the panel.',
        v_before, v_after;
    end if;

    -- ── the ladder half: an unchanged save writes no audit row ──
    insert into public.map_node_stages (name, sort_order)
      values ('0026 noop rung ' || left(gen_random_uuid()::text, 8), 903)
      returning id, name into v_probe, v_name;

    select to_jsonb(s) into v_stage_before from public.map_node_stages s where s.id = v_probe;

    -- Re-save every column as exactly what it already is — AND SEND A BOGUS
    -- `updated_at` WITH IT, which is what a store holding the row it read sends
    -- on every blur, because updated_at is in the row it read.
    --
    -- Without the else arm in map_node_stages_touch() the diff (which subtracts
    -- updated_at) is false, the `if` body is skipped, NEW keeps the client's
    -- value — and the audit trigger, which compares the FULL images, then writes
    -- a config_audit row recording a change that never happened. Both halves of
    -- that failure are asserted below: byte-identity first, then the audit count.
    update public.map_node_stages
       set name = v_name, sort_order = 903, hidden = false,
           terminal = false, paused = false, expected_days = null,
           updated_at = v_bogus
     where id = v_probe;

    select to_jsonb(s) into v_stage_after from public.map_node_stages s where s.id = v_probe;

    select count(*) - v_audit0 into v_audit
      from public.config_audit where table_name = 'map_node_stages';

    raise exception using errcode = 'OT026', message = 'probe rollback';
  exception
    when sqlstate 'OT026' then
      null;
  end;

  -- The ladder row must have come back byte-identical too, `updated_at`
  -- included. This is the assertion that fails if map_node_stages_touch() loses
  -- its else arm: the client's 2001 timestamp would land on the rung, and every
  -- "last edited" on the stage admin screen would be whatever the last request
  -- happened to carry.
  if v_stage_after is distinct from v_stage_before then
    raise exception
      'NphiesCore 0026 FAILED: re-saving a stage unchanged — with an updated_at riding along, which is what a store sends back the row it read — changed the row. Before: %. After: %. map_node_stages_touch() is not pinning updated_at in its else arm, so a client can date any rung''s last edit to any time it likes, and the audit trigger (which compares the full images) writes a trail row for a change that never happened.',
      v_stage_before, v_stage_after;
  end if;

  -- Exactly 1: the INSERT above. The re-save must have added nothing.
  if v_audit <> 1 then
    raise exception
      'NphiesCore 0026 FAILED: creating a stage and then re-saving it unchanged wrote % config_audit rows, expected exactly 1 (the insert). map_node_stages_touch()''s diff, or the audit trigger''s, is stamping unconditionally — and a 30-second focus refetch would then bury the rows that matter under rows recording that nothing happened.',
      v_audit;
  end if;

  raise notice
    'NphiesCore 0026 probe 4: writing a node''s existing stage left the progress row byte-identical (the client''s stage_changed_at, updated_at and updated_by were all discarded), and re-saving an unchanged stage — updated_at included — left the ladder row byte-identical and wrote no second audit row. Rolled back.';
end
$noop$;
