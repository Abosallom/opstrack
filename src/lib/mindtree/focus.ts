// The Mindtree's DRILL-IN: which subtree is drawn, and the way back out.
//
// Focusing answers "show me just this branch". The map is a workspace overview
// and at real volume it is a wall; a lead chasing one track wants that track to
// BE the screen for a minute, then wants the wall back. Everything below is in
// service of that minute being reversible.
//
// PURE BY CONSTRUCTION, the contract model.ts and layout.ts already hold:
// no store, no clock, no locale, no `t()`, no `Math.random`. It takes a tree and
// an id and returns a different view of the same tree — it never rebuilds one,
// never copies a node, and never mutates one. `resolveFocus` returns the node
// object model.ts already made, so referential identity survives and React's
// memo comparisons downstream keep working.
//
// ── THE ONE IDEA THIS FILE IS BUILT ON ─────────────────────────────────────
//
// A MindNode id IS ITS PATH: `root/track:<id>/entity:<id>/group:<key>/entry:<id>`,
// with every dynamic segment percent-encoded (model.ts's `nodeId`) and the
// `entity:` run repeating for as many levels of the hierarchy as the branch has.
// Two consequences, and the whole module falls out of them:
//
//  1. THE ANCESTOR CHAIN OF AN ID IS COMPUTABLE FROM THE STRING, with no tree in
//     hand. `encodeURIComponent` escapes `/` as %2F, so a segment can never
//     contain one and splitting is unambiguous even when the label was an
//     Arabic track name with a slash in it.
//
//  2. WHICH IS WHY A FOCUS SURVIVES A REGROUP. Switch the dimension from status
//     to owner and every `group:` segment in the tree is replaced — the focused
//     id `root/track:X/entity:Org1/group:blocked` now names nothing. But its
//     PREFIX `root/track:X/entity:Org1` still names the same organization,
//     because the STRUCTURAL rings — the track and everything hanging off it —
//     do not depend on the dimension. So the fallback is not a guess or a
//     heuristic: it is the longest prefix of the requested id that still exists.
//     The reader lands in the branch they were inside, one ring out, rather than
//     on a blank screen or back at the top of the map.
//
// THE FALLBACK IS THE FEATURE, not the error path. A focus id reaches this
// module from three places that can all go stale under the reader: a URL somebody
// pasted from last week, a dimension switch, and a realtime close that empties
// the branch mid-look. `resolveFocus` is TOTAL — every input produces a drawable
// view — and it reports what it had to do in `missingId` so the surface can say
// so out loud instead of silently teleporting the reader.
//
// NEVER A BLANK SCREEN. Two rules enforce it: the fallback above, and the
// childless rule in `canFocus` — focusing a node with nothing under it is a
// request to draw one card, which is not a view of anything. Such a request
// falls back to the parent, so `?focus=<some entry leaf>` degrades to the group
// that holds it rather than to a single node floating in an empty canvas.
//
// WITH ONE EXCEPTION, AND IT IS AN EXCEPTION OF KIND RATHER THAN OF DEGREE. An
// `entity` node is a PLACE — an organization being onboarded — and focusing it
// opens a panel of facts about that place (its account manager, its use-case
// matrix, its vendor) which exist whether or not any work is filed under it. The
// canvas stopped being the whole view when the panel arrived; "an empty canvas"
// is now half a screen beside a full one, and an Org with zero open issues is
// precisely the Org somebody wants to inspect. See `canFocus`.

import {
  isMindDimension,
  KIND_ROLE,
  ROOT_ID,
  visibleChildren,
  type MindDimension,
  type MindNode,
  type MindNodeKind,
} from './model'

// ── the view ───────────────────────────────────────────────────────────────

/**
 * What the surface draws, and what it says about how it got there.
 *
 * One object rather than four returns because the four are only correct
 * TOGETHER: `node` and `trail` must describe the same focus, and `focusId` must
 * be the id `trail`'s last element actually carries — not the one that was
 * asked for. Splitting them is how a breadcrumb ends up pointing somewhere the
 * canvas is not.
 */
