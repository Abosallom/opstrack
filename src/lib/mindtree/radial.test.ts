// Contract tests for the Mindtree's POLAR geometry.
//
// Same rules as layout.test.ts: no mocks, no DOM, no clock. radial.ts takes a
// tree and options and returns numbers, and everything below is an assertion
// about those numbers.
//
// THE INVARIANTS, and why each one is here:
//   · THE PARTITION IS EXACT — children tile their parent's wedge with SHARED
//     boundaries. A gap is a hole in the picture; an overlap is two branches
//     drawn through each other. Asserted on the angles, not on the pixels,
//     because a bearing recovered from a centre has been through cos, sin and
//     atan2 and can only be approximately anything.
//   · NO OVERLAP WITHIN A RING — the failure the naive arc-length radius
//     produces at THREE children, which is the commonest fan-out on this screen.
//   · NO OVERLAP ACROSS DEPTHS — the invariant the column layout gave away free
//     and a polar one has to earn back through the pitch.
//   · BOUNDS CONTAIN THE CURVES — a radial cubic genuinely leaves the union of
//     its endpoint rects, so bounds taken from the rects alone clip connectors
//     at the drawing's own margin, in the export as well as on screen.
//   · BOUNDS ARE CENTRED ON THE HUB — the precondition for the mirror.
//   · MIRROR — Arabic is not a second layout to eyeball. It is an equality, and
//     the root's x is the same FLOAT in both directions, not the same to nine
//     places.
//   · THE PRE-ORDER IS THE LINEAR LAYOUT'S — same ids, same aria-level,
//     posinset, setsize. The two shapes share one build walk, and this is the
//     assertion that says so out loud.
//   · FINITE, ALWAYS — a NaN size, a zero size, a negative size.

import { describe, expect, it } from 'vitest'
import { fitToViewBox, layoutMindtree } from './layout'
import type { Bounds, LayoutInputNode, MindtreeLayout, NodeSize, PositionedNode } from './layout'
import { layoutMindtreeRadial, radialWedges, ringNodeSize, ringsThatFit } from './radial'

const EPS = 1e-9
const TAU = Math.PI * 2

interface TestNode extends LayoutInputNode {
  readonly id: string
  readonly label?: string
  readonly children?: readonly TestNode[]
  readonly collapsed?: boolean
  readonly size?: NodeSize
}

function node(
  id: string,
  children: readonly TestNode[] = [],
  extra: Partial<TestNode> = {},
): TestNode {
  return { id, label: id, children, ...extra }
}

/** A root with `n` identical children — one ring, the shape the ceiling is
 *  computed against. */
function fan(n: number, size?: NodeSize): TestNode {
  const kids: TestNode[] = []
  for (let i = 0; i < n; i += 1) kids.push(node(`k${i}`, [], size === undefined ? {} : { size }))
  return node('root', kids)
}

/** Deterministic pseudo-randomness. Numerical Recipes' constants — the same
 *  generator layout.test.ts uses, so a failing seed is reproducible. */
function lcg(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function randomTree(seed: number, depth: number, maxFan = 4): TestNode {
  const rand = lcg(seed)
  let counter = 0
  const grow = (level: number): TestNode => {
    const id = `n${counter++}`
    const height = 32 + Math.floor(rand() * 60)
    const width = 120 + Math.floor(rand() * 80)
    if (level >= depth) return node(id, [], { size: { width, height } })
    const fanOut = 1 + Math.floor(rand() * maxFan)
    const kids: TestNode[] = []
    for (let i = 0; i < fanOut; i += 1) kids.push(grow(level + 1))
    return node(id, kids, { size: { width, height } })
  }
  return grow(0)
}

// ── shared assertions ──────────────────────────────────────────────────────

function centre(positioned: PositionedNode<TestNode>): { x: number; y: number } {
  return { x: positioned.x + positioned.width / 2, y: positioned.y + positioned.height / 2 }
}

function overlaps(a: PositionedNode<TestNode>, b: PositionedNode<TestNode>): boolean {
  return (
    a.x < b.x + b.width - EPS &&
    b.x < a.x + a.width - EPS &&
    a.y < b.y + b.height - EPS &&
    b.y < a.y + a.height - EPS
  )
}

/** Every pair of boxes in the whole drawing, which covers "within a ring" and
 *  "across depths" in one statement — and the second one is the invariant the
 *  pitch exists to buy back. */
function expectNoOverlapAnywhere(layout: MindtreeLayout<TestNode>): void {
  const nodes = layout.nodes
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      if (!overlaps(nodes[i], nodes[j])) continue
      throw new Error(
        `${nodes[i].id} (depth ${nodes[i].depth}) overlaps ${nodes[j].id} (depth ${nodes[j].depth})`,
      )
    }
  }
  expect(nodes.length).toBeGreaterThan(0)
}

