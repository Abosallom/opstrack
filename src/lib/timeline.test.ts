// lib/timeline.ts — the interleave, the window, the search and the breakdown.
//
// EVERY INSTANT IN THIS FILE IS BUILT FROM LOCAL COMPONENTS, never written as a
// `…Z` literal. buildTimeline windows on the LOCAL calendar day
// (instantToIsoDate), so a fixture pinned to `2026-07-15T12:00:00Z` files under
// the 16th in Kiribati and the 15th everywhere else, and the suite would pass on
// the machine it was written on and fail in CI on a different TZ. `at()` below
// converts a local wall-clock time to the instant that produced it, which is
// what the app's own rows are: a timestamptz rendered from a moment somebody
// was at their desk.

import { describe, expect, it } from 'vitest'
import {
  buildTimeline,
  countUntagged,
  groupByDay,
  mergeEntriesById,
  tagBreakdown,
  timelineDay,
  timelineKey,
  windowTags,
} from './timeline'
import type { Entry, EntryStatus, EntryUpdate } from '../types'

/** Local wall-clock → the ISO instant PostgREST would have returned for it. */
function at(year: number, month: number, day: number, hour = 12, minute = 0): string {
  return new Date(year, month - 1, day, hour, minute, 0, 0).toISOString()
}

function entry(partial: Partial<Entry> & Pick<Entry, 'id'>): Entry {
  return {
    track_id: 'tr-onb',
    node_id: null,
    title: 'Vendor portal access',
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
    created_by: 'me',
    created_at: at(2026, 7, 15),
    updated_at: at(2026, 7, 15),
    closed_at: null,
    last_activity_at: at(2026, 7, 15),
    meeting_id: null,
    template_id: null,
    ...partial,
  }
}

function update(partial: Partial<EntryUpdate> & Pick<EntryUpdate, 'id' | 'entry_id'>): EntryUpdate {
  return {
    author_id: 'me',
    body: '',
    status_from: null,
    status_to: null,
    created_at: at(2026, 7, 15, 14),
    ...partial,
  }
}

function tagged(id: string, tags: string[], status: EntryStatus = 'in_progress'): Entry {
  return entry({ id, tags, status })
}

describe('buildTimeline — ordering', () => {
  it('interleaves entries and updates newest first', () => {
    const e1 = entry({ id: 'e1', created_at: at(2026, 7, 10) })
    const e2 = entry({ id: 'e2', created_at: at(2026, 7, 14) })
    const u1 = update({ id: 'u1', entry_id: 'e1', created_at: at(2026, 7, 12) })
    const u2 = update({ id: 'u2', entry_id: 'e2', created_at: at(2026, 7, 16) })

    const items = buildTimeline([e1, e2], [u1, u2])

    expect(items.map(timelineKey)).toEqual(['u:u2', 'e:e2', 'u:u1', 'e:e1'])
  })

  it('stamps an entry at created_at, never at last_activity_at', () => {
    // The whole point: an item raised in January and touched yesterday still
    // files under January, so re-reading the page does not rewrite history.
    const old = entry({
      id: 'e1',
      created_at: at(2026, 1, 4),
      last_activity_at: at(2026, 7, 28),
    })
    const items = buildTimeline([old], [])
    expect(items[0].at).toBe(old.created_at)
    expect(timelineDay(items[0])).toBe('2026-01-04')
  })

  it('puts an update ahead of an entry stamped at the same instant', () => {
    // Newest-first, so "ahead" means "later": the transition row a create wrote
    // did happen after the create.
    const moment = at(2026, 7, 15, 9, 30)
    const e1 = entry({ id: 'e1', created_at: moment })
    const u1 = update({ id: 'u1', entry_id: 'e1', created_at: moment })

    expect(buildTimeline([e1], [u1]).map(timelineKey)).toEqual(['u:u1', 'e:e1'])
  })

  it('breaks a full tie on id, so two loads render identically', () => {
    const moment = at(2026, 7, 15, 9, 30)
    const rows = [entry({ id: 'e-b', created_at: moment }), entry({ id: 'e-a', created_at: moment })]

    expect(buildTimeline(rows, []).map(timelineKey)).toEqual(['e:e-a', 'e:e-b'])
    expect(buildTimeline([...rows].reverse(), []).map(timelineKey)).toEqual(['e:e-a', 'e:e-b'])
  })

  it('orders by parsed instant, not by string — a `Z` row and a `+00:00` row', () => {
    // The optimistic-row trap. `…354Z` and `…354186+00:00` are the same
    // millisecond-ish moment written two ways, and a lexicographic sort puts
    // the offset form first regardless of which is actually newer.
    const older = entry({ id: 'e-old', created_at: '2026-07-15T10:00:00.354186+00:00' })
    const newer = entry({ id: 'e-new', created_at: '2026-07-15T11:00:00.354Z' })

    expect(buildTimeline([older, newer], []).map(timelineKey)).toEqual(['e:e-new', 'e:e-old'])
  })

  it('sorts an unparseable instant to the end instead of scrambling the page', () => {
    const good1 = entry({ id: 'e1', created_at: at(2026, 7, 10) })
    const good2 = entry({ id: 'e2', created_at: at(2026, 7, 12) })
    const bad = entry({ id: 'e3', created_at: 'not a timestamp' })

    expect(buildTimeline([bad, good1, good2], []).map(timelineKey)).toEqual([
      'e:e2',
      'e:e1',
      'e:e3',
    ])
  })
})