export interface FocusView {
  /**
   * The subtree to draw. The whole tree when nothing is focused.
   *
   * The SAME object model.ts built, never a copy — see the header. A caller may
   * hand this straight to `layoutMindtree` and to the accessible table, and the
   * two will agree because they are looking at one object.
   */
  node: MindNode
  /**
   * Root → focused node, INCLUSIVE, in reading order. Exactly `[root]` when
   * nothing is focused.
   *
   * Inclusive because the last element is what the crumb bar renders as the
   * CURRENT heading, and a breadcrumb that excluded its own destination would
   * make every consumer re-find the node it was just handed. A crumb bar renders
   * `trail.slice(0, -1)` as links and the tail as the heading; "up one ring" is
   * `trail.at(-2)`.
   */
  trail: readonly MindNode[]
  /**
   * The id ACTUALLY focused, after any fallback. Null when the whole map is
   * drawn — which is what the URL codec writes as "no focus param at all", so
   * an unfocused map has a clean URL.
   */
  focusId: string | null
  /**
   * The id the caller ASKED for, when it no longer resolves and a fallback was
   * taken. Null on the happy path AND when nothing was requested.
   *
   * Present so the surface can be honest: a reader whose branch vanished under
   * them deserves "that branch is gone — showing ⟨parent⟩" in the live region,
   * not a canvas that silently changed shape. It is deliberately the RAW
   * requested id and not a label, because the node it named no longer exists to
   * carry one.
   */
  missingId: string | null
}

/** The unfocused view of a tree. Allocation-free for the common case. */
function wholeMap(root: MindNode, missingId: string | null): FocusView {
  return { node: root, trail: [root], focusId: null, missingId }
}

/**
 * Resolve a requested focus against the tree as it is RIGHT NOW.
 *
 * TOTAL over every input, including ids from a hand-edited URL and ids that were
 * valid one render ago. The resolution order is:
 *
 *   1. Nothing requested (null, empty, or the root itself) → the whole map.
 *   2. The id names a focusable node → that node.
 *   3. Otherwise → the DEEPEST focusable ancestor named by a prefix of the id,
 *      with `missingId` set. Falls all the way back to the whole map if no
 *      prefix survives.
 *
 * Step 3 is the regroup and the stale-link case, and it is why this returns a
 * view rather than `MindNode | null`: a caller handed null would have to invent
 * the recovery, and every caller would invent a different one.
 */
export function resolveFocus(root: MindNode, requested: string | null): FocusView {
  if (requested === null || requested === '' || requested === root.id) return wholeMap(root, null)

  const trail = trailTo(root, requested)
  if (trail !== null && canFocus(trail[trail.length - 1])) {
    return { node: trail[trail.length - 1], trail, focusId: requested, missingId: null }
  }

  // The requested node is gone, or is there but has nothing under it. Walk its
  // own path outward — `root/t/g/e` → `root/t/g` → `root/t` → `root` — and take
  // the first ancestor that is both present and worth drawing.
  for (const id of ancestorIdsOf(requested)) {
    if (id === root.id) break
    const up = trailTo(root, id)
    if (up !== null && canFocus(up[up.length - 1])) {
      return { node: up[up.length - 1], trail: up, focusId: id, missingId: requested }
    }
  }
  return wholeMap(root, requested)
}

/**
 * Is this node worth making the whole screen?
 *
 * THE SHAPE RULE FIRST, and it is still the default. A `more` fold has children
 * and focusing it ("show me the tail") is a legitimate view; an `entry` leaf has
 * none and focusing it would draw a single card on an empty canvas. An empty
 * active track lands there too, and correctly: model.ts draws it because "which
 * track has nothing on it" is worth seeing ON the map, but a screen containing
 * only that node answers nothing. Keying on shape rather than kind is what lets
 * a new node kind inherit the right behaviour without editing this function.
 *
 * THEN THE ONE KIND THAT OVERRIDES IT. An `entity` node — an organization, a
 * phase, a programme in the hierarchy below the track — is a PLACE, not a
 * bucket, and the difference is what its focus DRAWS. A group with nothing in it
 * has nothing to say; an Org with nothing in it has an account manager, a
 * vendor, and a use-case matrix reading "6 of 9 live", none of which depend on
 * any work being filed there. That is the whole shape of the question "which Org
 * is behind?" — and an Org with zero open issues is one of the answers.
 *
 * THIS FUNCTION'S HEADER USED TO ARGUE THE OPPOSITE, and the argument was sound
 * when the canvas was the entire view. It is not any more: the panel is half the
 * screen, so "a single card on an empty canvas" is no longer a description of
 * what a childless entity focus produces. The shape rule was never about
 * childlessness for its own sake — it was about landing the reader somewhere
 * that answers nothing. An entity always answers something.
 *
 * A childless entity is still reachable by fallback in the other direction: a
 * stale `entity:` id that names nothing at all fails `trailTo` and climbs, so
 * this exception widens what may be focused, never what may be invented.
 */
export function canFocus(node: MindNode): boolean {
  return node.children.length > 0 || isPlaceKind(node.kind)
}

