// The Mindtree's geometry, and nothing else.
//
// Types in, coordinates out. Nothing here imports React, a store, an api, i18n
// or the DOM — the same rule lib/entryFilter.ts and lib/dnd.ts are written to,
// for the same reason: a layout that can only be exercised by mounting a page is
// a layout nobody tests, and this one has to hold six invariants at once (no
// overlaps, stable output, collapsed branches costing nothing, a clean depth
// truncation, an exact RTL mirror, and no NaN at any input). Every one of those
// is a plain assertion about the return value of a pure function.
//
// WHY A TIDY TREE AND NOT A FORCE SIMULATION. MINDTREE-SPEC bans the simulation
// outright and the ban is not aesthetic. A force layout settles somewhere
// slightly different on every render, so nothing about it can be asserted, the
// screen reader's tree order stops matching the picture, and "copy for a deck"
// exports a different image than the one on screen. Reingold–Tilford row packing
// is a function: the same tree produces the same picture, this frame and next
// week's, in Chrome and in the SVG file.
//
// THE ALGORITHM, in the shape this file implements it:
//   1. BUILD    walk the source tree into a working array in PRE-ORDER, applying
//               the two reasons a child does not get laid out at all — the
//               parent is collapsed, or the depth limit stops here. Pre-order is
//               also the order `role="tree"` wants its DOM in, so the renderer
//               maps `nodes` straight out.
//  1b. TRANSPOSE for the vertical orientation only: every node's width and
//               height are swapped, once, on the way in. See below.
//   2. COLUMNS  the depth coordinate is a function of DEPTH ONLY. Every node at
//               depth d starts at the same offset, and the column is as wide as
//               its widest node. Nodes are size-encoded (count → area, clamped),
//               so without a column the ring would ripple and the eye would lose
//               the ring structure that is the whole point of the picture.
//   3. PACK     the sibling coordinate comes from a post-order pass with
//               CONTOURS. Each subtree reports the leading and trailing edge it
//               occupies at every one of its rows; the next sibling is pushed
//               along by exactly enough to clear that contour at every shared
//               row, and no further. That is what makes a tidy tree tidy: a deep
//               bushy branch pushes its neighbour aside only at the rows where
//               the two actually meet. A parent then sits centred between its
//               first and last child.
//  2'+3'. BLOCKS  under `wrap: true`, steps 2 and 3 are replaced wholesale by
//               packBlocks(): every subtree is measured into a box and every box
//               is placed in its parent's grid. See that function's header for
//               what wrapping costs and why it is a different engine rather than
//               a decoration on the contour packer.
//   4. RESOLVE  local frames are collapsed into absolute coordinates, the whole
//               drawing is normalised to origin (0,0), transposed back to screen
//               space if it was transposed on the way in, and — if the reader is
//               in Arabic — mirrored.
//
// THE VERTICAL DRAWING IS THE HORIZONTAL ONE REFLECTED ABOUT y = x, AND THAT IS
// ALL IT IS. Steps 2, 3 and 4 above are already written in axis-neutral terms
// without ever having been told: step 2 puts DEPTH on local x using a node's
// local width, step 3 packs SIBLINGS on local y using a node's local height. So
// "layout space" is defined here, for both orientations, as
//
//     local x = the DEPTH axis      local y = the SIBLING axis
//
// and the top-down drawing is bought by swapping each node's size once on the
// way in and swapping every coordinate back once on the way out. `pack()`, the
// column pass, the frame resolution, the normalisation and the mirror are then
// literally the same code running on the same numbers — there is no `if
// (vertical)` anywhere between the transpose and the emit, no second copy of the
// packing to keep in step, and "vertical is the transpose of horizontal" is a
// theorem the test suite can assert against the frozen horizontal numbers rather
// than a coincidence a second snapshot would have to be maintained to protect.
//
// RTL IS A MIRROR, APPLIED ONCE, AT THE END. SVG has no logical properties (see
// components/charts/geometry.ts's header for the same problem in the charts), so
// direction has to be an input somewhere. It is an input to exactly one
// statement in this file: the finished picture is reflected about its own
// vertical centre line — THE SCREEN's x axis, always. Which LOGICAL axis that
// turns out to be follows from the orientation and is not something the mirror
// knows or should know: it is the depth axis when depth runs horizontally, and
// the sibling axis when depth runs vertically. Either way it is what an Arabic
// reader means by "mirrored", and either way nothing in the packing knows which
// direction the reader reads, which is why `mirror symmetry` is assertable as an
// equality rather than as a second, hand-checked layout. The one thing that
// would break it is a flip applied inside layout space; do not move it there.
//
// COMPLEXITY is O(n · depth) in the worst case, and the depth here is the ring
// model: workspace → track → group → entry. The contour merge only ever walks
// the rows the incoming subtree actually occupies, so a thousand leaves under a
// handful of tracks — the shape the 1000-row clamp actually produces — is a
// thousand single-row merges. layout.test.ts holds the timing to a budget.
//
// NO COLOUR, NO LABELS, NO COUNTS. This module never decides how big a node is.
// A size arrives one of three ways — the caller's `sizeOf` callback, a `size` on
// the node itself, or the `nodeSize` default — and MINDTREE-SPEC's "node size
// encodes count (area, clamped)" is a `sizeOf` the caller supplies. sizeForCount()
// at the foot of this file is the arithmetic for that encoding, offered because
// it is geometry; choosing to use it is the renderer's call, not this module's.

/** LTR grows toward the right; RTL is the same drawing, mirrored. */
export type Direction = 'ltr' | 'rtl'

/**
 * Which screen axis DEPTH runs along.
 *
 * 'horizontal' — depth to the inline end, siblings down the block axis — is the
 * drawing this file has always made and the only one any existing caller asks
 * for, which is why it is the absent default rather than a written one. See the
 * transpose note in layoutMindtree for why adding the second orientation cost
 * one pass and four ternaries instead of a second packing algorithm.
 */
export type Orientation = 'horizontal' | 'vertical'

export interface NodeSize {
  width: number
  height: number
}

export interface Point {
  readonly x: number
  readonly y: number
}

/**
 * THE INPUT CONTRACT — the only four fields the geometry reads.
 *
 * Declared here rather than imported from model.ts on purpose: layout is the
 * lower layer and must not depend on the semantics above it. `MindNode` carries
 * a kind, a label, a count, a track id, an SLA-breach mark and whatever else the
 * picture needs; none of that changes where a rectangle goes, and a layout that
 * imported the full model could not be tested without building one.
 *
 * It is a STRUCTURAL contract, not a nominal one: model.ts's `MindNode` already
 * satisfies it (`id`, `children`, `collapsed`), so `layoutMindtree(root)` takes
 * the model tree as it stands. Every function here is generic over the payload,
 * so the renderer gets its own node type back out — `positioned.node.count`,
 * fully typed, with no cast anywhere.
 */
export interface LayoutInputNode {
  readonly id: string
  /** Absent and empty mean the same thing: a leaf. */
  readonly children?: readonly LayoutInputNode[]
  /**
   * Collapsed keeps the children in the model and out of the drawing — the same
   * rule model.ts's `visibleChildren()` states for renderers, applied here so a
   * collapsed branch costs no space. Restated rather than imported because the
   * layering forbids the import; layout.test.ts pins the behaviour.
   */
  readonly collapsed?: boolean
  /** A size the caller stapled on. Most callers use `sizeOf` instead and leave
   *  their model tree alone. */
  readonly size?: NodeSize
}

