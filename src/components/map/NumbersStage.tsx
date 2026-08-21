// THE NUMBERS STAGE — five charts where the canvas would be.
//
// IT REPLACES THE MAP RATHER THAN OVERLAYING IT, and that is structural, not a
// layout preference. Throughput, SLA compliance and the closed count are
// questions about DONE work; `useMapModel` pins `scope: 'open'` and
// `buildMindtree` emits no node for a closed entry, so there is nothing on the
// canvas for any of these numbers to hang off. `lensNeedsClosedWork('numbers')`
// is true precisely so this file reads the closed window ITSELF instead of
// anybody being tempted to move that pin (contract risk 9).
//
// IT COMPUTES NOTHING. Every number here comes out of `lib/aggregate.ts`, which
// is pure and tested, and every definition inside that module is imported from
// wherever the app already decided it: "open" is lib/health.isOpen, the age
// buckets are lib/dates.bucketAge, the SLA resolution order is
// lib/health.resolveSlaDays. This file chooses a window, resolves labels and
// hands numbers to components/charts. That is the only way a chart and the list
// a reader jumps into can be guaranteed to agree, and disagreeing is the one
// failure that makes a chart worse than no chart.
//
// ONE WINDOW, STATED ONCE, SHARED WITH THE PANEL. The weeks switcher lives here
// and the Closed tile lives in NumbersPanel, six inches away and in a different
// component — so the window is a tiny module store below (`useNumbersWindow`)
// rather than local state. Two `useState(8)`s would be two windows for one idea
// and they would disagree the first time either control ran alone; the tile
// would then contradict the chart under it, which is the specific way a
// dashboard becomes worse than nothing. The three panels with NO clock (open
// per track, aging, load per owner) describe the current open set and say so in
// their own descriptions.
//
// SCOPE IS PINNED TO 'all' ON THE WAY OUT, NEVER HELD IN `filter`. This is the
// contract's second pin and it is not cosmetic: `countActiveFacets()` counts any
// scope other than the default as a facet the READER chose, so holding
// `scope: 'all'` in filter state makes the shell's FilterBar claim "1 filter" on
// a surface nobody filtered — and its Clear-all then resets the scope to `open`
// and silently empties throughput and compliance of every row they exist to
// count. A fresh object per render is safe: `useFilteredEntries` memoises on
// `filterKey()`, which is value identity, not reference identity.
//
// WHY IT MAY NOT READ `EntryHealth.sla_breached`: the view returns no row for a
// closed entry at all and `computeHealth()` collapses one to the calm shape, so
// both sources answer `false` for every finished item — which renders as
// permanent 100% compliance. `aggregate.slaCompliance` computes the verdict from
// `closed_at` against the deadline the matrix resolved. Do not "simplify" it.
//
// `rtl` IS ACCEPTED AND DELIBERATELY NOT READ. There are no logical properties
// inside an `<svg>`, and components/charts/geometry.ts is where that is dealt
// with: `plotArea()` resolves direction ONCE, from the locale, for every chart
// on this surface, and no component multiplies an x by anything. A second source
// of truth for the same fact here is exactly the drift contract risk 8 names —
// it would pass in English and reverse the story in Arabic the day the two
// disagree. The prop stays in the published signature so the shell's four stage
// components take one shape.

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from 'react'
import {
  AgingChart,
  OwnerLoadTable,
  SlaChart,
  SlaHeadline,
  ThroughputChart,
  TrackLoadChart,
  type OwnerLoadRow,
  type TrackLoadRow,
} from '../charts'
import { IconChart } from '../icons'
import { EmptyState } from '../shared'
import {
  agingHistogram,
  loadPerOwner,
  openPerTrack,
  slaCompliance,
  throughputByWeek,
  type AgeBasis,
} from '../../lib/aggregate'
import { addDays, formatDateRange, todayIso, weekBounds, type IsoDate } from '../../lib/dates'
import type { FilterState } from '../../lib/entryFilter'
import { t, useLocale } from '../../lib/i18n'
import { useTrackLabel } from '../../lib/labels'
import { trackVars } from '../../lib/trackStyle'
import { useActiveTracks, useTrackMap } from '../../store/config'
import {
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
} from '../../store/entries'
import { memberLabel, useMemberMap } from '../../store/members'
import { useSlaDays, useVocabLabel } from '../../store/vocab'
import './map-numbers.css'

