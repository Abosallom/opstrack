// Render proof for the numbers stage and the six tiles beside it.
//
// THIS FILE IS pages/Dashboard.test.tsx REWRITTEN AGAINST THE NEW STRUCTURE.
// Every a11y guarantee that file asserted about `/dashboard` is restated here,
// in the same intent and mostly in the same words: a named group and not an
// image, a <title> and a <desc> wired by id, a <desc> describing the SHAPE
// rather than repeating the title, one `<details>` table fallback per chart with
// the numbers in it, one focusable fully-labelled mark per category, row headers
// on the owner table, and an inline axis that MIRRORS in Arabic rather than
// merely being relabelled. Deleting the page may not drop one of them (rule 6).
//
// WHY renderToStaticMarkup AND NOT A DOM. vitest.config.ts is `environment:
// 'node'` and jsdom is not in the dependency budget — Board.test.tsx, the entry
// kit's test and the dashboard's own open with the same paragraph.
//
// WHAT IT CANNOT SEE: anything behind an effect. `useChartSize`'s ResizeObserver
// never runs here, so every chart draws at its 340px fallback — which is exactly
// why that fallback exists (geometry.ts); a replacement that rendered nothing
// until measured would silently turn every assertion below into one about an
// empty `<svg>`. It also cannot CLICK, which is why the five jump patches are
// asserted through `jumpFor()` — pure, and extracted for that purpose — and
// cross-checked against `selectEntries`, so "the number equals the list it
// opens" is proved rather than claimed. The ARITHMETIC is not re-tested: every
// number here comes out of lib/aggregate.ts, which has 29 assertions of its own.
//
// THE FIXTURE CLOCK IS RELATIVE, a departure from the file this replaces.
// Dashboard.test.tsx pinned `2026-07-01` timestamps against a window derived
// from the real `new Date()`: inside an 8-week window today, outside it next
// quarter, at which point the throughput chart renders `empty` and four
// assertions about `<svg>` counts fail for a reason unrelated to the code.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Entry, EntryHealth, Track } from '../../types'

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

  const DAY = 86_400_000
  /** N days before now, as an instant. Noon-anchored so a timezone shift cannot
   *  move a fixture across a calendar day and change a bucket. */
  const ago = (days: number): string => {
    const at = new Date(Date.now() - days * DAY)
    at.setUTCHours(12, 0, 0, 0)
    return at.toISOString()
  }

  const entry = (over: Partial<Entry> & Pick<Entry, 'id' | 'title'>): Entry => ({
    track_id: 't-net',
    node_id: null,
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
    created_at: ago(20),
    updated_at: ago(9),
    closed_at: null,
    last_activity_at: ago(9),
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
    last_activity_at: ago(9),
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
    entry({ id: 'e', title: 'Legacy DNS cutover', status: 'blocked', created_at: ago(60) }),
    entry({ id: 'f', title: 'Card reader firmware', status: 'waiting_on' }),
    entry({ id: 'g', title: 'Old ticket', status: 'done', closed_at: ago(10) }),
  ]

  /**
   * The overdue pair, kept OUT of the render fixture on purpose.
   *
   * `h2` is overdue AND critical, which computeHealth resolves to `critical`
   * rather than `overdue` — the one case that makes `health: ['overdue']` alone
   * an undercount. It lives in its own array so the render assertions above keep
   * the exact track/health shape the dashboard's did, and the jump test can
   * still prove the thing that matters.
   */
  const overdueRows: Entry[] = [
    entry({ id: 'h1', title: 'Late patch window' }),
    entry({ id: 'h2', title: 'Certificate expiry', priority: 'critical' }),
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
    created_at: ago(300),
    updated_at: ago(300),
    ...over,
  })

  const net = track({ id: 't-net', name: 'Network', name_ar: 'الشبكات' })
  const inf = track({ id: 't-inf', name: 'Infrastructure', name_ar: 'البنية', sort_order: 1 })

  const members = [
    { id: 'u1', displayName: 'Me', role: 'member' as const },
    { id: 'u2', displayName: 'Layla', role: 'member' as const },
  ]

  /**
   * The store's own counts, stubbed exactly as Dashboard.test.tsx stubbed them.
   *
   * `countEntries` is store-owned and store-tested; stubbing it keeps this file
   * asserting that the tiles WIRE UP, which is the only part of it that lives in
   * NumbersPanel. Note `blocked: 1` — the panel must NOT show that number, and a
   * test below depends on it not doing so.
   */
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
    slaMatrix: ReadonlyMap<string, number> | null
    slaMatrixError: string | null
    /** The CLOSED window's own read failing. Separate from `error`, which is
     *  the open fetch — two panels here are computed from closed rows alone. */
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

  return { ago, entry, health, entries, overdueRows, net, inf, members, counts, state, mem }
})