function expectFinite(layout: MindtreeLayout<TestNode>): void {
  for (const positioned of layout.nodes) {
    for (const value of [positioned.x, positioned.y, positioned.width, positioned.height]) {
      expect(Number.isFinite(value)).toBe(true)
    }
    if (positioned.outward !== undefined) {
      expect(Number.isFinite(positioned.outward.x)).toBe(true)
      expect(Number.isFinite(positioned.outward.y)).toBe(true)
    }
  }
  for (const edge of layout.edges) {
    for (const point of [edge.start, edge.end, edge.c1, edge.c2]) {
      expect(Number.isFinite(point.x)).toBe(true)
      expect(Number.isFinite(point.y)).toBe(true)
    }
  }
  for (const value of Object.values(layout.bounds)) expect(Number.isFinite(value)).toBe(true)
  for (const radius of layout.rings ?? []) expect(Number.isFinite(radius)).toBe(true)
  expect(Number.isFinite(layout.hub?.x ?? Number.NaN)).toBe(true)
  expect(Number.isFinite(layout.hub?.y ?? Number.NaN)).toBe(true)
}

/** The ARIA contract as a value: if these tuples match the linear layout's, the
 *  screen reader cannot tell the two shapes apart. */
function ariaShape(layout: MindtreeLayout<TestNode>): unknown[] {
  return layout.nodes.map((p) => [
    p.id,
    p.depth,
    p.parentId,
    p.index,
    p.siblingCount,
    p.hasChildren,
    p.hasHiddenChildren,
    p.hiddenChildCount,
    p.collapsed,
    [...p.childIds],
  ])
}

// ── purity ─────────────────────────────────────────────────────────────────

describe('layoutMindtreeRadial — a function, and only a function', () => {
  it('returns the same numbers twice and does not touch the tree it was given', () => {
    const tree = randomTree(11, 3)
    const before = JSON.stringify(tree)

    const first = layoutMindtreeRadial(tree, { direction: 'rtl' })
    const second = layoutMindtreeRadial(tree, { direction: 'rtl' })

    expect(JSON.stringify(tree)).toBe(before)
    expect(second.nodes).toEqual(first.nodes)
    expect(second.edges).toEqual(first.edges)
    expect(second.bounds).toEqual(first.bounds)
    expect(second.rings).toEqual(first.rings)
    expect(second.hub).toEqual(first.hub)
  })

  it('calls sizeOf once per laid-out node, with its depth', () => {
    const seen: Array<[string, number]> = []
    const tree = randomTree(12, 2)
    const layout = layoutMindtreeRadial(tree, {
      sizeOf: (n, depth) => {
        seen.push([n.id, depth])
        return undefined
      },
    })
    expect(seen.map(([id]) => id)).toEqual(layout.nodes.map((n) => n.id))
  })
})

// ── the angular partition ──────────────────────────────────────────────────

