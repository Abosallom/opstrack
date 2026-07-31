// Render proof for the file section of Settings › Terminology.
//
// WHY renderToStaticMarkup AND NOT A DOM: the reason every sibling page test
// gives. vitest.config.ts is `environment: 'node'`, there is no jsdom and no
// testing-library, and react-dom/server runs the real component, the real hooks
// and the real translator.
//
// ── THE THREE THINGS THIS FILE IS FOR ──────────────────────────────────────
//
//  1. THE SECTION BOOTS. It is mounted by a screen that is 1,665 rows long, and
//     a component that throws on first render takes that whole screen with it.
//     lib/labelIO.test.ts covers everything the module decides; nothing there
//     would notice a missing import or a hook called in the wrong order.
//  2. THE FILE PICKER IS A REAL INPUT INSIDE A REAL LABEL. That is the whole
//     accessibility story of this section — the label is the input's name, the
//     input keeps its place in the tab order because it is CLIPPED rather than
//     display:none, and the ring is painted on the label through :focus-within.
//     Every part of that is a property of the MARKUP, so this is where it can be
//     asserted; a screenshot could not tell the difference.
//  3. THE SENTENCES THE STATE MACHINE CANNOT REACH FROM HERE. Reading a file,
//     the rejection report and the confirmation all need a pointer, so they are
//     out of reach of a server render — but their STRINGS are not, and a missing
//     key or a plural node whose `{count}` never made it into one language is
//     the failure that actually reaches a person. Their interactive proof is a
//     browser pass; their wording is proved here, in both languages.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const fx = vi.hoisted(() => {
  // lib/i18n reads localStorage at module scope and store/labels reads its cache
  // there too, so the shims cannot wait for a beforeAll(). Same harness as
  // pages/settings/Export.test.tsx.
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
  g.document = { documentElement: { dir: 'ltr', lang: 'en' } }

  /** How many overrides the store is holding for this render. */
  const state = { count: 0 }
  return { state }
})

vi.mock('../../store/labels', () => ({
  useLabelOverrides: () => [],
  useLabelOverrideCount: () => fx.state.count,
  importOverrides: () => Promise.resolve({ ok: true, data: 0 }),
  invalidateLabels: () => {},
}))

vi.mock('../toast', () => ({ toast: () => {} }))
vi.mock('../Confirm', () => ({ confirm: () => Promise.resolve(false) }))

const { default: LabelIO } = await import('./LabelIO')
const { setLocale, t } = await import('../../lib/i18n')

function render(props: { disabled?: boolean } = {}): string {
  return renderToStaticMarkup(<LabelIO {...props} />)
}

describe('the section', () => {
  it('renders its own heading and the two things you can do', () => {
    const html = render()
    expect(html).toContain(t('terminology.ioTitle'))
    expect(html).toContain(t('terminology.ioHint'))
    expect(html).toContain(t('terminology.exportAction'))
    expect(html).toContain(t('terminology.importAction'))
  })

  it('offers no download when there is nothing to download, and says why', () => {
    fx.state.count = 0
    const html = render()
    expect(html).toContain(t('terminology.exportEmpty'))
    // Counted rather than matched against the button's English, so a reworded
    // label — which this very feature exists to allow — does not fail the test.
    // One disabled control: the download. The picker stays live.
    expect(html.match(/disabled=""/g)?.length).toBe(1)
  })

  it('offers the download once something has been renamed', () => {
    fx.state.count = 3
    const html = render()
    expect(html).not.toContain(t('terminology.exportEmpty'))
    expect(html).not.toMatch(/disabled=""/)
    expect(html).toContain(t('terminology.exportAction'))
    fx.state.count = 0
  })

  it('turns both controls off when the page says the feature is unavailable', () => {
    fx.state.count = 3
    const html = render({ disabled: true })
    expect(html).toContain('aria-disabled="true"')
    expect(html.match(/disabled=""/g)?.length).toBe(2)
    fx.state.count = 0
  })

  it('gives the file input a real label, and keeps it in the tab order', () => {
    const html = render()
    // Inside the label, not beside it: the label IS the accessible name.
    expect(html).toMatch(/<label class="btn lio-pick"[^>]*>.*<input[^>]*type="file"/s)
    // Clipped, never display:none — .sr-only is focusable and hidden is not.
    expect(html).toMatch(/<input class="sr-only"/)
    expect(html).toContain('accept="application/json,.json"')
  })

  it('leaves the report region empty until a file is picked', () => {
    // `.lio-report:empty` collapses it; an empty region that still took a 12px
    // gap would leave a hole under the buttons on first paint.
    const html = render()
    expect(html).toContain('class="lio-report"')
    expect(html).toContain('aria-live="polite"')
    expect(html).not.toContain('lio-rejects')
  })
})

describe('the sentences a pointer would reach', () => {
  // Rendered through the REAL translator in BOTH languages, because a plural
  // node that lost its `{count}` on one side reads as a confident sentence with
  // the number missing — and the number is the entire content of these.
  const COUNTED = [
    'terminology.importPreview',
    'terminology.importSkipped',
    'terminology.importDone',
    'terminology.importConfirmBody',
    'terminology.importRejected',
    'terminology.importRejectedMore',
  ]

  for (const locale of ['en', 'ar'] as const) {
    it(`carry their number in ${locale}`, () => {
      setLocale(locale)
      try {
        for (const key of COUNTED) {
          for (const count of [1, 2, 7, 43]) {
            const value = t(key, { count })
            expect(value, `${key} @ ${count}`).not.toBe(key)
            expect(value, `${key} @ ${count}`).not.toContain('{count}')
            // 1 and 2 have their own forms in both languages and spell the
            // number out ("One label changes", "تسميتان"); 7 and 43 cannot.
            if (count > 2) expect(value, `${key} @ ${count}`).toContain(String(count))
          }
        }
      } finally {
        setLocale('en')
      }
    })
  }

  it('say something in both languages for every fixed string this section uses', () => {
    const KEYS = [
      'terminology.ioTitle',
      'terminology.ioHint',
      'terminology.exportAction',
      'terminology.exportEmpty',
      'terminology.exportDone',
      'terminology.errExport',
      'terminology.importAction',
      'terminology.importApply',
      'terminology.importApplying',
      'terminology.importConfirmTitle',
      'terminology.importNoChange',
      'terminology.errImport',
      'terminology.errImportParse',
      'terminology.errImportShape',
      'terminology.fieldEn',
      'terminology.fieldAr',
      'terminology.loading',
      'common.cancel',
    ]
    for (const locale of ['en', 'ar'] as const) {
      setLocale(locale)
      for (const key of KEYS) expect(t(key), `${key} in ${locale}`).not.toBe(key)
    }
    setLocale('en')
  })
})
