// Render proof for the branch panel — the surface `/tracks` and `/tracks/:id`
// collapsed into.
//
// THIS FILE REPLACES TWO. `TracksIndex.test.tsx` (36 cases) and
// `TrackTimeline.test.tsx` (44 cases) were correct tests of screens that no
// longer exist, so every guarantee they held is restated here against the new
// structure rather than dropped: the per-section counts, the archived branch
// that must stay reachable, the owner control on every row, the free-text and
// orphaned owners, the 25-row fold, the pooled bulk run, the unassigned view,
// the two number sources, the URL round-trip, the bounded feed, the tag
// breakdown and the [nudge] sentinel. Where the shape changed, the assertion
// changed with it and the change is written next to it.
//
// WHY renderToStaticMarkup AND NOT A DOM. vitest.config.ts is
// `environment: 'node'` and jsdom is not in the dependency budget — Board.test,
// FollowUps.test and the entry kit's own test all open with this paragraph.
// react-dom/server exercises the real tree, the real filter plumbing, the real
// vocabulary resolution and the real permission check, and hands back markup.
//
// WHAT A STATIC RENDER CAN SEE HERE, and it is more than it looks. The window
// fetch is an effect and effects do not run on the server, so `rows` is null
// throughout — which means every history assertion below comes through the LIVE
// OVERLAY (mergeEntriesById over `useEntryList()`), the exact path that makes
// the first paint of a real visit non-empty. That progressive-render decision is
// invisible in the happy case and is the only thing between the reader and a
// skeleton on every drill-in.
//
// WHAT IT CANNOT SEE, and therefore claims nothing about: anything behind a
// state change — a live selection, the bulk bar, the confirm dialog, the pruning
// effect, the fold buttons once clicked. `runBulk` is exported and tested
// directly for exactly that reason, as it was on the screen this replaces.
//
// THE TREE IS REAL. `buildMindtree` and `resolveFocus` are the real modules, so
// the `node` and `path` props are the ones the shell actually hands over —
// including the node ids, the `collapsed` flags and the retired branches. A
// fixture tree would have proved that this file can build an object.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import type { Entry, EntryHealth, EntryUpdate, Track } from '../../types'

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

  /** Dates relative to NOW, so the default 30-day window is not a date bomb. */
  const ago = (days: number): string => new Date(Date.now() - days * 86_400_000).toISOString()

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
    created_at: ago(6),
    updated_at: ago(2),
    closed_at: null,
    last_activity_at: ago(2),
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
    last_activity_at: ago(2),
    days_since_activity: 2,
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

  const net = track({ id: 't-net', name: 'Network', name_ar: 'الشبكات', suggested_tags: ['firewall'] })
  const pmo = track({ id: 't-pmo', name: 'PMO', sort_order: 1 })
  // Archived while work was still open on it — the case that strands entries if
  // the panel only ever renders active tracks.
  const legacy = track({ id: 't-old', name: 'Legacy WAN', archived: true, sort_order: 9 })

  const members = [
    { id: 'u1', displayName: 'Me', role: 'member' as const },
    { id: 'u2', displayName: 'Layla', role: 'member' as const },
  ]

  const priorities = [
    { key: 'critical', label: 'Critical', hidden: false, sortOrder: 0 },
    { key: 'high', label: 'High', hidden: false, sortOrder: 1 },
    { key: 'medium', label: 'Normal', hidden: false, sortOrder: 2 },
  ].map((o) => ({ kind: 'priority' as const, color: null, staleAfterDays: null, slaDays: null, ...o }))

  const statuses = [
    { key: 'new', label: 'Triage', hidden: false, sortOrder: 0 },
    { key: 'in_progress', label: 'Doing', hidden: false, sortOrder: 1 },
  ].map((o) => ({ kind: 'status' as const, color: null, staleAfterDays: null, slaDays: null, ...o }))

  const entries: Entry[] = [
    entry({ id: 'a', title: 'Firewall rule DC2', tags: ['firewall'] }),
    entry({ id: 'b', title: 'Core switch upgrade', owner_id: 'u2', status: 'in_progress' }),
    // Owned by somebody outside the workspace.
    entry({ id: 'c', title: 'Vendor portal access', owner_name: 'Acme Support' }),
    // owner_id pointing at a profile that is not in the roster.
    entry({ id: 'd', title: 'Ghost owned item', owner_id: 'u-gone' }),
    // No track at all — the queue.
    entry({ id: 'e', title: 'Untracked ask', track_id: null }),
    // On the archived track.
    entry({ id: 'f', title: 'Old WAN circuit', track_id: 't-old' }),
  ]

  const state: {
    entries: Entry[]
    health: Map<string, EntryHealth>
    truncated: boolean
    counts: { open: number; overdue: number; stale: number; blocked: number; unassigned: number }
    tracks: Track[]
    profile: { id: string; displayName: string; role: 'admin' | 'member'; locale: null } | null
    rowFilters: unknown[]
    countFilters: unknown[]
    /** `map_nodes` rows, for the fixtures that focus an ORGANIZATION. */
    mapNodes: { id: string; name: string; name_ar: string; account_manager_id: string | null; vendor: string }[]
  } = {
    entries,
    health: new Map(entries.map((e) => [e.id, health(e.id)])),
    truncated: false,
    counts: { open: 4, overdue: 1, stale: 2, blocked: 1, unassigned: 3 },
    tracks: [net, pmo],
    profile: { id: 'u1', displayName: 'Me', role: 'member', locale: null },
    rowFilters: [],
    countFilters: [],
    mapNodes: [],
  }

  return { ago, entry, health, track, entries, statuses, priorities, net, pmo, legacy, members, state, mem }
})

