// The Org panel's arithmetic, which is the only thing on that panel a reader
// cannot check by counting the rows themselves.
//
// WHAT IS ACTUALLY AT RISK HERE, and it is not "does 6 + 3 equal 9". It is the
// DENOMINATOR: three separate, plausible, and wrong ways to compute it each
// produce a number that looks right on the day it ships and describes a
// different reality a fortnight later.
//
//   · Count only the links → an organization that integrated ADT and nothing
//     else reads `1 of 1 live`, which is "finished" in front of the person whose
//     job is to notice it is not.
//   · Count only the VISIBLE catalogue → the afternoon an admin hides a retired
//     capability, `6 of 9` becomes `6 of 8` with nothing about the organization
//     having changed, and yesterday's steering deck disagrees with today's.
//   · Compare against a hardcoded 'live' → renaming the terminal status leaves
//     the arithmetic counting a word nothing writes any more, and the panel
//     reads `0 of 9` for every organization in the workspace.
//
// Each of those has a case below, named after the failure rather than after the
// function.
//
// PURE MODULE, PLAIN TEST: no globals shim, no store, no clock. That is the
// contract lib/mindtree/model.ts set and the reason this file needs none of the
// `vi.hoisted` scaffolding every component test in this repo opens with.

import { describe, expect, it } from 'vitest'
// ALIASED: `useCaseProgress` is a pure function whose name matches oxlint's
// Hook heuristic (`use` + a capital), so calling it inside an `it()` body is a
// `react/rules-of-hooks` ERROR under the unaliased name. Same fence
// MapBranchDetail.tsx puts at its own import; see the comment there.
import {
  entityIdOf,
  foldPortfolio,
  foldVendors,
  goalProgress,
  progressByNode,
  stageIndex,
  useCaseProgress as progressOf,
  type StageIndex,
} from './mapNodes'
import type { MapNode, MapNodeStage, MapNodeUseCase, UseCase, UseCaseStatus } from '../types'

/* ────────────────────────────── fixtures ────────────────────────────── */

let seq = 0

