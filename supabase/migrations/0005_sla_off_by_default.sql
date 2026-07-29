-- 0005 — SLA ships OFF, per WAVE1-ADDENDUM §2.2.
--
-- WHAT THIS CORRECTS
-- 0003 seeded `sla_days` on all four priority rows (critical 1, high 3,
-- medium 7, low 14) and called it "the workspace's opening position". The
-- binding delta spec says the opposite, in two places and with the reason:
--
--   "Seed `sla_days` NULL on all four priority rows"
--   "SLA is OFF until an admin turns it on, per priority. There is no
--    DEFAULT_SLA_DAYS ... A seeded default would mark real in-flight work
--    'breached' the moment 0003 runs, on a workspace that never agreed to
--    the number."
--
-- That is not a style disagreement. `v_entry_health.sla_breached` is
-- `now() > created_at + sla_days`, computed with no regard for when the number
-- was chosen — so a seeded 1-day critical SLA reports every critical item older
-- than a day as a missed commitment, retroactively, against a target nobody set.
-- The client half of the chain was built to the spec (`store/vocab.ts` returns
-- `sla_days ?? null` and carries a comment saying there is no default), so the
-- database was the only place the workspace was opted in.
--
-- The fix is applied here rather than by editing 0003 because 0003 has already
-- run against the live project and its output is quoted in the Wave-1 proofs.
-- Migrations are history; this is the correction, and it is the last word
-- because it runs last.
--
-- TURNING SLA ON IS ONE STATEMENT, and it is an admin's to make — through the
-- vocabulary admin screen, or:
--   update public.vocab_options set sla_days = 1 where kind='priority' and key='critical';
--
-- Reversible in full: re-running 0003's seed values restores the previous state
-- exactly, and no entry data is touched either way.


-- ── the seed, corrected ─────────────────────────────────────────────────────
-- Redefining vocab_seed() is the whole fix for reset_vocab() too: it restores a
-- row to whatever this function says, so an admin who clears an SLA and then
-- hits "reset" must not get the number back. The staleness column is left
-- exactly as 0003 has it — 2/4/8/15 are 0001's hardcoded case expression lifted
-- verbatim, they are a fallback rather than a policy, and the addendum binds
-- only the SLA column.
create or replace function public.vocab_seed()
returns table (kind text, key text, sort_order int, stale_after_days int, sla_days int)
language sql
immutable
as $$
  select v.k_kind, v.k_key, v.k_sort, v.k_stale, v.k_sla
    from (values
      -- kind        key             sort  stale  sla
      ('status'::text,   'new'::text,         1, null::int, null::int),
      ('status',         'in_progress',       2, null,      null),
      ('status',         'blocked',           3, null,      null),
      ('status',         'waiting_on',        4, null,      null),
      ('status',         'done',              5, null,      null),
      ('status',         'cancelled',         6, null,      null),

      -- stale_after_days unchanged from 0003. sla_days is NULL on all four:
      -- SLA is a promise the workspace makes, and a promise nobody made is not
      -- a promise that was broken.
      ('priority',       'low',               1, 15,        null),
      ('priority',       'medium',            2, 8,         null),
      ('priority',       'high',              3, 4,         null),
      ('priority',       'critical',          4, 2,         null),

      ('type',           'action',            1, null,      null),
      ('type',           'decision',          2, null,      null),
      ('type',           'issue',             3, null,      null),
      ('type',           'request',           4, null,      null),
      ('type',           'change',            5, null,      null),
      ('type',           'escalation',        6, null,      null),
      ('type',           'note',              7, null,      null)
    ) as v(k_kind, k_key, k_sort, k_stale, k_sla);
$$;

comment on function public.vocab_seed() is
  'The 17 frozen vocabulary rows with their seeded order and thresholds. Single source of truth for the seed insert and for reset_vocab(). sla_days is NULL by design — WAVE1-ADDENDUM 2.2.';

-- create or replace keeps a function's existing ACL, but 0003 states these
-- explicitly and a reader should not have to know that rule to be sure.
revoke all on function public.vocab_seed() from public;
revoke all on function public.vocab_seed() from anon;
grant execute on function public.vocab_seed() to authenticated;


-- ── clear the seeded values, and ONLY the seeded values ─────────────────────
-- The guard is the point. If an admin has already chosen SLA targets, those are
-- a real decision about how this workspace answers work and nothing here may
-- overwrite them. So this clears a priority row only while it still holds the
-- exact number 0003 put there — i.e. while it is provably untouched. A single
-- edited row makes the whole set the admin's, and the block does nothing.
do $sla_off$
declare
  v_untouched int;
  v_rows      int;
begin
  select count(*) into v_untouched
    from public.vocab_options
   where kind = 'priority'
     and (key, sla_days) in (('critical', 1), ('high', 3), ('medium', 7), ('low', 14));

  if v_untouched = 4 then
    update public.vocab_options
       set sla_days = null
     where kind = 'priority'
       and sla_days is not null;

    get diagnostics v_rows = row_count;
    raise notice 'OpsTrack: cleared 0003''s seeded sla_days on % priority rows — SLA is now off until an admin sets it.', v_rows;
  else
    raise notice 'OpsTrack: sla_days differs from 0003''s seed on at least one priority row — treating it as an admin decision and leaving all four alone.';
  end if;
end
$sla_off$;
