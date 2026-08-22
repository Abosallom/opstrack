-- 0030 — how the map draws, in one row the workspace agrees on.
--
-- WHAT THIS IS
-- The mind map has a shape, and every number in that shape is currently a
-- CONSTANT compiled into the bundle: `DEFAULT_NODE_SIZE` 168x44
-- (src/lib/mindtree/layout.ts:352), `DEFAULT_GAP` 56/12 (:359), `OPEN_DEPTH = 1`
-- (src/pages/map/useMapModel.ts:459), `OUTSIDE_LABEL_BUDGET = 14`
-- (src/components/mindtree/MindNode.tsx:525). They are good numbers. They are
-- also somebody's numbers, chosen once, and the workspace that has to read four
-- hundred organizations on a projector in a meeting room has no way to say so
-- except by asking for a build. This file gives those numbers one row to live in
-- so that the answer to "can we open it two levels deep by default" is a save
-- rather than a release.
--
-- It ships the TABLE only. No client reads it yet, and that is deliberate rather
-- than unfinished — see WHAT IS NOT IN THIS FILE and THE CLIENT HALF, both
-- below. Applied on its own, this file changes NOTHING a reader can see: the map
-- draws exactly as it does today, out of the same constants, because nothing
-- asks the table anything.
--
--
-- ═══ WHAT IT DEPENDS ON, WHICH IS LESS THAN ITS NUMBER SUGGESTS ═══
--
-- ⚠ THIS FILE DEPENDS ONLY ON 0001, 0002 AND 0025, NEVER ON 0026-0029, so its
--   position in the order is convenience, not a constraint. 0029:411 states the
--   same thing about itself and for the same reason: at the time of writing
--   0026, 0027, 0028 and 0029 have NEVER been run against any database — every
--   object they own answers 404 on the live project, re-probed 21 August 2026
--   (docs/PENDING-MIGRATIONS.md:22-31, docs/OWNER-PLAYBOOK.md:17). A file
--   numbered 0030 that preflight-checked for 0026's tables would be a file that
--   cannot apply to the project that actually exists.
--
-- So the preflight below names exactly the three functions this file CALLS —
-- `is_member()` (0001), `has_perm(text)` (0025), `log_config_audit(...)` (0002)
-- — and nothing else. Its table is new, it references `profiles` (0001) and
-- nothing further, and it redefines no object any other file owns. That is what
-- keeps 0025's probe 5 half A green and leaves the `w_0025` / `f_0025` reversion
-- canary in docs/PENDING-MIGRATIONS.md unmoved after this file runs.
--
--
-- ═══ DEBTS THIS FILE DOES NOT PAY ═══
--
-- 0029's header assigned a task to "0030" BY NUMBER, and this file is not it.
-- `map_node_use_cases_touch()` (0024:527-534) pins `created_by` and the else
-- arm's `updated_by` FLAT — FIX-BACKLOG R2-DB-1, the defect 0015 and 0019 fixed
-- on `entries` and 0029's own `map_node_branches_touch()` fixes with 0015:206's
-- `case`. 0024 IS APPLIED LIVE, so retiring a member today leaves
-- `map_node_use_cases` rows pointing at a profile that no longer exists. It is
-- real and it is still owed.
--
-- IT IS NOT OWED BY THIS FILE. A settings table for the map's drawing and a
-- restatement of a live trigger on the use-case join table share no object, no
-- subject and no reason to be applied together — and restating a live function
-- from a file whose subject is a different table is precisely the mixing 0029
-- refuses to do, for the reason a 0023/0024 re-run strips the Director role of
-- the whole tree. Bundling it here would also make THIS file unsafe to re-run
-- after some later wave touches that trigger, which is the property the whole
-- schema is built on.
--
-- ⚠ SO THE DEBT IS REASSIGNED, NOT DROPPED. 0029:333-348 has been edited in the
--   same commit as this file: it now names 0031 as the file that restates
--   `map_node_use_cases_touch()` with the `case` and the third branch and probes
--   it the way 0029's probe 5 probes `map_node_branches`. That is a comment-only
--   edit to a migration that has never been applied, so it changes no database
--   anywhere and cannot change one later. `map_node_goals_touch()` (0027:485,
--   0027:500) and `map_node_progress_touch()` (0026:871, the `updated_by` half
--   only — that table has no `created_by`) carry the same defect and both files
--   are still unapplied, so whoever runs them next fixes those in place.
--
--
-- ═══ ONE ROW, AND THE ONE-ROW-NESS IS CHECKED RATHER THAN HOPED FOR ═══
--
-- This is 0028:27-68's argument, applied to a table with an even stronger claim
-- on it: there is one map. Two rows here would not merely make a read ambiguous,
-- they would let two readers of the same workspace disagree about the geometry
-- of the same drawing while both believing they are looking at the shared one.
--
-- So "one row" is a RULE, and a rule nothing enforces is a comment. The
-- enforcement is a CHECKED SINGLETON KEY:
--
--     id uuid primary key
--        default '00000000-0000-0000-0000-000000000030'
--        check   (id = '00000000-0000-0000-0000-000000000030')
--
-- The primary key makes a second row with THAT id impossible; the CHECK makes a
-- second row with ANY OTHER id impossible. Neither half is redundant, and
-- probe 1 exercises the half that is easy to believe is redundant — an INSERT of
-- a row ending `…0031`, which the primary key cannot refuse and the CHECK must.
--
-- THE ID IS A UUID AND NOT THE TEXT 'map'. `config_audit.row_id` is `uuid`
-- (0002:290), so a text key would force every audit row for this table to carry
-- NULL — an audit trail that cannot say which row it is about. The value is not
-- random: it ends in 30 so anybody reading a `config_audit` row can see which
-- migration owns it, exactly as 0028's ends in 28. The client half declares the
-- same constant and SENDS it on every write rather than leaning on the default,
-- so the two halves name the same row in the same words and a drift is greppable.
--
--
-- ═══ THE CHECK ASYMMETRY: FOUR CLOSED UNIONS AND ONE OPEN OBJECT ═══
--
-- This file both DOES and DOES NOT do the thing 0028:71-97 argues against, and
-- the line between the two cases is the most consequential decision in it.
--
-- `node_fields` IS 0028's `status_map`. Its keys are drawing kinds and its
-- values are field names that a future screen offers, a future screen renames,
-- and a future wave adds to. A CHECK on that vocabulary could only REFUSE, and
-- the day the field list changes it makes the saved row UNWRITABLE — and, worse,
-- makes the fix ("open the screen and re-pick") impossible, because the screen's
-- save carries the whole object including the entries it is trying to replace.
-- So the DATABASE checks the shape (`jsonb_typeof(node_fields) = 'object'`) and
-- the CLIENT checks the vocabulary, dropping and counting what it does not know,
-- which is the one layer that can degrade gracefully.
--
-- `layout`, `grouping`, `sibling_sort` and `colour_by` ARE CHECKED, and they are
-- the OPPOSITE of `status_map` rather than an inconsistency with it. They are
-- CLOSED UNIONS THIS REPO OWNS, in this repo's own source, and nobody outside it
-- can mint a member:
--
--   * `grouping`'s five values are `MIND_GROUPINGS` (model.ts:163-170) verbatim
--     — a frozen array with an `isMindGrouping()` guard beside it.
--   * `sibling_sort`'s two are the only two orders the model can produce.
--   * `layout`'s three are the three drawings that exist: the linear tidy tree,
--     the concentric one, and the containment canvas the map draws with today.
--
-- A value outside those sets is not "a vocabulary this file does not know". It
-- is a value NO code path can render, and the honest place to refuse it is where
-- it is typed. The set widens in the migration that ships the new member, which
-- is the same migration that ships the code able to draw it — one commit, one
-- CHECK, one union, no window in which the database holds a word the bundle
-- cannot honour.
--
-- ⚠ TWO DEBTS THE CLIENT HALF OWES BECAUSE OF THIS, and both are the kind that
--   is discovered in production if they are not written down here:
--
--   ① A GUARD IS STILL NEEDED ON READ. A CHECK constrains what the database
--      accepts; it says nothing about what a client ONE DEPLOY OLDER can draw.
--      Widen the CHECK, save `layout = 'atlas'`, and every phone that has not
--      reloaded reads a word its `MindLayout` union does not contain. The read
--      side needs an `isMapLayout()`-shaped guard that falls back to the default
--      rather than trusting the column — `isMindGrouping()` (model.ts:171-183)
--      is the pattern and its doc comment is the argument.
--   ② `?by=phase` MUST NEVER BE FORWARDED INTO `grouping`. `PortfolioBy`
--      (lib/mindtree/lens.ts:264) is `stage | manager | vendor | phase` and
--      `MindGrouping` is `none | stage | manager | type | vendor`. THE TWO
--      UNIONS ARE NOT EQUAL and they share a URL parameter. model.ts:171-183
--      already spells out why a canvas reading `?by=phase` degrades to the
--      default instead of rendering an empty axis. A client half that saves the
--      lens's value straight into this column turns that graceful degradation
--      into a 23514 on the save button.
--
--
-- ═══ colour_by CHECKS A SET OF ONE, ON PURPOSE ═══
--
-- 0023:49-55 is open on the desk while this column is written, because it reads
-- like a refusal of exactly this:
--
--     "NO COLOUR COLUMN on `map_node_kinds`. src/lib/mindtree/model.ts's header
--      is explicit — 'COLOUR IS INHERITED, NEVER PICKED' — and the map has
--      already spent its two visual variables (size-for-count, and the breach
--      mark). A kind colour would be a third, competing with the track colour
--      every node inside it already wears. If you are here to add one: the
--      answer is no, and the reason is that the reader cannot decode three
--      simultaneous encodings on one glyph."
--
-- The answer is that this is NOT a colour column, and the difference is not a
-- technicality. NO HEX IS EVER STORED HERE. `trackVars()` still supplies every
-- custom-property pair, the `auto` theme still flips them at sunset, and
-- model.ts:71-79's rule that a whole branch reads as one colour family is
-- untouched. What this column selects among is HUE SOURCES — which existing,
-- inherited, theme-aware family a node takes its pair from — and today there is
-- exactly ONE source in the entire codebase.
--
-- So the CHECK is `check (colour_by in ('track'))`: a set of one, and the set of
-- one IS the register of that fact. It is not a placeholder and not a
-- pessimistic default. Writing the column with no CHECK, or with a hopeful
-- `in ('track','kind','stage')`, would let a save name a source nothing can
-- resolve, and the failure would surface as a map that renders every node grey
-- with no error anywhere. The day a second hue source genuinely exists, the
-- migration that ships it widens this CHECK — with 0023:49-55 read again first,
-- because that paragraph is still the reason the answer is usually no.
--
--
-- ═══ node_fields IS KEYED ON THE DRAWING KINDS, NOT ON map_node_kinds ═══
--
-- `node_fields` answers "which fields does each KIND of node show on its card".
-- Its keys are `MindNodeKind` (model.ts:281) — `root | track | group | entry |
-- more | entity | cohort` — and NOT `map_node_kinds.id`, for four reasons that
-- all point the same way:
--
--   * A `map_node_kinds` row is DELETABLE. Keys that are uuids of deletable rows
--     are keys that orphan, silently, inside a jsonb blob no foreign key can
--     see.
--   * Keying on 0023's table would make this file DEPEND on 0023 for no gain,
--     turning a file that applies to a bare 0001/0002/0025 project into one that
--     does not — see the independence section above.
--   * `map_node_kinds` is a renameable ADMIN VOCABULARY (0023:259 seeds three
--     rows and every one of them is the owner's to rename). `MindNodeKind` is a
--     drawing role, closed, and owned by this repo — the same distinction the
--     CHECK asymmetry above turns on.
--   * A client-side `Record<MindNodeKind, readonly string[]>` gets `KIND_ROLE`'s
--     (model.ts:318) compile-time exhaustiveness for free. A `Record<string,
--     string[]>` keyed on uuids gets nothing at compile time and a runtime lookup
--     that can only miss.
--
-- THE SHAPE CHECK IS `jsonb_typeof(...) = 'object'` AND NOTHING MORE. Two paths
-- were considered and both are worse:
--
--   * A SUBQUERY IN THE CHECK — validating keys against a table — is `0A000`,
--     "cannot use subquery in check constraint". It does not fail at write time;
--     it fails at ALTER TABLE time and rolls this whole file back.
--   * `jsonb_path_exists` / a jsonpath predicate is legal in a CHECK and would
--     work. It is also unprecedented in this schema — no other constraint in
--     0001-0029 contains one — and it would buy a key-shape assertion the client
--     already makes with a type. An unprecedented construct in a constraint is a
--     thing the next reader has to research before they may safely edit the
--     table.
--
--
-- ═══ WHAT IS NOT IN THIS FILE, AND IS NOT AN OVERSIGHT ═══
--
-- NO SEED ROW. This file writes ZERO rows, and probe 1 asserts it. "Not
-- configured" and "configured, then set back to the defaults" are two different
-- sentences — the second names a person and a time, the first cannot — and a
-- seeded row destroys the difference. 0026's no-backfill argument on a table
-- with one row: a default is a fact the database asserts that nobody stated.
--
-- NO SECOND LABEL COLUMN. The brief asked for "label limits", plural, and this
-- file ships ONE: `label_budget`. The obvious second is `LABEL_INSIDE_MIN`
-- (MindNode.tsx:510) and it is REFUSED, because that constant is DERIVED and
-- says so in its own doc comment (MindNode.tsx:502-508): "DERIVED FROM THE
-- BUDGET ABOVE, not chosen" — it is `PAD * 2 + COUNT_SLOT + 6 * CHAR_PX`,
-- computed from four client constants this table does not hold. Storing it would
-- create a SECOND SOURCE OF TRUTH for a number the first source can recompute,
-- with no CHECK expressible here that could keep the two consistent, because the
-- inputs are not columns. A saved 96 beside a client whose `CHAR_PX` changed is
-- a value that is wrong and looks authoritative. `label_budget` is a genuinely
-- free choice (MindNode.tsx:516-524: "A FIXED NUMBER RATHER THAN A MEASUREMENT")
-- and is the only one of the two that belongs in a settings row.
--
-- NO PER-READER STATE. See the next section: that already has a home.
--
-- NO i18n IN THIS COMMIT. Every `mapview.*` key named in the token contract
-- below is OWED BY THE CLIENT HALF and none of them ships here — 0023:88-115's
-- "in the handoff" pattern. `src/lib/localeReach.test.ts` fails on a key nothing
-- references, so adding them now would turn the suite red for a screen that does
-- not exist.
--
--
-- ═══ THIS IS THE WORKSPACE DEFAULT. THE DEVICE STILL OVERRIDES IT ═══
--
-- ⚠ THIS TABLE IS NOT WHERE A READER'S OWN CHOICES LIVE, and a client half that
--   forgets this breaks something that works today. `src/store/mindtree.ts` owns
--   `nphiescore_mindtree_v1` (:117) — `dimension`, `view`, `density` and the
--   collapse sets — and it is already in the field on every device that has
--   opened this screen. That module's own header (:14-15) says why there is one
--   key and not two: "TWO writers on one localStorage key is not a merge, it is
--   whichever ran last."
--
-- The relationship is one sentence: THIS ROW IS THE WORKSPACE'S OPENING
-- POSITION; the device's prefs are the reader's, and the reader's win. A member
-- who collapsed a branch on their phone must not have it re-opened because
-- somebody in another room saved a settings screen. Nothing in this file writes
-- to that key, nothing in that module reads this table, and the client half must
-- keep it that way.
--
--
-- ═══ THE card / 157 SEAM: card_width IS NOT A FREE NUMBER ON THE CLIENT ═══
--
-- ⚠ THE HARDEST PART OF THE CLIENT HALF IS NOT THE FETCH. `lod.ts`'s
--   `BAND_EDGES.card = 157` (lod.ts:142-149) is a MEASURED number: it is the
--   apparent size at which a card pays the legibility floor for EVERY mark it
--   draws, and lod.ts:57-99 derives it from the count glyph on a 168x44 card.
--   `worlds.ts`'s own contract — `pos.width / cardScale === leafSize.width`
--   (worlds.ts:329) — is the identity that lets a mark be authored in leaf units,
--   and it is anchored to the same 168x44.
--
--   So a client that honours `card_width` and `card_height` RE-DERIVES those
--   numbers; it does not merely re-run `mapRender.test.tsx` and `lod.ts`'s tests
--   and watch them pass. A 240-wide card at the same camera puts its count glyph
--   at a different apparent size, and `BAND_EDGES.card` computed for 168 then
--   emits ink below the floor — a band boundary that is silently wrong, on a
--   screen where nothing raises. This paragraph exists so that work is scoped
--   before it is started rather than discovered inside it.
--
--
-- ═══ WHO MAY WRITE IT: structure.edit, and no new permission key ═══
--
-- Select is `is_member()`: every member's map has to be able to ask how the
-- workspace draws, and a member who cannot read this row would fall back to the
-- constants and see a DIFFERENT DRAWING from everyone else in the meeting, with
-- nothing on screen explaining why.
--
-- Writes are `has_perm('structure.edit')` — the key that already gates
-- `map_nodes`, `map_node_kinds` and the tree itself. This row IS the tree's
-- presentation, and there is no role that should decide how the hierarchy is
-- drawn and not be allowed to edit it. A sixth permission key would cost the
-- 0025:436 catalogue CHECK, the roles.ts union, PERMISSIONS meta, two locale
-- keys, the CommandPalette map and an Admin seed grant — and 0025's probe 1
-- refuses the migration if Admin holds fewer than five keys, so the literal `5`
-- would have to be edited too.
--
-- AND IT IS AUDITED, for 0028:420-426's reason exactly: this is the class of
-- change one person makes with nobody watching that alters what EVERYBODY sees.
-- There is at most one row here, so the configuration trail can never be
-- swamped by routine data entry — which is the argument that keeps the audit OFF
-- `map_node_progress`, where members write all day.
--
--
-- ═══ THE TOKEN CONTRACT WITH src/lib/pgError.ts — OWED, NOT SHIPPED ═══
--
-- This file raises no runtime `token:` messages: every refusal below is a
-- CONSTRAINT, and src/lib/pgError.ts matches constraint NAMES directly. NONE OF
-- THE ARMS BELOW LANDS IN THIS COMMIT — the names are fixed here so the client
-- half has something to match rather than something to invent, and renaming one
-- of these constraints later silently demotes a precise sentence to the generic
-- `common.error`:
--
--   map_view_settings_pkey              → mapview.errSingleton (23505)
--   map_view_settings_singleton_chk     → mapview.errSingleton (23514) — the
--                                         same sentence for both, deliberately:
--                                         "there is one map configuration and
--                                         something tried to write a second" is
--                                         one fact, and which of the key or the
--                                         CHECK caught it is not the reader's
--                                         problem.
--   map_view_settings_layout_chk        → mapview.errBadLayout
--   map_view_settings_open_depth_chk    → mapview.errDepthRange
--   map_view_settings_card_size_chk     → mapview.errCardSize
--   map_view_settings_gap_chk           → mapview.errGapRange
--   map_view_settings_grouping_chk      → mapview.errBadGrouping
--   map_view_settings_sibling_sort_chk  → mapview.errBadSort
--   map_view_settings_colour_by_chk     → mapview.errBadColourBy
--   map_view_settings_node_fields_chk   → mapview.errNodeFieldsShape
--   map_view_settings_label_budget_chk  → mapview.errLabelBudget
--
-- ⚠ THE SENTENCES MUST NOT ECHO THE VALUE (0028:155-162). `mapview.errCardSize`
--   describes the RANGE a card size has to sit in and never repeats what was
--   typed. pgError.ts returns KEYS and never interpolates, which is what makes
--   that rule hold for free — and it only keeps holding if the client half
--   resists the urge to add an interpolated `{value}` for helpfulness.
--
--
-- ═══ THE CLIENT HALF, WHICH IS A SEPARATE UNIT AND IS OWED ═══
--
-- Listed so that "the table exists" is never mistaken for "the feature ships":
-- `src/api/mapViewSettings.ts` with the id constant and a read validator that
-- drops and counts; a store hook beside `useJiraEnabled()`'s; the ten pgError
-- arms above plus `mapview.*` keys at EXACT en/ar parity as string literals;
-- an `isMapLayout()` guard for a client one deploy older; and the `card`/157
-- re-derivation the seam section above scopes. None of it is in this commit.
--
--
-- ═══ APPLY IT TWICE, IN ONE SITTING ═══
--
-- Supabase Dashboard → SQL Editor → paste + Run. READ THE NOTICES — there are
-- THREE of them on a clean run, one per probe, and the runbook counts them. Then
-- paste and Run THE SAME FILE AGAIN, in the same sitting, and read them again:
-- THE SECOND RUN PRINTS THE SAME THREE NOTICES.
--
-- The second run must be a complete no-op that still passes every probe: the
-- table create skips, every column add skips, every constraint, policy and
-- trigger is dropped and recreated identically, and every function is replaced
-- with itself. That is what makes "apply it twice" a real test rather than a
-- formality (0018:356), and it is what makes the fix-and-re-run loop free if a
-- probe does fail.
--
-- Re-runnable from the top in any partial state, same discipline as 0001-0029:
-- `create table if not exists` PLUS a separate `add column if not exists` per
-- column repeating its type and default (0017:129 / 0018:136 / 0028:266 — for a
-- project where an earlier cut of this file already landed and lacks a column),
-- `drop constraint if exists` before every add, `drop policy if exists` before
-- every create, `drop trigger if exists` before every create, `create or replace`
-- on every function, and probe blocks at the bottom that roll their fixtures back
-- through the `OT030` sentinel. A probe failure raises and the whole migration
-- rolls back — no explicit begin/commit here, for the reason 0009's header
-- spells out.


-- ── preflight: 0001, 0002 and 0025 first ────────────────────────────────────
-- Every write policy below is written in terms of `public.has_perm()` (0025) and
-- every read in terms of `public.is_member()` (0001), and the audit trigger
-- calls `public.log_config_audit()` (0002). Those three, and NOTHING from
-- 0023-0029 — see the independence section in the header. Without this block the
-- first failure is a bare 42883 from the middle of a CREATE POLICY, which reads
-- like a broken file rather than a missing prerequisite.
do $preflight$
begin
  if to_regprocedure('public.is_member()') is null then
    raise exception
      'NphiesCore 0030 CANNOT APPLY: public.is_member() does not exist. Apply 0001_opstrack_core.sql first — every member''s map reads this row, and without is_member() there is no way to say that.';
  end if;

  if to_regprocedure('public.has_perm(text)') is null then
    raise exception
      'NphiesCore 0030 CANNOT APPLY: public.has_perm(text) does not exist. Apply 0025_roles_permissions.sql first — how the map draws is written by whoever holds structure.edit, and without has_perm() there is no way to say that.';
  end if;

  if to_regprocedure('public.log_config_audit(text, uuid, text, jsonb, jsonb)') is null then
    raise exception
      'NphiesCore 0030 CANNOT APPLY: public.log_config_audit() does not exist. Apply 0002_config_foundation.sql first — this table IS configuration and is audited: one person changes how everybody''s map draws.';
  end if;
end
$preflight$;


-- ── map_view_settings ───────────────────────────────────────────────────────
-- One row. See the header for why the id is a fixed uuid rather than the text
-- 'map' (config_audit.row_id is uuid) and why the CHECK and the primary key are
-- both needed.
--
-- EVERY COLUMN IS `not null` WITH A DEFAULT THAT IS THE LIVE CONSTANT, and both
-- halves of that matter. Not-null because there is no third state here: a
-- geometry column that is null is a column every reader has to coalesce, and
-- five readers coalescing to five slightly different fallbacks is how a drawing
-- stops being one drawing. And the defaults are not fresh choices — each one is
-- the number the map draws with TODAY, copied from its constant, so that a row
-- inserted with no columns named reproduces exactly the current picture. A
-- default that differed from the constant would mean the first save on the
-- settings screen silently changed the map without anybody choosing anything.
create table if not exists public.map_view_settings (
  id            uuid        primary key default '00000000-0000-0000-0000-000000000030',
  layout        text        not null default 'worlds',
  open_depth    int         not null default 1,
  card_width    int         not null default 168,
  card_height   int         not null default 44,
  sibling_gap   int         not null default 12,
  depth_gap     int         not null default 56,
  sibling_wrap  boolean     not null default false,
  grouping      text        not null default 'none',
  sibling_sort  text        not null default 'order',
  colour_by     text        not null default 'track',
  node_fields   jsonb       not null default '{}'::jsonb,
  label_budget  int         not null default 14,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles (id) on delete set null
);

comment on table public.map_view_settings is
  'How the map draws (0030) — ONE ROW, enforced by a checked singleton key. The WORKSPACE DEFAULT: src/store/mindtree.ts''s nphiescore_mindtree_v1 stays the per-reader truth for dimension/view/density/collapse and OVERRIDES this. Member-read, because a member who cannot read it sees a different drawing from everybody else in the room; structure.edit-write, the same key that gates the tree itself; audited, because one person changes what everybody sees. Every default is the constant the map already draws with, so a row inserted with no columns named reproduces today''s picture exactly.';

comment on column public.map_view_settings.layout is
  'Which of the three drawings: tree (the tidy linear one), radial (concentric rings), worlds (the containment canvas the map draws with today, and the default). A CLOSED UNION THIS REPO OWNS — the opposite of 0028''s status_map — so it is CHECKED here and widens only in the migration that ships the fourth drawing. The client still needs a read-side guard: a CHECK says nothing about what a bundle one deploy older can render.';

comment on column public.map_view_settings.open_depth is
  'How deep the map opens before anything is clicked. 1 is OPEN_DEPTH (src/pages/map/useMapModel.ts:459). Bounds are 0..12 and both are unrenderability, not taste: model.ts:919-920 tests `depth >= openDepth`, so a negative value closes the ROOT and the whole map is one card; above ~12 there is nothing left to open — the tree cap is 6 (0023:28) plus four fixed rings — so any larger number is indistinguishable from "no limit" and only invites a save that appears to do nothing. ⚠ IT IS INERT ON THE PHONE BY DESIGN: useMapModel.ts:849 passes `undefined` when compact, because a phone opens flat. AND IT IS NEVER A depthLimit — worlds.ts:307 Omits that option outright (worlds.ts:387-390: FULL DEPTH, ALWAYS) and confusing the two would hide branches instead of folding them.';

comment on column public.map_view_settings.card_width is
  'A card''s inline size in drawing units. 168 is DEFAULT_NODE_SIZE (layout.ts:352). FLOOR 58, and it is arithmetic rather than taste: MindNode.tsx:728-731 gives the inside label `floor((width - PAD*2 - COUNT_SLOT) / CHAR_PX)` glyphs, which at 58 is `floor((58 - 24 - 34) / 6.2) = 0`, and truncate() (MindNode.tsx:581) returns '''' for a budget of 0 — every card on the map nameless, drawn, and silent. CEILING 1024, wider than the `opening` band (BAND_EDGES.opening = 380) can ever hold wholly on glass.';

comment on column public.map_view_settings.card_height is
  'A card''s block size in drawing units. 44 is DEFAULT_NODE_SIZE (layout.ts:352) and the floor is that same 44, for layout.ts:347-350''s reason verbatim: "A node is at least 44 px tall because that is the touch-target floor the whole app is held to, and a mind map is nothing but touch targets." MAP-CONTRACT §3.4 holds the whole app to it. A card nobody can tap is unrenderable in the sense that matters. CEILING 1024, for card_width''s reason.';

comment on column public.map_view_settings.sibling_gap is
  'Clearance between two nodes sharing a row, in drawing units. 12 is DEFAULT_GAP.sibling (layout.ts:359). FLOOR 0, not 1: layout.ts''s first invariant is that nothing overlaps, and 0 is the legal mobile-tight case where two cards touch — a NEGATIVE gap stacks them, which is a drawing in which two organizations are one shape. CEILING 512, past which one screen holds two siblings.';

comment on column public.map_view_settings.depth_gap is
  'Clearance between one ring and the next, in drawing units. 56 is DEFAULT_GAP.depth (layout.ts:359). FLOOR 0 for sibling_gap''s reason with one addition: a negative depth gap runs the connectors BACKWARDS, drawing a child on the parent''s far side with a line that crosses everything between them. CEILING 512.';

comment on column public.map_view_settings.sibling_wrap is
  'Whether a parent''s children are arranged as a BLOCK of rows rather than one line — 396 organizations in one row is a canvas thirty-six screens wide (layout.ts:172-181). ⚠ THIS COLUMN IS AHEAD OF THE WIRING. `wrap` exists in the LINEAR layout only (layout.ts:183, honoured at :744 through packBlocks); the concentric and containment layouts ignore it entirely, and NO CALLER PASSES IT TODAY — so on the drawing the map actually uses, `worlds`, saving true currently changes nothing. Stated the way 0028:115-119 states its own absences: a column whose effect is not yet wired is a column somebody must not assume works.';

comment on column public.map_view_settings.grouping is
  'Which axis the children of a track are grouped on. The five values are MIND_GROUPINGS (model.ts:163-170) verbatim and this is a CLOSED UNION — checked here, widened only by the migration that ships a sixth. ⚠ `PortfolioBy` (lens.ts:264) SHARES THE `?by=` PARAMETER AND IS A DIFFERENT UNION: it carries `phase` and has no `none`. model.ts:171-183 degrades `?by=phase` to the default on a canvas; a client that instead saves it into this column turns that graceful degradation into a 23514 on the save button.';

comment on column public.map_view_settings.sibling_sort is
  'How siblings are ordered: `order` (the workspace''s own sort_order, which is what it does today) or `name`. ⚠ AHEAD OF THE RENDERER — the order is hard-coded in bySortOrder() (model.ts:932-937) and one sibling comparator beside it (model.ts:1023-1026); nothing reads a preference. THE CONTRACT ANY IMPLEMENTATION OWES: the comparator must END ON THE ID TIEBREAK, exactly as those two do. Without it, equal names (and sort_order ties are real) leave the order non-total, siblings swap places between two renders of the same tree, and the map appears to move on its own.';

comment on column public.map_view_settings.colour_by is
  'Which existing hue source a node takes its colour pair from. CHECKED AGAINST A SET OF ONE, deliberately: NO HEX IS EVER STORED HERE, trackVars() still supplies every pair, and model.ts:71-79''s "COLOUR IS INHERITED, NEVER PICKED" is untouched — this selects among sources, and today exactly one source exists. The set-of-one IS the register of that fact, not a placeholder. Read 0023:49-55 before widening it; that paragraph is still the reason the answer is usually no.';

comment on column public.map_view_settings.node_fields is
  'Which fields each KIND of node shows on its card. Keyed on MindNodeKind (model.ts:281 — root/track/group/entry/more/entity/cohort), NOT on map_node_kinds ids: those rows are deletable and renameable admin vocabulary, and uuid keys inside jsonb orphan where no foreign key can see them. SHAPE-CHECKED ONLY (an object), for 0028''s status_map reason: the DATABASE checks shape and the CLIENT drops and counts unknown field names, because a CHECK can only refuse and would make the saved row unwritable the day the field list changes. ⚠ HIDING A FIELD FROM THE DRAWING NEVER HIDES IT FROM THE ACCESSIBLE NAME: mindtree.nodeName''s `{done} of {total}` clause is what keeps WCAG 1.4.1 honest for the progress underscore, which encodes length and colour alone (MindNode.tsx:312-326). A client that drops `progress` from this object and from the accessible name has removed the only non-visual carrier of that fact.';

comment on column public.map_view_settings.label_budget is
  'The outside label''s glyph budget. 14 is OUTSIDE_LABEL_BUDGET (MindNode.tsx:525) — "~87px at CHAR_PX, the widest label that still leaves daylight between two neighbours on the tightest ring the phone lays out". FLOOR 1: truncate() (MindNode.tsx:581) returns '''' at 0, so a budget of 0 draws NO outside label anywhere on the map. CEILING 200: 200 glyphs is roughly 1240px of ink laid along one radial wedge, which overlaps every neighbour it passes. The INSIDE minimum is deliberately NOT a column beside this one — LABEL_INSIDE_MIN is DERIVED (MindNode.tsx:502-508) from four client constants, and storing a derived number here would be a second source of truth with no CHECK able to keep the two consistent.';

comment on column public.map_view_settings.updated_by is
  'Who last saved how the map draws. Server truth, resolved through profiles from auth.uid(), never a field the screen offers. NULL when the write had no JWT — the SQL Editor and the service role write honestly attributed to nobody.';

-- For a project where an earlier cut of this file already landed: `create table
-- if not exists` above is a no-op there, so the columns have to be added
-- separately or the constraints below fail against a table that lacks them. The
-- type and the default are REPEATED rather than referenced, which is 0028:266's
-- reason: this statement has to be able to create the column correctly on its
-- own, because on that project it is the only statement that will.
alter table public.map_view_settings add column if not exists layout       text        not null default 'worlds';
alter table public.map_view_settings add column if not exists open_depth   int         not null default 1;
alter table public.map_view_settings add column if not exists card_width   int         not null default 168;
alter table public.map_view_settings add column if not exists card_height  int         not null default 44;
alter table public.map_view_settings add column if not exists sibling_gap  int         not null default 12;
alter table public.map_view_settings add column if not exists depth_gap    int         not null default 56;
alter table public.map_view_settings add column if not exists sibling_wrap boolean     not null default false;
alter table public.map_view_settings add column if not exists grouping     text        not null default 'none';
alter table public.map_view_settings add column if not exists sibling_sort text        not null default 'order';
alter table public.map_view_settings add column if not exists colour_by    text        not null default 'track';
alter table public.map_view_settings add column if not exists node_fields  jsonb       not null default '{}'::jsonb;
alter table public.map_view_settings add column if not exists label_budget int         not null default 14;
alter table public.map_view_settings add column if not exists updated_at   timestamptz not null default now();
alter table public.map_view_settings add column if not exists updated_by   uuid references public.profiles (id) on delete set null;

-- THE SINGLETON. Half of the rule; the primary key is the other half. Probe 1
-- exercises this half, because it is the half a reader can talk themselves into
-- believing the primary key already covers.
alter table public.map_view_settings drop constraint if exists map_view_settings_singleton_chk;
alter table public.map_view_settings add constraint map_view_settings_singleton_chk
  check (id = '00000000-0000-0000-0000-000000000030'::uuid);

-- The three drawings that exist. A closed union this repo owns — see the header
-- on why this is checked and node_fields is not.
alter table public.map_view_settings drop constraint if exists map_view_settings_layout_chk;
alter table public.map_view_settings add constraint map_view_settings_layout_chk
  check (layout in ('tree','radial','worlds'));

-- 0..12. Below 0 the root itself is closed (model.ts:919-920 tests
-- `depth >= openDepth`) and the map is one card; above 12 there is nothing left
-- to open, so a bigger number is a save that appears to do nothing.
alter table public.map_view_settings drop constraint if exists map_view_settings_open_depth_chk;
alter table public.map_view_settings add constraint map_view_settings_open_depth_chk
  check (open_depth between 0 and 12);

-- 58 IS NOT A ROUND NUMBER AND IT IS NOT `> 0`. `check (card_width > 0)` is the
-- tempting form and it is exactly the failure this project's bound rule guards:
-- a 12-unit card IS renderable — it draws, it takes clicks, and every label on
-- the map is the empty string, because the glyph budget at MindNode.tsx:728-731
-- has gone to zero. The floor is the width at which the FIRST glyph survives.
-- 44 is the touch-target floor (layout.ts:347-350), not a look.
alter table public.map_view_settings drop constraint if exists map_view_settings_card_size_chk;
alter table public.map_view_settings add constraint map_view_settings_card_size_chk
  check (card_width between 58 and 1024 and card_height between 44 and 1024);

-- 0 IS LEGAL AND NEGATIVE IS NOT. Zero is the mobile-tight case where two cards
-- touch; a negative sibling gap stacks them into one shape, and a negative depth
-- gap runs the connectors backwards.
alter table public.map_view_settings drop constraint if exists map_view_settings_gap_chk;
alter table public.map_view_settings add constraint map_view_settings_gap_chk
  check (sibling_gap between 0 and 512 and depth_gap between 0 and 512);

-- MIND_GROUPINGS (model.ts:163-170) verbatim. Note what is NOT here: `phase`,
-- which belongs to PortfolioBy and has no meaning on a canvas that already draws
-- phases as rings.
alter table public.map_view_settings drop constraint if exists map_view_settings_grouping_chk;
alter table public.map_view_settings add constraint map_view_settings_grouping_chk
  check (grouping in ('none','stage','manager','type','vendor'));

alter table public.map_view_settings drop constraint if exists map_view_settings_sibling_sort_chk;
alter table public.map_view_settings add constraint map_view_settings_sibling_sort_chk
  check (sibling_sort in ('order','name'));

-- A SET OF ONE, ON PURPOSE. See the header: this is not a colour column, it
-- selects among existing hue sources, and today there is one. The migration that
-- ships a second source is the one that widens this.
alter table public.map_view_settings drop constraint if exists map_view_settings_colour_by_chk;
alter table public.map_view_settings add constraint map_view_settings_colour_by_chk
  check (colour_by in ('track'));

-- SHAPE ONLY. The VALUES are validated on read, dropped and counted. An array or
-- a bare string here would make every reader's Object.entries() a lie, and that
-- is not a vocabulary question. No jsonpath and no subquery — the header says
-- why both were refused.
alter table public.map_view_settings drop constraint if exists map_view_settings_node_fields_chk;
alter table public.map_view_settings add constraint map_view_settings_node_fields_chk
  check (jsonb_typeof(node_fields) = 'object');

-- 1..200. At 0 no outside label is drawn anywhere; at 200 one label is about
-- 1240px of ink along a single wedge and overlaps every neighbour it passes.
alter table public.map_view_settings drop constraint if exists map_view_settings_label_budget_chk;
alter table public.map_view_settings add constraint map_view_settings_label_budget_chk
  check (label_budget between 1 and 200);

alter table public.map_view_settings enable row level security;

-- MEMBER READ, structure.edit WRITE — and both halves are deliberate.
--
-- Read must be member-wide, and the failure of getting that wrong is quiet: a
-- member whose read is refused falls back to the compiled constants and sees a
-- DIFFERENT DRAWING from the person sitting next to them, with nothing on screen
-- saying so. Nothing here is a secret — it is nine numbers and four words about
-- geometry.
--
-- Every predicate is in 0009's InitPlan form `(select public.is_member())` /
-- `(select public.has_perm(...))` so it is evaluated ONCE PER STATEMENT rather
-- than once per surviving row. One row makes that academic; writing it the other
-- way would make this the one table in the schema somebody has to find and fix
-- later.
drop policy if exists map_view_settings_select on public.map_view_settings;
create policy map_view_settings_select on public.map_view_settings
  for select using ((select public.is_member()));

drop policy if exists map_view_settings_insert on public.map_view_settings;
create policy map_view_settings_insert on public.map_view_settings
  for insert with check ((select public.has_perm('structure.edit')));

drop policy if exists map_view_settings_update on public.map_view_settings;
create policy map_view_settings_update on public.map_view_settings
  for update using ((select public.has_perm('structure.edit')))
  with check ((select public.has_perm('structure.edit')));

drop policy if exists map_view_settings_delete on public.map_view_settings;
create policy map_view_settings_delete on public.map_view_settings
  for delete using ((select public.has_perm('structure.edit')));

-- Explicit rather than relying on Supabase's default privileges for new tables
-- in `public`; `anon` is left exactly as the project's defaults have it, matching
-- every other table since 0002, and cannot pass is_member() in any case.
grant select, insert, update, delete on public.map_view_settings to authenticated;


-- ── touch: updated_at / updated_by, diffed, with the else arm pinning ───────
-- BEFORE INSERT OR UPDATE. 0028:356-377's shape and its reasons:
--
--   * INSERT stamps both, because the common case here is a row written once and
--     edited months later — with an update-only touch, "who decided the map
--     opens two deep?" would be unanswerable for exactly the row this table is
--     made of.
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
--     a lie about when the drawing was last decided — and a settings screen's
--     save sends the whole row it read, which is precisely the shape that does
--     it. Probe 2 asserts the pin.
create or replace function public.map_view_settings_touch()
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

drop trigger if exists map_view_settings_touch_trg on public.map_view_settings;
create trigger map_view_settings_touch_trg
  before insert or update on public.map_view_settings
  for each row execute function public.map_view_settings_touch();


-- ── audit: this IS configuration ────────────────────────────────────────────
-- AFTER, not BEFORE: the row image recorded must be the one that survived every
-- other trigger and constraint. Identical in shape to 0028's audit trigger
-- (0028:433-454) and 0026:507's before it.
--
-- WHY THIS TABLE IS AUDITED WHEN map_node_progress IS NOT, which is 0028:420-426
-- word for word with the subject changed: changing `layout` or `open_depth`
-- changes what EVERY member sees on the map, retroactively, for every reader who
-- loads it afterwards, and it is the class of change one person makes with
-- nobody watching. There is AT MOST ONE ROW here, so the configuration trail can
-- never be dominated by routine data entry — which is the argument that keeps the
-- audit off map_node_progress, where members write all day.
--
-- The UPDATE arm compares the FULL row images with nothing subtracted, which is
-- safe because the touch trigger above ran first (BEFORE beats AFTER regardless
-- of names) and only moved `updated_at` if something else had already changed. A
-- save that changed nothing therefore writes no audit row — asserted by probe 2,
-- not assumed.
create or replace function public.map_view_settings_audit()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    -- Casts on the null: with a single candidate Postgres resolves an untyped
    -- null anyway, but an overload added later would make this ambiguous at
    -- runtime, inside a trigger, on someone else's write.
    perform public.log_config_audit('map_view_settings', new.id, 'insert', null::jsonb, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    if to_jsonb(new) is distinct from to_jsonb(old) then
      perform public.log_config_audit('map_view_settings', new.id, 'update', to_jsonb(old), to_jsonb(new));
    end if;
    return new;
  else
    perform public.log_config_audit('map_view_settings', old.id, 'delete', to_jsonb(old), null::jsonb);
    return old;
  end if;
end;
$$;

drop trigger if exists map_view_settings_audit_trg on public.map_view_settings;
create trigger map_view_settings_audit_trg
  after insert or update or delete on public.map_view_settings
  for each row execute function public.map_view_settings_audit();


-- ════════════════════════════════════════════════════════════════════════════
-- ═══ PROBES ═════════════════════════════════════════════════════════════════
-- ════════════════════════════════════════════════════════════════════════════
--
-- Every one of these can FAIL, which is the rule docs/PENDING-MIGRATIONS.md ends
-- on: 0019's probe 1 asserted that a row existed and never what it said, and a
-- wrong notification shipped. Each assertion below is written so that deleting
-- the code it tests makes it raise. A probe that passes vacuously is worse than
-- no probe at all.
--
-- ⚠ THREE NOTICES ON A CLEAN RUN, one per probe, AND THE SAME THREE ON THE
--   SECOND RUN. The runbook counts them. The count is stable in EVERY branch and
--   not only the happy one: probe 3's SKIPPED branch and its PARTIAL branch each
--   print exactly one notice and return, so a workspace where the role switch is
--   unavailable still prints three lines and not two.
--
-- ⚠ ONE LIMIT, STATED SO NOBODY MISTAKES IT FOR AN OVERSIGHT. `now()` is the
--   TRANSACTION timestamp and is constant for the whole of this file, so no
--   probe here can observe a timestamp MOVING between two writes — both land on
--   the same value. The probes therefore assert the strictly stronger thing that
--   IS observable inside one transaction: that a value the CLIENT supplied did
--   not survive, and that the trigger's own value is what came back. 0028:471
--   and 0026:893 state the same limit for the same reason.
--
-- ⚠ THE FIXTURE ROW AND THE SINGLETON. This table holds at most one row, so a
--   probe cannot add its own beside a real one. Every fixture block therefore
--   DELETES whatever is there first and inserts its own — inside the OT030
--   subtransaction, which rolls the delete back with everything else. Nothing
--   below ever commits, and a workspace that had a saved map configuration
--   before this file ran still has exactly that configuration afterwards.
--   Probe 1's final assertion is the belt: this file wrote no rows.
--
-- ⚠ THE ROLLBACK SENTINEL IS `OT030`, following OT026 / OT027 / OT028 / OT029.
--   Literal 'OT' plus the file number, and nothing else.


-- ── probe 1: the shape landed, including the two halves of "one row" ────────
-- Runs as whoever applies the file (the SQL Editor, i.e. no JWT). This probe
-- tests STRUCTURE and NAMES; RLS is probe 3's job.
--
-- It checks client-facing NAMES and not merely existence, because a constraint
-- created under a different name by an earlier cut of this file leaves a
-- pgError.ts arm dead with no other symptom — a precise sentence silently
-- demoted to common.error, discovered by a user.
do $shape$
declare
  v_default      text;
  v_touch_type   smallint;
  v_audit_type   smallint;
  v_sel          text;
  v_ins          text;
  v_upd          text;
  v_del          text;
  v_second       boolean := false;
  v_narrow       boolean := false;
  v_neg_gap      boolean := false;
  v_bad_layout   boolean := false;
  v_bad_fields   boolean := false;
  v_rows         int;
  v_written      int;
begin
  if to_regclass('public.map_view_settings') is null then
    raise exception 'NphiesCore 0030 FAILED: public.map_view_settings does not exist.';
  end if;

  -- ── the defaults, read out of the catalog rather than trusted ──
  -- A DRIFTED DEFAULT IS THE QUIETEST FAILURE THIS FILE HAS. Every column here
  -- defaults to the constant the map already draws with, so an unconfigured
  -- workspace and a workspace that saved the defaults produce the same picture.
  -- Change one of them and the FIRST save on a settings screen silently switches
  -- every reader's drawing to something nobody chose — and the file looks
  -- exactly like this one at a glance.
  select pg_get_expr(d.adbin, d.adrelid) into v_default
    from pg_attrdef d
    join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
   where d.adrelid = 'public.map_view_settings'::regclass and a.attname = 'layout';

  if v_default is null or position('worlds' in v_default) = 0 then
    raise exception
      'NphiesCore 0030 FAILED: map_view_settings.layout does not default to ''worlds'' (its default is %). `worlds` is the containment canvas the map draws with today; any other default means the first row written to this table redraws the whole map into a shape nobody asked for.',
      coalesce(v_default, '(none)');
  end if;

  select pg_get_expr(d.adbin, d.adrelid) into v_default
    from pg_attrdef d
    join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
   where d.adrelid = 'public.map_view_settings'::regclass and a.attname = 'colour_by';

  if v_default is null or position('track' in v_default) = 0 then
    raise exception
      'NphiesCore 0030 FAILED: map_view_settings.colour_by does not default to ''track'' (its default is %). ''track'' is the ONLY hue source that exists (model.ts:71-79 — colour is inherited, never picked), so any other default names a source nothing can resolve and the map renders colourless with no error anywhere.',
      coalesce(v_default, '(none)');
  end if;

  select pg_get_expr(d.adbin, d.adrelid) into v_default
    from pg_attrdef d
    join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
   where d.adrelid = 'public.map_view_settings'::regclass and a.attname = 'open_depth';

  if coalesce(btrim(v_default), '') <> '1' then
    raise exception
      'NphiesCore 0030 FAILED: map_view_settings.open_depth does not default to 1 (its default is %). 1 is OPEN_DEPTH (useMapModel.ts:459) — what the map opens to today. A default of 0 closes the root and shows one card; a large one opens four hundred organizations at once on first paint.',
      coalesce(v_default, '(none)');
  end if;

  -- ── the two constraints whose NAMES the client half will match on ──
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.map_view_settings'::regclass
       and conname = 'map_view_settings_singleton_chk'
  ) then
    raise exception
      'NphiesCore 0030 FAILED: map_view_settings_singleton_chk is missing. The primary key alone stops a SECOND row with the same id and does nothing at all about a second row with a different one, after which two readers of one workspace can disagree about the geometry of the same drawing.';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.map_view_settings'::regclass
       and conname = 'map_view_settings_node_fields_chk'
  ) then
    raise exception
      'NphiesCore 0030 FAILED: map_view_settings_node_fields_chk is missing. node_fields must be an OBJECT — an array or a bare string there makes every reader''s Object.entries() a lie and every card falls back to showing nothing. (The field NAMES are deliberately unconstrained; the client drops and counts the unknown ones. See the header.)';
  end if;

  -- ── the two triggers, READ OUT OF tgtype AND NOT OUT OF THE RENDERED TEXT ──
  --
  -- ⚠ AN EARLIER CUT OF 0028 AND OF 0029 MATCHED `pg_get_triggerdef()` FOR THE
  --   LITERAL STRING 'AFTER INSERT OR UPDATE OR DELETE' AND COULD NEVER HAVE
  --   APPLIED TO ANY DATABASE. pg_get_triggerdef() DOES NOT ECHO THE ORDER THE
  --   EVENTS WERE WRITTEN: `tgtype` is a bitmask with no order in it at all, and
  --   pg_get_triggerdef_worker() in ruleutils.c renders the bits it finds in one
  --   fixed sequence — INSERT, then DELETE, then UPDATE, then TRUNCATE. The
  --   audit trigger created above therefore reads back as `AFTER INSERT OR
  --   DELETE OR UPDATE`, the searched-for substring never occurs, and the probe
  --   raises on a trigger that is CORRECT, rolling the whole file back on run 1
  --   and every run after it. A probe that cannot pass is worse than one that
  --   passes vacuously: it makes the migration unappliable and blames an object
  --   that is right. (0028:558-573 records the same trap from its own side.)
  --
  --   So the shape is asserted against the bitmask, which no version of
  --   ruleutils.c can reorder:
  --       1 = FOR EACH ROW      2 = BEFORE      4 = INSERT
  --       8 = DELETE           16 = UPDATE     32 = TRUNCATE     64 = INSTEAD OF
  --   `& 60` is the whole event set, so an equality against it means "these and
  --   NOTHING ELSE" rather than "at least these".
  --
  -- ⚠ THE TOUCH MASK HERE IS 20, NOT 16. 0029's touch trigger is UPDATE-ONLY and
  --   its probe tests `& 60 = 16`; copying that number here would be the same
  --   un-appliable-probe defect entered from the other side, because THIS touch
  --   stamps INSERT too (4 | 16 = 20) — deliberately, so that "who set this up"
  --   is answerable for the one row this table is made of.
  select t.tgtype into v_touch_type
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where c.relname = 'map_view_settings' and t.tgname = 'map_view_settings_touch_trg';

  if v_touch_type is null
     or (v_touch_type::int & 60) <> 20   -- INSERT | UPDATE, exactly those two
     or (v_touch_type::int &  1) <>  1   -- FOR EACH ROW, not FOR EACH STATEMENT
     or (v_touch_type::int &  2) <>  2 then  -- BEFORE, not AFTER
    raise exception
      'NphiesCore 0030 FAILED: map_view_settings_touch_trg is missing or is not BEFORE INSERT OR UPDATE FOR EACH ROW (tgtype reads %). updated_at and updated_by would then be whatever the client sent, and "who decided how this map draws, and when" would be unanswerable for the only row the table has.',
      coalesce(v_touch_type::text, '(absent)');
  end if;

  select t.tgtype into v_audit_type
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where c.relname = 'map_view_settings' and t.tgname = 'map_view_settings_audit_trg';

  if v_audit_type is null
     or (v_audit_type::int & 60) <> 28   -- INSERT | DELETE | UPDATE, exactly those three
     or (v_audit_type::int &  1) <>  1   -- FOR EACH ROW
     or (v_audit_type::int &  2) <>  0   -- AFTER, not BEFORE
     or (v_audit_type::int & 64) <>  0 then  -- …and not INSTEAD OF
    raise exception
      'NphiesCore 0030 FAILED: map_view_settings_audit_trg is missing or is not AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW (tgtype reads %). One person changes how everybody''s map draws; with no trail there is no record of what it used to say or who changed it. AFTER and not BEFORE, so the image recorded is the one that survived every other trigger.',
      coalesce(v_audit_type::text, '(absent)');
  end if;

  -- ── RLS is actually ON ──
  -- 0029:1010-1015's assertion, which 0028 lacks and should have had: four
  -- correct policies on a table with row level security OFF are four comments,
  -- and every one of the predicate checks below would still pass.
  if not exists (
    select 1 from pg_class c where c.relname = 'map_view_settings' and c.relrowsecurity
  ) then
    raise exception
      'NphiesCore 0030 FAILED: row level security is not enabled on map_view_settings. Four correct policies on a table with RLS off are four comments — any member could then rewrite the workspace''s drawing, and the policy checks below would still all pass.';
  end if;

  -- ── the four policies, by predicate ──
  -- Read out of pg_policies and MATCHED, because a copy-paste that gated the
  -- select on structure.edit (a member then falls back to the constants and sees
  -- a different drawing) or the update on is_member() (any member re-draws the
  -- map for everybody) is invisible to every other check in this file.
  select coalesce(qual, '') into v_sel from pg_policies
   where schemaname = 'public' and tablename = 'map_view_settings' and policyname = 'map_view_settings_select';
  select coalesce(with_check, '') into v_ins from pg_policies
   where schemaname = 'public' and tablename = 'map_view_settings' and policyname = 'map_view_settings_insert';
  select coalesce(qual, '') || ' ' || coalesce(with_check, '') into v_upd from pg_policies
   where schemaname = 'public' and tablename = 'map_view_settings' and policyname = 'map_view_settings_update';
  select coalesce(qual, '') into v_del from pg_policies
   where schemaname = 'public' and tablename = 'map_view_settings' and policyname = 'map_view_settings_delete';

  if v_sel is null or position('is_member' in v_sel) = 0 then
    raise exception
      'NphiesCore 0030 FAILED: map_view_settings_select does not read is_member() (it is: %). Every member''s map has to be able to ask how this workspace draws, or that member quietly sees a different picture from the person beside them.',
      coalesce(v_sel, '(absent)');
  end if;

  if v_ins is null or position('structure.edit' in v_ins) = 0
     or v_upd is null or position('structure.edit' in v_upd) = 0
     or v_del is null or position('structure.edit' in v_del) = 0 then
    raise exception
      'NphiesCore 0030 FAILED: one of the three write policies does not name structure.edit (insert: %, update: %, delete: %). This row is the tree''s presentation, and a member who can write it re-draws the map for everybody in the workspace.',
      coalesce(v_ins, '(absent)'), coalesce(v_upd, '(absent)'), coalesce(v_del, '(absent)');
  end if;

  -- ── the refusals, EXERCISED rather than read ──
  -- Five of them, inside one subtransaction that is rolled back. The delete at
  -- the top is what makes the block work on a workspace that already holds a
  -- saved configuration, and it rolls back with everything else.
  select count(*) into v_rows from public.map_view_settings;

  begin
    delete from public.map_view_settings;

    insert into public.map_view_settings (id) values ('00000000-0000-0000-0000-000000000030');

    -- (a) A SECOND ROW, with a different id: the CHECK must refuse it. The
    -- primary key cannot, which is the whole reason the CHECK is there.
    begin
      insert into public.map_view_settings (id) values ('00000000-0000-0000-0000-000000000031');
      v_second := true;
    exception when check_violation or unique_violation then
      null;  -- as intended
    end;

    -- (b) ONE UNIT UNDER THE FLOOR. 57, not 0, because `check (card_width > 0)`
    -- would pass a 57 and this assertion is what makes the difference visible.
    begin
      update public.map_view_settings set card_width = 57;
      v_narrow := true;
    exception when check_violation then
      null;  -- as intended
    end;

    -- (c) A NEGATIVE GAP. -1 and not -100, for the same reason: the boundary is
    -- the claim, and 0 must still be accepted.
    begin
      update public.map_view_settings set sibling_gap = -1;
      v_neg_gap := true;
    exception when check_violation then
      null;  -- as intended
    end;

    -- (d) A LAYOUT NOTHING CAN DRAW.
    begin
      update public.map_view_settings set layout = 'spiral';
      v_bad_layout := true;
    exception when check_violation then
      null;  -- as intended
    end;

    -- (e) node_fields AS AN ARRAY. The shape check, not a vocabulary check: a
    -- field name of 'nonsense' is DELIBERATELY accepted here and dropped on read.
    begin
      update public.map_view_settings set node_fields = '[]'::jsonb;
      v_bad_fields := true;
    exception when check_violation then
      null;  -- as intended
    end;

    raise exception using errcode = 'OT030', message = 'probe rollback';
  exception
    when sqlstate 'OT030' then
      null;
  end;

  if v_second then
    raise exception
      'NphiesCore 0030 FAILED: a SECOND map_view_settings row was accepted. map_view_settings_singleton_chk is not doing its job, and two rows means two readers of one workspace can disagree about the geometry of the same drawing while both believe they are looking at the shared one.';
  end if;

  if v_narrow then
    raise exception
      'NphiesCore 0030 FAILED: card_width = 57 was accepted. At 57 units the inside label''s glyph budget (MindNode.tsx:728-731) is floor((57 - 24 - 34) / 6.2) = 0 and truncate() returns the empty string, so EVERY CARD ON THE MAP IS NAMELESS — drawn, clickable, and silent, with nothing raising anywhere. That is the exact failure a `> 0` bound would have shipped.';
  end if;

  if v_neg_gap then
    raise exception
      'NphiesCore 0030 FAILED: sibling_gap = -1 was accepted. layout.ts''s first invariant is that nothing overlaps; a negative sibling gap stacks two cards into one shape, and a negative depth gap runs the connectors backwards across the drawing. 0 is legal and is the mobile-tight case — the floor is 0, not 1, and not "greater than".';
  end if;

  if v_bad_layout then
    raise exception
      'NphiesCore 0030 FAILED: layout = ''spiral'' was accepted. The three drawings are the three that exist; a fourth word here is one no code path can render, and the map falls back or blanks with no sentence explaining it. This union is CLOSED and is widened only by the migration that ships the drawing.';
  end if;

  if v_bad_fields then
    raise exception
      'NphiesCore 0030 FAILED: a node_fields that is not an object was accepted. Every reader iterates it with Object.entries(); an array there is a silently empty configuration and every card falls back to showing nothing at all.';
  end if;

  -- ── this file wrote NO rows ──
  -- Every fixture above lives inside a rolled-back subtransaction, and there is
  -- no seed. A row seeded here with the defaults would be indistinguishable from
  -- a row somebody saved back to the defaults, and those are two different
  -- sentences — the second names a person and a time. If an `insert` is ever
  -- added above, this fails.
  select count(*) into v_written from public.map_view_settings;

  if v_written <> v_rows then
    raise exception
      'NphiesCore 0030 FAILED: this migration changed the map_view_settings row count from % to %. It must write NOTHING: "not configured" and "configured back to the defaults" are two different sentences, and a seeded row destroys the difference.',
      v_rows, v_written;
  end if;

  raise notice
    'NphiesCore 0030 probe 1: map_view_settings exists, layout defaults to ''worlds'', colour_by to ''track'' and open_depth to 1, both named CHECKs are present, the singleton refused a second row, card_width=57 / sibling_gap=-1 / layout=''spiral'' / node_fields=''[]'' were all refused, RLS is enabled, both triggers carry the right tgtype (touch 20, audit 28), all four policies name the right predicate (select=is_member, writes=structure.edit), and this file wrote 0 rows (% present before and after).',
    v_rows;
