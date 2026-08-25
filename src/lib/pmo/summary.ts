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
import { goalProgress, type GoalProgress, type StageIndex } from '../mapNodes'
import { diffDays, instantToIsoDate, type IsoDate } from '../dates'
import type {
  Entry,
  EntryHealth,
  EntryPriority,
  EntryType,
  HealthLevel,
  MapNode,
  MapNodeGoal,
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
  /** The rung stops the clock — `map_node_stages.terminal`, never the name "Live". */
  terminal: boolean
  /** The rung stops the clock for the other reason — `map_node_stages.paused`. */
  paused: boolean
  /**
   * The CALENDAR DAY this organization's stage clock was started, or null when
   * there is none.
   *
   * ⚠ CARRIED FOR ONE PURPOSE AND IT IS NOT A COLUMN: `stageReadiness` compares
   *   these across the workspace to answer whether every clock was started at
   *   the same moment, which is the fingerprint of a bulk import rather than of
   *   fieldwork. See `StageReadiness.clockStartedTogether`.
   */
  stageStartedOn: IsoDate | null
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
    const changedAt = input.progressById.get(node.id)?.stage_changed_at ?? null
    rows.push({
      nodeId: node.id,
      name: input.labelOf(node),
      trackId: node.track_id,
      stageId: reading.stage?.id ?? null,
      stageOrder: reading.stage?.sort_order ?? null,
      daysInStage: reading.days,
      stallDays: reading.stallDays,
      atRisk: reading.atRisk,
      terminal: reading.stage?.terminal ?? false,
      paused: reading.stage?.paused ?? false,
      stageStartedOn: changedAt === null ? null : instantToIsoDate(changedAt),
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
  /**
   * ⚠ THE DAY EVERY MEASURABLE ORGANIZATION'S STAGE CLOCK WAS STARTED, when
   *   they were all started on the SAME day. Null when they differ, and null
   *   when fewer than two organizations are measurable.
   *
   * THIS IS THE HONESTY GATE'S SECOND HALF AND IT EXISTS BECAUSE OF THIS
   * WORKSPACE. `map_node_progress.stage_changed_at` is written only by
   * `map_node_progress_stage_stamp()`, so an IMPORT that seeds fifty
   * organizations onto seven different rungs stamps all fifty with one `now()`.
   * The arithmetic downstream is then internally perfect and the INPUT is what
   * lies: two days after that import every organization the import put on UAT
   * (`expected_days` 2) satisfies `days > threshold`, the verdict flips to
   * `'late'`, and the count a director reads measures DAYS SINCE THE IMPORT RAN
   * rather than time on a rung — false in both directions at once, since an
   * organization that had genuinely sat on UAT for six months reads as two days
   * old, and one placed there yesterday reads as late.
   *
   * NO THRESHOLD IS INVENTED HERE and none is needed: fieldwork does not move
   * two organizations onto rungs at the same instant, let alone fifty, so "every
   * measurable clock names one day" is the fingerprint itself. Two is the
   * smallest population for which "together" means anything, which is why it is
   * the floor rather than a number somebody chose.
   *
   * IT IS A CAVEAT, NOT A SUPPRESSION. The count stays — it is a true statement
   * about what is recorded — and the page is required to print the day beside
   * it, so the reader knows what the clock is measured from. Nothing in this
   * file words that sentence; see `pmo.lateOneClock`.
   */
  clockStartedTogether: IsoDate | null
  /**
   * Rows whose RUNG carries a time budget, and rows whose CLOCK a person
   * started. `measurable` is the intersection, and until now it was the only
   * count — which made two very different silences indistinguishable.
   *
   * ⚠ THE PAGE SAID THE WRONG THING BECAUSE OF IT. With `expected_days` set on
   *   four rungs and every stage clock written by an import, `measurable` fell
   *   to zero and the card printed "no stage has been given a time yet — go and
   *   set one". The times were already set. The reader is told to do something
   *   they have done, and the thing actually missing is never named.
   *
   * Two counters, because "nobody said how long" and "nobody started a clock"
   * have different fixes: one is an admin setting a number, the other is an
   * account manager moving an organization onto a rung.
   */
  withExpectation: number
  withClock: number
}

export function stageReadiness(rows: readonly DeliveryRow[]): StageReadiness {
  let staged = 0
  let measurable = 0
  let withExpectation = 0
  let withClock = 0
  let atRisk = 0
  let longestDays: number | null = null
  // `undefined` = no measurable row seen yet; `null` = two rows disagreed, and
  // the question is settled for good. Two states, not one, because a null start
  // day on a measurable row is itself a disagreement with a real one.
  let sharedDay: IsoDate | null | undefined = undefined
  for (const row of rows) {
    if (row.stageId !== null) staged += 1
    // BOTH halves, and neither alone. A clock with no expectation cannot be
    // late; an expectation with no clock has nothing to judge. `isAtRisk`
    // already answers false for either, and this is the count that says WHY.
    if (row.stallDays !== null) withExpectation += 1
    if (row.daysInStage !== null) withClock += 1
    if (row.stallDays === null || row.daysInStage === null) continue
    measurable += 1
    if (longestDays === null || row.daysInStage > longestDays) longestDays = row.daysInStage
    if (row.atRisk) atRisk += 1
    if (sharedDay === undefined) sharedDay = row.stageStartedOn
    else if (sharedDay !== row.stageStartedOn) sharedDay = null
  }
  return {
    organizations: rows.length,
    staged,
    unstaged: rows.length - staged,
    measurable,
    longestDays,
    atRisk,
    clockStartedTogether: measurable >= 2 ? (sharedDay ?? null) : null,
    withExpectation,
    withClock,
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
   * The rungs DO carry times, and not one organization has a clock a person
   * started — so there is nothing to measure against them.
   *
   * ⚠ SEPARATED FROM `no-expectation` BECAUSE THE ADVICE IS OPPOSITE. That arm
   *   sends the reader to the catalogue to set a number. Here the numbers are
   *   set and the reader would find nothing to do, which is the most corrosive
   *   thing a page can say. What is missing is somebody putting an organization
   *   on a rung: `portfolio/fields.ts` discards a stage clock whose progress row
   *   records no author, because such a stamp is the moment an import ran.
   */
  | { kind: 'no-clock'; staged: number; withExpectation: number }
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
  if (r.measurable === 0) {
    // Which of the two halves is missing decides which sentence is true. Both
    // missing reads as `no-expectation`, because setting the times is the step
    // that comes first and a reader given two errands does neither.
    return r.withExpectation > 0
      ? { kind: 'no-clock', staged: r.staged, withExpectation: r.withExpectation }
      : { kind: 'no-expectation', staged: r.staged }
  }
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

/* ══════════════════════════ project cards ══════════════════════════ */

/**
 * WHAT ONE ORGANIZATION'S CARD IS ALLOWED TO SAY, as a closed union.
 *
 * `LatenessVerdict`'s shape one scale down, and for its reason: a pill is a
 * claim, and each of these five is a DIFFERENT claim that happens to look alike
 * at a glance. A nullable boolean would collapse "nobody has said where this is"
 * into "it is not late", which is the exact error the whole file exists to stop.
 *
 * EVERY ARM DERIVES FROM A CONFIGURED INPUT — the recorded rung, that rung's own
 * `terminal`/`paused` columns, and `atRisk`, which `stageReading` only ever sets
 * true when an expectation exists. That is what makes a status pill legal here
 * where a percentage would not be.
 *
 * `terminal` AND `paused` COME FROM THE COLUMNS, NEVER FROM THE NAME "Live". An
 * admin renames that rung in Settings › Structure — or an Arabic reader sees
 * `name_ar` — and the reading must not change.
 */
export type ProjectStatus = 'not-staged' | 'done' | 'paused' | 'late' | 'in-progress'

/**
 * The arm order IS the statement of which fact wins, and it is defensive by
 * design: `stageReading` already stops the clock on a terminal or paused rung,
 * so `terminal && atRisk` is unreachable through the real fold. Spelling the
 * precedence out anyway means a future edit to the clock cannot silently start
 * printing "Late" on a finished organization.
 */
export function projectStatus(row: {
  stageId: string | null
  terminal: boolean
  paused: boolean
  atRisk: boolean
}): ProjectStatus {
  if (row.stageId === null) return 'not-staged'
  if (row.terminal) return 'done'
  if (row.paused) return 'paused'
  if (row.atRisk) return 'late'
  return 'in-progress'
}

/* ══════════════════════════ initiatives ══════════════════════════ */

/**
 * One commitment, as the PMO reads it.
 *
 * AN INITIATIVE IS A `map_node_goals` ROW, and that is a decision of record
 * rather than a mapping of convenience. It is the only thing in this schema that
 * is date-bounded, owned, scoped to a department and MEASURABLE against recorded
 * progress — which is the whole of what an initiative is on the source document.
 * Nothing else in the schema can be measured without inventing a denominator.
 */
export interface InitiativeRow {
  /** `map_node_goals.id` — the React key and the sort's final tiebreak. */
  goalId: string
  /** The department the promise is about. What `?node=` narrows to. */
  nodeId: string
  /** That department's name, already resolved for the locale by the caller. */
  nodeName: string
  /** The goal's own label, resolved for the locale — never `''`; see `goalLabelOf`. */
  label: string
  /**
   * The rung the goal names, or null for "a terminal stage". NOT the rung's
   * NAME: 0027's meaning of a count goal is "this stage or beyond", which is a
   * `sort_order` comparison, and a name would invite one done in words.
   */
  stageId: string | null
  /** The count the goal asks for, or null for a date goal about the node itself. */
  target: number | null
  /** `date`, never a timestamp, and NEVER NULL — 0027 makes the column `not null`. */
  targetDate: IsoDate
  /** `goalProgress` — the SAME function the org panel reads. */
  progress: GoalProgress
}

export interface InitiativeInput {
  goals: readonly MapNodeGoal[]
  /** Every node this client holds — the population and the parent chain both. */
  nodes: readonly MapNode[]
  stages: StageIndex
  today: IsoDate
  /** A node's name resolved for the locale — the page's `nodeLabel`. */
  labelOf: (node: MapNode) => string
  /** The goal's label resolved for the locale, with the unnamed fallback applied. */
  goalLabelOf: (goal: MapNodeGoal) => string
}

/**
 * One row per live commitment, SOONEST TROUBLE FIRST.
 *
 * `goalProgress` IS IMPORTED, NEVER RESTATED. The org panel already renders how
 * far a commitment has got, and two folds of the same promise would agree until
 * the day the ladder was reordered — 0027's own comment says reordering the
 * stages RESTATES every count goal, and one function is the only shape under
 * which both surfaces restate it together.
 *
 * A GOAL ON AN ARCHIVED NODE IS SKIPPED, `buildDeliveryRows`' rule: a promise
 * about a department somebody put away is not being delivered. A goal whose node
 * this client does not hold is skipped too — there is nothing to name it after,
 * and a row reading "the goal due 31/12" against no department is a row a
 * director cannot act on.
 */
export function buildInitiativeRows(input: InitiativeInput): InitiativeRow[] {
  const byId = new Map<string, MapNode>()
  for (const node of input.nodes) byId.set(node.id, node)

  // ONE children index for the whole fold. A `nodes.filter(n => n.parent_id ===
  // id)` inside the per-goal walk is the O(n²) that makes four hundred
  // organizations feel broken, and `progressByNode`'s header names the same trap
  // one module over.
  const childrenOf = new Map<string, MapNode[]>()
  for (const node of input.nodes) {
    if (node.parent_id === null) continue
    const held = childrenOf.get(node.parent_id)
    if (held === undefined) childrenOf.set(node.parent_id, [node])
    else held.push(node)
  }

  const rows: InitiativeRow[] = []
  for (const goal of input.goals) {
    const node = byId.get(goal.node_id)
    if (node === undefined || node.archived) continue
    rows.push({
      goalId: goal.id,
      nodeId: node.id,
      nodeName: input.labelOf(node),
      label: input.goalLabelOf(goal),
      stageId: goal.stage_id,
      target: goal.target,
      targetDate: goal.target_date,
      progress: goalProgress(goal, node, descendantsOf(node.id, childrenOf), input.stages, input.today),
    })
  }
  rows.sort(compareInitiative)
  return rows
}

/**
 * Every descendant at any depth.
 *
 * The `visited` set is not defensive tidiness: `map_nodes.parent_id` is a plain
 * self-reference with no cycle constraint, so one bad row would otherwise hang
 * the render loop of a page a director opens every morning.
 */
function descendantsOf(rootId: string, childrenOf: ReadonlyMap<string, MapNode[]>): MapNode[] {
  const out: MapNode[] = []
  const visited = new Set<string>([rootId])
  const stack = [...(childrenOf.get(rootId) ?? [])]
  while (stack.length > 0) {
    const node = stack.pop()
    if (node === undefined) continue
    if (visited.has(node.id)) continue
    visited.add(node.id)
    out.push(node)
    for (const child of childrenOf.get(node.id) ?? []) stack.push(child)
  }
  return out
}

/** Overdue first, then soonest, then by label in CODE POINT order, then by id. */
function compareInitiative(a: InitiativeRow, b: InitiativeRow): number {
  const aLate = a.progress.daysLeft < 0 && !a.progress.met
  const bLate = b.progress.daysLeft < 0 && !b.progress.met
  if (aLate !== bLate) return aLate ? -1 : 1
  if (a.progress.daysLeft !== b.progress.daysLeft) return a.progress.daysLeft - b.progress.daysLeft
  // Code point, never localeCompare — `compareDelivery`'s reason: the order has
  // to be identical in the test runner and in the browser.
  if (a.label !== b.label) return a.label < b.label ? -1 : 1
  return a.goalId < b.goalId ? -1 : a.goalId > b.goalId ? 1 : 0
}

/* ══════════════════════════ the action register ══════════════════════════ */

/**
 * One open action, as the register lists it.
 *
 * ⚠ THERE IS NO PERCENT COLUMN AND THERE MUST NOT BE ONE. The source document's
 *   task list carries a completion percentage per task; `entries` has no such
 *   column, no subtask table stands behind one, and a percent derived from the
 *   status word would be this page inventing a scale — "in progress = 50%" is a
 *   number nobody typed. Status and days-since-raised replace it, and both are
 *   recorded facts.
 *
 * ⚠ AND THE DAY COUNT IS DAYS SINCE IT WAS RAISED, NOT DAYS IN ITS STATUS. That
 *   is a correction rather than a simplification. `daysInStatus` reads the
 *   thread's transition rows and falls back to `created_at` when they are not
 *   loaded — and on a dashboard they are NEVER loaded, because threads load
 *   lazily per sheet. `created_at` is the EARLIEST possible start of the current
 *   status, so the fallback is a CEILING: an action raised thirty days ago and
 *   moved to `blocked` yesterday would print 30 under a caption reading "In
 *   status", when the truth is 1. lib/aggregate.ts states the direction in its
 *   own words — the fallback "overstates only an item that was blocked long
 *   after it was raised". So the column says what the number is, and it is the
 *   same `daysOpen` under the same `pmo.colRaised` caption the risk tables one
 *   section down already print.
 */
export interface ActionRow {
  entry: Entry
  /** A MISSING HEALTH ROW READS `'ok'` — `bucketRisks`' rule and `healthOf`'s. */
  health: HealthLevel
  /** Past a date somebody committed to. `bucketFollowUps`' own predicate; see below. */
  overdue: boolean
  /** Whole calendar days since it was raised. Never a claim about its status. */
  daysOpen: number
}

/**
 * Every OPEN action, worst first.
 *
 * THE REGISTER IS THE RECORD AND THE BUCKETS BENEATH IT ARE TRIAGE. Before this
 * existed, an action that was on track, assigned and not due soon appeared
 * NOWHERE on this page: the six follow-up buckets only take what needs chasing
 * and the two risk tables read `issue` and `escalation` alone. A director cannot
 * review a workstream from a list of only its problems.
 *
 * `overdue` MIRRORS `bucketFollowUps` EXACTLY, health-first, and that is not an
 * optimisation. The register and the overdue bucket sit in one section on one
 * page; two definitions of "overdue" between them is, in lib/entrySections.ts's
 * own words, "the single most corrosive kind of bug this product can have".
 * `isPast` is a private one-line comparison there, so the comparison is restated
 * here with the name of its owner rather than by exporting a shared file for two
 * `<` signs — and `buildActionRows` is tested against `bucketFollowUps` on one
 * fixture so the two cannot drift apart in silence.
 */
export function buildActionRows(
  entries: readonly Entry[],
  health: ReadonlyMap<string, EntryHealth>,
  today: IsoDate,
): ActionRow[] {
  const rows: ActionRow[] = []
  for (const entry of entries) {
    if (entry.type !== 'action') continue
    if (!isOpen(entry.status)) continue
    const h = health.get(entry.id)
    // The view is authoritative when it has spoken; the local comparison is for
    // an optimistic or offline row it has no answer for yet.
    const dueLapsed = h !== undefined ? h.days_overdue > 0 : isPast(entry.due_date, today)
    const followLapsed = isPast(entry.follow_up_date, today)
    rows.push({
      entry,
      health: h?.health ?? 'ok',
      overdue: dueLapsed || followLapsed,
      daysOpen: Math.max(0, diffDays(instantToIsoDate(entry.created_at), today)),
    })
  }
  rows.sort(compareAction)
  return rows
}

/** ISO dates compare correctly as strings — lib/entrySections.ts's `isPast`. */
function isPast(date: string | null, today: IsoDate): boolean {
  return date !== null && date < today
}

/** Overdue first, then soonest due (NULLS LAST), then quietest, then id. */
function compareAction(a: ActionRow, b: ActionRow): number {
  if (a.overdue !== b.overdue) return a.overdue ? -1 : 1
  const aDue = a.entry.due_date
  const bDue = b.entry.due_date
  if (aDue !== bDue) {
    // "Nobody promised a day" is not "due at the end of time", so it sorts last
    // inside its group rather than floating to the top of a soonest-first list.
    if (aDue === null) return 1
    if (bDue === null) return -1
    return aDue < bDue ? -1 : 1
  }
  // Quietest first: of two items due the same day, the one nobody has touched is
  // the one a review is for.
  if (a.entry.last_activity_at !== b.entry.last_activity_at) {
    return a.entry.last_activity_at < b.entry.last_activity_at ? -1 : 1
  }
  return a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0
}
