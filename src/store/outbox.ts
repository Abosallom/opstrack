// The write seam. Contracts rule 3: every write in the application funnels
// through submit(). store/entries.ts never calls api/entries.ts for a mutation;
// neither do notifications or meetings, and neither will templates or vocab.
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
// stops at the first failure. WAVE 4 ADDED, inside this file: localStorage
// persistence under `opstrack_outbox_v1`, exponential backoff, and the
// focus/online wiring moved out to main.tsx behind startOutboxSync(). The
// envelope shape was frozen in Wave 1 and did not have to change.
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
//
// ── WHAT WAVE 4 ACTUALLY ADDED, and why each piece is not optional ─────────
//
// PERSISTENCE under `opstrack_outbox_v1`, through lib/cache.ts. Until this
// landed, `fail('offline.queued')` — rendered to the user as "saved on this
// device" — was false: the queue lived in a module-scope zustand store and a
// reload, a crash or iOS evicting a backgrounded WKWebView destroyed every
// unsent write silently. A promise the app cannot keep is worse than an error.
//
// TEMP IDS ARE RESOLVED INTO THE STORED QUEUE, not into a Map that lives for
// one drain. The per-drain map was correct only while the create and its
// dependents drained together; one transient failure in between and the
// dependent's `dependsOn: ['temp_…']` could never be satisfied again, so every
// subsequent flush stamped it 'offline.syncFailed' forever. Resolving into the
// queue also means the mapping is persisted with it, so it survives a reload.
//
// REMOVAL IS REVISION-AWARE. `enqueue()` collapses onto an item's ID, so an
// edit made while that item was in flight inherited the id and the in-flight
// `removeItem(itemId)` deleted the NEWER, never-sent payload — silent write
// loss, with the caller told 'offline.queued'. Every item carries a `revision`
// that a collapse bumps, and the drain only removes what it actually sent.
//
// BACKOFF AND FLUSH TRIGGERS live in `startOutboxSync()`, called by main.tsx.
// The `online` event alone left a queue that failed on a 500 parked until the
// device next transitioned offline→online — which, on a desktop that never
// leaves wifi, is never.

import { create } from 'zustand'
import {
  addUpdate,
  createEntry,
  updateEntry,
  type EntryPatch,
  type NewEntry,
  type NewEntryUpdate,
} from '../api/entries'
import {
  appendLine,
  createMeeting,
  patchLine,
  patchMeeting,
  type MeetingLinePatch,
  type MeetingPatch,
  type NewMeeting,
  type NewMeetingLine,
} from '../api/meetings'
import { markAllRead, markRead } from '../api/notifications'
import { fail, type ApiResult } from '../api/result'
import { supabase } from '../api/supabase'
import { isDurable, readCache, removeCache, writeCache } from '../lib/cache'

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
  /**
   * Bumped every time `enqueue()` collapses a newer op onto this item.
   *
   * The drain reads it before sending and re-checks it after, because a collapse
   * keeps the item's ID: without this the drain's `removeItem(id)` deleted a
   * payload that had replaced the one it sent, and the newer write vanished with
   * no error anywhere. Identity of the op object would work in one tab, but this
   * survives the localStorage round-trip and is inspectable in devtools.
   */
  revision: number
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
 * Deliberately covers only the routes something actually submits. `MutTable`
 * names three more tables because the envelope is frozen for waves 2–4, but
 * registering transports nothing calls would be dead code today and, worse, a
 * SECOND write path for tracks and vocab — whose admin screens call api/
 * directly and predate this seam. The wave that moves those screens onto
 * submit() adds their rows here, in one place, with the registry as the
 * checklist.
 *
 * THE REGISTRY AND main.tsx's WIRING ARE ONE CHANGE. A store whose submit seam
 * is pointed here without its routes registered fails every write with
 * 'common.error'; routes registered without the seam pointed here are dead code
 * and the store keeps sending directly, so it can never queue. The meetings
 * rows below shipped in the wrong order once and cost meeting mode its entire
 * offline story — `outbox.test.ts` now asserts both halves off the source, so
 * the next store to grow a seam cannot repeat it.
 */
