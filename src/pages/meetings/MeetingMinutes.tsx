// `/meetings/:id/minutes` — the meeting as a document.
//
// THIS PAGE IS A FRAME, NOT A FORMATTER. Every string inside the document comes
// from `lib/minutes.buildMinutes()`, already resolved for one explicitly chosen
// locale; this file walks the resulting model and hangs elements off it. That
// split is the whole design: the same model feeds the Markdown and plain-text
// renderers behind the copy buttons, so WHAT YOU SEE AND WHAT YOU PASTE CANNOT
// DISAGREE. A page that built its own JSX from the rows and let the renderers
// build their own strings would be two implementations of one document, and
// they would drift on the first change either side.
//
// THE DOCUMENT HAS ITS OWN LANGUAGE, independent of the UI's. An Arabic team
// sends a record of the meeting to an English-speaking vendor, or the reverse,
// and neither should have to flip the whole app to do it. The toolbar stays in
// the UI locale (it is chrome, and chrome follows the app); the sheet below it
// carries its own `dir` and `lang`, so the browser applies the right
// bidirectional layout, the right hyphenation and the right font stack to a
// document written in the other direction from everything around it.
//
// WHERE THE ROWS COME FROM. The meeting and its lines come from
// `store/meetings` — the same store MeetingLive and MeetingTriage write, so a
// line discarded in triage is a note here without a refetch. The ENTRIES are
// derived from `store/entries`: the committed lines carry `entry_id`, and any
// entry filed straight against the meeting carries `meeting_id`.
//
// THAT WORKING SET IS OPEN-ONLY (`api/entries.listEntries` excludes the closed
// statuses), and a meeting's whole point is that its actions get FINISHED. So
// this page also asks for the closed tail from the meeting's own start date:
// without it, every committed line whose entry has since been done or cancelled
// silently degraded to its raw captured text under the generic Items heading —
// losing the owner, the status, the due date and the Decisions/Actions section
// the type had earned — and it did so only when the reader had not visited a
// screen that happens to warm closed rows first, which made the document's
// correctness depend on how you navigated to it.
//
// `loadClosedSince()` is additive and short-circuits on a window already
// covered, so the cost is one fetch, and the meeting's `started_at` is the
// exact and minimal window. `buildMinutes`'s raw-text fallback stays for the
// genuinely deleted entry, and the `entries` prop below stays the seam for a
// caller that already holds the full set.

import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { EmptyState, LoadingSpinner } from '../../components/shared'
import { IconArrowStart, IconChevronEnd, IconFile } from '../../components/icons'
import { toast } from '../../components/toast'
import { t, useLocale, type Locale } from '../../lib/i18n'
import { trackLabel } from '../../lib/labels'
import {
  buildMinutes,
  renderMinutes,
  type MinutesFormat,
  type MinutesItem,
  type MinutesModel,
  type MinutesSection,
} from '../../lib/minutes'
import { instantToIsoDate } from '../../lib/dates'
import { useTrackMap, loadConfig } from '../../store/config'
import { loadClosedSince, loadEntries, useEntryList, useEntryMap } from '../../store/entries'
import { openEntry } from '../../store/entrySheet'
import {
  loadLines,
  loadMeetings,
  useLinesError,
  useLinesLoading,
  useMeeting,
  useMeetingLines,
  useMeetingsError,
} from '../../store/meetings'
import { loadMembers, useMemberMap } from '../../store/members'
import { getVocabSnapshot, loadVocab, useVocabLabel, vocabLabel } from '../../store/vocab'
import type { Entry, VocabKind } from '../../types'
import './minutes.css'

export interface MeetingMinutesProps {
  /** Defaults to the `:id` route param, so the route needs no wiring. */
  meetingId?: string
  /**
   * The entries this meeting produced, when the caller already has them.
   *
   * Omitted, they are derived from the entries store (see the header). This is
   * the extension seam, not a convenience: pass the result of a meeting-scoped
   * read and every closed entry renders in full.
   */
  entries?: readonly Entry[]
}

