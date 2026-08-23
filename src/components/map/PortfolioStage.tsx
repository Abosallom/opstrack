// THE PORTFOLIO — four hundred organizations, and the four questions an ops
// team asks about them, on one surface with two controls.
//
// IT IS A STAGE, NOT A PANEL. `lens.stage === 'portfolio'` replaces the canvas
// with this table exactly as `board` and `numbers` do, because the question is
// "where has EVERY organization got to" and no camera shows four hundred cards
// legibly. The branch panel still opens beside it — `subjectForLens('portfolio')`
// is byte-identical to `shape`'s arm — so a row tap opens the org panel this app
// already has and MOVES NOTHING on the map.
//
// ── TWO CONTROLS, FOUR QUESTIONS, AND BOTH IN THE URL ──────────────────────
//
//   ?by=    stage · manager · vendor · phase   what the rows are ABOUT
//   ?risk=  1 · 0                              the exception cut
//
// `?by=` RENDERS AS HUMAN CHIPS AND NEVER AS A DROPDOWN — budget E5, and the
// recipe is MapLensBar's exactly: `aria-pressed` toggle buttons in a labelled
// `role="group"`, not `role="radiogroup"` and not a `<select>`. A radio group
// takes the arrow keys away from everything inside it, and the reader is one Tab
// from a nine-column scroller that needs them. The chips read "Stage · Team ·
// Vendors · Progress" — words a person says, not the param values.
//
// The risk toggle's ACCESSIBLE NAME CARRIES THE COUNT as a counted sentence
// through the plural node and the visible badge is `aria-hidden` —
// MapLensBar's rule, for its reason: a badge rendered as bare text is announced
// as a number floating after the label.
//
// ── WHAT THE READER SEES WITH ZERO TAPS ────────────────────────────────────
//
// `by=stage&risk=1` is the default, so the chip's own state IS the morning
// answer (budget E1): every organization past its rung's expectation, sorted
// longest-stuck first, with no second interaction. The chip's badge is the same
// number as the row count — `countAtRisk` and `buildPortfolioRows` share
// `stageReading` in lib/portfolio/fields.ts precisely so those two cannot drift,
// and the map card and the org panel now read the same function for the same
// reason.
//
// ── THE STAGE IS EDITABLE FROM THE ROW, AND THAT REVERSES A v1 DECISION ────
//
// MapBranchDetail's header says the org panel is READ-ONLY in v1, and that
// decision stands for capability links. It is REVERSED FOR THE STAGE ALONE, on
// budgets E2 and E4: recording where an organization got to is an account
// manager's most frequent action, it is the one field 0026 made member-writable
// on purpose, and making them leave the list to do it is the whole cost the
// portfolio exists to remove. So: an inline `<select>` on the row, ONE TAP to
// open and one to choose, optimistic, NO confirm dialog, and an undo toast that
// writes the previous rung back — including "no rung", which is a value the
// select can hold and the write path can express.
//
// ⚠ AN UNDO THAT CANNOT RESTORE "NOBODY HAS SAID" IS NOT AN UNDO — and it now
//   can. `setNodeStage(id, null)` upserts `stage_id = null`, which is "somebody
//   looked and cleared it": a DIFFERENT fact from having no row at all (types.ts
//   states it twice, api/map.ts once more). Undoing the FIRST rung ever recorded
//   on an organization through that path landed it on "cleared" rather than back
//   on "never touched" — the two render identically as an em-dash, so nothing on
//   screen said so, and the difference is exactly the one the no-backfill
//   decision exists to keep: a `stage_changed_at` that does not exist versus one
//   that has been nulled, and an `updated_by` naming a person who never made a
//   claim.
//
//   So `undoStage` branches on ONE FACT CAPTURED IN THE TAP — did this node have
//   a progress row a moment before this write — and calls `deleteNodeProgress`
//   when it did not. `hadRow` is read from the store BEFORE the write, because
//   the write itself publishes a row and the answer is different by the time the
//   toast's button is pressed.
//
//   THE RETRACTION IS THE ONE PATH THAT STILL REFETCHES. `publishNodeProgress`
//   can publish a row; there is no `retractNodeProgress` to un-publish one, so
//   the delete falls back to `invalidateConfig()`. That is the heavy call this
//   file otherwise exists to avoid — and it is right here: undoing a first-ever
//   rung is a once-in-a-session act, not the forty-a-morning one, and a targeted
//   retraction in store/config would be a new export for a single caller. Named
//   in the handoff rather than hidden.
//
// ── THE OPTIMISTIC OVERLAY, AND WHY IT IS A MODULE AND NOT A useState ──────
//
// store/config.ts's `invalidateConfig()` is correct and heavy — it refetches all
// eight reads to publish one row the caller already holds — and its own header
// named this screen as the caller that would need better: "a targeted publisher
// is a small addition when a caller needs one." That publisher is
// `publishNodeProgress`, and this file is what asked for it: the write is
// confirmed by republishing THE ONE ROW THE DATABASE RETURNED, so forty stage
// changes down a list are forty small publishes rather than forty full reloads.
//
// The optimism still comes first, because even one round trip is a round trip
// the reader must not wait for. So the new rung is held in a module-level map
// with a `useSyncExternalStore` subscription — components/toast.tsx's shape and
// its stated reason: several surfaces need one answer and none of them is
// another's parent. That map is `store/stageOverlay.ts`, which is where it moved
// once the map's own stats walk became a third reader; this file keeps the half
// that writes it, because that half is the half that touches `api/map`. The
// table, the org panel and the canvas therefore agree the instant any one of
// them writes. Each entry RETIRES ITSELF the moment store/config reports the
// same rung — which the targeted publisher makes the very next render — so the
// overlay can never mask a stage a second account manager set; and an entry for
// a node the workspace no longer has is dropped outright, which is what empties
// it on sign-out.

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react'
import { Link } from 'react-router-dom'
import { deleteNodeProgress, setNodeStage } from '../../api/map'
import { EmptyState } from '../shared'
import { toast } from '../toast'
import { isolate } from '../../lib/bidi'
import { t, useLocale } from '../../lib/i18n'
import { useStageLabel } from '../../lib/labels'
import { progressByNode, stageIndex } from '../../lib/mapNodes'
import { PortfolioBars } from './PortfolioBars'
import { PortfolioCards } from './PortfolioCards'
import { PortfolioGrid } from './PortfolioGrid'
import {
  PORTFOLIO_AS_KEY,
  PORTFOLIO_ASES,
  PORTFOLIO_BY_KEY,
  PORTFOLIO_BYS,
  type PortfolioAs,
  type PortfolioBy,
} from '../../lib/mindtree/lens'
import type { MindNode } from '../../lib/mindtree/model'
import {
  ariaSort,
  compareText,
  nextSort,
  sortRows,
  type SortableColumn,
  type TableSort,
} from '../../lib/mindtree/tableSort'
import { pooled } from '../../lib/pooled'
import {
  buildPortfolioRows,
  comparePortfolioGroups,
  comparePortfolioRows,
  countAtRisk,
  filterForBucket,
  filterForOrgRow,
  portfolioRowsFor,
  portfolioShowsRows,
  rollUpPortfolio,
  type PortfolioGroupRow,
  type PortfolioGroupSortColumn,
  type PortfolioRow,
  type PortfolioScope,
  type PortfolioSortColumn,
  type PortfolioView,
} from '../../lib/portfolio/rows'
import type { FilterContext, FilterState } from '../../lib/entryFilter'
import {
  invalidateConfig,
  publishNodeProgress,
  useAllUseCases,
  useMapNodeMap,
  useMapNodeStages,
  useNodeProgress,
  useStageMap,
} from '../../store/config'
import { useEntryMap, useFilterContext } from '../../store/entries'
import {
  dropPending,
  mergeProgress,
  readPendingStages,
  resolveStageId,
  setPending,
  usePendingStages,
} from '../../store/stageOverlay'
import { usePortfolioLinks, usePortfolioTruncated } from '../../store/portfolio'
import type { MapNodeProgress, MapNodeStage } from '../../types'
import './portfolio.css'

