// What a drop MEANS. No geometry, no React, no DOM, no store.
//
// drag.ts answers "what is the pointer over". This module answers the only
// question that can lose somebody's work: given the leaf being dragged and the
// branch it is over, is that drop LEGAL, and if it is, exactly which column does
// it write? Splitting the two is what lets the rules be exercised without a
// single coordinate — every case below is three plain objects and an equality.
//
// THE RULE THIS FILE EXISTS TO ENFORCE. A drag is a MUTATION of real work, so a
// drop may only ever resolve to a patch the existing optimistic-write path can
// take (`store/entries.patchEntry`) — never a bespoke write, and never a write
// this module composed by hand at a call site. `DropOutcome.patch` is therefore
// an `EntryPatch`, ready to hand over as-is, and it is built HERE precisely so
// that no surface re-derives it. The owner mapping below is why that matters.
//
// RING 1 IS ALWAYS TRACK; RING 2 IS THE DIMENSION. model.ts's `MindDimension`
// deliberately has no `track` member — the track ring is not an axis you choose,
// it is the map's spine. So "re-file into a track" is legal under EVERY
// dimension, including `health`, and only the ring-2 target changes with the
// switcher. Reading the assignment as "there is a track dimension" would have
// produced a rule that can never fire.
//
// A DROP IS THE WHOLE PATH, NOT THE NODE UNDER THE POINTER, and this is the one
// thing about the map that a kanban intuition gets wrong. Ring 2 is nested
// INSIDE ring 1, so the branch labelled "Blocked" under Track B does not mean
// "blocked" — it means "blocked AND Track B". Patching only the deepest node
// would take an entry from Track A, drop it visibly onto Track B's Blocked, write
// `status` alone, and let the next rebuild file it back under TRACK A's Blocked:
// the node springs across the screen a frame after landing, and the reader has no
// way to tell whether the move failed or the map is lying. So `evaluateDrop`
// FOLDS the root-to-target path — every track and group step contributes its
// column — and the resulting `patch` is the intersection the reader actually
// pointed at. `field`/`value` name the DEEPEST step, because that is the one they
// aimed for and the one an announcement should say out loud.
//
// HEALTH IS DERIVED AND THEREFORE READ-ONLY. `v_entry_health` computes the four
// levels from dates and activity; there is no `health` column to patch, and
// store/vocab.ts's header freezes that on purpose ("making them configurable is
// one step from configuring the algorithm"). A drop on a health branch is
// REFUSED WITH A REASON rather than silently ignored — silence on this ring
// reads as a broken drag, and the reader would try it again on every branch
// before concluding the feature does not work.
//
// WHY THE NO-OP IS AN EQUALITY ON THE ROW, NOT ON THE TREE. "Dropped onto its
// own parent" is the case the reader sees, but the case that actually has to be
// caught is "dropped onto a bucket the row is already in" — the same thing when
// the tree is fresh, and NOT the same thing when the drop lands a frame after a
// realtime patch moved the row. Comparing the row's own columns against the
// target's `bucketKey` is true in both worlds, so this module never has to be
// handed a parent id it might have gone stale on. The price is that this file
// must bucket rows EXACTLY as model.ts does; `dropRules.test.ts` pays it by
// building a real tree and asserting every leaf's computed key equals the key of
// the branch model.ts actually filed it under.
//
// THE ENTITY RING IS A DROP ZONE, AND IT HAS TO BE. An `entity` node is a
// map_node — a programme, a phase, an Organization — and dropping an item onto
// one means "this issue belongs to this organization", which is the single most
// obvious gesture on a map built to track onboarding. Refusing it would make the
// entity ring the only ring on the map you cannot drop on, which reads as a
// broken drag; that is this file's own argument for why health groups are drop
// ZONES even though every drop on one is refused.
//
// AND THE LINE THE WHOLE HIERARCHY RESTS ON IS IN `foldPath`: a `track` step
// writes BOTH `trackId` AND `mapNodeId: null`. The "Blocked" bucket hanging off
// a TRACK means "blocked, on this track, under no organization" — the entity
// rings are drawn BETWEEN the two, so a path that skips them is a path that
// deliberately went around them. Writing the track alone would leave `node_id`
// still pointing at Org3, and `entries_map_sync` would derive the track back off
// that node: the next rebuild files the row straight under Org3 again and the
// node springs across the screen a frame after landing — the exact failure this
// header opens with, one ring further in. Because the fold walks ROOT-FIRST a
// later `entity` step overwrites that null for free, and because `changesRow`
// compares against the ROW, a `mapNodeId: null` on a row that already has none
// is correctly a no-op: no write, no `entries_touch()`, no reset staleness clock
// (R3-LEAD-1).
//
// A BRANCH IS NOT DRAGGABLE IN v1, and that is a product decision rather than a
// missing feature. Dragging a group would mean "re-file twelve entries at once",
// which is a bulk write with no undo affordance on this screen; dragging a track
// would mean reordering ring 1, which is `tracks.sort_order` — an admin setting,
// not a workload move. Both are refused by name so the surface can say why.

