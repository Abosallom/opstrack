// Render proof for /settings/export — the two cards, the relation list, and the
// contract the progress line and the download anchor are made of.
//
// WHY renderToStaticMarkup AND NOT A DOM: the reason every sibling page test
// gives. vitest.config.ts is `environment: 'node'`, there is no jsdom and no
// testing-library, and react-dom/server runs the real component, the real hooks,
// the real EXPORT_TABLES and the real translator.
//
// ── THE THREE THINGS THIS FILE IS FOR ──────────────────────────────────────
//
//  1. THE RELATION LIST IS A COVERAGE ASSERTION, not a snapshot. The JSON card
//     renders one chip per EXPORT_TABLES entry through `t('export.table.' +
//     key)`, a TEMPLATE key that lib/localeReach.test.ts explicitly cannot see
//     ("a template literal has no key until it runs"). So the wave that adds a
//     tenth relation to lib/export.ts adds it to the file, to this page's chips
//     and to the progress line — and ships a chip reading
//     `export.table.audit_log` in both languages unless something checks. This
//     does, in both directions: a relation with no label fails, and a label with
//     no relation behind it fails too.
//  2. THE `configured` BRANCH. A build with no Supabase credentials must not
//     offer two buttons that can only fail; both are disabled and the page says
//     why. That branch is reachable from a server render because it is a
//     function of a module, not of state.
//  3. THE STRINGS BEHIND THE STATE MACHINE. `PageState` has five arms and four
//     of them need a tap to reach, so the progress card, the result card, the
//     truncation warning and the failure card are OUT OF REACH here and claimed
//     about nowhere below. Their SENTENCES are not out of reach, and a missing
//     key or a mismatched placeholder is the failure that actually reaches a
//     user — `export.rowsSoFar` is a plural node, and rendering it with no count
//     puts "{count} rows so far" on screen. Their interactive proof is a browser
//     pass under docs/EVIDENCE.
//
// WHAT ELSE THIS FILE CANNOT SEE: the download itself. `download()` is a private
// helper that builds an anchor, and a node environment has no `document` to
// build one in. What it hands that anchor is `exportFilename()` and
// `exportMimeType()`, and the last block asserts the property those two owe the
// `download` attribute — a name that survives a Windows share.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

const fx = vi.hoisted(() => {
  // lib/i18n reads localStorage at module scope, and the page's stores are
  // mocked but lib/labels still resolves the locale — so the shims cannot wait
  // for a beforeAll().
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
  g.location = { search: '', href: 'http://localhost/' }
  g.matchMedia = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  })
  g.document = { documentElement: { dir: 'ltr', lang: 'en' } }

  const state = { configured: true }
  return { state }
})

vi.mock('../../api/supabase', () => ({
  isConfigured: () => fx.state.configured,
  supabase: null,
}))

vi.mock('../../store/config', () => ({
  loadConfig: () => Promise.resolve(),
  useTrackMap: () => new Map(),
}))

vi.mock('../../store/members', () => ({
  loadMembers: () => Promise.resolve(),
  useMemberMap: () => new Map(),
}))

vi.mock('../../components/toast', () => ({ toast: () => {} }))

const { EXPORT_TABLES, exportFilename, exportMimeType } = await import('../../lib/export')
const { setLocale, t } = await import('../../lib/i18n')
const { en } = await import('../../locales')
const Export = (await import('./Export')).default

/** A locale string as it appears in the MARKUP — react-dom escapes five chars. */
const asHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')

const render = (configured = true): string => {
  fx.state.configured = configured
  return renderToStaticMarkup(
    <MemoryRouter>
      <Export />
    </MemoryRouter>,
  )
}

/* ──────────────────────────── the two cards ────────────────────────────── */

