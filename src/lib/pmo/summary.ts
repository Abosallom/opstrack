// THE PMO DASHBOARD'S ARITHMETIC — delivery, risk, and the one rule that
// decides whether a number is allowed on the glass at all.
//
// PURE, on lib/aggregate.ts's contract and lib/portfolio/fields.ts's: no store,
// no api, no clock, no React, no `t()`. `today`, `now` and every lookup arrive
// as arguments. That is what makes "is anything actually late" answerable in a
// test at a fixed instant rather than only on a machine whose wall clock is in
// the right week.
//
// ── IT OWNS NO DEFINITION IT COULD HAVE IMPORTED ───────────────────────────
//
// The stage clock is `lib/portfolio/fields.stageReading` — the SAME function
// the map card, the portfolio table, the chip's badge and the org panel read,
// which is the only shape under which "do they all show the same number"
// answers "always" rather than "usually". "Open" is `lib/health.isOpen`. The
// follow-up buckets are `lib/entrySections.bucketFollowUps`, untouched. What is
// new here is the FOLD over those answers and the honesty gate below, because
// neither existed anywhere.
//
// ── THE HONESTY GATE, WHICH IS THE POINT OF THIS FILE ─────────────────────
//
// ⚠ NO KPI MAY RENDER FROM A METRIC WHOSE INPUTS ARE UNCONFIGURED.
//
// The live workspace is the reason this is a type and not a comment. Eighty-five
// organizations exist, fifty carry a stage, and every `stage_changed_at` was
// stamped by the import that created it — so "days in stage" is 0 everywhere and
// the count of stalled organizations is legitimately zero. A tile reading
// "0 at risk" in that state is FALSE: it says "we looked and nothing is late",
// when the truth is "nothing has been anywhere long enough to be late yet".
// Those are different sentences and only one of them is true.
//
// 0026 also seeds `expected_days` on NO rung on purpose (lib/lifecycle.ts's
// header gives 0003's SLA-off reasoning: a threshold nobody chose is a number
// the app would then chase people with). So the ordinary state of a fresh
// workspace is that the lateness question has no denominator at all, and
// `latenessVerdict` returns that as its own arm rather than as a zero.
//
// The same shape is applied to compliance by `lib/aggregate.slaCompliance`,
// which already returns `rate: null` — never 0 — when nothing was measurable.
// This module does not restate that; it consumes it.
//
// ── NULL IS NOT ZERO, ANYWHERE ─────────────────────────────────────────────
//
// `stageId` null is "nobody has said where this is". `daysInStage` null is the
// same. `longestDays` null is "no organization has a clock running". Each is a
// DIFFERENT fact from a zero and every one of them renders as its own kind of
// absence — MindtreeTable's EM_DASH note, carried one surface further.

import { isOpen } from '../health'
import { stageReading, type StageReadingInput } from '../portfolio/fields'
import { diffDays, instantToIsoDate, type IsoDate } from '../dates'
import type {
  Entry,
  EntryHealth,
  EntryPriority,
  EntryType,
  HealthLevel,
  MapNode,
} from '../../types'

/* ══════════════════════════ delivery ══════════════════════════ */

/**
 * One organization, as the PMO reads it.
 *
 * NOT a `PortfolioRow`, and deliberately not: that shape is built off the
 * MindNode tree the map draws, which this page does not have and must not
 * remount a stage to obtain. It is built off `store/config`'s `map_nodes` +
 * `map_node_progress` instead — the same two tables, one walk shallower — and
 * the STAGE TRIAD is the identical `stageReading` call, so the two surfaces
 * cannot disagree about how long an organization has stood where it is.
 */
