// The digest generator — the headline reporting screen.
//
// WHAT THIS FILE IS AND IS NOT. It is a control panel and a preview pane. It
// owns no formatting, no bucketing, no wording and no date arithmetic: the
// window goes to `collectDigest()`, the rows and the options go to
// `buildDigestModel()`, and the model goes to one of three pure renderers. If a
// question about WHAT the report says is answerable in this file, something has
// leaked out of `src/lib/digest/`.
//
// THE ONE PROPERTY WORTH PROTECTING: the report's language is independent of
// the app's. `docLocale` defaults to the UI locale and can be flipped to the
// other one, and flipping it re-renders the document WITHOUT refetching,
// because `buildDigestModel` is pure and takes the locale as an argument. That
// is the Wave-3 gate (d) — an Arabic digest generated from an English UI —
// available as a control rather than as a test-only path, which is the only way
// it stays working.
//
// EVERYTHING THE READER TOGGLES IS PERSISTED. A weekly report is a habit: the
// same person picks the same sections, the same format and the same options
// every Thursday, and re-picking them is the reason a tool like this stops
// getting used. The range is deliberately NOT persisted — it is the one choice
// that should default to "the last seven days" every time you arrive.
//
// TRUNCATION IS MERGED IN HERE, not in the collector: `EntriesCoverage.truncated`
// is reachable only through a hook. See the note in api/digestCollect.ts and the
// extension slot in the handoff.

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import { EmptyState, Skeleton } from '../components/shared'
import { TrackDot } from '../components/entry'
import { IconFile } from '../components/icons'
import { toast } from '../components/toast'
import { collectDigest, digestVocabLabel } from '../api/digestCollect'
import {
  DIGEST_FORMATS,
  SECTION_ORDER,
  buildDigestModel,
  digestFilename,
  digestMimeType,
  renderDigest,
  type DigestFormat,
  type DigestModel,
  type DigestRows,
  type DigestSectionKind,
} from '../lib/digest'
import { clampIso, lastNDays, todayIso, weekBounds, type IsoDate } from '../lib/dates'
import { t, useLocale, type Locale } from '../lib/i18n'
import { useActiveTracks } from '../store/config'
import { useEntriesCoverage } from '../store/entries'
import './digest.css'

/* ────────────────────────────── static tables ───────────────────────────── */
//
// Locale keys are written out rather than built with a template literal, so
// `localeReach.test.ts` can see them. A `digest.section${kind}` would be
// invisible to its regex and could ship missing in one language.

const SECTION_KEY: Readonly<Record<DigestSectionKind, string>> = {
  closed: 'digest.sectionClosed',
  inProgress: 'digest.sectionInProgress',
  blocked: 'digest.sectionBlocked',
  overdue: 'digest.sectionOverdue',
  slaBreached: 'digest.sectionSlaBreached',
}

const FORMAT_KEY: Readonly<Record<DigestFormat, string>> = {
  markdown: 'digest.formatMarkdown',
  plain: 'digest.formatPlain',
  html: 'digest.formatHtml',
}

const FORMAT_HINT_KEY: Readonly<Record<DigestFormat, string>> = {
  markdown: 'digest.formatMarkdownHint',
  plain: 'digest.formatPlainHint',
  html: 'digest.formatHtmlHint',
}

type Preset = 'week' | 'twoWeeks' | 'month' | 'thisWeek' | 'custom'

const PRESET_KEY: Readonly<Record<Preset, string>> = {
  week: 'digest.presetWeek',
  twoWeeks: 'digest.presetTwoWeeks',
  month: 'digest.presetMonth',
  thisWeek: 'digest.presetThisWeek',
  custom: 'digest.presetCustom',
}

const PRESETS: readonly Preset[] = ['week', 'twoWeeks', 'month', 'thisWeek', 'custom']

/** Sunday — the Saudi work week, the same default the parser and filters use. */
const WEEK_STARTS_ON = 0