vi.mock('../../store/entries', () => ({
  useFilteredEntries: () => fx.state.entries,
  useEntryMap: () => new Map(fx.state.entries.map((e) => [e.id, e])),
  useHealthMap: () => fx.state.health,
  useEntriesLoading: () => fx.state.loading,
  useEntriesError: () => fx.state.error,
  useEntriesTruncated: () => fx.state.truncated,
  useFilterContext: () => ({ meId: 'u1', today: '2026-07-30' }),
  countEntries: () => fx.counts,
  loadEntries: () => Promise.resolve(),
  loadClosedSince: () => Promise.resolve(),
  loadTrackSlas: () => Promise.resolve(),
  refreshEntries: () => Promise.resolve(),
  useTrackSlaMatrix: () => fx.state.slaMatrix,
  useTrackSlaError: () => fx.state.slaMatrixError,
  useClosedEntriesError: () => fx.state.closedError,
}))

vi.mock('../../store/vocab', () => {
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

vi.mock('../../store/members', () => ({
  useMembers: () => fx.members,
  useMemberMap: () => new Map(fx.members.map((m) => [m.id, m])),
  memberLabel: (_byId: unknown, ownerId?: string | null, ownerName?: string | null): string =>
    fx.members.find((m) => m.id === ownerId)?.displayName ?? ownerName?.trim() ?? 'Unassigned',
  useMemberLabel:
    () =>
    (ownerId?: string | null, ownerName?: string | null): string =>
      fx.members.find((m) => m.id === ownerId)?.displayName ?? ownerName?.trim() ?? 'Unassigned',
}))

vi.mock('../../store/config', () => ({
  useTrackMap: () => new Map([fx.net, fx.inf].map((tr) => [tr.id, tr])),
  useActiveTracks: () => [fx.net, fx.inf],
  useGroups: () => [],
}))

const { MemoryRouter } = await import('react-router-dom')
const NumbersStage = (await import('./NumbersStage')).default
const { measuresFacets, scopeForNumbers } = await import('./NumbersStage')
const NumbersPanel = (await import('./NumbersPanel')).default
const { jumpFor } = await import('./NumbersPanel')
const { setLocale, t } = await import('../../lib/i18n')
const { EMPTY_FILTER, countActiveFacets, selectEntries } = await import('../../lib/entryFilter')
const { oldestBlockers } = await import('../../lib/aggregate')
const { todayIso } = await import('../../lib/dates')

const noop = (): void => {}

const renderStage = (compact = false): string =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={['/mindtree']}>
      <NumbersStage filter={EMPTY_FILTER} compact={compact} rtl={false} announce={noop} />
    </MemoryRouter>,
  )

const renderPanel = (): string =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={['/mindtree']}>
      <NumbersPanel filter={EMPTY_FILTER} compact={false} onJump={noop} />
    </MemoryRouter>,
  )

/** Both surfaces at once — the only way to see that they share one window. */
const renderBoth = (): string =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={['/mindtree']}>
      <NumbersStage filter={EMPTY_FILTER} compact={false} rtl={false} announce={noop} />
      <NumbersPanel filter={EMPTY_FILTER} compact={false} onJump={noop} />
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
 * series — the direction assertion is about slot ORDER within one chart, and
 * mixing four charts' bars into one list would make it meaningless. `[^"]*`
 * between the two classes rather than the literal string: the stacked segments
 * also carry `cht-band`, and a helper pinning the exact attribute value would
 * report a MIRRORING failure — zero bars — when the real change was a class
 * being added.
 */
function trackBarXs(html: string): number[] {
  return [
    ...html.matchAll(/<rect class="cht-bar[^"]*cht-c-(?:ok|stale|overdue|critical)" x="([\d.]+)"/g),
  ].map((m) => Number(m[1]))
}

