// THE ONE FIELD SET — what every surface shows about one map node, as VALUES.
//
// Three surfaces answer the same question about an organization and each of them
// answers it in its own vocabulary: the map card says "Riyadh General, 4 open, 68
// days in stage" as one accessible SENTENCE, the portfolio table says it as nine
// CAPTIONED COLUMNS with an em-dash where nothing is recorded, and the org panel
// says it as a `<dl>` whose empty value is `mapnode.notRecorded` paired with an
// `.sr-only` word. Those are three different pieces of writing about one set of
// numbers, and the numbers are the only part that can be shared without one
// surface deciding how another one reads.
//
// SO NOTHING IN THIS FILE IS A RESOLVED STRING, and the rule has teeth rather
// than being a preference. `MindNodeView.label` is already clipped to the
// layout's inline budget before it reaches a card, which no other surface can
// know or undo; `PortfolioRow.stageName` is a caption resolved through the
// reader's locale for a column header that exists only on the table; and the
// panel's dash is a component, not a character. A shared type carrying any of
// them would hand one surface's editorial decision to two surfaces that never
// agreed to it. Values here, formatters there.
//
// ── ONE ARITHMETIC, FOUR CALLERS ───────────────────────────────────────────
//
// `stageReading` was private to lib/portfolio/rows.ts and shared by its two
// exports, on the argument that the chip's badge and the table's rows must be
// ONE number rather than two that agree most of the time. That argument does not
// weaken as it scales — it is the whole reason this file exists. The callers are
// now the table (`buildPortfolioRows`), the badge (`countAtRisk`), the map's
// stats walk (`collectStats`, which puts the days on the card's spoken name and
// the roll-up on the panel) and the org panel's own triad (`MapBranchDetail`).
// Four surfaces, one function, and "do they all show the same number" answers
// "always" rather than "usually".
//
// PURE, and it must stay so: nothing under lib may import a store or the api
// layer, and this module imports only its siblings and the shared types — the
// grep that enforces the rule must find nothing here, prose included. The
// optimistic stage overlay, which every one of those four callers merges in
// before asking, is a store's business and lives there; what arrives here is
// already-merged progress rows, which is why the input takes a map, not a hook.
//
// ── NULL IS NOT ZERO, ANYWHERE ─────────────────────────────────────────────
//
// `stageId` null means nobody has said where this organization is. `daysInStage`
// null means the same. `quietDays` null means nothing has ever been filed under
// it. Each is a DIFFERENT fact from a zero, and each surface renders it as its
// own kind of absence — MindtreeTable's EM_DASH note, carried onto the values so
// that no formatter has to invent the distinction for itself.

import { diffDays, instantToIsoDate, type IsoDate, type IsoInstant } from '../dates'
import { daysInStage, isAtRisk, resolveStallDays } from '../lifecycle'
import type { StageIndex, UseCaseProgress } from '../mapNodes'
import type { MapNodeProgress, MapNodeStage } from '../../types'

/* ══════════════════════════ the field set ══════════════════════════ */

/**
 * Everything the map card, the portfolio row and the org panel each say about
 * ONE map node — as values, in one shape, with no words in it.
 *
 * `PortfolioRow` EXTENDS THIS rather than the two being kept in step by hand:
 * the table already was the values-plus-formatter design, so the shared set is
 * extracted from it and `tsc` proves the shapes identical on every build. The
 * walk's `NodeStats` picks the four members it can answer for.
 */
export interface NodeFields {
  /** `map_nodes.id` — what `filterForOrgRow` narrows to. */
  nodeId: string
  /** The rung, or null when nobody has said. */
  stageId: string | null
  /**
   * The rung's `sort_order`, or null when there is none — THE STAGE COLUMN'S
   * SORT KEY, and the reason the name is never it. Sorting the process
   * alphabetically puts "Go-live ready" before "Kickoff"; the ladder's own order
   * is the one a reader means by "sort by stage", in either language.
   */
  stageOrder: number | null
  /** Whole calendar days on this rung, or null when nothing is recorded. */
  daysInStage: number | null
  /** `daysInStage > expected_days`, with terminal and paused stopping the clock. */
  atRisk: boolean
  /** The rung's own expectation after the coalesce chain, or null when unset. */
  stallDays: number | null
  /**
   * The INHERITED account manager — nearest self-or-ancestor, off the SAME walk
   * the entries store runs for the filter (`FilterContext.managerOfNode`).
   * `null` is "nobody, anywhere up the chain", which is a fact `MANAGER_NONE`
   * can ask for and a raw column read cannot.
   */
  managerId: string | null
  /** The INHERITED vendor, same walk and same rule. `''` is "not recorded". */
  vendor: string
  /** That vendor folded, so 'Acme' and 'acme ' are one cohort. `''` when blank. */
  vendorFold: string
  /** `useCaseProgress`, this organization alone. Null while nobody has looked. */
  progress: UseCaseProgress | null
  /** Open items AT OR UNDER this node, after the filter — OFF THE NODE. */
  open: number
  /** Days since anything under it was last touched, or null when nothing is. */
  quietDays: number | null
}

/* ══════════════════════════ the stage clock ══════════════════════════ */

