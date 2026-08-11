// Render proof for the board stage — `pages/Board.test.tsx` rewritten against
// the component the board became. Every guarantee that file asserted is
// restated here; the three that changed shape are marked in place.
//
// WHY renderToStaticMarkup AND NOT A DOM. vitest.config.ts is `environment:
// 'node'` and jsdom is not in the dependency budget — the entry kit's own test
// and FollowUps.test.tsx open with the same paragraph. react-dom/server
// exercises the real tree, the real vocabulary partitioning and the real
// permission check, and hands back markup to assert on.
//
// WHAT THIS FILE CANNOT SEE, and therefore claims nothing about: the pointer
// drag; anything behind a state change (the quick-add composer once it is open,
// the arrival animation); and EVERY EFFECT — a server render never runs one, so
// the `loadClosedSince(today − 14)` call that fills the Done and Cancelled
// columns is NOT asserted here. What is asserted instead is the half that
// decides whether those rows can be drawn at all once they arrive: the filter
// this stage applies carries `scope: 'all'`, and a closed entry lands in its
// column. The window itself is pinned in `lib/board/columns.test.ts`, and
// everything inside the gesture is arithmetic in `lib/dnd.ts`, asserted in
// `dnd.test.ts` with no DOM at all.
//
// THE PERSISTED PREFERENCE IS THE TEST HARNESS FOR THE AXIS. `readPrefs()` runs
// in a useState initializer, which a static render DOES execute — so seeding
// localStorage before render is how a test reaches the track, owner and
// priority boards without a click.
//
// WHY THE STORES ARE MOCKED AND lib/ IS NOT. Only the data sources at the
// screen's edge are stubbed; `lib/board/columns`, `lib/permissions`,
// `lib/entryFilter`'s ordering and `lib/i18n` are the real modules. A test that
// mocked `canEditEntry` would assert that this file can call a function.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Entry, EntryHealth, Track } from '../../types'
import type { FilterState } from '../../lib/entryFilter'

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

  const entry = (over: Partial<Entry> & Pick<Entry, 'id' | 'title' | 'status'>): Entry => ({
    track_id: 't-net',
    node_id: null,
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

  const health = (id: string, over: Partial<EntryHealth> = {}): EntryHealth => ({
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
    ...over,
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
  ].map((o) => ({ kind: 'status' as const, color: null, staleAfterDays: null, slaDays: null, ...o }))

  // `low` retired, and nothing is sitting in it — so it is genuinely gone.
  const priorities = [
    { key: 'critical', label: 'Critical', hidden: false, sortOrder: 0 },
    { key: 'high', label: 'High', hidden: false, sortOrder: 1 },
    { key: 'medium', label: 'Normal', hidden: false, sortOrder: 2 },
    { key: 'low', label: 'Low', hidden: true, sortOrder: 3 },
  ].map((o) => ({ kind: 'priority' as const, color: null, staleAfterDays: null, slaDays: null, ...o }))

  const entries: Entry[] = [
    entry({ id: 'a', title: 'Firewall rule DC2', status: 'new' }),
    entry({ id: 'b', title: 'Core switch upgrade', status: 'new' }),
    entry({ id: 'c', title: 'Rebuild jump host', status: 'in_progress' }),
    // The closed row the map itself never loads: this stage asks for the last
    // fortnight and draws it in the Done column.
    entry({ id: 'd', title: 'Vendor portal access', status: 'done', closed_at: '2026-07-19T00:00:00.000Z' }),
    // The two that keep a retired status alive.
    entry({ id: 'e', title: 'Old escalation', status: 'waiting_on' }),
    entry({ id: 'f', title: 'Older escalation', status: 'waiting_on' }),
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
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  })

  const net = track({ id: 't-net', name: 'Network', name_ar: 'الشبكات', suggested_tags: ['switch', 'firewall'] })
  const retiredTrack = track({ id: 't-old', name: 'Legacy WAN', archived: true, sort_order: 9 })

  const members = [
    { id: 'u1', displayName: 'Me', role: 'member' as const },
    { id: 'u2', displayName: 'Layla', role: 'member' as const },
  ]

  // Mutable so a case can swap in an empty working set, a failure, a different
  // shape of data or a signed-out reader without a second mock factory.
  const state: {
    entries: Entry[]
    health: Map<string, EntryHealth>
    loading: boolean
    error: string | null
    closedError: string | null
    profile: { id: string; displayName: string; role: 'admin' | 'member'; locale: null } | null
    /** The filter this stage actually applied, captured at the seam. */
    applied: FilterState | null
  } = {
    entries,
    health: new Map(entries.map((e) => [e.id, health(e.id)])),
    loading: false,
    error: null,
    closedError: null,
    profile: { id: 'u1', displayName: 'Me', role: 'member', locale: null },
    applied: null,
  }

  return {
    entry,
    health,
    entries,
    statuses,
    priorities,
    net,
    retiredTrack,
    members,
    state,
    mem,
    empty: [] as Entry[],
  }
})

