// Render proof for the activity panel — the screen `/notifications` used to be.
//
// IT RESTATES NotificationBell.test.tsx's "Notifications page" BLOCK against
// `MapChanges`, because those seven guarantees belonged to the RECORD and only
// the surface moved: day grouping by local calendar day, an unread mark a screen
// reader can hear, a nudge row with its own glyph and sentence, a disabled
// mark-all with nothing to clear, a real empty state with a way out of the
// unread filter, a retryable failure and a cold-load skeleton. Three claims are
// new: the panel is the RECORD rather than the bell's peek, a row is openable AS
// A ROW because the entry it names may have no node on the map, and the chip
// badge is the store's STORED unread count rather than a second filter.
//
// WHY renderToStaticMarkup AND NOT A DOM: `environment: 'node'`, no jsdom in the
// dependency budget. What it cannot see is claimed nowhere below. The rows are
// NotificationBell's on purpose — `notificationSentence()` is the only place
// allowed to resolve an actor — and their purity is asserted in that file.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import type { AppNotification } from '../../types'

const fx = vi.hoisted(() => {
  // lib/i18n reads localStorage at module scope and lib/theme reads matchMedia,
  // both at IMPORT time — so the shims cannot wait for a beforeAll().
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

  const DAY = 86_400_000

  const notif = (
    over: Partial<AppNotification> & Pick<AppNotification, 'id' | 'entryId'>,
  ): AppNotification => ({
    recipientId: 'me',
    kind: 'assigned',
    entryTitle: 'Firewall rule DC2',
    actorId: 'u-actor',
    actorName: '',
    readAt: null,
    createdAt: new Date().toISOString(),
    ...over,
  })

  const state: { items: AppNotification[]; unread: number; loading: boolean; error: string | null } =
    { items: [], unread: 0, loading: false, error: null }

  return { DAY, notif, state }
})

vi.mock('../../store/notifications', () => ({
  useNotifications: () => fx.state.items,
  useUnreadCount: () => fx.state.unread,
  useNotificationsLoading: () => fx.state.loading,
  useNotificationsError: () => fx.state.error,
  loadNotifications: () => Promise.resolve(),
  markNotificationsRead: () => Promise.resolve(),
  markAllNotificationsRead: () => Promise.resolve(),
}))

vi.mock('../../store/members', () => ({
  // The live profile the actor sentence resolves through — one real member, so a
  // nudge row asserts a name rather than the actor-less fallback.
  useMemberMap: () => new Map([['u-actor', { id: 'u-actor', displayName: 'Mallory Vance' }]]),
  useMembers: () => [],
  useMemberLabel: () => (): string => '',
}))

const MapChanges = (await import('./MapChanges')).default
const { useChangesCount } = await import('./MapChanges')
const { t } = await import('../../lib/i18n')

const SOURCES: Record<string, string> = import.meta.glob('./MapChanges.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
})
const SOURCE = SOURCES['./MapChanges.tsx'] ?? ''

/** React's own escaping, so an assertion can be written against a real t(). */
const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#x27;')

const countOf = (haystack: string, needle: string): number => haystack.split(needle).length - 1

const render = (el: ReactElement): string => renderToStaticMarkup(el)

const panel = (compact = false): string => render(<MapChanges compact={compact} announce={() => {}} />)

/* ═════════════════════════ the record, day by day ═════════════════════════ */

