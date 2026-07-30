// The mirror's proof.
//
// ADVANCE_FIXTURES below is not a hand-written expectation list. Every row of
// it was executed against the LIVE project's `public.advance_recurrence()` and
// diffed column for column; the `expected` value in each row IS what Postgres
// returned. scripts-free by design — the diff was a one-shot POST to the
// Supabase SQL endpoint, and re-running it is one command (recorded in the
// W3-TEMPLATES handoff note), because a test that silently stops matching the
// database is the failure this whole file exists to prevent.
//
// The matrix is deliberately weighted toward the three places the two
// implementations could plausibly disagree:
//
//  * MONTH ENDS — the clamp. Jan 31 → Feb 28, and the fact that a template
//    with no stored `day_of_month` then STICKS on the 28th while one with
//    `day_of_month = 31` recovers to Mar 31.
//  * LEAP YEARS — 2024 (leap), 2026 (not), 2000 (leap: divisible by 400) and
//    1900 (NOT leap: divisible by 100 but not 400). The last two are here
//    because a `new Date(year, m + 1, 0)` written the obvious way maps a
//    two-digit year into the 1900s, which silently deletes February 29 from
//    the year 2000 — a bug that is invisible until it is not.
//  * THE WEEKDAY NUDGE — which lands after the step, not before, so a weekly
//    template pinned to a different weekday than its anchor has a first
//    interval that is not seven days.
//
// The C2 block at the bottom is docs/FIX-BACKLOG.md's own reproduction, turned
// into a regression test: the exact three inputs the audit confirmed
// ("2026-12-01 → nextRunOn 2026-09-01", "every:daily due:-30d → 30 rows", "a
// 2020 anchor hits the 60 cap"), asserted both before the clamp (the hazard is
// real) and after it (the clamp closes it).

import { describe, expect, it } from 'vitest'
import {
  CATCHUP_CAP,
  advanceRecurrence,
  alignRun,
  cadenceFields,
  clampFirstRun,
  dueDateFor,
  pendingRuns,
  previewRuns,
  resolveSchedule,
  runsFrom,
} from './recurrence'
import { diffDays, isoWeekday } from './dates'
import type { Cadence, RecurringTemplate } from '../types'

/** [from, cadence, customIntervalDays, dayOfWeek, dayOfMonth, expected] */
type Fixture = readonly [IsoLike, Cadence, number | null, number | null, number | null, IsoLike]
type IsoLike = string

/* ── ADVANCE_FIXTURES:start (parsed by the live-diff runner — one row per line) ── */
const ADVANCE_FIXTURES: readonly Fixture[] = [
  // daily
  ['2026-07-29', 'daily', null, null, null, '2026-07-30'],
  ['2026-07-31', 'daily', null, null, null, '2026-08-01'],
  ['2026-12-31', 'daily', null, null, null, '2027-01-01'],
  ['2024-02-28', 'daily', null, null, null, '2024-02-29'],
  ['2024-02-29', 'daily', null, null, null, '2024-03-01'],
  ['2026-02-28', 'daily', null, null, null, '2026-03-01'],
  // daily ignores a weekday pin — the nudge is weekly/biweekly only
  ['2026-07-29', 'daily', null, 0, null, '2026-07-30'],
  // weekly
  ['2026-07-29', 'weekly', null, null, null, '2026-08-05'],
  ['2026-07-29', 'weekly', null, 3, null, '2026-08-05'],
  ['2026-07-29', 'weekly', null, 1, null, '2026-08-10'],
  ['2026-07-29', 'weekly', null, 0, null, '2026-08-09'],
  ['2026-07-29', 'weekly', null, 4, null, '2026-08-06'],
  ['2026-12-30', 'weekly', null, 2, null, '2027-01-12'],
  // biweekly
  ['2026-07-29', 'biweekly', null, null, null, '2026-08-12'],
  ['2026-07-29', 'biweekly', null, 6, null, '2026-08-15'],
  ['2026-02-18', 'biweekly', null, 3, null, '2026-03-04'],
  // monthly — the clamp, and the stick
  ['2026-01-31', 'monthly', null, null, null, '2026-02-28'],
  ['2024-01-31', 'monthly', null, null, null, '2024-02-29'],
  ['2026-02-28', 'monthly', null, null, null, '2026-03-28'],
  ['2026-02-28', 'monthly', null, null, 31, '2026-03-31'],
  ['2026-01-31', 'monthly', null, null, 31, '2026-02-28'],
  ['2026-03-31', 'monthly', null, null, 31, '2026-04-30'],
  ['2026-01-01', 'monthly', null, null, 15, '2026-02-15'],
  ['2026-12-15', 'monthly', null, null, 1, '2027-01-01'],
  ['2024-02-29', 'monthly', null, null, null, '2024-03-29'],
  ['2024-01-30', 'monthly', null, null, 30, '2024-02-29'],
  ['2026-01-30', 'monthly', null, null, 30, '2026-02-28'],
  ['2000-01-31', 'monthly', null, null, null, '2000-02-29'],
  ['1900-01-31', 'monthly', null, null, null, '1900-02-28'],
  // monthly ignores a weekday pin
  ['2026-01-31', 'monthly', null, 1, null, '2026-02-28'],
  // quarterly
  ['2025-11-30', 'quarterly', null, null, null, '2026-02-28'],
  ['2023-11-30', 'quarterly', null, null, null, '2024-02-29'],
  ['2026-08-31', 'quarterly', null, null, 31, '2026-11-30'],
  ['2026-10-01', 'quarterly', null, null, 1, '2027-01-01'],
  ['2024-02-29', 'quarterly', null, null, null, '2024-05-29'],
  ['2026-01-31', 'quarterly', null, null, 31, '2026-04-30'],
  // custom
  ['2026-07-29', 'custom', 10, null, null, '2026-08-08'],
  ['2026-07-29', 'custom', 1, null, null, '2026-07-30'],
  ['2026-07-29', 'custom', null, null, null, '2026-07-30'],
  ['2026-07-29', 'custom', 0, null, null, '2026-07-30'],
  ['2026-11-20', 'custom', 45, null, null, '2027-01-04'],
  ['2024-02-01', 'custom', 90, null, null, '2024-05-01'],
  // custom ignores a weekday pin
  ['2026-07-29', 'custom', 10, 1, null, '2026-08-08'],
]
/* ── ADVANCE_FIXTURES:end ── */

