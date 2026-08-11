import { describe, expect, it } from 'vitest'
import {
  buildTrackSlaMap,
  CLOSED_STATUSES,
  computeHealth,
  isOpen,
  resolveSlaDays,
  trackSlaKey,
  type TrackSlaRule,
} from './health'
import type { Entry } from '../types'

// PARITY WITH v_entry_health IS WHAT THIS FILE ASSERTS. Every case below is the
// client-side answer to a question 0001/0003 already answered in SQL; where the
// two could drift, the view wins and this file is the bug.
//
// TWO CONVENTIONS THAT MAKE THESE ASSERTIONS STABLE.
//
// 1. `now` is always injected. Nothing here reads the wall clock, so a suite run
//    at 23:59 asserts the same thing as one run at noon.
// 2. Every instant is anchored at 12:00 UTC. lib/health maps instants onto the
//    LOCAL calendar (deliberately — "due today" has to mean the user's today),
//    so a midnight-anchored fixture would land on a different date in Riyadh
//    than in CI and the day counts would move under the test. Midday is far
//    enough from both edges that every real offset maps it to the same date.
//
// The LIVE comparison in the Wave-1 gate tolerates ±1 day on
// days_since_activity for exactly the reason (2) works around here: the view
// counts against the server's UTC current_date. That tolerance is a property of
// the live check, not of these fixtures — these are exact.

const NOW = new Date('2026-07-29T12:00:00.000Z')

