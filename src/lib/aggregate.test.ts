// Contract tests for the dashboard's arithmetic.
//
// No mocks and no clock: every function under test takes `today` and its inputs
// as arguments, which is the property lib/aggregate.ts was written to have.
//
// EVERY INSTANT IN THIS FILE IS T12:00:00Z, ON PURPOSE. `instantToIsoDate()`
// resolves an instant to the reader's LOCAL calendar day (see its header — "due
// today has to mean the user's today"), so a fixture written at T00:00:00Z
// lands on the previous day west of Greenwich and these assertions would pass
// in Riyadh and fail in CI. Noon is the only hour that is the same date in
// every zone this app will ever run in.

import { describe, expect, it } from 'vitest'
import {
  agingHistogram,
  loadPerOwner,
  oldestBlockers,
  openPerTrack,
  slaCompliance,
  throughput,
  throughputByWeek,
} from './aggregate'
import { buildTrackSlaMap } from './health'
import type { Entry, EntryHealth, EntryPriority, EntryStatus, EntryUpdate, HealthLevel } from '../types'

const TODAY = '2026-07-30'

function at(date: string): string {
  return `${date}T12:00:00.000Z`
}

function entry(over: Partial<Entry> & Pick<Entry, 'id'>): Entry {
  return {
    track_id: null,
    node_id: null,
    title: over.id,
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
    created_at: at('2026-07-01'),
    updated_at: at('2026-07-01'),
    closed_at: null,
    last_activity_at: at('2026-07-01'),
    meeting_id: null,
    template_id: null,
    ...over,
  }
}

function health(
  id: string,
  over: Partial<EntryHealth> = {},
): [string, EntryHealth] {
  return [
    id,
    {
      id,
      entry_id: id,
      track_id: null,
      status: 'new' as EntryStatus,
      priority: 'medium' as EntryPriority,
      due_date: null,
      last_activity_at: at('2026-07-01'),
      days_since_activity: 0,
      days_overdue: 0,
      health: 'ok' as HealthLevel,
      sla_due_at: null,
      sla_breached: false,
      ...over,
    },
  ]
}

const NO_HEALTH = new Map<string, EntryHealth>()
const NO_UPDATES = new Map<string, EntryUpdate[]>()

/* ───────────────────────────── openPerTrack ───────────────────────────── */

describe('openPerTrack', () => {
  const rows = [
    entry({ id: 'a', track_id: 't1' }),
    entry({ id: 'b', track_id: 't1' }),
    entry({ id: 'c', track_id: 't2' }),
    entry({ id: 'd', track_id: null }),
    entry({ id: 'e', track_id: null }),
    entry({ id: 'f', track_id: null }),
    // Closed rows are not open work and must not appear anywhere.
    entry({ id: 'g', track_id: 't1', status: 'done', closed_at: at('2026-07-20') }),
    entry({ id: 'h', track_id: 't2', status: 'cancelled', closed_at: at('2026-07-20') }),
  ]

  it('counts only open entries, biggest track first', () => {
    const out = openPerTrack(rows, NO_HEALTH)
    expect(out.map((r) => [r.trackId, r.count])).toEqual([
      ['t1', 2],
      ['t2', 1],
      [null, 3],
    ])
  })

  it('pins the untracked pile last however big it is', () => {
    // Three untracked beats both tracks on count and still comes last: it is a
    // gap in the data, not a track, and floating it into the middle of an
    // ordered chart makes the ranking unreadable.
    const out = openPerTrack(rows, NO_HEALTH)
    expect(out[out.length - 1].trackId).toBeNull()
  })

  it('splits each bar by health, summing to the bar', () => {
    const map = new Map([
      health('a', { health: 'overdue', days_overdue: 4 }),
      health('b', { health: 'stale' }),
    ])
    const t1 = openPerTrack(rows, map).find((r) => r.trackId === 't1')
    expect(t1?.byHealth).toEqual({ ok: 0, stale: 1, overdue: 1, critical: 0 })
    expect(t1?.count).toBe(2)
  })

  it('treats a row the view has not answered for as ok, not as a fifth band', () => {
    const t2 = openPerTrack(rows, NO_HEALTH).find((r) => r.trackId === 't2')
    expect(t2?.byHealth).toEqual({ ok: 1, stale: 0, overdue: 0, critical: 0 })
  })
})

/* ──────────────────────────── agingHistogram ──────────────────────────── */

