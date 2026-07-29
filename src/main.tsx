/// <reference types="vite-plugin-pwa/client" />
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './styles/global.css'
import App from './App'
import { applyTheme } from './lib/theme'
import { applyLocale, t } from './lib/i18n'
import { initAuth } from './store/auth'
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