end
$shape$;


-- ── probe 2: the touch is the only writer, and a no-op save is inert ────────
-- Three claims that cannot be verified by reading the file:
--
--   (a) a client-supplied `updated_at` does not survive — on insert, on a real
--       change, or on a save that changed nothing. A settings screen's save
--       sends the whole row it read, so this is the ordinary path and not an
--       edge case.
--   (b) a save that changed nothing writes NO config_audit row. Without the
--       diff, opening the map settings and pressing Save twice would fill the
--       configuration trail with rows recording that nothing happened, which is
--       how an audit log stops being read.
--   (c) a real change DOES write exactly one.
--
-- Everything is rolled back through the OT030 sentinel, the pre-existing row
-- included.
do $touch$
declare
  v_bogus      timestamptz := timestamptz '2001-09-09 01:46:40+00';
  v_updated    timestamptz;
  v_audit0     int;
  v_audit_ins  int := 0;
  v_audit_noop int := 0;
  v_audit_real int := 0;
  v_pinned     boolean := false;
begin
  select count(*) into v_audit0 from public.config_audit where table_name = 'map_view_settings';

  begin
    delete from public.map_view_settings;

    -- ── (a) INSERT: the client's timestamp is overruled ──
    -- `layout` is deliberately left at its default here so that the no-op below
    -- can resend the value the row already holds without having to know one.
    insert into public.map_view_settings (id, updated_at)
      values ('00000000-0000-0000-0000-000000000030', v_bogus);

    select updated_at into v_updated from public.map_view_settings;

    if v_updated = v_bogus then
      raise exception
        'NphiesCore 0030 FAILED: the updated_at the client sent (%) survived the INSERT. map_view_settings_touch() is supposed to own that column; as it stands, "when was this map''s drawing last decided" is whatever the last request happened to contain.',
        v_bogus;
    end if;

    if v_updated is distinct from now() then
      raise exception
        'NphiesCore 0030 FAILED: updated_at came back as % on insert, expected now() (%). The touch trigger''s INSERT arm did not run, which is exactly the arm that makes "who set this up" answerable for the one row this table has.',
        v_updated, now();
    end if;

    select count(*) - v_audit0 into v_audit_ins
      from public.config_audit where table_name = 'map_view_settings';

    -- ── (b) THE NO-OP SAVE: same value, plus a bogus updated_at ──
    -- Byte-for-byte what a save-on-blur screen sends when nothing was edited.
    update public.map_view_settings
       set layout = 'worlds', updated_at = v_bogus
     where id = '00000000-0000-0000-0000-000000000030';

    select updated_at into v_updated from public.map_view_settings;
    v_pinned := (v_updated is not distinct from now()) and (v_updated <> v_bogus);

    select count(*) - v_audit0 - v_audit_ins into v_audit_noop
      from public.config_audit where table_name = 'map_view_settings';

    -- ── (c) A REAL CHANGE: the whole map is redrawn ──
    update public.map_view_settings
       set layout = 'radial'
     where id = '00000000-0000-0000-0000-000000000030';

    select count(*) - v_audit0 - v_audit_ins - v_audit_noop into v_audit_real
      from public.config_audit where table_name = 'map_view_settings';

    raise exception using errcode = 'OT030', message = 'probe rollback';
  exception
    when sqlstate 'OT030' then
      null;
  end;

  if v_audit_ins <> 1 then
    raise exception
      'NphiesCore 0030 FAILED: creating the map configuration row wrote % config_audit rows, expected exactly 1. This table IS configuration: it decides what every member sees on the map, and `before`/`after` is the only record of what it used to say.',
      v_audit_ins;
  end if;

  if not v_pinned then
    raise exception
      'NphiesCore 0030 FAILED: a save that changed nothing moved updated_at (or accepted the client''s value). The else arm of map_view_settings_touch() must pin updated_at and updated_by back to their old values — a settings screen saves the whole row it read, so this is the ordinary path and not an edge case.';
  end if;

  if v_audit_noop <> 0 then
    raise exception
      'NphiesCore 0030 FAILED: a save that changed nothing wrote % config_audit rows, expected 0. The trail would fill with rows recording that nothing happened, which is how an audit log stops being read.',
      v_audit_noop;
  end if;

  if v_audit_real <> 1 then
    raise exception
      'NphiesCore 0030 FAILED: changing `layout` wrote % config_audit rows, expected exactly 1. That one word re-draws the map for every member in the workspace; it is the change in this table that most needs a name against it.',
      v_audit_real;
  end if;

  raise notice
    'NphiesCore 0030 probe 2: the touch overruled a client-supplied updated_at on insert and on a no-op save, the no-op wrote 0 audit rows, the insert wrote 1 and a real layout change wrote 1. Rolled back.';
