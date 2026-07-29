// The app's single realtime channel.
//
// Lives in api/, not lib/, because it imports api/supabase. The layering rule
// (lib/** imports nothing from store/** or api/**) is enforced by a standing
// grep, and one exception defeats the grep.
//
// POLICY, FROZEN — every line of it is a bug that was going to happen:
//
// ONE CHANNEL for the whole app. A channel per entry or per screen means 60
// subscriptions on a board and a reconnect storm on every route change.
//
// BATCHED, NEVER FLUSHED INSIDE THE SUPABASE CALLBACK. Events land in a
// Map<`${table}:${id}`, RealtimeEvent> where a later event REPLACES an earlier
// one for the same row; the map flushes on a 120 ms trailing debounce with a
// 500 ms hard cap. A meeting bulk-commit of 20 rows then produces one setState,
// not twenty re-renders of every list on screen.
//
// THIS MODULE KNOWS NOTHING ABOUT STORES. `api → store` is not an allowed
// direction, so the plan's "on reconnect, call refreshEntries()" is inverted
// into onRealtimeResync(): realtime says WHAT HAPPENED, and store/entries.ts —
// which may import api/ — decides what to do about it. Same behaviour, right
// way round, and it keeps this file testable and free of the app's data model.
//
// RECONNECT: postgres_changes has NO REPLAY. Any SUBSCRIBED that follows a
// CLOSED or CHANNEL_ERROR means rows changed while we were not listening, and so
// does returning to a tab that was hidden longer than RESYNC_AFTER_HIDDEN_MS.
// Both emit a resync. Status reads `degraded` while disconnected and surfaces in
// the existing .offline-banner.
//
// GUARD: `if (!supabase) return` at the top of startRealtime(). A
// credential-less build must still boot.

import { useSyncExternalStore } from 'react'
import { supabase } from './supabase'
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js'

export type RealtimeStatus = 'idle' | 'connecting' | 'live' | 'degraded' | 'error'
export type RealtimeTable = 'entries' | 'entry_updates' | 'meeting_lines' | 'notifications'

export interface RealtimeEvent<T> {
  table: RealtimeTable
  eventType: 'INSERT' | 'UPDATE' | 'DELETE'
  /** Null on DELETE — postgres_changes sends only the primary key. */
  row: T | null
  oldId: string | null
}

export const CHANNEL_NAME = 'opstrack-live'

/**
 * Every table on the channel. Adding one here is the whole change: a table that
 * is not in the `supabase_realtime` publication simply never fires, which is why
 * meeting_lines and notifications can be listed before 0004 has run anywhere.
 */
const TABLES: readonly RealtimeTable[] = ['entries', 'entry_updates', 'meeting_lines', 'notifications']

/** Trailing debounce: long enough to coalesce a bulk commit, short enough to feel live. */
const DEBOUNCE_MS = 120
/** Hard cap, so a steady drip of events can never starve the flush. */
const MAX_WAIT_MS = 500
/** A tab hidden longer than this has certainly missed something. */
const RESYNC_AFTER_HIDDEN_MS = 60_000

type BatchHandler = (batch: RealtimeEvent<unknown>[]) => void
type Unsubscribe = () => void

const tableHandlers = new Map<RealtimeTable, Set<BatchHandler>>()
const batchHandlers = new Set<BatchHandler>()
const resyncHandlers = new Set<() => void>()
const statusListeners = new Set<() => void>()

let channel: RealtimeChannel | null = null
let status: RealtimeStatus = 'idle'
/** True once the channel has dropped, so the NEXT SUBSCRIBED is a reconnect. */
let missedEvents = false
let hiddenSince = 0

// ── status ─────────────────────────────────────────────────────────────────

function setStatus(next: RealtimeStatus): void {
  if (status === next) return
  status = next
  for (const l of statusListeners) l()
}

function subscribeStatus(fn: () => void): Unsubscribe {
  statusListeners.add(fn)
  return () => {
    statusListeners.delete(fn)
  }
}

function getStatus(): RealtimeStatus {
  return status
}

export function useRealtimeStatus(): RealtimeStatus {
  return useSyncExternalStore(subscribeStatus, getStatus, getStatus)
}

// ── batching ───────────────────────────────────────────────────────────────

/**
 * The coalescing buffer. Keyed `${table}:${id}` so three edits to one row while
 * the debounce is open collapse to the last one — which is also the correct one,
 * since postgres_changes always carries the whole new row.
 */
const pending = new Map<string, RealtimeEvent<unknown>>()
let flushTimer: ReturnType<typeof setTimeout> | null = null
let firstQueuedAt = 0

function rowId(row: unknown): string | null {
  if (typeof row !== 'object' || row === null) return null
  const id = (row as { id?: unknown }).id
  return typeof id === 'string' ? id : null
}

