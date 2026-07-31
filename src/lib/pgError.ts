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
// supabase/migrations/0002_config_foundation.sql and 0003_vocab_options.sql.
// Renaming an index or a trigger's error token there silently demotes a precise
// message to 'common.error', so keep the files in step. 0003 says so in a
// comment above the raise, which is the other half of this handshake.

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
      // vocab_last_visible_option() — 0003. Hiding the final visible option of a
      // kind would leave a picker with nothing to pick, and every entry already
      // holding that key unreachable through the UI. The trigger raises on the
      // whole statement, so a batch that hides several at once is rolled back
      // entirely; the message says what must remain, not which row lost.
      if (text.includes('last_visible_option')) return 'vocabadmin.errLastVisible'
      // label_overrides_text_len / _key_shape / _key_len — 0017. The migration
      // splits these three constraints APART specifically so this file can tell
      // them from each other; "that wording is too long" and "that is not a
      // label key" want different sentences, and both used to arrive as the
      // generic key, which the terminology screen then annotated with "the
      // table is not installed" — a confident, wrong diagnosis.
      if (text.includes('label_overrides_text_len')) return 'terminology.errTooLong'
      if (text.includes('label_overrides_key_shape') || text.includes('label_overrides_key_len')) {
        return 'terminology.errBadKey'
      }
      break
    case '23502':
      // NOT NULL violated. This should now be UNREACHABLE: the one column that
      // ever produced it is `entries.description` (`not null default ''`), and
      // toEntryRow()/toEntryPatchRow() coalesce to '' rather than null, with
      // tests pinning both. Kept as an explicit case anyway — if it ever fires
      // again a new nullable-looking column has been added somewhere, and the
      // named warn below is the difference between finding it in a minute and
      // reading it as one more anonymous 'common.error'.
      console.warn('[pg] 23502 not-null violation — a column lost its coalesce:', e.message)
      return 'common.error'
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
    case 'PGRST116':
      // Not a SQLSTATE — PostgREST's own code for ".single() got zero rows".
      //
      // This is the failure lib/permissions.ts exists to pre-empt. An
      // RLS-blocked UPDATE is not an error to Postgres; the row simply does not
      // match the policy, so the statement affects nothing and `.select()
      // .single()` finds nothing to return. Left unmapped it reached the user as
      // a generic "something went wrong" after their card had already animated
      // into place and snapped back — the app looking broken when it was working
      // exactly as designed.
      //
      // Honest caveat: a row deleted by another session between load and save
      // lands here too, and this sentence is a shade wrong for that case. It is
      // the far rarer of the two, and both end the same way — the change did not
      // land and re-reading the screen is the next step. A message that hedged
      // over which it was would help nobody.
      return 'entry.errNotYours'
    case 'PGRST205':
      // Not a SQLSTATE either — PostgREST's "could not find the table in the
      // schema cache", i.e. a migration that has not been applied to this
      // project. It is a SUPPORTED state rather than a fault for a feature
      // whose table is optional (label_overrides today, vocab_options once),
      // and it is the one failure a screen can explain precisely: naming it
      // here is what lets a screen offer the runbook line instead of guessing
      // that every generic failure means the same thing.
      return 'common.errMissingTable'
    default:
      break
  }

  console.warn('[pg] unmapped error:', code, e.message)
  return 'common.error'
}