/** How many weeks the windowed panels may look back. 8 is the brief's default. */
const WEEK_OPTIONS: readonly number[] = [4, 8, 12]
const DEFAULT_WEEKS = 8

/**
 * The window, module state, shared by the stage and the panel.
 *
 * A MODULE STORE AND NOT A CONTEXT, because there are exactly two readers and
 * they are siblings under a shell that belongs to another unit — a provider
 * would mean editing `pages/Mindtree.tsx`. `useSyncExternalStore` is what the
 * five other module-level stores in this app already use (toast, overlayStack,
 * the pulse layer), and its third argument is the server snapshot: these
 * components are rendered through `renderToStaticMarkup` in their own test file,
 * where React demands one.
 *
 * NOT PERSISTED. It is worth keeping while somebody bounces between lenses in
 * one session; it is not worth a storage key, a migration and a quota failure
 * mode — the same reasoning `pages/FollowUps.tsx` applies to its density pref.
 */
let weeksPref = DEFAULT_WEEKS
const weeksWatchers = new Set<() => void>()

function subscribeWeeks(fn: () => void): () => void {
  weeksWatchers.add(fn)
  return () => {
    weeksWatchers.delete(fn)
  }
}

function readWeeks(): number {
  return weeksPref
}

function setWeeks(next: number): void {
  if (next === weeksPref) return
  weeksPref = next
  for (const fn of weeksWatchers) fn()
}

/**
 * Whole weeks, ending with the one we are in.
 *
 * `weekBounds` is Sunday-anchored because that is where this team's week starts
 * — see it. `throughputByWeek` refuses to re-align a window, deliberately, so
 * `from` MUST be a week's first day or the chart's first bucket would disagree
 * with the range printed in the footnote below it.
 */
export function useNumbersWindow(): { weeks: number; from: IsoDate; to: IsoDate } {
  const weeks = useSyncExternalStore(subscribeWeeks, readWeeks, readWeeks)
  return useMemo(() => {
    const current = weekBounds(new Date(), 0)
    return { weeks, from: addDays(current.from, -7 * (weeks - 1)), to: current.to }
  }, [weeks])
}

/** Survives a lens switch for the same reason the window does, and no longer. */
let basisPref: AgeBasis = 'created'

/**
 * The reader's filter as this surface must read it: scope opened out to `all`,
 * and the two facets these panels MEASURE removed.
 *
 * APPLIED ON THE WAY OUT, NEVER WRITTEN INTO FILTER STATE. That is the contract's
 * pin, and the reason is `countActiveFacets()`: any value it can see is reported
 * as a facet the reader chose, and Clear-all then resets it. Writing `scope:
 * 'all'` into state made the bar claim "1 filter" on an unfiltered screen and
 * made Clear-all silently empty throughput and compliance of every closed row.
 *
 * STATUS AND HEALTH GO THE SAME WAY, and this is the half `pages/Dashboard.tsx`
 * never had to solve. That screen held its own `useState(EMPTY_FILTER)`, so it
 * could withhold the two facets and be sure of never inheriting one. Here the
 * filter is the SHELL's, shared with four other lenses: `Mindtree.tsx` correctly
 * drops both chips from the FilterBar while this lens is active, but dropping a
 * control does not drop the value behind it — a reader who filtered to
 * `status: blocked` on the shape lens and then tapped the numbers chip would get
 * an SLA compliance figure, an aging histogram and a health-banded track chart
 * computed over blocked work alone, with no control on screen saying so. The
 * question would have been filtered out of its own answer. So the value is
 * ignored here and `measuresFacets()` below puts a visible note on the surface
 * saying it was, which is the part a silent strip would get wrong.
 */
export function scopeForNumbers(filter: FilterState): FilterState {
  return { ...filter, scope: 'all', statuses: [], health: [] }
}

/** Is the reader carrying a facet this surface has just ignored? */
export function measuresFacets(filter: FilterState): boolean {
  return filter.statuses.length > 0 || filter.health.length > 0
}

export interface NumbersStageProps {
  filter: FilterState
  compact: boolean
  rtl: boolean
  announce: (text: string) => void
}

