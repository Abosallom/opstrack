// useSwipeActions — the one-finger horizontal drag that reveals a row's quick
// actions on a phone.
//
// IT LIVES HERE, NOT IN src/lib/. It is a React hook: it holds state and returns
// event handlers, so it fails rule 2's "pure logic in lib/" on both counts, and
// the standing grep that keeps lib/ free of store and api imports would not
// catch a hook that merely imports React. Every consumer is an entry component,
// so the barrel is its home.
//
// DIRECTION IS LOGICAL, RESOLVED AT GESTURE START. `active` is 'start' or 'end',
// never 'left' or 'right', and the raw pointer delta is flipped once, up front,
// by reading the document's direction. That is the whole RTL story for this
// interaction: an Arabic user swiping toward the inline end of the row gets the
// same action an English user gets swiping the other way, with no mirror rules
// anywhere and no per-call-site `dir` check to forget. Resolved at START rather
// than per move because a locale switch mid-drag would otherwise invert the
// gesture under the user's thumb.
//
// POINTER EVENTS ONLY — no touchstart/mousedown pair. Pointer events cover
// touch, pen and mouse in one path, and `setPointerCapture` is what keeps the
// row receiving moves after the finger leaves its bounds, which is exactly what
// happens on any swipe long enough to matter.
//
// VERTICAL WINS TIES. A drag that is more vertical than horizontal is the page
// scrolling, and claiming it would make a list of rows unscrollable on the one
// device this gesture exists for. Once a direction is decided it is kept for the
// rest of the gesture, so a slightly wobbly horizontal swipe does not hand
// control back and forth.

import {
  useCallback,
  useRef,
  useState,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
} from 'react'

export interface SwipeActions {
  onStart?: () => void
  onEnd?: () => void
  /** Pixels of travel that count as a swipe rather than a tap. Default 56. */
  threshold?: number
}

export interface SwipeHandlers {
  handlers: Pick<
    HTMLAttributes<HTMLElement>,
    'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel'
  >
  /** Logical offset in px: positive drags toward the inline END. */
  offset: number
  active: 'start' | 'end' | null
}

const DEFAULT_THRESHOLD = 56

/** Beyond this the gesture is a scroll, not a swipe. */
const AXIS_LOCK_PX = 8

/** +1 in LTR, -1 in RTL — the single place a physical delta becomes logical. */
function directionSign(): number {
  if (typeof document === 'undefined') return 1
  return document.documentElement.dir === 'rtl' ? -1 : 1
}

export function useSwipeActions(a: SwipeActions = {}): SwipeHandlers {
  const threshold = a.threshold ?? DEFAULT_THRESHOLD
  const [offset, setOffset] = useState(0)
  const [active, setActive] = useState<'start' | 'end' | null>(null)

  // The callbacks live in a ref so the four handlers stay reference-stable
  // across renders. Callers pass an object literal — `useSwipeActions({ onStart })`
  // — which is a new object every render, and depending on it directly would
  // hand every row four new props on every parent render, defeating the memo
  // the list owner put there to keep sixty rows cheap.
  const opts = useRef(a)
  opts.current = a

  // A ref, not state: this changes on every pointermove and none of it should
  // cause a render on its own. Only `offset` and `active` are rendered.
  const gesture = useRef<{
    id: number
    x: number
    y: number
    sign: number
    axis: 'none' | 'x' | 'y'
  } | null>(null)

  const reset = useCallback(() => {
    gesture.current = null
    setOffset(0)
    setActive(null)
  }, [])

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    // Mouse drags are not swipes — a desktop user has the visible buttons, and
    // claiming mousedown would break text selection in the row title.
    if (e.pointerType === 'mouse') return
    gesture.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      sign: directionSign(),
      axis: 'none',
    }
  }, [])

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const g = gesture.current
      if (!g || g.id !== e.pointerId) return
      const dx = e.clientX - g.x
      const dy = e.clientY - g.y

      if (g.axis === 'none') {
        if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return
        g.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
        if (g.axis === 'x') {
          // Capture so the row keeps receiving moves once the finger leaves it;
          // without this a swipe that travels past the row's edge simply stops.
          e.currentTarget.setPointerCapture(e.pointerId)
          opts.current.onStart?.()
        }
      }
      if (g.axis !== 'x') return

      const logical = dx * g.sign
      setOffset(logical)
      setActive(Math.abs(logical) >= threshold ? (logical > 0 ? 'end' : 'start') : null)
    },
    [threshold],
  )

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const g = gesture.current
      if (!g || g.id !== e.pointerId) return
      if (g.axis === 'x') {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId)
        }
        opts.current.onEnd?.()
      }
      reset()
    },
    [reset],
  )

  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      // Cancel takes the same path as up, minus onEnd: the OS took the gesture
      // (a system back-swipe, an incoming call), and a consumer that committed
      // an action on cancel would fire it on a gesture the user never finished.
      onPointerCancel: reset,
    },
    offset,
    active,
  }
}
