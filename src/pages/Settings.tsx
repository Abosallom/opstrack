// Settings. Appearance, language and account are live; the tracks section is a
// summary that hands off to the admin screens under /settings/tracks.
//
// IT IS ALSO THE APP'S "MORE" SURFACE. NAV in App.tsx is capped at five tab-bar
// slots, so every screen that is not one of the five is reached from a row on
// this page: the vocabulary and tracks admin, the recurring schedule, the
// notification history, and — since Wave 4b — the member roster, the workspace
// export and per-device push. A screen with no row here and no tab is a screen
// only a typed URL can reach.
//
// WAVE 4b RETIRED THE LAST "COMING SOON" IN THE APP. The members section used to
// render a `placeholder.comingSoon` pill because member management needed the
// admin-members function and was sequenced after entries CRUD. Both exist now,
// so the pill is a link to /settings/members — and with that the whole
// `placeholder` namespace and pages/Placeholder.tsx had no call site left and
// were deleted. See localeParity.test.ts's RETIRED_KEYS block.
//
// WHICH OF THE THREE NEW ROWS IS ADMIN-ONLY, and why it is only one. Members is,
// because it mints credentials. Export is not: it hands over exactly the rows RLS
// already lets the reader SELECT, so gating it would withhold a copy of data the
// app shows them elsewhere. Push is not: they are that person's own per-device
// preferences. App.tsx's route table makes the same three choices, and the two
// have to agree — a row that leads to a redirect is worse than no row.

