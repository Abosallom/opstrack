// The arithmetic behind the screen the app opens on.
//
// What is asserted here is mostly the HONESTY of the numbers rather than the
// addition: the addition is four loops and a sort, and the ways this file can
// be wrong are all ways it can be quietly wrong — a denominator that includes
// organizations nobody scoped, a hidden rung that drops its occupants, a zero
// that means "nobody said" printed as if it meant "said no".

import { describe, expect, it } from 'vitest'
import { programmeSummary, recentMoves } from './summary'
import type { MapNode, MapNodeProgress, MapNodeStage, MapNodeUseCase, UseCase } from '../../types'

const node = (id: string): MapNode =>
  ({ id, name: id, parent_id: null, archived: false }) as unknown as MapNode

const uc = (id: string, sort_order: number, over: Partial<UseCase> = {}): UseCase =>
  ({ id, name: id.toUpperCase(), name_ar: '', sort_order, hidden: false, ...over }) as UseCase

const link = (node_id: string, use_case_id: string, status: MapNodeUseCase['status']): MapNodeUseCase =>
  ({ node_id, use_case_id, status }) as MapNodeUseCase

const stage = (id: string, sort_order: number, over: Partial<MapNodeStage> = {}): MapNodeStage =>
  ({ id, name: id, name_ar: '', sort_order, hidden: false, ...over }) as MapNodeStage

const at = (node_id: string, stage_id: string | null, when: string | null = null): MapNodeProgress =>
  ({ node_id, stage_id, stage_changed_at: when }) as MapNodeProgress

const LADDER = [stage('kickoff', 2), stage('testing', 3), stage('live', 6)]

describe('programmeSummary', () => {
  it('keeps the three statuses apart, which is the whole reason it exists', () => {
    // `useCaseProgress` counts links AT the terminal status against the whole
    // catalogue — one numerator, one denominator. That renders "twenty in
    // testing" and "twenty not started" as the same zero. The home screen's
    // question cannot be answered by that shape.
    const s = programmeSummary({
      nodes: [node('a'), node('b')],
      catalogue: [uc('adt', 1)],
      links: [link('a', 'adt', 'testing'), link('b', 'adt', 'planned')],
      stages: LADDER,
      progress: [],
    })
    expect(s.capabilities[0]).toMatchObject({ planned: 1, testing: 1, live: 0, recorded: 2 })
    expect(s).toMatchObject({ planned: 1, testing: 1, live: 0, links: 2 })
  })

  it('distinguishes "nobody has said" from "said, and none of it is live"', () => {
    // THE HONESTY RULE, as a test. Both rows below would print `live: 0`; only
    // one of them is a measurement. `recorded` is what tells them apart, and a
    // renderer without it is printing a number nobody took.
    const s = programmeSummary({
      nodes: [node('a')],
      catalogue: [uc('adt', 1), uc('labs', 2)],
      links: [link('a', 'adt', 'planned')],
      stages: LADDER,
      progress: [],
    })
    const [adt, labs] = s.capabilities
    expect(adt).toMatchObject({ live: 0, recorded: 1 })
    expect(labs).toMatchObject({ live: 0, recorded: 0 })
  })

  it('counts every capability, including ones nobody recorded', () => {
    // A capability missing from the list is invisible; a capability present with
    // zeroes is a question somebody can go and answer. The catalogue is the
    // agenda, so the agenda is what gets rendered.
    const s = programmeSummary({
      nodes: [node('a')],
      catalogue: [uc('adt', 1), uc('labs', 2), uc('rad', 3)],
      links: [link('a', 'adt', 'live')],
      stages: LADDER,
      progress: [],
    })
    expect(s.capabilities).toHaveLength(3)
    expect(s.capabilities.map((c) => c.useCase.id)).toEqual(['adt', 'labs', 'rad'])
  })

  it('drops links and stages from organizations outside the scope', () => {
    // The population is the caller's, and it is already filtered — archived
    // organizations, a different root. A link from outside it would inflate a
    // denominator against a population the reader cannot see on the screen.
    const s = programmeSummary({
      nodes: [node('a')],
      catalogue: [uc('adt', 1)],
      links: [link('a', 'adt', 'live'), link('ghost', 'adt', 'live')],
      stages: LADDER,
      progress: [at('a', 'kickoff'), at('ghost', 'live')],
    })
    expect(s.links).toBe(1)
    expect(s.organizations).toBe(1)
    expect(s.staged).toBe(1)
    expect(s.stages.find((r) => r.stage.id === 'live')?.count).toBe(0)
  })

  it('keeps a HIDDEN rung, because hiding one never moved anybody off it', () => {
    // ⚠ `map_node_stages.hidden` means "leaves the pickers", not "un-stages the
    //   organizations already standing on it" — the column's own contract.
    //   Dropping the rung here would take its occupants off the ladder without
    //   putting them anywhere, and the rungs would stop summing to `staged`.
    const s = programmeSummary({
      nodes: [node('a'), node('b')],
      catalogue: [],
      links: [],
      stages: [...LADDER, stage('retired', 4, { hidden: true })],
      progress: [at('a', 'retired'), at('b', 'kickoff')],
    })
    expect(s.stages.find((r) => r.stage.id === 'retired')?.count).toBe(1)
    expect(s.stages.reduce((n, r) => n + r.count, 0)).toBe(s.staged)
  })

  it('reports organizations with no stage rather than inventing a rung for them', () => {
    const s = programmeSummary({
      nodes: [node('a'), node('b'), node('c')],
      catalogue: [],
      links: [],
      stages: LADDER,
      progress: [at('a', 'kickoff'), at('b', null)],
    })
    expect(s).toMatchObject({ organizations: 3, staged: 1, unstaged: 2 })
    // `unstaged` is a fact ABOUT the ladder, never a rung ON it.
    expect(s.stages.map((r) => r.stage.id)).toEqual(['kickoff', 'testing', 'live'])
  })

  it('never counts a capability twice when handed an overlapping catalogue', () => {
    // The visible list concatenated with the full one is a real call shape —
    // and it would double every total silently.
    const s = programmeSummary({
      nodes: [node('a')],
      catalogue: [uc('adt', 1), uc('adt', 1)],
      links: [link('a', 'adt', 'live')],
      stages: LADDER,
      progress: [],
    })
    expect(s.capabilities).toHaveLength(1)
    expect(s.live).toBe(1)
  })

  it('ignores a link naming a capability the catalogue does not hold', () => {
    // It has no name to render, so a row for it would be a blank line. Counting
    // it in the totals but not the rows would make the columns stop adding up.
    const s = programmeSummary({
      nodes: [node('a')],
      catalogue: [uc('adt', 1)],
      links: [link('a', 'adt', 'live'), link('a', 'gone', 'live')],
      stages: LADDER,
      progress: [],
    })
    expect(s.links).toBe(1)
    expect(s.capabilities.reduce((n, c) => n + c.recorded, 0)).toBe(s.links)
  })

  it('orders capabilities stably when two share a sort_order', () => {
    // `sort_order` is admin-typed and nothing stops a collision. Without a total
    // tie-break the two swap places between renders, which reads as a flicker.
    const a = programmeSummary({
      nodes: [], catalogue: [uc('zulu', 1), uc('alpha', 1)], links: [], stages: [], progress: [],
    })
    const b = programmeSummary({
      nodes: [], catalogue: [uc('alpha', 1), uc('zulu', 1)], links: [], stages: [], progress: [],
    })
    expect(a.capabilities.map((c) => c.useCase.id)).toEqual(b.capabilities.map((c) => c.useCase.id))
  })

  it('answers an empty workspace without dividing by anything', () => {
    const s = programmeSummary({ nodes: [], catalogue: [], links: [], stages: [], progress: [] })
    expect(s).toMatchObject({ organizations: 0, staged: 0, unstaged: 0, links: 0, live: 0 })
    expect(s.capabilities).toEqual([])
    expect(s.stages).toEqual([])
  })
})

