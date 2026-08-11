-- 0024 — the use-case catalogue, the node×use-case join, and entries.node_id.
--
-- WHAT THIS IS
-- 0023 gave the map a hierarchy: `map_nodes`, arbitrary depth, hanging BELOW the
-- tracks that were already there. This file gives that hierarchy the two things
-- the onboarding programme actually needs recorded against it —
--
--   1. WHAT an organization can integrate: `use_cases`, a bilingual, reorderable,
--      hideable catalogue of HL7/FHIR capabilities. Ten rows seeded, "and more to
--      be added later" is a first-class requirement, not a footnote.
--   2. WHICH organization integrated WHAT: `map_node_use_cases`, the join, with a
--      per-link `status`.
--
-- …and the one column that lets an entry be filed at a finer grain than a track:
-- `entries.node_id`, plus the trigger that makes "filed under two different
-- things at once" UNREPRESENTABLE rather than merely detectable.
--
--
-- ═══ WHY THIS CATALOGUE CAN ADD AND DELETE WHEN `vocab_options` CANNOT ═══
--
-- Read this before assuming one of the two admin screens is wrong. They are
-- both right, and the difference is not a matter of taste.
--
-- `vocab_options` is FROZEN — VocabularyAdmin offers rename, recolour, reorder
-- and hide, and deliberately offers no add and no delete (0003's header). The
-- reason is that a vocabulary KEY is stored in `entries.status` and, worse, in
-- `entry_updates.status_from` / `status_to`, which is an APPEND-ONLY narrative
-- record. Deleting the `blocked` status would not merely break the pickers; it
-- would strand history that says "moved from blocked to in_progress" pointing at
-- a key that no longer resolves, with no undo and no signal.
--
-- NOTHING stores a use-case key. Not `entries`, not `entry_updates`, not
-- `meeting_lines`. The ONLY reference to a use case anywhere in the schema is
-- `map_node_use_cases.use_case_id`, a real foreign key that the database itself
-- can protect. That is precisely why add and delete are safe here, and it is why
-- this feature is possible at all — asking Aziz to file a migration every time
-- Nphies publishes a new capability was never going to happen.
--
-- TWO DELIBERATE DIFFERENCES FROM `vocab_options`' SHAPE, then, both consequences
-- of the paragraph above:
--
--   * SURROGATE uuid PRIMARY KEY, not a frozen string key. `vocab_options` keys
--     on the string because the string is what `entries.status` STORES; a uuid
--     there would only add a lookup between the two things that matter. Here the
--     name is a LABEL and it will be renamed — "Medication Prescribe V1" is
--     somebody's working title for a spec that has not settled — and the join
--     has to keep pointing at the same row across that rename. Same reasoning,
--     opposite answer, as `track_groups` (0018:113).
--   * ADD AND DELETE EXIST. See above. The delete is still not free: the join's
--     FK is `on delete restrict`, so deleting a use case that twelve hospitals
--     are recorded against is refused by the database, loudly, instead of
--     silently erasing twelve rows of somebody's fieldwork.
--
-- `hidden` carries `vocab_options`' EXACT promise and it is worth restating
-- because it is the half people get wrong: hiding an option removes it from the
-- PICKERS and NEVER hides data that already holds it. An Org recorded against a
-- hidden use case still shows that use case in its panel. Hiding is "stop
-- offering this", not "pretend this never happened" — and `on delete restrict`
-- on the join is the same promise expressed as a constraint.
--
--
-- ═══ NO FAMILY/VERSION COLUMNS. THE VERSIONS ARE SEPARATE ROWS. ═══
--
-- "Medication Prescribe V1" and "Medication Prescribe V2" are two rows, each
-- named in full by the admin, and there is no `family` column and no `version`
-- column. The obvious alternative — family "Medication Prescribe" + version "V1",
-- composed at render time — breaks the bilingual contract: the composed string
-- has no `name_ar`, so Arabic would render an Arabic family name welded to a
-- Latin version token at EVERY render site, and every one of those sites would
-- need its own bidi isolate. One row per version puts the isolate at the
-- boundary, once, where the name enters the UI. It also lets the admin name a
-- version whatever Nphies actually calls it, which is the thing that changes.
--
--
-- ═══ THE ARABIC IS SEEDED BLANK, ON PURPOSE ═══
--
-- Every seeded row gets `name_ar = ''`. A plausible-but-wrong Arabic term for a
-- clinical capability looks FINISHED — nobody re-reads a translated string — and
-- the people who will read this map in Arabic are the people who would be misled
-- by it. A blank one visibly asks to be translated in the catalogue screen. The
-- resolver behaviour is `vocab_options`' (0003:31-35): empty means "no
-- translation", and the English name is what renders until an admin types one.
--
--
-- Deploy: Supabase Dashboard → SQL Editor → paste + Run, AFTER 0023. Re-runnable
-- from the top in any partial state, same discipline as 0001–0023: `create table
-- if not exists`, `add column if not exists`, `drop constraint if exists` before
-- every add, `drop policy if exists` before every create, `drop trigger if
-- exists` before every create, `create or replace` on every function, seeds
-- `on conflict … do nothing`, and probe blocks at the bottom that roll themselves
-- back. A probe failure raises and the whole migration rolls back — no explicit
-- begin/commit here, for the reason 0009's header spells out.


-- ── preflight: 0023 first ───────────────────────────────────────────────────
-- Everything below references `public.map_nodes`. Without this block the first
-- failure is a bare 42P01 from the middle of a CREATE TABLE, which reads like a
-- broken file rather than a missing prerequisite.
do $preflight$
begin
  if to_regclass('public.map_nodes') is null then
    raise exception
      'OpsTrack 0024 CANNOT APPLY: public.map_nodes does not exist. Apply 0023_map_nodes.sql first — this file adds the use-case catalogue, the node join and entries.node_id, all of which hang off it.';
  end if;
end
$preflight$;


-- ── use_cases ───────────────────────────────────────────────────────────────
create table if not exists public.use_cases (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  name_ar    text not null default '',
  sort_order int not null default 0,
  hidden     boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null
);

comment on table public.use_cases is
  'The HL7/FHIR capability catalogue an organization is onboarded onto: ADT, Medication Prescribe V1/V2, and so on. vocab_options'' shape, but UNFROZEN — add and delete exist here because no key of this table is stored anywhere except map_node_use_cases.use_case_id, which is a real FK the database can protect. Versions are separate rows, not a version column; see the file header for why.';

comment on column public.use_cases.name_ar is
  'Seeded BLANK on all ten rows, deliberately. Empty means "no translation" (vocab_options'' rule) and the English name renders until an admin types one — a blank cell asks to be filled, a wrong clinical term does not.';

comment on column public.use_cases.hidden is
  'Removes the option from PICKERS. It never hides data that already holds it: an Org recorded against a hidden use case still renders it. Same promise as vocab_options.hidden, and the join''s `on delete restrict` is the same promise as a constraint.';

-- AND THERE IS DELIBERATELY NO "you cannot hide them all" GUARD, unlike
-- vocab_keep_one_visible() (0003:237). That trigger exists because hiding every
-- status empties the board of COLUMNS and the capture form of CHOICES, and the
-- only way back is the SQL Editor — a trap with no in-app exit. Hiding every use
-- case empties a checklist inside one panel; the catalogue screen still lists all
-- ten with their toggles, so the way back is the same screen you got there from.
-- A floor that protects nothing is a rule somebody has to discover the hard way
-- the first time they legitimately want to retire the lot.

-- For a project where an earlier cut of this file already landed: `create table
-- if not exists` above is a no-op there, so the columns have to be added
-- separately or the constraints below fail against a table that lacks them.
-- Same reasoning as 0017:129 and 0018:136-139.
alter table public.use_cases add column if not exists name_ar    text not null default '';
alter table public.use_cases add column if not exists sort_order int not null default 0;
alter table public.use_cases add column if not exists hidden     boolean not null default false;
alter table public.use_cases add column if not exists created_at timestamptz not null default now();
alter table public.use_cases add column if not exists updated_at timestamptz not null default now();
alter table public.use_cases add column if not exists created_by uuid references public.profiles (id) on delete set null;
alter table public.use_cases add column if not exists updated_by uuid references public.profiles (id) on delete set null;

-- 60 rather than `track_groups`' 40. A track group is a two-word container an
-- admin invents; a use case is the name of a published capability and is not
-- ours to shorten ("Medication Prescribe V1" is already 23, and nothing says the
-- next one is not "Prior Authorisation Request/Response V2"). btrim before
-- measuring: '   ' is an empty name wearing a hat.
alter table public.use_cases drop constraint if exists use_cases_name_len_chk;
alter table public.use_cases add constraint use_cases_name_len_chk
  check (char_length(btrim(name)) between 1 and 60);

alter table public.use_cases drop constraint if exists use_cases_name_ar_len_chk;
alter table public.use_cases add constraint use_cases_name_ar_len_chk
  check (char_length(name_ar) <= 60);

-- Case-insensitive, exactly like tracks_name_uidx and track_groups_name_uidx:
-- "Lab Order" and "lab order" are one capability, and finding out otherwise
-- costs a reader a double-take on every screen that lists them. This index is
-- also the conflict target the seed below arbitrates on.
create unique index if not exists use_cases_name_uidx
  on public.use_cases (lower(name));

-- PARTIAL, because name_ar defaults to '' and this file seeds ten rows that way.
-- A plain unique index would let exactly one use case go untranslated and reject
-- the other nine with a duplicate-name error naming the wrong field. Same shape
-- as tracks_name_ar_uidx (0002) and track_groups_name_ar_uidx (0018:174).
create unique index if not exists use_cases_name_ar_uidx
  on public.use_cases (lower(name_ar)) where name_ar <> '';

-- Every read is "the catalogue, in order" — the checklist in the Org panel, the
-- catalogue admin screen, the filter facet.
create index if not exists use_cases_sort_idx on public.use_cases (sort_order);

alter table public.use_cases enable row level security;

-- MEMBER READ, ADMIN WRITE — `tracks`' and `track_groups`' policy set, and the
-- ADMIN OWNS THE SHAPE half of this file's product call (the other half is on
-- map_node_use_cases below, and it goes the other way — read that comment too).
-- Aziz defines what the capabilities ARE; nobody else gets to invent one on the
-- fly, because a catalogue anybody can extend stops being a catalogue and
-- becomes free text with extra steps.
--
-- A member MUST be able to READ it. A member who cannot read use_cases sees an
-- Org panel with an empty use-case matrix, which is indistinguishable from an
-- Org that has integrated nothing — the single most misleading state this
-- feature can produce.
--
-- 0009's InitPlan form `(select public.is_member())` so the predicate is
-- evaluated once per statement rather than once per surviving row.
drop policy if exists use_cases_select on public.use_cases;
create policy use_cases_select on public.use_cases
  for select using ((select public.is_member()));