vi.mock('../../store/entries', () => ({
  useFilteredEntries: (filter: FilterState) => {
    fx.state.applied = filter
    return fx.state.entries
  },
  useEntryMap: () => new Map(fx.state.entries.map((e) => [e.id, e])),
  useHealthMap: () => fx.state.health,
  useEntriesLoading: () => fx.state.loading,
  useEntriesError: () => fx.state.error,
  useClosedEntriesError: () => fx.state.closedError,
  useEntryFlash: () => undefined,
  usePendingOp: () => undefined,
  loadEntries: () => Promise.resolve(),
  loadClosedSince: () => Promise.resolve(),
  refreshEntries: () => Promise.resolve(),
  setStatus: () => Promise.resolve({ ok: false, error: 'common.error' }),
  patchEntry: () => Promise.resolve({ ok: false, error: 'common.error' }),
  createEntryOptimistic: () => Promise.resolve({ ok: false, error: 'common.error' }),
}))

vi.mock('../../store/vocab', () => {
  const of = (kind: string, all: boolean) => {
    const rows = kind === 'status' ? fx.statuses : kind === 'priority' ? fx.priorities : []
    return all ? rows : rows.filter((o) => !o.hidden)
  }
  return {
    useVocab: (kind: string) => of(kind, false),
    useVocabAll: (kind: string) => of(kind, true),
    useVocabLabel: () => (kind: string, key: string) =>
      of(kind, true).find((o) => o.key === key)?.label ?? key,
    useVocabColor: () => () => null,
    useStaleDays: () => () => 8,
    useSlaDays: () => () => null,
  }
})

vi.mock('../../store/members', () => ({
  useMembers: () => fx.members,
  useMemberMap: () => new Map(fx.members.map((m) => [m.id, m])),
  // Mirrors the real fallback chain (id → displayName → free text → the
  // unassigned label). The literal stands in for t('entry.unassigned'), which
  // this mock cannot reach without importing the module it is replacing.
  useMemberLabel:
    () =>
    (ownerId?: string | null, ownerName?: string | null): string =>
      fx.members.find((m) => m.id === ownerId)?.displayName ?? ownerName?.trim() ?? 'Unassigned',
}))

vi.mock('../../store/config', () => ({
  useTrackMap: () => new Map([fx.net, fx.retiredTrack].map((t) => [t.id, t])),
  useActiveTracks: () => [fx.net],
  useGroups: () => [],
}))

vi.mock('../../store/auth', () => ({
  useAuth: () => ({ session: null, profile: fx.state.profile, loading: false }),
}))

vi.mock('../../store/entrySheet', () => ({
  openEntry: () => {},
}))

const BoardStage = (await import('./BoardStage')).default
const { EMPTY_FILTER } = await import('../../lib/entryFilter')
const { t } = await import('../../lib/i18n')

const said: string[] = []

