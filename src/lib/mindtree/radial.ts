// The Mindtree's POLAR geometry: the same tree, the same build walk, arranged on
// rings around a hub instead of in columns.
//
// The layering rule is layout.ts's, unchanged and non-negotiable: no React, no
// store, no api, no i18n, no DOM, no new runtime dependency. `Math` only — there
// is no d3, no polar helper, nothing to install. A layout that can only be
// exercised by mounting a page is a layout nobody tests, and this one has to
// hold seven invariants at once (an exact angular partition, no overlap within a
// ring, no overlap ACROSS rings, bounds that contain the curves, bounds centred
// on the hub, an exact RTL mirror, and no NaN at any input). Every one of them
// is a plain assertion about the return value of a pure function.
//
// UNROTATED, AXIS-ALIGNED RECTANGLES, POSITIONED POLAR — NOT SUNBURST ARCS. The
// boxes never rotate; only their centres move onto a circle. That is what keeps
// the entire renderer working unchanged: MindNode's measured CHAR_PX glyph
// budget, <rect> hit-testing, PulseLayer's rect pulses, MindDropTargets,
// DragLayer's pointer→layout conversion, the free CSS `translate` tween and
// export.ts's id-stripping serialiser. A wedge would also encode leaf count as
// AREA, colliding head-on with sizeForCount's count→area encoding — two marks
// for two different facts on the same shape.
//
// THE ALGORITHM:
//   1. BUILD    layout.ts's `buildLayoutNodes`, called — not copied. Pre-order,
//               the depth limit, the collapsed rule, the cycle guard and
//               hiddenChildCount all come from the one function the linear
//               layout uses, which is why `role="tree"`'s aria-level /
//               posinset / setsize are identical between the two shapes and
//               cannot drift apart.
//   2. ANGLE    each node's children partition their parent's wedge in
//               PROPORTION TO THE LEAF SLOTS the subtree needs at the deepest
//               drawn ring — the polar translation of the contour packing the
//               column layout does along y. It is a PACKING requirement, not a
//               second encoding, so it does not collide with sizeForCount.
//   3. RADIUS   demand-driven, ring by ring, from the CHORD between adjacent
//               boxes (see below) and from a pitch that keeps ring d clear of
//               ring d−1.
//   4. RESOLVE  centres, edges whose ends leave and arrive RADIALLY, bounds that
//               union the Bézier control points, padded symmetrically about the
//               hub, and — if the reader is in Arabic — mirrored.
//
// CHORD, NOT ARC, AND THIS IS THE CORRECTION THAT MATTERS. The obvious closed
// form `r = Σ(diag + gap) / sweep` is an ARC-LENGTH bound, but two boxes are
// separated by the straight line between their centres — their CHORD. Three
// programmes on a ring gives Δθ = 120°: the chord is 2r·sin60° = 1.73r against
// an arc of 2.09r, so an arc-derived radius overlaps the boxes at the COMMONEST
// fan-out on this screen. Every pair constraint below is therefore
//     r ≥ (diag_i/2 + diag_j/2 + gap.sibling) / (2·sin(Δθ_ij/2)),
// with the arc form kept only as the slack-side bound for Δθ ≥ π and as the
// guard when Δθ collapses toward zero.
//
// A NODE'S FOOTPRINT IS ITS CIRCUMSCRIBED DISC (radius = diag/2). Two discs that
// do not touch cannot contain overlapping rectangles, so "no AABB overlap" comes
// out as a corollary of a one-dimensional distance test instead of as a
// pairwise box test the layout would have to iterate to satisfy.
//
// PITCH IS A SUPPORT FUNCTION, NOT A HEIGHT. A rect at 3 o'clock extends along
// the radius by w/2, not h/2, so the ring-to-ring step is written in terms of
// the two rings' largest DIAGONALS. That preserves the invariant the column
// layout gave away free — NO AABB OVERLAP ACROSS DEPTHS — as a statement that
// can be asserted rather than eyeballed.
//
// RTL IS A REFLECTION ABOUT THE HUB, APPLIED ONCE, AT THE END: θ → π − θ, which
// with `startAngle = 0` puts ring 1's first child at 3 o'clock in English and at
// 9 o'clock in Arabic — the reading edge in both scripts. Starting at 12 o'clock
// would mirror to 12 o'clock, which is symmetry that says nothing. The
// reflection is exact at the hub because the bounds are PADDED SYMMETRICALLY
// ABOUT IT first: a circular drawing's bounding box is NOT centred on its root
// (different rings carry different box widths), so without that padding the root
// drifts a few units off-centre and the mirror stops being an equality.

import { buildLayoutNodes, resolveLayoutOptions } from './layout'
import type {
  Bounds,
  LayoutInputNode,
  LayoutOptions,
  LayoutWorkNode,
  MindtreeEdge,
  MindtreeLayout,
  NodeSize,
  Point,
  PositionedNode,
  Viewport,
} from './layout'

const TAU = Math.PI * 2

/**
 * layout.ts's EDGE_CURVE, restated (it is private there). Half the run on each
 * side is what makes both ends of a connector meet its box square-on; here the
 * "run" is the radial gap between the two rings, so the meaning survives the
 * change of shape and `edgePath()` never needs to know which layout drew it.
 */
const EDGE_CURVE = 0.5

