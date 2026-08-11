// Render proof for the attention panel — the screen `/followups` used to be,
// docked beside the map.
//
// THIS FILE IS FollowUps.test.tsx REWRITTEN AGAINST THE NEW SURFACE, not a new
// set of claims: the six buckets in spec order, one entry in exactly one of
// them, the fold's truthful heading, the nudge's section rule, the two owner
// controls, the resolved SLA source, the row props holding still and a queued
// quick update closing the composer are all restated here, because each
// guarantee belonged to the PRODUCT and only the surface moved. Four claims are
// new and are the ones the collapse itself owes: the list is FLAT AND GLOBAL at
// first paint, the drill-in is the only thing that narrows it, the chip badge is
// the same number as the list, and the panel holds no filter of its own.
//
// WHY renderToStaticMarkup AND NOT A DOM: vitest.config.ts is `environment:
// 'node'` and there is no jsdom in the dependency budget. react-dom/server
// exercises the real tree, hooks, bucketing and class names; what it cannot see
// — anything behind a state change or an effect — is claimed nowhere below.
// Only the stores at the edge are mocked: section ORDER, the zero-section rule
// and the counts adding up all run through the REAL `lib/entrySections`, the
// REAL sort and the REAL `lib/i18n`. A test that mocked bucketFollowUps would
// assert that this file can call a function.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import type { MindNode } from '../../lib/mindtree/model'
import type { Entry, EntryHealth, EntryPriority } from '../../types'

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
  g.matchMedia = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  })
  g.document = { documentElement: { dir: 'ltr', lang: 'en' } }

  const TODAY = '2026-07-29'
  /** `created_at + 5 days` is the SLA the `high` priority default would produce. */
  const CREATED = '2026-07-01T00:00:00.000Z'

  const entry = (over: Partial<Entry> & Pick<Entry, 'id' | 'title'>): Entry => ({
    track_id: 'trk-net',
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
  // told apart on one panel, plus a second OVERDUE row on a different track —
  // that pair is what proves the list is cross-track rather than partitioned.
  const entries: Entry[] = [
    entry({ id: 'a', title: 'Overdue one', due_date: '2026-07-20' }),
    entry({ id: 'a2', title: 'Overdue two', due_date: '2026-07-21', track_id: 'trk-infra' }),
    entry({ id: 'b', title: 'Breach by default' }),
    entry({ id: 'c', title: 'Breach by track' }),
    entry({ id: 'd', title: 'Due soon one', due_date: '2026-07-31' }),
    entry({ id: 'e', title: 'Quiet one' }),
    entry({ id: 'f', title: 'Blocked one', status: 'blocked' }),
    entry({ id: 'g', title: 'Nobody owns me', owner_name: null }),
  ]

  const healthRows = new Map<string, EntryHealth>([
    ['a', health('a', { days_overdue: 9, health: 'overdue', due_date: '2026-07-20' })],
    ['a2', health('a2', { days_overdue: 8, health: 'overdue', due_date: '2026-07-21' })],
    ['b', health('b', { sla_due_at: '2026-07-06T00:00:00.000Z', sla_breached: true })],
    ['c', health('c', { sla_due_at: '2026-07-03T00:00:00.000Z', sla_breached: true })],
    ['d', health('d', { due_date: '2026-07-31' })],
    ['e', health('e', { health: 'stale', days_since_activity: 28 })],
    ['f', health('f', { status: 'blocked' })],
    ['g', health('g')],
  ])

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
  } = { entries, health: healthRows, loading: false, error: null, members: [] }

  const empty: Entry[] = []

  return { TODAY, CREATED, state, entry, entries, healthRows, empty, team }
})

vi.mock('../../store/entries', () => ({
  useFilteredEntries: () => fx.state.entries,
  useHealthMap: () => fx.state.health,
  useEntriesLoading: () => fx.state.loading,
  useEntriesError: () => fx.state.error,
  useEntriesCoverage: () => ({
    openLoaded: true,
    closedSince: null,
    trackHistory: {},
    loadedAt: null,
  }),
  useFilterContext: () => ({ meId: 'u1', today: fx.TODAY }),
  loadEntries: () => Promise.resolve(),
  refreshEntries: () => Promise.resolve(),
  patchEntry: () => Promise.resolve({ ok: false, error: 'common.error' }),
  postUpdate: () => Promise.resolve({ ok: false, error: 'common.error' }),
  // Declared even though a static render never fires them: Vitest's module mock
  // is a proxy that throws on an export the factory does not name, so an
  // omission would turn a future interactive test into a module error rather
  // than an assertion failure.
  setStatus: () => Promise.resolve({ ok: false, error: 'common.error' }),
  snoozeFollowUp: () => Promise.resolve({ ok: false, error: 'common.error' }),
}))

