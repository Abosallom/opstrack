// THE KEYBOARD, AND THE ONE ACT BOTH IT AND THE POINTER PERFORM.
//
// Extracted from pages/Mindtree.tsx unchanged. It is called AFTER
// `useMindDragLayer`, because `onKeyDown` asks the controller first; the cursor
// state it drives lives in useMapCursor, which is called before the controller.
//
// ── THE KEYBOARD IS THE FEATURE, NOT THE FALLBACK ──────────────────────────
//
// The drawing is `role="tree"` with `role="treeitem"` nodes carrying
// `aria-level`/`aria-posinset`/`aria-setsize`, a roving tabindex, and the APG
// tree walk: Down/Up move to the next and previous VISIBLE node (not the next
// sibling — that is the pattern every tree widget a user has met behaves like),
// Right opens a branch and then steps into it, Left closes it and then steps
// out, Home/End jump to the ends, Enter opens an entry. RIGHT AND LEFT SWAP IN
// ARABIC, because "toward the children" is an inline-end concept and the
// drawing already mirrored; an arrow key that pointed at the trunk in one
// language and at the leaves in the other would be the single most disorienting
// thing on this screen.
//
// ── SPACE AND ENTER: THE ONE COLLISION, RESOLVED BY NODE KIND ──────────────
//
// Two standards meet on this screen and both are right. The APG TREE pattern
// says Space and Enter both activate the focused item. The APG DRAG-AND-DROP
// pattern says Space picks the focused item up. Before the interactive build,
// Space and Enter were synonyms here (`case 'Enter': case ' ':`). They can no
// longer be.
//
// THE RULE IS THE NODE'S KIND, NOT THE READER'S PERMISSIONS:
//
//   on a BRANCH (root, track, group, "+N more")   Space === Enter === open or
//                                                 close this branch. Space never
//                                                 grabs, because dropRules
//                                                 refuses a branch drag by name
//                                                 — a bulk re-file with no undo.
//   on an ITEM (an entry leaf)                    Enter opens it. Space GRABS
//                                                 it, always — and when this
//                                                 reader may not move this item,
//                                                 Space says why in the live
//                                                 region and does nothing else.
//
// The "and does nothing else" is the load-bearing half, and it is this file's
// addition rather than DragLayer's. DragLayer's `handleKeyDown` returns false on
// an item it cannot lift, which would have left the key falling through to
// "open the entry" — and THAT is the shape the brief rules out: a key that moves
// an item you own and opens an item you do not. So a leaf swallows Space
// whatever the answer, and the reader hears the same refusal the node menu and
// the drag badge show, from `actions.ts`'s exported WHY_* constants. One wall,
// one sentence, three ways of meeting it.
//
// ESCAPE IS A STACK, and its order is: cancel the lift → dismiss the hover card
// → step out one ring. The card's dismissal is a direct call
// (`dismissMindNodeCard`) rather than an overlay-stack subscription, for the
// ordering reason NodeCard.tsx's header gives: React's handler on the <svg>
// fires before lib/overlayStack's document listener, so the page's own Escape
// would otherwise always win and the card would be the one thing on this screen
// Escape could not close.
//
// `onKeyDown` AND `activate` CANNOT BE SPLIT FROM EACH OTHER, which is why they
// are one file: onKeyDown calls activate() for Enter and for Space-on-a-branch,
// and the invariant the map defends — Enter and click are the same act, Space
// differs only on an item — exists precisely because one function is called from
// both.
//
// ── THE KEYBOARD IS A FIRST-CLASS DIVE (docs/MAP-ZOOM.md §U5) ───────────────
//
// The camera redesign deletes the zoom buttons. It must not delete keyboard
// zoom, and `ZOOM_STEP` therefore lives HERE and is exported from here: a
// keyboard cannot be continuous, so the one place a stepped zoom is still the
// right answer is the one place the reader has no wheel and no pinch. `+`/`=`
// zoom in, `-`/`_` zoom out, at the cursor.
//
// THE SIX CAMERA VERBS ARRIVE AS ONE INJECTED OBJECT (`dive`), and it is
// OPTIONAL. Every one of them is an effect on state this file does not own and
// must not reach for — the camera is useMapGeometry's, the info sidebar is the
// page's. Injecting them keeps this file a pure grammar over `order` (which is
// what makes it testable without a DOM) and keeps the KEY→ACT mapping, which is
// the accessibility contract, in the file that documents it. With `dive`
// absent every key does exactly what it did before the camera existed, which is
// what lets this land ahead of the unit that supplies it.
//
// WHICH ENTER YOU GET IS A QUESTION ABOUT STRUCTURE, NEVER ABOUT CONFIGURATION.
// The owner's correction is that the dive steps through DEPARTMENTS and that an
// Organization is a LEAF you arrive at, with its detail in the sidebar. The
// mechanical form of that is `isDiveTarget` below: a node is a department iff it
// has at least one child that is itself structural — asked through
// `focus.isStructuralKind`, which is the ONE list of the kinds the dive enters
// (`root`, `track`, `entity` and, since wave 6, `cohort`) rather than a third
// copy of it here. It is
// NOT `entityType`, and model.ts forbids reading it — "what a Phase shows and
// what an Org shows is configuration, not code". A workspace whose admin adds a
// tier gets one more dive level for free, which is the whole point of the
// correction: the number of levels is the depth of the tree, never four.
//
// PAST THE DOM HORIZON, HOLD THE ID AND FLY. When `order` is a list SHORTER
// than the layout, an arrow can name a node that is not in the DOM — the parent
// that has become the frame, or a child still below `DOM_HORIZON_PX`. Answering
// with a whole-map fit would take a reader who asked for ONE item to a picture
// of everything. Instead the id is parked in useMapCursor's
// `requestPendingFocus` and the camera is asked to open the way in; focus lands
// on the node the next commit brings in. That is the same contract
// `flyToNode`'s `null` return already documents at mapMotion.ts:551-566.
//
// AND TODAY THAT ARM IS ARMED, NOT LIVE — stated because the sentence above
// used to claim `order` WAS the drawn list, and it is not. `Mindtree.tsx` hands
// both this hook and `useMapCursor` `geo.order`, the LAID-OUT list, so
// `drawnIds` below is the whole layout and every branch takes its "it is drawn"
// arm. The gap predates wave 9's frustum cull — the DOM horizon opened it at
// wave 1, when 31 groups were drawn against 424 laid-out nodes at zoomed-out —
// and wave 9 does not widen the BEHAVIOUR, because `MapCanvas`'s cull keeps
// `activeId` outright: an arrow onto an off-screen sibling sets the cursor, the
// cull keeps that node for being the cursor, and `dive.follow` brings the camera
// to it. Passing the culled list instead would change what an arrow DOES (park
// and fly for every off-screen sibling rather than move) and would close a cycle
// — `activeId` derives from the drawn set, the drawn set keeps `activeId` — so
// it is a deliberate open seam, not an oversight. Whoever closes it must cull
// AFTER `useMapCursor` to break that cycle.

