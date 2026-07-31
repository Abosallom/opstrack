// Proof for the accessible half of the Mindtree.
//
// WHY renderToStaticMarkup AND NOT A DOM. vitest.config.ts is `environment:
// 'node'` and jsdom is not in the dependency budget — pages/Board.test.tsx,
// pages/Dashboard.test.tsx and the entry kit's own test all open with that
// paragraph. react-dom/server exercises the real tree, the real locale bundle
// and the real bidi isolation, and hands back markup to assert on.
//
// WHAT THIS FILE IS ACTUALLY FOR. The table is the version of this screen a
// blind user gets and the version an ops lead pastes into an email, so the
// assertions below are about the two things that would silently ruin either:
// the NUMBERS (which must be the tree's own, including the rows behind a
// collapsed branch and a "+N more") and the SEMANTICS (a real <caption>, two
// scope="row" headers per row so a bare "3" is announced with the track and the
// group it belongs to, and aria-sort that tells the truth about the order the
// rows are actually in).
//
// The sort, the row builder and the drill-down filter are pure exports and are
// asserted without rendering anything at all — which is the reason they are
// exported rather than buried in the component.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Entry, EntryHealth, HealthLevel } from '../../types'
// A TYPE-only import, so it is erased before it can run — which is what lets it
// sit above the localStorage shim below without tripping the ordering problem
// that forces every VALUE import in this file to be a dynamic one.
import type { MindNode } from '../../lib/mindtree/model'

vi.hoisted(() => {
  // lib/i18n reads localStorage at module scope and lib/dates reads nothing but
  // the bundles, so this is the whole shim surface — it cannot wait for a
  // beforeAll(), because the import below runs first.
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
})

const { buildMindtree } = await import('../../lib/mindtree/model')
const { EMPTY_FILTER } = await import('../../lib/entryFilter')
const MindtreeTableModule = await import('./MindtreeTable')
const MindtreeTable = MindtreeTableModule.default
const { buildGroupRows, buildTableRows, filterForCell, nextSort, sortTableRows } =
  MindtreeTableModule

// REGISTER THE NAMESPACE, because src/locales/index.ts does not yet — that one
// line is part of the handoff diff the orchestrator lands, and this file must
// not wait for it to be able to prove anything.
//
// This is not a mock: `t()` resolves against the bundle OBJECTS at call time
// (lib/i18n holds `BUNDLES = { en, ar }` by reference), so assigning the
// namespace onto them is precisely what index.ts's spread will do — the same
// keys, from the same JSON, reached the same way.
//
// It matters more than it looks. Without it t() echoes every unknown key
// (lib/i18n's documented miss behaviour), so an assertion like "the cell is
// named after the item it opens" would be comparing one echoed key against
// another and passing no matter what the component did. Registering here is
// what makes the render assertions below about the COMPONENT rather than about
// the wiring — and they now hold identically once the namespace is spread in.
const locales = await import('../../locales')
Object.assign(locales.en, (await import('../../locales/en/mindtree.json')).default)
Object.assign(locales.ar, (await import('../../locales/ar/mindtree.json')).default)

/** A fixed "today", so every age below is an arithmetic assertion. */
const TODAY = '2026-07-31'

function entry(over: Partial<Entry> & Pick<Entry, 'id' | 'title'>): Entry {
  return {
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
    created_by: null,
    created_at: '2026-07-24T09:00:00.000Z',
    updated_at: '2026-07-24T09:00:00.000Z',
    closed_at: null,
    last_activity_at: '2026-07-24T09:00:00.000Z',
    meeting_id: null,
    template_id: null,
    ...over,
  }
}

function health(id: string, over: Partial<EntryHealth> = {}): EntryHealth {
  return {
    id,
    entry_id: id,
    track_id: null,
    status: 'new',
    priority: 'medium',
    due_date: null,
    last_activity_at: '2026-07-24T09:00:00.000Z',
    days_since_activity: 7,
    days_overdue: 0,
    health: 'ok' as HealthLevel,
    sla_due_at: null,
    sla_breached: false,
    ...over,
  }
}

