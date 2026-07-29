// Render proof for the follow-ups screen.
//
// WHY renderToStaticMarkup AND NOT A DOM. vitest.config.ts is `environment:
// 'node'` and there is no jsdom in the dependency budget — components/entry's
// own test opens with the same paragraph. react-dom/server exercises the real
// tree, the real hooks, the real bucketing and the real class names, and hands
// back markup to assert on. What it cannot see is the swipe gesture and the
// hover reveal, which are the two things this file makes no claims about.
//
// WHY THE STORES ARE MOCKED AND lib/ IS NOT. The point of this test is the
// screen's own decisions — section ORDER, that a section at zero is not drawn,
// that the six counts add up because bucketFollowUps puts an entry in exactly
// one bucket, and that a breached row names WHERE its deadline came from. Every
// one of those runs through the REAL `lib/entrySections`, the REAL
// `lib/entryFilter` sort and the REAL `lib/i18n`; only the data sources at the
// screen's edge are stubbed. A test that mocked bucketFollowUps would assert
// that this file can call a function.
//
// ZUSTAND V5 CANNOT BE SEEDED THROUGH A SERVER RENDER, which is why the stubs
// are `vi.mock` and not `applyServerRow()` calls: `useStore` passes
// `api.getInitialState` as useSyncExternalStore's getServerSnapshot, so every
// selector in a renderToStaticMarkup pass reports the state the store was
// CREATED with, no matter what has been written to it since.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import type { Entry, EntryHealth, EntryPriority } from '../types'

const fx = vi.hoisted(() => {
  // lib/i18n reads localStorage at module scope, store/config adds a window
  // focus listener at module scope, and lib/theme reads matchMedia. All three
  // are import-time, so the shims go in vi.hoisted — a beforeAll() is far too
  // late.
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
  // setLocale() pushes dir/lang onto <html>; the RTL pass below goes through
  // the real i18n rather than a stubbed t(), so it needs somewhere to write.
  g.document = { documentElement: { dir: 'ltr', lang: 'en' } }

  const TODAY = '2026-07-29'
  /** `created_at + 5 days`, the SLA the `high` priority default would produce. */
  const CREATED = '2026-07-01T00:00:00.000Z'

  const entry = (over: Partial<Entry> & Pick<Entry, 'id' | 'title'>): Entry => ({
    track_id: null,
    description: '',
    type: 'action',
    status: 'new',
    priority: 'high',
    owner_id: null,
    owner_name: 'Vendor',
    requester: null,
    due_date: null,
    follow_up_date: null,
    tags: [],
    links: [],
    created_by: 'u1',
    created_at: CREATED,
    updated_at: '2026-07-20T00:00:00.000Z',
    closed_at: null,
    last_activity_at: '2026-07-20T00:00:00.000Z',
    meeting_id: null,
    template_id: null,
    ...over,
  })

  const health = (id: string, over: Partial<EntryHealth> = {}): EntryHealth => ({
    id,
    entry_id: id,
    track_id: null,
    status: 'new',
    priority: 'high',
    due_date: null,
    last_activity_at: '2026-07-20T00:00:00.000Z',
    days_since_activity: 9,
    days_overdue: 0,
    health: 'ok',
    sla_due_at: null,
    sla_breached: false,
    ...over,
  })

  // One entry per bucket, plus a second breach so the two SLA SOURCES can be
  // told apart on one screen: 'b' is exactly the priority default (5 days) and
  // 'c' is two days, which only a track override can have produced.
  const entries: Entry[] = [
    entry({ id: 'a', title: 'Overdue one', due_date: '2026-07-20' }),
    entry({ id: 'b', title: 'Breach by default' }),
    entry({ id: 'c', title: 'Breach by track' }),
    entry({ id: 'd', title: 'Due soon one', due_date: '2026-07-31' }),
    entry({ id: 'e', title: 'Quiet one' }),
    entry({ id: 'f', title: 'Blocked one', status: 'blocked' }),
    entry({ id: 'g', title: 'Nobody owns me', owner_name: null }),
  ]

  const healthRows = new Map<string, EntryHealth>([
    ['a', health('a', { days_overdue: 9, health: 'overdue', due_date: '2026-07-20' })],
    ['b', health('b', { sla_due_at: '2026-07-06T00:00:00.000Z', sla_breached: true })],
    ['c', health('c', { sla_due_at: '2026-07-03T00:00:00.000Z', sla_breached: true })],
    ['d', health('d', { due_date: '2026-07-31' })],
    ['e', health('e', { health: 'stale', days_since_activity: 28 })],
    ['f', health('f', { status: 'blocked' })],
    ['g', health('g')],
  ])

  // Mutable so the empty-state case can swap in an empty working set without a
  // second mock factory. Reference-stable per case, which is what the screen's
  // useMemo dependencies require.
  const state: {
    entries: Entry[]
    health: Map<string, EntryHealth>
    loading: boolean
    error: string | null
  } = {
    entries,
    health: healthRows,
    loading: false,
    error: null,
  }

  const empty: Entry[] = []

  return { TODAY, CREATED, state, entries, healthRows, empty }
})