/** An empty cell. Never `0` — MindtreeTable's rule, and this table has four
 *  columns that can genuinely be empty rather than zero. */
const EM_DASH = '—'

/** The select's "no rung" option. Not a stage id, and it cannot collide with
 *  one: every real value is a uuid. */
const NO_STAGE = ''

/** The BULK select's "clear the rung" option. A second sentinel, because in the
 *  bulk bar `''` is already the idle PROMPT and "apply no rung to these forty"
 *  is a different instruction from "I have not chosen yet". */
const CLEAR_VALUE = 'clear'

/* ══════════════════ the optimistic overlay ══════════════════ */
//
// IT LIVES IN store/stageOverlay.ts NOW, and the split is by what each half
// touches rather than by what reads it. The PASSIVE half — the module-level map,
// its `useSyncExternalStore` view, `mergeProgress` and `resolveStageId` — moved,
// because `useMapModel`'s stats walk and the org panel's `<dl>` both have to see
// this tab's unconfirmed write or they clock a rung from the stamp it replaced.
// A page hook importing a component for its module state is the wrong direction;
// a store module importing nothing but React is the right one.
//
// The ACTIVE half stayed here, below, with the control that owns the decisions:
// `writeStage`, `retractStage`, `undoStage` and `useStageReconcile` all reach
// for `api/map` and `store/config`, which is exactly what a pure overlay must
// not, and which is why moving them would have bought nothing but a longer
// import graph.

/**
 * Record where one organization got to — optimistically, with no dialog.
 *
 * NOT AWAITED BY THE CALLER'S RENDER. The overlay is written synchronously
 * before the first await, so the cell shows the new rung in the same tap that
 * chose it; the round trip and the store refetch happen behind it.
 *
 * A FAILURE ROLLS BACK THE ONE ROW AND SAYS SO. It does not roll back a sibling
 * write from the same bulk run — MapBranch's `runBulk` settled that argument:
 * "discarding nine accepted writes because the tenth failed is worse than saying
 * which failed."
 */
async function writeStage(nodeId: string, stageId: string | null): Promise<boolean> {
  setPending(nodeId, stageId)
  const result = await setNodeStage(nodeId, stageId)
  if (!result.ok) {
    dropPending(nodeId)
    return false
  }
  /**
   * PUBLISH THE ONE ROW THE DATABASE WROTE, rather than refetching the
   * workspace to find it.
   *
   * This was `invalidateConfig()` at every call site, which store/config's own
   * header names as the wrong shape for exactly this caller: "a progress write
   * is the one high-frequency caller… routing every one of them through here
   * refetches all eight reads — up to 400 map nodes and a ~250KB cache write —
   * to publish one row the caller already has in hand." An account manager
   * moving forty organizations down the list fired forty of those.
   *
   * THE STORED ROW, NEVER THE INPUT: `setNodeStage` returns what the database
   * wrote, including the `stage_changed_at` the stamp trigger owns and no client
   * may send. Publishing the input would put a stamp on screen that a reload
   * would disagree with.
   *
   * The overlay is left in place regardless — `useStageReconcile` retires it the
   * moment the store reports the same rung, which this publish makes immediate
   * rather than a round trip away. Deleting it here would blank the cell in the
   * gap between the two, which is the flicker the optimism exists to avoid.
   */
  publishNodeProgress(result.data)
  return true
}

/**
 * Take the row away again — back to "nobody has said anything about this
 * organization", which is a state no `setNodeStage` call can express.
 *
 * THE OVERLAY IS SET TO `null` FIRST, exactly as `writeStage` does: "no row" and
 * "a row holding null" render as the same em-dash, so the optimistic cell is
 * already correct while the delete is in flight, and a failure puts the store's
 * row back under it.
 *
 * `invalidateConfig()` RATHER THAN A PUBLISH, and the header says why: there is
 * no row to hand to `publishNodeProgress` — the absence IS the result — and
 * store/config exports no retraction. The refetch is what makes
 * `useStageReconcile` retire the overlay, because only then does the store agree
 * that the rung is gone.
 */
async function retractStage(nodeId: string): Promise<boolean> {
  setPending(nodeId, null)
  const result = await deleteNodeProgress(nodeId)
  if (!result.ok) {
    dropPending(nodeId)
    return false
  }
  invalidateConfig()
  return true
}

/**
 * PUT IT BACK THE WAY IT WAS — the toast's button, and the one place the two
 * kinds of "before" are told apart.
 *
 * `hadRow` is the state of `map_node_progress` BEFORE the write being undone, as
 * read in the reader's own tap. False means this write created the row, so
 * undoing it must DELETE the row rather than write a null into it; true means
 * the row was already there and `previous` — including `null`, which is a real
 * value there — is what it held.
 *
 * EXPORTED SO THE BRANCH CAN BE PROVEN. `vitest.config.ts` is
 * `environment: 'node'` and this suite renders through `renderToStaticMarkup` —
 * there is no button to press and no effect to run, so a decision that lived
 * only inside the toast's `onClick` is a decision no test can reach.
 * `useChangesCount` and `runBulk` are exported from their own components for the
 * same reason: the mechanism is the thing that has to be checkable.
 */
export async function undoStage(
  nodeId: string,
  previous: string | null,
  hadRow: boolean,
): Promise<boolean> {
  return hadRow ? await writeStage(nodeId, previous) : await retractStage(nodeId)
}

/**
 * Retire overlay entries the store has caught up with, and entries for nodes the
 * workspace no longer has.
 *
 * THE SECOND HALF IS THE SIGN-OUT PATH. store/config empties on sign-out, so an
 * entry whose node has left is not an optimistic value any more — it is the
 * previous account's, and it would be rendered over the next one's table.
 */
function useStageReconcile(
  progress: ReadonlyMap<string, Pick<MapNodeProgress, 'stage_id'>>,
  nodeById: ReadonlyMap<string, unknown>,
): void {
  useEffect(() => {
    const pending = readPendingStages()
    if (pending.size === 0) return
    // Collected before anything is dropped: `dropPending` publishes, and a
    // publish while the map it was read from is still being iterated is the
    // shape a future listener could re-enter this effect through.
    const settled: string[] = []
    for (const [nodeId, stageId] of pending) {
      const stored = progress.get(nodeId)?.stage_id ?? null
      if (stored === stageId || !nodeById.has(nodeId)) settled.push(nodeId)
    }
    for (const nodeId of settled) dropPending(nodeId)
  }, [progress, nodeById])
}

/* ══════════════════ the badge ══════════════════ */

/**
 * How many organizations are past their rung — the Portfolio chip's badge.
 *
 * EXPORTED AS A HOOK for `useAttentionCount`'s and `useChangesCount`'s reason:
 * the shell renders the chip and this module owns the arithmetic behind it, and
 * a second fold in pages/Mindtree.tsx would be a second answer to the question
 * the chip is promising to answer.
 *
 * It runs under EVERY lens, because the badge is on the chip at every lens. That
 * is one tree walk plus two map lookups per organization — deliberately the
 * cheap half of `buildPortfolioRows`, which also resolves labels, folds vendors
 * and walks every entry beneath every node for the quiet column.
 */