const render = (
  props: Partial<{ filter: FilterState; compact: boolean; rtl: boolean }> = {},
): string =>
  renderToStaticMarkup(
    <BoardStage
      filter={props.filter ?? EMPTY_FILTER}
      compact={props.compact ?? false}
      rtl={props.rtl ?? false}
      announce={(text) => said.push(text)}
    />,
  )

/** Seed the persisted board preference the way a previous session would have. */
const withPrefs = (prefs: Record<string, unknown>, props = {}): string => {
  fx.mem.set('nphiescore_board_v1', JSON.stringify(prefs))
  return render(props)
}

afterEach(() => {
  fx.mem.delete('nphiescore_board_v1')
  fx.state.entries = fx.entries
  fx.state.health = new Map(fx.entries.map((e) => [e.id, fx.health(e.id)]))
  fx.state.loading = false
  fx.state.error = null
  fx.state.closedError = null
  fx.state.applied = null
  fx.state.profile = { id: 'u1', displayName: 'Me', role: 'member', locale: null }
  said.length = 0
})

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
  html.indexOf(esc(t('board.column', { column: label })))

describe('BoardStage — columns come from the vocabulary', () => {
  it('renders one column per VISIBLE status, in the admin’s own order and labels', () => {
    const html = render()
    expect(countOf(html, 'class="mbd-col"')).toBe(4)
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
    expect(html).toContain(esc(t('board.overflowStatus')))
    // Present as an overflow entry…
    expect(html).toContain('Awaiting vendor')
    // …and NOT as a column, which is what makes it a source and never a target.
    expect(columnAt(html, 'Awaiting vendor')).toBe(-1)
    // A retired status holding nothing is genuinely gone.
    expect(html).not.toContain('Dropped')
    // Collapsed until asked for: the rail is an escape hatch, not a sixth column.
    expect(html).toContain('aria-expanded="false"')
    // The count rides IN the label: an aria-label on a button replaces its
    // contents, so the pill inside it is announced to nobody.
    expect(html).toContain(esc(t('board.expandColumn', { column: 'Awaiting vendor', count: 2 })))
  })

  it('offers no quick-add on a retired bucket — it cannot be a drop target either', () => {
    // "Hiding an option must never hide data", and its other half: a bucket you
    // can drag work OUT of must never advertise a way to put work IN.
    const html = render()
    expect(html).not.toContain(esc(t('board.quickAdd', { column: 'Awaiting vendor' })))
    expect(html).toContain(esc(t('board.overflowHint')))
  })

  it('states what an empty column is for instead of leaving a blank strip', () => {
    const html = render()
    expect(html).toContain(esc(t('board.columnEmptyStatus', { column: 'Blocked' })))
    expect(html).toContain(esc(t('board.columnEmptyHint')))
  })

  it('words the empty column for the axis it is on, not from one shared template', () => {
    // "Nothing in Layla" is what a single sentence produces, and it is the kind
    // of line that makes an app read as machine-assembled.
    fx.state.entries = [fx.entry({ id: 'a', title: 'Unowned', status: 'new' })]
    const html = withPrefs({ dimension: 'owner', density: 'comfortable', collapsed: {} })
    expect(html).toContain(esc(t('board.columnEmptyOwner')))
    expect(html).not.toContain(esc(t('board.columnEmptyStatus', { column: 'Me' })))
  })

  it('gives each column count a sentence, not a bare digit', () => {
    const html = render()
    expect(html).toContain(esc(t('board.columnCountLabel', { count: 2 })))
    expect(html).toContain(esc(t('board.columnCountLabel', { count: 0 })))
  })
})

