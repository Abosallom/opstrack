// lib/dnd.ts is pure by construction, so the fiddly half of a kanban drag — the
// half that is otherwise only reachable by dragging a real card with a real
// finger — is asserted here instead of in a manual pass.
//
// The cases below are the ones that actually broke boards in review: a tap
// becoming a move, a phone scroll being claimed as a drag, a card dropped over
// the gap between columns going nowhere, and ArrowRight moving the wrong way in
// Arabic.
//
// The touch block is the mobile pass's MB2 written down. A board that claims a
// finger's first sideways pixel has no gesture left for "show me the next
// column", and on a phone that is the gesture the board is FOR. Every
// assertion there is one half of the handshake: nothing claimed before the
// hold, everything claimable after it.

import { describe, expect, it } from 'vitest'
import {
  DRAG_THRESHOLD_PX,
  HOLD_SLOP_PX,
  arrowStep,
  dropOf,
  edgeScroll,
  edgeScrollBlock,
  edgeScrollRange,
  holdDrag,
  indexFromDigit,
  isDragging,
  isHeld,
  isHoldGesture,
  moveDrag,
  moveIndex,
  startDrag,
  zoneAt,
  type DndZone,
} from './dnd'

/** Three 100px-wide columns side by side, 400px tall. The third is retired. */
const ZONES: DndZone[] = [
  { id: 'new', box: { x0: 0, x1: 100, y0: 100, y1: 500 }, accepts: true },
  { id: 'in_progress', box: { x0: 110, x1: 210, y0: 100, y1: 500 }, accepts: true },
  { id: 'waiting_on', box: { x0: 220, x1: 320, y0: 100, y1: 500 }, accepts: false },
]

/** A mouse press on the first column's card. */
function press(over = 'new') {
  return startDrag({ pointerId: 1, itemId: 'e1', fromId: over, x: 50, y: 200 })
}

/** A finger on the same card: nothing is claimed until the hold lands. */
function touch(over = 'new') {
  return startDrag({ pointerId: 1, itemId: 'e1', fromId: over, x: 50, y: 200, requireHold: true })
}

describe('moveDrag', () => {
  it('stays armed, and reference-identical, under the threshold', () => {
    const s = press()
    const next = moveDrag(s, 50 + DRAG_THRESHOLD_PX - 1, 200, ZONES)
    expect(next).toBe(s)
    expect(isDragging(next)).toBe(false)
  })

  it('commits once the pointer clears the threshold', () => {
    const s = moveDrag(press(), 150, 210, ZONES)
    expect(s.phase).toBe('dragging')
    expect(s.overId).toBe('in_progress')
  })

  it('keeps a mostly-vertical MOUSE gesture — there is nothing else it could mean', () => {
    expect(moveDrag(press(), 52, 260, ZONES).phase).toBe('dragging')
  })
})

describe('the touch hold', () => {
  it('claims nothing while the clock is running', () => {
    const s = touch()
    // A finger that has not yet earned the card cannot be dragging, however far
    // across the board it travels — that travel is the board panning.
    expect(isDragging(s)).toBe(false)
    const drift = moveDrag(s, 50 + HOLD_SLOP_PX - 1, 200 + HOLD_SLOP_PX - 1, ZONES)
    expect(drift).toBe(s)
  })

  it('abandons to the browser the moment the finger pans, terminally', () => {
    // THE MB2 REGRESSION. This is the swipe that reaches the next column on a
    // phone, and the board must not take it.
    const s = moveDrag(touch(), 150, 205, ZONES)
    expect(s.phase).toBe('abandoned')
    expect(moveDrag(s, 300, 205, ZONES).phase).toBe('abandoned')
    // A vertical pan — the page scrolling — is the same story.
    expect(moveDrag(touch(), 50, 400, ZONES).phase).toBe('abandoned')
  })

  it('lifts the card in place when the hold lands, over the column it sits in', () => {
    const s = holdDrag(touch(), ZONES)
    expect(s.phase).toBe('dragging')
    expect(isHeld(s)).toBe(true)
    // Resolved at the lift, not on the first move: a card that is plainly in a
    // column must not show "no target" for the first frame of its own drag.
    expect(s.overId).toBe('new')
  })

  it('drags in any direction once held — the axis lock was the early-claim tax', () => {
    const held = holdDrag(touch(), ZONES)
    const down = moveDrag(held, 55, 480, ZONES)
    expect(down.phase).toBe('dragging')
    expect(moveDrag(down, 150, 480, ZONES).overId).toBe('in_progress')
  })

  it('is a no-op on a mouse session, and on a hold that already landed', () => {
    const mouse = press()
    expect(holdDrag(mouse, ZONES)).toBe(mouse)
    const held = holdDrag(touch(), ZONES)
    expect(holdDrag(held, ZONES)).toBe(held)
    // And on one the finger already panned away from.
    const gone = moveDrag(touch(), 150, 205, ZONES)
    expect(holdDrag(gone, ZONES)).toBe(gone)
  })

  it('tells a touch press from a mouse press, which is what the suppressions key off', () => {
    expect(isHoldGesture(touch())).toBe(true)
    expect(isHoldGesture(press())).toBe(false)
    expect(isHoldGesture(null)).toBe(false)
    expect(isHeld(touch())).toBe(false)
    expect(isHeld(null)).toBe(false)
  })
})

