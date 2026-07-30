// Render proof for the track timeline.
//
// WHY renderToStaticMarkup AND NOT A DOM. vitest.config.ts is
// `environment: 'node'` and jsdom is not in the dependency budget — Board.test,
// FollowUps.test and the entry kit's own test all open with this paragraph.
// react-dom/server exercises the real tree, the real vocabulary resolution, the
// real permission check and the real i18n bundle, and hands back markup.
//
// WHAT A STATIC RENDER CAN SEE HERE, and it is more than it looks: the window
// fetch is an effect and effects do not run on the server, so `rows` is null
// throughout this file — which means everything asserted below is coming
// through the LIVE OVERLAY (mergeEntriesById over `useEntryList()`), the exact
// path that makes the first paint of a real visit non-empty. That is worth
// pinning: the progressive-render decision is invisible in the happy case and
// the only thing standing between the reader and a skeleton on every navigation.
//
// WHAT IT CANNOT SEE, and therefore claims nothing about: update rows and the
// day grouping around them (they arrive only from api/timeline), the range and
// search controls once clicked, and the truncation notice. The interleave those
// rows participate in — order, tiebreaks, windowing, search, the parent lookup —
// is arithmetic in lib/timeline.ts and is asserted there, without a DOM, in 36
// cases. This file covers the half a server render can prove and an audit asks
// about: that the header describes the right track, that the counts are the
// shared definitions rather than a local recount, that the SLA tile stays away
// until an admin arms an SLA, that the URL is genuinely the state, that the tag
// breakdown reaches the track's own suggestions, and that a bad deep link says
// so instead of rendering an empty page.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import type { Entry, EntryHealth, Track } from '../../types'

const fx = vi.hoisted(() => {
  // lib/i18n reads localStorage at module scope, store/config adds a window
  // focus listener at module scope, lib/theme reads matchMedia — all three at
  // IMPORT time, so the shims cannot wait for a beforeAll().
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

  const entry = (over: Partial<Entry> & Pick<Entry, 'id' | 'title'>): Entry => ({
    track_id: 't-onb',
    description: '',
    type: 'action',
    status: 'in_progress',
    priority: 'medium',
    owner_id: null,
    owner_name: null,
    requester: null,
    due_date: null,
    follow_up_date: null,
    tags: [],
    links: [],
    created_by: 'u1',
    created_at: '2026-07-15T09:00:00.000Z',
    updated_at: '2026-07-20T09:00:00.000Z',
    closed_at: null,
    last_activity_at: '2026-07-20T09:00:00.000Z',
    meeting_id: null,
    template_id: null,
    ...over,
  })

  const health = (id: string, over: Partial<EntryHealth> = {}): EntryHealth => ({
    id,
    entry_id: id,
    track_id: 't-onb',
    status: 'in_progress',
    priority: 'medium',
    due_date: null,
    last_activity_at: '2026-07-20T09:00:00.000Z',
    days_since_activity: 9,
    days_overdue: 0,
    health: 'ok',
    sla_due_at: null,
    sla_breached: false,
    ...over,
  })

  const track = (over: Partial<Track> & Pick<Track, 'id' | 'name'>): Track => ({
    name_ar: '',
    description: '',
    description_ar: '',
    color: '#8b7bf5',
    color_light: null,
    icon: 'users',
    suggested_tags: [],
    sort_order: 0,
    archived: false,
    archived_at: null,
    created_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  })

  // The motivating case, verbatim from the live project: Onboarding suggests
  // direct-integration and portal, and the useful fact about the track is never
  // "six open items", it is how they split.
  const onboarding = track({
    id: 't-onb',
    name: 'Onboarding',
    name_ar: 'الانضمام',
    description: 'Bringing a new partner onto the platform.',
    description_ar: 'إدخال شريك جديد إلى المنصة.',
    suggested_tags: ['direct-integration', 'portal'],
  })
  const network = track({ id: 't-net', name: 'Network', name_ar: 'الشبكات', sort_order: 1 })

  const entries: Entry[] = [
    entry({ id: 'a', title: 'Acme direct integration', tags: ['direct-integration'], created_at: '2026-07-20T09:00:00.000Z' }),
    entry({ id: 'b', title: 'Beta portal onboarding', tags: ['portal'], created_at: '2026-07-18T09:00:00.000Z' }),
    entry({ id: 'c', title: 'Both routes for Contoso', tags: ['portal', 'direct-integration'], created_at: '2026-07-18T15:00:00.000Z' }),
    entry({ id: 'd', title: 'Untagged legal review', created_at: '2026-07-16T09:00:00.000Z' }),
    // Another track entirely: it must never appear on this page.
    entry({ id: 'z', title: 'Core switch upgrade', track_id: 't-net', created_at: '2026-07-19T09:00:00.000Z' }),
  ]

  const members = [
    { id: 'u1', displayName: 'Me', role: 'member' as const },
    { id: 'u2', displayName: 'Layla', role: 'member' as const },
  ]

  const state: {
    entries: Entry[]
    health: Map<string, EntryHealth>
    truncated: boolean
    counts: { open: number; overdue: number; stale: number; blocked: number; unassigned: number }
    tracks: Track[]
    configLoading: boolean
  } = {
    entries,
    health: new Map(entries.map((e) => [e.id, health(e.id)])),
    truncated: false,
    counts: { open: 4, overdue: 1, stale: 2, blocked: 1, unassigned: 3 },
    tracks: [onboarding, network],
    configLoading: false,
  }

  return { entry, health, entries, onboarding, network, members, state, mem }
})

