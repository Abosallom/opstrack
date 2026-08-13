// THE STATIC DRAWING — recursive containment, full depth, one coordinate space.
//
// Every node owns a circular WORLD of diameter D. Its children's worlds are
// packed on a ring INSIDE it, and the recursion bottoms out at a leaf whose
// world is the unit of this coordinate space. Nothing here is concentric: ring 2
// is not a bigger circle around ring 1, it is a ring inside each of ring 1's
// worlds, which is the difference between a diagram that scales and the
// reference the owner sent — the mouth becomes the frame and then it is gone,
// and the city inside it was drawn at its own scale all along.
//
// THE ONE STRUCTURAL CLAIM, and everything below is in service of it:
//
//   THE GEOMETRY IS A PURE FUNCTION OF THE TREE AND THE READING DIRECTION.
//   Not the zoom. Not the viewport. Not the panel occlusion. Not the filter. Not
//   the level of detail. Not the reader's collapse choices.
//
// `layoutWorlds` takes no camera argument, and that is not an omission to be
// tidied up later — it is the whole design. The trap it exists to kill is the
// cycle `depthLimit → layout → bounds → fit.scale → zoomBounds → heldZoom →
// depthLimit`, and it is killed at the root rather than by discipline: the chain
// has no first link, because `depthLimit` is not an input here and `bounds` is a
// CONSTANT for a given tree. Nothing can flash, because nothing is recomputed;
// zooming out returns the reader to the framing they left TO THE UNIT, because
// the coordinates never moved.
//
// The layering rule is layout.ts's, unchanged: no React, no store, no api, no
// i18n, no DOM, no new runtime dependency. `Math` only.
//
// ── THE PACKING ────────────────────────────────────────────────────────────
//
//   gap        = GAP_RATIO · D_widest_child
//   r_children = the CHORD radius: the smallest r at which no two child worlds
//                on the ring intersect (radial.ts's `packRing`)
//   D_parent   = 2·(r_children + D_widest/2) · RIM
//   n = 1      → D_parent = D_child · SINGLE_CHILD_RATIO
//   n = 0      → D_parent = D_LEAF, scaled by the authored card
//
// BUILT OUTWARD FROM THE LEAVES, so the finest detail sits at unit scale where
// float precision is best: D_LEAF = 200 around a 168×44 card.
//
// ⚠ ONE DEPARTURE FROM THE BRIEF, AND ITS MEASURED COST. MAP-ZOOM §11 gives the
// ring radius as `(D_child/2 + gap) / (2·sin(π/n))` and, two paragraphs earlier,
// gives the pair constraint as `(diag_i/2 + diag_j/2 + gap) / (2·sin(Δθ/2))`.
// For equal children those are `D/2 + gap` and `D + gap` — they differ by one
// child RADIUS, and the shorter one overlaps: at n = 6, the commonest fan-out on
// this screen, it puts adjacent centres 0.68·D apart where two discs of diameter
// D need 1.18·D to clear each other. Every pair of sibling worlds would
// interpenetrate by 32%, their rims would cross, and their contents would
// interleave one tier down. That is the same failure the chord-not-arc
// correction was written to prevent, applied one step further in, so the PAIR
// CONSTRAINT is the one implemented and the headline formula is not.
//
// What it costs, stated where the numbers are rather than left to be discovered:
//
//   fan-out   brief's ratio   implemented   octaves per tier
//   2         1.91            2.49          1.31
//   3         2.24            2.69          1.43
//   4         2.44            3.04          1.61
//   6         2.69            3.83          1.94
//   9         3.40            5.07          2.34
//
// So a tier is roughly half an octave deeper than the brief's arithmetic
// predicted, and the brief's "five tiers span ~52×, a root world around 10,400
// units" becomes ~260× and ~52,000 at four-wide. The 10⁵ bound the brief asks to
// be asserted at depth 6 HOLDS at fan-out ≤ 3 (200 × 2.69⁶ = 76,000) and does
// not hold at fan-out 6 (200 × 3.83⁶ = 631,000). The property that bound was
// protecting — every coordinate inside float32's seven significant digits, with
// the finest detail at unit scale, so the SVG rasteriser never sees a degenerate
// span — holds in both cases and holds with three orders of magnitude to spare:
// float32 represents every integer below 16,777,216 exactly. worlds.test.ts
// asserts the real bound at depth 6 and the brief's bound at the brief's shape,
// and says which is which.
//
// ── WHAT IS INSIDE A WORLD ─────────────────────────────────────────────────
//
// EVERY MARK A NODE OWNS IS INSIDE ITS OWN WORLD DISC, and sibling worlds are
// disjoint. That pair of facts is what makes the dive legible: a world is a
// complete picture, and no part of one leaks into its neighbour at any zoom.
//
// A NODE'S CARD IS AUTHORED AT ITS WORLD'S SCALE, AND THERE ARE TWO RULES —
// one for the room a LEAF owns and one for the room a PARENT lends out:
//
//   a leaf FILLS its world        cardScale = worldD / D_LEAF
//                                 → the card's diagonal is 0.87·worldD
//   a parent YIELDS to its ring   cardScale = HOLE_FRACTION·worldD / leafDiag
//                                 → the card's diagonal is 0.34·worldD
//
// Both are the reference's second property made arithmetic — what is a texture
// at one distance is a drawn picture at the next, because every level was drawn
// at its own size — and both are THE SAME SHARE OF THAT NODE'S OWN WORLD AT
// EVERY DEPTH. Two shares, one per role, neither a function of depth. That is
// what the LOD bands (U2) rest on: `lod.ts` keys the band table on `worldD`
// alone (`apparentOf`, lod.ts:130), so it applies to the root and to a leaf
// identically, which is precisely why "the child becomes the view" needs no
// special case for how deep it is.
//
// The second rule is defect 6 of the render harness, and it is not cosmetic: a
// parent card authored at `worldD / D_LEAF` carries a 0.87·worldD diagonal into
// the 0.36·worldD hole a six-child ring leaves, so EVERY parent's own card was
// drawn straight across its own children's ring, at every tier, in every
// screenshot the harness took. `HOLE_FRACTION` states the measurement, and
// states what it does not buy.
//
// The consequence is a fact about the drawing rather than a regression: a
// parent's card is ~40% of the size it was, and its identity moves OUTWARD onto
// the rim (`MindWorldRim`, drawn only for a node with children). The room
// inside a parent belongs to its children.
//
// BOXES NEVER ROTATE. Only world-centres sit on a circle. That is what keeps
// MindNode's measured CHAR_PX glyph budget, <rect> hit-testing, PulseLayer's
// rect pulses, MindDropTargets, DragLayer's pointer→layout conversion, the free
// CSS `translate` tween and export.ts's id-stripping serialiser working
// UNCHANGED. A wedge would also make containment impossible — you cannot nest a
// world inside a wedge without rotating everything in it — and a wedge's area
// already encodes leaf count, colliding head-on with sizeForCount's count→area
// encoding.
//
// ── RTL ────────────────────────────────────────────────────────────────────
//
// ONE REFLECTION STATEMENT, θ → π − θ, applied once at the end. The bounds are
// the root world's SQUARE, so they are centred on the hub by construction rather
// than by a padding pass, and the reflection's fixed point is exact: the root's
// x is the same FLOAT in Arabic as in English, not the same to nine places.
// Every bearing and every wedge boundary is reflected by the same statement, so
// a rim arc drawn from `wedgeStart`/`wedgeEnd` mirrors with the geometry and no
// renderer does direction arithmetic on an angle. (A DIRECTIONAL arc still has
// to flip its own sweep-flag — the mirror turns clockwise into anticlockwise —
// but that is a fact about the mark, not about the placement.)

