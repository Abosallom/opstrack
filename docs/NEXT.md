# Read this first

Written 26 August 2026 overnight; **updated 28 August 2026**, when the four pending migrations
went onto the live database and the last thing blocking the screens stopped blocking them.

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

## The migrations are applied — 28 August 2026

**0032, 0033, 0034 and 0035 are on the live database.** You ran them at the SQL Editor. 0035
refused its first paste on a trailing comma in an `array[…]` constructor — Postgres said
`syntax error at or near "]"` — and because the SQL Editor runs a file in one transaction,
nothing of it landed until the fixed file went through clean.

Re-probed object by object afterwards: the rung ladder and its event log, `map_node_readiness`,
`his_products` with its seed, and `map_nodes.his_id` all answer. `docs/PENDING-MIGRATIONS.md` now
carries the full applied record; **only `0030_map_view_settings.sql` is still unrun**, and it
blocks nothing — no client half exists for it.

## So the screens are unblocked

Nothing is waiting on a credential any more. The OB monitoring page, the COC queue and the HIS
queue all have the columns they need.

## Still open, and each needs a sentence from you

1. **Misbar** — the Grafana pull is a script on your Mac and does not survive the move; and
   sending email would be the first thing this product ever sends outside the building. See
   `docs/MISBAR.md`.
2. **The BRD** — `docs/guides/brd.pdf`, 29 pages. You approve in pieces; the data-model section is
   the one that unblocks building.

### Parked on your instruction — Aseer and Jazan

You said on 28 August to **ignore them for now**, so they are off this list and nobody is waiting
on you for them. They are not lost: the PMO rulings tab computes them live from `map_nodes` and
`entries` every time it is opened, so the pair reappears the day either is answered and disappears
the day either is merged. Nothing is filed against them and nothing is guessed at in the meantime
— the eight tickets naming only "Aseer" stay unfiled, which is the honest state.

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
