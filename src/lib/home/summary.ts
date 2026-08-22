// THE ONE QUESTION THE APP OPENS ON: how much of the capability set is live.
//
// ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
//
// The workspace holds 104 organizations, 406 capability links and a seven-rung
// ladder. Everything else it can compute — follow-up buckets, the board, the
// numbers page — is about ENTRIES, of which the live workspace holds ten. The
// owner named the question this screen must answer before anything else, and
// this is the arithmetic behind it and nothing more.
//
// ── WHAT IT IS NOT ────────────────────────────────────────────────────────
//
// It is NOT `useCaseProgress` (lib/mapNodes.ts) with extra steps, and it does
// not replace it. That function answers "how far has this ORGANIZATION got",
// counting links at the terminal status against the whole catalogue — a
// numerator and a denominator for one place. This one answers "how far has the
// PROGRAMME got", which needs the three statuses kept apart: a capability with
// twenty links in testing and none live is a completely different sentence from
// one with twenty planned, and `done / total` renders both as zero.
//
// ── THE HONESTY RULE, RESTATED FOR THIS SCREEN ────────────────────────────
//
// Two zeroes mean different things and this file refuses to conflate them:
//
//   `recorded === 0`   nobody has said anything about this capability
//   `live === 0`       people have said things, none of them "live"
//
// So `CapabilityRow` carries `recorded` beside the three counts, and
// `ProgrammeSummary` carries `unstaged` beside the ladder. A renderer that
// prints "0" for the first case is printing a measurement nobody took.
//
// ⚠ AND THE DENOMINATOR IS THE RECORDED SCOPE, NOT THE CATALOGUE. `live` over
//   `links` says "of everything anyone has committed to, this much is live".
//   `live` over `organizations × capabilities` would say something else — that
//   every organization owes every capability — which is false: the median
//   organization records four of the ten, and the owner's own Jira never
//   claimed otherwise. The larger denominator would make the programme look
//   permanently 8% done and would be an artefact of this file, not a fact.
//
// No React, no stores, no clock: `today` arrives as an argument, exactly as
// lib/pmo/summary.ts takes it, so every number here is a pure function of its
// inputs and a test can pin a date.

import type {
  MapNode,
  MapNodeProgress,
  MapNodeStage,
  MapNodeUseCase,
  UseCase,
  UseCaseStatus,
} from '../../types'

/** One capability, across every organization that recorded it. */
export interface CapabilityRow {
  useCase: UseCase
  planned: number
  testing: number
  live: number
  /**
   * Organizations that recorded ANY status for this capability — the row's own
   * denominator, and the number that separates "nobody has said" from "said,
   * and none of it is live". Always `planned + testing + live`.
   */
  recorded: number
}

/** One rung of the ladder, and how many organizations stand on it. */
export interface StageRow {
  stage: MapNodeStage
  count: number
}

export interface ProgrammeSummary {
  /** Organizations in scope — the population every other number is about. */
  organizations: number
  /** …of which this many have a stage recorded. */
  staged: number
  /** …and this many do not. Reported, never rendered as a rung. */
  unstaged: number
  /** Every capability link across those organizations. The denominator. */
  links: number
  live: number
  testing: number
  planned: number
  /** In catalogue order. Capabilities nobody recorded are present with zeroes. */
  capabilities: CapabilityRow[]
  /** In ladder order. Rungs nobody stands on are present with `count: 0`. */
  stages: StageRow[]
}

export interface ProgrammeInput {
  /** The organizations the summary is about — already filtered by the caller. */
  nodes: readonly MapNode[]
  /**
   * The FULL catalogue including hidden rows, for the reason `useCaseProgress`
   * states: a retired capability an organization is still recorded against has
   * to keep its row, or its links vanish from the numerator and the denominator
   * at once and the total silently shrinks.
   */
  catalogue: readonly UseCase[]
  links: readonly MapNodeUseCase[]
  /** The ladder, in `sort_order`. Hidden rungs are kept — see `stages` below. */
  stages: readonly MapNodeStage[]
  /**
   * An ITERABLE rather than an array, because `store/config` holds this as a
   * `Map<nodeId, MapNodeProgress>` and `stageOverlay.mergeProgress` returns
   * one. Taking the iterable lets a caller pass `.values()` without copying a
   * hundred rows into a fresh array on every render.
   */
  progress: Iterable<MapNodeProgress>
}

const EMPTY_COUNTS: Readonly<Record<UseCaseStatus, number>> = Object.freeze({
  planned: 0,
  testing: 0,
  live: 0,
})

/**
 * Fold the workspace into the numbers the home screen reads.
 *
 * ONE PASS PER INPUT and no nested scans: at 104 nodes × 406 links this is not
 * a performance question yet, but the page re-renders on every store tick and
 * the shape below is the one that stays cheap when the map reaches 400
 * organizations, which the owner has said it will.
 */