export function useAtRiskCount(
  root: MindNode,
  filter: Pick<FilterState, 'mapNodeIds' | 'managerIds' | 'vendors'>,
  fallbackStallDays: number | null = null,
): number {
  const stageById = useStageMap()
  const progress = useNodeProgress()
  const pending = usePendingStages()
  const ctx = useFilterContext()
  const scope = usePortfolioScope(filter, ctx)

  return useMemo(() => {
    // `today` rather than `Date.now()` in the dependency list: the fold's only
    // use of the clock is whole calendar days, so re-running it per render (or
    // per minute) would recompute 400 rows to produce the same integer.
    const now = new Date()
    const merged = mergeProgress(progress, pending)
    return countAtRisk(root, {
      stages: stageIndex(merged, stageById),
      progressById: merged,
      fallbackStallDays,
      now,
      scope,
    })
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [root, stageById, progress, pending, fallbackStallDays, scope, ctx.today])
}

/**
 * The organization-level facets, resolved through the context's three maps.
 *
 * ONE MEMO, TWO CALLERS — the table and the chip badge — so "which
 * organizations is the reader looking at" has one answer on a screen where the
 * badge is rendered by the shell and the rows by this file. Keyed on the three
 * arrays rather than on the whole `FilterState`, because a keystroke in the
 * search box mints a new filter object and must not rebuild a scope that has not
 * changed: the search narrows the WORK under an organization, never which
 * organizations there are.
 */
function usePortfolioScope(
  filter: Pick<FilterState, 'mapNodeIds' | 'managerIds' | 'vendors'>,
  ctx: Pick<FilterContext, 'ancestryOfNode' | 'managerOfNode' | 'vendorOfNode'>,
): PortfolioScope {
  const { mapNodeIds, managerIds, vendors } = filter
  const { ancestryOfNode, managerOfNode, vendorOfNode } = ctx
  return useMemo(
    () => ({
      mapNodeIds,
      managerIds,
      vendors,
      ancestryOfNode: ancestryOfNode ?? EMPTY_ANCESTRY,
      managerOfNode: managerOfNode ?? EMPTY_MANAGERS,
      vendorOfNode: vendorOfNode ?? EMPTY_VENDORS,
    }),
    [mapNodeIds, managerIds, vendors, ancestryOfNode, managerOfNode, vendorOfNode],
  )
}

/* Frozen empties, so an absent context map is one stable identity rather than a
   new Map per render — `PORTFOLIO_SCOPE_ALL`'s reason, at the seam where the
   maps are optional. An ABSENT map with a NON-EMPTY facet matches nothing, which
   is lib/entryFilter's strict reading and `inPortfolioScope`'s too. */
const EMPTY_ANCESTRY: ReadonlyMap<string, readonly string[]> = new Map()
const EMPTY_MANAGERS: ReadonlyMap<string, string | null> = new Map()
const EMPTY_VENDORS: ReadonlyMap<string, string> = new Map()

/* ══════════════════ the columns ══════════════════ */

interface ColumnDef<C extends string> extends SortableColumn<C> {
  /** A LITERAL, so localeReach.test.ts can see it. */
  labelKey: string
  numeric: boolean
}

/** The nine organization columns, in reading order — the design's own table. */
const ROW_COLUMNS: readonly ColumnDef<PortfolioSortColumn>[] = [
  { key: 'org', labelKey: 'mindtree.colOrg', numeric: false },
  { key: 'stage', labelKey: 'mindtree.colStage', numeric: false },
  // `mindtree.colInStage` and NOT `dashboard.colAge`. "Age" is how long an ITEM
  // has been open; this is how long an ORGANIZATION has stood on one rung.
  // Borrowing the word would merge two measurements under one heading, and the
  // reader who renamed one would silently rename the other.
  { key: 'days', labelKey: 'mindtree.colInStage', numeric: true },
  { key: 'risk', labelKey: 'mindtree.colRisk', numeric: true },
  { key: 'manager', labelKey: 'mindtree.colManager', numeric: false },
  { key: 'vendor', labelKey: 'mindtree.colVendor', numeric: false },
  { key: 'progress', labelKey: 'mindtree.colProgress', numeric: true },
  { key: 'open', labelKey: 'mindtree.colOpen', numeric: true },
  { key: 'quiet', labelKey: 'mindtree.colQuiet', numeric: true },
]

/** The roll-up's seven. */
const GROUP_COLUMNS: readonly ColumnDef<PortfolioGroupSortColumn>[] = [
  { key: 'bucket', labelKey: 'mindtree.colBucket', numeric: false },
  { key: 'orgs', labelKey: 'mindtree.colOrgs', numeric: true },
  { key: 'days', labelKey: 'mindtree.colMedian', numeric: true },
  { key: 'risk', labelKey: 'mindtree.colRisk', numeric: true },
  { key: 'block', labelKey: 'mindtree.colBlock', numeric: true },
  { key: 'progress', labelKey: 'mindtree.colProgress', numeric: true },
  { key: 'open', labelKey: 'mindtree.colOpen', numeric: true },
]

/** The words for the bucket with nothing in it, one per grouping. LITERALS. */
const UNNAMED_KEY: Readonly<Record<PortfolioBy, string>> = Object.freeze({
  stage: 'mindtree.portfolioUnstaged',
  manager: 'mindtree.portfolioNoManager',
  vendor: 'mindtree.portfolioNoVendor',
  phase: 'mindtree.portfolioNoPhase',
})

/* ══════════════════ the stage ══════════════════ */

export interface PortfolioStageProps {
  /** The SAME tree the map draws — `buildMindtree()`'s root. */
  root: MindNode
  /** The shell's filter, straight off the address bar. */
  filter: FilterState
  /**
   * Narrow the shell's filter to what one row or one bucket counts — the shell's
   * ONE filter writer, so a drill is a link somebody can paste.
   *
   * SPELLED `onNarrow` AND NOT `onFilter`, and the name is load bearing:
   * `MindtreeShell.test.ts` greps the shell's SOURCE for `onFilter={setFilter}`
   * to prove `MapList` was never given a filter writer ("Mine" must have exactly
   * one owner). A second, unrelated prop spelled the same way turns that guard
   * into a false alarm on a defect that is not there — and a guard that cries
   * wolf is the one nobody reads the day it is right.
   */
  onNarrow: (next: FilterState) => void
  /** `?by=` and `?risk=`, read by `useMapUrlPortfolio`. */
  view: PortfolioView
  onView: (next: PortfolioView) => void
  /** A node's label resolved for the locale — `useMapModel.textOf`, threaded so
   *  the table and the picture say one word for one organization. */
  textOf: (label: MindNode['label']) => string
  /**
   * The capability status that counts as done.
   *
   * A PROP, NOT AN IMPORT, and the reason is both rules at once. lib/mapNodes.ts
   * requires the literal to live at exactly ONE call site, and that site is
   * `MapBranchDetail.TERMINAL_STATUS`; importing it here would ALSO create a
   * module cycle, because that band imports this file's `StagePicker`. The shell
   * already holds the literal for the canvas's underscore, so it hands it down —
   * one owner, no cycle, and the same `terminalKey` argument `useCaseProgress`
   * takes for the same stated reason.
   */
  terminalKey: string
  /**
   * A teammate's name THROUGH THE ROSTER, or null — `managerLabel`, supplied for
   * `terminalKey`'s reason. An id the roster does not know is a person who has
   * left, not "nobody", and that distinction lives in the one function rather
   * than being restated here.
   */
  managerNameOf: (id: string | null) => string | null
  /** Open the branch panel on a node — the shell's `setSubject`. */
  onOpenNode: (nodeId: string) => void
  compact: boolean
  announce: (text: string) => void
}

export default function PortfolioStage({
  root,
  filter,
  onNarrow,
  view,
  onView,
  textOf,
  terminalKey,
  managerNameOf,
  onOpenNode,
  compact,
  announce,
}: PortfolioStageProps): ReactElement {
  const locale = useLocale()
  const captionId = useId()

  const nodeById = useMapNodeMap()
  const ladder = useMapNodeStages()
  const stageById = useStageMap()
  const storedProgress = useNodeProgress()
  const pending = usePendingStages()
  const catalogue = useAllUseCases()
  const links = usePortfolioLinks()
  const truncated = usePortfolioTruncated()
  const entryById = useEntryMap()
  const ctx = useFilterContext()
  const stageLabelOf = useStageLabel()

  useStageReconcile(storedProgress, nodeById)

  const [rowSort, setRowSort] = useState<TableSort<PortfolioSortColumn> | null>(null)
  const [groupSort, setGroupSort] = useState<TableSort<PortfolioGroupSortColumn> | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [busy, setBusy] = useState(false)
  /** The last row ticked by hand — where a Shift-range measures from. */
  const anchorRef = useRef<string | null>(null)

  const progress = useMemo(
    () => mergeProgress(storedProgress, pending),
    [storedProgress, pending],
  )

  /**
   * `useCaseProgress` per organization, or null while nobody has looked.
   *
   * NULL AND NOT AN EMPTY MAP: store/portfolio's links start null, which means
   * "nobody has read them", and a `0 of 9` in front of an account manager whose
   * organization is at 6 is worse than an em-dash. The nodes are taken from the
   * store rather than from the rows so the population is every organization the
   * workspace has, which is `progressByNode`'s own contract.
   */
  const progressByNodeId = useMemo(() => {
    if (links === null) return null
    return progressByNode([...links], [...nodeById.values()], catalogue, terminalKey)
  }, [links, nodeById, catalogue, terminalKey])

  const allRows = useMemo(
    () =>
      buildPortfolioRows({
        root,
        nodeById,
        stages: stageIndex(progress, stageById),
        progressById: progress,
        // NO WORKSPACE FLOOR IN v1, and it is a decision rather than a TODO:
        // 0026 seeds every rung's `expected_days` NULL on purpose (0003's
        // SLA-off reasoning), and a floor invented here would chase people with
        // a number nobody chose. `resolveStallDays` takes the argument so the
        // day an admin screen offers one, this line is where it arrives.
        fallbackStallDays: null,
        labelOf: (node) => textOf(node.label),
        listSep: t('mindtree.listSep'),
        stageNameOf: stageLabelOf,
        managerNameOf,
        vendorOfNode: ctx.vendorOfNode ?? EMPTY_VENDORS,
        // THE INHERITED PERSON, beside the inherited integrator, and off the
        // same walk. Without it the `?by=manager` roll-up bucketed by the raw
        // column while `inPortfolioScope` admitted by the inherited one, so an
        // organization narrowed to by `?manager=X` could land in "Nobody named".
        managerOfNode: ctx.managerOfNode ?? EMPTY_MANAGERS,
        progressByNode: progressByNodeId,
        entryById,
        today: ctx.today,
        now: new Date(),
      }),
    // `locale` is a dependency the builder does not take: `listSep` and the
    // labels resolve through t()/textOf, which read the GLOBAL locale rather
    // than an argument the linter can see. MindtreeTable silences the same rule
    // at the same memo for the same reason.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [root, nodeById, progress, stageById, textOf, stageLabelOf, managerNameOf, ctx, progressByNodeId, entryById, locale],
  )

  /**
   * WHICH ORGANIZATIONS THE READER IS LOOKING AT — see `inPortfolioScope`.
   *
   * The tree draws every organization whether or not the filter admits any of
   * its work (model.ts's structural rule), so a table whose ROWS are
   * organizations has to narrow itself. Built here and handed to the same
   * predicate the badge uses, so the chip and the list are one number under a
   * filter as well as without one.
   */
  const scope = usePortfolioScope(filter, ctx)

  const population = useMemo(
    () => portfolioRowsFor(allRows, view, scope),
    [allRows, view, scope],
  )
  const showsRows = portfolioShowsRows(view, filter)

  const groups = useMemo(
    () => rollUpPortfolio(population, view.by, ladder, stageLabelOf),
    [population, view.by, ladder, stageLabelOf],
  )

  const sortedRows = useMemo(
    () => sortRows(population, rowSort, (a, b, column) => comparePortfolioRows(a, b, column, compareText)),
    [population, rowSort],
  )
  const sortedGroups = useMemo(
    () =>
      sortRows(groups, groupSort, (a, b, column) => comparePortfolioGroups(a, b, column, compareText)),
    [groups, groupSort],
  )

  /** Every row the reader can currently see, in reading order — the Shift-range
   *  measures over this and the pruning effect below trims to it. */
  const visibleIds = useMemo(
    () => (showsRows ? sortedRows.map((row) => row.nodeId) : []),
    [showsRows, sortedRows],
  )
  const visibleRef = useRef(visibleIds)
  visibleRef.current = visibleIds

  // Prune to what is on screen — MapBranch's rule: a bulk bar reading "18
  // selected" while six have been filtered away offers an action nobody can
  // review before taking it.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev
      const shown = new Set(visibleIds)
      const next = new Set<string>()
      for (const id of prev) if (shown.has(id)) next.add(id)
      return next.size === prev.size ? prev : next
    })
  }, [visibleIds])

  const toggleRow = useCallback((nodeId: string, shift: boolean) => {
    setSelected((prev) => {
      const list = visibleRef.current
      const anchor = anchorRef.current
      if (shift && anchor !== null && anchor !== nodeId) {
        const from = list.indexOf(anchor)
        const to = list.indexOf(nodeId)
        if (from >= 0 && to >= 0) {
          // A range ADDS — MapBranch's rule: shift-clicking a second stretch
          // must not throw away the first.
          const next = new Set(prev)
          for (let i = Math.min(from, to); i <= Math.max(from, to); i += 1) next.add(list[i])
          return next
        }
      }
      const next = new Set(prev)
      if (!next.delete(nodeId)) next.add(nodeId)
      anchorRef.current = nodeId
      return next
    })
  }, [])

  const toggleAll = useCallback((on: boolean) => {
    anchorRef.current = null
    setSelected(on ? new Set(visibleRef.current) : new Set())
  }, [])

  /* ── the writes ─────────────────────────────────────────────────── */

  const nameOf = useCallback(
    (nodeId: string): string => {
      const row = allRows.find((r) => r.nodeId === nodeId)
      return row?.name ?? nodeById.get(nodeId)?.name ?? ''
    },
    [allRows, nodeById],
  )

  const stageWordOf = useCallback(
    (stageId: string | null): string => {
      if (stageId === null) return t('mindtree.portfolioUnstaged')
      const stage = stageById.get(stageId)
      return stage === undefined ? t('mindtree.portfolioUnstaged') : stageLabelOf(stage)
    },
    [stageById, stageLabelOf],
  )

  /**
   * One row's rung, changed from the row. NO CONFIRM, an undo toast, and the
   * announcement lands BEFORE the round trip — the optimistic value is already
   * on screen, and a screen-reader user must hear the change at the same moment
   * a sighted one sees it (MapBranch's `setRowOwner`, same reasoning).
   */
  const setOne = useCallback(
    (nodeId: string, next: string | null, previous: string | null) => {
      if (next === previous) return
      // READ IN THE TAP, NOT IN THE UNDO. `writeStage` publishes the row it
      // wrote, so by the time the toast's button is pressed every node has a
      // row and the answer would always be "yes, it was there".
      const hadRow = storedProgress.has(nodeId)
      announce(
        next === null
          ? t('mindtree.portfolioStageCleared', { name: nameOf(nodeId) })
          : t('mindtree.portfolioStaged', { name: nameOf(nodeId), stage: stageWordOf(next) }),
      )
      void writeStage(nodeId, next).then((ok) => {
        if (!ok) {
          toast(t('mindtree.portfolioStageFailed', { name: nameOf(nodeId) }), { tone: 'error' })
          return
        }
        toast(
          next === null
            ? t('mindtree.portfolioStageCleared', { name: nameOf(nodeId) })
            : t('mindtree.portfolioStaged', { name: nameOf(nodeId), stage: stageWordOf(next) }),
          {
            action: {
              label: t('common.undo'),
              onClick: () => {
                // The PREVIOUS rung, including null — or NO ROW AT ALL when this
                // write is the first anybody ever recorded here. See the
                // header's ⚠: the two render identically as an em-dash, which is
                // exactly why the difference has to be carried rather than
                // eyeballed.
                void undoStage(nodeId, previous, hadRow)
              },
            },
          },
        )
      })
    },
    [announce, nameOf, stageWordOf, storedProgress],
  )

  /**
   * N rows, one action, one summary — budget E8.
   *
   * POOLED SIX AT A TIME, `runBulk`'s number and its measurement: a sequential
   * loop pays the full round trip per row (253 ms measured against the live
   * project), so thirty rows would freeze the screen for seven and a half
   * seconds, and forty simultaneous requests is one browser presenting as forty
   * sessions against a free-tier project.
   *
   * PARTIAL SUCCESS IS REPORTED, NOT ROLLED BACK, and the rows that failed stay
   * selected so the retry is one more tap. The undo restores EACH ROW'S OWN
   * PRIOR RUNG rather than one rung for all of them — they did not start
   * together and they must not end together.
   */
  const setMany = useCallback(
    async (nodeIds: readonly string[], next: string | null): Promise<void> => {
      if (busy || nodeIds.length === 0) return
      const before = new Map<string, string | null>(
        nodeIds.map((id) => [id, resolveStageId(id, storedProgress, pending)]),
      )
      // BESIDE `before`, AND IT IS NOT THE SAME QUESTION. `before` is which rung
      // each row stood on; this is whether the row EXISTED. Thirty rows can be
      // em-dashes for two different reasons, and the undo owes each of them its
      // own answer — the ones nobody had ever touched go back to untouched.
      const hadRows = new Set(nodeIds.filter((id) => storedProgress.has(id)))
      setBusy(true)
      const results = await pooled(nodeIds, (id) => writeStage(id, next))
      setBusy(false)

      const failedIds = nodeIds.filter((_, i) => !results[i])
      const done = nodeIds.length - failedIds.length

      const undo = {
        label: t('common.undo'),
        onClick: () => {
          void (async () => {
            const ids = nodeIds.filter((id) => !failedIds.includes(id))
            await pooled(ids, (id) => undoStage(id, before.get(id) ?? null, hadRows.has(id)))
          })()
        },
      }

      if (failedIds.length === 0) {
        toast(t('mindtree.portfolioBulkDone', { count: done, stage: stageWordOf(next) }), {
          tone: 'success',
          action: undo,
        })
      } else if (done === 0) {
        toast(t('mindtree.portfolioBulkFailed', { count: failedIds.length }), { tone: 'error' })
      } else {
        toast(t('mindtree.portfolioBulkPartial', { done, failed: failedIds.length }), {
          tone: 'error',
          action: undo,
        })
      }
      announce(t('mindtree.portfolioBulkDone', { count: done, stage: stageWordOf(next) }))
      setSelected(new Set(failedIds))
      anchorRef.current = null
    },
    [busy, storedProgress, pending, stageWordOf, announce],
  )

  /* ── the states that name themselves (E6) ────────────────────────── */

  /**
   * THE LADDER HAS NO RUNGS. Until 0026 is applied the read answers 42P01 and
   * store/config keeps an empty list; after it is applied, an admin can hide
   * every rung. Both render the same sentence, and the sentence LINKS TO THE
   * SCREEN THAT FIXES IT rather than leaving a table of em-dashes that reads as
   * broken. JiraAdmin's connection card names its state the same way.
   */
  const noStages = ladder.length === 0

  /**
   * THE LADDER EXISTS AND NOBODY HAS SAID HOW LONG A RUNG SHOULD TAKE. 0026
   * seeds `expected_days` on no rung on purpose, so this is the state the
   * workspace is in the day the migration applies — and with no threshold the
   * at-risk column reads 0 forever and looks broken. Named, with the link, and
   * ABOVE the table rather than instead of it: every other column is still true.
   */
  const noThresholds = !noStages && ladder.every((stage) => stage.expected_days === null)

  const totals = useMemo(() => {
    let open = 0
    let atRisk = 0
    for (const row of population) {
      open += row.open
      if (row.atRisk) atRisk += 1
    }
    return { orgs: population.length, open, atRisk }
  }, [population])

  if (noStages) {
    return (
      <div className="pf pf-blank">
        <EmptyState
          title={t('mindtree.portfolioNoStages')}
          description={t('mindtree.portfolioNoStagesHint')}
          action={
            <Link className="btn" to="/settings/catalogue">
              {t('mindtree.portfolioNoStagesAction')}
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div className="pf">
      <div className="pf-controls">
        <ByChips value={view.by} onChange={(by) => onView({ ...view, by })} compact={compact} />
        <RiskToggle
          on={view.risk}
          count={totals.atRisk}
          onChange={(risk) => onView({ ...view, risk })}
        />
      </div>

      <div className="pf-controls pf-controls-as">
        <AsChips value={view.as} onChange={(as) => onView({ ...view, as })} compact={compact} />
      </div>

      {noThresholds && (
        <p className="pf-note">
          {t('mindtree.portfolioNoThreshold')}{' '}
          <Link to="/settings/catalogue">{t('mindtree.portfolioNoThresholdAction')}</Link>
        </p>
      )}

      {truncated && <p className="pf-note pf-note-warn">{t('mindtree.portfolioPartial')}</p>}

      {showsRows && selected.size > 0 && (
        <BulkBar
          count={selected.size}
          ladder={ladder}
          stageLabelOf={stageLabelOf}
          busy={busy}
          onApply={(stageId) => void setMany([...selected], stageId)}
          onClear={() => {
            setSelected(new Set())
            anchorRef.current = null
            announce(t('tree.selectionCleared'))
          }}
        />
      )}

      {/* ── HOW THE ROWS ARE DRAWN ──────────────────────────────────────
          The same population, four marks. Each takes the identical props and
          owns its own sheet, which is what let the three be built at once
          without any of them reaching into another's CSS prefix.

          THE TABLE STAYS THE `else`, not a fourth case, because it is what a
          reader with no opinion gets — `?as=` is absent from the URL at its
          default for the same reason. The empty state is asked BEFORE the
          switch: "no rows" is a fact about the population, not about the mark,
          and four copies of it would be four chances to word it differently. */}
      {showsRows && sortedRows.length === 0 ? (
        <div className="pf-blank">
          <EmptyState
            title={view.risk ? t('mindtree.portfolioEmptyRisk') : t('mindtree.portfolioEmpty')}
            description={
              view.risk ? t('mindtree.portfolioEmptyRiskHint') : t('mindtree.portfolioEmptyHint')
            }
            action={
              view.risk ? (
                <button type="button" className="btn" onClick={() => onView({ ...view, risk: false })}>
                  {t('mindtree.portfolioShowAll')}
                </button>
              ) : undefined
            }
          />
        </div>
      ) : view.as === 'bars' ? (
        <PortfolioBars
          rows={sortedRows}
          groups={sortedGroups}
          showsRows={showsRows}
          catalogue={catalogue}
          compact={compact}
          managerNameOf={managerNameOf}
          onOpenNode={onOpenNode}
          captionId={captionId}
        />
      ) : view.as === 'cards' ? (
        <PortfolioCards
          rows={sortedRows}
          groups={sortedGroups}
          showsRows={showsRows}
          catalogue={catalogue}
          compact={compact}
          managerNameOf={managerNameOf}
          onOpenNode={onOpenNode}
          captionId={captionId}
        />
      ) : view.as === 'grid' ? (
        <PortfolioGrid
          rows={sortedRows}
          groups={sortedGroups}
          showsRows={showsRows}
          catalogue={catalogue}
          compact={compact}
          managerNameOf={managerNameOf}
          onOpenNode={onOpenNode}
          captionId={captionId}
        />
      ) : (
        <div className="pf-wrap" role="region" aria-labelledby={captionId} tabIndex={0}>
          <table className="pf-tbl">
            <caption className="pf-caption">
              <span className="pf-caption-title" id={captionId}>
                {t('mindtree.portfolioLabel')}
              </span>{' '}
              <span className="pf-caption-desc">
                {showsRows
                  ? t('mindtree.portfolioRows', { count: totals.orgs })
                  : t('mindtree.portfolioBuckets', { label: t(PORTFOLIO_BY_KEY[view.by]) })}
              </span>
            </caption>

            {showsRows ? (
              <>
                <thead>
                  <tr>
                    <th scope="col" className="pf-pick">
                      <TriCheck
                        label={t('mindtree.portfolioSelectAll')}
                        checked={selected.size > 0 && selected.size === visibleIds.length}
                        indeterminate={selected.size > 0 && selected.size < visibleIds.length}
                        onChange={(on) => toggleAll(on)}
                      />
                    </th>
                    {ROW_COLUMNS.map((column) => (
                      <SortHeader
                        key={column.key}
                        column={column}
                        sort={rowSort}
                        onSort={() => setRowSort((prev) => nextSort(prev, column))}
                      />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row) => (
                    <OrgRow
                      key={row.key}
                      row={row}
                      ladder={ladder}
                      stageLabelOf={stageLabelOf}
                      picked={selected.has(row.nodeId)}
                      onPick={toggleRow}
                      onOpen={onOpenNode}
                      onDrill={() => onNarrow(filterForOrgRow(filter, row))}
                      onStage={(next) => setOne(row.nodeId, next, row.stageId)}
                    />
                  ))}
                </tbody>
                <tfoot>
                  {/* TEN CELLS, AND THE COUNT IS ARITHMETIC RATHER THAN A HABIT:
                      the header row is the tick column plus `ROW_COLUMNS`, so a
                      footer row is `ROW_COLUMNS.length + 1` = 10 cells wide. The
                      spanned `<th>` swallows the first five (tick · org · stage ·
                      in-stage · at-risk) and five `<td>` follow, one per
                      remaining column, in the header's own order.

                      IT WAS NINE, and being one short is not a cosmetic defect:
                      an HTML table lays cells out by POSITION, so the missing
                      tenth slid `totals.open` one column to the start of where
                      it belongs and printed the open total under "Progress",
                      where it reads as a capabilities figure. The quiet column
                      had no footer cell at all. Nothing on screen said so.

                      ONLY `open` IS TOTALLED, deliberately. A sum of days in
                      stage is not a quantity anybody has a use for, at-risk is
                      already the chip's badge above the table, and a summed
                      progress fraction would be a number with two different
                      denominators in it. */}
                  <tr className="pf-total">
                    <th scope="row" colSpan={5}>
                      {t('mindtree.portfolioTotal', { count: totals.orgs })}
                    </th>
                    {/* manager */}
                    <td />
                    {/* vendor */}
                    <td />
                    {/* progress */}
                    <td />
                    <td className="pf-num tabular">{totals.open}</td>
                    {/* quiet */}
                    <td />
                  </tr>
                </tfoot>
              </>
            ) : (
              <>
                <thead>
                  <tr>
                    {GROUP_COLUMNS.map((column) => (
                      <SortHeader
                        key={column.key}
                        column={column}
                        sort={groupSort}
                        onSort={() => setGroupSort((prev) => nextSort(prev, column))}
                      />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedGroups.map((group) => (
                    <BucketRow
                      key={group.key === '' ? 'unnamed' : group.key}
                      group={group}
                      unnamedLabel={t(UNNAMED_KEY[view.by])}
                      onDrill={() => onNarrow(filterForBucket(filter, group))}
                    />
                  ))}
                </tbody>
                <tfoot>
                  <tr className="pf-total">
                    <th scope="row">{t('mindtree.portfolioTotal', { count: totals.orgs })}</th>
                    <td className="pf-num tabular">{totals.orgs}</td>
                    <td />
                    <td className="pf-num tabular">{totals.atRisk}</td>
                    <td />
                    <td />
                    <td className="pf-num tabular">{totals.open}</td>
                  </tr>
                </tfoot>
              </>
            )}
          </table>
        </div>
      )}
    </div>
  )
}

/* ══════════════════ the controls ══════════════════ */

/**
 * `?by=` as four human chips — budget E5.
 *
 * MapLensBar's recipe, deliberately duplicated in SHAPE and not in CODE: that
 * component renders `MAP_LENSES` and knows what a lens is, and generalising it
 * over two unions would put two ideas in one file whose header spends a
 * paragraph on being exactly one. What is shared is the accessibility contract —
 * `role="group"` with a name, `aria-pressed` per chip, `.tap-44` on each — and
 * that contract is asserted here rather than assumed.
 */
function ByChips({
  value,
  onChange,
  compact,
}: {
  value: PortfolioBy
  onChange: (next: PortfolioBy) => void
  compact: boolean
}): ReactElement {
  return (
    <div
      className="pf-bys"
      role="group"
      aria-label={t('mindtree.portfolioBy')}
      data-compact={compact ? '' : undefined}
    >
      {PORTFOLIO_BYS.map((by) => (
        <button
          key={by}
          type="button"
          className="pf-chip tap-44"
          aria-pressed={by === value}
          onClick={() => onChange(by)}
        >
          {t(PORTFOLIO_BY_KEY[by])}
        </button>
      ))}
    </div>
  )
}

/**
 * HOW the rows are drawn — the second axis, and a second chip group.
 *
 * ⚠ NOT FOLDED INTO `ByChips`. The two answer different questions and the file's
 *   own note on that component says why a shared generic would be wrong: "a
 *   generic over two unions would put two ideas in one file whose header spends
 *   a paragraph on being exactly one." What IS shared is the accessibility
 *   contract — a named `role="group"`, `aria-pressed` per chip, `.tap-44` on
 *   each — and it is restated here rather than inherited.
 *
 * Four chips, always all of them, never behind a disclosure: MapLensBar's rule.
 * They sit on their own line below the grouping chips, which is what keeps the
 * 375px row from becoming the two-screen pan that argued against making these
 * four lenses in the first place.
 */
function AsChips({
  value,
  onChange,
  compact,
}: {
  value: PortfolioAs
  onChange: (next: PortfolioAs) => void
  compact: boolean
}): ReactElement {
  return (
    <div
      className="pf-ases"
      role="group"
      aria-label={t('mindtree.portfolioAs')}
      data-compact={compact ? '' : undefined}
    >
      {PORTFOLIO_ASES.map((as) => (
        <button
          key={as}
          type="button"
          className="pf-chip tap-44"
          aria-pressed={as === value}
          onClick={() => onChange(as)}
        >
          {t(PORTFOLIO_AS_KEY[as])}
        </button>
      ))}
    </div>
  )
}

/**
 * The exception cut, as one toggle whose NAME carries the number.
 *
 * The badge is `aria-hidden` and the count rides the accessible name as a
 * counted sentence through the plural node — MapLensBar's exact rule. Arabic has
 * six plural categories and `lib/plural.ts` picks between them; a bare `{n}`
 * appended to a label would be ungrammatical in five of them.
 */
function RiskToggle({
  on,
  count,
  onChange,
}: {
  on: boolean
  count: number
  onChange: (next: boolean) => void
}): ReactElement {
  return (
    <button
      type="button"
      className="pf-chip pf-risk tap-44"
      aria-pressed={on}
      aria-label={t('mindtree.portfolioRiskCount', { count })}
      onClick={() => onChange(!on)}
    >
      <span>{t('mindtree.portfolioRisk')}</span>
      {count > 0 && (
        <span className="pf-badge tabular" aria-hidden="true">
          {count}
        </span>
      )}
    </button>
  )
}

/** A sortable header. `aria-sort` on the `<th>`, a real `<button>` inside it,
 *  and the button's accessible name is the column label ALONE — tableSort's
 *  contract, which is where the three-state cycle lives too. */
function SortHeader<C extends string>({
  column,
  sort,
  onSort,
}: {
  column: ColumnDef<C>
  sort: TableSort<C> | null
  onSort: () => void
}): ReactElement {
  const state = ariaSort(sort, column.key)
  return (
    <th scope="col" aria-sort={state} className={column.numeric ? 'pf-num' : undefined}>
      <button type="button" className="btn btn-sm btn-ghost pf-sortbtn" onClick={onSort}>
        <span>{t(column.labelKey)}</span>
        <SortMark state={state} />
      </button>
    </th>
  )
}

/** Hand-rolled rather than a glyph: a triangle from a font is bidi-neutral and
 *  its placement would depend on the paragraph direction. MindtreeTable's. */
function SortMark({ state }: { state: 'ascending' | 'descending' | 'none' }): ReactElement | null {
  if (state === 'none') return null
  return (
    <svg
      className={state === 'ascending' ? 'pf-mark' : 'pf-mark is-desc'}
      viewBox="0 0 10 10"
      width="10"
      height="10"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5 2 L9 8 L1 8 Z" fill="currentColor" />
    </svg>
  )
}

/**
 * A checkbox that can also be partly on, and that reports whether Shift was
 * down. MapBranch's `TriCheck`, restated here because that one is not exported
 * and this file may not reach into it.
 *
 * `indeterminate` is a DOM PROPERTY WITH NO ATTRIBUTE, so it can only be set
 * through a ref. Shift is captured on pointerdown/keydown rather than read off
 * the change event, because a change event carries no modifier state in the
 * specification even where it happens to today.
 */
function TriCheck({
  label,
  checked,
  indeterminate = false,
  onChange,
}: {
  label: string
  checked: boolean
  indeterminate?: boolean
  onChange: (on: boolean, shift: boolean) => void
}): ReactElement {
  const ref = useRef<HTMLInputElement>(null)
  const shiftRef = useRef(false)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate])
  return (
    <input
      ref={ref}
      type="checkbox"
      className="pf-check tap-44"
      aria-label={label}
      checked={checked}
      onPointerDown={(ev) => {
        shiftRef.current = ev.shiftKey
      }}
      onKeyDown={(ev) => {
        shiftRef.current = ev.shiftKey
      }}
      onChange={(ev) => {
        onChange(ev.target.checked, shiftRef.current)
        shiftRef.current = false
      }}
    />
  )
}

/* ══════════════════ the rows ══════════════════ */

function OrgRow({
  row,
  ladder,
  stageLabelOf,
  picked,
  onPick,
  onOpen,
  onDrill,
  onStage,
}: {
  row: PortfolioRow
  ladder: readonly MapNodeStage[]
  stageLabelOf: (stage: MapNodeStage) => string
  picked: boolean
  onPick: (nodeId: string, shift: boolean) => void
  onOpen: (nodeId: string) => void
  onDrill: () => void
  onStage: (next: string | null) => void
}): ReactElement {
  const sep = t('mindtree.listSep')
  return (
    <tr className={row.retired ? 'pf-row is-retired' : 'pf-row'} data-node={row.nodeId}>
      <td className="pf-pick">
        <TriCheck
          label={t('mindtree.portfolioSelect', { name: row.name })}
          checked={picked}
          onChange={(_on, shift) => onPick(row.nodeId, shift)}
        />
      </td>

      {/* THE ROW HEADER, and it is the organization — every number in the row is
          the answer to "Riyadh General, past its rung" and to nothing shorter.
          The button OPENS THE PANEL rather than drilling the filter: tapping an
          organization is how the reader looks at one, and the map deliberately
          does not move (the owner's own correction). The trail carries the
          drill, so both verbs are one tap and neither is hidden. */}
      <th scope="row" className="pf-org">
        <button
          type="button"
          className="btn btn-sm btn-ghost pf-orgbtn"
          aria-label={t('mindtree.portfolioOpenOrg', { name: row.name })}
          onClick={() => onOpen(row.nodeId)}
        >
          <span className="pf-orgname">{isolate(row.name)}</span>
        </button>
        {row.trailParts.length > 0 && (
          <button
            type="button"
            className="btn btn-sm btn-ghost pf-trail"
            aria-label={t('mindtree.portfolioDrill', { name: row.name })}
            onClick={onDrill}
          >
            {row.trailParts.filter((part) => part !== '').map(isolate).join(sep)}
          </button>
        )}
        {row.retired && <span className="pill pf-flag">{t('mindtree.archived')}</span>}
      </th>

      {/* THE STAGE, EDITABLE IN ONE TAP — E2. A native <select>, so the phone
          gets its own wheel and the keyboard gets type-ahead for free; 44px
          through `.pf-stage` rather than through a `.tap-44` overlay, because an
          overlay over a <select> would eat the press that opens it. */}
      <td className="pf-stagecell">
        <select
          className="pf-stage"
          aria-label={t('mindtree.portfolioSetStage', { name: row.name })}
          value={row.stageId ?? NO_STAGE}
          onChange={(ev) => onStage(ev.target.value === NO_STAGE ? null : ev.target.value)}
        >
          <option value={NO_STAGE}>{t('mindtree.portfolioUnstaged')}</option>
          {ladder
            // A HIDDEN RUNG IS OFFERED ONLY WHERE THE NODE ALREADY STANDS ON IT.
            // store/config's own sentence: "a picker's correct list is the
            // unhidden rungs plus whichever rung this node is already on" —
            // otherwise an organization parked on a retired rung cannot be moved
            // off it without the select first lying about where it is.
            .filter((stage) => !stage.hidden || stage.id === row.stageId)
            .map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stageLabelOf(stage)}
              </option>
            ))}
        </select>
      </td>

      <td className="pf-num tabular">
        {row.daysInStage === null ? <Blank /> : t('mindtree.portfolioDays', { count: row.daysInStage })}
      </td>

      {/* AT RISK IS NEVER COLOUR ALONE (WCAG 1.4.1): the cell carries the WORD,
          the day count is one column to the start of it, and `data-tone` is a
          third redundant channel rather than the only one. */}
      <td className="pf-num" data-tone={row.atRisk ? 'danger' : undefined}>
        {row.atRisk ? (
          <span className="pf-risk-word">{t('mindtree.portfolioAtRisk')}</span>
        ) : (
          <Blank word={t('mindtree.portfolioOnTrack')} />
        )}
      </td>

      <td className="pf-txt">{row.managerName === null ? <Blank /> : isolate(row.managerName)}</td>
      <td className="pf-txt">{row.vendor.trim() === '' ? <Blank /> : isolate(row.vendor)}</td>

      <td className="pf-num tabular">
        {row.progress === null ? (
          <Blank />
        ) : (
          t('mindtree.portfolioProgress', { done: row.progress.done, total: row.progress.total })
        )}
      </td>

      <td className="pf-num tabular">{row.open}</td>

      <td className="pf-num tabular">
        {row.quietDays === null ? <Blank /> : t('mindtree.portfolioDays', { count: row.quietDays })}
      </td>
    </tr>
  )
}

