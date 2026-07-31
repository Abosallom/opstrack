-- 0017 — label_overrides: the owner renames anything a person reads, in both
-- languages, himself, and it takes effect for everyone without a deploy.
--
-- This is the storage half of Settings › Terminology (docs/TERMINOLOGY-SPEC.md).
-- The ~1,600-key locale surface ships inside the build as JSON, so today every
-- wording change is a code edit and a deploy. This table is an OVERRIDE LAYER
-- read by lib/i18n.ts on top of those bundles:
--
--     override[locale][key]  →  bundle[locale][key]  →  bundle.en[key]  →  key
--
-- Overrides are data. They load once at sign-in with config and vocab, and
-- "reset to default" is `delete the row` — which is why nothing here ever needs
-- to know what the shipped string was.
--
-- ⚠ FILE NUMBER. The spec calls this file `0015_label_overrides.sql`. 0015 was
-- taken by `0015_entry_write_guard_and_line_authorship.sql` while this feature
-- was being built on its own branch, so it lands as 0016. Nothing else changes;
-- there is no ordering dependency between the two beyond "after 0003", which
-- supplies nothing this file needs except the house style it copies.
--
-- ⚠ PENDING APPLICATION. This file has NEVER BEEN RUN. The Supabase management
-- token is revoked, so whoever wrote it could not apply it. `label_overrides`
-- does not exist on the live project (verified: GET /rest/v1/label_overrides
-- returns 404 while /rest/v1/vocab_options returns 200). Nothing in it is live
-- until the owner pastes it into the SQL Editor. The probes at the bottom are
-- how the file proves itself at apply time; a probe failure raises and rolls the
-- whole migration back.
--
-- WHAT HAS BEEN RUN, since "pending" must not be read as "unverified". The three
-- functions below that need no Supabase machinery — label_overrides_norm(),
-- label_overrides_touch() and label_overrides_prune_empty() — were extracted
-- from THIS FILE by text and executed against a real Postgres (pglite 0.5.4) on
-- 2026-07-31, along with probe 1's fixtures. Every blank shape it lists was
-- normalised to null and pruned, a soft hyphen inside a real word survived
-- unchanged, '  Assigned  to  ' stored as 'Assigned  to', a one-sided override
-- survived clearing the other language, and clearing both removed the row. The
-- same run is what measured `select btrim(E'\tx\t')` returning the tabs
-- unchanged — the fact that made the first draft of the normaliser wrong. RLS,
-- the audit trail and the reset RPC still wait on the SQL Editor: they need
-- auth.uid(), profiles and config_audit, which is what probes 2 and 3 are for.
--
-- Deploy: Supabase Dashboard -> SQL Editor -> paste + Run. Re-runnable from the
-- top in any partial state, same discipline as 0001-0015: `create table if not
-- exists`, `add column if not exists`, `drop constraint if exists` before every
-- add, `drop policy if exists` before every create, `drop trigger if exists`
-- before every create, `create or replace` on every function, and probe blocks
-- that roll themselves back. A re-run must not change a single stored override
-- in either direction — there is no seed here at all, which makes that trivially
-- true, and it is the reason there is no seed.
--
--
-- ═══ WHY `key` GETS A FORMAT CHECK AND NOT A MEMBERSHIP CHECK ═══
--
-- The brief asked this question explicitly, so here is the answer and its
-- reasoning. An override for a key no bundle has is HARMLESS — `t()` only ever
-- looks up keys it is asked for, so an orphan row resolves nothing and renders
-- nothing. It is litter, not a hazard. The question is what, if anything, the
-- database should refuse.
--
-- IT MUST NOT CHECK MEMBERSHIP. The key universe lives in `src/locales/**` and
-- ships in the JavaScript bundle; Postgres has no copy of it and must never be
-- given one. A `check (key in (…))` or a lookup table of the 1,595 known keys
-- would be a SECOND SOURCE OF TRUTH that goes stale the moment anyone adds a
-- string — and its failure mode is precisely the one the brief forbids: it
-- rejects a key a FUTURE bundle adds. A wording change would then need a
-- migration, which is the round-trip this whole feature exists to delete. So:
-- no membership constraint, in any form, ever.
--
-- IT SHOULD CHECK SHAPE. A format check costs nothing, cannot go stale, and
-- rejects only things that no bundle can ever legitimately produce: the empty
-- string, a leading or trailing dot, an empty segment (`a..b`), whitespace,
-- newlines, control characters, and a key the length of a paragraph. Those are
-- not future keys — they are paste damage, a truncated import file, or a bug in
-- whatever is writing. Catching them at the table keeps the litter to rows that
-- are merely useless rather than rows that are also unreadable.
--
-- THE CHARACTER CLASS WAS MEASURED, NOT GUESSED, and this is the part worth
-- reading. The obvious regex is camelCase dot-path — `^[a-z][A-Za-z0-9]*(\.…)*$`
-- — and it is WRONG: 22 of the 1,595 keys shipping today already fail it.
--
--     admin.tracks.icon_clipboard-list     underscore AND hyphen
--     dashboard.age0_3                     digits and an underscore
--     export.table.entry_updates           snake_case, mirroring table names
--
-- So the class is `[A-Za-z0-9_-]`, verified to accept all 1,595 English and all
-- 1,857 Arabic leaf keys with zero rejections. If a future namespace needs a
-- character outside it, WIDEN THIS CONSTRAINT IN THE SAME CHANGE — and note the
-- hazard 0002 and 0003 both document for named constraints: dropping before
-- adding leaves the table unconstrained if the add then fails on live data.
-- Widening always succeeds against rows that satisfied the narrower rule, so
-- this direction is safe; narrowing it is not, and would need the data checked
-- first.
--
-- FOUR SEGMENTS DEEP IS LEGAL, and the `*` above is not decoration. Plural nodes
-- are edited one CLDR form at a time (spec rule 2), so the key an override row
-- stores for one is the path to the form, not to the node:
--
--     admin.tracks.slaEffectiveInherited.other      ← the longest key shipping, 40 chars
--     filter.activeCount.one
--
-- Arabic has up to six forms, so a single node yields up to six rows. The bound
-- is 200 characters against a measured maximum of 40 — five times the headroom,
-- and still nowhere near a pasted document.

