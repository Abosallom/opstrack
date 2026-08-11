// The write seam under test.
//
// WHY THIS FILE EXISTS AT ALL. store/outbox.ts is the one Wave-1 module whose
// whole justification is a wave that has not happened yet: EXECUTION-PLAN §7
// risk 4 says the offline story is a one-file change *provided* the envelope and
// the queue semantics are right in Wave 1, and that "if the envelope is designed
// wrong in Wave 1 the mitigation evaporates". Nothing else exercises it — the
// entries store's tests cover its pure reducers, and no screen submits yet — so
// without this the seam would ship on a promise. Wave-1 gate (l) asks for
// exactly this: every module exercised by a test or reachable in `?shell`.
//
// WHAT IS ASSERTED is behaviour Wave 4 must not be free to change: the collapse
// keeps its position, the drain stops rather than skips, and a temp id is
// rewritten from the insert that minted it. Those three are the ones whose
// failure mode is silent data loss rather than an error.
//
// THE TRANSPORTS ARE MOCKED because the real ones import api/supabase and would
// answer notConfigured() with no credentials — a uniform failure that could not
// distinguish "the queue sent it" from "the queue dropped it". Mocking the three
// api modules the registry imports leaves every line of the queue itself real.
//
// THE ONE THING MOCKS CANNOT SEE is at the bottom of this file: whether the
// registry and main.tsx actually agree with the stores about which routes exist.
// That gate reads the sources instead, because supplying the missing half is
// precisely what a mock does.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  OUTBOX_ROUTES,
  TEMP_PREFIX,
  discardOutboxItem,
  flushOutbox,
  getOutboxSnapshot,
  isTempId,
  queueOrphanedTransition,
  resetOutbox,
  setOutboxSettle,
  startOutboxSync,
  submit,
  type MutOp,
} from './outbox'
import { addUpdate, createEntry, updateEntry } from '../api/entries'
import { appendLine, createMeeting, patchLine, patchMeeting } from '../api/meetings'
import { markAllRead, markRead } from '../api/notifications'

vi.mock('../api/entries', () => ({
  createEntry: vi.fn(),
  updateEntry: vi.fn(),
  addUpdate: vi.fn(),
}))
vi.mock('../api/meetings', () => ({
  createMeeting: vi.fn(),
  patchMeeting: vi.fn(),
  appendLine: vi.fn(),
  patchLine: vi.fn(),
}))
vi.mock('../api/notifications', () => ({
  markRead: vi.fn(),
  markAllRead: vi.fn(),
}))

/**
 * A controllable auth session.
 *
 * The queue is stamped with the account that built it, and the drain refuses to
 * send under any other one — see PersistedOutbox.owner. Proving that needs a
 * session the test can change, so the client is faked rather than absent.
 * `signIn(null)` is a sign-out.
 */
const auth = vi.hoisted(() => ({
  userId: null as string | null,
  notify: null as ((event: string, session: unknown) => void) | null,
}))

vi.mock('../api/supabase', () => ({
  supabase: {
    auth: {
      getSession: () =>
        Promise.resolve({
          data: { session: auth.userId === null ? null : { user: { id: auth.userId } } },
        }),
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        auth.notify = cb
        return { data: { subscription: { unsubscribe: () => {} } } }
      },
    },
  },
}))

function signIn(userId: string | null): void {
  auth.userId = userId
  const event = userId === null ? 'SIGNED_OUT' : 'SIGNED_IN'
  auth.notify?.(event, userId === null ? null : { user: { id: userId } })
}

/**
 * `isOffline()` reads `navigator.onLine`, and node has a `navigator` whose
 * `onLine` is undefined — which the module correctly reads as "online", since it
 * only ever trusts an explicit `false`. Redefining the whole object is the way
 * to flip it: `navigator` itself is a non-writable global accessor.
 */
function setOnline(online: boolean): void {
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: online },
    configurable: true,
    writable: true,
  })
}

const ok = <T,>(data: T) => ({ ok: true as const, data })
const no = (error: string) => ({ ok: false as const, error })

function op(over: Partial<MutOp> = {}): MutOp {
  return {
    table: 'entries',
    op: 'update',
    id: 'e1',
    tempId: null,
    payload: { title: 'x' },
    dedupeKey: 'entries:update:e1:title',
    dependsOn: [],
    ...over,
  }
}

beforeEach(() => {
  resetOutbox()
  vi.mocked(createEntry).mockReset()
  vi.mocked(updateEntry).mockReset()
  vi.mocked(addUpdate).mockReset()
  vi.mocked(createMeeting).mockReset()
  vi.mocked(patchMeeting).mockReset()
  vi.mocked(appendLine).mockReset()
  vi.mocked(patchLine).mockReset()
  vi.mocked(markRead).mockReset()
  vi.mocked(markAllRead).mockReset()
  setOnline(true)
  signIn(null)
  resetOutbox()
})

describe('isTempId', () => {
  it('recognises only the minted prefix', () => {
    expect(isTempId(`${TEMP_PREFIX}abc`)).toBe(true)
    expect(isTempId('4d1c8f7e-0000-4000-8000-000000000000')).toBe(false)
  })
})

