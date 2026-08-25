// Render proof for the zoom control.
//
// WHY renderToStaticMarkup AND NOT A DOM: `vitest.config.ts` is
// `environment: 'node'` and jsdom is not in the dependency budget.
// `MapAnnouncer.test.tsx`, `MapBranchDetail.test.tsx`, `MapBranch.test.tsx` and
// the entry kit's own test all open with this paragraph.
//
// WHAT THAT COSTS HERE: nothing this file wants to claim. The component has no
// effect, no measurement and no state — its whole contract is markup, which is
// the shape it was given deliberately so that the one gate this repo can run
// cheaply is also the gate that covers it. There is no click to simulate,
// because the handlers are the caller's and `disabled` is the browser's.
//
// WHAT IT DOES NOT PROVE, STATED SO NOBODY READS MORE INTO A GREEN RUN. A static
// render cannot see a 44px target, an overlapping `::after`, or a plate sitting
// on top of the composer — those are the CSS header's arithmetic and they need a
// browser at 375×812 in both languages. The two things this file CAN pin about
// the sheet are pinned below: that every class rendered has a rule, and that the
// three tokens the phone rule reads are named in it. Both fail SILENTLY
// otherwise — a class with no rule takes the shared kit's defaults and reads as
// styling that was never written, and a hardcoded bar height is invisible until
// a bar changes size.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.hoisted(() => {
  // lib/i18n reads localStorage at module scope, at IMPORT time — so the shim
  // cannot wait for a beforeAll().
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
  g.addEventListener = () => {}
  g.removeEventListener = () => {}
  g.window = globalThis
  g.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
  g.document = { documentElement: { dir: 'ltr', lang: 'en' } }
})

const { default: MapZoomControl, zoomStepOf } = await import('./MapZoomControl')
const { setLocale, t } = await import('../../lib/i18n')
// The two trees themselves, not through t(). See the bundle gate at the foot of
// this file for why the difference is the whole point.
const { ar: AR, en: EN } = await import('../../locales')

/** The sheet as text. Eager + `?raw` — the mechanism MapBranchDetail.test.tsx,
 *  MapCapture.test.tsx and localeReach.test.ts all use to read a file in a node
 *  test. `node:fs` is not an option: `tsconfig.app.json` carries no `node` in
 *  its `types`, and importing it reds `tsc -b` for the whole solution. */
const SHEET_SRC: Record<string, string> = import.meta.glob('./map-zoom.css', {
  query: '?raw',
  import: 'default',
  eager: true,
})
const SHEET = SHEET_SRC['./map-zoom.css'] ?? ''

const html = (over: Partial<Parameters<typeof MapZoomControl>[0]> = {}): string =>
  renderToStaticMarkup(
    <MapZoomControl
      progress={over.progress ?? 0.5}
      onZoomIn={over.onZoomIn ?? (() => {})}
      onZoomOut={over.onZoomOut ?? (() => {})}
      onFit={over.onFit ?? (() => {})}
      atMin={over.atMin ?? false}
      atMax={over.atMax ?? false}
      compact={over.compact ?? false}
    />,
  )

/** Just the one button, so an assertion about `disabled` cannot be satisfied by
 *  a different button on the same plate. Sliced by the label, which is the only
 *  thing that distinguishes the two glyph buttons in the markup. */
const buttonWith = (out: string, label: string): string => {
  const at = out.indexOf(`aria-label="${label}"`)
  if (at < 0) return ''
  const from = out.lastIndexOf('<button', at)
  const to = out.indexOf('</button>', at)
  return out.slice(from, to < 0 ? undefined : to)
}

/* ─────────────────────── the readout says a WORD ──────────────────────── */

