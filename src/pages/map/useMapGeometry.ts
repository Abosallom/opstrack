// THE CAMERA — one window on a drawing that never moves, and the four gestures
// that move the window.
//
// ── WHAT THIS FILE STOPPED DOING, AND WHY THAT IS THE POINT ────────────────
//
// It used to build the drawing AND hold the view, and the two were wired
// together in a loop nobody could see from either end:
//
//     depthLimit → layout → bounds → fit.scale → zoomBounds → heldZoom → depthLimit
//
// Every link was defensible on its own. Together they meant that zooming
// changed how many rings were drawn, which changed the drawing's extent, which
// changed the fit, which re-clamped the zoom — so the picture re-laid-out
// itself under the reader roughly a dozen times per tier, and every node on the
// map glided to new coordinates each time. A reader watching that is watching a
// tree that scales, plus wobble. It is not a camera.
//
// THE CHAIN NOW HAS NO FIRST LINK, and it has none BY CONSTRUCTION rather than
// by care:
//
//     geometry ← (department tree, direction)        ONE arrow, and not here
//     LOD      ← (camera, box)
//     camera   ← (gestures, tweens, one mount-time read of bounds)
//     paint    ← (filter)                            never reaches geometry
//
// `depthLimit` is not a camera input and `bounds` is not a camera output. The
// hook cannot recompute the drawing because IT CANNOT SEE THE LAYOUT MODULE AT
// ALL: the layout arrives as an argument, typed structurally, and there is no
// import path from here to `layoutWorlds`. "The camera never feeds the
// geometry" is therefore a fact about the module graph rather than a rule
// somebody has to keep remembering.
//
// ── ONE VALUE OF STATE ─────────────────────────────────────────────────────
//
// `camera = {cx, cy, width, height}` in DRAWING UNITS, plus a tween ref. That
// is all of it. `zoom`, `heldZoom`, `zoomBounds`, `clampZoom`, `zoomBy`,
// `resetView`, `fit`, `depthLimit`, `sizeOfForLimit`, `altitude` and its four
// named stops are all gone, and every one of them existed to describe a
// MULTIPLIER OF A MOVING FIT. An absolute width does not move when the drawing
// does, so there is nothing left to re-clamp and nothing left to hold in two
// places. `pan === null` is retired with them: "stay fitted" was only ever
// needed because bounds moved.
//
// `scale = box.width / camera.width` — drawing units per CSS pixel — is derived
// where it is needed and stored nowhere.
//
// ── ZOOM IS A viewBox, NEVER A CSS TRANSFORM ───────────────────────────────
//
// Unchanged and still the reason the arithmetic is here: a `scale()` on the
// <svg> resamples text and moves hit-testing away from where the marks appear
// at fractional scales.
//
// ── AND THE ANCHOR IS THE BUG FIX ──────────────────────────────────────────
//
// The three gesture sites in this file used to resolve `pan === null` to the
// FIT CENTRE before they could move it, so every pinch anchored on the middle
// of the drawing rather than on the fingers and the picture slid out from under
// the reader's hand. All three now call `anchoredZoom` on a point the reader
// chose — the cursor, or the two-pointer midpoint — which is what makes "the
// thing you zoom into becomes the whole frame" true with no target selection
// anywhere in the app.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { fitToViewBox, type ViewBoxFit } from '../../lib/mindtree/layout'
import {
  anchoredZoom,
  beginCameraTween,
  cameraAtWidth,
  clampCamera,
  FRAME_FILL_DESKTOP,
  FRAME_FILL_PHONE,
  frameCamera,
  MAP_TWEEN_MS,
  octavesOf,
  retargetCameraTween,
  ROOT_FLOOR_FILL,
  rubberBandCamera,
  sampleCamera,
  viewBoxOf,
  wheelRatio,
  ZOOM_HEADROOM,
  type Camera,
  type CameraBounds,
  type CameraTween,
  type Occlusion,
} from './mapMotion'
import { useBoxSize, type Box } from './useMapViewport'

/** A pointer that moved further than this was a pan, not a tap. */
const DRAG_SLOP = 4

/**
 * How long after the last wheel event the camera springs back off a bound.
 *
 * A pinch has a release — a finger leaves the glass — and a wheel does not, so
 * the wheel's "release" has to be measured. 220ms is long enough that a
 * continuous scroll does not fight the spring mid-gesture and short enough that
 * the recoil still reads as part of the same motion.
 */
