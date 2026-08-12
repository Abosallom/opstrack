// VIEWPORT SENSING — the two questions the map asks the browser about the
// space it has been given, and nothing else.
//
// Extracted from pages/Mindtree.tsx unchanged. Both hooks are guarded for the
// `node` test environment vitest.config.ts pins, which is why they could not
// simply be `window.matchMedia(...)` at the call site.
//
// ── THE SMALL SCREEN, HONESTLY ─────────────────────────────────────────────
//
// MINDTREE-SPEC asks for root + tracks + groups under 768px and says, in the
// same breath, that a cramped map is worse than an honest one. It is worth
// reading those two sentences together, because the first one loses.
//
// MEASURED, not judged by eye: a five-track workspace laid out for the 341x422
// canvas a 375px phone actually gives you comes to 464x584 drawing units at
// three rings, `fitToViewBox` returns 0.66, and the 12.5px label renders at
// 8.2px. Shrinking the node to its narrowest legible width (108px) only buys
// 8.5px, because what binds is three rings across the inline axis, not the
// size of the boxes. At ONE ring the same workspace is 298x260, the scale is
// 0.96, and the label is 12.0px — full size.
//
// So the phone gets one ring per screen and every tap goes one ring deeper:
// tracks, then that track's groups, then that group's items, with a breadcrumb
// back and pinch/pan throughout. It is a genuinely good one-handed experience
// rather than a bad small map, which is the outcome the spec asked for when it
// said to choose. `mindtree.mobileHint` says so on the screen.
//
// ── AND THE MEASUREMENT ABOVE IS NOW HISTORY, WHICH IS WORTH SAYING ────────
//
// Everything above describes the LINEAR map fitted to a whole tree, where the
// phone's problem was that three rings across 375px could not be legible and
// the answer was to draw fewer of them (`useMapGeometry`'s old `depthLimit`,
// pinned to 1 on a phone). The camera removes the requirement that generated
// the pin: the phone does not need everything to fit, it needs the CURRENT
// WORLD to fit, and a world is six to nine children on one ring at any depth in
// the tree. So the phone now gets the FULL hierarchy with identical LOD
// thresholds — the thresholds are in CSS pixels, and a CSS pixel is a CSS pixel.
// The phone is not a reduced map; it is the same map with a smaller window.
//
// `useIsCompact` survives because ONE constant still branches on it —
// `FRAME_FILL_PHONE` (mapMotion.ts), which deliberately overflows a small
// screen so a framed world's children come up at CARD size rather than CHIP —
// along with `useMapModel`'s collapse defaults and `useMapKeyboard`'s tap. One
// boolean, read once, threaded.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

const COMPACT_QUERY = '(max-width: 767px)'

function subscribeCompact(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const mq = window.matchMedia(COMPACT_QUERY)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

function readCompact(): boolean {
  // Guarded because the page tests in this repo render through
  // renderToStaticMarkup under vitest's `node` environment, where matchMedia
  // does not exist. Defaulting to the wide layout there is the honest choice:
  // the full map is the screen, and the drill-in is its small-screen shape.
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(COMPACT_QUERY).matches
}

export function useIsCompact(): boolean {
  return useSyncExternalStore(subscribeCompact, readCompact, readCompact)
}

/* ──────────────────────────── measuring the canvas ───────────────────────── */

export interface Box {
  width: number
  height: number
}

/**
 * The canvas rectangle in CSS pixels, tracked live.
 *
 * charts/geometry.ts's `useChartSize` measures the inline axis only, because a
 * chart's height is a prop. A map is fitted in BOTH axes — `fitToViewBox` takes
 * the min of the two ratios — so this one has to watch the block axis too. The
 * fallback is what the first frame and every non-browser render use: an
 * unmeasured container is 0×0, and `fitToViewBox` would divide by it.
 */
export function useBoxSize(fallback: Box): {
  ref: (el: HTMLDivElement | null) => void
  box: Box
} {
  const [box, setBox] = useState<Box>(fallback)
  const observed = useRef<ResizeObserver | null>(null)

  const ref = useCallback((el: HTMLDivElement | null) => {
    observed.current?.disconnect()
    observed.current = null
    if (el === null) return

    const measure = (): void => {
      const width = Math.round(el.clientWidth)
      const height = Math.round(el.clientHeight)
      if (width <= 0 || height <= 0) return
      // Guarded on an actual change: ResizeObserver fires on every reflow, and
      // writing the same numbers back would re-render the whole map on a
      // sibling's animation frame.
      setBox((prev) => (prev.width === width && prev.height === height ? prev : { width, height }))
    }

    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    observed.current = observer
  }, [])

  useEffect(() => () => observed.current?.disconnect(), [])

  return { ref, box }
}