/**
 * Node kinds that are PLACES — see `canFocus`.
 *
 * A TOTAL RECORD RATHER THAN A COMPARISON, and that is the wave-6 lesson written
 * into the smallest function it applies to. `kind === 'entity'` absorbs every
 * kind that is ever added and switches the exception off for it in silence; a
 * `Record<MindNodeKind, …>` is a compile error until somebody decides. The union
 * grew by one this wave and this is the shape that made the decision unavoidable
 * rather than the shape that would have hidden it.
 *
 * ⚠ NOT `KIND_ROLE[kind] === 'place'`, and the difference is the question. The
 * role table answers "is this structure, may the camera frame it", which is true
 * of the ROOT and of a TRACK as well — and neither belongs in this exception.
 * This asks the narrower one `canFocus` needs: "does framing this node still
 * answer something when it holds nothing". An Organization does (an account
 * manager, a vendor, a capability matrix). A COHORT does too, one ring out —
 * "the 41 organizations on Integrating" is an answer whether or not any work is
 * filed under them, and the cohort ring is the picture of it. A `track` does not
 * (model.ts draws an empty one so that "which track has nothing on it" is
 * visible ON the map, which is a different claim from "make it the screen"), and
 * the root is the workspace rather than a place in it.
 */
const ANSWERS_WHEN_EMPTY: Readonly<Record<MindNodeKind, boolean>> = Object.freeze({
  root: false,
  track: false,
  entity: true,
  cohort: true,
  group: false,
  more: false,
  entry: false,
})

function isPlaceKind(kind: MindNodeKind): boolean {
  return ANSWERS_WHEN_EMPTY[kind]
}

// ── where the map opens ────────────────────────────────────────────────────
//
// THE ROOT IS NOT A LEGIBLE OPENING FRAME AND CANNOT BE MADE ONE, and that is
// arithmetic rather than a bug. worlds.ts's own table gives a six-wide tier a
// parent/child diameter ratio of 3.83 — 1.94 octaves — so a five-tier workspace
// spans eleven octaves and a camera that shows the whole of it cannot show an
// organization. Measured on the 400-organization fixture at the shipped opening
// camera: `children[1]: card=1`, and the account manager's six type cards are
// four tiers below the frame at 0.086 px of text.
//
// So the map opens on THE READER'S OWN WORLD. Everything below is the pure half
// of that: which node id the opening camera should be struck around, given the
// tree and who is looking at it. `useMapFocus` calls it where the persisted
// focus default currently resolves, and the precedence there is the whole of the
// feature's politeness:
//
//     ?focus= in the URL   beats   the persisted focus
//     the persisted focus  beats   this resolver          ← yesterday's dive wins
//     this resolver        beats   ROOT_ID                ← and this is new
//
// NEVER PERSISTED. A default that wrote itself into the store would stop being a
// default after one paint and would then travel into `?focus=` on the next
// mirror pass — so a link somebody shared would carry the SENDER's book to the
// recipient. `useMapFocus` only writes back on `missingId !== null`, and this
// resolver returns ids that resolve, which is asserted in focus.test.ts.

/**
 * Node kinds the dive may enter — worlds.ts's `STRUCTURAL_KINDS`, restated.
 *
 * RESTATED RATHER THAN IMPORTED because worlds.ts declares it privately and
 * because the two are answering different questions off the same list: worlds.ts
 * asks "may the camera stop here", this asks "is this a ring of the workspace or
 * content drawn inside one". They agree today and a divergence would be a
 * defect, which is why the set is spelled the same way.
 *
 * ── AND IT IS NOW `KIND_ROLE`, WHICH IS WHAT THE ROLE TABLE IS FOR ──────────
 *
 * `kind === 'root' || kind === 'track' || kind === 'entity'` was one of the
 * twenty-seven `===` chains wave 6 converted, and it was among the worst of
 * them: it does not red when the union grows, it answers `false` for the new
 * kind, and `false` here means a cohort ring the camera cannot stop on, a
 * breadcrumb that skips it, and a `?focus=` that climbs past it — the whole
 * feature, silently absent. `KIND_ROLE`'s `'place'` IS this list (model.ts says
 * so where it declares the table), so this is now one lookup that cannot be
 * forgotten instead of three comparisons that were.
 *
 * A `cohort` IS ENTERED. "The 96 organizations Sara manages" is a ring of the
 * workspace: the camera stops on it, the breadcrumb names it, and the dive goes
 * through it to the organizations inside. That is the entire argument for the
 * kind existing — see worlds.ts's `STRUCTURAL_KINDS` and the design's §1.6.
 *
 * ⚠ DIVEABLE IS NOT FILEABLE. `dropRules.isFilingKind` is the narrower table —
 * `track` and `entity`, the two kinds whose `bucketKey` is a row id — and a
 * cohort is the node that proves the two questions are different: you may fly
 * into one and you may not file anything on one.
 *
 * Exported for `pages/map/useMapKeyboard.isDiveTarget`, which asked the same
 * question with a third copy of the comparison and would have been a third site
 * to forget. It stays a FUNCTION rather than a re-export of the table so this
 * file keeps naming the question it is asking.
 */