describe('the readout', () => {
  it('names where you are instead of printing a percentage', () => {
    // THE ONE REQUIREMENT THIS COMPONENT EXISTS TO MEET. `MapDiveRail`'s header
    // argued it first — "Zoom 100%" answered the question "100% of what?" — and
    // the argument is what survived the rail's deletion. A `%` anywhere in this
    // plate would be that control coming back through the side door.
    const out = html({ progress: 0.5 })
    expect(out).not.toContain('%')
    expect(out).toContain(t('mindtree.zoomStepMid'))
  })

  it('says the WIDEST word at 0 and the CLOSEST at 1, not the other way round', () => {
    // The direction of the range, which is the one thing about `progress` that a
    // caller can wire backwards and no type can catch. Asserted through the
    // rendered markup rather than through `zoomStepOf` alone, because the array
    // index and the word are two places the order has to agree.
    expect(html({ progress: 0 })).toContain(t('mindtree.zoomStepWhole'))
    expect(html({ progress: 1 })).toContain(t('mindtree.zoomStepClosest'))
  })

  it('lights the staircase up to the step and no further', () => {
    // Five pips, and the lit count IS the step. `data-on` is rendered as a bare
    // attribute (`data-on=""`), so counting the attribute counts the lit ones —
    // an unlit pip carries no `data-on` at all rather than `data-on="false"`,
    // which is what makes `[data-on]` a usable selector in the sheet.
    for (const [progress, lit] of [
      [0, 1],
      [0.5, 3],
      [1, 5],
    ] as const) {
      const out = html({ progress })
      // Lit and unlit carry the same className, so this counts the whole ramp —
      // a fifth pip lost to a bad `map` would take the ratio with it and the
      // `lit` assertion below would still pass.
      expect((out.match(/class="mzc-pip"/g) ?? []).length, `progress ${progress}`).toBe(5)
      expect((out.match(/data-on=""/g) ?? []).length, `progress ${progress}`).toBe(lit)
    }
  })

  it('is not a second live region', () => {
    // MapAnnouncer owns the page's one `aria-live`, and its own header records
    // why there is exactly one: two polite regions on a screen interrupt each
    // other. A readout that re-announces on every wheel notch would be the
    // loudest of the two.
    expect(html()).not.toContain('aria-live')
  })
})

