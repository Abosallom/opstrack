// The notification centre: the header bell, its inbox surface, and the row
// renderer that /notifications reuses.
//
// ── THE ONE RULE THIS FILE EXISTS TO ENFORCE ──────────────────────────────
//
// THE ACTOR IS RESOLVED THROUGH THE MEMBER MAP, NEVER PRINTED FROM THE ROW.
// api/notifications.ts's header states the contract and the reason: `actor_name`
// is a trigger-written SNAPSHOT, and `profiles_update` lets a member edit their
// own row (guard_profile_role() pins `role`, nothing else). So a member can
// rename themselves to anybody, cause a notification, and rename back — leaving
// an inbox line permanently attributed to a name they no longer hold. That is a
// FIXED Wave-1 finding, and `notificationSentence()` below is the only place in
// the app allowed to touch `actorName`:
//
//     memberMap.get(actorId)?.displayName  →  actorName  →  the actor-less sentence
//
// The live profile first; the snapshot ONLY for an actor whose profile is gone
// (`actor_id` is `on delete set null`, so that case is real, not theoretical);
// and `notif.assignedNoActor` / `notif.completedNoActor` when both are empty,
// rather than a sentence with a hole in it. A renderer that prints `actorName`
// directly re-opens the forgery, which is why no other file may build this
// string — the page imports this function instead of writing its own.
//
// `entryTitle` is the opposite case and is printed as stored: what the item was
// called when this happened is the honest thing to show, and the row has to stay
// readable after a retitle. Only a blank one is substituted (`notif.untitled`),
// because the trigger writes '' for an entry captured without a title.
//
// ── WHY TWO PRESENTATIONS ─────────────────────────────────────────────────
//
// A non-modal POPOVER at ≥768px and the shared modal Sheet below it. The bell is
// a peek, not a destination: a focus-trapping panel that dims the board to show
// eight lines is the wrong weight for it, and the app already spends its one
// full-height inline-end panel on the entry detail — two identical-looking
// panels meaning different things is the confusion worth avoiding. On a phone
// there is no room for an anchored popover at all, so that branch hands the job
// to components/sheet/Sheet.tsx and inherits its focus trap, scrim, Escape
// arbitration and close button rather than growing a second copy of them.
//
// Escape in the popover branch goes through lib/overlayStack, not a private
// listener — that module's header documents why (one arbiter, LIFO, bubble
// phase, `defaultPrevented` respected), and a bell that swallowed Escape from
// under an open Confirm would be exactly the bug it was written to kill.
//
// ── LOADING ───────────────────────────────────────────────────────────────
//
// This component is what warms store/notifications. Shell opens the realtime
// stream but never fetches, so without the mount effect below the badge would
// only ever count notifications that arrived while the tab was open. It is safe
// to call unawaited and from every mount: loadNotifications() de-duplicates and
// never rejects.
//
// ── ICON OWNERSHIP ────────────────────────────────────────────────────────
//
// IconBell is defined here, to the same recipe as components/icons.tsx (24 grid,
// currentColor stroke, 1.8 weight, round joins, aria-hidden), for the reason
// components/fields/glyphs.tsx states in its own header: icons.tsx is a
// single-owner file and this worker does not own it. The handoff note asks the
// integrator to move it and swap the import at the wave close.

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from 'react'
import { NavLink } from 'react-router-dom'
import Sheet from './sheet/Sheet'
import { EmptyState, Skeleton } from './shared'
import { IconCheck } from './fields/glyphs'
import { IconChevronEnd, IconUser, type IconProps } from './icons'
import { toast } from './toast'
import { formatRelativeTime } from '../lib/dates'
import { t, useLocale, type Locale } from '../lib/i18n'
import { pushOverlay } from '../lib/overlayStack'
import { useMemberMap } from '../store/members'
import { openPanelForLens } from '../store/mindtree'
import {
  loadNotifications,
  markAllNotificationsRead,
  markNotificationsRead,
  useNotifications,
  useNotificationsError,
  useNotificationsLoading,
  useUnreadCount,
} from '../store/notifications'
import { openEntry } from '../store/entrySheet'
import type { Member } from '../api/members'
import type { AppNotification } from '../types'
import './notifications.css'

