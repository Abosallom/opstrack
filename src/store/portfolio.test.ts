// The lazy store, and the four promises it makes that nothing else can check.
//
// WHAT IS ACTUALLY AT RISK HERE, in the order the cases run:
//
//   1. LAZINESS. This store fetches ~4,000 rows. If it ever fires at import
//      time — a module-scope `void loadPortfolio()`, a hook that loads on
//      subscribe — every screen in the app pays for the map's read, including
//      the sign-in screen and a deep link into one entry. The failure has no
//      symptom on a fast connection and is invisible to every other test.
//   2. THE UNAPPLIED MIGRATION. `v_map_node_open_counts` does not exist in the
//      live database as this ships, so the counts read answers 42P01 on every
//      load until Aziz runs 0027. That must read as "no counts yet" — the
//      em-dash a panel already draws — and never as an error, or the app spends
//      the days between the two sittings shouting about a migration that has not
//      been run.
//   3. THE SESSION BOUNDARY. Another account's organizations and capability
//      links must not survive sign-out in this tab, INCLUDING a read that was
//      already on the wire when it happened.
//   4. TRUNCATION CARRIED, NOT SWALLOWED. A links read clipped at the page cap
//      means some organization's capabilities are missing from every number
//      folded out of them, and a partial map with no banner is the highest-risk
//      failure this feature has.
//
// The api is FAKED rather than driven through a fake Supabase client: what these
// cases are about is how the STORE reacts to each answer api/map.ts can give.
// api/map.test.ts covers the request shapes.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MapNodeUseCase } from '../types'

/** The two row shapes the faked reads answer with — 0024's join and 0027's view. */
interface LinkRow {
  node_id: string
  use_case_id: string
  status: string
}
interface CountRow {
  node_id: string
  open: number
  overdue: number
  breached: number
  unassigned: number
}

const net = vi.hoisted(() => ({
  linkCalls: 0,
  countCalls: 0,
  /** The ids the last links read was asked about. */
  askedFor: [] as readonly string[],
  links: [] as LinkRow[],
  linksTruncated: false,
  linksError: null as string | null,
  counts: [] as CountRow[],
  countsTruncated: false,
  /**
   * PGRST205 is what PostgREST answers for a relation it cannot find, and it is
   * the state of `v_map_node_open_counts` on the live project until 0027 is run.
   * pgError.ts maps it to this key; the store must not render it.
   */
  countsError: null as string | null,
  /** Held open when a case needs a read to still be in flight while something else happens. */
  gate: null as Promise<void> | null,
  session: true,
}))

vi.mock('../api/map', () => ({
  listNodeUseCasesFor: async (nodeIds: readonly string[]) => {
    net.linkCalls += 1
    net.askedFor = nodeIds
    if (net.gate) await net.gate
    if (net.linksError !== null) return { ok: false as const, error: net.linksError }
    return {
      ok: true as const,
      data: { rows: net.links as unknown as MapNodeUseCase[], truncated: net.linksTruncated },
    }
  },
  listMapNodeOpenCounts: async () => {
    net.countCalls += 1
    if (net.gate) await net.gate
    if (net.countsError !== null) return { ok: false as const, error: net.countsError }
    return {
      ok: true as const,
      data: { rows: net.counts, truncated: net.countsTruncated },
    }
  },
}))

vi.mock('./auth', () => ({ hasSession: () => net.session }))

// ⚠ IMPORTED AFTER THE MOCKS ARE DECLARED, and the import itself is case 1's
//   subject: if this module fetched at import time, `net.linkCalls` would be 1
//   before a single `it()` body ran.
import {
  getPortfolioSnapshot,
  loadPortfolio,
  resetPortfolio,
  type NodeCounts,
} from './portfolio'

const IDS = ['org-1', 'org-2']

function link(nodeId: string, useCaseId: string): LinkRow {
  return { node_id: nodeId, use_case_id: useCaseId, status: 'live' }
}

function counts(nodeId: string, over: Partial<NodeCounts> = {}) {
  return { node_id: nodeId, open: 0, overdue: 0, breached: 0, unassigned: 0, ...over }
}

