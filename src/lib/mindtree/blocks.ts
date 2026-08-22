// THE BLOCK CONTAINERS — one rounded rectangle per parent, enclosing everything
// beneath it, and one short stub from the parent's card into it.
//
// ── WHY THIS FILE EXISTS AT ALL: WHAT PER-CHILD CONNECTORS DID TO A WRAPPED
//    GRID ──────────────────────────────────────────────────────────────────
//
// `layoutMindtree({ orientation: 'vertical', wrap: true })` puts a parent's
// children in a BLOCK of rows rather than one long line, and that is the
// decided drawing: 396 organizations in one row per parent is a canvas
// thirty-six screens wide, and the same 396 in a grid is a page you scroll.
// The connector geometry the layout also emits — four points per child, a cubic
// out of the parent's bottom face into the child's top face — was written for
// the ONE-ROW drawing, where it is right: every child is on the same rank, the
// curves fan out symmetrically and none of them crosses a card.
//
// In a wrapped grid the same four points produce a mess, and the picture
// harness (`src/pages/map/treeRender.test.tsx`) is where it was read off rather
// than argued:
//
//  · A CURVE TO A CHILD ON THE SECOND ROW HAS TO CROSS THE FIRST ROW. There is
//    no route from the parent's bottom face to a card two ranks down that does
//    not pass THROUGH the cards in between, and the cubic takes the shortest
//    one — straight over them. In the baseline picture `Org 023` and
//    `Org 029 → 030` are each crossed by a connector belonging to somebody
//    else's parent.
//  · NEIGHBOURING BLOCKS PUT THEIR HORIZONTAL RUNS AT THE SAME HEIGHT, because
//    the layout is a uniform grid and every parent's bottom face is on the same
//    rank. Six parents' fans then merge into continuous rules that read as TABLE
//    BORDERS — you can see rows, and you cannot see which parent owns which
//    row. The hierarchy is present in the coordinates and absent from the
//    picture, which is the same sentence `layout.ts`'s `gap.group` was
//    introduced to fix and the same defect arriving one level up.
//  · AND THERE ARE AS MANY LINES AS THERE ARE NODES. 152 curves for 153 cards.
//    Any one of them is legible; all of them at once is a hairball.
//
// The replacement is the one a printed org chart has used for a century: draw
// the GROUP, not the membership. Each parent gets ONE container enclosing its
// whole subtree, painted behind the cards; the parent is joined to that
// container by ONE short stub; and nothing else is drawn. Containment says
// "these belong to that" more plainly than a line can, because a line has to
// cross every sibling to get where it is going and a boundary does not.
//
// ── WHY THE CONTAINER ENCLOSES THE WHOLE SUBTREE AND NOT JUST THE CHILDREN ──
//
// This is the decision that makes the drawing read as a hierarchy rather than
// as five unrelated bands, and it was got wrong first, so it is written down.
//
// A container around a parent's CHILDREN ALONE encloses one rank: the three
// books under a directorate, and nothing else. The four types under each book
// then get their own containers one rank further down, OUTSIDE the first one,
// because the types are not inside the books' row — they are below it. Nothing
// nests, and the drawing is a stack of horizontal bands whose only remaining
// cue is proximity, which is exactly the cue the wrapped grid already spent.
//
// A container around the parent's whole DESCENDANT SET encloses the books' row
// AND the types' rows AND the organizations' rows — so the book's own container
// falls strictly inside the directorate's, and the type's inside the book's.
// The rectangles nest four deep, and that nesting IS the tree: a reader
// following a boundary inward is walking down the hierarchy, and one following
// it outward is walking up. It costs nothing extra to compute (the union is
// taken bottom-up in one pass) and it is the whole payoff.
//
// The parent's OWN card is deliberately not in its own container. A container
// is the answer to "what is under this", and a box that also contained the
// question would put every card inside a rectangle of its own, at every level,
// which is a border per card and not a grouping.
//
// ── PADDING, AND WHY IT SHRINKS WITH DEPTH ─────────────────────────────────
//
// Two constraints, both arithmetic, both stated as numbers so the next reader
// can check them against `layout.ts`'s own gaps rather than trust a taste.
//
//  1. TWO SIBLING CONTAINERS MUST NOT TOUCH. `DEFAULT_GAP.group` is 36 units —
//     `layout.ts` argues it at length: the clearance between two sibling CELLS
//     that are themselves blocks, three times the 12 between two cards inside
//     one. A container inflates its subtree's bounds by `pad` on every side, so
//     two siblings close to `2 x pad`; the channel left between them is
//     `36 - 2 x pad` and it has to stay visibly positive.
//  2. A CHILD'S CONTAINER MUST NOT SHARE AN EDGE WITH ITS PARENT'S. On the
//     extreme flank of a block the outermost descendant is the same card for
//     both — the leftmost organization under a book is also the leftmost
//     organization under its directorate — so with one uniform `pad` the two
//     rectangles' left edges land on the SAME coordinate and the nesting
//     disappears into a doubled stroke exactly where it is most needed.
//
// `PAD_AT` satisfies both: 15 · 12 · 9 · 6 units for the containers around
// depth 1 · 2 · 3 · 4, floored at 6 below that. Constraint 1 leaves channels of
// 12 · 18 · 24 units (the depth-1 container has no sibling — there is one root,
// so there is one of it). Constraint 2 leaves a 3-unit inset per level, which
// at 1:1 is three pixels of daylight between two 1-unit strokes.
//
// SHRINKING RATHER THAN GROWING, and the direction is the readable one: the
// outermost container is the loosest, which is what a boundary around a whole
// directorate should look like, and the innermost is snug around its row of
// organizations, which is what a boundary around five cards should look like.
// Growing inward would put the tightest box around the biggest thing.
//
// ── AND WHY THE STUB IS ONE LINE AND NOT A FAN ─────────────────────────────
//
// The parent's card sits on the sibling axis' centre of its own block (the tidy
// tree centres a parent over its children), so a single segment from the card's
// depth-end face to the container's depth-start face is both the shortest and
// the only unambiguous connector in the drawing: it touches exactly two things,
// it crosses nothing, and it is the same mark at every level. The clamp below
// keeps it landing on the container even for a layout that does NOT centre its
// parents — the arithmetic is total over any `DrawnLayout`, including one a
// caller assembled by hand.
//
// NOTHING HERE KNOWS ABOUT A CAMERA, A THEME OR A COLOUR. It is geometry over a
// `DrawnLayout`, in drawing units, already mirrored — the same contract
// `layout.ts` states for `edgePath`, and the reason RTL costs this file zero
// lines: `x` arrives mirrored and every number below is derived from it.

