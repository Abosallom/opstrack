// Contract tests for what a node on the map lets you do.
//
// THE TREES ARE REAL. Almost every case below runs `buildMindtree()` and then
// walks to the node it cares about, rather than hand-building a `MindNode`
// literal. That is the point of the file: actions.ts reads three fields off a
// node — `kind`, `bucketKey`, `retired` — and every claim it makes about them is
// a claim about what MODEL.TS EMITS. A hand-written fixture asserts that
// actions.ts is self-consistent, which is not the property at risk.
//
// The two sentinels are the sharpest case. `NO_VALUE = ''` and
// `NAME_PREFIX = 'name:'` are IMPORTED from dropRules.ts, but model.ts declares
// its own copies privately (as do pages/Board.tsx and lib/aggregate.ts), and
// model.ts's own comment says why they must agree: "three modules bucketing the
// same rows must produce the same keys or the board, the dashboard and the map
// disagree about who owns what". Sharing a constant does not check that. The
// first block below does: it asserts the keys model.ts ACTUALLY PRODUCES for an
// unassigned row, an untracked row and a vendor. A rename there reds this file
// instead of silently routing every unassigned draft into a patch that sets
// `ownerId` to the empty string.
//
// EVERY INSTANT IS T12:00:00Z, the convention model.test.ts and aggregate.test.ts
// set: `instantToIsoDate()` resolves an instant to the reader's LOCAL calendar
// day, so a fixture written at midnight UTC lands on the previous day west of
// Greenwich and would pass in Riyadh and fail in CI.

import { describe, expect, it } from 'vitest'
import { EMPTY_FILTER, type FilterContext } from '../entryFilter'
import { ENTRIES_UPDATE_IS_OPEN } from '../permissions'
import {
  MAX_BRANCH_LEVEL,
  MIND_BULK_CONFIRM_AT,
  WHY_CLOSED,
  WHY_DERIVED,
  WHY_EMPTY_BRANCH,
  WHY_FOCUSED,
  WHY_GONE,
  WHY_NONE_EDITABLE,
  WHY_NO_NUDGE,
  WHY_NO_SELECTION,
  WHY_RETIRED,
  WHY_SIGNED_OUT,
  WHY_TOO_DEEP,
  branchAddRefusal,
  branchRefAt,
  draftAt,
  draftRefusal,
  editableOf,
  mindActionsFor,
  type MindAction,
  type MindActionCtx,
  type MindNudgeVerdict,
} from './actions'
import { DROP_UNCHANGED_KEY } from './dropRules'
import { buildMindtree, type MindEntity, type MindNode, type MindtreeInput } from './model'
import type { Entry, EntryHealth, HealthLevel } from '../../types'

/* ───────────────────────────────── fixtures ──────────────────────────────── */

const CTX: FilterContext = { meId: 'me-1', today: '2026-07-30' }

function at(date: string): string {
  return `${date}T12:00:00.000Z`
}

function entry(over: Partial<Entry> & Pick<Entry, 'id'>): Entry {
  return {
    track_id: null,
    // `entries.node_id` — null is "on the track, under no organization".
    node_id: null,
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

function health(id: string, level: HealthLevel): EntryHealth {
  return {
    id,
    entry_id: id,
    track_id: null,
    status: 'new',
    priority: 'medium',
    due_date: null,
    last_activity_at: at('2026-07-01'),
    days_since_activity: 0,
    days_overdue: 0,
    health: level,
    sla_due_at: null,
    sla_breached: false,
  }
}

function statusVocab(hidden: readonly string[] = []): MindtreeInput['vocab'] {
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
    entities: [],
    vocab: [],
    members: [],
    dimension: 'status',
    filter: EMPTY_FILTER,
    ctx: CTX,
    collapsedIds: new Set(),
    leafThreshold: 50,
    ...over,
  })
}

/** The chain from the root down to `id`, inclusive. Empty when there is none. */
function pathTo(node: MindNode, id: string, trail: MindNode[] = []): MindNode[] {
  trail.push(node)
  if (node.id === id) return trail
  for (const child of node.children) {
    const hit = pathTo(child, id, trail)
    if (hit.length > 0) return hit
  }
  trail.pop()
  return []
}

/** The first node satisfying a predicate, with its path. */
function findPath(root: MindNode, match: (n: MindNode) => boolean): MindNode[] {
  const hit = walk(root, match)
  if (hit === null) throw new Error('no node matched')
  return pathTo(root, hit.id)
}

function walk(node: MindNode, match: (n: MindNode) => boolean): MindNode | null {
  if (match(node)) return node
  for (const child of node.children) {
    const hit = walk(child, match)
    if (hit !== null) return hit
  }
  return null
}

const OFFERED: MindNudgeVerdict = { offer: 'first', blockedKey: null }
const NO_OFFER: MindNudgeVerdict = { offer: null, blockedKey: null }

function ctx(over: Partial<MindActionCtx> = {}): MindActionCtx {
  return {
    meId: 'me-1',
    role: 'member',
    entryById: new Map(),
    selection: new Set(),
    dimension: 'status',
    focusedId: null,
    nudge: () => NO_OFFER,
    ...over,
  }
}

function byKind(actions: readonly MindAction[], kind: MindAction['kind']): MindAction {
  const hit = actions.find((a) => a.kind === kind)
  if (hit === undefined) throw new Error(`no ${kind} action in [${actions.map((a) => a.kind).join(', ')}]`)
  return hit
}

function kinds(actions: readonly MindAction[]): string[] {
  return actions.map((a) => a.kind)
}

/* ──────────────── the sentinels, pinned against what model.ts emits ─────── */

describe('the bucket sentinels model.ts actually produces', () => {
  it('files an unassigned row under the empty-string owner bucket', () => {
    const rows = [entry({ id: 'a' })]
    const root = build({ entries: rows, dimension: 'owner' })
    const group = walk(root, (n) => n.kind === 'group')
    // If this ever becomes 'unassigned' or null, actions.ts's owner branch would
    // stop unassigning and start writing a literal id.
    expect(group?.bucketKey).toBe('')
  })

  it('files an untracked row under the empty-string track bucket', () => {
    const rows = [entry({ id: 'a' })]
    const root = build({ entries: rows, vocab: statusVocab() })
    const track = walk(root, (n) => n.kind === 'track')
    expect(track?.bucketKey).toBe('')
  })

  it('prefixes a free-text owner bucket with name:', () => {
    const rows = [entry({ id: 'a', owner_name: 'Acme Ltd' })]
    const root = build({ entries: rows, dimension: 'owner' })
    const group = walk(root, (n) => n.kind === 'group' && n.bucketKey !== '')
    expect(group?.bucketKey).toBe('name:Acme Ltd')
  })

  it('carries a member id verbatim on an owner bucket', () => {
    const rows = [entry({ id: 'a', owner_id: 'u-9' })]
    const root = build({
      entries: rows,
      dimension: 'owner',
      members: [{ id: 'u-9', displayName: 'Sara' }],
    })
    const group = walk(root, (n) => n.kind === 'group')
    expect(group?.bucketKey).toBe('u-9')
  })
})

/* ──────────────────────────────── draftAt ───────────────────────────────── */

