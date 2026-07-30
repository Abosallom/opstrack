/**
 * Capacitor shim — the ONLY module in src/ that knows the app can be a native
 * iOS binary. Everything it exports is a no-op on the web, so callers never
 * branch: `syncNativeChrome('dark')` is simply free in a browser tab.
 *
 * ── WHY THERE ARE NO STATIC `import`s OF `@capacitor/*` ────────────────────
 * The same `dist/` is served three ways: GitHub Pages, the installed PWA, and
 * the WKWebView inside `ios/`. A top-level `import { Capacitor } from
 * '@capacitor/core'` would put the bridge, its plugin registry and four plugin
 * web-shims into the entry chunk that every browser downloads — kilobytes that
 * can never run there, on the critical path of a sign-in screen.
 *
 * So detection reads the `Capacitor` object the native bridge injects on
 * `window` BEFORE any app JS evaluates, and the plugins are pulled in with
 * `await import(...)` behind that check. On the web those chunks are emitted
 * and never fetched; in the app they resolve from the same bundle with no
 * network. The only `@capacitor/*` import here is `import type`, which
 * `verbatimModuleSyntax` erases entirely.
 *
 * ── WHY EVERY PLUGIN CALL IS WRAPPED IN try/catch ─────────────────────────
 * A Capacitor plugin that is in package.json but was never `cap sync`ed into
 * the Xcode project REJECTS at call time ("not implemented"). That must degrade
 * to "the status bar keeps the system style", never to an unhandled rejection
 * that trips the app's ErrorBoundary. Chrome is cosmetic; the app is not.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ─────────────────────────────────────────
 * No React. No store imports. `src/lib/**` may not reach into `src/store/**` or
 * `src/api/**`, and this file has no reason to want to: it is a thin edge onto
 * the platform, and the composition root (src/main.tsx) decides when to call it.
 */

import type { CapacitorGlobal, PluginListenerHandle } from '@capacitor/core'
import type { AppPlugin } from '@capacitor/app'

/** 'web' covers a browser tab, the installed PWA, and any non-native host. */
export type NativePlatform = 'ios' | 'android' | 'web'

/** Matches the two values `src/lib/theme.ts` resolves `data-theme` to. */
export type ResolvedTheme = 'dark' | 'light'

/** Unsubscribe handle. Always safe to call, more than once, on any platform. */
export type Unsubscribe = () => void

const NOOP_UNSUBSCRIBE: Unsubscribe = () => {}

/**
 * The injected bridge, or null when this is not a native host.
 *
 * Read from `globalThis` on EVERY call rather than captured once at module
 * scope: this module is imported by node tests where there is no window at all,
 * and a captured `undefined` would make the whole shim untestable.
 */
function bridge(): CapacitorGlobal | null {
  const cap = (globalThis as typeof globalThis & { Capacitor?: CapacitorGlobal }).Capacitor
  if (!cap || typeof cap.isNativePlatform !== 'function') return null
  // A bridge object also exists when @capacitor/core is loaded in a plain
  // browser, and there it reports 'web'. isNativePlatform() is the only
  // trustworthy discriminator.
  return cap.isNativePlatform() ? cap : null
}

/** 'ios' | 'android' inside the app binary, 'web' everywhere else. */
export function nativePlatform(): NativePlatform {
  const cap = bridge()
  if (!cap) return 'web'
  const platform = cap.getPlatform()
  return platform === 'ios' || platform === 'android' ? platform : 'web'
}

/** True only inside the native binary. */
export function isNativeApp(): boolean {
  return nativePlatform() !== 'web'
}

/** Runs `job` only on native, swallowing plugin-missing rejections. */
function onNative(job: () => Promise<unknown>): void {
  if (!isNativeApp()) return
  void job().catch(() => {
    // Plugin absent from the native project, or the bridge rejected the call.
    // See the try/catch note in the file header: chrome is never load-bearing.
  })
}

