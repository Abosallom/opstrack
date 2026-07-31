// The session boundary in the meetings store: what resetMeetings() has to
// clear, and what a read still on the wire is allowed to write back.
//
// WHY THIS FILE EXISTS. resetMeetings() shipped with ZERO call sites — its own
// doc comment named the caller it never got, and src/App.tsx's sign-out cleanup
// called the other five stores' resets and omitted this one. That is asserted
// against the composition root in signOutReset.test.ts, which is the half that
// keeps the wiring honest. This half covers the other question the omission
// exposed: whether the function, once called, actually closes the session.
//
// The two things that made the omission expensive are both LATCHES. `loadedAt`
// (meetings.ts, loadMeetings) and `linesLoadedAt` (loadLines) are consulted
// without a clock and without a session check, so a stale one answers the next
// account's first read from memory — no spinner, no request. Two of the tests
// below are exactly that: load as A, reset, load as B, and count the requests.
//
// THE EPOCH TESTS ARE NEW BEHAVIOUR, not a re-assertion. Clearing state is not
// enough on its own: a list or line read issued a moment before sign-out lands
// AFTER the clear, re-fills `meetings` with the account that has left, and
// re-stamps `loadedAt` — which then short-circuits every load the next account
// makes. store/entries.ts solved this with an `epoch` counter and this store now
// carries the same one.
//
// WHY THE DYNAMIC IMPORT. vitest.config.ts is `environment: 'node'` on purpose.
// This store registers a `focus` listener at module scope, its debounce uses
// `window.setTimeout`, and it pulls in lib/i18n, which reads the stored locale
// from localStorage at module init. All three are correct for a store, so the
// test supplies the globals before importing rather than asking the code to
// pretend it has no browser. A static import would evaluate the module before
// beforeAll could run.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiResult } from '../api/result'
import type { LineCounts, LinePlan } from '../api/meetings'
import type { Meeting, MeetingLine } from '../types'

const net = vi.hoisted(() => ({
  /** What listMeetings answers with, and how many times it was asked. */
  meetings: [] as Meeting[],
  listMeetingsCalls: 0,
  /** meetingId → its lines. */
  lines: new Map<string, MeetingLine[]>(),
  listLinesCalls: 0,
  patchLineCalls: 0,
  /** Set to hold a read open, so a sign-out can land in the middle of it. */
  holdMeetings: null as ((rows: Meeting[]) => void) | null,
  holdLines: null as ((rows: MeetingLine[]) => void) | null,
  session: true,
}))

// A faithful-enough double for the two pure helpers the store calls on the load
// path. decodePlan's real body is tested through api/meetings.test.ts; what
// matters here is only that a stored `parsed` re-seeds the draft and a missing
// one falls back to the raw text, which is the behaviour the reset assertions
// read.
vi.mock('../api/meetings', () => {
  const decodePlan = (parsed: unknown, rawFallback: string): LinePlan => {
    const src = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Partial<LinePlan>
    return {
      title: typeof src.title === 'string' && src.title !== '' ? src.title : rawFallback,
      trackId: src.trackId ?? null,
      type: src.type ?? 'action',
      priority: src.priority ?? 'medium',
      ownerId: src.ownerId ?? null,
      ownerName: src.ownerName ?? null,
      dueDate: src.dueDate ?? null,
      followUpDate: src.followUpDate ?? null,
      tags: Array.isArray(src.tags) ? [...src.tags] : [],
    }
  }
  return {
    decodePlan,
    planFromParsed: (): LinePlan => decodePlan(null, ''),
    planToJson: (plan: LinePlan): Record<string, unknown> => ({ ...plan }),
    emptyLineCounts: (): LineCounts => ({
      total: 0,
      pending: 0,
      note: 0,
      discarded: 0,
      committed: 0,
    }),
    listMeetings: (): Promise<ApiResult<Meeting[]>> => {
      net.listMeetingsCalls += 1
      if (net.holdMeetings === null) return Promise.resolve({ ok: true, data: [...net.meetings] })
      return new Promise((resolve) => {
        net.holdMeetings = (rows: Meeting[]): void => resolve({ ok: true, data: rows })
      })
    },
    listLines: (meetingId: string): Promise<ApiResult<MeetingLine[]>> => {
      net.listLinesCalls += 1
      if (net.holdLines === null) {
        return Promise.resolve({ ok: true, data: [...(net.lines.get(meetingId) ?? [])] })
      }
      return new Promise((resolve) => {
        net.holdLines = (rows: MeetingLine[]): void => resolve({ ok: true, data: rows })
      })
    },
    getMeeting: (): Promise<ApiResult<Meeting | null>> => Promise.resolve({ ok: true, data: null }),
    listLineCounts: (): Promise<ApiResult<Map<string, LineCounts>>> =>
      Promise.resolve({ ok: true, data: new Map() }),
    patchLine: (): Promise<ApiResult<MeetingLine>> => {
      net.patchLineCalls += 1
      return Promise.resolve({ ok: false, error: 'common.error' })
    },
    appendLine: (): Promise<ApiResult<MeetingLine>> =>
      Promise.resolve({ ok: false, error: 'common.error' }),
    commitMeetingLines: (): Promise<ApiResult<unknown>> =>
      Promise.resolve({ ok: false, error: 'common.error' }),
    createMeeting: (): Promise<ApiResult<Meeting>> =>
      Promise.resolve({ ok: false, error: 'common.error' }),
    patchMeeting: (): Promise<ApiResult<Meeting>> =>
      Promise.resolve({ ok: false, error: 'common.error' }),
  }
})

