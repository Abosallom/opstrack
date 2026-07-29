// Theme preference: 'auto' follows the OS, otherwise force dark/light.

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
}

// 'auto' has to react to the OS flipping at sunset while the tab is open —
// without this listener the app keeps yesterday's theme until a reload.
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (getThemePref() === 'auto') applyTheme()
  })
}
