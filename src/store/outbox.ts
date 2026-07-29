// The write seam. Contracts rule 3: every write in the application funnels
// through submit(). store/entries.ts never calls api/entries.ts for a mutation;
// neither does notifications, and neither will meetings, templates or vocab.
// That is not tidiness — it is what makes the Wave-4 offline story a one-file
// change instead of surgery across a dozen modules that each grew their own
// retry.
//
// The op envelope is FROZEN, and it is frozen early on purpose: it has to carry
// everything needed to replay a write LATER, without the original caller still
// being around to explain it. If the envelope is wrong, Wave 4's mitigation
// evaporates — so it carries the target, the client-minted id, the collapse key
// and the ordering constraint from the first line of Wave-1 code, months before
// anything uses them.
//
// WHAT WAVE 1 SHIPS, precisely: online → straight to the transport; offline →
// queue, dedupe by collapse key, and answer `fail('offline.queued')`, which the
// caller renders as a neutral notice rather than an error. flushOutbox() drains
// in insertion order, rewriting temp ids as the inserts that mint them land, and
// stops at the first failure. WHAT WAVE 4 ADDS, inside this file only:
// localStorage persistence under `opstrack_outbox_v1`, exponential backoff, and
// the focus/online wiring moved out to main.tsx. Every signature below is
// already its final shape.
//
// WHY THE TEMP-ID REWRITE IS HERE AND NOT DEFERRED. A queue that can hold a
// create and a follow-up update on the same row, and cannot connect them, is a
// data-loss trap rather than an unfinished feature: the update would be sent
// against `temp_…`, reach Postgres as a malformed uuid, and be dropped. It is
// twenty lines, and without them the queue is worse than not queueing at all.
//
// TRANSPORT REGISTRY: a static `${MutTable}:${op}` table lives in this file and
// imports the api/* write functions directly. store → api is the allowed
// direction; api → store is not, which is exactly why the outbox lives in
// store/ and why src/api/mutate.ts does not exist.
//
// CONFLICT RULE (spec §6): last-write-wins on entry fields; updates never
// conflict, because the thread is append-only.

import { create } from 'zustand'
import {
  addUpdate,
  createEntry,
  updateEntry,
  type EntryPatch,
  type NewEntry,
  type NewEntryUpdate,
} from '../api/entries'
import { markAllRead, markRead } from '../api/notifications'
import { fail, type ApiResult } from '../api/result'

export type MutTable =
  | 'entries'
  | 'entry_updates'
  | 'meetings'
  | 'meeting_lines'
  | 'recurring_templates'
  | 'vocab_options'
  | 'tracks'
  | 'notifications'

export interface MutOp<P = unknown> {
  table: MutTable
  op: 'insert' | 'update' | 'delete'
  /** Target row id for update/delete; null for insert. */
  id: string | null
  /**
   * Client-minted id for an insert, so dependent ops can reference the row
   * before the server has replied. `TEMP_PREFIX + crypto.randomUUID()`.
   */
  tempId: string | null
  payload: P
  /**
   * Collapses repeated edits of the same target while queued — typing in a
   * description field offline must queue one op, not forty.
   * Convention: `${table}:${op}:${id ?? tempId}:${sortedPayloadKeys}`.
   */
  dedupeKey: string
  /** Temp ids that must land first (e.g. an update on a not-yet-created entry). */
  dependsOn: string[]
}

export interface OutboxItem {
  id: string
  op: MutOp
  attempts: number
  queuedAt: number
  /** i18n key of the last failure, or null. */
  error: string | null
}

/**
 * The marker that makes an optimistic row distinguishable from a server row
 * everywhere — lists, realtime echoes, dependency ordering, and the "don't
 * navigate to /entry/temp_… " guard.
 */
export const TEMP_PREFIX = 'temp_'

export function isTempId(id: string): boolean {
  return id.startsWith(TEMP_PREFIX)
}

// ── transport registry ─────────────────────────────────────────────────────

type Transport = (op: MutOp) => Promise<ApiResult<unknown>>

/**
 * `${table}:${op}` → the api function that performs it.
 *
 * Deliberately covers only the routes something actually submits in Wave 1.
 * `MutTable` names four more tables because the envelope is frozen for waves
 * 2–4, but registering transports nothing calls would be dead code today and,
 * worse, a SECOND write path for tracks and vocab — whose admin screens call
 * api/ directly and predate this seam. Wave 2 moves those screens onto submit()
 * and adds their rows here, in one place, with the registry as the checklist.
 */
