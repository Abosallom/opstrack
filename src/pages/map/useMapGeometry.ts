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
// ── WHO IS ALLOWED TO CALL setState, AND WHEN ──────────────────────────────
//
// Three of the four gestures move the camera by ARITHMETIC ON AN ATTRIBUTE and
// tell React once, at rest. That split is not an optimisation looking for a
// place to happen; it is a consequence of what each gesture changes:
//
//     gesture          changes            React must see it
//     ─────────────────────────────────────────────────────────────────
//     pan (drag)       cx, cy             at rest       ← paintCamera
//     pan (trackpad)   cx, cy             at rest       ← paintCamera
//     throw            cx, cy             at rest       ← paintCamera
//     zoom / pinch     width  → scale     every event   ← writeCamera
//
// `scale = box.width / camera.width` is what `lod.ts` bands every label, chip
// and card against, so a ZOOM that React cannot see would draw the map at one
// magnification and letter it for another. A PAN changes no scale, nothing
// downstream of it needs re-deriving, and the `setState` it used to raise
// re-rendered 161 `MindNode`s per pointer move to move four numbers in one
// attribute. `docs/MAP-EVIDENCE.md` §3 predicted precisely that — "This is most
// of what 'not smooth' actually is" — and it is the only one of that document's
// five recommendations that was never built.
//
// The rule the split has to keep is the one `mapMotion.test.ts` guards: what is
// painted imperatively and what React renders for the settled state must be the
// SAME BYTES, or React sees no changed prop, writes nothing, and the map sticks.
// `commitPainted` carries the argument for how a pan earns that without having a
// destination to land on.
//
// ── AND THE THIRD GESTURE IS NEW ───────────────────────────────────────────
//
// A drag used to stop dead on release. `startGlide` gives it momentum, with the
// physics in `mapMotion` (`beginPanGlide` / `samplePanGlide`) so that all of it
// except the rAF is pure and tested. A reader who asked for reduced motion gets
// no glide at all — not a shorter one.
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
  beginPanGlide,
  clampCamera,
  frameBox,
  // The pure "centre this box, keep the reader's zoom" solver, aliased because
  // the frame LOOP below already owns the name `flyToCamera`. Renaming the loop
  // instead would rename the thing every comment in this file points at.
  flyToCamera as cameraShowing,
  MAP_TWEEN_MS,
  retargetCameraTween,
  rubberBandCamera,
  sampleCamera,
  samplePanGlide,
  viewBoxOf,
  wheelIntent,
  wheelPixels,
  wheelRatio,
  type Camera,
  type CameraBounds,
  type CameraTween,
  type MotionBox,
  type Occlusion,
  type PanGlide,
  type PanSample,
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

/**
 * How many pointer positions the pan keeps, for the throw to measure itself
 * against.
 *
 * 8, and the number is a consequence rather than a choice: `panVelocity` looks
 * back `FLING_WINDOW_MS` (80ms), a 120Hz trackpad delivers a move about every
 * 8ms, and 80/8 is ten — so eight is one frame short of covering the window on
 * the fastest hardware sold, and a ninth entry would buy a millisecond of a
 * chord that is already averaged over five frames on a 60Hz screen. The buffer
 * is bounded because it is written on EVERY pointer move: an unbounded array
 * over a thirty-second drag is thousands of objects the velocity never reads.
 */
const FLING_SAMPLES = 8

/** Nothing is covering the stage. The RESTING camera always frames with this. */
const NO_OCCLUSION: Occlusion = { inlineEnd: 0, blockEnd: 0 }

/* ─────────────────── what the camera needs from the drawing ───────────────── */

/**
 * One node, as the CAMERA sees it — WHERE IT IS AND HOW BIG, and nothing else.
 *
 * ── WHY THIS STOPPED BEING A DISC ──────────────────────────────────────────
 *
 * It was `{worldX, worldY, worldD, structural, childIds}` — a node's own world,
 * because the drawing was containment and a node's extent was the disc its whole
 * subtree was packed inside. The drawing is now a vertical tidy tree, which
 * emits RECTANGLES and no discs at all, so a camera reading `worldD` off it
 * produced a NaN viewBox and a blank screen. `pages/map/treePreview.ts` bolted
 * stand-in discs on so the tree could be looked at before this landed; it is
 * deleted with this change, and this interface is why.
 *
 * `structural` went with it: it meant "a department tier the dive may stop at",
 * and it existed to pick the terminus of a dive through nested worlds. There is
 * no dive through a tree — its depth is the fold, not the zoom — and the zoom
 * ends are now a fact about pixels (see `cameraBounds`), so nothing here needs
 * to know which nodes are tiers.
 *
 * Declared here rather than imported so this file has NO edge to the layout
 * module's layout functions. `PositionedNode` satisfies it structurally, with no
 * adapter anywhere.
 */
