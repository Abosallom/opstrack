// The `?` sheet: is every shortcut listed, and is the dialog announceable.
//
// WHY renderToStaticMarkup AND NOT A DOM: the reason every sibling component
// test gives. vitest.config.ts is `environment: 'node'` and jsdom is not in the
// dependency budget.
//
// WHY createPortal IS MOCKED, AND WHY THAT IS THE WHOLE TRICK HERE. Cheatsheet
// deliberately owns no dialog of its own — it reuses components/sheet/Sheet.tsx
// so that the Escape arbitration, the Tab trap, the focus restore and the
// aria-modal wiring have exactly one implementation in the app. Sheet portals to
// <body>, and react-dom/server throws on a portal, so an open cheatsheet is
// unrenderable here unless the portal is made an identity. Mocking it is
// therefore not a way around the component — it is what lets the test assert the
// REAL Sheet's dialog semantics on top of this file's real contents. The mock is
// partial: everything else in react-dom is the genuine module, and react-dom's
// server entry point is a different specifier and is untouched.
//
// ── THE ASSERTION THAT MATTERS IS THE COVERAGE ONE ─────────────────────────
//
// Acceptance gate (d) asks that every spec shortcut "works, and is listed in the
// cheatsheet". lib/hotkeys.test.ts owns the first half — SHORTCUTS against what
// resolveHotkey() answers to, in both directions. This file owns the second: the
// rows are RENDERED FROM that same array, so the claim is that nothing in it is
// dropped on the way to the screen, and that the one shortcut with no binding at
// all — Escape, which lib/overlayStack owns for every overlay in the app — is
// listed anyway. A shortcut list that omits the way out is the list people need
// most.
//
// WHAT THIS FILE CANNOT SEE: everything Sheet does behind an effect — the focus
// move onto the surface, the overlay push, the Tab trap and the restore on
// unmount. Those are Sheet's own contract and not this component's.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'

const fx = vi.hoisted(() => {
  // lib/i18n reads localStorage at module scope and Sheet reads matchMedia
  // through useSyncExternalStore's server snapshot — neither can wait for a
  // beforeAll().
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
  g.matchMedia = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  })
  g.document = { documentElement: { dir: 'ltr', lang: 'en' } }

  /**
   * The status labels the vocabulary answers with. Deliberately NOT the English
   * defaults — migration 0003 renames labels and freezes keys, so an admin who
   * calls `blocked` "On hold" must see "On hold" here.
   */
  const labels: Record<string, string> = {
    new: 'Triage',
    in_progress: 'Working',
    blocked: 'On hold',
    done: 'Shipped',
  }
  return { labels }
})

// Identity portal — see the header. Partial, so Sheet still gets the real
// react-dom for everything else.
vi.mock('react-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom')>()
  return {
    ...actual,
    createPortal: ((children: ReactNode) => children) as unknown as typeof actual.createPortal,
  }
})

vi.mock('../store/vocab', () => ({
  useVocabLabel: () => (_kind: string, key: string) => fx.labels[key] ?? key,
}))

const { setLocale, t } = await import('../lib/i18n')
const { SHORTCUTS, STATUS_DIGITS, modLabel } = await import('../lib/hotkeys')
const Cheatsheet = (await import('./Cheatsheet')).default

/** A locale string as it appears in the MARKUP — react-dom escapes five chars. */
const asHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')

const render = (open = true): string =>
  renderToStaticMarkup(<Cheatsheet open={open} onClose={() => {}} />)

/* ───────────────────────────── the dialog shell ────────────────────────── */

describe('the cheatsheet dialog', () => {
  it('renders nothing at all until it is asked for', () => {
    expect(render(false)).toBe('')
  })

  it('is a modal dialog named by its own heading, and named ONCE', () => {
    const html = render()
    // The dialog's OWN opening tag, not the whole document: the close button
    // below carries a legitimate aria-label of its own.
    const tag = /<div[^>]*role="dialog"[^>]*>/.exec(html)?.[0] ?? ''
    expect(tag).not.toBe('')
    expect(tag).toContain('aria-modal="true"')
    // `title` alone, no `label`: Sheet names the dialog from its heading when
    // one is given, and passing both would set an aria-label beside the winning
    // aria-labelledby — two names for one dialog.
    expect(tag).toContain('aria-labelledby=')
    expect(tag).not.toContain('aria-label=')
    expect(html).toContain(asHtml(t('cmd.keysTitle')))
  })

  it('points aria-labelledby at an id that actually exists in the markup', () => {
    const html = render()
    const id = /aria-labelledby="([^"]+)"/.exec(html)?.[1]
    expect(id).toBeDefined()
    // A dangling labelledby announces the dialog as just "dialog" — the failure
    // is invisible in a screenshot and total for a screen-reader user.
    expect(html).toContain(`id="${id ?? ''}"`)
    expect(html).toMatch(new RegExp(`<h2[^>]*id="${id ?? ''}"`))
  })

  it('gives the close button a name of its own', () => {
    // The button's contents are an icon, so the accessible name has to come
    // from the aria-label Sheet sets.
    expect(render()).toContain(`aria-label="${asHtml(t('common.close'))}"`)
  })

  it('keeps the decorative handle out of the accessibility tree', () => {
    expect(render()).toContain('aria-hidden="true"')
  })
})