const WHEEL_SETTLE_MS = 220

/** Nothing is covering the stage. The RESTING camera always frames with this. */
const NO_OCCLUSION: Occlusion = { inlineEnd: 0, blockEnd: 0 }

/* ─────────────────── what the camera needs from the drawing ───────────────── */

/**
 * One node's world, as the CAMERA sees it — a centre and a diameter, plus
 * whether it is a place the dive may stop.
 *
 * STRUCTURAL means `kind` is `'root' | 'track' | 'entity'`: a department tier.
 * A `group`, `more` or `entry` node is drawn as CONTENT inside its owner's world
 * and can never become the frame, which is the owner's correction — *"the
 * leveling for department wise not org and info side bar"* — made mechanical.
 * The camera reads the flag for exactly one purpose: the deepest structural
 * world in the workspace sets the terminus.
 *
 * Declared here rather than imported so this file has NO edge to the layout
 * module. `WorldNode` satisfies it structurally.
 */
export interface CameraWorld {
  readonly worldX: number
  readonly worldY: number
  readonly worldD: number
  readonly structural: boolean
}

/**
 * The drawing, as the CAMERA sees it. `WorldLayout` satisfies it structurally.
 *
 * `revision` changes IFF THE TREE CHANGED — not when the filter narrows, not
 * when the reader collapses a branch, not when the window resizes. It is the
 * only thing that may re-frame the camera after mount, because it is the only
 * thing that can make a remembered framing point at coordinates the drawing no
 * longer occupies.
 */
export interface CameraLayout<W extends CameraWorld = CameraWorld> {
  readonly nodes: readonly W[]
  readonly byId: ReadonlyMap<string, W>
  /** `Bounds`, in full, because the export's `fitToViewBox` wants all six. */
  readonly bounds: {
    readonly minX: number
    readonly minY: number
    readonly maxX: number
    readonly maxY: number
    readonly width: number
    readonly height: number
  }
  /** Diameter of the root world, drawing units. The far end of the dive. */
  readonly rootD: number
  readonly revision: string
}

export interface MapGeometryOptions<L extends CameraLayout> {
  /**
   * THE DRAWING, BUILT ELSEWHERE AND HANDED IN. One arrow, at mount.
   *
   * Passed rather than built here so that no camera value can reach the layout
   * call — see this file's header. It is also what lets this hook be reasoned
   * about, and tested, without the layout module existing.
   */
  layout: L
  /**
   * The world the INITIAL camera frames — `focusView.node.id`.
   *
   * `useMapFocus` already resolves `?focus=` and the store, with a
   * deepest-surviving-ancestor fallback and a three-writer convergence guard.
   * That resolution is not re-derived here and must not be.
   */
  focusWorldId: string | null
  /** Phone. Decides `FRAME_FILL` and nothing else in this file. */
  compact: boolean
  rtl: boolean
  svgRef: RefObject<SVGSVGElement | null>
  /**
   * Has the drag layer already claimed this press?
   *
   * Read through a callback rather than taken as a value because the controller
   * does not exist yet when this hook is called — `useMindDragLayer` needs
   * `panBy` and `cancelPan` from here, so the two are mutually dependent and the
   * cycle is broken at the only point where it costs nothing.
   */
  isPressing: () => boolean
  /**
   * CSS px of the stage the floating panel covers at the inline END, and the
   * phone sheet at the block END. MEASURED by those components' own
   * ResizeObservers and threaded here, never assumed from a media query.
   *
   * THEY DO NOT MOVE THE RESTING CAMERA. Occlusion reaches the camera on a FLY
   * and nowhere else: opening a panel that shoved the map sideways would be the
   * same teleport this design exists to prevent, arriving from the other side.
   */
  occludeInline: number
  occludeBlockEnd: number
  /**
   * The reader asked for less motion. PROGRAMMATIC moves become instant; the
   * wheel and the pinch stay continuous, because direct manipulation is the
   * reader's own hand rather than motion the app inflicted.
   *
   * An ARGUMENT, not a `matchMedia` read — `PulseLayer.useReducedMotion` is the
   * one subscription and the shell threads it, which is what keeps the rule
   * assertable without a browser.
   */
  reducedMotion?: boolean
}

/* ────────────────────────────── the hook ─────────────────────────────────── */

