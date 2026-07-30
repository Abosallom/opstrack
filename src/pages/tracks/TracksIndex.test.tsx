// Render proof for the distribution tree.
//
// WHY renderToStaticMarkup AND NOT A DOM. vitest.config.ts is `environment:
// 'node'` and jsdom is not in the dependency budget — Board.test.tsx,
// FollowUps.test.tsx and the entry kit's own test all open with the same
// paragraph. react-dom/server exercises the real tree, the real filter plumbing
// and the real permission check, and hands back markup to assert on.
//
// WHAT THIS FILE CANNOT SEE, and therefore claims nothing about: anything behind
// a state change — a live selection, the bulk bar, the confirm dialog, the
// pruning effect. What is left is the half a server render CAN prove, and it is
// the half an audit asks about: that every active track gets a node, that work
// on an archived or deleted track stays reachable instead of stranded, that the
// counts are per node, that every row carries an owner control naming every
// teammate, that a free-text or orphaned owner is shown rather than silently
// overwritten, that `?unassigned=1` really reaches the filter, and that a reader
// who may not edit is told so instead of being handed an affordance RLS would
// refuse.
//
// THE PERSISTED FOLD STATE IS THE HARNESS FOR THE COLLAPSED CASE. `readPrefs()`
// runs in a useState initializer, which a static render does execute — so
// seeding localStorage before render is how a test reaches a folded node without
// a click. Same trick Board.test.tsx uses for the column axis.
//
// WHY THE STORES ARE MOCKED AND lib/ IS NOT. Only the data sources at the
// screen's edge are stubbed; `lib/permissions`, `lib/entryFilter` and
// `lib/i18n` are the real modules. A test that mocked `canEditEntry` would
// assert that this file can call a function.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { FilterState } from '../../lib/entryFilter'
import type { Entry, EntryHealth, Track } from '../../types'

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

  const net = track({ id: 't-net', name: 'Network', suggested_tags: ['firewall'] })
  const pmo = track({ id: 't-pmo', name: 'PMO', sort_order: 1 })
  // Archived while work was still open on it — the case that strands entries if
  // the tree only ever renders active tracks.
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
    entry({ id: 'a', title: 'Firewall rule DC2' }),
    entry({ id: 'b', title: 'Core switch upgrade', owner_id: 'u2' }),
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
    loading: boolean
    truncated: boolean
    error: string | null
    tracks: Track[]
    profile: { id: string; displayName: string; role: 'admin' | 'member'; locale: null } | null
    lastFilter: FilterState | null
  } = {
    entries,
    health: new Map(entries.map((e) => [e.id, health(e.id)])),
    loading: false,
    truncated: false,
    error: null,
    tracks: [net, pmo],
    profile: { id: 'u1', displayName: 'Me', role: 'member', locale: null },
    lastFilter: null,
  }

  return { entry, health, track, entries, statuses, priorities, net, pmo, legacy, members, state, mem }
})

vi.mock('../../store/entries', () => ({
  // Captured rather than applied: what this screen is responsible for is the
  // filter it HANDS to the store, and asserting on that is what proves
  // `?unassigned=1` and the forced open scope actually reach lib/entryFilter.
  useFilteredEntries: (f: FilterState) => {
    fx.state.lastFilter = f
    return fx.state.entries
  },
  useHealthMap: () => fx.state.health,
  useEntriesLoading: () => fx.state.loading,
  useEntriesError: () => fx.state.error,
  useEntriesTruncated: () => fx.state.truncated,
  useEntryFlash: () => undefined,
  usePendingOp: () => undefined,
  loadEntries: () => Promise.resolve(),
  refreshEntries: () => Promise.resolve(),
  patchEntry: () => Promise.resolve({ ok: false, error: 'common.error' }),
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
  useMemberLabel:
    () =>
    (ownerId?: string | null, ownerName?: string | null): string =>
      fx.members.find((m) => m.id === ownerId)?.displayName ?? ownerName?.trim() ?? 'Unassigned',
}))

vi.mock('../../store/config', () => ({
  useTrackMap: () => new Map([fx.net, fx.pmo, fx.legacy].map((tr) => [tr.id, tr])),
  useActiveTracks: () => fx.state.tracks,
}))

vi.mock('../../store/auth', () => ({
  useAuth: () => ({ session: null, profile: fx.state.profile, loading: false }),
}))

vi.mock('../../store/entrySheet', () => ({
  openEntry: () => {},
}))

const { MemoryRouter } = await import('react-router-dom')
const TracksIndex = (await import('./TracksIndex')).default
const { t } = await import('../../lib/i18n')

const render = (path = '/tracks'): string =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <TracksIndex />
    </MemoryRouter>,
  )

