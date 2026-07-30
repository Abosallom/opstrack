// Recurring items (/settings/recurring) — the admin surface over
// `recurring_templates`, `materialize_template()` and the nightly
// `materialize_due_recurring()` pass.
//
// A TEMPLATE IS A RECIPE, NOT AN ITEM. That distinction drives the whole
// screen: nothing here appears in follow-ups or on the board, and the only
// thing an editor changes is what tomorrow's entries will look like. So every
// control is answered by the next-runs preview beside it — the question people
// actually have is "when will this fire", and the only honest way to answer it
// is to show the dates.
//
// THE PREVIEW AND THE WRITER ARE ONE FUNCTION. `resolveSchedule()` in
// lib/recurrence.ts resolves the five schedule columns; this screen renders its
// output and api/templates.ts stores it. A preview with its own copy of the
// rules would be wrong in exactly the case that matters — a monthly template
// anchored on the 31st, where storing `day_of_month` is the difference between
// recovering to the 31st and sticking on the 28th forever.
//
// NOT AN ADMIN-ONLY SCREEN, and that is a deliberate departure from
// TracksAdmin/VocabularyAdmin. 0001's RLS: select/insert/update are
// `is_member()`, DELETE alone is `is_admin()`. Templates carry no `created_by`,
// so there is no author to scope writes to, and the table's own comment says
// "any member may author and tune one, admins alone may destroy one". Only the
// Delete button is gated, and a member is told why rather than being shown a
// button that always 42501s.
//
// ── THE TWO KINDS OF "IN THE PAST", KEPT APART ─────────────────────────────
//
// They look identical on a date field and mean opposite things, and conflating
// them is docs/FIX-BACKLOG.md C2 in one direction and lost work in the other.
//
//  * AN ANCHOR THE USER JUST TYPED that is already past is a mistake. Left
//    alone it makes the catch-up loop mint one entry per missed occurrence, up
//    to sixty (reproduced live, inside a rollback, during this build).
//    api/templates.ts clamps it forward — and this screen previews the clamp
//    BEFORE the save, because a date field that silently stores a different
//    date is a date field that lies.
//  * AN ANCHOR ALREADY IN THE ROW that is past is a catch-up that is OWED —
//    the archived-track case ADMIN.md documents. So `submitUpdate()` drops
//    `nextRunOn` from the patch when the editor did not touch it, the preview
//    stops clamping in that case, and the row surfaces the backlog with a count
//    and an explicit "skip ahead" instead. Editing the title of a template that
//    is four runs behind must not quietly cancel those four runs.
//
// RUN NOW IS IDEMPOTENT AND SAYS SO. `materialize_template()` anchors the due
// date to `current_date + lead_days`, so the `(template_id, due_date)` unique
// index absorbs a second call and the same entry id comes back — verified live:
// five calls, one entry, `next_run_on` untouched on a template that was not
// due. There is therefore no confirmation dialog: the act is neither
// destructive nor duplicable, and a dialog in front of a safe button trains
// people to dismiss dialogs.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Link } from 'react-router-dom'
import { IconArrowStart, IconClock } from '../../components/icons'
import { EmptyState, Skeleton } from '../../components/shared'
import { confirm } from '../../components/Confirm'
import { toast } from '../../components/toast'
import { DateField, TextField } from '../../components/fields'
import {
  OptionGroup,
  OwnerPicker,
  PriorityPicker,
  TrackPicker,
  TypePicker,
  type OwnerValue,
  type PickerOption,
} from '../../components/pickers'
import {
  countTemplateEntries,
  createTemplate,
  deleteTemplate,
  listTemplates,
  runTemplateNow,
  setTemplateActive,
  skipToNextRun,
  updateTemplate,
  type NewTemplate,
} from '../../api/templates'
import {
  formatDate,
  formatWeekday,
  isoWeekday,
  parseIsoDate,
  todayIso,
  type IsoDate,
} from '../../lib/dates'
import { t, useLocale } from '../../lib/i18n'
import { useTrackLabel } from '../../lib/labels'
import {
  CADENCES,
  CATCHUP_CAP,
  MAX_INTERVAL_DAYS,
  MAX_LEAD_DAYS,
  MIN_INTERVAL_DAYS,
  MIN_LEAD_DAYS,
  alignRun,
  cadenceFields,
  clampFirstRun,
  dueDateFor,
  pendingRuns,
  resolveSchedule,
  runsFrom,
} from '../../lib/recurrence'
import { trackVars } from '../../lib/trackStyle'
import { useAuth } from '../../store/auth'
import { useTrackMap } from '../../store/config'
import { refreshEntries } from '../../store/entries'
import { openEntry } from '../../store/entrySheet'
import { useVocabLabel } from '../../store/vocab'
import type { Cadence, EntryPriority, EntryType, RecurringTemplate } from '../../types'
import './recurring.css'

/** How many runs the preview shows. Five is a schedule; ten is a calendar. */
const PREVIEW_COUNT = 5

const DAY_OF_MONTH_MIN = 1
const DAY_OF_MONTH_MAX = 31

const CADENCE_LABEL: Readonly<Record<Cadence, string>> = {
  daily: 'recurring.cadenceDaily',
  weekly: 'recurring.cadenceWeekly',
  biweekly: 'recurring.cadenceBiweekly',
  monthly: 'recurring.cadenceMonthly',
  quarterly: 'recurring.cadenceQuarterly',
  custom: 'recurring.cadenceCustom',
}