describe('MapChanges — the day-grouped record', () => {
  it('groups rows by local calendar day, newest bucket first', () => {
    const now = Date.now()
    fx.state.items = [
      fx.notif({ id: '1', entryId: 'e1', createdAt: new Date(now - 60_000).toISOString() }),
      fx.notif({ id: '2', entryId: 'e2', createdAt: new Date(now - fx.DAY).toISOString() }),
      fx.notif({ id: '3', entryId: 'e3', createdAt: new Date(now - 9 * fx.DAY).toISOString() }),
    ]
    fx.state.unread = 3
    const html = panel()
    const today = html.indexOf(esc(t('date.today')))
    const yesterday = html.indexOf(esc(t('date.yesterday')))
    const earlier = html.indexOf(esc(t('notif.earlier')))
    expect(today).toBeGreaterThan(-1)
    expect(yesterday).toBeGreaterThan(today)
    expect(earlier).toBeGreaterThan(yesterday)
  })

  it('heads each day with an h3, one level under the panel’s own heading', () => {
    // `MapPanel` names this region with an h2 and EntrySection's headings in the
    // dock are h2s; a day is a division INSIDE the panel, and skipping a level is
    // how an outline stops being navigable.
    const html = panel()
    expect(countOf(html, '<h3 class="mchg-group-head">')).toBe(3)
    expect(html).not.toContain('<h2 class="mchg-group-head">')
  })

  it('is the RECORD, not the bell’s peek: it shows every row the store holds', () => {
    // The popover caps at 8 because it is glanced at between two other tasks.
    // This panel answers "what was I asked for last week", so a cap here would be
    // the same amnesia the day grouping exists to cure.
    const now = Date.now()
    fx.state.items = Array.from({ length: 20 }, (_, i) =>
      fx.notif({ id: `n${i}`, entryId: `e${i}`, createdAt: new Date(now - i * 60_000).toISOString() }),
    )
    fx.state.unread = 20
    expect(countOf(panel(), 'class="notif-item"')).toBe(20)
    expect(SOURCE).not.toContain('slice(0,')
  })
})

/* ═════════════════════════ reading and clearing a row ═════════════════════════ */

describe('MapChanges — a row is readable and clearable as a ROW', () => {
  it('marks unread rows for a screen reader, not with colour alone', () => {
    fx.state.items = [
      fx.notif({ id: '1', entryId: 'e1' }),
      fx.notif({ id: '2', entryId: 'e2', readAt: new Date().toISOString() }),
    ]
    fx.state.unread = 1
    const html = panel()
    expect(html).toContain('data-unread="true"')
    expect(html).toContain(esc(t('notif.unreadRow')))
    // One unread row → exactly one mark-read control, and the read row keeps its
    // 44px spacer so the text column does not shift between the two.
    expect(countOf(html, `aria-label="${esc(t('notif.markRead'))}"`)).toBe(1)
    expect(html).toContain('notif-item-spacer')
  })

  it('keeps the trailing dot a SIBLING of the body, never nested inside it', () => {
    // The entire interaction for the half of notifications that are "noted,
    // thanks" — and a button inside a button is invalid HTML the browser resolves
    // by dropping one, silently taking away "open" or "mark read".
    fx.state.items = [fx.notif({ id: '1', entryId: 'e1' })]
    fx.state.unread = 1
    const html = panel()
    const main = html.indexOf('class="notif-item-main"')
    const read = html.indexOf('class="notif-item-read"')
    expect(main).toBeGreaterThan(-1)
    expect(read).toBeGreaterThan(main)
    expect(html.slice(main, read)).toContain('</button>')
  })

  it('opens the ENTRY, never a node — the item it names may not be on the map', () => {
    // A row routinely names a closed entry, or another track's, and the map draws
    // OPEN work only. `openFromNotification` → `openEntry`, which self-loads.
    expect(SOURCE).toContain('openFromNotification(item)')
    expect(SOURCE).not.toContain('focusBranch')
    expect(SOURCE).not.toContain('nodeId')
  })

  it('gives a nudge row its own glyph and its own sentence, in real markup', () => {
    fx.state.items = [fx.notif({ id: '1', entryId: 'e1', kind: 'nudged', actorId: 'u-actor' })]
    fx.state.unread = 1
    const html = panel()
    expect(html).toContain('notif-kind-nudged')
    expect(html).not.toContain('notif-kind-assigned')
    expect(html).toContain(
      esc(t('notif.nudged', { actor: 'Mallory Vance', title: 'Firewall rule DC2' })),
    )
  })
})

/* ═════════════════════════ the two panel controls ═════════════════════════ */