describe('submit — online', () => {
  it('goes straight to the transport and queues nothing', async () => {
    vi.mocked(updateEntry).mockResolvedValue(ok({ id: 'e1' }) as never)

    const result = await submit(op())

    expect(updateEntry).toHaveBeenCalledWith('e1', { title: 'x' })
    expect(result.ok).toBe(true)
    expect(getOutboxSnapshot()).toHaveLength(0)
  })

  it('returns the transport failure as a key rather than queueing it', async () => {
    // navigator.onLine is optimistic — a captive portal reports true — so a
    // failure while "online" is a real failure the caller must be able to show,
    // NOT a silent queue entry the user never learns about.
    vi.mocked(updateEntry).mockResolvedValue(no('entry.errNotYours') as never)

    const result = await submit(op())

    expect(result).toEqual({ ok: false, error: 'entry.errNotYours' })
    expect(getOutboxSnapshot()).toHaveLength(0)
  })

  it('never throws, even when a transport does', async () => {
    // submit()'s "never throws" contract is load-bearing for every caller that
    // does not try/catch, which is all of them.
    vi.mocked(updateEntry).mockRejectedValue(new Error('socket hang up'))

    await expect(submit(op())).resolves.toEqual({ ok: false, error: 'common.error' })
  })

  it('answers common.error for a route with no transport instead of throwing', async () => {
    // `tracks` is one of the tables the frozen envelope names and nothing
    // submits yet — see the registry's note on why unused routes stay out.
    const result = await submit(op({ table: 'tracks', op: 'delete', id: 't1' }))
    expect(result).toEqual({ ok: false, error: 'common.error' })
  })

  it('refuses an entries update with no target rather than sending a bad uuid', async () => {
    const result = await submit(op({ id: null }))
    expect(result).toEqual({ ok: false, error: 'common.error' })
    expect(updateEntry).not.toHaveBeenCalled()
  })

  it('routes the four meeting writes, which is what makes meeting mode work offline', async () => {
    // These four were submitted by store/meetings.ts and registered nowhere, so
    // every meeting write answered 'common.error' and a meeting could not be
    // started away from wifi at all. No temp ids: meetings mint their uuids on
    // the client, so the envelope target IS the row the server will store.
    vi.mocked(createMeeting).mockResolvedValue(ok({ id: 'm1' }) as never)
    vi.mocked(patchMeeting).mockResolvedValue(ok({ id: 'm1' }) as never)
    vi.mocked(appendLine).mockResolvedValue(ok({ id: 'l1' }) as never)
    vi.mocked(patchLine).mockResolvedValue(ok({ id: 'l1' }) as never)

    await submit(op({ table: 'meetings', op: 'insert', id: null, payload: { title: 'Standup' } }))
    await submit(op({ table: 'meetings', op: 'update', id: 'm1', payload: { notes: 'n' } }))
    await submit(op({ table: 'meeting_lines', op: 'insert', id: null, payload: { raw: 'a line' } }))
    await submit(op({ table: 'meeting_lines', op: 'update', id: 'l1', payload: { state: 'note' } }))

    expect(createMeeting).toHaveBeenCalledWith({ title: 'Standup' })
    expect(patchMeeting).toHaveBeenCalledWith('m1', { notes: 'n' })
    expect(appendLine).toHaveBeenCalledWith({ raw: 'a line' })
    expect(patchLine).toHaveBeenCalledWith('l1', { state: 'note' })
  })

  it('refuses a targetless meeting update rather than sending a bad uuid', async () => {
    expect(await submit(op({ table: 'meetings', op: 'update', id: null }))).toEqual({
      ok: false,
      error: 'common.error',
    })
    expect(await submit(op({ table: 'meeting_lines', op: 'update', id: null }))).toEqual({
      ok: false,
      error: 'common.error',
    })
    expect(patchMeeting).not.toHaveBeenCalled()
    expect(patchLine).not.toHaveBeenCalled()
  })

  it('routes a null-id notifications update to mark-all', async () => {
    // The envelope distinguishes "this row" from "the whole inbox" with a field
    // it already has, which is what makes mark-all ONE op whatever the count is.
    vi.mocked(markAllRead).mockResolvedValue(ok(7) as never)
    vi.mocked(markRead).mockResolvedValue(ok(1) as never)

    await submit(op({ table: 'notifications', id: null, dedupeKey: 'n:all' }))
    expect(markAllRead).toHaveBeenCalled()
    expect(markRead).not.toHaveBeenCalled()

    await submit(op({ table: 'notifications', id: '41', dedupeKey: 'n:41' }))
    expect(markRead).toHaveBeenCalledWith(['41'])
  })
})

describe('submit — offline', () => {
  beforeEach(() => setOnline(false))

  it('queues and answers offline.queued, which is a notice and not an error', async () => {
    const result = await submit(op())

    expect(result).toEqual({ ok: false, error: 'offline.queued' })
    expect(updateEntry).not.toHaveBeenCalled()
    expect(getOutboxSnapshot()).toHaveLength(1)
  })

  it('collapses a repeated edit of the same target onto one op', async () => {
    // Typing in a description field offline must queue one op, not forty.
    await submit(op({ payload: { title: 'a' } }))
    await submit(op({ payload: { title: 'ab' } }))
    await submit(op({ payload: { title: 'abc' } }))

    const items = getOutboxSnapshot()
    expect(items).toHaveLength(1)
    expect(items[0].op.payload).toEqual({ title: 'abc' })
  })

  it('KEEPS THE ORIGINAL POSITION when it collapses', async () => {
    // Position is the only ordering information a Wave-1 queue has. An edit that
    // jumped to the back would land after ops queued later — inverting the one
    // relationship dependsOn exists to preserve.
    await submit(op({ id: 'e1', dedupeKey: 'k1' }))
    await submit(op({ id: 'e2', dedupeKey: 'k2' }))
    await submit(op({ id: 'e1', dedupeKey: 'k1', payload: { title: 'later' } }))

    expect(getOutboxSnapshot().map((i) => i.op.dedupeKey)).toEqual(['k1', 'k2'])
    expect(getOutboxSnapshot()[0].op.payload).toEqual({ title: 'later' })
  })

  it('keeps distinct targets apart', async () => {
    await submit(op({ id: 'e1', dedupeKey: 'k1' }))
    await submit(op({ id: 'e2', dedupeKey: 'k2' }))
    expect(getOutboxSnapshot()).toHaveLength(2)
  })
})

/**
 * FIX-BACKLOG R1-DB-2 — the status-transition row that lost its own request.
 *
 * `api/entries.updateEntry()` is two requests: the PATCH on `entries`, then the
 * `entry_updates` row recording the transition. The second used to be dropped
 * with a `console.warn`, and 0004:604-612 had traded the narrow `entries_update`
 * policy away for exactly that record. It now comes here instead.
 *
 * ONLINE in every test below, on purpose. This path exists for the case
 * `submit()` does NOT cover — a live but flaky link, where `navigator.onLine` is
 * true and the offline branch never runs.
 */