import type { Bounds, DrawnLayout, LayoutInputNode } from './layout'

/**
 * The segment joining a parent's card to its container, in drawing units.
 *
 * A PAIR OF POINTS AND NOT A PATH STRING, for the reason `MindtreeEdge` is four
 * points and not a `d`: the renderer decides whether that is a line, an elbow or
 * a curve, and a geometry module that emitted markup would have to be edited to
 * change a drawing decision.
 */
export interface BlockStub {
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
}

/** One parent's container: the rectangle, its corner radius and its stub. */
export interface MindBlock {
  /**
   * `block:<parentId>`. Distinct from every node id by construction (a node id
   * is a bucket key or an entity id, and neither is minted with this prefix),
   * so a React key drawn from it cannot collide with a node's.
   */
  readonly id: string
  /** The node this container holds the descendants OF. */
  readonly parentId: string
  /**
   * The depth of the container's OWN rank — the parent's depth plus one, i.e.
   * the depth of the children it starts with. It is what `PAD_AT` was indexed
   * by and what the sheet fades the border width on, so it is published rather
   * than recomputed at the use site from `parentId`.
   */
  readonly depth: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  /** The corner radius the container is drawn with, in the same units. */
  readonly rx: number
  /**
   * Null when the parent's card overlaps its own container — which no layout
   * this app ships produces, and which a hand-assembled `DrawnLayout` can. A
   * stub with no clear side to leave from is not a shorter stub; it is a mark
   * pointing at nothing, and the renderer draws nothing at all for it.
   */
  readonly stub: BlockStub | null
}

/**
 * Inflation applied to a container's contents, indexed by the container's own
 * depth (1 = the root's children). Read through `padAt`, which floors it.
 *
 * See the header for the two constraints these four numbers satisfy and for the
 * `DEFAULT_GAP.group` = 36 they are cut against. They are DRAWING UNITS, like
 * every other number in `layout.ts`, and they are deliberately NOT a function of
 * the resolved options: `DrawnLayout` does not publish `options` (only
 * `MindtreeLayout` does, and `worlds.ts` deliberately publishes none), so a
 * container that read the gap would work for one of the two layouts that
 * satisfy the shared interface and throw for the other.
 */
const PAD_AT: readonly number[] = [15, 15, 12, 9, 6]

/** The floor `PAD_AT` runs out into, for a tree deeper than the table. */
const PAD_MIN = 6

function padAt(depth: number): number {
  const listed = PAD_AT[depth]
  return listed === undefined ? PAD_MIN : listed
}

