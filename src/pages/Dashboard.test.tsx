// Render proof for the dashboard.
//
// WHY renderToStaticMarkup AND NOT A DOM. vitest.config.ts is `environment:
// 'node'` and jsdom is not in the dependency budget — Board.test.tsx and the
// entry kit's test open with the same paragraph. react-dom/server exercises the
// real tree, the real chart geometry and the real i18n bundle, and hands back
// markup to assert on.
//
// WHAT THIS FILE PROVES, and it is deliberately the half a static render CAN
// prove: that every chart ships the accessibility wiring the brief asks for
// (a named group, a <title>, a <desc> that is not a repeat of the title, a
// table fallback, one focusable mark per category), that the AXIS DIRECTION
// ACTUALLY MIRRORS in Arabic rather than merely being claimed to, and that the
// screen degrades correctly when there is no data, an error, or a truncated
// read.
//
// WHAT IT CANNOT SEE: anything behind an effect. `useChartSize`'s
// ResizeObserver never runs here, so every chart draws at its fallback width —
// which is exactly why that fallback exists (see geometry.ts). The SLA matrix
// fetch is likewise an effect, so these renders exercise the
// priority-default-only path; the matrix precedence itself is asserted without
// a DOM in aggregate.test.ts, where it belongs.
//
// THE ARITHMETIC IS NOT RE-TESTED HERE. Every number on this screen comes out
// of lib/aggregate.ts, which has 29 assertions of its own. A page test that
// re-derived them would be testing that this file can call a function.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Entry, EntryHealth, Track } from '../types'

const fx = vi.hoisted(() => {
  // lib/i18n reads localStorage at module scope and lib/theme reads matchMedia,
  // both at IMPORT time, so the shims cannot wait for a beforeAll().
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

  const at = (date: string): string => `${date}T12:00:00.000Z`

  const entry = (over: Partial<Entry> & Pick<Entry, 'id' | 'title'>): Entry => ({
    track_id: 't-net',
    description: '',
    type: 'action',
    status: 'new',
    priority: 'medium',
    owner_id: null,
    owner_name: null,
    requester: null,
    due_date: null,
    follow_up_date: null,
    tags: [],
    links: [],
    created_by: 'u1',
    created_at: at('2026-07-01'),
    updated_at: at('2026-07-20'),
    closed_at: null,
    last_activity_at: at('2026-07-20'),
    meeting_id: null,
    template_id: null,
    ...over,
  })

  const health = (id: string, over: Partial<EntryHealth> = {}): EntryHealth => ({
    id,
    entry_id: id,
    track_id: 't-net',
    status: 'new',
    priority: 'medium',
    due_date: null,
    last_activity_at: at('2026-07-20'),
    days_since_activity: 9,
    days_overdue: 0,
    health: 'ok',
    sla_due_at: null,
    sla_breached: false,
    ...over,
  })

  const entries: Entry[] = [
    entry({ id: 'a', title: 'Firewall rule DC2' }),
    entry({ id: 'b', title: 'Core switch upgrade', owner_id: 'u2' }),
    entry({ id: 'c', title: 'Rebuild jump host', track_id: 't-inf', owner_id: 'u2' }),
    entry({ id: 'd', title: 'Vendor portal access', track_id: null, owner_name: 'Acme Ltd' }),
    entry({ id: 'e', title: 'Legacy DNS cutover', status: 'blocked', created_at: at('2026-06-01') }),
    entry({ id: 'f', title: 'Card reader firmware', status: 'waiting_on' }),
    entry({ id: 'g', title: 'Old ticket', status: 'done', closed_at: at('2026-07-20') }),
  ]

  const track = (over: Partial<Track> & Pick<Track, 'id' | 'name'>): Track => ({
    name_ar: '',
    description: '',
    description_ar: '',
    color: '#4f9cf9',
    color_light: null,
    icon: 'network',
    suggested_tags: [],
    sort_order: 0,
    archived: false,
    archived_at: null,
    created_by: null,
    created_at: at('2026-01-01'),
    updated_at: at('2026-01-01'),
    ...over,
  })

  const net = track({ id: 't-net', name: 'Network', name_ar: 'الشبكات' })
  const inf = track({ id: 't-inf', name: 'Infrastructure', name_ar: 'البنية', sort_order: 1 })

  const members = [
    { id: 'u1', displayName: 'Me', role: 'member' as const },
    { id: 'u2', displayName: 'Layla', role: 'member' as const },
  ]

  const counts = {
    total: 7,
    open: 6,
    overdue: 2,
    stale: 1,
    blocked: 1,
    unassigned: 1,
    dueThisWeek: 0,
    closed: 1,
  }

  const state: {
    entries: Entry[]
    health: Map<string, EntryHealth>
    loading: boolean
    error: string | null
    truncated: boolean
    /** The matrix now comes from store/entries, not a private fetch — see the
     *  Dashboard header and FIX-BACKLOG SLA-MATRIX. */
    slaMatrix: ReadonlyMap<string, number> | null
    slaMatrixError: string | null
    /** The CLOSED window's own read failing. Separate from `error`, which is
     *  the open fetch — three panels here are computed from closed rows alone. */
    closedError: string | null
  } = {
    entries,
    health: new Map([
      ['a', health('a', { health: 'overdue', days_overdue: 3 })],
      ['b', health('b', { health: 'stale' })],
      ['c', health('c')],
      ['d', health('d', { track_id: null })],
      ['e', health('e')],
      ['f', health('f')],
    ]),
    loading: false,
    error: null,
    truncated: false,
    slaMatrix: null,
    slaMatrixError: null,
    closedError: null,
  }

  return { at, entry, health, entries, net, inf, members, counts, state, mem }
})

