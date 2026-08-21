# MAP-REDESIGN — the build contract

Branch `feat/map-hierarchy`, HEAD `84e64a1`. Implements plan Part 3 (`sparkling-wibbling-umbrella.md`)
together with the composition and phone work the owner's verdict — *"the mindmap look and experience
is terrible, rebuild with way better potential"* — actually asks for.

Baseline that must not regress: `npx tsc -b` clean (**not `--noEmit`** — the root tsconfig is
solution-style and `--noEmit` checks zero files and exits 0), `oxlint` 0 errors, **3,810 tests pass**,
`npm run build` succeeds. No live data touched, no migration run.

---

## 0. The ruling

**Spine: `canvas-first`.** It is the only direction that makes the map become the screen at *both*
widths with a stated mechanism (fixed stage · four floating islands · an occlusion-aware fit), and
its radial arithmetic is the only one that is right: the plan's closed-form radius
`r_d = max(r_{d−1} + pitch, Σ(diag+gap)/sweep)` is an **arc-length** bound, and two boxes are
separated by their **chord**. Three programmes on a ring gives Δθ = 120°, chord = 1.73r against arc
2.09r — the boxes overlap at the *common* fan-out. That correction is load-bearing and is written
into U1's brief.

**Grafted from `one-question`:**

- **Visual tiering.** The current lens chip is the only filled, badged thing on screen; the other
  four are borderless text at `--text-dim`. This — not the control count — is the answer to "every
  control is the same size, weight and colour, so nothing leads the eye."
- **Ring 1 starts at θ = 0 (3 o'clock).** The mirror maps θ → π − θ, so Arabic gets 9 o'clock: the
  reading edge in *both* scripts. Starting at 12 o'clock mirrors to 12 o'clock and is the wrong
  answer dressed as symmetry.
- **Node inline size is a function of ring** (its departure D3). Ring 1 = 168, ring 2 = 132,
  ring 3+ = 108. Without it, ring 2 on a 1600×900 desktop fits at 0.44 — below the
  `MIN_TARGET_PX / height` = 0.545 floor — on a *small* workspace, on a *big* monitor.
- **The hub is a pill** (`rx = height/2` at depth 0). One attribute, no new element, no export change.
- **One empty state, not two.** When `noTracks`, the panel does not render at all.

**Grafted from `phone-truth`:**

- **The phone grid.** Below 768px `.mtree` becomes `block-size: 100dvh; display: grid;
  grid-template-rows: auto 1fr auto`. The canvas is the `1fr` and is therefore the largest region on
  the screen *by construction*, not by a `clamp()` that a scroll position can defeat.
- **The occluder must be measured and subtracted from the fit.** Otherwise the ring centres in the
  *element* and half of it sits behind the sheet — the same class of bug being fixed, arrived at from
  the other side. Unified with canvas-first's `occludeInline` into one measured `{inlineEnd, blockEnd}`.
- **The panel's seven phone rows become two.** Detent buttons → the grabber (which already cycles on
  click and steps on ArrowUp/ArrowDown, so the keyboard path survives). "0 items need attention" →
  folded into the title. Refresh → error state only.

**What the critique kills:**

1. **`one-question`'s `Rings: Status ▾`** — collapsing the four group-by chips into one menu. Its own
   weakest-point section demolishes it: `dropRules.ts` writes a *different patch per dimension*, so
   the chip row is the map's mode selector **for editing**, and mode selectors are the last thing you
   bury. A comparison sweep goes 3 taps → 6. The four chips stay visible on the desktop canvas; on a
   phone they collapse, because 375px has no room and the drag is not a phone gesture anyway.
2. **`phone-truth`'s D3** (landing detent `peek` instead of `full` for `needs-me`). MAP-CONTRACT §1
   prices `full` as a paid-for guarantee. The failure was never the sheet's *height* — it was that at
   `full` there was **no way back to the map**. The pinned lens rail at z-71 supplies one, in one tap,
   under the thumb. `phoneDetentFor` is not touched.
3. **`one-question`'s D5** (`full` becomes a normal-flow stage takeover). Unnecessary once the rail is
   pinned, and it is a second phone layout to maintain.
4. **`canvas-first`'s progress arc.** It admits it is a third mark against a stated budget of
   "size-for-count plus a breach mark", and it renders a payload — use-case status — that **has not
   been entered yet** (plan risk 5). A new visual channel for absent data is the worst trade on the
   table.
