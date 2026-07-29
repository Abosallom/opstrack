// Settings. Appearance, language and account are live; the tracks section is a
// summary that hands off to the admin screens under /settings/tracks. Members
// management is still a later sitting, and says so rather than rendering a
// control that looks editable and does nothing.

import { useCallback, useEffect, useState, type ReactElement, type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import {
  IconChevronEnd,
  IconGlobe,
  IconLayers,
  IconLogOut,
  IconMonitor,
  IconMoon,
  IconShieldCheck,
  IconSun,
  IconUser,
  IconUsers,
  type IconComponent,
} from '../components/icons'
import { toast } from '../components/toast'
import { healthCheck } from '../api/entries'
import { isConfigured } from '../api/supabase'
import { t, useLocale, type Locale } from '../lib/i18n'
import { useTrackLabel } from '../lib/labels'
import { rovingTabIndex, useRadioGroupKeys } from '../lib/radioGroup'
import type { ThemePref } from '../lib/theme'
import { trackIcon } from '../lib/trackIcons'
import { trackVars } from '../lib/trackStyle'
import { signOut, useAuth } from '../store/auth'
import { useActiveTracks } from '../store/config'
import { setLocaleSetting, setTheme, useSettings } from '../store/settings'
import './settings.css'

const THEME_OPTIONS: { value: ThemePref; icon: IconComponent; labelKey: string }[] = [
  { value: 'auto', icon: IconMonitor, labelKey: 'settings.themeAuto' },
  { value: 'dark', icon: IconMoon, labelKey: 'settings.themeDark' },
  { value: 'light', icon: IconSun, labelKey: 'settings.themeLight' },
]

const LOCALE_OPTIONS: { value: Locale; labelKey: string }[] = [
  { value: 'en', labelKey: 'settings.languageEn' },
  { value: 'ar', labelKey: 'settings.languageAr' },
]

/** 'off' = no credentials in this build; the rest is the live probe's verdict. */
type BackendState = 'off' | 'checking' | 'ok' | 'unreachable'

const BACKEND_PILL: Record<BackendState, { tone: string; labelKey: string }> = {
  off: { tone: 'warn', labelKey: 'settings.backendNotConfigured' },
  checking: { tone: '', labelKey: 'settings.backendChecking' },
  ok: { tone: 'ok', labelKey: 'settings.backendConnected' },
  unreachable: { tone: 'warn', labelKey: 'settings.backendUnreachable' },
}

/**
 * One titled card in a settings-shaped page.
 *
 * Exported because the admin screens under pages/settings/ are the same page
 * furniture one level down; a second copy there would drift from this one the
 * first time the header spacing changed.
 */
export function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: IconComponent
  title: string
  description?: string
  children: ReactNode
}): ReactElement {
  return (
    <section className="card settings-section">
      <div className="settings-head">
        <span className="settings-head-icon" aria-hidden="true">
          <Icon size={18} />
        </span>
        <div>
          <h2 className="settings-head-title">{title}</h2>
          {description && <p className="settings-head-desc">{description}</p>}
        </div>
      </div>
      {children}
    </section>
  )
}