/* ---------- the glyph ---------- */

/**
 * A bell. Not directional: it hangs on the vertical axis and reads identically
 * in both writing directions, so it carries no `icon-directional`.
 */
export function IconBell({ className, size = 24 }: IconProps): ReactElement {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M18 9a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16S18 14 18 9z" />
      <path d="M13.7 20a2 2 0 0 1-3.4 0" />
    </svg>
  )
}

/**
 * The kind glyph for a nudge: a speech bubble, because somebody is talking to
 * you.
 *
 * THE SAME PATH AS `IconAsk` in components/entry/NudgeButton.tsx, on purpose and
 * not by accident — the button that sends the ask and the inbox row that
 * delivers it are two ends of one gesture, and a user who learns the bubble on
 * the entry row should meet the same bubble in the bell. It is duplicated rather
 * than shared for this file's own ICON OWNERSHIP reason above: icons.tsx is a
 * single-owner file. The handoff asks for `IconBell`, `IconAsk` and this one to
 * be folded in together, at which point both call sites import the same symbol.
 *
 * The tail points DOWN, not along the inline axis: a side tail carries a reading
 * direction and would need `icon-directional` to survive Arabic. A centred tail
 * reads identically in both.
 */
function IconAsk({ className, size = 24 }: IconProps): ReactElement {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M20 5v9a1 1 0 0 1-1 1h-5.2L12 18.5 10.2 15H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1z" />
    </svg>
  )
}

/* ---------- the sentence ---------- */

/**
 * The inbox line for one notification, actor resolved per the contract at the
 * top of this file.
 *
 * Pure and exported: pages/Notifications.tsx renders the same sentence, and a
 * second implementation there is precisely how `actorName` would find its way
 * back onto a screen.
 *
 * The six sentence keys are written as literals rather than built with a
 * template so lib/localeReach.test.ts can see them — a `t(\`notif.${kind}\`)`
 * is invisible to that scan, which is how the Wave-2 SLA keys shipped missing.
 */
export function notificationSentence(
  memberMap: ReadonlyMap<string, Member>,
  item: AppNotification,
): string {
  // The live profile wins. `?? actorName` in the api header's shorthand is a
  // `||` in practice: a member row with a blank display_name is what half-done
  // provisioning leaves behind, and a name-shaped hole is worse than the
  // snapshot it would shadow. store/members.memberLabel() makes the same call.
  const live = item.actorId === null ? '' : (memberMap.get(item.actorId)?.displayName.trim() ?? '')
  const actor = live || item.actorName.trim()
  const title = item.entryTitle.trim() || t('notif.untitled')
  // A SWITCH WITH NO `default:`, and that is the repair rather than a tidy-up.
  // With `kind` a closed union, an unhandled member leaves this function able to
  // reach its end, and the annotated `: string` return type turns that into a
  // tsc error. The ternary pair this replaced had no such floor: it absorbed any
  // kind that was not 'completed' into the 'assigned' sentence, so migration
  // 0019's 'nudged' shipped telling an owner that an item they already own had
  // just been assigned to them — in both languages, and on the push banner too.
  switch (item.kind) {
    case 'completed':
      return actor === ''
        ? t('notif.completedNoActor', { title })
        : t('notif.completed', { actor, title })
    case 'nudged':
      return actor === ''
        ? t('notif.nudgedNoActor', { title })
        : t('notif.nudged', { actor, title })
    case 'assigned':
      return actor === ''
        ? t('notif.assignedNoActor', { title })
        : t('notif.assigned', { actor, title })
  }
}

/* ---------- shared hooks ---------- */

const NO_IDS: ReadonlySet<string> = new Set<string>()

