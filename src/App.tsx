import { Suspense, lazy, useEffect, useRef, type ReactElement, type ReactNode } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import { LoadingSpinner } from './components/shared'
import { Toaster } from './components/toast'
import { ConfirmHost } from './components/Confirm'
import OfflineBanner from './components/OfflineBanner'
import NotificationBell from './components/NotificationBell'
// EAGER, unlike every page below, and for the same reason NotificationBell is:
// it is chrome. Its whole job is a document keydown listener, and a lazy chunk
// would mean the first Cmd-K of a session opens nothing while a request goes out
// — a shortcut that works on the second press is worse than none. It renders
// null until something opens it, so the mount itself costs one listener.
import CommandPalette from './components/CommandPalette'
import {
  IconBolt,
  IconChart,
  IconChecklist,
  IconColumns,
  IconGear,
  IconLayers,
  IconMic,
  IconMonitor,
  IconMoon,
  IconSun,
  type IconComponent,
} from './components/icons'
import { t, useLocale } from './lib/i18n'
// Extracted so the order of its prefix tests can be asserted — see the header
// of that file. The nav table below is passed in rather than imported by it.
import { titleKeyFor } from './lib/routeTitle'
import { startRealtime, stopRealtime } from './api/realtime'
import { useAuth } from './store/auth'
import { loadConfig } from './store/config'
import { loadTrackSlas, resetEntries, startEntriesRealtime } from './store/entries'
import { loadMembers, resetMembers } from './store/members'
import { resetMeetings } from './store/meetings'
import { initNotificationsRealtime, resetNotifications } from './store/notifications'
import { resetOutbox } from './store/outbox'
import { resetPush } from './store/push'
import { setLocaleSetting, setTheme, useSettings } from './store/settings'
import { loadVocab } from './store/vocab'
import type { ThemePref } from './lib/theme'
import './app-shell.css'