const TRACKS = [
  { id: 't-net', label: 'Network', color: '#22b8d6', colorLight: null, sortOrder: 1, archived: false },
  { id: 't-pmo', label: 'PMO', color: '#f0a020', colorLight: null, sortOrder: 2, archived: false },
]

const STATUS_VOCAB = [
  { key: 'new', label: 'New', hidden: false },
  { key: 'blocked', label: 'Blocked', hidden: false },
]

/**
 * Four items on Network (two new — one of them unassigned and 30 days old, one
 * blocked and past its SLA), one on PMO, and a leaf threshold of 1 so the "+N
 * more" fold is EXERCISED rather than assumed away.
 */
function tree(over: Partial<Parameters<typeof buildMindtree>[0]> = {}): MindNode {
  const entries = [
    entry({ id: 'e1', title: 'Firewall rule DC2', status: 'new', created_at: '2026-07-01T09:00:00.000Z' }),
    entry({ id: 'e2', title: 'MPLS circuit order', status: 'new', owner_id: 'm-1' }),
    entry({ id: 'e3', title: 'Core switch RMA', status: 'new', owner_name: 'Acme Ltd' }),
    entry({ id: 'e4', title: 'Vendor escalation', status: 'blocked', owner_id: 'm-1' }),
    entry({ id: 'e5', title: 'Charter sign-off', track_id: 't-pmo', status: 'new', owner_id: 'm-1' }),
  ]
  return buildMindtree({
    entries,
    health: new Map([['e4', health('e4', { sla_breached: true, status: 'blocked' })]]),
    tracks: TRACKS,
    vocab: STATUS_VOCAB,
    members: [{ id: 'm-1', displayName: 'Layla' }],
    dimension: 'status',
    filter: EMPTY_FILTER,
    ctx: { meId: null, today: TODAY },
    collapsedIds: new Set<string>(),
    leafThreshold: 1,
    ...over,
  })
}

const ENTRY_MAP = new Map<string, Entry>(
  [
    entry({ id: 'e1', title: 'Firewall rule DC2', created_at: '2026-07-01T09:00:00.000Z' }),
    entry({ id: 'e2', title: 'MPLS circuit order', owner_id: 'm-1' }),
    entry({ id: 'e3', title: 'Core switch RMA', owner_name: 'Acme Ltd' }),
    entry({ id: 'e4', title: 'Vendor escalation', status: 'blocked', owner_id: 'm-1' }),
    entry({ id: 'e5', title: 'Charter sign-off', track_id: 't-pmo', owner_id: 'm-1' }),
  ].map((e) => [e.id, e]),
)

function rowsOf(root: MindNode = tree()) {
  return buildTableRows(root, ENTRY_MAP, TODAY)
}

