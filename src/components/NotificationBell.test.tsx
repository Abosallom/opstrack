// Render proof for the notification centre — the bell, the row, and the page.
//
// WHY renderToStaticMarkup AND NOT A DOM. vitest.config.ts is `environment:
// 'node'` and jsdom is not in the dependency budget; Board.test.tsx,
// FollowUps.test.tsx and the entry kit's test all open with the same paragraph.
// react-dom/server exercises the real tree, the real i18n bundle and the real
// actor resolution, and hands back markup to assert on.
//
// THE ASSERTION THAT MATTERS IS THE FIRST BLOCK. `actor_name` is a
// trigger-written snapshot on a table whose actors can rename themselves
// (api/notifications.ts's header; a fixed Wave-1 finding), so the contract is
// that the CURRENT display name from store/members wins and the snapshot is
// only ever a fallback for a deleted profile. `notificationSentence()` is pure
// and takes the member map as an argument precisely so that contract can be
// asserted here without a store, and the test asserts the negative too — that
// the forged name is nowhere in the output.
//
// WHAT THIS FILE CANNOT SEE, and therefore claims nothing about: anything
// behind a state change or an effect. The popover is closed on first render, so
// the peek's contents, the outside-click dismissal, the arrival animation and
// the minute tick are all out of reach of a static render. The list body they
// reveal is the same <NotificationBody> the page renders below, which is what
// makes covering the page enough for the row itself.
//
// BOTH SURFACES LIVE IN ONE TEST FILE because they share one fixture and one
// mocked store; splitting them would duplicate the harness to assert the same
// rows twice.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Member } from '../api/members'
import type { AppNotification } from '../types'

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

  const members: Member[] = [
    { id: 'u-actor', displayName: 'Mallory Vance' } as Member,
    { id: 'u-blank', displayName: '   ' } as Member,
  ]

  return { DAY, notif, state, members }
})

vi.mock('../store/notifications', () => ({
  useNotifications: () => fx.state.items,
  useUnreadCount: () => fx.state.unread,
  useNotificationsLoading: () => fx.state.loading,
  useNotificationsError: () => fx.state.error,
  loadNotifications: () => Promise.resolve(),
  markNotificationsRead: () => Promise.resolve(),
  markAllNotificationsRead: () => Promise.resolve(),
}))

vi.mock('../store/members', () => ({
  useMemberMap: () => new Map(fx.members.map((m) => [m.id, m])),
}))

vi.mock('../store/entrySheet', () => ({
  openEntry: () => {},
}))

const { MemoryRouter } = await import('react-router-dom')
const { notificationSentence } = await import('./NotificationBell')
const NotificationBell = (await import('./NotificationBell')).default
const NotificationsPage = (await import('../pages/Notifications')).default
const { t } = await import('../lib/i18n')

const map = (members: Member[]): ReadonlyMap<string, Member> =>
  new Map(members.map((m) => [m.id, m]))

/**
 * A locale string as it appears in the MARKUP.
 *
 * react-dom/server escapes the five XML-significant characters, and half the
 * English copy here contains an apostrophe ("You're all caught up"), which
 * comes back as `&#x27;`. Asserting against the raw bundle string would fail on
 * exactly the sentences worth checking, and hardcoding the escaped form in the
 * test would stop it tracking the bundle.
 */
const asHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')

const renderBell = (): string =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={['/board']}>
      <NotificationBell />
    </MemoryRouter>,
  )

const renderPage = (): string =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={['/notifications']}>
      <NotificationsPage />
    </MemoryRouter>,
  )

/* ─────────────────── the actor-resolution contract ─────────────────── */

describe('notificationSentence', () => {
  it('renders the CURRENT display name, never the stored actor_name snapshot', () => {
    // The forgery this exists to stop: the snapshot says one thing, the profile
    // says another, and the profile is the durable identity.
    const line = notificationSentence(
      map(fx.members),
      fx.notif({ id: '1', entryId: 'e1', actorId: 'u-actor', actorName: 'Aziz (Admin)' }),
    )
    expect(line).toContain('Mallory Vance')
    expect(line).not.toContain('Aziz')
  })

  it('falls back to the snapshot only when the profile is gone', () => {
    // actor_id is `on delete set null`, so this case is real, not theoretical.
    const line = notificationSentence(
      map(fx.members),
      fx.notif({ id: '2', entryId: 'e1', actorId: null, actorName: 'Former colleague' }),
    )
    expect(line).toContain('Former colleague')
  })

  it('falls back to the snapshot for an actor_id with no row in the map', () => {
    const line = notificationSentence(
      map(fx.members),
      fx.notif({ id: '3', entryId: 'e1', actorId: 'u-vanished', actorName: 'Nadia' }),
    )
    expect(line).toContain('Nadia')
  })

  it('treats a blank display name as absent rather than as a name-shaped hole', () => {
    const line = notificationSentence(
      map(fx.members),
      fx.notif({ id: '4', entryId: 'e1', actorId: 'u-blank', actorName: 'Snapshot Name' }),
    )
    expect(line).toContain('Snapshot Name')
  })

  it('uses the actor-less sentence when there is no name at all', () => {
    const line = notificationSentence(
      map(fx.members),
      fx.notif({ id: '5', entryId: 'e1', actorId: null, actorName: '' }),
    )
    expect(line).toContain('Firewall rule DC2')
    // The assigned sentence with an actor is "{actor} assigned you …"; the
    // actor-less one is a different sentence, not the same one with a hole.
    expect(line).not.toContain('{actor}')
    expect(line).toBe(t('notif.assignedNoActor', { title: 'Firewall rule DC2' }))
  })

  it('substitutes a label for the blank title the trigger writes', () => {
    const line = notificationSentence(
      map(fx.members),
      fx.notif({ id: '6', entryId: 'e1', entryTitle: '', actorId: null, actorName: 'Nadia' }),
    )
    expect(line).toContain(t('notif.untitled'))
  })

  it('uses the completed sentence for a completed row', () => {
    const line = notificationSentence(
      map(fx.members),
      fx.notif({ id: '7', entryId: 'e1', kind: 'completed', actorId: 'u-actor' }),
    )
    expect(line).toBe(t('notif.completed', { actor: 'Mallory Vance', title: 'Firewall rule DC2' }))
  })
})

