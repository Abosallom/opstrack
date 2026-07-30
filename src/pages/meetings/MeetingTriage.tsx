// /meetings/:id/triage — turn a meeting into work.
//
// ONE TABLE, ONE PASS, ONE COMMIT. The meeting is over and somebody is sitting
// with twenty lines they have to file before the next thing starts. Everything
// here is aimed at the number of decisions that takes:
//
//  · The parser already answered for every line at capture, so the dropdowns
//    open on a guess rather than on "choose one". Triage is confirmation, not
//    data entry.
//  · SAME AS ABOVE, per cell, because a meeting's lines come in runs — six in a
//    row belong to the same track and the same owner, and the sixth should be a
//    single tap. FILL DOWN, per column, is the same idea for the whole table:
//    one meeting, one track, done in one click.
//  · Every decision is one of three: create an entry, keep it as a note, or
//    discard it. All three KEEP THE LINE — 0004's `state` column exists so a
//    discarded line still reads in the minutes. Nothing here deletes anything,
//    and the footnote under the table says so, because "discard" is a word
//    people reasonably expect to destroy something.
//  · Native <select> in every cell, not the chip pickers. A chip group is right
//    in the entry sheet where there is room and the value is the point; in a
//    seven-column table it is four times the height, and a native select is
//    already keyboard-complete, already RTL-correct and already a 44px target
//    through the global `.input` rule. meetings.css compacts that to 40px for
//    the wide table, but only behind `(hover: hover) and (pointer: fine)` — a
//    touch pointer keeps the full 44.
//
// TRIAGE SURVIVES A RELOAD. Every dropdown writes through
// store/meetings.setLinePlan, which debounces into `meeting_lines.parsed` — the
// same column the parser seeded. There is no second place triage state lives,
// so there is nothing to lose and nothing to reconcile.
//
// TRIAGE IS OPEN TO THE ROOM; THE MEETING ROW IS NOT. `meeting_lines` update is
// `is_member()`, so every decision on this screen is everyone's to make. The
// meeting HEADER is creator-or-admin, which is exactly two controls here — the
// notes field and Resume — and both ask ./access.canEditMeeting() BEFORE they
// render. The notes field in particular used to eat what a non-creator typed:
// the optimistic rollback restored the stored value and the field followed it.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { ReactElement } from 'react'
import { EmptyState, LoadingSpinner } from '../../components/shared'
import { toast } from '../../components/toast'
import { IconArrowStart, IconChecklist, IconChevronEnd, IconMic } from '../../components/icons'
import { t, useLocale } from '../../lib/i18n'
import { useTrackLabel } from '../../lib/labels'
import { trackVars } from '../../lib/trackStyle'
import { useActiveTracks, useTrackMap } from '../../store/config'
import { openEntry } from '../../store/entrySheet'
import { loadMembers, useMembers } from '../../store/members'
import { useVocab } from '../../store/vocab'
import { decodePlan } from '../../api/meetings'
import {
  commitTriage,
  flushLinePlans,
  getMeetingsSnapshot,
  loadLines,
  resumeMeetingNow,
  saveMeetingNotes,
  setLinePlan,
  setLineState,
  startMeetingsRealtime,
  useCommitting,
  useLinePlan,
  useLinesError,
  useLinesLoading,
  useMeeting,
  useMeetingLines,
} from '../../store/meetings'
import type { LinePlan } from '../../api/meetings'
import { useAuth } from '../../store/auth'
import { canEditMeeting } from './access'
import type { EntryPriority, EntryType, MeetingLine, MeetingLineState, UserRole } from '../../types'
import './meetings.css'

/** The synthetic owner key for "somebody outside the workspace". Never stored. */
const OWNER_OTHER = ' other'
/** The synthetic owner key for "nobody yet". Never stored. */
const OWNER_NONE = ''

/** The columns a quick-fill can copy. The title is deliberately not one. */
type FillColumn = 'track' | 'type' | 'priority' | 'owner' | 'due'

/** Rendered order, used by both the header row and the fill-down toolbar. */
const FILL_COLUMNS: readonly FillColumn[] = ['track', 'type', 'priority', 'owner', 'due']