end
$touch$;


-- ── probe 3: a member reads the drawing and cannot change it ────────────────
-- The claim the permission design rests on, and the one that cannot be verified
-- by reading the file. Both halves fail in opposite directions and both are
-- asserted:
--
--   * a member who CANNOT READ this row falls back to the compiled constants and
--     sees a different drawing from everybody else in the meeting, with nothing
--     on screen explaining why;
--   * a member who CAN WRITE it re-draws the map for the whole workspace from a
--     screen they were never offered.
--
-- The Director arm doubles as the check that the audit trigger's own guard has
-- not narrowed: a structure.edit holder who is NOT an admin must be able to
-- write, and that write goes through map_view_settings_audit_trg →
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
      (v_dir,    'probe-dir-'    || v_dir    || '@0030.invalid',
       jsonb_build_object('display_name', '0030 Probe Director')),
      (v_member, 'probe-member-' || v_member || '@0030.invalid',
       jsonb_build_object('display_name', '0030 Probe Member'));

    if (select count(*) from public.profiles where id in (v_dir, v_member)) <> 2 then
      raise exception 'NphiesCore 0030 PROBE 3 SETUP FAILED: handle_new_user() did not create the fixture profiles.';
    end if;

    -- No JWT yet, so guard_profile_role() lets this through: the privileged path
    -- the SQL Editor and the edge function use.
    if not v_no_dir_role then
      update public.profiles set role_id = v_dir_role where id = v_dir;
    end if;

    -- The fixture row, written as the applying role. The delete is what makes
    -- this work against a workspace that already holds a saved configuration,
    -- and it rolls back with everything else.
    delete from public.map_view_settings;
    insert into public.map_view_settings (id, open_depth)
      values ('00000000-0000-0000-0000-000000000030', 2);

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
            'NphiesCore 0030 PROBE 3 SETUP FAILED: the fixture Director does not resolve to structure.edit, so nothing asserted below would mean anything.';
        end if;
        if public.is_admin() then
          raise exception
            'NphiesCore 0030 PROBE 3 SETUP FAILED: the fixture Director resolves to workspace.admin. The probe would then prove only that an admin can do anything.';
        end if;

        update public.map_view_settings set card_width = 200;
        if found then v_dir_write := true; end if;
      end if;

      -- ── as a plain member ──
      perform set_config('request.jwt.claims',
                         json_build_object('sub', v_member, 'role', 'authenticated')::text, true);

      select count(*) into v_read from public.map_view_settings;

      -- A blocked UPDATE/DELETE affects zero rows rather than raising, which is
      -- the whole reason src/lib/permissions.ts exists. Count rows, do not
      -- catch. `layout` is the column deliberately targeted: it is the one word
      -- a wrongly-open policy would let any member change for everybody.
      update public.map_view_settings set layout = 'tree';
      if found then v_mem_wrote := true; end if;

      delete from public.map_view_settings;
      if found then v_mem_wrote := true; end if;

      reset role;
    end if;

    raise exception using errcode = 'OT030', message = 'probe rollback';
  exception
    when sqlstate 'OT030' then
      null;
  end;

  if v_skipped then
    raise notice
      'NphiesCore 0030 probe 3 SKIPPED: this role cannot `set role authenticated`, so the RLS half could not run. The policies ARE installed and probe 1 read all four predicates out of pg_policies and confirmed RLS is enabled. Verify by hand: sign in as a plain member and PATCH /rest/v1/map_view_settings (must affect zero rows) and GET it (must return the row).';
    return;
  end if;

  if v_read <> 1 then
    raise exception
      'NphiesCore 0030 FAILED: a plain member read % map_view_settings rows, expected 1. map_view_settings_select is too strict — a member who cannot read this row falls back to the compiled constants and sees a DIFFERENT DRAWING from the person sitting next to them, with nothing on screen explaining why.',
      v_read;
  end if;

  if v_mem_wrote then
    raise exception
      'NphiesCore 0030 FAILED: a plain member wrote map_view_settings. That row decides how the hierarchy is drawn for everybody in the workspace; it is structure.edit''s, like the tree and the kind catalogue it presents.';
  end if;

  if v_no_dir_role then
    raise notice
      'NphiesCore 0030 probe 3 PARTIAL: a member could read the row and could not write it, but this workspace has no role holding structure.edit WITHOUT workspace.admin, so the Director half could not be exercised. Verify by hand after granting one.';
    return;
  end if;

  if not v_dir_write then
    raise exception
      'NphiesCore 0030 FAILED: a structure.edit holder who is not an admin could NOT write map_view_settings. Either map_view_settings_update is wrong, or log_config_audit()''s guard has narrowed back to is_admin() — in which case the Director''s legitimate save is refused with a 42501 blamed on the wrong thing.';
  end if;

  raise notice
    'NphiesCore 0030 probe 3: a plain member read the row (1) and could neither update nor delete it; a structure.edit holder who is not an admin saved it. Fixtures rolled back.';
end
$rls$;
