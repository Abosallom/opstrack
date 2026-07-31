// The row mappers, which is where the interesting bugs in this file live.
//
// toEntryRow() exists as a named function ONLY so this file can pin the 23502
// regression: `description: input.description ?? null` on a `not null default ''`
// column (0001:304) was a guaranteed failure on every create, and it survived
// review twice because nothing called createEntry() yet. It is a one-character
// mistake to make again and a free one to catch here.
//
// Most of what follows touches no network: these are pure functions over plain
// objects, which is exactly why the mapping was pulled out of the query calls.
//
// THE ONE EXCEPTION is the last describe, and it earns the fake client. FIX-
// BACKLOG R1-DB-2 is not a mapping bug — it is what updateEntry() does BETWEEN
// its two requests when the second one fails, and there is no way to see that
// without letting the function make both. api/meetings.test.ts's objection to
// mocking PostgREST ("it proves the mock matches the mock") holds for asserting
// query shape and does not hold here: nothing below asserts what was sent, only
// what happened when a reply came back an error.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  setOrphanedTransitionSink,
  toEntryPatchRow,
  toEntryRow,
  updateEntry,
} from './entries'
import type { NewEntry } from './entries'
import type { NewEntryUpdate } from '../types'

const ME = '11111111-1111-1111-1111-111111111111'
const THEM = '22222222-2222-2222-2222-222222222222'

function minimal(overrides: Partial<NewEntry> = {}): NewEntry {
  return { title: 'Firewall rule DC2', ...overrides }
}

/**
 * A PostgREST stand-in, one level deep.
 *
 * supabase-js builders chain by returning themselves and are thenable at the
 * end, so an object whose every filter method returns itself is enough to drive
 * both of updateEntry()'s requests. Replies are a QUEUE per table, not a single
 * value: the `entries` table is hit twice in one call — the status pre-read,
 * then the PATCH — and the whole point of the test is that those two answer
 * differently.
 */
const db = vi.hoisted(() => ({
  replies: {} as Record<string, { data: unknown; error: unknown }[]>,
  session: { id: '11111111-1111-1111-1111-111111111111' as string | null },
}))

vi.mock('./supabase', () => {
  const builderFor = (table: string): Record<string, unknown> => {
    const answer = (): { data: unknown; error: unknown } =>
      db.replies[table]?.shift() ?? { data: null, error: null }
    const builder: Record<string, unknown> = {
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(answer()).then(resolve),
    }
    for (const m of ['select', 'insert', 'update', 'eq', 'in', 'order', 'limit']) {
      builder[m] = () => builder
    }
    for (const m of ['single', 'maybeSingle']) {
      builder[m] = () => Promise.resolve(answer())
    }
    return builder
  }
  return {
    supabase: {
      from: (table: string) => builderFor(table),
      auth: {
        getSession: () =>
          Promise.resolve({
            data: { session: db.session.id === null ? null : { user: { id: db.session.id } } },
          }),
      },
    },
    isConfigured: () => true,
  }
})

describe('toEntryRow', () => {
  it('sends an empty string for a missing description, never null', () => {
    // THE regression. `not null default ''` rejects null with 23502.
    expect(toEntryRow(minimal(), ME).description).toBe('')
    expect(toEntryRow(minimal({ description: null }), ME).description).toBe('')
    expect(toEntryRow(minimal({ description: 'why' }), ME).description).toBe('why')
  })

  it('writes created_by explicitly, because entries_insert checks it', () => {
    // `with check (is_member() and created_by = auth.uid())` — no column default
    // fills this in, so an omitted author is a 42501 and not a null column.
    expect(toEntryRow(minimal(), ME).created_by).toBe(ME)
  })

  it('defaults every not-null column the DB defaults', () => {
    const row = toEntryRow(minimal(), ME)
    expect(row.type).toBe('action')
    expect(row.status).toBe('new')
    expect(row.priority).toBe('medium')
    expect(row.tags).toEqual([])
    expect(row.links).toEqual([])
  })

  it('resolves the owner XOR rather than passing both through', () => {
    // entries_single_owner (0001:327) rejects a row carrying both.
    const row = toEntryRow(minimal({ ownerId: THEM, ownerName: 'Fatimah' }), ME)
    expect(row.owner_id).toBe(THEM)
    expect(row.owner_name).toBeNull()
  })

  it('keeps a free-text owner when there is no owner id', () => {
    const row = toEntryRow(minimal({ ownerName: 'Fatimah' }), ME)
    expect(row.owner_id).toBeNull()
    expect(row.owner_name).toBe('Fatimah')
  })

  it('trims the title so a stray space is not a distinct entry', () => {
    expect(toEntryRow(minimal({ title: '  Rebuild jump host  ' }), ME).title).toBe(
      'Rebuild jump host',
    )
  })
})

