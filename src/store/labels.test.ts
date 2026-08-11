import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LabelOverrideMap, LabelOverrideRow } from '../types'

// WHAT THIS FILE PROTECTS, IN ONE SENTENCE: the override layer is the words on
// every screen in the app, so the three ways it can silently go wrong — an
// unauthenticated empty read believed, a refused save left applied, a failed
// load that never retries — each cost the owner his configuration with nothing
// on screen to say so.
//
// THE localStorage SHIM, and why a dynamic import. vitest runs in the `node`
// environment (vitest.config.ts explains why) and store/labels.ts legitimately
// reads localStorage at module scope to warm the first paint. The shim is
// installed FIRST and the module pulled in afterwards; a static import would be
// hoisted above this code and defeat the ordering. This is the same arrangement
// store/vocab.test.ts and store/settings.test.ts document at length.
const g = globalThis as { localStorage?: Storage }
if (!g.localStorage) {
  const mem = new Map<string, string>()
  g.localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => {
      mem.set(k, v)
    },
    removeItem: (k: string) => {
      mem.delete(k)
    },
    clear: () => {
      mem.clear()
    },
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() {
      return mem.size
    },
  } as unknown as Storage
}

const CACHE_KEY = 'nphiescore_label_overrides_v1'

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

// ── the api, faked ─────────────────────────────────────────────────────────
//
// Faked rather than driven through a fake Supabase client: what these tests are
// about is how the STORE reacts to each answer api/labels.ts can give, and a
// query builder in between would only add ways for the test itself to be wrong.
// api/labels.test.ts covers the request shapes.

let listCalls = 0
let listAnswer: Result<LabelOverrideRow[]> = { ok: true, data: [] }
/** Set when a case wants the paged read to come back CLIPPED at the page cap. */
let listTruncated = false
/**
 * Held open when a case needs a read to still be in flight while something else
 * happens — the reset-that-races-a-read, which is the one sequence that can undo
 * the escape hatch. `listAnswer` is captured when the call is MADE, so releasing
 * the gate later resolves it with the world as it was.
 */
let listGate: Promise<void> | null = null
let upsertAnswer: Result<LabelOverrideRow | null> = { ok: true, data: null }
let deleteAnswer: Result<number> = { ok: true, data: 1 }
let deleteAllAnswer: Result<number> = { ok: true, data: 0 }

vi.mock('../api/labels', () => ({
  listOverrides: async () => {
    listCalls += 1
    const answered = listAnswer
    if (listGate) await listGate
    // api/labels.ts pages, so its success shape is rows + a clipped flag. The
    // cases below still write `listAnswer` as a plain row list, because that is
    // what they are about.
    return answered.ok
      ? { ok: true as const, data: { rows: answered.data, truncated: listTruncated } }
      : answered
  },
  upsertOverride: () => Promise.resolve(upsertAnswer),
  deleteOverride: () => Promise.resolve(deleteAnswer),
  deleteAllOverrides: () => Promise.resolve(deleteAllAnswer),
  upsertOverrides: () => Promise.resolve({ ok: true, data: [] }),
}))

let signedIn = true
vi.mock('./auth', () => ({ hasSession: () => signedIn }))

// lib/i18n is mocked down to the one function the store is allowed to touch, so
// these tests assert on WHAT THE APP WAS TOLD TO RENDER rather than on private
// store state. i18n's own suite covers what it does with the map afterwards.
let pushes = 0
let lastMap: LabelOverrideMap | null = null
vi.mock('../lib/i18n', () => ({
  setOverrides: (map: LabelOverrideMap) => {
    pushes += 1
    lastMap = map
  },
}))

/** The override layer as the app was last told to see it. */
function layer(): LabelOverrideMap {
  if (!lastMap) throw new Error('setOverrides was never called')
  return lastMap
}

function row(
  partial: Partial<LabelOverrideRow> & Pick<LabelOverrideRow, 'key'>,
): LabelOverrideRow {
  return {
    en: null,
    ar: null,
    updated_by: null,
    updated_at: '2026-07-31T09:00:00.000Z',
    ...partial,
  }
}

const BOARD = row({ key: 'nav.board', en: 'Pipeline', ar: 'خط العمل' })

function cached(): LabelOverrideRow[] {
  const raw = localStorage.getItem(CACHE_KEY)
  return raw ? (JSON.parse(raw) as LabelOverrideRow[]) : []
}

