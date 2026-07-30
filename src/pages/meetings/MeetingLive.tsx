// /meetings/:id — the live capture screen.
//
// THE WHOLE SCREEN IS ONE PROMISE: type a line, press Enter, keep listening.
// Nothing on it competes with the input, and every decision below follows from
// that:
//
//  · The input is focused on mount and REFOCUSED after every action. A capture
//    box you have to tap first is a capture box that loses the sentence.
//  · The box clears BEFORE the await, never after. The optimistic line is in the
//    store synchronously, so the next thing somebody says is never waiting on a
//    network round trip.
//  · THERE ARE NO CHIPS, no parse preview, no pickers. Capture's chip strip is
//    right for a screen where you are composing one careful item; here you are
//    transcribing a room, and anything that invites you to look down is a line
//    you did not hear. The parser still runs on every line — its answer is
//    stored in `meeting_lines.parsed` and becomes the triage table's starting
//    position. It is simply not shown yet.
//  · Lines render NEWEST FIRST, directly under the input. That is the opposite
//    of how the minutes read and the right way round for typing: the line you
//    just wrote is the one you might need to fix, and on a phone it has to be
//    above the fold without scrolling.
//  · Nothing is deleted, ever. A line you did not mean is DISCARDED, which keeps
//    it in the record and out of triage — spec §6 and 0004's `state` column.
//
// PERSISTENCE IS PER LINE, not per meeting. store/meetings.appendMeetingLine
// writes each line as it is typed; killing the tab mid-meeting and reloading
// loses nothing. That is the acceptance gate's second clause and it is the
// reason the meeting_lines table exists at all.
//
// EVERYONE CAPTURES; ONLY THE CREATOR CLOSES. `meeting_lines` insert/update are
// `is_member()` — the whole room can type, fix and re-state lines. The meeting
// ROW is creator-or-admin, so End and Resume ask ./access.canEditMeeting()
// before they render. They used to be shown to every attendee, which meant a
// confirmation dialog, an optimistic close and then a rollback: the exact
// sequence lib/permissions.ts's header was written to forbid.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { FormEvent, KeyboardEvent, ReactElement } from 'react'
import { confirm } from '../../components/Confirm'
import { EmptyState, LoadingSpinner } from '../../components/shared'
import { toast } from '../../components/toast'
import { IconArrowStart, IconFile, IconMic } from '../../components/icons'
import type { ParseContext, ParseMember, ParseTrack } from '../../lib/capture/parse'
import { t, useLocale } from '../../lib/i18n'
import { truncate } from '../../lib/text'
import { useAuth } from '../../store/auth'
import { useActiveTracks } from '../../store/config'
import { loadMembers, useMembers } from '../../store/members'
import { getVocabSnapshot, useVocabAll } from '../../store/vocab'
import type { VocabItem } from '../../store/vocab'
import {
  appendMeetingLine,
  editLine,
  endMeetingNow,
  loadLines,
  resumeMeetingNow,
  setLineState,
  startMeetingsRealtime,
  useLineSaving,
  useLinesError,
  useLinesLoading,
  useMeeting,
  useMeetingLines,
} from '../../store/meetings'
import { canEditMeeting } from './access'
import type { MeetingLine, UserRole, VocabKind, VocabRow } from '../../types'
import './meetings.css'

/** Debounce before the screen-reader region announces the line count. */
const ANNOUNCE_MS = 700

/**
 * The admin's renamed vocabulary labels, in BOTH languages, so `!عاجل جدا`
 * resolves the moment someone calls `critical` that — copied in spirit from
 * Capture.tsx because the parser takes its aliases as data and neither screen
 * may reach into store/vocab from lib/.
 *
 * Only NON-EMPTY labels become aliases: `vocab_options.label` is
 * `not null default ''` and an empty string means "no override", so feeding the
 * blanks in would map every key to '' and swallow the parser's own table.
 */
function aliasesFor(
  items: readonly VocabItem[],
  rows: readonly VocabRow[],
  kind: VocabKind,
): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const item of items) {
    const row = rows.find((r) => r.kind === kind && r.key === item.key)
    const words = [row?.label ?? '', row?.label_ar ?? ''].filter((w) => w.trim() !== '')
    if (words.length > 0) out[item.key] = words
  }
  return out
}