describe('buildTimeline — parents', () => {
  it('resolves an update against an entry the window itself excludes', () => {
    // Rule 1 in the module header: the parent map is built before the window is
    // applied, so July's update still knows it belongs to January's request.
    const january = entry({ id: 'e1', title: 'Legacy VPN request', created_at: at(2026, 1, 9) })
    const july = update({ id: 'u1', entry_id: 'e1', created_at: at(2026, 7, 20), body: 'Vendor replied' })

    const items = buildTimeline([january], [july], { from: '2026-07-01', to: '2026-07-31' })

    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('update')
    expect(items[0].kind === 'update' && items[0].entry?.title).toBe('Legacy VPN request')
  })

  it('keeps an orphan update, with no parent, rather than dropping it', () => {
    const orphan = update({ id: 'u1', entry_id: 'gone', created_at: at(2026, 7, 20) })
    const items = buildTimeline([], [orphan])

    expect(items).toHaveLength(1)
    expect(items[0].kind === 'update' && items[0].entry).toBeUndefined()
  })
})

describe('buildTimeline — window', () => {
  const rows = [
    entry({ id: 'before', created_at: at(2026, 6, 30, 23) }),
    entry({ id: 'first', created_at: at(2026, 7, 1, 0, 5) }),
    entry({ id: 'last', created_at: at(2026, 7, 31, 23, 55) }),
    entry({ id: 'after', created_at: at(2026, 8, 1, 0, 5) }),
  ]

  it('is inclusive at both ends', () => {
    const items = buildTimeline(rows, [], { from: '2026-07-01', to: '2026-07-31' })
    expect(items.map((i) => i.kind === 'entry' && i.entry.id)).toEqual(['last', 'first'])
  })

  it('leaves an absent bound unbounded', () => {
    expect(buildTimeline(rows, [], { to: '2026-07-31' })).toHaveLength(3)
    expect(buildTimeline(rows, [], { from: '2026-07-01' })).toHaveLength(3)
    expect(buildTimeline(rows, [], {})).toHaveLength(4)
  })

  it('drops a row whose instant has no calendar day', () => {
    const bad = entry({ id: 'bad', created_at: '' })
    expect(buildTimeline([bad], [], { from: '2026-07-01', to: '2026-07-31' })).toHaveLength(0)
    // …but keeps it when nothing is being asked about dates.
    expect(buildTimeline([bad], [])).toHaveLength(1)
  })
})