function entry(partial: Partial<Entry> = {}): Entry {
  return {
    id: 'e1',
    track_id: 'tr1',
    node_id: null,
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

describe('isOpen / CLOSED_STATUSES', () => {
  it('excludes exactly the two statuses the view excludes', () => {
    expect([...CLOSED_STATUSES]).toEqual(['done', 'cancelled'])
    expect(isOpen('done')).toBe(false)
    expect(isOpen('cancelled')).toBe(false)
    for (const s of ['new', 'in_progress', 'blocked', 'waiting_on'] as const) {
      expect(isOpen(s)).toBe(true)
    }
  })
})

describe('staleness — the threshold boundary', () => {
  it('a 4-day-old high is stale at EXACTLY the threshold', () => {
    // The view's operator is `>=`, so the day the threshold is reached is the
    // day the pill turns. An off-by-one here makes the client and the server
    // disagree on the busiest section of the busiest screen.
    const h = computeHealth(
      entry({ last_activity_at: '2026-07-25T12:00:00.000Z' }),
      4,
      null,
      NOW,
    )
    expect(h.days_since_activity).toBe(4)
    expect(h.health).toBe('stale')
  })

  it('is still ok one day short of the threshold', () => {
    const h = computeHealth(
      entry({ last_activity_at: '2026-07-26T12:00:00.000Z' }),
      4,
      null,
      NOW,
    )
    expect(h.days_since_activity).toBe(3)
    expect(h.health).toBe('ok')
  })

  it('honours an admin-lowered threshold, which is what makes vocab_options load-bearing', () => {
    const e = entry({ last_activity_at: '2026-07-27T12:00:00.000Z' })
    expect(computeHealth(e, 2, null, NOW).health).toBe('stale')
    expect(computeHealth(e, 8, null, NOW).health).toBe('ok')
  })

  it('clamps a future last_activity_at to zero rather than reporting a negative age', () => {
    const h = computeHealth(entry({ last_activity_at: '2026-08-05T12:00:00.000Z' }), 4, null, NOW)
    expect(h.days_since_activity).toBe(0)
    expect(h.health).toBe('ok')
  })
})

describe('overdue — and its precedence over stale', () => {
  it('counts whole days past the due date', () => {
    const h = computeHealth(entry({ due_date: '2026-07-20' }), 4, null, NOW)
    expect(h.days_overdue).toBe(9)
    expect(h.health).toBe('overdue')
  })

  it('due TODAY is not overdue', () => {
    const h = computeHealth(entry({ due_date: '2026-07-29' }), 4, null, NOW)
    expect(h.days_overdue).toBe(0)
    expect(h.health).toBe('ok')
  })

  it('overdue outranks stale', () => {
    const h = computeHealth(
      entry({ due_date: '2026-07-20', last_activity_at: '2026-07-10T12:00:00.000Z' }),
      4,
      null,
      NOW,
    )
    expect(h.days_since_activity).toBe(19)
    expect(h.health).toBe('overdue')
  })

  it('critical is overdue AND priority critical, not a fifth threshold', () => {
    const overdueCritical = computeHealth(
      entry({ priority: 'critical', due_date: '2026-07-20' }),
      2,
      null,
      NOW,
    )
    expect(overdueCritical.health).toBe('critical')

    // Critical priority, silent for a week, but not past a due date: STALE.
    const staleCritical = computeHealth(
      entry({ priority: 'critical', last_activity_at: '2026-07-22T12:00:00.000Z' }),
      2,
      null,
      NOW,
    )
    expect(staleCritical.health).toBe('stale')
  })

  it('no due date is never overdue', () => {
    const h = computeHealth(entry({ due_date: null }), 4, null, NOW)
    expect(h.days_overdue).toBe(0)
  })
})

describe('SLA — the created_at + sla_days boundary', () => {
  const created = '2026-07-26T12:00:00.000Z'

  it('is OFF when the admin has not set a value: null deadline, never breached', () => {
    const h = computeHealth(entry({ created_at: '2026-01-01T12:00:00.000Z' }), 4, null, NOW)
    expect(h.sla_due_at).toBeNull()
    expect(h.sla_breached).toBe(false)
  })

  it('computes the deadline as created_at + sla_days', () => {
    const h = computeHealth(entry({ created_at: created }), 4, 3, NOW)
    expect(h.sla_due_at).toBe('2026-07-29T12:00:00.000Z')
  })

  it('is NOT breached at exactly created_at + sla_days', () => {
    // The view says `now() > sla_due_at`, strictly. At the deadline the
    // commitment has been met — an inclusive comparison here would report a
    // breach on work delivered exactly on time, in a compliance number someone
    // has already forwarded.
    const h = computeHealth(entry({ created_at: created }), 4, 3, new Date(Date.parse(created) + 3 * 86_400_000))
    expect(h.sla_due_at).toBe('2026-07-29T12:00:00.000Z')
    expect(h.sla_breached).toBe(false)
  })

  it('is breached one millisecond later', () => {
    const h = computeHealth(
      entry({ created_at: created }),
      4,
      3,
      new Date(Date.parse(created) + 3 * 86_400_000 + 1),
    )
    expect(h.sla_breached).toBe(true)
  })

  it('is independent of staleness — the two measure different clocks', () => {
    // Updated this very minute (never stale), created five weeks ago (breached).
    const h = computeHealth(
      entry({ created_at: '2026-06-24T12:00:00.000Z', last_activity_at: '2026-07-29T12:00:00.000Z' }),
      4,
      7,
      NOW,
    )
    expect(h.health).toBe('ok')
    expect(h.days_since_activity).toBe(0)
    expect(h.sla_breached).toBe(true)
  })

  it('survives a malformed created_at with a null deadline instead of a throw', () => {
    const h = computeHealth(entry({ created_at: 'not-a-timestamp' }), 4, 3, NOW)
    expect(h.sla_due_at).toBeNull()
    expect(h.sla_breached).toBe(false)
  })
})

// PARITY WITH `coalesce(ts.sla_days, vp.sla_days)` in 0006's v_entry_health.
//
// The fixtures below are the SAME matrix the live probe ran against the project
// inside a rolled-back transaction when 0006 was applied: priority default
// critical = 7; track A overrides critical to 1 and low to 3650; track B
// overrides critical to 3650; track C overrides nothing. The live view reported
// 5 of 14 open rows breached under that matrix and 2 of 14 once the priority
// default was cleared — the two assertions at the bottom of this block are those
// same two counts, re-derived here row by row. If the view and this file ever
// disagree, the view wins and this file is the bug.
describe('resolveSlaDays — the track × priority matrix', () => {
  const TRACK_A = 'aaaaaaaa-0000-4000-8000-000000000001'
  const TRACK_B = 'bbbbbbbb-0000-4000-8000-000000000002'
  const TRACK_C = 'cccccccc-0000-4000-8000-000000000003'

  const RULES: TrackSlaRule[] = [
    { track_id: TRACK_A, priority: 'critical', sla_days: 1 },
    { track_id: TRACK_A, priority: 'low', sla_days: 3650 },
    { track_id: TRACK_B, priority: 'critical', sla_days: 3650 },
  ]
  const MATRIX = buildTrackSlaMap(RULES)

  it('keys the matrix on the pair, matching the table primary key', () => {
    expect(trackSlaKey(TRACK_A, 'critical')).toBe(`${TRACK_A}:critical`)
    expect(MATRIX.size).toBe(3)
    expect(MATRIX.get(trackSlaKey(TRACK_A, 'low'))).toBe(3650)
  })

  it('prefers the track override over the priority default', () => {
    expect(resolveSlaDays(TRACK_A, 'critical', MATRIX, 7)).toBe(1)
    expect(resolveSlaDays(TRACK_B, 'critical', MATRIX, 7)).toBe(3650)
  })

  it('falls back to the priority default where the track has no row', () => {
    expect(resolveSlaDays(TRACK_C, 'critical', MATRIX, 7)).toBe(7)
    // Same track, a priority it did not override.
    expect(resolveSlaDays(TRACK_B, 'low', MATRIX, null)).toBeNull()
  })

  it('falls through to null when neither level carries a number', () => {
    expect(resolveSlaDays(TRACK_C, 'low', MATRIX, null)).toBeNull()
    expect(resolveSlaDays(TRACK_C, 'high', new Map(), null)).toBeNull()
  })

  it('treats a null track_id as no override, exactly like the view left join', () => {
    // entries.track_id is `on delete set null`, so this is a real row shape and
    // not a defensive one. It must inherit, never disappear.
    expect(resolveSlaDays(null, 'critical', MATRIX, 7)).toBe(7)
    expect(resolveSlaDays(null, 'critical', MATRIX, null)).toBeNull()
  })

  it('treats a not-yet-loaded matrix as no override rather than as no SLA', () => {
    // The safe direction: show the workspace default for a beat and re-render,
    // rather than invent a breach or hide a real one.
    expect(resolveSlaDays(TRACK_A, 'critical', null, 7)).toBe(7)
    expect(resolveSlaDays(TRACK_A, 'critical', undefined, 7)).toBe(7)
  })

  it('does not read a zero override as absent', () => {
    // `?? ` not `||`. The DB CHECK forbids 0, so this can only arrive from a
    // hand-written map — but `||` here would silently promote it to the default
    // and the bug would look like the override "not taking effect".
    const zero = new Map([[trackSlaKey(TRACK_A, 'high'), 0]])
    expect(resolveSlaDays(TRACK_A, 'high', zero, 7)).toBe(0)
  })

  it('reproduces the live probe: 5 of 14 open rows breached under the matrix', () => {
    // Every entry created 30 days before NOW, so a resolved SLA of 1 or 7
    // breaches and 3650 does not.
    const created = '2026-06-29T12:00:00.000Z'
    const rows: { track: string | null; priority: 'critical' | 'low' }[] = [
      ...([TRACK_A, TRACK_B, TRACK_C] as const).flatMap((track) => [
        { track, priority: 'critical' as const },
        { track, priority: 'critical' as const },
        { track, priority: 'low' as const },
        { track, priority: 'low' as const },
      ]),
      { track: null, priority: 'critical' },
      { track: null, priority: 'low' },
    ]
    expect(rows).toHaveLength(14)

    const breachedWith = (defaults: { critical: number | null; low: number | null }): number =>
      rows.filter((r) => {
        const resolved = resolveSlaDays(r.track, r.priority, MATRIX, defaults[r.priority])
        return computeHealth(entry({ created_at: created, priority: r.priority }), 4, resolved, NOW)
          .sla_breached
      }).length

    // Priority default critical = 7: A's two criticals (1 day) and C's two
    // (inherited 7) and the trackless critical (7) breach; B's are at 3650.
    expect(breachedWith({ critical: 7, low: null })).toBe(5)
    // Default cleared: only A's two criticals still have a number to miss.
    expect(breachedWith({ critical: null, low: null })).toBe(2)
  })
})

describe('closed entries — the rows the view does not have', () => {
  it('collapse to the calm shape rather than shouting on a follow-ups list', () => {
    const h = computeHealth(
      entry({
        status: 'done',
        due_date: '2026-07-01',
        created_at: '2026-01-01T12:00:00.000Z',
        last_activity_at: '2026-07-01T12:00:00.000Z',
      }),
      4,
      3,
      NOW,
    )
    expect(h.health).toBe('ok')
    expect(h.days_overdue).toBe(0)
    expect(h.sla_breached).toBe(false)
    // The facts that stay true survive: its age, and the deadline that existed.
    expect(h.days_since_activity).toBe(28)
    expect(h.sla_due_at).toBe('2026-01-04T12:00:00.000Z')
  })

  it('treats cancelled the same as done', () => {
    const h = computeHealth(entry({ status: 'cancelled', due_date: '2026-07-01' }), 4, null, NOW)
    expect(h.health).toBe('ok')
  })
})

describe('the row shape', () => {
  it('exposes the entry id under both names and passes the join columns through', () => {
    const e = entry({ id: 'abc', track_id: null, due_date: '2026-08-01', priority: 'low' })
    const h = computeHealth(e, 15, null, NOW)
    expect(h.id).toBe('abc')
    expect(h.entry_id).toBe('abc')
    expect(h.track_id).toBeNull()
    expect(h.status).toBe(e.status)
    expect(h.priority).toBe('low')
    expect(h.due_date).toBe('2026-08-01')
    expect(h.last_activity_at).toBe(e.last_activity_at)
  })
})
