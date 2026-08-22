// The commitments — "40 organizations beneath this Phase are Live by 31
// December" (0027) — read WHOLE, for the surfaces that ask about promises
// across the workspace rather than about one node's panel.
//
// ── WHY THIS IS NOT store/config.ts, AND NOT store/portfolio.ts ────────────
//
// Not config, on that file's own line: config is the SHAPE the owner arranged
// (tracks, kinds, stages, the catalogue), and a goal is a PROMISE two Associate
// Directors made about it. Config is warmed on boot for every screen; nobody
// signing in to read one entry should pay for the promises.
//
// Not portfolio, though the laziness is copied from it verbatim, because the two
// stores fail differently and the difference is the whole point of the section
// this one feeds — see the error paragraph below.
//
// So: ONE STORE, LOADED BY THE SURFACES THAT NEED IT, never on boot. Nothing in
// this module runs at import time; `loadGoals()` is called from an effect.
//
// ── NULL IS "NOBODY HAS LOOKED", AND IT IS NOT AN EMPTY LIST ───────────────
//
// `goals` starts null and is NEVER coerced to `[]`. store/portfolio.ts's rule
// and its reason: `[]` means "this workspace has promised nothing", which is a
// sentence the PMO page prints, and printing it while the read is still on the
// wire would be a lie with a spinner's timing.
//
// ── THE ERROR IS CARRIED, NOT SWALLOWED ────────────────────────────────────
//
// ⚠ `map_node_goals` DOES NOT EXIST IN THE LIVE DATABASE AS THIS SHIPS. 0027 is
//   applied by hand, so `listGoals()` answers 42P01 (PostgREST: PGRST205) on
//   every attempt until it is, and `pgErrorKey` maps that to
//   `common.errMissingTable`.
//
//   store/portfolio.ts's counts half stays SILENT about the same 42P01, and this
//   store deliberately does not. There, a missing view degrades to an em-dash a
//   panel already draws for a node it has no row for, so there is nothing to
//   say. Here, "this workspace has made no commitments" and "the commitments
//   table has not been created yet" are two different screens, and the section
//   that reads this store renders them as two different states. Swallowing the
//   key would collapse them into the first — the page would tell a director
//   nobody has promised anything, in a workspace full of promises.
//
//   It is carried as an i18n KEY, never a sentence and never a raw Postgres
//   string (api/goals.ts's token contract), and the caller's job is to word it
//   calmly: a missing migration is not a fault of the reader's.
//
// A failed read NEVER writes over the rows already in hand (FIX-APP-6's lesson:
// a failed read must not latch) and never stamps `loadedAt`, so the focus gate
// retries it.

import { create } from 'zustand'
import { listGoals } from '../api/goals'
import { hasSession } from './auth'
import type { MapNodeGoal } from '../types'

/** How long a load stays fresh enough to skip the focus refetch. store/config's number. */
const STALE_AFTER_MS = 30_000

interface GoalsState {
  /** Every commitment in the workspace, or null while nobody has looked. */
  goals: MapNodeGoal[] | null
  /**
   * The read hit the page cap — SOME COMMITMENTS ARE MISSING from every number
   * folded out of these rows. Carried, not swallowed, on
   * `PortfolioState.linksTruncated`'s argument.
   */
  truncated: boolean
  loading: boolean
  /** When the last ACCEPTED load landed. Null means the focus gate must not fire. */
  loadedAt: number | null
  /** The read's failure as an i18n key — `common.errMissingTable` until 0027. */
  error: string | null
}

const useGoalsStore = create<GoalsState>(() => ({
  goals: null,
  truncated: false,
  loading: false,
  loadedAt: null,
  error: null,
}))

// ── selectors ──────────────────────────────────────────────────────────────
//
// Every one returns a STORED reference: under useSyncExternalStore a Map or an
// array built per call means "the snapshot changed", forever.

/** Every commitment, or null while nobody has looked. NEVER `[]` for "not yet". */
export function useGoals(): MapNodeGoal[] | null {
  return useGoalsStore((s) => s.goals)
}

/** The read's failure key, or null. See the header for why this one is loud. */
export function useGoalsError(): string | null {
  return useGoalsStore((s) => s.error)
}

/** The read was clipped by the page cap. */
export function useGoalsTruncated(): boolean {
  return useGoalsStore((s) => s.truncated)
}

/**
 * Non-React read — store/portfolio.ts's `getPortfolioSnapshot()`, for its stated
 * reason: a test asserting on what the app was told to render cannot call a
 * hook, and reaching into a private zustand store would assert on an
 * implementation rather than on a contract.
 */
