/// <reference types="vite-plugin-pwa/client" />
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './styles/global.css'
import App from './App'
import { applyTheme } from './lib/theme'
import { applyLocale, t } from './lib/i18n'
import { initNative } from './lib/native'
import { initAuth } from './store/auth'
import { setEntriesSubmit, settleOutboxWrite } from './store/entries'
import { setMeetingsSubmit } from './store/meetings'
import { setNotificationsSubmit } from './store/notifications'
import { setOutboxSettle, startOutboxSync, submit } from './store/outbox'
import { toast } from './components/toast'

// Theme and direction are applied BEFORE the first render so the very first
// paint is already correct. Doing it inside a component meant one frame of
// dark-on-LTR before an Arabic light-mode user's preference took effect, which
// reads as a flicker on every cold start.
// (lib/theme.ts installs its own prefers-color-scheme listener at module scope,
// so 'auto' keeps tracking the OS without any wiring here.)
applyTheme()
applyLocale()

// Platform chrome for the iOS build: stamps `data-native="ios"` on <html> and
// dismisses the launch splash now that the shell is about to paint. Every export
// of lib/native.ts is a no-op in a browser tab and in the installed PWA, so this
// costs a `typeof window.Capacitor` check on the web and nothing else — the
// Capacitor plugins are behind `await import(...)` inside that module and are
// never fetched here. applyTheme() above pushes the resolved theme at the native
// status bar on its own, including when 'auto' flips at sunset.
initNative()

// Restores the persisted Supabase session and starts listening for auth state
// changes. Safe to call with no credentials configured: it just settles into a
// signed-out state instead of throwing.
//
// THERE IS NO EXTERNAL-IDP GUARD BESIDE IT ANY MORE, and its absence is a
// decision rather than an omission. Wave 4b shipped `installSsoGuard(supabase)`
// on the next line: Microsoft Entra authenticates a whole tenant, so any employee
// could complete a sign-in, and the guard existed to sign an `azure` session with
// no `profiles` row straight back out. WAVE5-NOTES §2 cancelled the provider —
// "I don't want to sign in using the company's active directory; I want my own
// directory to be set by the admin" — so the Members screen (admin-provisioned
// usernames + one-time invite codes) IS this product's directory, and the whole
// SSO path went with it. Every session that can now exist was minted against an
// account an admin created, so there is no tenant-wide population to filter out
// and nothing here to install. Membership is enforced where it always was, by
// RLS. If an external IdP is ever revived, the guard comes back HERE, at the
// composition root, for the reason its old comment gave: an OAuth redirect adopts
// its session at module init and renders the signed-in shell, so a guard mounted
// from the sign-in screen would never run on the one path that needs it.
initAuth()

// Point the stores' write seams at the real outbox, and point the outbox's
// settle back at the entries store.
//
// Both stores ship with a send-now default because store/outbox.ts belonged to a
// different worker while all three were being written, and a direct import would
// have been an ownership violation for the length of the wave. The injection
// points are resolved HERE rather than by making those imports now, because the
// composition root is where a swappable transport belongs — and because it keeps
// each store importable from a node test without dragging the queue, its
// `online` listener and every api/ write function in behind it.
//
// The effect is that every write — an entry, a thread post, a notification
// marked read — queues while offline instead of failing, and lands back in its
// store when the queue drains. Contracts rule 3 has no exceptions.
//
// ALL FOUR LINES ARE ONE WIRING, and wiring only some of them is worse than
// wiring none. Without `setEntriesSubmit`, `store/entries.ts` called
// `api/entries.ts` directly and an offline capture was DESTROYED rather than
// queued: the fetch failed, pgErrorKey() saw no code, the caller read
// 'common.error' instead of 'offline.queued' and rolled the optimistic row back.
// Without `setOutboxSettle`, the write that eventually drained never reached the
// store, and the temp row stayed on screen stamped "queued" beside the real row
// forever.
//
// `setMeetingsSubmit` was the line Wave 3 forgot, and meeting mode is the
// feature that needs it most: with the store still on its send-now default,
// startMeeting() hit the network in a room with no wifi, failed, and dropped
// the optimistic meeting — so a meeting could not be STARTED offline at all,
// and every line typed into one came back as an error. It is added here
// together with the four `meetings`/`meeting_lines` routes in store/outbox.ts,
// because either half alone breaks the feature: an unregistered route answers
// 'common.error' for every write, online or off. src/store/outbox.test.ts
// asserts both halves off the source so the pairing cannot drift again.
setEntriesSubmit(submit)
setMeetingsSubmit(submit)
setNotificationsSubmit(submit)
setOutboxSettle(settleOutboxWrite)

