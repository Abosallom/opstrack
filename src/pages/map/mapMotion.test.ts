// THE CAMERA'S ARITHMETIC, asserted with a fake clock.
//
// mapMotion.ts is pure on purpose — no rAF, no DOM, no `matchMedia` — and this
// file is what that purity buys: every rule the brief calls non-negotiable is a
// property of a function here rather than a sentence in a comment.
//
//   · reduced motion is INSTANT, not shortened   → the reducedMotion block
//   · a second gesture takes over cleanly        → the retarget block, which
//     asserts CONTINUITY (the camera at the instant of interruption is the same
//     before and after) rather than merely that a new tween was returned
//   · the viewBox is what moves, never a scale   → viewBoxOf is the only
//     formatter, and it is byte-checked against the template the hook composed
//     by hand before this module existed
//   · the JS curve IS the stylesheet's curve     → the last block reads
//     pages/mindtree.css and fails if the two drift
//
// The easing is checked against an INDEPENDENT solver — a slow bisection over
// the same Bézier — rather than against literals somebody transcribed. A test
// full of magic numbers proves that the implementation still does what it did
// the day the numbers were pasted in; agreement between two derivations proves
// it does what `cubic-bezier(0.4, 0, 0.2, 1)` means.

import { describe, expect, it } from 'vitest'
import {
  anchoredZoom,
  beginCameraTween,
  cameraAtWidth,
  cameraEqual,
  cameraOf,
  clampCamera,
  cubicBezierEase,
  FLY_MAX_MS,
  FLY_MIN_MS,
  flyToCamera,
  flyToNode,
  FRAME_FILL_DESKTOP,
  FRAME_FILL_PHONE,
  frameCamera,
  lerpCamera,
  MAP_EASE,
  MAP_EASE_POINTS,
  MAP_TWEEN_MS,
  octavesOf,
  retargetCameraTween,
  RUBBER_EXPONENT,
  rubberBand,
  rubberBandCamera,
  sampleCamera,
  tweenDurationFor,
  tweenProgress,
  viewBoxOf,
  wheelRatio,
  ZOOM_HEADROOM,
  zoomForCamera,
  type Camera,
  type CameraBounds,
  type FrameOptions,
  type MotionBox,
  type Occlusion,
} from './mapMotion'

/** A 960×520 window on the middle of a drawing — the desktop fallback box. */
const WIDE: Camera = { cx: 480, cy: 260, width: 960, height: 520 }

function camera(over: Partial<Camera> = {}): Camera {
  return { ...WIDE, ...over }
}

/* ─────────────────────────────── the easing ──────────────────────────────── */

/**
 * The same curve, solved the slow way: 60 rounds of bisection on x, then read
 * y. Deliberately not the shape of the implementation — no Newton step, no
 * short-circuits — so agreement between the two is evidence about the CURVE and
 * not about a shared mistake.
 */
function bisectEase(x1: number, y1: number, x2: number, y2: number, t: number): number {
  const axis = (a: number, b: number, s: number): number => {
    const m = 1 - s
    return 3 * m * m * s * a + 3 * m * s * s * b + s * s * s
  }
  let low = 0
  let high = 1
  let s = t
  for (let i = 0; i < 60; i += 1) {
    s = (low + high) / 2
    if (axis(x1, x2, s) < t) low = s
    else high = s
  }
  return axis(y1, y2, s)
}

