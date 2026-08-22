// Proof for the level-of-detail selector, and for the claim that makes it the
// reference rather than a magnifier.
//
// TWO HALVES, and the second is the one that matters.
//
//  1. `bandFor` / `bandBlend` are pure arithmetic, so every property the design
//     leans on — totality, monotonicity, purity, where each edge sits, that no
//     fade is a resting state — is a plain assertion about a return value.
//  2. The bands must render DIFFERENT DRAWINGS, not the same drawing at
//     different sizes. That cannot be asserted about a number; it has to be
//     asserted about the marks. So this file renders MindNode once per band and
//     compares what came out.
//
// WHY THE RENDER TESTS ARE HERE AND NOT IN A MindNode.test.tsx: this unit owns
// `lod.ts`, `lod.test.ts` and `MindNode.tsx`, and the invariant under test is
// lod's, not the component's — "adjacent bands render different marks" is a
// statement about the ladder, and the component is the instrument that measures
// it. `createElement` rather than JSX keeps it a `.ts` file.
//
// WHY renderToStaticMarkup AND NOT A DOM: vitest.config.ts is `environment:
// 'node'` and jsdom is not in the dependency budget — NodeCard.test.tsx,
// MindtreeTable.test.tsx and pages/Board.test.tsx all open with that paragraph.
// Everything asserted below is in the markup.

import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  apparentOf,
  bandBlend,
  bandFloorPx,
  bandFor,
  BAND_BLEND,
  BAND_EDGES,
  DOM_HORIZON_PX,
  FLOOR,
  type Band,
} from './lod'
import { D_LEAF, HOLE_FRACTION } from './worlds'
import type { PositionedNode } from './layout'
import type { MindNode as MindNodeModel } from './model'

// The one store this component subscribes to, stubbed at the module boundary.
// MindNode reads exactly one boolean from it (`useMindIsSelected`), and standing
// up zustand + a localStorage shim to be told `false` would test the store
// rather than the drawing.
vi.mock('../../store/mindtree', () => ({ useMindIsSelected: () => false }))

const { MindNode } = await import('../../components/mindtree/MindNode')
type MindNodeProps = Parameters<typeof MindNode>[0]

const BANDS: readonly Band[] = ['absent', 'grain', 'state', 'chip', 'card', 'opening', 'frame']

/** A viewport where the whole ladder is reachable: 0.85 x 900 = 765 > 380. */
const V = 900

// ── the arithmetic ──────────────────────────────────────────────────────────

describe('apparentOf', () => {
  it('is worldD x scale', () => {
    expect(apparentOf(200, 1)).toBe(200)
    expect(apparentOf(538, 0.5)).toBe(269)
  })

  it('is total — no input produces NaN or a negative', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0]) {
      expect(apparentOf(bad, 1)).toBeGreaterThanOrEqual(0)
      expect(apparentOf(1, bad)).toBeGreaterThanOrEqual(0)
      expect(Number.isNaN(apparentOf(bad, bad))).toBe(false)
    }
  })
})

describe('bandFor', () => {
  it('puts every edge exactly where the contract says', () => {
    expect(bandFor(BAND_EDGES.grain - 0.001, V)).toBe('absent')
    expect(bandFor(BAND_EDGES.grain, V)).toBe('grain')
    expect(bandFor(BAND_EDGES.state - 0.001, V)).toBe('grain')
    expect(bandFor(BAND_EDGES.state, V)).toBe('state')
    expect(bandFor(BAND_EDGES.chip - 0.001, V)).toBe('state')
    expect(bandFor(BAND_EDGES.chip, V)).toBe('chip')
    expect(bandFor(BAND_EDGES.card - 0.001, V)).toBe('chip')
    expect(bandFor(BAND_EDGES.card, V)).toBe('card')
    expect(bandFor(BAND_EDGES.opening - 0.001, V)).toBe('card')
    expect(bandFor(BAND_EDGES.opening, V)).toBe('opening')
    expect(bandFor(BAND_EDGES.frame * V - 0.001, V)).toBe('opening')
    expect(bandFor(BAND_EDGES.frame * V, V)).toBe('frame')
  })

  it('is monotone in apparentPx on every viewport, including tiny ones', () => {
    // A viewport under 447px makes 0.85V smaller than the opening edge. If the
    // frame edge were taken literally there, the ladder would go BACKWARDS and a
    // continuous pinch would flicker between two drawings.
    for (const viewport of [0, 1, 320, 447, 587, 835, 4000]) {
      let last = -1
      for (let a = 0; a < 6000; a += 0.5) {
        const index = BANDS.indexOf(bandFor(a, viewport))
        expect(index).toBeGreaterThanOrEqual(last)
        last = index
      }
    }
  })

  it('is total, and never returns anything but a Band', () => {
    for (const a of [Number.NaN, -1, 0, Number.POSITIVE_INFINITY, 1e9]) {
      for (const v of [Number.NaN, -1, 0, 900, Number.POSITIVE_INFINITY]) {
        expect(BANDS).toContain(bandFor(a, v))
      }
    }
  })

  it('is a pure function of its two arguments', () => {
    const once = bandFor(300, V)
    for (let i = 0; i < 5; i += 1) expect(bandFor(300, V)).toBe(once)
  })

  it('is identical on a phone and on a desktop below the frame edge', () => {
    // Legibility is absolute: a CSS pixel is a CSS pixel, which is why the phone
    // is the same map through a smaller window and not a reduced one.
    for (let a = 0; a < BAND_EDGES.opening; a += 1) {
      expect(bandFor(a, 587)).toBe(bandFor(a, 835))
    }
  })
})

