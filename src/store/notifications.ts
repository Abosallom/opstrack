// The notification inbox, cached and shared.
//
// Shaped like store/config.ts: narrow selectors, derived views computed once
// when data lands, never inside a selector. THE UNREAD COUNT IN PARTICULAR IS
// STORED, not counted per render — it renders in the app shell on every screen,
// so a `list.filter(…).length` in the selector would run on every keystroke
// anywhere in the app, and would return a new number-shaped snapshot each time.
//
// INDEPENDENT OF store/entries.ts by design. A notification names an entry that
// this client may never have loaded (a closed one, another track's), so the two
// stores share no state and neither loads the other. The inbox row carries its
// own entry title snapshot precisely so it can render alone.
//
// WRITES GO THROUGH THE SAME SEAM AS EVERY OTHER WRITE (contracts rule 3), which
// is why 'notifications' is a MutTable. store/outbox.ts is owned by another
// worker this wave, so the seam is an injection point — setNotificationsSubmit()
// swaps the transport in one line — rather than an import. Marking read while
// offline is low-stakes, but routing it around the seam would make it the one
// exception someone later copies.

import { create } from 'zustand'
import { listNotifications, markAllRead, markRead, toAppNotification } from '../api/notifications'
import { onRealtime } from '../api/realtime'
import { fail } from '../api/result'
import { supabase } from '../api/supabase'
import { t } from '../lib/i18n'
import { toast } from '../components/toast'
import type { NotificationRow } from '../api/notifications'
import type { MutOp } from './outbox'
import type { ApiResult } from '../api/result'
import type { AppNotification } from '../types'

/** Matches the entries store's focus gate; the bell is not more urgent than the list. */
const STALE_AFTER_MS = 45_000

interface NotificationsState {
  /** Newest first, exactly as the api returned it. */
  items: AppNotification[]
  /** Stored, not derived in a selector. See the header. */
  unread: number
  loading: boolean
  loadedAt: number | null
  /** An i18n KEY, never a sentence. */
  error: string | null
}

function countUnread(items: AppNotification[]): number {
  return items.reduce((n, item) => (item.readAt === null ? n + 1 : n), 0)
}

const useNotificationsStore = create<NotificationsState>(() => ({
  items: [],
  unread: 0,
  loading: false,
  loadedAt: null,
  error: null,
}))

/** Every write of `items` goes through here so `unread` cannot drift from it. */
function setItems(items: AppNotification[], rest: Partial<NotificationsState> = {}): void {
  useNotificationsStore.setState({ items, unread: countUnread(items), ...rest })
}

// ── the write seam ─────────────────────────────────────────────────────────

export type SubmitFn = <T>(op: MutOp) => Promise<ApiResult<T>>

/**
 * The default transport: send now.
 *
 * `op.id === null` means "the whole inbox" and a uuid means that one row. Two op
 * shapes distinguished by a field the envelope already has, rather than a magic
 * payload flag: mark-all is one op whatever the unread count is, which is what
 * makes it survive a queue-and-replay intact.
 */
async function directSubmit<T>(op: MutOp): Promise<ApiResult<T>> {
  if (op.table !== 'notifications' || op.op !== 'update') {
    console.warn('[notifications] no transport for', `${op.table}:${op.op}`)
    return fail('common.error')
  }
  const result = op.id === null ? await markAllRead() : await markRead([op.id])
  return result as ApiResult<T>
}

let submitFn: SubmitFn = directSubmit

/** Wave 4 calls setNotificationsSubmit(submit) once store/outbox.ts is live. */
export function setNotificationsSubmit(fn: SubmitFn | null): void {
  submitFn = fn ?? directSubmit
}

// ── selectors ──────────────────────────────────────────────────────────────

export function useNotifications(): AppNotification[] {
  return useNotificationsStore((s) => s.items)
}

/** Feeds the shell's bell badge. Stored, not derived in the selector. */
export function useUnreadCount(): number {
  return useNotificationsStore((s) => s.unread)
}

export function useNotificationsLoading(): boolean {
  return useNotificationsStore((s) => s.loading)
}

/** An i18n KEY. Render it as t(err), never as itself. */
export function useNotificationsError(): string | null {
  return useNotificationsStore((s) => s.error)
}

// ── loading ────────────────────────────────────────────────────────────────

let inFlight: Promise<void> | null = null

/**
 * Fetch the inbox unless a good copy is already in hand. Safe to call unawaited
 * and safe to call twice concurrently; never rejects.
 */
export function loadNotifications(force = false): Promise<void> {
  if (inFlight) return inFlight
  if (!force && useNotificationsStore.getState().loadedAt !== null) return Promise.resolve()

  if (useNotificationsStore.getState().items.length === 0) {
    useNotificationsStore.setState({ loading: true })
  }

  inFlight = listNotifications()
    .then((result) => {
      if (!result.ok) {
        // The table may simply not exist yet (0004 unapplied), and a bell that
        // breaks the shell over that is worse than a bell that shows nothing.
        console.warn('[notifications] load failed:', result.error)
        useNotificationsStore.setState({ error: result.error })
        return
      }
      setItems(result.data, { loadedAt: Date.now(), error: null })
    })
    .finally(() => {
      inFlight = null
      useNotificationsStore.setState({ loading: false })
    })

  return inFlight
}

// ── writes ─────────────────────────────────────────────────────────────────