import { CLOSED_STATUSES } from '../health'
import type { EntryPatch, EntryPriority, EntryStatus } from '../../types'
import type { MindDimension, MindNodeKind } from './model'

// ── the bucket vocabulary, restated ────────────────────────────────────────
//
// model.ts holds these two as private constants and this module must agree with
// them EXACTLY: they are what turns a branch back into a column value, so a
// disagreement writes the wrong owner rather than failing loudly. They are
// restated rather than exported-and-imported because the agreement is worth
// PROVING, not asserting — see the header, and the tree-agreement block in the
// test file that runs `buildMindtree` and compares every leaf.

/** The "no value" bucket — untracked, unassigned. Never a real id (all uuids). */
export const NO_VALUE = ''

/** Prefix marking an owner bucket that is free text rather than a member id. */
export const NAME_PREFIX = 'name:'

// ── the outcome ────────────────────────────────────────────────────────────

/**
 * The `EntryPatch` key a drop writes. Named so a caller can log or group.
 *
 * `mapNodeId` is the camelCase of `entries.node_id` — the finer grain under the
 * track, added by migration 0024. It is NOT a second filing axis: the `before`
 * trigger `entries_map_sync` DERIVES `track_id` from the node whenever
 * `node_id` is set, so a patch carrying both columns is a patch whose track half
 * the server will simply agree with. Naming it `mapNodeId` rather than `nodeId`
 * follows the plan's `FilterState.mapNodeIds`, so one word means one thing from
 * the URL codec down to this fold.
 */
export type DropField = 'trackId' | 'mapNodeId' | 'status' | 'priority' | 'ownerId' | 'ownerName'

/**
 * Why a drop was refused, as an i18n key in the mindtree namespace.
 *
 * A UNION rather than `string`, so a surface cannot invent a key that has no
 * translation behind it and a new refusal cannot be added without also being
 * added to both bundles — the failure lib/localeReach.test.ts exists to catch,
 * caught one layer earlier at compile time.
 *
 * TWO OF THESE ARE THE NODE-ACTION FAMILY'S KEYS, NOT THIS MODULE'S, and that is
 * deliberate. "This ring is derived" and "that branch is retired" are the same
 * two sentences whether the reader reached them by dragging a node or by opening
 * a node's action menu, and the repo has a gate that says so
 * (lib/labelSections.test.ts fails on two keys carrying one string). Pointing at
 * `whyDerived` / `whyRetired` is what keeps the map from explaining one refusal
 * two ways depending on which gesture provoked it. The other four have no
 * counterpart: they are about the DRAG — what you picked up, and where you let
 * go — which a menu cannot express.
 */
export type DropRefusalKey =
  | 'mindtree.dropRefusedBranch'
  | 'mindtree.dropRefusedTarget'
  | 'mindtree.dropRefusedUnknown'
  | 'mindtree.whyDerived'
  | 'mindtree.whyRetired'
  | 'entry.errNotFound'

/**
 * The verdict. A discriminated union with three arms and no fourth:
 *
 *  - `patch`    — write it, through the ordinary optimistic path.
 *  - `noop`     — legal, but the row is already there. Nothing is written and
 *                 nothing failed; the node settles back where it was.
 *  - `refused`  — illegal. `reasonKey` is the sentence, and there is always one.
 *
 * `patch` carries BOTH the decomposed `field`/`value` (for announcements, undo
 * labels and tests) and the assembled `EntryPatch`. The assembled patch is not a
 * convenience and it is NOT derivable from `field`+`value`: a drop onto a group
 * folds its whole ancestry, so it may write two columns (the track AND the group
 * bucket), and for one target — Unassigned — it writes two more than a naive
 * reading gives. `field`/`value` name the deepest step; `patch` is the write.
 * See `foldPath()` and `ownerPatch()`.
 */
