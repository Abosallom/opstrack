// Data access for tracks — the admin Track Manager's entire backend surface.
//
// ERRORS HERE ARE i18n KEYS, NOT SENTENCES. On failure these functions return
// `pgErrorKey(error)` (e.g. 'admin.tracks.errNameTaken'), so every caller must
// render it as `t(result.error)`. Toasting `result.error` raw would print a dot
// path at the user. This differs from entries.ts, which still returns raw
// Postgres English; tracks.ts is the pattern to copy from here on, because these
// screens are the ones an Arabic-only admin will actually operate.
//
// No new server-side authorization is needed: tracks already has is_admin()
// gated insert/update/delete policies from 0001, so a member calling any of
// these gets 42501 and the UI shows admin.errForbidden.

import { supabase } from './supabase'
import { fail, notConfigured, type ApiResult } from './result'
import { pgErrorKey } from '../lib/pgError'
import type { Track, TrackInput, TrackUsage } from '../types'

/** The id of the signed-in user, or null when the session has gone. */
async function currentUserId(): Promise<string | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getUser()
  return data.user?.id ?? null
}

/** Ordered for display. Archived tracks are hidden unless explicitly asked for. */
export async function listTracks(includeArchived = false): Promise<ApiResult<Track[]>> {
  if (!supabase) return notConfigured()
  let query = supabase
    .from('tracks')
    .select('*')
    .order('sort_order', { ascending: true })
    // Ties are possible: sort_order defaults to 0 and reorder_tracks only
    // rewrites the ids it was handed. Without a stable second key the list
    // silently reshuffles between loads, which reads as data loss.
    .order('name', { ascending: true })
  if (!includeArchived) query = query.eq('archived', false)
  const { data, error } = await query
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: (data ?? []) as Track[] }
}

/**
 * Where a newly created track lands. Computed client-side rather than left to
 * the column default, because every new track defaulting to sort_order 0 would
 * pile them all at the top of the list in reverse creation order.
 */
async function nextSortOrder(): Promise<number> {
  if (!supabase) return 0
  const { data } = await supabase
    .from('tracks')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  const row = data as { sort_order: number } | null
  return (row?.sort_order ?? 0) + 1
}

export async function createTrack(input: TrackInput): Promise<ApiResult<Track>> {
  if (!supabase) return notConfigured()
  const name = input.name.trim()
  if (!name) return fail('common.error')

  const userId = await currentUserId()
  if (!userId) return fail('common.notSignedIn')

  const row = {
    name,
    name_ar: input.nameAr.trim(),
    description: input.description.trim(),
    description_ar: input.descriptionAr.trim(),
    color: input.color,
    color_light: input.colorLight,
    icon: input.icon,
    sort_order: await nextSortOrder(),
    created_by: userId,
  }

  const { data, error } = await supabase.from('tracks').insert(row).select('*').single()
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: data as Track }
}

/** Patch a track. Undefined keys are left untouched, exactly like updateEntry. */
export async function updateTrack(
  id: string,
  input: Partial<TrackInput>,
): Promise<ApiResult<Track>> {
  if (!supabase) return notConfigured()

  const row: Record<string, unknown> = {}
  if (input.name !== undefined) row.name = input.name.trim()
  if (input.nameAr !== undefined) row.name_ar = input.nameAr.trim()
  if (input.description !== undefined) row.description = input.description.trim()
  if (input.descriptionAr !== undefined) row.description_ar = input.descriptionAr.trim()
  if (input.color !== undefined) row.color = input.color
  if (input.colorLight !== undefined) row.color_light = input.colorLight
  if (input.icon !== undefined) row.icon = input.icon

  // A no-op PATCH would come back with zero rows and .single() would then error
  // out on a request that did nothing wrong. Read the row back instead.
  if (Object.keys(row).length === 0) {
    const { data, error } = await supabase.from('tracks').select('*').eq('id', id).single()
    if (error) return fail(pgErrorKey(error))
    return { ok: true, data: data as Track }
  }

  const { data, error } = await supabase
    .from('tracks')
    .update(row)
    .eq('id', id)
    .select('*')
    .single()
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: data as Track }
}

/**
 * Rewrite sort_order for the given ids, in array order, returning how many rows
 * moved. An RPC rather than N PATCHes: a half-applied reorder leaves duplicate
 * positions behind, and only a single statement is atomic under PostgREST.
 *
 * `security invoker` on the SQL side — the function needs atomicity, not
 * privilege, so RLS still rejects a member exactly as if they had run the
 * update by hand.
 */
export async function reorderTracks(ids: string[]): Promise<ApiResult<number>> {
  if (!supabase) return notConfigured()
  if (ids.length === 0) return { ok: true, data: 0 }
  const { data, error } = await supabase.rpc('reorder_tracks', { p_ids: ids })
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: typeof data === 'number' ? data : ids.length }
}

/**
 * Archive or restore. Only `archived` is written — archived_at is maintained by
 * the tracks_touch() trigger in both directions, so setting it here would fight
 * the trigger and lose.
 *
 * Archiving the last active track raises 23514 (tracks_keep_one_active), which
 * surfaces as admin.tracks.errLastTrack.
 */
export async function setTrackArchived(id: string, archived: boolean): Promise<ApiResult<Track>> {
  if (!supabase) return notConfigured()
  const { data, error } = await supabase
    .from('tracks')
    .update({ archived })
    .eq('id', id)
    .select('*')
    .single()
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: data as Track }
}

/** One head-only count. PostgREST returns the count in the header, no rows. */
async function countReferencing(table: string, trackId: string): Promise<number> {
  if (!supabase) return 0
  const { count, error } = await supabase
    .from(table)
    .select('id', { head: true, count: 'exact' })
    .eq('track_id', trackId)
  if (error) {
    console.warn(`[tracks] usage count failed for ${table}:`, error.message)
    return 0
  }
  return count ?? 0
}

/**
 * How many rows still point at this track, for the delete confirmation.
 *
 * Three head-only requests rather than one RPC: the same numbers the delete
 * guard trigger computes, but readable by the UI before it commits to anything,
 * and reusing the existing select policies instead of adding a function.
 */
export async function getTrackUsage(id: string): Promise<ApiResult<TrackUsage>> {
  if (!supabase) return notConfigured()
  const [entries, meetings, templates] = await Promise.all([
    countReferencing('entries', id),
    countReferencing('meetings', id),
    countReferencing('recurring_templates', id),
  ])
  return { ok: true, data: { entries, meetings, templates } }
}

/**
 * Delete a track, optionally moving everything that points at it somewhere else
 * first. Both halves happen in one `security invoker` RPC so a failure cannot
 * leave rows reassigned to a track that then survives.
 *
 * Passing no destination is the honest "this track is empty" path: if it turns
 * out not to be, tracks_block_delete_when_referenced() raises 23503 and the
 * caller gets admin.tracks.errInUse rather than silently orphaning rows —
 * every track_id FK is `on delete set null`.
 *
 * Resolves with the usage counted BEFORE the delete, because that is what the
 * caller wants to report ("moved 12 entries") and it does not exist afterwards.
 */
export async function deleteTrack(
  id: string,
  reassignTo?: string | null,
): Promise<ApiResult<TrackUsage>> {
  if (!supabase) return notConfigured()

  const before = await getTrackUsage(id)
  const moved: TrackUsage = before.ok ? before.data : { entries: 0, meetings: 0, templates: 0 }

  const { error } = await supabase.rpc('delete_track', {
    p_id: id,
    p_reassign_to: reassignTo ?? null,
  })
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: moved }
}
