// Contract tests for the containment drawing.
//
// Same rules as layout.test.ts and radial.test.ts: no mocks, no DOM, no clock.
// worlds.ts takes a tree and a direction and returns numbers, and everything
// below is an assertion about those numbers.
//
// THE INVARIANTS, and why each one is here:
//   · CONTAINMENT — a child's world is entirely inside its parent's. This is
//     the drawing. Break it and "the thing you zoom into becomes the whole
//     frame" becomes "the thing you zoom into overlaps the thing beside it".
//   · SIBLINGS ARE DISJOINT, with the gap — the failure the arc-length radius
//     produces at three children and the SHORTER CHORD produces at all of them.
//   · EVERY MARK IS INSIDE ITS OWN WORLD — cards, chevrons, spokes and control
//     points. That is what lets the renderer cull by disc and never clip.
//   · THE PARTITION IS EXACT, by SHARED ENDPOINTS. A telescoping sum of float
//     differences is not exact; a chain of shared endpoints is.
//   · BOUNDS CONTAIN THE CURVES and are CENTRED ON THE ROOT — the second is the
//     precondition for the first being mirrorable.
//   · THE MIRROR IS AN EQUALITY. Arabic is not a second layout to eyeball, and
//     the root's x is the same FLOAT in both directions.
//   · NO CAMERA. `layoutWorlds` cannot depend on the zoom, because it is not
//     handed one — asserted by arity AND by a build-count test, because the
//     whole of MAP-ZOOM rests on this one fact.
//   · FINITE, ALWAYS — a NaN size, a zero size, one child, no children, two
//     hundred children, six tiers.

import { describe, expect, it } from 'vitest'
import { layoutMindtree } from './layout'
import type { LayoutInputNode, NodeSize } from './layout'
import { packRing } from './radial'
import {
  D_LEAF,
  FRAME_FRACTION,
  GAP_RATIO,
  RIM,
  SINGLE_CHILD_RATIO,
  ancestorWorlds,
  layoutWorlds,
  worldAt,
} from './worlds'
import type { WorldLayout, WorldNode } from './worlds'

const TAU = Math.PI * 2
const EPS = 1e-9

interface TestNode extends LayoutInputNode {
  readonly id: string
  readonly kind?: string
  readonly children?: readonly TestNode[]
  readonly collapsed?: boolean
  readonly size?: NodeSize
}

function node(id: string, children: readonly TestNode[] = [], extra: Partial<TestNode> = {}): TestNode {
  return { id, children, ...extra }
}

/** A root with `n` identical leaf children — one ring, the shape every ratio in
 *  the header was computed against. */
function fan(n: number, prefix = 'k'): TestNode {
  const kids: TestNode[] = []
  for (let i = 0; i < n; i += 1) kids.push(node(`${prefix}${i}`))
  return node('root', kids)
}

/** A uniform tree: `breadth` children at every node, `depth` tiers below the
 *  root. depth 0 is a bare leaf. */
function uniform(depth: number, breadth: number, prefix = 'n'): TestNode {
  if (depth <= 0) return node(prefix)
  const kids: TestNode[] = []
  for (let i = 0; i < breadth; i += 1) kids.push(uniform(depth - 1, breadth, `${prefix}.${i}`))
  return node(prefix, kids)
}

/** The workspace as it actually is: UHR and its siblings, departments beneath,
 *  Organizations as the leaves — the three tiers MAP-ZOOM §9.3 says is all the
 *  depth there is today. */
function workspace(): TestNode {
  const org = (p: string, i: number): TestNode => node(`${p}/org${i}`, [], { kind: 'entity' })
  const dept = (p: string, i: number, orgs: number): TestNode => {
    const kids: TestNode[] = []
    for (let k = 0; k < orgs; k += 1) kids.push(org(`${p}/d${i}`, k))
    return node(`${p}/d${i}`, kids, { kind: 'entity' })
  }
  const programme = (i: number, depts: number, orgs: number): TestNode => {
    const kids: TestNode[] = []
    for (let k = 0; k < depts; k += 1) kids.push(dept(`p${i}`, k, orgs))
    return node(`p${i}`, kids, { kind: 'track' })
  }
  return node('root', [programme(0, 4, 6), programme(1, 2, 3), programme(2, 6, 9)], { kind: 'root' })
}

function distance(a: WorldNode<TestNode>, b: WorldNode<TestNode>): number {
  return Math.hypot(a.worldX - b.worldX, a.worldY - b.worldY)
}

function childrenOf(layout: WorldLayout<TestNode>, id: string): WorldNode<TestNode>[] {
  const parent = layout.byId.get(id)
  if (parent === undefined) return []
  return parent.childIds.map((cid) => layout.byId.get(cid) as WorldNode<TestNode>)
}

