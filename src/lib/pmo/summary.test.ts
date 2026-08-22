// The PMO arithmetic, and above all the HONESTY GATE.
//
// The cases that matter here are not the happy ones. They are the four states
// in which "nothing is late" is true for four different reasons, because the
// live workspace is sitting in one of them: eighty-five organizations, fifty
// staged, every `stage_changed_at` stamped by the import that created it, so
// the count of stalled organizations is legitimately zero and a tile reading
// "0 at risk" is a lie about why. `latenessVerdict` is the type that makes that
// lie unrepresentable, and these cases are what stop it being simplified back
// into a nullable number by someone who has not read the header.

import { describe, expect, it } from 'vitest'
import {
  bucketRisks,
  buildDeliveryRows,
  isRiskType,
  latenessVerdict,
  riskSeverity,
  stageReadiness,
  type DeliveryInput,
} from './summary'
import { stageIndex } from '../mapNodes'
import type { Entry, EntryHealth, MapNode, MapNodeProgress, MapNodeStage } from '../../types'

/* ─────────────────────────────── fixtures ─────────────────────────────── */

const NOW = new Date('2026-08-22T09:00:00.000Z')
const TODAY = '2026-08-22'

function stage(over: Partial<MapNodeStage> & { id: string }): MapNodeStage {
  return {
    name: over.id,
    name_ar: '',
    sort_order: 0,
    hidden: false,
    terminal: false,
    paused: false,
    expected_days: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    created_by: null,
    ...over,
  }
}

