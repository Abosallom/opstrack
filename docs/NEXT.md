# Read this first

Written 26 August 2026, overnight. Everything below is either **done and live**,
or **waiting on one thing only you can do**.

## What is live on nphiescore.com right now

Your browser may have been holding an old copy. The site uses a
"new version available — Reload" prompt rather than reloading under you, so if it
looked unchanged, **that prompt was the reason.** Accept it once.

| | |
|---|---|
| The word **capabilities is gone** | 61 English strings and 81 Arabic ones now say *use case* / *حالة استخدام* |
| **Eleven use cases**, in your words | Rad Order, Rad Report, Lab Result — not Radiology Order, Radiology Report, Lab Results |
| **140 organizations** | 21 rows merged away by your rulings; the grid is 140 × 11 = 1,540 |
| **Departments are no longer drawn as hospitals** | The Onboarding delivery tab was listing "Business Operations — 84 open items" as though it were a clinic |
| **The map opens unobstructed** | The details card no longer swings open over a third of the drawing |
| All six departments **read in Arabic** | التهيئة · التكامل التقني · العمليات التشغيلية · التسليم التقني · المنتج · الدعم والصيانة |
| The capture examples **name things that exist** | They pointed at `#infra`, `#network` and `#"IT Operations"` — tracks deleted with the old product |

## The one thing only you can do

**Three migrations are written, tested and unapplied.** I have no database
credential that can run DDL — no Supabase CLI, no `psql`, and no connection
string in `.env.local`. They need the **SQL Editor** in the Supabase dashboard,
run in order:

1. `supabase/migrations/0032_use_case_rungs.sql` — the rung ladder per use case
   (Intake → DEV → STG/TEST → COC → PROD), `scope` for not-applicable, the
   blocked flag, the COC queue's four columns, and the append-only event log that
   makes "what moved this week" answerable for the first time.
2. `supabase/migrations/0033_org_readiness.sql` — Patient Registry, Provider
   Portal, SSO.
3. `supabase/migrations/0034_his_catalogue.sql` — the HIS catalogue and
   `map_nodes.his_id`.

Each ends in probes that raise rather than return quietly, so a partial apply
announces itself. **0032's row-level half has already run** over REST — the XD
merge and the renames — so its merge loop will find nothing left to move, which
is correct.

## Then the screens can be built

Nothing else is blocked. The OB monitoring page, the COC queue and the HIS queue
all need columns that arrive in those three files.

## Still open, and each needs a sentence from you

1. **Aseer** — `Aseer` and `Aseer Cluster` name no system. Ticket text leans
   Careware 12 to Vida Plus 2, and you said to split them by what is underneath,
   which needs the hospitals under each.
2. **Jazan** — the bare `Jazan` row, same question, between MCC and MedicaCloud.
3. **Misbar** — the Grafana pull is a script on your Mac and does not survive the
   move; and sending email would be the first thing this product ever sends
   outside the building. See `docs/MISBAR.md`.
4. **The BRD** — `docs/guides/brd.pdf`, 29 pages. You approve in pieces; the
   data-model section is the one that unblocks building.

## One thing I did badly

I committed on a failing gate **three times** — twice on lint, once on two failing
tests. Each was fixed within minutes, and every one was me reading the exit code
and going ahead anyway rather than the tooling being unclear.
