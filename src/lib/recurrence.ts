// The JS mirror of `advance_recurrence()` — supabase/migrations/0001:558-615.
//
// WHY A MIRROR EXISTS AT ALL. The database is the authority: pg_cron (03:15
// UTC) and the app's own RPC both call `materialize_due_recurring()`, and
// `materialize_template()` backs "run now". Nothing here writes an entry. What
// this module buys is the ANSWER BEFORE THE WRITE — the recurring-templates
// screen has to show "next four runs: 1 Aug, 1 Sep, 1 Oct, 1 Nov" while the
// admin is still typing, and a round trip per keystroke to ask Postgres is both
// slow and unavailable in a credential-less build.
//
// So this file is a translation, not a design. Every branch below quotes the
// SQL line it mirrors, and `recurrence.test.ts` carries a fixture matrix that
// was executed against the LIVE `advance_recurrence()` and diffed row for row.
// If the SQL ever changes, that matrix is what fails.
//
// PURE BY CONTRACT. No store, no api, no i18n — `src/lib/**` may not import
// from `src/store/**` or `src/api/**` (plan §1.1's standing grep), and every
// user-facing word this module could have produced is a key the caller renders
// instead. The only imports are lib/dates.ts and the row types.
//
// ── THE C2 HAZARD, AND WHERE IT IS CLOSED ──────────────────────────────────
//
// docs/FIX-BACKLOG.md C2: `toRecurringTemplateInput()` sets
// `nextRunOn = dueDate ?? todayIso()` and never checks whether that date is in
// the PAST. The scheduler's catch-up loop — `while v_next <= current_date and
// v_guard < 60` (0002:628) — then mints one entry per missed occurrence:
// `every:daily due:-30d` produces 31 rows, and a 2020 anchor walks straight
// into the 60-row cap. Reproduced, confirmed, and the backlog's own disposition
// is "clamping is safer — a warning the user ignores still ships 60 rows".
//
// `clampFirstRun()` below is that clamp, and `api/templates.ts` applies it to
// EVERY write of `next_run_on` — create, edit, and the screen's explicit
// "catch up" action. Putting it at the write boundary rather than in the parser
// is deliberate: capture is not the only door (the admin screen has a date
// field, and a future importer will have its own), and a rule enforced at one
// caller is a rule that holds until the second caller appears.
//
// `pendingRuns()` is the other half — it counts what the NEXT scheduler pass
// would attempt for a row that is already behind, so a template that slipped
// while its track was archived can say "this will create 12 items" out loud
// instead of doing it quietly at 03:15.

import { addDays, diffDays, isoWeekday, parseIsoDate, todayIso, type IsoDate } from './dates'
import type { Cadence, RecurringTemplate } from '../types'

/**
 * The scheduler's own catch-up ceiling — `v_guard < 60` in
 * `materialize_due_recurring()` (0001:650, restated 0002:628).
 *
 * Mirrored as a constant rather than inlined because the UI quotes it: a
 * template far enough behind to hit the cap has to say that the count it is
 * showing is a ceiling, not a total.
 */
export const CATCHUP_CAP = 60

/**
 * How far `clampFirstRun()` will walk before giving up and answering "today".
 *
 * A daily template anchored ten years back needs ~3650 steps, which is
 * microseconds; the cap exists for the shape of input no CHECK constraint
 * covers — a corrupt cadence, a date in the year 1200 — where the honest
 * answer is "start it today" rather than a spin.
 */
const CLAMP_GUARD = 4000

/** The frozen cadence list, in the order the editor offers them. */
export const CADENCES: readonly Cadence[] = [
  'daily',
  'weekly',
  'biweekly',
  'monthly',
  'quarterly',
  'custom',
]

/**
 * Bounds the EDITOR enforces. The database has none on these three columns
 * (`custom_interval_days int`, `lead_days int not null default 0`), so these
 * are a usability guard and not a mirror of a constraint — which is why they
 * live here next to the maths rather than being described as validation rules.
 *
 * A 0-day custom interval is the one that matters: `greatest(coalesce(p_interval,1),1)`
 * silently reads it as 1, so a template saved with 0 would run daily while its
 * form said "every 0 days".
 */
