-- 0009 — the RLS predicates stop running once per row, and closed_at gets the
-- index every closed-window read has been asking for.
--
-- Deploy: Supabase Dashboard -> SQL Editor -> paste + Run. Re-runnable from the
-- top in any state, same discipline as 0001-0008: `drop policy if exists`
-- before every `create policy`, `create index if not exists`, and a
-- self-verifying probe block at the bottom that rolls itself back.
--
-- NOTHING HERE CHANGES WHO CAN DO WHAT. Every policy below is the policy that
-- was already live, with the same name, the same command, the same roles
-- (PERMISSIVE, to `public`) and the same boolean — re-expressed so the planner
-- evaluates the constant half once instead of once per surviving row. The 37
-- policies were read out of `pg_policies` on the live project and transcribed;
-- the probe at the bottom re-reads `pg_policies` and fails the migration if any
-- of them is still in the per-row form.
--
--
-- ═══ PART 1 ═══ the InitPlan form
--
-- WHAT WAS WRONG
-- Every policy in 0001-0008 was written the obvious way:
--
--   using (public.is_member())
--
-- `is_member()` is `stable security definer`, so Postgres is free to call it
-- once — but only if it can prove the call does not depend on the row. Security
-- quals are not eligible for the pseudoconstant gating that ordinary WHERE
-- clauses get, so it does not prove it, and the function runs FOR EVERY ROW THE
-- SCAN SURVIVES. Each call is an `exists (select 1 from profiles …)`.
--
-- Wrapping the call in a scalar subquery — `(select public.is_member())` —
-- makes it an InitPlan: evaluated once, at the top of the plan, and referenced
-- as a constant thereafter. This is Supabase's own documented advice for the
-- same reason.
--
-- MEASURED ON THIS PROJECT, 5 000 synthetic entries in a rolled-back
-- transaction, `set role authenticated` with a real member's jwt claims:
--
--   open working set (listEntries)     seq scan + top-N,  3 108 buffers
--   v_entry_health (security_invoker)  pays it on THREE tables per row
--
-- and the filter reads `Filter: (… AND is_member())` in every plan — the
-- literal evidence that the call is inside the per-row filter rather than above
-- it. After this migration the same plans read `InitPlan 1` / `(never
-- executed)` on the subplan, and the filter references `$0`.
--
-- Latent at ten live rows. It is the app's primary read, the fix is mechanical
-- and semantics-free, and it stops being latent the first busy month.
--
-- `auth.uid()` IS WRAPPED TOO, and for exactly the same reason: it is a stable
-- function reading a GUC, called once per row inside the same quals. It is
-- compared against a column in eight of these policies, and `created_by =
-- (select auth.uid())` is the identical predicate with the constant hoisted.
--
-- NO EXPLICIT `begin;`/`commit;` IN THIS FILE, on purpose and like 0006 and
-- 0008. The SQL Editor runs a pasted file as one implicit transaction, which is
-- what lets the probe at the bottom fail the WHOLE migration — the promise
-- RUNBOOK 5.2 makes about probe-bearing files: "A probe failure means the
-- migration did not take." An earlier draft committed PART 1 before the probe
-- ran, so a probe failure left the policies rewritten while telling the
-- operator they were not, and RUNBOOK 5.1's fingerprint (which looks for
-- `entries_closed_idx`, created after that commit) would have reported NO on a
-- database whose policies had in fact changed. Do not reintroduce them.

-- ── config_audit ───────────────────────────────────────────────────────────
drop policy if exists config_audit_select on public.config_audit;
create policy config_audit_select on public.config_audit
  for select using ((select public.is_admin()));

-- ── entries ────────────────────────────────────────────────────────────────
drop policy if exists entries_select on public.entries;
create policy entries_select on public.entries
  for select using ((select public.is_member()));

drop policy if exists entries_insert on public.entries;
create policy entries_insert on public.entries
  for insert with check ((select public.is_member()) and created_by = (select auth.uid()));

-- The widened update from 0004 (see src/lib/permissions.ts's
-- ENTRIES_UPDATE_IS_OPEN — that constant mirrors THIS line and must be flipped
-- in the same commit if this ever narrows).
drop policy if exists entries_update on public.entries;
create policy entries_update on public.entries
  for update using ((select public.is_member()))
  with check ((select public.is_member()));

drop policy if exists entries_delete on public.entries;
create policy entries_delete on public.entries
  for delete using ((select public.is_admin()));

-- ── entry_updates ──────────────────────────────────────────────────────────
drop policy if exists entry_updates_select on public.entry_updates;
create policy entry_updates_select on public.entry_updates
  for select using ((select public.is_member()));

drop policy if exists entry_updates_insert on public.entry_updates;
create policy entry_updates_insert on public.entry_updates
  for insert with check ((select public.is_member()) and author_id = (select auth.uid()));