const FILL_LABEL: Readonly<Record<FillColumn, string>> = {
  track: 'meeting.colTrack',
  type: 'meeting.colType',
  priority: 'meeting.colPriority',
  owner: 'meeting.colOwner',
  due: 'meeting.colDue',
}

/**
 * The slice of a plan one column owns.
 *
 * Owner is a PAIR, always copied together: `owner_id` and `owner_name` are
 * mutually exclusive by CHECK constraint, so copying one without clearing the
 * other is how a row ends up displaying two owners.
 */
function columnOf(plan: LinePlan, column: FillColumn): Partial<LinePlan> {
  switch (column) {
    case 'track':
      return { trackId: plan.trackId }
    case 'type':
      return { type: plan.type }
    case 'priority':
      return { priority: plan.priority }
    case 'owner':
      return { ownerId: plan.ownerId, ownerName: plan.ownerName }
    case 'due':
      return { dueDate: plan.dueDate }
  }
}

/** A line still open to a decision. Committed lines have left the meeting. */
function isOpen(line: MeetingLine): boolean {
  return line.state !== 'committed'
}

/**
 * The plan a row is showing, read OUTSIDE React.
 *
 * `fillDown` and "same as above" both need another row's values from inside a
 * callback, where `useLinePlan` cannot be called. The store's decode is the
 * fallback so a line whose draft has not been seeded yet still copies correctly.
 */
function currentPlan(line: MeetingLine): LinePlan {
  return getMeetingsSnapshot().plans.get(line.id) ?? decodePlan(line.parsed, line.raw)
}