describe('agingHistogram', () => {
  // One entry per bucket boundary, on both sides of every edge.
  const rows = [
    entry({ id: 'd0', created_at: at('2026-07-30') }), // 0 → 0-3
    entry({ id: 'd3', created_at: at('2026-07-27') }), // 3 → 0-3
    entry({ id: 'd4', created_at: at('2026-07-26') }), // 4 → 4-7
    entry({ id: 'd7', created_at: at('2026-07-23') }), // 7 → 4-7
    entry({ id: 'd8', created_at: at('2026-07-22') }), // 8 → 8-14
    entry({ id: 'd14', created_at: at('2026-07-16') }), // 14 → 8-14
    entry({ id: 'd15', created_at: at('2026-07-15') }), // 15 → 15+
  ]

  it('buckets by age since raised, on lib/dates edges', () => {
    expect(agingHistogram(rows, NO_HEALTH, TODAY, 'created')).toEqual({
      '0-3': 2,
      '4-7': 2,
      '8-14': 2,
      '15+': 1,
    })
  })

  it('prefers the view days_since_activity on the activity basis', () => {
    const one = [entry({ id: 'x', last_activity_at: at('2026-07-29') })]
    // The row is one day quiet locally; the view says twenty. The view wins,
    // exactly as store/entries.derive() prefers it, so the histogram column and
    // the age pill on the same row cannot disagree.
    const map = new Map([health('x', { days_since_activity: 20 })])
    expect(agingHistogram(one, map, TODAY, 'activity')['15+']).toBe(1)
    expect(agingHistogram(one, NO_HEALTH, TODAY, 'activity')['0-3']).toBe(1)
  })

  it('ignores closed entries', () => {
    const closed = [entry({ id: 'z', status: 'done', created_at: at('2026-01-01') })]
    expect(agingHistogram(closed, NO_HEALTH, TODAY)).toEqual({
      '0-3': 0,
      '4-7': 0,
      '8-14': 0,
      '15+': 0,
    })
  })
})

/* ───────────────────────────── throughput ─────────────────────────────── */

describe('throughput', () => {
  const rows = [
    entry({ id: 'a', created_at: at('2026-07-27') }),
    entry({ id: 'b', created_at: at('2026-07-27') }),
    entry({ id: 'c', created_at: at('2026-07-29'), status: 'done', closed_at: at('2026-07-29') }),
    // Raised before the window, closed inside it: counts as closed only.
    entry({ id: 'd', created_at: at('2026-06-01'), status: 'done', closed_at: at('2026-07-28') }),
    // Entirely outside the window.
    entry({ id: 'e', created_at: at('2026-05-01'), status: 'done', closed_at: at('2026-05-02') }),
  ]

  it('emits every day in the range, including the empty ones', () => {
    const out = throughput(rows, '2026-07-27', '2026-07-30')
    expect(out.map((p) => p.day)).toEqual(['2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30'])
  })

  it('counts creations and closures on their own clocks', () => {
    const out = throughput(rows, '2026-07-27', '2026-07-30')
    expect(out.map((p) => [p.created, p.closed])).toEqual([
      [2, 0],
      [0, 1],
      [1, 1],
      [0, 0],
    ])
  })

  it('drops anything outside the window entirely', () => {
    const out = throughput(rows, '2026-07-27', '2026-07-30')
    const total = out.reduce((sum, p) => sum + p.created + p.closed, 0)
    // Five entries, but 'e' is outside and 'd' contributes only its closure.
    expect(total).toBe(5)
  })

  it('returns nothing for an inverted range rather than looping', () => {
    expect(throughput(rows, '2026-07-30', '2026-07-01')).toEqual([])
  })
})

describe('throughputByWeek', () => {
  const rows = [
    entry({ id: 'a', created_at: at('2026-07-12') }), // week 1 (starts 07-12)
    entry({ id: 'b', created_at: at('2026-07-18') }), // week 1, last day
    entry({ id: 'c', created_at: at('2026-07-19') }), // week 2
    entry({ id: 'd', created_at: at('2026-07-26'), status: 'done', closed_at: at('2026-07-30') }),
  ]

  it('buckets in sevens, anchored on `from` and never re-aligned', () => {
    const out = throughputByWeek(rows, '2026-07-12', '2026-08-01')
    expect(out.map((p) => p.day)).toEqual(['2026-07-12', '2026-07-19', '2026-07-26'])
    expect(out.map((p) => p.created)).toEqual([2, 1, 1])
    expect(out.map((p) => p.closed)).toEqual([0, 0, 1])
  })
})