export default function MeetingMinutes({
  meetingId,
  entries: given,
}: MeetingMinutesProps): ReactElement {
  const { id: routeId = '' } = useParams<{ id: string }>()
  const id = meetingId ?? routeId
  const navigate = useNavigate()
  const uiLocale = useLocale()

  const meeting = useMeeting(id)
  const lines = useMeetingLines(id)
  const linesLoading = useLinesLoading(id)
  const linesError = useLinesError(id)
  const meetingsError = useMeetingsError()

  /** null = follow the UI. Set only by the language switch below. */
  const [override, setOverride] = useState<Locale | null>(null)
  const docLocale = override ?? uiLocale

  /** True once the first load has come back, so "not found" is a fact. */
  const [settled, setSettled] = useState(false)

  useEffect(() => {
    // Everything the document resolves a name from. All five are idempotent and
    // return immediately when a good copy is already in hand, so arriving here
    // from triage costs nothing.
    void loadMembers()
    void loadConfig()
    void loadVocab()
    void loadEntries()
  }, [])

  useEffect(() => {
    if (id === '') {
      setSettled(true)
      return
    }
    setSettled(false)
    void Promise.all([loadMeetings(), loadLines(id)]).then(() => {
      setSettled(true)
    })
  }, [id])

  // The closed tail, as soon as the header lands — see the file's third note.
  // Keyed on the instant rather than the meeting object so a realtime patch to
  // the notes does not re-ask, and guarded on '' because instantToIsoDate()
  // answers that for an unparseable timestamp and a blank date is not a window.
  const startedAt = meeting?.started_at
  useEffect(() => {
    if (startedAt === undefined) return
    const from = instantToIsoDate(startedAt)
    if (from === '') return
    void loadClosedSince(from)
  }, [startedAt])

  /* ── the three lookups lib/minutes may not perform for itself ── */

  const memberMap = useMemberMap()
  const trackMap = useTrackMap()
  const uiVocabLabel = useVocabLabel()

  const personName = useCallback(
    (personId: string | null, fallback?: string | null): string | null => {
      const named = personId === null ? '' : (memberMap.get(personId)?.displayName.trim() ?? '')
      if (named !== '') return named
      const free = fallback?.trim() ?? ''
      // NULL, not a localized "Unassigned": that fallback belongs to the
      // document, in the DOCUMENT's language. See MinutesContext.personName.
      return free === '' ? null : free
    },
    [memberMap],
  )

  const trackName = useCallback(
    (trackId: string | null): string | null => {
      if (trackId === null) return null
      const track = trackMap.get(trackId)
      return track ? trackLabel(track, docLocale) : null
    },
    [trackMap, docLocale],
  )

  // The hook when the document speaks the UI's language, the snapshot resolver
  // when it does not — `vocabLabel()` takes the locale explicitly, which is the
  // reason the store publishes both. Either way the callback is rebuilt when
  // `uiVocabLabel` changes identity, which is exactly when the vocabulary rows
  // (or the UI locale) changed, so an admin renaming a status re-labels this
  // document without a reload in both modes.
  const resolveVocab = useCallback(
    (kind: VocabKind, key: string): string =>
      docLocale === uiLocale
        ? uiVocabLabel(kind, key)
        : vocabLabel(getVocabSnapshot(), kind, key, docLocale),
    [uiVocabLabel, docLocale, uiLocale],
  )

  /* ── the rows ── */

  const entryList = useEntryList()
  const entryMap = useEntryMap()

  const entries = useMemo((): readonly Entry[] => {
    if (given) return given
    // A Map, because a line's entry and the meeting_id scan overlap on every
    // row that is both committed and still open.
    const found = new Map<string, Entry>()
    for (const entry of entryList) {
      if (entry.meeting_id === id) found.set(entry.id, entry)
    }
    for (const line of lines) {
      if (line.entry_id === null) continue
      const entry = entryMap.get(line.entry_id)
      if (entry) found.set(entry.id, entry)
    }
    return [...found.values()]
  }, [given, entryList, entryMap, lines, id])

  const model = useMemo(
    (): MinutesModel | null =>
      meeting === undefined
        ? null
        : buildMinutes(
            { meeting, lines, entries },
            { locale: docLocale, vocabLabel: resolveVocab, personName, trackName },
          ),
    [meeting, lines, entries, docLocale, resolveVocab, personName, trackName],
  )

  /* ── actions ── */

  const copy = useCallback(
    async (format: MinutesFormat): Promise<void> => {
      if (model === null) return
      try {
        // `navigator.clipboard` is undefined on an insecure origin and rejects
        // when the gesture is not trusted, and both failures are SILENT — the
        // user taps, nothing appears to happen, and what they think they copied
        // is whatever was in the clipboard before. Hence the explicit toast,
        // and hence the hint it carries: the document is selectable text.
        await navigator.clipboard.writeText(renderMinutes(model, format))
        toast(t('minutes.copied'), { tone: 'success' })
      } catch {
        toast(t('minutes.errCopy'), { tone: 'error' })
      }
    },
    [model],
  )

  const back = useCallback((): void => {
    void navigate(id === '' ? '/meetings' : `/meetings/${id}`)
  }, [navigate, id])

  /* ── states ── */

  if (meeting === undefined && !settled) return <LoadingSpinner />

  if (meeting === undefined) {
    // Two different dead ends, and they need different exits. A LOAD FAILURE is
    // temporary and the way out is to try again; a meeting that is genuinely
    // gone is permanent and the way out is the list. Both stores hand back an
    // i18n KEY, never a sentence, so the reason renders in the reader's
    // language — as the description, under a title that stays stable, because
    // "Couldn't load this meeting" is the headline and "not configured" is the
    // detail, not the other way round.
    const failure = linesError ?? meetingsError
    const retry = (): void => {
      setSettled(false)
      void Promise.all([loadMeetings(true), loadLines(id, true)]).then(() => {
        setSettled(true)
      })
    }
    return (
      <div className="mdoc">
        <EmptyState
          icon={<IconFile size={30} />}
          title={failure === null ? t('minutes.notFound') : t('minutes.errLoad')}
          description={failure === null ? t('minutes.notFoundHint') : t(failure)}
          action={
            failure === null ? (
              <button type="button" className="btn" onClick={() => void navigate('/meetings')}>
                {t('common.back')}
              </button>
            ) : (
              <button type="button" className="btn" onClick={retry}>
                {t('common.retry')}
              </button>
            )
          }
        />
      </div>
    )
  }

  return (
    <div className="mdoc">
      {/* Chrome, in the UI's language — deliberately outside the sheet, which
          carries the document's own direction. */}
      <div className="mdoc-bar">
        <button type="button" className="btn btn-sm btn-ghost mdoc-back" onClick={back}>
          <IconArrowStart size={16} className="icon-directional" />
          {t('common.back')}
        </button>

        <div className="mdoc-tools">
          <div className="chip-row mdoc-seg" role="group" aria-label={t('minutes.docLanguage')}>
            <button
              type="button"
              className="chip"
              aria-pressed={docLocale === 'en'}
              onClick={() => setOverride('en')}
            >
              {t('minutes.langEn')}
            </button>
            <button
              type="button"
              className="chip"
              aria-pressed={docLocale === 'ar'}
              onClick={() => setOverride('ar')}
            >
              {t('minutes.langAr')}
            </button>
          </div>

          {/* Words, not glyphs: components/icons.tsx publishes no copy or
              printer mark and is a single-owner file this worker may not open —
              and "copy" and "print" are two of the most-guessed-wrong icons
              there are, which makes the label the better control anyway. */}
          <button type="button" className="btn btn-sm" onClick={() => void copy('markdown')}>
            {t('minutes.copyMarkdown')}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => void copy('plain')}>
            {t('minutes.copyPlain')}
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => window.print()}>
            {t('minutes.print')}
          </button>
        </div>
      </div>

      {model !== null && <MinutesSheet model={model} busy={linesLoading} />}
    </div>
  )
}

