// THE RECORD OF CHANGES — the map's `what-changed` panel, and the screen
// `/notifications` used to be.
//
// IT IS THE RECORD, NOT THE PEEK. `components/NotificationBell.tsx` shows eight
// rows and one control because it is glanced at between two other tasks. This is
// where somebody goes to answer "what was I asked for last week" — so it adds
// the unread filter, the DAY GROUPING and a refresh, and it shows the whole page
// the api returns (50 rows; deep history is not what a notification table is
// for, and api/notifications.ts's DEFAULT_LIMIT says so).
//
// DAY-GROUPED, AND THAT IS THE WHOLE DIFFERENCE. "What changed just now" is the
// bell's question and it is answered by a stack of newest-first rows. "What
// happened while I was not looking" is this one, and it needs today / yesterday
// / earlier — the shape that survives a week of not opening the app. Grouping is
// by LOCAL CALENDAR DAY via `lib/dates.daysSince`, never by slicing the ISO
// instant, which is UTC and would file an 02:00 Riyadh notification under
// yesterday. That module's header documents the trap.
//
// EVERY ROW COMES FROM NotificationBell AND THAT IS DELIBERATE. `actor_name` is
// a trigger-written snapshot and a member can rename themselves, so
// `notificationSentence()` — reached here through `NotificationBody` — is the
// ONLY place allowed to resolve an actor. A second row renderer in this file is
// exactly how the live-profile lookup would get dropped on one surface and
// nowhere else. It also brings the interaction this panel exists for: the body
// opens the entry, and the TRAILING DOT marks the row read WITHOUT opening it —
// two sibling buttons, never nested, because a button inside a button is invalid
// HTML and the browser resolves it by dropping one.
//
// A NOTIFICATION ROUTINELY NAMES AN ENTRY THIS CLIENT HAS NEVER FETCHED — a
// closed one, another track's — because store/notifications is independent of
// store/entries by design and the row carries its own title snapshot. So these
// rows are readable and openable AS ROWS: `openFromNotification` calls
// `openEntry`, which self-loads. Nothing here ever tries to "jump to the node",
// because for most of these rows there is no node: the map draws OPEN work only.
//
// LAYERING. This is a sibling of the canvas, never a child — `.mtree-canvas` is
// `touch-action: none` and that intersects DOWN the ancestor chain, so a
// scrolling list inside it cannot be panned with a finger. `MapPanel` is the
// host: it draws the heading, the close button and the phone sheet's detents,
// and opens this subject at detent `full`. This file adds no sheet of its own.

import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import {
  NotificationBody,
  openFromNotification,
  useFreshIds,
  useMinuteTick,
} from '../NotificationBell'
import { toast } from '../toast'
import { daysSince } from '../../lib/dates'
import { t, useLocale } from '../../lib/i18n'
import {
  loadNotifications,
  markAllNotificationsRead,
  useNotifications,
  useNotificationsError,
  useNotificationsLoading,
  useUnreadCount,
} from '../../store/notifications'
import type { AppNotification } from '../../types'
// The rows are NotificationBell's, so their sheet comes with them. This file's
// own `.mchg-*` rules never reach into a `.notif-*` class.
import '../notifications.css'
import './map-changes.css'

/** Which pile a row falls in. Three buckets, because a fourth is a date. */
type DayBucket = 'today' | 'yesterday' | 'earlier'

const BUCKET_ORDER: readonly DayBucket[] = ['today', 'yesterday', 'earlier']

/**
 * The heading for each bucket. LITERAL keys, never `t(\`date.${bucket}\`)` — a
 * template literal is invisible to lib/localeReach.test.ts, and `earlier` lives
 * in a different namespace from the other two anyway.
 */
const BUCKET_KEY: Readonly<Record<DayBucket, string>> = {
  today: 'date.today',
  yesterday: 'date.yesterday',
  earlier: 'notif.earlier',
}

function bucketOf(item: AppNotification, now: Date): DayBucket {
  const days = daysSince(item.createdAt, now)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return 'earlier'
}

/**
 * The badge on the `what-changed` chip: how many rows are unread.
 *
 * STORED IN THE STORE, not counted here — `store/notifications` keeps `unread`
 * beside `items` precisely so a selector cannot run a filter on every keystroke
 * anywhere in the app. This hook is called by the shell on every render of the
 * map, so that property is the whole reason it is one line.
 *
 * It deliberately does NOT fetch: `NotificationBell` is mounted in the app shell
 * and warms the store, and a second unconditional load from a chip badge would
 * be a request per surface for one list.
 */
export function useChangesCount(): number {
  return useUnreadCount()
}

export interface MapChangesProps {
  /** The shell's one reading of `(max-width: 767px)`. */
  compact: boolean
  /** The shell's polite live region. */
  announce: (text: string) => void
}