/**
 * A store with no history. The module holds `loadedAt`, `inFlight` and the row
 * array in module scope, so a test that ran before this one would otherwise
 * decide whether this one's load even fires.
 */
async function freshStore(): Promise<typeof import('./labels')> {
  vi.resetModules()
  return await import('./labels')
}

beforeEach(() => {
  localStorage.clear()
  listCalls = 0
  pushes = 0
  lastMap = null
  signedIn = true
  listAnswer = { ok: true, data: [] }
  listTruncated = false
  listGate = null
  upsertAnswer = { ok: true, data: null }
  deleteAnswer = { ok: true, data: 1 }
  deleteAllAnswer = { ok: true, data: 0 }
})

describe('the cache guard — an empty read without a session is not an answer', () => {
  it('leaves the warm cache, the live layer and `loadedAt` untouched', async () => {
    // The state this guard exists for: a signed-out tab — a reload landing on
    // the sign-in screen, an expired session, the focus listener firing — reads
    // through RLS and gets 200 with [].
    localStorage.setItem(CACHE_KEY, JSON.stringify([BOARD]))
    signedIn = false
    listAnswer = { ok: true, data: [] }

    const store = await freshStore()
    await store.loadLabels()

    expect(store.getLabelOverrides()).toEqual([BOARD])
    expect(layer().en['nav.board']).toBe('Pipeline')
    expect(layer().ar['nav.board']).toBe('خط العمل')
    // The cache is the half that used to be poisoned: believing the empty read
    // wrote [] over it, and the wording was gone on the next cold start too.
    expect(cached()).toEqual([BOARD])

    // And it did not latch. `loadedAt` is unobservable from outside, so the
    // observable consequence is what is asserted: the next load still fires.
    signedIn = true
    listAnswer = { ok: true, data: [row({ key: 'nav.board', en: 'Queue' })] }
    await store.loadLabels()
    expect(listCalls).toBe(2)
    expect(layer().en['nav.board']).toBe('Queue')
    // The Arabic override is GONE, not stale: the map is rebuilt from the rows
    // on every apply, never patched key by key.
    expect(layer().ar['nav.board']).toBeUndefined()
  })

  it('but an empty read WITH a session clears the layer — that is reset-all elsewhere', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify([BOARD]))
    signedIn = true
    listAnswer = { ok: true, data: [] }

    const store = await freshStore()
    // First paint still shows the cached wording; the guard must not make an
    // authenticated empty answer unbelievable, or the escape hatch would never
    // reach the owner's other devices.
    expect(layer().en['nav.board']).toBe('Pipeline')

    await store.loadLabels()

    expect(store.getLabelOverrides()).toEqual([])
    expect(layer()).toEqual({ en: {}, ar: {} })
    // The cache is overwritten too, or the next cold start resurrects wording
    // that was deliberately thrown away.
    expect(cached()).toEqual([])
  })
})

describe('a failed load does not latch', () => {
  it('retries on every call, and a later success still lands', async () => {
    listAnswer = { ok: false, error: 'common.error' }
    const store = await freshStore()

    await store.loadLabels()
    await store.loadLabels()
    // Against a `finally`-stamped `loadedAt` the second call short-circuits and
    // this is 1 — the app then renders the shipped wording for the rest of the
    // session with nothing to say the owner's configuration was ever missed.
    // This is also the state an unapplied 0017 produces on every call.
    expect(listCalls).toBe(2)
    expect(store.getLabelOverrides()).toEqual([])

    listAnswer = { ok: true, data: [BOARD] }
    await store.loadLabels()
    expect(listCalls).toBe(3)
    expect(layer().en['nav.board']).toBe('Pipeline')

    // Now it HAS an answer, so the next call is the one that must not refetch.
    await store.loadLabels()
    expect(listCalls).toBe(3)
  })

  it('keeps whatever was cached rather than blanking on a failed read', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify([BOARD]))
    listAnswer = { ok: false, error: 'common.error' }

    const store = await freshStore()
    await store.loadLabels()

    expect(store.getLabelOverrides()).toEqual([BOARD])
    expect(cached()).toEqual([BOARD])
  })
})

