// THE CAMERA — the map's window moving on its own, and the arithmetic behind
// every one of the three moves that asks it to.
//
// ── WHY THIS FILE EXISTS AT ALL ────────────────────────────────────────────
//
// The map has two motions already and both are CSS. A node glides between
// layouts because `transform` is a CSS property and the browser interpolates
// it; a box grows because SVG2 `width`/`height` are CSS properties too. Neither
// costs a line of JavaScript, and pages/mindtree.css argues at length that this
// is the right shape: both ends of every transition are positions layout.ts
// computed deterministically, so there is no third state a tween can leave the
// drawing in.
//
// `viewBox` IS NOT A CSS PROPERTY. It is an SVG presentation attribute with no
// CSS counterpart in any shipping engine, so there is no `transition: viewBox`
// to write and no `prefers-reduced-motion` block that can switch one off. The
// map's window — the thing that moves when the drawing re-fits, when a branch
// is focused, or when a notification takes the reader to one node out of two
// hundred — can only be moved by arithmetic, on a frame loop, by hand.
//
// So this module is the arithmetic, and ONLY the arithmetic. Not one line of it
// touches the DOM, `requestAnimationFrame`, `matchMedia` or React. Every
// function here is total and pure: same arguments, same answer, no clock read
// that was not passed in. The frame loop lives with the hook that owns `svgRef`
// (pages/map/useMapGeometry.ts), which is roughly thirty lines, because that is
// the part that cannot be tested without a browser and it should therefore be
// the smallest part.
//
// lib/mindtree/pulse.ts made the same cut for the same reason and it is worth
// naming: it takes `reducedMotion` as an ARGUMENT rather than reading the
// browser, which is what lets the rule "a reader who asked for less motion gets
// none" be asserted in a test instead of asserted in a comment. This file takes
// the flag the same way.
//
// ── WHAT A CAMERA IS ───────────────────────────────────────────────────────
//
// The rectangle of DRAWING units currently on screen, as a centre and a size.
// useMapGeometry holds the same thing split across two pieces of state — `pan`
// (a centre, or null meaning "stay fitted") and `zoom` (a multiplier of the
// fit) — and composes the attribute from them. `cameraOf` and `zoomForCamera`
// below are that composition and its inverse, so the two representations can
// never drift: `viewBoxOf` is the ONE formatter, and the hook is expected to
// use it rather than keep a second copy of the template string.
//
// That matters more than it looks. A frame loop that writes `viewBox` straight
// to the element is writing behind React's back, and React only writes an
// attribute when the prop CHANGED between renders. If the loop's last frame
// left a value React does not believe it needs to correct, the map is stuck
// there until something else moves it. One formatter, and the loop's final
// write is byte-identical to the value React would have rendered, so there is
// nothing to correct.
//
// ── INTERRUPTION IS THE FEATURE ────────────────────────────────────────────
//
// A tween the reader cannot interrupt is worse than no tween. Two cases, and
// they want different answers:
//
//   · A SECOND MOVE arrives mid-flight — a second notification, a second search
//     result, an expand that re-fits while a fly is still running.
//     `retargetCameraTween` restarts the ease FROM WHERE THE CAMERA ACTUALLY IS
//     at that instant, so the picture keeps moving and simply bends toward the
//     new destination. It does not snap to the old target first and it does not
//     run two loops that fight over one attribute.
//   · A GESTURE arrives mid-flight — a finger lands, a wheel turns. The tween
//     is DROPPED where it stands, not finished and not rewound: the reader has
//     taken the camera back and the app has no business arguing. That is a
//     `cancel` at the call site, which is why nothing here needs to model it.
//
// Neither case carries velocity across, and that is deliberate. Carrying
// velocity means a spring, a spring has no end time, and a motion with no end
// time cannot be made instant for a reader who asked for that — it can only be
// made stiff. `prefers-reduced-motion` is the constraint that picks the model.
//
// ── AND WHY THE CURVE IS THE ONE IN THE STYLESHEET ─────────────────────────
//
// `MAP_EASE` is `cubic-bezier(0.4, 0, 0.2, 1)` solved in JavaScript, and
// `MAP_TWEEN_MS` is 240. Both are mindtree.css's `--mtree-ease` and
// `--mtree-tween` — the same numbers, not similar ones — because the two
// motions happen TOGETHER constantly: focusing a branch relayouts the drawing
// (CSS moves every node) and re-fits the window (this file moves the camera).
// Two curves of different shapes over the same 240ms is the sort of thing
// nobody can name and everybody can feel.

