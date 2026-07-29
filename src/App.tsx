import { Suspense, lazy, useEffect, type ReactElement, type ReactNode } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { LoadingSpinner } from './components/shared'
import { Toaster } from './components/toast'
import { ConfirmHost } from './components/Confirm'
import OfflineBanner from './components/OfflineBanner'
import {
  IconBolt,
  IconChart,
  IconChecklist,
  IconColumns,
  IconFile,
  IconGear,
  IconLayers,
  IconMic,
  IconMonitor,
  IconMoon,
  IconSun,
  type IconComponent,
} from './components/icons'
import { t, useLocale } from './lib/i18n'
import { startRealtime, stopRealtime } from './api/realtime'
import { useAuth } from './store/auth'
import { loadConfig } from './store/config'
import { resetEntries } from './store/entries'
import { initNotificationsRealtime, resetNotifications } from './store/notifications'
import { resetOutbox } from './store/outbox'
import { setLocaleSetting, setTheme, useSettings } from './store/settings'
import { loadVocab } from './store/vocab'
import type { ThemePref } from './lib/theme'
import './app-shell.css'

// Route-level code splitting: each page loads on demand so the initial bundle
// stays small. Every page ships a default export.
const SignIn = lazy(() => import('./pages/SignIn'))
const Capture = lazy(() => import('./pages/Capture'))
const FollowUps = lazy(() => import('./pages/FollowUps'))
const Board = lazy(() => import('./pages/Board'))
const Tracks = lazy(() => import('./pages/Tracks'))
const Meetings = lazy(() => import('./pages/Meetings'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Settings = lazy(() => import('./pages/Settings'))
const Placeholder = lazy(() => import('./pages/Placeholder'))
// Admin config. Under pages/settings/ rather than pages/, because pages/Tracks.tsx
// is already the per-track timeline — two Tracks.tsx in one directory is a
// permanent source of wrong-file edits.
const TracksAdmin = lazy(() => import('./pages/settings/TracksAdmin'))
const TrackEditor = lazy(() => import('./pages/settings/TrackEditor'))

/* ---------- navigation model ---------- */

interface NavDest {
  to: string
  icon: IconComponent
  /** Short label for the sidebar row / tab. */
  navKey: string
  /** Longer label for the header — "Quick capture" vs the tab's "Capture". */
  titleKey: string
  /** Tabs are capped at five; capture reaches mobile through the FAB instead. */
  inTabBar: boolean
}

// One list is the single source of truth for both navs. The two renderers below
// are thin — they differ only in element names, because app-shell.css styles
// .sidebar and .tabbar completely differently and swaps them with `display` at
// the 768px breakpoint. A `display: none` nav is out of the accessibility tree
// and the tab order too, so the hidden one can never steal a tap or a Tab stop.
const NAV: NavDest[] = [
  {
    to: '/capture',
    icon: IconBolt,
    navKey: 'nav.capture',
    titleKey: 'route.capture',
    inTabBar: false,
  },
  {
    to: '/followups',
    icon: IconChecklist,
    navKey: 'nav.followups',
    titleKey: 'route.followups',
    inTabBar: true,
  },
  { to: '/board', icon: IconColumns, navKey: 'nav.board', titleKey: 'route.board', inTabBar: true },
  {
    to: '/tracks',
    icon: IconLayers,
    navKey: 'nav.tracks',
    titleKey: 'route.tracks',
    inTabBar: true,
  },
  // No short nav.* form exists for these two: their route labels are already
  // single words, so a second key would only ever hold the same string.
  {
    to: '/meetings',
    icon: IconMic,
    navKey: 'route.meetings',
    titleKey: 'route.meetings',
    inTabBar: true,
  },
  {
    to: '/dashboard',
    icon: IconChart,
    navKey: 'route.dashboard',
    titleKey: 'route.dashboard',
    inTabBar: true,
  },
]

/** Which title the header shows for the current path. */
function titleKeyFor(pathname: string): string {
  if (pathname.startsWith('/entry/')) return 'route.entry'
  // Checked before the NAV scan: /tracks/:id is one track's log, not the track
  // index, and the header is the only thing that says which screen this is.
  if (pathname.startsWith('/tracks/')) return 'route.trackDetail'
  const hit = NAV.find((n) => pathname === n.to)
  if (hit) return hit.titleKey
  // Most specific first. All three admin paths also match the plain '/settings'
  // prefix below, so a shorter test placed earlier would title every one of
  // them "Settings" — and the header is the only chrome that names these
  // screens, since they are deliberately absent from both navs.
  if (pathname === '/settings/tracks/new') return 'admin.tracks.add'
  if (pathname.startsWith('/settings/tracks/')) return 'admin.tracks.edit'
  if (pathname.startsWith('/settings/tracks')) return 'admin.tracks.title'
  if (pathname.startsWith('/settings')) return 'route.settings'
  return 'route.followups'
}

/**
 * Full-screen wait while the auth store restores the persisted session.
 *
 * This is what prevents a flash of the sign-in screen: `session` is null for
 * the first tick of every load, so rendering the sign-in form during that tick
 * meant an already-signed-in user watched the email field appear and vanish on
 * every cold start.
 */
function BootSplash(): ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minBlockSize: '100dvh',
      }}
    >
      <LoadingSpinner />
    </div>
  )
}

