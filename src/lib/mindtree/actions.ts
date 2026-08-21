// What a node on the map LETS YOU DO — the answer computed before the menu opens.
//
// THIS IS lib/permissions.ts's PRINCIPLE APPLIED TO A SECOND SURFACE, and the
// reason is the one that module's header already wrote down: `entries_update` is
// narrower than SELECT, an RLS-blocked patch comes back as zero rows, PostgREST
// reports that as PGRST116, and the reader's translation of "Something went
// wrong" is "the app is broken" rather than "I am not allowed". A map you can
// DRAG makes that worse, not better: a card that lifts, travels 300 px, drops,
// and snaps back has told a much bigger lie than a button that does nothing.
//
// So every affordance on this screen is decided HERE, as data, before it is
// drawn — and a control that would be refused is either absent or disabled with
// a sentence that names the refusal. Nothing on the map arms a write the server
// is going to reject.
//
// PURE BY CONSTRUCTION, the same contract model.ts and layout.ts hold. No store,
// no clock, no locale, no `t()`. Labels and refusals leave here as i18n KEYS,
// written as string literals rather than assembled, so lib/mindtree/locale.test
// and lib/localeReach.test can both see them — a template literal has no key
// until it runs, and this is the module whose keys nobody would exercise by hand.
//
// THE PERMISSION RULES ARE IMPORTED, NEVER RESTATED. `canEditEntry` and
// `isOpen` are the only two definitions in the repo and they stay that way; this
// file's job is to decide WHICH QUESTION to ask about which node, not to answer
// it a second time. The one rule it cannot import is the nudge rule — it lives
// in `components/entry/NudgeButton.tsx` beside `api/nudge.ts`'s window, and
// `src/lib/**` may not import from `src/api/**` or reach into a component
// (EXECUTION-PLAN rule 2, enforced by a standing grep). Restating a rule that
// decides whether a colleague gets a notification is exactly the drift this
// header objects to, so the verdict ARRIVES AS INPUT — `MindActionCtx.nudge` is
// REQUIRED, so a surface cannot forget to wire it and silently lose the action.
//
// THE PATH, NOT THE NODE. Every entry point takes the chain from the root down,
// because ring 2 is drawn INSIDE ring 1: the "Blocked" node under Network means
// "blocked AND on Network", and an act there that honoured only the deepest node
// would leave an item from Infrastructure sitting under Network's branch while
// still filed on Infrastructure — the branch labelled 12 showing 13, which is
// the single worst thing this map can do. `dropRules.evaluateDrop` folds the
// path for a move and `draftAt` folds it for a create, so what an act DOES is
// exactly what the picture SAYS.
//
// WHAT A BUCKET MEANS IS NOT DECIDED HERE EITHER. `dropRules.evaluateDrop()` is
// the repo's answer to "this row, onto this branch, on this axis — what lands?",
// with a `noop` arm for a row already in the bucket and a refusal union for the
// five ways it cannot. The bulk verb on a branch is N of those, so it CALLS that
// function once per selected row rather than deriving the patch a second time.
// Two derivations would mean a card meant one thing dragged and another thing
// chosen from a menu on the branch it was dropped on — and only one of the two
// would have `dropRules`' XOR fix for unassigning a free-text owner.
//
// TWO VERBS HERE EDIT THE MAP RATHER THAN THE WORK — `addBranch` and
// `archiveBranch` — and they are decided by exactly the same rules as the rest.
// `map_nodes` writes are gated on is_admin() by 0023, surfaced as the
// `structure.edit` grant, and that verdict ARRIVES AS INPUT for the nudge rule's
// reason: it lives in a store and `src/lib/**` may not import one. What is
// different about them is stated where they are built (`structuralActions`):
// they are ABSENT without the grant rather than disabled with a sentence,
// because "you are not an admin" is not a rule a reader can act on.
//
// THE ONE THING THIS FILE STILL FOLDS A PATH FOR IS `addHere`, and that is a
// different question with a different answer. A CREATE has no current bucket to
// compare against and no row to move: "add an item here" under Network's Blocked
// branch must open the form with BOTH the track and the status filled in, or the
// item the reader just created appears somewhere other than where they asked for
// it. A move is one field; a draft is the intersection of the whole path.

import { isOpen } from '../health'
import { canEditEntry } from '../permissions'
import {
  DROP_UNCHANGED_KEY,
  NAME_PREFIX,
  NO_VALUE,
  closesEntry,
  evaluateDrop,
  isFilingKind,
  type DropOutcome,
} from './dropRules'
import { ROOT_ID } from './model'
import type { MindDimension, MindNode } from './model'
import type { Entry, EntryPatch, UserRole } from '../../types'

/**
 * Above this many items, a bulk act asks first.
 *
 * The same number `pages/tracks/TracksIndex.tsx` chose (`BULK_CONFIRM_AT`,
 * private there) and for the same reason it gives: there is no bulk undo, and
 * re-filing forty items by hand is the cost of getting it wrong. It matters more
 * here — a marquee across a map is a faster way to select forty things than a
 * shift-range down a list.
 */
export const MIND_BULK_CONFIRM_AT = 10

// ── what a node offers ─────────────────────────────────────────────────────

/**
 * The verbs. One union so a surface's `switch` is exhaustive and a new verb
 * reds every menu that has not handled it.
 *
 * `applySelection` is ONE verb rather than four (assign / move / set status /
 * set priority) deliberately: what it does is decided by the branch it sits on,
 * which is the same computation a DROP onto that branch performs. Splitting it
 * would be two answers to "what does this bucket mean", and the drag and the
 * menu would drift the first time a dimension was added.
 */
export type MindActionKind =
  | 'open'
  | 'assign'
  | 'priority'
  | 'status'
  | 'done'
  | 'nudge'
  | 'addHere'
  | 'applySelection'
  | 'focus'
  | 'collapse'
  | 'addBranch'
  | 'archiveBranch'

