import { describe, expect, it } from 'vitest'
import {
  EMPTY_FILTER,
  countActiveFacets,
  filterFromParams,
  filterKey,
  filterToParams,
  isFilterEmpty,
  matchesFilter,
  selectEntries,
  sortEntries,
  type FilterContext,
  type FilterState,
} from './entryFilter'
import type { Entry, EntryHealth } from '../types'

const CTX: FilterContext = { meId: 'me', today: '2026-07-29' }

function entry(partial: Partial<Entry> = {}): Entry {
  return {
    id: 'e1',
    track_id: 'tr1',
    title: 'Migrate the payment gateway',
    description: '',
    type: 'action',
    status: 'in_progress',
    priority: 'high',
    owner_id: null,
    owner_name: null,
    requester: null,
    due_date: null,
    follow_up_date: null,
    tags: [],
    links: [],
    created_by: null,
    created_at: '2026-07-01T12:00:00.000Z',
    updated_at: '2026-07-29T12:00:00.000Z',
    closed_at: null,
    last_activity_at: '2026-07-29T12:00:00.000Z',
    meeting_id: null,
    template_id: null,
    ...partial,
  }
}

function health(partial: Partial<EntryHealth> & Pick<EntryHealth, 'id'>): EntryHealth {
  return {
    entry_id: partial.id,
    track_id: null,
    status: 'in_progress',
    priority: 'high',
    due_date: null,
    last_activity_at: '2026-07-29T12:00:00.000Z',
    days_since_activity: 0,
    days_overdue: 0,
    health: 'ok',
    sla_due_at: null,
    sla_breached: false,
    ...partial,
  }
}

function filter(partial: Partial<FilterState> = {}): FilterState {
  return { ...EMPTY_FILTER, ...partial }
}

const NO_HEALTH = new Map<string, EntryHealth>()

function matches(e: Entry, f: Partial<FilterState>, h?: EntryHealth, c: FilterContext = CTX): boolean {
  return matchesFilter(e, filter(f), h, c)
}

describe('EMPTY_FILTER', () => {
  it('is frozen, so a screen cannot mutate the shared default', () => {
    expect(Object.isFrozen(EMPTY_FILTER)).toBe(true)
  })

  it('scopes to open work and matches everything open', () => {
    expect(EMPTY_FILTER.scope).toBe('open')
    expect(matches(entry(), {})).toBe(true)
    expect(matches(entry({ status: 'done' }), {})).toBe(false)
  })
})

describe('scope', () => {
  it('routes through lib/health.isOpen rather than a local status list', () => {
    expect(matches(entry({ status: 'done' }), { scope: 'closed' })).toBe(true)
    expect(matches(entry({ status: 'cancelled' }), { scope: 'closed' })).toBe(true)
    expect(matches(entry({ status: 'blocked' }), { scope: 'closed' })).toBe(false)
    expect(matches(entry({ status: 'done' }), { scope: 'all' })).toBe(true)
    expect(matches(entry({ status: 'blocked' }), { scope: 'all' })).toBe(true)
  })
})

describe('the closed-vocabulary facets', () => {
  it('an empty array means ALL, not none', () => {
    expect(matches(entry(), { statuses: [], priorities: [], types: [], trackIds: [] })).toBe(true)
  })

  it('narrows on membership', () => {
    expect(matches(entry({ status: 'blocked' }), { statuses: ['blocked', 'waiting_on'] })).toBe(true)
    expect(matches(entry({ status: 'new' }), { statuses: ['blocked'] })).toBe(false)
    expect(matches(entry({ priority: 'low' }), { priorities: ['critical'] })).toBe(false)
    expect(matches(entry({ type: 'decision' }), { types: ['decision'] })).toBe(true)
  })

  it('a track-less entry matches no specific track', () => {
    expect(matches(entry({ track_id: null }), { trackIds: ['tr1'] })).toBe(false)
    expect(matches(entry({ track_id: null }), {})).toBe(true)
  })
})

