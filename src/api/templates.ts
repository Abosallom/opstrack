// Data access for `recurring_templates` — the recurring-templates screen's
// entire backend surface.
//
// ERRORS HERE ARE i18n KEYS, NOT SENTENCES, following api/tracks.ts: every
// caller renders `t(result.error)`. `templateErrorKey()` at the bottom is
// `pgErrorKey()` plus the one token this table's functions raise that
// lib/pgError.ts does not yet know about — see its comment, and the extension
// slot noted in the W3-TEMPLATES handoff.
//
// ── WHO MAY DO WHAT (0001:277-295, unchanged since) ────────────────────────
//
// select/insert/update are `is_member()`; DELETE alone is `is_admin()`. That is
// deliberate and the screen mirrors it rather than gating the whole page on
// admin: templates carry no `created_by`, so there is no author to scope writes
// to, and the table's own comment says "any member may author and tune one,
// admins alone may destroy one". A member who is shown a Delete button that
// always 42501s has been lied to; a member who cannot find the screen at all
// cannot do the thing they are allowed to do.
//
// ── THE C2 CLAMP LIVES HERE, NOT IN THE PARSER ─────────────────────────────
//
// Every `next_run_on` this module WRITES goes through
// `clampFirstRun()` (lib/recurrence.ts). docs/FIX-BACKLOG.md C2: a past anchor
// makes the scheduler's catch-up loop mint one entry per missed occurrence, up
// to 60. The write boundary is the right place for the rule because capture is
// not the only door — this screen has its own date field, and every future
// importer will have another.
//
// It clamps only a date the CALLER SUPPLIED. A rename must not quietly cancel a
// catch-up that a genuinely-behind template is owed (the archived-track case
// ADMIN.md documents), so a patch with no `nextRunOn` leaves the column alone
// and the screen surfaces the backlog with `pendingRuns()` and an explicit
// "skip ahead" action instead.
//
// ── AND IT ALWAYS STORES THE PIN THE CADENCE READS ─────────────────────────
//
// `advance_recurrence()` falls back to `extract(day from p_from)` when
// `day_of_month` is null, and `p_from` is the ALREADY-CLAMPED previous run — so
// a monthly template anchored on the 31st goes 31 → Feb 28 → Mar 28 and stays
// on the 28th forever. Writing the pin explicitly (derived from `next_run_on`
// when the caller did not choose one) is what makes it recover to Mar 31. The
// mirror reproduces both behaviours and recurrence.test.ts pins them side by
// side; this function is the reason a real row only ever sees the good one.

import { supabase } from './supabase'
import { fail, notConfigured, type ApiResult } from './result'
import { pgErrorKey } from '../lib/pgError'
import { parseIsoDate, todayIso } from '../lib/dates'
import { clampFirstRun, resolveSchedule, type ResolvedSchedule } from '../lib/recurrence'
import type { NewTemplate } from '../lib/capture/parse'
import type { RecurringTemplate } from '../types'

// Re-exported so a caller reaching for the write view-model has ONE import path
// for it, exactly as api/entries.ts re-exports NewEntry. The definition lives in
// lib/capture/parse.ts because `toRecurringTemplateInput()` returns one and
// `src/lib/**` may not import from `src/api/**`.
export type { NewTemplate }

/**
 * `select('*')` rather than a column list, matching api/tracks.ts.
 *
 * The table is fourteen columns wide and `RecurringTemplate` in types.ts names
 * every one of them, so a list would be a second copy of that type maintained
 * by hand — and supabase-js only narrows a column list when it is a literal,
 * which a shared constant is not.
 */
const COLUMNS = '*'

/**
 * camelCase resolver output → the snake_case columns.
 *
 * `resolveSchedule()` itself lives in lib/recurrence.ts so the editor's
 * next-runs preview and this writer are the SAME function — a preview that
 * resolved the pins differently would show a schedule the row does not follow.
 * All this adds is the naming boundary the api layer owns (see types.ts's
 * header), and `clamped` is dropped because it describes the decision, not a
 * column.
 */
function scheduleColumns(s: ResolvedSchedule): Record<string, unknown> {
  return {
    cadence: s.cadence,
    custom_interval_days: s.customIntervalDays,
    day_of_week: s.dayOfWeek,
    day_of_month: s.dayOfMonth,
    next_run_on: s.nextRunOn,
  }
}