export const MIN_INTERVAL_DAYS = 1
export const MAX_INTERVAL_DAYS = 365
export const MIN_LEAD_DAYS = 0
export const MAX_LEAD_DAYS = 365

/** Which of the three optional columns this cadence actually reads. */
export interface CadenceFields {
  interval: boolean
  dayOfWeek: boolean
  dayOfMonth: boolean
}

/**
 * The one place that says which fields a cadence uses.
 *
 * Derived from what `advance_recurrence()` READS, not from what the table
 * allows: the CHECK constraints permit a monthly template to carry a
 * `day_of_week`, and the function ignores it. The editor hides the fields a
 * cadence ignores and api/templates.ts nulls them on write, both from here, so
 * a row can never claim a rule the scheduler will not follow.
 */
export function cadenceFields(cadence: Cadence): CadenceFields {
  return {
    interval: cadence === 'custom',
    dayOfWeek: cadence === 'weekly' || cadence === 'biweekly',
    dayOfMonth: cadence === 'monthly' || cadence === 'quarterly',
  }
}

// ── small calendar helpers ─────────────────────────────────────────────────

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/**
 * Days in a month, matching the SQL's
 * `extract(day from (date_trunc('month', …) + interval '1 month' - interval '1 day'))`.
 *
 * Built through setFullYear rather than `new Date(year, m + 1, 0)` for the
 * reason lib/dates.parseIsoDate documents: the two-argument constructor maps a
 * year under 100 into the 1900s, so `new Date(26, 1, 0)` is 1926 and February
 * loses its leap day for the wrong century.
 */
function daysInMonth(year: number, monthIndex: number): number {
  const d = new Date(2000, 0, 1)
  d.setHours(0, 0, 0, 0)
  d.setFullYear(year, monthIndex + 1, 0)
  return d.getDate()
}

/**
 * `date_trunc('month', from) + n months`, then the day clamped to that month's
 * length — 0001:584-596, both the monthly and the quarterly branch.
 *
 * The clamp is the entire reason the SQL does its own arithmetic instead of
 * `+ interval '1 month'`: Postgres reads `2026-01-31 + 1 month` as 2026-02-28
 * but `2026-01-31 + interval '1 month'` in some formulations as March, and a
 * monthly template anchored on the 31st that migrates to the 3rd is a silent
 * schedule change nobody authored.
 */
function monthStep(anchor: Date, months: number, dom: number | null): IsoDate {
  const shifted = anchor.getMonth() + months
  const year = anchor.getFullYear() + Math.floor(shifted / 12)
  const month = ((shifted % 12) + 12) % 12
  const last = daysInMonth(year, month)
  // `least(coalesce(p_dom, extract(day from p_from)), v_days)`.
  const day = Math.min(dom ?? anchor.getDate(), last)
  return `${year}-${pad2(month + 1)}-${pad2(day)}`
}

/**
 * 0–6 or null. Anything else is treated as unset.
 *
 * `day_of_week int check (day_of_week between 0 and 6)` makes an out-of-range
 * value unreachable through the database, and the two implementations disagree
 * outside that range: Postgres's `%` truncates toward zero, JavaScript's takes
 * the sign of the dividend, so a hypothetical -10 would step forward in one and
 * backward in the other. Normalising rather than reproducing the divergence is
 * the honest mirror — there is no behaviour to be faithful TO.
 */
function normalDow(dow: number | null): number | null {
  if (dow === null || !Number.isInteger(dow) || dow < 0 || dow > 6) return null
  return dow
}

/** 1–31 or null, mirroring `check (day_of_month between 1 and 31)`. */
function normalDom(dom: number | null): number | null {
  if (dom === null || !Number.isInteger(dom) || dom < 1 || dom > 31) return null
  return dom
}

// ── the mirror ─────────────────────────────────────────────────────────────

