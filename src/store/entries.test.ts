// The three pure decisions inside the entries store: the monotonic guard, the
// optimistic patch, and the counts.
//
// WHY THE DYNAMIC IMPORT. Vitest runs in the `node` environment, because every
// other tested module in this repo is pure by construction. This store is not:
// it reads a first-paint cache out of localStorage at module init, and it pulls
// in lib/i18n, which reads the stored locale the same way. Both are correct — a
// store IS allowed to touch the browser — so the test supplies the two globals
// before importing rather than asking the store to pretend it has no cache.
// A static import would evaluate the module before beforeAll could run.

import { beforeAll, describe, expect, it } from 'vitest'
import type { Entry, EntryHealth, EntryStatus } from '../types'

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
  store = await import('./entries')
})

const T0 = '2026-07-29T09:00:00.000Z'
const T1 = '2026-07-29T10:00:00.000Z'
const T2 = '2026-07-29T11:00:00.000Z'

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'e1',
    track_id: 't-net',
    title: 'Firewall rule DC2',
    description: '',
    type: 'action',
    status: 'in_progress',
    priority: 'high',
    owner_id: null,
    owner_name: null,
    requester: null,
    due_date: null,
    follow_up_date: null,
    tags: [],
    links: [],
    created_by: 'me',
    created_at: T0,
    updated_at: T0,
    closed_at: null,
    last_activity_at: T0,
    meeting_id: null,
    template_id: null,
    ...overrides,
  }
}

function health(id: string, overrides: Partial<EntryHealth> = {}): EntryHealth {
  return {
    id,
    entry_id: id,
    track_id: null,
    status: 'in_progress',
    priority: 'medium',
    due_date: null,
    last_activity_at: T0,
    days_since_activity: 0,
    days_overdue: 0,
    health: 'ok',
    sla_due_at: null,
    sla_breached: false,
    ...overrides,
  }
}

describe('acceptsServerRow — the monotonic guard', () => {
  it('accepts anything when nothing local exists', () => {
    expect(store.acceptsServerRow(undefined, entry(), 'realtime', false)).toBe(true)
  })

  it('DROPS the realtime echo of a write that is still pending', () => {
    // The whole reason the guard exists: without it the optimistic edit renders,
    // the pre-edit row arrives over the socket, the field visibly reverts, and
    // the settle puts it back — a flicker the user reads as the app fighting
    // them.
    const local = entry({ updated_at: T2, title: 'edited locally' })
    const echo = entry({ updated_at: T1, title: 'Firewall rule DC2' })
    expect(store.acceptsServerRow(local, echo, 'realtime', true)).toBe(false)
  })

  it('lets our own settled write win even at an identical updated_at', () => {
    const local = entry({ updated_at: T1 })
    const settled = entry({ updated_at: T1, title: 'from the server' })
    expect(store.acceptsServerRow(local, settled, 'local', true)).toBe(true)
  })

  it('rejects a row older than what is already held', () => {
    const local = entry({ updated_at: T2 })
    const stale = entry({ updated_at: T1 })
    expect(store.acceptsServerRow(local, stale, 'fetch', false)).toBe(false)
  })

  it('accepts an equal updated_at when nothing is pending', () => {
    // Two clients reading the same row must converge, not ping-pong.
    const local = entry({ updated_at: T1 })
    expect(store.acceptsServerRow(local, entry({ updated_at: T1 }), 'fetch', false)).toBe(true)
  })
})