beforeEach(() => {
  resetPortfolio()
  net.linkCalls = 0
  net.countCalls = 0
  net.askedFor = []
  net.links = []
  net.linksTruncated = false
  net.linksError = null
  net.counts = []
  net.countsTruncated = false
  net.countsError = null
  net.gate = null
  net.session = true
})

describe('never on boot', () => {
  it('has fetched nothing merely by being imported', () => {
    // The whole reason this store exists instead of a sixth read in
    // store/config: importing it must cost nothing. A screen that never calls
    // loadPortfolio never pays for 4,000 rows.
    expect(net.linkCalls).toBe(0)
    expect(net.countCalls).toBe(0)
    expect(getPortfolioSnapshot().links).toBeNull()
  })

  it('starts at null, not at empty — nobody has looked is not "nothing recorded"', () => {
    // `[]` would draw an empty underscore on every card and announce "0 of 90
    // live". Null draws no mark at all.
    const snap = getPortfolioSnapshot()
    expect(snap.links).toBeNull()
    expect(snap.counts).toBeNull()
  })

  it('refuses a load with no organizations, rather than stamping a clock on nothing', async () => {
    // store/config is empty for the first tick of every cold start. Believing
    // that emptiness would stamp `loadedAt`, short-circuit every later call, and
    // leave the map with no underscore until the tab was reopened.
    await loadPortfolio([])
    expect(net.linkCalls).toBe(0)
    expect(getPortfolioSnapshot().loadedAt).toBeNull()

    await loadPortfolio(IDS)
    expect(net.linkCalls).toBe(1)
  })

  it('does not fetch twice for a second caller, and latches until forced', async () => {
    net.links = [link('org-1', 'adt')]
    await loadPortfolio(IDS)
    await loadPortfolio(IDS)
    expect(net.linkCalls).toBe(1)

    await loadPortfolio(IDS, true)
    expect(net.linkCalls).toBe(2)
  })
})

describe('the counts view, while 0027 is unapplied', () => {
  it('leaves counts null and says NOTHING when the view does not exist', async () => {
    // The days between Aziz's two sittings. 42P01 here is not an error the app
    // may report — the view is genuinely not there yet, and the surfaces render
    // an em-dash for a node they have no row for.
    net.countsError = 'common.errMissingTable'
    net.links = [link('org-1', 'adt')]
    await loadPortfolio(IDS)

    const snap = getPortfolioSnapshot()
    expect(snap.counts).toBeNull()
    expect(snap.error).toBeNull()
    // And the half that DID work still landed: the underscore must not wait for
    // a migration it does not depend on.
    expect(snap.links).toHaveLength(1)
    expect(snap.loadedAt).not.toBeNull()
  })

  it('keeps the counts it already had when a later read fails', async () => {
    // FIX-APP-6: a failed read must not latch. A node's "12 open" vanishing
    // because one refetch failed is worse than a number thirty seconds old.
    net.counts = [counts('org-1', { open: 12, overdue: 3 })]
    await loadPortfolio(IDS)
    expect(getPortfolioSnapshot().counts?.get('org-1')?.open).toBe(12)

    net.countsError = 'common.errMissingTable'
    await loadPortfolio(IDS, true)
    expect(getPortfolioSnapshot().counts?.get('org-1')?.open).toBe(12)
    expect(getPortfolioSnapshot().error).toBeNull()
  })

  it('keys the counts by node id, with every column the view answers', async () => {
    net.counts = [counts('org-2', { open: 4, overdue: 1, breached: 2, unassigned: 3 })]
    await loadPortfolio(IDS)
    expect(getPortfolioSnapshot().counts?.get('org-2')).toEqual({
      open: 4,
      overdue: 1,
      breached: 2,
      unassigned: 3,
    })
    // A node the view returned no row for is ABSENT rather than zeroed: 0027's
    // left join gives every node a row, so a missing one means the read did not
    // reach it, and the client draws an em-dash rather than "0 open".
    expect(getPortfolioSnapshot().counts?.has('org-1')).toBe(false)
  })
})