/** Whole days only, inside the bounds, or null. The column is `int`. */
function intOrNull(value: number | null | undefined, min: number, max: number): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  const n = Math.trunc(value)
  return n < min || n > max ? null : n
}

/**
 * Every template, active first, then by when it next runs.
 *
 * Paused rows sink to the bottom rather than being filtered out: pausing is
 * reversible and a paused template that has vanished from the only screen that
 * can resume it is, in practice, deleted. `title` is the stable tiebreak — two
 * templates sharing a `next_run_on` is the normal case for a workspace that set
 * several of them up on the same afternoon, and without it the list reshuffles
 * between loads.
 */
export async function listTemplates(): Promise<ApiResult<RecurringTemplate[]>> {
  if (!supabase) return notConfigured()
  const { data, error } = await supabase
    .from('recurring_templates')
    .select(COLUMNS)
    .order('active', { ascending: false })
    .order('next_run_on', { ascending: true })
    .order('title', { ascending: true })
  if (error) return fail(templateErrorKey(error))
  return { ok: true, data: (data ?? []) as RecurringTemplate[] }
}

export async function createTemplate(input: NewTemplate): Promise<ApiResult<RecurringTemplate>> {
  if (!supabase) return notConfigured()
  const title = input.title.trim()
  if (!title) return fail('recurring.errTitleRequired')
  if (!parseIsoDate(input.nextRunOn)) return fail('recurring.errFirstRun')

  const row = {
    title,
    track_id: input.trackId,
    type: input.type,
    priority: input.priority,
    // The XOR the CHECK constraint enforces, applied here rather than trusted
    // from the caller — `recurring_templates_single_owner` rejects a row
    // carrying both, and a 23514 is a worse way to learn it than this line.
    owner_id: input.ownerId,
    owner_name: input.ownerId ? null : input.ownerName,
    lead_days: intOrNull(input.leadDays, 0, 3650) ?? 0,
    ...scheduleColumns(resolveSchedule(input, true)),
  }

  const { data, error } = await supabase
    .from('recurring_templates')
    .insert(row)
    .select(COLUMNS)
    .single()
  if (error) return fail(templateErrorKey(error))
  return { ok: true, data: data as RecurringTemplate }
}

/**
 * `given` unless it is absent — and ABSENT MEANS `undefined`, NEVER `null`.
 *
 * `??` is wrong for every one of the three pin columns: `null` is a real,
 * meaningful value there ("this cadence has no pin", "clear the interval"), and
 * `patch.dayOfWeek ?? stored.day_of_week` silently resurrects the stored pin
 * whenever a caller asks to clear one. `Partial<NewTemplate>` distinguishes the
 * two by construction; this helper is what makes the merge honour it.
 */
function given<T>(supplied: T | undefined, stored: T): T {
  return supplied === undefined ? stored : supplied
}

/** The five keys that describe WHEN a template runs. */
const SCHEDULE_KEYS = [
  'cadence',
  'customIntervalDays',
  'dayOfWeek',
  'dayOfMonth',
  'nextRunOn',
] as const

/**
 * Patch a template. Undefined keys are left untouched, exactly like updateTrack.
 *
 * A patch that touches ANY scheduling key re-reads the row first and resolves
 * all five together, because they are one decision: switching a weekly template
 * to monthly has to drop `day_of_week` and mint a `day_of_month` in the same
 * write, and a patch that carried only `cadence` would otherwise leave a row
 * claiming a weekday the scheduler will never read. The extra round trip is
 * paid only on a schedule edit — a rename, a re-prioritise or a reassignment
 * costs one request, as before.
 *
 * That read-then-write is last-write-wins against a concurrent editor, which is
 * this app's stated conflict model everywhere else (plan §2.3). The window is
 * one round trip on a screen two people are rarely on at once.
 */
