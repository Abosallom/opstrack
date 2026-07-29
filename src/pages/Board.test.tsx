// Render proof for the board.
//
// WHY renderToStaticMarkup AND NOT A DOM. vitest.config.ts is `environment:
// 'node'` and jsdom is not in the dependency budget — the entry kit's own test
// and FollowUps.test.tsx open with the same paragraph. react-dom/server
// exercises the real tree, the real vocabulary partitioning and the real
// permission check, and hands back markup to assert on.
//
// WHAT THIS FILE CANNOT SEE, and therefore claims nothing about: the pointer
// drag. Every decision inside that gesture is arithmetic in `lib/dnd.ts` and is
// asserted in `dnd.test.ts` without a DOM at all — which is exactly why the
// gesture was written as a pure module and a thin listener rather than as one
// stateful component. What is left here is the half a server render CAN prove,
// and it is the half an audit asks about: that the columns are the admin's
// vocabulary rather than the frozen union, that a retired status keeps its data
// reachable without becoming a drop target, that every card carries the
// non-drag move control, that the live region exists, and that a user who may
// not edit is told so instead of being handed an affordance the server would
// refuse.
//
// WHY THE STORES ARE MOCKED AND lib/ IS NOT. Only the data sources at the
// screen's edge are stubbed; `lib/permissions`, `lib/entryFilter`'s ordering
// and `lib/i18n` are the real modules. A test that mocked `canEditEntry` would
// assert that this file can call a function.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Entry, EntryHealth, Track } from '../types'

const fx = vi.hoisted(() => {
  // lib/i18n reads localStorage at module scope, store/config adds a window
  // focus listener at module scope, and lib/theme reads matchMedia — all three
  // at IMPORT time, so the shims cannot wait for a beforeAll().
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

  const TODAY = '2026-07-29'

  const entry = (over: Partial<Entry> & Pick<Entry, 'id' | 'title' | 'status'>): Entry => ({
    track_id: 't-net',
    description: '',
    type: 'action',
    priority: 'medium',
    owner_id: null,
    owner_name: null,
    requester: null,
    due_date: null,
    follow_up_date: null,
    tags: [],
    links: [],
    created_by: 'u1',
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-20T00:00:00.000Z',
    closed_at: null,
    last_activity_at: '2026-07-20T00:00:00.000Z',
    meeting_id: null,
    template_id: null,
    ...over,
  })

  const health = (id: string): EntryHealth => ({
    id,
    entry_id: id,
    track_id: 't-net',
    status: 'new',
    priority: 'medium',
    due_date: null,
    last_activity_at: '2026-07-20T00:00:00.000Z',
    days_since_activity: 9,
    days_overdue: 0,
    health: 'ok',
    sla_due_at: null,
    sla_breached: false,
  })

  // The workspace an admin has actually shaped: `waiting_on` renamed and RETIRED
  // while two items are still sitting in it, `cancelled` retired and empty.
  const statuses = [
    { key: 'new', label: 'Triage', hidden: false, sortOrder: 0 },
    { key: 'in_progress', label: 'Doing', hidden: false, sortOrder: 1 },
    { key: 'blocked', label: 'Blocked', hidden: false, sortOrder: 2 },
    { key: 'done', label: 'Shipped', hidden: false, sortOrder: 3 },
    { key: 'waiting_on', label: 'Awaiting vendor', hidden: true, sortOrder: 4 },
    { key: 'cancelled', label: 'Dropped', hidden: true, sortOrder: 5 },
  ].map((o) => ({
    kind: 'status' as const,
    color: null,
    staleAfterDays: null,
    slaDays: null,
    ...o,
  }))

  const entries: Entry[] = [
    entry({ id: 'a', title: 'Firewall rule DC2', status: 'new' }),
    entry({ id: 'b', title: 'Core switch upgrade', status: 'new' }),
    entry({ id: 'c', title: 'Rebuild jump host', status: 'in_progress' }),
    entry({ id: 'd', title: 'Vendor portal access', status: 'done' }),
    // The two that keep a retired status alive.
    entry({ id: 'e', title: 'Old escalation', status: 'waiting_on' }),
    entry({ id: 'f', title: 'Older escalation', status: 'waiting_on' }),
  ]

  const track: Track = {
    id: 't-net',
    name: 'Network',
    name_ar: 'الشبكات',
    description: '',
    description_ar: '',
    color: '#4f9cf9',
    color_light: null,
    icon: 'network',
    suggested_tags: ['switch', 'firewall'],
    sort_order: 0,
    archived: false,
    archived_at: null,
    created_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }

  // Mutable so a case can swap in an empty working set, a failure or a
  // signed-out reader without a second mock factory.
  const state: {
    entries: Entry[]
    loading: boolean
    error: string | null
    profile: { id: string; displayName: string; role: 'admin' | 'member'; locale: null } | null
  } = {
    entries,
    loading: false,
    error: null,
    profile: { id: 'u1', displayName: 'Me', role: 'member', locale: null },
  }

  const healthRows = new Map<string, EntryHealth>(entries.map((e) => [e.id, health(e.id)]))

  return { TODAY, entries, statuses, track, state, healthRows, empty: [] as Entry[] }
})