// Route-level code splitting: each page loads on demand so the initial bundle
// stays small. Every page ships a default export.
const SignIn = lazy(() => import('./pages/SignIn'))
// Signed-out, like SignIn: first registration for a predefined username
// account. `store/auth.claimAccount()` signs the member in on success, so this
// route unmounts itself — see the note on the signed-out branch below.
const Claim = lazy(() => import('./pages/Claim'))
const Capture = lazy(() => import('./pages/Capture'))
const FollowUps = lazy(() => import('./pages/FollowUps'))
const Board = lazy(() => import('./pages/Board'))
// The two halves of the Tracks tab. Wave 3 split the shared placeholder that
// used to serve both: /tracks is the distribution TREE (every active track with
// its open work, for handing items out), /tracks/:id is one track's
// chronological log. Two files, two prefixes — `.tree-` and `.tl-`.
const TracksIndex = lazy(() => import('./pages/tracks/TracksIndex'))
const TrackTimeline = lazy(() => import('./pages/tracks/TrackTimeline'))
// The map half of the same job: /tracks is what is open, /mindtree is the shape
// of it. Reached from the List | Map switcher on /tracks, not from a sixth nav
// destination — the tab bar is capped at five and a second tracks-shaped
// entry would dilute both.
const Mindtree = lazy(() => import('./pages/Mindtree'))
const Entry = lazy(() => import('./pages/Entry'))
// The overlay half of the same module, mounted once at the root (below). Lazy
// so the detail surface stays out of the initial bundle; it renders null until
// something calls openEntry(), so the chunk downloads in the background at boot
// and the first row tap is instant.
const EntryOverlay = lazy(() =>
  import('./pages/Entry').then((m) => ({ default: m.EntryOverlayHost })),
)
// Meeting mode is a four-screen flow, not one page: the list, live capture,
// triage, and the minutes document. Each is its own chunk — a phone that only
// ever reads minutes never downloads the triage table.
const MeetingsIndex = lazy(() => import('./pages/meetings/MeetingsIndex'))
const MeetingLive = lazy(() => import('./pages/meetings/MeetingLive'))
const MeetingTriage = lazy(() => import('./pages/meetings/MeetingTriage'))
const MeetingMinutes = lazy(() => import('./pages/meetings/MeetingMinutes'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Digest = lazy(() => import('./pages/Digest'))
// The inbox HISTORY. The bell in the header is the peek at it, and it is not
// lazy — it lives in the chrome, so it is part of every screen.
const Notifications = lazy(() => import('./pages/Notifications'))
const Settings = lazy(() => import('./pages/Settings'))
// Admin config. Under pages/settings/ rather than pages/, because pages/Tracks.tsx
// is already the per-track timeline — two Tracks.tsx in one directory is a
// permanent source of wrong-file edits.
const TracksAdmin = lazy(() => import('./pages/settings/TracksAdmin'))
const TrackEditor = lazy(() => import('./pages/settings/TrackEditor'))
const VocabularyAdmin = lazy(() => import('./pages/settings/VocabularyAdmin'))
// NOT route-gated on admin, unlike the three above: the screen renders the
// schedule read-only for a member and hides its own edit affordances, because
// "what is going to be raised for me next Sunday" is everybody's question.
const RecurringAdmin = lazy(() => import('./pages/settings/RecurringAdmin'))
// Wave 4b's three. Members IS admin-gated (it mints credentials); the other two
// deliberately are not — see the route block below.
const Members = lazy(() => import('./pages/settings/Members'))
const Export = lazy(() => import('./pages/settings/Export'))
const NotificationPrefs = lazy(() => import('./pages/settings/NotificationPrefs'))

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
        {/* First in the row, and eagerly imported: the bell is chrome, so it is
            on every screen, and its unread count is the one thing here that
            changes without the user doing anything. It owns its own popover
            (sheet under 768px) and its own realtime subscription; Shell already
            opened the channel it rides. */}
        <NotificationBell />
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
  const titleKey = titleKeyFor(pathname, NAV)

  // Keep the document title in step with the route — the installed PWA's task
  // switcher and the browser's history menu both read it.
  useEffect(() => {
    document.title = `${t(titleKey)} · ${t('app.name')}`
  }, [titleKey])

  // A new route starts at the top rather than inheriting the previous page's
  // scroll offset — and picks up the keyboard focus the transition orphaned.
  //
  // WHY THE FOCUS MOVE IS CONDITIONAL. Half the routes in this app claim focus
  // themselves on mount: Capture, MeetingLive, SignIn, Claim and the follow-ups
  // search all put the caret in their own field, and child effects run BEFORE a
  // parent's, so an unconditional `#main.focus()` here would run last and steal
  // it from every one of them. `document.activeElement` at this point is the
  // answer to exactly the right question — the new route has already had its
  // turn, so a real element means somebody claimed focus and `<body>` means
  // nobody did.
  //
  // WHEN NOBODY DID, which Wave 3 made the common case. A NavLink survives the
  // transition and keeps focus; a `<button>` that navigates does not — it
  // unmounts itself, focus falls to `<body>`, the next Tab restarts at the skip
  // link and a screen-reader user hears nothing at all (an SPA `document.title`
  // change is not reliably announced). Nearly every route Wave 3 added is
  // entered that way: the meeting rows on the index, live → triage → minutes,
  // and the dashboard's empty-state actions.
  //
  // `<main>` is `tabIndex={-1}` and carries the route's name below, so the move
  // announces "Board, main" and the next Tab continues into the page. global.css
  // suppresses the focus ring for precisely this programmatic case.
  const settled = useRef(false)
  useEffect(() => {
    window.scrollTo(0, 0)
    // Not on first paint: the initial route has not replaced anything, and
    // stealing focus on load would fight the browser's own restoration.
    if (!settled.current) {
      settled.current = true
      return
    }
    const active = document.activeElement
    if (active === null || active === document.body || active === document.documentElement) {
      document.getElementById('main')?.focus()
    }
  }, [pathname])

  // Warm the workspace-wide stores once per session, and open the one realtime
  // channel. Tracks, vocabulary and members are needed by pickers, colour bars,
  // pills, owner badges and the admin lists alike, so fetching them per screen
  // would mean the same three queries on nearly every navigation. Deliberately
  // unawaited: every loader de-duplicates, none throws, and every consumer
  // renders its own loading state — the shell must not wait to paint.
  //
  // MEMBERS BELONGS HERE and was missing. Nothing on a LIST screen loaded it —
  // only EntrySheet and Capture did — so every owned entry on follow-ups, the
  // board and the tracks tree rendered "Unassigned" until the user happened to
  // open a sheet, at which point the whole list silently re-labelled itself.
  // memberLabel() falls through to that string when the roster is empty, which
  // is indistinguishable from the row genuinely having no owner.
  //
  // Placed in Shell rather than App because Shell mounts only once a session
  // exists, and every one of these is RLS-gated on being signed in. That is also
  // what makes the cleanup below the sign-out hook: losing the session unmounts
  // Shell, and there is no other way out of it.
  //
  // Entries are NOT loaded here. They are a screen's working set, they are the
  // one dataset large enough for the fetch to be worth deferring, and the
  // screens that need them are Wave 2's — each self-loads through
  // store/entries.loadEntries(), which dedupes exactly like these three.
  useEffect(() => {
    void loadConfig()
    void loadVocab()
    void loadMembers()
    // The `track_slas` matrix joins them: store/entries.derive() resolves every
    // fallback health row against it, so a screen that renders before it lands
    // shows the workspace default and corrects itself one fetch later. Tiny
    // table, changes only when an admin edits a track, deduped like the rest.
    void loadTrackSlas()
    // The notification stream rides the shared channel, so the channel has to be
    // open first; both calls are idempotent, and subscribing before SUBSCRIBED
    // lands is fine — api/realtime.ts registers handlers, not sockets.
    startRealtime()
    // Both stores subscribe to the SAME channel: api/realtime.ts owns the socket
    // and fans batches out to whoever registered, so this is two handler
    // registrations rather than two connections.
    //
    // The entries subscription is what makes the channel worth opening at all —
    // without it api/realtime.ts coalesced, debounced and flushed every entries
    // and entry_updates batch to nobody, `onRealtimeResync` had no subscriber so
    // the post-reconnect refetch never fired, and two sessions on one entry did
    // not see each other until the 45 s focus refetch.
    const stopEntries = startEntriesRealtime()
    const stopNotifications = initNotificationsRealtime()

    return () => {
      stopEntries()
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
      // Members joins them now that Shell warms it on every session. Its own
      // doc comment asks for this: the roster is cached to localStorage for
      // first paint, and the next person to sign in on a shared device must not
      // see the previous one's teammates in an owner picker. Before the warm
      // call above, the store only filled when a sheet was opened, so the leak
      // needed a coincidence; now it is guaranteed without this line.
      resetMembers()
      // Meetings is the fifth, and the argument for it is STALENESS rather than
      // confidentiality — `meetings_select` and `meeting_lines_select` are both
      // `is_member()`, so every teammate may read every meeting anyway. What
      // makes it belong here is that its two dedupe latches, `loadedAt` and
      // `linesLoadedAt`, are consulted without a clock: left standing, the next
      // account's first /meetings visit short-circuits and paints the previous
      // account's list, their already-opened line sets, and — through `plans` —
      // their unsaved triage decisions, with no spinner and no network call.
      // Pressing Commit then files those decisions under the new user's name.
      // It also cancels the 600 ms triage-save timers, so an edit made in the
      // last moment before signing out cannot fire after the session is gone.
      resetMeetings()
      // Push is the sixth, and the only one whose reset reaches OUTSIDE the tab.
      // The browser's push subscription is per-BROWSER, not per-session, so a
      // subscription left registered on sign-out keeps delivering the previous
      // user's assignments to a device the next person is holding — a
      // notification is the one thing in this app that can arrive with the app
      // closed.
      //
      // THE ROW IS NOT DELETED HERE, AND CANNOT BE. By the time this cleanup
      // runs the session is already gone — that is what unmounted the shell —
      // and `push_subscriptions` is owner-only RLS, so a delete issued now
      // matches nothing and reports success. store/auth.signOut() therefore
      // awaits releasePushForSignOut() before it signs out, and this call is
      // the backstop for the sign-outs that never go through it: an expired
      // session, a revoked token, a sign-out in another tab. It clears the
      // store and re-attempts the unsubscribe; both are idempotent.
      resetPush()
    }
  }, [])

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="app-main">
        <AppHeader titleKey={titleKey} />
        <OfflineBanner />
        {/* tabIndex -1 so the route-change focus move above has somewhere to
            land; global.css suppresses the ring for exactly this programmatic
            case. aria-label names the landmark with the route, so the move is
            an announcement rather than a silent jump. */}
        <main className="main-content" id="main" tabIndex={-1} aria-label={t(titleKey)}>
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
  // Feeds ErrorBoundary's resetKey: navigating away from a crashed screen
  // clears the boundary, so one bad route cannot wedge the whole session.
  const { pathname } = useLocation()

  if (loading) return <BootSplash />

  if (!session) {
    return (
      <>
        {/* Outside Suspense, not inside: the thing most likely to fail here is
            the lazy chunk itself, and a boundary nested under the Suspense that
            requested it never sees that rejection. */}
        <ErrorBoundary resetKey={pathname}>
          <Suspense fallback={<BootSplash />}>
            <Routes>
              <Route path="/signin" element={<SignIn />} />
              {/* Reachable only from sign-in, and only while signed out — which
                  is the whole of its life: claimAccount() ends by publishing a
                  session, so a successful claim re-renders App down the branch
                  below and this route ceases to exist mid-submit. That is why
                  the screen has no success panel. */}
              <Route path="/claim" element={<Claim />} />
              {/* Anything else while signed out lands on sign-in. `replace` so
                  the back button does not bounce between the two. */}
              <Route path="*" element={<Navigate to="/signin" replace />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
        <Toaster />
      </>
    )
  }

  return (
    <>
      <Shell>
        {/* One boundary for all the lazy routes, INSIDE Shell so the tab
            bar, header and sign-out survive a screen that crashes — the user
            can navigate out of the failure instead of being left on a page
            whose only control is Reload. `resetKey` is what makes that work:
            leaving the route clears the error. */}
        <ErrorBoundary resetKey={pathname}>
          <Suspense fallback={<LoadingSpinner />}>
            <Routes>
              <Route path="/" element={<Navigate to="/followups" replace />} />
              {/* Signed in, so the sign-in route is dead — send it home rather
                  than showing a form that cannot do anything. */}
              <Route path="/signin" element={<Navigate to="/followups" replace />} />
              <Route path="/capture" element={<Capture />} />
              <Route path="/followups" element={<FollowUps />} />
              <Route path="/board" element={<Board />} />
              <Route path="/tracks" element={<TracksIndex />} />
              <Route path="/mindtree" element={<Mindtree />} />
              <Route path="/tracks/:id" element={<TrackTimeline />} />
              {/* The entry as a PAGE — a URL somebody was sent. Every in-app
                  tap opens the same detail surface as an overlay instead, via
                  openEntry() and the host mounted at the root below. */}
              <Route path="/entry/:id" element={<Entry />} />
              <Route path="/meetings" element={<MeetingsIndex />} />
              {/* Ranked by React Router, not by order: '/meetings/:id/triage'
                  and '/meetings/:id/minutes' both out-rank '/meetings/:id'
                  because a static segment beats a dynamic one, so no id can be
                  read as a sub-screen and no sub-screen as an id. */}
              <Route path="/meetings/:id" element={<MeetingLive />} />
              <Route path="/meetings/:id/triage" element={<MeetingTriage />} />
              <Route path="/meetings/:id/minutes" element={<MeetingMinutes />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/digest" element={<Digest />} />
              <Route path="/notifications" element={<Notifications />} />
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
              <Route
                path="/settings/vocabulary"
                element={isAdmin ? <VocabularyAdmin /> : <Navigate to="/settings" replace />}
              />
              {/* No isAdmin ternary — see the lazy import. A member reads the
                  schedule; the page itself withholds the editing. */}
              <Route path="/settings/recurring" element={<RecurringAdmin />} />
              {/* Members mints credentials — a one-time invite code that is
                  shown once — so it is route-gated like the tracks and
                  vocabulary editors. The screen re-checks and the
                  `admin-members` function is the real authority; this only
                  avoids rendering an editable roster for someone every write
                  will refuse. */}
              <Route
                path="/settings/members"
                element={isAdmin ? <Members /> : <Navigate to="/settings" replace />}
              />
              {/* Export is deliberately NOT gated, and that is the one exception
                  under /settings. What it hands over is exactly what RLS lets
                  the caller SELECT — their own notifications, nobody else's —
                  so gating it would withhold from a member a copy of data five
                  other screens already show them. See the page's header. */}
              <Route path="/settings/export" element={<Export />} />
              {/* Per-device push preferences: everybody's own settings, so not
                  gated either. `/settings/notifications` is push; the top-level
                  `/notifications` is the inbox history. Two screens, two
                  routes, and lib/routeTitle.ts titles them apart. */}
              <Route path="/settings/notifications" element={<NotificationPrefs />} />
              <Route path="*" element={<Navigate to="/followups" replace />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </Shell>
      <Toaster />
      {/* Every openEntry() in the app lands here. Follow-ups, the board and
          capture all call it and none of them imports the detail surface —
          that decoupling is what let Wave 2 run five workers wide, and this
          single mount is the other half of it. Renders null until something is
          open, and stands down while the /entry/:id route is showing. */}
      {/* Wrapped for the same reason as the routes: the overlay is lazy too,
          and an unguarded chunk failure here would unmount the whole app from
          a tap on a card. */}
      <ErrorBoundary resetKey={pathname}>
        <Suspense fallback={null}>
          <EntryOverlay />
        </Suspense>
      </ErrorBoundary>
      {/* The desktop keyboard layer: the palette, the `?` cheatsheet, and the
          one document listener that feeds both.
          MOUNT ORDER IS LOAD-BEARING and it is why this sits AFTER the overlay
          host rather than before it. An entry row's Enter closes the palette and
          calls openEntry() in one commit, so the entry sheet mounts in the same
          flush and claims focus to announce itself; effects run in tree order,
          so the sheet's must run first for the palette's focus-restore to see
          that somebody else took the keyboard and stand down. Mounted here it
          does. Moved above <EntryOverlay /> it would drag focus back to `#main`
          and a keyboard user would have to Tab in from the top of the page.
          Inside the signed-in branch, and inside the router: it needs
          useNavigate(), it reads entries and tracks that RLS only hands a
          session, and every one of its shortcuts is meaningless on sign-in. */}
      <CommandPalette />
      {/* Mounted once, at the root, beside the toaster: confirm() is called
          from anywhere and resolves a promise, so its dialog cannot live
          inside the component that asked — that component is often the one
          being unmounted by the answer. */}
      <ConfirmHost />
    </>
  )
}
