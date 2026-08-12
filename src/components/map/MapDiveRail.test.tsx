// Proof for the dive rail, and for the control budget it exists to satisfy.
//
// WHY renderToStaticMarkup AND NOT A DOM. vitest.config.ts is `environment:
// 'node'` and jsdom is not in the dependency budget — Breadcrumb.test.tsx and
// every page test in this repo open with that paragraph. It costs little here:
// the rail has no effects, no timers and no measurement, so the server render IS
// the component. What it CANNOT prove is anything about pixels, and the two
// things in this unit that live in pixels — the 44px targets and the vertical
// writing mode's Arabic mirror — are asserted against the SHEET below and then
// named in the handoff as needing a real browser. A test that claimed to have
// measured them would be the exact failure this redesign is a response to.
//
// WHAT IS ACTUALLY BEING DEFENDED. Five promises, each of which is a regression
// that would be invisible until someone used the screen:
//
//   1. IT SPEAKS A WORD, NEVER A NUMBER. `aria-valuetext` is the world the
//      camera frames. This is the whole reason a slider can replace a ladder of
//      named stops without losing the naming, and it has to hold in BOTH
//      languages, because the failure mode is an English word in an Arabic UI.
//   2. THE LADDER IS THE ADMIN'S DEPTH. Two rungs draw two ticks; seven draw
//      seven. Nothing here is four.
//   3. NO role="radiogroup". A radio group takes the arrow keys away from
//      everything inside it and the canvas's roving tabindex is one Tab stop
//      away.
//   4. THE PERSISTENT TARGET COUNT. Exactly two targets come from this file,
//      whatever the depth of the tree — which is what makes the budget in
//      docs/MAP-ZOOM.md §6 arithmetic rather than a hope.
//   5. ARROWS STEP A TIER, and Right/Left swap under RTL while Up/Down do not.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.hoisted(() => {
  // lib/i18n reads localStorage at module scope; the import below runs first.
  const mem = new Map<string, string>()
  const g = globalThis as unknown as Record<string, unknown>
  g.localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() {
      return mem.size
    },
  }
})

const RailModule = await import('./MapDiveRail')
const MapDiveRail = RailModule.default
const { rungStep } = RailModule
const { setLocale } = await import('../../lib/i18n')

// Register the namespace, exactly as Breadcrumb.test.tsx does: `t()` resolves
// against the bundle OBJECTS at call time, so this is precisely what
// locales/index.ts's spread will do.
const locales = await import('../../locales')
Object.assign(locales.en, (await import('../../locales/en/mindtree.json')).default)
Object.assign(locales.ar, (await import('../../locales/ar/mindtree.json')).default)

/**
 * THE TWO KEYS THIS UNIT ADDS, STUBBED HERE, AND THE STUB IS THE HANDOFF MADE
 * EXECUTABLE.
 *
 * `src/locales/{en,ar}/mindtree.json` belong to the integrator (docs/MAP-ZOOM.md
 * §12) and a unit may not edit them, so the keys this component reads do not
 * resolve yet and `localeReach.test.ts` will say so by name — which is the
 * loudest possible handoff and is deliberate.
 *
 * Stubbing them here is NOT a way of hiding that. It is what lets these
 * assertions test the COMPONENT's promise (it renders the world's name, in the
 * reader's language, and never a number) rather than testing whether a JSON file
 * has landed. When the integrator lands the real strings, the parity, reach,
 * plural and bidi gates cover them and these stubs are overwritten by the
 * `Object.assign` above running first — so this file cannot mask a missing key,
 * only a missing key's absence from THIS assertion.
 */
const EN = locales.en as Record<string, unknown>
const AR = locales.ar as Record<string, unknown>
const enMind = EN.mindtree as Record<string, unknown>
const arMind = AR.mindtree as Record<string, unknown>
enMind.diveLabel ??= 'How far into the map you are'
enMind.diveValue ??= 'Showing ⁨{world}⁩'
arMind.diveLabel ??= 'إلى أي عمق وصلت في الخريطة'
arMind.diveValue ??= 'يعرض ⁨{world}⁩'