/**
 * Point the native status bar at the app's theme.
 *
 * This is the native counterpart of the `<meta name="theme-color">` write in
 * `src/lib/theme.ts`, and it exists because that meta tag does nothing inside a
 * WKWebView. The app's theme is a USER preference with an 'auto' setting, so it
 * can legitimately disagree with the device appearance — an Arabic user reading
 * in forced-light mode on a dark phone gets white-on-white status text without
 * this call, i.e. an invisible clock and battery.
 *
 * `Style.Light` means "dark text, for a light background" and `Style.Dark`
 * means "light text, for a dark background" — the enum names the BACKGROUND,
 * not the glyphs, which is the opposite of how it reads. Getting this backwards
 * is the single most common Capacitor status-bar bug, hence the mapping is
 * spelled out rather than computed.
 */
export function syncNativeChrome(theme: ResolvedTheme): void {
  onNative(async () => {
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    await StatusBar.setStyle({ style: theme === 'light' ? Style.Light : Style.Dark })
  })
}

/**
 * Hide the launch splash.
 *
 * `capacitor.config.json` also sets `launchAutoHide: true` with a short
 * duration, and BOTH are intentional. Auto-hide is the floor: if this function
 * is never wired up, the app still reaches its own UI. This call is the
 * ceiling: once React has painted, there is no reason to keep showing a static
 * logo, so the composition root calls it and the splash goes away early.
 * Calling it after the auto-hide already fired is a no-op in the plugin.
 */
export function dismissNativeSplash(): void {
  onNative(async () => {
    const { SplashScreen } = await import('@capacitor/splash-screen')
    await SplashScreen.hide({ fadeOutDuration: 200 })
  })
}

/**
 * Subscribe to a native lifecycle event, returning an unsubscribe that is safe
 * to call before the async `addListener` has resolved.
 *
 * The `cancelled` flag is not defensive noise: React 19 StrictMode mounts an
 * effect, unmounts it and mounts it again in development, which reliably runs
 * the cleanup while the listener promise is still in flight. Without it the
 * first listener leaks and every resume fires the callback twice.
 */
function listen(register: (app: AppPlugin) => Promise<PluginListenerHandle>): Unsubscribe {
  if (!isNativeApp()) return NOOP_UNSUBSCRIBE
  let handle: PluginListenerHandle | null = null
  let cancelled = false
  onNative(async () => {
    const { App } = await import('@capacitor/app')
    const registered = await register(App)
    if (cancelled) await registered.remove()
    else handle = registered
  })
  return () => {
    cancelled = true
    const pending = handle
    handle = null
    void pending?.remove()
  }
}

/**
 * Fires when the app returns to the foreground.
 *
 * Worth wiring: iOS freezes the WKWebView's timers and drops the Supabase
 * Realtime socket while backgrounded, so an app resumed after lunch shows
 * whatever the board looked like before lunch — with no spinner to suggest
 * otherwise. That is precisely the stale state this product exists to prevent.
 */
export function onNativeResume(callback: () => void): Unsubscribe {
  return listen((app) => app.addListener('resume', callback))
}

/** Fires when the app is backgrounded. Useful for flushing a draft. */
export function onNativePause(callback: () => void): Unsubscribe {
  return listen((app) => app.addListener('pause', callback))
}

/**
 * Android hardware back button. Included for completeness and because leaving
 * it out is how an Android build later ships with back closing the app from a
 * half-filled capture form. On iOS this never fires, at zero cost.
 */
export function onNativeBack(callback: () => void): Unsubscribe {
  return listen((app) => app.addListener('backButton', callback))
}

/**
 * One-call entry point for the composition root.
 *
 * Stamps `data-native="ios"` on `<html>` so stylesheets can tell a WKWebView
 * from a browser tab without importing anything — the case that needs it is
 * rubber-band overscroll, which reads as a rendering bug in an app and as
 * normal in Safari — and dismisses the splash now that the shell has painted.
 *
 * Returns void, not a promise: main.tsx must not await platform chrome before
 * rendering, and there is nothing useful to do if it fails.
 */
export function initNative(): void {
  const platform = nativePlatform()
  if (platform === 'web') return
  if (typeof document !== 'undefined') document.documentElement.dataset.native = platform
  dismissNativeSplash()
}