describe('BoardStage — the closed window', () => {
  it('draws the recently finished work the map itself never loads', () => {
    // The map pins `scope: 'open'` and buildMindtree emits nothing for a closed
    // entry, so "what did the team finish this fortnight" exists on this stage
    // or nowhere. The request is an effect a static render cannot run; what is
    // provable here is that the row is drawn in its column once it arrives.
    const html = render()
    expect(html).toContain('Vendor portal access')
    expect(columnAt(html, 'Shipped')).toBeGreaterThan(-1)
    expect(html).toContain(esc(t('board.closedWindow', { count: 14 })))
  })

  it('applies scope: all — and does NOT reach for the map’s own scope pin', () => {
    render()
    // The pin lives outside filter state precisely so Clear-all cannot change
    // what the map is about (contract risk 9). This stage widens its OWN read.
    expect(fx.state.applied?.scope).toBe('all')
  })

  it('says so when the closed read failed, instead of looking like a quiet fortnight', () => {
    fx.state.closedError = 'common.error'
    const html = render()
    expect(html).toContain(esc(t('board.errClosed')))
    expect(html).toContain(esc(t('common.retry')))
  })
})

describe('BoardStage — the column axis is a choice', () => {
  it('offers the four dimensions, with the reader’s persisted one pressed', () => {
    const html = withPrefs({ dimension: 'priority', density: 'comfortable', collapsed: {} })
    for (const key of ['board.groupStatus', 'board.groupTrack', 'board.groupOwner', 'board.groupPriority']) {
      expect(html).toContain(esc(t(key)))
    }
    // Three visible priorities; `low` is retired and empty, so it is gone.
    expect(countOf(html, 'class="mbd-col"')).toBe(3)
    expect(columnAt(html, 'Critical')).toBeLessThan(columnAt(html, 'Normal'))
  })

  it('cuts by owner with the unassigned queue leading, and vendors in the overflow', () => {
    fx.state.entries = [
      fx.entry({ id: 'a', title: 'Unowned work', status: 'new' }),
      fx.entry({ id: 'b', title: 'Layla’s work', status: 'new', owner_id: 'u2' }),
      fx.entry({ id: 'c', title: 'Vendor work', status: 'new', owner_name: 'Acme Ltd' }),
    ]
    const html = withPrefs({ dimension: 'owner', density: 'comfortable', collapsed: {} })
    // Unassigned + the two members. The residual bucket LEADS: it is the queue.
    expect(countOf(html, 'class="mbd-col"')).toBe(3)
    expect(columnAt(html, 'Unassigned')).toBeLessThan(columnAt(html, 'Me'))
    expect(columnAt(html, 'Layla')).toBeGreaterThan(-1)
    // A free-text owner is real work with a real owner, and no board control can
    // ever assign TO one — so it is a source-only strip, never a column.
    expect(html).toContain(esc(t('board.overflowOwner')))
    expect(html).toContain('Acme Ltd')
    expect(columnAt(html, 'Acme Ltd')).toBe(-1)
  })

  it('cuts by track, and an ARCHIVED track holding work keeps that work reachable', () => {
    fx.state.entries = [
      fx.entry({ id: 'a', title: 'On the network', status: 'new' }),
      fx.entry({ id: 'b', title: 'Homeless', status: 'new', track_id: null }),
      fx.entry({ id: 'c', title: 'Stranded', status: 'new', track_id: 't-old' }),
    ]
    const html = withPrefs({ dimension: 'track', density: 'comfortable', collapsed: {} })
    expect(countOf(html, 'class="mbd-col"')).toBe(2)
    expect(columnAt(html, t('entry.noTrack'))).toBeLessThan(columnAt(html, 'Network'))
    expect(html).toContain(esc(t('board.overflowTrack')))
    expect(html).toContain('Legacy WAN')
    expect(columnAt(html, 'Legacy WAN')).toBe(-1)
  })

  it('drops the status filter when status is the AXIS, and SAYS it did', () => {
    // The page removed the facet from its own FilterBar. The shell owns that bar
    // now and this component cannot reach into it, so the rule survives where it
    // can: the filter is not applied, and a note beside the axis switch says so.
    // Applying it silently would leave Shipped inexplicably empty; ignoring it
    // silently with the chip still lit would be a control that lies.
    const filtered: FilterState = { ...EMPTY_FILTER, statuses: ['done'] }
    const html = render({ filter: filtered })
    expect(fx.state.applied?.statuses).toEqual([])
    expect(html).toContain(esc(t('board.statusAxisNote')))
  })

  it('keeps the status filter over OWNER columns, where it is the useful question', () => {
    // "Who is sitting on the blocked work" is what a status facet over owner
    // columns is for, and nothing on the screen fights it.
    const filtered: FilterState = { ...EMPTY_FILTER, statuses: ['blocked'] }
    const html = withPrefs({ dimension: 'owner', density: 'comfortable', collapsed: {} }, {
      filter: filtered,
    })
    expect(fx.state.applied?.statuses).toEqual(['blocked'])
    expect(html).not.toContain(esc(t('board.statusAxisNote')))
  })
})