describe('queueOrphanedTransition — R1-DB-2', () => {
  const transition = (entryId: string, to: string) => ({
    entryId,
    body: '',
    statusFrom: 'new' as never,
    statusTo: to as never,
  })

  it('queues an entry_updates insert while the browser believes it is online', () => {
    queueOrphanedTransition(transition('e1', 'blocked'))

    const items = getOutboxSnapshot()
    expect(items).toHaveLength(1)
    expect(`${items[0].op.table}:${items[0].op.op}`).toBe('entry_updates:insert')
    expect(items[0].op.payload).toEqual(transition('e1', 'blocked'))
  })

  it('NEVER collapses two transitions onto one op', () => {
    // The regression this function's tempId exists to prevent. The dedupe key
    // convention is `${table}:${op}:${id ?? tempId}:${sortedPayloadKeys}` and an
    // entry_updates insert has no op.id — so a shared key would make the second
    // transition overwrite the first, losing exactly what was being rescued.
    queueOrphanedTransition(transition('e1', 'blocked'))
    queueOrphanedTransition(transition('e2', 'done'))
    // …including two moves on the SAME entry, which is the harder case: same
    // payload keys, same absent id.
    queueOrphanedTransition(transition('e1', 'done'))

    const items = getOutboxSnapshot()
    expect(items).toHaveLength(3)
    expect(new Set(items.map((i) => i.op.dedupeKey)).size).toBe(3)
  })

  it('carries no dependency, because the parent entry provably exists', () => {
    // The PATCH that produced this transition already succeeded against a real
    // row id. A stray dependsOn would strand the op behind an insert that is
    // never coming, and the drain marks those 'offline.syncFailed' for ever.
    queueOrphanedTransition(transition('e1', 'blocked'))
    expect(getOutboxSnapshot()[0].op.dependsOn).toEqual([])
    expect(getOutboxSnapshot()[0].op.id).toBeNull()
  })

  it('reaches addUpdate on the next drain and then leaves the queue', async () => {
    signIn('u1')
    // Settle the flush the sign-in itself triggers. flushOutbox() returns the
    // IN-FLIGHT promise while one is running, so without this the assertion
    // would await a drain that started before the row was queued.
    await flushOutbox()
    vi.mocked(addUpdate).mockResolvedValue(ok({ id: 'u-1' }) as never)

    queueOrphanedTransition(transition('e1', 'blocked'))
    await flushOutbox()

    expect(addUpdate).toHaveBeenCalledWith(transition('e1', 'blocked'))
    expect(getOutboxSnapshot()).toHaveLength(0)
  })

  it('keeps the row and stamps the failure when the retry fails too', async () => {
    signIn('u1')
    await flushOutbox()
    vi.mocked(addUpdate).mockResolvedValue(no('common.error') as never)

    queueOrphanedTransition(transition('e1', 'blocked'))
    await flushOutbox()

    // Still queued, and now visible: OutboxSheet renders it as 'offline.opNote'
    // with a discard control. Before this it was a console line and nothing.
    const items = getOutboxSnapshot()
    expect(items).toHaveLength(1)
    expect(items[0].error).toBe('common.error')
    expect(items[0].attempts).toBe(1)
  })
})

describe('offline meeting mode, end to end through the queue', () => {
  it('queues the header and its lines and drains them in that order', async () => {
    // The scenario the feature exists for: a room with no wifi. The meeting is
    // real to the tab from the first frame (client-minted uuid), the lines carry
    // a foreign key to a row that does not exist yet, and the queue's insertion
    // order is what makes that safe — the header goes out first.
    setOnline(false)
    const started = await submit(
      op({ table: 'meetings', op: 'insert', id: null, dedupeKey: 'm-ins', payload: { id: 'm1' } }),
    )
    await submit(
      op({
        table: 'meeting_lines',
        op: 'insert',
        id: null,
        dedupeKey: 'l1-ins',
        payload: { id: 'l1', meetingId: 'm1', seq: 1, raw: 'first' },
      }),
    )
    await submit(
      op({
        table: 'meeting_lines',
        op: 'insert',
        id: null,
        dedupeKey: 'l2-ins',
        payload: { id: 'l2', meetingId: 'm1', seq: 2, raw: 'second' },
      }),
    )

    // A NOTICE, not an error — store/meetings.ts keeps the optimistic row on it.
    expect(started).toEqual({ ok: false, error: 'offline.queued' })
    expect(getOutboxSnapshot()).toHaveLength(3)
    expect(createMeeting).not.toHaveBeenCalled()

    setOnline(true)
    vi.mocked(createMeeting).mockResolvedValue(ok({ id: 'm1' }) as never)
    vi.mocked(appendLine).mockResolvedValue(ok({ id: 'l1' }) as never)
    await flushOutbox()

    expect(createMeeting).toHaveBeenCalledTimes(1)
    expect(vi.mocked(appendLine).mock.calls.map((c) => c[0].raw)).toEqual(['first', 'second'])
    expect(getOutboxSnapshot()).toHaveLength(0)
  })
})

