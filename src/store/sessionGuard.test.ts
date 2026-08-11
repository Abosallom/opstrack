// The entries store's two session boundaries: the one at the START of a session
// and the one at the END of it.
//
// WHY THIS IS ITS OWN FILE, and not more cases in entries.test.ts. Both defects
// are about a read whose ANSWER arrives on the wrong side of a session boundary,
// so both need the read held open and the session state driven from the test —
// which means mocking `./auth` and gating `../api/entries`. entries.test.ts
// answers every read immediately and deliberately runs against the real
// hasSession(); bending it to hold a promise open would change what every case
// in it is measuring.
//
// R2-ARCH-1 — the start. Under RLS an unauthenticated read is not an error:
// `is_member()` is false, every row is filtered out, and PostgREST answers
// `200 []`. store/auth.ts's hasSession() header documents the consequence and
// names config, vocab and members as its victims; entries was the one cached
// store that never applied the guard, and it is the store where believing the
// empty answer costs the most — mergeOpenFetch() PRUNES the working set, stamps
// `coverage.loadedAt` (so every screen mounted after sign-in short-circuits and
// renders an empty list with no spinner and no error), and the commit's cache
// write then overwrites the first-paint cache with `[]`. Its focus listener is
// registered at module scope, so alt-tabbing to a mail app for the six-digit
// code and back was enough to trigger all three.
//
// R2-ARCH-2 — the end. resetEntries() can empty the store and delete the cache,
// but it cannot un-send a request. Every loader wrote its answer back
// unconditionally, so a read issued a moment before sign-out repopulated the
// store a moment after it — the previous account's rows, re-stamped as loaded
// (so nothing refetches for the next account) and re-serialised to disk. The fix
// is the `epoch` counter: capture it before the await, write nothing if it moved.

import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { Entry, EntryUpdate } from '../types'

// ── seams ──────────────────────────────────────────────────────────────────

const net = vi.hoisted(() => {
  const held: (() => void)[] = []
  return {
    /** What the mocked hasSession() answers. */
    session: true,
    /** While true, every read parks until release() is called. */
    hold: false,
    held,
    openRows: [] as unknown[],
    openCalls: 0,
    closedRows: [] as unknown[],
    historyRows: [] as unknown[],
    updateRows: [] as unknown[],
    slaRows: [] as unknown[],
    slaCalls: 0,
    /** The module-scope `focus` handler the store registers on import. */
    focus: null as null | (() => void),
    answer<T>(value: T): Promise<T> {
      if (!net.hold) return Promise.resolve(value)
      return new Promise<T>((resolve) => held.push(() => resolve(value)))
    },
    /** Let `count` parked reads answer, oldest first. Default: all of them. */
    release(count?: number): void {
      for (const fn of held.splice(0, count ?? held.length)) fn()
    },
  }
})

// The real hasSession() reads store/auth's zustand store, which no test can sign
// in to without a live client. `useAuth` is the store's other import from this
// module (a hook, unused here — nothing in this file renders).
vi.mock('./auth', () => ({
  hasSession: () => net.session,
  useAuth: () => ({ loading: false, session: null, profile: null }),
}))

vi.mock('../api/entries', () => ({
  listEntries: () => {
    net.openCalls += 1
    return net.answer({ ok: true, data: { rows: [...net.openRows], truncated: false } })
  },
  listHealth: () => net.answer({ ok: true, data: { rows: [], truncated: false } }),
  listClosedSince: () =>
    net.answer({ ok: true, data: { rows: [...net.closedRows], truncated: false } }),
  listTrackHistory: () =>
    net.answer({ ok: true, data: { entries: [...net.historyRows], updates: [] } }),
  listUpdates: () => net.answer({ ok: true, data: [...net.updateRows] }),
  addUpdate: () => Promise.resolve({ ok: false, error: 'common.error' }),
  createEntry: () => Promise.resolve({ ok: false, error: 'common.error' }),
  updateEntry: () => Promise.resolve({ ok: false, error: 'common.error' }),
}))

vi.mock('../api/realtime', () => ({
  onRealtimeBatch: () => (): void => {},
  onRealtimeResync: () => (): void => {},
}))

vi.mock('../api/tracks', () => ({
  listTrackSlas: () => {
    net.slaCalls += 1
    return net.answer({ ok: true, data: [...net.slaRows] })
  },
}))

const CACHE_KEY = 'nphiescore_entries_v1'

type EntriesModule = typeof import('./entries')
let store: EntriesModule
let cells: Map<string, string>

beforeAll(async () => {
  cells = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string): string | null => cells.get(k) ?? null,
      setItem: (k: string, v: string): void => void cells.set(k, v),
      removeItem: (k: string): void => void cells.delete(k),
    },
  })
  // The store installs its focus listener at module scope; this shim is how the
  // test gets a handle on the real one rather than re-implementing it.
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      addEventListener: (type: string, fn: () => void): void => {
        if (type === 'focus') net.focus = fn
      },
      removeEventListener: (): void => {},
      setTimeout: (fn: () => void, ms?: number): number => setTimeout(fn, ms) as unknown as number,
      clearTimeout: (id: number): void => clearTimeout(id),
    },
  })
  store = await import('./entries')
})

