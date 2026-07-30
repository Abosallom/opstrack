// /tracks/:id — one track's history, as a single stream.
//
// THE SCREEN ANSWERS TWO DIFFERENT QUESTIONS AND SAYS WHICH IS WHICH. The header
// counts describe the track AS IT STANDS NOW — open, overdue, stale, blocked,
// unassigned, past SLA — and come from the live entries store, so they move with
// realtime and with this client's own writes. Everything below the header
// describes A DATE RANGE the reader chose: the interleaved timeline, and the tag
// breakdown over it. Blurring the two is the obvious way to build this screen
// and it produces a header that silently changes meaning when someone drags a
// date, so the band carries its own "as it stands today" label and the range
// controls sit under it.
//
// WHERE THE DATA COMES FROM, and why it is two places:
//
//   · api/timeline.loadTrackTimeline() — the WINDOW. Entries and thread rows for
//     [from, to], paged past PostgREST's 1000-row clamp, fetched by this screen
//     into local state. It deliberately does NOT go through store/entries: the
//     working set is open entries only, and a timeline that could not show the
//     things that got finished would be describing a different month from the
//     one it claims to.
//   · store/entries — the LIVE half. `useEntryList()` supplies the header counts
//     and is overlaid onto the fetched window by mergeEntriesById(), so an item
//     renamed, closed or captured in another tab while this page is open shows
//     its current state instead of the state it had when the range was picked.
//     Updates are not overlaid — the thread rows are immutable by RLS, so the
//     only thing that can change about them is that a new one exists, and
//     Refresh is the honest control for that.
//
// EVERY DECISION IS IN THE URL — `?from=&to=&q=&kind=`. "Here is what happened
// in Onboarding last month, filtered to the vendor" is a link somebody pastes
// into a chat, and that is most of what this screen is for. `replace: true` on
// every write, so typing four letters into the search box does not put four
// entries in the back stack.
//
// THE ROW MACHINERY IS THE KIT'S. An entry item renders `EntryRow` exactly as
// follow-ups and the board do — same title button, same pills, same permission
// affordance — with the track bar switched off, because every row on this page
// is in the same track and a column of identical colour bars is noise. Update
// items are this screen's own small row, and they resolve their status labels
// through the vocabulary store like everything else, so renaming a status
// re-labels the history with zero writes.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { EntryRow, StatusPill } from '../../components/entry'
import { IconArrowStart, IconLayers } from '../../components/icons'
import { EmptyState, Skeleton } from '../../components/shared'
import { toast } from '../../components/toast'
import { loadTrackTimeline, type TrackTimelineRows } from '../../api/timeline'
import {
  addDays,
  clampIso,
  formatDateLong,
  formatDateRange,
  formatRelativeTime,
  formatWeekday,
  lastNDays,
  parseIsoDate,
  todayIso,
  type IsoDate,
} from '../../lib/dates'
import { EMPTY_FILTER, type FilterState } from '../../lib/entryFilter'
import { t, useLocale } from '../../lib/i18n'
import { useTrackLabel } from '../../lib/labels'
import { canEditEntry } from '../../lib/permissions'
import {
  buildTimeline,
  countUntagged,
  groupByDay,
  mergeEntriesById,
  tagBreakdown,
  timelineKey,
  windowTags,
  type TimelineItem,
  type TimelineKind,
} from '../../lib/timeline'
import { trackIcon } from '../../lib/trackIcons'
import { trackVars } from '../../lib/trackStyle'
import { useAuth } from '../../store/auth'
import { useConfigLoading, useTrackMap } from '../../store/config'
import {
  loadEntries,
  useEntriesTruncated,
  useEntryCounts,
  useEntryList,
  useFilteredEntries,
  useHealthMap,
} from '../../store/entries'
import { openEntry } from '../../store/entrySheet'
import { useMemberMap } from '../../store/members'
import { useVocabLabel } from '../../store/vocab'
import type { Entry, EntryHealth, EntryUpdate, Track, UserRole } from '../../types'
import './timeline.css'

/** The range the page opens on. A month is what "recently" means for ops work. */
const DEFAULT_DAYS = 30

