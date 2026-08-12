# MAP-ZOOM — the continuous dive

Written after reading the three rival directions, the plan's Part 3, and the code at
`feat/map-hierarchy` HEAD `84e64a1`. It supersedes the three studies and amends
`docs/MAP-CONTRACT.md` where it disagrees with it (§0 of this file names every point).
A fleet executes this. Where a study is quoted it is because it was right.

---

## 0. WHAT IS ACTUALLY ON SCREEN AT HEAD — three corrections to the brief

The brief's measurements were taken before the island redesign landed. Two of its three
headline findings are stale, and building against them would be building a fix for a bug
that is already fixed.

1. **"The canvas begins about 54% down the viewport."** No longer true.
   `src/pages/mindtree.css:1225-1300` records the after-measurement, read off
   `getBoundingClientRect` at 1600×900: `.mtree` is 1180×835 starting at y=65 — **7% down**
   — and the drawing surface is 1180×648. The island layer (`.mtree-isles`, `inset: 0`,
   `pointer-events: none`, each island turning pointers back on for itself) ships at
   `Mindtree.tsx:684`. The three stacked rows are gone.
   The residual defect is real and is `.main-content { max-inline-size: 1180px }` in
   `app-shell.css` — 188px of a 1600px screen that no rule in `mindtree.css` can reach.
   **That is a full-bleed opt-in on `.main-content`, and it is in this contract (U4).**

2. **"At 375×812 the map is entirely absent — zero pixels; the lens chips do not render."**
   Also fixed. `mindtree.css:1400-1530`: `.mtree` is a `100dvh` grid of `auto | 1fr | auto`
   so the canvas is the largest region *by construction*, and `.mtree-shellbar` is
   `position: fixed` at **z-index 71, one above the sheet's 70**, under the thumb.
   The phone's remaining defect is not chrome. It is that `useMapGeometry.ts:360` pins
   `if (compact) return 1` — **the phone is hard-capped at one ring and can never show
   that there is anything below it at all.** That is the phone bug this contract fixes.

3. **"~20 controls in three stacked rows."** The rows are gone; the count is not. Measured
   at HEAD: search field, Filter disclosure, Mine, 5 lens chips, Meetings, Export, 4
   group-by chips, 4 altitude stops, Fit, Table, "show the panel" = **19 targets**, and the
   ladder already absorbed six (`MapAltitude.tsx:1-12`). **The count is still the fault and
   this contract cuts it to 12.**

**One real bug, found while reading and named here because a unit has to fix it:**
all three zoom anchors in `useMapGeometry.ts` — `zoomBy` (:583), the pinch branch of
`onPointerMove` (:705), and `panBy` (:542) — resolve `pan === null` to
`{x: fit.x + fit.width/2, …}`. **Every pinch therefore anchors on the fit centre, not on
the fingers**, and the picture slides out from under the reader's hand on every pinch.
That is the opposite of "the thing you zoom into becomes the whole frame".

---

## 1. THE VERDICT — one spine, two grafts, one direction rejected

The test the brief set: *is this a continuous dive where every depth is a complete picture
drawn at its own scale, or is it a tree that scales?*

### `strip` is rejected, on its own evidence

Its self-critique is correct and it is fatal: *"a pill with a ring of boxes around it. Then
a pill with a ring of boxes around it… the only thing distinguishing level 3 from level 2
is the text inside the boxes."* When the sense of place is carried by the level strip, the
navigation IS the strip and the camera is decoration — and a direction named for a control
that concludes the control is doing the work has answered the brief with a breadcrumb.

Its second defect is worse and it is not self-inflicted: **one level at a time deletes the
cross-cutting glance**, which `MAP-CONTRACT §0` names as the map's reason to exist. Six
at-risk Orgs across five departments becomes a serial walk of five dives.

Two things are **taken from it**, in full, and are load-bearing below: the argument that
*nothing keyed on the dive fraction may change the layout* (its ROLE-1 invariant), and the
observation that a **directional arc drawn with a fixed `sweep-flag` counts DOWN in
Arabic** because `radial.ts`'s mirror maps θ → π − θ. Nobody else caught that.

### `lod` is not the spine, and the reason is structural

Five authored renderings is the right idea and half of it survives below. But `lod`'s κ
feeds `depthLimit = ceil(κ) + 2`, `depthLimit` feeds `layoutMindtreeRadial`, and the layout
feeds `bounds` → `fit` → the composed `viewBox`. **Every tier crossing recomputes every
radius, so every node in the drawing moves.** `lod` answers that the stylesheet tweens it
over 240ms "for free" — which is true, and which means the reader sees the entire picture
glide to new coordinates roughly a dozen times per tier. That is not "nothing teleports";
it is everything gliding, repeatedly, for reasons the data did not change. It is precisely
a tree that scales, plus wobble.

Its `carryCamera` is fifteen elegant lines solving a problem this contract does not have.

**Taken from it, in full:** the five-renderings-not-five-sizes discipline; the
`ringNodeSize` promotion (drop `options.compact &&` from its guard — the 44×44 chip with
the label outside along the ray is a *band*, not a phone hack); the measured swap
thresholds derived from `LABEL_INSIDE_MIN = 96` rather than chosen; and the rule that a
texture mark is a **band, never a sample**, because `model.ts`'s standing rule is that a
branch labelled 12 showing 3 is the worst thing this map can do.

### `camera` is the spine

It is the only direction in which the drawing does not depend on the camera at all, and
that single decision is what delivers all three of the reference's properties instead of
approximating them:

- **one continuous move** — nothing can flash because nothing is recomputed;
- **detail resolves** — a node's rendering is a function of its *apparent diameter in CSS
  pixels*, so four or five renderings coexist on screen at every instant, which is what
  "fifteen nested worlds" actually looks like;
- **the child becomes the view** — children live *inside* their parent's disc, so diving
  means the parent's rim grows past the viewport, becomes the stage's own border, and
  leaves. The mouth becomes the frame and then it is gone.

**And it is not a ladder.** A level is "a distance at which some node happens to be 140px
across". The number of levels is the depth of the department tree the admin configured,
because it could not be anything else. That is the owner's correction made mechanical
rather than tabulated — no `ALTITUDE_DEPTH`, no four frozen English words.

### Where this contract overrules `camera`

Five places, each because a critic or the code was right.

1. **Its own weakness — "the filter can no longer gather" — is the strongest objection in
   the corpus, and it is answered by a concession the app has already made.**
   `MAP-CONTRACT §0` states, as its most valuable finding, that the daily cross-cutting job
   belongs to a **real-DOM list beside the canvas**, not on it. The `needs-me` lens is the
   default landing for exactly this reason. So the set question was never the canvas's job.
   What this contract owes the reader is a **signpost**, and it is mandatory, not optional:
   §5's `MATCH RIM`. A world containing filter matches carries a rim arc and a count. "Three
   in there, that way" is not the answer; it is the difference between a map that has lost
   the set and a map that knows where it is.
2. **The progress underscore's unfilled track is deleted.** `camera` specifies "the card's
   own outline ink at 20%", which is not in the measured matrix and which
   `mindtree.css:~130` forbids in principle — dilution hands the measured ratio back. The
   mark is **length-encoded with no track behind it** (§4, CARD). No new recipe, no new
   ratio, nothing to re-derive.
3. **Buckets and entries are not worlds.** `camera` is silent on where the recursion stops
   and would let a status bucket become the frame. §3's `TERMINUS` rule fixes it and is the
   direct implementation of the owner's correction.
4. **21 targets is not a cut.** The brief is explicit. §6 takes it to 12.
5. **Its phone section is written against a defect that no longer exists.** §7 is rewritten
   against HEAD.

---

## 2. THE ONE STRUCTURAL CLAIM

> **The geometry is a pure function of the DEPARTMENT TREE and the reading direction.
> Nothing else. Not the zoom, not the viewport, not the panel occlusion, not the filter,
> not the level of detail, not the reader's collapse choices.**

The whole hierarchy is laid out once, at full depth, in one absolute coordinate space, and
it stays there. `layout.bounds` is a constant for a given tree.

**This kills the named feedback cycle at the root rather than by discipline.**
The trap is `depthLimit → layout → bounds → fit.scale → zoomBounds → heldZoom → depthLimit`.
That chain has no first link here: `depthLimit` is not a camera input and `bounds` is not a
camera output.

```
geometry  ←  (department tree, direction)                    ONE arrow, at mount
LOD       ←  (camera, box)
camera    ←  (gestures, tweens, one mount-time read of bounds)
paint     ←  (filter)                    ← the filter NEVER reaches geometry
```

`fit.scale`, `heldZoom`, `zoomBounds` and `clampZoom` cease to exist as concepts. There is
no multiplier of a moving fit — only an absolute width in drawing units.

**RECURSIVE CONTAINMENT, not concentric rings.** Every node owns a circular world of
diameter `D`. Its children's worlds are packed on a ring **inside** it. `radial.ts`'s
demand-driven radius and its chord-not-arc correction survive verbatim, applied inward.

**"Boxes on a circle, not sunburst arcs" is untouched and is now load-bearing twice.**
Cards never rotate; only their world-centres sit on a circle. That is what keeps
`MindNode`'s measured `CHAR_PX = 6.2` glyph budget, `<rect>` hit-testing, `PulseLayer`'s
rect pulses, `MindDropTargets`, `DragLayer`'s pointer→layout conversion, the free CSS
`translate` tween and `export.ts`'s serialiser working unchanged. A wedge would also make
containment impossible — you cannot nest a world inside a wedge without rotating everything
in it.

**THE FILTER PAINTS; IT NEVER REBUILDS.** Radii come from the UNFILTERED tree. A filtered-out
Organization renders as a **vacant seat** — an unfilled ring on its world's boundary — rather
than vanishing and closing the gap. `model.ts`'s own rule is that *"which Org has nothing on
it"* is a question worth answering, and a seat you can see is empty answers it.

---

## 3. THE WORLD TREE, AND WHERE THE DIVE STOPS

This section is the owner's correction — *"the leveling for department wise not org and
info side bar"* — made mechanical.