/**
 * One step of the schedule — `public.advance_recurrence(from, cadence, interval, dow, dom)`.
 *
 * Total over any input: an unparseable `from` comes back verbatim, exactly as
 * `addDays()` in lib/dates.ts chose, because a formatter that turns bad data
 * into a plausible-looking date is worse than one that passes it through
 * visibly. Every caller in this module checks `parseIsoDate` first anyway.
 *
 * The three behaviours worth stating out loud, because each surprises someone:
 *
 *  1. **A monthly template with no `day_of_month` STICKS at the clamped day.**
 *     Jan 31 → Feb 28 → Mar 28, not back to the 31st, because the fallback is
 *     `extract(day from p_from)` and `p_from` is already the clamped date. This
 *     is the database's behaviour and the mirror reproduces it; api/templates.ts
 *     answers it by always storing an explicit `day_of_month`, so the round trip
 *     Jan 31 → Feb 28 → **Mar 31** is what a real row actually does.
 *  2. **The weekday nudge lands AFTER the step**, so a weekly template anchored
 *     on a Wednesday with `day_of_week = 1` runs Wed, then the Monday twelve
 *     days later, then every Monday. `alignRun()` exists to move the anchor
 *     instead, and the editor offers it.
 *  3. **The result is never <= `from`.** The scheduler loops on this function;
 *     a zero step would spin forever, so the SQL floors it at `from + 1` and so
 *     does this.
 */
export function advanceRecurrence(
  from: IsoDate,
  cadence: Cadence,
  interval: number | null,
  dow: number | null,
  dom: number | null,
): IsoDate {
  const anchor = parseIsoDate(from)
  if (!anchor) return from

  const weekday = normalDow(dow)
  const monthday = normalDom(dom)

  let next: IsoDate
  switch (cadence) {
    case 'daily':
      next = addDays(from, 1)
      break
    case 'weekly':
      next = addDays(from, 7)
      break
    case 'biweekly':
      next = addDays(from, 14)
      break
    case 'monthly':
      next = monthStep(anchor, 1, monthday)
      break
    case 'quarterly':
      next = monthStep(anchor, 3, monthday)
      break
    default:
      // `p_from + greatest(coalesce(p_interval, 1), 1)`. Non-integers cannot
      // reach the column (it is `int`), and flooring one is closer to the
      // truncation a cast would apply than rounding is.
      next = addDays(from, Math.max(Number.isFinite(interval) ? Math.floor(interval ?? 1) : 1, 1))
      break
  }

  // `if p_dow is not null and p_cadence in ('weekly','biweekly')` — 0001:603.
  if (weekday !== null && (cadence === 'weekly' || cadence === 'biweekly')) {
    next = addDays(next, (((weekday - isoWeekday(next)) % 7) + 7) % 7)
  }

  // `if v_next <= p_from then v_next := p_from + 1` — 0001:609.
  if (diffDays(from, next) <= 0) next = addDays(from, 1)

  return next
}

/**
 * `n` consecutive run dates starting AT `start` — `start` itself is the first
 * element, because `next_run_on` is the next run and not the one before it.
 *
 * Stops early rather than looping if a step ever fails to advance. That cannot
 * happen given the floor in `advanceRecurrence`, and the check costs one
 * comparison per row of a five-row preview; a preview panel is not the place to
 * discover that the invariant was only nearly true.
 */
export function runsFrom(
  start: IsoDate,
  cadence: Cadence,
  interval: number | null,
  dow: number | null,
  dom: number | null,
  n: number,
): IsoDate[] {
  const out: IsoDate[] = []
  if (n <= 0 || !parseIsoDate(start)) return out
  let run = start
  out.push(run)
  while (out.length < n) {
    const next = advanceRecurrence(run, cadence, interval, dow, dom)
    if (diffDays(run, next) <= 0) break
    run = next
    out.push(run)
  }
  return out
}

/** The next `n` runs of a stored template. Plan §2.16's signature, verbatim. */
export function previewRuns(template: RecurringTemplate, n: number): IsoDate[] {
  return runsFrom(
    template.next_run_on,
    template.cadence,
    template.custom_interval_days,
    template.day_of_week,
    template.day_of_month,
    n,
  )
}

/**
 * The C2 clamp: the first occurrence of this schedule that is not in the past.
 *
 * `today` counts as "not in the past" ON PURPOSE. The scheduler's condition is
 * `next_run_on <= current_date`, so an anchor of today produces today's entry
 * and then advances — which is exactly what someone who types
 * `every:daily due:today` is asking for. Only a STRICTLY past anchor is a
 * backfill nobody requested.
 *
 * PHASE IS PRESERVED. Walking the schedule forward rather than jumping to today
 * keeps a monthly-on-the-1st template on the 1st and a Wednesday template on
 * Wednesdays; snapping to today would silently re-author the schedule while
 * appearing to fix it. The guard's fallback does snap to today, and that is the
 * one case where phase is lost — see CLAMP_GUARD.
 */
