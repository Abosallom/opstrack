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

import { describe, expect, it } from 'vitest'
import { EMPTY_FILTER, type FilterContext, type FilterState } from '../entryFilter'
import {
  NAME_PREFIX,
  NO_VALUE,
  closesEntry,
  evaluateDrop,
  groupBucketKey,
  isDropZoneKind,
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
      patch: { trackId: 'trk-2' },
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
      patch: { trackId: null },
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
      patch: { trackId: 'trk-B', status: 'blocked' },
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

  it('folds an owner group under a track into three keys', () => {
    // The unassign arm's two keys plus the track — the case where re-deriving
    // the patch from `field`+`value` would silently lose two columns.
    const row = entry({ id: 'e1', track_id: 'trk-A', owner_name: 'Acme Ltd' })
    expect(dropAt([ROOT, branch('track', 'trk-B'), branch('group', NO_VALUE)], 'owner', row)).toEqual({
      kind: 'patch',
      entryId: 'e1',
      field: 'ownerId',
      value: null,
      patch: { trackId: 'trk-B', ownerId: null, ownerName: null },
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

// ── what may be dragged, and onto what ─────────────────────────────────────

describe('the source', () => {
  it.each(['root', 'track', 'group', 'more'] as const)('refuses a dragged %s', (kind) => {
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

  it('refuses a bucket-less track or group', () => {
    expect(drop(branch('track', null), 'status')).toEqual({
      kind: 'refused',
      reasonKey: 'mindtree.dropRefusedUnknown',
    })
  })

  it('arms exactly the two branch kinds as zones', () => {
    expect(
      (['root', 'track', 'group', 'entry', 'more'] as const).filter(isDropZoneKind),
    ).toEqual(['track', 'group'])
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

function buildFor(dimension: MindDimension): MindNode {
  const input: MindtreeInput = {
    entries: ROWS,
    health: new Map(),
    tracks: [track({ id: 'trk-1' }), track({ id: 'trk-2', sortOrder: 1 })],
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

/** Every leaf, with the group and track branch model.ts filed it under. */
function filings(root: MindNode): { entryId: string; group: string | null; track: string | null }[] {
  const out: { entryId: string; group: string | null; track: string | null }[] = []
  for (const trackNode of root.children) {
    for (const groupNode of trackNode.children) {
      for (const entryNode of groupNode.children) {
        if (entryNode.kind !== 'entry' || entryNode.entryId === null) continue
        out.push({
          entryId: entryNode.entryId,
          group: groupNode.bucketKey,
          track: trackNode.bucketKey,
        })
      }
    }
  }
  return out
}

const BY_ID = new Map(ROWS.map((row) => [row.id, row]))

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