/** How long the arrival animation's marker class stays on a row. */
const FRESH_MS = 600

/**
 * The ids that appeared in `items` AFTER the first render — i.e. the ones
 * realtime just delivered.
 *
 * The first batch is deliberately NOT fresh: animating forty rows in on a cold
 * load is a page that looks broken, and the thing worth pointing at is the one
 * line that arrived while the user was reading. Bookkeeping happens in an
 * effect rather than during render because a ref mutated in a render body is a
 * side effect React is allowed to discard and re-run.
 */
export function useFreshIds(items: readonly AppNotification[]): ReadonlySet<string> {
  const seen = useRef<Set<string>>(new Set())
  const primed = useRef(false)
  const [fresh, setFresh] = useState<ReadonlySet<string>>(NO_IDS)

  useEffect(() => {
    const arrived = new Set<string>()
    for (const item of items) {
      if (primed.current && !seen.current.has(item.id)) arrived.add(item.id)
      seen.current.add(item.id)
    }
    primed.current = true

    if (arrived.size === 0) {
      // Same reference when there is nothing to clear, so this cannot loop:
      // zustand/React both bail on an identical snapshot.
      setFresh((current) => (current.size === 0 ? current : NO_IDS))
      return undefined
    }
    setFresh(arrived)
    const timer = window.setTimeout(() => setFresh(NO_IDS), FRESH_MS)
    return () => window.clearTimeout(timer)
  }, [items])

  return fresh
}

/**
 * A `now` that advances once a minute while `active`, so "3 min ago" does not
 * sit frozen on a surface the user leaves open.
 *
 * Only while active: an interval ticking behind a closed popover re-renders the
 * whole header once a minute for nobody.
 */
export function useMinuteTick(active: boolean): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    if (!active) return undefined
    // Re-read on activation: a popover opened after ten idle minutes must not
    // paint its first frame with a ten-minute-old clock.
    setNow(new Date())
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [active])
  return now
}

/* ---------- the row ---------- */

export interface NotificationItemProps {
  item: AppNotification
  /** Passed in rather than read per row: one locale subscription per surface. */
  locale: Locale
  now: Date
  fresh: boolean
  /** Open the entry. The surface decides what else happens (closing itself). */
  onOpen: (item: AppNotification) => void
}

/**
 * One inbox line. TWO controls, not one: the body opens the entry (and marks
 * the row read on the way), and the trailing dot marks it read WITHOUT opening
 * — which is the whole interaction for the half of notifications that are
 * "noted, thanks". They are siblings rather than nested because a button inside
 * a button is invalid HTML and browsers resolve it by dropping one of them.
 *
 * The dot IS the unread indicator and the control at once. It swaps to a check
 * on hover and focus-within, and stays a dot on touch, where there is no hover
 * to reveal anything — so the affordance is never hidden behind a gesture the
 * device does not have.
 */