const TRANSPORTS: Readonly<Record<string, Transport>> = {
  'entries:insert': (op) => createEntry(op.payload as NewEntry),
  'entries:update': (op) =>
    // An update with no target is a caller bug, and sending '' would reach
    // Postgres as a malformed uuid (22P02) — a confusing way to learn it.
    op.id ? updateEntry(op.id, op.payload as EntryPatch) : Promise.resolve(fail('common.error')),
  'entry_updates:insert': (op) => addUpdate(op.payload as NewEntryUpdate),
  // Meetings mint every uuid on the client (see api/meetings.ts's header), so
  // these four carry no temp id and nothing here has to be rewritten on drain:
  // a meeting queued offline already has the id its lines point at, and the
  // queue drains in insertion order so the header lands before them.
  'meetings:insert': (op) => createMeeting(op.payload as NewMeeting),
  'meetings:update': (op) =>
    op.id ? patchMeeting(op.id, op.payload as MeetingPatch) : Promise.resolve(fail('common.error')),
  'meeting_lines:insert': (op) => appendLine(op.payload as NewMeetingLine),
  'meeting_lines:update': (op) =>
    op.id ? patchLine(op.id, op.payload as MeetingLinePatch) : Promise.resolve(fail('common.error')),
  // `op.id === null` means the whole inbox and a row id means that one row —
  // two op shapes distinguished by a field the envelope already has, which is
  // what makes mark-all one op whatever the unread count is.
  'notifications:update': (op) => (op.id === null ? markAllRead() : markRead([op.id])),
}

/**
 * The registered routes, for the coverage test. Exported rather than inferred,
 * because the assertion it feeds is the thing that keeps this table honest.
 */
export const OUTBOX_ROUTES: readonly string[] = Object.freeze(Object.keys(TRANSPORTS))

/** Run one op against its transport. Never throws; failures come back as keys. */
async function send(op: MutOp): Promise<ApiResult<unknown>> {
  const route = `${op.table}:${op.op}`
  const transport = TRANSPORTS[route]
  if (!transport) {
    console.warn('[outbox] no transport for', route)
    return fail('common.error')
  }
  try {
    const result = await transport(op)
    // The drain's "never throws" contract covers a transport that answers with
    // something that is not an ApiResult at all, not only one that rejects: a
    // `result.ok` on undefined throws out of drain(), rejects the promise
    // flushOutbox() handed every caller, and the ones that said `void
    // flushOutbox()` — the online listener, the visibility handler, the retry
    // timer — turn it into an unhandled rejection.
    if (typeof result !== 'object' || result === null || typeof result.ok !== 'boolean') {
      console.warn('[outbox] transport did not answer with an ApiResult:', route)
      return fail('common.error')
    }
    return result
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

/**
 * The persisted queue. Versioned in the key, per lib/cache.ts's convention: a
 * shape change bumps the suffix and the old key is simply never read again,
 * which is the whole migration story for data that is at most a few days old.
 */
const OUTBOX_KEY = 'nphiescore_outbox_v1'

const MUT_TABLES: ReadonlySet<string> = new Set<MutTable>([
  'entries',
  'entry_updates',
  'meetings',
  'meeting_lines',
  'recurring_templates',
  'vocab_options',
  'tracks',
  'notifications',
])

const MUT_OPS: ReadonlySet<string> = new Set(['insert', 'update', 'delete'])

function isStringOrNull(v: unknown): v is string | null {
  return v === null || typeof v === 'string'
}

/** Reject anything that is not exactly an op envelope. See readCache's note. */
function acceptOp(v: unknown): MutOp | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  if (typeof o.table !== 'string' || !MUT_TABLES.has(o.table)) return null
  if (typeof o.op !== 'string' || !MUT_OPS.has(o.op)) return null
  if (!isStringOrNull(o.id) || !isStringOrNull(o.tempId)) return null
  if (typeof o.dedupeKey !== 'string') return null
  if (!Array.isArray(o.dependsOn) || o.dependsOn.some((d) => typeof d !== 'string')) return null
  return {
    table: o.table as MutTable,
    op: o.op as MutOp['op'],
    id: o.id,
    tempId: o.tempId,
    payload: o.payload,
    dedupeKey: o.dedupeKey,
    dependsOn: o.dependsOn as string[],
  }
}

/**
 * Validate a rehydrated queue, dropping only the items that are unusable.
 *
 * ONE BAD ITEM MUST NOT DISCARD THE REST. The realistic corruption is a single
 * op written by a previous version of this file, and throwing the whole array
 * away over it would lose every other write the user is owed. An item that
 * cannot be replayed is dropped with a warning rather than kept, because a
 * malformed envelope reaches Postgres as a 22P02 and parks the drain forever.
 */
interface PersistedOutbox {
  /**
   * The `auth.uid()` these writes will be attributed to, or null if the queue
   * was built before the session was known.
   *
   * THE QUEUE IS NOT A CACHE, and this is where that stops being a slogan. A
   * cached roster shown to the wrong account is a privacy bug you can see; a
   * QUEUED WRITE replayed under the wrong account is content authored by one
   * person and posted as another, with `created_by = auth.uid()` making it
   * indistinguishable from the real thing. App.tsx's sign-out effect already
   * calls resetOutbox() for exactly this reason ("worst of all queued writes
   * that would leave under the new session's credentials") — but a tab CLOSED
   * with unsent writes never runs that cleanup, and persistence is what turned
   * that from impossible into likely on a shared machine.
   */
  owner: string | null
  items: OutboxItem[]
}

function acceptQueue(value: unknown): PersistedOutbox | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const env = value as Record<string, unknown>
  if (!isStringOrNull(env.owner) || !Array.isArray(env.items)) return null
  return { owner: env.owner, items: acceptItems(env.items) }
}

