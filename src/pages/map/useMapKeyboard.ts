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

import { useCallback } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MutableRefObject } from 'react'
import type { MindDragController } from '../../components/mindtree/DragLayer'
import { dismissMindNodeCard } from '../../components/mindtree/NodeCard'
import { isMenuKey } from '../../components/mindtree/NodeMenu'
import { t } from '../../lib/i18n'
import { canEditEntry } from '../../lib/permissions'
import { WHY_GONE, WHY_NOT_YOURS, WHY_SIGNED_OUT } from '../../lib/mindtree/actions'
import type { FocusView } from '../../lib/mindtree/focus'
import type { PositionedNode } from '../../lib/mindtree/layout'
import {
  ROOT_ID,
  type MindLabel,
  type MindNode as MindNodeModel,
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
          moveCursor(order[at + 1]?.id)
          return
        case 'ArrowUp':
          event.preventDefault()
          moveCursor(order[at - 1]?.id)
          return
        case 'Home':
          event.preventDefault()
          moveCursor(order[0]?.id)
          return
        case 'End':
          event.preventDefault()
          moveCursor(order[order.length - 1]?.id)
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
          else if (compact) focusBranch(node.id)
          else setMindCollapsed(node.id, false)
        } else if (drawn) {
          moveCursor(pos.childIds[0])
        }
        return
      }

      if (event.key === backward) {
        event.preventDefault()
        if (drawn) {
          if (node.kind === 'more') toggleFold(node.id)
          else setMindCollapsed(node.id, true)
        } else if (pos.parentId !== null) {
          moveCursor(pos.parentId)
        }
      }
    },
    [
      dragController,
      activeId,
      order,
      rtl,
      moveCursor,
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
    ],
  )

  return { activate, onKeyDown, toggleSelect, clearSelection, onNodeHover }
}

export type MapKeyboard = ReturnType<typeof useMapKeyboard>