/**
 * The window loader never resolves in a static render — effects do not run — but
 * the module still has to import, and mocking it keeps api/supabase (and
 * therefore createClient) out of the graph entirely.
 */
vi.mock('../../api/timeline', () => ({
  loadTrackTimeline: () =>
    Promise.resolve({ ok: true, data: { entries: [], updates: [], truncated: false } }),
}))

vi.mock('../../store/entries', async () => {
  // The REAL selectEntries, so "the filter this panel hands over" is asserted
  // against what the store would actually have done with it. A mock that
  // returned the fixture unfiltered would let the unassigned chip pass without
  // filtering anything.
  const { selectEntries } = await import('../../lib/entryFilter')
  return {
    useEntryList: () => fx.state.entries,
    useFilteredEntries: (f: unknown) => {
      fx.state.rowFilters.push(f)
      return selectEntries(
        fx.state.entries,
        f as Parameters<typeof selectEntries>[1],
        fx.state.health,
        { meId: 'u1', today: new Date().toISOString().slice(0, 10) },
      )
    },
    useEntryCounts: (f: unknown) => {
      fx.state.countFilters.push(f)
      return { total: fx.state.counts.open, closed: 0, dueThisWeek: 0, ...fx.state.counts }
    },
    useHealthMap: () => fx.state.health,
    useEntriesTruncated: () => fx.state.truncated,
    useEntryFlash: () => undefined,
    usePendingOp: () => undefined,
    loadEntries: () => Promise.resolve(),
    refreshEntries: () => Promise.resolve(),
    patchEntry: () => Promise.resolve({ ok: false, error: 'common.error' }),
    // MapBranchDetail reads the INHERITED vendor and manager now, and
    // inheritance is one ancestor walk published by this store. Empty maps
    // rather than absent ones: every read below coalesces to the node's own
    // column, so an empty context is the previous behaviour exactly, and a
    // fixture that wants to prove inheritance fills them in.
    useFilterContext: () => ({
      meId: 'u1',
      today: new Date().toISOString().slice(0, 10),
      groupOfTrack: new Map(),
      ancestryOfNode: new Map(),
      vendorOfNode: new Map(),
      managerOfNode: new Map(),
    }),
  }
})

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
  useMemberLabel:
    () =>
    (ownerId?: string | null, ownerName?: string | null): string =>
      fx.members.find((m) => m.id === ownerId)?.displayName ?? ownerName?.trim() ?? 'Unassigned',
}))

vi.mock('../../store/config', () => ({
  // The three `NodeEditor` reads. It renders NOTHING without `structure.edit`,
  // which `useHasPerm` answers false for in this suite, so an empty roster and
  // an empty kind list keep every assertion in this file describing the same
  // markup — the same bargain the stage picker's empty ladder strikes above.
  useMapNodes: () => fx.state.mapNodes,
  // 0034's catalogue. Empty is the shipping state.
  useHisProducts: () => [],
  // 0033's readiness. `undefined` is the shipping answer for all 140:
  // nobody has said, which is not the same as "not started".
  useNodeReadiness: () => undefined,
  useMapNodeKinds: () => [],
  invalidateConfig: () => {},
  // Built from `state.tracks` so a case that swaps a track's definition (the
  // suggested-tags case below) changes BOTH the roster and the lookup — two
  // sources of one track is how a fixture starts lying.
  useTrackMap: () => new Map([...fx.state.tracks, fx.legacy].map((tr) => [tr.id, tr])),
  useActiveTracks: () => fx.state.tracks,
  useConfigLoading: () => false,
  useGroups: () => [],
  // MapBranchDetail mounts inside this panel now (0023) and reads the node rows
  // and the capability catalogue from the same store. Empty rather than absent:
  // every fixture below focuses a track or the root, never an `entity`, so the
  // band renders null and these are the reads that must not throw on the way to
  // that decision. A case that focuses an Org has to fill them in.
  useMapNodeMap: () => new Map(fx.state.mapNodes.map((n) => [n.id, n])),
  useAllUseCases: () => [],
  // The stage clock's two reads. The detail band calls both unconditionally —
  // hooks run before it decides there is no organization to describe — so they
  // must answer for a track focus as well. Empty is the right default: with no
  // ladder and no progress row there is no rung, which is what every fixture
  // below that is not about the clock is describing.
  useStageMap: () => new Map(),
  useNodeProgress: () => new Map(),
  useMapNodeStages: () => [],
  publishNodeProgress: () => {},
}))

vi.mock('../../store/auth', () => ({
  useAuth: () => ({ session: null, profile: fx.state.profile, loading: false }),
  // `MapBranchGoals` mounts beside the detail band on an ENTITY focus, and it
  // gates its editor on a PERMISSION rather than on the role word. Every
  // fixture in this file that focuses an organization walks through it.
  useHasPerm: () => false,
}))

/**
 * The goals band opens a request on mount. Nothing resolves during a static
 * render, but the module still has to import, and mocking it keeps api/supabase
 * — and therefore createClient — out of the graph, exactly as api/timeline is
 * mocked above for the history band.
 */
vi.mock('../../api/goals', () => ({
  listNodeGoals: () => new Promise<never>(() => {}),
  createNodeGoal: () => new Promise<never>(() => {}),
  updateNodeGoal: () => new Promise<never>(() => {}),
  deleteNodeGoal: () => new Promise<never>(() => {}),
}))

/** The detail band's own fetch, for the same reason. */
vi.mock('../../api/map', () => ({
  listNodeUseCases: () => new Promise<never>(() => {}),
  setNodeStage: () => new Promise<never>(() => {}),
  deleteNodeProgress: () => new Promise<never>(() => {}),
}))

vi.mock('../../store/entrySheet', () => ({ openEntry: () => {} }))

vi.mock('../../store/mindtree', () => ({ toggleMindCollapsed: () => {} }))

