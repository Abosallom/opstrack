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
import type { UseCaseProgress } from '../../lib/mapNodes'
import type { MindNode } from '../../lib/mindtree/model'
import type { MapNodeUseCase, UseCase, UseCaseStatus } from '../../types'

// Types are erased, so they come through static `import type` while the VALUES
// arrive after the shims above have run.
const { collectProgress, collectSizes } = await import('./useMapModel')

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

    // THE TRACK. Two organizations speak (`c` has no links at all), so `nodes` is
    // 2 and the unit is capability x organization: 4 of 6, not 4 of 9. That
    // shrink-by-silence is `useCaseProgress`'s own stated limit and the reason
    // its required 4th argument belongs to wave 3 — the seam is named at both
    // ends, and this assertion is what will change when it lands.
    expect(out.get('track')).toMatchObject({ done: 4, total: 6 })
    expect(out.get('root')).toMatchObject({ done: 4, total: 6 })
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
    // denominator does not. "0 of 6" is visibly wrong on the first paint, which
    // is the failure the parameter is shaped for (lib/mapNodes.ts:11-19).
    expect(out.get('track')).toMatchObject({ done: 0, total: 6 })
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
