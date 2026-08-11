// THE GEOMETRY AND THE VIEWPORT — how big a node is, where the tidy tree puts
// it, what window of the drawing is on screen, and the three gestures that move
// that window.
//
// Extracted from pages/Mindtree.tsx unchanged.
//
// ── ZOOM IS A viewBox, NEVER A CSS TRANSFORM ───────────────────────────────
//
// A `scale()` on the <svg> resamples text (it blurs) and, worse, moves
// hit-testing away from where the marks appear at fractional scales. So zoom
// and pan are arithmetic on the viewBox, exactly as lib/mindtree/layout's
// `fitToViewBox` is written to support. `pan === null` means "stay fitted",
// which is why expanding a branch re-fits the map for free and a user who has
// panned is never yanked back.
//
// THE THREE NULL-ANCHORING CALL SITES ARE IN THIS FILE TOGETHER, and that is
// the reason the cut is drawn here rather than through the middle of it:
// `panBy`, `zoomBy` and `onPointerMove` each have to turn "stay fitted" into a
// real centre before they may move it. A build that carried two of the three
// re-centres the map on every zoom press.
//
// SO IS THE CLAMP CYCLE. layout → fit → zoomBounds → heldZoom is a read-time
// clamp, not a write-time one: expanding a branch, typing in the filter or a
// window resize moves `layout.bounds` → `fit.scale` → the multiplier bounds,
// and the stored zoom is silently re-clamped on read. Two components each
// holding half of that strand the reader outside the new bounds with the +/−
// buttons unable to walk back — the exact bug SCALE_MIN/SCALE_MAX records as
// already fixed once.
//
// ── AND THE BIG SCREEN, FOR THE SAME REASON AS THE SMALL ONE ───────────────
//
// The desktop had the identical defect as the phone and nobody had measured it,
// because a desktop map "fits". The first cut opened every branch through ring 3
// and gave `fitToViewBox` no floor, so a six-track workspace with 31 open items
// fitted at 0.23: every node on the map was 10 CSS px tall — under WCAG 2.5.8's
// 24, under the app's own 44 — and the 12.5px label rendered at 2.9px. The zoom
// could not rescue it either, because the ceiling was a multiple OF THE FIT.
//
// Three numbers fix it and all three are derived rather than chosen. The map
// OPENS AT THE TRACK RING (`OPEN_DEPTH`, in useMapModel), which fits at 1:1. The
// fit REFUSES to shrink past a 24px node (`MIN_TARGET_PX`) and overflows into
// the pan that was already built. And the zoom is bounded on the EFFECTIVE
// scale, so + always reaches 1:1 however large the tree is.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { t } from '../../lib/i18n'
import {
  DEFAULT_GAP,
  DEFAULT_NODE_SIZE,
  fitToViewBox,
  layoutMindtree,
  sizeForCount,
  zoomLimits,
  type Gap,
  type NodeSize,
} from '../../lib/mindtree/layout'
import type { MindNode as MindNodeModel } from '../../lib/mindtree/model'
import { useBoxSize } from './useMapViewport'

/**
 * Zoom bounds, IN EFFECTIVE SCALE — drawing units per CSS pixel on screen —
 * rather than in multiples of the fit.
 *
 * The first cut clamped the MULTIPLIER at 4, which reads as generous and is
 * not: on-screen scale is `fit.scale × zoom`, so a map that fits at 0.15 had a
 * ceiling of 0.6 and could not be magnified to a legible size at all, however
 * many times the reader pressed +. The bound has to be on the number the reader
 * can actually see. `zoomLimits()` (lib/mindtree/layout) turns these two into
 * multiplier bounds against the current fit, and always leaves 1 — the fit
 * itself — reachable.
 */
const SCALE_MIN = 0.25
const SCALE_MAX = 3
export const ZOOM_STEP = 1.25

/**
 * WCAG 2.5.8's target minimum, in CSS pixels, and the floor under the fit.
 *
 * A node is at least `nodeSize.height` DRAWING units tall, which is 44 — but
 * drawing units are not pixels, and `fitToViewBox` exists to shrink them. With
 * no floor the desktop fit took a six-track workspace to 0.23 and every node on
 * the map to 10 px: under 2.5.8's 24 px, under the app's own 44, and with 2.9px
 * labels. Nor is the spacing exception available, because stacked entry nodes
 * are ~10px apart and their 24px circles would intersect.
 *
 * So the map REFUSES to shrink past a tappable node and overflows instead. The
 * pan is already built and paid for (`touch-action: none`, the pointer drag),
 * the fit-to-view button is one press away, and the default collapse means the
 * common case never overflows at all.
 */
