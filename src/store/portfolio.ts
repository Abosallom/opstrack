// The two reads the map has to pay for deliberately, and the store that refuses
// to make anyone pay for them by accident.
//
// ── WHY THIS IS NOT store/config.ts ────────────────────────────────────────
//
// That file's header draws the line in its own words — per-node use-case links
// are "DATA, not configuration" — and api/map.ts repeats it at the read itself:
// 400 organizations × ~10 capabilities is ~4,000 rows and ~250KB, which is not a
// price the sign-in screen, the board or a deep link into one entry may be made
// to pay. `v_map_node_open_counts` is one row per node and cheap, but it is the
// same KIND of fact — a number a surface opens for — and splitting the two
// across two stores would mean two loading flags, two focus gates and two
// answers to "has the portfolio landed".
//
// So: ONE STORE, LOADED BY THE SURFACES THAT NEED IT, never on boot. Nothing in
// this module runs at import time. `loadPortfolio()` is called from an effect —
// today from the map's first canvas paint, which the design priced and accepted
// (the underscore is on every card, so the links are wanted as soon as anything
// is drawn), tomorrow from the portfolio lens.
//
// ── NULL IS "NOBODY HAS LOOKED", AND IT IS NOT AN EMPTY LIST ───────────────
//
// `links` and `counts` are both nullable and both start null. `[]` would mean
// "no organization has integrated anything", which draws an empty underscore on
// every card and announces "0 of 90 live"; an empty `counts` Map would mean
// "every node has zero open items". Null means nobody has read them yet and
// every consumer renders the mark absent — pages/Mindtree.tsx's `MapProgressSource`
// is typed nullable for exactly this and says so at length.
//
// ── FAILING CLOSED, AND QUIETLY, WHILE 0027 IS UNAPPLIED ───────────────────
//
// ⚠ `v_map_node_open_counts` DOES NOT EXIST IN THE LIVE DATABASE AS THIS SHIPS.
//   0027 is applied by hand, so that read answers 42P01 (PostgREST: PGRST205) on
//   every attempt until it is, and it must read as "no counts yet" — the em-dash
//   the panel already draws for a node it has no row for — rather than as an
//   error banner on a screen where nothing is wrong. `counts` stays null, no
//   toast, no `error`, and the app is correct on both sides of that sitting
//   without a flag, a version check or a second code path.
//
//   The LINKS read is a different case and is treated differently: 0024 is
//   applied, so a failure there is a real failure and lands in `error` for a
//   surface to render. Collapsing the two would either shout about a migration
//   that has not been run yet or swallow a genuine outage.
//
// A failed read of either NEVER writes over what is already in hand (FIX-APP-6's
// lesson: a failed read must not latch) and never stamps `loadedAt`, so the
// focus gate retries it.

import { create } from 'zustand'
import { listMapNodeOpenCounts, listNodeUseCasesFor } from '../api/map'
import { hasSession } from './auth'
import type { MapNodeUseCase } from '../types'

/** How long a load stays fresh enough to skip the focus refetch. store/config's number. */
const STALE_AFTER_MS = 30_000

/**
 * The four numbers `v_map_node_open_counts` answers for ONE node, DIRECT — not
 * rolled up. 0027's header states the boundary rule this shape exists to keep:
 *
 *   A NUMBER A HUMAN READS AS A FACT COMES FROM THE SERVER AGGREGATE.
 *   A SIZE A HUMAN READS AS A SHAPE COMES FROM THE WORKING SET.
 *
 * The server does the expensive join over thousands of entries; the client rolls
 * these up over ~400 nodes in a pass it already runs. The canvas's size-encoding
 * keeps reading the (truncated, flagged) working set, because a 10% error is
 * invisible at grain size and the truncation banner is on screen.
 */
export interface NodeCounts {
  open: number
  overdue: number
  breached: number
  unassigned: number
}

interface PortfolioState {
  /** Every capability link for the nodes last asked for, or null while nobody has looked. */
  links: MapNodeUseCase[] | null
  /** Node id → its direct open counts, or null while nobody has looked. */
  counts: Map<string, NodeCounts> | null
  /**
   * The links read hit the page cap — SOME ORGANIZATION'S CAPABILITIES ARE
   * MISSING from every number folded out of them. Carried, not swallowed: a
   * partial map with no error is the highest-risk failure this feature has.
   */
  linksTruncated: boolean
  /** The counts read hit the page cap. Same contract, one row per node. */
  countsTruncated: boolean
  loading: boolean
  /** When the last ACCEPTED load landed. Null means the focus gate must not fire. */
  loadedAt: number | null
  /**
   * The links read's failure, as an i18n key — never a sentence, never a raw
   * Postgres string. Null for a counts failure; see the header.
   */
  error: string | null
}

const usePortfolioStore = create<PortfolioState>(() => ({
  links: null,
  counts: null,
  linksTruncated: false,
  countsTruncated: false,
  loading: false,
  loadedAt: null,
  error: null,
}))

