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
import type { TrackSlaRule } from '../lib/health'
import type {
  EntryPriority,
  Track,
  TrackGroup,
  TrackGroupInput,
  TrackInput,
  TrackUsage,
} from '../types'

// Re-exported so a caller reaching for the row type has ONE import path for it,
// even though the definition lives in lib/health.ts (lib/** may not import from
// api/**, and health.ts is what consumes the shape — see its header).
export type { TrackSlaRule }

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

/**
 * Trim, drop blanks, dedupe — the shape `tracks.suggested_tags` is written in.
 *
 * `text[] not null default '{}'`, so an empty list is `[]` and never null. The
 * dedupe is plain string equality, not the fold-key dedupe TagsField applies:
 * this is the last line of defence against a duplicate reaching the column, and
 * folding here would silently rewrite a team's own spelling of a tag on save.
 */
function cleanTags(tags: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of tags) {
    const tag = raw.trim()
    if (tag === '' || seen.has(tag)) continue
    seen.add(tag)
    out.push(tag)
  }
  return out
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
    suggested_tags: cleanTags(input.suggestedTags),
    // Explicitly null rather than omitted, so the row this function sends is
    // the whole row it means. `undefined` would be dropped by the JSON
    // serialiser and the column default applied instead — the same answer
    // today, but silently, and only for as long as the default stays null.
    group_id: input.groupId ?? null,
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
  if (input.suggestedTags !== undefined) row.suggested_tags = cleanTags(input.suggestedTags)
  // `null` is a real instruction here — "take this track out of its group" —
  // and it is NOT the same as leaving the key off, which means "do not touch
  // the group". The `!== undefined` test is what keeps those two apart; a
  // truthiness test would silently turn every un-group into a no-op.
  if (input.groupId !== undefined) row.group_id = input.groupId

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

// ── SLA overrides (0006) ────────────────────────────────────────────────────
//
// The track half of the track × priority matrix. The workspace default lives in
// vocab_options and is edited in the vocabulary screen; these two functions edit
// only the overrides, and the resolution order — track row, then priority
// default, then no SLA — is lib/health.resolveSlaDays(), not something either
// screen re-implements.
//
// SLA is off until somebody arms it, and an ABSENT ROW is how a track says
// "inherit". There is no sentinel value and no zero: `sla_days` is `not null
// check between 1 and 3650`, so the only two states a (track, priority) cell can
// be in are "a row with a number" and "no row". That is why setTrackSla takes
// `days: number | null` and DELETES on null rather than writing something.

/**
 * Every override, or just one track's. Ordered so two loads of the same data
 * render in the same order — the pair is the primary key, so the ordering is
 * total and stable.
 *
 * A member may read this (RLS `track_slas_select` is `is_member()`): the numbers
 * are the workspace's stated commitments, not a secret from the people expected
 * to meet them, and every SLA badge on every list needs them.
 */
export async function listTrackSlas(trackId?: string): Promise<ApiResult<TrackSlaRule[]>> {
  if (!supabase) return notConfigured()
  let query = supabase
    .from('track_slas')
    .select('track_id, priority, sla_days')
    .order('track_id', { ascending: true })
    .order('priority', { ascending: true })
  if (trackId !== undefined) query = query.eq('track_id', trackId)
  const { data, error } = await query
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: (data ?? []) as TrackSlaRule[] }
}

/**
 * Set, change or clear one cell of the matrix.
 *
 * `days === null` clears the override so the track inherits again — a DELETE,
 * because "inherit" is the absence of a row. Deleting a row that was never there
 * is not an error and must not be reported as one: the editor saves whatever
 * changed since it loaded, and a cell the admin emptied and then emptied again
 * has to be a no-op, not a red banner.
 *
 * Otherwise an upsert on the composite key, so the caller never has to know
 * whether this track already had a number for this priority. Resolves with the
 * stored row, or null when the override was cleared.
 *
 * Range is enforced by the database (`track_slas_days_range`, 1–3650) and
 * surfaces as 23514 through pgErrorKey. The editor validates the same bounds
 * before calling so the common typo costs no round-trip, exactly as the hex
 * fields do — but the database is the authority and this function does not
 * duplicate the rule.
 */
export async function setTrackSla(
  trackId: string,
  priority: EntryPriority,
  days: number | null,
): Promise<ApiResult<TrackSlaRule | null>> {
  if (!supabase) return notConfigured()

  if (days === null) {
    const { error } = await supabase
      .from('track_slas')
      .delete()
      .eq('track_id', trackId)
      .eq('priority', priority)
    if (error) return fail(pgErrorKey(error))
    return { ok: true, data: null }
  }

  const { data, error } = await supabase
    .from('track_slas')
    .upsert({ track_id: trackId, priority, sla_days: days }, { onConflict: 'track_id,priority' })
    .select('track_id, priority, sla_days')
    .single()
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: data as TrackSlaRule }
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

// ── track groups (0018) ─────────────────────────────────────────────────────
//
// The level above tracks: Technical and Business. Four functions, deliberately
// the same four shapes as the track half above — list, create, patch, reorder —
// because a reader who has understood one has understood the other, and the
// admin screen that edits groups is the track screen with fewer fields.
//
// NO deleteGroup, and its absence is a decision rather than an omission.
// `tracks.group_id` is `on delete set null`, so a delete would silently ungroup
// every track under it and the screen would have to explain that BEFORE the
// click — the same reasoning that made deleteTrack take a reassignment target
// and count what it moved. Two groups that map to two halves of an org are not
// something anyone deletes casually, so the honest move is to ship no button
// until there is a flow behind it. Adding one later is an RPC and a
// confirmation, not a rewrite.
//
// Errors are i18n KEYS here too, per this file's header. Note that pgErrorKey()
// does not yet name this table's unique indexes — `track_groups_name_uidx` and
// `track_groups_name_ar_uidx` — so a duplicate group name currently falls
// through to `common.error`. That mapping belongs in src/lib/pgError.ts, which
// this module does not own; it is in the handoff.

