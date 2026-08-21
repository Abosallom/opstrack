-- 0025 — custom roles and permissions: two functions redefined, 21 policies moved.
--
-- ⚠ AMENDED 11 AUGUST 2026, BEFORE FIRST APPLY ⚠
--
--   This file has never been run against any database, so this is an EDIT and
--   not an 0026. Amending an unapplied migration is free; amending an applied
--   one costs a new file forever. WHAT CHANGED, and why each half is here:
--
--     * AND THE EIGHT ADMIN RPCs THAT WRITE THOSE SAME TABLES ARE RESTATED HERE
--       with the same swap: `reorder_tracks`, `delete_track`,
--       `reorder_map_node_kinds`, `reorder_map_nodes` and `move_map_node` on
--       `structure.edit`; `reorder_vocab`, `reset_vocab` and
--       `reset_label_overrides` on `vocab.edit`. Re-pointing the POLICIES alone
--       shipped a Director who could create, rename and delete a map node and
--       could not DRAG one — a clean 42501 raised by a function that was no
--       longer echoing the policy but contradicting it. See "THE ADMIN RPCs
--       ANSWER TO A KEY TOO", which also says why the bodies are restated in
--       this file rather than edited in 0002/0003/0017/0023.
--
--     * THE ADMIN-WRITE POLICIES ON THE SEVEN CONFIGURATION TABLES NOW CHECK A
--       KEY. `tracks`, `track_groups`, `map_nodes` and `map_node_kinds` are
--       gated on `has_perm('structure.edit')`; `use_cases`, `vocab_options` and
--       `label_overrides` on `has_perm('vocab.edit')`. The first cut of this
--       file seeded five keys and left NO POLICY ANYWHERE READING three of
--       them — `structure.edit`, `vocab.edit` and `capture.write` — so a
--       Director could write exactly what a plain member can: nothing. The role
--       was a label with no power, and a roles screen would have rendered three
--       of its five switches wired to a light bulb that is not there — the
--       precise lie the section below spends a page warning about. Two of the
--       three are now live; `capture.write` is honestly labelled as not. See
--       "RLS: the CONFIGURATION tables answer to a KEY".
--
--     * `profiles`, `roles` and `role_permissions` ARE DELIBERATELY LEFT where
--       they were, on `workspace.admin` and `members.manage`. That is the
--       escalation boundary — a role that can edit permissions can grant itself
--       anything — and there is a comment against each one saying so, plus a
--       CATALOGUE ASSERTION in probe 5 that fails if anybody ever moves them.
--
--     * PROBE 5 IS NEW and is the proof rather than the claim: a Director
--       fixture inserts a `map_nodes` row and updates a `use_cases` row (both
--       refused before this amendment — that is what makes the assertion able
--       to fail), and is refused a `profiles` insert, a `role_id` change on
--       anybody including themselves, and a `role_permissions` write.
--
--     * PROBE 2 — the safety net — GAINED TWO ASSERTIONS, and they matter more
--       than probe 5's. Every pre-existing admin must now also hold
--       `structure.edit` and `vocab.edit`, because those keys and not
--       `is_admin()` are what reaches `tracks` and `use_cases` after this
--       change. A seed that landed `workspace.admin` and missed the other two
--       would leave probe 2 green and Settings › Structure closed to the owner
--       of the workspace, with no error anywhere.
--
--     * THE RE-RUN HAZARD WIDENED from 3 functions to 11 functions and 21
--       policies. Re-running 0001, 0002, 0003, 0009, 0017, 0018, 0023 or 0024
--       after this file puts its tables and its RPCs back on `is_admin()`. See
--       the RE-RUN SAFETY section, which now says so at length.
--
--     * ⚠ THIS FILE NOW DEPENDS ON 0023 AND 0024. It was independent of both
--       before the amendment; it now re-points policies on `map_nodes`,
--       `map_node_kinds` and `use_cases`, which those two files create. The
--       preflight below refuses with a sentence rather than failing halfway
--       through with a bare 42P01. Apply order is unchanged — 0023, 0024, 0025
--       — but it is now enforced rather than merely recommended.
--
--   `is_admin()` KEEPS ITS MEANING and every policy NOT listed above is
--   untouched, byte for byte. Recorded in docs/PENDING-MIGRATIONS.md.
--
-- WHAT THIS IS
-- The workspace stopped being three people and became eighteen, with nine names
-- put forward for elevated access. Two hardcoded roles — the `admin` / `member`
-- CHECK constraint on `profiles.role` (0001:24) — cannot express "may edit the
-- structure and the vocabulary but may NOT delete a colleague's account", which
-- is precisely the split that turns nine admins into two admins and seven
-- directors.
--
-- So roles become DATA: `roles`, `role_permissions`, and `profiles.role_id`.
--
--
-- ═══ WHY THIS IS NOT A SECURITY REWRITE ═══
--
-- The objection to configurable permissions was real and was measured:
-- `is_member()` and `is_admin()` appear at **183 policy call sites across 19
-- migrations**. Re-pointing 183 policies at a dynamic lookup is a rewrite of
-- every access decision in the product, reviewed once, in one pass, by one pair
-- of eyes. That is not a thing to do to a live workspace.
--
-- It is also not necessary, because they are two FUNCTIONS. Redefining the two
-- to consult a permissions table leaves all 183 call sites untouched — byte for
-- byte, semantics unchanged — and permissions become data:
--
--     is_admin()  ->  has_perm('workspace.admin')
--
-- `is_member()` is NOT TOUCHED and keeps its current meaning: *has a profile at
-- all*. That is what workspace membership IS, and the overwhelming majority of
-- those 183 sites are READ policies keyed off it. Giving membership a permission
-- key would mean a role could be created that can sign in and see nothing —
-- an invisible, unexplained, empty app, which is the failure 0001's header
-- already calls out.
--
-- ⚠ THE AMENDMENT MOVES 21 OF THOSE SITES BY HAND, WHICH THIS SECTION HAS TO
--   ACCOUNT FOR RATHER THAN QUIETLY CONTRADICT. What was refused above is
--   re-pointing ALL 183 in one pass — every access decision in the product,
--   reviewed once, by one pair of eyes. What is done below is 21 WRITE policies
--   on SEVEN tables, all of the same shape (`is_admin()` -> one key), all
--   listed by name in one block, all asserted by name in probe 5, and none of
--   them a READ. Every remaining site keeps calling `is_admin()` or
--   `is_member()` and is untouched byte for byte.
--
--   IT ALSO MOVES EIGHT RPC GUARDS, which are not policy call sites and are not
--   in the 183 — they are the `if not is_admin() then raise 42501` line at the
--   top of the eight functions that WRITE those same seven tables. They move for
--   the reason a mirror moves with the thing it reflects: their own headers say
--   the check "is not the authorization; RLS is", so once RLS says a key and the
--   function still says is_admin(), the function has stopped echoing the policy
--   and started contradicting it.
--
--   The alternative was to leave `structure.edit` and `vocab.edit` unread, which
--   is not the safe option — it is the option where the roles screen shows
--   switches that do nothing, which is a different and worse kind of lie about
--   who can do what. A permission key nobody checks is not a small risk; it is a
--   false statement about access rendered in a UI.
--
--
-- ═══ THE PERMISSION KEYS ARE CODE-DEFINED. THIS IS THE ONE THING THAT IS NOT
--     CONFIGURABLE, AND IT HAS TO BE SAID PLAINLY ═══
--
-- A permission is a PROMISE THE CODE ENFORCES. A key nobody checks grants
-- nothing and forbids nothing; putting it in an admin screen would be a switch
-- wired to a light bulb that is not there. Roles are Aziz's to invent and
-- permissions are his to assign — the CATALOGUE of what is grantable grows when
-- FEATURES grow, one line in a migration plus the code that reads it.
--
-- That is not a limitation of this design; it is the only sense in which
-- "configurable permissions" can be a true sentence.
--
-- The catalogue is therefore enforced by the database, as a CHECK constraint
-- (`role_permissions_key_ck`). A client that POSTs `billing.manage` gets a 23514
-- instead of a row that looks like a grant and is not one.
--
-- THE FIVE KEYS, AND EXACTLY HOW MUCH EACH ONE IS WORTH TODAY — measured
-- against the policy list in this file, not assumed. FOUR OF THE FIVE ARE NOW
-- ENFORCED; the amendment above is what changed that, and the count is stated
-- here so the next person can check it rather than trust it:
--
--   workspace.admin  ENFORCED EVERYWHERE. is_admin() is this key, and is_admin()
--                    remains the write gate on `profiles`, `entries` deletion,
--                    `meetings`, `track_slas`, `config_audit` reads, the RPCs
--                    whose subject is PEOPLE, and the members edge function.
--                    Granting it grants all of that. It NO LONGER gates the
--                    seven configuration tables, or the eight RPCs that write
--                    them, directly — Admin reaches those by HOLDING the two
--                    keys below, which it does.
--   structure.edit   ENFORCED. The write gate on `tracks`, `track_groups`,
--                    `map_nodes` and `map_node_kinds` — the SHAPE of the
--                    workspace — and on `reorder_tracks`, `delete_track`,
--                    `reorder_map_node_kinds`, `reorder_map_nodes` and
--                    `move_map_node`, which are how that shape is dragged.
--   vocab.edit       ENFORCED. The write gate on `use_cases`, `vocab_options`
--                    and `label_overrides` — the WORDS the workspace uses — and
--                    on `reorder_vocab`, `reset_vocab` and
--                    `reset_label_overrides`.
--   members.manage   ENFORCED. This file's own write gate on `roles` and
--                    `role_permissions`, and the gate in guard_profile_role()
--                    on moving anybody else between roles.
--   capture.write    DECLARED, NOT YET ENFORCED — and this one is honest rather
--                    than aspirational. `entries` is gated on is_member(),
--                    which is what it should be: filing work is what membership
--                    IS. The key is seeded so that the day a read-only role is
--                    wanted, it is a policy change and not a schema change.
--
--   ⚠ WHAT A DIRECTOR STILL CANNOT DO, AND THE SCREEN MUST SAY SO:
--     * DELETE, CREATE OR RE-ROLE A PERSON. `profiles` stays on is_admin() and
--       `roles`/`role_permissions` stay on members.manage. That withholding is
--       the entire reason this file exists — see "NOT RE-POINTED, AND WHY".
--     * PROVISION OR DEPROVISION AN ACCOUNT. `admin-members` is the only path
--       that reaches `auth.users`, and it gates on `profiles.role = 'admin'` in
--       TypeScript, which this file does not own and does not change.
--     * BE OFFERED ANY OF IT BY THE APP, YET. Every configuration screen guards
--       on `useIsAdmin()` (`profile.role === 'admin'`), so a Director signing in
--       today is redirected away from every screen this file just opened to
--       them. THE DATABASE HALF IS COMPLETE AND INVISIBLE WITHOUT A CLIENT
--       CHANGE. That is a TypeScript change in files this migration does not
--       own, and it is recorded in docs/PENDING-MIGRATIONS.md. Nothing here is
--       wrong because of it — but nobody should read this file and conclude the
--       seven can do anything yet.
--
--
-- ═══ THE LEGACY `profiles.role` COLUMN IS KEPT, AND KEPT DERIVED ═══
--
-- `role text not null check (role in ('admin','member'))` stays. Dropping the
-- old column in the same migration that adds its replacement is how a rollback
-- becomes impossible: there would be no state to go back to and no way to answer
-- "who was an admin before this ran".
--
-- It is now DERIVED, by `profiles_role_sync()`, and the derivation is
-- deliberately the SIMPLE one:
--
--     role = 'admin'  ⟺  role_id = the system `admin` role
--
-- and NOT "role_id resolves to something granting workspace.admin". The second
-- reading is more truthful and is the wrong choice, because it makes a derived
-- column depend on a table (`role_permissions`) that changes independently of
-- it — so granting workspace.admin to a custom role would silently make every
-- holder's mirror stale until their profile row happened to be written again,
-- and eagerly resyncing it means an UPDATE on `profiles` fired from inside a
-- trigger on `role_permissions`, straight back through `guard_profile_role()`
-- and `profiles_role_sync()` with the acting user's JWT still attached. The
-- simple rule has no such loop.
--
-- The sync is TWO-WAY on purpose, and that is what keeps the existing writers
-- alive:
--   * `handle_new_user()` (0001) inserts `role = 'member'` and knows nothing
--     about role_id  ->  the INSERT branch gives them the Member role.
--   * `admin-members` edge function `set-role` writes `role = 'admin'|'member'`
--     with the service role  ->  the legacy branch moves their role_id to the
--     matching system role. Without this the promote button would report
--     success and change nothing.
--   * A future admin screen writes `role_id`  ->  the legacy text is derived
--     from it, so the edge function's own gate and `src/lib/permissions.ts`
--     (`canAdmin(role)`) keep answering correctly with no client change.
--
-- ⚠ WHAT THE EDGE FUNCTION STILL CANNOT SEE. `admin-members` gates on
--   `profiles.role = 'admin'` in TypeScript, so a custom role carrying
--   `members.manage` WITHOUT `workspace.admin` can manage roles here and still
--   cannot create or delete a member there. That is a deliberate floor, not an
--   oversight — provisioning is the one power that reaches auth.users — but it
--   is a sentence the Members screen has to say. Re-pointing that gate at
--   `has_perm('members.manage')` is a TypeScript change in a file this
--   migration does not own.
--
-- DROP `profiles.role` IN A LATER MIGRATION, once (a) no policy reads it,
-- (b) `admin-members/index.ts` gates on has_perm, and (c) `src/types.ts`'s
-- `UserRole` and `src/lib/permissions.ts` no longer branch on it. All three are
-- still true today, which is why it is still here.
--
--
-- ═══ APPLY ORDER INSIDE THIS FILE IS LOAD-BEARING ═══
--
-- The whole file is one transaction (no explicit begin/commit — 0009's header
-- explains why), and within it:
--
--   preflight -> tables -> columns -> SEED -> BACKFILL -> has_perm() +
--   is_admin() -> POLICIES -> guards -> probes
--
-- Redefining `is_admin()` before the backfill would leave a window in which
-- every admin policy in the product answers false; installing the "an admin must
-- survive" guard before the seed would make the seed's own first statement — one
-- with no permissions in the table yet — refuse the migration. Both were hit
-- writing this and both are the reason the parts are in this order.
--
-- The re-pointed configuration policies are AFTER `has_perm()` for the obvious
-- reason (a policy cannot reference a function that does not exist yet) and
-- AFTER the SEED for the one that is easy to miss: between the two, `tracks`
-- would be gated on a key no role grants, and nobody — not even Abdulaziz —
-- could write a track. Inside one transaction that window is invisible; if this
-- file is ever split, it is not.
--
--
-- ═══ RE-RUN SAFETY, INCLUDING RE-RUNNING SOMEBODY ELSE'S FILE ═══
--
-- Re-runnable from the top in any partial state, 0018's discipline throughout:
-- `create table if not exists`, `add column if not exists` per column, `drop
-- constraint if exists` before every add, `drop policy if exists` before every
-- create, `drop trigger if exists` before every create, `create or replace` on
-- every function, `on conflict do nothing` on every seed, probes at the bottom
-- that roll themselves back and can actually fail.
--
-- ⚠ RE-RUNNING 0001, 0002 OR 0016 AFTER THIS FILE REVERTS PART OF IT.
--   0001 owns `is_admin()` and `guard_profile_role()`; 0002 owns
--   `log_config_audit()`; 0016 owns `guard_profile_role()`. All three are
--   restated here, in full, and a re-run of those files restores their older
--   bodies. The damage is bounded and self-evident: the restored `is_admin()`
--   reads `profiles.role`, which this file keeps DERIVED and correct for every
--   holder of a system role, so the workspace does not lock itself out — it
--   simply stops honouring custom roles. Fix by re-applying 0025.
--   This is recorded in docs/PENDING-MIGRATIONS.md.
--
-- ⚠ THE AMENDMENT WIDENED THAT HAZARD FROM 3 FUNCTIONS TO 21 POLICIES, and this
--   half is NOT self-evident, which is why it is called out separately. This file
--   now owns the write policies on `tracks` and `vocab_options` (0001/0009),
--   `label_overrides` (0017), `track_groups` (0018), `map_nodes` and
--   `map_node_kinds` (0023) and `use_cases` (0024). Re-running ANY of those six
--   files after this one restores its `is_admin()` policies, and the Director
--   role then grants NOTHING on that table — with no error, no failed statement
--   and no symptom except a Director whose writes affect zero rows. PROBE 5
--   half A reads `pg_policies` and fails on exactly this, for all 21 by name.
--   Fix by re-applying 0025. 0025 GOES LAST, ALWAYS.
--
-- ⚠ AND IT WIDENED AGAIN, TO EIGHT MORE FUNCTIONS. This file now also owns
--   `reorder_tracks` (0002), `reorder_vocab` + `reset_vocab` (0003),
--   `reset_label_overrides` (0017) and `delete_track` +
--   `reorder_map_node_kinds` + `reorder_map_nodes` + `move_map_node` (0023).
--   Re-running any of those four files restores an `is_admin()` guard that now
--   contradicts the policy beside it: RLS would accept the Director's drag and
--   the RPC refuses it with 42501. Unlike the policy half this one is LOUD —
--   a clean, translated refusal rather than a write that affects zero rows —
--   but it is still the role failing to do what its name says. PROBE 5 half A
--   reads `pg_get_functiondef` and fails on exactly this, for all eight by name.
--   Fix by re-applying 0025. 0025 GOES LAST, ALWAYS.
--
-- Deploy: Supabase Dashboard -> SQL Editor -> paste + Run, twice, reading the
-- NOTICE lines. Apply AFTER 0023 and 0024.


