// THE ROVING TAB STOP, AND THE FOUR PIECES THAT PUT FOCUS BACK AFTER A WRITE.
//
// Extracted from pages/Mindtree.tsx unchanged.
//
// WHY THIS IS A SEPARATE FILE FROM useMapKeyboard, which is the layout the
// decomposition brief named. `requestRefocus` has to exist BEFORE
// `useMindDragLayer` is built, because the layer takes it as `onWrote`; and
// `onKeyDown` has to exist AFTER, because it asks the controller first. One
// hook cannot be on both sides of the controller, so the cursor's STATE and its
// repair machinery are here and the KEY HANDLING is in useMapKeyboard. The
// composition root calls this, then the drag layer, then that.
//
// FOUR PIECES, AND THEY ONLY WORK TOGETHER — see `requestRefocus`:
//   1. `layoutRef.current = layout`, assigned during RENDER;
//   2. `requestRefocus(entryId)` called synchronously BEFORE the write, from
//      both write paths (the drag layer's `onWrote`, and useMapWrites' patch
//      arm);
//   3. the `useLayoutEffect` keyed on the NEW layout;
//   4. `refocusTarget`'s ordering rule, which lives in lib/mindtree/focus.ts
//      where it can be exercised against real trees.
// Move any one of the four to a different component and pressing Enter to drop
// lands the reader at the top of the document.
//
// nodeRefs HAS SIX CONSUMERS and they do not overlap: `registerRef` on every
// MindNode, `moveCursor().focus()`, the refocus layout effect, the cursor-repair
// effect, the node menu's keyboard placement (getBoundingClientRect), and both
// overlays' `anchorEl` for focus return on dismiss. It is returned rather than
// hidden for that reason.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { refocusTarget } from '../../lib/mindtree/focus'
import type { MindtreeLayout, PositionedNode } from '../../lib/mindtree/layout'
import type { MindNode as MindNodeModel } from '../../lib/mindtree/model'
import { pruneMindSelection } from '../../store/mindtree'

export interface MapCursorOptions {
  layout: MindtreeLayout<MindNodeModel>
  order: readonly PositionedNode<MindNodeModel>[]
  svgRef: RefObject<SVGSVGElement | null>
}

