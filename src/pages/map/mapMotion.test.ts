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
  beginCameraTween,
  cameraEqual,
  cameraOf,
  cubicBezierEase,
  FLY_MAX_MS,
  FLY_MIN_MS,
  flyToCamera,
  flyToNode,
  lerpCamera,
  MAP_EASE,
  MAP_EASE_POINTS,
  MAP_TWEEN_MS,
  retargetCameraTween,
  sampleCamera,
  tweenDurationFor,
  tweenProgress,
  viewBoxOf,
  zoomForCamera,
  type Camera,
  type MotionBox,
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

  it('counts zoom in octaves, so a 4x change is the full trip on its own', () => {
    expect(tweenDurationFor(WIDE, camera({ width: 240, height: 130 }))).toBe(FLY_MAX_MS)
    // …and reversing it costs the same, which a ratio does and a difference
    // does not.
    expect(tweenDurationFor(camera({ width: 240, height: 130 }), WIDE)).toBe(FLY_MAX_MS)
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