export function isStructuralKind(kind: MindNodeKind): boolean {
  return KIND_ROLE[kind] === 'place'
}

/**
 * Roles that open on the WORKSPACE rather than on a book of their own.
 *
 * An admin or an owner reading this map is running the programme, not working a
 * cohort; framing them on the two organizations that happen to name them is
 * worse than framing them on the whole of Onboarding. That is the design's own
 * table — *admin / owner → the Onboarding track world* — and it is the only
 * thing `role` decides here.
 *
 * `'owner'` is not a `UserRole` at this commit (`types.ts:44` is
 * `'admin' | 'member'`) and is listed anyway: 0025 moved authority onto
 * `role_id`/`has_perm`, the role NAME is what a surface will hand this, and a
 * set that has to be edited to keep working when the workspace names its top
 * role is a set that will be edited late.
 */
const WORKSPACE_ROLES: ReadonlySet<string> = new Set(['admin', 'owner'])

/**
 * WHERE THE MAP OPENS FOR THIS READER — a node id, or null for "the drawn root",
 * which is the caller's own fallback and the answer when the reader owns nothing
 * and the workspace has nothing narrower to offer.
 *
 * PURE, TOTAL, and no store: it takes the tree the surface already built and the
 * two facts about the reader that `useMapModel` already returns.
 *
 * ── TWO WAYS A NODE CAN BE YOURS, and they are the two the workspace spells ──
 *
 *  1. IT IS YOU. `MindNode.bucketKey` carries "a track id, a map-node id, a
 *     status key, AN OWNER KEY" (model.ts:196) — so a bucket cut on a PERSON
 *     carries that person's member id, and `bucketKey === meId` is "this ring is
 *     my book" with no lookup at all. That is exactly what wave 6's
 *     `?by=manager` cohort node will be, and it is what the render gate's `am:`
 *     tier stands in for.
 *  2. IT NAMES YOU. `managerOf(bucketKey)` is `map_nodes.account_manager_id` for
 *     a real hierarchy node. It is an ARGUMENT and not a field on the tree
 *     because `useMapModel.ts:250` deliberately drops that column on the way in
 *     — "a node's integrator is a fact the PANEL shows, and a model that carried
 *     it would invalidate the whole tree every time somebody typed a character
 *     into that field" — and this module may not reach a store to go and find
 *     it. Omitted, the resolver simply finds fewer nodes. It never guesses.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 *
 * Mark every structural node that is yours by either test, WITHOUT descending
 * past a mark (a mark's whole subtree is one book, not a book per organization).
 * Then walk down from the root for as long as ONE child still holds every mark.
 * That lands on:
 *
 *   · your own node, when you have one — an account manager on their cohort;
 *   · the smallest world containing your whole book, when it is spread — an
 *     associate director on their span;
 *   · the workspace opening (below) when nothing is yours.
 *
 * The descent stops OUTSIDE a childless node, because a camera framed on one
 * card is not an opening. An account manager whose entire book is one
 * organization therefore opens on the ring that organization sits in, which is
 * their cohort by another road.
 *
 * ── WHAT THIS CANNOT DO YET, NAMED RATHER THAN FUDGED ───────────────────────
 *
 * An ASSOCIATE DIRECTOR has no column. `map_nodes` carries `account_manager_id`
 * and nothing else about people, so an AD is found only when the AD tier is
 * itself a node they own (test 1) or when a future `managerOf` answers for them.
 * Until then an AD lands on the workspace opening, which is the whole of
 * Onboarding — one ring wider than their span and never wrong.
 */
export function defaultFocusFor(
  meId: string | null,
  role: string,
  tree: MindNode,
  managerOf?: (bucketKey: string) => string | null,
): string | null {
  const workspace = workspaceOpeningId(tree)
  if (meId === null || meId === '' || WORKSPACE_ROLES.has(role)) return workspace

  const owns = (node: MindNode): boolean => {
    const key = node.bucketKey
    if (key === null || key === '' || !isStructuralKind(node.kind)) return false
    if (key === meId) return true
    return managerOf !== undefined && managerOf(key) === meId
  }
  const marks = (node: MindNode): number => {
    if (owns(node)) return 1
    let total = 0
    for (const child of node.children) total += marks(child)
    return total
  }

  const total = marks(tree)
  if (total === 0) return workspace

  let at = tree
  for (;;) {
    let next: MindNode | null = null
    for (const child of at.children) {
      if (marks(child) === total) {
        next = child
        break
      }
    }
    // A childless node is a card, not a picture — stop one ring out. `at` is
    // reached only through a child that held every mark, so it always has
    // children and `canFocus` is satisfied by shape.
    if (next === null || next.children.length === 0) break
    at = next
  }
  return at === tree ? workspace : at.id
}

