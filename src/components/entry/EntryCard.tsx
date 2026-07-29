// EntryCard — one entry as a board card. The kanban's unit, and nothing else's.
//
// PRESENTATIONAL, same contract as EntryRow: no `store/entries`, no mutation,
// no fetch. The column owns the subscription and hands each card its `entry`.
//
// NO StatusPill IN THE BODY. On a board the COLUMN is the status, so painting
// it again on the card is noise — the pill appears once, in the footer, as the
// control that CHANGES it.
//
// THE KEYBOARD PATH IS NOT AN ALTERNATIVE, IT IS THE PRIMARY ONE. `onMove` is
// required by the contract, and it is wired to an editable StatusPill — a
// native <select> — on every card, always. Drag is the enhancement layered on
// top through `dragHandleProps`. Doing it the other way round produces the
// board every accessibility audit fails: a screen that only works if you can
// see it and hold a pointer steady. Reusing StatusPill rather than hand-rolling
// a menu also means the move list inherits the admin's own status labels and
// the "a hidden option must not hide data that already holds it" rule for free.
//
// A CARD THE USER CANNOT MOVE IS NOT DRAGGABLE. `canEdit === false` withholds
// `dragHandleProps` entirely and disables the select, so no request is ever
// sent. The alternative — letting the drag succeed and snap back on an
// RLS-blocked patch — surfaces as PGRST116, "zero rows", which reads as a
// broken app rather than a permission. See lib/permissions.ts's header.

import type { HTMLAttributes, ReactElement } from 'react'
import { t, useLocale } from '../../lib/i18n'
import type { Entry, EntryHealth, EntryStatus } from '../../types'
import type { FlashMark, PendingOp } from '../../store/entries'
import { AgePill, DueLabel, HealthPill, OwnerBadge, PriorityDot, StatusPill, TagChip, TrackDot } from './atoms'
import './entry.css'

export interface EntryCardProps {
  entry: Entry
  health?: EntryHealth
  flash?: FlashMark
  pending?: PendingOp
  dragging?: boolean
  canEdit?: boolean
  onOpen: (id: string) => void
  /** The ACCESSIBLE non-drag path — required, and always rendered. */
  onMove: (id: string, status: EntryStatus) => void
  /**
   * Pointer handlers from W2-BOARD's `lib/dnd.ts`, spread on the card ROOT
   * rather than on a separate grip: a 44px grip costs a quarter of a 300px
   * column, and a threshold-based pointer drag on the whole card is what people
   * expect from a kanban. Spread FIRST so the card's own structural attributes
   * cannot be clobbered by a caller.
   */
  dragHandleProps?: HTMLAttributes<HTMLElement>
}

/** A card is narrower than a row, so it shows fewer tags before folding. */
const MAX_TAGS = 2

export default function EntryCard({
  entry,
  health,
  flash,
  pending,
  dragging = false,
  canEdit = true,
  onOpen,
  onMove,
  dragHandleProps,
}: EntryCardProps): ReactElement {
  useLocale()

  const tags = entry.tags.slice(0, MAX_TAGS)
  const overflow = entry.tags.length - tags.length
  const ageReason = entry.status === 'blocked' || entry.status === 'waiting_on' ? 'blocked' : 'activity'

  return (
    <article
      {...(canEdit ? dragHandleProps : undefined)}
      // `is-flash` is the class api/realtime.ts names in plan §2.14; the fade is
      // in entry.css and global.css's prefers-reduced-motion kill-switch
      // already neutralises it.
      className={`entry-card${flash ? ' is-flash' : ''}`}
      data-dragging={dragging ? 'true' : undefined}
      data-pending={pending ? 'true' : undefined}
      data-locked={canEdit ? undefined : 'true'}
    >
      <div className="entry-card-head">
        <TrackDot trackId={entry.track_id} variant="glyph" showLabel />
        <PriorityDot priority={entry.priority} />
      </div>

      {/* .entry-title supplies the typography primitive from global.css
          (§1.0.7 carve-out); .entry-card-title adds the clamp and stretches its
          ::after over the card so the whole card opens on a click that did not
          become a drag. */}
      <button
        type="button"
        className="entry-card-title entry-title"
        onClick={() => onOpen(entry.id)}
      >
        {entry.title}
      </button>

      <div className="entry-card-meta">
        {health && (health.health !== 'ok' || health.sla_breached) ? (
          <HealthPill
            health={health.health}
            daysOverdue={health.days_overdue}
            slaBreached={health.sla_breached}
          />
        ) : null}
        {health ? (
          <AgePill days={health.days_since_activity} health={health.health} reason={ageReason} />
        ) : null}
        <DueLabel date={entry.due_date} kind="due" />
      </div>

      {tags.length > 0 ? (
        <div className="entry-card-tags">
          {tags.map((tag) => (
            <TagChip key={tag} tag={tag} />
          ))}
          {overflow > 0 ? (
            <span className="entry-card-more">{t('entry.moreTags', { count: overflow })}</span>
          ) : null}
        </div>
      ) : null}

      {pending ? (
        <p className="entry-card-note" data-tone={pending.error ? 'danger' : 'muted'} role="status">
          {/* An i18n KEY, never a Postgres sentence — see EntryRow's note. */}
          {pending.error ? t(pending.error) : pending.queued ? t('offline.queued') : t('entry.saving')}
        </p>
      ) : null}

      {flash ? (
        <p className="entry-card-note" data-tone="info">
          {flash.actorName ? t('entry.updatedBy', { name: flash.actorName }) : t('entry.updatedGeneric')}
        </p>
      ) : null}

      <div className="entry-card-foot">
        {/* Avatar only: a 300px column has no room for a name, and the disc
            carries the full name on its aria-label and its tooltip. */}
        <OwnerBadge ownerId={entry.owner_id} ownerName={entry.owner_name} showName={false} />
        <StatusPill
          status={entry.status}
          size="sm"
          disabled={!canEdit}
          onChange={(next) => onMove(entry.id, next)}
        />
        {canEdit ? null : (
          // A disabled control with no explanation is the thing this whole
          // module exists to avoid. The reason is text, not a tooltip alone.
          <span className="entry-card-note" data-tone="muted">
            {t('entry.cannotEdit')}
          </span>
        )}
      </div>
    </article>
  )
}
