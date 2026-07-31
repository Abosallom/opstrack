// The pure half of the export path.
//
// SCOPE, STATED UP FRONT: this file tests the string builders and nothing else.
// vitest runs in the `node` environment here (see any pages/*.test.tsx header),
// so there is no `document`, no `Image`, no `HTMLCanvasElement` and no
// `getComputedStyle` — the DOM half of export.ts is unreachable from a test in
// this repo, and faking a layout engine well enough to assert on a rasterised
// PNG would be testing the fake. What IS testable is exactly the part that goes
// wrong silently: the filename the brand gate cares about, the escaping that
// keeps a user-typed track name from turning a document into markup, and the
// document wrapper whose failure mode is a picture that opens black-on-black in
// somebody's steering deck.
//
// The DOM half is covered by the standing manual check in the handoff note
// (export both formats, open both files outside the app, in both themes).

import { describe, expect, it } from 'vitest'
import {
  MINDTREE_MIME,
  INLINE_PROPERTIES,
  captionBandHeight,
  escapeXml,
  mindtreeFilename,
  parseViewBox,
  svgDocument,
} from './export'

const AT = new Date(2026, 6, 31, 14, 8, 9)

function doc(overrides: Partial<Parameters<typeof svgDocument>[0]> = {}): string {
  return svgDocument({
    width: 800,
    height: 600,
    viewBox: '0 0 800 600',
    background: '#171d23',
    title: 'Mindtree',
    desc: '5 tracks, 12 open',
    direction: 'ltr',
    body: '<g><rect width="10" height="10"/></g>',
    ...overrides,
  })
}

