-- 0028 — the saved Jira configuration, and the off-switch that makes Jira
-- invisible until somebody turns it on.
--
-- WHAT THIS IS
-- Settings › Jira (`src/pages/settings/JiraAdmin.tsx`) can already read a real
-- Jira and show what came back. Until this file, nothing it was told SURVIVED:
-- the field mapping, the status words and the JQL were React state, and losing
-- twenty minutes of picking to a page reload is the kind of thing that makes
-- somebody stop trusting a tool. This file gives that configuration one row to
-- live in.
--
-- The screen used to say so out loud, in a key called `jira.notSaved`. That key
-- was RETIRED in the same commit that landed this file and the Save button that
-- writes it — `jiraconfig.savedHere` replaced it — because a screen that says
-- "none of this is saved" while saving it is worse than one that says nothing.
-- If this file is ever reverted, that sentence has to come back with it.
--
-- IT ALSO SHIPS THE SWITCH THAT IS OFF. `enabled boolean not null default
-- false`, and the owner's sentence is the whole reason: "i can not connect the
-- app to jira until we verify the tracker very well." With this file applied and
-- nothing else done, EVERY Jira surface outside Settings renders NOTHING —
-- not a disabled control, not a greyed-out link, ABSENT — because
-- `useJiraEnabled()` (src/store/config.ts) answers false. A disabled control is
-- a promise; an absent one is an honest silence.
--
--
-- ═══ ONE ROW, AND THE ONE-ROW-NESS IS CHECKED RATHER THAN HOPED FOR ═══
--
-- This is a single-workspace app with one Jira site behind one set of secrets on
-- one edge function. There is no tenant column here for the reason there is none
-- anywhere else in this schema: inventing one would be inventing a concept the
-- product does not have.
--
-- "One row" is therefore a RULE, and a rule nothing enforces is a comment. The
-- honest enforcement is a CHECKED SINGLETON KEY:
--
--     id uuid primary key
--        default '00000000-0000-0000-0000-000000000028'
--        check   (id = '00000000-0000-0000-0000-000000000028')
--
-- The primary key makes a second row with that id impossible; the CHECK makes a
-- second row with ANY OTHER id impossible. Neither half is redundant and
-- probe 1 exercises both, because the pair is what makes "there is one row"
-- something a reader can rely on instead of something a reviewer has to police.
--
-- The alternatives were considered and are worse:
--
--   * a unique index on a constant expression — `create unique index on
--     jira_settings ((true))`. Compact, and it depends on a corner of the index
--     machinery this fleet cannot exercise against a real Postgres in this
--     sitting. A CHECK on a key column is ordinary SQL with ordinary behaviour.
--   * a `before insert` trigger counting rows — a race between two sessions,
--     and a rule expressed in plpgsql where a constraint would do.
--   * nothing at all, with the client "always upserting the same row" — which is
--     exactly how a second row appears the day somebody runs an INSERT by hand
--     at the SQL Editor, after which every read has to decide which of two
--     configurations is the truth.
--
-- THE ID IS A UUID AND NOT THE TEXT 'jira', and that is not cosmetics.
-- `config_audit.row_id` is `uuid` (0002:290), so a text key would force every
-- audit row for this table to carry NULL — an audit trail that cannot say which
-- row it is about. A fixed uuid keeps the trail honest, and the value is
-- deliberately not a random one: it ends in 28 so that anybody reading a
-- config_audit row can see which migration owns it.
--
-- src/api/jiraSettings.ts declares the same constant as JIRA_SETTINGS_ID and
-- SENDS it on every write rather than leaning on the default, so the two halves
-- name the same row in the same words and a drift is greppable.
--
--
-- ═══ status_map IS jsonb, AND IT IS DELIBERATELY NOT CONSTRAINED TO OUR THREE ══
--
-- `status_map` maps HIS status words to OUR three (`planned | testing | live`).
-- The keys are unbounded free text — words on his board that nobody on this
-- fleet has ever seen — so a child table would be a table whose whole content is
-- one person's vocabulary, and jsonb is the honest shape.
--
-- WHAT THIS FILE REFUSES TO DO IS CHECK THE VALUES. There is no
-- `check (... in ('planned','testing','live'))` below, and the omission is the
-- most consequential decision in the file:
--
--   * The coded-values report predicts the exact failure: "if the stage ladder
--     replaces the 3-status union, statusMap's value type changes and every
--     saved mapping is invalidated — statusMapConflicts() will not catch that,
--     because the KEYS still normalise fine."
--   * A CHECK can only REFUSE. On the day `UseCaseStatus` changes, a CHECK
--     written here makes the saved row unwritable — and, worse, makes the fix
--     ("open the screen and re-pick") impossible, because the screen's save
--     carries the whole map including the values it is trying to replace.
--   * A validator on the READ side can DROP AND COUNT. src/api/jiraSettings.ts
--     drops any value that is not one of ours, counts how many it dropped, and
--     the screen says so. Nothing is coerced into a neighbouring meaning, and
--     nothing is lost silently.
--
-- So the database checks the SHAPE (`jsonb_typeof(status_map) = 'object'` — an
-- array or a bare string here would make every reader's `Object.entries` a lie)
-- and leaves the VOCABULARY to the one layer that can degrade gracefully.
--
--
-- ═══ WHAT IS NOT IN THIS FILE, AND IS NOT AN OVERSIGHT ═══
--
-- NO SEED ROW. This file writes ZERO rows, and probe 1 asserts it. A seeded row
-- with `enabled = false` would be indistinguishable from a row the owner turned
-- off, and those are two different sentences on the Settings card — "not set up
-- yet" and "connected, then switched off". 0026's no-backfill argument, on a
-- table with one row: a default is a fact the database asserts that nobody
-- stated.
--
-- NO CREDENTIALS. `JIRA_BASE_URL`, `JIRA_EMAIL` and `JIRA_API_TOKEN` stay
-- secrets on the `jira-read` edge function and are never columns here.
-- `site_base_url` is NOT a credential — it is the public address used to build a
-- "view in Jira" href, and it is member-readable precisely because every member
-- who sees such a link needs it.
--
-- NO SYNC STATE. No `last_synced_at`, no `jira_sync_runs`, no cursor column.
-- This wave ships READING ONLY: no apply path, no scheduled sync, no entries
-- sync, and no node created from a Jira issue. A column for a sync that does not
-- exist would be the schema promising something the product refuses, and the
-- screens say so in words rather than leaving it to be inferred.
--
--
-- ═══ WHO MAY WRITE IT: structure.edit, and no new permission key ═══
--
-- Select is `is_member()`: every member's screens have to know whether Jira is
-- on, because that is what decides whether a "view in Jira" link exists at all.
-- Writes are `has_perm('structure.edit')` — the key that already gates
-- `map_nodes`, `map_node_kinds` and the Jira screen itself. A sixth permission
-- key would cost the 0025:436 catalogue CHECK, the roles.ts union, PERMISSIONS
-- meta, two locale keys, the CommandPalette map and an Admin seed grant — and
-- 0025's probe 1 refuses the migration if Admin holds fewer than five keys, so
-- the literal `5` would have to be edited too. There is no role that should
-- configure Jira and not be allowed to edit structure.
--
--
-- ═══ THE TOKEN CONTRACT WITH src/lib/pgError.ts ═══
--
-- This file raises no runtime tokens of its own — every refusal below is a
-- CONSTRAINT, and src/lib/pgError.ts matches constraint NAMES directly. Renaming
-- one here silently demotes a precise sentence to the generic `common.error`, so
-- this list is the handshake and both files are edited together:
--
--   jira_settings_pkey                → jiraconfig.errSingleton (23505)
--   jira_settings_singleton_chk       → jiraconfig.errSingleton (23514) — the
--                                       same sentence for both, deliberately:
--                                       "there is only one Jira configuration
--                                       and something tried to write a second"
--                                       is one fact, and which of the key or the
--                                       CHECK caught it is not the reader's
--                                       problem.
--   jira_settings_site_base_url_chk   → jiraconfig.errBadSiteUrl
--   jira_settings_field_len_chk       → jiraconfig.errFieldTooLong
--   jira_settings_jql_len_chk         → jiraconfig.errJqlTooLong
--   jira_settings_status_map_chk      → jiraconfig.errStatusMapShape
--
-- ⚠ THE SENTENCES MUST NOT ECHO THE VALUE. `jiraconfig.errBadSiteUrl` describes
--   the SHAPE a site address has to have and never repeats what was typed. That
--   is the same rule the `jira-read` function's own base-url refusal is being
--   hardened to this wave: a screen that helpfully prints back what it just
--   refused is a screen that prints secrets into a shared browser, a screenshot
--   and a support ticket the day somebody pastes the wrong thing into the wrong
--   box. pgError.ts returns KEYS and never interpolates, which is what makes the
--   rule hold here for free.
--
--
-- ═══ WHAT THIS FILE DOES NOT REDEFINE ═══
--
-- 0028 ADDS. `is_member()`, `has_perm()`, `log_config_audit()` and every policy
-- and function 0023/0024/0025/0026/0027 own are CALLED here and defined nowhere
-- here. That is what keeps 0025's probe 5 half A green and leaves the
-- `w_0025` / `f_0025` reversion canary in docs/PENDING-MIGRATIONS.md unchanged
-- after this file runs. Its table is new, so its policies are new.
--
--
-- ═══ APPLY IT TWICE, IN ONE SITTING ═══
--
-- Supabase Dashboard → SQL Editor → paste + Run. READ THE NOTICES. Then paste
-- and Run THE SAME FILE AGAIN, and read them again. The second run must be a
-- complete no-op that still passes every probe: the table create skips, every
-- column add skips, every constraint, policy and trigger is dropped and
-- recreated identically, and every function is replaced with itself. That is
-- what makes "apply it twice" a real test rather than a formality (0018:356).
--
-- Re-runnable from the top in any partial state, same discipline as 0001–0027:
-- `create table if not exists` PLUS a separate `add column if not exists` per
-- column, `drop constraint if exists` before every add, `drop policy if exists`
-- before every create, `drop trigger if exists` before every create, `create or
-- replace` on every function, and probe blocks at the bottom that roll their
-- fixtures back through the `OT028` sentinel. A probe failure raises and the
-- whole migration rolls back — no explicit begin/commit here, for the reason
-- 0009's header spells out.


-- ── preflight: 0001, 0002 and 0025 first ────────────────────────────────────
-- Every write policy below is written in terms of `public.has_perm()` (0025) and
-- every read in terms of `public.is_member()` (0001), and the audit trigger
-- calls `public.log_config_audit()` (0002). Without this block the first failure
-- is a bare 42883 from the middle of a CREATE POLICY, which reads like a broken
-- file rather than a missing prerequisite.
do $preflight$
begin
  if to_regprocedure('public.is_member()') is null then
    raise exception
      'NphiesCore 0028 CANNOT APPLY: public.is_member() does not exist. Apply 0001_opstrack_core.sql first.';
  end if;

  if to_regprocedure('public.has_perm(text)') is null then
    raise exception
      'NphiesCore 0028 CANNOT APPLY: public.has_perm(text) does not exist. Apply 0025_roles_permissions.sql first — the Jira configuration is written by whoever holds structure.edit, and without has_perm() there is no way to say that.';
  end if;

  if to_regprocedure('public.log_config_audit(text, uuid, text, jsonb, jsonb)') is null then
    raise exception
      'NphiesCore 0028 CANNOT APPLY: public.log_config_audit() does not exist. Apply 0002_config_foundation.sql first — this table IS configuration and is audited.';
  end if;
end
$preflight$;


-- ── jira_settings ───────────────────────────────────────────────────────────
-- One row. See the header for why the id is a fixed uuid rather than the text
-- 'jira' (config_audit.row_id is uuid) and why the CHECK and the primary key are
-- both needed.
--
-- THE THREE FIELD COLUMNS ARE `not null default ''`, NOT NULLABLE, and that is
-- `map_node_kinds.name_ar`'s contract rather than a preference: EMPTY means "not
-- chosen yet", which is the ordinary opening state of all three, and a nullable
-- column would give the client two ways to say it. `jiraSearchFields()`
-- (src/lib/jira/types.ts) already drops blanks, so a half-filled mapping sends a
-- short field list instead of `['']`.
--
-- `site_base_url` IS nullable, and it is the one column where null is the honest
-- answer: it is the address used to build a link, and "there is no link" is a
-- state the mapper already returns (`JiraFieldMapping.siteBaseUrl?: string |
-- null`). The CHECK is `map_nodes.external_url`'s verbatim (0023:423) so a value
-- that could never become a legal href cannot be stored here and then fail one
-- table over.
create table if not exists public.jira_settings (
  id                 uuid primary key default '00000000-0000-0000-0000-000000000028',
  site_base_url      text,
  organization_field text        not null default '',
  use_case_field     text        not null default '',
  status_field       text        not null default '',
  status_map         jsonb       not null default '{}'::jsonb,
  fold_arabic        boolean     not null default false,
  jql                text        not null default '',
  enabled            boolean     not null default false,
  updated_at         timestamptz not null default now(),
  updated_by         uuid references public.profiles (id) on delete set null
);

comment on table public.jira_settings is
  'The saved Jira reading configuration (0028) — ONE ROW, enforced by a checked singleton key. Member-read because every member''s screens need to know whether Jira is on; structure.edit-write; audited, because this is configuration. Holds NO credentials: JIRA_BASE_URL / JIRA_EMAIL / JIRA_API_TOKEN are secrets on the jira-read edge function. Holds NO sync state either — this wave reads only.';

comment on column public.jira_settings.enabled is
  'THE OFF-SWITCH, and it is off by default. False means every Jira surface OUTSIDE Settings renders nothing at all — absent, not disabled, because a disabled control is a promise. One client hook reads it (useJiraEnabled(), src/store/config.ts) so there is exactly one answer. The owner''s gate: "i can not connect the app to jira until we verify the tracker very well."';

comment on column public.jira_settings.status_map is
  'His status words → our three (planned | testing | live). DELIBERATELY UNCONSTRAINED ON VALUE: a CHECK could only refuse, and on the day UseCaseStatus changes it would make the saved row unwritable and the fix unreachable. src/api/jiraSettings.ts validates on READ instead — unknown values are DROPPED AND COUNTED, never coerced into a neighbouring meaning. The shape (an object) is checked here, because every reader''s Object.entries depends on it.';

comment on column public.jira_settings.site_base_url is
  'https://yoursite.atlassian.net — the PUBLIC address a "view in Jira" href is built from, not a credential. Null is legal and means "no links". The CHECK is map_nodes.external_url''s (0023:423), so a value that could never be a legal href is refused here rather than one table over.';

comment on column public.jira_settings.updated_by is
  'Who last saved this configuration. Server truth, resolved through profiles from auth.uid(), never a field the screen offers. NULL when the write had no JWT — the SQL Editor and the service role write honestly attributed to nobody.';

-- For a project where an earlier cut of this file already landed: `create table
-- if not exists` above is a no-op there, so the columns have to be added
-- separately or the constraints below fail against a table that lacks them.
-- Same reasoning as 0017:129, 0018:136 and 0026:354.
alter table public.jira_settings add column if not exists site_base_url      text;
alter table public.jira_settings add column if not exists organization_field text        not null default '';
alter table public.jira_settings add column if not exists use_case_field     text        not null default '';
alter table public.jira_settings add column if not exists status_field       text        not null default '';
alter table public.jira_settings add column if not exists status_map         jsonb       not null default '{}'::jsonb;
alter table public.jira_settings add column if not exists fold_arabic        boolean     not null default false;
alter table public.jira_settings add column if not exists jql                text        not null default '';
alter table public.jira_settings add column if not exists enabled            boolean     not null default false;
alter table public.jira_settings add column if not exists updated_at         timestamptz not null default now();
alter table public.jira_settings add column if not exists updated_by         uuid references public.profiles (id) on delete set null;

-- THE SINGLETON. Half of the rule; the primary key is the other half.
alter table public.jira_settings drop constraint if exists jira_settings_singleton_chk;
alter table public.jira_settings add constraint jira_settings_singleton_chk
  check (id = '00000000-0000-0000-0000-000000000028'::uuid);

-- map_nodes_external_url_chk's form and its reason (0023:423): `external_url` on
-- two other tables carries the same test, and a base URL that cannot produce a
-- legal href is refused where it is TYPED rather than where it is used.
alter table public.jira_settings drop constraint if exists jira_settings_site_base_url_chk;
alter table public.jira_settings add constraint jira_settings_site_base_url_chk
  check (site_base_url is null or site_base_url ~* '^https?://');

-- A Jira field id is `summary`, `status` or `customfield_10050`. 120 is roomy
-- for every shape Atlassian mints and small enough that a pasted paragraph is
-- refused with a sentence instead of being stored and then sent in a query
-- string. btrim before measuring, for map_node_stages_name_len_chk's reason:
-- '   ' is an empty field id wearing a hat.
alter table public.jira_settings drop constraint if exists jira_settings_field_len_chk;
alter table public.jira_settings add constraint jira_settings_field_len_chk
  check (char_length(btrim(organization_field)) <= 120
     and char_length(btrim(use_case_field))     <= 120
     and char_length(btrim(status_field))       <= 120);

-- JQL is a query a person types, and a long one is legitimate — a list of thirty
-- project keys is ordinary. 4000 is a bound against a paste accident, not a
-- style rule.
alter table public.jira_settings drop constraint if exists jira_settings_jql_len_chk;
alter table public.jira_settings add constraint jira_settings_jql_len_chk
  check (char_length(jql) <= 4000);

-- SHAPE ONLY. See the header: the VALUES are validated on read, dropped and
-- counted. An array or a bare string here would make every reader's
-- Object.entries() a lie, and that is not a vocabulary question.
alter table public.jira_settings drop constraint if exists jira_settings_status_map_chk;
alter table public.jira_settings add constraint jira_settings_status_map_chk
  check (jsonb_typeof(status_map) = 'object');

alter table public.jira_settings enable row level security;

-- MEMBER READ, structure.edit WRITE — and both halves are deliberate.
--
-- Read must be member-wide. The off-switch is only meaningful if every screen
-- can ask it: a member whose read of this table is refused would get `enabled`
-- unknown, and an unknown off-switch has to fail closed, which means a member
-- would never see a "view in Jira" link the owner had deliberately turned on.
-- Nothing here is a secret (see the header).
--
-- Every predicate is in 0009's InitPlan form `(select public.is_member())` /
-- `(select public.has_perm(...))` so it is evaluated ONCE PER STATEMENT rather
-- than once per surviving row. One row makes that academic; writing it the other
-- way would make this the one table in the schema somebody has to find and fix
-- later.
drop policy if exists jira_settings_select on public.jira_settings;
create policy jira_settings_select on public.jira_settings
  for select using ((select public.is_member()));

drop policy if exists jira_settings_insert on public.jira_settings;
create policy jira_settings_insert on public.jira_settings
  for insert with check ((select public.has_perm('structure.edit')));

drop policy if exists jira_settings_update on public.jira_settings;
create policy jira_settings_update on public.jira_settings
  for update using ((select public.has_perm('structure.edit')))
  with check ((select public.has_perm('structure.edit')));

drop policy if exists jira_settings_delete on public.jira_settings;
create policy jira_settings_delete on public.jira_settings
  for delete using ((select public.has_perm('structure.edit')));

-- Explicit rather than relying on Supabase's default privileges for new tables
-- in `public`; `anon` is left exactly as the project's defaults have it, matching
-- every other table since 0002, and cannot pass is_member() in any case.
grant select, insert, update, delete on public.jira_settings to authenticated;


-- ── touch: updated_at / updated_by, diffed, with the else arm pinning ───────
-- BEFORE INSERT OR UPDATE. `map_node_progress_touch()`'s shape (0026:847) and
-- its reasons, one table over:
--
--   * INSERT stamps both, because the common case here is a row written once and
--     edited months later — with an update-only touch, "who set this up?" would
--     be unanswerable for exactly the row this table is made of.
--   * `updated_by` is SERVER TRUTH about the write, never a field the screen
--     offers, and is resolved THROUGH profiles for vocab_touch()'s FK reason: an
--     auth user with no profile row would violate the FK from inside a trigger
--     and roll back a legitimate save rather than merely losing an attribution.
--   * The JWT-less passthrough is the schema's own: the SQL Editor and the
--     service role must be able to write rows honestly attributed to nobody.
--   * The UPDATE arm is DIFFED, subtracting only the two columns it writes
--     itself, so a save that changed nothing does not move `updated_at` — and,
--     because the audit trigger below compares the FULL row images, does not
--     write a config_audit row recording that nothing happened either.
--   * THE ELSE ARM PINS BOTH COLUMNS BACK. Without it a client could move
--     `updated_at` by sending one on a write that changed nothing else, which is
--     a lie about when the configuration was last touched — and this screen's
--     save sends the whole row it read, which is precisely the shape that does
--     it. Probe 2 asserts the pin.
create or replace function public.jira_settings_touch()
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

drop trigger if exists jira_settings_touch_trg on public.jira_settings;
create trigger jira_settings_touch_trg
  before insert or update on public.jira_settings
  for each row execute function public.jira_settings_touch();


-- ── audit: this IS configuration ────────────────────────────────────────────
-- AFTER, not BEFORE: the row image recorded must be the one that survived every
-- other trigger and constraint. Identical in shape to map_node_stages_audit()
-- (0026:507).
--
-- WHY THIS TABLE IS AUDITED WHEN map_node_progress IS NOT. Turning `enabled` on
-- changes what every member sees on every screen; changing `status_map` changes
-- what a Jira status MEANS here, retroactively, for every preview anybody runs
-- afterwards. That is the class of change made by one person with nobody
-- watching, which is exactly what config_audit exists for — and there is at most
-- one row, so the trail can never be dominated by routine data entry, which is
-- the argument that keeps the audit OFF map_node_progress.
--
-- The UPDATE arm compares the FULL row images with nothing subtracted, which is
-- safe because the touch trigger above ran first (BEFORE beats AFTER regardless
-- of names) and only moved `updated_at` if something else had already changed.
-- A save that changed nothing therefore writes no audit row — asserted by
-- probe 2, not assumed.
create or replace function public.jira_settings_audit()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    -- Casts on the null: with a single candidate Postgres resolves an untyped
    -- null anyway, but an overload added later would make this ambiguous at
    -- runtime, inside a trigger, on someone else's write.
    perform public.log_config_audit('jira_settings', new.id, 'insert', null::jsonb, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    if to_jsonb(new) is distinct from to_jsonb(old) then
      perform public.log_config_audit('jira_settings', new.id, 'update', to_jsonb(old), to_jsonb(new));
    end if;
    return new;
  else
    perform public.log_config_audit('jira_settings', old.id, 'delete', to_jsonb(old), null::jsonb);
    return old;
  end if;
end;
$$;

drop trigger if exists jira_settings_audit_trg on public.jira_settings;
create trigger jira_settings_audit_trg
  after insert or update or delete on public.jira_settings
  for each row execute function public.jira_settings_audit();


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
--   probe here can observe a timestamp MOVING between two writes. The probes
--   therefore assert the strictly stronger thing that IS observable inside one
--   transaction: that a value the CLIENT supplied did not survive, and that the
--   trigger's own value is what came back. 0026:893 states the same limit for
--   the same reason.
--
-- ⚠ THE FIXTURE ROW AND THE SINGLETON. This table holds at most one row, so a
--   probe cannot add its own beside a real one. Every fixture block therefore
--   DELETES whatever is there first and inserts its own — inside the OT028
--   subtransaction, which rolls the delete back with everything else. Nothing
--   below ever commits, and a workspace that had a saved configuration before
--   this file ran still has exactly that configuration afterwards. Probe 1's
--   final assertion is the belt: this file wrote no rows.


-- ── probe 1: the shape landed, including the two halves of "one row" ────────
-- Runs as whoever applies the file (the SQL Editor, i.e. no JWT). This probe
-- tests STRUCTURE; RLS is probe 3's job.
do $shape$
declare
  v_default    text;
  v_touch_def  text;
  v_audit_def  text;
  v_sel        text;
  v_ins        text;
  v_upd        text;
  v_del        text;
  v_second     boolean := false;
  v_bad_url    boolean := false;
  v_bad_map    boolean := false;
  v_rows       int;
  v_written    int;
begin
  if to_regclass('public.jira_settings') is null then
    raise exception 'NphiesCore 0028 FAILED: public.jira_settings does not exist.';
  end if;

  -- ── the off-switch is OFF, read out of the catalog rather than trusted ──
  -- THE SINGLE MOST IMPORTANT LINE IN THIS FILE. `default true` here would ship
  -- a workspace where every Jira surface is live the moment the table exists —
  -- against the owner's explicit gate — and it would look exactly like this file
  -- does at a glance.
  select pg_get_expr(d.adbin, d.adrelid) into v_default
    from pg_attrdef d
    join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
   where d.adrelid = 'public.jira_settings'::regclass and a.attname = 'enabled';

  if v_default is null or position('false' in lower(v_default)) = 0 then
    raise exception
      'NphiesCore 0028 FAILED: jira_settings.enabled does not default to false (its default is %). The whole point of this file is that Jira is INVISIBLE until somebody turns it on: "i can not connect the app to jira until we verify the tracker very well."',
      coalesce(v_default, '(none)');
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.jira_settings'::regclass
       and conname = 'jira_settings_singleton_chk'
  ) then
    raise exception
      'NphiesCore 0028 FAILED: jira_settings_singleton_chk is missing. The primary key alone stops a SECOND row with the same id and does nothing at all about a second row with a different one, after which every read has to decide which of two configurations is the truth.';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.jira_settings'::regclass
       and conname = 'jira_settings_status_map_chk'
  ) then
    raise exception
      'NphiesCore 0028 FAILED: jira_settings_status_map_chk is missing. status_map must be an OBJECT — an array or a bare string there makes every reader''s Object.entries() a lie. (The VALUES are deliberately unconstrained; src/api/jiraSettings.ts drops and counts the unknown ones. See the header.)';
  end if;

  -- ── the two triggers ──
  select pg_get_triggerdef(t.oid) into v_touch_def
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where c.relname = 'jira_settings' and t.tgname = 'jira_settings_touch_trg';

  if v_touch_def is null
     or position('BEFORE INSERT OR UPDATE' in upper(v_touch_def)) = 0
     or position('FOR EACH ROW' in upper(v_touch_def)) = 0 then
    raise exception
      'NphiesCore 0028 FAILED: jira_settings_touch_trg is missing or is not BEFORE INSERT OR UPDATE FOR EACH ROW (it is: %). updated_at/updated_by would then be whatever the client sent, and "who turned Jira on, and when" would be unanswerable.',
      coalesce(v_touch_def, '(absent)');
  end if;

  select pg_get_triggerdef(t.oid) into v_audit_def
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where c.relname = 'jira_settings' and t.tgname = 'jira_settings_audit_trg';

  if v_audit_def is null
     or position('AFTER INSERT OR UPDATE OR DELETE' in upper(v_audit_def)) = 0 then
    raise exception
      'NphiesCore 0028 FAILED: jira_settings_audit_trg is missing or is not AFTER INSERT OR UPDATE OR DELETE (it is: %). Turning Jira on changes what every member sees on every screen; with no trail there is no record of who did it.',
      coalesce(v_audit_def, '(absent)');
  end if;

  -- ── the four policies, by predicate ──
  -- Read out of pg_policies and MATCHED, because a copy-paste that gated the
  -- select on structure.edit (a member then never sees a link the owner turned
  -- on) or the update on is_member() (any member can re-point the workspace at
  -- another Jira site) is invisible to every other check in this file.
  select coalesce(qual, '') into v_sel from pg_policies
   where schemaname = 'public' and tablename = 'jira_settings' and policyname = 'jira_settings_select';
  select coalesce(with_check, '') into v_ins from pg_policies
   where schemaname = 'public' and tablename = 'jira_settings' and policyname = 'jira_settings_insert';
  select coalesce(qual, '') || ' ' || coalesce(with_check, '') into v_upd from pg_policies
   where schemaname = 'public' and tablename = 'jira_settings' and policyname = 'jira_settings_update';
  select coalesce(qual, '') into v_del from pg_policies
   where schemaname = 'public' and tablename = 'jira_settings' and policyname = 'jira_settings_delete';

  if v_sel is null or position('is_member' in v_sel) = 0 then
    raise exception
      'NphiesCore 0028 FAILED: jira_settings_select does not read is_member() (it is: %). Every member''s screens have to be able to ask whether Jira is on.',
      coalesce(v_sel, '(absent)');
  end if;

  if v_ins is null or position('structure.edit' in v_ins) = 0
     or v_upd is null or position('structure.edit' in v_upd) = 0
     or v_del is null or position('structure.edit' in v_del) = 0 then
    raise exception
      'NphiesCore 0028 FAILED: one of the three write policies does not name structure.edit (insert: %, update: %, delete: %). A member who can write this row can re-point the workspace at a different Jira site.',
      coalesce(v_ins, '(absent)'), coalesce(v_upd, '(absent)'), coalesce(v_del, '(absent)');
  end if;

  -- ── the refusals, exercised rather than read ──
  -- All three inside one subtransaction that is rolled back; the delete at the
  -- top of it is what makes the block work on a workspace that already holds a
  -- saved configuration, and it is rolled back with everything else.
  select count(*) into v_rows from public.jira_settings;

  begin
    delete from public.jira_settings;

    insert into public.jira_settings (id) values ('00000000-0000-0000-0000-000000000028');

    -- A SECOND ROW, with a different id: the CHECK must refuse it. The primary
    -- key cannot, which is the whole reason the CHECK is there.
    begin
      insert into public.jira_settings (id) values ('00000000-0000-0000-0000-000000000029');
      v_second := true;
    exception when check_violation or unique_violation then
      null;  -- as intended
    end;

    -- A base URL that could never become a legal href.
    begin
      update public.jira_settings set site_base_url = 'yoursite.atlassian.net';
      v_bad_url := true;
    exception when check_violation then
      null;  -- as intended
    end;

    -- status_map as an ARRAY. The shape check, not a vocabulary check: a value
    -- of 'nonsense' is DELIBERATELY accepted here and dropped on read.
    begin
      update public.jira_settings set status_map = '[]'::jsonb;
      v_bad_map := true;
    exception when check_violation then
      null;  -- as intended
    end;

    raise exception using errcode = 'OT028', message = 'probe rollback';
  exception
    when sqlstate 'OT028' then
      null;
  end;

  if v_second then
    raise exception
      'NphiesCore 0028 FAILED: a SECOND jira_settings row was accepted. jira_settings_singleton_chk is not doing its job, and two configurations means every read has to guess which one the workspace means.';
  end if;

  if v_bad_url then
    raise exception
      'NphiesCore 0028 FAILED: a site_base_url with no scheme was accepted. It is the address a "view in Jira" href is built from; stored like that it becomes a RELATIVE link inside this app, which navigates the reader somewhere that does not exist and looks like the app is broken.';
  end if;

  if v_bad_map then
    raise exception
      'NphiesCore 0028 FAILED: a status_map that is not an object was accepted. Every reader iterates it with Object.entries(); an array there is a silently empty mapping and every issue reports as "status not mapped".';
  end if;

  -- ── this file wrote NO rows ──
  -- Every fixture above lives inside a rolled-back subtransaction, and there is
  -- no seed. A row seeded here with enabled=false would be indistinguishable
  -- from a row the owner turned off, and those are two different sentences on
  -- the Settings card. If an `insert` is ever added above, this fails.
  select count(*) into v_written from public.jira_settings;

  if v_written <> v_rows then
    raise exception
      'NphiesCore 0028 FAILED: this migration changed the jira_settings row count from % to %. It must write NOTHING: "not set up yet" and "set up, then switched off" are two different sentences on the Settings card, and a seeded row destroys the difference.',
      v_rows, v_written;
  end if;

  raise notice
    'NphiesCore 0028 probe 1: jira_settings exists, enabled defaults to FALSE, the singleton CHECK refused a second row, a scheme-less site_base_url and a non-object status_map were both refused, both triggers are installed with the right timing, all four policies name the right predicate (select=is_member, writes=structure.edit), and this file wrote 0 rows (% present before and after).',
    v_rows;
