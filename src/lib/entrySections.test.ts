import { describe, expect, it } from 'vitest'
import { DUE_SOON_DAYS, bucketFollowUps, daysInStatus, type SectionContext } from './entrySections'
import type { Entry, EntryHealth, EntryPriority, EntryUpdate } from '../types'

const TODAY = '2026-07-29'

/** The thresholds v_entry_health coalesces over, so the fallback path is realistic. */
const STALE: Readonly<Record<EntryPriority, number>> = {
  critical: 2,
  high: 4,
  medium: 8,
  low: 15,
}

const CTX: SectionContext = { meId: 'me', today: TODAY, staleDays: (p) => STALE[p] }

function entry(partial: Partial<Entry> & Pick<Entry, 'id'>): Entry {
  return {
    track_id: 'tr1',
    node_id: null,
    title: 'Migrate the payment gateway',
    description: '',
    type: 'action',
    status: 'in_progress',
    priority: 'high',
    owner_id: 'u2',
    owner_name: null,
    requester: null,
    due_date: null,
    follow_up_date: null,
    tags: [],
    links: [],
    created_by: 'me',
    created_at: '2026-07-01T12:00:00.000Z',
    updated_at: '2026-07-29T12:00:00.000Z',
    closed_at: null,
    last_activity_at: '2026-07-29T12:00:00.000Z',
    meeting_id: null,
    template_id: null,
    ...partial,
  }
}

