// The portfolio's arithmetic — and the four ways it could be wrong in a way
// nobody would notice for a month.
//
// Each `describe` below is named after a FAILURE rather than after a function,
// on mapNodes.test.ts's rule, because the risk here is never "does 3 + 4 make
// 7". It is:
//
//   · THE POPULATION. An organization with nothing open, or nothing recorded, is
//     precisely the one an account manager is employed to notice — and it is the
//     one a builder that walked `map_node_use_cases`, or filtered to `count > 0`,
//     would silently drop. The exception list would then be an exception list of
//     the organizations that are already being worked on.
//   · THE BADGE AND THE LIST. The chip says 18 and the table shows 17. Both
//     numbers are computed from the same tree by two functions, and the whole
//     point of `stageReading` being shared is that this test can pin them equal.
//   · NULL AS ZERO. "Nobody has said where this is" rendered as "0 days in
//     stage" reports 400 un-started organizations as having just been moved.
//   · THE CLOCK THAT WILL NOT STOP. A hospital that went live 300 days ago at
//     the top of the stalled list, every morning, forever — the failure
//     lib/lifecycle.ts's terminal/paused contract exists to prevent, seen from
//     the table that would print it.
//
// PURE MODULE, PLAIN TEST: no store, no clock, no DOM, no `vi.hoisted`. `now`
// and `today` are fixtures, which is what lets "is it stalled on 3 March" be a
// question with one answer.

import { describe, expect, it } from 'vitest'
import {
  buildPortfolioRows,
  comparePortfolioRows,
  countAtRisk,
  filterForBucket,
  filterForOrgRow,
  inPortfolioScope,
  PORTFOLIO_SCOPE_ALL,
  portfolioRowsFor,
  portfolioShowsRows,
  rollUpPortfolio,
  type PortfolioInput,
  type PortfolioRow,
  type PortfolioScope,
} from './rows'
import { compareText } from '../mindtree/tableSort'
import { EMPTY_FILTER, MANAGER_NONE, type FilterState } from '../entryFilter'
import { stageIndex } from '../mapNodes'
import type { MindNode } from '../mindtree/model'
import type { Entry, MapNode, MapNodeProgress, MapNodeStage } from '../../types'

/* ────────────────────────────── fixtures ────────────────────────────── */

/** 12:00 UTC so a fixture cannot be moved a day by the runner's own offset. */
const NOW = new Date('2026-03-10T12:00:00.000Z')
const TODAY = '2026-03-10'