describe('optimistic save, and rollback on 42501', () => {
  it('shows the new wording immediately and puts ALL of it back when the write is refused', async () => {
    listAnswer = { ok: true, data: [BOARD, row({ key: 'nav.tracks', en: 'Workstreams' })] }
    const store = await freshStore()
    await store.loadLabels()
    const pushesAfterLoad = pushes

    // 42501: an admin demoted between page load and save. pgErrorKey maps it to
    // admin.errForbidden; nothing about it is visible client-side beforehand,
    // which is exactly why the optimistic write has to be reversible.
    upsertAnswer = { ok: false, error: 'admin.errForbidden' }
    const result = await store.saveOverride('nav.board', 'Delivery', 'التسليم')

    expect(result.ok).toBe(false)
    expect(result.ok ? null : result.error).toBe('admin.errForbidden')

    // It WAS applied first. Without this the test would pass against a store
    // that simply waited for the round trip, which is the behaviour this whole
    // arrangement exists to avoid.
    expect(pushes).toBeGreaterThan(pushesAfterLoad + 1)

    // …and every string is back, in the order the load returned them rather
    // than a re-sorted approximation of it.
    expect(store.getLabelOverrides()).toEqual([BOARD, row({ key: 'nav.tracks', en: 'Workstreams' })])
    expect(layer().en['nav.board']).toBe('Pipeline')
    expect(layer().ar['nav.board']).toBe('خط العمل')
    // The rollback restores the whole map, not the edited row: one override can
    // be showing in the nav, a column heading and a toast at once.
    expect(layer().en['nav.tracks']).toBe('Workstreams')
  })

  it('a successful save keeps the new wording and refetches', async () => {
    listAnswer = { ok: true, data: [] }
    const store = await freshStore()
    await store.loadLabels()

    upsertAnswer = { ok: true, data: row({ key: 'nav.board', en: 'Delivery' }) }
    listAnswer = { ok: true, data: [row({ key: 'nav.board', en: 'Delivery' })] }
    const result = await store.saveOverride('nav.board', 'Delivery', null)

    expect(result.ok).toBe(true)
    expect(layer().en['nav.board']).toBe('Delivery')
    expect(layer().ar['nav.board']).toBeUndefined()
    // invalidateLabels() forces a re-read, so 0017's trigger-stamped
    // updated_at/updated_by replace the optimistic guess.
    expect(listCalls).toBeGreaterThan(1)
  })

  it('blanking both languages removes the row, matching the write and the prune trigger', async () => {
    listAnswer = { ok: true, data: [BOARD] }
    const store = await freshStore()
    await store.loadLabels()

    upsertAnswer = { ok: true, data: null }
    listAnswer = { ok: true, data: [] }
    await store.saveOverride('nav.board', '   ', '')

    expect(store.getLabelOverrides()).toEqual([])
    expect(layer().en['nav.board']).toBeUndefined()
    expect(layer().ar['nav.board']).toBeUndefined()
  })

  it('a per-row reset rolls back when it is refused', async () => {
    listAnswer = { ok: true, data: [BOARD] }
    const store = await freshStore()
    await store.loadLabels()

    deleteAnswer = { ok: false, error: 'admin.errForbidden' }
    const result = await store.resetOverride('nav.board')

    expect(result.ok).toBe(false)
    expect(store.getLabelOverrides()).toEqual([BOARD])
    expect(layer().en['nav.board']).toBe('Pipeline')
  })

  it('a per-row reset that removed nothing is still a success', async () => {
    listAnswer = { ok: true, data: [BOARD] }
    const store = await freshStore()
    await store.loadLabels()

    // Another admin got there first. reset_label_overrides() reports 0 rows, and
    // reporting that as a failure would be a lie about what happened.
    deleteAnswer = { ok: true, data: 0 }
    listAnswer = { ok: true, data: [] }
    expect(await store.resetOverride('nav.board')).toEqual({ ok: true, data: null })
    expect(layer().en['nav.board']).toBeUndefined()
  })
})

describe('reset-all is the escape hatch, so it rolls back too', () => {
  it('restores every override when the clear is refused', async () => {
    listAnswer = { ok: true, data: [BOARD] }
    const store = await freshStore()
    await store.loadLabels()

    deleteAllAnswer = { ok: false, error: 'admin.errForbidden' }
    const result = await store.resetAllOverrides()

    expect(result.ok).toBe(false)
    expect(store.getLabelOverrides()).toEqual([BOARD])
    expect(layer().en['nav.board']).toBe('Pipeline')
  })

  it('clears the live layer on success and reports how many rows went', async () => {
    listAnswer = { ok: true, data: [BOARD] }
    const store = await freshStore()
    await store.loadLabels()

    deleteAllAnswer = { ok: true, data: 1 }
    listAnswer = { ok: true, data: [] }
    const result = await store.resetAllOverrides()

    expect(result).toEqual({ ok: true, data: 1 })
    expect(layer()).toEqual({ en: {}, ar: {} })
  })
})