/* ────────────────────────────── the numbers ──────────────────────────────── */

/**
 * The relayout tween, in milliseconds — mindtree.css's `--mtree-tween`.
 *
 * Spent by the RE-FIT: the map rearranging itself because a branch opened, a
 * filter narrowed, the grouping switched or the window resized. Those all move
 * the nodes as well, under the CSS transition, and the two have to be one
 * motion rather than two of different lengths.
 */
export const MAP_TWEEN_MS = 240

/** `--mtree-ease`'s control points, kept next to the solver that spends them. */
export const MAP_EASE_POINTS: readonly [number, number, number, number] = [0.4, 0, 0.2, 1]

/**
 * The fly-to's bounds, in milliseconds.
 *
 * A fly is the one move whose length is not known in advance: it may be a nudge
 * of half a card or a jump across a workspace with six tracks open. A constant
 * would be wrong at both ends — 240ms is a teleport across the whole drawing and
 * a lazy crawl for a node just off screen — so `tweenDurationFor` derives it
 * from how far the camera actually travels, in units of what is on screen.
 *
 * The floor is the sheet's own FEEDBACK speed (140ms), because a move that short
 * is feedback: the reader asked and the map answered. The ceiling is 420ms,
 * which is the point past which a reader who knows where they are going starts
 * waiting for the app — and this app's whole argument is that it must not cost
 * its reader keystrokes.
 */
export const FLY_MIN_MS = 140
export const FLY_MAX_MS = 420

/**
 * The travel that earns the full duration: two screens of pan, or a 4× change
 * of zoom, or any mix summing to the same.
 *
 * Pan is measured in SCREENS rather than drawing units so the number means the
 * same thing on a phone and on a monitor, and zoom in OCTAVES (log2) for the
 * same reason — halving the view is one step whether it starts at 300 units or
 * at 3000.
 */
const FULL_TRIP = 2

/**
 * Breathing room around a flown-to node, in drawing units.
 *
 * The same 28 `useMapGeometry` gives `fitToViewBox`, so landing on a single node
 * is framed the way fitting the whole map is framed.
 */
const FLY_PADDING = 28

/**
 * Below this the camera has not moved, in drawing units.
 *
 * Half a drawing unit is at most half a CSS pixel, because the map never
 * magnifies (`fitToViewBox`'s `maxScale: 1` means one drawing unit is never more
 * than one pixel). So this is the threshold below which starting a frame loop
 * would animate something with no visible frames in it.
 */
const CAMERA_EPSILON = 0.5

/* ─────────────────────────────── the shapes ──────────────────────────────── */

/** The rectangle of drawing units on screen, as a centre and a size. */
export interface Camera {
  readonly cx: number
  readonly cy: number
  readonly width: number
  readonly height: number
}