describe('cubicBezierEase', () => {
  it('pins both ends exactly', () => {
    expect(MAP_EASE(0)).toBe(0)
    expect(MAP_EASE(1)).toBe(1)
  })

  it('clamps anything outside 0..1, including NaN', () => {
    expect(MAP_EASE(-3)).toBe(0)
    expect(MAP_EASE(2)).toBe(1)
    expect(MAP_EASE(Number.NaN)).toBe(0)
    expect(MAP_EASE(Number.POSITIVE_INFINITY)).toBe(1)
  })

  it('never goes backwards', () => {
    let previous = -1
    for (let i = 0; i <= 200; i += 1) {
      const value = MAP_EASE(i / 200)
      expect(value).toBeGreaterThanOrEqual(previous)
      previous = value
    }
  })

  it('agrees with an independent bisection over the whole range', () => {
    for (let i = 0; i <= 100; i += 1) {
      const t = i / 100
      expect(MAP_EASE(t)).toBeCloseTo(bisectEase(0.4, 0, 0.2, 1, t), 4)
    }
  })

  it('is the app curve — quick start, settled end', () => {
    // More than half the distance is covered in the first half of the time, and
    // the last tenth of the time moves the picture less than the first tenth.
    expect(MAP_EASE(0.5)).toBeGreaterThan(0.5)
    expect(MAP_EASE(0.1)).toBeGreaterThan(1 - MAP_EASE(0.9))
    // Nothing overshoots: an overshooting curve is a bounce, and mindtree.css
    // says in as many words that nothing on this map overshoots.
    for (let i = 0; i <= 100; i += 1) {
      const value = MAP_EASE(i / 100)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
  })

  it('short-circuits the identity line rather than solving it', () => {
    const linear = cubicBezierEase(0.25, 0.25, 0.75, 0.75)
    for (let i = 0; i <= 20; i += 1) expect(linear(i / 20)).toBe(i / 20)
  })

  it('solves a flat-shouldered curve, where Newton alone would stall', () => {
    // x2 = 1 puts the slope at zero at the top end, which is the case the
    // bisection fallback exists for.
    const flat = cubicBezierEase(0, 0, 1, 0.5)
    for (let i = 0; i <= 50; i += 1) {
      const t = i / 50
      expect(flat(t)).toBeCloseTo(bisectEase(0, 0, 1, 0.5, t), 4)
    }
  })
})

/* ───────────────────────────── camera arithmetic ─────────────────────────── */

describe('viewBoxOf', () => {
  it('is the template useMapGeometry used to compose by hand', () => {
    const cam = camera({ cx: 100, cy: 50, width: 400, height: 200 })
    expect(viewBoxOf(cam)).toBe('-100 -50 400 200')
    // The four numbers in order, spaces only — the same bytes React renders, so
    // a frame loop's last write leaves nothing for React to correct.
    expect(viewBoxOf(cam)).toBe(
      `${cam.cx - cam.width / 2} ${cam.cy - cam.height / 2} ${cam.width} ${cam.height}`,
    )
  })
})

describe('cameraOf / zoomForCamera', () => {
  const fit = { x: 0, y: 0, width: 800, height: 400 }

  it('centres on the fit while the reader has not panned', () => {
    expect(cameraOf(fit, null, 1)).toEqual({ cx: 400, cy: 200, width: 800, height: 400 })
  })

  it('shrinks the window as the zoom multiplier grows', () => {
    expect(cameraOf(fit, null, 2)).toEqual({ cx: 400, cy: 200, width: 400, height: 200 })
  })

  it('takes the centre from the pan when there is one', () => {
    expect(cameraOf(fit, { x: 90, y: 10 }, 1).cx).toBe(90)
    expect(cameraOf(fit, { x: 90, y: 10 }, 1).cy).toBe(10)
  })

  it('round-trips the zoom', () => {
    for (const zoom of [0.4, 1, 1.25, 2.75]) {
      expect(zoomForCamera(cameraOf(fit, null, zoom), fit)).toBeCloseTo(zoom, 10)
    }
  })

  it('refuses to divide by a zoom that is not a zoom', () => {
    expect(cameraOf(fit, null, 0).width).toBe(800)
    expect(cameraOf(fit, null, Number.NaN).width).toBe(800)
    expect(zoomForCamera({ cx: 0, cy: 0, width: 0, height: 0 }, fit)).toBe(1)
  })
})

describe('lerpCamera', () => {
  const from = camera({ cx: 0, cy: 0, width: 400, height: 200 })
  const to = camera({ cx: 800, cy: 400, width: 100, height: 50 })

  it('returns the ends untouched', () => {
    expect(lerpCamera(from, to, 0)).toBe(from)
    expect(lerpCamera(from, to, 1)).toBe(to)
    expect(lerpCamera(from, to, -1)).toBe(from)
    expect(lerpCamera(from, to, 4)).toBe(to)
  })

  it('walks the centre linearly', () => {
    expect(lerpCamera(from, to, 0.25).cx).toBeCloseTo(200, 10)
    expect(lerpCamera(from, to, 0.5).cy).toBeCloseTo(200, 10)
  })

  it('walks the ZOOM geometrically — the midpoint is the geometric mean', () => {
    // 400 → 100 halfway is 200, not 250: halving and doubling are the same size
    // of change to a reader and opposite ones to a subtraction.
    expect(lerpCamera(from, to, 0.5).width).toBeCloseTo(200, 10)
    expect(lerpCamera(from, to, 0.5).width).toBeCloseTo(Math.sqrt(400 * 100), 10)
  })

  it('keeps the aspect ratio at every step when both ends share one', () => {
    for (let i = 0; i <= 20; i += 1) {
      const mid = lerpCamera(from, to, i / 20)
      expect(mid.width / mid.height).toBeCloseTo(2, 10)
    }
  })

  it('falls back to a linear walk rather than NaN on a zero-extent camera', () => {
    const dead = camera({ width: 0, height: 0 })
    const mid = lerpCamera(dead, to, 0.5)
    expect(Number.isFinite(mid.width)).toBe(true)
    expect(mid.width).toBeCloseTo(50, 10)
  })
})

describe('cameraEqual', () => {
  it('ignores movement smaller than half a drawing unit', () => {
    expect(cameraEqual(WIDE, camera({ cx: WIDE.cx + 0.4 }))).toBe(true)
    expect(cameraEqual(WIDE, camera({ cx: WIDE.cx + 0.6 }))).toBe(false)
    expect(cameraEqual(WIDE, camera({ width: WIDE.width + 2 }))).toBe(false)
  })

  it("takes a caller's epsilon", () => {
    expect(cameraEqual(WIDE, camera({ cy: WIDE.cy + 5 }), 10)).toBe(true)
  })
})

/* ────────────────────────────── the duration ─────────────────────────────── */

describe('tweenDurationFor', () => {
  it('gives a move of no distance the feedback speed', () => {
    expect(tweenDurationFor(WIDE, WIDE)).toBe(FLY_MIN_MS)
  })

  it('caps a move across the workspace at the ceiling', () => {
    expect(tweenDurationFor(WIDE, camera({ cx: 40000 }))).toBe(FLY_MAX_MS)
  })

  it('grows with the distance and never past the ceiling', () => {
    let previous = 0
    for (const cx of [480, 700, 1200, 2400, 9600]) {
      const ms = tweenDurationFor(WIDE, camera({ cx }))
      expect(ms).toBeGreaterThanOrEqual(previous)
      expect(ms).toBeLessThanOrEqual(FLY_MAX_MS)
      previous = ms
    }
  })

  it('measures pan in SCREENS, so the same gesture costs the same at any zoom', () => {
    // One window width of travel, twice, at two magnifications.
    const near = tweenDurationFor(
      camera({ cx: 0, width: 960, height: 520 }),
      camera({ cx: 960, width: 960, height: 520 }),
    )
    const far = tweenDurationFor(
      camera({ cx: 0, width: 240, height: 130 }),
      camera({ cx: 240, width: 240, height: 130 }),
    )
    expect(near).toBe(far)
  })

  it('counts zoom in octaves at a CONSTANT RATE — 300ms each', () => {
    // 960 → 240 is exactly two octaves: 140 + 2 × 300.
    expect(tweenDurationFor(WIDE, camera({ width: 240, height: 130 }))).toBe(740)
    // …and reversing it costs the same, which a ratio does and a difference
    // does not.
    expect(tweenDurationFor(camera({ width: 240, height: 130 }), WIDE)).toBe(740)
    // One octave is half of that above the floor, which is what "constant rate
    // of magnification" means as an assertion rather than as a comment.
    expect(tweenDurationFor(WIDE, camera({ width: 480, height: 260 }))).toBe(440)
  })

  it('prices the move the whole design is about: a ONE-TIER DIVE', () => {
    // A uniform six-wide tier packs its children at a parent/child diameter
    // ratio of 2.69, so diving one department tier is log2(2.69) = 1.43
    // octaves. The brief's own arithmetic says ~570ms and this is where that
    // number has to come out.
    const child = camera({ width: 960 / 2.69, height: 520 / 2.69 })
    expect(tweenDurationFor(WIDE, child)).toBe(568)
  })

  it('takes the MAX of pan and zoom, not the sum — a dive is one move', () => {
    // The child world sits off its parent's centre AND is smaller. Summing the
    // two costs would price the commonest move on this screen at 200ms more
    // than the rate the reference runs at; they overlap in the wall clock.
    const dive = camera({ cx: 480 + 0.6 * (960 / 2.69), width: 960 / 2.69, height: 520 / 2.69 })
    expect(tweenDurationFor(WIDE, dive)).toBe(tweenDurationFor(WIDE, camera({
      width: 960 / 2.69,
      height: 520 / 2.69,
    })))
  })

  it('caps a four-tier surface, and 1100 is a MOVE where 420 was a cut', () => {
    expect(FLY_MAX_MS).toBe(1100)
    // The cap bites at (1100 − 140)/300 = 3.2 octaves.
    expect(tweenDurationFor(WIDE, camera({ width: 960 / 2 ** 3.2, height: 520 / 2 ** 3.2 }))).toBe(
      FLY_MAX_MS,
    )
    expect(tweenDurationFor(WIDE, camera({ width: 960 / 2 ** 3.1, height: 520 / 2 ** 3.1 }))).toBeLessThan(
      FLY_MAX_MS,
    )
  })
})

/* ─────────────────────────────── the tween ───────────────────────────────── */

describe('beginCameraTween', () => {
  it('answers null when the camera is already there', () => {
    expect(beginCameraTween(WIDE, WIDE, 1000)).toBeNull()
    expect(beginCameraTween(WIDE, camera({ cx: WIDE.cx + 0.2 }), 1000)).toBeNull()
  })

  it('derives its length from the distance by default', () => {
    const to = camera({ cx: 1400 })
    const tween = beginCameraTween(WIDE, to, 1000)
    expect(tween?.durationMs).toBe(tweenDurationFor(WIDE, to))
    expect(tween?.startedAt).toBe(1000)
    expect(tween?.from).toBe(WIDE)
    expect(tween?.to).toBe(to)
  })

  it('takes a forced length, which is how a re-fit rides with the CSS', () => {
    const tween = beginCameraTween(WIDE, camera({ cx: 1400 }), 0, { durationMs: MAP_TWEEN_MS })
    expect(tween?.durationMs).toBe(MAP_TWEEN_MS)
    // The number is the stylesheet's, not a second opinion about it.
    expect(MAP_TWEEN_MS).toBe(240)
  })
})

describe('reduced motion is INSTANT, not shortened', () => {
  const to = camera({ cx: 5000, cy: 3000, width: 200, height: 110 })

  it('produces a tween of zero length', () => {
    const tween = beginCameraTween(WIDE, to, 1000, { reducedMotion: true })
    expect(tween?.durationMs).toBe(0)
  })

  it('is already finished at the instant it starts', () => {
    const tween = beginCameraTween(WIDE, to, 1000, { reducedMotion: true })
    if (tween === null) throw new Error('expected a tween')
    const at = sampleCamera(tween, 1000)
    expect(at.done).toBe(true)
    expect(at.camera).toBe(to)
  })

  it('never reports an intermediate position, at any clock reading', () => {
    const tween = beginCameraTween(WIDE, to, 1000, { reducedMotion: true })
    if (tween === null) throw new Error('expected a tween')
    for (const now of [-1e9, 0, 999, 1000, 1000.001, 1240, 1e9]) {
      const at = sampleCamera(tween, now)
      expect(at.done).toBe(true)
      expect(at.camera).toBe(to)
    }
    expect(tweenProgress(tween, 0)).toBe(1)
  })

  it('still answers null when there was nothing to move', () => {
    expect(beginCameraTween(WIDE, WIDE, 1000, { reducedMotion: true })).toBeNull()
  })

  it('applies to a retarget too, not only to a fresh move', () => {
    const running = beginCameraTween(WIDE, to, 1000)
    if (running === null) throw new Error('expected a tween')
    const next = retargetCameraTween(running, camera({ cx: -400 }), 1080, {
      reducedMotion: true,
    })
    expect(next?.durationMs).toBe(0)
  })
})

describe('sampleCamera', () => {
  const to = camera({ cx: 1440, cy: 260, width: 480, height: 260 })
  const tween = { from: WIDE, to, startedAt: 1000, durationMs: 240 }

  it('sits at the start before the clock reaches it', () => {
    expect(sampleCamera(tween, 900)).toEqual({ camera: WIDE, done: false })
    expect(sampleCamera(tween, 1000)).toEqual({ camera: WIDE, done: false })
  })

  it('lands exactly on the destination at the end and stays there', () => {
    expect(sampleCamera(tween, 1240)).toEqual({ camera: to, done: true })
    expect(sampleCamera(tween, 99999)).toEqual({ camera: to, done: true })
  })

  it('is strictly between the ends in the middle, and moves every frame', () => {
    const mid = sampleCamera(tween, 1120)
    expect(mid.done).toBe(false)
    expect(mid.camera.cx).toBeGreaterThan(WIDE.cx)
    expect(mid.camera.cx).toBeLessThan(to.cx)
    expect(mid.camera.width).toBeLessThan(WIDE.width)
    expect(mid.camera.width).toBeGreaterThan(to.width)

    let previous = WIDE.cx
    for (let now = 1004; now < 1240; now += 16) {
      const cx = sampleCamera(tween, now).camera.cx
      expect(cx).toBeGreaterThanOrEqual(previous)
      previous = cx
    }
  })

  it('follows the app curve rather than a straight line', () => {
    const half = sampleCamera(tween, 1120).camera.cx
    const linear = WIDE.cx + (to.cx - WIDE.cx) * 0.5
    expect(half).toBeGreaterThan(linear)
    expect(half).toBeCloseTo(WIDE.cx + (to.cx - WIDE.cx) * MAP_EASE(0.5), 8)
  })

  it('reports progress before easing', () => {
    expect(tweenProgress(tween, 1000)).toBe(0)
    expect(tweenProgress(tween, 1120)).toBeCloseTo(0.5, 10)
    expect(tweenProgress(tween, 1240)).toBe(1)
    expect(tweenProgress(tween, 5000)).toBe(1)
  })
})

/* ───────────────────────── interruption, the feature ─────────────────────── */

describe('retargetCameraTween — a second gesture takes over cleanly', () => {
  const first = camera({ cx: 2400, cy: 900, width: 320, height: 174 })
  const second = camera({ cx: -600, cy: 120, width: 900, height: 488 })

  it('starts from where the camera ACTUALLY IS, not from either endpoint', () => {
    const running = beginCameraTween(WIDE, first, 1000, { durationMs: 240 })
    if (running === null) throw new Error('expected a tween')
    const atInterrupt = sampleCamera(running, 1100).camera

    const next = retargetCameraTween(running, second, 1100)
    if (next === null) throw new Error('expected a retarget')
    expect(next.from).toEqual(atInterrupt)
    expect(next.from).not.toEqual(WIDE)
    expect(next.from).not.toEqual(first)
    expect(next.startedAt).toBe(1100)
    expect(next.to).toBe(second)
  })

  it('is CONTINUOUS — the picture does not jump on the frame of the takeover', () => {
    // This is the whole rule. Sampling the old tween and the new one at the
    // instant of the interruption must give the same rectangle, or the reader
    // sees a snap at exactly the moment they asked for something else.
    const running = beginCameraTween(WIDE, first, 1000, { durationMs: 240 })
    if (running === null) throw new Error('expected a tween')
    for (const now of [1000, 1016, 1080, 1180, 1239]) {
      const before = sampleCamera(running, now).camera
      const next = retargetCameraTween(running, second, now)
      if (next === null) throw new Error('expected a retarget')
      const after = sampleCamera(next, now).camera
      expect(after.cx).toBeCloseTo(before.cx, 9)
      expect(after.cy).toBeCloseTo(before.cy, 9)
      expect(after.width).toBeCloseTo(before.width, 9)
      expect(after.height).toBeCloseTo(before.height, 9)
    }
  })

  it('arrives at the NEW destination and forgets the old one', () => {
    const running = beginCameraTween(WIDE, first, 1000, { durationMs: 240 })
    if (running === null) throw new Error('expected a tween')
    const next = retargetCameraTween(running, second, 1100)
    if (next === null) throw new Error('expected a retarget')
    expect(sampleCamera(next, 1100 + next.durationMs)).toEqual({ camera: second, done: true })
  })

  it('survives being interrupted on every frame — a finger dragging a target', () => {
    let tween = beginCameraTween(WIDE, first, 1000, { durationMs: 240 })
    if (tween === null) throw new Error('expected a tween')
    let now = 1000
    for (let i = 0; i < 30; i += 1) {
      now += 16
      const chased = camera({ cx: 100 * i, cy: 40 * i })
      const next = retargetCameraTween(tween, chased, now)
      // Only null when the chase happens to land on the current camera, which
      // is a legal answer and means "stop".
      if (next === null) break
      tween = next
      const at = sampleCamera(tween, now).camera
      expect(Number.isFinite(at.cx)).toBe(true)
      expect(at.width).toBeGreaterThan(0)
    }
    expect(Number.isFinite(sampleCamera(tween, now + 1000).camera.cx)).toBe(true)
  })

  it('answers null when the new target is where the camera already is', () => {
    const running = beginCameraTween(WIDE, first, 1000, { durationMs: 240 })
    if (running === null) throw new Error('expected a tween')
    const here = sampleCamera(running, 1100).camera
    expect(retargetCameraTween(running, here, 1100)).toBeNull()
  })
})

/* ────────────────────────────── the fly-to ───────────────────────────────── */

describe('flyToCamera', () => {
  const node: MotionBox = { x: 1200, y: 640, width: 168, height: 44 }

  it('centres the node', () => {
    const flown = flyToCamera(node, WIDE)
    expect(flown.cx).toBe(1284)
    expect(flown.cy).toBe(662)
  })

  it('KEEPS the reader\'s zoom when the node already fits', () => {
    const flown = flyToCamera(node, WIDE)
    expect(flown.width).toBe(WIDE.width)
    expect(flown.height).toBe(WIDE.height)
  })

  it('never magnifies, however small the node is', () => {
    const speck: MotionBox = { x: 0, y: 0, width: 4, height: 4 }
    expect(flyToCamera(speck, WIDE).width).toBe(WIDE.width)
  })

  it('pulls back exactly far enough for a node bigger than the window', () => {
    const tight: Camera = { cx: 0, cy: 0, width: 200, height: 100 }
    const flown = flyToCamera(node, tight, { padding: 10 })
    // 168 + 20 = 188 fits in 200; 44 + 20 = 64 fits in 100. Nothing to do.
    expect(flown.width).toBe(200)
    // Now a node wider than the window.
    const wide: MotionBox = { x: 0, y: 0, width: 400, height: 44 }
    const pulled = flyToCamera(wide, tight, { padding: 10 })
    expect(pulled.width).toBeCloseTo(420, 10)
    expect(pulled.width / pulled.height).toBeCloseTo(tight.width / tight.height, 10)
  })

  it('honours the padding, so a landed node is framed and not clipped', () => {
    const tight: Camera = { cx: 0, cy: 0, width: 100, height: 100 }
    const target: MotionBox = { x: 0, y: 0, width: 60, height: 60 }
    expect(flyToCamera(target, tight, { padding: 0 }).width).toBe(100)
    expect(flyToCamera(target, tight, { padding: 40 }).width).toBeCloseTo(140, 10)
  })

  it('stops at the zoom floor rather than stranding the reader outside it', () => {
    const tight: Camera = { cx: 0, cy: 0, width: 200, height: 100 }
    const huge: MotionBox = { x: 0, y: 0, width: 4000, height: 40 }
    const flown = flyToCamera(huge, tight, { padding: 0, maxWidth: 900 })
    expect(flown.width).toBe(900)
    expect(flown.height).toBeCloseTo(450, 10)
    // Still centred on what was asked for, even though it does not all fit.
    expect(flown.cx).toBe(2000)
  })
})

describe('flyToNode', () => {
  const nodes = new Map<string, MotionBox>([
    ['root', { x: 0, y: 300, width: 168, height: 44 }],
    ['root/track:infra', { x: 300, y: 100, width: 168, height: 52 }],
    ['root/track:infra/group:overdue', { x: 600, y: 60, width: 168, height: 44 }],
  ])

  it('answers null for a node that is not drawn, rather than the whole map', () => {
    // A collapsed branch, a node past the phone's one-ring limit, or an id from
    // a notification about a track the reader has filtered away. The caller's
    // cue to open the way in first — never a silent fallback to "fit".
    expect(flyToNode('root/track:sre', nodes, WIDE)).toBeNull()
    expect(flyToNode('', nodes, WIDE)).toBeNull()
  })

  it('centres a drawn node and keeps the zoom', () => {
    const flown = flyToNode('root/track:infra/group:overdue', nodes, WIDE)
    expect(flown).toEqual({ cx: 684, cy: 82, width: 960, height: 520 })
  })

  it('is the composition of the lookup and flyToCamera, and nothing else', () => {
    const target = nodes.get('root/track:infra')
    if (target === undefined) throw new Error('fixture')
    expect(flyToNode('root/track:infra', nodes, WIDE, { padding: 12 })).toEqual(
      flyToCamera(target, WIDE, { padding: 12 }),
    )
  })

  it('drives a whole move end to end, from the id to the attribute', () => {
    const to = flyToNode('root/track:infra', nodes, WIDE)
    if (to === null) throw new Error('expected a camera')
    const tween = beginCameraTween(WIDE, to, 0)
    if (tween === null) throw new Error('expected a tween')
    expect(tween.durationMs).toBeGreaterThanOrEqual(FLY_MIN_MS)
    expect(tween.durationMs).toBeLessThanOrEqual(FLY_MAX_MS)
    const landed = sampleCamera(tween, tween.durationMs)
    expect(landed.done).toBe(true)
    expect(viewBoxOf(landed.camera)).toBe(viewBoxOf(to))
  })
})

/* ───────────────────────── framing one world ─────────────────────────────── */

const STAGE = { width: 1180, height: 835 }
const PHONE = { width: 375, height: 587 }
const CLEAR: Occlusion = { inlineEnd: 0, blockEnd: 0 }

/** A world at the origin, 1000 units across. */
const WORLD = { worldX: 0, worldY: 0, worldD: 1000 }

function framed(over: Partial<FrameOptions> = {}): Camera {
  return frameCamera(WORLD, {
    viewport: STAGE,
    frameFill: FRAME_FILL_DESKTOP,
    occlusion: CLEAR,
    rtl: false,
    ...over,
  })
}

/** The world's diameter in CSS px at a given camera — the LOD's `a`. */
function apparent(cam: Camera, viewportWidth: number, worldD: number): number {
  return (worldD * viewportWidth) / cam.width
}

describe('frameCamera', () => {
  it('puts the world at FRAME_FILL of the stage’s SMALLER dimension', () => {
    const cam = framed()
    expect(apparent(cam, STAGE.width, WORLD.worldD)).toBeCloseTo(FRAME_FILL_DESKTOP * 835, 9)
  })

  it('centres the world exactly when nothing is covering the stage', () => {
    const cam = framed()
    expect(cam.cx).toBe(0)
    expect(cam.cy).toBe(0)
  })

  it('keeps the CAMERA’s aspect equal to the ELEMENT’s, not the visible part’s', () => {
    // Every pixel↔unit conversion in the map is `dx · width / box.width`, which
    // is exact only while these agree. Fit to the shrunken rectangle instead and
    // a reader's finger out-runs the map by the width of the panel.
    const cam = framed({ occlusion: { inlineEnd: 416, blockEnd: 0 } })
    expect(cam.width / cam.height).toBeCloseTo(STAGE.width / STAGE.height, 12)
  })

  it('MOVES THE CONTENT AWAY FROM THE PANEL, which is the sign that was backwards', () => {
    // A drawing point p renders at (p − viewBoxMin)·scale, so RAISING viewBoxMin
    // moves content toward the start. In ltr the panel covers the inline END, so
    // the content must move start-ward: cx rises.
    const clear = framed()
    const covered = framed({ occlusion: { inlineEnd: 416, blockEnd: 0 } })
    expect(covered.cx).toBeGreaterThan(clear.cx)
  })

  it('is the exact mirror in Arabic — the ONE flip on the inline axis', () => {
    const ltr = framed({ occlusion: { inlineEnd: 416, blockEnd: 0 }, rtl: false })
    const rtl = framed({ occlusion: { inlineEnd: 416, blockEnd: 0 }, rtl: true })
    expect(rtl.cx).toBe(-ltr.cx)
    expect(rtl.width).toBe(ltr.width)
    expect(rtl.height).toBe(ltr.height)
  })

  it('does NOT flip the block axis — a sheet covers the bottom in both', () => {
    const ltr = framed({ occlusion: { inlineEnd: 0, blockEnd: 320 }, rtl: false })
    const rtl = framed({ occlusion: { inlineEnd: 0, blockEnd: 320 }, rtl: true })
    expect(rtl.cy).toBe(ltr.cy)
    expect(ltr.cy).toBeGreaterThan(0)
  })

  it('lands a child of the framed world at CARD size on BOTH widths — one constant', () => {
    // The whole justification for FRAME_FILL_PHONE existing at all. A uniform
    // six-wide tier has a parent/child diameter ratio of 2.69; the CARD band
    // starts at 140 CSS px and ends at 380.
    const childD = WORLD.worldD / 2.69
    const desk = apparent(framed(), STAGE.width, childD)
    const phone = apparent(
      frameCamera(WORLD, {
        viewport: PHONE,
        frameFill: FRAME_FILL_PHONE,
        occlusion: CLEAR,
        rtl: false,
      }),
      PHONE.width,
      childD,
    )
    expect(desk).toBeGreaterThan(140)
    expect(desk).toBeLessThan(380)
    expect(phone).toBeGreaterThan(140)
    expect(phone).toBeLessThan(380)
    // …and the phone's framed world genuinely OVERFLOWS, which is the trade.
    expect(apparent(
      frameCamera(WORLD, {
        viewport: PHONE,
        frameFill: FRAME_FILL_PHONE,
        occlusion: CLEAR,
        rtl: false,
      }),
      PHONE.width,
      WORLD.worldD,
    )).toBeGreaterThan(PHONE.width)
  })

  it('is TOTAL — no input produces a NaN in the viewBox', () => {
    const torn: [string, Camera][] = [
      ['zero viewport', frameCamera(WORLD, { viewport: { width: 0, height: 0 }, frameFill: 0.87, occlusion: CLEAR, rtl: false })],
      ['zero world', frameCamera({ worldX: 0, worldY: 0, worldD: 0 }, { viewport: STAGE, frameFill: 0.87, occlusion: CLEAR, rtl: false })],
      ['NaN world', frameCamera({ worldX: Number.NaN, worldY: Number.NaN, worldD: Number.NaN }, { viewport: STAGE, frameFill: 0.87, occlusion: CLEAR, rtl: false })],
      ['negative fill', frameCamera(WORLD, { viewport: STAGE, frameFill: -2, occlusion: CLEAR, rtl: false })],
      ['occlusion wider than the stage', frameCamera(WORLD, { viewport: STAGE, frameFill: 0.87, occlusion: { inlineEnd: 99999, blockEnd: 99999 }, rtl: false })],
      ['NaN occlusion', frameCamera(WORLD, { viewport: STAGE, frameFill: 0.87, occlusion: { inlineEnd: Number.NaN, blockEnd: Number.NaN }, rtl: false })],
    ]
    for (const [name, cam] of torn) {
      expect(viewBoxOf(cam), name).not.toContain('NaN')
      expect(Number.isFinite(cam.cx) && Number.isFinite(cam.width), name).toBe(true)
      expect(cam.width, name).toBeGreaterThan(0)
    }
  })

  it('is PURE — the same arguments give the same answer', () => {
    expect(framed()).toEqual(framed())
  })
})

/* ─────────────────── the anchor, which is the bug this fixes ──────────────── */

describe('anchoredZoom', () => {
  /** Where a drawing point lands on screen, as a fraction of the window. */
  function onScreen(cam: Camera, point: { x: number; y: number }): [number, number] {
    return [(point.x - (cam.cx - cam.width / 2)) / cam.width, (point.y - (cam.cy - cam.height / 2)) / cam.height]
  }

  it('holds the anchor to 1e-9 for ANY finite positive ratio', () => {
    const anchor = { x: 812, y: 133 }
    const before = onScreen(WIDE, anchor)
    for (const ratio of [0.001, 0.25, 0.5, 0.9999, 1, 1.15, 2, 37, 1e5]) {
      const after = onScreen(anchoredZoom(WIDE, anchor, ratio), anchor)
      expect(Math.abs(after[0] - before[0]), `ratio ${ratio}`).toBeLessThan(1e-9)
      expect(Math.abs(after[1] - before[1]), `ratio ${ratio}`).toBeLessThan(1e-9)
    }
  })

  it('holds an anchor OUTSIDE the window too — a cursor over the margin', () => {
    const anchor = { x: -4000, y: 9000 }
    const before = onScreen(WIDE, anchor)
    const after = onScreen(anchoredZoom(WIDE, anchor, 0.4), anchor)
    expect(Math.abs(after[0] - before[0])).toBeLessThan(1e-9)
    expect(Math.abs(after[1] - before[1])).toBeLessThan(1e-9)
  })

  it('is NOT the same as zooming about the centre — which is the whole defect', () => {
    // The bug: every pinch resolved `pan === null` to the fit centre, so the
    // picture slid out from under the reader's fingers. If these two agreed,
    // the fix would be cosmetic.
    const anchor = { x: 900, y: 400 }
    const centred = { ...WIDE, width: WIDE.width * 0.5, height: WIDE.height * 0.5 }
    expect(anchoredZoom(WIDE, anchor, 0.5).cx).not.toBe(centred.cx)
  })

  it('anchoring on the centre IS the centred zoom, so the two agree where they should', () => {
    const centre = { x: WIDE.cx, y: WIDE.cy }
    expect(anchoredZoom(WIDE, centre, 0.5)).toEqual({
      cx: WIDE.cx,
      cy: WIDE.cy,
      width: 480,
      height: 260,
    })
  })

  it('refuses a ratio that is not a magnification', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(anchoredZoom(WIDE, { x: 1, y: 2 }, bad)).toBe(WIDE)
    }
  })

  it('composes: two zooms about one anchor are one zoom of the product', () => {
    const anchor = { x: 300, y: 200 }
    const twice = anchoredZoom(anchoredZoom(WIDE, anchor, 0.5), anchor, 0.5)
    const once = anchoredZoom(WIDE, anchor, 0.25)
    expect(twice.cx).toBeCloseTo(once.cx, 9)
    expect(twice.width).toBeCloseTo(once.width, 9)
  })
})

