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
  DEFAULT_LAYOUT_OPTIONS,
  DEFAULT_NODE_SIZE,
  edgePath,
  fitToViewBox,
  layoutMindtree,
  sizeForCount,
  subtreeBounds,
  zoomLimits,
  type Bounds,
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

/**
 * The vertical twin of expectNoOverlap: in the top-down drawing a depth band
 * spreads ACROSS, so it is x that has to clear rather than y.
 *
 * Written out in full rather than folded into the horizontal one, and that is
 * the point. A single helper that took its axis from `layout.options` would
 * FOLLOW an axis bug instead of catching it — the assertion and the code under
 * test would be reading the same flag, and a transpose applied in the wrong
 * place would look correct to both.
 */
function expectNoOverlapAcross<N extends LayoutInputNode>(
  layout: MindtreeLayout<N>,
  gap = DEFAULT_GAP.sibling,
): void {
  for (const [, band] of byDepth(layout)) {
    const sorted = [...band].sort((a, b) => a.x - b.x)
    for (let i = 1; i < sorted.length; i += 1) {
      const before = sorted[i - 1]
      const after = sorted[i]
      expect(after.x).toBeGreaterThanOrEqual(before.x + before.width + gap - EPS)
    }
  }
}

function centerX(positioned: PositionedNode<TestNode>): number {
  return positioned.x + positioned.width / 2
}

/** The same tree with every declared size swapped, and nothing else touched. */
function transposeTree(source: TestNode): TestNode {
  return {
    ...source,
    ...(source.size ? { size: { width: source.size.height, height: source.size.width } } : {}),
    ...(source.children ? { children: source.children.map(transposeTree) } : {}),
  }
}

const swapped = (size: NodeSize): NodeSize => ({ width: size.height, height: size.width })

/**
 * A layout reflected about y = x, projected into the same flat arrays the pin
 * uses. Comparing THIS against the vertical layout's own projection is what
 * turns "vertical is the transpose of horizontal" into an assertion rather than
 * a second snapshot to keep in step with the first.
 */
function transposeLayout<N extends LayoutInputNode>(layout: MindtreeLayout<N>) {
  return {
    bounds: {
      minX: layout.bounds.minY,
      minY: layout.bounds.minX,
      maxX: layout.bounds.maxY,
      maxY: layout.bounds.maxX,
      width: layout.bounds.height,
      height: layout.bounds.width,
    },
    nodes: layout.nodes.map((p) => [p.id, p.depth, p.y, p.x, p.height, p.width]),
    edges: layout.edges.map((e) => [
      e.id, e.start.y, e.start.x, e.c1.y, e.c1.x, e.c2.y, e.c2.x, e.end.y, e.end.x,
    ]),
  }
}

function projectLayout<N extends LayoutInputNode>(layout: MindtreeLayout<N>) {
  return {
    bounds: { ...layout.bounds },
    nodes: layout.nodes.map((p) => [p.id, p.depth, p.x, p.y, p.width, p.height]),
    edges: layout.edges.map((e) => [
      e.id, e.start.x, e.start.y, e.c1.x, e.c1.y, e.c2.x, e.c2.y, e.end.x, e.end.y,
    ]),
  }
}

/** A parent with `count` default-sized leaves — the fan-out shape wrapping exists for. */
function fan(count: number): TestNode {
  const kids: TestNode[] = []
  for (let i = 0; i < count; i += 1) kids.push(node(`k${i}`))
  return node('root', kids)
}

// ── the pin ────────────────────────────────────────────────────────────────

/**
 * THE FIRST TEST WRITTEN FOR THE RADIAL WORK, AND IT IS ABOUT THE LINEAR ONE.
 *
 * radial.ts shares `buildLayoutNodes` and `resolveLayoutOptions` with this
 * layout, which means the extraction touched the code path every existing
 * Mindtree screen already renders from. Everything else in this file asserts a
 * PROPERTY; this asserts the NUMBERS — every coordinate of a five-ring fixture,
 * copied from the output of the commit before the extraction. A refactor that
 * moved one pixel fails here by name instead of showing up as a screenshot
 * nobody diffed.
 *
 * It also pins the three optional fields as ABSENT: the linear layout emits no
 * `outward`, no `rings` and no `hub`, so a renderer's `pos.outward ?? …`
 * fallback stays on its existing branch and every deep-equality assertion in
 * this file keeps its meaning.
 */
const pinned = node('root', [
  node('a', [node('a1', [], { size: { width: 90, height: 30 } }), node('a2')]),
  node('b', [node('b1', [node('b1x', [], { size: { width: 200, height: 70 } })])]),
  node('c'),
])

