// The label override layer's read/write surface — Settings › Terminology.
//
// WHAT AN OVERRIDE IS. One row of `label_overrides` per i18n key the owner has
// reworded, a column per language, layered over the shipped locale bundles by
// lib/i18n.ts:
//
//   override[locale][key] → bundle[locale][key] → bundle.en[key] → key
//
// WHY A LAYER AND NOT AN EDIT OF THE BUNDLES. The bundles ship inside the build,
// so editing them means a deploy for every wording change — the exact round-trip
// this feature exists to delete. Overrides are DATA: they load at sign-in and
// apply live, for everyone, with no developer in the loop. It is also what makes
// "reset to default" trivially correct — delete the row and the shipped string
// returns, with no copy of it kept anywhere to go stale.
//
// ERRORS HERE ARE i18n KEYS, NOT SENTENCES — pgErrorKey(), following
// api/tracks.ts. An admin demoted between page load and save gets 42501, which
// maps to admin.errForbidden; raw Postgres English never reaches an RTL layout.
//
// MISSING TABLE IS A SUPPORTED STATE, and at the time of writing it is the ONLY
// state: supabase/migrations/0016_label_overrides.sql is written and NOT YET
// APPLIED (the management token is revoked — see the handoff for the owner's
// copy-paste steps). Until it runs, listOverrides() fails with PGRST205,
// store/labels.ts keeps an empty layer, every t() lands on its shipped string,
// and the app renders exactly as it does today. That is not a fallback to be
// tidied away later — it is what lets this branch be reviewed and merged
// independently of a hand-applied migration, and it mirrors the contract
// api/config.ts states for an unapplied 0003.
//
// NOTHING OUTSIDE store/labels.ts MAY CALL THE MUTATIONS BELOW. That store owns
// the push into lib/i18n's override layer; a component writing through this
// module directly would change the database and leave the running app showing
// the old wording until the next sign-in. Reads have the same rule for a duller
// reason: the store dedupes them.
//
// NO VALIDATION AND NO BIDI HERE, DELIBERATELY. lib/labelOverrides.ts owns the
// placeholder set, the plural categories and the isolates (spec §§1–3), and it
// runs where the owner can SEE what will be stored — `validateOverride()`
// returns the exact `string | null` these functions take. Re-deriving any of it
// at this boundary would be a second opinion on the same question, and applying
// isolates a second time would nest them inside the ones already placed.
//
// Authorization is server-side, as everywhere else: 0016's policies gate writes
// on is_admin() and reads on is_member(), so nothing in this file checks a role.
// Members must read the table — they render the labels too.

import { supabase } from './supabase'
import { fail, notConfigured, type ApiResult } from './result'
import { isBlankLabel } from '../lib/labelOverrides'
import { pgErrorKey } from '../lib/pgError'
import type { LabelOverrideRow } from '../types'

/**
 * The column list, named once. `select('*')` would silently ship any column a
 * later migration adds down to every client and into localStorage.
 */
const COLUMNS = 'key, en, ar, updated_by, updated_at'

/**
 * PostgREST's own ceiling, and the page size that matches it.
 *
 * 1000 IS NOT A PREFERENCE — the live project reports `db-max-rows: 1000` and
 * applies it AFTER any `.limit()`, silently: the response is a 200 with fewer
 * rows (api/entries.ts states this at length; docs/FIX-BACKLOG.md item C8 has the
 * measurement). An unpaged read of this table is therefore not "small enough to
 * be safe" — it is a read that stops at 1000 rows and says nothing.
 */
const PAGE_SIZE = 1000

/**
 * The cap on the walk. Four pages is 4,000 rows against a hard upper bound of
 * ~2,100 — every key the bundles carry, counting one row per Arabic plural form
 * — so it cannot be reached by a wording pass, only by litter in the table. It
 * exists so a bug somewhere else cannot turn a page loop into an infinite one.
 */
const MAX_PAGES = 4

/**
 * A read that could have been clipped, and whether it was — the shape
 * api/entries.ts's `Loaded<T>` established.
 *
 * Truncation is not an error and not an empty answer: it is a correct-LOOKING
 * answer missing rows, which for this table means a wording layer that renders
 * the owner's words on some screens and the shipped ones on others, with no
 * symptom. Making the flag part of the return type is what stops the caller
 * forgetting to ask.
 */
export interface LoadedOverrides {
  rows: LabelOverrideRow[]
  truncated: boolean
}

