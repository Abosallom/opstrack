// Contract tests for the Mindtree's arithmetic.
//
// No mocks, no clock, no DOM: `buildMindtree` takes plain data and returns a
// plain tree, which is the property lib/mindtree/model.ts was written to have.
//
// EVERY INSTANT IS T12:00:00Z, the convention lib/aggregate.test.ts sets and for
// the same reason — `instantToIsoDate()` resolves an instant to the reader's
// LOCAL calendar day, so a fixture written at T00:00:00Z lands on the previous
// day west of Greenwich and a date-bounded filter assertion would pass in Riyadh
// and fail in CI. Noon is the only hour that is the same date everywhere.
//
// THE TWO INVARIANTS AT THE TOP ARE THE POINT OF THE FILE. Every other case
// builds a tree and then runs both over it: counts roll up, and the level
// counters sum to the count. A grouping pass that drops, duplicates or
// mis-attributes a row cannot pass them, whatever else it gets right.

import { describe, expect, it } from 'vitest'
import { EMPTY_FILTER, type FilterContext, type FilterState } from '../entryFilter'
import {
  ROOT_ID,
  buildMindtree,
  groupTotals,
  isMindDimension,
  visibleChildren,
  type MindEntity,
  type MindMember,
  type MindNode,
  type MindTrack,
  type MindVocabOption,
  type MindtreeInput,
} from './model'
import type { Entry, EntryHealth, HealthLevel } from '../../types'

const CTX: FilterContext = { meId: 'me-1', today: '2026-07-30' }

function at(date: string): string {
  return `${date}T12:00:00.000Z`
}

function entry(over: Partial<Entry> & Pick<Entry, 'id'>): Entry {
  return {
    // `entries.node_id` (0024) — the finer grain inside a track. Defaulted to
    // null so every case that predates the hierarchy still describes a row filed
    // at track level, which is exactly what those cases were written about.
    node_id: null,
    track_id: null,
    title: over.id,
    description: '',
    type: 'action',
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
    created_at: at('2026-07-01'),
    updated_at: at('2026-07-01'),
    closed_at: null,
    last_activity_at: at('2026-07-01'),
    meeting_id: null,
    template_id: null,
    ...over,
  }
}

function health(id: string, level: HealthLevel, slaBreached = false): EntryHealth {
  return {
    id,
    entry_id: id,
    track_id: null,
    status: 'new',
    priority: 'medium',
    due_date: null,
    last_activity_at: at('2026-07-01'),
    days_since_activity: 0,
    days_overdue: level === 'overdue' || level === 'critical' ? 3 : 0,
    health: level,
    sla_due_at: slaBreached ? at('2026-07-20') : null,
    sla_breached: slaBreached,
  }
}

function healthMap(...rows: EntryHealth[]): ReadonlyMap<string, EntryHealth> {
  return new Map(rows.map((row) => [row.id, row]))
}

function track(over: Partial<MindTrack> & Pick<MindTrack, 'id'>): MindTrack {
  return {
    label: over.id,
    color: '#22d3ee',
    colorLight: '#0e7490',
    sortOrder: 0,
    archived: false,
    ...over,
  }
}

/** `useVocabAll('status')`'s shape, in FROZEN_KEYS order. */
function statusVocab(hidden: readonly string[] = []): MindVocabOption[] {
  return ['new', 'in_progress', 'blocked', 'waiting_on', 'done', 'cancelled'].map((key) => ({
    key,
    label: key.toUpperCase(),
    hidden: hidden.includes(key),
  }))
}

function build(over: Partial<MindtreeInput> = {}): MindNode {
  return buildMindtree({
    entries: [],
    health: new Map(),
    tracks: [],
    // The default is NO HIERARCHY, which is what makes every case below a
    // regression test for the four-ring tree rather than a test of the new one.
    entities: [],
    vocab: statusVocab(),
    members: [],
    dimension: 'status',
    filter: EMPTY_FILTER as FilterState,
    ctx: CTX,
    collapsedIds: new Set(),
    leafThreshold: 100,
    ...over,
  })
}

// ── the invariants ─────────────────────────────────────────────────────────

function walk(node: MindNode, visit: (n: MindNode) => void): void {
  visit(node)
  for (const child of node.children) walk(child, visit)
}

function nodes(root: MindNode): MindNode[] {
  const out: MindNode[] = []
  walk(root, (n) => out.push(n))
  return out
}

/** A branch's count is exactly the sum of its children's — the header's rule 2. */
function assertCountsRollUp(root: MindNode): void {
  for (const node of nodes(root)) {
    if (node.children.length === 0) continue
    const sum = node.children.reduce((n, child) => n + child.count, 0)
    expect(sum, `${node.id} count`).toBe(node.count)
  }
}

/** The four level counters partition the count, at every level of the tree. */
function assertLevelsSum(root: MindNode): void {
  for (const node of nodes(root)) {
    const levels = node.health.levels
    const sum = levels.ok + levels.stale + levels.overdue + levels.critical
    expect(sum, `${node.id} levels`).toBe(node.count)
  }
}

function assertSound(root: MindNode): void {
  assertCountsRollUp(root)
  assertLevelsSum(root)
  // Ids address `collapsedIds` entries that outlive a reload and double as DOM
  // ids; a collision would silently collapse two branches together.
  const ids = nodes(root).map((n) => n.id)
  expect(new Set(ids).size).toBe(ids.length)
}

function child(node: MindNode, index: number): MindNode {
  const found = node.children[index]
  if (!found) throw new Error(`no child ${index} of ${node.id} (has ${node.children.length})`)
  return found
}

function labels(node: MindNode): string[] {
  return node.children.map((c) => (c.label.kind === 'key' ? c.label.key : c.label.text))
}

// ── the regression golden ──────────────────────────────────────────────────
//
// ONE LINE PER NODE, CARRYING EVERY FIELD OF `MindNode` EXCEPT `children`
// (which the pre-order walk covers by position, plus its length on each line).
// So a line-for-line match IS a byte-for-byte match of the tree, expressed in
// something a reviewer can read in a diff instead of a 6 kB JSON blob.
//
// The expected value below was CAPTURED FROM THE PREVIOUS BUILD of model.ts —
// the four-ring one, before the hierarchy existed — and not hand-written from
// the new code. That is the whole point: it is evidence about the old tree, not
// a restatement of the new one.

function digest(root: MindNode): string[] {
  const out: string[] = []
  walk(root, (n) => {
    const levels = n.health.levels
    out.push(
      [
        n.depth,
        n.kind,
        n.id,
        JSON.stringify(n.label),
        `n=${n.count}`,
        `[${levels.ok},${levels.stale},${levels.overdue},${levels.critical}]`,
        n.health.slaBreached ? 'sla' : '-',
        n.collapsed ? 'closed' : 'open',
        n.retired ? 'retired' : '-',
        `entry=${JSON.stringify(n.entryId)}`,
        `bucket=${JSON.stringify(n.bucketKey)}`,
        JSON.stringify(n.colourVars),
        `kids=${n.children.length}`,
      ].join(' '),
    )
  })
  return out
}

/**
 * A workspace that touches every branch of the old builder at once: two live
 * tracks, an archived one that still holds work, the untracked pile, a track id
 * nothing explains, a fold, a collapsed branch, an SLA breach behind that fold,
 * and three of the four health levels.
 */
const GOLDEN_TRACKS: MindTrack[] = [
  track({ id: 'tr-a', label: 'Network', sortOrder: 0 }),
  track({ id: 'tr-b', label: 'PMO', sortOrder: 1, color: '#f0f', colorLight: '#a0a' }),
  track({ id: 'tr-z', label: 'Legacy', sortOrder: 9, archived: true }),
]

const GOLDEN_ENTRIES: Entry[] = [
  entry({ id: 'e1', track_id: 'tr-a', status: 'new', title: 'Alpha' }),
  entry({ id: 'e2', track_id: 'tr-a', status: 'new', title: 'Bravo' }),
  entry({ id: 'e3', track_id: 'tr-a', status: 'new', title: 'Charlie' }),
  entry({ id: 'e4', track_id: 'tr-a', status: 'new', title: 'Delta' }),
  entry({ id: 'e5', track_id: 'tr-a', status: 'blocked', title: 'Echo' }),
  entry({ id: 'e6', track_id: 'tr-b', status: 'in_progress', title: 'Foxtrot' }),
  entry({ id: 'e7', track_id: 'tr-z', status: 'new', title: 'Golf' }),
  entry({ id: 'e8', track_id: null, status: 'new', title: 'Hotel' }),
  entry({ id: 'e9', track_id: 'tr-gone', status: 'new', title: 'India' }),
]

