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
  const team = [
    { id: 'u1', displayName: 'Me', role: 'member' as const },
    { id: 'u2', displayName: 'Layla', role: 'member' as const },
    { id: 'u3', displayName: 'Omar', role: 'admin' as const },
  ]

  const state: {
    entries: Entry[]
    health: Map<string, EntryHealth>
    loading: boolean
    error: string | null
    members: { id: string; displayName: string; role: 'member' | 'admin' }[]
  } = {
    entries,
    health: healthRows,
    loading: false,
    error: null,
    members: [],
  }

  const empty: Entry[] = []

  return { TODAY, CREATED, state, entry, entries, healthRows, empty, team }
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
  // Declared even though a static render never fires it: Vitest's module mock
  // is a proxy that throws on an export the factory does not name, so an
  // omission here would turn the first interactive test of "Mark done" into a
  // confusing module error rather than an assertion failure.
  setStatus: () => Promise.resolve({ ok: false, error: 'common.error' }),
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
  // Mutable, and EMPTY by default: the assign control (R3-PRODUCT-5) is the
  // only reader that cares, and every other case in this file was written
  // against a workspace with no member list. The two blocks that need people
  // set `fx.state.members` and put it back.
  useMembers: () => fx.state.members,
  useMemberLabel:
    () =>
    (ownerId?: string | null, ownerName?: string | null): string =>
      ownerId ?? ownerName?.trim() ?? '',
  // NudgeButton resolves the asker's live display name through this map, per
  // api/notifications.ts's contract (the profile first, never a snapshot alone).
  // Empty is the right default here for the same reason `useMembers` is: this
  // file's cases were written against a workspace with no member list, and an
  // unresolvable asker falls back to `nudge.someone`.
  useMemberMap: () => new Map(),
}))

// The nudge overlay (store/nudges) holds only asks made in THIS session, over
// `entries.nudged_at` on the row. Empty means "this session has asked nothing",
// which is every case in this file: the rows below carry no nudge columns, so
// every nudgeable row renders the ask button and none renders a record.
vi.mock('../store/nudges', () => ({
  useLocalAsk: () => undefined,
  sendNudge: () => Promise.resolve({ ok: false, error: 'nudge.errFailed' }),
}))

vi.mock('../store/config', () => ({
  useTrackMap: () => new Map(),
  useActiveTracks: () => [],  // FilterBar reads the workspace's groups for its Group facet (0018). Empty
  // here on purpose: this screen's tests are about ITS surface, and the facet
  // renders nothing without groups — which is also the pre-migration state.
  useGroups: () => [],
}))

vi.mock('../store/auth', () => ({
  useAuth: () => ({ session: null, profile: { id: 'u1', displayName: 'Me', role: 'member', locale: null }, loading: false }),
}))

const { MemoryRouter } = await import('react-router-dom')
const FollowUps = (await import('./FollowUps')).default
const { buildSlaFacts, postQuickUpdate } = await import('./FollowUps')
const { t } = await import('../lib/i18n')

// The screen's own source, for the row-identity block at the bottom. Read
// through import.meta.glob('?raw') rather than node:fs, for the reason
// lib/localeReach.test.ts gives: tsconfig.app.json pins `types:
// ["vite/client"]`, and widening it to include "node" would leak node globals
// into the type space of every app file.
const SOURCES: Record<string, string> = import.meta.glob('./FollowUps.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
})
const FOLLOWUPS_SOURCE = SOURCES['./FollowUps.tsx'] ?? ''

const render = (node: ReactElement): string =>
  renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>)

/** The screen at a URL — since R3-PRODUCT-2 the filter lives in the query string. */
const renderAt = (url: string): string =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={[url]}>
      <FollowUps />
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

  it('can FINISH an item from the row, not only defer one', () => {
    // The gap this closes: the row could take, comment on and snooze an item
    // but not complete it, so the most common outcome of a morning pass was the
    // only one that needed the sheet — open it, scroll past the description,
    // tap the status chip, dismiss. `followups.markDone` shipped translated in
    // both bundles with ZERO call sites, which is what a designed-then-dropped
    // action looks like. There is no keyboard fallback either: the 1-4 status
    // hotkeys act on the detail surface, not on a focused list row.
    const html = render(<FollowUps />)
    expect(countOf(html, `class="fu-act-label">${esc(t('followups.markDone'))}<`)).toBe(
      fx.entries.length,
    )
    expect(countOf(html, 'fu-act-done')).toBe(fx.entries.length)
  })
})

