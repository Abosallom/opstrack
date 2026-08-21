// THE PORTFOLIO, AS ROWS — four hundred organizations, one per line, off the
// SAME MindNode tree the map draws.
//
// PURE, ON MindtreeTable's contract and lib/mapNodes.ts's: no store, no api, no
// clock, no React. `today` and `now` arrive as arguments, the tree arrives
// built, and every lookup this needs is handed in as a map. That is what makes
// "is Riyadh General stalled, and by how long" answerable in a test at a fixed
// instant rather than only on a machine whose wall clock is in the right week.
//
// ── THE SAME TREE, NOT A SECOND WALK OVER map_nodes ────────────────────────
//
// It would be one line shorter to iterate `store/config`'s `mapNodes` array and
// never touch the tree at all. It would also be a second arithmetic path to the
// same screen, and MindtreeTable.tsx's header already paid for that lesson: the
// picture and the ledger must carry the SAME numbers or the toggle changes the
// answer. `count` in particular is read OFF THE NODE — it is what the canvas
// drew, after the reader's filter — and re-walking the entries here would give a
// different number under every filter that narrows.
//
// model.ts draws structural nodes WHETHER OR NOT THEY ARE POPULATED, which is
// what makes an exception list possible at all: an organization with nothing
// open still has a node, so it still gets a row, so "who has recorded nothing"
// is answerable. An archived organization that still holds work is drawn and
// marked, and `retired` accumulates down the path exactly as `buildTableRows`
// accumulates `pathRetired`.
//
// ── entityIdOf, NEVER bucketKey ALONE ──────────────────────────────────────
//
// `bucketKey` is a track id on a track node, a status key on a group node and a
// map-node id on an entity — indistinguishable by shape, which is why model.ts
// publishes `kind` beside it and why lib/mapNodes.ts publishes `entityIdOf`.
// One row per `kind === 'entity'` node, resolved through that function, and
// nothing here reads `bucketKey` directly.
//
// ── ONE RULE DECIDES WHETHER THE READER SEES ORGANIZATIONS OR BUCKETS ──────
//
// `?by=` names the grouping and `?risk=1` is the exception cut, and between them
// they answer BOTH shapes with no third parameter and no local mode:
//
//   the ROLL-UP    one row per stage / per account manager / per vendor / per
//                  phase — count, median days in stage, at risk, open, progress.
//                  That is column density, and it is the bottleneck reading.
//   the ROWS       one row per organization.
//
// `portfolioShowsRows(view, filter)` is the single expression of the rule: the
// reader sees ORGANIZATIONS when they asked the exception question (`risk=1` —
// an exception list is a list of organizations, by definition) or when they have
// already narrowed to a set of them (`mapNodeIds` non-empty — they asked about
// these organizations, so here they are). Otherwise they see the roll-up. Both
// halves are in the URL, so every reading this screen can show is a link
// somebody can paste, and the drill from a bucket to its members is one write to
// `mapNodeIds` — `filterForCell`'s shape, one level up.
//
// ── TWO CLOCKS, TWO COLUMNS, NEVER ONE SCORE ───────────────────────────────
//
// `daysInStage` measures how long an organization has stood where it is;
// `quietDays` measures SILENCE since anything under it was last touched. They
// are different questions with different fixes and lib/health.ts already keeps
// the same pair apart ("Staleness measures SILENCE… the SLA measures ELAPSED
// TIME"). A composite risk score would destroy both and nobody could act on it.
// `atRisk` is `daysInStage > threshold` and NOTHING ELSE — lib/lifecycle.ts owns
// that arithmetic, including the terminal/paused clock stop.
//
// ── NULL IS NOT ZERO, ANYWHERE ON THIS TABLE ───────────────────────────────
//
// `stage` null means nobody has said where this organization is. `daysInStage`
// null means the same. `quietDays` null means nothing has ever been filed under
// it. Each renders as an em-dash and each is a DIFFERENT fact from a zero —
// MindtreeTable's EM_DASH note ("'no items' and 'zero of them are late' are
// different facts") applied to three more columns.

import { diffDays, instantToIsoDate, type IsoDate, type IsoInstant } from '../dates'
import { MANAGER_NONE, type FilterState } from '../entryFilter'
import { daysInStage, isAtRisk, resolveStallDays } from '../lifecycle'
import { entityIdOf, type StageIndex, type UseCaseProgress } from '../mapNodes'
import type { PortfolioBy } from '../mindtree/lens'
import type { MindNode } from '../mindtree/model'
import { normalizeSearch } from '../text'
import type { Entry, MapNode, MapNodeProgress, MapNodeStage } from '../../types'

/* ══════════════════════════ the controls ══════════════════════════ */