drop policy if exists use_cases_insert on public.use_cases;
create policy use_cases_insert on public.use_cases
  for insert with check ((select public.is_admin()));

drop policy if exists use_cases_update on public.use_cases;
create policy use_cases_update on public.use_cases
  for update using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists use_cases_delete on public.use_cases;
create policy use_cases_delete on public.use_cases
  for delete using ((select public.is_admin()));

-- Explicit, rather than relying on Supabase's default privileges for new tables
-- in `public` — 0018:207-214's reasoning verbatim. `anon` is left exactly as the
-- project's defaults have it, matching every other table here; the anon key
-- cannot pass is_member() in any case.
grant select, insert, update, delete on public.use_cases to authenticated;

-- Diffed rather than stamped unconditionally, for the reason vocab_touch() and
-- track_groups_touch() give: a reorder writes several rows in one statement, and
-- an unconditional stamp would report the whole catalogue as edited — and emit a
-- full set of audit rows — on a drag that moved one option.
--
-- updated_by is resolved THROUGH profiles rather than taken raw from auth.uid():
-- a JWT without a profile row would violate the FK, and the failure would
-- surface as the admin's perfectly legitimate rename being rejected. Same
-- reasoning as vocab_touch() (0003:208-210).
create or replace function public.use_cases_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (to_jsonb(new) - 'updated_at' - 'updated_by')
     is distinct from
     (to_jsonb(old) - 'updated_at' - 'updated_by') then
    new.updated_at := now();
    new.updated_by := coalesce(
      (select p.id from public.profiles p where p.id = auth.uid()),
      old.updated_by
    );
  else
    -- The `else` 0015:239-244 had to add to entries_guard_update(). Subtracting
    -- updated_by from the diff and then leaving NEW alone hands a client a
    -- one-field PATCH — {"updated_by": null} — that erases the mark without
    -- changing anything else and without moving a clock.
    new.updated_by := old.updated_by;
  end if;
  return new;
end;
$$;

drop trigger if exists use_cases_touch_trg on public.use_cases;
create trigger use_cases_touch_trg
  before update on public.use_cases
  for each row execute function public.use_cases_touch();

