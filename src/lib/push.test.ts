// Web Push, the parts a node environment can prove.
//
// The three things worth testing here are the three that fail SILENTLY in a
// browser: a verdict that answers "unsupported" to a whole platform, a
// base64url conversion that produces a key the push service quietly rejects, and
// a device label that reads as a user-agent string in a settings list.
//
// The crypto is NOT tested here — it lives in the edge function and is pinned to
// the worked example in RFC 8291 §5 by the harness in RUNBOOK §9.5, which is a
// stronger check than anything this file could assert.

import { describe, expect, it } from 'vitest'
import {
  arrayBufferToBase64Url,
  describeDevice,
  urlBase64ToUint8Array,
  verdictFor,
  VAPID_PUBLIC_KEY,
  type PushEnvironment,
} from './push'

/** A browser that can do everything, as the baseline to deviate from. */
const CAPABLE: PushEnvironment = {
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
  permission: 'default',
  isIos: false,
  isStandalone: false,
  isNative: false,
}

describe('verdictFor', () => {
  it('admits a capable browser that has not been asked yet', () => {
    expect(verdictFor(CAPABLE)).toBe('ready')
  })

  it('admits a capable browser that already granted', () => {
    expect(verdictFor({ ...CAPABLE, permission: 'granted' })).toBe('ready')
  })

  it('reports a denial as blocked, not unsupported', () => {
    // The two are different screens: 'blocked' tells the user where to undo it,
    // 'unsupported' tells them there is nothing to undo.
    expect(verdictFor({ ...CAPABLE, permission: 'denied' })).toBe('blocked')
  })

  it('tells an iOS browser to install BEFORE noticing the API is missing', () => {
    // THE ORDERING BUG THIS EXISTS TO PREVENT. On iOS Safari, `window.PushManager`
    // does not exist until the site is on the Home Screen — so a capability check
    // placed first answers "unsupported" to every iPhone in the company, which is
    // both false and unactionable.
    expect(
      verdictFor({
        ...CAPABLE,
        isIos: true,
        isStandalone: false,
        hasPushManager: false,
        hasServiceWorker: false,
      }),
    ).toBe('needsInstall')
  })

  it('admits the same iPhone once it is installed', () => {
    expect(verdictFor({ ...CAPABLE, isIos: true, isStandalone: true })).toBe('ready')
  })

  it('never asks the Capacitor build to install itself', () => {
    // The native wrapper reports iOS too, and "add this to your Home Screen"
    // inside an already-installed native app is nonsense. Web Push does not
    // exist in a WKWebView, so the honest answer is 'unsupported'.
    expect(verdictFor({ ...CAPABLE, isNative: true, isIos: true, isStandalone: true })).toBe(
      'unsupported',
    )
  })

  it.each([
    ['no service worker', { hasServiceWorker: false }],
    ['no PushManager', { hasPushManager: false }],
    ['no Notification', { hasNotification: false }],
  ])('reports %s as unsupported on a non-iOS browser', (_label, patch) => {
    expect(verdictFor({ ...CAPABLE, ...patch })).toBe('unsupported')
  })

  it('prefers "unsupported" over "blocked" when the API is absent', () => {
    // A denial recorded by a browser with no Push API is not a fact about push,
    // and offering "unblock it in your settings" would send the user somewhere
    // that cannot help.
    expect(verdictFor({ ...CAPABLE, hasPushManager: false, permission: 'denied' })).toBe(
      'unsupported',
    )
  })
})

describe('urlBase64ToUint8Array', () => {
  it('decodes the shipped VAPID public key to a 65-byte uncompressed point', () => {
    // The single most valuable assertion in this file. A P-256 public key in raw
    // form is 65 bytes starting with 0x04; anything else means the constant has
    // been truncated or re-encoded, and `subscribe()` fails at runtime with an
    // error that names the character, not the cause.
    const bytes = urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    expect(bytes.length).toBe(65)
    expect(bytes[0]).toBe(0x04)
  })

  it('accepts the base64url alphabet and unpadded input', () => {
    // '-' and '_' stand in for '+' and '/', and push services never pad.
    expect([...urlBase64ToUint8Array('-_8')]).toEqual([0xfb, 0xff])
    expect([...urlBase64ToUint8Array('AQID')]).toEqual([1, 2, 3])
  })

  it('round-trips through arrayBufferToBase64Url', () => {
    const bytes = urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    // A copy into a standalone ArrayBuffer, which is what `getKey()` hands back.
    const buffer = bytes.slice().buffer
    expect(arrayBufferToBase64Url(buffer)).toBe(VAPID_PUBLIC_KEY)
  })

  it('treats a missing key as empty rather than throwing', () => {
    // `PushSubscription.getKey()` is typed as nullable and really is null for a
    // subscription made without encryption keys.
    expect(arrayBufferToBase64Url(null)).toBe('')
  })
})

describe('describeDevice', () => {
  it.each([
    [
      'iPhone Safari',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
      'iPhone',
    ],
    [
      'Mac Chrome',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Mac · Chrome',
    ],
    [
      'Windows Edge',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
      'Windows · Edge',
    ],
    [
      'Android Firefox',
      'Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0',
      'Android · Firefox',
    ],
  ])('%s', (_name, ua, expected) => {
    expect(describeDevice(ua)).toBe(expected)
  })

  it('names no browser on iOS, because every one of them is Safari', () => {
    // Chrome on iOS is WebKit and reports both CriOS and Safari. Labelling that
    // row "iPhone · Chrome" would claim the notification arrives in Chrome, and
    // it does not — it arrives in the installed PWA.
    const criOS =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1'
    expect(describeDevice(criOS)).toBe('iPhone')
  })

  it('returns an empty label rather than a guess for an unknown agent', () => {
    // The UI substitutes t('push.unknownDevice') for this, which is honest;
    // echoing the raw agent string into a settings list is not.
    expect(describeDevice('curl/8.4.0')).toBe('')
    expect(describeDevice('')).toBe('')
  })
})