import { buildLayoutNodes, resolveLayoutOptions, DEFAULT_NODE_SIZE } from './layout'
import { D_LEAF, GAP_RATIO, RIM, SINGLE_CHILD_RATIO, packRing } from './radial'
import type {
  Bounds,
  LayoutInputNode,
  LayoutOptions,
  LayoutWorkNode,
  MindtreeEdge,
  NodeSize,
  Point,
  PositionedNode,
} from './layout'

/**
 * The packing constants, published here because this is the module the contract
 * publishes them from. They are DECLARED in radial.ts, beside `packRing`, which
 * is the only code that reads them — see that file's note on why the cycle is
 * worth avoiding.
 */
export { D_LEAF, GAP_RATIO, RIM, SINGLE_CHILD_RATIO }

const TAU = Math.PI * 2

/** layout.ts's EDGE_CURVE, restated (it is private there). */
const EDGE_CURVE = 0.5

/** How far past its own card a node's chevron anchor sits, at unit scale. */
const CHEVRON_GAP = 9

/**
 * The share of the viewport's smaller side at which a world IS the frame — the
 * `frame` edge of MAP-ZOOM §4's band table, and `worldAt`'s default. Stated here
 * because `worldAt` is the breadcrumb's only source of truth and a breadcrumb
 * that disagreed with the picture about which world you are in would be worse
 * than no breadcrumb.
 */
export const FRAME_FRACTION = 0.85

/**
 * A PARENT'S CARD, AS A SHARE OF ITS WORLD'S DIAMETER — the hole its children's
 * ring leaves, expressed as the card's DIAGONAL so that it is one number for
 * every aspect ratio a caller can author.
 *
 * THE MEASUREMENT THAT FORCED IT. A card authored at its world's scale carries a
 * diagonal of `hypot(168, 44) / 200 = 0.87·worldD`. The ring the packing above
 * builds leaves a free centre of `(2r − D) / worldD` — at six children, the
 * commonest fan-out on this screen, `r = 1.18·D` and that is 0.36·worldD. So the
 * parent's own card covered its children's ring by better than two to one, at
 * every tier. 0.34 is that hole with a hair of margin, and measured against the
 * card's real support function rather than its circumcircle it is the constant
 * at which a parent's card clears every child world outright FROM SIX CHILDREN
 * UP: 6 clears with 15% to spare, 5 does not clear at all.
 *
 * WHAT IT DOES NOT BUY, stated here because worlds.test.ts pins it rather than
 * hiding it. Below six children the packing leaves no hole a legible card fits
 * in — at three the free centre is 0.13·worldD, and at one there is no hole at
 * all, because `SINGLE_CHILD_RATIO = 2.2` puts the lone child's centre 0.46·D
 * from the hub with a radius of 0.5·D and its world therefore covers the hub.
 * Shrinking every parent's card until it cleared a two-child ring would mean a
 * 36-unit card in a 500-unit world: illegible at every fan-out, to remove an
 * overlap the reader sees at five of them. So the guarantee that holds at EVERY
 * fan-out 1..40 is the weaker one: the card stays inside the circle its
 * children's CENTRES sit on, binding at one child where it uses 80% of it.
 *
 * The consequence, stated rather than discovered: a parent's own card is ~40% of
 * the size it was. That is right. The room inside a parent belongs to its
 * children; the parent's identity is on the rim.
 *
 * AND WHAT THAT COST THE TYPE ON IT, which wave 5 paid rather than left to be
 * discovered. `cardScale / worldD` is `1 / D_LEAF` for a leaf and
 * `HOLE_FRACTION / leafDiag = 1 / 510.78` here, so an authored 12.5 lands at
 * `12.5 x apparent / 510.78` — 3.84 px at `BAND_EDGES.card`, and no band edge
 * under the 185.8 px the opening picture measures could ever have lifted it.
 * `MindNode` therefore authors its type and its strokes in WORLD units
 * (`--mtree-world` = `worldD / (D_LEAF x cardScale)`, exactly `leafDiag /
 * (HOLE_FRACTION x D_LEAF) = 2.5539` here and exactly 1 for a leaf), which makes
 * the ink `authored x apparent / D_LEAF` for EVERY node in either role — the one
 * identity `lod.ts` cuts its band edges on, and the reason a card inscribed in
 * its ring draws the chip's picture: 168 leaf units is 65.8 WORLD units, under
 * `LABEL_INSIDE_MIN`. worlds.test.ts pins both factors; `HOLE_FRACTION` is the
 * number that decides the second one.
 */