/**
 * The window loader never resolves in a static render — effects do not run —
 * but the module still has to import, and mocking it keeps api/supabase (and
 * therefore createClient) out of the graph entirely.
 */
vi.mock('../../api/timeline', () => ({
  loadTrackTimeline: () =>
    Promise.resolve({ ok: true, data: { entries: [], updates: [], truncated: false } }),
}))

vi.mock('../../store/entries', () => ({
  useEntryList: () => fx.state.entries,
  // The screen asks for the track's OPEN work; the real selectEntries does the
  // filtering, so the mock answers the same question the store would.
  useFilteredEntries: () => fx.state.entries.filter((e) => e.track_id === 't-onb'),
  useEntryCounts: () => ({
    total: fx.state.counts.open,
    closed: 0,
    dueThisWeek: 0,
    ...fx.state.counts,
  }),
  useHealthMap: () => fx.state.health,
  useEntriesTruncated: () => fx.state.truncated,
  loadEntries: () => Promise.resolve(),
}))

vi.mock('../../store/vocab', () => ({
  useVocabLabel: () => (_kind: string, key: string) => `L:${key}`,
  useVocabColor: () => () => null,
  useVocabAll: () => [],
  useVocab: () => [],
  useStaleDays: () => () => 8,
  useSlaDays: () => () => null,
}))

vi.mock('../../store/members', () => ({
  useMembers: () => fx.members,
  useMemberMap: () => new Map(fx.members.map((m) => [m.id, m])),
  useMemberLabel:
    () =>
    (ownerId?: string | null, ownerName?: string | null): string =>
      fx.members.find((m) => m.id === ownerId)?.displayName ?? ownerName?.trim() ?? 'Unassigned',
}))

vi.mock('../../store/config', () => ({
  useTrackMap: () => new Map(fx.state.tracks.map((tr) => [tr.id, tr])),
  useConfigLoading: () => fx.state.configLoading,
  useActiveTracks: () => fx.state.tracks,
}))

vi.mock('../../store/auth', () => ({
  useAuth: () => ({
    session: null,
    profile: { id: 'u1', displayName: 'Me', role: 'member', locale: null },
    loading: false,
  }),
}))

vi.mock('../../store/entrySheet', () => ({ openEntry: () => {} }))

const { MemoryRouter, Route, Routes } = await import('react-router-dom')
const TrackTimeline = (await import('./TrackTimeline')).default
const { setLocale, t } = await import('../../lib/i18n')
const { lastNDays, todayIso } = await import('../../lib/dates')

/** The screen at a URL — the range, the search and the kind all live there. */
function render(url = '/tracks/t-onb'): string {
  const tree: ReactElement = (
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/tracks/:id" element={<TrackTimeline />} />
      </Routes>
    </MemoryRouter>
  )
  return renderToStaticMarkup(tree)
}