import { useCallback, useMemo } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MutableRefObject } from 'react'
import type { MindDragController } from '../../components/mindtree/DragLayer'
import { dismissMindNodeCard } from '../../components/mindtree/NodeCard'
import { isMenuKey } from '../../components/mindtree/NodeMenu'
import { t } from '../../lib/i18n'
import { canEditEntry } from '../../lib/permissions'
import { WHY_GONE, WHY_NOT_YOURS, WHY_SIGNED_OUT } from '../../lib/mindtree/actions'
import { isStructuralKind } from '../../lib/mindtree/focus'
import type { FocusView } from '../../lib/mindtree/focus'
import type { PositionedNode } from '../../lib/mindtree/layout'
import {
  ROOT_ID,
  type MindLabel,
  type MindNode as MindNodeModel,
  type MindNodeKind,
} from '../../lib/mindtree/model'
import { openEntry } from '../../store/entrySheet'
import {
  clearMindSelection,
  setMindCollapsed,
  setMindFocus,
  setMindHovered,
  toggleMindSelected,
} from '../../store/mindtree'
import type { Entry, UserRole } from '../../types'

/**
 * THE STEPPED ZOOM, AND THE ONLY PLACE IT SURVIVES.
 *
 * `docs/MAP-ZOOM.md §6` deletes the `Zoom −` / `Zoom +` buttons because the
 * wheel and the pinch are the control. This constant is the reason that cut is
 * not also a loss of reach: a keyboard has no continuous axis, so a reader
 * without a pointer still needs a step, and 1.25 is the step the deleted buttons
 * used. Exported so the test can assert the ratio rather than a magic number,
 * and so nothing else in the app invents a second one.
 */