describe('owner', () => {
  it('me is owner_id, not created_by', () => {
    expect(matches(entry({ owner_id: 'me' }), { owner: { kind: 'me' } })).toBe(true)
    expect(matches(entry({ created_by: 'me' }), { owner: { kind: 'me' } })).toBe(false)
  })

  it('unassigned means neither an id nor free text', () => {
    const f = { owner: { kind: 'unassigned' } } as const
    expect(matches(entry(), f)).toBe(true)
    expect(matches(entry({ owner_name: '  ' }), f)).toBe(true)
    expect(matches(entry({ owner_name: 'Vendor' }), f)).toBe(false)
    expect(matches(entry({ owner_id: 'u2' }), f)).toBe(false)
  })

  it('matches a free-text owner by FOLDED equality, not substring', () => {
    const f = { owner: { kind: 'name', name: 'Ali' } } as const
    expect(matches(entry({ owner_name: 'ali' }), f)).toBe(true)
    expect(matches(entry({ owner_name: 'Ali Hassan' }), f)).toBe(false)
  })

  it('folds Arabic spelling variants of the same name', () => {
    expect(
      matches(entry({ owner_name: 'أحمد' }), { owner: { kind: 'name', name: 'احمد' } }),
    ).toBe(true)
  })

  it('signed out, `me` matches nothing rather than every unowned row', () => {
    const anon: FilterContext = { meId: null, today: '2026-07-29' }
    expect(matches(entry({ owner_id: null }), { owner: { kind: 'me' } }, undefined, anon)).toBe(false)
  })
})

describe('mine', () => {
  it('is owner OR creator — a different question from the owner facet', () => {
    expect(matches(entry({ owner_id: 'me' }), { mine: true })).toBe(true)
    expect(matches(entry({ created_by: 'me' }), { mine: true })).toBe(true)
    expect(matches(entry({ owner_id: 'u2', created_by: 'u2' }), { mine: true })).toBe(false)
  })

  it('matches nothing when signed out, instead of matching every null-owned row', () => {
    const anon: FilterContext = { meId: null, today: '2026-07-29' }
    expect(matches(entry(), { mine: true }, undefined, anon)).toBe(false)
  })
})

describe('tags — AND semantics', () => {
  it('requires EVERY listed tag', () => {
    const e = entry({ tags: ['portal', 'direct-integration'] })
    expect(matches(e, { tags: ['portal'] })).toBe(true)
    expect(matches(e, { tags: ['portal', 'direct-integration'] })).toBe(true)
    expect(matches(e, { tags: ['portal', 'missing'] })).toBe(false)
  })

  it('keeps the hyphen meaningful — a tag is not folded into a key', () => {
    expect(matches(entry({ tags: ['direct-integration'] }), { tags: ['directintegration'] })).toBe(
      false,
    )
  })

  it('folds case and Arabic orthography', () => {
    expect(matches(entry({ tags: ['Portal'] }), { tags: ['portal'] })).toBe(true)
    expect(matches(entry({ tags: ['إطلاق'] }), { tags: ['اطلاق'] })).toBe(true)
  })
})

describe('search', () => {
  it('ANDs the terms across title, description and tags', () => {
    const e = entry({ title: 'Network outage', description: 'Riyadh DC', tags: ['sev1'] })
    expect(matches(e, { search: 'network' })).toBe(true)
    expect(matches(e, { search: 'outage network' })).toBe(true)
    expect(matches(e, { search: 'riyadh sev1' })).toBe(true)
    expect(matches(e, { search: 'network jeddah' })).toBe(false)
  })

  it('folds case, Arabic orthography and Arabic-Indic digits', () => {
    expect(matches(entry({ title: 'Payment Gateway' }), { search: 'PAYMENT' })).toBe(true)
    expect(matches(entry({ title: 'إطلاق البوابة' }), { search: 'اطلاق' })).toBe(true)
    expect(matches(entry({ title: 'الربع ٤' }), { search: '4' })).toBe(true)
  })

  it('a whitespace-only search is not a filter', () => {
    expect(matches(entry(), { search: '   ' })).toBe(true)
  })
})

describe('health facet', () => {
  it('narrows on the view’s level', () => {
    const h = health({ id: 'e1', health: 'overdue' })
    expect(matches(entry(), { health: ['overdue'] }, h)).toBe(true)
    expect(matches(entry(), { health: ['stale'] }, h)).toBe(false)
  })

  it('excludes an entry with no health row instead of silently passing it', () => {
    // scope:'all' + health:['overdue'] must not return every closed entry too.
    expect(matches(entry({ status: 'done' }), { scope: 'all', health: ['overdue'] })).toBe(false)
    expect(matches(entry(), { health: ['ok'] }, undefined)).toBe(false)
  })
})

describe('date range', () => {
  it('is over LAST ACTIVITY — an old item worked on yesterday is in this week', () => {
    const e = entry({
      created_at: '2026-01-05T12:00:00.000Z',
      last_activity_at: '2026-07-28T12:00:00.000Z',
    })
    expect(matches(e, { from: '2026-07-26', to: '2026-08-01' })).toBe(true)
    expect(matches(e, { from: '2026-07-29' })).toBe(false)
    expect(matches(e, { to: '2026-07-27' })).toBe(false)
  })

  it('is inclusive on both ends', () => {
    const e = entry({ last_activity_at: '2026-07-28T12:00:00.000Z' })
    expect(matches(e, { from: '2026-07-28', to: '2026-07-28' })).toBe(true)
  })
})