/**
 * Every group, ordered for display.
 *
 * Readable by any member (RLS `track_groups_select` is `is_member()`), and that
 * is deliberate: groups are how two teams stay out of each other's way, and a
 * member who cannot read them gets an empty filter facet and a digest with no
 * sections — worse than shipping no grouping at all.
 *
 * There is no `includeArchived` counterpart to listTracks: groups have no
 * `archived` column. A group with nothing in it is already invisible on every
 * surface, because every group surface renders tracks and a group renders
 * nothing of its own.
 */
export async function listGroups(): Promise<ApiResult<TrackGroup[]>> {
  if (!supabase) return notConfigured()
  const { data, error } = await supabase
    .from('track_groups')
    .select('*')
    .order('sort_order', { ascending: true })
    // The same stable second key listTracks uses, for the same reason:
    // sort_order defaults to 0 and reorder_groups only rewrites the ids it was
    // handed, so without this two loads of the same data can render in
    // different orders — which reads as data loss, not as a sort.
    .order('name', { ascending: true })
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: (data ?? []) as TrackGroup[] }
}

/**
 * Where a newly created group lands. Computed client-side rather than left to
 * the column default, because every new group defaulting to sort_order 0 would
 * pile them at the top of the list in reverse creation order — nextSortOrder()
 * above, for the same reason.
 */
async function nextGroupSortOrder(): Promise<number> {
  if (!supabase) return 0
  const { data } = await supabase
    .from('track_groups')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  const row = data as { sort_order: number } | null
  return (row?.sort_order ?? 0) + 1
}

/**
 * '' means "no light-theme override" on the way in, NULL in the column.
 *
 * The database's `track_groups_color_light_chk` accepts null or a six-digit
 * hex and nothing else, so sending the empty string a cleared colour input
 * produces would be a 23514 on an action the admin performed correctly. This is
 * the one place that translates between the two, so no caller has to know.
 */
function toColorLight(value: string): string | null {
  const hex = value.trim()
  return hex === '' ? null : hex
}

export async function createGroup(input: TrackGroupInput): Promise<ApiResult<TrackGroup>> {
  if (!supabase) return notConfigured()
  const name = input.name.trim()
  if (!name) return fail('common.error')

  const userId = await currentUserId()
  if (!userId) return fail('common.notSignedIn')

  const row = {
    name,
    name_ar: input.nameAr.trim(),
    color: input.color,
    color_light: toColorLight(input.colorLight),
    sort_order: await nextGroupSortOrder(),
    created_by: userId,
  }

  const { data, error } = await supabase.from('track_groups').insert(row).select('*').single()
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: data as TrackGroup }
}

/** Patch a group. Undefined keys are left untouched, exactly like updateTrack. */
export async function updateGroup(
  id: string,
  input: Partial<TrackGroupInput>,
): Promise<ApiResult<TrackGroup>> {
  if (!supabase) return notConfigured()

  const row: Record<string, unknown> = {}
  if (input.name !== undefined) row.name = input.name.trim()
  if (input.nameAr !== undefined) row.name_ar = input.nameAr.trim()
  if (input.color !== undefined) row.color = input.color
  if (input.colorLight !== undefined) row.color_light = toColorLight(input.colorLight)

  // A no-op PATCH would come back with zero rows and .single() would then error
  // out on a request that did nothing wrong. Read the row back instead —
  // updateTrack's reasoning, verbatim.
  if (Object.keys(row).length === 0) {
    const { data, error } = await supabase.from('track_groups').select('*').eq('id', id).single()
    if (error) return fail(pgErrorKey(error))
    return { ok: true, data: data as TrackGroup }
  }

  const { data, error } = await supabase
    .from('track_groups')
    .update(row)
    .eq('id', id)
    .select('*')
    .single()
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: data as TrackGroup }
}

/**
 * Move one track into a group, or out of every group with `null`.
 *
 * `updateTrack(id, { groupId })` does exactly the same PATCH; this exists for
 * `setTrackArchived`'s reason, one line above the same argument: the group
 * picker is a single-purpose control on a screen that edits nothing else about
 * the track, and naming the operation keeps that call site from having to know
 * that "move to a group" and "rename and recolour" are the same endpoint.
 *
 * `null` is a first-class argument, not a missing one — ungrouped is a legal
 * state and a member has to be able to get back to it.
 */
export async function setTrackGroup(
  id: string,
  groupId: string | null,
): Promise<ApiResult<Track>> {
  if (!supabase) return notConfigured()
  const { data, error } = await supabase
    .from('tracks')
    .update({ group_id: groupId })
    .eq('id', id)
    .select('*')
    .single()
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: data as Track }
}

/**
 * Rewrite sort_order for the given ids, in array order, returning how many rows
 * moved. An RPC rather than N PATCHes for reorderTracks' reason: a half-applied
 * reorder leaves duplicate positions behind, and only a single statement is
 * atomic under PostgREST.
 *
 * `security invoker` on the SQL side — the function needs atomicity, not
 * privilege, so RLS still rejects a member exactly as if they had run the
 * update by hand. Its `is_admin()` guard raises 42501 rather than reporting a
 * zero-row update as success.
 */
export async function reorderGroups(ids: string[]): Promise<ApiResult<number>> {
  if (!supabase) return notConfigured()
  if (ids.length === 0) return { ok: true, data: 0 }
  const { data, error } = await supabase.rpc('reorder_groups', { p_ids: ids })
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: typeof data === 'number' ? data : ids.length }
}