function node(over: Partial<MapNode> & { id: string }): MapNode {
  return {
    parent_id: null,
    track_id: 't1',
    kind_id: null,
    name: over.id,
    name_ar: '',
    description: '',
    description_ar: '',
    account_manager_id: null,
    vendor: '',
    sort_order: 0,
    archived: false,
    archived_at: null,
    source: 'local',
    external_ref: null,
    external_url: null,
    synced_at: null,
    overrides: [],
    created_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function entry(over: Partial<Entry> & { id: string }): Entry {
  return {
    track_id: 't1',
    node_id: null,
    title: over.id,
    description: '',
    type: 'issue',
    status: 'new',
    priority: 'medium',
    owner_id: null,
    owner_name: null,
    requester: null,
    due_date: null,
    follow_up_date: null,
    tags: [],
    links: [],
    created_by: null,
    created_at: '2026-08-12T00:00:00.000Z',
    updated_at: '2026-08-12T00:00:00.000Z',
    closed_at: null,
    last_activity_at: '2026-08-12T00:00:00.000Z',
    meeting_id: null,
    template_id: null,
    ...over,
  }
}

function progress(nodeId: string, stageId: string | null, changedAt: string | null): [string, Pick<MapNodeProgress, 'stage_id' | 'stage_changed_at'>] {
  return [nodeId, { stage_id: stageId, stage_changed_at: changedAt }]
}

function input(over: Partial<DeliveryInput> = {}): DeliveryInput {
  const stages = new Map<string, MapNodeStage>()
  const progressById = new Map<string, Pick<MapNodeProgress, 'stage_id' | 'stage_changed_at'>>()
  return {
    nodes: [],
    stages: stageIndex(progressById, stages),
    progressById,
    fallbackStallDays: null,
    now: NOW,
    labelOf: (n) => n.name,
    openByNode: new Map(),
    managerOfNode: new Map(),
    ...over,
  }
}

/** The whole two-step, wired the way the page wires it. */
function withStages(
  nodes: readonly MapNode[],
  stages: readonly MapNodeStage[],
  rows: readonly [string, Pick<MapNodeProgress, 'stage_id' | 'stage_changed_at'>][],
  over: Partial<DeliveryInput> = {},
): DeliveryInput {
  const byId = new Map(stages.map((s) => [s.id, s]))
  const progressById = new Map(rows)
  return input({ nodes, stages: stageIndex(progressById, byId), progressById, ...over })
}

/* ══════════════════════════ delivery rows ══════════════════════════ */

describe('buildDeliveryRows', () => {
  it('gives every live organization a row, including one nobody has staged', () => {
    const rows = buildDeliveryRows(
      withStages([node({ id: 'a' }), node({ id: 'b' })], [], []),
    )
    expect(rows.map((r) => r.nodeId).sort()).toEqual(['a', 'b'])
    // Three different absences, all null, none of them zero.
    expect(rows.every((r) => r.stageId === null)).toBe(true)
    expect(rows.every((r) => r.daysInStage === null)).toBe(true)
    expect(rows.every((r) => r.stallDays === null)).toBe(true)
    // …and one that IS a zero, because zero open work is a real answer.
    expect(rows.every((r) => r.open === 0)).toBe(true)
  })

  it('skips an archived organization — it is not being delivered', () => {
    const rows = buildDeliveryRows(
      withStages([node({ id: 'live' }), node({ id: 'away', archived: true })], [], []),
    )
    expect(rows.map((r) => r.nodeId)).toEqual(['live'])
  })

  it('reads the stage clock through lib/portfolio/fields, expectation and all', () => {
    const kickoff = stage({ id: 's1', sort_order: 1, expected_days: 30 })
    const rows = buildDeliveryRows(
      withStages(
        [node({ id: 'slow' }), node({ id: 'fresh' })],
        [kickoff],
        [
          progress('slow', 's1', '2026-06-01T00:00:00.000Z'),
          progress('fresh', 's1', '2026-08-22T00:00:00.000Z'),
        ],
      ),
    )
    const slow = rows.find((r) => r.nodeId === 'slow')
    const fresh = rows.find((r) => r.nodeId === 'fresh')
    expect(slow?.daysInStage).toBe(82)
    expect(slow?.stallDays).toBe(30)
    expect(slow?.atRisk).toBe(true)
    expect(slow?.stageOrder).toBe(1)
    // Stamped today: zero days, an expectation in force, and NOT late. This is
    // the live workspace's shape and the reason the verdict union exists.
    expect(fresh?.daysInStage).toBe(0)
    expect(fresh?.atRisk).toBe(false)
  })

  it('stops the clock on a terminal and on a paused rung', () => {
    const rows = buildDeliveryRows(
      withStages(
        [node({ id: 'arrived' }), node({ id: 'held' })],
        [
          stage({ id: 'live', terminal: true, expected_days: 1 }),
          stage({ id: 'hold', paused: true, expected_days: 1 }),
        ],
        [
          progress('arrived', 'live', '2020-01-01T00:00:00.000Z'),
          progress('held', 'hold', '2020-01-01T00:00:00.000Z'),
        ],
      ),
    )
    expect(rows.every((r) => r.atRisk)).toBe(false)
  })

  it('sorts at-risk first, then longest-standing, with "nobody has said" last', () => {
    const rows = buildDeliveryRows(
      withStages(
        [node({ id: 'quiet' }), node({ id: 'stuck' }), node({ id: 'moving' }), node({ id: 'blank' })],
        [stage({ id: 's1', expected_days: 10 })],
        [
          progress('quiet', 's1', '2026-08-20T00:00:00.000Z'),
          progress('stuck', 's1', '2026-05-01T00:00:00.000Z'),
          progress('moving', 's1', '2026-08-18T00:00:00.000Z'),
        ],
      ),
    )
    // `blank` has no clock at all and must not float above `moving` just
    // because null is not a big number.
    expect(rows.map((r) => r.nodeId)).toEqual(['stuck', 'moving', 'quiet', 'blank'])
  })

  it('prefers the inherited manager and falls back to the row own column', () => {
    const rows = buildDeliveryRows(
      withStages([node({ id: 'a', account_manager_id: 'own' }), node({ id: 'b', account_manager_id: 'own' })], [], [], {
        // The walk RAN for `a` and found somebody up the chain; it has never
        // been asked about `b`, which is a different fact from finding nobody.
        managerOfNode: new Map([['a', 'inherited']]),
      }),
    )
    expect(rows.find((r) => r.nodeId === 'a')?.managerId).toBe('inherited')
    expect(rows.find((r) => r.nodeId === 'b')?.managerId).toBe('own')
  })

  it('reads a null from the walk as "nobody, anywhere up the chain"', () => {
    const rows = buildDeliveryRows(
      withStages([node({ id: 'a', account_manager_id: 'own' })], [], [], {
        managerOfNode: new Map<string, string | null>([['a', null]]),
      }),
    )
    expect(rows[0]?.managerId).toBeNull()
  })
})

/* ══════════════════════ the honesty gate ══════════════════════ */

describe('latenessVerdict', () => {
  const rowsFor = (i: DeliveryInput): ReturnType<typeof stageReadiness> =>
    stageReadiness(buildDeliveryRows(i))

  it('says "day one" rather than zero when there is no workspace yet', () => {
    expect(latenessVerdict(rowsFor(withStages([], [], [])))).toEqual({ kind: 'no-organizations' })
  })

  it('says "nobody has recorded a rung" rather than zero', () => {
    const r = rowsFor(withStages([node({ id: 'a' }), node({ id: 'b' })], [], []))
    expect(r.staged).toBe(0)
    expect(r.unstaged).toBe(2)
    expect(latenessVerdict(r)).toEqual({ kind: 'no-stage', organizations: 2 })
  })

  it('says "no rung carries an expectation" rather than zero — 0026 seeded state', () => {
    // The whole ladder exists, organizations are standing on it, and
    // `expected_days` is null on every rung because 0026 seeds it that way on
    // purpose. Nothing CAN be late. A tile reading 0 would claim we looked.
    const r = rowsFor(
      withStages(
        [node({ id: 'a' }), node({ id: 'b' })],
        [stage({ id: 's1' })],
        [progress('a', 's1', '2020-01-01T00:00:00.000Z'), progress('b', 's1', '2020-01-01T00:00:00.000Z')],
      ),
    )
    expect(r.measurable).toBe(0)
    expect(latenessVerdict(r)).toEqual({ kind: 'no-expectation', staged: 2 })
  })

  it('says "nothing has aged yet" and names the longest — THE LIVE STATE', () => {
    // Every `stage_changed_at` stamped by today's import. At-risk is genuinely
    // zero, and the sentence the page must print is "no organization has been
    // on its stage long enough to be late yet", not "0 at risk".
    const r = rowsFor(
      withStages(
        [node({ id: 'a' }), node({ id: 'b' })],
        [stage({ id: 's1', expected_days: 30 })],
        [progress('a', 's1', '2026-08-22T00:00:00.000Z'), progress('b', 's1', '2026-08-22T00:00:00.000Z')],
      ),
    )
    expect(latenessVerdict(r)).toEqual({ kind: 'too-early', measurable: 2, longestDays: 0 })
  })

  it('counts, once a count is earned', () => {
    const r = rowsFor(
      withStages(
        [node({ id: 'a' }), node({ id: 'b' })],
        [stage({ id: 's1', expected_days: 30 })],
        [progress('a', 's1', '2026-01-01T00:00:00.000Z'), progress('b', 's1', '2026-08-22T00:00:00.000Z')],
      ),
    )
    expect(latenessVerdict(r)).toEqual({ kind: 'late', atRisk: 1, measurable: 2 })
  })

  it('lets a workspace floor make the question askable with no rung expectation', () => {
    // The "anything over 90 days is worth a look" policy — an ARGUMENT, never a
    // constant, so the page owns it and the arithmetic does not.
    const r = rowsFor(
      withStages(
        [node({ id: 'a' })],
        [stage({ id: 's1' })],
        [progress('a', 's1', '2026-01-01T00:00:00.000Z')],
        { fallbackStallDays: 90 },
      ),
    )
    expect(latenessVerdict(r)).toEqual({ kind: 'late', atRisk: 1, measurable: 1 })
  })

  it('never counts an organization with a rung but no stamp as measurable', () => {
    // `stage_id` set, `stage_changed_at` null — 0026 keeps those in step, but a
    // cleared row is reachable and there is nothing to judge on it.
    const r = rowsFor(
      withStages(
        [node({ id: 'a' })],
        [stage({ id: 's1', expected_days: 5 })],
        [progress('a', 's1', null)],
      ),
    )
    expect(r.staged).toBe(1)
    expect(r.measurable).toBe(0)
    expect(latenessVerdict(r)).toEqual({ kind: 'no-expectation', staged: 1 })
  })
})

/* ══════════════════════ risks & challenges ══════════════════════ */

describe('riskSeverity', () => {
  it('is derived from the pair the row already shows, and is never a score', () => {
    expect(riskSeverity('critical', 'ok')).toBe('severe')
    expect(riskSeverity('low', 'critical')).toBe('severe')
    expect(riskSeverity('high', 'overdue')).toBe('severe')
    expect(riskSeverity('high', 'ok')).toBe('elevated')
    expect(riskSeverity('low', 'overdue')).toBe('elevated')
    expect(riskSeverity('medium', 'stale')).toBe('elevated')
    expect(riskSeverity('low', 'stale')).toBe('watch')
    expect(riskSeverity('medium', 'ok')).toBe('watch')
  })
})

describe('bucketRisks', () => {
  const health = new Map<string, EntryHealth>()

  it('splits the two types and leaves everything else alone', () => {
    const out = bucketRisks(
      [
        entry({ id: 'i1', type: 'issue' }),
        entry({ id: 'e1', type: 'escalation' }),
        entry({ id: 'a1', type: 'action' }),
        entry({ id: 'n1', type: 'note' }),
      ],
      health,
      TODAY,
    )
    expect(out.issue.map((r) => r.entry.id)).toEqual(['i1'])
    expect(out.escalation.map((r) => r.entry.id)).toEqual(['e1'])
  })

  it('never carries a closed row — the same rule bucketFollowUps opens with', () => {
    const out = bucketRisks(
      [
        entry({ id: 'done', type: 'issue', status: 'done' }),
        entry({ id: 'cancelled', type: 'issue', status: 'cancelled' }),
        entry({ id: 'open', type: 'issue', status: 'blocked' }),
      ],
      health,
      TODAY,
    )
    expect(out.issue.map((r) => r.entry.id)).toEqual(['open'])
    expect(out.issue[0]?.waiting).toBe(true)
  })

  it('reads a missing health row as ok rather than inventing a fifth level', () => {
    const out = bucketRisks([entry({ id: 'i1', priority: 'low' })], new Map(), TODAY)
    expect(out.issue[0]?.health).toBe('ok')
    expect(out.issue[0]?.severity).toBe('watch')
  })

  it('sorts severity first, then oldest, then id', () => {
    const withHealth = new Map<string, EntryHealth>([
      ['b', { health: 'overdue' } as EntryHealth],
    ])
    const out = bucketRisks(
      [
        entry({ id: 'a', priority: 'low', created_at: '2026-08-01T00:00:00.000Z' }),
        entry({ id: 'b', priority: 'low', created_at: '2026-08-20T00:00:00.000Z' }),
        entry({ id: 'c', priority: 'critical', created_at: '2026-08-21T00:00:00.000Z' }),
      ],
      withHealth,
      TODAY,
    )
    expect(out.issue.map((r) => r.entry.id)).toEqual(['c', 'b', 'a'])
    expect(out.issue[2]?.daysOpen).toBe(21)
  })
})

describe('isRiskType', () => {
  it('answers for exactly the two members and no other', () => {
    expect(isRiskType('issue')).toBe(true)
    expect(isRiskType('escalation')).toBe(true)
    for (const other of ['action', 'decision', 'request', 'change', 'note'] as const) {
      expect(isRiskType(other)).toBe(false)
    }
  })
})