const MIN_TARGET_PX = 24

/** A pointer that moved further than this was a pan, not a tap. */
const DRAG_SLOP = 4

const WIDE_NODE: NodeSize = DEFAULT_NODE_SIZE
const COMPACT_NODE: NodeSize = { width: 132, height: 44 }
const COMPACT_GAP: Gap = { depth: 34, sibling: 10 }

/**
 * The `density: 'compact'` desktop node, and the number that is NOT reduced.
 *
 * The inline axis shrinks (fewer characters of label per card, which the hover
 * card and the table both make good) and the depth gap tightens, because what
 * binds a wide map is rings across. THE BLOCK SIZE STAYS AT 44 — the same 44 the
 * comfortable node uses, and the same 44 `MIN_TARGET_PX / nodeSize.height` builds
 * the fit floor from. A density preference that shrank the touch target would be
 * a preference for failing WCAG 2.5.8, which is not a preference this app offers;
 * what it buys instead is roughly a third more branches on a laptop before the
 * map overflows into the pan.
 */
const DENSE_NODE: NodeSize = { width: 132, height: 44 }
const DENSE_GAP: Gap = { depth: 44, sibling: 12 }

export interface MapGeometryOptions {
  drawnRoot: MindNodeModel
  compact: boolean
  density: 'compact' | 'comfortable'
  rtl: boolean
  svgRef: RefObject<SVGSVGElement | null>
  setLive: (text: string) => void
  /**
   * Has the drag layer already claimed this press?
   *
   * Read through a callback rather than taken as a value because the controller
   * does not exist yet when this hook is called — `useMindDragLayer` needs
   * `panBy` and `cancelPan` from here, so the two are mutually dependent and the
   * cycle is broken at the only point where it costs nothing: a predicate that
   * is called during an event, long after both have been built.
   */
  isPressing: () => boolean
}