export interface MindAction {
  readonly kind: MindActionKind
  /** The menu label — an i18n key in the `mindtree` namespace. */
  readonly labelKey: string
  readonly enabled: boolean
  /**
   * WHY it is disabled — an i18n key naming the refusal. Null when enabled.
   *
   * Never a generic failure. A disabled control with no sentence is a control
   * the reader retries, and this whole module exists so that the answer arrives
   * before the retry does.
   */
  readonly reasonKey: string | null
  /**
   * True when performing it WRITES REAL WORK, and therefore must go through the
   * optimistic-write-plus-rollback path (`store/entries.patchEntry`) rather than
   * a bespoke call. A surface may branch on this to decide whether a failure
   * needs a rollback and a `pgErrorKey` sentence; nothing may write without it.
   */
  readonly mutates: boolean
  /** True when the act is large enough to want `components/Confirm.tsx` first. */
  readonly confirm: boolean
  /**
   * True when performing it CLOSES the rows it writes.
   *
   * A SECOND REASON TO ASK, and a different one from `confirm`. `confirm` is
   * about SIZE (ten or more, no bulk undo); this is about the one act on this
   * map that takes work OFF every open list rather than moving it between them —
   * `dropRules.closesEntry` is the only definition and it is what fills this in.
   *
   * It is carried on the ACTION rather than left to the surface to re-derive
   * because the verbs that close come in two shapes: `done` and a Done/Cancelled
   * pick carry a `DropOutcome` a surface can ask `closesEntry` about, and
   * `applySelection` does not — it evaluates N outcomes internally and keeps
   * only the shared patch. A surface reading the outcome alone therefore sees
   * `null` for the bulk verb and asks no question, which is how nine ticked
   * items get closed with no dialog. `DragLayer.commitDrop` gates on exactly
   * this property (`plan.closes`); this is the same gate for the menu.
   */
  readonly closes: boolean
  /**
   * The entry ids the act would write to, in the order the reader ticked them.
   *
   * ALREADY FILTERED TO WHAT THE VIEWER MAY EDIT — see `editableOf`. A bulk run
   * over these ids cannot include a row RLS will refuse, which is the difference
   * between "18 moved" and "12 moved, 6 failed, and the six are still ticked".
   * Empty for the view-only verbs (`focus`, `collapse`) and for `addHere`, which
   * creates rather than patches.
   */
  readonly targetIds: readonly string[]
  /**
   * The patch `applySelection` would apply, or the fields `addHere` should
   * prefill. Null for every verb that does not write a column.
   */
  readonly patch: EntryPatch | null
}

/**
 * A per-entry nudge verdict, supplied by the caller.
 *
 * IT IS NOT COMPUTED HERE, and the header says why: `canNudge` / `outstandingAsk`
 * / `askOffer` in `components/entry/NudgeButton.tsx` are documented as "PURE,
 * EXPORTED, AND THE ONLY DEFINITION", and `NUDGE_WINDOW_MS` is in `api/nudge.ts`
 * mirroring migration 0019's interval. `src/lib/**` may reach neither. The
 * screen already holds all three; it hands the answer down.
 *
 * `offer` is `askOffer()`'s return verbatim — 'first', 'again', or null for
 * "inside the 24-hour window, the row states the ask instead".
 */
export interface MindNudgeVerdict {
  readonly offer: 'first' | 'again' | null
  /**
   * An i18n key naming why the ask is not on offer, or null to accept this
   * module's generic one. Ignored when `offer` is non-null.
   */
  readonly blockedKey: string | null
}

export type MindNudgeLookup = (entry: Entry) => MindNudgeVerdict

export interface MindActionCtx {
  /** The signed-in profile's id, or null. Tested FIRST, as permissions.ts does. */
  readonly meId: string | null
  readonly role: UserRole
  /** The working set by id — `useEntryMap()`. A leaf whose id is absent is a
   *  tree drawn from a rebuild the store has already moved past; it offers only
   *  the read verbs. */
  readonly entryById: ReadonlyMap<string, Entry>
  /** Entry ids the reader has ticked, in tick order. */
  readonly selection: ReadonlySet<string>
  /** The axis ring 2 is cut on — decides what a `group` bucket MEANS. */
  readonly dimension: MindDimension
  /** The drill-in root, or null for the whole map. */
  readonly focusedId: string | null
  /** See MindNudgeVerdict. REQUIRED so a surface cannot forget to wire it. */
  readonly nudge: MindNudgeLookup
  /**
   * May this reader SHAPE the hierarchy — `structure.edit`, the grant
   * `pages/settings/StructureAdmin.tsx` already gates on.
   *
   * IT ARRIVES AS INPUT for `nudge`'s reason: the answer lives in
   * `store/auth.useHasPerm` and `src/lib/**` may not import a store. The screen
   * already holds it.
   *
   * OPTIONAL, AND IT DEFAULTS TO CLOSED — the one place in this file where a
   * missing input is not a wiring bug to shout about. `undefined` means "no
   * structural verbs", which is exactly what a reader without the grant must
   * see, so a surface that has not wired it yet shows the map it showed before
   * rather than two verbs whose every press would come back 42501.
   *
   * ABSENT RATHER THAN DISABLED, and it is the one refusal in this module that
   * is silent. Every other `reasonKey` teaches a rule the reader could satisfy —
   * sign in, pick a different bucket, tick something. "You are not an admin" is
   * not a rule they can act on, it is a fact about their account, and two greyed
   * rows on every branch of the map is a permanent reminder of it. The verbs
   * that are MEANINGLESS rather than refused are absent for the same reason.
   */
  readonly canEditStructure?: boolean
}

// ── the reason keys ────────────────────────────────────────────────────────
//
// Named constants rather than inline literals so that the same refusal reads
// identically from the menu, the drag's refusal badge and the keyboard path —
// three places a reader can meet the same wall, and three chances to word it
// three ways. Every one is a literal string, which is what keeps them visible
// to the two locale gates.