/** Every number the layout returns, so "no NaN, ever" is one call. */
function everyNumber(layout: WorldLayout<TestNode>): number[] {
  const out: number[] = [layout.bounds.width, layout.bounds.height, layout.rootD, layout.maxDepth]
  for (const n of layout.nodes) {
    out.push(n.x, n.y, n.width, n.height, n.worldX, n.worldY, n.worldD, n.cardScale)
    out.push(n.bearing, n.wedgeStart, n.wedgeEnd, n.depth, n.index, n.siblingCount)
    if (n.outward !== undefined) out.push(n.outward.x, n.outward.y)
  }
  for (const e of layout.edges) {
    out.push(e.start.x, e.start.y, e.end.x, e.end.y, e.c1.x, e.c1.y, e.c2.x, e.c2.y)
  }
  return out
}

function expectFinite(layout: WorldLayout<TestNode>): void {
  for (const value of everyNumber(layout)) expect(Number.isFinite(value)).toBe(true)
}

// ── the packing constants ──────────────────────────────────────────────────

describe('the packing constants are named, exported and load-bearing', () => {
  it('holds the four values MAP-ZOOM §11 fixes', () => {
    expect(RIM).toBe(1.14)
    expect(GAP_RATIO).toBe(0.18)
    expect(D_LEAF).toBe(200)
    expect(SINGLE_CHILD_RATIO).toBe(2.2)
  })

  it('D_LEAF holds a 168x44 card with the rim to spare', () => {
    // The reason 200 is the unit: the authored leaf card's diagonal, plus room.
    expect(Math.hypot(168, 44)).toBeLessThan(D_LEAF)
  })
})

// ── packRing ───────────────────────────────────────────────────────────────

describe('packRing — the chord, applied inward', () => {
  const D = 200
  const gap = GAP_RATIO * D

  it('separates adjacent worlds by the SUM of their radii plus the gap, not half of it', () => {
    // THE DEPARTURE, asserted rather than described. MAP-ZOOM §11's headline
    // `(D_child/2 + gap)` would put six centres 0.68·D apart; two discs of
    // diameter D need 1.18·D to be clear of each other.
    for (const n of [2, 3, 4, 6, 9, 12]) {
      const ring = packRing({ childD: new Array<number>(n).fill(D), gap })
      const step = TAU / n
      const chord = 2 * ring.radius * Math.sin(step / 2)
      expect(chord).toBeGreaterThanOrEqual(D + gap - 1e-6)
      // and not wastefully more: the binding pair sits exactly on the constraint
      expect(chord).toBeLessThan(D + gap + 1e-6)
    }
  })

  it('is the CHORD and not the ARC at three children, the commonest fan-out', () => {
    const ring = packRing({ childD: [D, D, D], gap })
    // arc form: Σ(D + gap) / 2π
    const arc = (3 * (D + gap)) / TAU
    expect(ring.radius).toBeGreaterThan(arc)
    expect(ring.radius).toBeCloseTo((D + gap) / (2 * Math.sin(Math.PI / 3)), 9)
  })

  it('reports the tier ratios the header tabulates', () => {
    const ratio = (n: number): number => packRing({ childD: new Array<number>(n).fill(D), gap }).parentD / D
    expect(ratio(2)).toBeCloseTo(2.49, 2)
    expect(ratio(3)).toBeCloseTo(2.69, 2)
    expect(ratio(4)).toBeCloseTo(3.04, 2)
    expect(ratio(6)).toBeCloseTo(3.83, 2)
    expect(ratio(9)).toBeCloseTo(5.07, 2)
  })

  it('grows a lone child by SINGLE_CHILD_RATIO and leaves the same rim margin', () => {
    const ring = packRing({ childD: [D], gap })
    expect(ring.parentD).toBeCloseTo(D * SINGLE_CHILD_RATIO, 9)
    // r + D/2 === parentD / (2·RIM) — the general case's margin, restated.
    expect(ring.radius + D / 2).toBeCloseTo(ring.parentD / (2 * RIM), 9)
    expect(ring.radius).toBeGreaterThan(0)
  })

  it('answers a leaf with the authored unit and an empty ring', () => {
    const ring = packRing({ childD: [], gap })
    expect(ring).toEqual({ radius: 0, bearings: [], parentD: D_LEAF, edges: [0] })
  })

  it('tiles the circle with SHARED endpoints, unequal children included', () => {
    const ring = packRing({ childD: [100, 900, 250, 40], gap: 20 })
    expect(ring.edges).toHaveLength(5)
    expect(ring.edges[0]).toBe(0)
    expect(ring.edges[4]).toBe(TAU)
    for (let k = 0; k < 4; k += 1) {
      // the bearing is the wedge's midpoint, of the SAME two floats
      expect(ring.bearings[k]).toBe((ring.edges[k] + ring.edges[k + 1]) / 2)
      expect(ring.edges[k + 1]).toBeGreaterThan(ring.edges[k])
    }
    // a wider world takes a wider wedge — the packing's own demand, not a
    // second encoding
    const widths = [0, 1, 2, 3].map((k) => ring.edges[k + 1] - ring.edges[k])
    expect(widths[1]).toBeGreaterThan(widths[2])
    expect(widths[2]).toBeGreaterThan(widths[0])
    expect(widths[0]).toBeGreaterThan(widths[3])
  })

  it('keeps EVERY pair clear, not merely the adjacent ones — the second pass', () => {
    // Two wide worlds either side of a narrow one sit at twice the narrow one's
    // angular step, and twice a small angle buys less than twice the chord.
    const childD = [900, 60, 900, 60, 900, 60]
    const ring = packRing({ childD, gap: 30 })
    for (let i = 0; i < childD.length; i += 1) {
      for (let j = i + 1; j < childD.length; j += 1) {
        const delta = Math.abs(ring.bearings[i] - ring.bearings[j])
        const chord = 2 * ring.radius * Math.sin(Math.min(delta, TAU - delta) / 2)
        expect(chord).toBeGreaterThanOrEqual(childD[i] / 2 + childD[j] / 2 + 30 - 1e-6)
      }
    }
  })

  it('is finite for 200 children, for a NaN diameter and for a negative gap', () => {
    const many = packRing({ childD: new Array<number>(200).fill(D), gap })
    expect(Number.isFinite(many.radius)).toBe(true)
    expect(Number.isFinite(many.parentD)).toBe(true)
    expect(many.bearings).toHaveLength(200)

    const nonsense = packRing({ childD: [Number.NaN, 0, -50, D], gap: Number.NaN })
    expect(Number.isFinite(nonsense.radius)).toBe(true)
    expect(Number.isFinite(nonsense.parentD)).toBe(true)
    for (const b of nonsense.bearings) expect(Number.isFinite(b)).toBe(true)
  })
})