describe('layoutMindtreeRadial — the wedge partition is exact', () => {
  const tree = node('root', [
    node('wide', [node('w1'), node('w2'), node('w3'), node('w4')]),
    node('thin'),
    node('mid', [node('m1'), node('m2')]),
  ])

  it('gives every child the share of the circle its leaf slots demand', () => {
    const wedges = radialWedges(tree)

    // 4 + 1 + 2 = 7 slots at the deepest drawn ring.
    expect(wedges.get('root')?.slots).toBe(7)
    expect(wedges.get('wide')?.slots).toBe(4)
    expect(wedges.get('thin')?.slots).toBe(1)
    expect(wedges.get('mid')?.slots).toBe(2)

    const span = (id: string): number => {
      const wedge = wedges.get(id)
      if (wedge === undefined) throw new Error(`no wedge for ${id}`)
      return wedge.end - wedge.start
    }
    expect(span('wide')).toBeCloseTo((TAU * 4) / 7, 12)
    expect(span('thin')).toBeCloseTo(TAU / 7, 12)
    expect(span('mid')).toBeCloseTo((TAU * 2) / 7, 12)
    // Proportionality stated directly: radians per slot is one number for the
    // whole ring, which is what makes this packing and not a second encoding.
    expect(span('wide') / 4).toBeCloseTo(span('thin') / 1, 12)
    expect(span('mid') / 2).toBeCloseTo(span('thin') / 1, 12)
  })

  it('shares the boundaries, so the children tile the parent with no arithmetic left over', () => {
    const tree2 = randomTree(21, 3)
    const wedges = radialWedges(tree2)
    const layout = layoutMindtreeRadial(tree2)

    let checked = 0
    for (const parent of layout.nodes) {
      if (parent.childIds.length === 0) continue
      const own = wedges.get(parent.id)
      expect(own).toBeDefined()
      if (own === undefined) continue

      const kids = parent.childIds.map((id) => {
        const wedge = wedges.get(id)
        if (wedge === undefined) throw new Error(`no wedge for ${id}`)
        return wedge
      })
      // Byte-exact, not close-to: the first child's start IS the parent's start,
      // each child's end IS the next one's start, and the last child's end IS
      // the parent's end. That is a stronger statement than a summed equality
      // and — unlike a telescoping float sum — it is actually achievable.
      expect(kids[0].start).toBe(own.start)
      expect(kids[kids.length - 1].end).toBe(own.end)
      for (let i = 1; i < kids.length; i += 1) expect(kids[i].start).toBe(kids[i - 1].end)

      const sum = kids.reduce((acc, w) => acc + (w.end - w.start), 0)
      expect(sum).toBeCloseTo(own.end - own.start, 12)
      for (const kid of kids) expect(kid.bearing).toBeCloseTo((kid.start + kid.end) / 2, 12)
      checked += 1
    }
    expect(checked).toBeGreaterThan(3)
  })

  it('puts the first child on startAngle — 3 o clock by default, 9 in Arabic', () => {
    const wedges = radialWedges(fan(6))
    expect(wedges.get('k0')?.bearing).toBe(0)

    const ltr = layoutMindtreeRadial(fan(6))
    const rtl = layoutMindtreeRadial(fan(6), { direction: 'rtl' })
    const first = (layout: MindtreeLayout<TestNode>): { x: number; y: number } => {
      const positioned = layout.byId.get('k0')
      if (positioned === undefined) throw new Error('no k0')
      return centre(positioned)
    }
    // On the reading edge in both scripts: level with the hub, and on the side
    // the reader starts from.
    expect(first(ltr).y).toBeCloseTo(ltr.hub?.y ?? Number.NaN, 9)
    expect(first(rtl).y).toBeCloseTo(rtl.hub?.y ?? Number.NaN, 9)
    expect(first(ltr).x).toBeGreaterThan(ltr.hub?.x ?? 0)
    expect(first(rtl).x).toBeLessThan(rtl.hub?.x ?? 0)
  })

  it('honours a narrowed sweep and a rotated start', () => {
    const wedges = radialWedges(fan(4), { sweep: Math.PI, startAngle: Math.PI / 2 })
    const root = wedges.get('root')
    if (root === undefined) throw new Error('no root')
    expect(root.end - root.start).toBeCloseTo(Math.PI, 12)
    expect(wedges.get('k0')?.bearing).toBeCloseTo(Math.PI / 2, 12)
    // Four equal children of a half turn: one eighth of a turn each.
    expect((wedges.get('k1')?.bearing ?? 0) - (wedges.get('k0')?.bearing ?? 0)).toBeCloseTo(
      Math.PI / 4,
      12,
    )
  })

  it('treats a missing, zero, negative or oversized sweep as the full circle', () => {
    for (const sweep of [undefined, 0, -1, Number.NaN, 99]) {
      const wedges = radialWedges(fan(3), { sweep })
      const root = wedges.get('root')
      expect(root?.end === undefined ? Number.NaN : root.end - root.start).toBeCloseTo(TAU, 12)
    }
  })
})

// ── overlap ────────────────────────────────────────────────────────────────