export type DropOutcome =
  | {
      readonly kind: 'patch'
      readonly entryId: string
      readonly field: DropField
      /** The new column value. `null` only for "clear it" (no track, no owner). */
      readonly value: string | null
      /** Hand to `patchEntry(entryId, patch)` unchanged. */
      readonly patch: EntryPatch
    }
  | { readonly kind: 'noop' }
  | { readonly kind: 'refused'; readonly reasonKey: DropRefusalKey }

/**
 * What a `noop` says out loud.
 *
 * The `noop` arm carries NO key, deliberately: there is exactly one way to land
 * where you already were, so a per-case reason would be one field that is always
 * the same value. But a keyboard user still needs the live region to say
 * something — silence after a deliberate move reads as a dropped gesture — so
 * the sentence is named here rather than typed as a literal into whichever
 * surface announces it. Exported, so the mindtree locale gate can see that this
 * string is asked for.
 */
export const DROP_UNCHANGED_KEY = 'mindtree.dropUnchanged'

// ── the inputs ─────────────────────────────────────────────────────────────
//
// Structural, and deliberately minimal. `MindNode` is assignable to both node
// shapes as it stands and `Entry` is assignable to the row shape as it stands,
// so a caller passes what it already has and nothing has to be mapped. Declaring
// them narrowly (rather than importing `MindNode` and `Entry` outright) is the
// same trick layout.ts's `LayoutInputNode` uses: it documents exactly which
// four facts the rules read, and it keeps the test fixtures three lines long.

/** The row's current buckets. `Entry` is assignable as-is. */
export interface DropEntryRow {
  readonly id: string
  readonly track_id: string | null
  /**
   * `entries.node_id` — the map node this row is filed under, or null for "on
   * the track, under no organization".
   *
   * SPELLED `node_id`, NOT `map_node_id`, and the difference is not cosmetic:
   * every field on this interface is a COLUMN NAME, because the whole point of
   * the shape is that `Entry` is assignable to it with nothing mapped (see the
   * block comment above, and `actions.selectionAction`, which hands an `Entry`
   * straight through as `DropQuery.entry`). Migration 0024 names the column
   * `node_id`; a field called `map_node_id` here would make that assignability
   * silently false and force a mapping layer into every caller. The camelCase
   * PATCH key is `mapNodeId`, matching `EntryPatch`'s convention of naming the
   * dimension rather than the column — the two spellings are the row side and
   * the write side of one thing.
   */
  readonly node_id: string | null
  readonly status: EntryStatus
  readonly priority: EntryPriority
  readonly owner_id: string | null
  readonly owner_name: string | null
}

/** The node being dragged. `MindNode` is assignable as-is. */
export interface DropSourceNode {
  readonly kind: MindNodeKind
  readonly entryId: string | null
}

/** The node under the pointer. `MindNode` is assignable as-is. */
export interface DropTargetNode {
  readonly kind: MindNodeKind
  readonly bucketKey: string | null
  /** A retired bucket still HOLDS work (model.ts keeps it drawn) but may not
   *  RECEIVE any — see the refusal below. */
  readonly retired: boolean
}

export interface DropQuery {
  readonly source: DropSourceNode
  /** The dragged leaf's row. `undefined` when the store no longer has it. */
  readonly entry: DropEntryRow | undefined
  /**
   * The ROOT-TO-TARGET path, target LAST — see the header on why a drop is the
   * whole path. `[root, track]` for a track branch, `[root, track, group]` for a
   * group, and `[root, track, entity…, group]` once the hierarchy has entities
   * under the track — arbitrarily many `entity` steps, because the tree beneath
   * a track is recursive, and `cohort` steps interleaved with them once `?by=`
   * is on. The root contributes nothing and may be omitted; steps that are none
   * of track, entity or group — the root and every cohort — are skipped by the
   * fold, and only the LAST element decides whether the drop has a legal
   * destination at all.
   */
  readonly path: readonly DropTargetNode[]
  readonly dimension: MindDimension
}

// ── the frozen unions, mirrored ────────────────────────────────────────────

/**
 * A `Record<Union, true>` rather than an array, because that is the one spelling
 * TypeScript checks in BOTH directions: a status added to `EntryStatus` reds
 * this object as incomplete, and a status removed reds it as excess. An array
 * would silently keep serving a value the union no longer has.
 *
 * store/vocab.ts's `FROZEN_KEYS` is the same list, and this is not a duplication
 * that can drift: `src/lib/**` may not import `src/store/**` (the layering rule
 * every header in this directory is written to), and the union in types.ts is
 * the shared source both mirror.
 */
const STATUS_KEYS: Readonly<Record<EntryStatus, true>> = Object.freeze({
  new: true,
  in_progress: true,
  blocked: true,
  waiting_on: true,
  done: true,
  cancelled: true,
})