const { MemoryRouter } = await import('react-router-dom')
const MapBranch = (await import('./MapBranch')).default
const { runBulk } = await import('./MapBranch')
const { UpdateItem } = await import('./MapBranchHistory')
const { NUDGE_BODY_TOKEN } = await import('../../api/nudge')
const { buildMindtree } = await import('../../lib/mindtree/model')
const { resolveFocus } = await import('../../lib/mindtree/focus')
const { EMPTY_FILTER } = await import('../../lib/entryFilter')
const { setLocale, t } = await import('../../lib/i18n')
const { trackLabel } = await import('../../lib/labels')
const { getLocale } = await import('../../lib/i18n')

type MindNode = ReturnType<typeof buildMindtree>

/** The tree the shell would have built, for the fixture as it currently stands. */
function tree(
  collapsed: ReadonlySet<string> = new Set(),
  entities: MindEntityFixture[] = [],
): MindNode {
  return buildMindtree({
    entries: fx.state.entries,
    health: fx.state.health,
    tracks: [...fx.state.tracks, fx.legacy].map((tr) => ({
      id: tr.id,
      label: trackLabel(tr, getLocale()),
      color: tr.color,
      colorLight: tr.color_light,
      sortOrder: tr.sort_order,
      archived: tr.archived,
    })),
    entities,
    vocab: fx.statuses,
    members: fx.members,
    dimension: 'status',
    filter: { ...EMPTY_FILTER, scope: 'open' },
    ctx: { meId: 'u1', today: new Date().toISOString().slice(0, 10) },
    collapsedIds: collapsed,
    leafThreshold: 12,
  })
}

interface RenderOptions {
  /** The node to focus, as a node id. Absent = the root, the whole workspace. */
  focus?: string
  /** The shell's filter, which arrives as a prop rather than from the URL. */
  filter?: typeof EMPTY_FILTER
  /** The query string the panel reads its own decisions out of. */
  url?: string
  collapsed?: ReadonlySet<string>
  /** Organizations to draw, as `buildMindtree` takes them. Empty by default. */
  entities?: MindEntityFixture[]
  /**
   * The canvas's per-node roll-up, as the integrator will thread it.
   *
   * ABSENT BY DEFAULT, which is the state every other case in this file renders
   * in and the state the app itself is in until `Mindtree.tsx` is edited — so
   * the default proves the prop is genuinely optional rather than merely typed
   * that way.
   */
  stats?: Map<string, { quietDays: number | null }>
}

/** `MindEntity`, as much of it as a fixture needs to say. */
interface MindEntityFixture {
  id: string
  trackId: string
  parentId: string | null
  label: string
  sortOrder: number
  archived: boolean
  typeKey: string | null
}

function render({
  focus,
  filter,
  url = '/',
  collapsed,
  entities,
  stats,
}: RenderOptions = {}): string {
  const root = tree(collapsed, entities)
  const view = resolveFocus(root, focus ?? null)
  const el: ReactElement = (
    <MemoryRouter initialEntries={[url]}>
      <MapBranch
        node={view.node}
        path={view.trail}
        filter={filter ?? EMPTY_FILTER}
        dimension="status"
        textOf={(label) => (label.kind === 'key' ? t(label.key, label.vars) : label.text)}
        stats={stats as never}
        onFocus={() => {}}
        compact={false}
        announce={() => {}}
      />
    </MemoryRouter>
  )
  return renderToStaticMarkup(el)
}

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
 * Just the history band.
 *
 * The work band and the history band answer different questions over the same
 * track, so an unqualified `toContain('Firewall rule DC2')` is true of the panel
 * whatever the timeline is doing. Every history assertion is scoped to the band
 * that owns it, or it proves nothing.
 */
const feedOf = (html: string): string => html.slice(html.indexOf('mbr-band mbr-history'))

/** The id of a ring-1 node, as model.ts builds it. */
const trackNodeId = (id: string): string => `root/track:${encodeURIComponent(id)}`

afterEach(() => {
  setLocale('en')
  fx.state.entries = fx.entries
  fx.state.health = new Map(fx.entries.map((e) => [e.id, fx.health(e.id)]))
  fx.state.truncated = false
  fx.state.counts = { open: 4, overdue: 1, stale: 2, blocked: 1, unassigned: 3 }
  fx.state.tracks = [fx.net, fx.pmo]
  fx.state.profile = { id: 'u1', displayName: 'Me', role: 'member', locale: null }
  fx.state.rowFilters = []
  fx.state.countFilters = []
  fx.state.mapNodes = []
  fx.mem.clear()
})

/* ─────────────────────── the locale namespace gate ─────────────────────── */

describe('the two namespaces this panel reads', () => {
  // ⚠ RED UNTIL THE INTEGRATOR REGISTERS THEM, AND THAT IS WHAT IT IS FOR.
  // `src/locales/index.ts` is integrator-owned, and an UNREGISTERED namespace is
  // invisible to BOTH standing gates: localeParity walks EN_NAMESPACES and
  // localeReach skips any key whose root is not already a root — so the panel
  // would render `tree.openWork` at a user, in both languages, with every test
  // green. Both namespaces are already registered at HEAD; these two lines are
  // the belt to that brace, and they also catch a de-registration.
  it('are registered in src/locales/index.ts', () => {
    expect(t('tree.openWork')).not.toBe('tree.openWork')
    expect(t('track.historyScope')).not.toBe('track.historyScope')
  })
})

/* ────────────────────── the work band: the sections ────────────────────── */