describe('flushOutbox', () => {
  it('drains oldest first and empties the queue', async () => {
    setOnline(false)
    await submit(op({ id: 'e1', dedupeKey: 'k1' }))
    await submit(op({ id: 'e2', dedupeKey: 'k2' }))
    setOnline(true)
    vi.mocked(updateEntry).mockResolvedValue(ok({ id: 'e1' }) as never)

    await flushOutbox()

    expect(vi.mocked(updateEntry).mock.calls.map((c) => c[0])).toEqual(['e1', 'e2'])
    expect(getOutboxSnapshot()).toHaveLength(0)
  })

  it('STOPS at the first failure rather than skipping past it', async () => {
    // The realistic reason op #2 failed is that the network went away again;
    // hammering #3..#20 against it burns battery to produce identical errors.
    // Stopping also keeps the queue in order for the next flush.
    setOnline(false)
    await submit(op({ id: 'e1', dedupeKey: 'k1' }))
    await submit(op({ id: 'e2', dedupeKey: 'k2' }))
    await submit(op({ id: 'e3', dedupeKey: 'k3' }))
    setOnline(true)
    vi.mocked(updateEntry)
      .mockResolvedValueOnce(ok({ id: 'e1' }) as never)
      .mockResolvedValueOnce(no('common.error') as never)

    await flushOutbox()

    expect(vi.mocked(updateEntry)).toHaveBeenCalledTimes(2)
    const left = getOutboxSnapshot()
    expect(left.map((i) => i.op.dedupeKey)).toEqual(['k2', 'k3'])
    expect(left[0].error).toBe('common.error')
    expect(left[0].attempts).toBe(1)
  })

  it('rewrites a temp id from the insert that minted it', async () => {
    // THE case that makes the queue worth having: a create and a follow-up edit
    // of the same row, queued together. Without the rewrite the update would be
    // sent against `temp_…`, reach Postgres as a malformed uuid, and be dropped
    // — data loss dressed as a sync.
    const temp = `${TEMP_PREFIX}1111`
    setOnline(false)
    await submit(op({ op: 'insert', id: null, tempId: temp, dedupeKey: 'c1', payload: {} }))
    await submit(op({ id: temp, dependsOn: [temp], dedupeKey: 'u1' }))
    setOnline(true)
    vi.mocked(createEntry).mockResolvedValue(ok({ id: 'server-uuid' }) as never)
    vi.mocked(updateEntry).mockResolvedValue(ok({ id: 'server-uuid' }) as never)

    await flushOutbox()

    expect(vi.mocked(updateEntry).mock.calls[0][0]).toBe('server-uuid')
    expect(getOutboxSnapshot()).toHaveLength(0)
  })

  it('marks an unresolvable temp id instead of sending it', async () => {
    // No amount of retrying fixes this one: the insert that would have resolved
    // it is the thing that failed. Marking and moving on beats spinning.
    setOnline(false)
    await submit(op({ id: `${TEMP_PREFIX}orphan`, dedupeKey: 'u1' }))
    setOnline(true)

    await flushOutbox()

    expect(updateEntry).not.toHaveBeenCalled()
    expect(getOutboxSnapshot()[0].error).toBe('offline.syncFailed')
  })

  it('sends nothing while still offline', async () => {
    setOnline(false)
    await submit(op())

    await flushOutbox()

    expect(updateEntry).not.toHaveBeenCalled()
    expect(getOutboxSnapshot()).toHaveLength(1)
  })

  it('clears the previous round of errors so a retry is a retry', async () => {
    setOnline(false)
    await submit(op({ id: 'e1', dedupeKey: 'k1' }))
    setOnline(true)
    vi.mocked(updateEntry).mockResolvedValueOnce(no('common.error') as never)
    await flushOutbox()
    expect(getOutboxSnapshot()[0].error).toBe('common.error')

    vi.mocked(updateEntry).mockResolvedValueOnce(ok({ id: 'e1' }) as never)
    await flushOutbox()
    expect(getOutboxSnapshot()).toHaveLength(0)
  })

  it('routes an entry_updates insert to addUpdate', async () => {
    setOnline(false)
    await submit(
      op({ table: 'entry_updates', op: 'insert', id: null, dedupeKey: 'a1', payload: { body: 'x' } }),
    )
    setOnline(true)
    vi.mocked(addUpdate).mockResolvedValue(ok({ id: 'u1' }) as never)

    await flushOutbox()

    expect(addUpdate).toHaveBeenCalledWith({ body: 'x' })
  })
})

// ── the two drain-concurrency invariants (FIX-BACKLOG OUTBOX-DRAIN) ────────
//
// The single-flush guard and the re-read-per-item rule are the two things
// standing between this queue and duplicate or lost sends, and neither was
// asserted: the suite had fourteen `flushOutbox` references and not one of them
// held two drains open at the same time. Both failure modes are silent —
// duplicated writes, or an op the user discarded going out anyway — so a
// green suite without these tests said nothing about either.

describe('flushOutbox — concurrency', () => {
  /** A transport that hangs until the test lands it. */
  function deferredUpdate(): { land: (id: string) => void; calls: () => string[] } {
    const pending: Array<(r: unknown) => void> = []
    const ids: string[] = []
    vi.mocked(updateEntry).mockImplementation(((id: string) => {
      ids.push(id)
      return new Promise((resolve) => pending.push(resolve as (r: unknown) => void))
    }) as never)
    return {
      land: (id: string) => pending.shift()?.(ok({ id })),
      calls: () => ids,
    }
  }

  it('hands a second caller the SAME promise instead of a second drain', async () => {
    setOnline(false)
    await submit(op({ id: 'e1', dedupeKey: 'k1' }))
    await submit(op({ id: 'e2', dedupeKey: 'k2' }))
    setOnline(true)
    const t = deferredUpdate()

    // Both callers race: the visibility handler and the online listener both
    // fire when a phone comes back from sleep on a new network.
    const first = flushOutbox()
    const second = flushOutbox()
    // Identity, not equivalence. Two DISTINCT promises that happen to resolve
    // together would still mean two drains, and two drains send every op twice.
    expect(second).toBe(first)

    await Promise.resolve()
    expect(t.calls()).toEqual(['e1'])
    t.land('e1')
    await Promise.resolve()
    await Promise.resolve()
    t.land('e2')
    await Promise.all([first, second])

    // One send per op, and the queue is empty.
    expect(t.calls()).toEqual(['e1', 'e2'])
    expect(getOutboxSnapshot()).toHaveLength(0)
  })

  it('starts a NEW drain once the previous one has settled', async () => {
    // The guard must be a mutex, not a latch: `flushing` is cleared in a
    // `finally`, and a queue that flushed exactly once per tab would be worse
    // than no queue at all.
    setOnline(false)
    await submit(op({ id: 'e1', dedupeKey: 'k1' }))
    setOnline(true)
    vi.mocked(updateEntry).mockResolvedValue(ok({ id: 'e1' }) as never)

    const first = flushOutbox()
    await first
    const second = flushOutbox()
    expect(second).not.toBe(first)
    await second
  })

  it('re-reads each item, so one discarded MID-DRAIN is never sent', async () => {
    // The drain iterates a snapshot of the ORDER but re-reads every item from
    // the store. Iterating a snapshot of the ITEMS instead would send a write
    // the user cancelled while an earlier one was still in flight — from their
    // side, a discard button that does nothing.
    setOnline(false)
    await submit(op({ id: 'e1', dedupeKey: 'k1' }))
    await submit(op({ id: 'e2', dedupeKey: 'k2' }))
    await submit(op({ id: 'e3', dedupeKey: 'k3' }))
    setOnline(true)
    const t = deferredUpdate()

    const flush = flushOutbox()
    await Promise.resolve()
    expect(t.calls()).toEqual(['e1'])

    // e2 is discarded while e1 is still out.
    const e2 = getOutboxSnapshot().find((i) => i.op.dedupeKey === 'k2')
    expect(e2).toBeDefined()
    discardOutboxItem(e2?.id ?? '')

    t.land('e1')
    await Promise.resolve()
    await Promise.resolve()
    t.land('e3')
    await flush

    expect(t.calls()).toEqual(['e1', 'e3'])
    expect(getOutboxSnapshot()).toHaveLength(0)
  })

  it('leaves an op QUEUED mid-drain for the next flush', async () => {
    // The other half of the same rule: the order snapshot is taken once, so a
    // write made while the drain is running is not swept into it. Sending it
    // would race the optimistic apply that has not finished yet.
    setOnline(false)
    await submit(op({ id: 'e1', dedupeKey: 'k1' }))
    setOnline(true)
    const t = deferredUpdate()

    const flush = flushOutbox()
    await Promise.resolve()
    expect(t.calls()).toEqual(['e1'])

    // Queued while the drain holds e1 open. `submit` is online now, so it is
    // pushed onto the queue only because a flush is in progress — force it
    // there the way a real offline blip would.
    setOnline(false)
    await submit(op({ id: 'e9', dedupeKey: 'k9' }))
    setOnline(true)

    t.land('e1')
    await flush

    expect(t.calls()).toEqual(['e1'])
    expect(getOutboxSnapshot().map((i) => i.op.dedupeKey)).toEqual(['k9'])
  })

  it('does not delete a payload that COLLAPSED onto the item mid-flight', async () => {
    // The third concurrency case, and the one that lost data. `enqueue()`
    // collapses onto the existing item's ID, and the drain removes by that id
    // after its await — so an edit submitted while the request was out inherited
    // the id and was deleted by the completion of a request that had never
    // carried it. The user saw 'offline.queued' (a notice, not an error) and an
    // optimistic row showing text the server would never have.
    setOnline(false)
    await submit(op({ id: 'e1', payload: { title: 'first' }, dedupeKey: 'k1' }))
    setOnline(true)
    const t = deferredUpdate()

    const flush = flushOutbox()
    await Promise.resolve()
    expect(t.calls()).toEqual(['e1'])

    // Same dedupeKey — the user edits the same field again during a blip.
    setOnline(false)
    await submit(op({ id: 'e1', payload: { title: 'second' }, dedupeKey: 'k1' }))
    setOnline(true)
    expect(getOutboxSnapshot()).toHaveLength(1)

    t.land('e1')
    await flush

    // The newer payload is STILL QUEUED, not silently gone.
    expect(getOutboxSnapshot().map((i) => i.op.payload)).toEqual([{ title: 'second' }])

    // And it goes out on the next pass.
    vi.mocked(updateEntry).mockResolvedValue(ok({ id: 'e1' }) as never)
    await flushOutbox()
    expect(vi.mocked(updateEntry).mock.calls.at(-1)).toEqual(['e1', { title: 'second' }])
    expect(getOutboxSnapshot()).toHaveLength(0)
  })
})

