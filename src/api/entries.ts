// Data access for entries and the update thread.
//
// Every function returns a discriminated ApiResult instead of throwing, and
// every one guards the nullable client first — a build without credentials has
// to degrade into a readable "not configured" message, not a stack trace. That
// convention now lives in ./result.ts, shared with api/tracks.ts; ApiResult is
// re-exported below so this module's existing importers keep working.
//
// Track reads and writes moved to api/tracks.ts when the Track Manager was
// built — including listTracks(), which used to live here.
//
// Wired up today:
//   healthCheck()          — the Settings › Account backend pill, so "Connected"
//                            means a round-trip actually succeeded rather than
//                            just "the env vars are present".
//   materializeRecurring() — called once per sign-in from store/auth.ts. This is
//                            the spec's RPC-on-load safety net for projects
//                            where pg_cron is unavailable.
//
// NOT wired up yet: everything from listEntries() down (entry list, detail, and
// the append-only update thread). That is the phase-2 surface, written against
// this schema in advance; no screen calls it, so changing it today cannot break
// the running app.

import { supabase } from './supabase'
import { fail, notConfigured } from './result'
import { t } from '../lib/i18n'
import type { ApiResult } from './result'
import type {
  Entry,
  EntryLink,
  EntryPriority,
  EntryStatus,
  EntryType,
  EntryUpdate,
} from '../types'

// Re-exported so `import type { ApiResult } from '../api/entries'` keeps
// resolving. Phase 2 lands a screenful of callers written against that path;
// forwarding one type is cheaper than a find-and-replace across them later.
export type { ApiResult }

/** The id of the signed-in user, or null when the session has gone. */
async function currentUserId(): Promise<string | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getUser()
  return data.user?.id ?? null
}

// ── health & recurrence ────────────────────────────────────────────────────

/**
 * Cheapest possible round-trip that proves credentials, network, RLS and the
 * schema all line up. `head: true` asks PostgREST for the count only, so this
 * stays a few hundred bytes even once tracks has rows.
 */
export async function healthCheck(): Promise<ApiResult<true>> {
  if (!supabase) return notConfigured()
  const { error } = await supabase.from('tracks').select('id', { head: true, count: 'exact' })
  if (error) return fail(error.message)
  return { ok: true, data: true }
}

/**
 * Create any recurring entries that have come due, returning how many were
 * inserted. pg_cron runs the same function nightly, but it is unavailable on
 * some Supabase tiers, so the app calls it on load as the actual safety net.
 * Running both is a no-op — the (template_id, due_date) unique index absorbs
 * the second pass.
 */
export async function materializeRecurring(): Promise<ApiResult<number>> {
  if (!supabase) return notConfigured()
  const { data, error } = await supabase.rpc('materialize_due_recurring')
  if (error) return fail(error.message)
  return { ok: true, data: typeof data === 'number' ? data : 0 }
}

// ── entries ────────────────────────────────────────────────────────────────

export interface EntryFilter {
  trackId?: string
  status?: EntryStatus[]
  /** Matches a registered teammate; free-text owners are filtered by name. */
  ownerId?: string
  ownerName?: string
  /** Exclude done and cancelled — the default view everywhere in the app. */
  openOnly?: boolean
  limit?: number
}

const CLOSED_STATUSES: EntryStatus[] = ['done', 'cancelled']

export async function listEntries(filter: EntryFilter = {}): Promise<ApiResult<Entry[]>> {
  if (!supabase) return notConfigured()
  let query = supabase
    .from('entries')
    .select('*')
    // Ordered by activity, not creation: the whole app is built around "what
    // has gone quiet", so the freshest thing belongs at the top of every list.
    .order('last_activity_at', { ascending: false })

  if (filter.trackId) query = query.eq('track_id', filter.trackId)
  if (filter.ownerId) query = query.eq('owner_id', filter.ownerId)
  if (filter.ownerName) query = query.eq('owner_name', filter.ownerName)
  if (filter.status?.length) query = query.in('status', filter.status)
  if (filter.openOnly) query = query.not('status', 'in', `(${CLOSED_STATUSES.join(',')})`)
  if (filter.limit) query = query.limit(filter.limit)

  const { data, error } = await query
  if (error) return fail(error.message)
  return { ok: true, data: (data ?? []) as Entry[] }
}

/** Resolves to `null` data when no such entry is visible to this user. */
export async function getEntry(id: string): Promise<ApiResult<Entry | null>> {
  if (!supabase) return notConfigured()
  const { data, error } = await supabase.from('entries').select('*').eq('id', id).maybeSingle()
  if (error) return fail(error.message)
  return { ok: true, data: (data as Entry | null) ?? null }
}

/**
 * Fields a caller may set when creating an entry. Only `title` is required —
 * capture must never be blocked on a missing field; everything else can be
 * filled in later from the entry sheet.
 */
export interface NewEntry {
  title: string
  trackId?: string | null
  description?: string | null
  type?: EntryType
  status?: EntryStatus
  priority?: EntryPriority
  ownerId?: string | null
  ownerName?: string | null
  requester?: string | null
  dueDate?: string | null
  followUpDate?: string | null
  tags?: string[]
  links?: EntryLink[]
  meetingId?: string | null
  templateId?: string | null
}