/** The preset chips, in days INCLUDING today (lastNDays' own convention). */
const PRESETS: readonly number[] = [7, 30, 90, 365]

/** What `?kind=` may say. Anything else falls back to showing both. */
const KINDS: readonly TimelineKind[] = ['entry', 'update']

/* ══════════════════════════ URL state ══════════════════════════ */

/** A query param that has to be a real calendar date, or it is not there. */
function isoParam(raw: string | null): IsoDate | null {
  return raw !== null && parseIsoDate(raw) !== null ? raw : null
}

function kindParam(raw: string | null): TimelineKind | 'all' {
  return raw === 'entry' || raw === 'update' ? raw : 'all'
}

/* ══════════════════════════ the header band ══════════════════════════ */

interface StatSpec {
  key: string
  labelKey: string
  value: number
  /** Tint: a danger tone for the two facts that mean a promise was missed. */
  tone?: 'danger' | 'warn'
}

function StatTiles({ stats, partial }: { stats: StatSpec[]; partial: boolean }): ReactElement {
  useLocale()
  return (
    <div className="tl-stats">
      <p className="tl-stats-label">{t('track.now')}</p>
      <ul className="tl-stat-list">
        {stats.map((s) => (
          <li key={s.key} className="tl-stat" data-tone={s.tone}>
            <span className="tl-stat-n tabular">{s.value}</span>
            <span className="tl-stat-k">{t(s.labelKey)}</span>
          </li>
        ))}
      </ul>
      <p className="tl-stats-hint">{t('track.statsHint')}</p>
      {/* Not a failure and not decoration: past PostgREST's ceiling the working
          set is a window, so every number above is a count of what loaded. */}
      {partial ? (
        <p className="tl-note" role="status">
          {t('track.statsPartial')}
        </p>
      ) : null}
    </div>
  )
}

/* ══════════════════════════ the tag breakdown ══════════════════════════ */

interface BreakdownRow {
  key: string
  label: string
  open: number
  closed: number
}