describe('layoutMindtreeRadial — nothing overlaps anything', () => {
  it('takes the radius from the CHORD, not the arc — the correction this unit exists for', () => {
    // The arithmetic isolated, with the pitch deliberately out of the way (a
    // 44×44 hub, no depth gap) so the ring's own bound is what decides. Four
    // 168×168 boxes, sibling gap 6:
    //   arc bound   = 4·(237.59 + 6) / 2π      = 155.07  → dx = dy = 155 < 168
    //                                                      the boxes OVERLAP
    //   chord bound = (237.59 + 6) / (2·sin45°) = 172.24  → dx = 172 > 168, clear
    // Delete the chord term and this test fails; it is the one fixture in the
    // file that separates the two closed forms.
    const kids: TestNode[] = []
    for (let i = 0; i < 4; i += 1) {
      kids.push(node(`k${i}`, [], { size: { width: 168, height: 168 } }))
    }
    const layout = layoutMindtreeRadial(node('root', kids, { size: { width: 44, height: 44 } }), {
      gap: { depth: 0, sibling: 6 },
    })
    expectNoOverlapAnywhere(layout)
    expect(layout.rings?.[1]).toBeCloseTo(172.24, 1)
  })

  it('separates three children at the default gaps', () => {
    // At a fan-out of three with the shipping gaps the PITCH is the binding
    // term, not the chord — worth saying out loud, because the ring bound only
    // takes over from about five children up.
    const layout = layoutMindtreeRadial(fan(3, { width: 168, height: 44 }))
    expectNoOverlapAnywhere(layout)

    const kids = layout.nodes.filter((n) => n.depth === 1).map(centre)
    for (let i = 0; i < kids.length; i += 1) {
      for (let j = i + 1; j < kids.length; j += 1) {
        const distance = Math.hypot(kids[i].x - kids[j].x, kids[i].y - kids[j].y)
        // The circumscribed discs clear each other with the sibling gap between
        // them: diag/2 + diag/2 + 12.
        expect(distance).toBeGreaterThanOrEqual(Math.hypot(168, 44) + 12 - EPS)
      }
    }
  })

  it('separates a ring of alternating wide and tiny boxes', () => {
    // Extreme size ratios on one ring — a 260-wide bucket beside a 44×44 count
    // chip — which is the shape the second radius pass exists for. It passes
    // WITHOUT that pass too (the pitch is still the binding term at six
    // children), so this is coverage of the shape, not proof of the pass.
    const kids: TestNode[] = []
    for (let i = 0; i < 6; i += 1) {
      kids.push(
        node(`k${i}`, [], {
          size: i % 2 === 0 ? { width: 260, height: 44 } : { width: 44, height: 44 },
        }),
      )
    }
    expectNoOverlapAnywhere(layoutMindtreeRadial(node('root', kids)))
  })

  it('separates every ring of a bank of random trees', () => {
    for (const seed of [1, 7, 19, 33, 101, 2025]) {
      const layout = layoutMindtreeRadial(randomTree(seed, 3))
      try {
        expectNoOverlapAnywhere(layout)
      } catch (error) {
        throw new Error(`seed ${seed}: ${(error as Error).message}`)
      }
      expectFinite(layout)
    }
  })

  it('keeps ring d clear of ring d-1 all the way down a chain', () => {
    // One child per ring, five deep: nothing to separate along the ring, so the
    // pitch is the ONLY thing holding the drawing apart.
    let deep = node('leaf', [], { size: { width: 300, height: 200 } })
    for (let i = 4; i >= 1; i -= 1) deep = node(`d${i}`, [deep], { size: { width: 200, height: 90 } })
    const layout = layoutMindtreeRadial(node('root', [deep]))

    expectNoOverlapAnywhere(layout)
    const rings = layout.rings ?? []
    for (let d = 1; d < rings.length; d += 1) expect(rings[d]).toBeGreaterThan(rings[d - 1])
  })

  it('puts 200 children on one ring and stays finite and separated', () => {
    const layout = layoutMindtreeRadial(fan(200, { width: 132, height: 44 }))
    expect(layout.nodes).toHaveLength(201)
    expectFinite(layout)
    expectNoOverlapAnywhere(layout)
    // Quadratic area, stated as a number: 200 boxes on a circle is a big
    // drawing, and ringsThatFit is what decides not to draw it.
    expect(layout.bounds.width).toBeGreaterThan(2000)
  })
})

// ── bounds ─────────────────────────────────────────────────────────────────

describe('layoutMindtreeRadial — the bounds tell the truth', () => {
  it('contains every rect, every endpoint AND every control point', () => {
    for (const seed of [3, 44, 512]) {
      const layout = layoutMindtreeRadial(randomTree(seed, 3))
      const { bounds } = layout
      for (const positioned of layout.nodes) {
        expect(positioned.x).toBeGreaterThanOrEqual(bounds.minX - EPS)
        expect(positioned.y).toBeGreaterThanOrEqual(bounds.minY - EPS)
        expect(positioned.x + positioned.width).toBeLessThanOrEqual(bounds.maxX + EPS)
        expect(positioned.y + positioned.height).toBeLessThanOrEqual(bounds.maxY + EPS)
      }
      for (const edge of layout.edges) {
        for (const point of [edge.start, edge.c1, edge.c2, edge.end]) {
          expect(point.x).toBeGreaterThanOrEqual(bounds.minX - EPS)
          expect(point.x).toBeLessThanOrEqual(bounds.maxX + EPS)
          expect(point.y).toBeGreaterThanOrEqual(bounds.minY - EPS)
          expect(point.y).toBeLessThanOrEqual(bounds.maxY + EPS)
        }
      }
    }
  })

  it('leaves at least one control point outside the union of its own two rects', () => {
    // If this ever stops being true, the control points have stopped mattering
    // to the bounds and the test above has stopped testing anything.
    const layout = layoutMindtreeRadial(fan(8))
    const escaped = layout.edges.some((edge) => {
      const parent = layout.byId.get(edge.parentId)
      const child = layout.byId.get(edge.childId)
      if (parent === undefined || child === undefined) return false
      const inside = (p: { x: number; y: number }, box: PositionedNode<TestNode>): boolean =>
        p.x >= box.x - EPS &&
        p.x <= box.x + box.width + EPS &&
        p.y >= box.y - EPS &&
        p.y <= box.y + box.height + EPS
      return [edge.c1, edge.c2].some((p) => !inside(p, parent) && !inside(p, child))
    })
    expect(escaped).toBe(true)
  })

  it('is padded symmetrically about the hub, which is what the mirror needs', () => {
    for (const seed of [5, 61, 900]) {
      const layout = layoutMindtreeRadial(randomTree(seed, 3))
      const hub = layout.hub
      expect(hub).toBeDefined()
      if (hub === undefined) continue
      // Exactly the centre — width is 2·hubX by construction, not by rounding.
      expect(hub.x).toBe(layout.bounds.width / 2)
      expect(hub.y).toBe(layout.bounds.height / 2)
      const root = layout.nodes[0]
      expect(centre(root).x).toBeCloseTo(hub.x, 9)
      expect(centre(root).y).toBeCloseTo(hub.y, 9)
    }
  })

  it('reports ring radii indexed BY DEPTH, with the hub as ring zero', () => {
    const layout = layoutMindtreeRadial(randomTree(8, 3))
    const rings = layout.rings
    expect(rings).toBeDefined()
    if (rings === undefined) return
    expect(rings).toHaveLength(layout.maxDepth + 1)
    expect(rings[0]).toBe(0)

    const hub = layout.hub ?? { x: 0, y: 0 }
    for (const positioned of layout.nodes) {
      const c = centre(positioned)
      const radius = Math.hypot(c.x - hub.x, c.y - hub.y)
      expect(radius).toBeCloseTo(rings[positioned.depth], 6)
    }
  })
})

