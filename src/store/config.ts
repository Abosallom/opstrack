// Config store: the workspace's tracks, their groups, and the map hierarchy
// beneath them — cached and shared.
//
// Groups (0018) are the level above tracks — Technical and Business — and they
// live here rather than in a store of their own because nothing ever wants one
// without the other: every screen that renders a group renders the tracks
// inside it, and a second store would mean a second load, a second cache and a
// second chance for the two to disagree about what exists.
//
// MAP NODES, NODE KINDS AND USE CASES (0023/0024) are folded in for that exact
// argument, one level down. Nothing renders a node without its track's colour: the
// hierarchy hangs BELOW tracks and inherits everything visual from them, so a
// separate node store would be a second load of data that is useless on its own, a
// second cache, and a second chance for a node to name a track this store has never
// heard of. `mapRoots` is keyed by track id and is built from BOTH lists at once,
// which is the same reason `activeByGroup` could not live in a groups store.
//
// THE STAGE LADDER AND THE PROGRESS ROWS (0026) are here for the same argument a
// third time, and the second of the two is the one that could have gone either way.
// `map_node_stages` is plainly configuration — seven rows, edited by one person,
// read by every picker. `map_node_progress` is fieldwork, like the use-case links
// that are deliberately NOT here; what puts it on this side of the line is size and
// reach: at most ONE row per organization (~400, against ~4,000 links), and it is
// what the canvas itself draws — where each organization got to is the answer the
// map exists to show, not something a panel opens to find out.
//
// ⚠ NEITHER TABLE EXISTS YET. 0026 is applied by hand after this wave ships, so
//   both reads fail on every load until then and both lists are empty. That is the
//   SHIPPING state, not a degraded one: settle() keeps the empty rows, nothing
//   latches, no error surfaces, and every consumer renders "no stages configured
//   yet". store/auth.ts's loadPermissions is the house pattern for a table that
//   does not exist yet, and this is it applied twice.
//
// WHAT IS DELIBERATELY NOT HERE: `map_node_use_cases`, the per-node record of which
// capability an organization has reached which state on. That is DATA, not
// configuration — forty organizations times ten capabilities is four hundred rows
// nobody looks at until one panel is open, every tick of a checkbox on any client
// invalidates it, and it is fetched on open by api/map.ts's listNodeUseCases.
//
// Tracks are read on nearly every screen (row colour bars, the capture picker,
// board columns, digest grouping) and written only from one admin page, so they
// are fetched once and kept, not refetched per component.
//
// NARROW SELECTOR HOOKS, deliberately not store/auth.ts's `useAuthStore()`
// pattern. auth's whole-state subscription is fine for three fields that change
// together at sign-in; here, a rename of one track would re-render every
// component in the app that merely wanted `useConfigLoading()`.
//
// The derived views (`active`, `byId`) are computed ONCE when tracks land and
// stored, rather than computed inside the selectors. A selector that builds a
// new array or Map on each call returns a new reference every render, which
// under useSyncExternalStore means "the snapshot changed" forever — an infinite
// re-render loop, and in dev a "getSnapshot should be cached" warning.

import { buildUseCaseRungMap, type UseCaseRungMap } from '../lib/useCaseRungs'
import { create } from 'zustand'
import {
  listMapNodeKinds,
  listMapNodeProgress,
  listMapNodeStages,
  listMapNodes,
  listHisProducts,
  listReadiness,
  listUseCases,
  listUseCaseRungs,
} from '../api/map'
import {
  loadJiraSettings,
  saveJiraSettings,
  type JiraSettings,
  type JiraSettingsInput,
} from '../api/jiraSettings'
import type { Loaded } from '../api/entries'
import type { ApiResult } from '../api/result'
import { listGroups, listTracks } from '../api/tracks'
import { hasSession } from './auth'
import type {
  MapNode,
  MapNodeKind,
  MapNodeProgress,
  MapNodeStage,
  Track,
  TrackGroup,
  HisProduct,
  NodeReadiness,
  UseCase,
  UseCaseRungRow,
} from '../types'

const CACHE_KEY = 'nphiescore_tracks_v1'

/**
 * Groups (0018) get their OWN key rather than joining the tracks payload.
 *
 * A shared key would make one corrupt or older-shaped blob throw both halves
 * away, and the two are written at different moments — a failed groups read
 * must leave a good tracks cache exactly as it was.
 */
const GROUPS_CACHE_KEY = 'nphiescore_track_groups_v1'

/**
 * Three more keys, one per table (0023/0024), for GROUPS_CACHE_KEY's reason and not
 * as a filing preference.
 *
 * The three reads land independently and can fail independently — a workspace whose
 * database predates 0023 gets a 404 from all three while `tracks` and `track_groups`
 * answer perfectly — so one shared blob would let the oldest-shaped of them throw
 * away the two that are good. Separate keys also mean a cache written before this
 * wave simply is not there, which reads as "no hierarchy yet" and is exactly right.
 */
const MAP_NODES_CACHE_KEY = 'nphiescore_map_nodes_v1'
const MAP_NODE_KINDS_CACHE_KEY = 'nphiescore_map_node_kinds_v1'
const USE_CASES_CACHE_KEY = 'nphiescore_use_cases_v1'
const USE_CASE_RUNGS_CACHE_KEY = 'nphiescore_use_case_rungs_v1'
const HIS_PRODUCTS_CACHE_KEY = 'nphiescore_his_products_v1'
const READINESS_CACHE_KEY = 'nphiescore_node_readiness_v1'

/**
 * Two more (0026), and their own keys for the reason above — with one extra edge
 * that makes the separation load-bearing rather than tidy.
 *
 * NEITHER TABLE EXISTS IN THE LIVE DATABASE AS THIS SHIPS. 0026 is applied by
 * hand, after this wave lands, so both reads answer 42P01/PGRST205 on every load
 * for as long as that takes — and both keys are simply absent from localStorage,
 * which reads as "no stages configured yet" and is exactly right. A shared blob
 * would have let two tables that do not exist yet throw away the five that do.
 *
 * The progress key is spelled `_v1` like the rest even though its rows are keyed
 * by `node_id` rather than `id`: the version suffix tracks the SHAPE of the cache
 * (an array of rows), and that has not changed.
 */
const MAP_NODE_STAGES_CACHE_KEY = 'nphiescore_map_node_stages_v1'
const MAP_NODE_PROGRESS_CACHE_KEY = 'nphiescore_map_node_progress_v1'

/** How long a load stays fresh enough to skip the focus refetch. */
const STALE_AFTER_MS = 30_000