function TagBreakdown({ rows }: { rows: BreakdownRow[] }): ReactElement {
  useLocale()
  // Bars are scaled against the BIGGEST row, not against the window total: with
  // six tags the tallest bar would otherwise be a sixth of the track and the
  // chart would say nothing. The numbers beside them carry the absolute truth.
  const max = rows.reduce((n, r) => Math.max(n, r.open + r.closed), 0)
  const pct = (n: number): number => (max === 0 ? 0 : Math.round((n / max) * 100))

  return (
    <ul className="tl-tag-list">
      {rows.map((row) => {
        const label = t('track.tagsRow', {
          tag: row.label,
          open: row.open,
          closed: row.closed,
        })
        return (
          <li key={row.key} className="tl-tag-row">
            <span className="tl-tag-name">{row.label}</span>
            {/* One accessible sentence for the whole row; the bar and the two
                numbers repeat it visually and are hidden from the reader that
                already heard it. */}
            <span className="sr-only">{label}</span>
            <span className="tl-tag-bar" aria-hidden="true" title={label}>
              <span
                className="tl-tag-fill"
                data-part="open"
                style={{ inlineSize: `${pct(row.open)}%` } as CSSProperties}
              />
              <span
                className="tl-tag-fill"
                data-part="closed"
                style={{ inlineSize: `${pct(row.closed)}%` } as CSSProperties}
              />
            </span>
            <span className="tl-tag-n tabular" aria-hidden="true">
              <span className="tl-tag-open">{row.open}</span>
              <span className="tl-tag-sep">{t('track.tagsOpen')}</span>
              <span className="tl-tag-closed">{row.closed}</span>
              <span className="tl-tag-sep">{t('track.tagsClosed')}</span>
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/* ══════════════════════════ an update row ══════════════════════════ */

/** True when this row records a status move rather than (or as well as) a note. */
function isTransition(update: EntryUpdate): boolean {
  return update.status_from !== null && update.status_to !== null
}

/** The one-word label on an item's rail. Computed here so both halves agree. */
function itemKindKey(item: TimelineItem): string {
  if (item.kind === 'entry') return 'track.raised'
  return isTransition(item.update) ? 'track.statusChange' : 'track.update'
}

interface UpdateItemProps {
  update: EntryUpdate
  entry: Entry | undefined
  meId: string | null
  authorName: string
  onOpen: (id: string) => void
}

function UpdateItem({ update, entry, meId, authorName, onOpen }: UpdateItemProps): ReactElement {
  const locale = useLocale()
  const vocabLabel = useVocabLabel()
  // Read into locals so TypeScript narrows the fields themselves — a boolean
  // computed elsewhere does not narrow them, and the alternative is two
  // non-null assertions on a row a realtime patch could have replaced.
  const statusFrom = update.status_from
  const statusTo = update.status_to
  // A transition row written by updateEntry() carries an empty body and a typed
  // note carries text and no statuses — but one row can legitimately be both,
  // so the two blocks below are independent rather than a branch.
  const author = update.author_id !== null && update.author_id === meId ? t('entry.author') : authorName

  return (
    <article className="tl-upd">
      <header className="tl-upd-head">
        <span className="tl-upd-author">{author}</span>
        <time className="tl-upd-time tabular" dateTime={update.created_at}>
          {formatRelativeTime(update.created_at, locale)}
        </time>
      </header>

      {statusFrom !== null && statusTo !== null ? (
        <p className="tl-upd-transition">
          {/* The pills carry the labels through the vocabulary store, so an
              admin renaming a status re-labels every historical transition on
              this page with ZERO writes. */}
          <StatusPill status={statusFrom} size="sm" />
          {/* Through t(), because U+2192 has bidi class ON and the bidi
              algorithm does not mirror it: a hardcoded arrow keeps pointing
              right while the pills beside it lay out right-to-left, so the
              Arabic row would read "to → from". entry.arrow is seeded → / ←. */}
          <span aria-hidden="true">{t('entry.arrow')}</span>
          <StatusPill status={statusTo} size="sm" />
          {/* The glyph is decorative — announced as anything from "rightwards
              arrow" to silence — so the sentence is what a screen reader gets. */}
          <span className="sr-only">
            {t('entry.statusChangedBy', {
              name: author,
              from: vocabLabel('status', statusFrom),
              to: vocabLabel('status', statusTo),
            })}
          </span>
        </p>
      ) : null}

      {update.body !== '' ? <p className="tl-upd-body">{update.body}</p> : null}

      {entry ? (
        <button
          type="button"
          className="tl-upd-parent"
          onClick={() => onOpen(entry.id)}
          aria-label={t('track.openItem', { title: entry.title })}
        >
          <span className="tl-upd-parent-title entry-title">{entry.title}</span>
        </button>
      ) : (
        // The API guarantees an update's parent is in the same window, so this
        // is only reachable when the entries read hit its page cap. Saying so is
        // better than a row that refers to nothing.
        <p className="tl-upd-orphan muted">{t('track.orphan')}</p>
      )}
    </article>
  )
}

/* ══════════════════════════ the screen ══════════════════════════ */

export default function TrackTimeline(): ReactElement {
  const locale = useLocale()
  const { id } = useParams<{ id: string }>()
  const trackId = id ?? ''
  const { profile } = useAuth()
  const meId = profile?.id ?? null
  const role = profile?.role ?? 'member'

  const trackMap = useTrackMap()
  const configLoading = useConfigLoading()
  const trackLabel = useTrackLabel()
  const memberMap = useMemberMap()
  const track: Track | undefined = trackMap.get(trackId)

  /* ---------- the range, the search and the kind live in the URL ---------- */

  const [params, setParams] = useSearchParams()
  // Resolved ONCE per mount rather than per render: a tab left open across
  // midnight keeping yesterday's default range is strictly better than the
  // range moving under the reader and refetching on its own.
  const fallback = useMemo(() => lastNDays(DEFAULT_DAYS), [])
  const today = todayIso()
  // Both ends are CLAMPED rather than trusted or swapped, and both clamps have
  // a shape of bad link behind them. `to` past today is a window into the
  // future, which no history has anything in — and it would also hand the date
  // input a value beyond its own `max`, which browsers render as an invalid
  // control. `from` after `to` is a typo; collapsing it to a single day is
  // predictable where a silent swap is not.
  const to = clampIso(isoParam(params.get('to')) ?? fallback.to, undefined, today)
  const from = clampIso(isoParam(params.get('from')) ?? fallback.from, undefined, to)
  const search = params.get('q') ?? ''
  const kind = kindParam(params.get('kind'))

  const patchParams = useCallback(
    (next: Record<string, string | null>): void => {
      const p = new URLSearchParams(params)
      for (const [key, value] of Object.entries(next)) {
        if (value === null || value === '') p.delete(key)
        else p.set(key, value)
      }
      // replace, so a range drag or a search does not fill the back stack.
      setParams(p, { replace: true })
    },
    [params, setParams],
  )

  /* ---------- the window fetch ---------- */

  const [rows, setRows] = useState<TrackTimelineRows | null>(null)
  // Starts TRUE: a fetch is queued by the effect below on the very first
  // commit, and starting false makes the first paint of every visit read
  // "nothing happened in this window" for one frame before the request has even
  // left. A skeleton is the honest answer to "we have not asked yet".
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** Only the newest request may write state — a fast range drag fires several. */
  const request = useRef(0)

  const fetchWindow = useCallback(
    (notify = false): void => {
      if (trackId === '') return
      const token = request.current + 1
      request.current = token
      setLoading(true)
      setError(null)
      void loadTrackTimeline(trackId, from, to).then((result) => {
        // A stale response must not write state OR toast: a fast range drag
        // fires several, and the reader is looking at the newest one.
        if (token !== request.current) return
        setLoading(false)
        if (!result.ok) {
          // The previous window stays on screen. A failed read with rows
          // already rendered is a note, never a wipe.
          setError(result.error)
          return
        }
        setRows(result.data)
        // Confirmed only once it is TRUE. Toasting "reloaded" on the click,
        // before the request has left, is a reassurance about nothing — and it
        // is the one that stays on screen when the reload actually fails.
        if (notify) toast(t('track.refreshed'))
      })
    },
    [trackId, from, to],
  )

  useEffect(() => {
    fetchWindow()
  }, [fetchWindow])

  // The header counts read the working set; it self-loads and dedupes, so this
  // is one request however many screens ask.
  useEffect(() => {
    void loadEntries()
  }, [])

  const handleRefresh = useCallback((): void => {
    fetchWindow(true)
  }, [fetchWindow])

  /* ---------- the live half: header counts ---------- */

  const openFilter = useMemo<FilterState>(
    () => ({ ...EMPTY_FILTER, trackIds: trackId === '' ? [] : [trackId], scope: 'open' }),
    [trackId],
  )
  const counts = useEntryCounts(openFilter)
  const openEntries = useFilteredEntries(openFilter)
  const health = useHealthMap()
  const partial = useEntriesTruncated()

  /**
   * SLA is off until an admin arms it (0005 ships every priority NULL), so the
   * tile is absent rather than reading "0 past SLA" — a number nobody set is
   * not a reassurance, it is noise that trains people to ignore the row.
   */
  const sla = useMemo(() => {
    let armed = false
    let breached = 0
    for (const entry of openEntries) {
      const row: EntryHealth | undefined = health.get(entry.id)
      if (row?.sla_due_at != null) armed = true
      if (row?.sla_breached === true) breached += 1
    }
    return { armed, breached }
  }, [openEntries, health])

  const stats = useMemo<StatSpec[]>(() => {
    const list: StatSpec[] = [
      { key: 'open', labelKey: 'track.statOpen', value: counts.open },
      { key: 'overdue', labelKey: 'track.statOverdue', value: counts.overdue, tone: 'danger' },
      { key: 'stale', labelKey: 'track.statStale', value: counts.stale, tone: 'warn' },
      { key: 'blocked', labelKey: 'track.statBlocked', value: counts.blocked, tone: 'warn' },
      { key: 'unassigned', labelKey: 'track.statUnassigned', value: counts.unassigned },
    ]
    if (sla.armed) {
      list.push({ key: 'sla', labelKey: 'track.statSla', value: sla.breached, tone: 'danger' })
    }
    return list
  }, [counts, sla])

  /* ---------- the window half: items, days, tags ---------- */

  const allEntries = useEntryList()
  const liveTrackEntries = useMemo(
    () => (trackId === '' ? [] : allEntries.filter((e) => e.track_id === trackId)),
    [allEntries, trackId],
  )

  // Live rows OUTSIDE the range are included on purpose: buildTimeline reads
  // them as parents for updates before it applies the window, which is what
  // lets a July update name the January item it belongs to.
  const windowEntries = useMemo(
    () => mergeEntriesById(rows?.entries ?? [], liveTrackEntries),
    [rows, liveTrackEntries],
  )

  /** Range + search applied, BOTH kinds — the kind toggle is a display filter. */
  const windowed = useMemo(
    () => buildTimeline(windowEntries, rows?.updates ?? [], { search, from, to }),
    [windowEntries, rows, search, from, to],
  )

  const shown = useMemo(
    () => (kind === 'all' ? windowed : windowed.filter((item) => item.kind === kind)),
    [windowed, kind],
  )

  const days = useMemo(() => groupByDay(shown), [shown])

  /** The sibling list the detail sheet's prev/next walks, IN THE ORDER SHOWN. */
  const orderedIds = useMemo(() => {
    const seen: string[] = []
    const known = new Set<string>()
    for (const item of shown) {
      const entryId = item.kind === 'entry' ? item.entry.id : item.entry?.id
      if (entryId === undefined || known.has(entryId)) continue
      known.add(entryId)
      seen.push(entryId)
    }
    return seen
  }, [shown])

  const handleOpen = useCallback(
    (entryId: string) => {
      openEntry(entryId, { list: orderedIds })
    },
    [orderedIds],
  )

  /**
   * The breakdown counts ITEMS RAISED in the window, so it follows the range and
   * the search but NOT the kind toggle — "updates only" is a question about the
   * feed, and blanking the chart in answer to it would be a different screen.
   */
  const breakdownEntries = useMemo(
    () => windowed.flatMap((item) => (item.kind === 'entry' ? [item.entry] : [])),
    [windowed],
  )

  const breakdown = useMemo<BreakdownRow[]>(() => {
    const tags = windowTags(breakdownEntries, track?.suggested_tags ?? [])
    const rowsForTags = tagBreakdown(breakdownEntries, tags).map((r) => ({
      key: `tag:${r.tag}`,
      label: r.tag,
      open: r.open,
      closed: r.closed,
    }))
    const untagged = countUntagged(breakdownEntries)
    // The untagged row is last and only when it has something to say: a
    // permanent "No tag: 0 / 0" is a row that never means anything.
    if (untagged.open + untagged.closed > 0) {
      rowsForTags.push({
        key: 'untagged',
        label: t('track.tagsNone'),
        open: untagged.open,
        closed: untagged.closed,
      })
    }
    return rowsForTags
  }, [breakdownEntries, track])

  /* ---------- range controls ---------- */

  const activePreset = useMemo(() => {
    if (to !== today) return null
    return PRESETS.find((n) => addDays(today, -(n - 1)) === from) ?? null
  }, [from, to, today])

  const setPreset = (days_: number): void => {
    const span = lastNDays(days_)
    patchParams({ from: span.from, to: span.to })
  }

  /* ---------- render ---------- */

  if (track === undefined) {
    // A cold load has an empty track map for a moment; saying "no such track"
    // during it would make every deep link flash an error it then withdraws.
    if (configLoading || trackMap.size === 0) {
      return (
        <div className="tl" aria-busy="true">
          <div className="tl-skel" role="status" aria-label={t('common.loading')}>
            <Skeleton count={4} height={54} />
          </div>
        </div>
      )
    }
    return (
      <div className="tl">
        <EmptyState
          icon={<IconLayers size={30} />}
          title={t('track.notFound')}
          description={t('track.notFoundHint')}
          action={
            <Link className="btn btn-primary" to="/tracks">
              {t('track.back')}
            </Link>
          }
        />
      </div>
    )
  }

  const TrackGlyph = trackIcon(track.icon)
  const name = trackLabel(track)
  const description = locale === 'ar' && track.description_ar !== '' ? track.description_ar : track.description
  const truncated = rows?.truncated === true
  // PROGRESSIVE, not blocking. The live store already knows this track's open
  // work, so the overlay gives the feed something true to render before the
  // window request lands; the skeleton is only for the case where there is
  // genuinely nothing to show yet. Same rule as follow-ups: a refetch must
  // never blank a list somebody is reading.
  const showError = error !== null && shown.length === 0
  const showSkeleton = !showError && loading && shown.length === 0

  return (
    <div className="tl" style={trackVars(track.color, track.color_light)}>
      <header className="tl-head">
        <Link className="btn btn-sm btn-ghost tl-back" to="/tracks">
          <IconArrowStart size={16} className="icon-directional" />
          {t('track.back')}
        </Link>

        <div className="tl-id">
          <span className="track-glyph tl-glyph" aria-hidden="true">
            <TrackGlyph size={20} />
          </span>
          <div className="tl-id-text">
            <h2 className="tl-name">{name}</h2>
            {description !== '' ? <p className="tl-desc">{description}</p> : null}
          </div>
        </div>

        <StatTiles stats={stats} partial={partial} />
      </header>

      <section className="tl-controls" aria-label={t('track.range')}>
        <div className="tl-range">
          <div className="chip-row tl-presets" role="group" aria-label={t('track.range')}>
            {PRESETS.map((n) => (
              <button
                key={n}
                type="button"
                className="chip"
                aria-pressed={activePreset === n}
                onClick={() => setPreset(n)}
              >
                {t('track.rangeLast', { count: n })}
              </button>
            ))}
          </div>

          <div className="tl-dates">
            {/* Native date inputs rather than components/fields' DateField: this
                is a two-ended RANGE, so each end constrains the other through
                min/max, and neither end may be cleared — a range with one side
                missing is not a range. The control's VALUE is always YYYY-MM-DD
                whatever the platform displays, which is the IsoDate the loader
                takes. */}
            <label className="tl-date">
              <span className="tl-date-label">{t('track.rangeFrom')}</span>
              <input
                className="input tl-date-input"
                type="date"
                value={from}
                max={to}
                onChange={(e) => patchParams({ from: e.target.value || null })}
              />
            </label>
            <label className="tl-date">
              <span className="tl-date-label">{t('track.rangeTo')}</span>
              <input
                className="input tl-date-input"
                type="date"
                value={to}
                min={from}
                max={today}
                onChange={(e) => patchParams({ to: e.target.value || null })}
              />
            </label>
          </div>
        </div>

        <div className="tl-tools">
          <input
            className="input tl-search"
            type="search"
            value={search}
            placeholder={t('track.searchPlaceholder')}
            aria-label={t('track.search')}
            onChange={(e) => patchParams({ q: e.target.value })}
          />

          <div className="chip-row tl-kinds" role="group" aria-label={t('track.kind')}>
            <button
              type="button"
              className="chip"
              aria-pressed={kind === 'all'}
              onClick={() => patchParams({ kind: null })}
            >
              {t('track.kindAll')}
            </button>
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                className="chip"
                aria-pressed={kind === k}
                onClick={() => patchParams({ kind: k })}
              >
                {t(k === 'entry' ? 'track.kindEntry' : 'track.kindUpdate')}
              </button>
            ))}
          </div>

          <button type="button" className="btn btn-sm tl-refresh" onClick={handleRefresh} disabled={loading}>
            {t('track.refresh')}
          </button>
        </div>

        <p className="tl-showing tabular">
          {t('track.rangeShowing', { range: formatDateRange(from, to, locale) })}
        </p>
      </section>

      <section className="tl-tags" aria-label={t('track.tags')}>
        <h3 className="section-title">{t('track.tags')}</h3>
        {breakdown.length === 0 ? (
          <>
            <p className="tl-tags-empty">{t('track.tagsEmpty')}</p>
            <p className="tl-hint">{t('track.tagsEmptyHint')}</p>
          </>
        ) : (
          <>
            <TagBreakdown rows={breakdown} />
            <p className="tl-hint">{t('track.tagsHint')}</p>
          </>
        )}
      </section>

      <section className="tl-feed" aria-label={t('track.feed')} aria-busy={loading}>
        <div className="tl-feed-head">
          <h3 className="section-title">{t('track.feed')}</h3>
          <span className="tl-count tabular" aria-live="polite">
            {t('track.total', { count: shown.length })}
          </span>
        </div>

        {truncated ? (
          <p className="tl-note" role="status">
            {t('track.truncated')}
          </p>
        ) : null}

        {/* A failed window read with something already on screen — the previous
            range, or the live overlay — is a note, never a wipe. */}
        {error !== null && !showError ? (
          <p className="tl-note" role="status">
            {t(error)}
          </p>
        ) : null}

        {showError ? (
          <EmptyState
            icon={<IconLayers size={30} />}
            title={t('track.errLoad')}
            description={t('common.errorHint')}
            action={
              <button type="button" className="btn btn-primary" onClick={handleRefresh}>
                {t('common.retry')}
              </button>
            }
          />
        ) : showSkeleton ? (
          <div className="tl-skel" role="status" aria-label={t('common.loading')}>
            <Skeleton count={5} height={68} />
          </div>
        ) : shown.length === 0 ? (
          // Two different nothings. A track with no history at all needs a way
          // in; a range with nothing in it needs the range widened.
          liveTrackEntries.length === 0 && (rows?.entries.length ?? 0) === 0 ? (
            <EmptyState
              icon={<IconLayers size={30} />}
              title={t('track.emptyTrack')}
              description={t('track.emptyTrackHint')}
              action={
                <Link className="btn btn-primary" to="/capture">
                  {t('nav.capture')}
                </Link>
              }
            />
          ) : (
            <EmptyState
              icon={<IconLayers size={30} />}
              title={t('track.empty')}
              description={t('track.emptyHint')}
              action={
                <button type="button" className="btn" onClick={() => setPreset(365)}>
                  {t('track.rangeLast', { count: 365 })}
                </button>
              }
            />
          )
        ) : (
          <ol className="tl-days">
            {days.map((day) => (
              <li key={day.day} className="tl-day">
                <div className="tl-day-head">
                  <span className="tl-day-weekday">{formatWeekday(day.day, locale, 'long')}</span>
                  <span className="tl-day-date tabular">{formatDateLong(day.day, locale)}</span>
                  <span className="tl-day-count tabular">
                    {t('track.total', { count: day.items.length })}
                  </span>
                </div>

                <ol className="tl-items">
                  {day.items.map((item) => (
                    <li key={timelineKey(item)} className="tl-item" data-kind={item.kind}>
                      <span className="tl-rail" aria-hidden="true">
                        <span className="tl-dot" />
                      </span>
                      <div className="tl-body">
                        <p className="tl-kind">{t(itemKindKey(item))}</p>
                        {renderItem(item, {
                          health,
                          meId,
                          role,
                          memberName: (authorId) =>
                            (authorId !== null ? memberMap.get(authorId)?.displayName : undefined) ??
                            t('entry.authorUnknown'),
                          onOpen: handleOpen,
                        })}
                      </div>
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}

/* ══════════════════════════ item dispatch ══════════════════════════ */

interface RenderContext {
  health: ReadonlyMap<string, EntryHealth>
  meId: string | null
  role: UserRole
  memberName: (authorId: string | null) => string
  onOpen: (id: string) => void
}

/**
 * One item, as the kit renders it.
 *
 * A function rather than a component so the two branches share the enclosing
 * `<li>`'s rail and kind label instead of each drawing their own — the vertical
 * line down the page is the thing that makes a timeline read as one stream, and
 * it only works if every item hangs off the same geometry.
 */
function renderItem(item: TimelineItem, ctx: RenderContext): ReactElement {
  if (item.kind === 'entry') {
    return (
      <EntryRow
        entry={item.entry}
        health={ctx.health.get(item.entry.id)}
        // Every row here is in the same track: a column of identical colour
        // bars carries no information and costs 10px of the title.
        show={{ track: false }}
        canEdit={canEditEntry(item.entry, ctx.meId, ctx.role)}
        onOpen={ctx.onOpen}
      />
    )
  }
  return (
    <UpdateItem
      update={item.update}
      entry={item.entry}
      meId={ctx.meId}
      authorName={ctx.memberName(item.update.author_id)}
      onOpen={ctx.onOpen}
    />
  )
}