vi.mock('../../store/vocab', () => ({
  // `high` carries a 5-day service window; everything else has none. That is the
  // workspace state the SLA-source inference is read against.
  useSlaDays: () => (p: EntryPriority) => (p === 'high' ? 5 : null),
  useStaleDays: () => () => 8,
  useVocab: () => [],
  useVocabAll: () => [],
  useVocabLabel: () => (_kind: string, key: string) => key,
  useVocabColor: () => () => null,
}))

vi.mock('../../store/members', () => ({
  // Mutable, and EMPTY by default: the assign control is the only reader that
  // cares, and every other case here was written against a workspace with no
  // member list. The blocks that need people set `fx.state.members` and put it
  // back.
  useMembers: () => fx.state.members,
  useMemberLabel:
    () =>
    (ownerId?: string | null, ownerName?: string | null): string =>
      ownerId ?? ownerName?.trim() ?? '',
  // NudgeButton resolves the asker's live display name through this map, per
  // api/notifications.ts's contract (the profile first, never a snapshot alone).
  useMemberMap: () => new Map(),
}))

// The nudge overlay holds only asks made in THIS session, over `entries.
// nudged_at` on the row. Empty means "this session has asked nothing", which is
// every case in this file.
vi.mock('../../store/nudges', () => ({
  useLocalAsk: () => undefined,
  sendNudge: () => Promise.resolve({ ok: false, error: 'nudge.errFailed' }),
}))

vi.mock('../../store/config', () => ({
  useTrackMap: () => new Map(),
  useActiveTracks: () => [],
  useGroups: () => [],
}))

vi.mock('../../store/auth', () => ({
  useAuth: () => ({
    session: null,
    profile: { id: 'u1', displayName: 'Me', role: 'member', locale: null },
    loading: false,
  }),
}))

const MapList = (await import('./MapList')).default
const { buildSlaFacts, postQuickUpdate, useAttentionCount } = await import('./MapList')
const { EMPTY_FILTER } = await import('../../lib/entryFilter')
const { t } = await import('../../lib/i18n')

// The component's own source, for the two blocks that assert a property no
// static render can see. Read through import.meta.glob('?raw') rather than
// node:fs, for the reason lib/localeReach.test.ts gives: tsconfig.app.json pins
// `types: ["vite/client"]`, and widening it to include "node" would leak node
// globals into the type space of every app file.
const SOURCES: Record<string, string> = import.meta.glob('./MapList.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
})
const SOURCE = SOURCES['./MapList.tsx'] ?? ''

/* ─────────────────────────────── the harness ─────────────────────────────── */

const node = (over: Partial<MindNode> & Pick<MindNode, 'id' | 'kind'>): MindNode => ({
  label: { kind: 'text', text: 'Everything' },
  count: 0,
  colourVars: {},
  health: { levels: { ok: 0, stale: 0, overdue: 0, critical: 0 }, slaBreached: false },
  children: [],
  collapsed: false,
  depth: 0,
  entryId: null,
  bucketKey: null,
  retired: false,
  ...over,
})

/** The unfocused map: nothing is drilled into, so the list is the workspace's. */
const ROOT = node({ id: 'root', kind: 'root' })

/** One track's subtree, holding the two rows of `trk-net` that are overdue. */
const BRANCH = node({
  id: 'root/track:trk-net',
  kind: 'track',
  depth: 1,
  label: { kind: 'text', text: 'Network' },
  children: [
    node({ id: 'root/track:trk-net/entry:a', kind: 'entry', depth: 3, entryId: 'a' }),
    node({ id: 'root/track:trk-net/entry:e', kind: 'entry', depth: 3, entryId: 'e' }),
  ],
})

const render = (el: ReactElement): string => renderToStaticMarkup(el)