describe('bandBlend', () => {
  it('agrees with bandFor on the band, always', () => {
    for (let a = 0; a < 3000; a += 3) {
      expect(bandBlend(a, V).band).toBe(bandFor(a, V))
    }
  })

  it('rests at 0 through the body of a band and reaches 1 by its top', () => {
    expect(bandBlend(BAND_EDGES.card, V).out).toBe(0)
    expect(bandBlend(BAND_EDGES.card * 1.05, V).out).toBe(0)
    expect(bandBlend(BAND_EDGES.opening - 0.001, V).out).toBeGreaterThan(0.99)
  })

  it('never rests at a half value — every fade resolves inside 0.3 octaves', () => {
    // The property this asserts is the one WCAG 1.4.11 cares about: a mark in
    // motion is not a resting UI component, a permanently half-faded one is.
    // So for every band, the span over which `out` is strictly between 0 and 1
    // must be at most 0.3 octaves of apparent size.
    for (const viewport of [587, 900, 1600]) {
      const partial: number[] = []
      for (let a = 1; a < 4000; a += 0.25) {
        const { out } = bandBlend(a, viewport)
        if (out > 0 && out < 1) partial.push(a)
      }
      // Group the partial region per band and check each is short.
      const byBand = new Map<Band, number[]>()
      for (const a of partial) {
        const band = bandFor(a, viewport)
        const seen = byBand.get(band)
        if (seen === undefined) byBand.set(band, [a])
        else seen.push(a)
      }
      for (const [, values] of byBand) {
        const lo = Math.min(...values)
        const hi = Math.max(...values)
        expect(Math.log2(hi / lo)).toBeLessThanOrEqual(0.31)
      }
    }
  })

  it('fades the OPENING band from its bottom — the dissolve is the band', () => {
    // The card crosses out as its children's grain crosses in, and §4 puts the
    // crossing at ~450px. 380 x 2^0.3 = 468, so the dissolve is over before the
    // world is half a screen wide.
    expect(bandBlend(BAND_EDGES.opening, V).out).toBe(0)
    expect(bandBlend(420, V).out).toBeGreaterThan(0)
    expect(bandBlend(420, V).out).toBeLessThan(1)
    expect(bandBlend(500, V).out).toBe(1)
  })

  it('fades the FRAME band only once the rim is 1.6x the viewport', () => {
    expect(bandBlend(BAND_EDGES.frame * V, V).out).toBe(0)
    expect(bandBlend(1.5 * V, V).out).toBe(0)
    expect(bandBlend(1.7 * V, V).out).toBeGreaterThan(0)
    expect(bandBlend(2.2 * V, V).out).toBe(1)
  })

  it('is monotone in apparentPx within a band', () => {
    let last = -1
    for (let a = BAND_EDGES.card; a < BAND_EDGES.opening; a += 0.5) {
      const { out } = bandBlend(a, V)
      expect(out).toBeGreaterThanOrEqual(last)
      last = out
    }
  })

  it('is total', () => {
    for (const a of [Number.NaN, -1, 0, Number.POSITIVE_INFINITY]) {
      for (const v of [Number.NaN, 0, 900]) {
        const { out } = bandBlend(a, v)
        expect(Number.isFinite(out)).toBe(true)
        expect(out).toBeGreaterThanOrEqual(0)
        expect(out).toBeLessThanOrEqual(1)
      }
    }
  })

  it('keeps the published constants', () => {
    expect(BAND_EDGES).toEqual({ grain: 7, state: 26, chip: 52, card: 157, opening: 380, frame: 0.85 })
    expect(BAND_BLEND).toBe(0.18)
    expect(DOM_HORIZON_PX).toBe(4)
    expect(FLOOR).toEqual({ TEXT_PX: 9, STROKE_PX: 0.75 })
  })
})

