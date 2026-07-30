// The module that now holds the user's UNSENT WRITES, not just a first-paint
// cache — store/outbox.ts persists `opstrack_outbox_v1` through it. That is why
// the two things asserted hardest here are the ones a caller cannot check for
// itself: nothing throws, ever, and a failed write leaves the previous value in
// place rather than clearing it.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { CACHE_PREFIX, isDurable, readCache, removeCache, writeCache } from './cache'

/** vitest runs in `node`, so there is no localStorage unless a test makes one. */
function install(store: Partial<Record<'getItem' | 'setItem' | 'removeItem', unknown>>): void {
  Object.defineProperty(globalThis, 'localStorage', {
    value: store,
    configurable: true,
    writable: true,
  })
}

function memoryBacked(seed: Record<string, string> = {}): Map<string, string> {
  const cells = new Map(Object.entries(seed))
  install({
    getItem: (k: string) => cells.get(k) ?? null,
    setItem: (k: string, v: string) => cells.set(k, v),
    removeItem: (k: string) => cells.delete(k),
  })
  return cells
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage')
  vi.restoreAllMocks()
})

const asString = (v: unknown): string | null => (typeof v === 'string' ? v : null)

describe('the round trip', () => {
  it('stores the value verbatim, with no envelope', () => {
    // Deliberate: the four keys already in the field were written by hand-rolled
    // readCache/writeCache pairs, and an envelope would orphan every one of them.
    const cells = memoryBacked()
    expect(writeCache(`${CACHE_PREFIX}k`, { a: 1 })).toBe(true)
    expect(cells.get(`${CACHE_PREFIX}k`)).toBe('{"a":1}')
  })

  it('reads back through the validator', () => {
    memoryBacked({ [`${CACHE_PREFIX}k`]: '"hello"' })
    expect(readCache(`${CACHE_PREFIX}k`, asString)).toBe('hello')
  })

  it('removes a key from storage AND from the in-memory fallback', () => {
    // Sign-out sweeps by key. A value written while storage was refusing writes
    // lives in the fallback Map, and leaving it there would hand one account's
    // data to the next one in the same tab.
    const cells = memoryBacked({ [`${CACHE_PREFIX}k`]: '1' })
    removeCache(`${CACHE_PREFIX}k`)
    expect(cells.has(`${CACHE_PREFIX}k`)).toBe(false)
    expect(readCache(`${CACHE_PREFIX}k`, asString)).toBeNull()
  })
})

describe('nothing here throws', () => {
  it('answers null for an absent key', () => {
    memoryBacked()
    expect(readCache(`${CACHE_PREFIX}missing`, asString)).toBeNull()
  })

  it('answers null for a hand-edited value that is not JSON', () => {
    memoryBacked({ [`${CACHE_PREFIX}k`]: '{oops' })
    expect(readCache(`${CACHE_PREFIX}k`, asString)).toBeNull()
  })

  it('answers null when the validator REJECTS well-formed JSON', () => {
    // The realistic corruption: a row array written by a previous column set. It
    // parses perfectly, which is exactly why `accept` is mandatory.
    memoryBacked({ [`${CACHE_PREFIX}k`]: '{"shape":"from last version"}' })
    expect(readCache(`${CACHE_PREFIX}k`, asString)).toBeNull()
  })

  it('answers null when the validator itself throws, rather than whitescreening', () => {
    memoryBacked({ [`${CACHE_PREFIX}k`]: '1' })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(
      readCache(`${CACHE_PREFIX}k`, () => {
        throw new Error('a caller bug')
      }),
    ).toBeNull()
  })

  it('survives a getter that raises instead of returning a store', () => {
    // Some hardened browser configs implement `localStorage` as a throwing
    // getter, so even reading the property is unsafe.
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError')
      },
    })
    expect(readCache(`${CACHE_PREFIX}k`, asString)).toBeNull()
    expect(isDurable()).toBe(false)
  })

  it('reports false for a value that cannot be serialised', () => {
    memoryBacked()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(writeCache(`${CACHE_PREFIX}k`, cyclic)).toBe(false)
  })
})

describe('a refused write', () => {
  it('reports false and LEAVES THE PREVIOUS VALUE, which the outbox depends on', () => {
    // For a cache, a dropped write costs a slower first paint. For the outbox it
    // is the difference between a stale queue and a lost one, so quota must
    // never turn "the newest state did not persist" into "everything is gone".
    const cells = new Map<string, string>([[`${CACHE_PREFIX}k`, '"older"']])
    install({
      getItem: (k: string) => cells.get(k) ?? null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
      removeItem: (k: string) => cells.delete(k),
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(writeCache(`${CACHE_PREFIX}k`, 'newer')).toBe(false)
    expect(readCache(`${CACHE_PREFIX}k`, asString)).toBe('older')
  })
})

describe('the fallback store', () => {
  it('keeps read-after-write working with no localStorage at all', () => {
    // Not a silent downgrade to "no persistence": the queue still survives a
    // route change, which is most of what a caller needs, and isDurable() is how
    // the outbox learns that "saved on this device" has stopped being true.
    expect(isDurable()).toBe(false)
    expect(writeCache(`${CACHE_PREFIX}fallback`, [1, 2])).toBe(true)
    expect(readCache(`${CACHE_PREFIX}fallback`, (v) => (Array.isArray(v) ? v : null))).toEqual([
      1, 2,
    ])
    removeCache(`${CACHE_PREFIX}fallback`)
  })

  it('reports durable once a real store is there', () => {
    memoryBacked()
    expect(isDurable()).toBe(true)
  })
})

describe('the key prefix', () => {
  it('warns in dev about a key sign-out would not sweep, but still writes it', () => {
    memoryBacked()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(writeCache('no_prefix', 1)).toBe(true)
    if (import.meta.env.DEV) expect(warn).toHaveBeenCalled()
  })
})