export function programmeSummary(input: ProgrammeInput): ProgrammeSummary {
  const { nodes, catalogue, links, stages, progress } = input

  // THE POPULATION, INDEXED FIRST. Every other loop tests membership against
  // it, so a link or a stage record naming an organization outside the scope —
  // an archived one, or one under a different root — is dropped rather than
  // counted into a denominator nobody can see.
  const inScope = new Set<string>()
  for (const node of nodes) inScope.add(node.id)

  // ── capabilities ────────────────────────────────────────────────────────
  //
  // By id, first occurrence wins. A caller that concatenated the visible list
  // and the full one would otherwise render every capability twice and double
  // every total — the same trap `useCaseProgress` documents.
  const onTable = new Map<string, UseCase>()
  for (const useCase of catalogue) {
    if (!onTable.has(useCase.id)) onTable.set(useCase.id, useCase)
  }

  const counts = new Map<string, Record<UseCaseStatus, number>>()
  let live = 0
  let testing = 0
  let planned = 0
  let counted = 0

  for (const link of links) {
    if (!inScope.has(link.node_id)) continue
    // A link naming a capability that is not in the catalogue at all is counted
    // in NEITHER the row nor the totals: it has no name to render, so a row for
    // it would be a blank line. `use_cases` is `on delete restrict` from this
    // join, so the only way to produce one is a partial catalogue.
    if (!onTable.has(link.use_case_id)) continue

    let row = counts.get(link.use_case_id)
    if (row === undefined) {
      row = { ...EMPTY_COUNTS }
      counts.set(link.use_case_id, row)
    }
    row[link.status] += 1
    counted += 1
    if (link.status === 'live') live += 1
    else if (link.status === 'testing') testing += 1
    else planned += 1
  }

  const capabilities: CapabilityRow[] = []
  for (const useCase of onTable.values()) {
    const row = counts.get(useCase.id) ?? EMPTY_COUNTS
    capabilities.push({
      useCase,
      planned: row.planned,
      testing: row.testing,
      live: row.live,
      recorded: row.planned + row.testing + row.live,
    })
  }
  capabilities.sort(byOrderThenName)

  // ── the ladder ──────────────────────────────────────────────────────────
  //
  // ⚠ HIDDEN RUNGS ARE KEPT, and this is the same argument as the hidden
  //   capability above. `map_node_stages.hidden` means "leaves the pickers",
  //   NOT "un-stages the organizations already standing on it" — the column's
  //   own contract in types.ts says so. Dropping a hidden rung here would take
  //   its organizations off the ladder without moving them anywhere, and the
  //   counts would stop summing to `staged`.
  const stageCount = new Map<string, number>()
  let staged = 0
  for (const record of progress) {
    if (!inScope.has(record.node_id)) continue
    if (record.stage_id === null) continue
    stageCount.set(record.stage_id, (stageCount.get(record.stage_id) ?? 0) + 1)
    staged += 1
  }

  const ladder = [...stages].sort((a, b) => a.sort_order - b.sort_order)
  const stageRows: StageRow[] = ladder.map((stage) => ({
    stage,
    count: stageCount.get(stage.id) ?? 0,
  }))

  return {
    organizations: inScope.size,
    staged,
    unstaged: inScope.size - staged,
    links: counted,
    live,
    testing,
    planned,
    capabilities,
    stages: stageRows,
  }
}

/**
 * Catalogue order, with a total tie-break.
 *
 * `sort_order` is an admin-typed integer and nothing stops two rows sharing
 * one. Falling through to the name and then the id makes the list STABLE —
 * without it two capabilities on the same order would swap places between
 * renders, which reads as the screen flickering for no reason.
 */
function byOrderThenName(a: CapabilityRow, b: CapabilityRow): number {
  if (a.useCase.sort_order !== b.useCase.sort_order) {
    return a.useCase.sort_order - b.useCase.sort_order
  }
  const byName = a.useCase.name.localeCompare(b.useCase.name)
  return byName !== 0 ? byName : a.useCase.id.localeCompare(b.useCase.id)
}

/** One organization that changed rung, most recent first. */
export interface RecentMove {
  nodeId: string
  stageId: string
  /** ISO instant, straight from `stage_changed_at`. */
  changedAt: string
  /** Whole days between `changedAt` and `now`, floored. 0 means today. */
  daysAgo: number
}

/**
 * What moved lately — the difference between a snapshot and progress.
 *
 * ⚠ THIS READS A COLUMN NO CLIENT MAY WRITE. `stage_changed_at` is stamped by
 *   `map_node_progress_stage_stamp()` and a value sent by a client is OVERRULED
 *   rather than rejected (types.ts). So it is trustworthy — but it is stamped
 *   on EVERY change including an import, which is why the home screen must say
 *   what the dates mean rather than implying a year of history. Every one of
 *   the 104 organizations was stamped on the day the Jira import ran; until
 *   somebody moves one by hand, this list is that import and nothing else.
 *
 * `now` is an argument for the reason the whole file takes `today` as one: a
 * function that read the clock could not be pinned by a test, and "3 days ago"
 * is exactly the kind of number that is wrong for one day a year and nobody
 * notices.
 */
export function recentMoves(
  progress: Iterable<MapNodeProgress>,
  nodes: readonly MapNode[],
  now: Date,
  limit = 8,
): RecentMove[] {
  const inScope = new Set<string>()
  for (const node of nodes) inScope.add(node.id)

  const out: RecentMove[] = []
  for (const record of progress) {
    if (!inScope.has(record.node_id)) continue
    if (record.stage_id === null || record.stage_changed_at === null) continue
    const at = Date.parse(record.stage_changed_at)
    // A row whose timestamp will not parse is dropped rather than sorted to one
    // end: NaN compares false against everything and would land it wherever the
    // sort happened to leave it, which is worse than absent.
    if (!Number.isFinite(at)) continue
    out.push({
      nodeId: record.node_id,
      stageId: record.stage_id,
      changedAt: record.stage_changed_at,
      daysAgo: Math.max(0, Math.floor((now.getTime() - at) / 86_400_000)),
    })
  }

  out.sort((a, b) => {
    const byDate = Date.parse(b.changedAt) - Date.parse(a.changedAt)
    // Total, for the same stability reason as the capability sort: an import
    // stamps a hundred rows within the same second.
    return byDate !== 0 ? byDate : a.nodeId.localeCompare(b.nodeId)
  })
  return out.slice(0, limit)
}