const PRIORITY_KEYS: Readonly<Record<EntryPriority, true>> = Object.freeze({
  low: true,
  medium: true,
  high: true,
  critical: true,
})

/** `hasOwnProperty`, not `in` — `'constructor' in obj` is true and would let a
 *  forged bucket key through as a status. */
function has(table: Readonly<Record<string, true>>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(table, key)
}

function isStatus(key: string): key is EntryStatus {
  return has(STATUS_KEYS, key)
}

function isPriority(key: string): key is EntryPriority {
  return has(PRIORITY_KEYS, key)
}

// ── which bucket a row is in now ───────────────────────────────────────────

/**
 * The ring-1 bucket key for a row. Mirrors model.ts's `entry.track_id ?? ''`.
 */
export function trackBucketKey(entry: DropEntryRow): string {
  return entry.track_id ?? NO_VALUE
}

/**
 * The entity-ring bucket key for a row: the map node it is filed under, or null.
 *
 * NULL RATHER THAN `NO_VALUE`, and that asymmetry with `trackBucketKey` is the
 * point. The track ring has an "untracked" pile because every row is drawn
 * SOMEWHERE on ring 1, so a row with no track still needs a branch. The entity
 * rings are different: they sit BETWEEN the track and its status buckets, and a
 * row with no node is not filed under a nameless organization — it is drawn on
 * the track's own group ring, one ring shallower. There is no "no organization"
 * node to compute a key for, so there is no sentinel for one, and `foldPath`
 * refuses an `entity` step whose key is the empty string rather than writing
 * `node_id = ''` into a uuid column.
 */
export function nodeBucketKey(entry: DropEntryRow): string | null {
  return entry.node_id
}

/**
 * The owner bucket key for a row. Mirrors model.ts's private `ownerBucket()`,
 * which mirrors Board's `bucketOf`, which mirrors `loadPerOwner`'s key shape.
 *
 * Four modules bucketing the same rows must produce the same keys or the board,
 * the dashboard, the map and this drag disagree about who owns what — and here
 * the disagreement is not cosmetic: it decides whether a drop is a no-op or an
 * assignment, and therefore whether somebody gets a notification.
 */
export function ownerBucketKey(entry: DropEntryRow): string {
  if (entry.owner_id !== null) return entry.owner_id
  const name = (entry.owner_name ?? '').trim()
  return name === NO_VALUE ? NO_VALUE : NAME_PREFIX + name
}

/**
 * The ring-2 bucket key for a row under `dimension`, or `null` when the ring is
 * not a writable axis.
 *
 * `health` returns null and always will: there is no `health` column, so "which
 * health bucket is this row in" has no answer this module is allowed to act on.
 * Callers get the refusal from `evaluateDrop`, which is the only place that
 * decision is spelled out.
 */
export function groupBucketKey(entry: DropEntryRow, dimension: MindDimension): string | null {
  if (dimension === 'status') return entry.status
  if (dimension === 'priority') return entry.priority
  if (dimension === 'owner') return ownerBucketKey(entry)
  return null
}

// ── bucket key → patch ─────────────────────────────────────────────────────

/**
 * THE ONE MAPPING THAT CANNOT BE LEFT TO A CALL SITE.
 *
 * `entries_single_owner` (0001:327) makes owner_id and owner_name mutually
 * exclusive, and both `api/entries.toEntryPatchRow()` and
 * `store/entries.applyPatchLocal()` resolve that XOR the same way: setting a
 * TRUTHY owner_id blanks owner_name and vice versa. The word "truthy" is the
 * trap. Unassigning means `ownerId: null`, which is falsy, so it clears nothing
 * — an entry owned by the free-text vendor "Acme" dropped onto Unassigned would
 * keep `owner_name: 'Acme'` and reappear in the Acme bucket the moment the
 * server row came back, having "moved" nowhere.
 *
 * So the unassign arm sends BOTH keys explicitly. Nothing else in this file is
 * as easy to get wrong or as quiet when it is.
 */
function ownerPatch(bucketKey: string): { field: DropField; value: string | null; patch: EntryPatch } {
  if (bucketKey === NO_VALUE) {
    return { field: 'ownerId', value: null, patch: { ownerId: null, ownerName: null } }
  }
  if (bucketKey.startsWith(NAME_PREFIX)) {
    const name = bucketKey.slice(NAME_PREFIX.length)
    return { field: 'ownerName', value: name, patch: { ownerName: name } }
  }
  // A member id. The XOR clears owner_name server-side and locally, so the
  // vendor name a row carried before the handover does not linger.
  return { field: 'ownerId', value: bucketKey, patch: { ownerId: bucketKey } }
}