export const HOLE_FRACTION = 0.34

/**
 * THE DIVE STEPS THROUGH DEPARTMENTS, AND STOPS THERE.
 *
 * `worldAt` — the world the breadcrumb names and the camera is measured against
 * — is only ever a STRUCTURAL node. A `group`, `more` or `entry` is drawn as
 * CONTENT inside its owner's world and can never become the frame; an
 * Organization (`kind: 'entity'`) is a LEAF YOU ARRIVE AT, and its detail
 * belongs to the info sidebar, which is a different gesture answering a
 * different question. This is the owner's own correction — "the leveling for
 * department wise not org and info side bar" — made mechanical.
 *
 * A `cohort` IS ONE OF THEM, and that is the whole reason it is its own kind.
 * A cohort ring — "the 96 organizations Sara manages", "the 41 on Integrating" —
 * is a ring of the workspace rather than content drawn inside one, so the camera
 * must be able to stop on it, the breadcrumb must be able to name it and the
 * dive must be able to enter it. A `group` could not be given that without
 * giving it to every status bucket on the map, which is the argument the design
 * makes at length and the reason the union grew instead.
 *
 * Read structurally, never imported from model.ts: this module is the lower
 * layer and a geometry that imported the semantics above it could not be tested
 * without building one. A node with no `kind` at all is structural, so a plain
 * tree dives all the way down and a caller who is not the map model owes this
 * module nothing. THAT IS ALSO WHY `KIND_ROLE` IS NOT READ HERE: the role table
 * lives in model.ts beside the union it partitions, and importing it would buy
 * one string in exchange for the layering this file's header is built on. The
 * two are kept in step by focus.ts, which restates this set against
 * `MindNodeKind` and reds when a kind is added without a decision.
 */
const STRUCTURAL_KINDS: ReadonlySet<string> = new Set(['root', 'track', 'entity', 'cohort'])

/** A node's world: where it is, how big it is, and whether the dive may enter. */
export interface WorldNode<N extends LayoutInputNode = LayoutInputNode>
  extends PositionedNode<N> {
  /** Centre of this node's WORLD, absolute drawing units, after the mirror. */
  readonly worldX: number
  readonly worldY: number
  /** Diameter of this node's world, drawing units. */
  readonly worldD: number
  /** `kind` is 'root' | 'track' | 'entity' | 'cohort'. Only a structural node may be framed. */
  readonly structural: boolean
  /**
   * How much bigger than a leaf card's this node's authored drawing is —
   * `worldD / D_LEAF` for a leaf, and `HOLE_FRACTION·worldD / leafDiagonal` for
   * a node with children (see the header's two rules and `HOLE_FRACTION`).
   *
   * `width`/`height` already carry it. THE NUMBER ITSELF IS THE RENDERER'S
   * CONTRACT: a mark drawn inside `scale(cardScale)` is authored in LEAF UNITS,
   * so `width / cardScale` is the card the author wrote and every stroke, font
   * size and 44px target inside it is the leaf's, unscaled by depth. That
   * round-trip is asserted in worlds.test.ts because it is the seam this number
   * exists for.
   */
  readonly cardScale: number
  /**
   * The bearing this world sits on inside its PARENT's circle, radians, after
   * the mirror. 0 for the root, which sits on the hub and radiates every way.
   */
  readonly bearing: number
  /**
   * This world's slice of its parent's circle, radians, after the mirror.
   * `wedgeStart <= wedgeEnd` in both directions; siblings SHARE their boundaries
   * exactly (the same float, written once and read twice), so summing the
   * children of any node returns its parent's full turn with no residue. The
   * root's is `[0, 2π)`.
   *
   * MAP-ZOOM §4's MATCH RIM is drawn over these: "three in there, that way" is
   * the answer to the one thing a containment map genuinely cannot do, and it
   * needs the angle the child occupies rather than the point it sits on.
   */
  readonly wedgeStart: number
  readonly wedgeEnd: number
}

export interface WorldLayout<N extends LayoutInputNode = LayoutInputNode> {
  /** Pre-order, full depth. `aria-*` fields identical to `layoutMindtree`'s. */
  readonly nodes: readonly WorldNode<N>[]
  readonly byId: ReadonlyMap<string, WorldNode<N>>
  readonly edges: readonly MindtreeEdge[]
  readonly bounds: Bounds
  readonly maxDepth: number
  readonly rootD: number
  /**
   * Structural revision — changes iff the drawing changed, which is iff the TREE
   * changed (its shape, its ids, the sizes an encoding gave it) or the reading
   * direction did. The camera's one mount-time read of `bounds` is keyed on this
   * and on nothing else, which is what makes that arrow fire when the admin
   * edits the hierarchy and not when the reader breathes.
   */
  readonly revision: string
}