/** A stored row, with only the columns the recurrence maths reads set. */
function template(patch: Partial<RecurringTemplate>): RecurringTemplate {
  return {
    id: 't-1',
    track_id: null,
    title: 'Weekly capacity review',
    type: 'action',
    priority: 'medium',
    owner_id: null,
    owner_name: null,
    cadence: 'weekly',
    custom_interval_days: null,
    day_of_week: null,
    day_of_month: null,
    next_run_on: '2026-07-29',
    lead_days: 0,
    active: true,
    ...patch,
  }
}

describe('advanceRecurrence matches advance_recurrence()', () => {
  for (const [from, cadence, interval, dow, dom, expected] of ADVANCE_FIXTURES) {
    const pins = [
      interval === null ? null : `interval ${interval}`,
      dow === null ? null : `dow ${dow}`,
      dom === null ? null : `dom ${dom}`,
    ]
      .filter((p): p is string => p !== null)
      .join(', ')
    it(`${cadence} from ${from}${pins ? ` (${pins})` : ''} → ${expected}`, () => {
      expect(advanceRecurrence(from, cadence, interval, dow, dom)).toBe(expected)
    })
  }

  it('never returns a date that fails to advance', () => {
    // The scheduler LOOPS on this function; a zero or negative step is an
    // infinite catch-up loop holding a transaction open, not a wrong date.
    for (const [from, cadence, interval, dow, dom] of ADVANCE_FIXTURES) {
      expect(diffDays(from, advanceRecurrence(from, cadence, interval, dow, dom))).toBeGreaterThan(
        0,
      )
    }
  })

  it('lands on the pinned weekday whenever one is pinned', () => {
    for (const [from, cadence, , dow, , expected] of ADVANCE_FIXTURES) {
      if (dow === null) continue
      if (cadence !== 'weekly' && cadence !== 'biweekly') continue
      expect(isoWeekday(expected), `${from} ${cadence} dow ${dow}`).toBe(dow)
    }
  })

  it('passes an unparseable date through rather than inventing one', () => {
    // lib/dates.addDays made the same choice, for the same reason: a formatter
    // that turns bad data into a plausible date hides the corruption.
    expect(advanceRecurrence('not-a-date', 'weekly', null, null, null)).toBe('not-a-date')
    expect(advanceRecurrence('2026-02-30', 'daily', null, null, null)).toBe('2026-02-30')
  })

  it('treats an out-of-range weekday or day-of-month as unset', () => {
    // Both are unreachable through the database (`check … between`), and the
    // two languages' `%` disagree on negatives — normalising is the honest
    // mirror of a value that has no defined behaviour to mirror.
    expect(advanceRecurrence('2026-07-29', 'weekly', null, 9, null)).toBe('2026-08-05')
    expect(advanceRecurrence('2026-07-29', 'weekly', null, -1, null)).toBe('2026-08-05')
    expect(advanceRecurrence('2026-01-31', 'monthly', null, null, 0)).toBe('2026-02-28')
    expect(advanceRecurrence('2026-01-31', 'monthly', null, null, 44)).toBe('2026-02-28')
  })
})