describe('applyPatchLocal — the optimistic reducer', () => {
  it('bumps last_activity_at so the row jumps to the top of every list', () => {
    const next = store.applyPatchLocal(entry(), { title: 'Renamed' }, T2)
    expect(next.last_activity_at).toBe(T2)
    expect(next.updated_at).toBe(T2)
  })

  it('leaves untouched fields alone', () => {
    const next = store.applyPatchLocal(entry({ tags: ['portal'] }), { status: 'blocked' }, T2)
    expect(next.tags).toEqual(['portal'])
    expect(next.title).toBe('Firewall rule DC2')
  })

  it('coalesces a cleared description, matching the column', () => {
    expect(store.applyPatchLocal(entry(), { description: null }, T2).description).toBe('')
  })

  it('stamps closed_at on the way to a terminal status', () => {
    const next = store.applyPatchLocal(entry(), { status: 'done' }, T2)
    expect(next.closed_at).toBe(T2)
  })

  it('does not restamp closed_at on an already-closed row', () => {
    // entries_set_closed_at() coalesces; re-cancelling a done item must not move
    // the date it was actually closed.
    const closed = entry({ status: 'done', closed_at: T0 })
    expect(store.applyPatchLocal(closed, { status: 'cancelled' }, T2).closed_at).toBe(T0)
  })

  it('clears closed_at when an item is reopened', () => {
    const closed = entry({ status: 'done', closed_at: T0 })
    expect(store.applyPatchLocal(closed, { status: 'in_progress' }, T2).closed_at).toBeNull()
  })

  it('resolves the owner XOR the same way the api mapper does', () => {
    const vendor = entry({ owner_name: 'Vendor', owner_id: null })
    const next = store.applyPatchLocal(vendor, { ownerId: 'm-ahmed' }, T2)
    expect(next.owner_id).toBe('m-ahmed')
    expect(next.owner_name).toBeNull()
  })

  it('does not mutate the row it was handed', () => {
    // The pre-change row is the rollback snapshot. Mutating it would leave a
    // failed write with nothing to restore.
    const before = entry()
    store.applyPatchLocal(before, { title: 'Renamed', status: 'done' }, T2)
    expect(before.title).toBe('Firewall rule DC2')
    expect(before.status).toBe('in_progress')
    expect(before.closed_at).toBeNull()
  })
})

describe('countEntries', () => {
  const TODAY = '2026-07-29'
  const WEEK_END = '2026-08-05'

  it('splits open from closed on the frozen pair', () => {
    const rows = (['new', 'in_progress', 'blocked', 'waiting_on', 'done', 'cancelled'] as EntryStatus[]).map(
      (status, i) => entry({ id: `e${i}`, status }),
    )
    const counts = store.countEntries(rows, new Map(), TODAY, WEEK_END)
    expect(counts.total).toBe(6)
    expect(counts.open).toBe(4)
    expect(counts.closed).toBe(2)
    expect(counts.blocked).toBe(1)
  })

  it('reads overdue and stale off the health map, never recomputing them', () => {
    const rows = [entry({ id: 'a' }), entry({ id: 'b' }), entry({ id: 'c' })]
    const map = new Map<string, EntryHealth>([
      ['a', health('a', { days_overdue: 3, health: 'overdue' })],
      ['b', health('b', { health: 'stale' })],
    ])
    const counts = store.countEntries(rows, map, TODAY, WEEK_END)
    expect(counts.overdue).toBe(1)
    expect(counts.stale).toBe(1)
  })

  it('counts an item with neither owner field as unassigned', () => {
    const rows = [
      entry({ id: 'a' }),
      entry({ id: 'b', owner_id: 'm-sara' }),
      entry({ id: 'c', owner_name: 'Vendor' }),
    ]
    // A free-text vendor is an owner. Spec §3: the two display and filter
    // identically, so neither counts as unassigned.
    expect(store.countEntries(rows, new Map(), TODAY, WEEK_END).unassigned).toBe(1)
  })

  it('bounds dueThisWeek inclusively at both ends and excludes the overdue', () => {
    const rows = [
      entry({ id: 'today', due_date: TODAY }),
      entry({ id: 'edge', due_date: WEEK_END }),
      entry({ id: 'after', due_date: '2026-08-06' }),
      entry({ id: 'before', due_date: '2026-07-28' }),
    ]
    expect(store.countEntries(rows, new Map(), TODAY, WEEK_END).dueThisWeek).toBe(2)
  })

  it('never counts a closed row in an open bucket', () => {
    const rows = [entry({ id: 'a', status: 'done', due_date: '2026-07-01' })]
    const map = new Map([['a', health('a', { days_overdue: 28, health: 'overdue' })]])
    const counts = store.countEntries(rows, map, TODAY, WEEK_END)
    expect(counts.closed).toBe(1)
    expect(counts.overdue).toBe(0)
    expect(counts.unassigned).toBe(0)
  })
})