export interface DeliveryRow {
  /** `map_nodes.id`. The React key, and what `?node=` narrows to. */
  nodeId: string
  /** Already resolved for the locale by the caller's `labelOf`. */
  name: string
  /** Which track it hangs under — for the colour bar, never compared against. */
  trackId: string
  /** The rung, or null when nobody has said. */
  stageId: string | null
  /** The rung's `sort_order` — the stage column's sort key. Never the name. */
  stageOrder: number | null
  /** Whole calendar days on this rung, or null when nothing is recorded. */
  daysInStage: number | null
  /** The rung's expectation after the coalesce chain, or null when unset. */
  stallDays: number | null
  /** `daysInStage > stallDays`, with terminal and paused stopping the clock. */
  atRisk: boolean
  /** The INHERITED account manager — nearest self-or-ancestor, or null. */
  managerId: string | null
  /** Open work AT OR UNDER this node. Zero is a real answer, not an absence. */
  open: number
}

/** Everything {@link buildDeliveryRows} needs and cannot know. All injected. */
export interface DeliveryInput extends StageReadingInput {
  /** `store/config`'s `useMapNodes()`. Archived nodes are skipped here. */
  nodes: readonly MapNode[]
  /** A node's name, resolved for the locale — the page's `nodeLabel`. */
  labelOf: (node: MapNode) => string
  /**
   * node id → open work at or under it, folded by the caller off
   * `FilterContext.ancestryOfNode` — the SAME walk the filter uses, so the
   * number here and the number a `?node=` link lands on cannot drift.
   */
  openByNode: ReadonlyMap<string, number>
  /**
   * node id → the nearest self-or-ancestor account manager, or null when there
   * is none anywhere up the chain — `FilterContext.managerOfNode`.
   *
   * A MISSING KEY falls back to the node's own column, mirroring
   * `PortfolioInput.managerOfNode`: a caller with no context map yet gets the
   * previous behaviour rather than eighty-five organizations with nobody
   * accountable for them. A `null` VALUE is the opposite fact — the walk ran and
   * found nobody.
   */
  managerOfNode: ReadonlyMap<string, string | null>
}

/**
 * One row per live organization, WORST FIRST.
 *
 * ARCHIVED NODES ARE SKIPPED, which is the one place this parts company with
 * `buildPortfolioRows` (which draws them and marks them). The reason is the
 * reader: the portfolio table is an audit surface where hiding a row hides data,
 * and this is a delivery review where an organization somebody put away is not
 * being delivered. `foldPortfolio` skips them for the same reason.
 *
 * THE SORT IS THE READING. At risk first — that is the whole question — then
 * longest on its rung, then most open work, then the name, then the id so two
 * identical rows never swap places between renders. A null `daysInStage` sorts
 * LAST within its group: "nobody has said" is not "zero days", and floating it
 * to the top of a longest-first list would put the unlooked-at above the stuck.
 */
export function buildDeliveryRows(input: DeliveryInput): DeliveryRow[] {
  const rows: DeliveryRow[] = []
  for (const node of input.nodes) {
    if (node.archived) continue
    const reading = stageReading(node.id, input)
    rows.push({
      nodeId: node.id,
      name: input.labelOf(node),
      trackId: node.track_id,
      stageId: reading.stage?.id ?? null,
      stageOrder: reading.stage?.sort_order ?? null,
      daysInStage: reading.days,
      stallDays: reading.stallDays,
      atRisk: reading.atRisk,
      // `.has()`, NOT `?? node.account_manager_id`. A `null` VALUE is the walk
      // having run and found nobody up the chain; a MISSING KEY is the walk
      // never having been asked. `??` collapses the two and would re-assert a
      // manager the walk deliberately overruled.
      managerId: input.managerOfNode.has(node.id)
        ? (input.managerOfNode.get(node.id) ?? null)
        : node.account_manager_id,
      open: input.openByNode.get(node.id) ?? 0,
    })
  }
  rows.sort(compareDelivery)
  return rows
}

/** At risk, then longest-standing, then busiest, then by name, then by id. */
function compareDelivery(a: DeliveryRow, b: DeliveryRow): number {
  if (a.atRisk !== b.atRisk) return a.atRisk ? -1 : 1
  // Nulls last inside each group — see the note on the sort above.
  if (a.daysInStage !== b.daysInStage) {
    if (a.daysInStage === null) return 1
    if (b.daysInStage === null) return -1
    if (a.daysInStage !== b.daysInStage) return b.daysInStage - a.daysInStage
  }
  if (a.open !== b.open) return b.open - a.open
  // Code point, never localeCompare — lib/entryFilter's `title` sort gives the
  // reason: the order has to be identical in the test runner and the browser.
  if (a.name !== b.name) return a.name < b.name ? -1 : 1
  return a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0
}