-- ── preflight: 0023 and 0024 first ──────────────────────────────────────────
-- NEW WITH THE AMENDMENT, and it is the amendment's cost. Before it, this file
-- created its own tables and redefined its own functions and cared about nothing
-- else. It now re-points the write policies on `map_nodes`, `map_node_kinds`
-- (0023) and `use_cases` (0024), and `create policy … on public.map_nodes`
-- against a database that has not seen 0023 fails with a bare 42P01 from the
-- middle of the file — after the roles have been seeded and the backfill has
-- run, which is the worst place to stop.
--
-- `drop policy if exists` on a missing table only warns; `create policy` does
-- not. So the check is here, at the top, before anything has been written.
-- 0024:99's block, verbatim in shape.
do $preflight$
begin
  if to_regclass('public.map_nodes') is null
     or to_regclass('public.map_node_kinds') is null then
    raise exception
      'NphiesCore 0025 CANNOT APPLY: public.map_nodes / public.map_node_kinds do not exist. Apply 0023_map_nodes.sql first — this file re-points their write policies at has_perm(''structure.edit''), which is what makes the Director role mean anything.';
  end if;

  if to_regclass('public.use_cases') is null then
    raise exception
      'NphiesCore 0025 CANNOT APPLY: public.use_cases does not exist. Apply 0024_map_use_cases.sql first — this file re-points its write policy at has_perm(''vocab.edit'').';
  end if;

  -- The four tables the amendment assumes were already here. Listed separately
  -- because their absence means something entirely different: not "apply the
  -- previous file", but "this is not the NphiesCore database".
  if to_regclass('public.tracks') is null
     or to_regclass('public.track_groups') is null
     or to_regclass('public.vocab_options') is null
     or to_regclass('public.label_overrides') is null then
    raise exception
      'NphiesCore 0025 CANNOT APPLY: one of tracks / track_groups / vocab_options / label_overrides is missing. 0001, 0003, 0017 and 0018 all have to be applied first.';
  end if;
end
$preflight$;


-- ── roles ───────────────────────────────────────────────────────────────────
-- A surrogate uuid, `key` as the stable machine name, and the display name
-- bilingual — the same shape decision as `track_groups` (0018:113) and for the
-- same reason: `name` is a LABEL and gets renamed, while `profiles.role_id` has
-- to keep pointing at the same role across that rename. `key` is what code and
-- migrations refer to and is not editable in any screen.
--
-- `is_system` marks the two roles that MAY NEVER BE DELETED. They are not
-- special in what they grant — Admin's grants are ordinary rows in
-- `role_permissions` and can be edited — they are special in that
-- `profiles_role_sync()` resolves the legacy `role` text against them and
-- `handle_new_user()` implicitly lands every new member on one. Deleting either
-- would leave new sign-ins with no role at all.
create table if not exists public.roles (
  id         uuid primary key default gen_random_uuid(),
  key        text not null,
  name       text not null,
  name_ar    text not null default '',
  sort_order int not null default 0,
  is_system  boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null
);

comment on table public.roles is
  'Named bundles of permissions (0025). `key` is the stable machine name and is never edited; `name`/`name_ar` are the labels. is_system marks admin and member, which profiles_role_sync() resolves the legacy profiles.role text against and which therefore cannot be deleted.';

-- For a project where an earlier cut of this file already landed: `create table
-- if not exists` is a no-op there, so every column is added separately or the
-- constraints below fail against a table that lacks them. Same reasoning as
-- 0017:129 and 0018:139.
alter table public.roles add column if not exists key        text;
alter table public.roles add column if not exists name       text;
alter table public.roles add column if not exists name_ar    text not null default '';
alter table public.roles add column if not exists sort_order int not null default 0;
alter table public.roles add column if not exists is_system  boolean not null default false;
alter table public.roles add column if not exists created_at timestamptz not null default now();
alter table public.roles add column if not exists updated_at timestamptz not null default now();
alter table public.roles add column if not exists created_by uuid references public.profiles (id) on delete set null;

-- A slug, lowercase, because it is compared against string literals in this file
-- and in every future migration that adds a key. Mixed case would make
-- `key = 'admin'` silently miss a role someone created as 'Admin'.
alter table public.roles drop constraint if exists roles_key_ck;
alter table public.roles add constraint roles_key_ck
  check (key ~ '^[a-z][a-z0-9_]{1,31}$');

-- btrim before measuring: '   ' is an empty name wearing a hat (0018:160).
alter table public.roles drop constraint if exists roles_name_len_ck;
alter table public.roles add constraint roles_name_len_ck
  check (char_length(btrim(name)) between 1 and 40);

create unique index if not exists roles_key_uidx  on public.roles (key);
create unique index if not exists roles_name_uidx on public.roles (lower(name));

-- PARTIAL, because name_ar defaults to '' — a plain unique index would let
-- exactly one role go untranslated and reject the second with a duplicate-name
-- error naming the wrong field. Same shape as track_groups_name_ar_uidx.
create unique index if not exists roles_name_ar_uidx
  on public.roles (lower(name_ar)) where name_ar <> '';

create index if not exists roles_sort_idx on public.roles (sort_order);

alter table public.roles enable row level security;


-- ── role_permissions ────────────────────────────────────────────────────────
-- role x permission key x granted, primary key on the pair. `granted = false` is
-- an EXPLICIT DENY that reads identically to an absent row today; it exists so a
-- screen can render a switch in the off position without deleting and
-- re-creating rows, and so an audit trail records the moment something was
-- turned off rather than a row vanishing.
create table if not exists public.role_permissions (
  role_id        uuid not null references public.roles (id) on delete cascade,
  permission_key text not null,
  granted        boolean not null default true,
  created_at     timestamptz not null default now(),
  primary key (role_id, permission_key)
);

comment on table public.role_permissions is
  'Which permission keys a role grants (0025). The KEY CATALOGUE IS CODE-DEFINED and pinned by role_permissions_key_ck: a key nobody checks grants nothing, so adding one is a migration plus the code that reads it. granted=false is an explicit deny and reads the same as an absent row.';

alter table public.role_permissions add column if not exists granted    boolean not null default true;
alter table public.role_permissions add column if not exists created_at timestamptz not null default now();

-- ⚠ THE CATALOGUE. This constraint is the database saying what the header says:
-- the keys are code-defined. Adding one is TWO edits — this list, and the code
-- that enforces the promise — and they belong in the same commit.
alter table public.role_permissions drop constraint if exists role_permissions_key_ck;
alter table public.role_permissions add constraint role_permissions_key_ck
  check (permission_key in (
    'workspace.admin',
    'structure.edit',
    'vocab.edit',
    'members.manage',
    'capture.write'
  ));

-- `on delete cascade` from roles is right and is not a data-loss hazard: the
-- grants of a deleted role are meaningless, and the role itself cannot be
-- deleted while anybody holds it (roles_guard_delete below) or if it is a system
-- role.
create index if not exists role_permissions_key_idx
  on public.role_permissions (permission_key) where granted;

alter table public.role_permissions enable row level security;


-- ── profiles.role_id and profiles.position ──────────────────────────────────
-- NULLABLE role_id, `on delete restrict`. Both halves are load-bearing:
--
--   * nullable, because `handle_new_user()` (0001) inserts a profile with no
--     role_id and this migration does not own that function. The INSERT branch
--     of profiles_role_sync() fills it, and has_perm() falls back to the legacy
--     text column if anything ever slips past — belt AND braces, because the
--     failure mode of a null role_id is a member who can see nothing and cannot
--     be told why.
--   * `restrict`, NOT `set null` and NOT `cascade`. Deleting a role that people
--     hold must be refused, loudly, with the count — not silently strip eleven
--     people of every permission they had. `roles_guard_delete()` below turns
--     the bare 23503 into a message the client can translate.
alter table public.profiles
  add column if not exists role_id uuid references public.roles (id) on delete restrict;

comment on column public.profiles.role_id is
  'Which role this member holds (0025). The source of truth for permissions; profiles.role is derived from it and is scheduled for deletion.';

-- Their job title, as they would introduce themselves. FREE TEXT, DISPLAY ONLY,
-- and it must NEVER gate anything: "Executive Director, UHR" is how a person is
-- described, not what they are allowed to do, and a permission system that reads
-- a text field somebody can type into is not a permission system. Altitude
-- (Part 3 of the plan) may READ it to choose a starting view; that is a default,
-- not a gate, and it is reversible with one control.
alter table public.profiles
  add column if not exists "position" text not null default '';

comment on column public.profiles."position" is
  'Job title, free text, DISPLAY ONLY (0025). Never gates anything — it may set a default starting altitude, which any reader can move. Writable only by a members.manage holder or the service role (guard_profile_role).';

create index if not exists profiles_role_id_idx on public.profiles (role_id);


-- ── seed: the three roles ───────────────────────────────────────────────────
-- BEFORE the guards are installed, deliberately — see the header's apply-order
-- section. `do nothing` rather than `do update`, exactly like 0001's track seed
-- and 0018's group seed: these are editable and a re-run must not stomp a
-- renamed role.
--
-- Admin and Member are `is_system`. DIRECTOR IS NOT — it is Aziz's role to
-- rename, re-scope or delete, and the point of the whole file is that he can.
insert into public.roles (key, name, name_ar, sort_order, is_system) values
  ('admin',    'Admin',    'مشرف',  1, true),
  ('director', 'Director', 'مدير',  2, false),
  ('member',   'Member',   'عضو',   3, true)
on conflict (key) do nothing;

-- ── seed: what each role grants ─────────────────────────────────────────────
-- Admin: EVERY KEY IN THE CATALOGUE, and since the amendment all five of them
--        are load-bearing rather than one. `workspace.admin` is is_admin() and
--        therefore every admin policy left in the schema; structure.edit and
--        vocab.edit are how
--        an admin reaches the seven configuration tables now that those check a
--        key instead of is_admin(). A missing grant here does not merely make a
--        switch look wrong — it CLOSES a table to the workspace owner. Probe 1
--        refuses the migration if Admin holds fewer than five.
-- Director: structure.edit + vocab.edit + capture.write. NOT members.manage,
--        NOT workspace.admin. Those two omissions are the whole argument for
--        this file: seven people get to shape the map and the vocabulary
--        without any of them being able to delete a colleague's account or
--        grant themselves the power to. Probe 1 asserts the three grants are
--        present and probe 5 proves they mean something.
-- Member: capture.write. Reading is is_member(), which is not a key.
insert into public.role_permissions (role_id, permission_key, granted)
select r.id, v.perm, true
  from (values
    ('admin',    'workspace.admin'),
    ('admin',    'structure.edit'),
    ('admin',    'vocab.edit'),
    ('admin',    'members.manage'),
    ('admin',    'capture.write'),
    ('director', 'structure.edit'),
    ('director', 'vocab.edit'),
    ('director', 'capture.write'),
    ('member',   'capture.write')
  ) as v (role_key, perm)
  join public.roles r on r.key = v.role_key
on conflict (role_id, permission_key) do nothing;


-- ── backfill: nobody loses access mid-migration ─────────────────────────────
-- `role_id is null` is the guard and it is the whole safety story: this can only
-- ever FILL an empty role_id, never move somebody from one role to another. An
-- admin who has already been given the Director role keeps it through every
-- re-run. Same idiom, same reasoning, as 0018's group assignment (0018:414).
--
-- This runs BEFORE is_admin() is redefined. In the other order there is a window
-- — brief, inside one transaction, but real if the file is ever split — where
-- every admin in the workspace has no role_id, has_perm() answers false, and
-- every admin policy in the product is closed.
update public.profiles p
   set role_id = r.id
  from public.roles r
 where p.role_id is null
   and r.key = case when p.role = 'admin' then 'admin' else 'member' end;


