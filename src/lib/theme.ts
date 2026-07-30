// Theme preference: 'auto' follows the OS, otherwise force dark/light.

import { syncNativeChrome } from './native'

export type ThemePref = 'auto' | 'dark' | 'light'

const KEY = 'opstrack_theme'

export function getThemePref(): ThemePref {
  const v = localStorage.getItem(KEY)
  return v === 'dark' || v === 'light' ? v : 'auto'
}

export function setThemePref(p: ThemePref): void {
  localStorage.setItem(KEY, p)
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
  // These values must match --bg in src/styles/global.css.
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.name = 'theme-color'
    document.head.appendChild(meta)
  }
  meta.content = light ? '#f7f8fa' : '#0f1115'

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