describe('BoardStage — column intelligence', () => {
  it('badges a column holding work past its SLA, and only that column', () => {
    fx.state.health = new Map([
      ['a', fx.health('a', { sla_breached: true, sla_due_at: '2026-07-01T00:00:00.000Z' })],
      ['b', fx.health('b')],
      ['c', fx.health('c')],
      ['d', fx.health('d')],
    ])
    const html = render()
    expect(countOf(html, 'class="pill mbd-sla tabular"')).toBe(1)
    expect(html).toContain(esc(t('board.slaBadgeLabel', { count: 1 })))
  })

  it('renders a persisted collapsed column as a rail that still reports its count', () => {
    const html = withPrefs({ dimension: 'status', density: 'comfortable', collapsed: { status: ['new'] } })
    // Still a column — a slim one is still a drop target, which is the point of
    // collapsing one rather than hiding it.
    expect(countOf(html, 'class="mbd-col"')).toBe(4)
    expect(countOf(html, 'class="mbd-rail"')).toBe(1)
    expect(html).toContain(esc(t('board.expandColumn', { column: 'Triage', count: 2 })))
    // Collapsed means collapsed: its cards are not in the markup at all.
    expect(html).not.toContain('Firewall rule DC2')
  })

  it('keys the collapse PER DIMENSION — a track id means nothing to the status axis', () => {
    // The same prefs, read on two axes. Losing this keying produces phantom
    // collapsed columns after a switch, and a rail nobody can find to expand.
    const prefs = {
      dimension: 'status',
      density: 'comfortable',
      collapsed: { status: ['new'], track: ['t-net'] },
    }
    expect(countOf(withPrefs(prefs), 'class="mbd-rail"')).toBe(1)
    expect(withPrefs(prefs)).toContain(esc(t('board.expandColumn', { column: 'Triage', count: 2 })))

    fx.mem.delete('nphiescore_board_v1')
    const onTrack = withPrefs({ ...prefs, dimension: 'track' })
    expect(countOf(onTrack, 'class="mbd-rail"')).toBe(1)
    // The track board's rail is Network, NOT a phantom column called `new`.
    expect(onTrack).toContain(esc(t('board.expandColumn', { column: 'Network', count: 6 })))
  })

  it('keeps the header count TRUE while the fold hides cards', () => {
    // The fold hides cards, never facts: 30 items on a comfortable board render
    // 25, and the header still says 30.
    fx.state.entries = Array.from({ length: 30 }, (_, i) =>
      fx.entry({ id: `n${i}`, title: `Item ${i}`, status: 'new' }),
    )
    fx.state.health = new Map()
    const html = render()
    expect(html).toContain(esc(t('board.columnCountLabel', { count: 30 })))
    expect(countOf(html, 'class="mbd-card"')).toBe(25)
    expect(html).toContain(esc(t('board.showAll')))
    expect(html).toContain(esc(t('board.cardsHidden', { count: 5 })))
  })

  it('carries the density the reader chose onto the stage root', () => {
    expect(withPrefs({ dimension: 'status', density: 'compact', collapsed: {} })).toContain(
      'data-density="compact"',
    )
    fx.mem.delete('nphiescore_board_v1')
    expect(render()).toContain('data-density="comfortable"')
  })

  it('takes the phone from the shell’s boolean, not from a media query of its own', () => {
    // `useIsCompact()` decides nine other things about this screen; a
    // `max-width` in the sheet could disagree with it by a pixel.
    expect(render({ compact: true })).toContain('data-compact="true"')
    expect(render({ compact: false })).not.toContain('data-compact')
  })

  it('survives a preference written by a build that knew a dimension this one does not', () => {
    // User-writable storage outlives a schema. A stale value must degrade to the
    // default board, never to zero columns.
    const html = withPrefs({ dimension: 'assignee', density: 'roomy', collapsed: 7 })
    expect(countOf(html, 'class="mbd-col"')).toBe(4)
    expect(html).toContain('data-density="comfortable"')
  })
})