describe('the sections ARE the branch’s children', () => {
  it('gives every active track a section at the root, in the workspace’s order', () => {
    // `/tracks` listed the tracks; the root branch is that list, one ring up.
    const html = render()
    expect(html).toContain('Network')
    expect(html).toContain('PMO')
    expect(html.indexOf('Network')).toBeLessThan(html.indexOf('PMO'))
  })

  it('keeps work on an archived track reachable rather than stranded', () => {
    // The track was archived while work was still open on it. Dropping the
    // branch would delete six items from a panel that claims to total the
    // branch, so it is marked instead.
    const html = render()
    expect(html).toContain('Legacy WAN')
    expect(html).toContain('data-retired="true"')
    expect(html).toContain(esc(t('tree.archived')))
    expect(html).toContain('Old WAN circuit')
  })

  it('cuts the sections on the DIMENSION once a track is focused', () => {
    // This is the shape change `/tracks` could not make: one ring deeper, the
    // sections are the ring-2 buckets of the focused track, and the panel keeps
    // exactly the same controls over them.
    const html = render({ focus: trackNodeId('t-net') })
    expect(html).toContain('data-dim="status"')
    expect(html).toContain('Triage')
    expect(html).toContain('Doing')
    // …and only that track's work.
    expect(html).not.toContain('Old WAN circuit')
    expect(html).not.toContain('Untracked ask')
  })

  it('counts open, unassigned and breached PER SECTION', () => {
    fx.state.health = new Map([
      ['a', fx.health('a', { sla_breached: true })],
      ...['b', 'c', 'd', 'e', 'f'].map((id) => [id, fx.health(id)] as const),
    ])
    const html = render()
    // Network holds a, b, c, d — one breached, two with nobody in them (a, d is
    // owned by a ghost id, c by a vendor).
    expect(html).toContain(esc(t('tree.countOpen', { count: 4 })))
    expect(html).toContain(esc(t('tree.countUnassigned', { count: 1 })))
    expect(html).toContain(esc(t('tree.countBreached', { count: 1 })))
  })

  it('renders no rows for a branch the map has collapsed, and says so', () => {
    // ONE COLLAPSE STORE, NOT TWO. The section's fold state is the map's own —
    // `buildMindtree` computed it from `store/mindtree`'s collapsedIds — so the
    // picture and the panel can never disagree about which branch is shut.
    const html = render({ collapsed: new Set([trackNodeId('t-net')]) })
    expect(html).not.toContain('Firewall rule DC2')
    expect(html).toContain('aria-expanded="false"')
    // The counts stay on the heading: folding hides rows, never facts.
    expect(html).toContain(esc(t('tree.countOpen', { count: 4 })))
  })

  it('shows no bulk bar until something is selected', () => {
    // The bar is a mode, not chrome: an empty one is a permanent strip of
    // disabled controls across the reading area of a panel that is already
    // narrow.
    expect(render()).not.toContain('class="mbr-bulk"')
  })

  it('says “all clear” for an empty branch, and “nothing matches” under a filter', () => {
    fx.state.entries = []
    expect(render()).toContain(esc(t('tree.allClear')))
    // An empty branch under an active filter has not been cleared — it has been
    // hidden, and telling somebody their work is done when it is merely filtered
    // is the worst possible empty state.
    const filtered = render({ filter: { ...EMPTY_FILTER, search: 'nothing-matches' } })
    expect(filtered).toContain(esc(t('tree.emptyFiltered')))
    expect(filtered).not.toContain(esc(t('tree.allClear')))
  })
})

/* ──────────────────── the work band: distribution ──────────────────── */

describe('distribution is the point', () => {
  it('puts an owner control on every row, naming every teammate', () => {
    const html = render()
    expect(countOf(html, 'class="select mbr-owner"')).toBe(6)
    expect(html).toContain('>Layla</option>')
    expect(html).toContain(`>${esc(t('entry.unassigned'))}</option>`)
  })

  it('makes an unassigned row loud, and an owned row quiet', () => {
    // a, e, f have nobody. b is Layla's, c is a vendor's, d has an id.
    expect(countOf(render(), 'data-unassigned="true"')).toBe(3)
  })

  it('shows a free-text owner instead of silently overwriting them', () => {
    // Half the work in an ops log waits on somebody outside the workspace, and a
    // control that cannot display them is one that erases them.
    expect(render()).toContain('>Acme Support</option>')
  })

  it('never renders a blank control for an owner the roster has lost', () => {
    // An owner_id pointing at a deleted profile would otherwise select nothing,
    // and an empty select reads as "unassigned" — a lie about the row.
    expect(render()).toContain(esc(t('tree.unknownOwner')))
  })

  it('offers no owner control to a reader who may not edit', () => {
    // Signed out mid-session: canEditEntry answers false for a null id, so the
    // affordance is disabled BEFORE the request rather than after RLS refuses it.
    fx.state.profile = null
    const html = render()
    expect(countOf(html, 'disabled=""')).toBeGreaterThan(0)
    expect(html).toContain(esc(t('entry.cannotEdit')))
  })

  it('carries a selection checkbox on every row and every section heading', () => {
    const html = render()
    expect(countOf(html, 'class="mbr-check"')).toBe(6)
    expect(countOf(html, 'class="mbr-check mbr-check-node"')).toBe(4)
  })

  it('gives a section that IS the focused node no collapse toggle', () => {
    // A ring-2 bucket has no branch children, so it is its own single section —
    // and a control that would collapse the thing the panel is about is a
    // control that blanks the panel.
    const html = render({ focus: `${trackNodeId('t-net')}/group:new` })
    expect(html).toContain('class="mbr-node-plain"')
    expect(html).not.toContain('mbr-node-toggle')
    // …and it still carries the tick, so the hand-off is still three clicks.
    expect(countOf(html, 'class="mbr-check mbr-check-node"')).toBe(1)
  })
})

/* ──────────────────────────── the row fold ──────────────────────────── */

