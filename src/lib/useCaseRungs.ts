// Which rungs a capability actually passes through — 0036, as a lookup.
//
// PURE: no store, no clock, no `t()`, no React. Everything arrives as an
// argument and the same arguments always produce the same answer.
//
// ── THE OWNER'S ASK, AND WHAT IT DID AND DID NOT CHANGE ───────────────────
//
//   "each use case has its own phases"
//
// and, asked what differs: the same five, but some do not apply to some use
// cases. So the LADDER is unchanged — Intake → DEV → STG/TEST → COC → PROD is
// still the programme's shared vocabulary, still five values in one CHECK
// constraint, still five words in `USE_CASE_RUNGS`. What varies is which stops
// a capability makes. Vital Signs may have no separate test stage; ADT has all
// five.
//
// ⚠ WHICH IS WHY THIS FILE HAS NO NAMES IN IT. A per-capability list of phase
//   NAMES was the other reading of that sentence, and it would have made "how
//   many are past DEV" a question with no answer, because DEV would mean a
//   different thing per column. Membership keeps every count comparable.
//
// ── THE ONE DECISION THIS FILE OWNS: WHAT ABSENCE MEANS ───────────────────
//
// ⚠ NO ROWS MEANS ALL FIVE, and it is the difference between a screen that
//   works before 0036 is applied and one that is blank until it is.
//
//   Two different absences land here and both resolve the same way:
//
//     · the TABLE is missing — 0036 is unapplied, `listUseCaseRungs` answers
//       42P01 on every load, and `settle()` keeps the empty list it started
//       with. Every capability must behave exactly as it did before the table
//       existed, which is: all five.
//     · a CAPABILITY has no rows — one added before 0036's seeding trigger
//       existed, or one whose set somebody deleted entirely. The choice is
//       between a capability that cannot be used and gives no clue why, and one
//       that offers the full ladder. The second is recoverable.
//
//   0036's own guard trigger makes the identical call server-side, in as many
//   words, so the client and the database agree about the empty case rather
//   than each having an opinion.

import { USE_CASE_RUNGS, type UseCaseRung, type UseCaseRungRow } from '../types'

/**
 * The rows folded into a lookup, keyed by capability.
 *
 * Built ONCE by the store rather than per render — `store/config.ts`'s standing
 * rule that a selector returning a freshly built Map is "the snapshot changed,
 * forever" under `useSyncExternalStore`.
 */
export type UseCaseRungMap = ReadonlyMap<string, ReadonlySet<UseCaseRung>>

export function buildUseCaseRungMap(rows: readonly UseCaseRungRow[]): UseCaseRungMap {
  const out = new Map<string, Set<UseCaseRung>>()
  for (const row of rows) {
    const held = out.get(row.use_case_id)
    if (held === undefined) out.set(row.use_case_id, new Set([row.rung]))
    else held.add(row.rung)
  }
  return out
}

/**
 * The rungs this capability passes through, IN LADDER ORDER.
 *
 * Order comes from `USE_CASE_RUNGS` and never from the rows, so a set built in
 * any order draws the same track. See the header for why an unconfigured
 * capability answers with all five.
 */
export function rungsFor(map: UseCaseRungMap, useCaseId: string): readonly UseCaseRung[] {
  const set = map.get(useCaseId)
  if (set === undefined || set.size === 0) return USE_CASE_RUNGS
  return USE_CASE_RUNGS.filter((r) => set.has(r))
}

/** Whether a capability makes this stop. Unconfigured means every stop. */
export function rungApplies(map: UseCaseRungMap, useCaseId: string, rung: UseCaseRung): boolean {
  const set = map.get(useCaseId)
  if (set === undefined || set.size === 0) return true
  return set.has(rung)
}

/**
 * Where a rung sits on ONE capability's own ladder, and how long that ladder is.
 *
 * ⚠ THE POSITION IS THE CAPABILITY'S, NOT THE PROGRAMME'S, and that is the
 *   whole point of drawing it. §11.5: "distance along the track is the
 *   progress", so a capability with three stops must show its PROD marker at
 *   the END of a three-stop track. Drawing it at position 5 of 5 would report a
 *   finished capability as two-fifths short, on the one screen whose entire job
 *   is to be readable from across a room.
 *
 * Returns null for a rung the capability does not have — which a stored row can
 * still be, if the ladder was narrowed by a direct SQL write with 0036's guard
 * disabled. Callers draw no marker rather than one at the start.
 */
export function rungPosition(
  map: UseCaseRungMap,
  useCaseId: string,
  rung: UseCaseRung,
): { index: number; total: number } | null {
  const ladder = rungsFor(map, useCaseId)
  const index = ladder.indexOf(rung)
  if (index < 0) return null
  return { index, total: ladder.length }
}

/**
 * The rungs a capability does NOT pass through — for the admin screen, which
 * has to show both halves to be editable at all.
 */
export function rungsNotApplied(map: UseCaseRungMap, useCaseId: string): readonly UseCaseRung[] {
  const applied = new Set(rungsFor(map, useCaseId))
  return USE_CASE_RUNGS.filter((r) => !applied.has(r))
}

/**
 * The two rungs no capability may be without.
 *
 * ⚠ MIRRORS 0036's `use_case_rungs_guard_delete()` AND MUST STAY IN STEP WITH
 *   IT. Every one of the 1,540 links sits at intake, so removing it would
 *   orphan the estate in one click; and a ladder with no PROD is one a
 *   capability can never finish. The client hides the control rather than
 *   offering a switch the database will refuse — a disabled control is a
 *   promise, and this one would be a lie.
 *
 *   A capability that genuinely never goes live is `scope = 'not_applicable'`
 *   on the pair, which 0032 already has.
 */
export const REQUIRED_RUNGS: readonly UseCaseRung[] = ['intake', 'prod']

export function rungIsRequired(rung: UseCaseRung): boolean {
  return REQUIRED_RUNGS.includes(rung)
}