export default function MapChanges({ compact, announce }: MapChangesProps): ReactElement {
  const locale = useLocale()
  const items = useNotifications()
  const unread = useUnreadCount()
  const loading = useNotificationsLoading()
  const error = useNotificationsError()
  const fresh = useFreshIds(items)
  /**
   * Always ticking. `MapPanel` renders nothing at all when it is closed, so this
   * component is mounted only while a reader is looking at it — and a frozen
   * "2 min ago" on a list somebody is working through is worse than one
   * re-render a minute.
   */
  const now = useMinuteTick(true)
  const [unreadOnly, setUnreadOnly] = useState(false)

  // Deduped by the store; a warm inbox costs one early return.
  useEffect(() => {
    void loadNotifications()
  }, [])

  const visible = useMemo(
    () => (unreadOnly ? items.filter((item) => item.readAt === null) : items),
    [items, unreadOnly],
  )

  /**
   * Bucketed in order. The api returns newest-first and this preserves that
   * within each group, so the grouping is a set of headings inserted into one
   * ordered list rather than a re-sort — which is what keeps a row from moving
   * when its bucket boundary is crossed by the clock.
   */
  const groups = useMemo(() => {
    const byBucket = new Map<DayBucket, AppNotification[]>()
    for (const item of visible) {
      const bucket = bucketOf(item, now)
      const list = byBucket.get(bucket)
      if (list) list.push(item)
      else byBucket.set(bucket, [item])
    }
    return BUCKET_ORDER.flatMap((bucket) => {
      const list = byBucket.get(bucket)
      return list === undefined ? [] : [{ bucket, items: list }]
    })
  }, [visible, now])

  const onOpen = useCallback((item: AppNotification): void => {
    openFromNotification(item)
  }, [])

  /**
   * Mark everything read.
   *
   * ONE report, and it is optimistic to match the store's write: if the server
   * refuses, `store/notifications` restores the snapshot AND raises its own
   * error toast, so the correction lands second and in the error tone. A second
   * success message from here — the toast host is already a polite live region —
   * would say the same thing twice to a screen reader.
   */
  const onMarkAll = useCallback((): void => {
    void markAllNotificationsRead()
    toast(t('notif.allRead'))
  }, [])

  const setFilter = (next: boolean): void => {
    if (next === unreadOnly) return
    setUnreadOnly(next)
    // Nothing else on the screen moves when this chip flips, so a reader who is
    // not looking at the panel has no other way to be told the list changed.
    announce(t('map.showing', { label: t(next ? 'notif.showUnread' : 'notif.showAll') }))
  }

  return (
    <div className="mchg" data-compact={compact ? '' : undefined}>
      <div className="mchg-tools">
        {/* Two chips rather than a segmented radiogroup: this is a filter that is
            either on or off, and `aria-pressed` says so more honestly than a
            radiogroup of two would — and it keeps the arrow keys, which the
            canvas one Tab stop away needs. */}
        <div className="chip-row mchg-seg" role="group" aria-label={t('map.changesWhich')}>
          <button
            type="button"
            className="chip"
            aria-pressed={!unreadOnly}
            onClick={() => setFilter(false)}
          >
            {t('notif.showAll')}
          </button>
          <button
            type="button"
            className="chip"
            aria-pressed={unreadOnly}
            onClick={() => setFilter(true)}
          >
            {t('notif.showUnread')}
          </button>
        </div>

        {unread > 0 && (
          <span className="pill info mchg-unread">{t('notif.unread', { count: unread })}</span>
        )}

        <button
          type="button"
          className="btn btn-sm btn-ghost mchg-refresh"
          onClick={() => void loadNotifications(true)}
          disabled={loading}
        >
          {t('notif.refresh')}
        </button>

        <button
          type="button"
          className="btn btn-sm mchg-markall"
          onClick={onMarkAll}
          disabled={unread === 0}
        >
          {t('notif.markAllRead')}
        </button>
      </div>

      {groups.length === 0 ? (
        // Loading, failed and empty are all real states rather than a blank box,
        // and NotificationBody decides which in the order loading → error →
        // empty. The unread-only case gets its own copy AND the way back out,
        // because "nothing unread" with no escape reads as "nothing at all".
        <NotificationBody
          items={[]}
          loading={loading}
          error={error}
          locale={locale}
          now={now}
          fresh={fresh}
          onOpen={onOpen}
          emptyTitle={unreadOnly ? t('notif.noUnread') : t('notif.empty')}
          emptyHint={unreadOnly ? t('notif.noUnreadHint') : t('notif.emptyHint')}
          emptyAction={
            unreadOnly ? (
              <button type="button" className="btn btn-sm" onClick={() => setFilter(false)}>
                {t('notif.showAll')}
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="mchg-groups">
          {groups.map((group) => (
            <section className="mchg-group" key={group.bucket}>
              {/* h3, not h2: `MapPanel` names this region with an h2 and
                  EntrySection's headings elsewhere in the dock are h2s. A day is
                  a division INSIDE the panel, and skipping a level is how an
                  outline stops being navigable. */}
              <h3 className="mchg-group-head">{t(BUCKET_KEY[group.bucket])}</h3>
              <NotificationBody
                items={group.items}
                loading={false}
                error={null}
                locale={locale}
                now={now}
                fresh={fresh}
                onOpen={onOpen}
                emptyTitle={t('notif.empty')}
                emptyHint={t('notif.emptyHint')}
              />
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
