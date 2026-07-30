// Render proof for the offline surface — the banner strip and the outbox rows.
//
// WHY renderToStaticMarkup AND NOT A DOM. vitest.config.ts is `environment:
// 'node'` and jsdom is not in the dependency budget; Board.test.tsx,
// FollowUps.test.tsx and NotificationBell.test.tsx all open with the same
// paragraph. react-dom/server exercises the real tree and the real i18n bundle
// and hands back markup to assert on.
//
// THE ASSERTIONS THAT MATTER ARE THE FIRST TWO BLOCKS.
//
//  1. `outboxErrorMessage`. `OutboxItem.error` is an i18n KEY, and the engine's
//     own value for it — 'offline.syncFailed' — is a PLURAL NODE. The obvious
//     `t(item.error)` therefore renders "{count} changes couldn't sync." with the
//     braces visible, on a row that means something else entirely ("this op waits
//     on a temp id nothing can mint any more"). The tests below pin the
//     special case AND the general guard, because the next key to arrive here
//     will come from pgErrorKey() or from an api module, and one of those will
//     eventually take a variable too.
//  2. `outboxLabelKey` against `OUTBOX_ROUTES`. The engine exports its transport
//     table's keys precisely so a coverage assertion can be written off the
//     source; a route with no label renders as the neutral "Pending change",
//     which is exactly what a user cannot act on. The wave that registers
//     tracks/vocab transports has to add two labels, and this is what tells it.
//
// WHAT THIS FILE CANNOT SEE, and therefore claims nothing about:
//   · The OPEN sheet. Sheet renders through createPortal and react-dom/server
//     throws on portals, which is why OutboxList is exported and asserted
//     directly — the sheet adds a title, a hint line and a footer button around
//     exactly these rows.
//   · The OFFLINE branch of the banner. Connectivity is read through
//     useSyncExternalStore, and a server render is served by getServerSnapshot,
//     which answers "online" by contract (a render with no network state must not
//     claim to be offline). The offline copy is one t() call away from the
//     asserted online path.
//   · Anything behind an effect: the flush piggyback, the two flashes and their
//     timer, and the "synced vs discarded" flag all live in effects that a static
//     render never runs.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { MutOp, OutboxItem } from '../store/outbox'

const fx = vi.hoisted(() => {
  // lib/i18n reads localStorage at module scope and store/outbox reads it
  // through lib/cache at module scope too — so the shims cannot wait for a
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

  /** The queue the mocked hooks answer with. Mutated per test. */
  const state: { items: OutboxItem[] } = { items: [] }
  return { state }
})

// PARTIAL mock: the two hooks are replaced so a fixture queue can be rendered
// (zustand v5 serves a server render from `getInitialState()`, so a real
// enqueue would be invisible to react-dom/server), while OUTBOX_ROUTES and the
// types stay the genuine article — a mocked route table would make the coverage
// assertion below assert nothing.
vi.mock('../store/outbox', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store/outbox')>()
  return {
    ...actual,
    useOutbox: () => fx.state.items,
    usePendingCount: () => fx.state.items.length,
    flushOutbox: () => Promise.resolve(),
    discardOutboxItem: () => {},
  }
})

const { OUTBOX_ROUTES } = await import('../store/outbox')
const { OutboxList, outboxDetail, outboxErrorMessage, outboxLabelKey } = await import(
  './OutboxSheet'
)
const OfflineBanner = (await import('./OfflineBanner')).default
const { t } = await import('../lib/i18n')
const { FSI, PDI } = await import('../lib/bidi')

/** A locale string as it appears in the MARKUP — react-dom escapes five chars. */
const asHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')

const op = (over: Partial<MutOp> = {}): MutOp => ({
  table: 'entries',
  op: 'insert',
  id: null,
  tempId: 'temp_a',
  payload: { title: 'Firewall rule DC2' },
  dedupeKey: 'entries:insert:temp_a:title',
  dependsOn: [],
  ...over,
})

const item = (over: Partial<OutboxItem> = {}): OutboxItem => ({
  id: 'i1',
  op: op(),
  attempts: 0,
  queuedAt: Date.now(),
  error: null,
  revision: 0,
  ...over,
})