/** Seed the persisted fold state the way a previous session would have. */
const withPrefs = (prefs: Record<string, unknown>, path = '/tracks'): string => {
  fx.mem.set('opstrack_tree_v1', JSON.stringify(prefs))
  return render(path)
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

afterEach(() => {
  fx.mem.delete('opstrack_tree_v1')
  fx.state.entries = fx.entries
  fx.state.health = new Map(fx.entries.map((e) => [e.id, fx.health(e.id)]))
  fx.state.loading = false
  fx.state.truncated = false
  fx.state.error = null
  fx.state.tracks = [fx.net, fx.pmo]
  fx.state.profile = { id: 'u1', displayName: 'Me', role: 'member', locale: null }
  fx.state.lastFilter = null
})

/* ─────────────────────── the locale namespace gate ─────────────────────── */

describe('tree locale namespace', () => {
  // ⚠ THIS TEST IS RED UNTIL THE INTEGRATOR WIRES THE NAMESPACE, AND THAT IS
  // WHAT IT IS FOR. `src/locales/index.ts` is integrator-only (EXECUTION-PLAN
  // §1.0.2), so this worker shipped `{en,ar}/tree.json` and could not register
  // them. An UNREGISTERED namespace is invisible to BOTH existing gates:
  // localeParity walks EN_NAMESPACES (which will not list `tree`), and
  // localeReach skips any key whose root is not already a root — so the screen
  // would render `tree.subtitle` at a user, in both languages, with every test
  // green. That is the exact failure FIX-BACKLOG records for the eight
  // `admin.tracks.sla*` keys in Wave 2.
  //
  // DO NOT DELETE THIS ASSERTION TO GET A GREEN RUN. The fix is four lines in
  // src/locales/index.ts:
  //   import enTree from './en/tree.json'      import arTree from './ar/tree.json'
  //   EN_NAMESPACES: { …, tree: enTree }       AR_NAMESPACES: { …, tree: arTree }
  //   export const en = { …, ...enTree }        export const ar = { …, ...arTree }
  // Once it is applied, localeParity and localeReach cover this namespace like
  // every other and this test is merely the belt to their braces.
  it('is registered in src/locales/index.ts', () => {
    expect(t('tree.subtitle')).not.toBe('tree.subtitle')
  })
})

/* ────────────────────────────── the tree ────────────────────────────── */

describe('TracksIndex — the tree', () => {
  it('gives every active track a node, in the workspace’s own order', () => {
    const html = render()
    expect(html).toContain('Network')
    expect(html).toContain('PMO')
    expect(html.indexOf('Network')).toBeLessThan(html.indexOf('PMO'))
  })

  it('leads with the untracked queue — work with no home comes first', () => {
    const html = render()
    const noTrack = html.indexOf(esc(t('entry.noTrack')))
    expect(noTrack).toBeGreaterThan(-1)
    expect(noTrack).toBeLessThan(html.indexOf('Network'))
  })

  it('drops the untracked node entirely when nothing is in it', () => {
    fx.state.entries = fx.entries.filter((e) => e.track_id !== null)
    const html = render()
    // An empty queue is not a fact anybody needs a heading for. The label still
    // appears inside the rows' own track marks, so the node is counted instead.
    expect(countOf(html, 'class="tree-node track-bar"')).toBe(3)
  })

  it('keeps work on an archived track reachable rather than stranded', () => {
    const html = render()
    expect(html).toContain('Legacy WAN')
    expect(html).toContain('data-residual="true"')
    expect(html).toContain('Old WAN circuit')
  })

  it('counts open, unassigned and breached PER NODE', () => {
    fx.state.health = new Map([
      ['a', fx.health('a', { sla_breached: true })],
      ['b', fx.health('b')],
      ['c', fx.health('c')],
      ['d', fx.health('d')],
      ['e', fx.health('e')],
      ['f', fx.health('f')],
    ])
    const html = render()
    // Network holds a, b, c, d — one of them breached, one of them unassigned.
    expect(html).toContain(esc(t('tree.countOpen', { count: 4 })))
    expect(html).toContain(esc(t('tree.countUnassigned', { count: 1 })))
    expect(html).toContain(esc(t('tree.countBreached', { count: 1 })))
  })

  it('says “all clear” for an empty track instead of leaving a blank node', () => {
    const html = render()
    // PMO holds nothing, and no filter is applied.
    expect(html).toContain(esc(t('tree.allClear')))
    expect(html).toContain(esc(t('tree.allClearHint')))
    expect(html).not.toContain(esc(t('tree.noMatch')))
  })

  it('says “no match” instead of “all clear” once a filter is on', () => {
    // An empty track under an active filter has not been cleared — it has been
    // filtered out, and telling somebody their work is done when it is merely
    // hidden is the worst possible empty state.
    const html = render('/tracks?q=firewall')
    expect(html).toContain(esc(t('tree.noMatch')))
    expect(html).not.toContain(esc(t('tree.allClear')))
  })

  it('renders no rows for a node the reader folded shut, and says so', () => {
    const html = withPrefs({ collapsed: ['t-net'] })
    expect(html).not.toContain('Firewall rule DC2')
    expect(html).toContain('aria-expanded="false"')
    // The counts stay on the heading: folding hides rows, never facts.
    expect(html).toContain(esc(t('tree.countOpen', { count: 4 })))
  })

  it('survives a malformed persisted preference rather than failing to mount', () => {
    const html = withPrefs({ collapsed: 'everything' } as unknown as Record<string, unknown>)
    expect(html).toContain('Firewall rule DC2')
  })
})

/* ──────────────────────── the inline owner picker ──────────────────────── */

describe('TracksIndex — distribution is the point', () => {
  it('puts an owner control on every row, naming every teammate', () => {
    const html = render()
    expect(countOf(html, 'class="select tree-owner"')).toBe(6)
    expect(html).toContain('>Layla</option>')
    expect(html).toContain(`>${esc(t('entry.unassigned'))}</option>`)
  })

  it('makes an unassigned row loud, and an owned row quiet', () => {
    const html = render()
    // Four rows have nobody: a, e, f — plus nothing else. b is Layla's, c is a
    // vendor's, d has an id.
    expect(countOf(html, 'data-unassigned="true"')).toBe(3)
  })

  it('shows a free-text owner instead of silently overwriting them', () => {
    // Half the work in an ops log is waiting on somebody outside the workspace,
    // and a control that cannot display them is one that erases them.
    const html = render()
    expect(html).toContain('>Acme Support</option>')
  })

  it('never renders a blank control for an owner the roster has lost', () => {
    // An owner_id pointing at a deleted profile would otherwise select nothing,
    // and an empty select reads as "unassigned" — a lie about the row.
    const html = render()
    expect(html).toContain(esc(t('tree.unknownOwner')))
  })

  it('offers no owner control to a reader who may not edit', () => {
    // Signed out mid-session: canEditEntry answers false for a null id, so the
    // affordance is disabled BEFORE the request rather than after RLS refuses
    // it — see lib/permissions.ts.
    fx.state.profile = null
    const html = render()
    expect(countOf(html, 'disabled=""')).toBeGreaterThan(0)
    expect(html).toContain(esc(t('entry.cannotEdit')))
  })

  it('carries a selection checkbox on every row and every node heading', () => {
    const html = render()
    expect(countOf(html, 'class="tree-check"')).toBe(6)
    expect(countOf(html, 'class="tree-check tree-check-node"')).toBe(4)
  })

  it('shows no bulk bar until something is selected', () => {
    // The bar is a mode, not chrome: an empty one is a permanent strip of
    // disabled controls across the reading area.
    expect(render()).not.toContain('class="tree-bulk"')
  })
})

/* ─────────────────────────── filters and links ─────────────────────────── */

describe('TracksIndex — filters', () => {
  it('forces the open scope, whatever the URL asks for', () => {
    render('/tracks?scope=closed')
    expect(fx.state.lastFilter?.scope).toBe('open')
  })

  it('turns ?unassigned=1 into the unassigned owner filter', () => {
    const html = render(`/tracks?unassigned=1`)
    expect(fx.state.lastFilter?.owner).toEqual({ kind: 'unassigned' })
    expect(html).toContain('aria-pressed="true"')
  })

  it('leaves the owner dimension alone when the flag is absent', () => {
    render('/tracks')
    expect(fx.state.lastFilter?.owner).toEqual({ kind: 'any' })
  })

  it('ignores an owner filter smuggled in through the URL', () => {
    // The toggle owns this dimension. A second control writing the same field
    // would win silently and leave the toggle showing the wrong state.
    render('/tracks?owner=u2')
    expect(fx.state.lastFilter?.owner).toEqual({ kind: 'any' })
  })

  it('suppresses the unassigned count when the unassigned view is on', () => {
    // Under that view it can only ever repeat the open count back at the reader.
    const html = render('/tracks?unassigned=1')
    expect(html).not.toContain(esc(t('tree.countUnassigned', { count: 1 })))
  })

  it('offers a track’s suggested tags before anybody has typed one', () => {
    expect(render()).toContain('firewall')
  })
})

/* ───────────────────────── states other than “fine” ───────────────────── */

describe('TracksIndex — loading, error and empty', () => {
  it('shows skeleton nodes on a cold load, hidden from assistive tech', () => {
    fx.state.loading = true
    fx.state.entries = []
    fx.state.tracks = []
    const html = render()
    expect(html).toContain('tree-node-skeleton')
    expect(html).toContain('aria-hidden="true"')
  })

  it('reports a load failure as an alert with a way out', () => {
    fx.state.error = 'common.error'
    const html = render()
    expect(html).toContain('role="alert"')
    expect(html).toContain(esc(t('tree.errLoad')))
    expect(html).toContain(esc(t('common.retry')))
  })

  it('caveats its counts when the working set is only a window', () => {
    fx.state.truncated = true
    expect(render()).toContain(esc(t('tree.truncated')))
  })

  it('offers a way back out of a filter that admits nothing', () => {
    fx.state.entries = []
    fx.state.tracks = []
    const html = render('/tracks?q=nothing-matches-this')
    expect(html).toContain(esc(t('tree.emptyFiltered')))
    expect(html).toContain(esc(t('filter.clearAll')))
  })

  it('announces its own changes in a polite live region', () => {
    // Assigning a row is a silent change for anyone who cannot see the select
    // re-label itself.
    expect(render()).toContain('aria-live="polite"')
  })
})