function BucketRow({
  group,
  unnamedLabel,
  onDrill,
}: {
  group: PortfolioGroupRow
  unnamedLabel: string
  onDrill: () => void
}): ReactElement {
  const label = group.unnamed ? unnamedLabel : group.label
  return (
    <tr className="pf-row">
      <th scope="row" className="pf-org">
        {/* AN EMPTY BUCKET IS NOT A CONTROL. `mapNodeIds: []` means THE WHOLE
            MAP, so drilling a bucket with nothing in it would WIDEN the filter
            rather than narrow it — `filterForCell`'s own trap, one level up. It
            renders as text instead of as a button that does the opposite of what
            it says. */}
        {group.orgs === 0 ? (
          <span className="pf-orgname">{isolate(label)}</span>
        ) : (
          <button
            type="button"
            className="btn btn-sm btn-ghost pf-orgbtn"
            aria-label={t('mindtree.portfolioDrillBucket', { label })}
            onClick={onDrill}
          >
            <span className="pf-orgname">{isolate(label)}</span>
          </button>
        )}
      </th>
      <td className="pf-num tabular">{group.orgs}</td>
      <td className="pf-num tabular">
        {group.medianDays === null ? <Blank /> : t('mindtree.portfolioDays', { count: group.medianDays })}
      </td>
      <td className="pf-num" data-tone={group.atRisk > 0 ? 'danger' : undefined}>
        <span className="tabular">{group.atRisk}</span>
      </td>
      {/* "ONE FIX UNBLOCKS N" — the largest count of this bucket's organizations
          on ONE non-terminal rung. It is the number that turns a vendor cohort
          into an action, so it is a column and not a tooltip. */}
      <td className="pf-txt">
        {group.largestBlock === 0 ? (
          <Blank />
        ) : (
          t('mindtree.portfolioBlock', {
            count: group.largestBlock,
            stage: group.largestBlockLabel,
          })
        )}
      </td>
      <td className="pf-num tabular">
        {group.total === null || group.total === 0 ? (
          <Blank />
        ) : (
          t('mindtree.portfolioProgress', { done: group.done ?? 0, total: group.total })
        )}
      </td>
      <td className="pf-num tabular">{group.open}</td>
    </tr>
  )
}