/** How far past its own edge a node's chevron anchor sits. MindNode's fallback
 *  for the linear layout uses the same 9. */
const CHEVRON_GAP = 9

/** WCAG 2.5.8's target floor, and the number `minScale` in the fit is derived
 *  from. No ring rule may take a box below it. */
const MIN_TARGET_PX = 44

/** Ring 2 and ring 3+ inline sizes. Without them, ring 2 on a 1600×900 desktop
 *  fits at 0.44 — below the MIN_TARGET_PX/height = 0.545 floor — on a SMALL
 *  workspace on a BIG monitor. */
const RING_2_WIDTH = 132
const RING_3_WIDTH = 108

/** Below this, an angle is treated as zero: sin(Δθ/2) is about to divide. */
const EPS_ANGLE = 1e-6

/** A diameter below this is treated as this. Nothing about a world of zero
 *  extent is drawable, and it is a division waiting to happen. */
const EPS_SIZE = 1e-6

// ── the containment packing constants ──────────────────────────────────────
//
// DECLARED HERE, RE-EXPORTED FROM worlds.ts, and the reason is a module cycle
// that would otherwise be real: `packRing` is the packer, `packRing` lives here
// (MAP-ZOOM §11 U1 puts it here), and it needs RIM and SINGLE_CHILD_RATIO at
// call time. worlds.ts imports them from here and re-exports them under the
// names the contract publishes, so `import { RIM } from './worlds'` works and
// no top-level constant is ever read across a half-initialised cycle.

/** The empty band between the outermost child world and its parent's rim, as a
 *  multiple of the ring's outer extent. 14% is what makes a parent's rim read
 *  as a rim rather than as a line drawn through its children. */
export const RIM = 1.14

/** The clearance between two sibling worlds, as a share of the widest world on
 *  the ring. */
export const GAP_RATIO = 0.18

/** The diameter of a world holding one 168×44 card and nothing else — the unit
 *  of this coordinate space. The finest detail in the drawing sits here, at
 *  unit scale, where float precision is best. */
export const D_LEAF = 200

/**
 * A world with exactly one child is this much bigger than that child.
 *
 * It cannot come out of the ring formula — a ring of one has no pair to be
 * separated from — and it may not be 1: a chain of single children that did not
 * grow would be a stack of concentric circles with nothing between them, and
 * the dive through it would never arrive anywhere.
 */
export const SINGLE_CHILD_RATIO = 2.2

/** Below this, a direction cosine is treated as zero — the ray is parallel to
 *  the box edge it would otherwise be dividing by. */
const EPS_AXIS = 1e-9

export interface RadialOptions<N extends LayoutInputNode = LayoutInputNode>
  extends LayoutOptions<N> {
  /** Radians the root's children may occupy. Default 2π — and the full circle is
   *  the INLINE-OPTIMAL sweep, not merely the default: the drawing's inline
   *  extent is 2(r·sin(S/2) + halfbox) and r grows as 1/S, so narrowing the
   *  sweep makes the picture WIDER, not narrower. */
  sweep?: number
  /** Bearing of the FIRST child, in radians. 0 = 3 o'clock, clockwise positive
   *  (SVG's y grows downward). Default 0 — see the header on why the mirror
   *  makes that the reading edge in both scripts. */
  startAngle?: number
}

/** One node's slice of the circle. Returned by `radialWedges` only. */
export interface RadialWedge {
  /** Leaf slots this subtree needs at the deepest drawn ring. */
  readonly slots: number
  /** Inclusive start bearing, radians. Exactly the previous sibling's `end`. */
  readonly start: number
  /** Exclusive end bearing. The last child's is EXACTLY the parent's `end`. */
  readonly end: number
  /** The bearing the node is actually drawn on: the wedge's midpoint. */
  readonly bearing: number
}

// ── the entry point ────────────────────────────────────────────────────────

/**
 * Lay out a Mindtree on rings.
 *
 * Returns the identical `MindtreeLayout` the linear layout returns — same
 * pre-order, same ARIA fields, same `bounds`/`byId`/`edges` contract — plus
 * `rings`, `hub` and a per-node `outward`. Every returned number is finite for
 * every input this can be handed, including sizes a divide-by-zero in an area
 * encoding turned into NaN: `buildLayoutNodes` sanitises those on the way in.
 */
