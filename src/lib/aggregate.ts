// PURE bucketing for the dashboard (EXECUTION-PLAN §2.16, W3-DASH).
//
// Every function here takes rows in and hands numbers back. No store, no api,
// no clock, no `t()` — `today` and the SLA matrix arrive as arguments, exactly
// as lib/entrySections.ts and lib/health.ts take theirs, which is what makes the
// whole file testable without a single mock. components/charts/* turn these
// numbers into hand-rolled SVG; this module never knows a pixel.
//
// IT OWNS NO DEFINITION IT COULD HAVE IMPORTED. "Open" is lib/health.isOpen,
// the age buckets are lib/dates.bucketAge, "how long has this been blocked" is
// lib/entrySections.daysInStatus, and the SLA resolution order is
// lib/health.resolveSlaDays. A dashboard that re-derived any of them would
// eventually disagree with the follow-ups screen someone triaged from that
// morning, and a chart that contradicts the list under it is worse than no
// chart.
//
// TWO DELIBERATE WIDENINGS OF THE §2.16 SIGNATURES, both additive:
//
//  1. `openPerTrack` takes the health map and returns a per-health split
//     alongside `count`. The declared row shape `{ trackId, count }` is still
//     satisfied structurally; the stacked bar needs the segments and computing
//     them in a second pass over the same rows would be two answers to one
//     question.
//  2. `loadPerOwner` returns `ownerId`/`ownerName` beside `ownerKey`. The key is
//     an identity for grouping and is deliberately opaque; the label has to come
//     from store/members.memberLabel, which needs the two source columns and
//     cannot parse them back out of a key.
//
// AND ONE ADDITION THE BRIEF REQUIRES: `slaCompliance`, over the RESOLVED
// track × priority window (FIX-BACKLOG S3a). It is the one aggregate here that
// may not read `EntryHealth.sla_breached`: the view has no row for a closed
// entry at all, and `computeHealth` collapses one to the calm shape, so both
// sources answer "false" for every finished item. Compliance is a question
// about work that is already done, and it is computed from `closed_at` against
// the deadline the matrix resolved — see slaCompliance's own note.

import type { Entry, EntryHealth, EntryPriority, EntryUpdate, HealthLevel } from '../types'
import {
  addDays,
  bucketAge,
  diffDays,
  instantToIsoDate,
  type AgeBucket,
  type IsoDate,
} from './dates'
import { daysInStatus } from './entrySections'
import { isOpen, resolveSlaDays, type TrackSlaMap } from './health'

const DAY_MS = 86_400_000

/**
 * Escalating order, used by every stacked series and legend so the ramp reads
 * the same way on every chart. Mirrors components/FilterBar's HEALTH_LEVELS;
 * both are the four members of the frozen `HealthLevel` union in declaration
 * order, and localeReach.test.ts fails if that union ever grows a fifth without
 * a label.
 */
export const HEALTH_ORDER: readonly HealthLevel[] = ['ok', 'stale', 'overdue', 'critical']

/**
 * Severity-first, because that is how a compliance breakdown is read — the row
 * an operations lead looks at first is the one they are judged on. It is NOT
 * store/vocab's FROZEN_KEYS order (low → critical), which is a picker order,
 * and the two are allowed to differ: this array decides row order in one table,
 * the vocabulary decides it in every input.
 */
const PRIORITY_SEVERITY: readonly EntryPriority[] = ['critical', 'high', 'medium', 'low']

/** All-zero health split. A fresh object per call — these are accumulated into. */
function emptyHealthSplit(): Record<HealthLevel, number> {
  return { ok: 0, stale: 0, overdue: 0, critical: 0 }
}

/**
 * The health verdict for a row, defaulting to 'ok'.
 *
 * A missing map entry is 'ok' rather than "unknown", and that is the safe
 * direction: the view returns no row for a closed entry and has not yet
 * answered for an optimistic one, and inventing a fifth "unknown" segment would
 * put a grey band on every chart for the 300 ms before the first fetch lands.
 */