describe('mindtreeFilename', () => {
  it('carries the brand prefix', () => {
    // lib/brand.test.ts is the gate; this is the local copy that fails on the
    // worker's own machine rather than three files away.
    expect(mindtreeFilename('svg', AT)).toBe('coretrack-mindtree-2026-07-31-1408.svg')
    expect(mindtreeFilename('png', AT)).toBe('coretrack-mindtree-2026-07-31-1408.png')
  })

  it('never contains a character that dies on a Windows share', () => {
    for (const kind of ['svg', 'png'] as const) {
      const name = mindtreeFilename(kind, AT)
      expect(name).not.toMatch(/[:\s\\/*?"<>|]/)
    }
  })

  it('pads every field so a Downloads folder sorts chronologically', () => {
    expect(mindtreeFilename('svg', new Date(2026, 0, 2, 3, 4))).toBe(
      'coretrack-mindtree-2026-01-02-0304.svg',
    )
  })

  it('uses the local clock, not UTC', () => {
    // The stamp exists so a person can tell two exports apart in their own
    // folder, and "when did I take this" is a question they answer in their own
    // clock. Asserting on the local getters is what pins that: a switch to
    // toISOString() would pass every other case in this block.
    const at = new Date(2026, 11, 31, 23, 59)
    expect(mindtreeFilename('png', at)).toBe('coretrack-mindtree-2026-12-31-2359.png')
  })
})

describe('escapeXml', () => {
  it('escapes all five entities', () => {
    expect(escapeXml(`a&b<c>d"e'f`)).toBe('a&amp;b&lt;c&gt;d&quot;e&apos;f')
  })

  it('escapes the ampersand first so an entity is not double-built', () => {
    // `<` → `&lt;` and then a second pass over `&` would produce `&amp;lt;`.
    expect(escapeXml('<')).toBe('&lt;')
    expect(escapeXml('&lt;')).toBe('&amp;lt;')
  })

  it('leaves Arabic and bidi controls alone', () => {
    // The isolates are U+2066–U+2069 and are legal XML text. Stripping them
    // here would undo lib/bidi.ts inside the exported file, which is where a
    // mixed Arabic/Latin label most needs them — nobody is going to notice a
    // reordered track name in a PNG until it is on a screen behind them.
    const label = '⁨Network / الشبكات⁩'
    expect(escapeXml(label)).toBe(label)
  })

  it('is total over the empty string', () => {
    expect(escapeXml('')).toBe('')
  })
})

describe('svgDocument', () => {
  it('declares the SVG namespace and its own size', () => {
    const out = doc()
    expect(out.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="no"?>')).toBe(true)
    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(out).toContain('width="800"')
    expect(out).toContain('height="600"')
    expect(out).toContain('viewBox="0 0 800 600"')
  })

  it('paints an opaque ground', () => {
    // A transparent export lands the dark theme's near-white label ink on a
    // white slide. The rect is in USER units and deliberately enormous so it
    // covers the picture at any viewBox a consumer decides to impose.
    const out = doc({ background: '#171d23' })
    expect(out).toMatch(/<rect x="-100000" y="-100000" width="200000" height="200000" fill="#171d23"\/>/)
  })

  it('carries a title and a description a reader can hear', () => {
    const out = doc({ title: 'Mindtree', desc: '5 tracks, 12 open, 2 past deadline' })
    expect(out).toContain('<title>Mindtree</title>')
    expect(out).toContain('<desc>5 tracks, 12 open, 2 past deadline</desc>')
    expect(out).toContain('role="img"')
    expect(out).toContain('aria-label="Mindtree"')
  })

  it('escapes user text in both a text node and an attribute', () => {
    // A track named `IT "Ops" & <friends>` is exactly the input that closes the
    // aria-label attribute and turns the rest of the file into markup.
    const out = doc({ title: 'IT "Ops" & <friends>' })
    expect(out).toContain('<title>IT &quot;Ops&quot; &amp; &lt;friends&gt;</title>')
    expect(out).toContain('aria-label="IT &quot;Ops&quot; &amp; &lt;friends&gt;"')
    expect(out).not.toContain('<friends>')
  })

  it('mirrors direction so an Arabic export reads the way the app did', () => {
    expect(doc({ direction: 'rtl' })).toContain('direction="rtl"')
    expect(doc({ direction: 'ltr' })).toContain('direction="ltr"')
  })

  it('emits the body verbatim', () => {
    expect(doc({ body: '<g id="x"/>' })).toContain('<g id="x"/>')
  })

  it('survives a viewport measured at zero', () => {
    // A container measured before layout is 0×0, and a <svg width="0"> is a
    // file with no picture in it. One pixel is not a good export; a zero-pixel
    // one is a corrupt export, and this is the difference.
    const out = doc({ width: 0, height: Number.NaN })
    expect(out).toContain('width="1"')
    expect(out).toContain('height="1"')
  })

  it('never emits an unresolved custom property', () => {
    // The whole point of the inlining pass. If a `var(` ever reaches the
    // document the file opens black-on-black outside the app, which is a
    // failure nobody sees until it is projected.
    expect(doc()).not.toContain('var(--')
  })

  it('references nothing outside itself', () => {
    const out = doc()
    expect(out).not.toContain('<style')
    expect(out).not.toContain('xlink')
    expect(out).not.toContain('<use')
    expect(out).not.toMatch(/href="http/)
  })
})

describe('module constants', () => {
  it('names both MIME types with an explicit charset on the text one', () => {
    expect(MINDTREE_MIME.svg).toBe('image/svg+xml;charset=utf-8')
    expect(MINDTREE_MIME.png).toBe('image/png')
  })

  it('inlines the properties an SVG actually paints with', () => {
    // A fixed list, not every computed longhand — see export.ts's note. The
    // three that matter most are asserted by name because dropping one is
    // invisible until a file opens somewhere else.
    expect(INLINE_PROPERTIES).toContain('fill')
    expect(INLINE_PROPERTIES).toContain('stroke')
    expect(INLINE_PROPERTIES).toContain('font-size')
    expect(new Set(INLINE_PROPERTIES).size).toBe(INLINE_PROPERTIES.length)
  })
})

describe('parseViewBox', () => {
  it('reads the four numbers back', () => {
    expect(parseViewBox('0 0 800 600')).toEqual({ x: 0, y: 0, width: 800, height: 600 })
    expect(parseViewBox('-44.5 639.5 1093.29 445')).toEqual({
      x: -44.5,
      y: 639.5,
      width: 1093.29,
      height: 445,
    })
  })

  it('accepts the separators the SVG grammar allows, not just the one we write', () => {
    expect(parseViewBox('0, 0, 10, 10')).toEqual({ x: 0, y: 0, width: 10, height: 10 })
  })

  it('refuses anything the caption cannot safely grow', () => {
    // Null rather than a guess: the caller falls back to the bare document, and
    // a bare document is a worse export than a captioned one but not a broken
    // one — which a NaN viewBox would be.
    for (const bad of ['', '0 0 800', '0 0 800 600 7', 'a b c d', '0 0 0 600', '0 0 800 -1', null]) {
      expect(parseViewBox(bad)).toBeNull()
    }
  })
})

describe('svgDocument — the caption band', () => {
  const CAPTION = {
    heading: 'CoreTrack — Mindtree',
    lines: ['As of 31/07/2026 14:08', '5 tracks, 12 open, 2 past deadline.'],
    ink: 'rgb(230, 237, 243)',
    font: 'Cairo, system-ui, sans-serif',
  }

  it('paints the facts that <title> and <desc> cannot deliver to a slide', () => {
    // THE DEFECT: the title, the date and the filter state were metadata only.
    // Metadata is invisible the moment the picture is on a slide, so the
    // artifact an ops lead pasted into a steering deck was an unlabelled,
    // undated, silently-filtered diagram its audience could not check.
    const out = doc({ caption: CAPTION })
    expect(out).toContain('>CoreTrack — Mindtree<')
    expect(out).toContain('>As of 31/07/2026 14:08<')
    expect(out).toContain('>5 tracks, 12 open, 2 past deadline.<')
  })

  it('grows the window upward so the band is inside the picture', () => {
    const bare = parseViewBox(/viewBox="([^"]+)"/.exec(doc())?.[1] ?? '')
    const withBand = parseViewBox(/viewBox="([^"]+)"/.exec(doc({ caption: CAPTION }))?.[1] ?? '')
    expect(bare).not.toBeNull()
    expect(withBand).not.toBeNull()
    const band = captionBandHeight({ x: 0, y: 0, width: 800, height: 600 }, 800, 2)
    expect(band).toBeGreaterThan(0)
    // Up, not down: the caption reads above the map, and the drawing does not
    // move within the coordinate space it was laid out in.
    expect(withBand?.y).toBeCloseTo((bare?.y ?? 0) - band, 3)
    expect(withBand?.height).toBeCloseTo((bare?.height ?? 0) + band, 3)
    expect(withBand?.x).toBe(bare?.x)
    expect(withBand?.width).toBe(bare?.width)
  })

  it('grows the declared height with it, so a raster cannot crop the band', () => {
    const height = /height="(\d+)"/.exec(doc({ caption: CAPTION }))?.[1]
    expect(Number(height)).toBeGreaterThan(600)
  })

  it('escapes user text in the band as thoroughly as in the title', () => {
    // A track name reaches the summary sentence, and a summary sentence reaches
    // a <text> node. Same boundary, same escaping.
    const out = doc({ caption: { ...CAPTION, lines: ['IT "Ops" & <friends>'] } })
    expect(out).toContain('IT &quot;Ops&quot; &amp; &lt;friends&gt;')
    expect(out).not.toContain('<friends>')
  })

  it('carries no class and no unresolved custom property into the band', () => {
    const out = doc({ caption: CAPTION })
    expect(out).not.toContain('var(--')
    expect(out).not.toContain('<style')
    // The ink and the font are READ off the live document, never chosen here.
    expect(out).toContain('fill:rgb(230, 237, 243)')
    expect(out).toContain('font-family:Cairo, system-ui, sans-serif')
  })

  it('anchors logically, so an Arabic export reads from the same edge the app did', () => {
    // `text-anchor="start"` resolves against the document's own `direction`,
    // which svgDocument writes — the same rule MindNode.tsx follows. Only the
    // coordinate flips.
    const ltr = /<text x="([-\d.]+)"/.exec(doc({ caption: CAPTION }))?.[1]
    const rtl = /<text x="([-\d.]+)"/.exec(doc({ caption: CAPTION, direction: 'rtl' }))?.[1]
    expect(Number(ltr)).toBeLessThan(Number(rtl))
    expect(doc({ caption: CAPTION })).toContain('text-anchor="start"')
  })

  it('is exactly the drawing when no caption is asked for', () => {
    expect(doc()).not.toContain('<text')
    expect(doc()).toContain('viewBox="0 0 800 600"')
  })
})

describe('captionBandHeight', () => {
  it('scales with the drawing so the caption is a constant point size', () => {
    // The band is measured in USER units but specified in the pixels the file
    // declares itself to be, because the map's own scale varies by two orders
    // of magnitude between a three-track workspace and a filtered thousand.
    const view = { x: 0, y: 0, width: 4000, height: 2000 }
    expect(captionBandHeight(view, 4000, 2)).toBeCloseTo(
      captionBandHeight({ ...view, width: 400 }, 400, 2),
      6,
    )
    // Half the declared width for the same drawing means twice the user units.
    expect(captionBandHeight(view, 2000, 2)).toBeCloseTo(captionBandHeight(view, 4000, 2) * 2, 6)
  })

  it('grows one step per line and is total over a bad width', () => {
    const view = { x: 0, y: 0, width: 800, height: 600 }
    const one = captionBandHeight(view, 800, 1)
    const two = captionBandHeight(view, 800, 2)
    expect(two).toBeGreaterThan(one)
    expect(Number.isFinite(captionBandHeight(view, 0, 2))).toBe(true)
    expect(captionBandHeight(view, 800, -3)).toBe(captionBandHeight(view, 800, 0))
  })
})