/**
 * A cell with nothing in it.
 *
 * The dash is what a reader sees and the word is what a screen reader says; an
 * `aria-label` on a plain `<span>` would be neither, because ARIA 1.2 prohibits
 * naming a generic element. MapBranchDetail's `NotRecorded`, with the word as a
 * parameter because this table has four different absences.
 */
function Blank({ word }: { word?: string } = {}): ReactElement {
  return (
    <>
      <span aria-hidden="true">{EM_DASH}</span>
      <span className="sr-only">{word ?? t('mapnode.notRecorded')}</span>
    </>
  )
}

/**
 * N rows, ONE write — budget E8.
 *
 * A `<select>` that fires on change rather than a picker plus an Apply button:
 * the action IS the choice, and an Apply step would put a confirm between an
 * account manager and the thing they do forty times a morning. The undo is on
 * the toast, which is E4's answer to "what if they meant something else".
 */
function BulkBar({
  count,
  ladder,
  stageLabelOf,
  busy,
  onApply,
  onClear,
}: {
  count: number
  ladder: readonly MapNodeStage[]
  stageLabelOf: (stage: MapNodeStage) => string
  busy: boolean
  onApply: (stageId: string | null) => void
  onClear: () => void
}): ReactElement {
  const [value, setValue] = useState(NO_STAGE)
  return (
    <div className="pf-bulk" role="group" aria-label={t('mindtree.portfolioBulk')}>
      <span className="pf-bulk-count tabular">
        {t('mindtree.portfolioSelected', { count })}
      </span>
      <select
        className="pf-stage"
        aria-label={t('mindtree.portfolioBulkStage')}
        value={value}
        disabled={busy}
        onChange={(ev) => {
          const next = ev.target.value
          setValue(NO_STAGE)
          if (next === NO_STAGE) return
          onApply(next === CLEAR_VALUE ? null : next)
        }}
      >
        {/* The idle option is a PROMPT, not a value: a bulk bar whose select sat
            on "Not started" would apply that rung to forty organizations the
            first time somebody re-opened it. */}
        <option value={NO_STAGE}>{t('mindtree.portfolioBulkStage')}</option>
        {ladder
          .filter((stage) => !stage.hidden)
          .map((stage) => (
            <option key={stage.id} value={stage.id}>
              {stageLabelOf(stage)}
            </option>
          ))}
        <option value={CLEAR_VALUE}>{t('mindtree.portfolioUnstaged')}</option>
      </select>
      <button type="button" className="btn btn-sm btn-ghost" onClick={onClear}>
        {t('mindtree.clearSelection')}
      </button>
    </div>
  )
}