/**
 * The authored tidy-tree card, in drawing units. MUST match the `nodeSize`
 * `Mindtree.tsx` hands the layout — `mapMotion.test.ts` reads both out of the
 * source and fails if they drift, because a near end derived from the wrong
 * card is a near end that is quietly wrong on every screen.
 */
const CARD_W = 168
const CARD_H = 54

/**
 * How much of the stage one card may fill at the closest zoom.
 *
 * Two terms because the map's pane is WIDE AND SHORT — measured 1238 x 401 on a
 * laptop, since the chrome above and the composer below take the rest — and the
 * two axes bind on different devices. On a phone the width runs out first; on a
 * laptop the height does. Taking the smaller of the two is what keeps "a card
 * never becomes the whole picture" true on both.
 */
const CARD_MAX_OF_WIDTH = 0.9
const CARD_MAX_OF_HEIGHT = 0.55

/**
 * The near end of the zoom, in CSS pixels per drawing unit, for a stage of this
 * size. Pure, exported, and tested directly — the hook below is a `useEffect`
 * over a ResizeObserver and cannot be rendered under `environment: 'node'`.
 *
 * ⚠ AN EARLIER VERSION OF THIS ASKED `lod.ts` FOR THE FRAME EDGE — `bandFloorPx('frame',
 *   min(w, h)) / D_LEAF` — and it was wrong ON THE ONLY STAGE THAT MATTERS. That
 *   edge is floored at an absolute 380px, so every pane shorter than about 447px
 *   lands on the floor, and the map's own pane is 401 tall. It computed 1.90,
 *   the `max(2, …)` lifted it back to 2, and the desktop the owner was
 *   complaining about got no improvement whatsoever. It was found by measuring
 *   the running page, not by reading the code.
 *
 * This asks the question directly instead: at what scale does the AUTHORED CARD
 * fill as much of the stage as it is allowed to? That is a fact about the
 * drawing's own unit and the window, which is exactly what the paragraph beside
 * `maxPxPerUnit` argues the near end must be — and it is not a fact about the
 * data, so it does not move when an admin adds a department.
 */
export function nearEndPxPerUnit(box: { width: number; height: number }): number {
  const w = Math.max(1, box.width)
  const h = Math.max(1, box.height)
  return Math.max(
    2,
    Math.min((CARD_MAX_OF_WIDTH * w) / CARD_W, (CARD_MAX_OF_HEIGHT * h) / CARD_H),
  )
}

export interface CameraBox {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  /**
   * This node's own children, by id. Kept on the interface because the drag
   * layer and the overlays read the layout through this hook's `order`, and
   * because a camera that could not tell a leaf from a branch could not answer
   * "is there anything under this" without a second pass over `nodes`.
   */
  readonly childIds: readonly string[]
}

/**
 * The drawing, as the CAMERA sees it. `MindtreeLayout` satisfies it
 * structurally.
 *
 * NO `revision` HERE ANY MORE, and that is the point of the change rather than
 * tidying: see `MapGeometryOptions.revision`. A revision that lived ON the
 * layout was necessarily a fact about the layout, and with real folding the
 * layout changes on every fold — so the guard that re-frames the camera would
 * have fired on the commonest gesture on the screen.
 */
