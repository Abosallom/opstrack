// THE TWO ENCODINGS THE MAP DECLARED AND NEVER SPENT — as arithmetic.
//
// `sizeForCount` has been exported, documented and unused since it was written;
// `MindNodeView.progress` has been declared on the view model and drawn by
// `MindNode` since the card was rewritten, and the builder set six fields and
// never that one. Both are wired now, and both are wired as PURE FOLDS OVER THE
// TREE — `collectSizes` and `collectProgress`, beside `collectStats` — precisely
// so that the numbers can be checked here rather than by looking at a picture.
//
// WHAT EACH CASE IS DEFENDING, because "does the fold add up" is not the risk:
//
//   · fullAt. `sizeForCount(count, {})` defaults `fullAt` to 50. On the
//     portfolio this map exists for — 400 organizations, most of them holding a
//     handful of open items — every branch lands within a few percent of one
//     size and the channel says NOTHING. The fix is per-ring: the busiest
//     sibling is `fullAt`, so the ring spends its whole dynamic range on the
//     differences it actually contains. A regression to a constant is invisible
//     on any fixture whose counts happen to straddle it, so the first case is
//     built from two rings with DIFFERENT busiest siblings and asserts that one
//     count gets two different sizes.
//   · The uniform ring. `fullAt <= 1` collapses `sizeForCount`'s span to zero
//     and it answers `max` for EVERY count — so the naive wiring inflates a ring
//     where everybody holds one item to 2.25x the area, in order to say that
//     nothing differs. Nothing is written in that case, and `layoutWorlds` falls
//     back to the authored 168x44.
//   · The denominator, again. lib/mapNodes.test.ts pins the three ways to get it
//     wrong for ONE organization. The roll-up adds a fourth: a branch with no
//     organization beneath it at all. `useCaseProgress` floors `nodes` at 1 —
//     right for a panel, where nothing recorded is still one organization at
//     `0 of 9` — and wrong for a track holding only entries, which would
//     announce `0 of 3` about nothing.
//   · O(n²). The roll-up must walk each link once per ANCESTOR. A per-node
//     filter over the whole link list gives the same answer and is quadratic at
//     the ~3,200 nodes a 400-organization workspace builds, so the last case
//     counts the lookups through a proxy and pins the number.
//
// PURE FUNCTIONS, PLAIN CASES — both take everything they need as arguments, so
// nothing below mounts a component or touches a store. The shim is only needed
// because the MODULE they live in is a page hook: importing it pulls in
// store/entries, which pulls in store/config, which adds a `window` focus
// listener at IMPORT time. mapZoomReach.test.tsx's `vi.hoisted` block, cut to
// the two globals that path actually reads.

import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const mem = new Map<string, string>()
  const g = globalThis as unknown as Record<string, unknown>
  g.localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() {
      return mem.size
    },
  }
  g.addEventListener = () => {}
  g.removeEventListener = () => {}
  g.window = globalThis
  g.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
  g.document = { documentElement: { dir: 'ltr', lang: 'en' } }
})

import { DEFAULT_NODE_SIZE, type NodeSize } from '../../lib/mindtree/layout'
import type { StageIndex, UseCaseProgress } from '../../lib/mapNodes'
import type { Entry, MapNodeProgress, MapNodeStage } from '../../types'
import { MIND_GROUPINGS, cohortKeyOf, type MindNode } from '../../lib/mindtree/model'
import { PORTFOLIO_BYS } from '../../lib/mindtree/lens'
import type { MapNodeUseCase, UseCase, UseCaseStatus } from '../../types'

// Types are erased, so they come through static `import type` while the VALUES
// arrive after the shims above have run.
const { BY_FOR_GROUPING, CANVAS_GROUPINGS, GROUPING_FOR_BY, collectProgress, collectSizes, collectStats } =
  await import('./useMapModel')