describe('the floor, and the edge it cut', () => {
  /**
   * `authored x apparent / D_LEAF` — the ink a card puts on the glass once
   * MindNode authors its type in WORLD units. The whole of this wave's decision
   * is that this expression, evaluated at a band's own bottom edge, must clear
   * `FLOOR` for every mark the band draws.
   */
  const ink = (authored: number, apparent: number): number => (authored * apparent) / D_LEAF

  it('cuts the card edge on the SMALLEST type the card carries, not the label', () => {
    // mindtree.css authors the label at 12.5 and the count at 11.5, and the
    // count is what binds: 9 x 200 / 11.5 = 156.52, against 9 x 200 / 12.5 = 144
    // for the label alone. An edge cut on the label would have shipped a count
    // at 8.28 px.
    expect((FLOOR.TEXT_PX * D_LEAF) / 11.5).toBeCloseTo(156.52, 2)
    expect(BAND_EDGES.card).toBe(Math.ceil((FLOOR.TEXT_PX * D_LEAF) / 11.5))
    expect(ink(11.5, 144)).toBeLessThan(FLOOR.TEXT_PX)
  })

  it('pays for every mark a card draws, at the card band’s own floor', () => {
    const floor = bandFloorPx('card')
    expect(ink(12.5, floor)).toBeGreaterThanOrEqual(FLOOR.TEXT_PX) //  label 9.81
    expect(ink(11.5, floor)).toBeGreaterThanOrEqual(FLOOR.TEXT_PX) //  count 9.03
    expect(ink(1, floor)).toBeGreaterThanOrEqual(FLOOR.STROKE_PX) //   box   0.785
    expect(ink(2, floor)).toBeGreaterThanOrEqual(FLOOR.STROKE_PX) //   dash  1.57
  })

  it('would have failed at the edge it replaced — the assertion is not vacuous', () => {
    expect(ink(12.5, 140)).toBeCloseTo(8.75, 9)
    expect(ink(11.5, 140)).toBeCloseTo(8.05, 9)
    expect(ink(1, 140)).toBeCloseTo(0.7, 9)
    expect(ink(12.5, 140)).toBeLessThan(FLOOR.TEXT_PX)
    expect(ink(1, 140)).toBeLessThan(FLOOR.STROKE_PX)
  })

  it('cannot pay for a word at the CHIP band’s own floor, which is the test', () => {
    // A BAND IS JUDGED AT ITS FLOOR, not at its top, and that is the rule this
    // whole wave turns on: a band that draws a mark promises it everywhere in
    // the band, so the promise is only honest if the SMALLEST world in the band
    // can pay for it. A chip at its floor pays 3.25 px for a name and 2.99 px
    // for a count. (Near its top it could pay 9.81 — which is exactly why the
    // decision has to be taken at the floor, or the same mark is legible at one
    // end of a band and a smudge at the other.)
    expect(ink(12.5, BAND_EDGES.chip)).toBeCloseTo(3.25, 9)
    expect(ink(11.5, BAND_EDGES.chip)).toBeCloseTo(2.99, 2)
    expect(ink(12.5, bandFloorPx('chip'))).toBeLessThan(FLOOR.TEXT_PX)
    expect(ink(11.5, bandFloorPx('chip'))).toBeLessThan(FLOOR.TEXT_PX)
  })

  it('states the same floor for a card inscribed in its children’s ring', () => {
    // The identity MindNode's `--mtree-world` buys: a HOLE_FRACTION parent draws
    // at `0.34 x worldD / leafDiag`, which without the world factor is
    // `12.5 x apparent / 510.8` — 3.84 px at the card edge, and NO edge under
    // the 185.8 px ceiling the opening picture imposes could have lifted it.
    const leafDiag = Math.hypot(168, 44)
    const parentCardScalePerWorld = HOLE_FRACTION / leafDiag
    expect(1 / parentCardScalePerWorld).toBeCloseTo(510.78, 2)
    expect(12.5 * parentCardScalePerWorld * BAND_EDGES.card).toBeCloseTo(3.84, 2)
    // …and with it, the parent's ink is a leaf's ink, exactly.
    const worldFactor = leafDiag / (HOLE_FRACTION * D_LEAF)
    expect(worldFactor).toBeCloseTo(2.5539, 4)
    expect(12.5 * worldFactor * parentCardScalePerWorld * BAND_EDGES.card).toBeCloseTo(
      ink(12.5, BAND_EDGES.card),
      9,
    )
  })
})

describe('bandFloorPx', () => {
  it('returns the edge bandFor cuts at, for every band', () => {
    for (const band of BANDS) {
      const floor = bandFloorPx(band, V)
      expect([band, bandFor(floor, V)]).toEqual([band, band])
      if (band !== 'absent') expect([band, bandFor(floor - 0.001, V)]).not.toEqual([band, band])
    }
  })

  it('answers a caller with no window with the frame band’s LOWER bound', () => {
    // A component inside the drawing has no viewport. 380 is `frame`'s floor on
    // every viewport (lod floors the frame edge at `opening`), so the answer is
    // sound rather than wrong — MindNode gates a glyph on it.
    expect(bandFloorPx('frame')).toBe(BAND_EDGES.opening)
    expect(bandFloorPx('frame', 900)).toBe(0.85 * 900)
    expect(bandFloorPx('frame', 100)).toBe(BAND_EDGES.opening)
  })
})

// ── the five drawings ───────────────────────────────────────────────────────

function health(breached: boolean): MindNodeModel['health'] {
  return { levels: { ok: 1, stale: 0, overdue: 0, critical: 0 }, slaBreached: breached }
}

function model(overrides: Partial<MindNodeModel> = {}): MindNodeModel {
  return {
    id: 'root/track:t1',
    kind: 'entity',
    label: { kind: 'text', text: 'Onboarding' },
    count: 12,
    colourVars: { '--track-c-dark': '#6b7280' } as MindNodeModel['colourVars'],
    health: health(true),
    children: [],
    collapsed: false,
    depth: 1,
    entryId: null,
    bucketKey: 'node-1',
    entityType: 'Department',
    retired: false,
    ...overrides,
  }
}

/**
 * A card that FILLS ITS OWN WORLD — `worldD = D_LEAF x cardScale` — which is the
 * leaf rule in `worlds.ts` and the case where `--mtree-world` is exactly 1, so
 * every assertion below is about the drawing and not about the world factor.
 * `yielded()` is the other rule.
 *
 * `worldD` IS 200 AND NOT AN ARBITRARY NUMBER. It used to be 538 beside an
 * absent `cardScale`, a pair `layoutWorlds` cannot produce: a 538-unit world
 * around a card drawn at 1x is a card at 0.37 of its own world, which is neither
 * of the two rules. Wave 5 reads that ratio, so the fixture has to state it.
 */