export const WHY_SIGNED_OUT = 'mindtree.whySignedOut'
export const WHY_NOT_YOURS = 'mindtree.whyNotYours'
export const WHY_CLOSED = 'mindtree.whyClosed'
export const WHY_RETIRED = 'mindtree.whyRetired'
export const WHY_DERIVED = 'mindtree.whyDerived'
export const WHY_NO_SELECTION = 'mindtree.whyNoSelection'
export const WHY_NONE_EDITABLE = 'mindtree.whyNoneEditable'
export const WHY_FOCUSED = 'mindtree.whyFocused'
export const WHY_EMPTY_BRANCH = 'mindtree.whyEmptyBranch'
export const WHY_NO_NUDGE = 'mindtree.whyNoNudge'
export const WHY_TOO_DEEP = 'mindtree.whyTooDeep'

/**
 * A leaf the store no longer holds.
 *
 * `store/entries.patchEntry` already returns this key for exactly this state, so
 * the map says what the rest of the app says rather than inventing a second
 * sentence for one condition. `dropRules` refuses the same case with the same
 * key, which is how a menu and a drop stay in step.
 */
export const WHY_GONE = 'entry.errNotFound'

// ── the draft a branch opens the capture form with ─────────────────────────

/**
 * Fold a root-to-node path into the fields a NEW item filed here should carry,
 * or null when this branch cannot hold new work.
 *
 * THE WHOLE PATH, and this is the one place in the feature where that is right.
 * Every ring is drawn INSIDE the one above it, so "Blocked" under Org1 under
 * UHR means "blocked AND on Org1 AND on UHR" — and an item created from that
 * node with only its status set would be filed untracked, under no
 * organization, and appear somewhere else entirely, which is the reader watching
 * their own click land in the wrong place. A MOVE is a different question
 * (`dropRules.evaluateDrop`, with the row's current bucket to compare against);
 * a DRAFT has no current bucket at all.
 *
 * AND THAT IS WHY THE `track` ARM SENDS `mapNodeId: null` OUT LOUD. Every key a
 * draft omits is a key the capture form is free to default, so "omit it" and
 * "clear it" are not the same statement here — the lesson `dropRules.ownerPatch`
 * paid for on the owner XOR, one ring further in.
 *
 * NULL HAS THREE CAUSES, each with its own sentence from `draftRefusal`: a node
 * that stands for no bucket, a retired bucket, and the `health` axis — whose
 * groups `v_entry_health` DERIVES from due dates and activity, so there is no
 * column to seed.
 */
export function draftAt(path: readonly MindNode[], dimension: MindDimension): EntryPatch | null {
  const node = path[path.length - 1]
  if (node === undefined) return null
  // A TABLE, NOT TWO `!==` COMPARISONS — `dropRules.isFilingKind`, which is
  // total over `MindNodeKind` so the next kind is a build error here instead of
  // a silent "no". A filing kind is a node whose `bucketKey` is a row id (a
  // track or an Organization) and a `group` is the dimension's own bucket;
  // between them they are every ring a NEW item can be seeded from. A COHORT is
  // neither: it is a CUT of the organizations, so "add an item to the 96
  // organizations Sara manages" names none of them to file under, and the answer
  // is that the reader dives one ring and picks one.
  if (!isFilingKind(node.kind) && node.kind !== 'group') return null

  const patch: EntryPatch = {}
  for (const step of path) {
    if (step.kind === 'track') {
      // An archived track, or a track_id nothing explains. Archiving is a filing
      // decision, and creating new items under it is how an archived track
      // quietly comes back to life.
      if (step.retired) return null
      if (step.bucketKey === null) return null
      patch.trackId = step.bucketKey === NO_VALUE ? null : step.bucketKey
      // EXPLICITLY, and for `ownerPatch`'s reason rather than `foldPath`'s. A
      // draft has no row to compare against, so every key it omits is a key the
      // capture form gets to default — and a form that remembers the last
      // organization would file "add an item here" on a TRACK's own bucket
      // straight back under Org3. Sending the null is how a create says "under
      // this track and no organization" instead of saying nothing. Root-first,
      // so an `entity` step further down the path overwrites it.
      patch.mapNodeId = null
      continue
    }
    if (step.kind === 'entity') {
      // An archived Org, or a node id nothing explains. Same rule as the track
      // above: `map_nodes.archived` is a filing decision, and new work filed
      // under an archived Organization is how it quietly comes back to life.
      if (step.retired) return null
      if (step.bucketKey === null) return null
      // NO `NO_VALUE` ARM — see dropRules.foldPath. There is no "no
      // organization" node; a row under none is drawn on the track's group ring,
      // and an empty key here is a malformed node, not a bucket.
      if (step.bucketKey === NO_VALUE) return null
      patch.mapNodeId = step.bucketKey
      continue
    }
    // The root, and every `cohort` step `?by=` put on the path. SKIPPED, and
    // transparently: a cohort is a lens over the same hierarchy, so a draft
    // seeded under an Organization must carry the same fields whether the reader
    // has grouping on or off — `dropRules.foldPath` skips them for the same
    // reason and with the longer argument.
    if (step.kind !== 'group') continue
    // A hidden vocabulary option, or an owner the roster has forgotten.
    // store/vocab.ts's frozen rule is that hiding an option must never hide
    // DATA — it says nothing about letting new data in, and a picker that no
    // longer offers the value must not be routed around by a create.
    if (step.retired) return null
    if (step.bucketKey === null) return null
    if (!seedGroup(patch, dimension, step.bucketKey)) return null
  }
  return patch
}

/**
 * Seed one group bucket into a draft. False when this axis has no column.
 *
 * The `as` casts are safe by construction, and not because this file checked:
 * `model.vocabGroups` buckets by `entry.status` / `entry.priority`, both already
 * typed by the frozen unions in types.ts, and any key `useVocabAll()` did not
 * declare is marked `retired` — which the caller refused two lines up. Restating
 * the unions here would be a third mirror of them (dropRules.ts holds the
 * second, as `Record<Union, true>`, for the case where a cast is NOT safe).
 */