/* ─────────────────────────────── the bell ───────────────────────────── */

describe('NotificationBell', () => {
  it('renders a labelled, collapsed trigger and no badge at zero unread', () => {
    fx.state.items = []
    fx.state.unread = 0
    const html = renderBell()
    expect(html).toContain(`aria-label="${asHtml(t('notif.openInbox'))}"`)
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('notif-badge')
  })

  it('badges the count and puts it in the accessible name', () => {
    fx.state.items = [fx.notif({ id: '1', entryId: 'e1' })]
    fx.state.unread = 3
    const html = renderBell()
    expect(html).toContain('notif-badge')
    expect(html).toContain(asHtml(t('notif.unread', { count: 3 })))
  })

  it('caps the badge rather than letting a wide number deform the header', () => {
    fx.state.unread = 250
    expect(renderBell()).toContain('99+')
  })
})

/* ─────────────────────────────── the page ───────────────────────────── */

describe('Notifications page', () => {
  it('groups rows by local calendar day, newest bucket first', () => {
    const now = Date.now()
    fx.state.items = [
      fx.notif({ id: '1', entryId: 'e1', createdAt: new Date(now - 60_000).toISOString() }),
      fx.notif({ id: '2', entryId: 'e2', createdAt: new Date(now - fx.DAY).toISOString() }),
      fx.notif({ id: '3', entryId: 'e3', createdAt: new Date(now - 9 * fx.DAY).toISOString() }),
    ]
    fx.state.unread = 3
    const html = renderPage()
    const today = html.indexOf(asHtml(t('date.today')))
    const yesterday = html.indexOf(asHtml(t('date.yesterday')))
    const earlier = html.indexOf(asHtml(t('notif.earlier')))
    expect(today).toBeGreaterThan(-1)
    expect(yesterday).toBeGreaterThan(today)
    expect(earlier).toBeGreaterThan(yesterday)
  })

  it('marks unread rows for a screen reader, not with colour alone', () => {
    fx.state.items = [
      fx.notif({ id: '1', entryId: 'e1' }),
      fx.notif({ id: '2', entryId: 'e2', readAt: new Date().toISOString() }),
    ]
    fx.state.unread = 1
    const html = renderPage()
    expect(html).toContain('data-unread="true"')
    expect(html).toContain(asHtml(t('notif.unreadRow')))
    // One unread row → exactly one mark-read control, and the read row keeps
    // its 44px spacer so the text column does not shift between the two.
    expect(html.split(`aria-label="${asHtml(t('notif.markRead'))}"`).length - 1).toBe(1)
    expect(html).toContain('notif-item-spacer')
  })

  it('disables mark-all when there is nothing to clear', () => {
    fx.state.items = [fx.notif({ id: '1', entryId: 'e1', readAt: new Date().toISOString() })]
    fx.state.unread = 0
    const html = renderPage()
    const button = html.slice(html.indexOf(asHtml(t('notif.markAllRead'))) - 200)
    expect(button).toContain('disabled')
  })

  it('shows a real empty state, with a way out of the unread filter', () => {
    fx.state.items = []
    fx.state.unread = 0
    const html = renderPage()
    expect(html).toContain(asHtml(t('notif.empty')))
    expect(html).toContain(asHtml(t('notif.emptyHint')))
    // Both filter chips are always offered, so an empty unread view is never a
    // dead end.
    expect(html).toContain(asHtml(t('notif.showAll')))
    expect(html).toContain(asHtml(t('notif.showUnread')))
  })

  it('surfaces a load failure as a retryable state, not a blank list', () => {
    fx.state.items = []
    fx.state.unread = 0
    fx.state.error = 'common.error'
    const html = renderPage()
    expect(html).toContain(asHtml(t('notif.errLoad')))
    expect(html).toContain(asHtml(t('common.retry')))
    fx.state.error = null
  })

  it('shows a skeleton, not an empty state, on a cold load', () => {
    fx.state.items = []
    fx.state.loading = true
    const html = renderPage()
    expect(html).toContain('skeleton')
    expect(html).not.toContain(asHtml(t('notif.empty')))
    fx.state.loading = false
  })
})