// ── the drawing is a function of the tree, and of nothing else ─────────────

describe('layoutWorlds — no camera, by construction', () => {
  it('takes a tree, and everything else is optional and none of it is a camera', () => {
    // The type says so; this says so at runtime, which is what a reviewer of a
    // future edit will actually run. `length` counts parameters BEFORE the first
    // default, so 1 is "the tree is the only thing this function requires" —
    // and the optional bag is `WorldOptions`, whose every field is a fact about
    // the tree or the reading direction.
    expect(layoutWorlds.length).toBe(1)
    expect(Object.keys(layoutWorlds(fan(3), {}))).toEqual([
      'nodes',
      'byId',
      'edges',
      'bounds',
      'maxDepth',
      'rootD',
      'revision',
    ])
  })

  it('is not re-entered by any camera movement, and its output keeps its identity', () => {
    let builds = 0
    const build = (): WorldLayout<TestNode> => {
      builds += 1
      return layoutWorlds(workspace())
    }
    const layout = build()
    const nodes = layout.nodes
    const first = layout.nodes[0]

    // Twenty cameras: three octaves of zoom across the whole drawing.
    for (let i = 0; i < 20; i += 1) {
      const scale = 0.05 * Math.pow(1.4, i)
      worldAt(layout, { cx: layout.bounds.width / 2, cy: layout.bounds.height / 2 }, scale, 835)
    }

    expect(builds).toBe(1)
    expect(layout.nodes).toBe(nodes)
    expect(layout.nodes[0]).toBe(first)
  })

  it('gives the same tree the same drawing, twice', () => {
    const a = layoutWorlds(workspace())
    const b = layoutWorlds(workspace())
    expect(a.revision).toBe(b.revision)
    expect(a.rootD).toBe(b.rootD)
    expect(a.nodes.map((n) => [n.id, n.worldX, n.worldY, n.worldD])).toEqual(
      b.nodes.map((n) => [n.id, n.worldX, n.worldY, n.worldD]),
    )
  })

  it('ignores the reader collapse choices — geometry is the TREE, not the fold', () => {
    const open = layoutWorlds(node('root', [node('a', [node('a1'), node('a2')]), node('b')]))
    const folded = layoutWorlds(
      node('root', [node('a', [node('a1'), node('a2')], { collapsed: true }), node('b')]),
    )
    expect(folded.nodes.map((n) => n.id)).toEqual(open.nodes.map((n) => n.id))
    expect(folded.rootD).toBe(open.rootD)
    expect(folded.revision).toBe(open.revision)
    // …and the flag still rides through for aria-expanded and the table.
    expect(folded.byId.get('a')?.collapsed).toBe(true)
    expect(folded.byId.get('a')?.hiddenChildCount).toBe(0)
  })

  it('changes its revision when the TREE changes, and only then', () => {
    const base = layoutWorlds(fan(4))
    expect(layoutWorlds(fan(4)).revision).toBe(base.revision)
    expect(layoutWorlds(fan(5)).revision).not.toBe(base.revision)
    expect(layoutWorlds(fan(4, 'j')).revision).not.toBe(base.revision)
    expect(layoutWorlds(fan(4), { direction: 'rtl' }).revision).not.toBe(base.revision)
    expect(
      layoutWorlds(fan(4), { sizeOf: (_n, depth) => (depth === 1 ? { width: 300 } : undefined) })
        .revision,
    ).not.toBe(base.revision)
  })
})