export function layoutMindtreeRadial<N extends LayoutInputNode>(
  root: N,
  options: RadialOptions<N> = {},
): MindtreeLayout<N> {
  const opts = resolveLayoutOptions(options)
  const work = buildLayoutNodes(root, opts, options.sizeOf)
  const sweep = resolveSweep(options.sweep)
  const startAngle = finiteOr(options.startAngle, 0)

  const count = work.length
  const { bearing } = partitionAngles(work, sweep, startAngle)

  let maxDepth = 0
  for (const node of work) if (node.depth > maxDepth) maxDepth = node.depth

  // Each node's circumscribed-disc diameter, the ring it belongs to, and the
  // widest disc on each ring — the three facts every radius below is made of.
  const diag: number[] = new Array<number>(count).fill(0)
  const ringOf: number[][] = []
  const maxDiag: number[] = new Array<number>(maxDepth + 1).fill(0)
  for (let d = 0; d <= maxDepth; d += 1) ringOf.push([])
  for (let i = 0; i < count; i += 1) {
    const node = work[i]
    diag[i] = Math.hypot(node.width, node.height)
    ringOf[node.depth].push(i)
    if (diag[i] > maxDiag[node.depth]) maxDiag[node.depth] = diag[i]
  }

  const rings = ringRadii({
    ringOf,
    diag,
    maxDiag,
    bearing,
    sweep,
    gap: opts.gap,
    maxDepth,
  })

  // ── centres, hub-relative, before the mirror ────────────────────────────
  const cx: number[] = new Array<number>(count).fill(0)
  const cy: number[] = new Array<number>(count).fill(0)
  for (let i = 0; i < count; i += 1) {
    const r = rings[work[i].depth]
    if (r === 0) continue // the root IS the hub
    cx[i] = r * Math.cos(bearing[i])
    cy[i] = r * Math.sin(bearing[i])
  }

  // ── edges, the chevron anchors, and the extremes of the whole drawing ───
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  const see = (x: number, y: number): void => {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }

  const raw: (RawEdge | null)[] = new Array<RawEdge | null>(count).fill(null)
  const outLocal: (Point | null)[] = new Array<Point | null>(count).fill(null)
  const indexOf = new Map<string, number>()
  for (let i = 0; i < count; i += 1) indexOf.set(work[i].id, i)

  for (let i = 0; i < count; i += 1) {
    const node = work[i]
    see(cx[i] - node.width / 2, cy[i] - node.height / 2)
    see(cx[i] + node.width / 2, cy[i] + node.height / 2)

    if (node.parent === null) continue
    const p = indexOf.get(node.parent.id) as number
    const parent = work[p]

    const thetaC = bearing[i]
    // The ROOT has no bearing of its own — it sits ON the hub and radiates in
    // every direction — so an edge out of it leaves along its CHILD's bearing.
    const thetaP = parent.depth === 0 ? thetaC : bearing[p]

    const sTip = supportRadius(parent.width / 2, parent.height / 2, thetaP)
    const sx = cx[p] + sTip * Math.cos(thetaP)
    const sy = cy[p] + sTip * Math.sin(thetaP)
    const eTip = supportRadius(node.width / 2, node.height / 2, thetaC)
    const ex = cx[i] - eTip * Math.cos(thetaC)
    const ey = cy[i] - eTip * Math.sin(thetaC)

    // EDGE_CURVE of the radial run, exactly as the linear layout takes
    // EDGE_CURVE of the horizontal run: the connector leaves the parent
    // radially outward and arrives at the child radially inward, so both ends
    // meet a box square-on at every zoom level.
    const t = EDGE_CURVE * (rings[node.depth] - rings[parent.depth])
    const edge: RawEdge = {
      sx,
      sy,
      ex,
      ey,
      c1x: sx + t * Math.cos(thetaP),
      c1y: sy + t * Math.sin(thetaP),
      c2x: ex - t * Math.cos(thetaC),
      c2y: ey - t * Math.sin(thetaC),
    }
    raw[i] = edge
    // A radial cubic genuinely LEAVES the union of its endpoint rects — unlike
    // the horizontal S-curve, whose controls share their endpoints' y. Miss
    // this and fitToViewBox clips connectors at the drawing's own margin.
    see(edge.c1x, edge.c1y)
    see(edge.c2x, edge.c2y)
    see(edge.sx, edge.sy)
    see(edge.ex, edge.ey)

    // The chevron anchor, 9 units past this node's own edge along its ray. It
    // is unioned into the bounds as well — a superset of what the contract
    // requires, and the difference between a chevron that is drawn and one that
    // is clipped at the drawing's own margin. NOTE for the renderer: an OUTSIDE
    // LABEL sits further out still, and its extent is a text measurement this
    // module is forbidden to make — it lives inside the fit's padding.
    const tip = eTip + CHEVRON_GAP
    const ox = tip * Math.cos(thetaC)
    const oy = tip * Math.sin(thetaC)
    outLocal[i] = { x: node.width / 2 + ox, y: node.height / 2 + oy }
    see(cx[i] + ox, cy[i] + oy)
  }

  // ── PAD THE BOUNDS SYMMETRICALLY ABOUT THE HUB ──────────────────────────
  // The single most important statement in this file for the Arabic guarantee.
  // The mirror reflects about the bounds' centre line; a circular drawing's
  // bounding box is not centred on its root, so without this the root drifts a
  // few units and `rtl` stops being the exact reflection of `ltr`.
  const spanX = Math.max(finiteOr(Math.abs(minX), 0), finiteOr(Math.abs(maxX), 0))
  const spanY = Math.max(finiteOr(Math.abs(minY), 0), finiteOr(Math.abs(maxY), 0))
  const hubX = spanX
  const hubY = spanY
  const width = 2 * spanX
  const height = 2 * spanY
  const bounds: Bounds = { minX: 0, minY: 0, maxX: width, maxY: height, width, height }

  // The mirror. Reflecting the CENTRE about `hubX` (rather than the corner about
  // the drawing) is the same reflection written so that the hub is its own fixed
  // point EXACTLY — `hubX - 0 === hubX + 0` — which is what makes `root.x`
  // byte-identical in both directions rather than identical to nine places.
  const rtl = opts.direction === 'rtl'
  const px = (x: number): number => (rtl ? hubX - x : hubX + x)
  const py = (y: number): number => hubY + y

  const nodes: PositionedNode<N>[] = []
  const byId = new Map<string, PositionedNode<N>>()
  const edges: MindtreeEdge[] = []

  for (let i = 0; i < count; i += 1) {
    const node = work[i]
    const local = outLocal[i]
    const positioned: PositionedNode<N> = {
      id: node.id,
      node: node.source,
      depth: node.depth,
      x: px(cx[i]) - node.width / 2,
      y: py(cy[i]) - node.height / 2,
      width: node.width,
      height: node.height,
      parentId: node.parent === null ? null : node.parent.id,
      childIds: node.children.map((c) => c.id),
      index: node.index,
      siblingCount: node.parent === null ? 1 : node.parent.children.length,
      hasChildren: node.children.length > 0 || node.hiddenChildCount > 0,
      hasHiddenChildren: node.hiddenChildCount > 0,
      hiddenChildCount: node.hiddenChildCount,
      collapsed: node.source.collapsed === true,
      // Mirrored HERE, against the node's own width, so the renderer does no
      // direction arithmetic at all: reflecting the node's box about the hub
      // and reflecting a point inside that box about the box's centre are the
      // same operation, and this is the cheaper half.
      ...(local === null
        ? {}
        : { outward: { x: rtl ? node.width - local.x : local.x, y: local.y } }),
    }
    nodes.push(positioned)
    byId.set(positioned.id, positioned)

    const edge = raw[i]
    if (edge !== null && node.parent !== null) {
      edges.push({
        id: `${node.parent.id}->${node.id}`,
        parentId: node.parent.id,
        childId: node.id,
        depth: node.depth,
        start: { x: px(edge.sx), y: py(edge.sy) },
        end: { x: px(edge.ex), y: py(edge.ey) },
        c1: { x: px(edge.c1x), y: py(edge.c1y) },
        c2: { x: px(edge.c2x), y: py(edge.c2y) },
      })
    }
  }

  return {
    nodes,
    byId,
    edges,
    bounds,
    maxDepth,
    options: opts,
    rings,
    hub: { x: hubX, y: hubY },
  }
}