// ── folding a path into one patch ──────────────────────────────────────────

type FoldResult =
  | {
      readonly ok: true
      readonly patch: EntryPatch
      /** The DEEPEST step's column — what the reader aimed at. */
      readonly field: DropField
      readonly value: string | null
    }
  | { readonly ok: false; readonly reasonKey: DropRefusalKey }

/**
 * Every track, entity and group step on the path, folded into one patch.
 *
 * See the header: a group branch means the INTERSECTION of itself and its
 * ancestors, so this walks the path root-first and lets each step write its own
 * column. Later steps overwrite `field`/`value` but not each other's columns —
 * a track, an entity and a group write different keys — so the result names the
 * deepest step while carrying the whole write.
 *
 * Steps that are none of the three (the root, and a `cohort`) are skipped rather
 * than refused: the caller is allowed to hand over the path exactly as the tree
 * gives it, without slicing the root off first.
 *
 * ── A COHORT IS SKIPPED, AND SKIPPING IT IS THE FEATURE ─────────────────────
 *
 * With `?by=manager` on, the path to an Organization runs
 * `root → track → cohort:manager:<uuid> → entity:<uuid>`, so this loop sees a
 * cohort on the way to almost every legal drop the map has. It must be
 * TRANSPARENT: the grouping is a lens over the same hierarchy, the same drop
 * onto the same Org has to write the same two columns whether the reader has
 * grouping on or off, and a URL that changes what a drag DOES would be the
 * defect the whole `?by=` design exists to avoid.
 *
 * And it must never write. `isFilingKind` is the guard rather than three `!==`
 * comparisons precisely here: it answers "is this node's `bucketKey` a row id
 * anything may put in a column", a cohort's synthetic key is not one, and the
 * failure it prevents is subtler than a wrong uuid — the loop's last arm is
 * `applyGroup`, so a cohort that got past this line would have its cut key read
 * as a DIMENSION VALUE and land as `status = 'cohort:manager:<uuid>'`. That is
 * `dropRules`' oldest documented trap (the `'group'` paragraph in model.ts's
 * `'cohort'` note) arriving through a new door. Dropping ONTO a cohort is
 * refused one level up, by name, in `evaluateDrop`.
 *
 * ROOT-FIRST IS WHAT MAKES THE TRACK ARM'S `mapNodeId: null` SAFE. It fires on
 * every path, including the ones that go on to pass through three entity rings —
 * and each of those overwrites it with its own node before the loop ends. So the
 * null is not "clear the org" so much as "the org is whatever the rest of this
 * path says, and nothing if the path says nothing".
 */
function foldPath(path: readonly DropTargetNode[], dimension: MindDimension): FoldResult {
  const patch: EntryPatch = {}
  let field: DropField | null = null
  let value: string | null = null

  for (const step of path) {
    if (!isFilingKind(step.kind) && step.kind !== 'group') continue
    // model.ts always sets `bucketKey` on a track, entity or group node, so a
    // null here is a malformed node rather than a real bucket — refuse rather
    // than write a column to null by accident.
    if (step.bucketKey === null) return { ok: false, reasonKey: 'mindtree.dropRefusedUnknown' }

    if (step.kind === 'track') {
      const next = step.bucketKey === NO_VALUE ? null : step.bucketKey
      patch.trackId = next
      // THE LOAD-BEARING LINE OF THE WHOLE HIERARCHY. The entity rings hang
      // BETWEEN the track and its status buckets, so a path that reaches a
      // track's own bucket without passing through one went around the
      // organizations on purpose: "blocked, on this track, under no org".
      // Leaving `node_id` alone would leave it pointing at Org3, and
      // `entries_map_sync` derives `track_id` straight back off that node — the
      // rebuild refiles the row under Org3 and it springs across the screen a
      // frame after landing. `changesRow` compares against the ROW, so on a row
      // that has no node this costs nothing: still a no-op, still no write.
      patch.mapNodeId = null
      field = 'trackId'
      value = next
      continue
    }

    if (step.kind === 'entity') {
      // NO `NO_VALUE` ARM, unlike the track above. There is no "no organization"
      // node to drop onto — a row under no entity is drawn one ring shallower,
      // on the track's own group ring — so an empty key here is a malformed node
      // and writing it would send `node_id = ''` at a uuid column (22P02, after
      // the optimistic row had already moved on screen).
      if (step.bucketKey === NO_VALUE) {
        return { ok: false, reasonKey: 'mindtree.dropRefusedUnknown' }
      }
      // Only the node. `track_id` is DERIVED from it by `entries_map_sync`, and
      // the track step above has already written the same answer — two filing
      // axes are unrepresentable rather than merely detected.
      patch.mapNodeId = step.bucketKey
      field = 'mapNodeId'
      value = step.bucketKey
      continue
    }

    const applied = applyGroup(patch, dimension, step.bucketKey)
    if (applied === null) return { ok: false, reasonKey: 'mindtree.dropRefusedUnknown' }
    field = applied.field
    value = applied.value
  }

  if (field === null) return { ok: false, reasonKey: 'mindtree.dropRefusedTarget' }
  return { ok: true, patch, field, value }
}

