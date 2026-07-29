// The notification inbox — reads, and marking read. Nothing here writes one.
//
// NOTIFICATIONS ARE WRITTEN BY DATABASE TRIGGERS, NEVER BY THIS FILE. 0004
// installs two: an entry becoming owned by someone notifies that owner, and an
// entry reaching `done` notifies its CREATOR — the person who asked for it,
// which is the notification anyone actually wants. Neither fires when the actor
// and the recipient are the same person, because being told you did the thing
// you just did is how a notification system gets muted on day two.
//
// Doing it in triggers rather than in the client is not a preference: the client
// that made the change is one of several (another tab, a second device, the
// recurrence RPC, a future edge function), and a notification that only exists
// when a particular screen happened to be open is worse than none.
//
// RLS restricts SELECT and UPDATE to `recipient_id = auth.uid()` and there is no
// client INSERT policy at all, so none of these functions takes a recipient:
// asking for someone else's inbox returns an empty list rather than an error,
// and this file must not pretend it could.
//
// Errors are i18n keys via pgErrorKey(), following api/tracks.ts.

import { supabase } from './supabase'
import { fail, notConfigured } from './result'
import { pgErrorKey } from '../lib/pgError'
import type { ApiResult } from './result'
import type { AppNotification, NotificationKind } from '../types'

/**
 * The `notifications` row as 0004 defines it. Declared here rather than in
 * types.ts because types.ts holds the rows the UI shares; this one is consumed
 * by exactly one mapper, three lines below.
 *
 * `entry_title` and `actor_name` are DENORMALIZED SNAPSHOTS written by the
 * trigger, not joins: an inbox row has to stay readable after the entry is
 * retitled or the actor's profile is deleted, and the alternative is every row
 * in the list triggering a lookup in a store the notification centre may not
 * have loaded.
 */
export interface NotificationRow {
  /**
   * A BIGINT IDENTITY in 0004, not a uuid like every other id in this schema —
   * verified against the live project, not assumed. PostgREST serialises int8 as
   * a JSON number, so this arrives as `number` while AppNotification.id is a
   * `string`; toAppNotification() is the single place that reconciles the two.
   * Getting this wrong is silent: `String(id)` and `id` compare unequal, so a
   * realtime insert would duplicate a row already in the list and the dedupe
   * would never fire.
   */
  id: number | string
  recipient_id: string
  kind: string
  entry_id: string
  /** `not null default ''` — the trigger writes '' rather than null when the
      entry has no title yet, so this is a string, never null. Verified against
      information_schema on the live project during the Wave-1 integration. */
  entry_title: string
  actor_id: string | null
  /** `not null default ''`, same as entry_title. Empty when the trigger could
      not resolve a display name; `actor_id` is the nullable one, because the
      profile it names really can be deleted (`on delete set null`). */
  actor_name: string
  read_at: string | null
  created_at: string
}

/** Default page size for the inbox. Deep history is not what a bell is for. */
const DEFAULT_LIMIT = 50

/**
 * Row → view model. Pure; exported because store/notifications.ts maps realtime
 * payloads with it too, and because it is the one place the snake_case/camelCase
 * boundary this app draws at the api layer is actually drawn for this table.
 *
 * `kind` is narrowed rather than cast: the column has a CHECK, but a row written
 * by a future trigger this build has never heard of must render as *something*
 * — 'assigned' is the safe default, since it is the kind whose sentence works
 * for any entry.
 */
export function toAppNotification(row: NotificationRow): AppNotification {
  const kind: NotificationKind = row.kind === 'completed' ? 'completed' : 'assigned'
  return {
    id: String(row.id),
    recipientId: row.recipient_id,
    kind,
    entryId: row.entry_id,
    entryTitle: row.entry_title,
    actorId: row.actor_id,
    actorName: row.actor_name,
    readAt: row.read_at,
    createdAt: row.created_at,
  }
}

/** The recipient's inbox, newest first. */
export async function listNotifications(opts?: {
  limit?: number
  unreadOnly?: boolean
}): Promise<ApiResult<AppNotification[]>> {
  if (!supabase) return notConfigured()
  let query = supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(opts?.limit ?? DEFAULT_LIMIT)
  if (opts?.unreadOnly) query = query.is('read_at', null)
  const { data, error } = await query
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: ((data ?? []) as NotificationRow[]).map(toAppNotification) }
}

/**
 * Mark specific rows read. Returns how many rows ACTUALLY changed.
 *
 * The `.is('read_at', null)` guard is what makes that number honest and makes
 * the call idempotent: re-marking an already-read row would otherwise move its
 * read_at forward and report work that did not happen. Two devices marking the
 * same notification is normal, not an error.
 */
export async function markRead(ids: string[]): Promise<ApiResult<number>> {
  if (!supabase) return notConfigured()
  if (ids.length === 0) return { ok: true, data: 0 }
  const { data, error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .in('id', ids)
    .is('read_at', null)
    .select('id')
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: (data ?? []).length }
}

/**
 * Mark the whole inbox read.
 *
 * No recipient filter, deliberately: RLS's UPDATE policy already scopes this to
 * `recipient_id = auth.uid()`, and adding a client-side `.eq('recipient_id', me)`
 * would be a second opinion that can only ever disagree with the server — the
 * same one-source-of-truth argument store/auth.ts makes about profiles.role.
 */
export async function markAllRead(): Promise<ApiResult<number>> {
  if (!supabase) return notConfigured()
  const { data, error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null)
    .select('id')
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: (data ?? []).length }
}