/**
 * Every parent's container, in `layout.nodes`' own order — which is pre-order,
 * so a parent's container is always emitted BEFORE its children's.
 *
 * THAT ORDERING IS A PAINT ORDER AND NOT A CONVENIENCE. SVG has no z-index and
 * paint order is document order, so an inner container drawn before its outer
 * one would be covered by it and the nesting the whole design rests on would be
 * invisible. Handing the list back in the order it must be painted means the
 * renderer emits `blocks.map(...)` and gets the layering for free, exactly as
 * `MapCanvas` gets its rim-before-nodes layering from where the block sits in
 * the JSX rather than from a sort.
 *
 * ONE PASS, BOTTOM-UP. The subtree bounds of every node are accumulated by
 * walking `layout.nodes` in REVERSE — pre-order reversed visits every child
 * before its parent — so the union each parent needs is already computed when
 * it is reached. `subtreeBounds()` per parent would have been the obvious
 * spelling and is O(n x depth): it re-walks the whole of a directorate's
 * subtree for the directorate, again for each book, and again for each type. On
 * the 3,200-node workspace that is the difference between one pass and five.
 *
 * TOTAL OVER ANY `DrawnLayout`. A `childIds` entry that names a node the layout
 * does not hold is skipped rather than trusted; a parent whose children all
 * vanish that way emits no container rather than an empty rectangle at the
 * origin. `buildLayoutNodes` already guarantees neither can happen for a layout
 * this app produces — this is the same discipline `subtreeBounds` states for
 * its own visited set, applied to the same class of caller.
 */
export function blocksOf<N extends LayoutInputNode>(
  layout: DrawnLayout<N>,
): readonly MindBlock[] {
  /** Subtree bounds INCLUDING the node's own card, by id. */
  const subtree = new Map<string, Bounds>()
  /** The union of the children's subtrees — the container's contents. */
  const contents = new Map<string, Bounds>()

  for (let i = layout.nodes.length - 1; i >= 0; i -= 1) {
    const pos = layout.nodes[i]
    if (pos === undefined) continue
    let box: Bounds | null = null
    for (const childId of pos.childIds) {
      const childBounds = subtree.get(childId)
      if (childBounds === undefined) continue
      box = box === null ? childBounds : union(box, childBounds)
    }
    if (box !== null) contents.set(pos.id, box)
    const own = boundsOf(pos.x, pos.y, pos.width, pos.height)
    subtree.set(pos.id, box === null ? own : union(own, box))
  }

  const blocks: MindBlock[] = []
  for (const pos of layout.nodes) {
    const box = contents.get(pos.id)
    if (box === undefined) continue
    const depth = pos.depth + 1
    const pad = padAt(depth)
    const x = box.minX - pad
    const y = box.minY - pad
    const width = box.width + pad * 2
    const height = box.height + pad * 2
    blocks.push({
      id: `block:${pos.id}`,
      parentId: pos.id,
      depth,
      x,
      y,
      width,
      height,
      // The radius follows the padding, so the corner curls around the outermost
      // card at the same distance the flanks clear it by and the container reads
      // as one shape rather than as a rectangle with rounded corners bolted on.
      rx: Math.max(PAD_MIN, pad),
      stub: stubBetween(pos.x, pos.y, pos.width, pos.height, x, y, width, height),
    })
  }
  return blocks
}

/**
 * The one segment from a card's depth-end face to the container's near face.
 *
 * WHICH FACE IS DECIDED BY THE GEOMETRY, NOT BY AN ORIENTATION FLAG, and that
 * is what makes this file indifferent to `orientation` and to `direction`
 * alike: a vertical tree puts the container below the card, a horizontal one
 * puts it after the card, an RTL horizontal one puts it before — and all three
 * are the same question ("which side is the container on") asked of numbers
 * that have already been mirrored. A flag would be a second copy of a fact the
 * coordinates already carry, and the copy is what goes stale.
 *
 * The order of the four tests is the order of the app's own drawings: below
 * first (the vertical tidy tree this was built for), then above, then the two
 * inline sides. Overlapping is last and yields null — see `MindBlock.stub`.
 */
function stubBetween(
  cardX: number,
  cardY: number,
  cardW: number,
  cardH: number,
  boxX: number,
  boxY: number,
  boxW: number,
  boxH: number,
): BlockStub | null {
  const cx = cardX + cardW / 2
  const cy = cardY + cardH / 2
  if (boxY >= cardY + cardH) {
    const x = clamp(cx, boxX, boxX + boxW)
    return { x1: cx, y1: cardY + cardH, x2: x, y2: boxY }
  }
  if (boxY + boxH <= cardY) {
    const x = clamp(cx, boxX, boxX + boxW)
    return { x1: cx, y1: cardY, x2: x, y2: boxY + boxH }
  }
  if (boxX >= cardX + cardW) {
    const y = clamp(cy, boxY, boxY + boxH)
    return { x1: cardX + cardW, y1: cy, x2: boxX, y2: y }
  }
  if (boxX + boxW <= cardX) {
    const y = clamp(cy, boxY, boxY + boxH)
    return { x1: cardX, y1: cy, x2: boxX + boxW, y2: y }
  }
  return null
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value
}

function boundsOf(x: number, y: number, width: number, height: number): Bounds {
  return { minX: x, minY: y, maxX: x + width, maxY: y + height, width, height }
}

function union(a: Bounds, b: Bounds): Bounds {
  const minX = Math.min(a.minX, b.minX)
  const minY = Math.min(a.minY, b.minY)
  const maxX = Math.max(a.maxX, b.maxX)
  const maxY = Math.max(a.maxY, b.maxY)
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
}
