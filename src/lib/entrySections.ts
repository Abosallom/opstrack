// THE one definition of "needs attention". Follow-ups renders these sections
// directly, the board uses them for its section counts, the dashboard counts
// them and the digest groups by them. If any of those four computed its own
// buckets, the follow-ups screen and the digest sent from it would disagree
// about what is overdue, which is the single most corrosive kind of bug this
// product can have.
//
// PURE. Health rows come in as a map and `today`/`staleDays` come in on the
// context, so this module never reads a store, a clock or the network — and the
// tests need no mocks at all.

import type { Entry, EntryPriority, EntryUpdate, EntryHealth } from '../types'
import { addDays, diffDays, instantToIsoDate, type IsoDate } from './dates'
import { isOpen } from './health'

/**
 * `staleDays` is injected rather than imported because lib/** may not read
 * store/** — the caller resolves it through store/vocab's staleDays(), so an
 * admin's edited threshold reaches this function without breaking the layering
 * that makes it testable with no mocks.
 */
export interface SectionContext {
  meId: string | null
  today: IsoDate
  staleDays: (p: EntryPriority) => number
  weekStartsOn?: 0 | 1 | 6
}

export interface FollowUpSections {
  overdue: Entry[]
  /**
   * Inside its due date, past its SLA. Ordered immediately after `overdue`
   * because it is the same kind of fact — a commitment already missed — and
   * ahead of dueSoon, which is a commitment that can still be kept.
   */
  slaBreach: Entry[]
  dueSoon: Entry[]
  stale: Entry[]
  blocked: Entry[]
  unassigned: Entry[]
}

/**
 * How far ahead "due soon" reaches, as a ROLLING window rather than "the rest of
 * this week". A week-bounded section empties out every Wednesday and is at its
 * thinnest on Thursday — exactly when the person checking it most needs to see
 * what is landing. `weekStartsOn` stays on the context for the screens that
 * genuinely group by calendar week; this section does not.
 */
export const DUE_SOON_DAYS = 7

/**
 * An entry appears in AT MOST ONE section, in the spec's priority order, with
 * the SLA bucket inserted after overdue:
 *   overdue > slaBreach > dueSoon > stale > blocked > unassigned
 *
 * The single-section rule is not a display detail — an item counted twice makes
 * the section totals not add up to the list length, and the first thing anyone
 * does with a follow-ups screen is add the numbers.
 *
 * CLOSED ENTRIES ARE NEVER BUCKETED. v_entry_health has no row for them and
 * "needs attention" is not a question about finished work; a caller wanting
 * closed items wants a list, not this.
 *
 * Input order is preserved inside each bucket. Ordering is the caller's
 * business — entryFilter.sortEntries owns it, and a sort baked in here would
 * quietly override the one the screen chose.
 */
export function bucketFollowUps(
  entries: Entry[],
  health: ReadonlyMap<string, EntryHealth>,
  ctx: SectionContext,
): FollowUpSections {
  const sections: FollowUpSections = {
    overdue: [],
    slaBreach: [],
    dueSoon: [],
    stale: [],
    blocked: [],
    unassigned: [],
  }
  const horizon = addDays(ctx.today, DUE_SOON_DAYS)

  for (const e of entries) {
    if (!isOpen(e.status)) continue
    const h = health.get(e.id)

    // The view is authoritative when it has spoken. The fallback exists for
    // optimistic, offline and temp-id rows, which have no view row yet and must
    // still land in the right section the instant they are captured.
    const dueLapsed = h !== undefined ? h.days_overdue > 0 : isPast(e.due_date, ctx.today)
    // follow_up_date is NOT in v_entry_health, so this half is always local. A
    // follow-up date is a promise to look again; a lapsed one is overdue in
    // exactly the sense this screen means, and the whole point of snoozing is
    // that the item comes back.
    const followLapsed = isPast(e.follow_up_date, ctx.today)

    if (dueLapsed || followLapsed) {
      sections.overdue.push(e)
      continue
    }
    if (h?.sla_breached === true) {
      sections.slaBreach.push(e)
      continue
    }
    if (withinHorizon(e.due_date, ctx.today, horizon) || withinHorizon(e.follow_up_date, ctx.today, horizon)) {
      sections.dueSoon.push(e)
      continue
    }
    const stale =
      h !== undefined
        ? h.health === 'stale'
        : daysSinceActivity(e, ctx.today) >= ctx.staleDays(e.priority)
    if (stale) {
      sections.stale.push(e)
      continue
    }
    // waiting_on rides with blocked: both mean "someone else owes us something",
    // and splitting them makes two thin sections that answer one question.
    if (e.status === 'blocked' || e.status === 'waiting_on') {
      sections.blocked.push(e)
      continue
    }
    if (e.owner_id === null && (e.owner_name ?? '').trim() === '') {
      sections.unassigned.push(e)
    }
  }

  return sections
}

/** ISO dates compare correctly as strings, so no parse can get a timezone wrong. */
function isPast(date: string | null, today: IsoDate): boolean {
  return date !== null && date < today
}

function withinHorizon(date: string | null, today: IsoDate, horizon: IsoDate): boolean {
  return date !== null && date >= today && date <= horizon
}

function daysSinceActivity(e: Entry, today: IsoDate): number {
  return Math.max(0, diffDays(instantToIsoDate(e.last_activity_at), today))
}

/**
 * How long this entry has held its current status.
 *
 * Reads the thread's transition rows when they are loaded and falls back to the
 * entry alone when they are not — the sheet has them, a list of 200 rows does
 * not, and neither may block on the other.
 *
 * The fallback is `created_at`, NOT `last_activity_at`. An entry commented on
 * daily has not changed status, and last_activity_at would report 0 days in
 * status for something stuck for a month — the exact opposite of the question
 * being asked. The same reasoning picks the LATEST transition into the current
 * status rather than the latest transition of any kind: an item that went
 * blocked, unblocked, then blocked again has been blocked since the third move.
 */
export function daysInStatus(
  e: Entry,
  updates: EntryUpdate[] | undefined,
  today: IsoDate,
): number {
  let sinceMs = Date.parse(e.created_at)
  if (updates) {
    for (const u of updates) {
      if (u.status_to !== e.status) continue
      const at = Date.parse(u.created_at)
      // Compared as numbers, not strings: entry_updates.created_at is a
      // timestamptz and PostgREST's rendering of the offset is not something to
      // bet a lexicographic comparison on.
      if (!Number.isNaN(at) && (Number.isNaN(sinceMs) || at > sinceMs)) sinceMs = at
    }
  }
  if (Number.isNaN(sinceMs)) return 0
  return Math.max(0, diffDays(instantToIsoDate(new Date(sinceMs).toISOString()), today))
}
