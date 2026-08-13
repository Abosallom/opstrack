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
// WHAT IT DOES NOT DO. It reads the entries store like every other screen and
// never runs its own query, so PostgREST's 1000-row clamp is honoured by
// inheritance and the truncation notice is the store's own flag. It picks no
// colour: every hue arrives as the `--track-c-*` pair the model stapled on.

import { useCallback, useEffect, useMemo } from 'react'
import type { MindNodeView } from '../../components/mindtree/MindNode'
import { isolate } from '../../lib/bidi'
import type { FilterState } from '../../lib/entryFilter'
import { t } from '../../lib/i18n'
import { useKindLabel, useNodeLabel, useTrackLabel } from '../../lib/labels'
// ALIASED, for the reason MapBranchDetail.tsx and lib/mapNodes.test.ts both
// state at their own imports: `useCaseProgress` is a PURE FUNCTION whose name
// matches oxlint's Hook heuristic (`use` + a capital), so calling it from the
// plain recursive walk below is a `react-hooks/rules-of-hooks` error under its
// own name.
import {
  entityIdOf,
  useCaseProgress as computeUseCaseProgress,
  type UseCaseProgress,
} from '../../lib/mapNodes'
import { DEFAULT_NODE_SIZE, sizeForCount, type NodeSize } from '../../lib/mindtree/layout'
import {
  MIND_DIMENSIONS,
  ROOT_ID,
  buildMindtree,
  groupTotals,
  type MindEntity,
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
  useMapNodes,
  useTracks,
} from '../../store/config'
import { useMemberMap, useMembers, memberLabel } from '../../store/members'
import { useVocabAll, useVocabLabel } from '../../store/vocab'
import { useAuth } from '../../store/auth'
import type { MapNodeUseCase, UseCase, UseCaseStatus, UserRole } from '../../types'

/* ───────────────────────────────── the tree ──────────────────────────────── */

/** The two counts the model does not carry, derived once for both views. */
export interface NodeStats {
  breached: number
  unassigned: number
}

export const NO_STATS: NodeStats = Object.freeze({ breached: 0, unassigned: 0 })

/**
 * Roll `breached` and `unassigned` up the tree, in one post-order pass.
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
 */
export function collectStats(
  node: MindNodeModel,
  entryById: ReadonlyMap<string, unknown>,
  isUnassigned: (id: string) => boolean,
  out: Map<string, NodeStats>,
): NodeStats {
  if (node.kind === 'entry') {
    const id = node.entryId
    const stats: NodeStats = {
      breached: node.health.slaBreached ? 1 : 0,
      unassigned: id !== null && entryById.has(id) && isUnassigned(id) ? 1 : 0,
    }
    out.set(node.id, stats)
    return stats
  }
  let breached = 0
  let unassigned = 0
  for (const child of node.children) {
    const stats = collectStats(child, entryById, isUnassigned, out)
    breached += stats.breached
    unassigned += stats.unassigned
  }
  const stats: NodeStats = { breached, unassigned }
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

  if (nodeIds.length > 0 && node.kind !== 'entry' && node.kind !== 'more') {
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

/** One frozen empty set, so the memo below has a stable reference to return. */
const EMPTY_IDS: ReadonlySet<string> = new Set<string>()

/**
 * The ring the map opens at: root + tracks, every track closed.
 *
 * See model.ts's `openDepth` for the arithmetic. The short version is that the
 * canvas is bound on the BLOCK axis — a tidy tree stacks every visible node
 * down it — so ring 2 costs one row per populated track × group cell, and
 * thirty of those do not fit above 0.31. Six track cards do, at 1:1.
 */
const OPEN_DEPTH = 1

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
  const members = useMembers()
  const memberById = useMemberMap()
  const ctx = useFilterContext()
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
        vocab,
        members,
        dimension,
        filter: applied,
        ctx,
        collapsedIds,
        leafThreshold,
        expandedIds,
        // No default collapse on a phone: `depthLimit: 1` in useMapGeometry
        // already draws one ring, and a branch marked collapsed under it would
        // draw nothing.
        openDepth: compact ? undefined : OPEN_DEPTH,
      }),
    [
      entries,
      health,
      mindTracks,
      mindEntities,
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
    collectStats(tree, entryById, isUnassigned, out)
    return out
  }, [tree, entryById])

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
   * One view model per node: the display label, the accessible name, the count
   * chip and the two tooltips.
   *
   * Built in a single walk rather than inside the node component, because a
   * filtered-to-everything workspace is several hundred nodes and every one of
   * them would otherwise re-resolve its own label on every pan frame. `locale`
   * is a dependency even though nothing below reads it directly: t() reads
   * lib/i18n's MODULE state, which React cannot watch, so without it here a
   * language switch would re-render the map around a memo full of English.
   */
  const views = useMemo(() => {
    const out = new Map<string, MindNodeView>()

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
     */
    const trail = (ancestry: readonly string[]): string =>
      ancestry.filter((text) => text !== '').map(isolate).join(sep)

    /** An Organization's account manager and vendor, or null for everything else. */
    const secondaryOf = (node: MindNodeModel): string | null => {
      const nodeId = entityIdOf(node)
      if (nodeId === null) return null
      const row = mapNodeById.get(nodeId)
      if (row === undefined) return null
      const parts: string[] = []
      if (row.account_manager_id !== null) {
        parts.push(isolate(memberLabel(memberById, row.account_manager_id, null)))
      }
      const vendor = row.vendor.trim()
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

    const visit = (node: MindNodeModel, ancestry: readonly string[]): void => {
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
            ? t('mindtree.showMore', { label: trail(ancestry) })
            : t('mindtree.showFewer', { label: trail(ancestry) }),
        })
      } else {
        const detail = [t('mindtree.countOpen', { count: node.count })]
        if (stat.breached > 0) detail.push(t('mindtree.countBreached', { count: stat.breached }))
        if (stat.unassigned > 0) {
          detail.push(t('mindtree.countUnassigned', { count: stat.unassigned }))
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
        name = t('mindtree.nodeName', { label: raw, detail: detail.join(sep) })
      }

      out.set(node.id, {
        // Isolated for DISPLAY only. The accessible names above pass `raw`,
        // because the locale templates isolate their own interpolations —
        // `"⁨{label}⁩, {detail}"` — and isolating twice would nest two runs
        // around one value for no benefit.
        label: isolate(raw),
        name,
        count: node.kind === 'entry' ? null : String(node.count),
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
      })

      // The root is the workspace and adds nothing to a fold's ancestry, so it
      // seeds an empty trail rather than "NphiesCore, Network, Blocked".
      const below = node.kind === 'root' ? [] : [...ancestry, raw]
      for (const child of node.children) visit(child, below)
    }

    visit(tree, [])
    return out
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
    views,
    textOf,
    dimensionLabel,
    summary,
    busiest,
    topGroup,
    tags,
  }
}