/**
 * The parse context every line is read against.
 *
 * A hook rather than a value because `now` must be fresh per call: a context
 * memoised for the life of the screen would resolve `due:tomorrow` against the
 * hour the meeting started, which for a two-hour meeting crossing midnight is
 * simply wrong.
 */
function useParseContext(): () => ParseContext {
  const locale = useLocale()
  const tracks = useActiveTracks()
  const members = useMembers()
  const priorityItems = useVocabAll('priority')
  const typeItems = useVocabAll('type')

  const parseTracks = useMemo<ParseTrack[]>(
    () => tracks.map((tr) => ({ id: tr.id, name: tr.name, nameAr: tr.name_ar })),
    [tracks],
  )
  // Same list Capture.tsx builds, and `username` matters here for the same
  // reason: a line typed in a meeting as `@zz.smoke.v100` has to assign.
  const parseMembers = useMemo<ParseMember[]>(
    () => members.map((m) => ({ id: m.id, displayName: m.displayName, username: m.username })),
    [members],
  )
  const vocabAliases = useMemo(() => {
    const rows = getVocabSnapshot().rows
    return {
      priority: aliasesFor(priorityItems, rows, 'priority'),
      type: aliasesFor(typeItems, rows, 'type'),
    }
  }, [priorityItems, typeItems])

  return useCallback(
    () => ({
      tracks: parseTracks,
      members: parseMembers,
      now: new Date(),
      locale,
      vocabAliases,
    }),
    [parseTracks, parseMembers, locale, vocabAliases],
  )
}