export function getGoalsSnapshot(): GoalsState {
  return useGoalsStore.getState()
}

// ── loading ────────────────────────────────────────────────────────────────

let inFlight: Promise<void> | null = null

/**
 * Which session's reads may still write into this store.
 *
 * Bumped by `resetGoals()`. The loader captures `const mine = epoch` BEFORE it
 * awaits and writes nothing when `mine !== epoch` on the way back — store/
 * portfolio.ts's `epoch` and its reason: without it, signing out while a read is
 * on the wire lets the answer land a moment later, re-fill `goals` with the
 * account that has LEFT and re-stamp `loadedAt`, which then short-circuits the
 * next account's first load.
 */
let epoch = 0

/**
 * Read every commitment in the workspace.
 *
 * `listGoals()` WITH NO ARGUMENT, which api/goals.ts's header names as the
 * portfolio's read and which `map_node_goals_date_idx` (0027) exists for. The
 * node-scoped call is the panel's; a page asking "what has this workspace
 * promised" would otherwise send four hundred uuids up the query string to ask
 * for the same rows.
 *
 * LAZY BY CONSTRUCTION. This function is the only thing in the module that
 * fetches, it is exported, and nobody calls it at import time — which is what
 * makes "never on boot" a property of the code rather than a promise in a
 * comment. store/goals.test.ts asserts it by importing the module and counting
 * zero requests.
 *
 * Never rejects and never throws: safe to call unawaited from an effect, safe to
 * call from two surfaces mounting at once.
 */
export function loadGoals(force = false): Promise<void> {
  if (inFlight) return inFlight
  if (!force && useGoalsStore.getState().loadedAt !== null) return Promise.resolve()

  // Only spin when there is genuinely nothing to show; a refetch must not blank
  // the rows the reader is looking at.
  if (useGoalsStore.getState().goals === null) {
    useGoalsStore.setState({ loading: true })
  }

  const mine = epoch
  inFlight = listGoals()
    .then((result) => {
      // Signed out while this was in flight — see `epoch`. The rows in hand
      // belong to the account that has left.
      if (mine !== epoch) return

      if (!result.ok) {
        // The previous goals stay. A failed read must not latch, and a
        // commitment vanishing because one refetch failed is a worse sentence
        // than a row that is thirty seconds old.
        useGoalsStore.setState({ loading: false, error: result.error })
        return
      }
      if (result.data.rows.length === 0 && !hasSession()) {
        // An empty list from an UNAUTHENTICATED read is not an answer: signed
        // out, RLS makes every read come back empty, and believing it stamps the
        // clock and short-circuits every load for the rest of the session.
        console.warn('[goals] ignoring an empty read made without a session')
        useGoalsStore.setState({ loading: false })
        return
      }
      useGoalsStore.setState({
        goals: result.data.rows,
        truncated: result.data.truncated,
        loading: false,
        loadedAt: Date.now(),
        error: null,
      })
    })
    .finally(() => {
      // Gated for `epoch`'s reason: a stale finally would retire the NEXT
      // account's live dedupe entry.
      if (mine === epoch) inFlight = null
    })

  return inFlight
}

/**
 * Sign-out. One workspace's commitments must not survive into the next session
 * in this tab.
 *
 * CALLED FROM Shell's cleanup in src/App.tsx, beside resetPortfolio() and the
 * others — src/store/signOutReset.test.ts asserts that every `reset*` in this
 * directory is wired there, because a reset with no caller is invisible to every
 * test that calls it directly.
 */
export function resetGoals(): void {
  // FIRST, before anything else is cleared: every read already on the wire is
  // now the previous account's, and this is what stops its answer being written
  // back into the store this function is about to empty.
  epoch += 1
  inFlight = null
  useGoalsStore.setState({
    goals: null,
    truncated: false,
    loading: false,
    loadedAt: null,
    error: null,
  })
}

// Returning to the tab is the natural moment to re-check: an Associate Director
// moves a date while this tab sits behind another window.
//
// ⚠ `loadedAt !== null` IS THE LAZINESS, AND IT IS THE WHOLE GATE — store/
//   portfolio.ts's rule. A null clock means nobody has opened a surface that
//   wants these rows, and focus must then do nothing at all.
if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => {
    if (!hasSession()) return
    const { loadedAt } = useGoalsStore.getState()
    if (loadedAt === null) return
    if (Date.now() - loadedAt > STALE_AFTER_MS) void loadGoals(true)
  })
}