const { buildPortfolioRows } = await import('../../lib/portfolio/rows')
const { stageIndex } = await import('../../lib/mapNodes')

/* ── the stats walk's input, as one fixture three kinds of case can bend ── */

/** A fixed instant, so "68 days on this rung" is a fact rather than a Tuesday. */
const NOW = new Date('2026-03-10T00:00:00.000Z')
const TODAY = '2026-03-10'

/**
 * Everything `collectStats` needs and cannot know, with every clock stopped and
 * every lookup empty. A case supplies only the half it is about — which is what
 * the options object bought over four positional arguments.
 */
function statsInput(over: Partial<Parameters<typeof collectStats>[1]> = {}): Parameters<
  typeof collectStats
>[1] {
  return {
    entryById: new Map<string, Entry>(),
    isUnassigned: () => false,
    stages: { byId: new Map(), ofNode: () => null } satisfies StageIndex,
    progressById: new Map<string, Pick<MapNodeProgress, 'stage_changed_at'>>(),
    fallbackStallDays: null,
    now: NOW,
    today: TODAY,
    ...over,
  }
}

/** An entry, cut to the one column the quiet fold reads. */
function leaf(id: string, lastActivityAt: string): [string, Entry] {
  return [id, { last_activity_at: lastActivityAt } as Entry]
}

/** A rung. `expected_days` is the only field the clock contract branches on. */
function rung(over: Partial<MapNodeStage> & Pick<MapNodeStage, 'id'>): MapNodeStage {
  return {
    name: over.id,
    name_ar: '',
    sort_order: 0,
    expected_days: null,
    terminal: false,
    paused: false,
    hidden: false,
    color: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  } as MapNodeStage
}

/* ────────────────────────────── fixtures ────────────────────────────── */

let seq = 0

function capability(id: string): UseCase {
  seq += 1
  return {
    id,
    name: id.toUpperCase(),
    name_ar: '',
    sort_order: seq,
    hidden: false,
    created_by: null,
    updated_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }
}

/** Three of the seeded capabilities — enough for a denominator to be wrong in. */
function catalogue(): UseCase[] {
  seq = 0
  return [capability('adt'), capability('rx'), capability('lab')]
}

function link(nodeId: string, useCaseId: string, status: string): MapNodeUseCase {
  return { node_id: nodeId, use_case_id: useCaseId, status: status as UseCaseStatus }
}

/** The fields neither fold reads, filled once so the cases stay readable. */
function node(over: Partial<MindNode> & Pick<MindNode, 'id' | 'kind'>): MindNode {
  return {
    label: { kind: 'text', text: over.id },
    count: 0,
    colourVars: {},
    health: { levels: { ok: 0, stale: 0, overdue: 0, critical: 0 }, slaBreached: false },
    children: [],
    collapsed: false,
    depth: 0,
    entryId: null,
    bucketKey: null,
    entityType: null,
    retired: false,
    ...over,
  }
}

/** An Organization: `entityIdOf` answers its `bucketKey`, which is its node id. */
function org(id: string, count: number, children: MindNode[] = []): MindNode {
  return node({ id, kind: 'entity', bucketKey: id, count, children })
}

/**
 * A cohort, minted the way `bucketBy` mints one — through `cohortKeyOf`, so the
 * key under test is the shipped spelling and not a string this file invented.
 */
function cohort(id: string, value: string, count: number, children: MindNode[]): MindNode {
  return node({
    id,
    kind: 'cohort',
    bucketKey: cohortKeyOf('stage', value),
    count,
    children,
  })
}

function byNode(links: readonly MapNodeUseCase[]): Map<string, MapNodeUseCase[]> {
  const out = new Map<string, MapNodeUseCase[]>()
  for (const row of links) {
    const held = out.get(row.node_id)
    if (held === undefined) out.set(row.node_id, [row])
    else held.push(row)
  }
  return out
}

/* ──────────────────────── size means count ──────────────────────── */