// ── selectors ──────────────────────────────────────────────────────────────
//
// Every one of these returns a STORED reference. Nothing here builds a Map or an
// array per call — under useSyncExternalStore that means "the snapshot changed",
// forever, and store/config.ts's header opens with the loop it causes.

/** The capability links, or null while nobody has looked. */
export function usePortfolioLinks(): MapNodeUseCase[] | null {
  return usePortfolioStore((s) => s.links)
}

/** Node id → its direct open counts, or null while nobody has looked. */
export function useNodeCounts(): Map<string, NodeCounts> | null {
  return usePortfolioStore((s) => s.counts)
}

/** A read is in flight and there is nothing on screen yet. */
export function usePortfolioLoading(): boolean {
  return usePortfolioStore((s) => s.loading)
}

/** Either read was clipped by the page cap — the banner's condition. */
export function usePortfolioTruncated(): boolean {
  return usePortfolioStore((s) => s.linksTruncated || s.countsTruncated)
}

/** The links read's failure key, or null. */
export function usePortfolioError(): string | null {
  return usePortfolioStore((s) => s.error)
}

/**
 * Non-React read — store/meetings.ts's `getMeetingsSnapshot()`, for its stated
 * reason: a test asserting on what the app was told to render cannot call a hook,
 * and a test reaching into a private zustand store would be asserting on an
 * implementation rather than on a contract.
 */
export function getPortfolioSnapshot(): PortfolioState {
  return usePortfolioStore.getState()
}

/**
 * Replace ONE link after a successful write, without a refetch.
 *
 * The COC queue writes one (hospital × use case) at a time and needs the row it
 * just saved to be the row on screen. `loadPortfolio(ids, true)` would do it by
 * re-reading roughly four thousand links to change four fields, and every other
 * mark the reader is looking at would go through a load while it happened.
 *
 * ⚠ THE ROW PASSED IN MUST BE THE ROW THE DATABASE RETURNED, never the form's
 *   own idea of it. `overrides` is computed by 0035's trigger and `updated_at`
 *   by the touch trigger, so a client-assembled row would put values in this
 *   store that no table holds, and the next real read would silently disagree
 *   with what the user was shown. Every caller passes the `.select()` result.
 *
 * A pair this store has never seen is IGNORED rather than appended: the links
 * in hand are the ones for the nodes that were asked for, and appending a row
 * from outside that set would put an organization into counts folded out of it.
 */
export function applyPortfolioLink(link: MapNodeUseCase): void {
  const held = usePortfolioStore.getState().links
  if (held === null) return
  const at = held.findIndex((l) => l.node_id === link.node_id && l.use_case_id === link.use_case_id)
  if (at < 0) return
  const next = held.slice()
  next[at] = link
  usePortfolioStore.setState({ links: next })
}

// ── loading ────────────────────────────────────────────────────────────────

let inFlight: Promise<void> | null = null

/**
 * Which session's reads may still write into this store.
 *
 * Bumped by `resetPortfolio()`. The loader captures `const mine = epoch` BEFORE
 * it awaits and writes nothing when `mine !== epoch` on the way back — exactly
 * as store/meetings.ts and store/entries.ts do, and for the reason those spell
 * out: without it, signing out while 4,000 rows are on the wire lets the answer
 * land a moment later, re-fill `links` with the account that has LEFT and
 * re-stamp `loadedAt`, which then short-circuits the next account's first load.
 */
let epoch = 0

/**
 * The node ids the last load asked about, so the focus refetch can ask the same
 * question again without the caller being mounted to say it.
 *
 * Held here rather than in the store because nothing renders it: a state field
 * would publish a new array to every subscriber on every load for no screen's
 * benefit.
 */
let lastNodeIds: readonly string[] = []

/**
 * Read the portfolio: every capability link for `nodeIds`, and the per-node open
 * counts.
 *
 * LAZY BY CONSTRUCTION. This function is the only thing in the module that
 * fetches, it is exported, and it is called by nobody at import time — which is
 * what makes "never on boot" a property of the code rather than a promise in a
 * comment. store/portfolio.test.ts asserts it by importing the module and
 * counting zero requests.
 *
 * Never rejects and never throws: safe to call unawaited from an effect, safe to
 * call from two surfaces mounting at once (the second awaits the first's
 * promise rather than firing a second 4,000-row read).
 *
 * An EMPTY `nodeIds` is not a load and does not stamp `loadedAt`. The list
 * arrives from store/config, which is empty for the first tick of every cold
 * start — believing that emptiness would stamp the clock, short-circuit every
 * later call and leave the map with no underscore until the tab was reopened.
 */
