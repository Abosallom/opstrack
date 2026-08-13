// Contract tests for the Mindtree's drill-in.
//
// No DOM, no clock, no mocks: focus.ts takes a tree and a string and returns a
// view of that tree, which is the property it was written to have.
//
// THE THREE INVARIANTS THE FILE EXISTS FOR, and each one is a screen the reader
// would otherwise be stranded on:
//
//   · TOTAL — every input produces something drawable. A focus id arrives from a
//     pasted URL, a dimension switch and a realtime close, and all three can name
//     a node that is no longer there. `resolveFocus` may never answer "nothing".
//   · REGROUP-SURVIVING — the fallback is not "give up and show the whole map".
//     Switching the dimension replaces every `group:` segment in the tree, and the
//     reader must land on the TRACK they were inside, one ring out.
//   · REVERSIBLE — the trail is the way back, and it must describe the same node
//     the canvas is drawing. A breadcrumb pointing somewhere the picture is not is
//     worse than no breadcrumb.
//   · DEEP ENOUGH FOR THE SCHEMA. `parseFocusId`'s bounds are the database's:
//     0023 caps the hierarchy at six levels below the track, and an id the schema
//     can mint but the parser rejects is a link that opens the whole map with
//     `missingId` unset — the ONE failure the other three invariants cannot catch,
//     because the id never reaches `resolveFocus` at all.
//
// The regroup test deliberately runs `buildMindtree` TWICE rather than hand-
// writing two trees. Hand-written ids would prove the walk works on ids I chose;
// the point is that it works on the ids model.ts actually mints.

import { describe, expect, it } from 'vitest'
import { EMPTY_FILTER, type FilterContext } from '../entryFilter'
import {
  ancestorIdsOf,
  canFocus,
  defaultFocusFor,
  dimensionStableId,
  drawnIds,
  findNode,
  nearestId,
  refocusTarget,
  isStructuralKind,
  resolveFocus,
  trailTo,
  viewFromParams,
  viewToParams,
} from './focus'
import {
  ROOT_ID,
  buildMindtree,
  type MindDimension,
  type MindNode,
  type MindEntity,
  type MindEntityFacet,
  type MindNodeKind,
  type MindTrack,
  type MindVocabOption,
  type MindtreeInput,
} from './model'
import type { Entry, EntryHealth } from '../../types'

/* ── fixtures ───────────────────────────────────────────────────────────── */

const CTX: FilterContext = { meId: 'me-1', today: '2026-07-30' }

/** Noon, for the reason model.test.ts's header gives. */
function at(date: string): string {
  return `${date}T12:00:00.000Z`
}