-- ── label_overrides ─────────────────────────────────────────────────────────
-- `key` is the primary key and there is no surrogate uuid, for the reason 0003
-- gives for (kind, key): the key IS the identity. It is what lib/i18n.ts looks
-- up, what the export/import JSON is keyed by, and what a reviewer reads. A uuid
-- would add a lookup between the only two things that matter.
--
-- BOTH LANGUAGE COLUMNS ARE NULLABLE, and null is load-bearing: it means "no
-- override for this language", which is a real and common case — renaming a
-- field in English while the Arabic stays as shipped. It is deliberately NOT the
-- `not null default ''` that vocab_options uses. There, empty-means-default was
-- forced by a table that must always hold its 17 frozen rows; here a row exists
-- only because someone typed something, so absence can be spelled honestly.
-- Nothing downstream may treat '' as an override — see the normalising trigger.
create table if not exists public.label_overrides (
  key        text primary key,
  en         text,
  ar         text,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

comment on table public.label_overrides is
  'Admin-authored replacements for shipped locale strings, applied over the JSON bundles by lib/i18n.ts. One row per key; en/ar null means "no override in that language"; no row means the shipped string wins. Reset to default = delete the row.';

-- For a project where an earlier cut of this file already landed without them.
-- `create table if not exists` above is a no-op there, so the columns have to be
-- added separately or the constraints below fail against a table that lacks them.
alter table public.label_overrides add column if not exists en text;
alter table public.label_overrides add column if not exists ar text;
alter table public.label_overrides add column if not exists updated_by uuid;
alter table public.label_overrides add column if not exists updated_at timestamptz not null default now();

alter table public.label_overrides drop constraint if exists label_overrides_key_shape;
alter table public.label_overrides add constraint label_overrides_key_shape
  check (key ~ '^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$');

-- Separate from the shape check so the two failures are distinguishable in
-- src/lib/pgError.ts by constraint name — "that is not a key" and "that key is
-- absurdly long" want different sentences.
alter table public.label_overrides drop constraint if exists label_overrides_key_len;
alter table public.label_overrides add constraint label_overrides_key_len
  check (length(key) <= 200);

-- The whole table is read at sign-in and cached in localStorage next to config
-- and vocab, so an unbounded `text` here is a quota footgun several thousand
-- kilometres from where it would be diagnosed: localStorage caps around 5 MB and
-- the failure surfaces as a QuotaExceededError on some later, unrelated write.
-- 4000 is ten times the longest string shipping (`vocabadmin.armBody`, 337
-- characters in English and 257 in Arabic), which is room for any label a person
-- would actually write and not room for a pasted document.
alter table public.label_overrides drop constraint if exists label_overrides_text_len;
alter table public.label_overrides add constraint label_overrides_text_len
  check ((en is null or length(en) <= 4000) and (ar is null or length(ar) <= 4000));

-- NO SECONDARY INDEX, deliberately. There is exactly one read shape — "give me
-- every override", issued once per sign-in — and it is a seq scan over a table
-- that will hold tens of rows. The primary key covers the only point lookup
-- (upsert and single-row reset). An index on `updated_at` or `updated_by` would
-- serve a screen nobody has asked for and would be write amplification on the
-- one operation that matters.

alter table public.label_overrides enable row level security;

-- Policies in the InitPlan form 0009 established: `(select public.is_member())`
-- rather than `public.is_member()`, so the predicate is evaluated once at the
-- top of the plan instead of once per surviving row. See 0009's header for the
-- measurement and the reasoning; a new table written in the old form would be a
-- silent regression of that work and would be caught by 0009's probe only if
-- that file were re-run.
--
-- EVERY MEMBER READS IT. This is not an admin-only table even though only admins
-- write it: a member who could not read it would see the shipped English or
-- Arabic while everyone else saw the owner's wording, which is worse than having
-- no feature. It is the same reasoning as vocab_options_select — nobody can
-- render a screen without it.
drop policy if exists label_overrides_select on public.label_overrides;
create policy label_overrides_select on public.label_overrides
  for select using ((select public.is_member()));

-- Writes are admin-only, exactly like tracks and vocab_options. Unlike
-- vocab_options — whose 17 rows are frozen, so its insert/delete policies exist
-- only for completeness — INSERT and DELETE here are both load-bearing app
-- paths: insert is how an override is created, and delete is how "reset to
-- default" works. There is no update-only shortcut to take.
drop policy if exists label_overrides_insert on public.label_overrides;
create policy label_overrides_insert on public.label_overrides
  for insert with check ((select public.is_admin()));

drop policy if exists label_overrides_update on public.label_overrides;
create policy label_overrides_update on public.label_overrides
  for update using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists label_overrides_delete on public.label_overrides;
create policy label_overrides_delete on public.label_overrides
  for delete using ((select public.is_admin()));

-- No explicit `grant` statement, matching vocab_options and tracks. Supabase
-- ships `alter default privileges in schema public grant all on tables to
-- postgres, anon, authenticated, service_role`, so a table created here is
-- already reachable by both roles and the policies above are what actually
-- decide. Verified on the live project against the analogous table: an anon
-- `GET /rest/v1/vocab_options` returns `[]` — reachable, and denied every row.
-- (Views are the exception and DO need an explicit grant; 0003's v_entry_health
-- says so. This is a table.)


-- ── normalise, then stamp ───────────────────────────────────────────────────
-- ONE trigger doing two jobs, fused on purpose. Two BEFORE triggers fire in
-- alphabetical order by trigger name, and this pair has a hard ordering
-- dependency: normalising must happen BEFORE the change is diffed, or a PATCH
-- setting `en` to '' when `en` is already null reads as a change ('' is distinct
-- from null), stamps updated_at, and writes an audit row saying an edit happened
-- when nothing did. Relying on two trigger names sorting the right way is a
-- correctness argument made out of spelling, so the two live in one function.
--
-- BLANK MEANS DEFAULT (spec rule 5), enforced here rather than trusted to the
-- client, through `label_overrides_norm()` below. This matters because null and
-- '' are NOT equivalent downstream: null means "no override, use the shipped
-- string", while '' would be an override to the empty string — a nav item, a
-- button or a column heading rendering as blank space, which is exactly the way
-- this screen could make the app unusable. The resolution order in lib/i18n.ts
-- must skip null; with this trigger in place it never has to decide what ''
-- means, because '' cannot be stored. Belt and braces on purpose: the client
-- should also send null, but the rule that keeps the app usable does not get to
-- depend on the client.
--
-- Trimmed, not just tested: a label of " Owner" is a typo whose only symptom is
-- a stray space in the UI, and trimming both ends is what every text input in
-- the app already does. Interior whitespace is left alone.
--
-- The stamp is DIFFED rather than unconditional, for the reason vocab_touch()
-- gives: an import applies many rows in one statement, and an unconditional
-- stamp would report every key in the file as edited — and emit a full set of
-- audit rows — on an import that changed three of them.
--
-- updated_by is resolved THROUGH profiles rather than taken raw from auth.uid():
-- a JWT without a profile row would violate the FK, and that failure would
-- surface as the admin's perfectly legitimate rename being rejected.
-- ── what "blank" means, in one place ────────────────────────────────────────
-- Trim the ends, and answer NULL when what is left is empty TO A READER.
--
-- THE FIRST DRAFT WAS `nullif(btrim(x), '')` AND IT WAS WRONG TWICE, in ways
-- that both end with a label rendering as blank space:
--
--   · one-argument `btrim()` removes SPACES ONLY. `select btrim(E'\tx\t')`
--     returns E'\tx\t' — measured, not assumed. So a pasted tab, newline or
--     carriage return was neither trimmed nor recognised as empty, and the
--     comment above this function claimed the opposite for weeks.
--   · no notion of whitespace, in Postgres or in JavaScript, covers the
--     INVISIBLE FORMAT CHARACTERS: U+200B zero-width space, U+200E/U+200F the
--     bidi marks, U+061C the Arabic letter mark, U+2060 word joiner, U+00AD soft
--     hyphen, U+FEFF byte-order mark, and the four isolates U+2066–U+2069. Every
--     one renders as nothing and every one is `<> ''`. They are exactly what a
--     paste out of Word, Outlook or a web page carries, and an override holding
--     one of them was stored, resolved and rendered as an empty label — up to
--     and including this screen's own "Reset every change" button.
--
-- The trim class is String.trim()'s, character for character, so this function
-- and lib/labelOverrides.ts's isBlankLabel() cannot disagree about a value: the
-- client refuses to produce one of these and the database refuses to keep one.
-- `translate(v, set, '')` deletes every character of `set` — no regex dialect to
-- get wrong — and it is used ONLY for the emptiness test. What gets STORED is
-- the trimmed original, invisible characters intact, because a soft hyphen
-- inside a real word is a legitimate thing to type.
create or replace function public.label_overrides_norm(v text)
returns text
language sql
immutable
set search_path = public
as $$
  -- The escapes are spelled out rather than pasted: a SQL file a human is going
  -- to copy into the dashboard must not contain characters he cannot see.
  --   trim set  = String.trim()'s exactly — space, tab, LF, VT, FF, CR, NBSP,
  --               U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000
  --               and U+FEFF.
  --   strip set = the invisible FORMAT characters: soft hyphen, Arabic letter
  --               mark, the zero-width family, the bidi marks, the word joiner,
  --               the invisible operators, the four isolates and the BOM.
  select case
           when v is null then null
           when translate(
                  btrim(v, E' \t\n\u000B\u000C\r\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF'),
                  E'\u00AD\u061C\u200B\u200C\u200D\u200E\u200F\u2060\u2061\u2062\u2063\u2064\u2066\u2067\u2068\u2069\uFEFF',
                  ''
                ) = '' then null
           else btrim(v, E' \t\n\u000B\u000C\r\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF')
         end
$$;

create or replace function public.label_overrides_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.en := public.label_overrides_norm(new.en);
  new.ar := public.label_overrides_norm(new.ar);

  if tg_op = 'INSERT' then
    new.updated_at := now();
    new.updated_by := (select p.id from public.profiles p where p.id = auth.uid());
    return new;
  end if;

  if (new.en, new.ar) is distinct from (old.en, old.ar) then
    new.updated_at := now();
    new.updated_by := coalesce(
      (select p.id from public.profiles p where p.id = auth.uid()),
      old.updated_by
    );
  else
    -- A no-op write must not be able to erase the bookkeeping either. Without
    -- these two lines a bare `{"updated_by": null}` PATCH is stored verbatim,
    -- which is the defect 0015 fixed on entries the hard way.
    new.updated_at := old.updated_at;
    new.updated_by := old.updated_by;
  end if;

  return new;
end;
$$;

drop trigger if exists label_overrides_touch_trg on public.label_overrides;
create trigger label_overrides_touch_trg
  before insert or update on public.label_overrides
  for each row execute function public.label_overrides_touch();


-- ── a row that overrides nothing deletes itself ─────────────────────────────
-- After the trigger above, a row whose `en` and `ar` are BOTH null is a row that
-- overrides nothing in either language. It is not an error — it is what
-- "clear both boxes" produces — and the state it describes is exactly the state
-- of having no row at all.
--
-- WHY A PRUNE AND NOT A `check (en is not null or ar is not null)`. The check
-- was the first draft and it is wrong. Spec rule 4 says it must be impossible to
-- render the app unusable and be unable to get back, and rule 5 says blank means
-- default. A check turns the most natural way to undo a rename — select the
-- text, delete it, save — into a 23514 the owner reads as the app refusing to
-- take back his own change, and it does so at the precise moment he is trying to
-- fix something. The escape hatch cannot have a wrong door. With the prune,
-- every route converges on the same state: blank the boxes, or delete the row,
-- or import a JSON with nulls — the row is gone and the shipped string returns.
--
-- No recursion: the delete fires this table's DELETE triggers (the audit one,
-- which writes elsewhere), and nothing re-enters INSERT or UPDATE.
--
-- ONE OBSERVABLE ODDITY, FOR WHOEVER WRITES THE STORE. PostgREST computes
-- `Prefer: return=representation` from the row as BEFORE-triggers left it, and
-- AFTER triggers run later — so an upsert that blanks both languages returns a
-- row `{key, en: null, ar: null}` that no longer exists by the time the response
-- is written. This is safe to ignore rather than special-case: a cached
-- {en: null, ar: null} and an absent row resolve IDENTICALLY through the
-- override layer, because the resolver skips null and falls through to the
-- bundle either way. The divergence is unobservable in the UI and disappears on
-- the next load. Do not add a re-read to "fix" it.
create or replace function public.label_overrides_prune_empty()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.en is null and new.ar is null then
    delete from public.label_overrides where key = new.key;
  end if;
  return null;