const TRANSPORTS: Readonly<Record<string, Transport>> = {
  'entries:insert': (op) => createEntry(op.payload as NewEntry),
  'entries:update': (op) =>
    // An update with no target is a caller bug, and sending '' would reach
    // Postgres as a malformed uuid (22P02) — a confusing way to learn it.
    op.id ? updateEntry(op.id, op.payload as EntryPatch) : Promise.resolve(fail('common.error')),
  'entry_updates:insert': (op) => addUpdate(op.payload as NewEntryUpdate),
  // `op.id === null` means the whole inbox and a row id means that one row —
  // two op shapes distinguished by a field the envelope already has, which is
  // what makes mark-all one op whatever the unread count is.
  'notifications:update': (op) => (op.id === null ? markAllRead() : markRead([op.id])),
}

/** Run one op against its transport. Never throws; failures come back as keys. */
async function send(op: MutOp): Promise<ApiResult<unknown>> {
  const route = `${op.table}:${op.op}`
  const transport = TRANSPORTS[route]
  if (!transport) {
    console.warn('[outbox] no transport for', route)
    return fail('common.error')
  }
  try {
    return await transport(op)
  } catch (e) {
    // The api layer returns ApiResult and does not throw — but "does not throw"
    // is a convention, and submit()'s contract of never throwing is load-bearing
    // for every caller that does not try/catch. One net, here, rather than
    // sixteen at the call sites.
    console.warn('[outbox] transport threw:', e)
    return fail('common.error')
  }
}

// ── queue state ────────────────────────────────────────────────────────────

interface OutboxState {
  items: OutboxItem[]
  /** Stored, not counted in the selector: it renders shell-wide, on every route. */
  pending: number
}

const useOutboxStore = create<OutboxState>(() => ({ items: [], pending: 0 }))

/** Every write of `items` goes through here so `pending` cannot drift from it. */
function setItems(items: OutboxItem[]): void {
  useOutboxStore.setState({ items, pending: items.length })
}

/**
 * Add an op to the queue, collapsing it onto an equivalent one already waiting.
 *
 * The collapse KEEPS THE ORIGINAL POSITION rather than moving the op to the
 * back. Position is the only ordering information a Wave-1 queue has, and an
 * edit that jumped the queue past the create it depends on would invert the one
 * relationship `dependsOn` exists to preserve.
 */
function enqueue(op: MutOp): void {
  const items = useOutboxStore.getState().items
  const at = items.findIndex((item) => item.op.dedupeKey === op.dedupeKey)
  const item: OutboxItem = {
    id: crypto.randomUUID(),
    op,
    attempts: 0,
    queuedAt: Date.now(),
    error: null,
  }
  if (at === -1) setItems([...items, item])
  else setItems(items.map((existing, i) => (i === at ? { ...item, id: existing.id } : existing)))
}

/**
 * Whether the browser believes it can reach the network.
 *
 * `navigator.onLine` is famously optimistic — it reports true on a captive
 * portal — so it is used only in the direction it is RELIABLE: a false is
 * trustworthy, a true is not. Hence "offline → queue" and never "online →
 * assume success". A write that fails while `onLine` is true comes back as a
 * failure the caller can show, not as a silent queue entry the user never sees.
 */
function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

// ── the write path ─────────────────────────────────────────────────────────

/**
 * THE only write path. NEVER THROWS, and returns i18n KEYS on failure — a
 * caller that has to try/catch a write will eventually forget to.
 *
 * Offline answers `fail('offline.queued')`, which is a NOTICE, not an error: the
 * optimistic row the caller already applied stays on screen and the queue owns
 * it from here. Callers distinguish the two by comparing against that key; they
 * must not roll their optimistic state back on it.
 */
export async function submit<T>(op: MutOp): Promise<ApiResult<T>> {
  if (isOffline()) {
    enqueue(op)
    return fail('offline.queued') as ApiResult<T>
  }
  return (await send(op)) as ApiResult<T>
}

// ── queue reads ────────────────────────────────────────────────────────────

export function useOutbox(): OutboxItem[] {
  return useOutboxStore((s) => s.items)
}

/** Feeds `.offline-banner-count`, which already exists in app-shell.css. */
export function usePendingCount(): number {
  return useOutboxStore((s) => s.pending)
}