export function NotificationItem({
  item,
  locale,
  now,
  fresh,
  onOpen,
}: NotificationItemProps): ReactElement {
  const memberMap = useMemberMap()
  const unread = item.readAt === null

  return (
    <li className="notif-item" data-unread={unread || undefined} data-fresh={fresh || undefined}>
      <button type="button" className="notif-item-main" onClick={() => onOpen(item)}>
        {/* Decorative, and deliberately so: `notificationSentence()` beside it
            already says which kind this is, in words, in the button's accessible
            name. The glyph is a scanning aid for the eye, not a second channel —
            announcing it would read every row twice. */}
        <span className={`notif-kind notif-kind-${item.kind}`} aria-hidden="true">
          {item.kind === 'completed' ? (
            <IconCheck size={15} />
          ) : item.kind === 'nudged' ? (
            <IconAsk size={15} />
          ) : (
            <IconUser size={15} />
          )}
        </span>
        <span className="notif-item-body">
          <span className="notif-item-sentence">{notificationSentence(memberMap, item)}</span>
          {/* A timestamp, so it is a <time>. The machine-readable value is the
              instant; the text is the relative form the row shows. */}
          <time className="notif-item-time" dateTime={item.createdAt}>
            {formatRelativeTime(item.createdAt, locale, now)}
          </time>
        </span>
        {/* The dot is decorative; this is what tells a screen reader the row is
            unread, and it lands inside the button's accessible name. */}
        {unread && <span className="sr-only">{t('notif.unreadRow')}</span>}
      </button>
      {unread ? (
        <button
          type="button"
          className="notif-item-read"
          aria-label={t('notif.markRead')}
          title={t('notif.markRead')}
          onClick={() => void markNotificationsRead([item.id])}
        >
          <span className="notif-dot" aria-hidden="true" />
          <IconCheck className="notif-check" size={16} />
        </button>
      ) : (
        // Keeps the read rows aligned with the unread ones. A list whose text
        // column shifts by 44px depending on read state reads as two lists.
        <span className="notif-item-read notif-item-spacer" aria-hidden="true" />
      )}
    </li>
  )
}

/* ---------- the inbox body, shared by both surfaces ---------- */

export interface NotificationBodyProps {
  items: readonly AppNotification[]
  loading: boolean
  /** An i18n KEY from the store, or null. Rendered through t(). */
  error: string | null
  locale: Locale
  now: Date
  fresh: ReadonlySet<string>
  onOpen: (item: AppNotification) => void
  emptyTitle: string
  emptyHint: string
  /** Rendered under the empty state's copy — the page's "show all" escape. */
  emptyAction?: ReactNode
  /**
   * The list's accessible name. OMITTED for a list that already sits under a
   * visible heading — the page's day groups do, and naming all three of them
   * "Notification inbox" would announce the same label three times while
   * hiding the one distinction that matters (which day).
   */
  listLabel?: string
}

/**
 * Loading → error → empty → list, in that order, and every one of the four is a
 * real state rather than a blank box (POLISH MANDATE).
 *
 * The loading skeleton only shows when there is nothing to show: a focus
 * refetch with rows already on screen must not blank them, which is the same
 * rule store/notifications.loadNotifications() follows on its side.
 */
export function NotificationBody({
  items,
  loading,
  error,
  locale,
  now,
  fresh,
  onOpen,
  emptyTitle,
  emptyHint,
  emptyAction,
  listLabel,
}: NotificationBodyProps): ReactElement {
  if (loading && items.length === 0) {
    return (
      <div className="notif-loading" role="status" aria-label={t('common.loading')}>
        <Skeleton height={44} count={4} />
      </div>
    )
  }

  if (error !== null && items.length === 0) {
    return (
      <EmptyState
        icon={<IconBell size={28} />}
        title={t('notif.errLoad')}
        description={t('notif.errLoadHint')}
        action={
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => void loadNotifications(true)}
          >
            {t('common.retry')}
          </button>
        }
      />
    )
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<IconBell size={28} />}
        title={emptyTitle}
        description={emptyHint}
        action={emptyAction}
      />
    )
  }

  return (
    <ul className="notif-list" aria-label={listLabel}>
      {items.map((item) => (
        <NotificationItem
          key={item.id}
          item={item}
          locale={locale}
          now={now}
          fresh={fresh.has(item.id)}
          onOpen={onOpen}
        />
      ))}
    </ul>
  )
}

/* ---------- shared actions ---------- */

/**
 * Mark everything read.
 *
 * The toast fires optimistically, matching the store's optimistic write. If the
 * server refuses, store/notifications restores the snapshot AND raises its own
 * error toast, which lands second and in the error tone — so the user sees the
 * correction rather than a silent rollback. The alternative would be waiting on
 * a promise that resolves `void` either way and reporting nothing at all.
 */
function markAll(): void {
  void markAllNotificationsRead()
  toast(t('notif.allRead'))
}