const panel = (props: Partial<Parameters<typeof MapList>[0]> = {}): string =>
  render(
    <MapList
      filter={EMPTY_FILTER}
      scope={ROOT}
      textOf={(label) => (label.kind === 'text' ? label.text : label.key)}
      onFocus={() => {}}
      compact={false}
      announce={() => {}}
      {...props}
    />,
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

const ROW = 'class="mtree-list-row"'

/* ═══════════ the claim the whole collapse rests on: flat and global ═══════════ */
//
// All four critiques converged on one failure mode: cross-track triage chopped
// into per-track buckets. If this panel ever landed scoped to one branch, the
// question its owner asks every morning would cost six drill-ins and six
// independent sorts — a different, worse screen, not a slower one.

describe('MapList — flat and global at first paint', () => {
  it('buckets rows from more than one track together', () => {
    const html = panel()
    // Two overdue rows on two different tracks, under ONE heading counted 2.
    expect(html).toContain('Overdue one')
    expect(html).toContain('Overdue two')
    const overdueAt = html.indexOf('data-section="overdue"')
    const slaAt = html.indexOf('data-section="slaBreach"')
    expect(overdueAt).toBeGreaterThan(-1)
    expect(html.indexOf('Overdue two')).toBeGreaterThan(overdueAt)
    expect(html.indexOf('Overdue two')).toBeLessThan(slaAt)
  })

  it('says so, and offers no way to narrow that the reader did not ask for', () => {
    const html = panel()
    expect(html).toContain(esc(t('map.scopeWhole')))
    // The way OUT of a drill-in is drawn only when there is one to leave.
    expect(html).not.toContain(esc(t('mindtree.clearFocus')))
  })

  it('narrows only when the MAP is drilled in, and then offers the way back', () => {
    const html = panel({ scope: BRANCH })
    expect(html).toContain(esc(t('map.scopeBranch', { label: 'Network' })))
    expect(html).toContain(esc(t('mindtree.clearFocus')))
    // Only the two entries under that node survive, and they land in their own
    // buckets — the scope is a row filter, never a re-bucketing.
    expect(countOf(html, ROW)).toBe(2)
    expect(html).toContain('Overdue one')
    expect(html).toContain('Quiet one')
    expect(html).not.toContain('Overdue two')
  })

  it('walks THROUGH a fold, so a collapsed branch does not lose its rows', () => {
    // `collapsed` is a RENDERING decision: a "+5 more" keeps its children, and a
    // list that only held what the picture happened to be drawing would report a
    // different total every time somebody clicked a node.
    const collapsed = node({ ...BRANCH, collapsed: true })
    expect(countOf(panel({ scope: collapsed }), ROW)).toBe(2)
  })
})

/* ═════════════════════════════ the six buckets ═════════════════════════════ */

describe('MapList — sections', () => {
  it('renders the six buckets in the spec order, SLA breach second', () => {
    const html = panel()
    const at = (id: string): number => html.indexOf(`data-section="${id}"`)

    expect(at('overdue')).toBeGreaterThan(-1)
    expect(at('overdue')).toBeLessThan(at('slaBreach'))
    expect(at('slaBreach')).toBeLessThan(at('dueSoon'))
    expect(at('dueSoon')).toBeLessThan(at('stale'))
    expect(at('stale')).toBeLessThan(at('blocked'))
    expect(at('blocked')).toBeLessThan(at('unassigned'))
  })

  it('puts every entry in exactly one section, so the counts add up', () => {
    const html = panel()
    // One wrapper per rendered row, and one row per seeded entry — an entry
    // counted twice would make the headings lie about the same list.
    expect(countOf(html, ROW)).toBe(fx.entries.length)
    const counts = [...html.matchAll(/entry-section-count">(\d+)</g)].map((m) => Number(m[1]))
    expect(counts).toEqual([2, 2, 1, 1, 1, 1])
    expect(counts.reduce((a, b) => a + b, 0)).toBe(fx.entries.length)
  })

  it('names each bucket, carries its meaning once, and collapses from a button', () => {
    const html = panel()
    expect(html).toContain(esc(t('followups.overdue')))
    expect(html).toContain(esc(t('followups.slaBreach')))
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain(esc(t('entry.collapseSection', { section: t('followups.overdue') })))
    // The hint under each heading — a bucket named "Going quiet" answers half a
    // question.
    expect(html).toContain(esc(t('followups.unassignedHint')))
    expect(html).toContain(esc(t('followups.staleHint')))
    expect(html).toContain(esc(t('followups.onceOnly')))
  })
})

/* ═════════════════════════════ the row's verbs ═════════════════════════════ */

describe('MapList — row actions', () => {
  it('gives every row a quick update and a snooze as real buttons', () => {
    // FollowUps offered these as swipes with buttons behind them; here the
    // gesture is gone and the buttons are the whole path, always visible, never
    // behind a hover.
    const html = panel()
    expect(countOf(html, `class="mtree-list-act-label">${esc(t('followups.addUpdate'))}<`)).toBe(
      fx.entries.length,
    )
    expect(
      countOf(html, `class="mtree-list-act-label">${esc(t('followups.snoozeThreeDays'))}<`),
    ).toBe(fx.entries.length)
  })

  it('can FINISH an item from the row, not only defer one', () => {
    // The gap this closes on the screen it replaces: a row could take, comment
    // on and snooze an item but not complete it, so the most common outcome of a
    // morning pass was the only one that needed the sheet — open it, scroll past
    // the description, tap the status chip, dismiss.
    const html = panel()
    expect(countOf(html, `class="mtree-list-act-label">${esc(t('followups.markDone'))}<`)).toBe(
      fx.entries.length,
    )
    expect(countOf(html, 'mtree-list-act-done')).toBe(fx.entries.length)
  })

  it('reads the PREVIOUS status before writing, so undo cannot restore `new`', () => {
    // Not reachable from a static render: the write is in a handler. Asserted at
    // the source, where the defect would be a single reordered line — an item
    // that was blocked coming back as new is a silent data change.
    const block = SOURCE.slice(SOURCE.indexOf('const handleDone = useCallback('))
    expect(block).toContain('const was = entry.status')
    expect(block.indexOf('const was = entry.status')).toBeLessThan(block.indexOf('setStatus('))
    expect(block).toContain("setStatus(entry.id, was)")
  })

  it('offers "take it" only where the owner question is still open', () => {
    const html = panel()
    // Counted on the label span, not the raw string: every action carries its
    // words twice — once as the announced label and once as the tooltip.
    expect(countOf(html, `class="mtree-list-act-label">${esc(t('followups.takeIt'))}<`)).toBe(1)
  })
})

describe('MapList — the Unassigned bucket hands work to someone', () => {
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
      const html = panel()
      // One row is unassigned in the fixture ('g'), and it is the only one that
      // may hand work on — everywhere else the owner question is answered and
      // this control would be a way to reroute someone's work from a list.
      expect(countOf(html, 'class="select mtree-list-owner"')).toBe(1)
      expect(countOf(html, `class="mtree-list-act-label">${esc(t('followups.takeIt'))}<`)).toBe(1)
    })
  })

  it('lists every teammate as a destination, under a labelled control', () => {
    withTeam(() => {
      const html = panel()
      for (const m of fx.team) {
        expect(html).toContain(`<option value="${m.id}">${m.displayName}</option>`)
      }
      // Named for the ROW, because six of these can be on screen at once and
      // "Assign to…" alone says nothing about which item is moving.
      expect(html).toContain(esc(t('followups.assignFor', { title: 'Nobody owns me' })))
    })
  })

  it('replaces the inert owner badge rather than joining it', () => {
    withTeam(() => {
      const html = panel()
      expect(countOf(html, 'class="owner-badge"')).toBe(fx.entries.length - 1)
      expect(html).not.toContain('data-assigned="false"')
    })
  })

  it('is disabled, not absent, when the workspace has no member list yet', () => {
    // members is [] by default here — the store may not have settled. A control
    // that vanished and came back would move every other button in the row.
    const html = panel()
    expect(countOf(html, 'class="select mtree-list-owner"')).toBe(1)
    expect(html).toMatch(/<select class="select mtree-list-owner" disabled=""/)
  })

  it('clears owner_name in the same patch that sets owner_id', () => {
    // types.ts declares the two columns mutually exclusive. A stale free-text
    // name on a row now owned by a teammate makes the digest and the CSV export
    // disagree with this panel.
    expect(SOURCE).toContain('{ ownerId: member.id, ownerName: null }')
  })
})

