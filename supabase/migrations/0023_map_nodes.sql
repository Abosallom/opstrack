-- 0023 — the map grows a hierarchy BELOW the tracks.
--
-- WHAT THIS IS
-- The map is a fixed four-ring tree today: workspace → track → status bucket →
-- entry. Aziz needs it to carry a second job — the onboarding of healthcare
-- organizations onto the Unified Health Record — and that shape is
-- UHR > OB > Org1, Org2, … with arbitrary depth. This file adds the one table
-- that makes arbitrary depth possible, `map_nodes`, plus the vocabulary that
-- names a node's role, `map_node_kinds`.
--
--
-- ═══ THE ONE INVARIANT THE WHOLE DESIGN RESTS ON ═══
--
-- TRACKS STAY. The new hierarchy hangs BELOW them. `entries.track_id` remains
-- load-bearing for trackVars() colour, the track_slas track × priority matrix,
-- loadTrackTimeline and MapBranch.trackIdOf — none of which this file touches.
--
-- Every node therefore carries `track_id NOT NULL AT EVERY DEPTH`, and it is
-- DERIVED from the parent by a `before insert` trigger rather than asserted
-- against it. A client never sends it. That is what makes two filing axes
-- UNREPRESENTABLE rather than merely detected: there is no way to express "this
-- node is under OB, which is under UHR, but belongs to the Network track",
-- because nobody can type the second half of that sentence.
--
--
-- ═══ WHY ONE DEFERRED CONSTRAINT TRIGGER OWNS THREE RULES ═══
--
-- No cycles, a depth cap of 6, and parent.track_id = child.track_id are ONE
-- rule wearing three hats: *this node's ancestry is well-formed*. They are
-- enforced by a single `constraint trigger … deferrable initially deferred`.
--
-- DEFERRED is not a preference. Moving a subtree across tracks rewrites
-- `track_id` on many rows, and a `before` row trigger would read the OLD parent
-- halfway through that statement and refuse a move that is correct by the time
-- the statement finishes. The usual patch for that is a "bypass" flag set by
-- the RPC — which is exactly how a hole gets invented, because the flag is one
-- `set_config` away from any caller. Deferring to COMMIT means the check reads
-- the finished state, works in ANY statement order, and has no bypass at all.
--
-- The check re-reads the row from the table rather than trusting NEW: a
-- deferred trigger fires at commit with the row image from the moment of the
-- write, and in a multi-statement move that image is stale by then. It also
-- returns quietly if the row has since been deleted, because a deferred event
-- survives the deletion of the row that queued it.
--
--
-- ═══ WHAT THIS FILE DELIBERATELY DOES NOT HAVE ═══
--
-- NO COLOUR COLUMN on `map_node_kinds`. src/lib/mindtree/model.ts's header is
-- explicit — "COLOUR IS INHERITED, NEVER PICKED" — and the map has already
-- spent its two visual variables (size-for-count, and the breach mark). A kind
-- colour would be a third, competing with the track colour every node inside it
-- already wears. If you are here to add one: the answer is no, and the reason
-- is that the reader cannot decode three simultaneous encodings on one glyph.
--
--
-- ═══ WHAT IT CHANGES OUTSIDE ITSELF ═══
--
-- `map_nodes.track_id` is `on delete restrict`, which changes the TRUTH of two
-- 0002 objects, so both are redefined at the bottom:
--
--   * `tracks_block_delete_when_referenced()` gains a map_nodes count. Without
--     it, deleting a track with an Org tree under it would fail on a raw FK
--     error carrying no token, and src/lib/pgError.ts would render it as the
--     generic common.error.
--   * `delete_track(p_id, p_reassign_to)` gains a statement reassigning
--     map_nodes, so the reassign path still clears the guard.
--
-- Redefining an earlier migration's function in a later one is house style —
-- 0015, 0016, 0019 and 0022 all redefine `entries_guard_update()`. The rule is
-- that the LAST definition wins and the file that holds it says why.
--
-- The matching client change (`TrackUsage` gains `nodes`, `getTrackUsage()`
-- counts a fourth table) is NOT in this file and is in the handoff.
--
--
-- ═══ `entries.node_id` IS NOT THIS FILE'S COLUMN ═══
--
-- 0024 adds it. Two places here have to count or repoint entries filed on a
-- node, and both do it through a catalog check + `execute` rather than a static
-- reference: 0023 must apply cleanly ON ITS OWN (it is the first of the pair),
-- and it must start counting correctly the moment 0024 lands WITHOUT being
-- re-applied. A static reference would make 0023 unappliable before 0024 and a
-- silent zero after it, depending on which way you resolved it.
--
--
-- ═══ THE TOKEN CONTRACT WITH src/lib/pgError.ts ═══
--
-- Every `raise` below carries a `token:` prefix, and the TOKEN — not the
-- SQLSTATE — is what pgError.ts matches to an i18n key. Renaming one here
-- silently demotes a precise sentence to the generic common.error, so this list
-- is the handshake and both files have to be edited together:
--
--   map_node_cycle             the deferred tree check: an ancestry that loops
--   map_node_move_into_self    move_map_node() refusing the same mistake UP
--                              FRONT, so the admin gets "you dropped this branch
--                              on itself" rather than a sentence about ancestry
--   map_node_depth             the depth cap
--   map_node_track_mismatch    track_id disagreeing with an ancestor's
--   map_node_no_track          a root node that named no track
--   map_node_reorder_scope     a reorder that named no track
--   map_node_reorder_foreign   a reorder array holding an id from another branch
--   map_node_in_use            a delete blocked by children or entries
--   map_node_missing           the node, the parent or the target vanished
--
-- Plus two INDEX names pgError.ts matches directly, which is why they must not
-- be renamed casually either: `map_nodes_sibling_name_uidx` and
-- `map_node_kinds_name_uidx` / `_ar_uidx`.
--
-- The SQLSTATEs are the natural ones — 23514 for the deferred check's three
-- rules, 23502 for the missing track, 22023 for the RPCs' argument refusals,
-- P0002 for a vanished row, 23503 for the delete guard. They are NOT flattened
-- onto one code, because pgError.ts consults the token from every one of those
-- cases; making the code carry meaning it does not have would be a second,
-- weaker copy of the same contract.
--
-- Deploy: Supabase Dashboard → SQL Editor → paste + Run. Re-runnable from the
-- top in any partial state, same discipline as 0001–0022: `create table if not
-- exists`, `add column if not exists`, `drop constraint if exists` before every
-- add, `drop policy if exists` before every create, `drop trigger if exists`
-- before every create, `create or replace` on every function, guarded seeds,
-- and probe blocks at the bottom that roll themselves back. A probe failure
-- raises and the whole migration rolls back — no explicit begin/commit here,
-- for the reason 0009's header spells out.


-- ── map_node_kinds ──────────────────────────────────────────────────────────
-- What a node IS: a Programme, a Phase, an Organization. A surrogate uuid
-- rather than the name as the key, for 0018's reason — the name is a LABEL and
-- gets renamed, while `map_nodes.kind_id` has to keep pointing at the same kind
-- across that rename.
--
-- NO COLOUR COLUMN. See the header. This is the comment that is supposed to
-- stop the next person adding one.
--
-- `map_nodes.kind_id` is `on delete set null`, so this table needs no delete
-- guard: removing a kind leaves its nodes kindless, which every reader has to
-- render anyway (a node created before anyone thought about kinds is kindless,
-- not broken).
create table if not exists public.map_node_kinds (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  name_ar    text not null default '',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null
);

comment on table public.map_node_kinds is
  'What a map node IS — Programme / Phase / Organization (0023). Deliberately has NO colour column: colour is inherited from the track (see src/lib/mindtree/model.ts), and the map has already spent its two visual variables.';

alter table public.map_node_kinds add column if not exists name_ar    text not null default '';
alter table public.map_node_kinds add column if not exists sort_order int not null default 0;
alter table public.map_node_kinds add column if not exists created_at timestamptz not null default now();
alter table public.map_node_kinds add column if not exists updated_at timestamptz not null default now();
alter table public.map_node_kinds add column if not exists created_by uuid references public.profiles (id) on delete set null;

-- btrim before measuring: '   ' is an empty name wearing a hat. 40 here, unlike
-- map_nodes below, because a KIND name is a word the admin chooses.
alter table public.map_node_kinds drop constraint if exists map_node_kinds_name_len_chk;
alter table public.map_node_kinds add constraint map_node_kinds_name_len_chk
  check (char_length(btrim(name)) between 1 and 40);

alter table public.map_node_kinds drop constraint if exists map_node_kinds_name_ar_len_chk;
alter table public.map_node_kinds add constraint map_node_kinds_name_ar_len_chk
  check (char_length(btrim(name_ar)) <= 40);

create unique index if not exists map_node_kinds_name_uidx
  on public.map_node_kinds (lower(btrim(name)));

-- PARTIAL, because name_ar is seeded blank ON PURPOSE — these three words are
-- Aziz's to translate, not mine to guess, and a non-partial index would let
-- exactly one kind go untranslated and reject the second with a duplicate-name
-- error naming the wrong field. Same shape as track_groups_name_ar_uidx (0018).
create unique index if not exists map_node_kinds_name_ar_uidx
  on public.map_node_kinds (lower(btrim(name_ar))) where btrim(name_ar) <> '';