5. **Altitude re-rooting** (`canvas-first`'s `drawnRoot` per stop, `one-question`'s D1 at `Work`).
   Both couple `altitude.ts` to `useMapFocus` and the URL — the single riskiest coupling proposed.
   Instead: altitude drives `depthLimit` **only** (the plan's own rule), and the limit is clamped by
   a *measured* `ringsThatFit()` predicate. At `Work` with nothing focused, the unfittable ring is
   simply not drawn and its parent reports `hasHiddenChildren` — the existing, tested affordance.
6. **Moving the summary sentences into the panel.** They become the block-end caption instead. The
   panel version needs `MapList` surgery that buys nothing the caption does not.
7. **Retiring locale keys.** An orphan key is harmless — still parity-tested, still renameable in
   Terminology. Deleting one is a three-file change with `localeReach.test.ts` and `labelSections.ts`
   in the loop, across four units, for zero user-visible gain. **Nothing is retired.** One value
   correction only: `mindtree.emptyTracksHint` (the screen is Settings › Structure now).

### The control budget, stated honestly

The measured complaint is **three stacked rows and ~20 controls consuming 46% of a 900px viewport
before a single node is drawn**, and **seven rows of chrome over zero pixels of map on a phone**.

| | today | after |
|---|---|---|
| desktop rows of chrome above the canvas | **3** | **0** |
| desktop canvas | ~1136×414 = 0.47M px², starts 54% down | 1600×835 = 1.34M px², starts 7% down (**2.8×**) |
| desktop targets | ~20 | **21**, floating, covering ~10% of the stage |
| controls deleted outright | — | **12** |
| phone rows of chrome | **7**, and the lens chips do not render at all | **2** fixed rails, 48px each |
| phone map | **0 px** | 359 × ~391 unoccluded = **48% of the viewport** |

The count barely moves and that is the correct outcome: the defect was never arithmetic, it was that
every control was the same weight and none of them was on the picture. What moves is the **pixels**
(2.8× on desktop, 0 → 48% on phone), the **rows** (3 → 0), and the **tiering** (one filled chip in a
row of four ghosts).

**Deleted outright:** Expand all · Collapse all · Compact · Zoom − · "Zoom 100%" · Zoom + ·
the standalone "0 open" chip · the `LOOKING AT` label · the `GROUP BY` label · `<h1>Mindtree</h1>` ·
the subtitle · the desktop pan hint · the three phone detent buttons · "Hide the panel" (→ one ✕) ·
the unconditional Refresh.

**Moved:** Fit to view → the altitude ladder's foot · Map|Table → one `Table` toggle at the ladder's
foot · Digest → inside the export menu · the group-by chips → onto the canvas · the summary sentences
→ the block-end caption · `Mine` → the top-start rail as the **single** owner (today it exists only
when the panel is open; `MapList` stops rendering its own segment so there is one control for one fact).

**Survives untouched:** the `role="tree"` contract · roving tabindex · `aria-level/posinset/setsize` ·
the `aria-describedby` hint node (the `<svg>` points at it) · the drag layer · the node menu ·
QuickAdd · MapCapture · the accessible table · the two Escape orderings in `MapPanel.tsx`'s header ·
`phoneDetentFor` · Meetings at 1 tap · the five lens chips, never behind a disclosure.

### The composition

```
1600×900 · LTR (RTL is the same description with inline-start/inline-end exchanged)
┌──────────────────────────────────────────────────────────────────────────┐ 65  app header (Shell's)
├──────────────────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────┐            ┌───────────────────────────────┐ │
│ │ 🔍 search · Mine · Filter(2) │        │ ▮Needs me 12  Shape  Status … │ │  islands, 12px inset, 44px
│ └─────────────────────────┘            │  🎙 Meetings   ⧉              │ │
│ ┌──────────────────────┐               └───────────────────────────────┘ │
│ │Status Owner Prio Health│                                     ┌────────┐│
│ └──────────────────────┘         ◜         ◝                   │ PANEL  ││  416px floating card,
│                            ◜   ┌───────┐     ◝      ┌──┐       │ 26% of ││  a SIBLING of the canvas
│                                │  UHR  │            │Po│       │ stage  ││
│                            ◟   └───────┘     ◞      │Pr│       │        ││  ladder: inline-end of the
│                                  ◟     ◞            │De│       └────────┘│  CANVAS, not the stage,
│                                                     │Wo│                 │  so it never fights the panel
│  ▪ size = open items  ● past deadline  ◷ direction  │⌾ │                 │
│  means nothing   ·  9 tracks · 31 open  │▤│         └──┘                 │
│                             ┌──────────────────────┐                     │
└─────────────────────────────┤ + capture…           ├─────────────────────┘  composer, block-end centred
                              └──────────────────────┘
```

```
375×812 · needs-me · cold
┌───────────────────────────────┐ 65  app header
├───────────────────────────────┤
│ 🔍 │ Mine │ Filter(2) │ ◷ Del │ 48  top rail, fixed, z 71
├───────────────────────────────┤
│          ⌾ UHR                │
│      ⬤    ⬤    ⬤    ⬤        │ 391 THE MAP — 48% of the viewport.
│    Infra Net   IT   SRE       │     Outer ring = 44×44 count chips,
│                               │     labels OUTSIDE, radially placed
├━━━━━━━━━━ ▬▬▬ ━━━━━━━━━━━━━━━┤
│ ▓▓▓ THE SHEET (peek/half/full)│     z 70 — BELOW the lens rail
├───────────────────────────────┤
│ ‹ ▮Needs me 12 · Shape · … 🎙⧉│ 48  ★ LENS RAIL, fixed, z 71, ALWAYS
├───────────────────────────────┤
│ + capture…                    │ 64  composer, fixed, z 71
└───────────────────────────────┘
```

**The exact mechanism of today's phone failure, because the fix follows from it.**
`DEFAULT_LENS = 'needs-me'` → `phoneDetentFor({kind:'needsMe'}) = 'full'` → the sheet is
`position: fixed`, z-70, capped by `--map-shell-chrome-block-size` = header + 64px. That reservation
is supposed to leave "one lens row of live page" — but `.mtree-shellbar` is the **third block** in
`.mtree`'s flow (the `<h1>` and the `FilterBar` come first), so at scroll-top the reserved strip
shows the *FilterBar*. `mindtree.css:210-216` says this against itself: *"It does NOT put the lens
chips in that window on its own."* The chips render; they are ~380px below the fold under a fixed
sheet. **Fix: the lens rail moves out of document flow to `position: fixed`, z-index 71 — one above
the sheet — in the thumb zone.** One `MapLensBar`, one `role="group"`, one accessible name, one set
of pressed states: *moved*, not duplicated. `--map-shell-chrome-block-size` then collapses to
`header + 8px`, because it no longer has to reserve a strip of page in the hope the chips are
scrolled into it.

---

## 1. Work units

Every file below belongs to **exactly one** unit. Units compile against each other's declared
signatures before those files exist, so every signature here is exact and normative.

| unit | owns | delivers |
|---|---|---|
| **U1 RADIAL** | `src/lib/mindtree/radial.ts` (new) · `radial.test.ts` (new) · `layout.ts` · `layout.test.ts` | the polar layout, the shared `build()`, `outward`, `rings`, `ringsThatFit` |
| **U2 ALTITUDE** | `src/lib/mindtree/altitude.ts` (new) · `altitude.test.ts` (new) · `src/pages/map/useMapGeometry.ts` | the one call-site flip, the occlusion-aware fit, named zoom stops |
| **U3 NODE** | `src/components/mindtree/MindNode.tsx` · `src/components/map/MapCanvas.tsx` · `src/components/mindtree/mind-ring.css` (new, `.mring-*`) | outward chevron, outside labels, hub pill, ring guides |
| **U4 CHROME** | `src/components/map/MapLensBar.tsx` · `map-lens.css` · `MapToolbar.tsx` · `MapModeBar.tsx` · `map-mode.css` · `MapAltitude.tsx` (new) · `map-altitude.css` (new, `.malt-*`) | the tiering, the ladder, the export re-home |
| **U5 PANEL** | `src/components/map/MapPanel.tsx` · `map-panel.css` · `MapSummary.tsx` · `MapList.tsx` · `MapList.test.tsx` | the floating card, the measured occlusion, two phone rows |
| **U6 SHELL** | `src/pages/Mindtree.tsx` · `src/pages/mindtree.css` · `src/pages/map/useMapToolbar.ts` | the stage, the four islands, the phone grid, the wiring |

**Integrator files** (nobody edits them; each unit reports its lines and the integrator applies them):
`src/locales/en/mindtree.json` · `src/locales/ar/mindtree.json` · `src/lib/labelSections.ts` ·
`docs/EXECUTION-PLAN.md` §1.0.7 · `docs/MAP-CONTRACT.md` · `docs/MAP-REDESIGN.md`.

---

## U1 — RADIAL

**Owns:** `src/lib/mindtree/radial.ts` (new) · `src/lib/mindtree/radial.test.ts` (new) ·
`src/lib/mindtree/layout.ts` · `src/lib/mindtree/layout.test.ts`.

### Edits to `layout.ts` (all additive; the linear layout's output must stay **byte-identical**)

```ts
/** The chevron anchor: a point on the ray from the hub, 9 units beyond the node's
 *  own edge, expressed RELATIVE to the node's top / inline-start corner and in the
 *  SAME (already-mirrored) space as `x`/`y`. Populated ONLY by radial.ts; the linear
 *  layout leaves it undefined, so every existing deep-equality assertion in
 *  layout.test.ts is unaffected. */
readonly outward?: Point            // added to PositionedNode

/** Ring radii by depth, hub-relative. Undefined from the linear layout. */
readonly rings?: readonly number[]  // added to MindtreeLayout
/** The hub's centre in drawing coordinates, after the mirror. Undefined from linear. */
readonly hub?: Point                // added to MindtreeLayout

/** The mutable twin, exported so radial.ts shares the ARIA/pre-order walk verbatim. */
export interface LayoutWorkNode<N extends LayoutInputNode = LayoutInputNode> {
  source: N; id: string; depth: number; width: number; height: number
  parent: LayoutWorkNode<N> | null; children: LayoutWorkNode<N>[]
  index: number; hiddenChildCount: number
  localY: number; shift: number; frame: number; x: number; y: number
}

/** BUILD, extracted verbatim from the private `build()` and re-exported. Pre-order,
 *  the depth-limit and collapsed rules, the cycle/duplicate guard, `hiddenChildCount`. */
export function buildLayoutNodes<N extends LayoutInputNode>(
  root: N,
  opts: ResolvedLayoutOptions,
  sizeOf?: (node: N, depth: number) => Partial<NodeSize> | undefined,
): LayoutWorkNode<N>[]

/** The private `resolveOptions`, re-exported. */
export function resolveLayoutOptions<N extends LayoutInputNode>(
  options: LayoutOptions<N>,
): ResolvedLayoutOptions
```

`layoutMindtree()` must be refactored to *call* `buildLayoutNodes` and `resolveLayoutOptions`, not to
duplicate them. Adding an optional field to a `readonly` interface changes no existing behaviour; the
first test written is that `layoutMindtree` on today's fixtures returns exactly today's output.

### `radial.ts` — exact exports

```ts
import type {
  Bounds, Direction, Gap, LayoutInputNode, LayoutOptions, MindtreeLayout,
  NodeSize, Point, Viewport,
} from './layout'

export interface RadialOptions<N extends LayoutInputNode = LayoutInputNode>
  extends LayoutOptions<N> {
  /** Radians the root's children may occupy. Default 2π. */
  sweep?: number
  /** Bearing of the first child, radians. 0 = 3 o'clock, clockwise positive.
   *  DEFAULT 0 — the mirror maps θ → π − θ, so Arabic reads from 9 o'clock:
   *  the reading edge in both scripts. */
  startAngle?: number
}

/** THE ENTRY POINT. Returns the identical `MindtreeLayout` type, pre-order preserved,
 *  every ARIA field produced by the SAME `buildLayoutNodes` call the linear path uses. */
export function layoutMindtreeRadial<N extends LayoutInputNode>(
  root: N,
  options?: RadialOptions<N>,
): MindtreeLayout<N>

/** Ring 1 = base · ring 2 = 132 wide · ring 3+ = 108 wide. Block size NEVER shrinks
 *  below 44 (that is the WCAG 2.5.8 floor the fit's own minScale is derived from).
 *  When `compact`, the OUTERMOST drawn ring is a 44×44 count chip — its label is
 *  drawn outside the box by the renderer, which is what keeps the words on a phone. */
export function ringNodeSize(
  depth: number,
  options: { base: NodeSize; outermostDepth: number; compact: boolean },
): NodeSize

/** The largest depth limit in [1, maxDepth] whose bounds still fit `viewport` at
 *  `minScale` or better. Walks upward and stops at the first failure, so a workspace
 *  with three fat programmes and one with forty thin ones both get a legible picture.
 *  This is the mechanism the depth cap actually is — see §"the ceiling" below. */
export function ringsThatFit(options: {
  boundsAt: (depthLimit: number) => Bounds
  viewport: Viewport
  padding: number
  minScale: number
  maxDepth: number
}): number
```

### The geometry, precisely

**Angle is allocated by subtree slot count, not equally.** Each node's children partition their
parent's wedge in proportion to the number of leaf slots the subtree needs at the deepest drawn ring
— the polar translation of the contour packing `pack()` already does along y. It is a *packing*
requirement, not a second encoding, so it does not collide with `sizeForCount`.
Assertions: `Σ child wedges === parent wedge` exactly, and `wedge(n) ∝ slots(n)`.

**Radius is demand-driven, and the plan's closed form is corrected for chord vs arc:**

```
r_d = max(
        r_{d−1} + pitch(d),
        max over adjacent pairs (i,j) on ring d of
            (diag_i/2 + diag_j/2 + gap.sibling) / (2 · sin(Δθ_ij / 2))
      )
```

- With a single child on a ring there is no adjacent pair; use `r_{d−1} + pitch(d)`.
- Guard `sin(Δθ/2) → 0`: when `Δθ < 1e-6`, fall back to the arc bound `Σ(diag+gap)/sweep`.
- When `Δθ ≥ π` the chord bound is slack and the arc bound is the binding one; take the max of both,
  which the formula above already does via the `r_{d−1} + pitch` term plus an explicit arc term.

**Pitch is a support function, not a height.** A rect at 3 o'clock extends along the radius by `w/2`,
not `h/2`. Use the conservative constant-per-ring form `pitch(d) = diag_d/2 + diag_{d+1}/2 +
gap.depth`, which preserves the invariant the column layout gave free: **no AABB overlap across
depths**, assertable as a plain statement in `radial.test.ts`.

**Edges leave and arrive radially.** `c1 = start + t·û(θ_parent)`, `c2 = end − t·û(θ_child)`,
`t = 0.5·(r_child − r_parent)` — which preserves `EDGE_CURVE = 0.5`'s meaning (both ends square-on to
the box edge) and keeps `edgePath()` untouched, so the screen, the exported SVG and the PNG raster
all come from identical numbers.