function seedGroup(patch: EntryPatch, dimension: MindDimension, key: string): boolean {
  switch (dimension) {
    case 'status':
      patch.status = key as Entry['status']
      return true
    case 'priority':
      patch.priority = key as Entry['priority']
      return true
    case 'owner':
      if (key === NO_VALUE) {
        // Unassigned. BOTH keys, for the reason dropRules.ownerPatch documents at
        // length: `ownerId: null` is falsy, so the owner XOR clears nothing, and
        // a draft seeded from the Unassigned bucket would otherwise inherit
        // whatever `ownerName` the form defaulted to.
        patch.ownerId = null
        patch.ownerName = null
      } else if (key.startsWith(NAME_PREFIX)) {
        // A vendor, or somebody outside the workspace. model.ts gives them their
        // own bucket precisely because they own real work. The key carries the
        // raw name; only the node ID is percent-encoded.
        patch.ownerId = null
        patch.ownerName = key.slice(NAME_PREFIX.length)
      } else {
        patch.ownerId = key
        patch.ownerName = null
      }
      return true
    case 'health':
      return false
  }
}

/** The sentence that goes with a `draftAt` of null. */
export function draftRefusal(path: readonly MindNode[], dimension: MindDimension): string {
  const node = path[path.length - 1]
  if (node === undefined) return WHY_EMPTY_BRANCH
  if (
    path.some((step) => (isFilingKind(step.kind) || step.kind === 'group') && step.retired)
  ) {
    return WHY_RETIRED
  }
  if (dimension === 'health' && node.kind === 'group') return WHY_DERIVED
  return WHY_EMPTY_BRANCH
}

// ── the branch a structural verb acts on ───────────────────────────────────

/**
 * The deepest a node may sit below its track — `v_max_depth` in 0023's
 * `map_nodes_check_tree()`, MIRRORED here and not owned here.
 *
 * IT IS 1-BASED, LIKE THE TRIGGER: a node hanging directly off a track is at
 * level 1. `pages/settings/StructureAdmin.tsx` holds the same number as
 * `MAX_LEVEL` and refuses "Add child" with it for the same reason this file
 * refuses "Add a branch here"; the value cannot be derived from either place
 * because the cap lives in a plpgsql constant. Two mirrors of one constant is
 * one more than anybody wants, and importing across `src/lib` → `src/pages` is
 * the thing that is actually forbidden (EXECUTION-PLAN rule 2), so the two
 * copies stay and this comment is what keeps them in step.
 *
 * WITHOUT THIS THE READER MEETS 22023. The trigger is deferred, so the refusal
 * arrives after a name has been typed and a button pressed, as
 * `mapadmin.errTooDeep` — correct, and too late to be a rule anybody learns.
 */
export const MAX_BRANCH_LEVEL = 6

/**
 * WHERE a structural verb would write, folded out of the root-to-node path.
 *
 * ONE SHAPE FOR BOTH VERBS, because both need the same three facts and a second
 * type would be a second fold of the same path. Which field matters depends on
 * the verb, and each is documented for the verb that reads it.
 *
 * `map_nodes` is a tree hanging under a TRACK, so `trackId` is not optional
 * context — the column is `not null` on every row and `createMapNode` sends it
 * even when there is a parent, so that a caller's belief about which track a
 * branch belongs to is checkable against `map_node_cross_track` rather than
 * left to a trigger nobody can see from the map.
 */
export interface MindBranchRef {
  /** The track this branch lives under. `map_nodes.track_id`. */
  readonly trackId: string
  /**
   * The map node this path ends on, or null when the path ends on the TRACK
   * itself — which is a real place, not a missing one: a child added there is a
   * level-1 node with `parent_id: null`.
   */
  readonly nodeId: string | null
  /** The 1-based level `nodeId` sits at; 0 when the path ends on the track. */
  readonly level: number
  /**
   * Any structural step on the path is already put away — an archived track, an
   * archived Organization that still holds work and is therefore still drawn.
   *
   * CARRIED RATHER THAN REFUSED HERE, because the two verbs want different
   * sentences from the same fact: adding under an archived branch is how one
   * quietly comes back to life, and archiving one again is a no-op the reader
   * should be told about rather than allowed to perform.
   */
  readonly retired: boolean
}

/**
 * Fold a root-to-node path into the place a structural verb would write, or
 * null when this path names no place in `map_nodes`.
 *
 * THE PATH AGAIN, AND FOR A THIRD REASON. `draftAt` folds it because a create
 * means the intersection of every ring; `evaluateDrop` folds it because a move
 * does. This folds it because the hierarchy IS the path: the track at the top
 * says which tree, and each `entity` step below it is one level of that tree,
 * so the depth the database will check is something this function can count
 * rather than something the reader discovers on submit.
 *
 * NULL HAS FOUR CAUSES and all four are structural rather than permissive: the
 * node is not a track or an entity (a group, a leaf, a "+N more", a cohort and
 * the root are not places in `map_nodes`); a `group` or `entry` step sits ABOVE
 * the node, which no tree this app draws produces and which would make the level
 * count a fiction; a track whose bucket key is missing or empty; an entity whose
 * bucket key is missing or empty, which is a malformed node rather than a bucket
 * — the same `NO_VALUE` refusal `draftAt` makes one ring out, and for its
 * reason: there is no "no organization" node.
 *
 * ── THE COHORT STEP IS TRANSPARENT, AND THAT IS THE BUG THIS WAVE ALMOST SHIPPED
 *
 * The loop below refuses any step it does not recognise, because a `group` or an
 * `entry` above the node would make the level count a fiction. A `cohort` is NOT
 * that: `?by=manager` puts one between the track and the organizations, so the
 * path to every Org on the map grows a step the moment the reader taps a
 * grouping chip. Falling into the refusal would have made "Add a branch" and the
 * whole QuickAdd composer VANISH from every Organization whenever grouping was
 * on — silently, because a null here is rendered as an absent verb rather than
 * as an error. It is skipped like the root, and for the root's reason: it is not
 * a level of `map_nodes`, so the depth the database is about to check does not
 * count it.
 */