-- ── has_perm() — the one lookup everything else is expressed in ─────────────
-- SECURITY DEFINER for the reason 0001:29-37 spells out: a policy on
-- public.profiles that selects from public.profiles inline recurses. `set
-- search_path = public` so a caller cannot shadow the tables with temp ones.
--
-- THE coalesce() IS THE BELT-AND-BRACES CLAUSE. If a profile somehow reaches
-- this function with a null role_id — a row inserted by a path that predates
-- profiles_role_sync(), a trigger dropped by hand, this file half-applied — it
-- resolves through the LEGACY text column instead of answering "no permissions
-- at all". COALESCE short-circuits, so the extra lookup costs nothing on the
-- normal path where role_id is set.
--
-- ⚠ PERFORMANCE, stated because it changes the shape of the hottest predicate in
--   the schema: is_admin() was one indexed lookup on `profiles` and is now a
--   join to `role_permissions`. 0009 rewrote the policies it could into the
--   InitPlan form `(select public.is_admin())`, which evaluates once per
--   statement; the ones still written bare (0001's `using (public.is_admin())`)
--   evaluate once per row. Both hit the `role_permissions` primary key, on a
--   table with single-digit rows per role, so the cost is a second index probe —
--   measured against 18 members and single-figure roles, not asserted as free
--   forever. If it ever shows up, the fix is to finish 0009's InitPlan pass, not
--   to cache permissions in a JWT claim, which cannot be revoked before it
--   expires.
create or replace function public.has_perm(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.profiles p
      join public.role_permissions rp
        on rp.role_id = coalesce(
             p.role_id,
             (select r.id from public.roles r
               where r.key = case when p.role = 'admin' then 'admin' else 'member' end)
           )
     where p.id = auth.uid()
       and rp.permission_key = p_key
       and rp.granted
  );
$$;

comment on function public.has_perm(text) is
  'THE permission predicate (0025). The key catalogue is code-defined and pinned by role_permissions_key_ck — a key nobody checks grants nothing. Falls back to the legacy profiles.role text when role_id is null so a half-provisioned profile is never silently permission-less.';

revoke all on function public.has_perm(text) from public;
revoke all on function public.has_perm(text) from anon;
grant execute on function public.has_perm(text) to authenticated;

-- ⚠ THE LINE THE WHOLE FILE RESTS ON. Redefining this one function makes
--   permissions data at all 183 call sites without editing any of them. Its
--   SIGNATURE, VOLATILITY, SECURITY and SEARCH PATH are identical to 0001's — a
--   `stable` function turned `volatile` here would silently disable the InitPlan
--   optimisation 0009 exists for, on every policy in the schema at once.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_perm('workspace.admin');
$$;

comment on function public.is_admin() is
  'Admin check for RLS. 0025: a thin alias over has_perm(''workspace.admin''), so all 183 policy call sites keep working byte for byte while permissions become data. SECURITY DEFINER to avoid recursive policy evaluation on profiles.';

-- is_member() IS DELIBERATELY NOT REDEFINED. It means "has a profile", which is
-- what workspace membership is, and it is the read gate on most of those 183
-- sites. Restated here as a comment rather than as code so that nobody reading
-- this file concludes it was forgotten.


-- ── RLS: member READ, members.manage WRITE ──────────────────────────────────
-- A member MUST be able to read both tables. "What am I allowed to do" is a
-- question the app answers on every screen — a disabled control that explains
-- itself (src/lib/permissions.ts's entire reason for existing) needs the answer
-- client-side, and a member who cannot read the catalogue gets controls that
-- look enabled and fail at the server.
--
-- InitPlan form `(select ...)` throughout, per 0009.
drop policy if exists roles_select on public.roles;
create policy roles_select on public.roles
  for select using ((select public.is_member()));

drop policy if exists roles_insert on public.roles;
create policy roles_insert on public.roles
  for insert with check ((select public.has_perm('members.manage')));

drop policy if exists roles_update on public.roles;
create policy roles_update on public.roles
  for update using ((select public.has_perm('members.manage')))
  with check ((select public.has_perm('members.manage')));

drop policy if exists roles_delete on public.roles;
create policy roles_delete on public.roles
  for delete using ((select public.has_perm('members.manage')));

drop policy if exists role_permissions_select on public.role_permissions;
create policy role_permissions_select on public.role_permissions
  for select using ((select public.is_member()));

drop policy if exists role_permissions_insert on public.role_permissions;
create policy role_permissions_insert on public.role_permissions
  for insert with check ((select public.has_perm('members.manage')));

drop policy if exists role_permissions_update on public.role_permissions;
create policy role_permissions_update on public.role_permissions
  for update using ((select public.has_perm('members.manage')))
  with check ((select public.has_perm('members.manage')));

drop policy if exists role_permissions_delete on public.role_permissions;
create policy role_permissions_delete on public.role_permissions
  for delete using ((select public.has_perm('members.manage')));

-- Explicit, rather than relying on Supabase's default privileges for new tables
-- in `public` (0018:207). `anon` is left exactly as the project's defaults have
-- it, matching every other table: the anon key cannot pass is_member() anyway.
grant select, insert, update, delete on public.roles            to authenticated;
grant select, insert, update, delete on public.role_permissions to authenticated;


-- ═══ RLS: THE CONFIGURATION TABLES ANSWER TO A KEY, NOT TO is_admin() ═══════
--
-- ⚠ THIS IS THE AMENDMENT, and it is the difference between a permission system
--   and a permissions SCREEN. Everything above makes permissions DATA; this
--   block makes two of them WORTH SOMETHING. Without it `structure.edit` and
--   `vocab.edit` are strings in a CHECK constraint that no policy reads, the
--   Director role grants nothing at all, and the roles screen renders switches
--   attached to nothing — which is the failure this file's own header spends a
--   section warning about, committed in the same file that warns about it.
--
-- ONLY THE WRITE POLICIES MOVE, AND ONLY ON THE SEVEN TABLES WHERE THE THING
-- BEING WRITTEN IS CONFIGURATION — the SHAPE of the workspace and the WORDS it
-- uses. Every `select` policy in the schema is untouched: reading is
-- `is_member()`, which is what workspace membership IS and is not a key. Every
-- `is_admin()` call site NOT listed below is untouched too, and keeps working
-- byte for byte, because `is_admin()` keeps its meaning.
--
--   structure.edit  tracks · track_groups · map_nodes · map_node_kinds
--   vocab.edit      use_cases · vocab_options · label_overrides
--
-- ═══ THE PREDICATE IS THE KEY ALONE, NOT `key or is_admin()` ═══
--
-- Written the other way first. `has_perm('structure.edit') or is_admin()` reads
-- like belt and braces and is in fact the same defect one level up: it makes
-- `structure.edit` a switch wired to nothing FOR THE ADMIN ROLE — the role most
-- likely to be edited first — because turning it off would change nothing. The
-- key alone is what makes the switch true everywhere.
--
-- It is safe because the SEED gives Admin all five keys and PROBE 1 refuses the
-- migration if it does not: an admin passes every policy here by HOLDING the
-- key, not by being an admin. And revoking `structure.edit` from Admin is
-- RECOVERABLE FROM INSIDE THE APP, which is the test that matters — Admin still
-- holds `members.manage`, `members.manage` is what gates `role_permissions`, so
-- the grant can be put back on the same screen it was removed from. Compare the
-- one that is NOT recoverable and therefore IS guarded: revoking
-- `workspace.admin` from the last role that grants it, which GUARD 1 refuses.
--
-- 0009's InitPlan form `(select …)` throughout, unchanged from the policies
-- being replaced: these are the same policies with a different predicate, and a
-- bare call would evaluate once per surviving row on tables the map reads on
-- every screen. `drop policy if exists` before each `create`, so this is
-- re-runnable and so it does not matter whether 0001/0009/0018/0023/0024 or this
-- file ran last — whichever did, the policy exists exactly once.

-- ── tracks (structure.edit) ─────────────────────────────────────────────────
-- 0009:210's policy set. `tracks_select` is NOT restated: it is is_member() and
-- nothing here changes it.
drop policy if exists tracks_insert on public.tracks;
create policy tracks_insert on public.tracks
  for insert with check ((select public.has_perm('structure.edit')));

drop policy if exists tracks_update on public.tracks;
create policy tracks_update on public.tracks
  for update using ((select public.has_perm('structure.edit')))
  with check ((select public.has_perm('structure.edit')));

drop policy if exists tracks_delete on public.tracks;
create policy tracks_delete on public.tracks
  for delete using ((select public.has_perm('structure.edit')));

-- ── track_groups (structure.edit) ───────────────────────────────────────────
-- 0018:192's set.
drop policy if exists track_groups_insert on public.track_groups;
create policy track_groups_insert on public.track_groups
  for insert with check ((select public.has_perm('structure.edit')));

drop policy if exists track_groups_update on public.track_groups;
create policy track_groups_update on public.track_groups
  for update using ((select public.has_perm('structure.edit')))
  with check ((select public.has_perm('structure.edit')));

drop policy if exists track_groups_delete on public.track_groups;
create policy track_groups_delete on public.track_groups
  for delete using ((select public.has_perm('structure.edit')));

-- ── map_nodes (structure.edit) ──────────────────────────────────────────────
-- 0023:493's set, and the one that matters most in practice: the tree IS the
-- product now, and "may edit the structure" is a sentence about this table
-- before it is a sentence about any other.
--
-- `reorder_map_nodes()` and `move_map_node()` are re-pointed at the same key
-- further down, in "THE ADMIN RPCs ANSWER TO A KEY TOO" — otherwise a Director
-- could create, rename and delete a node and could not DRAG one.
drop policy if exists map_nodes_insert on public.map_nodes;
create policy map_nodes_insert on public.map_nodes
  for insert with check ((select public.has_perm('structure.edit')));

drop policy if exists map_nodes_update on public.map_nodes;
create policy map_nodes_update on public.map_nodes
  for update using ((select public.has_perm('structure.edit')))
  with check ((select public.has_perm('structure.edit')));

drop policy if exists map_nodes_delete on public.map_nodes;
create policy map_nodes_delete on public.map_nodes
  for delete using ((select public.has_perm('structure.edit')));

-- ── map_node_kinds (structure.edit) ─────────────────────────────────────────
-- 0023:187's set. The KINDS are structure in the same sense the nodes are —
-- "Programme / Phase / Organization" is the vocabulary OF the shape, and a
-- Director who can add an Org but not invent the level it sits at has half a
-- power. `reorder_map_node_kinds()` is re-pointed at the same key below.
drop policy if exists map_node_kinds_insert on public.map_node_kinds;
create policy map_node_kinds_insert on public.map_node_kinds
  for insert with check ((select public.has_perm('structure.edit')));

drop policy if exists map_node_kinds_update on public.map_node_kinds;
create policy map_node_kinds_update on public.map_node_kinds
  for update using ((select public.has_perm('structure.edit')))
  with check ((select public.has_perm('structure.edit')));

drop policy if exists map_node_kinds_delete on public.map_node_kinds;
create policy map_node_kinds_delete on public.map_node_kinds
  for delete using ((select public.has_perm('structure.edit')));

-- ── use_cases (vocab.edit) ──────────────────────────────────────────────────
-- 0024:200's set. The capability catalogue — "Medication Prescribe V2" — is
-- vocabulary, not shape: it names WHAT an Org integrated, and it is renamed and
-- extended by whoever knows the programme, which is exactly the seven.
--
-- `map_node_use_cases` — WHICH Org has WHICH capability — is deliberately NOT
-- here. It is is_member() write (0024:463) and stays that way: filing what a
-- node actually does is DATA, the thing every member is for, and re-pointing it
-- would take a power away from members rather than give one to Directors.
drop policy if exists use_cases_insert on public.use_cases;
create policy use_cases_insert on public.use_cases
  for insert with check ((select public.has_perm('vocab.edit')));

drop policy if exists use_cases_update on public.use_cases;
create policy use_cases_update on public.use_cases
  for update using ((select public.has_perm('vocab.edit')))
  with check ((select public.has_perm('vocab.edit')));

drop policy if exists use_cases_delete on public.use_cases;
create policy use_cases_delete on public.use_cases
  for delete using ((select public.has_perm('vocab.edit')));

-- ── vocab_options (vocab.edit) ──────────────────────────────────────────────
-- 0009:230's set. Statuses, priorities, entry kinds — the closed lists every
-- screen renders. `reorder_vocab()` and `reset_vocab()` (0003:327, 0003:362)
-- are re-pointed at the same key below.
drop policy if exists vocab_options_insert on public.vocab_options;
create policy vocab_options_insert on public.vocab_options
  for insert with check ((select public.has_perm('vocab.edit')));

drop policy if exists vocab_options_update on public.vocab_options;
create policy vocab_options_update on public.vocab_options
  for update using ((select public.has_perm('vocab.edit')))
  with check ((select public.has_perm('vocab.edit')));

drop policy if exists vocab_options_delete on public.vocab_options;
create policy vocab_options_delete on public.vocab_options
  for delete using ((select public.has_perm('vocab.edit')));

-- ── label_overrides (vocab.edit) ────────────────────────────────────────────
-- 0017:190's set. Settings › Terminology — the owner's own wording for a shipped
-- string. If any table in the schema IS `vocab.edit`, it is this one.
-- `reset_label_overrides()` (0017:454) is re-pointed at the same key below.
drop policy if exists label_overrides_insert on public.label_overrides;
create policy label_overrides_insert on public.label_overrides
  for insert with check ((select public.has_perm('vocab.edit')));

drop policy if exists label_overrides_update on public.label_overrides;
create policy label_overrides_update on public.label_overrides
  for update using ((select public.has_perm('vocab.edit')))
  with check ((select public.has_perm('vocab.edit')));

drop policy if exists label_overrides_delete on public.label_overrides;
create policy label_overrides_delete on public.label_overrides
  for delete using ((select public.has_perm('vocab.edit')));


-- ═══ NOT RE-POINTED, AND WHY — THE ESCALATION BOUNDARY ══════════════════════
--
-- These three tables are NOT restated above and their policies are NOT touched.
-- That is a decision, not an omission, and PROBE 5 asserts it against
-- `pg_policies` so that moving one is a migration that FAILS rather than a
-- migration that quietly makes Director mean Admin.
--
--   · `profiles` — profiles_insert / profiles_update / profiles_delete
--     (0009:160-172) stay on `is_admin()`.
--     WHY: creating, deleting and re-roling PEOPLE is the power Aziz
--     deliberately withheld from Directors. It is the whole content of the
--     split — seven people who shape the map and the vocabulary, two who decide
--     who is in the workspace. A Director who could delete a profile would be an
--     admin with a different label. (`profiles_update` also lets a member write
--     their OWN row, which is how anyone changes their locale;
--     guard_profile_role() is what stops that being an escalation.)
--
--   · `roles` and `role_permissions` — roles_insert/update/delete and
--     role_permissions_insert/update/delete stay on `has_perm('members.manage')`,
--     which only Admin holds.
--     WHY: A ROLE THAT CAN EDIT PERMISSIONS CAN GRANT ITSELF ANYTHING. If
--     `role_permissions` were gated on `structure.edit`, a Director would open
--     the roles screen, tick `workspace.admin` on their own role, and be an
--     admin — one click, no guard in the way, and "Director" would be
--     decorative. This is the single most important line in the file and it is
--     enforced by NOT changing something.
--
--   · ANYTHING THAT MINTS CREDENTIALS. `admin-members` (the only path that
--     reaches `auth.users`, creates accounts and issues invitations) gates on
--     `profiles.role = 'admin'` in TypeScript and is untouched by this file in
--     either its original or its amended form. A Director cannot provision or
--     deprovision an account, and could not even if `members.manage` were
--     granted to the role — see the header's note on the edge function.
--
-- The rule that generalises all three: a key may grant power over WHAT THE
-- WORKSPACE CONTAINS. Power over WHO IS IN IT, and over WHAT THE KEYS THEMSELVES
-- MEAN, stays with workspace.admin.


-- ═══ THE ADMIN RPCs ANSWER TO A KEY TOO ═════════════════════════════════════
--
-- ⚠ THIS IS THE SECOND HALF OF THE AMENDMENT, and without it the first half
--   ships a role that can CREATE, RENAME and DELETE a map node and cannot DRAG
--   one. Eight functions open with `if not public.is_admin() then raise 42501`.
--   Their own headers are right that the check "is not the authorization; RLS
--   is" — it exists so a member gets a clean, translatable error instead of a
--   silent zero-row UPDATE reported to them as success. But once RLS says
--   structure.edit and the function still says is_admin(), the function is no
--   longer echoing the policy; it is CONTRADICTING it, and a Director meets a
--   42501 on a gesture the database would have accepted.
--
-- ⚠ AND THEY ARE RESTATED HERE, IN FULL, FROM FOUR FILES THIS ONE DOES NOT OWN.
--   Every body below is the owning file's own text, copied byte for byte, with
--   ONE line changed — the guard — and its message reworded to name the key
--   rather than a role. src/lib/pgError.ts maps this by SQLSTATE ('42501' ->
--   admin.errForbidden) and not by message text, so the rewording reaches no
--   screen; it reaches the person reading a Postgres log.
--
--   The same cross-file precedent as log_config_audit() below, and the same
--   cost: RE-RUNNING 0002, 0003, 0017 OR 0023 AFTER THIS FILE RESTORES ITS
--   is_admin() GUARD, and the Director then meets a 42501 on a drag the policies
--   still allow. Fix by re-applying 0025. 0025 GOES LAST, ALWAYS.
--
--   WHY NOT AMEND 0023 IN PLACE, given that it is unapplied and free to edit?
--   Because `has_perm()` does not exist until this file runs, and 0023 runs
--   first — by this file's own preflight. A 0023 that called has_perm() would
--   be a file that cannot work on the database it is applied to, for however
--   long the sitting between 0023 and 0025 lasts. One file owns the
--   re-pointing, and it is the one that goes last.
--
-- WHY NOT `key or is_admin()`: the same reason the policies are the key alone —
-- see the block above. Admin holds all five keys and PROBE 1 refuses the
-- migration if it does not.
--
-- WHAT IS NOT HERE, and stays is_admin(): nothing in this file. Every RPC in
-- the schema that gates on is_admin() and is NOT listed below is one whose
-- subject is PEOPLE or CREDENTIALS, and those stay with workspace.admin by the
-- rule stated above.

-- ── reorder_tracks (structure.edit) ─────────────────────────────────────
-- 0002:439. `tracks` writes are structure.edit above, so the RPC that renumbers
-- them has to be too, or a Director can rename a track and not drag it.
create or replace function public.reorder_tracks(p_ids uuid[])
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count int;
begin
  if not public.has_perm('structure.edit') then
    raise exception 'structure.edit is required to reorder tracks' using errcode = '42501';
  end if;

  -- One statement, ordinality as the new sort_order. The `is distinct from`
  -- filter skips tracks that are already in place so a drag that moves one row
  -- does not stamp updated_at on all five and write five audit rows.
  update public.tracks t
     set sort_order = o.ord::int
    from unnest(p_ids) with ordinality as o(id, ord)
   where t.id = o.id
     and t.sort_order is distinct from o.ord::int;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.reorder_tracks(uuid[]) from public;
revoke all on function public.reorder_tracks(uuid[]) from anon;
grant execute on function public.reorder_tracks(uuid[]) to authenticated;

-- ── delete_track (structure.edit) ─────────────────────────────────────
-- 0023:1204 — 0023 restated 0002's body to teach it about map_nodes, so THIS is
-- the definition in force. Deleting a track is `tracks_delete`, which is
-- structure.edit above; the RPC exists for the reassignment step, not for a
-- different authorization.
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
  if not public.has_perm('structure.edit') then
    raise exception 'structure.edit is required to delete a track' using errcode = '42501';
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

-- ── reorder_vocab (vocab.edit) ─────────────────────────────────────
-- 0003:327. `vocab_options` writes are vocab.edit above.
create or replace function public.reorder_vocab(p_kind text, p_keys text[])
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count int;
begin
  if not public.has_perm('vocab.edit') then
    raise exception 'vocab.edit is required to reorder vocabulary' using errcode = '42501';
  end if;

  update public.vocab_options v
     set sort_order = o.ord::int
    from unnest(p_keys) with ordinality as o(key, ord)
   where v.kind = p_kind
     and v.key = o.key
     and v.sort_order is distinct from o.ord::int;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.reorder_vocab(text, text[]) from public;
revoke all on function public.reorder_vocab(text, text[]) from anon;
grant execute on function public.reorder_vocab(text, text[]) to authenticated;

-- ── reset_vocab (vocab.edit) ─────────────────────────────────────
-- 0003:362. Same table, same key. Reset is a write, not a privilege.
create or replace function public.reset_vocab(p_kind text, p_key text default null)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count int;
begin
  if not public.has_perm('vocab.edit') then
    raise exception 'vocab.edit is required to reset vocabulary' using errcode = '42501';
  end if;

  update public.vocab_options v
     set label            = '',
         label_ar         = '',
         color            = null,
         hidden           = false,
         sort_order       = s.sort_order,
         stale_after_days = s.stale_after_days,
         sla_days         = s.sla_days
    from public.vocab_seed() s
   where s.kind = v.kind
     and s.key  = v.key
     and v.kind = p_kind
     and (p_key is null or v.key = p_key)
     and (v.label, v.label_ar, v.color, v.hidden, v.sort_order, v.stale_after_days, v.sla_days)
         is distinct from
         ('', '', null::text, false, s.sort_order, s.stale_after_days, s.sla_days);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.reset_vocab(text, text) from public;
revoke all on function public.reset_vocab(text, text) from anon;
grant execute on function public.reset_vocab(text, text) to authenticated;

-- ── reset_label_overrides (vocab.edit) ─────────────────────────────────────
-- 0017:454. Settings › Terminology's "reset all", on the one table that IS
-- vocab.edit if any table is.
create or replace function public.reset_label_overrides(p_key text default null)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count int;
begin
  if not public.has_perm('vocab.edit') then
    raise exception 'vocab.edit is required to reset label overrides' using errcode = '42501';
  end if;

  delete from public.label_overrides o
   where p_key is null or o.key = p_key;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.reset_label_overrides(text) from public;
revoke all on function public.reset_label_overrides(text) from anon;
grant execute on function public.reset_label_overrides(text) to authenticated;

-- ── reorder_map_node_kinds (structure.edit) ─────────────────────────────────────
-- 0023:275.
create or replace function public.reorder_map_node_kinds(p_ids uuid[])
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count int;
begin
  if not public.has_perm('structure.edit') then
    raise exception 'structure.edit is required to reorder map node kinds' using errcode = '42501';
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

-- ── reorder_map_nodes (structure.edit) ─────────────────────────────────────
-- 0023:914. THE ONE THAT WAS MOST VISIBLE: without this a Director could create,
-- rename and delete a node and could not DRAG one.
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
  if not public.has_perm('structure.edit') then
    raise exception 'structure.edit is required to reorder map nodes' using errcode = '42501';
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

revoke all on function public.reorder_map_nodes(uuid, uuid, uuid[]) from public;
revoke all on function public.reorder_map_nodes(uuid, uuid, uuid[]) from anon;
grant execute on function public.reorder_map_nodes(uuid, uuid, uuid[]) to authenticated;

-- ── move_map_node (structure.edit) ─────────────────────────────────────
-- 0023:1014. Re-parenting, the other half of the same gesture.
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
  if not public.has_perm('structure.edit') then
    raise exception 'structure.edit is required to move a map node' using errcode = '42501';
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


-- ── the legacy column becomes derived ───────────────────────────────────────
-- Named `profiles_role_sync` so it fires AFTER `profiles_guard_role`: Postgres
-- fires BEFORE triggers in NAME ORDER, 'g' < 'r', and the order matters. The
-- guard may REVERT a role_id change it does not permit; this function then
-- derives the legacy text from whatever survived. In the other order the mirror
-- would be computed from a value that is about to be thrown away.
create or replace function public.profiles_role_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin  uuid;
  v_member uuid;
begin
  select id into v_admin  from public.roles where key = 'admin';
  select id into v_member from public.roles where key = 'member';

  -- Roles not seeded (this file half-applied, or 0001 re-run against a database
  -- where someone dropped them): leave the row exactly as it arrived rather than
  -- writing a null role_id over a working legacy value.
  if v_admin is null or v_member is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- handle_new_user() knows nothing about role_id. This is the line that stops
    -- every member provisioned after this migration from having no permissions.
    if new.role_id is null then
      new.role_id := case when new.role = 'admin' then v_admin else v_member end;
    end if;

  elsif new.role_id is distinct from old.role_id then
    -- role_id is the source of truth. Nothing to do; the derivation below
    -- rewrites the legacy text from it.
    null;

  elsif new.role is distinct from old.role then
    -- The LEGACY writer path: `admin-members` set-role, which PATCHes the text
    -- column with the service role and has never heard of role_id. Without this
    -- branch the promote button in Settings › Members reports success and moves
    -- nobody.
    --
    -- Demoting somebody who holds a CUSTOM role through this path lands them on
    -- Member, losing Director. In practice the edge function short-circuits when
    -- the text is already 'member' (index.ts: `if (profile.role === role)`), so
    -- a Director is only ever moved this way by an explicit promote-then-demote.
    new.role_id := case when new.role = 'admin' then v_admin else v_member end;
  end if;

  -- The derivation, and it is deliberately the simple one: the legacy text names
  -- the SYSTEM ROLE ASSIGNED, not the live permission answer. See the header —
  -- the truthful version makes a derived column depend on a table that changes
  -- independently of it, and resyncing it eagerly means writing to `profiles`
  -- from inside a trigger on `role_permissions`, back through this very
  -- function.
  if new.role_id is not null then
    new.role := case when new.role_id = v_admin then 'admin' else 'member' end;
  end if;

  return new;
end;
$$;

comment on function public.profiles_role_sync() is
  'BEFORE INSERT OR UPDATE on profiles (0025). Two-way bridge between the new role_id and the legacy role text so handle_new_user() and the admin-members edge function keep working unchanged. Fires after profiles_guard_role by name order, which is load-bearing.';

drop trigger if exists profiles_role_sync on public.profiles;
create trigger profiles_role_sync
  before insert or update on public.profiles
  for each row execute function public.profiles_role_sync();


-- ═══ GUARD 1 ═══ an admin must survive
--
-- The existing guards live in TypeScript, in `admin-members/index.ts`:
-- `last_admin` refuses to demote or delete the final admin, `bootstrap_admin`
-- refuses to touch the workspace owner. They cover DELETION and DEMOTION of a
-- PERSON, and they are enforced in an edge function — which means they say
-- nothing about the two new ways to reach the same dead end:
--
--   * REVOKING `workspace.admin` from the role every admin holds. One DELETE on
--     `role_permissions` and the workspace has no admins at all, from a screen
--     whose whole purpose is editing that table.
--   * REASSIGNING the last admin to a role that does not carry it — a PATCH on
--     `profiles.role_id`, which the edge function does not mediate.
--
-- A workspace that revokes its way to zero admins has no way back in through the
-- app: no admin can restore the grant, and `admin-members` refuses everyone
-- because its own gate reads a column that now says 'member'. Recovery is SQL,
-- by someone with dashboard access. So this is a database guard, on all three
-- tables, and it raises.
--
-- STATEMENT-level, not row-level: the question is about the state of the whole
-- workspace after the statement, and a row trigger would ask it once per row and
-- get the wrong answer for a multi-row reassignment that ends correctly.
--
-- ═══ THE RULE IS "DO NOT REDUCE IT TO ZERO", NOT "IT MUST NOT BE ZERO" ═══
--
-- The absolute version was written first and PROBE 3 refuted it before this file
-- was ever applied: on a project with no members yet, the probe's own fixtures
-- are two ordinary members, the count goes 0 -> 0, and an absolute guard raises
-- and fails the migration. Worse, so would the FIRST REAL MEMBER anybody
-- provisions on a fresh workspace, from an edge function, with no admin standing
-- yet to satisfy it. A guard that refuses the bootstrap is not a safety net; it
-- is a locked door with the key inside.
--
-- So the count is taken in a BEFORE STATEMENT trigger, stashed in a
-- transaction-local GUC, and compared in the AFTER STATEMENT trigger. Zero stays
-- zero without complaint; what is refused is the transition FROM at least one
-- admin TO none. A write that FIXES a zero-admin workspace passes by definition.
--
-- If the BEFORE trigger is missing — dropped by hand, this file half-applied —
-- the AFTER trigger does NOT read that as "before was zero, carry on". An
-- absent GUC falls back to the conservative reading (any profiles at all means
-- somebody had access), because failing open is the one behaviour a guard is
-- not allowed to have.
create or replace function public.admin_holder_count()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
    from public.profiles p
   where exists (
     select 1
       from public.role_permissions rp
      where rp.role_id = coalesce(
              p.role_id,
              (select r.id from public.roles r
                where r.key = case when p.role = 'admin' then 'admin' else 'member' end)
            )
        and rp.permission_key = 'workspace.admin'
        and rp.granted
   );
$$;

comment on function public.admin_holder_count() is
  'How many members currently resolve to a role granting workspace.admin (0025). The same coalesce fallback as has_perm(), so it counts exactly who is_admin() would answer true for.';

revoke all on function public.admin_holder_count() from public;
revoke all on function public.admin_holder_count() from anon;
grant execute on function public.admin_holder_count() to authenticated;

create or replace function public.remember_admin_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- is_local = true: scoped to this transaction, gone on commit or rollback, and
  -- invisible to every other session.
  perform set_config('nphiescore.admins_before', public.admin_holder_count()::text, true);
  return null;
end;
$$;

comment on function public.remember_admin_count() is
  'BEFORE STATEMENT on profiles, roles and role_permissions (0025). Stashes the admin count so assert_admin_survives() can refuse the TRANSITION to zero rather than the state of zero — which is what lets a workspace with no members yet provision its first one.';


create or replace function public.assert_admin_survives()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_raw    text;
  v_before int;
begin
  v_raw := current_setting('nphiescore.admins_before', true);

  if v_raw is null or v_raw = '' then
    -- The BEFORE STATEMENT trigger did not run. Do not read that as "there were
    -- no admins"; read it as "somebody had access if anybody exists at all".
    v_before := case when exists (select 1 from public.profiles) then 1 else 0 end;
  else
    v_before := v_raw::int;
  end if;

  if v_before > 0 and public.admin_holder_count() = 0 then
    raise exception
      'last_admin: this would leave the workspace with nobody holding workspace.admin. At least one role must grant it and at least one member must hold that role — otherwise no one can restore it from inside the app.'
      using errcode = '42501';
  end if;

  return null;  -- AFTER STATEMENT triggers ignore the return value
end;
$$;

comment on function public.assert_admin_survives() is
  'AFTER STATEMENT on profiles, roles and role_permissions (0025). Extends the edge function''s last_admin guard to role CHANGES and permission REVOCATION, which it cannot see. Refuses the TRANSITION from at least one admin to none, so a workspace with no members yet can still provision its first.';

-- Both triggers on all three tables. The BEFORE name sorts before the AFTER name
-- on every table, which costs nothing (they are different timings and cannot
-- race) and makes the pair read in order in \d output.
drop trigger if exists profiles_admin_count_before on public.profiles;
create trigger profiles_admin_count_before
  before insert or update or delete on public.profiles
  for each statement execute function public.remember_admin_count();

drop trigger if exists profiles_admin_survives on public.profiles;
create trigger profiles_admin_survives
  after insert or update or delete on public.profiles
  for each statement execute function public.assert_admin_survives();

drop trigger if exists roles_admin_count_before on public.roles;
create trigger roles_admin_count_before
  before insert or update or delete on public.roles
  for each statement execute function public.remember_admin_count();

drop trigger if exists roles_admin_survives on public.roles;
create trigger roles_admin_survives
  after insert or update or delete on public.roles
  for each statement execute function public.assert_admin_survives();

drop trigger if exists role_permissions_admin_count_before on public.role_permissions;
create trigger role_permissions_admin_count_before
  before insert or update or delete on public.role_permissions
  for each statement execute function public.remember_admin_count();

drop trigger if exists role_permissions_admin_survives on public.role_permissions;
create trigger role_permissions_admin_survives
  after insert or update or delete on public.role_permissions
  for each statement execute function public.assert_admin_survives();

-- ── the two roles that cannot be deleted, and the one that is in use ────────
-- `is_system` is not editable either: flipping it off and then deleting is the
-- same delete wearing a hat.
create or replace function public.roles_guard_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_holders int;
begin
  if tg_op = 'DELETE' then
    if old.is_system then
      raise exception
        'role_is_system: the % role is built in and cannot be deleted — profiles_role_sync() resolves the legacy profiles.role column against it and every new sign-in lands on one. Edit what it grants instead.',
        old.key
        using errcode = '42501';
    end if;

    -- profiles.role_id is `on delete restrict`, so the database would refuse
    -- this anyway — with a bare 23503 naming a constraint, which no screen can
    -- turn into a sentence. Refuse first, and say how many people are affected,
    -- exactly as delete_track() does (0002).
    select count(*) into v_holders from public.profiles where role_id = old.id;
    if v_holders > 0 then
      raise exception
        'role_in_use: % member(s) hold the % role. Move them to another role first — deleting it would strip every permission they have.',
        v_holders, old.key
        using errcode = '23503';
    end if;

    return old;
  end if;

  -- UPDATE. `key` is the machine name this file and every future migration
  -- compare against; renaming it would orphan those comparisons silently.
  if new.key is distinct from old.key then
    raise exception
      'role_key_immutable: a role''s key is its machine name and is referenced by migrations and code. Rename the label (name / name_ar) instead.'
      using errcode = '42501';
  end if;

  if old.is_system and not new.is_system then
    raise exception
      'role_is_system: is_system cannot be cleared on the % role.', old.key
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists roles_guard_write_trg on public.roles;
create trigger roles_guard_write_trg
  before update or delete on public.roles
  for each row execute function public.roles_guard_write();


-- ═══ GUARD 2 ═══ no self-escalation
--
-- `guard_profile_role()` already exists and is 0016's, whose body is 0001's plus
-- two pins. RESTATED IN FULL below, because `create or replace` rewrites
-- everything and anything not repeated here would be silently dropped — which is
-- how the display_name pin (R3-SEC-1, a member renaming themselves to the
-- department head on every attribution surface including push) would come back.
--
-- WHAT IS NEW: `role_id` and `position`.
--
-- The escalation rule is stated as a GAIN, not as an equality: a self-edit is
-- refused if the new role grants any key the old one did not. That is stricter
-- than "only an admin may change role_id" in the case that matters — a role
-- carrying `members.manage` but NOT `workspace.admin` is exactly what this file
-- exists to make possible, and its holder must not be able to walk themselves up
-- to workspace.admin by editing their own row. It is also permissive in the case
-- that should be permissive: moving yourself DOWN, or sideways to an equal role,
-- gains nothing and is allowed.
--
-- It REVERTS rather than raising, matching the `role` pin directly above it in
-- the same function. RLS is row-level, not column-level: `profiles_update` lets
-- a member write their own row for `locale`, so a raise here would turn a
-- legitimate settings change that happens to include a stale role_id into a
-- hard error. The value simply does not move, and PROBE 3 asserts it.
create or replace function public.role_grants_more(p_new uuid, p_old uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select rp.permission_key
      from public.role_permissions rp
     where rp.role_id = p_new and rp.granted
    except
    select rp.permission_key
      from public.role_permissions rp
     where rp.role_id = p_old and rp.granted
  );
$$;

comment on function public.role_grants_more(uuid, uuid) is
  'True when the first role grants a permission key the second does not (0025). Escalation is defined as a GAIN, so moving down or sideways is allowed and walking members.manage up to workspace.admin is not.';

revoke all on function public.role_grants_more(uuid, uuid) from public;
revoke all on function public.role_grants_more(uuid, uuid) from anon;
grant execute on function public.role_grants_more(uuid, uuid) to authenticated;

create or replace function public.guard_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only pin the columns when a real END USER is acting. auth.uid() is NULL for
  -- the service role (the admin-members edge function) and in the SQL Editor,
  -- and those are precisely the privileged paths that are SUPPOSED to set a role
  -- and a name. Without the auth.uid() test both of them had their write
  -- silently reverted to the old value, the statement still reported success,
  -- and no admin could ever be provisioned — which made every is_admin() policy
  -- in 0001 permanently unsatisfiable.
  --
  -- This is safe because RLS runs before the trigger: profiles_update requires
  -- `id = auth.uid() or public.is_admin()`, and both are false without a JWT, so
  -- an anon or profile-less caller is rejected at the policy layer and never
  -- reaches this function. The only writers that arrive here with auth.uid()
  -- null are ones that already bypass RLS by design.
  if auth.uid() is not null then

    -- 0001, unchanged. The legacy text column; profiles_role_sync() derives it
    -- from role_id immediately after this trigger, so the two cannot disagree.
    if new.role is distinct from old.role and not public.is_admin() then
      new.role := old.role;
    end if;

    -- 0025, GUARD 2. Two separate refusals, in this order because the first is
    -- the attack and the second is the ordinary permission check:
    if new.role_id is distinct from old.role_id then

      --   (a) NOBODY escalates THEMSELVES, whatever they hold. A role carrying
      --       members.manage without workspace.admin is the whole point of this
      --       file, and its holder editing their own row up to Admin would make
      --       the distinction decorative.
      if new.id = auth.uid()
         and public.role_grants_more(new.role_id, old.role_id) then
        new.role_id := old.role_id;

      --   (b) …and moving anyone ELSE between roles is members.manage's job.
      elsif not public.has_perm('members.manage') then
        new.role_id := old.role_id;
      end if;
    end if;

    -- 0016. The name every attribution surface in the product resolves LIVE
    -- (0011:309 for push, src/store/members.ts:136 and NotificationBell.tsx:145
    -- in the app). One PATCH and a member appears, everywhere and on everyone's
    -- phone, to be somebody else. NOT exempted for admins: no screen in the
    -- product renames anybody, so the only callers this could inconvenience are
    -- the two JWT-less ones above, which the outer `if` already lets through.
    new.display_name := old.display_name;

    -- 0025. `position` is display-only, but it is displayed BESIDE the name on
    -- every roster surface, so a member typing "Executive Director, UHR" onto
    -- their own row is the display_name attack with an extra step. Unlike
    -- display_name this one IS exempted for members.manage, because the members
    -- screen that maintains the roster is a JWT-bearing client and pinning it
    -- outright would make that screen silently do nothing.
    if new."position" is distinct from old."position"
       and not public.has_perm('members.manage') then
      new."position" := old."position";
    end if;

    -- 0016. Provenance, for the same reason it is pinned on `entries`
    -- (0015:191): it is server-side truth about the row, not a field anybody
    -- edits.
    new.created_at := old.created_at;

  end if;
  return new;
end;
$$;

comment on function public.guard_profile_role() is
  'BEFORE UPDATE on profiles. Pins role (except for an admin), display_name and created_at against any writer holding a JWT, and 0025 adds role_id and position. Self-escalation is defined as a GAIN of any permission key, so nobody — not even a members.manage holder — can walk their own row up to workspace.admin; moving anyone else between roles requires members.manage. Reverts rather than raising, because profiles_update legitimately lets a member write their own row for locale.';

-- Unchanged from 0001/0016 and restated because `create trigger` is not
-- idempotent. The NAME matters: profiles_guard_role sorts before
-- profiles_role_sync, and Postgres fires BEFORE triggers in name order.
drop trigger if exists profiles_guard_role on public.profiles;
create trigger profiles_guard_role
  before update on public.profiles
  for each row execute function public.guard_profile_role();


-- ═══ GUARD 3 ═══ every roles/permissions change is audited
--
-- ⚠ log_config_audit() IS RESTATED HERE WITH A WIDER GUARD, and it is 0002's
--   function, so this is a deliberate cross-file change.
--
--   Its guard was `auth.uid() is not null and not is_admin()` -> refuse. Under
--   custom roles that is now wrong in a way that only appears the day Aziz
--   creates the role this file exists to let him create: a role carrying
--   `members.manage` WITHOUT `workspace.admin` passes the RLS policy on
--   `roles`, reaches the audit trigger, and is refused by the audit writer with
--   "only an admin may write configuration audit rows" — a 42501 on a
--   legitimate edit, blamed on the wrong thing.
--
--   The guard is therefore "holds SOME configuration permission" rather than
--   "is an admin". It is still the thing it was written to be: a wall against
--   `POST /rest/v1/rpc/log_config_audit` forging audit rows from a plain
--   member's JWT or the public anon key (which the revokes below also block).
--   Everything else about the function — SECURITY DEFINER for the RLS
--   exemption, the profiles lookup for actor_id, the JWT-less passthrough for
--   the SQL Editor and the service role — is 0002's, unchanged.
create or replace function public.log_config_audit(
  p_table  text,
  p_row_id uuid,
  p_action text,
  p_before jsonb,
  p_after  jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null
     and not (
       public.is_admin()
       or public.has_perm('structure.edit')
       or public.has_perm('vocab.edit')
       or public.has_perm('members.manage')
     ) then
    raise exception 'only a configuration editor may write configuration audit rows'
      using errcode = '42501';
  end if;

  insert into public.config_audit (table_name, row_id, action, actor_id, before, after)
  values (
    p_table,
    p_row_id,
    p_action,
    -- Resolved through profiles rather than taken raw from auth.uid(): an auth
    -- user without a profile row would violate the FK, and because this runs
    -- inside an AFTER trigger that violation would roll back the admin's edit
    -- rather than merely losing one audit row.
    (select p.id from public.profiles p where p.id = auth.uid()),
    p_before,
    p_after
  );
end;
$$;

-- `from public` is NOT enough on Supabase (0002:365): every project ships
-- `alter default privileges in schema public grant execute on functions to
-- anon, authenticated`, which gives anon its OWN grant that a revoke from PUBLIC
-- leaves in place. Restated because `create or replace` above does not reset
-- privileges but a `drop`+`create` by anyone later would.
revoke all on function public.log_config_audit(text, uuid, text, jsonb, jsonb) from public;
revoke all on function public.log_config_audit(text, uuid, text, jsonb, jsonb) from anon;
grant execute on function public.log_config_audit(text, uuid, text, jsonb, jsonb) to authenticated;

-- Diffed rather than stamped unconditionally, for the same reason
-- track_groups_touch() is (0018:217): a screen that saves the whole role on
-- every keystroke-free blur must not report the role as edited — and must not
-- emit an audit row — when nothing moved.
create or replace function public.roles_touch()
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

drop trigger if exists roles_touch_trg on public.roles;
create trigger roles_touch_trg
  before update on public.roles
  for each row execute function public.roles_touch();

-- AFTER, not BEFORE: the row image recorded must be the one that survived every
-- other trigger and constraint on the table. Identical in shape to
-- track_groups_audit() (0018:243) — and a permission change is the single most
-- consequential configuration edit in the product, made by one person with no
-- second pair of eyes, which is the case config_audit exists for.
create or replace function public.roles_audit()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    -- Casts on the null: with a single candidate Postgres resolves an untyped
    -- null anyway, but an overload added later would make this ambiguous at
    -- runtime, inside a trigger, on someone else's write.
    perform public.log_config_audit('roles', new.id, 'insert', null::jsonb, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    if to_jsonb(new) is distinct from to_jsonb(old) then
      perform public.log_config_audit('roles', new.id, 'update', to_jsonb(old), to_jsonb(new));
    end if;
    return new;
  else
    perform public.log_config_audit('roles', old.id, 'delete', to_jsonb(old), null::jsonb);
    return old;
  end if;
end;
$$;

drop trigger if exists roles_audit_trg on public.roles;
create trigger roles_audit_trg
  after insert or update or delete on public.roles
  for each row execute function public.roles_audit();

-- `row_id` is the ROLE id, not a synthetic key for the pair: config_audit's
-- index is (table_name, row_id) and the question anybody asks of this trail is
-- "what happened to the Director role", never "what happened to row
-- (Director, vocab.edit)". The permission key is in the before/after images.
create or replace function public.role_permissions_audit()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_config_audit('role_permissions', new.role_id, 'insert', null::jsonb, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    if to_jsonb(new) is distinct from to_jsonb(old) then
      perform public.log_config_audit('role_permissions', new.role_id, 'update', to_jsonb(old), to_jsonb(new));
    end if;
    return new;
  else
    perform public.log_config_audit('role_permissions', old.role_id, 'delete', to_jsonb(old), null::jsonb);
    return old;
  end if;
end;
$$;

drop trigger if exists role_permissions_audit_trg on public.role_permissions;
create trigger role_permissions_audit_trg
  after insert or update or delete on public.role_permissions
  for each row execute function public.role_permissions_audit();

-- ── who holds what, audited ─────────────────────────────────────────────────
-- An ASSIGNMENT is a permission change — "who can delete a member" is answered
-- as much by profiles.role_id as by role_permissions — so it belongs in the same
-- trail. Narrow on both axes, deliberately:
--
--   * only when role_id or the legacy role actually moved, so a member changing
--     their locale or an admin fixing a typo writes nothing;
--   * only the identity and role fields in the images, not `to_jsonb(new)`.
--     config_audit is readable by every admin and a whole-row image would copy
--     display_name and created_at into it on every promotion for no benefit.
create or replace function public.profiles_role_audit()
returns trigger
language plpgsql
as $$
declare
  v_before jsonb := null;
  v_after  jsonb;
begin
  if tg_op = 'UPDATE'
     and new.role_id is not distinct from old.role_id
     and new.role    is not distinct from old.role then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    v_before := jsonb_build_object('id', old.id, 'role', old.role, 'role_id', old.role_id);
  end if;

  v_after := jsonb_build_object('id', new.id, 'role', new.role, 'role_id', new.role_id);

  perform public.log_config_audit(
    'profiles', new.id, lower(tg_op), v_before, v_after);
  return new;
end;
$$;

drop trigger if exists profiles_role_audit_trg on public.profiles;
create trigger profiles_role_audit_trg
  after insert or update on public.profiles
  for each row execute function public.profiles_role_audit();


-- ═══ PROBE 1 ═══ the shape this file promises, checked against live data
--
-- Runs as whoever applies the file (the SQL Editor, i.e. no JWT), which is the
-- right role here: this probe tests the SEED and the BACKFILL. The guards are
-- probe 3, this file's own RLS is probe 4, and the re-pointed configuration
-- policies are probe 5.
--
-- Written to be TRUE ON A RE-RUN and true on a project where an admin has
-- already renamed a role or invented three more, which is why it counts grants
-- per role key rather than pinning the whole table.
do $shape$
declare
  v_roles     int;
  v_admin_p   int;
  v_dir_p     int;
  v_mem_p     int;
  v_nulls     int;
  v_missing   text;
  v_admins    int;
  v_is_admin  text;
  v_keyck     text;
begin
  select count(*) into v_roles from public.roles;

  select string_agg(want, ', ') into v_missing
    from (values ('admin'), ('director'), ('member')) as w(want)
   where not exists (select 1 from public.roles r where r.key = w.want);

  if v_missing is not null then
    raise exception
      'NphiesCore 0025 FAILED: these roles were not created: %. The seed did not land, and profiles_role_sync() cannot resolve the legacy role column without admin and member.',
      v_missing;
  end if;

  select count(*) into v_admin_p from public.role_permissions rp
    join public.roles r on r.id = rp.role_id where r.key = 'admin'    and rp.granted;
  select count(*) into v_dir_p   from public.role_permissions rp
    join public.roles r on r.id = rp.role_id where r.key = 'director' and rp.granted;
  select count(*) into v_mem_p   from public.role_permissions rp
    join public.roles r on r.id = rp.role_id where r.key = 'member'   and rp.granted;

  if v_admin_p < 5 then
    raise exception
      'NphiesCore 0025 FAILED: the admin role grants % keys, expected all 5. is_admin() is has_perm(''workspace.admin'') now, so a missing grant closes every admin policy in the product.',
      v_admin_p;
  end if;

  if v_mem_p < 1 then
    raise exception
      'NphiesCore 0025 FAILED: the member role grants % keys, expected at least capture.write.', v_mem_p;
  end if;

  -- The Director role's DEFINING property, half one: it HOLDS the two keys the
  -- amendment made load-bearing. Before the amendment this was cosmetic and the
  -- probe only counted; now `structure.edit` and `vocab.edit` ARE the write
  -- gates on seven tables, so a missing grant is not "a seed that did not land"
  -- — it is seven people who open the map and can change nothing.
  select string_agg(want, ', ') into v_missing
    from (values ('structure.edit'), ('vocab.edit'), ('capture.write')) as w(want)
   where not exists (
     select 1 from public.role_permissions rp
       join public.roles r on r.id = rp.role_id
      where r.key = 'director' and rp.permission_key = w.want and rp.granted
   );

  if v_missing is not null then
    raise exception
      'NphiesCore 0025 FAILED: the director role is missing these grants: %. Since the amendment, structure.edit and vocab.edit are the write gates on tracks, track_groups, map_nodes, map_node_kinds, use_cases, vocab_options and label_overrides — without them the Director role grants nothing at all, which is the exact defect this file was amended to fix.',
      v_missing;
  end if;

  -- Half two, asserted as an ABSENCE. If this ever becomes true, seven people
  -- can delete a colleague's account and the reason this file was written has
  -- quietly evaporated.
  if exists (
    select 1 from public.role_permissions rp
      join public.roles r on r.id = rp.role_id
     where r.key = 'director' and rp.permission_key = 'members.manage' and rp.granted
  ) then
    raise exception
      'NphiesCore 0025 FAILED: the director role grants members.manage. The entire point of the role is structure and vocabulary WITHOUT the power to remove people.';
  end if;

  -- The backfill. A profile with no role_id is not broken — has_perm() falls
  -- back to the legacy column — but it means profiles_role_sync() did not run,
  -- and that is worth knowing before somebody drops the legacy column.
  select count(*) into v_nulls from public.profiles where role_id is null;
  if v_nulls <> 0 then
    raise exception
      'NphiesCore 0025 FAILED: % profile(s) still have a null role_id after the backfill. The update''s join to roles found nothing.',
      v_nulls;
  end if;

  -- The catalogue constraint has to EXIST, or "the keys are code-defined" is a
  -- sentence in a comment rather than a rule.
  select pg_get_constraintdef(oid) into v_keyck
    from pg_constraint where conname = 'role_permissions_key_ck';
  if v_keyck is null or v_keyck not like '%workspace.admin%' then
    raise exception
      'NphiesCore 0025 FAILED: role_permissions_key_ck is missing or does not list workspace.admin (%). Any string would be storable as a permission and an admin screen would render switches wired to nothing.',
      coalesce(v_keyck, 'absent');
  end if;

  -- is_admin() must actually be the alias. A project where 0001 was re-run after
  -- this file has the old body back, reads profiles.role, and silently stops
  -- honouring every custom role.
  select pg_get_functiondef('public.is_admin()'::regprocedure) into v_is_admin;
  if v_is_admin not like '%has_perm%' then
    raise exception
      'NphiesCore 0025 FAILED: is_admin() does not call has_perm(). 0001 or 0002 was re-run after this file; custom roles are not being honoured. Re-apply 0025.';
  end if;

  v_admins := public.admin_holder_count();

  raise notice
    'NphiesCore 0025 probe 1: % roles (admin=% director=% member=% grants), 0 profiles without a role, role_permissions_key_ck present, is_admin() aliases has_perm(), % member(s) hold workspace.admin.',
    v_roles, v_admin_p, v_dir_p, v_mem_p, v_admins;
end
$shape$;


-- ═══ PROBE 2 ═══ THE SAFETY NET: is_admin() still answers true for the admins
--
-- This is the assertion the whole migration rests on. `is_admin()` was
-- redefined under 183 policy call sites. If it now answers false for the people
-- it used to answer true for, every admin policy in the application has SILENTLY
-- CLOSED — no error, no failed statement, just an admin whose every write
-- affects zero rows and whose screens report success. That failure would be
-- discovered by Abdulaziz, in the app, after this file was declared applied.
--
-- No `set role authenticated` is needed and none is used: auth.uid() reads
-- `request.jwt.claims` from the session GUC, and is_admin() is SECURITY DEFINER,
-- so setting the claim is sufficient to ask the question exactly as PostgREST
-- would. That is what makes this probe unskippable — unlike 0018's RLS probe, it
-- cannot be dodged by a role that lacks the grant.
--
-- ⚠ THE AMENDMENT ADDED A SECOND QUESTION TO THE SAME LOOP, and it is the same
--   question in a new shape. Before, an admin reached `tracks` and `use_cases`
--   through is_admin(); now they reach them by HOLDING structure.edit and
--   vocab.edit. So "is Abdulaziz still an admin" is no longer sufficient — if
--   the seed landed workspace.admin and missed the other two, is_admin() is
--   true, this probe was green, and Settings › Structure is closed to the owner
--   of the workspace. Both keys are asserted, per admin, by name.
do $netcheck$
declare
  v_member_id  uuid;
  v_answer     boolean;
  v_checked    int := 0;
  r            record;
begin
  if not exists (select 1 from public.profiles) then
    raise notice
      'NphiesCore 0025 probe 2 SKIPPED: no profiles exist yet, so there is no admin whose access could have been closed.';
    return;
  end if;

  -- Every admin, not a sample: the workspace has 18 people and the cost of
  -- checking all of them is nothing next to finding out one was missed.
  for r in select id from public.profiles where role = 'admin' loop
    perform set_config('request.jwt.claims',
                       json_build_object('sub', r.id, 'role', 'authenticated')::text, true);
    v_answer := public.is_admin();
    v_checked := v_checked + 1;
    if not v_answer then
      perform set_config('request.jwt.claims', '', true);
      raise exception
        'NphiesCore 0025 FAILED: is_admin() answers FALSE for profile %, who was an admin before this migration. Every admin policy in the app has silently closed. The backfill did not reach this row, or the admin role lost its workspace.admin grant.',
        r.id;
    end if;

    -- The amendment's half of the safety net. Same failure mode, different
    -- table: writes that affect zero rows and a screen that reports success.
    if not public.has_perm('structure.edit') then
      perform set_config('request.jwt.claims', '', true);
      raise exception
        'NphiesCore 0025 FAILED: has_perm(''structure.edit'') answers FALSE for profile %, who is an admin. Since the amendment that key IS the write gate on tracks, track_groups, map_nodes and map_node_kinds — an admin without it cannot edit the structure of their own workspace, and nothing would say so.',
        r.id;
    end if;

    if not public.has_perm('vocab.edit') then
      perform set_config('request.jwt.claims', '', true);
      raise exception
        'NphiesCore 0025 FAILED: has_perm(''vocab.edit'') answers FALSE for profile %, who is an admin. That key is the write gate on use_cases, vocab_options and label_overrides — Settings › Terminology would silently save nothing.',
        r.id;
    end if;
  end loop;

  -- …and the negative control, without which the loop above would also pass
  -- against a function that returns true unconditionally.
  --
  -- Chosen by RESOLVED PERMISSION, not by `role <> 'admin'`. The legacy column
  -- names the system role assigned, so the day Aziz grants workspace.admin to a
  -- custom role its holders read as 'member' and are perfectly, correctly
  -- is_admin() — and picking one of them here would fail this migration on a
  -- re-run for doing exactly what it was built to allow.
  select p.id into v_member_id
    from public.profiles p
   where p.role_id is not null
     and not exists (
       select 1 from public.role_permissions rp
        where rp.role_id = p.role_id
          and rp.permission_key = 'workspace.admin'
          and rp.granted
     )
   limit 1;
  if v_member_id is not null then
    perform set_config('request.jwt.claims',
                       json_build_object('sub', v_member_id, 'role', 'authenticated')::text, true);
    if public.is_admin() then
      perform set_config('request.jwt.claims', '', true);
      raise exception
        'NphiesCore 0025 FAILED: is_admin() answers TRUE for profile %, who is not an admin. has_perm() is not filtering on the permission key and every member can now write every configuration table.',
        v_member_id;
    end if;

    -- capture.write is DECLARED, NOT YET ENFORCED (see the header), but the
    -- member role must still carry it or the day it starts being enforced every
    -- member loses the ability to file work.
    if not public.has_perm('capture.write') then
      perform set_config('request.jwt.claims', '', true);
      raise exception
        'NphiesCore 0025 FAILED: a plain member does not have capture.write. The member role''s seed did not land and the key is worthless the day something reads it.';
    end if;
  end if;

  perform set_config('request.jwt.claims', '', true);

  raise notice
    'NphiesCore 0025 probe 2: is_admin() answers TRUE for all % pre-existing admin(s), each of whom also holds structure.edit and vocab.edit, and FALSE for a non-admin, who does hold capture.write. Every policy call site — the ones still on is_admin() and the seven configuration tables now on a key — is intact.',
    v_checked;
end
$netcheck$;


-- ═══ PROBE 3 ═══ the two guards, exercised until they refuse
--
-- Fixtures created, asserted against, and rolled back through a sentinel
-- exception, so the workspace's real member list is untouched — 0018's pattern.
--
-- The guards are TRIGGERS, and triggers fire for every writer including the one
-- applying this file, so unlike 0018's RLS probe this one needs no `set role
-- authenticated` and cannot be skipped. What it does need is a JWT claim, because
-- guard_profile_role() deliberately does nothing when auth.uid() is null.
do $guards$
declare
  v_admin      uuid := gen_random_uuid();
  v_member     uuid := gen_random_uuid();
  v_admin_role uuid;
  v_dir_role   uuid;
  v_mem_role   uuid;
  v_after      uuid;
  v_raised     boolean := false;
  v_audit0     int;
  v_audit1     int;
  v_audit2     int;
  v_sources    int;
begin
  select id into v_admin_role from public.roles where key = 'admin';
  select id into v_dir_role   from public.roles where key = 'director';
  select id into v_mem_role   from public.roles where key = 'member';

  begin
    insert into auth.users (id, email, raw_user_meta_data) values
      (v_admin,  'probe-admin-'  || v_admin  || '@0025.invalid',
       jsonb_build_object('display_name', '0025 Probe Admin')),
      (v_member, 'probe-member-' || v_member || '@0025.invalid',
       jsonb_build_object('display_name', '0025 Probe Member'));

    if (select count(*) from public.profiles where id in (v_admin, v_member)) <> 2 then
      raise exception 'NphiesCore 0025 PROBE 3 SETUP FAILED: handle_new_user() did not create the fixture profiles.';
    end if;

    -- The INSERT branch of profiles_role_sync() must have landed them on Member
    -- without anybody asking. This is the line that stops every member
    -- provisioned after this migration from having no permissions at all.
    if (select count(*) from public.profiles
         where id in (v_admin, v_member) and role_id = v_mem_role) <> 2 then
      raise exception
        'NphiesCore 0025 FAILED: a profile created by handle_new_user() did not get the Member role. profiles_role_sync()''s INSERT branch is not firing and every new sign-in has no permissions.';
    end if;

    -- Promote the fixture admin the way the edge function does — the LEGACY text
    -- column, service-role style, no JWT — and require that role_id followed.
    update public.profiles set role = 'admin' where id = v_admin;
    select role_id into v_after from public.profiles where id = v_admin;
    if v_after is distinct from v_admin_role then
      raise exception
        'NphiesCore 0025 FAILED: writing role=''admin'' did not move role_id to the Admin role. The admin-members set-role button would report success and promote nobody.';
    end if;

    -- …and the derivation the other way.
    update public.profiles set role_id = v_dir_role where id = v_member;
    if (select role from public.profiles where id = v_member) <> 'member' then
      raise exception
        'NphiesCore 0025 FAILED: assigning the Director role left profiles.role saying something other than ''member''. The derived column disagrees with the assignment.';
    end if;
    update public.profiles set role_id = v_mem_role where id = v_member;

    -- ── GUARD 2(a): a member cannot escalate THEMSELVES ──
    perform set_config('request.jwt.claims',
                       json_build_object('sub', v_member, 'role', 'authenticated')::text, true);

    update public.profiles set role_id = v_admin_role where id = v_member;
    select role_id into v_after from public.profiles where id = v_member;
    if v_after is distinct from v_mem_role then
      raise exception
        'NphiesCore 0025 FAILED: a plain member set their own role_id to Admin and it stuck. guard_profile_role() is not reverting self-escalation, and every member is one PATCH away from workspace.admin.';
    end if;

    -- …and cannot move anybody ELSE either.
    update public.profiles set role_id = v_mem_role where id = v_admin;
    select role_id into v_after from public.profiles where id = v_admin;
    if v_after is distinct from v_admin_role then
      raise exception
        'NphiesCore 0025 FAILED: a plain member demoted the admin. guard_profile_role() is not gating other people''s role_id on members.manage.';
    end if;

    -- …and cannot retitle themselves.
    update public.profiles set "position" = 'Executive Director, UHR' where id = v_member;
    if (select "position" from public.profiles where id = v_member) <> '' then
      raise exception
        'NphiesCore 0025 FAILED: a plain member wrote their own position. It is displayed beside their name on every roster surface, which makes it the display_name attack with an extra step.';
    end if;

    -- ── the positive control: members.manage CAN do all of it ──
    perform set_config('request.jwt.claims',
                       json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

    select count(*) into v_audit0 from public.config_audit where table_name = 'role_permissions';

    update public.profiles set role_id = v_dir_role, "position" = 'PMO Director' where id = v_member;
    select role_id into v_after from public.profiles where id = v_member;
    if v_after is distinct from v_dir_role then
      raise exception
        'NphiesCore 0025 FAILED: a members.manage holder could not assign the Director role. The guard is too strict and the Members screen would silently do nothing.';
    end if;
    if (select "position" from public.profiles where id = v_member) <> 'PMO Director' then
      raise exception
        'NphiesCore 0025 FAILED: a members.manage holder could not write a position.';
    end if;

    -- ── GUARD 3: the audit trail, and the no-op that must not write to it ──
    update public.role_permissions
       set granted = true
     where role_id = v_dir_role and permission_key = 'vocab.edit';
    select count(*) into v_audit1 from public.config_audit where table_name = 'role_permissions';
    if v_audit1 <> v_audit0 then
      raise exception
        'NphiesCore 0025 FAILED: an UPDATE that changed nothing wrote % config_audit row(s). The diffed-touch guard is missing and a screen that saves on blur would fill the trail with noise nobody can read past.',
        v_audit1 - v_audit0;
    end if;

    update public.role_permissions
       set granted = false
     where role_id = v_dir_role and permission_key = 'vocab.edit';
    select count(*) into v_audit2 from public.config_audit where table_name = 'role_permissions';
    if v_audit2 <= v_audit1 then
      raise exception
        'NphiesCore 0025 FAILED: revoking a permission wrote no config_audit row. A permission change with no trail is exactly what config_audit exists to prevent.';
    end if;

    perform set_config('request.jwt.claims', '', true);

    -- ── GUARD 1: revoking workspace.admin from the last role that grants it ──
    -- Only meaningful when exactly one role grants it; on a workspace where Aziz
    -- has already made a second admin-carrying role, deleting one grant
    -- legitimately leaves admins standing and the assertion would be wrong.
    select count(*) into v_sources from public.role_permissions
     where permission_key = 'workspace.admin' and granted;

    if v_sources = 1 then
      begin
        delete from public.role_permissions
         where permission_key = 'workspace.admin' and granted;
        v_raised := false;
      exception when insufficient_privilege then
        v_raised := true;   -- 42501, as intended
      end;

      if not v_raised then
        raise exception
          'NphiesCore 0025 FAILED: revoking workspace.admin from the only role that grants it was accepted. The workspace can be locked out of its own admin screens with one DELETE, recoverable only with dashboard SQL.';
      end if;
    end if;

    -- ── the system roles are not deletable, and a held role is not either ──
    begin
      delete from public.roles where key = 'member';
      v_raised := false;
    exception when insufficient_privilege then
      v_raised := true;
    end;
    if not v_raised then
      raise exception
        'NphiesCore 0025 FAILED: the system Member role was deleted. profiles_role_sync() resolves the legacy role column against it and every new sign-in would land with no role.';
    end if;

    begin
      delete from public.roles where key = 'director';
      v_raised := false;
    exception when foreign_key_violation then
      v_raised := true;
    end;
    if not v_raised then
      raise exception
        'NphiesCore 0025 FAILED: a role held by a member was deleted. roles_guard_write() did not refuse and eleven people could be stripped of every permission by one click.';
    end if;

    raise exception using errcode = 'OT025', message = 'probe rollback';
  exception
    when sqlstate 'OT025' then
      null;
  end;

  perform set_config('request.jwt.claims', '', true);

  raise notice
    'NphiesCore 0025 probe 3: a new profile landed on Member unasked; the legacy column and role_id stay in step in both directions; a member could not escalate themselves, move anyone else, or write their own position; a members.manage holder could do all three; a no-op wrote no audit row and a real revocation did; revoking the last workspace.admin, deleting a system role and deleting a held role were all refused. Rolled back.';
end
$guards$;


-- ═══ PROBE 4 ═══ member read, members.manage write, over RLS
--
-- 0018's probe 2, narrowed to this file's two tables. Needs the ROLE, not just
-- the JWT, so it does `set local role authenticated`; if that role is not
-- grantable to whoever is applying this file the probe SKIPS with a notice
-- rather than failing the migration — the policies are installed either way and
-- a false failure sends an operator hunting a bug that is not there.
--
-- The skip test is SCOPED TO THE ROLE SWITCH ALONE, and that scoping is the
-- point: a broken INSERT policy raises 42501 too, and wrapping the whole block
-- would report it as "skipped" — a green migration with an admin who cannot
-- create a role.
do $rls$
declare
  v_admin      uuid := gen_random_uuid();
  v_member     uuid := gen_random_uuid();
  v_admin_role uuid;
  v_read_r     int := 0;
  v_read_p     int := 0;
  v_wrote      boolean := false;
  v_admin_ok   boolean := false;
  v_skipped    boolean := false;
begin
  select id into v_admin_role from public.roles where key = 'admin';

  begin
    insert into auth.users (id, email, raw_user_meta_data) values
      (v_admin,  'probe4-admin-'  || v_admin  || '@0025.invalid',
       jsonb_build_object('display_name', '0025 Probe4 Admin')),
      (v_member, 'probe4-member-' || v_member || '@0025.invalid',
       jsonb_build_object('display_name', '0025 Probe4 Member'));

    update public.profiles set role_id = v_admin_role where id = v_admin;

    begin
      perform set_config('request.jwt.claims',
                         json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
      set local role authenticated;
    exception when insufficient_privilege then
      v_skipped := true;
    end;

    if not v_skipped then
      insert into public.roles (key, name, name_ar, sort_order)
        values ('probe_0025', '0025 Probe Role', 'دور اختبار', 99);
      v_admin_ok := true;

      perform set_config('request.jwt.claims',
                         json_build_object('sub', v_member, 'role', 'authenticated')::text, true);

      select count(*) into v_read_r from public.roles;
      select count(*) into v_read_p from public.role_permissions;

      -- RLS makes a blocked UPDATE or DELETE affect zero rows rather than raise,
      -- which is the whole reason src/lib/permissions.ts exists. Count rows, do
      -- not catch.
      update public.roles set name = 'Hijacked' where key = 'probe_0025';
      if found then v_wrote := true; end if;

      delete from public.roles where key = 'probe_0025';
      if found then v_wrote := true; end if;

      -- An INSERT is the exception to that rule and it is the one that would
      -- have taken this whole probe down: a failing WITH CHECK RAISES 42501
      -- rather than affecting zero rows, and an uncaught raise here would abort
      -- the DO block past the OT025 rollback handler and fail the migration on
      -- a policy that is working correctly. Caught, and the SUCCESS path is what
      -- sets v_wrote — a member granting themselves workspace.admin is the worst
      -- write available in this schema.
      begin
        insert into public.role_permissions (role_id, permission_key, granted)
          select id, 'workspace.admin', true from public.roles where key = 'admin'
          on conflict (role_id, permission_key) do update set granted = true;
        v_wrote := true;
      exception when insufficient_privilege then
        null;  -- 42501, as intended
      end;

      reset role;
    end if;

    raise exception using errcode = 'OT025', message = 'probe rollback';
  exception
    when sqlstate 'OT025' then
      null;
  end;

  perform set_config('request.jwt.claims', '', true);

  if v_skipped then
    raise notice
      'NphiesCore 0025 probe 4 SKIPPED: this role cannot `set role authenticated`, so the RLS half could not run. The policies ARE installed. Verify by hand: sign in as a member and PATCH /rest/v1/roles — it must affect zero rows.';
    return;
  end if;

  if not v_admin_ok then
    raise exception
      'NphiesCore 0025 FAILED: a members.manage holder could not create a role. roles_insert is too strict and the Roles screen would be unusable.';
  end if;

  if v_read_r < 3 or v_read_p < 5 then
    raise exception
      'NphiesCore 0025 FAILED: a member read % roles and % grants. They must be able to read both — an app that cannot tell a member what they are allowed to do renders controls that look enabled and fail at the server.',
      v_read_r, v_read_p;
  end if;

  if v_wrote then
    raise exception
      'NphiesCore 0025 FAILED: a plain member created, renamed or deleted a role, or granted themselves a permission. The write policies are not members.manage-gated and the permission system is decorative.';
  end if;

  raise notice
    'NphiesCore 0025 probe 4: a members.manage holder created a role; a member read % roles and % grants and could neither write a role nor grant a permission. Rolled back.',
    v_read_r, v_read_p;
end
$rls$;


-- ═══ PROBE 5 ═══ THE DIRECTOR ROLE DOES WHAT ITS NAME SAYS — AND NOTHING MORE
--
-- NEW WITH THE AMENDMENT, and it is the whole reason the amendment is worth
-- applying rather than describing. Two halves, and both are written so they CAN
-- FAIL — against the file as it stood before the amendment, EVERY assertion in
-- half A and both writes in half B would have failed, which is the only
-- definition of "the gap was real" worth having.
--
--   HALF A — THE CATALOGUE, and it cannot be skipped. It reads `pg_policies`
--   and `pg_get_functiondef` directly, so it runs whether or not this role can
--   `set role authenticated`, and it asserts THREE things: the seven
--   configuration tables check a KEY, the eight admin RPCs that write those same
--   tables check the SAME key, and `profiles` / `roles` / `role_permissions`
--   still do NOT. The third list is the important one. It is an assertion that something did NOT change, and
--   it is here because the failure it catches — someone "tidying up" by making
--   role_permissions consistent with the rest — turns Director into Admin
--   silently, with no error and no visible symptom until somebody notices they
--   have been an administrator for a month.
--
--   HALF B — THE BEHAVIOUR, over RLS, with a real Director fixture. Skips with a
--   notice if the applying role cannot `set role authenticated` (0018's pattern,
--   scoped to the role switch ALONE so a genuinely broken policy reports as a
--   failure rather than as a skip). Everything it creates — three auth users,
--   their profiles, a map node, a use-case bump — is rolled back through the
--   OT025 sentinel, fixtures included.
do $director$
declare
  v_dir        uuid := gen_random_uuid();
  v_other      uuid := gen_random_uuid();
  v_ghost      uuid := gen_random_uuid();
  v_dir_role   uuid;
  v_admin_role uuid;
  v_mem_role   uuid;
  v_track      uuid;
  v_uc         uuid;
  v_node       uuid;
  v_after      uuid;
  v_def        text;
  v_node_ok    boolean := false;
  v_rpc_ok     boolean := false;
  v_vocab_ok   boolean := false;
  v_made       boolean := false;
  v_deleted    boolean := false;
  v_reroled    boolean := false;
  v_escalated  boolean := false;
  v_revoked    boolean := false;
  v_granted    boolean := false;
  v_skipped    boolean := false;
  r            record;
begin
  -- ── HALF A(i): the seven configuration tables check a KEY ──
  for r in
    select * from (values
      ('tracks',          'tracks_insert',           'structure.edit'),
      ('tracks',          'tracks_update',           'structure.edit'),
      ('tracks',          'tracks_delete',           'structure.edit'),
      ('track_groups',    'track_groups_insert',     'structure.edit'),
      ('track_groups',    'track_groups_update',     'structure.edit'),
      ('track_groups',    'track_groups_delete',     'structure.edit'),
      ('map_nodes',       'map_nodes_insert',        'structure.edit'),
      ('map_nodes',       'map_nodes_update',        'structure.edit'),
      ('map_nodes',       'map_nodes_delete',        'structure.edit'),
      ('map_node_kinds',  'map_node_kinds_insert',   'structure.edit'),
      ('map_node_kinds',  'map_node_kinds_update',   'structure.edit'),
      ('map_node_kinds',  'map_node_kinds_delete',   'structure.edit'),
      ('use_cases',       'use_cases_insert',        'vocab.edit'),
      ('use_cases',       'use_cases_update',        'vocab.edit'),
      ('use_cases',       'use_cases_delete',        'vocab.edit'),
      ('vocab_options',   'vocab_options_insert',    'vocab.edit'),
      ('vocab_options',   'vocab_options_update',    'vocab.edit'),
      ('vocab_options',   'vocab_options_delete',    'vocab.edit'),
      ('label_overrides', 'label_overrides_insert',  'vocab.edit'),
      ('label_overrides', 'label_overrides_update',  'vocab.edit'),
      ('label_overrides', 'label_overrides_delete',  'vocab.edit')
    ) as w (tbl, pol, want)
  loop
    -- `qual` is null on an INSERT policy and `with_check` is null on a DELETE
    -- one, so both are coalesced and joined rather than tested separately.
    select coalesce(pp.qual, '') || ' | ' || coalesce(pp.with_check, '')
      into v_def
      from pg_policies pp
     where pp.schemaname = 'public'
       and pp.tablename  = r.tbl
       and pp.policyname = r.pol;

    if v_def is null then
      raise exception
        'NphiesCore 0025 FAILED: policy %.% does not exist. The re-pointing block did not run, or somebody dropped it — either way that table has no write gate at all under RLS.',
        r.tbl, r.pol;
    end if;

    if strpos(v_def, r.want) = 0 then
      raise exception
        'NphiesCore 0025 FAILED: policy %.% does not check has_perm(''%''). Its predicate is: %. The Director role grants nothing on this table, which is the exact defect this file was amended to fix.',
        r.tbl, r.pol, r.want, v_def;
    end if;
  end loop;

  -- ── HALF A(ii): THE ESCALATION BOUNDARY, asserted as a NON-change ──
  -- If any of these ever starts checking structure.edit or vocab.edit, a
  -- Director can re-role people or grant themselves workspace.admin and the
  -- split Aziz decided is decorative. This loop is the reason a future "make it
  -- consistent" edit fails loudly instead of shipping.
  -- Two acceptable spellings per row, because `is_admin()` and
  -- `has_perm('workspace.admin')` are THE SAME PREDICATE and a later migration
  -- writing the second must not be reported as a breach. What is refused is a
  -- predicate that mentions neither — or that mentions a Director key.
  for r in
    select * from (values
      ('profiles',         'profiles_insert',         'is_admin',       'workspace.admin'),
      ('profiles',         'profiles_update',         'is_admin',       'workspace.admin'),
      ('profiles',         'profiles_delete',         'is_admin',       'workspace.admin'),
      ('roles',            'roles_insert',            'members.manage', 'workspace.admin'),
      ('roles',            'roles_update',            'members.manage', 'workspace.admin'),
      ('roles',            'roles_delete',            'members.manage', 'workspace.admin'),
      ('role_permissions', 'role_permissions_insert', 'members.manage', 'workspace.admin'),
      ('role_permissions', 'role_permissions_update', 'members.manage', 'workspace.admin'),
      ('role_permissions', 'role_permissions_delete', 'members.manage', 'workspace.admin')
    ) as w (tbl, pol, want, alt)
  loop
    select coalesce(pp.qual, '') || ' | ' || coalesce(pp.with_check, '')
      into v_def
      from pg_policies pp
     where pp.schemaname = 'public'
       and pp.tablename  = r.tbl
       and pp.policyname = r.pol;

    if v_def is null then
      raise exception
        'NphiesCore 0025 FAILED: policy %.% does not exist. Deleting people, or editing what a role grants, would be gated by nothing.',
        r.tbl, r.pol;
    end if;

    if strpos(v_def, r.want) = 0 and strpos(v_def, r.alt) = 0 then
      raise exception
        'NphiesCore 0025 FAILED: policy %.% checks neither % nor %. Its predicate is: %. This is THE escalation boundary: profiles is who is in the workspace, and role_permissions is what the keys themselves mean. Both stay with workspace.admin / members.manage.',
        r.tbl, r.pol, r.want, r.alt, v_def;
    end if;

    if v_def like '%structure.edit%' or v_def like '%vocab.edit%' then
      raise exception
        'NphiesCore 0025 FAILED: policy %.% checks a Director key (%). A role that can edit permissions can grant itself anything — one click from Director to Admin, with no guard in the way.',
        r.tbl, r.pol, v_def;
    end if;
  end loop;

  -- ── HALF A(iii): THE EIGHT ADMIN RPCs CHECK THE SAME KEY AS THE POLICY ──
  -- Also unskippable — `pg_get_functiondef` needs no role switch — and it is
  -- the assertion that catches the ONE re-run that half A(i) cannot see:
  -- re-running 0002, 0003, 0017 or 0023 restores an `is_admin()` guard while
  -- leaving this file's policies in place. RLS would then accept a Director's
  -- drag and the function beside it would refuse with 42501, which reads to the
  -- person doing the dragging as the app being broken.
  --
  -- The `is_admin` test is the important half. `has_perm('workspace.admin')`
  -- is NOT accepted as an alternative here the way it is in half A(ii): these
  -- functions are supposed to check a DIRECTOR key, so any mention of is_admin()
  -- means the owning file was re-run over the top of this one.
  for r in
    select * from (values
      ('reorder_tracks(uuid[])',                        'structure.edit'),
      ('delete_track(uuid, uuid)',                      'structure.edit'),
      ('reorder_map_node_kinds(uuid[])',                'structure.edit'),
      ('reorder_map_nodes(uuid, uuid, uuid[])',         'structure.edit'),
      ('move_map_node(uuid, uuid, uuid)',               'structure.edit'),
      ('reorder_vocab(text, text[])',                   'vocab.edit'),
      ('reset_vocab(text, text)',                       'vocab.edit'),
      ('reset_label_overrides(text)',                   'vocab.edit')
    ) as w (sig, want)
  loop
    -- to_regprocedure rather than ::regprocedure: the cast RAISES on a missing
    -- function, and a bare 42883 from inside a probe says nothing about which
    -- of the eight is gone or why it matters.
    if to_regprocedure('public.' || r.sig) is null then
      raise exception
        'NphiesCore 0025 FAILED: function public.% does not exist. One of 0002 / 0003 / 0017 / 0023 has not been applied, so the RPC this file restates has nothing to replace.',
        r.sig;
    end if;

    v_def := pg_get_functiondef(to_regprocedure('public.' || r.sig));

    if strpos(v_def, 'has_perm(''' || r.want || ''')') = 0 then
      raise exception
        'NphiesCore 0025 FAILED: public.% does not guard on has_perm(''%''). Its own file was re-run after this one. RLS now accepts a Director''s write on that table and this function refuses it with 42501 — the policy and the RPC disagree, and the person dragging a node is told the app is broken.',
        r.sig, r.want;
    end if;

    if strpos(v_def, 'is_admin') > 0 then
      raise exception
        'NphiesCore 0025 FAILED: public.% still mentions is_admin(). Re-apply 0025 — it goes last, always.',
        r.sig;
    end if;
  end loop;

  -- ── HALF B: setup ──
  select id into v_dir_role   from public.roles where key = 'director';
  select id into v_admin_role from public.roles where key = 'admin';
  select id into v_mem_role   from public.roles where key = 'member';

  select id into v_track from public.tracks    order by sort_order, name limit 1;
  select id into v_uc    from public.use_cases order by sort_order, name limit 1;

  if v_track is null or v_uc is null then
    raise notice
      'NphiesCore 0025 probe 5 half B SKIPPED: no tracks (%) or no use_cases (%), so there is nothing for a Director to write. Half A passed — the policies ARE re-pointed.',
      v_track, v_uc;
    return;
  end if;

  begin
    insert into auth.users (id, email, raw_user_meta_data) values
      (v_dir,   'probe5-dir-'   || v_dir   || '@0025.invalid',
       jsonb_build_object('display_name', '0025 Probe Director')),
      (v_other, 'probe5-other-' || v_other || '@0025.invalid',
       jsonb_build_object('display_name', '0025 Probe Colleague')),
      (v_ghost, 'probe5-ghost-' || v_ghost || '@0025.invalid',
       jsonb_build_object('display_name', '0025 Probe Ghost'));

    if (select count(*) from public.profiles where id in (v_dir, v_other, v_ghost)) <> 3 then
      raise exception 'NphiesCore 0025 PROBE 5 SETUP FAILED: handle_new_user() did not create the fixture profiles.';
    end if;

    -- No JWT yet, so guard_profile_role() lets this through: the privileged path
    -- the SQL Editor and the edge function use.
    update public.profiles set role_id = v_dir_role where id = v_dir;

    -- The ghost's PROFILE is removed while its auth.users row stays. That is
    -- load-bearing: profiles.id is a foreign key to auth.users, so an insert
    -- with an invented uuid would be refused by the FK and the probe would pass
    -- for the wrong reason and could never fail. With the FK satisfied, the only
    -- thing that can refuse the insert below is profiles_insert's WITH CHECK.
    delete from public.profiles where id = v_ghost;

    perform set_config('request.jwt.claims',
                       json_build_object('sub', v_dir, 'role', 'authenticated')::text, true);

    -- The fixture has to actually BE a Director, or every assertion below is
    -- vacuous — this is the control that stops the probe passing because the
    -- fixture had no permissions rather than because the boundary held.
    if not public.has_perm('structure.edit') or not public.has_perm('vocab.edit') then
      raise exception
        'NphiesCore 0025 PROBE 5 SETUP FAILED: the fixture Director does not resolve to structure.edit + vocab.edit. has_perm() or the seed is wrong, and nothing below would mean anything.';
    end if;
    if public.is_admin() or public.has_perm('members.manage') then
      raise exception
        'NphiesCore 0025 PROBE 5 SETUP FAILED: the fixture Director resolves to workspace.admin or members.manage. The Director role has been given the powers it exists to withhold.';
    end if;

    begin
      set local role authenticated;
    exception when insufficient_privilege then
      v_skipped := true;
    end;

    if not v_skipped then
      -- ═══ THE GAP, CLOSED ═══
      -- Both of these were REFUSED before the amendment, when every write policy
      -- on these tables said is_admin(). That is what makes them assertions
      -- rather than decoration.
      begin
        insert into public.map_nodes (track_id, name)
          values (v_track, '0025 Director Probe ' || v_dir)
          returning id into v_node;
        v_node_ok := true;
      exception when insufficient_privilege then
        null;  -- 42501: the gap is still open, reported below
      end;

      -- …and the RPC half of the same gap. THE POLICY IS NOT ENOUGH: a Director
      -- who can INSERT a node and cannot REORDER one has half a power and meets
      -- a 42501 on the one gesture the tree admin is mostly made of. Only run
      -- when the insert above actually landed — otherwise this asserts nothing
      -- and would fail for the previous line's reason under a different name.
      if v_node_ok then
        begin
          perform public.reorder_map_nodes(null::uuid, v_track, array[v_node]);
          v_rpc_ok := true;
        exception when insufficient_privilege then
          null;  -- 42501: the RPC still guards on is_admin(), reported below
        end;
      end if;

      -- A blocked UPDATE affects zero rows rather than raising, so this one is
      -- counted, not caught.
      begin
        update public.use_cases set sort_order = sort_order + 1000 where id = v_uc;
        if found then v_vocab_ok := true; end if;
      exception when insufficient_privilege then
        null;
      end;

      -- ═══ THE ESCALATION BOUNDARY — the one that must never regress ═══
      -- (1) cannot CREATE a person.
      begin
        insert into public.profiles (id, display_name, role)
          values (v_ghost, '0025 Probe Ghost', 'member');
        v_made := true;
      exception when insufficient_privilege then
        null;
      end;

      -- (2) cannot DELETE a colleague. This is the sentence the whole role
      --     exists to make true.
      begin
        delete from public.profiles where id = v_other;
        if found then v_deleted := true; end if;
      exception when insufficient_privilege then
        null;
      end;

      -- (3) cannot move anybody ELSE between roles. Refused by RLS: a Director
      --     is neither `id = auth.uid()` nor an admin for that row.
      begin
        update public.profiles set role_id = v_admin_role where id = v_other;
      exception when insufficient_privilege then
        null;
      end;
      select role_id into v_after from public.profiles where id = v_other;
      if v_after is distinct from v_mem_role then v_reroled := true; end if;

      -- (4) cannot move THEMSELVES up. RLS lets this row through — it is their
      --     own — and guard_profile_role() reverts it, because the new role
      --     grants keys the old one did not. Two different mechanisms, and this
      --     is the one that catches a Director editing their own profile.
      begin
        update public.profiles set role_id = v_admin_role where id = v_dir;
      exception when insufficient_privilege then
        null;
      end;
      select role_id into v_after from public.profiles where id = v_dir;
      if v_after is distinct from v_dir_role then v_escalated := true; end if;

      -- (5) cannot edit what a role grants, in either direction: revoking one
      --     from somebody else's role, or granting workspace.admin to their own.
      begin
        update public.role_permissions set granted = false
         where role_id = v_dir_role and permission_key = 'vocab.edit';
        if found then v_revoked := true; end if;
      exception when insufficient_privilege then
        null;
      end;

      begin
        insert into public.role_permissions (role_id, permission_key, granted)
          values (v_dir_role, 'workspace.admin', true);
        v_granted := true;
      exception when insufficient_privilege then
        null;  -- 42501, as intended
      end;

      reset role;
    end if;

    raise exception using errcode = 'OT025', message = 'probe rollback';
  exception
    when sqlstate 'OT025' then
      null;
  end;

  perform set_config('request.jwt.claims', '', true);

  -- ── the verdict, after the rollback so no assertion can leave a fixture ──
  if v_skipped then
    raise notice
      'NphiesCore 0025 probe 5 half B SKIPPED: this role cannot `set role authenticated`. HALF A PASSED, so the policies ARE re-pointed and the boundary IS intact — that half reads pg_policies and cannot be skipped. Verify the behaviour by hand: sign in as a Director and POST /rest/v1/map_nodes (must succeed) and DELETE /rest/v1/profiles?id=eq.<someone> (must affect zero rows).';
    return;
  end if;

  if not v_node_ok then
    raise exception
      'NphiesCore 0025 FAILED: a Director could not insert a map_nodes row. map_nodes_insert is still gated on is_admin(), so the Director role grants nothing it claims to and the roles screen would render switches wired to nothing.';
  end if;

  if not v_rpc_ok then
    raise exception
      'NphiesCore 0025 FAILED: a Director inserted a map node and could not REORDER one. reorder_map_nodes() still opens with is_admin(), so RLS accepts the Director''s writes and the RPC beside it refuses the drag with 42501 — the policy and the function disagree, and the tree admin is mostly made of that gesture.';
  end if;

  if not v_vocab_ok then
    raise exception
      'NphiesCore 0025 FAILED: a Director could not update a use_cases row. use_cases_update is still gated on is_admin() — vocab.edit is a string in a CHECK constraint that nothing reads.';
  end if;

  if v_made then
    raise exception
      'NphiesCore 0025 FAILED: a Director created a profile. profiles_insert is not gated on workspace.admin, and provisioning people is the power the Director role exists to withhold.';
  end if;

  if v_deleted then
    raise exception
      'NphiesCore 0025 FAILED: a Director DELETED a colleague''s profile. That single sentence is the entire reason this file exists: seven people shape the map and the vocabulary, two decide who is in the workspace.';
  end if;

  if v_reroled then
    raise exception
      'NphiesCore 0025 FAILED: a Director changed somebody else''s role_id. Moving anyone between roles is members.manage''s job, and a Director who can do it can appoint an accomplice.';
  end if;

  if v_escalated then
    raise exception
      'NphiesCore 0025 FAILED: a Director moved THEMSELVES to the Admin role and it stuck. guard_profile_role() is not reverting self-escalation and every Director is one PATCH away from workspace.admin.';
  end if;

  if v_revoked or v_granted then
    raise exception
      'NphiesCore 0025 FAILED: a Director wrote role_permissions (revoked=%, granted=%). A role that can edit permissions can grant itself anything, so the Director/Admin split is decorative.',
      v_revoked, v_granted;
  end if;

  raise notice
    'NphiesCore 0025 probe 5: 21 configuration write policies and 8 admin RPCs check a permission key, and 9 people/permission policies still do not; a Director inserted a map node, REORDERED it and updated a use case (all three refused before this amendment), and could not create, delete or re-role a person, could not walk their own row up to Admin, and could neither revoke nor grant a permission. Rolled back.';
end
$director$;