vi.mock('../api/realtime', () => ({
  onRealtime: () => (): void => {},
  onRealtimeResync: () => (): void => {},
}))

// The entries store is the meetings store's one store→store dependency (a
// committed line becomes an entry). Mocked so this file does not drag in a
// second module that reads localStorage at init.
vi.mock('./entries', () => ({ applyServerRow: () => undefined }))

vi.mock('./auth', () => ({ hasSession: () => net.session }))

type MeetingsModule = typeof import('./meetings')
let store: MeetingsModule

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
      // Resolved at CALL time, so vi.useFakeTimers() below still governs the
      // triage debounce this store schedules through `window`.
      setTimeout: (fn: () => void, ms?: number): number => setTimeout(fn, ms) as unknown as number,
      clearTimeout: (id: number): void => clearTimeout(id),
    },
  })
  store = await import('./meetings')
})

const T0 = '2026-07-29T09:00:00.000Z'

function meeting(id: string, title: string): Meeting {
  return {
    id,
    title,
    track_id: null,
    attendees: [],
    started_at: T0,
    ended_at: null,
    notes: '',
    created_by: 'user-a',
  }
}

function line(id: string, meetingId: string, raw: string): MeetingLine {
  return {
    id,
    meeting_id: meetingId,
    seq: 1,
    raw,
    parsed: null,
    state: 'pending',
    entry_id: null,
    created_by: 'user-a',
    created_at: T0,
    updated_at: T0,
  }
}

beforeEach(() => {
  vi.useRealTimers()
  store.resetMeetings()
  net.meetings = []
  net.lines = new Map()
  net.listMeetingsCalls = 0
  net.listLinesCalls = 0
  net.patchLineCalls = 0
  net.holdMeetings = null
  net.holdLines = null
  net.session = true
})

describe('resetMeetings — the session boundary', () => {
  it('drops the list latch, so the next account fetches instead of inheriting', async () => {
    net.meetings = [meeting('m-a', "A's 1:1 about the reorg")]
    await store.loadMeetings()
    expect(store.getMeetingsSnapshot().meetings.map((m) => m.id)).toEqual(['m-a'])

    // The latch is real: a second call with no reset costs nothing.
    await store.loadMeetings()
    expect(net.listMeetingsCalls).toBe(1)

    store.resetMeetings()
    net.meetings = [meeting('m-b', "B's standup")]
    await store.loadMeetings()

    expect(net.listMeetingsCalls).toBe(2)
    expect(store.getMeetingsSnapshot().meetings.map((m) => m.id)).toEqual(['m-b'])
  })

  it('drops the per-meeting lines latch and the triage drafts on top of it', async () => {
    net.lines.set('m-a', [line('l1', 'm-a', 'draft only A should see')])
    await store.loadLines('m-a')
    store.setLinePlan('l1', { priority: 'high' })
    expect(store.getMeetingsSnapshot().plans.get('l1')?.priority).toBe('high')

    await store.loadLines('m-a')
    expect(net.listLinesCalls).toBe(1)

    store.resetMeetings()
    expect(store.getMeetingsSnapshot().lines.size).toBe(0)
    expect(store.getMeetingsSnapshot().plans.size).toBe(0)

    // And the re-read is not answered from memory. The re-seeded draft comes
    // from the SERVER row, which proves `unsaved` was cleared too — a line still
    // marked dirty is skipped by the loader's seeding pass and would have kept
    // A's `high`.
    await store.loadLines('m-a')
    expect(net.listLinesCalls).toBe(2)
    expect(store.getMeetingsSnapshot().plans.get('l1')?.priority).toBe('medium')
  })

  it('cancels the pending triage write, so it cannot fire after the session', async () => {
    net.lines.set('m-a', [line('l1', 'm-a', 'salary review for Ahmed')])
    await store.loadLines('m-a')

    vi.useFakeTimers()
    store.setLinePlan('l1', { priority: 'critical' })
    store.resetMeetings()
    await vi.advanceTimersByTimeAsync(5_000)

    expect(net.patchLineCalls).toBe(0)
  })
})

describe('a read still on the wire when the session ends', () => {
  it('is not written back into the list, and does not stamp the latch', async () => {
    net.holdMeetings = (): void => {}
    const inFlight = store.loadMeetings()
    // The read is open; the user signs out here.
    store.resetMeetings()
    net.holdMeetings?.([meeting('m-a', "A's 1:1 about the reorg")])
    await inFlight

    expect(store.getMeetingsSnapshot().meetings).toEqual([])

    // The decisive half: `loadedAt` must still be null, or the next account's
    // first visit short-circuits on a latch stamped by a dead session.
    net.holdMeetings = null
    net.meetings = [meeting('m-b', "B's standup")]
    await store.loadMeetings()
    expect(store.getMeetingsSnapshot().meetings.map((m) => m.id)).toEqual(['m-b'])
  })

  it('is not written back as lines or as triage drafts', async () => {
    net.holdLines = (): void => {}
    const inFlight = store.loadLines('m-a')
    store.resetMeetings()
    net.holdLines?.([line('l1', 'm-a', 'draft only A should see')])
    await inFlight

    expect(store.getMeetingsSnapshot().lines.size).toBe(0)
    expect(store.getMeetingsSnapshot().plans.size).toBe(0)

    net.holdLines = null
    net.lines.set('m-a', [line('l2', 'm-a', "B's own note")])
    await store.loadLines('m-a')
    expect(store.getMeetingsSnapshot().lines.get('m-a')?.map((l) => l.id)).toEqual(['l2'])
  })
})