describe('zoneAt', () => {
  it('prefers the column that contains the point', () => {
    expect(zoneAt(ZONES, 150, 300)).toBe('in_progress')
  })

  it('falls back to the inline axis above and below a column', () => {
    // A card lifted over the column header, or below its last card, is still
    // aimed at that column.
    expect(zoneAt(ZONES, 150, 20)).toBe('in_progress')
    expect(zoneAt(ZONES, 150, 900)).toBe('in_progress')
  })

  it('is blind to a column that does not accept drops', () => {
    expect(zoneAt(ZONES, 260, 300)).toBe(null)
  })

  it('returns null in the gutter between columns', () => {
    expect(zoneAt(ZONES, 105, 300)).toBe(null)
  })
})

describe('dropOf', () => {
  it('describes a real move', () => {
    expect(dropOf(moveDrag(press(), 150, 210, ZONES))).toEqual({
      itemId: 'e1',
      fromId: 'new',
      toId: 'in_progress',
    })
  })

  it('is null for a release over the column it started in', () => {
    expect(dropOf(moveDrag(press(), 60, 300, ZONES))).toBe(null)
  })

  it('is null for a press that never became a drag', () => {
    expect(dropOf(press())).toBe(null)
    expect(dropOf(null)).toBe(null)
  })
})

describe('edgeScroll', () => {
  const box = { x0: 0, x1: 1000, y0: 0, y1: 600 }

  it('is still in the middle', () => {
    expect(edgeScroll(500, box)).toBe(0)
  })

  it('pulls toward the start near the start edge and toward the end near the end', () => {
    expect(edgeScroll(4, box)).toBeLessThan(0)
    expect(edgeScroll(996, box)).toBeGreaterThan(0)
  })

  it('saturates rather than accelerating without limit past the edge', () => {
    expect(edgeScroll(-400, box, 64, 22)).toBe(-22)
    expect(edgeScroll(1400, box, 64, 22)).toBe(22)
  })

  it('reads the BLOCK axis of the same box for the hovered column’s own pan', () => {
    // A kanban has two scrollers under one finger: the board pans sideways and
    // the column under the pointer pans down. Same arithmetic, other pair of
    // numbers — which is the whole reason edgeScrollRange exists.
    expect(edgeScrollBlock(300, box)).toBe(0)
    expect(edgeScrollBlock(4, box)).toBeLessThan(0)
    expect(edgeScrollBlock(596, box)).toBeGreaterThan(0)
  })

  it('refuses to scroll a range too short to hold two dead zones', () => {
    // Every point in an 80px-tall column is inside both zones, so the first
    // branch would win permanently and the column would scroll itself upward
    // forever the moment a card passed over it.
    expect(edgeScrollRange(10, 0, 80)).toBe(0)
    expect(edgeScrollRange(70, 0, 80)).toBe(0)
    // One pixel over two zones, and it works again.
    expect(edgeScrollRange(1, 0, 129)).toBeLessThan(0)
  })
})

describe('arrowStep', () => {
  it('follows the reading direction', () => {
    expect(arrowStep('ArrowRight', 'ltr')).toBe(1)
    expect(arrowStep('ArrowRight', 'rtl')).toBe(-1)
    expect(arrowStep('ArrowLeft', 'ltr')).toBe(-1)
    expect(arrowStep('ArrowLeft', 'rtl')).toBe(1)
  })

  it('ignores everything else', () => {
    expect(arrowStep('ArrowUp', 'ltr')).toBe(0)
    expect(arrowStep('Enter', 'rtl')).toBe(0)
  })
})

describe('moveIndex', () => {
  it('clamps at both ends instead of wrapping', () => {
    expect(moveIndex(0, -1, 4)).toBe(0)
    expect(moveIndex(3, 1, 4)).toBe(3)
    expect(moveIndex(1, 1, 4)).toBe(2)
  })

  it('survives an empty board', () => {
    expect(moveIndex(0, 1, 0)).toBe(0)
  })
})

describe('indexFromDigit', () => {
  it('maps 1-based keys to 0-based columns', () => {
    expect(indexFromDigit('1', 6)).toBe(0)
    expect(indexFromDigit('4', 6)).toBe(3)
  })

  it('rejects a column that is not there, and anything that is not a digit', () => {
    expect(indexFromDigit('7', 6)).toBe(null)
    expect(indexFromDigit('0', 6)).toBe(null)
    expect(indexFromDigit('e', 6)).toBe(null)
    expect(indexFromDigit('12', 6)).toBe(null)
  })
})