export interface WorldOptions<N extends LayoutInputNode = LayoutInputNode>
  extends Omit<LayoutOptions<N>, 'depthLimit' | 'expandAll'> {
  /** Authored size of a leaf card. Defaults to DEFAULT_NODE_SIZE. */
  leafSize?: NodeSize
  /**
   * Whether the dive may enter this node — see STRUCTURAL_KINDS. Defaults to
   * reading a `kind` field off the node when it has one, which is what the map
   * model carries, and to `true` when it has none.
   */
  structuralOf?: (node: N, depth: number) => boolean
  /**
   * SIZE AS A LINEAR MULTIPLE OF THIS NODE'S WORLD — the size encoding, at the
   * only altitude where it does not cost the reader a word.
   *
   * ⚠ THIS IS NOT `sizeOf`, AND THE DIFFERENCE IS THE WHOLE POINT. `sizeOf`
   * (layout.ts) authors a BIGGER BOX: a 400-item Organization comes back 252
   * units wide instead of 168. `MindNode` authors every mark it draws — the
   * 12.5-unit label, the count, the box stroke, the chevron — in the units of a
   * 168-wide leaf and carries them on the single `scale(cardScale)` transform
   * wave 1 introduced, so a box widened behind its back draws its label at
   * 168/252 = 0.667x the share of its own card the contract owes. Wave 5
   * measured that, refused the wiring, and named this seam as the fix:
   * Mindtree.tsx's `layout` memo and `useMapModel.collectSizes` both carry the
   * note. `pos.width / cardScale === leafSize.width` — worlds.test.ts's
   * round-trip — is the assertion that cannot survive `sizeOf` and is exactly
   * what this preserves.
   *
   * WHAT IT DOES INSTEAD. It multiplies the node's OWN WORLD (`ownD`), leaving
   * the authored card box alone. A bigger world takes a bigger share of its
   * parent's ring, and the two card rules then carry the card and every mark
   * inside it out with it, because `cardScale` is measured against the world
   * this node's card ALONE would need rather than against the world it got. So
   * the legend "size = open items" is true of the world, of the card, of the
   * label and of the 44px target simultaneously, and no glyph pays for it.
   *
   * ON A BRANCH IT IS A FLOOR, AND THAT IS NOT A GAP. A branch's world is
   * `max(its own, the world its children's ring needs)`, and the ring almost
   * always wins — so a hint on a department usually changes nothing. It does not
   * need to: a branch's world is ALREADY the size of what is inside it, which is
   * the same magnitude the hint would have encoded, drawn by containment for
   * free. The hint is therefore load-bearing exactly where containment says
   * nothing — a LEAF, which is every Organization at the altitude the reader
   * asks "who is busiest".
   *
   * A LINEAR FACTOR, NOT AN AREA. `1.5` is a card 1.5x wider and 1.5x taller —
   * 2.25x the area, which is the band `useMapModel.MAX_NODE_SIZE` already
   * measured and defended. The POLICY (which counts map to which factors, and
   * whether the ring's busiest sibling or the whole tree sets the scale) belongs
   * to the caller; this module only owes it geometry that stays legal.
   *
   * Anything not finite and positive is 1 — the same "sanitise, never throw"
   * bargain `buildLayoutNodes` strikes with a NaN out of an area encoding. Pure
   * and called once per node per layout, for `sizeOf`'s reason: a hint that
   * consulted a clock would make the drawing a function of when it was drawn.
   */
  sizeHintOf?: (node: N, depth: number) => number | undefined
}

// ── the entry point ────────────────────────────────────────────────────────

/**
 * Lay out the whole hierarchy, once, at full depth, in one absolute coordinate
 * space.
 *
 * NO CAMERA ARGUMENT, BY CONSTRUCTION. `layoutWorlds(tree)` is referentially
 * stable across every pan, zoom, tween, filter, band crossing and panel opening
 * this app can produce — a fact the type system states and worlds.test.ts pins,
 * because it is the property every other promise in MAP-ZOOM is built on.
 *
 * Every returned number is finite for every input this can be handed, including
 * sizes a divide-by-zero in an area encoding turned into NaN: `buildLayoutNodes`
 * sanitises those on the way in and `packRing` floors what it is given.
 */
