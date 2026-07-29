// The vocabulary read/write surface.
//
// Errors are i18n KEYS via pgErrorKey(), following api/tracks.ts — never raw
// Postgres English, which lands an untranslated sentence in an RTL layout.
//
// MISSING TABLE IS A SUPPORTED STATE. If 0003 has not been applied, listVocab()
// fails, store/vocab keeps an empty row set, every label resolver falls through
// to its i18n default, and the app renders exactly as it does today. There is
// deliberately no DEFAULT_VOCAB shim: the i18n defaults already are the
// fallback, and a second copy of them would be a second thing to keep in step.
//
// NO INSERT AND NO DELETE, and that is the point of the whole feature. The keys
// are frozen; an admin renames, recolours, reorders, hides and resets them.
// Adding a create/destroy pair here would make a two-click status merge possible
// and it would silently rewrite every completed entry, non-undoably.
//
// Authorization is server-side, as with tracks: 0003's policies gate write
// access on is_admin(), so a member calling any of these gets 42501 and the UI
// shows admin.errForbidden. Nothing here checks a role.

import { supabase } from './supabase'
import { fail, notConfigured, type ApiResult } from './result'
import { pgErrorKey } from '../lib/pgError'
import type { VocabKind, VocabRow } from '../types'

/**
 * A vocabulary edit. camelCase because it is a form's view-model; this file
 * hand-maps to the snake_case columns, exactly as api/tracks.ts does.
 *
 * Every field is optional and undefined means "leave alone" — `color: null` and
 * `slaDays: null` are real values meaning "clear the override".
 */
export interface VocabPatch {
  label?: string
  labelAr?: string
  color?: string | null
  hidden?: boolean
  /** Priority rows only; a CHECK constraint rejects it elsewhere. */
  staleAfterDays?: number | null
  /** Priority rows only, same CHECK. null turns this priority's SLA off. */
  slaDays?: number | null
}

/**
 * Every option, both hidden and visible, ordered for display.
 *
 * The admin editor needs the hidden ones and so does any screen rendering a
 * historic value, so there is no `includeHidden` argument — the caller filters.
 * Seventeen rows do not justify two round trips.
 *
 * Ordered by (kind, sort_order, key): sort_order defaults to 0 and reorder_vocab
 * only rewrites the keys it was handed, so without the third key the list
 * reshuffles between loads.
 */
export async function listVocab(): Promise<ApiResult<VocabRow[]>> {
  if (!supabase) return notConfigured()
  const { data, error } = await supabase
    .from('vocab_options')
    .select('*')
    .order('kind', { ascending: true })
    .order('sort_order', { ascending: true })
    .order('key', { ascending: true })
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: (data ?? []) as VocabRow[] }
}

/**
 * Patch one option, addressed by its composite primary key.
 *
 * `updated_at` and `updated_by` are NOT written here. They belong to a trigger
 * in 0003 (the tracks_touch() pattern): a client that stamps its own audit
 * fields can lie about them, and the row's whole purpose is telling an admin who
 * renamed a status.
 *
 * Hiding the last visible option of a kind raises 23514 with the
 * `last_visible_option` marker, which pgErrorKey() maps to
 * vocabadmin.errLastVisible — the UI must not pre-empt that check client-side,
 * because a second admin can hide a different option between the read and the
 * write.
 */
export async function updateVocab(
  kind: VocabKind,
  key: string,
  patch: VocabPatch,
): Promise<ApiResult<VocabRow>> {
  if (!supabase) return notConfigured()

  const row: Record<string, unknown> = {}
  // Labels are trimmed rather than rejected when blank: an EMPTY label is the
  // documented way to say "no override", so clearing the field is how an admin
  // hands an option back to its frozen i18n default.
  if (patch.label !== undefined) row.label = patch.label.trim()
  if (patch.labelAr !== undefined) row.label_ar = patch.labelAr.trim()
  if (patch.color !== undefined) row.color = patch.color
  if (patch.hidden !== undefined) row.hidden = patch.hidden
  if (patch.staleAfterDays !== undefined) row.stale_after_days = patch.staleAfterDays
  if (patch.slaDays !== undefined) row.sla_days = patch.slaDays

  // A no-op PATCH would come back with zero rows and .single() would then error
  // out on a request that did nothing wrong. Read the row back instead —
  // updateTrack() does the same thing for the same reason.
  if (Object.keys(row).length === 0) {
    const { data, error } = await supabase
      .from('vocab_options')
      .select('*')
      .eq('kind', kind)
      .eq('key', key)
      .single()
    if (error) return fail(pgErrorKey(error))
    return { ok: true, data: data as VocabRow }
  }

  const { data, error } = await supabase
    .from('vocab_options')
    .update(row)
    .eq('kind', kind)
    .eq('key', key)
    .select('*')
    .single()
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: data as VocabRow }
}

/**
 * Rewrite sort_order for one kind, in array order, returning how many rows
 * moved.
 *
 * An RPC rather than N PATCHes, exactly as reorderTracks: a half-applied
 * reorder leaves duplicate positions behind, and only a single statement is
 * atomic under PostgREST. `security invoker` on the SQL side — the function
 * needs atomicity, not privilege, so RLS still rejects a member as if they had
 * run the updates by hand.
 */
export async function reorderVocab(kind: VocabKind, keys: string[]): Promise<ApiResult<number>> {
  if (!supabase) return notConfigured()
  if (keys.length === 0) return { ok: true, data: 0 }
  const { data, error } = await supabase.rpc('reorder_vocab', { p_kind: kind, p_keys: keys })
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: typeof data === 'number' ? data : keys.length }
}

/**
 * Restore the seed row: empty labels, null colour, visible, and the seeded
 * sort_order and thresholds from `vocab_seed()` — including `sla_days`. Omitting
 * `key` resets the whole kind.
 *
 * Empty labels are the point: an empty label means "no override", so resetting
 * hands the option back to its frozen i18n default rather than to whatever
 * English string happened to be seeded.
 *
 * What "seeded thresholds" means is 0003's business, not this file's — the
 * migration owns vocab_seed() and this call is a pass-through. Nothing here may
 * grow its own idea of a default, or a reset would land on two different answers
 * depending on which one ran last.
 */
export async function resetVocab(kind: VocabKind, key?: string): Promise<ApiResult<number>> {
  if (!supabase) return notConfigured()
  const { data, error } = await supabase.rpc('reset_vocab', { p_kind: kind, p_key: key ?? null })
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: typeof data === 'number' ? data : 0 }
}