/* ──────────────────────── the two ends of the dive ───────────────────────── */

describe('clampCamera', () => {
  const bounds: CameraBounds = { minWidth: 100, maxWidth: 4000 }

  it('is IDEMPOTENT, which is what lets it run on every write', () => {
    for (const width of [10, 99, 100, 101, 2000, 3999, 4000, 4001, 90000]) {
      const once = clampCamera(camera({ width, height: width / 2 }), bounds)
      expect(clampCamera(once, bounds)).toEqual(once)
    }
  })

  it('holds the aspect, so the map never letterboxes', () => {
    const pulled = clampCamera(camera({ width: 40, height: 20 }), bounds)
    expect(pulled.width / pulled.height).toBeCloseTo(2, 12)
    expect(pulled.width).toBe(100)
  })

  it('never moves the centre — a clamp is not a pan', () => {
    const held = clampCamera(camera({ cx: 77, cy: -3, width: 99999, height: 50000 }), bounds)
    expect(held.cx).toBe(77)
    expect(held.cy).toBe(-3)
  })

  it('returns the SAME OBJECT when there is nothing to do', () => {
    const inside = camera({ width: 500, height: 270 })
    expect(clampCamera(inside, bounds)).toBe(inside)
  })

  it('survives a torn bounds by sorting it rather than throwing', () => {
    const crossed = clampCamera(camera({ width: 5000 }), { minWidth: 4000, maxWidth: 100 })
    expect(crossed.width).toBe(4000)
  })
})