export function layoutWorlds<N extends LayoutInputNode>(
  root: N,
  options: WorldOptions<N> = {},
): WorldLayout<N> {
  const leaf = resolveLeafSize(options.leafSize ?? options.nodeSize)
  const opts = resolveLayoutOptions<N>({
    ...options,
    nodeSize: leaf,
    // FULL DEPTH, ALWAYS. `depthLimit` is not a layout input for the canvas any
    // more — it stays alive in layout.ts for export.ts and MindtreeTable, which
    // still mean something by it.
    depthLimit: undefined,
    // The reader's collapse choices are not geometry. §2, and the reason the
    // "expand all" / "collapse all" pair could be cut: every child is already in
    // the drawing, waiting at its own distance.
    expandAll: true,
  })
  const work = buildLayoutNodes(root, opts, options.sizeOf)
  const count = work.length
  const rtl = opts.direction === 'rtl'

  const indexOf = new Map<string, number>()
  for (let i = 0; i < count; i += 1) indexOf.set(work[i].id, i)

  // ── the authored card, and the world one card alone would need ──────────
  // A card's world is proportional to its DIAGONAL, so a size encoding that
  // grows a card by area grows its world by area too and the legend — "size =
  // open items" — stays true of the world as well as of the box.
  //
  // TWO NUMBERS, NOT ONE, AND THE SECOND IS THE SIZE ENCODING. `cardD` is the
  // world THIS NODE'S CARD ALONE would need; `ownD` is the world it asks for.
  // They differ by `sizeHintOf` and by nothing else, so with no hint every
  // number below is the one it was before the option existed — which is what
  // lets the encoding land without moving a committed SVG until a caller opts
  // in. See `WorldOptions.sizeHintOf` for why the hint may not touch the
  // authored box.
  const leafDiag = Math.max(Math.hypot(leaf.width, leaf.height), 1e-6)
  const ownDiag: number[] = new Array<number>(count).fill(leafDiag)
  const cardD: number[] = new Array<number>(count).fill(D_LEAF)
  const ownD: number[] = new Array<number>(count).fill(D_LEAF)
  const hintOf = options.sizeHintOf
  // Null when nobody asked, so a layout with no encoding mixes nothing extra
  // into `revision` and hashes to the byte it hashed to before this option
  // existed — which is what lets the committed SVGs stay committed.
  const hints: number[] | null = hintOf === undefined ? null : new Array<number>(count).fill(1)
  for (let i = 0; i < count; i += 1) {
    const node = work[i]
    ownDiag[i] = Math.hypot(node.width, node.height)
    cardD[i] = Math.max(1e-6, (D_LEAF * ownDiag[i]) / leafDiag)
    if (hints === null) {
      ownD[i] = cardD[i]
      continue
    }
    hints[i] = sizeHint(hintOf?.(node.source, node.depth))
    ownD[i] = Math.max(1e-6, cardD[i] * hints[i])
  }

  // ── OUTWARD FROM THE LEAVES ─────────────────────────────────────────────
  // Pre-order puts every child AFTER its parent, so one reverse pass is a
  // complete post-order accumulation — the same trick partitionAngles uses, and
  // the reason this is O(n) rather than a second recursion.
  const worldD: number[] = new Array<number>(count).fill(D_LEAF)
  const ringRadiusOf: number[] = new Array<number>(count).fill(0)
  const ringBearings: (readonly number[])[] = new Array<readonly number[]>(count).fill([])
  const ringEdges: (readonly number[])[] = new Array<readonly number[]>(count).fill([])
  for (let i = count - 1; i >= 0; i -= 1) {
    const kids = work[i].children
    if (kids.length === 0) {
      worldD[i] = ownD[i]
      continue
    }
    const childD: number[] = new Array<number>(kids.length)
    let widest = 0
    for (let k = 0; k < kids.length; k += 1) {
      const d = worldD[indexOf.get(kids[k].id) as number]
      childD[k] = d
      if (d > widest) widest = d
    }
    const packed = packRing({ childD, gap: GAP_RATIO * widest })
    ringRadiusOf[i] = packed.radius
    ringBearings[i] = packed.bearings
    ringEdges[i] = packed.edges
    // `max` with the node's OWN card. It is no longer containment's guard — a
    // parent's card is HOLE_FRACTION of its world and cannot reach the rim from
    // the hub whatever it was authored at — so what it now buys is the SIZE
    // ENCODING on a branch: a branch whose card an encoding grew gets a world
    // grown with it, and the legend "size = open items" stays true of a
    // department as well as of an Organization. The ring is NOT scaled up with
    // it, which can only make the rim margin wider, never narrower.
    worldD[i] = Math.max(ownD[i], packed.parentD)
  }

  // ── THE TWO CARD RULES, ONCE ────────────────────────────────────────────
  // Computed here and read three times — by the placement loop, by every spoke
  // and by the bounds union — because a second `cardScale` anywhere is how a
  // card and the connector that has to meet it end up disagreeing about where
  // the card's edge is.
  const cardScaleOf: number[] = new Array<number>(count).fill(1)
  const cardW: number[] = new Array<number>(count).fill(0)
  const cardH: number[] = new Array<number>(count).fill(0)
  for (let i = 0; i < count; i += 1) {
    // `max(leafDiag, ownDiag)` is one word past the design's formula and it is
    // load-bearing: a branch card an encoding authored at TWICE the leaf would
    // otherwise carry a 0.68·worldD diagonal into a 0.36·worldD hole and put
    // defect 6 straight back. Below the leaf it is the design's formula
    // unchanged, so a smaller authored card yields a proportionally smaller one.
    //
    // AND `cardD` RATHER THAN `ownD` IS WHAT MAKES THE HINT CARRY THE MARKS. A
    // leaf's world IS its `ownD`, so dividing by `ownD` would answer 1 for every
    // leaf however big a hint it was given — a bigger empty world around the
    // same 168-unit card. Measuring against the world the card ALONE would need
    // makes the scale the hint itself, so the card, its label, its stroke and
    // its 44px target all come out `hint` times bigger and `pos.width /
    // cardScale` is still the authored leaf. With no hint the two are equal and
    // this is the line it has always been.
    const scale =
      work[i].children.length === 0
        ? worldD[i] / cardD[i]
        : (HOLE_FRACTION * worldD[i]) / Math.max(leafDiag, ownDiag[i])
    cardScaleOf[i] = scale
    cardW[i] = work[i].width * scale
    cardH[i] = work[i].height * scale
  }

  // ── DOWNWARD, PLACING WORLDS ────────────────────────────────────────────
  // Pre-order guarantees a parent's centre and its ring are known before its
  // children need them, so this is one linear pass. Coordinates are hub-relative
  // here and absolute after the mirror below.
  const wx: number[] = new Array<number>(count).fill(0)
  const wy: number[] = new Array<number>(count).fill(0)
  const bearing: number[] = new Array<number>(count).fill(0)
  const wedgeStart: number[] = new Array<number>(count).fill(0)
  const wedgeEnd: number[] = new Array<number>(count).fill(TAU)
  for (let i = 0; i < count; i += 1) {
    const kids = work[i].children
    if (kids.length === 0) continue
    const bearings = ringBearings[i]
    const edgesOfRing = ringEdges[i]
    const r = ringRadiusOf[i]
    // A world's ring is rotated to its OWN bearing, so a subtree keeps fanning
    // outward instead of doubling back through the hub it came from. The root
    // has no bearing of its own and starts at 0 — 3 o'clock in English, and 9
    // o'clock in Arabic once the mirror has run, which is the reading edge in
    // both scripts. Starting at 12 would mirror to 12, which is a symmetry that
    // says nothing.
    const rotation = i === 0 ? 0 : bearing[i]
    // The wedge boundaries come back out of `packRing` as a chain of SHARED
    // endpoints; `rotation + edges[k+1]` is computed ONCE per boundary and read
    // twice — as one child's end and as the next one's start — so the chain
    // survives the rotation exactly and the children still tile the full turn.
    let edge = rotation + edgesOfRing[0]
    for (let k = 0; k < kids.length; k += 1) {
      const ci = indexOf.get(kids[k].id) as number
      const b = rotation + bearings[k]
      const next = rotation + edgesOfRing[k + 1]
      bearing[ci] = b
      wedgeStart[ci] = edge
      wedgeEnd[ci] = next
      edge = next
      wx[ci] = wx[i] + r * Math.cos(b)
      wy[ci] = wy[i] + r * Math.sin(b)
    }
  }

  // ── THE MIRROR: θ → π − θ, ONE STATEMENT ────────────────────────────────
  // Reflecting a point about the hub's vertical line is the same operation as
  // reflecting its bearing about π/2, and both are written here, once. The hub
  // is its own fixed point EXACTLY — `hubX - 0 === hubX + 0` — which is what
  // makes the root's x byte-identical in both directions.
  const rootD = worldD[0]
  const bounds = boundsFor(rootD, work, wx, wy, cardW, cardH, bearing, indexOf)
  const hubX = bounds.width / 2
  const hubY = bounds.height / 2
  const px = (x: number): number => (rtl ? hubX - x : hubX + x)
  const py = (y: number): number => hubY + y
  const pt = (theta: number): number => (rtl ? Math.PI - theta : theta)

  const nodes: WorldNode<N>[] = []
  const byId = new Map<string, WorldNode<N>>()
  const edges: MindtreeEdge[] = []

  for (let i = 0; i < count; i += 1) {
    const node = work[i]
    const scale = cardScaleOf[i]
    const width = cardW[i]
    const height = cardH[i]
    const cx = px(wx[i])
    const cy = py(wy[i])
    const theta = pt(bearing[i])
    // The chevron anchor, CHEVRON_GAP past this node's own card along its ray,
    // expressed relative to the card's inline-start / top corner and in the same
    // already-mirrored space as x/y — MindNode reads it without touching a
    // direction. It scales with the card, so it sits the same distance out at
    // every depth, and it is CLAMPED TO THE WORLD'S RIM: a caller whose sizeOf
    // returns a card much smaller than the leaf gets a world small enough for
    // nine units to reach past it, and one mark escaping into a sibling's world
    // would break the only invariant this drawing has.
    const tip = Math.min(
      supportRadius(width / 2, height / 2, theta) + CHEVRON_GAP * scale,
      worldD[i] / 2,
    )
    const outward: Point = {
      x: width / 2 + tip * Math.cos(theta),
      y: height / 2 + tip * Math.sin(theta),
    }

    const positioned: WorldNode<N> = {
      id: node.id,
      node: node.source,
      depth: node.depth,
      x: cx - width / 2,
      y: cy - height / 2,
      width,
      height,
      parentId: node.parent === null ? null : node.parent.id,
      childIds: node.children.map((c) => c.id),
      index: node.index,
      // THE MODEL'S SIBLING COUNT, never the drawing's. A culled sibling must
      // not renumber the set, and that is the one way a DOM horizon could lie.
      siblingCount: node.parent === null ? 1 : node.parent.children.length,
      hasChildren: node.children.length > 0 || node.hiddenChildCount > 0,
      hasHiddenChildren: node.hiddenChildCount > 0,
      hiddenChildCount: node.hiddenChildCount,
      collapsed: node.source.collapsed === true,
      outward,
      worldX: cx,
      worldY: cy,
      worldD: worldD[i],
      structural: isStructural(node.source, node.depth, options.structuralOf),
      cardScale: scale,
      bearing: theta,
      // [π − end, π − start] under the mirror: the same reflection, applied to
      // the boundary chain, with the ends exchanged so start <= end holds in
      // both directions. Shared endpoints survive it — `π − x` is one rounding
      // of one float, and both readers of a boundary read the same one.
      wedgeStart: rtl ? Math.PI - wedgeEnd[i] : wedgeStart[i],
      wedgeEnd: rtl ? Math.PI - wedgeStart[i] : wedgeEnd[i],
    }
    nodes.push(positioned)
    byId.set(positioned.id, positioned)

    if (node.parent !== null) {
      const p = indexOf.get(node.parent.id) as number
      edges.push(
        spoke(node, work[p], {
          hubX: px(wx[p]),
          hubY: py(wy[p]),
          parentHalfW: cardW[p] / 2,
          parentHalfH: cardH[p] / 2,
          cx,
          cy,
          halfW: width / 2,
          halfH: height / 2,
          theta,
        }),
      )
    }
  }

  return {
    nodes,
    byId,
    edges,
    bounds,
    maxDepth: work.length === 0 ? 0 : maxDepthOf(work),
    rootD,
    revision: revisionOf(work, opts.direction, leaf, hints),
  }
}

