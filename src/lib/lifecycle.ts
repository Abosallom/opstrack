// How long an organization has been standing where it is, and whether that is a
// problem yet.
//
// PURE, AND THE PURITY IS THE POINT. No store, no clock, no t(). `today` arrives
// as an argument on every function that needs it, exactly as lib/dates.ts's
// `daysSince(ts, now)` takes one — which is what makes "is Riyadh General
// stalled?" answerable in a test at a fixed instant instead of only on a machine
// whose wall clock happens to be in the right week. lib/mapNodes.ts's header
// makes the same promise about the capability arithmetic and for the same reason.
//
// ── THE CLOCK-STOPS CONTRACT ───────────────────────────────────────────────
//
// Two flags on the stage row switch the whole question off, and they are FLAGS ON
// A CONFIGURABLE ROW rather than names this file compares against:
//
//   terminal — the organization HAS ARRIVED. "Live for 300 days" is not a stall,
//              it is the outcome, and counting it would put every finished
//              hospital at the top of the stalled list forever.
//   paused   — the clock is deliberately stopped. "Blocked on the customer since
//              March" is a fact an account manager RECORDED, and an app that
//              raised it as an alarm every morning would teach three people to
//              stop looking at the alarm.
//
// That is 0026's `map_node_stages.terminal` / `.paused` comments as executable
// code. Nothing here ever tests a stage's NAME: renaming "Live" to "In
// production" in the admin screen must not change which organizations the map
// chases, and the moment a literal appears in this file it silently does.
//
// ── WHAT THIS FILE DELIBERATELY DOES NOT DECIDE ────────────────────────────
//
// It does not decide WHICH stage a node is on (store/config.ts's
// `progressByNodeId` → `stageById`), it does not fetch anything, and it renders
// no sentence. `isAtRisk` answers a boolean and the caller chooses the words, so
// the same arithmetic serves an Arabic sentence, an English one and a count.

import { daysSince } from './dates'
import type { IsoInstant } from './dates'
import type { MapNodeStage } from '../types'

/**
 * The stalled threshold for a stage, in days — or null when there is no
 * expectation to breach.
 *
 * NULL IS THE ORDINARY ANSWER, NOT A DEGRADED ONE. 0026 seeds `expected_days` on
 * NO rung on purpose (0003's SLA-off reasoning: a threshold nobody chose is a
 * number the app would then chase people with), so on the day the migration
 * applies this returns null for all seven and nothing is at risk anywhere. The
 * numbers arrive when Aziz types them into the stage admin screen, one rung at a
 * time, and the lens lights up rung by rung as he does.
 *
 * `fallback` exists for the screen that wants a workspace-wide default under the
 * per-stage number — "anything over 90 days is worth a look" — WITHOUT that
 * default overruling a rung whose expectation the admin has actually stated. It
 * is an argument rather than a constant in this file for the reason
 * `useCaseProgress`'s `terminalKey` is one: a policy number belongs at the call
 * site that owns the policy, not in the arithmetic.
 *
 * A missing stage (`null`/`undefined` — a node nobody has staged, or one whose
 * rung was retired) takes the fallback too: there is no expectation on a rung
 * that is not there, but a workspace-wide floor still applies to the node.
 */
export function resolveStallDays(
  stage: Pick<MapNodeStage, 'expected_days'> | null | undefined,
  fallback: number | null = null,
): number | null {
  return stage?.expected_days ?? fallback
}

/**
 * Whole calendar days a node has been on its current rung, or null when nothing
 * has been recorded.
 *
 * NULL AND ZERO ARE DIFFERENT ANSWERS AND CALLERS MUST NOT COLLAPSE THEM. Null
 * means there is no `stage_changed_at` — no progress row at all, or a row whose
 * stage was cleared, which 0026 keeps in step through
 * `map_node_progress_stage_chk`. Zero means the node arrived TODAY. A column that
 * rendered both as "0 days" would report 400 un-started organizations as having
 * just been moved.
 *
 * CALENDAR DAYS, not elapsed 24-hour periods — `daysSince`'s contract, so a stage
 * change at 23:50 last night reads as one day this morning, which is what a
 * person means by it. `now` is an argument all the way down.
 *
 * CLAMPED AT 0. A future `stage_changed_at` is only reachable through clock skew
 * between the database and the reader's device (the stamp is `now()` server-side
 * and no client can write the column), and "-1 days in stage" on a panel is the
 * kind of number that gets a working feature reported as broken. Clamping loses
 * nothing: the honest reading of a stamp a few seconds ahead is "just now".
 */
export function daysInStage(stageChangedAt: IsoInstant | null, now: Date): number | null {
  if (!stageChangedAt) return null
  return Math.max(0, daysSince(stageChangedAt, now))
}

/** The two stage flags that stop the clock. A subset of `MapNodeStage`, so a caller can pass the row. */
export interface StageClock {
  terminal: boolean
  paused: boolean
}

/**
 * Has this node been where it is for longer than the rung allows?
 *
 * FALSE IS THE ANSWER TO EVERY QUESTION THIS FILE CANNOT ANSWER, and each of the
 * four ways that happens is a deliberate silence rather than a missing case:
 *
 *   * `days` null — nothing has been recorded, so there is nothing to judge. An
 *     organization nobody has staged is not stalled, it is unlooked-at, and those
 *     are two different lists.
 *   * `threshold` null — the admin has not said how long this rung should take.
 *     Inventing a number here is exactly what 0026 refuses to do in the seed.
 *   * `terminal` — the organization has arrived.
 *   * `paused` — the clock is deliberately stopped.
 *
 * STRICTLY GREATER THAN, NOT ≥, and the boundary is a decision: `expected_days`
 * is how long a node is EXPECTED to sit on this rung, so a node that has been on
 * a 30-day rung for exactly 30 days is on time — it goes at risk on day 31. The
 * other reading would report every organization as breaching its expectation on
 * the day it met it.
 */
export function isAtRisk(
  days: number | null,
  threshold: number | null,
  clock: StageClock,
): boolean {
  if (days === null || threshold === null) return false
  if (clock.terminal || clock.paused) return false
  return days > threshold
}