describe('rubberBand', () => {
  it('is CONTINUOUS at the limit — exactly the limit, not nearly', () => {
    expect(rubberBand(220, 220)).toBe(220)
    expect(rubberBand(1, 1)).toBe(1)
  })

  it('is MONOTONE on both sides, so the picture never reverses under a finger', () => {
    let previous = 0
    for (const width of [10, 50, 100, 199, 200, 201, 400, 4000, 40000]) {
      const drawn = rubberBand(width, 200)
      expect(drawn).toBeGreaterThan(previous)
      previous = drawn
    }
  })

  it('RESISTS — always closer to the limit than the request was', () => {
    expect(rubberBand(800, 200)).toBeGreaterThan(200)
    expect(rubberBand(800, 200)).toBeLessThan(800)
    expect(rubberBand(50, 200)).toBeLessThan(200)
    expect(rubberBand(50, 200)).toBeGreaterThan(50)
  })

  it('spends 0.35 exactly: 4x past a bound draws 1.6x past it', () => {
    expect(rubberBand(800, 200)).toBeCloseTo(200 * Math.pow(4, RUBBER_EXPONENT), 9)
    expect(Math.pow(4, RUBBER_EXPONENT)).toBeCloseTo(1.6, 1)
  })

  it('passes a torn width through rather than inventing one', () => {
    expect(rubberBand(Number.NaN, 200)).toBeNaN()
    expect(rubberBand(-5, 200)).toBe(-5)
    expect(rubberBand(300, 0)).toBe(300)
  })
})