/* ═════════════ R3-PRODUCT-2 · the filter is the URL, not component state ═════════════ */
//
// WHAT BROKE. The filter was `useState({ ...EMPTY_FILTER })` and Follow-ups is a
// LAZY ROUTE, so every trip to the board and back remounted the screen and reset
// search, track, tag, health and the Mine/Everyone segment — while `densityPref`,
// a module-level cosmetic preference twelve lines above it, was deliberately kept
// across exactly that trip. Two adjacent chip-pairs, one persisting and one
// forgetting, on a phone where the tab bar makes the round trip one thumb-tap.
//
// The remount cannot be reproduced in a static render, so what is asserted here
// is the property that makes it moot: the URL, and nothing else, decides what the
// screen is filtered to. A screen that reads its filter out of the query string
// is a screen that survives a remount, a reload and a pasted link, and those are
// the same fix.

describe('FollowUps — the filter round-trips through the URL', () => {
  it('reads the Mine/Everyone segment out of the query string', () => {
    // aria-pressed on both chips, because "Mine is on" and "Everyone is off" are
    // two different claims and a segment that got only the first one right would
    // announce two pressed options.
    const mine = renderAt('/?mine=1')
    expect(mine).toContain(`aria-pressed="true">${esc(t('followups.whoseMine'))}<`)
    expect(mine).toContain(`aria-pressed="false">${esc(t('followups.whoseAll'))}<`)

    const everyone = renderAt('/')
    expect(everyone).toContain(`aria-pressed="true">${esc(t('followups.whoseAll'))}<`)
    expect(everyone).toContain(`aria-pressed="false">${esc(t('followups.whoseMine'))}<`)
  })

  it('puts the search term from the link back in the box', () => {
    expect(renderAt('/?q=switch')).toContain('value="switch"')
    expect(renderAt('/')).not.toContain('value="switch"')
  })

  it('carries a track facet through, so a triage view is a pasteable link', () => {
    // Counted rather than named: the track facet's OPTIONS come from
    // useActiveTracks, which is mocked empty here, so the id itself is not drawn.
    // What is drawn is FilterBar's active-facet pill — and that pill is defined
    // through countActiveFacets, the same function isFilterEmpty is, so a facet
    // that reached it reached the filter.
    expect(renderAt('/?track=t-net')).toContain('class="pill flt-count" aria-hidden="true">1<')
    expect(renderAt('/')).not.toContain('class="pill flt-count"')
  })

  it('drops a scope this screen has no control for', () => {
    // `bucketFollowUps` never buckets a closed entry, so `?scope=closed` from a
    // hand-edited or inherited URL would be a filter the user can neither see
    // nor switch off — and, left in `filter`, one the empty state would blame.
    fx.state.entries = fx.empty
    try {
      const html = renderAt('/?scope=closed')
      expect(html).toContain(esc(t('followups.allClear')))
      expect(html).not.toContain(esc(t('followups.empty')))
      // The contrast case: a facet this screen DOES own still reads as filtered.
      const filtered = renderAt('/?q=nothing-matches-this')
      expect(filtered).toContain(esc(t('followups.empty')))
      expect(filtered).toContain(esc(t('followups.clearFilters')))
    } finally {
      fx.state.entries = fx.entries
    }
  })

  it('holds no filter in component state', () => {
    // The source claim behind all four above, in the idiom this file already
    // uses for handleOpen: a `useState` seeded from EMPTY_FILTER is the exact
    // shape of the defect, and it is what a well-meaning later edit would
    // reintroduce while leaving the URL reads in place.
    expect(FOLLOWUPS_SOURCE).not.toMatch(/useState<FilterState>/)
    expect(FOLLOWUPS_SOURCE).toContain('filterFromParams(params)')
    expect(FOLLOWUPS_SOURCE).toContain('setParams(filterToParams(next), { replace: true })')
  })
})

/* ══════════ R3-PRODUCT-5 · the Unassigned bucket can assign, not only take ══════════ */
//
// WHAT BROKE. The one bucket that exists BECAUSE nobody owns the work offered
// exactly one owner-related control, and it assigned the item to the reader.
// The owner badge beside it is a plain <span> with no handler (atoms.tsx), and
// nothing on the screen linked to a surface that could assign — so for a
// department head with six tracks, distributing the morning's unowned work meant
// opening each item and scrolling to its owner picker. "Take it" is the right
// answer for one person and the wrong verb for a lead.