interface ConfigState {
  /** Every track, archived included — the admin list needs them all. */
  tracks: Track[]
  /** Precomputed `archived === false` slice, stable by reference. */
  active: Track[]
  /** Precomputed id → track lookup, stable by reference. */
  byId: Map<string, Track>
  /** Every group, ordered by sort_order. Groups have no archived state. */
  groups: TrackGroup[]
  /** Precomputed id → group lookup, stable by reference. */
  groupById: Map<string, TrackGroup>
  /**
   * Active tracks bucketed by group, keyed by `group_id` with `null` for the
   * ungrouped ones — stable by reference.
   *
   * Precomputed HERE rather than left to each consumer, and that is the
   * doctrine at the top of this file rather than a convenience: a selector that
   * builds this Map on every call returns a new reference every render, which
   * under useSyncExternalStore means "the snapshot changed" forever. The board,
   * the Mindtree, the tracks index and the digest all want exactly this shape,
   * so computing it once when the data lands removes four separate chances to
   * fall into that loop.
   *
   * Bucket order is the tracks array's own order (sort_order, then name), so a
   * group's tracks read in the order an admin dragged them into.
   */
  activeByGroup: Map<string | null, Track[]>
  /** Every node, archived included — the Structure admin needs them all. */
  mapNodes: MapNode[]
  /**
   * Precomputed id → node lookup over EVERY node, archived ones included, stable by
   * reference.
   *
   * Archived nodes are in here on purpose even though they are absent from the two
   * tree maps below: a deep link, a breadcrumb or an entry's `node_id` can still
   * name one, and a lookup that came back undefined would render that entry as
   * belonging to nothing rather than to a node that has been put away.
   */
  mapNodeById: Map<string, MapNode>
  /**
   * Parent id → its ACTIVE children, in sibling order, stable by reference.
   *
   * Every active node gets a bucket, empty ones included, because an organization
   * with nothing under it is a node the map draws — "which Org has nothing on it" is
   * one of the questions this feature exists to answer, and a missing bucket would
   * make a leaf and an unknown node indistinguishable at every call site.
   */
  mapChildren: Map<string, MapNode[]>
  /**
   * Track id → its ACTIVE depth-0 nodes, in sibling order, stable by reference.
   *
   * Keyed by track because tracks stay the top ring: this is the join between the
   * old shape and the new one, and it is why the two lists have to be derived
   * together.
   */
  mapRoots: Map<string, MapNode[]>
  /** Every node kind, ordered by sort_order. Kinds have no archived state. */
  mapNodeKinds: MapNodeKind[]
  /** Every use case, hidden included — the Catalogue admin needs them all. */
  useCases: UseCase[]
  /**
   * 0036: which of the five rungs each capability passes through, as a lookup.
   *
   * ⚠ EMPTY MEANS "ALL FIVE APPLY", NOT "NONE DO". The read fails on every load
   *   until 0036 is applied, and `lib/useCaseRungs.ts` is the ONE place that
   *   decision is made — nothing else may test this Map for emptiness and draw
   *   its own conclusion.
   */
  useCaseRungs: UseCaseRungMap
  /** The rows behind it, for the admin screen that edits them. */
  useCaseRungRows: UseCaseRungRow[]
  /** 0034's catalogue. Empty on a workspace that has not run it. */
  hisProducts: HisProduct[]
  /**
   * 0033's readiness, by node. A MISSING ENTRY IS "NOBODY HAS SAID" and is not
   * the same as a row whose three fields are all at their defaults.
   */
  readinessByNode: Map<string, NodeReadiness>
  /**
   * Precomputed `hidden === false` slice, stable by reference — the tracks/`active`
   * pair one table over, for its reason. A hidden capability has to leave every
   * picker and every matrix without disappearing from the admin list that can bring
   * it back.
   */
  visibleUseCases: UseCase[]
  /**
   * The onboarding ladder (0026), hidden rungs included — the stage admin needs
   * them all, because a rung that cannot be seen cannot be restored.
   *
   * EMPTY IS THE SHIPPING STATE. 0026 has not been applied, so this is `[]` on
   * every load until it is, and every consumer must render that as "no stages
   * configured yet" rather than as an error or an empty screen. That is
   * `useGroups()`' pre-0018 contract one wave on, and store/auth.ts's
   * `loadPermissions` reasoning for a table that does not exist yet.
   */
  mapNodeStages: MapNodeStage[]
  /**
   * Precomputed id → stage lookup over EVERY rung, hidden ones included, stable
   * by reference.
   *
   * Hidden rungs resolve here on purpose, `mapNodeById`'s reason: hiding a rung
   * removes it from the pickers and never un-stages the organizations standing on
   * it, so a progress row can name one and a lookup that came back undefined
   * would render that organization as being nowhere rather than on a rung that
   * has been retired.
   */
  stageById: Map<string, MapNodeStage>
  /**
   * Where each node has got to (0026) — at most one row per node, and FAR FEWER
   * ROWS THAN NODES IS THE ORDINARY STATE.
   *
   * ⚠ THE ABSENCE OF A ROW IS THE DATA. 0026 ships no backfill on purpose, so all
   *   400 imported organizations start with nothing here: "nobody has said
   *   anything yet", which is a different fact from the "Not started" rung an
   *   account manager looked at an organization and chose. The first number the
   *   directors want is how many nobody has looked at, and it exists only while
   *   those two states stay distinct — a consumer that defaults a missing row to
   *   a stage destroys it.
   */
  mapNodeProgress: MapNodeProgress[]
  /**
   * Precomputed node id → its progress row, stable by reference.
   *
   * UNDEFINED IS A MEANINGFUL ANSWER HERE, unlike `mapChildren` where an empty
   * bucket is given to every active node: there is no bucket to give, because
   * "no row" is the fact itself. `.get(id) === undefined` means nobody has said;
   * a row with `stage_id: null` means somebody looked and cleared it.
   */
  progressByNodeId: Map<string, MapNodeProgress>
  /**
   * The map-nodes read stopped at its page cap, so `mapNodes` is a WINDOW onto the
   * hierarchy and every count derived from it is low.
   *
   * TRUNCATION IS CARRIED, NOT SWALLOWED — api/entries.ts's rule, reaching this
   * store for the first time. It is here rather than left in the api layer because
   * the failure it describes has no other symptom: a partial map renders perfectly,
   * every ring is drawn, every number is wrong and nothing is red. `Mindtree.tsx`
   * reads it through `useMapNodesTruncated()` (Mindtree.tsx:323) and puts a sentence
   * in the work island beside the breadcrumb (Mindtree.tsx:1057), NEXT TO but never
   * merged with `model.truncated` — that one is the ENTRIES clamp, and collapsing the
   * two would tell somebody hunting a named organization that the numbers are merely
   * approximate. THE THREE SETTINGS SCREENS DROP THIS FLAG: StructureAdmin,
   * JiraAdmin and CatalogueAdmin take `.rows` and discard `.truncated`, so a clamped
   * hierarchy is still silent there. Named because it is a gap, not a decision.
   *
   * False on a cold start from cache, and that is not a guess: `writeRowCache`
   * refuses to store more than CACHE_MAX_ROWS rows, and a truncated read is by
   * construction MAX_PAGES × PAGE_SIZE = 5,000 of them, so a cached list can never
   * be a clipped one.
   */
  mapNodesTruncated: boolean
  /**
   * The saved Jira configuration (0028), or null when nobody has saved one.
   *
   * THE SIXTH READ, AND IT IS ONE ROW. It belongs here for the reason the map
   * hierarchy does: `useJiraEnabled()` decides whether a "view in Jira" link
   * EXISTS on surfaces that are already rendering from this store, and a second
   * store would be a second load, a second cache and a second chance for two
   * parts of one screen to disagree about whether the integration is on.
   *
   * NULL IS THREE STATES AT ONCE AND THE SCREENS SEPARATE THEM, not this field:
   * nobody has saved a configuration, the read failed, or 0028 has not been
   * applied to this project. All three mean the same thing to every consumer
   * except the Settings card — Jira is OFF — which is why `useJiraEnabled()`
   * can be one boolean and the card is the one place that names the state.
   *
   * ⚠ DELIBERATELY NOT CACHED IN localStorage, unlike all five lists above. A
   *   cached `enabled: true` would render Jira surfaces on first paint from a
   *   value that may since have been switched off — the off-switch has to fail
   *   CLOSED, and the only way to be sure of that is to have nothing to fail
   *   open from. It is one small row on a load that already makes five reads.
   */
  jiraSettings: JiraSettings | null
  /**
   * How many saved status words carried a value this app no longer knows.
   *
   * Carried rather than swallowed, `mapNodesTruncated`'s rule for the same
   * reason: the failure has no other symptom. A dropped mapping renders as a
   * perfectly ordinary preview in which some issues report "status not mapped",
   * which reads as a Jira problem and is not one. api/jiraSettings.ts drops and
   * counts; the Settings card and the Jira screen say so.
   */
  jiraStatusesDropped: number
  loading: boolean
  /** Epoch ms of the last successful load; null means never loaded. */
  loadedAt: number | null
}

