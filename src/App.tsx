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
// EAGER, unlike every page below, and deliberately: ModeFrame is 107 lines of
// chrome that the lazy mode page renders INSIDE, so loading it with the page
// would leave a reader looking at a spinner with no way back to the map. It is
// the map's way out and the way back in — see docs/MAP-CONTRACT.md §U7.
import ModeFrame from './components/map/ModeFrame'
import {
  IconChart,
  IconGear,
  IconLayers,
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
import { resetPermissions, useAuth, useHasPerm, useIsAdmin } from './store/auth'
import { loadConfig } from './store/config'
import { loadTrackSlas, resetEntries, startEntriesRealtime } from './store/entries'
import { loadMembers, resetMembers } from './store/members'
import { resetMeetings } from './store/meetings'
import { resetPortfolio } from './store/portfolio'
import { initNotificationsRealtime, resetNotifications } from './store/notifications'
import { resetAi } from './store/ai'
import { resetNudges } from './store/nudges'
import { resetMindtree } from './store/mindtree'
import { resetOutbox } from './store/outbox'
import { resetPush } from './store/push'
import { setLocaleSetting, setTheme, useSettings } from './store/settings'
import { loadVocab } from './store/vocab'
import { loadLabels } from './store/labels'
import type { ThemePref } from './lib/theme'
import './app-shell.css'

// Route-level code splitting: each page loads on demand so the initial bundle
// stays small. Every page ships a default export.
const SignIn = lazy(() => import('./pages/SignIn'))
// Signed-out, like SignIn: first registration for a predefined username
// account. `store/auth.claimAccount()` signs the member in on success, so this
// route unmounts itself — see the note on the signed-out branch below.
const Claim = lazy(() => import('./pages/Claim'))
// Password recovery, and it is signed-OUT on purpose. store/auth.ts withholds
// the session a recovery link creates (see adopt()), so a reader redeeming one
// is on this branch holding a credential the UI deliberately refuses to publish
// until the new password lands. Not mounted on the signed-in side: a signed-in
// reader has no recovery to redeem, and that branch's catch-all already sends
// /reset to /mindtree.
const ResetPassword = lazy(() => import('./pages/ResetPassword'))
// THE ONE DESTINATION. Capture, follow-ups, the board, the tracks index, the
// track timeline, the dashboard and the notification history were seven routes
// and are now five lenses and a panel on this one — see docs/MAP-CONTRACT.md §1.
// Their pages, their sheets and their tests are gone; every guarantee those
// tests held is restated in src/components/map/*.test.tsx.
const Mindtree = lazy(() => import('./pages/Mindtree'))
// THE PMO DASHBOARD, and it is a ROUTE rather than a seventh lens. That union
// is closed with no `default:` anywhere by written policy — a seventh member
// costs six sites in lib/mindtree/lens.ts, nine exhaustiveness assertions in
// lens.test.ts and both locale bundles — and its reader is not looking for a
// view of the map, they are looking for a standing report over it. Lazy like
// every page here; ungated like Export, and for that file's stated reason (it
// shows only what RLS already lets the reader SELECT).
const Pmo = lazy(() => import('./pages/Pmo'))
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
const Digest = lazy(() => import('./pages/Digest'))
const Settings = lazy(() => import('./pages/Settings'))
// Admin config. Under pages/settings/ rather than pages/, because pages/Tracks.tsx
// is already the per-track timeline — two Tracks.tsx in one directory is a
// permanent source of wrong-file edits.
const TracksAdmin = lazy(() => import('./pages/settings/TracksAdmin'))
const TrackEditor = lazy(() => import('./pages/settings/TrackEditor'))
// The level ABOVE tracks (0018). Its own chunk rather than a fold into
// TracksAdmin: the two screens write two tables, and an admin who only wants to
// rename a track should not pay for the group editor's palette to find out.
const GroupsAdmin = lazy(() => import('./pages/settings/GroupsAdmin'))
// The tree BELOW tracks (0023) and the catalogue that tree is measured against
// (0023/0024). Two chunks rather than one for the reason GroupsAdmin is its own:
// an admin renaming a phase should not pay for the capability list to load.
const StructureAdmin = lazy(() => import('./pages/settings/StructureAdmin'))
const JiraAdmin = lazy(() => import('./pages/settings/JiraAdmin'))
const CatalogueAdmin = lazy(() => import('./pages/settings/CatalogueAdmin'))
// Roles & permissions (0025). The STRICTEST gate in the file, and the one that
// did not move to a narrower key: what is ticked here is what is_admin() answers
// at 183 policy call sites. The RLS gate is has_perm('members.manage'), which
// only the system Admin role carries; this only avoids offering an editor to
// someone every write refuses.
const RolesAdmin = lazy(() => import('./pages/settings/RolesAdmin'))
const VocabularyAdmin = lazy(() => import('./pages/settings/VocabularyAdmin'))
const Terminology = lazy(() => import('./pages/settings/Terminology'))
// NOT route-gated at all, unlike the three above: the screen renders the
// schedule read-only for a member and hides its own edit affordances, because
// "what is going to be raised for me next Sunday" is everybody's question.
const RecurringAdmin = lazy(() => import('./pages/settings/RecurringAdmin'))
// Wave 4b's three. Members IS admin-gated (it mints credentials); the other two
// deliberately are not — see the route block below.
const Members = lazy(() => import('./pages/settings/Members'))
const Export = lazy(() => import('./pages/settings/Export'))
const NotificationPrefs = lazy(() => import('./pages/settings/NotificationPrefs'))
// AI assist: the per-user switch, the statement of what is sent, and today's
// count. NOT admin-gated, and deliberately — the switch decides whether THIS
// person's capture lines leave the browser, which is nobody else's setting to
// hold.
const AiSettings = lazy(() => import('./pages/settings/AiSettings'))
// The privacy policy. Mounted on BOTH sides of the auth gate below: App Store
// Connect needs a URL a reviewer with no credentials can open, and Settings
// needs the same page for a member who is already signed in.
const Privacy = lazy(() => import('./pages/Privacy'))

/* ---------- navigation model ---------- */

interface NavDest {
  to: string
  icon: IconComponent
  /** Short label for the sidebar row. */
  navKey: string
  /** Longer label for the header — "Quick capture" vs the tab's "Capture". */
  titleKey: string
}

// TWO DESTINATIONS, AND THE SECOND ONE IS SETTINGS. Six tabs became two rows,
// because the six screens became five lens chips and a panel on one route
// (docs/MAP-CONTRACT.md §0-§1). Everything the tab bar used to reach is still
// one tap away — from a chip on the map, from `MapModeBar` for the two modes,
// or from the gear in the header — so what was deleted is the SWITCHING, not
// the destinations.
//
// `inTabBar` went with the tab bar itself. Under 768px the map fills the
// viewport and `MapCapture` is docked at its block end; a five-slot bar under
// that composer would have covered the one input the whole design exists to put
// under a thumb, to offer a choice of one. The phone's navigation is now the
// lens chips, the mode bar and the header gear — see the `.tabbar` deletion in
// app-shell.css and U7's re-measure of `.mt-commit-bar`.
const NAV: NavDest[] = [
  {
    to: '/mindtree',
    icon: IconLayers,
    // `nav.map`, not `nav.tracks`: this row no longer stands for one of six
    // screens, it stands for the app. `mindtree.title` is the longer form —
    // routeTitle.ts already decided that for this screen and says why.
    navKey: 'nav.map',
    titleKey: 'mindtree.title',
  },
  // THE SECOND ROW, and the first destination added since the six tabs
  // collapsed into one. It earns a row rather than a chip because it is not a
  // view of the map: it is a standing read ACROSS the map, the follow-up
  // buckets and the risk log for somebody who does not triage. Named out of its
  // OWN namespace in both slots — `pmo.nav` short for the rail, `pmo.title`
  // longer for the header — on the digest/export precedent, so §1.0.2's rule
  // that a feature never edits `nav`/`route` holds.
  {
    to: '/pmo',
    icon: IconChart,
    navKey: 'pmo.nav',
    titleKey: 'pmo.title',
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

/**
 * Persistent inline-start rail at 768px and up — and now the ONLY nav.
 *
 * It renders NAV (the map) and then Settings in its footer, which is the whole
 * of "Map + Settings and nothing else". Under 768px it is `display: none` and
 * nothing replaces it: the phone's navigation is the lens chips, `MapModeBar`
 * and the header's gear, all of which are on the map itself.
 */
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

/**
 * Is this route a full-bleed STAGE rather than a document?
 *
 * ONE PREDICATE, here, because `.main-content`'s padding is this file's and the
 * decision to spend or not spend it is a fact about the route. `/` redirects to
 * `/mindtree`, so both spellings are the map.
 */
function isMapRoute(pathname: string): boolean {
  return pathname === '/' || pathname === '/mindtree' || pathname.startsWith('/mindtree/')
}

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
    // The workspace's own wording, layered over the shipped bundles by
    // store/labels.ts. Warmed HERE, beside config and vocab, because it is the
    // same kind of data — small, workspace-wide, RLS-gated, read by every screen
    // — and because the alternative is a rename that only takes effect once
    // somebody opens Settings › Terminology. store/labels.ts has already pushed
    // its localStorage cache into i18n at module load, so this corrects the
    // first paint rather than producing it.
    void loadLabels()
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
      // Portfolio is the sixth, and it is CONFIDENTIALITY like the first three
      // rather than staleness: it holds every organization's capability links
      // and every node's open counts, which is the whole map's data for one
      // workspace. store/signOutReset.test.ts fails until this line exists.
      resetPortfolio()
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
      // Nudges is the seventh, and the smallest: it holds only the asks THIS
      // session sent, as an optimistic overlay over `entries.nudged_at` until
      // realtime delivers the stamped row. Two lines of it still name a
      // colleague and an item they owe, and the entries store holding the
      // durable copy is cleared four lines up for exactly that reason — so
      // leaving this one standing would mean the next person on a shared laptop
      // sees "you asked 5 minutes ago" on somebody else's chase.
      resetNudges()
      // Eighth, and the one holding raw TEXT: store/ai.ts caches capture lines
      // — a person's unfiled thoughts, before they are even an entry — in a
      // module-level Map that outlives this tree. The next person to sign in on
      // this browser must not be able to have them handed back by retyping a
      // first word.
      resetAi()
      // Ninth: the Mindtree's own screen state. The selection is a list of entry
      // ids and the persisted focus addresses one track's branch — both are the
      // last session's business, and restoring a drill-in under the NEXT account
      // would open somebody else's screen on a branch they did not choose.
      resetMindtree()
      // Tenth, and the one this file's own route guards read: the permission
      // set. It is not confidential — every member may read `role_permissions`,
      // which is what lets the client mirror the policy at all — but it is
      // WHOSE. Left standing, the next account signing in on this tab is offered
      // the previous one's screens for the length of a profile round trip, and
      // an Admin signing out in front of a member is the case that matters. The
      // store re-answers `false` for everything until the new profile's grants
      // land, which is the safe direction: the database refuses either way.
      resetPermissions()
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
        <main
          className="main-content"
          id="main"
          tabIndex={-1}
          aria-label={t(titleKey)}
          /**
           * THE FULL-BLEED OPT-IN, AND THE ROUTE SETS IT — the shell renders ONE
           * `<main>` for every screen and must not guess which of them is a map.
           *
           * `.main-content` carries the document padding every list, form and
           * settings page wants and a stage does not: 28px each side and 26/64
           * block, which is 188px of a 1600px viewport spent framing a drawing
           * that should be touching the edges. The map used to claw it back with
           * negative margins copied from this file's own numbers, which is a
           * drift hazard that had a comment admitting it. The attribute makes
           * the padding zero at the source instead — see `mindtree.css`.
           */
          data-fullbleed={isMapRoute(pathname) ? '' : undefined}
        >
          {children}
        </main>
      </div>
      {/* THE FAB IS GONE, AND THAT IS HOW OPEN TASK #67 CLOSES.
          It existed to put capture under a thumb without spending a tab slot,
          and it cost two taps: one on the FAB, one on the input the route it
          navigated to had just mounted. `components/map/MapCapture.tsx` is now
          mounted at the block end of the map — the landing route — so the first
          tap lands on a real input inside a real user activation, which is what
          raises a software keyboard. Wiring the FAB to `focusMapCapture()`
          instead (the contract's other option) would have left a control on top
          of the composer it duplicates: app-shell.css docked `.fab` at
          `74px + safe-area` and map-capture.css docks the bar across roughly
          53px–117px + safe-area, so they overlapped on the inline end at 375px.
          On the mode routes, where the composer is not mounted, the way to
          capture is the way back to the map — one tap on ModeFrame's trail. */}
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
  // Route-level permission gates, in addition to whatever the pages themselves
  // do. A member who bookmarks /settings/tracks should land back on Settings,
  // not watch an editable list render and then have every save rejected by RLS.
  //
  // THREE QUESTIONS, NOT ONE, AND THEY MIRROR 0025'S POLICIES KEY FOR KEY.
  // Migration 0025 re-points the write policies on `tracks`, `track_groups`,
  // `map_nodes`, `map_node_kinds`, `use_cases`, `vocab_options` and
  // `label_overrides` — and the eight RPCs that write them — at
  // `has_perm('structure.edit')` / `has_perm('vocab.edit')`, which the Director
  // role holds and `workspace.admin` no longer implies directly. So the routes
  // below ask for the key the table asks for:
  //
  //   structure.edit  — /settings/tracks, /settings/tracks/new,
  //                     /settings/tracks/:id, /settings/groups,
  //                     /settings/structure
  //   vocab.edit      — /settings/catalogue, /settings/vocabulary,
  //                     /settings/terminology
  //   workspace.admin — /settings/roles, /settings/members. Unchanged, and
  //                     deliberately: creating, deleting and re-roling PEOPLE is
  //                     the power withheld from Director, and `roles` /
  //                     `role_permissions` stay on `members.manage`, which only
  //                     the system Admin role carries. A Director who could edit
  //                     the roles table would be one click from Admin.
  //
  // THE ROUTE AND THE SCREEN MUST ASK THE SAME QUESTION. Each page below
  // re-checks with the same key and renders its own <Navigate>; a row that
  // admitted someone the screen then bounces is worse than no row at all,
  // because the redirect happens after the chunk has loaded and reads as a
  // crash. Both are still COSMETIC — RLS is what refuses the writes.
  //
  // `useHasPerm` reads `role_permissions` for the signed-in profile and falls
  // back to the legacy `profiles.role` when 0025 has not been applied (or the
  // profile has no `role_id`), so a workspace without the roles tables behaves
  // exactly as it did before this split: admin sees everything, member sees
  // none of it.
  //
  // NO `preview ||` ON THESE THREE, unlike `loading` and `session` above. The
  // dev-only `?shell` flag now lives INSIDE store/auth's answer — it was carried
  // there verbatim from the seven screen-local copies this replaces — so
  // repeating it here would be two implementations of one escape hatch. It would
  // also be a conditional hook call: `preview || useHasPerm(...)` short-circuits
  // the call, and the hook order would change the moment somebody appends
  // `?shell` to the URL.
  const canEditStructure = useHasPerm('structure.edit')
  const canEditVocab = useHasPerm('vocab.edit')
  const isAdmin = useIsAdmin()
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
              {/* Both halves of password recovery: asking for a link, and
                  setting the password one arrived with. ABOVE the catch-all for
                  the same reason /privacy is — below `path="*"` it would
                  redirect to sign-in and every recovery link this workspace ever
                  emails would be dead on arrival.

                  Required, not optional: SignIn.tsx renders
                  <Navigate to="/reset" /> for a live recovery, so without this
                  line the catch-all sends it straight back and the two routes
                  loop. */}
              <Route path="/reset" element={<ResetPassword />} />
              {/* The public half of the privacy policy, and the URL App Store
                  Connect is given — a reviewer opens it with no credentials.
                  ABOVE the catch-all deliberately: below `path="*"` it would
                  redirect to sign-in and the reviewer would see a login wall
                  where the policy was promised. `standalone` makes the page
                  draw its own frame, heading, language toggle and way back,
                  because out here there is no shell to supply them. */}
              <Route path="/privacy" element={<Privacy standalone />} />
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
        {/* One boundary for all the lazy routes, INSIDE Shell so the rail,
            the header and sign-out survive a screen that crashes — the user
            can navigate out of the failure instead of being left on a page
            whose only control is Reload. `resetKey` is what makes that work:
            leaving the route clears the error. */}
        <ErrorBoundary resetKey={pathname}>
          <Suspense fallback={<LoadingSpinner />}>
            <Routes>
              {/* EVERYONE LANDS ON THE MAP, and the person no longer changes
                  the answer. The split used to send an admin to the map and a
                  member to Follow-ups, because the map could not answer "what
                  do I do now". It can now: `needs-me` is the DEFAULT lens and
                  its panel is the follow-ups list, real DOM, beside the canvas
                  — so the member's first screen is the list they had, and the
                  admin's is the picture they had, at one URL. */}
              <Route path="/" element={<Navigate to="/mindtree" replace />} />
              {/* Signed in, so the sign-in route is dead — send it home rather
                  than showing a form that cannot do anything. */}
              <Route path="/signin" element={<Navigate to="/mindtree" replace />} />
              <Route path="/mindtree" element={<Mindtree />} />
              {/* The entry as a PAGE — a URL somebody was sent. Every in-app
                  tap opens the same detail surface as an overlay instead, via
                  openEntry() and the host mounted at the root below. STAYS a
                  real route under the collapse: it is the target of every push
                  notification, chat link and phone share sheet. */}
              <Route path="/entry/:id" element={<Entry />} />
              {/* The PMO dashboard. No gate, deliberately: RLS decides what
                  SELECT returns and every row on it is a row the reader can
                  already reach from the map, so a permission key here would
                  withhold a copy of their own data — pages/settings/Export.tsx
                  makes the same argument for the same reason. */}
              <Route path="/pmo" element={<Pmo />} />
              {/* THE MODES, and the frame is applied HERE rather than inside
                  the five pages. Fast typing and a printed document both fight
                  a canvas, so these stay real routes — a route is exactly how
                  you leave and come back with Back, print and paste intact —
                  and `ModeFrame` is the single way back to the map.
                  WRAPPING AT THE ROUTE IS THE SAFE SHAPE, not merely the cheap
                  one: `startMeetingsRealtime()` is ref-counted by the two
                  screens that render lines and `flushLinePlans()` runs in the
                  triage screen's unmount cleanup, so a frame that changed where
                  those screens MOUNT would silently lose a second attendee's
                  lines or the last triage decision. `element=` cannot change
                  that, and it covers each page's early-return branches too.
                  `titleKey` is exactly what lib/routeTitle.ts resolves for the
                  same path, so the trail and the <main> landmark's name cannot
                  disagree. */}
              <Route
                path="/meetings"
                element={
                  <ModeFrame titleKey="route.meetings">
                    <MeetingsIndex />
                  </ModeFrame>
                }
              />
              {/* Ranked by React Router, not by order: '/meetings/:id/triage'
                  and '/meetings/:id/minutes' both out-rank '/meetings/:id'
                  because a static segment beats a dynamic one, so no id can be
                  read as a sub-screen and no sub-screen as an id. */}
              <Route
                path="/meetings/:id"
                element={
                  <ModeFrame titleKey="route.meeting" wide>
                    <MeetingLive />
                  </ModeFrame>
                }
              />
              <Route
                path="/meetings/:id/triage"
                element={
                  <ModeFrame titleKey="meeting.triage" wide>
                    <MeetingTriage />
                  </ModeFrame>
                }
              />
              <Route
                path="/meetings/:id/minutes"
                element={
                  <ModeFrame titleKey="route.minutes" wide>
                    <MeetingMinutes />
                  </ModeFrame>
                }
              />
              <Route
                path="/digest"
                element={
                  <ModeFrame titleKey="digest.title">
                    <Digest />
                  </ModeFrame>
                }
              />
              {/* The same page inside the shell: no `standalone`, so it draws
                  no <h1> of its own — the app header already renders one from
                  titleKeyFor(). */}
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/settings" element={<Settings />} />
              {/* Configuration hangs off /settings rather than taking a
                  top-level route: NAV is two rows and these screens are reached
                  from the Settings page. React Router ranks the
                  static '/new' above the dynamic ':id' regardless of order, so
                  creating cannot be mistaken for editing a track called "new".

                  Tracks are the top of the structure tree, so all three rows ask
                  for `structure.edit` — the key 0025 put on the `tracks` write
                  policies and on reorder_tracks()/delete_track_reassign(). */}
              <Route
                path="/settings/tracks"
                element={canEditStructure ? <TracksAdmin /> : <Navigate to="/settings" replace />}
              />
              <Route
                path="/settings/tracks/new"
                element={canEditStructure ? <TrackEditor /> : <Navigate to="/settings" replace />}
              />
              <Route
                path="/settings/tracks/:id"
                element={canEditStructure ? <TrackEditor /> : <Navigate to="/settings" replace />}
              />
              {/* Groups sit one level above tracks and are gated identically.
                  Renaming a group or moving a track between the two halves
                  changes what every other member's filters, board and digest
                  say, so it is structure work in the same sense the track editor
                  is — and 0025 says so too: `track_groups` writes take
                  `structure.edit`. 0018's RLS is the real authority; this only
                  avoids offering an editor to someone every write refuses. */}
              <Route
                path="/settings/groups"
                element={canEditStructure ? <GroupsAdmin /> : <Navigate to="/settings" replace />}
              />
              {/* The tree BELOW tracks, gated exactly as the tree above them is.
                  0023's RLS is the real authority (`map_nodes` writes take
                  `structure.edit` since 0025); this only avoids offering an
                  editor to someone every write refuses. */}
              <Route
                path="/settings/structure"
                element={
                  canEditStructure ? <StructureAdmin /> : <Navigate to="/settings" replace />
                }
              />
              {/* The Jira reader (read-only). Gated exactly like Structure:
                  it reads `map_nodes` and `use_cases` to match against, and the
                  edge function re-verifies the caller itself. */}
              <Route
                path="/settings/jira"
                element={canEditStructure ? <JiraAdmin /> : <Navigate to="/settings" replace />}
              />
              {/* The catalogue edits the WORDS the tree is described with, so
                  `vocab.edit` — 0025 puts `use_cases` on that key.

                  ⚠ IT IS THE ONE SCREEN 0025 SPLITS DOWN THE MIDDLE: its second
                    section writes `map_node_kinds`, which is `structure.edit`.
                    One key had to gate the route, and `vocab.edit` is the one
                    the screen is named for and the one its ten-row half writes.
                    Nobody is affected today — Admin and Director both hold both
                    keys, and no other role holds either — so this is recorded
                    rather than designed around. CatalogueAdmin.tsx's header
                    carries the same note and what to do if a vocab-only role is
                    ever minted. */}
              <Route
                path="/settings/catalogue"
                element={canEditVocab ? <CatalogueAdmin /> : <Navigate to="/settings" replace />}
              />
              {/* Roles decide what every OTHER gate answers, so this one is the
                  strictest of them, and it does NOT move to a narrower key. 0025
                  gates the two tables on has_perm('members.manage'), which only
                  the system Admin role carries; a Director who could edit
                  `role_permissions` would be one click from Admin. The screen
                  itself still reads the legacy `profiles.role`, which is
                  equivalent while only the system Admin role holds
                  `workspace.admin`. */}
              <Route
                path="/settings/roles"
                element={isAdmin ? <RolesAdmin /> : <Navigate to="/settings" replace />}
              />
              <Route
                path="/settings/vocabulary"
                element={canEditVocab ? <VocabularyAdmin /> : <Navigate to="/settings" replace />}
              />
              {/* Terminology rewrites what every screen SAYS, for everyone, so
                  it is gated exactly like the vocabulary editor above —
                  `label_overrides` writes and reset_label_overrides() both take
                  `vocab.edit`. 0017's RLS is the real authority; this only
                  avoids offering an editable list of 1,665 labels to someone
                  every write refuses. */}
              <Route
                path="/settings/terminology"
                element={canEditVocab ? <Terminology /> : <Navigate to="/settings" replace />}
              />
              {/* No permission ternary — see the lazy import. A member reads the
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
              {/* Per-user AI preferences: everybody's own switch, so not gated
                  either. The privacy statement on it is the reason it is a
                  screen rather than a line in the Settings list. */}
              <Route path="/settings/ai" element={<AiSettings />} />
              <Route path="/settings/notifications" element={<NotificationPrefs />} />
              {/* THE SEVEN COLLAPSED ROUTES LAND HERE. /capture, /followups,
                  /board, /tracks, /tracks/:id, /dashboard and /notifications
                  are gone, so an old bookmark, an old tab or a link somebody
                  pasted last week resolves to the map rather than to a blank
                  screen. The lens they wanted is one chip away, and the map is
                  where every one of those questions is now answered. */}
              <Route path="*" element={<Navigate to="/mindtree" replace />} />
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