// ── the temp id has to outlive the drain that resolved it ──────────────────

describe('flushOutbox — temp ids across flushes', () => {
  it('sends a dependent op that missed its create by one transient failure', async () => {
    // "Capture offline, then add a note" is two ops: entries:insert with a temp
    // id, and entry_updates:insert carrying that temp id in payload.entryId and
    // in dependsOn. When the mapping lived in a Map scoped to one drain, a
    // single failure between them was terminal: the create was gone from the
    // queue, nothing left could mint `temp_…`, and the note was stamped
    // 'offline.syncFailed' on every flush for the rest of the tab's life —
    // while the entry it belonged to sat on the server, thread-less.
    const temp = `${TEMP_PREFIX}aaa`
    setOnline(false)
    await submit(op({ op: 'insert', id: null, tempId: temp, dedupeKey: 'c1', payload: {} }))
    await submit(
      op({
        table: 'entry_updates',
        op: 'insert',
        id: null,
        tempId: `${TEMP_PREFIX}note`,
        payload: { entryId: temp, body: 'a note' },
        dedupeKey: `entry_updates:insert:${temp}:body`,
        dependsOn: [temp],
      }),
    )
    setOnline(true)

    vi.mocked(createEntry).mockResolvedValue(ok({ id: 'real-1' }) as never)
    vi.mocked(addUpdate).mockResolvedValue(no('common.error') as never)

    await flushOutbox()

    // Drain 1: the create landed and the note failed once — a normal blip.
    expect(vi.mocked(addUpdate)).toHaveBeenCalledTimes(1)
    expect(getOutboxSnapshot()).toHaveLength(1)
    expect(getOutboxSnapshot()[0].error).toBe('common.error')

    // The queue itself now holds the real id: envelope, payload AND dedupeKey.
    const queued = getOutboxSnapshot()[0].op
    expect(queued.dependsOn).toEqual(['real-1'])
    expect(queued.payload).toEqual({ entryId: 'real-1', body: 'a note' })
    expect(queued.dedupeKey).toBe('entry_updates:insert:real-1:body')

    // Drain 2, with the network back.
    vi.mocked(addUpdate).mockResolvedValue(ok({ id: 'u1' }) as never)
    await flushOutbox()

    expect(vi.mocked(addUpdate).mock.calls.at(-1)?.[0]).toEqual({
      entryId: 'real-1',
      body: 'a note',
    })
    expect(getOutboxSnapshot()).toHaveLength(0)
  })

  it('still refuses an op whose create the user discarded', async () => {
    // The guard is not removed, only made honest: after resolveTempId() rewrites
    // the queue the instant an insert lands, a temp id left in an envelope means
    // nothing queued will ever mint it. Retrying that forever is spinning.
    const temp = `${TEMP_PREFIX}bbb`
    setOnline(false)
    await submit(op({ op: 'insert', id: null, tempId: temp, dedupeKey: 'c1', payload: {} }))
    await submit(op({ id: temp, dependsOn: [temp], dedupeKey: 'u1' }))
    setOnline(true)

    discardOutboxItem(getOutboxSnapshot()[0].id)
    await flushOutbox()

    expect(vi.mocked(updateEntry)).not.toHaveBeenCalled()
    expect(getOutboxSnapshot()[0].error).toBe('offline.syncFailed')
  })
})