export interface Gap {
  /**
   * Between one ring and the next, along the DEPTH axis — the inline axis in the
   * horizontal orientation, the block axis in the vertical one. In a wrapped
   * block it is also the clearance between one row of the block and the next,
   * because a row boundary inside a block is a boundary along the depth axis and
   * nothing else: the row below starts a fresh set of rings.
   */
  depth: number
  /**
   * The minimum clearance between two nodes sharing a row — i.e. along the
   * SIBLING axis. In a wrapped block it is also the clearance between one column
   * of the block and the next, for the mirror-image reason.
   */
  sibling: number
  /**
   * The clearance between two sibling cells WHEN THOSE CELLS ARE THEMSELVES
   * BLOCKS rather than single rectangles. Defaults to three times `sibling`.
   *
   * WHY THIS EXISTS, measured. With one gap doing both jobs, a parent's eleven
   * cards sat `sibling` apart from each other AND its whole eleven-card grid sat
   * `sibling` apart from the next parent's. Eleven cards and six grids then read
   * as one continuous band: you could see rows, and you could not see which
   * parent any row belonged to. The hierarchy was present in the coordinates and
   * absent from the picture.
   *
   * Proximity is the only cue a grid has for grouping — there are no containers
   * and no rules between blocks — so the gap between groups has to be visibly
   * larger than the gap inside one, or there are no groups. This is the number
   * that makes the drawing say what the tree means.
   */
  group?: number
  /**
   * The clearance between two ROWS of one wrapped block. Defaults to
   * `sibling * 1.6`.
   *
   * Explicitly NOT `depth`: the rows of a block are the same generation as each
   * other, and spacing them like parent-to-child tears one block into stripes.
   */
  row?: number
}

export interface LayoutOptions<N extends LayoutInputNode = LayoutInputNode> {
  nodeSize?: Partial<NodeSize>
  gap?: Partial<Gap>
  /**
   * Per-node size, computed from the node.
   *
   * A callback rather than a required `size` field on the model, because the
   * model tree is the same tree the accessible table and the keyboard walk read
   * — rebuilding a parallel copy of it just to staple a width on would be a
   * second source of truth for what the tree contains. MUST BE PURE: it is
   * called once per node per layout, and a `sizeOf` that consulted a clock or a
   * random would take determinism down with it.
   *
   * Returning undefined (or a partial size) falls through to the node's own
   * `size`, then to `nodeSize`.
   */
  sizeOf?: (node: N, depth: number) => Partial<NodeSize> | undefined
  /**
   * The deepest ring to lay out, root = 0. Children of a node AT the limit are
   * not drawn and the node is marked `hasHiddenChildren` — which is exactly the
   * mobile rendering MINDTREE-SPEC asks for (`depthLimit: 2` = workspace +
   * tracks + the group ring). Defaults to no limit.
   */
  depthLimit?: number
  direction?: Direction
  /**
   * Which way the tree grows. 'horizontal' (the default) puts depth on x and
   * spreads siblings down y; 'vertical' puts depth on y and spreads siblings
   * across x. It is the SAME drawing reflected about y = x — see the transpose
   * in layoutMindtree — so every invariant this file holds holds in both, and
   * layout.test.ts asserts the vertical drawing by composing the frozen
   * horizontal numbers rather than freezing a second set to rot beside them.
   *
   * Read by layoutMindtree only. The polar and containment layouts have their
   * own geometry and ignore it, exactly as they ignore `expandAll`.
   */
  orientation?: Orientation
  /**
   * Arrange each parent's children as a BLOCK of rows rather than one line.
   *
   * 396 organisations in one row per parent is a canvas thirty-six screens wide,
   * which is a ribbon nobody pans to the end of; the same 396 in a block is two
   * screens across and four down, which is a page you scroll. The cost is stated
   * plainly because it is real: a block consumes the depth axis per row, so the
   * rings stop being globally aligned and the tidy contour tuck is replaced by a
   * uniform grid. That regularity IS the feature — see packBlocks().
   *
   * Off by default, so the existing drawing is untouched.
   */
  wrap?: boolean
  /**
   * Lay out EVERY child, whatever the model says about `collapsed`.
   *
   * The containment layout (worlds.ts) is the only caller, and it is not a
   * preference: MAP-ZOOM §2's one structural claim is that the geometry is a
   * pure function of the tree and the reading direction and of NOTHING ELSE —
   * "not the filter, not the level of detail, not the reader's collapse
   * choices". A world's children are always in the drawing, waiting at their own
   * distance; there is no fold to open. `collapsed` still rides through to
   * `PositionedNode.collapsed` untouched, because `aria-expanded` and the
   * accessible table still mean something by it.
   *
   * Defaults to false, so the linear layout and the concentric one behave at
   * HEAD exactly as they do today.
   */
  expandAll?: boolean
}

export interface ResolvedLayoutOptions {
  nodeSize: NodeSize
  gap: Gap
  depthLimit: number
  direction: Direction
  /** Absent means 'horizontal'. Written only when the caller asked for the other
   *  one, so `layout.options` stays value-for-value what every existing caller
   *  already receives. Read it as `=== 'vertical'`, never as `=== 'horizontal'`. */
  orientation?: Orientation
  /** Absent means false. Same rule, same reason. */
  wrap?: boolean
  /** Only ever set by the containment layout. Absent means false, so the
   *  resolved options of every existing caller are unchanged value-for-value. */
  expandAll?: boolean
}

/**
 * A laid-out node: the rectangle, plus everything the renderer and the
 * `role="tree"` markup need that would otherwise mean a second walk of the model.
 *
 * `x`/`y` are the top / inline-start corner AFTER the RTL mirror, so a component
 * writes them straight into an <svg> transform and never multiplies anything by
 * a direction again.
 */
export interface PositionedNode<N extends LayoutInputNode = LayoutInputNode> {
  readonly id: string
  /** The source node, handed back with its own type — labels, counts, colours. */
  readonly node: N
  /** Root = 0. `aria-level` is this + 1. */
  readonly depth: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly parentId: string | null
  /** Laid-out children only, in order. Empty for a leaf, a collapsed branch, or
   *  a node sitting on the depth limit. */
  readonly childIds: readonly string[]
  /** Position among LAID-OUT siblings — `aria-posinset` is this + 1. */
  readonly index: number
  /** `aria-setsize`. */
  readonly siblingCount: number
  /** True when the model gave this node children, drawn or not — this, not
   *  `childIds.length`, is what decides whether `aria-expanded` belongs on the
   *  element at all. */
  readonly hasChildren: boolean
  /** Children the model has and the drawing does not: collapsed, or past the
   *  depth limit. The "+N more" affordance and the mobile drill-in hang off it. */
  readonly hasHiddenChildren: boolean
  readonly hiddenChildCount: number
  /** The model's own flag, passed through for `aria-expanded`. */
  readonly collapsed: boolean
  /**
   * THE CHEVRON ANCHOR: a point on the ray out of the hub, 9 units beyond this
   * node's own edge, expressed RELATIVE to the node's top / inline-start corner
   * and in the SAME (already-mirrored) space as `x`/`y`.
   *
   * Populated ONLY by radial.ts, where "away from the parent" is a different
   * direction for every node and therefore cannot be a constant in the renderer.
   * The LINEAR layout leaves it undefined and the renderer keeps its own
   * inline-end expression as the fallback, so every existing deep-equality
   * assertion about a linear layout is unaffected.
   */
  readonly outward?: Point
}

/**
 * A connector, as four points. The renderer turns it into a `C` path — see
 * edgePath() — rather than this module emitting a string, so a component is free
 * to draw an elbow instead of a curve without the geometry changing.
 */
export interface MindtreeEdge {
  readonly id: string
  readonly parentId: string
  readonly childId: string
  /** The CHILD's depth, so an edge can be styled per ring. */
  readonly depth: number
  /** On the parent's DEPTH-END face, centred on the sibling axis: the inline-end
   *  edge when depth runs horizontally, the bottom edge when it runs vertically. */
  readonly start: Point
  /** On the child's DEPTH-START face, centred on the sibling axis — the mirror
   *  image of `start`, and the reason a connector meets both cards square-on. */
  readonly end: Point
  readonly c1: Point
  readonly c2: Point
}

export interface Bounds {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
  readonly width: number
  readonly height: number
}

