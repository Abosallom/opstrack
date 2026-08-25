// THE MODEL LAYER — every store this screen reads, the inputs it folds them
// into, the one `buildMindtree` call, and the three derivations that hang off
// the resulting tree: the rolled-up counts, the per-node view models, and the
// summary sentences.
//
// Extracted from pages/Mindtree.tsx unchanged. It computes no policy:
// lib/mindtree/model.ts owns the tree, and what is here is the wiring that
// decides what to hand it.
//
// EVERY PERSISTED CHOICE LIVES IN `store/mindtree.ts`, under the SAME
// localStorage key the page used to own (`opstrack_mindtree_v1`). It was moved
// rather than duplicated, and the difference matters: two modules validating one
// key is two schemas that drift, and the store's version is strictly the better
// one — it bounds the persisted arrays (a hand-edited blob cannot make the first
// paint interesting), it keeps unknown dimension keys instead of destroying a
// newer build's state, and it clears on sign-out, which a module-level
// `readPrefs()` in a page could never do.
//
// TWO AXES ARRIVE FROM TWO PLACES, and the asymmetry is the point. `dimension`
// — what the ENTRIES bucket by — is a persisted preference and comes from the
// store above. `grouping` — what the ORGANIZATIONS bucket by — is `?by=`, which
// lives only in the address bar because it is which question the reader is
// asking right now rather than how they like their map (useMapUrl.ts's "the
// portfolio half of the codec" argues it in full). So it arrives as an argument,
// from the one shell reading that the portfolio's table also uses: one value,
// two readers, and the picture and the table can never be cut two ways at once.
//
// WHAT IT DOES NOT DO. It reads the entries store like every other screen and
// never runs its own query, so PostgREST's 1000-row clamp is honoured by
// inheritance and the truncation notice is the store's own flag. It picks no
// colour: every hue arrives as the `--track-c-*` pair the model stapled on.

import { useCallback, useEffect, useMemo } from 'react'
import type { MindNodeView } from '../../components/mindtree/MindNode'
import { isolate } from '../../lib/bidi'
import type { IsoDate } from '../../lib/dates'
import type { FilterState } from '../../lib/entryFilter'
import { t } from '../../lib/i18n'
import { useKindLabel, useNodeLabel, useStageLabel, useTrackLabel } from '../../lib/labels'
// ALIASED, for the reason MapBranchDetail.tsx and lib/mapNodes.test.ts both
// state at their own imports: `useCaseProgress` is a PURE FUNCTION whose name
// matches oxlint's Hook heuristic (`use` + a capital), so calling it from the
// plain recursive walk below is a `react-hooks/rules-of-hooks` error under its
// own name.
import {
  entityIdOf,
  stageIndex,
  useCaseProgress as computeUseCaseProgress,
  type StageIndex,
  type UseCaseProgress,
} from '../../lib/mapNodes'
// THE SHARED ARITHMETIC. `stageReading` and the quiet fold's two halves are the
// portfolio table's own expressions, exported from a pure module so that the
// card, the table, the chip badge and the org panel cannot come to hold four
// slightly different answers to "how long has this organization been here".
import {
  NO_STATS,
  minQuiet,
  quietLeafDays,
  stageReading,
  type NodeStats,
} from '../../lib/portfolio/fields'
import type { PortfolioBy } from '../../lib/mindtree/lens'
import { DEFAULT_NODE_SIZE, sizeForCount, type NodeSize } from '../../lib/mindtree/layout'
import {
  KIND_ROLE,
  MIND_DIMENSIONS,
  MIND_GROUPINGS,
  RING_CAP,
  RING_CAP_COMPACT,
  ROOT_ID,
  buildMindtree,
  groupTotals,
  type MindEntity,
  type MindEntityFacet,
  type MindGrouping,
  type MindLabel,
  type MindNode as MindNodeModel,
  type MindTrack,
  type MindVocabOption,
} from '../../lib/mindtree/model'
import {
  loadEntries,
  loadTrackSlas,
  useEntriesError,
  useEntriesLoading,
  useEntriesLoadedOnce,
  useEntriesTruncated,
  useEntryList,
  useEntryMap,
  useFilterContext,
  useHealthMap,
} from '../../store/entries'
import {
  useMindCollapsedIds,
  useMindDensity,
  useMindDimension,
  useMindExpandedIds,
  useMindFocus,
  useMindHoveredId,
  useMindIsDragging,
  useMindSelection,
  useMindSelectionCount,
  useMindView,
} from '../../store/mindtree'
import {
  useAllUseCases,
  useMapNodeKinds,
  useMapNodeMap,
  useMapNodeStages,
  useMapNodes,
  useNodeProgress,
  useStageMap,
  useTracks,
} from '../../store/config'
import { mergeProgress, usePendingStages } from '../../store/stageOverlay'
import { useMemberMap, useMembers, memberLabel } from '../../store/members'
import { useVocabAll, useVocabLabel } from '../../store/vocab'
import { useAuth } from '../../store/auth'
import type {
  Entry,
  MapNodeProgress,
  MapNodeUseCase,
  UseCase,
  UseCaseStatus,
  UserRole,
} from '../../types'

/* ───────────────────────────────── the tree ──────────────────────────────── */

/**
 * The per-node roll-up, RE-EXPORTED rather than declared here.
 *
 * It moved to lib/portfolio/fields.ts because the four facts on it that are not
 * counts — the stage triad and the quiet clock — are the same four the portfolio
 * table and the org panel print, and a type that is the contract between three
 * surfaces cannot live inside one page's hook. The re-export keeps every
 * existing importer (`MapCanvas`, `MindtreeTable`, the tests) reading it from
 * where it has always read it.
 */
export { NO_STATS }
export type { NodeStats }

/** Everything `collectStats` needs and cannot know. All of it injected. */
export interface StatsInput {
  /**
   * `useEntryMap()`. Widened from the `unknown` value it used to hold, because
   * the quiet fold reads `last_activity_at` off the entry rather than merely
   * asking whether the filter kept it.
   */
  entryById: ReadonlyMap<string, Entry>
  isUnassigned: (id: string) => boolean
  /** `stageIndex(mergedProgress, stageById)` — the OVERLAY-MERGED rows. */
  stages: StageIndex
  progressById: ReadonlyMap<string, Pick<MapNodeProgress, 'stage_changed_at'>>
  fallbackStallDays: number | null
  /** The reader's instant, for lib/lifecycle. This module holds no clock. */
  now: Date
  /** The same instant as a calendar day, for the quiet fold. */
  today: IsoDate
}

/**
 * Roll every per-node fact the picture and the panel share up the tree, in ONE
 * post-order pass.
 *
 * The model carries `slaBreached` as a BOOLEAN on every branch — deliberately,
 * because the map's budget is a binary mark and "3 breached" is a number the
 * table carries. Both accessible names need the number, so it is counted here,
 * once, and handed to the picture and the table together. Two passes would be
 * two arithmetics that disagree under exactly the conditions nobody tests.
 *
 * `unassigned` needs the Entry itself (the model deals in counts, not columns),
 * which is why `entryById` is threaded in rather than the whole working set:
 * the tree already decided which rows survived the filter.
 *
 * ── THE TWO FACTS THIS PASS GAINED, AND THEIR TWO DIFFERENT SCOPES ────────
 *
 * `quietDays` is the SUBTREE MINIMUM over entry leaves, and it folds exactly
 * like the counts above it: one `minQuiet` per child, `null` — never 0 — where
 * nothing has ever been filed, and through folds and collapsed branches alike,
 * because a silence that changed when somebody clicked a branch open would be
 * reporting the picture rather than the workspace.
 *
 * THE STAGE TRIAD DOES NOT FOLD. `daysInStage`, `atRisk` and `stallDays` are
 * `map_nodes`-keyed facts read through `stageReading` — the SAME function the
 * portfolio's table and its chip badge read — and they are populated on ENTITY
 * nodes and left null/false everywhere else. A track is not standing on a rung
 * and neither is a status bucket; inventing an aggregate for one would put a
 * number on a card that no column anywhere prints. One `stageReading` per
 * organization, in the pass that was already visiting it, with no allocation
 * beyond the stats object this walk already makes per node.
 */
