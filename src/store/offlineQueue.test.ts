// store/entries + store/outbox, wired together exactly as main.tsx wires them.
//
// WHY A THIRD TEST FILE RATHER THAN MORE CASES IN THE TWO THAT EXIST.
// `outbox.test.ts` mocks the api transports and knows nothing about entries;
// `entries.test.ts` mocks the WRITE SEAM itself (`setEntriesSubmit`) so no queue
// is ever involved. Both are right for what they cover, and both are structurally
// blind to the class of bug this file exists for: a write that leaves the queue
// WITHOUT being sent, and the optimistic row it leaves behind in the other store.
// Two shipped bugs lived exactly in that gap —
//
//   * Undo on an offline capture removed the local row and left the
//     `entries:insert` op in the queue, so the entry the user was told was
//     "Undone" was created on the server the moment the network returned, and
//     the realtime echo of that insert put it back on screen.
//   * Discarding a queued write from the outbox sheet removed the op and told
//     nobody, so the row kept its `pending` marker for the life of the tab —
//     frozen at the value that had just been thrown away, refusing every refetch
//     and every teammate's realtime edit, with the outstanding-write counter
//     leaked so that two later, entirely successful patches still could not
//     clear it.
//
// Neither is visible from one store alone. So: only `api/*` is mocked here, and
// the two stores are the real ones, connected by the four real seams.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Entry } from '../types'

const net = vi.hoisted(() => ({
  /** Rows `listEntries` will answer with on the next load. */
  entries: [] as unknown[],
}))

vi.mock('../api/entries', () => ({
  listEntries: () => Promise.resolve({ ok: true, data: { rows: net.entries, truncated: false } }),
  listHealth: () => Promise.resolve({ ok: true, data: { rows: [], truncated: false } }),
  listClosedSince: () => Promise.resolve({ ok: true, data: { rows: [], truncated: false } }),
  listTrackHistory: () => Promise.resolve({ ok: true, data: { rows: [], truncated: false } }),
  listUpdates: () => Promise.resolve({ ok: true, data: [] }),
  listUpdatesFor: () => Promise.resolve({ ok: true, data: [] }),
  materializeRecurring: () => Promise.resolve({ ok: true, data: null }),
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

vi.mock('../api/realtime', () => ({
  onRealtimeBatch: () => (): void => {},
  onRealtimeResync: () => (): void => {},
}))

vi.mock('../api/tracks', () => ({
  listTrackSlas: () => Promise.resolve({ ok: true, data: [] }),
}))

import { addUpdate, createEntry, updateEntry } from '../api/entries'

type EntriesModule = typeof import('./entries')
type OutboxModule = typeof import('./outbox')
let entries: EntriesModule
let outbox: OutboxModule

/** `navigator` is a non-writable global accessor; redefining it is the way in. */
function setOnline(online: boolean): void {
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: online },
    configurable: true,
    writable: true,
  })
}

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
  entries = await import('./entries')
  outbox = await import('./outbox')

  // THE WIRING UNDER TEST. main.tsx:setEntriesSubmit / setOutboxSettle /
  // setOutboxDiscard, verbatim — if these three drift apart this file is what
  // notices, because every assertion below crosses the seam.
  entries.setEntriesSubmit(outbox.submit)
  outbox.setOutboxSettle(entries.settleOutboxWrite)
  outbox.setOutboxDiscard(entries.discardOutboxWrite)
})

const T0 = '2026-07-29T09:00:00.000Z'

function row(over: Partial<Entry> = {}): Entry {
  return {
    id: 'e1',
    track_id: 't-net',
    node_id: null,
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
    ...over,
  }
}

/** Put one server row into the store, the way a fetch would. */
function seed(entry: Entry): void {
  entries.applyServerRow(entry, 'fetch')
}

beforeEach(() => {
  outbox.resetOutbox()
  entries.resetEntries()
  vi.mocked(createEntry).mockReset()
  vi.mocked(updateEntry).mockReset()
  vi.mocked(addUpdate).mockReset()
  net.entries = []
  setOnline(true)
})

/** The temp id of the only queued `entries:insert`. */
function queuedTempId(): string {
  const item = outbox
    .getOutboxSnapshot()
    .find((i) => i.op.table === 'entries' && i.op.op === 'insert')
  if (!item?.op.tempId) throw new Error('no queued entries:insert')
  return item.op.tempId
}

