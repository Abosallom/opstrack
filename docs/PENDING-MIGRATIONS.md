# Migrations written but NOT applied

**This file is the answer to "what still has to be run?" — check it before every deploy.**

It exists because the critic caught the failure it prevents: `README`, `ADMIN.md` and
`RUNBOOK.md` all stopped at `0013`, and the RUNBOOK's own verification query checked twelve
things ending at `0013` and reported **"all twelve yes"** — while four migrations sat unapplied.
A verification that cannot fail is worse than none.

## Status — 1 August 2026

**Nothing is pending.** `0014`–`0017` were applied to the live project on 1 August 2026, each
twice, and verified by querying the catalog rather than by trusting the apply:

| # | File | Verified live by |
|---|---|---|
| 0014 | `recurring_template_authorship.sql` | `materialize_template` present |
| 0015 | `entry_write_guard_and_line_authorship.sql` | `entries_guard_update` BEFORE UPDATE trigger on `entries` |
| 0016 | `name_pin_close_date_and_handover_clock.sql` | `guard_profile_role` present |
| 0017 | `label_overrides.sql` | `label_overrides_norm(text)` + `reset_label_overrides(text)` present |

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
creates, as the table above does.

## The rule this file encodes

A migration is not "done" when it is written and tested. It is done when it has **run against the
live project**. Anything between those two states belongs in this table, and this table belongs in
the same commit as the migration.