// THE HEADER TALLY IS NOT TESTED HERE, and that is a decision rather than an
// omission. `count` is reachable only through useLabelOverrideCount(), a hook,
// and vitest runs this suite in the `node` environment with no renderer. The
// alternative — exporting the number purely so a test can read it — would add an
// API to the module that no screen wants, which is worse than the three lines of
// `derive()` it would be watching. The rule it encodes (a row overriding nothing
// in either language must not be counted, or the owner is told he has an
// override he cannot find) belongs to the terminology screen's own suite, where
// the number is rendered.

describe('first paint', () => {
  it('pushes the cached overrides into i18n at module load, before any fetch', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify([BOARD]))
    await freshStore()

    // No await, no load: this is what the very first render sees. Without it
    // every cold start shows the shipped wording for a beat and then re-labels,
    // which on a renamed workspace looks like the app forgetting its own
    // configuration on every launch.
    expect(pushes).toBe(1)
    expect(layer().en['nav.board']).toBe('Pipeline')
    expect(listCalls).toBe(0)
  })

  it('survives a corrupt cache without throwing', async () => {
    localStorage.setItem(CACHE_KEY, '{not json')
    const store = await freshStore()
    expect(store.getLabelOverrides()).toEqual([])
    expect(layer()).toEqual({ en: {}, ar: {} })
  })
})

// ── the two ways a read can be believed when it should not be ───────────────

describe('a read that predates a change is not believed', () => {
  it('cannot undo Reset every change, on screen or in the cache', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify([BOARD]))
    const store = await freshStore()

    // A load is in flight — the focus listener fired, or the shell is still
    // warming — and it will answer with the wording as it was.
    listAnswer = { ok: true, data: [BOARD] }
    let open = (): void => {}
    listGate = new Promise<void>((resolve) => {
      open = resolve
    })
    const stale = store.loadLabels(true)

    // The owner reaches for the escape hatch while it is still out. The delete
    // succeeds, and the refetch it triggers must be a NEW request rather than
    // this one: `if (inFlight) return inFlight` used to hand it back the stale
    // promise, so the reset was undone by its own invalidate.
    deleteAllAnswer = { ok: true, data: 1 }
    listAnswer = { ok: true, data: [] }
    const reset = await store.resetAllOverrides()
    expect(reset).toEqual({ ok: true, data: 1 })

    open()
    await stale
    // The queued read starts when the stale one finishes, so let it land.
    // `invalidateLabels()` is fire-and-forget by design — the caller's toast
    // must not wait on a refetch — which is exactly why this has to be flushed
    // rather than awaited.
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    // Two reads: the stale one and the one the reset queued behind it.
    expect(listCalls).toBe(2)

    // What the app renders, what the store holds and what the next cold start
    // will believe all agree, and all say the wording is back to shipped.
    expect(layer()).toEqual({ en: {}, ar: {} })
    expect(store.getLabelOverrides()).toEqual([])
    expect(cached()).toEqual([])
  })
})

describe('a clipped read is applied but never cached', () => {
  it('keeps trying, and leaves the cache holding a complete set', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify([BOARD]))
    const store = await freshStore()

    // api/labels.ts walks to 4,000 rows before it says this, against a hard
    // bound of ~2,100 override rows for every key in the app — so it means
    // something is wrong, not merely large. The rows that did arrive are still
    // shown, because most of the owner's wording beats none of it.
    listTruncated = true
    listAnswer = { ok: true, data: [row({ key: 'nav.board', en: 'Queue' })] }
    await store.loadLabels()

    expect(layer().en['nav.board']).toBe('Queue')
    // Not stamped: a partial answer must not stop the next attempt, and not
    // cached: a partial set must never become what a cold start believes.
    expect(cached()).toEqual([BOARD])
    await store.loadLabels()
    expect(listCalls).toBe(2)

    // A complete read is believed as usual.
    listTruncated = false
    await store.loadLabels()
    expect(listCalls).toBe(3)
    expect(cached()).toEqual([row({ key: 'nav.board', en: 'Queue' })])
  })
})