describe('undo on an offline capture cancels the queued write', () => {
  it('never sends the insert once the network returns', async () => {
    setOnline(false)
    const queued = await entries.createEntryOptimistic({ title: 'Wrong item', trackId: 't-net' })

    // A notice, not an error: the optimistic row stays and the queue owns it.
    expect(queued).toEqual({ ok: false, error: 'offline.queued' })
    const tempId = queuedTempId()
    expect(entries.getEntriesSnapshot().byId.has(tempId)).toBe(true)

    const undone = await entries.undoCapture(tempId)
    expect(undone.ok).toBe(true)

    // THE ASSERTION THE BUG FAILED. Removing the local row is not cancelling the
    // write: the op used to survive here, go out on the next flush, and come
    // back as a realtime insert seconds after the user reconnected.
    expect(outbox.getOutboxSnapshot()).toHaveLength(0)

    setOnline(true)
    await outbox.flushOutbox()

    expect(createEntry).not.toHaveBeenCalled()
    expect([...entries.getEntriesSnapshot().byId.keys()]).toEqual([])
  })

  it('cancels a thread note queued against the same temp row', async () => {
    // postUpdate stamps `dependsOn: [tempId]` for a note on a not-yet-created
    // row. Left in the queue it is unsendable for ever — no insert can mint that
    // id any more — so the drain marks it 'offline.syncFailed' on every pass.
    setOnline(false)
    await entries.createEntryOptimistic({ title: 'Wrong item', trackId: 't-net' })
    const tempId = queuedTempId()
    await entries.postUpdate({ entryId: tempId, body: 'a note on it' })
    expect(outbox.getOutboxSnapshot()).toHaveLength(2)

    await entries.undoCapture(tempId)

    expect(outbox.getOutboxSnapshot()).toHaveLength(0)
    expect(entries.getEntriesSnapshot().updates.has(tempId)).toBe(false)

    setOnline(true)
    await outbox.flushOutbox()
    expect(createEntry).not.toHaveBeenCalled()
    expect(addUpdate).not.toHaveBeenCalled()
  })

  it('still cancels a queued edit made against the temp row before the undo', async () => {
    // patchEntry on a temp id targets it directly (`op.id === tempId`) as well
    // as depending on it, so both matches have to be covered.
    setOnline(false)
    await entries.createEntryOptimistic({ title: 'Wrong item', trackId: 't-net' })
    const tempId = queuedTempId()
    await entries.patchEntry(tempId, { priority: 'low' })
    expect(outbox.getOutboxSnapshot()).toHaveLength(2)

    await entries.undoCapture(tempId)

    expect(outbox.getOutboxSnapshot()).toHaveLength(0)
    setOnline(true)
    await outbox.flushOutbox()
    expect(createEntry).not.toHaveBeenCalled()
    expect(updateEntry).not.toHaveBeenCalled()
  })
})