/**
 * One real date per weekday, so the weekday chips are named by
 * `formatWeekday()` rather than by seven more locale keys.
 *
 * The platform already knows what Wednesday is called in both languages and
 * every date on this screen is formatted through that same Intl formatter, so
 * hand-written names would be a second vocabulary able to disagree with the
 * dates directly beside them. 2026-08-09 is a Sunday, index 0, matching
 * `isoWeekday()` and `day_of_week`'s own `0 = Sunday` comment in 0001.
 */
const WEEKDAY_SAMPLE: readonly IsoDate[] = [
  '2026-08-09',
  '2026-08-10',
  '2026-08-11',
  '2026-08-12',
  '2026-08-13',
  '2026-08-14',
  '2026-08-15',
]

/** The calendar day an ISO date falls on, or null. Never `slice(8, 10)`. */
function dayOfMonthOf(iso: IsoDate | null): number | null {
  return iso === null ? null : (parseIsoDate(iso)?.getDate() ?? null)
}

/** The editor's state. Numbers are strings — an empty field is a real value. */
interface Draft {
  title: string
  trackId: string | null
  type: EntryType
  priority: EntryPriority
  owner: OwnerValue
  cadence: Cadence
  intervalDays: string
  dayOfWeek: number | null
  dayOfMonth: string
  /** null while the date input is empty; the form refuses to submit then. */
  nextRunOn: IsoDate | null
  leadDays: string
}

type DraftField = 'title' | 'intervalDays' | 'dayOfMonth' | 'nextRunOn' | 'leadDays'
type DraftErrors = Partial<Record<DraftField, string>>

function draftOf(row: RecurringTemplate | null): Draft {
  if (!row) {
    return {
      title: '',
      trackId: null,
      type: 'action',
      priority: 'medium',
      owner: { ownerId: null, ownerName: null },
      cadence: 'weekly',
      intervalDays: '7',
      dayOfWeek: null,
      dayOfMonth: '',
      // Today, not empty: a new template almost always means to start now, and
      // an empty required date is a form that opens already invalid.
      nextRunOn: todayIso(),
      leadDays: '0',
    }
  }
  return {
    title: row.title,
    trackId: row.track_id,
    type: row.type,
    priority: row.priority,
    owner: { ownerId: row.owner_id, ownerName: row.owner_name },
    cadence: row.cadence,
    intervalDays: row.custom_interval_days === null ? '7' : String(row.custom_interval_days),
    dayOfWeek: row.day_of_week,
    dayOfMonth: row.day_of_month === null ? '' : String(row.day_of_month),
    nextRunOn: row.next_run_on,
    leadDays: String(row.lead_days),
  }
}

/** '' → null, digits → the number, anything else → 'bad'. VocabularyAdmin's shape. */
function parseCount(raw: string): number | null | 'bad' {
  const text = raw.trim()
  if (text === '') return null
  if (!/^\d+$/.test(text)) return 'bad'
  const value = Number(text)
  return Number.isSafeInteger(value) ? value : 'bad'
}

function outOfRange(value: number | null | 'bad', min: number, max: number): boolean {
  if (value === 'bad') return true
  if (value === null) return false
  return value < min || value > max
}

/** i18n KEYS, not sentences — every caller renders them through t(). */
function validate(draft: Draft): DraftErrors {
  const errors: DraftErrors = {}
  if (draft.title.trim() === '') errors.title = 'recurring.errTitleRequired'
  if (draft.nextRunOn === null || parseIsoDate(draft.nextRunOn) === null) {
    errors.nextRunOn = 'recurring.errFirstRun'
  }
  const fields = cadenceFields(draft.cadence)
  if (fields.interval) {
    const interval = parseCount(draft.intervalDays)
    // Required for this cadence: "every ⟨nothing⟩ days" has no meaning, and the
    // column's silent `greatest(coalesce(…,1),1)` would read a blank as daily.
    if (interval === null || outOfRange(interval, MIN_INTERVAL_DAYS, MAX_INTERVAL_DAYS)) {
      errors.intervalDays = 'recurring.errInterval'
    }
  }
  if (fields.dayOfMonth && outOfRange(parseCount(draft.dayOfMonth), DAY_OF_MONTH_MIN, DAY_OF_MONTH_MAX)) {
    errors.dayOfMonth = 'recurring.errDayOfMonth'
  }
  if (outOfRange(parseCount(draft.leadDays), MIN_LEAD_DAYS, MAX_LEAD_DAYS)) {
    errors.leadDays = 'recurring.errLead'
  }
  return errors
}

/** Draft → the api write view-model. Only called once the draft validates. */
function toInput(draft: Draft): NewTemplate {
  const fields = cadenceFields(draft.cadence)
  const interval = parseCount(draft.intervalDays)
  const dayOfMonth = parseCount(draft.dayOfMonth)
  const lead = parseCount(draft.leadDays)
  return {
    title: draft.title.trim(),
    trackId: draft.trackId,
    type: draft.type,
    priority: draft.priority,
    ownerId: draft.owner.ownerId,
    ownerName: draft.owner.ownerId ? null : draft.owner.ownerName,
    cadence: draft.cadence,
    customIntervalDays: fields.interval && typeof interval === 'number' ? interval : null,
    dayOfWeek: fields.dayOfWeek ? draft.dayOfWeek : null,
    dayOfMonth: fields.dayOfMonth && typeof dayOfMonth === 'number' ? dayOfMonth : null,
    nextRunOn: draft.nextRunOn ?? todayIso(),
    leadDays: typeof lead === 'number' ? lead : 0,
  }
}