describe('BoardStage — quick add', () => {
  it('offers a composer on every live column to a signed-in member', () => {
    const html = render()
    expect(countOf(html, 'class="mbd-col-add"')).toBe(4)
    expect(html).toContain(esc(t('board.quickAdd', { column: 'Triage' })))
  })

  it('offers none to a reader with no session — every write policy keys off auth.uid()', () => {
    fx.state.profile = null
    expect(render()).not.toContain('class="mbd-col-add"')
  })
})

describe('BoardStage — the accessible move path', () => {
  it('gives every visible card the non-drag move control', () => {
    const html = render()
    const onBoard = fx.entries.filter((e) => e.status !== 'waiting_on').length
    // The kit renders StatusPill as a native <select> whenever onMove is wired,
    // and the board wires it on every card, always.
    expect(countOf(html, 'data-editable="true"')).toBe(onBoard)
    expect(countOf(html, 'class="mbd-card"')).toBe(onBoard)
    // Focus can be RESTORED to a card after a keyboard move re-mounts it in
    // another column, which is why the wrapper is focusable but not tabbable.
    expect(html).toContain('tabindex="-1"')
  })

  it('publishes the id the keyboard and digit paths steer by', () => {
    // `[data-entry-id]` is the one DOM contract this stage exports: the arrow
    // and digit handler finds the card by closest(), and lib/hotkeys.ts reads
    // the same attribute. Neither path exists without it in the markup.
    const html = render()
    expect(html).toContain('data-entry-id="a"')
    expect(html).toContain('data-entry-id="d"')
  })

  it('carries the keyboard hint, and leaves the announcing region to the shell', () => {
    // CHANGED SHAPE, SAME GUARANTEE. The page rendered its own polite region,
    // keyed on a counter so two identical consecutive sentences both announce.
    // The shell's region (MapSummary) is keyed the same way and is rendered
    // under every stage, so every move announces THROUGH the `announce` prop —
    // one region on the screen instead of two talking over each other. The two
    // `role="status"` notes below are CONDITIONS, not a move channel, and
    // neither is in the markup unless its condition holds.
    const html = render()
    expect(html).toContain(esc(t('board.keyboardHint')))
    expect(html).toContain(esc(t('board.dragHint')))
    expect(html).not.toContain('aria-live')
    expect(html).not.toContain('role="status"')
  })

  it('ships BOTH gesture hints, because the media query has to have a choice', () => {
    // A phone is told to press and hold; a mouse is told to drag. Which one is
    // visible is map-board.css's `(pointer: coarse)` call, and that rule can
    // only pick between strings that are actually in the document.
    const html = render()
    expect(html).toContain(esc(t('board.holdHint')))
    expect(html).toContain('mbd-hint mbd-hint-touch')
    expect(html).toContain('mbd-hint mbd-hint-fine')
  })
})

