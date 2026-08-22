// The block containers, asserted as GEOMETRY — the four properties the drawing
// rests on, each stated as a claim a picture cannot make.
//
// A picture can show that the containers look right on one fixture at one zoom.
// It cannot show that no two of them touch, that every one of them nests inside
// its parent's, or that the stub lands on the face it aims at — those are
// claims about ALL of them, and they are what this file holds. The pictures
// (`src/pages/map/treeRender.test.tsx`) and these assertions answer two
// different questions and neither replaces the other.
//
// THE FIXTURE IS THE PICTURE HARNESS'S SHAPE, ONE LEVEL SMALLER: root → 2 → 3 →
// 4 → 5 is 153 nodes and this is root → 2 → 3 → 2 → 2, which exercises the same
// four container depths, the same wrap and the same `gap.group` boundary at a
// size a failure message can be read at. It is laid out by the REAL
// `layoutMindtree` with the REAL options the app passes, because a hand-placed
// layout would let this file agree with itself about coordinates the drawing
// never sees.

import { describe, expect, it } from 'vitest'
import { blocksOf } from './blocks'
import { layoutMindtree, type LayoutInputNode } from './layout'

interface Fixture extends LayoutInputNode {
  readonly id: string
  readonly children: readonly Fixture[]
}

function fixture(): Fixture {
  const kids = (id: string, count: number, make: (child: string) => Fixture): Fixture => ({
    id,
    children: Array.from({ length: count }, (_, i) => make(`${id}.${i}`)),
  })
  return kids('root', 2, (d) =>
    kids(d, 3, (b) => kids(b, 2, (t) => kids(t, 2, (o) => ({ id: o, children: [] })))),
  )
}

const LAID_OUT = layoutMindtree<Fixture>(fixture(), {
  orientation: 'vertical',
  wrap: true,
  direction: 'ltr',
})

const MIRRORED = layoutMindtree<Fixture>(fixture(), {
  orientation: 'vertical',
  wrap: true,
  direction: 'rtl',
})

const ACROSS = layoutMindtree<Fixture>(fixture(), { wrap: true, direction: 'ltr' })

/** Do two rectangles share any area at all? Touching edges do not count. */
function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  )
}

function contains(
  outer: { x: number; y: number; width: number; height: number },
  inner: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  )
}

