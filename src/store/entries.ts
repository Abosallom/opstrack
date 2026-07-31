// The entries store: canonical rows, health, threads, and every optimistic write.
//
// This is the file waves 2, 3 and 4 all read from.
//
// NEVER BUILD AN ARRAY OR A MAP INSIDE A SELECTOR. derive() recomputes `list`
// from `byId` on every write, exactly as store/config.ts does, and selectors
// return the stored reference. A selector that constructs its result returns a
// new reference every render, which under useSyncExternalStore means "the
// snapshot changed" forever — an infinite re-render loop, and in dev a
// "getSnapshot should be cached" warning. config.ts's header documents the same
// hazard; this store is thirty times larger and pays for it thirty times over.
//
// THE WRITE SEAM. Contracts rule 3 funnels every write through store/outbox.ts,
// which Wave 4 turns into a persistent queue. That file is owned by another
// worker this wave, so the seam here is an INJECTION POINT rather than an
// import: submitEntry() defaults to sending straight to api/entries, and
// setEntriesSubmit(outbox.submit) swaps the transport in one line without this
// file changing at all. Everything above the seam — the MutOp envelope, the
// dedupe key, dependsOn for a write against a not-yet-created row — is already
// built the way the outbox needs it, so the swap is a wiring change and not a
// rewrite. That is the whole point of the seam existing in Wave 1.
//
// OPTIMISTIC MUTATION FLOW — implemented ONCE, here, never re-invented in a
// screen:
//  1. Apply locally, bump last_activity_at to now (matching what the server will
//     do, so the row jumps to the top of every list immediately), set pending,
//     re-derive. SNAPSHOT THE PRE-CHANGE ROW.
//  2. await submit.
//  3. Settle: on ok, applyServerRow(data, 'local') — the server row wins
//     wholesale — then pending.delete(id). On failure, restore the SNAPSHOT
//     (not an inverse patch, which drifts the moment two edits overlap),
//     pending.delete(id), toast. On QUEUED_KEY the write is not a failure and
//     not yet a success: the optimistic row STAYS and is marked queued.
//  4. Creates insert a synthetic row keyed TEMP_PREFIX + crypto.randomUUID().
//     On success the temp row is DELETED AND REPLACED BY THE SERVER ROW IN ONE
//     setState — a two-step swap makes the row visibly flicker out of the list
//     and back.
//
// MONOTONIC GUARD — the rule that lets realtime and optimism coexist. See
// acceptsServerRow(); an echo of our own still-pending write is DROPPED.

import { useEffect, useMemo } from 'react'
import { create } from 'zustand'
import {
  listClosedSince,
  listEntries,
  listHealth,
  listTrackHistory,
  listUpdates,
  addUpdate as apiAddUpdate,
  createEntry as apiCreateEntry,
  updateEntry as apiUpdateEntry,
} from '../api/entries'
import { onRealtimeBatch, onRealtimeResync } from '../api/realtime'
import { listTrackSlas } from '../api/tracks'
import { fail } from '../api/result'
import { supabase } from '../api/supabase'
import { TEMP_PREFIX, discardOpsForTempId, isTempId } from './outbox'
import { useAuth } from './auth'
import { getVocabSnapshot, slaDays, staleDays } from './vocab'
import {
  CLOSED_STATUSES,
  buildTrackSlaMap,
  computeHealth,
  resolveSlaDays,
  type TrackSlaMap,
} from '../lib/health'
import { selectEntries, filterKey } from '../lib/entryFilter'
import { todayIso, addDays } from '../lib/dates'
import { t } from '../lib/i18n'
import { toast } from '../components/toast'
import type { MutOp } from './outbox'
import type { ApiResult } from '../api/result'
import type { EntryPatch, NewEntry, NewEntryUpdate } from '../api/entries'
import type { RealtimeEvent } from '../api/realtime'
import type { FilterContext, FilterState } from '../lib/entryFilter'
import type { IsoDate } from '../lib/dates'
import type { Entry, EntryHealth, EntryStatus, EntryUpdate } from '../types'

const CACHE_KEY = 'opstrack_entries_v1'
/** How long a load stays fresh enough to skip the focus refetch. */
const STALE_AFTER_MS = 45_000
/** Flash TTL, swept by ONE module-level interval — not a timer per row. */
const FLASH_TTL_MS = 8_000
/**
 * How many rows the first-paint cache keeps.
 *
 * The cache exists so a cold start shows the top of the list instead of a
 * skeleton, and the top of the list is all anyone sees before the fetch lands
 * ~300 ms later. Persisting two thousand rows to buy the same first screen is
 * how a localStorage quota error turns into a blank app.
 */
const CACHE_LIMIT = 500
/** What the outbox returns when it queued a write instead of sending it. */
const QUEUED_KEY = 'offline.queued'

export type ApplySource = 'fetch' | 'realtime' | 'local' | 'outbox'

export interface PendingOp {
  id: string
  kind: 'create' | 'patch' | 'update'
  since: number
  error: string | null
  /** True once the op is sitting in the outbox rather than in flight. */
  queued: boolean
}

/** The "updated by ⟨name⟩" mark. TTL 8 s. */
export interface FlashMark {
  actorId: string | null
  /**
   * Usually NULL, and that is not an omission. `entries` carries no actor
   * column, so realtime can only ever supply an id (off the correlated
   * entry_updates row); the display name belongs to the members store, which the
   * row renderer already subscribes to for OwnerBadge. Resolving it here would
   * duplicate that subscription and freeze a name a rename would not update.
   * Renderers: actorName ?? memberLabel(actorId) ?? t('entry.updatedGeneric').
   * NEVER invent a name.
   */
  actorName: string | null
  kind: 'new' | 'edit' | 'update'
  at: number
}

/** What has actually been loaded, so a screen can tell "none" from "not yet". */
export interface EntriesCoverage {
  openLoaded: boolean
  closedSince: IsoDate | null
  trackHistory: Record<string, { from: IsoDate; to: IsoDate }>
  loadedAt: number | null
  /**
   * The open-entries read came back at PostgREST's ceiling, so the working set
   * is a WINDOW rather than everything.
   *
   * Surfaced as state because it silently changes what the rest of the app
   * means. Counts undercount, "unassigned" misses rows past the cut, and the
   * digest reports on a subset — none of which looks like a failure. A screen
   * showing totals should say so; see useEntriesTruncated().
   */
  truncated: boolean
  /**
   * The same, for the CLOSED window loadClosedSince() fetched.
   *
   * Stored separately rather than folded into `truncated` because the two reads
   * are clipped independently and an open refetch must not be able to clear a
   * closed clip it knows nothing about — mergeOpenFetch() writes `truncated`
   * outright on every pass, so a single shared field would silently self-heal
   * back to false. `useEntriesTruncated()` is where the two are combined.
   */
  closedTruncated: boolean
  /**
   * The i18n key from a FAILED closed read, or null.
   *
   * The closed window was the one read in this store with neither an error
   * channel nor a caveat channel: `loadClosedSince()` console.warn'd and
   * returned `void`, so a failure was byte-identical to a quiet week for every
   * consumer. The dashboard's throughput chart, its "Closed" tile and its SLA
   * compliance panel are computed ENTIRELY from closed rows, and the digest's
   * whole Closed section is — so one dropped request produced a report saying
   * nothing was finished, with no indication that anything had gone wrong.
   *
   * Separate from `error`, which describes the OPEN read and is what the
   * dashboard's top-level retry is bound to. Same shape and the same rule as
   * `slaMatrixError`: an i18n KEY, never a sentence.
   */
  closedError: string | null
}

export interface EntryCounts {
  total: number
  open: number
  overdue: number
  stale: number
  blocked: number
  unassigned: number
  dueThisWeek: number
  closed: number
}

interface EntriesState {
  /** Canonical rows, including optimistic temp rows. */
  byId: Map<string, Entry>
  /** Derived ONCE per write, last_activity_at desc, reference-stable. */
  list: Entry[]
  /** Exactly what v_entry_health returned. Kept apart from `health` so a
   *  re-derive can tell a server answer from a computed fallback. */
  serverHealth: Map<string, EntryHealth>
  /** serverHealth plus a computed row for anything the view has not seen yet —
   *  optimistic and offline rows, which have no view row and would otherwise be
   *  invisible to every section and badge in the app. */
  health: Map<string, EntryHealth>
  /**
   * The `track_slas` matrix (0006), or null before it has loaded / after a
   * failed read.
   *
   * IT LIVES IN THIS STORE BECAUSE derive() NEEDS IT. `v_entry_health` resolves
   * `coalesce(ts.sla_days, vp.sla_days)`; the client fallback fed computeHealth
   * the PRIORITY DEFAULT, so the first row an admin wrote into `track_slas` made
   * every optimistic, offline and temp row disagree with the server and flip on
   * settle (FIX-BACKLOG **SLA-MATRIX**). Dashboard had grown a second, private
   * fetch of the same table to avoid inheriting the bug, which is how the board
   * and the dashboard came to hold two different answers to one question.
   *
   * Null is a VALUE meaning "no overrides", not a missing answer —
   * resolveSlaDays() treats it as "the workspace default applies", which is the
   * safe direction: a screen shows a slightly-too-generous deadline for a beat
   * rather than inventing a breach.
   */
  slaMatrix: TrackSlaMap | null
  /** i18n key from a failed matrix read. Surfaced by the dashboard's compliance
   *  panel, because a number computed against the wrong commitment must not look
   *  identical to one computed against the right one. */
  slaMatrixError: string | null
  /** Per entry, created_at asc, lazily loaded. */
  updates: Map<string, EntryUpdate[]>
  updatesLoading: Set<string>
  /** i18n keys, per entry. Not in the plan's shape sketch; useEntryUpdates()
   *  promises an `error` and it has to come from somewhere. */
  updatesError: Map<string, string>
  pending: Map<string, PendingOp>
  flash: Map<string, FlashMark>
  coverage: EntriesCoverage
  loading: boolean
  /** An i18n KEY, never a sentence. */
  error: string | null
}

// ── pure helpers (exported for tests; not part of the screen-facing surface) ──

/** The one test for "open", derived from lib/health's source-of-truth constant. */
function isClosed(status: EntryStatus): boolean {
  return CLOSED_STATUSES.includes(status)
}