export function clampFirstRun(
  from: IsoDate,
  cadence: Cadence,
  interval: number | null,
  dow: number | null,
  dom: number | null,
  today: IsoDate = todayIso(),
): IsoDate {
  if (!parseIsoDate(from)) return today
  if (!parseIsoDate(today)) return from

  let run = from
  let guard = 0
  while (diffDays(run, today) > 0 && guard < CLAMP_GUARD) {
    const next = advanceRecurrence(run, cadence, interval, dow, dom)
    if (diffDays(run, next) <= 0) break
    run = next
    guard += 1
  }
  // Still behind after the guard, or a step that refused to advance: today is
  // the safe answer — one entry, now, instead of a walk that will not terminate.
  return diffDays(run, today) > 0 ? today : run
}

/**
 * Move the ANCHOR onto the pinned weekday or day-of-month, instead of letting
 * the pin take effect only from the second run.
 *
 * This is the answer to surprise (2) in `advanceRecurrence`: the database
 * applies `day_of_week` after the step, so a template anchored on a Wednesday
 * and pinned to Monday runs once on the Wednesday. Nobody means that. The
 * editor calls this whenever the pin changes, and shows the resulting first run.
 *
 * Always forward, never backward — moving the first run EARLIER than the date
 * the user typed is how a "starts next month" template quietly fires today.
 */
export function alignRun(
  from: IsoDate,
  cadence: Cadence,
  dow: number | null,
  dom: number | null,
): IsoDate {
  const anchor = parseIsoDate(from)
  if (!anchor) return from
  const fields = cadenceFields(cadence)

  const weekday = normalDow(dow)
  if (fields.dayOfWeek && weekday !== null) {
    return addDays(from, (((weekday - isoWeekday(from)) % 7) + 7) % 7)
  }

  const monthday = normalDom(dom)
  if (fields.dayOfMonth && monthday !== null) {
    const last = daysInMonth(anchor.getFullYear(), anchor.getMonth())
    const day = Math.min(monthday, last)
    if (day >= anchor.getDate()) {
      return `${anchor.getFullYear()}-${pad2(anchor.getMonth() + 1)}-${pad2(day)}`
    }
    // The day has already gone by this month. Step one month — a QUARTERLY
    // template included: this aligns the anchor, it does not schedule the
    // second run, and skipping a whole quarter to reach the 3rd would push the
    // start date three months past what the user asked for.
    return monthStep(anchor, 1, monthday)
  }

  return from
}

/**
 * How many entries the next scheduler pass would ATTEMPT for this template.
 *
 * Mirrors the catch-up loop's own condition and cap — `while v_next <=
 * current_date and v_guard < 60`. Zero for a paused template, because the pass
 * filters on `active`.
 *
 * ATTEMPT, not create. The insert carries `on conflict (template_id, due_date)
 * … do nothing`, so a run whose entry already exists is absorbed and the real
 * number can be lower. The screen says "up to N" for that reason: overstating
 * what a catch-up will do is a warning, understating it is a surprise.
 *
 * The archived-track case is NOT modelled here and cannot be: 0002's version of
 * the pass also requires `coalesce(t.archived, false) = false`, and this module
 * has no track rows. The caller knows the track and suppresses the count.
 */
export function pendingRuns(template: RecurringTemplate, today: IsoDate = todayIso()): number {
  if (!template.active) return 0
  if (!parseIsoDate(template.next_run_on) || !parseIsoDate(today)) return 0

  let run = template.next_run_on
  let count = 0
  while (diffDays(run, today) >= 0 && count < CATCHUP_CAP) {
    count += 1
    const next = advanceRecurrence(
      run,
      template.cadence,
      template.custom_interval_days,
      template.day_of_week,
      template.day_of_month,
    )
    if (diffDays(run, next) <= 0) break
    run = next
  }
  return count
}

// ── the write shape ────────────────────────────────────────────────────────

/**
 * What a caller asks for: a cadence, an anchor, and whatever pins they chose.
 * Every field is the un-normalised value straight out of a form or a parser.
 */