// ── the two queries the camera and the breadcrumb ask ──────────────────────

/**
 * The deepest STRUCTURAL world containing `at` whose apparent diameter is at
 * least `frameFraction × viewportMinPx`.
 *
 * THIS IS THE BREADCRUMB, DERIVED. It is not state, so it cannot drift from the
 * picture, and the name hands off from the rim label to the crumb at the
 * `frameFraction` crossing and at no other instant. Pure, total, and null when
 * the camera is outside every world or too far out for any of them to be the
 * frame — which is a real answer ("you are above the workspace"), not a failure.
 */
export function worldAt<N extends LayoutInputNode>(
  layout: WorldLayout<N>,
  at: { readonly cx: number; readonly cy: number },
  scale: number,
  viewportMinPx: number,
  frameFraction: number = FRAME_FRACTION,
): WorldNode<N> | null {
  const fraction = Number.isFinite(frameFraction) && frameFraction > 0 ? frameFraction : FRAME_FRACTION
  const need = fraction * viewportMinPx
  const cx = at?.cx
  const cy = at?.cy
  // Every comparison below is false for a NaN, so a camera that has not been
  // measured yet returns null rather than a wrong world.
  let best: WorldNode<N> | null = null
  let bestDepth = -1
  for (const node of layout.nodes) {
    if (!node.structural) continue
    if (node.depth <= bestDepth) continue
    if (!(node.worldD * scale >= need)) continue
    const dx = cx - node.worldX
    const dy = cy - node.worldY
    const radius = node.worldD / 2
    if (!(dx * dx + dy * dy <= radius * radius)) continue
    best = node
    bestDepth = node.depth
  }
  return best
}

/**
 * The chain of worlds containing `id`, ROOT FIRST AND TARGET LAST, inclusive —
 * `FocusView.trail`'s shape exactly, so the breadcrumb renders one and the
 * keyboard walk reads the other with no adapter between them.
 *
 * Empty when the id is not in the drawing. The `seen` guard is not defensive
 * theatre: `byId` is a map, a caller may hand this a layout built from a
 * different tree, and an infinite walk in a render path is a hung tab.
 */