/* ────────────── the chase: where this screen offers to ask ────────────── */
//
// TWO RULES, TWO OWNERS, and this block only tests the one that belongs here.
// `NudgeButton.canNudge` decides WHO can be asked (not yourself, not a row with
// no member owning it) and is tested in that file; `NUDGEABLE` decides WHICH
// BUCKETS asking is fair in, and that is a judgement about this screen's
// sections, so it is tested against this screen's rendered output.
//
// The default fixture owns nothing — every row is `owner_name: 'Vendor'` with a
// null owner_id — so no button appears anywhere in the rest of this file. These
// cases swap in a set owned by a real teammate and put it back.
describe('FollowUps — asking a colleague for an update', () => {
  const owned = (over: Partial<Entry> & Pick<Entry, 'id' | 'title'>): Entry =>
    fx.entry({ owner_id: 'u2', owner_name: null, ...over })

  const withEntries = (entries: Entry[], run: (html: string) => void): void => {
    const before = fx.state.entries
    fx.state.entries = entries
    try {
      run(render(<FollowUps />))
    } finally {
      fx.state.entries = before
    }
  }

  it('offers the ask on a colleague’s late, breached, quiet or blocked row', () => {
    // The four buckets that name a fact the owner would want to know about: a
    // promise already missed, a service window already blown, an item gone
    // silent, or one stuck and possibly waiting on the asker.
    withEntries(
      [
        owned({ id: 'a', title: 'Overdue one', due_date: '2026-07-20' }),
        owned({ id: 'b', title: 'Breach by default' }),
        owned({ id: 'e', title: 'Quiet one' }),
        owned({ id: 'f', title: 'Blocked one', status: 'blocked' }),
      ],
      (html) => {
        expect(countOf(html, esc(t('nudge.ask')))).toBe(4)
      },
    )
  })

  it('does NOT offer it on an item that is merely due soon', () => {
    // NOTHING HAS GONE WRONG YET. An item due Thursday, on Tuesday, with its
    // owner working on it, is the single easiest way to turn this button into
    // the thing colleagues learn to ignore — and no amount of careful copy saves
    // a request that had no reason to be sent.
    withEntries([owned({ id: 'd', title: 'Due soon one', due_date: '2026-07-31' })], (html) => {
      expect(html).toContain(esc(t('followups.dueSoon')))
      expect(html).not.toContain(esc(t('nudge.ask')))
    })
  })

  it('does NOT offer it in the Unassigned bucket, which has nobody to ask', () => {
    // By construction: bucketFollowUps puts a row there only when BOTH owner
    // columns are empty. That bucket already carries the two controls that fix
    // it — take it, assign it — and those are the right answer to an unowned
    // item, not "chase".
    withEntries([fx.entry({ id: 'g', title: 'Nobody owns me', owner_name: null })], (html) => {
      expect(html).toContain(esc(t('followups.unassigned')))
      expect(html).not.toContain(esc(t('nudge.ask')))
    })
  })

  it('does NOT offer it on your own row', () => {
    // The mocked profile is `u1`. Chasing yourself is a joke the second time and
    // noise the third; 0019 refuses it too, so the affordance and the policy
    // agree rather than the user meeting a refusal.
    withEntries([owned({ id: 'e', title: 'Quiet one', owner_id: 'u1' })], (html) => {
      expect(html).toContain(esc(t('followups.stale')))
      expect(html).not.toContain(esc(t('nudge.ask')))
    })
  })
})