function capability(over: Partial<UseCase> & Pick<UseCase, 'id' | 'name'>): UseCase {
  seq += 1
  return {
    name_ar: '',
    sort_order: seq,
    hidden: false,
    created_by: null,
    updated_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

/** The ten seeded capabilities, cut to the six the cases need. */
function catalogue(): UseCase[] {
  seq = 0
  return [
    capability({ id: 'adt', name: 'ADT' }),
    capability({ id: 'rx1', name: 'Medication Prescribe V1' }),
    capability({ id: 'rx2', name: 'Medication Prescribe V2' }),
    capability({ id: 'rad', name: 'Radiology Order' }),
    capability({ id: 'lab', name: 'Lab Order' }),
    capability({ id: 'note', name: 'Clinical Notes' }),
  ]
}

function link(useCaseId: string, status: UseCaseStatus, nodeId = 'org-1'): MapNodeUseCase {
  return { node_id: nodeId, use_case_id: useCaseId, status }
}

const LIVE: UseCaseStatus = 'live'

/**
 * The POPULATION a number is about — `useCaseProgress`' fourth argument.
 *
 * Written as a fixture rather than inline so that every case below states which
 * organizations it is asking about, which is the whole content of the argument:
 * before it existed the answer was inferred from the links and an organization
 * that had recorded nothing was invisible to it.
 */
function orgs(...ids: string[]): { id: string }[] {
  return ids.map((id) => ({ id }))
}

const ONE = orgs('org-1')
const TWO = orgs('org-1', 'org-2')

/* ──────────────────────── the number on the heading ──────────────────── */

describe('useCaseProgress — the heading number', () => {
  it('counts the terminal status against every capability on the table', () => {
    const result = progressOf(
      catalogue(),
      [link('adt', 'live'), link('rx1', 'live'), link('rad', 'testing'), link('lab', 'planned')],
      LIVE,
      ONE,
    )
    expect(result.done).toBe(2)
    expect(result.total).toBe(6)
    expect(result.linked).toBe(4)
    expect(result.nodes).toBe(1)
  })

  it('reads 0 of 6 for an organization nobody has recorded anything about', () => {
    // NOT `0 of 0`. The panel distinguishes the two — nothing recorded renders
    // an em-dash rather than a number — but the arithmetic must still know the
    // size of the table, or the em-dash case and the "at zero" case become the
    // same value and the distinction is unrenderable.
    const result = progressOf(catalogue(), [], LIVE, ONE)
    expect(result.total).toBe(6)
    expect(result.done).toBe(0)
    expect(result.linked).toBe(0)
    expect(result.nodes).toBe(1)
  })

  it('does not read 1 of 1 for an organization that has integrated one thing', () => {
    // The failure this module exists to prevent, stated as its own case: a
    // denominator counted off the LINKS reports the emptiest organization in
    // the workspace as the only finished one.
    const result = progressOf(catalogue(), [link('adt', 'live')], LIVE, ONE)
    expect(result.done).toBe(1)
    expect(result.total).toBe(6)
    expect(`${result.done} of ${result.total}`).not.toBe('1 of 1')
  })
})

/* ─────────────────── the denominator that must not move ──────────────── */

describe('useCaseProgress — hiding a capability', () => {
  it('keeps a hidden capability the organization is recorded against', () => {
    // `6 of 9` yesterday and `6 of 8` today, with nothing about the
    // organization having changed, is the report that makes a steering deck
    // unciteable. `use_cases.hidden` retires a row from the pickers; it does
    // not retire the fact that this organization integrated it.
    const rows = catalogue().map((u) => (u.id === 'rad' ? { ...u, hidden: true } : u))
    const links = [link('adt', 'live'), link('rad', 'live')]
    const result = progressOf(rows, links, LIVE, ONE)

    expect(result.total).toBe(6)
    expect(result.done).toBe(2)
    const rad = result.rows.find((r) => r.useCase.id === 'rad')
    expect(rad?.retired).toBe(true)
    expect(rad?.status).toBe('live')
  })

  it('drops a hidden capability nobody is recorded against', () => {
    // The other half of the same rule: retiring an unused row IS meant to make
    // it go away, and a matrix that kept every capability ever typed would grow
    // forever and never shrink.
    const rows = catalogue().map((u) => (u.id === 'rad' ? { ...u, hidden: true } : u))
    const result = progressOf(rows, [link('adt', 'live')], LIVE, ONE)

    expect(result.total).toBe(5)
    expect(result.rows.map((r) => r.useCase.id)).not.toContain('rad')
  })

  it('marks retired only what is BOTH hidden and recorded', () => {
    const rows = catalogue().map((u) => (u.id === 'lab' ? { ...u, hidden: true } : u))
    const result = progressOf(rows, [link('lab', 'planned'), link('adt', 'live')], LIVE, ONE)
    expect(result.rows.filter((r) => r.retired).map((r) => r.useCase.id)).toEqual(['lab'])
  })
})

/* ──────────────────── the terminal status is an argument ─────────────── */

describe('useCaseProgress — terminalKey', () => {
  it('counts whatever status it is handed, not the word "live"', () => {
    const links = [link('adt', 'live'), link('rx1', 'testing'), link('rx2', 'testing')]
    expect(progressOf(catalogue(), links, 'testing', ONE).done).toBe(2)
    expect(progressOf(catalogue(), links, 'live', ONE).done).toBe(1)
    expect(progressOf(catalogue(), links, 'planned', ONE).done).toBe(0)
  })

  it('answers 0 for a status nothing carries, rather than throwing', () => {
    // A renamed status must produce a visibly wrong number on the first paint,
    // not an exception that takes the panel down and not a silently plausible
    // one. `0 of 6` on every organization is the loudest quiet failure
    // available.
    const result = progressOf(catalogue(), [link('adt', 'live')], 'shipped', ONE)
    expect(result.done).toBe(0)
    expect(result.total).toBe(6)
  })
})

/* ────────────────────────── the rows themselves ──────────────────────── */

describe('useCaseProgress — the rows', () => {
  it('renders every capability, including the ones with nothing recorded', () => {
    const result = progressOf(catalogue(), [link('adt', 'live')], LIVE, ONE)
    expect(result.rows).toHaveLength(6)
    const blank = result.rows.find((r) => r.useCase.id === 'lab')
    expect(blank?.status).toBeNull()
    expect(blank?.linked).toBe(0)
    expect(blank?.done).toBe(0)
  })

  it('orders by sort_order and breaks a tie by id, so two loads look alike', () => {
    const rows = [
      capability({ id: 'b', name: 'B', sort_order: 5 }),
      capability({ id: 'a', name: 'A', sort_order: 5 }),
      capability({ id: 'first', name: 'First', sort_order: 1 }),
    ]
    expect(progressOf(rows, [], LIVE, ONE).rows.map((r) => r.useCase.id)).toEqual(['first', 'a', 'b'])
  })

  it('de-duplicates a catalogue handed to it twice', () => {
    // A caller that concatenated `useUseCases()` and `useAllUseCases()` would
    // otherwise double the denominator and render every row twice — and `6 of
    // 12` is exactly the kind of wrong that reads as a real number.
    const rows = catalogue()
    const result = progressOf([...rows, ...rows], [link('adt', 'live')], LIVE, ONE)
    expect(result.total).toBe(6)
    expect(result.rows).toHaveLength(6)
  })

  it('ignores a link to a capability the catalogue does not carry', () => {
    // It has no name, so a row for it would be a blank line with a status pill
    // beside it. Counted in neither half — never in `done`, which would put the
    // numerator above a denominator that cannot hold it.
    const result = progressOf(catalogue(), [link('ghost', 'live'), link('adt', 'live')], LIVE, ONE)
    expect(result.done).toBe(1)
    expect(result.total).toBe(6)
    expect(result.linked).toBe(1)
  })
})

/* ───────────────────────── the roll-up seam ──────────────────────────── */

describe('useCaseProgress — a list of links is a roll-up', () => {
  it('counts capability × organization pairs when several organizations are in', () => {
    // The Phase-level number, from the same code with a different argument: two
    // organizations against a six-capability catalogue is 12 pairs, and three
    // of them are live.
    const links = [
      link('adt', 'live', 'org-1'),
      link('rx1', 'live', 'org-1'),
      link('adt', 'live', 'org-2'),
      link('rx1', 'testing', 'org-2'),
    ]
    const result = progressOf(catalogue(), links, LIVE, TWO)
    expect(result.nodes).toBe(2)
    expect(result.total).toBe(12)
    expect(result.done).toBe(3)
  })

  it('keeps a row’s status when the organizations agree and drops it when they do not', () => {
    const links = [
      link('adt', 'live', 'org-1'),
      link('adt', 'live', 'org-2'),
      link('rx1', 'live', 'org-1'),
      link('rx1', 'planned', 'org-2'),
    ]
    const rows = progressOf(catalogue(), links, LIVE, TWO).rows
    expect(rows.find((r) => r.useCase.id === 'adt')?.status).toBe('live')
    // No single word is true of both, so the row falls back to its counts.
    const rx1 = rows.find((r) => r.useCase.id === 'rx1')
    expect(rx1?.status).toBeNull()
    expect(rx1?.linked).toBe(2)
    expect(rx1?.done).toBe(1)
  })
})

/* ─────────────────────────── entityIdOf ──────────────────────────────── */

describe('entityIdOf', () => {
  it('answers the node id for an entity and null for everything else', () => {
    // `bucketKey` is a TRACK id on a track node and a status key on a group
    // node, and none of the three is distinguishable from the others by shape.
    // This is the one place that reads it with its `kind`, so the panel mount
    // and the stats band cannot come to different answers.
    expect(entityIdOf({ kind: 'entity', bucketKey: 'org-1' })).toBe('org-1')
    expect(entityIdOf({ kind: 'track', bucketKey: 't-uhr' })).toBeNull()
    expect(entityIdOf({ kind: 'group', bucketKey: 'in_progress' })).toBeNull()
    expect(entityIdOf({ kind: 'root', bucketKey: null })).toBeNull()
    expect(entityIdOf({ kind: 'entry', bucketKey: null })).toBeNull()
  })

  it('answers null for an entity with no key rather than inventing one', () => {
    expect(entityIdOf({ kind: 'entity', bucketKey: null })).toBeNull()
  })
})

/* ─────────────── the fourth argument: the denominator's population ───── */

describe('useCaseProgress — the population is an argument, not an inference', () => {
  it('counts the organizations that recorded NOTHING into the denominator', () => {
    // THE DEFECT THIS ARGUMENT EXISTS TO CLOSE, and the dominant case on a
    // freshly imported 400-organization workspace: three organizations of forty
    // have a row. Counted off the links the panel reads `3 of 18` — a plausible
    // number that silently drops the thirty-seven the reader is employed to
    // notice. Counted off the population it reads `3 of 240`.
    const links = [
      link('adt', 'live', 'org-1'),
      link('adt', 'live', 'org-2'),
      link('adt', 'live', 'org-3'),
    ]
    const forty = orgs(...Array.from({ length: 40 }, (_, i) => `org-${i + 1}`))
    const result = progressOf(catalogue(), links, LIVE, forty)

    expect(result.nodes).toBe(40)
    expect(result.total).toBe(240)
    expect(result.done).toBe(3)
    // The old arithmetic, stated so the case cannot pass by accident if the
    // argument is ever ignored again.
    expect(result.total).not.toBe(18)
  })

  it('ignores a link from an organization outside the population', () => {
    // A narrow node list with a wide link list must not produce done > total.
    // Ignoring rather than widening is the rule: `nodes` is the denominator the
    // CALLER asserts, and silently widening it would make the number disagree
    // with the list drawn beside it.
    const links = [link('adt', 'live', 'org-1'), link('rx1', 'live', 'stranger')]
    const result = progressOf(catalogue(), links, LIVE, ONE)

    expect(result.nodes).toBe(1)
    expect(result.total).toBe(6)
    expect(result.done).toBe(1)
    expect(result.linked).toBe(1)
  })

  it('does not resurrect a hidden capability for a foreign link', () => {
    // The foreign-link test has to run BEFORE the table is built, or a stranger
    // could put a retired capability back on the matrix of an organization that
    // never integrated it.
    const rows = catalogue().map((u) => (u.id === 'rad' ? { ...u, hidden: true } : u))
    const result = progressOf(rows, [link('rad', 'live', 'stranger')], LIVE, ONE)

    expect(result.rows.map((r) => r.useCase.id)).not.toContain('rad')
    expect(result.total).toBe(5)
  })

  it('de-duplicates the population, so two subtrees concatenated are not double', () => {
    const result = progressOf(catalogue(), [link('adt', 'live')], LIVE, [...ONE, ...ONE])
    expect(result.nodes).toBe(1)
    expect(result.total).toBe(6)
  })

  it('floors an empty population at one, so a panel before its row arrives reads 0 of 6', () => {
    const result = progressOf(catalogue(), [], LIVE, [])
    expect(result.nodes).toBe(1)
    expect(result.total).toBe(6)
  })
})

/* ═══════════════════ the portfolio folds (0026/0027) ═══════════════════ */

function node(over: Partial<MapNode> & Pick<MapNode, 'id'>): MapNode {
  return {
    parent_id: null,
    track_id: 't-uhr',
    kind_id: 'k-org',
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

type StageSeed = Partial<MapNodeStage> & Pick<MapNodeStage, 'id' | 'sort_order'>

function stage(over: StageSeed): MapNodeStage {
  return {
    name: over.id,
    name_ar: '',
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

/** 0026's seed, cut to four rungs — the last one terminal, as the ladder is. */
const NOT_STARTED = stage({ id: 'not-started', sort_order: 1 })
const INTEGRATING = stage({ id: 'integrating', sort_order: 2 })
const READY = stage({ id: 'ready', sort_order: 3 })
const LIVE_STAGE = stage({ id: 'live', sort_order: 4, terminal: true })
/** Paused sits at the END of the ladder in the seed and is NOT terminal. */
const PAUSED = stage({ id: 'paused', sort_order: 5, paused: true })

const LADDER = new Map<string, MapNodeStage>([
  [NOT_STARTED.id, NOT_STARTED],
  [INTEGRATING.id, INTEGRATING],
  [READY.id, READY],
  [LIVE_STAGE.id, LIVE_STAGE],
  [PAUSED.id, PAUSED],
])

/** node id → stage id, the way store/config publishes `map_node_progress`. */
function standing(pairs: Record<string, string | null>): StageIndex {
  const progress = new Map(
    Object.entries(pairs).map(([nodeId, stageId]) => [nodeId, { stage_id: stageId }]),
  )
  return stageIndex(progress, LADDER)
}

const TODAY = '2026-08-13'

describe('stageIndex — the two-step lookup, once', () => {
  it('resolves a node to the rung it stands on', () => {
    expect(standing({ a: 'ready' }).ofNode('a')?.id).toBe('ready')
  })

  it('answers null for no row, for a cleared row and for a retired rung alike', () => {
    // Three different facts that mean one thing to anything counting who has got
    // where: this node is not standing anywhere. The panel tells the first two
    // apart by reading the progress row itself.
    const index = standing({ cleared: null, ghost: 'a-rung-that-was-deleted' })
    expect(index.ofNode('never-recorded')).toBeNull()
    expect(index.ofNode('cleared')).toBeNull()
    expect(index.ofNode('ghost')).toBeNull()
  })
})

describe('foldVendors — one fold, two consumers', () => {
  it('folds three spellings of one integrator into one cohort', () => {
    // Vendor is FREE TEXT by decision (0023:359), so this is the ordinary state
    // of the column rather than a corner case.
    const cohorts = foldVendors([
      node({ id: 'a', vendor: 'Acme' }),
      node({ id: 'b', vendor: 'acme ' }),
      node({ id: 'c', vendor: 'ACME' }),
    ])
    expect(cohorts).toHaveLength(1)
    expect(cohorts[0].nodes.map((n) => n.id)).toEqual(['a', 'b', 'c'])
  })

  it('labels the cohort with the FIRST spelling seen, not the folded one', () => {
    // The label is what somebody typed and what a shared URL should read.
    const cohorts = foldVendors([
      node({ id: 'a', vendor: 'Acme' }),
      node({ id: 'b', vendor: 'acme' }),
    ])
    expect(cohorts[0].label).toBe('Acme')
    expect(cohorts[0].fold).toBe('acme')
  })

  it('skips archived organizations, blank vendors and vendors that fold to nothing', () => {
    const cohorts = foldVendors([
      node({ id: 'gone', vendor: 'Retired Co', archived: true }),
      node({ id: 'blank', vendor: '   ' }),
      // Arabic diacritics alone: `foldArabic` strips the marks, so the fold is
      // empty and the chip would have no label while matching every other such
      // row. (An em-dash is NOT this case — it survives the fold and is a
      // legitimate, if odd, vendor name.)
      node({ id: 'marks', vendor: '\u064B\u064F' }),
      node({ id: 'real', vendor: 'Beta' }),
    ])
    expect(cohorts.map((c) => c.label)).toEqual(['Beta'])
  })

  it('orders by the folded key, by code point, so the runner and the browser agree', () => {
    const cohorts = foldVendors([
      node({ id: 'a', vendor: 'zeta' }),
      node({ id: 'b', vendor: 'Alpha' }),
      node({ id: 'c', vendor: 'mid' }),
    ])
    expect(cohorts.map((c) => c.label)).toEqual(['Alpha', 'mid', 'zeta'])
  })
})

describe('foldPortfolio — one walk, four answers', () => {
  const NODES = [
    node({ id: 'a', account_manager_id: 'am-1', vendor: 'Acme' }),
    node({ id: 'b', account_manager_id: 'am-1', vendor: 'acme' }),
    node({ id: 'c', account_manager_id: 'am-2', vendor: 'Beta' }),
    node({ id: 'd' }),
    node({ id: 'gone', account_manager_id: 'am-1', vendor: 'Acme', archived: true }),
  ]
  const INDEX = standing({ a: 'ready', b: 'live', c: null, gone: 'live' })

  it('buckets by stage, by manager and by vendor, and lists the unstaged', () => {
    const fold = foldPortfolio(NODES, INDEX)
    expect(fold.byStage.get('ready')?.map((n) => n.id)).toEqual(['a'])
    expect(fold.byStage.get('live')?.map((n) => n.id)).toEqual(['b'])
    expect(fold.byManager.get('am-1')?.map((n) => n.id)).toEqual(['a', 'b'])
    expect(fold.byManager.get('am-2')?.map((n) => n.id)).toEqual(['c'])
    expect(fold.byVendor.get('acme')?.nodes.map((n) => n.id)).toEqual(['a', 'b'])
    // `c` has a progress row whose stage was CLEARED and `d` has no row at all.
    // Both are unstaged; neither is "Not started", which is a rung somebody
    // picks (0026 ships no backfill on purpose).
    expect(fold.unstaged.map((n) => n.id)).toEqual(['c', 'd'])
  })

  it('gives the organizations nobody is named on their own bucket, keyed null', () => {
    // "Who owns these" is the first question the workload answer produces, so
    // the null key is the point rather than an error case.
    expect(foldPortfolio(NODES, INDEX).byManager.get(null)?.map((n) => n.id)).toEqual(['d'])
  })

  it('gives every rung in the ladder a bucket, empty ones included, in ladder order', () => {
    // "Nobody is at Testing/UAT" is a fact the ladder has to be able to show; a
    // missing key makes it indistinguishable from a rung that does not exist.
    const fold = foldPortfolio(NODES, INDEX)
    expect([...fold.byStage.keys()]).toEqual([...LADDER.keys()])
    expect(fold.byStage.get('integrating')).toEqual([])
  })

  it('leaves archived organizations out of every answer', () => {
    const fold = foldPortfolio(NODES, INDEX)
    const everyone = [
      ...[...fold.byStage.values()].flat(),
      ...[...fold.byManager.values()].flat(),
      ...[...fold.byVendor.values()].flatMap((c) => c.nodes),
      ...fold.unstaged,
    ].map((n) => n.id)
    expect(everyone).not.toContain('gone')
  })

  it('agrees with the picker, because it is the same fold', () => {
    // The invariant the extraction exists for: FilterBar offers a chip per
    // cohort and this counts the cohort. Two copies of the rule is how the chip
    // comes to describe a different set from the number beside it.
    const fold = foldPortfolio(NODES, INDEX)
    expect([...fold.byVendor.keys()]).toEqual(foldVendors(NODES).map((c) => c.fold))
  })
})

describe('progressByNode', () => {
  it('gives an entry to every organization, including one that recorded nothing', () => {
    // The exception list is the point of the portfolio: an organization missing
    // from this map is a row missing from "who has recorded nothing".
    const map = progressByNode(
      [link('adt', 'live', 'a')],
      [node({ id: 'a' }), node({ id: 'silent' })],
      catalogue(),
      LIVE,
    )
    expect([...map.keys()]).toEqual(['a', 'silent'])
    expect(map.get('silent')?.done).toBe(0)
    expect(map.get('silent')?.total).toBe(6)
    expect(map.get('silent')?.linked).toBe(0)
  })

  it('does not leak one organization’s links into another’s number', () => {
    const map = progressByNode(
      [link('adt', 'live', 'a'), link('rx1', 'live', 'b'), link('rad', 'live', 'b')],
      [node({ id: 'a' }), node({ id: 'b' })],
      catalogue(),
      LIVE,
    )
    expect(map.get('a')?.done).toBe(1)
    expect(map.get('b')?.done).toBe(2)
  })
})

describe('goalProgress — a date goal is about the node itself', () => {
  const DATE_GOAL = { stage_id: null, target: null, target_date: '2026-12-31' }

  it('is met when the node reaches a TERMINAL rung, whatever it is called', () => {
    const met = goalProgress(DATE_GOAL, { id: 'org' }, [], standing({ org: 'live' }), TODAY)
    expect(met.reached).toBe(1)
    expect(met.met).toBe(true)

    const notYet = goalProgress(DATE_GOAL, { id: 'org' }, [], standing({ org: 'ready' }), TODAY)
    expect(notYet.reached).toBe(0)
    expect(notYet.met).toBe(false)
  })

  it('counts an unstaged node as unstaged rather than as a failure', () => {
    // "0 of 1 — nobody has recorded a stage" and "0 of 1 — it is at Kickoff" are
    // two different sentences and the second sends somebody to the wrong desk.
    const result = goalProgress(DATE_GOAL, { id: 'org' }, [], standing({}), TODAY)
    expect(result.eligible).toBe(0)
    expect(result.unstaged).toBe(1)
    expect(result.met).toBe(false)
  })

  it('reads a stage-qualified date goal as "that rung OR BEYOND"', () => {
    const goal = { stage_id: 'ready', target: null, target_date: '2026-12-31' }
    expect(goalProgress(goal, { id: 'o' }, [], standing({ o: 'ready' }), TODAY).met).toBe(true)
    // Beyond: live sorts after ready.
    expect(goalProgress(goal, { id: 'o' }, [], standing({ o: 'live' }), TODAY).met).toBe(true)
    // Short of it.
    const short = goalProgress(goal, { id: 'o' }, [], standing({ o: 'integrating' }), TODAY)
    expect(short.met).toBe(false)
  })

  it('counts days left, negative when the date has passed', () => {
    expect(goalProgress(DATE_GOAL, { id: 'o' }, [], standing({}), '2026-12-01').daysLeft).toBe(30)
    expect(goalProgress(DATE_GOAL, { id: 'o' }, [], standing({}), '2027-01-10').daysLeft).toBe(-10)
  })
})

describe('goalProgress — a count goal is about what is beneath', () => {
  const BENEATH = [
    node({ id: 'a' }),
    node({ id: 'b' }),
    node({ id: 'c' }),
    node({ id: 'd' }),
    node({ id: 'gone', archived: true }),
  ]
  const COUNT_GOAL = { stage_id: null, target: 3, target_date: '2026-12-31' }

  it('counts the descendants at a terminal rung, and carries the unstaged separately', () => {
    const index = standing({ a: 'live', b: 'live', c: 'ready', gone: 'live' })
    const result = goalProgress(COUNT_GOAL, { id: 'phase' }, BENEATH, index, TODAY)

    expect(result.target).toBe(3)
    expect(result.reached).toBe(2)
    expect(result.eligible).toBe(3)
    // `d` has no row. "2 of 3 — one organization has no stage recorded" is the
    // true sentence; "2 of 3" alone sends an AD chasing the wrong thing.
    expect(result.unstaged).toBe(1)
    expect(result.met).toBe(false)
  })

  it('leaves ARCHIVED descendants out of the count that met it', () => {
    // `gone` is live and would carry the goal over the line on its own.
    const index = standing({ a: 'live', b: 'live', gone: 'live' })
    expect(goalProgress(COUNT_GOAL, { id: 'phase' }, BENEATH, index, TODAY).met).toBe(false)
  })

  it('counts "or beyond" by SORT ORDER, never by the rung’s name', () => {
    const goal = { stage_id: 'ready', target: 2, target_date: '2026-12-31' }
    // ready (3), live (4) and paused (5) all sort at or beyond ready. That
    // coupling is 0027's own: reordering the ladder restates this goal.
    const index = standing({ a: 'ready', b: 'live', c: 'integrating', d: 'paused' })
    const result = goalProgress(goal, { id: 'phase' }, BENEATH, index, TODAY)
    expect(result.reached).toBe(3)
    expect(result.met).toBe(true)
  })

  it('falls back to the TERMINAL reading when the goal’s rung was retired', () => {
    // 0027's `on delete set null` gives the database the same answer, so the two
    // agree in the window where a client still holds a goal naming a dead rung.
    const goal = { stage_id: 'a-rung-that-was-deleted', target: 2, target_date: '2026-12-31' }
    const index = standing({ a: 'live', b: 'live', c: 'ready', d: 'ready' })
    expect(goalProgress(goal, { id: 'phase' }, BENEATH, index, TODAY).reached).toBe(2)
  })

  it('reads against the node itself when NO descendant is staged', () => {
    // The leaf Organization somebody put a target on, and the Phase whose
    // children nobody has staged yet: reporting a permanent 0 of 3 against an
    // empty population would be a number with nothing behind it.
    const index = standing({ phase: 'live' })
    const result = goalProgress(COUNT_GOAL, { id: 'phase' }, BENEATH, index, TODAY)
    expect(result.reached).toBe(1)
    expect(result.eligible).toBe(1)
    expect(result.unstaged).toBe(0)
  })

  it('switches to the descendants the moment ONE of them is staged', () => {
    const index = standing({ phase: 'live', a: 'integrating' })
    const result = goalProgress(COUNT_GOAL, { id: 'phase' }, BENEATH, index, TODAY)
    expect(result.reached).toBe(0)
    expect(result.eligible).toBe(1)
    expect(result.unstaged).toBe(3)
  })

  it('is met on the count, not on the date — an overdue goal can still be met', () => {
    const index = standing({ a: 'live', b: 'live', c: 'live' })
    const result = goalProgress(COUNT_GOAL, { id: 'phase' }, BENEATH, index, '2027-06-01')
    expect(result.met).toBe(true)
    expect(result.daysLeft).toBeLessThan(0)
  })
})