/** The track half of the state, so the derived views cannot drift from the list. */
function derive(
  tracks: Track[],
  groups: TrackGroup[],
): Pick<ConfigState, 'tracks' | 'active' | 'byId' | 'activeByGroup'> {
  const active = tracks.filter((tr) => !tr.archived)
  const activeByGroup = new Map<string | null, Track[]>()
  // Every group gets a bucket even when it holds nothing, so a group-grouped
  // screen can render an honest empty section instead of silently omitting a
  // group that exists. The ungrouped bucket is created on demand — an
  // "Ungrouped" heading over nothing is noise, not information.
  for (const group of groups) activeByGroup.set(group.id, [])
  for (const track of active) {
    // Three things all mean "ungrouped", and all three have to land in the SAME
    // bucket:
    //   * `group_id` absent — `Track.group_id` is optional for the reason
    //     types.ts documents, so a hand-built fixture or a pre-0018 cache row
    //     has no key at all;
    //   * `group_id` null — the ordinary, legal ungrouped state;
    //   * `group_id` naming a group that is not in `groups`. Live data cannot
    //     produce that (the FK is `on delete set null`), but the two
    //     localStorage caches are written at different moments, so a groups
    //     cache refreshed after a delete can leave a tracks cache pointing at a
    //     group that is gone. Filing that track under its dead id would put it
    //     in a bucket no consumer iterates — a track that vanishes from the
    //     screen entirely, which is far worse than one shown as ungrouped.
    const key =
      track.group_id != null && activeByGroup.has(track.group_id) ? track.group_id : null
    const bucket = activeByGroup.get(key)
    if (bucket) bucket.push(track)
    else activeByGroup.set(key, [track])
  }
  return {
    tracks,
    active,
    byId: new Map(tracks.map((tr) => [tr.id, tr])),
    activeByGroup,
  }
}

/** The group half. Split from derive() only because the two land independently. */
function deriveGroups(groups: TrackGroup[]): Pick<ConfigState, 'groups' | 'groupById'> {
  return {
    groups,
    groupById: new Map(groups.map((g) => [g.id, g])),
  }
}

/**
 * The hierarchy half (0023): the id lookup and the two tree maps, built ONCE here.
 *
 * THIS IS THE FUNCTION THE FILE'S HEADER IS ABOUT. A selector that built
 * `mapChildren` per call would return a new Map on every render, which under
 * useSyncExternalStore means "the snapshot changed" — forever. It is the single most
 * expensive mistake available in this file and a tree is the shape most likely to
 * tempt someone into it, because "children of X" looks like a question rather than
 * a view.
 *
 * WHERE EACH ACTIVE NODE LANDS, in the order the cases are tested:
 *
 *   * `parent_id` null — a depth-0 node. Into its track's root bucket.
 *   * parent is an ACTIVE node — into that node's child bucket.
 *   * parent exists but is ARCHIVED — dropped from both maps. Archiving a phase puts
 *     its subtree away with it; a phase that vanishes while its five organizations
 *     stay on the map is a tree the reader cannot explain, and the admin screen says
 *     so before the click.
 *   * parent is not in the list AT ALL — into its track's root bucket. Live data
 *     cannot produce this, but the caches are written at different moments and a
 *     node whose parent was deleted in another session must not become a node no
 *     consumer iterates. That is `activeByGroup`'s dead-group reasoning verbatim,
 *     and it lands the same way: shown one ring too high beats gone.
 *
 * A node whose `track_id` names a track that is not active gets NO bucket, and that
 * is deliberate rather than an oversight — the map draws tracks first and a node
 * under an archived track has nowhere to be drawn. It is still in `mapNodeById`, so
 * a breadcrumb or a deep link resolves it by name.
 */
function deriveMap(
  tracks: Track[],
  nodes: MapNode[],
): Pick<ConfigState, 'mapNodes' | 'mapNodeById' | 'mapChildren' | 'mapRoots'> {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const active = nodes.filter((n) => !n.archived)
  const activeIds = new Set(active.map((n) => n.id))

  const mapChildren = new Map<string, MapNode[]>()
  for (const node of active) mapChildren.set(node.id, [])

  const mapRoots = new Map<string, MapNode[]>()
  for (const track of tracks) if (!track.archived) mapRoots.set(track.id, [])

  for (const node of active) {
    if (node.parent_id !== null && activeIds.has(node.parent_id)) {
      mapChildren.get(node.parent_id)?.push(node)
      continue
    }
    // An archived parent takes its subtree with it — the one case that lands nowhere.
    if (node.parent_id !== null && byId.has(node.parent_id)) continue
    mapRoots.get(node.track_id)?.push(node)
  }

  return { mapNodes: nodes, mapNodeById: byId, mapChildren, mapRoots }
}

/**
 * The stage half (0026): the two lookups, built in ONE PASS each.
 *
 * `new Map(rows.map(…))` on both, which is one traversal per list and no
 * intermediate filtering — the ladder is seven rows and the progress list is one
 * row per organization at most, but this function runs on every load and on every
 * 30-second focus refetch, beside four other derivations over the same data.
 *
 * NEITHER MAP IS FILTERED, and both omissions are the same decision made twice: a
 * HIDDEN rung still has to resolve (organizations keep standing on it) and a
 * progress row whose node is archived still has to resolve (a breadcrumb or a
 * deep link can name it). Filtering here would make a lookup that came back
 * undefined mean two different things.
 *
 * THERE IS NO `visibleStages` SLICE, unlike `visibleUseCases` one field over, and
 * that is a judgement rather than an oversight: the picker's answer is not "the
 * unhidden rungs" but "the unhidden rungs PLUS whichever rung this organization
 * is already standing on", because a node parked on a retired rung must not have
 * its stage silently rewritten by opening its picker. That slice depends on the
 * node, so it belongs at the call site; a store-level `visibleStages` would be
 * the almost-right list sitting where the right one should be.
 */
function deriveStages(
  stages: MapNodeStage[],
  progress: MapNodeProgress[],
): Pick<ConfigState, 'mapNodeStages' | 'stageById' | 'mapNodeProgress' | 'progressByNodeId'> {
  return {
    mapNodeStages: stages,
    stageById: new Map(stages.map((s) => [s.id, s])),
    mapNodeProgress: progress,
    progressByNodeId: new Map(progress.map((p) => [p.node_id, p])),
  }
}