/**
 * THE WORKSPACE'S OWN OPENING WORLD — the deepest ring that still shows
 * everything, which is the design's *"admin / owner → the Onboarding track
 * world"* row written so that it does not have to know the word "Onboarding".
 *
 * A CHAIN OF SINGLE CHILDREN IS NOT A PICTURE. `root` draws a pill and one
 * track; framing it spends the entire screen saying "there is one track", and
 * the reader has to dive once before the map has told them anything. So the
 * opening descends while there is EXACTLY ONE structural child, and stops at the
 * first ring that branches — which on this workspace is the Onboarding track
 * world holding its two directorates, and on a two-track workspace is the root,
 * unchanged.
 *
 * ⚠ AN EMPTY TRACK COUNTS AS A BRANCH. model.ts draws a track with nothing on it
 * because "which track has nothing on it" is worth seeing ON the map, and a
 * descent that skipped past it because it holds no children would delete that
 * answer from the opening frame. The `children.length` test below is on the node
 * being descended INTO — a lone child with nothing under it is one card, and one
 * card is not an opening — never on its siblings.
 *
 * Null when it never moved: null is "the drawn root", so an unfocused map keeps
 * its clean URL and its existing behaviour rather than gaining a `?focus=` that
 * says the same thing.
 */
function workspaceOpeningId(tree: MindNode): string | null {
  let at = tree
  for (;;) {
    let only: MindNode | null = null
    let count = 0
    for (const child of at.children) {
      if (!isStructuralKind(child.kind)) continue
      count += 1
      if (count > 1) break
      only = child
    }
    if (count !== 1 || only === null || only.children.length === 0) break
    at = only
  }
  return at === tree ? null : at.id
}

// ── the tree walks ─────────────────────────────────────────────────────────

/**
 * Depth-first search by id.
 *
 * Exported because pulse.ts and the surface both need it and three copies of a
 * four-line walk is three chances for one of them to stop honouring `collapsed`
 * differently. Walks `children`, NOT `visibleChildren` — a focus target inside a
 * collapsed branch is still a real node, and collapsing is a rendering decision
 * (model.ts's MindNode.children says so).
 */
export function findNode(root: MindNode, id: string): MindNode | null {
  if (root.id === id) return root
  for (const child of root.children) {
    const hit = findNode(child, id)
    if (hit !== null) return hit
  }
  return null
}

/**
 * Root → `id` inclusive, or null when there is no such node.
 *
 * Null rather than `[]` for "not found", because `[]` and "found the root" are
 * different answers that an `if (trail.length)` cannot tell apart — a bug the
 * page's own `pathTo` was one refactor away from.
 */
export function trailTo(root: MindNode, id: string): MindNode[] | null {
  if (root.id === id) return [root]
  for (const child of root.children) {
    const below = trailTo(child, id)
    if (below !== null) {
      below.unshift(root)
      return below
    }
  }
  return null
}

// ── the string walk ────────────────────────────────────────────────────────

/**
 * The ancestor ids of a node id, DEEPEST FIRST, excluding the id itself.
 *
 * Pure string arithmetic — no tree — which is exactly what makes it useful on an
 * id whose node has ALREADY GONE (see the header, consequence 2). `root/t/g/e`
 * yields `['root/t/g', 'root/t', 'root']`.
 *
 * Safe to split on `/` because model.ts percent-encodes every dynamic segment,
 * so no segment can contain one.
 */
export function ancestorIdsOf(id: string): string[] {
  const out: string[] = []
  let at = id.lastIndexOf('/')
  while (at > 0) {
    const up = id.slice(0, at)
    out.push(up)
    at = up.lastIndexOf('/')
  }
  return out
}