/* ══════════════════════════ the honesty gate ══════════════════════════ */

/** What the workspace can and cannot currently answer about lateness. */
export interface StageReadiness {
  /** Live organizations. The population every other number here is out of. */
  organizations: number
  /** …of which somebody has recorded a rung for. */
  staged: number
  /** …of which nobody has. `organizations - staged`, carried rather than derived. */
  unstaged: number
  /**
   * …of which a rung expectation resolves for (the rung's own `expected_days`,
   * or the workspace floor). THE DENOMINATOR OF THE LATENESS QUESTION: zero
   * here means the question has not been asked of anybody, which is not the
   * same as everybody passing it.
   */
  measurable: number
  /** The longest any measurable organization has stood on its rung, or null. */
  longestDays: number | null
  /** Measurable organizations past their rung's expectation. */
  atRisk: number
}

export function stageReadiness(rows: readonly DeliveryRow[]): StageReadiness {
  let staged = 0
  let measurable = 0
  let atRisk = 0
  let longestDays: number | null = null
  for (const row of rows) {
    if (row.stageId !== null) staged += 1
    // BOTH halves, and neither alone. A clock with no expectation cannot be
    // late; an expectation with no clock has nothing to judge. `isAtRisk`
    // already answers false for either, and this is the count that says WHY.
    if (row.stallDays === null || row.daysInStage === null) continue
    measurable += 1
    if (longestDays === null || row.daysInStage > longestDays) longestDays = row.daysInStage
    if (row.atRisk) atRisk += 1
  }
  return {
    organizations: rows.length,
    staged,
    unstaged: rows.length - staged,
    measurable,
    longestDays,
    atRisk,
  }
}

/**
 * WHAT THE PAGE IS ALLOWED TO SAY about lateness, as a closed union.
 *
 * A union rather than a nullable number, because the four ways "nothing is late"
 * can be true are four different sentences and only one of them is the tile the
 * reader thinks they are looking at. Rendering any of the first four as `0`
 * would be a claim the workspace has not earned — see this file's header.
 */
export type LatenessVerdict =
  /** No live organizations at all. Day one. */
  | { kind: 'no-organizations' }
  /** Organizations exist; nobody has recorded a rung for any of them. */
  | { kind: 'no-stage'; organizations: number }
  /**
   * Rungs are recorded, but no rung anyone is standing on carries an expected
   * duration and there is no workspace floor — so nothing CAN be late. 0026
   * seeds it this way on purpose; the fix is an admin typing a number, not a
   * zero on a tile.
   */
  | { kind: 'no-expectation'; staged: number }
  /**
   * Measurable, and genuinely nothing is over yet. `longestDays` is the sentence
   * that makes it honest: "the longest anyone has stood anywhere is N days".
   */
  | { kind: 'too-early'; measurable: number; longestDays: number }
  /** A real, earned count. */
  | { kind: 'late'; atRisk: number; measurable: number }

export function latenessVerdict(r: StageReadiness): LatenessVerdict {
  if (r.organizations === 0) return { kind: 'no-organizations' }
  if (r.staged === 0) return { kind: 'no-stage', organizations: r.organizations }
  if (r.measurable === 0) return { kind: 'no-expectation', staged: r.staged }
  if (r.atRisk === 0) {
    // `longestDays` cannot be null once `measurable > 0` — the loop above sets
    // it on the same row that increments the counter — but it is narrowed rather
    // than asserted, and 0 is the honest fallback: everything arrived today.
    return { kind: 'too-early', measurable: r.measurable, longestDays: r.longestDays ?? 0 }
  }
  return { kind: 'late', atRisk: r.atRisk, measurable: r.measurable }
}

/* ══════════════════════════ risks & challenges ══════════════════════════ */