describe('draftAt — what a NEW item filed at this branch carries', () => {
  it('folds the WHOLE path, so a status node under a track seeds both columns', () => {
    const rows = [entry({ id: 'a', track_id: 't-1', status: 'blocked' })]
    const root = build({
      entries: rows,
      tracks: [{ id: 't-1', label: 'Network', color: '#111', colorLight: null, sortOrder: 0, archived: false }],
      vocab: statusVocab(),
    })
    const path = findPath(root, (n) => n.kind === 'group')
    // Both, not just the status. An item CREATED here with only its status set
    // would be filed untracked and appear somewhere other than where it was
    // asked for.
    // `mapNodeId: null` rides along on the track step — a create under a
    // TRACK's bucket means "under no organization", and omitting the key would
    // let the capture form default it to whatever Org it last showed.
    expect(draftAt(path, 'status')).toEqual({ trackId: 't-1', mapNodeId: null, status: 'blocked' })
  })

  it('maps the untracked pile to a null trackId, never to the empty string', () => {
    const root = build({ entries: [entry({ id: 'a' })], vocab: statusVocab() })
    const path = findPath(root, (n) => n.kind === 'track')
    expect(draftAt(path, 'status')).toEqual({ trackId: null, mapNodeId: null })
  })

  it('unassigns through the empty owner bucket, clearing both owner columns', () => {
    const root = build({ entries: [entry({ id: 'a' })], dimension: 'owner' })
    const path = findPath(root, (n) => n.kind === 'group')
    // ownerName is cleared alongside because types.ts declares the two columns
    // mutually exclusive — a vendor's name left on an unowned row makes the
    // digest and the CSV export disagree with this screen.
    expect(draftAt(path, 'owner')).toEqual({
      trackId: null,
      mapNodeId: null,
      ownerId: null,
      ownerName: null,
    })
  })

  it('assigns to a member by id', () => {
    const root = build({
      entries: [entry({ id: 'a', owner_id: 'u-9' })],
      dimension: 'owner',
      members: [{ id: 'u-9', displayName: 'Sara' }],
    })
    const path = findPath(root, (n) => n.kind === 'group')
    const draft = draftAt(path, 'owner')
    expect(draft?.ownerId).toBe('u-9')
    expect(draft?.ownerName).toBeNull()
  })

  it('assigns to a vendor by name, decoding the prefix', () => {
    const root = build({ entries: [entry({ id: 'a', owner_name: 'Acme Ltd' })], dimension: 'owner' })
    const path = findPath(root, (n) => n.kind === 'group' && n.bucketKey !== '')
    const draft = draftAt(path, 'owner')
    expect(draft?.ownerId).toBeNull()
    expect(draft?.ownerName).toBe('Acme Ltd')
  })

  it('sets priority on the priority axis', () => {
    const root = build({
      entries: [entry({ id: 'a', priority: 'high' })],
      dimension: 'priority',
      vocab: [
        { key: 'low', label: 'Low', hidden: false },
        { key: 'medium', label: 'Medium', hidden: false },
        { key: 'high', label: 'High', hidden: false },
        { key: 'critical', label: 'Critical', hidden: false },
      ],
    })
    const path = findPath(root, (n) => n.kind === 'group')
    expect(draftAt(path, 'priority')?.priority).toBe('high')
  })

  it('refuses the health axis — it is derived, and there is no column', () => {
    const rows = [entry({ id: 'a' })]
    const root = build({ entries: rows, dimension: 'health', health: new Map([['a', health('a', 'overdue')]]) })
    const path = findPath(root, (n) => n.kind === 'group')
    expect(draftAt(path, 'health')).toBeNull()
    expect(draftRefusal(path, 'health')).toBe(WHY_DERIVED)
  })

  it('refuses an archived track that still holds work', () => {
    const rows = [entry({ id: 'a', track_id: 't-1' })]
    const root = build({
      entries: rows,
      tracks: [{ id: 't-1', label: 'Old', color: '#111', colorLight: null, sortOrder: 0, archived: true }],
      vocab: statusVocab(),
    })
    const path = findPath(root, (n) => n.kind === 'track')
    expect(path[path.length - 1].retired).toBe(true)
    expect(draftAt(path, 'status')).toBeNull()
    expect(draftRefusal(path, 'status')).toBe(WHY_RETIRED)
  })

  it('refuses a hidden vocabulary option that still holds work', () => {
    const rows = [entry({ id: 'a', status: 'blocked' })]
    const root = build({ entries: rows, vocab: statusVocab(['blocked']) })
    const path = findPath(root, (n) => n.kind === 'group')
    expect(path[path.length - 1].retired).toBe(true)
    expect(draftAt(path, 'status')).toBeNull()
  })

  it('refuses a retired ANCESTOR even when the leaf bucket is fine', () => {
    const rows = [entry({ id: 'a', track_id: 't-1', status: 'blocked' })]
    const root = build({
      entries: rows,
      tracks: [{ id: 't-1', label: 'Old', color: '#111', colorLight: null, sortOrder: 0, archived: true }],
      vocab: statusVocab(),
    })
    const path = findPath(root, (n) => n.kind === 'group')
    // The status bucket is live; the track above it is archived. Filing new work
    // into an archived track is how an archived track comes back to life.
    expect(draftAt(path, 'status')).toBeNull()
    expect(draftRefusal(path, 'status')).toBe(WHY_RETIRED)
  })

  it('refuses the root, an entry leaf and a "+N more" fold', () => {
    const rows = [entry({ id: 'a' }), entry({ id: 'b' }), entry({ id: 'c' })]
    const root = build({ entries: rows, vocab: statusVocab(), leafThreshold: 1 })
    for (const kind of ['root', 'entry', 'more'] as const) {
      const path = findPath(root, (n) => n.kind === kind)
      expect(draftAt(path, 'status'), kind).toBeNull()
      expect(draftRefusal(path, 'status'), kind).toBe(WHY_EMPTY_BRANCH)
    }
  })

  it('answers null for an empty path rather than throwing', () => {
    expect(draftAt([], 'status')).toBeNull()
    expect(draftRefusal([], 'status')).toBe(WHY_EMPTY_BRANCH)
  })
})

/* ─────────────────────────────── the entity ring ─────────────────────────── */
//
// UHR > OB > Org1. An `entity` node is a row in `map_nodes` — a programme, a
// phase, an Organization — hanging between a track and its status buckets.
//
// THE TREES HERE ARE REAL TOO, and for the reason this file's header gives:
// actions.ts reads `kind`, `bucketKey` and `retired` off a node, and every claim
// it makes about an Org is a claim about what model.ts EMITS for a `map_nodes`
// row. `orgTree()` hands `buildMindtree` a real hierarchy and the cases below
// walk to the node they care about, exactly as every case above does.

const UHR_TRACK = {
  id: 't-1',
  label: 'UHR',
  color: '#111',
  colorLight: null,
  sortOrder: 0,
  archived: false,
}

function ent(over: Partial<MindEntity> & Pick<MindEntity, 'id'>): MindEntity {
  return {
    trackId: 't-1',
    parentId: null,
    label: over.id,
    sortOrder: 0,
    archived: false,
    typeKey: 'Organization',
    ...over,
  }
}

/** UHR ▸ OB ▸ { Org1, an archived Org3 } — with one item under Org1. */
function orgTree(over: Partial<MindtreeInput> = {}): MindNode {
  return build({
    entries: [entry({ id: 'a', track_id: 't-1', node_id: 'org-1', created_by: 'me-1' })],
    tracks: [UHR_TRACK],
    vocab: statusVocab(),
    entities: [
      ent({ id: 'ob', label: 'OB', typeKey: 'Phase' }),
      ent({ id: 'org-1', parentId: 'ob' }),
      // Archived but holding work, so model.ts keeps it drawn — the branch that
      // must refuse NEW work while still showing the old.
      ent({ id: 'org-old', parentId: 'ob', sortOrder: 1, archived: true }),
    ],
    ...over,
  })
}