// Install the flush triggers — `online`, tab-visible, and the bounded backoff
// timer — and drain whatever the last session left in `opstrack_outbox_v1`.
//
// This is the line that makes 'offline.queued' true. The queue itself only ever
// sends when something asks it to, and until Wave 4 the only thing that asked
// was the `online` event: a write that failed on a server error, a rate limit or
// an RLS hiccup sat in the queue, invisible, until the device next transitioned
// offline→online — which on a desktop that never leaves wifi is never.
//
// Not disposed of on unload: the listeners live exactly as long as the document,
// and the returned teardown exists for tests rather than for a caller here.
startOutboxSync()

/** Background re-check cadence for a tab nobody closes. */
const SW_CHECK_EVERY_MS = 6 * 60 * 60 * 1000
/**
 * Floor between two re-checks. `visibilitychange` fires on every alt-tab, and
 * without this an app kept beside a mail client would refetch the worker script
 * dozens of times an hour, on cellular, to learn nothing.
 */
const SW_CHECK_MIN_GAP_MS = 5 * 60 * 1000

/**
 * Service worker registration with a "new version available" prompt.
 *
 * PROD only — in dev it fights Vite's HMR and serves stale modules.
 *
 * The prompt is a sticky toast rather than an auto-reload: a silent reload
 * mid-capture would discard whatever the user was typing, and capture is the
 * screen this app lives on. It is raised under a KEY so that a tab which sees
 * several deploys keeps one prompt rather than a growing pile of identical
 * ones, and it is re-checked for on resume so it appears at all.
 */
if (import.meta.env.PROD) {
  void import('virtual:pwa-register')
    .then(({ registerSW }) => {
      const updateSW = registerSW({
        onNeedRefresh() {
          toast(t('pwa.updateReady'), {
            // The key is load-bearing, not a nicety. onNeedRefresh fires once
            // per waiting worker, so a tab open across two deploys — exactly
            // the tab the re-check below creates more of — raised a SECOND
            // identical sticky prompt that stacked under the first and never
            // expired. Keyed, the second raise replaces the first in place, so
            // there is one prompt on screen however many versions ship while
            // the tab is open. Its button always drives the latest `updateSW`,
            // which skips whatever is waiting now.
            key: 'sw-update',
            duration: 0,
            action: {
              label: t('common.reload'),
              onClick: () => {
                void updateSW(true)
              },
            },
          })
        },
        // No onOfflineReady toast: "ready to work offline" fires once on first
        // install, tells the user nothing they asked for, and lands on top of
        // the sign-in form.

        // WITHOUT THIS THE PROMPT ABOVE BARELY EVER APPEARS. The browser checks
        // for a new worker on navigation, and this app is a HashRouter PWA:
        // every route change is a hashchange, and an installed app is opened
        // once and then lives in the app switcher for weeks. So the session
        // that most needs an update is the one that never asks for one, and a
        // shipped release reached those users only when they force-quit.
        //
        // Two triggers, because each covers what the other cannot: coming back
        // to the tab (the common case — phone unlocked, app resumed, deploy
        // happened over lunch) and a long interval for a tab that is simply
        // left visible on a second monitor all week.
        onRegisteredSW(_swScriptUrl, registration) {
          if (!registration) return
          let last = Date.now()
          const check = (): void => {
            last = Date.now()
            // Rejects when offline, which is the normal state this app is built
            // for — it is not an error and there is nothing to tell the user.
            // The next trigger tries again.
            void registration.update().catch(() => {})
          }
          window.setInterval(check, SW_CHECK_EVERY_MS)
          document.addEventListener('visibilitychange', () => {
            if (document.visibilityState !== 'visible') return
            if (Date.now() - last < SW_CHECK_MIN_GAP_MS) return
            check()
          })
        },
      })
    })
    .catch(() => {
      // No service worker in this build (or the browser blocked it). The app
      // works fine online without one, so this is not worth surfacing.
    })
}

// HashRouter, not BrowserRouter: GitHub Pages is static hosting with no URL
// rewriting, so a deep link like /followups would 404 on refresh.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)