/**
 * Every derived view, from all four lists at once.
 *
 * THE SINGLE ENTRY POINT FOR A STATE WRITE, and the reason has grown rather than
 * changed. `activeByGroup` spans tracks and groups: a groups read landing after a
 * tracks read has to rebuild the buckets, and calling only `deriveGroups` would
 * leave them keyed off the groups that existed a moment ago. `mapRoots` spans tracks
 * and nodes in exactly the same way — a tracks read that lands while the node list
 * sits unchanged still has to rebuild the root buckets, or a newly created track
 * gets no bucket and every node under it silently stops being drawn.
 *
 * The kinds and the use cases derive nothing that depends on anything else, but they
 * come through here anyway: one function that takes the whole world and returns the
 * whole world is what makes "did I rebuild everything that depends on this?" a
 * question nobody has to ask.
 *
 * `mapNodesTruncated` is one of the fields of the state this function does NOT
 * return, and the Omit says so rather than a comment alone: it is a property of the
 * READ, not of the rows. No arrangement of the five lists can tell you whether a
 * sixth page existed, so deriving it here would mean inventing it. The two Jira
 * fields are omitted for the same kind of reason one step further out — they come
 * from a different table entirely and nothing in these five lists implies them.
 */
function deriveAll(
  tracks: Track[],
  groups: TrackGroup[],
  nodes: MapNode[],
  kinds: MapNodeKind[],
  useCases: UseCase[],
  useCaseRungRows: UseCaseRungRow[],
  hisProducts: HisProduct[],
  readiness: NodeReadiness[],
  stages: MapNodeStage[],
  progress: MapNodeProgress[],
): Omit<
  ConfigState,
  'loading' | 'loadedAt' | 'mapNodesTruncated' | 'jiraSettings' | 'jiraStatusesDropped'
> {
  return {
    // Carried straight through: the catalogue derives nothing, and a `hisById`
    // map would be a second index for one picker on one panel.
    hisProducts,
    readinessByNode: new Map(readiness.map((row) => [row.node_id, row])),
    ...derive(tracks, groups),
    ...deriveGroups(groups),
    ...deriveMap(tracks, nodes),
    // The stage half derives nothing that depends on the four lists above it —
    // `stageById` is keyed by stage and `progressByNodeId` by node, and neither
    // is filtered against the tree — but it comes through here for the reason the
    // kinds do: one function that takes the whole world and returns the whole
    // world is what makes "did I rebuild everything that depends on this?" a
    // question nobody has to ask.
    ...deriveStages(stages, progress),
    mapNodeKinds: kinds,
    useCases,
    visibleUseCases: useCases.filter((u) => !u.hidden),
    useCaseRungRows,
    // Folded ONCE here rather than per render: a selector that builds a Map is
    // "the snapshot changed, forever" under useSyncExternalStore, which is the
    // loop this file's header opens with.
    useCaseRungs: buildUseCaseRungMap(useCaseRungRows),
  }
}

/**
 * Last known rows of one table, for first paint. Without a cache the shell renders
 * a screen of skeleton colour bars on every cold load even though the answer changes
 * about once a month. It is trusted only until the network replies.
 *
 * ONE GENERIC FUNCTION RATHER THAN SEVEN COPIES. It was two — tracks and groups —
 * and the map hierarchy made it five, at which point the sixth is where somebody
 * forgets the try/catch. Every one of the seven caches is a JSON array of rows
 * keyed by ONE string column, so there is exactly one thing to write.
 *
 * `idField` IS A PARAMETER BECAUSE `map_node_progress` HAS NO `id` (0026): its
 * primary key is `node_id`, which is the whole reason at most one row can exist
 * per node. Hard-coding 'id' would have made every cached progress row fail the
 * shape check below and be silently dropped — a cache that is written, read back
 * empty, and reports no error. The default keeps the other six call sites
 * unchanged.
 *
 * Shape-check one field rather than validating fully: the only realistic corruption
 * is a cache written by an older column set, and every consumer keys off that field.
 */
function readRowCache<T>(key: string, idField = 'id'): T[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (row): row is T =>
        typeof row === 'object' &&
        row !== null &&
        typeof (row as Record<string, unknown>)[idField] === 'string',
    )
  } catch {
    // Quota errors, private-mode restrictions, a hand-edited value — none of
    // them are worth failing a page load over.
    return []
  }
}

/**
 * The most rows any of the five caches may hold.
 *
 * MEASURED, NOT CHOSEN. `MAP_NODES_CACHE_KEY` holds every column of every node —
 * ~600 bytes a row — and it is `JSON.stringify`'d and `setItem`'d SYNCHRONOUSLY on
 * the load that gates first paint, then rewritten on every 30-second focus refetch.
 * At 400 organizations that is a ~250KB blob written on the main thread twice a
 * minute; at the read's own ceiling of 5,000 it would be ~3MB, which is most of a
 * 5MB origin quota spent on a screen the network is about to answer anyway.
 *
 * ABOVE THE CAP, WRITE NOTHING AND REMOVE THE KEY. A cache with the first thousand
 * rows of a five-thousand-row workspace is worse than no cache: the first paint
 * would draw a confidently wrong map from it, and `mapNodesTruncated` — which
 * belongs to the READ, not to the rows — would be false while it did. Removing the
 * stale key is the half that is easy to forget and the half that matters: leaving
 * yesterday's smaller-workspace blob in place would keep serving it forever.
 */
const CACHE_MAX_ROWS = 1000

function writeRowCache(key: string, rows: readonly unknown[]): void {
  try {
    if (rows.length > CACHE_MAX_ROWS) {
      localStorage.removeItem(key)
      return
    }
    localStorage.setItem(key, JSON.stringify(rows))
  } catch {
    // Best effort: a full quota must not break a successful fetch.
  }
}

const useConfigStore = create<ConfigState>(() => ({
  ...deriveAll(
    readRowCache<Track>(CACHE_KEY),
    readRowCache<TrackGroup>(GROUPS_CACHE_KEY),
    readRowCache<MapNode>(MAP_NODES_CACHE_KEY),
    readRowCache<MapNodeKind>(MAP_NODE_KINDS_CACHE_KEY),
    readRowCache<UseCase>(USE_CASES_CACHE_KEY),
    readRowCache<UseCaseRungRow>(USE_CASE_RUNGS_CACHE_KEY),
    readRowCache<HisProduct>(HIS_PRODUCTS_CACHE_KEY),
    // `node_id`, not `id` — 0033 gives this table no surrogate key either.
    readRowCache<NodeReadiness>(READINESS_CACHE_KEY, 'node_id'),
    readRowCache<MapNodeStage>(MAP_NODE_STAGES_CACHE_KEY),
    // `node_id`, not `id` — 0026 gives this table no surrogate key. See
    // readRowCache's own note: the default would drop every cached row.
    readRowCache<MapNodeProgress>(MAP_NODE_PROGRESS_CACHE_KEY, 'node_id'),
  ),
  // See the field's own note: the cache cannot hold a clipped read, so the honest
  // opening answer is "not truncated" rather than "unknown".
  mapNodesTruncated: false,
  // NO CACHE, AND THE OPENING ANSWER IS OFF. Every other field above opens from
  // localStorage; this one opens from nothing, because the only failure mode
  // worth designing against here is a Jira surface appearing when it should not.
  jiraSettings: null,
  jiraStatusesDropped: 0,
  loading: false,
  loadedAt: null,
}))

// ── selectors ──────────────────────────────────────────────────────────────

/** Every track, archived included. Ordered by sort_order. */
export function useTracks(): Track[] {
  return useConfigStore((s) => s.tracks)
}

/** Only the tracks work can still be filed under — what every non-admin screen wants. */
export function useActiveTracks(): Track[] {
  return useConfigStore((s) => s.active)
}

/** id → track, for rendering an entry's track without scanning the list per row. */
export function useTrackMap(): Map<string, Track> {
  return useConfigStore((s) => s.byId)
}