/**
 * The angular partition on its own, keyed by node id.
 *
 * A DEPARTURE from the four exports the contract names, and a deliberate one:
 * `Σ child wedges === parent wedge` and `wedge ∝ slots` are the two invariants
 * the returned GEOMETRY cannot show — a bearing recovered from a centre through
 * `atan2` has already been through `cos`, `sin` and a division, so an equality
 * about the partition would degrade into an approximation about trigonometry.
 * The alternative was to assert the weaker thing, and the partition is where the
 * packing lives.
 */
export function radialWedges<N extends LayoutInputNode>(
  root: N,
  options: RadialOptions<N> = {},
): ReadonlyMap<string, RadialWedge> {
  const opts = resolveLayoutOptions(options)
  const work = buildLayoutNodes(root, opts, options.sizeOf)
  const angles = partitionAngles(work, resolveSweep(options.sweep), finiteOr(options.startAngle, 0))
  const out = new Map<string, RadialWedge>()
  for (let i = 0; i < work.length; i += 1) {
    out.set(work[i].id, {
      slots: angles.slots[i],
      start: angles.start[i],
      end: angles.end[i],
      bearing: angles.bearing[i],
    })
  }
  return out
}

// ── the ring rule ──────────────────────────────────────────────────────────

/**
 * The node size for a given ring.
 *
 * Ring 1 is the base; ring 2 is narrower; ring 3 and beyond narrower still —
 * because radial area grows QUADRATICALLY with the ring and the outer rings are
 * where a workspace runs out of screen. Nothing ever goes below 44: that is
 * WCAG 2.5.8's target floor and the number the fit's own `minScale` is derived
 * from, so a ring rule that undercut it would be sizing a control below the
 * threshold the rest of the app is held to.
 *
 * `chip` MAKES IT A 44×44 COUNT CHIP, and the guard is the BAND — not the phone.
 * The label is then drawn OUTSIDE the box by the renderer, which is the whole
 * mechanism that keeps the words on a 375px phone: nine tracks at 132×44 need a
 * radius of 213 and a 558-unit drawing into 359px — a scale of 0.64, which
 * renders the 12.5px label at 8.0px. At 44×44 the same ring is 103 and the
 * drawing fits with headroom. That mechanism was measured on a phone and is true
 * at every width, so MAP-ZOOM §4 promotes it: the CHIP band asks for it by
 * apparent size and the caller passes `chip`, which is the same 44×44 answer for
 * a reason that is about legibility rather than about a device.
 *
 * THE `compact` ALIAS IS GONE. It was the phone-only spelling — "the outermost
 * drawn ring" — kept alive for exactly one caller while `useMapGeometry.ts` was
 * being rewritten around the camera. That rewrite landed, the camera asks by
 * APPARENT SIZE rather than by device, and the last call site went with it. The
 * deprecation note said the field and its branch come out in one edit; this is
 * that edit — and `outermostDepth` went with it, because the alias was the only
 * thing that ever read it. The rule is now what it always meant: ring 1 keeps
 * the base, ring 2 narrows, ring 3+ narrows again, and CHIP overrides all three.
 */