function acceptItems(value: unknown[]): OutboxItem[] {
  const out: OutboxItem[] = []
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) continue
    const r = raw as Record<string, unknown>
    const op = acceptOp(r.op)
    if (!op || typeof r.id !== 'string' || !isStringOrNull(r.error)) {
      console.warn('[outbox] dropping an unreadable queued item')
      continue
    }
    out.push({
      id: r.id,
      op,
      attempts: typeof r.attempts === 'number' ? r.attempts : 0,
      queuedAt: typeof r.queuedAt === 'number' ? r.queuedAt : Date.now(),
      error: r.error,
      revision: typeof r.revision === 'number' ? r.revision : 0,
    })
  }
  return out
}

// Rehydrate at module load rather than from a wiring call: a component reading
// `usePendingCount()` during the first render must not see 0 and then flicker.
const restored = readCache(OUTBOX_KEY, acceptQueue)

/** Who the queue currently on disk belongs to. See PersistedOutbox.owner. */
let queueOwner: string | null = restored?.owner ?? null

const useOutboxStore = create<OutboxState>(() => ({
  items: restored?.items ?? [],
  pending: restored?.items.length ?? 0,
}))

/**
 * Every write of `items` goes through here, so `pending` cannot drift from it
 * and so nothing can change the queue without persisting the change.
 */
function setItems(items: OutboxItem[]): void {
  useOutboxStore.setState({ items, pending: items.length })
  writeCache(OUTBOX_KEY, { owner: queueOwner, items } satisfies PersistedOutbox)
}

// ── whose writes are these ─────────────────────────────────────────────────

/**
 * The signed-in user's id, synchronously, exactly as store/entries.ts caches it
 * and for the same reason: store/auth.ts exposes a hook and `hasSession()`, and
 * neither can be read from inside a drain. Same source one layer lower — it is
 * the id `auth.uid()` will be for every op this queue sends.
 */
let sessionUserId: string | null = null
/** False until the stored session has been read once. Not the same as "null". */
let sessionKnown = false

if (supabase) {
  void supabase.auth.getSession().then(({ data }) => {
    sessionUserId = data.session?.user.id ?? null
    sessionKnown = true
    // A queue restored from disk cannot be sent until this moment, so this is
    // the flush that actually delivers a reload's worth of unsent writes.
    void flushOutbox()
  })
  // Synchronous body ON PURPOSE: supabase-js serialises auth work behind a lock
  // and awaiting a client call inside this callback deadlocks it. Reading a
  // field off the session and scheduling a flush needs neither.
  supabase.auth.onAuthStateChange((_event, session) => {
    sessionUserId = session?.user.id ?? null
    sessionKnown = true
    void flushOutbox()
  })
} else {
  // No credentials configured (tests, `?shell`). There is no account to confuse
  // the queue with, so the owner check is vacuous rather than blocking.
  sessionKnown = true
}

/**
 * May this queue be sent under the session that is signed in right now?
 *
 * Three answers, and the middle one is the one worth having: YES when the queue
 * has no owner or the owner is the current user; NO-AND-WAIT while the session
 * is still being restored or nobody is signed in, because a 401 would burn an
 * attempt and back the queue off for no reason; and NO-AND-DROP for a different
 * account, which is a foreign queue this device must never send.
 */
function ownerAllowsSend(): boolean {
  if (queueOwner === null) return true
  if (!sessionKnown || sessionUserId === null) return false
  if (sessionUserId === queueOwner) return true
  console.warn('[outbox] discarding a queue belonging to a different account')
  resetOutbox()
  return false
}

/**
 * Warn once when "saved on this device" is not true.
 *
 * Safari's private mode and a full quota both leave lib/cache.ts on its
 * in-memory fallback, where the queue survives a route change but not a reload.
 * The caller still gets 'offline.queued' — the write IS held, and refusing to
 * queue would be strictly worse — but the console says so, because this is the
 * one condition under which the notice over-promises.
 */
let warnedVolatile = false

function warnIfVolatile(): void {
  if (warnedVolatile || isDurable()) return
  warnedVolatile = true
  console.warn('[outbox] storage is not durable — queued writes will not survive a reload')
}

