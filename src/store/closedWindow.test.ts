// The CLOSED window's read, and the one thing it never used to say: that it
// failed.
//
// WHY THIS IS ITS OWN FILE. `loadClosedSince()` on `!result.ok` used to
// console.warn and bare-return — no state, no key, no rejection — so a dropped
// request was byte-identical to a week in which nothing was finished. Everything
// the dashboard says about completed work is computed from these rows (the
// Closed tile, the throughput chart, SLA compliance) and so is the whole Closed
// section of the digest you paste into an email to your boss. The asymmetry was
// the tell: a CLIPPED closed read had a channel all the way into the document
// (`coverage.closedTruncated`) and a FAILED one had none at all.
//
// The reads are mocked at `api/entries`; every line of the store is real.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const net = vi.hoisted(() => ({
  /** Answer of the next `listClosedSince`. */
  closed: { ok: true, data: { rows: [] as unknown[], truncated: false } } as unknown,
  /** Every `since` the store has asked for, in order. */
  asked: [] as string[],
  openCalls: 0,
}))

vi.mock('../api/entries', () => ({
  listEntries: () => {
    net.openCalls += 1
    return Promise.resolve({ ok: true, data: { rows: [], truncated: false } })
  },
  listHealth: () => Promise.resolve({ ok: true, data: { rows: [], truncated: false } }),
  listClosedSince: (since: string) => {
    net.asked.push(since)
    return Promise.resolve(net.closed)
  },
  listTrackHistory: () => Promise.resolve({ ok: true, data: { rows: [], truncated: false } }),
  listUpdates: () => Promise.resolve({ ok: true, data: [] }),
  addUpdate: () => Promise.resolve({ ok: false, error: 'common.error' }),
  createEntry: () => Promise.resolve({ ok: false, error: 'common.error' }),
  updateEntry: () => Promise.resolve({ ok: false, error: 'common.error' }),
}))

vi.mock('../api/realtime', () => ({
  onRealtimeBatch: () => (): void => {},
  onRealtimeResync: () => (): void => {},
}))

vi.mock('../api/tracks', () => ({
  listTrackSlas: () => Promise.resolve({ ok: true, data: [] }),
}))

type EntriesModule = typeof import('./entries')
let store: EntriesModule

beforeAll(async () => {
  const cells = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string): string | null => cells.get(k) ?? null,
      setItem: (k: string, v: string): void => void cells.set(k, v),
      removeItem: (k: string): void => void cells.delete(k),
    },
  })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      addEventListener: (): void => {},
      removeEventListener: (): void => {},
      setTimeout: (fn: () => void, ms?: number): number => setTimeout(fn, ms) as unknown as number,
      clearTimeout: (id: number): void => clearTimeout(id),
    },
  })
  store = await import('./entries')
})

const closedRow = {
  id: 'c1',
  track_id: 't1',
  title: 'Done thing',
  description: '',
  type: 'action',
  status: 'done',
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
  closed_at: '2026-07-02T09:00:00.000Z',
  last_activity_at: '2026-07-02T09:00:00.000Z',
  meeting_id: null,
  template_id: null,
}

function ok(rows: unknown[] = [], truncated = false): unknown {
  return { ok: true, data: { rows, truncated } }
}

beforeEach(() => {
  store.resetEntries()
  net.closed = ok()
  net.asked = []
  net.openCalls = 0
})

describe('loadClosedSince — a failure is state, not a console line', () => {
  it('records the error key instead of looking like a quiet week', async () => {
    net.closed = { ok: false, error: 'common.offline' }

    await store.loadClosedSince('2026-07-01')

    const coverage = store.getEntriesCoverage()
    expect(coverage.closedError).toBe('common.offline')
    // The ONLY observable difference before this existed was `closedSince`, and
    // nothing outside this module reads it — so a failure and an empty week were
    // the same state for every consumer.
    expect(coverage.closedSince).toBe(null)
  })

  it('clears the error on the read that succeeds', async () => {
    net.closed = { ok: false, error: 'common.offline' }
    await store.loadClosedSince('2026-07-01')
    expect(store.getEntriesCoverage().closedError).toBe('common.offline')

    net.closed = ok([closedRow])
    await store.loadClosedSince('2026-07-01')

    const coverage = store.getEntriesCoverage()
    expect(coverage.closedError).toBe(null)
    expect(coverage.closedSince).toBe('2026-07-01')
    expect(store.getEntriesSnapshot().byId.has('c1')).toBe(true)
  })

  it('does not carry a wider window’s failure into a narrower one that is loaded', async () => {
    // 7 days succeed, 30 days fail, the user drops back to 7. That view IS
    // complete, and a caveat left over from the wider attempt would be a lie in
    // the other direction.
    net.closed = ok([closedRow])
    await store.loadClosedSince('2026-07-01')
    net.closed = { ok: false, error: 'common.offline' }
    await store.loadClosedSince('2026-06-01')
    expect(store.getEntriesCoverage().closedError).toBe('common.offline')

    await store.loadClosedSince('2026-07-15')

    expect(store.getEntriesCoverage().closedError).toBe(null)
  })

  it('keeps a clip when a later, narrower read succeeds — a clip is about DATA', async () => {
    net.closed = ok([closedRow], true)
    await store.loadClosedSince('2026-06-01')
    expect(store.getEntriesCoverage().closedTruncated).toBe(true)

    net.closed = ok([closedRow])
    await store.loadClosedSince('2026-07-01')

    expect(store.getEntriesCoverage().closedTruncated).toBe(true)
  })
})

describe('refreshEntries — the visible Retry', () => {
  it('re-attempts the closed window, which nothing else on the screen does', async () => {
    net.closed = { ok: false, error: 'common.offline' }
    await store.loadClosedSince('2026-07-01')
    expect(net.asked).toEqual(['2026-07-01'])

    net.closed = ok([closedRow])
    await store.refreshEntries()

    // Was `loadEntries(true)` and nothing else, so the one read with no other
    // recovery path was the one Retry could not fix.
    expect(net.asked).toEqual(['2026-07-01', '2026-07-01'])
    expect(store.getEntriesCoverage().closedError).toBe(null)
    expect(store.getEntriesSnapshot().byId.has('c1')).toBe(true)
    expect(net.openCalls).toBe(1)
  })

  it('costs no extra request once the closed window has loaded', async () => {
    net.closed = ok([closedRow])
    await store.loadClosedSince('2026-07-01')
    expect(net.asked).toHaveLength(1)

    await store.refreshEntries()

    // loadClosedSince() short-circuits on a window it already covers.
    expect(net.asked).toHaveLength(1)
    expect(net.openCalls).toBe(1)
  })

  it('is still just an open refetch before anything has asked for a closed window', async () => {
    await store.refreshEntries()
    expect(net.asked).toEqual([])
    expect(net.openCalls).toBe(1)
  })
})