/**
 * The part of a focus id that SURVIVES A CHANGE OF DIMENSION.
 *
 * THE STRUCTURAL RINGS ARE AXIS-INDEPENDENT; the axis rings are not. `track:` is
 * ring 1 and `entity:` is every ring the hierarchy hangs below it — both are
 * spelled by the SHAPE of the workspace, which a dimension chip does not touch.
 * Everything from the first `group:` outward is cut on the axis, so a `group:`
 * segment spelled under `status` names nothing under `owner`. This trims to the
 * deepest prefix that is still meaningful — `root/track:X/entity:OB/entity:Org1`
 * where there is a hierarchy, `root/track:X` where there is not — and returns
 * null when nothing above the axis is left.
 *
 * KEEPING `entity:` IS NOT A REFINEMENT, IT IS THE SAME BUG AS THE ORIGINAL ONE.
 * A reader standing in `…/entity:Org1/group:blocked` who flips the chip would
 * otherwise be trimmed all the way back to the TRACK — three rings out, past the
 * OB phase and past the Org — which is precisely the teleport the paragraph
 * below was written to stop, just at a larger radius. It would also fail
 * SILENTLY: `resolveFocus` finds the track, draws it, and reports no fallback,
 * so nothing on screen says the reader was moved.
 *
 * WHY IT EXISTS AT ALL, when `resolveFocus` already recovers: because the call
 * site that drops a focus on regroup was clearing it to NULL, and null is not
 * the same answer as the surviving prefix. They differ by exactly one ring, and
 * this file's header names the wrong one out loud — "rather than on a blank
 * screen OR BACK AT THE TOP OF THE MAP". A lead two rings inside SRE who flips
 * the axis to see status should still be inside SRE. Trimming HERE rather than
 * leaning on the fallback also keeps the regroup silent: `resolveFocus` reports
 * a fallback in `missingId`, and a surface that says "that branch is no longer
 * here" about a change the reader just asked for is telling them off for it.
 *
 * Pure string arithmetic, like `ancestorIdsOf` — no tree, because the tree it
 * would be asked about is the one that has not been rebuilt yet.
 */
export function dimensionStableId(id: string | null): string | null {
  if (id === null || id === '') return null
  const parts = id.split('/')
  const kept: string[] = []
  for (const part of parts) {
    // `root`, `track:`, `entity:` and `cohort:` are axis-independent — they are
    // the tree's SHAPE. `group:`, `more` and `entry:` are not: a group IS the
    // axis, and both of the others are drawn inside one.
    //
    // A COHORT IS CUT BY `?by=`, WHICH THIS CHIP DOES NOT TOUCH. Flipping
    // Status → Owner re-buckets the ENTRIES under an organization and leaves
    // every cohort ring exactly where it was, so breaking at one throws an
    // account manager standing in their own book back to the track — past their
    // cohort, past the type ring, past the organization. Three rings, and
    // silently: trimming reports no fallback (that is the point of trimming
    // rather than leaning on `resolveFocus`), so nothing on screen would say the
    // reader had been moved. At 400 organizations every focus below the track
    // ring has a `cohort:` segment in it, so this is the ordinary case.
    if (
      part !== ROOT_ID &&
      !part.startsWith('track:') &&
      !part.startsWith('entity:') &&
      !part.startsWith('cohort:')
    ) {
      break
    }
    kept.push(part)
  }
  if (kept.length <= 1) return null
  return kept.join('/')
}

/**
 * The deepest id at or above `id` that satisfies `keep` — the shared primitive
 * behind the focus fallback and pulse.ts's "which drawn node represents this?".
 *
 * Takes a predicate over ids rather than nodes so a caller can test membership
 * of a precomputed Set (pulse.ts builds one of drawn ids) without a tree walk
 * per candidate.
 */
export function nearestId(id: string, keep: (candidate: string) => boolean): string | null {
  if (keep(id)) return id
  for (const up of ancestorIdsOf(id)) if (keep(up)) return up
  return null
}

/**
 * WHERE FOCUS GOES AFTER A WRITE MOVED A ROW.
 *
 * A MindNode id IS its bucket path, so any successful drop or menu act rewrites
 * the id of the row it moved — the `<g role="treeitem">` carrying DOM focus
 * unmounts, and the browser drops focus to `<body>`. The surface owes the reader
 * their place back, and this is the rule for finding it. THREE ANSWERS, IN
 * ORDER, and the order is the whole content:
 *
 *  1. The node now drawing that entry. The ordinary case: the row moved between
 *     buckets and the reader should follow it, which is what makes "drop it and
 *     keep going" a gesture rather than a round trip via the top of the map.
 *  2. The nearest surviving ancestor of where it USED to be. A close removes the
 *     row from the map entirely (the map draws open work), so there is no node
 *     to follow — but the branch it was under is still the reader's place, and
 *     `nearestId` already computes exactly this from the string.
 *  3. `null`, meaning "the caller's own fallback" — the top of the map, which is
 *     where the browser would have left them anyway.
 *
 * PURE, and separated from the page for that reason: the decision is three
 * lines of ordering that has to be right on a screen a keyboard reader is
 * steering, and pages/Mindtree.tsx cannot be exercised in this repo's `node`
 * test environment.
 */
export function refocusTarget(
  drawn: readonly { readonly id: string; readonly entryId: string | null }[],
  want: { readonly entryId: string; readonly fromId: string | null },
  has: (id: string) => boolean,
): string | null {
  const moved = drawn.find((p) => p.entryId === want.entryId)
  if (moved !== undefined) return moved.id
  if (want.fromId === null) return null
  return nearestId(want.fromId, has)
}