describe('queue management', () => {
  it('discards one op the user gave up on', async () => {
    setOnline(false)
    await submit(op({ id: 'e1', dedupeKey: 'k1' }))
    await submit(op({ id: 'e2', dedupeKey: 'k2' }))

    discardOutboxItem(getOutboxSnapshot()[0].id)

    expect(getOutboxSnapshot().map((i) => i.op.dedupeKey)).toEqual(['k2'])
  })

  it('empties the queue on reset, because another account must not inherit it', async () => {
    setOnline(false)
    await submit(op())
    resetOutbox()
    expect(getOutboxSnapshot()).toHaveLength(0)
  })
})

/* ─────────────────────────── durability ────────────────────────────────────
 *
 * Until Wave 4 the queue was module state, so `fail('offline.queued')` — which
 * the UI renders as "saved on this device" — was a promise the app could not
 * keep: a reload, a crash, or iOS evicting a backgrounded WKWebView destroyed
 * every unsent write with no error anywhere. These assert the round trip, and
 * that a corrupt entry costs one item rather than the whole queue.
 */

/** Install a localStorage shim; lib/cache.ts re-reads the global on every call. */
function withStorage(seed: Record<string, string> = {}): {
  read: (k: string) => string | null
  restore: () => void
} {
  const cells = new Map(Object.entries(seed))
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => cells.get(k) ?? null,
      setItem: (k: string, v: string) => cells.set(k, v),
      removeItem: (k: string) => cells.delete(k),
    },
    configurable: true,
    writable: true,
  })
  return {
    read: (k) => cells.get(k) ?? null,
    restore: () => Reflect.deleteProperty(globalThis, 'localStorage'),
  }
}

const OUTBOX_KEY = 'nphiescore_outbox_v1'

describe('durability', () => {
  it('writes the queue to storage on every change, and clears it on reset', async () => {
    const store = withStorage()
    try {
      setOnline(false)
      await submit(op({ id: 'e1', dedupeKey: 'k1' }))

      const raw = store.read(OUTBOX_KEY)
      expect(raw).not.toBeNull()
      expect(JSON.parse(raw ?? 'null')).toMatchObject({
        // Stamped with the account whose credentials these writes will go out
        // under; null here because the test has no Supabase client configured.
        owner: null,
        items: [{ op: { table: 'entries', op: 'update', id: 'e1' }, revision: 0 }],
      })

      // Sign-out drops the key entirely, not just its contents: the next account
      // on this device must not find a queue at all.
      resetOutbox()
      expect(store.read(OUTBOX_KEY)).toBeNull()
    } finally {
      store.restore()
    }
  })

  it('rehydrates a previous session, dropping only the items it cannot replay', async () => {
    const store = withStorage({
      [OUTBOX_KEY]: JSON.stringify({
        owner: null,
        items: [
          {
            id: 'kept',
            attempts: 2,
            queuedAt: 1,
            error: 'common.error',
            revision: 3,
            op: {
              table: 'entries',
              op: 'update',
              id: 'e1',
              tempId: null,
              payload: { title: 'survived the reload' },
              dedupeKey: 'k1',
              dependsOn: [],
            },
          },
          // Written by a future version of this file, or hand-edited. Replaying
          // it would reach Postgres as a malformed request and park the drain.
          { id: 'junk', op: { table: 'not_a_table', op: 'insert' } },
        ],
      }),
    })
    // A second module instance subscribes to the mocked auth client and would
    // otherwise steal `signIn`'s callback from the instance every other test
    // holds — the one hazard of importing the module under test twice.
    const subscriber = auth.notify
    // Offline for the duration: a fresh instance reads the session and flushes
    // on its own, which is the behaviour a reload wants and would mutate the
    // very state being asserted here.
    setOnline(false)
    try {
      vi.resetModules()
      const fresh = await import('./outbox')
      const items = fresh.getOutboxSnapshot()

      expect(items).toHaveLength(1)
      expect(items[0].id).toBe('kept')
      expect(items[0].attempts).toBe(2)
      expect(items[0].revision).toBe(3)
      expect(items[0].op.payload).toEqual({ title: 'survived the reload' })
    } finally {
      vi.resetModules()
      auth.notify = subscriber
      store.restore()
    }
  })
})

/* ───────────── whose queue is it (the cost of persisting one) ───────────────
 *
 * App.tsx's sign-out effect already calls resetOutbox(), and its comment names
 * the hazard: "worst of all queued writes that would leave under the new
 * session's credentials". That cleanup never runs for a tab that is simply
 * CLOSED with unsent writes — which was harmless while the queue died with the
 * module, and is not harmless now that it survives on disk. A replayed write is
 * not a stale read: `created_by = auth.uid()` makes it content authored by one
 * person and posted, indistinguishably, as another.
 */

describe('the queue belongs to an account', () => {
  it('stamps the signed-in user on what it persists', async () => {
    const store = withStorage()
    try {
      signIn('user-a')
      setOnline(false)
      await submit(op({ id: 'e1', dedupeKey: 'k1' }))

      expect(JSON.parse(store.read(OUTBOX_KEY) ?? 'null')).toMatchObject({ owner: 'user-a' })
    } finally {
      store.restore()
    }
  })

  it('DISCARDS a queue when a different account is signed in', async () => {
    signIn('user-a')
    setOnline(false)
    await submit(op({ id: 'e1', dedupeKey: 'k1' }))
    setOnline(true)
    vi.mocked(updateEntry).mockResolvedValue(ok({ id: 'e1' }) as never)

    signIn('user-b')
    await flushOutbox()

    expect(vi.mocked(updateEntry)).not.toHaveBeenCalled()
    expect(getOutboxSnapshot()).toHaveLength(0)
  })

  it('HOLDS a queue while nobody is signed in, rather than burning attempts', async () => {
    // The middle answer. Sending here would 401, increment `attempts`, and back
    // the whole queue off — for the ordinary case of a reload, where the session
    // simply has not been restored yet.
    signIn('user-a')
    setOnline(false)
    await submit(op({ id: 'e1', dedupeKey: 'k1' }))
    setOnline(true)
    vi.mocked(updateEntry).mockResolvedValue(ok({ id: 'e1' }) as never)

    signIn(null)
    await flushOutbox()

    expect(vi.mocked(updateEntry)).not.toHaveBeenCalled()
    expect(getOutboxSnapshot()).toHaveLength(1)
    expect(getOutboxSnapshot()[0].attempts).toBe(0)

    // …and goes out the moment the same account is back.
    signIn('user-a')
    await flushOutbox()
    expect(vi.mocked(updateEntry)).toHaveBeenCalledTimes(1)
    expect(getOutboxSnapshot()).toHaveLength(0)
  })
})