/**
 * The frozen numbers, hoisted out of the assertion below so that the vertical
 * suite can COMPOSE off them — reflected about y = x — instead of freezing a
 * second copy that would have to be re-derived by hand every time this one moved.
 * The assertion itself is unchanged; only the literals moved.
 */
const PINNED_NODES: readonly (readonly [string, number, number, number, number, number])[] = [
  ['root', 0, 0, 85.75, 168, 44],
  ['a', 1, 224, 17.5, 168, 44],
  ['a1', 2, 448, 0, 90, 30],
  ['a2', 2, 448, 42, 168, 44],
  ['b', 1, 224, 98, 168, 44],
  ['b1', 2, 448, 98, 168, 44],
  ['b1x', 3, 672, 85, 200, 70],
  ['c', 1, 224, 154, 168, 44],
]

const PINNED_EDGES: readonly (readonly [
  string, number, number, number, number, number, number, number, number,
])[] = [
  ['root->a', 168, 107.75, 196, 107.75, 196, 39.5, 224, 39.5],
  ['a->a1', 392, 39.5, 420, 39.5, 420, 15, 448, 15],
  ['a->a2', 392, 39.5, 420, 39.5, 420, 64, 448, 64],
  ['root->b', 168, 107.75, 196, 107.75, 196, 120, 224, 120],
  ['b->b1', 392, 120, 420, 120, 420, 120, 448, 120],
  ['b1->b1x', 616, 120, 644, 120, 644, 120, 672, 120],
  ['root->c', 168, 107.75, 196, 107.75, 196, 176, 224, 176],
]

describe("layoutMindtree — today's output, byte for byte", () => {
  it('returns exactly the coordinates it returned before the shared build existed', () => {
    const layout = layoutMindtree(pinned)

    expect(layout.bounds).toEqual({
      minX: 0,
      minY: 0,
      maxX: 872,
      maxY: 198,
      width: 872,
      height: 198,
    })
    expect(layout.maxDepth).toBe(3)
    expect(layout.nodes.map((p) => [p.id, p.depth, p.x, p.y, p.width, p.height])).toEqual(
      PINNED_NODES.map((row) => [...row]),
    )
    expect(
      layout.edges.map((e) => [
        e.id,
        e.start.x,
        e.start.y,
        e.c1.x,
        e.c1.y,
        e.c2.x,
        e.c2.y,
        e.end.x,
        e.end.y,
      ]),
    ).toEqual(PINNED_EDGES.map((row) => [...row]))
  })

  it('emits no outward, no rings and no hub — those belong to the polar layout', () => {
    const layout = layoutMindtree(pinned, { direction: 'rtl', depthLimit: 2 })

    expect(layout.rings).toBeUndefined()
    expect(layout.hub).toBeUndefined()
    for (const positioned of layout.nodes) expect(positioned.outward).toBeUndefined()
    // Not merely undefined — absent, so `Object.keys` and any structural
    // equality a caller writes against a layout stay what they were.
    expect(Object.hasOwn(layout, 'rings')).toBe(false)
    expect(Object.hasOwn(layout, 'hub')).toBe(false)
    expect(Object.hasOwn(layout.nodes[0], 'outward')).toBe(false)
  })
})

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

// ── the transpose ──────────────────────────────────────────────────────────

/**
 * THE LOAD-BEARING TEST FOR THE SECOND ORIENTATION, AND THE REASON THERE IS NO
 * SECOND SNAPSHOT.
 *
 * The law:
 *
 *     V(tree, opts) === transpose( H(transposeTree(tree), swapped nodeSize) )
 *
 * It holds because the transpose commutes with `sanitizeSize` (per-dimension,
 * with a per-dimension fallback), because `blockColumns` is stated on the LAYOUT
 * axes and never on the screen ones, and because the mirror is the only thing
 * applied after the swap comes back out. Assert it and every one of the forty-two
 * properties the horizontal drawing already holds — no overlap, contour
 * tidiness, collapse costing nothing, the depth limit, finiteness, determinism —
 * transfers to the vertical drawing by composition, for free, and stays
 * transferred as the horizontal numbers change.
 *
 * RTL IS DELIBERATELY OUTSIDE THE LAW. RTL reflects SCREEN x, so the transpose
 * of "screen x reflected" is "screen y reflected" — a drawing nobody wants and
 * nothing produces. The law is therefore asserted LTR-only, and the vertical
 * mirror gets its own direct test below.
 */
