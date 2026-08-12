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
  bandFor,
  BAND_BLEND,
  BAND_EDGES,
  DOM_HORIZON_PX,
  type Band,
} from './lod'
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
    expect(BAND_EDGES).toEqual({ grain: 7, state: 26, chip: 52, card: 140, opening: 380, frame: 0.85 })
    expect(BAND_BLEND).toBe(0.18)
    expect(DOM_HORIZON_PX).toBe(4)
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

function positioned(node: MindNodeModel, hasChildren: boolean): PositionedNode<MindNodeModel> & {
  readonly worldX: number
  readonly worldY: number
  readonly worldD: number
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
    worldD: 538,
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

  it('draws NO TEXT at grain or state', () => {
    // A numeral inside a 30px disc renders at 3px and is a lie about legibility.
    expect(render(props('grain'))).not.toContain('<text')
    expect(render(props('state'))).not.toContain('<text')
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

describe('the chip', () => {
  it('puts the name outside the box and the count in the middle', () => {
    const markup = render(props('chip'))
    expect(markup).toContain('text-anchor="middle"')
    expect(markup).toContain('pointer-events="none"')
  })

  it('anchors the outside label correctly in all four side x direction cases', () => {
    const anchorOf = (markup: string): string =>
      /class="mtree-node-label"[^>]*text-anchor="(start|end)"/.exec(markup)?.[1] ?? ''
    const at = (outwardX: number, rtl: boolean): string => {
      const base = props('chip')
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

  it('spends the ray on the word rather than on a chevron', () => {
    expect(render(props('chip'))).not.toContain('mtree-chevron')
    expect(render(props('card'))).toContain('mtree-chevron')
  })
})

describe('the progress underscore', () => {
  const xOf = (markup: string): number =>
    Number(/class="mring-progress" x="([-\d.]+)"/.exec(markup)?.[1] ?? Number.NaN)
  const widthOf = (markup: string): number =>
    Number(/class="mring-progress"[^>]*width="([\d.]+)"/.exec(markup)?.[1] ?? Number.NaN)

  it('encodes the live share as LENGTH, with nothing behind the remainder', () => {
    const markup = render(props('card'))
    // 6 of 9, in a 168-wide box inset 12 both sides: (168-24) x 2/3 = 96.
    expect(widthOf(markup)).toBeCloseTo(96, 6)
    // One rect for the underscore and one for the box. No third rect: a track
    // behind the remainder would be a diluted mark, and dilution hands the
    // measured ratio back.
    expect([...markup.matchAll(/<rect/g)]).toHaveLength(2)
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

  it('is absent when there is nothing to say', () => {
    const none = props('card')
    const markup = render({ ...none, view: { ...none.view, progress: null } })
    expect(markup).not.toContain('mring-progress')
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
