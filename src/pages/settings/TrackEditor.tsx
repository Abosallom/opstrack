// Track create/edit (/settings/tracks/new and /settings/tracks/:id).
//
// A sub-route rather than a modal: this form has seven fields in two languages,
// which is more than a sheet can hold on a 375px screen without scrolling behind
// its own footer, and a real URL means a half-written track survives a mis-tap
// and can be linked to from the list.
//
// Validation here mirrors the CHECK constraints in 0002 so the two mistakes
// people actually make — an empty name, a mistyped hex — never cost a
// round-trip. It does NOT replace the server's answer: the database is the
// authority, and its errors come back as i18n keys and are rendered below.

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { IconArrowStart } from '../../components/icons'
import { Skeleton } from '../../components/shared'
import { confirm } from '../../components/Confirm'
import { toast } from '../../components/toast'
import { createTrack, updateTrack } from '../../api/tracks'
import { TRACK_ICON_NAMES, trackIcon } from '../../lib/trackIcons'
import { trackVars } from '../../lib/trackStyle'
import { rovingTabIndex, useRadioGroupKeys } from '../../lib/radioGroup'
import { t, useLocale } from '../../lib/i18n'
import { invalidateConfig, loadConfig, useTrackMap } from '../../store/config'
import { useAuth } from '../../store/auth'
import type { Track } from '../../types'
import './admin.css'

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

interface Form {
  name: string
  nameAr: string
  description: string
  descriptionAr: string
  color: string
  colorLight: string
  icon: string
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

/** Cosmetic gate; the real one is `is_admin()` in RLS. See TracksAdmin.tsx. */
function useIsAdmin(): boolean {
  const { profile } = useAuth()
  if (profile?.role === 'admin') return true
  return import.meta.env.DEV && new URLSearchParams(window.location.search).has('shell')
}

export default function TrackEditor(): ReactElement {
  const locale = useLocale()
  const isAdmin = useIsAdmin()
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const editing = Boolean(id)

  const trackMap = useTrackMap()
  const track = id ? (trackMap.get(id) ?? null) : null

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

  const errors = validate(form)
  const shows = (key: keyof Form): string | undefined =>
    submitted || touched[key] ? errors[key] : undefined
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline)

  async function save(): Promise<void> {
    setSubmitted(true)
    setServerError(null)
    if (Object.keys(errors).length > 0) return
    setSaving(true)
    const input = {
      name: form.name.trim(),
      nameAr: form.nameAr.trim(),
      description: form.description.trim(),
      descriptionAr: form.descriptionAr.trim(),
      color: form.color.toLowerCase(),
      colorLight: form.colorLight.toLowerCase(),
      icon: form.icon,
    }
    const result = id ? await updateTrack(id, input) : await createTrack(input)
    if (!alive.current) return
    setSaving(false)
    if (!result.ok) {
      // An i18n KEY from pgErrorKey — a duplicate name lands on the field it
      // belongs to rather than in a generic banner. t() passes an unknown key
      // through verbatim, so the "backend not configured" sentence also renders.
      setServerError(result.error)
      return
    }
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

  if (!isAdmin) return <Navigate to="/settings" replace />

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