/* ────────────────────────── flush triggers ─────────────────────────────────
 *
 * The `online` event alone was not a retry policy. A drain stops at the first
 * failure by design, so one 500, one rate limit or one brief RLS hiccup parked
 * the entire remainder of the queue until the device next transitioned
 * offline→online — on a desktop that never leaves wifi, never. `attempts` was
 * incremented and read by nothing.
 */

/** Minimal window/document, since vitest runs in `node`. */
function withDom(): { fire: (type: string) => void; listeners: () => number; restore: () => void } {
  const listeners = new Map<string, Set<() => void>>()
  const target = {
    addEventListener: (type: string, fn: () => void) => {
      const set = listeners.get(type) ?? new Set()
      set.add(fn)
      listeners.set(type, set)
    },
    removeEventListener: (type: string, fn: () => void) => {
      listeners.get(type)?.delete(fn)
    },
  }
  Object.defineProperty(globalThis, 'window', { value: target, configurable: true, writable: true })
  Object.defineProperty(globalThis, 'document', {
    value: { ...target, visibilityState: 'visible' },
    configurable: true,
    writable: true,
  })
  return {
    fire: (type) => listeners.get(type)?.forEach((fn) => fn()),
    listeners: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
    restore: () => {
      Reflect.deleteProperty(globalThis, 'window')
      Reflect.deleteProperty(globalThis, 'document')
    },
  }
}

describe('startOutboxSync', () => {
  it('retries a SERVER failure on a backoff, with no connectivity event at all', async () => {
    vi.useFakeTimers()
    const dom = withDom()
    let stop = (): void => {}
    try {
      setOnline(false)
      await submit(op({ id: 'e1', dedupeKey: 'k1' }))
      setOnline(true)
      vi.mocked(updateEntry).mockResolvedValue(no('common.error') as never)

      // Installing the wiring also drains what the last session left behind —
      // a reload with a queue in storage is the common case and fires no event.
      stop = startOutboxSync()
      await flushOutbox()

      expect(vi.mocked(updateEntry)).toHaveBeenCalledTimes(1)
      expect(getOutboxSnapshot()[0].attempts).toBe(1)

      // Nothing goes offline and nothing comes back online. The timer is the
      // only thing that can move this queue.
      vi.mocked(updateEntry).mockResolvedValue(ok({ id: 'e1' }) as never)
      await vi.advanceTimersByTimeAsync(2_000)

      expect(vi.mocked(updateEntry)).toHaveBeenCalledTimes(2)
      expect(getOutboxSnapshot()).toHaveLength(0)
    } finally {
      stop()
      dom.restore()
      vi.useRealTimers()
    }
  })

  it('flushes when the tab is foregrounded, and unhooks everything on teardown', async () => {
    const dom = withDom()
    try {
      setOnline(false)
      await submit(op({ id: 'e1', dedupeKey: 'k1' }))
      setOnline(true)
      vi.mocked(updateEntry).mockResolvedValue(ok({ id: 'e1' }) as never)

      const stop = startOutboxSync()
      await flushOutbox()
      expect(getOutboxSnapshot()).toHaveLength(0)

      // A phone that slept through the outage never fires `online` — it was
      // never told it went offline, it just wakes up connected.
      setOnline(false)
      await submit(op({ id: 'e2', dedupeKey: 'k2' }))
      setOnline(true)
      dom.fire('visibilitychange')
      await flushOutbox()
      expect(getOutboxSnapshot()).toHaveLength(0)

      expect(dom.listeners()).toBeGreaterThan(0)
      stop()
      expect(dom.listeners()).toBe(0)
    } finally {
      dom.restore()
    }
  })
})

describe('the settle seam — a drained write finds its way home', () => {
  it('hands each landed op and its row to the registered store', async () => {
    // Without this the queue was half a queue: the write went out and the
    // optimistic row stayed on screen stamped "queued" beside the real row from
    // the next fetch, for the life of the tab.
    const settled: Array<[string, unknown]> = []
    setOutboxSettle((o, data) => settled.push([`${o.table}:${o.op}`, data]))

    setOnline(false)
    await submit(op({ op: 'insert', id: null, tempId: `${TEMP_PREFIX}a`, dedupeKey: 'c1', payload: {} }))
    setOnline(true)
    vi.mocked(createEntry).mockResolvedValue(ok({ id: 'server-uuid' }) as never)

    await flushOutbox()

    expect(settled).toEqual([['entries:insert', { id: 'server-uuid' }]])
    setOutboxSettle(null)
  })

  it('hands over the REWRITTEN op, so the store can pair temp id with real id', async () => {
    const seen: MutOp[] = []
    setOutboxSettle((o) => seen.push(o))

    const temp = `${TEMP_PREFIX}b`
    setOnline(false)
    await submit(op({ op: 'insert', id: null, tempId: temp, dedupeKey: 'c1', payload: {} }))
    await submit(op({ id: temp, dependsOn: [temp], dedupeKey: 'u1' }))
    setOnline(true)
    vi.mocked(createEntry).mockResolvedValue(ok({ id: 'server-uuid' }) as never)
    vi.mocked(updateEntry).mockResolvedValue(ok({ id: 'server-uuid' }) as never)

    await flushOutbox()

    // The insert still carries its temp id — that is how the store finds the
    // optimistic row — while the update's target has become the real one.
    expect(seen[0].tempId).toBe(temp)
    expect(seen[1].id).toBe('server-uuid')
    setOutboxSettle(null)
  })

  it('does not let a throwing settle strand the rest of the queue', async () => {
    setOutboxSettle(() => {
      throw new Error('a store bug')
    })
    setOnline(false)
    await submit(op({ id: 'e1', dedupeKey: 'k1' }))
    await submit(op({ id: 'e2', dedupeKey: 'k2' }))
    setOnline(true)
    vi.mocked(updateEntry).mockResolvedValue(ok({ id: 'e' }) as never)

    await flushOutbox()

    expect(vi.mocked(updateEntry)).toHaveBeenCalledTimes(2)
    expect(getOutboxSnapshot()).toHaveLength(0)
    setOutboxSettle(null)
  })

  it('rewrites a temp id INSIDE the payload, not only in the envelope', async () => {
    // entry_updates:insert carries its parent in payload.entryId and has no
    // op.id at all. Rewriting only the envelope sent `entryId: 'temp_…'` to
    // Postgres as a malformed uuid and lost the update — the exact loss the
    // rewrite exists to prevent, one field over.
    const temp = `${TEMP_PREFIX}c`
    setOnline(false)
    await submit(op({ op: 'insert', id: null, tempId: temp, dedupeKey: 'c1', payload: {} }))
    await submit(
      op({
        table: 'entry_updates',
        op: 'insert',
        id: null,
        tempId: `${TEMP_PREFIX}note`,
        payload: { entryId: temp, body: 'a note' },
        dedupeKey: 'n1',
        dependsOn: [temp],
      }),
    )
    setOnline(true)
    vi.mocked(createEntry).mockResolvedValue(ok({ id: 'server-uuid' }) as never)
    vi.mocked(addUpdate).mockResolvedValue(ok({ id: 'u1' }) as never)

    await flushOutbox()

    expect(vi.mocked(addUpdate).mock.calls[0][0]).toEqual({ entryId: 'server-uuid', body: 'a note' })
    expect(getOutboxSnapshot()).toHaveLength(0)
  })
})