export function useMapCursor({ layout, order, svgRef }: MapCursorOptions) {
  /**
   * THE ROVING TAB STOP — which node the keyboard is on.
   *
   * Named `cursorId` and not `focusId`. `focus` means the DRILL-IN
   * (store/mindtree's `focus`, `?focus=` in the URL, `resolveFocus`, the
   * breadcrumb), and two unrelated things called focus in one file is how a
   * reader ends up wiring the breadcrumb to the arrow keys.
   */
  const [cursorId, setCursorId] = useState<string | null>(null)
  /**
   * Is the keyboard actually INSIDE the drawing?
   *
   * Only the hover card reads it, and only to answer a question a roving
   * tabindex cannot: `activeId` is never null, because it falls back to the first
   * node so a Tab into the map always lands somewhere — but "where focus WOULD
   * go" is not "where focus IS". See `cardPos` in useMapOverlays.
   */
  const [treeFocused, setTreeFocused] = useState(false)
  const [currentId, setCurrentId] = useState<string | null>(null)

  const nodeRefs = useRef(new Map<string, SVGGElement>())

  const activeId = cursorId !== null && layout.byId.has(cursorId) ? cursorId : (order[0]?.id ?? null)

  const registerRef = useCallback((id: string, el: SVGGElement | null) => {
    if (el === null) nodeRefs.current.delete(id)
    else nodeRefs.current.set(id, el)
  }, [])

  /**
   * Does the map hold real DOM focus right now?
   *
   * `treeFocused` is state and therefore one render behind the unmount it is
   * being asked about; this reads the document. Used only to decide whether a
   * repair is OWED — a rebuild caused by somebody else's realtime patch must
   * never pull focus out of the filter box or off another screen.
   */
  const treeHasFocus = useCallback((): boolean => {
    const svg = svgRef.current
    const active = document.activeElement
    return svg !== null && active !== null && svg.contains(active)
  }, [svgRef])

  /**
   * Is the reader's keyboard still ON THIS SCREEN'S gesture?
   *
   * `treeHasFocus()` plus the overlays this page itself raises. A destructive
   * act is confirmed first, and `components/Confirm.tsx` resolves its promise
   * BEFORE the effect that restores focus runs — so at the moment the write is
   * requested, `activeElement` is the dialog's own button and a bare
   * `treeHasFocus()` would decline to repair anything. The reader then lands on
   * `<main>`, which is Confirm's honest fallback for a trigger that unmounted,
   * and not where they were.
   *
   * Safe to widen this far because `requestRefocus` is only ever called from
   * this page's own write paths — a drop and a menu verb — so the dialog or menu
   * holding focus is always the one this gesture opened.
   */
  const gestureHasFocus = useCallback((): boolean => {
    if (treeHasFocus()) return true
    const active = document.activeElement
    return active !== null && active.closest('[role="dialog"], [role="menu"]') !== null
  }, [treeHasFocus])

  /**
   * A WRITE IS ABOUT TO REBUILD THE TREE AROUND THIS ENTRY — put focus back on
   * it afterwards.
   *
   * THE PROBLEM THIS SOLVES. A MindNode id IS its bucket path
   * (`root/track:T/group:G/entry:E`), so ANY successful drop or menu act rewrites
   * the id of the row it moved: a status change rewrites the `group:` segment, a
   * track change rewrites `track:`. Nodes are keyed on that id, so the
   * `<g role="treeitem">` carrying DOM focus UNMOUNTS, and the browser resets
   * `activeElement` to `<body>`. `store/entries.patchEntry` commits the
   * optimistic row before it awaits the request, so this happens synchronously
   * with the gesture — the reader presses Enter to drop and lands at the top of
   * the document. That directly contradicts the drag's own rule: a drag that
   * ends must not have moved the reader's place in the tree as a side effect.
   *
   * THE SHAPE. Requested BEFORE the write (while the old layout is still the
   * one on screen, so the node's outgoing id can be recorded) and performed in a
   * layout effect on the NEW layout, which is the first moment the destination
   * element exists. Three answers, in order: the node now drawing that entry;
   * the nearest surviving ancestor of where it used to be (a close removes the
   * row from the map entirely, and its old branch is still the reader's place);
   * and finally the top of the map, which is where the browser would have put
   * them anyway.
   */
  const refocusRef = useRef<{ entryId: string; fromId: string | null } | null>(null)
  const layoutRef = useRef(layout)
  layoutRef.current = layout

  const requestRefocus = useCallback(
    (entryId: string) => {
      if (!gestureHasFocus()) return
      const fromId = layoutRef.current.nodes.find((p) => p.node.entryId === entryId)?.id ?? null
      refocusRef.current = { entryId, fromId }
    },
    [gestureHasFocus],
  )

  useLayoutEffect(() => {
    const want = refocusRef.current
    if (want === null) return
    refocusRef.current = null
    // `refocusTarget` is the ordering rule and it lives in lib/mindtree/focus.ts
    // beside `nearestId`, where it can be exercised — this file cannot be, in a
    // `node` test environment. Null means "your own fallback", which is the top
    // of the map: where the browser would have left the reader anyway.
    const id =
      refocusTarget(
        order.map((p) => ({ id: p.id, entryId: p.node.entryId })),
        want,
        (c) => layout.byId.has(c),
      ) ??
      order[0]?.id ??
      null
    if (id === null) return
    setCursorId(id)
    nodeRefs.current.get(id)?.focus()
  }, [layout, order])

  useEffect(() => {
    // Keep the roving tab stop on a node that still exists. A filter keystroke
    // can delete the focused branch out from under the reader, and a tabindex
    // pointing at nothing drops them back to the top of the document.
    if (cursorId === null || layout.byId.has(cursorId)) return
    const next = order[0]?.id ?? null
    setCursorId(next)
    // AND THE FOCUS, not only the tab stop. Repairing `tabindex` alone leaves
    // real DOM focus on `<body>` whenever the vanished node was the one carrying
    // it — the tab stop is correct and the reader is nowhere. Guarded on the map
    // ACTUALLY having held focus (`treeFocused`, and the document re-checked
    // because the unmount may already have blurred), so a background rebuild
    // never steals the keyboard from somewhere else on the page.
    if (next === null || !treeFocused || treeHasFocus()) return
    nodeRefs.current.get(next)?.focus()
  }, [layout, cursorId, order, treeFocused, treeHasFocus])

  const moveCursor = useCallback((id: string | undefined) => {
    if (id === undefined) return
    setCursorId(id)
    // Real DOM focus, not just a tabindex change: `aria-activedescendant` is
    // the alternative and it is the weaker one here, because the nodes are
    // genuinely focusable elements and a reader's virtual cursor should land on
    // the mark itself.
    nodeRefs.current.get(id)?.focus()
  }, [])

  /** Every entry currently drawn, in reading order — the sheet's prev/next. */
  const drawnEntryIds = useMemo(
    () => order.map((pos) => pos.node.entryId).filter((id): id is string => id !== null),
    [order],
  )

  /**
   * THE BULK BAR MUST NOT LIE, so anything the reader can no longer see is
   * unticked on every rebuild.
   *
   * pages/tracks/TracksIndex.tsx states the rule and a map has three more ways to
   * hide a row than a list does: collapsing a branch, drilling into a different
   * one, and tightening a filter. `pruneMindSelection` returns the same reference
   * when nothing was dropped, so the ordinary rebuild costs no render anywhere.
   *
   * It sits here, beside the layout-derived ids, because both derive from
   * `order` and both are consumed at page level — splitting them from the
   * layout is how prev/next silently becomes the wrong list and the bulk bar
   * starts claiming rows that are not on screen.
   */
  const drawnEntryIdSet = useMemo(() => new Set(drawnEntryIds), [drawnEntryIds])
  useEffect(() => {
    pruneMindSelection(drawnEntryIdSet)
  }, [drawnEntryIdSet])

  return {
    nodeRefs,
    cursorId,
    setCursorId,
    treeFocused,
    setTreeFocused,
    currentId,
    setCurrentId,
    activeId,
    registerRef,
    requestRefocus,
    moveCursor,
    drawnEntryIds,
  }
}

export type MapCursor = ReturnType<typeof useMapCursor>