/**
 * A tap on a row: clear it, then open the entry.
 *
 * openEntry() rather than a route push, per store/entrySheet's header — the
 * detail surface is an overlay over whatever screen the user is on, and the
 * host is mounted at the app root. EntrySheet self-loads an entry that is not
 * in the working set, which is the normal case here: a notification names an
 * entry this client may never have fetched.
 */
export function openFromNotification(item: AppNotification): void {
  if (item.readAt === null) void markNotificationsRead([item.id])
  openEntry(item.entryId)
}

/* ---------- the bell ---------- */

/** How many rows the peek shows. The rest is one tap away at /notifications. */
const POPOVER_LIMIT = 8

const WIDE_QUERY = '(min-width: 768px)'

function subscribeWide(onChange: () => void): () => void {
  const mq = window.matchMedia(WIDE_QUERY)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

function readWide(): boolean {
  return window.matchMedia(WIDE_QUERY).matches
}

/** Same mechanism and breakpoint as components/sheet/Sheet.tsx. */
function useIsWide(): boolean {
  return useSyncExternalStore(subscribeWide, readWide, readWide)
}

/**
 * The header bell.
 *
 * Mounted once in the app shell, so everything expensive is gated: the minute
 * tick only runs while the inbox is open, and the popover's list is not
 * rendered at all while it is closed.
 */
export default function NotificationBell(): ReactElement {
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const items = useNotifications()
  const unread = useUnreadCount()
  const loading = useNotificationsLoading()
  const error = useNotificationsError()
  const fresh = useFreshIds(items)
  const now = useMinuteTick(open)
  const wide = useIsWide()

  const wrap = useRef<HTMLDivElement>(null)
  const bell = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const popId = useId()
  const headingId = useId()

  // The shell opens the realtime stream but never fetches. See the header.
  useEffect(() => {
    void loadNotifications()
  }, [])

  const close = useCallback((): void => setOpen(false), [])

  // Re-badge on arrival. The `key` is what makes the animation replay: a CSS
  // animation runs on mount, and changing the key remounts the span — a class
  // toggle would not restart an animation that is already declared on it.
  const [bump, setBump] = useState(0)
  const lastUnread = useRef(unread)
  useEffect(() => {
    if (unread > lastUnread.current) setBump((n) => n + 1)
    lastUnread.current = unread
  }, [unread])

  // Popover-only chrome: focus in, Escape out, dismiss on a click elsewhere.
  // The Sheet branch gets all three from Sheet itself.
  useEffect(() => {
    if (!open || !wide) return undefined
    // Focus the panel, not its first control — the same call Sheet makes, for
    // the same reason: the dialog's name should be announced before "mark all
    // as read" is.
    pop.current?.focus()

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && wrap.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)

    const release = pushOverlay(() => {
      setOpen(false)
      // Escape is a keyboard dismissal, so focus has to come back to the
      // control that opened this. A pointer dismissal deliberately does not
      // move focus — the user is already somewhere else.
      bell.current?.focus()
    })

    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      release()
    }
  }, [open, wide])

  const onOpenItem = useCallback((item: AppNotification): void => {
    openFromNotification(item)
    setOpen(false)
  }, [])

  const markAllButton = (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      disabled={unread === 0}
      onClick={markAll}
    >
      {t('notif.markAllRead')}
    </button>
  )

  const seeAll = (
    // THE RECORD IS A LENS NOW, NOT A PAGE. /notifications is deleted; the same
    // rows, grouped by day, are `MapChanges` inside the map's panel — so "See
    // all" is still two taps from the bell and lands on a surface that can also
    // act on what it shows.
    <NavLink
      to="/mindtree?lens=what-changed"
      className="btn btn-ghost btn-sm notif-seeall"
      onClick={() => {
        // The panel, because the URL may be the one we are already on — see
        // `openPanelForLens`. Without this the link is a no-op for exactly the
        // reader who is already looking at the map.
        openPanelForLens('what-changed')
        close()
      }}
    >
      {t('notif.seeAll')}
      {/* Forward through the hierarchy — forward is leftward in Arabic. */}
      <IconChevronEnd className="icon-directional" size={16} />
    </NavLink>
  )

  const body = (
    <NotificationBody
      items={items.slice(0, POPOVER_LIMIT)}
      loading={loading}
      error={error}
      locale={locale}
      now={now}
      fresh={fresh}
      onOpen={onOpenItem}
      emptyTitle={t('notif.empty')}
      emptyHint={t('notif.emptyHint')}
      listLabel={t('notif.list')}
    />
  )

  return (
    <div
      className="notif-wrap"
      ref={wrap}
      onBlur={(event) => {
        if (!open || !wide) return
        const next = event.relatedTarget
        // A null relatedTarget is a click on something unfocusable; the
        // pointerdown listener above owns that case. Closing here too would
        // shut the popover the instant a user clicked its own heading.
        if (next instanceof Node && !wrap.current?.contains(next)) setOpen(false)
      }}
    >
      <button
        type="button"
        ref={bell}
        className="btn btn-ghost btn-icon notif-bell"
        aria-label={t('notif.openInbox')}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open && wide ? popId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <IconBell size={20} />
        {unread > 0 && (
          <span key={bump} className="notif-badge" aria-hidden="true">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
        {/* Part of the button's accessible name: "Open notifications, 3 unread". */}
        {unread > 0 && <span className="sr-only">{t('notif.unread', { count: unread })}</span>}
      </button>

      {/* The arrival announcement. A live region rather than a toast, because a
          notification is not an interruption — it is a count that changed. */}
      <span className="sr-only" role="status">
        {unread > 0 ? t('notif.unread', { count: unread }) : ''}
      </span>

      {open &&
        (wide ? (
          <div
            className="notif-pop"
            id={popId}
            ref={pop}
            role="dialog"
            aria-labelledby={headingId}
            tabIndex={-1}
          >
            <div className="notif-head">
              <h2 className="notif-head-title" id={headingId}>
                {t('notif.title')}
              </h2>
              {markAllButton}
            </div>
            <div className="notif-scroll">{body}</div>
            <div className="notif-foot">{seeAll}</div>
          </div>
        ) : (
          <Sheet
            open
            onClose={close}
            presentation="bottom"
            title={t('notif.title')}
            actions={markAllButton}
            footer={seeAll}
          >
            {/* Full-bleed wrapper — see notifications.css. The rows carry their
                own inline padding, and Sheet's body padding on top of it would
                inset every divider from the sheet's edge. */}
            <div className="notif-sheet-body">{body}</div>
          </Sheet>
        ))}
    </div>
  )
}

/* ---------- the mobile "More" surface ---------- */

/**
 * The Settings-page row that reaches /notifications.
 *
 * On a phone the tab bar is full (five slots, capped) and the header bell opens
 * a sheet rather than a page, so Settings is the app's More surface and this is
 * the only durable entrance to the inbox history from it. Shipped as a
 * component rather than as a diff so the markup, the count and the RTL chevron
 * stay in the file that owns them — the integrator wraps it in Settings.tsx's
 * own <Section> and adds nothing else.
 */
export function NotificationsSettingsRow(): ReactElement {
  useLocale()
  const unread = useUnreadCount()
  return (
    // Same repoint as "See all" above, and this row matters more: it is the ONLY
    // way the inbox history is reachable on a phone, where the bell's popover is
    // a sheet the reader has to open first.
    <NavLink
      to="/mindtree?lens=what-changed"
      className="btn btn-ghost notif-settings-row"
      onClick={() => openPanelForLens('what-changed')}
    >
      <span>{t('notif.title')}</span>
      {unread > 0 && (
        <span className="pill info notif-settings-count">
          {t('notif.unread', { count: unread })}
        </span>
      )}
      <IconChevronEnd className="icon-directional" size={16} />
    </NavLink>
  )
}