> **`worldAt(camera)` — the world the breadcrumb names and the dive is measured against —
> is only ever a STRUCTURAL node: `kind` in `'root' | 'track' | 'entity'`. A `group`,
> `more` or `entry` node is drawn as CONTENT inside its owner's world and can never become
> the frame.**

- **FAR** — the workspace. Each programme is one mark. Departments beneath are grain.
- **MID** — a programme fills the frame. Its departments resolve into named cards with
  counts and a progress reading.
- **NEAR** — a department fills the frame. Its sub-departments resolve the same way, and
  its Organizations appear as the leaves.
- **ARRIVED** — the deepest DEPARTMENT is the last world. Its Organizations are laid out
  legibly as CARDS and you SELECT one.

**THE TERMINUS, stated as an implementable clamp.** `w` is bounded below by

```
W_MIN = D(deepest structural world on the current path) / ZOOM_HEADROOM     ZOOM_HEADROOM = 2.2
```

so a reader may magnify 2.2× past the deepest department's framing — enough that every Org
card is comfortably readable and a 44px drop target inside one is reachable — and no
further. Past it the gesture **rubber-bands with a 0.35 exponent and springs back on
release**. That physical dead-stop is the only "you have arrived" signal needed and it costs
no chrome. It is the only place in this design where a gesture is resisted.

**CLICK AN ORG → the INFO SIDEBAR opens beside the map. The camera does not move by one
unit.** No zoom, no re-root, no relayout. `subjectForLens('shape', nodeId)` already yields
`{kind: 'branch', nodeId}`, so this is **zero new wiring** — no sixth `PanelSubject`, no
change to the exhaustive switch at `Mindtree.tsx:570`. `MapBranchDetail` carries account
manager, vendor, the `6 of 9 live` matrix and outstanding issues.

The two gestures are distinguishable **before** the press: cursor `zoom-in` vs `pointer`,
hint `mindtree.diveInto` vs `mindtree.openDetails`.

**Two gestures, two questions: the dive answers *where am I in the organisation*, the
sidebar answers *what is the state of this one thing*.**

---

## 4. THE FIVE RENDERINGS — selected by apparent size, never scaled

`a = D_world × scale`, in CSS pixels. `V` = the smaller dimension of the UNOCCLUDED stage.
Legibility bands are absolute pixels because legibility is absolute; the top band is
relative to `V` because "is this thing the frame" is a question about the window.

**Two invariants, and they are what makes this the reference rather than a magnifier:**

1. **No band renders a node at a size the band below rendered it.** A card is not a scaled
   chip; it is a different set of marks. Change any node's apparent size by one band and its
   ink changes KIND, not just extent.
2. **Total ink per unit area is roughly constant.** As a world opens and loses its card, its
   children arrive with theirs. The picture never empties and never floods.

| band | `a` | what is DRAWN | what TEXT appears |
|---|---|---|---|
| **ABSENT** | `< 7` | nothing | — |
| **GRAIN** | `7 – 26` | one filled disc, `0.42a`, in the node's own 16% track fill with the 1px outline ink | none |
| **STATE** | `26 – 52` | + rim stroke; + breach dot at block-start if anything beneath is past deadline | none |
| **CHIP** | `52 – 140` | 44×44 unrotated rect, count centred inside | name OUTSIDE along the ray, ≤14 glyphs |
| **CARD** | `140 – 380` | 168×44 rect + progress underscore | name inside (≤19 glyphs), open count |
| **OPENING** | `380 – 0.85V` | card cross-fades out as children's grain cross-fades in, one dissolve | the world's name migrates to a RIM LABEL |
| **FRAME** | `≥ 0.85V` | nothing in SVG; the rim becomes a 2px inset stroke on the **stage element** | none on canvas — the name is in the breadcrumb |

**GRAIN is the video's blue smudge on the tongue.** Forty grains read as a dense arc; six
read as a constellation. That density difference IS the information at this distance and it
is free — it is the fan-out the geometry already encoded. **It is a mark per node, never a
sample**, for `model.ts`'s reason.

**No numeral inside a 30px disc.** A count at STATE would render at 3px and is a lie about
legibility. Two marks only: fill (which programme) and breach (is it in trouble).

**CHIP is already written and already tested.** `ringNodeSize` (`radial.ts:406`) returns
exactly 44×44 on the outermost ring when `compact`, and `MindNode.tsx:399` already places
the outside label and already has the Arabic anchor inversion right —
`(outward.x > cx) !== rtl`, with the four-case table in its comment. **The single
highest-leverage edit in this contract is to promote that from a phone hack to the universal
CHIP band**: drop `options.compact &&` from the guard and key it on the band. The mechanism,
the mirror, and the `pointerEvents="none"` fix on the outside `<text>` all survive untouched.

**CARD's progress underscore, specified exactly.** 2 units tall, inset `PAD` from both inline
edges, on the block-end edge inside the box, **filled to the share of Organizations beneath
that are live, with NO track behind the unfilled remainder.** Length is the encoding; the
box's own inset marks both ends. Ink is the branch ink at full strength — **6.35 / 5.53
against a node fill, already in the matrix.** No new recipe, no dilution, no ratio to
re-derive. In RTL the fill grows from the reading start:
`x = rtl ? width - PAD - fillW : PAD`.
Because the encoding is length and colour alone, the fact is **also stated in the node's
accessible name** (`mindtree.nodeName` gains a `{done} of {total} live` clause), which is
what keeps 1.4.1 honest.
Source: `useCaseProgress()` in `src/lib/mapNodes.ts`, which already returns
`{done, total, linked, nodes}`.

**OPENING is one dissolve, not two fades.** Over 380 → 520 the card fades out while its
children's grain fades in over the identical band; the crossing at ~450px is the reference's
*"the mouth has become a frame around the edge"*. **Nothing MOVES at a band edge** — position
is continuous by construction — so a cross-fade is the entire transition and there is nothing
to hide.

**FRAME is an HTML border on the canvas element, not an SVG stroke.** The mirror is then free
and it costs no hand-written x arithmetic. It fades out over 0.3 octaves once the rim is 1.6×
the viewport.

**OPACITY IS NEVER A RESTING STATE.** `mindtree.css` measured it: edge ink at `opacity: .55`
drops 6.06/5.53 → 3.76/3.20, spending the entire light-theme headroom on decoration. Every
band cross-fade **resolves within 0.3 octaves** to a fully opaque or fully absent mark. A
mark in motion is not a resting UI component under 1.4.11; a permanently half-faded one is,
and it would hand back its measured ratio.

**MATCH RIM (mandatory).** A world whose subtree contains ≥1 filter match, drawn at FRAME or
OPENING, carries a rim arc in `--accent` over the wedge of each matching child, plus the
match count at the rim's block-start. This is the answer to this contract's own biggest
weakness (§9) and it is not optional.

**THE ORGANIZATION LEAF.** It runs GRAIN → STATE → CHIP → CARD like everything else and then
it **stops**. Past 380px an Org card does not dissolve; it holds to the terminus clamp and
gains its account manager and vendor as a second line — the only place on the canvas with a
third text row, because it is the only place with nothing beneath it competing for the room.
Everything else about it is one tap away in the sidebar.

---

## 5. THE CAMERA

**THE STATE.** One value: `camera = {cx, cy, w}` in drawing units (`h` derived from the stage
aspect). `scale = stageWidthPx / w`. Plus `tweenRef: CameraTween | null`. That is all of it.
**`pan === null` is retired** — "stay fitted" only ever existed because bounds moved.

**INITIAL CAMERA.** A one-shot `useState` initializer framing the world named by
`focusView.node` (which `useMapFocus` already resolves from `?focus=` and the store, with the
deepest-surviving-ancestor fallback intact). It reads `layout.bounds` **exactly once, at
mount, keyed on the tree's structural revision** — never a memo the camera consults each
render. That is the single arrow from layout to camera and it fires when the admin changes
the tree, not when the reader breathes.

**FRAMING.** `frameCamera(node)` puts the world's apparent diameter at `FRAME_FILL × V`.
`FRAME_FILL = 0.87` desktop, **`1.25` phone** — the world deliberately overflows a small
screen so its children come up to CARD rather than CHIP. **That constant is the only
phone/desktop difference in the entire camera.**