export function branchRefAt(path: readonly MindNode[]): MindBranchRef | null {
  const node = path[path.length - 1]
  if (node === undefined) return null
  // A filing kind is exactly "this node's `bucketKey` is a row id". A cohort is
  // not one — it is `KIND_ROLE`'s `'place'`, which is a different question (may
  // the camera frame it) with a different answer — and it is refused HERE as a
  // TARGET even though it is skipped as a STEP just below: you may fly into
  // Sara's book, and you may not hang a `map_nodes` row off it.
  if (!isFilingKind(node.kind)) return null

  let trackId: string | null = null
  let nodeId: string | null = null
  let level = 0
  let retired = false

  for (const step of path) {
    if (step.kind === 'root' || step.kind === 'cohort') continue
    if (step.kind === 'track') {
      if (step.bucketKey === null || step.bucketKey === NO_VALUE) return null
      trackId = step.bucketKey
      retired = retired || step.retired
      continue
    }
    if (step.kind === 'entity') {
      if (step.bucketKey === null || step.bucketKey === NO_VALUE) return null
      nodeId = step.bucketKey
      level += 1
      retired = retired || step.retired
      continue
    }
    // A group, a leaf or a fold above the node. The hierarchy does not run
    // through one, so neither does the level count.
    return null
  }

  // The untracked pile. It is drawn, it holds real work, and it is not a track
  // — so there is no `track_id` to hang a node from and no branch to add.
  if (trackId === null) return null
  return { trackId, nodeId, level, retired }
}

/**
 * Why a NEW CHILD BRANCH cannot go here, or null when it can.
 *
 * ONE RULE, TWO READERS, and that is the whole reason it is a function rather
 * than four lines inside the menu. `structuralActions` asks it to decide whether
 * to grey the verb; `components/mindtree/QuickAdd.tsx` asks it again when the
 * composer is already open, because a tree can change underneath a popover — a
 * realtime archive, another admin's move — and a form that can no longer submit
 * must say why instead of teaching the reader to press Enter and get nothing.
 * Two copies of this would be a menu and a form disagreeing about the depth cap.
 *
 * IT DOES NOT ASK ABOUT `structure.edit`. The grant decides whether the VERB
 * exists at all (see `MindActionCtx.canEditStructure`), and there is no path to
 * the composer that does not go through the verb. Restating it here would put a
 * permission check in a component's render, which is where a permission check
 * goes stale.
 */
export function branchAddRefusal(path: readonly MindNode[], meId: string | null): string | null {
  if (meId === null) return WHY_SIGNED_OUT
  const ref = branchRefAt(path)
  if (ref === null) return WHY_EMPTY_BRANCH
  // Adding under a branch that is put away is how one quietly comes back to
  // life — `draftAt`'s rule about an archived Org, one table up.
  if (ref.retired) return WHY_RETIRED
  if (ref.level + 1 > MAX_BRANCH_LEVEL) return WHY_TOO_DEEP
  return null
}

// ── the list ───────────────────────────────────────────────────────────────

/**
 * Every act this node supports, in menu order, each already decided.
 *
 * ORDER IS PART OF THE CONTRACT: the read verb first (it is what most taps
 * want), then the writes, then the two view verbs. A surface renders the list as
 * given and adds nothing, which is what makes the menu, the keyboard path and
 * the drag agree about what is possible.
 *
 * DISABLED RATHER THAN ABSENT, mostly. An act that is missing teaches nothing;
 * an act that is present and greyed with a reason teaches the rule once. The
 * exceptions are the acts that are MEANINGLESS rather than refused — there is no
 * "collapse" on a leaf and no "assign" on a track — because a menu padded with
 * verbs that could never apply to this kind of node is a menu nobody reads.
 */
export function mindActionsFor(
  path: readonly MindNode[],
  ctx: MindActionCtx,
): readonly MindAction[] {
  const node = path[path.length - 1]
  if (node === undefined) return EMPTY_ACTIONS
  return node.kind === 'entry' ? leafActions(node, ctx) : branchActions(path, node, ctx)
}

const EMPTY_ACTIONS: readonly MindAction[] = Object.freeze([])

/* ── a leaf ── */

function leafActions(node: MindNode, ctx: MindActionCtx): readonly MindAction[] {
  const id = node.entryId
  const entry = id === null ? undefined : ctx.entryById.get(id)
  const ids = id === null ? EMPTY_IDS : [id]

  // A leaf the store no longer holds. The tree is rebuilt from the store, so
  // this is the frame between a realtime delete and the next layout — rare, and
  // the honest answer is that the only thing left to do is try to open it.
  if (entry === undefined) {
    return [action('open', 'mindtree.actOpen', id !== null, id === null ? WHY_GONE : null, ids)]
  }

  const edit = editVerdict(entry, ctx)
  const nudge = ctx.nudge(entry)
  const closed = !isOpen(entry.status)

  return [
    action('open', 'mindtree.actOpen', true, null, ids),
    write('assign', 'mindtree.actAssign', edit, ids),
    write('status', 'mindtree.actStatus', edit, ids),
    write('priority', 'mindtree.actPriority', edit, ids),
    // Two gates, and the ORDER matters: an item you may not edit reports the
    // permission, not the state. Telling somebody an item is already closed when
    // they could not have closed it anyway sends them to the wrong conclusion.
    write('done', 'mindtree.actDone', edit.ok && closed ? CLOSED_VERDICT : edit, ids),
    {
      kind: 'nudge',
      labelKey: nudge.offer === 'again' ? 'mindtree.actNudgeAgain' : 'mindtree.actNudge',
      enabled: nudge.offer !== null,
      reasonKey: nudge.offer !== null ? null : (nudge.blockedKey ?? WHY_NO_NUDGE),
      mutates: true,
      confirm: false,
      // An ask writes a notification, never a status.
      closes: false,
      targetIds: ids,
      // A nudge is an RPC, not a patch — `nudge_entry()` writes the
      // notification, the audit row and the stamp in one transaction. There is
      // no column for a caller to set, and offering one would invite a surface
      // to write `nudged_at` itself.
      patch: null,
    },
  ]
}

const EMPTY_IDS: readonly string[] = Object.freeze([])

/* ── a branch ── */