describe('blocksOf', () => {
  const blocks = blocksOf(LAID_OUT)
  const byParent = new Map(blocks.map((block) => [block.parentId, block]))

  it('draws one container for every parent and none for a leaf', () => {
    const parents = LAID_OUT.nodes.filter((pos) => pos.childIds.length > 0)
    expect(blocks).toHaveLength(parents.length)
    expect(new Set(blocks.map((block) => block.parentId))).toEqual(
      new Set(parents.map((pos) => pos.id)),
    )
    // A leaf is the end of the dive and has nothing to enclose. An empty
    // rectangle at its card would be a border per card, which is the drawing
    // the containers exist to avoid.
    for (const pos of LAID_OUT.nodes) {
      if (pos.childIds.length === 0) expect(byParent.has(pos.id)).toBe(false)
    }
  })

  it('encloses the whole SUBTREE, not just the children — which is what nests', () => {
    for (const block of blocks) {
      const parent = LAID_OUT.byId.get(block.parentId)
      expect(parent).toBeDefined()
      if (parent === undefined) continue
      // Every descendant's card, at every depth, is inside. The grandchild is
      // the interesting one: a container around the children alone would fail
      // here, and that container is the one that produced a stack of bands
      // instead of a hierarchy.
      const pending = [...parent.childIds]
      let descendants = 0
      while (pending.length > 0) {
        const id = pending.pop() as string
        const pos = LAID_OUT.byId.get(id)
        if (pos === undefined) continue
        descendants += 1
        expect(contains(block, pos), `${id} escapes ${block.id}`).toBe(true)
        pending.push(...pos.childIds)
      }
      expect(descendants).toBeGreaterThan(0)
      // …and the parent's OWN card is not in it. A container answers "what is
      // under this", and one that also held the question would be a box round
      // every card in the drawing.
      expect(contains(block, parent)).toBe(false)
    }
  })

  it('nests: a child parent`s container falls strictly inside its own parent`s', () => {
    for (const block of blocks) {
      const parent = LAID_OUT.byId.get(block.parentId)
      if (parent === undefined || parent.parentId === null) continue
      const outer = byParent.get(parent.parentId)
      expect(outer, `${parent.parentId} has no container`).toBeDefined()
      if (outer === undefined) continue
      expect(contains(outer, block), `${block.id} escapes ${outer.id}`).toBe(true)
      // STRICTLY inside, on the flanks as well: two boundaries landing on the
      // same coordinate read as one doubled stroke exactly where the nesting is
      // supposed to be visible, and that is what the shrinking padding ladder
      // in blocks.ts exists to prevent.
      expect(block.x).toBeGreaterThan(outer.x)
      expect(block.x + block.width).toBeLessThan(outer.x + outer.width)
    }
  })

  it('never lets two containers on the same rank touch', () => {
    const ranks = new Map<number, typeof blocks>()
    for (const block of blocks) {
      ranks.set(block.depth, [...(ranks.get(block.depth) ?? []), block])
    }
    for (const [depth, rank] of ranks) {
      for (let i = 0; i < rank.length; i += 1) {
        for (let j = i + 1; j < rank.length; j += 1) {
          const a = rank[i]
          const b = rank[j]
          if (a === undefined || b === undefined) continue
          expect(overlaps(a, b), `depth ${depth}: ${a.id} overlaps ${b.id}`).toBe(false)
        }
      }
    }
  })

  it('runs one stub from the parent`s block-end face to the container`s block-start face', () => {
    for (const block of blocks) {
      const parent = LAID_OUT.byId.get(block.parentId)
      if (parent === undefined) continue
      expect(block.stub).not.toBeNull()
      if (block.stub === null) continue
      // Vertical tree: the children are BELOW, so the stub leaves the card's
      // bottom edge and arrives on the container's top edge. It is a real
      // segment — a zero-length stub would be a mark nobody can see saying the
      // one thing the container cannot say for itself.
      expect(block.stub.y1).toBe(parent.y + parent.height)
      expect(block.stub.y2).toBe(block.y)
      expect(block.stub.y2).toBeGreaterThan(block.stub.y1)
      // …and it starts at the card's own centre, which is where the tidy tree
      // put the card relative to the block it owns.
      expect(block.stub.x1).toBeCloseTo(parent.x + parent.width / 2, 6)
      // The far end is on the container, always — the clamp, doing its job even
      // where a layout does not centre its parents.
      expect(block.stub.x2).toBeGreaterThanOrEqual(block.x)
      expect(block.stub.x2).toBeLessThanOrEqual(block.x + block.width)
    }
  })

  it('costs RTL nothing, because the coordinates arrive mirrored', () => {
    // The same containers, the same sizes, in the mirror. Asserting the SET of
    // rectangle sizes rather than their positions is the honest form of the
    // claim: `layout.ts` mirrors x, so every container moves and none changes
    // shape, and a test that expected the positions to match would be asserting
    // that the mirror does not work.
    const mirrored = blocksOf(MIRRORED)
    expect(mirrored).toHaveLength(blocks.length)
    const shape = (list: readonly { width: number; height: number; depth: number }[]): string =>
      list
        .map((b) => `${b.depth}:${b.width.toFixed(3)}x${b.height.toFixed(3)}`)
        .sort()
        .join('|')
    expect(shape(mirrored)).toBe(shape(blocks))
    // And every stub still lands on its container.
    for (const block of mirrored) {
      expect(block.stub).not.toBeNull()
      if (block.stub === null) continue
      expect(block.stub.x2).toBeGreaterThanOrEqual(block.x)
      expect(block.stub.x2).toBeLessThanOrEqual(block.x + block.width)
    }
  })

  it('reads the side off the geometry, so a horizontal tree stubs sideways', () => {
    // No orientation flag reaches this module — see `stubBetween`. The proof is
    // that the horizontal drawing, which this file never mentions to it, comes
    // out with inline stubs and no vertical ones.
    const across = blocksOf(ACROSS)
    expect(across.length).toBeGreaterThan(0)
    for (const block of across) {
      const parent = ACROSS.byId.get(block.parentId)
      if (parent === undefined || block.stub === null) continue
      expect(block.stub.x1).toBe(parent.x + parent.width)
      expect(block.stub.x2).toBe(block.x)
      expect(block.stub.y1).toBeCloseTo(parent.y + parent.height / 2, 6)
    }
  })

  it('hands the containers back in paint order — every parent before its child', () => {
    const seen = new Set<string>()
    for (const block of blocks) {
      const parent = LAID_OUT.byId.get(block.parentId)
      if (parent?.parentId != null && byParent.has(parent.parentId)) {
        expect(seen.has(`block:${parent.parentId}`), `${block.id} is painted too early`).toBe(true)
      }
      seen.add(block.id)
    }
  })

  it('is total over a layout whose childIds name nodes it does not hold', () => {
    // A hand-assembled `DrawnLayout` is a shape the type permits and
    // `buildLayoutNodes` never produces. A dangling child is skipped, and a
    // parent left with nothing real under it emits no container rather than a
    // rectangle at the origin.
    const only = LAID_OUT.nodes[0]
    expect(only).toBeDefined()
    if (only === undefined) return
    const orphaned = {
      ...LAID_OUT,
      nodes: [{ ...only, childIds: ['nobody'] }],
      byId: new Map([[only.id, { ...only, childIds: ['nobody'] }]]),
    }
    expect(blocksOf(orphaned)).toHaveLength(0)
  })
})