// ── the editor ─────────────────────────────────────────────────────────────

interface EditorProps {
  /** null = create. Non-null = edit that row. */
  template: RecurringTemplate | null
  busy: boolean
  onDirtyChange: (dirty: boolean) => void
  onSubmit: (input: NewTemplate) => void
  onCancel: () => void
}

/**
 * One form, both jobs. Create and edit differ only in where the draft starts,
 * what the submit button says, and whether the anchor is clamped: the fields,
 * the validation and the preview are the same decision either way, and two
 * forms is two places to edit the day a field is added.
 */
function TemplateEditor({
  template,
  busy,
  onDirtyChange,
  onSubmit,
  onCancel,
}: EditorProps): ReactElement {
  const locale = useLocale()
  // One `draftOf()` call, shared: two calls would each read the clock, and a
  // form opened at 23:59:59.9 would open already dirty.
  const [baseline] = useState<Draft>(() => draftOf(template))
  const [draft, setDraft] = useState<Draft>(baseline)
  const [touched, setTouched] = useState<Partial<Record<DraftField, boolean>>>({})
  const [submitted, setSubmitted] = useState(false)
  const firstField = useRef<HTMLDivElement>(null)

  const errors = validate(draft)
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline)

  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])

  // The Edit button is several controls away from the field the user came to
  // type in, and on a 375px screen the panel opens below the fold.
  useEffect(() => {
    firstField.current?.querySelector('input')?.focus()
  }, [])

  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void => {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const fields = cadenceFields(draft.cadence)
  const shows = (key: DraftField): string | undefined =>
    submitted || touched[key] ? errors[key] : undefined

  /**
   * Clamp the anchor only when this editor MOVED it — the header's two kinds of
   * "in the past". A template that is behind because its track was archived
   * keeps its backlog when someone opens the form to fix a typo, and the
   * preview shows that real backlog rather than the schedule a clamp would
   * impose. `submitUpdate()` drops `nextRunOn` from the patch on the same test.
   */
  const anchorMoved = template === null || draft.nextRunOn !== template.next_run_on

  /** What will actually be stored, through the same function that stores it. */
  const resolved = useMemo(
    () =>
      draft.nextRunOn === null || parseIsoDate(draft.nextRunOn) === null
        ? null
        : resolveSchedule(toInput(draft), anchorMoved),
    [draft, anchorMoved],
  )

  const preview = useMemo(() => {
    if (!resolved) return []
    const lead = parseCount(draft.leadDays)
    const leadDays = typeof lead === 'number' ? lead : 0
    return runsFrom(
      resolved.nextRunOn,
      resolved.cadence,
      resolved.customIntervalDays,
      resolved.dayOfWeek,
      resolved.dayOfMonth,
      PREVIEW_COUNT,
    ).map((run) => ({ run, due: dueDateFor(run, leadDays) }))
  }, [resolved, draft.leadDays])

  /**
   * A pin takes effect only from the SECOND run — `advance_recurrence()`
   * applies the weekday nudge after the step — so an anchor that does not match
   * the pin produces one odd first interval. Offer the move and say what it
   * does, rather than silently rewriting the date the user typed.
   */
  const aligned = useMemo(() => {
    if (draft.nextRunOn === null) return null
    const dom = parseCount(draft.dayOfMonth)
    const next = alignRun(
      draft.nextRunOn,
      draft.cadence,
      fields.dayOfWeek ? draft.dayOfWeek : null,
      fields.dayOfMonth && typeof dom === 'number' ? dom : null,
    )
    return next === draft.nextRunOn ? null : next
  }, [draft.nextRunOn, draft.cadence, draft.dayOfWeek, draft.dayOfMonth, fields])

  const cadenceOptions: PickerOption[] = CADENCES.map((c) => ({
    key: c,
    label: t(CADENCE_LABEL[c]),
  }))
  const weekdayOptions: PickerOption[] = WEEKDAY_SAMPLE.map((iso, index) => ({
    key: String(index),
    label: formatWeekday(iso, locale, 'long'),
  }))

  return (
    <form
      className="rec-editor"
      // A named form landmark. Without it a screen reader lands in a stack of
      // eleven controls with no statement of what is being edited — and on this
      // screen several rows can look alike, so "the open one" is not obvious
      // from the fields alone.
      aria-label={
        template ? t('recurring.editTitle', { title: template.title }) : t('recurring.newTitle')
      }
      onSubmit={(e) => {
        e.preventDefault()
        setSubmitted(true)
        if (Object.keys(validate(draft)).length > 0) return
        onSubmit(toInput(draft))
      }}
    >
      <div ref={firstField}>
        <TextField
          label={t('recurring.fieldTitle')}
          value={draft.title}
          onChange={(v) => set('title', v)}
          placeholder={t('recurring.fieldTitlePlaceholder')}
          hint={t('recurring.fieldTitleHint')}
          error={shows('title') ? t('recurring.errTitleRequired') : undefined}
          maxLength={200}
          disabled={busy}
        />
      </div>

      <div className="rec-grid">
        <div className="field">
          <span className="field-label">{t('recurring.fieldTrack')}</span>
          <TrackPicker
            label={t('recurring.fieldTrack')}
            value={draft.trackId}
            onChange={(v) => set('trackId', v)}
            clearLabel={t('recurring.noTrack')}
            disabled={busy}
          />
        </div>
        <div className="field">
          <span className="field-label">{t('recurring.fieldOwner')}</span>
          <OwnerPicker
            label={t('recurring.fieldOwner')}
            value={draft.owner}
            onChange={(v) => set('owner', v)}
            unassignedLabel={t('recurring.ownerUnassigned')}
            otherLabel={t('recurring.ownerExternal')}
            namePlaceholder={t('recurring.ownerExternalPlaceholder')}
            disabled={busy}
          />
        </div>
        <div className="field">
          <span className="field-label">{t('recurring.fieldType')}</span>
          <TypePicker
            label={t('recurring.fieldType')}
            value={draft.type}
            onChange={(v) => set('type', v)}
            disabled={busy}
          />
        </div>
        <div className="field">
          <span className="field-label">{t('recurring.fieldPriority')}</span>
          <PriorityPicker
            label={t('recurring.fieldPriority')}
            value={draft.priority}
            onChange={(v) => set('priority', v)}
            disabled={busy}
          />
        </div>
      </div>

      <fieldset className="rec-fieldset">
        <legend className="field-label">{t('recurring.cadence')}</legend>
        <OptionGroup
          label={t('recurring.cadence')}
          options={cadenceOptions}
          value={draft.cadence}
          disabled={busy}
          onChange={(key) => {
            if (key === null) return
            const cadence = key as Cadence
            const next = cadenceFields(cadence)
            setDraft((current) => ({
              ...current,
              cadence,
              // Seed the pin the NEW cadence reads from the anchor. Switching to
              // monthly with an empty day-of-month would otherwise leave the
              // database to re-derive it from a date that then drifts — the
              // "sticks on the 28th" behaviour lib/recurrence.ts documents.
              dayOfWeek:
                next.dayOfWeek && current.dayOfWeek === null && current.nextRunOn !== null
                  ? isoWeekday(current.nextRunOn)
                  : current.dayOfWeek,
              dayOfMonth:
                next.dayOfMonth && current.dayOfMonth === ''
                  ? String(dayOfMonthOf(current.nextRunOn) ?? '')
                  : current.dayOfMonth,
            }))
          }}
        />
      </fieldset>

      {fields.interval && (
        <div className="field">
          <label className="field-label" htmlFor="rec-interval">
            {t('recurring.intervalDays')}
          </label>
          <input
            id="rec-interval"
            className="input tabular rec-number"
            type="number"
            inputMode="numeric"
            // A day count is a Latin numeral in both languages (spec §5), and
            // it reads back to front inside an RTL paragraph without this.
            dir="ltr"
            min={MIN_INTERVAL_DAYS}
            max={MAX_INTERVAL_DAYS}
            step={1}
            value={draft.intervalDays}
            disabled={busy}
            aria-invalid={shows('intervalDays') ? true : undefined}
            onChange={(e) => set('intervalDays', e.target.value)}
            onBlur={() => setTouched((c) => ({ ...c, intervalDays: true }))}
          />
          {shows('intervalDays') ? (
            <p className="field-error">
              {t('recurring.errInterval', { min: MIN_INTERVAL_DAYS, max: MAX_INTERVAL_DAYS })}
            </p>
          ) : (
            <p className="rec-hint">{t('recurring.intervalHint')}</p>
          )}
        </div>
      )}

      {fields.dayOfWeek && (
        <fieldset className="rec-fieldset">
          <legend className="field-label">{t('recurring.dayOfWeek')}</legend>
          <OptionGroup
            label={t('recurring.dayOfWeek')}
            options={weekdayOptions}
            value={draft.dayOfWeek === null ? null : String(draft.dayOfWeek)}
            disabled={busy}
            onChange={(key) => set('dayOfWeek', key === null ? null : Number(key))}
          />
          <p className="rec-hint">{t('recurring.dayOfWeekHint')}</p>
        </fieldset>
      )}

      {fields.dayOfMonth && (
        <div className="field">
          <label className="field-label" htmlFor="rec-dom">
            {t('recurring.dayOfMonth')}
          </label>
          <input
            id="rec-dom"
            className="input tabular rec-number"
            type="number"
            inputMode="numeric"
            dir="ltr"
            min={DAY_OF_MONTH_MIN}
            max={DAY_OF_MONTH_MAX}
            step={1}
            value={draft.dayOfMonth}
            disabled={busy}
            aria-invalid={shows('dayOfMonth') ? true : undefined}
            onChange={(e) => set('dayOfMonth', e.target.value)}
            onBlur={() => setTouched((c) => ({ ...c, dayOfMonth: true }))}
          />
          {shows('dayOfMonth') ? (
            <p className="field-error">
              {t('recurring.errDayOfMonth', { min: DAY_OF_MONTH_MIN, max: DAY_OF_MONTH_MAX })}
            </p>
          ) : (
            <p className="rec-hint">{t('recurring.dayOfMonthHint')}</p>
          )}
          <p className="rec-hint">{t('recurring.dayOfMonthClamp')}</p>
        </div>
      )}

      <div className="rec-grid">
        <DateField
          label={t('recurring.firstRun')}
          value={draft.nextRunOn}
          onChange={(v) => set('nextRunOn', v)}
          hint={t('recurring.firstRunHint')}
          error={shows('nextRunOn') ? t('recurring.errFirstRun') : undefined}
          disabled={busy}
        />
        <div className="field">
          <label className="field-label" htmlFor="rec-lead">
            {t('recurring.leadDays')}
          </label>
          <input
            id="rec-lead"
            className="input tabular rec-number"
            type="number"
            inputMode="numeric"
            dir="ltr"
            min={MIN_LEAD_DAYS}
            max={MAX_LEAD_DAYS}
            step={1}
            value={draft.leadDays}
            disabled={busy}
            aria-invalid={shows('leadDays') ? true : undefined}
            onChange={(e) => set('leadDays', e.target.value)}
            onBlur={() => setTouched((c) => ({ ...c, leadDays: true }))}
          />
          {shows('leadDays') ? (
            <p className="field-error">
              {t('recurring.errLead', { min: MIN_LEAD_DAYS, max: MAX_LEAD_DAYS })}
            </p>
          ) : (
            <p className="rec-hint">{t('recurring.leadHint')}</p>
          )}
        </div>
      </div>

      {/* The clamp, shown before the save rather than reported after it.
          role="status", not alert: it follows the user's own edit rather than
          interrupting what they are reading. */}
      {resolved?.clamped && (
        <p className="rec-clamp" role="status">
          {t('recurring.clamped', { date: formatDate(resolved.nextRunOn, locale) })}
        </p>
      )}

      {aligned && draft.nextRunOn && (
        <div className="rec-align" role="status">
          <p className="rec-align-text">
            {t('recurring.alignPrompt', {
              from: formatWeekday(draft.nextRunOn, locale, 'long'),
              date: formatDate(aligned, locale),
              target: formatWeekday(aligned, locale, 'long'),
            })}
          </p>
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy}
            onClick={() => set('nextRunOn', aligned)}
          >
            {t('recurring.alignApply')}
          </button>
        </div>
      )}

      <section className="rec-preview" aria-labelledby="rec-preview-h">
        <p className="field-label" id="rec-preview-h">
          {t('recurring.previewTitle')}
        </p>
        {preview.length === 0 ? (
          <p className="rec-hint">{t('recurring.previewNone')}</p>
        ) : (
          <>
            <ol className="rec-preview-list">
              {preview.map(({ run, due }) => (
                <li className="rec-preview-row" key={run}>
                  <span className="rec-preview-run tabular">{formatDate(run, locale)}</span>
                  <span className="rec-preview-due tabular">
                    {run === due
                      ? t('recurring.previewSameDay')
                      : t('recurring.previewDue', { date: formatDate(due, locale) })}
                  </span>
                </li>
              ))}
            </ol>
            <p className="rec-hint">{t('recurring.previewHint')}</p>
          </>
        )}
      </section>

      <div className="rec-editor-actions">
        {dirty && <span className="pill warn">{t('recurring.unsaved')}</span>}
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
          {template
            ? t(busy ? 'recurring.saving' : 'recurring.save')
            : t(busy ? 'recurring.creating' : 'recurring.create')}
        </button>
        <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  )
}