function queue(table: RealtimeTable, payload: RealtimePostgresChangesPayload<Record<string, unknown>>): void {
  const eventType = payload.eventType
  if (eventType !== 'INSERT' && eventType !== 'UPDATE' && eventType !== 'DELETE') return

  const newRow = eventType === 'DELETE' ? null : (payload.new as unknown)
  const oldId = rowId(payload.old)
  const id = rowId(newRow) ?? oldId
  // No id means no identity, and an event we cannot key is an event we cannot
  // coalesce or apply. Dropping it is honest; a random key would silently
  // duplicate rows in every list.
  if (!id) return

  pending.set(`${table}:${id}`, { table, eventType, row: newRow, oldId })

  const now = Date.now()
  if (firstQueuedAt === 0) firstQueuedAt = now
  if (flushTimer !== null) clearTimeout(flushTimer)
  // Never longer than MAX_WAIT_MS after the first queued event, so a continuous
  // stream still lands twice a second instead of never.
  const wait = Math.max(0, Math.min(DEBOUNCE_MS, firstQueuedAt + MAX_WAIT_MS - now))
  flushTimer = setTimeout(flush, wait)
}

function flush(): void {
  flushTimer = null
  firstQueuedAt = 0
  if (pending.size === 0) return
  const batch = [...pending.values()]
  pending.clear()

  // Whole-batch handlers first, and they get everything: correlating an
  // `entries` UPDATE with the `entry_updates` INSERT that caused it — the only
  // way to name the person who made a change, since entries carries no actor
  // column — is impossible from a per-table slice.
  for (const handler of batchHandlers) safely(handler, batch)

  for (const [table, handlers] of tableHandlers) {
    if (handlers.size === 0) continue
    const slice = batch.filter((e) => e.table === table)
    if (slice.length === 0) continue
    for (const handler of handlers) safely(handler, slice)
  }
}

/**
 * One handler must not be able to kill the channel.
 *
 * These run on a socket callback path with nothing above them to catch: a throw
 * in a store's apply loop would otherwise leave the batch half-applied AND stop
 * every later batch, and the app would look connected while silently receiving
 * nothing.
 */
function safely(handler: BatchHandler, batch: RealtimeEvent<unknown>[]): void {
  try {
    handler(batch)
  } catch (err) {
    console.warn('[realtime] handler failed:', err)
  }
}

// ── subscriptions ──────────────────────────────────────────────────────────

/** Per-table batches. Returns its own unsubscribe. */
export function onRealtime<T>(
  table: RealtimeTable,
  handler: (batch: RealtimeEvent<T>[]) => void,
): Unsubscribe {
  const set = tableHandlers.get(table) ?? new Set<BatchHandler>()
  tableHandlers.set(table, set)
  const wrapped = handler as BatchHandler
  set.add(wrapped)
  return () => {
    set.delete(wrapped)
  }
}

/**
 * The whole coalesced batch, across every table, in one call.
 *
 * Beyond EXECUTION-PLAN §2.14's list, and it exists for one requirement in that
 * same paragraph: the actor of an `entries` UPDATE can only be read off a
 * matching `entry_updates` INSERT "in the same batch", which per-table delivery
 * has already thrown away.
 */
export function onRealtimeBatch(handler: BatchHandler): Unsubscribe {
  batchHandlers.add(handler)
  return () => {
    batchHandlers.delete(handler)
  }
}

/**
 * Fires when this client has certainly missed events: a reconnect, or a tab
 * that was hidden long enough for the socket to have been reaped.
 *
 * The listener's job is to refetch. This module cannot do that itself without
 * importing a store, which is the direction the layering rule forbids.
 */
export function onRealtimeResync(handler: () => void): Unsubscribe {
  resyncHandlers.add(handler)
  return () => {
    resyncHandlers.delete(handler)
  }
}

function emitResync(): void {
  for (const handler of resyncHandlers) {
    try {
      handler()
    } catch (err) {
      console.warn('[realtime] resync handler failed:', err)
    }
  }
}

// ── lifecycle ──────────────────────────────────────────────────────────────

function onVisibilityChange(): void {
  if (document.visibilityState === 'hidden') {
    hiddenSince = Date.now()
    return
  }
  const away = hiddenSince === 0 ? 0 : Date.now() - hiddenSince
  hiddenSince = 0
  if (away > RESYNC_AFTER_HIDDEN_MS) emitResync()
}

/** Idempotent. Called once from the Shell when a session exists. */
export function startRealtime(): void {
  if (!supabase || channel) return

  setStatus('connecting')
  const ch = supabase.channel(CHANNEL_NAME)
  for (const table of TABLES) {
    ch.on<Record<string, unknown>>(
      'postgres_changes',
      { event: '*', schema: 'public', table },
      (payload) => {
        queue(table, payload)
      },
    )
  }

  ch.subscribe((state) => {
    if (state === 'SUBSCRIBED') {
      setStatus('live')
      // postgres_changes has no replay, so anything that happened between the
      // drop and here is simply gone. A refetch is the only way to learn it.
      if (missedEvents) {
        missedEvents = false
        emitResync()
      }
      return
    }
    if (state === 'CHANNEL_ERROR') {
      missedEvents = true
      setStatus('error')
      return
    }
    if (state === 'TIMED_OUT' || state === 'CLOSED') {
      missedEvents = true
      setStatus('degraded')
    }
  })

  channel = ch
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange)
  }
}

/** Sign-out and Shell unmount. */
export function stopRealtime(): void {
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
  if (flushTimer !== null) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  // Anything still buffered belongs to the session being torn down. Delivering
  // it after sign-out would write the previous user's rows into the next user's
  // store.
  pending.clear()
  firstQueuedAt = 0
  hiddenSince = 0
  missedEvents = false

  if (channel && supabase) void supabase.removeChannel(channel)
  channel = null
  setStatus('idle')
}