/** One ring-2 step, written into the patch. Null when the key is not a value. */
function applyGroup(
  patch: EntryPatch,
  dimension: MindDimension,
  key: string,
): { field: DropField; value: string | null } | null {
  if (dimension === 'owner') {
    const owner = ownerPatch(key)
    // Object.assign rather than field-by-field, so the unassign arm's SECOND key
    // cannot be dropped on the way through — that is the whole point of building
    // the owner patch in one place.
    Object.assign(patch, owner.patch)
    return { field: owner.field, value: owner.value }
  }
  if (dimension === 'status') {
    // A branch whose key is not a member of the frozen union. Unreachable when
    // the page passes `useVocabAll()` as model.ts documents (it walks the same
    // union), and cheap insurance against a first-paint cache one deploy old.
    if (!isStatus(key)) return null
    patch.status = key
    return { field: 'status', value: key }
  }
  if (dimension === 'priority') {
    if (!isPriority(key)) return null
    patch.priority = key
    return { field: 'priority', value: key }
  }
  // health — refused before the fold ever runs. Never silently written.
  return null
}

/**
 * Would this patch change the row?
 *
 * THE NO-OP TEST, and it is against the ROW rather than against the tree — see
 * the header. A write that stores the values an entry already holds is not
 * harmless: `entries_touch()` bumps `last_activity_at`, which resets the
 * staleness clock on work nobody touched and takes the item off exactly the
 * screen that was supposed to surface it. This repo has already paid for that
 * once, as R3-LEAD-1 ("a handover must not reset the staleness clock").
 *
 * `owner_name` is compared TRIMMED because model.ts buckets it trimmed: a row
 * holding "  Acme Ltd  " is drawn under the `name:Acme Ltd` branch, and dropping
 * it back onto that branch has to read as landing where it started.
 */
function changesRow(patch: EntryPatch, row: DropEntryRow): boolean {
  if (patch.trackId !== undefined && patch.trackId !== row.track_id) return true
  // WITHOUT THIS LINE A PURE ORG MOVE IS A NO-OP. Dragging an item from Org1 to
  // Org2 under the same track writes `trackId` with the value it already holds
  // and `mapNodeId` with a new one; comparing only the track would call that
  // "already there", write nothing, and leave the node sitting on Org2 until the
  // next rebuild put it back on Org1. It is also the other half of the track
  // arm's `mapNodeId: null`: that null is a real change on a row inside an org
  // and correctly nothing on a row that was never in one.
  if (patch.mapNodeId !== undefined && patch.mapNodeId !== row.node_id) return true
  if (patch.status !== undefined && patch.status !== row.status) return true
  if (patch.priority !== undefined && patch.priority !== row.priority) return true
  if (patch.ownerId !== undefined && patch.ownerId !== row.owner_id) return true
  if (
    patch.ownerName !== undefined &&
    (patch.ownerName ?? '').trim() !== (row.owner_name ?? '').trim()
  ) {
    return true
  }
  return false
}

// ── the verdict ────────────────────────────────────────────────────────────

