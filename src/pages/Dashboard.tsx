// The dashboard — six answers about the whole workspace at once.
//
// IT COMPUTES NOTHING. Every number on this screen comes out of
// `lib/aggregate.ts`, which is pure and tested, and every definition inside
// that module is imported from wherever the app already decided it: "open" is
// lib/health.isOpen, the age buckets are lib/dates.bucketAge, "blocked" is
// bucketFollowUps' blocked section, the SLA window is
// lib/health.resolveSlaDays. This file's whole job is to choose a window,
// resolve labels, and hand numbers to components/charts. That is the only way a
// chart and the list a reader clicks through to can be guaranteed to agree, and
// disagreeing is the one failure that makes a dashboard worse than nothing.
//
// ONE WINDOW, STATED ONCE, USED BY EVERYTHING WITH A CLOCK. The weeks switcher
// sets `from`/`to`; throughput buckets inside it and SLA compliance measures
// what was resolved inside it. The three panels with no clock (open per track,
// aging, load per owner) describe the CURRENT open set and say so in their own
// descriptions — mixing a windowed and an instantaneous number under one
// heading is how a "12" in one card fails to reconcile with a "9" in the next.
//
// THE SLA MATRIX COMES FROM store/entries, AND THAT SEAM IS NOW CLOSED.
// `track_slas` (migration 0006) is the track half of the SLA. This screen used
// to fetch it privately, because `store/entries.derive()` fed computeHealth the
// PRIORITY DEFAULT and compliance could not inherit that bug — which left the
// board and the dashboard holding two different answers to one question, the
// moment an admin wrote the first override. The store owns the matrix now
// (FIX-BACKLOG **SLA-MATRIX**), so both read the same Map from the same fetch
// and `useTrackSlaMatrix()` here is a selector, not a loader.
//
// WHY IT CANNOT JUST READ `sla_breached` ANYWAY: the view returns no row for a
// closed entry and computeHealth() collapses one to the calm shape, so both
// sources answer `false` for every finished item — which would render as
// permanent 100% compliance. lib/aggregate.slaCompliance explains the
// `closed_at <= created_at + slaDays` verdict it uses instead.
//
// SCOPE IS FORCED TO 'all', because half the panels are about closed work.
// Each aggregate applies its own open/closed rule, so the filter must not
// pre-decide one for them.

import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { Link } from 'react-router-dom'
import FilterBar, { type FilterFacet } from '../components/FilterBar'
import {
  AgingChart,
  OwnerLoadTable,
  SlaChart,
  SlaHeadline,
  ThroughputChart,
  TrackLoadChart,
  type OwnerLoadRow,
  type TrackLoadRow,
} from '../components/charts'
import { IconChart } from '../components/icons'
import { EmptyState } from '../components/shared'
import {
  agingHistogram,
  loadPerOwner,
  oldestBlockers,
  openPerTrack,
  slaCompliance,
  throughputByWeek,
  type AgeBasis,
} from '../lib/aggregate'
import { addDays, formatDateRange, todayIso, weekBounds } from '../lib/dates'
import { EMPTY_FILTER, type FilterState } from '../lib/entryFilter'
import { t, useLocale } from '../lib/i18n'
import { useTrackLabel } from '../lib/labels'
import { trackVars } from '../lib/trackStyle'
import { useActiveTracks, useTrackMap } from '../store/config'
import {
  countEntries,
  loadClosedSince,
  loadEntries,
  loadTrackSlas,
  refreshEntries,
  useClosedEntriesError,
  useEntriesError,
  useEntriesLoading,
  useEntriesTruncated,
  useEntryMap,
  useFilterContext,
  useFilteredEntries,
  useHealthMap,
  useTrackSlaError,
  useTrackSlaMatrix,
} from '../store/entries'
import { memberLabel, useMemberMap } from '../store/members'
import { useSlaDays, useVocabLabel } from '../store/vocab'
import type { EntryUpdate } from '../types'
import './dashboard.css'

/** How many weeks the windowed panels may look back. 8 is the brief's default. */
const WEEK_OPTIONS: readonly number[] = [4, 8, 12]
const DEFAULT_WEEKS = 8

/** How many blockers the tile is willing to name. One, plus the count. */
const NAMED_BLOCKERS = 1

/**
 * Facets this screen offers.
 *
 * No `scope` — see the header, the scope is fixed. No `status`, because status
 * is what three of these panels are measuring and a status facet would let a
 * reader filter the answer out of its own question. No `health` for the same
 * reason: the track chart's bands ARE the health split.
 */
