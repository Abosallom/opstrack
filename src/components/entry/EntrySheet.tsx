// The entry detail surface: every field of one entry, editable in place, with
// its update thread underneath.
//
// EDIT IN PLACE, NOT IN A FORM. There is no Save button for the sheet as a
// whole and no draft of the entry: each control commits its own field the
// moment it changes, through store/entries, which applies it optimistically and
// rolls it back with a toast if the server says no. A form would mean holding
// eleven fields of local state that go stale the instant a realtime patch
// arrives from someone else's device — and this app's whole premise is that two
// people are looking at the same item.
//
// The two text fields are the exception and InlineText's header explains why: a
// text input passes through every prefix of what is being typed, and committing
// those would append a row to the audit thread per keystroke.
//
// PERMISSION IS COMPUTED BEFORE THE AFFORDANCE RENDERS. lib/permissions mirrors
// the shipped `entries_update` policy, so a user who cannot edit gets disabled
// controls and a sentence saying so, rather than a control that works, snaps
// back and toasts "something went wrong" — which is what an RLS-blocked UPDATE
// actually produces (zero rows → PGRST116).
//
// It renders NOTHING of its own chrome: the surface, the focus trap, Escape and
// the responsive panel/sheet switch all live in components/sheet/Sheet.tsx, so
// the meeting sheet and the filter sheet behave identically to this one.

import { useEffect, type ReactElement } from 'react'
import Sheet from '../sheet/Sheet'
import UpdateThread from './UpdateThread'
import { AgePill, HealthPill, TrackDot } from './atoms'
import { DateField, FieldRow, InlineText, LinksField, TagsField } from '../fields'
import {
  OwnerPicker,
  PriorityPicker,
  StatusPicker,
  TrackPicker,
  TypePicker,
} from '../pickers'
import { IconArrowStart, IconChevronEnd } from '../icons'
import { formatTimestamp } from '../../lib/dates'
import { t, useLocale } from '../../lib/i18n'
import { canEditEntry } from '../../lib/permissions'
import { useAuth } from '../../store/auth'
import { loadConfig, useTrackMap } from '../../store/config'
import {
  loadEntries,
  patchEntry,
  useEntriesLoading,
  useEntry,
  useEntryFlash,
  useEntryHealth,
  usePendingOp,
} from '../../store/entries'
import { stepEntry, useSheetSiblings } from '../../store/entrySheet'
import { loadMembers } from '../../store/members'
import { loadVocab } from '../../store/vocab'
import type { EntryPatch } from '../../api/entries'
import type { EntryPriority, EntryStatus, EntryType } from '../../types'

export interface EntrySheetProps {
  entryId: string | null
  onClose: () => void
  /**
   * Called instead of stepping the store when the host owns navigation — the
   * `/entry/:id` route pushes a URL so Back still works. Omit it and prev/next
   * move the shared store directly, which is what a board or a list wants.
   */
  onNavigate?: (id: string) => void
}