const ctx = { meId: 'u1', today: '2026-07-30' as const }

afterEach(() => {
  setLocale('en')
  fx.state.entries = fx.entries
  fx.state.loading = false
  fx.state.error = null
  fx.state.truncated = false
  fx.state.slaMatrixError = null
  fx.state.closedError = null
})

describe('NumbersStage — the panels are there and they are wired', () => {
  it('renders all five panels', () => {
    const html = renderStage()
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
    expect(renderStage()).toContain(esc(t('dashboard.flowDesc', { count: 8 })))
  })

  it('counts untracked work as its own bar rather than dropping it', () => {
    // Entry 'd' has track_id null. The map has no "No track" NODE, so if this
    // chart dropped the pile too, the one place in the app that can show how
    // much unfiled work exists would be gone.
    expect(renderStage()).toContain(esc(t('dashboard.noTrack')))
  })

  it('carries NO digest link, because the shell header carries one at every lens', () => {
    // The dashboard had exactly one in-app entrance to /digest (Dashboard.tsx:
    // 344) and this stage inherited it — while `components/map/MapModeBar.tsx`
    // shipped another in the shell header, on EVERY lens. Two doors to one room.
    // The mode bar's is strictly wider, so this one went; the guarantee that
    // /digest is one tap from anywhere is asserted in ModeFrame.test.tsx
    // ("is one tap to meetings and one tap to the digest, at both widths").
    const html = renderStage()
    expect(html).not.toContain('href="/digest"')
    expect(html).not.toContain(esc(t('dashboard.goDigest')))
  })

  it('offers the window switch as chips, with the current one pressed', () => {
    const html = renderStage()
    expect(html).toContain(esc(t('dashboard.weeksOption', { count: 4 })))
    expect(html).toContain(esc(t('dashboard.weeksOption', { count: 12 })))
    // One chip, one interaction — never behind a disclosure.
    expect(countOf(html, 'aria-pressed="true"')).toBeGreaterThanOrEqual(1)
  })

  it('withholds only the subtitle on a phone, never a chart', () => {
    const wide = renderStage(false)
    const phone = renderStage(true)
    expect(wide).toContain(esc(t('dashboard.subtitle')))
    expect(phone).not.toContain(esc(t('dashboard.subtitle')))
    // The charts themselves are NOT compacted away: 375px is what the stage is
    // for once it has replaced the canvas.
    expect(phone).toContain(esc(t('dashboard.trackTitle')))
    expect(phone).toContain(esc(t('dashboard.ownerTitle')))
  })
})

describe('NumbersStage — chart accessibility', () => {
  it('names every svg as a group rather than an image', () => {
    // role="img" would make the focusable marks inside unreachable; see
    // Chart.tsx's header.
    const html = renderStage()
    expect(countOf(html, 'role="group"')).toBeGreaterThanOrEqual(4)
    expect(html).not.toContain('<svg class="cht-svg" role="img"')
  })

  it('gives every svg a title and a desc, wired by id', () => {
    const html = renderStage()
    const svgs = [...html.matchAll(/<svg[^>]*aria-labelledby="([^"]+)" aria-describedby="([^"]+)"/g)]
    expect(svgs.length).toBeGreaterThanOrEqual(4)
    for (const [, titleId, descId] of svgs) {
      expect(html).toContain(`<title id="${titleId}">`)
      expect(html).toContain(`<desc id="${descId}">`)
    }
  })

  it('describes the SHAPE of the data, not the title again', () => {
    const html = renderStage()
    // trackSummary names the busiest track and its count — a description worth
    // listening to, unlike a restatement of "Open work per track". Network holds
    // four OPEN items (a, b, e, f); the fifth on that track is done and
    // correctly absent.
    //
    // `count` is the TRACK count and `topCount` the busiest track's, not the
    // other way round: the string is a plural node and selectPlural inflects on
    // `count` alone (R3-I18N-1).
    expect(html).toContain(
      esc(t('dashboard.trackSummary', { count: 3, top: 'Network', topCount: 4 })),
    )
  })

  it('ships a table fallback per chart, with the numbers in it', () => {
    const html = renderStage()
    expect(countOf(html, esc(t('dashboard.showData')))).toBeGreaterThanOrEqual(4)
    expect(countOf(html, '<table class="cht-table')).toBeGreaterThanOrEqual(5)
    expect(html).toContain(esc(t('dashboard.colTrack')))
  })

  it('makes one mark per category focusable, and labels it in full', () => {
    const html = renderStage()
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
    const html = renderStage()
    expect(html).toContain(esc(t('dashboard.colOwner')))
    expect(html).toContain('Layla')
    expect(html).toContain('scope="row"')
  })

  it('keeps the age chart naming its own clock', () => {
    // A node has ONE size; the map can encode one clock at a time, so an overlay
    // that silently picked a basis would be actively misleading. Both ship, and
    // the chart renames its own description — which is what makes the chip
    // meaningful rather than decorative.
    const html = renderStage()
    expect(html).toContain(esc(t('dashboard.ageDescCreated')))
    expect(html).toContain(esc(t('dashboard.ageBasis')))
    expect(html).toContain(esc(t('dashboard.ageSinceUpdate')))
  })
})