/** The real root-to-node chain down to the entity whose `map_nodes` id is `id`. */
function orgPath(id: string, over: Partial<MindtreeInput> = {}): MindNode[] {
  return findPath(orgTree(over), (n) => n.kind === 'entity' && n.bucketKey === id)
}

describe('draftAt on the entity ring', () => {
  it('seeds the node AND the track, so a new item lands under the Org it was asked for', () => {
    expect(draftAt(orgPath('org-1'), 'status')).toEqual({ trackId: 't-1', mapNodeId: 'org-1' })
  })

  it('takes the DEEPEST Org when the path runs through several', () => {
    // The path is root ▸ UHR ▸ OB ▸ Org1. `entries.node_id` is one column, not a
    // list: the item is filed on Org1, and the ancestry is the tree's business
    // rather than the row's.
    const path = orgPath('org-1')
    expect(path.map((n) => n.kind)).toEqual(['root', 'track', 'entity', 'entity'])
    expect(draftAt(path, 'status')).toEqual({ trackId: 't-1', mapNodeId: 'org-1' })
    // And the phase itself is filable — "the deepest ring is always an
    // Organization" is a reading the schema does not support.
    expect(draftAt(orgPath('ob'), 'status')).toEqual({ trackId: 't-1', mapNodeId: 'ob' })
  })

  it('keeps the Org when a status bucket hangs beneath it', () => {
    const path = findPath(
      orgTree(),
      (n) => n.kind === 'group' && n.bucketKey === 'new',
    )
    expect(path.map((n) => n.kind)).toEqual(['root', 'track', 'entity', 'entity', 'group'])
    expect(draftAt(path, 'status')).toEqual({
      trackId: 't-1',
      mapNodeId: 'org-1',
      status: 'new',
    })
  })

  it('refuses an archived Org, and an archived Org anywhere above', () => {
    const archived = orgPath('org-old', {
      entries: [entry({ id: 'a', track_id: 't-1', node_id: 'org-old', created_by: 'me-1' })],
    })
    expect(archived[archived.length - 1].retired).toBe(true)
    expect(draftAt(archived, 'status')).toBeNull()
    expect(draftRefusal(archived, 'status')).toBe(WHY_RETIRED)

    // A LIVE Org under an ARCHIVED phase. Filing new work through an archived
    // ancestor is how the archived branch quietly comes back to life.
    const throughArchived = orgPath('org-1', {
      entities: [
        ent({ id: 'ob', label: 'OB', typeKey: 'Phase', archived: true }),
        ent({ id: 'org-1', parentId: 'ob' }),
      ],
    })
    expect(throughArchived[throughArchived.length - 1].retired).toBe(false)
    expect(draftAt(throughArchived, 'status')).toBeNull()
    expect(draftRefusal(throughArchived, 'status')).toBe(WHY_RETIRED)
  })

  it('refuses an Org whose key is empty rather than seeding a uuid column blank', () => {
    // Not reachable from a real `map_nodes` row — the ids are uuids — so this is
    // the one case that has to be forged, from a real node. NO_VALUE is a real
    // bucket on the TRACK ring (the untracked pile) and no bucket at all here:
    // an item under no Org is drawn one ring shallower, so an empty key is a
    // malformed node and writing it would send `node_id = ''` at a uuid column.
    const path = orgPath('org-1')
    const org = path[path.length - 1]
    for (const forged of ['', null]) {
      const bad = [...path.slice(0, -1), { ...org, bucketKey: forged }]
      expect(draftAt(bad, 'status'), String(forged)).toBeNull()
    }
  })

  it('seeds an Org on the health axis, which has no opinion about places', () => {
    // Unlike ring 2. The entity ring is a place, not an axis, so the dimension
    // switcher cannot make it unfilable.
    expect(draftAt(orgPath('org-1'), 'health')).toEqual({ trackId: 't-1', mapNodeId: 'org-1' })
  })
})

describe('the acts an Org offers', () => {
  it('offers add-here and the bulk verb, exactly as a track and a bucket do', () => {
    const acts = mindActionsFor(orgPath('org-1'), ctx())
    expect(kinds(acts)).toContain('addHere')
    expect(kinds(acts)).toContain('applySelection')
    // Never the leaf verbs — an Org is a branch.
    expect(kinds(acts)).not.toContain('open')
    expect(kinds(acts)).not.toContain('nudge')
  })

  it('prefills add-here with the Org and its track', () => {
    const add = byKind(mindActionsFor(orgPath('org-1'), ctx()), 'addHere')
    expect(add.enabled).toBe(true)
    expect(add.patch).toEqual({ trackId: 't-1', mapNodeId: 'org-1' })
  })

  it('disables add-here under an archived Org, with the retired sentence', () => {
    const archived = orgPath('org-old', {
      entries: [entry({ id: 'a', track_id: 't-1', node_id: 'org-old', created_by: 'me-1' })],
    })
    const add = byKind(mindActionsFor(archived, ctx()), 'addHere')
    expect(add.enabled).toBe(false)
    expect(add.reasonKey).toBe(WHY_RETIRED)
  })

  it('REUSES actMoveHere rather than minting a key for the Org', () => {
    // lib/labelSections.test.ts fails on two keys carrying one string, and
    // "move here" is exactly what filing work under an Organization is. A
    // separate key would be a second English sentence and a second Arabic one
    // for no difference a reader can perceive.
    for (const dimension of ['status', 'owner', 'priority', 'health'] as const) {
      const bulk = byKind(mindActionsFor(orgPath('org-1'), ctx({ dimension })), 'applySelection')
      expect(bulk.labelKey, dimension).toBe('mindtree.actMoveHere')
    }
  })

  it('applies the selection to the Org, through dropRules and not a second derivation', () => {
    const row = entry({ id: 'z', track_id: 't-1', created_by: 'me-1' })
    const bulk = byKind(
      mindActionsFor(
        orgPath('org-1'),
        ctx({ entryById: new Map([['z', row]]), selection: new Set(['z']) }),
      ),
      'applySelection',
    )
    expect(bulk.enabled).toBe(true)
    expect(bulk.targetIds).toEqual(['z'])
    expect(bulk.patch).toEqual({ trackId: 't-1', mapNodeId: 'org-1' })
    // Filing into an Organization is a move, never a close.
    expect(bulk.closes).toBe(false)
  })

  it('says "already there" for a row that is already under this Org', () => {
    // The no-op arm, reached through the entity ring. Writing it would bump
    // last_activity_at and reset the staleness clock on work nobody touched.
    const row = entry({ id: 'a', track_id: 't-1', node_id: 'org-1', created_by: 'me-1' })
    const bulk = byKind(
      mindActionsFor(
        orgPath('org-1'),
        ctx({ entryById: new Map([['a', row]]), selection: new Set(['a']) }),
      ),
      'applySelection',
    )
    expect(bulk.enabled).toBe(false)
    expect(bulk.reasonKey).toBe(DROP_UNCHANGED_KEY)
  })

  it('moves a row OUT of its Org when the bulk verb sits on the track', () => {
    // THE LOAD-BEARING LINE, seen from the menu instead of from the drag: the
    // track's own branch means "under no organization", so the patch has to
    // clear the node or the next rebuild files the row back under Org1.
    const row = entry({ id: 'a', track_id: 't-1', node_id: 'org-1', created_by: 'me-1' })
    const path = findPath(orgTree(), (n) => n.kind === 'track')
    const bulk = byKind(
      mindActionsFor(path, ctx({ entryById: new Map([['a', row]]), selection: new Set(['a']) })),
      'applySelection',
    )
    expect(bulk.enabled).toBe(true)
    expect(bulk.patch).toEqual({ trackId: 't-1', mapNodeId: null })
  })

  it('keeps every string on an Org a translated key', () => {
    const row = entry({ id: 'z', track_id: 't-1', created_by: 'me-1' })
    const cx = ctx({ entryById: new Map([['z', row]]), selection: new Set(['z']) })
    const seen: string[] = []
    const archived = orgPath('org-old', {
      entries: [entry({ id: 'a', track_id: 't-1', node_id: 'org-old', created_by: 'me-1' })],
    })
    for (const path of [orgPath('ob'), orgPath('org-1'), archived]) {
      for (const a of mindActionsFor(path, cx)) {
        seen.push(a.labelKey)
        if (a.reasonKey !== null) seen.push(a.reasonKey)
      }
    }
    expect(seen.length).toBeGreaterThan(3)
    expect(seen.filter((k) => !/^(mindtree|entry)\.[A-Za-z]+$/.test(k))).toEqual([])
  })
})