export async function updateTemplate(
  id: string,
  patch: Partial<NewTemplate>,
): Promise<ApiResult<RecurringTemplate>> {
  if (!supabase) return notConfigured()

  const row: Record<string, unknown> = {}
  if (patch.title !== undefined) {
    const title = patch.title.trim()
    if (!title) return fail('recurring.errTitleRequired')
    row.title = title
  }
  if (patch.trackId !== undefined) row.track_id = patch.trackId
  if (patch.type !== undefined) row.type = patch.type
  if (patch.priority !== undefined) row.priority = patch.priority
  if (patch.leadDays !== undefined) row.lead_days = intOrNull(patch.leadDays, 0, 3650) ?? 0
  // Owner is one decision in two columns: whichever half is supplied, the other
  // is cleared, or the CHECK constraint rejects the pair.
  if (patch.ownerId !== undefined || patch.ownerName !== undefined) {
    const ownerId = patch.ownerId ?? null
    row.owner_id = ownerId
    row.owner_name = ownerId ? null : (patch.ownerName ?? null)
  }

  if (SCHEDULE_KEYS.some((key) => patch[key] !== undefined)) {
    const current = await getTemplate(id)
    if (!current.ok) return current
    const stored = current.data
    // Clamp only an anchor the caller chose. The stored one may legitimately be
    // in the past — a template whose track was archived is owed its catch-up.
    const anchorGiven = patch.nextRunOn !== undefined
    const anchor = patch.nextRunOn ?? stored.next_run_on
    if (anchorGiven && !parseIsoDate(anchor)) return fail('recurring.errFirstRun')
    Object.assign(
      row,
      scheduleColumns(
        resolveSchedule(
          {
            cadence: given(patch.cadence, stored.cadence),
            nextRunOn: anchor,
            customIntervalDays: given(patch.customIntervalDays, stored.custom_interval_days),
            dayOfWeek: given(patch.dayOfWeek, stored.day_of_week),
            dayOfMonth: given(patch.dayOfMonth, stored.day_of_month),
          },
          anchorGiven,
        ),
      ),
    )
  }

  // A no-op PATCH comes back with zero rows and .single() then errors on a
  // request that did nothing wrong — the same trap updateTrack documents.
  if (Object.keys(row).length === 0) return getTemplate(id)

  const { data, error } = await supabase
    .from('recurring_templates')
    .update(row)
    .eq('id', id)
    .select(COLUMNS)
    .single()
  if (error) return fail(templateErrorKey(error))
  return { ok: true, data: data as RecurringTemplate }
}

/** One row by id. `recurring.errNotFound` when another session deleted it. */
export async function getTemplate(id: string): Promise<ApiResult<RecurringTemplate>> {
  if (!supabase) return notConfigured()
  const { data, error } = await supabase
    .from('recurring_templates')
    .select(COLUMNS)
    .eq('id', id)
    .maybeSingle()
  if (error) return fail(templateErrorKey(error))
  if (!data) return fail('recurring.errNotFound')
  return { ok: true, data: data as RecurringTemplate }
}

/**
 * Pause or resume. Its own function rather than `updateTemplate({ active })`
 * because `active` is not part of NewTemplate — a template is created running,
 * and pausing is an operation on an existing one.
 *
 * RESUMING DOES NOT MOVE `next_run_on`, and that is the honest behaviour: a
 * template paused across three Mondays is three occurrences behind, and the
 * next scheduler pass will say so. The screen shows the count before the
 * resume, so nobody learns it at 03:15.
 */
export async function setTemplateActive(
  id: string,
  active: boolean,
): Promise<ApiResult<RecurringTemplate>> {
  if (!supabase) return notConfigured()
  const { data, error } = await supabase
    .from('recurring_templates')
    .update({ active })
    .eq('id', id)
    .select(COLUMNS)
    .single()
  if (error) return fail(templateErrorKey(error))
  return { ok: true, data: data as RecurringTemplate }
}

/**
 * Move a behind template to its next future occurrence, skipping the catch-up.
 *
 * The deliberate counterpart to the create-time clamp: this is the button that
 * says "do not mint the twelve items you owe me". It runs the same
 * `clampFirstRun()` walk, so the schedule's phase survives — a Monday template
 * lands on the next Monday, not on today.
 *
 * Resolves with the row unchanged when it was not behind, so the caller can
 * report "nothing to skip" instead of a save that did nothing.
 */