const RUNGS = [
  { id: 'root', label: 'NphiesCore', octaves: 0 },
  { id: 'uhr', label: 'UHR', octaves: 1.43 },
  { id: 'ob', label: 'Onboarding', octaves: 3.2 },
]

function render(overrides: Partial<Parameters<typeof MapDiveRail>[0]> = {}): string {
  return renderToStaticMarkup(
    <MapDiveRail
      value={1.43}
      max={3.2}
      rungs={RUNGS}
      worldLabel="UHR"
      onChange={() => {}}
      onHome={() => {}}
      table={false}
      onTable={() => {}}
      compact={false}
      {...overrides}
    />,
  )
}

describe('MapDiveRail', () => {
  it('speaks the WORLD, not a number, and does so in both languages', () => {
    setLocale('en')
    const en = render()
    expect(en).toContain('aria-valuetext="Showing ⁨UHR⁩"')
    // The assertion that matters is the negative one: a valuetext that is a
    // number is the control this rail replaced, wearing a slider's clothes.
    const enText = /aria-valuetext="([^"]*)"/.exec(en)?.[1] ?? ''
    expect(enText).not.toMatch(/\d/)
    expect(enText).toContain('UHR')

    setLocale('ar')
    const ar = render()
    const arText = /aria-valuetext="([^"]*)"/.exec(ar)?.[1] ?? ''
    expect(arText).not.toMatch(/\d/)
    expect(arText).toContain('UHR')
    // Not the English sentence. A rail that spoke English inside an Arabic UI
    // would still pass "is a word".
    expect(arText).not.toContain('Showing')
    setLocale('en')
  })

  it('draws the ADMIN’s depth of ticks, never four', () => {
    for (const depth of [1, 2, 3, 5, 7]) {
      const rungs = Array.from({ length: depth }, (_, i) => ({
        id: `r${i}`,
        label: `Tier ${i}`,
        octaves: i * 1.4,
      }))
      const html = renderToStaticMarkup(
        <MapDiveRail
          value={0}
          max={Math.max((depth - 1) * 1.4, 0.02)}
          rungs={rungs}
          worldLabel="Tier 0"
          onChange={() => {}}
          onHome={() => {}}
          table={false}
          onTable={() => {}}
          compact={false}
        />,
      )
      expect(html.match(/class="mdive-tick"/g) ?? []).toHaveLength(depth)
    }
  })

  it('is a range input with a continuous step and no radiogroup', () => {
    const html = render()
    expect(html).toContain('type="range"')
    expect(html).toContain('step="0.02"')
    expect(html).toContain('min="0"')
    // A radio group takes the arrow keys away from everything inside it, and the
    // canvas's roving tabindex is ONE TAB STOP AWAY.
    expect(html).not.toContain('radiogroup')
    expect(html).not.toContain('role="radio"')
    // The ledger toggle is a pressed toggle, for a state it actually holds.
    expect(html).toContain('aria-pressed="false"')
    expect(render({ table: true })).toContain('aria-pressed="true"')
  })

  it('contributes exactly TWO persistent targets at any depth', () => {
    // The budget in docs/MAP-ZOOM.md §6 is arithmetic only if this number does
    // not grow with the tree. Ticks are marks — `aria-hidden`, `pointer-events:
    // none` — precisely so that a seven-tier workspace does not silently spend
    // five more of the twelve.
    const deep = Array.from({ length: 9 }, (_, i) => ({
      id: `r${i}`,
      label: `T${i}`,
      octaves: i * 1.2,
    }))
    for (const rungs of [RUNGS, deep]) {
      const html = renderToStaticMarkup(
        <MapDiveRail
          value={0}
          max={12}
          rungs={rungs}
          worldLabel="T0"
          onChange={() => {}}
          onHome={() => {}}
          table={false}
          onTable={() => {}}
          compact={false}
        />,
      )
      const targets = (html.match(/<button/g) ?? []).length + (html.match(/<input/g) ?? []).length
      expect(targets).toBe(2)
      expect(html).toContain('aria-hidden="true"')
    }
  })

  it('puts the slider before the Table toggle in the DOM, which is the tab order', () => {
    // docs/MAP-ZOOM.md §7 fixes the whole order — search → Filter → crumbs →
    // lens chips → Meetings → Export → group-by → DIVE SLIDER → TABLE → the
    // tree's single roving stop → sidebar → composer. Only the last two hops of
    // that sequence are inside this file, and they are the two that would flip
    // silently if someone moved the ledger row above the track for layout
    // reasons. The rest belongs to the composition and is U5's to assert.
    const html = render()
    expect(html.indexOf('<input')).toBeGreaterThan(-1)
    expect(html.indexOf('<input')).toBeLessThan(html.indexOf('<button'))
    // And nothing here removes itself from the sequence.
    expect(html).not.toContain('tabindex="-1"')
    expect(html).not.toContain('disabled')
  })

  it('places every tick as a share of the octave span, mirrored by inset-inline', () => {
    const html = render()
    // 0 / 3.2, 1.43 / 3.2, 3.2 / 3.2. The custom property is consumed by
    // `inset-inline-start` in the sheet, which is what makes the Arabic mirror
    // and the vertical writing mode both free.
    expect(html).toContain('--mdive-at:0%')
    expect(html).toContain('--mdive-at:100%')
    expect(html).toContain(`--mdive-at:${(1.43 / 3.2) * 100}%`)
  })

  it('isolates a tick label so a mixed-script path cannot reorder', () => {
    const html = render({
      rungs: [{ id: 'ar', label: 'الشبكة', octaves: 0 }],
      worldLabel: 'الشبكة',
    })
    // FSI … PDI around the value, per lib/bidi.isolate. The label is DATABASE
    // TEXT and never reaches t(), which echoes an unknown key.
    expect(html).toContain('⁨الشبكة⁩')
  })

  it('survives a workspace with no dive at all', () => {
    // One tier: `max` is 0, and a range whose min equals its max is a control the
    // browser renders and cannot move, with no announced value.
    const html = render({ max: 0, value: 0, rungs: [RUNGS[0]!] })
    expect(html).toContain('max="0.02"')
    expect(html).toContain('aria-valuetext=')
  })

  it('clamps a rubber-banded value into the track without losing the name', () => {
    // U3's terminus lets the camera go past the deepest world and springs back.
    // The rail must not render `value` outside `[min, max]` — React would warn
    // and the thumb would leave the track — and must keep saying where you are.
    const html = render({ value: 9.9 })
    expect(html).toContain('value="3.2"')
    expect(html).toContain('Showing ⁨UHR⁩')
    expect(render({ value: Number.NaN })).toContain('value="0"')
  })

  describe('rungStep — arrows step a TIER, not a hundredth of one', () => {
    it('walks to the next and previous world boundary', () => {
      expect(rungStep(0, 3.2, RUNGS, 1)).toBe(1.43)
      expect(rungStep(1.43, 3.2, RUNGS, 1)).toBe(3.2)
      expect(rungStep(3.2, 3.2, RUNGS, -1)).toBe(1.43)
      expect(rungStep(1.43, 3.2, RUNGS, -1)).toBe(0)
    })

    it('stops at the ends rather than running off them', () => {
      expect(rungStep(3.2, 3.2, RUNGS, 1)).toBe(3.2)
      expect(rungStep(0, 3.2, RUNGS, -1)).toBe(0)
    })

    it('lands on the enclosing boundary from anywhere between two rungs', () => {
      expect(rungStep(2.1, 3.2, RUNGS, 1)).toBe(3.2)
      expect(rungStep(2.1, 3.2, RUNGS, -1)).toBe(1.43)
    })

    it('is total over rubbish', () => {
      expect(rungStep(Number.NaN, 3.2, RUNGS, 1)).toBe(1.43)
      expect(rungStep(0, 0, [], 1)).toBe(0.02)
      expect(rungStep(0, 0, [], -1)).toBe(0)
      // Out of order, out of range, and NaN octaves all filtered rather than
      // placed: a layout that produced NaN would otherwise put a rung nowhere.
      const messy = [
        { id: 'c', label: 'c', octaves: 3.2 },
        { id: 'a', label: 'a', octaves: 0 },
        { id: 'x', label: 'x', octaves: Number.NaN },
        { id: 'y', label: 'y', octaves: 99 },
        { id: 'b', label: 'b', octaves: 1.43 },
      ]
      expect(rungStep(0, 3.2, messy, 1)).toBe(1.43)
      expect(rungStep(3.2, 3.2, messy, -1)).toBe(1.43)
    })
  })
})