function positioned(node: MindNodeModel, hasChildren: boolean): PositionedNode<MindNodeModel> & {
  readonly worldX: number
  readonly worldY: number
  readonly worldD: number
  readonly cardScale: number
} {
  return {
    id: node.id,
    node,
    depth: 1,
    x: 100,
    y: 200,
    width: 168,
    height: 44,
    parentId: 'root',
    childIds: hasChildren ? ['a', 'b'] : [],
    index: 0,
    siblingCount: 4,
    hasChildren,
    hasHiddenChildren: false,
    hiddenChildCount: 0,
    collapsed: false,
    outward: { x: 186, y: 22 },
    worldX: 184,
    worldY: 222,
    worldD: D_LEAF,
    cardScale: 1,
  }
}

/**
 * A card INSCRIBED IN ITS CHILDREN'S RING — `worlds.ts`'s second rule,
 * `cardScale = HOLE_FRACTION x worldD / leafDiag`. Its card is 168 x 44 LEAF
 * units and 65.8 x 17.2 WORLD units, which is the whole of why it draws the
 * chip's picture: 65.8 is under `LABEL_INSIDE_MIN = 96`.
 */
function yielded(node: MindNodeModel, worldD = 1000): ReturnType<typeof positioned> {
  const cardScale = (HOLE_FRACTION * worldD) / Math.hypot(168, 44)
  const base = positioned(node, true)
  return {
    ...base,
    width: 168 * cardScale,
    height: 44 * cardScale,
    outward: { x: 186 * cardScale, y: 22 * cardScale },
    worldD,
    cardScale,
  }
}

function props(band: Band, over: Partial<MindNodeProps> = {}): MindNodeProps {
  const node = model()
  return {
    pos: positioned(node, true),
    view: {
      label: 'Onboarding',
      name: 'Onboarding, 12 open, 6 of 9 live',
      count: '12',
      toggleHint: 'Collapse',
      breachHint: 'Past deadline',
      progress: { done: 6, total: 9 },
      secondary: 'Sara Q · Vendor A',
    },
    rtl: false,
    focused: false,
    current: false,
    onActivate: () => {},
    onFocus: () => {},
    registerRef: () => {},
    onPointerDown: () => {},
    onHover: () => {},
    onMenu: () => {},
    band,
    bandOut: 0,
    ...over,
  }
}

function render(p: MindNodeProps): string {
  return renderToStaticMarkup(createElement(MindNode, p) as ReactElement)
}

