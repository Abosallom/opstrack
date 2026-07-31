# Migrations written but NOT applied

**This file is the answer to "what still has to be run?" — check it before every deploy.**

It exists because the critic caught the failure it prevents: `README`, `ADMIN.md` and
`RUNBOOK.md` all stopped at `0013`, and the RUNBOOK's own verification query checked twelve
things ending at `0013` and reported **"all twelve yes"** — while four migrations sat unapplied.
A verification that cannot fail is worse than none.

## Status — 31 July 2026

| # | File | What breaks until it runs |
|---|---|---|
| **0014** | `recurring_template_authorship.sql` | A scheduled-item recipe has no author, so anyone can point one at a colleague, press **Run now**, and the item plus its phone alert arrive as *"the schedule did it"*. |
| **0015** | `entry_write_guard_and_line_authorship.sql` | Any member can assign work to any colleague — delivered as a phone push — with the entry recorded as authored by nobody and no trace of who did it. |
| **0016** | `name_pin_close_date_and_handover_clock.sql` | Three things: a teammate can rename themselves to a colleague's name permanently, on every screen and lock-screen notification; a close date can be edited directly, silently moving items into and out of throughput, lead-time and SLA numbers; and handing an item over resets its neglect clock, so delegating erases the evidence that it was ignored. |
| **0017** | `label_overrides.sql` | `Settings › Terminology` renders and searches, but **nothing can be saved** — the app says so plainly (`common.errMissingTable`) rather than failing silently. |

**Order matters. Run 0014 → 0015 → 0016 → 0017.**

## How to run them

1. Open the Supabase dashboard → your `opstrack` project → **SQL Editor**.
2. For each file in order: open `supabase/migrations/<file>`, copy the whole thing, paste, **Run**.
3. Every migration here is re-runnable — running one twice is safe and is how they were tested.
4. After each, look at the `NOTICE` lines. They are the migration's own self-checks; a `FAILED`
   notice means it refused to apply and nothing changed.

## How to confirm afterwards

`RUNBOOK.md` §5 has the verification query. It is currently **stale — it stops at 0013**; treat a
clean run of it as *necessary, not sufficient*, until it is extended.

## The rule this file encodes

A migration is not "done" when it is written and tested. It is done when it has **run against the
live project**. Anything between those two states belongs in this table, and this table belongs in
the same commit as the migration.