/* ---------- shell chrome ---------- */

/** Persistent inline-start rail at 768px and up. */
function Sidebar(): ReactElement {
  return (
    <nav className="sidebar" aria-label={t('nav.primary')}>
      <div className="sidebar-brand">
        <span className="sidebar-brand-mark" aria-hidden="true" />
        {t('app.name')}
      </div>
      {NAV.map(({ to, icon: Icon, navKey }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
        >
          <span className="nav-icon">
            <Icon />
          </span>
          <span className="nav-label">{t(navKey)}</span>
        </NavLink>
      ))}
      <div className="sidebar-footer">
        <NavLink
          to="/settings"
          className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
        >
          <span className="nav-icon">
            <IconGear />
          </span>
          <span className="nav-label">{t('route.settings')}</span>
        </NavLink>
      </div>
    </nav>
  )
}

/** Fixed bottom bar under 768px. Exactly five tabs — see NAV. */
function TabBar(): ReactElement {
  return (
    <nav className="tabbar" aria-label={t('nav.primary')}>
      {NAV.filter((n) => n.inTabBar).map(({ to, icon: Icon, navKey }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) => `tabbar-item${isActive ? ' active' : ''}`}
        >
          <span className="tabbar-icon">
            <Icon />
          </span>
          <span className="tabbar-label">{t(navKey)}</span>
        </NavLink>
      ))}
    </nav>
  )
}

const THEME_ICON: Record<ThemePref, IconComponent> = {
  auto: IconMonitor,
  dark: IconMoon,
  light: IconSun,
}

const THEME_CYCLE: ThemePref[] = ['auto', 'dark', 'light']

const THEME_LABEL: Record<ThemePref, string> = {
  auto: 'settings.themeAuto',
  dark: 'settings.themeDark',
  light: 'settings.themeLight',
}