describe('sortEntries', () => {
  const a = entry({
    id: 'a',
    title: 'Zebra',
    priority: 'low',
    due_date: '2026-08-10',
    created_at: '2026-07-01T12:00:00.000Z',
    last_activity_at: '2026-07-20T12:00:00.000Z',
  })
  const b = entry({
    id: 'b',
    title: 'apple',
    priority: 'critical',
    due_date: null,
    created_at: '2026-07-05T12:00:00.000Z',
    last_activity_at: '2026-07-28T12:00:00.000Z',
  })
  const c = entry({
    id: 'c',
    title: 'Mango',
    priority: 'medium',
    due_date: '2026-08-01',
    created_at: '2026-07-03T12:00:00.000Z',
    last_activity_at: '2026-07-25T12:00:00.000Z',
  })
  const all = [a, b, c]

  it('does not mutate its input — the store list is shared by every screen', () => {
    const input = [...all]
    sortEntries(input, 'title')
    expect(input).toEqual(all)
  })

  it('activity and created are newest first', () => {
    expect(sortEntries(all, 'activity').map((e) => e.id)).toEqual(['b', 'c', 'a'])
    expect(sortEntries(all, 'created').map((e) => e.id)).toEqual(['b', 'c', 'a'])
  })

  it('due is ascending with nulls LAST', () => {
    expect(sortEntries(all, 'due').map((e) => e.id)).toEqual(['c', 'a', 'b'])
  })

  it('priority is critical first, then most recent activity', () => {
    expect(sortEntries(all, 'priority').map((e) => e.id)).toEqual(['b', 'c', 'a'])
  })

  it('title is folded, so case does not split the alphabet', () => {
    expect(sortEntries(all, 'title').map((e) => e.id)).toEqual(['b', 'c', 'a'])
  })

  it('breaks every tie on id, so identical rows never reorder between fetches', () => {
    const x = entry({ id: 'x', last_activity_at: '2026-07-20T12:00:00.000Z' })
    const y = entry({ id: 'y', last_activity_at: '2026-07-20T12:00:00.000Z' })
    expect(sortEntries([y, x], 'activity').map((e) => e.id)).toEqual(['x', 'y'])
    expect(sortEntries([x, y], 'activity').map((e) => e.id)).toEqual(['x', 'y'])
  })
})

describe('selectEntries', () => {
  it('filters then sorts, in one pass over the working set', () => {
    const rows = [
      entry({ id: 'a', status: 'done', last_activity_at: '2026-07-28T12:00:00.000Z' }),
      entry({ id: 'b', last_activity_at: '2026-07-20T12:00:00.000Z' }),
      entry({ id: 'c', last_activity_at: '2026-07-27T12:00:00.000Z' }),
    ]
    expect(selectEntries(rows, EMPTY_FILTER, NO_HEALTH, CTX).map((e) => e.id)).toEqual(['c', 'b'])
  })
})

describe('countActiveFacets / isFilterEmpty', () => {
  it('the neutral filter counts zero', () => {
    expect(countActiveFacets(EMPTY_FILTER)).toBe(0)
    expect(isFilterEmpty(EMPTY_FILTER)).toBe(true)
  })

  it('counts FACETS, not values', () => {
    expect(countActiveFacets(filter({ priorities: ['high', 'critical', 'low'] }))).toBe(1)
  })

  it('treats a date range as one facet', () => {
    expect(countActiveFacets(filter({ from: '2026-07-01' }))).toBe(1)
    expect(countActiveFacets(filter({ from: '2026-07-01', to: '2026-07-31' }))).toBe(1)
  })

  it('does not count sort — ordering a list is not filtering it', () => {
    expect(countActiveFacets(filter({ sort: 'due' }))).toBe(0)
    expect(isFilterEmpty(filter({ sort: 'due' }))).toBe(true)
  })

  it('counts a non-default scope, and a whitespace search as nothing', () => {
    expect(countActiveFacets(filter({ scope: 'all' }))).toBe(1)
    expect(countActiveFacets(filter({ search: '   ' }))).toBe(0)
    expect(countActiveFacets(filter({ search: 'x' }))).toBe(1)
  })
})