describe('a section longer than the panel', () => {
  /** `count` rows on the Network track, with no health rows to look up. */
  const manyRows = (count: number): void => {
    // Distinct activity stamps, so the store's newest-first sort is TOTAL and
    // "the first 25" is a fact rather than a tiebreak.
    fx.state.entries = Array.from({ length: count }, (_, i) =>
      fx.entry({ id: `n${i}`, title: `Bulk row ${i}`, last_activity_at: fx.ago(i) }),
    )
    fx.state.health = new Map()
  }

  it('mounts a bounded number of rows, not the whole section', () => {
    // The measured cost this bounds: a row is 38 DOM elements with an
    // eight-person roster and 50 with twenty, so an unbounded section of 500 is
    // ~19 000 elements on one mount — in a bottom sheet, on a phone. MAX_ROWS = 25.
    manyRows(40)
    const html = render()
    expect(countOf(html, 'class="mbr-row"')).toBe(25)
    expect(html).toContain('Bulk row 24')
    expect(html).not.toContain('Bulk row 25')
  })

  it('keeps the heading count truthful and says how many are folded away', () => {
    manyRows(40)
    const html = render()
    expect(html).toContain(esc(t('tree.countOpen', { count: 40 })))
    expect(html).toContain(esc(t('tree.showAll')))
    expect(html).toContain(esc(t('tree.rowsHidden', { count: 15 })))
    // Named after its section: several are on screen at once.
    expect(html).toContain(esc(t('tree.showAllIn', { track: 'Network' })))
  })

  it('draws no fold at all for a section that fits', () => {
    expect(render()).not.toContain('mbr-more')
  })
})

/* ──────────────────────────── the bulk run ──────────────────────────── */

describe('runBulk', () => {
  const patch = { priority: 'high' as const }
  const ok = (id: string) => ({ ok: true as const, data: fx.entry({ id, title: id }) })

  /** An `apply` that records how many of its calls are in flight at once. */
  const spy = (
    outcome: (id: string) => { ok: true; data: Entry } | { ok: false; error: string } = ok,
  ) => {
    let live = 0
    let peak = 0
    const seen: string[] = []
    return {
      peak: () => peak,
      seen,
      apply: async (id: string) => {
        live += 1
        peak = Math.max(peak, live)
        seen.push(id)
        await new Promise((r) => setTimeout(r, 2))
        live -= 1
        return outcome(id)
      },
    }
  }

  it('sends six at a time instead of one at a time', async () => {
    // THE REGRESSION THIS EXISTS FOR. A non-status patch is exactly one
    // PostgREST request, so at the 253 ms measured against the live project a
    // sequential loop froze the old screen for seven and a half seconds on
    // thirty rows. A regression to sequential keeps every other assertion here
    // green and shows up only as a panel that sits there; counting peak
    // concurrency turns it back into a test failure.
    const s = spy()
    const ids = Array.from({ length: 20 }, (_, i) => `e${i}`)
    const out = await runBulk(ids, patch, s.apply)
    expect(s.peak()).toBe(6)
    expect(s.seen).toHaveLength(20)
    expect(out.done).toBe(20)
  })

  it('names the rows that failed, and only those', async () => {
    // The reason pooled() must answer in INPUT order: these ids are indexed back
    // out of the results array, and a completion-ordered answer would leave the
    // wrong rows selected for the retry.
    const s = spy((id) => (id === 'e3' || id === 'e11' ? { ok: false, error: 'common.error' } : ok(id)))
    const ids = Array.from({ length: 14 }, (_, i) => `e${i}`)
    const out = await runBulk(ids, patch, s.apply)
    expect(out.failedIds).toEqual(['e3', 'e11'])
    expect(out.done).toBe(12)
    expect(out.queued).toBe(0)
  })

  it('counts an offline write as done, because the outbox will send it', async () => {
    const s = spy((id) => (id === 'e1' ? { ok: false, error: 'offline.queued' } : ok(id)))
    const out = await runBulk(['e0', 'e1', 'e2'], patch, s.apply)
    expect(out.queued).toBe(1)
    expect(out.done).toBe(3)
    expect(out.failedIds).toEqual([])
  })

  it('is a no-op on an empty selection', async () => {
    const s = spy()
    expect(await runBulk([], patch, s.apply)).toEqual({ done: 0, queued: 0, failedIds: [] })
    expect(s.seen).toHaveLength(0)
  })
})

/* ─────────────────────── filters, scope and the chip ─────────────────── */

describe('the filter the panel hands over', () => {
  const rowFilter = () => fx.state.rowFilters[0] as { scope: string; owner: { kind: string } }

  it('pins the open scope, exactly as the map does', () => {
    // The pin lives OUTSIDE filter state so Clear-all cannot change what the
    // panel is about — the same rule `useMapModel` keeps for the canvas.
    render({ filter: { ...EMPTY_FILTER, scope: 'closed' } })
    expect(rowFilter().scope).toBe('open')
  })

  it('shows only unassigned rows under ?unassigned=1', () => {
    // CHANGED SHAPE, SAME GUARANTEE. `/tracks` turned this flag into
    // `owner: {kind:'unassigned'}` because it withheld the owner facet and its
    // toggle could own that field. The shell OFFERS that facet to four other
    // panel subjects, so the chip filters the rows it renders instead — one
    // predicate, and no field for two controls to fight over.
    const html = render({ url: '/?unassigned=1' })
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('Firewall rule DC2')
    expect(html).not.toContain('Core switch upgrade')
    // …and it does NOT reach FilterState, so an inherited ?owner= cannot be
    // smuggled past a control claiming to own it.
    expect(rowFilter().owner).toEqual({ kind: 'any' })
  })

  it('suppresses the unassigned count when the unassigned view is on', () => {
    // Under that view it can only ever repeat the open count back at the reader.
    expect(render({ url: '/?unassigned=1' })).not.toContain(
      esc(t('tree.countUnassigned', { count: 1 })),
    )
  })

  it('leaves the rows alone when the flag is absent', () => {
    expect(render()).toContain('Core switch upgrade')
  })
})

