// The stalled arithmetic, at a fixed instant.
//
// EVERY CASE HERE PASSES `now` EXPLICITLY, which is the property the module was
// written for: "is Riyadh General stalled?" is a question about a date and a
// number, and a module that read the wall clock could only be tested on a machine
// whose clock happened to be in the right week. lib/dates.test.ts does the same
// with the same argument.
//
// THE FOUR SILENCES ARE THE POINT. Three of the four ways `isAtRisk` answers
// false are states somebody chose — the admin set no threshold, the rung is
// terminal, the rung is paused — and each of them is a decision this file is the
// only executable record of. Deleting any one of the four guards makes a case
// below fail loudly rather than turning three account managers into people who
// ignore an alert.

import { describe, expect, it } from 'vitest'
import { daysInStage, isAtRisk, resolveStallDays } from './lifecycle'
import type { MapNodeStage } from '../types'

/** A rung, with only the columns this module reads carrying meaning. */
function stage(over: Partial<MapNodeStage> = {}): MapNodeStage {
  return {
    id: 'stage-1',
    name: 'Integrating',
    name_ar: '',
    sort_order: 3,
    hidden: false,
    terminal: false,
    paused: false,
    expected_days: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    created_by: null,
    ...over,
  }
}

const RUNNING = { terminal: false, paused: false }

describe('resolveStallDays', () => {
  it('takes the rung’s own expectation when it has one', () => {
    expect(resolveStallDays(stage({ expected_days: 45 }))).toBe(45)
  })

  it('answers null for the state 0026 ships in', () => {
    // The seed sets expected_days on NO row, deliberately: a threshold nobody
    // chose is a number the app would then chase people with. Null here is what
    // makes the whole Stalled lens dark until Aziz types a number.
    expect(resolveStallDays(stage())).toBeNull()
  })

  it('answers null for a node with no stage at all', () => {
    expect(resolveStallDays(null)).toBeNull()
    expect(resolveStallDays(undefined)).toBeNull()
  })

  it('uses the fallback only where the rung is silent', () => {
    expect(resolveStallDays(stage(), 90)).toBe(90)
    expect(resolveStallDays(null, 90)).toBe(90)
    // A stated expectation OUTRANKS a workspace-wide default. The other way round
    // would make a screen-level policy quietly overrule the admin's own number,
    // which is the failure the parameter exists to avoid.
    expect(resolveStallDays(stage({ expected_days: 14 }), 90)).toBe(14)
  })

  it('does not treat 0 as absent', () => {
    // `??`, not `||`. The database bound is 1..3650 so a 0 cannot be stored, but
    // a truthiness fallback here would ALSO swallow a legitimate 0 arriving from
    // a fixture or a future relaxation — and it would do it silently, by
    // substituting the caller's default for the row's own answer.
    expect(resolveStallDays(stage({ expected_days: 0 }), 90)).toBe(0)
  })
})

describe('daysInStage', () => {
  // LOCAL time on both sides, deliberately. `daysSince` counts CALENDAR days in
  // the reader's own zone — a `timestamptz` sliced in UTC would report an
  // activity at 02:00 Riyadh as yesterday — so a fixture written as `…Z` would
  // pass or fail depending on the machine's TZ, which is the one thing a suite
  // about a clock must not do.
  const at = (y: number, m: number, d: number, h: number, min = 0): string =>
    new Date(y, m - 1, d, h, min).toISOString()
  const now = new Date(2026, 7, 13, 9, 0)

  it('counts whole calendar days since the stamp', () => {
    expect(daysInStage(at(2026, 8, 3, 9), now)).toBe(10)
  })

  it('counts the day boundary, not the elapsed 24 hours', () => {
    // A stage change at 23:50 last night reads as one day this morning — ten
    // minutes elapsed, one calendar day — which is what a person means by "since
    // yesterday". `daysSince`'s contract, and the reason this module does not do
    // its own subtraction.
    expect(daysInStage(at(2026, 8, 12, 23, 50), now)).toBe(1)
  })

  it('is 0 for a node that arrived today', () => {
    expect(daysInStage(at(2026, 8, 13, 8), now)).toBe(0)
  })

  it('answers null when nothing has been recorded', () => {
    // NULL AND ZERO ARE DIFFERENT ANSWERS. Null is "no stage_changed_at" — no
    // progress row, or a row whose stage was cleared. Zero is "arrived today". A
    // column that rendered both as "0 days" would report 400 un-started
    // organizations as having just been moved.
    expect(daysInStage(null, now)).toBeNull()
    expect(daysInStage('', now)).toBeNull()
  })

  it('clamps a future stamp at 0 rather than reporting negative days', () => {
    // Only reachable through clock skew — the stamp is server-side `now()` and no
    // client can write the column — and "-2 days in stage" on a panel is how a
    // working feature gets reported as broken.
    expect(daysInStage(at(2026, 8, 15, 9), now)).toBe(0)
  })
})

describe('isAtRisk', () => {
  it('is true only past the expectation, not on it', () => {
    // `expected_days` is how long a node is EXPECTED to sit on the rung, so day
    // 30 of a 30-day rung is on time and day 31 is not. The other reading would
    // report every organization as breaching on the day it met the target.
    expect(isAtRisk(29, 30, RUNNING)).toBe(false)
    expect(isAtRisk(30, 30, RUNNING)).toBe(false)
    expect(isAtRisk(31, 30, RUNNING)).toBe(true)
  })

  it('is false when the admin has set no threshold', () => {
    // The shipping state of all seven rungs. Nothing is at risk anywhere until a
    // number is typed, and inventing one here is what 0026's seed refuses to do.
    expect(isAtRisk(400, null, RUNNING)).toBe(false)
  })

  it('is false when nothing has been recorded', () => {
    expect(isAtRisk(null, 30, RUNNING)).toBe(false)
  })

  it('stops the clock on a TERMINAL rung', () => {
    // "Live for 300 days" is the outcome, not a stall. Without this guard every
    // finished hospital sits at the top of the stalled list forever, which is how
    // a list stops being read.
    expect(isAtRisk(300, 30, { terminal: true, paused: false })).toBe(false)
  })

  it('stops the clock on a PAUSED rung', () => {
    // "Blocked on the customer since March" is a fact an account manager
    // RECORDED. An app that raised it every morning would teach three people to
    // ignore the alarm.
    expect(isAtRisk(300, 30, { terminal: false, paused: true })).toBe(false)
  })

  it('composes with the other two, on the numbers alone', () => {
    // The whole chain, as a screen runs it: the rung's expectation, the days on
    // it, and the verdict — with no stage NAME anywhere in the arithmetic.
    // Renaming "Live" to "In production" in the admin screen must not change
    // which organizations the map chases.
    const live = stage({ name: 'In production', terminal: true, expected_days: 7 })
    const integrating = stage({ expected_days: 7 })
    const now = new Date(2026, 7, 13, 9, 0)
    const changedAt = new Date(2026, 6, 13, 9, 0).toISOString()

    const days = daysInStage(changedAt, now)
    expect(days).toBe(31)
    expect(isAtRisk(days, resolveStallDays(integrating), integrating)).toBe(true)
    expect(isAtRisk(days, resolveStallDays(live), live)).toBe(false)
  })
})