function entry(id: string, title: string): Entry {
  return {
    id,
    track_id: 't1',
    title,
    description: '',
    type: 'action',
    status: 'in_progress',
    priority: 'medium',
    owner_id: null,
    owner_name: null,
    requester: null,
    due_date: null,
    follow_up_date: null,
    tags: [],
    links: [],
    created_by: 'me',
    created_at: '2026-07-01T09:00:00.000Z',
    updated_at: '2026-07-02T09:00:00.000Z',
    closed_at: null,
    last_activity_at: '2026-07-02T09:00:00.000Z',
    meeting_id: null,
    template_id: null,
  }
}

function update(id: string): EntryUpdate {
  return {
    id,
    entry_id: 'e1',
    author_id: 'me',
    body: 'a private note',
    status_from: null,
    status_to: null,
    created_at: '2026-07-02T09:00:00.000Z',
  }
}

/** The cache write is debounced 1 s; nothing is on disk before it fires. */
function flushCacheWrite(): void {
  vi.advanceTimersByTime(1_200)
}

beforeEach(() => {
  // `Date` too: `coverage.loadedAt` and the focus listener's staleness check
  // both read Date.now(), and the cache write is a 1 s debounce.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  store.resetEntries()
  cells.clear()
  net.session = true
  net.hold = false
  net.held.length = 0
  net.openRows = []
  net.openCalls = 0
  net.closedRows = []
  net.historyRows = []
  net.updateRows = []
  net.slaRows = []
  net.slaCalls = 0
})

afterEach(() => {
  vi.useRealTimers()
})

// ── R2-ARCH-1 — the sign-in screen must not poison the store ───────────────

describe('the focus listener is gated on a session', () => {
  it('does not fetch while the sign-in screen is open', async () => {
    net.session = false
    expect(store.getEntriesCoverage().loadedAt).toBeNull() // i.e. always stale

    net.focus?.()
    await Promise.resolve()

    // The whole point: nothing went out, so nothing empty can come back.
    // (`listEntries` is called synchronously inside loadEntries, so a request
    // this listener made would already be counted here.)
    expect(net.openCalls).toBe(0)
    expect(store.getEntriesCoverage().loadedAt).toBeNull()
  })

  it('still fetches on focus once there is a session', async () => {
    net.openRows = [entry('a1', 'Renew the CA cert')]

    net.focus?.()
    expect(net.openCalls).toBe(1)
    // The listener fires and forgets; this returns the very promise it started,
    // because loadEntries() hands back `inFlight` when one is running.
    await store.loadEntries()

    expect(store.getEntriesSnapshot().byId.size).toBe(1)
    expect(store.getEntriesCoverage().openLoaded).toBe(true)
  })
})

describe('an empty OPEN read made without a session is not an answer', () => {
  it('does not stamp coverage, and does not write [] over the cache', async () => {
    net.session = false
    net.openRows = []

    await store.loadEntries(true)

    const coverage = store.getEntriesCoverage()
    // A stamped `loadedAt` is what short-circuits every unforced loadEntries()
    // for the rest of the session — the empty screens after sign-in.
    expect(coverage.loadedAt).toBeNull()
    expect(coverage.openLoaded).toBe(false)
    flushCacheWrite()
    expect(cells.get(CACHE_KEY)).toBeUndefined()
  })

  it('does not prune the working set it already has', async () => {
    net.openRows = [entry('a1', 'Renew the CA cert'), entry('a2', 'Firewall change window')]
    await store.loadEntries(true)
    expect(store.getEntriesSnapshot().byId.size).toBe(2)
    flushCacheWrite()
    const warmCache = cells.get(CACHE_KEY)
    expect(JSON.parse(warmCache ?? '[]')).toHaveLength(2)

    // Signed out — every row is filtered out by RLS and the read answers 200 [].
    net.session = false
    net.openRows = []
    await store.loadEntries(true)

    expect(store.getEntriesSnapshot().byId.size).toBe(2)
    flushCacheWrite()
    // Not merely "still two rows in memory": the offline first-paint cache is
    // intact too, so the next cold start is not a blank screen.
    expect(cells.get(CACHE_KEY)).toBe(warmCache)
  })

  it('believes an empty read WITH a session — an empty workspace is real', async () => {
    net.openRows = [entry('a1', 'Renew the CA cert')]
    await store.loadEntries(true)
    expect(store.getEntriesSnapshot().byId.size).toBe(1)

    // Same empty payload as the case above. The guard is about the SESSION, not
    // about emptiness: a workspace whose last open item was just closed must
    // still empty the list and stamp the load.
    net.openRows = []
    await store.loadEntries(true)

    expect(store.getEntriesSnapshot().byId.size).toBe(0)
    expect(store.getEntriesCoverage().openLoaded).toBe(true)
    expect(store.getEntriesCoverage().loadedAt).not.toBeNull()
  })
})

