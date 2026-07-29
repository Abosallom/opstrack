// EntryRow — one entry as a list line. Follow-ups, search results, the track
// timeline and the command palette's preview all render this.
//
// PRESENTATIONAL, BY CONTRACT (plan §2.5). This component does not read
// `store/entries`, does not mutate, and does not fetch. The list owner
// subscribes once and passes `entry`, `health`, `flash` and `pending` down.
// That is what keeps a single realtime patch from re-rendering sixty rows: if
// each row subscribed for itself, every board move would invalidate the whole
// screen. The atoms below DO subscribe — to vocab, tracks and members, which
// change about monthly — and that trade is spelled out in atoms.tsx's header.
//
// WHY THE TITLE IS THE BUTTON, and the row is not. The row needs one large
// click target AND two secondary actions. Making the row a clickable <div> puts
// a fake button in the accessibility tree and hand-rolls Enter/Space; nesting
// the action buttons inside a row-level <button> is invalid HTML. So the title
// is a real <button> whose ::after is stretched over the whole row, and the
// actions sit above it on the z-axis. Real button semantics, one hit area, no
// nested interactives, and the focus ring lands on something meaningful.
//
// PERMISSIONS ARE RESOLVED BEFORE THE AFFORDANCE RENDERS, never after the
// request fails. `canEdit === false` disables snooze and says why, because
// RLS-blocked patches come back as PGRST116 — zero rows — which reads to a user
// as "the app is broken" rather than "I am not allowed". See lib/permissions.ts.
// Posting an UPDATE is deliberately left enabled: appending to the immutable
// entry_updates thread is a different policy from patching the entry, and
// collapsing the two would silence a member who can still legitimately comment.

import type { ReactElement, ReactNode } from 'react'
import { t, useLocale } from '../../lib/i18n'
import type { Entry, EntryHealth } from '../../types'
import type { FlashMark, PendingOp } from '../../store/entries'
import { AgePill, DueLabel, HealthPill, OwnerBadge, PriorityDot, StatusPill, TagChip, TrackDot } from './atoms'
import './entry.css'

/** Which optional marks the row paints. Absent ⇒ shown; a screen opts OUT. */
export type EntryRowShow = Partial<
  Record<'track' | 'owner' | 'due' | 'age' | 'priority' | 'tags' | 'status', boolean>
>

export interface EntryRowProps {
  entry: Entry
  /** The server's row from `v_entry_health`, or the client mirror for an
   *  optimistic entry the view has never seen. Absent ⇒ no ageing marks. */
  health?: EntryHealth
  density?: 'comfortable' | 'compact'
  show?: EntryRowShow
  selected?: boolean
  flash?: FlashMark
  pending?: PendingOp
  canEdit?: boolean
  onOpen: (id: string) => void
  onAddUpdate?: (id: string) => void
  onSnooze?: (id: string) => void
  /** Screen-specific controls, appended after the built-in ones. */
  actions?: ReactNode
  /** For a roving-tabindex list: the row's focusable element takes this. */
  tabIndex?: number
}

/** Tags past this point become "+3" — a row is a scan target, not an inventory. */
const MAX_TAGS = 3