interface CameraState {
  /** The tree this camera was framed against. */
  readonly revision: string
  readonly camera: Camera
  /**
   * True until the camera has been framed against a MEASURED stage.
   *
   * The `useState` initializer necessarily runs before the ResizeObserver has
   * reported anything, so the first camera is framed against `useBoxSize`'s
   * fallback box. This flag lets exactly one correction happen when the real
   * measurement lands, and never again — a later resize keeps the reader's
   * camera and only re-derives its height, because a window drag that re-framed
   * the map would be a teleport.
   */
  readonly provisional: boolean
}

export function useMapGeometry<L extends CameraLayout>({
  layout,
  focusWorldId,
  compact,
  rtl,
  svgRef,
  isPressing,
  occludeInline,
  occludeBlockEnd,
  reducedMotion = false,
}: MapGeometryOptions<L>) {
  const { ref: measureRef, box } = useBoxSize({ width: 960, height: 520 })

  /* ── the two ends of the dive ───────────────────────────────────────────── */

  /**
   * THE TERMINUS'S DIAMETER — the smallest STRUCTURAL world in the workspace.
   *
   * WHERE I DEPART FROM THE CONTRACT, AND THE REASON IS THE WHOLE POINT OF THE
   * UNIT. It asks for *"D(deepest structural world on the CURRENT PATH)"*. The
   * current path is `worldAt(camera)`'s ancestors — so a bound derived from it
   * would be `camera → bounds → camera`, which is a feedback cycle of exactly
   * the shape this file was rewritten to destroy, and one that can oscillate: a
   * clamp that moves the camera can move the path that produced the clamp.
   *
   * The smallest structural world in the TREE is a mount-time constant, it
   * permits at least as much magnification as any path needs, and it costs one
   * linear scan when the admin changes the tree. The price is real and is named:
   * on a shallow path the reader may magnify further past their deepest
   * department than the terminus strictly intends. A dead stop that is slightly
   * too generous is recoverable; a clamp that argues with itself is not.
   */
  const deepestD = useMemo(() => {
    let smallest = layout.rootD > 0 ? layout.rootD : 1
    for (const node of layout.nodes) {
      if (!node.structural) continue
      if (Number.isFinite(node.worldD) && node.worldD > 0 && node.worldD < smallest) {
        smallest = node.worldD
      }
    }
    return smallest
  }, [layout])

  /**
   * The two ends, in DRAWING UNITS OF CAMERA WIDTH.
   *
   * `minWidth` is the terminus: `D / ZOOM_HEADROOM` puts the deepest
   * department's world at 2.2× the width of the window, which is as close as the
   * dive goes. `maxWidth` is the far end: wide enough that the root world still
   * spans `ROOT_FLOOR_FILL` of the stage's smaller dimension, so pulling all the
   * way back lands on a picture rather than on the void beside it.
   *
   * NOT A CAMERA INPUT ANYWHERE IN ITS DERIVATION — `rootD` and `deepestD` are
   * facts about the tree, and `box` is the element, which is `inset: 0` and does
   * not resize when something is drawn over it.
   */
  const cameraBounds = useMemo<CameraBounds>(() => {
    const rootD = layout.rootD > 0 ? layout.rootD : 1
    const v = Math.max(1, Math.min(box.width, box.height))
    return {
      maxWidth: (rootD * Math.max(1, box.width)) / (ROOT_FLOOR_FILL * v),
      minWidth: deepestD / ZOOM_HEADROOM,
    }
  }, [layout.rootD, deepestD, box])

  const frameFill = compact ? FRAME_FILL_PHONE : FRAME_FILL_DESKTOP

  /* ── the one read of layout.bounds ──────────────────────────────────────── */

  /**
   * THE CAMERA'S ONLY ARROW FROM THE LAYOUT, and it fires when the admin changes
   * the tree rather than when the reader breathes.
   *
   * Called from the `useState` initializer and from the revision guard below —
   * never from a memo the camera consults each render. That is the structural
   * difference between this file and the one it replaces: there is no expression
   * anywhere in the render path whose value depends on both the camera and the
   * drawing's extent, so there is nothing for a cycle to run around.
   *
   * NO OCCLUSION. The resting camera never sees it.
   */
  const initialCamera = useCallback(
    (viewport: Box): Camera => {
      const framed = focusWorldId === null ? undefined : layout.byId.get(focusWorldId)
      const world = framed ?? {
        // The fallback is the whole drawing, and it is the ONLY read of
        // `layout.bounds` in this file's camera path.
        worldX: layout.bounds.minX + layout.bounds.width / 2,
        worldY: layout.bounds.minY + layout.bounds.height / 2,
        worldD: Math.max(layout.bounds.width, layout.bounds.height),
      }
      return clampCamera(
        frameCamera(world, { viewport, frameFill, occlusion: NO_OCCLUSION, rtl }),
        cameraBounds,
      )
    },
    // `cameraBounds` is in the closure and is derived from `box`; the callers
    // are the initializer and the revision guard, both of which want the
    // bounds current at the moment they run.
    [layout, focusWorldId, frameFill, rtl, cameraBounds],
  )

  const [state, setState] = useState<CameraState>(() => ({
    revision: layout.revision,
    camera: initialCamera({ width: 960, height: 520 }),
    provisional: true,
  }))

  /**
   * THE ADMIN CHANGED THE TREE. Re-frame, once, and only for that.
   *
   * A `setState` during render is React's own idiom for adjusting state when a
   * prop changes, and it is the right one here: an effect would paint one frame
   * of the old camera against the new drawing, which is a visible flash of the
   * map at coordinates that no longer mean anything.
   */
  if (state.revision !== layout.revision) {
    setState({ revision: layout.revision, camera: initialCamera(box), provisional: false })
  }

  const stored = state.camera

  /**
   * The camera AS DRAWN — the stored width with the element's aspect.
   *
   * The viewBox and the element must agree about aspect or the map letterboxes,
   * and every pixel↔unit conversion in this file and in `useMapOverlays` is
   * `dx · camera.width / box.width`, which is exact only while they do. A resize
   * therefore changes the camera's HEIGHT and nothing else: the window got
   * taller, so you see more. It does not move.
   */
  const camera = useMemo<Camera>(() => {
    if (!(box.width > 0) || !(box.height > 0) || !(stored.width > 0)) return stored
    const height = (stored.width * box.height) / box.width
    return height === stored.height ? stored : { ...stored, height }
  }, [stored, box])

  /** The camera the loop last painted, or the rendered one when nothing flies. */
  const paintedRef = useRef<Camera | null>(null)
  const cameraRef = useRef<Camera>(camera)
  cameraRef.current = camera
  const boundsRef = useRef<CameraBounds>(cameraBounds)
  boundsRef.current = cameraBounds
  const boxRef = useRef<Box>(box)
  boxRef.current = box
  const reducedRef = useRef(reducedMotion)
  reducedRef.current = reducedMotion

  const liveCamera = useCallback((): Camera => paintedRef.current ?? cameraRef.current, [])

  /* ── the frame loop, and it is the only part that cannot be tested ──────── */

  const tweenRef = useRef<CameraTween | null>(null)
  const rafRef = useRef<number | null>(null)
  const springRef = useRef<number | null>(null)

  /** Drop the tween WHERE IT STANDS. The reader has taken the camera back. */
  const dropTween = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (tweenRef.current === null) return
    tweenRef.current = null
    const painted = paintedRef.current
    paintedRef.current = null
    if (painted === null) return
    // `cameraRef` too, and not only the state: a gesture that drops a tween
    // reads the camera again in the SAME event — `onPointerDown` takes its pan
    // origin from it — and React has not re-rendered yet. Without this the
    // gesture would start from wherever the camera was before the fly, and the
    // map would jump by the whole distance the tween had covered.
    cameraRef.current = painted
    setState((prev) => ({ ...prev, camera: painted, provisional: false }))
  }, [])

  /**
   * Move the camera by ARITHMETIC ON A FRAME LOOP, because `viewBox` is an SVG
   * presentation attribute with no CSS counterpart and there is no
   * `transition: viewBox` to write.
   *
   * The loop writes through `viewBoxOf`, which is the ONE formatter, so the
   * final frame is byte-identical to the string React renders from the settled
   * state and there is nothing for React to correct. Without that the map would
   * stick wherever the loop left it, because React only writes an attribute when
   * the prop changed between renders.
   */
  const flyToCamera = useCallback(
    (to: Camera, durationMs?: number) => {
      if (springRef.current !== null) {
        window.clearTimeout(springRef.current)
        springRef.current = null
      }
      const now = performance.now()
      const active = tweenRef.current
      const options = { reducedMotion: reducedRef.current, durationMs }
      const next =
        active === null
          ? beginCameraTween(liveCamera(), to, now, options)
          : // A SECOND FLY BENDS THE MOVE rather than snapping: it restarts from
            // where the camera actually is at this instant.
            retargetCameraTween(active, to, now, options)

      if (next === null) {
        // Already there. `null` is the honest answer to "move to where you are",
        // and running a loop for it would paint four identical frames.
        dropTween()
        setState((prev) => ({ ...prev, camera: to, provisional: false }))
        return
      }

      tweenRef.current = next
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)

      const tick = (): void => {
        rafRef.current = null
        const tween = tweenRef.current
        if (tween === null) return
        const { camera: at, done } = sampleCamera(tween, performance.now())
        svgRef.current?.setAttribute('viewBox', viewBoxOf(at))
        if (!done) {
          paintedRef.current = at
          rafRef.current = requestAnimationFrame(tick)
          return
        }
        tweenRef.current = null
        paintedRef.current = null
        // Same reason as `dropTween`: a gesture arriving between the last frame
        // and React's next render must see where the camera actually landed.
        cameraRef.current = at
        setState((prev) => ({ ...prev, camera: at, provisional: false }))
      }
      tick()
    },
    [dropTween, liveCamera, svgRef],
  )

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      if (springRef.current !== null) window.clearTimeout(springRef.current)
    },
    [],
  )

  /* ── the public moves ───────────────────────────────────────────────────── */

  /**
   * WRITE THE CAMERA, AND MAKE IT READABLE IN THE SAME TASK.
   *
   * `cameraRef` is updated before the state, and that is not belt-and-braces:
   * React batches every update raised inside one task, so two wheel events in
   * one frame — which a trackpad delivers routinely — would both read the
   * RENDERED camera and the second would overwrite the first, collapsing two
   * notches into one. The old file recorded exactly this defect against its zoom
   * buttons ("fifteen programmatic clicks moved the readout one step") and
   * solved it with a functional updater; a functional updater is not available
   * here because the anchor has to be resolved against the camera the gesture is
   * actually looking at, so the read side is what gets fixed instead.
   *
   * The stored width is the RUBBER-BANDED one, not the raw one, so the picture
   * and the state can never disagree about where the map is — every pixel↔unit
   * conversion downstream reads the same value the viewBox does.
   */
  const writeCamera = useCallback((next: Camera) => {
    const drawn = rubberBandCamera(next, boundsRef.current)
    cameraRef.current = drawn
    setState((prev) => ({ ...prev, camera: drawn, provisional: false }))
  }, [])

  /**
   * Spring back off a bound once the gesture has let go.
   *
   * `MAP_TWEEN_MS`, not a derived duration: the recoil is a RESPONSE to the
   * release rather than a journey, and it is the same 240ms the stylesheet
   * spends on every other settle on this screen. It is NOT a spring in the
   * physical sense and deliberately so — a spring has no end time, and a motion
   * with no end time cannot be made instant for a reader who asked for that.
   */
  const springBack = useCallback(() => {
    const at = liveCamera()
    const clamped = clampCamera(at, boundsRef.current)
    if (clamped === at) return
    flyToCamera(clamped, MAP_TWEEN_MS)
  }, [flyToCamera, liveCamera])

  const setCamera = useCallback(
    (next: Camera) => {
      dropTween()
      const held = clampCamera(next, boundsRef.current)
      cameraRef.current = held
      setState((prev) => ({ ...prev, camera: held, provisional: false }))
    },
    [dropTween],
  )

  const frameOptionsRef = useRef({ frameFill, occludeInline, occludeBlockEnd, rtl })
  frameOptionsRef.current = { frameFill, occludeInline, occludeBlockEnd, rtl }

  /**
   * FLY TO A WORLD — a tap on a department, a crumb, a rail release.
   *
   * The one place occlusion enters the camera: the world is framed in the
   * rectangle the reader can actually see through, so a dive with the panel open
   * lands beside the panel rather than behind it.
   */
  const flyTo = useCallback(
    (world: { readonly worldX: number; readonly worldY: number; readonly worldD: number }) => {
      const options = frameOptionsRef.current
      const framed = frameCamera(world, {
        viewport: boxRef.current,
        frameFill: options.frameFill,
        occlusion: { inlineEnd: options.occludeInline, blockEnd: options.occludeBlockEnd },
        rtl: options.rtl,
      })
      flyToCamera(clampCamera(framed, boundsRef.current))
    },
    [flyToCamera],
  )

  /**
   * The camera framed against a MEASURED stage, exactly once.
   *
   * Guarded on `provisional`, so this fires on the first real measurement and
   * never again — a reader resizing a window keeps their camera.
   */
  useEffect(() => {
    if (!state.provisional) return
    if (!(box.width > 0) || !(box.height > 0)) return
    setState((prev) =>
      prev.provisional ? { ...prev, camera: initialCamera(box), provisional: false } : prev,
    )
  }, [state.provisional, box, initialCamera])

  /* ── what the rest of the page reads ────────────────────────────────────── */

  const viewWidth = camera.width
  const viewHeight = camera.height
  const centerX = camera.cx
  const centerY = camera.cy
  const viewBox = viewBoxOf(camera)
  const scale = box.width > 0 && camera.width > 0 ? box.width / camera.width : 1

  /**
   * STILL RETURNED, NO LONGER RENDERED. The "copy for a deck" caption prints the
   * scale a FILE was taken at, which is a fact about a file rather than a
   * control on a screen. Nothing in the chrome reads it.
   */
  const zoomPercent = Math.round(scale * 100)

  /**
   * The window that holds the WHOLE drawing — the EXPORT's frame, and the only
   * fit left in the file.
   *
   * It reads `layout.bounds`, and it is allowed to: it is keyed on the layout
   * and the element, never on the camera, so a wheel does not recompute it and
   * it cannot appear in any cycle. A file does not get covered by a panel, so it
   * ignores occlusion, and it has no floor because a picture that leaves the app
   * is the whole picture.
   */
  const wholeMapFit = useMemo<ViewBoxFit>(
    () => fitToViewBox(layout.bounds, box, { padding: 28, maxScale: 1, minScale: 0 }),
    [layout.bounds, box],
  )

  /**
   * WHERE THE READER IS ON THE DIVE, in octaves, zeroed at the widest view the
   * camera allows so the rail can be `min={0} max={octaveSpan}` with no offset
   * arithmetic at the control.
   *
   * A difference of two `octavesOf` readings rather than a second formula, so
   * the rail and the fly agree about what an octave is by construction.
   */
  const vMin = Math.max(1, Math.min(box.width, box.height))
  const octaveFloor = octavesOf(cameraAtWidth(camera, cameraBounds.maxWidth), layout.rootD, vMin)
  const octaves = octavesOf(camera, layout.rootD, vMin) - octaveFloor
  const octaveSpan =
    octavesOf(cameraAtWidth(camera, cameraBounds.minWidth), layout.rootD, vMin) - octaveFloor

  /* ── pointer arithmetic ─────────────────────────────────────────────────── */

  /**
   * A client point in DRAWING UNITS, against the camera as it is RIGHT NOW.
   *
   * The drawing's x axis is not mirrored by `dir` — SVG coordinates never are,
   * and the layout module mirrors the geometry instead — so this arithmetic is
   * identical in both reading directions and there is no `rtl` term in it.
   */
  const toDrawing = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const rect = svgRef.current?.getBoundingClientRect()
      const width = rect !== undefined && rect.width > 0 ? rect.width : Math.max(1, boxRef.current.width)
      const height =
        rect !== undefined && rect.height > 0 ? rect.height : Math.max(1, boxRef.current.height)
      const left = rect?.left ?? 0
      const top = rect?.top ?? 0
      const at = liveCamera()
      return {
        x: at.cx - at.width / 2 + ((clientX - left) / width) * at.width,
        y: at.cy - at.height / 2 + ((clientY - top) / height) * at.height,
      }
    },
    [liveCamera, svgRef],
  )

  /* ── the wheel ──────────────────────────────────────────────────────────── */

  /**
   * WHEEL IS ALWAYS ZOOM, anchored under the cursor.
   *
   * `preventDefault` is not politeness: the stage does not scroll, and on macOS
   * a trackpad pinch arrives as `ctrl+wheel`, where the default action is to
   * PAGE-ZOOM THE BROWSER. That is why the listener is attached non-passively
   * below rather than as a React prop — React's root listeners are passive and a
   * passive listener may not call `preventDefault`.
   *
   * No accumulator, no throttle, no rAF batching. Each event writes state
   * directly and React's own batching is the only smoothing needed, because
   * nothing downstream of the camera is recomputed.
   */
  const onWheel = useCallback(
    (event: WheelEvent) => {
      event.preventDefault()
      dropTween()
      const anchor = toDrawing(event.clientX, event.clientY)
      writeCamera(anchoredZoom(liveCamera(), anchor, wheelRatio(event)))
      if (springRef.current !== null) window.clearTimeout(springRef.current)
      springRef.current = window.setTimeout(() => {
        springRef.current = null
        springBack()
      }, WHEEL_SETTLE_MS)
    },
    [dropTween, liveCamera, springBack, toDrawing, writeCamera],
  )

  const onWheelRef = useRef(onWheel)
  onWheelRef.current = onWheel
  const wheelCleanupRef = useRef<(() => void) | null>(null)

  /**
   * The canvas ref — the size measurement AND the non-passive wheel listener,
   * composed into one callback ref.
   *
   * A callback ref rather than an effect over `svgRef.current`, because a ref
   * object's `.current` is not a reactive value: an effect reading it would
   * attach nothing on any commit where the map stage was not mounted, and would
   * never re-run to fix it when the reader switched back from the table.
   *
   * The listener is on the CANVAS WRAPPER rather than the `<svg>` so that a
   * wheel over the empty margin around a small drawing still zooms — the
   * wrapper is the stage, and the stage is the map.
   */
  const canvasRef = useCallback(
    (el: HTMLDivElement | null) => {
      wheelCleanupRef.current?.()
      wheelCleanupRef.current = null
      measureRef(el)
      if (el === null) return
      // Through a ref, so the identity of this callback — and therefore the
      // attach/detach cycle — does not change every time the camera moves.
      const handler = (event: WheelEvent): void => onWheelRef.current(event)
      el.addEventListener('wheel', handler, { passive: false })
      wheelCleanupRef.current = (): void => el.removeEventListener('wheel', handler)
    },
    [measureRef],
  )

  useEffect(() => () => wheelCleanupRef.current?.(), [])

  /* ── the pan the drag layer borrows ─────────────────────────────────────── */

  /** Set while a pan is in flight, so the click that ends it is not a tap. */
  const draggedRef = useRef(false)
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  const panStartRef = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null)
  const pinchRef = useRef<{
    distance: number
    midX: number
    midY: number
    anchor: { x: number; y: number }
    camera: Camera
  } | null>(null)

  /**
   * Pan by a delta in DRAWING UNITS — the drag layer's auto-pan and its keyboard
   * reveal. No anchoring left to do: there is no "stay fitted" to resolve.
   */
  const panBy = useCallback(
    (dx: number, dy: number) => {
      dropTween()
      const at = liveCamera()
      writeCamera({ ...at, cx: at.cx + dx, cy: at.cy + dy })
    },
    [dropTween, liveCamera, writeCamera],
  )

  /**
   * Drop the page's own pan gesture, because the drag has taken it over.
   *
   * Only ever called for a TOUCH lift: a finger is allowed to pan the map from a
   * node until the hold lands — that is the whole argument for the hold — so
   * both gestures are armed for HOLD_MS and one of them has to let go.
   */
  const cancelPan = useCallback(() => {
    panStartRef.current = null
    pinchRef.current = null
    pointersRef.current.clear()
    svgRef.current?.removeAttribute('data-panning')
  }, [svgRef])

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      // A press the drag layer has already claimed is not a pan.
      if (isPressing()) return
      // A FINGER ON THE GLASS DROPS THE TWEEN WHERE IT STANDS. The reader has
      // taken the camera back and the app has no business arguing.
      dropTween()
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      draggedRef.current = false
      if (pointersRef.current.size === 1) {
        const at = liveCamera()
        panStartRef.current = { x: event.clientX, y: event.clientY, cx: at.cx, cy: at.cy }
        event.currentTarget.setPointerCapture(event.pointerId)
      } else if (pointersRef.current.size === 2) {
        const [a, b] = [...pointersRef.current.values()]
        if (a !== undefined && b !== undefined) {
          const midX = (a.x + b.x) / 2
          const midY = (a.y + b.y) / 2
          pinchRef.current = {
            distance: Math.hypot(a.x - b.x, a.y - b.y),
            midX,
            midY,
            // THE ANCHOR IS THE MIDPOINT, resolved once at the start of the
            // gesture and held: re-resolving it per frame against a camera the
            // same gesture is moving is how a pinch drifts.
            anchor: toDrawing(midX, midY),
            camera: liveCamera(),
          }
        }
        panStartRef.current = null
      }
    },
    [dropTween, isPressing, liveCamera, toDrawing],
  )

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (!pointersRef.current.has(event.pointerId)) return
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

      const pinch = pinchRef.current
      if (pointersRef.current.size >= 2 && pinch !== null) {
        const [a, b] = [...pointersRef.current.values()]
        if (a === undefined || b === undefined) return
        const distance = Math.hypot(a.x - b.x, a.y - b.y)
        if (!(pinch.distance > 0) || !(distance > 0)) return
        draggedRef.current = true

        // ONE CONTINUOUS MOVE, NOT A ZOOM FOLLOWED BY A CORRECTION. The scale is
        // anchored on the midpoint the gesture started from, and the midpoint's
        // own travel pans in the same expression — so a pinch-and-shove lands
        // where the reader's hand says it should rather than where a zoom about
        // a fixed point would have put it.
        //
        // Computed from the camera AT THE START of the gesture each frame rather
        // than incrementally, so float error cannot accumulate over a gesture
        // that may run for hundreds of frames.
        const zoomed = anchoredZoom(pinch.camera, pinch.anchor, pinch.distance / distance)
        const width = Math.max(1, boxRef.current.width)
        const height = Math.max(1, boxRef.current.height)
        const midX = (a.x + b.x) / 2
        const midY = (a.y + b.y) / 2
        writeCamera({
          ...zoomed,
          cx: zoomed.cx - ((midX - pinch.midX) * zoomed.width) / width,
          cy: zoomed.cy - ((midY - pinch.midY) * zoomed.height) / height,
        })
        return
      }

      const start = panStartRef.current
      if (start === null || box.width <= 0 || box.height <= 0) return
      const dx = event.clientX - start.x
      const dy = event.clientY - start.y
      if (!draggedRef.current && Math.hypot(dx, dy) < DRAG_SLOP) return
      // Written straight to the DOM rather than held in state. The grab cursor
      // is the one thing on this screen that has to change on the first pixel of
      // a drag, and routing it through a re-render would re-render every node in
      // the map to change a CSS cursor.
      draggedRef.current = true
      svgRef.current?.setAttribute('data-panning', '')
      // Pixels → drawing units. The drawing's x axis is NOT mirrored by `dir`
      // (SVG coordinates never are — the layout module mirrored the geometry
      // instead), so this arithmetic is identical in both directions.
      //
      // ABSOLUTE FROM THE PRESS, not a sum of deltas: `start.cx` was captured
      // when the finger landed, so a dropped move event costs nothing and float
      // error cannot accumulate over a drag.
      writeCamera({
        ...liveCamera(),
        cx: start.cx - (dx * viewWidth) / box.width,
        cy: start.cy - (dy * viewHeight) / box.height,
      })
    },
    [box, liveCamera, viewWidth, viewHeight, svgRef, writeCamera],
  )

  const endPointer = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      pointersRef.current.delete(event.pointerId)
      if (pointersRef.current.size < 2 && pinchRef.current !== null) {
        pinchRef.current = null
        // THE SPRING IS THE ONLY "YOU HAVE ARRIVED" SIGNAL IN THE DESIGN, and it
        // costs no chrome: past the terminus the picture resists, and on release
        // it recoils to the stop.
        springBack()
      }
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
    [springBack, svgRef],
  )

  return {
    layout,
    /**
     * The drawing's nodes, WITH THE CALLER'S OWN ELEMENT TYPE.
     *
     * `L` is generic and its constraint is `CameraLayout<CameraWorld>`, so a
     * plain `layout.nodes` reads at the CONSTRAINT's element type — the four
     * fields this file needs — and every downstream consumer (the roving tab
     * stop, the overlays, the drag layer, the node renderer) would lose the
     * dozen it needs. The indexed access says "whatever L's own nodes are",
     * which is exactly what was passed in, and it is the only cast in the file.
     */
    order: layout.nodes as L['nodes'],
    canvasRef,
    box,
    /** The one piece of view state, in drawing units. */
    camera,
    setCamera,
    flyTo,
    /** Drawing units per CSS pixel — what the LOD bands are measured against. */
    scale,
    octaves,
    octaveSpan,
    cameraBounds,
    /**
     * ALREADY ATTACHED, non-passively, by `canvasRef`. Returned so the behaviour
     * is nameable and testable — DO NOT ATTACH IT A SECOND TIME.
     */
    onWheel,
    zoomPercent,
    wholeMapFit,
    viewBox,
    viewWidth,
    viewHeight,
    centerX,
    centerY,
    draggedRef,
    panBy,
    cancelPan,
    onPointerDown,
    onPointerMove,
    endPointer,
  }
}

export type MapGeometry = ReturnType<typeof useMapGeometry<CameraLayout>>