afterEach(() => {
  setLocale('en')
  fx.state.entries = fx.entries
  fx.state.health = new Map(fx.entries.map((e) => [e.id, fx.health(e.id)]))
  fx.state.truncated = false
  fx.state.counts = { open: 4, overdue: 1, stale: 2, blocked: 1, unassigned: 3 }
  fx.state.tracks = [fx.onboarding, fx.network]
  fx.state.configLoading = false
  fx.mem.clear()
})

/* ──────────────────────── the namespace registration ───────────────────── */

describe('track locale namespace', () => {
  // `src/locales/index.ts` is integrator-only (§1.0.2), so this worker ships
  // `{en,ar}/track.json` and CANNOT wire them in. Until the integrator does,
  // every t('track.*') on the screen falls through to echoing its own dot path
  // — in both languages, at a user — and NOTHING ELSE CATCHES IT: localeParity
  // compares registered bundles, and localeReach skips any key whose root is
  // not already a root. That is the exact failure FIX-BACKLOG records for the
  // eight `admin.tracks.sla*` keys in Wave 2.
  //
  // DO NOT DELETE THIS ASSERTION TO GET A GREEN RUN. The fix is six lines in
  // src/locales/index.ts:
  //   import enTrack from './en/track.json'    import arTrack from './ar/track.json'
  //   EN_NAMESPACES: { …, track: enTrack }     AR_NAMESPACES: { …, track: arTrack }
  //   export const en = { …, ...enTrack }      export const ar = { …, ...arTrack }
  // Verified locally against a temporary registration: with it applied,
  // localeParity and localeReach both pass over this namespace and the three
  // locale-sensitive cases below (the untagged row, and both Arabic ones) go
  // green with it.
  it('is registered in src/locales/index.ts', () => {
    expect(t('track.feed')).not.toBe('track.feed')
  })
})

/* ─────────────────────────────── identity ─────────────────────────────── */

describe('the header', () => {
  it('names the track from the route parameter and describes it', () => {
    const html = render()
    expect(html).toContain('Onboarding')
    expect(html).toContain('Bringing a new partner onto the platform.')
    expect(html).toContain(t('track.back'))
  })

  it('paints the track colour as a custom-property pair, never as a resolved hex', () => {
    // The whole point of trackVars: CSS picks between the two on data-theme, so
    // a theme flip at sunset re-cascades without a re-render.
    const html = render()
    expect(html).toContain('--track-c-dark:#8b7bf5')
    expect(html).toContain('--track-c-light:#8b7bf5')
  })

  it('shows the shared counts, and labels them as "right now"', () => {
    const html = render()
    expect(html).toContain(t('track.now'))
    for (const key of ['statOpen', 'statOverdue', 'statStale', 'statBlocked', 'statUnassigned']) {
      expect(html).toContain(t(`track.${key}`))
    }
    expect(html).toContain(t('track.statsHint'))
  })

  it('keeps the SLA tile away until an admin has armed an SLA', () => {
    // 0005 ships every priority's sla_days NULL, so "0 past SLA" would be a
    // reassurance nobody configured.
    expect(render()).not.toContain(t('track.statSla'))

    fx.state.health = new Map(
      fx.entries.map((e) => [
        e.id,
        fx.health(e.id, { sla_due_at: '2026-07-25T00:00:00.000Z', sla_breached: e.id === 'a' }),
      ]),
    )
    expect(render()).toContain(t('track.statSla'))
  })

  it('says so when the working set is a window rather than everything', () => {
    expect(render()).not.toContain(t('track.statsPartial'))
    fx.state.truncated = true
    expect(render()).toContain(t('track.statsPartial'))
  })
})

/* ──────────────────────────── the URL is the state ─────────────────────── */