function stage(over: Partial<MapNodeStage> & Pick<MapNodeStage, 'id' | 'name' | 'sort_order'>): MapNodeStage {
  return {
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

/** The seeded ladder, cut to the five rungs the cases need. */
function ladder(): MapNodeStage[] {
  return [
    stage({ id: 'kick', name: 'Kickoff', sort_order: 1, expected_days: 30 }),
    stage({ id: 'integ', name: 'Integrating', sort_order: 2, expected_days: 60 }),
    stage({ id: 'hold', name: 'Paused', sort_order: 3, paused: true, expected_days: 10 }),
    stage({ id: 'live', name: 'Live', sort_order: 4, terminal: true, expected_days: 10 }),
    // No expectation on this rung — 0026 seeds every rung this way.
    stage({ id: 'uat', name: 'Testing/UAT', sort_order: 5 }),
  ]
}

function node(over: Partial<MapNode> & Pick<MapNode, 'id' | 'name'>): MapNode {
  return {
    parent_id: null,
    track_id: 'trk',
    kind_id: 'org',
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
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    created_by: null,
    ...over,
  }
}

/**
 * A progress row. `updated_by` defaults to A PERSON on purpose: `fields.ts`
 * reads a null as "a service-role script wrote this row, so `stage_changed_at`
 * is the script's clock and not the organization's", and these tests are about
 * what the ladder does once somebody HAS said where an organization is. A
 * fixture left at null would turn every assertion here into an assertion about
 * unwitnessed clocks, quietly. Pass null to test that case.
 */
function progress(
  nodeId: string,
  stageId: string | null,
  changedAt: string | null,
  updatedBy: string | null = 'person-1',
): MapNodeProgress {
  return {
    node_id: nodeId,
    stage_id: stageId,
    stage_changed_at: changedAt,
    updated_at: '2026-01-01T00:00:00.000Z',
    updated_by: updatedBy,
  }
}

/** A tree node. `entity` carries its map-node id in `bucketKey` — model.ts's shape. */
function mind(over: Partial<MindNode> & Pick<MindNode, 'id' | 'kind'>): MindNode {
  return {
    label: { kind: 'text', text: over.id },
    count: 0,
    colourVars: {},
    health: { level: 'ok', slaBreached: false, overdue: false, stale: false },
    children: [],
    collapsed: false,
    depth: 0,
    entryId: null,
    bucketKey: null,
    entityType: null,
    retired: false,
    ...over,
  } as MindNode
}

function entity(id: string, over: Partial<MindNode> = {}): MindNode {
  return mind({ id: `entity:${id}`, kind: 'entity', bucketKey: id, label: { kind: 'text', text: id }, ...over })
}

/**
 * THE WORKSPACE EVERY CASE READS.
 *
 *   UHR (track)
 *     OB (entity — the Phase)
 *       riyadh    Kickoff,     stamped 2026-01-01  → 68 days, over 30  ⇒ AT RISK
 *       jeddah    Integrating, stamped 2026-03-01  → 9 days,  under 60 ⇒ ok
 *       dammam    Live,        stamped 2025-01-01  → 433 days           ⇒ terminal, ok
 *       tabuk     Paused,      stamped 2025-06-01  → 282 days           ⇒ paused, ok
 *       hail      no row at all                                        ⇒ unstaged
 *       najran    Testing/UAT, stamped 2025-01-01  → no expectation     ⇒ ok
 *
 * Six organizations, one at risk, one unstaged — small enough to count by hand
 * and wide enough that every branch of the clock contract has a row.
 */
function tree(): MindNode {
  const phase = entity('ob', {
    count: 21,
    children: [
      entity('riyadh', { count: 4 }),
      entity('jeddah', { count: 9 }),
      entity('dammam', { count: 0 }),
      entity('tabuk', { count: 3 }),
      entity('hail', { count: 0 }),
      entity('najran', { count: 5 }),
    ],
  })
  return mind({
    id: 'root',
    kind: 'root',
    count: 21,
    children: [mind({ id: 'track:uhr', kind: 'track', bucketKey: 'uhr', label: { kind: 'text', text: 'UHR' }, count: 21, children: [phase] })],
  })
}

function nodeMap(): Map<string, MapNode> {
  return new Map(
    [
      node({ id: 'ob', name: 'OB' }),
      node({ id: 'riyadh', name: 'Riyadh General', account_manager_id: 'sara', vendor: 'Acme' }),
      node({ id: 'jeddah', name: 'Jeddah Central', account_manager_id: 'sara', vendor: 'acme ' }),
      node({ id: 'dammam', name: 'Dammam East', account_manager_id: 'bandar', vendor: 'Northwind' }),
      node({ id: 'tabuk', name: 'Tabuk North', account_manager_id: 'bandar', vendor: '' }),
      node({ id: 'hail', name: 'Hail Regional', account_manager_id: null, vendor: 'Acme' }),
      node({ id: 'najran', name: 'Najran South', account_manager_id: 'sara', vendor: 'Northwind' }),
    ].map((n) => [n.id, n]),
  )
}

function progressMap(): Map<string, MapNodeProgress> {
  return new Map(
    [
      progress('riyadh', 'kick', '2026-01-01T00:00:00.000Z'),
      progress('jeddah', 'integ', '2026-03-01T00:00:00.000Z'),
      progress('dammam', 'live', '2025-01-01T00:00:00.000Z'),
      progress('tabuk', 'hold', '2025-06-01T00:00:00.000Z'),
      progress('najran', 'uat', '2025-01-01T00:00:00.000Z'),
    ].map((p) => [p.node_id, p]),
  )
}

const NAMES: Record<string, string> = { sara: 'Sara', bandar: 'Bandar' }

function input(over: Partial<PortfolioInput> = {}): PortfolioInput {
  const stages = ladder()
  const nodes = nodeMap()
  return {
    root: tree(),
    nodeById: nodes,
    stages: stageIndex(progressMap(), new Map(stages.map((s) => [s.id, s]))),
    progressById: progressMap(),
    fallbackStallDays: null,
    labelOf: (n) => (n.label.kind === 'text' ? n.label.text : n.label.key),
    listSep: ', ',
    stageNameOf: (s) => s.name,
    managerNameOf: (id) => (id === null ? null : (NAMES[id] ?? 'Someone who left')),
    vendorOfNode: new Map([...nodes.values()].map((n) => [n.id, n.vendor])),
    // EMPTY BY DEFAULT, and every existing expectation in this file depends on
    // that: a missing key falls back to the row's own `account_manager_id`,
    // which is exactly what the builder read before inheritance arrived. A case
    // that wants the inherited person supplies the map itself.
    managerOfNode: new Map<string, string | null>(),
    progressByNode: null,
    entryById: new Map<string, Entry>(),
    today: TODAY,
    now: NOW,
    ...over,
  }
}

function byId(rows: readonly PortfolioRow[], id: string): PortfolioRow {
  const found = rows.find((r) => r.nodeId === id)
  if (found === undefined) throw new Error(`no row for ${id}`)
  return found
}

function filter(over: Partial<FilterState> = {}): FilterState {
  return { ...EMPTY_FILTER, ...over }
}

/* ───────────────────────── the population ───────────────────────── */

describe('an organization with nothing on it must still get a row', () => {
  it('emits one row per entity node, zero-count and unstaged included', () => {
    const rows = buildPortfolioRows(input())
    expect(rows.map((r) => r.nodeId)).toEqual([
      'ob',
      'riyadh',
      'jeddah',
      'dammam',
      'tabuk',
      'hail',
      'najran',
    ])
    // The two that a `count > 0` or a links-driven walk would have dropped.
    expect(byId(rows, 'hail').open).toBe(0)
    expect(byId(rows, 'hail').stageId).toBeNull()
    expect(byId(rows, 'dammam').open).toBe(0)
  })

  it('reads `open` off the node the picture drew, never off a second walk', () => {
    const rows = buildPortfolioRows(input())
    expect(byId(rows, 'jeddah').open).toBe(9)
    // The Phase carries the roll-up its own node carries — 21, not the 21 this
    // test could have re-summed. Changing the node's count changes the row.
    expect(byId(rows, 'ob').open).toBe(21)
  })

  it('recurses through an entity that holds entities', () => {
    // The whole hierarchy is arbitrary-depth: an Organization can hold
    // Organizations, and a two-level walk would drop the deeper ones.
    const deep = tree()
    const phase = deep.children[0].children[0]
    phase.children[0].children.push(entity('riyadh-annex', { count: 2 }))
    const nodes = nodeMap()
    nodes.set('riyadh-annex', node({ id: 'riyadh-annex', name: 'Riyadh Annex' }))
    const rows = buildPortfolioRows(input({ root: deep, nodeById: nodes }))
    expect(rows.map((r) => r.nodeId)).toContain('riyadh-annex')
    expect(byId(rows, 'riyadh-annex').trailLabel).toBe('UHR, ob, riyadh')
    expect(byId(rows, 'riyadh-annex').parentId).toBe('riyadh')
  })

  it('marks an archived path rather than dropping it', () => {
    const archived = tree()
    archived.children[0].children[0].children[0].retired = true
    const rows = buildPortfolioRows(input({ root: archived }))
    expect(byId(rows, 'riyadh').retired).toBe(true)
    expect(byId(rows, 'jeddah').retired).toBe(false)
  })

  it('carries the trail as PARTS as well as a joined sort key', () => {
    const rows = buildPortfolioRows(input())
    expect(byId(rows, 'riyadh').trailParts).toEqual(['UHR', 'ob'])
    expect(byId(rows, 'riyadh').trailLabel).toBe('UHR, ob')
    // The separator is injected, so the table punctuates a path the way the
    // locale does rather than the way this module guessed.
    const arabic = buildPortfolioRows(input({ listSep: '، ' }))
    expect(byId(arabic, 'riyadh').trailLabel).toBe('UHR، ob')
  })
})

/* ───────────────────────── the clock contract ───────────────────────── */

describe('the clock stops where lib/lifecycle says it stops', () => {
  it('flags only the organization genuinely past its rung', () => {
    const rows = buildPortfolioRows(input())
    expect(rows.filter((r) => r.atRisk).map((r) => r.nodeId)).toEqual(['riyadh'])
    expect(byId(rows, 'riyadh').daysInStage).toBe(68)
    expect(byId(rows, 'riyadh').stallDays).toBe(30)
  })

  it('does not put a hospital that went live 433 days ago at the top of the list', () => {
    const rows = buildPortfolioRows(input())
    const dammam = byId(rows, 'dammam')
    expect(dammam.daysInStage).toBe(433)
    expect(dammam.atRisk).toBe(false)
  })

  it('does not raise a paused organization as an alarm every morning', () => {
    const rows = buildPortfolioRows(input())
    const tabuk = byId(rows, 'tabuk')
    expect(tabuk.daysInStage).toBe(282)
    expect(tabuk.atRisk).toBe(false)
  })

  it('says nothing about a rung with no expectation', () => {
    const rows = buildPortfolioRows(input())
    expect(byId(rows, 'najran').stallDays).toBeNull()
    expect(byId(rows, 'najran').atRisk).toBe(false)
  })

  it('takes the workspace fallback where the rung is silent, and never over it', () => {
    const rows = buildPortfolioRows(input({ fallbackStallDays: 90 }))
    // Najran's rung has no number, so the floor applies and 433 days breaches it.
    expect(byId(rows, 'najran').stallDays).toBe(90)
    expect(byId(rows, 'najran').atRisk).toBe(true)
    // Jeddah's rung says 60 and the floor must not overrule it: 9 days is fine.
    expect(byId(rows, 'jeddah').stallDays).toBe(60)
    expect(byId(rows, 'jeddah').atRisk).toBe(false)
    // Terminal and paused still stop the clock under a floor.
    expect(byId(rows, 'dammam').atRisk).toBe(false)
    expect(byId(rows, 'tabuk').atRisk).toBe(false)
  })

  it('proves the assertion can fail: raise the expectation and the list empties', () => {
    const stages = ladder().map((s) => (s.id === 'kick' ? { ...s, expected_days: 400 } : s))
    const rows = buildPortfolioRows(
      input({ stages: stageIndex(progressMap(), new Map(stages.map((s) => [s.id, s]))) }),
    )
    expect(rows.filter((r) => r.atRisk)).toEqual([])
  })
})

describe('the badge and the list are one number', () => {
  it('countAtRisk equals the rows it would have built', () => {
    const args = input()
    const rows = buildPortfolioRows(args)
    expect(countAtRisk(args.root, { ...args, scope: PORTFOLIO_SCOPE_ALL })).toBe(rows.filter((r) => r.atRisk).length)
    expect(countAtRisk(args.root, { ...args, scope: PORTFOLIO_SCOPE_ALL })).toBe(1)
  })

  it('stays equal when the ladder changes underneath both', () => {
    const args = input({ fallbackStallDays: 90 })
    const rows = buildPortfolioRows(args)
    expect(countAtRisk(args.root, { ...args, scope: PORTFOLIO_SCOPE_ALL })).toBe(rows.filter((r) => r.atRisk).length)
    expect(countAtRisk(args.root, { ...args, scope: PORTFOLIO_SCOPE_ALL })).toBe(2)
  })

  /**
   * THE ORGANIZATION WITH NOTHING OPEN IS THE ONE THE TWO FOLDS DRIFT ON, and
   * the two cases above cannot see it: every at-risk row in the base fixture has
   * open work, so a `count > 0` creeping into either walk leaves both numbers
   * unchanged and the suite green. It was checked by mutation and it was green,
   * which is why this case exists.
   *
   * It is also the population the exception list is FOR — the header's first
   * named failure. A hospital nobody has filed a single item against, parked on
   * Kickoff since January, is exactly the organization an account manager is
   * employed to notice, and it is the one a builder that walked the work instead
   * of the hierarchy would drop from both the chip and the table at once.
   */
  it('counts an at-risk organization with NOTHING open — in the badge and in the list', () => {
    // `hail` has `count: 0` in the tree and no progress row. Give it one, stamped
    // where `riyadh`'s is, and it becomes at risk with an empty work column.
    const rows0 = buildPortfolioRows(input())
    expect(byId(rows0, 'hail').open).toBe(0)

    const withHail = new Map(progressMap())
    withHail.set('hail', progress('hail', 'kick', '2026-01-01T00:00:00.000Z'))
    const stages = ladder()
    const args = input({
      progressById: withHail,
      stages: stageIndex(withHail, new Map(stages.map((s) => [s.id, s]))),
    })

    const rows = buildPortfolioRows(args)
    expect(byId(rows, 'hail').atRisk).toBe(true)
    expect(byId(rows, 'hail').open).toBe(0)
    expect(countAtRisk(args.root, { ...args, scope: PORTFOLIO_SCOPE_ALL })).toBe(rows.filter((r) => r.atRisk).length)
    expect(countAtRisk(args.root, { ...args, scope: PORTFOLIO_SCOPE_ALL })).toBe(2)
  })
})

/* ───────────────────────── null is not zero ───────────────────────── */

describe('null and zero are different answers', () => {
  it('an unstaged organization has no rung, no days and no expectation', () => {
    const hail = byId(buildPortfolioRows(input()), 'hail')
    expect(hail.stageId).toBeNull()
    expect(hail.stageName).toBeNull()
    expect(hail.stageOrder).toBeNull()
    expect(hail.daysInStage).toBeNull()
    expect(hail.atRisk).toBe(false)
  })

  it('a cleared stage_id is still no rung, and a null stamp is still no clock', () => {
    // 0026 keeps the two in step: `stage_id` null ⇒ `stage_changed_at` null.
    const cleared = progressMap()
    cleared.set('jeddah', progress('jeddah', null, null))
    const stages = ladder()
    const rows = buildPortfolioRows(
      input({
        progressById: cleared,
        stages: stageIndex(cleared, new Map(stages.map((s) => [s.id, s]))),
      }),
    )
    expect(byId(rows, 'jeddah').stageId).toBeNull()
    expect(byId(rows, 'jeddah').daysInStage).toBeNull()
  })

  it('quiet is null for an organization nothing has ever been filed under', () => {
    expect(byId(buildPortfolioRows(input()), 'hail').quietDays).toBeNull()
  })

  it('quiet is the QUIETEST leaf under the node, walked through collapsed branches', () => {
    const withWork = tree()
    const riyadh = withWork.children[0].children[0].children[0]
    riyadh.collapsed = true
    riyadh.children.push(
      mind({ id: 'e1', kind: 'entry', entryId: 'e1' }),
      mind({ id: 'e2', kind: 'entry', entryId: 'e2' }),
    )
    const entries = new Map<string, Entry>([
      ['e1', { last_activity_at: '2026-01-05T00:00:00.000Z' } as Entry],
      ['e2', { last_activity_at: '2026-03-08T00:00:00.000Z' } as Entry],
    ])
    const rows = buildPortfolioRows(input({ root: withWork, entryById: entries }))
    // The most recently touched item is what "how quiet is this" means: two
    // days, not the sixty-four of the older one.
    expect(byId(rows, 'riyadh').quietDays).toBe(2)
  })

  it('folds quiet through a status GROUP, not only through direct children', () => {
    /* THE RECURSION THE ONE-PASS REWRITE HAD TO KEEP. Quiet used to be a helper
       called once per organization that walked the whole subtree, so it reached
       through a `group` for free; the fold now lives in the row walk, which
       SKIPS groups because a status bucket is not a place and gets no row. If
       it skipped them for the fold as well, every organization whose items are
       bucketed by status — which is the map's default dimension — would report
       "nothing has ever been filed here". Nothing pinned that before. */
    const withWork = tree()
    const riyadh = withWork.children[0].children[0].children[0]
    riyadh.children.push(
      mind({
        id: 'group:blocked',
        kind: 'group',
        bucketKey: 'blocked',
        children: [
          mind({ id: 'e1', kind: 'entry', entryId: 'e1' }),
          mind({ id: 'e2', kind: 'entry', entryId: 'e2' }),
        ],
      }),
    )
    const entries = new Map<string, Entry>([
      ['e1', { last_activity_at: '2026-01-05T00:00:00.000Z' } as Entry],
      ['e2', { last_activity_at: '2026-03-08T00:00:00.000Z' } as Entry],
    ])
    const rows = buildPortfolioRows(input({ root: withWork, entryById: entries }))
    expect(byId(rows, 'riyadh').quietDays).toBe(2)
    // And it keeps climbing: the Phase above it is as quiet as its quietest
    // organization, which is what makes a roll-up row mean anything.
    expect(byId(rows, 'ob').quietDays).toBe(2)
  })

  it('leaves an ancestor null when nothing at all is filed beneath it', () => {
    // `minQuiet` propagates null rather than collapsing it to zero, which is
    // the difference between "nobody has touched this in 0 days" and "nobody
    // has ever filed anything here".
    const rows = buildPortfolioRows(input())
    expect(byId(rows, 'ob').quietDays).toBeNull()
  })
})

/* ─────────────────── the inherited account manager ─────────────────── */

describe('one person, however far up the chain they sit', () => {
  it('buckets by the INHERITED manager — the same person the filter admits', () => {
    /* THE DEFECT THIS CLOSES. `inPortfolioScope` admits an organization by the
       INHERITED manager (`FilterContext.managerOfNode`, store/entries' one
       ancestor walk) while `bucketOf(row, 'manager')` bucketed it by the RAW
       column. So `?manager=sara&by=manager` narrowed to Sara's book and then
       filed the inherited half of it under "Nobody named" — a roll-up whose
       one visible row contradicted the filter that produced it. */
    const inherited = new Map<string, string | null>([['hail', 'sara']])
    const rows = buildPortfolioRows(input({ managerOfNode: inherited }))
    const hail = byId(rows, 'hail')
    // The raw column is still null; the ROW says Sara, because the chain does.
    expect(nodeMap().get('hail')?.account_manager_id).toBeNull()
    expect(hail.managerId).toBe('sara')
    expect(hail.managerName).toBe('Sara')

    const groups = rollUpPortfolio(rows, 'manager', ladder(), (st) => st.name)
    const sara = groups.find((g) => g.key === 'sara')
    expect(sara?.nodeIds).toContain('hail')
    expect(groups.find((g) => g.unnamed)?.nodeIds ?? []).not.toContain('hail')
  })

  it('admits the same organization it buckets, under ?manager=', () => {
    const inherited = new Map<string, string | null>([
      ['hail', 'sara'],
      ['riyadh', 'sara'],
      ['jeddah', 'sara'],
      ['najran', 'sara'],
      ['dammam', 'bandar'],
      ['tabuk', 'bandar'],
      ['ob', null],
    ])
    const rows = buildPortfolioRows(input({ managerOfNode: inherited }))
    const scope: PortfolioScope = {
      ...PORTFOLIO_SCOPE_ALL,
      managerIds: ['sara'],
      managerOfNode: inherited,
    }
    const seen = portfolioRowsFor(rows, { by: 'manager', risk: false, as: 'table' }, scope).map((r) => r.nodeId)
    expect(seen).toContain('hail')
    // One rule, one map: what the filter admits is what the roll-up buckets.
    expect(byId(rows, 'hail').managerId).toBe('sara')
  })

  it('falls back to the row when the chain has no answer for a node', () => {
    // An ABSENT key is a cold start, not an unassigned organization: the raw
    // column stands in rather than four hundred rows moving to "Nobody named".
    const rows = buildPortfolioRows(input({ managerOfNode: new Map() }))
    expect(byId(rows, 'riyadh').managerId).toBe('sara')
    expect(byId(rows, 'hail').managerId).toBeNull()
  })
})

/* ───────────────────────── the vendor fold ───────────────────────── */

describe('one integrator, however it was typed', () => {
  it('folds Acme and "acme " into one cohort key and keeps the first spelling', () => {
    const rows = buildPortfolioRows(input())
    expect(byId(rows, 'riyadh').vendorFold).toBe(byId(rows, 'jeddah').vendorFold)
    expect(byId(rows, 'riyadh').vendor).toBe('Acme')
    const cohorts = rollUpPortfolio(rows, 'vendor', ladder(), (s) => s.name)
    const acme = cohorts.find((c) => c.label === 'Acme')
    expect(acme?.orgs).toBe(3)
  })

  it('a blank vendor is the unnamed bucket, not a cohort called ""', () => {
    const rows = buildPortfolioRows(input())
    expect(byId(rows, 'tabuk').vendorFold).toBe('')
    const cohorts = rollUpPortfolio(rows, 'vendor', ladder(), (s) => s.name)
    expect(cohorts[cohorts.length - 1].unnamed).toBe(true)
    // OB (the Phase) has no vendor either, so the bucket holds two.
    expect(cohorts[cohorts.length - 1].orgs).toBe(2)
  })

  it('takes the EFFECTIVE vendor from the caller, not the node’s own column', () => {
    const nodes = nodeMap()
    const rows = buildPortfolioRows(
      input({
        nodeById: nodes,
        // An organization whose own column is blank but which sits under a
        // vendor: the inherited answer is the one the filter uses, so it is the
        // one this table must show.
        vendorOfNode: new Map([...nodes.values()].map((n) => [n.id, n.id === 'tabuk' ? 'Northwind' : n.vendor])),
      }),
    )
    expect(byId(rows, 'tabuk').vendor).toBe('Northwind')
  })
})

/* ───────────────────────── the roll-up ───────────────────────── */

describe('the roll-up', () => {
  it('gives every rung a bucket in the ladder’s order, empty ones included', () => {
    const rows = buildPortfolioRows(input())
    const buckets = rollUpPortfolio(rows, 'stage', ladder(), (s) => s.name)
    expect(buckets.map((b) => b.label)).toEqual([
      'Kickoff',
      'Integrating',
      'Paused',
      'Live',
      'Testing/UAT',
      '',
    ])
    // "Nobody is at Testing/UAT" must be sayable — and here somebody is, so the
    // empty one is the rung nobody stands on.
    expect(buckets.find((b) => b.label === 'Kickoff')?.orgs).toBe(1)
  })

  it('pins the unnamed bucket last under every grouping', () => {
    const rows = buildPortfolioRows(input())
    for (const by of ['stage', 'manager', 'vendor', 'phase'] as const) {
      const buckets = rollUpPortfolio(rows, by, ladder(), (s) => s.name)
      expect(buckets[buckets.length - 1].unnamed).toBe(true)
      expect(buckets.slice(0, -1).every((b) => !b.unnamed)).toBe(true)
    }
  })

  it('sums the organizations to the whole population under every grouping', () => {
    const rows = buildPortfolioRows(input())
    for (const by of ['stage', 'manager', 'vendor', 'phase'] as const) {
      const buckets = rollUpPortfolio(rows, by, ladder(), (s) => s.name)
      expect(buckets.reduce((n, b) => n + b.orgs, 0)).toBe(rows.length)
    }
  })

  it('reports the MEDIAN days, so one parked organization does not colour a cohort', () => {
    const rows = buildPortfolioRows(input())
    const books = rollUpPortfolio(rows, 'manager', ladder(), (s) => s.name)
    const sara = books.find((b) => b.label === 'Sara')
    // Riyadh 68, Jeddah 9, Najran 433 → median 68, mean would be 170.
    expect(sara?.medianDays).toBe(68)
    expect(sara?.orgs).toBe(3)
    expect(sara?.atRisk).toBe(1)
  })

  it('has no median for a bucket where nobody has a recorded rung', () => {
    const rows = buildPortfolioRows(input())
    const books = rollUpPortfolio(rows, 'manager', ladder(), (s) => s.name)
    const nobody = books[books.length - 1]
    // Hail (unstaged) and OB (unstaged) are the only two with no manager.
    expect(nobody.medianDays).toBeNull()
  })

  it('names the largest NON-TERMINAL block — the "one fix unblocks N" number', () => {
    // Three of Acme's organizations, two of them parked on one rung.
    const nodes = nodeMap()
    const stages = ladder()
    const p = progressMap()
    p.set('hail', progress('hail', 'kick', '2026-02-01T00:00:00.000Z'))
    const rows = buildPortfolioRows(
      input({
        nodeById: nodes,
        progressById: p,
        stages: stageIndex(p, new Map(stages.map((s) => [s.id, s]))),
      }),
    )
    const acme = rollUpPortfolio(rows, 'vendor', stages, (s) => s.name).find((b) => b.label === 'Acme')
    expect(acme?.largestBlock).toBe(2)
    expect(acme?.largestBlockLabel).toBe('Kickoff')
  })

  it('never counts a terminal rung as a block', () => {
    const rows = buildPortfolioRows(input())
    const northwind = rollUpPortfolio(rows, 'vendor', ladder(), (s) => s.name).find(
      (b) => b.label === 'Northwind',
    )
    // Dammam is Live (terminal) and Najran is Testing/UAT — so the block is 1,
    // not the 2 a naive "most common rung" would report.
    expect(northwind?.largestBlock).toBe(1)
    expect(northwind?.largestBlockLabel).toBe('Testing/UAT')
  })

  it('drops a hidden rung nobody stands on and keeps one somebody does', () => {
    const stages = ladder().map((s) => (s.id === 'uat' ? { ...s, hidden: true } : s))
    const rows = buildPortfolioRows(input())
    const shown = rollUpPortfolio(rows, 'stage', stages, (s) => s.name)
    expect(shown.map((b) => b.label)).toContain('Testing/UAT')

    const empty = rollUpPortfolio(
      rows.filter((r) => r.nodeId !== 'najran'),
      'stage',
      stages,
      (s) => s.name,
    )
    expect(empty.map((b) => b.label)).not.toContain('Testing/UAT')
  })

  it('carries no progress at all rather than a proud zero', () => {
    const rows = buildPortfolioRows(input())
    const buckets = rollUpPortfolio(rows, 'stage', ladder(), (s) => s.name)
    expect(buckets.every((b) => b.done === null && b.total === null)).toBe(true)
  })

  it('sums progress once the links have landed', () => {
    const rows = buildPortfolioRows(
      input({
        progressByNode: new Map([
          ['riyadh', { rows: [], done: 6, total: 9, linked: 7, nodes: 1 }],
          ['jeddah', { rows: [], done: 1, total: 9, linked: 2, nodes: 1 }],
        ]),
      }),
    )
    const books = rollUpPortfolio(rows, 'manager', ladder(), (s) => s.name)
    const sara = books.find((b) => b.label === 'Sara')
    // Najran has no reading, so it contributes nothing to EITHER half — a node
    // added to the denominator with no numerator would read as regression.
    expect(sara?.done).toBe(7)
    expect(sara?.total).toBe(18)
  })
})

/* ───────────────────────── the two shapes ───────────────────────── */

describe('organizations or buckets — one rule, both halves in the URL', () => {
  it('the exception cut shows organizations', () => {
    expect(portfolioShowsRows({ by: 'stage', risk: true, as: 'table' }, filter())).toBe(true)
  })

  it('a reader who has narrowed to organizations sees organizations', () => {
    expect(portfolioShowsRows({ by: 'manager', risk: false, as: 'table' }, filter({ mapNodeIds: ['riyadh'] }))).toBe(
      true,
    )
  })

  it('otherwise the roll-up is the reading', () => {
    expect(portfolioShowsRows({ by: 'stage', risk: false, as: 'table' }, filter())).toBe(false)
    expect(portfolioShowsRows({ by: 'vendor', risk: false, as: 'table' }, filter({ vendors: ['acme'] }))).toBe(false)
  })

  it('cuts the population once, so the bucket count and the row count agree', () => {
    const rows = buildPortfolioRows(input({ fallbackStallDays: 90 }))
    const cut = portfolioRowsFor(rows, { by: 'stage', risk: true, as: 'table' }, PORTFOLIO_SCOPE_ALL)
    expect(cut).toHaveLength(2)
    const buckets = rollUpPortfolio(cut, 'stage', ladder(), (s) => s.name)
    expect(buckets.reduce((n, b) => n + b.atRisk, 0)).toBe(cut.length)
  })

  it('leaves the population alone when the cut is off', () => {
    const rows = buildPortfolioRows(input())
    expect(portfolioRowsFor(rows, { by: 'stage', risk: false, as: 'table' }, PORTFOLIO_SCOPE_ALL)).toHaveLength(rows.length)
  })
})

/* ───────────────────────── drilling ───────────────────────── */

describe('the drill narrows to what the reader can see', () => {
  it('an organization row narrows to that organization and clears what would fight it', () => {
    const rows = buildPortfolioRows(input())
    const next = filterForOrgRow(
      filter({ trackIds: ['other'], vendors: ['zzz'], managerIds: ['bandar'], search: 'adt' }),
      byId(rows, 'riyadh'),
    )
    expect(next.mapNodeIds).toEqual(['riyadh'])
    expect(next.trackIds).toEqual([])
    expect(next.vendors).toEqual([])
    expect(next.managerIds).toEqual([])
    // Everything that narrows WITHIN the organization survives.
    expect(next.search).toBe('adt')
  })

  it('a bucket narrows to its members, and the members are the ones it counted', () => {
    const rows = buildPortfolioRows(input())
    const books = rollUpPortfolio(rows, 'manager', ladder(), (s) => s.name)
    const sara = books.find((b) => b.label === 'Sara')
    if (sara === undefined) throw new Error('no bucket for Sara')
    const next = filterForBucket(filter(), sara)
    expect(next.mapNodeIds).toEqual(sara.nodeIds)
    expect(next.mapNodeIds).toHaveLength(sara.orgs)
  })
})

/* ─────────────── the drill has to actually narrow the table ─────────────── */

/**
 * THE DEFECT THIS SUITE MISSED, AND THE ONE A GATE FOUND BY RENDERING IT.
 *
 * `filterForOrgRow` and `filterForBucket` were proven to WRITE the right filter,
 * and nothing proved the table then showed fewer organizations — because it did
 * not. lib/mindtree/model.ts draws a structural node whether or not it is
 * populated (on purpose: "which Org has nothing on it" is a question this map
 * exists to answer), so a filter naming organizations changed only the `open`
 * and `quiet` columns and left every other row on screen. `?manager=<me>` showed
 * four hundred rows rather than one account manager's eighty; the trail drill
 * wrote one node id and left 399 rows beside it.
 *
 * These cases are the fix's evidence. Each asserts what is GONE, not only what
 * is present — the shape of assertion whose absence let it ship.
 */
describe('the filter narrows the ORGANIZATIONS, not just their columns', () => {
  const chains = (): Map<string, readonly string[]> =>
    new Map<string, readonly string[]>([
      ['ob', ['ob']],
      ['riyadh', ['riyadh', 'ob']],
      ['jeddah', ['jeddah', 'ob']],
      ['dammam', ['dammam', 'ob']],
      ['tabuk', ['tabuk', 'ob']],
      ['hail', ['hail', 'ob']],
      ['najran', ['najran', 'ob']],
    ])

  const managers = (): Map<string, string | null> =>
    new Map([...nodeMap().values()].map((n) => [n.id, n.account_manager_id]))

  const vendors = (): Map<string, string> =>
    new Map([...nodeMap().values()].map((n) => [n.id, n.vendor]))

  function scope(over: Partial<PortfolioScope> = {}): PortfolioScope {
    return {
      mapNodeIds: [],
      managerIds: [],
      vendors: [],
      ancestryOfNode: chains(),
      managerOfNode: managers(),
      vendorOfNode: vendors(),
      ...over,
    }
  }

  const seen = (rows: readonly PortfolioRow[]): string[] => rows.map((r) => r.nodeId).sort()

  it('a drill to ONE organization leaves ONE row', () => {
    const rows = buildPortfolioRows(input())
    const cut = portfolioRowsFor(rows, { by: 'stage', risk: false, as: 'table' }, scope({ mapNodeIds: ['riyadh'] }))
    expect(seen(cut)).toEqual(['riyadh'])
  })

  it('a drill to a PHASE keeps every organization inside it — the ancestry reading', () => {
    const rows = buildPortfolioRows(input())
    const cut = portfolioRowsFor(rows, { by: 'stage', risk: false, as: 'table' }, scope({ mapNodeIds: ['ob'] }))
    // The phase itself is a row too — it is an entity node — and it is inside
    // its own subtree, so it stays. What matters is that nothing OUTSIDE does.
    expect(seen(cut)).toEqual(['dammam', 'hail', 'jeddah', 'najran', 'ob', 'riyadh', 'tabuk'])
  })

  it("`?manager=` shows that person's book and nobody else's — the My-organizations link", () => {
    const rows = buildPortfolioRows(input())
    const cut = portfolioRowsFor(rows, { by: 'stage', risk: false, as: 'table' }, scope({ managerIds: ['sara'] }))
    expect(seen(cut)).toEqual(['jeddah', 'najran', 'riyadh'])
    expect(seen(cut)).not.toContain('dammam')
  })

  it('MANAGER_NONE is the gap an AD hunts, and it is selectable', () => {
    const rows = buildPortfolioRows(input())
    const cut = portfolioRowsFor(rows, { by: 'stage', risk: false, as: 'table' }, scope({ managerIds: [MANAGER_NONE] }))
    // `ob` and `hail` are the two nobody has been given.
    expect(seen(cut)).toEqual(['hail', 'ob'])
  })

  it('folds the vendor on both sides, and a blank vendor answers no vendor filter', () => {
    const rows = buildPortfolioRows(input())
    const cut = portfolioRowsFor(rows, { by: 'stage', risk: false, as: 'table' }, scope({ vendors: ['ACME '] }))
    expect(seen(cut)).toEqual(['hail', 'jeddah', 'riyadh'])
    // Tabuk's vendor is '' — "not recorded" is the absence of an integrator
    // rather than a twelfth one, which is lib/entryFilter's own clause.
    expect(seen(cut)).not.toContain('tabuk')
  })

  it('reads an ABSENT chain as nothing, never as everything', () => {
    const rows = buildPortfolioRows(input())
    const cut = portfolioRowsFor(
      rows,
      { by: 'stage', risk: false, as: 'table' },
      { ...scope({ mapNodeIds: ['riyadh'] }), ancestryOfNode: new Map() },
    )
    expect(cut).toEqual([])
  })

  it('narrows FIRST and cuts SECOND — "eleven of Sara\'s eighty", not eleven of four hundred', () => {
    const args = input({ fallbackStallDays: 90 })
    const rows = buildPortfolioRows(args)
    const all = portfolioRowsFor(rows, { by: 'stage', risk: true, as: 'table' }, scope())
    const hers = portfolioRowsFor(rows, { by: 'stage', risk: true, as: 'table' }, scope({ managerIds: ['sara'] }))
    const his = portfolioRowsFor(rows, { by: 'stage', risk: true, as: 'table' }, scope({ managerIds: ['bandar'] }))
    // Both of the workspace's stuck organizations happen to be Sara's, which is
    // the point: "two" is the answer to two DIFFERENT questions here, and the
    // other book's answer is what proves the narrowing ran at all.
    expect(all).toHaveLength(2)
    expect(hers).toHaveLength(2)
    expect(his).toHaveLength(0)
    expect(hers.every((r) => r.managerId === 'sara')).toBe(true)
    // Cut-then-narrow would have given the same two; narrow-then-cut is what
    // makes the sentence "two of Sara's three", and the denominator is the
    // narrowed population rather than the workspace.
    expect(portfolioRowsFor(rows, { by: 'stage', risk: false, as: 'table' }, scope({ managerIds: ['sara'] }))).toHaveLength(3)
  })

  it('THE BADGE NARROWS WITH IT — the chip and the list stay one number', () => {
    const args = input({ fallbackStallDays: 90 })
    const rows = buildPortfolioRows(args)
    for (const s of [scope(), scope({ managerIds: ['sara'] }), scope({ mapNodeIds: ['riyadh'] })]) {
      const cut = portfolioRowsFor(rows, { by: 'stage', risk: true, as: 'table' }, s)
      expect(countAtRisk(args.root, { ...args, scope: s })).toBe(cut.length)
    }
  })

  it('proves these can fail: the predicate with nothing set admits everybody', () => {
    const rows = buildPortfolioRows(input())
    for (const row of rows) {
      expect(inPortfolioScope(row.nodeId, row.vendorFold, PORTFOLIO_SCOPE_ALL), row.nodeId).toBe(true)
    }
    expect(inPortfolioScope('riyadh', 'acme', scope({ managerIds: ['bandar'] }))).toBe(false)
    expect(inPortfolioScope('riyadh', 'acme', scope({ managerIds: ['sara'] }))).toBe(true)
  })
})

/* ───────────────────────── sorting ───────────────────────── */

describe('the portfolio expresses its own null rule', () => {
  const rows = (): PortfolioRow[] => buildPortfolioRows(input())

  it('sorts the stage column by the LADDER, never alphabetically', () => {
    const list = rows().filter((r) => r.stageId !== null)
    const sorted = [...list].sort((a, b) => comparePortfolioRows(a, b, 'stage', compareText))
    expect(sorted.map((r) => r.stageName)).toEqual([
      'Kickoff',
      'Integrating',
      'Paused',
      'Live',
      'Testing/UAT',
    ])
  })

  it('puts an empty cell below a zero in BOTH directions', () => {
    const list = rows()
    const asc = [...list].sort((a, b) => comparePortfolioRows(a, b, 'days', compareText))
    // The two with no rung open the ascending sort, tied on -1 and broken by
    // name — which is the whole reason every comparison ends on the name.
    expect(asc.slice(0, 2).map((r) => r.nodeId)).toEqual(['hail', 'ob'])
    // Reversed, the nulls fall to the end rather than opening "longest first".
    const desc = [...list].sort((a, b) => -comparePortfolioRows(a, b, 'days', compareText))
    expect(desc[0].daysInStage).toBe(433)
    expect(desc[desc.length - 1].daysInStage).toBeNull()
    expect(desc[desc.length - 2].daysInStage).toBeNull()
  })

  it('ends every text comparison on the organization name, so one bucket cannot shuffle', () => {
    const list = rows()
    const sorted = [...list].sort((a, b) => comparePortfolioRows(a, b, 'manager', compareText))
    // `name` is the TREE's label resolved by the caller's `textOf`, not
    // `map_nodes.name` — the table and the picture must say one word for one
    // organization, in one language, or the toggle renames things.
    const sara = sorted.filter((r) => r.managerName === 'Sara').map((r) => r.name)
    expect(sara).toEqual(['jeddah', 'najran', 'riyadh'])
  })

  it('orders progress as a fraction, with "nobody has looked" below "0 of 9"', () => {
    const list = buildPortfolioRows(
      input({
        progressByNode: new Map([
          ['riyadh', { rows: [], done: 6, total: 9, linked: 7, nodes: 1 }],
          ['jeddah', { rows: [], done: 0, total: 9, linked: 0, nodes: 1 }],
        ]),
      }),
    )
    const sorted = [...list].sort((a, b) => comparePortfolioRows(a, b, 'progress', compareText))
    expect(sorted[sorted.length - 1].nodeId).toBe('riyadh')
    expect(sorted.findIndex((r) => r.nodeId === 'jeddah')).toBeGreaterThan(
      sorted.findIndex((r) => r.nodeId === 'hail'),
    )
  })
})

/*
 * ── A CLOCK NOBODY STARTED ─────────────────────────────────────────────────
 *
 * `map_node_progress.updated_by` is 0026's server truth about who wrote the row
 * — stamped by the touch trigger, never accepted from a client. Null therefore
 * means there was no `auth.uid()`: a service-role script wrote it, and its
 * `stage_changed_at` is the moment THE SCRIPT RAN.
 *
 * This is not hypothetical. All 161 progress rows in the live workspace carry a
 * null `updated_by` and share exactly two `stage_changed_at` values — 75 rows on
 * one instant, 86 on the other, to the microsecond — because two imports wrote
 * them. Nobody has ever set a stage in this product.
 *
 * ⚠ AND IT HAS A DATE. Kickoff and Integrating & Testing both carry
 *   `expected_days = 10`; the imports ran on 22 and 23 August 2026. Without this
 *   rule, on 1-2 September all 124 organizations not yet Live cross the
 *   threshold within a day of each other, and every surface in the product
 *   reports a programme-wide stall that never happened.
 */
describe('a stage clock only counts if a person started it', () => {
  const unwitnessed = (): Map<string, MapNodeProgress> =>
    new Map(
      [
        progress('riyadh', 'kick', '2026-01-01T00:00:00.000Z', null),
        progress('jeddah', 'integ', '2026-03-01T00:00:00.000Z', null),
        progress('dammam', 'live', '2025-01-01T00:00:00.000Z', null),
        progress('tabuk', 'hold', '2025-06-01T00:00:00.000Z', null),
        progress('najran', 'uat', '2025-01-01T00:00:00.000Z', null),
      ].map((p) => [p.node_id, p]),
    )

  it('reports NO days for a row a script wrote, however old the stamp', () => {
    const rows = buildPortfolioRows(input({ progressById: unwitnessed() }))
    // Riyadh's stamp is 68 days old and its rung allows 30. Authored, that is
    // the one at-risk organization in this file. Unauthored, there is nothing
    // to judge — and "nothing to judge" is null, never 0. A zero would say the
    // organization arrived today.
    expect(byId(rows, 'riyadh').daysInStage).toBeNull()
    expect(byId(rows, 'riyadh').atRisk).toBe(false)
  })

  it('puts NOBODY at risk when a script wrote every row — the live shape', () => {
    const rows = buildPortfolioRows(input({ progressById: unwitnessed() }))
    expect(rows.filter((r) => r.atRisk)).toEqual([])
  })

  /*
   * THE PAIR IS THE ARGUMENT. Same stamps, same ladder, same everything — only
   * the authorship differs, and the answer flips. Without this second half the
   * test above would also pass if `daysInStage` had simply been broken.
   */
  it('reports the days again the moment a person is recorded', () => {
    const rows = buildPortfolioRows(input())
    expect(byId(rows, 'riyadh').daysInStage).toBe(68)
    expect(byId(rows, 'riyadh').atRisk).toBe(true)
  })

  /*
   * ⚠ THE CASE THAT CHOSE AUTHORSHIP OVER A SHARED TIMESTAMP.
   *
   * The first draft of this rule read "an instant shared by more than one row
   * was written by one statement" — true, and it would have thrown this away.
   * An account manager who selects three organizations in the portfolio bulk bar
   * and sets them all to Kickoff writes three rows in one statement, sharing one
   * instant to the microsecond. That IS somebody saying something, and every row
   * carries their id.
   */
  it('keeps a human bulk action, where three rows share one instant', () => {
    const together = '2026-01-01T00:00:00.000Z'
    const rows = buildPortfolioRows(
      input({
        progressById: new Map(
          [
            progress('riyadh', 'kick', together, 'sara'),
            progress('jeddah', 'kick', together, 'sara'),
            progress('dammam', 'kick', together, 'sara'),
            progress('tabuk', 'hold', '2025-06-01T00:00:00.000Z', 'sara'),
            progress('najran', 'uat', '2025-01-01T00:00:00.000Z', 'sara'),
          ].map((p) => [p.node_id, p]),
        ),
      }),
    )
    for (const id of ['riyadh', 'jeddah', 'dammam']) {
      expect(byId(rows, id).daysInStage).toBe(68)
    }
  })
})