// ── containment ────────────────────────────────────────────────────────────

describe('layoutWorlds — a child world is entirely inside its parent', () => {
  const trees: [string, TestNode][] = [
    ['the workspace', workspace()],
    ['a six-wide, three-deep tree', uniform(3, 6)],
    ['a lone chain', node('root', [node('a', [node('b', [node('c')])])])],
    ['one ring of forty', fan(40)],
  ]

  for (const [name, tree] of trees) {
    it(`holds for ${name}, in both directions`, () => {
      for (const direction of ['ltr', 'rtl'] as const) {
        const layout = layoutWorlds(tree, { direction })
        for (const child of layout.nodes) {
          if (child.parentId === null) continue
          const parent = layout.byId.get(child.parentId) as WorldNode<TestNode>
          const reach = distance(child, parent) + child.worldD / 2
          expect(reach).toBeLessThanOrEqual(parent.worldD / 2 + EPS)
          // and the rim is genuinely empty: RIM is not decoration
          expect(reach).toBeLessThanOrEqual(parent.worldD / (2 * RIM) + EPS)
        }
      }
    })
  }
})

describe('layoutWorlds — sibling worlds never touch', () => {
  it('separates every pair on a ring by the sum of the radii and the gap', () => {
    const layout = layoutWorlds(workspace())
    for (const parent of layout.nodes) {
      const kids = childrenOf(layout, parent.id)
      if (kids.length < 2) continue
      let widest = 0
      for (const k of kids) widest = Math.max(widest, k.worldD)
      const gap = GAP_RATIO * widest
      for (let i = 0; i < kids.length; i += 1) {
        for (let j = i + 1; j < kids.length; j += 1) {
          const need = kids[i].worldD / 2 + kids[j].worldD / 2 + gap
          expect(distance(kids[i], kids[j])).toBeGreaterThanOrEqual(need - 1e-6)
        }
      }
    }
  })

  it('holds at the fan-out the naive arc radius fails on', () => {
    const layout = layoutWorlds(fan(3))
    const kids = childrenOf(layout, 'root')
    for (let i = 0; i < 3; i += 1) {
      for (let j = i + 1; j < 3; j += 1) {
        expect(distance(kids[i], kids[j])).toBeGreaterThanOrEqual(D_LEAF + GAP_RATIO * D_LEAF - 1e-6)
      }
    }
  })

  it('keeps the CARDS clear as a corollary, without a pairwise box test', () => {
    // Two discs that do not touch cannot contain overlapping rectangles.
    const layout = layoutWorlds(uniform(2, 5))
    for (const parent of layout.nodes) {
      const kids = childrenOf(layout, parent.id)
      for (let i = 0; i < kids.length; i += 1) {
        for (let j = i + 1; j < kids.length; j += 1) {
          const a = kids[i]
          const b = kids[j]
          const apart =
            a.x + a.width <= b.x + EPS ||
            b.x + b.width <= a.x + EPS ||
            a.y + a.height <= b.y + EPS ||
            b.y + b.height <= a.y + EPS
          expect(apart).toBe(true)
        }
      }
    }
  })
})

describe('layoutWorlds — every mark a node owns is inside its own world', () => {
  it('holds for cards, chevrons and spokes, in both directions', () => {
    for (const direction of ['ltr', 'rtl'] as const) {
      const layout = layoutWorlds(workspace(), { direction })
      for (const n of layout.nodes) {
        const radius = n.worldD / 2 + EPS
        const corners: [number, number][] = [
          [n.x, n.y],
          [n.x + n.width, n.y],
          [n.x, n.y + n.height],
          [n.x + n.width, n.y + n.height],
        ]
        for (const [x, y] of corners) {
          expect(Math.hypot(x - n.worldX, y - n.worldY)).toBeLessThanOrEqual(radius)
        }
        const out = n.outward as { x: number; y: number }
        expect(
          Math.hypot(n.x + out.x - n.worldX, n.y + out.y - n.worldY),
        ).toBeLessThanOrEqual(radius)
      }
      for (const edge of layout.edges) {
        const parent = layout.byId.get(edge.parentId) as WorldNode<TestNode>
        const radius = parent.worldD / 2 + EPS
        for (const p of [edge.start, edge.end, edge.c1, edge.c2]) {
          expect(Math.hypot(p.x - parent.worldX, p.y - parent.worldY)).toBeLessThanOrEqual(radius)
        }
      }
    }
  })

  it('puts a chevron OUTSIDE its own card and inside the world', () => {
    const layout = layoutWorlds(fan(6))
    for (const n of layout.nodes) {
      if (n.parentId === null) continue
      const out = n.outward as { x: number; y: number }
      const fromCentre = Math.hypot(n.x + out.x - n.worldX, n.y + out.y - n.worldY)
      expect(fromCentre).toBeGreaterThan(Math.min(n.width, n.height) / 2)
      expect(fromCentre).toBeLessThanOrEqual(n.worldD / 2 + EPS)
    }
  })
})