/**
 * The portfolio's two controls, as this module reads them.
 *
 * STRUCTURAL, AND DECLARED HERE RATHER THAN IMPORTED FROM THE URL LAYER.
 * `MapUrlPortfolio` in pages/map/useMapUrl.ts is the same two fields and
 * satisfies this by construction, but that module reads the address bar and
 * lib/** may not depend on a page — the same layering rule that keeps
 * `GoalTerms` structural one module over. `PortfolioBy` itself IS imported,
 * from lib/mindtree/lens.ts, because a closed union with two spellings is two
 * unions: the chips, the palette's links, the URL codec and this fold all have
 * to agree about what `?by=` can say, and lens.ts is the pure module none of
 * them can avoid.
 */
export interface PortfolioView {
  by: PortfolioBy
  /** The exception cut: show only what is past its stage's expectation. */
  risk: boolean
}

/**
 * Organizations, or buckets? The one rule, in one expression. See the header.
 *
 * It takes the FILTER as well as the view because "the reader has already
 * narrowed to a set of organizations" is a fact only the filter carries, and
 * splitting the rule across the two call sites is how the roll-up and the drill
 * come to disagree about which one is on screen.
 */
export function portfolioShowsRows(
  view: PortfolioView,
  filter: Pick<FilterState, 'mapNodeIds'>,
): boolean {
  return view.risk || filter.mapNodeIds.length > 0
}

/* ══════════════════════════ the rows ══════════════════════════ */

