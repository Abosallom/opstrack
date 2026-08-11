// The drop policy, case by case. Three plain objects and an equality per test —
// that is the whole point of keeping the rules out of the geometry and out of
// React.
//
// WHAT THIS FILE IS DEFENDING. A drag on this screen is a write to somebody's
// workload, so every case below is a way that write could go wrong quietly:
// re-filing into a bucket that no longer exists, assigning to a person by
// writing the wrong column, "unassigning" a vendor and leaving the vendor
// attached, or a whole ring that looks droppable and simply is not. None of
// these throw, and none of them are visible in a screenshot.
//
// THE LAST BLOCK IS THE LOAD-BEARING ONE. dropRules.ts has to bucket a row
// EXACTLY as model.ts does, because that agreement is what makes "dropped onto
// its own parent" a no-op instead of a pointless write, and what makes "dropped
// onto Unassigned" resolve to the same bucket the tree drew. The two modules
// cannot share the code (model.ts's bucketing is private, and exporting it would
// invert the layering), so the agreement is PROVEN instead: build a real tree
// over rows spanning every owner shape, then assert that for every leaf, the key
// this module computes is the key of the branch model.ts actually filed it
// under. A drift in either module reds it.
//
// AND THE ENTITY RING IS THE NEW WAY TO GET THAT WRONG. `entity` nodes — the
// map_nodes hierarchy, UHR > OB > Org1 — sit BETWEEN the track and its status
// buckets, so "which bucket is this row in" now has one more answer, and the
// track ring's meaning changed underneath it: a track's own Blocked bucket now
// means "blocked, on this track, under NO organization". The block near the
// bottom is the case that would otherwise ship silently — a drop onto a track
// that leaves `node_id` pointing at Org3, which `entries_map_sync` turns back
// into the same track, so the rebuild files the row under Org3 again and the
// node springs across the screen a frame after landing.

import { describe, expect, it } from 'vitest'
import { EMPTY_FILTER, type FilterContext, type FilterState } from '../entryFilter'
import {
  NAME_PREFIX,
  NO_VALUE,
  closesEntry,
  evaluateDrop,
  groupBucketKey,
  isDropZoneKind,
  nodeBucketKey,
  ownerBucketKey,
  trackBucketKey,
  type DropEntryRow,
  type DropOutcome,
  type DropSourceNode,
  type DropTargetNode,
} from './dropRules'
import {
  buildMindtree,
  type MindDimension,
  type MindEntity,
  type MindMember,
  type MindNode,
  type MindTrack,
  type MindVocabOption,
  type MindtreeInput,
} from './model'
import type { Entry } from '../../types'

// ── fixtures ───────────────────────────────────────────────────────────────

const CTX: FilterContext = { meId: 'me-1', today: '2026-07-30' }

function at(date: string): string {
  return `${date}T12:00:00.000Z`
}