describe('BoardStage — permission is decided before the affordance renders', () => {
  it('locks every card and says why when the reader has no profile yet', () => {
    fx.state.profile = null
    const html = render()
    const onBoard = fx.entries.filter((e) => e.status !== 'waiting_on').length
    // canEditEntry() answers false for a null id under BOTH branches of the
    // 0004 decision, so no drag handler is attached and the select is disabled
    // — no request is sent that RLS would answer with zero rows.
    expect(countOf(html, 'data-locked="true"')).toBe(onBoard)
    expect(html).toContain(esc(t('entry.cannotEdit')))
    // And the grab cursor goes with it: an affordance that says "pick me up" on
    // a card the server would refuse is the same lie as an enabled control.
    expect(html).not.toContain('data-draggable="true"')
  })

  it('leaves the cards unlocked for a signed-in member', () => {
    const html = render()
    expect(html).not.toContain('data-locked="true"')
    expect(countOf(html, 'data-draggable="true"')).toBe(
      fx.entries.filter((e) => e.status !== 'waiting_on').length,
    )
  })
})

describe('BoardStage — empty, loading and failed', () => {
  it('says so when the FILTER admits nothing, and leaves the way out to the shell', () => {
    // CHANGED SHAPE, SAME GUARANTEE. The page's empty state carried its own
    // Clear-all because it owned the FilterBar. The shell's bar is one tap above
    // this stage and always visible, and two clear-alls that could disagree is
    // worse than one that cannot.
    fx.state.entries = fx.empty
    const html = render({ filter: { ...EMPTY_FILTER, search: 'nothing-matches-this' } })
    expect(html).toContain(esc(t('board.empty')))
    expect(html).toContain(esc(t('board.emptyHint')))
    expect(html).not.toContain('class="mbd-col"')
  })

  it('keeps the columns for an empty WORKSPACE, because quick-add lives in them', () => {
    // An empty state here would be a dead end on day one: the only way to put
    // the first card on the board is the composer inside a column.
    fx.state.entries = fx.empty
    const html = render()
    expect(countOf(html, 'class="mbd-col"')).toBe(4)
    expect(html).not.toContain(esc(t('board.empty')))
  })

  it('shows a skeleton only while there is genuinely nothing to show', () => {
    fx.state.entries = fx.empty
    fx.state.loading = true
    expect(render()).toContain('mbd-col-skeleton')

    // A refetch with cards already on screen must not blank the board someone is
    // reading.
    fx.state.entries = fx.entries
    const html = render()
    expect(html).not.toContain('mbd-col-skeleton')
    expect(countOf(html, 'class="mbd-col"')).toBe(4)
  })

  it('renders a failed load as a retryable alert', () => {
    fx.state.error = 'board.errLoad'
    const html = render()
    expect(html).toContain('role="alert"')
    expect(html).toContain(esc(t('board.errLoad')))
    expect(html).toContain(esc(t('common.retry')))
  })
})

describe('BoardStage — Arabic', () => {
  it('renders its own strings in Arabic from the same key set, with the same markup', async () => {
    const { setLocale } = await import('../../lib/i18n')
    setLocale('ar')
    try {
      const html = render({ rtl: true })
      // A key with no Arabic value falls back to the ENGLISH string, so
      // asserting the Arabic text is present is what proves the namespace is
      // genuinely translated rather than merely at key parity.
      expect(html).toContain(esc(t('board.subtitle')))
      expect(html).toContain(esc(t('board.dragHint')))
      expect(html).toContain(esc(t('board.overflowHint')))
      expect(html).toContain(esc(t('board.groupTrack')))
      expect(html).toContain(esc(t('board.quickAdd', { column: 'Triage' })))
      // Direction is carried by <html dir> and CSS logical properties, so the
      // markup is identical in both languages apart from the text — no mirrored
      // class, no per-direction branch. `rtl` reaches exactly two things, and
      // neither is markup: arrowStep()'s meaning and the arrival slide's sign.
      expect(countOf(html, 'class="mbd-col"')).toBe(4)
      expect(html).not.toContain('data-rtl')
    } finally {
      setLocale('en')
    }
  })
})