describe('collectSizes — the busiest SIBLING sets the scale', () => {
  it('gives one count two different sizes in two rings, which a constant fullAt cannot', () => {
    // Two tracks, three organizations each. Both rings hold an org at 4 open
    // items; they differ only in how busy their busiest member is.
    const tree = node({
      id: 'root',
      kind: 'root',
      count: 114,
      children: [
        node({
          id: 'quiet',
          kind: 'track',
          count: 9,
          children: [org('q-a', 1), org('q-b', 4), org('q-c', 4)],
        }),
        node({
          id: 'busy',
          kind: 'track',
          count: 105,
          children: [org('b-a', 1), org('b-b', 4), org('b-c', 100)],
        }),
      ],
    })

    const sizes = new Map<string, NodeSize>()
    collectSizes(tree, sizes)

    const quiet = sizes.get('q-b')
    const busy = sizes.get('b-b')
    expect(quiet).toBeDefined()
    expect(busy).toBeDefined()

    // fullAt = 4 in the quiet ring: t = (√4 − 1) / (√4 − 1) = 1, so this card is
    // the full 252 x 66 — 1.5x the floor on both axes, 2.25x the area.
    expect(quiet?.width).toBeCloseTo(252, 6)
    expect(quiet?.height).toBeCloseTo(66, 6)
    // fullAt = 100 in the busy ring: t = (√4 − 1) / (√100 − 1) = 1/9, so the SAME
    // four items get 168 + 84/9 = 177.33 wide. That gap is the whole change:
    // with `sizeForCount`'s dead default of fullAt = 50 both would be
    // 168 + 84 × (1 / (√50 − 1)) = 181.9 — one number, twice, and a ring that
    // says nothing about itself.
    expect(busy?.width).toBeCloseTo(DEFAULT_NODE_SIZE.width + 84 / 9, 6)
    expect(busy?.height).toBeCloseTo(DEFAULT_NODE_SIZE.height + 22 / 9, 6)
    expect(busy?.width).toBeLessThan(quiet?.width ?? 0)
  })

  it('writes nothing at all when the busiest sibling holds one item or none', () => {
    const tree = node({
      id: 'root',
      kind: 'root',
      count: 3,
      children: [
        node({
          id: 'flat',
          kind: 'track',
          count: 3,
          children: [org('f-a', 1), org('f-b', 1), org('f-c', 1)],
        }),
        node({ id: 'empty', kind: 'track', count: 0, children: [org('e-a', 0), org('e-b', 0)] }),
      ],
    })

    const sizes = new Map<string, NodeSize>()
    collectSizes(tree, sizes)

    // `sizeForCount` answers `max` for every count once fullAt <= 1 (its span is
    // √1 − 1 = 0), so writing these would draw five cards at 252 x 66 to encode a
    // difference of zero — and grow every one of their worlds by 1.5x with it.
    for (const id of ['f-a', 'f-b', 'f-c', 'e-a', 'e-b']) expect(sizes.has(id)).toBe(false)

    // The tracks themselves DO differ (3 against 0) and are sized against each
    // other: fullAt = 3, so `flat` is at t = 1 and `empty` is at the floor.
    expect(sizes.get('flat')?.width).toBeCloseTo(252, 6)
    expect(sizes.get('empty')?.width).toBeCloseTo(168, 6)
  })

  it('never sizes the tree root — it is nobody’s child, so it has no scale', () => {
    const tree = node({ id: 'root', kind: 'root', count: 9, children: [org('a', 9)] })
    const sizes = new Map<string, NodeSize>()
    collectSizes(tree, sizes)
    expect(sizes.has('root')).toBe(false)
  })
})

/* ─────────────────── the underscore means progress ─────────────────── */

