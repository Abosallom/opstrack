-- 0018 — tracks gain a level above them: Technical and Business.
--
-- WHAT THIS IS
-- A restructure engaged Ayenati Product with the Nphies team. One person now
-- owns PMO + Infrastructure + IT Ops + Network + SRE + Dev & QA with two
-- interns; a separate business team owns Onboarding (HIS/LIS) + Product
-- Enhancements + Roadmap, and that team will be signing in to this app too. Six
-- tracks in one flat list could not say which half of the org a row belongs to,
-- so every "my half vs theirs" question was answered by hand.
--
-- This file adds exactly one level: `track_groups`, and a nullable
-- `tracks.group_id` pointing at it. TWO LEVELS, NOT A HIERARCHY — deliberately
-- no self-referential `parent_id`. A general tree would have to be understood by
-- the board, the timeline, the Mindtree, the digest and the filter bar all at
-- once, for a depth nobody asked for. A group is a container for tracks and
-- nothing else: it holds no entries, no SLAs and no tags.
--
--
-- ═══ THE PROMISE THIS FILE MAKES: IT IS PURELY ADDITIVE ═══
--
-- NO ENTRY EVER CHANGES TRACK. Not one row in `entries`, `meetings` or
-- `recurring_templates` is read or written here. Network and SRE stay their own
-- tracks (the owner's call), which is what removes the only thing in this wave
-- that would have needed a decision before it could run: there is no merge, no
-- reassignment, and nothing to roll back.
--
-- Everything this file does is one of four shapes:
--   1. create a table, its policies, its triggers and one RPC;
--   2. add a nullable column to `tracks`;
--   3. insert rows that do not exist (`on conflict … do nothing`);
--   4. update rows ONLY where the column is still exactly what a seed left
--      there — the guarded-update idiom 0002's seed repair established
--      (0002:689). An admin who has already renamed, recoloured or regrouped a
--      track in Settings › Tracks is never stomped, on the first run or the
--      hundredth.
--
--
-- ═══ WHAT LANDS ═══
--
--   Technical  Ayenati PMO¹ · IT Ops¹ · Network · Infrastructure · SRE · Dev & QA²
--   Business   Onboarding · Product Enhancements² · Roadmap²
--
--   ¹ a LABEL rename of the existing seeded row — same id, same entries, same
--     history. "PMO" alone is ambiguous now that Nphies PMO and Ayenati PMO are
--     different things, and "IT Operations" is the only track name that does not
--     fit a phone-width column. Both are also one edit away in Settings ›
--     Tracks, which is exactly why the update below is guarded: a rename made
--     there outranks this file.
--   ² new rows. `Dev & QA` is the sixth technical domain the owner is now
--     personally carrying and had nowhere to file; the two business rows are the
--     other team's, created here so their first sign-in lands on a workspace
--     that already has their work in it rather than an empty picker.
--
-- Sort order for the three new tracks is `max(sort_order) + 1…3`, i.e. appended.
-- The six existing rows are NOT renumbered: `sort_order` is what an admin drags,
-- and rewriting it to make the list read Technical-then-Business would discard a
-- decision somebody made with a mouse. Grouping is now a separate dimension and
-- the group-aware screens read `group_id`, not position.
--
--
-- ═══ COLOURS AND ICONS ═══
--
-- Every hex below is a PAIR from the preset swatch palette in
-- src/styles/global.css (the `--swatch-*-dark` / `--swatch-*-light` block), so
-- the new rows are reachable in the track colour picker instead of being
-- one-offs nobody can reproduce. `color_light` is populated for all of them for
-- the reason 0002's seed repair exists: a dark-theme hex rendered on the light
-- theme's #e9edf1 sits near 2.5:1, which is the exact failure that repair had to
-- go back and fix on five rows. Not repeating it.
--
--   Dev & QA              teal    #2fc5ac / #0d7a6b   icon `terminal`
--   Product Enhancements  magenta #bb72b0 / #9d4b90   icon `layers`
--   Roadmap               orange  #f5904e / #a55418   icon `chart`
--   group Technical       indigo  #7586d5 / #1d2961
--   group Business        slate   #93a3b5 / #56646f
--
-- All three icon names EXIST in src/lib/trackIcons.ts today. That matters,
-- because `trackIcon()` falls back to a plain circle for a name it does not
-- know and there is no CHECK constraint to catch the mistake — deliberately, see
-- that file's header. The live `Onboarding` row is the standing proof: it was
-- seeded with `plug`, which the registry has never had, so it renders as a blank
-- circle today. That row is NOT touched here; adding the glyph is a change to
-- trackIcons.ts, which this file does not own.
--
-- The two group pairs are the two lowest-chroma pairs in the palette, on
-- purpose: a group is a container drawn around tracks (a Mindtree ring, a digest
-- heading, a board axis), and a saturated group colour would compete with the
-- track colours inside it.
--
--
-- ═══ WHY `color_light` EXISTS ON A TABLE THE BRIEF SPELLED WITHOUT IT ═══
--
-- The column list asked for was (id, name, name_ar, color, sort_order). This
-- table has one more: `color_light`, nullable, with `tracks`' exact semantics —
-- null means "no light-theme override" and every reader falls back to `color`.
-- The palette is defined in PAIRS because a single hex cannot clear 3:1 on both
-- #212932 and #e9edf1; shipping a group ring with one hex would reproduce the
-- 0002 defect in a new table on day one. Adding it is additive, costs one
-- nullable column, and `TrackGroup.color_light` is documented in src/types.ts.
--
--
-- Deploy: Supabase Dashboard → SQL Editor → paste + Run. Re-runnable from the
-- top in any partial state, same discipline as 0001–0017: `create table if not
-- exists`, `add column if not exists`, `drop constraint if exists` before every
-- add, `drop policy if exists` before every create, `drop trigger if exists`
-- before every create, `create or replace` on every function, guarded seeds, and
-- probe blocks at the bottom that roll themselves back. A probe failure raises
-- and the whole migration rolls back — no explicit begin/commit here, for the
-- reason 0009's header spells out.


-- ── track_groups ────────────────────────────────────────────────────────────
-- A surrogate uuid rather than the name as the key, unlike `vocab_options`: the
-- name is a LABEL and gets renamed (this very file renames two tracks), while
-- `tracks.group_id` has to keep pointing at the same group across that rename.
--
-- No `archived` column, unlike `tracks`. A group with no tracks in it is already
-- invisible everywhere it appears — every group surface renders tracks, and a
-- group renders nothing of its own — so "archived" would be a second, weaker way
-- to say something the data already says.
create table if not exists public.track_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  name_ar     text not null default '',
  color       text not null default '#6b7280',
  color_light text,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.profiles (id) on delete set null
);

