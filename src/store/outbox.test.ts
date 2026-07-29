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
// distinguish "the queue sent it" from "the queue dropped it". Mocking the two
// api modules the registry imports leaves every line of the queue itself real.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TEMP_PREFIX,
  discardOutboxItem,
  flushOutbox,
  getOutboxSnapshot,
  isTempId,
  resetOutbox,
  submit,
  type MutOp,
} from './outbox'
import { addUpdate, createEntry, updateEntry } from '../api/entries'
import { markAllRead, markRead } from '../api/notifications'

vi.mock('../api/entries', () => ({
  createEntry: vi.fn(),
  updateEntry: vi.fn(),
  addUpdate: vi.fn(),
}))
vi.mock('../api/notifications', () => ({
  markRead: vi.fn(),
  markAllRead: vi.fn(),
}))

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
  vi.mocked(markRead).mockReset()
  vi.mocked(markAllRead).mockReset()
  setOnline(true)
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
    const result = await submit(op({ table: 'meetings', op: 'insert', id: null }))
    expect(result).toEqual({ ok: false, error: 'common.error' })
  })

  it('refuses an entries update with no target rather than sending a bad uuid', async () => {
    const result = await submit(op({ id: null }))
    expect(result).toEqual({ ok: false, error: 'common.error' })
    expect(updateEntry).not.toHaveBeenCalled()
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