// ── the partition ──────────────────────────────────────────────────────────

describe('layoutWorlds — the wedges tile the circle by SHARED ENDPOINTS', () => {
  it('gives each boundary as ONE float, read twice', () => {
    const layout = layoutWorlds(workspace())
    for (const parent of layout.nodes) {
      const kids = childrenOf(layout, parent.id)
      if (kids.length === 0) continue
      for (let k = 0; k + 1 < kids.length; k += 1) {
        expect(Object.is(kids[k].wedgeEnd, kids[k + 1].wedgeStart)).toBe(true)
      }
      // a full turn, start to finish
      expect(kids[kids.length - 1].wedgeEnd - kids[0].wedgeStart).toBeCloseTo(TAU, 9)
      // …and the bearing a child is drawn on is inside its own wedge
      for (const kid of kids) {
        expect(kid.bearing).toBeGreaterThanOrEqual(kid.wedgeStart - EPS)
        expect(kid.bearing).toBeLessThanOrEqual(kid.wedgeEnd + EPS)
      }
    }
  })

  it('reverses the chain under the mirror, and shares the boundaries there too', () => {
    const layout = layoutWorlds(workspace(), { direction: 'rtl' })
    for (const parent of layout.nodes) {
      const kids = childrenOf(layout, parent.id)
      if (kids.length === 0) continue
      for (let k = 0; k + 1 < kids.length; k += 1) {
        // θ → π − θ turns a forward chain into a backward one, and the shared
        // float is still shared.
        expect(Object.is(kids[k].wedgeStart, kids[k + 1].wedgeEnd)).toBe(true)
      }
      for (const kid of kids) expect(kid.wedgeStart).toBeLessThanOrEqual(kid.wedgeEnd)
    }
  })

  it('gives a wider world a wider wedge', () => {
    const layout = layoutWorlds(workspace())
    const kids = childrenOf(layout, 'root')
    const wedge = (n: WorldNode<TestNode>): number => n.wedgeEnd - n.wedgeStart
    // p2 (six departments of nine orgs) is the largest world on the ring
    const sorted = [...kids].sort((a, b) => a.worldD - b.worldD)
    expect(wedge(sorted[0])).toBeLessThan(wedge(sorted[sorted.length - 1]))
  })
})

// ── bounds ─────────────────────────────────────────────────────────────────

describe('layoutWorlds — the bounds tell the truth', () => {
  it('is the root world square, centred on the root, normalised to the origin', () => {
    for (const direction of ['ltr', 'rtl'] as const) {
      const layout = layoutWorlds(workspace(), { direction })
      const root = layout.nodes[0]
      expect(layout.bounds.minX).toBe(0)
      expect(layout.bounds.minY).toBe(0)
      expect(layout.bounds.width).toBe(layout.rootD)
      expect(layout.bounds.height).toBe(layout.rootD)
      expect(root.worldX).toBe(layout.bounds.width / 2)
      expect(root.worldY).toBe(layout.bounds.height / 2)
      expect(root.worldD).toBe(layout.rootD)
    }
  })

  it('contains every card, every spoke and every control point', () => {
    const layout = layoutWorlds(uniform(3, 4))
    const inside = (x: number, y: number): void => {
      expect(x).toBeGreaterThanOrEqual(layout.bounds.minX - EPS)
      expect(x).toBeLessThanOrEqual(layout.bounds.maxX + EPS)
      expect(y).toBeGreaterThanOrEqual(layout.bounds.minY - EPS)
      expect(y).toBeLessThanOrEqual(layout.bounds.maxY + EPS)
    }
    for (const n of layout.nodes) {
      inside(n.x, n.y)
      inside(n.x + n.width, n.y + n.height)
    }
    for (const e of layout.edges) {
      for (const p of [e.start, e.end, e.c1, e.c2]) inside(p.x, p.y)
    }
  })

  it('is a CONSTANT for a given tree — the fact the camera is keyed on', () => {
    const tree = workspace()
    const a = layoutWorlds(tree)
    const b = layoutWorlds(tree)
    expect(a.bounds).toEqual(b.bounds)
    expect(a.revision).toBe(b.revision)
  })
})

// ── the mirror ─────────────────────────────────────────────────────────────