function branchActions(
  path: readonly MindNode[],
  node: MindNode,
  ctx: MindActionCtx,
): readonly MindAction[] {
  const out: MindAction[] = []

  // "Add an item here" is offered on every branch that stands for a bucket, plus
  // the root (which seeds nothing and simply opens capture). `entries_insert` is
  // `is_member() and created_by = auth.uid()` (0001, re-stated with an InitPlan
  // wrapper in 0009), so any signed-in member may create — the only refusal is
  // being signed out, and the only PRODUCT refusal is a branch that cannot hold
  // new work.
  //
  // A COHORT IS THE ONE BRANCH THAT IS NOT ON THIS LIST, and its absence is a
  // category error rather than a refusal — the distinction this function already
  // draws twice below. "Add an item to the 96 organizations Sara manages" names
  // no organization to file it under; the reader dives one ring and picks one,
  // which is one tap and unambiguous. So a cohort's menu carries the two
  // NAVIGATION verbs and nothing else: focus, and collapse.
  if (isFilingKind(node.kind) || node.kind === 'group' || node.kind === 'root') {
    const draft = node.kind === 'root' ? EMPTY_PATCH : draftAt(path, ctx.dimension)
    const why =
      ctx.meId === null
        ? WHY_SIGNED_OUT
        : draft === null
          ? draftRefusal(path, ctx.dimension)
          : null
    out.push({
      kind: 'addHere',
      labelKey: 'mindtree.actAddHere',
      enabled: why === null,
      reasonKey: why,
      mutates: true,
      confirm: false,
      // A create cannot close anything: `draftAt` seeds a NEW row.
      closes: false,
      targetIds: EMPTY_IDS,
      // The fields a capture form opens with. Never a patch against an existing
      // row — this creates, and `createEntryOptimistic` takes a NewEntry.
      patch: draft,
    })
  }

  // The bulk verb, only where a drop could LAND. Absent rather than disabled on
  // the root and on a "+N more" fold, because "apply the selection to a fold" is
  // not a refusal, it is a category error.
  //
  // ⚠ THIS IS NOT `isDropZoneKind` ANY MORE, and the divergence is deliberate
  // rather than drift. A zone is about the POINTER — a cohort arms so that a
  // drag crossing the biggest ring on the screen gets a sentence instead of
  // nothing (see that function). A menu is about a DELIBERATE ACT on a named
  // node, and every drop onto a cohort is refused, so offering "Move 12 items
  // here" greyed out would be a row that can never be anything else. The two
  // surfaces agree about what LANDS — `evaluateDrop` decides that for both — and
  // differ about what is worth showing, which is the difference between hovering
  // something on your way past it and choosing it.
  if (isFilingKind(node.kind) || node.kind === 'group') {
    out.push(selectionAction(path, node, ctx))
  }

  // Shaping the tree, between the work verbs and the two view verbs. The
  // position is deliberate: everything above changes WORK, everything below
  // changes only what is on screen, and these two sit on the seam because they
  // change the MAP — which is neither, and is the only pair here that outlives
  // the reader's session. Appending them at the end instead would put the two
  // most consequential rows under the two most reversible ones.
  out.push(...structuralActions(path, node, ctx))

  // Focus. `focusedId ?? ROOT_ID` normalises "no drill-in" to the root node, so
  // the root's own entry in the list reads as "show every track" and correctly
  // reports itself already-showing when nothing is focused.
  const focused = ctx.focusedId ?? ROOT_ID
  const hasChildren = node.children.length > 0
  out.push(
    action(
      'focus',
      'mindtree.actFocus',
      hasChildren && node.id !== focused,
      node.id === focused ? WHY_FOCUSED : hasChildren ? null : WHY_EMPTY_BRANCH,
      EMPTY_IDS,
    ),
  )

  // Collapse is meaningless without children, and a node claiming
  // `aria-expanded` with nothing under it promises a subtree nobody can reach —
  // model.visibleChildren()'s header makes the same point.
  if (hasChildren) {
    out.push(
      action(
        'collapse',
        node.collapsed ? 'mindtree.actExpand' : 'mindtree.actCollapse',
        true,
        null,
        EMPTY_IDS,
      ),
    )
  }

  return out
}

const EMPTY_PATCH: EntryPatch = Object.freeze({})

/**
 * The two verbs that edit the HIERARCHY rather than the work filed on it.
 *
 * WHY THEY ARE ON THE MAP AT ALL. Shaping the tree lived on one other screen —
 * Settings › Structure — which meant a round trip per branch: leave the picture,
 * find the row in an indented list, add, come back, check it landed where you
 * meant. The owner's sentence for this was that the map "looks static": not that
 * it does not move, but that it can only be LOOKED AT. These two verbs are the
 * answer, and they are deliberately the SAME two the settings screen offers
 * (add a child, put one away) rather than a lighter subset — a second, weaker
 * editor is how the two screens start disagreeing about what a branch is.
 *
 * SETTINGS › STRUCTURE IS NOT REPLACED AND MUST NOT BE. It is the only place an
 * archived branch is visible, which makes it the only place one is RESTORED,
 * and it owns the fields this composer has no room for: the Arabic name, the
 * kind, the account manager, re-parenting, reordering. This is the fast path for
 * the shape; that is the full editor for the detail.
 *
 * NOTHING IS OFFERED WITHOUT `structure.edit` — see `MindActionCtx`.
 */