/**
 * The two entry types this section is about, in reading order.
 *
 * A SPLIT IN PRESENTATION ONLY. There is one table behind both — `entries` with
 * `type in ('issue','escalation')` — and the reason to show them apart is that
 * an escalation is somebody else's decision to make and an issue is ours. No
 * column, no migration and no third status distinguishes them; `EntryType`
 * already does.
 */
export const RISK_TYPES: readonly RiskType[] = Object.freeze(['issue', 'escalation'])
export type RiskType = Extract<EntryType, 'issue' | 'escalation'>

export function isRiskType(t: EntryType): t is RiskType {
  return t === 'issue' || t === 'escalation'
}

/**
 * The badge, DERIVED — never stored, never a column.
 *
 * ⚠ THERE IS NO IMPACT SCORE HERE AND THERE MUST NOT BE ONE. Priority is what a
 *   person judged and health is what the clock says; multiplying them into a
 *   single 1–25 number destroys both — nobody can act on "impact 12", and the
 *   two inputs have different fixes (re-prioritise vs. chase). This is a
 *   THREE-STOP READING of the pair the reader can already see in the row, so it
 *   adds emphasis and no information the row does not carry.
 */
export type RiskSeverity = 'severe' | 'elevated' | 'watch'

const SEVERITY_ORDER: Readonly<Record<RiskSeverity, number>> = {
  severe: 0,
  elevated: 1,
  watch: 2,
}

export function riskSeverity(priority: EntryPriority, health: HealthLevel): RiskSeverity {
  // `health: 'critical'` is the view's own escalation of an overdue CRITICAL
  // item (see v_entry_health), so either input alone reaching the top is the
  // top. Spelled as two tests rather than one because they are two facts.
  if (priority === 'critical' || health === 'critical') return 'severe'
  if (priority === 'high' && health === 'overdue') return 'severe'
  if (priority === 'high' || health === 'overdue') return 'elevated'
  if (priority === 'medium' && health === 'stale') return 'elevated'
  return 'watch'
}

export interface RiskRow {
  entry: Entry
  severity: RiskSeverity
  health: HealthLevel
  /** `blocked` or `waiting_on` — someone else owes us something. */
  waiting: boolean
  /** Whole calendar days since it was raised. */
  daysOpen: number
}

/**
 * Open issues and open escalations, worst first, one list each.
 *
 * CLOSED ROWS ARE NEVER HERE. `v_entry_health` has no row for a done entry and
 * "what is going wrong" is not a question about finished work — the same rule
 * `bucketFollowUps` opens with, and for the same reason.
 *
 * A MISSING HEALTH ROW READS 'ok' rather than a fifth "unknown" level, exactly
 * as `lib/aggregate.healthOf` and `model.levelOf` decide it: the view has not
 * answered for an optimistic or offline row, and inventing an unknown badge
 * would put a grey pill on every capture for the 300 ms before the fetch lands.
 */
export function bucketRisks(
  entries: readonly Entry[],
  health: ReadonlyMap<string, EntryHealth>,
  today: IsoDate,
): Record<RiskType, RiskRow[]> {
  const out: Record<RiskType, RiskRow[]> = { issue: [], escalation: [] }
  for (const entry of entries) {
    if (!isRiskType(entry.type)) continue
    if (!isOpen(entry.status)) continue
    const level = health.get(entry.id)?.health ?? 'ok'
    out[entry.type].push({
      entry,
      severity: riskSeverity(entry.priority, level),
      health: level,
      waiting: entry.status === 'blocked' || entry.status === 'waiting_on',
      daysOpen: Math.max(0, diffDays(instantToIsoDate(entry.created_at), today)),
    })
  }
  for (const list of Object.values(out)) list.sort(compareRisk)
  return out
}

/** Severity, then oldest, then id — so two equal rows never swap on a render. */
function compareRisk(a: RiskRow, b: RiskRow): number {
  const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
  if (bySeverity !== 0) return bySeverity
  if (a.daysOpen !== b.daysOpen) return b.daysOpen - a.daysOpen
  return a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0
}