/** Every SVG element type in the markup, with its multiplicity. */
function elements(markup: string): string {
  const tags = [...markup.matchAll(/<([a-z]+)/g)].map((m) => m[1])
  const counts = new Map<string, number>()
  for (const tag of tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  return [...counts.entries()].sort().map(([tag, n]) => `${tag}x${n}`).join(' ')
}

/** Every class the drawing paints — the codebase's own name for a mark. */
function marks(markup: string): string {
  return [...markup.matchAll(/class="([^"]+)"/g)]
    .map((m) => m[1])
    .sort()
    .join(' | ')
}

describe('the five renderings', () => {
  it('draws a different SET OF MARKS at every band', () => {
    const drawn = new Map<Band, string>()
    for (const band of BANDS) drawn.set(band, marks(render(props(band))))
    const seen = new Set<string>()
    for (const [, value] of drawn) {
      expect(seen.has(value)).toBe(false)
      seen.add(value)
    }
  })

  it('changes the KIND of ink between every adjacent pair, not just its extent', () => {
    // The invariant, stated as the contract states it: no band renders a node
    // the way the band below rendered it. Element TYPES and their multiplicity,
    // so "a smudge" and "a ringed dot" are different answers even though both
    // are circles.
    for (let i = 1; i < BANDS.length; i += 1) {
      const below = elements(render(props(BANDS[i - 1] as Band)))
      const here = elements(render(props(BANDS[i] as Band)))
      expect(here).not.toBe(below)
    }
  })

  it('draws NO TEXT at grain, state or chip', () => {
    // A numeral inside a 30px disc renders at 3px and is a lie about legibility;
    // wave 5 found the same sentence true one band up, where a chip's count is
    // 2.99 px and its name 3.25 px at the band's own floor.
    expect(render(props('grain'))).not.toContain('<text')
    expect(render(props('state'))).not.toContain('<text')
    expect(render(props('chip'))).not.toContain('<text')
  })

  it('keeps grain and state out of the role="tree" DOM entirely', () => {
    for (const band of ['grain', 'state'] as const) {
      const markup = render(props(band))
      expect(markup).not.toContain('role="treeitem"')
      expect(markup).not.toContain('tabindex')
      expect(markup).toContain('aria-hidden="true"')
    }
  })

  it('renders one mark per node at grain — a band, never a sample', () => {
    // model.ts's standing rule: a branch labelled 12 showing 3 is the worst
    // thing this map can do.
    expect(elements(render(props('grain')))).toBe('circlex1 gx1')
  })

  it('draws nothing at all at frame', () => {
    expect(render(props('frame'))).toBe('')
  })

  it('leaves the DOM once the opening dissolve has resolved', () => {
    expect(render(props('opening', { bandOut: 0.5 }))).not.toBe('')
    expect(render(props('opening', { bandOut: 1 }))).toBe('')
  })

  it('never draws text while its layer is fading', () => {
    // The rendering invariant: only NON-TEXT ink dissolves. A name hands off at
    // a band edge, instantly, so it is never on screen at a ratio nobody
    // measured.
    const markup = render(props('opening', { bandOut: 0.4 }))
    expect(markup).toContain('opacity:0.6')
    expect(markup).not.toContain('<text')
  })

  it('keeps a node in the DOM but invisible one band below the eye', () => {
    const markup = render(props('absent'))
    expect(markup).toContain('role="treeitem"')
    expect(markup).toContain('mring-absent')
    expect(markup).not.toContain('<text')
  })

  it('holds an ORGANIZATION card past 380px instead of dissolving it', () => {
    const leaf = props('opening', { pos: positioned(model(), false) })
    const markup = render(leaf)
    expect(markup).toContain('mring-secondary')
    expect(markup).toContain('Sara Q')
    // It is the only place on the canvas with a third text row.
    expect([...markup.matchAll(/<text/g)]).toHaveLength(3)
  })

  it('gives no second line to a department, at any band', () => {
    for (const band of BANDS) {
      expect(render(props(band))).not.toContain('mring-secondary')
    }
  })
})

describe('the chip has lost its words', () => {
  /**
   * WAVE 5. The chip used to be "the 44x44 box, count centred inside, name
   * outside along the ray", and every one of those three promises was made in
   * CSS PIXELS while the marks were drawn in card units: at the band's own floor
   * the box is 44 x 11 px, the count is 3.0 px and the name is 3.25 px. So the
   * band keeps the one thing it can deliver — a shape you can tap — and the
   * words move up to `card`, whose edge was cut to pay for them.
   */
  it('draws a box and nothing else', () => {
    const markup = render(props('chip'))
    expect(markup).not.toContain('<text')
    expect(marks(markup)).toBe('mtree-node | mtree-node-box')
  })

  it('is still a control, and still the same box', () => {
    // It is the ONLY difference from `absent`, which is the same two elements
    // with `visibility: hidden` on them: a chip takes a tap and a pointer, and
    // is in the role="tree" walk.
    const markup = render(props('chip'))
    expect(markup).toContain('role="treeitem"')
    expect(markup).toContain('<rect')
    expect(markup).not.toContain('mring-absent')
  })
})

describe('a card that yields to its ring', () => {
  it('draws the chip’s picture — name outside, count in the middle', () => {
    const markup = render(props('card', { pos: yielded(model()) }))
    expect(markup).toContain('text-anchor="middle"')
    expect(markup).toContain('pointer-events="none"')
  })

  it('publishes the world factor and the hair floor for the sheet to read', () => {
    const markup = render(props('card', { pos: yielded(model()) }))
    // 173.666 / (0.34 x 200) = 2.5539. Every font size and every stroke width in
    // mindtree.css is multiplied by one of these two.
    expect(markup).toMatch(/--mtree-world:2\.553[0-9]*/)
    // At `card` the hair floor is already met (0.75 x 200 / 157 = 0.955 < 1), so
    // the stroke factor IS the world factor.
    expect(markup).toMatch(/--mtree-hair:2\.553[0-9]*/)
  })

  it('raises the hair at CHIP, where the outline is the whole mark', () => {
    const markup = render(props('chip', { pos: yielded(model()) }))
    // 0.75 x 200 / 52 = 2.8846 times the world factor: 2.5539 x 2.8846 = 7.367
    // leaf units, which is exactly 0.75 CSS px at the band's bottom edge.
    const hair = Number(/--mtree-hair:([\d.]+)/.exec(markup)?.[1] ?? Number.NaN)
    expect(hair).toBeCloseTo(7.367, 3)
    const cardScale = (HOLE_FRACTION * 1000) / Math.hypot(168, 44)
    expect((hair * cardScale * BAND_EDGES.chip) / 1000).toBeCloseTo(FLOOR.STROKE_PX, 9)
  })

  it('leaves a leaf that fills its world at exactly 1, both factors', () => {
    const markup = render(props('card'))
    expect(markup).toContain('--mtree-world:1')
    expect(markup).toContain('--mtree-hair:1')
  })

  it('spends its ray on the word rather than on a chevron', () => {
    expect(render(props('card', { pos: yielded(model()) }))).not.toContain('mtree-chevron')
  })

  it('anchors the outside label correctly in all four side x direction cases', () => {
    const anchorOf = (markup: string): string =>
      /class="mtree-node-label"[^>]*text-anchor="(start|end)"/.exec(markup)?.[1] ?? ''
    const at = (outwardX: number, rtl: boolean): string => {
      const base = props('card', { pos: yielded(model()) })
      return anchorOf(
        render({
          ...base,
          rtl,
          pos: { ...base.pos, outward: { x: outwardX, y: 22 } },
        }),
      )
    }
    // The four-case table from MindNode's own comment. A bare geometric test
    // comes out inverted in Arabic, because text-anchor start|end are LOGICAL
    // keywords resolved against the group's direction.
    expect(at(260, false)).toBe('start') // ltr, right of the hub
    expect(at(-40, false)).toBe('end') //   ltr, left of the hub
    expect(at(260, true)).toBe('end') //    rtl, right of the hub
    expect(at(-40, true)).toBe('start') //  rtl, left of the hub
  })

  it('keeps the chevron on a card that holds its own name', () => {
    expect(render(props('card'))).toContain('mtree-chevron')
  })
})

describe('a glyph its card cannot pay for is not drawn', () => {
  /** A branch whose children are folded away — the only source of a "+N". */
  function folded(worlds: boolean): MindNodeProps {
    const base = props('card')
    const pos = { ...base.pos, childIds: [], hasChildren: true, hiddenChildCount: 3 }
    return { ...base, pos: worlds ? pos : { ...pos, worldD: undefined, cardScale: undefined } }
  }

  it('drops the chevron’s "+N" on the canvas — 9.5 units is 7.46 px at the floor', () => {
    // `.mtree-chevron-count` is the one type on this card smaller than the count
    // the card edge was cut on, so it is the one glyph the gate actually turns
    // away: `9.5 x 157 / 200 = 7.46`, under `FLOOR.TEXT_PX`. (It is unreachable
    // through `layoutWorlds`, which passes `expandAll: true` and no depth limit,
    // so nothing on screen loses a mark today — this is the guard that keeps the
    // floor true when wave 6's folds start producing one.)
    expect((9.5 * BAND_EDGES.card) / D_LEAF).toBeCloseTo(7.46, 2)
    const markup = render(folded(true))
    expect(markup).toContain('mtree-chevron')
    expect(markup).not.toContain('mtree-chevron-count')
  })

  it('keeps it on a layout that has no worlds, where there is no camera to ask', () => {
    // The tidy tree and the phone's ring are fitted to a viewBox by their page,
    // so the apparent-size relationship this arithmetic rests on does not exist
    // and the honest answer is to draw what was authored. Unchanged by wave 5.
    expect(render(folded(false))).toContain('mtree-chevron-count')
  })
})

describe('the progress underscore', () => {
  const xOf = (markup: string): number =>
    Number(/class="mring-progress" x="([-\d.]+)"/.exec(markup)?.[1] ?? Number.NaN)
  const widthOf = (markup: string): number =>
    Number(/class="mring-progress"[^>]*width="([\d.]+)"/.exec(markup)?.[1] ?? Number.NaN)

  const railWidthOf = (markup: string): number =>
    Number(/class="mring-rail"[^>]*width="([\d.]+)"/.exec(markup)?.[1] ?? Number.NaN)

  it('encodes the live share as LENGTH, against a rail that draws the whole', () => {
    const markup = render(props('card'))
    // 6 of 9, in a 168-wide box inset 12 both sides: (168-24) x 2/3 = 96.
    expect(widthOf(markup)).toBeCloseTo(96, 6)
    // And the whole it is two-thirds OF is on the page: the rail spans the same
    // 144-unit budget, so "full" is a length the reader can see rather than one
    // they have to assume. Three rects — the box, the rail, the bar.
    expect(railWidthOf(markup)).toBeCloseTo(144, 6)
    expect([...markup.matchAll(/<rect/g)]).toHaveLength(3)
  })

  it('draws a bare rail for a card that is 0 of N, which used to draw nothing', () => {
    // THE READING THE RAIL WAS ADDED FOR. Before it, this card and a card with
    // no progress pair at all emitted byte-identical markup, and "nothing is
    // live on this account" is the single most important thing a leaf card can
    // say. It is now a full-length rail with no bar standing on it.
    const base = props('card')
    const markup = render({
      ...base,
      view: { ...base.view, progress: { done: 0, total: 9 } },
    })
    expect(railWidthOf(markup)).toBeCloseTo(144, 6)
    expect(markup).not.toContain('mring-progress')
  })

  const railGeom = (markup: string): { y: number; h: number } => {
    const m = /class="mring-rail" x="[\d.-]+" y="([\d.-]+)"[^>]*height="([\d.]+)"/.exec(markup)
    return { y: Number(m?.[1]), h: Number(m?.[2]) }
  }
  const barGeom = (markup: string): { y: number; h: number } => {
    const m = /class="mring-progress" x="[\d.-]+" y="([\d.-]+)"[^>]*height="([\d.]+)"/.exec(markup)
    return { y: Number(m?.[1]), h: Number(m?.[2]) }
  }

  it('spends no contrast on the rail — it is the bar’s own ink at a third its height', () => {
    // The rail is told apart from the bar by HEIGHT and by nothing else: no
    // opacity, no second colour, no diluted ink. Both rules resolve
    // `--mtree-ink` in mind-ring.css, so what this file can check is the
    // geometry that carries the distinction — and that the two share a bottom
    // edge, which is what keeps a sub-unit rail off a half-pixel row.
    const markup = render(props('card'))
    const rail = railGeom(markup)
    const bar = barGeom(markup)
    expect(rail.h).toBeCloseTo(bar.h / 3, 6)
    expect(rail.y + rail.h).toBeCloseTo(bar.y + bar.h, 6)
    // No opacity on either mark, in the markup or anywhere it could be set.
    expect(markup).not.toMatch(/class="mring-(rail|progress)"[^>]*opacity/)
  })

  it('keeps two units of height between a near-full bar and a bare rail', () => {
    // THE ONE THING SEPARATING TWO OPPOSITE READINGS. A card at 0-of-N draws a
    // line across the whole budget; a card at 142.9-of-144 draws a line across
    // the whole budget. LENGTH cannot tell them apart at that end of the scale
    // and the count cannot either, because the count is the total and not the
    // live figure — so the entire discriminator is the bar's extra height, and
    // this asserts it is worth more than one device pixel at 1:1. Eleven of the
    // 153 cards in the shoot are past 92% full, so this is an ordinary row of
    // healthy accounts, not a corner case.
    const base = props('card')
    const nearFull = render({
      ...base,
      view: { ...base.view, progress: { done: 143, total: 144 } },
    })
    const none = render({
      ...base,
      view: { ...base.view, progress: { done: 0, total: 144 } },
    })
    // Both draw a rail of the same full budget: length says nothing here.
    expect(railWidthOf(nearFull)).toBeCloseTo(railWidthOf(none), 6)
    expect(widthOf(nearFull)).toBeGreaterThan(0.99 * railWidthOf(nearFull))
    expect(none).not.toContain('mring-progress')
    // And the height step that is left carries the whole distinction.
    expect(barGeom(nearFull).h - railGeom(nearFull).h).toBeGreaterThanOrEqual(2)
  })

  it('grows from the reading start, mirrored', () => {
    const ltr = render(props('card'))
    const rtl = render(props('card', { rtl: true }))
    expect(xOf(ltr)).toBe(12)
    // rtl: width - PAD - fillW = 168 - 12 - 96
    expect(xOf(rtl)).toBe(60)
    // And the two are exact mirrors of each other about the box's centre.
    expect(xOf(ltr) + widthOf(ltr)).toBe(168 - xOf(rtl))
  })

  it('is absent when there is nothing to say — rail included', () => {
    // `progress: null` is "we hold no figure for this node", which is now a
    // DIFFERENT card from "the figure is zero" above. Both marks have to go, or
    // the distinction the rail was added to draw is undrawn again.
    const none = props('card')
    const markup = render({ ...none, view: { ...none.view, progress: null } })
    expect(markup).not.toContain('mring-progress')
    expect(markup).not.toContain('mring-rail')
  })
})

describe('the breach mark’s corner', () => {
  const dotOf = (markup: string): { cx: number; cy: number; r: number } => {
    const m = /class="mtree-breach"[\s\S]*?<circle cx="([\d.-]+)" cy="([\d.-]+)" r="([\d.]+)"/.exec(
      markup,
    )
    return { cx: Number(m?.[1]), cy: Number(m?.[2]), r: Number(m?.[3]) }
  }

  it('leaves the count enough air to read as a card mark, not a flag on the numeral', () => {
    // THE DOT AND THE COUNT ARE ONE COLUMN. Both sit at the reading end of the
    // card — the dot in the block-start corner, the count centred on the card's
    // own middle — so on a breached card they stack, and if the joint between
    // them closes the pair reads as a single mark: a FLAGGED NUMBER, as though
    // the breach qualified the open count, rather than "there is a breach in
    // here". The worst case is the root's three-digit numeral, which is the
    // widest thing that ever sits under this dot.
    //
    // The ascender is computed the way a typographer measures it rather than
    // asserted as a magic number: the count is an 11.5px face centred on the
    // card's middle (`dominantBaseline="central"`), and a cap height of ~0.72em
    // puts its top half of that above the centre line.
    const markup = render(props('card'))
    const dot = dotOf(markup)
    const countCentre = 44 / 2
    const countAscender = countCentre - (11.5 * 0.72) / 2
    expect(countAscender - (dot.cy + dot.r)).toBeGreaterThanOrEqual(6)
  })

  it('stays inside the card’s rounded corner while it does it', () => {
    // The air above is bought by moving the dot toward the corner, and the
    // corner is an arc: `rx={10}` centres it on (width-10, 10). If the dot's far
    // point passes that radius the mark hangs off the card, which is a worse
    // fault than the one the move fixed. Checked rather than eyeballed.
    const markup = render(props('card'))
    const dot = dotOf(markup)
    const corner = { x: 168 - 10, y: 10 }
    expect(Math.hypot(dot.cx - corner.x, dot.cy - corner.y) + dot.r).toBeLessThanOrEqual(10)
    // And it clears the card's own block-start edge, keyline included (1.5).
    expect(dot.cy - dot.r - 1.5).toBeGreaterThan(0)
  })

  it('rides the READING end, so the block-start band’s other corner stays free', () => {
    // The obvious alternative fix for the joint above — move the breach to the
    // opposite corner — is not available, and this is what says so in code. The
    // dot mirrors with the script, which means it is always in the corner the
    // reader ends a line at, and the corner it is NOT in is `tickX`, which the
    // selection tick owns so that a ticked AND breached item shows both marks.
    // The block axis has no mirror, so `cy` is the same number in both scripts.
    const ltr = dotOf(render(props('card')))
    const rtl = dotOf(render(props('card', { rtl: true })))
    expect(ltr.cx).toBe(168 - 12)
    expect(rtl.cx).toBe(12)
    expect(rtl.cy).toBe(ltr.cy)
  })
})

describe('colour', () => {
  it('lets a hue in only through the --track-c-* pair', () => {
    for (const band of ['grain', 'state', 'chip', 'card'] as const) {
      const markup = render(props(band))
      expect(markup).toContain('--track-c-dark')
      // No literal colour anywhere in the drawing: every mark resolves its ink
      // through mindtree.css / mind-ring.css against that pair.
      expect(markup).not.toMatch(/(fill|stroke)="#/)
    }
  })
})

/* ══════════════ the tidy tree's card — two rows, and whose number ══════════ */

/**
 * THE TWO DEFECTS THIS BLOCK STANDS GUARD OVER, both found by driving the live
 * site rather than by reading a diff, and both about the same 168 x 54 box.
 *
 *   1. EVERY BRANCH WAS DRAWN "Associate …". The card's glyph budget is
 *      `(width - PAD*2 - COUNT_SLOT) / CHAR_PX` and the app was authoring 132,
 *      which is eleven glyphs — so four differently-named directorates rendered
 *      as four identical cards.
 *   2. EVERY BRANCH READ "0". `count` is the OPEN WORK beneath a node, and a
 *      workspace of eighty-five organizations with nine open items therefore
 *      drew a zero on every card that held a hospital.
 *
 * Rendered rather than reasoned about: `MindNode` is the only file that can turn
 * a view model into rows of text, and the wrap and the numeral choice are both
 * decisions it makes alone. `flat` is passed because both are the flat tree's —
 * the containment drawing answers "the name does not fit" by hanging it outside
 * the box, and the two answers may not both be live on one card.
 */
describe('the flat card holds a real name and a useful number', () => {
  /** Every `.mtree-node-label` row, in document order. */
  function labelRows(markup: string): readonly string[] {
    return [...markup.matchAll(/<text class="mtree-node-label"[^>]*>([^<]*)<\/text>/g)].map(
      (m) => m[1] as string,
    )
  }

  /** The numeral in the count slot, and the baseline it sits on. */
  function numeral(markup: string): { readonly text: string; readonly y: number } {
    const m = markup.match(/<text class="mtree-node-count tabular"[^>]*y="([-\d.]+)"[^>]*>([^<]*)</)
    if (m === null) throw new Error('no count drawn')
    return { text: m[2] as string, y: Number(m[1]) }
  }

  const LONG = 'Associate Directorate Alpha'

  it('wraps a name too long for one row instead of eliding it', () => {
    const markup = render(
      props('card', { flat: true, view: { ...props('card').view, label: LONG } }),
    )
    // 27 glyphs over two rows, whole: seventeen fit on the first (168 - 24 - 34
    // over 6.2), the rest on the second, which pays no count slot.
    expect(labelRows(markup)).toEqual(['⁨Associate⁩', '⁨Directorate Alpha⁩'])
    expect(markup, 'nothing is elided').not.toContain('…')
  })

  it('breaks at a space, and mid-word only when there is no space to break at', () => {
    const view = props('card').view
    const solid = 'Riyadh-First-Health-Cluster-Node'
    const rows = labelRows(
      render(props('card', { flat: true, view: { ...view, label: solid } })),
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]).toBe(`⁨${solid.slice(0, 17)}⁩`)
    // The tail still elides against the second row's own budget if it has to.
    expect(rows.join('')).not.toContain(' ')
  })

  it('leaves a name that fits on one row alone, byte for byte', () => {
    const markup = render(props('card', { flat: true }))
    expect(labelRows(markup)).toEqual(['Onboarding'])
    // …and the numeral stays on the card's centre line when there is one row.
    expect(numeral(markup).y).toBe(22)
  })

  it('lifts the numeral onto the name\'s row when the card has two', () => {
    // The second row is authored against the FULL inline room, so a numeral left
    // on the centre line would sit between the rows with the longer one running
    // under it.
    const markup = render(
      props('card', { flat: true, view: { ...props('card').view, label: LONG } }),
    )
    expect(numeral(markup).y).toBe(22 - 8)
  })

  it('draws the organizations under a branch, not the work filed under it', () => {
    const view = { ...props('card').view, count: '0', orgs: '18' }
    expect(numeral(render(props('card', { flat: true, view }))).text).toBe('18')
    // An organization has none under it, so its card goes back to counting the
    // work filed against it — which is the number an organization's card owes.
    const leaf = { ...view, orgs: null }
    expect(numeral(render(props('card', { flat: true, view: leaf }))).text).toBe('0')
  })

  it('gives the second row to the name and never to both', () => {
    // `secondary` is a world OPENING and `flat` answers `card` at every zoom, so
    // the two can never ask for the same baseline — asserted rather than traced.
    const markup = render(
      props('card', { flat: true, view: { ...props('card').view, label: LONG } }),
    )
    expect(markup).not.toContain('mring-secondary')
  })

  it('announces the whole name once, however many rows it is drawn over', () => {
    // The <g> carries the untruncated, unwrapped name; every drawn row is
    // decoration over it, so the second one may not be read out again.
    const markup = render(
      props('card', { flat: true, view: { ...props('card').view, label: LONG } }),
    )
    expect(markup).toContain('aria-label="Onboarding, 12 open, 6 of 9 live"')
    expect(markup).toMatch(/<text class="mtree-node-label"[^>]*aria-hidden="true"[^>]*>⁨Directorate/)
  })
})