-- AFTER, not BEFORE: the row image recorded must be the one that survived every
-- other trigger and constraint. Identical in shape to track_groups_audit()
-- (0018:243) — renaming or deleting a capability is a configuration change made
-- by one person with no second pair of eyes, which is the case config_audit
-- exists for, and `before` is the only record of what the row used to say.
--
-- row_id IS populated here, unlike vocab_audit() (0003:290-293), because this
-- table has a uuid identity to put in it. That is the surrogate key earning its
-- keep a second time.
create or replace function public.use_cases_audit()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    -- Casts on the null: with a single candidate Postgres resolves an untyped
    -- null anyway, but an overload added later would make this ambiguous at
    -- runtime, inside a trigger, on someone else's write. 0018:250-252.
    perform public.log_config_audit('use_cases', new.id, 'insert', null::jsonb, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    if to_jsonb(new) is distinct from to_jsonb(old) then
      perform public.log_config_audit('use_cases', new.id, 'update', to_jsonb(old), to_jsonb(new));
    end if;
    return new;
  else
    perform public.log_config_audit('use_cases', old.id, 'delete', to_jsonb(old), null::jsonb);
    return old;
  end if;
end;
$$;

drop trigger if exists use_cases_audit_trg on public.use_cases;
create trigger use_cases_audit_trg
  after insert or update or delete on public.use_cases
  for each row execute function public.use_cases_audit();


-- ── seed: the ten capabilities ──────────────────────────────────────────────
-- FLAT, in the order Aziz listed them, which is also the order they are worked:
-- ADT first because nothing else means anything without patient identity, then
-- medication, then radiology, then lab, then notes. `sort_order` is what the
-- admin drags, so this is a starting arrangement, not a claim.
--
-- `on conflict … do nothing` rather than `do update`, exactly like 0001's track
-- seed and 0018's group seed: these are editable in Settings › Catalogue and
-- re-running this migration must not stomp a renamed row, a translated one, a
-- reordered one or a hidden one.
--
-- name_ar is '' on all ten. See the header — this is the deliberate blank, not
-- an oversight, and the catalogue screen is where it gets filled in.
insert into public.use_cases (name, name_ar, sort_order) values
  ('ADT',                     '',  1),
  ('Medication Prescribe V1', '',  2),
  ('Medication Prescribe V2', '',  3),
  ('Medication Dispense V1',  '',  4),
  ('Medication Dispense V2',  '',  5),
  ('Radiology Order',         '',  6),
  ('Radiology Report',        '',  7),
  ('Lab Order',               '',  8),
  ('Lab Results',             '',  9),
  ('Clinical Notes',          '', 10)
on conflict (lower(name)) do nothing;


-- ── map_node_use_cases ──────────────────────────────────────────────────────
-- The join: which node integrated which capability, and how far along it is.
--
-- PRIMARY KEY (node_id, use_case_id) — the pair IS the identity. A surrogate
-- would allow two rows saying different things about the same Org and the same
-- capability, which is the one shape this table must not be able to hold, and it
-- would push the uniqueness into an index nobody reads.
--
-- THE TWO FK ACTIONS ARE OPPOSITE ON PURPOSE:
--
--   node_id … ON DELETE CASCADE. A link is meaningless without its node — "some
--     deleted organization integrated Lab Order" is not a fact worth keeping. In
--     practice this rarely fires: 0023's node delete guard refuses to delete a
--     node that still has work under it, so the cascade is the tidy-up for a
--     genuinely empty node, not a data-loss path.
--
--   use_case_id … ON DELETE RESTRICT. Deleting "Lab Results" must not silently
--     erase the record of which twelve hospitals integrated it. The admin screen
--     gets a 23503 and has to say so; `hidden = true` is the answer for "we
--     stopped offering this", and it is the answer precisely because it keeps the
--     twelve rows. This is `hidden`'s promise from the header, expressed as a
--     constraint the database enforces rather than a rule a screen remembers.
--
-- `status` SHIPS FROM DAY ONE EVEN THOUGH v1 RENDERS ONLY A CHECKLIST.
-- The v1 UI draws a checkbox per capability; the v2 UI draws planned/testing/live
-- and Aziz will ask for it the first time he presents this to a steering group
-- and gets asked "live, or live-ish?". The column costs one `text not null
-- default 'live'` today and makes that upgrade a ZERO-MIGRATION UI change. The
-- default is 'live' and not 'planned' because v1's checkbox means "yes, this is
-- integrated" — a v1 tick that landed as 'planned' would silently rewrite the
-- meaning of every row entered before the v2 screen exists.
create table if not exists public.map_node_use_cases (
  node_id      uuid not null references public.map_nodes (id) on delete cascade,
  use_case_id  uuid not null references public.use_cases (id) on delete restrict,
  status       text not null default 'live'
                 check (status in ('planned', 'testing', 'live')),
  -- Jira provenance, the same five columns 0023 puts on map_nodes and for the
  -- same reason: Jira is gated ("I cannot connect the app to Jira until we
  -- verify the tracker very well"), so it is NOT built — but the recorded plan
  -- is one Jira issue per Organization × use case, which is exactly this row.
  -- Adding the columns now costs nothing and means the sync, when it is built,
  -- is not also a migration against a table full of real fieldwork.
  --
  -- `overrides` is the per-field editing contract: a field listed here was
  -- edited HERE and the sync must not stomp it. It is set by whoever writes the
  -- sync, keyed on `auth.uid() is null` (a person has a JWT; the sync, running
  -- as the service role, does not).
  source       text not null default 'local',
  external_ref text,
  external_url text,
  synced_at    timestamptz,
  overrides    text[] not null default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.profiles (id) on delete set null,
  updated_by   uuid references public.profiles (id) on delete set null,
  primary key (node_id, use_case_id)
);

comment on table public.map_node_use_cases is
  'Which map node integrated which use case, and how far along. MEMBER-WRITE, unlike use_cases: the admin owns the catalogue, the team records the fieldwork. status ships planned|testing|live from day one although v1 renders a checklist, so the richer version is a zero-migration UI change.';

comment on column public.map_node_use_cases.status is
  'planned | testing | live, default live. v1''s checkbox means "integrated", which is what live means — defaulting to planned would silently rewrite every row entered before the v2 screen exists.';

-- For a project where an earlier cut of this file already landed.
alter table public.map_node_use_cases add column if not exists status       text not null default 'live';
alter table public.map_node_use_cases add column if not exists source       text not null default 'local';
alter table public.map_node_use_cases add column if not exists external_ref text;
alter table public.map_node_use_cases add column if not exists external_url text;
alter table public.map_node_use_cases add column if not exists synced_at    timestamptz;
alter table public.map_node_use_cases add column if not exists overrides    text[] not null default '{}';
alter table public.map_node_use_cases add column if not exists created_at   timestamptz not null default now();
alter table public.map_node_use_cases add column if not exists updated_at   timestamptz not null default now();
alter table public.map_node_use_cases add column if not exists created_by   uuid references public.profiles (id) on delete set null;
alter table public.map_node_use_cases add column if not exists updated_by   uuid references public.profiles (id) on delete set null;

-- Named, so the day this list grows it is a one-line edit against a name we
-- chose rather than archaeology against a Postgres-generated identifier — 0002's
-- opening paragraph. The inline check above covers a fresh create; this covers a
-- table that already existed without it.
alter table public.map_node_use_cases drop constraint if exists map_node_use_cases_status_chk;
alter table public.map_node_use_cases add constraint map_node_use_cases_status_chk
  check (status in ('planned', 'testing', 'live'));

-- 'local' | 'jira'. This MUST agree with map_nodes' equivalent in 0023: two
-- tables disagreeing about the vocabulary of provenance is how a sync ends up
-- writing rows one screen can read and the other cannot. Constrained separately
-- (rather than by referencing 0023's constraint) so this file does not depend on
-- the exact name that file chose.
alter table public.map_node_use_cases drop constraint if exists map_node_use_cases_source_chk;
alter table public.map_node_use_cases add constraint map_node_use_cases_source_chk
  check (source in ('local', 'jira'));

-- The PK indexes (node_id, use_case_id), which serves "what did this Org
-- integrate" — the Org panel's question. This one serves the OTHER direction:
-- "which organizations integrated Lab Results", the executive's question, and it
-- is also what makes the `on delete restrict` check above cheap rather than a
-- seq scan per catalogue delete.
create index if not exists map_node_use_cases_use_case_idx
  on public.map_node_use_cases (use_case_id);

alter table public.map_node_use_cases enable row level security;

-- ═══ MEMBER READ, **MEMBER WRITE** — the most consequential call in this file ═══
--
-- Every other configuration table in this schema is admin-write: tracks,
-- track_groups, vocab_options, map_node_kinds, map_nodes, and use_cases twenty
-- lines up. This one is not, and the asymmetry is the point rather than an
-- oversight.
--
-- Aziz defines the SHAPE — what the programme's phases are, which organizations
-- exist, what the capability catalogue contains. His two interns do the
-- FIELDWORK — they sit with a vendor, establish that Hospital X's ADT feed is
-- actually flowing, and record it. Admin-gating this table would make Aziz the
-- data-entry bottleneck for the data his interns collect, which is the exact
-- opposite of why the map is being built: he wants to LOOK at the answer, not
-- type it in.
--
-- It mirrors `tracks` (admin) vs `entries` (member) exactly, which is the split
-- this app has run on since 0001 and the one everybody here already understands.
-- The catalogue is vocabulary; a link is a record of work.
--
-- The blast radius of getting it wrong is asymmetric too, which is the tiebreak:
-- a member who wrongly CAN write invents a link that an admin can see and delete;
-- a member who wrongly CANNOT write hands the data collection back to one person
-- and the map goes stale, silently, because nobody files a bug that says "I
-- stopped bothering".
--
-- Probe 3 at the bottom asserts this POSITIVELY — a member inserting AND deleting
-- a row — because a copy-pasted `is_admin()` here would ship silently inverted
-- and would look exactly like every other policy block in the schema.
drop policy if exists map_node_use_cases_select on public.map_node_use_cases;
create policy map_node_use_cases_select on public.map_node_use_cases
  for select using ((select public.is_member()));

drop policy if exists map_node_use_cases_insert on public.map_node_use_cases;
create policy map_node_use_cases_insert on public.map_node_use_cases
  for insert with check ((select public.is_member()));

drop policy if exists map_node_use_cases_update on public.map_node_use_cases;
create policy map_node_use_cases_update on public.map_node_use_cases
  for update using ((select public.is_member())) with check ((select public.is_member()));

drop policy if exists map_node_use_cases_delete on public.map_node_use_cases;
create policy map_node_use_cases_delete on public.map_node_use_cases
  for delete using ((select public.is_member()));

grant select, insert, update, delete on public.map_node_use_cases to authenticated;

-- created_by/updated_by are SERVER TRUTH about the write, not fields the screen
-- offers, so they are overwritten rather than trusted — `entries_guard_insert()`'s
-- rule (0015:330-338) at one table's scale. The JWT-less passthrough is the same
-- one the whole schema uses: the SQL Editor, the service role and a future Jira
-- sync all act without a `sub` claim and must be able to write rows that are
-- honestly attributed to nobody.
--
-- Resolved THROUGH profiles for the FK reason vocab_touch() gives.
create or replace function public.map_node_use_cases_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  new.created_by := (select p.id from public.profiles p where p.id = auth.uid());
  new.updated_by := null;
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists map_node_use_cases_stamp_trg on public.map_node_use_cases;
create trigger map_node_use_cases_stamp_trg
  before insert on public.map_node_use_cases
  for each row execute function public.map_node_use_cases_stamp();

-- THREE columns are subtracted from the diff, and the third is the one that
-- matters later: `synced_at`. A nightly Jira sync that touches nothing but the
-- timestamp it stamps on itself must not report every link in the workspace as
-- edited — that is one bogus "updated" mark per Org per capability per night, on
-- data nobody changed. Same class of bug as 0007, caught before it ships this
-- time. The plan says the same thing about map_nodes, and 0023 owns that half.
create or replace function public.map_node_use_cases_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (to_jsonb(new) - 'updated_at' - 'updated_by' - 'synced_at')
     is distinct from
     (to_jsonb(old) - 'updated_at' - 'updated_by' - 'synced_at') then
    new.updated_at := now();
    new.updated_by := coalesce(
      (select p.id from public.profiles p where p.id = auth.uid()),
      old.updated_by
    );
  else
    new.updated_by := old.updated_by;
  end if;
  -- Identity and provenance of the row's creation are not editable by anyone.
  new.created_at := old.created_at;
  new.created_by := old.created_by;
  return new;
end;
$$;

drop trigger if exists map_node_use_cases_touch_trg on public.map_node_use_cases;
create trigger map_node_use_cases_touch_trg
  before update on public.map_node_use_cases
  for each row execute function public.map_node_use_cases_touch();

-- THERE IS DELIBERATELY NO config_audit TRIGGER ON THIS TABLE, and the omission
-- is the same call as the RLS split above. config_audit is for CONFIGURATION —
-- rare, consequential changes made by one person with nobody watching (0003:285).
-- `entries` is not audited there either, and for the same reason: this is
-- day-to-day fieldwork by two interns, and auditing it would produce a config
-- trail dominated by routine data entry, which is how an audit log stops being
-- read. `use_cases` — the catalogue, the thing one person owns — IS audited,
-- twenty lines up.


-- ── entries.node_id ─────────────────────────────────────────────────────────
-- NULLABLE, and `on delete set null`. Both halves are load-bearing, and they are
-- the same halves as `tracks.group_id` (0018:319-328):
--
--   * nullable, because "filed to a track and no finer" is the state EVERY
--     existing row is in and a perfectly ordinary one forever. 27 live entries
--     have no node and must not become invalid; an entry captured from the phone
--     with `#network` has no node either.
--   * `set null`, because deleting a node must never take work with it. The
--     entry falls back to being filed at its track — which is exactly what the
--     trigger below says track_id means when node_id is null.
alter table public.entries
  add column if not exists node_id uuid references public.map_nodes (id) on delete set null;

comment on column public.entries.node_id is
  'Optional finer grain beneath the track (0024). NULL means "filed at the track", which is a legal and permanent state. When it is set, entries_map_sync() DERIVES track_id from the node — track_id is authoritative when this is null and derived when it is not, so the two can never disagree.';

-- PARTIAL, `where node_id is not null`. Every query that uses this column asks
-- "what is filed under this node"; nothing asks for the nulls, which today are
-- 100% of the table and will stay the majority for a long time. A full index
-- would be mostly a list of nulls that the planner never reads.
create index if not exists entries_node_idx
  on public.entries (node_id) where node_id is not null;


-- ── entries_map_sync(): the invariant, DERIVED and not asserted ─────────────
--
-- THE PROBLEM. An entry now has two things that say where it is filed:
-- `track_id`, which the whole app already depends on (trackVars() colour, the
-- track_slas track×priority matrix, loadTrackTimeline, MapBranch.trackIdOf), and
-- `node_id`, the new finer grain. Two columns naming a location is two filing
-- axes, and two filing axes is a bug generator: a row under Org1 (which lives
-- under the UHR track) carrying track_id = Network renders in one colour on the
-- map, under a different SLA in the matrix, and in a fourth place in the digest.
--
-- THE USUAL ANSWER — a CHECK or a validation trigger asserting that they agree —
-- makes the disagreement DETECTED. Every client then has to compute the right
-- track before it writes, every one of them has to get it right forever, and the
-- failure mode is a 23514 in front of a member who did nothing wrong.
--
-- THIS ANSWER makes the disagreement UNREPRESENTABLE. `track_id` is
-- authoritative when `node_id` is null and DERIVED when it is not. A client that
-- sends a contradictory track_id is not rejected; it is simply overruled, and the
-- contradiction never exists in a stored row. There is one filing axis with an
-- optional finer grain, which is what the product actually means.
--
--   ⚠ TWO SUBTLETIES, both of which look like trivia and are not:
--
-- ① THE TRIGGER NAME IS LOAD-BEARING. Postgres fires BEFORE ROW triggers in NAME
--    order. On entries that gives, today:
--
--      UPDATE:  entries_guard_update  →  entries_map_sync  →  entries_touch_trg
--      INSERT:  entries_guard_insert  →  entries_insert_trg  →  entries_map_sync
--
--    `entries_map_sync` is named so that g < m < t. The guard therefore diffs the
--    CLIENT's row — before this function rewrites track_id — so `updated_by` is
--    stamped for the member's actual edit and not for the derivation. Rename this
--    trigger to anything sorting outside that window and the stamp starts
--    recording the wrong thing, silently, with no compile-time signal. Probe 1
--    asserts the ordering from pg_trigger for exactly that reason.
--
-- ② `entries_touch()` ALREADY SUBTRACTS `track_id` FROM ITS ACTIVITY DIFF
--    (0002:100-102, corrected in 0007), so a node-driven track change moves
--    `updated_at` and does NOT move `last_activity_at`. FILING IS BOOKKEEPING,
--    NOT ACTIVITY. Without that, re-parenting one department under a different
--    programme would launder forty genuinely stale items into freshly-worked ones
--    and the next morning's digest would go quiet about all of them — the precise
--    failure 0007 exists to have fixed once. Probe 2 re-proves it here, on this
--    new path, because the assertion is what catches a future edit to
--    entries_touch()'s diff.
--
-- SECURITY DEFINER, and it is not decoration. If this read of map_nodes ran under
-- the caller's RLS and that caller could not see the node, `found` would be false
-- and the client's contradictory track_id would SURVIVE — the one outcome this
-- function exists to prevent, arriving silently and only for some users. A
-- definer read cannot be talked out of the invariant.
create or replace function public.entries_map_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_track uuid;
begin
  -- node_id null: track_id is authoritative and this function has no opinion.
  -- That is the state every entry in the workspace is in today.
  if new.node_id is null then
    return new;
  end if;

  select n.track_id into v_track from public.map_nodes n where n.id = new.node_id;

  -- Assign only if the node was actually found. A missing node is about to be
  -- refused by the FK on node_id with an error that names the real problem;
  -- writing a null track_id here first would replace it with a confusing one.
  if found then
    new.track_id := v_track;
  end if;

  return new;
end;
$$;

comment on function public.entries_map_sync() is
  'BEFORE INSERT OR UPDATE on entries. When node_id is set, DERIVES track_id from map_nodes — so a client cannot file a row under two different things at once; the disagreement is unrepresentable rather than detected. The trigger NAME is load-bearing: it must sort after entries_guard_update and before entries_touch_trg.';

drop trigger if exists entries_map_sync on public.entries;
create trigger entries_map_sync
  before insert or update on public.entries
  for each row execute function public.entries_map_sync();


-- ════════════════════════════════════════════════════════════════════════════
-- PROBE 1 — the shape, and the trigger ORDER, checked against the live database
-- ════════════════════════════════════════════════════════════════════════════
-- Runs as whoever applies the file (the SQL Editor, i.e. no JWT), which is the
-- right role here: this probe tests the objects, not the policies. RLS is probe
-- 3's job and the invariant is probe 2's.
--
-- The trigger-order assertion is the interesting one. Subtlety ① above is a rule
-- about a NAME, enforced by nothing — no constraint, no type, no test in the
-- TypeScript suite can see it. So it is asserted here, read back out of
-- pg_trigger, on every run.
do $shape$
declare
  v_cases   int;
  v_missing text;
  v_names   text[];
  v_guard   int;
  v_sync    int;
  v_touch   int;
begin
  select count(*) into v_cases from public.use_cases;

  -- Named, because "10 rows" would also be satisfied by ten of the wrong ones.
  select string_agg(want, ', ') into v_missing
    from (values
      ('ADT'), ('Medication Prescribe V1'), ('Medication Prescribe V2'),
      ('Medication Dispense V1'), ('Medication Dispense V2'),
      ('Radiology Order'), ('Radiology Report'),
      ('Lab Order'), ('Lab Results'), ('Clinical Notes')
    ) as w(want)
   where not exists (
     select 1 from public.use_cases u where lower(u.name) = lower(w.want)
   );

  if v_missing is not null then
    raise exception
      'OpsTrack 0024 FAILED: these use cases were not seeded: %. The catalogue insert did not land, or a name collided with a row an admin created first.',
      v_missing;
  end if;

  if v_cases < 10 then
    raise exception
      'OpsTrack 0024 FAILED: % use_cases rows, expected at least 10.', v_cases;
  end if;

  if to_regclass('public.map_node_use_cases') is null then
    raise exception 'OpsTrack 0024 FAILED: public.map_node_use_cases does not exist.';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'entries' and column_name = 'node_id'
  ) then
    raise exception
      'OpsTrack 0024 FAILED: entries.node_id does not exist, so nothing can be filed beneath a track.';
  end if;

  -- ── the name-order assertion ──────────────────────────────────────────────
  -- BEFORE ROW UPDATE triggers on entries, in the order Postgres will fire them.
  -- tgtype bits: 1=ROW, 2=BEFORE, 4=INSERT, 8=DELETE, 16=UPDATE.
  select array_agg(t.tgname order by t.tgname) into v_names
    from pg_trigger t
   where t.tgrelid = 'public.entries'::regclass
     and not t.tgisinternal
     and (t.tgtype & 2) <> 0
     and (t.tgtype & 16) <> 0;

  v_guard := array_position(v_names, 'entries_guard_update');
  v_sync  := array_position(v_names, 'entries_map_sync');
  v_touch := array_position(v_names, 'entries_touch_trg');

  if v_sync is null then
    raise exception
      'OpsTrack 0024 FAILED: no BEFORE UPDATE trigger named entries_map_sync on entries. Found: %.', v_names;
  end if;

  if v_guard is null or v_sync < v_guard then
    raise exception
      'OpsTrack 0024 FAILED: entries_map_sync fires before entries_guard_update (order: %). The guard must diff the CLIENT''s row, before the derivation rewrites track_id, or updated_by is stamped for the derivation instead of for the member''s edit.',
      v_names;
  end if;

  if v_touch is null or v_sync > v_touch then
    raise exception
      'OpsTrack 0024 FAILED: entries_map_sync fires after entries_touch_trg (order: %). The derived track_id must be in place before entries_touch() diffs the row, or the clocks are decided from a value that is about to change.',
      v_names;
  end if;

  raise notice
    'OpsTrack 0024 probe 1: % use cases (all ten seeded names present), map_node_use_cases and entries.node_id exist, BEFORE UPDATE order on entries is %.',
    v_cases, v_names;
end
$shape$;


-- ════════════════════════════════════════════════════════════════════════════
-- PROBE 2 — the invariant, on the CLIENT path, and the clock that must not move
-- ════════════════════════════════════════════════════════════════════════════
-- The claim that cannot be verified by reading the file: that a client CANNOT
-- file a row under two different things at once, and that the derivation does not
-- launder stale work into fresh work.
--
-- ⚠ NOT ONE LIVE ROW IS READ FOR WRITING OR WRITTEN HERE. The fixture creates its
-- own node, its own member and its own entry; live tracks are read only to point
-- at. Everything is rolled back through a sentinel exception (the subtransaction
-- idiom 0007:117-122 documents), so the workspace's 9 tracks and 27 entries are
-- untouched whether this passes or fails.
--
-- THE CLIENT PATH IS THE POINT. Running the insert as the migration role would
-- prove nothing about what PostgREST does: entries_guard_insert() returns early
-- without a JWT, and the RLS `with check (created_by = auth.uid())` would never
-- be exercised. So this does `set local role authenticated` with a member's
-- claims, exactly as a request arrives. If that role is not grantable to whoever
-- is applying the file, the probe SKIPS with a notice rather than failing — the
-- objects are installed either way and a false failure sends an operator hunting
-- a bug that is not there (0018:552-557 makes the same call). The skip test is
-- scoped to the role switch ALONE: wrapping the whole block would report a real
-- broken invariant as "skipped".
do $invariant$
declare
  v_member   uuid := gen_random_uuid();
  v_track_a  uuid;
  v_track_b  uuid;
  v_kind     uuid;
  v_kind_req boolean;
  v_node     uuid;
  v_entry    uuid;
  v_read_a   uuid;
  v_read_b   uuid;
  v_read_c   uuid;
  v_upd0     timestamptz;
  v_upd1     timestamptz;
  v_act0     timestamptz;
  v_act1     timestamptz;
  v_skipped  boolean := false;
  v_back     timestamptz := now() - interval '30 days';
begin
  select t.id into v_track_a from public.tracks t where t.archived = false order by t.sort_order limit 1;
  select t.id into v_track_b from public.tracks t
   where t.archived = false and t.id is distinct from v_track_a
   order by t.sort_order limit 1;

  if v_track_a is null or v_track_b is null then
    raise notice
      'OpsTrack 0024 probe 2 SKIPPED: needs two unarchived tracks to tell a derived track_id from a sent one (found a=%, b=%).',
      v_track_a, v_track_b;
    return;
  end if;

  begin
    -- ── fixture, as the migration role ────────────────────────────────────
    -- A ROOT node (parent_id null) on purpose: 0023's deferred constraint
    -- trigger owns the cross-track invariant between a node and its PARENT, and
    -- a parentless node is free to change track. Re-parenting this node below is
    -- what produces a pure derived-track change on the entry.
    --
    -- 0023 owns map_nodes' column list, so kind_id is probed for rather than
    -- assumed. If the column exists and is NOT NULL, a kind must be available;
    -- saying so by name beats a bare 23502 from inside a fixture.
    select (c.is_nullable = 'NO') into v_kind_req
      from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = 'map_nodes' and c.column_name = 'kind_id';

    if v_kind_req is null then
      insert into public.map_nodes (name, track_id)
        values ('0024 probe node', v_track_a) returning id into v_node;
    else
      select k.id into v_kind from public.map_node_kinds k order by k.sort_order limit 1;
      if v_kind is null and v_kind_req then
        raise exception
          'OpsTrack 0024 PROBE 2 SETUP FAILED: map_nodes.kind_id is NOT NULL but map_node_kinds is empty. 0023''s kind seed did not land.';
      end if;
      insert into public.map_nodes (name, track_id, kind_id)
        values ('0024 probe node', v_track_a, v_kind) returning id into v_node;
    end if;

    insert into auth.users (id, email, raw_user_meta_data) values
      (v_member, 'probe-member-' || v_member || '@0024.invalid',
       jsonb_build_object('display_name', '0024 Probe Member'));

    if (select count(*) from public.profiles where id = v_member) <> 1 then
      raise exception 'OpsTrack 0024 PROBE 2 SETUP FAILED: handle_new_user() did not create the fixture profile.';
    end if;

    begin
      perform set_config('request.jwt.claims',
                         json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
      set local role authenticated;
    exception when insufficient_privilege then
      v_skipped := true;
    end;

    if not v_skipped then
      -- ── ① INSERT: node under track A, track_id DELIBERATELY sent as B ─────
      -- This is the whole invariant in one statement. A well-behaved client
      -- would send A; this one lies, the way a stale tab or a half-finished drag
      -- does, and the stored row must still read A.
      insert into public.entries (title, track_id, node_id, created_by)
        values ('0024 probe entry', v_track_b, v_node, v_member)
        returning id, track_id into v_entry, v_read_a;

      -- ── ② UPDATE: the same lie, on the update path ────────────────────────
      update public.entries set track_id = v_track_b where id = v_entry;
      select e.track_id into v_read_b from public.entries e where e.id = v_entry;

      reset role;
      perform set_config('request.jwt.claims', '', true);

      -- Backdate BOTH clocks. Without this the assertions below are vacuous:
      -- now() is the transaction's start time and is constant inside this block,
      -- so a freshly inserted row already carries it and "the clock moved" could
      -- never be observed. Both columns are subtracted from entries_touch()'s
      -- diffs, so this write sets them and stamps nothing — and auth.uid() is
      -- null here, so entries_guard_update() passes straight through.
      update public.entries set updated_at = v_back, last_activity_at = v_back
       where id = v_entry;

      select e.updated_at, e.last_activity_at into v_upd0, v_act0
        from public.entries e where e.id = v_entry;

      -- ── ③ RE-PARENT THE NODE, then re-save the entry ─────────────────────
      -- The scenario from the header: one department moves under a different
      -- programme, and every item filed beneath it is re-derived. Nothing about
      -- the ENTRY changed — same node, same title, same status — so this is
      -- bookkeeping, and the staleness clock must not move. `updated_at` must.
      --
      -- If 0023 pins a node's track_id against direct UPDATE, this raises — and
      -- it is re-raised by name rather than escaping as a bare trigger message,
      -- because "0024's probe failed" and "0023 made moving a programme
      -- impossible" are the same event seen from two files and only one of those
      -- sentences tells an operator where to look.
      begin
        update public.map_nodes set track_id = v_track_b where id = v_node;
      exception when others then
        raise exception
          'OpsTrack 0024 PROBE 2 SETUP FAILED: moving a ROOT map_node (no parent) from one track to another was refused by 0023 — %. Either that guard is too strict (a programme must be able to move) or this probe needs 0023''s own re-parent RPC instead of a direct UPDATE.',
          sqlerrm;
      end;

      -- The entry itself is re-saved unchanged. On a schema where 0023 already
      -- cascades the node's new track onto the entries beneath it, this is a
      -- no-op and the assertions below read the cascade's result instead — both
      -- paths are correct and both are covered.
      update public.entries set node_id = v_node where id = v_entry;

      select e.track_id, e.updated_at, e.last_activity_at
        into v_read_c, v_upd1, v_act1
        from public.entries e where e.id = v_entry;
    end if;

    raise exception using errcode = 'OT024', message = 'probe rollback';
  exception
    when sqlstate 'OT024' then
      null; -- subtransaction discarded; plpgsql variables survive it
  end;

  if v_skipped then
    raise notice
      'OpsTrack 0024 probe 2 SKIPPED: this role cannot `set role authenticated`, so the client path could not be exercised. entries_map_sync IS installed. Verify by hand: POST /rest/v1/entries with a node_id under one track and a track_id naming another — it must read back as the node''s track.';
    return;
  end if;

  if v_read_a is distinct from v_track_a then
    raise exception
      'OpsTrack 0024 FAILED: a client INSERT with node_id under track % and a contradictory track_id stored %. entries_map_sync() is not deriving track_id, so a row can be filed under two things at once.',
      v_track_a, v_read_a;
  end if;

  if v_read_b is distinct from v_track_a then
    raise exception
      'OpsTrack 0024 FAILED: a client UPDATE re-pointed track_id to % on a row whose node lives under %. The derivation is missing from the UPDATE path — check that the trigger is `before insert or update`, not `before insert`.',
      v_read_b, v_track_a;
  end if;

  if v_read_c is distinct from v_track_b then
    raise exception
      'OpsTrack 0024 FAILED: after the node moved to track %, the entry beneath it still reads track %. Re-filing a node does not re-derive the entries under it.',
      v_track_b, v_read_c;
  end if;

  -- THE ASSERTION THAT EARNS ITS KEEP. It does not test this file's code at all
  -- — it tests that entries_touch() still subtracts track_id from its activity
  -- diff. That subtraction is 0007's, it has been silently broken once before by
  -- an unrelated column being added, and this is now the second path that
  -- depends on it. If a future edit to entries_touch() drops the subtraction,
  -- this line is what says so.
  if v_act1 is distinct from v_act0 then
    raise exception
      'OpsTrack 0024 FAILED: re-filing a node moved last_activity_at (% -> %). entries_touch() has stopped subtracting track_id from its activity diff, and re-parenting one department now launders every stale item beneath it into freshly-worked work in the digest. See 0007.',
      v_act0, v_act1;
  end if;

  if v_upd1 is not distinct from v_upd0 then
    raise exception
      'OpsTrack 0024 FAILED: re-filing a node left updated_at at %. The bookkeeping clock must still tick — a change that no clock records is a change nobody can find.',
      v_upd0;
  end if;

  raise notice
    'OpsTrack 0024 probe 2: a client insert AND a client update both sent track % against a node under track % and both stored %; moving the node to % re-derived the entry; last_activity_at held at % while updated_at moved % -> %. All rolled back.',
    v_track_b, v_track_a, v_read_a, v_track_b, v_act1, v_upd0, v_upd1;
end
$invariant$;


-- ════════════════════════════════════════════════════════════════════════════
-- PROBE 3 — the RLS split, asserted in BOTH directions
-- ════════════════════════════════════════════════════════════════════════════
-- The member-write policy on `map_node_use_cases` is the one thing in this file
-- that a careful reviewer would "fix" by making it match every other table. So it
-- is asserted POSITIVELY: a plain member must be able to INSERT and DELETE a
-- link. A probe that only checked the admin half would pass against an
-- inverted policy set and Aziz would discover it the first afternoon an intern
-- tried to record a hospital's ADT feed.
--
-- The other direction is asserted too — a member must NOT be able to write the
-- CATALOGUE — because the two halves fail in opposite ways and only one of them
-- is visible: a member who cannot write the join files a support request; a
-- member who CAN write use_cases quietly invents a capability that then shows up
-- in the executive's coverage count.
--
-- Same fixture discipline as probe 2: no live row is written, everything rolls
-- back through a sentinel, and the role-switch skip is scoped to the switch.
do $rls$
declare
  v_member    uuid := gen_random_uuid();
  v_track     uuid;
  v_kind      uuid;
  v_kind_req  boolean;
  v_node      uuid;
  v_case      uuid;
  v_read      int  := 0;
  v_ins_join  boolean := false;
  v_upd_join  boolean := false;
  v_del_join  boolean := false;
  v_ins_cat   boolean := false;
  v_upd_cat   boolean := false;
  v_skipped   boolean := false;
begin
  select t.id into v_track from public.tracks t where t.archived = false order by t.sort_order limit 1;
  select u.id into v_case from public.use_cases u order by u.sort_order limit 1;

  if v_track is null or v_case is null then
    raise notice
      'OpsTrack 0024 probe 3 SKIPPED: needs one unarchived track and one use case (track=%, use case=%).',
      v_track, v_case;
    return;
  end if;

  begin
    select (c.is_nullable = 'NO') into v_kind_req
      from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = 'map_nodes' and c.column_name = 'kind_id';

    if v_kind_req is null then
      insert into public.map_nodes (name, track_id)
        values ('0024 rls probe node', v_track) returning id into v_node;
    else
      select k.id into v_kind from public.map_node_kinds k order by k.sort_order limit 1;
      insert into public.map_nodes (name, track_id, kind_id)
        values ('0024 rls probe node', v_track, v_kind) returning id into v_node;
    end if;

    insert into auth.users (id, email, raw_user_meta_data) values
      (v_member, 'probe-rls-' || v_member || '@0024.invalid',
       jsonb_build_object('display_name', '0024 RLS Probe Member'));

    -- handle_new_user() hardcodes 'member', which is exactly the role under test.
    begin
      perform set_config('request.jwt.claims',
                         json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
      set local role authenticated;
    exception when insufficient_privilege then
      v_skipped := true;
    end;

    if not v_skipped then
      select count(*) into v_read from public.use_cases;

      -- ── the POSITIVE half: a member records fieldwork ────────────────────
      -- A blocked INSERT under RLS RAISES 42501 rather than affecting zero rows,
      -- so this is caught, not counted.
      begin
        insert into public.map_node_use_cases (node_id, use_case_id, status)
          values (v_node, v_case, 'live');
        v_ins_join := true;
      exception when insufficient_privilege then
        v_ins_join := false;
      end;

      if v_ins_join then
        update public.map_node_use_cases set status = 'testing'
         where node_id = v_node and use_case_id = v_case;
        if found then v_upd_join := true; end if;

        delete from public.map_node_use_cases
         where node_id = v_node and use_case_id = v_case;
        if found then v_del_join := true; end if;
      end if;

      -- ── the NEGATIVE half: the catalogue is not theirs ───────────────────
      begin
        insert into public.use_cases (name, sort_order) values ('0024 Probe Capability', 99);
        v_ins_cat := true;
      exception when insufficient_privilege then
        null; -- 42501, as intended
      end;

      -- A blocked UPDATE affects zero rows rather than raising, which is the
      -- whole reason src/lib/permissions.ts exists. Count rows, do not catch.
      update public.use_cases set hidden = true where id = v_case;
      if found then v_upd_cat := true; end if;

      reset role;
      perform set_config('request.jwt.claims', '', true);
    end if;

    raise exception using errcode = 'OT024', message = 'probe rollback';
  exception
    when sqlstate 'OT024' then
      null;
  end;

  if v_skipped then
    raise notice
      'OpsTrack 0024 probe 3 SKIPPED: this role cannot `set role authenticated`. The policies ARE installed. Verify by hand as a MEMBER: POST /rest/v1/map_node_use_cases must succeed, and POST /rest/v1/use_cases must return 42501.';
    return;
  end if;

  if v_read < 10 then
    raise exception
      'OpsTrack 0024 FAILED: a member read only % use_cases rows. use_cases_select is too strict, and an Org panel with an empty matrix is indistinguishable from an Org that integrated nothing.',
      v_read;
  end if;

  if not v_ins_join then
    raise exception
      'OpsTrack 0024 FAILED: a plain MEMBER could not insert into map_node_use_cases. The policy has been made admin-gated like every other table here, which turns the one admin into the data-entry bottleneck for the data his interns collect — the opposite of the point. This table is member-write BY DESIGN; see the comment above its policies.';
  end if;

  if not v_upd_join or not v_del_join then
    raise exception
      'OpsTrack 0024 FAILED: a member inserted a link but could not update (%) or delete (%) it. Recording a use case has to be reversible by the person who recorded it, or the first typo is permanent.',
      v_upd_join, v_del_join;
  end if;

  if v_ins_cat then
    raise exception
      'OpsTrack 0024 FAILED: a plain member created a use case. use_cases is ADMIN-write: a catalogue anybody can extend is free text with extra steps, and an invented capability inflates the executive coverage count.';
  end if;

  if v_upd_cat then
    raise exception
      'OpsTrack 0024 FAILED: a plain member edited a use case (hid one, in this probe). Hiding a capability removes it from every picker in the workspace.';
  end if;

  raise notice
    'OpsTrack 0024 probe 3: a member read % use cases, inserted/updated/deleted a map_node_use_cases link, and could neither create nor edit a use case. Rolled back.',
    v_read;
end
$rls$;