// ── R2-ARCH-2 — a read that lands after sign-out writes nothing ────────────

describe('a read in flight at sign-out cannot repopulate the store', () => {
  it('drops the open working set that lands after resetEntries()', async () => {
    net.hold = true
    net.openRows = [entry('a1', 'Payroll integration cutover'), entry('a2', 'DR test')]
    const inFlight = store.loadEntries(true)
    expect(net.openCalls).toBe(1)

    store.resetEntries()
    expect(store.getEntriesSnapshot().byId.size).toBe(0)
    expect(cells.get(CACHE_KEY)).toBeUndefined()

    net.release()
    await inFlight

    expect(store.getEntriesSnapshot().byId.size).toBe(0)
    // Both halves matter. A re-stamped `loadedAt` would mean the NEXT account's
    // screens short-circuit and never refetch…
    expect(store.getEntriesCoverage().loadedAt).toBeNull()
    expect(store.getEntriesCoverage().openLoaded).toBe(false)
    // …and the cache write would undo the removeItem() sign-out just did.
    flushCacheWrite()
    expect(cells.get(CACHE_KEY)).toBeUndefined()
  })

  it('does not let the stale read retire the NEXT account’s in-flight load', async () => {
    net.hold = true
    net.openRows = [entry('old', 'Previous account row')]
    const stale = store.loadEntries(true) // parks two reads: entries + health

    store.resetEntries()

    net.openRows = [entry('new', 'Next account row')]
    const fresh = store.loadEntries(true)
    expect(net.openCalls).toBe(2)

    // Only the PREVIOUS account's read answers. The next one is still on the
    // wire, which is the moment the ungated `.finally` did its damage: it
    // cleared `inFlight`, so the dedupe every screen relies on was gone while a
    // request was still out.
    net.release(2)
    await stale

    // Not awaited: with the dedupe intact this returns the promise still parked
    // on the wire, and awaiting it here would simply block the test.
    const deduped = store.loadEntries(true)
    expect(net.openCalls).toBe(2)

    net.release()
    await Promise.all([fresh, deduped])

    // And the fresh answer — not the stale one — is what the store holds.
    expect([...store.getEntriesSnapshot().byId.keys()]).toEqual(['new'])
    expect(store.getEntriesCoverage().openLoaded).toBe(true)
  })

  it('drops a closed window that lands after resetEntries()', async () => {
    net.hold = true
    net.closedRows = [{ ...entry('c1', 'Closed last week'), status: 'done' }]
    const inFlight = store.loadClosedSince('2026-07-01')

    store.resetEntries()
    net.release()
    await inFlight

    expect(store.getEntriesSnapshot().byId.size).toBe(0)
    // `closedSince` is a coverage stamp exactly like `loadedAt`: set, it makes
    // the next account's dashboard believe the window is already loaded.
    expect(store.getEntriesCoverage().closedSince).toBeNull()
  })

  it('drops a track history window that lands after resetEntries()', async () => {
    net.hold = true
    net.historyRows = [entry('h1', 'Timeline row')]
    const inFlight = store.loadTrackHistory('t1', '2026-07-01', '2026-07-31')

    store.resetEntries()
    net.release()
    await inFlight

    expect(store.getEntriesSnapshot().byId.size).toBe(0)
    expect(store.getEntriesCoverage().trackHistory).toEqual({})
  })

  it('drops a thread that lands after resetEntries()', async () => {
    net.hold = true
    net.updateRows = [update('u1')]
    const inFlight = store.loadUpdates('e1')

    store.resetEntries()
    net.release()
    await inFlight

    // A thread is free text written by one person about one entry — the most
    // private thing in the store, and RLS would never have handed it to whoever
    // signs in next on this device.
    expect(store.getEntriesSnapshot().updates.has('e1')).toBe(false)
  })

  it('does not re-latch the SLA matrix from a read that lands after sign-out', async () => {
    net.hold = true
    net.slaRows = [{ track_id: 't1', priority: 'high', sla_days: 2 }]
    const inFlight = store.loadTrackSlas(true)

    store.resetEntries()
    net.release()
    await inFlight

    expect(store.getEntriesSnapshot().slaMatrix).toBeNull()
    // The latch is the real damage here: resetEntries() clears `slaLoaded` on
    // purpose, and a stale answer setting it again means the next account never
    // fetches the matrix — every SLA badge silently falls back to the priority
    // default, a too-generous deadline shown as if it were configured.
    net.hold = false
    await store.loadTrackSlas()
    expect(net.slaCalls).toBe(2)
    expect(store.getEntriesSnapshot().slaMatrix).not.toBeNull()
  })
})