/* ───────────────────────────────── a leaf ────────────────────────────────── */

function leafPath(rows: Entry[], over: Partial<MindtreeInput> = {}): MindNode[] {
  const root = build({ entries: rows, vocab: statusVocab(), ...over })
  return findPath(root, (n) => n.kind === 'entry')
}

describe('a leaf', () => {
  it('offers open, the four writes and the nudge — never focus or collapse', () => {
    const rows = [entry({ id: 'a' })]
    const actions = mindActionsFor(leafPath(rows), ctx({ entryById: new Map([['a', rows[0]]]) }))
    expect(kinds(actions)).toEqual(['open', 'assign', 'status', 'priority', 'done', 'nudge'])
  })

  it('always lets you open it — reading is not what RLS gates', () => {
    const rows = [entry({ id: 'a' })]
    const actions = mindActionsFor(
      leafPath(rows),
      ctx({ meId: null, entryById: new Map([['a', rows[0]]]) }),
    )
    expect(byKind(actions, 'open').enabled).toBe(true)
    expect(byKind(actions, 'open').mutates).toBe(false)
  })

  it('names being signed out rather than blaming ownership', () => {
    const rows = [entry({ id: 'a' })]
    const actions = mindActionsFor(
      leafPath(rows),
      ctx({ meId: null, entryById: new Map([['a', rows[0]]]) }),
    )
    // Sending a signed-out reader to look for an admin is the wrong place, which
    // is exactly why canEditEntryUnder tests the null id first.
    expect(byKind(actions, 'assign').reasonKey).toBe(WHY_SIGNED_OUT)
    expect(byKind(actions, 'status').reasonKey).toBe(WHY_SIGNED_OUT)
    expect(byKind(actions, 'done').reasonKey).toBe(WHY_SIGNED_OUT)
  })

  it('refuses "mark as done" on an item that is already closed', () => {
    const rows = [entry({ id: 'a', status: 'done', closed_at: at('2026-07-20') })]
    const actions = mindActionsFor(
      leafPath(rows, { filter: { ...EMPTY_FILTER, scope: 'all' } }),
      ctx({ entryById: new Map([['a', rows[0]]]) }),
    )
    const done = byKind(actions, 'done')
    expect(done.enabled).toBe(false)
    expect(done.reasonKey).toBe(WHY_CLOSED)
    // The other three are untouched: a closed item can still be reassigned or
    // re-prioritised, and reopening it is a status change.
    expect(byKind(actions, 'status').enabled).toBe(true)
  })

  it('reports the permission before the state on a row it may not edit', () => {
    // Under the SHIPPED policy (ENTRIES_UPDATE_IS_OPEN) every signed-in member
    // may edit every row, so this asserts the open branch. The assertion is
    // written against the constant rather than hardcoded to `true` so that
    // flipping that one line — which the plan says is the only line that
    // changes — reds this test instead of shipping a screen full of grey with
    // no sentence behind it.
    const rows = [entry({ id: 'a', created_by: 'other', owner_id: 'other', status: 'done' })]
    const actions = mindActionsFor(
      leafPath(rows, { filter: { ...EMPTY_FILTER, scope: 'all' } }),
      ctx({ entryById: new Map([['a', rows[0]]]) }),
    )
    const done = byKind(actions, 'done')
    if (ENTRIES_UPDATE_IS_OPEN) {
      expect(done.reasonKey).toBe(WHY_CLOSED)
    } else {
      // Telling someone an item is already closed, when they could not have
      // closed it anyway, sends them to the wrong conclusion.
      expect(done.reasonKey).not.toBe(WHY_CLOSED)
    }
  })

  it('carries the done patch and nothing else', () => {
    const rows = [entry({ id: 'a' })]
    const actions = mindActionsFor(leafPath(rows), ctx({ entryById: new Map([['a', rows[0]]]) }))
    expect(byKind(actions, 'done').patch).toEqual({ status: 'done' })
    // The value for the other three is chosen in the sub-menu the surface opens.
    expect(byKind(actions, 'assign').patch).toBeNull()
    expect(byKind(actions, 'status').patch).toBeNull()
  })

  it('targets exactly its own entry, never the selection', () => {
    const rows = [entry({ id: 'a' }), entry({ id: 'b' })]
    const path = leafPath(rows)
    const id = path[path.length - 1].entryId
    const actions = mindActionsFor(
      path,
      ctx({
        entryById: new Map(rows.map((r) => [r.id, r])),
        selection: new Set(['a', 'b']),
      }),
    )
    // A right-click on one node acts on that node. The bulk verb is a BRANCH
    // affordance, and conflating the two is how a menu closes six items.
    expect(byKind(actions, 'status').targetIds).toEqual([id])
  })

  it('offers only "open" for a leaf the store has already dropped', () => {
    const rows = [entry({ id: 'a' })]
    const actions = mindActionsFor(leafPath(rows), ctx({ entryById: new Map() }))
    expect(kinds(actions)).toEqual(['open'])
    expect(byKind(actions, 'open').enabled).toBe(true)
  })

  it('reports WHY_GONE when the leaf carries no entry id at all', () => {
    const orphan: MindNode = {
      id: 'root/track:t/group:g/entry:x',
      kind: 'entry',
      label: { kind: 'text', text: 'x' },
      count: 1,
      colourVars: {},
      health: { levels: { ok: 1, stale: 0, overdue: 0, critical: 0 }, slaBreached: false },
      children: [],
      collapsed: false,
      depth: 3,
      entryId: null,
      bucketKey: null,
      // Only an `entity` node ever carries one; a leaf's is always null.
      entityType: null,
      retired: false,
    }
    const actions = mindActionsFor([orphan], ctx())
    expect(byKind(actions, 'open').enabled).toBe(false)
    expect(byKind(actions, 'open').reasonKey).toBe(WHY_GONE)
  })
})