describe('collectProgress — the roll-up, in one post-order pass', () => {
  const cat = catalogue()

  /** Three organizations: `a` finished, `b` half way, `c` with nothing recorded. */
  function portfolio(): MindNode {
    return node({
      id: 'root',
      kind: 'root',
      children: [
        node({ id: 'track', kind: 'track', children: [org('a', 0), org('b', 0), org('c', 0)] }),
      ],
    })
  }

  const links: MapNodeUseCase[] = [
    link('a', 'adt', 'live'),
    link('a', 'rx', 'live'),
    link('a', 'lab', 'live'),
    link('b', 'adt', 'live'),
    link('b', 'rx', 'testing'),
  ]

  it('rolls three organizations into one fraction every ancestor shares', () => {
    const out = new Map<string, UseCaseProgress>()
    collectProgress(portfolio(), cat, 'live', byNode(links), out)

    // One organization, three capabilities.
    expect(out.get('a')).toMatchObject({ done: 3, total: 3 })
    // The `testing` row is linked and not done.
    expect(out.get('b')).toMatchObject({ done: 1, total: 3 })

    // THE TRACK, AND THIS IS THE ASSERTION WAVE 3 CHANGED. Three organizations
    // are beneath it and `c` has no links at all, so the unit is capability ×
    // organization over the POPULATION: 4 of 9, not 4 of 6. The old number was
    // `useCaseProgress`' shrink-by-silence — the organization that recorded
    // nothing was invisible to the denominator, which is exactly the
    // organization a reader is looking for. `nodeIds` is now the 4th argument.
    expect(out.get('track')).toMatchObject({ done: 4, total: 9 })
    expect(out.get('root')).toMatchObject({ done: 4, total: 9 })
  })

  it('leaves a branch with no organization beneath it out entirely', () => {
    const tree = node({
      id: 'root',
      kind: 'root',
      count: 2,
      children: [
        node({
          id: 'issues',
          kind: 'track',
          count: 2,
          children: [
            node({ id: 'e1', kind: 'entry', entryId: 'e1', count: 1 }),
            node({ id: 'e2', kind: 'entry', entryId: 'e2', count: 1 }),
          ],
        }),
      ],
    })
    const out = new Map<string, UseCaseProgress>()
    collectProgress(tree, cat, 'live', byNode([]), out)
    // `useCaseProgress` floors `nodes` at 1, so asking it here would have
    // produced "0 of 3" for a track with nothing to be at zero — and every
    // branch of an organization-free workspace would announce it out loud.
    expect(out.size).toBe(0)
  })

  it('never puts a fraction on an entry or on a “+N more” fold', () => {
    const tree = node({
      id: 'root',
      kind: 'root',
      count: 1,
      children: [
        org('a', 1, [
          node({
            id: 'more',
            kind: 'more',
            count: 1,
            collapsed: true,
            children: [node({ id: 'e1', kind: 'entry', entryId: 'e1', count: 1 })],
          }),
        ]),
      ],
    })
    const out = new Map<string, UseCaseProgress>()
    collectProgress(tree, cat, 'live', byNode([link('a', 'adt', 'live')]), out)
    expect(out.has('a')).toBe(true)
    expect(out.has('more')).toBe(false)
    expect(out.has('e1')).toBe(false)
  })

  it('counts against the terminal status it is given, and nothing once it is renamed', () => {
    const out = new Map<string, UseCaseProgress>()
    collectProgress(portfolio(), cat, 'running', byNode(links), out)
    // Same links, a status word nothing carries: the numerator collapses and the
    // denominator does not. "0 of 9" is visibly wrong on the first paint, which
    // is the failure the parameter is shaped for (lib/mapNodes.ts:11-19).
    expect(out.get('track')).toMatchObject({ done: 0, total: 9 })
  })

  it('consults the link index once per organization, never once per node', () => {
    const tree = node({
      id: 'root',
      kind: 'root',
      children: [
        node({ id: 't1', kind: 'track', children: [org('a', 0), org('b', 0)] }),
        node({ id: 't2', kind: 'track', children: [org('c', 0), org('d', 0)] }),
      ],
    })
    const rows = [
      link('a', 'adt', 'live'),
      link('b', 'adt', 'live'),
      link('c', 'adt', 'live'),
      link('d', 'rx', 'testing'),
    ]

    // A counting proxy over the index. The naive shape — every node asking the
    // index (or worse, filtering the whole link list) — reads it 7 times for 7
    // nodes; the post-order pass reads it only where an organization sits, and
    // the ancestors reuse the arrays their children already built.
    const index = byNode(rows)
    let reads = 0
    const counting: ReadonlyMap<string, readonly MapNodeUseCase[]> = {
      get: (key: string) => {
        reads += 1
        return index.get(key)
      },
      has: (key: string) => index.has(key),
      get size() {
        return index.size
      },
      forEach: index.forEach.bind(index),
      entries: index.entries.bind(index),
      keys: index.keys.bind(index),
      values: index.values.bind(index),
      [Symbol.iterator]: index[Symbol.iterator].bind(index),
    }

    const out = new Map<string, UseCaseProgress>()
    collectProgress(tree, cat, 'live', counting, out)

    expect(reads).toBe(4)
    // 4 organizations x 3 capabilities = 12, of which 3 are live.
    expect(out.get('root')).toMatchObject({ done: 3, total: 12 })
    expect(out.get('t1')).toMatchObject({ done: 2, total: 6 })
    expect(out.get('t2')).toMatchObject({ done: 1, total: 6 })
  })
})

