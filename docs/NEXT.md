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

---

## Auto-open on zoom — tried three ways, backed out, and what it would take

Asked for on 27 August. The idea: zooming close to a department reveals its
hospitals without a tap. **It is not in the product.** Three designs, three
failures, all measured in a browser rather than reasoned about — recorded here so
a fourth attempt starts from the evidence instead of from the idea again.

The decision logic itself was never the problem. A pure `approachOpenIds(cards,
scale, focus)` returning the branch to open, with the threshold set to
`BAND_EDGES.opening` so a branch opens on the same frame its card gains a second
line, passed thirteen tests including the mount-time `scale === 0` trap. What
failed, every time, was the *writing*.

1. **Open every branch past the threshold.** Every department's card is the same
   width, so all six crossed on one frame: 140 organizations unfolded at once
   into unreadable dust — the "wall of identical grey bricks" that
   `openDepthFor`'s header says the whole depth rule exists to prevent. The tests
   were green and the picture was ruined.

2. **Open only the branch nearest the camera centre.** Correct behaviour, blank
   map. Opening re-flows the layout under a camera that deliberately does not
   follow it, and the camera ends up pointed where nothing is.

3. **Route it through the page's `toggleFold`**, which parks the id and calls
   `reveal()` once the drawing commits — the mechanism a manual tap already uses,
   and the one `useMapGeometry` names: *"Reader folds → the camera holds, and the
   page calls `reveal()` with the branch that opened."* Still blank.

**The remaining suspect, untested.** The `+` button ANIMATES. The tween crosses
the threshold mid-flight, the open fires, and `reveal()` flies the camera while
the zoom tween is already flying it — two motions fighting for the same camera.
A fourth attempt should debounce until the camera has settled (`flyToCamera` has
a completion the effect could wait on) and only then ask. That is the "debounced
effect" the original plan named and that none of these three did.

⚠ **And it may still not be worth it.** `openDepthFor`'s own note argues the tap
IS the gesture — *"The reader opens the one they want, which is the gesture the
tree is for"* — and the owner described it the same way: *"once i reach this
level, i click the org"*. Tapping works, is predictable, and costs one gesture.
This is the only feature in the product that writes layout from the camera, and
it has now cost three rewrites without once improving the picture.