describe('the range, search and kind controls', () => {
  it('reads the range out of the query string', () => {
    const html = render('/tracks/t-onb?from=2026-07-01&to=2026-07-25')
    expect(html).toContain('value="2026-07-01"')
    expect(html).toContain('value="2026-07-25"')
  })

  it('clamps a hand-edited link whose start is after its end', () => {
    const html = render('/tracks/t-onb?from=2026-08-30&to=2026-07-25')
    // Collapsed to a single day, which is predictable; a silent swap is not.
    expect(html).toContain('value="2026-07-25"')
    expect(html).not.toContain('value="2026-08-30"')
  })

  it('clamps a range reaching into the future back to today', () => {
    // A history has nothing in tomorrow, and a date input handed a value past
    // its own `max` is an invalid control in every browser.
    const html = render('/tracks/t-onb?from=2026-07-01&to=2099-01-01')
    expect(html).not.toContain('value="2099-01-01"')
    expect(html).toContain(`value="${todayIso()}"`)
  })

  it('ignores a range parameter that is not a calendar date', () => {
    const html = render('/tracks/t-onb?from=lastTuesday&to=2026-07-25')
    expect(html).not.toContain('lastTuesday')
    expect(html).toContain('value="2026-07-25"')
  })

  it('puts the search term back in the box', () => {
    expect(render('/tracks/t-onb?q=portal')).toContain('value="portal"')
  })

  it('marks the kind the link asked for, and defaults to everything', () => {
    const all = render('/tracks/t-onb')
    // aria-pressed on the "Everything" chip, which is first in the group.
    expect(all).toContain(`aria-pressed="true">${t('track.kindAll')}`)
    const updates = render('/tracks/t-onb?kind=update')
    expect(updates).toContain(`aria-pressed="true">${t('track.kindUpdate')}`)
    expect(updates).not.toContain(`aria-pressed="true">${t('track.kindAll')}`)
  })

  it('marks the preset chip that matches the range exactly', () => {
    const span = lastNDays(7)
    const html = render(`/tracks/t-onb?from=${span.from}&to=${span.to}`)
    expect(html).toContain(`aria-pressed="true">${t('track.rangeLast', { count: 7 })}`)
  })
})

/* ─────────────────────────────── the feed ─────────────────────────────── */

describe('the feed, from the live overlay', () => {
  it('renders this track\'s items on first paint, before any fetch resolves', () => {
    const html = render('/tracks/t-onb?from=2026-07-01&to=2026-07-25')
    expect(html).toContain('Acme direct integration')
    expect(html).toContain('Untagged legal review')
    // A skeleton would mean the progressive render regressed to blocking.
    expect(html).not.toContain(t('common.loading'))
  })

  it('never shows another track\'s work', () => {
    expect(render('/tracks/t-onb?from=2026-07-01&to=2026-07-25')).not.toContain('Core switch upgrade')
  })

  it('orders newest first and groups by day', () => {
    const html = render('/tracks/t-onb?from=2026-07-01&to=2026-07-25')
    const acme = html.indexOf('Acme direct integration')
    const contoso = html.indexOf('Both routes for Contoso')
    const legal = html.indexOf('Untagged legal review')
    expect(acme).toBeGreaterThan(-1)
    expect(acme).toBeLessThan(contoso)
    expect(contoso).toBeLessThan(legal)
  })

  it('honours the window in the URL', () => {
    const html = render('/tracks/t-onb?from=2026-07-19&to=2026-07-25')
    expect(html).toContain('Acme direct integration')
    expect(html).not.toContain('Untagged legal review')
  })

  it('honours the search in the URL', () => {
    const html = render('/tracks/t-onb?from=2026-07-01&to=2026-07-25&q=portal')
    expect(html).toContain('Beta portal onboarding')
    expect(html).toContain('Both routes for Contoso')
    expect(html).not.toContain('Untagged legal review')
  })

  it('shows a skeleton, not an empty state, while the window is still in flight', () => {
    // The two empty states are only reachable once the fetch has ANSWERED, and
    // a static render never gets there. What is reachable — and what actually
    // regressed once — is the other side of that fork: an empty overlay must
    // read as "we have not asked yet", never as "nothing happened here".
    const html = render('/tracks/t-onb?from=2020-01-01&to=2020-01-31')
    expect(html).toContain(t('common.loading'))
    expect(html).not.toContain(t('track.empty'))
    expect(html).not.toContain(t('track.emptyTrack'))
  })
})

/* ────────────────────────── the tag breakdown ─────────────────────────── */