export async function createEntry(input: NewEntry): Promise<ApiResult<Entry>> {
  if (!supabase) return notConfigured()
  const title = input.title.trim()
  if (!title) return fail(t('common.error'))

  const userId = await currentUserId()
  if (!userId) return fail(t('common.notSignedIn'))

  const row = {
    title,
    track_id: input.trackId ?? null,
    description: input.description ?? null,
    type: input.type ?? 'action',
    status: input.status ?? 'new',
    priority: input.priority ?? 'medium',
    // An owner is either a teammate or free text, never both — writing both
    // would make every "who owns this" query ambiguous downstream.
    owner_id: input.ownerId ?? null,
    owner_name: input.ownerId ? null : (input.ownerName ?? null),
    requester: input.requester ?? null,
    due_date: input.dueDate ?? null,
    follow_up_date: input.followUpDate ?? null,
    tags: input.tags ?? [],
    links: input.links ?? [],
    meeting_id: input.meetingId ?? null,
    template_id: input.templateId ?? null,
    created_by: userId,
  }

  const { data, error } = await supabase.from('entries').insert(row).select('*').single()
  if (error) return fail(error.message)
  return { ok: true, data: data as Entry }
}

/** Fields an editor may change. Undefined keys are left untouched. */
export interface EntryPatch {
  title?: string
  description?: string | null
  type?: EntryType
  status?: EntryStatus
  priority?: EntryPriority
  ownerId?: string | null
  ownerName?: string | null
  requester?: string | null
  dueDate?: string | null
  followUpDate?: string | null
  tags?: string[]
  links?: EntryLink[]
  trackId?: string | null
}

/**
 * Patch an entry. When the status actually changes, an entry_updates row
 * recording the transition is appended automatically — the audit thread is the
 * only place status history exists, and a silent status flip is exactly the
 * kind of thing this app is meant to make impossible.
 *
 * The transition row is written here rather than by a database trigger so it
 * carries the acting user as author_id under the same RLS as a hand-typed
 * update. If a trigger is ever added for this, delete this branch — you would
 * otherwise get two rows per transition.
 */
export async function updateEntry(id: string, patch: EntryPatch): Promise<ApiResult<Entry>> {
  if (!supabase) return notConfigured()

  let previousStatus: EntryStatus | null = null
  if (patch.status) {
    const before = await getEntry(id)
    if (!before.ok) return before
    if (!before.data) return fail(t('common.error'))
    previousStatus = before.data.status
  }

  const row: Record<string, unknown> = {}
  if (patch.title !== undefined) row.title = patch.title.trim()
  if (patch.description !== undefined) row.description = patch.description
  if (patch.type !== undefined) row.type = patch.type
  if (patch.status !== undefined) row.status = patch.status
  if (patch.priority !== undefined) row.priority = patch.priority
  if (patch.requester !== undefined) row.requester = patch.requester
  if (patch.dueDate !== undefined) row.due_date = patch.dueDate
  if (patch.followUpDate !== undefined) row.follow_up_date = patch.followUpDate
  if (patch.tags !== undefined) row.tags = patch.tags
  if (patch.links !== undefined) row.links = patch.links
  if (patch.trackId !== undefined) row.track_id = patch.trackId
  // Assigning one side of the owner pair clears the other, so an entry never
  // shows two owners after being reassigned from a vendor to a teammate.
  if (patch.ownerId !== undefined) {
    row.owner_id = patch.ownerId
    if (patch.ownerId) row.owner_name = null
  }
  if (patch.ownerName !== undefined) {
    row.owner_name = patch.ownerName
    if (patch.ownerName) row.owner_id = null
  }

  const { data, error } = await supabase
    .from('entries')
    .update(row)
    .eq('id', id)
    .select('*')
    .single()
  if (error) return fail(error.message)

  if (patch.status && previousStatus && patch.status !== previousStatus) {
    // Best-effort: the entry edit already succeeded, and failing the whole call
    // because the audit line did not land would leave the caller thinking the
    // status change was rejected when it was not.
    await addUpdate({
      entryId: id,
      body: '',
      statusFrom: previousStatus,
      statusTo: patch.status,
    })
  }

  return { ok: true, data: data as Entry }
}

// ── update thread ──────────────────────────────────────────────────────────

export interface NewEntryUpdate {
  entryId: string
  body: string
  statusFrom?: EntryStatus | null
  statusTo?: EntryStatus | null
}

/**
 * Append to an entry's thread. entry_updates has no UPDATE or DELETE policy —
 * immutability is enforced by RLS, so there is deliberately no editUpdate() or
 * deleteUpdate() counterpart here. Corrections are appended, never applied.
 */
export async function addUpdate(input: NewEntryUpdate): Promise<ApiResult<EntryUpdate>> {
  if (!supabase) return notConfigured()
  const userId = await currentUserId()
  if (!userId) return fail(t('common.notSignedIn'))

  const { data, error } = await supabase
    .from('entry_updates')
    .insert({
      entry_id: input.entryId,
      author_id: userId,
      body: input.body.trim(),
      status_from: input.statusFrom ?? null,
      status_to: input.statusTo ?? null,
    })
    .select('*')
    .single()
  if (error) return fail(error.message)
  return { ok: true, data: data as EntryUpdate }
}

/** The thread for one entry, oldest first — it reads as a conversation. */
export async function listUpdates(entryId: string): Promise<ApiResult<EntryUpdate[]>> {
  if (!supabase) return notConfigured()
  const { data, error } = await supabase
    .from('entry_updates')
    .select('*')
    .eq('entry_id', entryId)
    .order('created_at', { ascending: true })
  if (error) return fail(error.message)
  return { ok: true, data: (data ?? []) as EntryUpdate[] }
}