export function ancestorWorlds<N extends LayoutInputNode>(
  layout: WorldLayout<N>,
  id: string,
): readonly WorldNode<N>[] {
  const trail: WorldNode<N>[] = []
  const seen = new Set<string>()
  let node = layout.byId.get(id)
  while (node !== undefined && !seen.has(node.id)) {
    seen.add(node.id)
    trail.unshift(node)
    node = node.parentId === null ? undefined : layout.byId.get(node.parentId)
  }
  return trail
}

// ── the parts ──────────────────────────────────────────────────────────────

/**
 * The bounds: the ROOT WORLD'S SQUARE, unioned with every mark in the drawing
 * and padded symmetrically about the hub.
 *
 * The union is not ceremony. A radial cubic genuinely LEAVES the union of its
 * endpoint rects — unlike a horizontal S-curve, whose controls share their
 * endpoints' y — and missing it clips connectors at the drawing's own margin, in
 * the export as well as on screen. It happens to be free here, because
 * containment already puts every mark inside the root disc, and that is exactly
 * why it is computed rather than assumed: the day a mark escapes, the bounds
 * grow instead of the picture being cropped.
 *
 * PADDED SYMMETRICALLY ABOUT THE HUB, which is the precondition for the mirror
 * being an equality rather than an equality to nine places.
 */
function boundsFor<N extends LayoutInputNode>(
  rootD: number,
  work: readonly LayoutWorkNode<N>[],
  wx: readonly number[],
  wy: readonly number[],
  cardW: readonly number[],
  cardH: readonly number[],
  bearing: readonly number[],
  indexOf: ReadonlyMap<string, number>,
): Bounds {
  let spanX = rootD / 2
  let spanY = rootD / 2
  const see = (x: number, y: number): void => {
    const ax = Math.abs(x)
    const ay = Math.abs(y)
    if (Number.isFinite(ax) && ax > spanX) spanX = ax
    if (Number.isFinite(ay) && ay > spanY) spanY = ay
  }
  for (let i = 0; i < work.length; i += 1) {
    const node = work[i]
    const halfW = cardW[i] / 2
    const halfH = cardH[i] / 2
    see(wx[i] - halfW, wy[i] - halfH)
    see(wx[i] + halfW, wy[i] + halfH)
    if (node.parent === null) continue
    const p = indexOf.get(node.parent.id) as number
    // The spoke's four points, in the same hub-relative space, BEFORE the
    // mirror — from the identical function that emits them, not from an
    // estimate of where they probably are. A support radius reads |cos| and
    // |sin|, so θ and π − θ give the same one and the pre-mirror answer is the
    // post-mirror answer reflected, which is what lets this run here at all.
    const points = spokePoints({
      hubX: wx[p],
      hubY: wy[p],
      parentHalfW: cardW[p] / 2,
      parentHalfH: cardH[p] / 2,
      cx: wx[i],
      cy: wy[i],
      halfW,
      halfH,
      theta: bearing[i],
    })
    see(points.c1.x, points.c1.y)
    see(points.c2.x, points.c2.y)
    see(points.start.x, points.start.y)
  }
  const width = 2 * spanX
  const height = 2 * spanY
  return { minX: 0, minY: 0, maxX: width, maxY: height, width, height }
}

/**
 * One connector, as four points, from the CARD at the hub of a world to the card
 * of one of its children.
 *
 * A containment drawing has little need of connectors — the child being INSIDE
 * the parent is the statement the edge would have made — so U2 is free to draw
 * none. It is emitted anyway because `export.ts`'s serialiser and `MindEdge`
 * both take a four-point edge, because a spoke is the honest reading of a ring's
 * structure at the one band where a world's interior is drawn and its card is
 * not, and because a missing edge list would be a second shape for a caller to
 * branch on. Both ends leave and arrive RADIALLY, so a connector meets a box
 * square-on at every zoom.
 */
function spoke<N extends LayoutInputNode>(
  node: LayoutWorkNode<N>,
  parent: LayoutWorkNode<N>,
  input: SpokeInput,
): MindtreeEdge {
  const points = spokePoints(input)
  return {
    id: `${parent.id}->${node.id}`,
    parentId: parent.id,
    childId: node.id,
    depth: node.depth,
    start: points.start,
    end: points.end,
    c1: points.c1,
    c2: points.c2,
  }
}

interface SpokeInput {
  readonly hubX: number
  readonly hubY: number
  readonly parentHalfW: number
  readonly parentHalfH: number
  readonly cx: number
  readonly cy: number
  readonly halfW: number
  readonly halfH: number
  readonly theta: number
}

/**
 * The four points, in whatever space the caller is working in.
 *
 * BOTH ENDS SIT ON A CARD'S OUTLINE — defect 15 of the render harness. The
 * connector used to leave from the parent's world CENTRE, which was harmless
 * only for as long as the parent's card covered its own ring anyway: once the
 * card is inscribed in the hole (HOLE_FRACTION), a spoke from the centre is a
 * line drawn out from under a box, and the arrowless end of it is visible ink
 * inside the card at every band where both are drawn. `supportRadius` at the
 * bearing is the same anchor the polar layout already uses on the far end
 * (radial.ts's `layoutMindtreeRadial`, which anchors both ends this way), so the
 * two shapes meet a box at the identical point.
 *
 * ONE FUNCTION, TWO CALLERS — the edge list and the bounds union. The union
 * exists to catch a mark escaping the drawing's margin, and a union computed
 * from an ESTIMATE of where the control points are cannot catch anything.
 */