describe('FollowUps — the Unassigned bucket hands work to someone', () => {
  const withTeam = (run: () => void): void => {
    fx.state.members = fx.team
    try {
      run()
    } finally {
      fx.state.members = []
    }
  }

  it('offers the assign control on the unassigned rows and nowhere else', () => {
    withTeam(() => {
      const html = render(<FollowUps />)
      // One row is unassigned in the fixture ('g'), and it is the only one that
      // may hand work on — everywhere else the owner question is answered and
      // this control would be a way to reroute someone's work from a list.
      expect(countOf(html, 'class="select fu-owner"')).toBe(1)
      expect(countOf(html, `class="fu-act-label">${esc(t('followups.takeIt'))}<`)).toBe(1)
    })
  })

  it('lists every teammate as a destination, under a labelled control', () => {
    withTeam(() => {
      const html = render(<FollowUps />)
      for (const m of fx.team) expect(html).toContain(`<option value="${m.id}">${m.displayName}</option>`)
      // Named for the ROW, because six of these can be on screen at once and
      // "Assign to…" alone says nothing about which item is moving.
      expect(html).toContain(esc(t('followups.assignFor', { title: 'Nobody owns me' })))
    })
  })

  it('replaces the inert owner badge rather than joining it', () => {
    withTeam(() => {
      const html = render(<FollowUps />)
      // Six owned rows keep their badge; the unassigned one trades a label that
      // repeats its own section heading for a control that changes something.
      expect(countOf(html, 'class="owner-badge"')).toBe(fx.entries.length - 1)
      expect(html).not.toContain('data-assigned="false"')
    })
  })

  it('is disabled, not absent, when the workspace has no member list yet', () => {
    // members is [] by default here — the store may not have settled. A control
    // that vanished and came back would move every other button in the row.
    const html = render(<FollowUps />)
    expect(countOf(html, 'class="select fu-owner"')).toBe(1)
    // Asserted on the element itself, not on a bare `disabled=""` anywhere in
    // the page: three other controls in this row carry a disabled state of
    // their own and a loose match would pass on any of them.
    expect(html).toMatch(/<select class="select fu-owner" disabled=""/)
  })

  it('clears owner_name in the same patch that sets owner_id', () => {
    // types.ts declares the two columns mutually exclusive. A stale free-text
    // name left on a row now owned by a teammate makes the digest and the CSV
    // export disagree with this screen; the write is not reachable from a static
    // render, so the patch shape is asserted at the source.
    expect(FOLLOWUPS_SOURCE).toContain('{ ownerId: member.id, ownerName: null }')
  })
})

describe('FollowUps — a section longer than the screen', () => {
  /** `count` rows that all land in one bucket, with no health rows to look up. */
  const manyRows = (count: number): void => {
    fx.state.entries = Array.from({ length: count }, (_, i) =>
      fx.entry({ id: `m${i}`, title: `Row ${i}` }),
    )
    // No view rows: the local fallback then reads every one of them as stale
    // (9 days since activity against an 8-day threshold), so they bucket
    // together and the fold has one long section to act on.
    fx.state.health = new Map()
  }

  const restore = (): void => {
    fx.state.entries = fx.entries
    fx.state.health = fx.healthRows
  }

  it('mounts a bounded number of rows, not the whole bucket', () => {
    // A FollowUpRow is ~56 DOM elements — swipe wrapper, two hint strips, the
    // row, an SLA pill and up to four label-and-glyph buttons — so 500 rows is
    // ~28 000 elements on the screen this product exists to open first thing in
    // the morning. Board.tsx folds at 25 per column for the same reason.
    manyRows(40)
    try {
      const html = render(<FollowUps />)
      expect(countOf(html, 'class="fu-swipe"')).toBe(25)
      expect(html).toContain('Row 24')
      expect(html).not.toContain('Row 25')
    } finally {
      restore()
    }
  })

  it('keeps the heading count truthful and says how many are folded away', () => {
    // EntrySection takes `count` as a prop precisely so a sliced body cannot
    // make the heading lie — the fold hides rows, never facts.
    manyRows(40)
    try {
      const html = render(<FollowUps />)
      expect(html).toContain('entry-section-count">40<')
      expect(html).toContain(esc(t('followups.showAll')))
      expect(html).toContain(esc(t('followups.rowsHidden', { count: 15 })))
      // Named after its section: six of these can be on screen at once.
      expect(html).toContain(esc(t('followups.showAllIn', { section: t('followups.stale') })))
    } finally {
      restore()
    }
  })

  it('draws no fold at all for a section that fits', () => {
    expect(render(<FollowUps />)).not.toContain('fu-fold')
  })
})