/**
 * WHAT A RENDERER NEEDS FROM A DRAWING — and the exact set, so that the two
 * drawings this app now produces can be handed to the same components.
 *
 * `MindtreeLayout` (the tidy tree and the ring) and `worlds.ts`'s `WorldLayout`
 * (the containment drawing the camera dives through) both satisfy it. The one
 * field they do NOT share is `options`: three suites deep-compare
 * `layout.options` against a resolved-options object, and `layoutWorlds` does
 * not publish one because the reader's collapse choices never reach it. So the
 * shared surface is stated here rather than either shape being widened to meet
 * the other, and every consumer that only paints — `MapCanvas`, `PulseLayer`,
 * `DragLayer`, and the three page hooks — takes THIS.
 *
 * `readonly` arrays and `ReadonlyMap` are covariant in TypeScript, so a
 * `WorldNode` layout is assignable wherever a `PositionedNode` one is, with no
 * cast and no adapter.
 */
export interface DrawnLayout<N extends LayoutInputNode = LayoutInputNode> {
  /** PRE-ORDER: parent, then its subtree. The order `role="tree"` wants. */
  readonly nodes: readonly PositionedNode<N>[]
  /** For the keyboard walk, which asks "who is my parent" on every Left press.
   *  Built here because this is a pure function called from a useMemo, never a
   *  zustand selector — see store/entries.ts's header for why that distinction
   *  is load-bearing in this codebase. */
  readonly byId: ReadonlyMap<string, PositionedNode<N>>
  readonly edges: readonly MindtreeEdge[]
  /** Normalised: minX and minY are always 0. */
  readonly bounds: Bounds
  readonly maxDepth: number
  /**
   * Ring radii by DEPTH, hub-relative and in drawing units: `rings[d]` is the
   * radius every node at depth `d` sits on. `rings[0]` is 0 — the hub is its own
   * ring of one — so the index IS the depth and a renderer can hand it straight
   * to a `data-depth`. Undefined from the linear layout, which has columns and
   * not rings.
   */
  readonly rings?: readonly number[]
  /**
   * The hub's centre in DRAWING coordinates, after the mirror. Always the exact
   * centre of `bounds`, because radial.ts pads the bounds symmetrically about it
   * — which is what makes the RTL mirror an equality rather than an
   * approximation. Undefined from the linear layout.
   */
  readonly hub?: Point
}

export interface MindtreeLayout<N extends LayoutInputNode = LayoutInputNode>
  extends DrawnLayout<N> {
  readonly options: ResolvedLayoutOptions
}

/**
 * A node is at least 44 px tall because that is the touch-target floor the whole
 * app is held to, and a mind map is nothing but touch targets. The inline
 * default is the width a two-line track label needs at the body size.
 */
export const DEFAULT_NODE_SIZE: Readonly<NodeSize> = Object.freeze({ width: 168, height: 44 })

/**
 * The depth gap is wide enough for a connector to read as a connector; the
 * sibling gap is the smallest clearance at which two adjacent cards still look
 * like two cards. Both are overridable — the mobile rendering runs tighter.
 */
export const DEFAULT_GAP: Readonly<Gap> = Object.freeze({ depth: 56, sibling: 12 })

export const DEFAULT_LAYOUT_OPTIONS: Readonly<ResolvedLayoutOptions> = Object.freeze({
  nodeSize: DEFAULT_NODE_SIZE,
  gap: DEFAULT_GAP,
  depthLimit: Number.POSITIVE_INFINITY,
  direction: 'ltr',
})

/**
 * Where the Bézier handles sit, as a share of the run along the DEPTH AXIS
 * between the two nodes. A half-run on each side is the classic mind-map S: it
 * leaves both ends perpendicular to the faces they touch, so a connector meets a
 * card square-on at every zoom level and in either orientation.
 */
const EDGE_CURVE = 0.5

// ── the entry point ────────────────────────────────────────────────────────

/**
 * Lay out a Mindtree.
 *
 * The model always mints a root (the workspace), so there is no null case: a
 * workspace with nothing open is a root with no children, and it lays out as a
 * single rectangle at the origin. Every returned number is finite for every
 * input this can be handed, including sizes a divide-by-zero in an area encoding
 * turned into NaN — see sanitizeSize().
 */
export function layoutMindtree<N extends LayoutInputNode>(
  root: N,
  options: LayoutOptions<N> = {},
): MindtreeLayout<N> {
  const opts = resolveLayoutOptions(options)
  const vertical = opts.orientation === 'vertical'

  // 1. BUILD — shared verbatim with radial.ts, which is the only reason the
  //    `role="tree"` output cannot diverge by shape: pre-order, depth limit,
  //    collapsed rule and hiddenChildCount all come from ONE function.
  const work = buildLayoutNodes(root, opts, options.sizeOf)

  // 1b. TRANSPOSE. The vertical drawing is the horizontal one reflected about
  //     y = x, and that is ALL it is. Swap every node's size here and the whole
  //     of phases 2–4 runs unchanged in "layout space" — local x is the depth
  //     axis, local y is the sibling axis — with no second copy of the packing
  //     and no `if (vertical)` anywhere inside it. The swap is undone in exactly
  //     one place: the emit loop below, which is where layout space becomes
  //     screen space. Two field writes per node, so a thousand-node drawing pays
  //     for its second orientation in microseconds.
  if (vertical) {
    for (const node of work) {
      const across = node.width
      node.width = node.height
      node.height = across
    }
  }

  let maxDepth = 0
  for (const node of work) if (node.depth > maxDepth) maxDepth = node.depth

  if (opts.wrap === true) {
    // 2'+3'. BLOCKS — one engine in place of columns-and-contours, because the
    //        two cannot be mixed inside one tree without synthesising a
    //        multi-row contour for every grid subtree. See packBlocks().
    packBlocks(work[0], opts.gap)
  } else {
    // 2. COLUMNS — the depth coordinate is a function of depth alone.
    const colWidth: number[] = []
    for (const node of work) {
      colWidth[node.depth] = Math.max(colWidth[node.depth] ?? 0, node.width)
    }
    const colX: number[] = []
    let cursor = 0
    for (let d = 0; d <= maxDepth; d += 1) {
      colX[d] = cursor
      cursor += colWidth[d] + opts.gap.depth
    }

    // 3. PACK
    pack(work[0], opts.gap.sibling)

    // 3b. Local frames collapsed into absolute layout coordinates. Pre-order
    //     guarantees a parent's frame offset is known before its children need
    //     it, so this is one linear pass and not a second recursion.
    for (const node of work) {
      node.frame = node.parent === null ? 0 : node.parent.frame + node.shift
      node.x = colX[node.depth]
      node.y = node.localY + node.frame
    }
  }

  // 4. BOUNDS, and normalise to the origin. Only the SIBLING axis can go
  //    negative: the packing works in whatever frame the first leaf happened to
  //    establish, which is routinely below zero. The DEPTH axis starts at 0
  //    under both engines — colX[0] is 0, and a block's box is placed at the
  //    origin — so `maxX` is seeded at 0 and there is no second normalisation to
  //    add here. A drawing that starts at (0,0) is what makes the viewBox, the
  //    export and the RTL mirror all trivial.
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let maxX = 0
  for (const node of work) {
    if (node.y < minY) minY = node.y
    if (node.y + node.height > maxY) maxY = node.y + node.height
    if (node.x + node.width > maxX) maxX = node.x + node.width
  }
  for (const node of work) node.y -= minY

  // The extents are still in layout space, so which one is the picture's width
  // is the last thing the orientation decides.
  const alongDepth = maxX
  const alongSibling = maxY - minY
  const width = vertical ? alongSibling : alongDepth
  const height = vertical ? alongDepth : alongSibling
  const bounds: Bounds = { minX: 0, minY: 0, maxX: width, maxY: height, width, height }

  // The mirror. `width - x - w` reflects a rect about the drawing's centre line;
  // a point is reflected as `width - x`. This is the ONLY place direction is
  // read, and it reads SCREEN x in both orientations — see the header.
  const rtl = opts.direction === 'rtl'
  const flipRect = (x: number, w: number): number => (rtl ? width - x - w : x)
  const flipPoint = (x: number): number => (rtl ? width - x : x)

  // Layout space → screen space, mirror included. This is the one statement the
  // orientation is allowed to reach, and every edge point goes through it so the
  // curve cannot drift from the rects it connects.
  const point = (x: number, y: number): Point =>
    vertical ? { x: flipPoint(y), y: x } : { x: flipPoint(x), y }

  const nodes: PositionedNode<N>[] = []
  const byId = new Map<string, PositionedNode<N>>()
  const edges: MindtreeEdge[] = []

  for (const node of work) {
    // Sizes were swapped on the way in, so in the vertical orientation
    // `node.height` IS the true screen width. A rectangle reflects about y = x
    // together with its coordinates or not at all.
    const nodeX = vertical ? node.y : node.x
    const nodeY = vertical ? node.x : node.y
    const nodeW = vertical ? node.height : node.width
    const nodeH = vertical ? node.width : node.height

    const positioned: PositionedNode<N> = {
      id: node.id,
      node: node.source,
      depth: node.depth,
      x: flipRect(nodeX, nodeW),
      y: nodeY,
      width: nodeW,
      height: nodeH,
      parentId: node.parent === null ? null : node.parent.id,
      childIds: node.children.map((c) => c.id),
      index: node.index,
      siblingCount: node.parent === null ? 1 : node.parent.children.length,
      hasChildren: node.children.length > 0 || node.hiddenChildCount > 0,
      hasHiddenChildren: node.hiddenChildCount > 0,
      hiddenChildCount: node.hiddenChildCount,
      collapsed: node.source.collapsed === true,
    }
    nodes.push(positioned)
    byId.set(positioned.id, positioned)

    if (node.parent !== null) {
      const parent = node.parent
      // Still computed in LAYOUT space, where "the parent's depth-end face,
      // centred on the sibling axis" is ONE expression covering both
      // orientations — and where "both handles keep their own endpoint's sibling
      // coordinate" is one expression for "the curve meets both cards
      // square-on". point() then transposes and mirrors them along with the
      // rects, so the connector cannot drift from what it connects.
      const px = parent.x + parent.width
      const py = parent.y + parent.height / 2
      const cx = node.x
      const cy = node.y + node.height / 2
      const run = cx - px
      edges.push({
        id: `${parent.id}->${node.id}`,
        parentId: parent.id,
        childId: node.id,
        depth: node.depth,
        start: point(px, py),
        end: point(cx, cy),
        c1: point(px + run * EDGE_CURVE, py),
        c2: point(cx - run * EDGE_CURVE, cy),
      })
    }
  }

  return { nodes, byId, edges, bounds, maxDepth, options: opts }
}