export interface ScheduleInput {
  cadence: Cadence
  nextRunOn: IsoDate
  customIntervalDays: number | null
  dayOfWeek: number | null
  dayOfMonth: number | null
}

/** The five columns as they will actually be stored. */
export interface ResolvedSchedule {
  cadence: Cadence
  customIntervalDays: number | null
  dayOfWeek: number | null
  dayOfMonth: number | null
  nextRunOn: IsoDate
  /** True when the clamp moved the anchor — the editor says so out loud. */
  clamped: boolean
}

/** Whole days inside the bounds, or null. Every one of these columns is `int`. */
function intOrNull(value: number | null | undefined, min: number, max: number): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  const n = Math.trunc(value)
  return n < min || n > max ? null : n
}

/**
 * Same, but CLAMPED into range rather than rejected — used only for the custom
 * interval, which has no natural default to fall back to.
 *
 * Rejecting it would mean falling back to `MIN_INTERVAL_DAYS`, and the failure
 * that produces is the wrong direction: a caller passing 9999 by mistake would
 * get a template that runs EVERY DAY. The two pins are different — an
 * out-of-range weekday or day-of-month is re-derived from the anchor, which is
 * both in range and what the user most likely meant.
 */
function clampInt(value: number | null | undefined, min: number, max: number): number {
  if (value === null || value === undefined || !Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

/**
 * Turn a requested schedule into the row that will be written — the ONE
 * implementation, shared by `api/templates.ts` (which stores it) and the
 * editor's next-runs preview (which shows it).
 *
 * They must not be two implementations. A preview that resolves the pins
 * differently from the writer shows a schedule the template will not follow,
 * and it does so most convincingly in exactly the case that matters: a monthly
 * template anchored on the 31st, where leaving `day_of_month` null is the
 * difference between recovering to the 31st and sticking on the 28th forever.
 *
 * Two rules, both stated in this module's header:
 *
 *  * **Pins the cadence does not read are nulled.** The CHECK constraints
 *    permit a monthly row to carry a `day_of_week`; `advance_recurrence()`
 *    ignores it, so storing one would be a row claiming a rule nothing follows.
 *  * **Pins the cadence DOES read are always written**, derived from the
 *    (already clamped) anchor when the caller did not choose one.
 *
 * `clamp` is the C2 guard and belongs to the ANCHOR, not to the schedule: pass
 * true for a date a human just chose, false for one read back out of the row.
 */
export function resolveSchedule(
  input: ScheduleInput,
  clamp: boolean,
  today: IsoDate = todayIso(),
): ResolvedSchedule {
  const fields = cadenceFields(input.cadence)
  const interval = fields.interval
    ? clampInt(input.customIntervalDays, MIN_INTERVAL_DAYS, MAX_INTERVAL_DAYS)
    : null

  // Clamped BEFORE the pins are derived: a pin taken from a date the clamp is
  // about to move would describe a schedule that never runs.
  const nextRunOn = clamp
    ? clampFirstRun(input.nextRunOn, input.cadence, interval, input.dayOfWeek, input.dayOfMonth, today)
    : input.nextRunOn
  const anchor = parseIsoDate(nextRunOn)

  return {
    cadence: input.cadence,
    customIntervalDays: interval,
    dayOfWeek: fields.dayOfWeek
      ? (intOrNull(input.dayOfWeek, 0, 6) ?? (anchor ? isoWeekday(nextRunOn) : null))
      : null,
    dayOfMonth: fields.dayOfMonth
      ? (intOrNull(input.dayOfMonth, 1, 31) ?? (anchor?.getDate() ?? null))
      : null,
    nextRunOn,
    clamped: nextRunOn !== input.nextRunOn,
  }
}

/**
 * The `due_date` an entry materialised on `runOn` will carry —
 * `v_due := v_next + r.lead_days` (0001:651).
 *
 * The column comment reads "create the entry this many days BEFORE it is due",
 * which is the same sentence from the other end and is the one people misread:
 * `lead_days` is added to the run date, so the item appears on its run date and
 * is due `lead_days` later. Zero means due the day it appears.
 */
export function dueDateFor(runOn: IsoDate, leadDays: number): IsoDate {
  if (!Number.isFinite(leadDays)) return runOn
  return addDays(runOn, Math.trunc(leadDays))
}