import { useCallback, useEffect, useState, type ReactElement, type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import {
  IconBolt,
  IconChecklist,
  IconChevronEnd,
  IconClipboardList,
  IconClock,
  IconColumns,
  IconCompass,
  IconDatabase,
  IconGlobe,
  IconLayers,
  IconLogOut,
  IconNetwork,
  IconMonitor,
  IconMoon,
  IconShieldCheck,
  IconSun,
  IconUser,
  IconUsers,
  type IconComponent,
} from '../components/icons'
// The bell publishes both halves of its own surface: the header control and
// this row. Imported rather than re-implemented so the unread count, the
// chevron and the RTL behaviour stay in the file that owns them.
import { IconBell, NotificationsSettingsRow } from '../components/NotificationBell'
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

      {/* Three rows every member gets, admin or not, and Settings is where they
          live for the same reason the vocabulary row does: the tab bar is
          capped at five and none of these destinations is in it. On a phone this
          page IS the More menu — the header bell opens a dismissible sheet, so
          without the first row there is no durable way to the inbox history at
          all, and the others are the only entrances to /settings/recurring and
          /settings/export.

          BOTH NOTIFICATION ROWS SHARE ONE CARD rather than taking a second one
          with a second bell on it. They are the two halves of the same subject:
          what has already arrived (the inbox) and what should reach this device
          when the app is closed (push). Two sections would have meant two
          identical icons and a reader having to work out the difference from the
          headings alone. */}
      <Section icon={IconBell} title={t('notif.title')} description={t('notif.subtitle')}>
        <div className="settings-rows">
          <NotificationsSettingsRow />
          <NavLink to="/settings/notifications" className="btn btn-ghost notif-settings-row">
            <span>{t('push.title')}</span>
            {/* Forward through the hierarchy — forward is leftward in Arabic,
                hence icon-directional. */}
            <IconChevronEnd className="icon-directional settings-row-chevron" size={16} />
          </NavLink>
        </div>
      </Section>

      {/* NOT inside the isAdmin block below. RecurringAdmin renders the
          schedule read-only for a member and withholds its own editing — "what
          gets raised for me next Sunday" is everybody's question, and hiding
          the answer from non-admins would be hiding work from the person who
          has to do it. */}
      <Section
        icon={IconClock}
        title={t('settings.recurring')}
        description={t('settings.recurringHint')}
      >
        <NavLink to="/settings/recurring" className="btn btn-ghost">
          {t('settings.recurringManage')}
          {/* Forward through the hierarchy — forward is leftward in Arabic,
              hence icon-directional. */}
          <IconChevronEnd className="icon-directional" size={16} />
        </NavLink>
      </Section>

      {/* Also outside the admin block, and deliberately. An export contains
          exactly the rows the reader's own account is allowed to SELECT — the
          database decides that, not this row — so withholding it from a member
          would withhold a copy of data five other screens already show them.
          App.tsx leaves the route ungated to match. */}
      <Section
        icon={IconDatabase}
        title={t('export.title')}
        description={t('export.subtitle')}
      >
        <NavLink to="/settings/export" className="btn btn-ghost">
          {t('settings.exportManage')}
          <IconChevronEnd className="icon-directional" size={16} />
        </NavLink>
      </Section>

      {/* Beside the notification card and above the recurring one, because it
          belongs to the same family: things this person decides for themselves,
          on every device they sign in on. NOT in the admin block — the switch
          governs whether THIS member's capture lines are sent to a third party,
          which is not a setting anybody else should be holding for them.

          Named out of the `ai` namespace rather than `settings.*`: the header
          for the screen this row opens uses the same key (lib/routeTitle.ts), so
          the row and the title it produces cannot drift apart. */}
      <Section icon={IconBolt} title={t('ai.title')} description={t('ai.subtitle')}>
        <NavLink to="/settings/ai" className="btn btn-ghost">
          {t('ai.manage')}
          {/* Forward through the hierarchy — forward is leftward in Arabic,
              hence icon-directional. */}
          <IconChevronEnd className="icon-directional" size={16} />
        </NavLink>
      </Section>

      {isAdmin ? (
        <>
          {/* ABOVE Tracks, because a group contains tracks and the app reads
              coarse-to-fine everywhere else it offers both — the filter bar puts
              Group above Track for the same reason. This is also the only
              entrance to /settings/groups: like its three neighbours below, the
              screen is absent from both navs.

              IconColumns rather than the IconLayers on the row beneath: two
              halves standing side by side is what the screen is, and two
              adjacent rows wearing the same glyph would be two rows nobody can
              tell apart at a glance. */}
          <Section
            icon={IconColumns}
            title={t('groups.title')}
            description={t('groups.settingsHint')}
          >
            <NavLink to="/settings/groups" className="btn btn-ghost">
              {t('groups.manage')}
              {/* Forward through the hierarchy — forward is leftward in
                  Arabic, hence icon-directional. */}
              <IconChevronEnd className="icon-directional" size={16} />
            </NavLink>
          </Section>
          {/* The tree BELOW a track, between the level above tracks and tracks
              themselves — the app reads coarse-to-fine, and Structure is finer
              than a group and coarser than the work inside a track. This is the
              only entrance to /settings/structure, which is in neither nav.

              IconNetwork rather than the IconLayers on the row beneath: a tree
              of linked nodes is what the screen is, and two adjacent rows
              wearing the same glyph is what the Groups card's comment above
              warns about. */}
          <Section
            icon={IconNetwork}
            title={t('structure.title')}
            description={t('structure.settingsHint')}
          >
            <NavLink to="/settings/structure" className="btn btn-ghost">
              {t('structure.manage')}
              <IconChevronEnd className="icon-directional" size={16} />
            </NavLink>
          </Section>
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
          {/* The other half of the admin config, and the only entrance to it:
              /settings/vocabulary is deliberately absent from both navs, so
              without this row an admin can only reach the statuses, priorities
              and types by typing the URL. */}
          <Section
            icon={IconClipboardList}
            title={t('settings.vocabulary')}
            description={t('settings.vocabularyHint')}
          >
            <NavLink to="/settings/vocabulary" className="btn btn-ghost">
              {t('settings.vocabularyManage')}
              {/* Forward through the hierarchy — forward is leftward in
                  Arabic, hence icon-directional. */}
              <IconChevronEnd className="icon-directional" size={16} />
            </NavLink>
          </Section>
          {/* Beside Vocabulary because the two are the same kind of screen — a
              list of words the workspace owns — and different in what they list:
              Vocabulary holds the statuses an item moves through, this holds the
              HL7/FHIR capabilities an organization is onboarded onto and the
              kinds an item on the tree can be. /settings/catalogue is in neither
              nav, so without this row an admin can only reach the capability
              list by typing the URL. */}
          <Section
            icon={IconChecklist}
            title={t('catalogue.title')}
            description={t('catalogue.settingsHint')}
          >
            <NavLink to="/settings/catalogue" className="btn btn-ghost">
              {t('catalogue.manage')}
              <IconChevronEnd className="icon-directional" size={16} />
            </NavLink>
          </Section>
          {/* The third admin config card, and the widest in reach: Tracks and
              Vocabulary rename the workspace's own VALUES, this renames the
              app's own WORDS. Absent from both navs like its two neighbours, so
              without this row it is a typed URL away — which for the one feature
              built to remove a round-trip through a developer would be its own
              kind of joke. */}
          <Section
            icon={IconGlobe}
            title={t('terminology.settingsTitle')}
            description={t('terminology.settingsHint')}
          >
            <NavLink to="/settings/terminology" className="btn btn-ghost">
              {t('terminology.settingsManage')}
              {/* Forward through the hierarchy — forward is leftward in
                  Arabic, hence icon-directional. */}
              <IconChevronEnd className="icon-directional" size={16} />
            </NavLink>
          </Section>
          {/* THE LAST "COMING SOON" IN THE APP, RETIRED. This card carried a
              `placeholder.comingSoon` pill and a line explaining that member
              management was sequenced after entries CRUD. Both the screen and the
              `admin-members` function it needs now exist, so it is a link — and
              deleting the pill left the whole `placeholder` namespace without a
              call site, which is why that namespace and pages/Placeholder.tsx are
              gone. See the file header and localeParity.test.ts's RETIRED_KEYS.

              Inside the admin block, unlike the export and push rows above:
              creating a member mints a one-time invite code, and App.tsx
              route-gates /settings/members to match. The non-admin branch below
              still says who can. */}
          {/* Directly above Members, because a role is what a member HOLDS and
              the two are read in that order. 0025 makes what is ticked here the
              answer is_admin() gives at 183 policy call sites, so this is the
              widest-reaching card on the page — and the one whose own write gate
              (has_perm('members.manage')) only the system Admin role carries. */}
          <Section
            icon={IconShieldCheck}
            title={t('roles.title')}
            description={t('roles.settingsHint')}
          >
            <NavLink to="/settings/roles" className="btn btn-ghost">
              {t('roles.manage')}
              <IconChevronEnd className="icon-directional" size={16} />
            </NavLink>
          </Section>
          <Section
            icon={IconUsers}
            title={t('settings.members')}
            description={t('settings.membersHint')}
          >
            <NavLink to="/settings/members" className="btn btn-ghost">
              {t('settings.membersManage')}
              <IconChevronEnd className="icon-directional" size={16} />
            </NavLink>
          </Section>
        </>
      ) : (
        <Section icon={IconShieldCheck} title={t('settings.members')}>
          <p className="muted">{t('settings.membersAdminOnly')}</p>
        </Section>
      )}

      {/* ABOUT — the build the user is actually looking at.
          `settings.about` and `settings.version` shipped in both bundles from
          Wave 1 and were rendered by nothing until the v1.0.0 cut, which is
          also when src/vite-env.d.ts's promise that __APP_VERSION__ is "shown
          in Settings › About" stopped being false. It earns its card at
          release rather than before it: the app is a PWA that updates itself
          behind a prompt, so "which version am I on" is a question a tester
          on a phone can otherwise only answer by downloading an export and
          reading its metadata. Last card on the page on purpose — it is the
          thing you go looking for, never the thing you came for.

          The Arabic string carries U+2068/U+2069 around {version} itself, so
          a Latin dotted number stays left-to-right inside an RTL sentence
          without this call site knowing anything about direction. */}
      <Section icon={IconCompass} title={t('settings.about')}>
        <p className="muted">{t('settings.version', { version: __APP_VERSION__ })}</p>
        {/* Apple requires the policy to be reachable from inside the app, and
            About is where somebody goes looking for "what is this thing".
            Labelled out of the privacy namespace rather than settings.*: the
            title already ships in both languages and a settings.privacy twin
            would only ever hold the same word. */}
        <NavLink to="/privacy" className="btn btn-ghost">
          {t('privacy.title')}
        </NavLink>
      </Section>
    </div>
  )
}