export function ringNodeSize(
  depth: number,
  options: {
    base: NodeSize
    /** The band said CHIP. Set by U2's level-of-detail module. */
    chip?: boolean
  },
): NodeSize {
  const baseWidth = Math.max(MIN_TARGET_PX, finiteOr(options.base?.width, MIN_TARGET_PX))
  const baseHeight = Math.max(MIN_TARGET_PX, finiteOr(options.base?.height, MIN_TARGET_PX))
  const ring = Math.floor(finiteOr(depth, 0))
  const chip = options.chip === true

  // Never the hub: the root of a world is the one node whose size is not a ring
  // rule's to decide.
  if (chip && ring >= 1) {
    return { width: MIN_TARGET_PX, height: MIN_TARGET_PX }
  }
  if (ring <= 1) return { width: baseWidth, height: baseHeight }
  // `min`, never `max`: the ring rule may only NARROW a base the caller already
  // chose — a phone that asked for 108 does not get widened to 132 by ring 2.
  const target = ring === 2 ? RING_2_WIDTH : RING_3_WIDTH
  return { width: Math.max(MIN_TARGET_PX, Math.min(baseWidth, target)), height: baseHeight }
}

/**
 * THE DEPTH CAP, MEASURED RATHER THAN TABULATED.
 *
 * Returns the largest depth limit in [1, maxDepth] whose bounds still fit the
 * viewport at `minScale` or better, walking upward and stopping at the first
 * failure. Radial area grows QUADRATICALLY, and the measured budget on a
 * 1576×835 stage at 168×44 with the ring rule is harsher than the design note's
 * worked example claimed:
 *
 *   nine tracks × five buckets  ring 1 r 271 at scale 1.00 · ring 2 (45 nodes)
 *                               r 1083 at scale 0.37 — REJECTED at a 24/44 floor
 *   three programmes × four     ring 1 r 230 at scale 1.00 · ring 2 (12 nodes)
 *   phases × six organizations  r 442 at scale 0.86 — drawn · ring 3 (72 nodes)
 *                               r 1474 at scale 0.27 — rejected
 *
 * Forty-five boxes 132 wide with a 12-unit gap need 6,795 units of
 * circumference whichever closed form is used, which is a radius of 1,082 — so
 * the honest desktop budget is root + ONE ring at a wide fan-out and root + TWO
 * once the second ring holds roughly twenty nodes or fewer. A fixed table cannot
 * tell those two workspaces apart; this can, at a cost of at most `maxDepth`
 * extra layouts, and it short-circuits at the first ring that does not fit.
 *
 * RING 1 IS UNCONDITIONAL and is never measured: a map that draws no ring is not
 * a map, and the honest response to "even the first ring does not fit" is a
 * cramped first ring, not an empty canvas.
 */
export function ringsThatFit(options: {
  boundsAt: (depthLimit: number) => Bounds
  viewport: Viewport
  padding: number
  minScale: number
  maxDepth: number
}): number {
  const cap = Math.max(1, Math.floor(finiteOr(options.maxDepth, 1)))
  const padding = Math.max(0, finiteOr(options.padding, 0))
  const floor = Math.max(0, finiteOr(options.minScale, 0))
  const viewWidth = Math.max(1, finiteOr(options.viewport?.width, 1))
  const viewHeight = Math.max(1, finiteOr(options.viewport?.height, 1))

  let best = 1
  for (let limit = 2; limit <= cap; limit += 1) {
    const bounds = options.boundsAt(limit)
    // The same arithmetic fitToViewBox does, so "fits" here and "fits" there
    // cannot disagree: pad both axes, floor the content at one unit, take the
    // binding axis.
    const contentWidth = Math.max(finiteOr(bounds?.width, 0) + padding * 2, 1)
    const contentHeight = Math.max(finiteOr(bounds?.height, 0) + padding * 2, 1)
    const scale = Math.min(viewWidth / contentWidth, viewHeight / contentHeight)
    if (!Number.isFinite(scale) || scale <= 0 || scale < floor) break
    best = limit
  }
  return best
}

// ── 2. angle ───────────────────────────────────────────────────────────────

interface AngularPartition {
  readonly slots: number[]
  readonly start: number[]
  readonly end: number[]
  readonly bearing: number[]
}

/**
 * Every node's wedge, in the `work` array's own index space.
 *
 * SLOTS, NOT EQUAL SHARES. A subtree's slot count is the number of leaves it
 * ends up drawing at the deepest ring, and children divide their parent's wedge
 * in that proportion — the polar translation of the contour packing the column
 * layout does along y. Give three tracks equal thirds when one of them holds
 * forty entries and the forty share a third of the circle while three share the
 * rest.
 *
 * BOUNDARIES ARE SHARED, NOT ACCUMULATED. Each child's `end` IS the next
 * child's `start` (the same float, written twice), and the last child's `end` IS
 * the parent's own `end`, written rather than summed. That makes "the children
 * exactly tile the parent" a fact about the numbers instead of a hope about the
 * rounding — a telescoping sum of float differences is not exact, but a chain of
 * shared endpoints is.
 */