function healthOf(health: ReadonlyMap<string, EntryHealth>, id: string): HealthLevel {
  return health.get(id)?.health ?? 'ok'
}

// ── open work, per track ───────────────────────────────────────────────────

export interface TrackLoad {
  /** null is the untracked pile — `entries.track_id` is `on delete set null`. */
  trackId: string | null
  /** Open entries filed here. Equals the sum of `byHealth`. */
  count: number
  byHealth: Record<HealthLevel, number>
}

/**
 * Open entries per track, biggest first, with the untracked pile ALWAYS LAST
 * however big it is.
 *
 * Pinning it is a readability decision, not a sort bug: "No track" is not a
 * track, and letting it float into the middle of an ordered bar chart makes the
 * ranking of the real tracks harder to read for no gain. The id tiebreak keeps
 * two equal tracks from swapping places between renders.
 *
 * Tracks with no open work DO NOT appear — this counts what is there, and a
 * caller wanting a bar per configured track (the chart does) merges this
 * against store/config's active list, which is the only place that knows the
 * full set and its display order.
 */
export function openPerTrack(
  entries: Entry[],
  health: ReadonlyMap<string, EntryHealth>,
): TrackLoad[] {
  const byTrack = new Map<string, TrackLoad>()
  for (const e of entries) {
    if (!isOpen(e.status)) continue
    // '' can never be a uuid, so it is a safe stand-in for null inside a Map
    // keyed by string — and it keeps the untracked pile in the same pass.
    const key = e.track_id ?? ''
    let row = byTrack.get(key)
    if (!row) {
      row = { trackId: e.track_id, count: 0, byHealth: emptyHealthSplit() }
      byTrack.set(key, row)
    }
    row.count += 1
    row.byHealth[healthOf(health, e.id)] += 1
  }
  return [...byTrack.values()].sort((a, b) => {
    if (a.trackId === null) return 1
    if (b.trackId === null) return -1
    return b.count - a.count || (a.trackId < b.trackId ? -1 : 1)
  })
}

// ── aging ──────────────────────────────────────────────────────────────────

/**
 * Which clock the aging histogram reads.
 *
 * 'created' is the classic backlog aging report: how long has this work been
 * alive. 'activity' is how long it has been silent, which is the same clock
 * `v_entry_health.days_since_activity` runs and the same one the age pill on
 * every row shows.
 *
 * BOTH SHIP because they answer different questions and a dashboard that only
 * offers one invites the reader to assume it is the other. The chart puts a
 * two-chip switch on it and names the clock in its own description.
 */
export type AgeBasis = 'created' | 'activity'

/**
 * Open entries, bucketed 0-3 / 4-7 / 8-14 / 15+.
 *
 * The bucket edges are lib/dates.bucketAge's, not this file's, so the histogram
 * column and an age pill can never disagree about where 7 days lands.
 *
 * On the 'activity' basis the VIEW IS PREFERRED — `days_since_activity` is the
 * number the server computed and every pill on every list already shows — and
 * the local subtraction is the fallback for optimistic, offline and temp-id
 * rows the view has never seen. Same precedence store/entries.derive() uses,
 * for the same reason.
 */
export function agingHistogram(
  entries: Entry[],
  health: ReadonlyMap<string, EntryHealth>,
  today: IsoDate,
  basis: AgeBasis = 'created',
): Record<AgeBucket, number> {
  const out: Record<AgeBucket, number> = { '0-3': 0, '4-7': 0, '8-14': 0, '15+': 0 }
  for (const e of entries) {
    if (!isOpen(e.status)) continue
    out[bucketAge(ageOf(e, health, today, basis))] += 1
  }
  return out
}