describe('buildTableRows', () => {
  it('emits one row per track × group, in the tree order', () => {
    const rows = rowsOf()
    expect(rows.map((r) => [r.trackLabel, r.groupLabel])).toEqual([
      ['Network', 'New'],
      ['Network', 'Blocked'],
      ['PMO', 'New'],
    ])
    expect(rows.map((r) => r.order)).toEqual([0, 1, 2])
  })

  it('counts the rows behind a fold — the "+N more" tail is still in the table', () => {
    // leafThreshold 1 folds two of the three New items on Network behind a
    // collapsed "+2 more" node. The picture hides them; the table must not.
    const rows = rowsOf()
    const networkNew = rows[0]
    expect(networkNew?.count).toBe(3)
    expect(networkNew?.unassigned).toBe(1)
    // The map's own node agrees, which is the property that actually matters.
    expect(networkNew?.count).toBe(tree().children[0]?.children[0]?.count)
  })

  it('counts a breach that sits behind the fold', () => {
    const rows = rowsOf()
    expect(rows[1]?.groupLabel).toBe('Blocked')
    expect(rows[1]?.breached).toBe(1)
    expect(rows[0]?.breached).toBe(0)
  })

  it('measures the oldest item from the day it was raised', () => {
    // e1 was created 2026-07-01, so on 2026-07-31 it is 30 days old and it is
    // the oldest thing in the Network/New cell.
    expect(rowsOf()[0]?.oldestDays).toBe(30)
    // Everything else in the fixture was raised on 2026-07-24.
    expect(rowsOf()[2]?.oldestDays).toBe(7)
  })

  it('names the sole entry of a one-item cell, and only then', () => {
    const rows = rowsOf()
    expect(rows[1]?.soleEntryId).toBe('e4')
    expect(rows[1]?.soleTitle).toBe('Vendor escalation')
    expect(rows[0]?.soleEntryId).toBeNull()
  })

  it('gives a track with no open work one row rather than none', () => {
    // "Which track is clear?" is a question this screen answers, and a track
    // that vanished when its last item closed would answer it by looking
    // exactly like a track nobody ever configured.
    const root = tree({ entries: [] })
    const rows = buildTableRows(root, new Map(), TODAY)
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.empty && r.count === 0 && r.oldestDays === null)).toBe(true)
    expect(rows.map((r) => r.trackLabel)).toEqual(['Network', 'PMO'])
  })

  it('carries the retired flags rather than dropping the buckets', () => {
    const root = tree({
      tracks: [{ ...TRACKS[0]!, archived: true }, TRACKS[1]!],
      vocab: [STATUS_VOCAB[0]!, { key: 'blocked', label: 'Blocked', hidden: true }],
    })
    const rows = buildTableRows(root, ENTRY_MAP, TODAY)
    const blocked = rows.find((r) => r.groupLabel === 'Blocked')
    expect(blocked?.trackRetired).toBe(true)
    expect(blocked?.groupRetired).toBe(true)
    // Retired or not, the work is still counted.
    expect(rows.reduce((n, r) => n + r.count, 0)).toBe(5)
  })
})

describe('buildGroupRows — the answer the map cannot draw', () => {
  it('adds a group up across every track it appears in', () => {
    // Ring 2 is nested inside ring 1, so `New` is drawn twice — three on
    // Network, one on PMO — and the map shows two numbers where the reader
    // wants one. This is the one.
    const root = tree()
    const groups = buildGroupRows(root, rowsOf(root))
    expect(groups.map((g) => [g.label, g.count])).toEqual([
      ['New', 4],
      ['Blocked', 1],
    ])
  })

  it('ranks by size, because "where is the mass" is the question', () => {
    const root = tree()
    const counts = buildGroupRows(root, rowsOf(root)).map((g) => g.count)
    expect(counts).toEqual([...counts].sort((a, b) => b - a))
  })

  it('carries the unassigned and breached totals from the rows above it', () => {
    // ONE arithmetic path per number: `count` off the tree nodes (so it can
    // never disagree with the picture), the other two summed off the same rows
    // the big table renders (so the two tables on one screen agree).
    const root = tree()
    const groups = buildGroupRows(root, rowsOf(root))
    expect(groups.find((g) => g.label === 'New')?.unassigned).toBe(1)
    expect(groups.find((g) => g.label === 'Blocked')?.breached).toBe(1)
  })

  it('totals to the root, fold and all', () => {
    const root = tree()
    const total = buildGroupRows(root, rowsOf(root)).reduce((n, g) => n + g.count, 0)
    expect(total).toBe(root.count)
  })

  it('holds an empty track against nothing', () => {
    // An active track with no open work contributes no groups at all, so it
    // cannot invent a bucket or a zero row here.
    const root = tree({ entries: [] })
    expect(buildGroupRows(root, rowsOf(root))).toEqual([])
  })
})