function partitionAngles<N extends LayoutInputNode>(
  work: LayoutWorkNode<N>[],
  sweep: number,
  startAngle: number,
): AngularPartition {
  const count = work.length
  const indexOf = new Map<string, number>()
  for (let i = 0; i < count; i += 1) indexOf.set(work[i].id, i)

  // Pre-order puts every child AFTER its parent, so one reverse pass is a
  // complete post-order accumulation.
  const slots: number[] = new Array<number>(count).fill(1)
  for (let i = count - 1; i >= 0; i -= 1) {
    const kids = work[i].children
    if (kids.length === 0) continue
    let total = 0
    for (const kid of kids) total += slots[indexOf.get(kid.id) as number]
    slots[i] = total
  }

  const start: number[] = new Array<number>(count).fill(0)
  const end: number[] = new Array<number>(count).fill(0)
  end[0] = sweep
  for (let i = 0; i < count; i += 1) {
    const kids = work[i].children
    if (kids.length === 0) continue
    const from = start[i]
    const span = end[i] - from
    const total = slots[i]
    let cursor = from
    let cumulative = 0
    for (let k = 0; k < kids.length; k += 1) {
      const ci = indexOf.get(kids[k].id) as number
      cumulative += slots[ci]
      const to = k === kids.length - 1 ? end[i] : from + (span * cumulative) / total
      start[ci] = cursor
      end[ci] = to
      cursor = to
    }
  }

  const bearing: number[] = new Array<number>(count).fill(0)
  for (let i = 0; i < count; i += 1) bearing[i] = (start[i] + end[i]) / 2

  // ROTATE so the FIRST CHILD lands exactly on `startAngle` — the option says
  // "bearing of the first child", and a wedge midpoint is not a wedge edge. One
  // constant added to every angle preserves the shared-boundary chain exactly.
  const first = work[0].children[0]
  const rotation =
    first === undefined ? startAngle : startAngle - bearing[indexOf.get(first.id) as number]
  for (let i = 0; i < count; i += 1) {
    start[i] += rotation
    end[i] += rotation
    bearing[i] += rotation
  }

  return { slots, start, end, bearing }
}

// ── 3. radius ──────────────────────────────────────────────────────────────

/**
 * Ring radii by depth, hub-relative. `rings[0]` is 0: the hub is its own ring.
 *
 * Three constraints, and the largest wins:
 *   PITCH   r_d ≥ r_{d−1} + maxDiag_{d−1}/2 + maxDiag_d/2 + gap.depth. Every box
 *           on ring d−1 lies inside a disc of radius maxDiag_{d−1}/2 about its
 *           centre, so this is exactly "the outermost point of ring d−1 is
 *           inside the innermost point of ring d" — NO AABB OVERLAP ACROSS
 *           DEPTHS, by construction rather than by inspection.
 *   CHORD   r ≥ (diag_i/2 + diag_j/2 + gap.sibling) / (2·sin(Δθ_ij/2)) for every
 *           pair close enough in angle to matter.
 *   ARC     r ≥ Σ(diag + gap.sibling)/sweep — the plan's original closed form,
 *           kept as the GUARD for the case the chord form cannot express: when
 *           Δθ collapses toward zero the chord bound divides by it. It is not a
 *           competitor: 2·sin(x/2) ≤ x makes the chord bound at least the arc
 *           bound for equal boxes at every angle, and no fixture in
 *           radial.test.ts is decided by this term. It is here so that a
 *           degenerate ring returns a number instead of an Infinity.
 *
 * WHY ADJACENT PAIRS ARE NOT ENOUGH, and what the second pass is for. The
 * minimum-CHORD pair on a ring is always circularly adjacent, but the minimum
 * REQUIREMENT pair need not be: two wide boxes either side of a 44×44 count chip
 * sit at twice the chip's angular step, and twice a small angle buys less than
 * twice the chord. So after the adjacent pass sets a radius, every pair within
 * the angular cutoff that radius makes possible is checked exactly. Beyond the
 * cutoff no pair can be too close whatever its size, so the pass is near-linear
 * — with uniform boxes the cutoff is about two angular steps wide — and it runs
 * ONCE, because raising the radius only ever makes more pairs safe.
 *
 * STATED HONESTLY: the second pass is a GUARANTEE, not a mechanism. Deleting it
 * fails no test in radial.test.ts, because at the small angles where the
 * size-ratio effect is possible `sin` is nearly linear (twice the angle really
 * is nearly twice the chord) and at the large angles where it is not, the pitch
 * already dominates. It is kept because the disc invariant this file's header
 * claims — EVERY pair on a ring is disc-separated — is only proved for adjacent
 * pairs without it, and an invariant that holds by coincidence of the fixtures
 * is not an invariant. The two passes deliberately overlap: the first is the
 * only chord source when a ring holds exactly two nodes, and its radius is what
 * makes the second pass's cutoff narrow enough to be near-linear.
 */
function ringRadii(input: {
  ringOf: number[][]
  diag: number[]
  maxDiag: number[]
  bearing: number[]
  sweep: number
  gap: { depth: number; sibling: number }
  maxDepth: number
}): number[] {
  const { ringOf, diag, maxDiag, bearing, sweep, gap, maxDepth } = input
  const radii: number[] = new Array<number>(maxDepth + 1).fill(0)

  for (let d = 1; d <= maxDepth; d += 1) {
    const ring = ringOf[d]
      .slice()
      .sort((a, b) => normalizeAngle(bearing[a]) - normalizeAngle(bearing[b]) || a - b)
    const angles = ring.map((i) => normalizeAngle(bearing[i]))

    const r = ringRadius({
      diag: ring.map((i) => diag[i]),
      angles,
      gap: gap.sibling,
      sweep,
      // PITCH: every box on ring d−1 lies inside a disc of maxDiag/2 about its
      // centre, so this seed IS "the outermost point of ring d−1 is inside the
      // innermost point of ring d".
      seed: radii[d - 1] + maxDiag[d - 1] / 2 + maxDiag[d] / 2 + gap.depth,
    })

    radii[d] = Number.isFinite(r) ? r : radii[d - 1]
  }
  return radii
}