describe('cadenceFields', () => {
  it('names only the columns advance_recurrence() actually reads', () => {
    expect(cadenceFields('daily')).toEqual({ interval: false, dayOfWeek: false, dayOfMonth: false })
    expect(cadenceFields('weekly')).toEqual({ interval: false, dayOfWeek: true, dayOfMonth: false })
    expect(cadenceFields('biweekly')).toEqual({
      interval: false,
      dayOfWeek: true,
      dayOfMonth: false,
    })
    expect(cadenceFields('monthly')).toEqual({
      interval: false,
      dayOfWeek: false,
      dayOfMonth: true,
    })
    expect(cadenceFields('quarterly')).toEqual({
      interval: false,
      dayOfWeek: false,
      dayOfMonth: true,
    })
    expect(cadenceFields('custom')).toEqual({ interval: true, dayOfWeek: false, dayOfMonth: false })
  })
})

describe('runsFrom / previewRuns', () => {
  it('starts AT next_run_on — that date is the next run, not the one before it', () => {
    expect(previewRuns(template({ cadence: 'monthly', next_run_on: '2026-08-01', day_of_month: 1 }), 4)).toEqual([
      '2026-08-01',
      '2026-09-01',
      '2026-10-01',
      '2026-11-01',
    ])
  })

  it('walks a month-end schedule without drifting off the 31st', () => {
    expect(
      previewRuns(template({ cadence: 'monthly', next_run_on: '2026-01-31', day_of_month: 31 }), 5),
    ).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31'])
  })

  it('drifts and STICKS when no day_of_month is stored — the DB behaviour, mirrored', () => {
    // This is why api/templates.ts always writes an explicit day_of_month.
    expect(
      previewRuns(template({ cadence: 'monthly', next_run_on: '2026-01-31' }), 4),
    ).toEqual(['2026-01-31', '2026-02-28', '2026-03-28', '2026-04-28'])
  })

  it('is strictly increasing and honours n', () => {
    const runs = runsFrom('2026-07-29', 'biweekly', null, 6, null, 6)
    expect(runs).toHaveLength(6)
    for (let i = 1; i < runs.length; i += 1) {
      expect(diffDays(runs[i - 1], runs[i])).toBeGreaterThan(0)
    }
  })

  it('returns nothing for n <= 0 or an unparseable start', () => {
    expect(runsFrom('2026-07-29', 'daily', null, null, null, 0)).toEqual([])
    expect(runsFrom('2026-07-29', 'daily', null, null, null, -3)).toEqual([])
    expect(runsFrom('nope', 'daily', null, null, null, 5)).toEqual([])
  })
})

describe('alignRun', () => {
  it('moves the anchor onto the pinned weekday instead of waiting a cycle', () => {
    // Wednesday 2026-07-29 pinned to Monday. Without this the first run is the
    // Wednesday and the second is twelve days later.
    expect(alignRun('2026-07-29', 'weekly', 1, null)).toBe('2026-08-03')
    expect(isoWeekday('2026-08-03')).toBe(1)
  })

  it('leaves an anchor that already matches alone', () => {
    expect(alignRun('2026-07-29', 'weekly', 3, null)).toBe('2026-07-29')
    expect(alignRun('2026-07-29', 'biweekly', 3, null)).toBe('2026-07-29')
  })

  it('moves forward to the day of the month, this month or next', () => {
    expect(alignRun('2026-07-01', 'monthly', null, 15)).toBe('2026-07-15')
    expect(alignRun('2026-07-29', 'monthly', null, 1)).toBe('2026-08-01')
    expect(alignRun('2026-07-15', 'monthly', null, 15)).toBe('2026-07-15')
  })

  it('clamps a day the month does not have', () => {
    expect(alignRun('2026-02-01', 'monthly', null, 31)).toBe('2026-02-28')
    expect(alignRun('2024-02-01', 'monthly', null, 31)).toBe('2024-02-29')
  })

  it('steps a quarterly anchor by ONE month, not one quarter', () => {
    // Aligning the start date must not push it three months past what the user
    // typed; the quarter spacing starts from the aligned anchor.
    expect(alignRun('2026-07-29', 'quarterly', null, 1)).toBe('2026-08-01')
  })

  it('never moves backward, and ignores pins the cadence does not read', () => {
    expect(diffDays('2026-07-29', alignRun('2026-07-29', 'weekly', 2, null))).toBeGreaterThanOrEqual(
      0,
    )
    expect(alignRun('2026-07-29', 'daily', 1, 15)).toBe('2026-07-29')
    expect(alignRun('2026-07-29', 'custom', 1, 15)).toBe('2026-07-29')
    expect(alignRun('not-a-date', 'weekly', 1, null)).toBe('not-a-date')
  })
})