// ── the mirror ─────────────────────────────────────────────────────────────

describe('layoutMindtreeRadial — RTL is a reflection about the hub', () => {
  const tree = randomTree(2025, 3)
  const ltr = layoutMindtreeRadial(tree)
  const rtl = layoutMindtreeRadial(tree, { direction: 'rtl' })

  it('draws the same circle, the same size, on the same rings', () => {
    expect(rtl.bounds).toEqual(ltr.bounds)
    expect(rtl.rings).toEqual(ltr.rings)
    expect(rtl.hub).toEqual(ltr.hub)
    expect(rtl.nodes.map((n) => n.id)).toEqual(ltr.nodes.map((n) => n.id))
  })

  it('reflects every rectangle and leaves the root EXACTLY where it was', () => {
    const width = ltr.bounds.width
    for (const source of ltr.nodes) {
      const mirrored = rtl.byId.get(source.id)
      expect(mirrored).toBeDefined()
      if (mirrored === undefined) continue
      expect(mirrored.x).toBeCloseTo(width - source.x - source.width, 9)
      expect(mirrored.y).toBe(source.y)
      expect(mirrored.width).toBe(source.width)
      expect(mirrored.height).toBe(source.height)
      expect(mirrored.depth).toBe(source.depth)
    }
    // THE ARABIC GUARANTEE, as one equality: the hub is the reflection's fixed
    // point, so the root is not "within a rounding" of where it was — it is the
    // same float. This is what the symmetric padding buys.
    expect(rtl.nodes[0].x).toBe(ltr.nodes[0].x)
    expect(rtl.nodes[0].y).toBe(ltr.nodes[0].y)
  })

  it('reflects every edge point, so a connector still meets its cards', () => {
    const width = ltr.bounds.width
    expect(rtl.edges.map((e) => e.id)).toEqual(ltr.edges.map((e) => e.id))
    for (const [i, source] of ltr.edges.entries()) {
      const mirrored = rtl.edges[i]
      expect(mirrored.start.x).toBeCloseTo(width - source.start.x, 9)
      expect(mirrored.end.x).toBeCloseTo(width - source.end.x, 9)
      expect(mirrored.c1.x).toBeCloseTo(width - source.c1.x, 9)
      expect(mirrored.c2.x).toBeCloseTo(width - source.c2.x, 9)
      expect(mirrored.start.y).toBe(source.start.y)
      expect(mirrored.end.y).toBe(source.end.y)
      expect(mirrored.c1.y).toBe(source.c1.y)
      expect(mirrored.c2.y).toBe(source.c2.y)
    }
  })

  it('mirrors the chevron anchor against the node, so the renderer does no direction arithmetic', () => {
    for (const source of ltr.nodes) {
      const mirrored = rtl.byId.get(source.id)
      if (mirrored === undefined || source.outward === undefined) continue
      expect(mirrored.outward).toBeDefined()
      expect(mirrored.outward?.x).toBeCloseTo(source.width - source.outward.x, 9)
      expect(mirrored.outward?.y).toBe(source.outward.y)
    }
  })

  it('keeps nothing overlapping in Arabic either', () => {
    expectNoOverlapAnywhere(rtl)
  })
})