/** One organization. Every column the table draws, already resolved. */
export interface PortfolioRow {
  /** The map-node id, and the React key. Unique by construction. */
  key: string
  /** Position in the TREE's walk, so every sort has a total tiebreak and the
   *  third header click can restore the order the picture is drawn in. */
  order: number
  /** `map_nodes.id` — what `filterForOrgRow` narrows to. */
  nodeId: string
  /** The organization's own name, resolved for the locale by the caller. */
  name: string
  /**
   * The trail ABOVE it, one resolved label per step, track first. Kept as PARTS
   * rather than one string because the renderer isolates each component
   * separately — useMapModel's `trail()` recipe: the separator is the locale's
   * own comma and belongs to the row's direction, not to either label.
   */
  trailParts: readonly string[]
  /** Those parts joined with `mindtree.listSep` and NO isolates — the sort key. */
  trailLabel: string
  /** ANY step of the path is archived, or this node is. Rendered, never dropped. */
  retired: boolean
  /** The deepest STRUCTURAL ancestor's map-node id — the Phase. Null under a track. */
  parentId: string | null
  /** That ancestor's resolved label, or '' when there is none. */
  parentName: string
  /** The rung, or null when nobody has said. */
  stageId: string | null
  /** The rung's name in this locale, or null. Never compared against; a caption. */
  stageName: string | null
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
  managerId: string | null
  /** Through the roster, never as stored text. Null renders the em-dash. */
  managerName: string | null
  /** The EFFECTIVE vendor — nearest self-or-ancestor. `''` is "not recorded". */
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

/** Everything the builder needs and cannot know. All of it injected. */
export interface PortfolioInput {
  /** The SAME tree the map draws — `buildMindtree()`'s root. */
  root: MindNode
  /** `store/config`'s `useMapNodeMap()` — for vendor, manager and archived. */
  nodeById: ReadonlyMap<string, MapNode>
  /** `stageIndex(progressByNodeId, stageById)` — the two-step, done once. */
  stages: StageIndex
  /** node id → its progress row, for `stage_changed_at`. `undefined` = no row. */
  progressById: ReadonlyMap<string, Pick<MapNodeProgress, 'stage_changed_at'>>
  /**
   * A workspace-wide floor under the per-rung expectation, or null for none.
   * An ARGUMENT rather than a constant for `resolveStallDays`' stated reason: a
   * policy number belongs at the call site that owns the policy.
   */
  fallbackStallDays: number | null
  /** A node's label, already resolved for the locale — `useMapModel.textOf`. */
  labelOf: (node: MindNode) => string
  /**
   * `t('mindtree.listSep')` — the locale's own comma, injected rather than read.
   * This module is pure of `t()` for lib/mapNodes.ts's stated reason, and the
   * separator is the one piece of locale text a path needs. It is the SAME key
   * `buildTableRows` joins with, so the picture, the ledger and this table
   * punctuate one path identically in both languages.
   */
  listSep: string
  /** A rung's name in this locale — `useStageLabel()`. */
  stageNameOf: (stage: MapNodeStage) => string
  /** A teammate's name through the roster, or null — `managerLabel`. */
  managerNameOf: (id: string | null) => string | null
  /**
   * node id → the effective vendor, `''` when nobody has recorded one.
   * `FilterContext.vendorOfNode`, which store/entries builds in the same walk
   * that builds the ancestry — so the picker, the filter and this table fold one
   * vendor identically.
   */
  vendorOfNode: ReadonlyMap<string, string>
  /** `useCaseProgress` per node — `progressByNode`. Null while nobody has looked. */
  progressByNode: ReadonlyMap<string, UseCaseProgress> | null
  /** `useEntryMap()`. Read for `last_activity_at` and for nothing else. */
  entryById: ReadonlyMap<string, Entry>
  /** `useFilterContext().today` — this module holds no clock. */
  today: IsoDate
  /** The same instant as `today`, as a Date, for lib/lifecycle's day arithmetic. */
  now: Date
}

/**
 * The stage reading for ONE node — the three facts every caller of this module
 * needs and the one place they are computed.
 *
 * PRIVATE, AND SHARED BY THE TWO EXPORTS, which is the whole reason it exists:
 * `buildPortfolioRows` fills a table and `countAtRisk` fills a chip badge, and
 * the gate's own yes/no question is whether those two numbers are the same. Two
 * copies of this expression would answer that question "usually".
 */
function stageReading(
  nodeId: string,
  input: Pick<PortfolioInput, 'stages' | 'progressById' | 'fallbackStallDays' | 'now'>,
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

/**
 * Days since anything under this node was last touched, or null when nothing is.
 *
 * The whole subtree, collapsed branches and "+N more" tails included —
 * `collectStats`' rule and its reason: a table that only counted what the
 * picture happened to be showing would report a different silence every time
 * somebody clicked a branch.
 *
 * NULL, NEVER ZERO, FOR AN EMPTY ORGANIZATION. "nothing has ever been filed
 * here" and "something was touched today" are different facts and the column
 * must not print them alike.
 */
function quietDaysUnder(
  node: MindNode,
  entryById: ReadonlyMap<string, Entry>,
  today: IsoDate,
): number | null {
  let quietest: number | null = null
  const walk = (n: MindNode): void => {
    if (n.kind === 'entry') {
      const entry = n.entryId === null ? undefined : entryById.get(n.entryId)
      if (entry === undefined) return
      // Clamped at 0 for `daysInStage`'s reason: a `last_activity_at` a few
      // seconds ahead of the reader's clock is "just now", not "-1 days quiet".
      const days = Math.max(0, diffDays(instantToIsoDate(entry.last_activity_at), today))
      if (quietest === null || days < quietest) quietest = days
      return
    }
    for (const child of n.children) walk(child)
  }
  walk(node)
  return quietest
}

/**
 * One row per entity node in the tree, in the tree's own walk order.
 *
 * ZERO-COUNT ORGANIZATIONS ARE INCLUDED and that is the point of an exception
 * list — the organization nobody has filed anything against is precisely the one
 * an account manager is employed to notice. ARCHIVED ones are included and
 * MARKED, on `buildTableRows`' rule: hiding an option must never hide data.
 *
 * The exception cut is NOT applied here. `risk` narrows a population and this
 * function builds one; `portfolioRowsFor` composes the two so that the roll-up
 * and the rows can be cut by the same expression rather than by two.
 */
export function buildPortfolioRows(input: PortfolioInput): PortfolioRow[] {
  const rows: PortfolioRow[] = []

  const walk = (
    node: MindNode,
    parts: readonly string[],
    parent: { id: string | null; name: string },
    retired: boolean,
  ): void => {
    for (const child of node.children) {
      // Entries, groups and "+N more" are not organizations and hold none.
      if (child.kind === 'entry' || child.kind === 'group' || child.kind === 'more') continue

      const label = input.labelOf(child)
      const mark = retired || child.retired
      const nodeId = entityIdOf(child)

      if (nodeId !== null) {
        const record = input.nodeById.get(nodeId)
        const reading = stageReading(nodeId, input)
        const vendor = input.vendorOfNode.get(nodeId) ?? record?.vendor ?? ''
        rows.push({
          key: nodeId,
          order: rows.length,
          nodeId,
          name: label,
          trailParts: parts,
          // A blank step is dropped rather than rendered as a stray comma —
          // `buildTableRows` filters for the same reason, and doing it once
          // keeps the sort key and the visible cell agreeing about how many
          // steps the path has.
          trailLabel: parts.filter((part) => part !== '').join(input.listSep),
          retired: mark,
          parentId: parent.id,
          parentName: parent.name,
          stageId: reading.stage?.id ?? null,
          stageName: reading.stage === null ? null : input.stageNameOf(reading.stage),
          stageOrder: reading.stage?.sort_order ?? null,
          daysInStage: reading.days,
          atRisk: reading.atRisk,
          stallDays: reading.stallDays,
          managerId: record?.account_manager_id ?? null,
          managerName: input.managerNameOf(record?.account_manager_id ?? null),
          vendor,
          vendorFold: normalizeSearch(vendor.trim()),
          progress: input.progressByNode?.get(nodeId) ?? null,
          // OFF THE NODE, never re-walked: `count` is what the picture drew,
          // and the two must be the same number or the toggle changes the
          // answer (MindtreeTable's rule).
          open: child.count,
          quietDays: quietDaysUnder(child, input.entryById, input.today),
        })
      }

      // RECURSE THROUGH IT REGARDLESS. The hierarchy is arbitrary-depth (0023):
      // an Organization can hold Organizations, and a two-level walk would drop
      // every one of them off the table while the picture beside it kept
      // drawing them. `buildTableRows` recurses for the identical reason.
      walk(
        child,
        [...parts, label],
        nodeId === null ? parent : { id: nodeId, name: label },
        mark,
      )
    }
  }

  walk(input.root, [], { id: null, name: '' }, input.root.retired)
  return rows
}

/* ══════════════════════ the filter, over ORGANIZATIONS ══════════════════ */
//
// ⚠ THE FILTER DOES NOT NARROW THIS TABLE BY ITSELF, AND THAT IS THE WHOLE
//   REASON THIS SECTION EXISTS.
//
// `FilterState` narrows ENTRIES. The tree this table is built from does not
// narrow with it: lib/mindtree/model.ts draws a track and an organization
// WHETHER OR NOT THEY ARE POPULATED, on purpose and in its own words — "an Org
// that vanished when its last item closed would answer 'which Org has nothing on
// it' by looking identical to an Org nobody ever configured". That rule is right
// and it is what makes a zero-count organization a row here at all.
//
// Its consequence for a table whose ROWS are organizations is that a filter
// naming a set of organizations changes only the `open` and `quiet` columns:
// every other organization stays on screen with a zero beside it. So
// `?manager=<me>` showed all four hundred rather than one account manager's
// eighty; the trail drill wrote `mapNodeIds:[org]` and left the other 399 in
// place; and `portfolioShowsRows` — whose premise is "the reader has already
// narrowed to a set of organizations" — was reading a fact nothing acted on.
//
// THE NARROWING IS THEREFORE EXPLICIT, HERE, AND IT IS ONE PREDICATE. The rows,
// the roll-up they fold into, the footer's totals and the CHIP'S BADGE all pass
// through `inPortfolioScope`, so the four cannot disagree about which
// organizations the reader is looking at — the same argument that made
// `stageReading` private and shared.
//
// ONLY THE FACETS THAT NAME A PLACE. `mapNodeIds`, `managerIds` and `vendors`
// are facts about an ORGANIZATION and each names a set of them. `status`,
// `priority`, `owner`, `tag`, `health` and the date range are facts about ITEMS:
// they belong in the `open` column, which counts the work the filter admits, and
// applying them to the row list would delete organizations for having no
// matching work — which is the one thing an exception list must never do.
// `trackIds` is left out for a second reason as well: a row does not carry its
// track, and `filterForOrgRow` clears the facet rather than fighting it.

/** The organization-level facets, plus the maps that resolve them. */
export interface PortfolioScope {
  /** `FilterState.mapNodeIds` — matched against the node AND its ancestors. */
  mapNodeIds: readonly string[]
  /** `FilterState.managerIds`, `MANAGER_NONE` included. */
  managerIds: readonly string[]
  /** `FilterState.vendors`, folded here rather than by the caller. */
  vendors: readonly string[]
  /** `FilterContext.ancestryOfNode` — self first, then up. */
  ancestryOfNode: ReadonlyMap<string, readonly string[]>
  /** `FilterContext.managerOfNode` — nearest self-or-ancestor, `null` for none. */
  managerOfNode: ReadonlyMap<string, string | null>
  /** `FilterContext.vendorOfNode` — nearest self-or-ancestor, `''` for none. */
  vendorOfNode: ReadonlyMap<string, string>
}

/** Nothing narrowed — every organization is in scope. */
export const PORTFOLIO_SCOPE_ALL: PortfolioScope = Object.freeze({
  mapNodeIds: Object.freeze([]),
  managerIds: Object.freeze([]),
  vendors: Object.freeze([]),
  ancestryOfNode: new Map<string, readonly string[]>(),
  managerOfNode: new Map<string, string | null>(),
  vendorOfNode: new Map<string, string>(),
})

/**
 * Is this organization one of the ones the reader has narrowed to?
 *
 * EACH CLAUSE IS lib/entryFilter's, VERB FOR VERB, because the two must answer
 * alike about one organization or the row and the work filed under it describe
 * different workspaces:
 *
 *  · `mapNodeIds` matches on the ANCESTRY, so narrowing to a Phase keeps every
 *    organization inside it — the same reading that makes `branch` reach its
 *    descendants. An absent chain matches nothing, which is that file's strict
 *    absent-map rule: a stale id from a pasted link is not "everything".
 *  · `managerIds` reads the INHERITED manager and maps `null` onto
 *    `MANAGER_NONE`, which is the only way "which organizations has nobody been
 *    given" is askable. `undefined` — a node this context has no answer for —
 *    matches nothing, and is a different fact from `null`.
 *  · `vendors` folds both sides, and a BLANK VENDOR ANSWERS NO VENDOR FILTER:
 *    "not recorded" is the absence of an integrator rather than a twelfth one.
 *
 * The vendor fold is passed in rather than resolved here so the row's own
 * `vendorFold` — which the sort and the `by=vendor` roll-up already agree on —
 * is the value that is matched, with no second expression to drift from.
 */
export function inPortfolioScope(
  nodeId: string,
  vendorFold: string,
  scope: PortfolioScope,
): boolean {
  if (scope.mapNodeIds.length > 0) {
    const chain = scope.ancestryOfNode.get(nodeId)
    if (chain === undefined || !chain.some((id) => scope.mapNodeIds.includes(id))) return false
  }
  if (scope.managerIds.length > 0) {
    const who = scope.managerOfNode.get(nodeId)
    if (who === undefined) return false
    if (!scope.managerIds.includes(who ?? MANAGER_NONE)) return false
  }
  if (scope.vendors.length > 0) {
    if (vendorFold === '') return false
    if (!scope.vendors.some((v) => normalizeSearch(v) === vendorFold)) return false
  }
  return true
}

/** The vendor fold for a node, as the scope's own maps give it — the badge's
 *  half of the pair above, where there is no built row to read it off. */
function scopeVendorFold(nodeId: string, scope: PortfolioScope): string {
  return normalizeSearch((scope.vendorOfNode.get(nodeId) ?? '').trim())
}

/**
 * The population one reading is about — the rows the reader has narrowed to,
 * cut by the exception if they asked for it.
 *
 * ONE EXPRESSION, TWO SHAPES. The roll-up counts these and the table lists
 * these, so "18 at risk" in a stage bucket and the 18 rows behind it cannot
 * disagree — which is the third of the gate's yes/no questions.
 *
 * SCOPE FIRST, THEN THE CUT, and the order is not arbitrary: "eleven of Sara's
 * eighty are stuck" is the sentence an account manager wants, and cutting before
 * narrowing would have counted the eleven out of four hundred.
 */
export function portfolioRowsFor(
  rows: readonly PortfolioRow[],
  view: PortfolioView,
  scope: PortfolioScope,
): PortfolioRow[] {
  const inScope = rows.filter((row) => inPortfolioScope(row.nodeId, row.vendorFold, scope))
  return view.risk ? inScope.filter((row) => row.atRisk) : inScope
}

/**
 * How many organizations are past their rung's expectation — the Portfolio
 * chip's badge, and E1's whole promise.
 *
 * IT IS THE SAME ARITHMETIC AS THE COLUMN, through `stageReading`, and the test
 * asserts it against `buildPortfolioRows(...).filter(r => r.atRisk).length`.
 * The badge and the list must be one number: a chip reading 18 over a list of 17
 * is the defect that teaches a reader to stop trusting the chip.
 *
 * It takes the tree rather than the built rows because the shell computes it on
 * EVERY lens, including the four that never build a portfolio row — this walk is
 * a tree traversal and two map lookups per organization, where the row builder
 * also resolves labels, folds vendors and walks every entry for the quiet column.
 *
 * IT NARROWS THE SAME WAY THE TABLE DOES, through the same `inPortfolioScope`.
 * A reader who has narrowed to one account manager's book is told how many of
 * THAT book is stuck — the number their screen is about — and the badge and the
 * row count stay one number rather than two that agree only when nothing is
 * filtered. Its vendor fold comes off the scope's own map, which is the map the
 * rows' `vendorFold` is built from.
 */
export function countAtRisk(
  root: MindNode,
  input: Pick<PortfolioInput, 'stages' | 'progressById' | 'fallbackStallDays' | 'now'> & {
    scope: PortfolioScope
  },
): number {
  let count = 0
  const walk = (node: MindNode): void => {
    for (const child of node.children) {
      if (child.kind === 'entry' || child.kind === 'group' || child.kind === 'more') continue
      const nodeId = entityIdOf(child)
      if (
        nodeId !== null &&
        inPortfolioScope(nodeId, scopeVendorFold(nodeId, input.scope), input.scope) &&
        stageReading(nodeId, input).atRisk
      ) {
        count += 1
      }
      walk(child)
    }
  }
  walk(root)
  return count
}

/* ══════════════════════════ the roll-up ══════════════════════════ */

/** One bucket — a rung, a person, an integrator or a phase. */
export interface PortfolioGroupRow {
  /** The bucket's key: a stage id, a manager id, a folded vendor, a node id, or
   *  `''` for the "nobody has said" bucket every grouping has one of. */
  key: string
  order: number
  /** The bucket's own name, resolved. `''` when it is the unnamed bucket, whose
   *  words belong to the component (they differ per grouping). */
  label: string
  /** True for the "no rung / no manager / not recorded / no phase" bucket. */
  unnamed: boolean
  /** The organizations in it — what `filterForBucket` narrows to. */
  nodeIds: readonly string[]
  orgs: number
  /** The MEDIAN days in stage, not the mean: one organization parked for 400
   *  days would otherwise report a whole cohort as stalled. Null when nobody in
   *  the bucket has a recorded rung. */
  medianDays: number | null
  atRisk: number
  open: number
  /** Summed capability progress across the bucket. Null while nobody has looked. */
  done: number | null
  total: number | null
  /**
   * THE "ONE FIX UNBLOCKS N" NUMBER — the largest count of this bucket's
   * organizations sitting on one NON-TERMINAL rung.
   *
   * It is a real column rather than a slogan: it is what turns a vendor cohort
   * into an action ("eleven of Acme's fifteen are stuck at Testing"). Terminal
   * rungs are excluded because "twelve of them are live" is not a blockage, and
   * the unstaged are excluded because they are not standing anywhere. 0 when
   * there is no such rung.
   */
  largestBlock: number
  /** The rung `largestBlock` counts, resolved, or '' when there is none. */
  largestBlockLabel: string
}

/** Which bucket a row belongs to under one grouping — key, label, unnamed. */
function bucketOf(
  row: PortfolioRow,
  by: PortfolioBy,
): { key: string; label: string; unnamed: boolean } {
  switch (by) {
    case 'stage':
      return row.stageId === null
        ? { key: '', label: '', unnamed: true }
        : { key: row.stageId, label: row.stageName ?? '', unnamed: false }
    case 'manager':
      return row.managerId === null
        ? { key: '', label: '', unnamed: true }
        : { key: row.managerId, label: row.managerName ?? '', unnamed: false }
    case 'vendor':
      // The FOLDED key and the FIRST SPELLING SEEN as the label — `VendorCohort`'s
      // rule, so 'Acme' and 'acme ' are one row and the row reads the way
      // somebody actually typed it.
      return row.vendorFold === ''
        ? { key: '', label: '', unnamed: true }
        : { key: row.vendorFold, label: row.vendor.trim(), unnamed: false }
    case 'phase':
      return row.parentId === null
        ? { key: '', label: '', unnamed: true }
        : { key: row.parentId, label: row.parentName, unnamed: false }
  }
}

/** The middle value, or the mean of the two middles. Sorted copy, so the caller's
 *  array is untouched. */
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid]
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

/**
 * The rows, folded into buckets — ONE PASS, and the buckets in the order the
 * ladder is in.
 *
 * THE UNNAMED BUCKET IS PINNED LAST, always and under every grouping.
 * `aggregate.loadPerOwner`'s stated reason: "it is a gap in the data, not a
 * person, and sorting it into the middle of a roster reads as a teammate." The
 * same sentence is true of a rung nobody has picked and an integrator nobody has
 * recorded.
 *
 * `stageOrder` seeds the stage grouping with EVERY RUNG, empty ones included, in
 * `sort_order` — `foldPortfolio`'s promise and its reason: "nobody is at
 * Testing/UAT" is a fact the ladder has to be able to show, and a missing row
 * would make it indistinguishable from a rung that does not exist. The other
 * three groupings have no such list to seed from, so they carry only the buckets
 * the data produces.
 */
export function rollUpPortfolio(
  rows: readonly PortfolioRow[],
  by: PortfolioBy,
  ladder: readonly MapNodeStage[],
  stageNameOf: (stage: MapNodeStage) => string,
): PortfolioGroupRow[] {
  interface Acc {
    key: string
    label: string
    unnamed: boolean
    nodeIds: string[]
    days: number[]
    atRisk: number
    open: number
    done: number
    total: number
    /** Non-terminal rung id → how many of this bucket's rows sit on it. */
    blocks: Map<string, number>
    /** Any row in the bucket had a progress reading at all. */
    measured: boolean
  }

  const byKey = new Map<string, Acc>()
  const fresh = (key: string, label: string, unnamed: boolean): Acc => ({
    key,
    label,
    unnamed,
    nodeIds: [],
    days: [],
    atRisk: 0,
    open: 0,
    done: 0,
    total: 0,
    blocks: new Map(),
    measured: false,
  })

  // Hidden rungs are seeded too: hiding a rung removes it from the pickers and
  // never un-stages the organizations standing on it, so a hidden rung holding
  // forty hospitals must still have a row. An EMPTY hidden rung is dropped
  // below, which is the picker's rule and this table's: a bucket with nothing
  // in it that nobody may pick is a line of zeroes with no action behind it.
  const seeded = new Set<string>()
  if (by === 'stage') {
    for (const stage of ladder) {
      byKey.set(stage.id, fresh(stage.id, stageNameOf(stage), false))
      if (stage.hidden) seeded.add(stage.id)
    }
  }

  const terminalIds = new Set<string>()
  for (const stage of ladder) if (stage.terminal) terminalIds.add(stage.id)

  for (const row of rows) {
    const bucket = bucketOf(row, by)
    let acc = byKey.get(bucket.key)
    if (acc === undefined) {
      acc = fresh(bucket.key, bucket.label, bucket.unnamed)
      byKey.set(bucket.key, acc)
    }
    seeded.delete(bucket.key)
    acc.nodeIds.push(row.nodeId)
    if (row.daysInStage !== null) acc.days.push(row.daysInStage)
    if (row.atRisk) acc.atRisk += 1
    acc.open += row.open
    if (row.progress !== null) {
      acc.measured = true
      acc.done += row.progress.done
      acc.total += row.progress.total
    }
    if (row.stageId !== null && !terminalIds.has(row.stageId)) {
      acc.blocks.set(row.stageId, (acc.blocks.get(row.stageId) ?? 0) + 1)
    }
  }

  const named: PortfolioGroupRow[] = []
  const unnamed: PortfolioGroupRow[] = []
  const stageName = new Map(ladder.map((stage) => [stage.id, stageNameOf(stage)]))

  for (const acc of byKey.values()) {
    // A hidden rung nobody stands on — see the seeding note.
    if (seeded.has(acc.key) && acc.nodeIds.length === 0) continue
    let largestBlock = 0
    let largestBlockLabel = ''
    for (const [stageId, count] of acc.blocks) {
      if (count <= largestBlock) continue
      largestBlock = count
      largestBlockLabel = stageName.get(stageId) ?? ''
    }
    const out: PortfolioGroupRow = {
      key: acc.key,
      order: 0,
      label: acc.label,
      unnamed: acc.unnamed,
      nodeIds: acc.nodeIds,
      orgs: acc.nodeIds.length,
      medianDays: median(acc.days),
      atRisk: acc.atRisk,
      open: acc.open,
      done: acc.measured ? acc.done : null,
      total: acc.measured ? acc.total : null,
      largestBlock,
      largestBlockLabel,
    }
    ;(acc.unnamed ? unnamed : named).push(out)
  }

  // Named buckets keep their insertion order — the ladder's `sort_order` for
  // stages, the tree's walk for everything else — and the unnamed one goes last.
  // `order` is stamped AFTER the concatenation so the third header click
  // restores exactly the order the reader first saw.
  const all = [...named, ...unnamed]
  all.forEach((row, i) => {
    row.order = i
  })
  return all
}

/* ══════════════════════════ drilling down ══════════════════════════ */

/**
 * The filter that shows exactly what one organization row counts.
 *
 * `filterForCell`'s shape, one table over, and handed straight to the shell's
 * `setFilter` — so a drilled portfolio is a URL somebody can paste.
 *
 * THE THREE FACETS IT CLEARS ARE THE ONES THAT WOULD FIGHT IT. `mapNodeIds`
 * names ONE organization; a `vendors` or `managerIds` facet already on the
 * filter can only narrow that one to nothing or leave it alone, so both are
 * noise on a row the reader has already picked by name — and a filter that
 * silently resolves to zero rows after a click reads as a broken click.
 * `trackIds` is cleared for the same reason one level up: the organization names
 * its own track by containment. Everything else the reader chose — the search,
 * the tags, the date range, the sort — survives, because those narrow WITHIN the
 * organization.
 */
export function filterForOrgRow(base: FilterState, row: PortfolioRow): FilterState {
  return {
    ...base,
    trackIds: [],
    mapNodeIds: [row.nodeId],
    vendors: [],
    managerIds: [],
  }
}

/**
 * The filter that shows exactly what one BUCKET counts — the roll-up's drill.
 *
 * IT WRITES THE ORGANIZATIONS, NOT THE BUCKET, and the two are different links
 * with different lifetimes. `?manager=<uuid>` would be the better URL for a book
 * and it is the account-manager facet's job; this function is the one drill that
 * works for all four groupings, including the two — vendor cohorts and phases —
 * whose membership the reader is looking at RIGHT NOW and wants to keep. It is
 * also why `nodeIds` is carried on the group row at all.
 *
 * ⚠ THE MEMBERSHIP IS FROZEN INTO THE LINK. `entryFilter.ts` argues against
 *   exactly this for a facet that has its own name — a link saved while Acme
 *   held eleven hospitals still reports on eleven after the twelfth arrives. It
 *   is the right trade HERE and only here: this is a drill from a reading the
 *   reader can see, not a saved view of a cohort, and the alternative for
 *   `by=phase` and `by=vendor` is a drill that cannot be expressed at all.
 */
export function filterForBucket(base: FilterState, row: PortfolioGroupRow): FilterState {
  return {
    ...base,
    trackIds: [],
    mapNodeIds: [...row.nodeIds],
    vendors: [],
    managerIds: [],
  }
}

/* ══════════════════════════ sorting ══════════════════════════ */

export type PortfolioSortColumn =
  | 'org'
  | 'stage'
  | 'days'
  | 'risk'
  | 'manager'
  | 'vendor'
  | 'progress'
  | 'open'
  | 'quiet'

export type PortfolioGroupSortColumn =
  | 'bucket'
  | 'orgs'
  | 'days'
  | 'risk'
  | 'block'
  | 'progress'
  | 'open'

/**
 * AN EMPTY CELL SORTS BELOW A ZERO IN BOTH DIRECTIONS — `ageValue`'s rule, and
 * the portfolio needs it on three columns rather than one.
 *
 * `-1` and not `Infinity`: "longest stuck first" is a descending sort and the
 * organizations nobody has staged must not open it. They are a REAL and
 * important list — "nobody has looked at these" — and they are reachable by
 * sorting the other way, which is what the third state of the header is for.
 */
function nullLow(value: number | null): number {
  return value ?? -1
}

/** The fraction, as a number, so `6 of 9` and `2 of 3` order sensibly. A row
 *  nobody has looked at sorts below `0 of 9`, on `nullLow`'s rule. */
function progressValue(row: PortfolioRow): number {
  if (row.progress === null || row.progress.total === 0) return -1
  return row.progress.done / row.progress.total
}

/**
 * THE PORTFOLIO EXPRESSES ITS OWN NULL RULE, which is why `tableSort` takes the
 * comparator instead of reading a value off the row by column key. Three of
 * these nine columns are nullable and the mindtree's single `age` special case
 * could not have carried them.
 *
 * Every text comparison ends on the ORGANIZATION NAME so two rows of one bucket
 * cannot shuffle under the reader's finger — `compareRows`' `pathLabel` →
 * `groupLabel` pairing, one table over.
 */
export function comparePortfolioRows(
  a: PortfolioRow,
  b: PortfolioRow,
  column: PortfolioSortColumn,
  compareText: (x: string, y: string) => number,
): number {
  switch (column) {
    case 'org':
      return compareText(a.name, b.name) || compareText(a.trailLabel, b.trailLabel)
    case 'stage':
      // BY THE LADDER, NOT BY THE NAME. Sorting the stage column alphabetically
      // would order "Go-live ready" before "Kickoff" and make the one column
      // whose order is the PROCESS read as a word list. Unstaged sorts below
      // every rung, on `nullLow`'s rule.
      return nullLow(a.stageOrder) - nullLow(b.stageOrder) || compareText(a.name, b.name)
    case 'days':
      return nullLow(a.daysInStage) - nullLow(b.daysInStage) || compareText(a.name, b.name)
    case 'risk':
      return (a.atRisk ? 1 : 0) - (b.atRisk ? 1 : 0) || nullLow(a.daysInStage) - nullLow(b.daysInStage)
    case 'manager':
      return compareText(a.managerName ?? '', b.managerName ?? '') || compareText(a.name, b.name)
    case 'vendor':
      return compareText(a.vendorFold, b.vendorFold) || compareText(a.name, b.name)
    case 'progress':
      return progressValue(a) - progressValue(b) || compareText(a.name, b.name)
    case 'open':
      return a.open - b.open || compareText(a.name, b.name)
    case 'quiet':
      return nullLow(a.quietDays) - nullLow(b.quietDays) || compareText(a.name, b.name)
  }
}

/** The roll-up's comparator. The unnamed bucket is NOT pinned under a sort: the
 *  reader asked for an order and pinning a row out of it would be the table
 *  disobeying the header they just clicked. It is pinned in the DEFAULT order,
 *  which the third click restores. */
export function comparePortfolioGroups(
  a: PortfolioGroupRow,
  b: PortfolioGroupRow,
  column: PortfolioGroupSortColumn,
  compareText: (x: string, y: string) => number,
): number {
  switch (column) {
    case 'bucket':
      return compareText(a.label, b.label)
    case 'orgs':
      return a.orgs - b.orgs
    case 'days':
      return nullLow(a.medianDays) - nullLow(b.medianDays)
    case 'risk':
      return a.atRisk - b.atRisk
    case 'block':
      return a.largestBlock - b.largestBlock
    case 'progress':
      return groupProgressValue(a) - groupProgressValue(b)
    case 'open':
      return a.open - b.open
  }
}

/** `progressValue`'s rule for a bucket: a total nobody has looked at, and a
 *  bucket whose denominator is genuinely zero, both sort below `0 of 9`. */
function groupProgressValue(row: PortfolioGroupRow): number {
  if (row.total === null || row.total === 0) return -1
  return (row.done ?? 0) / row.total
}
