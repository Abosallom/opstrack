// Config store: the workspace's tracks and their groups, cached and shared.
//
// Groups (0018) are the level above tracks — Technical and Business — and they
// live here rather than in a store of their own because nothing ever wants one
// without the other: every screen that renders a group renders the tracks
// inside it, and a second store would mean a second load, a second cache and a
// second chance for the two to disagree about what exists.
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
import { listGroups, listTracks } from '../api/tracks'
import { hasSession } from './auth'
import type { Track, TrackGroup } from '../types'

const CACHE_KEY = 'opstrack_tracks_v1'

/**
 * Groups (0018) get their OWN key rather than joining the tracks payload.
 *
 * A shared key would make one corrupt or older-shaped blob throw both halves
 * away, and the two are written at different moments — a failed groups read
 * must leave a good tracks cache exactly as it was.
 */
const GROUPS_CACHE_KEY = 'opstrack_track_groups_v1'

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
 * Every derived view, from both lists at once.
 *
 * The single entry point for a state write, because `activeByGroup` spans the
 * two: a groups read that lands after a tracks read has to rebuild the buckets,
 * and calling only `deriveGroups` would leave the buckets keyed off the groups
 * that existed a moment ago.
 */
function deriveAll(
  tracks: Track[],
  groups: TrackGroup[],
): Omit<ConfigState, 'loading' | 'loadedAt'> {
  return { ...derive(tracks, groups), ...deriveGroups(groups) }
}

/**
 * Last known tracks, for first paint. Without this the shell renders a screen
 * of skeleton colour bars on every cold load even though the answer changes
 * about once a month. The cache is trusted only until the network replies.
 */
function readCache(): Track[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // Shape-check one field rather than validating fully: the only realistic
    // corruption is a cache written by an older column set, and every consumer
    // keys off id.
    return parsed.filter(
      (row): row is Track =>
        typeof row === 'object' && row !== null && typeof (row as Track).id === 'string',
    )
  } catch {
    // Quota errors, private-mode restrictions, a hand-edited value — none of
    // them are worth failing a page load over.
    return []
  }
}

/**
 * The same contract for groups, and the same one-field shape check — a cache
 * written before 0018 simply is not there, and one written by an older column
 * set still keys off id.
 */
function readGroupsCache(): TrackGroup[] {
  try {
    const raw = localStorage.getItem(GROUPS_CACHE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (row): row is TrackGroup =>
        typeof row === 'object' && row !== null && typeof (row as TrackGroup).id === 'string',
    )
  } catch {
    return []
  }
}

function writeCache(tracks: Track[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(tracks))
  } catch {
    // Best effort: a full quota must not break a successful fetch.
  }
}

function writeGroupsCache(groups: TrackGroup[]): void {
  try {
    localStorage.setItem(GROUPS_CACHE_KEY, JSON.stringify(groups))
  } catch {
    // Best effort, as above.
  }
}

const useConfigStore = create<ConfigState>(() => ({
  ...deriveAll(readCache(), readGroupsCache()),
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
 * Fetch tracks and groups unless a good copy is already in hand.
 *
 * Safe to call unawaited (`void loadConfig()`) and safe to call twice
 * concurrently. It never rejects: a failure leaves whatever was cached in place
 * and logs, because the tracks list is chrome on most screens and blowing up a
 * route's render for it would be a worse outcome than a slightly stale colour.
 *
 * THE TWO READS ARE INDEPENDENT, and that asymmetry is deliberate:
 *
 *   * `loadedAt` is stamped on the TRACKS read alone, exactly as it always has
 *     been. Groups are a lens over tracks — a workspace whose database predates
 *     0018 gets a 404 from `track_groups` on every attempt, and letting that
 *     hold `loadedAt` at null would refire the whole load on every component
 *     mount, forever. That is a retry storm this store did not have yesterday,
 *     introduced by an additive feature, on the app's most-mounted read.
 *   * A failed GROUPS read leaves the previous groups in place rather than
 *     writing `[]` over them (FIX-APP-6's lesson: a failed read must not latch),
 *     and the focus listener retries within STALE_AFTER_MS.
 *   * `Promise.all`, not two awaits: one round trip's latency, not two, on the
 *     load that gates first paint.
 */
export function loadConfig(force = false): Promise<void> {
  if (inFlight) return inFlight
  if (!force && useConfigStore.getState().loadedAt !== null) return Promise.resolve()

  // Only show the spinner when there is genuinely nothing to show. A focus
  // refetch with a warm cache must not blank the list the user is looking at.
  if (useConfigStore.getState().tracks.length === 0) {
    useConfigStore.setState({ loading: true })
  }

  inFlight = Promise.all([listTracks(true), listGroups()])
    .then(([trackResult, groupResult]) => {
      // Groups first, so that when both land the buckets are rebuilt once
      // against the new group list rather than twice — and so a tracks-only
      // success below still sees the groups this pass fetched.
      let groups = useConfigStore.getState().groups
      if (!groupResult.ok) {
        console.warn('[config] groups load failed:', groupResult.error)
      } else if (groupResult.data.length === 0 && !hasSession()) {
        // The same guard as tracks, for the same reason: signed out, RLS makes
        // every read come back empty, and believing that answer poisons the
        // cache for the rest of the session.
        console.warn('[config] ignoring an empty groups read made without a session')
      } else {
        groups = groupResult.data
        writeGroupsCache(groups)
      }

      if (!trackResult.ok) {
        console.warn('[config] load failed:', trackResult.error)
        // Still publish the groups this pass fetched — they are good data, and
        // the buckets have to be rebuilt against them either way.
        useConfigStore.setState(deriveAll(useConfigStore.getState().tracks, groups))
        return
      }
      // An empty list from an UNAUTHENTICATED read is not an answer — see
      // hasSession(). Believing it stamps `loadedAt` and short-circuits every
      // load for the rest of the session.
      if (trackResult.data.length === 0 && !hasSession()) {
        console.warn('[config] ignoring an empty read made without a session')
        useConfigStore.setState(deriveAll(useConfigStore.getState().tracks, groups))
        return
      }
      useConfigStore.setState({ ...deriveAll(trackResult.data, groups), loadedAt: Date.now() })
      writeCache(trackResult.data)
    })
    .finally(() => {
      inFlight = null
      useConfigStore.setState({ loading: false })
    })

  return inFlight
}

/**
 * Mark the cache stale and refetch. Call after any track OR GROUP mutation —
 * creating a group, renaming one, reordering them, or moving a track between
 * them all change what this store holds, and the admin
 * screens write through the api layer, not through this store, so nothing else
 * would tell the rest of the app that a track was renamed.
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