const GOLDEN_HEALTH = healthMap(
  health('e1', 'stale'),
  health('e4', 'overdue', true),
  health('e5', 'critical'),
  health('e6', 'overdue'),
)

function goldenTree(over: Partial<MindtreeInput> = {}): MindNode {
  return build({
    tracks: GOLDEN_TRACKS,
    entries: GOLDEN_ENTRIES,
    health: GOLDEN_HEALTH,
    leafThreshold: 2,
    collapsedIds: new Set(['root/track:tr-b']),
    ...over,
  })
}

const GOLDEN: string[] = [
  '0 root root {"kind":"key","key":"app.name"} n=9 [5,1,2,1] sla open - entry=null bucket=null {} kids=5',
  '1 track root/track:tr-a {"kind":"text","text":"Network"} n=5 [2,1,1,1] sla open - entry=null bucket="tr-a" {"--track-c-dark":"#22d3ee","--track-c-light":"#0e7490"} kids=2',
  '2 group root/track:tr-a/group:new {"kind":"text","text":"NEW"} n=4 [2,1,1,0] sla open - entry=null bucket="new" {"--track-c-dark":"#22d3ee","--track-c-light":"#0e7490"} kids=3',
  '3 entry root/track:tr-a/group:new/entry:e1 {"kind":"text","text":"Alpha"} n=1 [0,1,0,0] - open - entry="e1" bucket=null {"--track-c-dark":"#22d3ee","--track-c-light":"#0e7490"} kids=0',
  '3 entry root/track:tr-a/group:new/entry:e2 {"kind":"text","text":"Bravo"} n=1 [1,0,0,0] - open - entry="e2" bucket=null {"--track-c-dark":"#22d3ee","--track-c-light":"#0e7490"} kids=0',
  '3 more root/track:tr-a/group:new/more {"kind":"key","key":"mindtree.more","vars":{"count":2}} n=2 [1,0,1,0] sla closed - entry=null bucket=null {"--track-c-dark":"#22d3ee","--track-c-light":"#0e7490"} kids=2',
  '4 entry root/track:tr-a/group:new/more/entry:e3 {"kind":"text","text":"Charlie"} n=1 [1,0,0,0] - open - entry="e3" bucket=null {"--track-c-dark":"#22d3ee","--track-c-light":"#0e7490"} kids=0',
  '4 entry root/track:tr-a/group:new/more/entry:e4 {"kind":"text","text":"Delta"} n=1 [0,0,1,0] sla open - entry="e4" bucket=null {"--track-c-dark":"#22d3ee","--track-c-light":"#0e7490"} kids=0',
  '2 group root/track:tr-a/group:blocked {"kind":"text","text":"BLOCKED"} n=1 [0,0,0,1] - open - entry=null bucket="blocked" {"--track-c-dark":"#22d3ee","--track-c-light":"#0e7490"} kids=1',
  '3 entry root/track:tr-a/group:blocked/entry:e5 {"kind":"text","text":"Echo"} n=1 [0,0,0,1] - open - entry="e5" bucket=null {"--track-c-dark":"#22d3ee","--track-c-light":"#0e7490"} kids=0',
  '1 track root/track:tr-b {"kind":"text","text":"PMO"} n=1 [0,0,1,0] - closed - entry=null bucket="tr-b" {"--track-c-dark":"#f0f","--track-c-light":"#a0a"} kids=1',
  '2 group root/track:tr-b/group:in_progress {"kind":"text","text":"IN_PROGRESS"} n=1 [0,0,1,0] - open - entry=null bucket="in_progress" {"--track-c-dark":"#f0f","--track-c-light":"#a0a"} kids=1',
  '3 entry root/track:tr-b/group:in_progress/entry:e6 {"kind":"text","text":"Foxtrot"} n=1 [0,0,1,0] - open - entry="e6" bucket=null {"--track-c-dark":"#f0f","--track-c-light":"#a0a"} kids=0',
  '1 track root/track: {"kind":"key","key":"entry.noTrack"} n=1 [1,0,0,0] - open - entry=null bucket="" {} kids=1',
  '2 group root/track:/group:new {"kind":"text","text":"NEW"} n=1 [1,0,0,0] - open - entry=null bucket="new" {} kids=1',
  '3 entry root/track:/group:new/entry:e8 {"kind":"text","text":"Hotel"} n=1 [1,0,0,0] - open - entry="e8" bucket=null {} kids=0',
  '1 track root/track:tr-z {"kind":"text","text":"Legacy"} n=1 [1,0,0,0] - open retired entry=null bucket="tr-z" {"--track-c-dark":"#22d3ee","--track-c-light":"#0e7490"} kids=1',
  '2 group root/track:tr-z/group:new {"kind":"text","text":"NEW"} n=1 [1,0,0,0] - open - entry=null bucket="new" {"--track-c-dark":"#22d3ee","--track-c-light":"#0e7490"} kids=1',
  '3 entry root/track:tr-z/group:new/entry:e7 {"kind":"text","text":"Golf"} n=1 [1,0,0,0] - open - entry="e7" bucket=null {"--track-c-dark":"#22d3ee","--track-c-light":"#0e7490"} kids=0',
  '1 track root/track:tr-gone {"kind":"key","key":"mindtree.unknownTrack"} n=1 [1,0,0,0] - open retired entry=null bucket="tr-gone" {} kids=1',
  '2 group root/track:tr-gone/group:new {"kind":"text","text":"NEW"} n=1 [1,0,0,0] - open - entry=null bucket="new" {} kids=1',
  '3 entry root/track:tr-gone/group:new/entry:e9 {"kind":"text","text":"India"} n=1 [1,0,0,0] - open - entry="e9" bucket=null {} kids=0',
]

// ── the hierarchy's own fixtures ───────────────────────────────────────────

function entityOf(over: Partial<MindEntity> & Pick<MindEntity, 'id' | 'trackId'>): MindEntity {
  return {
    parentId: null,
    label: over.id,
    sortOrder: 0,
    archived: false,
    typeKey: null,
    ...over,
  }
}

/** Every node of the tree, in the pre-order the picture and the table both read. */
function ids(root: MindNode): string[] {
  return nodes(root).map((n) => n.id)
}

function find(root: MindNode, id: string): MindNode {
  const found = nodes(root).find((n) => n.id === id)
  if (!found) throw new Error(`no node ${id} in [${ids(root).join(', ')}]`)
  return found
}

// ── the gate ───────────────────────────────────────────────────────────────

describe('with no hierarchy, the tree is the one that shipped', () => {
  it('is byte-identical to the four-ring builder, node for node', () => {
    // THE FIRST TEST WRITTEN AND THE ONE THAT MATTERS MOST. Everything below it
    // is a case about a tree with no entities in it, so if this passes, the map
    // that Aziz has been using is the map he still has — and the 3,477-test
    // suite around it is testing the same thing it was testing yesterday.
    //
    // If a future change reds this, that change altered the OLD tree, whatever
    // else it meant to do. Re-capture the expectation only after deciding, on
    // purpose, that the old tree should be different.
    expect(digest(goldenTree({ entities: [] }))).toEqual(GOLDEN)
  })

  it('draws no entity node and leaves entityType null everywhere', () => {
    for (const node of nodes(goldenTree({ entities: [] }))) {
      expect(node.kind, node.id).not.toBe('entity')
      expect(node.entityType, node.id).toBeNull()
    }
  })

  it('is unmoved by nodes belonging to tracks that are not in the workspace', () => {
    // A `map_nodes` row whose track was deleted is reachable from a cache one
    // deploy stale. It must not add a ring to a track that is drawn.
    const stray = entityOf({ id: 'n-stray', trackId: 'tr-nowhere' })
    expect(digest(goldenTree({ entities: [stray] }))).toEqual(GOLDEN)
  })
})

// ── ring 1 ─────────────────────────────────────────────────────────────────