describe('sortTableRows', () => {
  it('null restores the tree order — the order the picture is drawn in', () => {
    const rows = rowsOf()
    const scrambled = [...rows].reverse()
    expect(sortTableRows(scrambled, null).map((r) => r.order)).toEqual([0, 1, 2])
  })

  it('sorts numbers, with the document order as the tiebreak', () => {
    const rows = rowsOf()
    expect(sortTableRows(rows, { column: 'count', dir: 'desc' }).map((r) => r.count)).toEqual([3, 1, 1])
    // Two rows tie at 1; the tiebreak keeps them in tree order, so the result
    // is TOTAL and a re-render cannot reshuffle them.
    expect(
      sortTableRows(rows, { column: 'count', dir: 'desc' }).map((r) => r.order),
    ).toEqual([0, 1, 2])
    expect(sortTableRows(rows, { column: 'count', dir: 'asc' }).map((r) => r.order)).toEqual([1, 2, 0])
  })

  it('sorts an empty cell below a zero-day-old one, in both directions', () => {
    const rows = [...rowsOf(), ...buildTableRows(tree({ entries: [] }), new Map(), TODAY)]
    const desc = sortTableRows(rows, { column: 'age', dir: 'desc' })
    expect(desc[desc.length - 1]?.oldestDays).toBeNull()
    const asc = sortTableRows(rows, { column: 'age', dir: 'asc' })
    expect(asc[0]?.oldestDays).toBeNull()
  })

  it('sorts text folded and by code point, never by localeCompare', () => {
    const rows = rowsOf()
    expect(sortTableRows(rows, { column: 'group', dir: 'asc' }).map((r) => r.groupLabel)).toEqual([
      'Blocked',
      'New',
      'New',
    ])
  })
})

describe('nextSort', () => {
  const countCol = { key: 'count' as const, labelKey: 'mindtree.colOpen', numeric: true }
  const trackCol = { key: 'track' as const, labelKey: 'mindtree.colTrack', numeric: false }

  it('opens a number column descending and a text column ascending', () => {
    expect(nextSort(null, countCol)).toEqual({ column: 'count', dir: 'desc' })
    expect(nextSort(null, trackCol)).toEqual({ column: 'track', dir: 'asc' })
  })

  it('cycles back to the tree order on the third press', () => {
    const one = nextSort(null, countCol)
    const two = nextSort(one, countCol)
    expect(two).toEqual({ column: 'count', dir: 'asc' })
    expect(nextSort(two, countCol)).toBeNull()
  })

  it('starts a different column fresh rather than inheriting a direction', () => {
    expect(nextSort({ column: 'count', dir: 'asc' }, trackCol)).toEqual({ column: 'track', dir: 'asc' })
  })
})

describe('filterForCell', () => {
  const rows = rowsOf()

  it('narrows to the cell on both axes and clears the facets it replaces', () => {
    const next = filterForCell({ ...EMPTY_FILTER, search: 'dc2' }, 'status', rows[1]!)
    expect(next.trackIds).toEqual(['t-net'])
    expect(next.statuses).toEqual(['blocked'])
    expect(next.owner).toEqual({ kind: 'any' })
    // A facet that narrows WITHIN the cell survives — the reader chose it.
    expect(next.search).toBe('dc2')
  })

  it('maps every dimension onto its own facet', () => {
    const owned = buildTableRows(tree({ dimension: 'owner' }), ENTRY_MAP, TODAY)
    const unassigned = owned.find((r) => r.groupKey === '')
    const member = owned.find((r) => r.groupKey === 'm-1')
    const vendor = owned.find((r) => r.groupKey?.startsWith('name:'))
    expect(filterForCell(EMPTY_FILTER, 'owner', unassigned!).owner).toEqual({ kind: 'unassigned' })
    expect(filterForCell(EMPTY_FILTER, 'owner', member!).owner).toEqual({ kind: 'id', id: 'm-1' })
    // A free-text owner keeps its own facet: a vendor owns real work, and
    // folding it into a member id would filter to the wrong person.
    expect(filterForCell(EMPTY_FILTER, 'owner', vendor!).owner).toEqual({ kind: 'name', name: 'Acme Ltd' })

    const byHealth = buildTableRows(tree({ dimension: 'health' }), ENTRY_MAP, TODAY)
    expect(filterForCell(EMPTY_FILTER, 'health', byHealth[0]!).health).toEqual(['ok'])
  })

  it('leaves the track facet alone for the untracked pile', () => {
    // FilterState has no "no track at all" facet, so narrowing the track half
    // would filter to nothing. Documented gap, asserted so it stays deliberate.
    const untracked = buildTableRows(
      tree({ entries: [entry({ id: 'e9', title: 'Loose end', track_id: null })] }),
      new Map([['e9', entry({ id: 'e9', title: 'Loose end', track_id: null })]]),
      TODAY,
    ).find((r) => r.trackKey === '')
    expect(untracked).toBeDefined()
    const next = filterForCell({ ...EMPTY_FILTER, trackIds: ['t-pmo'] }, 'status', untracked!)
    expect(next.trackIds).toEqual(['t-pmo'])
    expect(next.statuses).toEqual(['new'])
  })
})