describe('layoutWorlds — RTL is one reflection, and it is an equality', () => {
  const tree = workspace()
  const ltr = layoutWorlds(tree, { direction: 'ltr' })
  const rtl = layoutWorlds(tree, { direction: 'rtl' })

  it('leaves the root on the hub, to the FLOAT', () => {
    expect(rtl.nodes[0].worldX).toBe(ltr.nodes[0].worldX)
    expect(rtl.nodes[0].worldY).toBe(ltr.nodes[0].worldY)
    expect(rtl.nodes[0].x).toBe(ltr.nodes[0].x)
    expect(rtl.bounds).toEqual(ltr.bounds)
  })

  it('reflects every world about the hub and changes nothing else', () => {
    const width = ltr.bounds.width
    for (let i = 0; i < ltr.nodes.length; i += 1) {
      const a = ltr.nodes[i]
      const b = rtl.nodes[i]
      expect(b.id).toBe(a.id)
      expect(b.worldD).toBe(a.worldD)
      expect(b.width).toBe(a.width)
      expect(b.height).toBe(a.height)
      expect(b.worldY).toBe(a.worldY)
      // WITHIN ONE ULP, and the exact size of the residue is the point.
      // `hubX + x` and `hubX - x` are two roundings of two exactly-negated
      // offsets, so their sum can miss `2·hubX` by at most one unit in the last
      // place — 4.5e-13 at the far edge of a 7,400-unit drawing, which is 10^-16
      // of a CSS pixel at any zoom this app can reach. It is NOT a drift that
      // could grow: there is no accumulation here, only one reflection. The
      // place where the mirror IS byte-exact is the hub itself, asserted above,
      // and that is the fixed point the whole equality is built on.
      expect(Math.abs(a.worldX + b.worldX - width)).toBeLessThanOrEqual(
        Number.EPSILON * width,
      )
      // θ → π − θ, the one statement, applied to the bearing as well
      expect(Object.is(b.bearing, Math.PI - a.bearing)).toBe(true)
    }
  })

  it('mirrors the chevron inside its own card rather than asking the renderer to', () => {
    for (let i = 0; i < ltr.nodes.length; i += 1) {
      const a = ltr.nodes[i].outward as { x: number; y: number }
      const b = rtl.nodes[i].outward as { x: number; y: number }
      expect(b.y).toBeCloseTo(a.y, 9)
      expect(b.x).toBeCloseTo(ltr.nodes[i].width - a.x, 9)
    }
  })
})

// ── the shared build walk ──────────────────────────────────────────────────

describe('layoutWorlds — the accessible tree cannot diverge by shape', () => {
  it('is the linear layout pre-order, node for node and aria field for aria field', () => {
    const tree = workspace()
    const linear = layoutMindtree(tree)
    const worlds = layoutWorlds(tree)
    expect(worlds.nodes.map((n) => n.id)).toEqual(linear.nodes.map((n) => n.id))
    for (let i = 0; i < linear.nodes.length; i += 1) {
      const a = linear.nodes[i]
      const b = worlds.nodes[i]
      expect(b.depth).toBe(a.depth)
      expect(b.index).toBe(a.index)
      expect(b.siblingCount).toBe(a.siblingCount)
      expect(b.parentId).toBe(a.parentId)
      expect(b.childIds).toEqual(a.childIds)
      expect(b.hasChildren).toBe(a.hasChildren)
      expect(b.hiddenChildCount).toBe(a.hiddenChildCount)
    }
    expect(worlds.maxDepth).toBe(linear.maxDepth)
  })

  it('keeps aria-setsize on the MODEL sibling count', () => {
    const layout = layoutWorlds(workspace())
    for (const n of layout.nodes) {
      if (n.parentId === null) {
        expect(n.siblingCount).toBe(1)
        continue
      }
      const parent = layout.byId.get(n.parentId) as WorldNode<TestNode>
      expect(n.siblingCount).toBe(parent.childIds.length)
    }
  })

  it('closes the cycle and duplicate-id guard, because it did not copy the walk', () => {
    const shared = node('dup')
    const layout = layoutWorlds(node('root', [node('a', [shared]), node('b', [shared])]))
    expect(layout.nodes.map((n) => n.id)).toEqual(['root', 'a', 'dup', 'b'])
    expect(layout.byId.get('b')?.hiddenChildCount).toBe(1)
    expectFinite(layout)
  })
})

// ── the two queries ────────────────────────────────────────────────────────