describe('ring 1 — tracks', () => {
  const tracks = [
    track({ id: 'tr-a', label: 'Network', sortOrder: 0 }),
    track({ id: 'tr-b', label: 'PMO', sortOrder: 1 }),
  ]

  it('gives an empty track a node with count 0, not an absence', () => {
    const root = build({
      tracks,
      entries: [entry({ id: 'e1', track_id: 'tr-a' })],
    })

    expect(labels(root)).toEqual(['Network', 'PMO'])
    expect(child(root, 0).count).toBe(1)
    // The whole reason the node stays: "which track has nothing on it" is one of
    // the questions the map exists to answer.
    expect(child(root, 1).count).toBe(0)
    expect(child(root, 1).children).toEqual([])
    expect(child(root, 1).collapsed).toBe(false)
    assertSound(root)
  })

  it('orders by sort_order and carries each track colour as custom properties', () => {
    const root = build({
      tracks: [
        track({ id: 'tr-b', label: 'PMO', sortOrder: 5, color: '#f0f', colorLight: '#a0a' }),
        track({ id: 'tr-a', label: 'Network', sortOrder: 1 }),
      ],
    })

    expect(labels(root)).toEqual(['Network', 'PMO'])
    expect(child(root, 1).colourVars).toEqual({ '--track-c-dark': '#f0f', '--track-c-light': '#a0a' })
  })

  it('adds the untracked pile only when work needs it, and puts it last', () => {
    const without = build({ tracks, entries: [entry({ id: 'e1', track_id: 'tr-a' })] })
    expect(labels(without)).toEqual(['Network', 'PMO'])

    const withPile = build({
      tracks,
      entries: [entry({ id: 'e1', track_id: 'tr-a' }), entry({ id: 'e2', track_id: null })],
    })
    // Last, not first: this is an ordered overview, not the board's triage queue
    // — see trackDefs' note.
    expect(labels(withPile)).toEqual(['Network', 'PMO', 'entry.noTrack'])
    expect(withPile.children[2]?.count).toBe(1)
    expect(withPile.children[2]?.colourVars).toEqual({})
    assertSound(withPile)
  })

  it('keeps an archived track that still holds work, marked retired', () => {
    const root = build({
      tracks: [...tracks, track({ id: 'tr-z', label: 'Legacy', sortOrder: 9, archived: true })],
      entries: [entry({ id: 'e1', track_id: 'tr-a' }), entry({ id: 'e2', track_id: 'tr-z' })],
    })

    expect(labels(root)).toEqual(['Network', 'PMO', 'Legacy'])
    expect(child(root, 2).retired).toBe(true)
    expect(child(root, 2).count).toBe(1)
    // Dropping it would have made the root total 1 while two entries exist.
    expect(root.count).toBe(2)
    assertSound(root)
  })

  it('drops an archived track that holds nothing', () => {
    const root = build({
      tracks: [...tracks, track({ id: 'tr-z', label: 'Legacy', archived: true })],
      entries: [entry({ id: 'e1', track_id: 'tr-a' })],
    })
    expect(labels(root)).toEqual(['Network', 'PMO'])
  })

  it('rescues entries whose track_id no track explains', () => {
    // Reachable from the first-paint entry cache, which can be one deploy older
    // than the track list.
    const root = build({ tracks, entries: [entry({ id: 'e1', track_id: 'tr-gone' })] })

    expect(labels(root)).toEqual(['Network', 'PMO', 'mindtree.unknownTrack'])
    expect(child(root, 2).retired).toBe(true)
    expect(root.count).toBe(1)
    assertSound(root)
  })
})

// ── ring 2 ─────────────────────────────────────────────────────────────────

describe('ring 2 — the vocabulary dimensions', () => {
  const tracks = [track({ id: 'tr-a', label: 'Network' })]

  it('shows only populated groups, in the vocabulary order', () => {
    const root = build({
      tracks,
      entries: [
        entry({ id: 'e1', track_id: 'tr-a', status: 'blocked' }),
        entry({ id: 'e2', track_id: 'tr-a', status: 'new' }),
        entry({ id: 'e3', track_id: 'tr-a', status: 'blocked' }),
      ],
    })

    // FROZEN_KEYS order, not first-seen order: new precedes blocked even though
    // a blocked row arrived first. Thirty empty groups are a grid, not a shape —
    // so the four untouched statuses are absent.
    expect(labels(child(root, 0))).toEqual(['NEW', 'BLOCKED'])
    expect(child(child(root, 0), 1).count).toBe(2)
    assertSound(root)
  })

  it('follows an admin reorder of the vocabulary', () => {
    const reordered = statusVocab().reverse()
    const root = build({
      tracks,
      vocab: reordered,
      entries: [
        entry({ id: 'e1', track_id: 'tr-a', status: 'new' }),
        entry({ id: 'e2', track_id: 'tr-a', status: 'blocked' }),
      ],
    })
    expect(labels(child(root, 0))).toEqual(['BLOCKED', 'NEW'])
  })

  it('never shows a hidden option that holds nothing', () => {
    const root = build({
      tracks,
      vocab: statusVocab(['blocked', 'cancelled']),
      entries: [entry({ id: 'e1', track_id: 'tr-a', status: 'new' })],
    })
    expect(labels(child(root, 0))).toEqual(['NEW'])
  })

  it('still shows a hidden option that holds work, marked retired', () => {
    // store/vocab.ts's frozen rule — hiding an option must never hide DATA — and
    // this tree's own: a parent labelled 2 whose children sum to 1 is worse than
    // a greyed-out branch.
    const root = build({
      tracks,
      vocab: statusVocab(['blocked']),
      entries: [
        entry({ id: 'e1', track_id: 'tr-a', status: 'new' }),
        entry({ id: 'e2', track_id: 'tr-a', status: 'blocked' }),
      ],
    })

    const groups = child(root, 0)
    expect(labels(groups)).toEqual(['NEW', 'BLOCKED'])
    expect(child(groups, 1).retired).toBe(true)
    expect(groups.count).toBe(2)
    assertSound(root)
  })

  it('rescues a value the vocabulary does not declare', () => {
    const root = build({
      tracks,
      vocab: statusVocab().filter((o) => o.key !== 'blocked'),
      entries: [entry({ id: 'e1', track_id: 'tr-a', status: 'blocked' })],
    })
    expect(labels(child(root, 0))).toEqual(['mindtree.unknownGroup'])
    assertSound(root)
  })

  it('cuts by priority when asked', () => {
    const root = build({
      tracks,
      dimension: 'priority',
      vocab: [
        { key: 'low', label: 'Low', hidden: false },
        { key: 'medium', label: 'Medium', hidden: false },
        { key: 'high', label: 'High', hidden: false },
        { key: 'critical', label: 'Critical', hidden: false },
      ],
      entries: [
        entry({ id: 'e1', track_id: 'tr-a', priority: 'critical' }),
        entry({ id: 'e2', track_id: 'tr-a', priority: 'low' }),
      ],
    })
    expect(labels(child(root, 0))).toEqual(['Low', 'Critical'])
  })
})

describe('ring 2 — the health dimension', () => {
  const tracks = [track({ id: 'tr-a', label: 'Network' })]

  it('reads in the escalating order every chart legend uses, skipping empties', () => {
    const root = build({
      tracks,
      dimension: 'health',
      vocab: [],
      entries: [
        entry({ id: 'e1', track_id: 'tr-a' }),
        entry({ id: 'e2', track_id: 'tr-a' }),
        entry({ id: 'e3', track_id: 'tr-a' }),
      ],
      health: healthMap(health('e1', 'critical'), health('e2', 'stale'), health('e3', 'critical')),
    })

    expect(labels(child(root, 0))).toEqual(['health.stale', 'health.critical'])
    expect(child(child(root, 0), 1).count).toBe(2)
    assertSound(root)
  })

  it('files an entry the view has not answered for under ok, not a fifth level', () => {
    const root = build({
      tracks,
      dimension: 'health',
      vocab: [],
      entries: [entry({ id: 'e1', track_id: 'tr-a' })],
      health: new Map(),
    })
    expect(labels(child(root, 0))).toEqual(['health.ok'])
    assertSound(root)
  })
})