**`bounds` must union the four bézier control points.** Unlike a horizontal S-curve, a radial cubic
between two boxes on adjacent rings genuinely leaves the union of its endpoint rects. Get this wrong
and `fitToViewBox` clips edges at the drawing's own margin.

**Then pad `bounds` symmetrically about the HUB before returning.** `flipRect` reflects about the
*bounds'* centre line, and a circular drawing's bounding box is not centred on the root — different
rings carry different box widths, so the root drifts a few units off-centre and the mirror stops
being an exact equality. After padding, `root.x` is byte-identical in `ltr` and `rtl` and the
existing mirror-symmetry test generalises unchanged. **This is the single most important line in the
whole unit for the Arabic guarantee.**

**`outward`.** For a node at bearing θ with half-extents `(hw, hh)` about its centre, the edge point
along the ray is `c + t·(cosθ, sinθ)` where `t = min(hw/|cosθ|, hh/|sinθ|)` (each term dropped when
its denominator is < 1e-9). The chevron anchor is 9 units further along θ. Emit it **relative to the
node's top/inline-start corner**, and mirror the local x as `width − x_local` inside `radial.ts` when
`direction === 'rtl'`, so the renderer does no direction arithmetic at all.

### The ceiling — where I depart from Part 3, and why

Part 3's altitude table lists 2/3/4/5 rings drawn. Computed against `useMapGeometry`'s real constants
on a 1576px usable stage, comfortable node 168×44 (diag 174), `gap.sibling` 12:

| ring | nodes | r | drawing width | scale | node on screen |
|---|---|---|---|---|---|
| 1 | 9 tracks | 266 | 700 | 1.0 | 44px |
| 2 | 45 buckets @132 wide | 577 | 1286 | **0.55** | 24.2px — on the floor |
| 3 | 180 orgs | 5330 | 10,800 | 0.146 | **6.4px — dead** |

So the desktop budget is **root + two rings at typical fan-out**, and a fourth ring only when it
carries ≲60 nodes. That is Part 3's own "radial area grows quadratically" followed to its conclusion:
the depth cap is not merely mandatory, **it is the whole mechanism**. Hence `ringsThatFit()` — a
measured predicate, not a fixed table. The numbers above are a worked example, not a law: if the real
tree is narrow and deep (three programmes, four phases, six orgs) ring 3 is 72 nodes and fits.

### Tests U1 owns (`radial.test.ts`)

Purity/determinism · `Σ child wedges === parent wedge` · `wedge ∝ slots` · **no AABB overlap within a
ring** · **no AABB overlap across depths** · bounds contain every control point · bounds symmetric
about the hub · **mirror equality**: `radial(root, {direction:'rtl'})` is the exact reflection of
`ltr` and `root.x` is identical in both · pre-order matches `layoutMindtree`'s pre-order for the same
tree and depth limit (the ARIA contract cannot diverge by shape) · 200 children on one ring stays
finite and non-overlapping · every returned number finite for NaN/zero/negative sizes · `outward` is
`undefined` from `layoutMindtree` and defined for every non-root node from `layoutMindtreeRadial` ·
`ringsThatFit` returns 1 for an unfittable ring 2 and never exceeds `maxDepth`.

### Constraints

