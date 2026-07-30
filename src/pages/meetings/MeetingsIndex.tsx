// /meetings — start one, or pick up one that is still half-triaged.
//
// TWO JOBS, IN THIS ORDER. Starting a meeting is the reason anybody opens this
// screen while people are walking into a room, so it is the first thing under
// the heading and it is one tap from a focused title field. Everything below is
// the second job: the meeting you left mid-triage last Tuesday, which is worth
// finding but is never urgent.
//
// The form is collapsed until asked for. An always-open form would push the
// list below the fold on a phone for the sake of a field that is empty 90% of
// the time, and an always-closed one would put a tap in front of the urgent
// path — so the button IS the affordance and expanding it focuses the input in
// the same gesture.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { FormEvent, ReactElement } from 'react'
import { EmptyState, Skeleton } from '../../components/shared'
import { ChipToggles, TrackPicker, type PickerOption } from '../../components/pickers'
import { IconChevronEnd, IconMic, IconUsers } from '../../components/icons'
import { formatRelativeTime } from '../../lib/dates'
import { t, useLocale, type Locale } from '../../lib/i18n'
import { useTrackLabel } from '../../lib/labels'
import { initials } from '../../lib/text'
import { trackVars } from '../../lib/trackStyle'
import { useTrackMap } from '../../store/config'
import { loadMembers, useMembers } from '../../store/members'
import {
  loadMeetings,
  startMeeting,
  useLineCounts,
  useMeetings,
  useMeetingsError,
  useMeetingsLoading,
} from '../../store/meetings'
import type { Meeting } from '../../types'
import './meetings.css'