describe('ring 2 — the owner dimension', () => {
  const tracks = [track({ id: 'tr-a', label: 'Network' })]
  const members: MindMember[] = [
    { id: 'm-1', displayName: 'Layla' },
    { id: 'm-2', displayName: 'Omar' },
  ]

  const owned = [
    entry({ id: 'e1', track_id: 'tr-a', owner_id: 'm-2' }),
    entry({ id: 'e2', track_id: 'tr-a', owner_name: 'Acme Ltd' }),
    entry({ id: 'e3', track_id: 'tr-a' }),
    entry({ id: 'e4', track_id: 'tr-a', owner_id: 'm-1' }),
    entry({ id: 'e5', track_id: 'tr-a', owner_name: '  Acme Ltd  ' }),
  ]

  it('puts Unassigned first, then the roster, then free-text owners', () => {
    const root = build({ tracks, members, dimension: 'owner', vocab: [], entries: owned })
    const groups = child(root, 0)

    // Unassigned LEADS here even though the untracked pile trails in ring 1:
    // unclaimed work is the most actionable thing on the screen.
    expect(labels(groups)).toEqual(['entry.unassigned', 'Layla', 'Omar', 'Acme Ltd'])
    assertSound(root)
  })

  it('buckets a free-text owner separately from every member id', () => {
    const root = build({ tracks, members, dimension: 'owner', vocab: [], entries: owned })
    const groups = child(root, 0)

    // The vendor's two rows collapse into one bucket (the name is trimmed) and
    // that bucket is nobody's member row.
    expect(child(groups, 3).count).toBe(2)
    expect(child(groups, 3).bucketKey).toBe('name:Acme Ltd')
    expect(child(groups, 3).retired).toBe(false)
    for (const group of groups.children) expect(group.bucketKey).not.toBe('m-3')
    expect(child(groups, 1).count).toBe(1)
    expect(child(groups, 2).count).toBe(1)
    expect(child(groups, 0).count).toBe(1)
  })

  it('keeps two spellings of one vendor apart, ordered deterministically', () => {
    const root = build({
      tracks,
      members,
      dimension: 'owner',
      vocab: [],
      entries: [
        entry({ id: 'e1', track_id: 'tr-a', owner_name: 'Zenith' }),
        entry({ id: 'e2', track_id: 'tr-a', owner_name: 'ACME Ltd' }),
        entry({ id: 'e3', track_id: 'tr-a', owner_name: 'Acme' }),
      ],
    })
    // Folded ordering, so case does not scatter the list; "Acme" and "ACME Ltd"
    // stay two buckets, because merging them would be a guess about a company
    // name this module has no business making.
    expect(labels(child(root, 0))).toEqual(['Acme', 'ACME Ltd', 'Zenith'])
  })

  it('prefers owner_id over a stale owner_name on the same row', () => {
    const root = build({
      tracks,
      members,
      dimension: 'owner',
      vocab: [],
      entries: [entry({ id: 'e1', track_id: 'tr-a', owner_id: 'm-1', owner_name: 'Acme Ltd' })],
    })
    expect(labels(child(root, 0))).toEqual(['Layla'])
  })

  it('retires an owner id the roster no longer explains, and never prints it', () => {
    const root = build({
      tracks,
      members,
      dimension: 'owner',
      vocab: [],
      entries: [entry({ id: 'e1', track_id: 'tr-a', owner_id: 'm-gone' })],
    })
    const group = child(child(root, 0), 0)
    expect(group.label).toEqual({ kind: 'key', key: 'mindtree.unknownOwner' })
    expect(group.retired).toBe(true)
    // The id is the bucket, never the label: nothing in this app renders a raw
    // uuid at a person.
    expect(group.bucketKey).toBe('m-gone')
  })

  it('does not render a name-shaped hole for a half-provisioned account', () => {
    const root = build({
      tracks,
      members: [{ id: 'm-1', displayName: '   ' }],
      dimension: 'owner',
      vocab: [],
      entries: [entry({ id: 'e1', track_id: 'tr-a', owner_id: 'm-1' })],
    })
    expect(labels(child(root, 0))).toEqual(['mindtree.unknownOwner'])
  })

  it('skips a member who owns nothing', () => {
    const root = build({
      tracks,
      members,
      dimension: 'owner',
      vocab: [],
      entries: [entry({ id: 'e1', track_id: 'tr-a', owner_id: 'm-2' })],
    })
    expect(labels(child(root, 0))).toEqual(['Omar'])
  })
})

// ── ring 3 ─────────────────────────────────────────────────────────────────

describe('ring 3 — leaves and the fold', () => {
  const tracks = [track({ id: 'tr-a', label: 'Network' })]
  const five = [1, 2, 3, 4, 5].map((n) => entry({ id: `e${n}`, track_id: 'tr-a', title: `Item ${n}` }))

  it('folds the tail into a "+N more" past the threshold', () => {
    const root = build({ tracks, entries: five, leafThreshold: 2 })
    const group = child(child(root, 0), 0)

    expect(group.children.map((c) => c.kind)).toEqual(['entry', 'entry', 'more'])
    const more = child(group, 2)
    expect(more.count).toBe(3)
    expect(more.label).toEqual({ kind: 'key', key: 'mindtree.more', vars: { count: 3 } })
    expect(group.count).toBe(5)
    assertSound(root)
  })

  it('keeps the folded entries as children so the table can still reach them', () => {
    const root = build({ tracks, entries: five, leafThreshold: 2 })
    const more = child(child(child(root, 0), 0), 2)

    // Collapsed, not empty. A node that vanished when you opened it would drop
    // keyboard focus, and the accessible table walks `children` regardless.
    expect(more.collapsed).toBe(true)
    expect(more.children).toHaveLength(3)
    expect(visibleChildren(more)).toEqual([])
    expect(more.children.map((c) => c.entryId)).toEqual(['e3', 'e4', 'e5'])
  })

  it('opens the fold when its id is in expandedIds', () => {
    const first = build({ tracks, entries: five, leafThreshold: 2 })
    const moreId = child(child(child(first, 0), 0), 2).id

    const root = build({ tracks, entries: five, leafThreshold: 2, expandedIds: new Set([moreId]) })
    const more = child(child(child(root, 0), 0), 2)
    expect(more.collapsed).toBe(false)
    expect(visibleChildren(more)).toHaveLength(3)
    assertSound(root)
  })

  it('never mints a "+1 more" — it costs a click and saves no row', () => {
    const root = build({ tracks, entries: five.slice(0, 4), leafThreshold: 3 })
    const group = child(child(root, 0), 0)
    expect(group.children.map((c) => c.kind)).toEqual(['entry', 'entry', 'entry', 'entry'])
  })

  it('folds everything at threshold 0 — the depth-limited mobile view', () => {
    const root = build({ tracks, entries: five, leafThreshold: 0 })
    const group = child(child(root, 0), 0)
    expect(group.children.map((c) => c.kind)).toEqual(['more'])
    expect(child(group, 0).count).toBe(5)
    assertSound(root)
  })

  it('survives a NaN threshold rather than rendering the whole workspace', () => {
    const root = build({ tracks, entries: five, leafThreshold: Number.NaN })
    expect(child(child(root, 0), 0).children.map((c) => c.kind)).toEqual(['more'])
  })

  it('leaves carry the entry id, the title verbatim, and the branch colour', () => {
    const root = build({ tracks, entries: five.slice(0, 1) })
    const leaf = child(child(child(root, 0), 0), 0)

    expect(leaf.kind).toBe('entry')
    expect(leaf.entryId).toBe('e1')
    // A title is database text — never a key, and isolated by the renderer.
    expect(leaf.label).toEqual({ kind: 'text', text: 'Item 1' })
    expect(leaf.colourVars).toEqual({ '--track-c-dark': '#22d3ee', '--track-c-light': '#0e7490' })
    expect(leaf.collapsed).toBe(false)
  })

  it('orders leaves by the sort the filter carries', () => {
    const root = build({
      tracks,
      entries: [
        entry({ id: 'e1', track_id: 'tr-a', title: 'Beta' }),
        entry({ id: 'e2', track_id: 'tr-a', title: 'Alpha' }),
      ],
      filter: { ...EMPTY_FILTER, sort: 'title' } as FilterState,
    })
    expect(labels(child(child(root, 0), 0))).toEqual(['Alpha', 'Beta'])
  })
})

// ── the roll-up ────────────────────────────────────────────────────────────