describe('the C2 hazard — a past anchor must clamp forward, never backfill', () => {
  // docs/FIX-BACKLOG.md C2, reproduced verbatim. Each case asserts the hazard
  // FIRST (so the test still means something if the clamp is ever removed) and
  // then that the clamp closes it.

  it('“Monthly report every:monthly due:1/9” at 2026-12-01 — 4 backfilled entries', () => {
    const behind = template({
      cadence: 'monthly',
      day_of_month: 1,
      next_run_on: '2026-09-01',
    })
    expect(pendingRuns(behind, '2026-12-01')).toBe(4)
    expect(clampFirstRun('2026-09-01', 'monthly', null, null, 1, '2026-12-01')).toBe('2026-12-01')
    expect(pendingRuns(template({ ...behind, next_run_on: '2026-12-01' }), '2026-12-01')).toBe(1)
  })

  it('“every:daily due:-30d” — 31 backfilled entries', () => {
    const behind = template({ cadence: 'daily', next_run_on: '2026-06-29' })
    expect(pendingRuns(behind, '2026-07-29')).toBe(31)
    expect(clampFirstRun('2026-06-29', 'daily', null, null, null, '2026-07-29')).toBe('2026-07-29')
  })

  it('a 2020 anchor hits the 60-row cap', () => {
    const ancient = template({ cadence: 'daily', next_run_on: '2020-01-01' })
    expect(pendingRuns(ancient, '2026-07-29')).toBe(CATCHUP_CAP)
    expect(clampFirstRun('2020-01-01', 'daily', null, null, null, '2026-07-29')).toBe('2026-07-29')
  })

  it('preserves the schedule’s phase rather than snapping to today', () => {
    // Weekly on Mondays, eight weeks behind: the clamp lands on the next
    // MONDAY, not on today. Snapping to today would silently re-author the
    // schedule while looking like a fix.
    const clamped = clampFirstRun('2026-06-01', 'weekly', null, 1, null, '2026-07-29')
    expect(clamped).toBe('2026-08-03')
    expect(isoWeekday(clamped)).toBe(1)

    // Monthly on the 1st, six months behind → the next 1st.
    expect(clampFirstRun('2026-01-01', 'monthly', null, null, 1, '2026-07-15')).toBe('2026-08-01')
  })

  it('lands exactly on today when the phase happens to reach it', () => {
    // 2026-06-03 + 8 weeks = 2026-07-29. `next_run_on <= current_date` is the
    // scheduler's condition, so today is due TODAY and is not a backfill.
    expect(clampFirstRun('2026-06-03', 'weekly', null, null, null, '2026-07-29')).toBe('2026-07-29')
  })

  it('leaves a present or future anchor untouched', () => {
    expect(clampFirstRun('2026-07-29', 'daily', null, null, null, '2026-07-29')).toBe('2026-07-29')
    expect(clampFirstRun('2026-12-01', 'monthly', null, null, 1, '2026-07-29')).toBe('2026-12-01')
  })

  it('falls back to today on input no CHECK constraint covers', () => {
    expect(clampFirstRun('not-a-date', 'daily', null, null, null, '2026-07-29')).toBe('2026-07-29')
  })
})

describe('pendingRuns', () => {
  it('counts nothing for a paused template — the pass filters on `active`', () => {
    expect(pendingRuns(template({ active: false, next_run_on: '2020-01-01' }), '2026-07-29')).toBe(0)
  })

  it('counts nothing for a template whose next run is still ahead', () => {
    expect(pendingRuns(template({ next_run_on: '2026-07-30' }), '2026-07-29')).toBe(0)
  })

  it('counts one for a template due exactly today', () => {
    expect(pendingRuns(template({ next_run_on: '2026-07-29' }), '2026-07-29')).toBe(1)
  })

  it('counts each missed occurrence, not one lump', () => {
    // Four Wednesdays: 07-08, 07-15, 07-22, 07-29.
    expect(pendingRuns(template({ next_run_on: '2026-07-08' }), '2026-07-29')).toBe(4)
  })
})