export default function MeetingTriage(): ReactElement {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  useLocale()

  const meeting = useMeeting(id)
  const lines = useMeetingLines(id)
  const loading = useLinesLoading(id)
  const linesError = useLinesError(id)
  const committing = useCommitting(id)

  // `meetings_update` is creator-or-admin (see ./access.ts). The LINES are open
  // to every member, so triage itself is not gated — only the two controls that
  // write the meeting row: the notes field and Resume.
  const { profile } = useAuth()
  const meId = profile?.id ?? null
  const role: UserRole = profile?.role ?? 'member'
  const canEditHeader = canEditMeeting(meeting, meId, role)

  const [settled, setSettled] = useState(false)
  const [notes, setNotes] = useState('')
  const [notesDirty, setNotesDirty] = useState(false)

  useEffect(() => {
    void loadMembers()
  }, [])

  useEffect(() => {
    if (!id) return
    setSettled(false)
    void loadLines(id).then(() => setSettled(true))
  }, [id])

  useEffect(() => startMeetingsRealtime(), [])

  // The notes field follows the row until the user starts typing into it — the
  // same rule the owner picker uses. After that it is theirs until they blur.
  useEffect(() => {
    if (!notesDirty) setNotes(meeting?.notes ?? '')
  }, [meeting?.notes, notesDirty])

  // Anything still resting on the plan debounce is written when this screen
  // goes away, so navigating out mid-triage is not a way to lose a decision.
  useEffect(
    () => () => {
      void flushLinePlans()
    },
    [],
  )

  const open = useMemo(() => lines.filter(isOpen), [lines])
  const pending = useMemo(() => lines.filter((l) => l.state === 'pending'), [lines])
  const committed = useMemo(() => lines.filter((l) => l.state === 'committed'), [lines])

  const handleCommit = useCallback(async (): Promise<void> => {
    const ids = pending.map((l) => l.id)
    if (ids.length === 0) {
      toast(t('meeting.commitEmpty'))
      return
    }
    const result = await commitTriage(id, ids)
    if (!result.ok) {
      toast(t(result.error), { tone: 'error' })
      return
    }
    const { created, failed } = result.data
    if (failed.length === 0) {
      toast(t('meeting.commitDone', { count: created.length }), { tone: 'success' })
      return
    }
    // Partial success is REPORTED, not hidden behind a generic error: nineteen
    // entries exist and the twentieth does not, and the person who has to fix
    // the twentieth needs to know which number is which.
    toast(t('meeting.commitPartial', { created: created.length, failed: failed.length }), {
      tone: 'error',
      duration: 0,
    })
  }, [id, pending])

  const handleNotesBlur = useCallback((): void => {
    if (!notesDirty) return
    setNotesDirty(false)
    if (notes === (meeting?.notes ?? '')) return
    void saveMeetingNotes(id, notes).then((result) => {
      if (result.ok) {
        toast(t('meeting.notesSaved'))
        return
      }
      toast(t(result.error), { tone: 'error' })
      // A NON-DESTRUCTIVE failure. The store has already rolled the row back to
      // the stored notes, and the effect above copies the store into this field
      // whenever the field is clean — so leaving `notesDirty` false here would
      // wipe what was just typed and leave a toast where the paragraph used to
      // be. Marking it dirty again pins the text in the box so it can at least
      // be copied out. (The read-only branch below means this should now be
      // unreachable through the notes field; it stays because a policy can
      // refuse a write for reasons the client cannot mirror.)
      setNotesDirty(true)
    })
  }, [id, meeting?.notes, notes, notesDirty])

  /** Copy the first open row's value for `column` into every open row below it. */
  const fillDown = useCallback(
    (column: FillColumn): void => {
      const [first, ...rest] = open
      if (!first || rest.length === 0) return
      const source = currentPlan(first)
      for (const line of rest) setLinePlan(line.id, columnOf(source, column))
      toast(t('meeting.fillDownDone', { column: t(FILL_LABEL[column]) }))
    },
    [open],
  )

  if (!meeting && !settled) return <LoadingSpinner />

  if (!meeting) {
    return (
      <div className="mt-page">
        <EmptyState
          icon={<IconMic size={30} />}
          title={t('meeting.notFound')}
          description={t('meeting.notFoundHint')}
          action={
            <button type="button" className="btn" onClick={() => navigate('/meetings')}>
              {t('meeting.backToMeetings')}
            </button>
          }
        />
      </div>
    )
  }

  const live = meeting.ended_at === null

  return (
    <div className="mt-page mt-triage">
      <header className="mt-live-head">
        {/* Back and forward on one line. The minutes link was added at
            integration — triage is where a meeting lands when it ends, so it is
            where somebody asks for the document, and /meetings/:id/minutes had
            no entrance anywhere in the app before this. */}
        <div className="mt-head-nav">
          <button
            type="button"
            className="btn btn-sm btn-ghost mt-back"
            onClick={() => navigate('/meetings')}
          >
            <IconArrowStart size={16} className="icon-directional" />
            {t('meeting.backToMeetings')}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost mt-head-minutes"
            onClick={() => navigate(`/meetings/${id}/minutes`)}
          >
            {t('route.minutes')}
            <IconChevronEnd size={16} className="icon-directional" />
          </button>
        </div>
        <div className="mt-live-title">
          <h1 className="page-title mt-live-name">{meeting.title}</h1>
          <span className={`pill mt-badge${live ? ' ok' : ''}`}>
            {live ? t('meeting.badgeLive') : t('meeting.badgeEnded')}
          </span>
        </div>
        <p className="mt-subtitle">{t('meeting.triageSubtitle')}</p>
      </header>

      {linesError && (
        // Two sentences, not one: the first says WHAT failed, which the raw
        // pgErrorKey never does, and the second says why. A bare
        // "Something went wrong" on a screen with four async reads is a message
        // nobody can act on.
        <p className="mt-error" role="alert">
          {t('meeting.loadLinesFailed')} {t(linesError)}{' '}
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => void loadLines(id, true)}
          >
            {t('common.retry')}
          </button>
        </p>
      )}

      {loading && lines.length === 0 ? (
        <LoadingSpinner />
      ) : lines.length === 0 ? (
        <EmptyState
          icon={<IconMic size={30} />}
          title={t('meeting.capturedNone')}
          description={t('meeting.capturedNoneHint')}
          action={
            <button type="button" className="btn" onClick={() => navigate(`/meetings/${id}`)}>
              {t('meeting.backToMeetings')}
            </button>
          }
        />
      ) : open.length === 0 ? (
        <EmptyState
          icon={<IconChecklist size={30} />}
          title={t('meeting.nothingToTriage')}
          description={t('meeting.nothingToTriageHint')}
          action={
            // Resume writes `meetings.ended_at`, so it is offered only to
            // whoever may write the row. Everyone else gets the exit that
            // always works rather than a button that snaps back.
            live || !canEditHeader ? (
              <button type="button" className="btn" onClick={() => navigate(`/meetings/${id}`)}>
                {t('meeting.backToMeetings')}
              </button>
            ) : (
              <button
                type="button"
                className="btn"
                onClick={() =>
                  void resumeMeetingNow(id).then((r) => {
                    if (r.ok) navigate(`/meetings/${id}`)
                    else toast(t(r.error), { tone: 'error' })
                  })
                }
              >
                {t('meeting.resume')}
              </button>
            )
          }
        />
      ) : (
        <>
          {/* Fill-down lives ABOVE the table, not inside its header cells. Under
              900px the header row is hidden — its labels move into each cell as
              a ::before — and a control clipped out of sight but left in the tab
              order is the worst of both worlds. Up here it is one toolbar that
              works identically at every width, which is also where a reader
              looks for "do this to the whole column". */}
          {open.length > 1 && (
            <div className="row-actions mt-fill-bar" role="group" aria-label={t('meeting.fillDown')}>
              <span className="mt-fill-label">{t('meeting.fillDown')}</span>
              {FILL_COLUMNS.map((column) => (
                <button
                  key={column}
                  type="button"
                  className="chip mt-fill"
                  onClick={() => fillDown(column)}
                  title={t('meeting.fillDownLabel', { column: t(FILL_LABEL[column]) })}
                >
                  {t(FILL_LABEL[column])}
                </button>
              ))}
            </div>
          )}

          {/* The horizontal scroll container is the table's own, never the
              page's: a body that scrolls sideways on a phone is the single most
              common way a responsive layout breaks. Under 900px the rows
              restack and this never engages. */}
          <div className="mt-table-wrap">
            <table className="mt-table">
              <caption className="sr-only">{t('meeting.triage')}</caption>
              <thead>
                <tr>
                  <th scope="col" className="mt-col-line">
                    {t('meeting.colLine')}
                  </th>
                  {FILL_COLUMNS.map((column) => (
                    <th scope="col" key={column} className={`mt-col-${column}`}>
                      {t(FILL_LABEL[column])}
                    </th>
                  ))}
                  <th scope="col" className="mt-col-decision">
                    {t('meeting.colDecision')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {open.map((line, index) => (
                  <TriageRow
                    key={line.id}
                    line={line}
                    previous={index > 0 ? open[index - 1] : undefined}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-footnote">{t('meeting.discardedKept')}</p>

          {/* Sticky, because the decision the bar performs is made at the bottom
              of a twenty-row table and scrolling back up to press it is the one
              friction this screen cannot afford. */}
          <div className="mt-commit-bar">
            <span className="mt-commit-count">{t('meeting.toTriage', { count: pending.length })}</span>
            <button
              type="button"
              className="btn btn-primary mt-commit-btn"
              onClick={() => void handleCommit()}
              disabled={committing || pending.length === 0}
            >
              {committing ? t('meeting.committing') : t('meeting.commit', { count: pending.length })}
            </button>
          </div>
        </>
      )}

      {committed.length > 0 && (
        <section className="mt-committed">
          <h2 className="section-title">{t('meeting.stateCommitted')}</h2>
          <ul className="mt-committed-list">
            {committed.map((line) => (
              <li key={line.id} className="mt-committed-row">
                <span className="mt-line-seq tabular" aria-hidden="true">
                  {line.seq}
                </span>
                <span className="mt-committed-text">{line.raw}</span>
                {line.entry_id && (
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => openEntry(line.entry_id as string)}
                  >
                    {t('meeting.openEntry')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* The notes belong to the meeting ROW, which RLS gives to its creator and
          to admins — so the answer is computed before the field renders rather
          than discovered on blur, and the reason is written under it instead of
          being left as a mystery. `readOnly`, not `disabled`: the text stays
          selectable, copyable and reachable by a screen reader, which is the
          whole point of showing it to somebody who cannot change it. */}
      <section className="mt-notes">
        <label className="field-label" htmlFor="mt-notes">
          {t('meeting.notesLabel')}
        </label>
        <textarea
          id="mt-notes"
          className="input mt-notes-input"
          value={notes}
          placeholder={canEditHeader ? t('meeting.notesPlaceholder') : ''}
          readOnly={!canEditHeader}
          aria-describedby={canEditHeader ? undefined : 'mt-notes-why'}
          title={canEditHeader ? undefined : t('meeting.errNotYours')}
          onChange={(e) => {
            setNotes(e.target.value)
            setNotesDirty(true)
          }}
          onBlur={handleNotesBlur}
        />
        {!canEditHeader && (
          <p className="mt-hint" id="mt-notes-why">
            {t('meeting.errNotYours')}
          </p>
        )}
      </section>
    </div>
  )
}

// ── one row ────────────────────────────────────────────────────────────────

interface TriageRowProps {
  line: MeetingLine
  /** The row above, for "same as above". Absent on the first row. */
  previous: MeetingLine | undefined
}

const DECISION: Readonly<Record<'pending' | 'note' | 'discarded', string>> = {
  pending: 'meeting.decisionCommit',
  note: 'meeting.decisionNote',
  discarded: 'meeting.decisionDiscard',
}

/**
 * One line's decisions, subscribing for ITSELF.
 *
 * `useLinePlan` is a hook and cannot be called in a loop, and a parent
 * subscribed to the whole plans map would re-render every row on every
 * keystroke in any row's title field.
 */
function TriageRow({ line, previous }: TriageRowProps): ReactElement {
  const plan = useLinePlan(line.id) ?? decodePlan(line.parsed, line.raw)
  const tracks = useActiveTracks()
  const trackMap = useTrackMap()
  const trackLabel = useTrackLabel()
  const members = useMembers()
  const types = useVocab('type')
  const priorities = useVocab('priority')

  const track = plan.trackId ? trackMap.get(plan.trackId) : undefined

  const set = useCallback(
    (patch: Partial<LinePlan>): void => {
      setLinePlan(line.id, patch)
    },
    [line.id],
  )

  const same = useCallback(
    (column: FillColumn): void => {
      if (!previous) return
      set(columnOf(currentPlan(previous), column))
    },
    [previous, set],
  )

  const decide = useCallback(
    (state: MeetingLineState): void => {
      void setLineState(line.id, state).then((result) => {
        if (!result.ok) toast(t(result.error), { tone: 'error' })
      })
    },
    [line.id],
  )

  const ownerValue = plan.ownerId ?? (plan.ownerName !== null ? OWNER_OTHER : OWNER_NONE)

  return (
    <tr
      className="mt-tr"
      data-state={line.state}
      style={track ? trackVars(track.color, track.color_light) : undefined}
    >
      <td className="mt-td mt-col-line" data-label={t('meeting.colLine')}>
        <div className="mt-cell-line">
          <span className="mt-line-seq tabular" aria-hidden="true">
            {line.seq}
          </span>
          <div className="mt-cell-line-body">
            <input
              className="input mt-title-input"
              type="text"
              value={plan.title}
              onChange={(e) => set({ title: e.target.value })}
              aria-label={t('meeting.rowTitleLabel', { seq: line.seq })}
              aria-invalid={plan.title.trim() === '' ? 'true' : undefined}
            />
            {/* The words as typed, whenever the parser consumed some of them
                into tokens. Without it the person triaging cannot tell whether
                "#network" became the track or just vanished. */}
            {line.raw.trim() !== plan.title.trim() && (
              <p className="mt-cell-raw" title={line.raw}>
                {line.raw}
              </p>
            )}
          </div>
        </div>
      </td>

      <TriageCell column="track" previous={previous} onSame={same}>
        <select
          className="select mt-cell-select"
          value={plan.trackId ?? ''}
          onChange={(e) => set({ trackId: e.target.value === '' ? null : e.target.value })}
          aria-label={t('meeting.colTrack')}
        >
          <option value="">{t('meeting.noTrack')}</option>
          {tracks.map((tr) => (
            <option key={tr.id} value={tr.id}>
              {trackLabel(tr)}
            </option>
          ))}
        </select>
      </TriageCell>

      <TriageCell column="type" previous={previous} onSame={same}>
        <select
          className="select mt-cell-select"
          value={plan.type}
          onChange={(e) => set({ type: e.target.value as EntryType })}
          aria-label={t('meeting.colType')}
        >
          {types.map((item) => (
            <option key={item.key} value={item.key}>
              {item.label}
            </option>
          ))}
        </select>
      </TriageCell>

      <TriageCell column="priority" previous={previous} onSame={same}>
        <select
          className="select mt-cell-select"
          value={plan.priority}
          onChange={(e) => set({ priority: e.target.value as EntryPriority })}
          aria-label={t('meeting.colPriority')}
        >
          {priorities.map((item) => (
            <option key={item.key} value={item.key}>
              {item.label}
            </option>
          ))}
        </select>
      </TriageCell>

      <TriageCell column="owner" previous={previous} onSame={same}>
        <select
          className="select mt-cell-select"
          value={ownerValue}
          onChange={(e) => {
            const next = e.target.value
            if (next === OWNER_NONE) set({ ownerId: null, ownerName: null })
            // Nothing is committed until a name is typed: choosing the option
            // only opens the field, exactly as OwnerPicker does.
            else if (next === OWNER_OTHER) set({ ownerId: null, ownerName: plan.ownerName ?? '' })
            else set({ ownerId: next, ownerName: null })
          }}
          aria-label={t('meeting.colOwner')}
        >
          <option value={OWNER_NONE}>{t('meeting.unassigned')}</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName}
            </option>
          ))}
          <option value={OWNER_OTHER}>{t('meeting.ownerExternal')}</option>
        </select>
        {ownerValue === OWNER_OTHER && (
          <input
            className="input mt-cell-owner-name"
            type="text"
            value={plan.ownerName ?? ''}
            onChange={(e) => set({ ownerName: e.target.value, ownerId: null })}
            placeholder={t('meeting.ownerNamePlaceholder')}
            aria-label={t('meeting.ownerExternal')}
          />
        )}
      </TriageCell>

      <TriageCell column="due" previous={previous} onSame={same}>
        <input
          className="input mt-cell-date"
          type="date"
          value={plan.dueDate ?? ''}
          onChange={(e) => set({ dueDate: e.target.value === '' ? null : e.target.value })}
          aria-label={t('meeting.colDue')}
        />
      </TriageCell>

      <td className="mt-td mt-col-decision" data-label={t('meeting.colDecision')}>
        <select
          className="select mt-cell-select mt-cell-decision"
          // `open` filters committed lines out, so this is always one of three.
          value={line.state === 'committed' ? 'pending' : line.state}
          onChange={(e) => decide(e.target.value as MeetingLineState)}
          aria-label={t('meeting.colDecision')}
        >
          {(['pending', 'note', 'discarded'] as const).map((state) => (
            <option key={state} value={state}>
              {t(DECISION[state])}
            </option>
          ))}
        </select>
      </td>
    </tr>
  )
}

interface TriageCellProps {
  column: FillColumn
  previous: MeetingLine | undefined
  onSame: (column: FillColumn) => void
  children: ReactElement | (ReactElement | false)[]
}

/**
 * A cell plus its "same as above" affordance.
 *
 * Visible on hover and on keyboard focus, and always visible on a coarse
 * pointer — there is no hover on a phone, and hiding the single control that
 * makes this screen fast behind a gesture that does not exist there would be
 * the worst possible place to save a few pixels. meetings.css does the rest.
 */
function TriageCell({ column, previous, onSame, children }: TriageCellProps): ReactElement {
  return (
    <td className={`mt-td mt-col-${column}`} data-label={t(FILL_LABEL[column])}>
      <div className="mt-cell">
        {children}
        {/* The arrow glyph is drawn by meetings.css, so this control has NO text
            content and its aria-label is the whole accessible name — the same
            reason capture's clear button draws its own cross. */}
        {previous && (
          <button
            type="button"
            className="mt-same"
            onClick={() => onSame(column)}
            title={t('meeting.sameAsAbove')}
            aria-label={t('meeting.sameAsAboveLabel', { column: t(FILL_LABEL[column]) })}
          />
        )}
      </div>
    </td>
  )
}