/* ────────────────── the cohort's other number ────────────────── */
//
// A cohort announces TWO counts and they are different facts: "37 open" is the
// work beneath it (the model's `count`, computed off entries and the subtree)
// and "14 organizations" is how many members the ring has. Reading the first
// where the second belongs is a silent, plausible, wrong number in front of a
// director — the ONE failure mode a synthetic ring introduces that the tree
// never had — so the number the spoken name uses is pinned here.

describe('collectStats — how many organizations are under a node', () => {
  /** Two stage cohorts under one track: 3 organizations and 1. */
  function grouped(): MindNode {
    return node({
      id: 'root',
      kind: 'root',
      count: 40,
      children: [
        node({
          id: 'track',
          kind: 'track',
          count: 40,
          children: [
            cohort('c-live', 'stage-live', 30, [org('a', 10), org('b', 12), org('c', 8)]),
            cohort('c-new', 'stage-new', 10, [org('d', 10)]),
          ],
        }),
      ],
    })
  }

  it('counts the members of a cohort, and never the cohort itself', () => {
    const out = new Map<string, ReturnType<typeof collectStats>>()
    collectStats(grouped(), statsInput(), out)

    expect(out.get('c-live')?.orgs).toBe(3)
    expect(out.get('c-new')?.orgs).toBe(1)
    // THE COHORTS THEMSELVES ARE NOT ORGANIZATIONS. `entityIdOf` refuses a
    // synthetic `cohort:` key — a count that trusted `kind !== 'entry'` would
    // read 6 here (4 organizations + 2 rings) and the ring would announce two
    // organizations that do not exist.
    expect(out.get('track')?.orgs).toBe(4)
    expect(out.get('root')?.orgs).toBe(4)
  })

  it('is not the same number as `count`, which is the work beneath', () => {
    const out = new Map<string, ReturnType<typeof collectStats>>()
    const tree = grouped()
    collectStats(tree, statsInput(), out)
    // 30 open items, 3 organizations. The two are read from different places
    // and the spoken name says both; a fixture where they happened to be equal
    // could not fail if the sentence read the wrong one.
    expect(tree.children[0]?.children[0]?.count).toBe(30)
    expect(out.get('c-live')?.orgs).toBe(3)
  })

  it('gives an entry no organizations of its own', () => {
    const out = new Map<string, ReturnType<typeof collectStats>>()
    const tree = node({
      id: 'root',
      kind: 'root',
      count: 1,
      children: [org('a', 1, [node({ id: 'e1', kind: 'entry', entryId: 'e1', count: 1 })])],
    })
    collectStats(tree, statsInput(), out)
    expect(out.get('e1')?.orgs).toBe(0)
    // The organization counts ITSELF, which is what makes a ring of one read
    // "1 organization" rather than "0".
    expect(out.get('a')?.orgs).toBe(1)
  })

  /* ── the two facts the walk gained, and their two different scopes ── */

  it('clocks an organization’s rung and leaves the structure unclocked', () => {
    /* THE TRIAD IS A `map_nodes` FACT AND DOES NOT FOLD. A track is not standing
       on a rung and neither is the workspace; a walk that rolled a stage clock
       upward would have to invent an aggregate no column anywhere prints. */
    const tree = node({
      id: 'root',
      kind: 'root',
      children: [node({ id: 'track', kind: 'track', children: [org('riyadh', 4)] })],
    })
    const out = new Map<string, ReturnType<typeof collectStats>>()
    const stages = new Map([['kick', rung({ id: 'kick', expected_days: 30 })]])
    const progress = new Map([
      ['riyadh', { node_id: 'riyadh', stage_id: 'kick' } as MapNodeProgress],
    ])
    collectStats(
      tree,
      statsInput({
        stages: stageIndex(progress, stages),
        // 2026-01-01 → 2026-03-10 is 68 days, and 68 > 30.
        progressById: new Map([['riyadh', { stage_changed_at: '2026-01-01T00:00:00.000Z' }]]),
      }),
      out,
    )

    expect(out.get('riyadh')).toMatchObject({ daysInStage: 68, atRisk: true, stallDays: 30 })
    expect(out.get('track')).toMatchObject({ daysInStage: null, atRisk: false, stallDays: null })
    expect(out.get('root')).toMatchObject({ daysInStage: null, atRisk: false })
  })

  it('rolls the quietest leaf up through groups and collapsed branches, null where nothing is filed', () => {
    /* QUIET IS THE ONE FACT THAT GENUINELY FOLDS, and it must fold through the
       nodes that get no row of their own: a status bucket is not a place, but
       the silence under it is real silence, and a number that changed when
       somebody clicked a branch open would be reporting the picture. */
    const tree = node({
      id: 'root',
      kind: 'root',
      children: [
        node({
          id: 'track',
          kind: 'track',
          children: [
            org('riyadh', 2, [
              node({
                id: 'group:blocked',
                kind: 'group',
                bucketKey: 'blocked',
                children: [
                  node({ id: 'e1', kind: 'entry', entryId: 'e1' }),
                  node({ id: 'e2', kind: 'entry', entryId: 'e2' }),
                ],
              }),
            ]),
            org('hail', 0),
          ],
        }),
      ],
    })
    tree.children[0].children[0].collapsed = true

    const out = new Map<string, ReturnType<typeof collectStats>>()
    collectStats(
      tree,
      statsInput({
        entryById: new Map([
          leaf('e1', '2026-03-08T00:00:00.000Z'),
          leaf('e2', '2026-01-05T00:00:00.000Z'),
        ]),
      }),
      out,
    )

    // The most recently touched item is what "how quiet is this" means: two
    // days, not the sixty-four of the older one.
    expect(out.get('riyadh')?.quietDays).toBe(2)
    expect(out.get('track')?.quietDays).toBe(2)
    expect(out.get('root')?.quietDays).toBe(2)
    // AND NOT A ZERO. "nothing has ever been filed here" is a different fact
    // from "something was touched today" and the two must not print alike.
    expect(out.get('hail')?.quietDays).toBeNull()
  })

  it('agrees with the portfolio row about at risk and about quiet — one arithmetic, two walks', () => {
    /* THE DRIFT-CATCHER. The map's walk and the portfolio's builder are two
       traversals of one tree by two files for two surfaces, and they share
       `stageReading`, `quietLeafDays` and `minQuiet` precisely so that "does the
       card say what the table says" answers ALWAYS rather than USUALLY. This
       case is what goes red the day one of them grows a fourth copy. */
    const entity = (id: string, count: number, children: MindNode[] = []): MindNode =>
      node({ id: `entity:${id}`, kind: 'entity', bucketKey: id, count, children })

    const tree = node({
      id: 'root',
      kind: 'root',
      children: [
        node({
          id: 'track',
          kind: 'track',
          bucketKey: 'uhr',
          children: [
            entity('riyadh', 2, [
              node({ id: 'e1', kind: 'entry', entryId: 'e1' }),
              node({ id: 'e2', kind: 'entry', entryId: 'e2' }),
            ]),
            entity('jeddah', 0),
          ],
        }),
      ],
    })
    const stages = new Map([
      ['kick', rung({ id: 'kick', expected_days: 30 })],
      ['live', rung({ id: 'live', expected_days: 10, terminal: true })],
    ])
    const progressRows = new Map([
      ['riyadh', { node_id: 'riyadh', stage_id: 'kick' } as MapNodeProgress],
      ['jeddah', { node_id: 'jeddah', stage_id: 'live' } as MapNodeProgress],
    ])
    const stamps = new Map([
      ['riyadh', { stage_changed_at: '2026-01-01T00:00:00.000Z' }],
      ['jeddah', { stage_changed_at: '2025-01-01T00:00:00.000Z' }],
    ])
    const entryById = new Map([
      leaf('e1', '2026-03-08T00:00:00.000Z'),
      leaf('e2', '2026-01-05T00:00:00.000Z'),
    ])

    const out = new Map<string, ReturnType<typeof collectStats>>()
    collectStats(
      tree,
      statsInput({
        entryById,
        stages: stageIndex(progressRows, stages),
        progressById: stamps,
      }),
      out,
    )

    const rows = buildPortfolioRows({
      root: tree,
      nodeById: new Map(),
      stages: stageIndex(progressRows, stages),
      progressById: stamps,
      fallbackStallDays: null,
      labelOf: (n) => (n.label.kind === 'text' ? n.label.text : n.label.key),
      listSep: ', ',
      stageNameOf: (st) => st.name,
      managerNameOf: () => null,
      vendorOfNode: new Map(),
      managerOfNode: new Map(),
      progressByNode: null,
      entryById,
      today: TODAY,
      now: NOW,
    })

    expect(rows.length).toBe(2)
    for (const row of rows) {
      const stat = out.get(`entity:${row.nodeId}`)
      expect(stat?.atRisk).toBe(row.atRisk)
      expect(stat?.daysInStage).toBe(row.daysInStage)
      expect(stat?.stallDays).toBe(row.stallDays)
      expect(stat?.quietDays).toBe(row.quietDays)
    }
    // And the fixture is not vacuous: one of them IS stuck and one of them is
    // terminal, so a pair of nulls could not have passed the loop above.
    expect(out.get('entity:riyadh')).toMatchObject({ atRisk: true, daysInStage: 68, quietDays: 2 })
    expect(out.get('entity:jeddah')).toMatchObject({ atRisk: false, quietDays: null })
  })
})