function structuralActions(
  path: readonly MindNode[],
  node: MindNode,
  ctx: MindActionCtx,
): readonly MindAction[] {
  if (ctx.canEditStructure !== true) return EMPTY_ACTIONS
  // A status bucket, an owner bucket, a COHORT and the root are drawn branches
  // that are not PLACES: a group stands for a value inside its Org, a cohort
  // stands for a CUT of the organizations, and the root stands for the
  // workspace. Hanging a `map_nodes` row off one is a category error rather than
  // a refusal, so neither verb appears — the same distinction `branchActions`
  // already makes for `applySelection`, one ring out. "Add an ITEM here" is
  // still offered on the first and the last, and that is the difference.
  //
  // `isFilingKind` IS THE WORD FOR THIS, and this function is the sharpest
  // reason the audit needed a predicate narrower than `KIND_ROLE`: "`bucketKey`
  // is a row id" is the precondition BOTH verbs here have — `addBranch` hangs a
  // child off it, `archiveBranch` writes `archived` on it — and a cohort is a
  // `'place'` with no row. Reading the role here would have put "Add a branch"
  // on every cohort ring, pointed at the parent Org, one refactor after the kind
  // landed.
  if (!isFilingKind(node.kind)) return EMPTY_ACTIONS

  const ref = branchRefAt(path)
  const out: MindAction[] = []

  // ADD A CHILD BRANCH. Offered on a track (where the child is a level-1 node)
  // and on every Organization above the cap. `entries_insert`'s reasoning does
  // not apply here — 0023 gates `map_nodes` writes on is_admin(), and that is
  // exactly the grant this whole function is behind — so the only refusals left
  // are structural: no session, no place, a branch already put away, and the
  // depth the database is about to check.
  const addWhy = branchAddRefusal(path, ctx.meId)
  out.push({
    kind: 'addBranch',
    labelKey: 'mindtree.actAddBranch',
    enabled: addWhy === null,
    reasonKey: addWhy,
    mutates: true,
    // The composer asks for a name, which is the only question a create has;
    // asking a second time whether the reader meant to type it would be a
    // dialog in front of a text box.
    confirm: false,
    closes: false,
    targetIds: EMPTY_IDS,
    patch: null,
  })

  // ARCHIVE. ORGANIZATIONS ONLY, and the absence on a track is a category error
  // rather than a refusal: a track is a row in `tracks`, archiving one is
  // `setTrackArchived`, and it takes its whole hierarchy plus every item ever
  // filed on it with it. That is a decision for the track editor, with the
  // track editor's counts in front of it — not for a right-click on a ring.
  if (node.kind === 'entity') {
    const why =
      ctx.meId === null
        ? WHY_SIGNED_OUT
        : ref === null || ref.nodeId === null
          ? WHY_EMPTY_BRANCH
          : ref.retired
            ? // Already put away, and still drawn because it holds work.
              // model.ts renders a retired bucket rather than dropping it; this
              // is the one place that fact turns into a refusal instead of a
              // second archive that would write the value already in the column.
              WHY_RETIRED
            : null
    out.push({
      kind: 'archiveBranch',
      labelKey: 'mindtree.actArchiveBranch',
      enabled: why === null,
      reasonKey: why,
      mutates: true,
      // ALWAYS ASKS, and the counts in the question are the whole point:
      // archiving CASCADES to every descendant and that is invisible from a
      // canvas. `NodeMenu` reads `getMapNodeUsage` before it raises the dialog —
      // a destructive act that explains itself afterwards has already happened.
      confirm: true,
      // `closes` is about CLOSING WORK — it gates `dropRules.closesEntry`'s
      // sentence and the close-flavoured confirm. Archiving a branch writes no
      // status on anything; the items filed on it stay exactly as open as they
      // were and stop being drawn. Setting this true would word the question as
      // though the work had been finished.
      closes: false,
      targetIds: EMPTY_IDS,
      patch: null,
    })
  }

  return out
}

/**
 * The verb that names what this branch does to the selection. A LABEL, not a
 * rule — `evaluateDrop` decides what actually lands.
 *
 * AN ENTITY REUSES `actMoveHere` RATHER THAN MINTING A KEY. "Move here" is
 * exactly what filing items under an Organization is, and the repo has a gate
 * that objects to the alternative: lib/labelSections.test.ts fails on two keys
 * carrying one string. A separate `actFileHere` would be a second English
 * sentence and a second Arabic one to keep in step for no difference the reader
 * can perceive — and the entity ring is the same kind of re-filing the track
 * ring is, one grain finer.
 */
function selectionLabel(node: MindNode, dimension: MindDimension): string {
  if (isFilingKind(node.kind)) return 'mindtree.actMoveHere'
  if (dimension === 'owner') return 'mindtree.actAssignHere'
  if (dimension === 'priority') return 'mindtree.actPriorityHere'
  if (dimension === 'status') return 'mindtree.actStatusHere'
  return 'mindtree.actMoveHere'
}

/**
 * "Apply the ticked items to this branch" — N drops, evaluated one at a time by
 * the module that owns what a drop means.
 *
 * TWO NARROWINGS, AND BOTH ARE THE FEATURE.
 *
 *  1. Rows the viewer may not write are dropped first (`editableOf`). Running a
 *     bulk patch over rows RLS will refuse produces "12 moved, 6 failed" and
 *     leaves the reader to work out which six and why — on a screen whose whole
 *     promise is redistributing a week of work in one gesture.
 *  2. Rows ALREADY in this bucket are dropped second, via `evaluateDrop`'s
 *     `noop` arm. Writing them would bump `last_activity_at` and reset the
 *     staleness clock on work nobody touched, which is the defect R3-LEAD-1
 *     closed for handovers — and it would inflate the count in the confirm
 *     dialog above the number of items that actually move.
 *
 * THE PATCH IS TAKEN FROM THE FIRST ACCEPTED OUTCOME, not assembled here, and it
 * is the same patch for every row: `evaluateDrop`'s patch depends only on the
 * TARGET and the axis. Taking it rather than rebuilding it is what keeps the
 * owner XOR — the trap `dropRules.ownerPatch` is written to close — in exactly
 * one place.
 */
