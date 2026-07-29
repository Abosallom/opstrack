// Postgres failures → i18n KEYS.
//
// Why this exists: entries.ts returns `error.message` verbatim, which drops an
// English sentence like `duplicate key value violates unique constraint
// "tracks_name_uidx"` into a fully-Arabic RTL layout. Worse, the useful part of
// that sentence is a constraint identifier the user has never heard of.
//
// So the mapping happens here, at the boundary, and callers get a key to pass
// through t(). The raw message still reaches console.warn — an unmapped failure
// has to stay debuggable, it just must not be rendered.
//
// The identifiers matched below are the contract with
// supabase/migrations/0002_config_foundation.sql. Renaming an index or a
// trigger's error token there silently demotes a precise message to
// 'common.error', so keep the two files in step.

/** The subset of a PostgrestError / PostgREST body this module reads. */
interface PgLike {
  code?: unknown
  message?: unknown
  details?: unknown
  hint?: unknown
}

/**
 * Everything textual the error carries, lowercased and concatenated.
 *
 * Which field holds the constraint name depends on how the failure surfaced:
 * PostgREST puts a unique-violation index in `details`, while a trigger's
 * `raise ... using errcode` puts its marker token in `message`. Searching the
 * whole blob avoids caring which.
 */
function haystack(e: PgLike): string {
  const parts = [e.message, e.details, e.hint]
  return parts
    .filter((p): p is string => typeof p === 'string')
    .join(' ')
    .toLowerCase()
}

function codeOf(e: PgLike): string {
  return typeof e.code === 'string' ? e.code : ''
}

export function pgErrorKey(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'common.error'
  const e = error as PgLike
  const code = codeOf(e)
  const text = haystack(e)

  switch (code) {
    case '23505':
      if (text.includes('tracks_name_ar_uidx')) return 'admin.tracks.errNameArTaken'
      if (text.includes('tracks_name_uidx')) return 'admin.tracks.errNameTaken'
      break
    case '23503':
      // Raised by tracks_block_delete_when_referenced(), which counts the
      // entries/meetings/templates still pointing at the track. The UI answers
      // this by offering the reassign step rather than repeating the counts.
      if (text.includes('track_in_use')) return 'admin.tracks.errInUse'
      break
    case '23514':
      // tracks_keep_one_active() — fires on archive as well as delete, so the
      // workspace always has somewhere to file work.
      if (text.includes('last_active_track')) return 'admin.tracks.errLastTrack'
      break
    case '22023':
      // delete_track() rejecting a destination it must not move rows onto. An
      // archived track is hidden from every picker and stops its recurring
      // templates, so landing entries there is a silent loss, not a placement.
      if (text.includes('reassign_archived')) return 'admin.tracks.errReassignArchived'
      if (text.includes('reassign_self')) return 'admin.tracks.errReassignSelf'
      break
    case 'P0002':
      // The track (or the destination) was deleted by another session while
      // this screen sat open.
      if (text.includes('track_missing')) return 'admin.tracks.errNotFound'
      break
    case '42501':
      // RLS rejected the write. In practice: the UI thinks this user is an
      // admin and profiles.role disagrees.
      return 'admin.errForbidden'
    default:
      break
  }

  console.warn('[pg] unmapped error:', code, e.message)
  return 'common.error'
}