function ageOf(
  e: Entry,
  health: ReadonlyMap<string, EntryHealth>,
  today: IsoDate,
  basis: AgeBasis,
): number {
  if (basis === 'created') {
    return Math.max(0, diffDays(instantToIsoDate(e.created_at), today))
  }
  const server = health.get(e.id)?.days_since_activity
  if (typeof server === 'number') return Math.max(0, server)
  return Math.max(0, diffDays(instantToIsoDate(e.last_activity_at), today))
}

// ── throughput ─────────────────────────────────────────────────────────────

export interface ThroughputPoint {
  /** The bucket's first day. For the daily series that IS the day. */
  day: IsoDate
  created: number
  closed: number
}

/**
 * Created vs closed, one point per calendar day in `[from, to]` inclusive.
 *
 * DAYS WITH NO ACTIVITY ARE EMITTED AS ZEROES rather than skipped: a line or a
 * bar series that silently drops empty days compresses a quiet fortnight into
 * one gap and misreports the shape of the week.
 *
 * The two clocks are `created_at` and `closed_at`, both reduced to a calendar
 * day in the reader's timezone by lib/dates.instantToIsoDate — the ±1 day drift
 * that file's header documents and accepts applies here too, and it is the same
 * drift every age pill in the app already carries.
 *
 * `closed_at` and not `status`: the entries_set_closed_at() trigger maintains
 * that column in both directions, so a reopened item stops counting as closed
 * without anything here knowing that reopening is possible.
 */
export function throughput(entries: Entry[], from: IsoDate, to: IsoDate): ThroughputPoint[] {
  return bucketThroughput(entries, from, to, 1)
}

/**
 * The same series in 7-day buckets, which is what an 8-week chart can actually
 * render — 56 day columns on a 375px viewport is 6px per column with no room
 * for a label.
 *
 * `from` MUST be the first day of a week the caller chose (lib/dates.weekBounds
 * decides where a week starts — Sunday for this team, see that function). This
 * function does not re-align it: silently moving the window would make the
 * chart's first bucket disagree with the range the caller printed in its own
 * subtitle.
 */
export function throughputByWeek(entries: Entry[], from: IsoDate, to: IsoDate): ThroughputPoint[] {
  return bucketThroughput(entries, from, to, 7)
}

function bucketThroughput(
  entries: Entry[],
  from: IsoDate,
  to: IsoDate,
  span: number,
): ThroughputPoint[] {
  const points: ThroughputPoint[] = []
  const index = new Map<IsoDate, ThroughputPoint>()
  // A caller that inverts the range gets an empty series, not an infinite loop.
  for (let start = from; start <= to; start = addDays(start, span)) {
    const point: ThroughputPoint = { day: start, created: 0, closed: 0 }
    points.push(point)
    index.set(start, point)
  }
  if (points.length === 0) return points

  const last = points[points.length - 1].day
  const bucketFor = (iso: IsoDate): ThroughputPoint | undefined => {
    if (iso < from || iso > to) return undefined
    if (span === 1) return index.get(iso)
    // Integer division by the span, anchored on `from`, so this is O(1) per row
    // rather than a scan of the bucket list.
    const offset = Math.floor(diffDays(from, iso) / span) * span
    return index.get(addDays(from, offset)) ?? index.get(last)
  }

  for (const e of entries) {
    const createdBucket = bucketFor(instantToIsoDate(e.created_at))
    if (createdBucket) createdBucket.created += 1
    if (e.closed_at === null) continue
    const closedBucket = bucketFor(instantToIsoDate(e.closed_at))
    if (closedBucket) closedBucket.closed += 1
  }
  return points
}

// ── load per owner ─────────────────────────────────────────────────────────

export interface OwnerLoad {
  /**
   * The grouping identity, opaque by design. A profile id for a teammate,
   * `name:<free text>` for a vendor, `''` for unassigned. The two source
   * columns ride along because store/members.memberLabel() resolves the label
   * from them, and parsing a key back apart would be a second encoding to keep
   * in step.
   */
  ownerKey: string
  ownerId: string | null
  ownerName: string | null
  open: number
  overdue: number
  stale: number
}

