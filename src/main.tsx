/// <reference types="vite-plugin-pwa/client" />
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './styles/global.css'
import App from './App'
import { applyTheme } from './lib/theme'
import { applyLocale, t } from './lib/i18n'
import { initAuth } from './store/auth'
import { setEntriesSubmit, settleOutboxWrite } from './store/entries'
import { setNotificationsSubmit } from './store/notifications'
import { setOutboxSettle, submit } from './store/outbox'
import { toast } from './components/toast'

// Theme and direction are applied BEFORE the first render so the very first
// paint is already correct. Doing it inside a component meant one frame of
// dark-on-LTR before an Arabic light-mode user's preference took effect, which
// reads as a flicker on every cold start.
// (lib/theme.ts installs its own prefers-color-scheme listener at module scope,
// so 'auto' keeps tracking the OS without any wiring here.)
applyTheme()
applyLocale()

// Restores the persisted Supabase session and starts listening for auth state
// changes. Safe to call with no credentials configured: it just settles into a
// signed-out state instead of throwing.
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
// ALL THREE LINES ARE ONE WIRING, and wiring only two of them is worse than
// wiring none. Without `setEntriesSubmit`, `store/entries.ts` called
// `api/entries.ts` directly and an offline capture was DESTROYED rather than
// queued: the fetch failed, pgErrorKey() saw no code, the caller read
// 'common.error' instead of 'offline.queued' and rolled the optimistic row back.
// Without `setOutboxSettle`, the write that eventually drained never reached the
// store, and the temp row stayed on screen stamped "queued" beside the real row
// forever.
setEntriesSubmit(submit)
setNotificationsSubmit(submit)
setOutboxSettle(settleOutboxWrite)

/**
 * Service worker registration with a "new version available" prompt.
 *
 * PROD only — in dev it fights Vite's HMR and serves stale modules.
 *
 * The prompt is a sticky toast rather than an auto-reload: a silent reload
 * mid-capture would discard whatever the user was typing, and capture is the
 * screen this app lives on.
 */
if (import.meta.env.PROD) {
  void import('virtual:pwa-register')
    .then(({ registerSW }) => {
      const updateSW = registerSW({
        onNeedRefresh() {
          toast(t('pwa.updateReady'), {
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