export const ZOOM_STEP = 1.25

/**
 * The camera, as six verbs — injected, never reached for.
 *
 * Optional at every call site. Absent, the keyboard behaves exactly as it did
 * before the camera existed; present, every key that should move the camera
 * does, and NO key that should not move it does. `details` is the one verb that
 * must leave the camera alone, and that is stated in its own doc comment rather
 * than left to the wiring.
 */
export interface MapDive {
  /** Enter on a DEPARTMENT: fly until that world fills the frame. */
  into: (nodeId: string) => void
  /**
   * Enter on an ORGANIZATION: open the info sidebar beside the map.
   * THE CAMERA DOES NOT MOVE BY ONE UNIT. The dive answers "where am I in the
   * organisation"; the sidebar answers "what is the state of this one thing".
   * `activate` announces the node by name after calling this — the sidebar is
   * the only one of the six verbs that changes nothing a screen reader would
   * otherwise be told about.
   */
  details: (nodeId: string) => void
  /**
   * Focus moved — follow it BY THE MINIMUM MOVE. `flyToCamera` refuses to
   * magnify, so a node that is already legible causes a pan at most and often
   * nothing at all.
   */
  follow: (nodeId: string) => void
  /** `+` / `=` / `−`, at the cursor. The ratio is always `ZOOM_STEP`. */
  zoomBy: (ratio: number) => void
  /** Home: frame the root world. */
  home: () => void
  /** Escape's last rung: surface one world. True when there was one to surface. */
  surface: () => boolean
}

export interface MapKeyboardOptions {
  dragController: MindDragController
  order: readonly PositionedNode<MindNodeModel>[]
  activeId: string | null
  drawnRoot: MindNodeModel
  focusView: FocusView
  drawnEntryIds: readonly string[]
  compact: boolean
  rtl: boolean
  dragging: boolean
  entryById: ReadonlyMap<string, Entry>
  selection: ReadonlySet<string>
  meId: string | null
  role: UserRole
  draggedRef: MutableRefObject<boolean>
  moveCursor: (id: string | undefined) => void
  setCurrentId: (id: string | null) => void
  toggleFold: (id: string) => void
  focusBranch: (nodeId: string | null) => void
  openMenuFor: (pos: PositionedNode<MindNodeModel>, at?: { x: number; y: number }) => void
  textOf: (label: MindLabel) => string
  setLive: (text: string) => void
  /**
   * The camera. Absent until the integrator wires U3, and every key falls back
   * to its pre-camera behaviour while it is.
   */
  dive?: MapDive
  /**
   * ESCAPE'S THIRD RUNG. Returns true when it closed something. The stack is
   * cancel the lift → dismiss the hover card → CLOSE THE PANEL → surface one
   * world, and the panel sits third because it is chrome the reader raised and
   * can see, while surfacing changes what the whole screen is about.
   */
  closePanel?: () => boolean
  /**
   * PARK AN ID THAT IS NOT IN THE DOM. useMapCursor lands it on the commit that
   * brings the node in. Absent, an arrow past the horizon simply does nothing,
   * which is what it does today.
   */
  requestPendingFocus?: (id: string) => void
}

/**
 * IS THIS A WORLD YOU DIVE INTO, OR A LEAF YOU SELECT?
 *
 * The owner's correction, made mechanical: the zoom levels are DEPARTMENTS, and
 * an Organization is the leaf the dive arrives at, not a level it enters. A
 * department is a structural node with at least one structural child; an
 * Organization is a structural node whose children are all content — the status
 * buckets and the rows filed under it.
 *
 * STRUCTURE, NOT CONFIGURATION. `entityType` names the thing ("Programme",
 * "Phase", "Organization") and model.ts forbids branching on it by name: "what a
 * Phase shows and what an Org shows is configuration, not code." Nothing here
 * reads it. The consequence is the one the correction asks for — an admin who
 * adds a tier gets one more dive level with no code change, and the number of
 * levels is the depth of the tree rather than four frozen English words.
 *
 * A COHORT IS A DEPARTMENT FOR THIS PURPOSE, on both halves of the test: you
 * dive INTO "the 96 organizations Sara manages", and an Organization holding a
 * cohort under it is still a world rather than a leaf. Both halves now read
 * `focus.isStructuralKind` rather than a third copy of the same three-way
 * comparison — that copy is exactly what would have been missed, because it
 * fails SILENTLY (a cohort would have been treated as a leaf you select, so a
 * tap on the biggest ring on the screen would have opened a sidebar for a thing
 * with no `map_nodes` row).
 *
 * Exported so the test can drive it against real trees rather than through six
 * layers of hook.
 */