describe('the roll-up', () => {
  const tracks = [track({ id: 'tr-a', label: 'Network' }), track({ id: 'tr-b', label: 'PMO' })]

  it('sums counts and level splits at every level of the tree', () => {
    const root = build({
      tracks,
      entries: [
        entry({ id: 'e1', track_id: 'tr-a', status: 'new' }),
        entry({ id: 'e2', track_id: 'tr-a', status: 'blocked' }),
        entry({ id: 'e3', track_id: 'tr-b', status: 'new' }),
        entry({ id: 'e4', track_id: null, status: 'new' }),
      ],
      health: healthMap(health('e1', 'overdue'), health('e2', 'stale'), health('e3', 'ok')),
    })

    expect(root.count).toBe(4)
    expect(root.health.levels).toEqual({ ok: 2, stale: 1, overdue: 1, critical: 0 })
    expect(child(root, 0).health.levels).toEqual({ ok: 0, stale: 1, overdue: 1, critical: 0 })
    assertSound(root)
  })

  it('carries an SLA breach all the way up, even from behind a fold', () => {
    const many = [1, 2, 3, 4, 5].map((n) => entry({ id: `e${n}`, track_id: 'tr-a' }))
    const root = build({
      tracks,
      entries: many,
      leafThreshold: 2,
      // The breach is on e5 — the last row of the folded tail.
      health: healthMap(health('e5', 'overdue', true)),
    })

    const group = child(child(root, 0), 0)
    const more = child(group, 2)
    expect(more.health.slaBreached).toBe(true)
    expect(group.health.slaBreached).toBe(true)
    expect(child(root, 0).health.slaBreached).toBe(true)
    expect(root.health.slaBreached).toBe(true)
    // …and nowhere else. A branch that carried a sibling's breach would be an
    // alarm pointing at the wrong track.
    expect(child(root, 1).health.slaBreached).toBe(false)
  })

  it('leaves a calm tree calm', () => {
    const root = build({
      tracks,
      entries: [entry({ id: 'e1', track_id: 'tr-a' })],
      health: healthMap(health('e1', 'ok')),
    })
    expect(root.health.slaBreached).toBe(false)
    expect(root.health.levels).toEqual({ ok: 1, stale: 0, overdue: 0, critical: 0 })
  })
})

// ── the filter ─────────────────────────────────────────────────────────────

describe('the filter', () => {
  const tracks = [track({ id: 'tr-a', label: 'Network' }), track({ id: 'tr-b', label: 'PMO' })]
  const entries = [
    entry({ id: 'e1', track_id: 'tr-a', status: 'new', priority: 'high' }),
    entry({ id: 'e2', track_id: 'tr-a', status: 'blocked', priority: 'low' }),
    entry({ id: 'e3', track_id: 'tr-b', status: 'new', priority: 'high' }),
    entry({ id: 'e4', track_id: 'tr-b', status: 'new', priority: 'low' }),
  ]

  it('narrows every count in step, from the root to the leaf', () => {
    const all = build({ tracks, entries })
    expect(all.count).toBe(4)
    expect(child(all, 0).count).toBe(2)
    expect(child(all, 1).count).toBe(2)

    const high = build({ tracks, entries, filter: { ...EMPTY_FILTER, priorities: ['high'] } as FilterState })
    expect(high.count).toBe(2)
    expect(child(high, 0).count).toBe(1)
    expect(child(high, 1).count).toBe(1)
    // The blocked group went with its only row rather than lingering at 0 —
    // filtering happens BEFORE grouping, so a group cannot outlive its contents.
    expect(labels(child(high, 0))).toEqual(['NEW'])
    assertSound(high)
  })

  it('keeps a track node at 0 when the filter empties it', () => {
    const root = build({
      tracks,
      entries,
      filter: { ...EMPTY_FILTER, trackIds: ['tr-a'] } as FilterState,
    })
    expect(root.count).toBe(2)
    expect(child(root, 0).count).toBe(2)
    // Ring 1 is the workspace's shape, not the filter's: PMO stays, at zero.
    expect(child(root, 1).count).toBe(0)
    assertSound(root)
  })

  it('honours the scope facet — a closed entry is out of an open-scoped map', () => {
    const withClosed = [...entries, entry({ id: 'e5', track_id: 'tr-a', status: 'done' })]

    const open = build({ tracks, entries: withClosed })
    expect(open.count).toBe(4)

    const everything = build({
      tracks,
      entries: withClosed,
      filter: { ...EMPTY_FILTER, scope: 'all' } as FilterState,
    })
    expect(everything.count).toBe(5)
    expect(labels(child(everything, 0))).toEqual(['NEW', 'BLOCKED', 'DONE'])
    assertSound(everything)
  })

  it('empties to a root of 0 with every track still drawn', () => {
    const root = build({
      tracks,
      entries,
      filter: { ...EMPTY_FILTER, search: 'nothing matches this' } as FilterState,
    })
    expect(root.count).toBe(0)
    // The page tells "no work yet" from "filtered to nothing" by asking the
    // FILTER, not this tree — which is why the tracks are still here to draw.
    expect(labels(root)).toEqual(['Network', 'PMO'])
    assertSound(root)
  })
})

// ── collapse, ids, determinism ─────────────────────────────────────────────

describe('collapse and identity', () => {
  const tracks = [track({ id: 'tr-a', label: 'Network' })]
  const entries = [entry({ id: 'e1', track_id: 'tr-a' }), entry({ id: 'e2', track_id: 'tr-a' })]

  it('collapses a branch without pruning it', () => {
    const open = build({ tracks, entries })
    const trackId = child(open, 0).id

    const root = build({ tracks, entries, collapsedIds: new Set([trackId]) })
    const node = child(root, 0)
    expect(node.collapsed).toBe(true)
    expect(node.children).toHaveLength(1)
    expect(visibleChildren(node)).toEqual([])
    // The count is untouched by collapsing: the branch still says 2.
    expect(node.count).toBe(2)
    assertSound(root)
  })

  it('never reports a childless node as collapsed', () => {
    const root = build({
      tracks: [...tracks, track({ id: 'tr-b', label: 'PMO', sortOrder: 1 })],
      entries,
      collapsedIds: new Set([`${ROOT_ID}/track:tr-b`]),
    })
    // aria-expanded on a leaf is a lie a screen reader reads out loud.
    expect(child(root, 1).children).toEqual([])
    expect(child(root, 1).collapsed).toBe(false)
  })

  it('builds ids that are safe as DOM ids and cannot forge a path', () => {
    const root = build({
      tracks,
      dimension: 'owner',
      vocab: [],
      members: [],
      entries: [entry({ id: 'e1', track_id: 'tr-a', owner_name: 'a/b c' })],
    })
    const group = child(child(root, 0), 0)
    expect(group.id).toBe(`${ROOT_ID}/track:tr-a/group:name%3Aa%2Fb%20c`)
    expect(group.id).not.toMatch(/\s/)
    assertSound(root)
  })

  it('is deterministic — same input, byte-identical tree', () => {
    const input = {
      tracks,
      entries,
      dimension: 'owner' as const,
      vocab: [],
      members: [{ id: 'm-1', displayName: 'Layla' }],
      leafThreshold: 1,
    }
    expect(JSON.stringify(build(input))).toBe(JSON.stringify(build(input)))
  })

  it('depths climb one ring at a time', () => {
    // Three rows against a threshold of one, so the tail is genuinely worth a
    // fold — two rows would render both rather than mint a "+1 more".
    const three = [...entries, entry({ id: 'e3', track_id: 'tr-a' })]
    const root = build({ tracks, entries: three, leafThreshold: 1 })
    const group = child(child(root, 0), 0)
    const more = child(group, 1)
    expect([root.depth, child(root, 0).depth, group.depth, more.depth]).toEqual([0, 1, 2, 3])
    // An entry revealed under a fold sits one ring deeper than one that was
    // never folded — `aria-level` is depth + 1 and must not lie.
    expect(child(group, 0).depth).toBe(3)
    expect(child(more, 0).depth).toBe(4)
  })

  it('roots at the workspace name and never collapses the root', () => {
    const root = build({ tracks, entries, collapsedIds: new Set([ROOT_ID]) })
    expect(root.id).toBe(ROOT_ID)
    expect(root.label).toEqual({ kind: 'key', key: 'app.name' })
    expect(root.collapsed).toBe(false)
  })
})