export default function MeetingLive(): ReactElement {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const locale = useLocale()

  const meeting = useMeeting(id)
  const lines = useMeetingLines(id)
  const loading = useLinesLoading(id)
  const linesError = useLinesError(id)
  const makeCtx = useParseContext()

  // Capture is the room's; closing the meeting is the creator's. See ./access.
  const { profile } = useAuth()
  const meId = profile?.id ?? null
  const role: UserRole = profile?.role ?? 'member'
  const canEndMeeting = canEditMeeting(meeting, meId, role)

  const [text, setText] = useState('')
  const [ending, setEnding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [announce, setAnnounce] = useState('')
  /** True once the first load has come back, so "not found" is a fact. */
  const [settled, setSettled] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  /**
   * What is in the box RIGHT NOW, readable after an await. `handleSubmit`'s
   * closure holds the line as it was when Enter was pressed — correct for the
   * payload, exactly wrong for deciding whether it is safe to write to the box
   * afterwards.
   */
  const textRef = useRef(text)
  useEffect(() => {
    textRef.current = text
  }, [text])

  useEffect(() => {
    void loadMembers()
  }, [])

  useEffect(() => {
    if (!id) return
    setSettled(false)
    void loadLines(id).then(() => setSettled(true))
  }, [id])

  // A handler, not a socket: api/realtime.ts owns the one connection and fans
  // batches out, so this is what makes a second attendee's lines appear here
  // without either tab knowing about the other.
  useEffect(() => startMeetingsRealtime(), [])

  const focusInput = useCallback((): void => {
    inputRef.current?.focus()
  }, [])

  const live = meeting !== undefined && meeting.ended_at === null

  // Focus on arrival, and again whenever the meeting reopens. Both mean "I want
  // to type"; a ref rather than autoFocus, which fires only on first mount.
  useEffect(() => {
    if (live) inputRef.current?.focus()
  }, [live])

  const pendingCount = useMemo(() => lines.filter((l) => l.state === 'pending').length, [lines])

  // Announced on a debounce and as a COUNT rather than the text: a live region
  // that fires per line reads the whole meeting back while the next sentence is
  // being typed, which makes the screen unusable with a screen reader running.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setAnnounce(lines.length === 0 ? '' : t('meeting.announceLine', { count: lines.length }))
    }, ANNOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [lines.length, locale])

  /**
   * THERE IS NO `busy` FLAG, and that is deliberate.
   *
   * A single in-flight boolean would have to either disable the input or drop
   * the next Enter while the previous line is still on the wire — and on a slow
   * connection that is exactly when somebody is typing fastest. Concurrent
   * appends are safe by construction: each mints its own uuid, and the seq is
   * read from the store AFTER the previous optimistic line has been applied
   * synchronously, so two lines a half-second apart get n and n+1 with no race
   * to lose. A seq that does collide anyway is retried inside api/meetings.
   */
  const append = useCallback(
    async (raw: string, asNote: boolean): Promise<void> => {
      const kept = raw
      // BEFORE the await, always: the optimistic line is applied synchronously
      // inside appendMeetingLine, so by the time this resolves it is already on
      // screen. Clearing afterwards would put a round trip in front of the next
      // thing anybody says.
      setText('')
      setError(null)
      focusInput()

      const result = await appendMeetingLine(id, kept, makeCtx(), asNote ? 'note' : 'pending')

      if (result.ok) return

      // The one thing this screen may never do is eat a sentence. Put the words
      // back — but ONLY if the box is still empty, because on a slow connection
      // the next line is often already half-typed, and pasting over it would
      // lose a sentence to the screen whose whole promise is that it does not.
      if (textRef.current === '') {
        setText(kept)
        setError('meeting.errAppend')
        focusInput()
        return
      }
      // The box has moved on. The inline notice would now be pointing at a line
      // that is fine, and `aria-invalid` would be describing the wrong text — so
      // the failure goes to a sticky toast that QUOTES the lost words, which is
      // the only place they still exist.
      toast(t('meeting.errAppendHeld', { line: truncate(kept, 60) }), {
        tone: 'error',
        duration: 0,
      })
      focusInput()
    },
    [focusInput, id, makeCtx],
  )

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault()
      const raw = text.trim()
      // An empty box is not an error. It is somebody pressing Enter to check
      // that the keyboard still has focus.
      if (raw === '') return
      void append(raw, false)
    },
    [append, text],
  )

  /**
   * Enter files the line for triage; Shift + Enter files it as a note; Esc
   * clears the box.
   *
   * The note modifier is a keystroke rather than a toggle button on purpose:
   * "that was just context" is a decision made in the half-second after typing,
   * and a control you have to aim at costs more attention than the distinction
   * is worth mid-meeting. An <input> ignores Shift+Enter natively, so the
   * combination was free.
   */
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setText('')
        setError(null)
        return
      }
      if (event.key !== 'Enter' || !event.shiftKey) return
      event.preventDefault()
      const raw = text.trim()
      if (raw === '') return
      void append(raw, true)
    },
    [append, text],
  )

  const handleEnd = useCallback(async (): Promise<void> => {
    const ok = await confirm({
      title: t('meeting.endConfirmTitle'),
      body: t('meeting.endConfirmBody'),
      confirmLabel: t('meeting.end'),
      cancelLabel: t('common.cancel'),
    })
    if (!ok) return
    setEnding(true)
    const result = await endMeetingNow(id, meeting?.notes ?? '')
    setEnding(false)
    if (!result.ok) {
      toast(t(result.error), { tone: 'error' })
      return
    }
    toast(t('meeting.ended'))
    navigate(`/meetings/${id}/triage`)
  }, [id, meeting?.notes, navigate])

  const handleResume = useCallback(async (): Promise<void> => {
    const result = await resumeMeetingNow(id)
    if (!result.ok) {
      toast(t(result.error), { tone: 'error' })
      return
    }
    toast(t('meeting.resumed'))
    focusInput()
  }, [focusInput, id])

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

  return (
    <div className="mt-page mt-live">
      <header className="mt-live-head">
        <button
          type="button"
          className="btn btn-sm btn-ghost mt-back"
          onClick={() => navigate('/meetings')}
        >
          <IconArrowStart size={16} className="icon-directional" />
          {t('meeting.backToMeetings')}
        </button>
        <div className="mt-live-title">
          <h1 className="page-title mt-live-name">{meeting.title}</h1>
          <span className={`pill mt-badge${live ? ' ok' : ''}`}>
            {live ? t('meeting.badgeLive') : t('meeting.badgeEnded')}
          </span>
          {/* aria-hidden because the live region below already announces the
              count, on a debounce; two sources would read it twice. */}
          <span className="mt-live-count" aria-hidden="true">
            {t('meeting.captured', { count: lines.length })}
          </span>
        </div>
      </header>

      {live ? (
        <form className="mt-capture" onSubmit={handleSubmit} noValidate>
          <label className="sr-only" htmlFor="mt-line">
            {t('meeting.lineLabel')}
          </label>
          <input
            id="mt-line"
            ref={inputRef}
            className="input mt-capture-input"
            type="text"
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              if (error) setError(null)
            }}
            onKeyDown={handleKeyDown}
            placeholder={t('meeting.linePlaceholder')}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="send"
            aria-describedby="mt-line-hint"
            aria-invalid={error ? 'true' : undefined}
          />
          <p className="mt-hint" id="mt-line-hint">
            {t('meeting.hintEnter')}
          </p>
          {error && (
            <p className="mt-error" role="alert">
              {t(error)}
            </p>
          )}
          <div className="row-actions mt-live-actions">
            {/* Hidden, not disabled: a disabled End on somebody else's meeting
                is a control that reads as broken, and there is nothing the
                attendee can do to enable it. The line below says who can. */}
            {canEndMeeting ? (
              <button type="button" className="btn btn-sm" onClick={() => void handleEnd()} disabled={ending}>
                {ending ? t('meeting.ending') : t('meeting.end')}
              </button>
            ) : (
              <p className="mt-hint">{t('meeting.errNotYours')}</p>
            )}
            {pendingCount > 0 && (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => navigate(`/meetings/${id}/triage`)}
              >
                {t('meeting.goTriage')} · {t('meeting.toTriage', { count: pendingCount })}
              </button>
            )}
          </div>
        </form>
      ) : (
        // Ended. No disabled input to puzzle over — the two things you can do
        // are the two things on screen.
        <div className="mt-ended-bar" role="status">
          <p className="mt-ended-text">{t('meeting.ended')}</p>
          <div className="row-actions mt-live-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => navigate(`/meetings/${id}/triage`)}
            >
              {t('meeting.triage')}
            </button>
            {/* Resume writes `ended_at`, so it belongs to the same people End
                does. Triage and the minutes stay open to the whole room. */}
            {canEndMeeting && (
              <button type="button" className="btn btn-sm" onClick={() => void handleResume()}>
                {t('meeting.resume')}
              </button>
            )}
            {/* The third thing an ended meeting is for. Added at integration:
                /meetings/:id/minutes had no entrance in the app at all, and a
                document nobody can navigate to is a document that does not
                exist. Ghost, because triage comes first — the minutes read
                better once the lines have been decided. */}
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => navigate(`/meetings/${id}/minutes`)}
            >
              {t('route.minutes')}
            </button>
          </div>
        </div>
      )}

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
          icon={<IconFile size={30} />}
          title={t('meeting.capturedNone')}
          description={t('meeting.capturedNoneHint')}
        />
      ) : (
        <ol className="mt-lines">
          {/* Newest first — see this file's header. `.slice()` because the store
              holds the canonical seq-ascending array and reversing it in place
              would reorder every other reader of the same reference. */}
          {lines
            .slice()
            .reverse()
            .map((line) => (
              <LineItem key={line.id} line={line} editable={live} makeCtx={makeCtx} />
            ))}
        </ol>
      )}

      {/* The one live region on the screen. Debounced, and it announces a COUNT
          rather than the lines themselves. */}
      <div className="sr-only" role="status" aria-live="polite">
        {announce}
      </div>
    </div>
  )
}

