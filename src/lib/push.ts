// Web Push, browser side. Capability verdicts, the second service worker, and
// the PushManager dance — and nothing else.
//
// LAYERING. This module is in `src/lib/`, so it may not import from `src/api/`
// or `src/store/` (plan §1.0, enforced by a standing grep). It therefore never
// touches Supabase: it hands `store/push.ts` three opaque strings and that store
// is what persists them. Everything here is browser API and pure logic, which is
// also what makes the decision table below testable in a node environment.
//
// IT NEVER PROMPTS. `Notification.requestPermission()` is called from exactly one
// place — `requestPermission()` — and the only caller of that is a button click
// in NotificationPrefs.tsx. This is not politeness: Chrome and Safari both
// permanently blacklist an origin that prompts without user intent, and a
// "denied" from a prompt the user never asked for cannot be undone by the app at
// all. The user has to be able to read what they are agreeing to first, decide,
// and only then see the OS dialog.

import { isNativeApp, nativePlatform } from './native'

/**
 * The VAPID public key of the `send-push` edge function's keypair.
 *
 * NOT A SECRET. It is the identity half of the pair: the browser hands it to its
 * push service at subscribe time so the service can verify that later pushes are
 * signed by us, which means it has to ship in the bundle. The private half
 * exists only as the function's `VAPID_PRIVATE_KEY` secret — never in this repo,
 * never in `.env`, never in the database.
 *
 * A CONSTANT WITH AN ENV OVERRIDE, in that order of preference. The GitHub Pages
 * build only injects `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, so a key
 * that lived ONLY in the environment would be empty in production and push would
 * be quietly unavailable there. The override exists so a second project (or a
 * rotation) does not need a code change.
 */
const DEFAULT_VAPID_PUBLIC_KEY =
  'BAYwGF6SUVNWwahS1oXHQwCFpCZrqlQ_xQtSG_l474MOAVT5TFquLFPkcYDvR4C6VA8RD-kocQ2HtuGYezwb-xc'

export const VAPID_PUBLIC_KEY: string =
  (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined)?.trim() || DEFAULT_VAPID_PUBLIC_KEY

/** Where the push worker lives. See public/push/sw.js for why it is its own scope. */
const WORKER_PATH = 'push/sw.js'

/* ─────────────────────────── the capability verdict ─────────────────────── */

/**
 * What this browser can do, as one value the UI can switch on.
 *
 * `needsInstall` is the one that earns the type. On iOS, Safari exposes the Push
 * API **only to a site that has been added to the Home Screen** — in a normal
 * tab `window.PushManager` does not exist at all. Reporting that as
 * "unsupported" would be false and unhelpable; reporting it as "needs install"
 * is true and comes with instructions the user can follow.
 */
export type PushVerdict =
  /** Everything is present. Permission may still be 'default'. */
  | 'ready'
  /** iOS Safari, not yet installed to the Home Screen. Fixable by the user. */
  | 'needsInstall'
  /** The user (or a policy) said no. Only the browser's own UI can undo it. */
  | 'blocked'
  /** No Push API here at all, and nothing the user can do about it. */
  | 'unsupported'

/** The browser facts the verdict is derived from. Injectable so it can be tested. */
export interface PushEnvironment {
  hasServiceWorker: boolean
  hasPushManager: boolean
  hasNotification: boolean
  permission: NotificationPermission
  /** iOS or iPadOS, in Safari or an installed PWA — not the Capacitor build. */
  isIos: boolean
  /** Running as an installed app (Home Screen / standalone display mode). */
  isStandalone: boolean
  /** The Capacitor iOS wrapper, where Web Push does not exist. */
  isNative: boolean
}

/**
 * Environment → verdict. Pure, total, and ORDER-DEPENDENT — the comment on each
 * branch is why it sits where it does.
 */
export function verdictFor(env: PushEnvironment): PushVerdict {
  // The Capacitor WKWebView has no Push API and never will: native push there
  // means APNs and a Capacitor plugin, which is a different feature. Checked
  // FIRST because the native build also reports `isIos`, and telling someone to
  // "add this to your Home Screen" inside an installed native app is nonsense.
  if (env.isNative) return 'unsupported'
  // Before the capability checks, because on iOS the capabilities are ABSENT
  // until the app is installed. Testing `hasPushManager` first would answer
  // "unsupported" to every iPhone user in Safari, which is the majority of them.
  if (env.isIos && !env.isStandalone) return 'needsInstall'
  if (!env.hasServiceWorker || !env.hasPushManager || !env.hasNotification) return 'unsupported'
  // Last, because 'denied' is only interesting once we know the feature exists.
  if (env.permission === 'denied') return 'blocked'
  return 'ready'
}