Occlusion enters **here and only here**: on a fly, `V` is the unoccluded rectangle's smaller
side and the centre shifts by `(occludeInline/2)/scale` toward the reading start (mirrored
for Arabic; `useMapGeometry.ts:436-452`'s sign correction is right and is kept). **The
RESTING camera is never touched by occlusion** — opening a panel must not move the map, which
is a teleport arriving from the other side.

**WHEEL / TRACKPAD.** `wheel` on the canvas, `{passive: false}`, `preventDefault` (the stage
does not scroll and the canvas already carries `touch-action: none`).
`w *= exp(deltaY × κ)` with κ set so a 100px mouse notch is 1.15×.
`deltaMode === DOM_DELTA_LINE` multiplies by 16 first. `ctrl+wheel` — how macOS reports a
trackpad pinch — takes the same path at 3× κ, and `preventDefault` is what stops it
page-zooming the browser. Wheel is always zoom: this is a map, not a document, and the drag
already pans. No accumulator, no throttle, no rAF batching — each event writes state
directly, and React's batching is the only smoothing needed because the geometry is not
recomputed.

**THE ANCHOR IS THE CHANGE THAT MATTERS.** Convert the pointer (or the pinch midpoint) to
drawing units and hold it invariant: `cx' = p.x + (cx - p.x) × ratio`. Four lines, three call
sites, and **it is the fix for the bug named in §0**. This is what makes "the thing you zoom
into becomes the whole frame" true with no explicit target selection: whatever is under your
finger grows toward the frame because it is pinned there.

**PINCH.** Anchored on the two-pointer midpoint. Two-finger drag of the midpoint pans in the
same gesture, so a pinch-and-shove is one continuous move rather than a zoom followed by a
correction.

**TAP.** On a department: fly to `frameCamera(node)`. On an Organization: open the sidebar,
camera still. On empty canvas: dismiss transient chrome, camera still. Double-tap on a
department is the same as a tap — one gesture, learned once.

**THE FLY.** `beginCameraTween` / `sampleCamera` / `retargetCameraTween` as they stand, on one
rAF loop writing `viewBox` through `viewBoxOf` so React's next render is **byte-identical**
and has nothing to correct (`mapMotion.ts:44-51`). One number changes:
`tweenDurationFor` becomes `140ms + 300ms × octaves`, capped at **1100ms** (`FLY_MAX_MS` rises
from 420). A one-tier dive is ~1.43 octaves ≈ 570ms; a four-tier surface caps at 1100. 420ms
across a whole workspace is a cut, not a move; the reference spends ~1.8s per world and this
lands at ~2.6 octaves/second, deliberately close to it.

**INTERRUPTION is already correct and is the property that makes this safe.** A second fly
`retargetCameraTween`s from where the camera actually IS, so the picture bends rather than
snapping. A gesture arriving mid-flight **drops the tween where it stands** — the reader has
taken the camera back and the app has no business arguing. Neither case carries velocity, and
neither should: a spring has no end time and cannot be made instant for a reader who asked
for that.

**ZOOMING OUT IS THE EXACT INVERSE, AND THAT IS THE WHOLE POINT.** Because coordinates are
absolute and the drawing is static, surfacing returns the reader to the identical framing
they left, **to the unit** — not to a re-fitted approximation of it. As the camera pulls back
the parent's rim re-enters from the edges before its children have finished fading, which is
the visual promise that there IS an outside. The reference does exactly this and it is why
the dive never feels like falling.

**THE READER NEVER LOSES THEIR PLACE — four mechanisms, none of them a hope.**
(1) Nothing teleports, because nothing is recomputed.
(2) Every zoom is anchored on a point the reader chose.
(3) The breadcrumb is **derived** by a pure `worldAt(camera)` — the deepest structural node
whose world contains `(cx, cy)` and whose `a ≥ 0.85V` — so it is not state and cannot drift.
(4) The name hands off from rim label to breadcrumb **at the 0.85V crossing and at no other
instant**, so it is never absent and never drawn twice, and the handoff is a pure function of
`a`.

**REDUCED MOTION.** Wheel and pinch stay continuous — direct manipulation is the reader's own
hand, not motion the app inflicted. Only PROGRAMMATIC moves become instant, which
`beginCameraTween`'s zero-length tween already delivers with no cooperation from the loop
(`mapMotion.ts:445-460`). Band cross-fades collapse to hard thresholds; nothing pops
positionally because nothing moves.

**PERFORMANCE.** Rendering culls to worlds intersecting the camera rect AND `a ≥ 7px` —
typically 60–150 nodes at any camera, fewer than today's map draws. The cull is a linear scan
over a pre-sorted-by-depth array. The saving that matters is React reconciliation, and
`MindNode`'s existing `memo` means a pure camera change re-renders **zero** nodes whose band
did not shift. **The DOM horizon extends one band deeper than the eye's** (`a ≥ 4px`,
`visibility: hidden`) so keyboard reach never waits on a repaint.

**ANNOUNCEMENTS DO NOT CHATTER.** The live region fires only on a **world crossing** — the
breadcrumb changing — debounced 400ms after the camera settles. One sentence: the world's
name, its department count, its organization count. A continuous wheel through three worlds
announces once, at rest, naming where you landed. The percentage announcement is gone.

**`aria-posinset` / `aria-setsize` come from the MODEL, never from the cull.** They already do
(`radial.ts:314`, `siblingCount: node.parent.children.length`). A culled sibling must not
renumber the set — that is the one way the DOM horizon could lie.

---

## 6. THE CONTROL BUDGET — 19 targets become 12

Every cut names the mechanism that replaced it. None is taste.

### KEPT (12), each with the reason it cannot be cut

| # | control | why it survives |
|---|---|---|
| 1 | Search field | the fastest path to one item, and the only thing the dive genuinely cannot answer — *"where is the thing called X"* is not a question about position |
| 2 | Filter (n) | the facet count must be visible or a filtered map lies about being empty. **`Mine` becomes its first row** |
| 3–7 | Five lens chips, never behind a disclosure | `MAP-CONTRACT §1`. Each replaces a tab-bar slot at one interaction; `DEFAULT_LENS = 'needs-me'` is a day-one regression if it moves. **One filled, four ghost `--text-dim` — the tiering is the answer to "nothing leads the eye", not the count** |
| 8 | Meetings | a mode, one tap. A meeting starts while people walk into a room |
| 9 | Export ⧉ (Digest inside) | presenting is the delivery mechanism until executive logins ship |
| 10 | **Group-by, as ONE menu** | `dropRules.ts` writes a different patch per dimension: this is the map's editing mode selector, and a mode selector is the last thing you bury. Four chips → one `.malt-pop` menu, universal |
| 11 | **THE DIVE RAIL** (new) | one continuous control replacing seven |
| 12 | Table toggle | the low-motion, screen-reader-first reading of the same model. **Burying an accessibility mode is not available to us** |

Plus the breadcrumb's 2–4 derived crumbs (not fixed chrome — they are the accessible
statement of where the camera is, and the way out), and the panel's single ✕.

### CUT (8 controls + 3 pieces of chrome)

| cut | reason |
|---|---|
| `Zoom −`, `Zoom +` | the wheel and the pinch are the control. They survive as `+`/`−` **keys**, because deleting a button must never delete keyboard reach |
| `Zoom 100%` readout | already gone from the chrome; `zoomPercent` stays in the return value only because the export caption prints the scale a **file** was taken at |
| **The four altitude stops** | this is the required cut, not the preferred one. The owner's correction says the number of levels is the depth of the tree the admin configures; four frozen English words is exactly the hard-coded ladder the brief forbids. **The four words survive as tick LABELS on the rail**, so nothing nameable is lost |
| `Fit to view` | the rail's Home rung, plus `Escape` |
| `Expand all` | every child is already in the drawing, waiting at its own distance. There is no fold to open. `useMapToolbar.expandAll` stays **exported** for the table stage and the node menu, which still mean something by it |
| `Collapse all` | as above. `expandedIds` survives as the reader's explicit per-branch choice and the table reads it; only the batch verbs go |
| `Compact` / density | the LOD bands are absolute pixels, so density is now a camera position rather than a preference. **The store value survives for the table path** |
| "Show the panel" | one ✕ on the panel |
| `LOOKING AT` / `GROUP BY` labels | already `aria-hidden` spans. **Deleting `GROUP BY` is a wiring change, not a CSS one**: `id="mtree-groupby"` is the chip row's `aria-labelledby`, and an `aria-labelledby` pointing at nothing contributes NO name — the row must take `aria-label={t('mindtree.groupBy')}` directly (`MapToolbar.tsx:133` already does this; keep it) |

**No locale key is retired.** An orphan key is harmless — still parity-tested, still renameable
in Terminology — and deleting one is a three-file change for zero user-visible gain. The four
`mindtree.altitude*` keys keep their exact values as rail tick labels; `mindtree.altitudeChanged`
is repurposed verbatim (its `{label}` slot takes a department name).

### THE DIVE RAIL, specified

`<input type="range">`, `min=0`, `max=octaveSpan`, `step=0.02`, vertical at the canvas
inline-end (block-centred), with **`aria-valuetext` set to the WORLD IT CURRENTLY
FRAMES**, not to a number. One node in the accessibility tree, natively keyboard-reachable
(arrows step a tier, **Home = frame the root**), continuous, and it speaks a word.

> **CORRECTED BY MEASUREMENT (rebuild).** This section priced the island at **44×308** — the
> track's own width. The TRACK is still 44px, but the plate that carries it measures
> **~134×366** at 1600×900, because the tick LABELS need a gutter *on* the plate. That is not
> an overrun, it is where the next paragraph's promise gets paid: beside a vertical rail the
> only axis a label can hang on is the block axis, and **the block axis does not mirror** — so
> a name hung outside the plate sits over the drawing in Arabic and off the screen edge in
> English, at 11px `--text-dim` over whatever colour a node happens to be. Inside the plate it
> is over the measured `--bg-elev`. The budget line in §7 moves with it: **~1.4% → ~4%** of the
> stage. If the 4% is ever judged too dear, the only lever is to cut the names back to
> unlabelled marks — which is the one thing the CUT table below promised would not happen.

**Tick marks beside the track at each world boundary ON THE CURRENT PATH**, labelled with the
real department names from `map_node_kinds` — already bilingual data, which is precisely why
the ladder can be the admin's depth rather than four English words. Dragging the thumb IS the
continuous zoom for anyone who cannot wheel and for a one-handed reader who finds a pinch
awkward.

Contrast, from the existing matrix, no new colour: rungs `--field-border` on `--bg-elev-2`
(**3.26 / 3.10**, over the 3:1 non-text floor); thumb `--accent` (**6.72 / 6.32** on the bare
canvas, **3.29 / 3.74** at its worst over a hovered node fill — the sheet's documented
non-text floor, and it passes).

`aria-pressed` toggles, never `role="radiogroup"` — a radio group takes the arrow keys away
from everything inside it and the canvas's roving tabindex is one Tab stop away
(`MapAltitude.tsx:14-20`, and the reasoning is kept).

**Net: 19 targets in four islands → 12 floating over a full-bleed canvas, with one filled
chip in a row of four ghosts and one continuous rail where seven buttons were.**

---

## 7. COMPOSITION

### Desktop, 1600×900, LTR

RTL is this description with inline-start and inline-end exchanged. Every island is placed
with `inset-inline-*`, so the mirror is free in the HTML layer.

| region | size | share |
|---|---|---|
| App header | 1600×65 | 7.2% |
| **Stage** (`.mtree`, the grid) | 1600×835 | 92.8% |
| — Canvas, `inset: 0` | 1600×835 | the map begins at **7%** of the viewport |
| — Caption strip, `inset-block-end: 76px` | 1600×32 | 2.4% |
| — Composer, centred, `inset-block-end: 12px` | 720×56 | 1.5% |

**`.main-content { max-inline-size: 1180px }` gets a full-bleed opt-in** (U4). 1600 − 232
sidebar − 1180 = **188px** that no rule in `mindtree.css` can reach today. This is the last
structural pixel-thief on the screen and it is named in the sheet's own handoff.