function markLocally(ids: ReadonlySet<string>, readAt: string): AppNotification[] {
  return useNotificationsStore
    .getState()
    .items.map((item) => (ids.has(item.id) && item.readAt === null ? { ...item, readAt } : item))
}

/**
 * Optimistic, and it has to be: the badge is the whole point of the interaction,
 * so it must clear on tap rather than a round-trip later.
 *
 * On failure the SNAPSHOT is restored, not an inverse edit — the same rule
 * store/entries.ts follows, for the same reason: a second mark-read landing
 * between the failure and the restore would otherwise resurrect a row the user
 * already dealt with.
 */
export async function markNotificationsRead(ids: string[]): Promise<void> {
  const target = new Set(ids)
  const snapshot = useNotificationsStore.getState().items
  const unreadIds = snapshot.filter((n) => target.has(n.id) && n.readAt === null).map((n) => n.id)
  if (unreadIds.length === 0) return

  setItems(markLocally(target, new Date().toISOString()))

  // One op per row: the envelope carries a single target id, and inventing a
  // multi-id payload shape here would be a second convention for the outbox to
  // learn. The inbox marks one row on tap; mark-all has its own path below.
  const results = await Promise.all(
    unreadIds.map((id) =>
      submitFn<number>({
        table: 'notifications',
        op: 'update',
        id,
        tempId: null,
        payload: { readAt: true },
        dedupeKey: `notifications:update:${id}:readAt`,
        dependsOn: [],
      }),
    ),
  )

  const failure = results.find((r) => !r.ok && r.error !== 'offline.queued')
  if (failure && !failure.ok) {
    setItems(snapshot)
    toast(t(failure.error), { tone: 'error' })
  }
}

/** The "mark all as read" action. One op regardless of how many rows it clears. */
export async function markAllNotificationsRead(): Promise<void> {
  const snapshot = useNotificationsStore.getState().items
  if (snapshot.every((n) => n.readAt !== null)) return
  const all = new Set(snapshot.map((n) => n.id))

  setItems(markLocally(all, new Date().toISOString()))

  const result = await submitFn<number>({
    table: 'notifications',
    op: 'update',
    // null id = the whole inbox. See directSubmit().
    id: null,
    tempId: null,
    payload: { readAt: true },
    dedupeKey: 'notifications:update:all:readAt',
    dependsOn: [],
  })

  if (!result.ok && result.error !== 'offline.queued') {
    setItems(snapshot)
    toast(t(result.error), { tone: 'error' })
  }
}

// ── realtime ───────────────────────────────────────────────────────────────

/**
 * Who the inbox belongs to.
 *
 * Null until the session resolves, and the realtime filter below treats null as
 * "trust RLS" rather than "drop everything" — dropping would silently lose the
 * first notification of every session.
 */
let meId: string | null = null

if (supabase) {
  void supabase.auth.getSession().then(({ data }) => {
    meId = data.session?.user.id ?? null
  })
  // Synchronous body: awaiting a supabase call inside this callback deadlocks
  // the client's auth lock. store/auth.ts's header documents the trap.
  supabase.auth.onAuthStateChange((_event, session) => {
    meId = session?.user.id ?? null
  })
}

let realtimeOff: (() => void) | null = null

/**
 * Subscribe to the shared channel's `notifications` stream. IDEMPOTENT — the
 * Shell calls this on session adopt and an already-live subscription must not
 * become a second one — and it returns its own teardown.
 *
 * It rides api/realtime.ts's single channel rather than opening its own: one
 * channel for the whole app is the frozen policy, and a bell with its own socket
 * would double every reconnect storm.
 *
 * Only INSERTs are applied. An UPDATE on this table is a read-marking, which
 * this client either just did itself (already applied optimistically) or did on
 * another device, where a stale badge for a few seconds is not worth the
 * reconciliation.
 */
export function initNotificationsRealtime(): () => void {
  if (realtimeOff) return realtimeOff

  const off = onRealtime<NotificationRow>('notifications', (batch) => {
    const current = useNotificationsStore.getState()
    const byId = new Map(current.items.map((item) => [item.id, item]))
    let changed = false

    for (const event of batch) {
      if (event.eventType !== 'INSERT' || !event.row) continue
      const row = toAppNotification(event.row)
      // RLS already scopes the subscription to this recipient. Re-checking is
      // belt and braces for the one case RLS cannot cover: a stale socket that
      // outlived a user switch in the same tab.
      if (meId && row.recipientId !== meId) continue
      if (byId.has(row.id)) continue
      byId.set(row.id, row)
      changed = true
    }

    if (!changed) return
    const items = [...byId.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    setItems(items)
  })

  realtimeOff = () => {
    off()
    realtimeOff = null
  }
  return realtimeOff
}

/** Sign-out. The inbox is per-recipient; leaving it populated leaks it. */
export function resetNotifications(): void {
  inFlight = null
  setItems([], { loading: false, loadedAt: null, error: null })
}

// Returning to the tab is the natural moment to re-check the bell — a
// notification raised while this tab was backgrounded arrives over realtime only
// if the socket survived, and it often does not. Guarded on `window` because
// this module is importable from a node-environment test.
if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => {
    const { loadedAt } = useNotificationsStore.getState()
    if (loadedAt !== null && Date.now() - loadedAt > STALE_AFTER_MS) void loadNotifications(true)
  })
}