// ── 1. build ───────────────────────────────────────────────────────────────

/**
 * The mutable twin of PositionedNode, alive only inside one layout call.
 *
 * EXPORTED so radial.ts can share the build walk verbatim rather than writing a
 * second one. The four packing fields (`localY`, `shift`, `frame`, and the
 * column `x`) mean nothing to a polar layout and it leaves them at zero; what it
 * is here for is `depth`, `parent`, `children`, `index` and `hiddenChildCount` —
 * the fields the `role="tree"` markup is derived from.
 */
export interface LayoutWorkNode<N extends LayoutInputNode = LayoutInputNode> {
  source: N
  id: string
  depth: number
  width: number
  height: number
  parent: LayoutWorkNode<N> | null
  children: LayoutWorkNode<N>[]
  index: number
  hiddenChildCount: number
  /** The subtree's own leading edge ALONG THE SIBLING AXIS, in its own frame.
   *  Unused by the block engine, which places boxes outright. */
  localY: number
  /** How far this subtree's frame sits past its parent's frame, along the
   *  sibling axis. Unused by the block engine. */
  shift: number
  /** Accumulated frame offset — the sum of `shift` up the ancestor chain. */
  frame: number
  x: number
  y: number
}

/**
 * STEP 1 OF EVERY LAYOUT, LINEAR OR POLAR: the source tree walked into a
 * pre-order array, with the two reasons a child is not laid out at all applied
 * (the parent is collapsed, or the depth limit stops here) and the cycle /
 * duplicate-id guard closed.
 *
 * Exported because the alternative — radial.ts owning a second copy of this walk
 * — is the one way the accessible tree and the drawn tree could come to disagree
 * about what a node's `aria-posinset` is. They cannot disagree if there is only
 * one walk. `layoutMindtree` calls this; `layoutMindtreeRadial` calls this; the
 * pre-order equality between the two shapes is then a fact about the code rather
 * than a coincidence two test suites have to keep checking.
 */
export function buildLayoutNodes<N extends LayoutInputNode>(
  root: N,
  opts: ResolvedLayoutOptions,
  sizeOf?: (node: N, depth: number) => Partial<NodeSize> | undefined,
): LayoutWorkNode<N>[] {
  const out: LayoutWorkNode<N>[] = []
  const seen = new Set<string>([root.id])
  build(root, 0, null, 0, opts, sizeOf, seen, out)
  return out
}

/**
 * `children` is typed as the base contract, but every node in a tree the caller
 * built is the caller's own node type. The cast is at the one place that knows
 * that — a homogeneous tree is the only thing `layoutMindtree(root)` can be
 * handed, since `root` fixes N.
 */
function childrenOf<N extends LayoutInputNode>(node: N): readonly N[] {
  return (node.children ?? []) as readonly N[]
}

function build<N extends LayoutInputNode>(
  source: N,
  depth: number,
  parent: LayoutWorkNode<N> | null,
  index: number,
  opts: ResolvedLayoutOptions,
  sizeOf: ((node: N, depth: number) => Partial<NodeSize> | undefined) | undefined,
  seen: Set<string>,
  out: LayoutWorkNode<N>[],
): LayoutWorkNode<N> {
  // The caller's encoding first, the model's own size second, the default last —
  // and each of the three sanitised, because the first two are arithmetic over
  // data and the third is the only one that cannot be NaN.
  const size = sanitizeSize(sizeOf?.(source, depth) ?? source.size, opts.nodeSize)
  const node: LayoutWorkNode<N> = {
    source,
    id: source.id,
    depth,
    width: size.width,
    height: size.height,
    parent,
    children: [],
    index,
    hiddenChildCount: 0,
    localY: 0,
    shift: 0,
    frame: 0,
    x: 0,
    y: 0,
  }
  // Pushed BEFORE the children: this array is the pre-order the tree markup and
  // the keyboard walk both read.
  out.push(node)

  const kids = childrenOf(source)
  const laysOutChildren =
    depth < opts.depthLimit && (opts.expandAll === true || source.collapsed !== true)
  if (laysOutChildren) {
    for (const kid of kids) {
      // A duplicate id would silently overwrite a node in `byId` and a cycle
      // would recurse until the stack gave out. Neither is reachable from a
      // correct model, and both are cheap to make impossible here rather than
      // debuggable-at-3am there. A skipped child still counts as hidden, so the
      // node reports children it is not showing rather than lying about them.
      if (seen.has(kid.id)) continue
      seen.add(kid.id)
      node.children.push(
        build(kid, depth + 1, node, node.children.length, opts, sizeOf, seen, out),
      )
    }
  }
  node.hiddenChildCount = kids.length - node.children.length
  return node
}

// ── 3. pack ────────────────────────────────────────────────────────────────

/**
 * The leading and trailing edge — along the SIBLING axis — that a subtree
 * occupies at each of its rows, indexed by depth RELATIVE to the subtree's own
 * root (0 = the root's own row).
 *
 * This is the contour that makes the tree tidy. Two arrays rather than the
 * threaded pointers of Buchheim's linear-time variant, because the threads
 * assume a uniform node extent along the sibling axis and these nodes are
 * size-encoded — a node's height is data. The arrays cost O(rows) per merge and
 * the ring model is four rows deep.
 */
