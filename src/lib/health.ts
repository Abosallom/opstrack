// The client-side mirror of `v_entry_health`.
//
// It exists because optimistic rows, offline rows and temp-id rows have no view
// row yet, and a follow-ups screen that shows nothing until the server answers
// is not a follow-ups screen. `store/entries.ts` PREFERS the server view row and
// falls back to computeHealth().
//
// THE VIEW IS AUTHORITATIVE and this module is a display-only mirror: it never
// decides what "stale" means, it reproduces what 0001/0003 already decided.
// PARITY IS THE WHOLE POINT and it is a test, not a hope — health.test.ts runs
// UTC-anchored fixtures against a fixed injected `now` and must match the view
// exactly. The live comparison in the Wave-1 gate tolerates ±1 day on
// days_since_activity; see lib/dates.ts's header for why that drift is accepted
// rather than fixed. Do not "fix" it by switching this file to UTC — "due today"
// has to mean the user's today.
//
// TWO INPUTS THE VIEW READS FROM vocab_options AND THIS FUNCTION CANNOT:
// `staleAfterDays` and `slaDays` for the entry's priority. They are passed in
// rather than looked up because lib/** may not import from store/** — the
// caller resolves them through store/vocab's staleDays()/slaDays().
//
// STALENESS AND SLA ARE DIFFERENT QUESTIONS and neither substitutes for the
// other. Staleness measures SILENCE, from last_activity_at. The SLA measures
// ELAPSED TIME, from created_at. An item updated hourly for a month is never
// stale and can still blow its SLA; an item finished in an hour and then ignored
// is stale and never breaches. Both facts ride the row because both get asked.

import type { Entry, EntryHealth, EntryStatus, HealthLevel } from '../types'
import { diffDays, instantToIsoDate, todayIso } from './dates'

/**
 * The two statuses the view excludes. THE source of truth for "open" — nothing
 * else in the repo may hard-code this pair, or a seventh status added to the
 * schema would need finding in a dozen files.
 */
export const CLOSED_STATUSES: readonly EntryStatus[] = ['done', 'cancelled']

export function isOpen(status: EntryStatus): boolean {
  return !CLOSED_STATUSES.includes(status)
}

const DAY_MS = 86_400_000

/**
 * @param staleAfterDays this priority's threshold, from vocab_options (the view
 *                       coalesces the same column over 2/4/8/15).
 * @param slaDays        this priority's SLA, or null when it has none. Null
 *                       means `sla_due_at: null` and `sla_breached: false`, and
 *                       this function NEVER substitutes a default: whether a
 *                       priority carries an SLA is the workspace's decision,
 *                       held in vocab_options, and a client-side fallback would
 *                       silently overrule it on every screen at once.
 * @param now            injected so every test is a fixed-clock assertion; the
 *                       default is the only clock read in this module.
 *
 * Precedence, mirroring the view exactly: overdue always outranks stale, and
 * `critical` is overdue-AND-priority-critical rather than a fifth threshold.
 *
 * CLOSED ENTRIES. The view has no row for done/cancelled and this signature
 * cannot return "no row", so a closed entry collapses to the CALM shape —
 * health 'ok', days_overdue 0, sla_breached false — while keeping the facts that
 * stay true (its age, and its SLA deadline if one was set). That direction is
 * deliberate: a caller who forgets to gate on isOpen() gets a quiet screen
 * rather than finished work shouting on the follow-ups list, and "was this
 * closed late" is a closed_at-vs-due_date question, not a question for a row
 * whose whole subject is what still needs attention.
 */
export function computeHealth(
  e: Entry,
  staleAfterDays: number,
  slaDays: number | null,
  now: Date = new Date(),
): EntryHealth {
  const today = todayIso(now)
  const open = isOpen(e.status)

  // greatest(0, current_date - last_activity_at::date) in the view. Clamped
  // because a row written by a device with a fast clock would otherwise report a
  // negative age, and every consumer formats this straight into "Nd".
  const daysSinceActivity = Math.max(0, diffDays(instantToIsoDate(e.last_activity_at), today))

  // ISO dates compare correctly as plain strings — 'YYYY-MM-DD' is
  // lexicographically ordered by construction — so this is the view's
  // `e.due_date < current_date` with no parse in the middle to get a timezone
  // wrong.
  const overdue = open && e.due_date !== null && e.due_date < today
  const daysOverdue = overdue && e.due_date !== null ? Math.max(0, diffDays(e.due_date, today)) : 0

  let health: HealthLevel = 'ok'
  if (overdue) health = e.priority === 'critical' ? 'critical' : 'overdue'
  else if (open && daysSinceActivity >= staleAfterDays) health = 'stale'

  const slaDueAt = slaDeadline(e.created_at, slaDays)
  // STRICT `>`, mirroring the view's `now() > sla_due_at`: at exactly the
  // deadline the commitment has been met, not missed. health.test.ts asserts
  // that boundary because it is the kind of off-by-one that only surfaces in a
  // compliance report someone has already sent.
  const slaBreached = open && slaDueAt !== null && now.getTime() > Date.parse(slaDueAt)

  return {
    id: e.id,
    entry_id: e.id,
    track_id: e.track_id,
    status: e.status,
    priority: e.priority,
    due_date: e.due_date,
    last_activity_at: e.last_activity_at,
    days_since_activity: daysSinceActivity,
    days_overdue: daysOverdue,
    health,
    sla_due_at: slaDueAt,
    sla_breached: slaBreached,
  }
}

/**
 * `created_at + sla_days`, as an INSTANT — an SLA is a clock commitment, not a
 * calendar one, which is why it does not go through lib/dates' date helpers.
 *
 * The string is `Date.toISOString()`, which is NOT byte-identical to how
 * Postgres renders the same timestamptz. Consumers parse it; nothing may
 * string-compare it against a value that came from the view.
 *
 * A `created_at` that will not parse yields null rather than an Invalid Date
 * whose toISOString() throws. This runs on the render path of every list row: a
 * malformed row must cost that row its badge, not the screen.
 */
function slaDeadline(createdAt: string, slaDays: number | null): string | null {
  if (slaDays === null) return null
  const created = Date.parse(createdAt)
  if (Number.isNaN(created)) return null
  return new Date(created + slaDays * DAY_MS).toISOString()
}