describe('rubberBandCamera', () => {
  const bounds: CameraBounds = { minWidth: 200, maxWidth: 2000 }

  it('does nothing inside the dive', () => {
    const inside = camera({ width: 900, height: 500 })
    expect(rubberBandCamera(inside, bounds)).toBe(inside)
  })

  it('resists past the TERMINUS and the spring-back is the clamp', () => {
    const past = camera({ width: 50, height: 27 })
    const drawn = rubberBandCamera(past, bounds)
    expect(drawn.width).toBeGreaterThan(50)
    expect(drawn.width).toBeLessThan(200)
    expect(clampCamera(drawn, bounds).width).toBe(200)
  })

  it('resists past the far end too', () => {
    const drawn = rubberBandCamera(camera({ width: 32000, height: 17000 }), bounds)
    expect(drawn.width).toBeLessThan(32000)
    expect(drawn.width).toBeGreaterThan(2000)
  })

  it('holds the aspect while resisting', () => {
    const drawn = rubberBandCamera(camera({ width: 50, height: 25 }), bounds)
    expect(drawn.width / drawn.height).toBeCloseTo(2, 12)
  })
})

/* ─────────────────────────── the terminus, priced ────────────────────────── */

describe('ZOOM_HEADROOM is the owner’s correction made physical', () => {
  it('leaves an Organization card comfortably readable at the stop', () => {
    // The terminus is D(deepest department)/2.2. At that camera the deepest
    // department's world is 2.2 windows across, so a leaf Org card inside it —
    // one of six, at the 2.69 packing ratio — is well past the CARD floor.
    const deepestD = 1000
    const terminus: CameraBounds = { minWidth: deepestD / ZOOM_HEADROOM, maxWidth: 1e9 }
    const at = cameraAtWidth(camera(), terminus.minWidth)
    expect(apparent(at, STAGE.width, deepestD / 2.69)).toBeGreaterThan(380)
  })

  it('is a DEAD STOP, not a slow lane — past it the clamp does not move', () => {
    const bounds: CameraBounds = { minWidth: 454, maxWidth: 1e9 }
    expect(clampCamera(cameraAtWidth(camera(), 1), bounds).width).toBe(454)
    expect(clampCamera(cameraAtWidth(camera(), 0.0001), bounds).width).toBe(454)
  })
})