// ── one captured line ──────────────────────────────────────────────────────

interface LineItemProps {
  line: MeetingLine
  /** False once the meeting has ended: the record is readable, not editable. */
  editable: boolean
  makeCtx: () => ParseContext
}

const STATE_LABEL: Readonly<Record<MeetingLine['state'], string>> = {
  pending: 'meeting.statePending',
  note: 'meeting.stateNote',
  discarded: 'meeting.stateDiscarded',
  committed: 'meeting.stateCommitted',
}

/**
 * One line, subscribing for ITSELF.
 *
 * `useLineSaving` is a hook and cannot be called in a loop; a parent subscribed
 * to the whole saving set would re-render forty rows every time any one of them
 * settled, in the middle of somebody typing the forty-first.
 */
function LineItem({ line, editable, makeCtx }: LineItemProps): ReactElement {
  const saving = useLineSaving(line.id)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(line.raw)
  const editRef = useRef<HTMLInputElement>(null)
  const textRef = useRef<HTMLButtonElement>(null)
  /**
   * Set when the editor is left by KEYBOARD, so focus can go home.
   *
   * Closing the editor unmounts the focused <input>, and the button that opened
   * it does not exist while it is open — so focus lands on <body> and the next
   * Tab restarts at the top of the document (WCAG 2.4.3). It cannot be restored
   * synchronously for that reason; it has to wait for the button to come back,
   * which is what the effect below is for.
   *
   * NOT set on blur: blur means focus has already gone somewhere the user
   * chose, and dragging it back would be the more annoying bug.
   */
  const returnFocus = useRef(false)

  useEffect(() => {
    if (editing) {
      editRef.current?.select()
      return
    }
    if (!returnFocus.current) return
    returnFocus.current = false
    textRef.current?.focus()
  }, [editing])

  // A realtime patch from another attendee replaces the row under an open
  // editor. The draft follows it: this is a line of a shared record, not a
  // private document with an unsaved state.
  useEffect(() => {
    if (!editing) setDraft(line.raw)
  }, [line.raw, editing])

  const commitEdit = useCallback((): void => {
    setEditing(false)
    const next = draft.trim()
    if (next === '' || next === line.raw) {
      setDraft(line.raw)
      return
    }
    void editLine(line.id, next, makeCtx()).then((result) => {
      if (!result.ok) toast(t(result.error), { tone: 'error' })
    })
  }, [draft, line.id, line.raw, makeCtx])

  const move = useCallback(
    (state: MeetingLine['state']): void => {
      void setLineState(line.id, state).then((result) => {
        if (!result.ok) toast(t(result.error), { tone: 'error' })
      })
    },
    [line.id],
  )

  return (
    <li className="mt-line" data-state={line.state} data-saving={saving ? 'true' : undefined}>
      <span className="mt-line-seq tabular" aria-hidden="true">
        {line.seq}
      </span>

      <div className="mt-line-body">
        {editing ? (
          <input
            ref={editRef}
            className="input mt-line-edit"
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label={t('meeting.editLineLabel', { seq: line.seq })}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                returnFocus.current = true
                commitEdit()
                return
              }
              if (e.key !== 'Escape') return
              e.preventDefault()
              returnFocus.current = true
              setDraft(line.raw)
              setEditing(false)
            }}
          />
        ) : editable ? (
          // NO aria-label. The line's own words ARE the accessible name here —
          // an aria-label would replace them, and a screen-reader user would
          // hear "edit line 7" with no way to learn what line 7 says. The edit
          // affordance rides on `title` and on the button role instead.
          <button
            ref={textRef}
            type="button"
            className="mt-line-text"
            onClick={() => setEditing(true)}
            title={t('meeting.editLine')}
          >
            {line.raw}
          </button>
        ) : (
          <span className="mt-line-text is-static">{line.raw}</span>
        )}

        {line.state !== 'pending' && (
          <span className="mt-line-state">{t(STATE_LABEL[line.state])}</span>
        )}
        {saving && <span className="mt-line-saving">{t('meeting.lineSaving')}</span>}
      </div>

      {/* Exactly the moves that make sense from where this line is. A committed
          line has left the meeting and is the entry's problem now; a discarded
          one has one way back and no second way out. */}
      {editable && line.state !== 'committed' && !editing && (
        <div className="mt-line-actions">
          {line.state === 'discarded' ? (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => move('pending')}>
              {t('meeting.restore')}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => move(line.state === 'pending' ? 'note' : 'pending')}
              >
                {t(line.state === 'pending' ? 'meeting.makeNote' : 'meeting.makeAction')}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost mt-line-discard"
                onClick={() => move('discarded')}
              >
                {t('meeting.discard')}
              </button>
            </>
          )}
        </div>
      )}
    </li>
  )
}