/** Non-React read, for tests and for Wave 4's flush wiring. */
export function getOutboxSnapshot(): readonly OutboxItem[] {
  return useOutboxStore.getState().items
}

// ── draining ───────────────────────────────────────────────────────────────

/** Pull the server's id off whatever a transport returned, or null. */
function serverIdOf(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null
  const id = (data as { id?: unknown }).id
  return typeof id === 'string' ? id : null
}

/** One flush at a time: two concurrent drains would send every op twice. */
let flushing: Promise<void> | null = null

/**
 * Send everything queued, oldest first, and stop at the first failure.
 *
 * STOPS rather than skips, because the realistic reason op #3 failed is that the
 * network went away again, and hammering ops #4–#20 against it burns the user's
 * battery to produce twenty identical errors. The failed op keeps its place and
 * its error; the next flush starts there.
 *
 * Temp ids are rewritten as the inserts that mint them succeed, so a
 * `create → update` pair queued offline lands in dependency order with the
 * update pointing at the row the create actually produced. An op still waiting
 * on an unresolved temp id is left alone — it can only become sendable after the
 * insert ahead of it lands, and that insert is the thing that just failed.
 */
export function flushOutbox(): Promise<void> {
  if (flushing) return flushing
  flushing = drain().finally(() => {
    flushing = null
  })
  return flushing
}

async function drain(): Promise<void> {
  /** temp id → the real id the server minted for it, within this drain. */
  const resolved = new Map<string, string>()

  // Clear last round's errors first, so a retry is a retry. Leaving them set
  // and then skipping errored items would quietly reorder the queue: a create
  // that failed once would sit still while the update depending on it went out.
  setItems(useOutboxStore.getState().items.map((i) => (i.error ? { ...i, error: null } : i)))

  // Iterate a snapshot of the ORDER, but re-read each item from the store: an
  // op discarded mid-drain must vanish, and an op queued mid-drain waits for the
  // next flush rather than being sent from a stale list.
  const order = useOutboxStore.getState().items.map((i) => i.id)

  for (const itemId of order) {
    if (isOffline()) return
    const item = useOutboxStore.getState().items.find((i) => i.id === itemId)
    if (!item) continue

    const op = rewrite(item.op, resolved)
    // A target or dependency still holding a temp id cannot be sent, and no
    // amount of retrying fixes it — the insert that would have resolved it is
    // the thing that just failed. Mark it and move on rather than spin.
    if ((op.id !== null && isTempId(op.id)) || op.dependsOn.some(isTempId)) {
      patchItem(itemId, { error: 'offline.syncFailed' })
      continue
    }

    const result = await send(op)
    if (result.ok) {
      if (item.op.tempId) {
        const real = serverIdOf(result.data)
        if (real) resolved.set(item.op.tempId, real)
      }
      removeItem(itemId)
      continue
    }

    patchItem(itemId, { error: result.error, attempts: item.attempts + 1 })
    return
  }
}

/** Substitute any temp id this drain has already resolved. */
function rewrite(op: MutOp, resolved: ReadonlyMap<string, string>): MutOp {
  const id = op.id !== null ? (resolved.get(op.id) ?? op.id) : null
  const dependsOn = op.dependsOn.map((dep) => resolved.get(dep) ?? dep)
  return { ...op, id, dependsOn }
}

function patchItem(id: string, patch: Partial<OutboxItem>): void {
  setItems(useOutboxStore.getState().items.map((i) => (i.id === id ? { ...i, ...patch } : i)))
}

function removeItem(id: string): void {
  setItems(useOutboxStore.getState().items.filter((i) => i.id !== id))
}

/** Drop one op the user gave up on. The optimistic row is the caller's problem. */
export function discardOutboxItem(id: string): void {
  removeItem(id)
}

/** Sign-out. Another account's queued writes must never leave on this session. */
export function resetOutbox(): void {
  setItems([])
}

/**
 * Retry the moment connectivity comes back.
 *
 * Installed here rather than in main.tsx because Wave 1's queue has no
 * persistence: it lives and dies with this module, so the listener that drains
 * it belongs in the same place. store/config.ts installs its focus listener at
 * module scope for the same reason. Wave 4 moves both this and an app-focus
 * flush into main.tsx once the queue survives a reload and the wiring has
 * something to reload it from.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    void flushOutbox()
  })
}