export default function NumbersStage({
  filter,
  compact,
  announce,
}: NumbersStageProps): ReactElement {
  const locale = useLocale()
  const { weeks, from, to } = useNumbersWindow()
  const [basis, setBasis] = useState<AgeBasis>(basisPref)

  const health = useHealthMap()
  const byId = useEntryMap()
  const ctx = useFilterContext()
  const loading = useEntriesLoading()
  const errorKey = useEntriesError()
  const truncated = useEntriesTruncated()
  // The closed window is a SEPARATE read, and two of the panels here are
  // computed entirely from its rows — the throughput chart and SLA compliance.
  // Its failure used to be indistinguishable from a quiet month.
  const closedErrorKey = useClosedEntriesError()
  const tracks = useActiveTracks()
  const trackById = useTrackMap()
  const trackLabel = useTrackLabel()
  const members = useMemberMap()
  const vocabLabel = useVocabLabel()
  const priorityDefault = useSlaDays()
  const matrix = useTrackSlaMatrix()
  const matrixError = useTrackSlaError()

  const today = todayIso()

  useEffect(() => {
    void loadEntries()
    // Deduped in the store: the shell already warms this on sign-in, and a
    // second call from a surface that genuinely needs it costs nothing.
    void loadTrackSlas()
  }, [])

  // Closed rows are NOT in the map's working set (api/entries.listEntries is
  // open-only, and useMapModel keeps it that way). Additive and idempotent:
  // loadClosedSince() short-circuits when a wider window is already covered, so
  // widening 4 → 12 fetches once and narrowing back fetches nothing.
  useEffect(() => {
    void loadClosedSince(from)
  }, [from])

  const scoped = useMemo<FilterState>(() => scopeForNumbers(filter), [filter])
  const entries = useFilteredEntries(scoped)

  const trackRows = useMemo<TrackLoadRow[]>(() => {
    const loads = openPerTrack(entries, health)
    const byTrack = new Map(loads.map((row) => [row.trackId ?? '', row]))
    // Every ACTIVE track gets a bar, including an empty one — "nothing open on
    // Network this week" is a fact worth seeing, and a track that silently
    // vanishes reads as a track that was deleted.
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

    // THE UNTRACKED PILE STAYS A VISIBLE BAR. The map has no "No track" node —
    // `buildMindtree` files those rows under whatever the dimension says — so if
    // this chart dropped them too, the one place in the app that can show how
    // much unfiled work exists would be gone. Pinned last, however big: it is a
    // gap in the data, not a track, and sorting it into the middle of an ordered
    // ranking makes the real tracks harder to read for no gain.
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

  const owners = useMemo<OwnerLoadRow[]>(
    () =>
      loadPerOwner(entries, health, ctx).map((row) => ({
        ...row,
        label: memberLabel(members, row.ownerId, row.ownerName),
        // Pinned LAST by loadPerOwner and never omitted: the reader's next move
        // is to hand one of these items to a person, and "nobody owns nine of
        // them" is the row that starts that move.
        unassigned: row.ownerKey === '',
      })),
    [entries, health, ctx, members],
  )

  const compliance = useMemo(
    () => slaCompliance(entries, { overrides: matrix, priorityDefault, from, to }),
    [entries, matrix, priorityDefault, from, to],
  )

  const onWeeks = useCallback(
    (next: number): void => {
      setWeeks(next)
      announce(t('dashboard.windowChanged', { count: next }))
    },
    [announce],
  )

  const onBasis = useCallback(
    (next: AgeBasis): void => {
      basisPref = next
      setBasis(next)
      announce(
        t('dashboard.basisChanged', {
          label: t(next === 'created' ? 'dashboard.ageSinceRaised' : 'dashboard.ageSinceUpdate'),
        }),
      )
    },
    [announce],
  )

  /**
   * The async result, announced — rule 4. Only on SUCCESS: a failed refresh has
   * its own channel three lines below (`.mnum-error`, `role="status"`), and
   * saying "the numbers were refreshed" over a read that did not land would be
   * the one sentence on this surface that is not true. The rejection handler is
   * present rather than absent so a rejected read cannot surface as an unhandled
   * promise instead of as the note it already renders.
   */
  const onRefresh = useCallback((): void => {
    void refreshEntries().then(
      () => announce(t('dashboard.refreshed')),
      () => undefined,
    )
  }, [announce])

  // Nothing at all — a brand-new workspace, not a filter that matched nothing.
  const blank = !loading && errorKey === null && byId.size === 0

  return (
    <section className="mnum" data-compact={compact ? '' : undefined}>
      {/* The one line that says what this surface is. Withheld on a phone, where
          the stage has replaced the canvas and 375px is better spent on the
          charts the reader came for. */}
      {!compact && <p className="mnum-sub">{t('dashboard.subtitle')}</p>}

      <div className="mnum-bar">
        <div className="chip-row mnum-seg" role="group" aria-label={t('dashboard.windowLabel')}>
          <span className="mnum-seg-label" aria-hidden="true">
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

        <div className="mnum-actions">
          <button type="button" className="btn btn-sm btn-ghost" onClick={onRefresh}>
            {t('dashboard.refresh')}
          </button>
          {/* THE DIGEST LINK USED TO BE HERE and the integrator removed it.
              U6 and U7 both shipped one; `components/map/MapModeBar.tsx` renders
              the same route in the shell header at EVERY lens, which is strictly
              wider reach than a button that only exists once the reader is
              already looking at the numbers. Two doors to one room is worse than
              either door. The killer test's "digest, from anywhere — 2 taps" is
              met by the mode bar, and from this stage it is now 1. */}
        </div>
      </div>

      {errorKey !== null && (
        <p className="mnum-error" role="status">
          {t(errorKey)}{' '}
          <button type="button" className="btn btn-sm" onClick={onRefresh}>
            {t('common.retry')}
          </button>
        </p>
      )}

      {truncated && (
        <p className="mnum-note" role="status">
          {t('dashboard.truncated')}
        </p>
      )}

      {/* The strip, said out loud. `scopeForNumbers` drops the two facets these
          panels measure; the reader still has them set from another lens and the
          shell's filter bar will still count them, so the one thing that must
          not happen is for this surface to quietly disagree with the bar above
          it. */}
      {measuresFacets(filter) && (
        <p className="mnum-note" role="status">
          {t('dashboard.facetsIgnored')}
        </p>
      )}

      {/* Surface-level, exactly like the truncation notice and for the same
          reason: the reader cannot tell which of the numbers in front of them
          came from the closed window, so the caveat belongs above all of them
          rather than tucked under one chart. */}
      {closedErrorKey !== null && (
        <p className="mnum-error" role="status">
          {t('dashboard.closedFailed')}{' '}
          <button type="button" className="btn btn-sm" onClick={onRefresh}>
            {t('common.retry')}
          </button>
        </p>
      )}

      {blank ? (
        // No CTA link: the composer is mounted at the bottom of this very shell
        // at every lens and every stage, so a button that navigated to a capture
        // route would be a longer path to the field already on screen.
        <EmptyState
          icon={<IconChart size={30} />}
          title={t('dashboard.blank')}
          description={t('dashboard.blankHint')}
        />
      ) : (
        <>
          <div className="mnum-grid">
            <div className="mnum-cell mnum-cell-wide">
              <TrackLoadChart rows={trackRows} loading={loading} />
            </div>

            {/* The AgeBasis switch is a CHART control and not a surface control,
                because it changes what this one picture means and nothing else
                here. A node has one size; the map can encode one clock at a
                time, and an overlay that silently picked one would be actively
                misleading — which is why both ship, and why the chart renames
                its own description when the chip moves. */}
            <div className="mnum-cell">
              <AgingChart
                histogram={histogram}
                basis={basis}
                onBasis={onBasis}
                loading={loading}
              />
            </div>

            <div className="mnum-cell mnum-cell-wide">
              <ThroughputChart points={flow} loading={loading} />
            </div>

            <div className="mnum-cell mnum-sla">
              <SlaHeadline compliance={compliance} />
              <SlaChart
                compliance={compliance}
                priorityLabel={(p) => vocabLabel('priority', p)}
                loading={loading}
              />
              {matrixError !== null && (
                <p className="mnum-note" role="status">
                  {t('dashboard.slaMatrixFailed')}
                </p>
              )}
            </div>

            <div className="mnum-cell mnum-cell-wide">
              <OwnerLoadTable rows={owners} loading={loading} />
            </div>
          </div>

          <p className="mnum-footnote">
            {t('dashboard.footnote', { range: formatDateRange(from, to, locale) })}
          </p>
        </>
      )}
    </section>
  )
}
