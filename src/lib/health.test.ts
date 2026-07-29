import { describe, expect, it } from 'vitest'
import { CLOSED_STATUSES, computeHealth, isOpen } from './health'
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