describe('discarding a queued write settles it back into the entries store', () => {
  it('retires the pending marker instead of freezing the row for the session', async () => {
    seed(row({ title: 'Firewall rule DC2' }))
    setOnline(false)
    await entries.patchEntry('e1', { title: 'typo I gave up on' })

    // patchEntry deliberately does NOT retire a queued write — settle does.
    expect(entries.getEntriesSnapshot().pending.get('e1')?.queued).toBe(true)

    const item = outbox.getOutboxSnapshot()[0]
    outbox.discardOutboxItem(item.id)

    expect(outbox.getOutboxSnapshot()).toHaveLength(0)
    expect(entries.getEntriesSnapshot().pending.has('e1')).toBe(false)
  })

  it('lets a refetch overwrite the value that was discarded', async () => {
    // `mergeOpenFetch` preserves a pending row verbatim, so while the marker was
    // stranded the discarded text survived every refetch for the life of the tab.
    seed(row({ title: 'Firewall rule DC2' }))
    setOnline(false)
    await entries.patchEntry('e1', { title: 'typo I gave up on' })
    outbox.discardOutboxItem(outbox.getOutboxSnapshot()[0].id)

    setOnline(true)
    net.entries = [row({ title: 'Firewall rule DC2' })]
    await entries.loadEntries(true)

    expect(entries.getEntriesSnapshot().byId.get('e1')?.title).toBe('Firewall rule DC2')
  })

  it('retires the outstanding-write COUNT, not just the pending entry', async () => {
    // The leak the finding under-stated: beginWrite() ran with no matching
    // endWrite, so `outstanding` sat at 1 for ever and every later write on the
    // row saw `last === false` — meaning two entirely successful online patches
    // still left the row marked busy and still refused realtime rows.
    seed(row())
    setOnline(false)
    await entries.patchEntry('e1', { title: 'typo I gave up on' })
    outbox.discardOutboxItem(outbox.getOutboxSnapshot()[0].id)

    setOnline(true)
    vi.mocked(updateEntry).mockResolvedValue({
      ok: true,
      data: row({ title: 'first', updated_at: '2026-07-29T12:00:00.000Z' }),
    } as never)
    await entries.patchEntry('e1', { title: 'first' })
    expect(entries.getEntriesSnapshot().pending.has('e1')).toBe(false)

    vi.mocked(updateEntry).mockResolvedValue({
      ok: true,
      data: row({ title: 'second', updated_at: '2026-07-29T13:00:00.000Z' }),
    } as never)
    await entries.patchEntry('e1', { title: 'second' })
    expect(entries.getEntriesSnapshot().pending.has('e1')).toBe(false)
    expect(entries.getEntriesSnapshot().byId.get('e1')?.title).toBe('second')
  })

  it('removes the phantom row when the discarded op was the CREATE', async () => {
    // Worse than the patch case: a temp row is preserved unconditionally by
    // mergeOpenFetch, so an entry that exists nowhere on the server survived a
    // forced refetch and sat in the list for the session.
    setOnline(false)
    await entries.createEntryOptimistic({ title: 'never going anywhere', trackId: 't-net' })
    const tempId = queuedTempId()

    outbox.discardOutboxItem(outbox.getOutboxSnapshot()[0].id)

    expect(entries.getEntriesSnapshot().byId.has(tempId)).toBe(false)
    expect(entries.getEntriesSnapshot().pending.has(tempId)).toBe(false)

    setOnline(true)
    net.entries = []
    await entries.loadEntries(true)
    expect([...entries.getEntriesSnapshot().byId.keys()]).toEqual([])
  })

  it('drops the optimistic thread row when the discarded op was a note', async () => {
    seed(row())
    setOnline(false)
    await entries.postUpdate({ entryId: 'e1', body: 'a note I gave up on' })
    expect(entries.getEntriesSnapshot().updates.get('e1')).toHaveLength(1)

    outbox.discardOutboxItem(outbox.getOutboxSnapshot()[0].id)

    expect(entries.getEntriesSnapshot().updates.get('e1')).toHaveLength(0)
    expect(entries.getEntriesSnapshot().pending.has('e1')).toBe(false)
  })

  it('does not retire a write it never began', async () => {
    // The queue carries ops this store did not open: queueOrphanedTransition()
    // files an `entry_updates:insert` on api/entries' behalf, with no optimistic
    // row and no beginWrite(). Discarding one must not decrement a counter that
    // belongs to a DIFFERENT, genuinely in-flight write and reopen the monotonic
    // guard under the user's cursor.
    seed(row())
    setOnline(false)
    await entries.patchEntry('e1', { title: 'a real queued edit' })
    outbox.queueOrphanedTransition({
      entryId: 'e1',
      body: '',
      statusFrom: 'new',
      statusTo: 'in_progress',
    })

    const orphan = outbox
      .getOutboxSnapshot()
      .find((i) => i.op.table === 'entry_updates' && i.op.op === 'insert')
    expect(orphan).toBeDefined()
    if (orphan) outbox.discardOutboxItem(orphan.id)

    // The patch is still queued and still outstanding, so the row is still busy.
    expect(entries.getEntriesSnapshot().pending.has('e1')).toBe(true)
    expect(entries.getEntriesSnapshot().byId.get('e1')?.title).toBe('a real queued edit')
  })

  it('keeps the marker while a SIBLING write on the row is still outstanding', async () => {
    // Only the last write out clears the badge. A discard is not a licence to
    // reopen the monotonic guard under an edit that is genuinely still in flight.
    seed(row())
    setOnline(false)
    await entries.patchEntry('e1', { title: 'queued A' })
    await entries.patchEntry('e1', { priority: 'low' })
    expect(outbox.getOutboxSnapshot()).toHaveLength(2)

    outbox.discardOutboxItem(outbox.getOutboxSnapshot()[0].id)

    expect(entries.getEntriesSnapshot().pending.has('e1')).toBe(true)
  })
})