// ── the shared walk ────────────────────────────────────────────────────────

describe('layoutMindtreeRadial — the accessible tree cannot diverge by shape', () => {
  it('produces the linear layout s pre-order and ARIA fields, node for node', () => {
    for (const seed of [4, 40, 400]) {
      const tree = randomTree(seed, 4)
      for (const depthLimit of [1, 2, 3, Number.POSITIVE_INFINITY]) {
        const linear = layoutMindtree(tree, { depthLimit })
        const polar = layoutMindtreeRadial(tree, { depthLimit })
        expect(ariaShape(polar)).toEqual(ariaShape(linear))
        expect(polar.maxDepth).toBe(linear.maxDepth)
        expect(polar.options).toEqual(linear.options)
        expect(polar.edges.map((e) => [e.id, e.parentId, e.childId, e.depth])).toEqual(
          linear.edges.map((e) => [e.id, e.parentId, e.childId, e.depth]),
        )
      }
    }
  })

  it('obeys the collapsed rule and the depth limit the same way', () => {
    const tree = node('root', [
      node('open', [node('o1'), node('o2')]),
      node('shut', [node('s1'), node('s2')], { collapsed: true }),
    ])
    const layout = layoutMindtreeRadial(tree)
    expect(layout.nodes.map((n) => n.id)).toEqual(['root', 'open', 'o1', 'o2', 'shut'])
    const shut = layout.byId.get('shut')
    expect(shut?.hasChildren).toBe(true)
    expect(shut?.hasHiddenChildren).toBe(true)
    expect(shut?.hiddenChildCount).toBe(2)
  })

  it('lays out a lone workspace as a single box centred on the hub', () => {
    const layout = layoutMindtreeRadial(node('root'))
    expect(layout.nodes).toHaveLength(1)
    expect(layout.edges).toHaveLength(0)
    expect(layout.maxDepth).toBe(0)
    expect(layout.rings).toEqual([0])
    expect(layout.bounds.width).toBe(168)
    expect(layout.bounds.height).toBe(44)
    expect(layout.nodes[0].outward).toBeUndefined()
    expectFinite(layout)
  })
})

// ── the chevron anchor ─────────────────────────────────────────────────────

describe('outward — the chevron knows which way is away', () => {
  it('is undefined from the linear layout and present on every non-root node here', () => {
    const tree = randomTree(6, 3)
    for (const positioned of layoutMindtree(tree).nodes) {
      expect(positioned.outward).toBeUndefined()
    }
    const polar = layoutMindtreeRadial(tree)
    expect(polar.nodes[0].outward).toBeUndefined()
    for (const positioned of polar.nodes.slice(1)) expect(positioned.outward).toBeDefined()
  })

  it('sits outside the node s own box, on the ray from the hub', () => {
    const layout = layoutMindtreeRadial(fan(9))
    const hub = layout.hub ?? { x: 0, y: 0 }
    for (const positioned of layout.nodes.slice(1)) {
      const out = positioned.outward
      expect(out).toBeDefined()
      if (out === undefined) continue
      // Outside the box: at least one axis is past the edge.
      const dx = out.x - positioned.width / 2
      const dy = out.y - positioned.height / 2
      const escape = Math.max(
        Math.abs(dx) / (positioned.width / 2),
        Math.abs(dy) / (positioned.height / 2),
      )
      expect(escape).toBeGreaterThan(1)

      // On the ray: the anchor's absolute point is further from the hub than
      // the node's centre, and in the same direction.
      const c = centre(positioned)
      const absolute = { x: positioned.x + out.x, y: positioned.y + out.y }
      const toCentre = Math.hypot(c.x - hub.x, c.y - hub.y)
      const toAnchor = Math.hypot(absolute.x - hub.x, absolute.y - hub.y)
      expect(toAnchor).toBeGreaterThan(toCentre)
      const cross = (c.x - hub.x) * (absolute.y - hub.y) - (c.y - hub.y) * (absolute.x - hub.x)
      expect(Math.abs(cross)).toBeLessThan(1e-6 * Math.max(1, toCentre * toAnchor))
    }
  })
})

// ── the ragged inputs ──────────────────────────────────────────────────────