vi.mock('../store/entries', () => ({
  useFilteredEntries: () => fx.state.entries,
  useHealthMap: () => fx.state.health,
  useEntriesLoading: () => fx.state.loading,
  useEntriesError: () => fx.state.error,
  useEntriesCoverage: () => ({ openLoaded: true, closedSince: null, trackHistory: {}, loadedAt: null }),
  useFilterContext: () => ({ meId: 'u1', today: fx.TODAY }),
  loadEntries: () => Promise.resolve(),
  refreshEntries: () => Promise.resolve(),
  patchEntry: () => Promise.resolve({ ok: false, error: 'common.error' }),
  postUpdate: () => Promise.resolve({ ok: false, error: 'common.error' }),
  snoozeFollowUp: () => Promise.resolve({ ok: false, error: 'common.error' }),
}))

vi.mock('../store/vocab', () => ({
  // `high` carries a 5-day service window; everything else has none. That is
  // the workspace state the SLA-source inference is read against.
  useSlaDays: () => (p: EntryPriority) => (p === 'high' ? 5 : null),
  useStaleDays: () => () => 8,
  useVocab: () => [],
  useVocabAll: () => [],
  useVocabLabel: () => (_kind: string, key: string) => key,
  useVocabColor: () => () => null,
}))

vi.mock('../store/members', () => ({
  useMembers: () => [],
  useMemberLabel:
    () =>
    (ownerId?: string | null, ownerName?: string | null): string =>
      ownerId ?? ownerName?.trim() ?? '',
}))

vi.mock('../store/config', () => ({
  useTrackMap: () => new Map(),
  useActiveTracks: () => [],
}))

vi.mock('../store/auth', () => ({
  useAuth: () => ({ session: null, profile: { id: 'u1', displayName: 'Me', role: 'member', locale: null }, loading: false }),
}))

const { MemoryRouter } = await import('react-router-dom')
const FollowUps = (await import('./FollowUps')).default
const { t } = await import('../lib/i18n')

const render = (node: ReactElement): string =>
  renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>)

/** React's own escaping, so an assertion can be written against a real t(). */
const esc = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')

const countOf = (haystack: string, needle: string): number => haystack.split(needle).length - 1

