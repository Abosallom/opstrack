import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalAsk } from './nudges'

// WHAT THIS FILE PINS. Three behaviours that are decisions, not mechanics:
//
//   · THE OVERLAY LANDS BEFORE THE ROUND TRIP. The button's whole promise is
//     "the ask is recorded"; spending a round trip still offering to ask is how
//     a colleague gets two notifications from one gesture.
//   · A FAILED SECOND ASK RESTORES THE FIRST. Rolling back to "nothing" would
//     erase this session's earlier, successful ask and put the button back as
//     though nothing had been sent — the exact double-chase the feature exists
//     to prevent, produced by the code meant to prevent it.
//   · A RATE-LIMIT REFUSAL RE-READS THE ENTRIES. 0019's limit is per ENTRY from
//     ANYBODY, so being refused means a colleague asked while this screen sat
//     open. The useful outcome is the row showing THEIR ask, not a shrug.

const nudgeEntry = vi.fn()
const refreshEntries = vi.fn()

async function loadStore(): Promise<typeof import('./nudges')> {
  vi.resetModules()
  vi.doMock('../api/nudge', () => ({ nudgeEntry, NUDGE_WINDOW_MS: 86_400_000 }))
  // The entries store touches window/localStorage at module init, which is fatal
  // under `environment: 'node'`. Only the one function this store calls is
  // needed.
  vi.doMock('./entries', () => ({ refreshEntries }))
  return await import('./nudges')
}

beforeEach(() => {
  nudgeEntry.mockReset()
  refreshEntries.mockReset()
  refreshEntries.mockResolvedValue(undefined)
})

describe('sendNudge', () => {
  it('records the ask before the round trip, then settles on the server stamp', async () => {
    const store = await loadStore()
    let inFlight: LocalAsk | undefined
    nudgeEntry.mockImplementation(() => {
      // Read INSIDE the call: this is the frame between the tap and the answer —
      // the frame the button has to have already stopped offering in, because on
      // a phone a double-tap is one gesture.
      inFlight = store.readLocalAsk('e1')
      return Promise.resolve({ ok: true, data: '2026-08-01T09:00:00.000Z' })
    })

    const result = await store.sendNudge('e1', 'me')

    expect(inFlight?.askedBy).toBe('me')
    expect(inFlight?.askedAt).not.toBe('')
    expect(result).toEqual({ ok: true, data: '2026-08-01T09:00:00.000Z' })
    // THE SERVER'S STAMP REPLACES OURS. Both clocks are close, but nudged_at is
    // what the row carries once realtime lands, and the pill must not appear to
    // jump backwards when it does.
    expect(store.readLocalAsk('e1')).toEqual({
      askedAt: '2026-08-01T09:00:00.000Z',
      askedBy: 'me',
    })
  })

  it('restores the PREVIOUS ask when a second one is refused', async () => {
    const store = await loadStore()
    nudgeEntry.mockResolvedValueOnce({ ok: true, data: '2026-07-31T09:00:00.000Z' })
    await store.sendNudge('e1', 'me')

    // Deliberately NOT the rate-limit refusal: that one also re-reads, which
    // would muddy whether the rollback itself was correct. This is the pure one.
    nudgeEntry.mockResolvedValueOnce({ ok: false, error: 'nudge.errGone' })
    const result = await store.sendNudge('e1', 'me')

    expect(result).toEqual({ ok: false, error: 'nudge.errGone' })
    expect(store.readLocalAsk('e1')).toEqual({
      askedAt: '2026-07-31T09:00:00.000Z',
      askedBy: 'me',
    })
    expect(refreshEntries).not.toHaveBeenCalled()
  })

  it('leaves no trace when a FIRST ask is refused', async () => {
    const store = await loadStore()
    nudgeEntry.mockResolvedValueOnce({ ok: false, error: 'nudge.errYours' })

    const result = await store.sendNudge('e1', 'me')

    expect(result).toEqual({ ok: false, error: 'nudge.errYours' })
    // Nobody was interrupted, so the row must offer the button again. An
    // orphaned "asked just now" would silence a chase that never happened.
    expect(store.readLocalAsk('e1')).toBeUndefined()
  })

  it('re-reads the entries after a rate-limit refusal', async () => {
    const store = await loadStore()
    nudgeEntry.mockResolvedValueOnce({ ok: false, error: 'nudge.errTooSoon' })

    await store.sendNudge('e1', 'me')

    // The refusal means this device is BEHIND the server, not wrong about it.
    // `entries.nudged_at` carries the ask that blocked this one, so one refetch
    // turns "couldn't ask" into "Sara asked 3 hours ago" on the row itself.
    expect(refreshEntries).toHaveBeenCalledTimes(1)
    expect(store.readLocalAsk('e1')).toBeUndefined()
  })
})

describe('resetNudges', () => {
  it('drops the overlay on sign-out', async () => {
    const store = await loadStore()
    nudgeEntry.mockResolvedValueOnce({ ok: true, data: '2026-08-01T09:00:00.000Z' })
    await store.sendNudge('e1', 'me')
    expect(store.readLocalAsk('e1')).toBeDefined()

    store.resetNudges()

    // It names colleagues and the items they owe, and the entries store that
    // holds the durable copy is cleared on sign-out for exactly that reason.
    // store/signOutReset.test.ts asserts this one is actually WIRED, which is
    // the half a store's own test can never see (R3-SEC-2).
    expect(store.readLocalAsk('e1')).toBeUndefined()
  })
})