/**
 * Every group, ordered by sort_order (0018). Technical and Business today.
 *
 * Returns `[]` on a workspace whose database predates 0018 and on the first
 * paint of a cold load — both of which a consumer must render as "no grouping",
 * i.e. the flat list this app shipped with, NOT as an error and not as an empty
 * screen. Grouping is a lens over tracks; the tracks are the data.
 */
export function useGroups(): TrackGroup[] {
  return useConfigStore((s) => s.groups)
}

/** id → group, for rendering a track's group without scanning the list per row. */
export function useGroupMap(): Map<string, TrackGroup> {
  return useConfigStore((s) => s.groupById)
}

/**
 * Active tracks bucketed by `group_id`, with `null` holding the ungrouped ones.
 *
 * Every existing group has a bucket, empty ones included, so a group-grouped
 * screen renders an honest empty section rather than dropping a group that
 * exists. The `null` bucket is present only when something is actually in it.
 */
export function useTracksByGroup(): Map<string | null, Track[]> {
  return useConfigStore((s) => s.activeByGroup)
}

// ── the map hierarchy (0023/0024) ──────────────────────────────────────────
//
// EVERY ONE OF THESE RETURNS A STORED REFERENCE. Not one of them filters, maps,
// sorts or builds — that all happened in deriveAll() when the data landed. The two
// tree maps are the ones to watch: `useMapChildren().get(id)` is a lookup in a Map
// that already exists, and rewriting it as `useMapNodes().filter(n => n.parent_id
// === id)` would be a new array on every render of every node, which is the infinite
// useSyncExternalStore loop this file's header opens with.

/** Every node, archived included. Ordered by sort_order, then name. */
export function useMapNodes(): MapNode[] {
  return useConfigStore((s) => s.mapNodes)
}

/**
 * id → node over EVERY node, archived ones included.
 *
 * Archived nodes resolve here on purpose: an entry's `node_id`, a breadcrumb or a
 * pasted deep link can name one, and a lookup that came back undefined would render
 * it as belonging to nothing rather than to something put away.
 */
export function useMapNodeMap(): Map<string, MapNode> {
  return useConfigStore((s) => s.mapNodeById)
}

/**
 * parent id → its active children, in sibling order.
 *
 * Every active node has a bucket, empty ones included, so a leaf and an id this
 * store has never seen are distinguishable — `[]` means "an organization with
 * nothing under it", `undefined` means "no such node".
 */
export function useMapChildren(): Map<string, MapNode[]> {
  return useConfigStore((s) => s.mapChildren)
}

/**
 * track id → its active depth-0 nodes, in sibling order.
 *
 * Every ACTIVE track has a bucket, empty ones included, exactly as every group has
 * one in `useTracksByGroup`: a track with no hierarchy beneath it is the ordinary
 * state of every track in the workspace today, and it has to render as the tree this
 * app already draws rather than as a gap.
 */
export function useMapRoots(): Map<string, MapNode[]> {
  return useConfigStore((s) => s.mapRoots)
}

/**
 * True when the hierarchy on screen is a WINDOW rather than the whole thing.
 *
 * THE ONE SELECTOR HERE THAT A SCREEN MUST NOT IGNORE. Every other value in this
 * store is wrong only if the read failed, and a failed read is visible; this one is
 * the flag on a read that SUCCEEDED and came back short, which is the only failure
 * in this file that renders as a complete, plausible, wrong map. `Mindtree.tsx`
 * pairs it with a sentence in the footer, the way `MapBranch.tsx:753-760` pairs
 * `useEntriesTruncated()` with `track.statsPartial`.
 */
export function useMapNodesTruncated(): boolean {
  return useConfigStore((s) => s.mapNodesTruncated)
}

/** Every node kind — Programme, Phase, Organization — ordered by sort_order. */
export function useMapNodeKinds(): MapNodeKind[] {
  return useConfigStore((s) => s.mapNodeKinds)
}

/**
 * The use cases a picker or a matrix should offer — hidden ones excluded.
 *
 * THE VISIBLE SLICE, not the whole list, which is the opposite way round from
 * `useTracks`/`useActiveTracks` and is worth one sentence: there are two consumers
 * of tracks and dozens of the catalogue, so the short name goes to the answer almost
 * every caller wants. The Catalogue admin, the one screen that has to see a hidden
 * capability in order to bring it back, asks for `useAllUseCases()`.
 */
export function useUseCases(): UseCase[] {
  return useConfigStore((s) => s.visibleUseCases)
}

/** Every use case, hidden included — the Catalogue admin's list. */
export function useAllUseCases(): UseCase[] {
  return useConfigStore((s) => s.useCases)
}

/**
 * 0036's ladder membership, as a lookup keyed by capability.
 *
 * ⚠ AN EMPTY MAP MEANS "ALL FIVE APPLY", and no caller may decide that for
 *   itself — every reader goes through `rungsFor()` / `rungApplies()` in
 *   lib/useCaseRungs.ts, which is the one place that decision is written and
 *   the one place it agrees with 0036's own guard.
 */
export function useUseCaseRungs(): UseCaseRungMap {
  return useConfigStore((s) => s.useCaseRungs)
}

/** The rows behind the lookup — only the admin screen that edits them wants these. */
export function useUseCaseRungRows(): UseCaseRungRow[] {
  return useConfigStore((s) => s.useCaseRungRows)
}

/**
 * The HIS catalogue (0034), hidden rows included.
 *
 * `useAllUseCases`' contract: a picker offering a system to record shows the
 * live ones, and a panel READING a system already recorded must be able to name
 * a retired one — hiding a product retires it from the picker and changes
 * nothing about the organizations already on it.
 *
 * Empty on a workspace that has not run 0034, which reads as "nothing recorded"
 * everywhere and never as an error.
 */
export function useHisProducts(): HisProduct[] {
  return useConfigStore((s) => s.hisProducts)
}

/**
 * What one organization has ready — 0033's three things before ADT.
 *
 * `undefined` is NOBODY HAS SAID, and the panel must draw it as such: the table
 * is empty today, so this is the answer for all 140 organizations, and rendering
 * it as three unticked boxes and "Not started" would be a measurement nobody
 * took presented as one somebody did.
 */
export function useNodeReadiness(nodeId: string | null): NodeReadiness | undefined {
  return useConfigStore((s) => (nodeId === null ? undefined : s.readinessByNode.get(nodeId)))
}

// ── the stage ladder and where each node got to (0026) ─────────────────────
//
// ALL THREE RETURN STORED REFERENCES, like every selector above them, and the two
// Maps are the ones to watch: `useNodeProgress().get(id)` is a lookup in a Map
// that already exists, while `useMapNodeStages().find(s => s.id === …)` per node
// would be O(rungs) on every render of every organization on the canvas.
//
// EMPTY IS THE SHIPPING ANSWER FROM ALL THREE until Aziz applies 0026, and every
// consumer has to render that as "no stages configured yet" — not as an error,
// not as a spinner, and not as a blank where a picker should be.

/**
 * Every rung, hidden ones included, ordered by sort_order.
 *
 * THE WHOLE LADDER RATHER THAN A VISIBLE SLICE, which is the opposite way round
 * from `useUseCases()` one section up. Two reasons, and the second is the real
 * one: the stage admin has to see a hidden rung in order to restore it, and a
 * picker's correct list is "the unhidden rungs plus whichever rung this node is
 * already on" — which depends on the node, so it cannot be precomputed here
 * without being subtly wrong for exactly the organizations parked on a retired
 * rung.
 */
export function useMapNodeStages(): MapNodeStage[] {
  return useConfigStore((s) => s.mapNodeStages)
}

