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

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiResult } from '../api/result'
import type { RealtimeEvent } from '../api/realtime'
import type { Entry, EntryHealth, EntryStatus, EntryUpdate } from '../types'

// ── the three network seams, held open ─────────────────────────────────────
//
// `setEntriesSubmit` covers the WRITE seam and everything below the "write path"
// heading uses it. These three cover the READ seams, which nothing did — which
// is why derive(), the realtime batch coalescer and the SLA matrix all shipped
// untested (FIX-BACKLOG DERIVE-HEALTH / BATCH-SETSTATE / SLA-MATRIX).
//
// `vi.hoisted` because vi.mock factories are lifted above the imports and may
// not close over ordinary module-scope bindings.
const net = vi.hoisted(() => ({
  entries: [] as unknown[],
  health: [] as unknown[],
  slas: [] as unknown[],
  slaOk: true,
  /** The batch handler store/entries registers in startEntriesRealtime(). */
  onBatch: null as ((batch: RealtimeEvent<unknown>[]) => void) | null,
}))

vi.mock('../api/entries', () => ({
  listEntries: () =>
    Promise.resolve({ ok: true, data: { rows: net.entries, truncated: false } }),
  listHealth: () => Promise.resolve({ ok: true, data: { rows: net.health, truncated: false } }),
  listClosedSince: () => Promise.resolve({ ok: true, data: { rows: [], truncated: false } }),
  listTrackHistory: () => Promise.resolve({ ok: true, data: { rows: [], truncated: false } }),
  listUpdates: () => Promise.resolve({ ok: true, data: [] }),
  addUpdate: () => Promise.resolve({ ok: false, error: 'common.error' }),
  createEntry: () => Promise.resolve({ ok: false, error: 'common.error' }),
  updateEntry: () => Promise.resolve({ ok: false, error: 'common.error' }),
}))

vi.mock('../api/realtime', () => ({
  onRealtimeBatch: (handler: (batch: RealtimeEvent<unknown>[]) => void) => {
    net.onBatch = handler
    return (): void => {
      net.onBatch = null
    }
  },
  onRealtimeResync: () => (): void => {},
}))