/** model.test.ts's fixture, field for field — one shape for one tree builder. */
function entry(over: Partial<Entry> & Pick<Entry, 'id'>): Entry {
  return {
    track_id: null,
    node_id: null,
    title: `Item ${over.id}`,
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

function track(id: string, over: Partial<MindTrack> = {}): MindTrack {
  return {
    id,
    label: `Track ${id}`,
    color: '#336699',
    colorLight: null,
    sortOrder: 0,
    archived: false,
    ...over,
  }
}

/** `useVocabAll('status')`'s shape, in FROZEN_KEYS order. */
function statusVocab(): MindVocabOption[] {
  return [
    { key: 'new', label: 'New', hidden: false },
    { key: 'blocked', label: 'Blocked', hidden: false },
  ]
}

function build(over: Partial<MindtreeInput> = {}): MindNode {
  return buildMindtree({
    entries: [],
    health: new Map<string, EntryHealth>(),
    tracks: [],
    entities: [],
    vocab: statusVocab(),
    members: [],
    dimension: 'status',
    filter: EMPTY_FILTER,
    ctx: CTX,
    collapsedIds: new Set<string>(),
    leafThreshold: 50,
    ...over,
  })
}

/**
 * A hand-built node, with the id scheme model.ts mints. Used where the test is
 * about the WALK rather than about the arithmetic that produced the tree.
 */
function node(
  parent: string | null,
  kind: MindNode['kind'],
  key: string,
  children: MindNode[] = [],
  over: Partial<MindNode> = {},
): MindNode {
  const id =
    parent === null ? ROOT_ID : kind === 'more' ? `${parent}/more` : `${parent}/${kind}:${encodeURIComponent(key)}`
  return {
    id,
    kind,
    label: { kind: 'text', text: key },
    count: children.length,
    colourVars: {},
    health: { levels: { ok: 0, stale: 0, overdue: 0, critical: 0 }, slaBreached: false },
    children,
    collapsed: false,
    depth: 0,
    entryId: kind === 'entry' ? key : null,
    // `entity` carries one too — model.ts sets an entity node's bucketKey to the
    // MAP-NODE id, never a track id, and `dimensionStableId` reads it.
    bucketKey: kind === 'track' || kind === 'group' || kind === 'entity' ? key : null,
    entityType: null,
    retired: false,
    ...over,
  }
}

/** A node in the hierarchy beneath a track — an OB phase, an Org. */
function entityNode(parent: string, key: string, children: MindNode[] = []): MindNode {
  return node(parent, 'entity', key, children)
}

/** root ─ track:t1 ─ group:open ─ entry:e1 · plus an empty track t2. */
function sampleTree(): MindNode {
  const leaf = node('root/track:t1/group:open', 'entry', 'e1')
  const group = node('root/track:t1', 'group', 'open', [leaf])
  const t1 = node(ROOT_ID, 'track', 't1', [group])
  const t2 = node(ROOT_ID, 'track', 't2', [])
  return node(null, 'root', 'root', [t1, t2])
}

const T1 = 'root/track:t1'
const G_OPEN = 'root/track:t1/group:open'
const E1 = 'root/track:t1/group:open/entry:e1'

/* ── the hierarchy ──────────────────────────────────────────────────────── */

// Aziz's own example, segment for segment:
//   root/track:UHR/entity:OB/entity:Org1/group:blocked/entry:X
const UHR = 'root/track:UHR'
const OB = `${UHR}/entity:OB`
const ORG1 = `${OB}/entity:Org1`
const ORG_BLOCKED = `${ORG1}/group:blocked`
const ORG_ENTRY = `${ORG_BLOCKED}/entry:X`

/** UHR ▸ OB ▸ Org1 ▸ blocked ▸ X · plus Org2, an organization with no work. */
function hierarchyTree(): MindNode {
  const leaf = node(ORG_BLOCKED, 'entry', 'X')
  const blocked = node(ORG1, 'group', 'blocked', [leaf])
  const org1 = entityNode(OB, 'Org1', [blocked])
  const org2 = entityNode(OB, 'Org2', [])
  const ob = entityNode(UHR, 'OB', [org1, org2])
  const uhr = node(ROOT_ID, 'track', 'UHR', [ob])
  return node(null, 'root', 'root', [uhr])
}

/* ── the walks ──────────────────────────────────────────────────────────── */

describe('ancestorIdsOf — the string walk', () => {
  it('yields ancestors deepest first, excluding the id itself', () => {
    expect(ancestorIdsOf(E1)).toEqual([G_OPEN, T1, ROOT_ID])
  })

  it('is empty for the root', () => {
    expect(ancestorIdsOf(ROOT_ID)).toEqual([])
  })

  it('does not split inside a percent-encoded segment', () => {
    // The whole reason model.ts encodes: a free-text owner containing a slash
    // would otherwise forge two path segments out of one bucket.
    const id = `${ROOT_ID}/track:${encodeURIComponent('a/b')}`
    expect(id).toBe('root/track:a%2Fb')
    expect(ancestorIdsOf(id)).toEqual([ROOT_ID])
  })

  it('handles the empty-value buckets — untracked and unassigned', () => {
    // NO_VALUE is the empty string, so these ids really do end in a colon.
    expect(ancestorIdsOf('root/track:/group:')).toEqual(['root/track:', ROOT_ID])
  })
})

describe('findNode / trailTo', () => {
  const tree = sampleTree()

  it('finds nodes at every depth', () => {
    expect(findNode(tree, ROOT_ID)).toBe(tree)
    expect(findNode(tree, E1)?.entryId).toBe('e1')
  })

  it('returns null rather than throwing for an unknown id', () => {
    expect(findNode(tree, 'root/track:nope')).toBeNull()
    expect(trailTo(tree, 'root/track:nope')).toBeNull()
  })

  it('distinguishes "no path" from "the path is the root"', () => {
    // The reason trailTo returns null and not []: `if (trail.length)` cannot
    // tell these two apart, and the root is a legitimate answer.
    expect(trailTo(tree, ROOT_ID)).toEqual([tree])
    expect(trailTo(tree, 'nope')).toBeNull()
  })

  it('walks INTO collapsed branches — collapsing is a rendering decision', () => {
    const collapsed = node(null, 'root', 'root', [
      node(ROOT_ID, 'track', 't1', [node(T1, 'group', 'open', [])], { collapsed: true }),
    ])
    expect(findNode(collapsed, G_OPEN)).not.toBeNull()
  })

  it('returns the trail in reading order, inclusive of the target', () => {
    expect(trailTo(tree, E1)?.map((n) => n.id)).toEqual([ROOT_ID, T1, G_OPEN, E1])
  })
})

describe('drawnIds', () => {
  it('includes a collapsed branch but not its contents', () => {
    const tree = node(null, 'root', 'root', [
      node(ROOT_ID, 'track', 't1', [node(T1, 'group', 'open', [node(G_OPEN, 'entry', 'e1')])], {
        collapsed: true,
      }),
    ])
    const drawn = drawnIds(tree)
    expect(drawn.has(T1)).toBe(true)
    // The asymmetry pulse.ts depends on: the branch is on screen, its children
    // are not, so a change under it must be reported ON it.
    expect(drawn.has(G_OPEN)).toBe(false)
    expect(drawn.has(E1)).toBe(false)
  })

  it('includes every node when nothing is collapsed', () => {
    expect(drawnIds(sampleTree())).toEqual(new Set([ROOT_ID, T1, 'root/track:t2', G_OPEN, E1]))
  })
})

describe('nearestId', () => {
  it('prefers the id itself', () => {
    expect(nearestId(E1, (id) => id === E1 || id === T1)).toBe(E1)
  })

  it('climbs to the deepest surviving ancestor', () => {
    expect(nearestId(E1, (id) => id === T1)).toBe(T1)
  })

  it('is null when nothing on the chain survives', () => {
    expect(nearestId(E1, () => false)).toBeNull()
  })
})

/* ── the drill-in ───────────────────────────────────────────────────────── */

describe('resolveFocus — the happy path', () => {
  const tree = sampleTree()

  it('draws the whole map when nothing is focused', () => {
    for (const requested of [null, '', ROOT_ID]) {
      const view = resolveFocus(tree, requested)
      expect(view.node).toBe(tree)
      expect(view.trail.map((n) => n.id)).toEqual([ROOT_ID])
      expect(view.focusId).toBeNull()
      expect(view.missingId).toBeNull()
    }
  })

  it('focuses a branch and reports the trail back to the root', () => {
    const view = resolveFocus(tree, G_OPEN)
    expect(view.node.id).toBe(G_OPEN)
    expect(view.focusId).toBe(G_OPEN)
    expect(view.missingId).toBeNull()
    expect(view.trail.map((n) => n.id)).toEqual([ROOT_ID, T1, G_OPEN])
  })

  it('returns the node model.ts built, not a copy', () => {
    // Referential identity is load-bearing downstream: the layout pass and the
    // accessible table must be looking at ONE object or they can disagree.
    const view = resolveFocus(tree, T1)
    expect(view.node).toBe(findNode(tree, T1))
    expect(view.trail[0]).toBe(tree)
  })

  it('is reversible — the trail is the way back out', () => {
    const view = resolveFocus(tree, G_OPEN)
    const up = view.trail.at(-2)
    expect(up?.id).toBe(T1)
    expect(resolveFocus(tree, up?.id ?? null).node.id).toBe(T1)
    // ...and all the way to the whole map.
    expect(resolveFocus(tree, ROOT_ID).node).toBe(tree)
  })
})

describe('resolveFocus — never a blank screen', () => {
  const tree = sampleTree()

  it('refuses to focus a leaf, falling back to the branch that holds it', () => {
    const view = resolveFocus(tree, E1)
    expect(view.node.id).toBe(G_OPEN)
    expect(view.focusId).toBe(G_OPEN)
    // The surface can say "that is a single item — showing its group instead".
    expect(view.missingId).toBe(E1)
  })

  it('refuses to focus an EMPTY track and falls back to the whole map', () => {
    // model.ts draws an empty active track on purpose; a screen containing only
    // that node answers nothing.
    const view = resolveFocus(tree, 'root/track:t2')
    expect(view.node).toBe(tree)
    expect(view.focusId).toBeNull()
    expect(view.missingId).toBe('root/track:t2')
  })

  it('falls back to the nearest surviving ancestor when the node is gone', () => {
    const view = resolveFocus(tree, 'root/track:t1/group:blocked')
    expect(view.node.id).toBe(T1)
    expect(view.focusId).toBe(T1)
    expect(view.missingId).toBe('root/track:t1/group:blocked')
  })

  it('falls back through TWO missing rings at once', () => {
    const view = resolveFocus(tree, 'root/track:t1/group:blocked/entry:ghost')
    expect(view.node.id).toBe(T1)
    expect(view.missingId).toBe('root/track:t1/group:blocked/entry:ghost')
  })

  it('degrades a wholly unrecognised id to the whole map without throwing', () => {
    for (const bogus of ['', 'nonsense', '../../etc/passwd', 'root', 'root/']) {
      const view = resolveFocus(tree, bogus)
      expect(view.node).toBe(tree)
    }
  })

  it('is TOTAL over a bank of adversarial ids', () => {
    const ids = [
      'root/track:t1/group:open/entry:e1/deeper/still',
      'root//group:open',
      '/',
      '//',
      'root/track:'.repeat(40),
      '\0',
      'root/track:%2F%2F',
    ]
    for (const id of ids) {
      const view = resolveFocus(tree, id)
      // The only contract: something drawable came back.
      expect(view.node).toBeDefined()
      expect(view.trail.length).toBeGreaterThan(0)
      expect(view.trail[0]).toBe(tree)
    }
  })
})

describe('canFocus', () => {
  it('keys on shape, not on kind — a fold is focusable, a leaf is not', () => {
    const fold = node(G_OPEN, 'more', '', [node(`${G_OPEN}/more`, 'entry', 'e9')])
    expect(canFocus(fold)).toBe(true)
    expect(canFocus(node(G_OPEN, 'entry', 'e1'))).toBe(false)
  })

  it('focuses a CHILDLESS ENTITY — the one kind that overrides the shape rule', () => {
    // An Org with zero open issues is precisely the Org somebody wants to
    // inspect: the panel carries its account manager, its vendor and its
    // use-case matrix, none of which depend on work being filed under it. The
    // childless rule was about landing the reader somewhere that answers
    // nothing, and an entity always answers something.
    expect(canFocus(entityNode(OB, 'Org2'))).toBe(true)
  })

  it('still refuses a childless GROUP — the exception is of kind, not of degree', () => {
    // The empty-bucket rule survives intact: a status bucket with nothing in it
    // has nothing to say, which is why model.ts does not even draw one.
    expect(canFocus(node(ORG1, 'group', 'blocked', []))).toBe(false)
    expect(canFocus(node(ROOT_ID, 'track', 't2', []))).toBe(false)
  })
})

/* ── the case the module exists for ─────────────────────────────────────── */

describe('resolveFocus — surviving a regroup', () => {
  // Two entries on one track, differing in status AND owner, so the same data
  // buckets differently under each dimension.
  const entries = [
    entry({ id: 'e1', track_id: 't1', status: 'new', owner_id: 'm1' }),
    entry({ id: 'e2', track_id: 't1', status: 'blocked', owner_id: 'm2' }),
  ]
  const shared: Partial<MindtreeInput> = {
    entries,
    tracks: [track('t1')],
    members: [
      { id: 'm1', displayName: 'Layla' },
      { id: 'm2', displayName: 'Omar' },
    ],
  }

  function treeFor(dimension: MindDimension): MindNode {
    return build({ ...shared, dimension })
  }

  it('lands on the track when the dimension replaces every group segment', () => {
    const byStatus = treeFor('status')
    const group = byStatus.children[0]?.children[0]
    expect(group?.id).toBe('root/track:t1/group:new')

    // The reader drills into "New", then switches the axis to Owner. The
    // focused id names nothing in the new tree — but its prefix still names the
    // track, because ring 1 does not depend on the dimension.
    const byOwner = treeFor('owner')
    expect(findNode(byOwner, group?.id ?? '')).toBeNull()

    const view = resolveFocus(byOwner, group?.id ?? null)
    expect(view.node.id).toBe('root/track:t1')
    expect(view.focusId).toBe('root/track:t1')
    expect(view.missingId).toBe('root/track:t1/group:new')
    // And it is a real view, not an empty husk.
    expect(view.node.children.length).toBeGreaterThan(0)
  })

  it('keeps a TRACK focus untouched across a regroup', () => {
    const view = resolveFocus(treeFor('owner'), 'root/track:t1')
    expect(view.focusId).toBe('root/track:t1')
    expect(view.missingId).toBeNull()
  })

  it('survives a filter that empties the focused group', () => {
    const focused = 'root/track:t1/group:blocked'
    expect(findNode(treeFor('status'), focused)).not.toBeNull()

    // Search narrows the working set to e1 only, so the blocked group vanishes.
    const narrowed = build({
      ...shared,
      dimension: 'status',
      filter: { ...EMPTY_FILTER, search: 'Item e1' },
    })
    const view = resolveFocus(narrowed, focused)
    expect(view.node.id).toBe('root/track:t1')
    expect(view.missingId).toBe(focused)
  })
})

/* ── the URL ────────────────────────────────────────────────────────────── */

describe('the URL round-trip', () => {
  it('omits neutral state, so an unfocused map has a clean URL', () => {
    const p = viewToParams(new URLSearchParams(), { focusId: null, dimension: null })
    expect(p.toString()).toBe('')
  })

  it('treats the root as no focus at all', () => {
    const p = viewToParams(new URLSearchParams(), { focusId: ROOT_ID, dimension: null })
    expect(p.has('focus')).toBe(false)
  })

  it('round-trips a focused view', () => {
    const view = { focusId: G_OPEN, dimension: 'owner' as const }
    expect(viewFromParams(viewToParams(new URLSearchParams(), view))).toEqual(view)
  })

  it('round-trips the empty-value buckets', () => {
    // `root/track:` is the untracked pile — the bucket an ops lead most wants to
    // send somebody a link to.
    const view = { focusId: 'root/track:/group:', dimension: null }
    expect(viewFromParams(viewToParams(new URLSearchParams(), view))).toEqual(view)
  })

  it('preserves the filter params it is composed with', () => {
    const base = new URLSearchParams('track=t1&q=firewall&tag=q3')
    const p = viewToParams(base, { focusId: T1, dimension: 'health' })
    expect(p.get('track')).toBe('t1')
    expect(p.get('q')).toBe('firewall')
    expect(p.get('tag')).toBe('q3')
    expect(p.get('focus')).toBe(T1)
    expect(p.get('dim')).toBe('health')
    // ...and does not mutate the caller's object.
    expect(base.has('focus')).toBe(false)
  })

  it('clears the params when the reader steps back out', () => {
    const focused = viewToParams(new URLSearchParams('q=x'), { focusId: T1, dimension: 'owner' })
    const cleared = viewToParams(focused, { focusId: null, dimension: null })
    expect(cleared.has('focus')).toBe(false)
    expect(cleared.has('dim')).toBe(false)
    expect(cleared.get('q')).toBe('x')
  })

  it('reads an absent dimension as "no opinion", not as a default', () => {
    // Null must NOT mean status: the surface keeps the reader's persisted
    // preference when the URL is silent.
    expect(viewFromParams(new URLSearchParams()).dimension).toBeNull()
  })

  it('drops values that do not parse', () => {
    const cases: readonly string[] = [
      'focus=nonsense',
      'focus=' + encodeURIComponent('../../etc/passwd'),
      'focus=' + encodeURIComponent('root/../track:t1'),
      'focus=' + encodeURIComponent('root/bogus:t1'),
      'focus=' + encodeURIComponent('root/track:t1/group:o/entry:e/more/entry:x/deeper'),
      'focus=' + encodeURIComponent('root/track:<script>'),
      'focus=' + encodeURIComponent('root/track:a b'),
      'focus=root',
      'focus=',
      'dim=constructor',
      'dim=toString',
      'dim=assignee',
    ]
    for (const raw of cases) {
      const view = viewFromParams(new URLSearchParams(raw))
      expect(view.focusId).toBeNull()
      expect(view.dimension).toBeNull()
    }
  })

  it('drops a pathologically long focus id', () => {
    // 4 096 since wave 6 — a cohort segment is 63 characters and a worst-case
    // grouped path carries 28 of them. See MAX_FOCUS_LEN's arithmetic.
    const long = `${ROOT_ID}/track:${'a'.repeat(4200)}`
    expect(long.length).toBeGreaterThan(4096)
    expect(viewFromParams(new URLSearchParams(`focus=${long}`)).focusId).toBeNull()
  })

  it('keeps a long but LEGAL id — the bound is not the shape', () => {
    // Just under the cap. A real hierarchy id is nowhere near this, but the
    // failure mode of a too-tight bound is a silently dead link (see below), so
    // the headroom is worth an assertion of its own.
    const long = `${ROOT_ID}/track:${'a'.repeat(4000)}`
    expect(long.length).toBeLessThan(4096)
    expect(viewFromParams(new URLSearchParams(`focus=${encodeURIComponent(long)}`)).focusId).toBe(long)
  })

  it('accepts every segment kind model.ts can mint', () => {
    const ids = [
      'root/track:t1',
      'root/track:t1/group:open',
      'root/track:t1/group:open/entry:e1',
      'root/track:t1/group:open/more',
      'root/track:t1/group:open/more/entry:e1',
      `root/track:${encodeURIComponent('name:Acme Ltd')}`,
      `root/track:${encodeURIComponent('a/b')}`,
      // The hierarchy: an entity ring, several of them, and the axis rings that
      // hang below the deepest one.
      OB,
      ORG1,
      ORG_BLOCKED,
      ORG_ENTRY,
      `${ORG_BLOCKED}/more`,
      `${ORG_BLOCKED}/more/entry:X`,
      `root/track:t1/entity:${encodeURIComponent('Acme Ltd')}`,
    ]
    for (const id of ids) {
      const p = viewToParams(new URLSearchParams(), { focusId: id, dimension: null })
      expect(viewFromParams(p).focusId).toBe(id)
    }
  })

  it('feeds resolveFocus whatever survives parsing', () => {
    // The two halves are one contract: anything the codec lets through must be
    // something the resolver is total over.
    const tree = sampleTree()
    for (const raw of ['focus=root%2Ftrack%3At1', 'focus=garbage', 'focus=']) {
      const view = resolveFocus(tree, viewFromParams(new URLSearchParams(raw)).focusId)
      expect(view.trail[0]).toBe(tree)
    }
  })
})

/* ─────────────────── the depth the schema can actually produce ──────────── */

describe('parseFocusId — the bounds are the database\'s', () => {
  /** Round-trip through the codec, which is the only door `parseFocusId` has. */
  function parses(id: string): boolean {
    return viewFromParams(new URLSearchParams(`focus=${encodeURIComponent(id)}`)).focusId === id
  }

  it('accepts Aziz\'s own example path', () => {
    // REGRESSION, and it was a shipping bug: this id is EXACTLY six segments and
    // MAX_SEGMENTS was 6, so it fit by nothing. A rejected id never reaches
    // resolveFocus, so `missingId` is never set — the shared link opened the
    // whole map with nothing on screen saying why.
    expect(ORG_ENTRY.split('/')).toHaveLength(6)
    expect(parses(ORG_ENTRY)).toBe(true)
  })

  it('accepts ONE MORE nesting level than his example — the case that used to die', () => {
    const deeper = `${OB}/entity:Region/entity:Org1/group:blocked/entry:X`
    expect(deeper.split('/')).toHaveLength(7)
    expect(parses(deeper)).toBe(true)
  })

  it('accepts the deepest id the schema can mint: six entity levels', () => {
    // 0023's `map_node_depth` trigger caps the hierarchy at six levels below the
    // track, so this is the worst case that can exist:
    //   root · track: · entity: ×6 · group: · more · entry:  = 11 segments.
    const entities = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'].map((k) => `entity:${k}`).join('/')
    const deepest = `${ROOT_ID}/track:UHR/${entities}/group:blocked/more/entry:X`
    expect(deepest.split('/')).toHaveLength(11)
    expect(parses(deepest)).toBe(true)
  })

  it('accepts a cohort segment — WITHOUT THIS LINE `?by=` HAS NO SHAREABLE LINK', () => {
    // THE REGRESSION WAVE 6 WOULD OTHERWISE HAVE SHIPPED. A cohort is in
    // STRUCTURAL_KINDS, so the camera stops on one and `useMapUrl` mirrors its
    // id into `?focus=`; a grammar that did not know the word rejects it coming
    // back — and a REJECTED id never reaches `resolveFocus`, so `missingId` is
    // never set and the pasted link opens the whole map saying nothing.
    //
    // The exact string model.ts mints: `nodeId(parent, 'cohort', key)` with
    // `cohortKeyOf('manager', <uuid>)` inside it, so the segment carries its own
    // `cohort:` prefix percent-encoded — see model.ts:746 and :789.
    const key = encodeURIComponent('cohort:manager:5f2c1a90-0000-4000-8000-000000000001')
    const id = `${ROOT_ID}/track:UHR/cohort:${key}/entity:Org1`
    expect(parses(id)).toBe(true)
    // And the length arithmetic MAX_FOCUS_LEN is written against.
    expect(`cohort:${key}`).toHaveLength(62)
  })

  it('accepts the deepest GROUPED id: six entity levels, each cut by the whole ladder', () => {
    // 0023 caps the hierarchy at six levels below the track, and `groupEntities`
    // may insert one cohort per ladder key (four) at the track and at each of
    // those six levels. 7 x 4 = 28 cohort segments on top of the 11 the schema
    // could already produce. It takes only 25 organizations agreeing on all four
    // keys to exhaust the ladder at one site, so this is a shape the data can
    // reach — not a decorative margin.
    const ladder = ['stage', 'manager', 'type', 'vendor']
    const cut = (at: string): string =>
      ladder.map((k) => `cohort:${encodeURIComponent(`cohort:${k}:${at}`)}`).join('/')
    const levels = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6']
    const deepest = [
      ROOT_ID,
      'track:UHR',
      cut('t'),
      ...levels.map((l) => `${cut(l)}/entity:${l}`),
      'group:blocked',
      'more',
      'entry:X',
    ].join('/')
    expect(deepest.split('/')).toHaveLength(39)
    expect(deepest.length).toBeLessThan(4096)
    expect(parses(deepest)).toBe(true)
  })

  it('still refuses a path deeper than the schema could produce', () => {
    // Past 40 segments. `groupEntities` cannot recurse a fifth time — the ladder
    // is four keys and each is spent once — so nothing beyond this is mintable.
    const entities = Array.from({ length: 40 }, (_, i) => `entity:L${i}`).join('/')
    const absurd = `${ROOT_ID}/track:UHR/${entities}/group:blocked/entry:X`
    expect(absurd.split('/').length).toBeGreaterThan(40)
    expect(parses(absurd)).toBe(false)
  })

  it('refuses a segment kind that is not in the grammar', () => {
    // The regex widened by exactly one keyword and no more. `cohorts:` and
    // `Cohort:` are the near-misses that would silently kill a shared link.
    for (const bogus of [
      'root/org:Org1',
      'root/entity',
      'root/entities:x',
      'root/Entity:x',
      'root/cohorts:x',
      'root/Cohort:x',
      'root/cohort',
    ]) {
      expect(parses(bogus)).toBe(false)
    }
  })

  it('keeps `more` bare — a fold has no value to carry', () => {
    expect(parses(`${ORG_BLOCKED}/more`)).toBe(true)
    expect(parses(`${ORG_BLOCKED}/more:1`)).toBe(false)
  })

  it('keeps the empty-value entity bucket parseable', () => {
    // Same rule as `root/track:` — NO_VALUE is the empty string, and a stricter
    // pattern would drop a focus the parser has no business rejecting.
    expect(parses('root/track:UHR/entity:')).toBe(true)
  })
})

/* ────────────────── the drill-in, inside the hierarchy ──────────────────── */

describe('resolveFocus — UHR ▸ OB ▸ Org', () => {
  const tree = hierarchyTree()

  it('focuses an Org and reports the trail through every ring', () => {
    const view = resolveFocus(tree, ORG1)
    expect(view.node.id).toBe(ORG1)
    expect(view.missingId).toBeNull()
    expect(view.trail.map((n) => n.id)).toEqual([ROOT_ID, UHR, OB, ORG1])
    // Reversible: `trail.at(-2)` is the OB phase, not the programme.
    expect(view.trail.at(-2)?.id).toBe(OB)
  })

  it('focuses an Org with NO WORK UNDER IT', () => {
    const org2 = `${OB}/entity:Org2`
    const view = resolveFocus(tree, org2)
    expect(view.node.id).toBe(org2)
    expect(view.focusId).toBe(org2)
    // No fallback taken, so the surface announces nothing — this is an ordinary
    // view, not a recovery.
    expect(view.missingId).toBeNull()
    expect(view.node.children).toHaveLength(0)
  })

  it('falls back to the ORG, not to the programme, when a bucket vanishes', () => {
    // The realtime-close case one ring deeper than the module was written for:
    // the last blocked item closes, the bucket goes, and the reader should still
    // be standing in the Org they were reading.
    const view = resolveFocus(tree, `${ORG1}/group:stale`)
    expect(view.focusId).toBe(ORG1)
    expect(view.missingId).toBe(`${ORG1}/group:stale`)
  })

  it('climbs past a missing Org to the phase that held it', () => {
    const gone = `${OB}/entity:Ghost/group:blocked`
    const view = resolveFocus(tree, gone)
    expect(view.focusId).toBe(OB)
    expect(view.missingId).toBe(gone)
  })

  it('is still TOTAL at depth', () => {
    for (const id of [`${ORG_ENTRY}/entity:x`, `${OB}/entity:`.repeat(20), `${ORG1}/`, ORG_ENTRY]) {
      const view = resolveFocus(tree, id)
      expect(view.trail[0]).toBe(tree)
      expect(view.node).toBeDefined()
    }
  })

  it('refuses to focus a leaf ENTRY inside an Org, landing on its bucket', () => {
    const view = resolveFocus(tree, ORG_ENTRY)
    expect(view.node.id).toBe(ORG_BLOCKED)
    expect(view.missingId).toBe(ORG_ENTRY)
  })
})

/* ────────────────────── the trim a regroup performs ─────────────────────── */

describe('dimensionStableId', () => {
  // REGRESSION. `pages/Mindtree.chooseDimension` used to answer this question
  // with `null`, and null is one whole ring away from the right answer: a lead
  // two rings inside SRE who flips the axis to see status was thrown back across
  // every track, with no breadcrumb and no sentence. focus.ts's own header calls
  // that outcome out by name — "rather than on a blank screen OR BACK AT THE TOP
  // OF THE MAP".
  it('keeps the track and drops everything the axis spells', () => {
    expect(dimensionStableId('root/track:t-sre/group:name%3AAziz')).toBe('root/track:t-sre')
    expect(dimensionStableId('root/track:t1/group:blocked/entry:e1')).toBe('root/track:t1')
    expect(dimensionStableId('root/track:t1/group:blocked/more')).toBe('root/track:t1')
  })

  it('leaves an already-stable id alone', () => {
    expect(dimensionStableId('root/track:t1')).toBe('root/track:t1')
    // The untracked pile is `root/track:` — an EMPTY value, not a missing one.
    expect(dimensionStableId('root/track:')).toBe('root/track:')
  })

  it('KEEPS every entity segment — the hierarchy is shape, not axis', () => {
    // REGRESSION, and the same bug as the one above at a larger radius. Trimming
    // to `root/track:UHR` would throw a reader standing inside Org1 back past
    // the Org and past the OB phase to the programme — three rings — on a chip
    // press that says nothing about structure. And it would do it SILENTLY:
    // resolveFocus finds the track, draws it, and reports no fallback.
    expect(dimensionStableId(ORG_BLOCKED)).toBe(ORG1)
    expect(dimensionStableId(ORG_ENTRY)).toBe(ORG1)
    expect(dimensionStableId(`${ORG_BLOCKED}/more`)).toBe(ORG1)
    // An entity focus is already stable — nothing to trim.
    expect(dimensionStableId(ORG1)).toBe(ORG1)
    expect(dimensionStableId(OB)).toBe(OB)
  })

  it('KEEPS every cohort segment — `?by=` is a different chip from the dimension', () => {
    // REGRESSION, and the wave-6 twin of the entity case above. A cohort ring is
    // cut by `?by=`, which the DIMENSION chip does not touch: flipping Status →
    // Owner re-buckets the entries under an organization and leaves every cohort
    // ring exactly where it was. Breaking at `cohort:` would throw an account
    // manager standing in their own book back to the track — past their cohort,
    // past the type ring, past the organization — and silently, because trimming
    // reports no fallback. At 400 organizations every focus below the track ring
    // has a `cohort:` segment in it, so this is the ordinary case.
    const byManager = `${UHR}/cohort:${encodeURIComponent('cohort:manager:sara')}`
    const byType = `${byManager}/cohort:${encodeURIComponent('cohort:type:hospital')}`
    const org = `${byType}/entity:Org1`
    expect(dimensionStableId(byManager)).toBe(byManager)
    expect(dimensionStableId(byType)).toBe(byType)
    expect(dimensionStableId(org)).toBe(org)
    // ...and the axis's own segments still go, from underneath a cohort.
    expect(dimensionStableId(`${org}/group:blocked`)).toBe(org)
    expect(dimensionStableId(`${org}/group:blocked/entry:X`)).toBe(org)
  })

  it('stops at the FIRST group segment even when entities follow it', () => {
    // Belt and braces on the walk's order: model.ts cannot mint this id, but a
    // hand-edited URL can, and the trim must not resume past the axis.
    expect(dimensionStableId(`${UHR}/group:blocked/entity:Org1`)).toBe(UHR)
  })

  it('leaves a reader inside their Org across a real regroup', () => {
    // End to end, on the tree rather than on the string: the stale group id
    // names nothing, the trimmed one names Org1, and nothing is announced as
    // missing — which is what makes the chip non-destructive.
    const tree = hierarchyTree()
    expect(findNode(tree, ORG_BLOCKED)).not.toBeNull()

    const trimmed = dimensionStableId(ORG_BLOCKED)
    const view = resolveFocus(tree, trimmed)
    expect(view.focusId).toBe(ORG1)
    expect(view.missingId).toBeNull()
    expect(view.trail.map((n) => n.id)).toEqual([ROOT_ID, UHR, OB, ORG1])
  })

  it('answers null when nothing above the axis survives', () => {
    expect(dimensionStableId(null)).toBeNull()
    expect(dimensionStableId('')).toBeNull()
    expect(dimensionStableId(ROOT_ID)).toBeNull()
  })

  it('trims to an id the resolver can actually draw, on ids model.ts minted', () => {
    // The whole point, proven end to end rather than on ids chosen by hand: build
    // the tree under one axis, take a real ring-2 id, trim it, and rebuild under
    // another axis. The trimmed id must still name a focusable node — which is
    // exactly what makes the regroup keep the reader inside their branch.
    const entries = [
      entry({ id: 'e1', track_id: 't1', status: 'blocked', owner_id: 'me-1' }),
      entry({ id: 'e2', track_id: 't1', status: 'new', owner_id: 'me-1' }),
    ]
    const shared = { entries, tracks: [track('t1')] }
    const byStatus = build({ ...shared, dimension: 'status' as MindDimension })
    const deep = byStatus.children[0]?.children[0]
    expect(deep?.kind).toBe('group')

    const trimmed = dimensionStableId(deep?.id ?? null)
    expect(trimmed).toBe('root/track:t1')

    const byOwner = build({ ...shared, dimension: 'owner' as MindDimension, members: [] })
    // The stale ring-2 id names nothing on the new axis...
    expect(findNode(byOwner, deep?.id ?? '')).toBeNull()
    // ...and the trimmed one still names the track the reader was inside, with
    // no fallback taken, so nothing is announced as missing.
    const view = resolveFocus(byOwner, trimmed)
    expect(view.focusId).toBe('root/track:t1')
    expect(view.missingId).toBeNull()
  })
})

/* ─────────────────── where focus goes after a write moved a row ─────────── */

describe('refocusTarget', () => {
  // REGRESSION. A MindNode id embeds its bucket path, so every successful drop
  // rewrites the id of the row it moved and the `<g role="treeitem">` holding
  // DOM focus unmounts — `store/entries.patchEntry` commits the optimistic row
  // BEFORE it awaits, so this is synchronous with the gesture. Nothing
  // re-focused, and the browser reset activeElement to <body>: press Enter to
  // drop and land at the top of the document, on the one screen whose drag rule
  // says a gesture that ENDS must not have moved the reader's place.
  const drawn = [
    { id: 'root', entryId: null },
    { id: 'root/track:t1', entryId: null },
    { id: 'root/track:t1/group:blocked', entryId: null },
    { id: 'root/track:t1/group:blocked/entry:e1', entryId: 'e1' },
  ]
  const has = (id: string): boolean => drawn.some((d) => d.id === id)

  it('follows the row to wherever it now draws', () => {
    // Lifted from `.../group:new/entry:e1`; it is under Blocked now.
    const at = refocusTarget(drawn, { entryId: 'e1', fromId: 'root/track:t1/group:new/entry:e1' }, has)
    expect(at).toBe('root/track:t1/group:blocked/entry:e1')
  })

  it('falls back to the nearest surviving ancestor when the row LEFT the map', () => {
    // A close: the map draws open work, so there is no node to follow — but the
    // branch it was under is still where the reader was standing.
    const at = refocusTarget(drawn, { entryId: 'gone', fromId: 'root/track:t1/group:blocked/entry:gone' }, has)
    expect(at).toBe('root/track:t1/group:blocked')
  })

  it('walks further out when the whole branch went with it', () => {
    const thin = [{ id: 'root', entryId: null }]
    const at = refocusTarget(
      thin,
      { entryId: 'gone', fromId: 'root/track:t9/group:blocked/entry:gone' },
      (id) => thin.some((d) => d.id === id),
    )
    expect(at).toBe('root')
  })

  it('answers null — the caller\'s own fallback — when it has nothing to go on', () => {
    expect(refocusTarget(drawn, { entryId: 'gone', fromId: null }, has)).toBeNull()
    expect(refocusTarget([], { entryId: 'e1', fromId: 'root/track:zz' }, () => false)).toBeNull()
  })

  it('prefers the moved row over its old branch when both are drawable', () => {
    // Order is the content of this function: following the row is the ordinary
    // case, and an ancestor that happens to still exist must not win.
    const at = refocusTarget(drawn, { entryId: 'e1', fromId: 'root/track:t1' }, has)
    expect(at).toBe('root/track:t1/group:blocked/entry:e1')
  })
})

/* ── where the map opens ────────────────────────────────────────────────── */

/**
 * THE PORTFOLIO SHAPE, in miniature — the same rings the render gate's
 * 400-organization fixture draws, with three organizations per type instead of
 * twenty-two:
 *
 *   root ▸ Onboarding ▸ 2 directorates ▸ 3 account managers ▸ 6 types ▸ orgs
 *
 * Built with the `node` helper above, so every id is the one model.ts would
 * mint and every `entity` carries its map-node id in `bucketKey` — which is what
 * `defaultFocusFor` matches on. Hand-writing a second id scheme here would prove
 * the resolver works on ids I chose.
 */
function amBook(adId: string, am: string, types: number, orgsPerType: number): MindNode {
  const amId = `${adId}/entity:${am}`
  const typeNodes: MindNode[] = []
  for (let t = 0; t < types; t += 1) {
    const typeKey = `${am}-type-${t}`
    const typeId = `${amId}/entity:${typeKey}`
    const orgNodes: MindNode[] = []
    for (let o = 0; o < orgsPerType; o += 1) {
      orgNodes.push(entityNode(typeId, `${typeKey}-org-${o}`))
    }
    typeNodes.push(entityNode(amId, typeKey, orgNodes))
  }
  return entityNode(adId, am, typeNodes)
}

const OB_TRACK = 'root/track:ob'
const AD_NORTH = `${OB_TRACK}/entity:ad-north`
const AD_SOUTH = `${OB_TRACK}/entity:ad-south`
const AM_SARA = `${AD_NORTH}/entity:am-sara`

function portfolioTree(): MindNode {
  const north = entityNode(OB_TRACK, 'ad-north', [
    amBook(AD_NORTH, 'am-sara', 6, 3),
    amBook(AD_NORTH, 'am-faisal', 6, 3),
  ])
  const south = entityNode(OB_TRACK, 'ad-south', [amBook(AD_SOUTH, 'am-nouf', 6, 3)])
  return node(null, 'root', 'root', [node(ROOT_ID, 'track', 'ob', [north, south])])
}

/** `map_nodes.account_manager_id`, as the surface supplies it: bucketKey → member. */
function managedBy(meId: string, ...bucketKeys: readonly string[]): (key: string) => string | null {
  const owned = new Set(bucketKeys)
  return (key: string): string | null => (owned.has(key) ? meId : null)
}

describe('defaultFocusFor — the map opens on the reader’s own world', () => {
  it('frames an account manager on their own cohort when a node IS them', () => {
    // TEST 1 OF THE TWO OWNERSHIP ROADS: `bucketKey === meId`. model.ts:196 says
    // a bucketKey is "a track id, a map-node id, a status key, AN OWNER KEY", so
    // a ring cut on a person carries that person's id and needs no lookup — which
    // is what wave 6's `?by=manager` cohort will be, and what the render gate's
    // `am:` tier stands in for.
    const tree = portfolioTree()
    expect(defaultFocusFor('am-sara', 'member', tree)).toBe(AM_SARA)
    // …and the world it names is the one worth landing on: six type cards.
    expect(findNode(tree, AM_SARA)?.children).toHaveLength(6)
  })

  it('frames an account manager on the smallest world holding their whole book', () => {
    // TEST 2: `managerOf` — the `account_manager_id` facet, spread across two of
    // Sara's six types. No single type holds all six organizations, so the answer
    // is the ring that does: her own cohort. This is the design's "AD → their
    // span" arithmetic, arriving at an AM's shape.
    const tree = portfolioTree()
    const mine = managedBy(
      'sara-uuid',
      'am-sara-type-0-org-0', 'am-sara-type-0-org-1', 'am-sara-type-0-org-2',
      'am-sara-type-1-org-0', 'am-sara-type-1-org-1', 'am-sara-type-1-org-2',
    )
    expect(defaultFocusFor('sara-uuid', 'member', tree, mine)).toBe(AM_SARA)
  })

  it('descends all the way to the ring when the whole book is one type', () => {
    const tree = portfolioTree()
    const mine = managedBy(
      'sara-uuid',
      'am-sara-type-3-org-0', 'am-sara-type-3-org-1', 'am-sara-type-3-org-2',
    )
    expect(defaultFocusFor('sara-uuid', 'member', tree, mine)).toBe(
      `${AM_SARA}/entity:am-sara-type-3`,
    )
  })

  it('stops OUTSIDE a single organization — one card is not an opening', () => {
    // A camera framed on a childless node draws one card and answers nothing, so
    // an account manager whose entire book is one organization opens on the ring
    // that organization sits in. Their cohort, by another road.
    const tree = portfolioTree()
    const mine = managedBy('sara-uuid', 'am-sara-type-4-org-1')
    expect(defaultFocusFor('sara-uuid', 'member', tree, mine)).toBe(
      `${AM_SARA}/entity:am-sara-type-4`,
    )
  })

  it('does NOT hand an admin somebody else’s book — the workspace, every time', () => {
    // The one thing `role` decides. Sara's own id, with an admin's role: the
    // answer moves from her cohort to the Onboarding track world, which is the
    // design table's admin/owner row.
    const tree = portfolioTree()
    expect(defaultFocusFor('am-sara', 'member', tree)).toBe(AM_SARA)
    expect(defaultFocusFor('am-sara', 'admin', tree)).toBe(OB_TRACK)
    expect(defaultFocusFor('am-sara', 'owner', tree)).toBe(OB_TRACK)
  })

  it('skips the single-child chain — a root drawing one track says nothing', () => {
    // The workspace opening. `root` is a pill with one track under it; spending
    // the whole screen on "there is one track" costs the reader a dive before the
    // map has told them anything.
    const tree = portfolioTree()
    expect(defaultFocusFor(null, 'member', tree)).toBe(OB_TRACK)
    expect(defaultFocusFor('nobody-at-all', 'member', tree)).toBe(OB_TRACK)
    expect(defaultFocusFor('', 'member', tree)).toBe(OB_TRACK)
  })

  it('stops at the first ring that BRANCHES, and never past it', () => {
    // ad-north holds two account managers, so the descent must not enter it —
    // framing one directorate would hide the other half of the workspace from a
    // reader who owns neither.
    const tree = portfolioTree()
    const opening = defaultFocusFor(null, 'member', tree)
    expect(opening).toBe(OB_TRACK)
    expect(findNode(tree, opening as string)?.children.map((c) => c.id)).toEqual([
      AD_NORTH,
      AD_SOUTH,
    ])
  })

  it('answers null — the drawn root — when the workspace already branches', () => {
    // Two tracks: the root IS the picture, and null is the caller's own fallback
    // rather than a `?focus=` that says the same thing.
    //
    // t2 IS EMPTY AND STILL COUNTS. model.ts draws a track with nothing on it
    // because "which track has nothing on it" is worth seeing; a descent that
    // stepped past it into t1 would delete that answer from the opening frame.
    expect(sampleTree().children.map((c) => c.id)).toEqual([T1, 'root/track:t2'])
    expect(findNode(sampleTree(), 'root/track:t2')?.children).toHaveLength(0)
    expect(defaultFocusFor(null, 'member', sampleTree())).toBeNull()
    expect(defaultFocusFor('me-1', 'admin', sampleTree())).toBeNull()
  })

  it('never returns ROOT_ID — null is how it says "the drawn root"', () => {
    for (const tree of [portfolioTree(), sampleTree(), hierarchyTree()]) {
      for (const role of ['member', 'admin']) {
        expect(defaultFocusFor('am-sara', role, tree)).not.toBe(ROOT_ID)
      }
    }
  })

  it('RESOLVES — every id it returns is drawable, with no fallback reported', () => {
    // THE GUARANTEE THE STORE DEPENDS ON. `useMapFocus` hands this answer to
    // `resolveFocus` as the requested id and writes back only when
    // `missingId !== null`. An id that needed a fallback would therefore be
    // PERSISTED, would travel into `?focus=` on the next mirror pass, and a link
    // the reader shared would carry the sender's book to the recipient.
    const tree = portfolioTree()
    const mine = managedBy('sara-uuid', 'am-sara-type-3-org-0')
    const answers = [
      defaultFocusFor('am-sara', 'member', tree),
      defaultFocusFor('sara-uuid', 'member', tree, mine),
      defaultFocusFor(null, 'member', tree),
      defaultFocusFor('am-sara', 'admin', tree),
    ]
    for (const id of answers) {
      expect(id).not.toBeNull()
      const view = resolveFocus(tree, id)
      expect(view.missingId, `${id as string} needed a fallback`).toBeNull()
      expect(view.focusId).toBe(id)
      expect(canFocus(view.node)).toBe(true)
    }
  })

  it('ignores content nodes — a group named after you is not a place', () => {
    // `?dim=owner` cuts a `group:` per member, so a group's bucketKey IS a member
    // id. Groups are drawn INSIDE their owner's world and can never be framed
    // (worlds.ts's STRUCTURAL_KINDS), so matching one would aim the camera at a
    // world the dive cannot enter.
    const owner = node(T1, 'group', 'me-1', [node(`${T1}/group:me-1`, 'entry', 'e9')])
    const t1 = node(ROOT_ID, 'track', 't1', [owner])
    const tree = node(null, 'root', 'root', [t1])
    expect(owner.bucketKey).toBe('me-1')
    // The answer is the workspace opening — the one track — and emphatically NOT
    // the group that carries the reader's own id.
    expect(defaultFocusFor('me-1', 'member', tree)).toBe(T1)
    expect(defaultFocusFor('me-1', 'member', tree)).not.toBe(owner.id)
  })

  it('is PURE and TOTAL — a bare root, an empty tree, a missing manager map', () => {
    const bare = node(null, 'root', 'root', [])
    expect(defaultFocusFor('me-1', 'member', bare)).toBeNull()
    expect(defaultFocusFor(null, 'admin', bare)).toBeNull()
    const tree = portfolioTree()
    expect(defaultFocusFor('am-sara', 'member', tree)).toBe(
      defaultFocusFor('am-sara', 'member', tree),
    )
    // A manager map that answers null for everything is the same as none.
    expect(defaultFocusFor('am-sara', 'member', tree, () => null)).toBe(AM_SARA)
  })
})

/* ─────────────────────── the cohort ring, once it is real ───────────────── */
//
// Wave 5's `defaultFocusFor` tests stand in for `?by=manager` with an `am:`
// ENTITY tier, and both of them say so in their own comments. Wave 6 mints the
// real thing: a `cohort` node whose `bucketKey` is `cohort:manager:<uuid>`. The
// three questions below are the three this file owns about it — may the camera
// stop there, does the reader's own ring still find them, and does a link to one
// come back.

const COHORT_KEY = 'cohort:manager:sara-uuid'
const COHORT_ID = `${OB_TRACK}/cohort:${encodeURIComponent(COHORT_KEY)}`

/** ob ▸ (Sara's cohort ▸ two orgs) ▸ an ungrouped org. */
function cohortTree(): MindNode {
  const orgs = [
    node(COHORT_ID, 'entity', 'org-1'),
    node(COHORT_ID, 'entity', 'org-2'),
  ]
  const cohort = node(OB_TRACK, 'cohort', COHORT_KEY, orgs, { bucketKey: COHORT_KEY })
  return node(null, 'root', 'root', [node(ROOT_ID, 'track', 'ob', [cohort])])
}

describe('a cohort is a place the camera may stop on', () => {
  it('is in the dive set, and a group and a fold still are not', () => {
    // `isStructuralKind` IS `KIND_ROLE`'s `'place'` row, and worlds.ts's
    // STRUCTURAL_KINDS is the same list spelled as strings one layer down. This
    // is the assertion that reds if the two ever disagree about a kind.
    const roles: Readonly<Record<MindNodeKind, boolean>> = {
      root: true,
      track: true,
      entity: true,
      cohort: true,
      group: false,
      more: false,
      entry: false,
    }
    for (const kind of Object.keys(roles) as MindNodeKind[]) {
      expect(isStructuralKind(kind), kind).toBe(roles[kind])
    }
  })

  it('may be focused even with nothing under it', () => {
    // `canFocus`'s exception of KIND rather than of degree. A cohort with no
    // organizations cannot be built by `groupEntities` — but the rule is about
    // what the node MEANS, and "the 41 on Integrating" is an answer whether or
    // not any work is filed under them.
    expect(canFocus(node(OB_TRACK, 'cohort', COHORT_KEY, [], { bucketKey: COHORT_KEY }))).toBe(true)
    // The kinds that are still refused when empty, unchanged.
    expect(canFocus(node(ROOT_ID, 'track', 'empty'))).toBe(false)
    expect(canFocus(node(OB_TRACK, 'group', 'blocked'))).toBe(false)
  })

  it('resolves a link to a cohort rather than climbing past it', () => {
    const tree = cohortTree()
    const view = resolveFocus(tree, COHORT_ID)
    expect(view.focusId).toBe(COHORT_ID)
    expect(view.missingId).toBeNull()
    expect(view.node.kind).toBe('cohort')
    // And the id survives the URL codec, which is the other half of the link.
    expect(viewFromParams(new URLSearchParams(`focus=${encodeURIComponent(COHORT_ID)}`)).focusId)
      .toBe(COHORT_ID)
  })

  it('opens an account manager on their real cohort, by `bucketKey === meId`', () => {
    // Wave 5 wrote "this is what wave 6's `?by=manager` cohort node will be".
    // It is now that node, and `owns()` finds it because `isStructuralKind`
    // admits the kind — with the old three-way comparison it would have answered
    // false and the AM would have opened on the whole workspace.
    expect(defaultFocusFor(COHORT_KEY, 'member', cohortTree())).toBe(COHORT_ID)
  })
})

/**
 * ── THE SEAM WAVE 6 CREATED BETWEEN `?by=` AND THE OPENING CAMERA ──────────
 *
 * `defaultFocusFor` descends only while ONE child holds every mark the reader
 * owns. Wave 5 built it against a tree whose shape came from the ADMIN, where
 * an account manager's organizations sit under one configured node. Wave 6 lets
 * the READER re-cut that ring from the address bar, and the two axes answer this
 * question differently:
 *
 *   `?by=manager` — every mark is inside one cohort, so the walk descends into
 *                   it and the AM opens on their own book, which is the whole of
 *                   wave 5's headline.
 *   `?by=stage`   — the same organizations are scattered across every rung, so
 *                   no single child holds them all and the walk stops one ring
 *                   OUT, on the phase.
 *
 * BOTH ARE CORRECT and neither is a fallback: the second is what "group by
 * stage" MEANS. It is pinned here because it is a cross-unit consequence nobody
 * chose — `DEFAULT_PORTFOLIO_BY` is `'stage'` (lib/mindtree/lens.ts, picked for
 * the TABLE's morning answer) and `pages/Mindtree.tsx` hands the same value to
 * the canvas — so the default map at 400 organizations opens on the ladder
 * rather than on the reader's book. Changing that is a decision about the
 * product; noticing it silently change is what this test prevents.
 *
 * `managerOf` IS THE REAL MECHANISM, and it is passed here for that reason.
 * `owns()` also tests `bucketKey === meId`, which a cohort's synthetic
 * `cohort:manager:<uuid>` never satisfies — `useMapFocus` builds `managerOf`
 * from `map_nodes.account_manager_id`, so it is the ORGANIZATIONS that carry the
 * ownership and the cohort that inherits it by holding them.
 */
describe('where the map opens depends on which axis `?by=` cut', () => {
  const AM = 'am-1'
  const MEMBERS = [
    { id: AM, displayName: 'Sara' },
    { id: 'am-2', displayName: 'Faisal' },
  ]
  const STAGES = Array.from({ length: 4 }, (_, i) => ({ key: `st-${i}`, label: `Stage ${i}` }))

  /**
   * 40 organizations under one phase: two managers, four stages, no holes.
   *
   * FORTY, so that BOTH axes land under the cap in ONE cut and the two trees
   * differ only in which axis was spent — two books of 20, or four rungs of 10.
   * A fixture where one axis had to recurse would confound "the walk stopped
   * here" with "the ladder went further".
   *
   * The stage runs on `i / 2` rather than on `i`, and that is the fixture's one
   * piece of care: `MEMBERS[i % 2]` with `STAGES[i % 4]` correlates the two
   * perfectly, so an account manager would hold exactly two stages and the
   * scatter this test is about would be half as wide as the real thing.
   */
  function portfolio(): {
    entities: MindtreeInput['entities']
    facets: NonNullable<MindtreeInput['entityFacets']>
  } {
    const entities: MindEntity[] = [
      { id: 'ob', trackId: 'ob', parentId: null, label: 'Onboarding', typeKey: null, sortOrder: 0, archived: false },
    ]
    const facets: MindEntityFacet[] = []
    for (let i = 0; i < 40; i += 1) {
      const id = `org-${i}`
      entities.push({
        id,
        trackId: 'ob',
        parentId: 'ob',
        label: `Org ${i}`,
        typeKey: null,
        sortOrder: i,
        archived: false,
      })
      facets.push({
        id,
        managerId: MEMBERS[i % 2].id,
        typeKey: null,
        vendor: null,
        stageId: STAGES[Math.floor(i / 2) % 4].key,
      })
    }
    return { entities, facets }
  }

  function treeBy(grouping: 'manager' | 'stage'): MindNode {
    const { entities, facets } = portfolio()
    return build({
      tracks: [track('ob', { label: 'Onboarding' })],
      entities,
      entityFacets: facets,
      members: MEMBERS,
      stages: STAGES,
      grouping,
    })
  }

  /** `useMapFocus`'s own memo: `map_nodes.id` → `account_manager_id`. */
  const managerOf = (bucketKey: string): string | null => {
    const { facets } = portfolio()
    return facets.find((f) => f.id === bucketKey)?.managerId ?? null
  }

  it('lands an account manager INSIDE their own book under `?by=manager`', () => {
    const tree = treeBy('manager')
    const id = defaultFocusFor(AM, 'member', tree, managerOf)
    const landed = findNode(tree, id ?? '')
    expect(landed?.kind).toBe('cohort')
    expect(landed?.bucketKey).toBe('cohort:manager:am-1')
    // Their whole book and nobody else's, resolved straight to organizations —
    // twenty is under the cap, so a small group never cohorts (rule 4).
    expect(landed?.children).toHaveLength(20)
    expect(landed?.children.every((c) => c.kind === 'entity')).toBe(true)
  })

  it('stops one ring OUT under `?by=stage`, because the book is spread over four', () => {
    const tree = treeBy('stage')
    const id = defaultFocusFor(AM, 'member', tree, managerOf)
    const landed = findNode(tree, id ?? '')
    // The phase, not a cohort: four stage rings, each holding a quarter of the
    // reader's organizations, so no child holds them all.
    expect(landed?.kind).toBe('entity')
    expect(landed?.bucketKey).toBe('ob')
    expect(landed?.children).toHaveLength(4)
    expect(landed?.children.every((c) => c.kind === 'cohort')).toBe(true)
  })
})
