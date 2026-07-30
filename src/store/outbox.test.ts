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
  resetOutbox,
  setOutboxSettle,
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
})