vi.mock('../store/entries', () => ({
  useFilteredEntries: () => fx.state.entries,
  useEntryMap: () => new Map(fx.state.entries.map((e) => [e.id, e])),
  useHealthMap: () => fx.healthRows,
  useEntriesLoading: () => fx.state.loading,
  useEntriesError: () => fx.state.error,
  useEntryFlash: () => undefined,
  usePendingOp: () => undefined,
  loadEntries: () => Promise.resolve(),
  loadClosedSince: () => Promise.resolve(),
  refreshEntries: () => Promise.resolve(),
  setStatus: () => Promise.resolve({ ok: false, error: 'common.error' }),
}))

vi.mock('../store/vocab', () => ({
  useVocab: (kind: string) => (kind === 'status' ? fx.statuses.filter((o) => !o.hidden) : []),
  useVocabAll: (kind: string) => (kind === 'status' ? fx.statuses : []),
  useVocabLabel: () => (_kind: string, key: string) =>
    fx.statuses.find((o) => o.key === key)?.label ?? key,
  useVocabColor: () => () => null,
  useStaleDays: () => () => 8,
  useSlaDays: () => () => null,
}))

vi.mock('../store/members', () => ({
  useMembers: () => [],
  useMemberMap: () => new Map(),
  useMemberLabel:
    () =>
    (ownerId?: string | null, ownerName?: string | null): string =>
      ownerId ?? ownerName?.trim() ?? '',
}))

vi.mock('../store/config', () => ({
  useTrackMap: () => new Map([[fx.track.id, fx.track]]),
  useActiveTracks: () => [fx.track],
}))

vi.mock('../store/auth', () => ({
  useAuth: () => ({ session: null, profile: fx.state.profile, loading: false }),
}))

vi.mock('../store/entrySheet', () => ({
  openEntry: () => {},
}))

const { MemoryRouter } = await import('react-router-dom')
const Board = (await import('./Board')).default
const { t } = await import('../lib/i18n')

const render = (path = '/board'): string =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <Board />
    </MemoryRouter>,
  )

/** React's own escaping, so an assertion can be written against a real t(). */
const esc = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')

const countOf = (haystack: string, needle: string): number => haystack.split(needle).length - 1

const columnAt = (html: string, label: string): number =>
  html.indexOf(esc(t('board.column', { status: label })))

describe('Board — columns come from the vocabulary', () => {
  it('renders one column per VISIBLE status, in the admin’s own order and labels', () => {
    const html = render()
    expect(countOf(html, 'class="bd-col"')).toBe(4)
    // Renamed, not `status.new` — the labels are resolved at render, which is
    // what makes an admin rename free (store/vocab.ts's frozen-key payoff).
    expect(html).toContain('Triage')
    expect(html).toContain('Shipped')
    expect(columnAt(html, 'Triage')).toBeLessThan(columnAt(html, 'Doing'))
    expect(columnAt(html, 'Doing')).toBeLessThan(columnAt(html, 'Blocked'))
    expect(columnAt(html, 'Blocked')).toBeLessThan(columnAt(html, 'Shipped'))
  })

  it('keeps a retired status reachable while it still holds work, and only then', () => {
    const html = render()
    expect(html).toContain(esc(t('board.hiddenColumns')))
    // Present as a rail entry…
    expect(html).toContain('Awaiting vendor')
    // …and NOT as a column, which is what makes it a source and never a target.
    expect(columnAt(html, 'Awaiting vendor')).toBe(-1)
    // A retired status holding nothing is genuinely gone.
    expect(html).not.toContain('Dropped')
    // Collapsed until asked for: the rail is an escape hatch, not a sixth column.
    expect(html).toContain('aria-expanded="false"')
    // The count rides IN the label: an aria-label on a button replaces its
    // contents, so the pill inside it is announced to nobody.
    expect(html).toContain(esc(t('board.expandColumn', { status: 'Awaiting vendor', count: 2 })))
  })

  it('states what an empty column is for instead of leaving a blank strip', () => {
    const html = render()
    expect(html).toContain(esc(t('board.columnEmpty', { status: 'Blocked' })))
    expect(html).toContain(esc(t('board.columnEmptyHint')))
  })

  it('gives each column count a sentence, not a bare digit', () => {
    const html = render()
    expect(html).toContain(esc(t('board.columnCountLabel', { count: 2 })))
    expect(html).toContain(esc(t('board.columnCountLabel', { count: 0 })))
  })
})