> **THE OPT-IN SHIPPED, SO THE TABLE ABOVE IS OFF BY THE SIDEBAR.** `app-shell.css` gives the
> map route `data-fullbleed`, which drops the 1180px cap *and* zeroes `--main-pad-inline`. The
> stage therefore measures **1368**, not 1600: the sidebar's 232px is real and sticky, and no
> full-bleed opt-in can reclaim it. Read every "1600" in the region table as 1368 of usable
> inline space. **The zeroed inline padding is load-bearing on the phone too, and in a way that
> reads as a bug:** at 375px *nothing* on this screen has an inline gutter unless it states one,
> so any block that forgets lands flush against the glass and looks sheared. `.mtree-rail`,
> `.mtree-foot` and `.mdive[data-compact]` each state their own 8px for exactly this reason.

Islands, inset 12 from the stage edges:

> **CORRECTED BY MEASUREMENT (rebuild): FOUR ISLANDS BECAME ONE CONTROL RAIL.** The four
> boxes below were each positioned *absolutely, against a stage width this document measured
> wrong* — and no absolute box can see another, so the browser showed what the arithmetic could
> not: "Grouped by Status" alone on an orphan second row at the opposite edge from the row it
> belonged to, and the lens island lying across the empty state's sentence. The replacement is
> one flex row, `nowrap`, and the only number left in the layer is its own 12px inset. What
> follows is what is on the screen now.

- **the rail**, 1344 wide, one row, at the stage's block start — the filter group at the
  reading start (out of the rail's *flow*, so an open facet panel grows over the picture
  without carrying the row down with it), then the five lens chips + Meetings + Export, then
  the group-by disclosure. Measured 384 + 726 + 147 with 63px to spare in English, 94 in
  Arabic. Below that width the **lens island** is the one that yields — it wraps inside its own
  plate for 44px — and the group-by never shortens, because a control whose whole job is to
  name the active dimension may not be the thing that gets abbreviated. **≈3.5%**
- **under the rail** — **the breadcrumb** and the truncation note.
  `NphiesCore › UHR › Onboarding › **Riyadh Cluster**`. Each crumb a 44px tap that flies to
  that world; the last is `aria-current="location"`, unclickable. **Truncates from the
  START** (`…› Onboarding › Riyadh Cluster`) — the near end is what you need. It is an
  INDICATOR, not a control, which is why it left the rail and sits beneath it. **0.7%**
- **inline-end, block-centred** — the dive rail + Table. **Measured ~134×366, ≈4%** (§6 states
  what the extra width buys and why it cannot be spent elsewhere).
- **caption strip** — the legend (`size = open items` · `● past deadline` ·
  **`direction from the centre means nothing`**), the summary sentences.
  One row, one baseline. A radial map invites a reader to decide 3 o'clock is important; the
  legend must say it is not. **The separate result count is deleted**: it was
  `mindtree.countOpen` with `model.tree.count`, the same number from the same expression the
  summary sentence already carries in its `{open}` slot, so the screen printed "0 open" twice —
  the second time larger than the sentence containing it. The key is *not* orphaned, and the
  "no locale key is retired" rule is not invoked: `pages/map/useMapModel.ts` still builds a
  node's detail line from it.
- **what the canvas says when there is no drawing** is centred in the space the rail leaves,
  not in the whole stage. An empty state is the only thing on the screen when it is on the
  screen, and floating chrome may not lie across it.

**Chrome at rest ≈ 8.8% of the stage.** The delta versus the prior contract's numbers is two
INDICATORS — the breadcrumb and the truncation-from-the-start rule — which are the price of a
camera that can be anywhere, and they are the cheapest possible price: no control, no state,
derived.

**Panel open:** 416px floating at the inline end, **still a SIBLING of the canvas and never a
child** (`touch-action` intersects down the ancestor chain and a list inside the canvas cannot
be finger-scrolled). It reports its own occlusion by ResizeObserver — `MapPanel.tsx:239-268`
already does this and is kept byte for byte. **It does not move the map**, because occlusion
no longer feeds a fit.

**Tab order, asserted in a test and not inherited:** search → Filter → lens chips → Meetings
→ Export → group-by → breadcrumb crumbs → dive slider → Table → the tree's single roving
stop → sidebar → composer.

> **THE CRUMBS MOVED FROM THIRD TO SEVENTH, and it is the rail's doing, not a slip.** When the
> breadcrumb was its own top-centre island it sat visually between the two top islands, so
> third was also its reading position. It is now beneath the rail, and DOM order here is both
> the tab order and the reading order — so third would have been a keyboard stop that fires
> before every control it is drawn under. `MindtreeShell.test.ts` asserts the CONTROLS' order
> (`FilterBar → MapLensBar → MapModeBar → MapToolbar → MapDiveRail → stage → panel →
> composer`) and that assertion is unchanged and still passing; the crumbs are not in it,
> which is why this line — and not a test — is what records their move.

**WCAG 1.4.10 reflow.** The `100dvh` stage is gated on
`(min-width: 768px) and (min-height: 480px)`; the phone grid on
`(max-width: 767px) and (min-height: 480px)`. At 400% zoom on 1280×1024 the CSS viewport is
320×256 and fails **both** guards, so `.mtree` returns to the document-flow column and the
islands become ordinary blocks. That path is **tested at 320×256 explicitly**, because "it
falls back" is what everyone says about the path nobody exercises.

### RTL

There are no logical properties inside `<svg>`. Every new mark is hand-written x arithmetic
and each mirrors explicitly:

- the CARD's progress fill grows from the reading start: `x = rtl ? width - PAD - fillW : PAD`;
- the MATCH RIM arc and every world rim are produced by the geometry module and inherit its
  **single θ → π − θ reflection statement**;
- **any directional arc's `sweep-flag` flips under `rtl`.** `strip` caught this and it is
  correct: the mirror turns clockwise into anticlockwise, so a fixed sweep-flag makes a
  progress arc read as counting DOWN in Arabic. The plan's Part 3 claim that "RTL comes out
  better than it went in" is true for node placement and **false for any directional mark**;
- the CHIP's outside label keeps `MindNode.tsx:279-297`'s `(outward.x > cx) !== rtl`
  inversion, which is already the fix for the double-mirror;
- `text-anchor` stays **constant** and `direction` is stated on the `<g>` —
  `MindNode.tsx:359-368`'s bug is not re-committed;
- the FRAME rim is an HTML border on the canvas element, so it mirrors for free.

**RTL is equal to LTR, and the equality is assertable because there is one reflection
statement, not two layouts.**

### Locale — a THREE-FILE change every time (`en`, `ar`, `src/lib/labelSections.ts`)

New keys: `mindtree.diveLabel` · `mindtree.diveValue` `{world}` · `mindtree.diveInto` `{label}` ·
`mindtree.openDetails` `{label}` · `mindtree.crumbLabel` · `mindtree.arrivedAt` `{label}` ·
`mindtree.progressLive` `{done, total}` · `mindtree.worldSummary` `{world, departments, organizations}` ·
`mindtree.matchesHere` `{count}` (plural node) · `mindtree.legendAngle`.

Exact en/ar parity. `dive*`, `crumb*` and `world*` are added to the mindtree `prefixes` list
beside `zoom`. **The key tables stay LITERAL** — `localeReach.test.ts` scans source for quoted
dotted strings, and a `t(\`mindtree.dive${x}\`)` ships missing in one language
(`altitude.ts:38-41`).

---

## 8. THE PHONE — 375×812

**The structural win, stated first, because it is the reason the phone stops being a
compromise.** `useMapGeometry.ts:360` pins `if (compact) return 1`. Today ring 2 is not drawn
small on a phone — **it is deleted**, and a phone reader has no way to know there is anything
under OB at all. The camera removes the requirement that generated the pin: **the phone does
not need everything to fit; it needs the CURRENT WORLD to fit, and a world is six to nine
children on one ring at any depth in the tree.**

So the phone gets the **full hierarchy**, with **identical LOD thresholds**, because the
thresholds are in CSS pixels and a CSS pixel is a CSS pixel. **The phone is not a reduced map.
It is the same map with a smaller window.** That is the first time the two screens have agreed
about anything on this page.

`.mtree` is a `100dvh` grid of `auto | minmax(0,1fr) | auto` — **this already ships** and is
kept verbatim, including `padding-block-end: calc(var(--map-lens-rail-block-size, 48px) +
var(--map-composer-block-size, 0px))`, which is what makes the canvas exactly the band the
reader can see and therefore makes `useBoxSize`'s measurement honest.

| region | px | share |
|---|---|---|
| App header | 65 | 8.0% |
| Top rail (search · breadcrumb · Filter) | 48 | 5.9% |
| **CANVAS — the `1fr`** | **587** | **72.3%** |
| Lens rail — `fixed`, **z-71**, one above the sheet's 70 | 48 | 5.9% |
| Composer — `fixed`, z-75 | 64 | 7.9% |

**Top rail:** `[🔍 44][breadcrumb — flex, min-inline-size 0, inline scroller, snap][Filter(n) 44]`.
The breadcrumb is the phone's way OUT and belongs at the top, above the thumb's reach, because
it is read far more often than it is pressed.

**The dive rail is HORIZONTAL on a phone**, 44px, full width minus 16, immediately above the
lens rail. A vertical rail at the inline end collides with the thumb's natural arc and with
the sheet's drag handle. Same `<input type="range">`, same `aria-valuetext`, `inset-inline-*`
only.

**`FRAME_FILL = 1.25`.** A framed world deliberately OVERFLOWS the small viewport, so its
children land at `1.25V / 2.69 ≈ 0.46V ≈ 173px` apparent — **CARD**, not chip. On the desktop
the same arithmetic gives `0.87 × 835 / 2.69 = 270px`, also CARD. **One constant, and a child
of the framed world is a legible named card at both widths.** Above eight children the CHIP
band takes over with the outside-label-along-the-ray mechanism, and the words stay on screen
because they are drawn outside the box. That mechanism already exists and is already measured
(`radial.ts:390-423`).

The cost is that the parent's rim is off screen the moment you arrive, so the stage border and
the breadcrumb carry "where am I" alone — which is precisely what they are for.