interface Contour {
  top: number[]
  bottom: number[]
}

function pack<N extends LayoutInputNode>(node: LayoutWorkNode<N>, gapSibling: number): Contour {
  const kids = node.children
  if (kids.length === 0) {
    node.localY = 0
    return { top: [0], bottom: [node.height] }
  }

  // The contour of everything placed so far under this node. Index 0 is reserved
  // for the node's own row and filled in once the children have decided where it
  // goes; index i+1 is the block's contour at the children's depth + i.
  let acc: Contour | null = null

  for (const kid of kids) {
    const sub = pack(kid, gapSibling)

    // How far down this subtree has to start so that it clears the block above
    // it at EVERY row the two share. Rows only one of them occupies impose no
    // constraint, which is precisely what lets a short branch tuck in beside a
    // tall one's deep tail instead of being pushed past it.
    //
    // The shift is not clamped at zero: the row-0 constraint always exists (both
    // blocks have a node at the child row), so a subtree whose own root sits far
    // below its local origin is pulled UP to sit snug, which is the difference
    // between a tidy tree and a staircase.
    let shift = 0
    if (acc !== null) {
      const shared = Math.min(sub.top.length, acc.top.length - 1)
      let needed = Number.NEGATIVE_INFINITY
      for (let i = 0; i < shared; i += 1) {
        const required = acc.bottom[i + 1] + gapSibling - sub.top[i]
        if (required > needed) needed = required
      }
      if (needed > Number.NEGATIVE_INFINITY) shift = needed
    }
    kid.shift = shift

    if (acc === null) {
      acc = { top: [0], bottom: [0] }
    }
    for (let i = 0; i < sub.top.length; i += 1) {
      const row = i + 1
      if (row < acc.top.length) {
        // The block already reaches this row, and it reaches it from ABOVE — the
        // incoming subtree was just shifted clear of it — so only the bottom
        // moves. (bottom is monotonic here by construction: sub.top[i] + shift is
        // already >= acc.bottom[row] + gap.)
        acc.bottom[row] = sub.bottom[i] + shift
      } else {
        acc.top[row] = sub.top[i] + shift
        acc.bottom[row] = sub.bottom[i] + shift
      }
    }
  }

  // A parent sits centred between its first and last child — the Reingold–Tilford
  // rule, and the one that makes a mind map read as a hierarchy rather than as a
  // stack of rows. Centring on the two extremes rather than on the mean keeps a
  // parent pointing at the middle of its fan even when one branch is enormous.
  const first = kids[0]
  const last = kids[kids.length - 1]
  const firstCenter = first.localY + first.shift + first.height / 2
  const lastCenter = last.localY + last.shift + last.height / 2
  node.localY = (firstCenter + lastCenter) / 2 - node.height / 2

  // acc is non-null: kids.length > 0 was checked at the top.
  const contour = acc as Contour
  contour.top[0] = node.localY
  contour.bottom[0] = node.localY + node.height
  return contour
}

// ── 3'. blocks ─────────────────────────────────────────────────────────────

/**
 * A whole subtree's extent, in LAYOUT space: `depth` along the axis depth runs
 * on, `sibling` along the axis siblings spread on. Orientation-free, like
 * everything else between the transpose and the emit — which is what lets the
 * test suite assert the vertical block drawing as the transpose of the
 * horizontal one instead of freezing a second set of numbers for it.
 */
interface Box {
  depth: number
  sibling: number
}

interface BlockPlan {
  box: Box
  /** Cells across the sibling axis. 1 for a leaf and for an only child. */
  columns: number
  /**
   * The uniform cell — the largest CHILD BOX, and emphatically not the largest
   * child RECTANGLE. A cell has to hold a whole subtree: two children in the
   * same column of different rows share a sibling interval by construction, so
   * if the cell were only node-sized their descendants would land in the same
   * depth band at the same sibling interval and collide. Sizing the cell to the
   * subtree is what makes "no two rectangles anywhere overlap" true rather than
   * merely usually true.
   */
  cellDepth: number
  cellSibling: number
  /** The grid's own sibling extent, which the parent is centred on. */
  blockSibling: number
  /**
   * The two gaps this plan was MEASURED with, carried so that placeBlock spaces
   * the grid with the identical numbers.
   *
   * They are stored rather than recomputed because measurement and placement
   * disagreeing by one gap is not a cosmetic fault — it is an overlap, and it
   * would appear only on the tree shapes where `nested` differs between the two
   * calls. Deriving a number twice from the same inputs is a bug waiting for a
   * refactor to separate the derivations; deriving it once and passing it cannot
   * drift.
   */
  sibGap: number
  rowGap: number
}

/**
 * The target shape of a block, as a ratio of its sibling extent to its depth
 * extent.
 *
 * Two, because two is a page you scroll rather than a ribbon you pan. The
 * measurement that produced this feature: 396 organisations under one parent, at
 * the default card, come out 21 cells by 19 — a little over two screens across
 * on a 1728-wide window — against a single row of 71,268 units, which is
 * thirty-six screens of panning to reach the last one. Wider than tall rather
 * than square because a screen is wider than it is tall and because the reader
 * scrolls down far more comfortably than sideways.
 */
/**
 * How much more air a block gets around it than a card does, when `gap.group` is
 * not given. Three is the smallest ratio at which a grid of grids reads as
 * separate groups rather than one band, judged by looking at a 396-organization
 * render rather than by arithmetic.
 */
const DEFAULT_GROUP_RATIO = 3

/**
 * How much more air sits between two ROWS of one block than between two columns
 * of it. Just over one, because the rows are siblings and the eye only needs to
 * be able to count them — not to read a generation change that is not there.
 */
const DEFAULT_ROW_RATIO = 1.6

const BLOCK_ASPECT = 2

/**
 * How many columns a parent's block gets.
 *
 * TWO RULES, and they are different rules on purpose. The HARD one is discrete
 * and absolute: a block is never deeper in CELLS than it is wide, so two
 * children never stack into what reads as a chain and a connector to the second
 * one never has to cross the first. The SOFT one is BLOCK_ASPECT, measured on
 * the block's real extents rather than on its cell counts, so that a wide cell
 * and a tall cell get different column counts out of the same fan-out — which is
 * the whole reason the target is stated as a shape and not as a magic number of
 * columns.
 *
 * Every candidate is tried. That is O(fan-out) per parent and therefore O(n)
 * over the tree, which is cheap enough that the alternative — a closed form that
 * would have to be re-derived every time the scoring changed — buys nothing. The
 * comparison is a strict `<` on a ratio distance, so a tie keeps the FEWER
 * columns and the answer is a pure function of the child boxes and the gaps: no
 * clock, no accumulation order, nothing a second run on the same input could
 * decide differently. `depth` is at least one unit — sizes floor at 1 and rows
 * at 1 — so the division is total.
 */
function blockColumns(
  count: number,
  cellSibling: number,
  cellDepth: number,
  sibGap: number,
  rowGap: number,
): number {
  if (count <= 1) return 1
  let best = count
  let bestScore = Number.POSITIVE_INFINITY
  for (let columns = 1; columns <= count; columns += 1) {
    const rows = Math.ceil(count / columns)
    if (columns < rows) continue
    const sibling = columns * cellSibling + (columns - 1) * sibGap
    const depth = rows * cellDepth + (rows - 1) * rowGap
    const ratio = sibling / depth
    // Distance from the target measured multiplicatively, so being twice as wide
    // as the target scores the same as being half as wide. An additive distance
    // would treat "nearly square" as close and "very wide" as far, which is
    // backwards for a shape ratio.
    const score = ratio >= BLOCK_ASPECT ? ratio / BLOCK_ASPECT : BLOCK_ASPECT / ratio
    if (score < bestScore) {
      bestScore = score
      best = columns
    }
  }
  return best
}

