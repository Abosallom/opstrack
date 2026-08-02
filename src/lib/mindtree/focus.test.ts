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
//
// The regroup test deliberately runs `buildMindtree` TWICE rather than hand-
// writing two trees. Hand-written ids would prove the walk works on ids I chose;
// the point is that it works on the ids model.ts actually mints.

import { describe, expect, it } from 'vitest'
import { EMPTY_FILTER, type FilterContext } from '../entryFilter'
import {
  ancestorIdsOf,
  canFocus,
  dimensionStableId,
  drawnIds,
  findNode,
  nearestId,
  refocusTarget,
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
    bucketKey: kind === 'track' || kind === 'group' ? key : null,
    retired: false,
    ...over,
  }
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
      ' ',
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
    const long = `${ROOT_ID}/track:${'a'.repeat(600)}`
    expect(viewFromParams(new URLSearchParams(`focus=${long}`)).focusId).toBeNull()
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