vi.mock('../store/entries', () => ({
  useFilteredEntries: () => fx.state.entries,
  useEntryMap: () => new Map(fx.state.entries.map((e) => [e.id, e])),
  useHealthMap: () => fx.state.health,
  useEntriesLoading: () => fx.state.loading,
  useEntriesError: () => fx.state.error,
  useEntriesTruncated: () => fx.state.truncated,
  useFilterContext: () => ({ meId: 'u1', today: '2026-07-30' }),
  // The real countEntries is store-owned and store-tested; stubbing it keeps
  // this file asserting that the tiles WIRE UP, which is the only part of it
  // that lives in Dashboard.tsx.
  countEntries: () => fx.counts,
  loadEntries: () => Promise.resolve(),
  loadClosedSince: () => Promise.resolve(),
  loadTrackSlas: () => Promise.resolve(),
  refreshEntries: () => Promise.resolve(),
  useTrackSlaMatrix: () => fx.state.slaMatrix,
  useTrackSlaError: () => fx.state.slaMatrixError,
  useClosedEntriesError: () => fx.state.closedError,
}))

vi.mock('../store/vocab', () => {
  const priorities = [
    { key: 'critical', label: 'Critical' },
    { key: 'high', label: 'High' },
    { key: 'medium', label: 'Normal' },
    { key: 'low', label: 'Low' },
  ].map((o) => ({
    kind: 'priority' as const,
    color: null,
    hidden: false,
    sortOrder: 0,
    staleAfterDays: null,
    slaDays: null,
    ...o,
  }))
  return {
    useVocab: (kind: string) => (kind === 'priority' ? priorities : []),
    useVocabAll: (kind: string) => (kind === 'priority' ? priorities : []),
    useVocabLabel: () => (_kind: string, key: string) =>
      priorities.find((p) => p.key === key)?.label ?? key,
    useVocabColor: () => () => null,
    useStaleDays: () => () => 8,
    useSlaDays: () => () => 7,
  }
})

vi.mock('../store/members', () => ({
  useMembers: () => fx.members,
  useMemberMap: () => new Map(fx.members.map((m) => [m.id, m])),
  memberLabel: (
    _byId: unknown,
    ownerId?: string | null,
    ownerName?: string | null,
  ): string => fx.members.find((m) => m.id === ownerId)?.displayName ?? ownerName?.trim() ?? 'Unassigned',
  useMemberLabel:
    () =>
    (ownerId?: string | null, ownerName?: string | null): string =>
      fx.members.find((m) => m.id === ownerId)?.displayName ?? ownerName?.trim() ?? 'Unassigned',
}))

vi.mock('../store/config', () => ({
  useTrackMap: () => new Map([fx.net, fx.inf].map((tr) => [tr.id, tr])),
  useActiveTracks: () => [fx.net, fx.inf],
}))

const { MemoryRouter } = await import('react-router-dom')
const Dashboard = (await import('./Dashboard')).default
const { setLocale, t } = await import('../lib/i18n')

const render = (): string =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Dashboard />
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

/**
 * Every `x` on a TRACK bar, in document order.
 *
 * Narrowed to the health tones so it cannot accidentally pick up the aging
 * (`a1`–`a4`), throughput (`created`/`closed`) or SLA (`good`/`warn`/`bad`)
 * series — the direction assertion below is about slot ORDER within one chart,
 * and mixing four charts' bars into one list would make it meaningless.
 */