/* ──────────────────────────── loadPerOwner ────────────────────────────── */

describe('loadPerOwner', () => {
  const ctx = { meId: null, today: TODAY }
  const rows = [
    entry({ id: 'a', owner_id: 'u1' }),
    entry({ id: 'b', owner_id: 'u1' }),
    entry({ id: 'c', owner_id: 'u1' }),
    entry({ id: 'd', owner_name: 'Acme Ltd' }),
    entry({ id: 'e' }),
    entry({ id: 'f' }),
    entry({ id: 'g', owner_id: 'u1', status: 'done', closed_at: at('2026-07-20') }),
  ]

  it('groups by teammate, vendor and unassigned, heaviest first, gap last', () => {
    const out = loadPerOwner(rows, NO_HEALTH, ctx)
    expect(out.map((r) => [r.ownerKey, r.open])).toEqual([
      ['u1', 3],
      ['name:Acme Ltd', 1],
      ['', 2],
    ])
  })

  it('carries the two source columns so a caller can label the row', () => {
    const out = loadPerOwner(rows, NO_HEALTH, ctx)
    expect(out[1]).toMatchObject({ ownerId: null, ownerName: 'Acme Ltd' })
    expect(out[2]).toMatchObject({ ownerId: null, ownerName: null })
  })

  it('counts overdue and stale as subsets of open, from the health map', () => {
    const map = new Map([
      health('a', { health: 'overdue', days_overdue: 2 }),
      health('b', { health: 'stale' }),
    ])
    const u1 = loadPerOwner(rows, map, ctx)[0]
    expect(u1).toMatchObject({ open: 3, overdue: 1, stale: 1 })
  })
})

/* ──────────────────────────── oldestBlockers ──────────────────────────── */

describe('oldestBlockers', () => {
  const rows = [
    entry({ id: 'old', status: 'blocked', created_at: at('2026-07-01') }),
    entry({ id: 'newer', status: 'blocked', created_at: at('2026-07-25') }),
    entry({ id: 'waiting', status: 'waiting_on', created_at: at('2026-07-10') }),
    entry({ id: 'busy', status: 'in_progress', created_at: at('2026-01-01') }),
  ]

  it('takes blocked AND waiting_on, matching the follow-ups section', () => {
    const out = oldestBlockers(rows, NO_UPDATES, TODAY, 10)
    expect(out.map((b) => b.entry.id)).toEqual(['old', 'waiting', 'newer'])
  })

  it('measures from created_at when the thread is not loaded', () => {
    const out = oldestBlockers(rows, NO_UPDATES, TODAY, 1)
    expect(out[0]).toMatchObject({ days: 29 })
  })

  it('measures from the latest transition INTO the status when it is', () => {
    const updates = new Map<string, EntryUpdate[]>([
      [
        'old',
        [
          {
            id: 'u1',
            entry_id: 'old',
            author_id: null,
            body: '',
            status_from: 'in_progress',
            status_to: 'blocked',
            created_at: at('2026-07-28'),
          },
        ],
      ],
    ])
    expect(oldestBlockers(rows, updates, TODAY, 1)[0].entry.id).toBe('waiting')
  })

  it('returns nothing for a non-positive n', () => {
    expect(oldestBlockers(rows, NO_UPDATES, TODAY, 0)).toEqual([])
  })
})

/* ─────────────────────────── slaCompliance ────────────────────────────── */