/**
 * id → rung, over every rung including hidden ones.
 *
 * The second half of every stage lookup on the canvas: `useNodeProgress().get(
 * nodeId)?.stage_id` names a rung, and this resolves it. Hidden rungs resolve on
 * purpose — hiding removes a rung from the pickers and never un-stages the
 * organizations standing on it.
 */
export function useStageMap(): Map<string, MapNodeStage> {
  return useConfigStore((s) => s.stageById)
}

/**
 * node id → its progress row, or `undefined` when nobody has said anything yet.
 *
 * ⚠ `undefined` IS THE ANSWER, NOT A MISS. It is the state all 400 imported
 *   organizations are in the day 0026 applies, because the migration ships no
 *   backfill on purpose, and it is a DIFFERENT fact from a row whose `stage_id`
 *   is null (somebody looked and cleared it). A caller that coalesces the two —
 *   or that fills a missing row in with the first rung — throws away the number
 *   the directors ask for first: how many has nobody even looked at.
 */
export function useNodeProgress(): Map<string, MapNodeProgress> {
  return useConfigStore((s) => s.progressByNodeId)
}

export function useConfigLoading(): boolean {
  return useConfigStore((s) => s.loading)
}

// ── Jira, and the one answer to "is it on" (0028) ──────────────────────────

/**
 * TRUE ONLY WHEN JIRA IS BOTH TURNED ON AND USABLE — the single question every
 * Jira surface outside Settings asks, and the reason there is one hook.
 *
 * ⚠ THE ALTERNATIVE THIS EXISTS TO PREVENT is `settings?.site_base_url != null`
 *   written out at four call sites. Four copies of a predicate is four answers
 *   the day one of them is edited, and the failure is silent in the worst
 *   direction: a link that appears on one screen and not another, for a feature
 *   the owner believes is switched off.
 *
 * TWO CONDITIONS, NOT ONE. `enabled` is the owner's decision; a `siteBaseUrl` is
 * what makes a link possible at all. A workspace that is switched on with no
 * site address can produce no href, and "an integration is on" plus "every link
 * it would draw is dead" is worse than off — so this answers false and the
 * Settings card names that state in words rather than leaving it to be guessed.
 *
 * FALSE ON EVERY DEGRADED PATH: signed out, before the first load lands, when
 * the read failed, when 0028 has not been applied, and when the row has never
 * been saved. The off-switch fails CLOSED (see the field's own note), which is
 * what makes shipping this ahead of the migration safe.
 */
export function useJiraEnabled(): boolean {
  return useConfigStore(
    (s) => s.jiraSettings?.enabled === true && (s.jiraSettings?.siteBaseUrl ?? '') !== '',
  )
}

/**
 * The whole saved configuration, or null when nobody has saved one.
 *
 * FOR THE TWO SETTINGS SCREENS ALONE — the card on /settings and the Jira screen
 * that edits it. Everything else asks `useJiraEnabled()`: a surface that reads
 * this object is a surface that can invent its own definition of "on".
 */
export function useJiraSettings(): JiraSettings | null {
  return useConfigStore((s) => s.jiraSettings)
}

/**
 * How many saved status words no longer mean anything here — 0 in the ordinary
 * case, and the number the screens have to say out loud when it is not.
 */
export function useJiraStatusesDropped(): number {
  return useConfigStore((s) => s.jiraStatusesDropped)
}

// ── loading ────────────────────────────────────────────────────────────────

/**
 * The load in progress. Concurrent callers (three components mounting at once,
 * a route change racing the focus listener) await this one promise instead of
 * each firing their own request and writing the answer three times.
 */
let inFlight: Promise<void> | null = null

/**
 * What one of the five reads decided, and what the store should hold because of it.
 *
 * ONE FUNCTION RATHER THAN FIVE COPIES OF THE SAME THREE-BRANCH DECISION. The rules
 * were written for tracks and groups and are identical for all five:
 *
 *   * A FAILED read keeps the previous rows rather than writing `[]` over them.
 *     That is FIX-APP-6's lesson — a failed read must not latch — and it matters
 *     more with five lists than it did with two, because 0023 lands on a live
 *     workspace and three of these will 404 until it does. The focus listener
 *     retries within STALE_AFTER_MS.
 *   * An EMPTY list from an UNAUTHENTICATED read is not an answer. Signed out, RLS
 *     makes every read come back empty; believing it poisons the cache for the rest
 *     of the session and, for tracks, stamps `loadedAt` and short-circuits every
 *     load after it.
 *   * Anything else is good data: keep it and write the cache.
 *
 * `accepted` is what the caller stamps `loadedAt` from, so the flag and the rows
 * cannot drift apart the way two parallel `if` chains eventually do.
 *
 * IT TAKES BOTH SHAPES, AND THAT IS WHY IT IS STILL ONE FUNCTION. Three of the five
 * reads now answer with `Loaded<T>` — rows plus the verdict on whether the server
 * had more — while `listTracks` and `listGroups` still answer with a plain array,
 * because at nine tracks and two groups they cannot be clipped and giving them a
 * flag that is always false would be ceremony. A second `settleLoaded` would be the
 * fifth copy of the three-branch decision this function exists to prevent, so the
 * union is absorbed here in one line and `truncated` comes out false for the arrays.
 */
function isLoaded<T>(data: T[] | Loaded<T>): data is Loaded<T> {
  // The two shapes are an array and an object with a `rows` array. Array.isArray is
  // the whole test: a `Loaded<T>` is never an array, and this stays true if the
  // interface gains a field, which `data.rows !== undefined` would not survive if a
  // row type ever grew a `rows` of its own.
  return !Array.isArray(data)
}

// The constraint used to be `T extends { id: string }`, and it was dropped when
// `map_node_progress` joined the load: that table's key is `node_id` (0026), and
// nothing in this function ever reads a row's identity — it counts rows, checks
// the session and hands the list to writeRowCache, which takes `unknown[]`. A
// constraint that no line depends on is a constraint that only excludes correct
// callers.
function settle<T>(
  label: string,
  result: ApiResult<T[] | Loaded<T>>,
  previous: T[],
  cacheKey: string,
): { rows: T[]; accepted: boolean; truncated: boolean } {
  if (!result.ok) {
    console.warn(`[config] ${label} load failed:`, result.error)
    return { rows: previous, accepted: false, truncated: false }
  }
  const rows = isLoaded(result.data) ? result.data.rows : result.data
  const truncated = isLoaded(result.data) ? result.data.truncated : false
  if (rows.length === 0 && !hasSession()) {
    console.warn(`[config] ignoring an empty ${label} read made without a session`)
    return { rows: previous, accepted: false, truncated: false }
  }
  writeRowCache(cacheKey, rows)
  return { rows, accepted: true, truncated }
}

/**
 * settle() for a read that answers with ONE THING rather than a list — the Jira
 * configuration (0028).
 *
 * A SECOND FUNCTION RATHER THAN A WIDENED FIRST ONE, and the split is honest
 * rather than lazy: settle()'s three branches are all about rows — "keep the
 * previous ROWS", "an empty LIST from an unauthenticated read is not an answer",
 * "write the row CACHE" — and two of the three have no meaning here. There is no
 * cache to write (see the field's note: the off-switch must fail closed), and an
 * absent configuration is not an empty list, it is a legitimate answer that the
 * Settings card names.
 *
 * ONE BRANCH SURVIVES AND IT IS THE ONE THAT MATTERS: a FAILED read keeps what
 * was already in hand rather than writing null over it. That is FIX-APP-6's
 * lesson — a failed read must not latch — and here it has a second edge: on a
 * project where 0028 has not been applied this read fails on every attempt, and
 * blanking the state each time would be indistinguishable from success.
 *
 * ⚠ THE UNAUTHENTICATED CASE IS NOT SPECIAL-CASED, and that is deliberate. Signed
 *   out, RLS makes this read come back with NO ROW, which lands as
 *   `settings: null` — Jira off. That is the correct answer for a signed-out
 *   reader, not a poisoned one, because nothing is cached and the next signed-in
 *   load overwrites it.
 */