/**
 * The sheet this unit owns, as text.
 *
 * `?raw` ON A `.css` FILE ONLY WORKS BECAUSE vitest.config.ts SETS `css: true`,
 * and that file's own note explains why: vitest's default replaces every `.css`
 * import with an empty module, and the interception matches the EXTENSION
 * BEFORE the query — so `?raw` yields `''` and every assertion written against
 * that string passes against nothing, forever. Two Wave-B agents shipped
 * vacuously green sheet assertions that way. The first `expect` below is a
 * non-empty check for exactly that reason: it is the guard that makes the rest
 * of this block mean something.
 */
const RAW: Record<string, string> = import.meta.glob('./map-altitude.css', {
  query: '?raw',
  import: 'default',
  eager: true,
})
const sheet = RAW['./map-altitude.css'] ?? ''

describe('map-altitude.css — the things a node render cannot see', () => {
  it('was actually read, which is what stops the rest of this block lying', () => {
    expect(sheet.length).toBeGreaterThan(2000)
    expect(sheet).toContain('.mdive-range')
  })

  it('holds every target to 44px on the axis `.tap-44` does not grow', () => {
    // `.tap-44`'s overlay is `inset-block: -7px`, so it only ever grows the BLOCK
    // axis. A control whose inline extent is a word in one language and four
    // letters in another needs its own floor, which is why both of these appear.
    expect(sheet).toContain('min-block-size: 44px')
    expect(sheet).toMatch(/\.mdive-table\s*\{[^}]*min-inline-size: 44px/s)
  })

  it('states no physical direction anywhere', () => {
    // LOGICAL CSS ONLY. The rail is vertical on the desktop and horizontal on
    // the phone by `writing-mode` alone, so there is nothing here to mirror.
    const code = sheet.replace(/\/\*[\s\S]*?\*\//g, '')
    for (const banned of [
      'margin-left',
      'margin-right',
      'padding-left',
      'padding-right',
      'border-left',
      'border-right',
      'left:',
      'right:',
      'text-align: left',
      'text-align: right',
    ]) {
      expect(code).not.toContain(banned)
    }
    // `direction:` NEEDS A BOUNDARY, and the first draft of this test did not
    // have one: `flex-direction` contains the string, so a naive `toContain`
    // fails on a file that is perfectly correct. What is actually banned is the
    // BARE property — setting `direction` is how a sheet forces a reading order,
    // which is what the vertical rail is deliberately NOT doing (see the sheet's
    // header on what `writing-mode: vertical-lr` does in Arabic).
    expect(code).not.toMatch(/(^|[^-\w])direction\s*:/m)
    // `writing-mode` IS allowed and is load-bearing: it is the whole of the
    // difference between the desktop rail and the phone rail.
    expect(code).toContain('writing-mode: vertical-lr')
    expect(code).toContain('writing-mode: horizontal-tb')
  })

  it('separates the thumb from its track with the plate colour, which is the measured fix', () => {
    // `--accent` on `--field-border` is 1.38 / 3.73 and FAILS 1.4.11 in the dark
    // theme. The ring makes the thumb's adjacent colour `--bg-elev` (5.20 /
    // 13.62) on every side. Deleting it is the regression this asserts against.
    expect(sheet).toMatch(/-webkit-slider-thumb\s*\{[^}]*border: 2px solid var\(--bg-elev\)/s)
    expect(sheet).toMatch(/-moz-range-thumb\s*\{[^}]*border: 2px solid var\(--bg-elev\)/s)
  })
})