-- ── meetings ───────────────────────────────────────────────────────────────
drop policy if exists meetings_select on public.meetings;
create policy meetings_select on public.meetings
  for select using ((select public.is_member()));

drop policy if exists meetings_insert on public.meetings;
create policy meetings_insert on public.meetings
  for insert with check ((select public.is_member()) and created_by = (select auth.uid()));

drop policy if exists meetings_update on public.meetings;
create policy meetings_update on public.meetings
  for update using (created_by = (select auth.uid()) or (select public.is_admin()))
  with check (created_by = (select auth.uid()) or (select public.is_admin()));

drop policy if exists meetings_delete on public.meetings;
create policy meetings_delete on public.meetings
  for delete using ((select public.is_admin()));

-- ── meeting_lines ──────────────────────────────────────────────────────────
--
-- 0008's four policies repeated the bare per-row style one wave after the cost
-- was written down, which is the reason this migration converts everything in
-- one pass rather than leaving a mixed table for the next author to copy from.
-- The DELETE stays author-or-admin and 0008's column guard is what makes that
-- hold; nothing here weakens it.
drop policy if exists meeting_lines_select on public.meeting_lines;
create policy meeting_lines_select on public.meeting_lines
  for select using ((select public.is_member()));

drop policy if exists meeting_lines_insert on public.meeting_lines;
create policy meeting_lines_insert on public.meeting_lines
  for insert with check ((select public.is_member()) and created_by = (select auth.uid()));

drop policy if exists meeting_lines_update on public.meeting_lines;
create policy meeting_lines_update on public.meeting_lines
  for update using ((select public.is_member()))
  with check ((select public.is_member()));

drop policy if exists meeting_lines_delete on public.meeting_lines;
create policy meeting_lines_delete on public.meeting_lines
  for delete using (created_by = (select auth.uid()) or (select public.is_admin()));

-- ── notifications ──────────────────────────────────────────────────────────
--
-- No is_member() here by design: a notification is addressed, and the recipient
-- test is strictly narrower than membership. Wrapping auth.uid() is the whole
-- change, and it matters most here — the bell polls this table.
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select using (recipient_id = (select auth.uid()));

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));

