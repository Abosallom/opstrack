// Contract tests for the Mindtree's geometry.
//
// No mocks, no DOM, no clock: layout.ts takes a tree and options and returns
// numbers, which is the property it was written to have. Everything below is an
// assertion about those numbers.
//
// THE INVARIANTS, and why each one is here rather than in a rendering test:
//   · NO OVERLAP at any depth — the one failure a mind map cannot survive, and
//     the one a screenshot review misses on the branch that happened to be
//     collapsed that day.
//   · DETERMINISM — "copy for a deck" exports the picture on screen. If two
//     calls could disagree, the exported SVG and the screen would be two
//     different answers to the same question.
//   · MIRROR — RTL is not a second layout to eyeball, it is an equality.
//   · COLLAPSED COSTS NOTHING — a collapsed branch that still reserved its rows
//     would leave a hole in the picture that looks like a rendering bug.
//   · FINITE, ALWAYS — one NaN width propagates through the column widths into
//     every x in the drawing, which is a blank screen rather than a wrong node.
//
// THE RANDOM TREES ARE NOT RANDOM. `lcg()` is a fixed-seed linear congruential
// generator, so the "bank of shapes" the invariants run over is the same bank on
// every machine and in CI. A failure here is reproducible from the seed printed
// in the test name, which is the entire reason layout.ts is forbidden a
// Math.random of its own.

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GAP,
  DEFAULT_NODE_SIZE,
  edgePath,
  fitToViewBox,
  layoutMindtree,
  sizeForCount,
  zoomLimits,
  type LayoutInputNode,
  type MindtreeLayout,
  type NodeSize,
  type PositionedNode,
} from './layout'

/** Floating-point slack. Every number here is a sum of a handful of terms. */
const EPS = 1e-9

/**
 * A stand-in for model.ts's MindNode: the layout contract plus a payload, which
 * is exactly the shape the real one will have. `label` is here to prove the
 * payload survives the round trip with its own type — `layout.nodes[0].node.label`
 * has to compile, or the renderer would be casting.
 */
interface TestNode extends LayoutInputNode {
  readonly id: string
  readonly label?: string
  readonly children?: readonly TestNode[]
  readonly collapsed?: boolean
  readonly size?: NodeSize
}

function node(id: string, children: readonly TestNode[] = [], extra: Partial<TestNode> = {}): TestNode {
  return { id, label: id, children, ...extra }
}

