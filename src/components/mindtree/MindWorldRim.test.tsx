// Proof for the world rim: the handoff, the mirror, and the signpost.
//
// renderToStaticMarkup rather than a DOM, for the reason NodeCard.test.tsx
// states: vitest.config.ts is `environment: 'node'` and jsdom is not in the
// dependency budget. Everything this component decides is in the markup — an
// arc's flags, a text run's opacity (or its absence), what is drawn at all — so
// nothing here is weaker for it.

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import MindWorldRim, { type MindWorldRimProps } from './MindWorldRim'

const WORLD = { worldX: 1000, worldY: 800, worldD: 600 }

function props(over: Partial<MindWorldRimProps> = {}): MindWorldRimProps {
  return {
    world: WORLD,
    label: 'Onboarding',
    ink: { '--track-c-dark': '#6b7280' } as MindWorldRimProps['ink'],
    matches: 0,
    matchWedges: [],
    rtl: false,
    fade: 1,
    ...over,
  }
}

function render(p: MindWorldRimProps): string {
  return renderToStaticMarkup(<MindWorldRim {...p} />)
}

/** The `A rx ry rot large sweep x y` flags of the first arc in the markup. */
function arcFlags(markup: string): { large: string; sweep: string } {
  const m = /A [\d.]+ [\d.]+ 0 (\d) (\d) /.exec(markup)
  return { large: m?.[1] ?? '', sweep: m?.[2] ?? '' }
}

describe('MindWorldRim', () => {
  it('draws the boundary and the name that left the card', () => {
    const markup = render(props())
    expect(markup).toContain('class="mring-world-edge"')
    expect(markup).toContain('Onboarding')
    // At the boundary's block-start, on the world's own centre line — `middle`
    // needs no mirror in either script.
    expect(markup).toContain('text-anchor="middle"')
    expect(markup).toContain('cx="1000"')
    expect(markup).toContain('r="300"')
  })

  it('renders NOTHING at all once it has faded out', () => {
    expect(render(props({ fade: 0 }))).toBe('')
    expect(render(props({ fade: -1 }))).toBe('')
    expect(render(props({ fade: Number.NaN }))).toBe('')
  })

  it('is total — a degenerate world draws nothing rather than NaN path data', () => {
    for (const worldD of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      const markup = render(props({ world: { ...WORLD, worldD } }))
      expect(markup).not.toContain('NaN')
    }
  })

  it('fades the RIM but never the words', () => {
    // The rendering invariant: only non-text ink dissolves. A half-faded label
    // is a resting mark at a ratio nobody measured — mindtree.css priced it at
    // 6.06/5.53 falling to 3.76/3.20.
    const markup = render(props({ fade: 0.4, matches: 2, matchWedges: [{ start: 0, end: 1 }] }))
    expect(markup).toMatch(/class="mring-world-edge"[^>]*opacity="0.4"/)
    expect(markup).toMatch(/class="mring-world-match"[^>]*opacity="0.4"/)
    expect(markup).not.toMatch(/<text[^>]*opacity=/)
  })

  it('writes no opacity attribute at all when it is fully drawn', () => {
    expect(render(props({ fade: 1 }))).not.toContain('opacity=')
  })

  it('is decorative — the name belongs to the treeitem and to the breadcrumb', () => {
    expect(render(props())).toContain('aria-hidden="true"')
  })
})

describe('the match rim', () => {
  it('draws an arc per matching child and the count, only when there are matches', () => {
    const none = render(props({ matches: 0, matchWedges: [{ start: 0, end: 1 }] }))
    expect(none).not.toContain('mring-world-match')
    expect(none).not.toContain('mring-world-matches')

    const some = render(
      props({
        matches: 3,
        matchWedges: [
          { start: 0, end: 0.6 },
          { start: 2, end: 2.6 },
        ],
      }),
    )
    expect([...some.matchAll(/class="mring-world-match"/g)]).toHaveLength(2)
    expect(some).toContain('class="mring-world-matches tabular"')
    expect(some).toContain('>3<')
  })

  it('FLIPS THE SWEEP FLAG UNDER RTL', () => {
    // The layout's mirror maps θ → π − θ, which turns clockwise into
    // anticlockwise. A fixed sweep flag therefore takes the long way round in
    // Arabic, and on any directional mark it reads as counting DOWN. Two points
    // on a circle admit four arcs; the flag is which one.
    const wedge = [{ start: 0, end: 0.8 }]
    expect(arcFlags(render(props({ matches: 1, matchWedges: wedge }))).sweep).toBe('1')
    expect(arcFlags(render(props({ matches: 1, matchWedges: wedge, rtl: true }))).sweep).toBe('0')
  })

  it('sets the large-arc flag from the wedge it was actually given', () => {
    const small = render(props({ matches: 1, matchWedges: [{ start: 0, end: 1 }] }))
    const big = render(props({ matches: 1, matchWedges: [{ start: 0, end: 4 }] }))
    expect(arcFlags(small).large).toBe('0')
    expect(arcFlags(big).large).toBe('1')
  })

  it('skips a wedge with no angle rather than emitting a zero-length arc', () => {
    const markup = render(
      props({
        matches: 2,
        matchWedges: [
          { start: 1, end: 1 },
          { start: Number.NaN, end: 2 },
          { start: 0, end: 0.5 },
        ],
      }),
    )
    expect([...markup.matchAll(/class="mring-world-match"/g)]).toHaveLength(1)
    expect(markup).not.toContain('NaN')
  })

  it('clamps a full turn to an arc that still has two endpoints', () => {
    const markup = render(props({ matches: 1, matchWedges: [{ start: 0, end: Math.PI * 4 }] }))
    expect(markup).toContain('mring-world-match')
    expect(markup).not.toContain('NaN')
  })

  it('puts the count in the ink, never in the accent it counts', () => {
    // --accent over the worst 16% node fill measures 3.15 dark: a non-text pass
    // and a text FAIL. The arc keeps the hue; the numeral takes --text.
    const markup = render(props({ matches: 4, matchWedges: [{ start: 0, end: 1 }] }))
    expect(markup).toMatch(/class="mring-world-matches tabular"/)
    // No inline colour anywhere: every mark resolves through mind-ring.css.
    expect(markup).not.toMatch(/(fill|stroke)="#/)
  })
})

describe('colour', () => {
  it('lets a hue in only through the --track-c-* pair the caller passes', () => {
    expect(render(props())).toContain('--track-c-dark')
  })
})