describe('zoomStepOf', () => {
  it('rounds, so the closest word is reachable before progress is exactly 1', () => {
    // `Math.floor` would give "Closest" a range of one single point and hand
    // "Whole map" a quarter of the track — the asymmetry the component header
    // rejects. Round gives the two ends an eighth each.
    expect(zoomStepOf(0.9)).toBe(4)
    expect(zoomStepOf(0.13)).toBe(1)
  })

  it('floors a NaN to the widest step rather than throwing', () => {
    // A single-node workspace frames one rectangle, its zoom span is zero, and
    // the caller's division by that span is NaN. "Whole map" is the honest
    // answer there, and it is also what the two dead buttons beside it say.
    expect(zoomStepOf(Number.NaN)).toBe(0)
    expect(zoomStepOf(Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('clamps a caller who hands it more than the range', () => {
    expect(zoomStepOf(-3)).toBe(0)
    expect(zoomStepOf(4)).toBe(4)
  })
})

/* ───────────────────────────── the dead ends ──────────────────────────── */

describe('the ends of the range', () => {
  it('marks zoom-out disabled AND aria-disabled at the minimum, and only that one', () => {
    // BOTH, deliberately: `disabled` stops the click and greys the control,
    // `aria-disabled` is what several screen readers actually announce. A test
    // that checked only one of them would pass on the half-fix that ships a
    // control announcing itself as unavailable and then firing anyway.
    const out = html({ atMin: true })
    const minus = buttonWith(out, t('mindtree.zoomOut'))
    expect(minus).toContain('disabled=""')
    expect(minus).toContain('aria-disabled="true"')
    expect(buttonWith(out, t('mindtree.zoomIn'))).not.toContain('disabled=""')
  })

  it('marks zoom-in disabled AND aria-disabled at the maximum, and only that one', () => {
    const out = html({ atMax: true })
    const plus = buttonWith(out, t('mindtree.zoomIn'))
    expect(plus).toContain('disabled=""')
    expect(plus).toContain('aria-disabled="true"')
    expect(buttonWith(out, t('mindtree.zoomOut'))).not.toContain('disabled=""')
  })

  it('leaves Fit alive at BOTH ends, because that is when it is wanted most', () => {
    // The moment a reader most needs "show me everything" is the moment they
    // have pinched all the way in — which is exactly when `atMax` is true. Fit
    // is also not a no-op there: it is the largest move this control makes.
    for (const at of [{ atMin: true }, { atMax: true }, { atMin: true, atMax: true }]) {
      expect(buttonWith(html(at), t('mindtree.zoomFit'))).not.toContain('disabled')
    }
  })
})

/* ──────────────────────── the three controls exist ────────────────────── */

describe('the controls', () => {
  it('are three real buttons, each with an aria-label', () => {
    // `<button type="button">` and not a div with a click handler: keyboard
    // reach, Enter/Space and the disabled semantics above are all the element's,
    // not this component's. `type="button"` because a bare <button> inside a
    // form submits it, and the map's composer is a form one island away.
    const out = html()
    expect((out.match(/<button/g) ?? []).length).toBe(3)
    expect((out.match(/type="button"/g) ?? []).length).toBe(3)
    expect((out.match(/aria-label="/g) ?? []).length).toBe(4) // three + the group
  })

  it('carries the 44px primitive on every one of them', () => {
    // `.tap-44` is what makes a 32px box a 44px target. It is global.css's, so
    // a static render cannot measure it — but it CAN prove the class is asked
    // for, which is the half that gets dropped in a refactor.
    expect((html().match(/tap-44/g) ?? []).length).toBe(3)
  })

  it('hides the two glyphs from the accessibility tree', () => {
    // A `+` announced as "plus" is worse than one announced as nothing: the
    // meaning is entirely on the aria-label, and a reader hearing both gets the
    // label twice in two vocabularies.
    expect((html().match(/aria-hidden="true"/g) ?? []).length).toBe(3) // two glyphs + the staircase
  })

  it('is a group and never a toolbar', () => {
    // `role="toolbar"` claims the arrow keys, and the canvas — which owns
    // ArrowUp/ArrowDown/Home/End for its roving tabindex — is one Tab away.
    const out = html()
    expect(out).toContain('role="group"')
    expect(out).not.toContain('role="toolbar"')
  })

  it('flags itself compact so the sheet can pin it above the phone bars', () => {
    expect(html({ compact: true })).toContain('data-compact=""')
    // `undefined`, not `false` — React must drop the attribute, or
    // `[data-compact]` matches the desktop too and the plate jumps to the
    // block end at 1280px.
    expect(html({ compact: false })).not.toContain('data-compact')
  })
})

/* ─────────────── the gates on files this unit does not own ────────────── */

describe('the locale keys this control reads', () => {
  it('are SHIPPED in both bundles, not merely resolvable through the fallback', () => {
    // ⚠ THIS ASSERTION IS AGAINST THE BUNDLES AND NOT AGAINST t(), AND THE FIRST
    // DRAFT WAS AGAINST t() AND WAS WORTHLESS. lib/i18n resolves
    // `override → bundle[locale] → bundle.en → key`, so a key present in `en`
    // and DELETED from `ar` still returns a perfectly good English sentence to
    // an Arabic reader: `t(key) !== key`, the gate passes, and the plate ships
    // half-translated. Verified by deleting `zoomStepClosest` from ar/ — twenty
    // tests, all green. That fallback is deliberate (a readable sentence in the
    // wrong language beats blank space) and it is exactly what makes t() unable
    // to answer this question. The bundles are the only witness.
    const shipped = (tree: Record<string, unknown>, key: string): boolean => {
      let node: unknown = tree
      for (const part of key.split('.')) {
        if (typeof node !== 'object' || node === null) return false
        node = (node as Record<string, unknown>)[part]
      }
      return typeof node === 'string' && node.trim().length > 0
    }
    const keys = [
      'mindtree.zoomLabel',
      'mindtree.zoomOut',
      'mindtree.zoomIn',
      'mindtree.zoomFit',
      'mindtree.zoomFitShort',
      'mindtree.zoomReadout',
      'mindtree.zoomStepWhole',
      'mindtree.zoomStepWide',
      'mindtree.zoomStepMid',
      'mindtree.zoomStepClose',
      'mindtree.zoomStepClosest',
    ]
    const missing: string[] = []
    for (const [lang, tree] of [
      ['en', EN],
      ['ar', AR],
    ] as const) {
      for (const key of keys) if (!shipped(tree, key)) missing.push(`${lang}: ${key}`)
    }
    expect(missing.sort()).toEqual([])
  })

  it('interpolates all three of the readout tokens, in both languages', () => {
    // A template that dropped `{index}` would still be a real string, so the
    // gate above cannot see it — and the sentence would then say "step of 5",
    // which is a readout with the reading taken out.
    const holes: string[] = []
    for (const locale of ['en', 'ar'] as const) {
      setLocale(locale)
      const sentence = t('mindtree.zoomReadout', {
        step: t('mindtree.zoomStepMid'),
        index: 3,
        total: 5,
      })
      if (!sentence.includes(t('mindtree.zoomStepMid'))) holes.push(`${locale}: step`)
      if (!sentence.includes('3')) holes.push(`${locale}: index`)
      if (!sentence.includes('5')) holes.push(`${locale}: total`)
      if (sentence.includes('{')) holes.push(`${locale}: unfilled token`)
    }
    setLocale('en')
    expect(holes.sort()).toEqual([])
  })

  it('renders Arabic words when the language is Arabic', () => {
    // The parity gates compare trees; neither of them renders. This is the one
    // assertion that proves the component actually re-reads the bundle rather
    // than capturing English at module scope.
    setLocale('ar')
    const out = html({ progress: 0 })
    setLocale('en')
    expect(out).toContain('الخريطة كلها')
    expect(out).not.toContain('Whole map')
  })
})

describe('every class this control renders has a rule in map-zoom.css', () => {
  it('names nothing the sheet was not written against', () => {
    // A class with no rule does not render as unstyled — it renders as the
    // shared kit's defaults, which reads as styling that was never written.
    // MapBranchDetail.test.tsx's equivalent gate is what keeps them out of that
    // band; six such names shipped in the history band and had to be found by
    // hand. A glob that resolved to nothing would make every name below pass
    // vacuously, so the sheet's length is asserted first.
    expect(SHEET.length).toBeGreaterThan(500)
    const rendered = new Set(
      [
        html({ progress: 0, atMin: true }),
        html({ progress: 1, atMax: true, compact: true }),
      ]
        .join(' ')
        .match(/mzc-[a-z-]+/g) ?? [],
    )
    // The gate is worthless if the render it scans is empty.
    expect(rendered.size).toBeGreaterThan(5)
    const unstyled = [...rendered]
      .filter((name) => !new RegExp(`\\.${name}(?![a-z-])`).test(SHEET))
      .sort()
    expect(unstyled).toEqual([])
  })

  it('reads the phone bars from their published tokens rather than copying them', () => {
    // ⚠ THE ONE THING IN THE SHEET THAT ROTS SILENTLY. The composer's height is
    // MEASURED at runtime (MapCapture.tsx) and the caption strip's is too
    // (MapSummary.tsx); a pixel copy of either is correct on the day it is
    // written and wrong the first time a chip strip appears, with no test
    // anywhere going red. map-panel.css and map-altitude.css travel the same
    // three tokens for the same reason.
    for (const token of [
      '--map-composer-block-size',
      '--map-lens-rail-block-size',
      '--map-caption-block-size',
    ]) {
      expect(SHEET, token).toContain(`var(${token}`)
    }
  })

  it('switches its transitions off under prefers-reduced-motion', () => {
    // global.css clamps every transition to 0.01ms, which is enough for a fade a
    // reader triggered. It is not enough for pips that restyle on every wheel
    // notch, so this sheet removes them outright — and that block is one edit
    // away from being deleted as redundant.
    expect(SHEET).toContain('@media (prefers-reduced-motion: reduce)')
  })
})

/*
 * ── THE GUTTER GATE ────────────────────────────────────────────────────────
 *
 * ⚠ THIS PLATE AND THE DETAILS CARD CANNOT SHARE A GUTTER, and the first mount
 *   proved it: `.mzc` hung off `inset-inline-end: 12px`, `map-panel.css` floats
 *   `.mpan` off the same 12px at the same end, and the card covered the plate
 *   the moment a reader clicked an organization — which is exactly when Fit is
 *   the control they want. The bug is invisible to every other test in this
 *   file, because a static render of one component cannot see a sibling.
 *
 * So the assertion is made against BOTH SHEETS AT ONCE: whichever gutter the
 * panel floats in, this plate must be in the other one. It is a relationship,
 * not a value, so it survives someone flipping both on purpose.
 */
const PANEL_SHEET_SRC: Record<string, string> = import.meta.glob('./map-panel.css', {
  eager: true,
  query: '?raw',
  import: 'default',
})
const PANEL_SHEET = PANEL_SHEET_SRC['./map-panel.css'] ?? ''

/**
 * The `inset-inline-*` side a selector is placed on, ignoring comments.
 *
 * ⚠ IT SCANS EVERY RULE WITH THAT SELECTOR, not the first one. Both sheets
 *   declare their element twice — once unconditionally for the things that are
 *   true at any size (`display`, `gap`), and once inside a media query for the
 *   placement. Reading only the first `.mpan {` finds the flex rule, which names
 *   no side at all, and the gate then passes on `null !== 'start'` while the two
 *   islands sit on top of each other. That is how this helper failed first.
 */
const gutterOf = (sheet: string, selector: string): string | null => {
  const bare = sheet.replace(/\/\*[\s\S]*?\*\//gu, '')
  for (let at = bare.indexOf(selector); at >= 0; at = bare.indexOf(selector, at + 1)) {
    const side = /inset-inline-(start|end)\s*:/u.exec(bare.slice(at, bare.indexOf('}', at)))
    if (side) return side[1]
  }
  return null
}

describe('the plate does not sit in the details card gutter', () => {
  it('reads a side out of each sheet at all', () => {
    expect(gutterOf(SHEET, '.mzc {')).not.toBeNull()
    expect(gutterOf(PANEL_SHEET, '.mpan {')).not.toBeNull()
  })

  it('puts the plate in the OTHER gutter from the floating card', () => {
    expect(gutterOf(SHEET, '.mzc {')).not.toBe(gutterOf(PANEL_SHEET, '.mpan {'))
  })

  /*
   * The phone is exempt and must stay exempt: `[data-compact]` re-pins the plate
   * across the screen at the block end, above the bars, so it shares no gutter
   * with anything. It sets BOTH sides (`inset-inline: 8px`), which the rule
   * above would read as neither — hence a separate assertion rather than an
   * exception carved into `gutterOf`.
   */
  it('spans the width on a phone instead of picking a side', () => {
    const compact = SHEET.replace(/\/\*[\s\S]*?\*\//gu, '')
    const at = compact.indexOf('.mzc[data-compact] {')
    expect(at).toBeGreaterThan(-1)
    expect(compact.slice(at, compact.indexOf('}', at))).toMatch(/inset-inline\s*:\s*8px/u)
  })
})
