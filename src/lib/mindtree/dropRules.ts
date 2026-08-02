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

/** The `EntryPatch` key a drop writes. Named so a caller can log or group. */
export type DropField = 'trackId' | 'status' | 'priority' | 'ownerId' | 'ownerName'

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
   * group. The root contributes nothing and may be omitted; steps that are
   * neither a track nor a group are skipped by the fold, and only the LAST
   * element decides whether the drop has a legal destination at all.
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
 * Every track and group step on the path, folded into one patch.
 *
 * See the header: a group branch means the INTERSECTION of itself and its
 * ancestors, so this walks the path root-first and lets each step write its own
 * column. Later steps overwrite `field`/`value` but not each other's columns —
 * a track and a group write different keys — so the result names the deepest
 * step while carrying the whole write.
 *
 * Steps that are neither a track nor a group (the root) are skipped rather than
 * refused: the caller is allowed to hand over the path exactly as the tree gives
 * it, without slicing the root off first.
 */
function foldPath(path: readonly DropTargetNode[], dimension: MindDimension): FoldResult {
  const patch: EntryPatch = {}
  let field: DropField | null = null
  let value: string | null = null

  for (const step of path) {
    if (step.kind !== 'track' && step.kind !== 'group') continue
    // model.ts always sets `bucketKey` on a track or group node, so a null here
    // is a malformed node rather than a real bucket — refuse rather than write a
    // column to null by accident.
    if (step.bucketKey === null) return { ok: false, reasonKey: 'mindtree.dropRefusedUnknown' }

    if (step.kind === 'track') {
      const next = step.bucketKey === NO_VALUE ? null : step.bucketKey
      patch.trackId = next
      field = 'trackId'
      value = next
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
 */
export function isDropZoneKind(kind: MindNodeKind): boolean {
  return kind === 'track' || kind === 'group'
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

  const folded = foldPath(path, dimension)
  if (!folded.ok) return { kind: 'refused', reasonKey: folded.reasonKey }

  // BEFORE `retired`, deliberately. A row already sitting in a retired bucket,
  // dropped back onto that same bucket, has not attempted anything illegal —
  // telling it off for landing where it started would be a refusal the reader
  // can neither act on nor avoid.
  if (!changesRow(folded.patch, entry)) return { kind: 'noop' }

  // An archived track, a hidden vocabulary option, an owner the roster has
  // forgotten — ANYWHERE on the path, because a drop onto a group under an
  // archived track files into that track too. model.ts draws these because they
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