/* ──────────── the org panel's roll-up, threaded from the canvas ────────── */
//
// U5's fourth item, at the seam this component owns. The org panel shows the
// SAME field set the portfolio's table and the map card show, and the two
// numbers it cannot compute for itself — the open work under a node and the
// silence under it — are threaded down from `useMapModel`'s single post-order
// walk rather than recomputed here. Recomputing them would be a second
// arithmetic over one tree, which is the failure MindtreeTable's header and
// lib/portfolio/rows.ts's both open by naming.

describe('the org panel reads the walk the picture was drawn by', () => {
  const org: MindEntityFixture = {
    id: 'org-1',
    trackId: 't-net',
    parentId: null,
    label: 'Riyadh General',
    sortOrder: 0,
    archived: false,
    typeKey: 'Organization',
  }

  /** The tree-node id model.ts mints for that organization, found rather than
   *  spelled: the id's SHAPE is model.ts's business, not this file's. */
  function entityNodeId(): string {
    const found: string[] = []
    const walk = (n: MindNode): void => {
      if (n.kind === 'entity') found.push(n.id)
      for (const child of n.children) walk(child)
    }
    walk(tree(new Set(), [org]))
    expect(found.length).toBe(1)
    return found[0]
  }

  it('hands the roll-up to the panel, and renders nothing where the integrator has not threaded it', () => {
    fx.state.mapNodes = [
      { id: 'org-1', name: 'Riyadh General', name_ar: '', account_manager_id: null, vendor: '' },
    ]
    const id = entityNodeId()

    // WITHOUT THE PROP — the state `Mindtree.tsx` is in until its one-line diff
    // lands. Absent is "nobody has counted", which is a different fact from a
    // zero, so the two rows are gone rather than showing 0.
    const bare = render({ focus: id, entities: [org] })
    expect(bare).toContain('mbr-detail')
    expect(bare).not.toContain(esc(t('mindtree.colQuiet')))

    // WITH IT — the quiet number is the walk's, and `open` is the node's own
    // `count`, which is what the picture drew after the reader's filter.
    const threaded = render({
      focus: id,
      entities: [org],
      stats: new Map([[id, { quietDays: 3 }]]),
    })
    expect(threaded).toContain(esc(t('mindtree.colOpen')))
    expect(threaded).toContain(esc(t('mindtree.colQuiet')))
    expect(threaded).toContain(esc(t('mindtree.portfolioDays', { count: 3 })))
  })

  it('prints the dash rather than a nought when nothing has ever been filed under it', () => {
    fx.state.mapNodes = [
      { id: 'org-1', name: 'Riyadh General', name_ar: '', account_manager_id: null, vendor: '' },
    ]
    const id = entityNodeId()
    const html = render({
      focus: id,
      entities: [org],
      stats: new Map([[id, { quietDays: null }]]),
    })
    expect(html).toContain(esc(t('mindtree.colQuiet')))
    expect(html).toContain(esc(t('mapnode.notRecorded')))
  })
})

/* ──────────────────── the band: as it stands today ──────────────────── */

describe('two number sources, and the panel says which is which', () => {
  const bandFilter = () =>
    fx.state.countFilters[0] as { scope: string; trackIds: string[]; from: string | null }

  it('labels the live band and scopes it to the whole workspace at the root', () => {
    const html = render()
    expect(html).toContain(esc(t('track.now')))
    expect(html).toContain(esc(t('track.statsHint')))
    expect(bandFilter().trackIds).toEqual([])
    expect(bandFilter().scope).toBe('open')
  })

  it('scopes the band to the track once a branch is focused, and names it', () => {
    const html = render({ focus: trackNodeId('t-net') })
    expect(bandFilter().trackIds).toEqual(['t-net'])
    // The scope is NAMED beside the label, so "As it stands today" cannot be
    // read against the section headings below it, which follow the filter.
    expect(html).toContain('class="mbr-stats-scope"')
  })

  it('keeps the band clear of the reader’s filter AND of the date window', () => {
    // THE TRAP THIS TEST EXISTS FOR. Merging the band into the window's numbers
    // is the obvious simplification and it produces a header that silently
    // changes meaning when somebody drags a date.
    render({ filter: { ...EMPTY_FILTER, search: 'firewall' }, url: '/?since=2020-01-01' })
    expect(bandFilter().from).toBeNull()
    expect((bandFilter() as unknown as { search: string }).search).toBe('')
  })

  it('shows the shared counts under their own labels', () => {
    const html = render()
    expect(html).toContain(esc(t('track.statOpen')))
    expect(html).toContain(esc(t('track.statOverdue')))
    expect(html).toContain(esc(t('track.statUnassigned')))
  })

  it('keeps the SLA tile away until an admin has armed an SLA', () => {
    // 0005 ships every priority NULL, so a permanent "0 past SLA" is noise that
    // trains people to ignore the row.
    expect(render()).not.toContain(esc(t('track.statSla')))
    fx.state.health = new Map(
      fx.entries.map((e) => [e.id, fx.health(e.id, { sla_due_at: fx.ago(-1) })]),
    )
    expect(render()).toContain(esc(t('track.statSla')))
  })

  it('says so when the working set is a window rather than everything', () => {
    fx.state.truncated = true
    expect(render()).toContain(esc(t('track.statsPartial')))
  })

  it('draws no band at all for the untracked pile', () => {
    // `FilterState.trackIds` has no way to say "track_id IS NULL", so a band
    // there would either count the workspace or count nothing. The section's own
    // count is the honest whole answer.
    const html = render({ focus: `${trackNodeId('')}` })
    expect(html).not.toContain(esc(t('track.now')))
  })
})