vi.mock('../api/tracks', () => ({
  listTrackSlas: () =>
    Promise.resolve(net.slaOk ? { ok: true, data: net.slas } : { ok: false, error: 'common.error' }),
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
  // `window` for the same reason as localStorage, and for two more consumers:
  // this store installs a focus listener at module scope, and a failed write
  // toasts — components/toast schedules its dismissal on window.setTimeout. Both
  // are correct behaviour for a store, so the test supplies the globals rather
  // than asking the code to pretend it has no browser.
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      addEventListener: (): void => {},
      removeEventListener: (): void => {},
      setTimeout: (fn: () => void, ms?: number): number =>
        setTimeout(fn, ms) as unknown as number,
      clearTimeout: (id: number): void => clearTimeout(id),
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

// ── the write path ─────────────────────────────────────────────────────────
//
// Everything below drives the real store through its real seam. `setEntriesSubmit`
// exists exactly so the transport can be swapped, and swapping it for a promise
// the test resolves by hand is the only way to hold two writes open at once —
// which is the state every one of these regressions lived in.

/** A submit that never settles on its own. Resolve `inflight[n]` to land one. */
let inflight: Array<(result: unknown) => void> = []

function installDeferredSubmit(): void {
  inflight = []
  store.setEntriesSubmit(
    <T,>(): Promise<ApiResult<T>> =>
      new Promise<ApiResult<T>>((resolve) => {
        inflight.push(resolve as unknown as (result: unknown) => void)
      }),
  )
}

/** Let the awaiting async bodies run to their next suspension point. */
async function tick(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  store.resetEntries()
  store.setEntriesSubmit(null)
  inflight = []
  net.entries = []
  net.health = []
  net.slas = []
  net.slaOk = true
})

describe('revertMine — undo my write, and only my write', () => {
  it('restores the columns this write set', () => {
    const before = entry({ status: 'in_progress', priority: 'high', updated_at: T0 })
    const mine = { ...before, status: 'blocked' as EntryStatus, updated_at: T1 }

    const back = store.revertMine(mine, before, mine)

    expect(back.status).toBe('in_progress')
    expect(back.updated_at).toBe(T0)
  })

  it('leaves a column a LATER write has already moved', () => {
    // This is the whole finding: patch A (status) and patch B (priority) overlap,
    // B lands, A fails. Restoring the snapshot wholesale erased B's priority from
    // the UI even though the server had accepted it.
    const before = entry({ status: 'in_progress', priority: 'high' })
    const mine = { ...before, status: 'blocked' as EntryStatus, updated_at: T1 }
    const current = { ...mine, priority: 'critical' as const, updated_at: T2 }

    const back = store.revertMine(current, before, mine)

    expect(back.priority).toBe('critical')
    expect(back.updated_at).toBe(T2)
    // ...and the status, which nothing else touched, is still undone.
    expect(back.status).toBe('in_progress')
  })

  it('hands back the same object when there is nothing of ours left', () => {
    const before = entry()
    const mine = { ...before, status: 'blocked' as EntryStatus, updated_at: T1 }
    // Somebody else's row entirely — a realtime edit that landed and won.
    const current = entry({ status: 'done', updated_at: T2 })

    expect(store.revertMine(current, before, mine)).toBe(current)
  })
})

describe('overlapping writes on one entry', () => {
  it('keeps the busy marker until the LAST write is out, and rolls back only its own', async () => {
    store.applyServerRow(entry({ id: 'e1', status: 'in_progress', priority: 'high' }), 'fetch')
    installDeferredSubmit()

    const a = store.patchEntry('e1', { status: 'blocked' })
    const b = store.patchEntry('e1', { priority: 'critical' })
    await tick()
    expect(inflight).toHaveLength(2)

    // B settles first. The guard must NOT open — A is still out, and the realtime
    // echo of A would revert the row under the user's cursor.
    inflight[1]({ ok: true, data: entry({ id: 'e1', priority: 'critical', updated_at: T1, last_activity_at: T1 }) })
    await b
    expect(store.getEntriesSnapshot().pending.has('e1')).toBe(true)

    // A fails — 42501/PGRST116, the case lib/permissions.ts exists to pre-empt.
    inflight[0]({ ok: false, error: 'entry.errNotYours' })
    await a

    const row = store.getEntriesSnapshot().byId.get('e1')
    expect(row?.status).toBe('in_progress') // A's change undone
    expect(row?.priority).toBe('critical') // B's change survives
    expect(store.getEntriesSnapshot().pending.has('e1')).toBe(false)
  })

  it('replays a realtime row the guard dropped while a write was in flight', async () => {
    store.applyServerRow(entry({ id: 'e1', status: 'in_progress', updated_at: T0 }), 'fetch')
    installDeferredSubmit()

    const a = store.patchEntry('e1', { status: 'blocked' })
    await tick()

    // Another user retitles it mid-flight. postgres_changes has no replay, so
    // dropping this outright lost their edit until the 45 s focus refetch.
    store.applyServerRow(entry({ id: 'e1', title: 'Renamed by Fatima', updated_at: T2 }), 'realtime')
    expect(store.getEntriesSnapshot().byId.get('e1')?.title).toBe('Firewall rule DC2')

    inflight[0]({ ok: true, data: entry({ id: 'e1', status: 'blocked', updated_at: T1 }) })
    await a

    expect(store.getEntriesSnapshot().byId.get('e1')?.title).toBe('Renamed by Fatima')
  })
})

describe('settleOutboxWrite — a queued write finds its way home', () => {
  const queued = { ok: false as const, error: 'offline.queued' }

  it('swaps the temp row for the server row instead of leaving a ghost beside it', async () => {
    installDeferredSubmit()
    const created = store.createEntryOptimistic({ title: 'Captured offline' })
    await tick()
    inflight[0](queued)
    await created

    const temp = [...store.getEntriesSnapshot().byId.keys()][0]
    expect(temp.startsWith('temp_')).toBe(true)
    expect(store.getEntriesSnapshot().pending.get(temp)?.queued).toBe(true)

    const real = entry({ id: 'real-1', title: 'Captured offline', updated_at: T1 })
    store.settleOutboxWrite(
      { table: 'entries', op: 'insert', id: null, tempId: temp, payload: {}, dedupeKey: 'k', dependsOn: [] },
      real,
    )

    const after = store.getEntriesSnapshot()
    expect(after.byId.has(temp)).toBe(false)
    expect(after.byId.get('real-1')?.title).toBe('Captured offline')
    expect(after.pending.size).toBe(0)
  })

  it('clears the busy marker a queued patch left behind', async () => {
    store.applyServerRow(entry({ id: 'e1' }), 'fetch')
    installDeferredSubmit()
    const p = store.patchEntry('e1', { status: 'blocked' })
    await tick()
    inflight[0](queued)
    await p

    expect(store.getEntriesSnapshot().pending.get('e1')?.queued).toBe(true)

    store.settleOutboxWrite(
      { table: 'entries', op: 'update', id: 'e1', tempId: null, payload: {}, dedupeKey: 'k', dependsOn: [] },
      entry({ id: 'e1', status: 'blocked', updated_at: T1 }),
    )

    const after = store.getEntriesSnapshot()
    expect(after.pending.has('e1')).toBe(false)
    expect(after.byId.get('e1')?.status).toBe('blocked')
  })

  it('replaces the optimistic thread row with the server one', async () => {
    store.applyServerRow(entry({ id: 'e1' }), 'fetch')
    installDeferredSubmit()
    const posted = store.postUpdate({ entryId: 'e1', body: 'queued note' })
    await tick()
    inflight[0](queued)
    await posted

    const thread = store.getEntriesSnapshot().updates.get('e1') ?? []
    const tempRow = thread.find((u) => u.id.startsWith('temp_'))
    expect(tempRow).toBeDefined()

    const server: EntryUpdate = {
      id: 'u1',
      entry_id: 'e1',
      author_id: 'me',
      body: 'queued note',
      status_from: null,
      status_to: null,
      created_at: T1,
    }
    store.settleOutboxWrite(
      { table: 'entry_updates', op: 'insert', id: null, tempId: tempRow?.id ?? null, payload: {}, dedupeKey: 'k', dependsOn: [] },
      server,
    )

    // Exactly one row: the temp one is gone rather than sitting beside its own
    // server row, which is the ghost this seam exists to prevent.
    const after = store.getEntriesSnapshot()
    expect((after.updates.get('e1') ?? []).map((u) => u.id)).toEqual(['u1'])
    expect(after.pending.has('e1')).toBe(false)
  })

  it('ignores a route this store did not write', () => {
    store.settleOutboxWrite(
      { table: 'notifications', op: 'update', id: '7', tempId: null, payload: {}, dedupeKey: 'k', dependsOn: [] },
      1,
    )
    expect(store.getEntriesSnapshot().byId.size).toBe(0)
  })
})

// ── derive(): the health reconciliation ────────────────────────────────────
//
// `snapshot.health` is what every pill, badge and follow-up bucket in the app
// reads, and BOTH halves of the reconciliation that produces it were unguarded
// (FIX-BACKLOG **DERIVE-HEALTH**): the stale-recompute — which this store's own
// header documents as a shipped regression — and the closed-row deletion. The
// suite never once read `getEntriesSnapshot().health`.
//
// The assertions go through the store rather than calling derive(), which is
// private and should stay private: what matters is not that a pure function
// returns the right Map, it is that the Map the screens read is that one.

describe('derive — the health map the screens actually read', () => {
  /**
   * A view row that MATCHES its entry on all four reconciliation columns.
   *
   * The generic `health()` fixture above deliberately does not: it is built for
   * countEntries, which never looks at the entry. `healthMatches` compares
   * last_activity_at, due_date, priority and status, so a fixture that differs
   * on any of them is permanently "stale" and every assertion below would be
   * measuring the fallback path while claiming to measure the server one.
   */
  function viewOf(e: Entry, over: Partial<EntryHealth> = {}): EntryHealth {
    return health(e.id, {
      last_activity_at: e.last_activity_at,
      due_date: e.due_date,
      priority: e.priority,
      status: e.status,
      track_id: e.track_id,
      ...over,
    })
  }

  /** Load a working set and its view rows through the real fetch path. */
  async function loadFetched(rows: Entry[], view: EntryHealth[]): Promise<void> {
    net.entries = rows
    net.health = view
    await store.loadEntries(true)
  }

  it('keeps the SERVER verdict while the row still matches it', async () => {
    const e = entry({ id: 'e1', last_activity_at: T0 })
    // A verdict a client mirror would never produce from this row: the view
    // knows the priority's stale threshold and this test does not.
    await loadFetched([e], [viewOf(e, { health: 'stale', days_since_activity: 99 })])

    const h = store.getEntriesSnapshot().health.get('e1')
    expect(h?.health).toBe('stale')
    expect(h?.days_since_activity).toBe(99)
    expect(store.healthMatches(h, e)).toBe(true)
  })

  it('RECOMPUTES the moment a local write invalidates the snapshot', async () => {
    // The shipped regression, restated: post an update on a nine-day-quiet item
    // and the pill kept saying stale until the next full refetch, because
    // derive() skipped any entry that merely HAD a view row.
    const e = entry({ id: 'e1', last_activity_at: T0, due_date: null })
    await loadFetched([e], [viewOf(e, { health: 'stale', days_since_activity: 99 })])
    expect(store.getEntriesSnapshot().health.get('e1')?.health).toBe('stale')

    // Same row, fresher activity — the view row is now describing an entry that
    // no longer exists.
    const touched = entry({ id: 'e1', last_activity_at: new Date().toISOString() })
    store.applyServerRow(touched, 'local')

    const h = store.getEntriesSnapshot().health.get('e1')
    expect(store.healthMatches(viewOf(e), touched)).toBe(false)
    expect(h?.health).toBe('ok')
    expect(h?.days_since_activity).toBe(0)
  })

  it('DROPS the view row when the entry closes', async () => {
    // A closed entry keeps no verdict — the view returns no row for it either,
    // so a done item must not linger in a follow-up bucket on the strength of a
    // row the next fetch will not return.
    const live = entry({ id: 'e1' })
    await loadFetched([live], [viewOf(live, { health: 'overdue', days_overdue: 4 })])
    expect(store.getEntriesSnapshot().health.has('e1')).toBe(true)

    store.applyServerRow(
      entry({ id: 'e1', status: 'done', closed_at: T2, updated_at: T2 }),
      'local',
    )
    expect(store.getEntriesSnapshot().health.has('e1')).toBe(false)
  })

  it('covers an optimistic row the view has never seen', async () => {
    await loadFetched([], [])
    // No view row at all: healthMatches(undefined, e) is false, so the fallback
    // is the only thing standing between an offline row and no badge.
    store.applyServerRow(entry({ id: 'temp-1', due_date: '2020-01-01' }), 'local')
    const h = store.getEntriesSnapshot().health.get('temp-1')
    expect(h).toBeDefined()
    expect(h?.health).toBe('overdue')
  })

  it('returns the SAME map reference when nothing needs recomputing', async () => {
    // The identity half. `derive()` returns `serverHealth` itself while the
    // stale and closed sets are both empty; every consumer memoises on this
    // reference, and minting a fresh Map per commit is what made those memos
    // useless (FIX-BACKLOG's P2 amplifier).
    const e = entry({ id: 'e1' })
    await loadFetched([e], [viewOf(e)])
    const first = store.getEntriesSnapshot().health
    expect(first.get('e1')).toBeDefined()

    // A commit that changes nothing about e1's health inputs.
    store.applyServerRow(e, 'fetch')
    expect(store.getEntriesSnapshot().health).toBe(first)
  })
})

// ── the SLA matrix (FIX-BACKLOG SLA-MATRIX) ────────────────────────────────

describe('derive — the SLA is the track × priority answer, not the priority default', () => {
  it('resolves a track override ahead of the workspace default', async () => {
    // The workspace default for `high` is 7 days (store/vocab's seed); the
    // fixture entry was created 5 days ago, so a 7-day SLA is intact and a
    // 1-day track override is blown. Feeding computeHealth the PRIORITY DEFAULT
    // — which is what this store did — answers `false` for both.
    const createdAt = new Date(Date.now() - 5 * 86_400_000).toISOString()
    const e = entry({ id: 'e1', track_id: 't-net', priority: 'high', created_at: createdAt })

    net.entries = [e]
    net.health = [] // no view row: the client mirror is the only answer
    net.slas = [{ track_id: 't-net', priority: 'high', sla_days: 1 }]
    await store.loadEntries(true)
    await store.loadTrackSlas(true)

    expect(store.getEntriesSnapshot().slaMatrix?.get('t-net:high')).toBe(1)
    expect(store.getEntriesSnapshot().health.get('e1')?.sla_breached).toBe(true)
  })

  it('re-derives every fallback row when the matrix lands after the entries', async () => {
    const createdAt = new Date(Date.now() - 5 * 86_400_000).toISOString()
    net.entries = [entry({ id: 'e1', track_id: 't-net', priority: 'high', created_at: createdAt })]
    net.health = []
    await store.loadEntries(true)
    // Nothing has told the store about the override yet.
    expect(store.getEntriesSnapshot().health.get('e1')?.sla_breached).toBe(false)

    net.slas = [{ track_id: 't-net', priority: 'high', sla_days: 1 }]
    await store.loadTrackSlas(true)
    // …and the verdict on screen changes without a second entries fetch.
    expect(store.getEntriesSnapshot().health.get('e1')?.sla_breached).toBe(true)
  })

  it('treats a failed matrix read as NO overrides and keeps a good one', async () => {
    net.slas = [{ track_id: 't-net', priority: 'high', sla_days: 1 }]
    await store.loadTrackSlas(true)
    expect(store.getEntriesSnapshot().slaMatrix?.size).toBe(1)

    net.slaOk = false
    await store.loadTrackSlas(true)
    // Dropping a good matrix on one bad response would silently RELAX every
    // deadline on screen, so the matrix survives and the error is recorded.
    expect(store.getEntriesSnapshot().slaMatrix?.size).toBe(1)
  })

  it('retries after a failed read instead of latching for the life of the tab', async () => {
    // `slaLoaded` is the dedupe latch, and it used to be set at the top of the
    // .then — ahead of the `result.ok` check. One transient failure therefore
    // retired the read permanently: the Shell warm-up and Dashboard's mount
    // effect both short-circuited on the latch, slaMatrix stayed null, and
    // resolveSlaDays() fell back to the priority default. Every SLA badge and
    // the compliance chart then showed a too-generous deadline, with nothing on
    // screen to say it was a guess and no way back short of a reload.
    //
    // Deliberately UNFORCED — `loadTrackSlas(true)` bypasses the latch, which is
    // why every test above it passed while the defect was live.
    store.resetEntries()
    net.slaOk = false
    await store.loadTrackSlas()
    expect(store.getEntriesSnapshot().slaMatrix).toBeNull()

    net.slaOk = true
    net.slas = [{ track_id: 't-net', priority: 'high', sla_days: 1 }]
    await store.loadTrackSlas()

    expect(store.getEntriesSnapshot().slaMatrix?.get('t-net:high')).toBe(1)

    // And the latch is set on the read that DID land, so a third mount is free.
    net.slas = []
    await store.loadTrackSlas()
    expect(store.getEntriesSnapshot().slaMatrix?.size).toBe(1)
  })
})

// ── §2.14: one setState per batch ──────────────────────────────────────────
//
// "A meeting bulk-commit of 20 rows produces one setState, not twenty" is
// frozen, and the `staged`/`stagedDirty`/`finally` machinery that delivers it
// had no test at all (FIX-BACKLOG **BATCH-SETSTATE**). Nothing outside this
// store, api/realtime.ts and App.tsx even names startEntriesRealtime.

describe('applyRealtimeBatch — one setState per batch', () => {
  function rows(n: number): RealtimeEvent<unknown>[] {
    return Array.from({ length: n }, (_, i) => ({
      table: 'entries' as const,
      eventType: 'INSERT' as const,
      row: entry({ id: `r${i}`, title: `Row ${i}` }),
      oldId: null,
    }))
  }

  it('notifies subscribers ONCE for a 20-row batch', () => {
    const off = store.startEntriesRealtime()
    let notifications = 0
    const unsub = store.subscribeEntries(() => {
      notifications += 1
    })
    try {
      expect(net.onBatch).not.toBeNull()
      net.onBatch?.(rows(20))
      expect(store.getEntriesSnapshot().byId.size).toBe(20)
      expect(notifications).toBe(1)
    } finally {
      unsub()
      off()
    }
  })

  it('sees row N-1 while applying row N', () => {
    // The staged snapshot is what makes that true. Applying through commit()
    // row by row would have each read the store from before the batch started
    // and silently drop the rows in front of it.
    const off = store.startEntriesRealtime()
    try {
      net.onBatch?.([
        {
          table: 'entries',
          eventType: 'INSERT',
          row: entry({ id: 'e1', title: 'first', updated_at: T0 }),
          oldId: null,
        },
        {
          table: 'entries',
          eventType: 'UPDATE',
          row: entry({ id: 'e1', title: 'second', updated_at: T1 }),
          oldId: null,
        },
      ])
      expect(store.getEntriesSnapshot().byId.get('e1')?.title).toBe('second')
    } finally {
      off()
    }
  })

  it('does not notify at all when the batch changes nothing', () => {
    const off = store.startEntriesRealtime()
    // An echo of a row we already hold, older than what is held: the monotonic
    // guard drops it, `stagedDirty` stays false, and no setState may happen.
    store.applyServerRow(entry({ id: 'e1', updated_at: T2 }), 'fetch')
    let notifications = 0
    const unsub = store.subscribeEntries(() => {
      notifications += 1
    })
    try {
      net.onBatch?.([
        { table: 'entries', eventType: 'UPDATE', row: entry({ id: 'e1', updated_at: T1 }), oldId: null },
      ])
      expect(notifications).toBe(0)
    } finally {
      unsub()
      off()
    }
  })

  it('unstages even when a row throws mid-batch', () => {
    // The `finally` exists so one malformed row cannot leave the store staged —
    // every later commit in the session would fold into a snapshot nothing
    // reads, and the app would silently stop updating.
    const off = store.startEntriesRealtime()
    try {
      expect(() =>
        net.onBatch?.([
          { table: 'entries', eventType: 'INSERT', row: entry({ id: 'ok1' }), oldId: null },
          // `row` present but not an Entry: applyServerRow reads .id off it.
          { table: 'entries', eventType: 'INSERT', row: null, oldId: null },
          { table: 'entries', eventType: 'INSERT', row: entry({ id: 'ok2' }), oldId: null },
        ]),
      ).not.toThrow()

      // The store is live afterwards, which is the property the finally buys.
      let notifications = 0
      const unsub = store.subscribeEntries(() => {
        notifications += 1
      })
      store.applyServerRow(entry({ id: 'after' }), 'fetch')
      unsub()
      expect(notifications).toBe(1)
      expect(store.getEntriesSnapshot().byId.has('after')).toBe(true)
    } finally {
      off()
    }
  })
})
