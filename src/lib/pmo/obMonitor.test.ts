// What is stuck right now — and the two things this fold refuses to say.

import { describe, expect, it } from 'vitest'

import { buildObMonitor, type ObMonitorInput } from './obMonitor'
import type { MapNodeUseCase, UseCase, UseCaseRung } from '../../types'
import type { IsoDate } from '../dates'

const TODAY = '2026-08-27' as IsoDate

// NAMED `capability`, NOT `useCase`: `use` plus a capital is oxlint's Hook
// heuristic, so the obvious name is a `react/rules-of-hooks` error at the top
// level. `lib/mapNodes.ts` and its test hit the same wall and say so.
function capability(id: string, order: number): UseCase {
  return {
    id,
    name: id.toUpperCase(),
    name_ar: '',
    sort_order: order,
    hidden: false,
    created_by: null,
    updated_by: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

const CATALOGUE = [capability('adt', 1), capability('lab', 2), capability('rad', 3)]

function org(id: string, over: { name?: string; manager?: string | null } = {}) {
  return {
    id,
    name: over.name ?? id,
    account_manager_id: over.manager === undefined ? 'member-1' : over.manager,
  }
}

function link(
  nodeId: string,
  useCaseId: string,
  over: Partial<MapNodeUseCase> = {},
): MapNodeUseCase {
  return { node_id: nodeId, use_case_id: useCaseId, status: 'planned', rung: 'intake', ...over }
}

const build = (over: Partial<ObMonitorInput> = {}) =>
  buildObMonitor({
    nodes: [org('a')],
    catalogue: CATALOGUE,
    links: [],
    lastActivityByNode: new Map(),
    today: TODAY,
    quietAfterDays: 14,
    ...over,
  })

describe('the strip', () => {
  it('gives every hospital one cell per catalogue row, so the strips line up', () => {
    const out = build({ nodes: [org('a'), org('b')], links: [link('a', 'adt')] })
    for (const row of out.rows) expect(row.cells).toHaveLength(CATALOGUE.length)
    expect(out.rows[0].cells.map((c) => c.useCaseId)).toEqual(['adt', 'lab', 'rad'])
  })

  it('carries the rung and its position', () => {
    const out = build({ links: [link('a', 'adt', { rung: 'stg' })] })
    const cell = out.rows[0].cells[0]
    expect(cell.rung).toBe('stg')
    expect(cell.rank).toBe(2)
  })

  it.each([
    ['intake', 0],
    ['dev', 1],
    ['stg', 2],
    ['coc', 3],
    ['prod', 4],
  ] as [UseCaseRung, number][])('places %s at position %i', (rung, rank) => {
    // The ORDER of OB_RUNGS is the only thing that says which way the ladder
    // runs; nothing else in the app could recover it from the strings.
    expect(build({ links: [link('a', 'adt', { rung })] }).rows[0].cells[0].rank).toBe(rank)
  })

  it('draws no marker for a pair nobody has placed', () => {
    const cell = build({ links: [] }).rows[0].cells[0]
    expect(cell.rung).toBeNull()
    expect(cell.rank).toBeNull()
  })

  it('draws no marker for a pair somebody ruled out, and says which it was', () => {
    // Untouched paper and "does not apply" are different facts. Both draw no
    // marker; only one of them is a decision somebody made.
    const cell = build({
      links: [link('a', 'adt', { rung: 'prod', scope: 'not_applicable' })],
    }).rows[0].cells[0]
    expect(cell.notApplicable).toBe(true)
    expect(cell.rank).toBeNull()
  })
})

describe('COC is its own channel and never a fault', () => {
  it('counts records at COC separately from everything else', () => {
    const out = build({
      links: [link('a', 'adt', { rung: 'coc' }), link('a', 'lab', { rung: 'coc' })],
    })
    expect(out.cocPairs).toBe(2)
    expect(out.atCoc.map((r) => r.nodeId)).toEqual(['a'])
  })

  it('keeps a hospital at COC out of the blocked list', () => {
    // ⚠ THE OWNER'S RULING. The waiting party is CHI, outside the programme —
    //   nobody on the roster can move it by working harder, and painting it the
    //   same as "your engineer has not touched this in 40 days" tells the reader
    //   to chase the wrong person.
    const out = build({ links: [link('a', 'adt', { rung: 'coc' })] })
    expect(out.blocked).toEqual([])
    expect(out.atCoc).toHaveLength(1)
  })
})

describe('the blocked flag', () => {
  it('lists a hospital whose cell carries a raised flag, and who the wait is on', () => {
    const out = build({
      links: [link('a', 'adt', { blocked_since: '2026-08-01', pending_with: 'Vendor' })],
    })
    expect(out.blocked.map((r) => r.nodeId)).toEqual(['a'])
    expect(out.rows[0].cells[0].pendingWith).toBe('Vendor')
  })

  it('does not call a hospital blocked because nobody raised a flag', () => {
    // Zero blocked is a real zero today: the column is new and nobody has used
    // it. That is different from the budget below, which cannot be read at all.
    expect(build({ links: [link('a', 'adt')] }).blocked).toEqual([])
  })
})

describe('the rung budget, which cannot speak yet', () => {
  it('refuses to be measurable while no person has moved a rung', () => {
    // ⚠ THE MEASUREMENT THIS REFUSAL IS BUILT ON, and the reason a later reader
    //   must not "fix" it: all 1,540 links carry `updated_by = null` and share
    //   ONE `status_changed_at` — the instant 0032 ran. Days-on-rung computed
    //   from that gives every hospital the identical number, and that number is
    //   the age of one SQL Editor session presented as a national programme's
    //   state. §11.3.2 says the budget "cannot fire on imported data".
    const out = build({
      links: [link('a', 'adt', { status_changed_at: '2026-01-01T00:00:00Z', updated_by: null })],
    })
    expect(out.budgetMeasurable).toBe(false)
    expect(out.overBudget).toEqual([])
  })

  it('becomes measurable the moment one link records a person', () => {
    const out = build({ links: [link('a', 'adt', { updated_by: 'member-1' })] })
    expect(out.budgetMeasurable).toBe(true)
  })
})

describe('quiet, and the absence that is not quiet', () => {
  it('lists a hospital nothing has been filed against for longer than the threshold', () => {
    const out = build({
      lastActivityByNode: new Map([['a', '2026-01-01T00:00:00Z']]),
    })
    expect(out.quiet.map((r) => r.nodeId)).toEqual(['a'])
    expect(out.rows[0].quietDays).toBeGreaterThan(200)
  })

  it('leaves a hospital touched yesterday alone', () => {
    const out = build({ lastActivityByNode: new Map([['a', '2026-08-26T00:00:00Z']]) })
    expect(out.quiet).toEqual([])
  })

  it('does not call a hospital quiet when nothing has EVER been filed against it', () => {
    // ⚠ NULL IS "NOTHING HAS EVER BEEN FILED" AND IT IS NOT A LONG SILENCE. An
    //   organization nobody has opened is a different problem from one that went
    //   quiet, and floating the unlooked-at to the top of a quietest-first list
    //   would bury the rows that actually stalled.
    const out = build({ lastActivityByNode: new Map() })
    expect(out.rows[0].quietDays).toBeNull()
    expect(out.quiet).toEqual([])
  })

  it('sorts the quietest first', () => {
    const out = build({
      nodes: [org('a'), org('b')],
      lastActivityByNode: new Map([
        ['a', '2026-08-01T00:00:00Z'],
        ['b', '2026-01-01T00:00:00Z'],
      ]),
    })
    expect(out.quiet.map((r) => r.nodeId)).toEqual(['b', 'a'])
  })
})

describe('no owner', () => {
  it('lists a hospital pending assignment', () => {
    const out = build({ nodes: [org('a', { manager: null }), org('b')] })
    expect(out.noOwner.map((r) => r.nodeId)).toEqual(['a'])
  })
})

describe('the shape of the answer', () => {
  it('counts the organizations it considered, so every channel has its denominator', () => {
    expect(build({ nodes: [org('a'), org('b'), org('c')] }).organizations).toBe(3)
  })

  it('says nothing is stuck in a workspace where nothing is', () => {
    const out = build({ lastActivityByNode: new Map([['a', '2026-08-26T00:00:00Z']]) })
    expect(out.blocked).toEqual([])
    expect(out.quiet).toEqual([])
    expect(out.noOwner).toEqual([])
    expect(out.atCoc).toEqual([])
  })
})