describe('resolveSchedule', () => {
  const base = { customIntervalDays: null, dayOfWeek: null, dayOfMonth: null }

  it('nulls the pins the cadence does not read', () => {
    const s = resolveSchedule(
      { ...base, cadence: 'daily', nextRunOn: '2026-08-03', dayOfWeek: 4, dayOfMonth: 9, customIntervalDays: 12 },
      false,
    )
    expect(s).toMatchObject({
      cadence: 'daily',
      customIntervalDays: null,
      dayOfWeek: null,
      dayOfMonth: null,
      nextRunOn: '2026-08-03',
    })
  })

  it('always writes the pin the cadence DOES read, derived from the anchor', () => {
    // This is what stops a monthly template sticking on the 28th forever.
    expect(
      resolveSchedule({ ...base, cadence: 'monthly', nextRunOn: '2026-01-31' }, false).dayOfMonth,
    ).toBe(31)
    // 2026-08-03 is a Monday.
    expect(
      resolveSchedule({ ...base, cadence: 'weekly', nextRunOn: '2026-08-03' }, false).dayOfWeek,
    ).toBe(1)
    expect(
      resolveSchedule({ ...base, cadence: 'quarterly', nextRunOn: '2026-02-15' }, false).dayOfMonth,
    ).toBe(15)
  })

  it('keeps a pin the caller chose, and clamps a custom interval into range', () => {
    expect(
      resolveSchedule({ ...base, cadence: 'weekly', nextRunOn: '2026-08-03', dayOfWeek: 4 }, false)
        .dayOfWeek,
    ).toBe(4)
    expect(
      resolveSchedule(
        { ...base, cadence: 'custom', nextRunOn: '2026-08-03', customIntervalDays: 0 },
        false,
      ).customIntervalDays,
    ).toBe(1)
    // Clamped UP to the ceiling, not down to the floor: a mistyped 9999
    // falling back to 1 would turn a yearly template into a daily one, which
    // is the wrong direction to fail in.
    expect(
      resolveSchedule(
        { ...base, cadence: 'custom', nextRunOn: '2026-08-03', customIntervalDays: 9999 },
        false,
      ).customIntervalDays,
    ).toBe(365)
    expect(
      resolveSchedule(
        { ...base, cadence: 'custom', nextRunOn: '2026-08-03', customIntervalDays: null },
        false,
      ).customIntervalDays,
    ).toBe(1)
  })

  it('clamps only when asked, and reports that it did', () => {
    const clamped = resolveSchedule(
      { ...base, cadence: 'monthly', nextRunOn: '2026-01-01', dayOfMonth: 1 },
      true,
      '2026-07-15',
    )
    expect(clamped.nextRunOn).toBe('2026-08-01')
    expect(clamped.clamped).toBe(true)

    const left = resolveSchedule(
      { ...base, cadence: 'monthly', nextRunOn: '2026-01-01', dayOfMonth: 1 },
      false,
      '2026-07-15',
    )
    expect(left.nextRunOn).toBe('2026-01-01')
    expect(left.clamped).toBe(false)
  })

  it('derives the pin from the CLAMPED anchor, not the one that was rejected', () => {
    // Anchored on a Tuesday eight months back with no pin. The clamp walks the
    // schedule forward, and the weekday recorded must be the one the surviving
    // date actually falls on.
    const s = resolveSchedule(
      { ...base, cadence: 'weekly', nextRunOn: '2025-11-04' },
      true,
      '2026-07-29',
    )
    expect(s.clamped).toBe(true)
    expect(s.dayOfWeek).toBe(isoWeekday(s.nextRunOn))
    expect(s.dayOfWeek).toBe(2)
  })
})

describe('dueDateFor', () => {
  it('adds lead_days to the run date — the entry appears first, is due later', () => {
    expect(dueDateFor('2026-07-29', 0)).toBe('2026-07-29')
    expect(dueDateFor('2026-07-29', 3)).toBe('2026-08-01')
    expect(dueDateFor('2026-12-30', 7)).toBe('2027-01-06')
    expect(dueDateFor('2024-02-27', 3)).toBe('2024-03-01')
  })

  it('passes a run date it cannot parse straight through', () => {
    expect(dueDateFor('nope', 3)).toBe('nope')
    expect(dueDateFor('2026-07-29', Number.NaN)).toBe('2026-07-29')
  })
})