function settleOne<T>(
  label: string,
  result: ApiResult<T>,
  previous: T,
): { value: T; accepted: boolean } {
  if (!result.ok) {
    console.warn(`[config] ${label} load failed:`, result.error)
    return { value: previous, accepted: false }
  }
  return { value: result.data, accepted: true }
}

/**
 * Fetch tracks, groups and the map hierarchy unless a good copy is already in hand.
 *
 * Safe to call unawaited (`void loadConfig()`) and safe to call twice
 * concurrently. It never rejects: a failure leaves whatever was cached in place
 * and logs, because the tracks list is chrome on most screens and blowing up a
 * route's render for it would be a worse outcome than a slightly stale colour.
 *
 * THE EIGHT READS ARE INDEPENDENT, and that asymmetry is deliberate. The last
 * three are the newest: the stage ladder and the progress rows (0026), and the
 * Jira configuration (0028) — one row, joining the load rather than taking a store
 * of its own for the reason the hierarchy did: `useJiraEnabled()` decides whether
 * a link EXISTS on surfaces already rendering from here.
 *
 *   * THREE OF THE EIGHT FAIL ON EVERY LOAD TODAY, and shipping that way is the
 *     plan rather than a risk taken: 0026 and 0028 are applied by hand AFTER
 *     this wave lands, so `map_node_stages`, `map_node_progress` and
 *     `jira_settings` all answer 42P01 until they are. All three go through
 *     settle() like everything else — a warn, the previous rows, no stamp —
 *     which is why the app has to be correct on both sides of that moment
 *     without a flag, a version check or a second code path.
 *
 *   * `loadedAt` is stamped on the TRACKS read ALONE, exactly as it always has
 *     been, and the three new reads change nothing about that. Groups are a lens
 *     over tracks and the hierarchy hangs beneath them — a workspace whose database
 *     predates 0018 gets a 404 from `track_groups` on every attempt, and one that
 *     predates 0023 gets three more, and letting any of that hold `loadedAt` at null
 *     would refire the whole load on every component mount, forever. That is a retry
 *     storm this store did not have yesterday, introduced by an additive feature, on
 *     the app's most-mounted read. It is also not hypothetical THIS time: the live
 *     workspace is applied through 0025 — 0023, 0024 and 0025 landed on 12 Aug
 *     2026 — and 0026, 0027 and 0028 have never been run against any database,
 *     so the three reads named above 404 on it right now
 *     (docs/PENDING-MIGRATIONS.md).
 *   * A failed read of any of the other four leaves its previous data in place
 *     rather than writing `[]` over it — see settle() above.
 *   * `Promise.all`, not eight awaits: one round trip's latency, not eight, on the
 *     load that gates first paint.
 *   * Use cases are read WITH the hidden ones (`listUseCases(true)`), because this
 *     store is the Catalogue admin's list as well as every picker's, and the
 *     visible slice is derived rather than fetched — one read, two answers, no way
 *     for them to disagree.
 */
export function loadConfig(force = false): Promise<void> {
  if (inFlight) return inFlight
  if (!force && useConfigStore.getState().loadedAt !== null) return Promise.resolve()

  // Only show the spinner when there is genuinely nothing to show. A focus
  // refetch with a warm cache must not blank the list the user is looking at.
  if (useConfigStore.getState().tracks.length === 0) {
    useConfigStore.setState({ loading: true })
  }

  inFlight = Promise.all([
    listTracks(true),
    listGroups(),
    listMapNodes(true),
    listMapNodeKinds(),
    listUseCases(true),
    listUseCaseRungs(),
    listHisProducts(true),
    listReadiness(),
    listMapNodeStages(),
    listMapNodeProgress(),
    loadJiraSettings(),
  ])
    // Destructured in the BODY rather than in the parameter list: at eight reads
    // the tuple no longer fits on the arrow's line, and a wrapped parameter list
    // would re-indent every line of a function whose diff should stay readable.
    // `Promise.all` gives this a tuple type, so each name below is still checked
    // against the read it comes from and a reordered array is a compile error.
    .then((results) => {
      const [
        trackResult,
        groupResult,
        nodeResult,
        kindResult,
        useCaseResult,
        useCaseRungResult,
        hisResult,
        readinessResult,
        stageResult,
        progressResult,
        jiraResult,
      ] = results
      const prev = useConfigStore.getState()
      const tracks = settle('tracks', trackResult, prev.tracks, CACHE_KEY)
      const groups = settle('groups', groupResult, prev.groups, GROUPS_CACHE_KEY)
      const nodes = settle('map nodes', nodeResult, prev.mapNodes, MAP_NODES_CACHE_KEY)
      const kinds = settle('node kinds', kindResult, prev.mapNodeKinds, MAP_NODE_KINDS_CACHE_KEY)
      const useCases = settle('use cases', useCaseResult, prev.useCases, USE_CASES_CACHE_KEY)
      // ⚠ EXPECTED TO FAIL UNTIL 0036 IS APPLIED, and the failure is correct
      //   rather than tolerated: settle() warns, keeps the rows already in hand
      //   — `[]`, because there have never been any — and does not latch, so the
      //   focus refetch picks the table up the moment it exists. `rungsFor()`
      //   turns that empty set into all five, which IS the behaviour before this
      //   table, so every screen reads identically either way.
      const useCaseRungs = settle(
        'use case rungs',
        useCaseRungResult,
        prev.useCaseRungRows,
        USE_CASE_RUNGS_CACHE_KEY,
      )
      const hisProducts = settle('HIS products', hisResult, prev.hisProducts, HIS_PRODUCTS_CACHE_KEY)
      const readiness = settle(
        'readiness',
        readinessResult,
        [...prev.readinessByNode.values()],
        READINESS_CACHE_KEY,
      )
      // ⚠ THE TWO READS THAT ARE EXPECTED TO FAIL TODAY. 0026 has not been applied
      //   to the live database, so both answer 42P01 (PostgREST: PGRST205) on
      //   every load until Aziz runs it. settle() is already the right shape for
      //   that and needs no special case: it warns to the console, keeps the
      //   previous rows — `[]` here, because there has never been anything else —
      //   and does NOT stamp anything, so nothing latches and the focus refetch
      //   picks the tables up the moment they exist. This is store/auth.ts's
      //   loadPermissions reasoning for a pre-0025 workspace, with one difference
      //   that makes it simpler: there is no legacy answer to fall back to, and
      //   "no stages configured yet" is the honest sentence for both the
      //   pre-migration state and a genuinely empty ladder.
      const stages = settle('stages', stageResult, prev.mapNodeStages, MAP_NODE_STAGES_CACHE_KEY)
      const progress = settle(
        'node progress',
        progressResult,
        prev.mapNodeProgress,
        MAP_NODE_PROGRESS_CACHE_KEY,
      )
      // THE ONE-ROW READ. No cache, and its failure is as harmless as it
      // is loud: everything below keeps the previous value and `useJiraEnabled()`
      // stays false. On a project without 0028 it fails on every load, which is
      // exactly the state the Settings card renders as "not set up yet".
      const jira = settleOne('jira settings', jiraResult, {
        settings: prev.jiraSettings,
        droppedStatuses: prev.jiraStatusesDropped,
      })

      // ONE setState, ONE deriveAll, whatever succeeded and whatever did not. The
      // rebuild is unconditional because the derived views SPAN the lists: a groups
      // read that lands alone still has to rebuild `activeByGroup`, and a tracks
      // read that lands alone still has to rebuild `mapRoots`. Publishing only the
      // lists that changed is how a bucket ends up keyed off data that is one pass
      // out of date.
      useConfigStore.setState({
        ...deriveAll(
          tracks.rows,
          groups.rows,
          nodes.rows,
          kinds.rows,
          useCases.rows,
          useCaseRungs.rows,
          hisProducts.rows,
          readiness.rows,
          stages.rows,
          progress.rows,
        ),
        // The verdict travels with the rows it describes. A read that was NOT
        // accepted leaves the previous verdict alone for settle()'s own reason: the
        // rows on screen are still the previous rows, so a flag reset to false would
        // take the truncation sentence off a map that is still a window.
        mapNodesTruncated: nodes.accepted ? nodes.truncated : prev.mapNodesTruncated,
        // The row and its drop count travel together, always: they are two
        // halves of one read, and publishing a count beside a configuration it
        // did not come from would put "3 status words are unusable" on screen
        // beside a mapping in which all of them are fine.
        jiraSettings: jira.value.settings,
        jiraStatusesDropped: jira.value.droppedStatuses,
        // Only the tracks read may stamp this — see the note above.
        ...(tracks.accepted ? { loadedAt: Date.now() } : {}),
      })
    })
    .finally(() => {
      inFlight = null
      useConfigStore.setState({ loading: false })
    })

  return inFlight
}