/**
 * PHASES 2 AND 3, FOR THE BLOCK DRAWING: every subtree measured into a box, then
 * every box placed inside its parent's grid.
 *
 * WHY THIS REPLACES THE CONTOUR PACKER RATHER THAN DECORATING IT. Wrapping and
 * globally-aligned rings are not both available, and the proof is short. Take a
 * parent P whose children are laid out in a grid with the depth bands preserved.
 * Children c0 (row 0, column 0) and ck (row 1, column 0) are both at depth d+1
 * and, by construction of a grid, occupy the SAME interval on the sibling axis.
 * If either has drawn children, those grandchildren live in band d+2 — one band,
 * shared by the whole drawing — at sibling intervals inside their parent's. Two
 * of them therefore occupy the same rectangle. Overlap, guaranteed, not merely
 * possible.
 *
 * So a block consumes the depth axis per row, and depth coordinates become local
 * to a box. THAT IS THE TRADE, and it is signed: under `wrap: true`, nodes at
 * the same depth in different rows of a block sit at different depth
 * coordinates, and the rings are no longer globally aligned. What survives, and
 * what was actually asked for, is regularity PER PARENT: straight column lines,
 * straight row lines, uniform cells, every one of a parent's children in the
 * same shaped slot as its siblings.
 *
 * WHY NO TWO RECTANGLES CAN OVERLAP, which is a strictly stronger invariant than
 * the per-band one the contour packer earns. By induction, every node's
 * rectangle lies inside its own box: it spans [x, x + node.width] ⊆ [x, x +
 * box.depth] on the depth axis, and being centred inside `box.sibling >=
 * node.height` it lies inside the box on the sibling axis too. The grid assigns
 * each child a cell; cells are disjoint, their pitch being cell + gap on both
 * axes; the grid begins one `gap.depth` past the parent's own rectangle, so the
 * parent clears all of it; and each child's box sits inside its cell. Disjoint
 * boxes contain disjoint drawings, so no two rectangles anywhere in the picture
 * intersect — cousins included, different depths included.
 *
 * WHAT IT COSTS, so nobody is surprised by it later: one child with three
 * hundred descendants beside a leaf sibling makes EVERY cell that big, and the
 * leaf floats alone in the middle of one. That is the literal reading of "all
 * children of one parent use a uniform cell size", and it is what makes the grid
 * a true grid rather than a masonry wall. If it bites on real data the upgrade
 * is the CSS-`auto`-rows shape — cell sibling extent uniform across the block,
 * cell depth extent per row — which keeps both sets of grid lines straight at
 * the cost of making blockColumns O(fan-out²) per parent.
 *
 * Two passes rather than one, because a block's cell size is the largest child
 * box and nothing can be placed until all of them are known. Both are O(n), and
 * both recurse — the same stack exposure `pack()` already has, and for the same
 * reason: the trees this draws are rings deep, not thousands deep.
 */
function packBlocks<N extends LayoutInputNode>(root: LayoutWorkNode<N>, gap: Gap): void {
  const plans = new Map<LayoutWorkNode<N>, BlockPlan>()
  measureBlock(root, gap, plans)
  placeBlock(root, 0, 0, gap, plans)
}

function measureBlock<N extends LayoutInputNode>(
  node: LayoutWorkNode<N>,
  gap: Gap,
  plans: Map<LayoutWorkNode<N>, BlockPlan>,
): Box {
  const kids = node.children
  if (kids.length === 0) {
    // A leaf's box is its own rectangle. The three cell numbers are meaningless
    // for it and placeBlock returns before it reads them.
    const box: Box = { depth: node.width, sibling: node.height }
    plans.set(node, {
      box,
      columns: 1,
      cellDepth: 0,
      cellSibling: 0,
      blockSibling: 0,
      sibGap: 0,
      rowGap: 0,
    })
    return box
  }

  let cellDepth = 0
  let cellSibling = 0
  for (const kid of kids) {
    const kidBox = measureBlock(kid, gap, plans)
    if (kidBox.depth > cellDepth) cellDepth = kidBox.depth
    if (kidBox.sibling > cellSibling) cellSibling = kidBox.sibling
  }

  // A cell that contains a grid needs more air around it than a cell that is one
  // rectangle. `nested` asks the only question that matters: does ANY child of
  // this node have children of its own? If so every cell in this grid is spaced
  // as a group, including the childless ones — a uniform grid with two different
  // column gaps in it is not a grid.
  const nested = kids.some((kid) => kid.children.length > 0)
  const groupGap = gap.group ?? gap.sibling * DEFAULT_GROUP_RATIO
  const sibGap = nested ? groupGap : gap.sibling
  // THE ROW GAP INSIDE A BLOCK IS NOT THE RING GAP, and using one for the other
  // was a real defect visible in the first rendered picture. `gap.depth` is the
  // distance from a parent to its children — it has to clear a stub and read as
  // descent. A row boundary inside a wrapped block is neither: those two rows
  // are SIBLINGS, the same generation, split only because the block ran out of
  // width. Spacing them like generations at 46 against a 14 column gutter made
  // vertical neighbours read as strangers and the grid look torn.
  //
  // A row gap slightly larger than the column gutter is what a wrapped grid
  // wants: enough that the rows are countable, little enough that the block
  // still reads as one object.
  const rowGap = nested ? groupGap : (gap.row ?? Math.round(gap.sibling * DEFAULT_ROW_RATIO))

  const columns = blockColumns(kids.length, cellSibling, cellDepth, sibGap, rowGap)
  const rows = Math.ceil(kids.length / columns)
  const blockSibling = columns * cellSibling + (columns - 1) * sibGap
  const blockDepth = rows * cellDepth + (rows - 1) * rowGap

  const box: Box = {
    // The parent's own rectangle, then the ring gap, then the grid.
    depth: node.width + gap.depth + blockDepth,
    // A parent wider than its whole fan is the thing that sets the box's sibling
    // extent; usually it is the other way round.
    sibling: Math.max(node.height, blockSibling),
  }
  plans.set(node, { box, columns, cellDepth, cellSibling, blockSibling, sibGap, rowGap })
  return box
}

function placeBlock<N extends LayoutInputNode>(
  node: LayoutWorkNode<N>,
  x: number,
  y: number,
  gap: Gap,
  plans: Map<LayoutWorkNode<N>, BlockPlan>,
): void {
  // measureBlock ran over the whole tree first, so every node has a plan.
  const plan = plans.get(node) as BlockPlan
  // The node's own rectangle heads its box, centred on the box's sibling extent:
  // a parent points at the MIDDLE OF ITS BLOCK, whether that block is one cell
  // or four hundred. That is the wrapped restatement of the Reingold–Tilford
  // rule, and it is deliberately not the old "centred between the first and last
  // child" — with a ragged last row the first child is in column 0 and the last
  // is somewhere in the middle, so their midpoint is not the block's and a parent
  // written that way would point off to one side of its own fan.
  node.x = x
  node.y = y + (plan.box.sibling - node.height) / 2

  const kids = node.children
  if (kids.length === 0) return

  const blockX = x + node.width + gap.depth
  const blockY = y + (plan.box.sibling - plan.blockSibling) / 2
  for (let i = 0; i < kids.length; i += 1) {
    const kid = kids[i]
    // Row-major, so `childIds` reads left to right and then down — which is what
    // keeps the keyboard walk and the `role="tree"` order matching the picture.
    const row = Math.floor(i / plan.columns)
    const column = i % plan.columns
    const kidBox = (plans.get(kid) as BlockPlan).box
    placeBlock(
      kid,
      // Rows are FLUSH to their row line, so every cell in a row starts its own
      // rings at exactly the same depth and the row reads as a row.
      blockX + row * (plan.cellDepth + plan.rowGap),
      // Columns are CENTRED, so a narrow subtree sits under the middle of its
      // column instead of hugging one edge of it. Note what this composes to for
      // the node itself: centring the box in the cell and then the rectangle in
      // the box telescopes to "the rectangle is centred in the cell", whatever
      // the box in between was — which is why every child in a column shares a
      // centre line even when their subtrees are wildly different sizes.
      blockY +
        column * (plan.cellSibling + plan.sibGap) +
        (plan.cellSibling - kidBox.sibling) / 2,
      gap,
      plans,
    )
  }
}