/** Two entries this client happens to hold, for the patch-with-no-text case. */
const titles: ReadonlyMap<string, { title: string }> = new Map([
  ['e-known', { title: 'Core switch firmware upgrade window' }],
])

const renderList = (items: OutboxItem[]): string =>
  renderToStaticMarkup(
    <OutboxList
      items={items}
      titles={titles}
      locale="en"
      now={new Date()}
      onDiscard={() => {}}
    />,
  )

const renderBanner = (items: OutboxItem[]): string => {
  fx.state.items = items
  return renderToStaticMarkup(<OfflineBanner />)
}

/* ─────────────────── the error-key contract ─────────────────── */

describe('outboxErrorMessage', () => {
  it('never renders an unfilled interpolation, which t(item.error) does', () => {
    // The bug this function exists for: 'offline.syncFailed' is a plural node,
    // t() with no count resolves `other`, and the row reads "{count} changes
    // couldn't sync."
    expect(t('offline.syncFailed')).toContain('{count}')
    expect(outboxErrorMessage('offline.syncFailed')).not.toContain('{')
  })

  it('says what the engine actually means by offline.syncFailed', () => {
    // Set by the drain when an op depends on a temp id no queued insert can mint
    // any more (outbox.ts). It is dead, not slow: the sentence has to point at
    // the only action left rather than promise a retry.
    expect(outboxErrorMessage('offline.syncFailed')).toBe(t('offline.itemStuck'))
  })

  it('renders a plain mapped key as its own sentence', () => {
    expect(outboxErrorMessage('common.error')).toBe(t('common.error'))
    expect(outboxErrorMessage('common.notConfigured')).toBe(t('common.notConfigured'))
  })

  it('falls back rather than printing a dot path for an unmapped key', () => {
    // t() echoes an unknown key verbatim — readable in review, unreadable in a
    // row of pending writes.
    expect(outboxErrorMessage('pg.42P01.no.such.key')).toBe(t('offline.itemFailed'))
  })

  it('falls back for ANY key that still wants a variable, not just that one', () => {
    // The general guard. 'offline.pending' is a stand-in for the next keyed
    // failure someone adds a {token} to.
    expect(outboxErrorMessage('offline.pending')).toBe(t('offline.itemFailed'))
  })

  it('is null for a row that has not failed', () => {
    expect(outboxErrorMessage(null)).toBeNull()
  })
})

/* ─────────────────── labels cover the transport table ─────────────────── */

describe('outboxLabelKey', () => {
  it('names every route the engine can actually send', () => {
    const unnamed = OUTBOX_ROUTES.filter((route) => {
      const [table, operation] = route.split(':')
      return (
        outboxLabelKey(op({ table: table as MutOp['table'], op: operation as MutOp['op'] })) ===
        'offline.opOther'
      )
    })
    expect(unnamed).toEqual([])
    // A guard against the assertion above going vacuous if the export changes.
    expect(OUTBOX_ROUTES.length).toBeGreaterThan(5)
  })

  it('falls back to a neutral label for a route with no entry', () => {
    // Reachable today: MutTable names three tables the registry deliberately
    // does not carry, and a queue restored from an older build can hold one.
    expect(outboxLabelKey(op({ table: 'vocab_options', op: 'update' }))).toBe('offline.opOther')
  })
})

/* ─────────────────── which write is this ─────────────────── */