-- ── profiles ───────────────────────────────────────────────────────────────
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using ((select public.is_member()));

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert with check ((select public.is_admin()));

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update using (id = (select auth.uid()) or (select public.is_admin()))
  with check (id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles
  for delete using ((select public.is_admin()));

-- ── recurring_templates ────────────────────────────────────────────────────
drop policy if exists recurring_templates_select on public.recurring_templates;
create policy recurring_templates_select on public.recurring_templates
  for select using ((select public.is_member()));

drop policy if exists recurring_templates_insert on public.recurring_templates;
create policy recurring_templates_insert on public.recurring_templates
  for insert with check ((select public.is_member()));

drop policy if exists recurring_templates_update on public.recurring_templates;
create policy recurring_templates_update on public.recurring_templates
  for update using ((select public.is_member()))
  with check ((select public.is_member()));

drop policy if exists recurring_templates_delete on public.recurring_templates;
create policy recurring_templates_delete on public.recurring_templates
  for delete using ((select public.is_admin()));

-- ── track_slas ─────────────────────────────────────────────────────────────
drop policy if exists track_slas_select on public.track_slas;
create policy track_slas_select on public.track_slas
  for select using ((select public.is_member()));

drop policy if exists track_slas_insert on public.track_slas;
create policy track_slas_insert on public.track_slas
  for insert with check ((select public.is_admin()));

drop policy if exists track_slas_update on public.track_slas;
create policy track_slas_update on public.track_slas
  for update using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists track_slas_delete on public.track_slas;
create policy track_slas_delete on public.track_slas
  for delete using ((select public.is_admin()));

-- ── tracks ─────────────────────────────────────────────────────────────────
drop policy if exists tracks_select on public.tracks;
create policy tracks_select on public.tracks
  for select using ((select public.is_member()));

drop policy if exists tracks_insert on public.tracks;
create policy tracks_insert on public.tracks
  for insert with check ((select public.is_admin()));

drop policy if exists tracks_update on public.tracks;
create policy tracks_update on public.tracks
  for update using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists tracks_delete on public.tracks;
create policy tracks_delete on public.tracks
  for delete using ((select public.is_admin()));

-- ── vocab_options ──────────────────────────────────────────────────────────
drop policy if exists vocab_options_select on public.vocab_options;
create policy vocab_options_select on public.vocab_options
  for select using ((select public.is_member()));

drop policy if exists vocab_options_insert on public.vocab_options;
create policy vocab_options_insert on public.vocab_options
  for insert with check ((select public.is_admin()));

drop policy if exists vocab_options_update on public.vocab_options;
create policy vocab_options_update on public.vocab_options
  for update using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists vocab_options_delete on public.vocab_options;
create policy vocab_options_delete on public.vocab_options
  for delete using ((select public.is_admin()));


-- ═══ PART 2 ═══ the closed_at index
--
-- `entries.closed_at` was the only queried column on the table without one.
-- Three readers want it and all three arrived after 0001 was written:
--
--   api/entries.listClosedSince()  — `status in (done,cancelled)` +
--                                    `closed_at >= since`, ordered
--                                    `closed_at desc, id asc`. The BOARD now
--                                    asks for a 14-day window on every mount,
--                                    under every axis.
--   the track timeline             — closed rows inside a window
--   the digest                     — the Closed section
--
-- Without it the plan is an index scan on `entries_status_idx` that reads every
-- closed row ever and filters the window away: measured on 5 000 synthetic rows
-- in a rolled-back transaction, 705 buffers and 1 497 rows removed by filter to
-- return 504.
--
-- PARTIAL, on `closed_at is not null`, because the index only has to serve
-- questions about closed work — an open entry has no closed_at, and indexing
-- three-fifths of the table as NULLs to answer a question nobody asks costs
-- write throughput on every capture.
--
-- `(closed_at desc, id)` rather than `(closed_at desc)` alone: it is the exact
-- ORDER BY listClosedSince sends, so the scan can be ordered and the top-N sort
-- disappears with it. `id` is the tiebreak the reader already asked for.
create index if not exists entries_closed_idx
  on public.entries (closed_at desc, id)
  where closed_at is not null;

analyze public.entries;


-- ═══ PROBE ═══ self-verifying, and it fails the migration rather than warning
--
-- The whole point of this file is a property that is invisible in behaviour: no
-- test, no screen and no smoke run can tell a per-row predicate from an InitPlan
-- one. So the check reads the catalogue.
do $prove$
declare
  -- ONE definition of each pattern, referenced by every test below.
  --
  -- The trap here, and it is worth spelling out because the first draft of this
  -- block fell into it: `pg_policies` does not hand back the text you typed, it
  -- hands back a DEPARSE of the parse tree, and Postgres renders a scalar
  -- subquery with a space after the paren — `(select public.is_member())` comes
  -- back as `( SELECT is_member() AS is_member)`. A test written against the
  -- typed form (`(?<!\(SELECT )`, no space) therefore matches EVERY correctly
  -- wrapped policy, counts all 37 as failures, and fails a migration that just
  -- succeeded. So: no lookbehind, and `\s*`/`\s+` throughout, which makes the
  -- test independent of that whitespace instead of merely agreeing with today's
  -- rendering of it. The schema qualification is optional for the same reason —
  -- the deparse drops `public.` today, and this does not care if it stops.
  c_wrapped constant text :=
    '\(\s*SELECT\s+(?:public\.)?(?:is_member|is_admin|auth\.uid)\(\)[^)]*\)';
  c_call    constant text :=
    '(?:public\.)?(?:is_member|is_admin|auth\.uid)\(\)';

  v_bare      int;
  v_total     int;
  v_wrapped   int;
  v_has_index boolean;
  r           record;
begin
  select count(*) into v_total from pg_policies where schemaname = 'public';

  select count(*) into v_wrapped
  from pg_policies
  where schemaname = 'public'
    and (coalesce(qual, '') ~ c_wrapped or coalesce(with_check, '') ~ c_wrapped);

  -- A policy is BARE if, after every WRAPPED call is struck out, the expression
  -- still names one of the three functions. Strike-then-test rather than "does
  -- it contain `( SELECT `", so a policy that wraps one call and leaves another
  -- bare is still caught — `meeting_lines_delete` and `profiles_update` are
  -- exactly that shape, two calls in one boolean.
  v_bare := 0;
  for r in
    select tablename, policyname, coalesce(qual, '') as qual, coalesce(with_check, '') as wc
    from pg_policies
    where schemaname = 'public'
      and (
        regexp_replace(coalesce(qual, ''), c_wrapped, '', 'g') ~ c_call
        or regexp_replace(coalesce(with_check, ''), c_wrapped, '', 'g') ~ c_call
      )
    order by tablename, policyname
  loop
    v_bare := v_bare + 1;
    raise warning 'OpsTrack 0009: still per-row — %.% using(%) check(%)',
      r.tablename, r.policyname, r.qual, r.wc;
  end loop;

  if v_bare > 0 then
    raise exception
      'OpsTrack 0009 FAILED: % of % public policies still call is_member/is_admin/auth.uid per row. See the warnings above.',
      v_bare, v_total;
  end if;

  select exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'entries' and indexname = 'entries_closed_idx'
  ) into v_has_index;

  if not v_has_index then
    raise exception 'OpsTrack 0009 FAILED: entries_closed_idx was not created.';
  end if;

  raise notice
    'OpsTrack 0009: % public policies, 0 per-row, % carrying an InitPlan subquery; entries_closed_idx present.',
    v_total, v_wrapped;
end
$prove$;