function entry(over: Partial<Entry> & Pick<Entry, 'id'>): Entry {
  return {
    track_id: null,
    // `entries.node_id` — null is "on the track, under no organization", which
    // is where every row on this map sits until Aziz's hierarchy is entered.
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

/** A dragged leaf. `MindNode` is assignable to this shape — see dropRules.ts. */
function leaf(entryId: string): DropSourceNode {
  return { kind: 'entry', entryId }
}

function branch(
  kind: DropTargetNode['kind'],
  bucketKey: string | null,
  retired = false,
): DropTargetNode {
  return { kind, bucketKey, retired }
}

/**
 * A drop on a single branch, with no ancestry — the shape most cases below
 * assert, because a rule about one bucket should not have to name three.
 */
function drop(
  target: DropTargetNode,
  dimension: MindDimension,
  row: DropEntryRow | undefined = entry({ id: 'e1' }),
  source: DropSourceNode = leaf('e1'),
): DropOutcome {
  return evaluateDrop({ source, entry: row, path: [target], dimension })
}

/** A drop at the end of a real root-to-target path. */
function dropAt(
  path: readonly DropTargetNode[],
  dimension: MindDimension,
  row: DropEntryRow | undefined = entry({ id: 'e1' }),
): DropOutcome {
  return evaluateDrop({ source: leaf('e1'), entry: row, path, dimension })
}

/** The root node — contributes nothing, and callers may leave it on the path. */
const ROOT: DropTargetNode = { kind: 'root', bucketKey: null, retired: false }

// ── ring 1: the track, under every dimension ───────────────────────────────
//
// `MindDimension` has no `track` member on purpose (model.ts: it is already ring
// 1, "an axis that repeated it would produce a tree one node wide"), so the
// track ring is droppable under ALL FOUR dimensions — including `health`, where
// ring 2 is refused outright. Reading the axis as "there is a track dimension"
// would produce a rule that fires in one case out of four.

const ALL_DIMENSIONS: readonly MindDimension[] = ['status', 'owner', 'priority', 'health']

describe('ring 1 — dropping on a track re-files the entry', () => {
  it.each(ALL_DIMENSIONS)('patches track_id under the %s dimension', (dimension) => {
    expect(drop(branch('track', 'trk-2'), dimension)).toEqual({
      kind: 'patch',
      entryId: 'e1',
      field: 'trackId',
      value: 'trk-2',
      // `mapNodeId: null` rides along on EVERY track drop — see the entity-ring
      // block below. The track ring is above the organizations, so landing on it
      // means "under none of them", and saying nothing would leave the row filed
      // under whichever Org it came from.
      patch: { trackId: 'trk-2', mapNodeId: null },
    })
  })

  it('drops onto the untracked pile as an explicit null, not an empty string', () => {
    // NO_VALUE is a bucket KEY, never a column value: `track_id = ''` violates
    // the uuid type and would 22P02 at the server after the optimistic row had
    // already moved on screen.
    const row = entry({ id: 'e1', track_id: 'trk-1' })
    expect(drop(branch('track', NO_VALUE), 'status', row)).toEqual({
      kind: 'patch',
      entryId: 'e1',
      field: 'trackId',
      value: null,
      patch: { trackId: null, mapNodeId: null },
    })
  })

  it('is a no-op back onto the track the entry is already in', () => {
    const row = entry({ id: 'e1', track_id: 'trk-1' })
    expect(drop(branch('track', 'trk-1'), 'status', row)).toEqual({ kind: 'noop' })
  })

  it('is a no-op for an untracked entry dropped on the untracked pile', () => {
    expect(drop(branch('track', NO_VALUE), 'status')).toEqual({ kind: 'noop' })
  })

  it('refuses an archived track', () => {
    expect(drop(branch('track', 'trk-old', true), 'status')).toEqual({
      kind: 'refused',
      reasonKey: 'mindtree.whyRetired',
    })
  })
})

// ── the path fold ──────────────────────────────────────────────────────────
//
// THE BUG THIS BLOCK EXISTS FOR. Ring 2 is drawn INSIDE ring 1, so the branch
// labelled "Blocked" under Track B does not mean "blocked" — it means "blocked
// AND Track B". A rule that patched only the deepest node would take an entry
// out of Track A, drop it visibly onto Track B's Blocked, write `status` alone,
// and let the next rebuild file it back under TRACK A's Blocked. The node
// springs across the screen a frame after landing, and nothing about that reads
// as either success or failure.

describe('a drop is the whole path, not the node under the pointer', () => {
  it('writes BOTH columns when a group sits under a different track', () => {
    const row = entry({ id: 'e1', track_id: 'trk-A', status: 'new' })
    expect(dropAt([ROOT, branch('track', 'trk-B'), branch('group', 'blocked')], 'status', row)).toEqual({
      kind: 'patch',
      entryId: 'e1',
      // The DEEPEST step names the move — it is what the reader aimed at and
      // what an announcement should say out loud.
      field: 'status',
      value: 'blocked',
      patch: { trackId: 'trk-B', mapNodeId: null, status: 'blocked' },
    })
  })

  it('still writes the track when only the group changes', () => {
    // Same track, new status: the track column is written with the value it
    // already holds, which `changesRow` sees through — the drop is real because
    // the STATUS moved.
    const row = entry({ id: 'e1', track_id: 'trk-A', status: 'new' })
    expect(dropAt([ROOT, branch('track', 'trk-A'), branch('group', 'blocked')], 'status', row)).toMatchObject({
      kind: 'patch',
      patch: { trackId: 'trk-A', status: 'blocked' },
    })
  })

  it('is a no-op when the whole path already describes the row', () => {
    const row = entry({ id: 'e1', track_id: 'trk-A', status: 'blocked' })
    expect(dropAt([ROOT, branch('track', 'trk-A'), branch('group', 'blocked')], 'status', row)).toEqual({
      kind: 'noop',
    })
  })

  it('folds an owner group under a track into four keys', () => {
    // The unassign arm's two keys, the track, and the node the track ring
    // clears — the case where re-deriving the patch from `field`+`value` would
    // silently lose THREE columns.
    const row = entry({ id: 'e1', track_id: 'trk-A', owner_name: 'Acme Ltd' })
    expect(dropAt([ROOT, branch('track', 'trk-B'), branch('group', NO_VALUE)], 'owner', row)).toEqual({
      kind: 'patch',
      entryId: 'e1',
      field: 'ownerId',
      value: null,
      patch: { trackId: 'trk-B', mapNodeId: null, ownerId: null, ownerName: null },
    })
  })

  it('refuses when an ANCESTOR is retired, not just the target', () => {
    // Filing into a live status under an archived track would quietly bring the
    // archived track back to life.
    expect(
      dropAt([ROOT, branch('track', 'trk-old', true), branch('group', 'blocked')], 'status'),
    ).toEqual({ kind: 'refused', reasonKey: 'mindtree.whyRetired' })
  })

  it('ignores the root, so a caller may pass the path exactly as the tree gives it', () => {
    const row = entry({ id: 'e1', track_id: 'trk-A' })
    expect(dropAt([ROOT, branch('track', 'trk-B')], 'status', row)).toEqual(
      dropAt([branch('track', 'trk-B')], 'status', row),
    )
  })

  it('refuses a path that ends on the root, an entry or a fold', () => {
    for (const tail of [ROOT, branch('entry', null), branch('more', null)]) {
      expect(dropAt([ROOT, branch('track', 'trk-B'), tail], 'status')).toEqual({
        kind: 'refused',
        reasonKey: 'mindtree.dropRefusedTarget',
      })
    }
  })

  it('refuses an empty path rather than reading past the end of it', () => {
    expect(dropAt([], 'status')).toEqual({ kind: 'refused', reasonKey: 'mindtree.dropRefusedTarget' })
  })
})

// ── ring 2: status ─────────────────────────────────────────────────────────

describe('ring 2 — status', () => {
  it('patches status', () => {
    expect(drop(branch('group', 'blocked'), 'status')).toEqual({
      kind: 'patch',
      entryId: 'e1',
      field: 'status',
      value: 'blocked',
      patch: { status: 'blocked' },
    })
  })

  it('is a no-op onto the status the entry already holds', () => {
    expect(drop(branch('group', 'new'), 'status')).toEqual({ kind: 'noop' })
  })

  it('refuses a hidden status option that still holds work', () => {
    expect(drop(branch('group', 'waiting_on', true), 'status')).toEqual({
      kind: 'refused',
      reasonKey: 'mindtree.whyRetired',
    })
  })

  it('refuses a status key outside the frozen union', () => {
    // The union is frozen (types.ts) and `useVocabAll` walks the same list, so
    // this is only reachable from a first-paint cache one deploy old — which is
    // exactly when writing an unchecked string into a CHECK-constrained column
    // would be least recoverable.
    expect(drop(branch('group', 'triaged'), 'status')).toEqual({
      kind: 'refused',
      reasonKey: 'mindtree.dropRefusedUnknown',
    })
  })

  it('never lets a prototype key masquerade as a status', () => {
    // `'constructor' in STATUS_KEYS` is true; hasOwnProperty is why it is not
    // used. A forged bucket key is not hypothetical — node ids are built from
    // user-writable values and round-trip through localStorage.
    for (const forged of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(drop(branch('group', forged), 'status'), forged).toEqual({
        kind: 'refused',
        reasonKey: 'mindtree.dropRefusedUnknown',
      })
    }
  })
})

// ── ring 2: priority ───────────────────────────────────────────────────────

describe('ring 2 — priority', () => {
  it('patches priority', () => {
    expect(drop(branch('group', 'critical'), 'priority')).toEqual({
      kind: 'patch',
      entryId: 'e1',
      field: 'priority',
      value: 'critical',
      patch: { priority: 'critical' },
    })
  })

  it('is a no-op onto the priority the entry already holds', () => {
    expect(drop(branch('group', 'medium'), 'priority')).toEqual({ kind: 'noop' })
  })

  it('refuses a priority key outside the frozen union', () => {
    expect(drop(branch('group', 'urgent'), 'priority')).toEqual({
      kind: 'refused',
      reasonKey: 'mindtree.dropRefusedUnknown',
    })
  })
})

// ── ring 2: owner ──────────────────────────────────────────────────────────
//
// The one ring where field and value are not interchangeable: `entries_single_owner`
// makes owner_id and owner_name mutually exclusive, and the patch has to resolve
// that XOR the way toEntryPatchRow() and applyPatchLocal() both do.

describe('ring 2 — owner', () => {
  it('assigns a member by id, which fires the notification trigger server-side', () => {
    expect(drop(branch('group', 'user-7'), 'owner')).toEqual({
      kind: 'patch',
      entryId: 'e1',
      field: 'ownerId',
      value: 'user-7',
      patch: { ownerId: 'user-7' },
    })
  })

  it('assigns a free-text owner by NAME, never by id', () => {
    expect(drop(branch('group', `${NAME_PREFIX}Acme Ltd`), 'owner')).toEqual({
      kind: 'patch',
      entryId: 'e1',
      field: 'ownerName',
      value: 'Acme Ltd',
      patch: { ownerName: 'Acme Ltd' },
    })
  })

  it('UNASSIGNS BY CLEARING BOTH COLUMNS', () => {
    // THE bug this file exists to prevent. toEntryPatchRow() clears the opposite
    // column only when the value it was given is TRUTHY, so a patch of
    // `{ ownerId: null }` alone leaves owner_name standing: an entry owned by
    // the vendor "Acme Ltd", dropped onto Unassigned, would blank an owner_id it
    // never had, keep the vendor, and snap straight back into the Acme bucket on
    // the next server row — a drag that visibly does nothing, twice.
    const row = entry({ id: 'e1', owner_name: 'Acme Ltd' })
    expect(drop(branch('group', NO_VALUE), 'owner', row)).toEqual({
      kind: 'patch',
      entryId: 'e1',
      field: 'ownerId',
      value: null,
      patch: { ownerId: null, ownerName: null },
    })
  })

  it('is a no-op onto the member who already owns it', () => {
    const row = entry({ id: 'e1', owner_id: 'user-7' })
    expect(drop(branch('group', 'user-7'), 'owner', row)).toEqual({ kind: 'noop' })
  })

  it('is a no-op onto the free-text owner it already carries', () => {
    const row = entry({ id: 'e1', owner_name: 'Acme Ltd' })
    expect(drop(branch('group', `${NAME_PREFIX}Acme Ltd`), 'owner', row)).toEqual({ kind: 'noop' })
  })

  it('is a no-op for an unassigned entry dropped on Unassigned', () => {
    expect(drop(branch('group', NO_VALUE), 'owner')).toEqual({ kind: 'noop' })
  })

  it('treats two spellings of one vendor as two different owners', () => {
    // Deliberate, and it mirrors model.ts and lib/entryFilter: guessing that
    // "Acme" and "ACME Ltd" are one company is a guess no module here may make.
    const row = entry({ id: 'e1', owner_name: 'Acme' })
    expect(drop(branch('group', `${NAME_PREFIX}ACME Ltd`), 'owner', row)).toMatchObject({
      kind: 'patch',
      field: 'ownerName',
      value: 'ACME Ltd',
    })
  })

  it('refuses an owner id the roster has forgotten', () => {
    expect(drop(branch('group', 'user-gone', true), 'owner')).toEqual({
      kind: 'refused',
      reasonKey: 'mindtree.whyRetired',
    })
  })

  it('assigns to a member even when the row carried a vendor name', () => {
    // The XOR clears owner_name server-side and in applyPatchLocal, so the
    // patch carries only the id — sending both would be two sources of truth.
    const row = entry({ id: 'e1', owner_name: 'Acme Ltd' })
    expect(drop(branch('group', 'user-7'), 'owner', row)).toEqual({
      kind: 'patch',
      entryId: 'e1',
      field: 'ownerId',
      value: 'user-7',
      patch: { ownerId: 'user-7' },
    })
  })
})

// ── ring 2: health is derived, and therefore read-only ─────────────────────

describe('ring 2 — health', () => {
  it('REFUSES every group drop, with a reason', () => {
    for (const level of ['ok', 'stale', 'overdue', 'critical']) {
      expect(drop(branch('group', level), 'health'), level).toEqual({
        kind: 'refused',
        reasonKey: 'mindtree.whyDerived',
      })
    }
  })

  it('refuses rather than silently no-ops onto the level the entry is already at', () => {
    // The distinction the assignment names. A no-op here would be indisputably
    // "correct" — nothing should be written — and would teach the reader that
    // the health ring works and they simply keep dropping in the wrong place.
    expect(drop(branch('group', 'ok'), 'health')).toEqual({
      kind: 'refused',
      reasonKey: 'mindtree.whyDerived',
    })
  })

  it('still allows the track ring while the health dimension is showing', () => {
    expect(drop(branch('track', 'trk-2'), 'health')).toMatchObject({
      kind: 'patch',
      field: 'trackId',
    })
  })

  it('has no writable ring-2 bucket at all', () => {
    expect(groupBucketKey(entry({ id: 'e1' }), 'health')).toBeNull()
  })
})

// ── the entity ring: an item belongs to an organization ───────────────────
//
// UHR > OB > Org1. An `entity` node is a row in `map_nodes`, and dropping an
// item on one means "this issue belongs to this organization" — the gesture the
// whole hierarchy exists for. It is a real drop zone, unlike the health ring:
// the entity ring would otherwise be the only ring on this map you cannot drop
// on, which reads as a broken drag rather than as a rule.

const UHR: DropTargetNode = { kind: 'track', bucketKey: 'trk-uhr', retired: false }

function org(id: string, retired = false): DropTargetNode {
  return { kind: 'entity', bucketKey: id, retired }
}

describe('ring 1.5 — the entity ring', () => {
  it('files an item under an organization, writing the node and the track', () => {
    const row = entry({ id: 'e1', track_id: 'trk-uhr' })
    expect(dropAt([ROOT, UHR, org('ob'), org('org-1')], 'status', row)).toEqual({
      kind: 'patch',
      entryId: 'e1',
      // The DEEPEST step names the move, exactly as it does on the group ring.
      field: 'mapNodeId',
      value: 'org-1',
      // `trackId` comes from the track step and `mapNodeId` from the deepest
      // entity — the intermediate OB is overwritten by Org1, which is what makes
      // an arbitrarily deep path fold to one node rather than to a list.
      patch: { trackId: 'trk-uhr', mapNodeId: 'org-1' },
    })
  })

  it('writes ONLY the node when the path is the Org alone', () => {
    // No track step, so no `trackId` — and that is correct rather than
    // incomplete: `entries_map_sync` DERIVES `track_id` from the node on every
    // write, so the node is the whole answer. Asserting a track the client
    // guessed would be the second filing axis the schema exists to prevent.
    const row = entry({ id: 'e1', track_id: 'trk-uhr' })
    expect(drop(org('org-1'), 'status', row)).toEqual({
      kind: 'patch',
      entryId: 'e1',
      field: 'mapNodeId',
      value: 'org-1',
      patch: { mapNodeId: 'org-1' },
    })
  })

  it('moves an item between two Orgs on the SAME track, which is not a no-op', () => {
    // THE CASE `changesRow` HAD TO LEARN. Both patches write `trackId` with the
    // value the row already holds; comparing only the track would call this
    // "already there", write nothing, and let the next rebuild put the node back
    // on Org1 — a drag that visibly moved something and changed nothing.
    const row = entry({ id: 'e1', track_id: 'trk-uhr', node_id: 'org-1' })
    expect(dropAt([ROOT, UHR, org('org-2')], 'status', row)).toEqual({
      kind: 'patch',
      entryId: 'e1',
      field: 'mapNodeId',
      value: 'org-2',
      patch: { trackId: 'trk-uhr', mapNodeId: 'org-2' },
    })
  })

  it('is a no-op back onto the organization the item is already under', () => {
    const row = entry({ id: 'e1', track_id: 'trk-uhr', node_id: 'org-1' })
    expect(dropAt([ROOT, UHR, org('org-1')], 'status', row)).toEqual({ kind: 'noop' })
  })

  it('still writes the status when a bucket hangs under an Org', () => {
    const row = entry({ id: 'e1', track_id: 'trk-uhr', node_id: 'org-1', status: 'new' })
    expect(
      dropAt([ROOT, UHR, org('org-1'), branch('group', 'blocked')], 'status', row),
    ).toEqual({
      kind: 'patch',
      entryId: 'e1',
      field: 'status',
      value: 'blocked',
      patch: { trackId: 'trk-uhr', mapNodeId: 'org-1', status: 'blocked' },
    })
  })

  it('refuses an archived Org, and an archived Org ANYWHERE on the path', () => {
    const row = entry({ id: 'e1', track_id: 'trk-uhr' })
    expect(dropAt([ROOT, UHR, org('org-old', true)], 'status', row)).toEqual({
      kind: 'refused',
      reasonKey: 'mindtree.whyRetired',
    })
    // A live Org under an archived phase. Filing new work through an archived
    // ancestor is how the archived branch quietly comes back to life — the same
    // rule the track ring has had since the beginning.
    expect(dropAt([ROOT, UHR, org('ob', true), org('org-1')], 'status', row)).toEqual({
      kind: 'refused',
      reasonKey: 'mindtree.whyRetired',
    })
  })

  it('refuses an entity whose key is empty, rather than writing a uuid column blank', () => {
    // NO_VALUE is a real bucket on the TRACK ring — the untracked pile — and no
    // bucket at all here: a row under no Org is drawn one ring shallower, so an
    // empty key is a malformed node. Writing it would send `node_id = ''` and
    // 22P02 after the optimistic row had already moved.
    expect(dropAt([ROOT, UHR, org(NO_VALUE)], 'status')).toEqual({
      kind: 'refused',
      reasonKey: 'mindtree.dropRefusedUnknown',
    })
  })

  it('accepts an Org while the health dimension is showing', () => {
    // Like the track ring and unlike ring 2: the entity ring is a place, not an
    // axis, so the dimension switcher has no opinion about it.
    const row = entry({ id: 'e1', track_id: 'trk-uhr' })
    expect(dropAt([ROOT, UHR, org('org-1')], 'health', row)).toMatchObject({
      kind: 'patch',
      field: 'mapNodeId',
      value: 'org-1',
    })
  })

  it('does not think filing into an Org closes anything', () => {
    const row = entry({ id: 'e1', track_id: 'trk-uhr' })
    expect(closesEntry(dropAt([ROOT, UHR, org('org-1')], 'status', row))).toBe(false)
  })
})

// ── THE LINE THE WHOLE HIERARCHY RESTS ON ──────────────────────────────────
//
// A `track` step writes BOTH `trackId` AND `mapNodeId: null`.

describe('a drop on a TRACK takes the item out of its organization', () => {
  it('clears node_id when an item is dropped on its own track from inside an Org', () => {
    // Same track, so `trackId` changes nothing; the drop is real because the
    // item left Org3. Without the null this resolves to a no-op, nothing is
    // written, and the node sits on the track ring for one frame before the
    // rebuild files it straight back under Org3.
    const row = entry({ id: 'e1', track_id: 'trk-uhr', node_id: 'org-3' })
    expect(dropAt([ROOT, UHR], 'status', row)).toEqual({
      kind: 'patch',
      entryId: 'e1',
      field: 'trackId',
      value: 'trk-uhr',
      patch: { trackId: 'trk-uhr', mapNodeId: null },
    })
  })

  it("clears node_id on a track's own status bucket — 'blocked, under no Org'", () => {
    // The sentence in the plan, asserted. The bucket hanging off a TRACK is not
    // the same bucket as the one hanging off Org3, and a drop that honoured only
    // the status would leave the row filed under Org3 and drawn there.
    const row = entry({ id: 'e1', track_id: 'trk-uhr', node_id: 'org-3', status: 'new' })
    expect(dropAt([ROOT, UHR, branch('group', 'blocked')], 'status', row)).toEqual({
      kind: 'patch',
      entryId: 'e1',
      field: 'status',
      value: 'blocked',
      patch: { trackId: 'trk-uhr', mapNodeId: null, status: 'blocked' },
    })
  })

  it('is STILL a no-op on a row that was never in an Org — the null costs nothing', () => {
    // The other half of the rule, and the reason it is safe to send
    // unconditionally: `changesRow` compares against the ROW, so a spurious
    // `mapNodeId: null` on a row that already has none writes nothing, fires no
    // `entries_touch()`, and does not reset the staleness clock (R3-LEAD-1).
    const row = entry({ id: 'e1', track_id: 'trk-uhr', node_id: null })
    expect(dropAt([ROOT, UHR], 'status', row)).toEqual({ kind: 'noop' })
  })

  it('lets a deeper entity step overwrite the null, because the fold walks root-first', () => {
    // The null is not "clear the Org", it is "the Org is whatever the rest of
    // this path says". A path that keeps going never sees it.
    const row = entry({ id: 'e1', track_id: 'trk-uhr', node_id: 'org-3' })
    expect(dropAt([ROOT, UHR, org('org-1')], 'status', row)).toMatchObject({
      patch: { mapNodeId: 'org-1' },
    })
  })

  it('moves an item from one track to another and out of its Org in one write', () => {
    const row = entry({ id: 'e1', track_id: 'trk-uhr', node_id: 'org-3' })
    expect(dropAt([ROOT, branch('track', 'trk-other')], 'status', row)).toEqual({
      kind: 'patch',
      entryId: 'e1',
      field: 'trackId',
      value: 'trk-other',
      // Not `mapNodeId: 'org-3'` and not silence: Org3 belongs to the OLD track,
      // and `map_node_track_mismatch` is exactly the state 0023's trigger
      // refuses. The client must not send a pair the server has to reject.
      patch: { trackId: 'trk-other', mapNodeId: null },
    })
  })
})

// ── what may be dragged, and onto what ─────────────────────────────────────

describe('the source', () => {
  it.each(['root', 'track', 'entity', 'group', 'more'] as const)('refuses a dragged %s', (kind) => {
    expect(drop(branch('track', 'trk-2'), 'status', entry({ id: 'e1' }), { kind, entryId: null })).toEqual({
      kind: 'refused',
      reasonKey: 'mindtree.dropRefusedBranch',
    })
  })

  it('refuses an entry node with no entry id', () => {
    expect(
      drop(branch('track', 'trk-2'), 'status', entry({ id: 'e1' }), { kind: 'entry', entryId: null }),
    ).toEqual({ kind: 'refused', reasonKey: 'mindtree.dropRefusedBranch' })
  })

  it('refuses when the row has gone — a realtime delete mid-drag', () => {
    // Not a patch against a remembered snapshot: resurrecting a row somebody
    // deleted while a finger was down is the one failure worse than losing the
    // drag.
    //
    // `evaluateDrop` directly rather than through `drop()`: a default parameter
    // fires on an explicitly-passed `undefined`, so the helper would have handed
    // the rules a live row and asserted nothing.
    expect(
      evaluateDrop({ source: leaf('e1'), entry: undefined, path: [branch('track', 'trk-2')], dimension: 'status' }),
    ).toEqual({ kind: 'refused', reasonKey: 'entry.errNotFound' })
  })
})

describe('the target', () => {
  it.each(['root', 'entry', 'more'] as const)('refuses a drop on a %s node', (kind) => {
    expect(drop(branch(kind, kind === 'root' ? null : 'x'), 'status')).toEqual({
      kind: 'refused',
      reasonKey: 'mindtree.dropRefusedTarget',
    })
  })

  it('refuses a bucket-less track, entity or group', () => {
    for (const kind of ['track', 'entity', 'group'] as const) {
      expect(drop(branch(kind, null), 'status'), kind).toEqual({
        kind: 'refused',
        reasonKey: 'mindtree.dropRefusedUnknown',
      })
    }
  })

  it('arms exactly the three branch kinds as zones', () => {
    expect(
      (['root', 'track', 'entity', 'group', 'entry', 'more'] as const).filter(isDropZoneKind),
    ).toEqual(['track', 'entity', 'group'])
  })

  it('arms the health ring even though every drop on it is refused', () => {
    // The refusal has to be reachable to be read. A ring excluded from the hit
    // test is a ring that explains nothing.
    expect(isDropZoneKind('group')).toBe(true)
  })
})

// ── ordering: a no-op beats a refusal ──────────────────────────────────────

describe('rule order', () => {
  it('lets an entry sit still on the retired bucket it is already in', () => {
    // The reader dropped it back where it started. Refusing that would be a
    // telling-off for an action they cannot avoid and did not intend.
    const row = entry({ id: 'e1', status: 'waiting_on' })
    expect(drop(branch('group', 'waiting_on', true), 'status', row)).toEqual({ kind: 'noop' })
  })

  it('lets an entry sit still on the archived track it is already in', () => {
    const row = entry({ id: 'e1', track_id: 'trk-old' })
    expect(drop(branch('track', 'trk-old', true), 'status', row)).toEqual({ kind: 'noop' })
  })

  it('refuses a dragged branch before it ever looks at the target or the row', () => {
    // Both of the later arms would also refuse this — health is derived, and the
    // row is missing — so the assertion is that the FIRST reason is the one
    // returned. A reader dragging a group needs to hear "drag a single item",
    // not "this ring is read-only".
    expect(
      evaluateDrop({
        source: { kind: 'group', entryId: null },
        entry: undefined,
        path: [branch('group', 'ok')],
        dimension: 'health',
      }),
    ).toEqual({ kind: 'refused', reasonKey: 'mindtree.dropRefusedBranch' })
  })
})

// ── the confirm gate ───────────────────────────────────────────────────────

describe('closesEntry', () => {
  it('is true for done and cancelled', () => {
    for (const status of ['done', 'cancelled']) {
      expect(closesEntry(drop(branch('group', status), 'status')), status).toBe(true)
    }
  })

  it('is false for every open status', () => {
    for (const status of ['new', 'in_progress', 'blocked', 'waiting_on']) {
      // 'new' is the fixture's own status and would be a no-op; start elsewhere.
      const row = entry({ id: 'e1', status: 'done' })
      expect(closesEntry(drop(branch('group', status), 'status', row)), status).toBe(false)
    }
  })

  it('is false for a no-op, a refusal, and every non-status patch', () => {
    expect(closesEntry({ kind: 'noop' })).toBe(false)
    expect(closesEntry({ kind: 'refused', reasonKey: 'mindtree.whyDerived' })).toBe(false)
    expect(closesEntry(drop(branch('track', 'trk-2'), 'status'))).toBe(false)
    expect(closesEntry(drop(branch('group', 'user-7'), 'owner'))).toBe(false)
  })
})

// ── THE AGREEMENT WITH model.ts ────────────────────────────────────────────
//
// See the file header. Everything above is only correct if this holds.

function track(over: Partial<MindTrack> & Pick<MindTrack, 'id'>): MindTrack {
  return { label: over.id, color: '#22d3ee', colorLight: null, sortOrder: 0, archived: false, ...over }
}

function vocab(keys: readonly string[]): MindVocabOption[] {
  return keys.map((key) => ({ key, label: key.toUpperCase(), hidden: false }))
}

const MEMBERS: MindMember[] = [
  { id: 'user-7', displayName: 'Rana' },
  { id: 'user-9', displayName: 'Omar' },
]

/** Every owner shape model.ts buckets differently, plus both track shapes. */
const ROWS: Entry[] = [
  entry({ id: 'e-unassigned' }),
  entry({ id: 'e-member', owner_id: 'user-7', track_id: 'trk-1' }),
  entry({ id: 'e-member-2', owner_id: 'user-9', track_id: 'trk-2', status: 'blocked' }),
  entry({ id: 'e-vendor', owner_name: 'Acme Ltd', track_id: 'trk-1', priority: 'high' }),
  entry({ id: 'e-vendor-2', owner_name: 'Zeta', track_id: 'trk-2', priority: 'critical' }),
  // An owner_id no member row explains — a deleted profile. model.ts files it
  // under the raw id and marks the branch retired.
  entry({ id: 'e-ghost', owner_id: 'user-gone', track_id: 'trk-1', status: 'waiting_on' }),
  // owner_name that is whitespace only: model.ts trims, so this is Unassigned.
  entry({ id: 'e-blank', owner_name: '   ', status: 'in_progress' }),
]

/**
 * The hierarchy under trk-1: UHR > OB > Org1 · Org2, with an archived Org3 that
 * still holds work.
 *
 * `trk-2` is deliberately left flat, so both worlds are in the same fixture:
 * the agreement has to hold for a leaf drawn under three entity rings AND for a
 * leaf drawn on a bare track, in one tree.
 */
const ENTITIES: readonly MindEntity[] = [
  { id: 'ob', trackId: 'trk-1', parentId: null, label: 'OB', sortOrder: 0, archived: false, typeKey: 'Phase' },
  { id: 'org-1', trackId: 'trk-1', parentId: 'ob', label: 'Org1', sortOrder: 0, archived: false, typeKey: 'Organization' },
  { id: 'org-2', trackId: 'trk-1', parentId: 'ob', label: 'Org2', sortOrder: 1, archived: false, typeKey: 'Organization' },
  { id: 'org-old', trackId: 'trk-1', parentId: 'ob', label: 'Org3', sortOrder: 2, archived: true, typeKey: 'Organization' },
]

/** The same rows, re-filed under the hierarchy above. */
const ORG_ROWS: Entry[] = [
  entry({ id: 'e-flat', track_id: 'trk-2', owner_id: 'user-9', status: 'blocked' }),
  entry({ id: 'e-org1', track_id: 'trk-1', node_id: 'org-1', owner_id: 'user-7' }),
  entry({ id: 'e-org1-b', track_id: 'trk-1', node_id: 'org-1', owner_name: 'Acme Ltd', priority: 'high' }),
  entry({ id: 'e-org2', track_id: 'trk-1', node_id: 'org-2', status: 'in_progress' }),
  // Filed on the PHASE rather than on an Org — a legal place, and the case a
  // "the deepest ring is always an Organization" reading would get wrong.
  entry({ id: 'e-phase', track_id: 'trk-1', node_id: 'ob', priority: 'critical' }),
  // On the track, under no node at all: the row every entry in the workspace is
  // today, and the one the track ring's `mapNodeId: null` must leave alone.
  entry({ id: 'e-bare', track_id: 'trk-1', status: 'waiting_on' }),
  // Under an ARCHIVED Org. model.ts keeps it drawn because it still holds work.
  entry({ id: 'e-archived', track_id: 'trk-1', node_id: 'org-old' }),
]

function buildFor(
  dimension: MindDimension,
  entities: readonly MindEntity[] = [],
  rows: Entry[] = ROWS,
): MindNode {
  const input: MindtreeInput = {
    entries: rows,
    health: new Map(),
    tracks: [track({ id: 'trk-1' }), track({ id: 'trk-2', sortOrder: 1 })],
    entities,
    vocab:
      dimension === 'status'
        ? vocab(['new', 'in_progress', 'blocked', 'waiting_on', 'done', 'cancelled'])
        : dimension === 'priority'
          ? vocab(['low', 'medium', 'high', 'critical'])
          : [],
    members: MEMBERS,
    dimension,
    filter: EMPTY_FILTER as FilterState,
    ctx: CTX,
    collapsedIds: new Set(),
    leafThreshold: 100,
  }
  return buildMindtree(input)
}

interface Filing {
  entryId: string
  group: string | null
  track: string | null
  /** The DEEPEST `entity` ancestor's bucket key, or null when there is none. */
  node: string | null
}

/**
 * Every leaf, with the branches model.ts filed it under.
 *
 * RECURSIVE RATHER THAN THREE NESTED LOOPS, and that is the whole shape of Wave
 * A: the tree under a track is no longer track → group → entry but track →
 * entity* → group → entry, with arbitrarily many entity rings between. A fixed
 * walk would silently stop seeing leaves the moment an Org existed and this
 * whole block would pass by finding nothing — the exact way an agreement test
 * dies quietly.
 */
function filings(root: MindNode): Filing[] {
  const out: Filing[] = []
  const walk = (node: MindNode, at: Omit<Filing, 'entryId'>): void => {
    if (node.kind === 'entry') {
      if (node.entryId !== null) out.push({ entryId: node.entryId, ...at })
      return
    }
    const next: Omit<Filing, 'entryId'> =
      node.kind === 'track'
        ? { ...at, track: node.bucketKey }
        : node.kind === 'entity'
          ? { ...at, node: node.bucketKey }
          : node.kind === 'group'
            ? { ...at, group: node.bucketKey }
            : at
    for (const child of node.children) walk(child, next)
  }
  walk(root, { group: null, track: null, node: null })
  return out
}

const BY_ID = new Map([...ROWS, ...ORG_ROWS].map((row) => [row.id, row]))

/** Every leaf, with the REAL ancestor chain model.ts drew above it. */
function leafPaths(root: MindNode): { entryId: string; path: MindNode[] }[] {
  const out: { entryId: string; path: MindNode[] }[] = []
  const walk = (node: MindNode, trail: MindNode[]): void => {
    const here = [...trail, node]
    if (node.kind === 'entry') {
      if (node.entryId !== null) out.push({ entryId: node.entryId, path: here })
      return
    }
    for (const child of node.children) walk(child, here)
  }
  walk(root, [])
  return out
}

describe('agreement with model.ts — the no-op is only correct if this holds', () => {
  it('sees every fixture row in every dimension, so the assertions are not vacuous', () => {
    for (const dimension of ALL_DIMENSIONS) {
      expect(filings(buildFor(dimension)).length, dimension).toBe(ROWS.length)
    }
  })

  it.each(['status', 'owner', 'priority'] as const)(
    'computes the same ring-2 bucket model.ts filed under, for %s',
    (dimension) => {
      for (const filed of filings(buildFor(dimension))) {
        const row = BY_ID.get(filed.entryId)
        expect(row, filed.entryId).toBeDefined()
        if (!row) continue
        expect(groupBucketKey(row, dimension), `${filed.entryId} @ ${dimension}`).toBe(filed.group)
      }
    },
  )

  it.each(ALL_DIMENSIONS)('computes the same ring-1 bucket model.ts filed under (%s)', (dimension) => {
    for (const filed of filings(buildFor(dimension))) {
      const row = BY_ID.get(filed.entryId)
      if (!row) continue
      expect(trackBucketKey(row), filed.entryId).toBe(filed.track)
    }
  })

  it('files nothing under an entity ring when the builder is given no hierarchy', () => {
    // Wave A's own gate, stated from the drop side: with no entities the tree is
    // what it always was. It is also what makes the track ring's unconditional
    // `mapNodeId: null` a no-op rather than a write on every row in the
    // workspace today — all 27 of them have `node_id` null.
    for (const dimension of ALL_DIMENSIONS) {
      for (const filed of filings(buildFor(dimension))) {
        expect(filed.node, `${filed.entryId} @ ${dimension}`).toBeNull()
      }
    }
  })

  it('agrees with model.ts about which entity a leaf is filed under', () => {
    // THE AGREEMENT, one ring finer. `changesRow` compares `patch.mapNodeId`
    // against `row.node_id`, so if this module and model.ts disagreed about
    // which Org a row belongs to, dropping a row back onto the Org it is DRAWN
    // under would resolve to a write — bumping `last_activity_at` and resetting
    // the staleness clock on work nobody touched (R3-LEAD-1).
    for (const dimension of ALL_DIMENSIONS) {
      const filed = filings(buildFor(dimension, ENTITIES, ORG_ROWS))
      expect(filed.length, dimension).toBe(ORG_ROWS.length)
      // Not vacuous: this fixture really does draw leaves inside entity rings,
      // on the phase as well as on the Orgs, and one under an archived Org.
      expect(new Set(filed.map((f) => f.node)), dimension).toEqual(
        new Set([null, 'ob', 'org-1', 'org-2', 'org-old']),
      )
      for (const f of filed) {
        const row = BY_ID.get(f.entryId)
        if (!row) continue
        expect(nodeBucketKey(row), `${f.entryId} @ ${dimension}`).toBe(f.node)
      }
    }
  })

  it('makes every leaf a no-op against its REAL path, entity rings and all', () => {
    // The end-to-end statement, with the ancestor chain model.ts actually drew
    // rather than a one-element path: track → phase → Org → bucket, folded. Not
    // one leaf may resolve to a write against the branch it is drawn under —
    // including `e-bare`, whose path has no entity step and whose row must
    // therefore survive the track arm's `mapNodeId: null` untouched, and
    // `e-archived`, which sits in a retired Org and must reach the NO-OP arm
    // before the retired one.
    for (const dimension of ['status', 'owner', 'priority'] as const) {
      const leaves = leafPaths(buildFor(dimension, ENTITIES, ORG_ROWS))
      expect(leaves.length, dimension).toBe(ORG_ROWS.length)
      for (const { entryId, path } of leaves) {
        const row = BY_ID.get(entryId)
        if (!row) continue
        // The leaf itself is not a target; drop onto its parent branch.
        const target = path.slice(0, -1)
        expect(
          evaluateDrop({ source: leaf(entryId), entry: row, path: target, dimension }),
          `${entryId} @ ${dimension}`,
        ).toEqual({ kind: 'noop' })
      }
    }
  })

  it('agrees on all four owner shapes by name, so a regression names itself', () => {
    expect(ownerBucketKey(entry({ id: 'a' }))).toBe(NO_VALUE)
    expect(ownerBucketKey(entry({ id: 'a', owner_name: '   ' }))).toBe(NO_VALUE)
    expect(ownerBucketKey(entry({ id: 'a', owner_id: 'user-7' }))).toBe('user-7')
    expect(ownerBucketKey(entry({ id: 'a', owner_name: 'Acme Ltd' }))).toBe(`${NAME_PREFIX}Acme Ltd`)
    // Trimmed, exactly as model.ts trims — otherwise " Acme" and "Acme" would be
    // one branch on the map and two buckets here, and a drop between them would
    // read as a no-op that visibly moved a node.
    expect(ownerBucketKey(entry({ id: 'a', owner_name: '  Acme Ltd  ' }))).toBe(`${NAME_PREFIX}Acme Ltd`)
  })

  it('makes every leaf a no-op against its OWN branch, in every dimension', () => {
    // The end-to-end statement of the agreement: take the tree model.ts built,
    // and drop each leaf back onto the branch it is drawn under. Not one of them
    // may resolve to a write.
    for (const dimension of ['status', 'owner', 'priority'] as const) {
      for (const filed of filings(buildFor(dimension))) {
        const row = BY_ID.get(filed.entryId)
        if (!row) continue
        const onGroup = evaluateDrop({
          source: leaf(row.id),
          entry: row,
          path: [branch('group', filed.group)],
          dimension,
        })
        expect(onGroup, `${filed.entryId} @ group ${dimension}`).toEqual({ kind: 'noop' })

        const onTrack = evaluateDrop({
          source: leaf(row.id),
          entry: row,
          path: [branch('track', filed.track)],
          dimension,
        })
        expect(onTrack, `${filed.entryId} @ track ${dimension}`).toEqual({ kind: 'noop' })
      }
    }
  })
})
