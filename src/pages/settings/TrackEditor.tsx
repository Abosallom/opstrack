// Track create/edit (/settings/tracks/new and /settings/tracks/:id).
//
// A sub-route rather than a modal: this form has seven fields in two languages
// plus the SLA matrix, which is more than a sheet can hold on a 375px screen
// without scrolling behind its own footer, and a real URL means a half-written
// track survives a mis-tap and can be linked to from the list.
//
// Validation here mirrors the CHECK constraints in 0002 and 0006 so the three
// mistakes people actually make — an empty name, a mistyped hex, an SLA of 0 —
// never cost a round-trip. It does NOT replace the server's answer: the database
// is the authority, and its errors come back as i18n keys and are rendered below.
//
// TWO TABLES, ONE SAVE BUTTON. The fields above write `tracks`; the SLA
// overrides section writes `track_slas`, one row per changed priority. A form
// that saved half of itself on a different gesture would be a worse contract
// than the one extra await this costs.
//
// AND SINCE 0025, TWO TABLES MEANS TWO PERMISSIONS: `tracks` takes
// `structure.edit`, `track_slas` stays on `workspace.admin`. So the SLA section
// is rendered only to someone who holds the second key, which is what keeps the
// one save button from becoming a half-applied save for a Director. The two
// gates are `canEdit` and `canEditSlas`, both read at the top of the component.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { IconArrowStart } from '../../components/icons'
import { Skeleton } from '../../components/shared'
import { TagsField } from '../../components/fields'
import { confirm } from '../../components/Confirm'
import { toast } from '../../components/toast'
import { createTrack, listTrackSlas, setTrackSla, updateTrack } from '../../api/tracks'
import { resolveSlaDays, trackSlaKey } from '../../lib/health'
import { TRACK_ICON_NAMES, trackIcon } from '../../lib/trackIcons'
import { trackVars } from '../../lib/trackStyle'
import { rovingTabIndex, useRadioGroupKeys } from '../../lib/radioGroup'
import { t, useLocale } from '../../lib/i18n'
import { invalidateConfig, loadConfig, useTrackMap } from '../../store/config'
import { invalidateTrackSlas } from '../../store/entries'
import { loadVocab, useSlaDays, useVocabLabel } from '../../store/vocab'
import { useHasPerm } from '../../store/auth'
import type { EntryPriority, Track } from '../../types'
import './admin.css'
import './track-sla.css'

/** Mirrors the DB CHECK; the server rejects anything else with 23514. */
const HEX = /^#[0-9a-fA-F]{6}$/
const NAME_MAX = 40

/**
 * Preset colours, as dark/light pairs.
 *
 * Every pair is a token already declared in global.css, where its contrast was
 * computed against all three surfaces of BOTH themes. That is the reason the
 * grid is a fixed list rather than a colour wheel: a hue picked freehand is
 * routinely 2:1 in one theme, and a 3px identity bar nobody can see is worse
 * than no bar at all. The free hex fields below exist for when that trade-off
 * is made deliberately.
 *
 * `labelKey` is not decoration either. These are icon-only 44px controls, so the
 * accessible name is the ONLY name — and it used to be the hex, which a screen
 * reader spells out as "number sign, eight, b, seven, b, f, five". That names
 * nothing an admin can act on and gives no way to tell violet from rose without
 * sight, in either language. The hex stays visible in the two fields below for
 * anyone who wants it.
 */
const SWATCHES: readonly { dark: string; light: string; labelKey: string }[] = [
  { dark: '#8b7bf5', light: '#5b4bd6', labelKey: 'admin.tracks.colorViolet' }, // --track-pmo
  { dark: '#22b8d6', light: '#0a7d94', labelKey: 'admin.tracks.colorCyan' }, // --track-itops
  { dark: '#e0a020', light: '#9c6600', labelKey: 'admin.tracks.colorAmber' }, // --track-network
  { dark: '#46c26a', light: '#2c7a45', labelKey: 'admin.tracks.colorGreen' }, // --track-infra
  { dark: '#f2678f', light: '#c2385f', labelKey: 'admin.tracks.colorRose' }, // --track-sre
  { dark: '#58a6ff', light: '#1560c9', labelKey: 'admin.tracks.colorBlue' }, // --accent
  { dark: '#ff7a7a', light: '#c02b2b', labelKey: 'admin.tracks.colorRed' }, // --red
]