export function collectStats(
  node: MindNodeModel,
  input: StatsInput,
  out: Map<string, NodeStats>,
): NodeStats {
  if (node.kind === 'entry') {
    const id = node.entryId
    const entry = id === null ? undefined : input.entryById.get(id)
    const stats: NodeStats = {
      breached: node.health.slaBreached ? 1 : 0,
      unassigned: id !== null && entry !== undefined && input.isUnassigned(id) ? 1 : 0,
      orgs: 0,
      // An entry is work filed AGAINST an organization, never one — so it holds
      // none below it and stands on no rung of its own.
      orgsBelow: 0,
      liveBelow: 0,
      riskBelow: 0,
      live: false,
      // A LEAF IS THE ONLY THING THAT MEASURES SILENCE, and an entry the filter
      // kept out of the working set contributes nothing rather than a zero.
      daysInStage: null,
      atRisk: false,
      stallDays: null,
      quietDays: entry === undefined ? null : quietLeafDays(entry.last_activity_at, input.today),
    }
    out.set(node.id, stats)
    return stats
  }
  let breached = 0
  let unassigned = 0
  /**
   * `entityIdOf`, NOT `kind === 'entity'`, and the difference is the whole point
   * of the synthetic kind. A cohort is a structural node holding organizations,
   * so a `kind`-shaped test here would have to name every kind that is NOT one;
   * lib/mapNodes.ts's `entityIdOf` answers the narrower question this count is
   * actually asking — is there a `map_nodes` row behind this node — and it is
   * the one function that may ever turn a node into a real id.
   */
  const entityId = entityIdOf(node)
  let orgs = entityId === null ? 0 : 1
  let quietDays: number | null = null
  /**
   * THE THREE THAT COUNT ORGANIZATIONS RATHER THAN ROWS — see `NodeStats.orgsBelow`
   * for why they are not `orgs`, and read the child's answer rather than the
   * child's kind for which of the two arms it takes.
   *
   * `ends` IS THE END OF THE DIVE, ASKED OF THE CHILD AND NOT OF ITS NAME.
   * `map_nodes` gives a directorate and a hospital the same `entity` kind
   * (mapNodes.ts's `entityIdOf` is the only reader of that), so the thing that
   * makes one an organization is that nothing under it is one — the identical
   * test `MindNode` makes for `terminal`, written here as `orgsBelow === 0`
   * because the walk has just finished answering it. A child that ends the
   * hierarchy contributes ITSELF and its own rung; a child that holds
   * organizations contributes THEIRS and never its own, so a department is never
   * counted among the things it holds.
   */
  let orgsBelow = 0
  let liveBelow = 0
  let riskBelow = 0
  for (const child of node.children) {
    const stats = collectStats(child, input, out)
    breached += stats.breached
    unassigned += stats.unassigned
    orgs += stats.orgs
    quietDays = minQuiet(quietDays, stats.quietDays)
    const ends = entityIdOf(child) !== null && stats.orgsBelow === 0
    orgsBelow += ends ? 1 : stats.orgsBelow
    liveBelow += ends ? (stats.live ? 1 : 0) : stats.liveBelow
    riskBelow += ends ? (stats.atRisk ? 1 : 0) : stats.riskBelow
  }
  // The same `entityIdOf` answer the org count above was made from, reused
  // rather than asked twice: one node is one organization or it is none, and
  // two calls are two places a synthetic key could be read differently.
  const reading = entityId === null ? null : stageReading(entityId, input)
  const stats: NodeStats = {
    breached,
    unassigned,
    orgs,
    orgsBelow,
    liveBelow,
    riskBelow,
    // `stage.terminal`, never the last rung and never the word: the ladder is
    // draggable and the column is the fact. Null-safe because a node whose rung
    // the ladder cannot resolve is not standing on a terminal one either.
    live: reading?.stage?.terminal === true,
    daysInStage: reading?.days ?? null,
    atRisk: reading?.atRisk ?? false,
    stallDays: reading?.stallDays ?? null,
    quietDays,
  }
  out.set(node.id, stats)
  return stats
}

/* ──────────────────────────── the size encoding ───────────────────────────── */

/**
 * The size the count encoding stops growing at — 1.5x `DEFAULT_NODE_SIZE` on
 * BOTH axes, which is 2.25x the area (1.5²), and that is the whole dynamic
 * range the map spends on "amount of work".
 *
 * WHY 1.5 AND NOT MORE — and the price even 1.5 turned out to carry. `worlds.ts`
 * makes a card's world proportional to its DIAGONAL, so every extra percent of
 * card is an extra percent of the ring its siblings pack into and an extra
 * percent the camera has to pull back to frame it. 168x44 -> 252x66 grows a
 * leaf's diagonal from 173.7 to 260.5 units, exactly 1.5x; measured end to end
 * through `npm run lookat`, a whole tree sized this way costs 26% of the camera
 * scale on the 19-org fixture (3.250e-1 -> 2.389e-1) and 25% on the 400-org one
 * (8.772e-2 -> 6.612e-2). Past 1.5 the busiest branch starts pushing its own
 * siblings out of the `card` band, which trades a magnitude nobody asked to read
 * for six names the reader came for.
 */
const MAX_NODE_SIZE: Readonly<NodeSize> = Object.freeze({
  width: DEFAULT_NODE_SIZE.width * 1.5,
  height: DEFAULT_NODE_SIZE.height * 1.5,
})

/**
 * Give every node a card size from its count, RELATIVE TO ITS OWN SIBLINGS.
 *
 * `sizeForCount`'s `fullAt` has been a dead default of 50 since it was written,
 * and its own doc block says what it should be: "Pass the busiest count in the
 * current picture." At 400 organizations a fixed 50 makes nearly every branch
 * clamp to `max` and the channel encodes NOTHING — which is the state this map
 * shipped in.
 *
 * PER-RING, NOT PER-TREE, and that is forced by the drawing rather than chosen.
 * A containment map nests a child INSIDE its parent, so a card is only ever seen
 * beside its siblings; comparing a 40-item Organization against a 300-item track
 * is a comparison the picture never puts in front of anyone's eye. Siblings are
 * the comparison set, so siblings set the scale.
 *
 * NOTHING IS WRITTEN WHEN THE BUSIEST SIBLING HOLDS 1 OR 0. `fullAt <= 1`
 * collapses `sizeForCount`'s span to zero and it answers `max` for every count,
 * so a ring where everyone holds one item would draw every card at 252x66 — a
 * whole ring inflated 2.25x to say that nothing differs. Leaving the entry out
 * lets `layoutWorlds` fall back to `nodeSize`, which IS the floor, so the ring
 * draws at 168x44 and says the same true thing in less ink.
 *
 * The tree ROOT never gets an entry (it is nobody's child). The DRAWN root also
 * has to be excluded, and it cannot be excluded here because which node that is
 * depends on the drill-in — the caller's `sizeOf` drops `depth === 0`.
 *
 * ⚠ NOT WIRED, 2026-08-13, and the reason is measured rather than pending.
 * Handing this to `layoutWorlds` as `sizeOf` turns the permanent render gate red
 * on two assertions: `MindNode` authors every mark in the units of a 168-wide
 * leaf, so a card resized to 252 draws its 12.5px label at 168/252 = 0.667x the
 * fraction of its own card the contract owes — and, because a card's world is
 * proportional to its diagonal, the camera pulls back and the smallest text on
 * the glass falls 3.738px → 2.748px (19-org fixture) and 4.184px → 2.807px
 * (400-org) — and at 375px the phone's framed ring drops from `card=3` to
 * `card=2 chip=1`, which is one organization in three losing its NAME. The
 * encoding has to grow the node's WORLD and let `cardScale = worldD / ownD`
 * carry the marks with it — `worlds.ts`'s two card rules, wave 1's frozen
 * contract. Mindtree.tsx's `layout` memo carries the same note and the one line
 * that activates this; the arithmetic is pinned in `useMapModel.test.ts` so it
 * cannot rot while it waits.
 */
export function collectSizes(node: MindNodeModel, out: Map<string, NodeSize>): void {
  const children = node.children
  if (children.length > 0) {
    let fullAt = 0
    for (const child of children) if (child.count > fullAt) fullAt = child.count
    if (fullAt > 1) {
      for (const child of children) {
        const size = sizeForCount(child.count, {
          min: DEFAULT_NODE_SIZE,
          max: MAX_NODE_SIZE,
          fullAt,
        })
        out.set(child.id, size)
      }
    }
  }
  for (const child of children) collectSizes(child, out)
}

/* ─────────────────────────── the progress encoding ────────────────────────── */

/**
 * Where the capability links come from, and the word that counts as finished.
 *
 * A PARAMETER RATHER THAN A STORE READ, because there is no store to read.
 * `map_node_use_cases` is deliberately absent from store/config (its header:
 * "That is DATA, not configuration") and `api/map.ts`'s `listNodeUseCasesFor`
 * says in as many words "NOT ON BOOT ... The portfolio surface opens it
 * deliberately (`src/store/portfolio.ts`, wave 3) and pays for it". The map is
 * the app's landing screen, so a read fired from this hook IS boot.
 *
 * So the derivation below is complete and the SOURCE is injected. `null` means
 * "nobody has read the links", which is not the same fact as "there are no
 * links": with `null` every node's `progress` is absent and the underscore is
 * not drawn, where an empty array would draw `0 of 90 live` on every card and
 * state as fact something nobody has looked up. That is the same
 * absence-is-a-value rule `map_node_progress` is built on.
 *
 * `terminalKey` and `terminalWordKey` travel WITH the links rather than being
 * restated here: lib/mapNodes.ts's header is explicit that the literal `'live'`
 * lives at one call site (MapBranchDetail.tsx's `TERMINAL_STATUS`), and a second
 * copy in this file is the exact failure that header exists to prevent.
 */
export interface MapProgressSource {
  readonly links: readonly MapNodeUseCase[]
  /** MapBranchDetail.tsx's `TERMINAL_STATUS`. */
  readonly terminalKey: UseCaseStatus
  /** The locale key for that status as a WORD — `mapnode.wordLive`. */
  readonly terminalWordKey: string
}