/** Read the live environment. Guarded for the node test environment throughout. */
export function readEnvironment(): PushEnvironment {
  const nav: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator
  const win: Window | undefined = typeof window === 'undefined' ? undefined : window
  return {
    hasServiceWorker: nav !== undefined && 'serviceWorker' in nav,
    hasPushManager: win !== undefined && 'PushManager' in win,
    hasNotification: win !== undefined && 'Notification' in win,
    permission:
      win !== undefined && 'Notification' in win ? window.Notification.permission : 'default',
    isIos: nativePlatform() !== 'ios' && isIosBrowser(nav),
    isStandalone: isStandaloneDisplay(win, nav),
    isNative: isNativeApp(),
  }
}

/**
 * iOS/iPadOS detection, and it has to be user-agent sniffing.
 *
 * There is no feature test for "this is the browser engine whose Push API is
 * gated on being installed" — that IS the platform quirk. iPadOS 13+ reports a
 * macOS user agent, hence the `maxTouchPoints` arm; a Mac has 0.
 */
function isIosBrowser(nav: Navigator | undefined): boolean {
  if (!nav) return false
  const ua = nav.userAgent
  if (/iP(hone|od|ad)/.test(ua)) return true
  return /Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1
}

/** Installed-app detection. `navigator.standalone` is the iOS-only half. */
function isStandaloneDisplay(win: Window | undefined, nav: Navigator | undefined): boolean {
  if (!win) return false
  const iosStandalone = (nav as (Navigator & { standalone?: boolean }) | undefined)?.standalone
  if (iosStandalone === true) return true
  return typeof win.matchMedia === 'function'
    ? win.matchMedia('(display-mode: standalone)').matches
    : false
}

/* ───────────────────────────── the applicationServerKey ─────────────────── */

/**
 * base64url → the `Uint8Array` `pushManager.subscribe()` demands.
 *
 * It will not take the string. Chrome throws
 * `InvalidCharacterError` and Firefox `TypeError`, both from inside subscribe(),
 * which reads like a key problem rather than a type problem — so this conversion
 * is the one piece of boilerplate every web-push client carries.
 *
 * The return type is `Uint8Array<ArrayBuffer>`, not the bare `Uint8Array`, and
 * that is load-bearing under TypeScript 6: typed arrays are generic over their
 * buffer now, `BufferSource` demands a real `ArrayBuffer`, and the default
 * `ArrayBufferLike` widens to include `SharedArrayBuffer` — which
 * `pushManager.subscribe()` will not accept.
 */
export function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padded = base64Url.replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** The reverse, for the two subscription keys, which arrive as ArrayBuffers. */
export function arrayBufferToBase64Url(buffer: ArrayBuffer | null): string {
  if (!buffer) return ''
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/* ────────────────────────────── device labels ───────────────────────────── */

/**
 * A user-agent string → something a person recognises in a device list.
 *
 * Deliberately coarse. The list exists to answer "is this the phone I am holding
 * or the laptop at the office?", and a full UA string answers that worse than
 * three words do. Never used for behaviour — only ever displayed.
 */
export function describeDevice(userAgent: string): string {
  const ua = userAgent
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Chrome\//.test(ua) && !/Chromium/.test(ua)
        ? 'Chrome'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Safari\//.test(ua)
            ? 'Safari'
            : ''
  const platform = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Macintosh|Mac OS X/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows'
            : /Linux/.test(ua)
              ? 'Linux'
              : ''
  // On iOS every browser is Safari underneath and reports it, so naming the
  // browser there would be a lie about which app the notification came from.
  const parts = platform === 'iPhone' || platform === 'iPad' ? [platform] : [platform, browser]
  return parts.filter(Boolean).join(' · ')
}

/* ─────────────────────────── the service worker ─────────────────────────── */

/**
 * Register (or find) the push worker.
 *
 * Resolved against `document.baseURI` rather than a leading slash: this app is
 * served from `/opstrack/` on GitHub Pages and from `/` in dev, and an absolute
 * `/push/sw.js` would 404 in production — the single most likely way this feature
 * would ship broken.
 *
 * The scope is left at the script's own directory (`…/push/`), which is what
 * keeps this registration from colliding with workbox's at `…/`. See the header
 * of public/push/sw.js.
 */
export async function registerPushWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  const url = new URL(WORKER_PATH, document.baseURI).href
  try {
    return await navigator.serviceWorker.register(url)
  } catch (e) {
    console.warn('[push] worker registration failed:', (e as Error).message)
    return null
  }
}