describe('filterKey', () => {
  it('is insensitive to the order values were collected in', () => {
    expect(filterKey(filter({ statuses: ['blocked', 'new'] }))).toBe(
      filterKey(filter({ statuses: ['new', 'blocked'] })),
    )
    expect(filterKey(filter({ tags: ['b', 'a'] }))).toBe(filterKey(filter({ tags: ['a', 'b'] })))
  })

  it('changes when any facet changes, including sort', () => {
    const base = filterKey(EMPTY_FILTER)
    expect(filterKey(filter({ sort: 'due' }))).not.toBe(base)
    expect(filterKey(filter({ mine: true }))).not.toBe(base)
    expect(filterKey(filter({ owner: { kind: 'id', id: 'u2' } }))).not.toBe(base)
    expect(filterKey(filter({ from: '2026-07-01' }))).not.toBe(base)
  })

  it('folds the search term, so a stray capital does not invalidate a memo', () => {
    expect(filterKey(filter({ search: 'Network' }))).toBe(filterKey(filter({ search: 'network' })))
  })
})

describe('URL round-trip', () => {
  it('a neutral filter produces an empty query string', () => {
    expect(filterToParams(EMPTY_FILTER).toString()).toBe('')
    expect(filterFromParams(new URLSearchParams())).toEqual(EMPTY_FILTER)
  })

  it('round-trips every facet', () => {
    const f = filter({
      trackIds: ['tr1', 'tr2'],
      statuses: ['blocked', 'waiting_on'],
      priorities: ['critical'],
      types: ['issue'],
      owner: { kind: 'name', name: 'Ali Hassan' },
      tags: ['portal', 'q3,q4'],
      health: ['overdue', 'stale'],
      search: 'payment gateway',
      scope: 'all',
      mine: true,
      from: '2026-07-01',
      to: '2026-07-31',
      sort: 'due',
    })
    expect(filterFromParams(filterToParams(f))).toEqual(f)
  })

  it('round-trips each owner kind', () => {
    for (const owner of [
      { kind: 'me' },
      { kind: 'unassigned' },
      { kind: 'id', id: 'u2' },
      { kind: 'name', name: 'Vendor Ltd' },
    ] as const) {
      expect(filterFromParams(filterToParams(filter({ owner }))).owner).toEqual(owner)
    }
  })

  it('returns FRESH arrays, not EMPTY_FILTER’s own — Object.freeze is shallow', () => {
    const parsed = filterFromParams(new URLSearchParams())
    parsed.trackIds.push('tr9')
    expect(EMPTY_FILTER.trackIds).toEqual([])
  })

  it('drops values that are not in the frozen unions', () => {
    const p = new URLSearchParams('status=blocked,not_a_status&priority=urgent&health=green')
    const f = filterFromParams(p)
    expect(f.statuses).toEqual(['blocked'])
    expect(f.priorities).toEqual([])
    expect(f.health).toEqual([])
  })

  it('does not accept a prototype member as a frozen key', () => {
    // `in` would let `status=toString` through; Object.hasOwn does not.
    expect(filterFromParams(new URLSearchParams('status=toString')).statuses).toEqual([])
    expect(filterFromParams(new URLSearchParams('scope=constructor')).scope).toBe('open')
  })

  it('rejects a malformed date rather than silently shrinking the list', () => {
    // The `to=` value used to carry a trailing `x`, which the old shape test
    // rejected for the wrong reason — drop the `x` and `2026-13-99` sailed
    // through. These are the inputs that matter: right shape, impossible date.
    const f = filterFromParams(new URLSearchParams('from=yesterday&to=2026-13-99'))
    expect(f.from).toBeNull()
    expect(f.to).toBeNull()
  })

  it('rejects a date that has the right shape but does not exist', () => {
    // A bound nothing can equal empties every list, because matchesFilter
    // compares ISO strings and every real date sorts below "2026-13-99".
    for (const bad of ['2026-13-99', '2026-02-30', '2026-00-10', '2026-01-32', '0000-01-01x']) {
      const f = filterFromParams(new URLSearchParams(`from=${bad}`))
      expect(f.from, bad).toBeNull()
    }
  })

  it('still accepts a real date, whitespace and all', () => {
    // 2028 is a leap year and 2026 is not, which is exactly the distinction a
    // shape test cannot make and parseIsoDate's round-trip can.
    expect(filterFromParams(new URLSearchParams('from=2028-02-29')).from).toBe('2028-02-29')
    expect(filterFromParams(new URLSearchParams('from=2026-02-29')).from).toBeNull()
    expect(filterFromParams(new URLSearchParams('from=2026-07-29')).from).toBe('2026-07-29')
    expect(filterFromParams(new URLSearchParams('from= 2026-07-29 ')).from).toBe('2026-07-29')
  })

  it('keeps a comma inside a tag intact by repeating the param', () => {
    const params = filterToParams(filter({ tags: ['q3,q4'] }))
    expect(params.getAll('tag')).toEqual(['q3,q4'])
  })
})