/**
 * Mark the cache stale and refetch. Call after any track, GROUP, NODE, KIND, USE
 * CASE, STAGE or NODE-PROGRESS mutation — creating a group, renaming one,
 * reordering them, moving a track between them, creating an organization, moving a
 * subtree, retiring a capability, adding or reordering a rung of the ladder, and
 * recording where an organization got to all change what this store holds, and the
 * screens write through the api layer, not through this store, so nothing else
 * would tell the rest of the app that a track was renamed.
 *
 * ⚠ A PROGRESS WRITE IS THE ONE HIGH-FREQUENCY CALLER, and it is the one to watch:
 *   `setNodeStage` is an account manager's ordinary daily action, and routing every
 *   one of them through here refetches all eight reads — up to 400 map nodes and a
 *   ~250KB cache write — to publish one row the caller already has in hand. It is
 *   CORRECT, which is why it ships this way at one stage change per minute, and it
 *   is the wrong shape for a screen that saves in a loop. `saveJiraConfig` below is
 *   the precedent for the alternative — publish what the write returned and rebuild
 *   nothing else — and nothing derived here spans the progress list, so a targeted
 *   publisher is a small addition when a caller needs one. Named so that the wave
 *   which builds that screen finds the note instead of the symptom.
 *
 * NOT for `map_node_use_cases`: that join is not in this store (see the header), and
 * the panel that edits it refetches its own rows.
 */
export function invalidateConfig(): void {
  useConfigStore.setState({ loadedAt: null })
  void loadConfig(true)
}

/**
 * Publish ONE node's progress row, without refetching the workspace.
 *
 * THE TARGETED PUBLISHER `invalidateConfig`'s note above asks for, built for the
 * caller it names: `setNodeStage` is an account manager's ordinary daily action,
 * and a reader moving forty organizations down the portfolio would otherwise
 * fire forty full reloads of all eight reads to publish forty rows the writer
 * already had in hand. `saveJiraConfig` is the precedent — publish what the
 * write returned and rebuild nothing else.
 *
 * NOTHING DERIVED SPANS THIS LIST. `deriveAll` builds `progressByNodeId` from
 * `mapNodeProgress` and nothing more — no ordering, no roll-up, no cross-table
 * join — so replacing one row is the whole of the update. That is what makes a
 * targeted publisher legitimate here and not for, say, a map node, whose row
 * feeds `mapChildren`, `mapRoots` and the ancestry walk.
 *
 * THE ROW IS THE STORED ONE, never the input: `setNodeStage` returns what the
 * database wrote, INCLUDING the `stage_changed_at` the stamp trigger owns and no
 * client may send. Publishing the input instead would put a stamp on screen that
 * a reload would disagree with.
 *
 * The cache is rewritten with it, so a reload inside the 30-second window shows
 * the change rather than the row it replaced.
 */
export function publishNodeProgress(row: MapNodeProgress): void {
  const held = useConfigStore.getState()
  const rows = held.mapNodeProgress.some((r) => r.node_id === row.node_id)
    ? held.mapNodeProgress.map((r) => (r.node_id === row.node_id ? row : r))
    : [...held.mapNodeProgress, row]
  const byId = new Map(held.progressByNodeId)
  byId.set(row.node_id, row)
  useConfigStore.setState({ mapNodeProgress: rows, progressByNodeId: byId })
  writeRowCache(MAP_NODE_PROGRESS_CACHE_KEY, rows)
}

/**
 * Save the Jira configuration and publish what the database stored.
 *
 * THE WRITE LIVES HERE RATHER THAN AT THE SCREEN, and that is the same decision
 * `useJiraEnabled()` is: the off-switch has one answer, so it has one place that
 * changes it. A screen that called `saveJiraSettings()` itself would hold a
 * saved-but-unpublished configuration until the next focus refetch — the toggle
 * would read "on" beside surfaces still rendering as "off", for up to thirty
 * seconds, which is exactly long enough to be reported as a bug.
 *
 * NOT `invalidateConfig()`, DELIBERATELY. That refetches all six reads including
 * every map node — up to 400 rows and a ~250KB cache write — to publish one row
 * that this call already has in hand. Nothing else in the store depends on this
 * row, so there is nothing else to rebuild: `deriveAll` never touches it (its
 * Omit says so) and no derived view spans it.
 *
 * The response is the STORED row, not the input (api/jiraSettings.ts), so what
 * this publishes is what a reload would show — including a `droppedStatuses`
 * count the screen has to surface at the moment of saving.
 *
 * Errors are returned, never swallowed: the caller renders `t(result.error)`,
 * which is an i18n key and never the value that was refused.
 */
export async function saveJiraConfig(
  input: JiraSettingsInput,
): Promise<ApiResult<{ droppedStatuses: number }>> {
  const result = await saveJiraSettings(input)
  if (!result.ok) return result
  useConfigStore.setState({
    jiraSettings: result.data.settings,
    jiraStatusesDropped: result.data.droppedStatuses,
  })
  return { ok: true, data: { droppedStatuses: result.data.droppedStatuses } }
}

// A second device (or the SQL editor) can change tracks while this tab sits in
// the background, so returning to the tab is the natural moment to re-check.
// Gated on STALE_AFTER_MS: alt-tabbing between two windows fires focus
// constantly, and a request per switch is not worth a list that changes monthly.
window.addEventListener('focus', () => {
  // Signed out, the read can only come back empty (RLS), and believing that
  // empty answer is exactly the bug hasSession() documents. Alt-tabbing on the
  // sign-in screen must not poison the cache.
  if (!hasSession()) return
  const { loadedAt } = useConfigStore.getState()
  if (loadedAt === null || Date.now() - loadedAt > STALE_AFTER_MS) void loadConfig(true)
})