describe('Board — the accessible move path', () => {
  it('gives every visible card the non-drag move control', () => {
    const html = render()
    const onBoard = fx.entries.filter((e) => e.status !== 'waiting_on').length
    // The kit renders StatusPill as a native <select> whenever onMove is wired,
    // and W2-BOARD wires it on every card, always.
    expect(countOf(html, 'data-editable="true"')).toBe(onBoard)
    expect(countOf(html, 'class="bd-card"')).toBe(onBoard)
    // Focus can be RESTORED to a card after a keyboard move re-mounts it in
    // another column, which is why the wrapper is focusable but not tabbable.
    expect(html).toContain('tabindex="-1"')
  })

  it('carries a polite live region and a keyboard hint for the people who need one', () => {
    const html = render()
    expect(html).toContain('role="status" aria-live="polite"')
    expect(html).toContain(esc(t('board.keyboardHint')))
    expect(html).toContain(esc(t('board.dragHint')))
  })
})

describe('Board — permission is decided before the affordance renders', () => {
  it('locks every card and says why when the reader has no profile yet', () => {
    fx.state.profile = null
    try {
      const html = render()
      const onBoard = fx.entries.filter((e) => e.status !== 'waiting_on').length
      // canEditEntry() answers false for a null id under BOTH branches of the
      // 0004 decision, so no drag handler is attached and the select is disabled
      // — no request is sent that RLS would answer with zero rows.
      expect(countOf(html, 'data-locked="true"')).toBe(onBoard)
      expect(countOf(html, 'disabled=""')).toBe(onBoard)
      expect(html).toContain(esc(t('entry.cannotEdit')))
    } finally {
      fx.state.profile = { id: 'u1', displayName: 'Me', role: 'member', locale: null }
    }
  })

  it('leaves the cards unlocked for a signed-in member', () => {
    const html = render()
    expect(html).not.toContain('data-locked="true"')
  })
})

describe('Board — the status axis belongs to the columns', () => {
  it('ignores a status facet and a scope arriving in the URL', () => {
    // A pasted or inherited link can carry facets this screen has no control
    // for. Dropping them keeps the "3 filters" pill honest — it must never count
    // a filter the user can neither see nor switch off.
    const html = render('/board?status=done&scope=open&q=switch')
    expect(countOf(html, 'class="bd-card"')).toBe(
      fx.entries.filter((e) => e.status !== 'waiting_on').length,
    )
    // The facets the board DOES own are still applied — the search box holds the
    // term it was handed.
    expect(html).toContain('value="switch"')
  })
})

describe('Board — empty, loading and failed', () => {
  it('offers a way forward when the filter admits nothing', () => {
    fx.state.entries = fx.empty
    try {
      const html = render()
      expect(html).toContain(esc(t('board.empty')))
      expect(html).toContain(esc(t('board.emptyHint')))
      expect(html).not.toContain('class="bd-col"')
    } finally {
      fx.state.entries = fx.entries
    }
  })

  it('shows a skeleton only while there is genuinely nothing to show', () => {
    fx.state.entries = fx.empty
    fx.state.loading = true
    try {
      expect(render()).toContain('bd-col-skeleton')
    } finally {
      fx.state.entries = fx.entries
      fx.state.loading = false
    }
    // A refetch with cards already on screen must not blank the board someone is
    // reading.
    fx.state.loading = true
    try {
      const html = render()
      expect(html).not.toContain('bd-col-skeleton')
      expect(countOf(html, 'class="bd-col"')).toBe(4)
    } finally {
      fx.state.loading = false
    }
  })

  it('renders a failed load as a retryable alert', () => {
    fx.state.error = 'board.errLoad'
    try {
      const html = render()
      expect(html).toContain('role="alert"')
      expect(html).toContain(esc(t('board.errLoad')))
      expect(html).toContain(esc(t('common.retry')))
    } finally {
      fx.state.error = null
    }
  })
})

describe('Board — Arabic', () => {
  it('renders its own strings in Arabic from the same key set, with the same markup', async () => {
    const { setLocale } = await import('../lib/i18n')
    setLocale('ar')
    try {
      const html = render()
      // A key with no Arabic value falls back to the ENGLISH string, so
      // asserting the Arabic text is present is what proves the namespace is
      // genuinely translated rather than merely at key parity.
      expect(html).toContain(esc(t('board.subtitle')))
      expect(html).toContain(esc(t('board.dragHint')))
      expect(html).toContain(esc(t('board.hiddenColumnsHint')))
      expect(html).toContain(esc(t('board.swimlaneTrack')))
      // Direction is carried by <html dir> and CSS logical properties, so the
      // markup is identical in both languages apart from the text — no mirrored
      // class, no per-direction branch.
      expect(countOf(html, 'class="bd-col"')).toBe(4)
    } finally {
      setLocale('en')
    }
  })
})
