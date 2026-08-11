// THE HISTORY BAND — what happened in this track, over a range the reader picks.
//
// A SEPARATE FILE FROM MapBranch.tsx, and only because of size: the branch panel
// collapses two 1,000-line screens into one surface, and the single file came to
// 1,836 lines against a 900-line budget. This is the clean seam — the work band
// and the history band share exactly ONE value, the track id — so the split
// costs one prop and no shared state. It owns no prefix of its own: every class
// here is `.mbr-*`, styled by `map-branch.css`, which MapBranch.tsx imports.
//
// AND EVERY `.mbr-*` NAME HERE MUST HAVE A RULE IN THAT SHEET. Six did not —
// they were authored against rules that were never written, so the elements
// silently took shared-kit defaults and the names read as styling that did not
// exist. Five are gone: `.chip-row` already lays out both chip rails, Skeleton
// spaces its own bars inside `.mbr-band`'s 8px column gap, `.entry-title` is the
// parent link's type, and the closed tally is meant to sit at `.mbr-tag-n`'s dim
// tone — which is exactly what it does with no class of its own. The sixth,
// `.mbr-history`, is kept ON PURPOSE and is the one name here that is an
// IDENTITY rather than a style: MapBranch.test.tsx slices the rendered document
// at the literal `mbr-band mbr-history` to test this band apart from the work
// band above it. Adding an empty rule for it would be a lie about what it does.
// MapCapture.test.tsx's `renders no .mcap- name the sheet was not written
// against` is the gate that keeps this class of drift out of that component; a
// band this size deserves the same one.
//
// THIS HALF READS THE CHOSEN WINDOW. The band above it (`track.now`) reads the
// LIVE store and says "as it stands today". Keeping the two apart is the point:
// merging them produces a header that silently changes meaning the moment
// somebody drags a date.
//
// WHERE THE DATA COMES FROM, and why it is two places:
//   · api/timeline.loadTrackTimeline() — the WINDOW. Entries and thread rows for
//     [since, until], paged past PostgREST's 1000-row clamp, fetched into local
//     state. It deliberately does NOT go through store/entries: the working set
//     is open entries only, and a history that could not show the things that
//     got finished would describe a different month from the one it claims to.
//   · store/entries — the LIVE half, overlaid by mergeEntriesById(), so an item
//     renamed, closed or captured in another tab shows its current state.
//     Updates are not overlaid — thread rows are immutable by RLS, so the only
//     thing that can change is that a new one exists, and Refresh is the honest
//     control for that.
//
// EVERY DECISION IS IN THE URL, `replace: true`. The names are `?since=`,
// `?until=`, `?find=` and `?kind=` rather than the `/tracks/:id` screen's
// `?from=&to=&q=`: that screen owned its whole query string, and this panel
// shares one with the shell's FilterBar, whose `filterToParams` already writes
// `q`, `from` and `to`. Keeping the old names would make a pasted history link
// arrive as a search and a date filter over the whole map.
//
// THE FEED IS BOUNDED AND IT IS MEMOISED, and it needs both. Without the bound
// this mounted the entire window — up to the upstream 1000-entry ceiling plus
// every thread row for it, ~39 000 DOM elements in one commit. Without the
// boundary everything mounted re-renders on every entries-store commit, which is
// every optimistic write, every settle and every realtime echo anyone on the
// team produces while the panel is open.

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from 'react'
import { useSearchParams } from 'react-router-dom'
import { EntryRow, StatusPill, type EntryRowShow } from '../entry'
import { IconLayers } from '../icons'
import { EmptyState, Skeleton } from '../shared'
import { toast } from '../toast'
import { threadBodyKey } from '../../api/nudge'
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
import { t, useLocale } from '../../lib/i18n'
import { canEditEntry } from '../../lib/permissions'
import {
  buildTimeline,
  countUntagged,
  groupByDay,
  mergeEntriesById,
  tagBreakdown,
  timelineKey,
  windowTags,
  type TimelineDay,
  type TimelineItem,
  type TimelineKind,
} from '../../lib/timeline'
import { useAuth } from '../../store/auth'
import { useTrackMap } from '../../store/config'
import { useEntryList, useHealthMap } from '../../store/entries'
import { openEntry } from '../../store/entrySheet'
import { useMemberMap } from '../../store/members'
import { useVocabLabel } from '../../store/vocab'
import type { Entry, EntryHealth, EntryUpdate } from '../../types'