/**
 * Add an op to the queue, collapsing it onto an equivalent one already waiting.
 *
 * The collapse KEEPS THE ORIGINAL POSITION rather than moving the op to the
 * back. Position is the only ordering information a Wave-1 queue has, and an
 * edit that jumped the queue past the create it depends on would invert the one
 * relationship `dependsOn` exists to preserve.
 *
 * It also keeps the original ID, which is what makes the `revision` bump
 * load-bearing: the drain holds an id across an `await`, and without a revision
 * it could not tell "the op I sent" from "an op that replaced it while I was
 * sending". See OutboxItem.revision.
 */
function enqueue(op: MutOp): void {
  warnIfVolatile()
  // Stamp the queue with whoever is writing it. Only ever set from null or to
  // the same id: a queue that reached a different account was dropped by
  // ownerAllowsSend() before it could get here.
  if (sessionUserId !== null) queueOwner = sessionUserId
  const items = useOutboxStore.getState().items
  const at = items.findIndex((item) => item.op.dedupeKey === op.dedupeKey)
  const item: OutboxItem = {
    id: crypto.randomUUID(),
    op,
    attempts: 0,
    queuedAt: Date.now(),
    error: null,
    revision: 0,
  }
  if (at === -1) setItems([...items, item])
  else
    setItems(
      items.map((existing, i) =>
        i === at ? { ...item, id: existing.id, revision: existing.revision + 1 } : existing,
      ),
    )
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
/**
 * `pgErrorKey`'s answer for a request that never reached Postgres. Spelled once
 * here so the queueing rule and the mapping cannot drift apart.
 */
const NETWORK_KEY = 'common.errNetwork'

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
  const result = (await send(op)) as ApiResult<T>

  // ⚠ `navigator.onLine` SAID YES AND THE SERVER WAS STILL UNREACHABLE.
  //
  //   That flag reports a live network INTERFACE, not a reachable server, so it
  //   is true on hotel wifi that swallows the request, behind a captive portal,
  //   during a Supabase outage, and on a train. Every one of those took the
  //   branch below `isOffline()`, failed at `send()`, and handed the caller an
  //   error — which rolled the optimistic row back and lost what the reader had
  //   typed. The queue existed and was never offered the write.
  //
  //   So the network is now decided by what the REQUEST did, not by what the
  //   browser predicted: a send that never reached Postgres is queued on
  //   exactly the terms an offline send is, and answers with the same NOTICE.
  //   `offline.queued` is not an error and callers already know not to roll back
  //   on it.
  //
  //   Narrow on purpose, and the narrowing lives in ONE place: `pgErrorKey`
  //   answers `common.errNetwork` only when there is no SQLSTATE at all, so a
  //   refusal, a constraint or a missing table still fails as itself. Queueing a
  //   write Postgres has already REJECTED would retry it forever, which is the
  //   fault the retry comments in this file warn about.
  if (!result.ok && result.error === NETWORK_KEY) {
    enqueue(op)
    return fail('offline.queued') as ApiResult<T>
  }
  return result
}

/**
 * Take custody of a status-transition row whose own request failed.
 *
 * FIX-BACKLOG R1-DB-2. `api/entries.updateEntry()` is two requests: the PATCH on
 * `entries`, then a separate insert of the `entry_updates` row that records the
 * transition. The second one used to be allowed to vanish with a `console.warn`,
 * and 0004:604-612 had traded the narrow `entries_update` policy away for
 * exactly that record. This is where it goes instead; `main.tsx` points
 * `setOrphanedTransitionSink()` here.
 *
 * NOT `submit()`. submit() queues only when `navigator.onLine` is false, and the
 * whole point of this path is the case where it is TRUE — a live but flaky link,
 * a 5xx, a request killed by a closed tab. `enqueue()` directly, then ask for a
 * flush.
 *
 * A FRESH `tempId` PER CALL, and it is the dedupe key that needs it. The
 * convention is `${table}:${op}:${id ?? tempId}:${sortedPayloadKeys}`, and an
 * `entry_updates:insert` has no `op.id` — so two different transitions, on two
 * different entries, would produce the identical key and the second would
 * COLLAPSE onto the first and be lost. That is the failure this function exists
 * to prevent, reintroduced one layer down.
 *
 * `dependsOn` is empty because the parent entry demonstrably exists: the PATCH
 * that produced this transition already succeeded against a real row id.
 */
export function queueOrphanedTransition(row: NewEntryUpdate): void {
  const tempId = TEMP_PREFIX + crypto.randomUUID()
  enqueue({
    table: 'entry_updates',
    op: 'insert',
    id: null,
    tempId,
    payload: row,
    dedupeKey: `entry_updates:insert:${tempId}:${Object.keys(row).sort().join(',')}`,
    dependsOn: [],
  })
  // Ask for a drain. Inside a drain this is a no-op (`flushing` is set) and
  // flushOutbox()'s own `finally` schedules the next pass; outside one it is the
  // only thing that will ever send this row, since no connectivity event is
  // coming — the link never went down.
  scheduleRetry()
}