create index if not exists map_node_kinds_sort_idx on public.map_node_kinds (sort_order);

alter table public.map_node_kinds enable row level security;

-- Member read, ADMIN write — `tracks`' policy set, in 0009's InitPlan form
-- `(select public.is_member())` so the predicate is evaluated once per statement
-- rather than once per surviving row.
drop policy if exists map_node_kinds_select on public.map_node_kinds;
create policy map_node_kinds_select on public.map_node_kinds
  for select using ((select public.is_member()));

drop policy if exists map_node_kinds_insert on public.map_node_kinds;
create policy map_node_kinds_insert on public.map_node_kinds
  for insert with check ((select public.is_admin()));

drop policy if exists map_node_kinds_update on public.map_node_kinds;
create policy map_node_kinds_update on public.map_node_kinds
  for update using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists map_node_kinds_delete on public.map_node_kinds;
create policy map_node_kinds_delete on public.map_node_kinds
  for delete using ((select public.is_admin()));

-- Explicit rather than relying on Supabase's default privileges for new tables
-- in `public`; `anon` is left exactly as the project's defaults have it, matching
-- `tracks` and `track_groups`, and cannot pass is_member() in any case.
grant select, insert, update, delete on public.map_node_kinds to authenticated;

create or replace function public.map_node_kinds_touch()
returns trigger
language plpgsql
as $$
begin
  if (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists map_node_kinds_touch_trg on public.map_node_kinds;
create trigger map_node_kinds_touch_trg
  before update on public.map_node_kinds
  for each row execute function public.map_node_kinds_touch();

create or replace function public.map_node_kinds_audit()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    -- Casts on the null: with a single candidate Postgres resolves an untyped
    -- null anyway, but an overload added later would make this ambiguous at
    -- runtime, inside a trigger, on someone else's write.
    perform public.log_config_audit('map_node_kinds', new.id, 'insert', null::jsonb, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    if to_jsonb(new) is distinct from to_jsonb(old) then
      perform public.log_config_audit('map_node_kinds', new.id, 'update', to_jsonb(old), to_jsonb(new));
    end if;
    return new;
  else
    perform public.log_config_audit('map_node_kinds', old.id, 'delete', to_jsonb(old), null::jsonb);
    return old;
  end if;
end;
$$;

drop trigger if exists map_node_kinds_audit_trg on public.map_node_kinds;
create trigger map_node_kinds_audit_trg
  after insert or update or delete on public.map_node_kinds
  for each row execute function public.map_node_kinds_audit();

-- `do nothing` rather than `do update`, exactly like 0001's track seed and
-- 0018's group seed: these are editable in the admin screen and re-running this
-- migration must not stomp a renamed kind.
--
-- Arabic is BLANK on purpose. 'Programme', 'Phase' and 'Organization' are the
-- programme's own vocabulary and Aziz names them in Arabic himself; a guessed
-- translation would be indistinguishable from a reviewed one on screen.
insert into public.map_node_kinds (name, name_ar, sort_order) values
  ('Programme',    '', 1),
  ('Phase',        '', 2),
  ('Organization', '', 3)
on conflict (lower(btrim(name))) do nothing;


-- ── reorder_map_node_kinds ──────────────────────────────────────────────────
-- reorder_groups (0018:282) verbatim, on this table. It is here because the
-- kinds are a short ordered list the admin drags, and the order is what every
-- kind picker offers — an unordered picker makes "Organization" appear
-- somewhere different on each load.
--
-- Flat and unscoped, unlike reorder_map_nodes below, and the difference is the
-- data rather than a lapse: there is exactly ONE list of kinds, so there is no
-- other branch for a stray id to renumber.
create or replace function public.reorder_map_node_kinds(p_ids uuid[])
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count int;
begin
  if not public.is_admin() then
    raise exception 'only an admin may reorder map node kinds' using errcode = '42501';
  end if;

  update public.map_node_kinds k
     set sort_order = o.ord::int
    from unnest(p_ids) with ordinality as o(id, ord)
   where k.id = o.id
     and k.sort_order is distinct from o.ord::int;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.reorder_map_node_kinds(uuid[]) from public;
revoke all on function public.reorder_map_node_kinds(uuid[]) from anon;
grant execute on function public.reorder_map_node_kinds(uuid[]) to authenticated;


-- ── map_nodes ───────────────────────────────────────────────────────────────
-- The hierarchy itself. `parent_id` null means "a child of the track", which is
-- the top ring of the new structure: UHR is a TRACK, OB is a root node under it,
-- and the Orgs are children of OB.
--
-- `track_id … on delete restrict`, not `set null` and not `cascade`. Every other
-- track_id FK in this schema is `set null` because orphaning an entry loses a
-- row of work but not the work itself; a node with a null track_id would be a
-- node with no colour, no SLA matrix and no place on the map, i.e. an
-- unrepresentable state rather than a degraded one. `restrict` makes it
-- impossible; the guard trigger below turns the raw FK failure into a tokenised
-- message the UI can translate, and delete_track()'s reassign path is the way
-- through.
--
-- `parent_id … on delete restrict` for the same reason plus one more: a cascade
-- here would let one click delete an entire onboarding programme.
create table if not exists public.map_nodes (
  id                 uuid primary key default gen_random_uuid(),
  track_id           uuid not null references public.tracks (id)          on delete restrict,
  parent_id          uuid          references public.map_nodes (id)       on delete restrict,
  kind_id            uuid          references public.map_node_kinds (id)  on delete set null,
  name               text not null,
  name_ar            text not null default '',
  description        text not null default '',
  description_ar     text not null default '',
  account_manager_id uuid          references public.profiles (id)        on delete set null,
  -- The integrator doing the work on this organization. FREE TEXT, NOT AN FK,
  -- and deliberately: a vendor is a company outside this workspace with no
  -- profile, no login and no row anybody maintains. `''` means "not recorded"
  -- for `name_ar`'s reason — an empty string is a value the UI can test, and a
  -- three-state string/null/'' is a bug waiting for the first filter.
  vendor             text not null default '',
  sort_order         int  not null default 0,
  archived           boolean not null default false,
  archived_at        timestamptz,
  -- Jira provenance, present from day one and unused until the sync exists.
  -- Aziz's words: "I cannot connect the app to Jira until we verify the tracker
  -- very well." Adding the columns now costs nothing and means the sync is a
  -- feature rather than a migration against live data later.
  source             text not null default 'local',
  external_ref       text,
  external_url       text,
  synced_at          timestamptz,
  overrides          text[] not null default '{}',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references public.profiles (id) on delete set null
);

comment on table public.map_nodes is
  'The hierarchy below tracks (0023): UHR > OB > Org1, Org2, … parent_id null means a child of the track itself. track_id is NOT NULL at every depth and is DERIVED from the parent on insert, never sent by a client — that is what makes two filing axes unrepresentable rather than merely detected.';

comment on column public.map_nodes.track_id is
  'Denormalised down the whole tree and derived from the parent by map_nodes_derive_track() (0023). Rewriting it by hand is refused at COMMIT by map_nodes_tree_ck_trg unless the whole subtree moves with it; move_map_node() is the supported way.';

comment on column public.map_nodes.vendor is
  'The integrator delivering this organization (0023). Free text and not a foreign key: a vendor is a company outside the workspace with no profile and no row to point at. Empty string means "not recorded" — Aziz''s filter-by-vendor reads this column, so a null would make "no vendor" and "unknown" two different answers to one question.';

comment on column public.map_nodes.overrides is
  'Per-field Jira override list (0023, unused until the sync ships): a field named here was edited in this app and must not be overwritten by a sync.';

-- For a project where an earlier cut of this file already landed without them:
-- `create table if not exists` above is a no-op there, so the columns have to be
-- added separately or the constraints below fail against a table that lacks
-- them. Same reasoning as 0017:129 and 0018:136.
alter table public.map_nodes add column if not exists parent_id          uuid    references public.map_nodes (id)      on delete restrict;
alter table public.map_nodes add column if not exists kind_id            uuid    references public.map_node_kinds (id) on delete set null;
alter table public.map_nodes add column if not exists name_ar            text    not null default '';
alter table public.map_nodes add column if not exists description        text    not null default '';
alter table public.map_nodes add column if not exists description_ar     text    not null default '';
alter table public.map_nodes add column if not exists account_manager_id uuid    references public.profiles (id)       on delete set null;
alter table public.map_nodes add column if not exists vendor             text    not null default '';
alter table public.map_nodes add column if not exists sort_order         int     not null default 0;
alter table public.map_nodes add column if not exists archived           boolean not null default false;
alter table public.map_nodes add column if not exists archived_at        timestamptz;
alter table public.map_nodes add column if not exists source             text    not null default 'local';
alter table public.map_nodes add column if not exists external_ref       text;
alter table public.map_nodes add column if not exists external_url       text;
alter table public.map_nodes add column if not exists synced_at          timestamptz;
alter table public.map_nodes add column if not exists overrides          text[]  not null default '{}';
alter table public.map_nodes add column if not exists created_at         timestamptz not null default now();
alter table public.map_nodes add column if not exists updated_at         timestamptz not null default now();
alter table public.map_nodes add column if not exists created_by         uuid references public.profiles (id) on delete set null;

-- ── name length: 1..60, NOT the 1..40 every other name column in this schema
-- uses, and the deviation is deliberate. Track and group names are chosen by
-- Aziz and fit a phone-width column by construction. ORG names are chosen by
-- HOSPITALS — "King Faisal Specialist Hospital & Research Centre" is 48
-- characters and is the actual name of the actual organization. Refusing it
-- would make the admin invent an abbreviation, which is exactly the kind of
-- local shorthand that stops a C-suite reader recognising his own portfolio.
--
-- 60 rather than unbounded because the map draws these into a measured glyph
-- budget; past 60 the node label is truncated on every surface anyway, and a
-- CHECK that matches the renderer is kinder than silent ellipsis.
alter table public.map_nodes drop constraint if exists map_nodes_name_len_chk;
alter table public.map_nodes add constraint map_nodes_name_len_chk
  check (char_length(btrim(name)) between 1 and 60);

alter table public.map_nodes drop constraint if exists map_nodes_name_ar_len_chk;
alter table public.map_nodes add constraint map_nodes_name_ar_len_chk
  check (char_length(btrim(name_ar)) <= 60);

-- A node cannot be its own parent. The deferred trigger below catches this too,
-- as the degenerate one-step cycle — but a same-row cycle is worth refusing at
-- the statement rather than at commit, because the client that typed it gets the
-- error on the row it typed rather than on the transaction.
alter table public.map_nodes drop constraint if exists map_nodes_not_self_parent_chk;
alter table public.map_nodes add constraint map_nodes_not_self_parent_chk
  check (parent_id is null or parent_id <> id);

alter table public.map_nodes drop constraint if exists map_nodes_source_chk;
alter table public.map_nodes add constraint map_nodes_source_chk
  check (source in ('local', 'jira'));

-- Same reasoning as tracks_color_chk (0002:139): this value is rendered by the
-- frontend — as an href on a "view in Jira" link — so anything that is not an
-- http(s) URL is either a dead link or, with `javascript:…`, a script injection
-- in an admin's browser.
alter table public.map_nodes drop constraint if exists map_nodes_external_url_chk;
alter table public.map_nodes add constraint map_nodes_external_url_chk
  check (external_url is null or external_url ~* '^https?://');

-- archived_at is stamped by a trigger and must agree with the flag. A row that
-- says archived = true with no date is a row no "archived when?" column can
-- render, and the trigger is the only writer.
alter table public.map_nodes drop constraint if exists map_nodes_archived_at_chk;
alter table public.map_nodes add constraint map_nodes_archived_at_chk
  check ((archived and archived_at is not null) or (not archived and archived_at is null));

-- ── SIBLING NAME UNIQUENESS ─────────────────────────────────────────────────
-- Case-insensitive, scoped to the parent, and NULLS NOT DISTINCT.
--
-- This project's Postgres is 17.6 (docs/EVIDENCE/wave4-live-proof.md), so the
-- 15+ form is available and is the one used: `(track_id, parent_id,
-- lower(btrim(name))) nulls not distinct`.
--
-- The NULLS NOT DISTINCT is the whole point. `parent_id` is NULL for a root
-- node, and under the default NULLS DISTINCT rule Postgres treats every NULL as
-- its own value — so two roots both named "OB" under one track would BOTH be
-- accepted and the map would draw two identical branches nobody can tell apart.
-- The fallback for a pre-15 server is a unique index on
-- `(coalesce(parent_id, track_id), lower(btrim(name)))`; it is not used here.
--
-- btrim inside the index as well as in the length CHECK: without it 'OB ' and
-- 'OB' are two different siblings that render identically.
--
-- Dropped and recreated rather than `if not exists`, because `if not exists`
-- would silently keep an index created by an earlier cut of this file WITHOUT
-- the nulls clause — a re-run that reports success while leaving the exact hole
-- this index exists to close. The table is a handful of rows; the rebuild is
-- free and the guarantee is not.
drop index if exists public.map_nodes_sibling_name_uidx;
create unique index map_nodes_sibling_name_uidx
  on public.map_nodes (track_id, parent_id, lower(btrim(name))) nulls not distinct;

-- The Arabic half, PARTIAL because name_ar defaults to '' — a non-partial index
-- would let exactly one sibling go untranslated and reject the second with a
-- duplicate-name error naming the wrong field. Same shape as
-- track_groups_name_ar_uidx (0018:174), same NULLS NOT DISTINCT as its English
-- counterpart above, and src/lib/pgError.ts matches its name.
drop index if exists public.map_nodes_sibling_name_ar_uidx;
create unique index map_nodes_sibling_name_ar_uidx
  on public.map_nodes (track_id, parent_id, lower(btrim(name_ar))) nulls not distinct
  where btrim(name_ar) <> '';

-- Uniqueness spans ARCHIVED rows deliberately. An archived Org still exists —
-- in the audit trail, in every breadcrumb, in the history band — and allowing a
-- second live "Riyadh General" beside the archived one would make those
-- surfaces ambiguous with no way for a reader to tell which is which. Restoring
-- the archived row is the supported move, not shadowing it.

create index if not exists map_nodes_track_idx   on public.map_nodes (track_id);
create index if not exists map_nodes_parent_idx  on public.map_nodes (parent_id);
create index if not exists map_nodes_kind_idx    on public.map_nodes (kind_id);
create index if not exists map_nodes_manager_idx on public.map_nodes (account_manager_id);
create index if not exists map_nodes_sort_idx    on public.map_nodes (track_id, parent_id, sort_order);

-- The Jira sync looks rows up by their remote id, once per node per run.
create index if not exists map_nodes_external_idx
  on public.map_nodes (source, external_ref) where external_ref is not null;

alter table public.map_nodes enable row level security;

-- Member read, ADMIN write. The admin owns the SHAPE; members own the DATA.
-- Aziz defines the tree; his interns file work into it. A member who cannot READ
-- the tree sees a map with no Orgs on it, which is worse than shipping no
-- hierarchy at all — hence member select, and hence 0009's InitPlan form.
drop policy if exists map_nodes_select on public.map_nodes;
create policy map_nodes_select on public.map_nodes
  for select using ((select public.is_member()));

drop policy if exists map_nodes_insert on public.map_nodes;
create policy map_nodes_insert on public.map_nodes
  for insert with check ((select public.is_admin()));

drop policy if exists map_nodes_update on public.map_nodes;
create policy map_nodes_update on public.map_nodes
  for update using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists map_nodes_delete on public.map_nodes;
create policy map_nodes_delete on public.map_nodes
  for delete using ((select public.is_admin()));

grant select, insert, update, delete on public.map_nodes to authenticated;


-- ── track_id is DERIVED, never sent ─────────────────────────────────────────
-- A `before insert` trigger. With a parent, `track_id` is whatever the parent
-- says and anything the client sent is overwritten — not rejected, overwritten,
-- because rejecting would make every client have to know the rule and the whole
-- point is that it cannot be got wrong. Without a parent the node is a root and
-- `track_id` is the one field it MUST carry, so a null there is refused with a
-- token rather than the raw NOT NULL violation (which pgError.ts maps to a
-- warning about a missing coalesce — a confident, wrong diagnosis).
--
-- INSERT only. A plain PATCH of `parent_id` through PostgREST does NOT
-- re-derive, on purpose: a same-track re-parent is then a one-column write that
-- just works, and a cross-track one is refused AT COMMIT by the tree check
-- below with a message that names the real problem. move_map_node() is the
-- supported way to cross tracks because it also carries the subtree and the
-- entries.
create or replace function public.map_nodes_derive_track()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_track uuid;
begin
  if new.parent_id is not null then
    select n.track_id into v_track from public.map_nodes n where n.id = new.parent_id;
    if not found then
      raise exception 'map_node_missing: parent node % not found', new.parent_id
        using errcode = 'P0002';
    end if;
    new.track_id := v_track;
  elsif new.track_id is null then
    raise exception 'map_node_no_track: a root node must name the track it hangs under'
      using errcode = '23502';
  end if;

  return new;
end;
$$;

drop trigger if exists map_nodes_derive_track_trg on public.map_nodes;
create trigger map_nodes_derive_track_trg
  before insert on public.map_nodes
  for each row execute function public.map_nodes_derive_track();


-- ── archived_at, and the archive cascade ────────────────────────────────────
-- `map_nodes` HAS an archived column, unlike track_groups which deliberately
-- has none (0018:117-120). The difference is not taste. A group renders nothing
-- of its own, so an empty group is ALREADY invisible everywhere and "archived"
-- would be a second, weaker way to say what the data already says. A NODE HOLDS
-- WORK — an Account Manager, use cases, entries filed on it — so it is never
-- automatically invisible, and an Org that finished onboarding is exactly the
-- case an archive flag exists for: keep the history, stop drawing it.
--
-- Trigger names matter: Postgres fires `before` triggers in NAME order, so
-- `map_nodes_archive_stamp_trg` runs before `map_nodes_touch_trg` and the touch
-- diff sees the final image including archived_at.
create or replace function public.map_nodes_archive_stamp()
returns trigger
language plpgsql
as $$
begin
  if new.archived and not old.archived then
    new.archived_at := now();
  elsif not new.archived and old.archived then
    new.archived_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists map_nodes_archive_stamp_trg on public.map_nodes;
create trigger map_nodes_archive_stamp_trg
  before update on public.map_nodes
  for each row execute function public.map_nodes_archive_stamp();

-- Archiving an Org archives everything under it. Anything else means a reader
-- can focus an archived branch and find live children inside it — a node that
-- is both retired and not.
--
-- SECURITY DEFINER so the cascade is COMPLETE regardless of whose policies are
-- in force. A cascade that undercounts is worse than none: it leaves precisely
-- the rows the caller could not see, which is the set nobody will go looking for.
--
-- The `archived = false` filter is what terminates the recursion — each cascaded
-- row fires this trigger again, finds its descendants already archived, and
-- updates nothing.
--
-- RESTORING DOES NOT CASCADE, and that is deliberate. The cascade cannot know
-- which descendants were already archived before it ran, so an un-cascade would
-- resurrect rows somebody retired months earlier. Un-archiving is per-node.
create or replace function public.map_nodes_cascade_archive()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.archived and not old.archived then
    update public.map_nodes d
       set archived = true
     where d.archived = false
       and d.id in (
         with recursive sub as (
           select n.id from public.map_nodes n where n.parent_id = new.id
           union all
           select c.id from public.map_nodes c join sub s on c.parent_id = s.id
         )
         select sub.id from sub
       );
  end if;
  return null;
end;
$$;

drop trigger if exists map_nodes_cascade_archive_trg on public.map_nodes;
create trigger map_nodes_cascade_archive_trg
  after update of archived on public.map_nodes
  for each row execute function public.map_nodes_cascade_archive();


-- ── touch and audit ─────────────────────────────────────────────────────────
-- Diffed rather than stamped unconditionally, for the same reason
-- track_groups_touch() is (0018:217): reorder_map_nodes() writes several rows in
-- one statement, and an unconditional stamp would report the whole branch as
-- edited on a drag that moved nothing.
--
-- `synced_at` is subtracted as well as `updated_at`. When the Jira sync exists it
-- will stamp synced_at on every node it looked at, every night, whether or not
-- anything changed — and an updated_at that moves nightly makes "when was this
-- Org last touched by a person" unanswerable.
create or replace function public.map_nodes_touch()
returns trigger
language plpgsql
as $$
begin
  if (to_jsonb(new) - 'updated_at' - 'synced_at')
       is distinct from (to_jsonb(old) - 'updated_at' - 'synced_at') then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists map_nodes_touch_trg on public.map_nodes;
create trigger map_nodes_touch_trg
  before update on public.map_nodes
  for each row execute function public.map_nodes_touch();

-- AFTER, not BEFORE: the row image recorded must be the one that survived every
-- other trigger and constraint on the table. Identical in shape to
-- track_groups_audit() (0018:243) — the tree is configuration, changed by one
-- person with no second pair of eyes, and `before` is the only record of where
-- an Org used to hang.
--
-- The UPDATE diff subtracts synced_at and updated_at for the reason above: a
-- nightly sync writing one audit row per node per night, on data nobody
-- changed, would bury the rows that matter.
create or replace function public.map_nodes_audit()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_config_audit('map_nodes', new.id, 'insert', null::jsonb, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    if (to_jsonb(new) - 'updated_at' - 'synced_at')
         is distinct from (to_jsonb(old) - 'updated_at' - 'synced_at') then
      perform public.log_config_audit('map_nodes', new.id, 'update', to_jsonb(old), to_jsonb(new));
    end if;
    return new;
  else
    perform public.log_config_audit('map_nodes', old.id, 'delete', to_jsonb(old), null::jsonb);
    return old;
  end if;
end;
$$;

drop trigger if exists map_nodes_audit_trg on public.map_nodes;
create trigger map_nodes_audit_trg
  after insert or update or delete on public.map_nodes
  for each row execute function public.map_nodes_audit();


-- ── the tree check: one deferred constraint trigger, three rules ────────────
-- No cycles · depth cap 6 · parent.track_id = child.track_id.
--
-- One trigger because they are one rule: THIS NODE'S ANCESTRY IS WELL-FORMED.
-- Splitting them would mean three walks of the same chain and three chances for
-- one of them to be added to a new write path and the others forgotten.
--
-- DEFERRED, and the header explains why at length: a subtree move rewrites
-- track_id across many rows, and a `before` row trigger reads the old parent
-- mid-statement and refuses a move that is correct by the end of it. The usual
-- workaround is a bypass flag, which is a hole with a comment on it.
--
-- FOUR things this function does that are not obvious:
--
--   1. It RE-READS the row. A deferred event fires at commit carrying the row
--      image from the moment of the write; in a two-statement move that image
--      is stale, and trusting it would refuse a legal move.
--   2. It returns quietly if the row is GONE. A deferred event outlives the
--      deletion of the row that queued it — insert-then-delete in one
--      transaction is a legal no-op, not a violation.
--   3. It checks its CHILDREN as well as its ancestors, one level down. If a
--      parent's track_id is rewritten and a child's is not, the child never
--      fires and its own ancestry check never runs; the parent's child-check is
--      what catches it. Together the two directions cover every edge exactly
--      once, which is why one level down is enough.
--   4. It carries a VISITED list. Walking up a cycle that does not pass through
--      this row would otherwise spin — and so would a walk into an ancestor that
--      vanished mid-transaction, which is why `not found` raises rather than
--      quietly ending the loop with a null.
create or replace function public.map_nodes_check_tree()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max_depth constant int := 6;
  v_id        uuid := new.id;
  v_track     uuid;
  v_parent    uuid;
  v_cur       uuid;
  v_seen      uuid[] := array[]::uuid[];
  v_depth     int := 1;
  v_ptrack    uuid;
  v_pparent   uuid;
  v_kids      int;
begin
  -- The cheap filter, in the body rather than in an `update of …` column list
  -- on the trigger, so the argument for why it is safe sits next to it.
  --
  -- If neither parent_id nor track_id moved, this row's own position in the
  -- tree did not change. Its PARENT's track_id might still have changed without
  -- this row being rewritten — and that case is caught by the parent's own
  -- event, through the one-level child check at the bottom of this function.
  -- Both directions are covered, so skipping here loses nothing.
  if tg_op = 'UPDATE'
     and new.parent_id is not distinct from old.parent_id
     and new.track_id  is not distinct from old.track_id then
    return null;
  end if;

  -- (1) and (2): current image, or nothing to check.
  select n.track_id, n.parent_id into v_track, v_parent
    from public.map_nodes n where n.id = v_id;
  if not found then
    return null;
  end if;

  v_cur := v_parent;
  while v_cur is not null loop
    -- Two ways to be a cycle: the walk comes back to this node, or it revisits
    -- an ancestor it has already passed (a loop further up that this node merely
    -- hangs off). Both are caught here rather than left to the depth cap, so the
    -- message names the real fault instead of reporting a 7-deep tree.
    if v_cur = v_id or v_cur = any (v_seen) then
      raise exception
        'map_node_cycle: the ancestry of node % loops back on itself at %', v_id, v_cur
        using errcode = '23514';
    end if;
    v_seen := v_seen || v_cur;

    v_depth := v_depth + 1;
    if v_depth > v_max_depth then
      raise exception
        'map_node_depth: node % would sit at level %, and the map is capped at % levels below the track',
        v_id, v_depth, v_max_depth
        using errcode = '23514';
    end if;

    select n.parent_id, n.track_id into v_pparent, v_ptrack
      from public.map_nodes n where n.id = v_cur;
    if not found then
      -- (4): parent_id is `on delete restrict`, so this should be unreachable.
      -- Raising rather than breaking out of the loop is the difference between
      -- a refused transaction and a silently half-checked tree.
      raise exception
        'map_node_missing: ancestor % of node % vanished mid-check', v_cur, v_id
        using errcode = 'P0002';
    end if;

    if v_ptrack is distinct from v_track then
      raise exception
        'map_node_track_mismatch: node % is on track % but its ancestor % is on track %',
        v_id, v_track, v_cur, v_ptrack
        using errcode = '23514';
    end if;

    v_cur := v_pparent;
  end loop;

  -- (3): the other direction, one level down.
  select count(*) into v_kids
    from public.map_nodes c
   where c.parent_id = v_id
     and c.track_id is distinct from v_track;

  if v_kids > 0 then
    raise exception
      'map_node_track_mismatch: node % is on track % but % of its children are not',
      v_id, v_track, v_kids
      using errcode = '23514';
  end if;

  return null;
end;
$$;

-- No `create or replace` for triggers, and no `create constraint trigger if not
-- exists` either — the drop is the only way to make this re-runnable.
--
-- Fires on INSERT and on every UPDATE rather than on `update of parent_id,
-- track_id`. A column list would be cheaper, but it is also a promise that no
-- other column can ever affect ancestry, and the cost of being wrong about that
-- is a tree that validates itself only sometimes. The function's own early exit
-- (below) does the cheap filtering instead, where it can be read.
drop trigger if exists map_nodes_tree_ck_trg on public.map_nodes;
create constraint trigger map_nodes_tree_ck_trg
  after insert or update on public.map_nodes
  deferrable initially deferred
  for each row execute function public.map_nodes_check_tree();


-- ── delete guard ────────────────────────────────────────────────────────────
-- Mirrors tracks_block_delete_when_referenced() (0002:204-232) in shape, in
-- SECURITY DEFINER, and in the `token:` message-prefix contract that
-- src/lib/pgError.ts pattern-matches to an i18n key.
--
-- The FK on `parent_id` is already `restrict`, so a node with children cannot be
-- deleted even without this trigger — and the belt-and-braces is deliberate.
-- The FK's own message names a constraint the admin has never heard of and
-- carries no token, so pgError.ts falls through to the generic common.error;
-- this trigger fires FIRST, says how many children and how many entries are in
-- the way, and gives the UI something to translate. Keep both: if this trigger
-- is ever dropped, the FK still refuses.
--
-- `entries` is counted through the catalog + `execute` for the reason in the
-- header: `entries.node_id` is 0024's column, this file must apply before it,
-- and the count must start working the moment 0024 lands without re-applying
-- 0023.
create or replace function public.map_nodes_block_delete_when_referenced()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_children int := 0;
  v_entries  int := 0;
begin
  select count(*) into v_children from public.map_nodes where parent_id = old.id;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'entries' and column_name = 'node_id'
  ) then
    execute 'select count(*) from public.entries where node_id = $1'
      into v_entries using old.id;
  end if;

  if v_children + v_entries > 0 then
    -- The 'map_node_in_use:' prefix is a contract with src/lib/pgError.ts. The
    -- counts ride along for the SQL Editor and the Postgres log; the UI gets its
    -- own counts before the click and never parses numbers out of this string.
    raise exception
      'map_node_in_use: % child nodes and % entries still reference this node',
      v_children, v_entries
      using errcode = '23503';
  end if;

  return old;
end;
$$;

drop trigger if exists map_nodes_block_delete_trg on public.map_nodes;
create trigger map_nodes_block_delete_trg
  before delete on public.map_nodes
  for each row execute function public.map_nodes_block_delete_when_referenced();


-- ── reorder_map_nodes ───────────────────────────────────────────────────────
-- reorder_groups (0018:282) SCOPED TO ONE PARENT, and the scoping is the whole
-- difference. `reorder_groups` renumbers whatever ids it is handed because
-- there is one flat list; here there are as many lists as there are branches,
-- and an id from another branch arriving in the array — through a stale client,
-- a mis-built drag payload, or a hand-written request — would renumber a branch
-- the admin is not looking at. So the function PROVES every id belongs to
-- (p_track, p_parent) before it writes anything, and refuses the whole call if
-- one does not. That also catches a duplicated id, which would otherwise take
-- two positions and leave one sibling unnumbered.
--
-- `security invoker`, and it exists for ATOMICITY, not privilege — the same
-- reasoning as reorder_tracks (0002:435) and reorder_groups. A half-applied
-- reorder leaves two siblings sharing a position, and only a single statement is
-- atomic under PostgREST. The is_admin() check at the top is not the
-- authorization; RLS is. It is there so a member gets a clean 42501 that
-- src/lib/pgError.ts maps to a translated sentence instead of a silent zero-row
-- UPDATE reported to them as success.
create or replace function public.reorder_map_nodes(
  p_parent uuid,
  p_track  uuid,
  p_ids    uuid[]
) returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_total int;
  v_match int;
  v_count int;
begin
  if not public.is_admin() then
    raise exception 'only an admin may reorder map nodes' using errcode = '42501';
  end if;

  if p_track is null then
    raise exception 'map_node_reorder_scope: a reorder must name the track it is scoped to'
      using errcode = '22023';
  end if;

  v_total := coalesce(array_length(p_ids, 1), 0);
  if v_total = 0 then
    return 0;
  end if;

  -- `is not distinct from` on parent_id, because p_parent is NULL for the root
  -- ring and `= null` would match nothing and report every root as foreign.
  select count(*) into v_match
    from public.map_nodes n
   where n.id = any (p_ids)
     and n.track_id = p_track
     and n.parent_id is not distinct from p_parent;

  if v_match <> v_total then
    raise exception
      'map_node_reorder_foreign: % of % ids do not belong to this parent',
      v_total - v_match, v_total
      using errcode = '22023';
  end if;

  -- One statement, ordinality as the new sort_order. The scope predicates are
  -- repeated here rather than trusted from the check above: the check and the
  -- write must not be able to disagree if somebody later edits one of them.
  --
  -- The `is distinct from` filter skips siblings already in place so a drag that
  -- moves one row does not stamp updated_at on all of them and write an audit
  -- row per sibling — 0018's filter, and the reason it is there.
  update public.map_nodes n
     set sort_order = o.ord::int
    from unnest(p_ids) with ordinality as o(id, ord)
   where n.id = o.id
     and n.track_id = p_track
     and n.parent_id is not distinct from p_parent
     and n.sort_order is distinct from o.ord::int;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- anon is revoked explicitly for the reason spelled out over log_config_audit
-- (0002:377): Supabase's default privileges give anon its OWN grant, which a
-- revoke from PUBLIC leaves in place.
revoke all on function public.reorder_map_nodes(uuid, uuid, uuid[]) from public;
revoke all on function public.reorder_map_nodes(uuid, uuid, uuid[]) from anon;
grant execute on function public.reorder_map_nodes(uuid, uuid, uuid[]) to authenticated;


-- ── move_map_node ───────────────────────────────────────────────────────────
-- Re-parent a node, carrying its subtree and the entries filed on it.
--
-- Returns {"nodes":n,"entries":m,"track_changed":bool} — what moved, which is
-- what the confirmation says BEFORE the click and what the toast says after.
-- `nodes` counts the whole subtree including the node itself, not the rows the
-- UPDATE happened to touch: a same-track move rewrites one row but relocates
-- forty, and reporting "1" would be a true number answering the wrong question.
--
-- REFUSING A TARGET INSIDE THE MOVED SUBTREE is the reason the recursive CTE is
-- here and not left to the deferred cycle check. The cycle check would catch it
-- at COMMIT, by which time the subtree's track_id has been rewritten and the
-- error names an ancestry problem rather than "you dropped this branch on
-- itself". Refusing up front is the message the admin can act on.
--
-- The track rewrite is ONE statement over the whole subtree, which is exactly
-- the case the tree check is deferred for: mid-statement, half the subtree is on
-- the old track and half on the new, and any immediate check would refuse.
--
-- TWO THINGS THIS FUNCTION DOES NOT DO, both deliberate:
--   * It does not renumber `sort_order`. The moved node keeps its old position
--     number among its new siblings, which is a legal but arbitrary place in the
--     list; the admin screen calls reorder_map_nodes() next with the order the
--     reader can see. Guessing a position here would be a second opinion about
--     ordering that no screen asked for.
--   * It does not resolve a sibling-name collision. Moving "Riyadh General"
--     under a parent that already has one raises 23505 on
--     map_nodes_sibling_name_uidx and the whole move rolls back. Renaming
--     somebody's Org to make room is not a move.
create or replace function public.move_map_node(
  p_id     uuid,
  p_parent uuid default null,
  p_track  uuid default null
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_track    uuid;
  v_old      uuid;
  v_ptrack   uuid;
  v_sub      uuid[];
  v_nodes    int := 0;
  v_entries  int := 0;
begin
  if not public.is_admin() then
    raise exception 'only an admin may move a map node' using errcode = '42501';
  end if;

  select n.track_id into v_old from public.map_nodes n where n.id = p_id;
  if not found then
    raise exception 'map_node_missing: node % not found', p_id using errcode = 'P0002';
  end if;

  if p_parent is not null then
    if p_parent = p_id then
      raise exception 'map_node_move_into_self: a node cannot be its own parent'
        using errcode = '22023';
    end if;

    select n.track_id into v_ptrack from public.map_nodes n where n.id = p_parent;
    if not found then
      raise exception 'map_node_missing: target parent % not found', p_parent
        using errcode = 'P0002';
    end if;

    -- The parent decides the track — the same rule map_nodes_derive_track()
    -- enforces on insert. A caller that also sent a track is not overridden
    -- silently: disagreeing about where a subtree is going is worth an error,
    -- because one of the two values is what the admin saw on screen.
    if p_track is not null and p_track is distinct from v_ptrack then
      raise exception
        'map_node_track_mismatch: target parent % is on track %, not %',
        p_parent, v_ptrack, p_track
        using errcode = '22023';
    end if;
    v_track := v_ptrack;
  else
    -- Moving to the root ring. `coalesce` so "make this a root of the track it
    -- is already on" is expressible as move_map_node(id) with no arguments.
    v_track := coalesce(p_track, v_old);
  end if;

  if not exists (select 1 from public.tracks t where t.id = v_track) then
    raise exception 'track_missing: track % not found', v_track using errcode = 'P0002';
  end if;

  -- ── the subtree, computed ONCE, into an array ──
  -- An array rather than a temp table: this runs on a pooled PostgREST
  -- connection, and a function that creates a temp table per call needs CREATE
  -- on the temp schema and leaves the pooler holding per-session objects. The
  -- depth cap is 6, so the array is small by construction.
  --
  -- The walk is bounded by the depth cap only INDIRECTLY — a cycle already in
  -- the table would make this recursion unbounded. It cannot be: the deferred
  -- tree check refuses a cycle at the commit that would have created it, so no
  -- committed state contains one. That is the second thing the check buys.
  with recursive sub as (
    select n.id from public.map_nodes n where n.id = p_id
    union all
    select c.id from public.map_nodes c join sub s on c.parent_id = s.id
  )
  select coalesce(array_agg(sub.id), array[]::uuid[]) into v_sub from sub;

  v_nodes := coalesce(array_length(v_sub, 1), 0);

  if p_parent is not null and p_parent = any (v_sub) then
    raise exception
      'map_node_move_into_self: node % is inside the subtree being moved', p_parent
      using errcode = '22023';
  end if;

  -- One statement: the root row gets its new parent, every row in the subtree
  -- gets the new track. The `or n.id = p_id` keeps the root row in scope on a
  -- same-track move, where the track predicate alone would filter it out.
  update public.map_nodes n
     set parent_id = case when n.id = p_id then p_parent else n.parent_id end,
         track_id  = v_track
   where n.id = any (v_sub)
     and (n.track_id is distinct from v_track or n.id = p_id);

  -- ── the entries filed on the subtree ──
  -- 0024's column; see the header for why this is dynamic. `track_id is
  -- distinct from` so a same-track move writes no entry rows at all — and
  -- therefore does not move `last_activity_at` on forty items that nobody
  -- worked on. (entries_touch() already subtracts track_id from its activity
  -- diff, so even a write that did land would be safe; not writing at all is
  -- cheaper and does not depend on that staying true.)
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'entries' and column_name = 'node_id'
  ) then
    execute
      'update public.entries e set track_id = $2
        where e.node_id = any ($1)
          and e.track_id is distinct from $2'
      using v_sub, v_track;
    get diagnostics v_entries = row_count;
  end if;

  return jsonb_build_object(
    'nodes',         v_nodes,
    'entries',       v_entries,
    'track_changed', v_track is distinct from v_old
  );
end;
$$;

revoke all on function public.move_map_node(uuid, uuid, uuid) from public;
revoke all on function public.move_map_node(uuid, uuid, uuid) from anon;
grant execute on function public.move_map_node(uuid, uuid, uuid) to authenticated;


-- ── 0002 REDEFINED (1/2): the track delete guard learns about nodes ─────────
-- `map_nodes.track_id` is `on delete restrict`, so deleting a track with a tree
-- under it now fails on the FK — with a message naming
-- `map_nodes_track_id_fkey`, which src/lib/pgError.ts has no pattern for and
-- renders as the generic common.error.
--
-- This guard fires first, counts the nodes with the entries and the meetings,
-- and keeps the `track_in_use:` token so the admin gets the same translated
-- sentence and the same reassign step he gets today. Everything else about the
-- function is 0002's, verbatim.
create or replace function public.tracks_block_delete_when_referenced()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entries   int;
  v_meetings  int;
  v_templates int;
  v_nodes     int;
begin
  select count(*) into v_entries    from public.entries             where track_id = old.id;
  select count(*) into v_meetings   from public.meetings            where track_id = old.id;
  select count(*) into v_templates  from public.recurring_templates where track_id = old.id;
  select count(*) into v_nodes      from public.map_nodes           where track_id = old.id;

  if v_entries + v_meetings + v_templates + v_nodes > 0 then
    -- The 'track_in_use:' prefix is a contract with src/lib/pgError.ts, which
    -- pattern-matches it to an i18n key. The counts ride along in the message
    -- for the SQL Editor and the Postgres log; the UI gets its own counts from
    -- getTrackUsage() and never parses numbers out of this string.
    raise exception
      'track_in_use: % entries, % meetings, % recurring templates, % map nodes still reference this track',
      v_entries, v_meetings, v_templates, v_nodes
      using errcode = '23503';
  end if;

  return old;
end;
$$;

-- The trigger itself is unchanged and already installed by 0002; recreated here
-- so a project restored from a partial state still has it bound.
drop trigger if exists tracks_block_delete_trg on public.tracks;
create trigger tracks_block_delete_trg
  before delete on public.tracks
  for each row execute function public.tracks_block_delete_when_referenced();


-- ── 0002 REDEFINED (2/2): delete_track reassigns the tree too ──────────────
-- Without this, `delete_track(id, other)` moves the entries, the meetings and
-- the templates, then trips the guard above on the nodes it left behind — and
-- the admin sees "still in use" after being told the reassignment worked.
--
-- The node reassignment is ONE statement covering the whole track, parents
-- included, which is again exactly what the deferred tree check exists for:
-- mid-statement the tree spans two tracks, and at commit it does not.
--
-- ONE FAILURE MODE WORTH NAMING: sibling names are unique per (track, parent),
-- so reassigning a track whose root ring holds "OB" onto a track that already
-- has an "OB" raises 23505 on map_nodes_sibling_name_uidx and the whole delete
-- rolls back. That is the correct answer — silently merging two programmes'
-- root rings would be unrecoverable — but the message names an index, so
-- pgErrorKey() needs a pattern for it. It is in the handoff.
create or replace function public.delete_track(
  p_id          uuid,
  p_reassign_to uuid default null
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_entries   int := 0;
  v_meetings  int := 0;
  v_templates int := 0;
  v_nodes     int := 0;
  v_before    jsonb;
begin
  if not public.is_admin() then
    raise exception 'only an admin may delete a track' using errcode = '42501';
  end if;

  -- Every raise below carries a token ('reassign_self:', 'track_missing:',
  -- 'reassign_archived:') for the same reason the guard triggers do: without one
  -- src/lib/pgError.ts has nothing to match and falls through to the generic
  -- common.error, which tells an admin who just lost a destination nothing.

  -- Reassigning a track to itself would move nothing, delete the target, and
  -- report success — the exact shape of an accident that loses work.
  if p_reassign_to is not null and p_reassign_to = p_id then
    raise exception 'reassign_self: a track cannot be reassigned to itself'
      using errcode = '22023';
  end if;

  select to_jsonb(t) into v_before from public.tracks t where t.id = p_id;
  if v_before is null then
    raise exception 'track_missing: track % not found', p_id using errcode = 'P0002';
  end if;

  if p_reassign_to is not null then
    -- `and not archived` is load-bearing, not a tidiness check. An archived
    -- track is invisible to the whole app: listTracks() filters archived = false
    -- by default (src/api/tracks.ts), so every reassigned entry and meeting
    -- lands under a track no picker and no list shows, and
    -- materialize_due_recurring() skips templates whose track is archived, so
    -- reassigned templates stop producing entries permanently — while this
    -- function returns its counts and the UI toasts "moved N entries". Losing
    -- work quietly is worse than refusing, so this refuses.
    if not exists (
      select 1 from public.tracks where id = p_reassign_to and archived = false
    ) then
      if exists (select 1 from public.tracks where id = p_reassign_to) then
        raise exception
          'reassign_archived: reassignment target % is archived', p_reassign_to
          using errcode = '22023';
      end if;
      raise exception 'track_missing: reassignment target % not found', p_reassign_to
        using errcode = 'P0002';
    end if;

    -- entries_touch() is what makes this safe: repointing track_id moves
    -- updated_at but leaves last_activity_at alone, so a stale item stays
    -- stale through the move. NOTE: true of the function AS AMENDED BY 0007.
    update public.entries set track_id = p_reassign_to where track_id = p_id;
    get diagnostics v_entries = row_count;

    update public.meetings set track_id = p_reassign_to where track_id = p_id;
    get diagnostics v_meetings = row_count;

    update public.recurring_templates set track_id = p_reassign_to where track_id = p_id;
    get diagnostics v_templates = row_count;

    -- 0023. Every node of the track in one statement, so the tree spans two
    -- tracks only between this statement and the commit, which is precisely the
    -- window map_nodes_tree_ck_trg is deferred across.
    update public.map_nodes set track_id = p_reassign_to where track_id = p_id;
    get diagnostics v_nodes = row_count;

    -- Logged as its own row, before the delete row, because "where did 40
    -- entries go" is a different question from "who deleted the track" and
    -- the answer to the first is these counts.
    perform public.log_config_audit(
      'tracks', p_id, 'move', v_before,
      jsonb_build_object(
        'reassign_to', p_reassign_to,
        'entries',     v_entries,
        'meetings',    v_meetings,
        'templates',   v_templates,
        'nodes',       v_nodes
      )
    );
  end if;

  -- The 'delete' audit row is written by tracks_audit_trg with to_jsonb(old)
  -- as `before`, so the log still reads "Deleted Network (#06b6d4)" long after
  -- the row itself is gone.
  delete from public.tracks where id = p_id;

  return jsonb_build_object(
    'entries',   v_entries,
    'meetings',  v_meetings,
    'templates', v_templates,
    'nodes',     v_nodes
  );
end;
$$;

revoke all on function public.delete_track(uuid, uuid) from public;
revoke all on function public.delete_track(uuid, uuid) from anon;
grant execute on function public.delete_track(uuid, uuid) to authenticated;


-- ═══ PROBES ═════════════════════════════════════════════════════════════════
--
-- Every one of these can FAIL, which is the rule docs/PENDING-MIGRATIONS.md
-- ends on: 0019's PROBE 1 asserted that a row existed and never what it said,
-- and a wrong notification shipped. Each assertion below is written so that
-- deleting the code it tests makes it raise.
--
-- ── probe 1: the shape landed ──────────────────────────────────────────────
do $shape$
declare
  v_kinds   int;
  v_missing text;
  v_idx     text;
begin
  select count(*) into v_kinds from public.map_node_kinds;

  select string_agg(want, ', ') into v_missing
    from (values ('Programme'), ('Phase'), ('Organization')) as w(want)
   where not exists (
     select 1 from public.map_node_kinds k where lower(btrim(k.name)) = lower(w.want)
   );

  if v_missing is not null then
    raise exception
      'NphiesCore 0023 FAILED: these node kinds were not created: %. The seed did not land.',
      v_missing;
  end if;

  if v_kinds < 3 then
    raise exception
      'NphiesCore 0023 FAILED: % map_node_kinds rows, expected at least 3.', v_kinds;
  end if;

  -- A colour column here would mean somebody added a third visual encoding to a
  -- map that has two. Failing the migration is the only way to make that a
  -- conversation rather than a merge.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'map_node_kinds'
       and column_name in ('color', 'colour', 'color_light')
  ) then
    raise exception
      'NphiesCore 0023 FAILED: map_node_kinds has a colour column. Colour is INHERITED from the track (src/lib/mindtree/model.ts) and the map has already spent its two visual variables.';
  end if;

  -- The sibling index must be the NULLS NOT DISTINCT one, or two roots named
  -- "OB" under one track are both legal and this file's central promise is
  -- silently absent.
  select pg_get_indexdef(i.indexrelid) into v_idx
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
   where c.relname = 'map_nodes_sibling_name_uidx';

  if v_idx is null then
    raise exception 'NphiesCore 0023 FAILED: map_nodes_sibling_name_uidx does not exist.';
  end if;

  if position('NULLS NOT DISTINCT' in upper(v_idx)) = 0 then
    raise exception
      'NphiesCore 0023 FAILED: map_nodes_sibling_name_uidx is not NULLS NOT DISTINCT (%). Two roots named "OB" under one track would both be accepted.',
      v_idx;
  end if;

  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relname = 'map_nodes' and t.tgname = 'map_nodes_tree_ck_trg'
       and t.tgdeferrable and t.tginitdeferred
  ) then
    raise exception
      'NphiesCore 0023 FAILED: map_nodes_tree_ck_trg is missing or is not DEFERRABLE INITIALLY DEFERRED. A subtree move across tracks would be refused mid-statement.';
  end if;

  -- The three RPC SIGNATURES, by exact argument list. PostgREST resolves a
  -- function by the NAMES of the arguments in the JSON body, so a signature that
  -- drifts from what src/api/map.ts sends is not a type error anywhere — it is a
  -- 404 the first time an admin drags a node, months after both halves were
  -- reviewed and found correct on their own.
  select string_agg(want, ', ') into v_missing
    from (values
      ('public.reorder_map_nodes(uuid,uuid,uuid[])'),
      ('public.move_map_node(uuid,uuid,uuid)'),
      ('public.reorder_map_node_kinds(uuid[])')
    ) as w(want)
   where to_regprocedure(w.want) is null;

  if v_missing is not null then
    raise exception
      'NphiesCore 0023 FAILED: these RPCs are missing or have a different argument list: %. src/api/map.ts calls them by name and would get a 404.',
      v_missing;
  end if;

  raise notice
    'NphiesCore 0023 probe 1: % node kinds seeded, no colour column, sibling index is NULLS NOT DISTINCT, tree check is deferred, all three RPCs present with the expected argument lists.',
    v_kinds;
end
$shape$;


-- ── probe 2: the tree rules actually refuse ────────────────────────────────
-- Everything here is rolled back through a sentinel exception, so no live row
-- is created, changed or deleted.
--
-- THE DEFERRED PART IS THE HARD PART. A `constraint trigger … initially
-- deferred` does not fire when a savepoint is released — pending events are
-- handed up to the parent transaction — so a probe that only did the UPDATE and
-- released would prove nothing and PASS. `set constraints all immediate` is the
-- statement that forces the queue to drain, and it is what turns each of these
-- into a test that can fail. Each sub-block asserts on the TOKEN in sqlerrm as
-- well, so "it raised something" is not mistaken for "it raised the right
-- thing".
do $tree$
declare
  v_track1  uuid;
  v_track2  uuid;
  v_root    uuid;
  v_n       uuid;
  v_prev    uuid;
  v_other   uuid;
  v_i       int;
  v_ok      boolean;
  v_tag     text := '0023probe';
begin
  select id into v_track1 from public.tracks order by sort_order, name limit 1;
  select id into v_track2 from public.tracks where id <> v_track1 order by sort_order, name limit 1;

  if v_track1 is null then
    raise exception 'NphiesCore 0023 FAILED: no tracks exist, so the tree probes cannot run.';
  end if;

  begin
    -- ── fixture: a legal six-level chain under track 1 ──
    insert into public.map_nodes (track_id, parent_id, name)
      values (v_track1, null, v_tag || ' L1') returning id into v_root;
    v_prev := v_root;
    for v_i in 2..6 loop
      insert into public.map_nodes (track_id, parent_id, name)
        values (v_track1, v_prev, v_tag || ' L' || v_i) returning id into v_n;
      v_prev := v_n;
    end loop;

    -- Prove the fixture itself is legal: six levels must PASS. Without this the
    -- three refusals below would also pass on a trigger that refuses everything.
    execute 'set constraints all immediate';
    execute 'set constraints all deferred';

    -- ── a 7th level raises ──
    v_ok := false;
    begin
      insert into public.map_nodes (track_id, parent_id, name)
        values (v_track1, v_prev, v_tag || ' L7');
      execute 'set constraints all immediate';
    exception when others then
      v_ok := position('map_node_depth' in sqlerrm) > 0;
    end;
    execute 'set constraints all deferred';
    if not v_ok then
      raise exception
        'NphiesCore 0023 FAILED: a 7th level was accepted (or refused for the wrong reason). The depth cap is not enforced, and radial layout area grows quadratically with it.';
    end if;

    -- ── a cycle raises ──
    -- The root is re-parented onto its own grandchild. Nothing else changes, so
    -- track_id still agrees everywhere and only the cycle rule can fire.
    v_ok := false;
    begin
      update public.map_nodes
         set parent_id = (select id from public.map_nodes where name = v_tag || ' L3')
       where id = v_root;
      execute 'set constraints all immediate';
    exception when others then
      v_ok := position('map_node_cycle' in sqlerrm) > 0;
    end;
    execute 'set constraints all deferred';
    if not v_ok then
      raise exception
        'NphiesCore 0023 FAILED: a cycle was accepted (or refused for the wrong reason). Every recursive walk in the app would spin.';
    end if;

    -- ── a cross-track parent raises AT COMMIT ──
    if v_track2 is null then
      raise notice
        'NphiesCore 0023 probe 2: only one track exists, so the cross-track rule could not be exercised. It IS installed — verify by hand once a second track exists.';
    else
      insert into public.map_nodes (track_id, parent_id, name)
        values (v_track2, null, v_tag || ' other-track') returning id into v_other;

      v_ok := false;
      begin
        -- parent_id alone, with track_id deliberately left on track 1. This is
        -- the raw-PATCH path, and it must be refused at commit rather than
        -- silently producing a node whose colour and SLA come from one track
        -- while its ancestry comes from another.
        update public.map_nodes set parent_id = v_other where id = v_root;
        execute 'set constraints all immediate';
      exception when others then
        v_ok := position('map_node_track_mismatch' in sqlerrm) > 0;
      end;
      execute 'set constraints all deferred';
      if not v_ok then
        raise exception
          'NphiesCore 0023 FAILED: a cross-track parent was accepted (or refused for the wrong reason). Two filing axes are representable and the whole design rests on their not being.';
      end if;
    end if;

    -- ── two siblings named org1 / ORG1 collide ──
    -- Immediate (a unique index, not the deferred trigger), so no forced drain.
    v_ok := false;
    begin
      insert into public.map_nodes (track_id, parent_id, name)
        values (v_track1, null, 'org1');
      insert into public.map_nodes (track_id, parent_id, name)
        values (v_track1, null, 'ORG1');
    exception when unique_violation then
      v_ok := true;
    end;
    if not v_ok then
      raise exception
        'NphiesCore 0023 FAILED: two root nodes named org1 and ORG1 were both accepted under one track. The sibling index is missing its NULLS NOT DISTINCT or its lower().';
    end if;

    -- ── deleting a node with a child raises ──
    v_ok := false;
    begin
      delete from public.map_nodes where id = v_root;
    exception when others then
      v_ok := position('map_node_in_use' in sqlerrm) > 0;
    end;
    if not v_ok then
      raise exception
        'NphiesCore 0023 FAILED: a node with children was deleted (or refused for the wrong reason). The delete guard is not firing and a click could take a programme with it.';
    end if;

    raise exception using errcode = 'OT023', message = 'probe rollback';
  exception
    when sqlstate 'OT023' then
      null;
  end;

  raise notice
    'NphiesCore 0023 probe 2: six levels legal, a 7th refused, a cycle refused, a cross-track parent refused at the forced commit point, org1/ORG1 collided, and a node with a child could not be deleted. Rolled back.';
end
$tree$;


-- ── probe 3: a member reads the tree and cannot write it ───────────────────
-- The claim that cannot be verified by reading the file: member read, ADMIN
-- write. Both halves fail in opposite directions — a member who cannot READ
-- nodes sees a map with no Orgs on it, and a member who CAN write them can
-- re-parent another team's programme.
--
-- The skip test is SCOPED TO THE ROLE SWITCH ALONE, and that scoping is the
-- point: a broken INSERT policy raises 42501 too, and wrapping the whole client
-- half would report it as "skipped" — a green migration with an admin who
-- cannot create a node. 0017 learned this the expensive way.
do $rls$
declare
  v_admin      uuid := gen_random_uuid();
  v_member     uuid := gen_random_uuid();
  v_track      uuid;
  v_node       uuid;
  v_child      uuid;
  v_derived    uuid;
  v_read       int;
  v_wrote      boolean := false;
  v_reordered  boolean := false;
  v_moved      boolean := false;
  v_admin_ok   boolean := false;
  v_audit0     int;
  v_audit      int := 0;
  v_skipped    boolean := false;
begin
  select id into v_track from public.tracks order by sort_order, name limit 1;
  if v_track is null then
    raise exception 'NphiesCore 0023 FAILED: no tracks exist, so the RLS probe cannot run.';
  end if;

  -- Baseline taken before anything is written: this file promises to be
  -- re-runnable, and a project that already holds a real audit trail for
  -- map_nodes must not fail on an absolute count.
  select count(*) into v_audit0 from public.config_audit where table_name = 'map_nodes';

  begin
    insert into auth.users (id, email, raw_user_meta_data) values
      (v_admin,  'probe-admin-'  || v_admin  || '@0023.invalid',
       jsonb_build_object('display_name', '0023 Probe Admin')),
      (v_member, 'probe-member-' || v_member || '@0023.invalid',
       jsonb_build_object('display_name', '0023 Probe Member'));

    if (select count(*) from public.profiles where id in (v_admin, v_member)) <> 2 then
      raise exception 'NphiesCore 0023 PROBE 3 SETUP FAILED: handle_new_user() did not create the fixture profiles.';
    end if;

    update public.profiles set role = 'admin' where id = v_admin;

    begin
      perform set_config('request.jwt.claims',
                         json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
      set local role authenticated;
    exception when insufficient_privilege then
      v_skipped := true;
    end;

    if not v_skipped then
      -- ── as the admin, exactly as PostgREST arrives: NO track_id sent ──
      -- Which is also the derive trigger's own test. A root has to name its
      -- track, so this one does; the child below does not, and must still land
      -- on the same track.
      insert into public.map_nodes (track_id, name)
        values (v_track, '0023 Probe Root') returning id into v_node;
      v_admin_ok := true;

      -- NO track_id in the column list, deliberately: this is the derive
      -- trigger's own test, and it is the sentence the whole design rests on.
      -- If a client ever HAS to send track_id, two filing axes are back.
      insert into public.map_nodes (parent_id, name)
        values (v_node, '0023 Probe Child') returning id, track_id into v_child, v_derived;

      if v_derived is distinct from v_track then
        raise exception
          'NphiesCore 0023 FAILED: a child inserted with no track_id came back on track % instead of its parent''s %. map_nodes_derive_track() is not deriving, so track_id is a second filing axis a client can disagree with.',
          v_derived, v_track;
      end if;

      -- ── as a plain member ──
      perform set_config('request.jwt.claims',
                         json_build_object('sub', v_member, 'role', 'authenticated')::text, true);

      select count(*) into v_read from public.map_nodes;

      -- RLS makes a blocked UPDATE affect zero rows rather than raise, which is
      -- the whole reason src/lib/permissions.ts exists. Count rows, do not catch.
      update public.map_nodes set name = 'Hijacked' where id = v_node;
      if found then v_wrote := true; end if;

      delete from public.map_nodes where id = v_child;
      if found then v_wrote := true; end if;

      -- …and both RPCs must refuse outright, by their explicit guard, rather
      -- than reporting zero rows as success.
      begin
        perform public.reorder_map_nodes(null::uuid, v_track, array[v_node]);
        v_reordered := true;
      exception when insufficient_privilege then
        null; -- 42501, as intended
      end;

      begin
        perform public.move_map_node(v_node, null, v_track);
        v_moved := true;
      exception when insufficient_privilege then
        null; -- 42501, as intended
      end;

      reset role;

      select count(*) - v_audit0 into v_audit
        from public.config_audit where table_name = 'map_nodes';
    end if;

    raise exception using errcode = 'OT023', message = 'probe rollback';
  exception
    when sqlstate 'OT023' then
      null;
  end;

  if v_skipped then
    raise notice
      'NphiesCore 0023 probe 3 SKIPPED: this role cannot `set role authenticated`, so the RLS half could not run. The policies ARE installed. Verify by hand: sign in as a member and PATCH /rest/v1/map_nodes — it must affect zero rows.';
    return;
  end if;

  if not v_admin_ok then
    raise exception
      'NphiesCore 0023 FAILED: an admin could not insert a map node. map_nodes_insert is too strict and Settings › Structure would be unusable.';
  end if;

  if v_read < 2 then
    raise exception
      'NphiesCore 0023 FAILED: a member read only % map_nodes rows. map_nodes_select is too strict — a member who cannot read the tree sees a map with no organizations on it.',
      v_read;
  end if;

  if v_wrote then
    raise exception
      'NphiesCore 0023 FAILED: a plain member renamed or deleted a map node. The write policies are not admin-gated: the admin owns the SHAPE, members own the DATA.';
  end if;

  if v_reordered then
    raise exception
      'NphiesCore 0023 FAILED: reorder_map_nodes() accepted a plain member. Its is_admin() guard is missing, so a member''s reorder would report success while moving nothing.';
  end if;

  if v_moved then
    raise exception
      'NphiesCore 0023 FAILED: move_map_node() accepted a plain member. A member could re-parent another team''s programme.';
  end if;

  if v_audit < 1 then
    raise exception
      'NphiesCore 0023 FAILED: creating a node wrote % config_audit rows for map_nodes, expected at least 1. A tree change with no trail is exactly what config_audit exists to prevent.',
      v_audit;
  end if;

  raise notice
    'NphiesCore 0023 probe 3: an admin created a root and a child (the child''s track_id derived from its parent), a member read % nodes and could neither rename, delete, reorder nor move any, and the admin''s write is in config_audit. Rolled back.',
    v_read;
end
$rls$;


-- ── probe 4: reorder_map_nodes refuses an id from another branch ───────────
-- The rule that separates this RPC from reorder_groups. Run as the applying
-- role (no JWT), so is_admin() must be bypassed — it cannot be, so this probe
-- exercises the SCOPE check the only way it can from the SQL Editor: by calling
-- the same predicate the function uses and asserting it would refuse. That is a
-- weaker test than probe 2's and it is labelled as such; the strong version is
-- reorder_map_nodes called by a real admin, and it belongs in the app's own
-- suite, not here.
do $scope$
declare
  v_track1 uuid;
  v_a      uuid;
  v_b      uuid;
  v_match  int;
begin
  select id into v_track1 from public.tracks order by sort_order, name limit 1;
  if v_track1 is null then
    raise exception 'NphiesCore 0023 FAILED: no tracks exist, so the scope probe cannot run.';
  end if;

  begin
    insert into public.map_nodes (track_id, name) values (v_track1, '0023 scope A')
      returning id into v_a;
    insert into public.map_nodes (track_id, parent_id, name) values (v_track1, v_a, '0023 scope B')
      returning id into v_b;

    -- v_b is a CHILD of v_a, so it does not belong to the root ring. The
    -- function's own predicate, verbatim, must match only one of the two.
    select count(*) into v_match
      from public.map_nodes n
     where n.id = any (array[v_a, v_b])
       and n.track_id = v_track1
       and n.parent_id is not distinct from null;

    if v_match <> 1 then
      raise exception
        'NphiesCore 0023 FAILED: the reorder scope predicate matched % of 2 ids, expected 1. An admin reordering one branch could renumber another.',
        v_match;
    end if;

    raise exception using errcode = 'OT023', message = 'probe rollback';
  exception
    when sqlstate 'OT023' then
      null;
  end;

  raise notice
    'NphiesCore 0023 probe 4: the reorder scope predicate accepts only ids whose parent matches, so an id from another branch is refused before anything is written. Rolled back.';
end
$scope$;