describe('buildTimeline — search', () => {
  const firewall = entry({ id: 'e1', title: 'Firewall rule for DC2', tags: ['portal'] })
  const gateway = entry({ id: 'e2', title: 'Payment gateway', description: 'Waiting on the vendor' })
  const note = update({ id: 'u1', entry_id: 'e1', body: 'Vendor confirmed Thursday' })

  it('ANDs the terms — a second word narrows', () => {
    expect(buildTimeline([firewall, gateway], [], { search: 'firewall' })).toHaveLength(1)
    expect(buildTimeline([firewall, gateway], [], { search: 'firewall dc2' })).toHaveLength(1)
    expect(buildTimeline([firewall, gateway], [], { search: 'firewall gateway' })).toHaveLength(0)
  })

  it('reads an entry title, description and tags', () => {
    expect(buildTimeline([firewall, gateway], [], { search: 'portal' })).toHaveLength(1)
    expect(buildTimeline([firewall, gateway], [], { search: 'waiting vendor' })).toHaveLength(1)
  })

  it('reads an update body', () => {
    const items = buildTimeline([firewall], [note], { search: 'thursday' })
    expect(items.map(timelineKey)).toEqual(['u:u1'])
  })

  it("finds an update through its parent's title, so a project name surfaces the conversation", () => {
    // "Vendor confirmed Thursday" contains none of the searcher's words and is
    // exactly what they are looking for.
    const items = buildTimeline([firewall], [note], { search: 'firewall' })
    expect(items.map(timelineKey)).toEqual(['u:u1', 'e:e1'])
  })

  it('folds Arabic and digits on both sides', () => {
    const arabic = entry({ id: 'e3', title: 'ترقية سويتش الكور' })
    // أ → ا is the fold that makes a differently-typed hamza still match.
    expect(buildTimeline([arabic], [], { search: 'الكور' })).toHaveLength(1)
    const indic = entry({ id: 'e4', title: 'Switch ٢٤ port' })
    expect(buildTimeline([indic], [], { search: '24' })).toHaveLength(1)
  })

  it('treats blank and whitespace-only search as no filter', () => {
    expect(buildTimeline([firewall, gateway], [], { search: '   ' })).toHaveLength(2)
  })
})

describe('buildTimeline — kinds', () => {
  const e1 = entry({ id: 'e1' })
  const u1 = update({ id: 'u1', entry_id: 'e1' })

  it('keeps both by default', () => {
    expect(buildTimeline([e1], [u1])).toHaveLength(2)
  })

  it('keeps only what is asked for', () => {
    expect(buildTimeline([e1], [u1], { kinds: ['entry'] }).map(timelineKey)).toEqual(['e:e1'])
    expect(buildTimeline([e1], [u1], { kinds: ['update'] }).map(timelineKey)).toEqual(['u:u1'])
    expect(buildTimeline([e1], [u1], { kinds: [] })).toEqual([])
  })
})

describe('groupByDay', () => {
  it('collects consecutive runs and preserves order', () => {
    const items = buildTimeline(
      [
        entry({ id: 'e1', created_at: at(2026, 7, 14, 9) }),
        entry({ id: 'e2', created_at: at(2026, 7, 15, 9) }),
        entry({ id: 'e3', created_at: at(2026, 7, 15, 17) }),
      ],
      [],
    )
    const days = groupByDay(items)

    expect(days.map((d) => d.day)).toEqual(['2026-07-15', '2026-07-14'])
    expect(days[0].items.map(timelineKey)).toEqual(['e:e3', 'e:e2'])
    expect(days[1].items).toHaveLength(1)
  })

  it('returns nothing for nothing', () => {
    expect(groupByDay([])).toEqual([])
  })
})