describe('slaCompliance', () => {
  const window = { from: '2026-07-01', to: '2026-07-31' }
  const noDefault = (): number | null => null
  const sevenDays = (): number | null => 7

  it('is null, not zero, when nothing measurable resolved', () => {
    const out = slaCompliance([], { overrides: null, priorityDefault: sevenDays, ...window })
    expect(out).toMatchObject({ measured: 0, met: 0, rate: null })
  })

  it('measures against the PRIORITY default when no override exists', () => {
    const rows = [
      // Raised on the 1st, closed on the 5th: inside a 7-day window.
      entry({ id: 'met', status: 'done', created_at: at('2026-07-01'), closed_at: at('2026-07-05') }),
      // Raised on the 1st, closed on the 12th: past it.
      entry({ id: 'late', status: 'done', created_at: at('2026-07-01'), closed_at: at('2026-07-12') }),
    ]
    const out = slaCompliance(rows, { overrides: null, priorityDefault: sevenDays, ...window })
    expect(out).toMatchObject({ measured: 2, met: 1, breached: 1, rate: 0.5 })
  })

  it("prefers the track's override over the priority default (S3a)", () => {
    const rows = [
      entry({
        id: 'x',
        track_id: 't1',
        priority: 'high',
        status: 'done',
        created_at: at('2026-07-01'),
        closed_at: at('2026-07-05'),
      }),
    ]
    // The workspace promises 7 days and would call this met; the track promises
    // 2 and does not. Reading the default alone reports a commitment nobody
    // made — the whole point of the fix.
    const overrides = buildTrackSlaMap([{ track_id: 't1', priority: 'high', sla_days: 2 }])
    expect(
      slaCompliance(rows, { overrides, priorityDefault: sevenDays, ...window }),
    ).toMatchObject({ measured: 1, met: 0 })
    expect(
      slaCompliance(rows, { overrides: null, priorityDefault: sevenDays, ...window }),
    ).toMatchObject({ measured: 1, met: 1 })
  })

  it('applies an override only to its own priority', () => {
    const rows = [
      entry({
        id: 'x',
        track_id: 't1',
        priority: 'low',
        status: 'done',
        created_at: at('2026-07-01'),
        closed_at: at('2026-07-05'),
      }),
    ]
    const overrides = buildTrackSlaMap([{ track_id: 't1', priority: 'high', sla_days: 2 }])
    expect(
      slaCompliance(rows, { overrides, priorityDefault: sevenDays, ...window }),
    ).toMatchObject({ met: 1 })
  })

  it('counts landing exactly on the deadline as MET', () => {
    // The view's breach test is `now() > sla_due_at`, strictly — so the instant
    // the deadline names is still inside the commitment.
    const rows = [
      entry({
        id: 'edge',
        status: 'done',
        created_at: at('2026-07-01'),
        closed_at: at('2026-07-08'),
      }),
    ]
    expect(
      slaCompliance(rows, { overrides: null, priorityDefault: sevenDays, ...window }),
    ).toMatchObject({ measured: 1, met: 1 })
  })

  it('reports resolved work with no SLA as unmeasured, never as compliant', () => {
    const rows = [
      entry({ id: 'a', status: 'done', created_at: at('2026-07-01'), closed_at: at('2026-07-02') }),
    ]
    expect(slaCompliance(rows, { overrides: null, priorityDefault: noDefault, ...window })).toMatchObject({
      measured: 0,
      unmeasured: 1,
      rate: null,
    })
  })

  it('ignores cancelled work in both directions', () => {
    const rows = [
      entry({
        id: 'killed',
        status: 'cancelled',
        created_at: at('2026-07-01'),
        closed_at: at('2026-07-02'),
      }),
    ]
    expect(slaCompliance(rows, { overrides: null, priorityDefault: sevenDays, ...window })).toMatchObject({
      measured: 0,
      unmeasured: 0,
    })
  })

  it('ignores open work, however long it has been open', () => {
    const rows = [entry({ id: 'open', created_at: at('2026-01-01') })]
    expect(slaCompliance(rows, { overrides: null, priorityDefault: sevenDays, ...window })).toMatchObject({
      measured: 0,
    })
  })

  it('honours the window on closed_at', () => {
    const rows = [
      entry({ id: 'before', status: 'done', created_at: at('2026-05-01'), closed_at: at('2026-06-30') }),
      entry({ id: 'after', status: 'done', created_at: at('2026-07-30'), closed_at: at('2026-08-01') }),
      entry({ id: 'inside', status: 'done', created_at: at('2026-07-29'), closed_at: at('2026-07-31') }),
    ]
    const out = slaCompliance(rows, { overrides: null, priorityDefault: sevenDays, ...window })
    expect(out.measured).toBe(1)
  })

  it('breaks down by priority in severity order', () => {
    const rows = [
      entry({ id: 'lo', priority: 'low', status: 'done', created_at: at('2026-07-01'), closed_at: at('2026-07-02') }),
      entry({ id: 'cr', priority: 'critical', status: 'done', created_at: at('2026-07-01'), closed_at: at('2026-07-02') }),
      entry({ id: 'hi', priority: 'high', status: 'done', created_at: at('2026-07-01'), closed_at: at('2026-07-20') }),
    ]
    const out = slaCompliance(rows, { overrides: null, priorityDefault: sevenDays, ...window })
    expect(out.byPriority.map((r) => r.priority)).toEqual(['critical', 'high', 'low'])
    expect(out.byPriority.map((r) => [r.met, r.measured])).toEqual([
      [1, 1],
      [0, 1],
      [1, 1],
    ])
  })
})