/**
 * Is this node kind a hit-test candidate at all?
 *
 * The root is the workspace (dropping "onto everything" means nothing), a leaf
 * is another entry (there is no manual order to reorder into — ring 3 reads in
 * the FilterBar's sort), and a "+N more" is a fold affordance. None of the three
 * is a bucket, so drag.ts never builds a zone for them and a pointer passing
 * over one finds nothing armed. `evaluateDrop` still refuses them by name,
 * because the keyboard path can address any node in the tree.
 *
 * Health GROUPS are zones on purpose, even though every drop on one is refused —
 * see the header. A ring that cannot be hovered cannot explain itself.
 *
 * ENTITY IS A ZONE AND UNLIKE HEALTH IT ACCEPTS. "This issue belongs to this
 * organization" is the gesture the hierarchy exists for, and the same argument
 * that makes health hoverable-but-refused makes this one unarguable: the entity
 * ring would otherwise be the only ring on the map you cannot drop on, which
 * reads as a broken drag rather than as a rule.
 *
 * A COHORT IS A ZONE AND EVERY DROP ON ONE IS REFUSED — health's arrangement
 * exactly, for health's reason. With `?by=manager` on, a cohort is the BIGGEST
 * ring on the screen and the one a dragging pointer crosses on its way to
 * anything; a ring that cannot be hovered cannot explain itself, and a pointer
 * that finds nothing armed over the largest thing on the map reads as a broken
 * drag. So it arms, and `evaluateDrop` answers `whyDerived` by name: a cohort is
 * a CUT of the organizations, not a column — "Sara's book" is `?by=manager`
 * grouping what `account_manager_id` already says, and dropping an ISSUE on it
 * would have to mean reassigning the ORGANIZATION, which is a different gesture
 * on a different noun (the design parks it, with this refusal as its placeholder
 * — §7's "Parked").
 *
 * ⚠ WHY `KIND_ROLE` IS NOT THE WHOLE ANSWER HERE. Three of these four kinds are
 * roles apart: `track`/`entity` are `'place'`, `group`/`cohort` are `'bucket'`.
 * The role table answers "may a column be written from this node's key", and a
 * zone is a question about the POINTER — what is under it, and whether the map
 * owes it a sentence. The two questions have different answers on a cohort by
 * design, which is why this stays its own list and why the list is now spelled
 * against `MindNodeKind` as a total record.
 */
/**
 * IS THIS NODE'S `bucketKey` A ROW WORK CAN BE FILED UNDER?
 *
 * THE PREDICATE THE 27-SITE AUDIT ACTUALLY NEEDED, and it is deliberately not
 * `KIND_ROLE[kind] === 'place'`. model.ts's own warning on that table says why
 * in one sentence — *"The role answers 'may I frame it / is it structure'; it
 * never answers 'what column does its key belong in'"* — and `'place'` is four
 * kinds, of which only these two have a row:
 *
 *     track   `bucketKey` is a `tracks.id`      → `track_id`
 *     entity  `bucketKey` is a `map_nodes.id`   → `node_id`
 *     root    no key at all; it is the workspace
 *     cohort  a SYNTHETIC key `groupEntities` minted from a column the
 *             organizations already carry — `cohort:manager:<uuid>`
 *
 * Writing a cohort's key into either column is the exact failure model.ts's
 * `'entity'` and `'cohort'` paragraphs are written to prevent, and reading the
 * ROLE here instead of this table is how it would have happened anyway, one
 * refactor after the kind landed. So the audit's answer at these six sites is a
 * table of its own, total over `MindNodeKind` — a new kind is a build error here
 * as well, and its safe default is the one this predicate gives it.
 *
 * `actions.ts` imports it rather than restating it: `draftAt`, `branchRefAt`,
 * `structuralActions` and `selectionLabel` are asking this question, and a
 * second copy of it is how a create and a drop start disagreeing about what a
 * branch is.
 */
const FILING_KIND: Readonly<Record<MindNodeKind, boolean>> = Object.freeze({
  root: false,
  track: true,
  entity: true,
  cohort: false,
  group: false,
  more: false,
  entry: false,
})

export function isFilingKind(kind: MindNodeKind): boolean {
  return FILING_KIND[kind]
}

const DROP_ZONE: Readonly<Record<MindNodeKind, boolean>> = Object.freeze({
  root: false,
  track: true,
  entity: true,
  cohort: true,
  group: true,
  more: false,
  entry: false,
})

export function isDropZoneKind(kind: MindNodeKind): boolean {
  return DROP_ZONE[kind]
}

/**
 * The whole policy, in the order the checks have to run.
 *
 * ORDER IS THE CONTRACT, and two steps of it are not interchangeable:
 *
 *  - The NO-OP is tested BEFORE `retired`. A row already sitting in a retired
 *    bucket, dropped back onto that same bucket, has not attempted anything
 *    illegal — telling it off for landing where it started would be a refusal
 *    the reader cannot act on and cannot avoid.
 *  - `health` is refused BEFORE the bucket is decoded, because there is nothing
 *    to decode: the branch's key is a level, not a column value, and any attempt
 *    to read it as one is the bug this arm prevents.
 *
 * Called on HOVER as well as on RELEASE — same function, so the styling of the
 * branch under the pointer and the write that lands on it can never disagree.
 */