/**
 * Roll `useCaseProgress` up the tree, in ONE post-order pass.
 *
 * The alternative — asking each node for the links beneath it — is O(n²) at the
 * 3,200 nodes a 400-organization workspace builds, because every link is walked
 * once per ancestor per node. This walks each link once per ANCESTOR (at most
 * six, the frozen depth cap) and calls the fold once per node that can carry the
 * mark.
 *
 * `links.push(...below.links)` IS NOT USED and the reason is a measurement: the
 * root of a 400-org workspace holds ~4,000 links, and spread-as-arguments puts
 * every one of them on the call stack at once. A loop has no such ceiling.
 *
 * WHO GETS A `progress` AND WHO DOES NOT. Entries are ISSUES, not
 * organizations — "3 of 9 live" under one bug report is a category error — and a
 * "+N more" fold is a control. Both are skipped, and so is any branch with no
 * Organization beneath it at all: a track holding only entries would otherwise
 * announce `0 of 0`, and `useCaseProgress` floors `nodes` at 1 precisely so that
 * one panel's zero reads as `0 of 9`. That floor is right for a panel and wrong
 * for a track that has no organizations to be at zero.
 *
 * THE DENOMINATOR IS THE POPULATION, NOT THE LINKS — `useCaseProgress`' fourth
 * argument, landed in wave 3 with the store that feeds this source. `nodeIds` is
 * every Organization beneath the node, so one that has recorded nothing adds a
 * column of zeroes instead of shrinking the number. It is computed here anyway
 * because it is also the guard below, and computing it twice is how the two
 * would drift.
 */
export function collectProgress(
  node: MindNodeModel,
  catalogue: readonly UseCase[],
  terminalKey: string,
  linksByNode: ReadonlyMap<string, readonly MapNodeUseCase[]>,
  out: Map<string, UseCaseProgress>,
): { links: MapNodeUseCase[]; nodeIds: string[] } {
  const links: MapNodeUseCase[] = []
  const nodeIds: string[] = []

  const own = entityIdOf(node)
  if (own !== null) {
    nodeIds.push(own)
    const rows = linksByNode.get(own)
    if (rows !== undefined) for (const row of rows) links.push(row)
  }
  for (const child of node.children) {
    const below = collectProgress(child, catalogue, terminalKey, linksByNode, out)
    for (const row of below.links) links.push(row)
    for (const id of below.nodeIds) nodeIds.push(id)
  }

  // KIND_ROLE, NOT TWO `!==` COMPARISONS, and this is one of the sites wave 6
  // converted for one reason: a new `MindNodeKind` has to be a COMPILE error
  // everywhere the kinds are read, and `kind !== 'entry' && kind !== 'more'`
  // silently absorbs every kind that is ever added.
  //
  // `=== 'place'` AND NOT `!== 'leaf'`, which are different predicates and only
  // one of them preserves the behaviour this line shipped with: `more` is a
  // `'bucket'`, not a `'leaf'`, so the negative form would start drawing a
  // fraction on a "+N more" fold — a control, announcing "3 of 9 live" about a
  // list it is hiding. The question is the positive one anyway: a fraction
  // belongs to a PLACE — the workspace, a track, an organization, a cohort of
  // them — and a cohort earns it here, which is what makes "6 of 9 live" true of
  // an account manager's whole book. Buckets of entries never hold an
  // organization, so the `nodeIds.length > 0` guard already excluded them.
  if (nodeIds.length > 0 && KIND_ROLE[node.kind] === 'place') {
    // THE FOURTH ARGUMENT IS THE POPULATION, and this is the line the seam note
    // above was about: `nodeIds` is every Organization beneath this branch,
    // including the ones that have recorded nothing, so a Phase of forty where
    // three have rows reads `18 of 400` instead of `18 of 27`.
    //
    // Mapped to `{ id }` here rather than carried that way through the walk: the
    // ids are also the guard on the line above and the accumulator two lines
    // down, and one shape for both is what stops the two from drifting. The
    // allocation is bounded by the frozen depth cap — each id is re-wrapped once
    // per ancestor, at most six.
    out.set(
      node.id,
      computeUseCaseProgress(
        catalogue,
        links,
        terminalKey,
        nodeIds.map((id) => ({ id })),
      ),
    )
  }
  return { links, nodeIds }
}

/* ────────────────────── one `?by=`, two things to draw ────────────────────── */
//
// THE PICTURE AND THE TABLE READ ONE VALUE, and the value is the address bar's.
//
// `?by=` is the portfolio's control (lib/mindtree/lens.ts's `PortfolioBy`) and it
// is ALSO the canvas's cohort key. Two unions describe it because the two
// surfaces can answer different questions with it — a table can group rows by
// "Progress" where a ring cannot, and the model's ladder reaches for `type` on
// overflow where no chip ever asks for it — so what unifies them is a TOTAL
// MAPPING rather than a shared union. One value, two readers: a reader who taps
// Team on the table and switches to the map finds the AM rings already drawn.
//
// `phase` → `'none'` IS THE ONE INTERESTING ROW and it is not a shrug. On the
// table, `by=phase` asks how far along the programme is; on the canvas that
// question is ALREADY the drawing — phases are real `map_nodes` and they are
// rings the reader is standing in — so there is nothing left for a synthetic
// cohort to add. Grouping by it a second time would draw a ring named after the
// ring it sits inside. The progress underscore is the canvas's answer to that
// question and it is drawn on every card regardless of `?by=`.
//
// `type` HAS NO CHIP AND THAT IS DELIBERATE. It is a LADDER key: `groupEntities`
// reaches for it when an AM's own cohort is still over the cap, which is how 400
// organizations become "6 named type cards, one dive to 22 named orgs". Nothing
// in the URL asks for it, so nothing in the toolbar offers it — a control for a
// state the URL cannot spell is a control whose chip cannot light after a
// reload.

/**
 * What each `?by=` means to the DRAWING. Total over `PortfolioBy`, so a value
 * parsed out of a hostile address bar always names a grouping.
 */
export const GROUPING_FOR_BY: Readonly<Record<PortfolioBy, MindGrouping>> = Object.freeze({
  stage: 'stage',
  manager: 'manager',
  vendor: 'vendor',
  phase: 'none',
})

/**
 * The inverse, INVERTED RATHER THAN WRITTEN OUT — which is what makes the
 * round-trip (chip → `?by=` → chip) true by construction instead of by review.
 * A grouping the URL cannot spell is simply absent, and `CANVAS_GROUPINGS` below
 * is defined as "the ones this map has".
 */
export const BY_FOR_GROUPING: Readonly<Partial<Record<MindGrouping, PortfolioBy>>> = Object.freeze(
  Object.fromEntries(
    Object.entries(GROUPING_FOR_BY).map(([by, grouping]) => [grouping, by as PortfolioBy]),
  ) as Partial<Record<MindGrouping, PortfolioBy>>,
)

/**
 * The groupings the toolbar may offer, IN `MIND_GROUPINGS` ORDER — the model's
 * own order, so the chips read in the order the axis is declared rather than in
 * the order the URL happens to list its values.
 *
 * Derived rather than listed for the same reason `BY_FOR_GROUPING` is inverted:
 * a sixth grouping that the URL can carry appears here on its own, and one that
 * the URL cannot carry never does.
 */
export const CANVAS_GROUPINGS: readonly MindGrouping[] = Object.freeze(
  MIND_GROUPINGS.filter((g) => BY_FOR_GROUPING[g.key] !== undefined).map((g) => g.key),
)

/** One frozen empty set, so the memo below has a stable reference to return. */
const EMPTY_IDS: ReadonlySet<string> = new Set<string>()

/**
 * ⚠ THE MAP USED TO OPEN AT `OPEN_DEPTH = 1` — root plus tracks, EVERY TRACK
 *   CLOSED — and on the real workspace that drew exactly three cards:
 *   "NphiesCore", "UHR" and "No track". A hundred and four organizations were
 *   in the tree and none of them was on the screen. The root's own label read
 *   "104 organizations, 82 of 1050 live" above a picture showing none of them,
 *   which is the "labelled 12, showing 3" failure this module spends its
 *   comments avoiding, arrived at from the other end.
 *
 *   The old constant was not wrong when it was written and its arithmetic is
 *   still in model.ts: six tracks × five populated statuses is thirty group
 *   nodes, which fit only at 0.31 and render a 12.5px label at 3.9px. But every
 *   term in it belongs to a drawing that no longer exists — "ring 2", the
 *   radial fit — and to a workspace with six populated tracks. This one has ONE
 *   active track, no grouping on the canvas by default, and its content is not
 *   dimension buckets but organizations.
 *
 * SO IT IS DERIVED, NOT REPLACED WITH A DIFFERENT NUMBER. `openDepth: 3` would
 * be right for exactly today's hierarchy — root ▸ track ▸ programme ▸
 * organization — and would hide everything again the day somebody inserts a
 * phase. The rung is read off the hierarchy itself, so a workspace that grows a
 * tier gets the same reading of it for free.
 *
 * ── AND IT IS ONE RUNG SHALLOWER THAN THE DEEPEST ENTITY, WHICH IS THE HALF
 *    THAT CHANGED ─────────────────────────────────────────────────────────────
 *
 * This used to return `2 + deepest`: open far enough that every ENTITY is drawn,
 * on the argument that the entities are what a reader came to look at. The
 * argument was right and the arithmetic overshot it. On this workspace "every
 * entity" is 161 organizations, and `useMapGeometry`'s opening fit has no
 * minimum scale — it fits whatever is drawn — so the first paint settled at
 * 0.44: a 168×54 card at 74×24 CSS px carrying a 12.5px label at 5.5px. On a
 * 375px phone the same paint is 1.9px. That is the identical failure the block
 * above describes, reached from the far end — the reader is shown everything and
 * can read none of it — and it is what the owner meant by "make it easier".
 *
 * ONE RUNG SHALLOWER IS THE WHOLE FIX, because `openDepth` closes a branch
 * rather than hiding it: `model.ts` starts a branch at depth >= openDepth
 * CLOSED, so the deepest rung is still DRAWN, still counted, still one tap from
 * its contents. What changes is how many cards share the frame — the
 * departments, not everything filed under them — and therefore how large each
 * one is fitted. The reader opens the one they want, which is the gesture the
 * tree is for.
 *
 * ⚠ THE FLOOR IS NOT DECORATION. `Math.max(2, …)` is what keeps the original
 *   defect out: a workspace whose entities are one level deep would otherwise
 *   ask for depth 1, which is root plus closed tracks — the three cards this
 *   header opens with. Two is the shallowest reading that still shows a reader
 *   something they came for, and the floor binds exactly there and nowhere else.
 *
 * Entities start at tree depth 2 (root 0, track 1), so an entity forest `d`
 * levels deep drew everything at `2 + d` and now opens at `1 + d`, never below
 * 2.
 */
