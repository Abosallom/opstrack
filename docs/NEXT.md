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

## 0035 was proved against the live database — half of it

`docs/EVIDENCE/probe-0035-20260828T125623Z.json`. One row — Al-Zobaidi Medical Group × Lab Order,
picked deterministically — with its before-state captured, the write made, and the row restored.
All 1,540 rows sat at `intake` with `overrides = []`, so no person's edit was at risk.

**What is proved.** A service-role write of `rung` and `target_date` left `overrides` at `[]`,
moved `status_changed_at`, and appended an event with `actor_id: null` and `source: 'migration'`.
That is the gate holding, and it is the half that protects `JiraEffect.held`: a sync whose own
writes marked fields as human-held would make `held` meaningless in the one direction that
matters. It also shows 0032's two jobs *running* rather than merely present in the body, which is
more than 0035's own probe can assert.

**What is not proved: the union itself.** The overrides block only runs when `auth.uid()` is not
null, and the service-role key carries no `sub` claim, so nothing I can send exercises it. It
needs a user session. Cheapest path by far is **one click from you** — open any organization,
change a rung, then change a target date on the same cell; if `overrides` reads
`{rung, target_date}` and not `{target_date}`, the union holds and the lost update 0024 predicted
is closed. That also exercises `src/api/map.ts`'s real write path, which is the code 0035
overrules, so it is better evidence than anything I can synthesize.

**Residue, stated plainly.** `updated_at` on that row moved to 28 August — the touch trigger owns
it and any restore moves it again. And the event log is append-only, so the two events the probe
caused stay on the record rather than being deleted.

## The COC queue is built — §11.7, and the first daily write path

The PMO dashboard has a **COC queue** tab. It is the unbuilt half of OB
monitoring: §11.1–11.6 already shipped on the Delivery tab, and §11.7 — the part
that *records* rather than reads — did not exist.

**Why this and not another reading of the same rows.** The diagnosis behind the
whole exercise was that this product has eight ways to look at data and almost no
way to change any of it: `setNodeUseCase` shipped with **zero call sites**, so
"nobody has ever hand-edited anything" was a consequence rather than a habit. COC
is the rung this office works, so it is the honest place for the first write path
somebody uses every day.

**The four fields**, as §11.7 names them: the day the evidence went to CHI, the
named person holding it, CHI's own reference, and the day it came back signed.

⚠ **`coc_contact` is a name and nothing else.** No email, no phone — refused
before the save rather than explained afterwards, so the person hears it while
still looking at what they typed. This workspace holds no staff emails by design
and its privacy page is written from what the schema contains; a contact
*outside* the organization is a higher bar, not a lower one.

**The queue's clock is honest where the rung clock is not.** `obMonitor` refuses
to print a day count because `status_changed_at` holds one migration instant for
all 1,540 rows. `coc_submitted_on` is a date **a person types**, so its age is a
real wait — and an unsubmitted pair prints a sentence, never "0 days", which
would read as "submitted this morning".

**It is empty today and says so.** Every pair in the estate is at intake, so the
tab ships with a sentence explaining that it fills the first time somebody moves
a pair up the ladder. An empty panel with no words in it reads as a bug.

**Not built, and deliberately: the chase thread.** §11.7 wants a line per chase
and is explicit that it must not become a fifth column — `entry_updates` is
already an append-only authored trail, and `coc_notes` would be a second thread
implementation whose entries could not be attributed. That needs a work item per
pair to hang the thread on, which this table does not have.

**And it will finish the 0035 proof by being used.** The first save through this
form is a person's edit with an `auth.uid()`, which is the half of 0035 no
service-role key can exercise. Record a submission date, then a contact on the
same pair: if `overrides` reads `{coc_submitted_on, coc_contact}` rather than
just the second, the union holds.

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
