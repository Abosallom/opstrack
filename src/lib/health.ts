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
// TWO INPUTS THE VIEW READS FROM OTHER TABLES AND THIS FUNCTION CANNOT:
// `staleAfterDays` (vocab_options, for the entry's priority) and `slaDays` (the
// track × priority matrix — see resolveSlaDays below). They are passed in rather
// than looked up because lib/** may not import from store/** — the caller
// resolves them through store/vocab's staleDays() and through resolveSlaDays().
//
// STALENESS AND SLA ARE DIFFERENT QUESTIONS and neither substitutes for the
// other. Staleness measures SILENCE, from last_activity_at. The SLA measures
// ELAPSED TIME, from created_at. An item updated hourly for a month is never
// stale and can still blow its SLA; an item finished in an hour and then ignored
// is stale and never breaches. Both facts ride the row because both get asked.

import type { Entry, EntryHealth, EntryPriority, EntryStatus, HealthLevel } from '../types'
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

// ── the SLA matrix ─────────────────────────────────────────────────────────
//
// 0006 made the SLA a track × priority matrix, and this block is the client
// mirror of the `coalesce(ts.sla_days, vp.sla_days)` in v_entry_health. The
// order is the whole feature and it reads correctly out loud:
//
//   this track's promise for this priority
//     → the workspace's default for this priority
//       → this priority has no SLA
//
// It is a separate function rather than two more parameters on computeHealth()
// because the two answers have different lifetimes: the matrix is fetched once
// and shared by every row on a screen, while computeHealth runs per row. Callers
// build the map once (buildTrackSlaMap) and hand the resolved number down.

/**
 * One row of `track_slas`, in the column names the table uses.
 *
 * It lives HERE rather than in api/tracks.ts because lib/** may not import from
 * api/** and this is the module that consumes the shape; api/tracks.ts imports
 * and re-exports it, so there is still exactly one definition to import.
 */
export interface TrackSlaRule {
  track_id: string
  priority: EntryPriority
  sla_days: number
}

/**
 * The matrix, flattened to `${trackId}:${priority}` — the same trick
 * store/vocab.ts uses for vocab_options' composite key, and for the same
 * reason: a nested Map costs two lookups and a null check at every call site.
 */
export type TrackSlaMap = ReadonlyMap<string, number>

export function trackSlaKey(trackId: string, priority: EntryPriority): string {
  return `${trackId}:${priority}`
}

/**
 * Build the lookup once per fetch. NEVER call this inside a React selector or a
 * render body: it returns a fresh Map every time, which under
 * useSyncExternalStore means "the snapshot changed" forever — the hazard
 * store/config.ts's header documents.
 *
 * A duplicate (track_id, priority) cannot reach here from the database — it is
 * the primary key — so last-wins on collision needs no ceremony.
 */
export function buildTrackSlaMap(rules: readonly TrackSlaRule[]): TrackSlaMap {
  return new Map(rules.map((r) => [trackSlaKey(r.track_id, r.priority), r.sla_days]))
}

/**
 * `coalesce(ts.sla_days, vp.sla_days)`, in TypeScript.
 *
 * @param trackId         the entry's track, or null. A null track_id matches
 *                        nothing and falls through to the default — the view's
 *                        left join behaves identically, and entries.track_id is
 *                        `on delete set null`, so this is a real case and not a
 *                        defensive one.
 * @param overrides       the matrix from buildTrackSlaMap, or null/undefined
 *                        before it has loaded. NOT loaded is treated as NO
 *                        override, which is the safe direction: the screen shows
 *                        the workspace default for a beat rather than inventing
 *                        a breach, and re-renders when the fetch lands.
 * @param priorityDefault `vocab_options.sla_days` for this priority — null when
 *                        the workspace has not armed one.
 *
 * Returns null when neither level carries a number, and that null is a VALUE
 * meaning "no SLA", never a missing answer. Nothing downstream may `?? 7` it.
 */
export function resolveSlaDays(
  trackId: string | null,
  priority: EntryPriority,
  overrides: TrackSlaMap | null | undefined,
  priorityDefault: number | null,
): number | null {
  const override = trackId === null ? undefined : overrides?.get(trackSlaKey(trackId, priority))
  return override ?? priorityDefault
}

/**
 * @param staleAfterDays this priority's threshold, from vocab_options (the view
 *                       coalesces the same column over 2/4/8/15).
 * @param slaDays        the RESOLVED SLA for this entry — resolveSlaDays()'s
 *                       answer, not the raw priority default. Null
 *                       means `sla_due_at: null` and `sla_breached: false`, and
 *                       this function NEVER substitutes a default: whether a
 *                       track or a priority carries an SLA is the workspace's
 *                       decision, held in track_slas and vocab_options, and a
 *                       client-side fallback would silently overrule it on every
 *                       screen at once.
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