export function isDiveTarget(node: MindNodeModel): boolean {
  if (!isStructuralKind(node.kind)) return false
  return node.children.some((kid) => isStructuralKind(kid.kind))
}

/**
 * A world the camera can be sent TO — structural, and not the workspace itself.
 *
 * THE ROOT IS THE ONE SUBTRACTION, and it is subtracted rather than absent from
 * `isStructuralKind` because the two questions differ by exactly it: the root IS
 * a world (the dive steps out to it, `worldAt` names it, the crumb ends there)
 * and it is never a thing you press ENTER ON to go somewhere — you are already
 * inside it, "out" is what the backward key is for, and handing it to
 * `dive.details` would open the organization sidebar on the workspace.
 *
 * A COHORT IS IN. That is the whole of `?by=` on the keyboard: Enter on "the 96
 * organizations Sara manages" flies into her ring, exactly as Enter on a Phase
 * flies into its departments, with no branch here that knows the word "cohort".
 */
function isFlyableKind(kind: MindNodeKind): boolean {
  return kind !== 'root' && isStructuralKind(kind)
}

export function useMapKeyboard({
  dragController,
  order,
  activeId,
  drawnRoot,
  focusView,
  drawnEntryIds,
  compact,
  rtl,
  dragging,
  entryById,
  selection,
  meId,
  role,
  draggedRef,
  moveCursor,
  setCurrentId,
  toggleFold,
  focusBranch,
  openMenuFor,
  textOf,
  setLive,
  dive,
  closePanel,
  requestPendingFocus,
}: MapKeyboardOptions) {
  const toggleSelect = useCallback(
    (entryId: string, label: string) => {
      // Read BEFORE the write: `selection` is this render's set, so `has` still
      // answers the question the reader just asked, and the announcement names
      // the state they are moving TO.
      const adding = !selection.has(entryId)
      toggleMindSelected(entryId)
      setLive(
        adding ? t('mindtree.selectedOne', { label }) : t('mindtree.deselectedOne', { label }),
      )
    },
    [selection, setLive],
  )

  const clearSelection = useCallback(() => {
    clearMindSelection()
    setLive(t('mindtree.selectionCleared'))
  }, [setLive])

  /**
   * Hover, published to the store so the card and the node styling read one
   * value.
   *
   * Dropped while a drag is in flight: the pointer is carrying work, and a
   * detail card opening under the ghost is the map talking about the wrong
   * thing. The card component takes `dragging` as well and cancels its own
   * timer, so this is the belt to its braces — a hover published mid-drag would
   * still be there when the gesture ended.
   */
  const onNodeHover = useCallback(
    (id: string | null) => {
      if (dragging && id !== null) return
      setMindHovered(id)
    },
    [dragging],
  )

  const activate = useCallback(
    (node: MindNodeModel, event?: { ctrlKey: boolean; metaKey: boolean }) => {
      // A pan that happens to end over a node is not a tap on it.
      if (draggedRef.current) return
      // Neither is the click every engine synthesises from the pointerup that
      // ENDED a drag. Without this, dropping an item onto a branch would open
      // that branch one frame later — `justDragged()` consumes the flag, so it
      // suppresses exactly one click and not the reader's next real tap.
      if (dragController.justDragged()) return

      // CTRL/CMD+CLICK TICKS A LEAF — the pointer half of Ctrl+Space, and the
      // only pointer gesture that reaches the selection at all. Without it the
      // bulk bar, the drag-many and every "…the selected items here" verb are
      // keyboard-only: `toggleMindSelected` had exactly one call site in the
      // whole app and it was behind a key chord. Tested BEFORE anything else a
      // click does, because a modifier is the only thing separating "mark this"
      // from "open this", and it is deliberately the same chord APG names for a
      // multi-selectable tree.
      const ticking = event !== undefined && (event.ctrlKey || event.metaKey)
      if (ticking && node.kind === 'entry' && node.entryId !== null) {
        setCurrentId(node.id)
        toggleSelect(node.entryId, textOf(node.label))
        return
      }

      setCurrentId(node.id)

      if (node.kind === 'entry' && node.entryId !== null) {
        openEntry(node.entryId, { list: drawnEntryIds })
        return
      }
      if (node.kind === 'more') {
        toggleFold(node.id)
        return
      }
      if (node.id === drawnRoot.id) {
        // The drawn root is the way back OUT, one ring at a time — the inverse
        // of the tap that got here. The whole-map root is never collapsible: a
        // collapsed root is a blank screen with no affordance left to un-blank
        // it.
        //
        // `trail.at(-2)` is "up one ring", which is exactly what focus.ts's
        // FocusView header names it: the trail is INCLUSIVE of the focused node,
        // so its last element is where we are and the one before it is where
        // "out" goes.
        //
        // WITH A CAMERA the way back out is the same gesture and a better one:
        // surfacing one WORLD, which is the exact inverse of the fly that got
        // here and returns the reader to the framing they left, to the unit.
        // `surface()` answering false means there is nothing above this — the
        // reader is looking at the workspace — and the drill-in below is then
        // still the honest answer for a build where a drill-in is what happened.
        if (dive !== undefined && dive.surface()) return
        if (focusView.focusId === null) return
        const parent = focusView.trail[focusView.trail.length - 2]
        const up = parent === undefined || parent.id === ROOT_ID ? null : parent.id
        setMindFocus(up)
        setLive(
          up === null || parent === undefined
            ? t('mindtree.clearFocus')
            : t('mindtree.focused', { label: textOf(parent.label) }),
        )
        return
      }
      // ── THE DIVE AND THE SIDEBAR: two gestures, two questions ────────────
      //
      // A DEPARTMENT becomes the frame. An ORGANIZATION opens the info sidebar
      // and THE CAMERA DOES NOT MOVE BY ONE UNIT — no zoom, no re-root, no
      // relayout. The dive answers "where am I in the organisation"; the
      // sidebar answers "what is the state of this one thing", and answering
      // the second by moving the map would be answering a question nobody
      // asked. Which of the two a node is is decided by `isDiveTarget`, on
      // structure alone.
      //
      // Above the compact branch, deliberately: §8 gives the phone the FULL
      // hierarchy with identical thresholds, so a tap on a department is a
      // dive there too, and the one-ring drill-in below is the pre-camera
      // fallback rather than the phone's answer.
      //
      // THE SIDEBAR SAYS WHOSE DETAILS IT IS SHOWING, and this is the only place
      // that CAN say it: nothing moves on the canvas, focus stays on the node it
      // was already on, so a screen reader is given no reason of its own to
      // re-read anything. `useMapLens` is deliberately silent for this subject
      // because it holds an id and this line holds the label.
      //
      // THE SENTENCE IS THE PANEL'S OWN TITLE (`mindtree.panelOrg`, which
      // Mindtree.tsx renders at the head of the surface that just opened), so
      // the two cannot drift into describing the same act two ways. This arm is
      // reached only when `isDiveTarget` is FALSE — an Organization — and that
      // is exactly the case Mindtree.tsx titles with `panelOrg` rather than
      // `panelBranch`: you ARRIVE AT an Organization, you are not inside it.
      //
      // A COHORT TAKES THE FIRST ARM UNCONDITIONALLY. `groupEntities` only ever
      // mints one over organizations, so `isDiveTarget` is already true of every
      // cohort that exists — but the second arm hands its id to the org sidebar,
      // and a cohort's key is synthetic (`entityIdOf` refuses it by
      // construction). Naming the kind here costs one comparison and makes the
      // one path that could send `manager:<uuid>` at a uuid column impossible
      // rather than merely unreachable.
      if (dive !== undefined && isFlyableKind(node.kind)) {
        if (isDiveTarget(node) || node.kind === 'cohort') dive.into(node.id)
        else {
          dive.details(node.id)
          setLive(t('mindtree.panelOrg', { label: textOf(node.label) }))
        }
        return
      }
      if (compact && node.children.length > 0) {
        // The small-screen drill: the tapped branch becomes the drawn root and
        // the ring under it appears. Collapse/expand is not offered here — with
        // one ring drawn there is nothing to collapse, and a control that did
        // nothing would be worse than its absence.
        focusBranch(node.id)
        setLive(t('mindtree.focused', { label: textOf(node.label) }))
        return
      }
      if (node.children.length > 0) setMindCollapsed(node.id, !node.collapsed)
    },
    [
      drawnEntryIds,
      toggleFold,
      drawnRoot.id,
      focusView,
      compact,
      textOf,
      dragController,
      focusBranch,
      toggleSelect,
      setLive,
      draggedRef,
      setCurrentId,
      dive,
    ],
  )

  /**
   * Why Space could not be lifted on this leaf — the SAME sentence the node menu
   * and the drag badge show for the same wall.
   *
   * The three keys are `lib/mindtree/actions.ts`'s own exported constants, and
   * its header says they are exported for exactly this: "so that the same refusal
   * reads identically from the menu, the drag's refusal badge and the keyboard
   * path — three places a reader can meet the same wall, and three chances to
   * word it three ways".
   *
   * `null` means the gesture is genuinely unavailable rather than refused (the
   * phone's one-ring drill-in has no branch to drop onto), which the caller
   * answers with its own sentence.
   */
  const whyNotLiftable = useCallback(
    (entryId: string | null): string | null => {
      if (meId === null) return WHY_SIGNED_OUT
      if (entryId === null) return WHY_GONE
      const entry = entryById.get(entryId)
      if (entry === undefined) return WHY_GONE
      if (!canEditEntry(entry, meId, role)) return WHY_NOT_YOURS
      return null
    },
    [entryById, meId, role],
  )

  /**
   * WHICH IDS THIS HOOK HAS BEEN TOLD ARE IN THE DOM — whatever `order` holds.
   *
   * THE CALLER TODAY PASSES `geo.order`, THE LAID-OUT LIST, so this set is the
   * whole layout and every branch below takes its "it is drawn" arm. The undrawn
   * arm is therefore armed and not live in the app; the header says why that is
   * a deliberate seam rather than a bug, and mapZoomReach.test.tsx exercises it
   * by handing this hook a genuinely shorter list.
   *
   * The name stays `drawnIds` because it is what the set MEANS to the logic
   * below: the ids a keystroke may land focus on without flying first. What is
   * NOT safe is to read this as proof the app culls the keyboard's order — it
   * does not.
   */
  const drawnIds = useMemo(() => new Set(order.map((pos) => pos.id)), [order])

  /**
   * MOVE THE KEYBOARD TO `id` — AND, IF IT IS PAST THE DOM HORIZON, OPEN THE WAY
   * IN FIRST AND ASK AGAIN.
   *
   * The drawn case is the old one: focus the element, and let the camera follow
   * by the MINIMUM move — `flyToCamera` refuses to magnify, so a node that is
   * already legible causes a pan at most and usually nothing.
   *
   * The undrawn case is the new one and it has exactly one wrong answer, which
   * is to fit the whole map: a reader who asked for ONE item would be handed a
   * picture of everything. Instead the id is parked and the camera is asked to
   * frame that world; useMapCursor lands focus on it in the layout effect of the
   * commit that brings it in. Without a camera wired there is nothing to fly, so
   * the walk stops where the drawing stops — which is today's behaviour exactly.
   */
  const reach = useCallback(
    (id: string | undefined) => {
      if (id === undefined) return
      if (drawnIds.has(id)) {
        moveCursor(id)
        dive?.follow(id)
        return
      }
      if (dive === undefined) return
      requestPendingFocus?.(id)
      dive.into(id)
    },
    [drawnIds, moveCursor, dive, requestPendingFocus],
  )

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<SVGSVGElement>) => {
      // FIRST, ALWAYS — its own contract. It answers true when it consumed the
      // key, which is: Space that began a lift, and (while something IS lifted)
      // the arrows, Enter and Escape. Everything below therefore runs only when
      // no drag is in flight, which is what keeps the two grammars from ever
      // being live at the same time.
      if (dragController.handleKeyDown(event)) return

      // A LIFT OWNS THE KEYBOARD until Enter, Escape or Tab ends it. The layer
      // consumed everything inside its own grammar; everything else must still
      // not reach the map's, because both would then be live at once. Two keys
      // made that visible: Shift+F10 opened the node menu and moved focus into
      // it with a live, now-unreachable drag still on screen, and Ctrl+Space
      // ticked a row that the frozen carry (decided at the lift, deliberately)
      // was never going to carry — so the marks and the set about to be written
      // disagreed for the rest of the gesture.
      //
      // `isLifted()` and not `dragController.active`: Tab ends a lift and
      // returns false on purpose so focus can leave, and the render flag still
      // reads true at that moment. The refs do not.
      if (dragController.isLifted()) return

      if (activeId === null) return
      const at = order.findIndex((pos) => pos.id === activeId)
      if (at < 0) return
      const pos = order[at] as PositionedNode<MindNodeModel>
      const node = pos.node
      const drawn = pos.childIds.length > 0
      const isItem = node.kind === 'entry'

      // The node menu, on the two keys every platform offers for it. Neither did
      // anything on this screen before, so there is nothing to reconcile — and
      // both are checked before the switch because `isMenuKey` reads `shiftKey`,
      // which a bare `event.key` switch cannot see.
      if (isMenuKey(event)) {
        event.preventDefault()
        openMenuFor(pos)
        return
      }

      // Ctrl+Space toggles the tick, which is the APG multi-select tree's own
      // binding for exactly this. Tested before the plain-Space branch below
      // because that branch is about a GRAB and this one is about a SELECTION,
      // and a modifier is the only thing separating them.
      if ((event.ctrlKey || event.metaKey) && (event.key === ' ' || event.key === 'Spacebar')) {
        if (!isItem || node.entryId === null) return
        event.preventDefault()
        toggleSelect(node.entryId, textOf(node.label))
        return
      }

      // "Toward the children" is an inline-end concept. The drawing is already
      // mirrored by the layout module, so the KEYS have to mirror too or the
      // arrow that opens a branch in English closes it in Arabic.
      const forward = rtl ? 'ArrowLeft' : 'ArrowRight'
      const backward = rtl ? 'ArrowRight' : 'ArrowLeft'

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault()
          reach(order[at + 1]?.id)
          return
        case 'ArrowUp':
          event.preventDefault()
          reach(order[at - 1]?.id)
          return
        case 'Home':
          // BOTH, and they are the same act. APG says Home moves focus to the
          // first node, which is the drawn root; §U5 says Home frames the root
          // world. `order[0]` IS that world's node, so the two readings agree
          // and the camera is asked for the framing rather than for `follow`'s
          // minimum move — "take me back to the top" is a request to see the
          // whole thing, not to keep the current magnification.
          event.preventDefault()
          moveCursor(order[0]?.id)
          dive?.home()
          return
        case 'End':
          event.preventDefault()
          reach(order[order.length - 1]?.id)
          return
        case '+':
        case '=':
        case '-':
        case '_':
          // KEYBOARD ZOOM, AND THE REASON IT OUTLIVES THE BUTTONS. §6 deletes
          // `Zoom −` / `Zoom +` because the wheel and the pinch are the control
          // — but a keyboard has no continuous axis, so deleting the buttons
          // would delete the gesture entirely for a reader without a pointer.
          // `ZOOM_STEP` survives here and only here.
          //
          // A modifier is left alone on purpose: Ctrl/Cmd +/− is the BROWSER's
          // page zoom, and a map that swallowed it would take away the one
          // magnification a low-vision reader already knows how to reach.
          if (event.ctrlKey || event.metaKey || event.altKey) return
          if (dive === undefined) return
          event.preventDefault()
          dive.zoomBy(event.key === '+' || event.key === '=' ? ZOOM_STEP : 1 / ZOOM_STEP)
          return
        case 'Enter':
          // ENTER IS UNCONDITIONAL and always has been: open the item, or open
          // and close the branch. Nothing about this build changes it, which is
          // half of what makes the Space rule below safe to introduce.
          event.preventDefault()
          activate(node)
          return
        case ' ':
        case 'Spacebar':
          event.preventDefault()
          // THE ONE COLLISION, resolved by the node's KIND — see this file's
          // header for the full argument. On a branch, Space is Enter's synonym,
          // exactly as it was. On an ITEM it is the grab key, and reaching this
          // line at all means the drag layer declined the lift: this reader may
          // not move this row, or there is nowhere on screen to move it to.
          //
          // Either way the key is SWALLOWED rather than falling through to
          // "open the entry". A key that moves the items you own and opens the
          // ones you do not is the shape the brief rules out, and the fall-through
          // is how a build gets there without anybody deciding to.
          if (!isItem) {
            activate(node)
            return
          }
          setLive(t(whyNotLiftable(node.entryId) ?? 'mindtree.dragNoTarget'))
          return
        case 'Escape':
          // THE ESCAPE STACK, outermost first. A lift outranks everything and has
          // already been handled above by `handleKeyDown`; the hover card is
          // next, because it is the thing most recently raised and the reader can
          // see it; stepping out of a drill-in is last, because it changes what
          // the whole screen is about.
          //
          // The card is dismissed by a direct call rather than through
          // lib/overlayStack, and NodeCard.tsx's header gives the ordering
          // reason: React's listener on this <svg> is below `document`, so with
          // focus on a treeitem — which is exactly where it is when the card was
          // raised BY that focus — the page's Escape would always win and the
          // card would be the one thing on this screen Escape could not close.
          if (dismissMindNodeCard()) {
            event.preventDefault()
            return
          }
          // THE PANEL IS THE THIRD RUNG, and it is third rather than second for
          // the same reason the card is second: the card is the thing most
          // recently raised, the panel is chrome the reader opened and can see,
          // and surfacing a world changes what the whole screen is about.
          // MapPanel already owns its own two Escape orderings; this is the
          // map's side of the same stack, and the boolean is what keeps the two
          // from both firing on one press.
          if (closePanel?.() === true) {
            event.preventDefault()
            return
          }
          // SURFACE ONE WORLD — the last rung, and the exact inverse of the fly
          // that got here. False means there is nothing above: the reader is
          // already looking at the workspace, and the drill-in clear below is
          // then the honest answer for a build where a drill-in is what
          // happened.
          if (dive !== undefined && dive.surface()) {
            event.preventDefault()
            return
          }
          if (focusView.focusId !== null) {
            event.preventDefault()
            setMindFocus(null)
            setLive(t('mindtree.clearFocus'))
          }
          return
        default:
          break
      }

      if (event.key === forward) {
        event.preventDefault()
        if (pos.hasChildren && !drawn) {
          if (node.kind === 'more') toggleFold(node.id)
          // On a phone every branch sits on the depth limit, so "open it" and
          // "drill into it" are the same gesture — which is what keeps the
          // arrow key and the tap doing the same thing.
          //
          // THE CAMERA RETIRES BOTH ARMS FOR A STRUCTURAL NODE. There is no
          // fold to open — every child is already in the drawing, waiting at
          // its own distance — and the phone is no longer capped at one ring,
          // so "toward the children" is a fly, not a state change. `reach`
          // handles the rest, including the child that is still below the DOM
          // horizon.
          else if (dive !== undefined && isFlyableKind(node.kind))
            reach(pos.childIds[0] ?? node.children[0]?.id)
          else if (compact) focusBranch(node.id)
          else setMindCollapsed(node.id, false)
        } else if (drawn) {
          reach(pos.childIds[0])
        }
        return
      }

      if (event.key === backward) {
        event.preventDefault()
        if (drawn) {
          if (node.kind === 'more') toggleFold(node.id)
          // Same argument, inverted: with a camera there is nothing to close,
          // and "away from the children" is a step OUT to the parent world —
          // which is where `reach` was already taking a leaf.
          else if (dive !== undefined && isFlyableKind(node.kind))
            reach(pos.parentId ?? undefined)
          else setMindCollapsed(node.id, true)
        } else if (pos.parentId !== null) {
          reach(pos.parentId)
        }
      }
    },
    [
      dragController,
      activeId,
      order,
      rtl,
      moveCursor,
      reach,
      activate,
      focusView.focusId,
      compact,
      toggleFold,
      openMenuFor,
      toggleSelect,
      textOf,
      whyNotLiftable,
      focusBranch,
      setLive,
      dive,
      closePanel,
    ],
  )

  return { activate, onKeyDown, toggleSelect, clearSelection, onNodeHover }
}

export type MapKeyboard = ReturnType<typeof useMapKeyboard>