describe('openDepth — the ring the map opens at', () => {
  const tracks = [track({ id: 'tr-a', label: 'Network' })]
  const entries = [entry({ id: 'e1', track_id: 'tr-a' }), entry({ id: 'e2', track_id: 'tr-a' })]

  it('closes every branch at or below the depth, with the tree intact behind it', () => {
    // The defect this exists for: the first paint used to open through ring 3,
    // which on a real workspace fits at 0.23 and renders 2.9px labels. Opening
    // at the track ring fits at 1:1.
    const root = build({ tracks, entries, openDepth: 1 })
    const node = child(root, 0)
    expect(node.collapsed).toBe(true)
    expect(visibleChildren(node)).toEqual([])
    // Collapsing is a RENDERING decision, never a pruning one — the table
    // walks these children and must carry the same numbers as the picture.
    expect(node.children).toHaveLength(1)
    expect(node.count).toBe(2)
    assertSound(root)
  })

  it('leaves the whole tree open when it is omitted', () => {
    const root = build({ tracks, entries })
    expect(child(root, 0).collapsed).toBe(false)
    expect(child(child(root, 0), 0).collapsed).toBe(false)
  })

  it('never collapses the root, whatever the depth says', () => {
    // A collapsed root is a blank screen with no affordance left to un-blank it.
    expect(build({ tracks, entries, openDepth: 0 }).collapsed).toBe(false)
  })

  it('lets an EXPLICIT open beat the default', () => {
    // The half that makes the default changeable: without it, every track the
    // reader opened would slam shut on the next render.
    const trackId = `${ROOT_ID}/track:tr-a`
    const root = build({ tracks, entries, openDepth: 1, expandedIds: new Set([trackId]) })
    expect(child(root, 0).collapsed).toBe(false)
  })

  it('lets an EXPLICIT close beat an explicit open', () => {
    const trackId = `${ROOT_ID}/track:tr-a`
    const root = build({
      tracks,
      entries,
      openDepth: 1,
      collapsedIds: new Set([trackId]),
      expandedIds: new Set([trackId]),
    })
    expect(child(root, 0).collapsed).toBe(true)
  })

  it('still never reports a childless node as collapsed', () => {
    const root = build({
      tracks: [...tracks, track({ id: 'tr-b', label: 'PMO', sortOrder: 1 })],
      entries,
      openDepth: 1,
    })
    expect(child(root, 1).children).toEqual([])
    expect(child(root, 1).collapsed).toBe(false)
  })

  it('keeps a "+N more" closed at every depth, including none', () => {
    // A fold reads `expandedIds` directly rather than going through the depth
    // rule: it exists because its group already overflowed, so a build with no
    // openDepth must not open every tail in the workspace at once.
    const three = [...entries, entry({ id: 'e3', track_id: 'tr-a' })]
    for (const openDepth of [undefined, 1, 9]) {
      const root = build({ tracks, entries: three, leafThreshold: 1, openDepth })
      const group = child(child(root, 0), 0)
      expect(child(group, 1).kind).toBe('more')
      expect(child(group, 1).collapsed).toBe(true)
    }
  })

  it('refuses a NaN depth rather than closing everything', () => {
    // The number reaches here from a constant today and could reach it from a
    // measurement tomorrow; a NaN comparison is false, which must mean "open".
    const root = build({ tracks, entries, openDepth: Number.NaN })
    expect(child(root, 0).collapsed).toBe(false)
  })
})

describe('groupTotals — ring 2 summed across ring 1', () => {
  const tracks = [
    track({ id: 'tr-a', label: 'Network', sortOrder: 0 }),
    track({ id: 'tr-b', label: 'PMO', sortOrder: 1 }),
  ]

  function owned(): MindNode {
    return build({
      tracks,
      dimension: 'owner',
      vocab: [],
      members: [
        { id: 'm-1', displayName: 'Layla' },
        { id: 'm-2', displayName: 'Omar' },
      ],
      entries: [
        entry({ id: 'e1', track_id: 'tr-a', owner_id: 'm-1' }),
        entry({ id: 'e2', track_id: 'tr-a', owner_id: 'm-1' }),
        entry({ id: 'e3', track_id: 'tr-b', owner_id: 'm-1' }),
        entry({ id: 'e4', track_id: 'tr-b', owner_id: 'm-2' }),
      ],
    })
  }

  it('answers "who is overloaded", which the nested rings cannot', () => {
    // Layla is TWO nodes on the map — two under Network, one under PMO — and
    // the reader is left to add them up by eye. This is the sum.
    const totals = groupTotals(owned())
    expect(totals.map((g) => [g.label, g.count])).toEqual([
      [{ kind: 'text', text: 'Layla' }, 3],
      [{ kind: 'text', text: 'Omar' }, 1],
    ])
  })

  it('sums to the root, so the second block cannot disagree with the first', () => {
    const root = owned()
    expect(groupTotals(root).reduce((n, g) => n + g.count, 0)).toBe(root.count)
  })

  it('orders by size, tied on the tree order, so the result is TOTAL', () => {
    const root = build({
      tracks,
      dimension: 'health',
      vocab: [],
      entries: [
        entry({ id: 'e1', track_id: 'tr-a' }),
        entry({ id: 'e2', track_id: 'tr-b' }),
      ],
      health: healthMap(health('e1', 'ok'), health('e2', 'overdue')),
    })
    // Both buckets hold one. HEALTH_ORDER puts `ok` first in the tree, so the
    // tiebreak has to keep it first here — twice in a row.
    const once = groupTotals(root).map((g) => g.key)
    expect(once).toEqual(['ok', 'overdue'])
    expect(groupTotals(root).map((g) => g.key)).toEqual(once)
  })

  it('marks a bucket retired only when nobody has it live', () => {
    // A vocabulary option hidden workspace-wide is retired everywhere; an
    // owner id one track has forgotten may still be live under another.
    const root = build({
      tracks,
      vocab: statusVocab(['blocked']),
      entries: [
        entry({ id: 'e1', track_id: 'tr-a', status: 'blocked' }),
        entry({ id: 'e2', track_id: 'tr-b', status: 'new' }),
      ],
    })
    const totals = groupTotals(root)
    expect(totals.find((g) => g.key === 'blocked')?.retired).toBe(true)
    expect(totals.find((g) => g.key === 'new')?.retired).toBe(false)
  })

  it('is empty for a workspace with nothing open', () => {
    expect(groupTotals(build({ tracks }))).toEqual([])
  })
})

// ── the hierarchy ──────────────────────────────────────────────────────────

describe('the hierarchy — UHR > OB > Org', () => {
  const tracks = [track({ id: 'uhr', label: 'UHR' })]
  const entities = [
    entityOf({ id: 'ob', trackId: 'uhr', label: 'Onboarding', typeKey: 'Phase' }),
    entityOf({ id: 'org1', trackId: 'uhr', parentId: 'ob', label: 'Org One', typeKey: 'Organization' }),
    entityOf({ id: 'org2', trackId: 'uhr', parentId: 'ob', label: 'Org Two', sortOrder: 1, typeKey: 'Organization' }),
  ]

  it('nests to arbitrary depth, one ring per level, buckets below', () => {
    const root = build({
      tracks,
      entities,
      entries: [entry({ id: 'e1', track_id: 'uhr', node_id: 'org1', status: 'blocked' })],
    })

    expect(ids(root)).toEqual([
      'root',
      'root/track:uhr',
      'root/track:uhr/entity:ob',
      'root/track:uhr/entity:ob/entity:org1',
      'root/track:uhr/entity:ob/entity:org1/group:blocked',
      'root/track:uhr/entity:ob/entity:org1/group:blocked/entry:e1',
      'root/track:uhr/entity:ob/entity:org2',
    ])
    // depth is parent.depth + 1 all the way down, and the bucket ring moved with
    // it — a status group under an Org under a phase is at 4, not the literal 2
    // three hand-written builders used to write.
    expect(nodes(root).map((n) => n.depth)).toEqual([0, 1, 2, 3, 4, 5, 3])
    assertSound(root)
  })

  it('is an entity, never a track — bucketKey is a node id and kind says so', () => {
    const root = build({ tracks, entities })
    const org = find(root, 'root/track:uhr/entity:ob/entity:org1')

    // The forty lines across five files that read `kind === 'track'` as
    // "bucketKey is a TRACK id" must not see this node. `foldPath` writing
    // `patch.trackId = 'org1'` is an FK violation on a good day.
    expect(org.kind).toBe('entity')
    expect(org.bucketKey).toBe('org1')
    expect(find(root, 'root/track:uhr').kind).toBe('track')
    expect(find(root, 'root/track:uhr').bucketKey).toBe('uhr')
  })

  it('carries the node kind through untouched, and null when there is none', () => {
    const root = build({
      tracks,
      entities: [...entities, entityOf({ id: 'loose', trackId: 'uhr', sortOrder: 5 })],
    })
    expect(find(root, 'root/track:uhr/entity:ob').entityType).toBe('Phase')
    expect(find(root, 'root/track:uhr/entity:ob/entity:org1').entityType).toBe('Organization')
    // `map_nodes.kind_id` is `on delete set null`: retiring a kind un-kinds its
    // nodes rather than deleting the organizations filed under them.
    expect(find(root, 'root/track:uhr/entity:loose').entityType).toBeNull()
  })

  it('inherits the track colour at every depth and never picks one', () => {
    const root = build({
      tracks: [track({ id: 'uhr', label: 'UHR', color: '#f0f', colorLight: '#a0a' })],
      entities,
      entries: [entry({ id: 'e1', track_id: 'uhr', node_id: 'org1' })],
    })
    const vars = { '--track-c-dark': '#f0f', '--track-c-light': '#a0a' }
    for (const node of nodes(root)) {
      if (node.id === ROOT_ID) continue
      expect(node.colourVars, node.id).toEqual(vars)
    }
  })

  it('orders siblings by sort_order, tied on the id so the order is TOTAL', () => {
    const root = build({
      tracks,
      entities: [
        entityOf({ id: 'b', trackId: 'uhr', label: 'Beta', sortOrder: 0 }),
        entityOf({ id: 'a', trackId: 'uhr', label: 'Alpha', sortOrder: 0 }),
        entityOf({ id: 'z', trackId: 'uhr', label: 'Zulu', sortOrder: -1 }),
      ],
    })
    // sort_order defaults to 0 and a reorder rewrites only the branch it was
    // handed, so ties are ordinary — and two Orgs swapping places between
    // renders reads as the map rearranging itself for no reason.
    expect(labels(find(root, 'root/track:uhr'))).toEqual(['Zulu', 'Alpha', 'Beta'])
  })
})

