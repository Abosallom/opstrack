// Config store: the workspace's tracks, cached and shared.
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
import { listTracks } from '../api/tracks'
import type { Track } from '../types'

const CACHE_KEY = 'opstrack_tracks_v1'

/** How long a load stays fresh enough to skip the focus refetch. */
const STALE_AFTER_MS = 30_000

interface ConfigState {
  /** Every track, archived included — the admin list needs them all. */
  tracks: Track[]
  /** Precomputed `archived === false` slice, stable by reference. */
  active: Track[]
  /** Precomputed id → track lookup, stable by reference. */
  byId: Map<string, Track>
  loading: boolean
  /** Epoch ms of the last successful load; null means never loaded. */
  loadedAt: number | null
}

/** Build the whole state slice from a track list, so the derived views cannot drift. */
function derive(tracks: Track[]): Omit<ConfigState, 'loading' | 'loadedAt'> {
  return {
    tracks,
    active: tracks.filter((tr) => !tr.archived),
    byId: new Map(tracks.map((tr) => [tr.id, tr])),
  }
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

function writeCache(tracks: Track[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(tracks))
  } catch {
    // Best effort: a full quota must not break a successful fetch.
  }
}

const useConfigStore = create<ConfigState>(() => ({
  ...derive(readCache()),
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
 * Fetch tracks unless a good copy is already in hand.
 *
 * Safe to call unawaited (`void loadConfig()`) and safe to call twice
 * concurrently. It never rejects: a failure leaves whatever was cached in place
 * and logs, because the tracks list is chrome on most screens and blowing up a
 * route's render for it would be a worse outcome than a slightly stale colour.
 */
export function loadConfig(force = false): Promise<void> {
  if (inFlight) return inFlight
  if (!force && useConfigStore.getState().loadedAt !== null) return Promise.resolve()

  // Only show the spinner when there is genuinely nothing to show. A focus
  // refetch with a warm cache must not blank the list the user is looking at.
  if (useConfigStore.getState().tracks.length === 0) {
    useConfigStore.setState({ loading: true })
  }

  inFlight = listTracks(true)
    .then((result) => {
      if (result.ok) {
        useConfigStore.setState({ ...derive(result.data), loadedAt: Date.now() })
        writeCache(result.data)
      } else {
        console.warn('[config] load failed:', result.error)
      }
    })
    .finally(() => {
      inFlight = null
      useConfigStore.setState({ loading: false })
    })

  return inFlight
}

/**
 * Mark the cache stale and refetch. Call after any track mutation — the admin
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
  const { loadedAt } = useConfigStore.getState()
  if (loadedAt === null || Date.now() - loadedAt > STALE_AFTER_MS) void loadConfig(true)
})