**GESTURES.** Pinch, anchored on the midpoint (the fix). One-finger drag pans, unchanged, and
the map is still pannable from a node until the hold lands — the whole argument for the hold.
Tap a department: dive. Tap an Org: the sheet opens, camera still. Tap a crumb: surface.
**`mindtree.mobileHint` is KEPT**, because a thumb has no cursor and the gesture is not
otherwise discoverable.

**THE SHEET.** `phoneDetentFor`, `MAP_DETENTS` and `DETENT_KEY` are untouched, and the
`needs-me` landing detent stays `full`. `MAP-CONTRACT §1` prices that as a paid-for guarantee,
and the failure was never the sheet's height — it was that at `full` there was no way back to
the map. **The pinned lens rail is the way back, in one tap, under the thumb, and it already
ships.** Occlusion is measured from the sheet's own ResizeObserver and reaches the camera at
exactly one place: `V` and the `cy` shift inside `frameCamera`.

**Reachability, as a claim that can be checked.** Every target — search, breadcrumb, Filter,
five lenses, the dive rail, the map, the sheet handle — is inside the bottom 40% or the top
48px. Nothing load-bearing sits in the middle-right dead zone. All chrome targets ≥ 44px; map
nodes ≥ 24 CSS px per 2.5.8; **GRAIN and STATE are not targets** (`pointer-events: none`,
`aria-hidden`, and not in the `role="tree"` DOM), which is what makes that claim true rather
than aspirational.

---

## 9. THIS CONTRACT'S OWN WEAKNESS, named so it is not discovered later

**An infinite-zoom illustration is a superb way to browse a fixed structure and a poor way to
answer "show me everything at risk" — and the filter is what this app's reader does most.**

Six at-risk Orgs scattered across five departments are six grains in five worlds, four octaves
apart, and **there is no single camera that shows all six legibly.** The MATCH RIM (§4) turns
"five worlds away" into "that way, three of them", which is a signpost and not an answer. The
honest position is that this design trades the map's second job for a much better first job.

**The mitigation is not new and it is not a dodge: `MAP-CONTRACT §0` already made this trade.**
Its most valuable finding is that the daily cross-cutting job belongs to a real-DOM list beside
the canvas, which is why `needs-me` is the default landing. The set question was never on the
canvas. And the counter-argument is worth stating: at the fits this map actually achieves today
— 0.23 measured, 0.37 for a 45-node ring, 0.27 for ring 3 — the matches were 6px marks nobody
could read and the reader was going to the panel anyway. **This design at least makes the
failure legible.**

**Three smaller weaknesses, named.**

1. **Unequal dive depth.** A department with 200 children makes each child's world tiny
   relative to itself, so diving into it costs 3–4 octaves where a three-child sibling costs
   1.4. The camera's rate is uniform in octaves, so the reader spends three times longer
   entering one branch with no signal why. **The rail's tick marks expose it** — they are
   unevenly spaced on the current path — which converts a mystery into a fact about the
   workspace, but the asymmetry is real and a fixed ring model does not have it.

2. **The static layout is a bet on the admin's tree being stable.** Every claim about never
   losing your place holds only while the tree does not change. When an admin adds a
   department every radius shifts and every remembered framing is stale. **Therefore the URL
   carries the WORLD's node id — `?focus=` — and never the camera's coordinates.** That is
   already how `useMapUrl` works, so the constraint costs nothing; it is stated so a future
   "save my camera position" feature does not quietly break it.

3. **The depth may not be here yet.** `lod`'s self-critique is right on the facts: Aziz's
   hierarchy today is **UHR → OB → Organizations** — two department tiers and a leaf. At that
   depth the whole organisation is on one screen and the dive is a magnifier. **What pays for
   itself immediately and independently of the camera is the LOD half**: `radial.ts:426`'s own
   measurement rejects ring 3 at scale 0.27 today, and CHIP + GRAIN are what let a three-tier
   workspace draw legibly instead of two. That holds whether or not anyone ever zooms.
   The schema was built for depth — `map_nodes` has a self-referencing `parent_id`, a depth cap
   of 6, and `MAX_SEGMENTS` was raised 6 → 12 (`focus.ts:507`) *specifically because a shared
   link to a deep path was silently truncating* — and the plan lists nine domains that are
   plainly the next tier up. **The depth is coming. It is not here.**
   **Sequencing consequence, and it is binding: U1, U2, U4 and U5 ship first and are worth
   shipping against the tree as it stands. U3's fly, terminus and tick machinery is built in
   the same wave but is verified against a three-tier fixture, not against live data.**

---

## 10. THE GATES

- `npx tsc -b` — **NOT `--noEmit`.** The root tsconfig is solution-style; `--noEmit` checks
  zero files and exits 0 no matter how broken the tree is.
- `oxlint` — 0 errors.
- `vitest` — **3,810 must not regress.**
- `npm run build` succeeds.
- Locale parity / reach / plural / bidi; the four standing greps.
- **No new runtime dependency.** No d3, no react-flow. `Math`, one `<g transform>`,
  `mapMotion.ts`'s existing solver, and CSS.
- **No live data touched, no migration run.**
- Contrast: every ink 4.5:1, every non-text mark 3:1, computed on the worst surface of BOTH
  themes, appended to `mindtree.css`'s matrix in its own format.
- Live proof in a real browser at 1600×900 and 375×812 in **both languages**.

---

## 11. THE WORK UNITS

**Every file belongs to exactly ONE unit.** Files listed in §12 are shared and are the
integrator's alone — no unit edits them. Each brief below is complete on its own; a unit
needs no other unit's brief to start.

---

### U1 — THE STATIC DRAWING

**Owns**
```
src/lib/mindtree/worlds.ts              (NEW)
src/lib/mindtree/worlds.test.ts         (NEW)
src/lib/mindtree/radial.ts
src/lib/mindtree/radial.test.ts
src/lib/mindtree/layout.ts
src/lib/mindtree/layout.test.ts
```

**Exported signatures — `worlds.ts`**
```ts
import type { Bounds, LayoutInputNode, LayoutOptions, MindtreeEdge,
              NodeSize, PositionedNode } from './layout'

/** Packing constants. Named, exported, and asserted — not inlined. */
export const RIM = 1.14
export const GAP_RATIO = 0.18
export const D_LEAF = 200
export const SINGLE_CHILD_RATIO = 2.2

export interface WorldNode<N extends LayoutInputNode = LayoutInputNode>
  extends PositionedNode<N> {
  /** Centre of this node's WORLD, absolute drawing units. */
  readonly worldX: number
  readonly worldY: number
  /** Diameter of this node's world, drawing units. */
  readonly worldD: number
  /** `kind` is 'root' | 'track' | 'entity'. Only a structural node may be framed. */
  readonly structural: boolean
}

export interface WorldLayout<N extends LayoutInputNode = LayoutInputNode> {
  /** Pre-order, full depth. `aria-*` fields identical to `layoutMindtree`'s. */
  readonly nodes: readonly WorldNode<N>[]
  readonly byId: ReadonlyMap<string, WorldNode<N>>
  readonly edges: readonly MindtreeEdge[]
  readonly bounds: Bounds
  readonly maxDepth: number
  readonly rootD: number
  /** Structural revision — changes iff the TREE changed. The camera's one
   *  mount-time read is keyed on this and on nothing else. */
  readonly revision: string
}

export interface WorldOptions<N extends LayoutInputNode = LayoutInputNode>
  extends Omit<LayoutOptions<N>, 'depthLimit'> {
  /** Authored size of a leaf card. Defaults to DEFAULT_NODE_SIZE. */
  leafSize?: NodeSize
}

export function layoutWorlds<N extends LayoutInputNode>(
  root: N,
  options?: WorldOptions<N>,
): WorldLayout<N>

/** The deepest STRUCTURAL world containing the point whose apparent diameter is
 *  at least `frameFraction × viewportMinPx`. Pure; total; null when none. */
export function worldAt<N extends LayoutInputNode>(
  layout: WorldLayout<N>,
  at: { readonly cx: number; readonly cy: number },
  scale: number,
  viewportMinPx: number,
  frameFraction?: number,
): WorldNode<N> | null

/** Root-first, target LAST, inclusive — `FocusView.trail`'s shape exactly. */
export function ancestorWorlds<N extends LayoutInputNode>(
  layout: WorldLayout<N>,
  id: string,
): readonly WorldNode<N>[]
```

**Exported signature added to `radial.ts`**
```ts
/** Pack n child worlds on a ring INSIDE a parent. The chord form, applied inward. */
export function packRing(input: {
  readonly childD: readonly number[]
  readonly gap: number
}): { readonly radius: number; readonly bearings: readonly number[]; readonly parentD: number }
```

**Brief.**
Build the containment layout. Every node owns a circular world of diameter `D`; its
children's worlds are packed on a ring **inside** it:

```
r_children = (D_child/2 + gap) / (2·sin(π/n))        n ≥ 2   ← CHORD, not arc
D_parent   = 2·(r_children + D_child/2) · RIM
gap        = GAP_RATIO · D_child
n = 1      → D_parent = D_child · SINGLE_CHILD_RATIO
n = 0      → D_parent = D_LEAF
```

Build **OUTWARD from the leaves**: `D_leaf = 200` around a 168×44 card, so the finest detail
sits at unit scale where float precision is best. A uniform 6-wide tier has ratio 2.69 (1.43
octaves); 9-wide, 3.40 (1.77). Five tiers span ~52× — a root world around 10,400 units. Every
coordinate lands between 1 and 10⁵, inside float32's seven digits with room, so the SVG
rasteriser never sees a degenerate span. **Assert that bound in a test at depth 6, which is
`map_nodes`' own cap.**

`radial.ts`'s chord-not-arc correction is the reason this works and it is carried verbatim:
three children give Δθ = 120°, chord `2r·sin60° = 1.73r` against an arc of `2.09r`, so an
arc-derived radius overlaps boxes at the commonest fan-out on this screen. `packRing` is that
arithmetic, applied inward, and the existing `ringRadii` second pass (the exact-pair guarantee
for non-adjacent wide/narrow neighbours) comes with it.

**Boxes never rotate.** Only world-centres sit on a circle. That is what keeps `CHAR_PX`,
rect hit-testing, `PulseLayer`, `MindDropTargets`, `DragLayer`'s pointer→layout conversion, the
CSS `translate` tween and `export.ts`'s serialiser working unchanged.