export function evaluateDrop(q: DropQuery): DropOutcome {
  const { source, entry, path, dimension } = q

  // v1: leaves move, branches do not. Also catches a 'more' fold being dragged.
  if (source.kind !== 'entry' || source.entryId === null) {
    return { kind: 'refused', reasonKey: 'mindtree.dropRefusedBranch' }
  }

  // Only the DEEPEST step decides whether there is a destination at all. An
  // ancestor that is a root is skipped by the fold; a path ending on the root,
  // on another entry or on a "+N more" is not a bucket.
  const target = path[path.length - 1]
  if (target === undefined || !isDropZoneKind(target.kind)) {
    return { kind: 'refused', reasonKey: 'mindtree.dropRefusedTarget' }
  }

  // The row vanished between lift and release — a realtime delete, or a filter
  // that dropped it. There is nothing to patch and inventing one would resurrect
  // a deleted row.
  if (entry === undefined) {
    return { kind: 'refused', reasonKey: 'entry.errNotFound' }
  }

  // Before the fold, because there is nothing to fold: a health branch's key is
  // a LEVEL, not a column value, and any attempt to read it as one is the bug
  // this arm exists to prevent.
  if (target.kind === 'group' && dimension === 'health') {
    return { kind: 'refused', reasonKey: 'mindtree.whyDerived' }
  }

  // A COHORT, AND FOR THE LINE ABOVE'S REASON RATHER THAN A NEW ONE — which is
  // why it borrows that sentence rather than minting a locale key. A cohort's
  // key is a CUT (`manager:<uuid>`, `stage:<uuid>`), derived by `groupEntities`
  // from columns the organizations already carry; there is no column on an ENTRY
  // that it names, and `whyDerived` — "this ring is worked out from the data,
  // there is nothing to set" — is exactly true of it. lib/labelSections.test.ts
  // fails on two keys carrying one string, so a second sentence saying this
  // would have been a gate failure as well as a translation nobody needed.
  //
  // BEFORE THE FOLD, deliberately and not merely for symmetry. `foldPath` SKIPS
  // cohorts — they are transparent, so the same drop writes the same columns
  // with grouping on or off — and a drop that ENDED on one would therefore fold
  // its ANCESTORS and succeed: `root → track → cohort` folds to "this track,
  // under no organization", so dropping an issue on "Sara's book" would silently
  // take it out of the Org it was in and file it on the track. A drag that
  // quietly does something other than what it looked like is worse than one that
  // is refused, and this arm is the reason it cannot happen.
  if (target.kind === 'cohort') {
    return { kind: 'refused', reasonKey: 'mindtree.whyDerived' }
  }

  const folded = foldPath(path, dimension)
  if (!folded.ok) return { kind: 'refused', reasonKey: folded.reasonKey }

  // BEFORE `retired`, deliberately. A row already sitting in a retired bucket,
  // dropped back onto that same bucket, has not attempted anything illegal —
  // telling it off for landing where it started would be a refusal the reader
  // can neither act on nor avoid.
  if (!changesRow(folded.patch, entry)) return { kind: 'noop' }

  // An archived track, an archived map node, a hidden vocabulary option, an
  // owner the roster has forgotten — ANYWHERE on the path, because a drop onto a
  // group under an archived Org files into that Org too, and `map_nodes.archived`
  // is the same filing decision `tracks.archived` is. model.ts draws these because they
  // still HOLD work and dropping them would break the roll-up, but filing NEW
  // work into one is how a row ends up somewhere no picker can reach again.
  if (path.some((step) => isDropZoneKind(step.kind) && step.retired)) {
    return { kind: 'refused', reasonKey: 'mindtree.whyRetired' }
  }

  return {
    kind: 'patch',
    entryId: entry.id,
    field: folded.field,
    value: folded.value,
    patch: folded.patch,
  }
}

/**
 * Does this drop CLOSE the entry?
 *
 * Exported because the surface owes a `Confirm` on it and must not re-derive the
 * closed set to find out. Dropping onto Done or Cancelled fires
 * `entries_set_closed_at()`, which stamps `closed_at` and takes the row out of
 * every open list on the screen — the one drop on this map that removes work
 * from view rather than moving it, and therefore the one that has to be asked
 * about rather than just undone.
 */
export function closesEntry(outcome: DropOutcome): boolean {
  if (outcome.kind !== 'patch' || outcome.field !== 'status') return false
  return CLOSED_STATUSES.some((s) => s === outcome.value)
}