/**
 * THE RING RULE ITSELF, on one ring, shared by the concentric layout above and
 * by `packRing` below — the arc guard, the adjacent-pair chord pass and the
 * exact-pair second pass, in that order, taking the largest.
 *
 * `seed` is the constraint that arrives from outside the ring: the PITCH off the
 * previous ring for `ringRadii`, and nothing (0) for a containment pack, where
 * there is no previous ring to clear. Everything else is identical, and it is
 * shared rather than copied for the reason `buildLayoutNodes` is shared — two
 * copies of a packing rule is two packing rules, one edit apart.
 *
 * `diag` and `angles` are in RING ORDER (ascending bearing); `angles` are
 * normalised into [0, 2π).
 */
function ringRadius(input: {
  readonly diag: readonly number[]
  readonly angles: readonly number[]
  readonly gap: number
  readonly sweep: number
  readonly seed: number
}): number {
  const { diag, angles, gap, sweep, seed } = input
  const n = diag.length
  let r = seed

  // The arc bound. Dominated by the chord bound at every angle it can be
  // compared at — it earns its place as the answer for a ring whose angular
  // steps have collapsed below EPS_ANGLE, where the chord form returns 0.
  let arcDemand = 0
  let widest = 0
  for (let k = 0; k < n; k += 1) {
    arcDemand += diag[k] + gap
    if (diag[k] > widest) widest = diag[k]
  }
  const arc = arcDemand / sweep
  if (Number.isFinite(arc) && arc > r) r = arc

  if (n >= 2) {
    for (let k = 0; k < n; k += 1) {
      const j = (k + 1) % n
      const need = chordRadius(diag[k], diag[j], angularDistance(angles[k], angles[j]), gap)
      if (need > r) r = need
    }
  }

  if (n >= 3 && r > 0) {
    // The widest requirement any pair on this ring can present, and therefore
    // the angle beyond which no pair can be too close at radius `r`.
    const worst = widest + gap
    const cutoff = 2 * Math.asin(Math.min(1, worst / (2 * r)))
    for (let k = 0; k < n; k += 1) {
      for (let step = 1; step < n; step += 1) {
        const m = (k + step) % n
        // Forward arcs increase monotonically with `step`, so the first one past
        // the cutoff ends the scan. Every pair whose SHORT way round is inside
        // the cutoff is reached from one of its two endpoints.
        const forward = forwardArc(angles[k], angles[m])
        if (forward > cutoff) break
        const need = chordRadius(diag[k], diag[m], forward, gap)
        if (need > r) r = need
      }
    }
  }

  return r
}

// ── the containment pack ───────────────────────────────────────────────────

/**
 * Pack `n` child worlds on a ring INSIDE a parent world. The chord form, applied
 * INWARD — the arithmetic MAP-ZOOM §2's recursive containment is made of.
 *
 * Returns the ring's radius, one bearing per child in the order they were given
 * (ascending from 0, so the ring order IS the child order), and the diameter the
 * parent's world must have to hold the ring with its rim clear.
 *
 * THE WEDGE IS PROPORTIONAL TO THE CHILD'S OWN DIAMETER, which is the polar
 * translation of `partitionAngles`' slot rule for a drawing whose sizes are
 * already demand-driven: a world twice as wide needs twice the angle, and giving
 * every child an equal step would push the radius out by the widest one and
 * leave the narrow ones adrift in the space it bought.
 *
 * ⚠ THE PAIR CONSTRAINT IS `(D_i + D_j)/2 + gap`, NOT `D_child/2 + gap`, AND THE
 * DIFFERENCE IS THE WHOLE INVARIANT. MAP-ZOOM §11 states the ring formula as
 * `r = (D_child/2 + gap) / (2·sin(π/n))` two paragraphs after stating the pair
 * constraint correctly as `r ≥ (diag_i/2 + diag_j/2 + gap)/(2·sin(Δθ/2))`. The
 * two disagree by exactly one child radius, and the shorter one OVERLAPS: at the
 * commonest fan-out on this screen, n = 6, it puts adjacent centres 0.68·D apart
 * where two discs of diameter D need 1.18·D to be clear of each other — a 32%
 * interpenetration of every pair of sibling worlds, which is the same failure the
 * chord-not-arc correction was written to prevent, one step further in. The pair
 * constraint is the one implemented. The measured cost is stated where the
 * numbers are: worlds.ts's header.
 */