describe('MapChanges — mark all, and the unread filter', () => {
  it('disables mark-all when there is nothing to clear', () => {
    fx.state.items = [fx.notif({ id: '1', entryId: 'e1', readAt: new Date().toISOString() })]
    fx.state.unread = 0
    const html = panel()
    const button = html.slice(html.indexOf(esc(t('notif.markAllRead'))) - 200)
    expect(button).toContain('disabled')
  })

  it('reports a mark-all ONCE, optimistically, and never waits on the promise', () => {
    // The store's write is optimistic and raises its OWN error toast on a
    // rollback, so a success message here is corrected rather than contradicted;
    // a second report would say the same thing twice to a screen reader, because
    // the toast host is already a polite live region.
    const block = SOURCE.slice(SOURCE.indexOf('const onMarkAll = useCallback('))
    const body = block.slice(0, block.indexOf('}, [])'))
    expect(countOf(body, 'toast(')).toBe(1)
    expect(body).toContain('void markAllNotificationsRead()')
    expect(body).not.toContain('.then(')
    // The announce() channel is deliberately NOT used for this one.
    expect(body).not.toContain('announce(')
  })

  it('offers both filter chips, each carrying its own pressed state', () => {
    fx.state.items = [fx.notif({ id: '1', entryId: 'e1' })]
    fx.state.unread = 1
    const html = panel()
    expect(html).toContain(`aria-pressed="true">${esc(t('notif.showAll'))}<`)
    expect(html).toContain(`aria-pressed="false">${esc(t('notif.showUnread'))}<`)
    expect(html).toContain(esc(t('notif.unread', { count: 1 })))
  })

  it('shows a real empty state, with a way out of the unread filter', () => {
    fx.state.items = []
    fx.state.unread = 0
    const html = panel()
    expect(html).toContain(esc(t('notif.empty')))
    expect(html).toContain(esc(t('notif.emptyHint')))
    // Both chips are always offered, so an empty unread view is never a dead end
    // — and the empty state itself carries the escape when the filter is on.
    expect(html).toContain(esc(t('notif.showAll')))
    expect(html).toContain(esc(t('notif.showUnread')))
    expect(SOURCE).toContain("emptyTitle={unreadOnly ? t('notif.noUnread') : t('notif.empty')}")
  })

  it('surfaces a load failure as a retryable state, not a blank list', () => {
    fx.state.items = []
    fx.state.unread = 0
    fx.state.error = 'common.error'
    try {
      const html = panel()
      expect(html).toContain(esc(t('notif.errLoad')))
      expect(html).toContain(esc(t('common.retry')))
    } finally {
      fx.state.error = null
    }
  })

  it('shows a skeleton, not an empty state, on a cold load', () => {
    fx.state.items = []
    fx.state.loading = true
    try {
      const html = panel()
      expect(html).toContain('skeleton')
      expect(html).not.toContain(esc(t('notif.empty')))
    } finally {
      fx.state.loading = false
    }
  })
})

/* ═════════════════════════ the chip badge ═════════════════════════ */

describe('useChangesCount', () => {
  /** A probe, because a hook cannot be rendered on its own. */
  const Probe = (): ReactElement => <p>{`n=${useChangesCount()}`}</p>

  it('is the store’s STORED unread count, not a filter over the list', () => {
    // `store/notifications` keeps `unread` beside `items` so no selector runs a
    // `filter().length` on every keystroke anywhere in the app — and the shell
    // calls this hook on every render of the map.
    fx.state.items = [fx.notif({ id: '1', entryId: 'e1' })]
    fx.state.unread = 7
    expect(render(<Probe />)).toContain('n=7')
    expect(SOURCE).toContain('return useUnreadCount()')
  })

  it('does not fetch: the bell in the app shell already warms the store', () => {
    const block = SOURCE.slice(
      SOURCE.indexOf('export function useChangesCount'),
      SOURCE.indexOf('export interface MapChangesProps'),
    )
    expect(block).not.toContain('loadNotifications')
  })
})
