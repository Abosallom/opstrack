// Asks made on THIS device, since this page loaded — and nothing else.
//
// THE DURABLE RECORD IS NOT HERE. Migration 0019 stamps `entries.nudged_at` and
// `entries.nudged_by` on the entry row itself, so every screen that holds the
// entries store already holds the answer: cached for a cold start, patched by
// realtime when a colleague asks from their own laptop, and filtered and sorted
// by the same code as every other column. A second store mirroring it would be a
// second thing to keep in step, and the two would disagree the first time one of
// them missed an event.
//
// SO WHAT IS THIS FOR? The gap between the tap and the truth arriving.
// `nudge_entry()` is an RPC, not a PATCH, so nothing settles into the entries
// store on its own: the round trip returns a timestamp, and realtime delivers
// the updated row a moment later — or, on a phone in a lift with realtime down,
// not until the next load. The button whose entire promise is "the ask is
// recorded" cannot spend that gap still saying "Ask for an update", because the
// second tap is a second notification for a colleague. This store is the
// optimistic overlay that closes it, and it holds ONLY what this session did.
//
// IT IS THEREFORE TINY AND IT NEVER LOADS. No fetch, no cache, no focus
// refetch, no error state — there is nothing to read. `sendNudge` writes,
// `useLocalAsk` reads back, and NudgeButton takes whichever of the two stamps is
// LATER, so the overlay stops mattering the instant the real row catches up and
// nothing has to remember to clear it.
//
// NOT THROUGH THE OUTBOX SEAM, and that is the same deliberate exception
// store/push.ts makes. Every other write in the app queues while offline because
// the user's INTENT survives a bad connection. A nudge does not: it is a request
// to interrupt a colleague, and draining it forty minutes later — about an item
// that may have been answered in the meantime, from a screen the asker has long
// closed — is worse than an honest "you are offline, try again".

import { create } from 'zustand'
import { nudgeEntry } from '../api/nudge'
import { refreshEntries } from './entries'
import type { ApiResult } from '../api/result'

/** One ask this session made, before the entry row catches up. */
export interface LocalAsk {
  /** ISO instant — optimistically `new Date()`, then the server's own stamp. */
  askedAt: string
  /** The signed-in profile's id. Always us: this store only records our taps. */
  askedBy: string
}

interface NudgesState {
  byEntry: ReadonlyMap<string, LocalAsk>
}

const EMPTY: ReadonlyMap<string, LocalAsk> = new Map()

const useNudgesStore = create<NudgesState>(() => ({ byEntry: EMPTY }))

/**
 * This session's ask on one entry, or undefined.
 *
 * NARROW ON PURPOSE — one Map lookup per row, so a nudge on entry A re-renders
 * A's button and nothing else. A selector returning the whole map would
 * re-render every mounted row on every change, which on Follow-ups is the whole
 * list.
 */
export function useLocalAsk(entryId: string): LocalAsk | undefined {
  return useNudgesStore((s) => s.byEntry.get(entryId))
}

/**
 * The same read outside React. vitest runs `environment: 'node'`, so a hook is a
 * value no test in this repo can observe — and the optimistic write below is the
 * behaviour most worth pinning.
 */
export function readLocalAsk(entryId: string): LocalAsk | undefined {
  return useNudgesStore.getState().byEntry.get(entryId)
}

/** Replace one entry's overlay. `next === undefined` removes it. */
function put(entryId: string, next: LocalAsk | undefined): void {
  useNudgesStore.setState((s) => {
    const map = new Map(s.byEntry)
    if (next === undefined) map.delete(entryId)
    else map.set(entryId, next)
    return { byEntry: map }
  })
}

/**
 * Ask this entry's owner for an update.
 *
 * OPTIMISTIC BECAUSE THE ROW HAS TO CHANGE UNDER THE THUMB, and rolled back
 * precisely because a nudge is not undoable in the other direction: if the write
 * failed, nobody was interrupted, and a row still claiming "asked just now"
 * would silence a chase that never happened.
 *
 * THE ROLLBACK RESTORES THE PREVIOUS OVERLAY RATHER THAN CLEARING IT. Two asks
 * in one session on the same row is the case a naive rollback gets wrong — it
 * would erase this session's earlier, successful ask and put the button back as
 * though nothing had been sent.
 *
 * `meId` is passed in rather than read from the auth store: the asker is always
 * the signed-in user, the caller already holds the profile (it needs it to
 * decide the owner is somebody else), and reaching into auth here would add a
 * load-order dependency for a value the call site has in hand.
 *
 * Returns the ApiResult so the CALLER owns the sentence — the toast belongs on
 * the screen that knows the entry's title and the owner's name, and this store
 * knows neither.
 */
export async function sendNudge(entryId: string, meId: string): Promise<ApiResult<string>> {
  const before = readLocalAsk(entryId)
  put(entryId, { askedAt: new Date().toISOString(), askedBy: meId })

  const result = await nudgeEntry(entryId)
  if (result.ok) {
    // The server's stamp, not ours. Both clocks are close, but `nudged_at` is
    // what the row will carry once realtime lands, and the pill must not appear
    // to jump backwards when it does.
    put(entryId, { askedAt: result.data, askedBy: meId })
    return result
  }

  put(entryId, before)
  // A refusal because somebody already asked means this device is BEHIND the
  // server, not wrong about it: a colleague — or this person's other laptop —
  // asked while the screen sat open, and 0019's rate limit is per ENTRY, from
  // anybody. Re-reading turns the refusal into the row finally showing the ask
  // that blocked it, which is the answer the tap was really after. Unawaited:
  // the toast fires now and the row corrects itself a moment later.
  if (result.error === 'nudge.errTooSoon') void refreshEntries()
  return result
}

/**
 * Drop the overlay on sign-out.
 *
 * It names colleagues and the items they owe, and the entries store — which
 * holds the durable copy — is cleared on sign-out for exactly that reason. A
 * reset that exists and is never called is the bug store/signOutReset.test.ts
 * was written to catch (R3-SEC-2), so this one is wired into Shell's teardown in
 * the same change.
 */
export function resetNudges(): void {
  useNudgesStore.setState({ byEntry: EMPTY })
}