/**
 * Every node id the surface is currently DRAWING — `visibleChildren` order, with
 * collapsed branches included but their contents excluded.
 *
 * A collapsed node is itself on screen; its descendants are not. That asymmetry
 * is the whole point: it is what lets pulse.ts light the branch that a change
 * happened UNDER rather than a leaf nobody can see.
 */
export function drawnIds(root: MindNode): Set<string> {
  const out = new Set<string>()
  const stack: MindNode[] = [root]
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    out.add(node.id)
    for (const child of visibleChildren(node)) stack.push(child)
  }
  return out
}

// ── the URL ────────────────────────────────────────────────────────────────
//
// A focused view is a LINK. That is most of why focus is worth building as its
// own module: "look at Network, it is carrying nine of the eleven overdue items"
// is a sentence an ops lead sends in chat, and it should arrive as the picture
// rather than as instructions for reproducing it.
//
// The shape follows lib/entryFilter.ts's round-trip exactly, because the two
// codecs write into ONE URLSearchParams and disagreeing about conventions is how
// a shared link loses half of what the sender was looking at:
//   · neutral state is OMITTED, so an unfocused map has a clean URL;
//   · every value is VALIDATED on the way in and dropped if it does not parse,
//     because this runs on whatever is in the address bar;
//   · the caller writes with `replace`, never push (FollowUps.tsx says why).

const P = {
  focus: 'focus',
  dim: 'dim',
} as const

/**
 * What a shared Mindtree link carries beyond the filter.
 *
 * THE DIMENSION TRAVELS WITH THE FOCUS, and it has to. A focus id contains a
 * `group:` segment whose meaning is defined by the active dimension — `blocked`
 * under status, a member uuid under owner. Send `?focus=root/track:X/group:blocked`
 * to somebody whose persisted preference is `owner` and the group segment
 * resolves to nothing; the fallback above saves them from a blank screen, but
 * they still land one ring out from what the sender was pointing at. Carrying
 * `dim` makes the link reproduce what the sender actually saw.
 *
 * Null means "the URL has no opinion" — NOT a default. The surface keeps its
 * persisted preference in that case, so opening /mindtree from the nav does not
 * reset a choice the reader made yesterday.
 *
 * NAMED `...UrlView` and not `MindtreeView` deliberately: store/mindtree.ts
 * already owns that name for `'map' | 'table'`, and pages/Mindtree.tsx imports
 * from both modules. Do not "tidy" this back.
 */
export interface MindtreeUrlView {
  focusId: string | null
  dimension: MindDimension | null
}

/**
 * Write the view into an existing params object — typically the one
 * `filterToParams(filter)` just produced.
 *
 * Takes a base and returns a NEW params rather than mutating, so a caller can
 * compose without worrying about whose object it was handed.
 */
export function viewToParams(base: URLSearchParams, view: MindtreeUrlView): URLSearchParams {
  const p = new URLSearchParams(base)
  if (view.focusId !== null && view.focusId !== '' && view.focusId !== ROOT_ID) {
    p.set(P.focus, view.focusId)
  } else {
    p.delete(P.focus)
  }
  if (view.dimension !== null) p.set(P.dim, view.dimension)
  else p.delete(P.dim)
  return p
}

/**
 * Read the view back. TOTAL over any params — an unparseable value is DROPPED,
 * never thrown on.
 *
 * `resolveFocus` would survive a garbage focus id anyway (it simply matches
 * nothing and falls back to the whole map), so the validation here is not about
 * crash-safety. It is about not carrying attacker-shaped text around the app: a
 * node id becomes a DOM id and an `aria-activedescendant` value downstream, and
 * the cheapest place to guarantee it looks like a node id is the boundary where
 * it enters.
 */
export function viewFromParams(p: URLSearchParams): MindtreeUrlView {
  const raw = p.get(P.dim)
  return {
    focusId: parseFocusId(p.get(P.focus)),
    dimension: isMindDimension(raw) ? raw : null,
  }
}