export function openDepthFor(entities: readonly MindEntity[]): number {
  const parentOf = new Map<string, string | null>()
  for (const e of entities) parentOf.set(e.id, e.parentId)
  let deepest = 0
  for (const e of entities) {
    let d = 0
    let at = e.parentId
    // Bounded by the number of entities: a cycle in `parent_id` is impossible
    // through the API (0029's depth trigger) and would otherwise spin here.
    for (let hops = 0; at !== null && hops <= entities.length; hops += 1) {
      d += 1
      at = parentOf.get(at) ?? null
    }
    if (d > deepest) deepest = d
  }
  // See the header for both terms: `1 + deepest` opens the rung ABOVE the
  // deepest entity (which is drawn, closed), and the floor is the guard against
  // re-opening on three closed tracks.
  return Math.max(2, 1 + deepest)
}

/**
 * INFERRED, not declared. Every field here is a store's own type and this hook
 * narrows none of them; writing the shape by hand would be a second copy of
 * eight stores' signatures, and the first place a `Member` or a `FilterContext`
 * would drift from the module that owns it.
 */
export type MapModel = ReturnType<typeof useMapModel>

export function useMapModel(
  compact: boolean,
  locale: string,
  filter: FilterState,
  /**
   * The capability links behind the progress underscore, or `null` while
   * nobody has read them. See `MapProgressSource` for why this arrives as an
   * argument instead of being fetched here.
   */
  progressSource: MapProgressSource | null,
  /**
   * `?by=`, EXACTLY AS THE PORTFOLIO READ IT — a parameter for the same reason
   * `filter` is one. It lives only in the address bar (useMapUrl.ts's "the
   * portfolio half of the codec" says why it has no store), the shell already
   * holds it because the lens chip's badge is counted at that level, and a
   * second `useSearchParams()` reading inside this hook would be a second
   * chance to disagree with the table about what the reader asked for.
   *
   * It arrives as `PortfolioBy` rather than as a `MindGrouping` so that the
   * mapping happens ONCE, here, and `grouping` comes back out of this hook as
   * the single answer the toolbar lights its chip from.
   */
  by: PortfolioBy,
) {
  /* ── the persisted half, from the store ───────────────────────────────── */

  const dimension = useMindDimension()
  const view = useMindView()
  const density = useMindDensity()
  const focusPref = useMindFocus()
  const collapsedPref = useMindCollapsedIds()
  const expandedIds = useMindExpandedIds()

  /* ── the session half, which is the ADDRESS BAR's ─────────────────────── */
  //
  // THE FILTER IS A PARAMETER, NOT STATE. It is read from the URL by
  // `useMapUrlFilter`, which the shell calls before this hook for exactly this
  // reason: a `useState` copy here is a second writer of one value, and while
  // it held one the map was the only filtering screen in the app whose filter
  // did not survive a reload or a paste.

  const entries = useEntryList()
  const health = useHealthMap()
  const entryById = useEntryMap()
  const tracks = useTracks()
  /**
   * The hierarchy rows behind the `entity` nodes — WHO RUNS EACH ORGANIZATION.
   *
   * Read here rather than inside a component because the second line an
   * Organization draws at its deepest zoom is part of its VIEW MODEL: built once
   * per tree in the same walk as the label and the accessible name, not
   * re-resolved by a few hundred nodes on every pan frame.
   */
  const mapNodeById = useMapNodeMap()
  /**
   * EVERY node, archived included — `buildMindtree` requires the whole list and
   * decides for itself what a retired branch looks like, exactly as it does for
   * tracks. Filtering here would hand it a forest with holes in it, and a child
   * whose parent had been filtered out would silently re-root at its track.
   */
  const mapNodes = useMapNodes()
  const nodeKinds = useMapNodeKinds()
  /**
   * The capability catalogue behind the progress underscore's DENOMINATOR.
   *
   * `useAllUseCases`, hidden rows included, which is the same call the Org panel
   * makes and for the same reason lib/mapNodes.ts's header argues at length: a
   * capability retired from the pickers must keep counting for the
   * organizations already recorded against it, or an admin tidying the
   * catalogue would move every number on the map without anything changing.
   *
   * Read from the store rather than travelling in `progressSource` because the
   * catalogue IS configuration — store/config loads it on boot for every screen
   * — and only the LINKS are the read that has to be paid for.
   */
  const catalogue = useAllUseCases()
  /**
   * WHERE EACH ORGANIZATION HAS GOT TO — `map_node_progress`, keyed by node id.
   *
   * One of the five columns the cohort pass groups by, and the only one that is
   * not on the `map_nodes` row itself: 0026 put the stage on a member-writable
   * side table so an account manager can move an organization without holding
   * `structure.edit`. `undefined` for a node nobody has said anything about is
   * the answer, not a miss — store/config's own ⚠ — and it travels into the
   * model as `stage: null`, where it becomes a cohort of its own rather than
   * being quietly filed under the first rung.
   */
  const progressByNodeId = useNodeProgress()
  /** The ladder itself, in `sort_order` — the `by=stage` ring's order. */
  const mapNodeStages = useMapNodeStages()
  /** The ladder BY ID, which is the half `stageIndex` needs. */
  const stageById = useStageMap()
  /**
   * What THIS TAB has written about where an organization got to and the store
   * has not confirmed yet — store/stageOverlay.
   *
   * READ HERE, at the top of the model, rather than downstream of it: the rung
   * an account manager chose a second ago is the rung every surface must clock
   * from, and a stats walk reading the store's rows alone would put "68 days"
   * beside a rung reached just now, which reads as the write having failed.
   */
  const pendingStages = usePendingStages()
  const members = useMembers()
  const memberById = useMemberMap()
  const ctx = useFilterContext()
  /**
   * THE ONE INHERITANCE, BORROWED RATHER THAN RE-DERIVED.
   *
   * `store/entries` walks every node's ancestors once and publishes what a node
   * INHERITS: the chain, the integrator, the accountable person. Everything on
   * this screen that says "vendor" or "account manager" reads these two maps —
   * the cohort rings, the card's second line, the org panel and the portfolio's
   * rows — so the picture and the filter can never disagree about which
   * organizations belong to Acme. They are optional on `FilterContext`, so every
   * read below coalesces to the node's own column.
   */
  const { vendorOfNode, managerOfNode } = ctx
  const loading = useEntriesLoading()
  const error = useEntriesError()
  const truncated = useEntriesTruncated()
  /**
   * Has the working set landed once? Gates the drill-in reconciler in
   * useMapFocus — see there, and `store/entries.useEntriesLoadedOnce` for why
   * `!loading` is not the same question.
   */
  const entriesLoaded = useEntriesLoadedOnce()
  const trackLabelOf = useTrackLabel()
  const nodeLabelOf = useNodeLabel()
  const kindLabelOf = useKindLabel()
  const stageLabelOf = useStageLabel()
  const vocabLabelOf = useVocabLabel()
  const { profile } = useAuth()
  /**
   * `null`, never a stand-in id — pages/Board.tsx's rule, restated because the
   * consequence here is a drag rather than a card: `canEditEntry` tests the
   * signed-out case FIRST and answers false, which is what keeps a leaf
   * un-liftable in the moment between mount and the profile arriving. A
   * placeholder would satisfy the open branch's `!!meId` and hand out a gesture
   * the server would then refuse.
   */
  const meId = profile?.id ?? null
  const role: UserRole = profile?.role ?? 'member'

  const hoveredId = useMindHoveredId()
  const selection = useMindSelection()
  const selectionCount = useMindSelectionCount()
  const dragging = useMindIsDragging()

  // Both are read unconditionally — hooks cannot be called in a branch — and
  // the active one is picked below. `useVocabAll`, not `useVocab`: the hidden
  // options matter here, because an entry still holding a retired status must
  // land in its own branch rather than arriving as an undeclared value.
  const statusVocab = useVocabAll('status')
  const priorityVocab = useVocabAll('priority')

  useEffect(() => {
    void loadEntries()
    // Deduped in the store: the Shell warms both on sign-in, and a second call
    // from a screen that genuinely needs them costs nothing.
    void loadTrackSlas()
  }, [])

  /* ── inputs to the model ──────────────────────────────────────────────── */

  const mindTracks = useMemo<MindTrack[]>(
    () =>
      tracks.map((track) => ({
        id: track.id,
        // The localised name, never the raw column — lib/labels.trackLabel.
        label: trackLabelOf(track),
        color: track.color,
        colorLight: track.color_light,
        sortOrder: track.sort_order,
        archived: track.archived,
      })),
    [tracks, trackLabelOf],
  )

  /**
   * The hierarchy, as the model takes it.
   *
   * ROW SHAPE IN, VIEW MODEL OUT, and the two things this does are exactly the
   * two `mindTracks` above does: resolve the label for the locale, and drop the
   * columns the model has no business seeing. `vendor`, `account_manager_id`,
   * `source` and the sync columns stay out — a node's integrator is a fact the
   * PANEL shows, and a model that carried it would invalidate the whole tree
   * every time somebody typed a character into that field.
   *
   * `typeKey` is the kind's name RESOLVED FOR THE LOCALE, and it is a caption:
   * lib/labels.kindLabel says at length why nothing may branch on it. A kind
   * that was deleted leaves `kind_id` pointing at nothing (`on delete set null`
   * is the FK, but a stale first-paint cache can also carry an id the kinds list
   * no longer has), so a missing kind reads as null rather than throwing.
   */
  const mindEntities = useMemo<MindEntity[]>(() => {
    const kindById = new Map(nodeKinds.map((kind) => [kind.id, kind]))
    return mapNodes.map((node) => {
      const kind = node.kind_id === null ? undefined : kindById.get(node.kind_id)
      return {
        id: node.id,
        trackId: node.track_id,
        parentId: node.parent_id,
        label: nodeLabelOf(node),
        sortOrder: node.sort_order,
        archived: node.archived,
        typeKey: kind === undefined ? null : kindLabelOf(kind),
      }
    })
  }, [mapNodes, nodeKinds, nodeLabelOf, kindLabelOf])

  /** How deep to open, read off the hierarchy itself — see `openDepthFor`. */
  const openDepth = useMemo(() => openDepthFor(mindEntities), [mindEntities])

  /**
   * THE FIVE COLUMNS A COHORT MAY BE CUT ALONG, and not a sixth.
   *
   * A SEPARATE MEMO FROM `mindEntities`, AND THE SPLIT IS THE POINT. That memo's
   * own header refuses to carry `vendor` and `account_manager_id` — "a model
   * that carried it would invalidate the whole tree every time somebody typed a
   * character into that field" — and the refusal still stands for the SHAPE of a
   * node. What changed in wave 6 is that those two columns became the shape of a
   * RING: `?by=vendor` groups organizations by the string. So they arrive as
   * facets, in their own object, listed one by one:
   *
   *   id · account_manager_id · kind (as a caption) · vendor · stage
   *
   * Five fields, enumerated rather than spread, so that `notes`, `external_url`,
   * `synced_at` and every column 0028 adds next cannot reach model.ts by
   * accident. The model can only ever branch on what it was handed, which is
   * what makes "grouping is a model.ts concern" a claim with a boundary rather
   * than a preference — and a description edit rewrites no field on this list.
   *
   * `typeKey` IS A CAPTION AND NOTHING MAY BRANCH ON ITS WORDS — the same
   * sentence `mindEntities` writes above it, and here it has teeth: two kinds
   * that a translator gives one name to are ONE cohort, which is the honest
   * behaviour (the reader is grouping by what the chip says), and a kind that
   * was deleted reads as null, which is its own cohort rather than a crash.
   *
   * EVERY VALUE HERE IS AN ID OR RAW TEXT, NEVER A RESOLVED WORD — which is the
   * one way this memo differs from `mindEntities` beside it, and it is forced by
   * the model rather than chosen. `bucketBy` matches a facet's value against the
   * `key` of a DECLARED option (`stages`, `kinds`, the roster) to find the
   * cohort's label and its place in the ring; feeding it a localised caption
   * would match nothing, and every organization would land in the "a value
   * nothing declared" bucket — 400 rows under one grey cohort called Unknown,
   * in one language and not the other.
   *
   * So `typeKey` is `kind_id` and `stageId` is the rung's id, and the WORDS for
   * both travel separately, in `facetOptions` below. `vendor` is the exception
   * because it declares nothing: free text is its own key (0023 froze the
   * column that way), and the model trims it into one.
   *
   * ⚠ THE TWO INHERITED FACETS, AND WHAT THAT COSTS THIS MEMO'S OLD PROMISE.
   *
   * `vendor` and `managerId` are the NEAREST SELF-OR-ANCESTOR values, off
   * `FilterContext`'s single walk — the same map `inPortfolioScope` admits by
   * and the same one the portfolio's rows are built from. Reading the raw column
   * here while the filter read the inherited one is how `?vendor=Acme` came to
   * narrow to eleven organizations that the `?by=vendor` ring then drew in the
   * "not recorded" cohort: one screen, two definitions of one word.
   *
   * The sentence this block used to end on — "a description edit rewrites no
   * field on this list" — no longer holds, and the honest replacement is this: a
   * `map_nodes` WRITE OF ANY KIND rebuilds these facets, because inheritance
   * rides `store/entries`' ancestor walk and that walk is keyed on the whole
   * node map. That is the price, it is paid deliberately, and the alternative —
   * a second ancestor walk local to this file — is precisely the drift
   * store/entries.ts warns against where it explains why the third answer rides
   * the same loop as the first two.
   *
   * `?? raw` on both, and never a bare map read: a context with no answer for a
   * node (a cold start, a cache without it) must fall back to the row rather
   * than move four hundred organizations into "not recorded" for a frame.
   */
  const entityFacets = useMemo<MindEntityFacet[]>(
    () =>
      mapNodes.map((node) => ({
        id: node.id,
        managerId: managerOfNode?.get(node.id) ?? node.account_manager_id,
        typeKey: node.kind_id,
        vendor: vendorOfNode?.get(node.id) ?? node.vendor,
        stageId: progressByNodeId.get(node.id)?.stage_id ?? null,
      })),
    [mapNodes, progressByNodeId, vendorOfNode, managerOfNode],
  )

  /**
   * THE WORDS AND THE ORDER for the two declared axes — the stage ladder and
   * the kinds — resolved for the locale exactly once.
   *
   * ONE MEMO FOR BOTH because they are one idea and they are consumed by one
   * argument list: a cohort ring reads in the WORKSPACE's order (`sort_order`,
   * which both stores already hold their rows in), which is the same contract
   * `vocab` holds one ring down for the status buckets. A ring that sorted
   * itself by size would put the ladder in a different order after every write.
   *
   * HIDDEN RUNGS ARE PASSED, NOT FILTERED. `map_node_stages.hidden` takes a rung
   * out of the PICKERS; it never un-stages the organizations standing on it, and
   * dropping it here would move fourteen of them into "a value nothing
   * declared". The model draws it, marks it retired, and keeps it in its place.
   * `map_node_kinds` has no hidden column at all, so the flag is simply absent.
   *
   * Rebuilt on a locale change, like every other label memo on this screen, and
   * on nothing else: the two lists are ~7 and ~3 rows.
   */
  const facetOptions = useMemo(() => {
    return {
      stages: mapNodeStages.map((stage) => ({
        key: stage.id,
        label: stageLabelOf(stage),
        hidden: stage.hidden,
      })),
      kinds: nodeKinds.map((kind) => ({ key: kind.id, label: kindLabelOf(kind) })),
    }
  }, [mapNodeStages, nodeKinds, stageLabelOf, kindLabelOf])

  const vocab = useMemo<readonly MindVocabOption[]>(() => {
    // Owner and health have no vocabulary: the roster and the four computed
    // levels are the axis, and model.ts takes an empty list for both.
    if (dimension === 'status') return statusVocab
    if (dimension === 'priority') return priorityVocab
    return []
  }, [dimension, statusVocab, priorityVocab])

  /**
   * The filter as the model sees it: SCOPE PINNED OPEN.
   *
   * Pinned here rather than held in `filter` itself, and the difference is not
   * cosmetic — `countActiveFacets()` counts a non-default scope as a facet the
   * reader chose, so holding it in state would make the filter bar claim "1
   * filter" on a screen nobody has filtered, and its Clear-all would then reset
   * the scope and change what the map is about. pages/Dashboard.tsx pins the
   * other direction for the same reason.
   *
   * Open, not all: "the shape of my workload" is a question about work that is
   * still work. Closed items belong to the dashboard's throughput panels.
   */
  const applied = useMemo<FilterState>(() => ({ ...filter, scope: 'open' }), [filter])

  /**
   * COLLAPSE IS MEANINGLESS ON A PHONE, and passing it through anyway is a
   * bug rather than a harmless no-op. The small screen draws ONE ring at a time
   * and every tap drills rather than expands, so there is nothing to collapse —
   * but a branch the reader closed on a desktop is still in this list, and
   * `layoutMindtree` honours `collapsed` as well as `depthLimit`. Drilling into
   * such a track would draw the track and nothing under it: a blank ring with
   * no control on the screen able to un-blank it.
   */
  const collapsedIds = compact ? EMPTY_IDS : collapsedPref

  /**
   * How many leaves a group shows before the tail folds behind "+N more".
   *
   * Tighter on a phone for the obvious reason and because the drill-in is the
   * small-screen path anyway; on a desktop six is where a group stops reading
   * as a shape and starts reading as a list, which is /tracks' job.
   */
  const leafThreshold = compact ? 3 : 6

  /**
   * HOW MANY ORGANIZATIONS A RING MAY HOLD BEFORE IT IS CUT INTO COHORTS.
   *
   * Threaded beside `leafThreshold` and spelled the same way for the same
   * reason: it is a property of the SCREEN, not of the data, and the model has
   * no business reading a media query.
   *
   * 24 AND 16 ARE MEASURED, from worlds.ts's own packing constants rather than
   * from taste. A ring of n siblings puts each child at 1/n of the parent's
   * angular room; run the repo's own numbers out and the 24th sibling is the
   * last one that still draws as a NAMED CHIP (44x44 with its name outside along
   * the ray) at a desktop's framed size, while the 25th falls into the `state`
   * band, which renders no text at all by design (MindNode.tsx: "STILL NO
   * TEXT"). On a 375px phone the same crossing happens at 16. Past the cap a
   * ring has stopped being a list of names and become a texture, which is
   * exactly when a cohort — one named card standing for fourteen — says more
   * than the fourteen do.
   *
   * A CAP IS NOT A LIMIT ON WHAT IS DRAWN. `groupEntities` never drops a row: at
   * or under the cap the organizations are drawn unchanged (a small group NEVER
   * becomes a cohort), and past it they are re-bucketed and then re-bucketed
   * again down the ladder, with an honest wide ring as the last resort.
   */
  const ringCap = compact ? RING_CAP_COMPACT : RING_CAP

  /** The cohort key the reader asked for, mapped from the one `?by=`. */
  const grouping = GROUPING_FOR_BY[by]

  const tree = useMemo(
    () =>
      buildMindtree({
        entries,
        health,
        tracks: mindTracks,
        // THE ONE PRODUCTION CALL SITE, and the line the whole hierarchy hangs
        // off. It was `[]` through Wave A — which reproduced the old four-ring
        // tree exactly, and meant every Org anyone entered stayed invisible with
        // nothing complaining. `MindNode.kind === 'entity'` was unreachable in
        // the running app, and with it the dive past the track ring, the Org
        // leaf and the whole detail panel.
        entities: mindEntities,
        /**
         * THE COHORT PASS'S FIVE ARGUMENTS, and they are five rather than one
         * object because each answers to a different owner: `grouping` is the
         * reader's (the address bar), `entityFacets` is the database's, `stages`
         * and `kinds` are the admin's (the words and the order), and `ringCap`
         * is the screen's.
         *
         * THE IDS AND THE WORDS TRAVEL SEPARATELY, which is the shape the whole
         * pass turns on: a facet carries a `stage_id`, and `stages` says what
         * that id is CALLED and where it sits on the ladder. Fold the two
         * together — a facet carrying a resolved stage name — and the ring loses
         * its order, because `sort_order` is not recoverable from a word.
         */
        grouping,
        entityFacets,
        stages: facetOptions.stages,
        kinds: facetOptions.kinds,
        ringCap,
        vocab,
        members,
        dimension,
        filter: applied,
        ctx,
        collapsedIds,
        leafThreshold,
        expandedIds,
        /*
         * THE SAME DEPTH AT EVERY WIDTH.
         *
         * ⚠ THIS WAS `compact ? undefined : openDepth`, AND THE REASON HAD
         *   EXPIRED. The comment read "no default collapse on a phone:
         *   `depthLimit: 1` in useMapGeometry already draws one ring, and a
         *   branch marked collapsed under it would draw nothing" — true when it
         *   was written, and `useMapViewport` now calls that limit "useMapGeometry's
         *   OLD depthLimit". There is no ring limit any more. The phone draws the
         *   whole tidy tree, exactly as the desktop does.
         *
         *   So `undefined` stopped meaning "one ring is enough" and started
         *   meaning "open all of it". On the live site at 500px that was 855
         *   cards THREE PIXELS WIDE — every organization expanded into its own
         *   status buckets — which is the owner's "everything is too small to
         *   read" in its purest form, on the width where it hurts most. It was
         *   invisible on a desktop because a desktop is not compact, and
         *   invisible in every test because `collapsedIds` from an earlier
         *   session hid it on any browser that had been used before.
         *
         * A closed branch is DRAWN, closed — `startsCollapsed` in model.ts, not a
         * filter — so there is nothing left for this exception to protect.
         */
        openDepth,
      }),
    [
      entries,
      health,
      mindTracks,
      mindEntities,
      grouping,
      entityFacets,
      facetOptions,
      ringCap,
      vocab,
      members,
      dimension,
      applied,
      ctx,
      collapsedIds,
      leafThreshold,
      expandedIds,
      compact,
    ],
  )

  const stats = useMemo(() => {
    const out = new Map<string, NodeStats>()
    const isUnassigned = (id: string): boolean => {
      const entry = entryById.get(id)
      if (entry === undefined) return false
      return entry.owner_id === null && (entry.owner_name ?? '').trim() === ''
    }
    // THE OVERLAY IS MERGED HERE, NOT READ DOWNSTREAM. `mergeProgress` synthesises
    // `stage_changed_at = now` for exactly the sentence this walk is about to
    // speak — a rung the reader just chose was arrived at just now — and doing it
    // once, at the top, is what makes the card, the panel and the table agree in
    // the same frame the tap happened in.
    const merged = mergeProgress(progressByNodeId, pendingStages)
    // `today` rather than `Date.now()` in the dependency list: the fold's only
    // use of the clock is whole calendar days, so re-running it per render (or
    // per minute) would recompute 3,200 nodes to produce the same integers.
    // PortfolioStage.tsx carries the same suppression at the same kind of memo
    // for the same reason. `now` is therefore read INSIDE the body.
    const now = new Date()
    collectStats(
      tree,
      {
        entryById,
        isUnassigned,
        stages: stageIndex(merged, stageById),
        progressById: merged,
        // NO WORKSPACE FLOOR IN v1 — PortfolioStage's decision, and kept as ONE
        // decision rather than two: 0026 seeds every rung's `expected_days` NULL
        // on purpose, and a floor invented here would put a number nobody chose
        // on the map while the table beside it showed none.
        fallbackStallDays: null,
        now,
        today: ctx.today,
      },
      out,
    )
    return out
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, entryById, progressByNodeId, pendingStages, stageById, ctx.today])

  /**
   * The progress underscore's numbers, per node. Empty — not zeroed — while
   * `progressSource` is null, so the mark and its spoken clause are both absent
   * rather than both lying.
   *
   * `linksByNode` is built once here rather than inside the walk: the walk sees
   * every organization exactly once, so a per-node `filter()` over 4,000 links
   * would be the O(n²) the post-order pass exists to avoid.
   */
  const progress = useMemo(() => {
    const out = new Map<string, UseCaseProgress>()
    if (progressSource === null) return out
    const linksByNode = new Map<string, MapNodeUseCase[]>()
    for (const link of progressSource.links) {
      const held = linksByNode.get(link.node_id)
      if (held === undefined) linksByNode.set(link.node_id, [link])
      else held.push(link)
    }
    collectProgress(tree, catalogue, progressSource.terminalKey, linksByNode, out)
    return out
  }, [tree, catalogue, progressSource])

  /* ── labels ───────────────────────────────────────────────────────────── */

  /**
   * A node's own text.
   *
   * The discriminated `MindLabel` is what makes this safe to write once: a
   * `key` label goes through t() and a `text` label — a track name, a person's
   * name, an entry title — never does. Handing database text to t() renders it
   * back verbatim (t() echoes an unknown key), so the bug would be invisible in
   * English and catastrophic in Arabic, where the untranslated string is the
   * one thing that had to keep its own direction.
   */
  const textOf = useCallback((label: MindLabel): string => {
    if (label.kind === 'key') return t(label.key, label.vars ? { ...label.vars } : undefined)
    const trimmed = label.text.trim()
    return trimmed === '' ? t('mindtree.untitled') : trimmed
  }, [])

  const dimensionLabel = t(
    MIND_DIMENSIONS.find((d) => d.key === dimension)?.labelKey ?? 'mindtree.dimStatus',
  )

  /**
   * The active grouping as a WORD — "Stage", "Team", "Vendors".
   *
   * Read off `MIND_GROUPINGS` rather than off a table in this file, because the
   * model owns the axis and the chip, the announcement and every cohort's spoken
   * name all have to say the same word. It is a fallback rather than a `?.`
   * because `MindGrouping` is closed: the `??` arm is unreachable and exists so
   * a future member that nobody added a row for degrades to "no grouping"
   * instead of rendering `undefined`.
   */
  const groupingLabel = t(
    MIND_GROUPINGS.find((g) => g.key === grouping)?.labelKey ?? 'common.none',
  )

  /**
   * ONE NODE'S VIEW MODEL, ON DEMAND: the display label, the accessible name,
   * the count chip and the two tooltips.
   *
   * Built here rather than inside the node component, because a
   * filtered-to-everything workspace is several hundred nodes and every one of
   * them would otherwise re-resolve its own label on every pan frame. `locale`
   * is a dependency even though nothing below reads it directly: t() reads
   * lib/i18n's MODULE state, which React cannot watch, so without it here a
   * language switch would re-render the map around a memo full of English.
   *
   * ── WAVE 9's 5d: LAZY, AND THE ARITHMETIC THAT FORCED IT ───────────────────
   *
   * This was a `Map` built by ONE EAGER WALK of the whole tree. At 400
   * organizations the tree is ~3,200 nodes and a view costs about six `t()`
   * lookups, so a rebuild — and it rebuilds whenever `entryById` changes, which
   * is every realtime patch — was ~20,000 locale lookups for a picture that
   * draws a couple of hundred marks.
   *
   * So the walk that remains is the CHEAP half: one pass that indexes the nodes
   * by id and calls nothing. The expensive half runs per id, on the first ask,
   * and is cached. `MapCanvas` asks only for nodes that survived the frustum
   * cull, which is what turns the reduction from an argument into a number —
   * `mapRender.test.tsx` counts the asks per camera and pins them.
   *
   * IDENTITY IS STILL STABLE, which is the property `MindNode`'s `memo()` runs
   * on: an id asked for twice returns the same object, and the cache lives
   * exactly as long as the memo does. What changed is WHEN it is built, never
   * how many times.
   *
   * NOBODY EAGER IS LEFT. `lib/export.ts` and `MindtreeTable` were named as the
   * two consumers an `allViews()` would have to keep whole; neither reads this
   * — the serialiser walks the model and the table builds its own rows — so an
   * eager arm would have been dead code on the day it shipped. `getView` is the
   * whole surface; if a caller ever needs every view at once, it should walk the
   * tree it already has and ask.
   */
  const getView = useMemo(() => {
    const cache = new Map<string, MindNodeView>()

    /**
     * The cheap walk: id → node, plus the parent link the fold's ancestry trail
     * needs. No `t()`, no isolation, no allocation per node beyond the entry.
     */
    const index = new Map<string, { node: MindNodeModel; parentId: string | null }>()
    const indexOf = (node: MindNodeModel, parentId: string | null): void => {
      index.set(node.id, { node, parentId })
      for (const child of node.children) indexOf(child, node.id)
    }
    indexOf(tree, null)

    const sep = t('mindtree.listSep')

    /**
     * The chain of ancestor labels, isolated and joined — "Network, Blocked".
     *
     * It exists for the folds. A "+N more" node's accessible name used to be
     * `showMore` with its GROUP's label alone, which is not unique: "On track"
     * repeats under every track, so two folds hiding 8 items and 3 items shared
     * one byte-identical name and a screen-reader user listing the controls saw
     * the same button twice. Each component is isolated separately rather than
     * the joined string being isolated once, because the separator is the
     * locale's own comma and it belongs to the SENTENCE, not to either label.
     *
     * WALKED UP FROM THE NODE rather than carried down into it, which is the
     * one thing the lazy cache changed about this function: an eager walk had
     * the ancestry in hand and a per-id build does not. The root contributes
     * nothing and stops the climb — "NphiesCore, Network, Blocked" would name
     * the workspace in every fold on the screen — and only a `'more'` node ever
     * asks, so the climb runs a handful of times per rebuild rather than 3,200.
     */
    const trail = (id: string): string => {
      const parts: string[] = []
      let at = index.get(id)?.parentId ?? null
      while (at !== null) {
        const held = index.get(at)
        if (held === undefined || held.node.kind === 'root') break
        const text = textOf(held.node.label)
        if (text !== '') parts.push(isolate(text))
        at = held.parentId
      }
      return parts.reverse().join(sep)
    }

    /**
     * An Organization's account manager and vendor, or null for everything else.
     *
     * BOTH INHERITED, on the `inherited ?? raw` coalesce that is THE ONE RULE
     * for these two columns across the whole app — lib/portfolio/rows.ts is its
     * sibling, line for line, and store/entries.ts is where the single ancestor
     * walk that answers it lives. A card that showed the raw column while the
     * filter admitted by the inherited one would put an organization inside
     * Acme's ring with a blank second line, which reads as a bug in the ring.
     */
    const secondaryOf = (node: MindNodeModel): string | null => {
      const nodeId = entityIdOf(node)
      if (nodeId === null) return null
      const row = mapNodeById.get(nodeId)
      if (row === undefined) return null
      const parts: string[] = []
      const managerId = managerOfNode?.get(nodeId) ?? row.account_manager_id
      if (managerId !== null && managerId !== undefined) {
        parts.push(isolate(memberLabel(memberById, managerId, null)))
      }
      const vendor = (vendorOfNode?.get(nodeId) ?? row.vendor).trim()
      if (vendor !== '') parts.push(isolate(vendor))
      return parts.length === 0 ? null : parts.join(sep)
    }

    /**
     * The terminal status as a WORD, resolved once for the whole walk.
     *
     * From `progressSource`, so it is the same status `useCaseProgress` counted
     * against. Renaming what "finished" means stays the one edit lib/mapNodes.ts
     * promises, and the map's sentence follows the panel's automatically.
     */
    const terminalWord = progressSource === null ? '' : t(progressSource.terminalWordKey)

    const build = (node: MindNodeModel): MindNodeView => {
      const raw = textOf(node.label)
      const stat = stats.get(node.id) ?? NO_STATS
      /**
       * ZERO IS A NUMBER AND `total === 0` IS NOT ONE. A node the roll-up does
       * not cover has no row here at all; a node it covers with an empty
       * catalogue has a total of 0, which `MindNode` refuses to divide by and
       * which would say "0 of 0 live" out loud. Both collapse to null.
       */
      const held = progress.get(node.id)
      const share = held === undefined || held.total === 0 ? null : held

      let name: string
      if (node.kind === 'entry') {
        const entry = node.entryId === null ? undefined : entryById.get(node.entryId)
        const detail: string[] = []
        if (entry !== undefined) {
          // Rendered directly from the live vocabulary, so an admin's rename
          // reaches this sentence with zero writes — the frozen-key payoff.
          detail.push(vocabLabelOf('status', entry.status))
          const owner = memberLabel(memberById, entry.owner_id, entry.owner_name)
          if (entry.owner_id !== null || (entry.owner_name ?? '').trim() !== '') {
            detail.push(t('mindtree.leafOwner', { owner }))
          }
        }
        if (node.health.slaBreached) detail.push(t('mindtree.leafBreached'))
        name = t('mindtree.leafName', { title: raw, detail: detail.join(sep) })
      } else if (node.kind === 'more') {
        // THE VISIBLE LABEL LEADS, then the action. `raw` is "+8 more items",
        // which is what the reader can see and therefore what a voice-control
        // user will say (WCAG 2.5.3, Label in Name) and what carries the count;
        // the `showMore`/`showFewer` clause says what pressing Enter does and
        // names the ancestry that makes this fold different from the other four
        // on screen. The first cut had the action alone, and dropped all three.
        name = t('mindtree.nodeName', {
          label: raw,
          detail: node.collapsed
            ? t('mindtree.showMore', { label: trail(node.id) })
            : t('mindtree.showFewer', { label: trail(node.id) }),
        })
      } else {
        const detail: string[] = []
        /**
         * A COHORT SAYS WHAT IT IS A COHORT OF, AND HOW MANY ARE IN IT.
         *
         * "Stage: Integrating, 14 organizations, 37 open, 2 past deadline."
         *
         * Both clauses are load-bearing and neither is available anywhere else
         * on the drawing. The DISPLAY label is the bucket's own name — the rung,
         * the person, the vendor — and read alone, "Integrating" is a word with
         * no subject; the ring it sits in is a picture, and a picture cannot be
         * announced. The count is the ring's SIZE, which the sighted reader gets
         * from the card's own area (`sizeForCount`) and nobody else gets at all.
         *
         * The number is `stat.orgs` and NEVER `node.count` — see `NodeStats`.
         * `count` is the open work under the cohort and is appended below with
         * every other branch's, in the same words, so the two numbers can never
         * be read as one.
         *
         * The grouping word comes from the ACTIVE axis rather than from the node
         * because a cohort has no idea which key cut it — and it cannot: the
         * whole tree is cut by one key at a time, and that key is `grouping`.
         */
        const cohort = node.kind === 'cohort'
        if (cohort) detail.push(t('mindtree.countOrgs', { count: stat.orgs }))
        /**
         * EVERY PLACE SAYS HOW MANY ORGANIZATIONS ARE IN IT, not just the rings.
         *
         * "Riyadh Cluster, 18 organizations, 4 live, 2 past their stage, 0 open."
         *
         * The clause was the cohort's alone because the cohort was the only node
         * whose SIZE the drawing encoded (`sizeForCount`) — and the tidy tree
         * encodes nothing: every card is the same box, so the one number a
         * branch card can carry is the one it prints, and the sentence has to
         * carry the rest. `orgsBelow`, never `orgs`: a directorate is a
         * `map_nodes` row too, and counting itself among the things it holds
         * makes eighteen hospitals nineteen. The cohort keeps `stat.orgs` and
         * its own key above, because a ring's members are its members whatever
         * kind they are, and that sentence is not this defect's to change.
         *
         * THE MIX FOLLOWS THE TALLY AND ONLY THE TALLY. `liveBelow` and
         * `riskBelow` are counts OF those organizations, so a node with none of
         * them below says neither — and an organization's own rung is already
         * spoken by `portfolioDays`/`portfolioAtRisk` further down, from the
         * same reading, so nothing is said twice.
         */
        if (!cohort && stat.orgsBelow > 0) {
          detail.push(t('mindtree.countOrgs', { count: stat.orgsBelow }))
        }
        if (stat.liveBelow > 0) detail.push(t('mindtree.countOrgsLive', { count: stat.liveBelow }))
        if (stat.riskBelow > 0) detail.push(t('mindtree.countOrgsRisk', { count: stat.riskBelow }))
        detail.push(t('mindtree.countOpen', { count: node.count }))
        if (stat.breached > 0) detail.push(t('mindtree.countBreached', { count: stat.breached }))
        if (stat.unassigned > 0) {
          detail.push(t('mindtree.countUnassigned', { count: stat.unassigned }))
        }
        /**
         * THE STAGE CLOCK, AS TEXT AND ONLY AS TEXT.
         *
         * The map card draws NO NEW MARK for this and must not: MindNode already
         * rations its second line to one place — a terminal node past 380px —
         * and every millimetre of the card is spent on the name, the count and
         * the progress underscore. What the panel and the table print in two
         * columns arrives here as a clause on the accessible name instead, which
         * is exactly what the shared field set is for: one arithmetic, three
         * vocabularies. The days are `null` on everything that is not an
         * organization, so a track and a status bucket say nothing extra.
         *
         * The SAME keys the portfolio's own two cells use, as literals, so the
         * word an account manager reads in the table is the word a screen-reader
         * user hears on the canvas — and `portfolioAtRisk` follows the count
         * rather than replacing it, because "past its stage" without "68 days"
         * is a verdict with no evidence.
         */
        if (stat.daysInStage !== null) {
          detail.push(t('mindtree.portfolioDays', { count: stat.daysInStage }))
          if (stat.atRisk) detail.push(t('mindtree.portfolioAtRisk'))
        }
        /**
         * THE UNDERSCORE, IN WORDS, AND IT IS NOT DECORATION.
         *
         * The mark `MindNode` draws for `view.progress` encodes LENGTH AND
         * COLOUR ALONE (MindNode.tsx:203-208 states it). WCAG 1.4.1 forbids
         * colour as the sole carrier of information, and length alone is not a
         * value anybody can read off a 2-unit bar. This clause is the only place
         * the same fact exists as text, which is what makes the mark legal —
         * and it comes off the SAME `UseCaseProgress` the bar is drawn from, so
         * the picture and the sentence cannot disagree.
         *
         * Appended after the counts because it is the slowest-moving of them:
         * "12 open, 3 past deadline, 6 of 9 live" puts today's noise first and
         * the quarter's arithmetic last, which is the order a screen-reader user
         * can stop listening at.
         */
        if (share !== null) {
          detail.push(
            t('mindtree.countLive', {
              done: share.done,
              total: share.total,
              status: terminalWord,
            }),
          )
        }
        // Nothing about expansion is appended: `aria-expanded` on the treeitem
        // already announces it, and a name that repeated it would say it twice.
        //
        // `cohortName` IS `nodeName` WITH ONE MORE SLOT, not a second sentence
        // shape: "⁨{by}⁩: ⁨{label}⁩, {detail}". It is a separate key rather than a
        // `by`-prefixed `label` composed here because the colon, the order and
        // the two isolate pairs are all the LOCALE's business — Arabic puts the
        // qualifier the other way round in the RTL run, and a string built with
        // `+` in this file cannot be translated at all.
        name = cohort
          ? t('mindtree.cohortName', {
              by: groupingLabel,
              label: raw,
              detail: detail.join(sep),
            })
          : t('mindtree.nodeName', { label: raw, detail: detail.join(sep) })
      }

      return {
        // Isolated for DISPLAY only. The accessible names above pass `raw`,
        // because the locale templates isolate their own interpolations —
        // `"⁨{label}⁩, {detail}"` — and isolating twice would nest two runs
        // around one value for no benefit.
        label: isolate(raw),
        name,
        count: node.kind === 'entry' ? null : String(node.count),
        /**
         * THE TALLY THE CARD DRAWS INSTEAD — and it is a SECOND field, because
         * `count` above still means what it has always meant and every other
         * surface still reads it.
         *
         * Null wherever there is nothing under this node to count, which is an
         * organization (the end of the hierarchy), an entry, a status bucket and
         * a fold. `MindNode` owns what it does with the pair — see `numeral`
         * there — and this hook owns only which number is true.
         *
         * `String()` and not a formatter, because the sibling above is not one
         * either: `.tabular` renders the digits and the accessible name carries
         * the number as words through `t()`, which is where the locale's own
         * digits and grammar belong.
         */
        orgs: stat.orgsBelow > 0 ? String(stat.orgsBelow) : null,
        toggleHint:
          node.children.length === 0
            ? null
            : node.collapsed
              ? t('mindtree.expandNode', { label: raw })
              : t('mindtree.collapseNode', { label: raw }),
        breachHint: node.health.slaBreached ? t('mindtree.breachHint') : null,
        /**
         * THE PROGRESS UNDERSCORE'S TWO NUMBERS — organizations-worth of
         * capability that reached the terminal status, out of all of them.
         *
         * The whole `UseCaseProgress` is not handed over: `MindNode` needs a
         * length, `rows` is ten objects per node and 32,000 across a 400-org
         * workspace, and a view model that carried them would keep the entire
         * matrix alive for a 2-unit bar.
         */
        progress: share === null ? null : { done: share.done, total: share.total },
        /**
         * THE ORGANIZATION'S SECOND LINE — account manager, then vendor.
         *
         * Drawn in exactly one place: a terminal node past 380px, which is the
         * only node with nothing beneath it competing for the room. Everything
         * else about an Organization — the capabilities integrated, the
         * outstanding issues, the matrix — belongs to the info sidebar and is
         * one tap away. Null on every department, and null on an Organization
         * with neither recorded, because an empty second line is a row of
         * whitespace the drawing has to pay for.
         *
         * `isolate()`d per COMPONENT and not once over the join: the separator
         * is the locale's own comma and belongs to the sentence, exactly as the
         * fold's ancestry trail above does it.
         */
        secondary: secondaryOf(node),
      }
    }

    return (id: string): MindNodeView | undefined => {
      const hit = cache.get(id)
      if (hit !== undefined) return hit
      const held = index.get(id)
      if (held === undefined) return undefined
      const made = build(held.node)
      cache.set(id, made)
      return made
    }
    // `locale` is a dependency the rule cannot see the use of, and the same
    // one store/entries.ts and MindtreeTable.tsx suppress for the same reason:
    // every t() above reads lib/i18n's MODULE-level current locale rather than
    // an argument, so without it here a language switch would re-render the map
    // around a memo still holding English labels.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tree,
    stats,
    progress,
    progressSource,
    entryById,
    memberById,
    mapNodeById,
    vocabLabelOf,
    textOf,
    // THE TWO INHERITANCE MAPS the second line reads. They are memoised on
    // `mapNodeById`, which is already one line above, so naming them adds NO NEW
    // INVALIDATION CLASS — the cache is rebuilt on exactly the writes that
    // rebuilt it before, and `getView`'s laziness is untouched.
    vendorOfNode,
    managerOfNode,
    // A STRING, so it compares by value: the cohort clause is rebuilt when the
    // axis changes and not when the object holding it does.
    groupingLabel,
    locale,
  ])

  /* ── the summary, which is also the export's description ──────────────── */

  const summary = useMemo(() => {
    const rootStats = stats.get(ROOT_ID) ?? NO_STATS
    // `count` is the TRACK count: it is the only noun in this sentence that
    // inflects ("1 track" / "6 tracks"), and selectPlural reads vars.count and
    // nothing else. The open and breached totals ride as {open}/{breached},
    // which sit beside adjectives rather than nouns in both languages.
    return t('mindtree.summary', {
      count: tree.children.length,
      open: tree.count,
      breached: rootStats.breached,
    })
  }, [stats, tree])

  const busiest = useMemo(() => {
    let top: MindNodeModel | null = null
    for (const child of tree.children) if (top === null || child.count > top.count) top = child
    if (top === null || top.count === 0) return null
    return t('mindtree.summaryTop', { track: textOf(top.label), count: top.count })
  }, [tree, textOf])

  /**
   * The biggest ring-2 bucket ACROSS every track — the sentence the picture
   * cannot draw.
   *
   * Ring 2 is nested inside ring 1, so with `Group by = Owner` a person working
   * across four tracks is four nodes and four numbers, and "who is overloaded"
   * — one of the three questions MINDTREE-SPEC names — is a sum the reader has
   * to do by eye. Nesting is right for the map; this is the one number that
   * cannot be recovered from it, so it is stated. The table carries the whole
   * ranking (`MindtreeTable`'s second block).
   *
   * Suppressed under a single track, where it is the same fact as the map.
   */
  const topGroup = useMemo(() => {
    if (tree.children.length < 2) return null
    const totals = groupTotals(tree)
    const top = totals[0]
    if (top === undefined || top.count === 0) return null
    return t('mindtree.summaryGroup', { label: textOf(top.label), count: top.count })
  }, [tree, textOf])

  /* ── the shared tag vocabulary ────────────────────────────────────────── */

  const tags = useMemo(() => {
    const held = new Set<string>()
    for (const entry of entries) for (const tag of entry.tags) held.add(tag)
    return [...held].sort((a, b) => a.localeCompare(b, locale))
  }, [entries, locale])

  return {
    dimension,
    view,
    density,
    focusPref,
    expandedIds,
    entries,
    entryById,
    tracks,
    members,
    memberById,
    ctx,
    loading,
    error,
    truncated,
    entriesLoaded,
    vocabLabelOf,
    statusVocab,
    priorityVocab,
    meId,
    role,
    hoveredId,
    selection,
    selectionCount,
    dragging,
    tree,
    stats,
    getView,
    textOf,
    dimensionLabel,
    /** The cohort key the picture is cut by — the toolbar lights its chip from it. */
    grouping,
    groupingLabel,
    /**
     * IS THERE ANYTHING TO GROUP? Counted off the roll-up rather than off
     * `mapNodes`, so it answers about the tree as DRAWN: a workspace whose
     * organizations are all archived, or all filtered out, has nothing for a
     * cohort chip to do, and a control that changes nothing visible is a control
     * that reads as broken. The root's `orgs` is that number by construction.
     */
    hasEntities: (stats.get(ROOT_ID) ?? NO_STATS).orgs > 0,
    summary,
    busiest,
    topGroup,
    tags,
  }
}