describe('layoutMindtree — vertical is the transpose, and nothing else', () => {
  it('pins the vertical drawing to the frozen horizontal numbers, by composition', () => {
    const vertical = layoutMindtree(transposeTree(pinned), {
      orientation: 'vertical',
      nodeSize: swapped(DEFAULT_NODE_SIZE),
    })

    expect(vertical.bounds).toEqual({
      minX: 0,
      minY: 0,
      maxX: 198,
      maxY: 872,
      width: 198,
      height: 872,
    })
    expect(vertical.maxDepth).toBe(3)
    expect(vertical.nodes.map((p) => [p.id, p.depth, p.x, p.y, p.width, p.height])).toEqual(
      PINNED_NODES.map(([id, depth, x, y, w, h]) => [id, depth, y, x, h, w]),
    )
    expect(
      vertical.edges.map((e) => [
        e.id,
        e.start.x,
        e.start.y,
        e.c1.x,
        e.c1.y,
        e.c2.x,
        e.c2.y,
        e.end.x,
        e.end.y,
      ]),
    ).toEqual(
      PINNED_EDGES.map(([id, sx, sy, c1x, c1y, c2x, c2y, ex, ey]) => [
        id, sy, sx, c1y, c1x, c2y, c2x, ey, ex,
      ]),
    )
  })

  for (const seed of [1, 7, 42, 1337, 90210, 2025]) {
    it(`is the transpose of the horizontal drawing for seed ${seed}`, () => {
      const tree = randomTree(seed, 4)
      // Both engines, because the law is what says the block engine is
      // orientation-blind too — the one claim a reader of packBlocks() would
      // otherwise have to take on trust.
      for (const wrap of [false, true]) {
        expect(projectLayout(layoutMindtree(tree, { orientation: 'vertical', wrap }))).toEqual(
          transposeLayout(
            layoutMindtree(transposeTree(tree), { nodeSize: swapped(DEFAULT_NODE_SIZE), wrap }),
          ),
        )
      }
    })
  }
})

// ── the top-down drawing ───────────────────────────────────────────────────

/**
 * What a transpose does NOT make obvious. Everything above says the vertical
 * drawing is the horizontal one reflected; these say what that reflection means
 * on screen, in the terms a renderer and a reader actually use. A bug that
 * transposed twice, or transposed the sizes and not the coordinates, would
 * satisfy the law above for some inputs and fail here immediately.
 */