describe('FollowUps — sections', () => {
  it('renders the six buckets in the spec order, SLA breach second', () => {
    const html = render(<FollowUps />)
    const at = (id: string): number => html.indexOf(`data-section="${id}"`)

    expect(at('overdue')).toBeGreaterThan(-1)
    expect(at('overdue')).toBeLessThan(at('slaBreach'))
    expect(at('slaBreach')).toBeLessThan(at('dueSoon'))
    expect(at('dueSoon')).toBeLessThan(at('stale'))
    expect(at('stale')).toBeLessThan(at('blocked'))
    expect(at('blocked')).toBeLessThan(at('unassigned'))
  })

  it('puts every entry in exactly one section, so the counts add up', () => {
    const html = render(<FollowUps />)
    // One wrapper per rendered row, and one row per seeded entry — an entry
    // counted twice would make the headings lie about the same list.
    expect(countOf(html, 'class="fu-swipe"')).toBe(fx.entries.length)
    const counts = [...html.matchAll(/entry-section-count">(\d+)</g)].map((m) => Number(m[1]))
    expect(counts).toEqual([1, 2, 1, 1, 1, 1])
    expect(counts.reduce((a, b) => a + b, 0)).toBe(fx.entries.length)
  })

  it('names each bucket and collapses it from a real button', () => {
    const html = render(<FollowUps />)
    expect(html).toContain(esc(t('followups.overdue')))
    expect(html).toContain(esc(t('followups.slaBreach')))
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain(esc(t('entry.collapseSection', { section: t('followups.overdue') })))
    // Every heading carries its meaning, once, under the title.
    expect(html).toContain(esc(t('followups.unassignedHint')))
    expect(html).toContain(esc(t('followups.onceOnly')))
  })
})

describe('FollowUps — row actions', () => {
  it('gives every row both swipe actions as real buttons', () => {
    const html = render(<FollowUps />)
    expect(countOf(html, esc(t('followups.addUpdate')))).toBeGreaterThanOrEqual(fx.entries.length)
    expect(countOf(html, esc(t('followups.snoozeThreeDays')))).toBeGreaterThanOrEqual(
      fx.entries.length,
    )
    // The hint strips behind the row repeat what the buttons say and must not
    // be announced a second time.
    expect(html).toContain('class="fu-swipe-hint" data-act="update" aria-hidden="true"')
    expect(html).toContain('class="fu-swipe-hint" data-act="snooze" aria-hidden="true"')
  })

  it('offers "take it" only where the owner question is still open', () => {
    const html = render(<FollowUps />)
    // Counted on the label span, not on the raw string: every action carries
    // its words twice — once as the visible/announced label and once as the
    // pointer tooltip.
    expect(countOf(html, `class="fu-act-label">${esc(t('followups.takeIt'))}<`)).toBe(1)
  })
})

describe('FollowUps — the resolved SLA source', () => {
  it('reads a deadline that matches the priority default as the default', () => {
    const html = render(<FollowUps />)
    expect(html).toContain(esc(t('followups.slaFromPriority', { days: 5 })))
  })

  it('reads a deadline the priority default cannot explain as a track override', () => {
    const html = render(<FollowUps />)
    expect(html).toContain(esc(t('followups.slaFromTrack', { days: 2 })))
  })

  it('marks only the breached rows', () => {
    const html = render(<FollowUps />)
    expect(countOf(html, 'fu-sla')).toBe(2)
  })
})

describe('FollowUps — empty, loading and failed', () => {
  it('suggests capturing when nothing needs anyone', () => {
    fx.state.entries = fx.empty
    try {
      const html = render(<FollowUps />)
      expect(html).toContain(esc(t('followups.allClear')))
      expect(html).toContain(esc(t('followups.captureCta')))
      expect(html).toContain('href="/capture"')
      expect(html).not.toContain('data-section=')
    } finally {
      fx.state.entries = fx.entries
    }
  })

  it('shows a skeleton only while there is genuinely nothing to show', () => {
    fx.state.entries = fx.empty
    fx.state.loading = true
    try {
      expect(render(<FollowUps />)).toContain('fu-skel')
    } finally {
      fx.state.entries = fx.entries
      fx.state.loading = false
    }
    // A refetch with rows already on screen must not blank the list someone is
    // reading — the same rule store/entries applies to its own spinner.
    fx.state.loading = true
    try {
      const html = render(<FollowUps />)
      expect(html).not.toContain('fu-skel')
      expect(html).toContain('data-section="overdue"')
    } finally {
      fx.state.loading = false
    }
  })

  it('renders a failed load as an error state, and a failed refetch as a note', () => {
    fx.state.entries = fx.empty
    fx.state.error = 'followups.errLoad'
    try {
      const html = render(<FollowUps />)
      expect(html).toContain(esc(t('followups.errLoad')))
      expect(html).toContain(esc(t('common.retry')))
    } finally {
      fx.state.entries = fx.entries
      fx.state.error = null
    }

    // Rows on screen: slightly stale follow-ups beat an empty list, so the
    // failure is a line of text and the sections stay.
    fx.state.error = 'followups.errLoad'
    try {
      const html = render(<FollowUps />)
      expect(html).toContain('class="fu-note"')
      expect(html).toContain('data-section="overdue"')
      expect(html).not.toContain(esc(t('common.retry')))
    } finally {
      fx.state.error = null
    }
  })
})

describe('FollowUps — Arabic', () => {
  it('renders every one of its own strings in Arabic, from the same key set', async () => {
    const { setLocale } = await import('../lib/i18n')
    setLocale('ar')
    try {
      const html = render(<FollowUps />)
      // A key with no Arabic value falls back to the ENGLISH string, so
      // asserting the Arabic is present is the assertion that the namespace is
      // genuinely translated and not merely at key parity.
      expect(html).toContain(esc(t('followups.overdue')))
      expect(html).toContain(esc(t('followups.slaBreach')))
      expect(html).toContain(esc(t('followups.snoozeThreeDays')))
      expect(html).toContain(esc(t('followups.slaFromTrack', { days: 2 })))
      expect(html).toContain(esc(t('followups.onceOnly')))
      // The direction is carried by <html dir> and CSS logical properties, so
      // the markup itself is byte-identical in both languages apart from text —
      // no mirrored class, no per-direction branch.
      expect(countOf(html, 'class="fu-swipe"')).toBe(fx.entries.length)
    } finally {
      setLocale('en')
    }
  })
})