function spokePoints(input: SpokeInput): {
  readonly start: Point
  readonly end: Point
  readonly c1: Point
  readonly c2: Point
} {
  const { hubX, hubY, cx, cy, theta } = input
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  const sTip = supportRadius(input.parentHalfW, input.parentHalfH, theta)
  const eTip = supportRadius(input.halfW, input.halfH, theta)
  const sx = hubX + sTip * cos
  const sy = hubY + sTip * sin
  const ex = cx - eTip * cos
  const ey = cy - eTip * sin
  // The run is the distance actually covered. It can be zero or less when a
  // child's world swallows its parent's hub — one enormous sibling beside a
  // small one, or the lone child of SINGLE_CHILD_RATIO, whose world covers the
  // hub by construction — and a negative run would draw a connector pointing
  // backwards through the card it came from, so it is clamped rather than
  // trusted. Clamped to zero the spoke is a straight segment, which is the
  // honest drawing of two cards that are already touching.
  const run = Math.max(0, (ex - sx) * cos + (ey - sy) * sin) * EDGE_CURVE
  return {
    start: { x: sx, y: sy },
    end: { x: ex, y: ey },
    c1: { x: sx + run * cos, y: sy + run * sin },
    c2: { x: ex - run * cos, y: ey - run * sin },
  }
}

/**
 * Structural revision — a hash of everything the geometry is a function of, and
 * of nothing else.
 *
 * FNV-1a over the pre-order walk: id, depth, fan-out and authored size per node,
 * then the direction and the leaf card. Two different trees colliding on a
 * 32-bit hash would cost the camera one stale mount-time framing, and the length
 * prefix makes even that require a collision at equal node counts.
 */
function revisionOf<N extends LayoutInputNode>(
  work: readonly LayoutWorkNode<N>[],
  direction: string,
  leaf: NodeSize,
  /**
   * The size hints, or null when the caller gave none. MIXED IN, because a hint
   * is geometry — a ring whose busiest sibling changed count is a different
   * drawing and the camera's one mount-time read of `bounds` is keyed on this
   * string alone. Null rather than an array of ones so a caller who never asked
   * for the encoding hashes exactly what it hashed before the option existed.
   */
  hints: readonly number[] | null,
): string {
  let h = 0x811c9dc5
  const mix = (v: number): void => {
    h = Math.imul(h ^ (v & 0xff), 0x01000193) >>> 0
    h = Math.imul(h ^ ((v >>> 8) & 0xffff), 0x01000193) >>> 0
  }
  const mixText = (s: string): void => {
    for (let i = 0; i < s.length; i += 1) mix(s.charCodeAt(i))
    mix(s.length)
  }
  mixText(direction)
  mixText(`${leaf.width}x${leaf.height}`)
  for (let i = 0; i < work.length; i += 1) {
    const node = work[i]
    mixText(node.id)
    mix(node.depth)
    mix(node.children.length)
    mix(node.hiddenChildCount)
    mixText(`${node.width}x${node.height}`)
    // ONLY WHEN IT IS NOT 1, so `revision` keeps its actual contract: it
    // changes iff the DRAWING changed. A hint of 1 draws what no hint draws, so
    // a caller who wired the encoding and a caller who did not must hash alike
    // — otherwise the camera's one mount-time read of `bounds` re-fires the
    // frame the first time an encoding answers "no opinion" for every node.
    if (hints !== null && hints[i] !== 1) mixText(`h${hints[i]}`)
  }
  return `w1.${work.length}.${h.toString(36)}`
}

/**
 * A size hint, made safe — see `WorldOptions.sizeHintOf`.
 *
 * SANITISED RATHER THAN VALIDATED, which is `buildLayoutNodes`' bargain with the
 * same class of caller: an area encoding that divided by a zero denominator
 * hands this a NaN, and a drawing that throws is worse than a drawing that draws
 * the node at its floor. `undefined` is the encoding declining to speak about
 * this node, which is a legitimate answer and the same one `sizeOf` gives.
 *
 * CAPPED, and the cap is about containment rather than taste. A world is placed
 * in its parent's ring by `packRing`, which handles any finite diameter, so a
 * pathological hint cannot break the invariant — it can only spend the whole
 * drawing on one node, pushing every sibling below the DOM horizon to say one
 * thing loudly. `MAX_SIZE_HINT` is `useMapModel.MAX_NODE_SIZE`'s 1.5 with a
 * factor of four of headroom for a caller with a wider band and a measured
 * reason, and the number the packing math was published against.
 */
const MAX_SIZE_HINT = 6

function sizeHint(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw) || raw <= 0) return 1
  return Math.min(raw, MAX_SIZE_HINT)
}

function isStructural<N extends LayoutInputNode>(
  node: N,
  depth: number,
  structuralOf?: (node: N, depth: number) => boolean,
): boolean {
  if (structuralOf !== undefined) return structuralOf(node, depth) === true
  const kind = (node as N & { readonly kind?: unknown }).kind
  if (typeof kind !== 'string') return true
  return STRUCTURAL_KINDS.has(kind)
}

function maxDepthOf<N extends LayoutInputNode>(work: readonly LayoutWorkNode<N>[]): number {
  let max = 0
  for (const node of work) if (node.depth > max) max = node.depth
  return max
}

function resolveLeafSize(size: Partial<NodeSize> | undefined): NodeSize {
  const width = size?.width
  const height = size?.height
  return {
    width: typeof width === 'number' && Number.isFinite(width) && width > 0 ? width : DEFAULT_NODE_SIZE.width,
    height:
      typeof height === 'number' && Number.isFinite(height) && height > 0
        ? height
        : DEFAULT_NODE_SIZE.height,
  }
}

/**
 * How far a box's own edge is from its centre along the bearing θ — the support
 * function of an axis-aligned rectangle, restated from radial.ts (it is private
 * there) so the two shapes anchor a connector at the same point on a box.
 */
function supportRadius(halfWidth: number, halfHeight: number, theta: number): number {
  const cos = Math.abs(Math.cos(theta))
  const sin = Math.abs(Math.sin(theta))
  let t = Number.POSITIVE_INFINITY
  if (cos >= 1e-9) t = Math.min(t, halfWidth / cos)
  if (sin >= 1e-9) t = Math.min(t, halfHeight / sin)
  return Number.isFinite(t) ? t : halfWidth
}