export default function EntryRow({
  entry,
  health,
  density = 'comfortable',
  show,
  selected = false,
  flash,
  pending,
  canEdit = true,
  onOpen,
  onAddUpdate,
  onSnooze,
  actions,
  tabIndex,
}: EntryRowProps): ReactElement {
  useLocale()

  const showTrack = show?.track ?? true
  const showOwner = show?.owner ?? true
  const showDue = show?.due ?? true
  const showAge = show?.age ?? true
  const showPriority = show?.priority ?? true
  const showTags = show?.tags ?? true
  const showStatus = show?.status ?? true

  const comfortable = density === 'comfortable'
  const tags = showTags ? entry.tags.slice(0, MAX_TAGS) : []
  const overflow = showTags ? entry.tags.length - tags.length : 0

  // Blocked is a different question from quiet: an item nobody has touched for
  // nine days because it is waiting on a vendor is not the same failure as one
  // nobody has picked up. The pill's accessible name says which.
  const ageReason = entry.status === 'blocked' || entry.status === 'waiting_on' ? 'blocked' : 'activity'

  return (
    <div
      // `is-flash` is the hook api/realtime.ts names in plan §2.14 — it fades
      // over 1.2s and is suppressed by global.css's prefers-reduced-motion
      // kill-switch, so nothing extra is needed here for that.
      className={`entry-row${flash ? ' is-flash' : ''}`}
      data-density={density}
      data-selected={selected ? 'true' : undefined}
      data-pending={pending ? 'true' : undefined}
      data-locked={canEdit ? undefined : 'true'}
    >
      {showTrack ? <TrackDot trackId={entry.track_id} variant="bar" /> : null}

      <div className="entry-row-main">
        <div className="entry-row-head">
          {showPriority ? <PriorityDot priority={entry.priority} /> : null}
          {/* .entry-title is global.css's typography primitive (§1.0.7 carve-out
              — entry.css must not restyle it); .entry-row-title adds only the
              truncation and the stretched hit area. */}
          <button
            type="button"
            className="entry-row-title entry-title"
            onClick={() => onOpen(entry.id)}
            aria-current={selected ? 'true' : undefined}
            tabIndex={tabIndex}
          >
            {entry.title}
          </button>
        </div>

        {/* description is `not null default ''`, so the test is for empty and
            never for null — a row with no description simply has no line. */}
        {comfortable && entry.description.trim() ? (
          <p className="entry-row-desc">{entry.description}</p>
        ) : null}

        <div className="entry-row-meta">
          {showStatus ? <StatusPill status={entry.status} /> : null}
          {showAge && health ? (
            <AgePill days={health.days_since_activity} health={health.health} reason={ageReason} />
          ) : null}
          {health && (health.health !== 'ok' || health.sla_breached) ? (
            <HealthPill
              health={health.health}
              daysOverdue={health.days_overdue}
              slaBreached={health.sla_breached}
            />
          ) : null}
          {showDue ? <DueLabel date={entry.due_date} kind="due" /> : null}
          {showDue ? <DueLabel date={entry.follow_up_date} kind="followUp" /> : null}
          {showOwner ? (
            <OwnerBadge ownerId={entry.owner_id} ownerName={entry.owner_name} showName />
          ) : null}
          {showTrack && comfortable ? (
            <TrackDot trackId={entry.track_id} variant="glyph" showLabel />
          ) : null}
        </div>

        {tags.length > 0 ? (
          <div className="entry-row-tags">
            {tags.map((tag) => (
              <TagChip key={tag} tag={tag} />
            ))}
            {/* Phrased as one key with {count} — there is no plural machinery in
                this app, and Arabic's six forms are not worth a runtime. */}
            {overflow > 0 ? <span className="entry-row-more">{t('entry.moreTags', { count: overflow })}</span> : null}
          </div>
        ) : null}

        {pending ? (
          <p className="entry-row-note" data-tone={pending.error ? 'danger' : 'muted'} role="status">
            {/* PendingOp.error is an i18n KEY, not a sentence — api/entries.ts
                maps every Postgres error through pgErrorKey() precisely so an
                untranslated English string never lands in an RTL layout. */}
            {pending.error ? t(pending.error) : pending.queued ? t('offline.queued') : t('entry.saving')}
          </p>
        ) : null}

        {flash ? (
          <p className="entry-row-note" data-tone="info">
            {flash.actorName ? t('entry.updatedBy', { name: flash.actorName }) : t('entry.updatedGeneric')}
          </p>
        ) : null}
      </div>

      {onAddUpdate || onSnooze || actions ? (
        <div className="entry-row-actions">
          {onAddUpdate ? (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => onAddUpdate(entry.id)}>
              {t('entry.addUpdate')}
            </button>
          ) : null}
          {onSnooze ? (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => onSnooze(entry.id)}
              disabled={!canEdit}
              title={canEdit ? undefined : t('entry.cannotEdit')}
            >
              {t('entry.snooze')}
            </button>
          ) : null}
          {actions}
        </div>
      ) : null}
    </div>
  )
}