comment on table public.track_groups is
  'The level above tracks: Technical and Business. A container for tracks only — it holds no entries, no SLAs and no tags. tracks.group_id is nullable and `on delete set null`, so removing a group never removes work.';

-- For a project where an earlier cut of this file already landed without them:
-- `create table if not exists` above is a no-op there, so the columns have to be
-- added separately or the constraints below fail against a table that lacks
-- them. Same reasoning as 0017:129.
alter table public.track_groups add column if not exists name_ar     text not null default '';
alter table public.track_groups add column if not exists color       text not null default '#6b7280';
alter table public.track_groups add column if not exists color_light text;
alter table public.track_groups add column if not exists sort_order  int not null default 0;
alter table public.track_groups add column if not exists created_at  timestamptz not null default now();
alter table public.track_groups add column if not exists updated_at  timestamptz not null default now();
alter table public.track_groups add column if not exists created_by  uuid references public.profiles (id) on delete set null;

-- Hex only, six digits — the same constraint and the same reason as
-- tracks_color_chk (0002:139): the value is written straight into a CSS custom
-- property by the frontend, so anything else is either an invisible ring or,
-- with a value like `red; background: url(...)`, a style injection.
alter table public.track_groups drop constraint if exists track_groups_color_chk;
alter table public.track_groups add constraint track_groups_color_chk
  check (color ~* '^#[0-9a-f]{6}$');

alter table public.track_groups drop constraint if exists track_groups_color_light_chk;
alter table public.track_groups add constraint track_groups_color_light_chk
  check (color_light is null or color_light ~* '^#[0-9a-f]{6}$');

-- btrim before measuring: '   ' is an empty name wearing a hat.
alter table public.track_groups drop constraint if exists track_groups_name_len_chk;
alter table public.track_groups add constraint track_groups_name_len_chk
  check (char_length(btrim(name)) between 1 and 40);