describe('the nudge verdict is plumbed, never recomputed', () => {
  const rows = [entry({ id: 'a', owner_id: 'u-9' })]

  function nudgeAction(verdict: MindNudgeVerdict): MindAction {
    return byKind(
      mindActionsFor(leafPath(rows), ctx({ entryById: new Map([['a', rows[0]]]), nudge: () => verdict })),
      'nudge',
    )
  }

  it('offers a first ask', () => {
    const a = nudgeAction(OFFERED)
    expect(a.enabled).toBe(true)
    expect(a.labelKey).toBe('mindtree.actNudge')
    expect(a.reasonKey).toBeNull()
  })

  it('says AGAIN when the window has reopened, so nobody sends a repeat believing it is the first', () => {
    expect(nudgeAction({ offer: 'again', blockedKey: null }).labelKey).toBe('mindtree.actNudgeAgain')
  })

  it('passes the caller sentence through when the ask is blocked', () => {
    const a = nudgeAction({ offer: null, blockedKey: 'nudge.errTooSoon' })
    expect(a.enabled).toBe(false)
    expect(a.reasonKey).toBe('nudge.errTooSoon')
  })

  it('falls back to its own sentence when the caller supplies none', () => {
    expect(nudgeAction(NO_OFFER).reasonKey).toBe(WHY_NO_NUDGE)
  })

  it('never carries a patch — a nudge is an RPC, not a column', () => {
    expect(nudgeAction(OFFERED).patch).toBeNull()
    expect(nudgeAction(OFFERED).mutates).toBe(true)
  })
})

/* ──────────────────────────────── a branch ───────────────────────────────── */

function trackTree(): MindNode {
  const rows = [
    entry({ id: 'a', track_id: 't-1', status: 'new', created_by: 'me-1' }),
    entry({ id: 'b', track_id: 't-1', status: 'new', created_by: 'me-1' }),
  ]
  return build({
    entries: rows,
    tracks: [{ id: 't-1', label: 'Network', color: '#111', colorLight: null, sortOrder: 0, archived: false }],
    vocab: statusVocab(),
  })
}

describe('a branch', () => {
  it('offers add-here, the bulk verb, focus and collapse — never open or nudge', () => {
    const root = trackTree()
    const path = findPath(root, (n) => n.kind === 'track')
    expect(kinds(mindActionsFor(path, ctx()))).toEqual([
      'addHere',
      'applySelection',
      'focus',
      'collapse',
    ])
  })

  it('prefills add-here with the branch it sits on', () => {
    const root = trackTree()
    const path = findPath(root, (n) => n.kind === 'group')
    const add = byKind(mindActionsFor(path, ctx()), 'addHere')
    expect(add.enabled).toBe(true)
    expect(add.patch).toEqual({ trackId: 't-1', mapNodeId: null, status: 'new' })
    // It creates rather than patches, so there is nothing to target.
    expect(add.targetIds).toEqual([])
  })

  it('lets any signed-in member add — entries_insert is is_member(), not is_admin()', () => {
    const path = findPath(trackTree(), (n) => n.kind === 'track')
    expect(byKind(mindActionsFor(path, ctx({ role: 'member' })), 'addHere').enabled).toBe(true)
    expect(byKind(mindActionsFor(path, ctx({ meId: null })), 'addHere').reasonKey).toBe(WHY_SIGNED_OUT)
  })

  it('refuses to file new work under a retired branch', () => {
    const rows = [entry({ id: 'a', track_id: 't-1' })]
    const root = build({
      entries: rows,
      tracks: [{ id: 't-1', label: 'Old', color: '#111', colorLight: null, sortOrder: 0, archived: true }],
      vocab: statusVocab(),
    })
    const path = findPath(root, (n) => n.kind === 'track')
    const add = byKind(mindActionsFor(path, ctx()), 'addHere')
    expect(add.enabled).toBe(false)
    expect(add.reasonKey).toBe(WHY_RETIRED)
  })

  it('gives the root an add-here with no prefill and no bulk verb', () => {
    const actions = mindActionsFor([trackTree()], ctx())
    expect(byKind(actions, 'addHere').patch).toEqual({})
    // The root stands for the workspace, not for a bucket; "apply the selection
    // to everything" is a category error, not a refusal.
    expect(kinds(actions)).not.toContain('applySelection')
  })

  it('disables focus on the node that is already focused, and on a childless one', () => {
    const root = trackTree()
    const trackPath = findPath(root, (n) => n.kind === 'track')
    const node = trackPath[trackPath.length - 1]

    const focused = byKind(mindActionsFor(trackPath, ctx({ focusedId: node.id })), 'focus')
    expect(focused.enabled).toBe(false)
    expect(focused.reasonKey).toBe(WHY_FOCUSED)

    // The root normalises: with nothing focused, the root IS the view.
    const rootFocus = byKind(mindActionsFor([root], ctx({ focusedId: null })), 'focus')
    expect(rootFocus.reasonKey).toBe(WHY_FOCUSED)
  })

  it('disables focus on a branch with nothing under it', () => {
    const root = build({
      entries: [],
      tracks: [{ id: 't-1', label: 'Empty', color: '#111', colorLight: null, sortOrder: 0, archived: false }],
      vocab: statusVocab(),
    })
    const path = findPath(root, (n) => n.kind === 'track')
    const actions = mindActionsFor(path, ctx())
    expect(byKind(actions, 'focus').reasonKey).toBe(WHY_EMPTY_BRANCH)
    // And there is nothing to collapse either — a node claiming aria-expanded
    // with no children promises a subtree nobody can reach.
    expect(kinds(actions)).not.toContain('collapse')
  })

  it('flips the collapse label with the node state', () => {
    const open = findPath(trackTree(), (n) => n.kind === 'track')
    expect(byKind(mindActionsFor(open, ctx()), 'collapse').labelKey).toBe('mindtree.actCollapse')

    const node = open[open.length - 1]
    const closedRoot = build({
      entries: [entry({ id: 'a', track_id: 't-1' })],
      tracks: [{ id: 't-1', label: 'Network', color: '#111', colorLight: null, sortOrder: 0, archived: false }],
      vocab: statusVocab(),
      collapsedIds: new Set([node.id]),
    })
    const closed = findPath(closedRoot, (n) => n.kind === 'track')
    expect(byKind(mindActionsFor(closed, ctx()), 'collapse').labelKey).toBe('mindtree.actExpand')
  })

  it('shows the bulk verb disabled, with a reason, on a branch that takes nothing', () => {
    const rows = [entry({ id: 'a' })]
    const root = build({ entries: rows, dimension: 'health', health: new Map([['a', health('a', 'stale')]]) })
    const path = findPath(root, (n) => n.kind === 'group')
    const entryById = new Map(rows.map((r) => [r.id, r]))

    // THE SELECTION IS CHECKED FIRST, and that precedence is deliberate rather
    // than incidental. With nothing ticked there is no row to evaluate against
    // the branch, and "nothing is selected yet" is both true and the thing to
    // fix; the ring's own refusal arrives the moment there is something to
    // apply. The drag path reaches the second sentence directly, because a drag
    // always carries a row.
    const idle = byKind(mindActionsFor(path, ctx({ dimension: 'health' })), 'applySelection')
    expect(idle.reasonKey).toBe(WHY_NO_SELECTION)

    const bulk = byKind(
      mindActionsFor(path, ctx({ dimension: 'health', entryById, selection: new Set(['a']) })),
      'applySelection',
    )
    expect(bulk.enabled).toBe(false)
    expect(bulk.reasonKey).toBe(WHY_DERIVED)
    expect(bulk.patch).toBeNull()
  })
})

describe('closes, the property that raises the second question', () => {
  it('is true for the done verb and false for the axis verbs it sits beside', () => {
    const row = entry({ id: 'e1', created_by: 'me-1' })
    const tree = build({ entries: [row], vocab: statusVocab() })
    const leaf = findPath(tree, (n) => n.kind === 'entry')
    const acts = mindActionsFor(leaf, ctx({ entryById: new Map([['e1', row]]) }))
    // "Mark as done" carries its value in its name, and that value is closed.
    expect(byKind(acts, 'done').closes).toBe(true)
    // The three that open a sub-menu do not know their value yet — the chosen
    // row's own DropOutcome answers for them.
    for (const kind of ['assign', 'status', 'priority'] as const) {
      expect(byKind(acts, kind).closes).toBe(false)
    }
    expect(byKind(acts, 'open').closes).toBe(false)
    expect(byKind(acts, 'nudge').closes).toBe(false)
  })
})

