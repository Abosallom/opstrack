// The lazy commitments store, and the four promises nothing else can check.
//
//   1. LAZINESS. Nothing may fetch at import time. A module-scope
//      `void loadGoals()` would put a read of every commitment in the workspace
//      on the sign-in screen and on a deep link into one entry, with no symptom
//      on a fast connection.
//   2. THE UNAPPLIED MIGRATION, AND THE FACT THAT IT IS LOUD HERE. 0027 is
//      applied by hand, so `map_node_goals` answers 42P01 on every read until it
//      is. store/portfolio's counts half swallows the same error because a
//      missing view degrades to an em-dash; this store CARRIES it, because "no
//      commitments exist" and "the table has not been created" are two different
//      screens and the PMO page renders them differently.
//   3. NULL IS NEVER `[]`. "Nobody has looked" is not "this workspace has
//      promised nothing", and the second is a sentence the page prints.
//   4. THE SESSION BOUNDARY. One account's promises must not survive sign-out in
//      this tab, INCLUDING a read already on the wire when it happened.
//
// The api is FAKED rather than driven through a fake Supabase client: what these
// cases are about is how the STORE reacts to each answer api/goals.ts can give.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MapNodeGoal } from '../types'

const net = vi.hoisted(() => ({
  calls: 0,
  /** What the last call was asked for — `undefined` is the whole-table read. */
  askedFor: 'unset' as unknown,
  rows: [] as MapNodeGoal[],
  truncated: false,
  error: null as string | null,
  /** Held open when a case needs a read still in flight while something else happens. */
  gate: null as Promise<void> | null,
  session: true,
}))

vi.mock('../api/goals', () => ({
  listGoals: async (nodeIds?: readonly string[]) => {
    net.calls += 1
    net.askedFor = nodeIds
    if (net.gate) await net.gate
    if (net.error !== null) return { ok: false as const, error: net.error }
    return { ok: true as const, data: { rows: net.rows, truncated: net.truncated } }
  },
}))

vi.mock('./auth', () => ({ hasSession: () => net.session }))

// ⚠ IMPORTED AFTER THE MOCKS, and the import itself is case 1's subject: a
//   module that fetched at import time would leave `net.calls` at 1 before a
//   single `it()` body ran.
import { getGoalsSnapshot, loadGoals, resetGoals } from './goals'

function goal(over: Partial<MapNodeGoal> & { id: string }): MapNodeGoal {
  return {
    node_id: 'n1',
    label: '',
    label_ar: '',
    stage_id: null,
    target: null,
    target_date: '2026-12-31',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    created_by: null,
    updated_by: null,
    ...over,
  }
}

beforeEach(() => {
  resetGoals()
  net.calls = 0
  net.askedFor = 'unset'
  net.rows = []
  net.truncated = false
  net.error = null
  net.gate = null
  net.session = true
})

describe('never on boot', () => {
  it('has fetched nothing merely by being imported', () => {
    expect(net.calls).toBe(0)
  })

  it('starts at null, not at empty — nobody has looked is not "nothing promised"', () => {
    const s = getGoalsSnapshot()
    expect(s.goals).toBeNull()
    expect(s.loadedAt).toBeNull()
    expect(s.error).toBeNull()
  })

  it('reads the WHOLE table, with no node filter', async () => {
    // The node-scoped call is the panel's. A page asking what the workspace has
    // promised would otherwise put four hundred uuids in the query string to ask
    // for the same rows.
    await loadGoals()
    expect(net.askedFor).toBeUndefined()
  })

  it('does not fetch twice for a second caller, and latches until forced', async () => {
    net.rows = [goal({ id: 'g1' })]
    await loadGoals()
    await loadGoals()
    expect(net.calls).toBe(1)
    await loadGoals(true)
    expect(net.calls).toBe(2)
  })
})

describe('while 0027 is unapplied', () => {
  it('CARRIES the missing-table key rather than swallowing it', async () => {
    // The one place this store parts company with store/portfolio's counts
    // half. A page that read the 42P01 as "no commitments" would tell a
    // director nobody has promised anything.
    net.error = 'common.errMissingTable'
    await loadGoals()
    const s = getGoalsSnapshot()
    expect(s.error).toBe('common.errMissingTable')
    expect(s.goals).toBeNull()
    expect(s.loadedAt).toBeNull()
    expect(s.loading).toBe(false)
  })

  it('keeps the rows it already had when a later read fails', async () => {
    net.rows = [goal({ id: 'g1' })]
    await loadGoals()
    net.error = 'common.error'
    await loadGoals(true)
    const s = getGoalsSnapshot()
    expect(s.goals?.map((g) => g.id)).toEqual(['g1'])
    expect(s.error).toBe('common.error')
  })

  it('clears the error once a read succeeds', async () => {
    net.error = 'common.errMissingTable'
    await loadGoals()
    net.error = null
    net.rows = [goal({ id: 'g1' })]
    await loadGoals(true)
    expect(getGoalsSnapshot().error).toBeNull()
  })
})

describe('the read itself', () => {
  it('carries truncation instead of swallowing it', async () => {
    net.rows = [goal({ id: 'g1' })]
    net.truncated = true
    await loadGoals()
    expect(getGoalsSnapshot().truncated).toBe(true)
  })

  it('ignores an empty read made without a session', async () => {
    // Signed out, RLS makes every read come back empty. Believing it stamps the
    // clock and short-circuits every load for the rest of the session.
    net.session = false
    await loadGoals()
    const s = getGoalsSnapshot()
    expect(s.goals).toBeNull()
    expect(s.loadedAt).toBeNull()
  })

  it('accepts a genuinely empty workspace when there IS a session', async () => {
    await loadGoals()
    const s = getGoalsSnapshot()
    expect(s.goals).toEqual([])
    expect(s.loadedAt).not.toBeNull()
  })
})

describe('resetGoals — the session boundary', () => {
  it('empties the store and drops the latch, so the next account reads afresh', async () => {
    net.rows = [goal({ id: 'g1' })]
    await loadGoals()
    resetGoals()
    const s = getGoalsSnapshot()
    expect(s.goals).toBeNull()
    expect(s.loadedAt).toBeNull()
    await loadGoals()
    expect(net.calls).toBe(2)
  })

  it('refuses the answer to a read that was already on the wire', async () => {
    let open!: () => void
    net.gate = new Promise<void>((resolve) => {
      open = resolve
    })
    net.rows = [goal({ id: 'g1' })]
    const pending = loadGoals()
    resetGoals()
    open()
    await pending
    // The rows belong to the account that has left.
    expect(getGoalsSnapshot().goals).toBeNull()
  })

  it('does not let a stale read retire the next account’s in-flight dedupe', async () => {
    let open!: () => void
    net.gate = new Promise<void>((resolve) => {
      open = resolve
    })
    const stale = loadGoals()
    resetGoals()
    net.gate = null
    net.rows = [goal({ id: 'g2' })]
    const fresh = loadGoals()
    open()
    await Promise.all([stale, fresh])
    expect(getGoalsSnapshot().goals?.map((g) => g.id)).toEqual(['g2'])
  })
})
