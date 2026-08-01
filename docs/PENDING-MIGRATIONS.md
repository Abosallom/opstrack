# Migrations written but NOT applied

**This file is the answer to "what still has to be run?" — check it before every deploy.**

It exists because the critic caught the failure it prevents: `README`, `ADMIN.md` and
`RUNBOOK.md` all stopped at `0013`, and the RUNBOOK's own verification query checked twelve
things ending at `0013` and reported **"all twelve yes"** — while four migrations sat unapplied.
A verification that cannot fail is worse than none.

## Status — 1 August 2026

**Nothing is pending.** `0014`–`0022` are applied to the live project (`lrysgpbkmuqgzsjesfkr`),
each twice, and verified by querying the catalog rather than by trusting the apply:

| # | File | Verified live by |
|---|---|---|
| 0014 | `recurring_template_authorship.sql` | `materialize_template` present |
| 0015 | `entry_write_guard_and_line_authorship.sql` | `entries_guard_update` BEFORE UPDATE trigger on `entries` |
| 0016 | `name_pin_close_date_and_handover_clock.sql` | `guard_profile_role` present |
| 0017 | `label_overrides.sql` | `label_overrides_norm(text)` + `reset_label_overrides(text)` present |
| 0018 | `track_groups.sql` | 2 rows in `track_groups`, `tracks.group_id` column present |
| 0019 | `nudges.sql` | `nudge_entry(uuid)` present; `notifications_kind_check` allows `'nudged'` |
| 0020 | `ai_usage.sql` | `ai_usage` table + `ai_usage_day()` / `ai_usage_today()` / `ai_usage_record()` present |
| 0021 | `ai_prefs.sql` | `notification_prefs.ai_enabled` column present |
| 0022 | `nudge_stamps_on_insert.sql` | `entries_guard_insert()` body contains the two nudge pins; `claim_counters_scope_ck` lists all four scopes |

**`0010` was edited after it had already been applied**, which normally must not happen and is
justified in the file itself and in `docs/W-AI-HANDOFF.md` §(a). Short version: this project has
no migration ledger — `supabase_migrations.schema_migrations` does not exist on the live database
— so there is no checksum to invalidate; `0010` is re-runnable by design and the edit changes only
what a **re-run** does; and the failure it prevents (a re-run silently narrowing
`claim_counters_scope_ck` and disarming the AI burst limiter with no signal) was reproduced live.
The edited `0010` was applied twice and is a no-op against the current constraint.

### 0022 exists because 0019's own probe could not see the defect

`0019` pinned `nudged_at`/`nudged_by` on UPDATE and proved it with three probes. Nothing pinned
them on **INSERT** — `entries_guard_insert()` is `0015`'s function and predates the columns — so a
member could POST an entry pre-stamped `nudged_at = '2099-01-01'` (permanently unchaseable: the
24-hour rate limit refuses every future ask) with `nudged_by` naming a colleague who never asked.
Reproduced live in a rolled-back subtransaction before the fix was written, with `created_at`
coming back correctly pinned as the control that proves the trigger *did* run.

`0022`'s PROBE 1 was then confirmed load-bearing the only way that means anything: the old
`entries_guard_insert()` was restored on the live database, the probe was run against it, and it
refused with the intended message. `PROBE 3` was confirmed the same way by narrowing
`claim_counters_scope_ck` by hand.

### 0017 refused itself first, and was right to

Its own probe block raised `btrim stored NULL — expected the ends trimmed and the interior
spacing intact`. The cause: `v_trim` was **declared and asserted on, but never assigned**, so it
was always NULL and the assertion was unconditionally true. The migration could not apply, ever.

Reading the file did not reveal it — the declaration, the header's fixture comment and the
assertion all read like a complete probe; only the missing `insert`/`select` between them was
absent. **Running it against a real database is what found it**, which is the whole argument for
applying twice and reading the notices rather than trusting a green file.

The missing probe was written (insert `'  Assigned  to  '`, read it back), and the fixture keeps
its doubled interior space deliberately: a normaliser that collapsed interior whitespace would
pass a single-space fixture and silently rewrite what the owner typed.

## How to run one

1. Supabase dashboard → `opstrack` project → **SQL Editor**.
2. Open `supabase/migrations/<file>`, copy all, paste, **Run**. In numeric order.
3. Every migration here is re-runnable — running one twice is safe and is how they are tested.
4. Read the `NOTICE` lines. They are the migration's own self-checks; a `FAILED` notice means it
   refused to apply and nothing changed.

## How to confirm afterwards

`RUNBOOK.md` §5 has a verification query, but it **stops at 0013** — treat a clean run of it as
necessary, not sufficient, until it is extended. Prefer checking the specific object a migration
creates, as the table above does. One statement covering everything from `0018` on:

```sql
select
  (select count(*) from public.track_groups)                                              as g_0018,
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='tracks'  and column_name='group_id')     as c_0018,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='nudge_entry')                                as f_0019,
  (select count(*) from information_schema.tables
     where table_schema='public' and table_name='ai_usage')                               as t_0020,
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='notification_prefs'
       and column_name='ai_enabled')                                                      as c_0021,
  (pg_get_functiondef('public.entries_guard_insert()'::regprocedure)
     like '%nudged_by        := null%')                                                   as f_0022,
  (select pg_get_constraintdef(oid) from pg_constraint
     where conname='claim_counters_scope_ck')                                             as scopes;
```

Expected: `2, 1, 1, 1, 1, true`, and `scopes` listing all four of `username`, `ip`, `ai_user`,
`ai_ip`. A narrowed `scopes` means someone re-ran a pre-fix `0010`; re-apply `0022`.

### Probes must be able to fail

`0019`'s PROBE 1 asserted that a `push_outbox` row **existed** and never what it **said**, and a
`nudged` notification rendered as *"X assigned you …"* in production for hours as a result. A probe
that cannot fail is worse than no probe, exactly as this file's opening paragraph says about the
RUNBOOK query. When a migration's effect is only visible outside SQL — in an edge function, in the
client — the assertion belongs there too: `supabase/functions/send-push/index.test.ts` is where
that particular sentence is now pinned.

## The rule this file encodes

A migration is not "done" when it is written and tested. It is done when it has **run against the
live project**. Anything between those two states belongs in this table, and this table belongs in
the same commit as the migration.