/* ────────────────────────────── the selection ────────────────────────────── */

describe('applying the selection to a branch', () => {
  const rows = [
    entry({ id: 'a', track_id: null }),
    entry({ id: 'b', track_id: null }),
    entry({ id: 'c', track_id: null }),
  ]
  const entryById = new Map(rows.map((r) => [r.id, r]))

  function bulkAt(over: Partial<MindActionCtx>): MindAction {
    const path = findPath(trackTree(), (n) => n.kind === 'track')
    return byKind(mindActionsFor(path, ctx({ entryById, ...over })), 'applySelection')
  }

  it('says so when nothing is ticked', () => {
    const bulk = bulkAt({ selection: new Set() })
    expect(bulk.enabled).toBe(false)
    expect(bulk.reasonKey).toBe(WHY_NO_SELECTION)
  })

  it('targets the ticked rows in tick order', () => {
    const bulk = bulkAt({ selection: new Set(['c', 'a']) })
    expect(bulk.enabled).toBe(true)
    // Insertion order, not store order: a confirm dialog naming the first three
    // of eighteen should name the three they ticked first.
    expect(bulk.targetIds).toEqual(['c', 'a'])
    expect(bulk.patch).toEqual({ trackId: 't-1', mapNodeId: null })
  })

  it('drops ticked ids the store no longer holds rather than counting them', () => {
    const bulk = bulkAt({ selection: new Set(['a', 'ghost']) })
    // Counting a row that cannot land would put a number in the confirm dialog
    // larger than the number of items that move.
    expect(bulk.targetIds).toEqual(['a'])
  })

  it('says when nothing ticked can be written by this viewer', () => {
    const bulk = bulkAt({ meId: null, selection: new Set(['a', 'b']) })
    // Signed out is reported as itself, not as "none of these are yours".
    expect(bulk.reasonKey).toBe(WHY_SIGNED_OUT)

    const gone = bulkAt({ selection: new Set(['ghost']) })
    expect(gone.reasonKey).toBe(WHY_NONE_EDITABLE)
  })

  it('asks first above the bulk threshold, and not below it', () => {
    const many = Array.from({ length: MIND_BULK_CONFIRM_AT }, (_, i) => entry({ id: `x${i}` }))
    const map = new Map(many.map((r) => [r.id, r]))
    const ids = many.map((r) => r.id)
    expect(bulkAt({ entryById: map, selection: new Set(ids) }).confirm).toBe(true)
    expect(bulkAt({ entryById: map, selection: new Set(ids.slice(0, -1)) }).confirm).toBe(false)
  })

  /* ── the second reason to ask ──────────────────────────────────────────── */

  // REGRESSION. `closes` was not on MindAction at all, so the bulk verb — the
  // ONE verb that hands its caller no `DropOutcome` to inspect — could close
  // nine ticked items with no dialog, while DRAGGING the same nine onto the same
  // branch asked first (`DragLayer.commitDrop` gates on `plan.closes`).
  // `entries_set_closed_at()` stamps `closed_at` and takes the rows off every
  // open list on the screen, and there is no bulk undo.
  it('reports that a bulk apply onto a closed bucket CLOSES, below the threshold', () => {
    const open = [
      entry({ id: 'a', track_id: 't-1', status: 'new', created_by: 'me-1' }),
      entry({ id: 'b', track_id: 't-1', status: 'new', created_by: 'me-1' }),
      entry({ id: 'c', track_id: 't-1', status: 'new', created_by: 'me-1' }),
    ]
    // A Done branch is only DRAWN when something is already in it —
    // `model.vocabGroups` emits populated buckets only — and closed rows are out
    // of the default `scope: 'open'`. Both are the reader's real path to this
    // screen: widen the scope in the filter bar and the closed buckets appear,
    // which is exactly when a bulk apply can close things.
    const closed = entry({
      id: 'z',
      track_id: 't-1',
      status: 'done',
      created_by: 'me-1',
      closed_at: at('2026-07-02'),
    })
    const map = new Map([...open, closed].map((r) => [r.id, r]))
    const tree = build({
      entries: [...open, closed],
      filter: { ...EMPTY_FILTER, scope: 'all' },
      tracks: [
        { id: 't-1', label: 'Network', color: '#111', colorLight: null, sortOrder: 0, archived: false },
      ],
      vocab: statusVocab(),
    })
    const doneBranch = findPath(tree, (n) => n.kind === 'group' && n.bucketKey === 'done')
    const bulk = byKind(
      mindActionsFor(doneBranch, ctx({ entryById: map, selection: new Set(['a', 'b', 'c']) })),
      'applySelection',
    )
    expect(bulk.enabled).toBe(true)
    expect(bulk.targetIds).toEqual(['a', 'b', 'c'])
    // Three is below MIND_BULK_CONFIRM_AT, so SIZE alone asks nothing...
    expect(bulk.confirm).toBe(false)
    // ...and this is the property that has to carry the question instead.
    expect(bulk.closes).toBe(true)
  })

  it('does not claim a move between open buckets closes anything', () => {
    const bulk = bulkAt({ selection: new Set(['a', 'b']) })
    expect(bulk.closes).toBe(false)
  })

  it('editableOf filters to what canEditEntry accepts', () => {
    const editable = editableOf(ctx({ entryById, selection: new Set(['a', 'ghost', 'b']) }))
    expect(editable).toEqual(['a', 'b'])
    expect(editableOf(ctx({ entryById, meId: null, selection: new Set(['a']) }))).toEqual([])
  })
})

/* ────────────────────── the drop, delegated not duplicated ──────────────── */