/* ──────────────────────── the history band ──────────────────────── */

describe('the history, from the live overlay', () => {
  it('renders this track’s items on first paint, before any fetch resolves', () => {
    const html = render({ focus: trackNodeId('t-net') })
    expect(html).toContain(esc(t('track.feed')))
    expect(html).toContain('Firewall rule DC2')
    expect(countOf(html, 'class="mbr-item"')).toBeGreaterThan(0)
  })

  it('never shows another track’s work', () => {
    const html = render({ focus: trackNodeId('t-net') })
    // 'Old WAN circuit' is on t-old and 'Untracked ask' has no track at all.
    expect(html).not.toContain('Old WAN circuit')
    expect(html).not.toContain('Untracked ask')
  })

  it('reads the range, the search and the kind out of the query string', () => {
    const to = new Date().toISOString().slice(0, 10)
    const html = render({ focus: trackNodeId('t-net'), url: `/?since=2026-01-01&until=${to}&find=switch&kind=entry` })
    expect(html).toContain('value="2026-01-01"')
    expect(html).toContain('value="switch"')
    const feed = feedOf(html)
    // The kind chip the link asked for is the pressed one, and the search
    // narrowed the stream — the WORK band is untouched by either, which is why
    // both assertions are scoped.
    expect(feed).toContain(`aria-pressed="true"`)
    expect(feed).toContain('Core switch upgrade')
    expect(feed).not.toContain('Firewall rule DC2')
  })

  it('uses names the shell’s FilterBar has not already claimed', () => {
    // `filterToParams` writes `q`, `from` and `to`. Reusing them would make a
    // pasted history link arrive as a search and a date filter over the map — so
    // the panel reads `since/until/find/kind`, and a stray `?q=` does nothing
    // to the timeline.
    const html = render({ focus: trackNodeId('t-net'), url: '/?q=switch&from=2026-01-01' })
    expect(feedOf(html)).toContain('Firewall rule DC2')
    expect(html).not.toContain('value="switch"')
    expect(html).not.toContain('value="2026-01-01"')
  })

  it('clamps a hand-edited link whose start is after its end', () => {
    const to = new Date().toISOString().slice(0, 10)
    const html = render({ focus: trackNodeId('t-net'), url: `/?since=2030-01-01&until=${to}` })
    expect(html).toContain(`value="${to}"`)
    expect(html).not.toContain('value="2030-01-01"')
  })

  it('ignores a range parameter that is not a calendar date', () => {
    const html = render({ focus: trackNodeId('t-net'), url: '/?since=not-a-date' })
    expect(html).not.toContain('value="not-a-date"')
    expect(html).toContain(esc(t('track.rangeLast', { count: 7 })))
  })

  it('offers the four presets and both date ends', () => {
    const html = render({ focus: trackNodeId('t-net') })
    for (const n of [7, 30, 90, 365]) {
      expect(html).toContain(esc(t('track.rangeLast', { count: n })))
    }
    expect(html).toContain(esc(t('track.rangeFrom')))
    expect(html).toContain(esc(t('track.rangeTo')))
    expect(html).toContain(esc(t('track.refresh')))
  })

  it('says there is no history to read when the branch is not one track', () => {
    // The root and the untracked pile are not tracks, and loadTrackTimeline has
    // nothing to ask for. Saying so beats an empty band.
    const html = render()
    expect(html).toContain(esc(t('track.historyScope')))
    expect(html).not.toContain(esc(t('track.rangeFrom')))
  })
})

describe('the history mounts a bounded number of items', () => {
  const manyItems = (count: number): void => {
    fx.state.entries = Array.from({ length: count }, (_, i) =>
      fx.entry({ id: `h${i}`, title: `Event ${i}`, created_at: fx.ago(1 + (i % 5)) }),
    )
    fx.state.health = new Map()
  }

  it('folds past the budget instead of mounting the whole window', () => {
    // MAX_ITEMS = 60, a budget over the WHOLE window rather than a cap per day:
    // a year of five-a-day never trips a per-day cap and is exactly the shape
    // that hurts.
    manyItems(100)
    const html = render({ focus: trackNodeId('t-net') })
    expect(countOf(html, 'class="mbr-item"')).toBeLessThanOrEqual(60)
    expect(html).toContain(esc(t('track.showAll')))
  })

  it('keeps each day heading counting that day, not the slice of it shown', () => {
    // The fold hides items, never facts — the last day before the budget runs
    // out can be cut mid-day.
    manyItems(100)
    const html = render({ focus: trackNodeId('t-net') })
    expect(html).toContain(esc(t('track.total', { count: 20 })))
  })

  it('draws no fold at all for a window that fits', () => {
    expect(render({ focus: trackNodeId('t-net') })).not.toContain('mbr-fold')
  })
})