end;
$$;

-- Named to sort AFTER label_overrides_audit_trg. Same-timing triggers fire in
-- alphabetical order, so the insert/update is audited first and the prune's
-- delete is audited second — which is the honest sequence and reads correctly in
-- the trail. Unlike the fused BEFORE trigger above this ordering is a nicety
-- rather than a correctness requirement, but it is why the name is not
-- `label_overrides_empty_trg`.
drop trigger if exists label_overrides_prune_trg on public.label_overrides;
create trigger label_overrides_prune_trg
  after insert or update on public.label_overrides
  for each row execute function public.label_overrides_prune_empty();


-- ── audit ───────────────────────────────────────────────────────────────────
-- Renaming what every screen in the product says is exactly the kind of change
-- 0002 built config_audit for: rare, consequential, done by one person with
-- nobody watching. It is also the one this table makes EASIEST to do by
-- accident, since a rename here is a text box rather than a deploy — and the
-- `before` image is the only record of what a label used to say, because this
-- table never stored the shipped string in the first place.
--
-- row_id is null because config_audit.row_id is a uuid and this table's identity
-- is a text key, the same call vocab_audit() makes. The key rides in the
-- before/after row images, which is where a reader looks anyway.
--
-- Casts on the nulls: with a single candidate Postgres resolves an untyped null
-- fine today, but an overload added later would make this ambiguous at runtime,
-- inside a trigger, on someone else's write. 0002 says the same.
create or replace function public.label_overrides_audit()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_config_audit('label_overrides', null::uuid, 'insert', null::jsonb, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    if to_jsonb(new) is distinct from to_jsonb(old) then
      perform public.log_config_audit('label_overrides', null::uuid, 'update', to_jsonb(old), to_jsonb(new));
    end if;
    return new;
  else
    perform public.log_config_audit('label_overrides', null::uuid, 'delete', to_jsonb(old), null::jsonb);
    return old;
  end if;
end;
$$;

-- AFTER, not BEFORE: the row image recorded must be the one that survived every
-- other trigger and constraint on the table.
drop trigger if exists label_overrides_audit_trg on public.label_overrides;
create trigger label_overrides_audit_trg
  after insert or update or delete on public.label_overrides
  for each row execute function public.label_overrides_audit();


-- ── reset_label_overrides() ─────────────────────────────────────────────────
-- The global escape hatch of spec rule 4, and the reason it is an RPC rather
-- than a DELETE from the client: PostgREST refuses an unfiltered DELETE by
-- design, so "reset everything" has no honest expression over the REST door —
-- and faking a filter that matches all rows is how a client ends up deleting
-- more than it meant to on the day the filter is wrong.
--
-- SECURITY INVOKER, following reorder_vocab()/reset_vocab() in 0003: it exists
-- for ATOMICITY, not privilege. RLS still evaluates against the caller and
-- rejects a member exactly as if they had typed the DELETE by hand. The
-- is_admin() test at the top is not the authorization — it is there so a member
-- gets a clean 42501 that pgError.ts already maps to admin.errForbidden, instead
-- of a silent zero-row delete reported to them as success.
--
-- Returns how many rows were actually removed, so the toast can say "nothing to
-- reset" honestly rather than claiming a reset that had nothing to do — the same
-- courtesy reset_vocab() pays.
--
-- p_key null resets everything; a key resets one row, so the per-row Reset and
-- the global Reset all are one code path with one audit shape. Every deleted row
-- is audited by label_overrides_audit_trg with its full `before` image, so a
-- reset-all is recoverable by reading config_audit — which is the property that
-- makes a confirm()-guarded destructive button acceptable at all.
create or replace function public.reset_label_overrides(p_key text default null)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count int;
begin
  if not public.is_admin() then
    raise exception 'only an admin may reset label overrides' using errcode = '42501';
  end if;

  delete from public.label_overrides o
   where p_key is null or o.key = p_key;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- `from public` is not enough on Supabase, and 0002's note above
-- log_config_audit() explains why at length: every project ships `alter default
-- privileges in schema public grant all on functions to postgres, anon,
-- authenticated, service_role`, so `anon` holds its own explicit grant that a
-- revoke from PUBLIC does not touch. This function is SECURITY INVOKER and
-- is_admin() is false for anon, so the exposure would be a clean rejection
-- rather than a breach — but the revoke costs nothing and keeps the door shape
-- identical to every other RPC in the tree.
revoke all on function public.reset_label_overrides(text) from public;
revoke all on function public.reset_label_overrides(text) from anon;
grant execute on function public.reset_label_overrides(text) to authenticated;


-- ═══ PROBE 1 ═══ blank means default, and a row that overrides nothing goes
--                away — by every route a client can take
-- Spec rules 4 and 5 are the two this table can actually enforce, and they are
-- the two whose failure is worst: an empty override renders a blank nav item or
-- a blank button, and a clear that does not clear leaves the owner stuck with a
-- rename he cannot undo.
--
-- Runs as whoever is applying the file (the SQL Editor, i.e. no JWT), which is
-- the right role for this probe: it tests the TRIGGERS, not the policies. RLS is
-- probe 3's job.
do $prove$
declare
  v_en_after     text;
  v_ar_after     text;
  v_blank_rows   int;
  v_ws_rows      int;
  v_trim         text;
  v_blank        text;
  v_invisible    int;
  v_kept         text;
  v_ghost        uuid := gen_random_uuid();
  v_forged_by    uuid;
  v_forged_at    timestamptz;
begin
  begin
    -- '' in one language, a real string in the other: the '' must become null
    -- and the row must SURVIVE, because it still overrides Arabic.
    insert into public.label_overrides (key, en, ar)
      values ('probe0016.oneSided', '', 'مسمّى');
    select en, ar into v_en_after, v_ar_after
      from public.label_overrides where key = 'probe0016.oneSided';

    -- Both blank on INSERT: normalised to null, then pruned. Never exists.
    insert into public.label_overrides (key, en, ar)
      values ('probe0016.bornEmpty', '', '');
    select count(*) into v_blank_rows
      from public.label_overrides where key = 'probe0016.bornEmpty';

    -- Whitespace only, and via UPDATE rather than INSERT — the route the UI
    -- actually takes when the owner selects the text and deletes it.
    insert into public.label_overrides (key, en, ar)
      values ('probe0016.clearedLater', 'Owner', null);
    update public.label_overrides set en = '   ' where key = 'probe0016.clearedLater';
    select count(*) into v_ws_rows
      from public.label_overrides where key = 'probe0016.clearedLater';

    -- EVERY OTHER WAY A BOX CAN LOOK EMPTY, one row each, because the first cut
    -- of this file used `nullif(btrim(x), '')` and caught only two of them:
    -- one-argument btrim removes SPACES ONLY (`select btrim(E'\tx\t')` returns
    -- the tabs unchanged — measured), and no notion of whitespace anywhere
    -- covers the invisible FORMAT characters a paste out of Word, Outlook or a
    -- web page carries. Each value below was stored, resolved and rendered as a
    -- label with nothing in it, including on this screen's own Reset buttons.
    --
    -- Escapes, never pasted characters: this file is copied into a dashboard by
    -- a human, and a probe he cannot read is a probe he cannot trust.
    v_invisible := 0;
    foreach v_blank in array array[
      E'\t', E'\n', E'\r',        -- the whitespace one-argument btrim misses
      E'\u00A0',                  -- no-break space
      E'\u200B',                  -- zero-width space
      E'\u200E', E'\u200F',       -- the bidi marks
      E'\u061C',                  -- Arabic letter mark
      E'\u2060',                  -- word joiner
      E'\u00AD',                  -- soft hyphen
      E'\uFEFF',                  -- byte-order mark
      E'\u2068\u2069',            -- an isolate pair around nothing
      E' \u200B '                 -- and one hiding between two spaces
    ] loop
      insert into public.label_overrides (key, en) values ('probe0016.invisible', v_blank);
      -- The row must never survive: normalised to null by the touch trigger,
      -- then removed by the prune trigger.
      v_invisible := v_invisible
        + (select count(*) from public.label_overrides where key = 'probe0016.invisible');
    end loop;

    -- …while an invisible character INSIDE a real label is left alone. A soft
    -- hyphen in a long word is a legitimate thing to type; only the EMPTINESS
    -- test is allowed to look through these characters, never the stored value.
    insert into public.label_overrides (key, en)
      values ('probe0016.keepsInvisible', E'Owner\u00ADship');
    select en into v_kept from public.label_overrides where key = 'probe0016.keepsInvisible';

    -- Both bookkeeping columns are SERVER-CONTROLLED: a client that supplies its
    -- own updated_by and updated_at must have both discarded.
    --
    -- Note what this probe canNOT test, so nobody adds a check that looks
    -- stronger and is vacuous: `now()` is the TRANSACTION timestamp, so every
    -- write inside this block stamps the identical instant. Comparing updated_at
    -- before and after a no-op would pass whether or not the stamp is
    -- conditional, which is worse than not testing it. Setting updated_at to a
    -- distinctive past value first does not rescue it either — that write is
    -- itself a no-op content-wise, so the else-branch in label_overrides_touch()
    -- correctly reverts it and the fixture never lands. The conditional-stamp
    -- behaviour is instead pinned where it IS observable: probe 3 checks that a
    -- bare `{"updated_by": null}` PATCH cannot erase a real author.
    --
    -- The fixture profile arrives through auth.users because profiles.id
    -- references it; a synthetic id cannot be inserted at all. It exists only to
    -- be a VALID FK target, so that a rejected forge is proved by the value
    -- being dropped rather than by the FK refusing it.
    insert into auth.users (id, email, raw_user_meta_data)
      values (v_ghost, 'probe-ghost-' || v_ghost || '@0016.invalid',
              jsonb_build_object('display_name', '0016 Probe Ghost'));

    -- The guard matters here specifically. If the profile does NOT exist and the
    -- forge is NOT rejected, the insert below fails on the FK with a bare 23503
    -- that this block does not handle — the migration would abort on a confusing
    -- error instead of the clear message at the bottom of this probe.
    if not exists (select 1 from public.profiles where id = v_ghost) then
      raise exception 'OpsTrack 0016 PROBE 1 SETUP FAILED: handle_new_user() did not create the fixture profile.';
    end if;

    insert into public.label_overrides (key, en, updated_by, updated_at)
      values ('probe0016.forged', 'Owner', v_ghost, '1999-01-01T00:00:00Z');
    select updated_by, updated_at into v_forged_by, v_forged_at
      from public.label_overrides where key = 'probe0016.forged';

    raise exception using errcode = 'OT016', message = 'probe rollback';
  exception
    when sqlstate 'OT016' then
      null; -- subtransaction discarded; the reads above survive
  end;

  if v_en_after is not null then
    raise exception
      'OpsTrack 0017 FAILED: an empty-string `en` was stored as % instead of null. label_overrides_touch() is not normalising, and a blank override will render as an empty label (spec rule 5).',
      quote_literal(v_en_after);
  end if;

  if v_ar_after is distinct from 'مسمّى' then
    raise exception
      'OpsTrack 0016 FAILED: clearing `en` also lost `ar` (now %). One-sided overrides are a required case.',
      coalesce(quote_literal(v_ar_after), 'NULL');
  end if;

  if v_blank_rows <> 0 then
    raise exception
      'OpsTrack 0017 FAILED: a row inserted with both languages blank still exists. label_overrides_prune_empty() did not fire on INSERT.';
  end if;

  if v_ws_rows <> 0 then
    raise exception
      'OpsTrack 0016 FAILED: blanking the last remaining language via UPDATE left the row behind. The owner cannot undo a rename by clearing the box (spec rules 4 and 5).';
  end if;

  if v_invisible <> 0 then
    raise exception
      'OpsTrack 0017 FAILED: % of the invisible-blank rows survived. label_overrides_norm() is not treating a tab, a no-break space or a format character (U+200B, U+200E, U+200F, U+061C, U+2060, U+00AD, U+FEFF, the isolates) as empty — so an override holding one of them is stored and renders as a label with nothing in it (spec rule 5).',
      v_invisible;
  end if;

  if v_kept is distinct from E'Owner\u00ADship' then
    raise exception
      'OpsTrack 0016 FAILED: a soft hyphen INSIDE a real label was altered (stored %). Only the emptiness test may look through invisible characters; the stored value is what the owner typed.',
      coalesce(quote_literal(v_kept), 'NULL');
  end if;

  if v_trim is distinct from 'Assigned  to' then
    raise exception
      'OpsTrack 0016 FAILED: btrim stored % — expected the ends trimmed and the interior spacing intact.',
      coalesce(quote_literal(v_trim), 'NULL');
  end if;

  if v_forged_by is not null then
    raise exception
      'OpsTrack 0016 FAILED: a client-supplied updated_by (%) was stored. Authorship is server-controlled — this file was applied with no JWT, so the only correct answer is null.',
      v_forged_by;
  end if;

  if v_forged_at < timestamptz '2000-01-01' then
    raise exception
      'OpsTrack 0017 FAILED: a client-supplied updated_at was stored verbatim (%). The column default does not protect it — an explicit value overrides a default, so label_overrides_touch() must assign it on INSERT.',
      v_forged_at;
  end if;

  raise notice
    'OpsTrack 0016 probe 1: blank normalised to null, one-sided overrides survived, all-blank rows pruned on both INSERT and UPDATE — including a tab, a no-break space and every invisible format character — a soft hyphen inside a real label survived intact, ends trimmed, and a client could not forge either bookkeeping column. Rolled back.';
end
$prove$;


-- ═══ PROBE 2 ═══ the key constraint accepts every shape the bundles produce
--                and rejects only damage
-- The failure this guards against is the expensive one: a constraint that looks
-- reasonable and quietly refuses a key someone adds next month. The accept list
-- below is drawn from keys shipping TODAY — including the three families that
-- break a camelCase-only regex — plus the four-segment plural form.
do $prove$
declare
  v_key      text;
  v_rejected text := null;
  v_accepted text := null;
begin
  begin
    foreach v_key in array array[
      'nav.board',                                -- the ordinary case
      'entry.createdBy',                          -- camelCase
      'admin.tracks.icon_clipboard-list',         -- underscore AND hyphen
      'dashboard.age0_3',                         -- digits + underscore
      'export.table.entry_updates',               -- snake_case
      'admin.tracks.slaEffectiveInherited.other', -- four segments: a plural form
      'filter.activeCount.one',
      'A',                                        -- single char, uppercase
      'settings.terminology.title'                -- this feature's own screen
    ] loop
      begin
        insert into public.label_overrides (key, en) values (v_key, 'x');
      exception when check_violation then
        v_rejected := coalesce(v_rejected || ', ', '') || v_key;
      end;
    end loop;

    foreach v_key in array array[
      '',                       -- empty
      '.leading',
      'trailing.',
      'double..dot',
      'has space',
      E'has\nnewline',
      'unicode.مفتاح',          -- not a bundle key shape; keys are ASCII paths
      repeat('a', 201)          -- past the length bound
    ] loop
      begin
        insert into public.label_overrides (key, en) values (v_key, 'x');
        v_accepted := coalesce(v_accepted || ', ', '') || quote_literal(v_key);
      exception when check_violation then
        null; -- correctly refused
      end;
    end loop;

    raise exception using errcode = 'OT016', message = 'probe rollback';
  exception
    when sqlstate 'OT016' then
      null;
  end;

  if v_rejected is not null then
    raise exception
      'OpsTrack 0017 FAILED: label_overrides_key_shape rejected keys that SHIP TODAY: %. The character class is too narrow — it must be at least [A-Za-z0-9_-] with dot separators. Widen it; do not work around it in the client.',
      v_rejected;
  end if;

  if v_accepted is not null then
    raise exception
      'OpsTrack 0016 FAILED: the key constraint accepted malformed keys: %. These are paste damage or a truncated import, never a future bundle key.',
      v_accepted;
  end if;

  raise notice
    'OpsTrack 0016 probe 2: all nine real key shapes accepted (including snake_case, hyphens, digits and four-segment plural forms), all eight malformed ones refused. Rolled back.';
end
$prove$;


-- ═══ PROBE 3 ═══ a member reads and cannot write; an admin writes; the trail
--                records it
-- The client half needs the ROLE, not just the JWT, so this probe does `set
-- local role authenticated`. If that role is not grantable to whoever is running
-- this file, the probe says so and SKIPS rather than failing the migration — the
-- policies are installed either way, and a false failure here would send an
-- operator hunting a bug that is not there. 0015's probe 3 makes the same
-- allowance for the same reason.
--
-- Fixtures come in through auth.users and handle_new_user(), the way 0012's and
-- 0015's probes build theirs: profiles.id references auth.users (id), so a
-- synthetic profile id cannot be inserted at all.
do $prove$
declare
  v_admin   uuid := gen_random_uuid();
  v_member  uuid := gen_random_uuid();
  v_read    text;
  v_wrote   boolean := false;
  v_stamp   uuid;
  v_erased  uuid;
  v_audit0  int;
  v_audit   int;
  v_reset   int;
  v_left    int;
  v_all     int;
  v_skipped boolean := false;
begin
  -- Baselines, taken OUTSIDE the fixture block and before anything is written.
  -- Both counts below are deltas against these, because this file promises to be
  -- re-runnable and a project that already holds real overrides and a real audit
  -- trail must not fail a probe. (The probe's own writes are rolled back either
  -- way, so live data was never at risk — but a SPURIOUS FAILURE would stop the
  -- owner applying the migration at all, which is the expensive outcome.)
  select count(*) into v_audit0 from public.config_audit where table_name = 'label_overrides';

  begin
    insert into auth.users (id, email, raw_user_meta_data) values
      (v_admin,  'probe-admin-'  || v_admin  || '@0016.invalid',
       jsonb_build_object('display_name', '0016 Probe Admin')),
      (v_member, 'probe-member-' || v_member || '@0016.invalid',
       jsonb_build_object('display_name', '0016 Probe Member'));

    if (select count(*) from public.profiles where id in (v_admin, v_member)) <> 2 then
      raise exception 'OpsTrack 0016 PROBE 3 SETUP FAILED: handle_new_user() did not create the fixture profiles.';
    end if;

    -- handle_new_user() hardcodes 'member'; this write is the SQL-Editor path
    -- guard_profile_role() allows.
    update public.profiles set role = 'admin' where id = v_admin;

    -- The skip test is SCOPED TO THE ROLE SWITCH ALONE, and that scoping is the
    -- point. An earlier draft wrapped the whole client half in `exception when
    -- insufficient_privilege then v_skipped := true`, which quietly swallowed the
    -- most important failure this probe can detect: a broken insert policy raises
    -- 42501 ("new row violates row-level security policy") too, and would have
    -- been reported as "skipped" — a green-looking migration with an admin who
    -- cannot save a rename. Only the `set role` may set v_skipped.
    begin
      perform set_config('request.jwt.claims',
                         json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
      set local role authenticated;
    exception when insufficient_privilege then
      v_skipped := true;
    end;

    if not v_skipped then
      -- ── as the admin, exactly as PostgREST arrives ──
      insert into public.label_overrides (key, en, ar)
        values ('probe0016.rls', 'Owner', 'المسؤول');
      select updated_by into v_stamp
        from public.label_overrides where key = 'probe0016.rls';

      -- ── as a plain member ──
      perform set_config('request.jwt.claims',
                         json_build_object('sub', v_member, 'role', 'authenticated')::text, true);

      select en into v_read from public.label_overrides where key = 'probe0016.rls';

      -- RLS makes a blocked UPDATE affect zero rows rather than raise, which is
      -- the whole reason lib/permissions.ts exists. Count rows, do not catch.
      update public.label_overrides set en = 'Hijacked' where key = 'probe0016.rls';
      if found then v_wrote := true; end if;

      -- and the member's reset must be refused outright, by the explicit guard
      begin
        perform public.reset_label_overrides(null);
        v_wrote := true;
      exception when insufficient_privilege then
        null; -- 42501, as intended
      end;

      -- ── back to the admin ──
      perform set_config('request.jwt.claims',
                         json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

      -- A bare `{"updated_by": null}` PATCH — the shape PostgREST sends when a
      -- client serialises the whole row back — must not erase the author. This
      -- is where the conditional stamp in label_overrides_touch() is observable
      -- (probe 1 explains why it is not observable there), and it is the defect
      -- 0015 had to fix on `entries` after it shipped.
      update public.label_overrides set updated_by = null where key = 'probe0016.rls';
      select updated_by into v_erased
        from public.label_overrides where key = 'probe0016.rls';

      -- KEY-SCOPED, not the null-arg form: on a project that already holds real
      -- overrides, `reset_label_overrides(null)` would legitimately delete all of
      -- them and return a count greater than 1, failing an assertion that has
      -- nothing to do with what is being tested. The null-arg form is exercised
      -- separately below, where the assertion is "the table is empty" — which is
      -- true regardless of how many rows it started with.
      select public.reset_label_overrides('probe0016.rls') into v_reset;
      select count(*) into v_left from public.label_overrides where key = 'probe0016.rls';

      select public.reset_label_overrides(null) into v_all;
      select count(*) into v_all from public.label_overrides;

      reset role;
    end if;

    if not v_skipped then
      select count(*) - v_audit0 into v_audit
        from public.config_audit
       where table_name = 'label_overrides';
    end if;

    raise exception using errcode = 'OT016', message = 'probe rollback';
  exception
    when sqlstate 'OT016' then
      null;
  end;

  if v_skipped then
    raise notice
      'OpsTrack 0017 probe 3 SKIPPED: this role cannot `set role authenticated`, so the RLS half could not run. The policies ARE installed. Verify by hand: sign in as a member and PATCH /rest/v1/label_overrides — it must affect zero rows.';
    return;
  end if;

  if v_read is distinct from 'Owner' then
    raise exception
      'OpsTrack 0017 FAILED: a member read % instead of the override. label_overrides_select is too strict — a member who cannot read this table sees different words than everyone else, which is worse than shipping no feature at all.',
      coalesce(quote_literal(v_read), 'NULL');
  end if;

  if v_wrote then
    raise exception
      'OpsTrack 0017 FAILED: a plain member changed or reset a label override. The write policies are not admin-gated.';
  end if;

  if v_stamp is distinct from v_admin then
    raise exception
      'OpsTrack 0016 FAILED: updated_by is % instead of the admin who wrote it. The rename has nobody''s name on it.',
      coalesce(v_stamp::text, 'NULL');
  end if;

  if v_erased is distinct from v_admin then
    raise exception
      'OpsTrack 0017 FAILED: a bare {"updated_by": null} PATCH erased the author (now %). label_overrides_touch() needs the else-branch that restores old.updated_by — without it the client''s value is simply stored, and the rename loses the only record of who made it.',
      coalesce(v_erased::text, 'NULL');
  end if;

  if v_reset <> 1 or v_left <> 0 then
    raise exception
      'OpsTrack 0017 FAILED: reset_label_overrides(''probe0016.rls'') reported % deletions and left % rows. Per-row reset — the escape hatch behind every Reset button — does not work.',
      v_reset, v_left;
  end if;

  if v_all <> 0 then
    raise exception
      'OpsTrack 0017 FAILED: reset_label_overrides(null) left % rows behind. The global escape hatch does not work, and spec rule 4 requires that it always does.',
      v_all;
  end if;

  if v_audit < 2 then
    raise exception
      'OpsTrack 0017 FAILED: this probe added only % config_audit rows for label_overrides — expected at least the insert and the reset delete. A rename with no trail is the one thing config_audit exists to prevent, and `before` is the ONLY record of what a label used to say.',
      v_audit;
  end if;

  raise notice
    'OpsTrack 0016 probe 3: a member read the override and could neither patch nor reset it, the admin''s write carried his id and survived a bare null erase, both reset forms cleared, and the acts are in config_audit. Rolled back.';
end
$prove$;
