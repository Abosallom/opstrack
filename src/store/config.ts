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

import { create } from 'zustand'
import { listMapNodeKinds, listMapNodes, listUseCases } from '../api/map'
import type { Loaded } from '../api/entries'
import type { ApiResult } from '../api/result'
import { listGroups, listTracks } from '../api/tracks'
import { hasSession } from './auth'
import type { MapNode, MapNodeKind, Track, TrackGroup, UseCase } from '../types'

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
   * Precomputed `hidden === false` slice, stable by reference — the tracks/`active`
   * pair one table over, for its reason. A hidden capability has to leave every
   * picker and every matrix without disappearing from the admin list that can bring
   * it back.
   */
  visibleUseCases: UseCase[]
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
 * `mapNodesTruncated` is the one field of the state this function does NOT return,
 * and the Omit says so rather than a comment alone: it is a property of the READ,
 * not of the rows. No arrangement of the five lists can tell you whether a sixth
 * page existed, so deriving it here would mean inventing it.
 */
function deriveAll(
  tracks: Track[],
  groups: TrackGroup[],
  nodes: MapNode[],
  kinds: MapNodeKind[],
  useCases: UseCase[],
): Omit<ConfigState, 'loading' | 'loadedAt' | 'mapNodesTruncated'> {
  return {
    ...derive(tracks, groups),
    ...deriveGroups(groups),
    ...deriveMap(tracks, nodes),
    mapNodeKinds: kinds,
    useCases,
    visibleUseCases: useCases.filter((u) => !u.hidden),
  }
}

/**
 * Last known rows of one table, for first paint. Without a cache the shell renders
 * a screen of skeleton colour bars on every cold load even though the answer changes
 * about once a month. It is trusted only until the network replies.
 *
 * ONE GENERIC FUNCTION RATHER THAN FIVE COPIES. It was two — tracks and groups —
 * and the map hierarchy would have made it five, at which point the fifth is where
 * somebody forgets the try/catch. Every one of the five caches is a JSON array of
 * rows keyed by a string `id`, so there is exactly one thing to write.
 *
 * Shape-check one field rather than validating fully: the only realistic corruption
 * is a cache written by an older column set, and every consumer keys off id.
 */
function readRowCache<T extends { id: string }>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (row): row is T =>
        typeof row === 'object' && row !== null && typeof (row as T).id === 'string',
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
  ),
  // See the field's own note: the cache cannot hold a clipped read, so the honest
  // opening answer is "not truncated" rather than "unknown".
  mapNodesTruncated: false,
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

export function useConfigLoading(): boolean {
  return useConfigStore((s) => s.loading)
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

function settle<T extends { id: string }>(
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
 * Fetch tracks, groups and the map hierarchy unless a good copy is already in hand.
 *
 * Safe to call unawaited (`void loadConfig()`) and safe to call twice
 * concurrently. It never rejects: a failure leaves whatever was cached in place
 * and logs, because the tracks list is chrome on most screens and blowing up a
 * route's render for it would be a worse outcome than a slightly stale colour.
 *
 * THE FIVE READS ARE INDEPENDENT, and that asymmetry is deliberate:
 *
 *   * `loadedAt` is stamped on the TRACKS read ALONE, exactly as it always has
 *     been, and the three new reads change nothing about that. Groups are a lens
 *     over tracks and the hierarchy hangs beneath them — a workspace whose database
 *     predates 0018 gets a 404 from `track_groups` on every attempt, and one that
 *     predates 0023 gets three more, and letting any of that hold `loadedAt` at null
 *     would refire the whole load on every component mount, forever. That is a retry
 *     storm this store did not have yesterday, introduced by an additive feature, on
 *     the app's most-mounted read. It is also not hypothetical THIS time: the live
 *     workspace runs 0022 and the migration is applied by hand.
 *   * A failed read of any of the other four leaves its previous data in place
 *     rather than writing `[]` over it — see settle() above.
 *   * `Promise.all`, not five awaits: one round trip's latency, not five, on the
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
  ])
    .then(([trackResult, groupResult, nodeResult, kindResult, useCaseResult]) => {
      const prev = useConfigStore.getState()
      const tracks = settle('tracks', trackResult, prev.tracks, CACHE_KEY)
      const groups = settle('groups', groupResult, prev.groups, GROUPS_CACHE_KEY)
      const nodes = settle('map nodes', nodeResult, prev.mapNodes, MAP_NODES_CACHE_KEY)
      const kinds = settle('node kinds', kindResult, prev.mapNodeKinds, MAP_NODE_KINDS_CACHE_KEY)
      const useCases = settle('use cases', useCaseResult, prev.useCases, USE_CASES_CACHE_KEY)

      // ONE setState, ONE deriveAll, whatever succeeded and whatever did not. The
      // rebuild is unconditional because the derived views SPAN the lists: a groups
      // read that lands alone still has to rebuild `activeByGroup`, and a tracks
      // read that lands alone still has to rebuild `mapRoots`. Publishing only the
      // lists that changed is how a bucket ends up keyed off data that is one pass
      // out of date.
      useConfigStore.setState({
        ...deriveAll(tracks.rows, groups.rows, nodes.rows, kinds.rows, useCases.rows),
        // The verdict travels with the rows it describes. A read that was NOT
        // accepted leaves the previous verdict alone for settle()'s own reason: the
        // rows on screen are still the previous rows, so a flag reset to false would
        // take the truncation sentence off a map that is still a window.
        mapNodesTruncated: nodes.accepted ? nodes.truncated : prev.mapNodesTruncated,
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
 * Mark the cache stale and refetch. Call after any track, GROUP, NODE, KIND or USE
 * CASE mutation — creating a group, renaming one, reordering them, moving a track
 * between them, creating an organization, moving a subtree or retiring a capability
 * all change what this store holds, and the admin screens write through the api
 * layer, not through this store, so nothing else would tell the rest of the app that
 * a track was renamed.
 *
 * NOT for `map_node_use_cases`: that join is not in this store (see the header), and
 * the panel that edits it refetches its own rows.
 */
export function invalidateConfig(): void {
  useConfigStore.setState({ loadedAt: null })
  void loadConfig(true)
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