function AppHeader({ titleKey }: { titleKey: string }): ReactElement {
  const { theme, locale } = useSettings()
  const ThemeIcon = THEME_ICON[theme]
  const nextTheme = THEME_CYCLE[(THEME_CYCLE.indexOf(theme) + 1) % THEME_CYCLE.length]

  return (
    <header className="app-header">
      <h1 className="app-header-title">{t(titleKey)}</h1>
      <div className="app-header-actions">
        {/* Icon-only, so it needs a label. `title` adds the current value on top
            of it — the glyph alone cannot distinguish "auto, currently dark"
            from "forced dark". */}
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          aria-label={t('common.toggleTheme')}
          title={`${t('settings.theme')}: ${t(THEME_LABEL[theme])}`}
          onClick={() => setTheme(nextTheme)}
        >
          <ThemeIcon size={20} />
        </button>
        {/* A text button rather than a globe icon: the target language written
            in its own script is unambiguous in a way no icon is. `lang` so the
            Arabic label picks up an Arabic face and the right screen-reader
            voice while the surrounding UI is still English. */}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          lang={locale === 'en' ? 'ar' : 'en'}
          aria-label={t('common.toggleLanguage')}
          onClick={() => setLocaleSetting(locale === 'en' ? 'ar' : 'en')}
        >
          {locale === 'en' ? t('settings.languageAr') : t('settings.languageEn')}
        </button>
        <NavLink
          to="/settings"
          className="btn btn-ghost btn-icon"
          aria-label={t('route.settings')}
        >
          <IconGear size={20} />
        </NavLink>
      </div>
    </header>
  )
}

/* ---------- app ---------- */

function Shell({ children }: { children: ReactNode }): ReactElement {
  const { pathname } = useLocation()
  const titleKey = titleKeyFor(pathname)

  // Keep the document title in step with the route — the installed PWA's task
  // switcher and the browser's history menu both read it.
  useEffect(() => {
    document.title = `${t(titleKey)} · ${t('app.name')}`
  }, [titleKey])

  // A new route starts at the top rather than inheriting the previous page's
  // scroll offset.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  // Warm the workspace-wide stores once per session, and open the one realtime
  // channel. Tracks and vocabulary are needed by pickers, colour bars, pills and
  // the admin lists alike, so fetching them per screen would mean the same two
  // queries on nearly every navigation. Deliberately unawaited: both loaders
  // de-duplicate, neither throws, and every consumer already renders its own
  // loading state — the shell must not wait on either to paint.
  //
  // Placed in Shell rather than App because Shell mounts only once a session
  // exists, and every one of these is RLS-gated on being signed in. That is also
  // what makes the cleanup below the sign-out hook: losing the session unmounts
  // Shell, and there is no other way out of it.
  //
  // Entries are NOT loaded here. They are a screen's working set, they are the
  // one dataset large enough for the fetch to be worth deferring, and the
  // screens that need them are Wave 2's — each self-loads through
  // store/entries.loadEntries(), which dedupes exactly like these two.
  useEffect(() => {
    void loadConfig()
    void loadVocab()
    // The notification stream rides the shared channel, so the channel has to be
    // open first; both calls are idempotent, and subscribing before SUBSCRIBED
    // lands is fine — api/realtime.ts registers handlers, not sockets.
    startRealtime()
    const stopNotifications = initNotificationsRealtime()

    return () => {
      stopNotifications()
      stopRealtime()
      // Sign-out, not just unmount — see above. Each of these three stores holds
      // rows the NEXT account in this tab must not see: a per-recipient inbox
      // that RLS would never have handed them, another user's working set, and
      // worst of all queued writes that would leave under the new session's
      // credentials. Clearing them here is why those reset functions exist.
      resetNotifications()
      resetEntries()
      resetOutbox()
    }
  }, [])

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="app-main">
        <AppHeader titleKey={titleKey} />
        <OfflineBanner />
        {/* tabIndex -1 so a later route-change focus move has somewhere to land;
            global.css suppresses the ring for exactly this programmatic case. */}
        <main className="main-content" id="main" tabIndex={-1}>
          {children}
        </main>
      </div>
      <TabBar />
      {/* Capture is the app's reason to exist, so on mobile it gets a thumb-
          reachable FAB instead of one of the five tab slots. Hidden on the
          capture screen itself, where it would only cover the input. */}
      {pathname !== '/capture' && (
        <NavLink to="/capture" className="fab" aria-label={t('route.capture')}>
          <IconBolt size={26} />
        </NavLink>
      )}
    </div>
  )
}