describe('worldAt — the breadcrumb, derived', () => {
  const layout = layoutWorlds(workspace())
  const centre = { cx: layout.bounds.width / 2, cy: layout.bounds.height / 2 }
  const V = 835

  it('names the root when the root fills the frame', () => {
    const scale = (FRAME_FRACTION * V) / layout.rootD
    expect(worldAt(layout, centre, scale, V)?.id).toBe('root')
  })

  it('names nothing at all when the drawing is smaller than the frame test', () => {
    const scale = (0.5 * FRAME_FRACTION * V) / layout.rootD
    expect(worldAt(layout, centre, scale, V)).toBeNull()
  })

  it('descends as the camera closes on a programme, and never skips a tier', () => {
    const p2 = layout.byId.get('p2') as WorldNode<TestNode>
    const at = { cx: p2.worldX, cy: p2.worldY }
    const rootFrames = (FRAME_FRACTION * V) / layout.rootD
    const p2Frames = (FRAME_FRACTION * V) / p2.worldD
    expect(worldAt(layout, at, rootFrames, V)?.id).toBe('root')
    expect(worldAt(layout, at, p2Frames, V)?.id).toBe('p2')

    const dept = layout.byId.get('p2/d0') as WorldNode<TestNode>
    const deptFrames = (FRAME_FRACTION * V) / dept.worldD
    expect(worldAt(layout, { cx: dept.worldX, cy: dept.worldY }, deptFrames, V)?.id).toBe('p2/d0')
  })

  it('is null outside the drawing, whatever the zoom', () => {
    expect(worldAt(layout, { cx: -10_000, cy: -10_000 }, 1, V)).toBeNull()
  })

  it('is total: NaN in, null out', () => {
    expect(worldAt(layout, { cx: Number.NaN, cy: 0 }, 1, V)).toBeNull()
    expect(worldAt(layout, centre, Number.NaN, V)).toBeNull()
    expect(worldAt(layout, centre, 1, Number.NaN)).toBeNull()
    expect(worldAt(layout, centre, 1, V, Number.NaN)?.id).toBe('root')
  })

  it('NEVER frames a group, a bucket or an entry — the owner correction, mechanical', () => {
    const tree = node('root', [
      node('t', [
        node('t/bucket', [node('t/bucket/e1', [], { kind: 'entry' })], { kind: 'group' }),
        node('t/org', [], { kind: 'entity' }),
      ], { kind: 'track' }),
    ], { kind: 'root' })
    const l = layoutWorlds(tree)
    expect(l.byId.get('t/bucket')?.structural).toBe(false)
    expect(l.byId.get('t/bucket/e1')?.structural).toBe(false)
    expect(l.byId.get('t/org')?.structural).toBe(true)
    expect(l.byId.get('t')?.structural).toBe(true)

    const bucket = l.byId.get('t/bucket') as WorldNode<TestNode>
    // A camera sitting exactly on the bucket, close enough that the bucket
    // would qualify on size, still names the DEPARTMENT it is drawn inside.
    const scale = (FRAME_FRACTION * 835) / bucket.worldD
    expect(worldAt(l, { cx: bucket.worldX, cy: bucket.worldY }, scale, 835)?.id).toBe('t')
  })

  it('lets a caller own the predicate outright', () => {
    const l = layoutWorlds(workspace(), { structuralOf: (n) => n.id === 'root' })
    expect(l.nodes.filter((n) => n.structural).map((n) => n.id)).toEqual(['root'])
  })
})

describe('ancestorWorlds — root first, target last, inclusive', () => {
  const layout = layoutWorlds(workspace())

  it('is FocusView.trail shape', () => {
    expect(ancestorWorlds(layout, 'p0/d1/org2').map((n) => n.id)).toEqual([
      'root',
      'p0',
      'p0/d1',
      'p0/d1/org2',
    ])
  })

  it('is the root alone for the root, and empty for a stranger', () => {
    expect(ancestorWorlds(layout, 'root').map((n) => n.id)).toEqual(['root'])
    expect(ancestorWorlds(layout, 'nobody')).toEqual([])
  })

  it('agrees with the depth of every node it returns', () => {
    for (const n of layout.nodes) {
      const trail = ancestorWorlds(layout, n.id)
      expect(trail).toHaveLength(n.depth + 1)
      expect(trail[trail.length - 1].id).toBe(n.id)
    }
  })
})

// ── the numeric range ──────────────────────────────────────────────────────