/* ─────────────────── the registry ↔ stores coverage gate ───────────────────
 *
 * WHY A SOURCE SCAN AND NOT A UNIT TEST. The defect this replaces was not a
 * wrong line anywhere — every line in store/meetings.ts and every line in
 * store/outbox.ts was correct on its own. The bug lived in the SPACE between
 * two files: a store submitted four routes the registry did not know, and the
 * composition root never pointed that store at the queue. Nothing that mocks
 * either side can see that, because mocking is exactly the act of supplying the
 * half that is missing. So this reads the sources.
 *
 * Both halves are asserted because either alone is a broken state: routes with
 * no wiring are dead code and the store keeps sending directly (it can never
 * queue); wiring with no routes fails every write, online and off.
 *
 * Source is read through import.meta.glob('?raw') rather than node:fs, for the
 * reason lib/localeReach.test.ts spells out: tsconfig.app.json pins
 * `types: ["vite/client"]`, and adding "node" would leak node globals into the
 * type space of every app file.
 */

// The options object has to be an inline literal — Vite parses this statically.
const STORE_FILES: Record<string, string> = import.meta.glob('./*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
})
const MAIN_FILE: Record<string, string> = import.meta.glob('../main.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
})

function storeSource(): { file: string; text: string }[] {
  return Object.entries(STORE_FILES)
    .filter(([path]) => !path.endsWith('.test.ts'))
    .map(([path, text]) => ({ file: path.replace('./', 'src/store/'), text }))
}

/** Every `${table}:${op}` a store builds a MutOp for, with the file it is in. */
function submittedRoutes(): { file: string; route: string }[] {
  // Matches the MutOp literal's first two fields, tolerating a comment line
  // between them. Stores build these inline at the submit call; there is no
  // other shape in the codebase, and a new one that does not match here would
  // simply not be covered — which is why the count is asserted too.
  const RE = /table:\s*'(\w+)',\s*(?:\/\/[^\n]*\n\s*)*op:\s*'(insert|update|delete)'/g
  const out: { file: string; route: string }[] = []
  for (const { file, text } of storeSource()) {
    for (const m of text.matchAll(RE)) out.push({ file, route: `${m[1]}:${m[2]}` })
  }
  return out
}

describe('transport registry coverage', () => {
  it('finds the op literals it is supposed to be checking', () => {
    // A regex that silently matched nothing would make the assertion below
    // vacuously true — the precise failure mode that let this ship.
    const routes = submittedRoutes()
    expect(routes.length).toBeGreaterThanOrEqual(9)
    expect(new Set(routes.map((r) => r.file)).size).toBeGreaterThanOrEqual(3)
  })

  it('registers a transport for every route a store actually submits', () => {
    const missing = submittedRoutes()
      .filter((r) => !OUTBOX_ROUTES.includes(r.route))
      .map((r) => `${r.file} submits ${r.route}, which has no transport`)
    expect([...new Set(missing)]).toEqual([])
  })

  it('points every store that owns a submit seam at the queue, in main.tsx', () => {
    // The other half. store/meetings.ts exported setMeetingsSubmit for a whole
    // wave while main.tsx never called it, so the seam stayed on its send-now
    // default and every QUEUED_KEY branch in that store was dead code.
    const main = Object.values(MAIN_FILE)[0] ?? ''
    expect(main).toContain('createRoot') // the glob resolved to the real file
    const seams = storeSource().flatMap(({ file, text }) =>
      [...text.matchAll(/export function (set\w+Submit)\(/g)].map((m) => ({ file, fn: m[1] })),
    )
    expect(seams.length).toBeGreaterThanOrEqual(3)
    const unwired = seams
      .filter((s) => !main.includes(`${s.fn}(submit)`))
      .map((s) => `${s.file} exports ${s.fn} but main.tsx never calls it`)
    expect(unwired).toEqual([])
  })

  it('installs the flush triggers from main.tsx', () => {
    // Same class of defect as the two above, and the same reason a mock cannot
    // see it: the queue only ever sends when something asks it to, and
    // startOutboxSync() is the only thing that asks. Unwired, every offline
    // write is persisted, promised to the user and never sent — which is a
    // worse outcome than not queueing, because the app said it was saved.
    const main = Object.values(MAIN_FILE)[0] ?? ''
    expect(main).toContain('createRoot')
    expect(main).toContain('startOutboxSync()')
  })

  it('points api/entries at the queue for orphaned transition rows', () => {
    // FIX-BACKLOG R1-DB-2, and the same half-wired failure mode one layer down.
    // api/entries.ts cannot import store/outbox.ts — store → api is the allowed
    // direction and api → store is not — so the sink is filled here or not at
    // all, and unfilled it silently reverts to warn-and-forget. There is no test
    // that can see that from inside either module, because supplying the missing
    // half is what a mock does.
    const main = Object.values(MAIN_FILE)[0] ?? ''
    expect(main).toContain('createRoot')
    expect(main).toContain('setOrphanedTransitionSink(queueOrphanedTransition)')
  })
})