describe('the hierarchy — structure is drawn, buckets are earned', () => {
  const tracks = [track({ id: 'uhr', label: 'UHR' })]

  it('draws an Org with no open work at all — that is the question the map answers', () => {
    const root = build({
      tracks,
      entities: [entityOf({ id: 'org1', trackId: 'uhr', label: 'Org One' })],
    })
    const org = find(root, 'root/track:uhr/entity:org1')
    expect(org.count).toBe(0)
    expect(org.children).toEqual([])
    // Never collapsed with nothing under it: aria-expanded on a leaf is a lie a
    // screen reader reads out loud. focus.ts still lets it be focused.
    expect(org.collapsed).toBe(false)
    assertSound(root)
  })

  it('draws no empty status bucket beneath it — a grid is not a shape', () => {
    const root = build({
      tracks,
      entities: [entityOf({ id: 'org1', trackId: 'uhr' })],
      entries: [entry({ id: 'e1', track_id: 'uhr', node_id: 'org1', status: 'blocked' })],
    })
    expect(labels(find(root, 'root/track:uhr/entity:org1'))).toEqual(['BLOCKED'])
  })

  it('puts child entities FIRST, then the buckets for work filed on the node itself', () => {
    // Programme-level work filed on OB rather than on any one Org is ordinary,
    // and it goes in a bucket ring BESIDE the Org ring — not inside a synthetic
    // "items filed here" node, which would cost a ring and a tap on the
    // commonest path.
    const root = build({
      tracks,
      entities: [
        entityOf({ id: 'ob', trackId: 'uhr', label: 'Onboarding' }),
        entityOf({ id: 'org1', trackId: 'uhr', parentId: 'ob', label: 'Org One' }),
      ],
      entries: [
        entry({ id: 'e1', track_id: 'uhr', node_id: 'ob', status: 'new' }),
        entry({ id: 'e2', track_id: 'uhr', node_id: 'org1', status: 'new' }),
      ],
    })
    const ob = find(root, 'root/track:uhr/entity:ob')
    expect(ob.children.map((c) => c.kind)).toEqual(['entity', 'group'])
    expect(labels(ob)).toEqual(['Org One', 'NEW'])
    assertSound(root)
  })

  it('counts direct work plus the subtree, and the buckets sum to the direct half', () => {
    const root = build({
      tracks,
      entities: [
        entityOf({ id: 'ob', trackId: 'uhr' }),
        entityOf({ id: 'org1', trackId: 'uhr', parentId: 'ob' }),
        entityOf({ id: 'org2', trackId: 'uhr', parentId: 'ob', sortOrder: 1 }),
      ],
      entries: [
        entry({ id: 'e1', track_id: 'uhr', node_id: 'ob', status: 'new' }),
        entry({ id: 'e2', track_id: 'uhr', node_id: 'ob', status: 'blocked' }),
        entry({ id: 'e3', track_id: 'uhr', node_id: 'org1' }),
        entry({ id: 'e4', track_id: 'uhr', node_id: 'org2' }),
        entry({ id: 'e5', track_id: 'uhr', node_id: 'org2' }),
        entry({ id: 'e6', track_id: 'uhr' }),
      ],
    })

    const ob = find(root, 'root/track:uhr/entity:ob')
    expect(ob.count).toBe(5)
    // 2 direct + org1's 1 + org2's 2, and the two status buckets sum to the 2.
    const buckets = ob.children.filter((c) => c.kind === 'group')
    expect(buckets.reduce((n, b) => n + b.count, 0)).toBe(2)
    expect(find(root, 'root/track:uhr').count).toBe(6)
    expect(root.count).toBe(6)
    assertSound(root)
  })

  it('rolls the health split and the SLA breach up through every entity ring', () => {
    const root = build({
      tracks,
      entities: [
        entityOf({ id: 'ob', trackId: 'uhr' }),
        entityOf({ id: 'org1', trackId: 'uhr', parentId: 'ob' }),
        entityOf({ id: 'org2', trackId: 'uhr', parentId: 'ob', sortOrder: 1 }),
      ],
      entries: [
        entry({ id: 'e1', track_id: 'uhr', node_id: 'org1' }),
        entry({ id: 'e2', track_id: 'uhr', node_id: 'org2' }),
      ],
      health: healthMap(health('e1', 'critical', true), health('e2', 'ok')),
    })

    expect(find(root, 'root/track:uhr/entity:ob/entity:org1').health.slaBreached).toBe(true)
    expect(find(root, 'root/track:uhr/entity:ob').health.slaBreached).toBe(true)
    expect(find(root, 'root/track:uhr').health.slaBreached).toBe(true)
    expect(root.health.slaBreached).toBe(true)
    // …and nowhere else. An alarm pointing at the wrong Org is worse than none.
    expect(find(root, 'root/track:uhr/entity:ob/entity:org2').health.slaBreached).toBe(false)
    expect(root.health.levels).toEqual({ ok: 1, stale: 0, overdue: 0, critical: 1 })
    assertSound(root)
  })

  it('closes an entity ring at openDepth, with the subtree intact behind it', () => {
    const root = build({
      tracks,
      entities: [
        entityOf({ id: 'ob', trackId: 'uhr' }),
        entityOf({ id: 'org1', trackId: 'uhr', parentId: 'ob' }),
      ],
      entries: [entry({ id: 'e1', track_id: 'uhr', node_id: 'org1' })],
      openDepth: 2,
    })
    const track1 = find(root, 'root/track:uhr')
    const ob = find(root, 'root/track:uhr/entity:ob')
    expect(track1.collapsed).toBe(false)
    expect(ob.collapsed).toBe(true)
    expect(visibleChildren(ob)).toEqual([])
    expect(ob.children).toHaveLength(1)
    expect(ob.count).toBe(1)
    assertSound(root)
  })

  it('builds entity ids that are safe as DOM ids and cannot forge a path', () => {
    const root = build({
      tracks,
      entities: [entityOf({ id: 'a/b c', trackId: 'uhr', label: 'Odd' })],
    })
    expect(ids(root)).toContain('root/track:uhr/entity:a%2Fb%20c')
    assertSound(root)
  })
})

describe('the hierarchy — archived nodes', () => {
  const tracks = [track({ id: 'uhr', label: 'UHR' })]

  it('keeps an archived Org that still holds work, marked retired', () => {
    const root = build({
      tracks,
      entities: [entityOf({ id: 'org1', trackId: 'uhr', label: 'Org One', archived: true })],
      entries: [entry({ id: 'e1', track_id: 'uhr', node_id: 'org1' })],
    })
    const org = find(root, 'root/track:uhr/entity:org1')
    expect(org.retired).toBe(true)
    expect(org.count).toBe(1)
    // Dropping it would have made the track total 1 while showing nothing.
    expect(find(root, 'root/track:uhr').count).toBe(1)
    assertSound(root)
  })

  it('drops an archived Org that holds nothing and scaffolds nothing', () => {
    const root = build({
      tracks,
      entities: [entityOf({ id: 'org1', trackId: 'uhr', archived: true })],
    })
    expect(ids(root)).toEqual(['root', 'root/track:uhr'])
  })

  it('keeps an archived phase as scaffolding above a live Org', () => {
    // `count` alone as the test would have stranded org1: the phase holds no
    // work of its own, and deleting it deletes a live organization from the map.
    const root = build({
      tracks,
      entities: [
        entityOf({ id: 'ob', trackId: 'uhr', label: 'Old phase', archived: true }),
        entityOf({ id: 'org1', trackId: 'uhr', parentId: 'ob', label: 'Org One' }),
      ],
    })
    expect(ids(root)).toEqual([
      'root',
      'root/track:uhr',
      'root/track:uhr/entity:ob',
      'root/track:uhr/entity:ob/entity:org1',
    ])
    expect(find(root, 'root/track:uhr/entity:ob').retired).toBe(true)
  })

  it('collapses a whole branch of archived empties in one pass', () => {
    const root = build({
      tracks,
      entities: [
        entityOf({ id: 'ob', trackId: 'uhr', archived: true }),
        entityOf({ id: 'org1', trackId: 'uhr', parentId: 'ob', archived: true }),
      ],
    })
    expect(ids(root)).toEqual(['root', 'root/track:uhr'])
  })
})