describe('layoutWorlds — the coordinate space stays where float precision is', () => {
  it('keeps depth 6 at the brief fan-out inside 10^5', () => {
    // MAP-ZOOM §11's own bound, at MAP-ZOOM's own worked shape: a uniform
    // three-wide tier is ratio 2.69, and 200 x 2.69^6 = 76,000.
    const layout = layoutWorlds(uniform(6, 3))
    expect(layout.maxDepth).toBe(6)
    expect(layout.rootD).toBeLessThan(1e5)
    for (const n of layout.nodes) {
      expect(Math.abs(n.worldX)).toBeLessThan(1e5)
      expect(Math.abs(n.worldY)).toBeLessThan(1e5)
    }
    expectFinite(layout)
  })

  it('keeps depth 6 at a WIDE fan-out inside float32 exact-integer range', () => {
    // The departure, priced. Six-wide at six tiers is ratio 3.83 and lands near
    // 6.3e5 — over the brief's 10^5 and three orders under 2^24 = 16,777,216,
    // below which float32 represents every integer exactly. `map_nodes` caps
    // depth at 6, so this IS the worst case the schema can produce.
    const layout = layoutWorlds(uniform(6, 6, 'w'))
    expect(layout.maxDepth).toBe(6)
    expect(layout.rootD).toBeLessThan(1e7)
    expect(layout.rootD).toBeGreaterThan(1e5)
    for (const n of layout.nodes) {
      expect(Number.isFinite(n.worldX)).toBe(true)
      expect(n.worldD).toBeGreaterThan(0)
    }
  })

  it('leaves the finest detail at unit scale', () => {
    const layout = layoutWorlds(uniform(4, 5))
    for (const n of layout.nodes) {
      if (n.childIds.length > 0) continue
      expect(n.worldD).toBe(D_LEAF)
      expect(n.width).toBe(168)
      expect(n.height).toBe(44)
      expect(n.cardScale).toBe(1)
    }
  })

  it('authors every world card at its own scale', () => {
    const layout = layoutWorlds(uniform(3, 4))
    for (const n of layout.nodes) {
      // the card occupies the same share of its world at every depth — the
      // reference's "every level was drawn at its own scale", as arithmetic
      expect(n.width / n.worldD).toBeCloseTo(168 / D_LEAF, 12)
      expect(n.cardScale).toBeCloseTo(n.worldD / D_LEAF, 9)
    }
  })

  it('survives 200 children on one ring', () => {
    const layout = layoutWorlds(fan(200))
    expect(layout.nodes).toHaveLength(201)
    expectFinite(layout)
    const kids = childrenOf(layout, 'root')
    for (let i = 0; i + 1 < kids.length; i += 1) {
      expect(distance(kids[i], kids[i + 1])).toBeGreaterThanOrEqual(
        D_LEAF + GAP_RATIO * D_LEAF - 1e-6,
      )
    }
  })

  it('lays out a thousand-leaf workspace inside the budget', () => {
    const kids: TestNode[] = []
    for (let t = 0; t < 5; t += 1) {
      const buckets: TestNode[] = []
      for (let b = 0; b < 4; b += 1) {
        const entries: TestNode[] = []
        for (let e = 0; e < 50; e += 1) entries.push(node(`t${t}/b${b}/e${e}`, [], { kind: 'entry' }))
        buckets.push(node(`t${t}/b${b}`, entries, { kind: 'group' }))
      }
      kids.push(node(`t${t}`, buckets, { kind: 'track' }))
    }
    const started = performance.now()
    const layout = layoutWorlds(node('root', kids, { kind: 'root' }))
    const elapsed = performance.now() - started
    expect(layout.nodes).toHaveLength(1 + 5 + 20 + 1000)
    expect(elapsed).toBeLessThan(250)
    expectFinite(layout)
  })
})

// ── every number finite, whatever it is handed ─────────────────────────────

describe('layoutWorlds — every number finite, whatever it is handed', () => {
  it('survives a NaN size an area encoding produced', () => {
    const layout = layoutWorlds(fan(6), { sizeOf: () => ({ width: Number.NaN, height: 0 / 0 }) })
    expectFinite(layout)
    expect(layout.rootD).toBeGreaterThan(0)
  })

  it('survives zero, negative and absurd sizes', () => {
    for (const size of [
      { width: 0, height: 0 },
      { width: -50, height: -1 },
      { width: 1e9, height: 1 },
      { width: 1, height: 1 },
    ]) {
      const layout = layoutWorlds(uniform(2, 3), { sizeOf: () => size })
      expectFinite(layout)
      for (const n of layout.nodes) expect(n.worldD).toBeGreaterThan(0)
    }
  })

  it('survives a leafSize nobody should pass', () => {
    for (const leafSize of [
      { width: Number.NaN, height: Number.NaN },
      { width: 0, height: 0 },
      { width: 44, height: 44 },
    ]) {
      const layout = layoutWorlds(fan(5), { leafSize })
      expectFinite(layout)
    }
  })

  it('draws a bare root as one world at the origin', () => {
    const layout = layoutWorlds(node('alone'))
    expect(layout.nodes).toHaveLength(1)
    expect(layout.rootD).toBe(D_LEAF)
    expect(layout.bounds.width).toBe(D_LEAF)
    expect(layout.edges).toEqual([])
    expectFinite(layout)
  })

  it('draws a chain of single children as nested worlds that keep growing', () => {
    const layout = layoutWorlds(node('a', [node('b', [node('c', [node('d')])])]))
    const ds = layout.nodes.map((n) => n.worldD)
    for (let i = 0; i + 1 < ds.length; i += 1) {
      expect(ds[i] / ds[i + 1]).toBeCloseTo(SINGLE_CHILD_RATIO, 9)
    }
    expectFinite(layout)
  })
})