end
$shape$;


-- ── probe 2: the touch is the only writer, and a no-op save is inert ────────
-- Three claims that cannot be verified by reading the file:
--
--   (a) a client-supplied `updated_at` does not survive — on insert, on a real
--       change, or on a save that changed nothing. The screen's save sends the
--       whole row it read, so this is the ordinary path and not an edge case.
--   (b) a save that changed nothing writes NO config_audit row. Without the
--       diff, opening the Jira screen and pressing Save twice would fill the
--       configuration trail with rows recording that nothing happened, which is
--       how an audit log stops being read.
--   (c) a real change DOES write exactly one.
--
-- Everything is rolled back through the OT028 sentinel, the pre-existing row
-- included.
do $touch$
declare
  v_bogus     timestamptz := timestamptz '2001-09-09 01:46:40+00';
  v_updated   timestamptz;
  v_audit0    int;
  v_audit_ins int := 0;
  v_audit_noop int := 0;
  v_audit_real int := 0;
  v_pinned    boolean := false;
begin
  select count(*) into v_audit0 from public.config_audit where table_name = 'jira_settings';

  begin
    delete from public.jira_settings;

    -- ── (a) INSERT: the client's timestamp is overruled ──
    insert into public.jira_settings (id, jql, updated_at)
      values ('00000000-0000-0000-0000-000000000028', 'project = NPH', v_bogus);

    select updated_at into v_updated from public.jira_settings;

    if v_updated = v_bogus then
      raise exception
        'NphiesCore 0028 FAILED: the updated_at the client sent (%) survived the INSERT. jira_settings_touch() is supposed to own that column; as it stands, "when was this configuration last saved" is whatever the last request happened to contain.',
        v_bogus;
    end if;

    if v_updated is distinct from now() then
      raise exception
        'NphiesCore 0028 FAILED: updated_at came back as % on insert, expected now() (%). The touch trigger''s INSERT arm did not run.',
        v_updated, now();
    end if;

    select count(*) - v_audit0 into v_audit_ins
      from public.config_audit where table_name = 'jira_settings';

    -- ── (b) THE NO-OP SAVE: same values, plus a bogus updated_at ──
    -- Byte-for-byte what a save-on-blur screen sends when nothing was edited.
    update public.jira_settings
       set jql = 'project = NPH', updated_at = v_bogus
     where id = '00000000-0000-0000-0000-000000000028';

    select updated_at into v_updated from public.jira_settings;
    v_pinned := (v_updated is not distinct from now()) and (v_updated <> v_bogus);

    select count(*) - v_audit0 - v_audit_ins into v_audit_noop
      from public.config_audit where table_name = 'jira_settings';

    -- ── (c) A REAL CHANGE: the switch goes on ──
    update public.jira_settings
       set enabled = true
     where id = '00000000-0000-0000-0000-000000000028';

    select count(*) - v_audit0 - v_audit_ins - v_audit_noop into v_audit_real
      from public.config_audit where table_name = 'jira_settings';

    raise exception using errcode = 'OT028', message = 'probe rollback';
  exception
    when sqlstate 'OT028' then
      null;
  end;

  if v_audit_ins <> 1 then
    raise exception
      'NphiesCore 0028 FAILED: creating the configuration row wrote % config_audit rows, expected exactly 1. This table IS configuration: turning Jira on changes what every member sees on every screen, and `before`/`after` is the only record of what it used to say.',
      v_audit_ins;
  end if;

  if not v_pinned then
    raise exception
      'NphiesCore 0028 FAILED: a save that changed nothing moved updated_at (or accepted the client''s value). The else arm of jira_settings_touch() must pin updated_at and updated_by back to their old values — the Jira screen saves the whole row it read, so this is the ordinary path.';
  end if;

  if v_audit_noop <> 0 then
    raise exception
      'NphiesCore 0028 FAILED: a save that changed nothing wrote % config_audit rows, expected 0. The trail would fill with rows recording that nothing happened, which is how an audit log stops being read.',
      v_audit_noop;
  end if;

  if v_audit_real <> 1 then
    raise exception
      'NphiesCore 0028 FAILED: turning `enabled` on wrote % config_audit rows, expected exactly 1. That single boolean decides whether every Jira surface in the app exists; it is the one change in this table that most needs a name against it.',
      v_audit_real;
  end if;

  raise notice
    'NphiesCore 0028 probe 2: the touch overruled a client-supplied updated_at on insert and on a no-op save, the no-op wrote 0 audit rows, the insert wrote 1 and turning the switch on wrote 1. Rolled back.';