/**
 * THE MONOTONIC GUARD. Accept a server row iff:
 *   (a) source is 'local' or 'outbox' — our own settled write; it always wins,
 *       because it IS the newest truth and its updated_at may equal (or, under
 *       clock skew, trail) the optimistic row we are replacing;
 *   (b) nothing local exists for this id;
 *   (c) nothing is pending for it AND the row is not older than what we hold.
 *
 * Case (c) is what drops the realtime echo of a write still in flight. Without
 * it the sequence is: optimistic edit renders, realtime delivers the pre-edit
 * row, the field visibly reverts, and then the settle puts it back — a flicker
 * the user reads as the app fighting them.
 *
 * 'outbox' sits with 'local' rather than with 'realtime' because it is the same
 * event a beat later: the queue performed OUR write and the server answered with
 * OUR row. Spec §6's rule for entry fields is last-write-wins, and this is that
 * write landing.
 */
export function acceptsServerRow(
  existing: Entry | undefined,
  incoming: Entry,
  source: ApplySource,
  isPending: boolean,
): boolean {
  if (source === 'local' || source === 'outbox') return true
  if (!existing) return true
  if (isPending) return false
  return incoming.updated_at >= existing.updated_at
}

/**
 * Apply an EntryPatch to a row the way the server will, for the optimistic step.
 *
 * `nowIso` is passed rather than read so this stays pure and testable. Both
 * timestamps move because 0001's entries_touch() moves both, and
 * last_activity_at in particular is what every list sorts on — an optimistic row
 * that does not bump it edits in place and does not jump to the top, which is
 * exactly the feedback the optimistic write exists to give.
 *
 * The owner XOR mirrors api/entries.toEntryPatchRow(). Two copies of that rule
 * is one too many, but the alternative is the optimistic row disagreeing with
 * the row that comes back — a visible flip on settle.
 */
export function applyPatchLocal(entry: Entry, patch: EntryPatch, nowIso: string): Entry {
  const next: Entry = { ...entry, updated_at: nowIso, last_activity_at: nowIso }
  if (patch.title !== undefined) next.title = patch.title.trim()
  if (patch.description !== undefined) next.description = patch.description ?? ''
  if (patch.type !== undefined) next.type = patch.type
  if (patch.priority !== undefined) next.priority = patch.priority
  if (patch.requester !== undefined) next.requester = patch.requester
  if (patch.dueDate !== undefined) next.due_date = patch.dueDate
  if (patch.followUpDate !== undefined) next.follow_up_date = patch.followUpDate
  if (patch.tags !== undefined) next.tags = patch.tags
  if (patch.links !== undefined) next.links = patch.links
  if (patch.trackId !== undefined) next.track_id = patch.trackId
  if (patch.ownerId !== undefined) {
    next.owner_id = patch.ownerId
    if (patch.ownerId) next.owner_name = null
  }
  if (patch.ownerName !== undefined) {
    next.owner_name = patch.ownerName
    if (patch.ownerName) next.owner_id = null
  }
  if (patch.status !== undefined) {
    next.status = patch.status
    // Mirrors entries_set_closed_at(): closing stamps once, reopening clears.
    next.closed_at = isClosed(patch.status) ? (entry.closed_at ?? nowIso) : null
  }
  return next
}

/**
 * `${table}:${op}:${id ?? tempId}:${sortedPayloadKeys}` — the outbox's collapse
 * key. Typing in a description field offline must queue one op, not forty, and
 * the sorted key list is what makes two edits of the same fields collapse while
 * an edit of a different field does not.
 */
function dedupeKeyFor(table: MutOp['table'], op: MutOp['op'], id: string, payload: unknown): string {
  const keys =
    typeof payload === 'object' && payload !== null
      ? Object.keys(payload as Record<string, unknown>).sort().join(',')
      : ''
  return `${table}:${op}:${id}:${keys}`
}

// ── the write seam ─────────────────────────────────────────────────────────

export type SubmitFn = <T>(op: MutOp) => Promise<ApiResult<T>>

/**
 * The default transport: send now, straight to api/entries.
 *
 * It is deliberately shaped as a table:op registry rather than three direct
 * calls, because store/outbox.ts's transport registry is the same table and
 * swapping one for the other has to be a substitution, not a translation.
 */
async function directSubmit<T>(op: MutOp): Promise<ApiResult<T>> {
  const route = `${op.table}:${op.op}`
  switch (route) {
    case 'entries:insert':
      return (await apiCreateEntry(op.payload as NewEntry)) as ApiResult<T>
    case 'entries:update':
      // An update with no target is a caller bug, and sending '' would reach
      // Postgres as a malformed uuid (22P02) — a confusing way to learn it.
      if (!op.id) return fail('common.error')
      return (await apiUpdateEntry(op.id, op.payload as EntryPatch)) as ApiResult<T>
    case 'entry_updates:insert':
      return (await apiAddUpdate(op.payload as NewEntryUpdate)) as ApiResult<T>
    default:
      console.warn('[entries] no transport for', route)
      return fail('common.error')
  }
}

let submitFn: SubmitFn = directSubmit

/**
 * Swap the transport. Wave 4 calls `setEntriesSubmit(submit)` from main.tsx once
 * store/outbox.ts is live; passing null restores direct send, which is what the
 * tests and a credential-less dev harness want.
 */
export function setEntriesSubmit(fn: SubmitFn | null): void {
  submitFn = fn ?? directSubmit
}

// ── derivation ─────────────────────────────────────────────────────────────

/** One shared empty thread, so an unloaded entry's `updates` array is
 *  reference-stable across renders instead of a fresh `[]` every time. */
const EMPTY_UPDATES: EntryUpdate[] = []

/**
 * Sort key for every list in the app: newest activity first, id as the stable
 * tiebreak. Rows written by one statement — a seed, a bulk commit — share a
 * last_activity_at to the microsecond, and without the tiebreak they reshuffle
 * on every re-derive.
 */
