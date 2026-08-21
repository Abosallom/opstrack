// Theme preference: 'auto' follows the OS, otherwise force dark/light.

import { writeRawCache } from './cache'
import { syncNativeChrome } from './native'
// Imported for its module-scope side effect as much as for the function: the
// `opstrack_` → `nphiescore_` copy has to have happened before the line below
// reads its key. See lib/storageMigration.ts, decision 1.
import { readWithLegacyFallback } from './storageMigration'

export type ThemePref = 'auto' | 'dark' | 'light'

const KEY = 'nphiescore_theme'

export function getThemePref(): ThemePref {
  // The value is a bare word (`dark`), not JSON, and has been since Wave 1 —
  // hence the raw read rather than readCache. The legacy fallback is the
  // belt-and-braces half of the prefix rename: it costs one `getItem` on a
  // miss and makes "opens once in the wrong theme" impossible even if the
  // migration was refused by a full store.
  const v = readWithLegacyFallback(KEY)
  return v === 'dark' || v === 'light' ? v : 'auto'
}

export function setThemePref(p: ThemePref): void {
  // Through lib/cache.ts rather than a bare `setItem`: this used to be the one
  // storage write in the app with no try/catch around it, so choosing a theme
  // in Safari's private mode threw out of the click handler.
  writeRawCache(KEY, p)
  applyTheme()
}

export function applyTheme(): void {
  const pref = getThemePref()
  const light =
    pref === 'light' ||
    (pref === 'auto' && window.matchMedia('(prefers-color-scheme: light)').matches)
  document.documentElement.dataset.theme = light ? 'light' : 'dark'

  // Keep the browser/status-bar chrome in sync with the app theme so the
  // installed PWA reads as native instead of showing a stale-coloured bar.
  //
  // THESE TWO LITERALS MUST EQUAL --bg IN src/styles/global.css, and until the
  // v1.0.0 release smoke neither of them did: dark was #0f1115 against a real
  // --bg of #101519, light was #f7f8fa against #f4f6f8. The comment asserting
  // the invariant has been here since Wave 1; nothing checked it, and nothing
  // can — a CSS custom property is not readable from module scope, and reading
  // it from the live document would make this function depend on the very
  // stylesheet load it runs before. So the check is the release smoke, and the
  // measurement is `getComputedStyle(document.documentElement)
  // .getPropertyValue('--bg')` in each theme against these strings.
  //
  // The cost of the drift was small and permanent: a status bar three shades
  // off the app's own background at the top of every installed PWA, which is
  // precisely the seam that makes a web app read as a web app.
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.name = 'theme-color'
    document.head.appendChild(meta)
  }
  meta.content = light ? '#f4f6f8' : '#101519'

  // The meta tag above does nothing inside a WKWebView, and capacitor.config.json
  // sets `overlaysWebView: true` — so on iOS the system status bar sits ON TOP of
  // the app's own header and keeps whatever glyph colour it started with. A user
  // reading in forced-light mode on a dark phone gets white-on-white: an
  // invisible clock and battery over our own toolbar. This call is the native
  // half of the two lines above, and it belongs here rather than at a single
  // startup site because the theme changes at runtime — from the settings
  // toggle, and from the 'auto' listener below when the OS flips at sunset.
  //
  // No-op on the web, by construction: see lib/native.ts.
  syncNativeChrome(light ? 'light' : 'dark')
}

// 'auto' has to react to the OS flipping at sunset while the tab is open —
// without this listener the app keeps yesterday's theme until a reload.
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (getThemePref() === 'auto') applyTheme()
  })
}