/**
 * Dev-only shell preview: `?shell` fakes a session so the signed-in chrome can
 * be reviewed without a Supabase project.
 *
 * Phase 1 ships before any backend exists, and the auth gate below means the
 * only reachable screen is sign-in — there is otherwise no way to look at the
 * nav, the theme toggle or the RTL layout at all. Guarded by import.meta.env.DEV,
 * which Vite resolves to `false` and tree-shakes out of every production build,
 * so this cannot become a way in.
 */
function useShellPreview(): boolean {
  return import.meta.env.DEV && new URLSearchParams(window.location.search).has('shell')
}

export default function App(): ReactElement {
  const auth = useAuth()
  const preview = useShellPreview()
  const loading = preview ? false : auth.loading
  const session = preview ? ({ user: { id: 'preview' } } as never) : auth.session
  // Route-level admin gate, in addition to whatever the pages themselves do.
  // A member who bookmarks /settings/tracks should land back on Settings, not
  // watch an editable list render and then have every save rejected by RLS.
  // The preview session has no profiles row at all, so it is admitted
  // explicitly — otherwise `?shell` could never reach these screens, which is
  // the only way to review them without a Supabase project.
  const isAdmin = preview || auth.profile?.role === 'admin'
  // Subscribing at the root re-renders the whole tree on a language switch, so
  // every t() call picks up the new bundle. t() is a plain function; without a
  // subscription React has no way to know its output went stale.
  useLocale()

  if (loading) return <BootSplash />

  if (!session) {
    return (
      <>
        <Suspense fallback={<BootSplash />}>
          <Routes>
            <Route path="/signin" element={<SignIn />} />
            {/* Anything else while signed out lands on sign-in. `replace` so
                the back button does not bounce between the two. */}
            <Route path="*" element={<Navigate to="/signin" replace />} />
          </Routes>
        </Suspense>
        <Toaster />
      </>
    )
  }

  return (
    <>
      <Shell>
        <Suspense fallback={<LoadingSpinner />}>
          <Routes>
            <Route path="/" element={<Navigate to="/followups" replace />} />
            {/* Signed in, so the sign-in route is dead — send it home rather
                than showing a form that cannot do anything. */}
            <Route path="/signin" element={<Navigate to="/followups" replace />} />
            <Route path="/capture" element={<Capture />} />
            <Route path="/followups" element={<FollowUps />} />
            <Route path="/board" element={<Board />} />
            <Route path="/tracks" element={<Tracks />} />
            <Route path="/tracks/:id" element={<Tracks />} />
            <Route
              path="/entry/:id"
              element={
                <Placeholder
                  icon={<IconFile size={30} />}
                  title={t('route.entry')}
                  description={t('placeholder.entry')}
                />
              }
            />
            <Route path="/meetings" element={<Meetings />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/settings" element={<Settings />} />
            {/* Admin config hangs off /settings rather than taking a top-level
                route: NAV is capped at five tab-bar slots, and these screens
                are reached from the Settings page. React Router ranks the
                static '/new' above the dynamic ':id' regardless of order, so
                creating cannot be mistaken for editing a track called "new". */}
            <Route
              path="/settings/tracks"
              element={isAdmin ? <TracksAdmin /> : <Navigate to="/settings" replace />}
            />
            <Route
              path="/settings/tracks/new"
              element={isAdmin ? <TrackEditor /> : <Navigate to="/settings" replace />}
            />
            <Route
              path="/settings/tracks/:id"
              element={isAdmin ? <TrackEditor /> : <Navigate to="/settings" replace />}
            />
            <Route path="*" element={<Navigate to="/followups" replace />} />
          </Routes>
        </Suspense>
      </Shell>
      <Toaster />
      {/* Mounted once, at the root, beside the toaster: confirm() is called
          from anywhere and resolves a promise, so its dialog cannot live
          inside the component that asked — that component is often the one
          being unmounted by the answer. */}
      <ConfirmHost />
    </>
  )
}