/**
 * Open work per owner, heaviest first, with the unassigned pile pinned LAST for
 * the same reason the untracked track is — it is a gap in the data, not a
 * person, and sorting it into the middle of a roster reads as a teammate.
 *
 * `overdue` and `stale` are read off the health map rather than recomputed, so
 * a row here and the pill on the same entry in follow-ups can never disagree.
 * They are SUBSETS of `open`, not extra columns to add up: an item can be both
 * overdue and quiet, and it is counted once in each.
 *
 * `ctx` carries `meId`, which this function does not read today. It is in the
 * §2.16 signature and stays because "my load vs the team's" is one line here
 * and a breaking change to every call site later.
 */
export function loadPerOwner(
  entries: Entry[],
  health: ReadonlyMap<string, EntryHealth>,
  _ctx: { meId: string | null; today: IsoDate },
): OwnerLoad[] {
  const byOwner = new Map<string, OwnerLoad>()
  for (const e of entries) {
    if (!isOpen(e.status)) continue
    const free = (e.owner_name ?? '').trim()
    const key = e.owner_id !== null ? e.owner_id : free !== '' ? `name:${free}` : ''
    let row = byOwner.get(key)
    if (!row) {
      row = {
        ownerKey: key,
        ownerId: e.owner_id,
        ownerName: free !== '' ? free : null,
        open: 0,
        overdue: 0,
        stale: 0,
      }
      byOwner.set(key, row)
    }
    row.open += 1
    const h = health.get(e.id)
    if (h && h.days_overdue > 0) row.overdue += 1
    if (h?.health === 'stale') row.stale += 1
  }
  return [...byOwner.values()].sort((a, b) => {
    if (a.ownerKey === '') return 1
    if (b.ownerKey === '') return -1
    return b.open - a.open || (a.ownerKey < b.ownerKey ? -1 : 1)
  })
}

// ── blockers ───────────────────────────────────────────────────────────────

export interface Blocker {
  entry: Entry
  /** Days held in its current status — lib/entrySections.daysInStatus. */
  days: number
}

/**
 * The longest-standing blocked items, longest first.
 *
 * "Blocked" HERE MEANS `blocked` OR `waiting_on`, matching
 * bucketFollowUps' blocked section exactly — both mean "someone else owes us
 * something", and the number on this dashboard has to equal the number in the
 * section a reader will click through to. (Note that
 * store/entries.countEntries.blocked counts only `blocked`; that pill answers a
 * narrower question and is not what this tile reports.)
 *
 * `updates` is the store's thread map, which is mostly EMPTY on a dashboard —
 * threads load lazily, per entry, when a sheet opens. daysInStatus falls back to
 * `created_at` for an unloaded thread, which understates nothing and overstates
 * only an item that was blocked long after it was raised. Passing the map
 * anyway costs nothing and makes the answer sharper for every entry the reader
 * has already opened.
 */
export function oldestBlockers(
  entries: Entry[],
  updates: ReadonlyMap<string, EntryUpdate[]>,
  today: IsoDate,
  n: number,
): Blocker[] {
  const out: Blocker[] = []
  for (const e of entries) {
    if (e.status !== 'blocked' && e.status !== 'waiting_on') continue
    out.push({ entry: e, days: daysInStatus(e, updates.get(e.id), today) })
  }
  out.sort((a, b) => b.days - a.days || (a.entry.id < b.entry.id ? -1 : 1))
  return n <= 0 ? [] : out.slice(0, n)
}

// ── SLA compliance ─────────────────────────────────────────────────────────

export interface SlaComplianceRow {
  priority: EntryPriority
  measured: number
  met: number
}