describe('FollowUps — the resolved SLA source', () => {
  it('reads a deadline that matches the priority default as the default', () => {
    const html = render(<FollowUps />)
    expect(html).toContain(esc(t('followups.slaFromPriority', { count: 5 })))
  })

  it('reads a deadline the priority default cannot explain as a track override', () => {
    const html = render(<FollowUps />)
    expect(html).toContain(esc(t('followups.slaFromTrack', { count: 2 })))
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
      expect(html).toContain(esc(t('followups.slaFromTrack', { count: 2 })))
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

/* ═══════════════════ R2-PERF-1 · the row's props hold still ═══════════════════ */
//
// WHAT BROKE. `FollowUpRow` is `memo()`d with React's default shallow compare,
// so it re-renders when any prop changes identity. Two props changed identity on
// EVERY store commit — every optimistic write, every settle, every realtime
// echo — which meant one tap on Snooze redrew every mounted row instead of the
// one it touched:
//
//   · `onOpen`. `derive()` rebuilds `list` unconditionally, so `entries` →
//     `sections` → `orderedIds` are all new arrays, and `handleOpen` was
//     `useCallback(…, [orderedIds])`.
//   · `sla`. `resolveSla()` mints a fresh `{days, source}` per call, so every
//     breached row got a new object out of a map that was itself rebuilt on
//     each commit. This one would have OUTLIVED the `onOpen` fix.
//
// WHY THE TWO ARE ASSERTED DIFFERENTLY. `buildSlaFacts` was extracted as a pure
// function precisely so the reuse is a value claim, and value claims need no
// DOM — the block below calls it twice and compares references. `handleOpen`
// cannot be reached that way: its stability is a property of a hook's dependency
// array, observable only across two renders of a live component, and
// vitest.config.ts is `environment: 'node'` with no jsdom (see this file's
// header). So it is asserted against the SOURCE, in the idiom
// components/CommandPalette.test.tsx uses on App.tsx's route table. That is a
// weaker instrument and it is named as one: it can prove the dependency array is
// empty and cannot prove React honoured it.

describe('FollowUps — breached rows keep their SLA object', () => {
  const slaDays = (p: EntryPriority): number | null => (p === 'high' ? 5 : null)

  it('resolves both breaches, and each from the right level', () => {
    const facts = buildSlaFacts(fx.entries, fx.healthRows, slaDays, new Map())
    expect([...facts.keys()].sort()).toEqual(['b', 'c'])
    // 'b' is created_at + 5 days, exactly what the `high` default produces.
    expect(facts.get('b')).toEqual({ days: 5, source: 'priority' })
    // 'c' is two days, which only a track override can have made.
    expect(facts.get('c')).toEqual({ days: 2, source: 'track' })
  })

  it('hands back the SAME objects when nothing about the breach changed', () => {
    const first = buildSlaFacts(fx.entries, fx.healthRows, slaDays, new Map())
    // A fresh `entries` array with the same rows in it — which is exactly what
    // every commit produces, and what used to invalidate the whole map.
    const second = buildSlaFacts([...fx.entries], fx.healthRows, slaDays, first)
    expect(second.get('b')).toBe(first.get('b'))
    expect(second.get('c')).toBe(first.get('c'))
    // Not the same MAP — the map is allowed to be new; the props inside it are
    // what the memo compares.
    expect(second).not.toBe(first)
  })

  it('mints a new object for the row whose deadline actually moved, and only it', () => {
    const first = buildSlaFacts(fx.entries, fx.healthRows, slaDays, new Map())
    const moved = new Map(fx.healthRows)
    // 07-03 → 07-04: three days after created_at instead of two, still too far
    // from the 5-day priority default to read as one.
    moved.set('c', { ...(fx.healthRows.get('c') as EntryHealth), sla_due_at: '2026-07-04T00:00:00.000Z' })
    const second = buildSlaFacts(fx.entries, moved, slaDays, first)
    expect(second.get('c')).not.toBe(first.get('c'))
    expect(second.get('c')).toEqual({ days: 3, source: 'track' })
    expect(second.get('b')).toBe(first.get('b'))
  })

  it('drops a row that is no longer in breach rather than reusing its facts', () => {
    const first = buildSlaFacts(fx.entries, fx.healthRows, slaDays, new Map())
    const healed = new Map(fx.healthRows)
    healed.set('c', { ...(fx.healthRows.get('c') as EntryHealth), sla_breached: false })
    const second = buildSlaFacts(fx.entries, healed, slaDays, first)
    expect(second.has('c')).toBe(false)
    expect(second.get('b')).toBe(first.get('b'))
  })
})

describe('FollowUps — handleOpen does not depend on the list', () => {
  /** The `const handleOpen = useCallback(…)` statement, to its blank line. */
  const block = ((): string => {
    const at = FOLLOWUPS_SOURCE.indexOf('const handleOpen = useCallback(')
    if (at === -1) return ''
    const end = FOLLOWUPS_SOURCE.indexOf('\n\n', at)
    return FOLLOWUPS_SOURCE.slice(at, end === -1 ? undefined : end)
  })()

  it('found the statement at all', () => {
    // Guards every assertion below against being vacuously true after a rename.
    expect(block).not.toBe('')
  })

  it('is built once: an empty dependency array', () => {
    expect(block).toMatch(/\}, \[\]\)/)
  })

  it('reads the sibling list from the ref, not from a captured array', () => {
    expect(block).toContain('orderedRef.current')
    // The whole defect in one token: naming `orderedIds` inside this callback
    // puts it back in the dependency array, and `onOpen` churns again.
    expect(block).not.toContain('orderedIds')
  })

  it('still mirrors the live list into that ref', () => {
    // Without this line the ref would be frozen at the first render and the
    // sheet's prev/next would walk a list from before the first write.
    expect(FOLLOWUPS_SOURCE).toContain('orderedRef.current = orderedIds')
  })
})

/* ─────────── R2-ARCH-3: a queued post is a post, not a failure ─────────── */
//
// `store/outbox.ts:488` freezes the contract: `fail('offline.queued')` is a
// NOTICE, and callers "must not roll their optimistic state back on it".
// `postUpdate()` honours it — it keeps the optimistic thread row and returns
// early — but `handlePost` used to answer `if (!result.ok) return false`, which
// told `QuickUpdate.submit()` (its only caller) to keep the text, leave the
// composer open and skip the toast, while the update was ALREADY visible in the
// entry's thread. That contradiction is the bug: the natural response to it is
// to press Post again, and the second press is not a retry.
//
// It is not a retry because `postUpdate()` mints a fresh tempId per call and
// `dedupeKeyFor()` builds the outbox's collapse key from it, so two presses are
// two items with two keys and both flush. `entry_updates` has no UPDATE and no
// DELETE policy (0001:408-416, reaffirmed by 0009:92-97), so the audit trail
// this product exists to produce then says the same thing twice, for good.
//
// The composer lives inside a component and this repo has no DOM, so the
// decision is asserted where it now lives: `postQuickUpdate()` returns "the
// composer may close", and that boolean IS the fix.
describe('FollowUps — a queued quick update closes the composer', () => {
  const entry = fx.entry({ id: 'q1', title: 'Ring switch replaced' })
  const queued = (): Promise<{ ok: false; error: string }> =>
    Promise.resolve({ ok: false as const, error: 'offline.queued' })

  it('closes on a queued write, exactly as on a landed one', async () => {
    const said: string[] = []
    const ok = await postQuickUpdate(entry, 'swapped the SFP', queued, (m) => void said.push(m))
    expect(ok).toBe(true)
    // And it SAYS so: the row appearing in the thread looks identical to a
    // landed one, so the notice is the only thing that distinguishes them.
    expect(said).toEqual([t('offline.queued')])
  })

  it('keeps the composer open on a real failure, so the text is not lost', async () => {
    const said: string[] = []
    const ok = await postQuickUpdate(
      entry,
      'swapped the SFP',
      () => Promise.resolve({ ok: false as const, error: 'entry.errNotYours' }),
      (m) => void said.push(m),
    )
    expect(ok).toBe(false)
    // The store has already toasted the REASON; a second toast from here would
    // be the same failure said twice.
    expect(said).toEqual([])
  })

  it('names the item on a landed write, and does not on a queued one', async () => {
    const said: string[] = []
    const landed = await postQuickUpdate(
      entry,
      'swapped the SFP',
      () =>
        Promise.resolve({
          ok: true as const,
          data: {
            id: 'u-1',
            entry_id: entry.id,
            author_id: 'u1',
            body: 'swapped the SFP',
            status_from: null,
            status_to: null,
            created_at: '2026-07-29T09:00:00Z',
          },
        }),
      (m) => void said.push(m),
    )
    expect(landed).toBe(true)
    expect(said).toEqual([t('followups.posted', { title: entry.title })])
  })

  it('posts exactly once per call, with the id and body it was given', async () => {
    // The duplicate the fix prevents is a SECOND CALL, so the guard against a
    // regression that fixes the symptom by posting twice belongs here.
    const calls: { entryId: string; body?: string }[] = []
    await postQuickUpdate(entry, 'swapped the SFP', (i) => {
      calls.push(i)
      return queued()
    })
    expect(calls).toEqual([{ entryId: 'q1', body: 'swapped the SFP' }])
  })
})