describe('tagBreakdown', () => {
  const rows = [
    tagged('e1', ['direct-integration']),
    tagged('e2', ['portal']),
    tagged('e3', ['portal', 'direct-integration']),
    tagged('e4', ['portal'], 'done'),
    tagged('e5', ['portal'], 'cancelled'),
    tagged('e6', []),
  ]

  it('splits open from closed, in the order the tags were given', () => {
    expect(tagBreakdown(rows, ['portal', 'direct-integration'])).toEqual([
      { tag: 'portal', open: 2, closed: 2 },
      { tag: 'direct-integration', open: 2, closed: 0 },
    ])
  })

  it('counts an entry under every tag it carries — the columns do not sum', () => {
    const total = tagBreakdown(rows, ['portal', 'direct-integration']).reduce(
      (n, r) => n + r.open + r.closed,
      0,
    )
    // Six entries, one untagged, one double-tagged.
    expect(total).toBe(6)
    expect(rows).toHaveLength(6)
  })

  it('keeps a zero row, because "nothing came through the portal" is an answer', () => {
    expect(tagBreakdown([tagged('e1', ['portal'])], ['portal', 'direct-integration'])).toEqual([
      { tag: 'portal', open: 1, closed: 0 },
      { tag: 'direct-integration', open: 0, closed: 0 },
    ])
  })

  it('matches folded, and keeps the hyphen meaningful', () => {
    const odd = [tagged('e1', ['Direct-Integration']), tagged('e2', ['directintegration'])]
    expect(tagBreakdown(odd, ['direct-integration'])).toEqual([
      { tag: 'direct-integration', open: 1, closed: 0 },
    ])
  })

  it('counts a repeated tag on one entry once', () => {
    expect(tagBreakdown([tagged('e1', ['portal', 'Portal'])], ['portal'])).toEqual([
      { tag: 'portal', open: 1, closed: 0 },
    ])
  })

  it('dedupes and cleans the requested list, and answers [] for nothing to count', () => {
    expect(tagBreakdown(rows, ['portal', ' portal ', '', '   '])).toEqual([
      { tag: 'portal', open: 2, closed: 2 },
    ])
    expect(tagBreakdown(rows, [])).toEqual([])
  })
})

describe('countUntagged', () => {
  it('counts only the rows carrying no tag at all', () => {
    expect(
      countUntagged([
        tagged('e1', []),
        tagged('e2', [], 'done'),
        tagged('e3', ['portal']),
        tagged('e4', [], 'cancelled'),
      ]),
    ).toEqual({ open: 1, closed: 2 })
  })

  it('is zero for an empty window', () => {
    expect(countUntagged([])).toEqual({ open: 0, closed: 0 })
  })
})

describe('windowTags', () => {
  it("puts the track's suggestions first, in the admin's order", () => {
    const rows = [tagged('e1', ['aaa-typed']), tagged('e2', ['portal'])]
    expect(windowTags(rows, ['direct-integration', 'portal'])).toEqual([
      'direct-integration',
      'portal',
      'aaa-typed',
    ])
  })

  it('sorts the tags only the data holds, and dedupes across both sources', () => {
    const rows = [tagged('e1', ['zeta', 'alpha', 'Portal']), tagged('e2', ['alpha'])]
    expect(windowTags(rows, ['portal'])).toEqual(['portal', 'alpha', 'zeta'])
  })

  it('drops blanks from either source', () => {
    expect(windowTags([tagged('e1', ['  ', 'real'])], ['', '  '])).toEqual(['real'])
  })

  it('keeps a suggestion nothing in the window carries', () => {
    expect(windowTags([], ['direct-integration', 'portal'])).toEqual([
      'direct-integration',
      'portal',
    ])
  })
})

describe('mergeEntriesById', () => {
  it('lets the live row win on a shared id', () => {
    const fetched = entry({ id: 'e1', title: 'Old title', status: 'new' })
    const live = entry({ id: 'e1', title: 'Renamed', status: 'done' })
    const merged = mergeEntriesById([fetched], [live])

    expect(merged).toHaveLength(1)
    expect(merged[0].title).toBe('Renamed')
    expect(merged[0].status).toBe('done')
  })

  it('appends rows only the live store has', () => {
    const merged = mergeEntriesById([entry({ id: 'e1' })], [entry({ id: 'e2' })])
    expect(merged.map((e) => e.id).sort()).toEqual(['e1', 'e2'])
  })

  it('copies rather than aliasing when there is nothing to overlay', () => {
    const base = [entry({ id: 'e1' })]
    const merged = mergeEntriesById(base, [])
    expect(merged).toEqual(base)
    expect(merged).not.toBe(base)
  })
})