/** The range the panel opens on. A month is what "recently" means for ops work. */
const DEFAULT_DAYS = 30

/** The preset chips, in days INCLUDING today (lastNDays' own convention). */
const PRESETS: readonly number[] = [7, 30, 90, 365]

/** What `?kind=` may say. Anything else falls back to showing both. */
const KINDS: readonly TimelineKind[] = ['entry', 'update']

/**
 * Items mounted before the fold — A BUDGET OVER THE WHOLE WINDOW, NOT A CAP PER
 * DAY, and the difference is the whole point: a year of five-items-a-day never
 * trips a per-day cap of any size and is exactly the shape that hurts. Days are
 * taken whole until the budget runs out and the last one is cut mid-day, which
 * is why `ShownDay` carries the TRUE total separately.
 */
const MAX_ITEMS = 60

/** This panel's own query names — see the header on why they are not q/from/to. */
export const P_SINCE = 'since'
export const P_UNTIL = 'until'
export const P_FIND = 'find'
export const P_KIND = 'kind'

/** Hoisted: an object literal in JSX is a fresh identity that defeats memo(). */
const SHOW_FEED: EntryRowShow = { track: false }

/** A day as it MOUNTS: `items` may be a slice, `total` is always the day's own. */
interface ShownDay extends TimelineDay {
  total: number
}

interface BreakdownRow {
  key: string
  label: string
  open: number
  closed: number
}

/** A query param that has to be a real calendar date, or it is not there. */
function isoParam(raw: string | null): IsoDate | null {
  return raw !== null && parseIsoDate(raw) !== null ? raw : null
}

function kindParam(raw: string | null): TimelineKind | 'all' {
  return raw === 'entry' || raw === 'update' ? raw : 'all'
}

/** True when this row records a status move rather than (or as well as) a note. */
function isTransition(update: EntryUpdate): boolean {
  return update.status_from !== null && update.status_to !== null
}

/** The one-word label on an item's rail. Computed here so both halves agree. */
function itemKindKey(item: TimelineItem): string {
  if (item.kind === 'entry') return 'track.raised'
  return isTransition(item.update) ? 'track.statusChange' : 'track.update'
}

export interface MapBranchHistoryProps {
  /** The track this branch sits under, or null — the root and the untracked
   *  pile are not tracks, and `loadTrackTimeline` has nothing to ask for. */
  trackId: string | null
}