describe('the rendered table', () => {
  const html = renderToStaticMarkup(
    <MindtreeTable root={tree()} dimension="status" entryById={ENTRY_MAP} today={TODAY} onFilterCell={() => {}} />,
  )

  // The strings below are the REAL ones: the namespace is registered at the top
  // of this file for the reason given there.

  /**
   * The one-item cell's name under an ARABIC ui, which is the only place the
   * bug this pins is visible.
   *
   * The name is built from a Latin status label and an Arabic sentence. Compose
   * it with a template literal and the group label carries no isolate, so the
   * bidi algorithm is free to reorder the Latin run against the Arabic around
   * it — and an English test cannot see the difference, because a Latin label in
   * a Latin sentence reorders into itself. Hence this test: it renders in `ar`
   * and asserts the isolate is actually on the label.
   */
  it('isolates the group label inside the accessible name, in Arabic too', async () => {
    const i18n = await import('../../lib/i18n')
    // setLocale() pushes dir/lang onto <html>; there is no document in this
    // environment, so give it the one property applyLocale() touches.
    const g = globalThis as unknown as Record<string, unknown>
    g.document = { documentElement: {} }

    i18n.setLocale('ar')
    try {
      const ar = renderToStaticMarkup(
        <MindtreeTable root={tree()} dimension="status" entryById={ENTRY_MAP} today={TODAY} onFilterCell={() => {}} />,
      )
      // ⟨Blocked⟩ isolated, then the ARABIC comma from ar/mindtree.json's own
      // `nodeName` — proof the separator came from the bundle rather than from a
      // Latin ", " hard-coded in the component.
      expect(ar).toContain('aria-label="⁨Blocked⁩، ')
      // The title keeps its own isolate: two independent runs, two isolates.
      expect(ar).toContain('⁨Vendor escalation⁩')
      // Digits stay Latin because formatAge owns them, not the bundle.
      expect(ar).toMatch(/>30ي</)
    } finally {
      i18n.setLocale('en')
    }
  })

  it('is a real table with a caption and column headers', () => {
    expect(html).toContain('<table')
    expect(html).toContain('<caption')
    // The caption's title is the region's accessible name, so the scroll
    // container a keyboard user tabs into is never an unlabelled box.
    const captionId = /id="([^"]+)"/.exec(html)?.[1]
    expect(captionId).toBeDefined()
    expect(html).toContain(`aria-labelledby="${captionId}"`)
    expect(html).toContain('mtree-tbl-captiondesc')
    // Six on the track × group table, four on the by-group block below it.
    expect((html.match(/scope="col"/g) ?? []).length).toBe(6 + 4)
  })

  it('gives every row TWO row headers, so a bare number is never announced alone', () => {
    // Three cells × (track + group), one for the footer's Total, then one per
    // row of the by-group block (which has a single label column).
    expect((html.match(/scope="row"/g) ?? []).length).toBe(3 * 2 + 1 + 2)
  })

  it('declares an unsorted table as unsorted on every column', () => {
    expect((html.match(/aria-sort="none"/g) ?? []).length).toBe(6)
    expect(html).not.toContain('aria-sort="ascending"')
  })

  it('offers a real button per sortable column', () => {
    expect((html.match(/<button type="button" class="btn btn-sm btn-ghost mtree-tbl-sortbtn"/g) ?? []).length).toBe(6)
  })

  it('names the one-item cell after the item it opens, and the many-item cell after the cell', () => {
    // WCAG 2.5.3: the accessible name has to contain the visible label, or a
    // voice user cannot say what they can read. The one-item cell's name is
    // composed as `⟨group⟩, Open ⟨title⟩`, so it opens with the group label —
    // ISOLATED, because a group label is database text and a Latin status under
    // an Arabic UI would otherwise swap sides with the sentence around it. The
    // isolate is asserted rather than tolerated: dropping it is invisible in
    // English and only breaks in the language nobody runs the tests in.
    expect(html).toMatch(/aria-label="⁨Blocked⁩[^"]*"/)
    // …and the item it opens is visible in the cell, isolated.
    expect(html).toContain('⁨Vendor escalation⁩')
    // The many-item cell names BOTH headers and says what it actually does.
    // It shipped as "Focus on ⟨New⟩", which was wrong twice: a group repeats
    // under every track so the name was not unique (three "Focus on ⟨Blocked⟩"
    // buttons in a fifteen-button table), and "focus" is the MAP's drill-in
    // verb while the button rewrites the page's filter.
    expect(html).toContain('aria-label="Show only ⁨Network⁩, ⁨New⁩"')
    expect(html).not.toMatch(/aria-label="[^"]*focus[^"]*"/i)
  })

  it('gives no two cell buttons the same accessible name', () => {
    // WCAG 2.5.3 in the form that actually bites here: this table is the view a
    // screen-reader user is handed INSTEAD of the picture, and its elements
    // list is the navigation. Names that collapse make it unusable — which is
    // exactly what the track-less name did.
    const names = [...html.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1])
    expect(names.length).toBeGreaterThan(1)
    expect(new Set(names).size).toBe(names.length)
  })

  it('isolates database text, so an Arabic name cannot swap sides with a count', () => {
    // U+2068 FIRST STRONG ISOLATE around the track label.
    expect(html).toContain('⁨Network⁩')
  })

  it('totals the table off the root node', () => {
    expect(html).toContain('mtree-tbl-total')
    // 5 entries in the fixture, 1 unassigned, 1 breached, oldest 30 days —
    // and `30d` comes from lib/dates' formatAge, so the digits stay Latin in
    // both languages.
    expect(html).toMatch(/mtree-tbl-total[\s\S]*>5<\/td>[\s\S]*>1<\/td>[\s\S]*>1<\/td>[\s\S]*>30d<\/td>/)
  })

  it('paints the track colour from the custom-property pair, never a hex in JS', () => {
    expect(html).toContain('--track-c-dark:#22b8d6')
  })

  it('says so plainly when the workspace has no tracks at all', () => {
    const blank = renderToStaticMarkup(
      <MindtreeTable
        root={tree({ tracks: [], entries: [] })}
        dimension="status"
        entryById={new Map()}
        today={TODAY}
      />,
    )
    expect(blank).toContain('mtree-tbl-blank')
    // No table at all, rather than a table of nothing with a header row that
    // promises columns the workspace has no data for.
    expect(blank).not.toContain('<table')
  })

  it('renders a many-item cell as text when the page offers no drill-down', () => {
    const noFilter = renderToStaticMarkup(
      <MindtreeTable root={tree()} dimension="status" entryById={ENTRY_MAP} today={TODAY} />,
    )
    // Six header buttons plus the two one-item cells, which still open. The
    // three-item cell gets text: an affordance nobody wired is worse than none.
    expect((noFilter.match(/mtree-tbl-cellbtn/g) ?? []).length).toBe(2)
    expect((html.match(/mtree-tbl-cellbtn/g) ?? []).length).toBe(3)
  })
})