describe('layoutMindtree — top-down', () => {
  const vertical = { orientation: 'vertical' } as const

  it('runs depth DOWN the screen, one band per ring', () => {
    const layout = layoutMindtree(randomTree(11, 3), vertical)

    for (const [, band] of byDepth(layout)) {
      expect(new Set(band.map((n) => n.y)).size).toBe(1)
    }
    const rings = [...byDepth(layout).entries()].sort((a, b) => a[0] - b[0])
    for (let i = 1; i < rings.length; i += 1) {
      const previousEnd = Math.max(...rings[i - 1][1].map((n) => n.y + n.height))
      expect(rings[i][1][0].y).toBeGreaterThanOrEqual(previousEnd + DEFAULT_GAP.depth - EPS)
    }
  })

  for (const seed of [1, 7, 42, 1337, 90210]) {
    it(`spreads seed ${seed} across x with no overlap at any depth`, () => {
      const layout = layoutMindtree(randomTree(seed, 4), {
        ...vertical,
        gap: { sibling: 14, depth: 60 },
      })

      expect(layout.nodes.length).toBeGreaterThan(10)
      expectNoOverlapAcross(layout, 14)
      expectFinite(layout)
    })
  }

  it('lays siblings out left-to-right in model order', () => {
    // The same equality the horizontal suite pins on y: the arrow keys walk
    // `childIds`, so if the visual order could disagree with it, Right would
    // jump backwards on the day a branch packed tightly.
    const layout = layoutMindtree(randomTree(77, 4), vertical)

    for (const parent of layout.nodes) {
      let previous = Number.NEGATIVE_INFINITY
      for (const childId of parent.childIds) {
        const child = layout.byId.get(childId)
        expect(child).toBeDefined()
        if (!child) continue
        expect(child.x).toBeGreaterThan(previous)
        previous = child.x
      }
    }
  })

  it('centres a parent over its fan', () => {
    const layout = layoutMindtree(randomTree(5, 3), vertical)

    for (const parent of layout.nodes) {
      if (parent.childIds.length === 0) continue
      const first = layout.byId.get(parent.childIds[0])
      const last = layout.byId.get(parent.childIds[parent.childIds.length - 1])
      expect(first && last).toBeTruthy()
      if (!first || !last) continue
      expect(centerX(parent)).toBeCloseTo((centerX(first) + centerX(last)) / 2, 9)
    }
  })

  it('attaches every edge to the parent BOTTOM and the child TOP', () => {
    const layout = layoutMindtree(randomTree(3, 3), vertical)

    expect(layout.edges).toHaveLength(layout.nodes.length - 1)
    for (const edge of layout.edges) {
      const parent = layout.byId.get(edge.parentId)
      const child = layout.byId.get(edge.childId)
      expect(parent && child).toBeTruthy()
      if (!parent || !child) continue
      expect(edge.start.x).toBeCloseTo(centerX(parent), 9)
      expect(edge.start.y).toBeCloseTo(parent.y + parent.height, 9)
      expect(edge.end.x).toBeCloseTo(centerX(child), 9)
      expect(edge.end.y).toBeCloseTo(child.y, 9)
      // Handles stay VERTICAL here, which is the same claim as "horizontal" in
      // the other orientation: the curve meets both cards square-on.
      expect(edge.c1.x).toBe(edge.start.x)
      expect(edge.c2.x).toBe(edge.end.x)
      expect(edge.c1.y).toBeGreaterThanOrEqual(edge.start.y)
      expect(edge.c2.y).toBeLessThanOrEqual(edge.end.y)
      // The tree grows downward, always — direction never touches this axis.
      expect(edge.end.y).toBeGreaterThan(edge.start.y)
    }
  })

  it('mirrors RTL on x and leaves the depth axis alone', () => {
    const tree = randomTree(2025, 4)
    const ltr = layoutMindtree(tree, vertical)
    const rtl = layoutMindtree(tree, { ...vertical, direction: 'rtl' })

    expect(rtl.bounds).toEqual(ltr.bounds)
    expect(rtl.nodes.map((n) => n.id)).toEqual(ltr.nodes.map((n) => n.id))

    const width = ltr.bounds.width
    for (const source of ltr.nodes) {
      const mirrored = rtl.byId.get(source.id)
      expect(mirrored).toBeDefined()
      if (!mirrored) continue
      expect(mirrored.x).toBeCloseTo(width - source.x - source.width, 9)
      // THE TRIPWIRE. In this orientation the mirror reflects the SIBLING axis,
      // so y — the depth axis — must come through untouched. A flip moved inside
      // layout space would turn the drawing upside down here and nowhere else.
      expect(mirrored.y).toBe(source.y)
      expect(mirrored.width).toBe(source.width)
      expect(mirrored.height).toBe(source.height)
      expect(mirrored.depth).toBe(source.depth)
    }
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
    for (const [, band] of byDepth(rtl)) {
      expect(new Set(band.map((n) => n.y)).size).toBe(1)
    }
    expectNoOverlapAcross(rtl)
  })

  it('emits no outward, no rings and no hub here either', () => {
    const layout = layoutMindtree(pinned, { ...vertical, wrap: true })

    expect(Object.hasOwn(layout, 'rings')).toBe(false)
    expect(Object.hasOwn(layout, 'hub')).toBe(false)
    expect(Object.hasOwn(layout.nodes[0], 'outward')).toBe(false)
  })
})

/**
 * The one place `describe.each` is genuinely right: these four bodies are
 * axis-free, so running them over a table proves the axis does not enter them.
 * Everything with an axis in it stays written out twice, on purpose.
 */
describe.each([
  ['horizontal', {}],
  ['vertical', { orientation: 'vertical' as const }],
  ['vertical, wrapped', { orientation: 'vertical' as const, wrap: true }],
])('layoutMindtree — orientation-free guarantees (%s)', (_name, options) => {
  it('is finite at every coordinate', () => {
    expectFinite(layoutMindtree(randomTree(4242, 4), options))
  })

  it('returns identical geometry twice, and for two structurally equal trees', () => {
    const tree = randomTree(99, 4)
    expect(layoutMindtree(tree, options)).toEqual(layoutMindtree(tree, options))
    expect(layoutMindtree(randomTree(2026, 4), options)).toEqual(
      layoutMindtree(randomTree(2026, 4), options),
    )
  })

  it('emits nodes in pre-order, with a11y positions that match', () => {
    const layout = layoutMindtree(
      node('root', [node('a', [node('a1'), node('a2')]), node('b')]),
      options,
    )

    expect(layout.nodes.map((n) => n.id)).toEqual(['root', 'a', 'a1', 'a2', 'b'])
    expect(layout.byId.get('a2')).toMatchObject({ depth: 2, index: 1, siblingCount: 2 })
    expect(layout.byId.get('b')).toMatchObject({ depth: 1, index: 1, siblingCount: 2 })
  })

  it('gives a collapsed branch exactly the space of a leaf', () => {
    const collapsed = layoutMindtree(
      node('root', [
        node('a', [node('a1'), node('a2'), node('a3')], { collapsed: true }),
        node('b', [node('b1')]),
      ]),
      options,
    )
    const pruned = layoutMindtree(node('root', [node('a'), node('b', [node('b1')])]), options)

    expect(collapsed.bounds).toEqual(pruned.bounds)
    for (const positioned of pruned.nodes) {
      const twin = collapsed.byId.get(positioned.id)
      expect(twin?.x).toBe(positioned.x)
      expect(twin?.y).toBe(positioned.y)
    }
  })
})