describe('NumbersStage — RTL', () => {
  it('mirrors the inline axis instead of merely re-labelling it', () => {
    const ltr = trackBarXs(renderStage())
    setLocale('ar')
    const rtl = trackBarXs(renderStage())
    setLocale('en')

    expect(ltr.length).toBeGreaterThan(0)
    expect(rtl.length).toBe(ltr.length)
    // Slot 0 is the busiest track. In English it is the leftmost bar; in Arabic
    // it has to be the RIGHTMOST, or the ranking reads backwards to the reader
    // it was drawn for. There are no logical properties inside an <svg>: this is
    // geometry.ts resolving direction once, and it is the assertion that catches
    // any hand-written `x` arithmetic that passes in English (contract risk 8).
    expect(Math.min(...ltr)).toBe(ltr[0])
    expect(Math.max(...rtl)).toBe(rtl[0])
    expect(rtl[0]).toBeGreaterThan(ltr[0])
  })

  it('anchors the value-axis labels against the axis in both directions', () => {
    expect(renderStage()).toContain('text-anchor="end"')
    setLocale('ar')
    const html = renderStage()
    setLocale('en')
    expect(html).toContain('text-anchor="start"')
  })

  it('renders the Arabic strings, not the English ones', () => {
    setLocale('ar')
    const html = renderStage()
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

  it('renders the tiles in Arabic too', () => {
    setLocale('ar')
    const html = renderPanel()
    const arabic = t('dashboard.statUnassigned')
    setLocale('en')
    expect(html).toContain(esc(arabic))
    expect(html).not.toContain(esc(t('dashboard.statUnassigned')))
  })
})

describe('NumbersStage — states', () => {
  it('offers a way forward when the workspace is genuinely empty', () => {
    fx.state.entries = []
    const html = renderStage()
    expect(html).toContain(esc(t('dashboard.blank')))
    expect(html).toContain(esc(t('dashboard.blankHint')))
    // No charts at all: five empty panels are a wall, not an empty state.
    expect(html).not.toContain('cht-svg')
    // And NO capture link. The composer is mounted at the bottom of this same
    // shell at every lens and every stage, so a button that navigated to a
    // capture route would be a longer path to the field already on screen.
    expect(html).not.toContain('href="/capture"')
  })

  it('shows the error above the panels, with a retry, and keeps rendering', () => {
    fx.state.error = 'common.error'
    const html = renderStage()
    expect(html).toContain(esc(t('common.error')))
    expect(html).toContain(esc(t('common.retry')))
    expect(html).toContain('cht-svg')
  })

  it('caveats the totals when the working set was clipped', () => {
    fx.state.truncated = true
    expect(renderStage()).toContain(esc(t('dashboard.truncated')))
  })

  it('draws skeletons rather than empty axes while loading', () => {
    fx.state.loading = true
    const html = renderStage()
    expect(html).toContain('class="skeleton"')
    expect(html).not.toContain('cht-svg')
  })

  it('caveats compliance when the SLA matrix could not be read', () => {
    // The matrix lives in store/entries so that this surface and every list
    // resolve the same track × priority answer. The note is how a reader learns
    // the compliance figure was computed against the workspace default rather
    // than the track's actual commitment.
    expect(renderStage()).not.toContain(esc(t('dashboard.slaMatrixFailed')))
    fx.state.slaMatrixError = 'common.error'
    expect(renderStage()).toContain(esc(t('dashboard.slaMatrixFailed')))
  })

  it('says so when the closed window could not be read, and offers a retry', () => {
    // The throughput chart and SLA compliance are computed ENTIRELY from the
    // closed window, which is a separate read with its own failure mode. It used
    // to be swallowed — a dropped request rendered as a quiet month, the one
    // shape of wrong a report cannot recover from because nothing about it looks
    // wrong.
    expect(renderStage()).not.toContain(esc(t('dashboard.closedFailed')))
    fx.state.closedError = 'common.offline'
    const html = renderStage()
    expect(html).toContain(esc(t('dashboard.closedFailed')))
    expect(html).toContain(esc(t('common.retry')))
  })
})

describe('NumbersStage — the two pins', () => {
  it('opens the scope to `all` on the way OUT, never in filter state', () => {
    // Holding `scope: 'all'` in state made the filter bar claim "1 filter" on a
    // screen nobody had filtered — and its Clear-all then reset the scope and
    // silently emptied throughput and compliance of every closed row they exist
    // to count. Dashboard.test.tsx asserted this as "no `flt-count` on first
    // paint"; the bar now belongs to the shell, so the guarantee is restated
    // where it actually lives: the surface reads a widened COPY and the object
    // the shell holds is untouched.
    expect(scopeForNumbers(EMPTY_FILTER).scope).toBe('all')
    expect(EMPTY_FILTER.scope).toBe('open')
    expect(countActiveFacets(EMPTY_FILTER)).toBe(0)
    // Neither component takes a setter at all, which is the strongest form of
    // the same promise.
    expect(renderStage()).not.toContain('flt-count')
  })

  it('ignores the two facets these panels MEASURE, and says that it did', () => {
    // Three panels measure status and health (the SLA bars, the aging histogram,
    // the health-stacked track chart). Mindtree.tsx drops both chips from the
    // FilterBar while this lens is active — but dropping a CONTROL does not drop
    // the VALUE behind it, and the shell's filter is shared with four other
    // lenses. A reader who narrowed to `status: blocked` on the shape lens would
    // otherwise get an SLA figure over blocked work alone, with nothing on
    // screen saying so.
    const narrowed = { ...EMPTY_FILTER, statuses: ['blocked' as const], health: ['stale' as const] }
    const scoped = scopeForNumbers(narrowed)
    expect(scoped.statuses).toEqual([])
    expect(scoped.health).toEqual([])
    // The reader's own object is not mutated — the shell still holds what the
    // reader chose, and the other four lenses still honour it.
    expect(narrowed.statuses).toEqual(['blocked'])

    // A silent strip would be the worse bug: the bar above would count two
    // facets the numbers below had quietly dropped.
    expect(measuresFacets(EMPTY_FILTER)).toBe(false)
    expect(measuresFacets(narrowed)).toBe(true)
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/mindtree']}>
        <NumbersStage filter={narrowed} compact={false} rtl={false} announce={noop} />
      </MemoryRouter>,
    )
    expect(html).toContain(esc(t('dashboard.facetsIgnored')))
    expect(renderStage()).not.toContain(esc(t('dashboard.facetsIgnored')))
  })

  it('leaves every other facet alone — the population is the reader’s to choose', () => {
    const narrowed = { ...EMPTY_FILTER, trackIds: ['t-net'], search: 'dns', mine: true }
    const scoped = scopeForNumbers(narrowed)
    expect(scoped.trackIds).toEqual(['t-net'])
    expect(scoped.search).toBe('dns')
    expect(scoped.mine).toBe(true)
  })
})

describe('NumbersPanel — six numbers, no selection, no scroll', () => {
  it('shows all six tiles', () => {
    const html = renderPanel()
    for (const key of [
      'dashboard.statOpen',
      'dashboard.statOverdue',
      'dashboard.statQuiet',
      'dashboard.statBlocked',
      'dashboard.statUnassigned',
      'dashboard.statClosed',
    ]) {
      expect(html, key).toContain(esc(t(key)))
    }
  })

  it('needs no focused node — these are workspace totals', () => {
    // The whole point. A panel that required a selection first would cost 1 tap
    // plus 1 selection and still be unable to show the total, which recon named
    // the single most likely place the collapse costs keystrokes. The component
    // takes no node, and the six numbers are in the first paint.
    expect(renderPanel()).toContain('class="mnum-tiles"')
    expect(countOf(renderPanel(), 'mnum-tile-value')).toBe(6)
  })

  it('names the oldest blocker, at 0 clicks', () => {
    // 'e' is blocked since 60 days ago and 'f' is waiting_on since 20, so the
    // older of the two is the one named.
    expect(renderPanel()).toContain('Legacy DNS cutover')
  })

  it('counts blocked the WIDE way, so the tile equals the list it opens', () => {
    // Two definitions live one import apart. `aggregate.oldestBlockers` counts
    // `blocked` OR `waiting_on` (matching bucketFollowUps); the stubbed
    // `countEntries.blocked` says 1, counting only `blocked`. The tile must show
    // 2 — if it ever shows 1, it is reading the narrower number and the list it
    // jumps into will hold one more row than the tile promised.
    //
    // The day count comes back out of the same pure function the component
    // calls rather than being written down here: the fixture clock is relative,
    // so a literal would be right today and wrong tomorrow — which is exactly
    // the rot this file's header says it is avoiding.
    expect(fx.counts.blocked).toBe(1)
    const oldest = oldestBlockers(fx.entries, new Map(), todayIso(), 1)[0]
    expect(oldest.entry.id).toBe('e')
    expect(renderPanel()).toContain(
      esc(
        t('dashboard.tileJumpLabelNoted', {
          label: t('dashboard.statBlocked'),
          count: 2,
          note: t('dashboard.blockedOldest', { title: oldest.entry.title, count: oldest.days }),
          hint: t('dashboard.jumpBlocked'),
        }),
      ),
    )
  })

  it('puts the oldest blocker into the accessible NAME, not only the pixels', () => {
    // `aria-label` REPLACES the element's contents for assistive technology, so
    // the dashboard's `${label}: ${value}. ${linkLabel}` silently deleted the one
    // line on that screen naming the oldest stuck item. Every jumping tile's
    // accessible name must therefore carry its note.
    const html = renderPanel()
    const labels = [...html.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1])
    const blocked = labels.find((l) => l.includes(esc(t('dashboard.statBlocked'))))
    expect(blocked).toBeDefined()
    expect(blocked).toContain('Legacy DNS cutover')
    expect(blocked).toContain(esc(t('dashboard.jumpBlocked')))
  })

  it('makes the WHOLE tile the target, as a real button, fully named', () => {
    const html = renderPanel()
    // Five jump, one does not: there is no lens whose subject is finished work,
    // so a Closed tile that navigated would land the reader somewhere that does
    // not show what they tapped. A static tile is honest; a disabled control is
    // still a stop on the tab order.
    expect(countOf(html, '<button type="button" class="mnum-tile-face mnum-tile-jump"')).toBe(5)
    expect(html).toContain(
      esc(
        t('dashboard.tileJumpLabel', {
          label: t('dashboard.statOverdue'),
          count: fx.counts.overdue,
          hint: t('dashboard.jumpOverdue'),
        }),
      ),
    )
  })

  it('shares ONE window with the stage', () => {
    // The Closed tile and the throughput chart are six inches apart and count
    // the same weeks. loadClosedSince() keeps the WIDEST window ever asked for,
    // so a tile with its own `useState(8)` would still be counting twelve weeks
    // of done rows after the reader switched back to four — and contradicting
    // the chart under it.
    const html = renderBoth()
    expect(html).toContain(esc(t('dashboard.flowDesc', { count: 8 })))
    expect(html).toContain(esc(t('dashboard.statClosedNote', { count: 8 })))
  })
})