// ── queue reads ────────────────────────────────────────────────────────────

// STILL UNRENDERED, and saying so here rather than in a comment that reads like
// a description of live behaviour. The strings exist (offline.pending,
// offline.syncFailed, offline.retry, offline.outbox, offline.discardTitle), the
// class exists (`.offline-banner-count` in app-shell.css), and both hooks below
// have zero call sites — components/OfflineBanner.tsx renders `navigator.onLine`
// and nothing else. So a user with a stranded write sees no count, no list and
// no retry button, while the queue does now retry on its own. Wiring the banner
// is the remaining half of FIX-BACKLOG's "the queue is entirely unsurfaced".

export function useOutbox(): OutboxItem[] {
  return useOutboxStore((s) => s.items)
}

/** Intended for `.offline-banner-count`. Not yet rendered — see above. */
export function usePendingCount(): number {
  return useOutboxStore((s) => s.pending)
}

/** Non-React read, for tests and for the flush wiring. */
export function getOutboxSnapshot(): readonly OutboxItem[] {
  return useOutboxStore.getState().items
}

// ── draining ───────────────────────────────────────────────────────────────

// ── the settle seam ────────────────────────────────────────────────────────

/** What a store is told when one of its queued writes lands. */
export type OutboxSettleFn = (op: MutOp, data: unknown) => void

let settleFn: OutboxSettleFn | null = null

/**
 * What a store is told when one of its queued writes leaves WITHOUT being sent.
 *
 * The mirror of OutboxSettleFn, and it exists for the same reason: the caller
 * applied an optimistic row and handed the write to this queue, and every path
 * out of the queue has to say which way it went. Until this existed there was
 * only the success half — `discardOutboxItem()` deleted the item and told
 * nobody, so `store/entries.ts` kept the row marked `pending` for the life of
 * the tab (patchEntry deliberately does NOT retire a queued write; see its
 * comment at the QUEUED_KEY branch). A `pending` row survives every refetch
 * (mergeOpenFetch preserves it verbatim) and refuses every realtime row
 * (acceptsServerRow), so one Discard froze one row at the value the user had
 * just thrown away, with a permanent "Queued" pill and no way back short of
 * reloading the tab.
 *
 * `op` is the op as it stood in the queue, so the receiving store can find its
 * optimistic row by `op.tempId` (an insert) or `op.id` (an update).
 */
export type OutboxDiscardFn = (op: MutOp) => void

let discardFn: OutboxDiscardFn | null = null

/**
 * Register the callback that puts a drained write back into its store.
 *
 * A queue that sends a write and never tells anybody is only half a queue: the
 * optimistic row the caller applied is still sitting there stamped "queued",
 * with a client-minted temp id, and the real row arrives separately on the next
 * fetch — so a successfully flushed offline capture rendered TWICE, for the life
 * of the tab.
 *
 * A callback rather than an import because the direction is fixed: stores call
 * into the outbox, never the other way round. main.tsx installs it, next to the
 * two submit seams, for the same reason those are resolved there.
 */
export function setOutboxSettle(fn: OutboxSettleFn | null): void {
  settleFn = fn
}

/**
 * Register the callback that unwinds a write this queue threw away.
 *
 * Same seam, same direction, same wiring line in main.tsx as setOutboxSettle().
 * Kept as a SECOND callback rather than an outcome flag on the first, because
 * the two carry different arguments — a settle hands over the server's row and
 * a discard has no row to hand — and a settle handler that had to branch on
 * `data === undefined` is exactly how the swap gets forgotten.
 */
export function setOutboxDiscard(fn: OutboxDiscardFn | null): void {
  discardFn = fn
}

/**
 * Tell the owning store an op left unsent. Never throws, for drain()'s reason:
 * a store's handler is code this file does not own.
 */
function announceDiscard(op: MutOp): void {
  if (!discardFn) return
  try {
    discardFn(op)
  } catch (e) {
    console.warn('[outbox] discard settle threw:', e)
  }
}

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
 * update pointing at the row the create actually produced. THE REWRITE GOES
 * INTO THE STORED QUEUE, not into a Map scoped to this drain: an op that missed
 * its create's drain — one transient 500 between the two is enough — would
 * otherwise hold `dependsOn: ['temp_…']` for ever, be stamped
 * 'offline.syncFailed' on every later flush, and never be sendable again even
 * though the row it points at exists on the server.
 *
 * An op still waiting on a temp id that no queued insert can mint any more (the
 * user discarded the create) is marked and skipped: nothing in the queue will
 * ever resolve it, so retrying it is spinning.
 */