`buildLayoutNodes` is **called, never copied** — pre-order, the cycle guard, `hiddenChildCount`
and therefore `aria-level` / `aria-posinset` / `aria-setsize` all come from the one function
the linear layout uses, so the two shapes cannot drift. `aria-setsize` must remain
`node.parent.children.length` (the MODEL's sibling count) — a culled sibling must never
renumber the set.

**Bounds must union the Bézier control points.** A radial cubic genuinely leaves the union of
its endpoint rects, unlike a horizontal S-curve whose controls share their endpoints' y. Miss
it and connectors clip at the drawing's own margin.

**RTL is ONE reflection statement**, θ → π − θ, applied once at the end, with bounds padded
**symmetrically about the hub first** so the mirror is an exact equality rather than an
equality to nine places (`radial.ts:275-294` — keep that comment and its reasoning).

`depthLimit` **stops being a layout input for the canvas** but must remain in `layout.ts` and
keep working: `export.ts` and `MindtreeTable` read it. Likewise **do not remove**
`fitToViewBox`, `zoomLimits` or `sizeForCount` — the export path and the table depend on all
three. `ringsThatFit` loses its only caller; leave it exported and tested (the export path may
want it) but delete nothing else.

`ringNodeSize`'s guard changes: **drop `options.compact &&`** and take a `chip: boolean` in its
place. The 44×44 count chip with the label outside along the ray becomes a BAND, selected by
U2, not a phone hack.

**Assertions this unit owes.** Exact angular partition (`Σ child wedges === parent wedge`, by
shared endpoints not by summation) · no overlap within a ring · **no containment violation: a
child world is entirely inside its parent's** · bounds contain the curves · bounds centred on
the root · exact RTL mirror equality · no NaN at any input including sizes an area encoding
turned into NaN · **`layoutWorlds` is referentially stable across a camera change** (it takes
no camera argument, so this is a type-level fact and a test that pins it) · 200 children on one
ring stays finite · depth 6 stays inside 10⁵.

---

### U2 — THE FIVE RENDERINGS

**Owns**
```
src/lib/mindtree/lod.ts                     (NEW)
src/lib/mindtree/lod.test.ts                (NEW)
src/components/mindtree/MindNode.tsx
src/components/mindtree/MindEdge.tsx
src/components/mindtree/MindWorldRim.tsx    (NEW)
src/components/mindtree/MindWorldRim.test.tsx (NEW)
src/components/mindtree/mind-ring.css
```

**Exported signatures — `lod.ts`**
```ts
export type Band = 'absent' | 'grain' | 'state' | 'chip' | 'card' | 'opening' | 'frame'

/** Absolute CSS px, except `frame`, which is a fraction of the viewport's
 *  smaller dimension — legibility is absolute, "is this the frame" is not. */
export const BAND_EDGES: Readonly<{
  grain: 7; state: 26; chip: 52; card: 140; opening: 380; frame: 0.85
}>

/** How much of a band's width the cross-fade occupies at its top edge. */
export const BAND_BLEND = 0.18

export function apparentOf(worldD: number, scale: number): number

export function bandFor(apparentPx: number, viewportMinPx: number): Band

/** The band plus its fade-out progress, 0 → 1, toward the band above.
 *  `out === 0` means fully in this band; `out === 1` means fully in the next. */
export function bandBlend(
  apparentPx: number,
  viewportMinPx: number,
): { readonly band: Band; readonly out: number }

/** The DOM horizon — one band deeper than the eye's, so keyboard reach never
 *  waits on a repaint. `visibility: hidden` below `bandFor === 'absent'`. */
export const DOM_HORIZON_PX = 4
```

**`MindWorldRim.tsx`**
```ts
export interface MindWorldRimProps {
  readonly world: { readonly worldX: number; readonly worldY: number; readonly worldD: number }
  readonly label: string          // already isolate()d by the caller
  readonly ink: CSSProperties     // the branch's --track-c-* pair
  readonly matches: number        // 0 = no match rim
  readonly matchWedges: readonly { readonly start: number; readonly end: number }[]
  readonly rtl: boolean
  readonly fade: number           // 0..1, from bandBlend
}
export default function MindWorldRim(props: MindWorldRimProps): ReactElement | null
```

**`MindNode.tsx`** keeps `MindNodeProps` exactly as it is and gains **one** prop:
```ts
  /** Which drawing to render. From lod.bandBlend, computed once in the page's memo. */
  band: Band
  /** 0..1 cross-fade out of `band`. Only `opening` and `frame` read it. */
  bandOut: number
```

**Brief.**
Five authored drawings, selected by apparent diameter. **No two are the same drawing at a
different size** — change a node's apparent size by one band and its ink changes KIND, not
just extent. That is the whole idea and it is the property to test: for every adjacent band
pair, assert the set of SVG element types rendered differs.

Per band, exactly:

- **ABSENT** (`a < 7`) — not rendered, not in the DOM below `DOM_HORIZON_PX = 4`; between 4
  and 7, rendered `visibility: hidden` so a keyboard walk can land on it.
- **GRAIN** (`7 – 26`) — one filled `<circle>`, diameter `0.42a`, in the node's own 16% track
  fill with the measured 1px outline ink. **No text of any kind.** This is the reference's blue
  smudge. Forty grains read as a dense arc, six as a constellation — that density difference IS
  the information here, and it is free. **One mark per node, never a sample:** a branch labelled
  12 showing 3 is the worst thing this map can do (`model.ts`'s rule).
- **STATE** (`26 – 52`) — the disc gains its rim stroke, plus the breach dot at block-start if
  anything beneath is past deadline. **Still no text** — a numeral inside a 30px disc renders at
  3px and is a lie about legibility.
- **CHIP** (`52 – 140`) — 44×44 unrotated rect, count centred inside at 12.5px tabular, **name
  OUTSIDE along the ray**, `OUTSIDE_LABEL_BUDGET = 14`, `OUTSIDE_LABEL_GAP = 8` past `outward`.
  **`MindNode.tsx:279-297` already implements all of this, including the Arabic anchor inversion
  `(outward.x > cx) !== rtl` and the `pointerEvents="none"` on the outside `<text>` that keeps a
  reaching label off a neighbour's target.** Reuse it verbatim; change only the gate — from
  `pos.width < LABEL_INSIDE_MIN` to `band === 'chip'`. 52px is the number because that is where
  a 14-glyph label at `CHAR_PX = 6.2` (87px) has daylight on both sides of the tightest ring the
  packing produces. Breach dot moves to `cx = width/2` on the block-start edge, where a chip has
  no competing ink.
- **CARD** (`140 – 380`) — the full 168×44: label inside on the reading edge with the measured
  character budget, count at the reading end (`COUNT_SLOT = 34`), breach dot at the block-start
  reading end, chevron at `pos.outward`, **plus the progress underscore**.
- **OPENING** (`380 – 0.85V`) — the card cross-fades OUT while its children's grain cross-fades
  IN over the identical band, **one dissolve, not two fades**. The name migrates to a rim label
  at the world boundary's block-start, 13px, `--text` on the canvas. `MindWorldRim` draws it.
- **FRAME** (`≥ 0.85V`) — **nothing of this node is drawn in SVG.** Its boundary becomes a 2px
  inset stroke on the STAGE — an HTML border on the canvas element, so the mirror is free — and
  fades over 0.3 octaves once the rim is 1.6× the viewport. Its name is in the breadcrumb, and
  the handoff happens **at the 0.85V crossing and at no other instant**, so the name is never
  absent and never drawn twice.

**THE PROGRESS UNDERSCORE, specified because a study got it wrong.** 2 units tall, inset `PAD`
from both inline edges, on the block-end edge inside the box, filled to the live share.
**There is NO track behind the unfilled remainder.** Length is the encoding; the box's inset
marks both ends. A prior proposal specified "the outline ink at 20%", which is not in the
matrix and which `mindtree.css` forbids in principle — dilution hands the measured ratio back.
Ink is the branch ink at full strength: **6.35 / 5.53 against a node fill, already measured.**
RTL: `x = rtl ? width - PAD - fillW : PAD`. Any DIRECTIONAL arc you draw must flip its
`sweep-flag` under `rtl` — the θ → π − θ mirror turns clockwise into anticlockwise, so a fixed
flag makes an arc read as counting DOWN in Arabic.
Source: `useCaseProgress()` in `src/lib/mapNodes.ts` → `{done, total, linked, nodes}`.

**OPACITY IS NEVER A RESTING STATE.** `mindtree.css` measured it: edge ink at `opacity: .55`
falls 6.06/5.53 → 3.76/3.20, spending the entire light-theme headroom on decoration. Every
cross-fade must **resolve within 0.3 octaves** to fully opaque or fully absent. A mark in
motion is not a resting component under 1.4.11; a permanently half-faded one is.

**GRAIN and STATE are `pointer-events: none`, `aria-hidden`, and are NOT emitted into the
`role="tree"` DOM at all** — so the roving tabindex can never land on an aria-hidden mark, and
2.5.8 does not apply because they are not controls. They are reachable three other ways: zoom
to them, the table, or search.

**MATCH RIM.** A world containing filter matches, at OPENING or FRAME, carries a rim arc in
`--accent` over each matching child's wedge plus the match count at the rim block-start.
Mandatory — it is the answer to §9.

**Nothing this component draws may be computed here.** It renders once per node and there can be
hundreds; every string arrives resolved, every number arrives positioned. `band` and `bandOut`
arrive from the page's memo. The existing `memo()` is what makes a pure camera change re-render
**zero** nodes whose band did not shift — do not break its reference stability.

**Assertions.** `bandFor` is total and monotone in `apparentPx` · every band edge is a pure
function of the two arguments · adjacent bands render disjoint element-type sets · the CHIP
outside label's anchor is correct in all four (side × direction) cases · no `<text>` is on
screen while its layer's opacity is below 1 (state it as a rendering invariant and test the
`opening` band) · the progress fill's origin mirrors · `--track-c-*` is the only way a hue
enters.

---

### U3 — THE CAMERA

**Owns**
```
src/pages/map/useMapGeometry.ts
src/pages/map/mapMotion.ts
src/pages/map/mapMotion.test.ts
src/pages/map/useMapViewport.ts
src/lib/mindtree/altitude.ts        (DELETED)
src/lib/mindtree/altitude.test.ts   (DELETED)
```

**Exported signatures added to `mapMotion.ts`** (everything already there stays, unchanged)
```ts
export const FRAME_FILL_DESKTOP = 0.87
export const FRAME_FILL_PHONE = 1.25
/** How far past the deepest structural world's framing the reader may magnify. */
export const ZOOM_HEADROOM = 2.2
export const RUBBER_EXPONENT = 0.35
/** Raised from 420. A whole-workspace surface is a move, not a cut. */
export const FLY_MAX_MS = 1100

export interface Occlusion {
  readonly inlineEnd: number
  readonly blockEnd: number
}

export interface FrameOptions {
  readonly viewport: { readonly width: number; readonly height: number }
  readonly frameFill: number
  readonly occlusion: Occlusion
  readonly rtl: boolean
}

/** The camera that frames one world. Occlusion enters HERE AND NOWHERE ELSE. */
export function frameCamera(
  world: { readonly worldX: number; readonly worldY: number; readonly worldD: number },
  options: FrameOptions,
): Camera

/** Scale `camera` by `ratio` while holding `anchor` (drawing units) invariant. */
export function anchoredZoom(
  camera: Camera,
  anchor: { readonly x: number; readonly y: number },
  ratio: number,
): Camera

export interface CameraBounds {
  /** Widest view — the root world never falls below 0.4V. */
  readonly maxWidth: number
  /** Narrowest — D(deepest structural world on path) / ZOOM_HEADROOM. */
  readonly minWidth: number
}

export function clampCamera(camera: Camera, bounds: CameraBounds): Camera

/** Resistance past a bound. Returns the width to DRAW, not the width to store. */
export function rubberBand(width: number, limit: number, exponent?: number): number

/** Position on the dive rail, in octaves from the root world's framing. */
export function octavesOf(camera: Camera, rootD: number, viewportMinPx: number): number
```

**`useMapGeometry`** returns, replacing `zoom`/`pan`/`altitude`/`setAltitude`/`altitudeLabel`/
`zoomBy`/`resetView`:
```ts
  camera: Camera
  setCamera: (next: Camera) => void
  flyTo: (world: WorldNode) => void
  octaves: number
  octaveSpan: number
  onWheel: (event: WheelEvent) => void       // attached non-passive, see brief
  /** STILL RETURNED, NO LONGER RENDERED — the export caption prints it. */
  zoomPercent: number
```

**Brief.**
**One value of state: `camera = {cx, cy, width, height}` in drawing units.** `scale =
stageWidthPx / camera.width`. Plus a `tweenRef`. **`pan === null` is retired** — "stay fitted"
only existed because bounds moved, and they no longer do. So are `zoom`, `heldZoom`,
`zoomBounds`, `clampZoom`, `fit`, `ringsThatFit`'s call, the whole `depthLimit` memo, the
`sizeOfForLimit` factory, `ALTITUDE_DEPTH`, `altitudeForZoom`, `zoomForAltitude` and
`altitudeForRole`. Net: roughly 120 lines out, no new dependency.

**THE CYCLE IS BROKEN STRUCTURALLY, and it is your unit's job to keep it that way.** The trap is
`depthLimit → layout → bounds → fit.scale → zoomBounds → heldZoom → depthLimit`. In this design
that chain has no first link: **`depthLimit` is not a camera input and `bounds` is not a camera
output.** The camera reads `layout.bounds` **exactly once, in a `useState` initializer keyed on
`layout.revision`.** Never in a memo the camera consults each render. Write a test that asserts
the initializer runs once across ten renders that change only the camera.

**INITIAL CAMERA** frames `focusView.node` — `useMapFocus` already resolves `?focus=` and the
store with a deepest-surviving-ancestor fallback. Do not re-derive it.

**WHEEL.** Attach with `{passive: false}` on the canvas and `preventDefault()` — the stage does
not scroll and the canvas already carries `touch-action: none`. `w *= exp(deltaY × κ)`, κ set so
a 100px mouse notch is 1.15×. `deltaMode === DOM_DELTA_LINE` multiplies by 16 first.
**`ctrl+wheel` takes the same path at 3× κ** — that is how macOS reports a trackpad pinch, and
`preventDefault` is what stops it page-zooming the browser. Wheel is always zoom: this is a map,
not a document, and drag already pans. No accumulator, no throttle, no rAF batching.

**THE ANCHOR IS THE BUG FIX AND IT IS THE POINT OF THE UNIT.** All three current sites resolve
`pan === null` to the FIT CENTRE: `zoomBy` (:583), the pinch branch of `onPointerMove` (:705),
and `panBy` (:542). **Every pinch therefore slides the picture out from under the fingers.**
Replace with `anchoredZoom(camera, pointerInDrawingUnits, ratio)` at every site. Pinch anchors
on the **two-pointer midpoint**, and a two-finger drag of that midpoint pans in the same
gesture, so pinch-and-shove is one continuous move. This is what makes "the thing you zoom into
becomes the whole frame" true with no explicit target selection.

**FRAMING.** `frameCamera` puts the world's apparent diameter at `FRAME_FILL × V`, where `V` is
the smaller dimension of the **unoccluded** rectangle. `FRAME_FILL_PHONE = 1.25` deliberately
overflows a small screen so children land at CARD (~173px) rather than CHIP — **that constant is
the only phone/desktop difference in the entire camera.**
**Occlusion enters here and only here.** `MapPanel` and the phone sheet already report
`{inlineEnd, blockEnd}` from a ResizeObserver on their own roots (`MapPanel.tsx:239-268`) — take
it, do not re-measure. `useMapGeometry.ts:436-452`'s sign derivation is **correct** and its
comment must survive: raising `viewBoxMin` moves content toward the start/top, so in `ltr` a
panel at the inline end needs `shiftX > 0`; `rtl` is the one flip. **The RESTING camera is never
touched by occlusion** — opening a panel must not move the map.

**THE TERMINUS.** `minWidth = D(deepest structural world on the current path) / ZOOM_HEADROOM`.
Past it, `rubberBand` with exponent 0.35 and a spring back on release. That physical dead-stop is
the only "you have arrived" signal, and it costs no chrome. `maxWidth` keeps the root world above
0.4V so nobody gets lost in the void. Both derive from `layout.bounds`/`rootD` **once, at
mount**.

**THE FLY.** Keep `beginCameraTween` / `sampleCamera` / `retargetCameraTween` / `viewBoxOf`
byte for byte, including the property that the loop's final write is **byte-identical** to what
React would render, so there is nothing to correct (`mapMotion.ts:44-51`). Change one number:
`tweenDurationFor` becomes `140 + 300 × octaves`, capped at `FLY_MAX_MS = 1100`. **Interruption
semantics are already correct** — a second fly retargets from where the camera IS; a gesture
DROPS the tween where it stands. Do not add velocity carry: a spring has no end time and cannot
be made instant for a reader who asked for that, which is why `reducedMotion` is an ARGUMENT
here rather than a `matchMedia` read. Keep it that way.

**REDUCED MOTION.** Wheel and pinch stay continuous — direct manipulation is the reader's own
hand, not motion the app inflicted. Only programmatic moves become instant, which the existing
zero-length tween already delivers with no cooperation from the loop.

**`altitude.ts` is deleted, and its two real arguments are carried forward, not lost.** Its ×1.6
hysteresis existed to stop a STEPPED control rattling; there are no steps left to rattle. But its
**locale keys are NOT retired** — `ALTITUDE_KEY`'s four values move to U4 as rail tick labels,
and `mindtree.altitudeChanged` is repurposed verbatim. Coordinate the constant's new home with
U4; do not delete the strings.

**Assertions.** `frameCamera` is pure and total · `anchoredZoom` holds its anchor to within
1e-9 for any finite ratio · the composed `viewBox` is byte-identical across a tween's final frame
and the next render · `clampCamera` is idempotent · `rubberBand` is monotone and continuous at the
limit · **`layoutWorlds` is never called with a camera-derived argument** (assert by type and by a
render-count test) · occlusion changes `frameCamera`'s output and does NOT change the resting
camera · a wheel with `ctrl` calls `preventDefault`.

---

### U4 — THE CHROME AND THE CUT

**Owns**
```
src/components/map/MapDiveRail.tsx          (NEW)
src/components/map/MapDiveRail.test.tsx     (NEW)
src/components/map/MapAltitude.tsx          (DELETED)
src/components/map/map-altitude.css
src/components/map/MapToolbar.tsx
src/components/mindtree/Breadcrumb.tsx
src/components/mindtree/Breadcrumb.test.tsx
src/components/mindtree/breadcrumb.css
src/pages/map/useMapToolbar.ts
src/app-shell.css
```

**`MapDiveRail.tsx`**
```ts
export interface DiveRung {
  readonly id: string
  /** The world's own name, or its kind name from map_node_kinds — already
   *  resolved for the locale. Database text: isolate() it, never t() it. */
  readonly label: string
  /** Octaves from the root world's framing. Ticks are UNEVENLY spaced and that
   *  is a fact about the workspace, not a bug. */
  readonly octaves: number
}

export interface MapDiveRailProps {
  /** Current position, octaves. Continuous — not a rung index. */
  value: number
  max: number
  /** Rungs on the CURRENT PATH only. Length is the admin's depth, never four. */
  rungs: readonly DiveRung[]
  /** The world currently framed — becomes aria-valuetext. */
  worldLabel: string
  onChange: (octaves: number) => void
  /** Home / Escape. The rail's zero rung IS "fit to view". */
  onHome: () => void
  table: boolean
  onTable: (next: boolean) => void
  compact: boolean
}
export default function MapDiveRail(props: MapDiveRailProps): ReactElement
```

**Brief.**
**Cut 19 targets to 12.** Delete `MapAltitude.tsx` and the four altitude stop buttons, `Fit`
as its own control, `Expand all`, `Collapse all`, `Compact`, and the "show the panel" button.
Fold four group-by chips into ONE menu (`MapToolbar.tsx` already renders a `.malt-pop` menu at
`compact`; **make that path universal**). Fold `Mine` into Filter's first row. Keep, and do not
touch, the five lens chips, Meetings, Export, search, Filter, the group-by menu and the Table
toggle.

**Every cut names the mechanism that replaced it.** Zoom ±: the wheel and the pinch. The
readout: it answered "100% of what?". The four altitude stops: the owner's correction says the
number of levels is the depth of the tree the admin configures, so four frozen English words is
exactly the hard-coded ladder the brief forbids — **the four words survive as rail tick labels,
so nothing nameable is lost.** Expand/Collapse all: every child is already in the drawing,
waiting at its own distance; there is no fold to open. Compact: the LOD bands are absolute
pixels, so density is a camera position now.

**Three things survive as EXPORTS with callers, and deleting them is the failure mode to
avoid.** `useMapToolbar.expandAll` / `collapseAll` keep the node menu and the table stage as
callers. The density store value keeps the table's node box. `zoomPercent` keeps the export
caption, which prints the scale a **file** was taken at — a fact about a file, not a control on
a screen.

**The `GROUP BY` label deletion is a WIRING change, not a CSS one.** `id="mtree-groupby"` was
the chip row's `aria-labelledby`, and an `aria-labelledby` pointing at nothing contributes NO
name — it does not fall back. `MapToolbar.tsx:133` already takes `aria-label={t('mindtree.groupBy')}`
directly; keep that and do not retire the key.

**THE DIVE RAIL.** `<input type="range">`, `min=0`, `max=octaveSpan`, `step=0.02`, **with
`aria-valuetext` set to the WORLD IT FRAMES, not to a number.** One node in the accessibility
tree, natively keyboard-reachable (arrows step a tier, **Home frames the root**), continuous,
and it speaks a word. Dragging the thumb IS the continuous zoom for anyone who cannot wheel and
for a one-handed reader who finds a pinch awkward. Tick marks beside the track at each world
boundary on the current path, labelled with real department names from `map_node_kinds`
(bilingual data — which is precisely why the ladder can be the admin's depth).

Vertical 44×308 at the canvas inline-end, block-centred, on desktop. **Horizontal, 44px, full
width minus 16, immediately above the lens rail, on the phone** — a vertical rail at the inline
end collides with the thumb's arc and with the sheet's drag handle. `inset-inline-*` only.

`aria-pressed` toggles for Table, **never `role="radiogroup"`** — a radio group takes the arrow
keys away from everything inside it and the canvas's roving tabindex is one Tab stop away
(`MapAltitude.tsx:14-20`; keep the reasoning, drop the component).

Contrast, no new recipe: rungs `--field-border` on `--bg-elev-2` (**3.26 / 3.10**); thumb
`--accent` (**6.72 / 6.32** bare canvas, **3.29 / 3.74** worst over a hovered node fill — the
sheet's documented non-text floor). The plate is `.mpan`'s `--bg-elev` + `--border` hairline
verbatim, and **it must be opaque**: it floats over the drawing, so its backdrop is whatever
node is under it.

**THE BREADCRUMB becomes the primary orientation object and gains one behaviour.** It renders
`FocusView.trail`'s shape and computes nothing — root first, target LAST, inclusive, tail
unclickable with `aria-current="location"`. **Change: it truncates from the START**
(`…› Onboarding › Riyadh Cluster`), because with a camera that can be anywhere the near end is
what you need, and because the trail is no longer bounded at four hops. Its source becomes
`ancestorWorlds(layout, worldAt(camera)?.id)` rather than the drill-in — same shape, derived
from the camera, so it cannot drift. Keep the `icon-directional` separator: a text `›` does not
mirror. Each crumb is a 44px tap that flies to that world.

**`src/app-shell.css`: the full-bleed opt-in.** `.main-content { max-inline-size: 1180px }`
costs the map 188px of a 1600px screen that no rule in `mindtree.css` can reach (§0, and the
sheet's own handoff names it). Add a `data-fullbleed` opt-in that the map route sets, and while
you are there, promote `.main-content`'s three padding numbers to `--main-pad-*` tokens —
`mindtree.css:1266-1272` currently copies them by hand and states the drift hazard.

**Assertions.** Exactly 12 persistent targets render at 1600×900 (count them in a test) · every
target ≥ 44px in both directions · the rail's `aria-valuetext` is a WORD in both locales · the
rail has no `role="radiogroup"` · the breadcrumb truncates from the start · tab order matches
§7 · no retired locale key is deleted · both themes' contrast figures appended to the matrix.

---

### U5 — REACH: KEYBOARD, TABLE, PHONE, ARABIC

**Owns**
```
src/pages/map/useMapKeyboard.ts
src/pages/map/useMapCursor.ts
src/pages/map/useMapFocus.ts
src/components/map/MapCanvas.tsx
src/components/mindtree/MindtreeTable.tsx
src/components/mindtree/MindtreeTable.test.tsx
src/pages/map/mapZoomReach.test.tsx        (NEW — the whole-unit proof)
```

**Brief.**
Keep every contract the redesign is not allowed to spend.

**THE ROVING TABINDEX.** `order` becomes the CULLED, drawn list — nodes whose world intersects
the camera rect and whose apparent size clears `DOM_HORIZON_PX`. `order[at ± 1]` is unchanged.
`aria-posinset` / `aria-setsize` must still come from the MODEL (`node.parent.children.length`),
**never from the cull** — a culled sibling must not renumber the set, and that is the one way
the horizon could lie. Right/Left still swap under `rtl`. Space still grabs on an item and is
Enter's synonym on a branch. Escape is still a stack: cancel the lift → dismiss the card →
close the panel → surface one world.

**KEYBOARD IS A FIRST-CLASS DIVE, not an afterthought.**
- Arrows move focus; **the camera follows by the MINIMUM move** — `flyToCamera` already refuses
  to magnify, so a node that is already legible causes a pan at most, and often nothing.
- `Enter` on a department dives; `Enter` on an Organization opens the sidebar.
- `+` / `=` and `−` zoom by `ZOOM_STEP` (1.25) at the cursor. **Deleting the zoom buttons must
  not delete keyboard zoom** — this is where `ZOOM_STEP` survives, and it survives *because* a
  keyboard cannot be continuous.
- `Home` frames the root. `Escape` surfaces one world, after the panel if the panel is open.
- **If an arrow walks past the DOM horizon**, hold the target in a `pendingFocusId` ref, fly,
  and land focus on the node the next commit brings in — the same "the id is not drawn; open the
  way in first and ask again" contract `flyToNode`'s `null` return already documents
  (`mapMotion.ts:551-566`).

**THE ACCESSIBLE TABLE IS UNTOUCHED AND COSTS THIS REDESIGN NOTHING, and that is not a
coincidence — it is the mitigation.** `MindtreeTable` **reads the MODEL, not the geometry**, so
it stays the full-depth ledger at every camera position, at every band, on every device. It is
the low-motion, drag-free, screen-reader-first reading mode and the honest answer to a SET
question (§9). It keeps its `depthLimit`, its `expandedIds`, its density value and its path
column. **Verify by grep that it imports nothing from `worlds.ts`, `lod.ts` or the camera.**

**THE PHONE.** The `100dvh` grid and the z-71 pinned lens rail **already ship** — do not rebuild
them, and do not change `phoneDetentFor`, `MAP_DETENTS` or `DETENT_KEY`. The `needs-me` landing
detent stays `full`: `MAP-CONTRACT §1` prices it as a paid-for guarantee, and the original
failure was never the sheet's height, it was that there was no way back to the map. What changes
is that **`useMapGeometry.ts:360`'s `if (compact) return 1` is gone with the rest of the
`depthLimit` memo**, so the phone gets the full hierarchy with identical LOD thresholds. Keep
`mindtree.mobileHint` — a thumb has no cursor and the gesture is not otherwise discoverable.
Keep `.mtree`'s `padding-block-end` reservation for the two fixed rails: it is what makes the
canvas exactly the band the reader can see, and therefore what makes `useBoxSize` honest.

**ARABIC EQUALS ENGLISH, and prove it rather than asserting it.** There are no logical
properties inside `<svg>`. Assert: `layoutWorlds(tree, {direction:'rtl'})` is the exact
reflection of the `ltr` layout about the hub (byte equality on the root's x, per
`radial.ts:275-294`) · every outside label's anchor is right in all four side × direction cases ·
the progress fill's origin mirrors · any directional arc's `sweep-flag` flips · `text-anchor`
stays constant while `direction` is stated on the `<g>`.

**WCAG 1.4.10.** Test at **320×256 explicitly** — both media guards fail there, `.mtree` returns
to a document-flow column, and the islands become ordinary blocks. "It falls back" is what
everyone says about the path nobody exercises.

**Live proof, in a real browser, at 1600×900 and 375×812, in both languages**, driving a real
department tree: dive three worlds and surface, and assert the return framing is the departure
framing to the unit · a pinch holds the point under the fingers · opening the panel does not move
the map · a filtered map shows vacant seats, not closed gaps · tapping an Org opens the sidebar
and the camera does not move · the terminus rubber-bands and springs back.

**Assertions.** Every one of the above · `useMapFocus`'s three-writer convergence still holds
(the inbound URL effect on `[params]`, the reconciler gated on `missingId !== null &&
entriesLoaded`, and user gestures) · the live region fires once per world crossing, debounced
400ms, and says a NAME rather than a percentage.

---

## 12. INTEGRATOR FILES — shared, and no unit edits them

```
src/pages/Mindtree.tsx              the shell: it states the order things are called in
src/pages/mindtree.css              the sheet: three layouts, the island layer, the matrix
src/locales/en/mindtree.json        \  a locale change is a THREE-FILE change;
src/locales/ar/mindtree.json         > exact en/ar parity; every string through t();
src/lib/labelSections.ts            /  key tables stay LITERAL for localeReach.test.ts
docs/MAP-CONTRACT.md                amended by §0 and §6 of this file
docs/MAP-ZOOM.md                    this file
```

The integrator wires `layoutWorlds` (U1) → `bandBlend` (U2) → `camera` (U3) → the rail and the
breadcrumb (U4), threads occlusion from `MapPanel` to `frameCamera`, and lands every locale key
in all three files at once.