-- Case-insensitive, exactly like tracks_name_uidx: "Business" and "business"
-- are one group, and finding out otherwise costs a reader a double-take on every
-- screen that lists groups.
create unique index if not exists track_groups_name_uidx
  on public.track_groups (lower(name));

-- PARTIAL, because name_ar defaults to '' — a plain unique index would let
-- exactly one group go untranslated and reject the second with a duplicate-name
-- error that names the wrong field. Same shape as tracks_name_ar_uidx (0002).
create unique index if not exists track_groups_name_ar_uidx
  on public.track_groups (lower(name_ar)) where name_ar <> '';

create index if not exists track_groups_sort_idx on public.track_groups (sort_order);

alter table public.track_groups enable row level security;

-- Member read, admin write — `tracks`' policy set, verbatim, and in 0009's
-- InitPlan form `(select public.is_member())` so the predicate is evaluated once
-- per statement rather than once per surviving row. Two groups make that
-- academic today; writing it the other way would make this the one table in the
-- schema that has to be found and fixed later.
--
-- A member MUST be able to read this table. Groups are how the two halves of the
-- org stay out of each other's way; a member who cannot read them sees a filter
-- bar with an empty facet and a digest with no sections, which is worse than
-- shipping no grouping at all.
drop policy if exists track_groups_select on public.track_groups;
create policy track_groups_select on public.track_groups
  for select using ((select public.is_member()));

drop policy if exists track_groups_insert on public.track_groups;
create policy track_groups_insert on public.track_groups
  for insert with check ((select public.is_admin()));

drop policy if exists track_groups_update on public.track_groups;
create policy track_groups_update on public.track_groups
  for update using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists track_groups_delete on public.track_groups;
create policy track_groups_delete on public.track_groups
  for delete using ((select public.is_admin()));

-- Explicit, rather than relying on Supabase's default privileges for new tables
-- in `public`. RLS is the gate — every policy above is admin- or member-gated
-- and `is_member()` is false without a JWT — but a project restored from a dump
-- with different default privileges should not silently lose the read.
--
-- `anon` is deliberately left exactly as the project's defaults have it, matching
-- `tracks`: revoking it here would be the only table in the schema doing so, and
-- the anon key cannot pass `is_member()` in any case.
grant select, insert, update, delete on public.track_groups to authenticated;

-- Diffed rather than stamped unconditionally, for the same reason
-- tracks_touch() is (0002): reorder_groups() writes several rows in one
-- statement, and an unconditional stamp would report the whole list as edited —
-- and emit a full set of audit rows — on a drag that moved nothing.
create or replace function public.track_groups_touch()
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

drop trigger if exists track_groups_touch_trg on public.track_groups;
create trigger track_groups_touch_trg
  before update on public.track_groups
  for each row execute function public.track_groups_touch();