export function flushOutbox(): Promise<void> {
  if (flushing) return flushing
  cancelRetry()
  flushing = drain().finally(() => {
    flushing = null
    scheduleRetry()
  })
  return flushing
}

async function drain(): Promise<void> {
  // Nothing leaves under the wrong credentials, and nothing leaves before the
  // stored session has been read. This runs first because it is the one check
  // whose failure mode is a wrong write rather than a missing one.
  if (!ownerAllowsSend()) return

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

    // Already resolved into the stored op by whichever drain landed the insert,
    // so this is the op as it will be sent.
    const op = item.op
    // A target or dependency still holding a temp id cannot be sent, and no
    // queued insert will ever mint it — resolveTempId() rewrites the queue the
    // instant one does. Mark it and move on rather than spin.
    if ((op.id !== null && isTempId(op.id)) || op.dependsOn.some(isTempId)) {
      patchItem(itemId, { error: 'offline.syncFailed' })
      continue
    }

    const sentRevision = item.revision
    const result = await send(op)
    if (result.ok) {
      // Before removal, so a dependent queued mid-drain is rewritten too.
      if (op.tempId) {
        const real = serverIdOf(result.data)
        if (real) resolveTempId(op.tempId, real)
      }
      // Revision-aware: a collapse that landed on this id while the request was
      // out replaced the payload with one that has NOT been sent. Removing by id
      // would delete it, and the user was told it was saved. Left in place, it
      // keeps its position and goes out on the pass flushOutbox() schedules.
      removeIfUnchanged(itemId, sentRevision)
      // Hand the row back to whoever queued it. Wrapped, because this file's
      // contract is that a drain never throws, and a store's settle is code the
      // outbox does not own — one bad row must not strand the rest of the queue.
      if (settleFn) {
        try {
          settleFn(op, result.data)
        } catch (e) {
          console.warn('[outbox] settle threw:', e)
        }
      }
      continue
    }

    patchItem(itemId, { error: result.error, attempts: item.attempts + 1 })
    return
  }
}

/**
 * An insert landed: replace its temp id everywhere in the QUEUE, permanently.
 *
 * Not a drain-local map. The pair this exists for — capture offline, then post a
 * note on it — is only guaranteed to drain together in the happy path, and the
 * unhappy path is the one that matters: the create lands, the note hits one
 * transient failure, and from that moment a per-drain map has nothing to say
 * about `temp_…`. Writing the real id into the stored ops means the queue is
 * self-consistent no matter how many flushes, reloads or days it takes.
 *
 * The dedupeKey is rewritten too, by substring: it embeds the target id
 * (`entries:update:temp_a:title`), so leaving it alone would stop a later edit
 * of the same field from collapsing onto the queued one and send two writes
 * where the user made one edit.
 */
function resolveTempId(tempId: string, realId: string): void {
  const map = new Map([[tempId, realId]])
  let changed = false
  const next = useOutboxStore.getState().items.map((item) => {
    const op = rewrite(item.op, map)
    if (op === item.op) return item
    changed = true
    return { ...item, op }
  })
  if (changed) setItems(next)
}

/**
 * Substitute any temp id this drain has already resolved — in the target, in the
 * dependency list, AND inside the payload.
 *
 * The payload half is not optional. `entry_updates:insert` carries its parent in
 * `payload.entryId` and has no `op.id` at all, so a create+update pair queued
 * offline passed the temp-id guard on its resolved `dependsOn` and then went out
 * with `entryId: 'temp_…'` in the body — which reaches Postgres as a malformed
 * uuid (22P02) and loses the update. That is the exact trap the temp-id rewrite
 * exists to close, and closing it only in the envelope closed half of it.
 *
 * Generic rather than per-table on purpose: temp ids are minted by this module
 * and only ever appear where a row id belongs, so "a string value that is a
 * resolved temp id" is unambiguous wherever it turns up, and the next table to
 * queue a write gets the behaviour for free. `tempId` itself is deliberately
 * left alone — it is how the settle path finds the optimistic row.
 *
 * RETURNS THE SAME OBJECT when nothing matched, so resolveTempId() can tell a
 * rewritten queue from an untouched one by identity and skip the write.
 */
function rewrite(op: MutOp, resolved: ReadonlyMap<string, string>): MutOp {
  const id = op.id !== null ? (resolved.get(op.id) ?? op.id) : null
  const dependsOn = op.dependsOn.map((dep) => resolved.get(dep) ?? dep)
  const payload = rewritePayload(op.payload, resolved)
  const dedupeKey = rewriteKey(op.dedupeKey, resolved)
  if (
    id === op.id &&
    payload === op.payload &&
    dedupeKey === op.dedupeKey &&
    dependsOn.every((dep, i) => dep === op.dependsOn[i])
  ) {
    return op
  }
  return { ...op, id, dependsOn, payload, dedupeKey }
}