export function packRing(input: {
  readonly childD: readonly number[]
  readonly gap: number
}): {
  readonly radius: number
  readonly bearings: readonly number[]
  readonly parentD: number
  /**
   * The n+1 WEDGE BOUNDARIES, ascending from 0 to exactly 2π. `edges[k]` and
   * `edges[k+1]` bracket child k, and `edges[k+1]` is ONE float read twice — as
   * the end of k and as the start of k+1 — which is what makes the partition
   * exact rather than exact-to-rounding.
   *
   * A DEPARTURE from the three fields MAP-ZOOM §11 names, and a small one: a
   * bearing is a wedge's midpoint and a midpoint cannot be turned back into a
   * wedge when the wedges are unequal — and they are unequal here, because the
   * angle is proportional to the child's own diameter. MAP-ZOOM §4's MATCH RIM
   * is an arc over a CHILD'S WEDGE on its parent's rim, so the boundaries have
   * to leave this function or be rebuilt from its rule somewhere else, and a
   * packing rule with two implementations is two packing rules.
   */
  readonly edges: readonly number[]
} {
  const given = input?.childD ?? []
  const n = given.length
  const gap = Math.max(0, finiteOr(input?.gap, 0))

  // n = 0 — a leaf's world is the authored unit and owes nothing to a ring.
  if (n === 0) return { radius: 0, bearings: [], parentD: D_LEAF, edges: [0] }

  const d: number[] = new Array<number>(n)
  let total = 0
  let widest = 0
  for (let k = 0; k < n; k += 1) {
    const v = Math.max(EPS_SIZE, finiteOr(given[k], D_LEAF))
    d[k] = v
    total += v
    if (v > widest) widest = v
  }

  // n = 1 — no pair to separate, so the ratio is authored. The radius is then
  // the one that leaves the SAME rim margin the general case leaves:
  // r + D/2 === parentD / (2·RIM).
  if (n === 1) {
    const parentD = d[0] * SINGLE_CHILD_RATIO
    return { radius: parentD / (2 * RIM) - d[0] / 2, bearings: [0], parentD, edges: [0, TAU] }
  }

  // BOUNDARIES ARE SHARED, NOT ACCUMULATED — `edges[k+1]` is written once and
  // read as both the end of child k and the start of child k+1, and the last
  // edge is WRITTEN as a full turn rather than summed to one. That is what makes
  // "the children exactly tile the circle" a fact about the floats rather than a
  // hope about the rounding.
  const edges: number[] = new Array<number>(n + 1)
  edges[0] = 0
  edges[n] = TAU
  const uniform = !(total > 0) || !Number.isFinite(total)
  let cumulative = 0
  for (let k = 0; k < n - 1; k += 1) {
    cumulative += d[k]
    edges[k + 1] = uniform ? (TAU * (k + 1)) / n : (TAU * cumulative) / total
  }

  const bearings: number[] = new Array<number>(n)
  const angles: number[] = new Array<number>(n)
  for (let k = 0; k < n; k += 1) {
    bearings[k] = (edges[k] + edges[k + 1]) / 2
    angles[k] = normalizeAngle(bearings[k])
  }

  const radius = ringRadius({ diag: d, angles, gap, sweep: TAU, seed: 0 })
  const safeRadius = Number.isFinite(radius) && radius > 0 ? radius : widest
  // The rim: the ring's outer extent, inflated so the parent's boundary is clear
  // of every child's. Every child world therefore reaches at most
  // parentD/(2·RIM) < parentD/2 from the hub — containment, by construction.
  const parentD = 2 * (safeRadius + widest / 2) * RIM

  return { radius: safeRadius, bearings, parentD, edges }
}

/**
 * The radius at which two boxes Δθ apart on the same ring are clear of each
 * other — the CHORD form. Returns 0 when the angle is too small to divide by;
 * the ring's arc bound is what covers that case.
 */
function chordRadius(diagI: number, diagJ: number, delta: number, gapSibling: number): number {
  if (!(delta >= EPS_ANGLE)) return 0
  const half = Math.sin(delta / 2)
  if (!(half > 0)) return 0
  return (diagI / 2 + diagJ / 2 + gapSibling) / (2 * half)
}

// ── geometry helpers ───────────────────────────────────────────────────────

interface RawEdge {
  sx: number
  sy: number
  ex: number
  ey: number
  c1x: number
  c1y: number
  c2x: number
  c2y: number
}

/**
 * How far a box's own edge is from its centre along the bearing θ — the support
 * function of an axis-aligned rectangle. `min` of the two axis crossings, each
 * dropped when the ray is parallel to that pair of edges and the division would
 * blow up.
 */
function supportRadius(halfWidth: number, halfHeight: number, theta: number): number {
  const cos = Math.abs(Math.cos(theta))
  const sin = Math.abs(Math.sin(theta))
  let t = Number.POSITIVE_INFINITY
  if (cos >= EPS_AXIS) t = Math.min(t, halfWidth / cos)
  if (sin >= EPS_AXIS) t = Math.min(t, halfHeight / sin)
  return Number.isFinite(t) ? t : halfWidth
}

/** The short way round, in [0, π]. */
function angularDistance(a: number, b: number): number {
  const raw = Math.abs((a - b) % TAU)
  return Math.min(raw, TAU - raw)
}

/** The way round that goes forward from `a`, in [0, 2π). */
function forwardArc(a: number, b: number): number {
  return ((b - a) % TAU + TAU) % TAU
}

function normalizeAngle(a: number): number {
  if (!Number.isFinite(a)) return 0
  return ((a % TAU) + TAU) % TAU
}

/**
 * A sweep of 2π unless the caller asked for a smaller positive one. Wider than a
 * full turn is silently a full turn: overlapping the drawing with itself is not
 * a layout anybody wants and it is not worth a throw in a render path.
 */
function resolveSweep(sweep: number | undefined): number {
  if (typeof sweep !== 'number' || !Number.isFinite(sweep) || sweep <= 0) return TAU
  return Math.min(sweep, TAU)
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