export default function MapBranchHistory({ trackId }: MapBranchHistoryProps): ReactElement {
  const locale = useLocale()
  const { profile } = useAuth()
  const meId = profile?.id ?? null
  const role = profile?.role ?? 'member'

  const [params, setParams] = useSearchParams()

  const patchParams = useCallback(
    (next: Record<string, string | null>): void => {
      // A COPY of the live params, never a rebuild: `?focus=`, `?dim=`, `?lens=`
      // and `?unassigned=` belong to other writers and must survive this one.
      const p = new URLSearchParams(params)
      for (const [key, value] of Object.entries(next)) {
        if (value === null || value === '') p.delete(key)
        else p.set(key, value)
      }
      setParams(p, { replace: true })
    },
    [params, setParams],
  )

  // Resolved ONCE per mount: a tab left open across midnight keeping yesterday's
  // default range is strictly better than the range moving under the reader and
  // refetching on its own.
  const fallback = useMemo(() => lastNDays(DEFAULT_DAYS), [])
  const today = todayIso()
  // Both ends CLAMPED rather than trusted or swapped. `until` past today is a
  // window into the future with nothing in it, and would hand the date input a
  // value beyond its own `max`, which browsers render as an invalid control.
  // `since` after `until` is a typo, and collapsing it to a single day is
  // predictable where a silent swap is not.
  const until = clampIso(isoParam(params.get(P_UNTIL)) ?? fallback.to, undefined, today)
  const since = clampIso(isoParam(params.get(P_SINCE)) ?? fallback.from, undefined, until)
  const search = params.get(P_FIND) ?? ''
  const kind = kindParam(params.get(P_KIND))

  /* ── the window fetch ─────────────────────────────────────────────── */

  const [rows, setRows] = useState<TrackTimelineRows | null>(null)
  // Starts TRUE: a fetch is queued by the effect below on the very first commit,
  // and starting false makes the first paint read "nothing happened in this
  // window" for one frame before the request has even left.
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** Only the newest request may write state — a fast range drag fires several. */
  const request = useRef(0)

  const fetchWindow = useCallback(
    (notify = false): void => {
      if (trackId === null) {
        setLoading(false)
        return
      }
      const token = request.current + 1
      request.current = token
      setLoading(true)
      setError(null)
      void loadTrackTimeline(trackId, since, until).then((result) => {
        // A stale response must not write state OR toast.
        if (token !== request.current) return
        setLoading(false)
        if (!result.ok) {
          // The previous window stays on screen. A failed read with rows already
          // rendered is a note, never a wipe.
          setError(result.error)
          return
        }
        setRows(result.data)
        // Confirmed only once it is TRUE. Toasting on the click, before the
        // request has left, is the reassurance that stays on screen when the
        // reload actually fails.
        if (notify) toast(t('track.refreshed'))
      })
    },
    [trackId, since, until],
  )

  useEffect(() => {
    fetchWindow()
  }, [fetchWindow])

  /* ── the window half: items, days, tags ───────────────────────────── */

  const healthMap = useHealthMap()
  const memberMap = useMemberMap()
  const trackMap = useTrackMap()
  const allEntries = useEntryList()

  const liveTrackEntries = useMemo(
    () => (trackId === null ? [] : allEntries.filter((e) => e.track_id === trackId)),
    [allEntries, trackId],
  )

  // Live rows OUTSIDE the range are included on purpose: buildTimeline reads
  // them as parents for updates before it applies the window, which is what lets
  // a July update name the January item it belongs to.
  const windowEntries = useMemo(
    () => mergeEntriesById(rows?.entries ?? [], liveTrackEntries),
    [rows, liveTrackEntries],
  )

  /** Range + search applied, BOTH kinds — the kind toggle is a display filter. */
  const windowed = useMemo(
    () => buildTimeline(windowEntries, rows?.updates ?? [], { search, from: since, to: until }),
    [windowEntries, rows, search, since, until],
  )

  const shown = useMemo(
    () => (kind === 'all' ? windowed : windowed.filter((item) => item.kind === kind)),
    [windowed, kind],
  )

  const days = useMemo(() => groupByDay(shown), [shown])

  /**
   * The sibling list the detail sheet's prev/next walks, mirrored into a ref so
   * `handleOpen` is built ONCE. `derive()` mints a new `list` on every store
   * commit, so `useCallback(…, [orderedIds])` would be a new function on every
   * optimistic write — and one changed prop defeats memo() for EVERY row.
   */
  const orderedIds = useMemo(() => {
    const seen: string[] = []
    const known = new Set<string>()
    for (const item of shown) {
      const id = item.kind === 'entry' ? item.entry.id : item.entry?.id
      if (id === undefined || known.has(id)) continue
      known.add(id)
      seen.push(id)
    }
    return seen
  }, [shown])
  const orderedRef = useRef(orderedIds)
  orderedRef.current = orderedIds

  const handleOpen = useCallback((entryId: string) => {
    openEntry(entryId, { list: orderedRef.current })
  }, [])

  /** Resolved once per member-store change: an inline arrow would defeat memo(). */
  const memberName = useCallback(
    (authorId: string | null): string =>
      (authorId !== null ? memberMap.get(authorId)?.displayName : undefined) ??
      t('entry.authorUnknown'),
    [memberMap],
  )

  /**
   * Which window the reader asked to see in full, as the window's OWN KEY — so
   * changing the range, the search or the kind puts the fold back by
   * construction. Expanding 30 days and then tapping "Last 365 days" must not
   * mount a year at once.
   */
  const [expandedFor, setExpandedFor] = useState<string | null>(null)
  const windowKey = `${since}|${until}|${search}|${kind}`
  const expanded = expandedFor === windowKey
  const foldable = shown.length > MAX_ITEMS

  const visible = useMemo<{ days: ShownDay[]; hidden: number }>(() => {
    if (expanded) return { days: days.map((d) => ({ ...d, total: d.items.length })), hidden: 0 }
    let budget = MAX_ITEMS
    const out: ShownDay[] = []
    for (const day of days) {
      if (budget <= 0) break
      out.push({
        day: day.day,
        items: day.items.length <= budget ? day.items : day.items.slice(0, budget),
        total: day.items.length,
      })
      budget -= day.items.length
    }
    const mounted = out.reduce((n, d) => n + d.items.length, 0)
    return { days: out, hidden: shown.length - mounted }
  }, [days, shown.length, expanded])

  /**
   * The breakdown counts ITEMS RAISED in the window, so it follows the range and
   * the search but NOT the kind toggle — "updates only" is a question about the
   * feed, and blanking the chart in answer to it would be a different screen.
   */
  const breakdown = useMemo<BreakdownRow[]>(() => {
    const raised = windowed.flatMap((item) => (item.kind === 'entry' ? [item.entry] : []))
    const suggested = trackId === null ? [] : (trackMap.get(trackId)?.suggested_tags ?? [])
    const list = tagBreakdown(raised, windowTags(raised, suggested)).map((r) => ({
      key: `tag:${r.tag}`,
      label: r.tag,
      open: r.open,
      closed: r.closed,
    }))
    const untagged = countUntagged(raised)
    // Last, and only when it has something to say: a permanent "No tag: 0 / 0"
    // is a row that never means anything.
    if (untagged.open + untagged.closed > 0) {
      list.push({
        key: 'untagged',
        label: t('track.tagsNone'),
        open: untagged.open,
        closed: untagged.closed,
      })
    }
    return list
  }, [windowed, trackId, trackMap])

  const activePreset = useMemo(() => {
    if (until !== today) return null
    return PRESETS.find((n) => addDays(today, -(n - 1)) === since) ?? null
  }, [since, until, today])

  const setPreset = (span: number): void => {
    const next = lastNDays(span)
    patchParams({ [P_SINCE]: next.from, [P_UNTIL]: next.to })
  }

  /* ── render ───────────────────────────────────────────────────────── */

  // PROGRESSIVE, not blocking: the live store already knows this track's open
  // work, so the overlay gives the feed something true to render before the
  // window request lands. A refetch must never blank a list somebody is reading.
  const showError = error !== null && shown.length === 0
  const showSkeleton = !showError && loading && shown.length === 0

  return (
    <section className="mbr-band mbr-history" aria-label={t('track.feed')} aria-busy={loading}>
      <div className="mbr-band-head">
        <h3 className="section-title">{t('track.feed')}</h3>
        <span className="mbr-band-count tabular" aria-live="polite">
          {t('track.total', { count: shown.length })}
        </span>
      </div>

      {trackId === null ? (
        <p className="mbr-hint">{t('track.historyScope')}</p>
      ) : (
        <>
          <div className="mbr-range" role="group" aria-label={t('track.range')}>
            <div className="chip-row">
              {PRESETS.map((n) => (
                <button
                  key={n}
                  type="button"
                  className="chip tap-44"
                  aria-pressed={activePreset === n}
                  onClick={() => setPreset(n)}
                >
                  {t('track.rangeLast', { count: n })}
                </button>
              ))}
            </div>
            {/* Native date inputs rather than components/fields' DateField: this
                is a two-ended RANGE, so each end constrains the other through
                min/max, and neither end may be cleared. The control's VALUE is
                always YYYY-MM-DD whatever the platform displays, which is the
                IsoDate the loader takes. */}
            <div className="mbr-dates">
              <label className="mbr-date">
                <span className="mbr-date-label">{t('track.rangeFrom')}</span>
                <input
                  className="input mbr-date-input"
                  type="date"
                  value={since}
                  max={until}
                  onChange={(e) => patchParams({ [P_SINCE]: e.target.value || null })}
                />
              </label>
              <label className="mbr-date">
                <span className="mbr-date-label">{t('track.rangeTo')}</span>
                <input
                  className="input mbr-date-input"
                  type="date"
                  value={until}
                  min={since}
                  max={today}
                  onChange={(e) => patchParams({ [P_UNTIL]: e.target.value || null })}
                />
              </label>
            </div>
          </div>

          <div className="mbr-tools">
            <input
              className="input mbr-search"
              type="search"
              value={search}
              placeholder={t('track.searchPlaceholder')}
              aria-label={t('track.search')}
              onChange={(e) => patchParams({ [P_FIND]: e.target.value })}
            />
            <div className="chip-row" role="group" aria-label={t('track.kind')}>
              <button
                type="button"
                className="chip tap-44"
                aria-pressed={kind === 'all'}
                onClick={() => patchParams({ [P_KIND]: null })}
              >
                {t('track.kindAll')}
              </button>
              {KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  className="chip tap-44"
                  aria-pressed={kind === k}
                  onClick={() => patchParams({ [P_KIND]: k })}
                >
                  {t(k === 'entry' ? 'track.kindEntry' : 'track.kindUpdate')}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn btn-sm tap-44"
              onClick={() => fetchWindow(true)}
              disabled={loading}
            >
              {t('track.refresh')}
            </button>
          </div>

          <p className="mbr-showing tabular">
            {t('track.rangeShowing', { range: formatDateRange(since, until, locale) })}
          </p>

          <div className="mbr-tags">
            <h4 className="mbr-sub">{t('track.tags')}</h4>
            {breakdown.length === 0 ? (
              <>
                <p className="mbr-hint">{t('track.tagsEmpty')}</p>
                <p className="mbr-hint">{t('track.tagsEmptyHint')}</p>
              </>
            ) : (
              <>
                <TagBreakdown rows={breakdown} />
                <p className="mbr-hint">{t('track.tagsHint')}</p>
              </>
            )}
          </div>

          {rows?.truncated === true && (
            <p className="mbr-note" role="status">
              {t('track.truncated')}
            </p>
          )}
          {/* A failed window read with something already on screen — the previous
              range, or the live overlay — is a note, never a wipe. */}
          {error !== null && !showError && (
            <p className="mbr-note" role="status">
              {t(error)}
            </p>
          )}

          {showError ? (
            <EmptyState
              icon={<IconLayers size={26} />}
              title={t('track.errLoad')}
              description={t('common.errorHint')}
              action={
                <button type="button" className="btn btn-primary" onClick={() => fetchWindow(true)}>
                  {t('common.retry')}
                </button>
              }
            />
          ) : showSkeleton ? (
            <div role="status" aria-label={t('common.loading')}>
              <Skeleton count={4} height={62} />
            </div>
          ) : shown.length === 0 ? (
            // Two different nothings. A track with no history at all is not a
            // range that happens to be empty, and the fix differs.
            liveTrackEntries.length === 0 && (rows?.entries.length ?? 0) === 0 ? (
              <EmptyState
                icon={<IconLayers size={26} />}
                title={t('track.emptyTrack')}
                description={t('track.emptyTrackHint')}
              />
            ) : (
              <EmptyState
                icon={<IconLayers size={26} />}
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
            <>
              <ol className="mbr-days">
                {visible.days.map((day) => (
                  <li key={day.day} className="mbr-day">
                    <div className="mbr-day-head">
                      <span className="mbr-day-weekday">
                        {formatWeekday(day.day, locale, 'long')}
                      </span>
                      <span className="mbr-day-date tabular">
                        {formatDateLong(day.day, locale)}
                      </span>
                      {/* The day's OWN total, never the sliced length: the last
                          day before the fold can be cut mid-day. */}
                      <span className="mbr-day-count tabular">
                        {t('track.total', { count: day.total })}
                      </span>
                    </div>
                    <ol className="mbr-items">
                      {day.items.map((item) => (
                        // Each branch is handed ONLY the props its own body
                        // reads: an update row has no EntryRow to give health or
                        // a permission answer to, and passing them anyway would
                        // put two more values through the shallow compare.
                        <FeedItem
                          key={timelineKey(item)}
                          kind={item.kind}
                          kindKey={itemKindKey(item)}
                          entry={item.entry}
                          update={item.kind === 'update' ? item.update : undefined}
                          health={item.kind === 'entry' ? healthMap.get(item.entry.id) : undefined}
                          canEdit={item.kind === 'entry' && canEditEntry(item.entry, meId, role)}
                          meId={meId}
                          authorName={item.kind === 'update' ? memberName(item.update.author_id) : ''}
                          onOpen={handleOpen}
                        />
                      ))}
                    </ol>
                  </li>
                ))}
              </ol>
              {foldable && (
                // One fold for the whole feed rather than one per day: this is a
                // single stream, and a button under every date heading would
                // read as part of the timeline rather than as its end.
                <button
                  type="button"
                  className="btn btn-sm btn-ghost mbr-fold tap-44"
                  onClick={() => setExpandedFor(expanded ? null : windowKey)}
                >
                  {expanded ? t('track.showLess') : t('track.showAll')}
                  {visible.hidden > 0 && (
                    <span className="pill tabular">
                      {t('track.eventsHidden', { count: visible.hidden })}
                    </span>
                  )}
                </button>
              )}
            </>
          )}
        </>
      )}
    </section>
  )
}

/* ══════════════════════════ the tag breakdown ══════════════════════════ */

function TagBreakdown({ rows }: { rows: BreakdownRow[] }): ReactElement {
  useLocale()
  // Bars scale against the BIGGEST row, not the window total: with six tags the
  // tallest bar would otherwise be a sixth of the track and the chart would say
  // nothing. The numbers beside them carry the absolute truth.
  const max = rows.reduce((n, r) => Math.max(n, r.open + r.closed), 0)
  const pct = (n: number): number => (max === 0 ? 0 : Math.round((n / max) * 100))

  return (
    <ul className="mbr-tag-list">
      {rows.map((row) => {
        const label = t('track.tagsRow', { tag: row.label, open: row.open, closed: row.closed })
        return (
          <li key={row.key} className="mbr-tag-row">
            <span className="mbr-tag-name">{row.label}</span>
            {/* One accessible sentence for the whole row; the bar and the two
                numbers repeat it visually and are hidden from the reader that
                already heard it. */}
            <span className="sr-only">{label}</span>
            <span className="mbr-tag-bar" aria-hidden="true" title={label}>
              <span
                className="mbr-tag-fill"
                data-part="open"
                style={{ inlineSize: `${pct(row.open)}%` } as CSSProperties}
              />
              <span
                className="mbr-tag-fill"
                data-part="closed"
                style={{ inlineSize: `${pct(row.closed)}%` } as CSSProperties}
              />
            </span>
            <span className="mbr-tag-n tabular" aria-hidden="true">
              <span className="mbr-tag-open">{row.open}</span>
              <span className="mbr-tag-sep">{t('track.tagsOpen')}</span>
              {/* No class beside `.mbr-tag-open`'s: the closed tally is meant to
                  be the quieter of the two, and `.mbr-tag-n`'s `--text-dim` is
                  already that. A `.mbr-tag-closed` name with no rule behind it
                  claimed a distinction the sheet never drew. */}
              <span>{row.closed}</span>
              <span className="mbr-tag-sep">{t('track.tagsClosed')}</span>
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/* ══════════════════════════ one thread row ══════════════════════════ */

export interface UpdateItemProps {
  update: EntryUpdate
  entry: Entry | undefined
  meId: string | null
  authorName: string
  onOpen: (id: string) => void
}

/**
 * EXPORTED FOR THE TEST, in the idiom the deleted TrackTimeline set and for the
 * same reason: the feed's rows only exist after `loadTrackTimeline()` resolves
 * into state, effects do not run under `renderToStaticMarkup`, and
 * vitest.config.ts is `environment: 'node'` with no jsdom — so nothing reachable
 * from a `render()` can see this markup. The alternative was a grep over the
 * source, which is the weaker instrument.
 */
export function UpdateItem({
  update,
  entry,
  meId,
  authorName,
  onOpen,
}: UpdateItemProps): ReactElement {
  const locale = useLocale()
  const vocabLabel = useVocabLabel()
  // Read into locals so TypeScript narrows the fields themselves — a boolean
  // computed elsewhere does not narrow them, and the alternative is two non-null
  // assertions on a row a realtime patch could have replaced.
  const statusFrom = update.status_from
  const statusTo = update.status_to
  const author =
    update.author_id !== null && update.author_id === meId ? t('entry.author') : authorName
  // A row `nudge_entry()` (migration 0019) wrote stores the ask as the token
  // `[nudge]` so the sentence can be chosen per reader. Branched rather than
  // `t(key ?? body)` so that user text never reaches the lookup.
  const bodyKey = threadBodyKey(update.body)

  return (
    <article className="mbr-upd">
      <header className="mbr-upd-head">
        <span className="mbr-upd-author">{author}</span>
        <time className="mbr-upd-time tabular" dateTime={update.created_at}>
          {formatRelativeTime(update.created_at, locale)}
        </time>
      </header>

      {statusFrom !== null && statusTo !== null && (
        <p className="mbr-upd-transition">
          {/* The pills carry their labels through the vocabulary store, so an
              admin renaming a status re-labels every historical transition here
              with ZERO writes. */}
          <StatusPill status={statusFrom} size="sm" />
          {/* Through t(), because U+2192 has bidi class ON and the bidi
              algorithm does not mirror it: a hardcoded arrow keeps pointing
              right while the pills beside it lay out right-to-left, so the
              Arabic row would read "to → from". entry.arrow is seeded → / ←. */}
          <span aria-hidden="true">{t('entry.arrow')}</span>
          <StatusPill status={statusTo} size="sm" />
          {/* The glyph is decorative, so the sentence is what a screen reader
              gets. */}
          <span className="sr-only">
            {t('entry.statusChangedBy', {
              name: author,
              from: vocabLabel('status', statusFrom),
              to: vocabLabel('status', statusTo),
            })}
          </span>
        </p>
      )}

      {update.body !== '' && (
        <p className="mbr-upd-body">{bodyKey === null ? update.body : t(bodyKey)}</p>
      )}

      {entry ? (
        <button
          type="button"
          className="mbr-upd-parent"
          onClick={() => onOpen(entry.id)}
          aria-label={t('track.openItem', { title: entry.title })}
        >
          <span className="entry-title">{entry.title}</span>
        </button>
      ) : (
        // The API guarantees an update's parent is in the same window, so this
        // is only reachable when the entries read hit its page cap. Saying so is
        // better than a row that refers to nothing.
        <p className="mbr-upd-orphan muted">{t('track.orphan')}</p>
      )}
    </article>
  )
}

/* ══════════════════════════ one feed item ══════════════════════════ */

interface FeedItemProps {
  /** The `<li>`'s data-kind, and which branch below draws the body. */
  kind: TimelineKind
  /** The one-word rail label's i18n key — resolved by the caller. */
  kindKey: string
  /** An entry item's row, or an update item's PARENT (undefined when orphaned). */
  entry: Entry | undefined
  update: EntryUpdate | undefined
  health: EntryHealth | undefined
  canEdit: boolean
  meId: string | null
  /** Already resolved through the member map, so this prop is a plain string. */
  authorName: string
  onOpen: (id: string) => void
}

/**
 * One item, as the kit renders it — INCLUDING the `<li>` shell.
 *
 * The shell is inside the memo boundary because the boundary only pays if the
 * whole subtree can bail out; an `<li>` re-created by the parent on every commit
 * would re-render the rail and the kind label and then hand the memoised child a
 * re-render anyway. Both branches still share one `<li>`, which is what makes
 * the vertical line down the panel read as one stream.
 *
 * THE PROPS ARE FLATTENED rather than a `TimelineItem`: every store commit
 * rebuilds this panel's whole derivation and `buildTimeline` mints a brand-new
 * wrapper per item, so memoising on the wrapper would bail out never. The Entry
 * and EntryUpdate objects INSIDE it are identity-stable.
 *
 * SUBSCRIBED TO THE LOCALE because `t(kindKey)` is called here and every prop is
 * locale-independent — without it a language switch leaves the rail labels in
 * the previous language.
 */
const FeedItem = memo(function FeedItem({
  kind,
  kindKey,
  entry,
  update,
  health,
  canEdit,
  meId,
  authorName,
  onOpen,
}: FeedItemProps): ReactElement {
  useLocale()
  return (
    <li className="mbr-item" data-kind={kind}>
      <span className="mbr-rail" aria-hidden="true">
        <span className="mbr-dot" />
      </span>
      <div className="mbr-body">
        <p className="mbr-kind">{t(kindKey)}</p>
        {kind === 'entry' && entry !== undefined ? (
          <EntryRow
            entry={entry}
            health={health}
            show={SHOW_FEED}
            canEdit={canEdit}
            onOpen={onOpen}
          />
        ) : update !== undefined ? (
          <UpdateItem
            update={update}
            entry={entry}
            meId={meId}
            authorName={authorName}
            onOpen={onOpen}
          />
        ) : null}
      </div>
    </li>
  )
})