/* ──────────────── the chase: where this panel offers to ask ──────────────── */
//
// TWO RULES, TWO OWNERS. `NudgeButton.canNudge` decides WHO can be asked and is
// tested in that file; NUDGEABLE decides WHICH BUCKETS asking is fair in. That
// half lived only in FollowUps.tsx, so this block is what stops it being lost
// with it.

describe('MapList — asking a colleague for an update', () => {
  const owned = (over: Partial<Entry> & Pick<Entry, 'id' | 'title'>): Entry =>
    fx.entry({ owner_id: 'u2', owner_name: null, ...over })

  const withEntries = (entries: Entry[], run: (html: string) => void): void => {
    const before = fx.state.entries
    fx.state.entries = entries
    try {
      run(panel())
    } finally {
      fx.state.entries = before
    }
  }

  it('offers the ask on a colleague’s late, breached, quiet or blocked row', () => {
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
    // the thing colleagues learn to ignore.
    withEntries([owned({ id: 'd', title: 'Due soon one', due_date: '2026-07-31' })], (html) => {
      expect(html).toContain(esc(t('followups.dueSoon')))
      expect(html).not.toContain(esc(t('nudge.ask')))
    })
  })

  it('does NOT offer it in the Unassigned bucket, which has nobody to ask', () => {
    withEntries([fx.entry({ id: 'g', title: 'Nobody owns me', owner_name: null })], (html) => {
      expect(html).toContain(esc(t('followups.unassigned')))
      expect(html).not.toContain(esc(t('nudge.ask')))
    })
  })

  it('does NOT offer it on your own row', () => {
    withEntries([owned({ id: 'e', title: 'Quiet one', owner_id: 'u1' })], (html) => {
      expect(html).toContain(esc(t('followups.stale')))
      expect(html).not.toContain(esc(t('nudge.ask')))
    })
  })
})