describe('the bulk verb runs dropRules, so the menu and the drag cannot disagree', () => {
  it('skips rows already sitting in the target bucket', () => {
    // dropRules answers `noop` for these. Writing them would bump
    // last_activity_at and reset the staleness clock on work nobody touched —
    // the defect R3-LEAD-1 closed for handovers — and would put a number in the
    // confirm dialog larger than the number of items that move.
    const rows = [entry({ id: 'a', track_id: 't-1' }), entry({ id: 'b', track_id: null })]
    const entryById = new Map(rows.map((r) => [r.id, r]))
    const path = findPath(trackTree(), (n) => n.kind === 'track')
    const bulk = byKind(
      mindActionsFor(path, ctx({ entryById, selection: new Set(['a', 'b']) })),
      'applySelection',
    )
    expect(bulk.targetIds).toEqual(['b'])
    expect(bulk.enabled).toBe(true)
  })

  it('says "already there" rather than failing when every row is a no-op', () => {
    const rows = [entry({ id: 'a', track_id: 't-1' })]
    const entryById = new Map(rows.map((r) => [r.id, r]))
    const path = findPath(trackTree(), (n) => n.kind === 'track')
    const bulk = byKind(
      mindActionsFor(path, ctx({ entryById, selection: new Set(['a']) })),
      'applySelection',
    )
    // Nothing to do is not a failure, and it is not silence either: a keyboard
    // reader who just pressed the key needs the live region to say something.
    expect(bulk.enabled).toBe(false)
    expect(bulk.reasonKey).toBe(DROP_UNCHANGED_KEY)
    expect(bulk.targetIds).toEqual([])
  })

  it('takes the patch from dropRules rather than assembling a second one', () => {
    // The owner XOR is the trap dropRules.ownerPatch is written to close:
    // `ownerId: null` is falsy, so unassigning a row owned by a free-text vendor
    // has to send BOTH keys or the vendor name lingers. Rebuilding the patch
    // here would be a second place to get that wrong.
    // 'b' is what makes the Unassigned bucket exist to aim at; 'a' is the row
    // being moved into it.
    const rows = [entry({ id: 'a', owner_name: 'Acme Ltd' }), entry({ id: 'b' })]
    const entryById = new Map(rows.map((r) => [r.id, r]))
    const root = build({ entries: rows, dimension: 'owner' })
    const path = findPath(root, (n) => n.kind === 'group' && n.bucketKey === '')
    const bulk = byKind(
      mindActionsFor(path, ctx({ entryById, dimension: 'owner', selection: new Set(['a']) })),
      'applySelection',
    )
    // BOTH owner keys. `trackId: null` rides along because the path folds the
    // untracked pile these rows sit under, which is the branch the reader
    // actually pointed at.
    expect(bulk.patch).toEqual({ trackId: null, mapNodeId: null, ownerId: null, ownerName: null })
  })

  it('carries the refusal dropRules raised, not one of its own', () => {
    // 'a' is what keeps the archived track's branch on the map; 'b' is the
    // untracked row somebody tries to file into it. 'b' rather than 'a' because
    // dropRules tests the NO-OP before `retired` — a row already sitting in a
    // retired bucket has not attempted anything illegal — and this assertion is
    // about the refusal, not about that ordering.
    const rows = [entry({ id: 'a', track_id: 't-1' }), entry({ id: 'b' })]
    const entryById = new Map(rows.map((r) => [r.id, r]))
    const root = build({
      entries: rows,
      tracks: [{ id: 't-1', label: 'Old', color: '#111', colorLight: null, sortOrder: 0, archived: true }],
      vocab: statusVocab(),
    })
    const path = findPath(root, (n) => n.kind === 'track' && n.retired)
    const bulk = byKind(
      mindActionsFor(path, ctx({ entryById, selection: new Set(['b']) })),
      'applySelection',
    )
    expect(bulk.enabled).toBe(false)
    expect(bulk.reasonKey).toBe(WHY_RETIRED)
  })
})


/* ────────────────────────── every string is a key ────────────────────────── */

describe('every label and reason is a translated key', () => {
  it('holds across every node kind a real tree produces', () => {
    const rows = [
      entry({ id: 'a', track_id: 't-1' }),
      entry({ id: 'b', track_id: 't-1' }),
      entry({ id: 'c', track_id: 't-1' }),
    ]
    const root = build({
      entries: rows,
      tracks: [{ id: 't-1', label: 'Network', color: '#111', colorLight: null, sortOrder: 0, archived: false }],
      vocab: statusVocab(),
      leafThreshold: 1,
    })
    const entryById = new Map(rows.map((r) => [r.id, r]))
    const seen: string[] = []
    const visit = (node: MindNode): void => {
      const path = pathTo(root, node.id)
      for (const a of mindActionsFor(path, ctx({ entryById, selection: new Set(['a']) }))) {
        seen.push(a.labelKey)
        if (a.reasonKey !== null) seen.push(a.reasonKey)
      }
      node.children.forEach(visit)
    }
    visit(root)

    expect(seen.length).toBeGreaterThan(10)
    // A sentence written as a literal instead of a key is the defect
    // lib/pgError.ts exists to prevent: English text landing untranslated in an
    // RTL layout. Every string that leaves this module is a dotted key — in the
    // `mindtree` namespace, or in another one whose sentence already says this
    // exactly (`entry.errNotFound`, and dropRules' own refusals).
    expect(seen.filter((k) => !/^(mindtree|entry)\.[A-Za-z]+$/.test(k))).toEqual([])
  })
})


/* ─────────────────── shaping the map from the map itself ─────────────────── */
//
// The two verbs that edit `map_nodes` rather than `entries`. Everything below
// runs against a REAL tree for this file's stated reason: `branchRefAt` reads
// `kind`, `bucketKey` and `retired` off what model.ts emits, and a hand-written
// path would only prove that actions.ts agrees with itself.

/** UHR ▸ l1 ▸ l2 ▸ … ▸ l6, one item on the deepest, so every level is drawn. */
function deepTree(levels = 6): MindNode {
  const entities: MindEntity[] = []
  for (let i = 1; i <= levels; i += 1) {
    entities.push(ent({ id: `l${i}`, parentId: i === 1 ? null : `l${i - 1}`, typeKey: 'Phase' }))
  }
  return build({
    entries: [entry({ id: 'a', track_id: 't-1', node_id: `l${levels}`, created_by: 'me-1' })],
    tracks: [UHR_TRACK],
    vocab: statusVocab(),
    entities,
  })
}

function deepPath(id: string, levels = 6): MindNode[] {
  return findPath(deepTree(levels), (n) => n.kind === 'entity' && n.bucketKey === id)
}

/**
 * The archived Org, WITH the item that keeps it drawn.
 *
 * model.ts renders a retired bucket only while it still holds work, so the
 * fixture has to file something on it — the idiom the `draftAt` blocks above use
 * three times for the same node.
 */
function putAwayPath(): MindNode[] {
  return orgPath('org-old', {
    entries: [entry({ id: 'a', track_id: 't-1', node_id: 'org-old', created_by: 'me-1' })],
  })
}

/** The context with the grant that makes the two verbs exist at all. */
function admin(over: Partial<MindActionCtx> = {}): MindActionCtx {
  return ctx({ canEditStructure: true, ...over })
}

describe('branchRefAt — the place a structural verb writes', () => {
  it('reads the track off a track node, with no parent and level 0', () => {
    const path = findPath(orgTree(), (n) => n.kind === 'track')
    // A child added here is a level-1 node with `parent_id: null` — a real
    // place, not a missing one.
    expect(branchRefAt(path)).toEqual({
      trackId: 't-1',
      nodeId: null,
      level: 0,
      retired: false,
    })
  })

  it('counts one level per entity step, deepest last', () => {
    // root ▸ UHR ▸ OB ▸ Org1. `level` is the trigger's numbering, so OB is 1.
    expect(branchRefAt(orgPath('ob'))).toEqual({
      trackId: 't-1',
      nodeId: 'ob',
      level: 1,
      retired: false,
    })
    expect(branchRefAt(orgPath('org-1'))).toEqual({
      trackId: 't-1',
      nodeId: 'org-1',
      level: 2,
      retired: false,
    })
  })

  it('reports a branch that is already put away, and one whose ANCESTOR is', () => {
    // Archived and still drawn, because it holds work — model.ts's rule that
    // hiding an option must never hide data.
    expect(branchRefAt(putAwayPath())?.retired).toBe(true)

    const throughArchived = orgPath('org-1', {
      entities: [
        ent({ id: 'ob', label: 'OB', typeKey: 'Phase', archived: true }),
        ent({ id: 'org-1', parentId: 'ob' }),
      ],
    })
    // The Org itself is live; the phase above it is not, and adding under it is
    // how the archived phase quietly comes back to life.
    expect(throughArchived[throughArchived.length - 1].retired).toBe(false)
    expect(branchRefAt(throughArchived)?.retired).toBe(true)
  })

  it('names no place on a node that is not part of the hierarchy', () => {
    const tree = orgTree()
    // The root, a status bucket, a leaf and a fold are all drawn; none of them
    // is a row in `map_nodes`.
    expect(branchRefAt(pathTo(tree, tree.id))).toBeNull()
    expect(branchRefAt(findPath(tree, (n) => n.kind === 'group'))).toBeNull()
    expect(branchRefAt(findPath(tree, (n) => n.kind === 'entry'))).toBeNull()
    expect(branchRefAt([])).toBeNull()
  })

  it('refuses the untracked pile, which has no track_id to hang a node from', () => {
    // An entry with no track still gets a branch, keyed NO_VALUE. There is no
    // row in `tracks` behind it, so there is nothing for `map_nodes.track_id`.
    const root = build({ entries: [entry({ id: 'a' })], vocab: statusVocab() })
    const path = findPath(root, (n) => n.kind === 'track')
    expect(path[path.length - 1].bucketKey).toBe('')
    expect(branchRefAt(path)).toBeNull()
  })
})