/** Deterministic pseudo-randomness. Numerical Recipes' constants. */
function lcg(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

/** A tree of `depth` rings with a varying fan-out and varying node heights. */
function randomTree(seed: number, depth: number, maxFan = 4): TestNode {
  const rand = lcg(seed)
  let counter = 0
  const grow = (level: number): TestNode => {
    const id = `n${counter++}`
    // Sizes vary because they are DATA in this feature — count → area. A layout
    // that only holds for uniform boxes would fail the moment a track got busy.
    const height = 32 + Math.floor(rand() * 60)
    const width = 120 + Math.floor(rand() * 80)
    if (level >= depth) return { id, size: { width, height } }
    const fan = 1 + Math.floor(rand() * maxFan)
    const children: TestNode[] = []
    for (let i = 0; i < fan; i += 1) children.push(grow(level + 1))
    return { id, size: { width, height }, children }
  }
  return grow(0)
}

function byDepth<N extends LayoutInputNode>(
  layout: MindtreeLayout<N>,
): Map<number, PositionedNode<N>[]> {
  const bands = new Map<number, PositionedNode<N>[]>()
  for (const positioned of layout.nodes) {
    const band = bands.get(positioned.depth) ?? []
    band.push(positioned)
    bands.set(positioned.depth, band)
  }
  return bands
}

/**
 * Nothing at the same depth may touch — not siblings, and not cousins from two
 * different branches, which is the case a "separate my own children" layout gets
 * wrong and a contour-packed one gets right.
 */
function expectNoOverlap<N extends LayoutInputNode>(
  layout: MindtreeLayout<N>,
  gap = DEFAULT_GAP.sibling,
): void {
  for (const [, band] of byDepth(layout)) {
    const sorted = [...band].sort((a, b) => a.y - b.y)
    for (let i = 1; i < sorted.length; i += 1) {
      const above = sorted[i - 1]
      const below = sorted[i]
      expect(below.y).toBeGreaterThanOrEqual(above.y + above.height + gap - EPS)
    }
  }
}

function expectFinite<N extends LayoutInputNode>(layout: MindtreeLayout<N>): void {
  for (const positioned of layout.nodes) {
    for (const value of [positioned.x, positioned.y, positioned.width, positioned.height]) {
      expect(Number.isFinite(value)).toBe(true)
    }
  }
  for (const edge of layout.edges) {
    for (const point of [edge.start, edge.end, edge.c1, edge.c2]) {
      expect(Number.isFinite(point.x)).toBe(true)
      expect(Number.isFinite(point.y)).toBe(true)
    }
  }
  for (const value of Object.values(layout.bounds)) {
    expect(Number.isFinite(value)).toBe(true)
  }
}

function centerY(positioned: PositionedNode<TestNode>): number {
  return positioned.y + positioned.height / 2
}

// ── degenerate shapes ──────────────────────────────────────────────────────

describe('layoutMindtree — the shapes that break layouts', () => {
  it('lays out a lone workspace at the origin', () => {
    const layout = layoutMindtree(node('root'))

    expect(layout.nodes).toHaveLength(1)
    expect(layout.edges).toHaveLength(0)
    expect(layout.maxDepth).toBe(0)
    const root = layout.nodes[0]
    expect(root.x).toBe(0)
    expect(root.y).toBe(0)
    expect(root.width).toBe(DEFAULT_NODE_SIZE.width)
    expect(root.height).toBe(DEFAULT_NODE_SIZE.height)
    expect(root.parentId).toBeNull()
    expect(root.hasChildren).toBe(false)
    expect(root.hasHiddenChildren).toBe(false)
    expect(root.siblingCount).toBe(1)
    expect(layout.bounds).toEqual({
      minX: 0,
      minY: 0,
      maxX: DEFAULT_NODE_SIZE.width,
      maxY: DEFAULT_NODE_SIZE.height,
      width: DEFAULT_NODE_SIZE.width,
      height: DEFAULT_NODE_SIZE.height,
    })
    // The payload comes back with its own type — this line is the assertion.
    expect(root.node.label).toBe('root')
    expectFinite(layout)
  })

  it('lays out a track with zero entries as a leaf, with the parent on its centre line', () => {
    const layout = layoutMindtree(node('root', [node('empty-track')]))

    expect(layout.nodes.map((n) => n.id)).toEqual(['root', 'empty-track'])
    expect(layout.edges).toHaveLength(1)
    const [root, track] = layout.nodes
    expect(centerY(root)).toBeCloseTo(centerY(track), 9)
    expect(track.x).toBe(DEFAULT_NODE_SIZE.width + DEFAULT_GAP.depth)
    expect(track.hasChildren).toBe(false)
    expectFinite(layout)
  })

  it('survives a thousand-deep chain', () => {
    let chain = node('leaf')
    for (let i = 0; i < 999; i += 1) chain = node(`link-${i}`, [chain])

    const layout = layoutMindtree(chain)

    expect(layout.nodes).toHaveLength(1000)
    expect(layout.maxDepth).toBe(999)
    expectFinite(layout)
    // A single-child chain centres every link on the one below it, so with equal
    // heights the whole chain is one straight line — and x is strictly monotone.
    const first = layout.nodes[0]
    for (const positioned of layout.nodes) {
      expect(centerY(positioned)).toBeCloseTo(centerY(first), 6)
    }
    for (let i = 1; i < layout.nodes.length; i += 1) {
      expect(layout.nodes[i].x).toBeGreaterThan(layout.nodes[i - 1].x)
    }
  })

  it('falls back to the default size when a model hands it NaN or zero', () => {
    // The count → area encoding divides; a workspace with no entries is a
    // plausible 0/0, and one NaN would take the whole drawing with it.
    const layout = layoutMindtree(
      node('root', [
        node('nan', [], { size: { width: Number.NaN, height: 40 } }),
        node('infinite', [], { size: { width: 100, height: Number.POSITIVE_INFINITY } }),
        node('zero', [], { size: { width: 0, height: 0 } }),
        node('negative', [], { size: { width: -50, height: -50 } }),
      ]),
    )

    expectFinite(layout)
    expectNoOverlap(layout)
    expect(layout.byId.get('nan')?.width).toBe(DEFAULT_NODE_SIZE.width)
    expect(layout.byId.get('infinite')?.height).toBe(DEFAULT_NODE_SIZE.height)
    expect(layout.byId.get('zero')?.width).toBe(DEFAULT_NODE_SIZE.width)
    expect(layout.byId.get('negative')?.height).toBe(DEFAULT_NODE_SIZE.height)
  })

  it('clamps a nonsensical gap instead of overlapping nodes', () => {
    const tree = node('root', [node('a'), node('b')])
    const layout = layoutMindtree(tree, { gap: { sibling: -400, depth: Number.NaN } })

    expect(layout.options.gap.sibling).toBe(DEFAULT_GAP.sibling)
    expect(layout.options.gap.depth).toBe(DEFAULT_GAP.depth)
    expectNoOverlap(layout)
  })

  it('drops a repeated id rather than recursing forever', () => {
    const shared = node('shared')
    // Two parents claiming one node — a model bug, and a cycle's little brother.
    const layout = layoutMindtree(node('root', [node('a', [shared]), node('b', [shared])]))

    expect(layout.nodes.map((n) => n.id)).toEqual(['root', 'a', 'shared', 'b'])
    // The second parent reports a child it is not showing rather than lying.
    expect(layout.byId.get('b')?.hasChildren).toBe(true)
    expect(layout.byId.get('b')?.hasHiddenChildren).toBe(true)
    expect(layout.byId.get('b')?.hiddenChildCount).toBe(1)
    expectFinite(layout)
  })
})

// ── geometry invariants ────────────────────────────────────────────────────

describe('layoutMindtree — geometry invariants', () => {
  for (const seed of [1, 7, 42, 1337, 90210]) {
    it(`packs seed ${seed} with no overlap at any depth`, () => {
      const layout = layoutMindtree(randomTree(seed, 4), { gap: { sibling: 14, depth: 60 } })

      expect(layout.nodes.length).toBeGreaterThan(10)
      expectNoOverlap(layout, 14)
      expectFinite(layout)
    })
  }

  it('puts every node in a ring at the same inline offset', () => {
    const layout = layoutMindtree(randomTree(11, 3))

    for (const [, band] of byDepth(layout)) {
      const xs = new Set(band.map((n) => n.x))
      expect(xs.size).toBe(1)
    }
    // …and the rings themselves never collide, whatever the widest node is.
    const rings = [...byDepth(layout).entries()].sort((a, b) => a[0] - b[0])
    for (let i = 1; i < rings.length; i += 1) {
      const previousEnd = Math.max(...rings[i - 1][1].map((n) => n.x + n.width))
      expect(rings[i][1][0].x).toBeGreaterThanOrEqual(previousEnd + DEFAULT_GAP.depth - EPS)
    }
  })

  it('centres a parent between its first and last child', () => {
    const layout = layoutMindtree(randomTree(5, 3))

    for (const parent of layout.nodes) {
      if (parent.childIds.length === 0) continue
      const first = layout.byId.get(parent.childIds[0])
      const last = layout.byId.get(parent.childIds[parent.childIds.length - 1])
      expect(first && last).toBeTruthy()
      if (!first || !last) continue
      expect(centerY(parent)).toBeCloseTo((centerY(first) + centerY(last)) / 2, 9)
    }
  })

  it('emits nodes in pre-order, with a11y positions that match', () => {
    const layout = layoutMindtree(node('root', [node('a', [node('a1'), node('a2')]), node('b')]))

    expect(layout.nodes.map((n) => n.id)).toEqual(['root', 'a', 'a1', 'a2', 'b'])
    const seen = new Set<string>()
    for (const positioned of layout.nodes) {
      if (positioned.parentId !== null) expect(seen.has(positioned.parentId)).toBe(true)
      seen.add(positioned.id)
    }
    expect(layout.byId.get('a2')).toMatchObject({ depth: 2, index: 1, siblingCount: 2 })
    expect(layout.byId.get('b')).toMatchObject({ depth: 1, index: 1, siblingCount: 2 })
  })

  it('lays siblings out top-to-bottom in model order', () => {
    // The arrow keys walk `childIds`; if the visual order could disagree with it,
    // Down would jump upward on the day a branch packed tightly. Every screen
    // reader user's mental model of the picture rests on this equality.
    const layout = layoutMindtree(randomTree(77, 4))

    for (const parent of layout.nodes) {
      let previous = Number.NEGATIVE_INFINITY
      for (const childId of parent.childIds) {
        const child = layout.byId.get(childId)
        expect(child).toBeDefined()
        if (!child) continue
        expect(child.y).toBeGreaterThan(previous)
        previous = child.y
      }
    }
    expect(layout.byId.size).toBe(layout.nodes.length)
  })

  it('attaches every edge to the parent-end and child-start edges', () => {
    const layout = layoutMindtree(randomTree(3, 3))

    expect(layout.edges).toHaveLength(layout.nodes.length - 1)
    for (const edge of layout.edges) {
      const parent = layout.byId.get(edge.parentId)
      const child = layout.byId.get(edge.childId)
      expect(parent && child).toBeTruthy()
      if (!parent || !child) continue
      expect(edge.start.x).toBeCloseTo(parent.x + parent.width, 9)
      expect(edge.start.y).toBeCloseTo(centerY(parent), 9)
      expect(edge.end.x).toBeCloseTo(child.x, 9)
      expect(edge.end.y).toBeCloseTo(centerY(child), 9)
      // Handles stay horizontal — the curve meets both cards square-on.
      expect(edge.c1.y).toBe(edge.start.y)
      expect(edge.c2.y).toBe(edge.end.y)
      expect(edge.c1.x).toBeGreaterThanOrEqual(edge.start.x)
      expect(edge.c2.x).toBeLessThanOrEqual(edge.end.x)
    }
  })

  it('renders an edge as a cubic through its own four points', () => {
    const layout = layoutMindtree(node('root', [node('a')]))
    const edge = layout.edges[0]

    expect(edgePath(edge)).toBe(
      `M ${edge.start.x} ${edge.start.y} C ${edge.c1.x} ${edge.c1.y}, ${edge.c2.x} ${edge.c2.y}, ${edge.end.x} ${edge.end.y}`,
    )
  })
})

// ── determinism ────────────────────────────────────────────────────────────

describe('layoutMindtree — determinism', () => {
  it('returns identical geometry for the same input, twice', () => {
    const tree = randomTree(99, 4)

    expect(layoutMindtree(tree)).toEqual(layoutMindtree(tree))
  })

  it('returns identical geometry for two structurally equal trees', () => {
    // The stronger claim: nothing is keyed on object identity, insertion order
    // into a Map, or anything else that survives only within one object graph.
    expect(layoutMindtree(randomTree(2026, 4))).toEqual(layoutMindtree(randomTree(2026, 4)))
  })
})

// ── collapse and the depth limit ───────────────────────────────────────────

describe('layoutMindtree — collapse and depth limit', () => {
  it('gives a collapsed branch exactly the space of a leaf', () => {
    const collapsed = layoutMindtree(
      node('root', [
        node('a', [node('a1'), node('a2'), node('a3')], { collapsed: true }),
        node('b', [node('b1')]),
      ]),
    )
    const pruned = layoutMindtree(node('root', [node('a'), node('b', [node('b1')])]))

    // Same picture for the nodes that survive — a collapsed branch that still
    // reserved its rows would leave a hole that reads as a rendering bug.
    expect(collapsed.bounds).toEqual(pruned.bounds)
    for (const positioned of pruned.nodes) {
      const twin = collapsed.byId.get(positioned.id)
      expect(twin).toBeDefined()
      expect(twin?.x).toBe(positioned.x)
      expect(twin?.y).toBe(positioned.y)
    }
    expect(collapsed.byId.get('a1')).toBeUndefined()
    expect(collapsed.byId.get('a')).toMatchObject({
      collapsed: true,
      hasChildren: true,
      hasHiddenChildren: true,
      hiddenChildCount: 3,
      childIds: [],
    })
  })

  it('truncates at the depth limit and marks the parents that were cut', () => {
    const tree = node('root', [
      node('track', [node('group', [node('entry-1'), node('entry-2')])]),
    ])

    const full = layoutMindtree(tree)
    const mobile = layoutMindtree(tree, { depthLimit: 2 })

    expect(full.nodes).toHaveLength(5)
    expect(mobile.nodes.map((n) => n.id)).toEqual(['root', 'track', 'group'])
    expect(mobile.maxDepth).toBe(2)
    expect(mobile.byId.get('group')).toMatchObject({
      hasChildren: true,
      hasHiddenChildren: true,
      hiddenChildCount: 2,
      collapsed: false,
    })
    // The ring that survived is untouched by the cut below it.
    expect(mobile.byId.get('track')?.hasHiddenChildren).toBe(false)
    expectFinite(mobile)
  })

  it('still draws the workspace at depthLimit 0 (and at a negative one)', () => {
    const tree = node('root', [node('a'), node('b')])

    for (const depthLimit of [0, -3]) {
      const layout = layoutMindtree(tree, { depthLimit })
      expect(layout.nodes.map((n) => n.id)).toEqual(['root'])
      expect(layout.nodes[0].hiddenChildCount).toBe(2)
      expect(layout.edges).toHaveLength(0)
      expectFinite(layout)
    }
  })
})

// ── the count encoding ─────────────────────────────────────────────────────

describe('sizeForCount, and the sizeOf seam', () => {
  it('grows the AREA with the count — both dimensions on √count', () => {
    const min = { width: 100, height: 40 }
    const max = { width: 300, height: 120 }
    const size = (count: number): NodeSize => sizeForCount(count, { min, max, fullAt: 100 })

    // √16 − 1 is exactly three times √4 − 1, so the extra width above the floor
    // must be exactly three times as much. That equality IS the encoding: swap
    // the square root for a linear scale and this line fails.
    expect(size(16).width - size(1).width).toBeCloseTo(3 * (size(4).width - size(1).width), 9)
    expect(size(16).height - size(1).height).toBeCloseTo(3 * (size(4).height - size(1).height), 9)
  })

  it('clamps at both ends and refuses to produce a NaN card', () => {
    const min = { width: 100, height: 40 }
    const max = { width: 300, height: 120 }
    const options = { min, max, fullAt: 100 }

    expect(sizeForCount(1, options)).toEqual(min)
    expect(sizeForCount(0, options)).toEqual(min)
    expect(sizeForCount(-5, options)).toEqual(min)
    expect(sizeForCount(Number.NaN, options)).toEqual(min)
    expect(sizeForCount(100, options)).toEqual(max)
    expect(sizeForCount(100_000, options)).toEqual(max)
    // A workspace where the busiest node holds one entry: everything is `max`
    // rather than a division by zero.
    expect(sizeForCount(1, { min, max, fullAt: 1 })).toEqual(max)

    let previous = 0
    for (const count of [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144]) {
      const { width, height } = sizeForCount(count, options)
      expect(Number.isFinite(width) && Number.isFinite(height)).toBe(true)
      expect(width).toBeGreaterThanOrEqual(previous)
      previous = width
    }
  })

  it('sizes nodes from the model without a second copy of the tree', () => {
    // The model tree is the same object the accessible table and the keyboard
    // walk read; `sizeOf` is how a count becomes a rectangle without cloning it.
    // b holds one entry, so it sits on the legibility floor; root holds the
    // whole workspace and sits on the ceiling.
    const counts: Record<string, number> = { root: 40, a: 30, b: 1, a1: 30 }
    const layout = layoutMindtree(node('root', [node('a', [node('a1')]), node('b')]), {
      sizeOf: (n) => sizeForCount(counts[n.id] ?? 1, { fullAt: 40 }),
    })

    expect(layout.byId.get('root')?.width).toBeGreaterThan(layout.byId.get('a')?.width ?? 0)
    expect(layout.byId.get('a')?.width).toBeGreaterThan(layout.byId.get('b')?.width ?? 0)
    expect(layout.byId.get('b')?.width).toBe(DEFAULT_NODE_SIZE.width)
    // A ring is as wide as its widest node, and still nothing overlaps.
    expect(layout.byId.get('a')?.x).toBe(layout.byId.get('b')?.x)
    expectNoOverlap(layout)
    expectFinite(layout)
    // The callback beats a `size` on the node; the node beats the default.
    const mixed = layoutMindtree(node('root', [node('sized', [], { size: { width: 222, height: 60 } })]), {
      sizeOf: (n) => (n.id === 'root' ? { width: 90 } : undefined),
    })
    expect(mixed.byId.get('root')?.width).toBe(90)
    expect(mixed.byId.get('root')?.height).toBe(DEFAULT_NODE_SIZE.height)
    expect(mixed.byId.get('sized')?.width).toBe(222)
  })
})

// ── RTL ────────────────────────────────────────────────────────────────────

describe('layoutMindtree — RTL is a pure mirror', () => {
  const tree = randomTree(2025, 4)
  const ltr = layoutMindtree(tree)
  const rtl = layoutMindtree(tree, { direction: 'rtl' })

  it('reflects every rectangle about the drawing and touches nothing else', () => {
    expect(rtl.bounds).toEqual(ltr.bounds)
    expect(rtl.nodes.map((n) => n.id)).toEqual(ltr.nodes.map((n) => n.id))

    const width = ltr.bounds.width
    for (const source of ltr.nodes) {
      const mirrored = rtl.byId.get(source.id)
      expect(mirrored).toBeDefined()
      if (!mirrored) continue
      expect(mirrored.x).toBeCloseTo(width - source.x - source.width, 9)
      expect(mirrored.y).toBe(source.y)
      expect(mirrored.width).toBe(source.width)
      expect(mirrored.height).toBe(source.height)
      expect(mirrored.depth).toBe(source.depth)
    }
  })

  it('reflects every edge point, so a connector still meets its cards', () => {
    const width = ltr.bounds.width
    for (const [i, source] of ltr.edges.entries()) {
      const mirrored = rtl.edges[i]
      expect(mirrored.id).toBe(source.id)
      expect(mirrored.start.x).toBeCloseTo(width - source.start.x, 9)
      expect(mirrored.end.x).toBeCloseTo(width - source.end.x, 9)
      expect(mirrored.c1.x).toBeCloseTo(width - source.c1.x, 9)
      expect(mirrored.c2.x).toBeCloseTo(width - source.c2.x, 9)
      expect(mirrored.start.y).toBe(source.start.y)
      expect(mirrored.end.y).toBe(source.end.y)
    }
    // The tree still grows toward the reading end: in Arabic every connector
    // runs right-to-left.
    for (const edge of rtl.edges) expect(edge.end.x).toBeLessThan(edge.start.x)
  })

  it('keeps the rings aligned on their inline-start edge', () => {
    for (const [, band] of byDepth(rtl)) {
      const starts = new Set(band.map((n) => Math.round((n.x + n.width) * 1000)))
      expect(starts.size).toBe(1)
    }
    expectNoOverlap(rtl)
  })
})

// ── performance ────────────────────────────────────────────────────────────

describe('layoutMindtree — a full working set', () => {
  it('lays out a thousand leaves well inside a frame', () => {
    // The shape the 1000-row clamp actually produces: five tracks, four groups
    // each, fifty entries per group.
    const tracks: TestNode[] = []
    for (let t = 0; t < 5; t += 1) {
      const groups: TestNode[] = []
      for (let g = 0; g < 4; g += 1) {
        const entries: TestNode[] = []
        for (let e = 0; e < 50; e += 1) entries.push(node(`e-${t}-${g}-${e}`))
        groups.push(node(`g-${t}-${g}`, entries))
      }
      tracks.push(node(`t-${t}`, groups))
    }
    const tree = node('root', tracks)

    // Best of three: a single sample on a loaded CI box measures the scheduler,
    // not the algorithm. The budget is deliberately generous — the point is to
    // catch an accidental O(n²), not to defend a millisecond.
    let best = Number.POSITIVE_INFINITY
    let layout = layoutMindtree(tree)
    for (let run = 0; run < 3; run += 1) {
      const started = performance.now()
      layout = layoutMindtree(tree)
      best = Math.min(best, performance.now() - started)
    }

    expect(layout.nodes).toHaveLength(1 + 5 + 20 + 1000)
    expect(layout.edges).toHaveLength(1025)
    expect(best).toBeLessThan(50)
    expectNoOverlap(layout)
    expectFinite(layout)
  })
})

// ── fitToViewBox ───────────────────────────────────────────────────────────

describe('fitToViewBox', () => {
  const bounds = layoutMindtree(randomTree(8, 4)).bounds

  it('matches the viewport aspect exactly, so nothing is ever stretched', () => {
    const fit = fitToViewBox(bounds, { width: 1200, height: 800 })

    expect(fit.width / fit.height).toBeCloseTo(1200 / 800, 6)
  })

  it('contains the whole drawing, padding included', () => {
    const fit = fitToViewBox(bounds, { width: 400, height: 300 }, { padding: 24 })

    expect(fit.scale).toBeLessThan(1)
    expect(fit.x).toBeLessThanOrEqual(bounds.minX - 24 + EPS)
    expect(fit.y).toBeLessThanOrEqual(bounds.minY - 24 + EPS)
    expect(fit.x + fit.width).toBeGreaterThanOrEqual(bounds.maxX + 24 - EPS)
    expect(fit.y + fit.height).toBeGreaterThanOrEqual(bounds.maxY + 24 - EPS)
    expect(fit.viewBox).toBe(`${fit.x} ${fit.y} ${fit.width} ${fit.height}`)
  })

  it('centres the drawing in the box', () => {
    const fit = fitToViewBox(bounds, { width: 1000, height: 900 })

    expect(fit.x + fit.width / 2).toBeCloseTo(bounds.minX + bounds.width / 2, 2)
    expect(fit.y + fit.height / 2).toBeCloseTo(bounds.minY + bounds.height / 2, 2)
  })

  it('never magnifies a small tree unless asked to', () => {
    const small = layoutMindtree(node('root')).bounds

    expect(fitToViewBox(small, { width: 1600, height: 1000 }).scale).toBe(1)
    expect(fitToViewBox(small, { width: 1600, height: 1000 }, { maxScale: 3 }).scale).toBe(3)
  })

  it('honours a scale floor, and lets the caller pan the overflow', () => {
    const fit = fitToViewBox(bounds, { width: 200, height: 120 }, { minScale: 0.5 })

    expect(fit.scale).toBe(0.5)
    expect(fit.width).toBeCloseTo(400, 6)
  })

  it('gives a finite box for an unmeasured container and an empty drawing', () => {
    const unmeasured = fitToViewBox(bounds, { width: 0, height: 0 })
    expect(unmeasured.scale).toBe(1)
    expect(Number.isFinite(unmeasured.width)).toBe(true)
    expect(Number.isFinite(unmeasured.height)).toBe(true)

    const empty = fitToViewBox(
      { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 },
      { width: 800, height: 600 },
    )
    expect(Number.isFinite(empty.scale)).toBe(true)
    expect(empty.viewBox.split(' ')).toHaveLength(4)
    for (const part of empty.viewBox.split(' ')) expect(Number.isFinite(Number(part))).toBe(true)
  })
})

describe('zoomLimits — the bound is on what the reader can see', () => {
  it('always leaves the fit itself reachable', () => {
    // "Fit to view" sets the multiplier to exactly 1, so 1 has to be inside the
    // range at every fit — including a map that already fits above the ceiling
    // and one that fits below the floor.
    for (const scale of [0.02, 0.2, 1, 4, 40]) {
      const limits = zoomLimits(scale, { minScale: 0.25, maxScale: 3 })
      expect(limits.min).toBeLessThanOrEqual(1)
      expect(limits.max).toBeGreaterThanOrEqual(1)
    }
  })

  it('reaches the requested EFFECTIVE scale however small the fit is', () => {
    // THE DEFECT. The first cut clamped the multiplier at 4, so a map fitting
    // at 0.15 had a ceiling of 0.6: 7.5px labels, with the zoom-in button
    // already dead. The reader's escape hatch was sized by the thing they were
    // escaping.
    for (const scale of [0.047, 0.137, 0.31]) {
      const limits = zoomLimits(scale, { minScale: 0.25, maxScale: 3 })
      expect(scale * limits.max).toBeCloseTo(3, 6)
      // 4x, the old fixed ceiling, would not have got there.
      expect(limits.max).toBeGreaterThan(4)
    }
  })

  it('does not let the floor shrink a map that already fits small', () => {
    const limits = zoomLimits(0.2, { minScale: 0.25, maxScale: 3 })
    expect(limits.min).toBe(1)
  })

  it('keeps a floor that is above the ceiling from inverting the range', () => {
    const limits = zoomLimits(1, { minScale: 5, maxScale: 2 })
    expect(limits.min).toBeLessThanOrEqual(limits.max)
  })

  it('is total over a fit nobody measured', () => {
    // `fit.scale` is arithmetic over a container that is 0x0 for one frame.
    for (const scale of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const limits = zoomLimits(scale)
      expect(Number.isFinite(limits.min)).toBe(true)
      expect(Number.isFinite(limits.max)).toBe(true)
      expect(limits.min).toBeGreaterThan(0)
    }
  })
})
