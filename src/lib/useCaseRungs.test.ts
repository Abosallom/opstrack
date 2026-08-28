// Which rungs a capability passes through — and what an absent answer means.

import { describe, expect, it } from 'vitest'

import {
  buildUseCaseRungMap,
  REQUIRED_RUNGS,
  rungApplies,
  rungIsRequired,
  rungPosition,
  rungsFor,
  rungsNotApplied,
} from './useCaseRungs'
import { USE_CASE_RUNGS, type UseCaseRung, type UseCaseRungRow } from '../types'

function row(useCaseId: string, rung: UseCaseRung): UseCaseRungRow {
  return {
    id: `${useCaseId}-${rung}`,
    use_case_id: useCaseId,
    rung,
    expected_days: null,
    created_at: '2026-08-28T00:00:00Z',
    updated_at: '2026-08-28T00:00:00Z',
    created_by: null,
    updated_by: null,
  }
}

const FULL = USE_CASE_RUNGS.map((r) => row('adt', r))

/**
 * ⚠ THE DECISION THIS MODULE OWNS, and the one that decides whether the app
 * works before 0036 is applied at all.
 */
describe('what an absence means', () => {
  it('gives every capability the full ladder when the table is missing', () => {
    // 0036 unapplied: the read fails on every load and settle() keeps [].
    const map = buildUseCaseRungMap([])
    expect(rungsFor(map, 'adt')).toEqual(USE_CASE_RUNGS)
    expect(rungApplies(map, 'adt', 'coc')).toBe(true)
  })

  it('gives an unconfigured capability the full ladder even when others are configured', () => {
    // One capability whose rows somebody deleted entirely, beside one that has
    // them. The choice is between a capability that cannot be used and gives no
    // clue why, and one that offers everything. The second is recoverable.
    const map = buildUseCaseRungMap([row('adt', 'intake'), row('adt', 'prod')])
    expect(rungsFor(map, 'vitals')).toEqual(USE_CASE_RUNGS)
    expect(rungsFor(map, 'adt')).toEqual(['intake', 'prod'])
  })

  it('agrees with 0036, which makes the same call server-side', () => {
    // The migration's guard returns early when a capability has no rows at all.
    // Client and database must not each hold their own opinion of the empty
    // case; this test is that agreement written down.
    const map = buildUseCaseRungMap([])
    for (const rung of USE_CASE_RUNGS) expect(rungApplies(map, 'anything', rung)).toBe(true)
  })
})

describe('the ladder a capability actually has', () => {
  it('returns only the rungs with a row', () => {
    const map = buildUseCaseRungMap([row('vitals', 'intake'), row('vitals', 'dev'), row('vitals', 'prod')])
    expect(rungsFor(map, 'vitals')).toEqual(['intake', 'dev', 'prod'])
  })

  /**
   * ⚠ ORDER COMES FROM `USE_CASE_RUNGS`, NEVER FROM THE ROWS. A set built in
   * whatever order PostgREST returned must draw the same track every time.
   */
  it('orders by the programme ladder, not by the order the rows arrived', () => {
    const map = buildUseCaseRungMap([row('x', 'prod'), row('x', 'intake'), row('x', 'stg')])
    expect(rungsFor(map, 'x')).toEqual(['intake', 'stg', 'prod'])
  })

  it('answers the inverse for the admin screen, which has to show both halves', () => {
    const map = buildUseCaseRungMap([row('vitals', 'intake'), row('vitals', 'prod')])
    expect(rungsNotApplied(map, 'vitals')).toEqual(['dev', 'stg', 'coc'])
    expect(rungsNotApplied(buildUseCaseRungMap([]), 'adt')).toEqual([])
  })

  it('says a rung does not apply when the capability skips it', () => {
    const map = buildUseCaseRungMap([row('vitals', 'intake'), row('vitals', 'prod')])
    expect(rungApplies(map, 'vitals', 'stg')).toBe(false)
    expect(rungApplies(map, 'vitals', 'prod')).toBe(true)
  })
})

/**
 * §11.5: distance along the track IS the progress. A capability with three
 * stops must show its PROD marker at the END of a three-stop track — drawing it
 * at position 5 of 5 would report a finished capability as two-fifths short, on
 * the one screen whose whole job is to be readable from across a room.
 */
describe('the position is the capability’s own, not the programme’s', () => {
  it('puts the last stop of a short ladder at the end of that ladder', () => {
    const map = buildUseCaseRungMap([row('vitals', 'intake'), row('vitals', 'dev'), row('vitals', 'prod')])
    expect(rungPosition(map, 'vitals', 'prod')).toEqual({ index: 2, total: 3 })
  })

  it('keeps the full ladder at five for a capability that makes every stop', () => {
    const map = buildUseCaseRungMap(FULL)
    expect(rungPosition(map, 'adt', 'prod')).toEqual({ index: 4, total: 5 })
    expect(rungPosition(map, 'adt', 'intake')).toEqual({ index: 0, total: 5 })
  })

  it('returns null for a rung the capability does not have, so no marker is drawn', () => {
    // Reachable only by a direct SQL write with 0036's guard disabled — and a
    // marker at position zero would say "not started" about a pair that is at
    // STG/TEST, which is worse than drawing nothing.
    const map = buildUseCaseRungMap([row('vitals', 'intake'), row('vitals', 'prod')])
    expect(rungPosition(map, 'vitals', 'stg')).toBeNull()
  })
})

/**
 * ⚠ MIRRORS 0036's `use_case_rungs_guard_delete()`. If either side changes
 * without the other, the client offers a switch the database refuses.
 */
describe('the two rungs no capability may be without', () => {
  it('names intake and prod, and only those', () => {
    expect(REQUIRED_RUNGS).toEqual(['intake', 'prod'])
    expect(rungIsRequired('intake')).toBe(true)
    expect(rungIsRequired('prod')).toBe(true)
    expect(rungIsRequired('dev')).toBe(false)
    expect(rungIsRequired('stg')).toBe(false)
    expect(rungIsRequired('coc')).toBe(false)
  })
})