/* ── exported for the panel ─────────────────────────────────────────── */

/**
 * The stage editor, as one control the org panel can mount — the SAME optimistic
 * write, the same undo toast, and the same overlay the table reads.
 *
 * IT LIVES HERE RATHER THAN IN MapBranchDetail because the overlay does, and two
 * copies of an optimistic write are two answers to "what rung is this on" that
 * disagree for exactly as long as a round trip. `MapChanges` exports
 * `useChangesCount` and `MapBranch` exports `runBulk` on the same principle: the
 * component that owns the mechanism publishes it.
 */
export function StagePicker({
  nodeId,
  name,
  announce,
}: {
  nodeId: string
  name: string
  announce?: (text: string) => void
}): ReactElement | null {
  const ladder = useMapNodeStages()
  const stageById = useStageMap()
  const storedProgress = useNodeProgress()
  const nodeById = useMapNodeMap()
  const pending = usePendingStages()
  const stageLabelOf = useStageLabel()
  useStageReconcile(storedProgress, nodeById)

  const current = resolveStageId(nodeId, storedProgress, pending)

  const wordOf = useCallback(
    (stageId: string | null): string => {
      if (stageId === null) return t('mindtree.portfolioUnstaged')
      const stage = stageById.get(stageId)
      return stage === undefined ? t('mindtree.portfolioUnstaged') : stageLabelOf(stage)
    },
    [stageById, stageLabelOf],
  )

  const choose = useCallback(
    (next: string | null) => {
      if (next === current) return
      // The row's own reason, one surface over: read before the write, because
      // the write creates the row it is asking about.
      const hadRow = storedProgress.has(nodeId)
      const said =
        next === null
          ? t('mindtree.portfolioStageCleared', { name })
          : t('mindtree.portfolioStaged', { name, stage: wordOf(next) })
      announce?.(said)
      void writeStage(nodeId, next).then((ok) => {
        if (!ok) {
          toast(t('mindtree.portfolioStageFailed', { name }), { tone: 'error' })
          return
        }
        toast(said, {
          action: {
            label: t('common.undo'),
            onClick: () => {
              void undoStage(nodeId, current, hadRow)
            },
          },
        })
      })
    },
    [current, name, nodeId, wordOf, announce, storedProgress],
  )

  // NO CONTROL WHERE THERE IS NO LADDER. The band's own rule one field up: a
  // picker with one option that is "nothing" is a control that promises a verb
  // the workspace does not have yet, and the portfolio stage already names that
  // state and links to the screen that fixes it.
  if (ladder.length === 0) return null

  return (
    <select
      className="pf-stage"
      aria-label={t('mindtree.portfolioSetStage', { name })}
      value={current ?? NO_STAGE}
      onChange={(ev) => choose(ev.target.value === NO_STAGE ? null : ev.target.value)}
    >
      <option value={NO_STAGE}>{t('mindtree.portfolioUnstaged')}</option>
      {ladder
        .filter((stage) => !stage.hidden || stage.id === current)
        .map((stage) => (
          <option key={stage.id} value={stage.id}>
            {stageLabelOf(stage)}
          </option>
        ))}
    </select>
  )
}