describe('the tag breakdown', () => {
  it("leads with the track's own suggested tags", () => {
    // Onboarding-style: the useful fact about a track is never "six open items",
    // it is how they split.
    const html = render({ focus: trackNodeId('t-net') })
    expect(html).toContain(esc(t('track.tags')))
    expect(html).toContain('firewall')
  })

  it('states each row once, as a sentence, for a reader who cannot see the bar', () => {
    const html = render({ focus: trackNodeId('t-net') })
    expect(html).toContain(esc(t('track.tagsRow', { tag: 'firewall', open: 1, closed: 0 })))
  })

  it('adds an untagged row only when something is untagged', () => {
    const html = render({ focus: trackNodeId('t-net') })
    expect(html).toContain(esc(t('track.tagsNone')))
    fx.state.entries = [fx.entry({ id: 'a', title: 'Only tagged', tags: ['firewall'] })]
    expect(render({ focus: trackNodeId('t-net') })).not.toContain(esc(t('track.tagsNone')))
  })

  it('says so, and how to fix it, when the window carries no tag at all', () => {
    // A track that suggests nothing, whose only work fell outside the window:
    // no suggested tags, no raised items, and therefore not even an untagged row.
    fx.state.tracks = [fx.track({ id: 't-net', name: 'Network' })]
    fx.state.entries = [
      fx.entry({ id: 'a', title: 'Ancient', created_at: fx.ago(200), last_activity_at: fx.ago(200) }),
    ]
    const html = render({ focus: trackNodeId('t-net') })
    expect(html).toContain(esc(t('track.tagsEmpty')))
    expect(html).toContain(esc(t('track.tagsEmptyHint')))
  })
})

/* ─────────────────────── the [nudge] sentinel ─────────────────────── */

describe('the [nudge] sentinel on the feed', () => {
  const update = (body: string): EntryUpdate => ({
    id: 'up1',
    entry_id: 'a',
    author_id: 'u2',
    body,
    status_from: null,
    status_to: null,
    created_at: fx.ago(1),
  })

  const one = (body: string): string =>
    renderToStaticMarkup(
      <UpdateItem
        update={update(body)}
        entry={fx.entry({ id: 'a', title: 'Firewall rule DC2' })}
        meId="u1"
        authorName="Layla"
        onOpen={() => {}}
      />,
    )

  it('renders the localized nudge line, never the raw token', () => {
    // migration 0019 stores the ask as a token so the sentence can be chosen per
    // reader; `threadBodyKey()` is the mapper.
    const html = one(NUDGE_BODY_TOKEN)
    expect(html).not.toContain(esc(NUDGE_BODY_TOKEN))
    expect(html).toContain(esc(t('nudge.threadLine')))
  })

  it("leaves a colleague's own words exactly as typed", () => {
    // User text must never reach the lookup.
    expect(one('Still waiting on the vendor.')).toContain('Still waiting on the vendor.')
  })

  it('names an orphaned parent rather than referring to nothing', () => {
    const html = renderToStaticMarkup(
      <UpdateItem
        update={update('note')}
        entry={undefined}
        meId="u1"
        authorName="Layla"
        onOpen={() => {}}
      />,
    )
    expect(html).toContain(esc(t('track.orphan')))
  })

  it('renders a status transition through the vocabulary, with a sentence beside it', () => {
    const html = renderToStaticMarkup(
      <UpdateItem
        update={{ ...update(''), status_from: 'new', status_to: 'in_progress' }}
        entry={fx.entry({ id: 'a', title: 'Firewall rule DC2' })}
        meId="u1"
        authorName="Layla"
        onOpen={() => {}}
      />,
    )
    // The pills carry the ADMIN'S labels, so renaming a status re-labels every
    // historical transition with zero writes.
    expect(html).toContain('Triage')
    expect(html).toContain('Doing')
    expect(html).toContain(esc(t('entry.arrow')))
    expect(html).toContain(
      esc(t('entry.statusChangedBy', { name: 'Layla', from: 'Triage', to: 'Doing' })),
    )
  })
})

/* ──────────────────────────── Arabic ──────────────────────────── */

describe('Arabic', () => {
  it('translates every band and keeps the RTL rendering equal to the LTR one', () => {
    setLocale('ar')
    const html = render({ focus: trackNodeId('t-net') })
    expect(html).toContain(esc(t('track.now')))
    expect(html).toContain(esc(t('tree.openWork')))
    expect(html).toContain(esc(t('track.feed')))
    // The same structure, not a reduced one: no rule in map-branch.css is
    // direction-conditional except the caret's rotation, so every control the
    // English render carries is here too.
    expect(countOf(html, 'class="select mbr-owner"')).toBe(4)
    expect(html).toContain('class="mbr-stat-list"')
  })

  it('uses the track’s Arabic name', () => {
    setLocale('ar')
    expect(render()).toContain('الشبكات')
  })
})

/* ─────────────────────── a11y and the live region ─────────────────── */

describe('a11y', () => {
  it('announces the feed count politely, because it lands asynchronously', () => {
    expect(render({ focus: trackNodeId('t-net') })).toContain('aria-live="polite"')
  })

  it('names every checkbox, so none of them announces as “checkbox”', () => {
    const html = render()
    expect(html).toContain(esc(t('tree.selectRow', { title: 'Firewall rule DC2' })))
    expect(html).toContain(esc(t('tree.selectTrack', { track: 'Network' })))
  })

  it('names the owner control after the row it changes', () => {
    expect(render()).toContain(esc(t('tree.ownerFor', { title: 'Firewall rule DC2' })))
  })

  it('gives every band an accessible name', () => {
    const html = render({ focus: trackNodeId('t-net') })
    expect(html).toContain(`aria-label="${esc(t('track.now'))}"`)
    expect(html).toContain(`aria-label="${esc(t('tree.openWork'))}"`)
    expect(html).toContain(`aria-label="${esc(t('track.feed'))}"`)
  })

  it('draws the trail INSIDE the panel, so a full-height sheet has a way out', () => {
    // The shell draws the same control above the canvas; at the `full` detent on
    // a phone the canvas is off screen, and a panel with no trail is a room with
    // no door. It is the SAME component, not a second breadcrumb.
    const html = render({ focus: trackNodeId('t-net') })
    expect(html).toContain('mtree-crumbbar')
    expect(html).toContain('aria-current="location"')
  })

  it('draws no trail on the unfocused map, where there is nowhere to go back to', () => {
    expect(render()).not.toContain('mtree-crumbbar')
  })
})