export async function skipToNextRun(id: string): Promise<ApiResult<RecurringTemplate>> {
  const current = await getTemplate(id)
  if (!current.ok) return current
  const t = current.data
  const next = clampFirstRun(
    t.next_run_on,
    t.cadence,
    t.custom_interval_days,
    t.day_of_week,
    t.day_of_month,
    todayIso(),
  )
  if (next === t.next_run_on) return current
  if (!supabase) return notConfigured()
  const { data, error } = await supabase
    .from('recurring_templates')
    .update({ next_run_on: next })
    .eq('id', id)
    .select(COLUMNS)
    .single()
  if (error) return fail(templateErrorKey(error))
  return { ok: true, data: data as RecurringTemplate }
}

/**
 * How many entries this template has already produced.
 *
 * A head-only count, the pattern api/tracks.getTrackUsage uses. It exists for
 * the delete confirmation: `entries.template_id` is `on delete set null`, so
 * deleting a template ORPHANS its history rather than removing it, and the
 * dialog has to be able to say how much history that is.
 */
export async function countTemplateEntries(id: string): Promise<ApiResult<number>> {
  if (!supabase) return notConfigured()
  const { count, error } = await supabase
    .from('entries')
    .select('id', { head: true, count: 'exact' })
    .eq('template_id', id)
  if (error) return fail(templateErrorKey(error))
  return { ok: true, data: count ?? 0 }
}

/**
 * Admin-only (`recurring_templates_delete` is `is_admin()`); a member gets
 * 42501 → `admin.errForbidden`.
 *
 * The entries it already created SURVIVE with `template_id` set to null. That
 * is the FK's `on delete set null` and it is the right default — a year of
 * completed monthly reports must not vanish because someone retired the recipe.
 */
export async function deleteTemplate(id: string): Promise<ApiResult<null>> {
  if (!supabase) return notConfigured()
  const { error } = await supabase.from('recurring_templates').delete().eq('id', id)
  if (error) return fail(templateErrorKey(error))
  return { ok: true, data: null }
}

/**
 * "Run now" — `materialize_template(p_id, p_advance)` from 0004.
 *
 * IDEMPOTENT BY CONSTRUCTION, and the function's own header explains why: the
 * due date is anchored to `current_date + lead_days`, not to `next_run_on`, so
 * the `(template_id, due_date)` unique index absorbs a second call and the same
 * entry id comes back. Click it five times, get one entry — which is the Wave-3
 * gate (f) assertion.
 *
 * `advance` defaults true, matching the SQL default. The function advances
 * `next_run_on` only when the template was actually DUE; running an ad-hoc copy
 * of one scheduled for next Monday does not cancel Monday's.
 *
 * Resolves with the entry id. Null is possible in principle (a race that
 * deleted the entry between the insert and the read-back) and the caller treats
 * it as "it worked, I just cannot link to it" rather than as a failure.
 */
export async function runTemplateNow(
  id: string,
  advance = true,
): Promise<ApiResult<string | null>> {
  if (!supabase) return notConfigured()
  const { data, error } = await supabase.rpc('materialize_template', {
    p_id: id,
    p_advance: advance,
  })
  if (error) return fail(templateErrorKey(error))
  return { ok: true, data: typeof data === 'string' ? data : null }
}

/**
 * `pgErrorKey()`, plus the one token this table's functions raise that it does
 * not map.
 *
 * `materialize_template()` raises `template_not_found` under P0002 (0004:411),
 * following the `track_in_use` / `last_active_track` convention. lib/pgError.ts
 * is W1-DOMAIN's file and §1.0.4 forbids editing another worker's module, so
 * the mapping sits here and the case is filed in the W3-TEMPLATES handoff as an
 * extension-slot addition. Delegating first rather than re-implementing means
 * 42501, 23514 and PGRST116 keep their existing, better sentences.
 *
 * PGRST116 is the other one worth naming: `.single()` finding zero rows on this
 * table means the row is GONE (there is no per-row RLS to fail), so
 * `entry.errNotYours` — pgErrorKey's answer, correct for entries — would be
 * actively misleading here.
 */
function templateErrorKey(error: unknown): string {
  const key = pgErrorKey(error)
  const e = error as { code?: unknown; message?: unknown }
  const text = typeof e?.message === 'string' ? e.message.toLowerCase() : ''
  if (text.includes('template_not_found')) return 'recurring.errNotFound'
  if (e?.code === 'PGRST116') return 'recurring.errNotFound'
  return key
}