const FACETS: readonly FilterFacet[] = ['search', 'track', 'priority', 'type', 'owner', 'tag', 'mine']

/**
 * Window and age-basis survive navigation without touching storage — the same
 * module-level pref FollowUps.tsx uses for density, and for the same reason:
 * worth keeping while somebody bounces between screens, not worth a persisted
 * key, a migration and a quota failure mode.
 */
let weeksPref = DEFAULT_WEEKS
let basisPref: AgeBasis = 'created'

/** Nothing loads threads on this screen; an empty map is the honest input. */
const NO_UPDATES: ReadonlyMap<string, EntryUpdate[]> = new Map()

export default function Dashboard(): ReactElement {
  const locale = useLocale()
  const [weeks, setWeeks] = useState(weeksPref)
  const [basis, setBasis] = useState<AgeBasis>(basisPref)
  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER)

  const health = useHealthMap()
  const byId = useEntryMap()
  const ctx = useFilterContext()
  const loading = useEntriesLoading()
  const errorKey = useEntriesError()
  const truncated = useEntriesTruncated()
  // The closed window is a SEPARATE read, and three of the panels on this page
  // are computed entirely from its rows — the Closed tile, the throughput chart
  // and SLA compliance. Its failure used to be indistinguishable from a quiet
  // month; see EntriesCoverage.closedError.
  const closedErrorKey = useClosedEntriesError()
  const tracks = useActiveTracks()
  const trackById = useTrackMap()
  const trackLabel = useTrackLabel()
  const members = useMemberMap()
  const vocabLabel = useVocabLabel()
  const priorityDefault = useSlaDays()
  const matrix = useTrackSlaMatrix()
  const matrixError = useTrackSlaError()

  // The window: whole weeks, ending with the one we are in. `weekBounds` is
  // Sunday-anchored because that is where this team's week starts — see it.
  const { from, to } = useMemo(() => {
    const current = weekBounds(new Date(), 0)
    return { from: addDays(current.from, -7 * (weeks - 1)), to: current.to }
  }, [weeks])

  const today = todayIso()

  useEffect(() => {
    void loadEntries()
    // Deduped in the store: the Shell already warms this on sign-in, and a
    // second call from a screen that genuinely needs it costs nothing.
    void loadTrackSlas()
  }, [])

  // Closed rows are NOT in the default working set (api/entries.listEntries is
  // open-only), and throughput and compliance are both questions about closed
  // work. Additive and idempotent: loadClosedSince() short-circuits when a
  // wider window is already covered, so widening 4 → 12 fetches once and
  // narrowing back fetches nothing.
  useEffect(() => {
    void loadClosedSince(from)
  }, [from])

  /**
   * The reader's filter, with scope pinned open-and-closed.
   *
   * PINNED HERE RATHER THAN IN `filter` ITSELF, and the difference is not
   * cosmetic. `countActiveFacets()` counts any scope other than the default as
   * a facet the reader chose, so holding `scope: 'all'` in state made the
   * filter bar claim "1 filter" on a screen nobody had filtered — and worse,
   * its Clear-all button reset the scope to `open`, silently emptying
   * throughput and compliance of every closed row they exist to count. The
   * scope is this screen's contract, not the reader's choice, so it is applied
   * on the way OUT and never shown.
   *
   * A fresh object per render is safe: `useFilteredEntries` memoises on
   * `filterKey()`, which is value identity, not reference identity.
   */
  const scoped = useMemo<FilterState>(() => ({ ...filter, scope: 'all' }), [filter])
  const entries = useFilteredEntries(scoped)

  const counts = useMemo(
    () => countEntries(entries, health, today, addDays(today, 7)),
    [entries, health, today],
  )

  const trackRows = useMemo<TrackLoadRow[]>(() => {
    const loads = openPerTrack(entries, health)
    const byTrack = new Map(loads.map((row) => [row.trackId ?? '', row]))
    // Every ACTIVE track gets a bar, including an empty one — "nothing open on
    // Network this week" is a fact worth seeing, and a track that silently
    // vanishes from the chart reads as a track that was deleted. Archived
    // tracks appear only if they still hold open work, which is the same rule
    // the board's overflow rail follows.
    const rows: TrackLoadRow[] = tracks.map((track) => {
      const load = byTrack.get(track.id)
      byTrack.delete(track.id)
      return {
        key: track.id,
        label: trackLabel(track),
        count: load?.count ?? 0,
        byHealth: load?.byHealth ?? { ok: 0, stale: 0, overdue: 0, critical: 0 },
        vars: trackVars(track.color, track.color_light),
      }
    })
    for (const [key, load] of byTrack) {
      if (key === '') continue
      const track = trackById.get(key)
      rows.push({
        key,
        label: track ? trackLabel(track) : t('dashboard.unknownTrack'),
        count: load.count,
        byHealth: load.byHealth,
        vars: track ? trackVars(track.color, track.color_light) : undefined,
      })
    }
    rows.sort((a, b) => b.count - a.count || (a.label < b.label ? -1 : 1))

    const untracked = byTrack.get('')
    if (untracked) {
      rows.push({
        key: '',
        label: t('dashboard.noTrack'),
        count: untracked.count,
        byHealth: untracked.byHealth,
      })
    }
    return rows
  }, [entries, health, tracks, trackById, trackLabel])

  const histogram = useMemo(
    () => agingHistogram(entries, health, today, basis),
    [entries, health, today, basis],
  )

  const flow = useMemo(() => throughputByWeek(entries, from, to), [entries, from, to])

  /**
   * Closed INSIDE the window, summed off the same series the chart draws.
   *
   * Deliberately NOT `counts.closed`: loadClosedSince() keeps the widest window
   * ever asked for, so a reader who looks at 12 weeks and then switches to 4
   * still has twelve weeks of done rows in the store — and a tile counting all
   * of them would contradict the chart six inches below it.
   */
  const closedInWindow = useMemo(() => flow.reduce((sum, p) => sum + p.closed, 0), [flow])

  const owners = useMemo<OwnerLoadRow[]>(
    () =>
      loadPerOwner(entries, health, ctx).map((row) => ({
        ...row,
        label: memberLabel(members, row.ownerId, row.ownerName),
        unassigned: row.ownerKey === '',
      })),
    [entries, health, ctx, members],
  )

  const blocked = useMemo(() => {
    const all = oldestBlockers(entries, NO_UPDATES, today, Number.MAX_SAFE_INTEGER)
    return { count: all.length, named: all.slice(0, NAMED_BLOCKERS) }
  }, [entries, today])

  const compliance = useMemo(
    () => slaCompliance(entries, { overrides: matrix, priorityDefault, from, to }),
    [entries, matrix, priorityDefault, from, to],
  )

  const onWeeks = (next: number): void => {
    weeksPref = next
    setWeeks(next)
  }
  const onBasis = (next: AgeBasis): void => {
    basisPref = next
    setBasis(next)
  }

  // Nothing at all — a brand-new workspace, not a filter that matched nothing.
  const blank = !loading && errorKey === null && byId.size === 0

  return (
    <div className="db">
      <p className="db-sub">{t('dashboard.subtitle')}</p>

      <FilterBar
        value={filter}
        onChange={setFilter}
        facets={FACETS}
        count={entries.length}
        resultLabel={(n) => t('dashboard.total', { count: n })}
      />

      <div className="db-bar">
        <div className="chip-row db-seg" role="group" aria-label={t('dashboard.windowLabel')}>
          <span className="db-seg-label" aria-hidden="true">
            {t('dashboard.windowLabel')}
          </span>
          {WEEK_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              className="chip"
              aria-pressed={weeks === option}
              onClick={() => onWeeks(option)}
            >
              {t('dashboard.weeksOption', { count: option })}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="btn btn-sm btn-ghost db-refresh"
          onClick={() => void refreshEntries()}
        >
          {t('dashboard.refresh')}
        </button>
        {/* The digest's only entrance, added at integration: /digest is in no
            nav (five tab slots, all taken) and nothing else in the app linked
            to it. It belongs here rather than in Settings because it answers
            the same question this screen does over the same kind of window —
            the difference is that its answer is something you can send. */}
        <Link className="btn btn-sm db-digest" to="/digest">
          {t('dashboard.goDigest')}
        </Link>
      </div>

      {errorKey !== null && (
        <p className="db-error" role="status">
          {t(errorKey)}{' '}
          <button type="button" className="btn btn-sm" onClick={() => void refreshEntries()}>
            {t('common.retry')}
          </button>
        </p>
      )}

      {truncated && (
        <p className="db-note" role="status">
          {t('dashboard.truncated')}
        </p>
      )}

      {/* Page-level, exactly like the truncation notice and for the same
          reason: the reader cannot tell which of the numbers in front of them
          came from the closed window, so the caveat belongs above all of them
          rather than tucked under one chart. Retry is offered here because
          refreshEntries() re-attempts this read specifically — nothing else on
          the screen does short of changing the window. */}
      {closedErrorKey !== null && (
        <p className="db-error" role="status">
          {t('dashboard.closedFailed')}{' '}
          <button type="button" className="btn btn-sm" onClick={() => void refreshEntries()}>
            {t('common.retry')}
          </button>
        </p>
      )}

      {blank ? (
        <EmptyState
          icon={<IconChart size={30} />}
          title={t('dashboard.blank')}
          description={t('dashboard.blankHint')}
          action={
            <Link className="btn btn-primary" to="/capture">
              {t('dashboard.blankCta')}
            </Link>
          }
        />
      ) : (
        <>
          <ul className="db-stats">
            <StatTile
              label={t('dashboard.statOpen')}
              value={counts.open}
              to="/board"
              linkLabel={t('dashboard.goBoard')}
            />
            <StatTile
              label={t('dashboard.statOverdue')}
              value={counts.overdue}
              tone={counts.overdue > 0 ? 'bad' : undefined}
              to="/followups"
              linkLabel={t('dashboard.goFollowups')}
            />
            <StatTile
              label={t('dashboard.statQuiet')}
              value={counts.stale}
              tone={counts.stale > 0 ? 'warn' : undefined}
              to="/followups"
              linkLabel={t('dashboard.goFollowups')}
            />
            <StatTile
              label={t('dashboard.statBlocked')}
              value={blocked.count}
              tone={blocked.count > 0 ? 'warn' : undefined}
              to="/followups"
              linkLabel={t('dashboard.goFollowups')}
              note={
                blocked.named.length > 0
                  ? t('dashboard.blockedOldest', {
                      title: blocked.named[0].entry.title,
                      count: blocked.named[0].days,
                    })
                  : t('dashboard.blockedNone')
              }
            />
            <StatTile
              label={t('dashboard.statUnassigned')}
              value={counts.unassigned}
              to="/followups"
              linkLabel={t('dashboard.goFollowups')}
            />
            <StatTile
              label={t('dashboard.statClosed')}
              value={closedInWindow}
              note={t('dashboard.statClosedNote', { count: weeks })}
            />
          </ul>

          <div className="db-grid">
            <div className="db-cell db-cell-wide">
              <TrackLoadChart rows={trackRows} loading={loading} />
            </div>

            <div className="db-cell">
              <AgingChart
                histogram={histogram}
                basis={basis}
                onBasis={onBasis}
                loading={loading}
              />
            </div>

            <div className="db-cell db-cell-wide">
              <ThroughputChart points={flow} loading={loading} />
            </div>

            <div className="db-cell db-sla">
              <SlaHeadline compliance={compliance} />
              <SlaChart
                compliance={compliance}
                priorityLabel={(p) => vocabLabel('priority', p)}
                loading={loading}
              />
              {matrixError !== null && (
                <p className="db-note" role="status">
                  {t('dashboard.slaMatrixFailed')}
                </p>
              )}
            </div>

            <div className="db-cell db-cell-wide">
              <OwnerLoadTable rows={owners} loading={loading} />
            </div>
          </div>

          <p className="db-footnote">
            {t('dashboard.footnote', { range: formatDateRange(from, to, locale) })}
          </p>
        </>
      )}
    </div>
  )
}

/**
 * One number, its label, and optionally where it goes.
 *
 * A tile that links is a real <Link> rather than a div with an onClick — the
 * whole tile is the target, it must be reachable by keyboard, and the
 * destination has to be visible in the status bar before anyone commits to it.
 * A tile with no destination is a plain <li>, not a disabled link.
 */
function StatTile({
  label,
  value,
  note,
  tone,
  to,
  linkLabel,
}: {
  label: string
  value: number
  note?: string
  tone?: 'warn' | 'bad'
  to?: string
  linkLabel?: string
}): ReactElement {
  const body = (
    <>
      <span className="db-stat-value tabular">{value}</span>
      <span className="db-stat-label">{label}</span>
      {note && <span className="db-stat-note">{note}</span>}
    </>
  )
  return (
    <li className={tone ? `db-stat is-${tone}` : 'db-stat'}>
      {to ? (
        <Link className="db-stat-link" to={to} aria-label={`${label}: ${value}. ${linkLabel ?? ''}`}>
          {body}
        </Link>
      ) : (
        <span className="db-stat-link is-static">{body}</span>
      )}
    </li>
  )
}