/** The registration if it already exists, without creating one. */
export async function existingPushWorker(): Promise<ServiceWorkerRegistration | undefined> {
  if (!('serviceWorker' in navigator)) return undefined
  const scope = new URL('push/', document.baseURI).href
  const all = await navigator.serviceWorker.getRegistrations()
  return all.find((r) => r.scope === scope)
}

/* ──────────────────────────── permission + subscribe ────────────────────── */

/**
 * Ask the OS. CALLED ONLY FROM A CLICK — see the module header.
 *
 * Safari's older signature is callback-only; the promise form is what every
 * current engine returns, and `Promise.resolve` absorbs the difference.
 */
export async function requestPermission(): Promise<NotificationPermission> {
  if (typeof Notification === 'undefined') return 'denied'
  return Promise.resolve(Notification.requestPermission())
}

/** The three strings the server needs, in the shape `push_subscriptions` stores. */
export interface DeviceSubscription {
  endpoint: string
  p256dh: string
  auth: string
  userAgent: string
}

function toDeviceSubscription(sub: PushSubscription): DeviceSubscription | null {
  const endpoint = sub.endpoint
  const p256dh = arrayBufferToBase64Url(sub.getKey('p256dh'))
  const auth = arrayBufferToBase64Url(sub.getKey('auth'))
  // A subscription missing either key cannot be encrypted for, so it is worse
  // than useless: it would occupy a row and fail every send until it expired.
  if (!endpoint || !p256dh || !auth) return null
  return {
    endpoint,
    p256dh,
    auth,
    userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
  }
}

/**
 * Subscribe this device, reusing the browser's existing subscription if it has
 * one for our key.
 *
 * `userVisibleOnly: true` is not optional — Chrome refuses any other value — and
 * it is also a promise this app keeps: every push it sends shows a notification.
 *
 * A subscription made under a DIFFERENT applicationServerKey (a rotated VAPID
 * pair, or a leftover from another project on `localhost`) cannot be reused and
 * cannot be re-keyed. It is unsubscribed and replaced, which is the only way out
 * of `InvalidStateError: A subscription with a different applicationServerKey
 * already exists`.
 */
export async function subscribeThisDevice(): Promise<DeviceSubscription | null> {
  const registration = (await existingPushWorker()) ?? (await registerPushWorker())
  if (!registration) return null
  // On a first registration the worker may still be installing; subscribing
  // before it is active throws in Firefox.
  await navigator.serviceWorker.ready.catch(() => undefined)

  const wanted = urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
  const existing = await registration.pushManager.getSubscription()
  if (existing) {
    const same = arrayBufferToBase64Url(existing.options.applicationServerKey ?? null)
    if (same === VAPID_PUBLIC_KEY) return toDeviceSubscription(existing)
    await existing.unsubscribe().catch(() => undefined)
  }

  try {
    const sub = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      // BufferSource: some TS lib versions type this as `BufferSource | string`
      // and some as only the former; the Uint8Array satisfies both.
      applicationServerKey: wanted,
    })
    return toDeviceSubscription(sub)
  } catch (e) {
    console.warn('[push] subscribe failed:', (e as Error).message)
    return null
  }
}

/** The current subscription for this device, if the browser holds one. */
export async function currentDeviceSubscription(): Promise<DeviceSubscription | null> {
  const registration = await existingPushWorker()
  if (!registration) return null
  const sub = await registration.pushManager.getSubscription()
  return sub ? toDeviceSubscription(sub) : null
}

/**
 * Drop this device's subscription at the browser.
 *
 * Returns the endpoint it removed so the caller can delete the matching row. The
 * two halves are separate on purpose: the row must go even if `unsubscribe()`
 * fails, because a row the browser has forgotten is a row that produces a 410 on
 * every future send.
 */
export async function unsubscribeThisDevice(): Promise<string | null> {
  const registration = await existingPushWorker()
  if (!registration) return null
  const sub = await registration.pushManager.getSubscription()
  if (!sub) return null
  const endpoint = sub.endpoint
  await sub.unsubscribe().catch(() => undefined)
  return endpoint
}