/**
 * The dedupeKey embeds the target id by convention
 * (`${table}:${op}:${id ?? tempId}:${keys}`), so it is a substring substitution
 * rather than a lookup. Safe because a temp id is `temp_` + a uuid: it cannot
 * occur inside a table name, an op name or a sorted key list by accident.
 */
function rewriteKey(key: string, resolved: ReadonlyMap<string, string>): string {
  let out = key
  for (const [temp, real] of resolved) {
    if (out.includes(temp)) out = out.split(temp).join(real)
  }
  return out
}

function rewritePayload(payload: unknown, resolved: ReadonlyMap<string, string>): unknown {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return payload
  const entries = Object.entries(payload as Record<string, unknown>)
  let changed = false
  const next: Record<string, unknown> = {}
  for (const [key, value] of entries) {
    const real = typeof value === 'string' ? resolved.get(value) : undefined
    if (real !== undefined) changed = true
    next[key] = real ?? value
  }
  return changed ? next : payload
}

function patchItem(id: string, patch: Partial<OutboxItem>): void {
  setItems(useOutboxStore.getState().items.map((i) => (i.id === id ? { ...i, ...patch } : i)))
}

function removeItem(id: string): void {
  setItems(useOutboxStore.getState().items.filter((i) => i.id !== id))
}

/**
 * Remove an item only if it still holds the revision that was sent.
 *
 * Returns false when the item was superseded mid-flight, which is not an error:
 * the newer payload is queued, unsent, and must stay that way.
 */
function removeIfUnchanged(id: string, revision: number): boolean {
  const item = useOutboxStore.getState().items.find((i) => i.id === id)
  if (!item) return true
  if (item.revision !== revision) return false
  removeItem(id)
  return true
}

/**
 * Drop one op the user gave up on, and tell the store that queued it.
 *
 * The announcement is the whole point. "The optimistic row is the caller's
 * problem" was the old contract and there was no caller to hear it: the only
 * call site is OutboxSheet's Discard, which knows nothing about entries. See
 * OutboxDiscardFn for what the silence cost.
 */
export function discardOutboxItem(id: string): void {
  const item = useOutboxStore.getState().items.find((i) => i.id === id)
  if (!item) return
  removeItem(id)
  announceDiscard(item.op)
}

/**
 * Cancel an insert that has not been sent yet, and everything queued behind it.
 *
 * WHAT THIS IS FOR: the capture toast's Undo. Undoing an offline capture used to
 * remove only the local row, leaving the `entries:insert` op in the queue — so
 * the entry the user had just been told was "Undone" was created on the server
 * the moment the network came back, and the realtime echo of that insert put it
 * straight back on screen. `settleCreate()` early-returns for a row that is gone
 * and its comment names this case, but suppressing the local swap is not the
 * same as cancelling the write.
 *
 * DEPENDENTS GO TOO, and matching on `dependsOn` is necessary rather than
 * defensive: `postUpdate()` queues a thread note against a temp row with
 * `dependsOn: [tempId]`, and `patchEntry()` queues an update with `op.id` set to
 * the temp id. Left behind, both are unsendable for ever — drain() stamps them
 * 'offline.syncFailed' on every pass because no queued insert can mint that id
 * any more. They are announced like any other discard, so the store unwinds
 * their optimistic rows too.
 *
 * Returns how many ops were cancelled, for the test and for the caller that
 * wants to know whether there was anything to cancel.
 */
export function discardOpsForTempId(tempId: string): number {
  const items = useOutboxStore.getState().items
  const doomed = items.filter(
    (i) => i.op.tempId === tempId || i.op.id === tempId || i.op.dependsOn.includes(tempId),
  )
  if (doomed.length === 0) return 0
  // Remove them ALL before announcing any: a store handler that reads the queue
  // back (or triggers a flush) must never see a half-cancelled create.
  const doomedIds = new Set(doomed.map((i) => i.id))
  setItems(items.filter((i) => !doomedIds.has(i.id)))
  for (const item of doomed) announceDiscard(item.op)
  return doomed.length
}

/** Sign-out. Another account's queued writes must never leave on this session. */
export function resetOutbox(): void {
  cancelRetry()
  queueOwner = null
  setItems([])
  // setItems has already written `[]`; this drops the key entirely, including
  // from lib/cache.ts's in-memory fallback, so nothing of one account's queue
  // is left on the device for the next one.
  removeCache(OUTBOX_KEY)
}

// ── retry and flush triggers ───────────────────────────────────────────────

/**
 * Backoff bounds. 2s is short enough that a blip is invisible; 60s is long
 * enough that a server that is genuinely down is not hammered by every open tab
 * in the building. Both are wall-clock, not per-op: the drain stops at the first
 * failure, so there is only ever one op being retried.
 */