function trackBarXs(html: string): number[] {
  // `[^"]*` between the two classes rather than the literal class string: the
  // stacked segments also carry `cht-band` (the hairline that separates two
  // health colours), and a helper that pins the exact attribute value reports a
  // MIRRORING failure — zero bars found — when the real change was a class
  // being added. The health alternation is what keeps the aging chart's
  // `cht-c-a*` bars out of the result.
  return [
    ...html.matchAll(/<rect class="cht-bar[^"]*cht-c-(?:ok|stale|overdue|critical)" x="([\d.]+)"/g),
  ].map((m) => Number(m[1]))
}

afterEach(() => {
  setLocale('en')
  fx.state.entries = fx.entries
  fx.state.loading = false
  fx.state.error = null
  fx.state.truncated = false
})

describe('Dashboard — the panels are there and they are wired', () => {
  it('renders all five panels', () => {
    const html = render()
    for (const key of [
      'dashboard.trackTitle',
      'dashboard.ageTitle',
      'dashboard.flowTitle',
      'dashboard.slaTitle',
      'dashboard.ownerTitle',
    ]) {
      expect(html, key).toContain(esc(t(key)))
    }
  })

  it('states the window on the throughput panel, in whole weeks', () => {
    // 8 weeks is the default and the brief's number. It is derived from
    // weekBounds, so this also proves the window arithmetic produces eight
    // buckets and not seven or nine.
    expect(render()).toContain(esc(t('dashboard.flowDesc', { count: 8 })))
  })

  it('shows every stat tile, with the blocked one naming its oldest blocker', () => {
    const html = render()
    expect(html).toContain(esc(t('dashboard.statBlocked')))
    // 'e' is blocked since 2026-06-01 and 'f' is waiting_on since 2026-07-01,
    // so the older of the two is the one named.
    expect(html).toContain('Legacy DNS cutover')
  })

  it('links the actionable tiles at the list that can act on them', () => {
    const html = render()
    expect(html).toContain('href="/followups"')
    expect(html).toContain('href="/board"')
  })

  it('reports NO active filter on first paint', () => {
    // The screen pins scope to 'all' so the closed-work panels have rows, but
    // that is its own contract and not something the reader chose. Holding it
    // in the filter state made the bar claim "1 filter" on an unfiltered screen
    // — and its Clear-all button then reset the scope and silently emptied
    // throughput and compliance.
    expect(render()).not.toContain('flt-count')
  })

  it('counts untracked work as its own bar rather than dropping it', () => {
    // Entry 'd' has track_id null and must not silently vanish from a chart
    // whose whole subject is where the work is.
    expect(render()).toContain(esc(t('dashboard.noTrack')))
  })
})

describe('Dashboard — chart accessibility', () => {
  it('names every svg as a group rather than an image', () => {
    // role="img" would make the focusable marks inside unreachable; see
    // Chart.tsx's header.
    const html = render()
    expect(countOf(html, 'role="group"')).toBeGreaterThanOrEqual(4)
    expect(html).not.toContain('<svg class="cht-svg" role="img"')
  })

  it('gives every svg a title and a desc, wired by id', () => {
    const html = render()
    const svgs = [...html.matchAll(/<svg[^>]*aria-labelledby="([^"]+)" aria-describedby="([^"]+)"/g)]
    expect(svgs.length).toBeGreaterThanOrEqual(4)
    for (const [, titleId, descId] of svgs) {
      expect(html).toContain(`<title id="${titleId}">`)
      expect(html).toContain(`<desc id="${descId}">`)
    }
  })

  it('describes the SHAPE of the data, not the title again', () => {
    const html = render()
    // trackSummary names the busiest track and its count — a description worth
    // listening to, unlike a restatement of "Open work per track".
    // Network holds four OPEN items (a, b, e, f); the fifth on that track is
    // done and correctly absent.
    //
    // `count` is the TRACK count and `topCount` the busiest track's, not the
    // other way round: the string is a plural node and selectPlural inflects on
    // `count` alone, so the number that picks "1 track" vs "3 tracks" has to
    // carry that name (R3-I18N-1).
    expect(html).toContain(
      esc(t('dashboard.trackSummary', { count: 3, top: 'Network', topCount: 4 })),
    )
  })

  it('ships a table fallback per chart, with the numbers in it', () => {
    const html = render()
    expect(countOf(html, esc(t('dashboard.showData')))).toBeGreaterThanOrEqual(4)
    expect(countOf(html, '<table class="cht-table')).toBeGreaterThanOrEqual(5)
    expect(html).toContain(esc(t('dashboard.colTrack')))
  })

  it('makes one mark per category focusable, and labels it in full', () => {
    const html = render()
    expect(html).toContain('class="cht-mark" role="img" tabindex="0"')
    expect(html).toContain(
      esc(
        t('dashboard.trackMark', {
          track: 'Infrastructure',
          count: 1,
          detail: t('dashboard.healthPart', { count: 1, health: t('health.ok') }),
        }),
      ),
    )
  })

  it('gives the owner panel a real table with row headers', () => {
    const html = render()
    expect(html).toContain(esc(t('dashboard.colOwner')))
    expect(html).toContain('Layla')
    expect(html).toContain('scope="row"')
  })
})