/** One key's new wording, as the row editor and the JSON importer both express it. */
export interface LabelOverrideInput {
  key: string
  en: string | null
  ar: string | null
}

/**
 * Blank IS the way to say "no override" (spec §5), so an empty or
 * whitespace-only value becomes null rather than an empty string.
 *
 * 0016's `label_overrides_touch()` does the same with `nullif(btrim(x), '')` and
 * is the authority — the rule that keeps a nav label from rendering as blank
 * space does not get to depend on a client. This is the client half of that
 * belt-and-braces, and it exists for a second reason the trigger cannot serve:
 * upsertOverride() has to know, BEFORE it sends anything, whether this write is
 * really a delete.
 *
 * The emptiness test is lib/labelOverrides.ts's `isBlankLabel()`, shared with
 * the validator, the store and the resolver so that the four layers cannot
 * disagree about what empty means — `String.trim()` alone does not remove the
 * bidi controls or any other invisible format character, so a value that renders
 * as nothing at all used to arrive here as non-blank and be stored. Only the
 * TEST strips them; what is sent is the trimmed original, isolates intact,
 * because the validator put those there on purpose.
 */
function blankToNull(value: string | null): string | null {
  const trimmed = value?.trim() ?? ''
  return isBlankLabel(trimmed) ? null : trimmed
}

/** The row shape a write sends. Audit columns belong to the trigger, not here. */
function toRow(input: LabelOverrideInput): { key: string; en: string | null; ar: string | null } {
  return {
    key: input.key.trim(),
    en: blankToNull(input.en),
    ar: blankToNull(input.ar),
  }
}

/**
 * Every override, ordered by key.
 *
 * Ordered because the key IS the primary key, so the ordering is total and two
 * loads of the same data produce the same array — a list that reshuffles between
 * loads reads as data moving on its own. No filter: the admin screen needs all
 * of them to compute "show only changed", and every signed-in client needs all
 * of them to render.
 *
 * PAGED, and the reason is the one thing about this table that surprises. It is
 * bounded by the locale bundles — but that bound is ABOVE PostgREST's ceiling,
 * not below it: 1,670 keys, of which 91 are plural nodes, comes to ~2,100
 * override rows for a complete wording pass, and the import path can write them
 * all in a single act (the ceiling caps a response body, never a write). An
 * unpaged read would then return the first 1,000 with a 200 and no complaint,
 * and every key after `followups.showAll` would quietly go back to its shipped
 * wording — in the live layer, in the localStorage cache, in the header count,
 * on this screen and in the JSON export.
 *
 * `.range()` until a short page arrives, exactly as api/timeline.ts walks its
 * events, and for the same reason: a full page means there may be more, a short
 * page means there is not.
 */
export async function listOverrides(): Promise<ApiResult<LoadedOverrides>> {
  if (!supabase) return notConfigured()
  const client = supabase
  const rows: LabelOverrideRow[] = []
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE
    const { data, error } = await client
      .from('label_overrides')
      .select(COLUMNS)
      .order('key', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) return fail(pgErrorKey(error))
    const batch = (data ?? []) as LabelOverrideRow[]
    rows.push(...batch)
    if (batch.length < PAGE_SIZE) return { ok: true, data: { rows, truncated: false } }
  }
  return { ok: true, data: { rows, truncated: true } }
}

/**
 * Write one key's wording, in either or both languages.
 *
 * BOTH LANGUAGES BLANK IS SENT AS A DELETE, and resolves with null. 0016 would
 * converge on the same state on its own — `label_overrides_prune_empty()` drops
 * a row that overrides nothing in either language, by design, so that every
 * route back to the shipped string works. Sending the delete directly is not a
 * duplicate of that rule but the client-side consequence of it: the alternative
 * is an upsert whose `return=representation` body is a row `{en: null, ar: null}`
 * that the AFTER trigger has already deleted, which the migration's own comment
 * flags for whoever writes this file. Rather than store a phantom or re-read to
 * confirm what is already known, ask for the deletion that is meant.
 *
 * `updated_at` and `updated_by` are NOT written here. They belong to the
 * trigger, following vocab_touch(): a client that stamps its own audit fields
 * can lie about them, and the row's whole purpose is telling the next admin who
 * changed what a screen says.
 */
