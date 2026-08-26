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
  buildActionRows,
  buildDeliveryRows,
  buildInitiativeRows,
  bucketRisks,
  isRiskType,
  latenessVerdict,
  projectStatus,
  riskSeverity,
  stageReadiness,
  type DeliveryInput,
} from './summary'
import { bucketFollowUps } from '../entrySections'
import { stageIndex } from '../mapNodes'
import type {
  Entry,
  EntryHealth,
  MapNode,
  MapNodeGoal,
  MapNodeProgress,
  MapNodeStage,
} from '../../types'

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

/**
 * A node. `kind_id` defaults to the ORGANIZATION kind, because that is what
 * every test in this file is about — `buildDeliveryRows` now draws only
 * organizations, and a fixture defaulting to null would silently produce a fold
 * with no rows and assertions that pass vacuously. A test about a department
 * passes its own kind.
 */
function node(over: Partial<MapNode> & { id: string }): MapNode {
  return {
    parent_id: null,
    track_id: 't1',
    kind_id: 'kind-org',
    name: over.id,
    name_ar: '',
    description: '',
    description_ar: '',
    account_manager_id: null,
    vendor: '',
    his_id: null,
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

/**
 * A progress row. `updatedBy` defaults to A PERSON, because that is what these
 * tests are about — the ladder's arithmetic, given that somebody said where an
 * organization is. `fields.ts` reads a null `updated_by` as "a script wrote
 * this, so its clock is the script's clock", and a fixture defaulting to null
 * would silently turn every lateness assertion in this file into an assertion
 * about unwitnessed clocks. Pass null explicitly to test that.
 */
function progress(
  nodeId: string,
  stageId: string | null,
  changedAt: string | null,
  updatedBy: string | null = 'person-1',
): [string, Pick<MapNodeProgress, 'stage_id' | 'stage_changed_at' | 'updated_by'>] {
  return [nodeId, { stage_id: stageId, stage_changed_at: changedAt, updated_by: updatedBy }]
}

function input(over: Partial<DeliveryInput> = {}): DeliveryInput {
  const stages = new Map<string, MapNodeStage>()
  const progressById = new Map<string, Pick<MapNodeProgress, 'stage_id' | 'stage_changed_at' | 'updated_by'>>()
  return {
    nodes: [],
    stages: stageIndex(progressById, stages),
    progressById,
    fallbackStallDays: null,
    now: NOW,
    labelOf: (n) => n.name,
    openByNode: new Map(),
    managerOfNode: new Map(),
    // Every fixture node is an organization unless a test says otherwise; the
    // fold now refuses anything else, which is what stopped departments being
    // drawn as hospitals.
    orgKindId: 'kind-org',
    ...over,
  }
}

/** The whole two-step, wired the way the page wires it. */
function withStages(
  nodes: readonly MapNode[],
  stages: readonly MapNodeStage[],
  rows: readonly [string, Pick<MapNodeProgress, 'stage_id' | 'stage_changed_at' | 'updated_by'>][],
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
    /*
     * ⚠ THIS ASSERTED `no-expectation` AND THAT WAS THE SAME BUG, ONE LAYER
     *   DOWN. The rung here carries `expected_days: 5` — the expectation exists
     *   and is the one thing NOT missing. `measurable` was the only counter, so
     *   both silences collapsed onto the arm whose sentence sends the reader off
     *   to set a duration they have already set.
     */
    expect(latenessVerdict(r)).toEqual({ kind: 'no-clock', staged: 1, withExpectation: 1 })
  })

  it('still says no-expectation when the rung genuinely carries no time', () => {
    // The other half of the split, and the reason it is a split: same zero
    // `measurable`, opposite advice. Here the rung really has no duration, so
    // "go and give a stage one" is the true and useful sentence.
    const r = rowsFor(
      withStages(
        [node({ id: 'a' })],
        [stage({ id: 's1', expected_days: null })],
        [progress('a', 's1', '2026-01-01T00:00:00.000Z')],
      ),
    )
    expect(r.measurable).toBe(0)
    expect(r.withClock).toBe(1)
    expect(r.withExpectation).toBe(0)
    expect(latenessVerdict(r)).toEqual({ kind: 'no-expectation', staged: 1 })
  })

  /*
   * THE LIVE SHAPE, ASSERTED END TO END. Rungs carry times; every progress row
   * was written by an import, so `portfolio/fields.ts` reports no days for any
   * of them. The page must say "nobody put a stage there", not "set a duration".
   */
  it('names the missing CLOCK when the rungs have times and nobody started one', () => {
    const r = rowsFor(
      withStages(
        [node({ id: 'a' }), node({ id: 'b' })],
        [stage({ id: 's1', expected_days: 10 })],
        [progress('a', 's1', '2026-08-22T14:44:16.991611Z', null), progress('b', 's1', '2026-08-23T17:11:53.997788Z', null)],
      ),
    )
    expect(r.withExpectation).toBe(2)
    expect(r.withClock).toBe(0)
    expect(latenessVerdict(r)).toEqual({ kind: 'no-clock', staged: 2, withExpectation: 2 })
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

/* ═══════════════ the import-stamp fingerprint (the second gate) ═══════════ */

describe('stageReadiness notices when every clock was started at once', () => {
  const readinessFor = (i: DeliveryInput): ReturnType<typeof stageReadiness> =>
    stageReadiness(buildDeliveryRows(i))

  it('names the day when every measurable organization was stamped on it', () => {
    // THE LIVE WORKSPACE. Fifty organizations across seven rungs, every
    // `stage_changed_at` written by one import's `now()`. The arithmetic
    // downstream is perfect and the INPUT is what lies — two days from now the
    // UAT rows go "late" on a clock nobody started.
    const r = readinessFor(
      withStages(
        [node({ id: 'a' }), node({ id: 'b' }), node({ id: 'c' })],
        [stage({ id: 'uat', expected_days: 1 }), stage({ id: 'kick', expected_days: 10 })],
        [
          progress('a', 'uat', '2026-08-20T06:00:00.000Z'),
          progress('b', 'uat', '2026-08-20T06:00:01.000Z'),
          progress('c', 'kick', '2026-08-20T06:00:02.000Z'),
        ],
      ),
    )
    expect(r.clockStartedTogether).toBe('2026-08-20')
    // …and the count is still carried. The caveat qualifies the number; it does
    // not replace it, because the number IS true of what is recorded.
    expect(r.atRisk).toBe(2)
  })

  it('says nothing once one organization has genuinely been moved', () => {
    const r = readinessFor(
      withStages(
        [node({ id: 'a' }), node({ id: 'b' })],
        [stage({ id: 's1', expected_days: 10 })],
        [
          progress('a', 's1', '2026-08-20T00:00:00.000Z'),
          progress('b', 's1', '2026-08-21T00:00:00.000Z'),
        ],
      ),
    )
    expect(r.clockStartedTogether).toBeNull()
  })

  it('refuses to call one organization a pattern', () => {
    // Two is the smallest population for which "together" means anything. A
    // single measurable row is a fact about one organization, not a fingerprint.
    const r = readinessFor(
      withStages(
        [node({ id: 'a' })],
        [stage({ id: 's1', expected_days: 10 })],
        [progress('a', 's1', '2026-08-20T00:00:00.000Z')],
      ),
    )
    expect(r.measurable).toBe(1)
    expect(r.clockStartedTogether).toBeNull()
  })

  it('ignores organizations the lateness question cannot be asked of', () => {
    // `b` stands on a rung with no expectation, so it is not measurable and its
    // stamp is not evidence either way.
    const r = readinessFor(
      withStages(
        [node({ id: 'a' }), node({ id: 'b' }), node({ id: 'c' })],
        [stage({ id: 'timed', expected_days: 10 }), stage({ id: 'untimed' })],
        [
          progress('a', 'timed', '2026-08-20T06:00:00.000Z'),
          progress('b', 'untimed', '1999-01-01T12:00:00.000Z'),
          progress('c', 'timed', '2026-08-20T12:00:00.000Z'),
        ],
      ),
    )
    expect(r.clockStartedTogether).toBe('2026-08-20')
  })
})

/* ══════════════════════════ project cards ══════════════════════════ */

describe('projectStatus', () => {
  const row = (over: Partial<Parameters<typeof projectStatus>[0]> = {}) => ({
    stageId: 's1' as string | null,
    terminal: false,
    paused: false,
    atRisk: false,
    ...over,
  })

  it('gives every arm its own answer', () => {
    expect(projectStatus(row({ stageId: null }))).toBe('not-staged')
    expect(projectStatus(row({ terminal: true }))).toBe('done')
    expect(projectStatus(row({ paused: true }))).toBe('paused')
    expect(projectStatus(row({ atRisk: true }))).toBe('late')
    expect(projectStatus(row())).toBe('in-progress')
  })

  it('states which fact wins, so a clock change cannot silently reword a pill', () => {
    // Unreachable through the real fold — `stageReading` stops the clock on both
    // rungs — and pinned anyway: "finished" and "held" both beat "late".
    expect(projectStatus(row({ terminal: true, atRisk: true }))).toBe('done')
    expect(projectStatus(row({ paused: true, atRisk: true }))).toBe('paused')
    // And "nobody has said where this is" beats everything, because there is no
    // rung for any of the other three to be a fact about.
    expect(projectStatus(row({ stageId: null, terminal: true, atRisk: true }))).toBe('not-staged')
  })
})

/* ══════════════════════════ initiatives ══════════════════════════ */

function goal(over: Partial<MapNodeGoal> & { id: string }): MapNodeGoal {
  return {
    node_id: 'n1',
    label: over.id,
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

function initiatives(
  goals: readonly MapNodeGoal[],
  nodes: readonly MapNode[],
  stages: readonly MapNodeStage[],
  rows: readonly [string, Pick<MapNodeProgress, 'stage_id' | 'stage_changed_at'>][],
) {
  const byId = new Map(stages.map((s) => [s.id, s]))
  const progressById = new Map(rows)
  return buildInitiativeRows({
    goals,
    nodes,
    stages: stageIndex(progressById, byId),
    today: TODAY,
    labelOf: (n) => n.name,
    goalLabelOf: (g) => g.label,
  })
}

describe('buildInitiativeRows', () => {
  const LIVE = stage({ id: 'live', sort_order: 5, terminal: true })
  const UAT = stage({ id: 'uat', sort_order: 3 })

  it('reads a date goal about the node itself — 0027 arm one', () => {
    const out = initiatives(
      [goal({ id: 'g1', node_id: 'org' })],
      [node({ id: 'org' })],
      [LIVE],
      [progress('org', 'live', '2026-08-01T00:00:00.000Z')],
    )
    expect(out[0]?.progress.met).toBe(true)
    expect(out[0]?.progress.target).toBeNull()
    expect(out[0]?.targetDate).toBe('2026-12-31')
  })

  it('reads a count goal against the descendants — 0027 arm two', () => {
    const out = initiatives(
      [goal({ id: 'g1', node_id: 'phase', target: 2 })],
      [
        node({ id: 'phase' }),
        node({ id: 'a', parent_id: 'phase' }),
        node({ id: 'b', parent_id: 'phase' }),
        node({ id: 'deep', parent_id: 'a' }),
      ],
      [LIVE, UAT],
      [
        progress('a', 'live', '2026-08-01T00:00:00.000Z'),
        progress('b', 'uat', '2026-08-01T00:00:00.000Z'),
        progress('deep', 'live', '2026-08-01T00:00:00.000Z'),
      ],
    )
    // Every descendant at any depth: `deep` counts, and the phase itself does not.
    expect(out[0]?.progress.reached).toBe(2)
    expect(out[0]?.progress.eligible).toBe(3)
    expect(out[0]?.progress.met).toBe(true)
  })

  it('carries the unstaged count, because "0 of 40" alone sends an AD wrong', () => {
    const out = initiatives(
      [goal({ id: 'g1', node_id: 'phase', target: 2, stage_id: 'uat' })],
      [
        node({ id: 'phase' }),
        node({ id: 'a', parent_id: 'phase' }),
        node({ id: 'b', parent_id: 'phase' }),
      ],
      [LIVE, UAT],
      [progress('a', 'uat', '2026-08-01T00:00:00.000Z')],
    )
    expect(out[0]?.progress.reached).toBe(1)
    expect(out[0]?.progress.unstaged).toBe(1)
    expect(out[0]?.stageId).toBe('uat')
  })

  it('skips a goal on an archived department, and one on a node it does not hold', () => {
    const out = initiatives(
      [
        goal({ id: 'gone', node_id: 'away' }),
        goal({ id: 'orphan', node_id: 'nowhere' }),
        goal({ id: 'kept', node_id: 'here' }),
      ],
      [node({ id: 'here' }), node({ id: 'away', archived: true })],
      [],
      [],
    )
    expect(out.map((r) => r.goalId)).toEqual(['kept'])
  })

  it('cannot hang on a cyclic parent_id', () => {
    // `map_nodes.parent_id` is a plain self-reference with no cycle constraint,
    // and this page is one a director opens every morning.
    const out = initiatives(
      [goal({ id: 'g1', node_id: 'x', target: 1 })],
      [node({ id: 'x', parent_id: 'y' }), node({ id: 'y', parent_id: 'x' })],
      [LIVE],
      [progress('y', 'live', '2026-08-01T00:00:00.000Z')],
    )
    expect(out[0]?.progress.reached).toBe(1)
  })

  it('sorts overdue first, then soonest, then by label in code point order', () => {
    const out = initiatives(
      [
        goal({ id: 'g-far', node_id: 'n', label: 'Zulu', target_date: '2027-01-01' }),
        goal({ id: 'g-late', node_id: 'n', label: 'Alpha', target_date: '2026-01-01' }),
        goal({ id: 'g-soon', node_id: 'n', label: 'Bravo', target_date: '2026-09-01' }),
        goal({ id: 'g-far2', node_id: 'n', label: 'Alpha', target_date: '2027-01-01' }),
      ],
      [node({ id: 'n' })],
      [],
      [],
    )
    expect(out.map((r) => r.goalId)).toEqual(['g-late', 'g-soon', 'g-far2', 'g-far'])
  })

  it('never puts a met commitment above an overdue one just for being old', () => {
    const out = initiatives(
      [
        goal({ id: 'kept', node_id: 'org', target_date: '2026-01-01' }),
        goal({ id: 'missed', node_id: 'other', target_date: '2026-02-01' }),
      ],
      [node({ id: 'org' }), node({ id: 'other' })],
      [stage({ id: 'live', terminal: true })],
      [progress('org', 'live', '2026-08-01T00:00:00.000Z')],
    )
    expect(out.map((r) => r.goalId)).toEqual(['missed', 'kept'])
  })
})

/* ══════════════════════════ the action register ══════════════════════════ */

function action(over: Partial<Entry> & { id: string }): Entry {
  return entry({ type: 'action', ...over })
}

describe('buildActionRows', () => {
  it('takes open actions and nothing else', () => {
    const out = buildActionRows(
      [
        action({ id: 'keep' }),
        action({ id: 'closed', status: 'done' }),
        entry({ id: 'an-issue', type: 'issue' }),
        entry({ id: 'a-note', type: 'note' }),
      ],
      new Map(),
      TODAY,
    )
    expect(out.map((r) => r.entry.id)).toEqual(['keep'])
  })

  it('lists an action nothing is wrong with — the whole point of the register', () => {
    // On track, assigned, not due soon. Before the register existed this row
    // appeared NOWHERE on the page: the buckets take only what needs chasing and
    // the risk tables read `issue` and `escalation` alone.
    const out = buildActionRows([action({ id: 'fine', owner_id: 'u1' })], new Map(), TODAY)
    expect(out.map((r) => r.entry.id)).toEqual(['fine'])
    expect(out[0]?.overdue).toBe(false)
  })

  it('reads a missing health row as ok rather than inventing a fifth level', () => {
    const out = buildActionRows([action({ id: 'a' })], new Map(), TODAY)
    expect(out[0]?.health).toBe('ok')
  })

  it('counts DAYS SINCE RAISED, and says so — never days in status', () => {
    // `daysInStatus` falls back to `created_at` when the thread is not loaded,
    // and on this page it never is. That fallback is a CEILING, not a floor: an
    // action raised in June and blocked yesterday has been blocked for one day.
    // So the register prints what it can prove — the age of the entry.
    const out = buildActionRows(
      [action({ id: 'a', created_at: '2026-08-12T00:00:00.000Z', status: 'blocked' })],
      new Map(),
      TODAY,
    )
    expect(out[0]?.daysOpen).toBe(10)
    expect(out[0]).not.toHaveProperty('daysInStatus')
  })

  it('agrees with bucketFollowUps about what "overdue" means', () => {
    // TWO DEFINITIONS OF OVERDUE IN ONE SECTION is, in entrySections.ts's own
    // words, the single most corrosive kind of bug this product can have. The
    // register and the bucket sit under one heading, so they are compared here
    // on one fixture rather than trusted to agree.
    const entries = [
      action({ id: 'due-past', due_date: '2026-08-01' }),
      action({ id: 'follow-past', follow_up_date: '2026-08-01' }),
      action({ id: 'view-says-so', due_date: null }),
      action({ id: 'clean', due_date: '2026-12-01' }),
    ]
    const health = new Map<string, EntryHealth>([
      ['view-says-so', { health: 'overdue', days_overdue: 4 } as EntryHealth],
      ['due-past', { health: 'overdue', days_overdue: 21 } as EntryHealth],
    ])
    const register = buildActionRows(entries, health, TODAY)
    const buckets = bucketFollowUps(entries, health, {
      meId: null,
      today: TODAY,
      staleDays: () => 365,
    })
    const flagged = register.filter((r) => r.overdue).map((r) => r.entry.id).sort()
    expect(flagged).toEqual(buckets.overdue.map((e) => e.id).sort())
    expect(flagged).toEqual(['due-past', 'follow-past', 'view-says-so'])
  })

  it('sorts overdue first, then soonest due with no date last, then quietest', () => {
    const out = buildActionRows(
      [
        action({ id: 'undated', last_activity_at: '2026-08-20T00:00:00.000Z' }),
        action({ id: 'late', due_date: '2026-08-01' }),
        action({ id: 'soon', due_date: '2026-08-25' }),
        action({ id: 'later', due_date: '2026-09-25' }),
      ],
      new Map(),
      TODAY,
    )
    expect(out.map((r) => r.entry.id)).toEqual(['late', 'soon', 'later', 'undated'])
  })

  it('breaks a tie on quietness, then on id, so two rows never swap on a render', () => {
    const out = buildActionRows(
      [
        action({ id: 'b', due_date: '2026-09-01', last_activity_at: '2026-08-20T00:00:00.000Z' }),
        action({ id: 'a', due_date: '2026-09-01', last_activity_at: '2026-08-10T00:00:00.000Z' }),
        action({ id: 'c', due_date: '2026-09-01', last_activity_at: '2026-08-20T00:00:00.000Z' }),
      ],
      new Map(),
      TODAY,
    )
    expect(out.map((r) => r.entry.id)).toEqual(['a', 'b', 'c'])
  })
})

/*
 * ── A DEPARTMENT IS NOT A HOSPITAL ─────────────────────────────────────────
 *
 * ⚠ THE OWNER SAW THIS ON THE LIVE SITE AND SAID SO: "even few names i'm seeing
 *   are not placed correctly, it delivery within ob related subjects". The
 *   Onboarding delivery tab was drawing all six departments as cards —
 *   "Business Operations — no use case has been recorded against this
 *   organization yet — 84 open items", and the same for IT Integration, IT
 *   Delivery, Product and التهيئة.
 *
 * Every one of those sentences was TRUE and about a thing that cannot have use
 * cases, which is the worst kind of wrong: it reads as a finding about a
 * hospital that is behind.
 *
 * `buildDeliveryRows` has said "one row per live ORGANIZATION" in its docblock
 * since it was written, and took every node it was handed. With one track and no
 * departments the two agreed by accident. The six departments arrived and the
 * accident ended.
 */
describe('buildDeliveryRows draws organizations and nothing else', () => {
  const estate = () => [
    node({ id: 'uhr', kind_id: 'kind-programme' }),
    node({ id: 'onboarding', kind_id: 'kind-phase', parent_id: 'uhr' }),
    node({ id: 'it-integration', kind_id: 'kind-phase', parent_id: 'uhr' }),
    node({ id: 'fakeeh', kind_id: 'kind-org', parent_id: 'onboarding' }),
    node({ id: 'aljedaani', kind_id: 'kind-org', parent_id: 'onboarding' }),
  ]

  it('leaves the track and the departments out', () => {
    const rows = buildDeliveryRows(input({ nodes: estate() }))
    expect(rows.map((r) => r.nodeId).sort()).toEqual(['aljedaani', 'fakeeh'])
  })

  /*
   * The failure this replaces was not "a department appeared" — it was "a
   * department appeared CARRYING A COUNT". 84 open items rolled up from its
   * children, printed on a card that also said no use case had been recorded,
   * so the reader saw a hospital with a lot of open work and nothing recorded.
   */
  it('does not print a department carrying its children roll-up', () => {
    const rows = buildDeliveryRows(
      input({ nodes: estate(), openByNode: new Map([['onboarding', 84], ['fakeeh', 3]]) }),
    )
    expect(rows.find((r) => r.nodeId === 'onboarding')).toBeUndefined()
    expect(rows.find((r) => r.nodeId === 'fakeeh')?.open).toBe(3)
  })

  /*
   * Drawing everything is worse than drawing nothing when the catalogue has not
   * loaded, because a reader cannot tell a full estate from a mislabelled one.
   */
  it('draws nothing at all rather than everything when the kinds are absent', () => {
    expect(buildDeliveryRows(input({ nodes: estate(), orgKindId: null }))).toEqual([])
  })
})