export function loadPortfolio(nodeIds: readonly string[], force = false): Promise<void> {
  if (inFlight) return inFlight
  if (nodeIds.length === 0) return Promise.resolve()
  if (!force && usePortfolioStore.getState().loadedAt !== null) return Promise.resolve()

  // Only spin when there is genuinely nothing to show; a refetch must not blank
  // the marks the reader is looking at.
  if (usePortfolioStore.getState().links === null) {
    usePortfolioStore.setState({ loading: true })
  }

  lastNodeIds = nodeIds
  const mine = epoch
  inFlight = Promise.all([listNodeUseCasesFor(nodeIds), listMapNodeOpenCounts()])
    .then(([linkResult, countResult]) => {
      // Signed out while these were in flight — see `epoch`. The rows in hand
      // belong to the account that has left.
      if (mine !== epoch) return

      const next: Partial<PortfolioState> = { loading: false }

      // The three-branch decision store/config's settle() names, in its own
      // order and for its own reasons.
      let accepted = false
      if (!linkResult.ok) {
        // The previous links stay. A failed read must not latch, and an
        // organization's underscore vanishing because one refetch failed is a
        // worse sentence than a mark that is thirty seconds old.
        next.error = linkResult.error
      } else if (linkResult.data.rows.length === 0 && !hasSession()) {
        // An empty list from an UNAUTHENTICATED read is not an answer: signed
        // out, RLS makes every read come back empty, and believing it stamps the
        // clock and short-circuits every load for the rest of the session.
        console.warn('[portfolio] ignoring an empty links read made without a session')
      } else {
        next.links = linkResult.data.rows
        next.linksTruncated = linkResult.data.truncated
        next.error = null
        accepted = true
      }

      if (countResult.ok) {
        const counts = new Map<string, NodeCounts>()
        for (const row of countResult.data.rows) {
          counts.set(row.node_id, {
            open: row.open,
            overdue: row.overdue,
            breached: row.breached,
            unassigned: row.unassigned,
          })
        }
        next.counts = counts
        next.countsTruncated = countResult.data.truncated
      }
      // ELSE NOTHING, AND NO `error`. Until 0027 is applied this is a 42P01 on
      // every load; see the header. `counts` stays exactly as it was — null on a
      // cold start, which every consumer renders as an em-dash.

      usePortfolioStore.setState(next)

      // STAMPED ON THE LINKS READ ALONE, and store/config's asymmetry is the
      // precedent: letting a read that 404s until a migration is applied by hand
      // hold `loadedAt` at null would refire the whole 4,000-row load on every
      // mount and every focus, forever. That is a retry storm introduced by an
      // additive feature, and it is not hypothetical — the live workspace is
      // applied through 0025 and no further, so 0026, 0027 and 0028 are all
      // still Aziz's next sitting and this counts read 404s on every load
      // today (docs/PENDING-MIGRATIONS.md). `accepted` rather than
      // `linkResult.ok` for the same reason settle() hands the flag back: the
      // rows and the clock cannot drift apart the way two `if` chains do.
      if (accepted) usePortfolioStore.setState({ loadedAt: Date.now() })
    })
    .finally(() => {
      // Gated for `epoch`'s reason: a stale finally would retire the NEXT
      // account's live dedupe entry.
      if (mine === epoch) inFlight = null
    })

  return inFlight
}

/**
 * Sign-out. Another account's organizations, their capability links and their
 * open counts must not survive into the next session in this tab.
 *
 * CALLED FROM Shell's cleanup in src/App.tsx, beside resetEntries() and the
 * others — src/store/signOutReset.test.ts asserts that every `reset*` in this
 * directory is wired there, because a reset with no caller is invisible to every
 * test that calls it directly (store/meetings.ts shipped one for two rounds).
 */
export function resetPortfolio(): void {
  // FIRST, before anything else is cleared: every read already on the wire is
  // now the previous account's, and this is what stops its answer being written
  // back into the store this function is about to empty.
  epoch += 1
  inFlight = null
  lastNodeIds = []
  usePortfolioStore.setState({
    links: null,
    counts: null,
    linksTruncated: false,
    countsTruncated: false,
    loading: false,
    loadedAt: null,
    error: null,
  })
}

// Returning to the tab is the natural moment to re-check: a second account
// manager records a stage or ticks a capability while this tab sits behind
// another window. Gated on STALE_AFTER_MS for store/config's reason — alt-tabbing
// between two windows fires focus constantly, and this is the app's most
// expensive read.
//
// ⚠ `loadedAt !== null` IS THE LAZINESS, AND IT IS THE WHOLE GATE. store/config
//   fires on `loadedAt === null || stale` because its data is wanted on every
//   screen; this store must never fetch for a reader who has not opened a
//   surface that wants it, so a null clock means "nobody has looked" and focus
//   does nothing at all.
if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => {
    if (!hasSession()) return
    const { loadedAt } = usePortfolioStore.getState()
    if (loadedAt === null) return
    if (Date.now() - loadedAt > STALE_AFTER_MS) void loadPortfolio(lastNodeIds, true)
  })
}