describe('branchAddRefusal — one rule, read by the menu and by the composer', () => {
  it('permits a healthy branch and a track', () => {
    expect(branchAddRefusal(orgPath('org-1'), 'me-1')).toBeNull()
    expect(branchAddRefusal(findPath(orgTree(), (n) => n.kind === 'track'), 'me-1')).toBeNull()
  })

  it('tests the session first, as every other verdict in this file does', () => {
    expect(branchAddRefusal(orgPath('org-1'), null)).toBe(WHY_SIGNED_OUT)
  })

  it('refuses a branch that is put away', () => {
    expect(branchAddRefusal(putAwayPath(), 'me-1')).toBe(WHY_RETIRED)
  })

  it('refuses the SEVENTH level with a sentence, which is what 22023 is not', () => {
    // 0023's deferred trigger raises `map_node_depth` at level 7, after a name
    // has been typed and a button pressed. This is the same refusal, before.
    expect(branchRefAt(deepPath('l6'))?.level).toBe(MAX_BRANCH_LEVEL)
    expect(branchAddRefusal(deepPath('l6'), 'me-1')).toBe(WHY_TOO_DEEP)
    // And the level that still fits is not refused.
    expect(branchAddRefusal(deepPath('l5'), 'me-1')).toBeNull()
  })
})

describe('the structural verbs on a node', () => {
  it('offers NOTHING without structure.edit — absent, not greyed', () => {
    // "You are not an admin" is not a rule a reader can act on, and two greyed
    // rows on every branch of the map is a permanent reminder of it.
    const offered = kinds(mindActionsFor(orgPath('org-1'), ctx()))
    expect(offered).not.toContain('addBranch')
    expect(offered).not.toContain('archiveBranch')
  })

  it('offers both on an Organization, and only "add" on a track', () => {
    expect(kinds(mindActionsFor(orgPath('org-1'), admin()))).toEqual(
      expect.arrayContaining(['addBranch', 'archiveBranch']),
    )
    // A track is a row in `tracks`; archiving one is the track editor's job and
    // takes every item ever filed on it. Absent is a category error, not a
    // refusal, so there is no greyed row and no sentence.
    const track = kinds(mindActionsFor(findPath(orgTree(), (n) => n.kind === 'track'), admin()))
    expect(track).toContain('addBranch')
    expect(track).not.toContain('archiveBranch')
  })

  it('offers neither on a status bucket, which is not part of the hierarchy', () => {
    const group = kinds(mindActionsFor(findPath(orgTree(), (n) => n.kind === 'group'), admin()))
    expect(group).not.toContain('archiveBranch')
    // Nor "add a branch": a status bucket is drawn INSIDE its Org, it stands for
    // a value rather than a place, and hanging a `map_nodes` row off it is a
    // category error rather than something to grey out with a sentence. "Add an
    // ITEM here" is still offered, and that is the difference.
    expect(group).not.toContain('addBranch')
    expect(group).toContain('addHere')
  })

  it('offers neither on a leaf', () => {
    const rows = [entry({ id: 'a', track_id: 't-1', node_id: 'org-1', created_by: 'me-1' })]
    const leaf = findPath(orgTree(), (n) => n.kind === 'entry')
    const offered = kinds(
      mindActionsFor(leaf, admin({ entryById: new Map(rows.map((r) => [r.id, r])) })),
    )
    expect(offered).not.toContain('addBranch')
    expect(offered).not.toContain('archiveBranch')
  })

  it('sits between the work verbs and the two view verbs', () => {
    // Everything above changes WORK, everything below changes only what is on
    // screen. These two change the MAP, and they are the only rows in the panel
    // whose effect outlives the session — so they may not sit under the two most
    // reversible verbs in the list.
    const list = kinds(mindActionsFor(orgPath('org-1'), admin()))
    expect(list.indexOf('addBranch')).toBeGreaterThan(list.indexOf('applySelection'))
    expect(list.indexOf('archiveBranch')).toBeLessThan(list.indexOf('focus'))
    expect(list.indexOf('addBranch')).toBeLessThan(list.indexOf('archiveBranch'))
  })

  it('marks archive as a write that ASKS FIRST and closes nothing', () => {
    const archive = byKind(mindActionsFor(orgPath('org-1'), admin()), 'archiveBranch')
    expect(archive.mutates).toBe(true)
    // The cascade is invisible from a canvas, so the dialog is not optional.
    expect(archive.confirm).toBe(true)
    // Archiving writes no status on anything. The items filed on it stay exactly
    // as open as they were and stop being drawn; `closes: true` would word the
    // question as though the work had been finished.
    expect(archive.closes).toBe(false)
    // It writes `map_nodes`, never `entries` — so there is no patch and no row
    // for a surface to run `patchEntry` over.
    expect(archive.targetIds).toEqual([])
    expect(archive.patch).toBeNull()
  })

  it('carries the depth refusal onto the row rather than into a Postgres code', () => {
    const deep = byKind(mindActionsFor(deepPath('l6'), admin()), 'addBranch')
    expect(deep.enabled).toBe(false)
    expect(deep.reasonKey).toBe(WHY_TOO_DEEP)
    // Archiving the deepest branch is still perfectly legal — the cap is about
    // what goes BELOW it.
    expect(byKind(mindActionsFor(deepPath('l6'), admin()), 'archiveBranch').enabled).toBe(true)
  })

  it('refuses both on a branch that is already put away, each with its sentence', () => {
    const put = mindActionsFor(putAwayPath(), admin())
    expect(byKind(put, 'addBranch').reasonKey).toBe(WHY_RETIRED)
    // Archiving an archived node would write the value already in the column.
    const archive = byKind(put, 'archiveBranch')
    expect(archive.enabled).toBe(false)
    expect(archive.reasonKey).toBe(WHY_RETIRED)
  })

  it('refuses both when the session has gone, before anything else', () => {
    const out = mindActionsFor(orgPath('org-1'), admin({ meId: null }))
    expect(byKind(out, 'addBranch').reasonKey).toBe(WHY_SIGNED_OUT)
    expect(byKind(out, 'archiveBranch').reasonKey).toBe(WHY_SIGNED_OUT)
  })

  it('leaves every other verb on the node exactly where it was', () => {
    // The grant ADDS rows; it must not reorder or re-decide the ones that were
    // already there, or every existing assertion in this file is about a
    // different menu.
    const without = kinds(mindActionsFor(orgPath('org-1'), ctx()))
    const with_ = kinds(mindActionsFor(orgPath('org-1'), admin()))
    expect(with_.filter((k) => k !== 'addBranch' && k !== 'archiveBranch')).toEqual(without)
  })
})