end
$touch$;


-- ── probe 3: a member reads the switch and cannot flip it ───────────────────
-- The claim the permission design rests on, and the one that cannot be verified
-- by reading the file. Both halves fail in opposite directions and both are
-- asserted:
--
--   * a member who CANNOT READ this row cannot be told whether Jira is on, and
--     the off-switch has to fail closed — so a link the owner deliberately
--     enabled would be invisible to the people it is for;
--   * a member who CAN WRITE it can re-point the workspace at another Jira site,
--     or switch the whole integration on, from a screen they were never offered.
--
-- The Director arm doubles as the check that the audit trigger's own guard has
-- not narrowed: a structure.edit holder who is NOT an admin must be able to
-- write, and that write goes through jira_settings_audit_trg →
-- log_config_audit(), whose guard (0025:1847) is the thing in the way.
--
-- The skip test is SCOPED TO THE ROLE SWITCH ALONE (0018:559's lesson): a broken
-- INSERT policy raises 42501 too, and wrapping the whole client half would
-- report a real failure as "skipped".
do $rls$
declare
  v_dir         uuid := gen_random_uuid();
  v_member      uuid := gen_random_uuid();
  v_dir_role    uuid;
  v_read        int  := 0;
  v_dir_write   boolean := false;
  v_mem_wrote   boolean := false;
  v_skipped     boolean := false;
  v_no_dir_role boolean := false;
begin
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
      (v_dir,    'probe-dir-'    || v_dir    || '@0028.invalid',
       jsonb_build_object('display_name', '0028 Probe Director')),
      (v_member, 'probe-member-' || v_member || '@0028.invalid',
       jsonb_build_object('display_name', '0028 Probe Member'));

    if (select count(*) from public.profiles where id in (v_dir, v_member)) <> 2 then
      raise exception 'NphiesCore 0028 PROBE 3 SETUP FAILED: handle_new_user() did not create the fixture profiles.';
    end if;

    -- No JWT yet, so guard_profile_role() lets this through: the privileged path
    -- the SQL Editor and the edge function use.
    if not v_no_dir_role then
      update public.profiles set role_id = v_dir_role where id = v_dir;
    end if;

    -- The fixture row, written as the applying role. The delete is what makes
    -- this work against a workspace that already holds a saved configuration,
    -- and it rolls back with everything else.
    delete from public.jira_settings;
    insert into public.jira_settings (id, enabled)
      values ('00000000-0000-0000-0000-000000000028', true);

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
        -- The controls that stop this arm passing because the fixture had no
        -- permissions rather than because the policy is right (0025's probe 5).
        if not public.has_perm('structure.edit') then
          raise exception
            'NphiesCore 0028 PROBE 3 SETUP FAILED: the fixture Director does not resolve to structure.edit, so nothing asserted below would mean anything.';
        end if;
        if public.is_admin() then
          raise exception
            'NphiesCore 0028 PROBE 3 SETUP FAILED: the fixture Director resolves to workspace.admin. The probe would then prove only that an admin can do anything.';
        end if;

        update public.jira_settings set jql = 'project = DIR';
        if found then v_dir_write := true; end if;
      end if;

      -- ── as a plain member ──
      perform set_config('request.jwt.claims',
                         json_build_object('sub', v_member, 'role', 'authenticated')::text, true);

      select count(*) into v_read from public.jira_settings;

      -- A blocked UPDATE/DELETE affects zero rows rather than raising, which is
      -- the whole reason src/lib/permissions.ts exists. Count rows, do not
      -- catch. `enabled` is the column deliberately targeted: it is the one a
      -- wrongly-open policy would let any member flip for everybody.
      update public.jira_settings set enabled = false;
      if found then v_mem_wrote := true; end if;

      delete from public.jira_settings;
      if found then v_mem_wrote := true; end if;

      reset role;
    end if;

    raise exception using errcode = 'OT028', message = 'probe rollback';
  exception
    when sqlstate 'OT028' then
      null;
  end;

  if v_skipped then
    raise notice
      'NphiesCore 0028 probe 3 SKIPPED: this role cannot `set role authenticated`, so the RLS half could not run. The policies ARE installed and probe 1 read all four predicates out of pg_policies. Verify by hand: sign in as a plain member and PATCH /rest/v1/jira_settings (must affect zero rows) and GET it (must return the row).';
    return;
  end if;

  if v_read <> 1 then
    raise exception
      'NphiesCore 0028 FAILED: a plain member read % jira_settings rows, expected 1. jira_settings_select is too strict — the off-switch fails CLOSED, so a member who cannot read this row never sees a "view in Jira" link the owner deliberately turned on, and nothing on screen explains why.',
      v_read;
  end if;

  if v_mem_wrote then
    raise exception
      'NphiesCore 0028 FAILED: a plain member wrote jira_settings. That row decides which Jira site this workspace points at and whether the integration is on at all for everybody; it is structure.edit''s, like the tree and the kind catalogue.';
  end if;

  if v_no_dir_role then
    raise notice
      'NphiesCore 0028 probe 3 PARTIAL: a member could read the row and could not write it, but this workspace has no role holding structure.edit WITHOUT workspace.admin, so the Director half could not be exercised. Verify by hand after granting one.';
    return;
  end if;

  if not v_dir_write then
    raise exception
      'NphiesCore 0028 FAILED: a structure.edit holder who is not an admin could NOT write jira_settings. Either jira_settings_update is wrong, or log_config_audit()''s guard has narrowed back to is_admin() — in which case the Director''s legitimate save is refused with a 42501 blamed on the wrong thing.';
  end if;

  raise notice
    'NphiesCore 0028 probe 3: a plain member read the row (1) and could neither update nor delete it; a structure.edit holder who is not an admin saved it. Fixtures rolled back.';
end
$rls$;
