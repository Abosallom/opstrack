// lib/dnd.ts is pure by construction, so the fiddly half of a kanban drag — the
// half that is otherwise only reachable by dragging a real card with a real
// finger — is asserted here instead of in a manual pass.
//
// The cases below are the ones that actually broke boards in review: a tap
// becoming a move, a phone scroll being claimed as a drag, a card dropped over
// the gap between columns going nowhere, and ArrowRight moving the wrong way in
// Arabic.

import { describe, expect, it } from 'vitest'
import {
  DRAG_THRESHOLD_PX,
  arrowStep,
  dropOf,
  edgeScroll,
  indexFromDigit,
  isDragging,
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

function press(over = 'new', lock = false) {
  return startDrag({ pointerId: 1, itemId: 'e1', fromId: over, x: 50, y: 200, lockToInlineAxis: lock })
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

  it('abandons a mostly-vertical touch gesture, terminally', () => {
    const s = moveDrag(press('new', true), 52, 260, ZONES)
    expect(s.phase).toBe('abandoned')
    // Even a decisively horizontal move afterwards must not resurrect it: the
    // column is already scrolling under the finger.
    expect(moveDrag(s, 300, 260, ZONES).phase).toBe('abandoned')
  })

  it('keeps a mostly-vertical MOUSE gesture — there is nothing else it could mean', () => {
    expect(moveDrag(press('new', false), 52, 260, ZONES).phase).toBe('dragging')
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