const RETRY_BASE_MS = 2_000
const RETRY_MAX_MS = 60_000
/**
 * How many times the TIMER will try a row before it waits for a person.
 *
 * Eight, with the capped backoff above, is a little over six minutes of trying —
 * long enough to cover a lift, a tunnel, a router reboot or a Supabase blip, and
 * short enough that a permanently refused row stops asking the same question
 * every minute for the life of the tab. It bounds the timer, never the queue.
 */
const MAX_AUTO_ATTEMPTS = 8

let retryTimer: ReturnType<typeof setTimeout> | null = null

/**
 * True once startOutboxSync() has run.
 *
 * Nothing schedules a timer before then, which keeps the queue inert in tests
 * and in `?shell` — a module-scope timer that outlives a test file is how a
 * suite starts hanging for reasons nobody can find.
 */
let syncInstalled = false

function cancelRetry(): void {
  if (retryTimer === null) return
  clearTimeout(retryTimer)
  retryTimer = null
}

/**
 * Schedule the next attempt, backing off on the failure count the queue itself
 * records. `attempts` was incremented and never read until this existed, which
 * is why a single 500 parked the whole queue until the device next transitioned
 * offline→online.
 *
 * NOTHING IS EVER DROPPED, and that rule is unchanged: a queue that gives up
 * silently is the failure this whole file exists to avoid. What stops after
 * `MAX_AUTO_ATTEMPTS` is only the TIMER.
 *
 * ⚠ WHY THE TIMER HAD TO STOP. The comment here used to say retrying never
 *   stops, on the grounds that there is nothing better to do with a write the
 *   user was told was saved. That is right for a flaky link and wrong for a
 *   refusal: a write RLS will never accept — someone else's row, a permission
 *   removed while it sat queued, a table a migration has not created — cannot
 *   succeed on the thousandth attempt any more than the second. It retried at
 *   the capped minute forever, showing the reader an error it would never clear,
 *   and burning a request a minute per stuck row for as long as the tab lived.
 *
 *   After the cap the item STAYS IN THE QUEUE, keeps its error, and keeps being
 *   counted by `offline.syncFailed` — so it is still visible and still the
 *   reader's to decide about. It just stops asking on its own.
 *
 * TWO WAYS BACK, both already built: the `online` / `visibilitychange` triggers
 * call `flushOutbox()` directly, and the banner's own "Retry now" button does
 * the same. Neither consults this function, so a reader who fixed the cause is
 * one press from trying again — and a genuine reconnection retries without one.
 */
function scheduleRetry(): void {
  if (!syncInstalled || retryTimer !== null || flushing) return
  const items = useOutboxStore.getState().items
  if (items.length === 0 || isOffline()) return
  // A queue where every row has exhausted its automatic attempts is waiting on a
  // person, not on a timer.
  if (items.every((i) => i.attempts >= MAX_AUTO_ATTEMPTS)) return
  const attempts = items.reduce((max, i) => Math.max(max, i.attempts), 0)
  const delay = Math.min(RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1), RETRY_MAX_MS)
  retryTimer = setTimeout(() => {
    retryTimer = null
    void flushOutbox()
  }, delay)
}

/**
 * Install every flush trigger. Called by main.tsx; returns its own teardown.
 *
 * THREE TRIGGERS, because each covers a case the others cannot:
 *   `online`          — the network came back. The only one Wave 1 had.
 *   `visibilitychange`— the tab was foregrounded. A phone that slept through the
 *                       outage never fires `online`, because it was never told
 *                       it went offline; it just wakes up connected.
 *   the backoff timer — the failure was the SERVER, not the link. No connectivity
 *                       event will ever fire, and without this the queue sits
 *                       there with the user told their work is saved.
 *
 * Wired from the composition root rather than at module scope so that importing
 * this store from a node test does not install listeners or timers — the reason
 * the Wave-1 note gave for keeping the `online` listener here no longer holds
 * now that the queue is rehydrated from storage instead of being born empty.
 */
export function startOutboxSync(): () => void {
  if (typeof window === 'undefined') return () => {}
  syncInstalled = true
  const onOnline = (): void => {
    void flushOutbox()
  }
  const onVisible = (): void => {
    if (document.visibilityState === 'visible') void flushOutbox()
  }
  window.addEventListener('online', onOnline)
  document.addEventListener('visibilitychange', onVisible)
  // Drain whatever survived the last session, without waiting for an event that
  // may never come: a reload with a queue in localStorage is the common case.
  void flushOutbox()
  return () => {
    syncInstalled = false
    cancelRetry()
    window.removeEventListener('online', onOnline)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