describe('recentMoves', () => {
  const NOW = new Date('2026-08-22T12:00:00.000Z')

  it('returns the most recent first, with whole days elapsed', () => {
    const moves = recentMoves(
      [
        at('a', 'kickoff', '2026-08-20T12:00:00.000Z'),
        at('b', 'testing', '2026-08-22T09:00:00.000Z'),
      ],
      [node('a'), node('b')],
      NOW,
    )
    expect(moves.map((m) => m.nodeId)).toEqual(['b', 'a'])
    expect(moves[0]?.daysAgo).toBe(0)
    expect(moves[1]?.daysAgo).toBe(2)
  })

  it('drops a row with no stage, no timestamp, or an unparseable one', () => {
    // NaN compares false against everything, so an unparseable date would land
    // wherever the sort happened to leave it — worse than absent.
    const moves = recentMoves(
      [
        at('a', null, '2026-08-20T12:00:00.000Z'),
        at('b', 'kickoff', null),
        at('c', 'kickoff', 'not a date'),
        at('d', 'kickoff', '2026-08-21T12:00:00.000Z'),
      ],
      [node('a'), node('b'), node('c'), node('d')],
      NOW,
    )
    expect(moves.map((m) => m.nodeId)).toEqual(['d'])
  })

  it('is stable when an import stamps a hundred rows in the same second', () => {
    const same = '2026-08-22T10:00:00.000Z'
    const rows = ['c', 'a', 'b'].map((id) => at(id, 'kickoff', same))
    const first = recentMoves(rows, rows.map((r) => node(r.node_id)), NOW)
    const again = recentMoves([...rows].reverse(), rows.map((r) => node(r.node_id)), NOW)
    expect(first.map((m) => m.nodeId)).toEqual(again.map((m) => m.nodeId))
  })

  it('never reports a negative age from a clock that disagrees', () => {
    // A stamp from the future is a skewed device clock, not a time machine.
    const moves = recentMoves([at('a', 'kickoff', '2026-09-01T00:00:00.000Z')], [node('a')], NOW)
    expect(moves[0]?.daysAgo).toBe(0)
  })

  it('honours the limit', () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      at(`n${i}`, 'kickoff', `2026-08-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`),
    )
    expect(recentMoves(rows, rows.map((r) => node(r.node_id)), NOW, 5)).toHaveLength(5)
  })
})