// ── wrapping ───────────────────────────────────────────────────────────────

/**
 * WRAPPING IS THE WHOLE POINT OF THE WORK, AND IT IS A MEASUREMENT BEFORE IT IS
 * A FEATURE: 396 organisations under one parent is either a canvas thirty-six
 * screens wide or a page two screens wide and four tall, and the difference is
 * whether anybody ever sees the last one. The assertions below hold the block
 * engine to that, and to the stronger no-overlap invariant it buys — not "no two
 * nodes in a band", but no two rectangles ANYWHERE.
 */
describe('layoutMindtree — a block, not a ribbon', () => {
  const wrapped = { orientation: 'vertical', wrap: true } as const

  /** Children grouped under their parent, in `childIds` order. */
  function families<N extends LayoutInputNode>(
    layout: MindtreeLayout<N>,
  ): { parent: PositionedNode<N>; kids: PositionedNode<N>[] }[] {
    const out: { parent: PositionedNode<N>; kids: PositionedNode<N>[] }[] = []
    for (const parent of layout.nodes) {
      if (parent.childIds.length === 0) continue
      const kids = parent.childIds.map((id) => layout.byId.get(id) as PositionedNode<N>)
      out.push({ parent, kids })
    }
    return out
  }

  for (const seed of [1, 42, 1337]) {
    it(`overlaps NOTHING anywhere in seed ${seed}, cousins and rings included`, () => {
      const layout = layoutMindtree(randomTree(seed, 3), wrapped)

      expect(layout.nodes.length).toBeGreaterThan(10)
      for (let i = 0; i < layout.nodes.length; i += 1) {
        for (let j = i + 1; j < layout.nodes.length; j += 1) {
          const a = layout.nodes[i]
          const b = layout.nodes[j]
          const disjoint =
            a.x + a.width <= b.x + EPS ||
            b.x + b.width <= a.x + EPS ||
            a.y + a.height <= b.y + EPS ||
            b.y + b.height <= a.y + EPS
          expect(disjoint).toBe(true)
        }
      }
      expectFinite(layout)
    })
  }

  it('overlaps nothing in a forty-leaf fan either', () => {
    const layout = layoutMindtree(fan(40), wrapped)

    for (let i = 0; i < layout.nodes.length; i += 1) {
      for (let j = i + 1; j < layout.nodes.length; j += 1) {
        const a = layout.nodes[i]
        const b = layout.nodes[j]
        expect(
          a.x + a.width <= b.x + EPS ||
            b.x + b.width <= a.x + EPS ||
            a.y + a.height <= b.y + EPS ||
            b.y + b.height <= a.y + EPS,
        ).toBe(true)
      }
    }
  })

  it('arranges every fan as a true grid — straight rows, straight columns', () => {
    const layout = layoutMindtree(randomTree(1337, 3), wrapped)

    for (const { kids } of families(layout)) {
      // Rows are FLUSH, so a row shares an exact y. Columns are CENTRED — the
      // cell offset and the box offset telescope — so a column shares an exact
      // centre line rather than an exact left edge, which is what makes the grid
      // read as a grid when the subtrees in it are different sizes.
      const rowLines = [...new Set(kids.map((k) => k.y))].sort((a, b) => a - b)
      const columnLines = [...new Set(kids.map((k) => centerX(k)))].sort((a, b) => a - b)
      const cols = columnLines.length
      const rows = rowLines.length
      expect(rows).toBe(Math.ceil(kids.length / cols))

      for (const [i, kid] of kids.entries()) {
        expect(kid.y).toBe(rowLines[Math.floor(i / cols)])
        expect(centerX(kid)).toBeCloseTo(columnLines[i % cols], 9)
      }
      // A constant pitch on both axes. Anything else is a masonry wall.
      for (let i = 2; i < rowLines.length; i += 1) {
        expect(rowLines[i] - rowLines[i - 1]).toBeCloseTo(rowLines[1] - rowLines[0], 9)
      }
      for (let i = 2; i < columnLines.length; i += 1) {
        expect(columnLines[i] - columnLines[i - 1]).toBeCloseTo(columnLines[1] - columnLines[0], 9)
      }
    }
  })

  it('is never deeper in cells than it is wide', () => {
    // THE HARD RULE, and the only one of the two that is absolute: two children
    // never stack into what reads as a chain, so a connector to the second one
    // never has to cross the first.
    for (const seed of [1, 7, 42, 1337, 90210]) {
      const layout = layoutMindtree(randomTree(seed, 3), wrapped)
      for (const { kids } of families(layout)) {
        const cols = new Set(kids.map((k) => centerX(k))).size
        const rows = new Set(kids.map((k) => k.y)).size
        expect(cols).toBeGreaterThanOrEqual(rows)
      }
    }
  })

  it('comes out wider than tall for a fan of uniform cards', () => {
    // The SOFT rule, asserted where it is actually guaranteed. With uniform
    // cells the block reaches its target shape; with wildly uneven subtrees the
    // best available candidate can still be deeper than wide, and forcing it
    // otherwise would mean a row of four hundred.
    for (const count of [4, 13, 50, 396]) {
      const kids = layoutMindtree(fan(count), wrapped).nodes.filter((n) => n.depth === 1)
      const left = Math.min(...kids.map((k) => k.x))
      const right = Math.max(...kids.map((k) => k.x + k.width))
      const top = Math.min(...kids.map((k) => k.y))
      const bottom = Math.max(...kids.map((k) => k.y + k.height))
      expect(right - left).toBeGreaterThanOrEqual(bottom - top)
    }
  })

  it('turns 396 organisations from a thirty-six-screen ribbon into a page', () => {
    // THE MEASUREMENT THIS FEATURE EXISTS FOR, AS AN ASSERTION.
    const ribbon = layoutMindtree(fan(396), { orientation: 'vertical' })
    const page = layoutMindtree(fan(396), wrapped)

    expect(ribbon.bounds.width).toBe(396 * 168 + 395 * 12)
    expect(page.bounds.width).toBeLessThan(ribbon.bounds.width / 5)
    const aspect = page.bounds.width / page.bounds.height
    expect(aspect).toBeGreaterThan(1.5)
    expect(aspect).toBeLessThan(3)
  })

  it('centres a parent on its BLOCK, not between its first and last child', () => {
    // Five children come out 3 x 2, so the last child sits in column 1 of row 1
    // and the old first-and-last rule would point the parent left of its own
    // fan. Both halves are asserted: the second is what stops the old rule being
    // "restored" by someone who only read the horizontal packer.
    const layout = layoutMindtree(fan(5), wrapped)
    const root = layout.nodes[0]
    const kids = layout.nodes.filter((n) => n.depth === 1)
    expect(new Set(kids.map((k) => centerX(k))).size).toBe(3)

    const left = Math.min(...kids.map((k) => k.x))
    const right = Math.max(...kids.map((k) => k.x + k.width))
    expect(centerX(root)).toBeCloseTo((left + right) / 2, 9)
    expect(centerX(root)).not.toBeCloseTo(
      (centerX(kids[0]) + centerX(kids[kids.length - 1])) / 2,
      6,
    )
  })

  it('leaves an only child exactly where the unwrapped drawing puts it', () => {
    const single = layoutMindtree(node('root', [node('only')]), wrapped)
    const [root, only] = single.nodes
    expect(new Set(single.nodes.filter((n) => n.depth === 1).map(centerX)).size).toBe(1)
    expect(centerX(root)).toBeCloseTo(centerX(only), 9)

    // A uniform-size chain has no fan to wrap, so both engines must agree
    // coordinate for coordinate — the cheapest proof that `wrap` is a different
    // arrangement of the same drawing and not a different drawing.
    const chain = node('root', [node('a', [node('b', [node('c')])])])
    expect(projectLayout(layoutMindtree(chain, wrapped))).toEqual(
      projectLayout(layoutMindtree(chain, { orientation: 'vertical' })),
    )
  })

  it('picks a column count that is a pure function of the drawn children', () => {
    // blockColumns exercised through the layout, because it is not exported and
    // should not be: the grid IS the observable, and a table of them is what a
    // future "optimisation" of the scoring has to answer to.
    const expected: readonly (readonly [number, number, number])[] = [
      [2, 2, 1],
      [3, 2, 2],
      [4, 2, 2],
      [5, 3, 2],
      [8, 3, 3],
      [13, 4, 4],
      [20, 5, 4],
      [50, 8, 7],
      // 10x10 and not 11x10: the row gap stopped being the RING gap (46) and
      // became its own, smaller number, so a squarer grid now scores best. The
      // new answer is also the exact one — a hundred children fill ten rows of
      // ten with no ragged tail, where 11 columns left ten empty slots.
      [100, 10, 10],
      // Squarer for the same reason as the row above. 20x20 leaves four empty
      // slots against 21x19's three — a wash — and the block is no longer wider
      // than it is tall, which is what the aspect target was asking for.
      [396, 20, 20],
    ]
    for (const [count, cols, rows] of expected) {
      const kids = layoutMindtree(fan(count), wrapped).nodes.filter((n) => n.depth === 1)
      expect([
        count,
        new Set(kids.map((k) => Math.round(centerX(k) * 1000))).size,
        new Set(kids.map((k) => k.y)).size,
      ]).toEqual([count, cols, rows])
    }
  })

  it('counts only the DRAWN children when it sizes a block', () => {
    // The wrapped twin of the collapse test, and it pins something the unwrapped
    // one cannot: a column count derived from the model's children rather than
    // the drawing's would give a collapsed branch a different grid than a pruned
    // one, and the picture would jump on every fold.
    const kids: TestNode[] = []
    for (let i = 0; i < 12; i += 1) {
      kids.push(node(`k${i}`, [node(`k${i}-a`), node(`k${i}-b`)], { collapsed: i % 2 === 0 }))
    }
    const collapsed = layoutMindtree(node('root', kids), wrapped)
    const pruned = layoutMindtree(
      node(
        'root',
        kids.map((k) => (k.collapsed ? node(k.id) : k)),
      ),
      wrapped,
    )

    expect(collapsed.bounds).toEqual(pruned.bounds)
    for (const positioned of pruned.nodes) {
      const twin = collapsed.byId.get(positioned.id)
      expect(twin?.x).toBe(positioned.x)
      expect(twin?.y).toBe(positioned.y)
    }

    // The depth limit is the same claim from the other end.
    const tree = node('root', [node('track', [node('group', [node('e1'), node('e2')])])])
    const mobile = layoutMindtree(tree, { ...wrapped, depthLimit: 2 })
    expect(mobile.nodes.map((n) => n.id)).toEqual(['root', 'track', 'group'])
    expect(mobile.byId.get('group')?.hasHiddenChildren).toBe(true)
  })

  it('is off unless asked for, and says so in the resolved options', () => {
    expect(layoutMindtree(pinned, { wrap: false })).toEqual(layoutMindtree(pinned))

    const plain = layoutMindtree(pinned)
    expect(Object.hasOwn(plain.options, 'wrap')).toBe(false)
    expect(Object.hasOwn(plain.options, 'orientation')).toBe(false)
    expect(plain.options).toEqual(DEFAULT_LAYOUT_OPTIONS)

    const asked = layoutMindtree(pinned, wrapped)
    expect(Object.hasOwn(asked.options, 'wrap')).toBe(true)
    expect(Object.hasOwn(asked.options, 'orientation')).toBe(true)
    expect(asked.options).toEqual({
      ...DEFAULT_LAYOUT_OPTIONS,
      orientation: 'vertical',
      wrap: true,
    })
    expect(layoutMindtree(pinned, { orientation: 'vertical' }).options).toEqual({
      ...DEFAULT_LAYOUT_OPTIONS,
      orientation: 'vertical',
    })
  })

  it('lays out a thousand leaves in a block well inside a frame', () => {
    // blockColumns is O(fan-out) per parent and therefore O(n) over the tree.
    // This is the test that catches a future "try every column count for every
    // subtree" turning that into O(n²).
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

    let best = Number.POSITIVE_INFINITY
    let layout = layoutMindtree(tree, wrapped)
    for (let run = 0; run < 3; run += 1) {
      const started = performance.now()
      layout = layoutMindtree(tree, wrapped)
      best = Math.min(best, performance.now() - started)
    }

    expect(layout.nodes).toHaveLength(1 + 5 + 20 + 1000)
    expect(best).toBeLessThan(50)
    expectFinite(layout)
  })
})

