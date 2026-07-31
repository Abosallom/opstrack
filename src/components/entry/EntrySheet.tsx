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
// ── TWO PRESENTATIONS, ONE COMPONENT ──────────────────────────────────────
//
// `presentation='overlay'` (the default) wraps everything in
// components/sheet/Sheet: an inline-end panel at ≥768px, a bottom sheet below,
// with the focus trap, Escape and the scrim it owns. That is what openEntry()
// from a list produces, and it is right there because there IS a list behind it.
//
// `presentation='inline'` renders the SAME content with NO chrome of its own —
// no surface, no header, no close button — for a host that frames it. The only
// host is `src/pages/Entry.tsx`, the `/entry/:id` route: a deep link from a chat
// message or a notification has no list behind it, and a modal panel over an
// empty background is a dialog over nothing, with a close button that leads
// nowhere. So the route is a page, and this component supplies its body.
//
// The two modes share every class in the body — `.sheetx-section`,
// `.sheetx-meta`, `.sheetx-provenance` and friends. sheet.css calls those
// "generic groupings the sheet's children compose", and the page composes the
// same ones rather than cloning sixty lines of CSS under a second prefix. The
// page's own chrome is `.epg-*` in pages/entry-page.css, and nothing here emits
// one of those — which is what keeps the class registry (XP §1.0.7) honest in
// both directions.

import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
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
import { EmptyState, Skeleton } from '../shared'
import { IconArrowStart, IconChevronEnd, IconFile } from '../icons'
import { formatTimestamp } from '../../lib/dates'
import { t, useLocale } from '../../lib/i18n'
import { canEditEntry } from '../../lib/permissions'
import { useAuth } from '../../store/auth'
import { loadConfig, useTrackMap } from '../../store/config'
import {
  applyServerRow,
  loadEntries,
  loadUpdates,
  patchEntry,
  useEntry,
  useEntryFlash,
  useEntryHealth,
  usePendingOp,
} from '../../store/entries'
import { stepEntry, useSheetSiblings } from '../../store/entrySheet'
import { loadMembers, useMemberMap } from '../../store/members'
import { loadVocab } from '../../store/vocab'
// The one api/ call this component makes, and it exists because store/entries
// publishes no single-row read. See the probe below; the handoff note asks the
// integrator for `store/entries.loadEntry(id)` so this import can go.
import { getEntry } from '../../api/entries'
import type { EntryPatch } from '../../api/entries'
import type { Member } from '../../api/members'
import type { FlashMark } from '../../store/entries'
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
  /**
   * `'inline'` drops this component's own chrome for a host that supplies it.
   * See the header.
   */
  presentation?: 'overlay' | 'inline'
  /**
   * Overlay only: renders an "open full page" action that hands the entry's id
   * to a host that can push `/entry/:id`. Omitted, the action is absent —
   * a component cannot navigate, and a dead button is worse than none.
   */
  onOpenPage?: (id: string) => void
}

/**
 * The single-row read behind the deep-link probe, as a state machine.
 *
 * `id` is carried so a probe answered after the user stepped to the next entry
 * cannot be mistaken for an answer about THAT one — the whole surface swaps
 * entry under a request that is still in flight every time J/K is held down.
 */
interface Probe {
  id: string
  done: boolean
  /** An i18n KEY, per the ApiResult contract. Null on success. */
  error: string | null
}

/**
 * The "updated by ⟨name⟩" sentence.
 *
 * THE LIVE PROFILE WINS OVER THE SNAPSHOT, which is the resolution order
 * api/notifications.ts's header freezes: `profiles_update` lets a member rename
 * themselves, cause a change, and rename back, so a stored name can be made to
 * say anything while `actorId` stays durable. store/entries' FlashMark comment
 * sketches the opposite order, and the two agree in practice because realtime
 * only ever supplies an id — `actorName` is null on every mark this app
 * currently produces. Where they could disagree, the notifications contract is
 * the one with the forgery argument behind it, so it governs.
 *
 * Never invents a name: an actor nobody can resolve gets the actor-less
 * sentence, not "someone".
 */