function byActivityDesc(a: Entry, b: Entry): number {
  if (a.last_activity_at !== b.last_activity_at) {
    return a.last_activity_at < b.last_activity_at ? 1 : -1
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Does this view row still describe the entry it was fetched for?
 *
 * `v_entry_health` is a SNAPSHOT taken at fetch time, and every one of these four
 * columns is an INPUT to the verdict it computed: staleness is measured from
 * last_activity_at against the priority's threshold, overdue from due_date, and a
 * closed entry has no verdict at all. So the moment a local write moves any of
 * them, the stored row is describing an entry that no longer exists.
 *
 * Compared rather than versioned because the view exposes no version and both
 * sides come from the same column through the same client, so the timestamps are
 * byte-identical whenever they are genuinely the same.
 */
export function healthMatches(h: EntryHealth | undefined, e: Entry): boolean {
  return (
    h !== undefined &&
    h.last_activity_at === e.last_activity_at &&
    h.due_date === e.due_date &&
    h.priority === e.priority &&
    h.status === e.status
  )
}

/**
 * Recompute `list` and `health` from `byId`. Called on every write; never from a
 * selector.
 *
 * The health fallback loop runs only for rows the view has not answered for OR
 * has answered STALELY, so a freshly loaded list does zero work here and makes
 * zero calls into store/vocab.
 *
 * The staleness half is not an optimisation, it is the correctness half. Skipping
 * any entry that merely HAS a view row meant every optimistic mutation left the
 * pre-mutation verdict in place: post an update on a nine-day-quiet item and the
 * age pill kept saying 9d, the health pill kept saying stale, and
 * bucketFollowUps() — which prefers `h.health` over its own fallback — kept the
 * row in the Stale section until the next full refetch. This file's own promise
 * is that "a pill and the row badge beside it can never disagree about the same
 * entry"; that only holds if the health map follows the rows it describes.
 */
function derive(
  byId: Map<string, Entry>,
  serverHealth: Map<string, EntryHealth>,
  slaMatrix: TrackSlaMap | null,
): Pick<EntriesState, 'list' | 'health'> {
  const list = [...byId.values()].sort(byActivityDesc)

  const stale = list.filter((e) => !isClosed(e.status) && !healthMatches(serverHealth.get(e.id), e))
  // A closed entry keeps no verdict: it is not overdue, not stale, and every
  // section that reads health drops it. Its view row is dropped with it, so a
  // done item cannot linger in a follow-up bucket on the strength of a row the
  // view will not return next time either.
  const closed = list.filter((e) => isClosed(e.status) && serverHealth.has(e.id))
  if (stale.length === 0 && closed.length === 0) return { list, health: serverHealth }

  const snapshot = getVocabSnapshot()
  const health = new Map(serverHealth)
  for (const entry of closed) health.delete(entry.id)
  for (const entry of stale) {
    health.set(
      entry.id,
      computeHealth(
        entry,
        staleDays(snapshot, entry.priority),
        // resolveSlaDays(), NOT slaDays() — the third argument is the entry's
        // RESOLVED track × priority SLA, which is what lib/health.computeHealth
        // documents and what `coalesce(ts.sla_days, vp.sla_days)` in
        // v_entry_health computes. Passing the priority default here meant the
        // client mirror and the authoritative view disagreed for every entry on
        // a track with an override — see `slaMatrix`.
        resolveSlaDays(entry.track_id, entry.priority, slaMatrix, slaDays(snapshot, entry.priority)),
      ),
    )
  }
  return { list, health }
}

// ── cache ──────────────────────────────────────────────────────────────────

/**
 * Last known entries, for first paint. The cache is trusted only until the
 * network replies, and never for coverage — `loadedAt` stays null, so a warm
 * cache still fetches.
 */
function readCache(): Entry[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // Shape-check one field rather than validating fully: the only realistic
    // corruption is a cache written by an older column set.
    return parsed.filter(
      (row): row is Entry =>
        typeof row === 'object' && row !== null && typeof (row as Entry).id === 'string',
    )
  } catch {
    // Quota errors, private-mode restrictions, a hand-edited value, or no
    // localStorage at all under vitest's node environment — none of them are
    // worth failing a page load over.
    return []
  }
}

let cacheTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Debounced 1 s. A bulk commit writes twenty rows in a second and the cache only
 * has to survive a reload, so serialising it twenty times is pure jank on the
 * main thread.
 *
 * Temp rows are excluded: an unsent optimistic row restored from cache on the
 * next load would be a ghost entry with no server counterpart and no way to
 * retry. Persisting unsent writes is the outbox's job, under its own key.
 */
function scheduleCacheWrite(): void {
  if (cacheTimer !== null) clearTimeout(cacheTimer)
  cacheTimer = setTimeout(() => {
    cacheTimer = null
    try {
      const rows = useEntriesStore
        .getState()
        .list.filter((e) => !isTempId(e.id))
        .slice(0, CACHE_LIMIT)
      localStorage.setItem(CACHE_KEY, JSON.stringify(rows))
    } catch {
      // Best effort: a full quota must not break a successful fetch.
    }
  }, 1_000)
}

// ── the store ──────────────────────────────────────────────────────────────

function emptyCoverage(): EntriesCoverage {
  return {
    openLoaded: false,
    closedSince: null,
    trackHistory: {},
    loadedAt: null,
    truncated: false,
    closedTruncated: false,
    closedError: null,
  }
}

function initialState(): EntriesState {
  const byId = new Map(readCache().map((e) => [e.id, e]))
  const serverHealth = new Map<string, EntryHealth>()
  return {
    byId,
    // Sorted here rather than through derive(): the cached rows have no health
    // rows, and computing a fallback for them at module init would call into
    // store/vocab before anything at all has loaded. The first derive() after
    // the fetch fills the health map in.
    list: [...byId.values()].sort(byActivityDesc),
    health: serverHealth,
    serverHealth,
    slaMatrix: null,
    slaMatrixError: null,
    updates: new Map(),
    updatesLoading: new Set(),
    updatesError: new Map(),
    pending: new Map(),
    flash: new Map(),
    coverage: emptyCoverage(),
    loading: false,
    error: null,
  }
}

const useEntriesStore = create<EntriesState>(() => initialState())

/**
 * Set while applyRealtimeBatch() is running, and null every other moment.
 *
 * §2.14 is explicit and frozen: "a meeting bulk-commit of 20 rows produces one
 * setState, not twenty". api/realtime.ts does its half of that — Map-keyed
 * coalescing, a 120 ms trailing debounce, a 500 ms hard cap — and then hands the
 * batch over. Applying it row by row through commit() handed every bit of the
 * saving straight back: each commit() re-sorts the entire working set (up to two
 * thousand rows), notifies every subscriber in the app, and schedules a cache
 * write.
 *
 * So during a batch, commit() folds into this staged snapshot instead, and
 * readState() serves the snapshot to the appliers so row N still sees the effect
 * of row N-1. One derive(), one setState, one cache write, at the end.
 */
let staged: EntriesState | null = null
/** Whether anything in the batch actually changed. No change, no setState. */
let stagedDirty = false

/**
 * The current truth. Inside a batch that is the staged snapshot; everywhere else
 * it is the store. Every applier below reads through this rather than calling
 * getState() directly — an applier that reads the store mid-batch would work
 * from state two rows out of date and silently drop the rows before it.
 */
function readState(): EntriesState {
  return staged ?? useEntriesStore.getState()
}

/**
 * Every mutation of byId/serverHealth goes through here, so `list` and `health`
 * cannot drift from the rows they are derived from and the cache write cannot be
 * forgotten.
 */
function commit(byId: Map<string, Entry>, serverHealth: Map<string, EntryHealth>, rest: Partial<EntriesState> = {}): void {
  if (staged) {
    staged = { ...staged, byId, serverHealth, ...rest }
    stagedDirty = true
    return
  }
  // The matrix is state, so a commit that also carries a new one must derive
  // against the NEW value — `rest` is applied after derive()'s result and would
  // otherwise leave `health` computed against the previous matrix.
  const slaMatrix =
    rest.slaMatrix !== undefined ? rest.slaMatrix : useEntriesStore.getState().slaMatrix
  useEntriesStore.setState({
    byId,
    serverHealth,
    ...derive(byId, serverHealth, slaMatrix),
    ...rest,
  })
  scheduleCacheWrite()
}

// ── reads (narrow, reference-stable) ───────────────────────────────────────

export function useEntryList(): Entry[] {
  return useEntriesStore((s) => s.list)
}

export function useEntryMap(): ReadonlyMap<string, Entry> {
  return useEntriesStore((s) => s.byId)
}

export function useEntry(id: string | null | undefined): Entry | undefined {
  return useEntriesStore((s) => (id ? s.byId.get(id) : undefined))
}

export function useEntriesLoading(): boolean {
  return useEntriesStore((s) => s.loading)
}

/** An i18n KEY. Render it as t(err), never as itself. */
export function useEntriesError(): string | null {
  return useEntriesStore((s) => s.error)
}

export function useEntriesCoverage(): EntriesCoverage {
  return useEntriesStore((s) => s.coverage)
}

/**
 * The track × priority SLA matrix, and whether reading it failed.
 *
 * TWO NARROW SELECTORS, NOT ONE OBJECT: a hook returning `{ matrix, error }`
 * mints a fresh object every render, which under useSyncExternalStore is "the
 * snapshot changed" forever — this file's header opens with that hazard. The
 * dashboard reads both; every other screen reads neither, because it consumes
 * the already-resolved `health` map.
 */
export function useTrackSlaMatrix(): TrackSlaMap | null {
  return useEntriesStore((s) => s.slaMatrix)
}

/** An i18n KEY, or null. */
export function useTrackSlaError(): string | null {
  return useEntriesStore((s) => s.slaMatrixError)
}

/**
 * The closed window's read failed. An i18n KEY, or null.
 *
 * Narrow, for the same reason useTrackSlaError() is narrow: the dashboard is the
 * one screen that renders it, and it must not re-render on every other coverage
 * change to learn about it. See EntriesCoverage.closedError for what the absence
 * of this cost — a "quiet week" that was a dropped request.
 */
export function useClosedEntriesError(): string | null {
  return useEntriesStore((s) => s.coverage.closedError)
}

/**
 * Coverage without React, the twin of getEntriesSnapshot().
 *
 * Exists because api/digestCollect.ts is a module function and cannot call a
 * hook, so it used to hard-code `truncated: false` into every DigestRows and
 * leave the screen to OR the real answer back in — which meant the collector
 * was structurally incapable of reporting a clip, and the closed half of the
 * window had no path to the document at all.
 */
export function getEntriesCoverage(): EntriesCoverage {
  return useEntriesStore.getState().coverage
}

/**
 * True while the loaded working set is a WINDOW, not the whole table.
 *
 * Narrow on purpose: a screen that only wants to caveat its totals subscribes
 * to one boolean instead of re-rendering on every coverage change. Any list
 * showing a count off `useEntryCounts()` is showing a count of what LOADED —
 * this is how it knows to say so.
 *
 * BOTH HALVES, because a screen asking "is what I am showing complete?" does not
 * care which of the two reads was clipped. The dashboard computes throughput and
 * SLA compliance entirely from closed rows, so for months the one screen most
 * exposed to a closed clip was reading a flag that could only ever describe the
 * open fetch. A caller that genuinely needs to tell them apart reads
 * `useEntriesCoverage()` and looks at the two fields.
 */
export function useEntriesTruncated(): boolean {
  return useEntriesStore((s) => s.coverage.truncated || s.coverage.closedTruncated)
}

export function useHealthMap(): ReadonlyMap<string, EntryHealth> {
  return useEntriesStore((s) => s.health)
}

export function useEntryHealth(id: string | null | undefined): EntryHealth | undefined {
  return useEntriesStore((s) => (id ? s.health.get(id) : undefined))
}

export function usePendingOp(id: string | null | undefined): PendingOp | undefined {
  return useEntriesStore((s) => (id ? s.pending.get(id) : undefined))
}

export function useEntryFlash(id: string | null | undefined): FlashMark | undefined {
  return useEntriesStore((s) => (id ? s.flash.get(id) : undefined))
}

/**
 * SELF-LOADING and deduped in-flight. Callers MUST NOT write their own fetch
 * effect — two components rendering the same thread would otherwise issue two
 * requests and race each other into the store.
 *
 * The three fields are read through three narrow selectors and assembled in a
 * useMemo. Returning `{ updates, loading, error }` from one selector would build
 * a fresh object per render, which is the getSnapshot-caching trap this file's
 * header opens with.
 */
export function useEntryUpdates(entryId: string | null): {
  updates: EntryUpdate[]
  loading: boolean
  error: string | null
} {
  const stored = useEntriesStore((s) => (entryId ? s.updates.get(entryId) : undefined))
  const loading = useEntriesStore((s) => (entryId ? s.updatesLoading.has(entryId) : false))
  const error = useEntriesStore((s) => (entryId ? (s.updatesError.get(entryId) ?? null) : null))

  useEffect(() => {
    if (entryId) void loadUpdates(entryId)
  }, [entryId])

  const updates = stored ?? (EMPTY_UPDATES as EntryUpdate[])
  return useMemo(() => ({ updates, loading, error }), [updates, loading, error])
}

// ── derived (useMemo over the stable list; the pure work lives in lib/) ─────

export function useFilteredEntries(filter: FilterState): Entry[] {
  const list = useEntryList()
  const health = useHealthMap()
  const ctx = useFilterContext()
  // filterKey(filter), not `filter` and never JSON.stringify: a screen rebuilds
  // its filter object on every render, so the object identity changes constantly
  // while the filter itself does not. lib/entryFilter owns the key because key
  // ORDER is not guaranteed across construction paths.
  const key = filterKey(filter)
  // `key` deliberately stands in for `filter` in the dependency list, which is
  // why the lint rule is silenced rather than obeyed: a screen rebuilds its
  // filter object on every render, so depending on the object re-runs this memo
  // — and re-filters the whole working set — on every keystroke anywhere on the
  // page. filterKey() is the value-identity the object does not have.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => selectEntries(list, filter, health, ctx), [list, health, ctx, key])
}

/**
 * The eight numbers every header pill in the app shows.
 *
 * Counted over the FILTERED set when a filter is supplied, so "3 overdue" under
 * an active track filter means three in that track. Health questions read the
 * health map rather than recomputing, so the pill and the row badge can never
 * disagree.
 */
/* oxlint-disable react-hooks/exhaustive-deps -- `key` stands in for `filter`, as in useFilteredEntries */
export function useEntryCounts(filter?: FilterState): EntryCounts {
  const list = useEntryList()
  const health = useHealthMap()
  const ctx = useFilterContext()
  const key = filter ? filterKey(filter) : ''
  return useMemo(() => {
    const base = filter ? selectEntries(list, filter, health, ctx) : list
    return countEntries(base, health, ctx.today, addDays(ctx.today, 7))
  }, [list, health, ctx, key])
}
/* oxlint-enable react-hooks/exhaustive-deps */

/**
 * The counting itself, pure and dateless — `today` and `weekEnd` arrive already
 * resolved so this needs no clock and no calendar, which is what makes it
 * testable without freezing time.
 *
 * Health questions read the health map rather than recomputing, so a pill and
 * the row badge beside it can never disagree about the same entry.
 */
export function countEntries(
  entries: Entry[],
  health: ReadonlyMap<string, EntryHealth>,
  today: IsoDate,
  weekEnd: IsoDate,
): EntryCounts {
  const counts: EntryCounts = {
    total: entries.length,
    open: 0,
    overdue: 0,
    stale: 0,
    blocked: 0,
    unassigned: 0,
    dueThisWeek: 0,
    closed: 0,
  }
  for (const e of entries) {
    if (isClosed(e.status)) {
      counts.closed += 1
      continue
    }
    counts.open += 1
    const h = health.get(e.id)
    if (h && h.days_overdue > 0) counts.overdue += 1
    if (h?.health === 'stale') counts.stale += 1
    if (e.status === 'blocked') counts.blocked += 1
    if (!e.owner_id && !e.owner_name) counts.unassigned += 1
    if (e.due_date && e.due_date >= today && e.due_date <= weekEnd) counts.dueThisWeek += 1
  }
  return counts
}

/**
 * `me` and `today` — the two values every filter needs and no filter can know.
 *
 * Memoised on its two primitives so the object identity is stable across
 * renders; it is a useMemo dependency in three other hooks in this file, and an
 * unstable one would defeat all of them.
 */
export function useFilterContext(): FilterContext {
  const { profile } = useAuth()
  const meId = profile?.id ?? null
  const today = todayIso()
  return useMemo(() => ({ meId, today }), [meId, today])
}

// ── loading ────────────────────────────────────────────────────────────────

let inFlight: Promise<void> | null = null

/**
 * Merge a fetched open working set into the store.
 *
 * Merge, not replace, and the exception list is the whole reason this is a named
 * function: temp and pending rows are LOCAL truth the server has not seen yet
 * and a replace would delete them mid-flight. Rows that are open locally but
 * absent from a fresh open fetch are pruned — the only ways that happens are a
 * close or a delete elsewhere, and either way the row does not belong in the
 * open working set any more. Rows already closed locally are left alone, because
 * they were loaded deliberately by loadClosedSince() or a track window and the
 * open fetch says nothing about them.
 */
function mergeOpenFetch(rows: Entry[], health: EntryHealth[] | null, truncated = false): void {
  const st = useEntriesStore.getState()
  const fetched = new Set(rows.map((r) => r.id))
  const byId = new Map<string, Entry>()

  for (const [id, entry] of st.byId) {
    if (isTempId(id) || st.pending.has(id)) byId.set(id, entry)
    else if (!fetched.has(id) && isClosed(entry.status)) byId.set(id, entry)
  }
  for (const row of rows) {
    if (!byId.has(row.id)) byId.set(row.id, row)
  }

  // `null` means the health read failed while the entry read succeeded. Keeping
  // the previous view rows is strictly better than replacing them with nothing:
  // slightly stale age pills beat every pill on the screen disappearing because
  // one of two requests lost a race.
  const serverHealth = health === null ? st.serverHealth : new Map(health.map((h) => [h.id, h]))
  commit(byId, serverHealth, {
    loading: false,
    error: null,
    coverage: { ...st.coverage, openLoaded: true, loadedAt: Date.now(), truncated },
  })
}

/**
 * Open entries + v_entry_health, in one pass.
 *
 * Safe to call unawaited and safe to call twice concurrently: three components
 * mounting at once await the same promise instead of each firing a request and
 * writing the answer three times. It never rejects — a list screen must render
 * its cached rows and an error key, not throw a route away.
 */
export function loadEntries(force = false): Promise<void> {
  if (inFlight) return inFlight
  if (!force && useEntriesStore.getState().coverage.loadedAt !== null) return Promise.resolve()

  // Only show the spinner when there is genuinely nothing to show. A focus
  // refetch with a warm cache must not blank the list the user is reading.
  if (useEntriesStore.getState().list.length === 0) {
    useEntriesStore.setState({ loading: true })
  }

  inFlight = Promise.all([listEntries(), listHealth()])
    .then(([entries, health]) => {
      if (!entries.ok) {
        useEntriesStore.setState({ loading: false, error: entries.error })
        return
      }
      // A failed health read is not a failed load: every row still renders, the
      // age pills are simply absent until the next pass. Blanking the list over
      // a missing view would be a much larger outage than the one that happened.
      if (!health.ok) console.warn('[entries] health load failed:', health.error)
      // Either read hitting the ceiling means the working set is a window.
      // Health is included because the two are clipped independently, and a
      // clipped health read is the one that quietly turns on the client mirror.
      const truncated = entries.data.truncated || (health.ok && health.data.truncated)
      if (truncated) {
        console.warn(
          `[entries] read clipped at PostgREST's ceiling (${entries.data.rows.length} rows) — the working set is partial.`,
        )
      }
      mergeOpenFetch(entries.data.rows, health.ok ? health.data.rows : null, truncated)
    })
    .finally(() => {
      inFlight = null
      useEntriesStore.setState({ loading: false })
    })

  return inFlight
}

/**
 * The last window anything asked for, so refreshEntries() can re-attempt it.
 *
 * The Retry button on the dashboard is bound to refreshEntries(), which was
 * `loadEntries(true)` and nothing else — so a failed closed read had NO
 * user-reachable recovery at all: retrying re-fetched the open set, and the only
 * thing that re-fired the closed read was changing the weeks selector.
 */
let lastClosedRequest: IsoDate | null = null

/**
 * Closed entries, on demand. Additive: it never prunes the open working set.
 *
 * A FAILURE IS RECORDED, not warned about and dropped. See
 * EntriesCoverage.closedError — everything the dashboard and the digest say
 * about finished work is computed from these rows, and "the request failed" and
 * "nothing was finished" used to be the same observable state.
 */
export function loadClosedSince(since: IsoDate): Promise<void> {
  lastClosedRequest = since
  const st = useEntriesStore.getState()
  // Already covered by a wider window — asking again would re-download a month
  // of done items to learn nothing.
  if (st.coverage.closedSince !== null && st.coverage.closedSince <= since) {
    // A caveat from a WIDER window that failed does not describe this one, which
    // is loaded. Clearing it here is what stops a stale error outliving the read
    // it was about: 30 days fails, the user drops back to 7, and the 7-day view
    // is complete.
    if (st.coverage.closedError !== null) {
      useEntriesStore.setState({ coverage: { ...st.coverage, closedError: null } })
    }
    return Promise.resolve()
  }

  return listClosedSince(since).then((result) => {
    if (!result.ok) {
      console.warn('[entries] closed load failed:', result.error)
      const failed = useEntriesStore.getState()
      useEntriesStore.setState({
        coverage: { ...failed.coverage, closedError: result.error },
      })
      return
    }
    if (result.data.truncated) {
      console.warn(
        `[entries] closed read clipped at PostgREST's ceiling (${result.data.rows.length} rows) — throughput and SLA compliance describe a window.`,
      )
    }
    const current = useEntriesStore.getState()
    const byId = new Map(current.byId)
    for (const row of result.data.rows) {
      if (!current.pending.has(row.id)) byId.set(row.id, row)
    }
    commit(byId, current.serverHealth, {
      // OR, never assignment: a narrower window fetched later returns fewer rows
      // and would otherwise report the working set as complete when the rows the
      // wider one clipped are still missing from it.
      coverage: {
        ...current.coverage,
        closedSince: since,
        closedTruncated: current.coverage.closedTruncated || result.data.truncated,
        // Cleared, unlike `closedTruncated`: a clip is a property of the DATA
        // and survives a later narrower read, while a failure is a property of
        // one REQUEST and this one succeeded.
        closedError: null,
      },
    })
  })
}

/** One track's window, for the timeline. Loads entries AND their thread rows. */
export function loadTrackHistory(trackId: string, from: IsoDate, to: IsoDate): Promise<void> {
  return listTrackHistory(trackId, from, to).then((result) => {
    if (!result.ok) {
      console.warn('[entries] track history failed:', result.error)
      return
    }
    const st = useEntriesStore.getState()
    const byId = new Map(st.byId)
    for (const row of result.data.entries) {
      if (!st.pending.has(row.id)) byId.set(row.id, row)
    }

    // The thread rows arrive newest-first in one batch; the store holds each
    // entry's thread oldest-first, so they are grouped and sorted here rather
    // than by every screen that later reads a thread.
    const updates = new Map(st.updates)
    const grouped = new Map<string, EntryUpdate[]>()
    for (const row of result.data.updates) {
      const bucket = grouped.get(row.entry_id) ?? []
      bucket.push(row)
      grouped.set(row.entry_id, bucket)
    }
    for (const [entryId, rows] of grouped) {
      updates.set(entryId, mergeUpdates(updates.get(entryId), rows))
    }

    commit(byId, st.serverHealth, {
      updates,
      coverage: { ...st.coverage, trackHistory: { ...st.coverage.trackHistory, [trackId]: { from, to } } },
    })
  })
}

/** In-flight thread loads, so two components on one entry make one request. */
const updatesInFlight = new Map<string, Promise<void>>()

export function loadUpdates(entryId: string, force = false): Promise<void> {
  // A thread on a row the server has never seen is empty by construction, and
  // asking about a temp id sends a non-uuid to Postgres and earns a 22P02.
  if (isTempId(entryId)) return Promise.resolve()

  const existing = updatesInFlight.get(entryId)
  if (existing) return existing
  if (!force && useEntriesStore.getState().updates.has(entryId)) return Promise.resolve()

  const st = useEntriesStore.getState()
  useEntriesStore.setState({
    updatesLoading: new Set(st.updatesLoading).add(entryId),
    updatesError: withoutKey(st.updatesError, entryId),
  })

  const promise = listUpdates(entryId)
    .then((result) => {
      const current = useEntriesStore.getState()
      if (!result.ok) {
        useEntriesStore.setState({
          updatesError: new Map(current.updatesError).set(entryId, result.error),
        })
        return
      }
      useEntriesStore.setState({
        // mergeUpdates, not a replace: an optimistic row posted while the fetch
        // was in flight must survive its own settle.
        updates: new Map(current.updates).set(entryId, mergeUpdates(current.updates.get(entryId), result.data)),
      })
    })
    .finally(() => {
      updatesInFlight.delete(entryId)
      const current = useEntriesStore.getState()
      const loading = new Set(current.updatesLoading)
      loading.delete(entryId)
      useEntriesStore.setState({ updatesLoading: loading })
    })

  updatesInFlight.set(entryId, promise)
  return promise
}

/**
 * The visible Retry, on the dashboard and the follow-ups list.
 *
 * IT RE-ATTEMPTS THE CLOSED WINDOW TOO. This was `loadEntries(true)`, which
 * refetches only the OPEN set — so the one failure with no other recovery path
 * (the closed read; nothing re-fires it but a change to the weeks selector) was
 * the one failure Retry could not fix. `loadClosedSince()` is a no-op when the
 * window it is asked for is already loaded, so a retry after a SUCCESSFUL closed
 * read still costs exactly one request.
 */
export function refreshEntries(): Promise<void> {
  const open = loadEntries(true)
  const since = lastClosedRequest
  if (since === null) return open
  return Promise.all([open, loadClosedSince(since)]).then(() => undefined)
}

// ── the SLA matrix ─────────────────────────────────────────────────────────

let slaInFlight: Promise<void> | null = null
let slaLoaded = false

/**
 * Fetch `track_slas` and re-derive every health row against it.
 *
 * SEPARATE FROM loadEntries() on purpose. It is a small admin-configured table
 * with a completely different lifetime from the working set: it changes when an
 * admin edits a track, not when work happens, so pulling it on every focus
 * refetch would be a request per tab switch for data that is almost never
 * different. The Shell warms it once alongside config/vocab/members;
 * TrackEditor invalidates it after a write.
 *
 * A FAILED READ IS NOT A FAILED LOAD, and specifically does not clear a matrix
 * already held: resolveSlaDays() reads null as "no overrides", so dropping a
 * good matrix on one bad response would silently relax every deadline on screen.
 * The error key is recorded so the compliance panel can say the number is
 * provisional.
 *
 * IT IS ALSO NOT A LOAD FOR DEDUPE PURPOSES. `slaLoaded` is the latch that makes
 * this idempotent, and setting it on a failure meant one transient error retired
 * the read for the life of the tab: the Shell warm-up and Dashboard's mount
 * effect both short-circuited, `slaMatrix` stayed null, and every SLA badge and
 * the compliance chart quietly fell back to the priority default — a
 * too-generous deadline shown with no indication it was a guess, and no path
 * back short of a reload. The latch is now only set on a response we actually
 * kept, so the next mount retries.
 *
 * Deduped and idempotent exactly like loadEntries(), because four screens mount
 * at once on a cold start.
 */
export function loadTrackSlas(force = false): Promise<void> {
  if (slaInFlight) return slaInFlight
  if (!force && slaLoaded) return Promise.resolve()

  slaInFlight = listTrackSlas()
    .then((result) => {
      const st = useEntriesStore.getState()
      if (!result.ok) {
        useEntriesStore.setState({ slaMatrixError: result.error })
        return
      }
      slaLoaded = true
      // buildTrackSlaMap() mints a fresh Map, which is why it runs HERE and
      // never in a selector — see its own header.
      const slaMatrix = buildTrackSlaMap(result.data)
      useEntriesStore.setState({
        slaMatrix,
        slaMatrixError: null,
        // Re-derive: every fallback health row on screen was computed against
        // the previous matrix, and this is the moment they stop being right.
        ...derive(st.byId, st.serverHealth, slaMatrix),
      })
    })
    .catch(() => {
      // listTrackSlas() returns an ApiResult and does not reject; this is the
      // belt for a transport that throws before the wrapper sees it. No latch
      // here either — a transport that threw is exactly a read worth retrying.
      useEntriesStore.setState({ slaMatrixError: 'common.error' })
    })
    .finally(() => {
      slaInFlight = null
    })

  return slaInFlight
}

/** After an admin writes `track_slas`. Refetches and re-derives. */
export function invalidateTrackSlas(): Promise<void> {
  return loadTrackSlas(true)
}

export function invalidateEntries(): void {
  const st = useEntriesStore.getState()
  useEntriesStore.setState({ coverage: { ...st.coverage, loadedAt: null } })
  void loadEntries(true)
}

/** Sign-out. Leaving a previous user's working set in memory leaks it. */
export function resetEntries(): void {
  if (cacheTimer !== null) {
    clearTimeout(cacheTimer)
    cacheTimer = null
  }
  stopFlashSweep()
  updatesInFlight.clear()
  inFlight = null
  // The next account in this tab must not have its Retry re-fire the previous
  // one's window before any screen has asked for anything.
  lastClosedRequest = null
  // The matrix is workspace-wide, not per-user, but `slaLoaded` is a dedupe
  // latch and leaving it set would mean the next account in this tab never
  // fetches — the empty matrix it inherits would then read as "no overrides".
  slaInFlight = null
  slaLoaded = false
  // Both are keyed by entry id and both outlive a single call, so the next
  // account in this tab would inherit them: a busy badge that never clears, and
  // a stashed row RLS would never have handed the new user.
  outstanding.clear()
  deferredRealtime.clear()
  localWrites.clear()
  try {
    localStorage.removeItem(CACHE_KEY)
  } catch {
    // Nothing here is worth failing a sign-out over.
  }
  useEntriesStore.setState({
    byId: new Map(),
    list: [],
    serverHealth: new Map(),
    health: new Map(),
    slaMatrix: null,
    slaMatrixError: null,
    updates: new Map(),
    updatesLoading: new Set(),
    updatesError: new Map(),
    pending: new Map(),
    flash: new Map(),
    coverage: emptyCoverage(),
    loading: false,
    error: null,
  })
}

// ── writes — optimistic, all through the seam ──────────────────────────────

function nowIso(): string {
  return new Date().toISOString()
}

/**
 * The signed-in user's id, synchronously.
 *
 * An optimistic row needs an author BEFORE any await resolves — an await here
 * would put a network hop in front of the paint that capture exists to make
 * instant — and the realtime batch handler needs it to know which changes are
 * its own. So it is cached, and kept current by the auth listener below rather
 * than re-read per call.
 *
 * store/auth.ts does not expose its zustand store, only the hook, so this reads
 * the session directly. Same source, one layer lower: it is the id
 * `entries_insert`'s `created_by = auth.uid()` check will compare against, so a
 * mismatch is impossible rather than merely unlikely.
 */
let meIdCache: string | null = null

function currentMeId(): string | null {
  return meIdCache
}

if (supabase) {
  void supabase.auth.getSession().then(({ data }) => {
    meIdCache = data.session?.user.id ?? null
  })
  // Synchronous body ON PURPOSE. supabase-js serializes auth work behind a lock
  // and awaiting a client call inside this callback deadlocks it — store/auth.ts
  // documents the same trap and escapes it with queueMicrotask. Reading a field
  // off the session needs neither.
  supabase.auth.onAuthStateChange((_event, session) => {
    meIdCache = session?.user.id ?? null
  })
}

function newTempId(): string {
  return `${TEMP_PREFIX}${crypto.randomUUID()}`
}

function setPending(id: string, op: PendingOp | null): void {
  const st = readState()
  const pending = new Map(st.pending)
  if (op) pending.set(id, op)
  else pending.delete(id)
  useEntriesStore.setState({ pending })
}

/**
 * How many writes are still outstanding against each entry.
 *
 * `pending` stays keyed by ENTRY, because "is this row busy?" is the only
 * question any renderer asks. But every control in the entry sheet commits its
 * own field independently and fire-and-forget (`void patchEntry(id, fields)`),
 * so two writes against one row overlap routinely — and clearing `pending` on
 * the first settle deleted the guard while the second was still out. The
 * monotonic guard is the only thing stopping a realtime echo from reverting the
 * row under the user's cursor, so opening it early is not cosmetic.
 *
 * A QUEUED write stays counted. It has not settled — the outbox owns it — and
 * `settleOutboxWrite()` is what finally retires it. That is the same lifetime
 * `pending`'s own `queued: true` marker already has, so nothing here leaks that
 * the row's busy badge was not already going to.
 *
 * Creates are exempt: their target id is minted by the call itself, so nothing
 * else can be writing to it yet.
 */
const outstanding = new Map<string, number>()

function beginWrite(id: string): void {
  outstanding.set(id, (outstanding.get(id) ?? 0) + 1)
}

/** Retire one write. True when it was the LAST one out for this entry. */
function endWrite(id: string): boolean {
  const left = (outstanding.get(id) ?? 1) - 1
  if (left > 0) {
    outstanding.set(id, left)
    return false
  }
  outstanding.delete(id)
  return true
}

/**
 * Realtime rows the monotonic guard dropped because a write was in flight.
 *
 * Dropping them is right — see acceptsServerRow — but only for the length of the
 * flight. The row was another user's edit, postgres_changes has no replay, and
 * without this it stayed lost until the 45 s focus refetch. Newest per entry
 * only: an older drop is superseded by definition, and this is a stash, not a
 * queue.
 *
 * Replayed rather than refetched because we already HAVE the row, and the guard
 * re-runs on the way back in — so a settled local write that is genuinely newer
 * still wins on `updated_at`.
 */
const deferredRealtime = new Map<string, { row: Entry; actor?: FlashMark }>()

/** Hand back a row the guard deferred, now that the entry is quiet. */
function flushDeferred(id: string): void {
  const held = deferredRealtime.get(id)
  if (!held) return
  deferredRealtime.delete(id)
  applyServerRow(held.row, 'realtime', held.actor)
}

/**
 * The store, read without React. Mirrors getVocabSnapshot() and
 * getMembersSnapshot(); for tests, and for anything that needs the working set
 * outside a component.
 */
export function getEntriesSnapshot(): {
  byId: ReadonlyMap<string, Entry>
  pending: ReadonlyMap<string, PendingOp>
  updates: ReadonlyMap<string, EntryUpdate[]>
  health: ReadonlyMap<string, EntryHealth>
  slaMatrix: TrackSlaMap | null
} {
  const st = useEntriesStore.getState()
  return {
    byId: st.byId,
    pending: st.pending,
    updates: st.updates,
    health: st.health,
    slaMatrix: st.slaMatrix,
  }
}

/**
 * The snapshot getter's other half: notify me when the store changes.
 *
 * Exists so §2.14's frozen rule — "a meeting bulk-commit of 20 rows produces one
 * setState, not twenty" — is a COUNTABLE assertion rather than a comment. That
 * rule and the whole `staged`/`stagedDirty`/`finally` machinery under it shipped
 * with no test (FIX-BACKLOG **BATCH-SETSTATE**), and there is no way to count
 * notifications from outside a store that exposes only a getter.
 *
 * Returns zustand's own unsubscribe. Fires once per setState, which is exactly
 * the quantity being measured — do NOT reach for this to build a React
 * subscription; the narrow hooks above already do that correctly.
 */
export function subscribeEntries(listener: () => void): () => void {
  return useEntriesStore.subscribe(listener)
}

/** Copy one column across. A generic key parameter is the only shape TypeScript
 *  accepts a write through `keyof` in. */
function copyColumn<K extends keyof Entry>(target: Entry, source: Entry, key: K): void {
  target[key] = source[key]
}

/**
 * Undo THIS write's optimistic change, and nothing else's.
 *
 * The old rollback restored the whole pre-change snapshot, which is correct only
 * for a write that was alone on the row. It never is: patch A (status) snapshots
 * S0 and applies S1, patch B (priority) applies S2, B succeeds, A fails — and
 * restoring S0 erased B's priority change from the UI even though the server had
 * accepted it, until the next fetch.
 *
 * So the diff is taken twice. `before` vs `mine` says which columns THIS write
 * touched; `current` vs `mine` says whether anything has moved them since. A
 * column this write did not touch is left alone, and a column somebody else has
 * since written is left alone — the undo only ever reaches the values it
 * actually put there.
 *
 * Reference equality on `tags` and `links` is deliberate rather than tolerated:
 * applyPatchLocal assigns the caller's array, so a fresh reference means "this
 * write set it" and a matching one means "nothing has replaced it". Erring
 * toward not-mine is the safe direction for a rollback.
 */
export function revertMine(current: Entry, before: Entry, mine: Entry): Entry {
  const next = { ...current }
  let touched = false
  for (const col of Object.keys(before) as (keyof Entry)[]) {
    if (before[col] === mine[col]) continue
    if (current[col] !== mine[col]) continue
    copyColumn(next, before, col)
    touched = true
  }
  return touched ? next : current
}

/**
 * Everything a create needs that the input does not carry. The shape has to
 * match what the server will return closely enough that the swap on settle is
 * invisible — every not-null column gets its documented default, because a
 * missing `tags` is a crash in a row renderer, not a blank chip.
 */
function optimisticRow(input: NewEntry, id: string, meId: string | null, ts: string): Entry {
  const ownerId = input.ownerId ?? null
  const status = input.status ?? 'new'
  return {
    id,
    track_id: input.trackId ?? null,
    title: input.title.trim(),
    description: input.description ?? '',
    type: input.type ?? 'action',
    status,
    priority: input.priority ?? 'medium',
    owner_id: ownerId,
    owner_name: ownerId ? null : (input.ownerName ?? null),
    requester: input.requester ?? null,
    due_date: input.dueDate ?? null,
    follow_up_date: input.followUpDate ?? null,
    tags: input.tags ?? [],
    links: input.links ?? [],
    created_by: meId,
    created_at: ts,
    updated_at: ts,
    closed_at: isClosed(status) ? ts : null,
    last_activity_at: ts,
    meeting_id: input.meetingId ?? null,
    template_id: input.templateId ?? null,
  }
}

export async function createEntryOptimistic(input: NewEntry): Promise<ApiResult<Entry>> {
  const tempId = newTempId()
  const ts = nowIso()

  const st = useEntriesStore.getState()
  const row = optimisticRow(input, tempId, currentMeId(), ts)
  const byId = new Map(st.byId).set(tempId, row)
  commit(byId, st.serverHealth, {
    pending: new Map(st.pending).set(tempId, {
      id: tempId,
      kind: 'create',
      since: Date.now(),
      error: null,
      queued: false,
    }),
  })

  const result = await submitFn<Entry>({
    table: 'entries',
    op: 'insert',
    id: null,
    tempId,
    payload: input,
    dedupeKey: dedupeKeyFor('entries', 'insert', tempId, input),
    dependsOn: [],
  })

  if (result.ok) {
    // ONE setState: delete the temp row and insert the server row together. A
    // two-step swap makes the row visibly flicker out of the list and back.
    // Shared with the outbox's settle path, because a create that went straight
    // out and a create that sat in the queue for an hour are the same event.
    settleCreate(tempId, result.data)
    return result
  }

  if (result.error === QUEUED_KEY) {
    // Queued, not failed. The row stays; the outbox owns it from here.
    markQueued(tempId)
    return result
  }

  rollbackCreate(tempId, result.error)
  return result
}

function rollbackCreate(tempId: string, error: string): void {
  const st = useEntriesStore.getState()
  const byId = new Map(st.byId)
  byId.delete(tempId)
  const pending = new Map(st.pending)
  pending.delete(tempId)
  commit(byId, st.serverHealth, { pending })
  toast(t(error), { tone: 'error' })
}

function markQueued(id: string): void {
  const st = useEntriesStore.getState()
  const op = st.pending.get(id)
  if (!op) return
  setPending(id, { ...op, queued: true })
}

export async function patchEntry(id: string, patch: EntryPatch): Promise<ApiResult<Entry>> {
  const st = useEntriesStore.getState()
  const snapshot = st.byId.get(id)
  if (!snapshot) return fail('entry.errNotFound')

  const optimistic = applyPatchLocal(snapshot, patch, nowIso())
  const byId = new Map(st.byId).set(id, optimistic)
  commit(byId, st.serverHealth, {
    pending: new Map(st.pending).set(id, {
      id,
      kind: 'patch',
      since: Date.now(),
      error: null,
      queued: false,
    }),
  })

  beginWrite(id)
  const result = await submitFn<Entry>({
    table: 'entries',
    op: 'update',
    id,
    tempId: null,
    payload: patch,
    dedupeKey: dedupeKeyFor('entries', 'update', id, patch),
    // A patch against a row the server has not created yet has to wait for the
    // insert to land and hand over the real id. The outbox does the rewriting;
    // this is how it learns the order.
    dependsOn: isTempId(id) ? [id] : [],
  })

  if (!result.ok && result.error === QUEUED_KEY) {
    // NOT retired: the write is still outstanding, it is just outstanding in the
    // outbox. settleOutboxWrite() ends it when the queue drains.
    markQueued(id)
    return result
  }

  const last = endWrite(id)

  if (result.ok) {
    // Only the LAST write out clears the busy marker. Clearing it while a
    // sibling edit is still in flight reopens the monotonic guard early, and the
    // realtime echo of the in-flight write then reverts the field under the
    // user's cursor.
    if (last) setPending(id, null)
    applyServerRow(result.data, 'local')
    if (last) flushDeferred(id)
    return result
  }

  // Undo only what THIS write applied — see revertMine. Restoring the whole
  // snapshot used to erase an overlapping edit the server had already accepted.
  const current = useEntriesStore.getState()
  const held = current.byId.get(id)
  const restored = held ? new Map(current.byId).set(id, revertMine(held, snapshot, optimistic)) : current.byId
  const pending = new Map(current.pending)
  if (last) pending.delete(id)
  commit(restored, current.serverHealth, { pending })
  if (last) flushDeferred(id)
  toast(t(result.error), { tone: 'error' })
  return result
}

export function setStatus(id: string, status: EntryStatus): Promise<ApiResult<Entry>> {
  return patchEntry(id, { status })
}

/**
 * Push an item's follow-up date out.
 *
 * Measured from TODAY, not from the existing follow_up_date: "snooze 3 days" on
 * an item that was due for follow-up last week means three days from now, and
 * chaining off a stale date would snooze it into the past.
 */
export function snoozeFollowUp(id: string, days: number): Promise<ApiResult<Entry>> {
  return patchEntry(id, { followUpDate: addDays(todayIso(), days) })
}

export async function postUpdate(input: NewEntryUpdate): Promise<ApiResult<EntryUpdate>> {
  const tempId = newTempId()
  const ts = nowIso()
  const entryId = input.entryId

  const optimistic: EntryUpdate = {
    id: tempId,
    entry_id: entryId,
    author_id: currentMeId(),
    body: input.body ?? '',
    status_from: input.statusFrom ?? null,
    status_to: input.statusTo ?? null,
    created_at: ts,
  }

  const st = useEntriesStore.getState()
  // The rollback snapshot of the PARENT, not just of the thread: the optimistic
  // append bumps the entry's activity timestamp too, and a failed post that
  // leaves the row sitting at the top of every list has half-succeeded.
  const parentBefore = st.byId.get(entryId)
  const updates = new Map(st.updates).set(entryId, mergeUpdates(st.updates.get(entryId), [optimistic]))
  // The thread bump mirrors 0001's entry_updates_touch_trg: appending to the
  // thread is activity on the entry even when no column of the entry changed.
  const byId = touchEntry(st.byId, entryId, ts)
  commit(byId, st.serverHealth, {
    updates,
    pending: new Map(st.pending).set(entryId, {
      id: entryId,
      kind: 'update',
      since: Date.now(),
      error: null,
      queued: false,
    }),
  })

  // The parent row as this post left it, so the rollback below can tell "nothing
  // has touched it since" from "somebody has".
  const parentAfter = byId.get(entryId)

  beginWrite(entryId)
  const result = await submitFn<EntryUpdate>({
    table: 'entry_updates',
    op: 'insert',
    id: null,
    tempId,
    payload: input,
    dedupeKey: dedupeKeyFor('entry_updates', 'insert', tempId, input),
    dependsOn: isTempId(entryId) ? [entryId] : [],
  })

  if (!result.ok && result.error === QUEUED_KEY) {
    // Still outstanding, in the outbox. The temp thread row stays and
    // settleOutboxWrite() swaps it for the server's.
    markQueued(entryId)
    return result
  }

  const last = endWrite(entryId)
  const current = useEntriesStore.getState()
  const thread = current.updates.get(entryId) ?? []
  const withoutTemp = thread.filter((u) => u.id !== tempId)

  if (result.ok) {
    if (last) setPending(entryId, null)
    useEntriesStore.setState({
      updates: new Map(current.updates).set(entryId, mergeUpdates(withoutTemp, [result.data])),
    })
    if (last) flushDeferred(entryId)
    return result
  }

  const pending = new Map(current.pending)
  if (last) pending.delete(entryId)
  // Same rule as patchEntry's: undo the activity bump this post applied, and
  // leave it alone if an overlapping edit or a settled sibling has moved the row
  // since. The thread row is removed unconditionally — it is this post's and
  // nothing else can have claimed it.
  const held = current.byId.get(entryId)
  const restored =
    held && parentBefore && parentAfter
      ? new Map(current.byId).set(entryId, revertMine(held, parentBefore, parentAfter))
      : current.byId
  commit(restored, current.serverHealth, {
    updates: new Map(current.updates).set(entryId, withoutTemp),
    pending,
  })
  if (last) flushDeferred(entryId)
  toast(t(result.error), { tone: 'error' })
  return result
}

/**
 * The capture toast's Undo.
 *
 * A row that never reached the server is simply removed. A row that landed is
 * CANCELLED, not deleted: `entries_delete` is admin-only by policy, and 0001's
 * own comment says why — closing an item is status='cancelled' so the audit
 * thread never vanishes with the row. An undo that 42501s for every member is
 * not an undo.
 *
 * THE QUEUE IS CANCELLED FIRST, and that ordering is the fix rather than a
 * detail. Removing the local row is invisible to store/outbox.ts, so an offline
 * capture undone one second after it was queued still went out on the next
 * flush: the server created the row, `settleCreate()` early-returned because the
 * temp row was gone, and the realtime echo of our own insert then re-rendered
 * the entry the user had been told was undone. `discardOpsForTempId()` takes the
 * insert and anything queued behind it out of the queue, which is what makes
 * "Undone" true for a capture that never reached the network.
 */
export async function undoCapture(id: string): Promise<ApiResult<null>> {
  if (isTempId(id)) {
    discardOpsForTempId(id)
    removeEntryLocal(id)
    return { ok: true, data: null }
  }
  const result = await patchEntry(id, { status: 'cancelled' })
  if (!result.ok) return result
  return { ok: true, data: null }
}

/**
 * Meeting triage commits server-side; see api/meetings.commitMeetingLines. This
 * is for any OTHER multi-insert.
 *
 * PARTIAL SUCCESS IS REPORTED, NOT ROLLED BACK — silently discarding eight
 * successful rows because the ninth failed is worse than telling the user which
 * one failed. The caller compares `data.length` with `inputs.length`; only a
 * total failure is an error, because that is the only case where there is
 * nothing to report but the error.
 *
 * Sequential on purpose: twenty parallel inserts is twenty parallel sessions'
 * worth of load from one keystroke, and the order rows land in is the order they
 * were dictated in.
 */
export async function bulkCreate(inputs: NewEntry[]): Promise<ApiResult<Entry[]>> {
  const created: Entry[] = []
  let firstError: string | null = null
  for (const input of inputs) {
    const result = await createEntryOptimistic(input)
    if (result.ok) created.push(result.data)
    else if (!firstError) firstError = result.error
  }
  if (created.length === 0 && firstError) return fail(firstError)
  return { ok: true, data: created }
}

// ── shared with realtime + outbox (not for screens) ────────────────────────

/**
 * Versions this client wrote itself, so the realtime echo of our own settled
 * write is applied without flashing "updated by someone".
 *
 * Bounded by construction: an id is dropped the moment its echo arrives, and the
 * whole map is cleared on reset. It only ever holds writes in the few hundred
 * milliseconds between settle and echo.
 */
const localWrites = new Map<string, string>()

export function applyServerRow(row: Entry, source: ApplySource, actor?: FlashMark): void {
  const st = readState()
  const existing = st.byId.get(row.id)
  if (!acceptsServerRow(existing, row, source, st.pending.has(row.id))) {
    // A realtime row refused because THIS client is mid-write is not junk — it
    // is another user's edit, and postgres_changes will not send it again. Hold
    // the newest one and hand it back when the row goes quiet. Every other
    // refusal is a genuinely older row and stays dropped.
    if (source === 'realtime' && st.pending.has(row.id)) {
      const held = deferredRealtime.get(row.id)
      if (!held || held.row.updated_at <= row.updated_at) deferredRealtime.set(row.id, { row, actor })
    }
    return
  }

  if (source === 'local' || source === 'outbox') localWrites.set(row.id, row.updated_at)

  const byId = new Map(st.byId).set(row.id, row)
  const rest: Partial<EntriesState> = {}

  const echoOfMine = localWrites.get(row.id) === row.updated_at
  if (echoOfMine && source === 'realtime') localWrites.delete(row.id)

  if (actor && source === 'realtime' && !echoOfMine) {
    rest.flash = new Map(st.flash).set(row.id, actor)
  }

  commit(byId, st.serverHealth, rest)
  if (rest.flash) startFlashSweep()
}

/**
 * `_source` is unused, and that is the contract rather than an oversight: the
 * thread is append-only, so there is no conflict to reconcile and no version to
 * compare — the id dedupe in mergeUpdates() is the whole reconciliation. The
 * parameter stays so the signature matches applyServerRow's and so a future rule
 * has somewhere to live.
 */
export function applyServerUpdate(row: EntryUpdate, _source: ApplySource): void {
  const st = readState()
  const thread = st.updates.get(row.entry_id)
  // Only merge into a thread that is actually loaded. Seeding a one-row thread
  // for an entry nobody has opened would make loadUpdates() think it is done and
  // the sheet would render exactly that one row.
  const updates = thread ? new Map(st.updates).set(row.entry_id, mergeUpdates(thread, [row])) : st.updates
  const byId = touchEntry(st.byId, row.entry_id, row.created_at)
  if (updates === st.updates && byId === st.byId) return
  commit(byId, st.serverHealth, { updates })
}

// ── the outbox settle seam ─────────────────────────────────────────────────
//
// A queued write that flushes has to land back HERE, or the optimistic row it
// belongs to is stranded. Without this, an offline capture that drained
// successfully rendered twice for the life of the tab — the temp row, still
// stamped "queued" (mergeOpenFetch preserves anything in `pending` by design),
// plus the real row from the next fetch. `ApplySource` declared 'outbox' and no
// call site ever produced one, which was the tell.
//
// It is a seam rather than an import because the direction only works one way:
// store/outbox.ts is the write path and this store calls INTO it. main.tsx
// installs the callback, the same composition-root move setNotificationsSubmit()
// and setEntriesSubmit() make three lines apart.

/** A row is only worth applying if it actually looks like one — `data` arrives
 *  as `unknown` from a transport this file does not own. */
function asEntry(data: unknown): Entry | null {
  if (typeof data !== 'object' || data === null) return null
  const row = data as Entry
  return typeof row.id === 'string' ? row : null
}

function asEntryUpdate(data: unknown): EntryUpdate | null {
  if (typeof data !== 'object' || data === null) return null
  const row = data as EntryUpdate
  return typeof row.id === 'string' && typeof row.entry_id === 'string' ? row : null
}

/**
 * A queued INSERT landed: swap the temp row for the server's, in one setState.
 *
 * This is createEntryOptimistic's success branch, extracted so the online and
 * the drained-offline paths cannot drift — they are the same event, and the only
 * difference is how long it took.
 *
 * Everything else keyed by the entry moves with it. A patch or an update queued
 * against the temp row is keyed by the temp id in `pending`, in `updates` and in
 * the outstanding-writes count; leaving them behind strands a busy badge on a
 * row that no longer exists and hides a thread the sheet is about to ask for.
 */
function settleCreate(tempId: string, row: Entry): void {
  const st = readState()
  // Gone already — undoCapture() removes a temp row outright, and the user is
  // allowed to do that while the create is still queued.
  if (!st.byId.has(tempId)) return

  const byId = new Map(st.byId)
  byId.delete(tempId)
  byId.set(row.id, row)

  const pending = new Map(st.pending)
  const held = pending.get(tempId)
  pending.delete(tempId)
  if (held && held.kind !== 'create') pending.set(row.id, { ...held, id: row.id })

  let updates = st.updates
  const thread = updates.get(tempId)
  if (thread) {
    updates = new Map(updates)
    updates.delete(tempId)
    updates.set(row.id, thread)
  }

  const left = outstanding.get(tempId)
  if (left !== undefined) {
    outstanding.delete(tempId)
    outstanding.set(row.id, left)
  }

  localWrites.set(row.id, row.updated_at)
  commit(byId, st.serverHealth, { pending, updates })
}

/** A queued UPDATE landed. Same retire-then-apply order as patchEntry's. */
function settlePatch(id: string, row: Entry): void {
  const last = endWrite(id)
  if (last) setPending(id, null)
  applyServerRow(row, 'outbox')
  if (last) flushDeferred(id)
}

/** A queued thread post landed: drop the temp row, merge the server's. */
function settlePostedUpdate(tempId: string | null, row: EntryUpdate): void {
  const st = readState()
  const entryId = row.entry_id
  const last = endWrite(entryId)

  const thread = st.updates.get(entryId)
  const updates = thread
    ? new Map(st.updates).set(
        entryId,
        mergeUpdates(tempId === null ? thread : thread.filter((u) => u.id !== tempId), [row]),
      )
    : st.updates

  const pending = new Map(st.pending)
  if (last) pending.delete(entryId)

  commit(touchEntry(st.byId, entryId, row.created_at), st.serverHealth, { updates, pending })
  if (last) flushDeferred(entryId)
}

/**
 * One drained op, settled into the store. Installed by main.tsx; never called
 * directly by a screen.
 *
 * `op` is the REWRITTEN op — the outbox has already substituted any temp id it
 * resolved earlier in the same drain — so `op.id` is a real row id here while
 * `op.tempId` is still the client-minted one the optimistic row is filed under.
 * That pairing is what makes the swap possible at all.
 *
 * Routes this store did not write (notifications, and the tables waves 2–4 add)
 * fall through: their own stores register their own settle when they get one.
 */
export function settleOutboxWrite(op: MutOp, data: unknown): void {
  const route = `${op.table}:${op.op}`

  if (route === 'entries:insert') {
    const row = asEntry(data)
    if (op.tempId && row) settleCreate(op.tempId, row)
    return
  }
  if (route === 'entries:update') {
    const row = asEntry(data)
    if (op.id && row) settlePatch(op.id, row)
    return
  }
  if (route === 'entry_updates:insert') {
    const row = asEntryUpdate(data)
    if (row) settlePostedUpdate(op.tempId, row)
  }
}

/**
 * One queued op thrown away, unwound from the store. The mirror of
 * settleOutboxWrite(), installed by main.tsx on the same line.
 *
 * WHY A DISCARD NEEDS A HANDLER AT ALL. patchEntry() and postUpdate() do not
 * retire a QUEUED write — `beginWrite()` has run, `pending` holds the row, and
 * the comment at each QUEUED_KEY branch says settleOutboxWrite() ends it when
 * the queue drains. For a discarded op that drain never happens, so without this
 * the row keeps its "Queued" pill for ever, keeps displaying the value the user
 * just discarded (mergeOpenFetch preserves pending rows through every refetch),
 * and refuses every teammate's realtime edit (acceptsServerRow returns false
 * while `pending` holds the id). Only closing the tab cleared it.
 *
 * It has to call endWrite(), not just setPending(id, null): `outstanding` is a
 * COUNT, and a beginWrite with no matching endWrite leaves it at 1 for ever —
 * two later, entirely successful patches on the same row then both see
 * `last === false` and neither clears `pending`. Retiring the count is what
 * makes the row usable again.
 */
export function discardOutboxWrite(op: MutOp): void {
  const route = `${op.table}:${op.op}`

  if (route === 'entries:insert') {
    // A create that was never sent: the optimistic row describes a row that
    // exists nowhere, so it goes. Leaving it behind is worse than the patch
    // case — it is a phantom entry that survives a forced refetch (it is a temp
    // id, which mergeOpenFetch preserves unconditionally) for the session.
    if (op.tempId) removeEntryLocal(op.tempId)
    return
  }

  if (route === 'entries:update') {
    if (op.id) retireDiscardedWrite(op.id)
    return
  }

  if (route === 'entry_updates:insert') {
    const entryId = updateOpEntryId(op)
    const tempId = op.tempId
    if (entryId === null || tempId === null) return

    // THE OWNERSHIP TEST, and it is load-bearing rather than defensive. Not
    // every `entry_updates:insert` in the queue was put there by postUpdate():
    // `queueOrphanedTransition()` files one on api/entries' behalf when a status
    // change's transition row loses its own request, with no optimistic row and
    // no beginWrite(). The optimistic thread row IS this store's record that it
    // queued the op — without this test, discarding somebody else's op would
    // retire a DIFFERENT, genuinely in-flight edit on the same entry and reopen
    // the monotonic guard under the user's cursor.
    const st = readState()
    const thread = st.updates.get(entryId)
    if (!thread?.some((u) => u.id === tempId)) return

    // Drop the optimistic thread row this post added. The parent's activity bump
    // is deliberately left alone: unlike postUpdate's failure path there is no
    // before/after snapshot to diff here, and the next fetch corrects it now
    // that the row is no longer pinned by `pending`.
    useEntriesStore.setState({
      updates: new Map(st.updates).set(
        entryId,
        thread.filter((u) => u.id !== tempId),
      ),
    })
    retireDiscardedWrite(entryId)
  }
}

/** `entry_updates:insert` carries its parent in the payload, not in `op.id`. */
function updateOpEntryId(op: MutOp): string | null {
  const payload = op.payload as NewEntryUpdate | null | undefined
  const entryId = payload?.entryId
  return typeof entryId === 'string' ? entryId : null
}

/**
 * Retire a write that will never settle, and reopen the row.
 *
 * Same retire-then-reopen order as settlePatch(), minus the server row there is
 * none of: end the write, and only if it was the LAST one out clear `pending`
 * and hand back whatever realtime rows the monotonic guard deferred while it was
 * held. A sibling edit still genuinely in flight keeps the badge, which is the
 * behaviour every other path here has.
 */
function retireDiscardedWrite(id: string): void {
  // Nothing to retire is not an error: a queue restored from localStorage after
  // a reload outlives `outstanding` and `pending`, which are in-memory and empty
  // by then. Decrementing from nothing would only manufacture a counter.
  if (!outstanding.has(id)) return
  const last = endWrite(id)
  if (!last) return
  setPending(id, null)
  flushDeferred(id)
}

export function removeEntryLocal(id: string): void {
  const st = readState()
  // Cleared BEFORE the membership check, and unconditionally: these two are
  // module-level bookkeeping, not store state, so a row that has already left
  // `byId` can still be holding an outstanding-write count that would make the
  // NEXT row to take that id look permanently busy. `outstanding` is exactly
  // what leaked when a queued write was discarded rather than settled.
  outstanding.delete(id)
  deferredRealtime.delete(id)
  if (!st.byId.has(id)) return
  const byId = new Map(st.byId)
  byId.delete(id)
  const serverHealth = new Map(st.serverHealth)
  serverHealth.delete(id)
  const updates = new Map(st.updates)
  updates.delete(id)
  const pending = new Map(st.pending)
  pending.delete(id)
  const flash = new Map(st.flash)
  flash.delete(id)
  localWrites.delete(id)
  commit(byId, serverHealth, { updates, pending, flash })
}

/**
 * `greatest(last_activity_at, ts)` on one entry — the client-side twin of
 * entry_updates_touch_entry(). greatest(), not assignment, so an out-of-order
 * backfill cannot drag the timestamp backwards and make a live item look stale.
 *
 * Returns the SAME map when nothing changed, so callers can skip a re-derive.
 */
function touchEntry(byId: Map<string, Entry>, entryId: string, ts: string): Map<string, Entry> {
  const entry = byId.get(entryId)
  if (!entry || entry.last_activity_at >= ts) return byId
  return new Map(byId).set(entryId, { ...entry, last_activity_at: ts })
}

/** Thread rows, oldest first, deduped by id. The optimistic row loses to its own
 *  server row because the server row is merged after the temp row is dropped. */
function mergeUpdates(existing: EntryUpdate[] | undefined, incoming: EntryUpdate[]): EntryUpdate[] {
  const byId = new Map((existing ?? []).map((u) => [u.id, u]))
  for (const row of incoming) byId.set(row.id, row)
  return [...byId.values()].sort((a, b) =>
    a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1,
  )
}

function withoutKey(map: Map<string, string>, key: string): Map<string, string> {
  if (!map.has(key)) return map
  const next = new Map(map)
  next.delete(key)
  return next
}

// ── flash sweep ────────────────────────────────────────────────────────────

let sweepTimer: ReturnType<typeof setInterval> | null = null

/** ONE interval for every flash in the app, started lazily and stopped when the
 *  last mark expires. A timer per row is 200 timers on a loaded board. */
function startFlashSweep(): void {
  if (sweepTimer !== null) return
  sweepTimer = setInterval(() => {
    const st = useEntriesStore.getState()
    if (st.flash.size === 0) {
      stopFlashSweep()
      return
    }
    const cutoff = Date.now() - FLASH_TTL_MS
    const flash = new Map<string, FlashMark>()
    for (const [id, mark] of st.flash) if (mark.at > cutoff) flash.set(id, mark)
    if (flash.size !== st.flash.size) useEntriesStore.setState({ flash })
    if (flash.size === 0) stopFlashSweep()
  }, 1_000)
}

function stopFlashSweep(): void {
  if (sweepTimer === null) return
  clearInterval(sweepTimer)
  sweepTimer = null
}

// ── realtime wiring ────────────────────────────────────────────────────────

/**
 * Subscribe the store to the shared realtime channel. Idempotent; returns its
 * own teardown. The Shell calls this once a session exists.
 *
 * It lives here rather than in api/realtime.ts because applying a row is this
 * store's job and `api → store` is not an allowed import direction.
 */
let realtimeOff: (() => void) | null = null

export function startEntriesRealtime(): () => void {
  if (realtimeOff) return realtimeOff

  const offBatch = onRealtimeBatch((batch) => {
    applyRealtimeBatch(batch)
  })
  // A reconnect or a long-hidden tab means rows changed while nothing was
  // listening, and postgres_changes has no replay. Refetching is the only way to
  // find out what.
  const offResync = onRealtimeResync(() => {
    void refreshEntries()
  })

  realtimeOff = () => {
    offBatch()
    offResync()
    realtimeOff = null
  }
  return realtimeOff
}

/**
 * One coalesced batch, applied under the monotonic guard, re-derived once.
 *
 * The entry_updates rows are read FIRST because they are the only source of an
 * actor: `entries` has no column saying who wrote a change, so the flash's name
 * comes from the thread row that arrived in the same batch. With no such row the
 * mark carries a null actor and renders as t('entry.updatedGeneric') — never an
 * invented name.
 */
function applyRealtimeBatch(batch: RealtimeEvent<unknown>[]): void {
  const meId = currentMeId()
  const actorByEntry = new Map<string, string | null>()

  for (const event of batch) {
    if (event.table !== 'entry_updates' || event.eventType !== 'INSERT' || !event.row) continue
    const row = event.row as EntryUpdate
    actorByEntry.set(row.entry_id, row.author_id)
  }

  // Stage every row against one snapshot, then re-derive ONCE. See `staged`.
  staged = useEntriesStore.getState()
  stagedDirty = false
  try {
    for (const event of batch) {
      if (event.table === 'entries') {
        if (event.eventType === 'DELETE') {
          if (event.oldId) removeEntryLocal(event.oldId)
          continue
        }
        if (!event.row) continue
        const row = event.row as Entry
        const actorId =
          event.eventType === 'INSERT' ? row.created_by : (actorByEntry.get(row.id) ?? null)
        // Never flash my own work back at me.
        const mark: FlashMark | undefined =
          actorId && actorId === meId
            ? undefined
            : {
                actorId,
                actorName: null,
                kind: event.eventType === 'INSERT' ? 'new' : 'edit',
                at: Date.now(),
              }
        applyServerRow(row, 'realtime', mark)
        continue
      }

      if (event.table === 'entry_updates' && event.eventType === 'INSERT' && event.row) {
        applyServerUpdate(event.row as EntryUpdate, 'realtime')
      }
    }
  } finally {
    // `finally`, because one malformed row must not leave the store staged — every
    // later commit in the session would then fold into a snapshot nothing reads.
    const next = staged
    const dirty = stagedDirty
    staged = null
    stagedDirty = false
    if (next && dirty) {
      commit(next.byId, next.serverHealth, {
        updates: next.updates,
        pending: next.pending,
        flash: next.flash,
      })
    }
  }
}

// ── focus refetch ──────────────────────────────────────────────────────────

// A second device (or the SQL editor) can change entries while this tab sits in
// the background, so returning to the tab is the natural moment to re-check.
// Gated on STALE_AFTER_MS: alt-tabbing between two windows fires focus
// constantly and a request per switch is not worth it. Guarded on `window`
// because this module is imported by node-environment tests.
if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => {
    const { coverage } = useEntriesStore.getState()
    if (coverage.loadedAt === null || Date.now() - coverage.loadedAt > STALE_AFTER_MS) {
      void loadEntries(true)
    }
  })
}