export default function EntrySheet({
  entryId,
  onClose,
  onNavigate,
}: EntrySheetProps): ReactElement | null {
  const locale = useLocale()
  const entry = useEntry(entryId)
  const health = useEntryHealth(entryId)
  const pending = usePendingOp(entryId)
  const flash = useEntryFlash(entryId)
  const loading = useEntriesLoading()
  const siblings = useSheetSiblings()
  const { profile } = useAuth()
  const trackMap = useTrackMap()

  // Self-sufficient on a deep link. Every one of these is deduped and returns
  // immediately when its data is fresh, so the common case — the sheet opened
  // from a list that already loaded everything — costs four early returns. The
  // uncommon case is someone opening /entry/:id from a chat message, and a
  // panel with no track names, no member list and no status labels is not a
  // panel.
  useEffect(() => {
    if (entryId === null) return
    void loadEntries()
    void loadConfig()
    void loadVocab()
    void loadMembers()
  }, [entryId])

  if (entryId === null) return null

  const step = (dir: 1 | -1): void => {
    const target = dir === 1 ? siblings.next : siblings.prev
    if (target === null) return
    if (onNavigate) onNavigate(target)
    else stepEntry(dir)
  }

  const nav = (
    <>
      <button
        type="button"
        className="btn btn-ghost btn-icon sheetx-navbtn"
        aria-label={t('entry.prev')}
        // aria-disabled, not disabled: at the ends of a list the button stays
        // focusable and announced, so a keyboard user is told there is no
        // previous item rather than finding the control has vanished.
        aria-disabled={siblings.prev === null || undefined}
        onClick={() => step(-1)}
      >
        <IconArrowStart size={18} className="icon-directional" />
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-icon sheetx-navbtn"
        aria-label={t('entry.next')}
        aria-disabled={siblings.next === null || undefined}
        onClick={() => step(1)}
      >
        <IconChevronEnd size={18} className="icon-directional" />
      </button>
    </>
  )

  // Not loaded yet, or gone. The two are genuinely different answers and
  // reporting "deleted" for "still fetching" would send someone looking for a
  // culprit.
  if (!entry) {
    return (
      <Sheet open onClose={onClose} label={t('entry.details')} actions={nav}>
        <p className="muted">{loading ? t('common.loading') : t('entry.errNotFound')}</p>
      </Sheet>
    )
  }

  const canEdit = canEditEntry(entry, profile?.id ?? null, profile?.role ?? 'member')
  const readOnly = !canEdit
  const track = entry.track_id === null ? undefined : trackMap.get(entry.track_id)

  const patch = (fields: EntryPatch): void => {
    // Fire and forget: store/entries applies the change optimistically, settles
    // it against the server row, and toasts + rolls back on failure. Awaiting
    // here would add a second error path that disagrees with that one.
    void patchEntry(entry.id, fields)
  }

  return (
    <Sheet open onClose={onClose} label={entry.title} actions={nav}>
      {flash && (
        <p className="sheetx-flash" aria-live="polite">
          {flash.actorName
            ? t('entry.updatedBy', { name: flash.actorName })
            : t('entry.updatedGeneric')}
        </p>
      )}

      <h2 className="sheetx-heading">
        <InlineText
          label={t('entry.title')}
          value={entry.title}
          emptyLabel={t('entry.titlePlaceholder')}
          placeholder={t('entry.titlePlaceholder')}
          canEdit={canEdit}
          maxLength={200}
          onCommit={(title) => {
            // An empty title is refused rather than saved: the row would become
            // unfindable in every list in the app, and the DB's own CHECK
            // rejects it anyway — this just avoids the round trip.
            if (title !== '') patch({ title })
          }}
        />
      </h2>

      <div className="sheetx-meta">
        {track && <TrackDot trackId={entry.track_id} variant="chip" showLabel />}
        {health && (
          <HealthPill
            health={health.health}
            daysOverdue={health.days_overdue}
            slaBreached={health.sla_breached}
          />
        )}
        {health && <AgePill days={health.days_since_activity} health={health.health} />}
        {pending && <span className="pill">{t('entry.saving')}</span>}
        {readOnly && <span className="pill">{t('entry.readOnly')}</span>}
      </div>

      {readOnly && <p className="sheetx-note">{t('entry.cannotEdit')}</p>}

      <section className="sheetx-section">
        <h3 className="sheetx-section-title">{t('entry.description')}</h3>
        <InlineText
          label={t('entry.description')}
          value={entry.description}
          emptyLabel={t('entry.descriptionEmpty')}
          placeholder={t('entry.descriptionPlaceholder')}
          canEdit={canEdit}
          multiline
          onCommit={(description) => patch({ description })}
        />
      </section>

      <section className="sheetx-section">
        <h3 className="sheetx-section-title">{t('entry.details')}</h3>

        <FieldRow label={t('entry.status')}>
          <StatusPicker
            label={t('entry.changeStatus')}
            value={entry.status}
            disabled={readOnly}
            onChange={(status: EntryStatus) => patch({ status })}
          />
        </FieldRow>

        <FieldRow label={t('entry.priority')}>
          <PriorityPicker
            label={t('entry.changePriority')}
            value={entry.priority}
            disabled={readOnly}
            onChange={(priority: EntryPriority) => patch({ priority })}
          />
        </FieldRow>

        <FieldRow label={t('entry.type')}>
          <TypePicker
            label={t('entry.changeType')}
            value={entry.type}
            disabled={readOnly}
            onChange={(type: EntryType) => patch({ type })}
          />
        </FieldRow>

        <FieldRow label={t('entry.track')}>
          <TrackPicker
            label={t('entry.pickTrack')}
            value={entry.track_id}
            clearLabel={t('entry.noTrack')}
            disabled={readOnly}
            onChange={(trackId) => patch({ trackId })}
          />
        </FieldRow>

        <FieldRow label={t('entry.owner')} stacked>
          <OwnerPicker
            label={t('entry.pickOwner')}
            value={{ ownerId: entry.owner_id, ownerName: entry.owner_name }}
            unassignedLabel={t('entry.unassigned')}
            otherLabel={t('entry.ownerExternal')}
            disabled={readOnly}
            // Both halves, always: owner_id and owner_name are mutually
            // exclusive columns, and sending only the one that changed leaves
            // the optimistic row showing two owners until the server answers.
            onChange={(owner) => patch({ ownerId: owner.ownerId, ownerName: owner.ownerName })}
          />
        </FieldRow>

        <FieldRow label={t('entry.requester')}>
          <InlineText
            label={t('entry.requester')}
            value={entry.requester ?? ''}
            emptyLabel={t('entry.requesterPlaceholder')}
            placeholder={t('entry.requesterPlaceholder')}
            canEdit={canEdit}
            onCommit={(requester) => patch({ requester: requester === '' ? null : requester })}
          />
        </FieldRow>

        <FieldRow label={t('entry.due')}>
          <DateField
            label={t('entry.due')}
            value={entry.due_date}
            disabled={readOnly}
            clearLabel={t('entry.clearDue')}
            quickSet
            onChange={(dueDate) => patch({ dueDate })}
          />
        </FieldRow>

        <FieldRow label={t('entry.followUp')}>
          <DateField
            label={t('entry.followUp')}
            value={entry.follow_up_date}
            disabled={readOnly}
            clearLabel={t('entry.clearFollowUp')}
            quickSet
            onChange={(followUpDate) => patch({ followUpDate })}
          />
        </FieldRow>
      </section>

      <section className="sheetx-section">
        <h3 className="sheetx-section-title">{t('entry.tags')}</h3>
        <TagsField
          label={t('entry.tags')}
          value={entry.tags}
          addLabel={t('entry.addTag')}
          placeholder={t('entry.tagPlaceholder')}
          removeLabel={(name) => t('entry.removeTag', { name })}
          suggestionsLabel={t('entry.suggestedTags')}
          // Per-track suggestions, from `tracks.suggested_tags`. Nothing in the
          // codebase names a track: a seventh track proposes its own tags with
          // no code change.
          suggestions={track?.suggested_tags}
          disabled={readOnly}
          onChange={(tags) => patch({ tags })}
        />
      </section>

      <section className="sheetx-section">
        <h3 className="sheetx-section-title">{t('entry.links')}</h3>
        <LinksField
          label={t('entry.links')}
          value={entry.links}
          addLabel={t('entry.addLink')}
          labelPlaceholder={t('entry.linkLabel')}
          urlPlaceholder={t('entry.linkUrlPlaceholder')}
          removeLabel={() => t('entry.removeLink')}
          errorLabel={t('entry.errLinkUrl')}
          disabled={readOnly}
          onChange={(links) => patch({ links })}
        />
      </section>

      <section className="sheetx-section">
        <h3 className="sheetx-section-title">{t('entry.activity')}</h3>
        <UpdateThread entryId={entry.id} readOnly={readOnly} />
      </section>

      {/* Provenance last. It is what people check once, when something looks
          wrong, and it would otherwise push the thread below the fold. */}
      <p className="sheetx-provenance">
        {t('entry.created', { date: formatTimestamp(entry.created_at, locale) })}
        {' · '}
        {t('entry.lastActivity', { date: formatTimestamp(entry.last_activity_at, locale) })}
        {entry.closed_at !== null && (
          <>
            {' · '}
            {t('entry.closedOn', { date: formatTimestamp(entry.closed_at, locale) })}
          </>
        )}
      </p>
    </Sheet>
  )
}
