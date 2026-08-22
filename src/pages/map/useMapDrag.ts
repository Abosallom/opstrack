// THE DRAG'S WIRING — one `useMindDragLayer` call, and the two-way knot it sits
// inside.
//
// Extracted from pages/Mindtree.tsx unchanged. The layer itself
// (components/mindtree/DragLayer.tsx) owns the whole gesture; what lives here is
// which fifteen things it is handed, and three of those choices have each been
// a shipped defect.
//
// THE KNOT. `useMapGeometry` has to ask the controller "have you already claimed
// this press?" before it starts a pan, and the controller has to be handed
// geometry's `panBy` and `cancelPan`. Neither can be built first. It is broken
// with a ref assigned during render — the same device useMapCursor uses for
// `layoutRef` — and read only from inside a pointer handler, long after both
// halves exist. `isPressing` is therefore stable for the life of the screen,
// which is strictly better than the old direct read: the pan handler used to
// change identity twice per drag along with the controller.
//
// CALLED BETWEEN useMapCursor AND useMapKeyboard, and that ordering is the whole
// reason those two are separate files: `onWrote` needs the cursor's
// `requestRefocus`, which must exist first, and `onKeyDown` asks
// `dragController.handleKeyDown` first, so it must be built after.

import { useCallback, useRef } from 'react'
import type { RefObject } from 'react'
import { useMindDragLayer, type MindDragController } from '../../components/mindtree/DragLayer'
import type { DrawnLayout, PositionedNode } from '../../lib/mindtree/layout'
import type { MindDimension, MindNode as MindNodeModel } from '../../lib/mindtree/model'
import type { MindLabel } from '../../lib/mindtree/model'
import type { MindtreeView } from '../../store/mindtree'
import type { Entry, UserRole } from '../../types'

export interface MapDragOptions {
  tree: MindNodeModel
  layout: DrawnLayout<MindNodeModel>
  dimension: MindDimension
  entryById: ReadonlyMap<string, Entry>
  meId: string | null
  role: UserRole
  rtl: boolean
  view: MindtreeView
  activeId: string | null
  svgRef: RefObject<SVGSVGElement | null>
  textOf: (label: MindLabel) => string
  panBy: (dx: number, dy: number) => void
  cancelPan: () => void
  openMenuFor: (pos: PositionedNode<MindNodeModel>, at?: { x: number; y: number }) => void
  requestRefocus: (entryId: string) => void
}

/**
 * The controller, plus the stable predicate `useMapGeometry` needs BEFORE the
 * controller exists.
 *
 * `isPressing` is returned from a hook of its own so the composition root can
 * call it in geometry's option list without holding the ref itself — the ref is
 * an implementation detail of this knot and nothing else on the screen reads it.
 */
export function useMapDragPressing(): {
  isPressing: () => boolean
  attach: (controller: MindDragController) => void
} {
  const controllerRef = useRef<MindDragController | null>(null)
  const isPressing = useCallback((): boolean => controllerRef.current?.isPressing() ?? false, [])
  const attach = useCallback((controller: MindDragController) => {
    controllerRef.current = controller
  }, [])
  return { isPressing, attach }
}

export function useMapDrag({
  tree,
  layout,
  dimension,
  entryById,
  meId,
  role,
  rtl,
  view,
  activeId,
  svgRef,
  textOf,
  panBy,
  cancelPan,
  openMenuFor,
  requestRefocus,
}: MapDragOptions): MindDragController {
  const labelOf = useCallback((node: MindNodeModel) => textOf(node.label), [textOf])

  return useMindDragLayer({
    // THE WHOLE TREE, never `drawnRoot` — the option's own doc says why: a drop
    // folds the ROOT-to-target path, and on a phone (or two rings into a
    // drill-in) the drawn root is a track, so folding the drawn path would write
    // a status while leaving the row on its old track.
    root: tree,
    layout,
    dimension,
    entryById,
    meId,
    role,
    rtl,
    focusedId: activeId,
    svgRef,
    labelOf,
    onPanBy: panBy,
    onPanCancel: cancelPan,
    // THE PHONE'S ONLY DOOR TO THE VERBS, and it is now two doors rather than
    // one. A finger has no right-click and no Shift+F10, so without this the
    // node menu is desktop-only.
    //
    //   1. AN ENTRY WITH NOWHERE TO DROP. The compact map draws one ring, so the
    //      ring showing items shows no branch to drop onto and the layer refuses
    //      to start a drag at all. The hold is spent on the item's own verbs
    //      instead — assign, re-status, close — which are the same acts a drop
    //      performs and go down the same `patchEntry` path.
    //
    //   2. A BRANCH, ANYWHERE. Branches do not move in v1, so a long press on a
    //      directorate, a book or a type used to do nothing at all — and add an
    //      item, add a branch, archive and focus live behind this menu and
    //      nowhere else. See `DragLayer`'s `menuHoldRef`.
    onNodeMenu: openMenuFor,
    onWrote: requestRefocus,
    // The table has no nodes to press and no <svg> to measure. Guarding here is
    // cheaper than every handler inside the layer asking.
    disabled: view !== 'map',
  })
}