export interface CameraLayout<B extends CameraBox = CameraBox> {
  readonly nodes: readonly B[]
  readonly byId: ReadonlyMap<string, B>
  /** `Bounds`, in full, because the export's `fitToViewBox` wants all six. */
  readonly bounds: {
    readonly minX: number
    readonly minY: number
    readonly maxX: number
    readonly maxY: number
    readonly width: number
    readonly height: number
  }
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
   * ⚠ THE REVISION GUARD, AND IT IS AN ARGUMENT RATHER THAN A FIELD ON THE
   *   LAYOUT BECAUSE OF WHAT FOLDING DID TO IT.
   *
   * `revision` must change IFF THE TREE CHANGED — not when the filter narrows,
   * not when the reader folds a branch, not when the window resizes. It is the
   * only thing that may re-frame the camera after mount, because it is the only
   * thing that can make a remembered framing point at coordinates the drawing no
   * longer occupies.
   *
   * While it lived on `WorldLayout` it satisfied that sentence for free: nothing
   * could fold, so the layout only changed when the tree did. With real folding
   * the LAYOUT changes on every fold — different nodes, different bounds — so a
   * revision derived from the layout would teleport the camera on the commonest
   * gesture on the screen, which is the exact defect this whole file was
   * rewritten to destroy, arriving through the one door that was left open.
   *
   * So the page computes it over the FULL tree, IGNORING `collapsed`, and hands
   * it in. Admin edits the hierarchy → re-frame (correct). Reader folds → the
   * camera holds, and the page calls `reveal()` with the branch that opened.
   */
  revision: string
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
   * wheel, the pinch and the drag stay continuous, because direct manipulation
   * is the reader's own hand rather than motion the app inflicted.
   *
   * ⚠ THE THROW IS ON THE PROGRAMMATIC SIDE OF THAT LINE, and the placement is
   *   the whole point of naming it: a glide happens AFTER the hand has left the
   *   glass, so it is motion the app chose, not the reader. `startGlide` is
   *   therefore skipped entirely under this flag rather than shortened.
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
  revision,
  rtl,
  svgRef,
  isPressing,
  occludeInline,
  occludeBlockEnd,
  reducedMotion = false,
}: MapGeometryOptions<L>) {
  const { ref: measureRef, box } = useBoxSize({ width: 960, height: 520 })

  /* ── the two ends of the zoom ───────────────────────────────────────────── */

  /**
   * The window that holds the WHOLE drawing — the EXPORT's frame, AND the far
   * end of the zoom.
   *
   * It reads `layout.bounds`, and it is allowed to: it is keyed on the layout
   * and the element, never on the camera, so a wheel does not recompute it and
   * it cannot appear in any cycle. A file does not get covered by a panel, so it
   * ignores occlusion, and it has no floor because a picture that leaves the app
   * is the whole picture.
   *
   * MOVED ABOVE `cameraBounds` rather than left at the foot of the file, because
   * it is now what the far end of the zoom IS — see below.
   */
  const wholeMapFit = useMemo<ViewBoxFit>(
    () => fitToViewBox(layout.bounds, box, { padding: 28, maxScale: 1, minScale: 0 }),
    [layout.bounds, box],
  )

  /**
   * THE MOST CSS PIXELS ONE DRAWING UNIT MAY BE WORTH — the near end of the
   * zoom, and the whole of it.
   *
   * A tidy tree's card is authored at 168x54 with a 12.5px label, so 2:1 puts
   * that label at 25px — large, and the largest that is still a MAP rather than
   * a poster of one card. Past it the reader is inside a single word with no
   * context on the glass, which is the state every reader who has ever
   * over-zoomed a canvas describes as "lost".
   *
   * IT IS A FACT ABOUT PIXELS, NOT ABOUT THE TREE, and that is the change. The
   * containment drawing's near end was `D(deepest structural world)/2.2` — a
   * measurement of the DATA — because a dive's terminus is a place. A tree has
   * no places to arrive at, so a limit derived from the tree would be a limit
   * that moves when an admin adds a department, for no reason the reader could
   * see.
   *
   * ⚠ ALL OF THE ABOVE STANDS, AND THE CONSTANT BELOW IT DID NOT. The argument
   *   rules out a limit derived from the DATA. It says nothing about a limit
   *   derived from the WINDOW — and "the reader is inside a single word with no
   *   context on the glass" is a question about the window, which is a
   *   distinction `lod.ts`'s own header already draws: "LEGIBILITY IS
   *   ABSOLUTE… 'IS THIS THING THE FRAME' IS NOT ABSOLUTE. It is a question
   *   about the window."
   *
   *   A flat 2 was absolute where the question is relative, and it delivered
   *   four different pictures rather than one. Measured, in card pitches across
   *   the frame at the ceiling:
   *
   *       375 x 560   1.03   ← already the wall the paragraph above fears
   *      1024 x 700   2.81
   *      1600 x 760   4.40   ← stops with two octaves of context unspent
   *
   *   The owner's report was "still i can not zoom in details in the maps", on a
   *   desktop, where 2 was leaving the most room unused.
   */

  /**
   * As close as the camera goes: THE POINT AT WHICH ONE CARD WOULD BECOME THE
   * FRAME, AND NO CLOSER — a sentence `lod.ts` already owns and already tests.
   *
   * `bandFloorPx('frame', v)` is `max(380, 0.85 * v)`: the world fills the stage
   * bar a margin, and past it the world IS the stage. `D_LEAF` is the diameter
   * of a world holding exactly one 168x44 card, which is precisely what a tidy
   * tree's card is — so the ratio is the card's own apparent size at the frame
   * edge, in the bands' own unit.
   *
   * ⚠ `Math.max(2, …)` KEEPS TODAY'S CONSTANT AS A FLOOR, so no viewport gets
   *   less zoom than it has now and the phone's ceiling is byte-identical.
   *
   * ⚠ AND IT IS `box`, NOT `viewportMinPx`. Mindtree.tsx's `viewportMinPx`
   *   subtracts the details panel; this must not, because `cameraBounds` promises
   *   below that it is derived from the ELEMENT and not from anything drawn over
   *   it. Opening the panel may not change how far the reader can zoom.
   *
   * ⚠ AND IT DOES NOT DEPEND ON WHAT IS UNDER THE CAMERA. A per-node near end
   *   would make `minWidth` a function of `camera.cx/cy`, so a pan at maximum
   *   zoom would push the camera OUT — a pan that changes scale. The whole file
   *   is arranged around "pan changes cx/cy, zoom changes width", and
   *   `MapCanvas` banks on a pan never rebuilding the bands.
   */
  const maxPxPerUnit = nearEndPxPerUnit(box)

  /**
   * The two ends, in DRAWING UNITS OF CAMERA WIDTH.
   *
   * `minWidth` is as close as the camera goes: the element's own width divided
   * by the pixels-per-unit ceiling. `maxWidth` is as far back as it goes: the
   * window that holds the whole drawing, so pulling all the way out lands on the
   * picture and never on the void beside it.
   *
   * BOTH ENDS ARE SPRUNG, unchanged: `rubberBandCamera` draws past them under a
   * live gesture and `springBack` recoils to them on release, which is the only
   * "you have arrived" signal in the design and costs no chrome.
   *
   * NOT A CAMERA INPUT ANYWHERE IN ITS DERIVATION — `wholeMapFit` is the layout
   * and the element, and `box` is the element, which is `inset: 0` and does not
   * resize when something is drawn over it.
   */
  const cameraBounds = useMemo<CameraBounds>(
    () => ({
      maxWidth: Math.max(wholeMapFit.width, 1),
      minWidth: Math.max(box.width, 1) / maxPxPerUnit,
    }),
    [wholeMapFit.width, box.width, maxPxPerUnit],
  )

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
   * IT FRAMES THE WHOLE DRAWING, and that is not a retreat from framing the
   * drill-in: the layout is BUILT from `focusView.node`, so the drawing IS the
   * focused subtree and its bounds are that subtree's bounds. `focusWorldId` was
   * therefore a second spelling of the same answer, and it is gone.
   *
   * `maxScale: 1` — a drawing smaller than the window is shown at 1:1 and
   * centred, never blown up to fill it. Same rule, and the same reason, as
   * `wholeMapFit`'s: text inside a viewBox scaled past 1:1 is text rendered at a
   * size nobody chose.
   *
   * NO OCCLUSION. The resting camera never sees it.
   */
  const initialCamera = useCallback(
    (viewport: Box): Camera =>
      clampCamera(
        frameBox(
          {
            x: layout.bounds.minX,
            y: layout.bounds.minY,
            width: layout.bounds.width,
            height: layout.bounds.height,
          },
          { viewport, occlusion: NO_OCCLUSION, rtl, maxScale: 1 },
        ),
        cameraBounds,
      ),
    // `cameraBounds` is in the closure and is derived from `box`; the callers
    // are the initializer and the revision guard, both of which want the
    // bounds current at the moment they run.
    [layout, rtl, cameraBounds],
  )

  const [state, setState] = useState<CameraState>(() => ({
    revision,
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
   *
   * ⚠ `revision` IS THE ARGUMENT AND NOT `layout.revision`, and that difference
   *   is the fold. See `MapGeometryOptions.revision`.
   */
  if (state.revision !== revision) {
    setState({ revision, camera: initialCamera(box), provisional: false })
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

  /* ── painting behind React's back, and settling up afterwards ───────────── */

  /**
   * WRITE THE viewBox STRAIGHT ONTO THE ELEMENT, WITHOUT TELLING REACT.
   *
   * ── THE DEFECT THIS EXISTS TO KILL ─────────────────────────────────────────
   *
   * `onPointerMove` called `writeCamera`, which calls `setState`, so every
   * pointer move during a pan re-rendered the page: 161 `MindNode`s, the crumb
   * bar, the whole camera context. At a trackpad's move rate that is a re-render
   * every few milliseconds to change four numbers in one attribute, and the map
   * dropped frames on a gesture that should be the cheapest thing it does.
   * `docs/MAP-EVIDENCE.md` §3 named it in advance — "Write `viewBox` directly in
   * the pointermove handler … This is most of what 'not smooth' actually is" —
   * and it was the one recommendation of the five that never got built. Only the
   * TWEEN wrote imperatively.
   *
   * ── AND WHY THIS IS NOT A SECOND WAY TO MOVE THE CAMERA ────────────────────
   *
   * It is the tween loop's own two lines, lifted out and named: the same
   * `rubberBandCamera` `writeCamera` applies, the same `viewBoxOf` formatter the
   * loop writes through, the same `paintedRef` that makes `liveCamera()` answer
   * with what is ON SCREEN rather than with what React last rendered. There is
   * still exactly one formatter and exactly one place the attribute is written
   * from arithmetic.
   *
   * ⚠ ONLY EVER FOR A PURE PAN — a translation, never a change of `width`.
   *   `scale` is `box.width / camera.width`, and `lod.ts` bands every label and
   *   chip against it, so a zoom that did not reach React would leave the map
   *   drawn at one magnification and lettered for another. A pan cannot: the LOD
   *   is identical at both ends of it, which is exactly why the re-render it was
   *   paying for bought nothing.
   */
  const paintCamera = useCallback(
    (next: Camera): Camera => {
      const drawn = rubberBandCamera(next, boundsRef.current)
      paintedRef.current = drawn
      // `cameraRef` too, for `writeCamera`'s own reason: a handler that reads the
      // camera again in the same task — the wheel, a second pointer landing —
      // must see where the map actually is, and React has not re-rendered.
      cameraRef.current = drawn
      svgRef.current?.setAttribute('viewBox', viewBoxOf(drawn))
      return drawn
    },
    [svgRef],
  )

  /**
   * TELL REACT WHERE THE ELEMENT ALREADY IS — the ONE `setState` a whole gesture
   * costs, raised when the gesture is over.
   *
   * ── HOW THE BYTE-IDENTITY INVARIANT SURVIVED THE CHANGE ────────────────────
   *
   * `mapMotion.test.ts` holds a rule this file cannot be allowed to break: the
   * last value written imperatively must be byte-identical to the string React
   * renders for the settled state, because React only writes an attribute when
   * the PROP changed between renders — so a loop that left a value React does
   * not believe needs correcting leaves the map stuck there. The tween earns it
   * by ending exactly on `to` and formatting through `viewBoxOf`. A pan has no
   * `to` to end on, so it earns it a second way:
   *
   *   · The value committed here is the EXACT object `paintCamera` last drew,
   *     rubber-banded, not the raw gesture arithmetic recomputed — so state and
   *     attribute cannot disagree by a float.
   *   · React renders `viewBoxOf(camera)`, and `camera` is the aspect memo over
   *     the stored value: `height = width · box.height / box.width`. That memo is
   *     IDEMPOTENT ON ITS OWN OUTPUT — feeding it a height it just computed
   *     returns the same height and the same object — and every camera reaching
   *     `paintCamera` came from `liveCamera()`, which is the memo's output. A pan
   *     changes only `cx`/`cy`, so the height passes through untouched and the
   *     memo has nothing to correct.
   *
   * So `viewBoxOf(committed) === viewBoxOf(painted)`, character for character,
   * and the one thing React does write on the commit is the string that is
   * already on the element.
   */
  const commitPainted = useCallback(() => {
    const painted = paintedRef.current
    paintedRef.current = null
    if (painted === null) return
    cameraRef.current = painted
    setState((prev) => (prev.camera === painted ? prev : { ...prev, camera: painted, provisional: false }))
  }, [])

  /* ── the frame loop, and it is the only part that cannot be tested ──────── */

  const tweenRef = useRef<CameraTween | null>(null)
  const rafRef = useRef<number | null>(null)
  const springRef = useRef<number | null>(null)
  /** The throw in flight, and the camera it was released from. */
  const glideRef = useRef<{ glide: PanGlide; from: Camera } | null>(null)

  /**
   * DROP EVERY IMPERATIVE MOTION WHERE IT STANDS, and tell React where that is.
   * The reader has taken the camera back and the app has no business arguing.
   *
   * ⚠ IT NO LONGER RETURNS EARLY WHEN THERE IS NO TWEEN, and that is a fix
   *   rather than tidying. It used to bail on `tweenRef.current === null` before
   *   it reached `paintedRef`, which was safe only while the tween was the ONLY
   *   thing that painted imperatively. A pan and a throw paint too, so a press
   *   landing mid-throw would have hit the early return and left the thrown
   *   position painted on the element and absent from React — the two out of
   *   sync, which is the precise state the byte-identity invariant exists to
   *   forbid. Committing unconditionally costs nothing: `commitPainted` is a
   *   no-op when nothing was painted.
   */
  const dropTween = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    tweenRef.current = null
    glideRef.current = null
    commitPainted()
  }, [commitPainted])

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
      // A PROGRAMMATIC MOVE OUTRANKS A THROW. Both drive `rafRef` and both write
      // the same attribute, so leaving the glide live would put two loops on one
      // `viewBox` — the stutter that looks like dropped frames and is not. The
      // glide's painted position is NOT discarded with it: `liveCamera()` still
      // reads `paintedRef`, so the fly bends out of wherever the throw had got
      // to, which is the same contract a second fly gets.
      glideRef.current = null
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

  /**
   * The two measured occlusions and the reading direction, through a ref so the
   * two moves below keep stable identities across a panel resize — `dive` in
   * `pages/Mindtree.tsx` is a memo over them, and every node on the map lives
   * under the `onKeyDown` that memo builds.
   */
  const frameOptionsRef = useRef({ occludeInline, occludeBlockEnd, rtl })
  frameOptionsRef.current = { occludeInline, occludeBlockEnd, rtl }

  /**
   * FRAME A BOX — a tap on a branch, a crumb, a search result.
   *
   * The one place occlusion enters the camera: the box is framed in the
   * rectangle the reader can actually see through, so arriving with the panel
   * open lands beside the panel rather than behind it.
   *
   * ⚠ THE CALLER DECIDES WHAT THE BOX IS, and for a branch it should be
   *   `subtreeBounds(layout, id)` rather than the node's own card — "take me to
   *   Infrastructure" means the department, not the 168x54 rectangle with its
   *   name in it. That resolution is the page's because `subtreeBounds` is the
   *   layout module's, and this file has no edge to it.
   *
   * `maxScale: 1` — never magnify past 1:1 to fill the window with a small
   * target. A single card asked for at 6.8:1 is a poster of one word.
   */
  const flyTo = useCallback(
    (target: MotionBox) => {
      const options = frameOptionsRef.current
      const framed = frameBox(target, {
        viewport: boxRef.current,
        occlusion: { inlineEnd: options.occludeInline, blockEnd: options.occludeBlockEnd },
        rtl: options.rtl,
        maxScale: 1,
      })
      flyToCamera(clampCamera(framed, boundsRef.current))
    },
    [flyToCamera],
  )

  /**
   * REVEAL A BOX — THE MINIMUM MOVE, AND IT NEVER TOUCHES THE READER'S ZOOM.
   *
   * This is what a FOLD calls. Opening a branch grows the drawing downward, and
   * the branch that opened may land wholly below the window — so the camera has
   * to pan to it, and it must NOT re-frame: a reader who chose a zoom and then
   * opened a branch did not ask to be taken somewhere else at a magnification
   * they did not pick. `flyToCamera` (the pure one, imported as `cameraShowing`)
   * is exactly that rule: the scale factor is at least 1, so the camera pulls
   * back only when the box is too big for the window it is in, and never in.
   *
   * IT IS ALSO THE FIRST PRODUCTION CALL OF THAT FUNCTION. It was written,
   * tested and unreached while the drawing was containment, because there a
   * branch is a world you fly INTO and the minimum move was never the answer.
   */
  const reveal = useCallback(
    (target: MotionBox) => {
      flyToCamera(
        clampCamera(
          cameraShowing(target, liveCamera(), { maxWidth: boundsRef.current.maxWidth }),
          boundsRef.current,
        ),
      )
    },
    [flyToCamera, liveCamera],
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

  /*
   * `wholeMapFit` USED TO STAND HERE. It is declared at the top of the hook now,
   * beside `cameraBounds`, because it is what the far end of the zoom IS — and a
   * value read by a memo two hundred lines above its own declaration is a value
   * nobody can check the cycle-freedom of by reading downwards.
   *
   * `octaves` / `octaveSpan` ARE DELETED. They said where the reader was on a
   * DIVE THROUGH NESTED WORLDS, measured in doublings of the root world's
   * diameter, and a tidy tree has neither: its depth is the fold, not the zoom.
   * `octavesOf` stays exported from mapMotion — it is pure, tested, and the
   * depth rail that replaces `MapDiveRail` will not want it either, so it is
   * kept rather than deleted only until that rail lands.
   */

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
   * A WHEEL ZOOMS, EXCEPT WHEN IT IS A TRACKPAD SWIPE, IN WHICH CASE IT PANS.
   *
   * ── WHAT THIS COMMENT USED TO SAY, AND WHY IT WAS WRONG ────────────────────
   *
   * "WHEEL IS ALWAYS ZOOM." That is right for a mouse and wrong for the laptop
   * this app is actually worked on: on a Mac trackpad a two-finger swipe is a PAN
   * GESTURE that the platform can only deliver through the wheel event, and it
   * says so by carrying a meaningful `deltaX`. Under the old rule that swipe
   * changed the magnification — sideways finger travel resizing the map — which
   * is the loudest single item in "feels like it's full of bugs and glitches".
   * `wheelIntent` carries the whole classification argument and is unit tested
   * against real event shapes; the safe direction is zoom, because zoom is what
   * this map already did.
   *
   * `preventDefault` is not politeness: the stage does not scroll, and on macOS
   * a trackpad pinch arrives as `ctrl+wheel`, where the default action is to
   * PAGE-ZOOM THE BROWSER. That is why the listener is attached non-passively
   * below rather than as a React prop — React's root listeners are passive and a
   * passive listener may not call `preventDefault`.
   *
   * ── THE TWO PATHS COST DIFFERENT AMOUNTS, AND THE REASON IS THE LOD ────────
   *
   * The ZOOM path writes state on every event, as it always has: `scale` changes,
   * and `lod.ts` bands every label and chip against `scale`, so a zoom React
   * cannot see would draw the map at one magnification and letter it for another.
   * React's own batching is the only smoothing it needs.
   *
   * The PAN path paints the attribute directly and commits once when the events
   * stop — the same trade `onPointerMove` makes, for the same reason: a
   * translation changes no scale, so re-deriving anything downstream of it buys
   * nothing. The settle timer already existed for the spring; it now also carries
   * the commit, so the whole swipe costs ONE render however many events it was.
   */
  const onWheel = useCallback(
    (event: WheelEvent) => {
      event.preventDefault()

      if (wheelIntent(event) === 'pan') {
        // A swipe takes the camera back from a fly or a throw exactly as a finger
        // would. Guarded rather than unconditional so the second and subsequent
        // events of one swipe do not each raise `commitPainted`'s `setState`,
        // which would hand back the per-event render this path exists to avoid.
        if (tweenRef.current !== null || glideRef.current !== null) dropTween()
        const travel = wheelPixels(event)
        const at = liveCamera()
        const stage = boxRef.current
        // POSITIVE deltaY MEANS "SCROLL DOWN", so the window moves down the
        // drawing and the content appears to move up — the same sign a document
        // gets, which is what makes a Mac's natural scrolling track the fingers.
        // The drag's sign is the opposite because a drag moves the PICTURE and a
        // scroll moves the WINDOW; both are what their own gesture means.
        paintCamera({
          ...at,
          cx: at.cx + (travel.x * at.width) / Math.max(1, stage.width),
          cy: at.cy + (travel.y * at.height) / Math.max(1, stage.height),
        })
        if (springRef.current !== null) window.clearTimeout(springRef.current)
        springRef.current = window.setTimeout(() => {
          springRef.current = null
          commitPainted()
          springBack()
        }, WHEEL_SETTLE_MS)
        return
      }

      dropTween()
      const anchor = toDrawing(event.clientX, event.clientY)
      writeCamera(anchoredZoom(liveCamera(), anchor, wheelRatio(event)))
      if (springRef.current !== null) window.clearTimeout(springRef.current)
      springRef.current = window.setTimeout(() => {
        springRef.current = null
        springBack()
      }, WHEEL_SETTLE_MS)
    },
    [commitPainted, dropTween, liveCamera, paintCamera, springBack, toDrawing, writeCamera],
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
  /** The last few pointer positions, for the throw to take its speed from. */
  const panSamplesRef = useRef<PanSample[]>([])
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
   * THE MAP KEEPS GOING WHEN THE FINGER LETS GO — inertial pan.
   *
   * ── WHY THERE WAS NOTHING HERE, AND WHY THAT READ AS A BUG ─────────────────
   *
   * A drag used to stop dead on `pointerup`. Every touch surface a reader has
   * ever used carries momentum, so a map that does not feels less like a
   * deliberate choice and more like the app dropped the gesture — which is
   * exactly the vocabulary the owner reached for ("full of bugs and glitches")
   * for a screen with no functional defect in it at all.
   *
   * ── THE PHYSICS IS IN mapMotion, AND ONLY THE LOOP IS HERE ─────────────────
   *
   * `beginPanGlide` decides whether the release was a throw, `samplePanGlide`
   * says how far it has travelled at an instant, and both are pure and unit
   * tested with a fake clock. What is left here is a rAF and a conversion — nine
   * lines, and the only part a browser is needed to run.
   *
   * ⚠ `reducedMotion` SKIPS IT ENTIRELY, and the check is inside
   *   `beginPanGlide` rather than here so the rule is a property of a pure
   *   function. mapMotion's stated rule is that reduced motion makes a move
   *   INSTANT rather than shorter; a throw has no destination to be instantly
   *   at, so its instant form is the camera staying exactly where the finger
   *   left it, and `beginPanGlide` answers `null`.
   *
   * ── AND EVERY FRAME GOES THROUGH THE DRAG'S OWN CLAMP ──────────────────────
   *
   * `paintCamera` rubber-bands against `boundsRef` exactly as `writeCamera`
   * does, so the throw cannot reach a camera the drag could not. Honestly: today
   * that is a NO-OP for a throw, because `CameraBounds` constrains WIDTH and a
   * pan does not change width — there is no positional bound on this map to
   * fling past. It is written this way regardless so the glide is not the one
   * write in the file that bypasses the clamp, and so a positional bound, if one
   * is ever added, is obeyed by the throw for free rather than by a second edit
   * somebody has to remember.
   */
  const startGlide = useCallback(
    (now: number) => {
      const samples = panSamplesRef.current
      panSamplesRef.current = []
      const glide = beginPanGlide(samples, now, { reducedMotion: reducedRef.current })
      if (glide === null) return
      const from = liveCamera()
      glideRef.current = { glide, from }
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)

      const tick = (): void => {
        rafRef.current = null
        const live = glideRef.current
        if (live === null) return
        const { dx, dy, done } = samplePanGlide(live.glide, performance.now())
        const width = Math.max(1, boxRef.current.width)
        const height = Math.max(1, boxRef.current.height)
        // The drag's own sign and the drag's own conversion: the picture follows
        // the travel, so the camera moves AGAINST it. Absolute from the release
        // rather than a sum of per-frame deltas, for the reason `onPointerMove`
        // states about the press.
        paintCamera({
          ...live.from,
          cx: live.from.cx - (dx * live.from.width) / width,
          cy: live.from.cy - (dy * live.from.height) / height,
        })
        if (!done) {
          rafRef.current = requestAnimationFrame(tick)
          return
        }
        glideRef.current = null
        // THE SECOND OF THE GESTURE'S TWO `setState`s, and the last: one on
        // release so React knows where the throw began, one here so it knows
        // where it ended.
        commitPainted()
      }
      tick()
    },
    [commitPainted, liveCamera, paintCamera],
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
    // AND THE SAMPLES, so the node drag that just claimed this press cannot be
    // followed by a throw when the finger lifts. The reader was moving a node,
    // not the map, and a map that glided away underneath the drop would be the
    // worst possible moment for momentum.
    panSamplesRef.current = []
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
      // A NEW PRESS MEASURES A NEW THROW. Left over, the previous gesture's tail
      // would be averaged into this one's release and the map would fly off a
      // tap that happened to follow a flick.
      panSamplesRef.current = []
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
      const stage = boxRef.current
      if (start === null || stage.width <= 0 || stage.height <= 0) return
      const dx = event.clientX - start.x
      const dy = event.clientY - start.y
      if (!draggedRef.current && Math.hypot(dx, dy) < DRAG_SLOP) return
      // Written straight to the DOM rather than held in state. The grab cursor
      // is the one thing on this screen that has to change on the first pixel of
      // a drag, and routing it through a re-render would re-render every node in
      // the map to change a CSS cursor.
      draggedRef.current = true
      svgRef.current?.setAttribute('data-panning', '')

      // THE RELEASE'S EVIDENCE, collected while the finger is still down because
      // `pointerup` carries a position and no history. Bounded at
      // `FLING_SAMPLES` — this runs on every move of every drag.
      const samples = panSamplesRef.current
      samples.push({ x: event.clientX, y: event.clientY, t: performance.now() })
      if (samples.length > FLING_SAMPLES) samples.splice(0, samples.length - FLING_SAMPLES)

      // Pixels → drawing units. The drawing's x axis is NOT mirrored by `dir`
      // (SVG coordinates never are — the layout module mirrored the geometry
      // instead), so this arithmetic is identical in both directions.
      //
      // ABSOLUTE FROM THE PRESS, not a sum of deltas: `start.cx` was captured
      // when the finger landed, so a dropped move event costs nothing and float
      // error cannot accumulate over a drag.
      //
      // ⚠ `paintCamera`, NOT `writeCamera` — THIS IS THE FIX. `writeCamera`
      //   raises a `setState`, so this handler used to re-render 161 `MindNode`s
      //   plus the whole chrome once per pointer move to change four numbers in
      //   one attribute. See `paintCamera`'s header, and `endPointer` for the
      //   single `setState` that settles up on release.
      //
      // The camera's own SIZE comes from `liveCamera()` rather than from the
      // rendered `viewWidth`/`viewHeight`, which is what lets this handler keep
      // one identity for the life of the screen: during a pan React's copy is
      // deliberately stale, so reading the rendered pair would have been reading
      // the one value that is now guaranteed out of date.
      const at = liveCamera()
      paintCamera({
        ...at,
        cx: start.cx - (dx * at.width) / stage.width,
        cy: start.cy - (dy * at.height) / stage.height,
      })
    },
    [liveCamera, paintCamera, svgRef, writeCamera],
  )

  const endPointer = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      pointersRef.current.delete(event.pointerId)
      if (pointersRef.current.size < 2 && pinchRef.current !== null) {
        pinchRef.current = null
        // THE SPRING IS THE ONLY "YOU HAVE ARRIVED" SIGNAL IN THE DESIGN, and it
        // costs no chrome: past either end of the zoom the picture resists, and
        // on release it recoils to the stop.
        springBack()
      }
      if (pointersRef.current.size === 0) {
        const panned = panStartRef.current !== null && draggedRef.current
        panStartRef.current = null
        svgRef.current?.removeAttribute('data-panning')
        if (panned) {
          // ONE `setState` FOR THE WHOLE DRAG, HERE, and it is the other half of
          // the fix in `onPointerMove`. React and the DOM have disagreed for the
          // length of the gesture — deliberately, since nothing downstream of a
          // pure pan needed re-deriving — and this is where they are made to
          // agree again, at rest, with the exact camera the element is showing.
          //
          // BEFORE the throw rather than after, so the two are independent: a
          // release that is not a throw (a placement, a reader who asked for
          // reduced motion) still leaves React holding the right camera, and a
          // throw that IS started simply carries on from the value just
          // committed.
          commitPainted()
          startGlide(performance.now())
        }
        panSamplesRef.current = []
        // Cleared on the next frame, not now: the synthetic click that follows a
        // pointerup fires after this handler, and clearing it here would let a
        // drag that ended over a node open that node's entry.
        window.setTimeout(() => {
          draggedRef.current = false
        }, 0)
      }
    },
    [commitPainted, springBack, startGlide, svgRef],
  )

  return {
    layout,
    /**
     * The drawing's nodes, WITH THE CALLER'S OWN ELEMENT TYPE.
     *
     * `L` is generic and its constraint is `CameraLayout<CameraBox>`, so a
     * plain `layout.nodes` reads at the CONSTRAINT's element type — the five
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
    /**
     * THE FOLD'S MOVE. Pans to a box without changing the reader's zoom — see
     * `reveal` above for why a fold must not re-frame.
     */
    reveal,
    /** Drawing units per CSS pixel — what the LOD bands are measured against. */
    scale,
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
