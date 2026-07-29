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
import { fail } from '../api/result'
import { supabase } from '../api/supabase'
import { TEMP_PREFIX, isTempId } from './outbox'
import { useAuth } from './auth'
import { getVocabSnapshot, slaDays, staleDays } from './vocab'
import { CLOSED_STATUSES, computeHealth } from '../lib/health'
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
 *   (a) source === 'local'  — our own settled write; it always wins, because it
 *       IS the newest truth and its updated_at may equal what we already hold;
 *   (b) nothing local exists for this id;
 *   (c) nothing is pending for it AND the row is not older than what we hold.
 *
 * Case (c) is what drops the realtime echo of a write still in flight. Without
 * it the sequence is: optimistic edit renders, realtime delivers the pre-edit
 * row, the field visibly reverts, and then the settle puts it back — a flicker
 * the user reads as the app fighting them.
 */
export function acceptsServerRow(
  existing: Entry | undefined,
  incoming: Entry,
  source: ApplySource,
  isPending: boolean,
): boolean {
  if (source === 'local') return true
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
 * Recompute `list` and `health` from `byId`. Called on every write; never from a
 * selector.
 *
 * The health fallback loop runs ONLY for rows the view has not answered for, so
 * a normal loaded list does zero work here and makes zero calls into
 * store/vocab. Optimistic and offline rows do get a computed row, because a
 * follow-ups screen that ignores the item you just captured is not a follow-ups
 * screen.
 */
function derive(
  byId: Map<string, Entry>,
  serverHealth: Map<string, EntryHealth>,
): Pick<EntriesState, 'list' | 'health'> {
  const list = [...byId.values()].sort(byActivityDesc)

  const missing = list.filter((e) => !serverHealth.has(e.id) && !isClosed(e.status))
  if (missing.length === 0) return { list, health: serverHealth }

  const snapshot = getVocabSnapshot()
  const health = new Map(serverHealth)
  for (const entry of missing) {
    health.set(
      entry.id,
      computeHealth(entry, staleDays(snapshot, entry.priority), slaDays(snapshot, entry.priority)),
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
  return { openLoaded: false, closedSince: null, trackHistory: {}, loadedAt: null }
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
 * Every mutation of byId/serverHealth goes through here, so `list` and `health`
 * cannot drift from the rows they are derived from and the cache write cannot be
 * forgotten.
 */
function commit(byId: Map<string, Entry>, serverHealth: Map<string, EntryHealth>, rest: Partial<EntriesState> = {}): void {
  useEntriesStore.setState({ byId, serverHealth, ...derive(byId, serverHealth), ...rest })
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
function mergeOpenFetch(rows: Entry[], health: EntryHealth[] | null): void {
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
    coverage: { ...st.coverage, openLoaded: true, loadedAt: Date.now() },
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
      mergeOpenFetch(entries.data, health.ok ? health.data : null)
    })
    .finally(() => {
      inFlight = null
      useEntriesStore.setState({ loading: false })
    })

  return inFlight
}

/** Closed entries, on demand. Additive: it never prunes the open working set. */
export function loadClosedSince(since: IsoDate): Promise<void> {
  const st = useEntriesStore.getState()
  // Already covered by a wider window — asking again would re-download a month
  // of done items to learn nothing.
  if (st.coverage.closedSince !== null && st.coverage.closedSince <= since) return Promise.resolve()

  return listClosedSince(since).then((result) => {
    if (!result.ok) {
      console.warn('[entries] closed load failed:', result.error)
      return
    }
    const current = useEntriesStore.getState()
    const byId = new Map(current.byId)
    for (const row of result.data) {
      if (!current.pending.has(row.id)) byId.set(row.id, row)
    }
    commit(byId, current.serverHealth, {
      coverage: { ...current.coverage, closedSince: since },
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

export function refreshEntries(): Promise<void> {
  return loadEntries(true)
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
  const st = useEntriesStore.getState()
  const pending = new Map(st.pending)
  if (op) pending.set(id, op)
  else pending.delete(id)
  useEntriesStore.setState({ pending })
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
    const current = useEntriesStore.getState()
    const next = new Map(current.byId)
    next.delete(tempId)
    next.set(result.data.id, result.data)
    const pending = new Map(current.pending)
    pending.delete(tempId)
    commit(next, current.serverHealth, { pending })
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

  if (result.ok) {
    setPending(id, null)
    applyServerRow(result.data, 'local')
    return result
  }

  if (result.error === QUEUED_KEY) {
    markQueued(id)
    return result
  }

  // Restore the SNAPSHOT, not an inverse patch: an inverse drifts the moment two
  // edits overlap, and the second rollback then writes the first edit's value
  // back over a field the user never touched.
  const current = useEntriesStore.getState()
  const restored = new Map(current.byId).set(id, snapshot)
  const pending = new Map(current.pending)
  pending.delete(id)
  commit(restored, current.serverHealth, { pending })
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

  const result = await submitFn<EntryUpdate>({
    table: 'entry_updates',
    op: 'insert',
    id: null,
    tempId,
    payload: input,
    dedupeKey: dedupeKeyFor('entry_updates', 'insert', tempId, input),
    dependsOn: isTempId(entryId) ? [entryId] : [],
  })

  const current = useEntriesStore.getState()
  const thread = current.updates.get(entryId) ?? []
  const withoutTemp = thread.filter((u) => u.id !== tempId)

  if (result.ok) {
    setPending(entryId, null)
    useEntriesStore.setState({
      updates: new Map(current.updates).set(entryId, mergeUpdates(withoutTemp, [result.data])),
    })
    return result
  }

  if (result.error === QUEUED_KEY) {
    markQueued(entryId)
    return result
  }

  const pending = new Map(current.pending)
  pending.delete(entryId)
  const restored = parentBefore ? new Map(current.byId).set(entryId, parentBefore) : current.byId
  commit(restored, current.serverHealth, {
    updates: new Map(current.updates).set(entryId, withoutTemp),
    pending,
  })
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
 */
export async function undoCapture(id: string): Promise<ApiResult<null>> {
  if (isTempId(id)) {
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
  const st = useEntriesStore.getState()
  const existing = st.byId.get(row.id)
  if (!acceptsServerRow(existing, row, source, st.pending.has(row.id))) return

  if (source === 'local') localWrites.set(row.id, row.updated_at)

  const byId = new Map(st.byId).set(row.id, row)
  const rest: Partial<EntriesState> = {}

  const echoOfMine = localWrites.get(row.id) === row.updated_at
  if (echoOfMine && source !== 'local') localWrites.delete(row.id)

  if (actor && source !== 'local' && !echoOfMine) {
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
  const st = useEntriesStore.getState()
  const thread = st.updates.get(row.entry_id)
  // Only merge into a thread that is actually loaded. Seeding a one-row thread
  // for an entry nobody has opened would make loadUpdates() think it is done and
  // the sheet would render exactly that one row.
  const updates = thread ? new Map(st.updates).set(row.entry_id, mergeUpdates(thread, [row])) : st.updates
  const byId = touchEntry(st.byId, row.entry_id, row.created_at)
  if (updates === st.updates && byId === st.byId) return
  commit(byId, st.serverHealth, { updates })
}

export function removeEntryLocal(id: string): void {
  const st = useEntriesStore.getState()
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