/* ═════════════════════════ a bucket longer than the panel ═════════════════════ */

describe('MapList — a section longer than the panel', () => {
  /** `count` rows that all land in one bucket, with no health rows to look up. */
  const manyRows = (count: number): void => {
    fx.state.entries = Array.from({ length: count }, (_, i) =>
      fx.entry({ id: `m${i}`, title: `Row ${i}` }),
    )
    // No view rows: the local fallback reads every one as stale (9 days since
    // activity against an 8-day threshold), so they bucket together.
    fx.state.health = new Map()
  }

  const restore = (): void => {
    fx.state.entries = fx.entries
    fx.state.health = fx.healthRows
  }

  it('mounts FollowUps’ landing-screen budget, not fewer and not the whole bucket', () => {
    // 25 is `MAX_ROWS.comfortable` from the screen this replaces, to the row: a
    // panel that showed less of a bucket than that screen did is a regression,
    // and one that mounted all 500 is ~28 000 DOM elements on a phone.
    manyRows(40)
    try {
      const html = panel()
      expect(countOf(html, ROW)).toBe(25)
      expect(html).toContain('Row 24')
      expect(html).not.toContain('Row 25')
    } finally {
      restore()
    }
  })

  it('keeps the heading count truthful and says how many are folded away', () => {
    // EntrySection takes `count` as a prop precisely so a sliced body cannot make
    // the heading lie — the fold hides rows, never facts.
    manyRows(40)
    try {
      const html = panel()
      expect(html).toContain('entry-section-count">40<')
      expect(html).toContain(esc(t('followups.showAll')))
      expect(html).toContain(esc(t('followups.rowsHidden', { count: 15 })))
      expect(html).toContain(esc(t('followups.showAllIn', { section: t('followups.stale') })))
    } finally {
      restore()
    }
  })

  it('draws no fold at all for a section that fits', () => {
    expect(panel()).not.toContain('mtree-list-fold')
  })

  it('hands the sheet EVERY row as siblings, including the ones behind the fold', () => {
    // FollowUps' sibling policy, and it must not silently become the map's: the
    // fold is a MOUNT bound, not a scope, and stepping through a bucket with the
    // sheet's next button must not stop dead at row 25 with no explanation.
    // The list is built from `s.rows`, never from the sliced `shown`.
    expect(SOURCE).toContain('sections.flatMap((s) => s.rows.map((e) => e.id))')
    const shown = SOURCE.slice(SOURCE.indexOf('const shown ='))
    expect(shown.slice(0, 120)).toContain('s.rows.slice(0, MAX_ROWS)')
  })
})