/* ─────────────────────── the rows come from the table ──────────────────── */

describe('the shortcut rows', () => {
  it('lists EVERY shortcut lib/hotkeys documents — acceptance gate (d)', () => {
    const html = render()
    for (const doc of SHORTCUTS) {
      expect(html).toContain(asHtml(t(doc.labelKey)))
    }
    // Guards the loop from going vacuous if the export ever empties out.
    expect(SHORTCUTS.length).toBeGreaterThan(8)
  })

  it('lists Escape, which nothing in lib/hotkeys resolves', () => {
    // lib/overlayStack owns it, for every overlay in the app at once. A
    // shortcut list that omits the way out is the list people need most.
    const escape = SHORTCUTS.find((s) => s.id === 'escape')
    expect(escape).toBeDefined()
    expect(render()).toContain(asHtml(t(escape?.labelKey ?? '')))
  })

  it('prints each key as its own <kbd>, in the order it is pressed', () => {
    const html = render()
    for (const doc of SHORTCUTS) {
      for (const key of doc.keys) {
        const printed = key === 'mod' ? modLabel() : key
        expect(html).toContain(`<kbd class="cmd-key">${asHtml(printed)}</kbd>`)
      }
    }
    // The chord reads start-to-end in both directions with no mirror rule.
    const palette = SHORTCUTS.find((s) => s.id === 'palette')
    expect(palette?.keys).toEqual(['mod', 'K'])
    expect(html).toContain(
      `<kbd class="cmd-key">${asHtml(modLabel())}</kbd><kbd class="cmd-key">K</kbd>`,
    )
  })

  it('substitutes `mod` rather than printing the token', () => {
    const html = render()
    expect(html).not.toContain('>mod<')
    expect([...'⌘Ctrl']).toContain(modLabel()[0])
  })

  it('splits the two groups under their own headings', () => {
    const html = render()
    const global = html.indexOf(asHtml(t('cmd.keysGlobal')))
    const perEntry = html.indexOf(asHtml(t('cmd.keysEntry')))
    expect(global).toBeGreaterThan(-1)
    expect(perEntry).toBeGreaterThan(global)
    // A global row must land above the entry heading and an entry row below it.
    expect(html.indexOf(asHtml(t('cmd.keyCapture')))).toBeLessThan(perEntry)
    expect(html.indexOf(asHtml(t('cmd.keyEdit')))).toBeGreaterThan(perEntry)
  })
})

/* ─────────────────────── the digits read the vocabulary ────────────────── */

describe('the status digits', () => {
  it('names each digit with the CURRENT vocabulary label, not a locale string', () => {
    const html = render()
    STATUS_DIGITS.forEach((status, i) => {
      expect(html).toContain(`<kbd class="cmd-key">${i + 1}</kbd>`)
      expect(html).toContain(asHtml(fx.labels[status] ?? ''))
    })
    // The point of reading the store: an admin renamed `blocked` and the sheet
    // must not still say "Blocked". A printed default in a locale file would go
    // stale the first time somebody renamed one.
    expect(html).not.toContain('>Blocked<')
    expect(html).not.toContain('>In progress<')
  })

  it('uses a description list, so each digit is bound to its label', () => {
    const html = render()
    expect(html).toContain('<dl class="cmd-help-statuses">')
    expect(html).toContain('<dt>')
    expect(html).toContain('class="cmd-help-status-label"')
    // Four digits, four labels — a fifth in one and not the other is the drift
    // building both from STATUS_DIGITS exists to prevent.
    expect(html.split('<dt>').length - 1).toBe(STATUS_DIGITS.length)
  })
})

/* ───────────────────────────── both languages ──────────────────────────── */

describe('in both languages', () => {
  it('resolves every string it renders', () => {
    for (const locale of ['en', 'ar'] as const) {
      setLocale(locale)
      const html = render()
      // t() echoes an unknown key, so a dot path in the markup is a missing
      // string being shown to a user.
      expect(html).not.toMatch(/>cmd\.[a-zA-Z]/)
      expect(html).not.toMatch(/>common\.[a-zA-Z]/)
      expect(html).toContain(asHtml(t('cmd.keysHint')))
      expect(html).toContain(asHtml(t('cmd.keysEntryHint')))
    }
    setLocale('en')
  })

  it('keeps the key chips Latin while the sentences mirror', () => {
    setLocale('ar')
    const html = render()
    // A chord is a sequence of presses, not a sentence: ⌘ then K is still the
    // reading order in Arabic, and the chips sit in source order.
    expect(html).toContain('<kbd class="cmd-key">J</kbd>')
    expect(html).toContain(asHtml(t('cmd.keysTitle')))
    setLocale('en')
  })
})