describe('the tag breakdown', () => {
  it("leads with the track's own suggested tags", () => {
    const html = render('/tracks/t-onb?from=2026-07-01&to=2026-07-25')
    expect(html).toContain(t('track.tags'))
    const direct = html.indexOf('direct-integration')
    const portal = html.indexOf('portal')
    expect(direct).toBeGreaterThan(-1)
    expect(portal).toBeGreaterThan(-1)
    // The admin's order, not alphabetical.
    expect(direct).toBeLessThan(portal)
  })

  it('states each row once, as a sentence, for a reader who cannot see the bar', () => {
    const html = render('/tracks/t-onb?from=2026-07-01&to=2026-07-25')
    expect(html).toContain(
      t('track.tagsRow', { tag: 'direct-integration', open: 2, closed: 0 }),
    )
    expect(html).toContain(t('track.tagsRow', { tag: 'portal', open: 2, closed: 0 }))
  })

  it('adds an untagged row only when something is untagged', () => {
    const html = render('/tracks/t-onb?from=2026-07-01&to=2026-07-25')
    expect(html).toContain(t('track.tagsRow', { tag: t('track.tagsNone'), open: 1, closed: 0 }))

    const narrow = render('/tracks/t-onb?from=2026-07-18&to=2026-07-25')
    expect(narrow).not.toContain(t('track.tagsRow', { tag: t('track.tagsNone'), open: 1, closed: 0 }))
  })

  it('says so, and how to fix it, when a track suggests nothing and the window is bare', () => {
    // The untagged row is enough to keep the chart alive, so the empty state
    // needs BOTH halves gone: no suggestions on the track, and no items in the
    // window to be untagged.
    fx.state.tracks = [{ ...fx.onboarding, suggested_tags: [] }, fx.network]
    const html = render('/tracks/t-onb?from=2020-01-01&to=2020-01-31')
    expect(html).toContain(t('track.tagsEmpty'))
    expect(html).toContain(t('track.tagsEmptyHint'))
  })
})

/* ─────────────────────────── a bad deep link ──────────────────────────── */

describe('an unknown track', () => {
  it('says so and offers the way back, once the track list has actually loaded', () => {
    const html = render('/tracks/t-nope')
    expect(html).toContain(t('track.notFound'))
    expect(html).toContain(t('track.notFoundHint'))
  })

  it('waits rather than accusing a good link of being bad on a cold load', () => {
    // The track map is empty for a moment on every cold start; flashing "no such
    // track" and withdrawing it is worse than a skeleton.
    fx.state.tracks = []
    fx.state.configLoading = true
    const html = render('/tracks/t-onb')
    expect(html).not.toContain(t('track.notFound'))
    expect(html).toContain(t('common.loading'))
  })
})

/* ──────────────────────────────── Arabic ──────────────────────────────── */

describe('Arabic', () => {
  it('uses the track\'s Arabic name and description', () => {
    setLocale('ar')
    const html = render('/tracks/t-onb?from=2026-07-01&to=2026-07-25')
    expect(html).toContain('الانضمام')
    expect(html).toContain('إدخال شريك جديد إلى المنصة.')
    expect(html).not.toContain('Bringing a new partner onto the platform.')
  })

  it('translates every band, and keeps the range in Latin numerals', () => {
    setLocale('ar')
    const html = render('/tracks/t-onb?from=2026-07-01&to=2026-07-25')
    expect(html).toContain(t('track.feed'))
    expect(html).toContain(t('track.tags'))
    expect(html).toContain(t('track.now'))
    // Spec §5: Gregorian calendar, Latin digits, in both languages. Intl slips
    // a U+200F RLM between the parts of an Arabic date — correct, and invisible
    // — so the assertion strips the marks rather than pretending they are not
    // there. What it is actually proving is that the digits are 0-9 and the
    // year is 2026 and not 1448.
    const plain = html.replace(/[‎‏]/g, '')
    expect(plain).toContain('01/07/2026')
    expect(plain).toContain('25/07/2026')
  })

  it('isolates a Latin tag inside an Arabic sentence', () => {
    setLocale('ar')
    const html = render('/tracks/t-onb?from=2026-07-01&to=2026-07-25')
    // U+2068 FSI … U+2069 PDI around the interpolated value: without them the
    // guillemet-free Arabic row still reorders `direct-integration` against the
    // digits beside it.
    expect(html).toContain('⁨direct-integration⁩')
  })
})