export function useMapGeometry({
  drawnRoot,
  compact,
  density,
  rtl,
  svgRef,
  setLive,
  isPressing,
}: MapGeometryOptions) {
  const [zoom, setZoom] = useState(1)
  /** Bumped by every zoom press; the announcement effect hangs off it. */
  const [zoomTick, setZoomTick] = useState(0)
  /** null = "stay fitted". See the viewBox note in this file's header. */
  const [pan, setPan] = useState<{ x: number; y: number } | null>(null)

  /** Set while a pan is in flight, so the click that ends it is not a tap. */
  const draggedRef = useRef(false)
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  const panStartRef = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null)
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null)

  /**
   * The node box, from the viewport AND the reader's density choice.
   *
   * The phone's size wins outright: it is not a preference there, it is what
   * makes one ring fit 375px at a legible label size (see `depthLimit` below),
   * and offering a "comfortable" that does not fit would be offering a worse
   * screen. On a desktop the two are a real choice and the store remembers it.
   */
  const dense = !compact && density === 'compact'
  const nodeSize = compact ? COMPACT_NODE : dense ? DENSE_NODE : WIDE_NODE
  const gap = compact ? COMPACT_GAP : dense ? DENSE_GAP : DEFAULT_GAP

  /**
   * The busiest branch in the current picture, which is what the area encoding
   * is scaled against. Relative to the workload ON SCREEN rather than to a
   * constant, so a quiet week still shows a shape instead of six identical
   * minimum-size cards.
   */
  const fullAt = useMemo(() => {
    let max = 1
    for (const child of drawnRoot.children) if (child.count > max) max = child.count
    return max
  }, [drawnRoot])

  const sizeOf = useCallback(
    (node: MindNodeModel, depth: number): NodeSize | undefined => {
      // The drawn root is the frame of reference and is not part of the
      // encoding — sizing it by its own total would make it the biggest thing
      // on screen in every workspace, which says nothing.
      if (depth === 0) return undefined
      if (node.kind === 'entry' || node.kind === 'more') {
        // A leaf is one item by definition, so it is never in the encoding
        // either. It gets extra inline room instead, because it carries a
        // sentence-shaped title rather than a one-word bucket name.
        return { width: nodeSize.width * 1.5, height: nodeSize.height }
      }
      return sizeForCount(node.count, {
        min: nodeSize,
        max: { width: nodeSize.width * 1.35, height: nodeSize.height * 1.45 },
        fullAt,
      })
    },
    [nodeSize, fullAt],
  )

  const layout = useMemo(
    () =>
      layoutMindtree(drawnRoot, {
        nodeSize,
        gap,
        sizeOf,
        // ONE RING PER SCREEN ON A PHONE, and this number is measured rather
        // than chosen. MINDTREE-SPEC asks for root + tracks + groups (a limit of
        // 2); laid out for a 341x422 canvas with the tightest node size that
        // still holds a label, a five-track workspace comes to 464x584 drawing
        // units and `fitToViewBox` returns a scale of 0.66 — which renders the
        // 12.5px label at 8.2px. Squeezing the node to 108px only reaches 8.5px,
        // because the binding constraint is the three rings across, not the box.
        // At a limit of 1 the same workspace is 298x260, the scale is 0.96, and
        // the label lands at 12.0px: full size. So the small screen shows one
        // ring at a time and every tap goes one ring deeper, with the breadcrumb
        // as the way back. The handoff states this trade and the numbers behind
        // it plainly; a map whose labels are 8px is the "cramped and unusable"
        // outcome the spec warns against, not a smaller version of this one.
        depthLimit: compact ? 1 : undefined,
        direction: rtl ? 'rtl' : 'ltr',
      }),
    [drawnRoot, nodeSize, gap, sizeOf, compact, rtl],
  )

  const { ref: canvasRef, box } = useBoxSize({ width: 960, height: 520 })

  /**
   * The floor under the fit, DERIVED rather than chosen.
   *
   * `nodeSize.height` is the smallest node the encoding can produce, so
   * `MIN_TARGET_PX / nodeSize.height` is exactly the scale at which the
   * smallest node is still a 24px target. The phone keeps its own, higher floor
   * — 0.62 puts the 12.5px label at 7.8px, which is the point past which a
   * one-handed reader is not reading anything.
   *
   * Below the floor the map overflows and the reader pans. That is the honest
   * outcome and it is now the rare one: `OPEN_DEPTH` means the map opens at the
   * track ring, which fits at 1:1 in every workspace measured.
   */
  const minScale = Math.max(compact ? 0.62 : 0, MIN_TARGET_PX / nodeSize.height)

  const fit = useMemo(
    () =>
      fitToViewBox(layout.bounds, box, {
        padding: 28,
        // Never magnify: text scaled past 1:1 inside a viewBox is text rendered
        // at a size nobody chose.
        maxScale: 1,
        minScale,
      }),
    [layout.bounds, box, minScale],
  )

  /**
   * The window that holds the WHOLE drawing, with no floor and no zoom.
   *
   * Only the export reads it. The on-screen `fit` above refuses to shrink past
   * a tappable node and therefore crops a big map on purpose; a file does not
   * get tapped, so the picture that leaves the app is the whole picture. Same
   * bounds, same padding, same viewport aspect — so the exported frame is the
   * one the reader would see after pressing "Fit to view" on a big enough
   * screen, rather than a different composition.
   */
  const wholeMapFit = useMemo(
    () => fitToViewBox(layout.bounds, box, { padding: 28, maxScale: 1, minScale: 0 }),
    [layout.bounds, box],
  )

  /** The multiplier bounds, against THIS fit — see SCALE_MIN/SCALE_MAX. */
  const zoomBounds = useMemo(
    () => zoomLimits(fit.scale, { minScale: SCALE_MIN, maxScale: SCALE_MAX }),
    [fit.scale],
  )

  /**
   * The zoom, held inside the bounds the CURRENT fit implies.
   *
   * Clamped on read rather than only on write, because the bounds move: an
   * expand, a filter keystroke or a window resize changes `fit.scale`, and a
   * multiplier stored under the old bounds would otherwise strand the reader
   * outside the new ones with the buttons unable to walk back.
   */
  const heldZoom = Math.min(zoomBounds.max, Math.max(zoomBounds.min, zoom))

  const viewWidth = fit.width / heldZoom
  const viewHeight = fit.height / heldZoom
  const centerX = pan?.x ?? fit.x + fit.width / 2
  const centerY = pan?.y ?? fit.y + fit.height / 2
  const viewBox = `${centerX - viewWidth / 2} ${centerY - viewHeight / 2} ${viewWidth} ${viewHeight}`
  const zoomPercent = Math.round(fit.scale * heldZoom * 100)

  const order = layout.nodes

  /* ── the pan the drag layer borrows ───────────────────────────────────── */

  /**
   * Pan by a delta in DRAWING UNITS — what the drag layer's auto-pan and its
   * keyboard reveal both call.
   *
   * ANCHORED IN THE SAME UPDATER, not in a second `setPan` beside it. While `pan`
   * is null the viewBox is recomputed from the fit on every render, so a delta
   * applied to "nothing" would be discarded; and anchoring in a separate write
   * would leave one render between the two in which the map re-centres. One
   * functional updater does both and stays pure, which `zoomBy` below explains
   * at length for the same reason.
   */
  const panBy = useCallback(
    (dx: number, dy: number) => {
      setPan((current) => {
        const base = current ?? { x: fit.x + fit.width / 2, y: fit.y + fit.height / 2 }
        return { x: base.x + dx, y: base.y + dy }
      })
    },
    [fit],
  )

  /**
   * Drop the page's own pan gesture, because the drag has taken it over.
   *
   * Only ever called for a TOUCH lift: a finger is allowed to pan the map from a
   * node until the hold lands (that is the whole argument for the hold), so both
   * gestures are armed for HOLD_MS and one of them has to let go. A mouse press
   * on a draggable node never reaches this component at all — DragLayer stops it
   * — so nothing needs cancelling there.
   */
  const cancelPan = useCallback(() => {
    panStartRef.current = null
    pinchRef.current = null
    pointersRef.current.clear()
    svgRef.current?.removeAttribute('data-panning')
  }, [svgRef])

  /* ── zoom, pan, pinch ─────────────────────────────────────────────────── */

  const clampZoom = useCallback(
    (next: number): number => Math.min(zoomBounds.max, Math.max(zoomBounds.min, next)),
    [zoomBounds],
  )

  const zoomBy = useCallback(
    (factor: number) => {
      // Two independent writes, NOT a setPan nested inside setZoom's updater —
      // an updater must be pure, React may run it twice in development, and a
      // state write from inside one is a side effect that fires as many times
      // as the updater does.
      //
      // Anchoring the pan first is what keeps the picture put: while `pan` is
      // null the viewBox is recomputed from the fit on every render, so zooming
      // without anchoring would re-centre the map on the whole drawing at every
      // press instead of magnifying what the reader is looking at.
      setPan((current) => current ?? { x: fit.x + fit.width / 2, y: fit.y + fit.height / 2 })
      // A FUNCTIONAL UPDATER, not `clampZoom(heldZoom * factor)`. React batches
      // every update raised inside one task, so a value computed from the
      // rendered `heldZoom` is the same value for every press in the batch —
      // measured: fifteen programmatic clicks moved the readout one step. Real
      // clicks land in separate tasks and would have hidden it.
      setZoom((prev) => clampZoom(prev * factor))
      // ANNOUNCED, like every other control on this screen. The two most-used
      // buttons on the map used to be the only ones that said nothing: "Fit to
      // view" called setLive and these did not, and the visible readout is
      // deliberately `aria-live="off"` so it could not stand in. A low-vision
      // user pressing + got no confirmation that anything had happened.
      //
      // Through a counter rather than from here, because the number to announce
      // is the POST-CLAMP one and this function cannot know it — see the effect.
      setZoomTick((n) => n + 1)
    },
    [fit, clampZoom],
  )

  /**
   * The zoom announcement, raised once per press-or-batch, after the clamp.
   *
   * Keyed on the TICK and not on the percentage: pressing + at the ceiling
   * changes nothing, and a reader who hears silence cannot tell "it did not
   * work" from "there is no more". `zoomPercent` is read rather than watched,
   * so a window resize — which moves the fit and therefore the percentage —
   * does not speak.
   */
  useEffect(() => {
    if (zoomTick === 0) return
    setLive(t('mindtree.zoomLevel', { pct: zoomPercent }))
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomTick])

  const resetView = useCallback(() => {
    setZoom(1)
    setPan(null)
    setLive(t('mindtree.zoomLevel', { pct: Math.round(fit.scale * 100) }))
  }, [fit.scale, setLive])

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      // A press the drag layer has already claimed is not a pan. A MOUSE press
      // on a draggable node never reaches this handler at all (DragLayer stops
      // it), but a FINGER does — deliberately, so the map can still be panned
      // from a node until the hold lands — and this is the second half of that:
      // once the hold HAS landed, `onPanCancel` has cleared the pan and this
      // guard keeps a second finger from starting a new one under the ghost.
      if (isPressing()) return
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      draggedRef.current = false
      if (pointersRef.current.size === 1) {
        panStartRef.current = {
          x: event.clientX,
          y: event.clientY,
          cx: centerX,
          cy: centerY,
        }
        event.currentTarget.setPointerCapture(event.pointerId)
      } else if (pointersRef.current.size === 2) {
        const [a, b] = [...pointersRef.current.values()]
        // `heldZoom`, not the raw state: a resize or an expand moves the fit and
        // therefore the bounds, and a pinch anchored on an out-of-bounds
        // multiplier would jump the moment the second finger lands.
        if (a && b) pinchRef.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: heldZoom }
        panStartRef.current = null
      }
    },
    [centerX, centerY, heldZoom, isPressing],
  )

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (!pointersRef.current.has(event.pointerId)) return
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

      const pinch = pinchRef.current
      if (pointersRef.current.size >= 2 && pinch !== null) {
        const [a, b] = [...pointersRef.current.values()]
        if (!a || !b) return
        const distance = Math.hypot(a.x - b.x, a.y - b.y)
        if (pinch.distance > 0) {
          draggedRef.current = true
          setZoom(clampZoom(pinch.zoom * (distance / pinch.distance)))
          setPan((current) => current ?? { x: fit.x + fit.width / 2, y: fit.y + fit.height / 2 })
        }
        return
      }

      const start = panStartRef.current
      if (start === null || box.width <= 0 || box.height <= 0) return
      const dx = event.clientX - start.x
      const dy = event.clientY - start.y
      if (!draggedRef.current && Math.hypot(dx, dy) < DRAG_SLOP) return
      // Written straight to the DOM rather than held in state. The grab cursor
      // is the one thing on this screen that has to change on the first pixel
      // of a drag, and routing it through a re-render would re-render every
      // node in the map to change a CSS cursor. `draggedRef` is a ref for the
      // same reason — a ref read during render would never repaint anyway,
      // which is what made the first cut's `data-panning` prop dead code.
      draggedRef.current = true
      svgRef.current?.setAttribute('data-panning', '')
      // Pixels → drawing units. The drawing's x axis is NOT mirrored by `dir`
      // (SVG coordinates never are — the layout module mirrored the geometry
      // instead), so this arithmetic is identical in both directions.
      setPan({
        x: start.cx - (dx * viewWidth) / box.width,
        y: start.cy - (dy * viewHeight) / box.height,
      })
    },
    [box, viewWidth, viewHeight, fit, clampZoom, svgRef],
  )

  const endPointer = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      pointersRef.current.delete(event.pointerId)
      if (pointersRef.current.size < 2) pinchRef.current = null
      if (pointersRef.current.size === 0) {
        panStartRef.current = null
        svgRef.current?.removeAttribute('data-panning')
        // Cleared on the next frame, not now: the synthetic click that follows a
        // pointerup fires after this handler, and clearing it here would let a
        // drag that ended over a node open that node's entry.
        window.setTimeout(() => {
          draggedRef.current = false
        }, 0)
      }
    },
    [svgRef],
  )

  return {
    layout,
    order,
    canvasRef,
    box,
    fit,
    wholeMapFit,
    viewBox,
    viewWidth,
    viewHeight,
    centerX,
    centerY,
    zoomPercent,
    draggedRef,
    panBy,
    cancelPan,
    zoomBy,
    resetView,
    onPointerDown,
    onPointerMove,
    endPointer,
  }
}

export type MapGeometry = ReturnType<typeof useMapGeometry>