/* ─────────────── the roll-up reaches through a cohort ─────────────── */

describe('collectProgress — a cohort is a place, a fold is not', () => {
  const cat = catalogue()

  it('puts the fraction on the cohort as well as on the ring above it', () => {
    const tree = node({
      id: 'root',
      kind: 'root',
      children: [
        node({
          id: 'track',
          kind: 'track',
          children: [cohort('c', 'stage-live', 0, [org('a', 0), org('b', 0)])],
        }),
      ],
    })
    const out = new Map<string, UseCaseProgress>()
    collectProgress(tree, cat, 'live', byNode([link('a', 'adt', 'live')]), out)

    // 2 organizations x 3 capabilities = 6, one of them live. The cohort is the
    // ring an account manager actually looks at, so "1 of 6 live" has to be
    // true OF IT — this is the assertion that fails if the guard tests kinds
    // instead of roles and forgets the new one.
    expect(out.get('c')).toMatchObject({ done: 1, total: 6 })
    expect(out.get('track')).toMatchObject({ done: 1, total: 6 })
  })

  it('still refuses a fold, which is a control and not a place', () => {
    // `more` is a BUCKET in KIND_ROLE, not a leaf, so the negative predicate
    // (`!== 'leaf'`) would start announcing "0 of 3 live" on a "+N more" button.
    // It holds an organization here precisely so the `nodeIds` guard cannot be
    // what saves it.
    const tree = node({
      id: 'root',
      kind: 'root',
      children: [
        node({
          id: 'more',
          kind: 'more',
          collapsed: true,
          children: [org('a', 0)],
        }),
      ],
    })
    const out = new Map<string, UseCaseProgress>()
    collectProgress(tree, cat, 'live', byNode([link('a', 'adt', 'live')]), out)
    expect(out.has('a')).toBe(true)
    expect(out.has('more')).toBe(false)
    expect(out.get('root')).toMatchObject({ done: 1, total: 3 })
  })
})