export default function Settings(): ReactElement {
  useLocale()
  const { session, profile } = useAuth()
  const tracks = useActiveTracks()
  const trackLabel = useTrackLabel()
  const { theme, locale } = useSettings()
  const [signingOut, setSigningOut] = useState(false)
  // Real probe rather than an env-var check: "Connected" should mean a
  // round-trip through credentials, network, RLS and the schema succeeded,
  // which is the one thing this row is here to tell an admin.
  const [backend, setBackend] = useState<BackendState>(() =>
    isConfigured() ? 'checking' : 'off',
  )

  // Arrow-key navigation for the two segmented controls. Both are declared
  // role="radiogroup", which commits them to it; the indices drive the roving
  // tabindex that makes each group a single tab stop.
  const themeIndex = THEME_OPTIONS.findIndex((option) => option.value === theme)
  const localeIndex = LOCALE_OPTIONS.findIndex((option) => option.value === locale)
  const onThemeKeyDown = useRadioGroupKeys<HTMLDivElement>(
    useCallback((index: number) => setTheme(THEME_OPTIONS[index].value), []),
  )
  const onLocaleKeyDown = useRadioGroupKeys<HTMLDivElement>(
    useCallback((index: number) => setLocaleSetting(LOCALE_OPTIONS[index].value), []),
  )

  useEffect(() => {
    if (!isConfigured()) return
    let alive = true
    void healthCheck().then((result) => {
      // Guard the late resolve: navigating away from Settings mid-probe would
      // otherwise set state on an unmounted component.
      if (alive) setBackend(result.ok ? 'ok' : 'unreachable')
    })
    return () => {
      alive = false
    }
  }, [])

  const email = session?.user.email ?? null
  // The profiles row is the only admin signal, matching is_admin() in RLS
  // exactly — see the note in store/auth.ts. This check is still cosmetic (it
  // decides what renders); the database is what actually refuses the writes.
  const isAdmin = profile?.role === 'admin'
  // Fall back to the address when the profile has no display name, so the
  // identity block never renders as an empty line.
  const name = profile?.displayName?.trim() || email || ''

  return (
    <div className="settings">
      <Section
        icon={IconMonitor}
        title={t('settings.appearance')}
        description={t('settings.themeHint')}
      >
        {/* role="radiogroup" is a keyboard contract, not a label: arrow keys
            move the selection and the whole group is one tab stop. See
            lib/radioGroup.ts. */}
        <div
          className="settings-seg"
          role="radiogroup"
          aria-label={t('settings.theme')}
          onKeyDown={onThemeKeyDown}
        >
          {THEME_OPTIONS.map(({ value, icon: Icon, labelKey }, index) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={theme === value}
              tabIndex={rovingTabIndex(index, themeIndex)}
              className={`settings-seg-btn${theme === value ? ' active' : ''}`}
              onClick={() => setTheme(value)}
            >
              <Icon size={18} />
              <span>{t(labelKey)}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section
        icon={IconGlobe}
        title={t('settings.language')}
        description={t('settings.languageHint')}
      >
        <div
          className="settings-seg"
          role="radiogroup"
          aria-label={t('settings.language')}
          onKeyDown={onLocaleKeyDown}
        >
          {LOCALE_OPTIONS.map(({ value, labelKey }, index) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={locale === value}
              tabIndex={rovingTabIndex(index, localeIndex)}
              // lang on the option so "العربية" gets an Arabic face and the
              // right screen-reader voice even while the page is English.
              lang={value}
              className={`settings-seg-btn${locale === value ? ' active' : ''}`}
              onClick={() => setLocaleSetting(value)}
            >
              <span>{t(labelKey)}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section icon={IconUser} title={t('settings.account')}>
        <p className="settings-name">{name}</p>
        {/* NOTE: no direction:ltr here even though the line contains an email.
            This string is a full translated sentence, so forcing LTR would
            reorder the Arabic around the address. The bidi algorithm already
            keeps the Latin run itself left-to-right, which is the part that
            matters. */}
        {email && <p className="settings-email muted">{t('settings.signedInAs', { email })}</p>}

        <dl className="settings-facts">
          <div className="settings-fact">
            <dt>{t('settings.role')}</dt>
            <dd>
              <span className={`pill${isAdmin ? ' info' : ''}`}>
                {isAdmin ? t('settings.roleAdmin') : t('settings.roleMember')}
              </span>
            </dd>
          </div>
          <div className="settings-fact">
            <dt>{t('settings.backend')}</dt>
            <dd>
              <span className={`pill ${BACKEND_PILL[backend].tone}`.trim()}>
                {t(BACKEND_PILL[backend].labelKey)}
              </span>
            </dd>
          </div>
        </dl>

        <button
          type="button"
          className="btn btn-danger settings-signout"
          disabled={signingOut}
          onClick={() => {
            setSigningOut(true)
            void signOut()
              .then(() => toast(t('signin.signedOut')))
              // No re-enable on the happy path — the session drops, App swaps
              // to the sign-in route and this component unmounts. `finally`
              // only matters if sign-out rejects and we stay mounted.
              .finally(() => setSigningOut(false))
          }}
        >
          {/* icon-directional: the exit arrow points out of the door, so it
              has to mirror in Arabic like any other directional glyph. */}
          <IconLogOut className="icon-directional" size={18} />
          {signingOut ? t('settings.signingOut') : t('settings.signOut')}
        </button>
      </Section>

      {isAdmin ? (
        <>
          <Section
            icon={IconLayers}
            title={t('admin.tracks.title')}
            description={t('admin.tracks.subtitle')}
          >
            {/* Column flow with a gap rather than margins on the children:
                the chip row is conditional, and a margin-block-start on the
                link would leave a dangling gap on a workspace with no tracks
                yet. */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: 12,
              }}
            >
              {tracks.length > 0 && (
                <div className="chip-row">
                  {/* A glance at what exists, not an editor — five is the
                      seeded count and as many as fit the rail at 375px
                      without it becoming the section's whole content. The
                      full list, archived included, is one tap away. */}
                  {tracks.slice(0, 5).map((track) => {
                    const TrackGlyph = trackIcon(track.icon)
                    return (
                      <span className="chip" key={track.id}>
                        {/* The hexes go in as custom properties and .track-glyph
                            lets CSS pick between them — never `color:
                            track.color` in JS, which paints the DARK hex in the
                            light theme (the seeded hues land under 3:1 there)
                            and cannot re-pick when `auto` flips at sunset under
                            a mounted page. See lib/trackStyle.ts. Decorative:
                            the name beside it carries the meaning, so hue is
                            never the only thing telling two chips apart. */}
                        <span
                          aria-hidden="true"
                          className="track-glyph"
                          style={trackVars(track.color, track.color_light)}
                        >
                          <TrackGlyph size={14} />
                        </span>
                        {trackLabel(track)}
                      </span>
                    )
                  })}
                </div>
              )}
              <NavLink to="/settings/tracks" className="btn btn-ghost">
                {t('admin.tracks.manage')}
                {/* A chevron pointing forward through the hierarchy — forward
                    is leftward in Arabic, hence icon-directional. */}
                <IconChevronEnd className="icon-directional" size={16} />
              </NavLink>
            </div>
          </Section>
          <Section
            icon={IconUsers}
            title={t('settings.members')}
            description={t('settings.membersHint')}
          >
            {/* Deliberately not a disabled form: member management needs the
                admin-members edge function and is sequenced after entries
                CRUD, so a greyed-out control would only invite clicking. */}
            <div className="settings-soon">
              <span className="pill info">{t('placeholder.comingSoon')}</span>
              <p className="settings-soon-text">{t('settings.membersSoon')}</p>
            </div>
          </Section>
        </>
      ) : (
        <Section icon={IconShieldCheck} title={t('settings.members')}>
          <p className="muted">{t('settings.membersAdminOnly')}</p>
        </Section>
      )}
    </div>
  )
}