/* ─────────────────────────── the dive rail ───────────────────────────────── */

describe('octavesOf', () => {
  it('is ZERO when the root world exactly spans the stage’s smaller side', () => {
    expect(octavesOf({ cx: 0, cy: 0, width: 2000, height: 1000 }, 1000, 835)).toBe(0)
  })

  it('counts ONE PER DOUBLING of magnification, and rises as you go in', () => {
    expect(octavesOf({ cx: 0, cy: 0, width: 1000, height: 500 }, 1000, 835)).toBe(1)
    expect(octavesOf({ cx: 0, cy: 0, width: 500, height: 250 }, 1000, 835)).toBe(2)
    expect(octavesOf({ cx: 0, cy: 0, width: 4000, height: 2000 }, 1000, 835)).toBe(-1)
  })

  it('DOES NOT DEPEND ON THE PIXELS — they cancel, and that is asserted', () => {
    const cam = { cx: 0, cy: 0, width: 1234, height: 567 }
    expect(octavesOf(cam, 1000, 835)).toBe(octavesOf(cam, 1000, 375))
  })

  it('answers 0 rather than a fiction for a stage nobody has measured', () => {
    expect(octavesOf(WIDE, 1000, 0)).toBe(0)
    expect(octavesOf(WIDE, 0, 835)).toBe(0)
    expect(octavesOf({ cx: 0, cy: 0, width: 0, height: 0 }, 1000, 835)).toBe(0)
  })

  it('a dive and its surface are exact inverses — the reference’s promise', () => {
    // "Surfacing returns the camera to the identical framing it left, TO THE
    // UNIT" — true because coordinates are absolute and the drawing is static.
    const parent = framed()
    const child = frameCamera({ worldX: 120, worldY: -60, worldD: 1000 / 2.69 }, {
      viewport: STAGE,
      frameFill: FRAME_FILL_DESKTOP,
      occlusion: CLEAR,
      rtl: false,
    })
    expect(viewBoxOf(parent)).toBe(viewBoxOf(framed()))
    const down = octavesOf(child, 1000, 835) - octavesOf(parent, 1000, 835)
    expect(down).toBeCloseTo(Math.log2(2.69), 12)
  })
})