describe('Dashboard — RTL', () => {
  it('mirrors the inline axis instead of merely re-labelling it', () => {
    const ltr = trackBarXs(render())
    setLocale('ar')
    const rtl = trackBarXs(render())
    setLocale('en')

    expect(ltr.length).toBeGreaterThan(0)
    expect(rtl.length).toBe(ltr.length)
    // Slot 0 is the busiest track. In English it is the leftmost bar; in Arabic
    // it has to be the RIGHTMOST, or the ranking reads backwards to the reader
    // it was drawn for.
    expect(Math.min(...ltr)).toBe(ltr[0])
    expect(Math.max(...rtl)).toBe(rtl[0])
    expect(rtl[0]).toBeGreaterThan(ltr[0])
  })

  it('anchors the value-axis labels against the axis in both directions', () => {
    expect(render()).toContain('text-anchor="end"')
    setLocale('ar')
    const html = render()
    setLocale('en')
    expect(html).toContain('text-anchor="start"')
  })

  it('renders the Arabic strings, not the English ones', () => {
    setLocale('ar')
    const html = render()
    // Resolved while the locale is still Arabic — t() answers in the CURRENT
    // locale, so reading it after the restore below would compare Arabic markup
    // against English strings and pass for the wrong reason.
    const arabicTitle = t('dashboard.trackTitle')
    const englishTitle = (setLocale('en'), t('dashboard.trackTitle'))

    expect(html).toContain(esc(arabicTitle))
    expect(html).not.toContain(esc(englishTitle))
    // A track's own Arabic name, resolved through lib/labels.trackLabel.
    expect(html).toContain('الشبكات')
  })
})

describe('Dashboard — states', () => {
  it('offers a way forward when the workspace is genuinely empty', () => {
    fx.state.entries = []
    const html = render()
    expect(html).toContain(esc(t('dashboard.blank')))
    expect(html).toContain('href="/capture"')
    // No charts at all: five empty panels are a wall, not an empty state.
    expect(html).not.toContain('cht-svg')
  })

  it('shows the error above the panels, with a retry, and keeps rendering', () => {
    fx.state.error = 'common.error'
    const html = render()
    expect(html).toContain(esc(t('common.error')))
    expect(html).toContain(esc(t('common.retry')))
    expect(html).toContain('cht-svg')
  })

  it('caveats the totals when the working set was clipped', () => {
    fx.state.truncated = true
    expect(render()).toContain(esc(t('dashboard.truncated')))
  })

  it('draws skeletons rather than empty axes while loading', () => {
    fx.state.loading = true
    const html = render()
    expect(html).toContain('class="skeleton"')
    expect(html).not.toContain('cht-svg')
  })

  // The matrix moved into store/entries (FIX-BACKLOG SLA-MATRIX) so that this
  // screen and every list resolve the same track × priority answer. The note is
  // how a reader learns the compliance figure was computed against the
  // workspace default rather than the track's actual commitment.
  it('caveats compliance when the SLA matrix could not be read', () => {
    expect(render()).not.toContain(esc(t('dashboard.slaMatrixFailed')))
    fx.state.slaMatrixError = 'common.error'
    expect(render()).toContain(esc(t('dashboard.slaMatrixFailed')))
  })

  // The Closed tile, the throughput chart and SLA compliance are computed
  // ENTIRELY from the closed window, which is a separate read with its own
  // failure mode. It used to be swallowed — a dropped request rendered as a
  // quiet month, which is the one shape of wrong a report cannot recover from
  // because nothing about it looks wrong. Retry is offered because
  // refreshEntries() re-attempts this read specifically.
  it('says so when the closed window could not be read, and offers a retry', () => {
    expect(render()).not.toContain(esc(t('dashboard.closedFailed')))
    fx.state.closedError = 'common.offline'
    const html = render()
    expect(html).toContain(esc(t('dashboard.closedFailed')))
    expect(html).toContain(esc(t('common.retry')))
  })
})