/* ═════════════════════════ the resolved SLA source ═════════════════════════ */

describe('MapList — the resolved SLA source', () => {
  it('reads a deadline that matches the priority default as the default', () => {
    expect(panel()).toContain(esc(t('followups.slaFromPriority', { count: 5 })))
  })

  it('reads a deadline the priority default cannot explain as a track override', () => {
    expect(panel()).toContain(esc(t('followups.slaFromTrack', { count: 2 })))
  })

  it('marks only the breached rows', () => {
    expect(countOf(panel(), 'mtree-list-sla')).toBe(2)
  })
})

/* ═══════════════ R2-PERF-1 · the row's props hold still ═══════════════ */
//
// `MapListRow` is `memo()`d, so it re-renders when any prop changes identity —
// and two did on EVERY store commit of the screen this replaces: `onOpen`,
// because `orderedIds` is a new array per commit, and `sla`, because
// `resolveSla()` mints a fresh object per call. One tap on Snooze redrew every
// mounted row. `buildSlaFacts` is pure precisely so the reuse is a value claim
// needing no DOM; `handleOpen`'s stability is a dependency-array property
// observable only across two live renders, so it is asserted against the SOURCE
// — a weaker instrument, named as one.

describe('MapList — breached rows keep their SLA object', () => {
  const slaDays = (p: EntryPriority): number | null => (p === 'high' ? 5 : null)

  it('resolves both breaches, and each from the right level', () => {
    const facts = buildSlaFacts(fx.entries, fx.healthRows, slaDays, new Map())
    expect([...facts.keys()].sort()).toEqual(['b', 'c'])
    expect(facts.get('b')).toEqual({ days: 5, source: 'priority' })
    expect(facts.get('c')).toEqual({ days: 2, source: 'track' })
  })

  it('hands back the SAME objects when nothing about the breach changed', () => {
    const first = buildSlaFacts(fx.entries, fx.healthRows, slaDays, new Map())
    // A fresh `entries` array with the same rows in it — which is exactly what
    // every commit produces, and what used to invalidate the whole map.
    const second = buildSlaFacts([...fx.entries], fx.healthRows, slaDays, first)
    expect(second.get('b')).toBe(first.get('b'))
    expect(second.get('c')).toBe(first.get('c'))
    expect(second).not.toBe(first)
  })

  it('mints a new object for the row whose deadline actually moved, and only it', () => {
    const first = buildSlaFacts(fx.entries, fx.healthRows, slaDays, new Map())
    const moved = new Map(fx.healthRows)
    moved.set('c', {
      ...(fx.healthRows.get('c') as EntryHealth),
      sla_due_at: '2026-07-04T00:00:00.000Z',
    })
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

describe('MapList — handleOpen does not depend on the list', () => {
  /** The `const handleOpen = useCallback(…)` statement, to its blank line. */
  const block = ((): string => {
    const at = SOURCE.indexOf('const handleOpen = useCallback(')
    if (at === -1) return ''
    const end = SOURCE.indexOf('\n\n', at)
    return SOURCE.slice(at, end === -1 ? undefined : end)
  })()

  it('found the statement at all', () => {
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
    expect(SOURCE).toContain('orderedRef.current = orderedIds')
  })
})

/* ══════════════════ the filter, and who is allowed to own it ══════════════════ */
//
// On `/followups` the filter WAS the URL, which is what made a triage view
// pasteable into a chat. The map's filter is held by `useMapModel` — one filter,
// one owner, one FilterBar — so this panel must not grow a second copy of any
// part of it. Asserted here is the property that keeps the paste working once
// the map's URL codec is wired: no filter state, every change through the
// caller's writer.

describe('MapList — holds no filter of its own', () => {
  it('has no filter in component state', () => {
    expect(SOURCE).not.toMatch(/useState<FilterState>/)
    expect(SOURCE).not.toMatch(/useState\(\{ \.\.\.EMPTY_FILTER/)
  })

  it('writes Everyone ⇄ Mine straight through the caller’s setter', () => {
    expect(SOURCE).toContain('onFilter({ ...filter, mine })')
  })

  it('draws the segment as a PAIR, both chips carrying their own state', () => {
    // "Mine is on" and "Everyone is off" are two different claims; a lone toggle
    // makes only the first.
    const html = panel({ onFilter: () => {} })
    expect(html).toContain(`aria-pressed="true">${esc(t('followups.whoseAll'))}<`)
    expect(html).toContain(`aria-pressed="false">${esc(t('followups.whoseMine'))}<`)

    const mine = panel({ onFilter: () => {}, filter: { ...EMPTY_FILTER, mine: true } })
    expect(mine).toContain(`aria-pressed="true">${esc(t('followups.whoseMine'))}<`)
    expect(mine).toContain(`aria-pressed="false">${esc(t('followups.whoseAll'))}<`)
  })

  it('draws no segment at all when the caller cannot write the filter', () => {
    // A control that writes to a second copy of `mine` would disagree with the
    // shell's FilterBar the first time either was touched alone. Absent beats
    // wrong: the FilterBar's own Mine chip is still one tap away in its
    // always-visible rail.
    const html = panel()
    expect(html).not.toContain(esc(t('followups.whoseMine')))
  })

  it('pins scope: open outside the filter, so Clear-all cannot change it', () => {
    // Contract risk 9. The pin lives in the derived `applied` value and never in
    // `filter`, so the filter bar can never claim a facet nobody chose.
    expect(SOURCE).toContain("({ ...filter, scope: 'open' })")
  })
})

/* ═══════════════ the badge and the list are one number ═══════════════ */

describe('useAttentionCount', () => {
  /** A probe, because a hook cannot be rendered on its own. */
  const Probe = ({ scoped }: { scoped?: boolean }): ReactElement => (
    <p>{`n=${useAttentionCount(scoped === true ? { ...EMPTY_FILTER, mine: true } : EMPTY_FILTER)}`}</p>
  )

  it('is the number of rows the panel draws', () => {
    expect(render(<Probe />)).toContain(`n=${fx.entries.length}`)
    expect(countOf(panel(), ROW)).toBe(fx.entries.length)
  })

  it('counts what is behind the fold too — the chip is not a row count', () => {
    const before = fx.state.entries
    const beforeHealth = fx.state.health
    fx.state.entries = Array.from({ length: 40 }, (_, i) =>
      fx.entry({ id: `m${i}`, title: `Row ${i}` }),
    )
    fx.state.health = new Map()
    try {
      expect(render(<Probe />)).toContain('n=40')
      expect(countOf(panel(), ROW)).toBe(25)
    } finally {
      fx.state.entries = before
      fx.state.health = beforeHealth
    }
  })

  it('is GLOBAL: it takes a filter and no scope', () => {
    // A badge that shrank because the reader had drilled into one track would
    // say the day is clear when it is not — so the hook has no scope parameter
    // to pass one through, and the panel's own drill-in cannot reach it.
    expect(useAttentionCount.length).toBe(1)
    expect(SOURCE).toContain('return useAttention(filter, null).total')
  })
})

/* ═════════════════════════ empty, loading and failed ═════════════════════════ */

describe('MapList — empty, loading and failed', () => {
  it('says the day is clear rather than showing an empty frame', () => {
    fx.state.entries = fx.empty
    try {
      const html = panel()
      expect(html).toContain(esc(t('followups.allClear')))
      expect(html).toContain(esc(t('followups.allClearHint')))
      expect(html).not.toContain('data-section=')
    } finally {
      fx.state.entries = fx.entries
    }
  })

  it('blames the filter only when there IS one', () => {
    fx.state.entries = fx.empty
    try {
      const html = panel({ filter: { ...EMPTY_FILTER, search: 'nothing-matches-this' } })
      expect(html).toContain(esc(t('followups.empty')))
      expect(html).not.toContain(esc(t('followups.allClear')))
    } finally {
      fx.state.entries = fx.entries
    }
  })

  it('shows a skeleton only while there is genuinely nothing to show', () => {
    fx.state.entries = fx.empty
    fx.state.loading = true
    try {
      expect(panel()).toContain('mtree-list-skel')
    } finally {
      fx.state.entries = fx.entries
      fx.state.loading = false
    }
    // A refetch with rows already on screen must not blank the list somebody is
    // reading — the same rule store/entries applies to its own spinner.
    fx.state.loading = true
    try {
      const html = panel()
      expect(html).not.toContain('mtree-list-skel')
      expect(html).toContain('data-section="overdue"')
    } finally {
      fx.state.loading = false
    }
  })

  it('renders a failed load as an error state, and a failed refetch as a note', () => {
    fx.state.entries = fx.empty
    fx.state.error = 'followups.errLoad'
    try {
      const html = panel()
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
      const html = panel()
      expect(html).toContain('class="mtree-list-note"')
      expect(html).toContain('data-section="overdue"')
      expect(html).not.toContain(esc(t('common.retry')))
    } finally {
      fx.state.error = null
    }
  })
})

/* ═══════════════════════════════ Arabic ═══════════════════════════════ */

describe('MapList — Arabic', () => {
  it('renders every one of its own strings in Arabic, from the same key set', async () => {
    const { setLocale } = await import('../../lib/i18n')
    setLocale('ar')
    try {
      const html = panel({ scope: BRANCH })
      // A key with no Arabic value falls back to the ENGLISH string, so
      // asserting the Arabic is present is the assertion that the namespaces are
      // genuinely translated and not merely at key parity.
      expect(html).toContain(esc(t('followups.overdue')))
      expect(html).toContain(esc(t('followups.snoozeThreeDays')))
      expect(html).toContain(esc(t('map.scopeBranch', { label: 'Network' })))
      expect(html).toContain(esc(t('followups.onceOnly')))
      // The direction is carried by <html dir> and CSS logical properties, so
      // the markup is byte-identical apart from text — no mirrored class, no
      // per-direction branch.
      expect(countOf(html, ROW)).toBe(2)
    } finally {
      setLocale('en')
    }
  })
})

/* ═══════════════ the new namespace, before anyone registers it ═══════════════ */
//
// `map.json` is this unit's and `src/locales/index.ts` is the integrator's, so
// between the two commits `t('map.scopeBranch')` echoes its own key on screen
// and localeParity/localeReach see nothing at all — both walk the REGISTERED
// bundles. These are the assertions those gates will make once it is wired, made
// against the files themselves so the window is covered rather than noted.

describe('the map namespace', () => {
  it('ships the same keys in both languages, under its own single root', async () => {
    const en = (await import('../../locales/en/map.json')).default
    const ar = (await import('../../locales/ar/map.json')).default
    expect(Object.keys(en)).toEqual(['map'])
    expect(Object.keys(ar)).toEqual(['map'])
    expect(Object.keys(en.map).sort()).toEqual(Object.keys(ar.map).sort())
  })

  it('fences every interpolated LABEL in both trees, not only the Arabic one', async () => {
    // `{label}` is a track name an admin typed, so its first strong character
    // can disagree with the paragraph in EITHER direction — an Arabic track name
    // in the English sentence as often as the mirror. bidi.test.ts's
    // USER_VALUE_TOKENS carries `label`, and this is that rule applied early.
    const { FSI, PDI } = await import('../../lib/bidi')
    const en = (await import('../../locales/en/map.json')).default
    const ar = (await import('../../locales/ar/map.json')).default
    for (const tree of [en.map, ar.map] as Record<string, string>[]) {
      for (const [key, value] of Object.entries(tree)) {
        if (!value.includes('{label}')) continue
        expect(value, key).toContain(`${FSI}{label}${PDI}`)
      }
    }
  })
})

/* ─────────── a queued post is a post, not a failure ─────────── */
//
// `store/outbox.ts` freezes the contract: `fail('offline.queued')` is a NOTICE
// and callers "must not roll their optimistic state back on it". A handler
// answering `if (!result.ok) return false` tells the composer to keep the text,
// stay open and skip the toast WHILE the update is already in the thread. The
// natural response is to press Post again — and that is not a retry:
// `postUpdate()` mints a fresh tempId per call, so both flush, and
// `entry_updates` has no UPDATE and no DELETE policy.

describe('MapList — a queued quick update closes the composer', () => {
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
    const calls: { entryId: string; body?: string }[] = []
    await postQuickUpdate(entry, 'swapped the SFP', (i) => {
      calls.push(i)
      return queued()
    })
    expect(calls).toEqual([{ entryId: 'q1', body: 'swapped the SFP' }])
  })
})
