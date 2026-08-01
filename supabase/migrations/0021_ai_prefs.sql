-- 0021 — the per-member AI switch.
--
-- ═══ WHY THIS IS A SEPARATE FILE FROM 0020 ═══
--
-- 0020 is the SPEND LEDGER: how much the assist cost, per member, per day,
-- written only by the service role and readable only by its owner. This is a
-- PREFERENCE: one boolean the member sets themselves, read by the client before
-- a single character of a capture line leaves the browser. Different owner,
-- different writer, different reason to change — and 0020 was already applied
-- live when this gap was found (`ai_usage` present, `notification_prefs.
-- ai_enabled` absent, verified against information_schema on 1 August 2026).
-- Editing an applied migration in place is how a live database and a repo start
-- disagreeing.
--
-- ═══ WHY `notification_prefs` AND NOT A NEW TABLE ═══
--
-- It is the app's ONLY per-member preference row (0011), it already carries the
-- three-policy self-only RLS this column needs, its primary key is `user_id`,
-- and `store/push.ts` already upserts single columns into it on conflict. A
-- second one-boolean table would be a second thing to grant, a second thing to
-- police, and a second thing to remember to clear when a member is deleted —
-- for one column that answers exactly the same kind of question the other four
-- answer: what does this person want the app to do without being asked.
--
-- The name is `ai_enabled` and not `ai_suggestions_enabled` for the same reason
-- the others are `push_*`: the prefix says which feature, the suffix says what
-- kind of switch it is, and the table says whose.
--
-- ═══ DEFAULT TRUE, AND WHY THAT IS NOT A PRIVACY DECISION TAKEN LIGHTLY ═══
--
-- A missing row already means "all on" for the push preferences (0011 PART 2),
-- and the client reads a missing row the same way here. The assist is opt-OUT
-- because the workspace owner is the person whose API key pays for it, who
-- asked for the feature, and who states in Settings › AI assist exactly what is
-- sent — the capture line, and nothing else — before anyone has typed a word.
-- The switch exists so that any member can say no for themselves, on every
-- device at once, and the client refuses to send anything at all until it has
-- READ this column: `store/ai.ts` fails closed on any error that is not "the
-- column does not exist yet".
--
-- ═══ RE-RUNNABLE ═══ `add column if not exists`, grants and comments restated,
-- and a probe at the end that rolls itself back. Same discipline as 0001-0020.


-- ═══ PART 1 ═══ the column

alter table public.notification_prefs
  add column if not exists ai_enabled boolean not null default true;

comment on column public.notification_prefs.ai_enabled is
  'Per-member switch for the AI capture assist. False means the client sends '
  'no capture line to capture-assist at all. A missing ROW means true, the same '
  'reading the push columns get.';


-- ═══ PART 2 ═══ nothing else changes
--
-- No new policy: `notification_prefs_select` / `_insert` / `_update` from 0011
-- are row-level and cover every column, this one included. No new grant: the
-- table-level grants already stand. No trigger: `notification_prefs_touch()`
-- already stamps `updated_at` on every update, including this one.
--
-- Restated here rather than assumed, because the probe below checks it.


-- ═══ PART 3 ═══ the probe
--
-- Proves the three things a reader of this file would otherwise have to take on
-- trust: the column exists, its default is true, and the row-level policies
-- still stand on the table it was added to. Rolls back whatever it wrote.

do $$
declare
  v_default text;
  v_policies integer;
begin
  select column_default into v_default
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'notification_prefs'
    and column_name = 'ai_enabled';

  if v_default is null or v_default not like 'true%' then
    raise exception 'OpsTrack 0021 FAILED: ai_enabled default is %, expected true', v_default;
  end if;

  select count(*) into v_policies
  from pg_policies
  where schemaname = 'public' and tablename = 'notification_prefs';

  if v_policies < 3 then
    raise exception 'OpsTrack 0021 FAILED: notification_prefs carries % policies, expected 3', v_policies;
  end if;

  raise notice 'OpsTrack 0021 OK: ai_enabled present, defaults true, % policies intact', v_policies;
end;
$$;