// ── SLA overrides ──────────────────────────────────────────────────────────
//
// One row per priority, and the resolution order this section exists to feed is
// lib/health.resolveSlaDays() — the same function the entry lists use and the
// mirror of `coalesce(ts.sla_days, vp.sla_days)` in v_entry_health. The greyed
// value on each row is that function's answer, not a second calculation that
// could drift from it.

/**
 * The frozen four, in 0003's seed order (low → critical), which is also the
 * order of the union in types.ts and of every priority picker in the app.
 * Written out rather than derived from the vocabulary store on purpose: a hidden
 * priority still needs an SLA cell, because entries already filed under it are
 * still open and still counting.
 */
const PRIORITIES: readonly EntryPriority[] = ['low', 'medium', 'high', 'critical']

/** Mirrors `track_slas_days_range` in 0006. */
const SLA_MIN = 1
const SLA_MAX = 3650

/** Raw input text per priority. '' means "inherit" — see parseSla. */
type SlaForm = Record<EntryPriority, string>
/** What the server last told us, for the dirty check and the save diff. */
type SlaBaseline = Record<EntryPriority, number | null>

function blankSlaForm(): SlaForm {
  return { low: '', medium: '', high: '', critical: '' }
}

function blankSlaBaseline(): SlaBaseline {
  return { low: null, medium: null, high: null, critical: null }
}

function slaText(days: number | null): string {
  return days === null ? '' : String(days)
}

/**
 * THREE outcomes, and the third is why this does not return `number | null`:
 *
 *   null       — empty, i.e. inherit. A real, saveable value (it deletes the row).
 *   a number   — a valid override.
 *   undefined  — the admin typed something that is not one of those.
 *
 * Collapsing "invalid" into "inherit" would silently discard a typo'd `12x` as
 * "no override" and save that, which is the one outcome the admin cannot see
 * happening.
 */
function parseSla(raw: string): number | null | undefined {
  const s = raw.trim()
  if (s === '') return null
  if (!/^[0-9]{1,4}$/.test(s)) return undefined
  const n = Number(s)
  return n >= SLA_MIN && n <= SLA_MAX ? n : undefined
}

interface Form {
  name: string
  nameAr: string
  description: string
  descriptionAr: string
  color: string
  colorLight: string
  icon: string
  suggestedTags: string[]
}

type FieldErrors = Partial<Record<keyof Form, string>>

function blankForm(): Form {
  return {
    name: '',
    nameAr: '',
    description: '',
    descriptionAr: '',
    color: SWATCHES[0].dark,
    colorLight: SWATCHES[0].light,
    icon: TRACK_ICON_NAMES[0] ?? '',
    suggestedTags: [],
  }
}

function formOf(track: Track): Form {
  return {
    name: track.name,
    nameAr: track.name_ar,
    description: track.description,
    descriptionAr: track.description_ar,
    color: track.color,
    // Nullable in the database; the form always carries a concrete hex because
    // both colour fields are validated against HEX. Seeding a null with `color`
    // is the same fallback every reader applies, so opening and saving a track
    // that had no override writes the colour it was already being drawn in.
    colorLight: track.color_light ?? track.color,
    icon: track.icon,
    // `text[] not null default '{}'` — copied, not aliased, so editing the form
    // cannot mutate the array the config store is still handing to every row.
    suggestedTags: [...track.suggested_tags],
  }
}

/** i18n KEYS, not sentences — the caller renders them through t(). */
function validate(form: Form): FieldErrors {
  const errors: FieldErrors = {}
  const name = form.name.trim()
  if (!name) errors.name = 'admin.tracks.errNameRequired'
  else if (name.length > NAME_MAX) errors.name = 'admin.tracks.errNameLong'
  if (form.nameAr.trim().length > NAME_MAX) errors.nameAr = 'admin.tracks.errNameLong'
  if (!HEX.test(form.color)) errors.color = 'admin.tracks.errColor'
  if (!HEX.test(form.colorLight)) errors.colorLight = 'admin.tracks.errColor'
  return errors
}