/**
 * How far back a custom range may reach.
 *
 * Not a performance guard — the window is filtered client-side either way. It
 * stops `from` being typed as `0026-07-23`, which `lib/dates` will happily
 * accept and then report as 730,000 days overdue on every row.
 */
const EARLIEST: IsoDate = '2020-01-01'

const PREFS_KEY = 'opstrack_digest_v1'

interface Prefs {
  sections: DigestSectionKind[]
  format: DigestFormat
  includeNotes: boolean
  includeEmptyTracks: boolean
  includeTags: boolean
  /** null = follow the UI. */
  docLocale: Locale | null
  trackIds: string[]
}

const DEFAULT_PREFS: Prefs = {
  sections: [...SECTION_ORDER],
  format: 'markdown',
  includeNotes: false,
  includeEmptyTracks: false,
  includeTags: true,
  docLocale: null,
  trackIds: [],
}

function readPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return DEFAULT_PREFS
    const parsed = JSON.parse(raw) as Partial<Prefs>
    return {
      // Every field is validated rather than trusted: this is the one input to
      // the screen a user can hand-edit, and a bad `sections` array would put an
      // undefined key through `SECTION_KEY[...]` and render "undefined".
      sections: Array.isArray(parsed.sections)
        ? parsed.sections.filter((s): s is DigestSectionKind => SECTION_ORDER.includes(s))
        : DEFAULT_PREFS.sections,
      format: DIGEST_FORMATS.includes(parsed.format as DigestFormat)
        ? (parsed.format as DigestFormat)
        : DEFAULT_PREFS.format,
      includeNotes: parsed.includeNotes === true,
      includeEmptyTracks: parsed.includeEmptyTracks === true,
      includeTags: parsed.includeTags !== false,
      docLocale: parsed.docLocale === 'ar' || parsed.docLocale === 'en' ? parsed.docLocale : null,
      trackIds: Array.isArray(parsed.trackIds)
        ? parsed.trackIds.filter((id): id is string => typeof id === 'string')
        : [],
    }
  } catch {
    return DEFAULT_PREFS
  }
}

function rangeFor(preset: Preset, now: Date): { from: IsoDate; to: IsoDate } {
  switch (preset) {
    case 'twoWeeks':
      return lastNDays(14, now)
    case 'month':
      return lastNDays(30, now)
    case 'thisWeek':
      return weekBounds(now, WEEK_STARTS_ON)
    case 'week':
    case 'custom':
      return lastNDays(7, now)
  }
}

/* ──────────────────────────────── the screen ────────────────────────────── */

