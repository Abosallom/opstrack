import { afterEach, describe, expect, it } from 'vitest'
import type { CapacitorGlobal } from '@capacitor/core'
import {
  dismissNativeSplash,
  initNative,
  isNativeApp,
  nativePlatform,
  onNativeBack,
  onNativePause,
  onNativeResume,
  syncNativeChrome,
} from './native'

/**
 * The contract under test is "nothing happens on the web". That is worth real
 * assertions rather than trust, because the failure is invisible in a browser
 * and fatal in the vitest run: this suite executes in the `node` environment
 * with NO `document` and NO `window`, so any shim function that reaches for
 * either — or that eagerly imports a `@capacitor/*` plugin whose web build
 * touches `document` at module scope — throws here and nowhere else.
 *
 * The native side is asserted only as far as detection. Actually invoking
 * `syncNativeChrome` against a faked bridge would import the real status-bar
 * plugin and hand it a bridge object that cannot answer, which tests the mock
 * rather than the module.
 */

type Mutable = typeof globalThis & { Capacitor?: CapacitorGlobal }

/** Minimal stand-in for the object the native bridge injects on `window`. */
function fakeBridge(platform: string, native: boolean): CapacitorGlobal {
  return {
    getPlatform: () => platform,
    isNativePlatform: () => native,
  } as unknown as CapacitorGlobal
}

function inject(platform: string, native: boolean): void {
  ;(globalThis as Mutable).Capacitor = fakeBridge(platform, native)
}

afterEach(() => {
  delete (globalThis as Mutable).Capacitor
})

describe('nativePlatform', () => {
  it('reports web when no bridge was injected', () => {
    expect(nativePlatform()).toBe('web')
    expect(isNativeApp()).toBe(false)
  })

  it('reports web when @capacitor/core is loaded in a browser', () => {
    // The bridge object exists in a plain tab too; only isNativePlatform()
    // separates the app from the PWA, and trusting getPlatform() alone would
    // make every web visitor take the native path.
    inject('web', false)
    expect(nativePlatform()).toBe('web')
    expect(isNativeApp()).toBe(false)
  })

  it('reports ios inside the app binary', () => {
    inject('ios', true)
    expect(nativePlatform()).toBe('ios')
    expect(isNativeApp()).toBe(true)
  })

  it('reports android inside an android binary', () => {
    inject('android', true)
    expect(nativePlatform()).toBe('android')
  })

  it('falls back to web for a platform it does not model', () => {
    inject('electron', true)
    expect(nativePlatform()).toBe('web')
    expect(isNativeApp()).toBe(false)
  })

  it('ignores a bridge-shaped object with no isNativePlatform', () => {
    ;(globalThis as Mutable).Capacitor = {} as unknown as CapacitorGlobal
    expect(nativePlatform()).toBe('web')
  })
})

describe('web no-ops', () => {
  it('syncNativeChrome does nothing for either theme', () => {
    expect(() => {
      syncNativeChrome('dark')
    }).not.toThrow()
    expect(() => {
      syncNativeChrome('light')
    }).not.toThrow()
  })

  it('dismissNativeSplash does nothing', () => {
    expect(() => {
      dismissNativeSplash()
    }).not.toThrow()
  })

  it('initNative does not touch a document that is not there', () => {
    // Guards the ordering inside initNative(): the platform check has to come
    // before the dataset write, or server-side/node consumers crash on import.
    expect(globalThis.document).toBeUndefined()
    expect(() => {
      initNative()
    }).not.toThrow()
  })
})

describe('lifecycle listeners on the web', () => {
  it('return an unsubscribe that never fires the callback', () => {
    let calls = 0
    const stop = onNativeResume(() => {
      calls += 1
    })
    expect(typeof stop).toBe('function')
    stop()
    expect(calls).toBe(0)
  })

  it('tolerate being unsubscribed twice', () => {
    // React 19 StrictMode runs effect cleanup twice in development; an
    // unsubscribe that throws on the second call takes the app down with it.
    const stop = onNativePause(() => {})
    stop()
    expect(() => {
      stop()
    }).not.toThrow()
  })

  it('cover the android back button with the same shape', () => {
    const stop = onNativeBack(() => {})
    expect(() => {
      stop()
    }).not.toThrow()
  })
})