export default function TrackEditor(): ReactElement {
  const locale = useLocale()
  // COSMETIC GATE on the form as a whole: 0025 re-points the `tracks` write
  // policies from `is_admin()` at `has_perm('structure.edit')`, the key the
  // Director role holds. TracksAdmin.tsx — the list this editor is reached from,
  // gated on the same key — carries the long form of why the question is a
  // permission and no longer a role.
  const canEdit = useHasPerm('structure.edit')
  // THE SECOND GATE, because TWO TABLES, ONE SAVE BUTTON is also two
  // permissions. The fields at the top write `tracks`; the SLA overrides section
  // writes `track_slas`, which 0025 deliberately LEAVES on `workspace.admin` —
  // an SLA is a service commitment the workspace makes, not part of the shape of
  // the map, so it stayed behind when the shape moved. Without this, a Director
  // editing a name and an SLA cell in one gesture would have the first half
  // committed and the second refused with 42501: exactly the half-applied save
  // this file's header says one save button exists to prevent. Withholding the
  // section is free — it needs no new string, and saveSlaOverrides() writes
  // nothing when no cell differs from its baseline, which is the state a section
  // nobody can edit is always in.
  const canEditSlas = useHasPerm('workspace.admin')
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const editing = Boolean(id)

  const trackMap = useTrackMap()
  const track = id ? (trackMap.get(id) ?? null) : null

  const vocabLabel = useVocabLabel()
  const priorityDefault = useSlaDays()

  const [form, setForm] = useState<Form>(blankForm)
  /** The last saved state, for the unsaved-changes guard. */
  const [baseline, setBaseline] = useState<Form>(blankForm)
  const [touched, setTouched] = useState<Partial<Record<keyof Form, boolean>>>({})
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  /** True once the config store has answered — distinguishes "still loading"
      from "no such track", which look identical in an empty map. */
  const [ready, setReady] = useState(false)

  const [slaForm, setSlaForm] = useState<SlaForm>(blankSlaForm)
  const [slaBaseline, setSlaBaseline] = useState<SlaBaseline>(blankSlaBaseline)
  const [slaTouched, setSlaTouched] = useState<Partial<Record<EntryPriority, boolean>>>({})
  /** True from the FIRST render on an edit route, not from the effect: starting
      at false renders four empty "Inherit" inputs for a frame, which reads as
      "this track has no overrides" a beat before the real answer arrives. */
  const [slaLoading, setSlaLoading] = useState<boolean>(() => Boolean(id))
  /** An i18n KEY. Kept apart from serverError: a matrix that would not load is a
      different failure from a save that was rejected, and the section renders
      its own message rather than blaming the whole form. */
  const [slaLoadError, setSlaLoadError] = useState<string | null>(null)

  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    void loadConfig().finally(() => {
      if (alive.current) setReady(true)
    })
  }, [])

  // The priority DEFAULTS, so each row can show what it inherits. Never rejects
  // and is deduped in-flight; a failure leaves every default null, which renders
  // as "no SLA" — the honest answer when the workspace's own numbers could not
  // be read.
  useEffect(() => {
    void loadVocab()
  }, [])

  // This track's OVERRIDES. Keyed on the id for the same reason the form seed
  // below is: /settings/tracks/:id is one component across many ids, and a
  // boolean guard would leave the previous track's numbers in the inputs.
  useEffect(() => {
    if (!id) return
    setSlaLoading(true)
    setSlaLoadError(null)
    // Clear first. /settings/tracks/:id is one component across many ids, and
    // the previous track's numbers left in state would count as unsaved changes
    // against the NEXT track's baseline.
    setSlaForm(blankSlaForm())
    setSlaBaseline(blankSlaBaseline())
    setSlaTouched({})
    void listTrackSlas(id).then((result) => {
      if (!alive.current) return
      setSlaLoading(false)
      if (!result.ok) {
        setSlaLoadError(result.error)
        return
      }
      const nextForm = blankSlaForm()
      const nextBaseline = blankSlaBaseline()
      for (const row of result.data) {
        nextForm[row.priority] = String(row.sla_days)
        nextBaseline[row.priority] = row.sla_days
      }
      setSlaForm(nextForm)
      setSlaBaseline(nextBaseline)
      setSlaTouched({})
    })
  }, [id])

  // Seed once per track. Keyed on the id rather than a plain boolean because
  // this component is reused across /settings/tracks/:id ids — a boolean would
  // leave the previous track's values in the form. A later config refresh
  // (another tab, a sibling mutation) still must not overwrite live typing,
  // which is what the id comparison preserves.
  const seededFor = useRef<string | null>(null)
  useEffect(() => {
    if (!track || seededFor.current === track.id) return
    seededFor.current = track.id
    const next = formOf(track)
    setForm(next)
    setBaseline(next)
  }, [track])

  const set = useCallback(<K extends keyof Form>(key: K, value: Form[K]): void => {
    setForm((current) => ({ ...current, [key]: value }))
  }, [])

  // ---- the two radiogroups ------------------------------------------------
  // -1 when the form carries a hand-typed hex or an icon name from an older
  // release: nothing is checked, and rovingTabIndex() then puts the group's
  // single tab stop on its first option so it stays reachable.
  const swatchIndex = SWATCHES.findIndex(
    (pair) => form.color === pair.dark && form.colorLight === pair.light,
  )
  const iconIndex = TRACK_ICON_NAMES.indexOf(form.icon)

  const selectSwatch = useCallback((index: number): void => {
    const pair = SWATCHES[index]
    setForm((current) => ({ ...current, color: pair.dark, colorLight: pair.light }))
  }, [])
  const onSwatchKeyDown = useRadioGroupKeys<HTMLDivElement>(selectSwatch)
  const onIconKeyDown = useRadioGroupKeys<HTMLDivElement>(
    useCallback(
      (index: number) => {
        set('icon', TRACK_ICON_NAMES[index])
      },
      [set],
    ),
  )

  const setSla = useCallback((priority: EntryPriority, value: string): void => {
    setSlaForm((current) => ({ ...current, [priority]: value }))
  }, [])

  const errors = validate(form)
  const shows = (key: keyof Form): string | undefined =>
    submitted || touched[key] ? errors[key] : undefined

  /**
   * The typed overrides as lib/health sees them, so each row's greyed value is
   * resolveSlaDays()' answer and not a second implementation of the same rule.
   * Built in a memo, never in a selector — a fresh Map per render is the
   * `getSnapshot should be cached` hazard store/config.ts documents.
   */
  const slaOverrides = useMemo(() => {
    const map = new Map<string, number>()
    if (!id) return map
    for (const priority of PRIORITIES) {
      const parsed = parseSla(slaForm[priority])
      if (typeof parsed === 'number') map.set(trackSlaKey(id, priority), parsed)
    }
    return map
  }, [id, slaForm])

  const slaInvalid = PRIORITIES.some((p) => parseSla(slaForm[p]) === undefined)
  const slaDirty = PRIORITIES.some((p) => slaForm[p].trim() !== slaText(slaBaseline[p]))
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline) || slaDirty

  /**
   * Write only the cells that changed, one at a time. Four requests is the worst
   * case and the common case is zero; running them in sequence keeps the
   * config_audit trail in the order the admin sees the rows, and lets the first
   * failure stop the rest rather than half-applying a matrix.
   *
   * Returns an i18n KEY on failure, null on success.
   *
   * A WRITE HERE CHANGES EVERY SLA BADGE IN THE APP, so the entries store is
   * invalidated in the `finally` — including on the partial-failure path, where
   * some cells landed and the rest did not. store/entries holds the matrix that
   * derive() resolves against (FIX-BACKLOG **SLA-MATRIX**); leaving it stale
   * would mean the admin saves a new deadline and the board goes on showing the
   * old one until the next full reload.
   */
  async function saveSlaOverrides(trackId: string): Promise<string | null> {
    let wrote = false
    try {
      for (const priority of PRIORITIES) {
        const next = parseSla(slaForm[priority])
        // Guarded by slaInvalid before this runs; the check is here so a future
        // caller cannot skip it and write `undefined` into the API.
        if (next === undefined) continue
        if (next === slaBaseline[priority]) continue
        const result = await setTrackSla(trackId, priority, next)
        if (!result.ok) return result.error
        wrote = true
        if (!alive.current) return null
        setSlaBaseline((current) => ({ ...current, [priority]: next }))
      }
      return null
    } finally {
      // Not awaited and not gated on `alive`: the store outlives this screen and
      // the refetch has to happen whether or not the admin navigated away.
      if (wrote) void invalidateTrackSlas()
    }
  }

  async function save(): Promise<void> {
    setSubmitted(true)
    setServerError(null)
    if (Object.keys(errors).length > 0 || slaInvalid) return
    setSaving(true)
    const input = {
      name: form.name.trim(),
      nameAr: form.nameAr.trim(),
      description: form.description.trim(),
      descriptionAr: form.descriptionAr.trim(),
      color: form.color.toLowerCase(),
      colorLight: form.colorLight.toLowerCase(),
      icon: form.icon,
      suggestedTags: form.suggestedTags,
    }
    const result = id ? await updateTrack(id, input) : await createTrack(input)
    if (!alive.current) return
    if (!result.ok) {
      setSaving(false)
      // An i18n KEY from pgErrorKey — a duplicate name lands on the field it
      // belongs to rather than in a generic banner. t() passes an unknown key
      // through verbatim, so the "backend not configured" sentence also renders.
      setServerError(result.error)
      return
    }

    // The second table. Only on edit: the overrides section is not offered on
    // the create form precisely so this cannot half-apply — a track that was
    // created and then failed its SLA writes would leave the page with no id to
    // retry against and a name the server would now reject as a duplicate.
    if (id) {
      const slaError = await saveSlaOverrides(id)
      if (!alive.current) return
      if (slaError) {
        setSaving(false)
        setServerError(slaError)
        // The track itself saved; the config store must reflect that even
        // though the SLA half did not land.
        invalidateConfig()
        return
      }
    }

    setSaving(false)
    invalidateConfig()
    toast(t(editing ? 'admin.tracks.saved' : 'admin.tracks.created'))
    void navigate('/settings/tracks')
  }

  async function cancel(): Promise<void> {
    if (dirty) {
      const ok = await confirm({
        title: t('admin.tracks.discardTitle'),
        body: t('admin.tracks.discardBody'),
        confirmLabel: t('admin.tracks.discard'),
        cancelLabel: t('common.cancel'),
        danger: true,
      })
      if (!ok) return
    }
    void navigate('/settings/tracks')
  }

  if (!canEdit) return <Navigate to="/settings" replace />

  // Resolved once so each render site is a plain value rather than two calls TS
  // cannot narrow against each other.
  const nameErr = shows('name')
  const nameArErr = shows('nameAr')
  const colorErr = shows('color')
  const colorLightErr = shows('colorLight')

  const PreviewIcon = trackIcon(form.icon)
  const previewName =
    (locale === 'ar' ? form.nameAr.trim() || form.name.trim() : form.name.trim()) ||
    t('admin.tracks.name')
  // The second line is always the OTHER language, never a repeat of the first.
  // Keying it to nameAr unconditionally read correctly in English and printed
  // the Arabic name twice in Arabic, where nameAr is already the primary.
  const previewAltLang = locale === 'ar' ? 'en' : 'ar'
  const previewAlt = (locale === 'ar' ? form.name : form.nameAr).trim()
  const showPreviewAlt = previewAlt !== '' && previewAlt !== previewName

  return (
    <div className="admin">
      <div className="admin-bar">
        <Link to="/settings/tracks" className="btn btn-ghost btn-sm">
          <IconArrowStart className="icon-directional" size={16} />
          {t('common.back')}
        </Link>
      </div>

      {/* App.tsx's header already titles this route admin.tracks.add or
          admin.tracks.edit, so the form does not repeat it. */}
      {editing && !ready && !track && <Skeleton height={72} count={3} />}

      {editing && ready && !track && (
        <div className="card admin-error" role="alert">
          <p>{t('common.error')}</p>
          <Link to="/settings/tracks" className="btn btn-sm">
            {t('common.back')}
          </Link>
        </div>
      )}

      {(!editing || track) && (
        <form
          className="card admin-form"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          {/* Live preview of the row this track will render as, colour bar and
              all — the one thing a hex field and an icon name cannot show. */}
          <div className="admin-preview">
            <p className="field-label">{t('admin.tracks.preview')}</p>
            <div
              className="admin-row-head track-bar admin-track-bar"
              style={trackVars(form.color, form.colorLight)}
            >
              <span className="admin-row-icon" aria-hidden="true">
                <PreviewIcon size={18} />
              </span>
              <div className="admin-row-text">
                <p className="admin-row-name">{previewName}</p>
                {showPreviewAlt && (
                  <p
                    className="admin-row-alt"
                    lang={previewAltLang}
                    dir={previewAltLang === 'ar' ? 'rtl' : 'ltr'}
                  >
                    {previewAlt}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="track-name">
              {t('admin.tracks.name')}
            </label>
            <input
              id="track-name"
              className="input"
              value={form.name}
              placeholder={t('admin.tracks.namePlaceholder')}
              maxLength={NAME_MAX}
              autoComplete="off"
              aria-invalid={nameErr ? true : undefined}
              aria-describedby={nameErr ? 'track-name-err' : undefined}
              onChange={(e) => set('name', e.target.value)}
              onBlur={() => setTouched((c) => ({ ...c, name: true }))}
            />
            {nameErr && (
              <p className="field-error" id="track-name-err">
                {t(nameErr, { max: NAME_MAX })}
              </p>
            )}
          </div>

          <div className="field">
            <label className="field-label" htmlFor="track-name-ar">
              {t('admin.tracks.nameAr')}
            </label>
            {/* lang + dir on the CONTROL, not on a wrapper: the Arabic name is
                typed into an otherwise English page, and without these the
                caret starts on the wrong side and the text gets a Latin face. */}
            <input
              id="track-name-ar"
              className="input"
              lang="ar"
              dir="rtl"
              value={form.nameAr}
              placeholder={t('admin.tracks.nameArPlaceholder')}
              maxLength={NAME_MAX}
              autoComplete="off"
              aria-invalid={nameArErr ? true : undefined}
              onChange={(e) => set('nameAr', e.target.value)}
              onBlur={() => setTouched((c) => ({ ...c, nameAr: true }))}
            />
            {nameArErr && <p className="field-error">{t(nameArErr, { max: NAME_MAX })}</p>}
          </div>

          <div className="field">
            <label className="field-label" htmlFor="track-desc">
              {t('admin.tracks.description')}
            </label>
            <textarea
              id="track-desc"
              className="input"
              rows={2}
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="track-desc-ar">
              {t('admin.tracks.descriptionAr')}
            </label>
            <textarea
              id="track-desc-ar"
              className="input"
              lang="ar"
              dir="rtl"
              rows={2}
              value={form.descriptionAr}
              onChange={(e) => set('descriptionAr', e.target.value)}
            />
          </div>

          {/* The decided-requirement hop: Onboarding's two integration paths
              ship as `{direct-integration, portal}` on the track, not as a
              hardcoded list — nothing in this codebase names a track, so a
              seventh one needs no code change. Consumed by capture's `+tag`
              suggestions, the track view's breakdown and the digest. */}
          <div className="field">
            <TagsField
              label={t('admin.tracks.suggestedTags')}
              hint={t('admin.tracks.suggestedTagsHint')}
              value={form.suggestedTags}
              onChange={(next) => set('suggestedTags', next)}
              addLabel={t('admin.tracks.addTag')}
              placeholder={t('admin.tracks.tagPlaceholder')}
              removeLabel={(name) => t('admin.tracks.removeTag', { name })}
            />
          </div>

          <fieldset className="admin-fieldset">
            <legend className="field-label">{t('admin.tracks.color')}</legend>
            <p className="admin-hint">{t('admin.tracks.colorHint')}</p>
            {/* role="radiogroup" is a contract: one tab stop, arrows move the
                selection. Without it these seven swatches were seven tab stops
                in the middle of a form that has eight other fields, and the
                arrow keys a screen reader tells the user to press did nothing.
                See lib/radioGroup.ts. */}
            <div
              className="admin-swatches"
              role="radiogroup"
              aria-label={t('admin.tracks.color')}
              onKeyDown={onSwatchKeyDown}
            >
              {SWATCHES.map((pair, index) => {
                const active = index === swatchIndex
                return (
                  <button
                    key={pair.dark}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    // A colour name, never the hex: this is the control's only
                    // accessible name, and "#8b7bf5" is read out one character
                    // at a time. The hex itself stays visible in the field below.
                    aria-label={t(pair.labelKey)}
                    tabIndex={rovingTabIndex(index, swatchIndex)}
                    className={`admin-swatch${active ? ' active' : ''}`}
                    style={trackVars(pair.dark, pair.light)}
                    onClick={() => selectSwatch(index)}
                  >
                    <span className="admin-swatch-dot" aria-hidden="true" />
                  </button>
                )
              })}
            </div>

            <div className="admin-hex-row">
              <div className="field">
                <label className="field-label" htmlFor="track-color">
                  {t('admin.tracks.color')}
                </label>
                {/* dir="ltr" on the value itself: a hex code is a Latin token and
                    reads back-to-front if the RTL paragraph direction gets it. */}
                <input
                  id="track-color"
                  className="input admin-hex"
                  dir="ltr"
                  value={form.color}
                  spellCheck={false}
                  autoCapitalize="none"
                  autoCorrect="off"
                  aria-invalid={colorErr ? true : undefined}
                  onChange={(e) => set('color', e.target.value)}
                  onBlur={() => setTouched((c) => ({ ...c, color: true }))}
                />
                {colorErr && <p className="field-error">{t(colorErr)}</p>}
              </div>
              <div className="field">
                <label className="field-label" htmlFor="track-color-light">
                  {t('admin.tracks.colorLight')}
                </label>
                <input
                  id="track-color-light"
                  className="input admin-hex"
                  dir="ltr"
                  value={form.colorLight}
                  spellCheck={false}
                  autoCapitalize="none"
                  autoCorrect="off"
                  aria-invalid={colorLightErr ? true : undefined}
                  onChange={(e) => set('colorLight', e.target.value)}
                  onBlur={() => setTouched((c) => ({ ...c, colorLight: true }))}
                />
                {colorLightErr && <p className="field-error">{t(colorLightErr)}</p>}
              </div>
            </div>
          </fieldset>

          <fieldset className="admin-fieldset">
            <legend className="field-label">{t('admin.tracks.icon')}</legend>
            <div
              className="admin-icons"
              role="radiogroup"
              aria-label={t('admin.tracks.icon')}
              onKeyDown={onIconKeyDown}
            >
              {TRACK_ICON_NAMES.map((name, index) => {
                const Glyph = trackIcon(name)
                const active = form.icon === name
                return (
                  <button
                    key={name}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    // Translated, because this is the control's only accessible
                    // name and the raw value is English kebab-case
                    // ('server-cog') being read out inside an Arabic RTL page.
                    // The stored value is unchanged — only the label is
                    // localised — and t() falls back to the key, so an icon
                    // added without a translation degrades to its identifier
                    // rather than to nothing.
                    aria-label={t(`admin.tracks.icon_${name}`)}
                    tabIndex={rovingTabIndex(index, iconIndex)}
                    className={`admin-icon-option${active ? ' active' : ''}`}
                    onClick={() => set('icon', name)}
                  >
                    <Glyph size={18} />
                  </button>
                )
              })}
            </div>
          </fieldset>

          {/* The track half of the track × priority SLA matrix (0006). The
              workspace-wide default per priority lives in the vocabulary
              screen; this section only overrides it, one priority at a time.

              GATED SEPARATELY FROM THE FORM AROUND IT, and it is the only place
              in this file where the two keys part company: `track_slas` stays on
              `workspace.admin` where 0025 moved `tracks` to `structure.edit`.
              See `canEditSlas` at the top of the component — this is a
              withholding, not a disabled control: nothing below is rendered
              greyed out, and the save path writes nothing because no cell can
              differ from its baseline. */}
          {canEditSlas && (
            <fieldset className="admin-fieldset">
              <legend className="field-label">{t('admin.tracks.slaOverrides')}</legend>
              <p className="tsla-rule">{t('admin.tracks.slaRule')}</p>

              {/* No id yet, so there is nothing to hang an override on. Saying so
                  beats four disabled inputs, and it keeps the create path from
                  being able to half-apply across two tables. */}
              {!editing && <p className="tsla-note">{t('admin.tracks.slaAfterSave')}</p>}

              {editing && slaLoading && <Skeleton height={44} count={4} />}

              {editing && !slaLoading && slaLoadError && (
                <p className="field-error" role="alert">
                  {t(slaLoadError)}
                </p>
              )}

              {editing && !slaLoading && !slaLoadError && (
                <div className="tsla-list">
                  {PRIORITIES.map((priority) => {
                    const raw = slaForm[priority]
                    const parsed = parseSla(raw)
                    const invalid = parsed === undefined && (submitted || slaTouched[priority])
                    const overridden = typeof parsed === 'number'
                    // The SAME resolver the entry lists use, so what this line
                    // promises is what the view will enforce.
                    const effective = resolveSlaDays(
                      id ?? null,
                      priority,
                      slaOverrides,
                      priorityDefault(priority),
                    )
                    const inputId = `track-sla-${priority}`
                    const label = vocabLabel('priority', priority)
                    return (
                      <div className="tsla-row" key={priority}>
                        <label className="tsla-name" htmlFor={inputId}>
                          {label}
                        </label>
                        {/* type="text" + inputMode="numeric", not type="number":
                            the spinner is a 16px hit target, the scroll wheel
                            silently changes a committed value, and Firefox
                            reports a non-numeric entry as an empty string, which
                            would read here as "inherit". dir="ltr" because a
                            number of days is a Latin token inside a page that may
                            be RTL. */}
                        <input
                          id={inputId}
                          className="input tsla-input"
                          type="text"
                          inputMode="numeric"
                          dir="ltr"
                          value={raw}
                          placeholder={t('admin.tracks.slaInherit')}
                          maxLength={4}
                          autoComplete="off"
                          aria-invalid={invalid ? true : undefined}
                          aria-describedby={
                            invalid ? `${inputId}-eff ${inputId}-err` : `${inputId}-eff`
                          }
                          onChange={(e) => setSla(priority, e.target.value)}
                          onBlur={() => setSlaTouched((c) => ({ ...c, [priority]: true }))}
                        />
                        <p
                          className={`tsla-effective${overridden ? ' tsla-effective-own' : ''}`}
                          id={`${inputId}-eff`}
                        >
                          {effective === null
                            ? t('admin.tracks.slaEffectiveNone')
                            : t(
                                overridden
                                  ? 'admin.tracks.slaEffectiveOwn'
                                  : 'admin.tracks.slaEffectiveInherited',
                                // `count`: both keys are plural nodes ("1 day",
                                // not "1 days"), and the selector reads `count`.
                                { count: effective },
                              )}
                        </p>
                        {invalid && (
                          <p className="field-error tsla-error" id={`${inputId}-err`}>
                            {t('admin.tracks.errSlaRange', { min: SLA_MIN, max: SLA_MAX })}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </fieldset>
          )}

          {serverError && (
            <p className="field-error" role="alert">
              {t(serverError)}
            </p>
          )}

          <div className="admin-actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? t('admin.tracks.saving') : t('common.save')}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={saving}
              onClick={() => void cancel()}
            >
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