describe('NumbersPanel — one tap from a number to the list that acts on it', () => {
  it('sends every tile to a lens AND a filter, in one interaction', () => {
    expect(jumpFor('open').lens).toBe('by-status')
    for (const tile of ['overdue', 'quiet', 'blocked', 'unassigned'] as const) {
      expect(jumpFor(tile).lens, tile).toBe('needs-me')
    }
  })

  it('writes BOTH statuses and health on every jump, so two taps cannot intersect', () => {
    // Tap Overdue, then Blocked. A patch that only set its own field would leave
    // `health: ['overdue','critical']` behind and show blocked-AND-overdue work
    // under a tile that counted blocked.
    for (const tile of ['open', 'overdue', 'quiet', 'blocked', 'unassigned'] as const) {
      const { patch } = jumpFor(tile)
      expect(Object.keys(patch).sort(), tile).toEqual(
        tile === 'unassigned' ? ['health', 'owner', 'statuses'] : ['health', 'statuses'],
      )
    }
  })

  it('hands back fresh arrays, so two saved filters are not one object', () => {
    expect(jumpFor('blocked').patch.statuses).not.toBe(jumpFor('blocked').patch.statuses)
    expect(jumpFor('blocked').patch.statuses).toEqual(['blocked', 'waiting_on'])
  })

  it('touches no facet the tile did not count — `scope` above all', () => {
    // The map pins `scope: 'open'` OUTSIDE filter state so Clear-all cannot
    // change what the surface is about (contract risk 9). A jump that wrote a
    // scope into the filter would move that pin by the back door.
    for (const tile of ['open', 'overdue', 'quiet', 'blocked', 'unassigned'] as const) {
      expect(Object.keys(jumpFor(tile).patch), tile).not.toContain('scope')
      expect(Object.keys(jumpFor(tile).patch), tile).not.toContain('trackIds')
      expect(Object.keys(jumpFor(tile).patch), tile).not.toContain('search')
    }
    // Four of the five leave `owner` alone on purpose: the tile counted whatever
    // owner filter the reader already had, so the list must apply it too.
    expect(Object.keys(jumpFor('overdue').patch)).not.toContain('owner')
  })

  it('the blocked patch selects exactly the rows the blocked tile counted', () => {
    // The property that makes a number worth tapping. Both sides are real: the
    // aggregate on the left, the filter on the right.
    const counted = oldestBlockers(fx.entries, new Map(), '2026-07-30', Number.MAX_SAFE_INTEGER)
    const selected = selectEntries(
      fx.entries,
      { ...EMPTY_FILTER, ...jumpFor('blocked').patch },
      fx.state.health,
      ctx,
    )
    expect(selected.map((e) => e.id).sort()).toEqual(counted.map((b) => b.entry.id).sort())
    expect(selected.map((e) => e.id).sort()).toEqual(['e', 'f'])
  })

  it('the overdue patch does not lose the CRITICAL half of “overdue”', () => {
    // computeHealth resolves `days_overdue > 0` to `critical` when the priority
    // is critical, and to `overdue` otherwise — one condition, two labels. A
    // patch asking for `overdue` alone shows fewer rows than the tile counted,
    // and the miss is invisible until somebody's most urgent item is the one
    // that vanished.
    const health = new Map([
      ['h1', fx.health('h1', { health: 'overdue', days_overdue: 4 })],
      ['h2', fx.health('h2', { health: 'critical', days_overdue: 9, priority: 'critical' })],
    ])
    const both = selectEntries(
      fx.overdueRows,
      { ...EMPTY_FILTER, ...jumpFor('overdue').patch },
      health,
      ctx,
    )
    const narrow = selectEntries(
      fx.overdueRows,
      { ...EMPTY_FILTER, health: ['overdue'] },
      health,
      ctx,
    )
    expect(both.map((e) => e.id).sort()).toEqual(['h1', 'h2'])
    expect(narrow.map((e) => e.id)).toEqual(['h1'])
  })

  it('the unassigned patch selects the rows with nobody on them', () => {
    const selected = selectEntries(
      fx.entries,
      { ...EMPTY_FILTER, ...jumpFor('unassigned').patch },
      fx.state.health,
      ctx,
    )
    // a, e and f carry neither an owner_id nor an owner_name. 'd' has a
    // free-text owner and is NOT unassigned; 'g' is closed and out of scope.
    expect(selected.map((e) => e.id).sort()).toEqual(['a', 'e', 'f'])
  })
})

// WHAT IS DELIBERATELY NOT HERE: an assertion over `map-numbers.css`. Reading
// the sheet with `import.meta.glob(..., { query: '?raw' })` and running the
// house's physical-property grep over it LOOKS right and fails silently —
// vitest.config.ts sets no `css` option, so the default stubs every `.css`
// import to the empty string, `?raw` and all. The glob resolves, the key is
// there, the value is `''`, and every assertion over it passes forever while
// checking nothing. Verified by probe before this note was written. The sheet is
// covered by the §T2 standing grep, as the repo's other sheets are.