describe('layoutMindtreeRadial — every number finite, whatever it is handed', () => {
  it('survives NaN, zero and negative sizes', () => {
    const tree = node('root', [node('a', [node('a1')]), node('b'), node('c')])
    const sizes: Array<Partial<NodeSize> | undefined> = [
      { width: Number.NaN, height: Number.NaN },
      { width: 0, height: 0 },
      { width: -50, height: -1 },
      { width: Number.POSITIVE_INFINITY, height: 10 },
      undefined,
    ]
    for (const size of sizes) {
      for (const direction of ['ltr', 'rtl'] as const) {
        const layout = layoutMindtreeRadial(tree, { sizeOf: () => size, direction })
        expectFinite(layout)
        expectNoOverlapAnywhere(layout)
      }
    }
  })

  it('survives a NaN gap, a negative gap and a NaN nodeSize', () => {
    const layout = layoutMindtreeRadial(fan(5), {
      gap: { depth: Number.NaN, sibling: -12 },
      nodeSize: { width: Number.NaN, height: 0 },
    })
    expectFinite(layout)
    expectNoOverlapAnywhere(layout)
  })

  it('survives a NaN startAngle', () => {
    const layout = layoutMindtreeRadial(fan(5), { startAngle: Number.NaN })
    expectFinite(layout)
    expect(radialWedges(fan(5), { startAngle: Number.NaN }).get('k0')?.bearing).toBe(0)
  })

  it('costs a frame at a thousand leaves', () => {
    const tracks: TestNode[] = []
    for (let t = 0; t < 5; t += 1) {
      const groups: TestNode[] = []
      for (let g = 0; g < 4; g += 1) {
        const entries: TestNode[] = []
        for (let e = 0; e < 50; e += 1) entries.push(node(`e${t}-${g}-${e}`))
        groups.push(node(`g${t}-${g}`, entries))
      }
      tracks.push(node(`t${t}`, groups))
    }
    const started = performance.now()
    const layout = layoutMindtreeRadial(node('root', tracks))
    const elapsed = performance.now() - started
    expect(layout.nodes).toHaveLength(1 + 5 + 20 + 1000)
    expect(elapsed).toBeLessThan(250)
    expectFinite(layout)
  })
})

// ── the ring rule ──────────────────────────────────────────────────────────

describe('ringNodeSize — the outer rings get narrower, and nothing gets smaller than a target', () => {
  const base: NodeSize = { width: 168, height: 44 }

  it('gives ring 1 the base, ring 2 132 and ring 3+ 108', () => {
    const opts = { base }
    expect(ringNodeSize(0, opts)).toEqual({ width: 168, height: 44 })
    expect(ringNodeSize(1, opts)).toEqual({ width: 168, height: 44 })
    expect(ringNodeSize(2, opts)).toEqual({ width: 132, height: 44 })
    expect(ringNodeSize(3, opts)).toEqual({ width: 108, height: 44 })
    expect(ringNodeSize(7, opts)).toEqual({ width: 108, height: 44 })
  })

  it('never widens a base the caller already narrowed', () => {
    const narrow = { base: { width: 96, height: 44 } }
    expect(ringNodeSize(2, narrow).width).toBe(96)
    expect(ringNodeSize(3, narrow).width).toBe(96)
  })

  it('never returns anything below the 44px target floor', () => {
    const tiny = { base: { width: 4, height: 2 } }
    for (const depth of [0, 1, 2, 3, 12]) {
      expect(ringNodeSize(depth, tiny).width).toBeGreaterThanOrEqual(44)
      expect(ringNodeSize(depth, tiny).height).toBeGreaterThanOrEqual(44)
    }
    const nonsense = { base: { width: Number.NaN, height: Number.NaN } }
    expect(ringNodeSize(Number.NaN, nonsense)).toEqual({ width: 44, height: 44 })
  })

  it('turns ANY ring into a 44x44 count chip when the BAND says chip', () => {
    // MAP-ZOOM §4's single highest-leverage edit: the count chip with its label
    // outside along the ray was measured on a phone and is true at every width,
    // so the guard is the band and not the device. Depth no longer gates it —
    // a world at CHIP apparent size is a chip whether it is ring 1 or ring 5.
    const chip = { base, chip: true }
    expect(ringNodeSize(1, chip)).toEqual({ width: 44, height: 44 })
    expect(ringNodeSize(2, chip)).toEqual({ width: 44, height: 44 })
    expect(ringNodeSize(5, chip)).toEqual({ width: 44, height: 44 })
    // never the hub: the root of a world is not a ring rule's to size
    expect(ringNodeSize(0, chip)).toEqual({ width: 168, height: 44 })
    // and `chip: false` is an answer, not an absence
    expect(ringNodeSize(1, { base, chip: false })).toEqual({ width: 168, height: 44 })
  })

  it('is what keeps a nine-track ring on a 375px phone', () => {
    // The measured claim behind the count chip, restated against the phone's
    // own numbers: a 359x391 unoccluded canvas and the 0.62 scale floor below
    // which the 12.5px label stops being a label. Nine tracks at 132x44 miss
    // it; the same nine as 44x44 chips clear it with room.
    const phone = { width: 359, height: 391 }
    const gap = { depth: 40, sibling: 10 }
    const scaleOf = (tree: TestNode, size: NodeSize): number =>
      fitToViewBox(layoutMindtreeRadial(tree, { gap, sizeOf: (_n, depth) => (depth === 0 ? { width: 132, height: 44 } : size) }).bounds, phone, {
        padding: 28,
        maxScale: 1,
      }).scale

    expect(scaleOf(fan(9), { width: 132, height: 44 })).toBeLessThan(0.62)
    expect(scaleOf(fan(9), { width: 44, height: 44 })).toBeGreaterThan(0.62)
  })
})