function health(id: string, partial: Partial<EntryHealth> = {}): EntryHealth {
  return {
    id,
    entry_id: id,
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

function healthMap(...rows: EntryHealth[]): ReadonlyMap<string, EntryHealth> {
  return new Map(rows.map((r) => [r.id, r]))
}

const NO_HEALTH = new Map<string, EntryHealth>()

function total(s: ReturnType<typeof bucketFollowUps>): number {
  return (
    s.overdue.length +
    s.slaBreach.length +
    s.dueSoon.length +
    s.stale.length +
    s.blocked.length +
    s.unassigned.length
  )
}

describe('bucketFollowUps — the single-section rule', () => {
  it('puts an entry in at most one section, in the frozen order', () => {
    // Every one of these qualifies for several sections at once; each must land
    // in the highest it qualifies for, or the totals stop adding up and the
    // first thing anyone does with this screen is add the numbers.
    const rows = [
      entry({ id: 'overdue', due_date: '2026-07-01', status: 'blocked', owner_id: null }),
      entry({ id: 'sla', status: 'blocked', owner_id: null }),
      entry({ id: 'soon', due_date: '2026-07-31', status: 'blocked', owner_id: null }),
      entry({
        id: 'stale',
        status: 'blocked',
        owner_id: null,
        last_activity_at: '2026-07-01T12:00:00.000Z',
      }),
      entry({ id: 'blocked', status: 'blocked', owner_id: null }),
      entry({ id: 'unowned', owner_id: null, owner_name: null }),
      entry({ id: 'calm' }),
    ]
    const h = healthMap(
      health('overdue', { days_overdue: 28, health: 'overdue' }),
      health('sla', { sla_breached: true, sla_due_at: '2026-07-20T12:00:00.000Z' }),
      health('soon'),
      health('stale', { health: 'stale', days_since_activity: 28 }),
      health('blocked'),
      health('unowned'),
      health('calm'),
    )
    const s = bucketFollowUps(rows, h, CTX)

    expect(s.overdue.map((e) => e.id)).toEqual(['overdue'])
    expect(s.slaBreach.map((e) => e.id)).toEqual(['sla'])
    expect(s.dueSoon.map((e) => e.id)).toEqual(['soon'])
    expect(s.stale.map((e) => e.id)).toEqual(['stale'])
    expect(s.blocked.map((e) => e.id)).toEqual(['blocked'])
    expect(s.unassigned.map((e) => e.id)).toEqual(['unowned'])
    // 'calm' qualifies for nothing and is in no section.
    expect(total(s)).toBe(6)
  })

  it('orders slaBreach immediately after overdue, ahead of dueSoon', () => {
    // A breach and a due date can coexist: the commitment already missed wins
    // over the one that can still be kept.
    const e = entry({ id: 'x', due_date: '2026-07-31' })
    const s = bucketFollowUps([e], healthMap(health('x', { sla_breached: true })), CTX)
    expect(s.slaBreach.map((r) => r.id)).toEqual(['x'])
    expect(s.dueSoon).toEqual([])
  })
})

describe('overdue', () => {
  it('trusts the view when it has a row', () => {
    const s = bucketFollowUps(
      [entry({ id: 'x' })],
      healthMap(health('x', { days_overdue: 3, health: 'overdue' })),
      CTX,
    )
    expect(s.overdue.map((e) => e.id)).toEqual(['x'])
  })

  it('falls back to the local date for an optimistic row that has no view row yet', () => {
    // Capture writes a temp-id row; it has to land in the right section the
    // instant it is typed, not when the server answers.
    const s = bucketFollowUps([entry({ id: 'temp', due_date: '2026-07-20' })], NO_HEALTH, CTX)
    expect(s.overdue.map((e) => e.id)).toEqual(['temp'])
  })

  it('counts a LAPSED follow-up date as overdue — the view cannot see that column', () => {
    const s = bucketFollowUps(
      [entry({ id: 'snoozed', follow_up_date: '2026-07-28' })],
      healthMap(health('snoozed')),
      CTX,
    )
    expect(s.overdue.map((e) => e.id)).toEqual(['snoozed'])
  })

  it('does not treat today as past', () => {
    const s = bucketFollowUps([entry({ id: 'x', due_date: TODAY })], healthMap(health('x')), CTX)
    expect(s.overdue).toEqual([])
    expect(s.dueSoon.map((e) => e.id)).toEqual(['x'])
  })
})

describe('dueSoon', () => {
  it('reaches exactly DUE_SOON_DAYS ahead, inclusive', () => {
    const inside = entry({ id: 'in', due_date: '2026-08-05' }) // today + 7
    const outside = entry({ id: 'out', due_date: '2026-08-06' }) // today + 8
    expect(DUE_SOON_DAYS).toBe(7)
    const s = bucketFollowUps([inside, outside], healthMap(health('in'), health('out')), CTX)
    expect(s.dueSoon.map((e) => e.id)).toEqual(['in'])
    expect(total(s)).toBe(1)
  })

  it('a pending follow-up date pulls an entry in as readily as a due date', () => {
    const s = bucketFollowUps(
      [entry({ id: 'x', follow_up_date: '2026-08-01' })],
      healthMap(health('x')),
      CTX,
    )
    expect(s.dueSoon.map((e) => e.id)).toEqual(['x'])
  })
})

describe('stale', () => {
  it('trusts the view’s level', () => {
    const s = bucketFollowUps(
      [entry({ id: 'x' })],
      healthMap(health('x', { health: 'stale', days_since_activity: 9 })),
      CTX,
    )
    expect(s.stale.map((e) => e.id)).toEqual(['x'])
  })

  it('falls back to ctx.staleDays, so an admin’s edited threshold still reaches it', () => {
    const e = entry({ id: 'x', priority: 'critical', last_activity_at: '2026-07-27T12:00:00.000Z' })
    expect(bucketFollowUps([e], NO_HEALTH, CTX).stale.map((r) => r.id)).toEqual(['x'])

    const lenient: SectionContext = { ...CTX, staleDays: () => 30 }
    expect(bucketFollowUps([e], NO_HEALTH, lenient).stale).toEqual([])
  })
})

describe('blocked and unassigned', () => {
  it('files waiting_on with blocked — both mean someone else owes us something', () => {
    const rows = [entry({ id: 'b', status: 'blocked' }), entry({ id: 'w', status: 'waiting_on' })]
    const s = bucketFollowUps(rows, healthMap(health('b'), health('w')), CTX)
    expect(s.blocked.map((e) => e.id)).toEqual(['b', 'w'])
  })

  it('counts free-text ownership as ownership', () => {
    const rows = [
      entry({ id: 'vendor', owner_id: null, owner_name: 'Acme Ltd' }),
      entry({ id: 'blank', owner_id: null, owner_name: '   ' }),
    ]
    const s = bucketFollowUps(rows, healthMap(health('vendor'), health('blank')), CTX)
    expect(s.unassigned.map((e) => e.id)).toEqual(['blank'])
  })
})

describe('closed entries', () => {
  it('are never bucketed, however overdue they were', () => {
    const rows = [
      entry({ id: 'd', status: 'done', due_date: '2026-01-01', owner_id: null }),
      entry({ id: 'c', status: 'cancelled', due_date: '2026-01-01', owner_id: null }),
    ]
    expect(total(bucketFollowUps(rows, NO_HEALTH, CTX))).toBe(0)
  })
})

describe('ordering and purity', () => {
  it('preserves input order inside a bucket — sorting is the caller’s business', () => {
    const rows = [
      entry({ id: 'b', due_date: '2026-07-02' }),
      entry({ id: 'a', due_date: '2026-07-01' }),
    ]
    expect(bucketFollowUps(rows, NO_HEALTH, CTX).overdue.map((e) => e.id)).toEqual(['b', 'a'])
  })

  it('returns all six sections even when nothing lands in them', () => {
    const s = bucketFollowUps([], NO_HEALTH, CTX)
    expect(Object.keys(s)).toEqual([
      'overdue',
      'slaBreach',
      'dueSoon',
      'stale',
      'blocked',
      'unassigned',
    ])
  })
})

describe('daysInStatus', () => {
  function update(partial: Partial<EntryUpdate> & Pick<EntryUpdate, 'id' | 'created_at'>): EntryUpdate {
    return {
      entry_id: 'x',
      author_id: null,
      body: '',
      status_from: null,
      status_to: null,
      ...partial,
    }
  }

  it('falls back to created_at when the thread is not loaded', () => {
    const e = entry({ id: 'x', created_at: '2026-07-19T12:00:00.000Z' })
    expect(daysInStatus(e, undefined, TODAY)).toBe(10)
  })

  it('does NOT use last_activity_at — a daily comment is not a status change', () => {
    const e = entry({
      id: 'x',
      created_at: '2026-06-29T12:00:00.000Z',
      last_activity_at: '2026-07-29T12:00:00.000Z',
    })
    expect(daysInStatus(e, [], TODAY)).toBe(30)
  })

  it('measures from the LATEST transition into the current status', () => {
    // blocked → in_progress → blocked: it has been blocked since the third move,
    // not since the first.
    const e = entry({ id: 'x', status: 'blocked', created_at: '2026-06-01T12:00:00.000Z' })
    const updates = [
      update({ id: 'u1', created_at: '2026-06-02T12:00:00.000Z', status_to: 'blocked' }),
      update({ id: 'u2', created_at: '2026-07-10T12:00:00.000Z', status_to: 'in_progress' }),
      update({ id: 'u3', created_at: '2026-07-24T12:00:00.000Z', status_to: 'blocked' }),
    ]
    expect(daysInStatus(e, updates, TODAY)).toBe(5)
  })

  it('ignores rows that are not transitions into the current status', () => {
    const e = entry({ id: 'x', status: 'blocked', created_at: '2026-07-19T12:00:00.000Z' })
    const updates = [
      update({ id: 'u1', created_at: '2026-07-28T12:00:00.000Z', body: 'chased the vendor' }),
      update({ id: 'u2', created_at: '2026-07-27T12:00:00.000Z', status_to: 'waiting_on' }),
    ]
    expect(daysInStatus(e, updates, TODAY)).toBe(10)
  })

  it('is order-independent — the thread may arrive unsorted', () => {
    const e = entry({ id: 'x', status: 'blocked', created_at: '2026-06-01T12:00:00.000Z' })
    const updates = [
      update({ id: 'u3', created_at: '2026-07-24T12:00:00.000Z', status_to: 'blocked' }),
      update({ id: 'u1', created_at: '2026-06-02T12:00:00.000Z', status_to: 'blocked' }),
    ]
    expect(daysInStatus(e, updates, TODAY)).toBe(5)
  })

  it('never returns a negative number', () => {
    const e = entry({ id: 'x', created_at: '2026-08-10T12:00:00.000Z' })
    expect(daysInStatus(e, undefined, TODAY)).toBe(0)
  })
})
