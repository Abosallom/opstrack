// /notifications — the inbox history, and the bell's "see all".
//
// THE BELL IS A PEEK; THIS IS THE RECORD. The popover shows eight rows and no
// controls beyond mark-all, because it is glanced at between two other tasks.
// This screen is where somebody goes to answer "what was I asked for last
// week" — so it adds the unread filter, day grouping, a manual refresh, and it
// shows the whole page the api returns (50 rows; deep history is not what a
// notification table is for, and api/notifications.ts's DEFAULT_LIMIT says so).
//
// EVERY ROW COMES FROM components/NotificationBell.tsx AND THAT IS DELIBERATE.
// The actor name is the one forgeable field in this table (see that file's
// header: `actor_name` is a trigger-written snapshot and a member can rename
// themselves), so `notificationSentence()` is imported rather than reimplemented
// — a second sentence builder on this page is exactly how the live-profile
// lookup would get dropped on one of the two surfaces and nowhere else.
//
// ON MOBILE THIS IS THE "MORE" DESTINATION. The tab bar is capped at five slots
// and the header bell opens a dismissible sheet, so Settings' notifications row
// (NotificationsSettingsRow, same file) is the durable way back to the history
// from a phone.
//
// GROUPING IS BY LOCAL CALENDAR DAY, via lib/dates.daysSince — not by slicing
// the ISO instant, which is UTC and would file an 02:00 Riyadh notification
// under yesterday. That module's header documents the trap.

import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import {
  NotificationBody,
  openFromNotification,
  useFreshIds,
  useMinuteTick,
} from '../components/NotificationBell'
import { toast } from '../components/toast'
import { daysSince } from '../lib/dates'
import { t, useLocale } from '../lib/i18n'
import {
  loadNotifications,
  markAllNotificationsRead,
  useNotifications,
  useNotificationsError,
  useNotificationsLoading,
  useUnreadCount,
} from '../store/notifications'
import type { AppNotification } from '../types'
import '../components/notifications.css'

/** Which pile a row falls in. Three buckets, because a fourth is a date. */
type DayBucket = 'today' | 'yesterday' | 'earlier'

const BUCKET_ORDER: readonly DayBucket[] = ['today', 'yesterday', 'earlier']

/**
 * The heading for each bucket. Literal keys, not `t(\`date.${bucket}\`)` — a
 * template literal is invisible to lib/localeReach.test.ts, and `earlier` lives
 * in a different namespace from the other two anyway.
 */
const BUCKET_KEY: Record<DayBucket, string> = {
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

export default function Notifications(): ReactElement {
  const locale = useLocale()
  const items = useNotifications()
  const unread = useUnreadCount()
  const loading = useNotificationsLoading()
  const error = useNotificationsError()
  const fresh = useFreshIds(items)
  // Always ticking here: this screen is one somebody leaves open while working
  // through it, and a frozen "2 min ago" on a list of twenty is worse than one
  // re-render a minute.
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

  // Optimistic toast, for the reason NotificationBell's markAll() documents:
  // the store's write is optimistic and raises its own error toast on a
  // rollback, so a success message here is corrected rather than contradicted.
  const onMarkAll = useCallback((): void => {
    void markAllNotificationsRead()
    toast(t('notif.allRead'))
  }, [])

  const empty =
    groups.length === 0 ? (
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
            <button type="button" className="btn btn-sm" onClick={() => setUnreadOnly(false)}>
              {t('notif.showAll')}
            </button>
          ) : undefined
        }
      />
    ) : null

  return (
    <div className="notif-page">
      <header className="notif-page-head">
        <div className="notif-page-titles">
          <h1 className="page-title">{t('notif.title')}</h1>
          <p className="page-subtitle">{t('notif.subtitle')}</p>
        </div>
        <div className="notif-page-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void loadNotifications(true)}
            disabled={loading}
          >
            {t('notif.refresh')}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={onMarkAll}
            disabled={unread === 0}
          >
            {t('notif.markAllRead')}
          </button>
        </div>
      </header>

      {/* Two chips rather than a segmented control: this is a filter that is
          either on or off, and `aria-pressed` says so more honestly than a
          radiogroup of two would. */}
      <div className="notif-page-filter">
        <button
          type="button"
          className={`chip${unreadOnly ? '' : ' active'}`}
          aria-pressed={!unreadOnly}
          onClick={() => setUnreadOnly(false)}
        >
          {t('notif.showAll')}
        </button>
        <button
          type="button"
          className={`chip${unreadOnly ? ' active' : ''}`}
          aria-pressed={unreadOnly}
          onClick={() => setUnreadOnly(true)}
        >
          {t('notif.showUnread')}
        </button>
        {unread > 0 && <span className="pill info">{t('notif.unread', { count: unread })}</span>}
      </div>

      {empty ?? (
        <div className="notif-page-list">
          {groups.map((group) => (
            <section className="notif-group" key={group.bucket}>
              <h2 className="notif-group-head">{t(BUCKET_KEY[group.bucket])}</h2>
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