describe('the page as it first appears', () => {
  it('offers a way back — this screen is in neither nav', () => {
    const html = render()
    expect(html).toContain('href="/settings"')
    expect(html).toContain(asHtml(t('common.back')))
  })

  it('carries no heading of its own', () => {
    // App.tsx's header already renders export.title as the document heading.
    expect(render()).not.toContain('<h1')
  })

  it('names each card from its own heading rather than a stray label', () => {
    const html = render()
    for (const id of ['exp-json-h', 'exp-csv-h']) {
      expect(html).toContain(`aria-labelledby="${id}"`)
      // The id has to EXIST, and on the heading: a dangling labelledby leaves
      // the section unnamed and the failure is invisible in a screenshot.
      expect(html).toMatch(new RegExp(`<h2[^>]*id="${id}"`))
    }
    expect(html).toContain(asHtml(t('export.jsonTitle')))
    expect(html).toContain(asHtml(t('export.csvTitle')))
  })

  it('leads with what the file contains and how fresh it is', () => {
    const html = render()
    expect(html).toContain(asHtml(t('export.subtitle')))
    expect(html).toContain(asHtml(t('export.scope')))
    expect(html).toContain(asHtml(t('export.fresh')))
    expect(html).toContain(asHtml(t('export.csvCaveats')))
  })

  it('renders neither result card before anything has been asked for', () => {
    const html = render()
    expect(html).not.toContain('exp-progress')
    expect(html).not.toContain('exp-result')
    expect(html).not.toContain('exp-error')
  })
})

/* ────────────────────── the relation list is a coverage gate ───────────── */

describe('the JSON card lists the relations it will carry', () => {
  it('renders one chip per EXPORT_TABLES entry, and no others', () => {
    const html = render()
    const chips = [...html.matchAll(/<li class="chip">([^<]*)<\/li>/g)].map((m) => m[1] ?? '')
    expect(chips).toEqual(EXPORT_TABLES.map((spec) => asHtml(t(`export.table.${spec.key}`))))
    // Guards the assertion from going vacuous if the registry ever empties out.
    expect(EXPORT_TABLES.length).toBeGreaterThan(5)
  })

  it('labels every relation in both languages — the template key no scan sees', () => {
    for (const locale of ['en', 'ar'] as const) {
      setLocale(locale)
      for (const spec of EXPORT_TABLES) {
        const key = `export.table.${spec.key}`
        // t() echoes an unknown key, so a chip equal to its own key is a
        // missing label rendering a dot path at the user.
        expect(t(key)).not.toBe(key)
        expect(t(key).trim()).not.toBe('')
      }
    }
    setLocale('en')
  })

  it('carries no label for a relation the export does not read', () => {
    // The other direction: a `export.table.*` entry left behind by a relation
    // that was removed is dead weight, and the next reader cannot tell it from
    // a chip that failed to render.
    const exportNs = (en as { export?: { table?: Record<string, unknown> } }).export
    const labelled = Object.keys(exportNs?.table ?? {})
    expect(labelled.sort()).toEqual(EXPORT_TABLES.map((s) => s.key).sort())
  })
})

/* ──────────────────────────── the two buttons ──────────────────────────── */

describe('the buttons', () => {
  it('offers both formats when the app has credentials', () => {
    const html = render(true)
    expect(html).toContain(asHtml(t('export.jsonAction')))
    expect(html).toContain(asHtml(t('export.csvAction')))
    expect(html).not.toContain('disabled=""')
    expect(html).not.toContain(asHtml(t('common.notConfigured')))
  })

  it('disables both and says why in a build with no Supabase project', () => {
    const html = render(false)
    // Two buttons that can only fail are worse than a sentence explaining it.
    expect(html.match(/disabled=""/g)?.length).toBe(2)
    expect(html).toContain(asHtml(t('common.notConfigured')))
    expect(html).toContain('role="status"')
  })

  it('shows the action label, not the busy label, at rest', () => {
    const html = render()
    expect(html).not.toContain(asHtml(t('export.preparing')))
  })
})

/* ─────────────── the progress line, at the level node can reach ────────── */