/**
 * A node id's grammar, per model.ts's `nodeId`: `root` followed by
 * `track:`/`entity:`/`group:`/`entry:` segments carrying percent-encoded values,
 * plus the bare `more` fold.
 *
 * THE VALUE MAY BE EMPTY, which is not sloppiness — `NO_VALUE` is the empty
 * string, so the untracked pile is literally `root/track:` and the unassigned
 * bucket is `.../group:`. A stricter pattern would drop a focus on the two
 * buckets an ops lead cares most about.
 *
 * `more` KEEPS ITS BARE FORM. It is the one segment with no value to carry — a
 * fold is identified by its position, not by a key — and `.../more` is the id
 * model.ts actually mints. Nothing about the hierarchy changes that.
 *
 * `cohort:` IS HERE BECAUSE A COHORT IS A WORLD, AND A WORLD IS SHAREABLE. This
 * is the one line without which wave 6 would have shipped a silent defect: a
 * cohort is in `STRUCTURAL_KINDS`, so the camera stops on one and `useMapUrl`
 * mirrors it into `?focus=` — and a grammar that did not know the word would
 * have rejected the id on the way back in, which does not fall back loudly. It
 * fails to `wholeMap` with `missingId` NEVER SET (a rejected id never reaches
 * `resolveFocus`), so the link somebody pasted opens the whole map with nothing
 * on screen saying why. Exactly the shipping bug `MAX_SEGMENTS` was raised from
 * 6 to fix, one grammar rule further out.
 *
 * The character class is exactly what `encodeURIComponent` can emit — so a
 * cohort's key may carry its axis and its value in one segment
 * (`cohort:manager%3A<uuid>`) without a new rule here.
 */
const SEGMENT = /^(?:(?:track|entity|cohort|group|entry):[A-Za-z0-9\-_.!~*'()%]*|more)$/

/**
 * THE TWO BOUNDS ARE ONE DECISION, and the decision is the database's.
 *
 * 0023's `map_node_depth` trigger caps the hierarchy at SIX levels below the
 * track, so the deepest id this app can mint is
 *
 *     root · track: · entity: ×6 · group: · more · entry:
 *     ─┬──   ──┬───   ───┬────     ──┬───   ─┬──   ──┬───
 *      1   +   1    +    6      +    1    +  1   +   1     = 11 segments
 *
 * That plus one was `MAX_SEGMENTS = 12`, so the parser rejects only ids the
 * schema could not have produced. THE OLD VALUE OF 6 WAS A SHIPPING BUG, not a
 * conservative margin: Aziz's own example path,
 * `root/track:UHR/entity:OB/entity:Org1/group:blocked/entry:X`, is EXACTLY six,
 * so one further level of nesting made `parseFocusId` return null — and a
 * rejected id never reaches `resolveFocus`, so `missingId` is never set and the
 * shared link opens the whole map with nothing on screen saying why.
 *
 * ── AND WAVE 6 ADDED A SECOND TERM, WHICH IS WHY THIS NUMBER MOVED AGAIN ────
 *
 * `groupEntities` inserts `cohort:` segments between a structural node and the
 * organizations under it, and it RECURSES: a bucket still over the ring cap is
 * re-cut by the next key in the grouping ladder. The ladder is four keys long
 * (stage · manager · type · vendor), each spendable once, so one grouping site
 * can nest at most four cohorts — and there is a grouping site at the track and
 * at each of the six entity levels the depth trigger allows:
 *
 *     7 grouping sites × 4 ladder keys = 28 cohort segments, worst case
 *
 * 11 + 28 = 39, plus one, is 40. It takes only 25 organizations that agree on
 * all four keys to exhaust the ladder at one site, so this is not a decorative
 * margin — it is the same rule as before ("reject only what the schema could not
 * have produced") applied to a schema that now has cohorts in it. The cost of
 * being wrong in this direction is a shared link that silently opens the whole
 * map; the cost of being wrong in the other is an ancestor walk over 40 short
 * strings.
 *
 * The length follows from the same arithmetic. The widest segment is a `group:`
 * carrying a percent-encoded owner name (`group:` + up to ~3× a display name);
 * twelve segments of a uuid-bearing worst case was ~520 characters, and a cohort
 * segment measures 62 at its widest axis word: `cohort:` plus `cohortKeyOf`'s own `cohort:<axis>:<uuid>`
 * with its colons percent-encoded (model.ts:746, `nodeId` at :789). 28 of those
 * is ~1 740, for ~2 260 all told. 4 096 keeps the same clear factor of two while
 * still being far too short for a query string to make the walk interesting.
 *
 * `store/mindtree.ts`'s `MAX_NODE_ID` is the same number for the same reason —
 * it bounds persisted collapse ids, which are these ids. Move them together.
 */
const MAX_FOCUS_LEN = 4096
const MAX_SEGMENTS = 40

function parseFocusId(raw: string | null): string | null {
  if (raw === null || raw === '' || raw.length > MAX_FOCUS_LEN) return null
  const parts = raw.split('/')
  if (parts.length > MAX_SEGMENTS) return null
  if (parts[0] !== ROOT_ID) return null
  // `root` alone is the unfocused view, which is written as no param at all.
  if (parts.length === 1) return null
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i]
    if (part === undefined || !SEGMENT.test(part)) return null
  }
  return raw
}