/* ──────────────────────────────── the wheel ──────────────────────────────── */

describe('wheelRatio', () => {
  it('makes a 100px mouse notch exactly 1.15x, which is where κ comes from', () => {
    expect(wheelRatio({ deltaY: 100 })).toBeCloseTo(1.15, 12)
    expect(wheelRatio({ deltaY: -100 })).toBeCloseTo(1 / 1.15, 12)
  })

  it('zooms OUT on a downward scroll — positive deltaY widens the view', () => {
    expect(wheelRatio({ deltaY: 50 })).toBeGreaterThan(1)
    expect(wheelRatio({ deltaY: -50 })).toBeLessThan(1)
  })

  it('is EXPONENTIAL, so a notch means the same magnification at every distance', () => {
    // Two notches of 50 compose into one notch of 100 exactly.
    expect(wheelRatio({ deltaY: 50 }) * wheelRatio({ deltaY: 50 })).toBeCloseTo(
      wheelRatio({ deltaY: 100 }),
      12,
    )
  })

  it('converts DOM_DELTA_LINE at 16px a line, so Firefox is not 16x slower', () => {
    expect(wheelRatio({ deltaY: 3, deltaMode: 1 })).toBeCloseTo(wheelRatio({ deltaY: 48 }), 12)
  })

  it('takes ctrl — the macOS trackpad pinch — down the SAME path at 3x', () => {
    expect(wheelRatio({ deltaY: 10, ctrlKey: true })).toBeCloseTo(wheelRatio({ deltaY: 30 }), 12)
  })

  it('never answers a ratio that would blank the map', () => {
    for (const deltaY of [Number.NaN, Number.POSITIVE_INFINITY, -1e9, 1e9]) {
      const ratio = wheelRatio({ deltaY })
      expect(Number.isFinite(ratio)).toBe(true)
      expect(ratio).toBeGreaterThan(0)
    }
  })
})

/* ──────────── the byte-identity that keeps a frame loop honest ───────────── */

describe('the loop’s last write and React’s next render are the SAME BYTES', () => {
  it('holds across a whole tween, ending on the destination', () => {
    // A frame loop writes `viewBox` behind React's back, and React only writes
    // an attribute when the PROP changed between renders. If the loop's final
    // frame is not byte-identical to what React would render for the settled
    // camera, React sees no change, writes nothing, and the map is stuck where
    // the loop left it until something else moves it.
    const to = frameCamera({ worldX: 137.5, worldY: -62.25, worldD: 371.7 }, {
      viewport: STAGE,
      frameFill: FRAME_FILL_DESKTOP,
      occlusion: { inlineEnd: 416, blockEnd: 0 },
      rtl: false,
    })
    const tween = beginCameraTween(framed(), to, 0)
    if (tween === null) throw new Error('expected a tween')
    const lastFrame = sampleCamera(tween, tween.durationMs)
    expect(lastFrame.done).toBe(true)
    // The loop's write…
    expect(viewBoxOf(lastFrame.camera)).toBe(viewBoxOf(to))
    // …and React's, from the state the loop settles into. Same formatter, one
    // formatter, so there is nothing to correct.
    expect(viewBoxOf(lastFrame.camera)).toBe(viewBoxOf(clampCamera(to, { minWidth: 1, maxWidth: 1e12 })))
  })
})

/* ─────────── the DAG, asserted against the hook’s own source text ────────── */