function selectionAction(path: readonly MindNode[], node: MindNode, ctx: MindActionCtx): MindAction {
  const editable = editableOf(ctx)
  const label = selectionLabel(node, ctx.dimension)

  const targetIds: string[] = []
  let patch: EntryPatch | null = null
  let refusal: string | null = null
  /**
   * Does this bulk apply CLOSE the rows it writes?
   *
   * Taken here rather than left to the surface, because this verb is the one
   * that hands its caller no `DropOutcome` to ask: it evaluates N of them and
   * keeps only the shared patch. Without this flag `NodeMenu.needsConfirm` sees
   * a null outcome and asks nothing, so nine ticked items dropped on Done close
   * silently — while DRAGGING the same nine onto the same branch asks, because
   * `DragLayer.commitDrop` computes `plan.closes` per row. One property, one
   * answer, whichever gesture reached it.
   *
   * Read off the FIRST accepted outcome for the same reason `patch` is: the
   * verdict depends on the TARGET and the axis, never on the row.
   */
  let closes = false
  for (const id of editable) {
    const outcome: DropOutcome = evaluateDrop({
      source: { kind: 'entry', entryId: id },
      entry: ctx.entryById.get(id),
      // The WHOLE path, target last — `dropRules` folds it, because ring 2 is
      // drawn inside ring 1 and a group branch means the intersection of itself
      // and its ancestors.
      path,
      dimension: ctx.dimension,
    })
    if (outcome.kind === 'patch') {
      targetIds.push(id)
      if (patch === null) {
        patch = outcome.patch
        closes = closesEntry(outcome)
      }
    } else if (outcome.kind === 'refused') {
      // The FIRST refusal, kept only for the case where nothing lands at all.
      // Every refusal here is a property of the TARGET, not of the row, so the
      // first is the same as the last.
      refusal ??= outcome.reasonKey
    }
  }

  const why =
    ctx.meId === null
      ? WHY_SIGNED_OUT
      : ctx.selection.size === 0
        ? WHY_NO_SELECTION
        : editable.length === 0
          ? WHY_NONE_EDITABLE
          : targetIds.length > 0
            ? null
            // Nothing to do is not a failure. Everything ticked is already here.
            : (refusal ?? DROP_UNCHANGED_KEY)

  return {
    kind: 'applySelection',
    labelKey: label,
    enabled: why === null,
    reasonKey: why,
    mutates: true,
    confirm: targetIds.length >= MIND_BULK_CONFIRM_AT,
    closes,
    targetIds,
    patch,
  }
}

/**
 * The ticked entries this viewer may edit, in tick order.
 *
 * Order is the reader's, not the store's: `Set` iterates in insertion order, and
 * a confirm dialog listing the first three of eighteen should name the three
 * they ticked first.
 */
export function editableOf(ctx: MindActionCtx): readonly string[] {
  const out: string[] = []
  for (const id of ctx.selection) {
    const entry = ctx.entryById.get(id)
    // A ticked id the store has dropped is silently skipped rather than counted:
    // it is a row that no longer exists, and including it would inflate the
    // number in the confirm dialog above the number that can land.
    if (entry !== undefined && canEditEntry(entry, ctx.meId, ctx.role)) out.push(id)
  }
  return out
}

// ── the shared verdict shape ───────────────────────────────────────────────

interface Verdict {
  readonly ok: boolean
  readonly reasonKey: string | null
}

const OK: Verdict = Object.freeze({ ok: true, reasonKey: null })
const CLOSED_VERDICT: Verdict = Object.freeze({ ok: false, reasonKey: WHY_CLOSED })

/**
 * May this viewer change this row, and if not, which sentence says so?
 *
 * SIGNED-OUT IS TESTED FIRST, exactly as `canEditEntryUnder` tests it first and
 * for the same reason: RLS keys every write policy off `auth.uid()`, so a null
 * id can only ever produce a rejection — and "only the person who raised this,
 * its owner, or an admin can change it" would send a signed-out reader looking
 * for an admin instead of a sign-in button.
 *
 * The second sentence is only reachable under the NARROW branch of
 * `ENTRIES_UPDATE_IS_OPEN`. It is written and shipped anyway, because that
 * constant is one line away from being flipped and the flip is documented as
 * touching exactly one line — a refusal with no sentence behind it would turn a
 * one-line policy change into a screen full of unexplained grey.
 */
function editVerdict(entry: Entry, ctx: MindActionCtx): Verdict {
  if (ctx.meId === null) return { ok: false, reasonKey: WHY_SIGNED_OUT }
  if (!canEditEntry(entry, ctx.meId, ctx.role)) return { ok: false, reasonKey: WHY_NOT_YOURS }
  return OK
}

function action(
  kind: MindActionKind,
  labelKey: string,
  enabled: boolean,
  reasonKey: string | null,
  targetIds: readonly string[],
): MindAction {
  return {
    kind,
    labelKey,
    enabled,
    reasonKey,
    mutates: false,
    confirm: false,
    closes: false,
    targetIds,
    patch: null,
  }
}

function write(
  kind: MindActionKind,
  labelKey: string,
  verdict: Verdict,
  targetIds: readonly string[],
): MindAction {
  return {
    kind,
    labelKey,
    enabled: verdict.ok,
    reasonKey: verdict.reasonKey,
    mutates: true,
    confirm: false,
    // `done` carries its value in its name and that value is a CLOSED one, so
    // the verb closes whatever it is run on. The other three pick a value in a
    // sub-menu, where the chosen row's own `DropOutcome` answers the question —
    // a `status` verb is not a closing act until Done or Cancelled is picked.
    closes: kind === 'done',
    targetIds,
    // The VALUE is chosen in the sub-menu the surface opens (which status, which
    // owner), so there is no patch to hand over yet — except for `done`, whose
    // value is in its name.
    patch: kind === 'done' ? DONE_PATCH : null,
  }
}

/**
 * 'done', not 'cancelled'. `lib/health.CLOSED_STATUSES` holds both and `isOpen`
 * is the only reader of it in this file; the menu verb "Mark as done" names one
 * of the two, and cancelling is a decision with a reason that belongs in the
 * entry sheet beside a comment box, not behind a right-click on a map.
 */
const DONE_PATCH: EntryPatch = Object.freeze({ status: 'done' })

// THE DRAG IS NOT IN THIS FILE, and that is the reconciliation rather than an
// omission. `dropRules.evaluateDrop()` decides what a drop does — including the
// `noop` arm and the owner XOR — and `drag.ts` owns the gesture. An earlier cut
// of this module carried its own `mindDropAction` and a `dropChangesAnything`
// beside it; both were deleted the moment `dropRules.ts` landed, because two
// answers to "what does this branch do to this row" is exactly the drift this
// file's header objects to in the permission rules. `selectionAction` above is
// the only caller here, and it delegates.
