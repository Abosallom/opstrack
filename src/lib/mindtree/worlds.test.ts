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
//   · A PARENT YIELDS THE ROOM TO ITS CHILDREN — its card is inscribed in the
//     hole its children's ring leaves (HOLE_FRACTION), and the guarantee holds
//     at every fan-out the schema's depth cap can produce. Defect 6.
//   · A SPOKE LEAVES A CARD, NOT A HUB — the start is on the parent card's own
//     outline, along the bearing. Defect 15.
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
  HOLE_FRACTION,
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

  it('HOLE_FRACTION is the fifth, and it is smaller than the hole it names', () => {
    expect(HOLE_FRACTION).toBe(0.34)
    // The hole a six-child ring leaves, as a share of the parent's diameter,
    // computed from the packer rather than quoted: (2r − D) / parentD. This is
    // the 0.36 the constant was derived against, and 0.34 is inside it.
    const D = 200
    const six = packRing({ childD: new Array<number>(6).fill(D), gap: GAP_RATIO * D })
    expect((2 * six.radius - D) / six.parentD).toBeCloseTo(0.355, 3)
    expect(HOLE_FRACTION).toBeLessThan((2 * six.radius - D) / six.parentD)
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

// ── the hole a parent leaves its children ──────────────────────────────────

describe('layoutWorlds — a parent yields the room inside to its children', () => {
  /** The parent's card and its ring, for a root with `n` identical leaves. */
  function ring(n: number): {
    readonly parent: WorldNode<TestNode>
    readonly kids: readonly WorldNode<TestNode>[]
  } {
    const layout = layoutWorlds(fan(n))
    return { parent: layout.byId.get('root') as WorldNode<TestNode>, kids: childrenOf(layout, 'root') }
  }

  it('keeps a parent card inside the circle its children sit on, at EVERY fan-out 1..40', () => {
    // THE GUARANTEE THAT HOLDS EVERYWHERE, and the reason it is this one rather
    // than the stronger "clears every child world": below six children the
    // packing leaves no hole a legible card fits in, and at one child there is
    // no hole at all (SINGLE_CHILD_RATIO puts the lone world over the hub). See
    // the crossover test below, and HOLE_FRACTION's own note.
    for (let n = 1; n <= 40; n += 1) {
      const { parent, kids } = ring(n)
      const circum = Math.hypot(parent.width, parent.height) / 2
      for (const kid of kids) expect(circum).toBeLessThan(distance(parent, kid))
    }
  })

  it('is binding at ONE child, where it spends 80% of the room and no more', () => {
    // The margin, named where a future edit to HOLE_FRACTION will trip over it:
    // a lone child's centre sits 0.211·worldD out and the card's circumcircle
    // reaches 0.17·worldD, so 0.34 could not grow past ~0.42 without a parent's
    // own card reaching the ring its children are placed on.
    const { parent, kids } = ring(1)
    const circum = Math.hypot(parent.width, parent.height) / 2
    expect(circum / distance(parent, kids[0])).toBeCloseTo(0.804, 3)
    expect(circum / parent.worldD).toBeCloseTo(HOLE_FRACTION / 2, 12)
  })

  it('clears every child world outright from SIX children up, and not at five', () => {
    // WHERE THE CONSTANT COMES FROM, asserted from both sides so that moving it
    // in either direction reds this claim and sends the next reader back to the
    // arithmetic in HOLE_FRACTION's note. Six is the commonest fan-out on this
    // screen (worlds.ts's own header), and 0.34 is the hole six leaves. The
    // test uses the card's REAL support — the nearest point of an axis-aligned
    // rect to the child's centre — not its circumcircle, because a 168x44 card
    // is flat and the circumcircle would understate it by a third.
    const clears = (n: number): boolean => {
      const { parent, kids } = ring(n)
      const halfW = parent.width / 2
      const halfH = parent.height / 2
      return kids.every((kid) => {
        const dx = Math.max(0, Math.abs(kid.worldX - parent.worldX) - halfW)
        const dy = Math.max(0, Math.abs(kid.worldY - parent.worldY) - halfH)
        return Math.hypot(dx, dy) >= kid.worldD / 2
      })
    }
    for (let n = 6; n <= 40; n += 1) expect([n, clears(n)]).toEqual([n, true])
    for (let n = 1; n <= 5; n += 1) expect([n, clears(n)]).toEqual([n, false])
  })

  it('round-trips through cardScale to the card the author actually wrote', () => {
    // THE SEAM WITH THE RENDERER. A mark drawn inside `scale(cardScale)` is
    // authored in LEAF UNITS, so this division is the one MindNode performs in
    // reverse on every card at every depth: get it wrong and every glyph budget,
    // stroke width and 44px target in the drawing is off by the tier.
    for (const tree of [uniform(3, 4), workspace(), fan(24)]) {
      const layout = layoutWorlds(tree)
      for (const n of layout.nodes) {
        expect(n.width / n.cardScale).toBeCloseTo(168, 9)
        expect(n.height / n.cardScale).toBeCloseTo(44, 9)
      }
    }
    // …and with a size encoding it returns the AUTHORED card, not the leaf —
    // which is what makes `width / cardScale` safe to draw into unconditionally.
    const sized = layoutWorlds(uniform(2, 4), {
      sizeOf: (_n, depth) => (depth === 1 ? { width: 240, height: 60 } : undefined),
    })
    for (const n of sized.nodes) {
      if (n.depth !== 1) continue
      expect(n.width / n.cardScale).toBeCloseTo(240, 9)
      expect(n.height / n.cardScale).toBeCloseTo(60, 9)
    }
  })

  it('publishes exactly two world factors, and MindNode’s whole floor rests on it', () => {
    // THE SECOND SEAM WITH THE RENDERER, and it is the one wave 5 added. The
    // ink a mark puts on the glass is `authored x cardScale x scale`, so the
    // ratio `worldD / (D_LEAF x cardScale)` — `--mtree-world` — is what turns
    // that into `authored x apparent / D_LEAF`, ONE identity for every node in
    // every role, which is the line `lod.ts` cuts `BAND_EDGES.card = 157` on.
    //
    // The two rules in this file's header produce exactly two values for it and
    // NEITHER depends on depth or fan-out, which is the property that makes a
    // band edge a legibility guarantee rather than an average:
    //
    //   a leaf FILLS its world      -> 1               (or ownD / D_LEAF, once
    //                                                   an encoding grows it)
    //   a parent YIELDS to its ring -> leafDiag / (HOLE_FRACTION x D_LEAF)
    //                               =  173.666 / 68 = 2.5539
    const parentFactor = Math.hypot(168, 44) / (HOLE_FRACTION * D_LEAF)
    expect(parentFactor).toBeCloseTo(2.5539, 4)
    for (const tree of [uniform(3, 4), workspace(), fan(24)]) {
      for (const n of layoutWorlds(tree).nodes) {
        const factor = n.worldD / (D_LEAF * n.cardScale)
        expect([n.id, factor]).toEqual([
          n.id,
          expect.closeTo(n.childIds.length === 0 ? 1 : parentFactor, 9),
        ])
      }
    }
    // A card an encoding GREW keeps the identity too — its world grew with it,
    // so `ownD / D_LEAF` is the factor and `authored x apparent / D_LEAF` still
    // names the ink. This is the case that would silently break the floor if the
    // factor were hard-coded rather than derived.
    const sized = layoutWorlds(uniform(2, 4), {
      sizeOf: (_n, depth) => (depth === 2 ? { width: 252, height: 66 } : undefined),
    })
    for (const n of sized.nodes) {
      if (n.depth !== 2 || n.childIds.length > 0) continue
      expect(n.worldD / (D_LEAF * n.cardScale)).toBeCloseTo(1.5, 9)
    }
  })

  it('holds the hole even when an encoding authors a branch card at twice the leaf', () => {
    // The one word past the design's formula, earning its place: with a plain
    // `/ leafDiagonal` a branch card an encoding doubled would carry a
    // 0.68·worldD diagonal into a 0.36·worldD hole and put defect 6 back.
    const layout = layoutWorlds(uniform(2, 6), {
      sizeOf: (_n, depth) => (depth === 1 ? { width: 336, height: 88 } : undefined),
    })
    for (const n of layout.nodes) {
      if (n.childIds.length === 0) continue
      expect(Math.hypot(n.width, n.height) / n.worldD).toBeLessThanOrEqual(HOLE_FRACTION + EPS)
    }
  })

  it('leaves a LEAF filling its world, whatever its fan-out neighbours do', () => {
    // The other half of the two-rule header: nothing above changed a leaf.
    for (const n of [1, 2, 6, 24]) {
      const { kids } = ring(n)
      for (const kid of kids) {
        expect(kid.cardScale).toBe(1)
        expect(Math.hypot(kid.width, kid.height) / kid.worldD).toBeCloseTo(
          Math.hypot(168, 44) / D_LEAF,
          12,
        )
      }
    }
  })
})

// ── the spoke leaves a card ────────────────────────────────────────────────

describe('layoutWorlds — a spoke starts on the parent card, not at the parent hub', () => {
  it('anchors the start ON the card outline, along the bearing, in both directions', () => {
    // DEFECT 15. Asserted as two geometric facts rather than by restating the
    // support function here — a test that recomputes the formula it is checking
    // agrees with itself and with nothing else. On the ray: the cross product
    // with the bearing vanishes and the dot product is positive. On the
    // outline: exactly one axis is at its half-extent and neither is past it.
    for (const direction of ['ltr', 'rtl'] as const) {
      const layout = layoutWorlds(workspace(), { direction })
      expect(layout.edges.length).toBeGreaterThan(0)
      for (const edge of layout.edges) {
        const parent = layout.byId.get(edge.parentId) as WorldNode<TestNode>
        const child = layout.byId.get(edge.childId) as WorldNode<TestNode>
        const dx = edge.start.x - parent.worldX
        const dy = edge.start.y - parent.worldY
        const cos = Math.cos(child.bearing)
        const sin = Math.sin(child.bearing)
        expect(Math.abs(dx * sin - dy * cos)).toBeLessThan(1e-9)
        expect(dx * cos + dy * sin).toBeGreaterThan(0)
        const ratioX = Math.abs(dx) / (parent.width / 2)
        const ratioY = Math.abs(dy) / (parent.height / 2)
        expect(Math.max(ratioX, ratioY)).toBeCloseTo(1, 9)
        expect(Math.min(ratioX, ratioY)).toBeLessThanOrEqual(1 + EPS)
      }
    }
  })

  it('draws no ink under the card it left, and none backwards', () => {
    const layout = layoutWorlds(uniform(2, 6))
    for (const edge of layout.edges) {
      const parent = layout.byId.get(edge.parentId) as WorldNode<TestNode>
      const child = layout.byId.get(edge.childId) as WorldNode<TestNode>
      // no point of the curve's hull is strictly inside either card…
      for (const p of [edge.start, edge.c1, edge.c2, edge.end]) {
        const inParent =
          Math.abs(p.x - parent.worldX) < parent.width / 2 - EPS &&
          Math.abs(p.y - parent.worldY) < parent.height / 2 - EPS
        const inChild =
          Math.abs(p.x - child.worldX) < child.width / 2 - EPS &&
          Math.abs(p.y - child.worldY) < child.height / 2 - EPS
        expect(inParent || inChild).toBe(false)
      }
      // …and the controls sit BETWEEN the ends, so no spoke doubles back
      const cos = Math.cos(child.bearing)
      const sin = Math.sin(child.bearing)
      const along = (p: { x: number; y: number }): number =>
        (p.x - edge.start.x) * cos + (p.y - edge.start.y) * sin
      const span = along(edge.end)
      for (const p of [edge.c1, edge.c2]) {
        expect(along(p)).toBeGreaterThanOrEqual(-EPS)
        expect(along(p)).toBeLessThanOrEqual(span + EPS)
      }
    }
  })

  it('collapses to its own chord where the two cards already overlap', () => {
    // AT ONE CHILD THE SPAN GOES NEGATIVE, and that is the packing's doing, not
    // this anchor's: SINGLE_CHILD_RATIO puts the lone world's centre 0.46·D from
    // the hub with a radius of 0.5·D, so it covers the hub, and the parent's
    // card outline can sit farther out along the ray than the child's near edge.
    // The clamp is what keeps that case a straight segment — c1 ON start, c2 ON
    // end — instead of a connector that loops back out through the card it came
    // from. (The one-rule drawing had the same overlap and worse: the parent's
    // card was 894 units wide inside a 2,129-unit world and swallowed the child
    // whole.)
    const layout = layoutWorlds(node('a', [node('b', [node('c')])]))
    const first = layout.edges[0]
    expect(first.parentId).toBe('a')
    const child = layout.byId.get(first.childId) as WorldNode<TestNode>
    const cos = Math.cos(child.bearing)
    const sin = Math.sin(child.bearing)
    const span = (first.end.x - first.start.x) * cos + (first.end.y - first.start.y) * sin
    expect(span).toBeLessThan(0)
    expect(first.c1).toEqual(first.start)
    expect(first.c2).toEqual(first.end)
    expectFinite(layout)
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

  it('FRAMES A COHORT — the ring `?by=` draws is a place, not content', () => {
    // The whole argument for the kind existing. "The 96 organizations Sara
    // manages" is a ring of the workspace: the camera stops on it, the crumb
    // names it, and the dive goes through it to the organizations inside. A
    // `group` could not be given that without giving it to every status bucket
    // on the map — which is the sentence STRUCTURAL_KINDS is written against.
    const tree = node('root', [
      node('t', [
        node('t/sara', [node('t/sara/org1', [], { kind: 'entity' })], { kind: 'cohort' }),
        node('t/bucket', [], { kind: 'group' }),
      ], { kind: 'track' }),
    ], { kind: 'root' })
    const l = layoutWorlds(tree)
    expect(l.byId.get('t/sara')?.structural).toBe(true)
    expect(l.byId.get('t/bucket')?.structural).toBe(false)

    // And the camera really does stop there rather than naming the track.
    const cohort = l.byId.get('t/sara') as WorldNode<TestNode>
    const scale = (FRAME_FRACTION * 835) / cohort.worldD
    expect(worldAt(l, { cx: cohort.worldX, cy: cohort.worldY }, scale, 835)?.id).toBe('t/sara')
  })
})

// ── the size encoding, at the altitude that does not cost a word ───────────
//
// `sizeHintOf` multiplies a node's own WORLD and leaves its authored card box
// alone, which is the difference between this and `sizeOf`. Wave 5 measured what
// `sizeOf` costs — `MindNode` authors every mark in the units of a 168-wide leaf,
// so a box widened behind its back draws its label at 168/252 of the share it
// was authored at, and the phone's framed ring loses one organization's NAME in
// three — refused the wiring, and named this seam as the fix. The round-trip
// assertion below is the one that cannot survive `sizeOf` and is the whole point
// of the hint.

describe('sizeHintOf — the size encoding grows the WORLD, not the box', () => {
  const hinted = (hints: Readonly<Record<string, number>>, tree: TestNode = fan(6)) =>
    layoutWorlds(tree, { sizeHintOf: (n) => hints[n.id] })

  it('changes NOTHING when no caller asks, and nothing when one asks for nothing', () => {
    // The committed SVGs and every number this suite already pins depend on the
    // first. The second is `revision`'s own contract — it changes iff the
    // DRAWING changed — and an encoding with no opinion about any node draws
    // exactly what no encoding draws, so it must hash alike too.
    const plain = layoutWorlds(workspace())
    for (const noop of [() => undefined, () => 1]) {
      const l = layoutWorlds(workspace(), { sizeHintOf: noop })
      expect(l.revision).toBe(plain.revision)
      expect(everyNumber(l)).toEqual(everyNumber(plain))
    }
  })

  it('grows the hinted leaf\'s world by the factor, and its card WITH it', () => {
    const l = hinted({ k0: 1.5 })
    const big = l.byId.get('k0') as WorldNode<TestNode>
    const same = l.byId.get('k1') as WorldNode<TestNode>
    expect(big.worldD / same.worldD).toBeCloseTo(1.5, 9)
    expect(big.width / same.width).toBeCloseTo(1.5, 9)
    expect(big.height / same.height).toBeCloseTo(1.5, 9)
    expect(big.cardScale / same.cardScale).toBeCloseTo(1.5, 9)
  })

  it('KEEPS THE ROUND-TRIP `width / cardScale === leafSize.width`', () => {
    // THE ASSERTION `sizeOf` CANNOT PASS, and the reason this option exists. It
    // is `MindNode`'s contract: a mark drawn inside `scale(cardScale)` is
    // authored in LEAF units, so the 12.5-unit label is the same fraction of a
    // hinted card as of an unhinted one and nothing pays for the magnitude.
    const leaf: NodeSize = { width: 168, height: 44 }
    const l = layoutWorlds(fan(6), { leafSize: leaf, sizeHintOf: (n) => (n.id === 'k0' ? 1.5 : 1) })
    for (const n of l.nodes) {
      if (n.node.children?.length ?? 0) continue
      expect(n.width / n.cardScale).toBeCloseTo(leaf.width, 6)
      expect(n.height / n.cardScale).toBeCloseTo(leaf.height, 6)
    }
    // And `sizeOf` really does break it, which is why the two are different
    // mechanisms rather than two spellings of one.
    const viaSize = layoutWorlds(fan(6), {
      leafSize: leaf,
      sizeOf: (n) => (n.id === 'k0' ? { width: 252, height: 66 } : undefined),
    })
    const grown = viaSize.byId.get('k0') as WorldNode<TestNode>
    expect(grown.width / grown.cardScale).toBeCloseTo(252, 6)
  })

  it('keeps containment and disjointness at every hint', () => {
    for (const hint of [0.5, 1, 1.5, 3, 6]) {
      const l = hinted({ k0: hint, k3: 1 / hint }, uniform(3, 4))
      expectFinite(l)
      for (const parent of l.nodes) {
        for (const child of childrenOf(l, parent.id)) {
          // A child's whole world sits inside its parent's.
          expect(distance(parent, child) + child.worldD / 2).toBeLessThanOrEqual(
            parent.worldD / 2 + EPS,
          )
        }
        const kids = childrenOf(l, parent.id)
        for (let i = 0; i < kids.length; i += 1) {
          for (let k = i + 1; k < kids.length; k += 1) {
            expect(distance(kids[i], kids[k])).toBeGreaterThanOrEqual(
              (kids[i].worldD + kids[k].worldD) / 2 - EPS,
            )
          }
        }
      }
    }
  })

  it('mirrors exactly in Arabic, hints and all', () => {
    const hints = { 'p0/d0/org0': 1.5, 'p2/d5/org8': 3 }
    const ltr = layoutWorlds(workspace(), { sizeHintOf: (n) => hints[n.id as keyof typeof hints] })
    const rtl = layoutWorlds(workspace(), {
      direction: 'rtl',
      sizeHintOf: (n) => hints[n.id as keyof typeof hints],
    })
    expect(rtl.bounds).toEqual(ltr.bounds)
    expect(rtl.nodes[0].worldX).toBe(ltr.nodes[0].worldX) // the hub, byte-exact
    for (const n of ltr.nodes) {
      const m = rtl.byId.get(n.id) as WorldNode<TestNode>
      // The same one-ULP statement the mirror block above makes and for its
      // reason: `hubX + x` and `hubX - x` are two roundings of two exactly
      // negated offsets. A hint moves the drawing; it does not add a second
      // reflection, so the residue is the same size it always was.
      expect(Math.abs(n.worldX + m.worldX - ltr.bounds.width)).toBeLessThanOrEqual(
        Number.EPSILON * ltr.bounds.width,
      )
      expect(m.worldY).toBe(n.worldY)
      expect(m.worldD).toBe(n.worldD)
      expect(m.cardScale).toBe(n.cardScale)
    }
  })

  it('sanitises what an area encoding can actually hand it', () => {
    // `buildLayoutNodes`' bargain: a divide-by-zero in a count→area encoding
    // produces NaN, and a drawing that throws is worse than one that draws the
    // node at its floor.
    const plain = layoutWorlds(fan(6))
    for (const bad of [Number.NaN, 0, -2, Number.POSITIVE_INFINITY, undefined]) {
      const l = layoutWorlds(fan(6), { sizeHintOf: () => bad })
      expect(everyNumber(l)).toEqual(everyNumber(plain))
    }
    // And an absurd hint is capped rather than allowed to spend the whole
    // drawing on one node.
    const capped = hinted({ k0: 1e9 })
    const floor = layoutWorlds(fan(6))
    const ratio =
      (capped.byId.get('k0') as WorldNode<TestNode>).worldD /
      (floor.byId.get('k0') as WorldNode<TestNode>).worldD
    expect(ratio).toBeLessThanOrEqual(6 + EPS)
  })

  it('puts the hint in `revision`, because a hint is geometry', () => {
    // The camera reads `bounds` once per revision. A ring whose busiest sibling
    // changed count is a different drawing, and a revision that did not move
    // would leave the camera framed on the old one.
    expect(hinted({ k0: 1.5 }).revision).not.toBe(hinted({ k0: 1.25 }).revision)
    expect(hinted({ k0: 1.5 }).revision).toBe(hinted({ k0: 1.5 }).revision)
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

  it('authors every world card at its own scale, by the rule for its role', () => {
    // THE SAME SHARE OF ITS OWN WORLD AT EVERY DEPTH, still — but two shares,
    // one per role, and neither of them a function of depth. A leaf FILLS its
    // world; a parent YIELDS to the ring it encloses. That is what lets lod.ts
    // key one band table on `worldD` alone. This test used to assert the leaf
    // share for every node, which was the arithmetic form of defect 6.
    const layout = layoutWorlds(uniform(3, 4))
    const leafShare = 168 / D_LEAF
    const parentShare = (HOLE_FRACTION * 168) / Math.hypot(168, 44)
    for (const n of layout.nodes) {
      const isLeaf = n.childIds.length === 0
      expect(n.width / n.worldD).toBeCloseTo(isLeaf ? leafShare : parentShare, 12)
      expect(n.cardScale).toBeCloseTo(
        isLeaf ? n.worldD / D_LEAF : (HOLE_FRACTION * n.worldD) / Math.hypot(168, 44),
        9,
      )
    }
    // and the two shares are genuinely different: a parent's card is 39% of the
    // card the one-rule drawing gave it — the cost stated in the header.
    expect(parentShare / leafShare).toBeCloseTo(0.392, 3)
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