describe('the hierarchy — data the server forbids and a stale cache produces', () => {
  const tracks = [track({ id: 'uhr', label: 'UHR' }), track({ id: 'tr-b', label: 'PMO', sortOrder: 1 })]

  it('re-roots a node whose parent is not in the list, keeping its work', () => {
    const root = build({
      tracks,
      entities: [entityOf({ id: 'org1', trackId: 'uhr', parentId: 'ob-gone', label: 'Org One' })],
      entries: [entry({ id: 'e1', track_id: 'uhr', node_id: 'org1' })],
    })
    expect(ids(root)).toContain('root/track:uhr/entity:org1')
    expect(root.count).toBe(1)
    assertSound(root)
  })

  it('re-roots a node whose parent lives under a different track', () => {
    // Drawing it under its parent would put its entries in one branch's count
    // and its colour in another's.
    const root = build({
      tracks,
      entities: [
        entityOf({ id: 'ob', trackId: 'tr-b', label: 'Phase' }),
        entityOf({ id: 'org1', trackId: 'uhr', parentId: 'ob', label: 'Org One' }),
      ],
    })
    expect(ids(root)).toEqual([
      'root',
      'root/track:uhr',
      'root/track:uhr/entity:org1',
      'root/track:tr-b',
      'root/track:tr-b/entity:ob',
    ])
  })

  it('survives a parent cycle instead of recursing forever', () => {
    const root = build({
      tracks,
      entities: [
        entityOf({ id: 'a', trackId: 'uhr', parentId: 'b', label: 'A' }),
        entityOf({ id: 'b', trackId: 'uhr', parentId: 'a', label: 'B', sortOrder: 1 }),
      ],
      entries: [entry({ id: 'e1', track_id: 'uhr', node_id: 'b' })],
    })
    // Neither is reachable from a root, so the sweep enters the ring at its
    // first member in reading order and the brake cuts the edge that closes it.
    // Wrong about which of the two is the parent; right about every count.
    expect(ids(root)).toEqual([
      'root',
      'root/track:uhr',
      'root/track:uhr/entity:a',
      'root/track:uhr/entity:a/entity:b',
      'root/track:uhr/entity:a/entity:b/group:new',
      'root/track:uhr/entity:a/entity:b/group:new/entry:e1',
      'root/track:tr-b',
    ])
    expect(root.count).toBe(1)
    assertSound(root)
  })

  it('survives a node that is its own parent', () => {
    const root = build({
      tracks,
      entities: [entityOf({ id: 'a', trackId: 'uhr', parentId: 'a', label: 'A' })],
    })
    expect(ids(root)).toEqual([
      'root',
      'root/track:uhr',
      'root/track:uhr/entity:a',
      'root/track:tr-b',
    ])
  })

  it('draws one node for a duplicated id rather than two that share an id', () => {
    const root = build({
      tracks,
      entities: [
        entityOf({ id: 'org1', trackId: 'uhr', label: 'First' }),
        entityOf({ id: 'org1', trackId: 'uhr', label: 'Second', sortOrder: 1 }),
      ],
    })
    expect(labels(find(root, 'root/track:uhr'))).toEqual(['First'])
    // Two nodes with one id would address one `collapsedIds` entry and one DOM
    // id from two places.
    assertSound(root)
  })

  it('files an entry whose node_id names nothing at track level, never nowhere', () => {
    const root = build({
      tracks,
      entities: [entityOf({ id: 'org1', trackId: 'uhr' })],
      entries: [entry({ id: 'e1', track_id: 'uhr', node_id: 'n-gone', status: 'new' })],
    })
    expect(labels(find(root, 'root/track:uhr'))).toEqual(['org1', 'NEW'])
    expect(find(root, 'root/track:uhr').count).toBe(1)
    expect(find(root, 'root/track:uhr/entity:org1').count).toBe(0)
    assertSound(root)
  })

  it('refuses to sink a row into a node belonging to another track', () => {
    // 0024's `entries_map_sync` derives `track_id` FROM the node before the row
    // is written, so this pair cannot exist on the server. It can exist in a
    // first-paint cache, and counting it under one track while drawing it under
    // another is exactly the "labelled 12, showing 3" failure.
    const root = build({
      tracks,
      entities: [entityOf({ id: 'org1', trackId: 'tr-b' })],
      entries: [entry({ id: 'e1', track_id: 'uhr', node_id: 'org1', status: 'new' })],
    })
    expect(find(root, 'root/track:uhr').count).toBe(1)
    expect(labels(find(root, 'root/track:uhr'))).toEqual(['NEW'])
    expect(find(root, 'root/track:tr-b/entity:org1').count).toBe(0)
    assertSound(root)
  })

  it('never sinks an untracked row into a node', () => {
    const root = build({
      tracks,
      entities: [entityOf({ id: 'org1', trackId: 'uhr' })],
      entries: [entry({ id: 'e1', track_id: null, node_id: 'org1', status: 'new' })],
    })
    expect(find(root, 'root/track:').count).toBe(1)
    expect(find(root, 'root/track:uhr/entity:org1').count).toBe(0)
    assertSound(root)
  })

  it('hangs a hierarchy off an archived track that still holds work', () => {
    const root = build({
      tracks: [track({ id: 'tr-z', label: 'Legacy', archived: true })],
      entities: [entityOf({ id: 'org1', trackId: 'tr-z', label: 'Org One' })],
      entries: [entry({ id: 'e1', track_id: 'tr-z', node_id: 'org1' })],
    })
    expect(ids(root)).toContain('root/track:tr-z/entity:org1')
    expect(find(root, 'root/track:tr-z').retired).toBe(true)
    assertSound(root)
  })
})

describe('groupTotals — the DFS the hierarchy forced', () => {
  const tracks = [track({ id: 'uhr', label: 'UHR' })]

  it('finds buckets at every depth, not just the ones under a track', () => {
    // The old two nested loops read `root.children → track.children` and would
    // have summed only the work filed at track level, producing a table that
    // disagrees with the map above it.
    const root = build({
      tracks,
      entities: [
        entityOf({ id: 'ob', trackId: 'uhr' }),
        entityOf({ id: 'org1', trackId: 'uhr', parentId: 'ob' }),
      ],
      entries: [
        entry({ id: 'e1', track_id: 'uhr', status: 'new' }),
        entry({ id: 'e2', track_id: 'uhr', node_id: 'ob', status: 'new' }),
        entry({ id: 'e3', track_id: 'uhr', node_id: 'org1', status: 'new' }),
        entry({ id: 'e4', track_id: 'uhr', node_id: 'org1', status: 'blocked' }),
      ],
    })

    const totals = groupTotals(root)
    expect(totals.map((g) => [g.key, g.count])).toEqual([
      ['new', 3],
      ['blocked', 1],
    ])
    // The footer must reconcile against the root, at any depth.
    expect(totals.reduce((n, g) => n + g.count, 0)).toBe(root.count)
  })

  it('counts a folded group once, not once per entry behind the fold', () => {
    const root = build({
      tracks,
      entities: [entityOf({ id: 'org1', trackId: 'uhr' })],
      entries: [1, 2, 3, 4].map((n) => entry({ id: `e${n}`, track_id: 'uhr', node_id: 'org1' })),
      leafThreshold: 1,
    })
    expect(groupTotals(root).map((g) => [g.key, g.count])).toEqual([['new', 4]])
  })
})

describe('isMindDimension', () => {
  it('accepts the four axes and refuses anything a stale preference can hold', () => {
    for (const dim of ['status', 'owner', 'priority', 'health']) {
      expect(isMindDimension(dim)).toBe(true)
    }
    // `track` is ring 1 already; an axis that repeated it would produce a tree
    // one node wide.
    for (const junk of ['track', 'assignee', '', null, undefined, 3, {}]) {
      expect(isMindDimension(junk)).toBe(false)
    }
  })
})