describe('the progress sentences', () => {
  it('names every relation it can be reading, in both languages', () => {
    // The exact call the progress line makes:
    // t('export.reading', { label: t(`export.table.${state.progress.table}`) }).
    for (const locale of ['en', 'ar'] as const) {
      setLocale(locale)
      for (const spec of EXPORT_TABLES) {
        const line = t('export.reading', { label: t(`export.table.${spec.key}`) })
        expect(line).not.toMatch(/\{[a-zA-Z]+\}/)
        expect(line).toContain(t(`export.table.${spec.key}`))
      }
    }
    setLocale('en')
  })

  it('counts rows through a plural node with no braces left, in every CLDR form', () => {
    // Arabic selects six forms and English two. `export.rowsSoFar` is a plural
    // node, so the naive `t(key)` with no count resolves `other` and prints
    // "{count} rows so far" — the bug OutboxSheet.test.tsx pins for its own.
    for (const locale of ['en', 'ar'] as const) {
      setLocale(locale)
      for (const count of [0, 1, 2, 3, 11, 100, 1000]) {
        const line = t('export.rowsSoFar', { count })
        expect(line).not.toContain('{count}')
        expect(line.trim()).not.toBe('')
      }
    }
    setLocale('en')
  })

  it('has a sentence for each arm of the state machine a tap can reach', () => {
    const behindATap: readonly [string, Record<string, string | number>][] = [
      ['export.preparing', {}],
      ['export.done', { count: 3 }],
      ['export.downloaded', { name: 'opstrack-export-2026-07-30-1432.json' }],
      ['export.truncatedTitle', {}],
      ['export.truncatedBody', { list: 'Entries' }],
      ['export.noEntries', {}],
      ['export.failed', {}],
      ['common.retry', {}],
    ]
    for (const locale of ['en', 'ar'] as const) {
      setLocale(locale)
      for (const [key, vars] of behindATap) {
        expect(t(key, vars)).not.toBe(key)
        expect(t(key, vars)).not.toMatch(/\{[a-zA-Z]+\}/)
      }
    }
    setLocale('en')
  })
})

/* ─────────────────────── what the anchor is handed ─────────────────────── */

describe('the download attributes', () => {
  const at = new Date(2026, 6, 30, 14, 32)

  it('names the file after the format the button asked for', () => {
    expect(exportFilename('json', at).endsWith('.json')).toBe(true)
    expect(exportFilename('csv', at).endsWith('.csv')).toBe(true)
    expect(exportMimeType('json')).toContain('application/json')
    expect(exportMimeType('csv')).toContain('text/csv')
  })

  it('produces a name that survives the trip off this machine', () => {
    for (const kind of ['json', 'csv'] as const) {
      const name = exportFilename(kind, at)
      // The `download` attribute is a filename, not a path: a separator would
      // be stripped or rejected, and a quote or a newline would break the
      // attribute it sits in. Colons and spaces are legal on macOS and neither
      // survives a Windows share.
      expect(name).not.toMatch(/[/\\:"'\n\r]/)
      expect(name).not.toContain(' ')
      expect(name.length).toBeLessThan(64)
    }
  })

  it('states the charset on both, so the CSV is not decoded twice', () => {
    // The BOM already says UTF-8; a Content-Type that disagrees with it is how
    // a file ends up mojibake in Excel.
    expect(exportMimeType('json')).toContain('charset=utf-8')
    expect(exportMimeType('csv')).toContain('charset=utf-8')
  })

  it('is announced with the same name it was saved under', () => {
    // The toast and the result card both render export.downloaded with the
    // filename the anchor carried — one string, one fact.
    const name = exportFilename('json', at)
    expect(t('export.downloaded', { name })).toContain(name)
  })
})

/* ────────────────────────── nothing unresolved ─────────────────────────── */

describe('in both languages', () => {
  it('renders no dot path and no unfilled brace', () => {
    for (const locale of ['en', 'ar'] as const) {
      setLocale(locale)
      for (const configured of [true, false]) {
        const html = render(configured)
        expect(html).not.toMatch(/>export\.[a-zA-Z]/)
        expect(html).not.toMatch(/>common\.[a-zA-Z]/)
        expect(html).not.toMatch(/\{[a-zA-Z]+\}/)
      }
    }
    setLocale('en')
  })
})