/** Anything with a position and a size in drawing units — a `PositionedNode`. */
export interface MotionBox {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** `fitToViewBox`'s answer, narrowed to the four fields this module reads. */
export interface MotionFit {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * A move in flight.
 *
 * A VALUE, not an object with methods and a running timer: the caller holds it
 * in a ref, samples it once per frame against `performance.now()`, and drops it
 * when `sampleCamera` reports it done. Everything that decides what the picture
 * looks like at time T is in these four fields, which is what makes the whole
 * motion reproducible in a test with a fake clock.
 */
export interface CameraTween {
  readonly from: Camera
  readonly to: Camera
  /** The clock reading passed to `beginCameraTween`. Any monotonic ms scale. */
  readonly startedAt: number
  /** 0 means INSTANT — see `beginCameraTween` on reduced motion. */
  readonly durationMs: number
}

export interface TweenOptions {
  /**
   * The reader asked for less motion. TRUE MAKES THE MOVE INSTANT, not short.
   *
   * A 10ms slide is still a slide, and across a whole drawing it is still
   * movement — mindtree.css's own reduced-motion block makes the same argument
   * about the node transitions and chooses `transition: none` over a shorter
   * duration for the same reason.
   *
   * Passed in rather than read from `matchMedia` here, so the rule is a property
   * of a pure function and can be asserted without a browser.
   */
  readonly reducedMotion?: boolean
  /**
   * Force the length instead of deriving it. `MAP_TWEEN_MS` for a re-fit, so
   * the camera and the CSS node transition are one motion; omitted for a fly,
   * where the distance decides.
   */
  readonly durationMs?: number
  /** How close counts as "already there", in drawing units. */
  readonly epsilon?: number
}

export interface FlyToOptions {
  /**
   * The widest view the zoom bounds allow, in drawing units — `fit.width /
   * zoomBounds.min`. Omitted means "no ceiling".
   *
   * A fly NEVER MAGNIFIES (see `flyToCamera`), so no floor is needed: the camera
   * can only be asked to pull back far enough to contain a node bigger than the
   * current window, and this is how far back it is allowed to go.
   */
  readonly maxWidth?: number
  /** Breathing room around the node, in drawing units. Defaults to 28. */
  readonly padding?: number
}

/* ────────────────────────────── the easing ───────────────────────────────── */

function clamp01(value: number): number {
  // NaN is the only value with no position on the timeline, so it starts.
  // The infinities DO have one — they are past an end — and clamp to that end
  // like any other out-of-range progress. Rejecting them with `!isFinite`, as
  // this first did, sent `+Infinity` to 0 and played the whole tween backwards
  // from a request that meant "we are already there".
  if (Number.isNaN(value)) return 0
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

/** One axis of a unit cubic Bézier: P0 = 0, P3 = 1, the two handles given. */
function bezierAt(a: number, b: number, t: number): number {
  const mt = 1 - t
  return 3 * mt * mt * t * a + 3 * mt * t * t * b + t * t * t
}

/** Its derivative, for the Newton step. */
function bezierSlope(a: number, b: number, t: number): number {
  const mt = 1 - t
  return 3 * mt * mt * a + 6 * mt * t * (b - a) + 3 * t * t * (1 - b)
}

/**
 * A CSS `cubic-bezier(x1, y1, x2, y2)` as a function of progress.
 *
 * The curve is parametric — x and y are both functions of an internal parameter
 * that is NOT the progress — so evaluating it means solving `x(s) = t` for `s`
 * first and only then reading `y(s)`. Newton–Raphson converges in three or four
 * steps over the ranges CSS allows, and bisection is kept as the fallback for
 * the flat stretches where the slope approaches zero and Newton would step off
 * the interval. Both are bounded, so this returns in constant time.
 *
 * Written out rather than approximated by a polynomial because the point of the
 * exercise is to match the STYLESHEET exactly; a curve that is nearly
 * `--mtree-ease` is a second curve, and the node transition and the camera would
 * separate visibly over 240ms.
 */
export function cubicBezierEase(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): (t: number) => number {
  // `cubic-bezier(a, a, b, b)` is the identity line. Worth short-circuiting
  // because `linear` is a legal request and solving for it wastes eight
  // iterations per frame to arrive back at the argument.
  const linear = x1 === y1 && x2 === y2
  return (t: number): number => {
    const progress = clamp01(t)
    if (linear || progress === 0 || progress === 1) return progress

    let s = progress
    for (let i = 0; i < 8; i += 1) {
      const error = bezierAt(x1, x2, s) - progress
      if (Math.abs(error) < 1e-6) return bezierAt(y1, y2, s)
      const slope = bezierSlope(x1, x2, s)
      if (Math.abs(slope) < 1e-6) break
      s -= error / slope
      if (s < 0 || s > 1) break
    }

    // Bisection: monotone by construction for any control points CSS accepts
    // (x1 and x2 are required to be within [0, 1]), so the root is bracketed.
    let low = 0
    let high = 1
    s = progress
    for (let i = 0; i < 24; i += 1) {
      s = (low + high) / 2
      const x = bezierAt(x1, x2, s)
      if (x < progress) low = s
      else high = s
    }
    return bezierAt(y1, y2, s)
  }
}

/** `--mtree-ease`, in JavaScript. Quick start, settled end, no overshoot. */
export const MAP_EASE = cubicBezierEase(
  MAP_EASE_POINTS[0],
  MAP_EASE_POINTS[1],
  MAP_EASE_POINTS[2],
  MAP_EASE_POINTS[3],
)

/* ──────────────────────────── camera arithmetic ──────────────────────────── */

/**
 * The attribute string, and THE ONLY PLACE IT IS SPELLED.
 *
 * Identical to the template `useMapGeometry` composed by hand before this
 * module existed, and the hook is expected to call this instead of keeping a
 * second copy — see the header on why a frame loop and a React render must
 * produce the same bytes for the same camera.
 */
export function viewBoxOf(camera: Camera): string {
  return `${camera.cx - camera.width / 2} ${camera.cy - camera.height / 2} ${camera.width} ${camera.height}`
}

/**
 * The camera the hook's two pieces of state describe.
 *
 * `pan === null` is "stay fitted", which is why the fit is a separate argument:
 * the centre falls back to the fit's own centre, exactly as the hook's
 * `centerX`/`centerY` do.
 */
export function cameraOf(
  fit: MotionFit,
  pan: { readonly x: number; readonly y: number } | null,
  zoom: number,
): Camera {
  const held = zoom > 0 && Number.isFinite(zoom) ? zoom : 1
  return {
    cx: pan?.x ?? fit.x + fit.width / 2,
    cy: pan?.y ?? fit.y + fit.height / 2,
    width: fit.width / held,
    height: fit.height / held,
  }
}

/**
 * The inverse — the zoom multiplier a camera implies against a fit.
 *
 * What a settling tween writes back into state, so that the moment the loop
 * stops the hook is describing the same window the loop left on screen. Without
 * it the first subsequent render would yank the map back to wherever `zoom`
 * still said it was.
 */
export function zoomForCamera(camera: Camera, fit: MotionFit): number {
  if (!(camera.width > 0) || !(fit.width > 0)) return 1
  return fit.width / camera.width
}

/** Has the camera moved enough to be worth a frame loop? */
export function cameraEqual(a: Camera, b: Camera, epsilon: number = CAMERA_EPSILON): boolean {
  const e = epsilon >= 0 ? epsilon : CAMERA_EPSILON
  return (
    Math.abs(a.cx - b.cx) <= e &&
    Math.abs(a.cy - b.cy) <= e &&
    Math.abs(a.width - b.width) <= e &&
    Math.abs(a.height - b.height) <= e
  )
}

/**
 * ZOOM INTERPOLATES GEOMETRICALLY, position linearly.
 *
 * Halving the view and doubling it are the same size of change to a reader and
 * opposite ones to a subtraction, so a linear walk from 1200 units wide to 300
 * spends its first half crossing three quarters of the change and reads as a
 * lurch that then coasts. Multiplying by a constant ratio each step — which is
 * a straight line in log space — makes the rate of magnification constant,
 * which is the thing the eye is actually tracking.
 *
 * Width and height take their own ratios rather than sharing one, so a camera
 * whose aspect changed mid-flight (the window was resized) arrives at the new
 * aspect instead of being stretched into the old one. When the aspects match —
 * the ordinary case, since both come from the same viewport — the two ratios are
 * equal and the aspect is preserved exactly.
 */
export function lerpCamera(from: Camera, to: Camera, eased: number): Camera {
  const k = clamp01(eased)
  if (k === 0) return from
  if (k === 1) return to
  return {
    cx: from.cx + (to.cx - from.cx) * k,
    cy: from.cy + (to.cy - from.cy) * k,
    width: geometric(from.width, to.width, k),
    height: geometric(from.height, to.height, k),
  }
}

function geometric(a: number, b: number, k: number): number {
  // A non-positive extent is not a size the log is defined on. It should not
  // occur — `fitToViewBox` floors both at 1 — but a camera arriving from a
  // container measured at 0×0 on the first frame would otherwise return NaN and
  // paint nothing at all, which is a worse failure than a linear walk.
  if (!(a > 0) || !(b > 0)) return a + (b - a) * k
  return a * Math.pow(b / a, k)
}

/* ────────────────────────────── the tween ────────────────────────────────── */

/**
 * How long the camera should take, from how far it is going.
 *
 * Distance is measured in what is ON SCREEN — screens of pan plus octaves of
 * zoom — rather than in drawing units, so the same gesture takes the same time
 * on a phone and on a monitor and in a workspace with six tracks or sixty.
 */
export function tweenDurationFor(from: Camera, to: Camera): number {
  const width = to.width > 0 ? to.width : from.width
  const height = to.height > 0 ? to.height : from.height
  const dx = width > 0 ? (to.cx - from.cx) / width : 0
  const dy = height > 0 ? (to.cy - from.cy) / height : 0
  const screens = Math.hypot(dx, dy)
  const octaves =
    from.width > 0 && to.width > 0 ? Math.abs(Math.log2(to.width / from.width)) : 0
  const trip = Math.min(1, (screens + octaves) / FULL_TRIP)
  return Math.round(FLY_MIN_MS + (FLY_MAX_MS - FLY_MIN_MS) * trip)
}

/**
 * Start a move — or answer `null`, meaning THE CAMERA IS ALREADY THERE.
 *
 * `null` is not a failure and it is not a refusal to animate; it is the honest
 * answer to "move to where you are", and it is what keeps a re-fit that changed
 * nothing (a resize of two pixels, a filter keystroke that removed no branch)
 * from starting a frame loop that would paint four identical frames.
 *
 * Under `reducedMotion` the answer is a tween of ZERO length, not `null` and not
 * a short one: `sampleCamera` reports it finished at every clock reading, so the
 * caller writes the destination once and stops. Instant, by construction, with
 * no cooperation needed from the loop.
 */
export function beginCameraTween(
  from: Camera,
  to: Camera,
  now: number,
  options: TweenOptions = {},
): CameraTween | null {
  if (cameraEqual(from, to, options.epsilon ?? CAMERA_EPSILON)) return null
  const forced = options.durationMs
  const derived = forced !== undefined && forced >= 0 ? forced : tweenDurationFor(from, to)
  return {
    from,
    to,
    startedAt: now,
    durationMs: options.reducedMotion === true ? 0 : derived,
  }
}

/** Where the tween is at `now`, and whether it has arrived. */
export function sampleCamera(
  tween: CameraTween,
  now: number,
): { readonly camera: Camera; readonly done: boolean } {
  if (!(tween.durationMs > 0)) return { camera: tween.to, done: true }
  const elapsed = now - tween.startedAt
  if (elapsed <= 0) return { camera: tween.from, done: false }
  if (elapsed >= tween.durationMs) return { camera: tween.to, done: true }
  return { camera: lerpCamera(tween.from, tween.to, MAP_EASE(elapsed / tween.durationMs)), done: false }
}

/** Progress through a tween, 0 to 1, before easing. Zero-length tweens are 1. */
export function tweenProgress(tween: CameraTween, now: number): number {
  if (!(tween.durationMs > 0)) return 1
  return clamp01((now - tween.startedAt) / tween.durationMs)
}

/**
 * A SECOND DESTINATION ARRIVING MID-FLIGHT.
 *
 * The new move starts from where the camera actually is at `now`, so the
 * picture bends toward the new target from its current position instead of
 * finishing the old move first (a visible detour), snapping to the old target
 * and re-starting (a jump), or running two loops that write the same attribute
 * on the same frame (a stutter that looks like dropped frames and is not).
 *
 * `null` carries the same meaning it does everywhere in this file — the camera
 * is already at `to` — and the caller must therefore DROP the active tween when
 * it sees one, not keep running it. Keeping it would carry the camera on to the
 * previous destination, which is the one place this contract can bite.
 */
export function retargetCameraTween(
  active: CameraTween,
  to: Camera,
  now: number,
  options: TweenOptions = {},
): CameraTween | null {
  return beginCameraTween(sampleCamera(active, now).camera, to, now, options)
}

/* ────────────────────────────── the fly-to ───────────────────────────────── */

/**
 * The camera that centres one box — a notification's item, a search result, the
 * node a keyboard walk just reached.
 *
 * IT KEEPS THE READER'S ZOOM. Re-framing to fill the window with whatever was
 * asked for is what a slide deck does; a working map that re-magnified itself
 * every time a notification was tapped would be arguing with the reader about a
 * setting they chose. The one exception is the one that is not a preference: a
 * node too big for the current window cannot be "centred" in it at all, so the
 * camera pulls back exactly far enough to contain the node plus its padding,
 * and no further.
 *
 * So the scale factor is at least 1 — the camera never magnifies — which is the
 * same rule `fitToViewBox` states as `maxScale: 1` and for the same reason: text
 * inside a viewBox scaled past 1:1 is text rendered at a size nobody chose.
 */
export function flyToCamera(target: MotionBox, from: Camera, options: FlyToOptions = {}): Camera {
  const padding = options.padding !== undefined && options.padding >= 0 ? options.padding : FLY_PADDING
  const needWidth = target.width + padding * 2
  const needHeight = target.height + padding * 2

  let factor = 1
  if (from.width > 0) factor = Math.max(factor, needWidth / from.width)
  if (from.height > 0) factor = Math.max(factor, needHeight / from.height)

  let width = from.width * factor
  let height = from.height * factor

  // The zoom floor, in view widths. Pulling back past it would leave the reader
  // outside the bounds the +/− buttons can walk back from — the exact defect
  // useMapGeometry's read-time clamp records as already fixed once.
  const ceiling = options.maxWidth
  if (ceiling !== undefined && ceiling > 0 && width > ceiling) {
    const aspect = from.width > 0 ? from.height / from.width : 1
    width = ceiling
    height = ceiling * aspect
  }

  return {
    cx: target.x + target.width / 2,
    cy: target.y + target.height / 2,
    width,
    height,
  }
}

/**
 * FLY TO A NODE BY ID — the entry point a notification, a search result or a
 * deep link calls.
 *
 * `null` means the id is NOT DRAWN, which is an ordinary answer rather than an
 * error: the node may sit inside a collapsed branch, past the phone's one-ring
 * depth limit, or outside the current drill-in. It is the caller's cue to open
 * the way in first — `lib/mindtree/focus.ancestorIdsOf` gives the path, since
 * every mind id is its parent's id plus one segment — and ask again on the
 * layout that comes back. Answering with the whole-map fit instead would take a
 * reader who asked for one item to a picture of everything, which is the
 * opposite of what they asked for and impossible to tell from success.
 *
 * Takes the layout's `byId` map rather than its node array so the lookup does
 * not walk two hundred nodes on a screen whose whole point is that it is
 * responsive.
 */
export function flyToNode(
  nodeId: string,
  nodes: ReadonlyMap<string, MotionBox>,
  from: Camera,
  options: FlyToOptions = {},
): Camera | null {
  const target = nodes.get(nodeId)
  if (target === undefined) return null
  return flyToCamera(target, from, options)
}