// ── the screen ─────────────────────────────────────────────────────────────

export default function RecurringAdmin(): ReactElement {
  const locale = useLocale()
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const trackMap = useTrackMap()
  const trackLabel = useTrackLabel()
  const vocabLabel = useVocabLabel()

  const [rows, setRows] = useState<RecurringTemplate[] | null>(null)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  /** The row whose editor is open. `creating` is the same slot, for a new one. */
  const [openId, setOpenId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [rowError, setRowError] = useState<{ id: string; key: string } | null>(null)
  const [liveMessage, setLiveMessage] = useState('')

  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  /** The open editor's unsaved state, so switching rows can guard it. */
  const dirty = useRef(false)
  const onDirtyChange = useCallback((next: boolean) => {
    dirty.current = next
  }, [])

  const load = useCallback(async () => {
    setErrorKey(null)
    const result = await listTemplates()
    if (!alive.current) return
    if (!result.ok) {
      setErrorKey(result.error)
      setRows([])
      return
    }
    setRows(result.data)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /** Resolves true when it is safe to drop whatever is in the open editor. */
  const confirmDiscard = useCallback(async (): Promise<boolean> => {
    if (!dirty.current) return true
    const ok = await confirm({
      title: t('recurring.discardTitle'),
      body: t('recurring.discardBody'),
      confirmLabel: t('recurring.discard'),
      cancelLabel: t('common.cancel'),
      danger: true,
    })
    return ok && alive.current
  }, [])

  /**
   * The control that opened the editor, so closing it can hand focus back.
   *
   * TemplateEditor focuses its first field on open (see its own effect); every
   * way OUT of it — Cancel, Save, Escape'd discard — unmounts the subtree the
   * focus is inside, and focus then falls to <body> so the next Tab restarts at
   * the top of the document (WCAG 2.4.3). Both openers (a row's Edit button and
   * the page's Add button) stay mounted the whole time, so the node stored here
   * is still live when the editor goes away.
   */
  const opener = useRef<HTMLElement | null>(null)
  /** The toolbar's Add button — always mounted, so it is the safe fallback. */
  const addRef = useRef<HTMLButtonElement>(null)
  /** Where focus goes once the editor has actually gone. */
  const returnFocus = useRef<HTMLElement | null>(null)

  const closeEditor = useCallback((): void => {
    dirty.current = false
    returnFocus.current = opener.current ?? addRef.current
    opener.current = null
    setOpenId(null)
    setCreating(false)
  }, [])

  /**
   * AFTER the render that removed the editor, not during the handler that asked
   * for it — because the Add button is `disabled` while `creating` is true, and
   * focusing a disabled control does nothing at all. Waiting one commit is what
   * makes the create path work as well as the edit path.
   */
  useEffect(() => {
    if (openId !== null || creating) return
    const back = returnFocus.current
    if (back === null) return
    returnFocus.current = null
    back.focus()
  }, [openId, creating])

  const cancelEditor = useCallback(async (): Promise<void> => {
    if (await confirmDiscard()) closeEditor()
  }, [confirmDiscard, closeEditor])

  async function toggleEdit(id: string, from: HTMLElement | null): Promise<void> {
    if (!(await confirmDiscard())) return
    dirty.current = false
    setCreating(false)
    setRowError(null)
    const closing = openId === id
    // Closing from the same button leaves focus where it already is; opening
    // records where to come back to.
    opener.current = closing ? null : from
    setOpenId(closing ? null : id)
  }

  async function beginCreate(from: HTMLElement | null): Promise<void> {
    if (!(await confirmDiscard())) return
    dirty.current = false
    setOpenId(null)
    setRowError(null)
    opener.current = from
    setCreating(true)
  }

  /** Replace one row in place — every mutation returns the row it wrote. */
  function applyRow(next: RecurringTemplate): void {
    setRows((current) => (current ? current.map((r) => (r.id === next.id ? next : r)) : current))
  }

  /**
   * pgErrorKey's catch-all says less than this screen's own headline; anything
   * more specific (recurring.errNotFound, admin.errForbidden,
   * common.notConfigured) is worth showing verbatim.
   */
  function saveErrorKey(key: string): string {
    return key === 'common.error' ? 'recurring.errSave' : key
  }

  function failRow(id: string, key: string): void {
    setRowError({ id, key })
    toast(t(key), { tone: 'error' })
  }

  async function submitCreate(input: NewTemplate): Promise<void> {
    setSaving(true)
    const result = await createTemplate(input)
    if (!alive.current) return
    setSaving(false)
    if (!result.ok) {
      toast(t(saveErrorKey(result.error)), { tone: 'error' })
      return
    }
    closeEditor()
    // Re-read rather than prepend: listTemplates() orders by active, then next
    // run, and a locally-inserted row would sit in the wrong place until the
    // next load.
    await load()
    toast(t('recurring.createdToast'))
  }

  async function submitUpdate(row: RecurringTemplate, input: NewTemplate): Promise<void> {
    setSaving(true)
    setRowError(null)
    // The anchor is sent ONLY if the editor moved it — see this file's header.
    // Sending an untouched past anchor would clamp it, silently cancelling a
    // catch-up the template is owed.
    const patch: Partial<NewTemplate> = { ...input }
    if (input.nextRunOn === row.next_run_on) delete patch.nextRunOn
    const result = await updateTemplate(row.id, patch)
    if (!alive.current) return
    setSaving(false)
    if (!result.ok) {
      failRow(row.id, saveErrorKey(result.error))
      return
    }
    applyRow(result.data)
    closeEditor()
    toast(t('recurring.savedToast'))
  }

  async function togglePaused(row: RecurringTemplate): Promise<void> {
    setBusyId(row.id)
    setRowError(null)
    const result = await setTemplateActive(row.id, !row.active)
    if (!alive.current) return
    setBusyId(null)
    if (!result.ok) {
      failRow(row.id, saveErrorKey(result.error))
      return
    }
    applyRow(result.data)
    toast(t(result.data.active ? 'recurring.resumedToast' : 'recurring.pausedToast'))
  }

  async function runNow(row: RecurringTemplate): Promise<void> {
    setBusyId(row.id)
    setRowError(null)
    const result = await runTemplateNow(row.id)
    if (!alive.current) return
    setBusyId(null)
    if (!result.ok) {
      failRow(row.id, result.error === 'common.error' ? 'recurring.errRun' : result.error)
      return
    }
    const entryId = result.data
    // The RPC advances next_run_on when the template was due and leaves it
    // alone when it was not, so the row on screen is stale either way — re-read
    // rather than guess which.
    await load()
    // The new entry belongs to the rest of the app, not to this screen.
    void refreshEntries()
    toast(
      t('recurring.ranToast'),
      entryId
        ? { action: { label: t('recurring.openItem'), onClick: () => openEntry(entryId) } }
        : {},
    )
  }

  async function skipAhead(row: RecurringTemplate): Promise<void> {
    setBusyId(row.id)
    setRowError(null)
    const result = await skipToNextRun(row.id)
    if (!alive.current) return
    setBusyId(null)
    if (!result.ok) {
      failRow(row.id, saveErrorKey(result.error))
      return
    }
    applyRow(result.data)
    toast(
      result.data.next_run_on === row.next_run_on
        ? t('recurring.skipNothingToast')
        : t('recurring.skippedToast', { date: formatDate(result.data.next_run_on, locale) }),
    )
  }

  async function remove(row: RecurringTemplate): Promise<void> {
    setBusyId(row.id)
    // Counted before the dialog, because the dialog's whole job is to say what
    // SURVIVES: `entries.template_id` is `on delete set null`, so a year of
    // completed monthly reports stays and simply stops naming this schedule.
    const used = await countTemplateEntries(row.id)
    if (!alive.current) return
    const count = used.ok ? used.data : 0
    const ok = await confirm({
      title: t('recurring.deleteTitle', { title: row.title }),
      body: count > 0 ? t('recurring.deleteBodyWithEntries', { count }) : t('recurring.deleteBody'),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      danger: true,
    })
    if (!ok || !alive.current) {
      if (alive.current) setBusyId(null)
      return
    }
    const result = await deleteTemplate(row.id)
    if (!alive.current) return
    setBusyId(null)
    if (!result.ok) {
      failRow(row.id, saveErrorKey(result.error))
      return
    }
    // The row is going away, so its Edit button is not somewhere to send focus.
    // Clearing the opener makes closeEditor() fall back to the toolbar's Add
    // button, which survives the deletion.
    opener.current = null
    if (openId === row.id) closeEditor()
    setRows((current) => (current ? current.filter((r) => r.id !== row.id) : current))
    // The toast says the act succeeded; this says the LIST changed, which is
    // the part a screen reader otherwise experiences as silence.
    setLiveMessage(t('recurring.deletedToast'))
    toast(t('recurring.deletedToast'))
  }

  /** The one-line "when does this run" sentence, from the stored columns. */
  function summaryOf(row: RecurringTemplate): string {
    const weekdaySource =
      row.day_of_week === null
        ? row.next_run_on
        : (WEEKDAY_SAMPLE[row.day_of_week] ?? row.next_run_on)
    const day = formatWeekday(weekdaySource, locale, 'long')
    const monthDay = row.day_of_month ?? dayOfMonthOf(row.next_run_on) ?? DAY_OF_MONTH_MIN
    switch (row.cadence) {
      case 'daily':
        return t('recurring.summaryDaily')
      case 'weekly':
        return t('recurring.summaryWeekly', { day })
      case 'biweekly':
        return t('recurring.summaryBiweekly', { day })
      case 'monthly':
        return t('recurring.summaryMonthly', { day: monthDay })
      case 'quarterly':
        return t('recurring.summaryQuarterly', { day: monthDay })
      default:
        return t('recurring.summaryCustom', { count: row.custom_interval_days ?? 1 })
    }
  }

  const loading = rows === null
  const list = rows ?? []
  const running = list.filter((r) => r.active)
  const paused = list.filter((r) => !r.active)
  const today = todayIso()

  /**
   * One row. A plain function, not a component: it calls no hooks, and mounting
   * it as a component would give every row its own reconciliation identity for
   * no benefit while making the closures over `busyId`/`saving` less obvious.
   */
  function renderRow(row: RecurringTemplate): ReactElement {
    const open = openId === row.id
    const busy = busyId === row.id
    const track = row.track_id ? trackMap.get(row.track_id) : undefined
    const archived = track?.archived ?? false
    // An archived track stops the scheduler for this row (0002's pass filters
    // on it), so a catch-up count would be a promise the database is not making.
    const behind = archived ? 0 : pendingRuns(row, today)
    const due = dueDateFor(row.next_run_on, row.lead_days)
    // Where "skip ahead" would actually land. NOT today: the clamp preserves
    // the schedule's phase, so a Monday template lands on the next Monday, and
    // a button promising today would be wrong on most rows that show it.
    const skipTarget = clampFirstRun(
      row.next_run_on,
      row.cadence,
      row.custom_interval_days,
      row.day_of_week,
      row.day_of_month,
      today,
    )

    return (
      <li
        key={row.id}
        className="rec-row"
        // Variants ride on data-* attributes rather than modifier classes:
        // §1.0.7 grants this sheet `.rec-*` and nothing else, so an `.is-open`
        // would be an unregistered global.
        data-paused={row.active ? undefined : 'true'}
        data-open={open ? 'true' : undefined}
        data-behind={behind > 1 ? 'true' : undefined}
      >
        <div className="rec-row-head">
          <div className="rec-row-main">
            <h3 className="rec-row-title">{row.title}</h3>
            <div className="rec-meta">
              {track ? (
                <span className="rec-track">
                  <span
                    className="track-dot"
                    style={trackVars(track.color, track.color_light)}
                    aria-hidden="true"
                  />
                  {trackLabel(track)}
                </span>
              ) : (
                <span className="rec-track">{t('recurring.noTrack')}</span>
              )}
              <span className="pill">{vocabLabel('type', row.type)}</span>
              <span className="pill">{vocabLabel('priority', row.priority)}</span>
              {!row.active && <span className="pill warn">{t('recurring.paused')}</span>}
              {behind > 1 && <span className="pill warn">{t('recurring.behind')}</span>}
              {archived && <span className="pill warn">{t('recurring.trackArchived')}</span>}
            </div>
            <div className="rec-sched">
              <span className="rec-sched-item">{summaryOf(row)}</span>
              <span className="rec-sched-item">
                <span className="rec-sched-label">{t('recurring.nextRun')}</span>
                <span className="rec-sched-value tabular">
                  {formatDate(row.next_run_on, locale)}
                </span>
              </span>
              {due !== row.next_run_on && (
                <span className="rec-sched-item">
                  <span className="rec-sched-value tabular">
                    {t('recurring.previewDue', { date: formatDate(due, locale) })}
                  </span>
                </span>
              )}
            </div>
          </div>

          <div className="rec-row-actions">
            <button
              type="button"
              className="btn btn-sm"
              aria-expanded={open}
              aria-label={t(open ? 'recurring.closeRow' : 'recurring.editRow', {
                title: row.title,
              })}
              disabled={busy || saving}
              onClick={(ev) => {
                // Read synchronously: `currentTarget` is only valid during
                // dispatch, and toggleEdit awaits a confirmation first.
                const from = ev.currentTarget
                void toggleEdit(row.id, from)
              }}
            >
              {t(open ? 'common.close' : 'common.edit')}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              aria-label={t(row.active ? 'recurring.pauseRow' : 'recurring.resumeRow', {
                title: row.title,
              })}
              disabled={busy || saving}
              onClick={() => void togglePaused(row)}
            >
              {t(row.active ? 'recurring.pause' : 'recurring.resume')}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              aria-label={t('recurring.runRow', { title: row.title })}
              title={t('recurring.runNowHint')}
              disabled={busy || saving}
              onClick={() => void runNow(row)}
            >
              {t(busy ? 'recurring.running' : 'recurring.runNow')}
            </button>
            {isAdmin && (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                aria-label={t('recurring.deleteRow', { title: row.title })}
                disabled={busy || saving}
                onClick={() => void remove(row)}
              >
                {t('common.delete')}
              </button>
            )}
          </div>
        </div>

        {archived && <p className="rec-note">{t('recurring.trackArchivedHint')}</p>}

        {/* One run behind is simply "due today" and needs no warning; two or
            more is a catch-up the next pass performs in one go. No role here:
            this is present on load rather than raised by an action, and a live
            region that announces on arrival is noise. */}
        {behind > 1 && (
          <div className="rec-behind">
            <div className="rec-behind-text">
              <p className="rec-behind-title">{t('recurring.behindCount', { count: behind })}</p>
              <p className="rec-note">{t('recurring.behindBody')}</p>
              {behind >= CATCHUP_CAP && (
                <p className="rec-note">{t('recurring.behindCapped', { cap: CATCHUP_CAP })}</p>
              )}
            </div>
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy || saving}
              onClick={() => void skipAhead(row)}
            >
              {t('recurring.skipAhead', { date: formatDate(skipTarget, locale) })}
            </button>
          </div>
        )}

        {rowError?.id === row.id && (
          <p className="field-error" role="alert">
            {t(rowError.key)}
          </p>
        )}

        {open && (
          <TemplateEditor
            key={row.id}
            template={row}
            busy={saving}
            onDirtyChange={onDirtyChange}
            onSubmit={(input) => void submitUpdate(row, input)}
            onCancel={() => void cancelEditor()}
          />
        )}
      </li>
    )
  }

  return (
    <div className="rec">
      <div className="rec-bar">
        <Link to="/settings" className="btn btn-ghost btn-sm">
          {/* A back arrow points at the reading start, so it mirrors in Arabic. */}
          <IconArrowStart className="icon-directional" size={16} />
          {t('common.back')}
        </Link>
        <button
          ref={addRef}
          type="button"
          className="btn btn-primary btn-sm"
          disabled={loading || creating}
          onClick={(ev) => {
            const from = ev.currentTarget
            void beginCreate(from)
          }}
        >
          {t('recurring.add')}
        </button>
      </div>

      {/* No page heading: App.tsx's header already renders this route's title
          as the document h1, and a second copy is noise in the outline. */}
      <div className="rec-intro">
        <p className="rec-lead">{t('recurring.subtitle')}</p>
        <p className="rec-note">{t('recurring.scheduleHint')}</p>
        <p className="rec-note">{t('recurring.leadExplainer')}</p>
      </div>

      {/* Polite, not assertive: these follow the user's own deliberate action. */}
      <p className="sr-only" role="status" aria-live="polite">
        {liveMessage}
      </p>

      {loading && <Skeleton height={104} count={3} />}

      {!loading && errorKey && (
        <div className="card rec-error" role="alert">
          <p>{t(errorKey === 'common.error' ? 'recurring.errLoad' : errorKey)}</p>
          <button type="button" className="btn btn-sm" onClick={() => void load()}>
            {t('common.retry')}
          </button>
        </div>
      )}

      {creating && (
        <section className="rec-row" data-open="true" aria-labelledby="rec-new-h">
          <h2 className="rec-row-title" id="rec-new-h">
            {t('recurring.newTitle')}
          </h2>
          <TemplateEditor
            template={null}
            busy={saving}
            onDirtyChange={onDirtyChange}
            onSubmit={(input) => void submitCreate(input)}
            onCancel={() => void cancelEditor()}
          />
        </section>
      )}

      {!loading && !errorKey && list.length === 0 && !creating && (
        <EmptyState
          icon={<IconClock size={28} />}
          title={t('recurring.emptyTitle')}
          description={t('recurring.emptyBody')}
          action={
            <button
              type="button"
              className="btn btn-primary"
              // No opener recorded: this button is inside the empty state,
              // which unmounts the moment the editor opens, so the node would
              // be detached by the time focus came back. closeEditor() falls
              // back to the toolbar's Add button, which is always mounted.
              onClick={() => void beginCreate(null)}
            >
              {t('recurring.add')}
            </button>
          }
        />
      )}

      {running.length > 0 && (
        <section className="rec-group" aria-labelledby="rec-running-h">
          <div className="rec-section">
            <h2 className="rec-section-title" id="rec-running-h">
              {t('recurring.sectionActive')}
            </h2>
            <span className="pill tabular">
              {t('recurring.countRunning', { count: running.length })}
            </span>
          </div>
          <ul className="rec-list">{running.map(renderRow)}</ul>
        </section>
      )}

      {/* Paused templates get their own section rather than being filtered out:
          pausing is reversible, and a paused template that has vanished from
          the only screen that can resume it is, in practice, deleted. */}
      {paused.length > 0 && (
        <section className="rec-group" aria-labelledby="rec-paused-h">
          <div className="rec-section">
            <h2 className="rec-section-title" id="rec-paused-h">
              {t('recurring.sectionPaused')}
            </h2>
          </div>
          <ul className="rec-list">{paused.map(renderRow)}</ul>
        </section>
      )}

      {!loading && !errorKey && list.length > 0 && !isAdmin && (
        <p className="rec-note">{t('recurring.deleteAdminOnly')}</p>
      )}
    </div>
  )
}