export default function Digest(): ReactElement {
  const uiLocale = useLocale()
  const tracks = useActiveTracks()
  const coverage = useEntriesCoverage()

  const [prefs, setPrefs] = useState<Prefs>(readPrefs)
  const [preset, setPreset] = useState<Preset>('week')
  const initialRange = useMemo(() => rangeFor('week', new Date()), [])
  const [from, setFrom] = useState<IsoDate>(initialRange.from)
  const [to, setTo] = useState<IsoDate>(initialRange.to)

  const [rows, setRows] = useState<DigestRows | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [htmlView, setHtmlView] = useState<'source' | 'rendered'>('source')

  const docLocale: Locale = prefs.docLocale ?? uiLocale
  const rangeInvalid = from > to

  const patch = useCallback((next: Partial<Prefs>): void => {
    setPrefs((current) => {
      const merged = { ...current, ...next }
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(merged))
      } catch {
        // A full quota must not break the screen; the choice just will not
        // survive a reload.
      }
      return merged
    })
  }, [])

  /* ── collection ─────────────────────────────────────────────────────── */

  // A monotonic token rather than an AbortController: `collectDigest` warms
  // stores that other screens share, and aborting them mid-flight would leave
  // the working set half-loaded for everyone. Discarding a stale ANSWER is the
  // correct scope of the cancellation, and it is what stops a fast reply to an
  // old range overwriting a slow reply to the current one.
  const requestRef = useRef(0)

  const load = useCallback(
    (force: boolean): void => {
      if (from > to) return
      const token = ++requestRef.current
      setLoading(true)
      void collectDigest({
        from,
        to,
        // The COLLECTOR is asked for everything and the BUILDER narrows: track
        // and section choices change with a click and must never cost a fetch.
        trackIds: [],
        sections: [...SECTION_ORDER],
        includeUpdates: true,
        force,
      })
        .then((result) => {
          if (token !== requestRef.current) return
          if (result.ok) {
            setRows(result.data)
            setError(null)
          } else {
            setError(result.error)
          }
        })
        .finally(() => {
          if (token === requestRef.current) setLoading(false)
        })
    },
    [from, to],
  )

  // `load` changes identity exactly when the range does, which is exactly when
  // a refetch is owed.
  useEffect(() => load(false), [load])

  const refresh = useCallback((): void => load(true), [load])

  /* ── the model ──────────────────────────────────────────────────────── */

  const model: DigestModel | null = useMemo(() => {
    if (rows === null || rangeInvalid) return null
    return buildDigestModel(
      // `truncated` is merged HERE because the flag lives on a hook-only slice
      // of store/entries; see api/digestCollect.ts.
      { ...rows, truncated: rows.truncated || coverage.truncated },
      {
        locale: docLocale,
        from,
        to,
        sections: prefs.sections,
        trackIds: prefs.trackIds,
        tagBreakdown: prefs.includeTags ? undefined : [],
        includeNotes: prefs.includeNotes,
        includeEmptyTracks: prefs.includeEmptyTracks,
        now: new Date(),
        vocabLabel: digestVocabLabel(docLocale),
      },
    )
  }, [rows, coverage.truncated, docLocale, from, to, prefs, rangeInvalid])

  const output = useMemo(
    () => (model === null ? '' : renderDigest(model, prefs.format)),
    [model, prefs.format],
  )

  /* ── actions ────────────────────────────────────────────────────────── */

  const copy = useCallback(async (): Promise<void> => {
    if (output === '') return
    try {
      // `navigator.clipboard` is undefined on an insecure origin and rejects on
      // an untrusted gesture, and BOTH failures are silent — the user taps,
      // nothing appears to happen, and what they paste is whatever was there
      // before. Hence the explicit toast, and hence its hint that the preview
      // is selectable text.
      await navigator.clipboard.writeText(output)
      toast(t('digest.copiedToast'), { tone: 'success' })
    } catch {
      toast(t('digest.errCopy'), { tone: 'error' })
    }
  }, [output])

  /**
   * Put the HTML on the clipboard AS HTML, so pasting into Gmail or Outlook
   * lands a formatted email rather than a wall of tags.
   *
   * Feature-detected, because `ClipboardItem` is absent on older WebKit and
   * `write()` rejects on Firefox for anything but text/plain — in both cases the
   * plain-text path above is the correct fallback rather than an error.
   */
  const copyRich = useCallback(async (): Promise<void> => {
    if (output === '') return
    const mime = digestMimeType('html')
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
      await copy()
      return
    }
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([output], { type: mime }),
          'text/plain': new Blob([output], { type: 'text/plain' }),
        }),
      ])
      toast(t('digest.copiedRichToast'), { tone: 'success' })
    } catch {
      await copy()
    }
  }, [output, copy])

  const download = useCallback((): void => {
    if (model === null || output === '') return
    const name = digestFilename(model, prefs.format)
    try {
      const url = URL.createObjectURL(new Blob([output], { type: digestMimeType(prefs.format) }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = name
      anchor.rel = 'noopener'
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      // Revoked on the next frame, not synchronously: Safari cancels an
      // in-flight download when the object URL disappears in the same task.
      requestAnimationFrame(() => URL.revokeObjectURL(url))
      toast(t('digest.downloadedToast', { name }), { tone: 'success' })
    } catch {
      toast(t('digest.errDownload'), { tone: 'error' })
    }
  }, [model, output, prefs.format])

  const choosePreset = useCallback((next: Preset): void => {
    setPreset(next)
    if (next === 'custom') return
    const range = rangeFor(next, new Date())
    setFrom(range.from)
    setTo(range.to)
  }, [])

  const toggleSection = useCallback(
    (kind: DigestSectionKind): void => {
      const held = prefs.sections.includes(kind)
      // Rebuilt from SECTION_ORDER rather than pushed onto the end, so the
      // report's section order stays canonical however the chips are clicked.
      patch({
        sections: SECTION_ORDER.filter((s) => (s === kind ? !held : prefs.sections.includes(s))),
      })
    },
    [prefs.sections, patch],
  )

  const toggleTrack = useCallback(
    (id: string): void => {
      const held = prefs.trackIds.includes(id)
      patch({
        trackIds: held ? prefs.trackIds.filter((x) => x !== id) : [...prefs.trackIds, id],
      })
    },
    [prefs.trackIds, patch],
  )

  /* ── render ─────────────────────────────────────────────────────────── */

  const noSections = prefs.sections.length === 0
  const truncated = model?.strings.truncatedNote ?? ''

  return (
    <div className="dg">
      <header className="dg-head">
        <div>
          <h1 className="page-title">{t('digest.title')}</h1>
          <p className="page-subtitle dg-sub">{t('digest.subtitle')}</p>
        </div>
      </header>

      <div className="dg-controls card">
        <Group legend={t('digest.rangeLegend')}>
          <div className="chip-row dg-chips" role="group" aria-label={t('digest.rangeLegend')}>
            {PRESETS.map((option) => (
              <button
                key={option}
                type="button"
                className="chip"
                aria-pressed={preset === option}
                onClick={() => choosePreset(option)}
              >
                {t(PRESET_KEY[option])}
              </button>
            ))}
          </div>
          {preset === 'custom' && (
            <div className="dg-dates">
              <DateInput
                label={t('digest.from')}
                value={from}
                max={to}
                onChange={(next) => setFrom(clampIso(next, EARLIEST, todayIso()))}
              />
              <DateInput
                label={t('digest.to')}
                value={to}
                max={todayIso()}
                onChange={(next) => setTo(clampIso(next, EARLIEST, todayIso()))}
              />
            </div>
          )}
          {rangeInvalid && (
            <p className="dg-err" role="alert">
              {t('digest.errRange')}
            </p>
          )}
        </Group>

        <Group legend={t('digest.tracksLegend')} hint={t('digest.tracksHint')}>
          <div className="chip-row dg-chips" role="group" aria-label={t('digest.tracksLegend')}>
            <button
              type="button"
              className="chip"
              aria-pressed={prefs.trackIds.length === 0}
              onClick={() => patch({ trackIds: [] })}
            >
              {t('common.all')}
            </button>
            {tracks.map((track) => (
              <button
                key={track.id}
                type="button"
                className="chip dg-track"
                aria-pressed={prefs.trackIds.includes(track.id)}
                onClick={() => toggleTrack(track.id)}
              >
                <TrackDot trackId={track.id} variant="dot" showLabel />
              </button>
            ))}
          </div>
        </Group>

        <Group legend={t('digest.sectionsLegend')} hint={t('digest.sectionsHint')}>
          <div className="chip-row dg-chips" role="group" aria-label={t('digest.sectionsLegend')}>
            {SECTION_ORDER.map((kind) => (
              <button
                key={kind}
                type="button"
                className="chip"
                aria-pressed={prefs.sections.includes(kind)}
                onClick={() => toggleSection(kind)}
              >
                {t(SECTION_KEY[kind])}
                {/* The count is what makes a toggle honest: it says exactly how
                    many rows switching this off removes from the report. */}
                <span className="dg-count tabular">{model?.totals.bySection[kind] ?? 0}</span>
              </button>
            ))}
          </div>
          {noSections && (
            <p className="dg-err" role="alert">
              {t('digest.errNoSections')}
            </p>
          )}
        </Group>

        <Group legend={t('digest.optionsLegend')}>
          <Toggle
            label={t('digest.includeNotes')}
            checked={prefs.includeNotes}
            onChange={(v) => patch({ includeNotes: v })}
          />
          <Toggle
            label={t('digest.includeTags')}
            hint={t('digest.includeTagsHint')}
            checked={prefs.includeTags}
            onChange={(v) => patch({ includeTags: v })}
          />
          <Toggle
            label={t('digest.includeEmptyTracks')}
            checked={prefs.includeEmptyTracks}
            onChange={(v) => patch({ includeEmptyTracks: v })}
          />
        </Group>

        <Group legend={t('digest.langLegend')} hint={t('digest.langHint')}>
          <div className="chip-row dg-chips" role="group" aria-label={t('digest.langLegend')}>
            <button
              type="button"
              className="chip"
              aria-pressed={docLocale === 'en'}
              onClick={() => patch({ docLocale: 'en' })}
            >
              {t('digest.langEn')}
            </button>
            <button
              type="button"
              className="chip"
              aria-pressed={docLocale === 'ar'}
              onClick={() => patch({ docLocale: 'ar' })}
            >
              {t('digest.langAr')}
            </button>
          </div>
        </Group>
      </div>

      <div className="dg-outbar">
        <div className="chip-row dg-chips" role="group" aria-label={t('digest.formatLegend')}>
          {DIGEST_FORMATS.map((format) => (
            <button
              key={format}
              type="button"
              className="chip"
              aria-pressed={prefs.format === format}
              title={t(FORMAT_HINT_KEY[format])}
              onClick={() => patch({ format })}
            >
              {t(FORMAT_KEY[format])}
            </button>
          ))}
        </div>

        <div className="dg-actions">
          {prefs.format === 'html' && (
            <div className="chip-row dg-chips" role="group" aria-label={t('digest.previewLegend')}>
              <button
                type="button"
                className="chip"
                aria-pressed={htmlView === 'source'}
                onClick={() => setHtmlView('source')}
              >
                {t('digest.previewSource')}
              </button>
              <button
                type="button"
                className="chip"
                aria-pressed={htmlView === 'rendered'}
                onClick={() => setHtmlView('rendered')}
              >
                {t('digest.previewRendered')}
              </button>
            </div>
          )}
          {/* Words, not glyphs: components/icons.tsx is a single-owner file this
              worker may not open, and "copy", "download" and "print" are three
              of the most-guessed-wrong icons there are. */}
          <button type="button" className="btn btn-sm" disabled={output === ''} onClick={() => void copy()}>
            {t('common.copy')}
          </button>
          {prefs.format === 'html' && (
            <button
              type="button"
              className="btn btn-sm"
              disabled={output === ''}
              onClick={() => void copyRich()}
            >
              {t('digest.copyRich')}
            </button>
          )}
          <button type="button" className="btn btn-sm" disabled={output === ''} onClick={download}>
            {t('common.download')}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            disabled={output === ''}
            onClick={() => window.print()}
          >
            {t('digest.print')}
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={refresh}>
            {t('digest.refresh')}
          </button>
        </div>
      </div>

      {truncated !== '' && (
        <p className="dg-warn" role="status">
          {truncated}
        </p>
      )}

      <section className="dg-pane card" aria-label={t('digest.outputLabel')} aria-busy={loading}>
        {error !== null ? (
          <EmptyState
            icon={<IconFile size={30} />}
            title={t('digest.errLoad')}
            description={t(error)}
            action={
              <button type="button" className="btn" onClick={refresh}>
                {t('common.retry')}
              </button>
            }
          />
        ) : loading && rows === null ? (
          <div className="dg-loading">
            <p className="muted">{t('digest.loadingData')}</p>
            <Skeleton count={6} width="86%" />
          </div>
        ) : model === null || noSections ? (
          <EmptyState
            icon={<IconFile size={30} />}
            title={t('digest.emptyTitle')}
            description={t('digest.emptyHint')}
          />
        ) : prefs.format === 'html' && htmlView === 'rendered' ? (
          // `sandbox=""` with no allow-* tokens: the document is ours and every
          // user string in it is escaped, but a preview pane is not the place to
          // grant script or same-origin access to a string that will later be
          // pasted into someone's mail client.
          <iframe
            className="dg-frame"
            title={t('digest.previewFrame')}
            sandbox=""
            srcDoc={output}
          />
        ) : (
          <>
            {/*
              The pane carries the DOCUMENT's direction, which may differ from
              the app's — that is the point of the language switch, and it is
              how the RTL check in the acceptance gate is done.

              The one exception is the HTML SOURCE view. Markdown and plain text
              are prose with a little punctuation and read correctly in the
              document's own direction; HTML source is markup in a
              Latin-syntax language, and rendering `<li style="…">` right to
              left scatters the angle brackets and quotes across the line.
              Arabic runs inside it still render RTL on their own, because that
              is what a bidi paragraph does.
            */}
            <pre
              className="dg-out digest-output"
              dir={prefs.format === 'html' ? 'ltr' : model.dir}
              lang={model.locale}
            >
              {output}
            </pre>
            <p className="dg-meta muted tabular">{t('digest.size', { count: output.length })}</p>
          </>
        )}
      </section>
    </div>
  )
}

/* ──────────────────────────────── pieces ────────────────────────────────── */

function Group({
  legend,
  hint,
  children,
}: {
  legend: string
  hint?: string
  children: ReactNode
}): ReactElement {
  return (
    <fieldset className="dg-group">
      <legend className="dg-legend">{legend}</legend>
      {children}
      {hint !== undefined && <p className="dg-hint">{hint}</p>}
    </fieldset>
  )
}

/**
 * A `role="switch"` button over the `.switch` global primitive.
 *
 * A real `<input type="checkbox">` would need its own appearance reset in a
 * sheet that is not allowed to style form primitives; `.switch` exists in
 * global.css for exactly this and had no caller until now. The whole row is the
 * control, so the label is a tap target too — the 44px rule with a 26px switch.
 */
function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (next: boolean) => void
}): ReactElement {
  const id = useId()
  return (
    <button
      type="button"
      className="dg-toggle"
      role="switch"
      aria-checked={checked}
      aria-describedby={hint === undefined ? undefined : id}
      onClick={() => onChange(!checked)}
    >
      <span className="dg-toggle-text">
        <span className="dg-toggle-label">{label}</span>
        {hint !== undefined && (
          <span className="dg-hint" id={id}>
            {hint}
          </span>
        )}
      </span>
      {/* `aria-checked` is repeated on the visual element because that is the
          CONTRACT of global.css's `.switch` primitive — its checked rules key
          off the attribute, and digest.css owns `.dg-*` and may not restyle
          another sheet's primitive. The span is aria-hidden, so the duplicate
          is a styling hook and never reaches the accessibility tree; the
          button above is the only thing announced. */}
      <span className="switch" aria-hidden="true" aria-checked={checked} />
    </button>
  )
}

/**
 * A bare `<input type="date">`.
 *
 * `components/fields/DateField` is the app's date control and is the right
 * choice inside an entry form — it carries a clear button, quick-set chips and
 * a nullable value, none of which a required range bound wants. The native
 * input's value is `YYYY-MM-DD` in every locale, which is the IsoDate this
 * screen passes straight through.
 */
function DateInput({
  label,
  value,
  max,
  onChange,
}: {
  label: string
  value: IsoDate
  max: IsoDate
  onChange: (next: IsoDate) => void
}): ReactElement {
  const id = useId()
  return (
    <div className="dg-date">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="date"
        className="input"
        value={value}
        min={EARLIEST}
        max={max}
        onChange={(event) => {
          const next = event.target.value
          // An empty or half-typed value arrives on every keystroke in a
          // keyboard-entered date; ignoring it keeps the fetch from firing
          // against `0002-07-2`.
          if (/^\d{4}-\d{2}-\d{2}$/.test(next)) onChange(next)
        }}
      />
    </div>
  )
}