/** The four facts `stageReading` cannot know, all of them injected. */
export interface StageReadingInput {
  /** `stageIndex(mergedProgress, stageById)` — the two-step, done once. */
  stages: StageIndex
  /** node id → its progress row, for `stage_changed_at`. `undefined` = no row. */
  progressById: ReadonlyMap<string, Pick<MapNodeProgress, 'stage_changed_at'>>
  /**
   * A workspace-wide floor under the per-rung expectation, or null for none.
   * An ARGUMENT rather than a constant for `resolveStallDays`' stated reason: a
   * policy number belongs at the call site that owns the policy.
   */
  fallbackStallDays: number | null
  /** The reader's instant, for lib/lifecycle's day arithmetic. No clock here. */
  now: Date
}

/**
 * The stage reading for ONE node — the three facts every surface needs and the
 * one place they are computed.
 *
 * EXPORTED, AND SHARED BY FOUR CALLERS, which is the whole reason it exists.
 * `buildPortfolioRows` fills a table, `countAtRisk` fills the chip's badge,
 * `collectStats` puts the days on the map card's spoken name and the roll-up on
 * the org panel, and `MapBranchDetail` prints the triad beside the rung control.
 * The gate's own yes/no question is whether all four show the SAME number, and
 * one function is the only shape under which the answer is "always" rather than
 * "usually" — four copies of this expression would agree until the day one of
 * them was edited.
 */
export function stageReading(
  nodeId: string,
  input: StageReadingInput,
): { stage: MapNodeStage | null; days: number | null; stallDays: number | null; atRisk: boolean } {
  const stage = input.stages.ofNode(nodeId)
  const changedAt: IsoInstant | null = input.progressById.get(nodeId)?.stage_changed_at ?? null
  const days = daysInStage(changedAt, input.now)
  const stallDays = resolveStallDays(stage, input.fallbackStallDays)
  // The clock stops on a rung the ladder cannot resolve too: `terminal: false,
  // paused: false` is the honest reading of "no rung", and `isAtRisk` already
  // answers false whenever `days` or `stallDays` is null, which is every such
  // node. Spelled out rather than left to that coincidence.
  const clock = stage === null ? { terminal: false, paused: false } : stage
  return { stage, days, stallDays, atRisk: isAtRisk(days, stallDays, clock) }
}

/* ══════════════════════════ the quiet clock ══════════════════════════ */

/**
 * Days of silence one entry contributes.
 *
 * CLAMPED AT 0 for `daysInStage`'s reason: a `last_activity_at` a few seconds
 * ahead of the reader's clock is "just now", not "-1 days quiet".
 */
export function quietLeafDays(lastActivityAt: IsoInstant, today: IsoDate): number {
  return Math.max(0, diffDays(instantToIsoDate(lastActivityAt), today))
}

/**
 * Null-propagating minimum — `null` is "nothing filed", never zero.
 *
 * The whole quiet arithmetic is this operator applied post-order, and it is
 * written once here because both walks that fold it (the table's and the map's)
 * have to agree that an empty organization stays empty rather than becoming a
 * zero the moment it acquires a childless child.
 */
export function minQuiet(a: number | null, b: number | null): number | null {
  if (a === null) return b
  if (b === null) return a
  return a < b ? a : b
}

/* ══════════════════════════ the walk's roll-up ══════════════════════════ */

/**
 * What the map's post-order pass carries for every node — the three counts the
 * model does not carry, plus the four shared fields the walk can answer for.
 *
 * ⚠ THE TWO CLOCKS HAVE DIFFERENT SCOPES AND THE DIFFERENCE IS NOT AN OVERSIGHT.
 *
 *   The STAGE TRIAD (`daysInStage`, `atRisk`, `stallDays`) is a `map_nodes`-keyed
 *   fact: it is populated on ENTITY nodes and null/false everywhere else. A
 *   track is not standing on a rung, a status bucket is not standing on a rung,
 *   and a cohort ring is a picture of a rung rather than a thing that is on one.
 *   Rolling a stage clock up a tree would have to invent an aggregate — the
 *   worst? the median? — that nobody asked for and no column prints.
 *
 *   `quietDays` GENUINELY ROLLS UP, because silence is a property of what is
 *   filed beneath a node and everything beneath a node is beneath its ancestors
 *   too. It is the MINIMUM over the subtree's entry leaves, through folds and
 *   collapsed branches alike — a number that changed when somebody clicked a
 *   branch open would be reporting the picture rather than the workspace — and
 *   `null` rather than 0 where nothing has ever been filed.
 */
export interface NodeStats
  extends Pick<NodeFields, 'daysInStage' | 'atRisk' | 'stallDays' | 'quietDays'> {
  breached: number
  unassigned: number
  /**
   * HOW MANY ORGANIZATIONS SIT AT OR BELOW THIS NODE — and it is NOT `count`.
   *
   * `MindNode.count` is the open WORK beneath a node (entries plus subtree), and
   * model.ts computes it that way for every structural node including a cohort,
   * which is what keeps the partition invariant non-tautological. A cohort's own
   * sentence needs the other number: "Stage: Integrating, 14 organizations" is a
   * fact about the ring's MEMBERS, and reading `count` for it would announce the
   * issue backlog as if it were the book.
   *
   * Counted in the walk rather than in a second pass because that pass already
   * visits every node once and already exists for exactly this reason — two
   * arithmetics over one tree is two answers that disagree under the conditions
   * nobody tests.
   */
  orgs: number
}

/** Nothing known about a node the walk has no row for. Every absence spelled. */
export const NO_STATS: NodeStats = Object.freeze({
  breached: 0,
  unassigned: 0,
  orgs: 0,
  daysInStage: null,
  atRisk: false,
  stallDays: null,
  quietDays: null,
})