describe('outboxDetail', () => {
  it('prefers a title, then a note body, then a meeting line', () => {
    expect(outboxDetail(op({ payload: { title: 'Renew TLS cert' } }))).toBe('Renew TLS cert')
    expect(outboxDetail(op({ payload: { body: 'Waiting on vendor' } }))).toBe('Waiting on vendor')
    expect(outboxDetail(op({ payload: { raw: '@sara due:+2d' } }))).toBe('@sara due:+2d')
  })

  it('ignores a blank or absent field rather than rendering emptiness', () => {
    expect(outboxDetail(op({ payload: { title: '   ' } }))).toBe('')
    expect(outboxDetail(op({ payload: { seq: 3 } }))).toBe('')
    expect(outboxDetail(op({ payload: null }))).toBe('')
    expect(outboxDetail(op({ payload: 'not an object' }))).toBe('')
  })

  it('names the target entry when the patch carries no text of its own', () => {
    // The commonest queued write there is: a snooze is `{ followUpDate }`, which
    // says nothing about which entry the user is about to discard.
    const patch = op({ op: 'update', id: 'e-known', tempId: null, payload: { followUpDate: null } })
    expect(outboxDetail(patch, titles)).toBe('Core switch firmware upgrade window')
  })

  it('falls back to the label alone for a target this client does not hold', () => {
    // Normal offline: the row was never fetched, so there is no title to show and
    // inventing one would be worse than the label.
    const patch = op({ op: 'update', id: 'e-unseen', tempId: null, payload: { status: 'done' } })
    expect(outboxDetail(patch, titles)).toBe('')
    // And with no lookup at all — the pure call the sheet's siblings can make.
    expect(outboxDetail(patch)).toBe('')
  })

  it('does not guess a title for a table the map is not about', () => {
    const line = op({ table: 'meeting_lines', op: 'update', id: 'e-known', payload: {} })
    expect(outboxDetail(line, titles)).toBe('')
  })
})

/* ─────────────────── the rows ─────────────────── */

describe('OutboxList', () => {
  it('names the write and shows what it is waiting for', () => {
    const html = renderList([item()])
    expect(html).toContain(asHtml(t('offline.opEntryCreate')))
    expect(html).toContain(asHtml(t('offline.itemWaiting')))
    expect(html).toContain(asHtml(t('offline.discard')))
  })

  it('isolates the payload text, whichever direction it runs', () => {
    // An Arabic title in an English UI and a Latin one in an Arabic UI both have
    // to read the way they were typed — see lib/bidi.ts.
    const html = renderList([item({ op: op({ payload: { title: 'ترقية المحوّل' } }) })])
    expect(html).toContain(`${FSI}ترقية المحوّل${PDI}`)
  })

  it('marks a failed row and renders its mapped sentence', () => {
    const html = renderList([item({ error: 'offline.syncFailed', attempts: 3 })])
    expect(html).toContain('data-failed="true"')
    expect(html).toContain(asHtml(t('offline.itemStuck')))
    expect(html).toContain(asHtml(t('offline.attempts', { count: 3 })))
    // The braces the naive rendering would have shown.
    expect(html).not.toContain('{count}')
  })

  it('leaves the attempt count off a row that has not been tried', () => {
    // Which is why offline.attempts needs no `zero` form — see the zero audit in
    // lib/plural.ts.
    expect(renderList([item({ attempts: 0 })])).not.toContain('obx-item-attempts')
  })
})

/* ─────────────────── the banner ─────────────────── */

describe('OfflineBanner', () => {
  it('keeps the live region mounted and empty when there is nothing to say', () => {
    // The region must EXIST before a message is inserted into it or a screen
    // reader announces nothing; `.offline-region:empty` collapses it visually.
    const html = renderBanner([])
    expect(html).toContain('class="offline-region"')
    expect(html).toContain('aria-live="polite"')
    expect(html).not.toContain('offline-banner')
  })

  it('surfaces the pending count — the whole point of the gap', () => {
    const html = renderBanner([item({ id: 'a' }), item({ id: 'b' })])
    expect(html).toContain(asHtml(t('offline.pending', { count: 2 })))
    expect(html).toContain('offline-banner')
  })

  it('makes the whole strip a dialog trigger, with the count out of the name', () => {
    const html = renderBanner([item()])
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).toContain('aria-expanded="false"')
    // The sr-only half of the button's accessible name says what tapping does.
    expect(html).toContain(asHtml(t('offline.openOutbox')))
  })

  it('reports a failure ahead of the count, in the failure count', () => {
    const html = renderBanner([item({ id: 'a', error: 'common.error' }), item({ id: 'b' })])
    expect(html).toContain(asHtml(t('offline.syncFailed', { count: 1 })))
    expect(html).not.toContain(asHtml(t('offline.pending', { count: 2 })))
  })

  it('does not render the sheet until it is opened', () => {
    // Sheet portals to <body>; if this ever renders here, react-dom/server
    // throws and this test is how we find out.
    expect(renderBanner([item()])).not.toContain(asHtml(t('offline.outboxHint')))
  })
})