describe('toEntryPatchRow', () => {
  it('omits absent keys entirely', () => {
    const row = toEntryPatchRow({ status: 'blocked' })
    expect(Object.keys(row)).toEqual(['status'])
  })

  it('coalesces a cleared description to an empty string', () => {
    // The sheet clears the field by sending null; the column still rejects it.
    expect(toEntryPatchRow({ description: null }).description).toBe('')
  })

  it('clears the free-text owner when a teammate is assigned', () => {
    const row = toEntryPatchRow({ ownerId: THEM })
    expect(row.owner_id).toBe(THEM)
    expect(row.owner_name).toBeNull()
  })

  it('clears the teammate when a free-text owner is typed', () => {
    const row = toEntryPatchRow({ ownerName: 'Vendor' })
    expect(row.owner_name).toBe('Vendor')
    expect(row.owner_id).toBeNull()
  })

  it('unassigns without clearing the other side', () => {
    // Clearing owner_id to null is "unassign", not "reassign to a vendor", so it
    // must not blank a name that was never there and must not invent one.
    const row = toEntryPatchRow({ ownerId: null })
    expect(row.owner_id).toBeNull()
    expect('owner_name' in row).toBe(false)
  })

  it('passes null through for the nullable date columns', () => {
    const row = toEntryPatchRow({ dueDate: null, followUpDate: null })
    expect(row.due_date).toBeNull()
    expect(row.follow_up_date).toBeNull()
  })

  it('is empty for an empty patch, which is what the read-back branch keys off', () => {
    expect(Object.keys(toEntryPatchRow({}))).toHaveLength(0)
  })
})

/**
 * FIX-BACKLOG R1-DB-2 — the status-transition row must not be allowed to vanish.
 *
 * updateEntry() is two requests. The `entries` PATCH commits, then a SEPARATE
 * insert appends the `entry_updates` row that records the transition and names
 * its author. The second one used to be dropped with a `console.warn` on
 * failure, and migration 0004's entries_update block had traded the narrow
 * creator/owner/admin policy away FOR that record — "who changed what stays
 * answerable". A dropped connection between the two requests therefore left a
 * status change with no thread row at all, permanently, with nothing on screen.
 *
 * It was not even retried: store/outbox.ts's submit() enqueues only when
 * `navigator.onLine` is false, so this fires on exactly the case the queue does
 * not cover — a live but flaky link.
 */
describe('updateEntry — a lost transition row goes to the queue', () => {
  const entry = { id: 'e1', status: 'blocked' }

  beforeEach(() => {
    db.replies = {}
    db.session.id = ME
    setOrphanedTransitionSink(null)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  /** The two `entries` answers, in the order updateEntry asks for them. */
  function entriesRepliesFor(from: string, to: string): void {
    db.replies.entries = [
      { data: { status: from }, error: null }, // the pre-read
      { data: { ...entry, status: to }, error: null }, // the PATCH
    ]
  }

  it('hands the transition to the sink when its own insert fails', async () => {
    entriesRepliesFor('new', 'blocked')
    db.replies.entry_updates = [{ data: null, error: { code: '08006' } }]
    const sink = vi.fn()
    setOrphanedTransitionSink(sink)

    const result = await updateEntry('e1', { status: 'blocked' })

    // The status change is still durable and still reported as success — that
    // part was right and is untouched. Rolling it back would move the card, snap
    // it back, and leave it moved after a refresh anyway.
    expect(result.ok).toBe(true)

    expect(sink).toHaveBeenCalledTimes(1)
    const queued = sink.mock.calls[0][0] as NewEntryUpdate
    expect(queued).toEqual({ entryId: 'e1', body: '', statusFrom: 'new', statusTo: 'blocked' })
  })

  it('does not queue anything when the transition row lands', async () => {
    entriesRepliesFor('new', 'blocked')
    db.replies.entry_updates = [{ data: { id: 'u1' }, error: null }]
    const sink = vi.fn()
    setOrphanedTransitionSink(sink)

    await updateEntry('e1', { status: 'blocked' })

    expect(sink).not.toHaveBeenCalled()
  })

  it('writes no transition row at all when the status did not move', async () => {
    // The board drop onto the column an item is already in. There is nothing to
    // record, so there is nothing to rescue — and a blocked → blocked row in an
    // append-only thread cannot be cleaned up.
    entriesRepliesFor('blocked', 'blocked')
    db.replies.entry_updates = [{ data: null, error: { code: '08006' } }]
    const sink = vi.fn()
    setOrphanedTransitionSink(sink)

    await updateEntry('e1', { status: 'blocked' })

    expect(sink).not.toHaveBeenCalled()
  })

  it('falls back to warn-and-forget when nothing has filled the seam', async () => {
    // api/entries.ts cannot import store/outbox.ts (store → api is the allowed
    // direction, api → store is not), so main.tsx fills this. Unfilled — a test,
    // `?shell`, anything before the composition root runs — the old behaviour is
    // what is left, and it must still not throw.
    entriesRepliesFor('new', 'done')
    db.replies.entry_updates = [{ data: null, error: { code: '08006' } }]

    const result = await updateEntry('e1', { status: 'done' })

    expect(result.ok).toBe(true)
    expect(console.warn).toHaveBeenCalled()
  })
})