-- AFTER, not BEFORE: the row image recorded must be the one that survived every
-- other trigger and constraint on the table. Identical in shape to
-- tracks_audit() (0002:398) — a group rename is a configuration change made by
-- one person with no second pair of eyes, which is the case config_audit exists
-- for, and `before` is the only record of what a group used to be called.
create or replace function public.track_groups_audit()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    -- Casts on the null: with a single candidate Postgres resolves an untyped
    -- null anyway, but an overload added later would make this ambiguous at
    -- runtime, inside a trigger, on someone else's write.
    perform public.log_config_audit('track_groups', new.id, 'insert', null::jsonb, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    if to_jsonb(new) is distinct from to_jsonb(old) then
      perform public.log_config_audit('track_groups', new.id, 'update', to_jsonb(old), to_jsonb(new));
    end if;
    return new;
  else
    perform public.log_config_audit('track_groups', old.id, 'delete', to_jsonb(old), null::jsonb);
    return old;
  end if;
end;
$$;

drop trigger if exists track_groups_audit_trg on public.track_groups;
create trigger track_groups_audit_trg
  after insert or update or delete on public.track_groups
  for each row execute function public.track_groups_audit();


-- ── reorder_groups ──────────────────────────────────────────────────────────
-- `security invoker`, and it exists for ATOMICITY, not privilege — the same
-- reasoning as reorder_tracks (0002:435). A half-applied reorder leaves two
-- groups sharing a position, and only a single statement is atomic under
-- PostgREST. RLS therefore still evaluates against the caller and rejects a
-- member exactly as if they had typed the UPDATE by hand.
--
-- The is_admin() check at the top is not the authorization. It is there so a
-- member gets a clean 42501 that src/lib/pgError.ts maps to a translated
-- sentence, instead of a silent zero-row UPDATE reported to them as success.
create or replace function public.reorder_groups(p_ids uuid[])
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count int;
begin
  if not public.is_admin() then
    raise exception 'only an admin may reorder track groups' using errcode = '42501';
  end if;

  -- One statement, ordinality as the new sort_order. The `is distinct from`
  -- filter skips groups already in place so a drag that moves one row does not
  -- stamp updated_at on all of them and write an audit row per group.
  update public.track_groups g
     set sort_order = o.ord::int
    from unnest(p_ids) with ordinality as o(id, ord)
   where g.id = o.id
     and g.sort_order is distinct from o.ord::int;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- anon is revoked explicitly for the reason spelled out over log_config_audit
-- (0002:377): Supabase's default privileges give anon its OWN grant, which a
-- revoke from PUBLIC leaves in place. is_admin() already returns false without a
-- JWT, so this is defence in depth rather than a fix — but every RPC in this
-- schema should be unreachable with the anon key, not merely unsuccessful.
revoke all on function public.reorder_groups(uuid[]) from public;
revoke all on function public.reorder_groups(uuid[]) from anon;
grant execute on function public.reorder_groups(uuid[]) to authenticated;


-- ── tracks.group_id ─────────────────────────────────────────────────────────
-- NULLABLE, and `on delete set null`. Both halves are load-bearing:
--
--   * nullable, because a track with no group has to be a legal, ordinary state.
--     A new track created in Settings › Tracks before anyone has thought about
--     grouping is ungrouped, not broken, and every group-aware screen has to
--     render it — an "Ungrouped" section, not a crash and not a hidden row.
--   * `set null`, because deleting a group must never take a track (and through
--     it every entry ever filed under that track) with it. Same choice, same
--     reason, as every other track_id FK in this schema.
alter table public.tracks
  add column if not exists group_id uuid references public.track_groups (id) on delete set null;

comment on column public.tracks.group_id is
  'Which half of the org this track belongs to (0018). Nullable: ungrouped is a legal state and group-aware screens render it as its own section.';

-- Every group surface asks "which tracks are in this group", and the digest asks
-- it once per group per build.
create index if not exists tracks_group_idx on public.tracks (group_id);


-- ── seed: the two groups ────────────────────────────────────────────────────
-- `do nothing` rather than `do update`, exactly like 0001's track seed: these
-- are editable in the admin screens and re-running this migration must not stomp
-- a renamed group or a recoloured one.
insert into public.track_groups (name, name_ar, color, color_light, sort_order) values
  ('Technical', 'التقنية', '#7586d5', '#1d2961', 1),
  ('Business',  'الأعمال',  '#93a3b5', '#56646f', 2)
on conflict (lower(name)) do nothing;


-- ── the two label renames ───────────────────────────────────────────────────
-- The guarded-update idiom from 0002's seed repair (0002:689): every predicate
-- pins the row to EXACTLY what the seed left there, so the update can only touch
-- a row nobody has edited. Rename PMO yourself in Settings › Tracks and
-- re-running this migration will not undo you — and because the first run leaves
-- `name = 'Ayenati PMO'`, the second run matches nothing and is a no-op. That is
-- what makes "apply it twice" a real test rather than a formality.
--
-- `name` AND `name_ar` AND `icon` are all pinned, not just the one being
-- changed. A row where the admin translated the Arabic but left the English
-- alone is a row he has an opinion about, and the safest reading of any edit at
-- all is "hands off".
--
-- These fire tracks_audit(), so both renames land in config_audit with the
-- before image — which is the only record of what the track used to be called.
-- log_config_audit()'s JWT-less passthrough (0002:344) is what lets that work
-- from the SQL Editor, where auth.uid() is null.
update public.tracks
   set name = 'Ayenati PMO', name_ar = 'مكتب إدارة مشاريع عينتي'
 where name = 'PMO'
   and name_ar = 'مكتب إدارة المشاريع'
   and icon = 'clipboard-list';

-- English only. 'عمليات تقنية المعلومات' already reads as IT Operations and is
-- not the string that overflows a phone-width column, so there is nothing to
-- shorten on the Arabic side.
update public.tracks
   set name = 'IT Ops'
 where name = 'IT Operations'
   and name_ar = 'عمليات تقنية المعلومات'
   and icon = 'server-cog';


-- ── seed: the three new tracks ──────────────────────────────────────────────
-- Appended, never renumbered: `(select max(sort_order) …) + ord` reads the
-- current maximum ONCE (a non-correlated subquery over the statement's snapshot,
-- so the three rows get base+1, base+2, base+3 and cannot collide with each
-- other or with a list an admin has already dragged into shape).
--
-- INNER join to track_groups, not left: if the group seed above somehow did not
-- land, this insert produces zero rows and probe 1 at the bottom fails the whole
-- migration by name. A left join would have created three ungrouped tracks and
-- reported success.
--
-- `on conflict (lower(name)) do nothing` on the same expression index 0001's
-- seed uses, so a re-run inserts nothing and an admin who already created his
-- own "Roadmap" keeps it rather than getting a duplicate.
insert into public.tracks (name, name_ar, color, color_light, icon, sort_order, group_id)
select v.name,
       v.name_ar,
       v.color,
       v.color_light,
       v.icon,
       (select coalesce(max(t.sort_order), 0) from public.tracks t) + v.ord,
       g.id
  from (values
    ('Dev & QA',             'التطوير والجودة', '#2fc5ac', '#0d7a6b', 'terminal', 1, 'Technical'),
    ('Product Enhancements', 'تحسينات المنتج',  '#bb72b0', '#9d4b90', 'layers',   2, 'Business'),
    ('Roadmap',              'خارطة الطريق',    '#f5904e', '#a55418', 'chart',    3, 'Business')
  ) as v (name, name_ar, color, color_light, icon, ord, grp)
  join public.track_groups g on g.name = v.grp
on conflict (lower(name)) do nothing;


-- ── assign the existing tracks to a group ───────────────────────────────────
-- `group_id is null` is the guard, and it is the whole safety story: this can
-- only ever FILL an empty group, never move a track from one group to another.
-- An admin who regroups anything keeps his choice through every re-run.
--
-- The name lists carry BOTH the seeded spelling and the renamed one, so the file
-- is order-independent and idempotent: it assigns correctly whether or not the
-- renames above ran on this pass, and on a project where an admin renamed a
-- track to something of his own the row is simply left ungrouped for him to
-- place — which is a visible, fixable state, not a wrong answer.
--
-- The one thing a re-run can undo is a deliberate UN-grouping back to null. That
-- is a state the seed never intended and no screen offers a control for; if it
-- ever becomes a thing people do, the fix is a `grouped_at` marker, not a
-- weaker guard here.
update public.tracks t
   set group_id = g.id
  from public.track_groups g
 where g.name = 'Technical'
   and t.group_id is null
   and lower(t.name) in ('pmo', 'ayenati pmo', 'it operations', 'it ops',
                         'network', 'infrastructure', 'sre', 'dev & qa');

update public.tracks t
   set group_id = g.id
  from public.track_groups g
 where g.name = 'Business'
   and t.group_id is null
   and lower(t.name) in ('onboarding', 'product enhancements', 'roadmap');


-- ── probe 1: the shape this file promises, checked against live data ────────
-- Runs as whoever applies the file (the SQL Editor, i.e. no JWT), which is the
-- right role here: this probe tests the SEED and the ASSIGNMENT, not the
-- policies. RLS is probe 2's job.
--
-- It raises rather than notices. A migration that left three tracks ungrouped,
-- or created the business rows without a group, would show up as an empty
-- section in a digest a director reads — days later, with no way to tell whether
-- the section is empty because the work is done or because the data is wrong.
-- Refusing to finish costs nothing: everything above is idempotent, so the
-- fix-and-re-run loop is free.
--
-- Every assertion below is written to be TRUE ON A RE-RUN and true on a project
-- where the admin has already edited things, which is why they count group
-- membership rather than pinning names: `Technical` must contain six tracks and
-- `Business` three, and no track may be left ungrouped.
do $shape$
declare
  v_groups   int;
  v_tracks   int;
  v_tech     int;
  v_biz      int;
  v_orphan   int;
  v_stale    int;
  v_missing  text;
begin
  select count(*) into v_groups from public.track_groups;
  select count(*) into v_tracks from public.tracks;
  select count(*) into v_orphan from public.tracks where group_id is null;

  select count(*) into v_tech
    from public.tracks t join public.track_groups g on g.id = t.group_id
   where g.name = 'Technical';

  select count(*) into v_biz
    from public.tracks t join public.track_groups g on g.id = t.group_id
   where g.name = 'Business';

  -- The three rows this file is responsible for creating. Named, because "9
  -- tracks" would also be satisfied by nine of the wrong ones.
  select string_agg(want, ', ') into v_missing
    from (values ('Dev & QA'), ('Product Enhancements'), ('Roadmap')) as w(want)
   where not exists (
     select 1 from public.tracks t where lower(t.name) = lower(w.want)
   );

  -- Neither seeded name may survive: either this file renamed it, or an admin
  -- already renamed it to something of his own — both are fine, "still called
  -- PMO" is not.
  select count(*) into v_stale
    from public.tracks where name in ('PMO', 'IT Operations');

  if v_groups < 2 then
    raise exception
      'OpsTrack 0018 FAILED: % track_groups rows, expected at least Technical and Business. The group seed did not land, so every track below it is ungrouped.',
      v_groups;
  end if;

  if v_missing is not null then
    raise exception
      'OpsTrack 0018 FAILED: these tracks were not created: %. The insert''s join to track_groups found no group, or a name collided with an existing track.',
      v_missing;
  end if;

  if v_tracks < 9 then
    raise exception
      'OpsTrack 0018 FAILED: % tracks, expected at least 9 (6 seeded + 3 new).',
      v_tracks;
  end if;

  if v_orphan <> 0 then
    raise exception
      'OpsTrack 0018 FAILED: % tracks have no group. Every track this file knows about must be in one, or a group-grouped digest silently omits them.',
      v_orphan;
  end if;

  if v_tech < 6 then
    raise exception
      'OpsTrack 0018 FAILED: Technical holds % tracks, expected 6 (Ayenati PMO, IT Ops, Network, Infrastructure, SRE, Dev & QA).',
      v_tech;
  end if;

  if v_biz < 3 then
    raise exception
      'OpsTrack 0018 FAILED: Business holds % tracks, expected 3 (Onboarding, Product Enhancements, Roadmap).',
      v_biz;
  end if;

  if v_stale <> 0 then
    raise exception
      'OpsTrack 0018 FAILED: % track(s) are still named PMO or IT Operations. The guarded rename matched nothing and did not report it.',
      v_stale;
  end if;

  raise notice
    'OpsTrack 0018 probe 1: % groups, % tracks, Technical=% Business=%, 0 ungrouped, both renames applied, all three new tracks present.',
    v_groups, v_tracks, v_tech, v_biz;
end
$shape$;


-- ── probe 2: a member reads groups and cannot write them ───────────────────
-- The claim this file makes that cannot be verified by reading it: `member read,
-- admin write`. Both halves matter and they fail in opposite directions — a
-- member who cannot READ groups gets an empty filter facet and a sectionless
-- digest, and a member who CAN write them can rename the other team's half of
-- the org.
--
-- The client half needs the ROLE, not just the JWT, so this probe does `set
-- local role authenticated`. If that role is not grantable to whoever is running
-- this file, the probe says so and SKIPS rather than failing the migration — the
-- policies are installed either way, and a false failure here would send an
-- operator hunting a bug that is not there. 0015 and 0017 make the same choice.
--
-- The skip test is SCOPED TO THE ROLE SWITCH ALONE, and that scoping is the
-- point: a broken INSERT policy raises 42501 too, and wrapping the whole block
-- would report it as "skipped" — a green-looking migration with an admin who
-- cannot create a group.
--
-- Everything is rolled back through a sentinel exception, including the two
-- fixture users, so the workspace's real member list is untouched.
do $rls$
declare
  v_admin    uuid := gen_random_uuid();
  v_member   uuid := gen_random_uuid();
  v_read     int;
  v_wrote    boolean := false;
  v_reordered boolean := false;
  v_admin_ok boolean := false;
  v_audit0   int;
  v_audit    int := 0;
  v_skipped  boolean := false;
begin
  -- Baseline taken OUTSIDE the fixture block and before anything is written:
  -- this file promises to be re-runnable, and a project that already holds a
  -- real audit trail for track_groups must not fail on an absolute count.
  select count(*) into v_audit0 from public.config_audit where table_name = 'track_groups';

  begin
    insert into auth.users (id, email, raw_user_meta_data) values
      (v_admin,  'probe-admin-'  || v_admin  || '@0018.invalid',
       jsonb_build_object('display_name', '0018 Probe Admin')),
      (v_member, 'probe-member-' || v_member || '@0018.invalid',
       jsonb_build_object('display_name', '0018 Probe Member'));

    if (select count(*) from public.profiles where id in (v_admin, v_member)) <> 2 then
      raise exception 'OpsTrack 0018 PROBE 2 SETUP FAILED: handle_new_user() did not create the fixture profiles.';
    end if;

    -- handle_new_user() hardcodes 'member'; this write is the SQL-Editor path
    -- guard_profile_role() allows.
    update public.profiles set role = 'admin' where id = v_admin;

    begin
      perform set_config('request.jwt.claims',
                         json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
      set local role authenticated;
    exception when insufficient_privilege then
      v_skipped := true;
    end;

    if not v_skipped then
      -- ── as the admin, exactly as PostgREST arrives ──
      insert into public.track_groups (name, name_ar, color, sort_order)
        values ('0018 Probe Group', 'مجموعة اختبار', '#93a3b5', 99);
      v_admin_ok := true;

      -- ── as a plain member ──
      perform set_config('request.jwt.claims',
                         json_build_object('sub', v_member, 'role', 'authenticated')::text, true);

      select count(*) into v_read from public.track_groups;

      -- RLS makes a blocked UPDATE affect zero rows rather than raise, which is
      -- the whole reason src/lib/permissions.ts exists. Count rows, do not catch.
      update public.track_groups set name = 'Hijacked' where name = '0018 Probe Group';
      if found then v_wrote := true; end if;

      delete from public.track_groups where name = '0018 Probe Group';
      if found then v_wrote := true; end if;

      -- …and the RPC must refuse outright, by its explicit guard, rather than
      -- reporting zero rows moved as a successful reorder.
      begin
        perform public.reorder_groups(
          array(select id from public.track_groups order by sort_order));
        v_reordered := true;
      exception when insufficient_privilege then
        null; -- 42501, as intended
      end;

      reset role;

      select count(*) - v_audit0 into v_audit
        from public.config_audit where table_name = 'track_groups';
    end if;

    raise exception using errcode = 'OT018', message = 'probe rollback';
  exception
    when sqlstate 'OT018' then
      null;
  end;

  if v_skipped then
    raise notice
      'OpsTrack 0018 probe 2 SKIPPED: this role cannot `set role authenticated`, so the RLS half could not run. The policies ARE installed. Verify by hand: sign in as a member and PATCH /rest/v1/track_groups — it must affect zero rows.';
    return;
  end if;

  if not v_admin_ok then
    raise exception
      'OpsTrack 0018 FAILED: an admin could not insert a track group. track_groups_insert is too strict and the Groups screen would be unusable.';
  end if;

  if v_read < 3 then
    raise exception
      'OpsTrack 0018 FAILED: a member read only % track_groups rows. track_groups_select is too strict — a member who cannot read groups gets an empty filter facet and a digest with no sections.',
      v_read;
  end if;

  if v_wrote then
    raise exception
      'OpsTrack 0018 FAILED: a plain member renamed or deleted a track group. The write policies are not admin-gated, and one half of the org can rewrite the other half''s.';
  end if;

  if v_reordered then
    raise exception
      'OpsTrack 0018 FAILED: reorder_groups() accepted a plain member. Its is_admin() guard is missing, so a member''s reorder would report success while moving nothing.';
  end if;

  if v_audit < 1 then
    raise exception
      'OpsTrack 0018 FAILED: creating a group wrote % config_audit rows for track_groups, expected at least 1. A group rename with no trail is exactly what config_audit exists to prevent.',
      v_audit;
  end if;

  raise notice
    'OpsTrack 0018 probe 2: an admin created a group, a member read % of them and could neither rename, delete nor reorder any, and the admin''s write is in config_audit. Rolled back.',
    v_read;
end
$rls$;