/* ──────────────────────────────── the sheet ─────────────────────────────── */

/**
 * The document itself.
 *
 * `lang` and `dir` are set HERE rather than inherited, because this subtree may
 * be written in the other direction from the app around it. Everything below
 * uses logical properties, so the whole sheet mirrors on that one attribute
 * with no direction-aware CSS anywhere.
 */
function MinutesSheet({ model, busy }: { model: MinutesModel; busy: boolean }): ReactElement {
  return (
    <article
      className="card mdoc-sheet"
      lang={model.locale}
      dir={model.dir}
      aria-busy={busy || undefined}
    >
      <h1 className="mdoc-title">{model.title}</h1>

      {model.header.length > 0 && (
        <dl className="mdoc-head">
          {model.header.map((field) => (
            <div className="mdoc-field" key={field.key}>
              <dt className="mdoc-label">{field.label}</dt>
              <dd className="mdoc-value">
                {field.key === 'attendees' ? (
                  <span className="mdoc-people">
                    {model.attendees.map((person) => (
                      // dir="auto" per name: a Latin name in an Arabic list (or
                      // the reverse) resolves against its own first strong
                      // character, which is what stops a mixed roster from
                      // rendering in the wrong order. The text renderers do the
                      // same job with isolate characters, which the DOM does
                      // not need.
                      <span className="mdoc-person" dir="auto" key={person}>
                        {person}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span dir="auto">{field.value}</span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {model.empty ? (
        <p className="mdoc-empty">{model.emptyText}</p>
      ) : (
        model.sections.map((section) => <Band section={section} key={section.kind} />)
      )}

      {model.closingNotes !== '' && (
        <section className="mdoc-section">
          <h2 className="mdoc-heading">{model.closingNotesHeading}</h2>
          {/* Index keys: these are the paragraphs of one text blob. They have
              no identity of their own, they never reorder, and the whole block
              re-renders together when the note is edited. */}
          {model.closingNotes.split('\n').map((paragraph, i) =>
            paragraph.trim() === '' ? null : (
              <p className="mdoc-detail mdoc-notes" dir="auto" key={`note-${i}`}>
                {paragraph.trim()}
              </p>
            ),
          )}
        </section>
      )}
    </article>
  )
}

function Band({ section }: { section: MinutesSection }): ReactElement {
  const items = section.items.map((item) => <Row item={item} kind={section.kind} key={item.key} />)
  // Actions carry a state box instead of a number; everything else numbered is
  // numbered, and notes get bullets. The markers are drawn by the stylesheet —
  // see its comment for why a flex `<li>` cannot use the native ones.
  const variant =
    section.kind === 'actions'
      ? 'mdoc-list-tasks'
      : section.ordered
        ? 'mdoc-list-numbers'
        : 'mdoc-list-bullets'
  const className = `mdoc-list ${variant}`
  return (
    <section className="mdoc-section">
      <h2 className="mdoc-heading">
        {section.heading}
        <span className="mdoc-count tabular">{section.items.length}</span>
      </h2>
      {/* `role="list"` is not redundant: WebKit drops list semantics from a list
          styled `list-style: none`, and VoiceOver then reads the bands as loose
          paragraphs — in a document whose whole structure is its lists. */}
      {section.ordered ? (
        <ol className={className} role="list">
          {items}
        </ol>
      ) : (
        <ul className={className} role="list">
          {items}
        </ul>
      )}
    </section>
  )
}

function Row({ item, kind }: { item: MinutesItem; kind: MinutesSection['kind'] }): ReactElement {
  const state = item.cancelled ? ' is-cancelled' : item.done ? ' is-done' : ''
  // Lifted out of the JSX so the click handler closes over a `string`, not the
  // `string | null` the property is typed as.
  const entryId = item.entryId
  return (
    <li className={`mdoc-item${state}`}>
      {kind === 'actions' && (
        // Decoration only. The fact it stands for is already in the row's
        // Status fragment, in words, in the document's language — a screen
        // reader announcing "checkbox" for something nobody can toggle would be
        // a lie about an interactive control.
        <span className="mdoc-check" aria-hidden="true" />
      )}
      <div className="mdoc-body">
        <p className="mdoc-text" dir="auto">
          {item.text}
        </p>
        {item.meta.length > 0 && (
          <p className="mdoc-meta">
            {item.meta.map((meta) => (
              <span className="mdoc-meta-part" key={meta.kind}>
                <span className="mdoc-meta-label">{meta.label}</span>
                <span dir="auto">{meta.value}</span>
              </span>
            ))}
          </p>
        )}
        {item.detail !== '' && (
          <p className="mdoc-detail" dir="auto">
            {item.detail}
          </p>
        )}
      </div>
      {entryId !== null && (
        <button
          type="button"
          className="btn btn-ghost btn-icon mdoc-open"
          aria-label={t('minutes.openEntry')}
          onClick={() => openEntry(entryId)}
        >
          <IconChevronEnd size={16} className="icon-directional" />
        </button>
      )}
    </li>
  )
}