export interface SlaCompliance {
  /** Resolved entries in the window that HAD an SLA. The denominator. */
  measured: number
  met: number
  breached: number
  /** Resolved in the window with no SLA at either level. Never in the rate. */
  unmeasured: number
  /** `met / measured`, 0–1. NULL when nothing was measurable — not zero. */
  rate: number | null
  /** Severity order, and only priorities that actually resolved something. */
  byPriority: SlaComplianceRow[]
}

export interface SlaComplianceOptions {
  /** The track × priority matrix (lib/health.buildTrackSlaMap), or null before
   *  it has loaded — treated as "no overrides", never as "no SLA". */
  overrides: TrackSlaMap | null
  /** `vocab_options.sla_days` for a priority; null when none is armed. */
  priorityDefault: (p: EntryPriority) => number | null
  /** Inclusive calendar window over `closed_at`. */
  from: IsoDate
  to: IsoDate
}

/**
 * What share of the work we finished in this window met the service commitment
 * we had made about it.
 *
 * THE MATRIX, NOT THE PRIORITY DEFAULT (FIX-BACKLOG S3a). The deadline per
 * entry is `resolveSlaDays(track, priority, overrides, default)` — the track's
 * promise, then the workspace's, then none — which is the same coalesce
 * `v_entry_health` performs and the same one lib/health documents. Feeding this
 * the priority default alone would report a workspace with track overrides as
 * compliant against a commitment it never made.
 *
 * WHY IT CANNOT READ `sla_breached`. The view has no row for a done entry, and
 * computeHealth() deliberately collapses a closed one to the calm shape, so
 * both sources say `false` for every finished item — which would read as 100%
 * compliance, forever. The verdict here is `closed_at <= created_at + slaDays`,
 * with the SAME strict boundary the view uses (`now() > sla_due_at` is the
 * breach, so landing exactly on the deadline is a MET commitment, not a missed
 * one; health.test.ts asserts that boundary from the other side).
 *
 * RESOLVED MEANS `done`, NOT `done` OR `cancelled`. Abandoned work is not a
 * commitment kept or missed, and counting a cancellation as an on-time delivery
 * is the single easiest way to make this number flattering and useless.
 *
 * `unmeasured` is reported rather than folded in, because a rate of 100% over
 * two items and a rate of 100% over two hundred are different facts, and so is
 * "we shipped forty things and had promised nothing about any of them" — the
 * seeded state, since migration 0005 ships every priority's sla_days NULL.
 */
export function slaCompliance(entries: Entry[], o: SlaComplianceOptions): SlaCompliance {
  const rows = new Map<EntryPriority, SlaComplianceRow>()
  let measured = 0
  let met = 0
  let unmeasured = 0

  for (const e of entries) {
    if (e.status !== 'done' || e.closed_at === null) continue
    const closedOn = instantToIsoDate(e.closed_at)
    if (closedOn < o.from || closedOn > o.to) continue

    const days = resolveSlaDays(e.track_id, e.priority, o.overrides, o.priorityDefault(e.priority))
    if (days === null) {
      unmeasured += 1
      continue
    }
    const created = Date.parse(e.created_at)
    const closed = Date.parse(e.closed_at)
    // A row whose timestamps will not parse cannot be judged either way. It is
    // counted as unmeasured rather than dropped, so the totals on this card
    // still add up to the work that was actually finished.
    if (Number.isNaN(created) || Number.isNaN(closed)) {
      unmeasured += 1
      continue
    }

    let row = rows.get(e.priority)
    if (!row) {
      row = { priority: e.priority, measured: 0, met: 0 }
      rows.set(e.priority, row)
    }
    measured += 1
    row.measured += 1
    if (closed <= created + days * DAY_MS) {
      met += 1
      row.met += 1
    }
  }

  return {
    measured,
    met,
    breached: measured - met,
    unmeasured,
    rate: measured === 0 ? null : met / measured,
    byPriority: PRIORITY_SEVERITY.filter((p) => rows.has(p)).map(
      (p) => rows.get(p) as SlaComplianceRow,
    ),
  }
}