export function flashSentence(mark: FlashMark, members: ReadonlyMap<string, Member>): string {
  const live = mark.actorId === null ? undefined : members.get(mark.actorId)?.displayName
  const name = (live ?? mark.actorName ?? '').trim()
  if (name === '') return t('entry.updatedGeneric')
  if (mark.kind === 'new') return t('entry.flashNew', { name })
  if (mark.kind === 'update') return t('entry.flashUpdate', { name })
  return t('entry.updatedBy', { name })
}

/**
 * The wait, shaped like the thing being waited for.
 *
 * A spinner in a 460px panel says "something is happening"; three blocks in the
 * proportions of a title, a meta row and a field list say "the entry is coming",
 * and the surface does not jump when it lands. `.sheetx-section` supplies the
 * rhythm so this stays five lines instead of a stylesheet.
 */
function DetailSkeleton(): ReactElement {
  return (
    <div role="status" aria-label={t('common.loading')}>
      <div className="sheetx-section">
        <Skeleton width="72%" height={22} />
        <Skeleton width="46%" height={14} />
      </div>
      <div className="sheetx-section">
        <Skeleton count={2} />
      </div>
      <div className="sheetx-section">
        <Skeleton count={5} height={16} />
      </div>
    </div>
  )
}

export default function EntrySheet({
  entryId,
  onClose,
  onNavigate,
  onOpenPage,
  presentation = 'overlay',
}: EntrySheetProps): ReactElement | null {
  const locale = useLocale()
  const entry = useEntry(entryId)
  const health = useEntryHealth(entryId)
  const pending = usePendingOp(entryId)
  const flash = useEntryFlash(entryId)
  const siblings = useSheetSiblings()
  const { profile } = useAuth()
  const trackMap = useTrackMap()
  const memberMap = useMemberMap()
  const [probe, setProbe] = useState<Probe | null>(null)
  // The in-flight guard is a ref rather than the state above so StrictMode's
  // double-invoked effect cannot fire two reads, and so a re-render caused by
  // anything else cannot fire a third.
  const probing = useRef<string | null>(null)

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

  // THE SINGLE-ROW PROBE, and it is not an optimisation.
  //
  // loadEntries() fetches OPEN entries only. A notification says "⟨name⟩
  // completed ⟨title⟩", the recipient taps it, and the entry it names is by
  // definition closed — so it is not in the working set, and without this the
  // designed not-found state would be shown for an entry that exists and is
  // three taps from the user's own inbox. It also decides the difference
  // between "not loaded yet" and "gone", which is the distinction the not-found
  // state has to be right about: reporting "deleted" for "still fetching" sends
  // someone looking for a culprit.
  //
  // It runs in parallel with the list fetch rather than after it, so a deep link
  // paints as soon as its one row lands instead of waiting for two thousand.
  useEffect(() => {
    if (entryId === null || entry !== undefined) return
    if (probing.current === entryId) return
    if (probe !== null && probe.id === entryId) return
    probing.current = entryId
    void getEntry(entryId)
      .then((result) => {
        if (result.ok && result.data !== null) applyServerRow(result.data, 'fetch')
        setProbe({ id: entryId, done: true, error: result.ok ? null : result.error })
      })
      .finally(() => {
        probing.current = null
      })
  }, [entryId, entry, probe])

  if (entryId === null) return null

  const inline = presentation === 'inline'

  const step = (dir: 1 | -1): void => {
    const target = dir === 1 ? siblings.next : siblings.prev
    if (target === null) return
    if (onNavigate) onNavigate(target)
    else stepEntry(dir)
  }

  const nav = (
    <>
      {onOpenPage && (
        <button
          type="button"
          className="btn btn-ghost btn-icon sheetx-navbtn"
          aria-label={t('entry.openFullPage')}
          title={t('entry.openFullPage')}
          onClick={() => onOpenPage(entryId)}
        >
          <IconFile size={18} />
        </button>
      )}
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

  /**
   * Inline mode is bare by contract, so the frame is either the Sheet or
   * nothing at all. Written once here rather than at each of the four returns
   * below — the states differ in content, never in chrome.
   */
  const frame = (node: ReactNode): ReactElement =>
    inline ? (
      <>{node}</>
    ) : (
      <Sheet open onClose={onClose} label={entry?.title ?? t('entry.details')} actions={nav}>
        {node}
      </Sheet>
    )

  if (!entry) {
    // Still fetching. The probe has not answered for THIS id yet, so nothing
    // can be said about whether the entry exists.
    if (probe === null || probe.id !== entryId || !probe.done) return frame(<DetailSkeleton />)

    // The read itself failed — offline, misconfigured, or RLS in a state that
    // returned an error rather than an empty set. That is not "deleted", and
    // the action is to try again rather than to walk away.
    if (probe.error !== null) {
      return frame(
        <EmptyState
          icon={<IconFile size={28} />}
          title={t('entry.errLoad')}
          description={t(probe.error)}
          action={
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setProbe(null)
                void loadEntries(true)
              }}
            >
              {t('common.retry')}
            </button>
          }
        />,
      )
    }

    // The row is genuinely not readable: deleted, or an id that never existed.
    return frame(
      <EmptyState
        icon={<IconFile size={28} />}
        title={t('entry.notFound')}
        description={t('entry.errNotFound')}
        action={
          <button type="button" className="btn btn-sm" onClick={onClose}>
            {t('common.back')}
          </button>
        }
      />,
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

  const changeStatus = (status: EntryStatus): void => {
    // The transition row is NOT written here. api/entries.updateEntry() appends
    // it inside the same call, after a pre-read that keeps a no-op change from
    // appending `blocked → blocked` to a thread nobody can clean up — writing a
    // second one from this component is how you get two rows per transition.
    //
    // What IS this component's job is making sure the open thread SHOWS it.
    // Realtime normally delivers the row (applyServerUpdate merges into any
    // loaded thread), but the channel can be down, and the audit trail arriving
    // only after a reload is exactly the silence this screen exists to prevent.
    // So: a forced re-read of the thread once the write settles. A read, not a
    // write — it cannot duplicate anything, and the id dedupe in the store
    // absorbs the race with the realtime echo.
    void patchEntry(entry.id, { status }).then((result) => {
      if (result.ok) void loadUpdates(entry.id, true)
    })
  }

  return frame(
    <>
      {/* R2-A11Y-4. THE REGION IS MOUNTED FOR THE LIFE OF THE SHEET AND ONLY ITS
          CONTENTS COME AND GO, which is the difference between an announcement
          and silence: assistive tech announces content inserted into an
          ALREADY-PRESENT live region, so a `{flash && <p aria-live>…</p>}` —
          region and sentence arriving in one commit — is the one case screen
          readers reliably swallow. toast.tsx:210 states the rule for the
          Toaster and Board.tsx:1655 follows it for the move announcer; this was
          the surface that did not, so a screen-reader user with an entry open
          was never told a colleague had changed it under them.

          The sentence sits in a KEYED span for the same reason Board's does: a
          second edit by the same person resolves to the same string, and
          re-keying it re-inserts the node so the region fires again instead of
          treating it as unchanged text. The key also puts the fade back where
          it belongs — on the sentence arriving, not on the sheet opening.

          Hidden when empty by `.sheetx-flash:empty` collapsing its own box, NOT
          by `display: none`, which would take the region out of the
          accessibility tree and rebuild this bug in CSS. */}
      <p className="sheetx-flash" aria-live="polite">
        {flash && (
          <span key={flash.at} className="sheetx-flash-text">
            {flashSentence(flash, memberMap)}
          </span>
        )}
      </p>

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
        {/* Two different facts, and conflating them costs the user a reload: a
            write in flight settles by itself, a queued one is waiting for the
            network and nothing will happen until it comes back. */}
        {pending && (
          <span className="pill">{pending.queued ? t('entry.queued') : t('entry.saving')}</span>
        )}
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
            onChange={changeStatus}
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
    </>,
  )
}