// ── subtreeBounds ──────────────────────────────────────────────────────────

describe('subtreeBounds — the rectangle a camera flies to', () => {
  it('gives a leaf exactly its own rectangle', () => {
    const layout = layoutMindtree(node('root', [node('a'), node('b')]))
    const a = layout.byId.get('a') as PositionedNode<TestNode>

    expect(subtreeBounds(layout, 'a')).toEqual({
      minX: a.x,
      minY: a.y,
      maxX: a.x + a.width,
      maxY: a.y + a.height,
      width: a.width,
      height: a.height,
    })
  })

  it('gives the root the whole drawing, in every orientation and direction', () => {
    // One assertion covering the union logic, the normalisation contract and the
    // mirror at once: `bounds` IS the union of every rectangle, so if the walk
    // missed a branch or the mirror moved one, these stop being equal.
    const tree = randomTree(42, 4)
    for (const orientation of ['horizontal', 'vertical'] as const) {
      for (const direction of ['ltr', 'rtl'] as const) {
        const layout = layoutMindtree(tree, { orientation, direction })
        expect(subtreeBounds(layout, 'n0')).toEqual(layout.bounds)
      }
    }
    const block = layoutMindtree(tree, { orientation: 'vertical', wrap: true })
    expect(subtreeBounds(block, 'n0')).toEqual(block.bounds)
  })

  it('returns null for anything the DRAWING does not contain', () => {
    const layout = layoutMindtree(
      node('root', [
        node('folded', [node('hidden')], { collapsed: true }),
        node('deep', [node('cut')]),
      ]),
      { depthLimit: 1 },
    )

    expect(subtreeBounds(layout, 'nobody')).toBeNull()
    // In the model, out of the picture: a collapsed branch's child…
    expect(subtreeBounds(layout, 'hidden')).toBeNull()
    // …and one the depth limit cut. A camera falls back to the full bounds
    // rather than framing a NaN.
    expect(subtreeBounds(layout, 'cut')).toBeNull()
  })

  it('gives a collapsed node its own rectangle and nothing more', () => {
    const layout = layoutMindtree(
      node('root', [node('folded', [node('h1'), node('h2')], { collapsed: true }), node('b')]),
    )
    const folded = layout.byId.get('folded') as PositionedNode<TestNode>

    expect(subtreeBounds(layout, 'folded')).toEqual({
      minX: folded.x,
      minY: folded.y,
      maxX: folded.x + folded.width,
      maxY: folded.y + folded.height,
      width: folded.width,
      height: folded.height,
    })
  })

  it('matches a brute-force union at every node', () => {
    const tree = randomTree(42, 4)
    const layout = layoutMindtree(tree, { orientation: 'vertical', wrap: true })

    // Computed from the SOURCE tree rather than from `childIds`, so this is an
    // independent answer and not the same walk written twice.
    const union = (source: TestNode): Bounds | null => {
      const positioned = layout.byId.get(source.id)
      if (!positioned) return null
      let minX = positioned.x
      let minY = positioned.y
      let maxX = positioned.x + positioned.width
      let maxY = positioned.y + positioned.height
      for (const kid of source.children ?? []) {
        const kidBounds = union(kid)
        if (!kidBounds) continue
        minX = Math.min(minX, kidBounds.minX)
        minY = Math.min(minY, kidBounds.minY)
        maxX = Math.max(maxX, kidBounds.maxX)
        maxY = Math.max(maxY, kidBounds.maxY)
      }
      return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
    }

    let checked = 0
    const walk = (source: TestNode): void => {
      if (layout.byId.has(source.id)) {
        expect(subtreeBounds(layout, source.id)).toEqual(union(source))
        checked += 1
      }
      for (const kid of source.children ?? []) walk(kid)
    }
    walk(tree)
    expect(checked).toBe(layout.nodes.length)
  })

  it('is a function, not a field on the layout', () => {
    // The reason it is a free function at all: a key here would break the
    // byte-for-byte pin and the three `layout.options` deep-compares.
    const layout = layoutMindtree(pinned)
    expect(Object.hasOwn(layout, 'subtreeBounds')).toBe(false)
    expect(Object.hasOwn(layout.nodes[0], 'subtreeBounds')).toBe(false)
  })

  it('walks a thousand-deep chain without spending the stack', () => {
    let chain = node('leaf')
    for (let i = 0; i < 999; i += 1) chain = node(`link-${i}`, [chain])
    const layout = layoutMindtree(chain)

    // The chain is built by wrapping outward, so the ROOT is the last link made.
    expect(subtreeBounds(layout, layout.nodes[0].id)).toEqual(layout.bounds)
    expect(subtreeBounds(layout, 'leaf')?.width).toBe(DEFAULT_NODE_SIZE.width)
    // …and a link halfway down owns exactly the tail below it, un-normalised:
    // where the branch actually is, which is the question a camera is asking.
    const halfway = subtreeBounds(layout, 'link-500') as Bounds
    expect(halfway.minX).toBeGreaterThan(0)
    expect(halfway.maxX).toBe(layout.bounds.maxX)
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