export async function upsertOverride(
  key: string,
  en: string | null,
  ar: string | null,
): Promise<ApiResult<LabelOverrideRow | null>> {
  if (!supabase) return notConfigured()

  const row = toRow({ key, en, ar })
  // A blank key names nothing and would occupy the primary key a real key needs.
  // 0016's `label_overrides_key_shape` refuses it too; catching it here costs
  // the caller a round trip rather than a 23514 it cannot explain. The screen
  // cannot produce one — its rows come from lib/labelSections.listLabels() — so
  // this only ever fires on a hand-edited import file.
  if (row.key === '') return fail('common.error')

  if (row.en === null && row.ar === null) {
    const cleared = await deleteOverride(row.key)
    if (!cleared.ok) return fail(cleared.error)
    return { ok: true, data: null }
  }

  const { data, error } = await supabase
    .from('label_overrides')
    .upsert(row, { onConflict: 'key' })
    .select(COLUMNS)
    .single()
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: data as LabelOverrideRow }
}

/**
 * Write many keys at once — the JSON import path (spec: "a wording pass can be
 * drafted offline and applied in one go").
 *
 * Two statements at most, not one per key: a wording pass is hundreds of keys,
 * and hundreds of sequential round trips over a phone connection is a different
 * product. Entries whose two languages are both blank are DELETED, by the same
 * rule upsertOverride() states — an export taken after some keys were reset
 * carries them as blanks, and re-importing it must reset them again rather than
 * resurrect them.
 *
 * Resolves with the rows that now exist for the keys it wrote, which excludes
 * the ones it deleted. NOT ATOMIC across the two statements: a failed delete
 * leaves the upserts unsent (it runs first), a failed upsert leaves the deletes
 * done. The caller refetches either way, so the screen always shows what the
 * database actually holds — PostgREST has no transaction across two requests,
 * and the honest alternative is an RPC, which 0016 does not have and which this
 * feature does not yet need.
 */
export async function upsertOverrides(
  inputs: readonly LabelOverrideInput[],
): Promise<ApiResult<LabelOverrideRow[]>> {
  if (!supabase) return notConfigured()

  const rows = inputs.map(toRow).filter((row) => row.key !== '')
  const cleared = rows.filter((row) => row.en === null && row.ar === null).map((row) => row.key)
  const written = rows.filter((row) => row.en !== null || row.ar !== null)

  if (cleared.length > 0) {
    const { error } = await supabase.from('label_overrides').delete().in('key', cleared)
    if (error) return fail(pgErrorKey(error))
  }

  if (written.length === 0) return { ok: true, data: [] }

  const { data, error } = await supabase
    .from('label_overrides')
    .upsert(written, { onConflict: 'key' })
    .select(COLUMNS)
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: (data ?? []) as LabelOverrideRow[] }
}

/**
 * Hand one key back to its shipped string, resolving with how many rows went —
 * 0 when it had already been reset.
 *
 * Through `reset_label_overrides(key)` rather than a plain DELETE, because that
 * function is what 0016 built as THE escape hatch and what its probe proves
 * works under RLS. It is `security invoker`, so it needs atomicity rather than
 * privilege and a member is rejected by the policy exactly as if they had typed
 * the DELETE by hand; the `is_admin()` test at the top of it is there so that
 * member gets a clean 42501 to translate instead of a silent zero-row delete
 * reported as success. deleteAllOverrides() calls the same function with null.
 *
 * A count of 0 is a SUCCESS, not a failure. The same call answers "reset this
 * row" and "reset a row another admin already reset", and a red banner on the
 * second is a lie about what happened.
 */
export async function deleteOverride(key: string): Promise<ApiResult<number>> {
  if (!supabase) return notConfigured()
  const { data, error } = await supabase.rpc('reset_label_overrides', { p_key: key.trim() })
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: typeof data === 'number' ? data : 0 }
}

/**
 * THE GLOBAL ESCAPE HATCH (spec §4). Clear every override at once, resolving
 * with how many rows went so the toast can say what it actually did.
 *
 * It must be impossible to reword the app into an unusable state and have no way
 * back — including from a phone, in a language the nav labels no longer name.
 * `p_key: null` is how reset_label_overrides() says "all of them": one statement,
 * so a half-applied reset cannot leave the owner staring at the subset of his
 * own renames that happened to survive.
 *
 * The `confirm()` guard belongs to the screen, not here: a modal inside an api
 * function cannot be reused or tested, and this is also the call a "replace the
 * whole set" import would make.
 */
export async function deleteAllOverrides(): Promise<ApiResult<number>> {
  if (!supabase) return notConfigured()
  const { data, error } = await supabase.rpc('reset_label_overrides', { p_key: null })
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: typeof data === 'number' ? data : 0 }
}