export default function MeetingsIndex(): ReactElement {
  const locale = useLocale()
  const navigate = useNavigate()
  const meetings = useMeetings()
  const loading = useMeetingsLoading()
  const error = useMeetingsError()
  const members = useMembers()

  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [trackId, setTrackId] = useState<string | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [guests, setGuests] = useState<string[]>([])
  const [guestDraft, setGuestDraft] = useState('')
  const [busy, setBusy] = useState(false)
  /** An i18n KEY, never a sentence — the rule every store here follows. */
  const [formError, setFormError] = useState<string | null>(null)

  const titleRef = useRef<HTMLInputElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  /**
   * Set when the form is closed BY THE USER, so focus can go back to the button
   * that opened it.
   *
   * The disclosure swaps the toggle for the form, so the button does not exist
   * while the form is open and focus cannot be restored synchronously — it has
   * to wait for the button to come back, which the effect below does. The flag
   * is what keeps that effect from stealing focus on first mount, where `open`
   * is already false and nobody asked for anything.
   */
  const closedByUser = useRef(false)

  // Both loaders dedupe and neither rejects, so this is safe unawaited and safe
  // beside another screen doing the same. Members are warmed by the Shell; the
  // call is here too because this screen is reachable before the Shell's warm
  // has landed on a cold start.
  useEffect(() => {
    void loadMeetings()
    void loadMembers()
  }, [])

  // Focus follows the disclosure IN BOTH DIRECTIONS, so "start a meeting" is one
  // tap and then typing, and cancelling puts the caret back where it started
  // rather than on <body>. A ref rather than autoFocus: autoFocus fires only on
  // an element's first mount and silently does nothing when the panel reopens.
  useEffect(() => {
    if (open) {
      titleRef.current?.focus()
      return
    }
    if (!closedByUser.current) return
    closedByUser.current = false
    toggleRef.current?.focus()
  }, [open])

  const memberOptions = useMemo<PickerOption[]>(
    () =>
      members.map((m) => ({
        key: m.id,
        label: m.displayName,
        mark: (
          <span className="pick-avatar" aria-hidden="true">
            {initials(m.displayName)}
          </span>
        ),
      })),
    [members],
  )

  const addGuest = useCallback((): void => {
    const name = guestDraft.trim()
    if (name === '') return
    setGuests((prev) => (prev.includes(name) ? prev : [...prev, name]))
    setGuestDraft('')
  }, [guestDraft])

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault()
      if (busy) return

      const trimmed = title.trim()
      if (trimmed === '') {
        setFormError('meeting.errTitleRequired')
        titleRef.current?.focus()
        return
      }

      // A name typed but never added is still a name the user meant. Folding it
      // in beats losing it to a missed tap on the Add button.
      const pendingGuest = guestDraft.trim()
      const names = [
        ...picked.map((id) => members.find((m) => m.id === id)?.displayName ?? ''),
        ...guests,
        ...(pendingGuest !== '' && !guests.includes(pendingGuest) ? [pendingGuest] : []),
      ].filter((n) => n !== '')

      setBusy(true)
      setFormError(null)
      const result = await startMeeting({ title: trimmed, trackId, attendees: names })
      setBusy(false)

      if (!result.ok) {
        setFormError(result.error)
        return
      }
      // The id was minted before the request went out (api/meetings.ts's
      // header), so this navigation is correct whether the insert landed or was
      // queued — which is the whole point of minting it there.
      navigate(`/meetings/${result.data.id}`)
    },
    [busy, guestDraft, guests, members, navigate, picked, title, trackId],
  )

  return (
    // The Shell already renders <main class="main-content">; a second <main>
    // would give the document two landmarks and no way to tell them apart.
    <div className="mt-page">
      <header className="mt-head">
        <h1 className="page-title">{t('meeting.title')}</h1>
        <p className="mt-subtitle">{t('meeting.subtitle')}</p>
      </header>

      <section className="mt-start card">
        {!open ? (
          <button
            ref={toggleRef}
            type="button"
            className="btn btn-primary mt-start-toggle"
            onClick={() => setOpen(true)}
          >
            <IconMic size={18} />
            {t('meeting.newMeeting')}
          </button>
        ) : (
          <form className="mt-start-form" onSubmit={(e) => void handleSubmit(e)} noValidate>
            <h2 className="section-title">{t('meeting.formTitle')}</h2>

            <div className="field">
              <label className="field-label" htmlFor="mt-title">
                {t('meeting.titleLabel')}
              </label>
              <input
                id="mt-title"
                ref={titleRef}
                className="input"
                type="text"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value)
                  if (formError) setFormError(null)
                }}
                placeholder={t('meeting.titlePlaceholder')}
                autoComplete="off"
                enterKeyHint="done"
                aria-invalid={formError ? 'true' : undefined}
              />
            </div>

            <div className="field">
              <span className="field-label" id="mt-track-label">
                {t('meeting.trackLabel')}
              </span>
              <TrackPicker
                label={t('meeting.trackLabel')}
                value={trackId}
                onChange={setTrackId}
                clearLabel={t('meeting.noTrack')}
              />
            </div>

            <div className="field">
              <span className="field-label">{t('meeting.attendeesLabel')}</span>
              <p className="mt-hint">{t('meeting.attendeesHint')}</p>
              {memberOptions.length > 0 && (
                <ChipToggles
                  label={t('meeting.attendeesLabel')}
                  options={memberOptions}
                  value={picked}
                  onChange={setPicked}
                />
              )}
              {guests.length > 0 && (
                <div className="chip-row mt-guests">
                  {guests.map((name) => (
                    <span key={name} className="chip mt-guest">
                      <span className="mt-guest-name">{name}</span>
                      <button
                        type="button"
                        className="mt-guest-x"
                        onClick={() => setGuests((prev) => prev.filter((g) => g !== name))}
                        aria-label={t('meeting.attendeeRemove', { name })}
                      >
                        <span aria-hidden="true" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-guest-add">
                <input
                  className="input"
                  type="text"
                  value={guestDraft}
                  onChange={(e) => setGuestDraft(e.target.value)}
                  placeholder={t('meeting.attendeePlaceholder')}
                  aria-label={t('meeting.attendeeAdd')}
                  autoComplete="off"
                  // Enter inside a form submits it, and "I finished typing a
                  // guest's name" is not "start the meeting".
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return
                    e.preventDefault()
                    addGuest()
                  }}
                />
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={addGuest}
                  disabled={guestDraft.trim() === ''}
                >
                  {t('common.add')}
                </button>
              </div>
            </div>

            {formError && (
              <p className="mt-error" role="alert">
                {t(formError)}
              </p>
            )}

            <div className="mt-start-actions">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? t('meeting.starting') : t('meeting.startNow')}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  closedByUser.current = true
                  setOpen(false)
                }}
              >
                {t('common.cancel')}
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="mt-list-section">
        <h2 className="section-title">{t('meeting.recent')}</h2>

        {error && (
          <p className="mt-error" role="alert">
            {t(error)}{' '}
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => void loadMeetings(true)}
            >
              {t('common.retry')}
            </button>
          </p>
        )}

        {loading && meetings.length === 0 ? (
          <div className="mt-list" aria-busy="true">
            <Skeleton height={64} count={3} />
          </div>
        ) : meetings.length === 0 && !error ? (
          <EmptyState
            icon={<IconMic size={30} />}
            title={t('meeting.empty')}
            description={t('meeting.emptyHint')}
          />
        ) : (
          <ul className="mt-list">
            {meetings.map((meeting) => (
              <MeetingRow key={meeting.id} meeting={meeting} locale={locale} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

// ── one meeting ────────────────────────────────────────────────────────────

/**
 * Subscribing for ITSELF, one narrow selector per row.
 *
 * `useLineCounts` is a hook and cannot be called in a loop, and a parent
 * subscribed to the whole counts map would re-render every row each time a
 * single line landed in a meeting nobody is looking at.
 */
function MeetingRow({ meeting, locale }: { meeting: Meeting; locale: Locale }): ReactElement {
  const navigate = useNavigate()
  const trackMap = useTrackMap()
  const trackLabel = useTrackLabel()
  const counts = useLineCounts(meeting.id)

  const track = meeting.track_id ? trackMap.get(meeting.track_id) : undefined
  const live = meeting.ended_at === null
  const when = live ? meeting.started_at : meeting.ended_at
  // Live meetings go back to capture; ended ones go to the thing you came for.
  const href = live ? `/meetings/${meeting.id}` : `/meetings/${meeting.id}/triage`

  return (
    <li className="mt-row" style={track ? trackVars(track.color, track.color_light) : undefined}>
      {/* One control per row, wrapping the whole card: a row that is a button
          containing buttons is invalid HTML and assistive tech has to guess
          which one a tap meant. The two destinations differ by state, not by a
          second control.

          NO aria-label. Everything inside is real information — the state, the
          track, when it ran, how much is still to triage — and an aria-label
          would replace all of it with the title alone. `title` on the element
          carries the "open" verb for a pointer without touching the name. */}
      <button
        type="button"
        className="mt-row-btn"
        onClick={() => navigate(href)}
        title={t('meeting.openLabel', { title: meeting.title })}
      >
        {track && <span className="track-bar mt-row-bar" aria-hidden="true" />}
        <span className="mt-row-main">
          <span className="mt-row-title">
            <span className="entry-title mt-row-name">{meeting.title}</span>
            <span className={`pill mt-badge${live ? ' ok' : ''}`}>
              {live ? t('meeting.badgeLive') : t('meeting.badgeEnded')}
            </span>
          </span>
          <span className="mt-row-meta">
            {track && (
              <span className="mt-row-track">
                <span className="track-dot" aria-hidden="true" />
                {trackLabel(track)}
              </span>
            )}
            <span className="mt-row-when">
              {t(live ? 'meeting.startedRelative' : 'meeting.endedRelative', {
                when: formatRelativeTime(when ?? meeting.started_at, locale),
              })}
            </span>
            {meeting.attendees.length > 0 && (
              <span className="mt-row-attendees">
                <IconUsers size={14} />
                {/* The glyph is aria-hidden by construction, so the bare number
                    would be announced as "3" with nothing to attach it to. */}
                <span className="sr-only">{t('meeting.attendeesLabel')}</span>
                {meeting.attendees.length}
              </span>
            )}
          </span>
        </span>
        <span className="mt-row-counts">
          {counts.pending > 0 ? (
            <span className="pill warn mt-count-pending">
              {t('meeting.toTriage', { count: counts.pending })}
            </span>
          ) : counts.total > 0 ? (
            <span className="mt-count-clear">{t('meeting.allTriaged')}</span>
          ) : null}
          {counts.total > 0 && (
            <span className="mt-count-total">{t('meeting.lineCount', { count: counts.total })}</span>
          )}
        </span>
        <IconChevronEnd size={18} className="icon-directional mt-row-go" />
      </button>
    </li>
  )
}