TypeScript strict. **No new runtime dependency** — no d3, no polar helper library; `Math` only.
No React, no store, no i18n, no DOM import (the layering rule `layout.ts`'s header states).
`sizeOf` must stay pure.

---

## U2 — ALTITUDE AND THE FIT

**Owns:** `src/lib/mindtree/altitude.ts` (new) · `src/lib/mindtree/altitude.test.ts` (new) ·
`src/pages/map/useMapGeometry.ts`.

### `altitude.ts` — exact exports

```ts
export type Altitude = 'portfolio' | 'programme' | 'delivery' | 'work'

export const ALTITUDES: readonly Altitude[]                       // portfolio → work
export const ALTITUDE_DEPTH: Readonly<Record<Altitude, number>>   // 1, 2, 3, 4
/** Literal key table — localeReach.test.ts must see every key as a string. */
export const ALTITUDE_KEY: Readonly<Record<Altitude, string>>     // 'mindtree.altitudePortfolio' …

export function isAltitude(v: unknown): v is Altitude

/** The zoom multiplier at which each stop sits. 1.0 / 1.6 / 2.56 / 4.1 — each ×1.6,
 *  which is WIDER than one ZOOM_STEP (1.25), so a press and its inverse are a no-op. */
export function zoomForAltitude(stop: Altitude): number

/** WITH HYSTERESIS, and driven by the RAW `zoom` state — never `heldZoom`, which is
 *  clamped against layout-derived bounds and would close the loop
 *  depthLimit → layout → bounds → fit.scale → heldZoom. Rises to the next stop at
 *  `zoomForAltitude(next)`; falls back only at `zoomForAltitude(current) / 1.6`. */
export function altitudeForZoom(zoom: number, current: Altitude): Altitude

/** Role sets the STARTING stop and never gates anything. admin → 'portfolio',
 *  everyone else → 'work'. Nothing about altitude is persisted to the URL. */
export function altitudeForRole(role: string | null | undefined): Altitude
```

### `useMapGeometry.ts` — the one call-site flip

`useMapGeometry.ts:203` is the single call site. It becomes:

```ts
const layout = useMemo(
  () => layoutMindtreeRadial(drawnRoot, {
    nodeSize, gap, sizeOf, depthLimit, direction: rtl ? 'rtl' : 'ltr',
    startAngle: 0,
  }),
  [drawnRoot, nodeSize, gap, sizeOf, depthLimit, rtl],
)
```

**This flip is the thesis test.** If anything downstream needs editing beyond the three edits U3 is
already scheduled for (`outward`, the hub pill, the outside label), **stop and re-plan** — that is
plan risk 4 firing.

`sizeOf` gains the ring rule: for `depth >= 1`, its `min` becomes
`ringNodeSize(depth, { base: nodeSize, outermostDepth: depthLimit, compact })` rather than `nodeSize`.
The `depth === 0` guard and the `entry`/`more` widening stay exactly as they are.

`depthLimit` becomes:

```ts
const capped = compact ? 1 : ALTITUDE_DEPTH[altitude]
const depthLimit = compact ? 1 : ringsThatFit({
  boundsAt: (limit) => layoutMindtreeRadial(drawnRoot, { …, depthLimit: limit }).bounds,
  viewport: { width: box.width - occludeInline, height: box.height - occludeBlockEnd },
  padding: 28, minScale, maxDepth: capped,
})
```

Memoise it on `[drawnRoot, nodeSize, gap, sizeOf, altitude, box, minScale, rtl]`. It costs at most
`capped` extra layouts and short-circuits at the first failure.

**The phone's `depthLimit: 1` is re-measured for the radial and it holds — but only with the count
chip.** Nine tracks at `COMPACT_NODE` 132×44 (diag 139, gap 10) gives r = 9·149/2π = 213 and a
558-unit drawing into 359px = **scale 0.64**, putting the 12.5px label at 8.0px: exactly the "cramped
and unusable" outcome the existing comment says `depthLimit: 1` was chosen to avoid. A narrower sweep
does **not** help — inline extent `2(r·sin(S/2) + halfbox)` *grows* as S shrinks (S=π → 986 units,
S=2rad → 1259, vs 558 for full 2π), so the full circle is the inline-optimal sweep and the phone's
problem is `n`, not the shape. With `ringNodeSize` returning 44×44 on the outermost compact ring,
diag falls to 62, r = 103, and with ~85 units of radial label room the drawing is 420 units →
**scale 0.85 → a 10.6px label**, above the phone's own 0.62 floor with headroom.

### The occlusion — new options, and the sign that must be mirrored explicitly

```ts
export interface MapGeometryOptions {
  drawnRoot: MindNodeModel
  compact: boolean
  density: 'compact' | 'comfortable'
  rtl: boolean
  svgRef: RefObject<SVGSVGElement | null>
  setLive: (text: string) => void
  isPressing: () => boolean
  /** CSS px of the stage the floating panel covers at the inline END. 0 when closed
   *  or on a phone. MEASURED by MapPanel (U5) and threaded by the shell (U6). */
  occludeInline: number
  /** CSS px the phone sheet covers at the block END. 0 on desktop or when closed. */
  occludeBlockEnd: number
  /** The reader's altitude stop. Role sets the initial one. */
  altitude: Altitude
  onAltitude: (next: Altitude) => void
}
```

The fit must know it is occluded, or the panel covers the busiest branch on every open:

```ts
const fitViewport = {
  width:  Math.max(1, box.width  - occludeInline),
  height: Math.max(1, box.height - occludeBlockEnd),
}
const fit = fitToViewBox(layout.bounds, fitViewport, { padding: 28, maxScale: 1, minScale })
// Then re-centre into the UNOCCLUDED half. THIS IS THE ONLY PLACE OUTSIDE layout.ts
// WHERE DIRECTION IS READ, and it must be mirrored explicitly, because SVG
// coordinates are never mirrored by `dir` — this file's own pan handler says so.
const shiftX = (rtl ? +1 : -1) * (occludeInline / 2) / fit.scale
const shiftY = -(occludeBlockEnd / 2) / fit.scale
```

Apply `shiftX`/`shiftY` to `fit.x`/`fit.y` before deriving `centerX`/`centerY`, and to `resetView`.
**No loop:** occlusion moves `fit` only, never `layout.bounds`; and `useBoxSize` measures the canvas,
which is `inset: 0` and does not resize when the panel opens over it.

`wholeMapFit` (the export's frame) must **not** subtract occlusion — a file does not get covered.

### The announcement

`zoomTick`'s effect stops announcing a percentage and announces the **named stop** —
`t('mindtree.altitudeChanged', { label: t(ALTITUDE_KEY[altitude]) })` — because a named stop is the
entire point of the plan's *"the altitude control IS the zoom"*. `zoomPercent` stays in the return
value (the export caption reads it); it simply stops being rendered as a control.

### Return value additions

```ts
return { …everything today, altitude, setAltitude, altitudeLabel }
//                              ^ derived through altitudeForZoom(zoom, altitude) so
//                                wheel and pinch move the stop; setAltitude writes
//                                BOTH the stop and zoom = zoomForAltitude(next).
```

### Tests U2 owns (`altitude.test.ts`)

`altitudeForZoom` hysteresis: from `programme`, one `ZOOM_STEP` up then down returns to `programme`
(a press and its inverse are a no-op) · monotone in zoom · total over the union · `zoomForAltitude`
round-trips · `altitudeForRole` for admin/member/null · `ALTITUDE_KEY` values are literal strings
(`localeReach` scans for them).

### Constraints

TypeScript strict. `altitude.ts` is pure — no React, no store, no DOM. Altitude drives `depthLimit`
**only**, never `openDepth` and never `expandedIds`; nothing about it goes in the URL.

---

## U3 — THE NODE AND THE CANVAS

**Owns:** `src/components/mindtree/MindNode.tsx` · `src/components/map/MapCanvas.tsx` ·
`src/components/mindtree/mind-ring.css` (new, owns **`.mring-*`** — report this line to the
integrator for `docs/EXECUTION-PLAN.md` §1.0.7).

### Three edits to `MindNode.tsx`, and no more

1. **The chevron points outward.** `MindNode.tsx:268` currently hard-codes
   `chevronX = rtl ? -9 : pos.width + 9` — the inline-end edge. On a radial map a node at 9 o'clock
   has its children to its *left*. Replace with:

   ```ts
   const chevron = pos.outward ?? { x: rtl ? -9 : pos.width + 9, y: pos.height / 2 }
   ```

   `pos.outward` (U1) is **already mirrored** and already relative to the node's corner, so no
   direction arithmetic is added here. The linear layout emits `undefined`, so the fallback is
   today's expression byte for byte.

2. **The hub is a pill.** `rx={pos.depth === 0 ? pos.height / 2 : 10}` on `.mtree-node-box`. One
   attribute. It reads as the origin rather than as first-among-equals, and
   `useMapGeometry.ts:184` already excludes depth 0 from `sizeForCount`, so nothing in the encoding
   shifts. No new element, no export change, no hit-test change.

3. **The label goes outside a small node.** Derived from geometry alone, so no prop and no plumbing
   crosses a unit boundary:

   ```ts
   const LABEL_INSIDE_MIN = 96
   const labelOutside = pos.width < LABEL_INSIDE_MIN
   ```

   When `labelOutside`: the count is centred inside (`textAnchor="middle"`, x = `pos.width / 2`) and
   the label `<text>` is placed at the outward point, offset 8 units along the ray, with
   `textAnchor` = `start` in LTR and `end` in RTL **from the mirrored `outward.x`** — i.e.
   `outward.x > pos.width / 2 ? 'start' : 'end'`, which is a geometric test, not a direction test,
   and is therefore correct in both scripts without a second branch.
   `truncate()` and the `CHAR_PX` budget apply to the outside label with a budget of 14 glyphs.
   **`view.name` (the accessible name) is untouched** — it was never the drawn label.

   This is what keeps the words on a 375px phone. A ring of numbered dots with no names is not a
   mind map; it is the failure mode `phone-truth` names against itself.

Everything else in `MindNode` is unchanged, and that is the payoff of refusing sunburst arcs: the
`CHAR_PX` glyph budget, `<rect>` hit-testing, `markX`/`tickX` (still correct, because boxes never
rotate), `DragLayer`'s pointer→layout conversion, `PulseLayer`'s rings, the free CSS `translate`
tween and `export.ts`'s id-stripping serialiser all keep working.

### `MapCanvas.tsx` — the ring guides

Inside the existing `aria-hidden` edge group, before the edges, render one `<circle>` per drawn depth
from `layout.rings` centred on `layout.hub`, `fill="none"`, class `.mring-guide`, `data-depth`.
Render nothing when `layout.rings` is undefined (the linear path).

**They are decorative and non-informational** — radius already carries ring membership — so WCAG
1.4.11 does not apply. `mind-ring.css` gives them **`.mtree-edge`'s exact stroke and its existing
depth fade**: no new token, no new contrast recipe to measure. `mindtree.css:139-141` already records
that the edge at `opacity: .55` drops to 3.76 dark / 3.20 light and calls that *"the entire headroom
spent on decoration"*; the guide gets the same ink or less. **If the contrast sweep rules that the
house rule admits no decoration exception, drop the circles** — they buy the sunburst *image* and
nothing else, and `--border` is documented at 1.46:1 with no headroom to spend. Losing the rings is
cheaper than inventing a colour.

### Constraints

TypeScript strict. Logical CSS properties only in `mind-ring.css`. No new locale key (the guides are
`aria-hidden`; the legend line about angle belongs to U5). Do not touch `PulseLayer`,
`MindDropTargets`, `NodeCard`, `MindEdge` or `export.ts` — if the flip appears to require it, that is
the thesis test failing and the run stops.

---

## U4 — THE CHROME ISLANDS

**Owns:** `src/components/map/MapLensBar.tsx` · `map-lens.css` · `MapToolbar.tsx` ·
`MapModeBar.tsx` · `map-mode.css` · `MapAltitude.tsx` (new) · `map-altitude.css`
(new, owns **`.malt-*`** — report to the integrator for §1.0.7).

### `MapAltitude.tsx` — the ladder

```ts
import type { Altitude } from '../../lib/mindtree/altitude'

export interface MapAltitudeProps {
  value: Altitude
  onChange: (next: Altitude) => void
  onFit: () => void
  /** The ledger toggle rides the ladder's foot — it is the low-motion reading
   *  mode and burying an accessibility mode is not available to us. */
  table: boolean
  onTable: (next: boolean) => void
  compact: boolean
}
export default function MapAltitude(props: MapAltitudeProps): ReactElement
```

**Desktop:** a `role="group"` named `t('mindtree.altitudeLabel')` holding four 44px `aria-pressed`
stops (Portfolio · Programme · Delivery · Work), then Fit (⌾), then Table (▤) — 6 targets,
6×44 = 264px, block-centred at the canvas's **inline-end**. `aria-pressed`, not
`role="radiogroup"`: a radio group takes the arrow keys away, and the map's canvas is one Tab stop
away — the same reasoning `MapLensBar` already records for its own chips.

**Phone:** one 44px button showing the current stop, opening the four as a small menu; Fit and Table
inside the same menu. Pinch keeps driving the raw zoom.

Colour: `.mpan`'s plate (`--bg-elev` + `1px solid var(--border)`) with `.mlens-chip`'s pressed recipe
(`--bg-elev-2` + `--text` + `--accent` border). Both are already computed in both themes, so **no new
contrast recipe**. An opaque plate is required, not optional: this floats over nodes, so its backdrop
is not the canvas.

44px arithmetic, using the number `map-panel.css` already documents: a 32px border box with a 1px
border is a 30px padding box and `.tap-44`'s ±7px lands on 44. Not 30.
`inset-inline-end` — the mirror is free.

### `MapLensBar.tsx` — tiering, and the Map|Table pair leaves

- **Delete the `.mlens-label` span outright.** It is already `aria-hidden` and `[data-compact]`-hidden;
  the group's `aria-label={t('mindtree.lensLabel')}` already carries the words. The key is **not**
  retired.
- **The tiering.** The pressed chip keeps the filled `--bg-elev-2` + `--text` + `--accent`-border
  recipe. The four unpressed chips lose their `1px solid var(--border)` and become borderless
  `--text-dim` text. One filled pill in a row of four labels is the whole difference between "five
  equal buttons" and "somewhere for the eye to land." Their `.tap-44` overlays are unchanged, so the
  targets do not shrink.
- **The `stages.length > 1` block is deleted.** `Map | Table` becomes `MapAltitude`'s Table toggle.
  Remove `stage`/`onStage` from `MapLensBarProps`; keep `allowedStages` imported by nobody here (U6
  keeps calling it to decide whether to render the toggle at all).
- **The phone rail.** In `map-lens.css`, `.mlens[data-compact]` becomes
  `position: fixed; inset-inline: 0; inset-block-end: var(--map-composer-block-size, 0px);
  z-index: 71; background: var(--bg-elev); border-block-start: 1px solid var(--border);`
  — **one above the sheet's 70, always**, in the thumb zone. Keep the 8px `padding-block` on the
  scrolling chip row that holds `.tap-44`'s overlay out of the scroller's clip. Keep the snap
  scrolling. This is the fix `map-panel.css`'s comment considered and rejected in a *different* form
  ("carrying the chips into the sheet at `full`"), and all three of its objections fail against this
  version: the fix stays in CSS, there is **no second `MapLensBar` in the DOM**, and it repairs the
  whole problem rather than just the chips.

### `MapToolbar.tsx` — reduced to the four group-by chips

```ts
export interface MapToolbarProps {
  dimension: MindDimension
  onDimension: (next: MindDimension) => void
  compact: boolean
}
```

Everything else goes: `view`, `density`, `onDensity`, `onExpandAll`, `onCollapseAll`, `zoomPercent`,
`zoomStep`, `onZoom`, `onFit`, `exporting`, `onExport`, and with them the Expand all / Collapse all /
Compact buttons, the three zoom controls, Fit, and the export `<details>` (which moves to
`MapModeBar`).

**The `GROUP BY` label deletion is a real wiring change, not a CSS deletion.** `.mtree-bar-label`
carries `id="mtree-groupby"` and the inner `chip-row` is `aria-labelledby="mtree-groupby"`. Delete
the span **and** switch the chip row to `aria-label={t('mindtree.groupBy')}`, or the group silently
loses its name. That is the kind of deletion that goes wrong quietly.

On `compact`, render one 44px button naming the active dimension that opens the four as a menu.

### `MapModeBar.tsx` — Meetings, and the export

Meetings keeps its link, its icon and its live pill: **1 tap, at every width**, per MAP-CONTRACT §2
("a meeting starts while people are walking into a room"). Digest moves *inside* the export
disclosure, so it stays at 2 taps.

Move the export `<details>` here from `MapToolbar`, markup intact — including the Escape /
light-dismiss effect and the `exporting` disabled states. Re-home its CSS from `mindtree.css`'s
`.mtree-export*` into `map-mode.css` as `.mmode-export*` (U6 deletes the old rules; the `.mmode-`
registry line already exists).

```ts
export interface MapModeBarProps {
  compact: boolean
  exporting: boolean
  onExport: (kind: 'svg' | 'png' | 'copy') => void
}
```

On `compact`, `.mmode` is pinned at the rail's **inline-end, outside the chip scroller** — `map-lens.css`
is right that the modes must never be the half that goes off-screen.

### New locale keys U4 reports to the integrator

`mindtree.altitudePortfolio` · `altitudeProgramme` · `altitudeDelivery` · `altitudeWork` ·
`altitudeLabel` · `altitudeChanged` (`{label}`). Each is a **three-file change**
(`src/locales/en/mindtree.json`, `src/locales/ar/mindtree.json`, `src/lib/labelSections.ts`) with
exact en/ar parity. `altitude*` goes to the `actions` section (add `'altitude'` to the mindtree
`prefixes` list beside `'zoom'`).

### Constraints

TypeScript strict. Logical CSS properties only. No new colour token or contrast recipe. Every target
44px. Nothing in this unit imports React state from the shell — all four components stay
prop-driven and stateless except the export `<details>` ref that already exists.

---

## U5 — THE PANEL

**Owns:** `src/components/map/MapPanel.tsx` · `map-panel.css` · `MapSummary.tsx` ·
`MapList.tsx` · `MapList.test.tsx`.

### `MapPanel.tsx` — a floating card, and it measures itself

```ts
export interface MapPanelProps {
  open: boolean
  compact: boolean
  detent: PanelDetent
  onDetent: (next: PanelDetent) => void
  onClose: () => void
  title: string
  /** How much of the stage this panel is covering, in CSS px, MEASURED — so the fit
   *  can subtract it and the ring centres in the band the reader can actually SEE.
   *  Reported from a ResizeObserver on this component's own root, and once with
   *  {0,0} on unmount. Desktop reports inlineEnd (width + its 12px inset) and
   *  blockEnd 0; the phone sheet reports blockEnd (height) and inlineEnd 0. */
  onOcclude: (occlusion: { inlineEnd: number; blockEnd: number }) => void
  children: ReactNode
}
```

Without `onOcclude`, the panel covers the busiest branch on every open on desktop, and on a phone the
ring centres in the *element* and half of it sits behind the sheet — the same class of bug being
fixed, arrived at from the other side.

**The three detent buttons are deleted.** `.mpan-detents` and `.mpan-detent` go with them. The
grabber already cycles on click and steps on ArrowUp/ArrowDown, so the keyboard path `map-panel.css`
insists on survives intact; `MAP_DETENTS`, `DETENT_KEY` and `phoneDetentFor` are untouched, and their
locale keys are **not** retired. "Hide the panel" becomes the single ✕ that is already in the head row.

**Desktop presentation becomes a floating card, and the DOM relationship does not change.** This is
the one thing in `MAP-CONTRACT.md` §1 and this file's own header that a floating layout is most
likely to break: `.mtree-canvas` is `touch-action: none`, and `touch-action` intersects **down** the
ancestor chain, so a list inside it cannot be finger-scrolled. So in `map-panel.css`:

- `.mpan-split` becomes `position: relative; block-size: 100%` (U6 sets the stage height).
- `.mpan-stage` and its `.mtree-canvas` sit at `inset: 0`.
- `.mpan` at `min-width: 768px` becomes `position: absolute; inset-inline-end: 12px;
  inset-block-start: 68px; inset-block-end: 88px; inline-size: clamp(20rem, 26vw, 26rem);`
  with `box-shadow: var(--shadow)`. **Still a sibling of the canvas, never a child.**
- **Retire** `.mpan-split:not(:has(> .mpan))` and both `grid-template-columns` rules — the canvas is
  always full width now, so the "no dock rendered" special case has nothing left to do.
- Phone rules are unchanged **except**: `--map-shell-chrome-block-size` shrinks (U6), and the sheet's
  `inset-block-end` becomes `calc(var(--map-composer-block-size, 0px) + var(--map-lens-rail-block-size, 48px))`
  so it clears the pinned lens rail. z-index stays **70**, one below the rail's 71.

Everything in `MapPanel.tsx`'s header that describes the Escape ordering, the non-modal contract and
the `pushOverlay` registration stays true and stays as written.

### `MapList.tsx` — seven rows to two

Observed today: title · Small/Half/Full · "Hide the panel" · Everyone/Mine · "0 items need attention"
· Refresh · "Every track", several raggedly indented and unaligned.

- **"0 items need attention" folds into the title.** "What needs you" + "0 items need attention" are
  one sentence: *"Nothing needs you."* Two rows become none.
- **Refresh renders only in the error state**, which is the only state where it means anything.
  (`Mindtree.tsx:594` already renders one inside the error `EmptyState`; this deletes the
  unconditional one.)
- **"Every track" stays** — it is the panel's scope, a sentence and not a control, and it drops when a
  branch is focused.
- **The Everyone/Mine segment is removed from this component.** `Mine` now lives in the shell's
  top-start rail as the **single** owner of that fact, visible at every lens including `shape` where
  no panel exists at all — which is strictly better than today, where it exists only while the panel
  is open. Keep the `onFilter` prop in `MapListProps` (**optional**, and no longer rendering a
  segment when supplied) so the type stays stable for U6; update `MapList.test.tsx` for the absent
  segment. There must be exactly one control for one fact — two `role="group"`s with one accessible
  name and two pressed states is a defect for a screen reader even when it looks right.
- Every remaining row aligns to one inline-start edge.

### `MapSummary.tsx` — the block-end caption

Today the three summary sentences render **below** the canvas, which at 1600×900 is below the fold —
nobody has ever seen them. They become a single 24px caption strip at the stage's block end, beside
the legend, in one row: `size = open items` · `● past deadline` · **`direction from the centre means
nothing`** (a radial map invites a reader to decide 3 o'clock is important; the legend must say it is
not) · then the summary sentences · then the filter's result count, which arrives here as
`t('mindtree.countOpen')` rather than as a standalone chip in the header.

- The `sr-only` `aria-describedby` hint node stays exactly where it is and keeps its id — the `<svg>`
  points at it, and deleting it silently breaks the map's description.
- The polite live region stays, keyed on `live.seq`.
- `panHint` is dropped on desktop (drag-to-pan is discoverable with a mouse); `mobileHint` is **kept**
  on the phone, where the gesture is not discoverable with a thumb.

```ts
export interface MapSummaryProps {
  showMapChrome: boolean
  compact: boolean
  hintId: string
  summary: string
  busiest: string | null
  topGroup: string | null
  /** The filter's own result count, previously a standalone chip in the header. */
  countLabel: string
  live: { text: string; seq: number }
}
```

### New locale keys U5 reports to the integrator

`mindtree.legendAngle` ("Direction from the centre carries no meaning" / an exact Arabic parity
string). Three-file change; `legend*` already resolves through the mindtree rules, so
`labelSections.ts` needs no new prefix for it — confirm rather than assume.

### Constraints

TypeScript strict. Logical CSS properties only. The panel stays a **sibling** of the canvas and stays
**non-modal**. Do not change `phoneDetentFor`, `MAP_DETENTS`, `DETENT_KEY` or the `pushOverlay`
registration. Do not add a scrim.

---

## U6 — THE SHELL

**Owns:** `src/pages/Mindtree.tsx` · `src/pages/mindtree.css` · `src/pages/map/useMapToolbar.ts`.

### The stage

`.mtree` stops being a scrolling document column:

```css
@media (min-width: 768px) and (min-height: 480px) {
  .mtree {
    position: relative;
    block-size: calc(100dvh - var(--app-header-block-size, 65px));
    display: grid;
    grid-template-rows: minmax(0, 1fr) auto;
    gap: 0;
  }
}
```

`.mpan-split` fills the `1fr`, `.mtree-canvas` sits at `inset: 0` and **loses its
`block-size: clamp(22rem, 62vh, 45rem)`, its border, its radius and its gutter — it *is* the page.**
Keep `touch-action: none` and `overflow: hidden`; the element's identity is load-bearing for the pan
gesture and it must not become a plain div.

That takes the drawing from `~1136×414 = 0.47M px²` (a `clamp(22rem, 62vh, 45rem)` canvas starting
486px down a 900px viewport, minus a 26rem rail) to `1600×835 = 1.34M px²` — **2.8×**.

**WCAG 1.4.10 reflow.** A fixed `100dvh` shell has nowhere to reflow to, and today's document-flow
column passes by construction. The media query above is the release valve and it is stated as a
condition rather than an afterthought: at 400% zoom on a 1280×1024 viewport the CSS viewport is
320×256, which is below **both** guards, so `.mtree` returns to the document-flow column it is today
and the four islands return to being ordinary blocks. Test it at 320×256 explicitly — "it falls back"
is what everyone says about the path nobody exercises.

### The four islands

All four use `position: absolute` with `inset-inline-start` / `inset-inline-end` /
`inset-block-start` / `inset-block-end`, so **the RTL mirror is free in the HTML layer** and only the
`<svg>` needs arithmetic — which stays `layout.ts`'s one reflection statement plus U2's single
explicit occlusion sign.

| island | placement | contents |
|---|---|---|
| top-start | `inset: 12px auto auto 12px`, 44px tall | search field (`FilterBar`, facets in a popover) · `Mine` toggle · `Filter (n)` |
| top-end | `inset: 12px 12px auto auto` | `MapLensBar` (5 chips) · `MapModeBar` (Meetings, ⧉ export) |
| canvas start | `inset: 68px auto auto 12px` | `MapToolbar` — the four group-by chips |
| canvas inline-end | `inset-inline-end: 12px`, block-centred | `MapAltitude` — 4 stops · Fit · Table |
| block-end | the grid's `auto` row | `MapCapture` centred · `MapSummary` caption inline-start |

**Collision budget:** 540 + 460 + 24 insets = 1024 of 1600, so the two top islands never meet above
1080px. Below that the lens row wraps under the search rail (it already `flex-wrap`s) and the stage
loses 44px, not 300. **The panel and the ladder do not fight** because the ladder is placed against
the canvas's inline-end *inside* the region the panel's 12px inset leaves, and the panel is
`inset-block-start: 68px` — below the lens island — so nothing overlaps at rest.

At rest the islands cover `540×44 + 460×44 + 44×308 + 720×56 + 300×32 ≈ 127k px²` = **9.5%** of a
1600×835 stage. Today's chrome takes 46% of the viewport *before* the canvas starts.

**Floating chrome over a canvas is a hit-testing and focus-order hazard the current layout does not
have**, and it must be handled rather than hoped away: every island is `pointer-events: auto` on the
island and the canvas keeps `touch-action: none`; DOM order is islands-then-canvas so the Tab order
is search → Mine → Filter → lens chips → Meetings → export → group-by → ladder → the tree's single
stop → panel → composer, and that order is **asserted in a test**, not inherited.

### Deletions from `Mindtree.tsx`

`<h1 className="page-title">` → an `sr-only` `<h1>` (the document outline must survive; the app header
already says where you are) · `<p className="page-subtitle mtree-sub">` deleted · the standalone
`resultLabel` chip moves into `MapSummary`'s caption via the new `countLabel` prop · the
`mtree-panel-show` button stays (it is the way back to a closed panel and it is one tap).

Props dropped at the `MapToolbar` call site: `view`, `density`, `onDensity`, `onExpandAll`,
`onCollapseAll`, `zoomPercent`, `zoomStep`, `onZoom`, `onFit`, `exporting`, `onExport`.
`exporting`/`onExport` move to the `MapModeBar` call site. `stage`/`onStage` move off `MapLensBar`
and onto `MapAltitude`'s `table`/`onTable` (`onTable(true)` → `lens.setStage('table')`,
`onTable(false)` → `lens.setStage(stageForLens(lens.lens))`), rendered only when
`allowedStages(lens.lens).length > 1`.

### Deletions from `mindtree.css`

`.mtree-sub` · `.mtree-zoom` · `.mtree-export*` (re-homed by U4 into `map-mode.css`) ·
`.mtree-bar-label` · `.mtree-canvas`'s `clamp()`/border/radius. `.mtree-bar` becomes the floating
group-by island. `.mtree-legend*` and `.mtree-hint` move into the caption strip's row.

### The phone

```css
@media (max-width: 767px) {
  .mtree {
    block-size: 100dvh;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    padding-block-end: 0;   /* the composer is fixed and the rails are fixed */
  }
  /* the top rail is the `auto` row; the canvas is the 1fr and is therefore the
     largest region on the screen BY CONSTRUCTION, not by a clamp a scroll
     position can defeat. */
}
```

`.mtree-shellbar` becomes the **pinned rail** at the block end (`position: fixed`, z-index **71**,
`inset-block-end: var(--map-composer-block-size)`), publishing
`--map-lens-rail-block-size: 48px` for `map-panel.css` to subtract. U4 owns what is *inside* it; U6
owns that it is fixed and where.

**`--map-shell-chrome-block-size` collapses from `header + 64px` to `calc(var(--app-header-block-size, 65px) + 8px)`**,
because the sheet no longer has to reserve a strip of page in the hope the chips are scrolled into it
— they are pinned above it now. Rewrite the comment block at `mindtree.css:184-221` to say so; the
old text argues for the old number and is now actively misleading.

Recomputed: `full` = 812 − 65 − 8 − 64 composer − 48 rail = **627px** (up from 619, because the
duplicated title is gone). At `half` (55dvh = 447) the map keeps **188px**. At `peek` **432px**. At
`shape` with nothing focused, no sheet at all: the map is **359 × 635**.

**Kept on the phone:** `mindtree.mobileHint` · the breadcrumb as the way back out of a drill-in ·
all three detents and the grabber · every 44px arithmetic in `map-panel.css`'s and `map-lens.css`'s
footers.

### Wiring

- `occludeInline` / `occludeBlockEnd`: `useState<{inlineEnd:number;blockEnd:number}>({inlineEnd:0,blockEnd:0})`,
  written by `MapPanel`'s `onOcclude`, reset to `{0,0}` when `panel === null || !lens.panelOpen`,
  threaded into `useMapGeometry`.
- `altitude`: `useState<Altitude>(() => altitudeForRole(model.role))`, threaded in with
  `onAltitude`. Not persisted, not in the URL.
- `MapList` no longer receives `onFilter`; `Mine` is the top-start rail's toggle writing `setFilter`.

### The two empty states

Today the canvas says "No tracks yet / An admin creates tracks from Settings, then Tracks" **and** the
panel says "Nothing needs you right now" — two answers to a question nobody asked. **One `noTracks`
guard in the `panel` IIFE**: when `noTracks` is true the IIFE returns `null` before the switch, so the
panel does not render at all — there is nothing that can need you in a workspace with no tracks — and
the canvas shows one state across the full width.

The copy is stale in both languages: `mindtree.emptyTracksHint` reads *"An admin creates tracks from
Settings, then Tracks."* / *"ينشئ المشرف المسارات من الإعدادات، ثم المسارات."* — that screen is now
**Settings › Structure**. This is a **value** correction to `en` and `ar` only; the key is unchanged,
so `labelSections.ts` is not touched for it. Report both strings to the integrator.

### New locale keys U6 reports to the integrator

`mindtree.filterCount` (with a **plural node** — CLDR, `{count}`), `mindtree.groupByCurrent`
(`{label}`, the phone's collapsed group-by button). Three-file change each.

### `useMapToolbar.ts`

Keep `expandAll` and `collapseAll` — the table stage and the keyboard still call them, and their
announcement keys stay live. Keep `chooseDimension`, `exporting`, `runExport`. `chooseDensity` stays
exported (the store value survives for the linear/table path) but is no longer wired to a control.

### Constraints

TypeScript strict. Logical CSS properties only — no `left`/`right`/`padding-left`. Every user-visible
string through `t()`. 44px targets. RTL equal to LTR. Do not touch the roving tabindex, the
`role="tree"` contract, `useMapKeyboard`, `useMapFocus`, `useMapModel`, `lens.ts`, `DragLayer`,
`NodeMenu`, `QuickAdd` or `MapCapture`.

---

## 2. Integrator

### Locale keys — every one a THREE-file change

`src/locales/en/mindtree.json` · `src/locales/ar/mindtree.json` · `src/lib/labelSections.ts`,
exact en/ar parity, and the `mindtree` rule block gains `'altitude'` and `'legendAngle'` in the
`actions` / existing prefix lists as appropriate.

| key | from | note |
|---|---|---|
| `mindtree.altitudePortfolio` | U4 | |
| `mindtree.altitudeProgramme` | U4 | |
| `mindtree.altitudeDelivery` | U4 | |
| `mindtree.altitudeWork` | U4 | |
| `mindtree.altitudeLabel` | U4 | the ladder's group name |
| `mindtree.altitudeChanged` | U4 | `{label}` — the live announcement that replaces "Zoom 140%" |
| `mindtree.legendAngle` | U5 | *angle means nothing* |
| `mindtree.filterCount` | U6 | **plural node** |
| `mindtree.groupByCurrent` | U6 | `{label}` |

**Value correction, no key change:** `mindtree.emptyTracksHint` in `en` and `ar` → Settings › Structure.

**Nothing is retired.** An orphaned key is still parity-tested and still renameable in Terminology;
deleting one is a three-file change with `localeReach.test.ts` and `labelSections.ts` in the loop
across four units for zero user-visible gain.

### `docs/EXECUTION-PLAN.md` §1.0.7 — two new registry lines

`.mring-*` → `src/components/mindtree/mind-ring.css` (U3) ·
`.malt-*` → `src/components/map/map-altitude.css` (U4).
Plus the amendment that `.mtree-export*` has moved to `.mmode-export*` in `map-mode.css`.

### `docs/MAP-CONTRACT.md`

§1: the panel is now a floating card on desktop and still a **sibling** of the canvas — the
`touch-action` reasoning is unchanged and must be restated, not deleted. §2: `Mine` moves to the
top-start rail as the single owner; `Map|Table` becomes the ladder's Table toggle, still 1 tap;
Digest is 2 taps inside the export menu; Meetings is unchanged at 1 tap. Record that
`phoneDetentFor` is **not** changed and why the pinned rail is what makes `full` safe.

---

## 3. Verification

Every unit, before handoff: **`npx tsc -b`** (never `--noEmit`), `oxlint`, `vitest`
(**3,810 must not regress**), `npm run build`, plus locale parity / reach / plural / bidi and the four
standing greps.

Feature gates, and they are not optional:

1. **The thesis test.** Flipping `useMapGeometry.ts:203` to `layoutMindtreeRadial` requires no
   downstream edit beyond U3's three. If it does, **stop and re-plan** — that is plan risk 4 firing.
2. **Byte-identical linear layout.** `layoutMindtree` on today's fixtures returns today's output,
   `outward`/`rings`/`hub` all `undefined`.
3. **Polar invariants**, including **no AABB overlap across depths** — the one the column layout gave
   free — and 200 children on one ring staying finite.
4. **Mirror equality** for `layoutMindtreeRadial`, with `root.x` byte-identical in `ltr` and `rtl`.
5. **Tab order asserted**, not inherited, because DOM order and visual order now diverge.
6. **Reflow at 320×256** (400% zoom on 1280×1024): `.mtree` is a document-flow column and every
   island is an ordinary block.
7. **Live proof in a browser at 1600×900 and 375×812, in BOTH languages** — the phone case must show
   the map on first load at `needs-me`, and the lens rail must be reachable with the sheet at `full`.
8. The map's `role="tree"` output — `aria-level`, `posinset`, `setsize`, pre-order — is identical
   between the linear and radial layouts for the same tree and depth limit.

---

## 4. The bet, stated plainly

MAP-CONTRACT §0 records four independent critics converging on one sentence: *"he keeps the map as a
picture and a capture bar, and he quietly asks for the follow-ups list back."* The daily job — what is
overdue across nine tracks, sorted by date, and who do I chase — **crosses every track and sorts by
date**, which a track-partitioned canvas answers worst. This contract gives the map 100% of the stage
and demotes that job's surface to a floating card over 26% of it.

The bet is that Parts 1 and 2 change the fact pattern: once the map holds Organizations, use-case
progress and computed risk, *"where is the mass"* stops being a ninety-seconds-before-a-steering-meeting
question and becomes a daily one. **If that bet is wrong, this is a prettier version of a screen he
stops opening** — and the twenty controls were never the reason he called it terrible. The reason was
that the map had nothing on it worth looking at, because his data does not exist yet (plan risk 5).
No amount of viewport wins fixes a map of nine empty tracks. The admin screen is the feature's front
door, not a follow-up.