// ── options ────────────────────────────────────────────────────────────────

/**
 * `sizeOf` is deliberately NOT carried into the resolved options: the result of
 * a layout is a value — compared in tests, serialised by the SVG export — and a
 * closure inside it is neither.
 *
 * Exported for the same reason `buildLayoutNodes` is: a polar layout that
 * resolved its own defaults would be one edit away from a different depth-limit
 * or gap rule than the linear one, and the two shapes have to answer the same
 * question the same way.
 */
export function resolveLayoutOptions<N extends LayoutInputNode>(
  options: LayoutOptions<N>,
): ResolvedLayoutOptions {
  const gap = options.gap ?? {}
  const limit = options.depthLimit
  return {
    nodeSize: sanitizeSize(options.nodeSize, DEFAULT_NODE_SIZE),
    gap: {
      // Clamped at zero rather than trusted: a negative gap is a caller bug that
      // would present as nodes silently sitting on top of each other, which is
      // the one thing this file exists to make impossible.
      depth: positive(gap.depth, DEFAULT_GAP.depth, 0),
      sibling: positive(gap.sibling, DEFAULT_GAP.sibling, 0),
      // Carried ONLY when the caller gave one, for the same reason `expandAll`
      // is: `layout.options` is a value that three suites deep-compare, so the
      // resolved gap of every caller that does not ask for a group gap has to be
      // byte-for-byte the two-key object it has always been. When it is absent
      // `measureBlock` falls back to `sibling * DEFAULT_GROUP_RATIO`, so the
      // default lives in exactly one place and is not restated here.
      ...(gap.group === undefined
        ? {}
        : { group: positive(gap.group, DEFAULT_GAP.sibling * DEFAULT_GROUP_RATIO, 0) }),
      ...(gap.row === undefined
        ? {}
        : { row: positive(gap.row, DEFAULT_GAP.sibling * DEFAULT_ROW_RATIO, 0) }),
    },
    // The root is always drawn: a limit below zero would return an empty picture
    // for a workspace that has work in it. A missing or infinite limit means the
    // whole tree, which is what the desktop rendering passes.
    depthLimit:
      typeof limit === 'number' && Number.isFinite(limit)
        ? Math.max(0, limit)
        : Number.POSITIVE_INFINITY,
    direction: options.direction === 'rtl' ? 'rtl' : 'ltr',
    // Written only when true. `layout.options` is a VALUE — deep-compared in
    // three test suites and serialised by the export — so the resolved shape of
    // every caller that does not ask for this is byte-for-byte what it was.
    ...(options.expandAll === true ? { expandAll: true } : {}),
    // Same rule, and it is the whole reason `orientation` is an optional key
    // rather than a required one with a 'horizontal' default: a resolved shape
    // that gained a key would fail the byte-for-byte pin in layout.test.ts and
    // the three `layout.options` deep-compares, for a value every existing
    // caller already means by saying nothing.
    ...(options.orientation === 'vertical' ? { orientation: 'vertical' as const } : {}),
    ...(options.wrap === true ? { wrap: true } : {}),
  }
}

/**
 * A node's size, with every way a model can produce a bad one closed off.
 *
 * The count → area encoding divides and takes roots; a workspace with zero
 * entries is a plausible divide-by-zero, and one NaN width here would propagate
 * through the column widths into every x in the drawing and blank the whole
 * screen. A fallback to the default size loses one node's emphasis instead.
 */
function sanitizeSize(size: Partial<NodeSize> | undefined, fallback: NodeSize): NodeSize {
  return {
    width: positive(size?.width, fallback.width, 1),
    height: positive(size?.height, fallback.height, 1),
  }
}

/** `value` when it is finite and at least `floor`, otherwise `fallback`. */
function positive(value: number | undefined, fallback: number, floor: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= floor ? value : fallback
}

// ── the count encoding ─────────────────────────────────────────────────────

export interface CountSizeOptions {
  /** The size of a node holding one entry. This is a legibility floor, not a
   *  data point — see the note about proportionality below. */
  min?: Partial<NodeSize>
  /** The size the encoding stops growing at. */
  max?: Partial<NodeSize>
  /** The count that reaches `max`. Pass the busiest count in the current picture
   *  and the scale becomes relative to the workload on screen, which is the
   *  question the Mindtree is answering. */
  fullAt?: number
}

/**
 * MINDTREE-SPEC's second visual variable — "node size encodes count (area,
 * clamped)" — as arithmetic.
 *
 * BOTH DIMENSIONS GROW WITH √count, so the AREA grows with the count. Area is
 * the honest channel for a magnitude on a filled shape: a node drawn twice as
 * wide AND twice as tall for twice the work reads as four times the work, which
 * is the classic bubble-chart lie.
 *
 * IT IS NOT STRICTLY PROPORTIONAL, and the floor is why. A node has to hold a
 * label, and a card scaled down until its own name does not fit is not a smaller
 * datum — it is an unreadable one. So the interpolation runs from `min` (one
 * entry, still legible) to `max` (`fullAt` entries), and the ratio is a
 * comparison of the extra area above the floor. Two clamps and a floor is the
 * whole encoding; anything cleverer is a second chart nobody asked for.
 *
 * Exported rather than inlined into the renderer because it is geometry, it is
 * pure, and it is the kind of arithmetic that quietly rots into a linear scale
 * the first time somebody "simplifies" it. USING it is the renderer's decision:
 * pass `sizeOf: (node) => sizeForCount(node.count, …)`.
 */
export function sizeForCount(count: number, options: CountSizeOptions = {}): NodeSize {
  const min = sanitizeSize(options.min, DEFAULT_NODE_SIZE)
  const max = sanitizeSize(options.max, {
    width: min.width * 1.5,
    height: min.height * 1.5,
  })
  const fullAt = positive(options.fullAt, 50, 1)

  const safeCount = Math.max(1, positive(count, 1, 0))
  // √1 = 1 is the origin, so a single-entry node is exactly `min` and the whole
  // range above it is spent on the counts that differ.
  const span = Math.sqrt(fullAt) - 1
  const t = span <= 0 ? 1 : Math.min(1, (Math.sqrt(safeCount) - 1) / span)

  return {
    width: min.width + (max.width - min.width) * t,
    height: min.height + (max.height - min.height) * t,
  }
}

// ── the viewBox ────────────────────────────────────────────────────────────

export interface Viewport {
  readonly width: number
  readonly height: number
}

export interface FitOptions {
  /** Breathing room around the drawing, in drawing units. */
  padding?: number
  /**
   * Defaults to 1: fit-to-view never MAGNIFIES. A three-node workspace blown up
   * to fill a 27" monitor is a cartoon, and — the reason this is a default and
   * not a preference — text scaled past 1:1 inside a viewBox is text rendered at
   * a size nobody chose. components/charts/geometry.ts's header argues the same
   * point from the other direction.
   */
  maxScale?: number
  /** A floor for a very large tree. 0 (the default) means "always fit". */
  minScale?: number
}