describe('the links read', () => {
  it('reports a real failure, and keeps the links it already had', async () => {
    // Unlike the view, `map_node_use_cases` exists (0024 is applied), so a
    // failure here is a failure rather than a migration that has not been run.
    net.links = [link('org-1', 'adt')]
    await loadPortfolio(IDS)

    net.linksError = 'common.error'
    await loadPortfolio(IDS, true)
    const snap = getPortfolioSnapshot()
    expect(snap.error).toBe('common.error')
    expect(snap.links).toHaveLength(1)
  })

  it('carries truncation instead of swallowing it', async () => {
    net.links = [link('org-1', 'adt')]
    net.linksTruncated = true
    await loadPortfolio(IDS)
    expect(getPortfolioSnapshot().linksTruncated).toBe(true)
  })

  it('carries truncation on the counts side too', async () => {
    net.counts = [counts('org-1')]
    net.countsTruncated = true
    await loadPortfolio(IDS)
    expect(getPortfolioSnapshot().countsTruncated).toBe(true)
  })

  it('ignores an empty read made without a session', async () => {
    // Signed out, RLS makes every read come back empty. Believing it stamps the
    // clock and short-circuits every load for the rest of the session — the bug
    // store/config's settle() names in the same words.
    net.session = false
    await loadPortfolio(IDS)
    const snap = getPortfolioSnapshot()
    expect(snap.links).toBeNull()
    expect(snap.loadedAt).toBeNull()

    // Signed in, the same empty answer is a real one: a workspace where nobody
    // has recorded a capability yet.
    net.session = true
    await loadPortfolio(IDS)
    expect(getPortfolioSnapshot().links).toEqual([])
    expect(getPortfolioSnapshot().loadedAt).not.toBeNull()
  })

  it('asks about exactly the organizations it was handed', async () => {
    await loadPortfolio(['org-9'])
    expect(net.askedFor).toEqual(['org-9'])
  })
})

describe('resetPortfolio — the session boundary', () => {
  it('empties the store and drops the latch, so the next account reads afresh', async () => {
    net.links = [link('org-1', 'adt')]
    net.counts = [counts('org-1', { open: 2 })]
    net.linksTruncated = true
    await loadPortfolio(IDS)

    resetPortfolio()
    const snap = getPortfolioSnapshot()
    expect(snap.links).toBeNull()
    expect(snap.counts).toBeNull()
    expect(snap.linksTruncated).toBe(false)
    expect(snap.countsTruncated).toBe(false)
    expect(snap.loadedAt).toBeNull()
    expect(snap.error).toBeNull()

    await loadPortfolio(IDS)
    expect(net.linkCalls).toBe(2)
  })

  it('refuses the answer to a read that was already on the wire', async () => {
    // THE RACE, and the reason `epoch` exists: sign out with 4,000 rows in
    // flight and the answer lands a moment later, re-fills the store with the
    // account that has LEFT and re-stamps the clock, which then short-circuits
    // the next account's first load in this tab.
    let release = (): void => {}
    net.gate = new Promise<void>((resolve) => {
      release = resolve
    })
    net.links = [link('org-1', 'adt')]

    const pending = loadPortfolio(IDS)
    resetPortfolio()
    release()
    await pending

    const snap = getPortfolioSnapshot()
    expect(snap.links).toBeNull()
    expect(snap.loadedAt).toBeNull()
  })

  it('does not let a stale read retire the next account’s in-flight dedupe', async () => {
    // The `.finally` is gated for the same reason the write-back is: clearing
    // `inFlight` from the previous session's read would retire a live request's
    // dedupe entry and let a second 4,000-row read go out.
    let release = (): void => {}
    net.gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const stale = loadPortfolio(IDS)
    resetPortfolio()

    net.gate = null
    await loadPortfolio(IDS)
    const after = net.linkCalls
    release()
    await stale
    // The new session's read stands: it landed, and nothing the old one did on
    // its way out re-opened the door.
    expect(getPortfolioSnapshot().loadedAt).not.toBeNull()
    expect(net.linkCalls).toBe(after)
  })
})