// ── the ceiling ────────────────────────────────────────────────────────────

describe('ringsThatFit — the depth cap is a measurement, not a table', () => {
  const viewport = { width: 1000, height: 800 }
  const square = (side: number): Bounds => ({
    minX: 0,
    minY: 0,
    maxX: side,
    maxY: side,
    width: side,
    height: side,
  })

  it('returns 1 when ring 2 does not fit, without ever measuring ring 1', () => {
    const asked: number[] = []
    const limit = ringsThatFit({
      boundsAt: (depthLimit) => {
        asked.push(depthLimit)
        return square(depthLimit === 2 ? 90_000 : 100)
      },
      viewport,
      padding: 28,
      minScale: 0.545,
      maxDepth: 4,
    })
    expect(limit).toBe(1)
    // It stopped at the FIRST failure: ring 3 and ring 4 were never laid out.
    expect(asked).toEqual([2])
  })

  it('walks upward while the picture still fits', () => {
    const sizes: Record<number, number> = { 2: 400, 3: 900, 4: 40_000 }
    const limit = ringsThatFit({
      boundsAt: (depthLimit) => square(sizes[depthLimit] ?? 100),
      viewport,
      padding: 28,
      minScale: 0.545,
      maxDepth: 4,
    })
    expect(limit).toBe(3)
  })

  it('never exceeds maxDepth, and never goes below one ring', () => {
    const everythingFits = (): Bounds => square(10)
    expect(
      ringsThatFit({
        boundsAt: everythingFits,
        viewport,
        padding: 28,
        minScale: 0.545,
        maxDepth: 2,
      }),
    ).toBe(2)
    for (const maxDepth of [1, 0, -3, Number.NaN]) {
      expect(
        ringsThatFit({ boundsAt: everythingFits, viewport, padding: 28, minScale: 0.545, maxDepth }),
      ).toBe(1)
    }
    // Nothing fits at all — one ring is still the answer, because a map that
    // draws no ring is not a map.
    expect(
      ringsThatFit({
        boundsAt: () => square(1e9),
        viewport,
        padding: 28,
        minScale: 0.545,
        maxDepth: 4,
      }),
    ).toBe(1)
  })

  it('is the predicate the ceiling is actually made of', () => {
    // A wide-and-shallow workspace (9 tracks x 5 buckets x 4 orgs) against a
    // narrow-and-deep one (3 x 4 x 6) on the SAME 1576x835 stage. Measured
    // against this implementation, at nodeSize 168x44 and the ring rule:
    //
    //   shape    | ring 1        | ring 2            | ring 3
    //   9,5,4    | r 271, s 1.00 | 45 nodes r 1083, s 0.366  | s 0.112
    //   3,4,6    | r 230, s 1.00 | 12 nodes r 442,  s 0.860  | s 0.273
    //
    // So the wide workspace gets ONE ring and the deep one gets TWO, from the
    // same predicate and the same 24/44 floor. Note the departure from the
    // design note's worked example, which put 45 buckets at r 577 and called
    // ring 2 exactly affordable: 45 boxes 132 wide with a 12 gap need 6,795
    // units of circumference whichever closed form you use, which is r 1082.
    // The desktop budget at a typical fan-out is root + ONE ring; the second
    // ring arrives when it holds roughly twenty nodes or fewer.
    const build = (fanOut: readonly number[]): TestNode => {
      let id = 0
      const grow = (level: number): TestNode => {
        const kids: TestNode[] = []
        if (level < fanOut.length) {
          for (let i = 0; i < fanOut[level]; i += 1) kids.push(grow(level + 1))
        }
        return node(`n${id++}`, kids)
      }
      return grow(0)
    }
    const stage = { width: 1576, height: 835 }
    const measure = (tree: TestNode): number =>
      ringsThatFit({
        boundsAt: (depthLimit) =>
          layoutMindtreeRadial(tree, {
            depthLimit,
            sizeOf: (_n, depth) =>
              ringNodeSize(depth, { base: { width: 168, height: 44 } }),
          }).bounds,
        viewport: stage,
        padding: 28,
        minScale: 24 / 44,
        maxDepth: 3,
      })

    expect(measure(build([9, 5, 4]))).toBe(1)
    expect(measure(build([3, 4, 6]))).toBe(2)
  })
})