export interface ViewBoxFit {
  /** `${x} ${y} ${width} ${height}`, ready for the svg attribute. */
  readonly viewBox: string
  /** Drawing units per CSS pixel. The zoom controls multiply this. */
  readonly scale: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * The rectangle a branch occupies: a node's own rect unioned with every DRAWN
 * descendant's. Zoom-to-branch is this, handed straight to fitToViewBox —
 * `fitToViewBox(subtreeBounds(layout, id) ?? layout.bounds, viewport)` — which
 * is why it reads immediately above that function rather than beside the layout.
 *
 * A FUNCTION AND NOT A FIELD, deliberately, and the reason is the same one that
 * keeps `orientation` off the resolved options unless it is asked for. Every
 * node already carries `childIds` and every layout carries `byId`, so this is
 * derivable in one walk by whichever caller wants it; a `subtree` rect on
 * PositionedNode would put a number nobody reads on every node of a thousand-node
 * drawing, and a key on `Bounds` or on the layout itself would break the
 * deep-equality assertions that are the entire point of layout.test.ts. Callers
 * memoise it against the layout they are already memoising.
 *
 * UNLIKE `layout.bounds`, THIS IS NOT NORMALISED. minX and minY are where the
 * branch actually is, because "where is it" is the whole question a camera is
 * asking; a rectangle helpfully moved to the origin would fly the camera to the
 * corner of the map every time.
 *
 * Returns null for an id the DRAWING does not contain — a collapsed branch's
 * child, a node past the depth limit, a selection left over from a previous
 * tree — so a caller falls back to the full bounds rather than framing a NaN.
 * That is a different question from "is it in the model", and this function only
 * answers the drawing's one.
 *
 * Reads nothing but `byId` and `childIds`, so it is equally right for the linear
 * drawing, the polar one and the containment one, in either direction and either
 * orientation — hence `DrawnLayout` rather than `MindtreeLayout` as the
 * parameter.
 */
export function subtreeBounds<N extends LayoutInputNode>(
  layout: DrawnLayout<N>,
  id: string,
): Bounds | null {
  const root = layout.byId.get(id)
  if (root === undefined) return null

  let minX = root.x
  let minY = root.y
  let maxX = root.x + root.width
  let maxY = root.y + root.height

  // Iterative, because the drawing this walks can be a thousand rings deep — the
  // chain fixture in layout.test.ts is exactly that — and a camera helper is not
  // the place to spend the stack. `pop()` rather than `shift()` because min and
  // max are commutative, so the traversal order cannot change the answer and the
  // cheaper end of the array wins.
  //
  // The visited set makes the walk total over ANY DrawnLayout, including one a
  // caller assembled by hand: buildLayoutNodes already guarantees a forest, so
  // this costs one Set to make "the tab hung" impossible for the layout that
  // does not come from there.
  const pending: string[] = [...root.childIds]
  const seen = new Set<string>([id])
  while (pending.length > 0) {
    const nextId = pending.pop() as string
    if (seen.has(nextId)) continue
    seen.add(nextId)
    const positioned = layout.byId.get(nextId)
    if (positioned === undefined) continue

    if (positioned.x < minX) minX = positioned.x
    if (positioned.y < minY) minY = positioned.y
    if (positioned.x + positioned.width > maxX) maxX = positioned.x + positioned.width
    if (positioned.y + positioned.height > maxY) maxY = positioned.y + positioned.height

    for (const childId of positioned.childIds) pending.push(childId)
  }

  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
}

/**
 * The viewBox that shows `bounds` inside `viewport`, centred.
 *
 * The rectangle is derived from the VIEWPORT's aspect, not the content's, which
 * is what makes the result independent of `preserveAspectRatio`: the box is
 * exactly the viewport divided by the scale, centred on the drawing, so the
 * picture is never stretched and the caller never has to reason about how the
 * browser would have letterboxed it.
 *
 * Zoom is this viewBox scaled — never a CSS transform on the <svg>, which blurs
 * text and moves hit-testing away from where the marks are drawn (MINDTREE-SPEC).
 */
export function fitToViewBox(
  bounds: Bounds,
  viewport: Viewport,
  options: FitOptions = {},
): ViewBoxFit {
  const padding = positive(options.padding, 16, 0)
  const maxScale = positive(options.maxScale, 1, Number.EPSILON)
  const minScale = Math.min(positive(options.minScale, 0, 0), maxScale)

  // A one-unit floor: a zero-extent drawing is not impossible (a caller passing
  // an empty bounds) and it is a division by zero one line later.
  const contentWidth = Math.max(finite(bounds.width, 0) + padding * 2, 1)
  const contentHeight = Math.max(finite(bounds.height, 0) + padding * 2, 1)
  // An unmeasured container is 0 wide for one frame. Falling back to the content
  // means the first paint is the 1:1 drawing rather than an empty box.
  const viewWidth = positive(viewport.width, contentWidth, 1)
  const viewHeight = positive(viewport.height, contentHeight, 1)

  let scale = Math.min(viewWidth / contentWidth, viewHeight / contentHeight)
  if (!Number.isFinite(scale) || scale <= 0) scale = 1
  scale = Math.min(Math.max(scale, minScale), maxScale)

  const boxWidth = round(viewWidth / scale)
  const boxHeight = round(viewHeight / scale)
  const centerX = finite(bounds.minX, 0) + finite(bounds.width, 0) / 2
  const centerY = finite(bounds.minY, 0) + finite(bounds.height, 0) / 2
  const x = round(centerX - boxWidth / 2)
  const y = round(centerY - boxHeight / 2)

  return {
    viewBox: `${x} ${y} ${boxWidth} ${boxHeight}`,
    scale,
    x,
    y,
    width: boxWidth,
    height: boxHeight,
  }
}

export interface ZoomLimits {
  /** Smallest multiplier of the fit the controls may reach. Never above 1. */
  readonly min: number
  /** Largest multiplier of the fit the controls may reach. Never below 1. */
  readonly max: number
}

export interface ZoomLimitOptions {
  /** Smallest EFFECTIVE scale — drawing units per CSS pixel — worth offering. */
  minScale?: number
  /** Largest effective scale. Must be reachable however small the fit is. */
  maxScale?: number
}

/**
 * The zoom multiplier's bounds, derived from the fit.
 *
 * THE BOUND IS ON THE EFFECTIVE SCALE, NOT ON THE MULTIPLIER, and that is the
 * whole point of this function existing rather than two constants living in the
 * page. On-screen scale is `fit.scale * zoom`, so a fixed `zoom <= 4` is a
 * ceiling of `4 × fit.scale` — which on a map that fits at 0.15 is an effective
 * 0.6, i.e. 7.5px labels with the zoom-in button already dead. The reader's
 * escape hatch from a large map was itself sized by how large the map was.
 *
 * Both bounds are then pinned around 1 so the fit is ALWAYS reachable: a map
 * that already fits above `maxScale` must still be returnable to its fit, and
 * "Fit to view" sets the multiplier to exactly 1.
 */
export function zoomLimits(fitScale: number, options: ZoomLimitOptions = {}): ZoomLimits {
  const minScale = positive(options.minScale, 0.25, Number.EPSILON)
  const maxScale = Math.max(positive(options.maxScale, 3, Number.EPSILON), minScale)
  // A zero or NaN fit would divide into infinity and hand the caller a slider
  // with no end; 1 means "the bounds are the effective scales themselves".
  const scale = positive(fitScale, 1, Number.EPSILON)
  return {
    min: Math.min(1, minScale / scale),
    max: Math.max(1, maxScale / scale),
  }
}

/**
 * One edge as an SVG cubic. Offered here so the connector, the "copy for a deck"
 * SVG file and the PNG canvas all draw the identical curve from the identical
 * numbers; a renderer that wants an elbow reads the four points instead.
 */
export function edgePath(edge: MindtreeEdge): string {
  const { start, c1, c2, end } = edge
  return (
    `M ${round(start.x)} ${round(start.y)} ` +
    `C ${round(c1.x)} ${round(c1.y)}, ${round(c2.x)} ${round(c2.y)}, ` +
    `${round(end.x)} ${round(end.y)}`
  )
}

/**
 * Three decimals. Sub-thousandth precision is invisible at every zoom level this
 * screen offers, and the full float prints seventeen digits into an exported SVG
 * — per coordinate, per node, per edge.
 */
function round(value: number): number {
  return Math.round(finite(value, 0) * 1000) / 1000
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}