// WHY SOURCE AND NOT A RENDER, stated where it can be checked rather than
// assumed: vitest.config.ts pins `environment: 'node'` and neither jsdom nor a
// React test renderer is in the dependency budget, so there is no way to render
// this hook ten times and count anything. `pages/MindtreeShell.test.ts` opens
// with the same admission and reads source for the same reason. A grep is a
// weak assertion; it is stronger than the nothing that guarded the feedback
// cycle when the map shipped with it in.
//
// Each assertion names the MEASURED defect it stands guard over.

function hookSource(): string {
  const src = readFileSync(new URL('./useMapGeometry.ts', import.meta.url), 'utf8')
  if (src.trim() === '') throw new Error('useMapGeometry.ts is empty')
  return src
}

/**
 * Which hook-level binding each `layout.bounds` read lives inside.
 *
 * The two-space `const` is a declaration at the hook's own level; anything
 * deeper is inside one of them. This is the assertion that the drawing's extent
 * reaches exactly two expressions and neither is consulted per render by the
 * camera.
 */
function boundsReaders(src: string): string[] {
  const owners = new Set<string>()
  for (const hit of src.matchAll(/layout\.bounds/g)) {
    const declared = [...src.slice(0, hit.index).matchAll(/\n {2}const (\w+) = /g)].pop()
    owners.add(declared?.[1] ?? '<top level>')
  }
  return [...owners]
}

/** Source with every block and line comment removed. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('the camera cannot feed the geometry — by construction, not by care', () => {
  it('has NO import path to the layout module’s layout functions', () => {
    // The named trap was depthLimit → layout → bounds → fit.scale → zoomBounds
    // → heldZoom → depthLimit. It has no first link here because the hook
    // cannot call a layout function at all: the drawing arrives as an argument.
    const src = code(hookSource())
    expect(src).not.toContain('layoutMindtreeRadial')
    expect(src).not.toContain('layoutWorlds')
    expect(src).not.toContain('ringsThatFit')
    expect(src).not.toContain('depthLimit')
  })

  it('reads layout.bounds in exactly TWO places, and neither is on the camera path', () => {
    // `initialCamera` — the one mount-time arrow, called from the `useState`
    // initializer, from the revision guard and from the first-measurement
    // correction, and from nowhere that a camera value can reach.
    // `wholeMapFit`  — the EXPORT's frame, keyed on the layout and the element.
    // Anything else reading the drawing's extent is the first link of the cycle
    // growing back.
    expect(boundsReaders(code(hookSource())).sort()).toEqual(['initialCamera', 'wholeMapFit'])
    expect(code(hookSource())).toContain('useState<CameraState>(() => ({')
  })

  it('never reintroduces a multiplier of a moving fit', () => {
    const src = code(hookSource())
    for (const dead of ['heldZoom', 'zoomBounds', 'clampZoom', 'zoomLimits', 'setZoom', 'resetView', 'altitude']) {
      expect(src, dead).not.toContain(dead)
    }
  })

  it('holds ONE piece of view state — the camera, and nothing beside it', () => {
    const src = code(hookSource())
    expect(src.match(/useState[<(]/g) ?? []).toHaveLength(1)
  })

  it('attaches the wheel NON-PASSIVELY, which is what lets preventDefault run', () => {
    // ctrl+wheel is how macOS reports a trackpad pinch, and its default action
    // is to page-zoom the browser. A passive listener may not preventDefault,
    // and React's root listeners are passive.
    const src = code(hookSource())
    expect(src).toContain("addEventListener('wheel', handler, { passive: false })")
    expect(src).toContain('event.preventDefault()')
  })

  it('anchors every zoom on a point the READER chose — all three sites', () => {
    const src = code(hookSource())
    // The wheel and the pinch both go through anchoredZoom; the pan does not
    // zoom at all, which is the third of the three sites that used to resolve
    // `pan === null` to the fit centre.
    expect((src.match(/anchoredZoom\(/g) ?? []).length).toBeGreaterThanOrEqual(2)
    // The three retired spellings of "resolve `pan === null` to the fit centre",
    // one per call site, quoted from the file this replaces.
    expect(src).not.toContain('fit.x + fit.width / 2')
    expect(src).not.toContain('setPan(')
    expect(src).not.toMatch(/\bpan \?\?/)
    expect(src).not.toMatch(/\bpan === null/)
  })

  it('takes reducedMotion as an ARGUMENT — no matchMedia in the camera', () => {
    const src = code(hookSource())
    expect(src).not.toContain('matchMedia')
    expect(src).toContain('reducedMotion')
  })

  it('keeps mapMotion PURE — not one line of it touches a browser', () => {
    const src = code(readFileSync(new URL('./mapMotion.ts', import.meta.url), 'utf8'))
    for (const forbidden of [
      'document',
      'window.',
      'requestAnimationFrame',
      'matchMedia',
      'performance.now',
      'from \'react\'',
    ]) {
      expect(src, forbidden).not.toContain(forbidden)
    }
  })
})

/* ───────────────────── the curve is the stylesheet's curve ───────────────── */

// Read from disk, the way src/styles/contrast.test.ts already reads global.css.
// `import.meta.glob(..., {query: '?raw'})` — what this reached for first — hands
// back an EMPTY STRING under vitest, because the CSS pipeline is stubbed out in
// the test environment. Every assertion below then passed vacuously against ''
// rather than failing, which is the worst way for a mirror test to be wrong.
const NODE_FS = 'node:fs'
const { readFileSync } = (await import(NODE_FS)) as {
  readFileSync: (path: URL, encoding: 'utf8') => string
}

function sheet(): string {
  const css = readFileSync(new URL('../mindtree.css', import.meta.url), 'utf8')
  if (css.trim() === '') throw new Error('mindtree.css is empty')
  return css
}

describe('the JS camera and the CSS relayout are ONE motion', () => {
  // Two curves of different shapes over the same 240ms is the sort of defect
  // nobody can name and everybody can feel: focusing a branch moves every node
  // (CSS) and re-fits the window (mapMotion) at the same instant. If somebody
  // retunes one of these, this test tells them there is a second copy.
  it('uses the duration mindtree.css declares', () => {
    expect(sheet()).toContain(`--mtree-tween: ${MAP_TWEEN_MS}ms`)
  })

  it('uses the control points mindtree.css declares', () => {
    const [x1, y1, x2, y2] = MAP_EASE_POINTS
    expect(sheet()).toContain(`--mtree-ease: cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`)
  })

  it('names mapMotion.ts in the sheet, so the mirror is findable from both ends', () => {
    expect(sheet()).toContain('mapMotion.ts')
  })
})