/* ───────────── one `?by=`, two readers, and it round-trips ───────────── */
//
// The picture and the table are cut by ONE value in the address bar. These
// cases are the whole of that claim: every value the URL can carry means
// something to the canvas, every chip the canvas offers can be written back,
// and the two directions are inverses. A regression here is a chip that cannot
// light after a reload, or a reader who taps Team on the table and finds the
// map grouped by something else.

describe('the `?by=` bridge', () => {
  it('is total over every value the URL can carry', () => {
    for (const by of PORTFOLIO_BYS) {
      expect(GROUPING_FOR_BY[by]).toBeDefined()
      expect(MIND_GROUPINGS.some((g) => g.key === GROUPING_FOR_BY[by])).toBe(true)
    }
  })

  it('round-trips every grouping the toolbar offers, chip → ?by= → chip', () => {
    expect(CANVAS_GROUPINGS.length).toBeGreaterThan(0)
    for (const grouping of CANVAS_GROUPINGS) {
      const by = BY_FOR_GROUPING[grouping]
      expect(by).toBeDefined()
      expect(GROUPING_FOR_BY[by as (typeof PORTFOLIO_BYS)[number]]).toBe(grouping)
    }
  })

  it('offers no chip for a grouping the URL cannot spell', () => {
    // `type` is a rung of the OVERFLOW LADDER, reached by the model when an
    // account manager's own cohort is still over the cap. Nothing in `?by=`
    // names it, so a chip for it would go dark on the next reload.
    expect(MIND_GROUPINGS.some((g) => g.key === 'type')).toBe(true)
    expect(CANVAS_GROUPINGS).not.toContain('type')
    expect(BY_FOR_GROUPING.type).toBeUndefined()
  })

  it('offers them in the model’s own order, not the URL’s', () => {
    const declared = MIND_GROUPINGS.map((g) => g.key).filter((k) => CANVAS_GROUPINGS.includes(k))
    expect([...CANVAS_GROUPINGS]).toEqual(declared)
  })

  it('reads the portfolio’s progress question as “no cohorts”, deliberately', () => {
    // On the table `by=phase` asks how far along the programme is; on the canvas
    // the phases ARE rings the reader is standing in, so grouping by them again
    // would draw a ring named after its own parent. The progress underscore is
    // the canvas's answer, and it is drawn under every grouping.
    expect(GROUPING_FOR_BY.phase).toBe('none')
    expect(GROUPING_FOR_BY.stage).toBe('stage')
    expect(GROUPING_FOR_BY.manager).toBe('manager')
    expect(GROUPING_FOR_BY.vendor).toBe('vendor')
  })
})
