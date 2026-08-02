// The drag gesture and the hit test, asserted without a pointer, a pixel or a
// pane. Everything here is arithmetic over rectangles, which is the property
// drag.ts was written to have.
//
// THE CASES ARE THE ONES THAT BREAK A MAP RATHER THAN A BOARD:
//
//  - A tap on a leaf must open the entry, not move it. That is the threshold,
//    and it belongs to lib/dnd.ts — asserted here as INHERITED rather than
//    reimplemented, because the failure this guards is the two modules drifting.
//  - A finger that pans the map must not walk off with a node. That is the hold.
//  - A pointer between two branches must land on NOTHING, not on whichever
//    branch happens to be first in the column. This is where a kanban hit test
//    stops being reusable, and it has its own block below.
//  - The Arabic map has to be hit tested by the identical code path. layout.ts
//    mirrors the geometry, so the proof is an equality between two real layouts
//    rather than a direction flag threaded through the drag.

import { describe, expect, it } from 'vitest'
import {
  DRAG_THRESHOLD_PX,
  DROP_SLOP_PX,
  HOLD_MS,
  HOLD_SLOP_PX,
  clientToLayout,
  dragPan,
  dropZonesFrom,
  holdMindDrag,
  isMindDragging,
  isMindHeld,
  isMindHoldGesture,
  layoutSlop,
  mindDrop,
  moveMindDrag,
  nodeAt,
  startMindDrag,
  type MindDragSession,
  type MindDropZone,
  type Rect,
} from './drag'
import {
  DRAG_THRESHOLD_PX as DND_THRESHOLD,
  HOLD_MS as DND_HOLD_MS,
  HOLD_SLOP_PX as DND_HOLD_SLOP,
} from '../dnd'
import { layoutMindtree, type LayoutInputNode } from './layout'

// ── fixtures ───────────────────────────────────────────────────────────────

/**
 * Three branches in one column, 168x44 each, with a 12-unit sibling gap — the
 * layout module's own defaults, so the numbers below are the real ones.
 */
const ZONES: MindDropZone[] = [
  { nodeId: 'trk-1', x: 100, y: 0, width: 168, height: 44 },
  { nodeId: 'trk-2', x: 100, y: 56, width: 168, height: 44 },
  { nodeId: 'trk-3', x: 100, y: 112, width: 168, height: 44 },
]

/** A mouse press on a leaf sitting under trk-1. */
function press(client = { x: 400, y: 20 }, at = { x: 400, y: 20 }): MindDragSession {
  return startMindDrag({
    pointerId: 1,
    entryId: 'e1',
    nodeId: 'root/track:trk-1/group:new/entry:e1',
    fromNodeId: 'root/track:trk-1/group:new',
    client,
    at,
  })
}

/** The same press with a finger: nothing is claimed until the hold lands. */
function touch(): MindDragSession {
  return startMindDrag({
    pointerId: 1,
    entryId: 'e1',
    nodeId: 'root/track:trk-1/group:new/entry:e1',
    fromNodeId: 'root/track:trk-1/group:new',
    client: { x: 400, y: 20 },
    at: { x: 400, y: 20 },
    requireHold: true,
  })
}

/** Drag straight onto the middle branch's centre, mouse. */
function draggedOnto(zone: MindDropZone): MindDragSession {
  const at = { x: zone.x + zone.width / 2, y: zone.y + zone.height / 2 }
  return moveMindDrag(press(), { x: 500, y: 300 }, at, ZONES)
}

// ── the gesture is dnd.ts's, not a copy of it ──────────────────────────────

describe('the constants are the board’s', () => {
  it('re-exports lib/dnd.ts rather than restating it', () => {
    // Identity, not equality. Two modules that happen to both say 6 today are
    // two modules that stop agreeing the day one of them is tuned — and the
    // symptom is a card that lifts on the board and taps open on the map.
    expect(DRAG_THRESHOLD_PX).toBe(DND_THRESHOLD)
    expect(HOLD_MS).toBe(DND_HOLD_MS)
    expect(HOLD_SLOP_PX).toBe(DND_HOLD_SLOP)
  })
})

describe('threshold', () => {
  it('stays armed, and reference-identical, under the threshold', () => {
    const s = press()
    const next = moveMindDrag(s, { x: 400 + DRAG_THRESHOLD_PX - 1, y: 20 }, { x: 999, y: 999 }, ZONES)
    expect(next).toBe(s)
    expect(isMindDragging(next)).toBe(false)
    // The layout point is NOT taken on either: nothing has been claimed, so
    // nothing about the drag may have moved.
    expect(next.at).toEqual({ x: 400, y: 20 })
    expect(next.overNodeId).toBeNull()
  })

  it('commits at the threshold and resolves a target in the same step', () => {
    const s = press()
    const at = { x: 184, y: 78 }
    const next = moveMindDrag(s, { x: 400 + DRAG_THRESHOLD_PX, y: 20 }, at, ZONES)
    expect(next).not.toBe(s)
    expect(isMindDragging(next)).toBe(true)
    expect(next.overNodeId).toBe('trk-2')
    expect(next.at).toEqual(at)
  })

  it('measures the threshold in SCREEN pixels, not drawing units', () => {
    // The map is usually fitted well under 1:1. A threshold read in layout units
    // would arm a drag after 6 units — twenty screen pixels at a 0.31 fit — on
    // exactly the view where a shaky hand needs more tolerance, not less. The
    // layout point here travels hundreds of units while the finger travels five.
    const s = press()
    expect(moveMindDrag(s, { x: 405, y: 20 }, { x: 5000, y: 5000 }, ZONES)).toBe(s)
  })
})

describe('hold-to-lift', () => {
  it('claims nothing while a finger rests', () => {
    const s = touch()
    const next = moveMindDrag(s, { x: 400 + HOLD_SLOP_PX - 1, y: 20 }, { x: 184, y: 78 }, ZONES)
    expect(next).toBe(s)
    expect(isMindDragging(next)).toBe(false)
    expect(isMindHoldGesture(next)).toBe(true)
    expect(isMindHeld(next)).toBe(false)
  })

  it('abandons to the browser when the finger pans instead', () => {
    const s = touch()
    const next = moveMindDrag(s, { x: 400 + HOLD_SLOP_PX, y: 20 }, { x: 184, y: 78 }, ZONES)
    expect(isMindDragging(next)).toBe(false)
    expect(next.overNodeId).toBeNull()
    expect(mindDrop(next)).toBeNull()
  })

  it('stays abandoned when the finger comes back and stops', () => {
    // Terminal, exactly as dnd.ts is terminal: a wobbly finger must not hand
    // control back and forth mid-pan, lifting a node out from under a scroll
    // already in flight.
    const panned = moveMindDrag(touch(), { x: 460, y: 20 }, { x: 184, y: 78 }, ZONES)
    const settled = moveMindDrag(panned, { x: 400, y: 20 }, { x: 184, y: 78 }, ZONES)
    expect(isMindDragging(settled)).toBe(false)
    expect(holdMindDrag(settled, ZONES).overNodeId).toBeNull()
  })

  it('lifts where the finger already is, and resolves the target from a timer', () => {
    const s = touch()
    const held = holdMindDrag(s, ZONES, 0)
    expect(isMindHeld(held)).toBe(true)
    expect(isMindDragging(held)).toBe(true)
    // The press was at layout (400, 20) — over nothing. The target is resolved
    // from the session's own point, not from a fresh pointer event.
    expect(held.overNodeId).toBeNull()

    const onNode = holdMindDrag(
      startMindDrag({
        pointerId: 1,
        entryId: 'e1',
        nodeId: 'n',
        fromNodeId: null,
        client: { x: 0, y: 0 },
        at: { x: 184, y: 78 },
        requireHold: true,
      }),
      ZONES,
    )
    expect(onNode.overNodeId).toBe('trk-2')
  })

  it('is a no-op, same reference, for a mouse session', () => {
    const s = press()
    expect(holdMindDrag(s, ZONES)).toBe(s)
  })
})

// ── the hit test ───────────────────────────────────────────────────────────

describe('nodeAt', () => {
  it('hits a node at its centre', () => {
    expect(nodeAt(ZONES, { x: 184, y: 22 })).toBe('trk-1')
    expect(nodeAt(ZONES, { x: 184, y: 78 })).toBe('trk-2')
    expect(nodeAt(ZONES, { x: 184, y: 134 })).toBe('trk-3')
  })

  it('treats every edge as INSIDE, on all four sides', () => {
    // A rectangle whose boundary belongs to nobody is a one-unit dead seam
    // around every branch on the map.
    expect(nodeAt(ZONES, { x: 100, y: 0 })).toBe('trk-1')
    expect(nodeAt(ZONES, { x: 268, y: 0 })).toBe('trk-1')
    expect(nodeAt(ZONES, { x: 100, y: 44 })).toBe('trk-1')
    expect(nodeAt(ZONES, { x: 268, y: 44 })).toBe('trk-1')
  })

  it('misses by one unit on every side', () => {
    expect(nodeAt(ZONES, { x: 99, y: 22 })).toBeNull()
    expect(nodeAt(ZONES, { x: 269, y: 22 })).toBeNull()
    expect(nodeAt(ZONES, { x: 184, y: -1 })).toBeNull()
    // y = 45 is the sibling gap, not trk-2 (which starts at 56).
    expect(nodeAt(ZONES, { x: 184, y: 45 })).toBeNull()
  })

  it('DOES NOT fall back to the inline axis — the kanban rule that breaks here', () => {
    // lib/dnd.zoneAt's second pass matches on x alone, which is right for a
    // column and catastrophic for a tree: every node at a depth shares one x
    // range, so a pointer 400 units below the last track would resolve to the
    // FIRST track. Strictly nothing, with no slop.
    expect(nodeAt(ZONES, { x: 184, y: 400 })).toBeNull()
    expect(nodeAt(ZONES, { x: 184, y: -400 })).toBeNull()
  })

  it('is kind within a bounded slop, and only within it', () => {
    // y = 52 is in the 12-unit sibling gap: 4 units above trk-2's top edge (56)
    // and 8 below trk-1's bottom (44), so the near branch is unambiguous.
    expect(nodeAt(ZONES, { x: 184, y: 52 })).toBeNull()
    expect(nodeAt(ZONES, { x: 184, y: 52 }, 8)).toBe('trk-2')
    // The same generosity cannot reach across the map.
    expect(nodeAt(ZONES, { x: 184, y: 400 }, 8)).toBeNull()
  })

  it('picks the NEAREST zone when the slop reaches more than one', () => {
    // y = 49 sits in the 12-unit gap: 5 from trk-1's bottom (44), 7 from trk-2's
    // top (56). A slop wide enough to see both must still choose the near one.
    expect(nodeAt(ZONES, { x: 184, y: 49 }, 20)).toBe('trk-1')
    expect(nodeAt(ZONES, { x: 184, y: 52 }, 20)).toBe('trk-2')
  })

  it('breaks an exact tie on pre-order, so the answer is total', () => {
    // Dead centre of the gap: 6 units from each. Deterministic — the map must
    // not highlight a different branch on two identical frames.
    const first = nodeAt(ZONES, { x: 184, y: 50 }, 20)
    expect(first).toBe('trk-1')
    expect(nodeAt(ZONES, { x: 184, y: 50 }, 20)).toBe(first)
  })

  it('measures slop as a real distance, not per axis', () => {
    // Diagonally off trk-1's bottom-inline-end corner by (6, 6) — 8.49 away,
    // outside an 8-unit slop even though neither axis is.
    expect(nodeAt(ZONES, { x: 274, y: 50 }, 8)).toBeNull()
    expect(nodeAt(ZONES, { x: 274, y: 50 }, 9)).toBe('trk-1')
  })

  it('returns null for a non-finite point rather than matching everything', () => {
    expect(nodeAt(ZONES, { x: Number.NaN, y: 22 })).toBeNull()
    expect(nodeAt(ZONES, { x: 184, y: Number.NaN }, 20)).toBeNull()
    expect(nodeAt(ZONES, { x: Number.POSITIVE_INFINITY, y: 22 }, 20)).toBeNull()
  })

  it('returns null over an empty zone list', () => {
    expect(nodeAt([], { x: 184, y: 22 }, 50)).toBeNull()
  })
})

describe('layoutSlop', () => {
  it('grows the slop as the map shrinks, so aim stays constant on screen', () => {
    expect(layoutSlop(1)).toBe(DROP_SLOP_PX)
    expect(layoutSlop(0.5)).toBe(DROP_SLOP_PX * 2)
  })

  it('is zero for a scale that cannot be drawn, rather than Infinity', () => {
    // An Infinity slop would make the nearest node win from anywhere on the
    // canvas — every drop landing somewhere, none of them where it was aimed.
    expect(layoutSlop(0)).toBe(0)
    expect(layoutSlop(-1)).toBe(0)
    expect(layoutSlop(Number.NaN)).toBe(0)
  })
})

// ── coordinates ────────────────────────────────────────────────────────────

const CANVAS: Rect = { x: 20, y: 40, width: 800, height: 400 }

describe('clientToLayout', () => {
  it('maps the canvas corners onto the viewBox corners', () => {
    const view: Rect = { x: 0, y: 0, width: 400, height: 200 }
    expect(clientToLayout({ x: 20, y: 40 }, CANVAS, view)).toEqual({ x: 0, y: 0 })
    expect(clientToLayout({ x: 820, y: 440 }, CANVAS, view)).toEqual({ x: 400, y: 200 })
    expect(clientToLayout({ x: 420, y: 240 }, CANVAS, view)).toEqual({ x: 200, y: 100 })
  })

  it('honours a panned viewBox origin', () => {
    const view: Rect = { x: 150, y: -50, width: 400, height: 200 }
    expect(clientToLayout({ x: 20, y: 40 }, CANVAS, view)).toEqual({ x: 150, y: -50 })
    expect(clientToLayout({ x: 420, y: 240 }, CANVAS, view)).toEqual({ x: 350, y: 50 })
  })

  it('never returns NaN for an unmeasured canvas', () => {
    // display:none, or a pointer event that beat first paint. A NaN here
    // compares false against every rectangle and would silently make the whole
    // tree un-droppable rather than fail loudly.
    const view: Rect = { x: 7, y: 9, width: 400, height: 200 }
    for (const bad of [
      { x: 0, y: 0, width: 0, height: 400 },
      { x: 0, y: 0, width: 800, height: 0 },
      { x: 0, y: 0, width: -800, height: 400 },
    ]) {
      const p = clientToLayout({ x: 100, y: 100 }, bad, view)
      expect(Number.isFinite(p.x) && Number.isFinite(p.y), JSON.stringify(bad)).toBe(true)
      expect(p).toEqual({ x: 7, y: 9 })
    }
  })

  it('never returns NaN for a non-finite pointer', () => {
    const view: Rect = { x: 7, y: 9, width: 400, height: 200 }
    const p = clientToLayout({ x: Number.NaN, y: 100 }, CANVAS, view)
    expect(p).toEqual({ x: 7, y: 9 })
  })
})

describe('dragPan', () => {
  it('is zero in the middle and negative toward the start of each axis', () => {
    const canvas = { x0: 0, x1: 800, y0: 0, y1: 600 }
    expect(dragPan({ x: 400, y: 300 }, canvas)).toEqual({ x: 0, y: 0 })
    expect(dragPan({ x: 4, y: 300 }, canvas).x).toBeLessThan(0)
    expect(dragPan({ x: 796, y: 300 }, canvas).x).toBeGreaterThan(0)
    expect(dragPan({ x: 400, y: 4 }, canvas).y).toBeLessThan(0)
    expect(dragPan({ x: 400, y: 596 }, canvas).y).toBeGreaterThan(0)
  })

  it('pans BOTH axes at a corner — a map is not a column of columns', () => {
    const pan = dragPan({ x: 4, y: 4 }, { x0: 0, x1: 800, y0: 0, y1: 600 })
    expect(pan.x).toBeLessThan(0)
    expect(pan.y).toBeLessThan(0)
  })
})

// ── the drop ───────────────────────────────────────────────────────────────

describe('mindDrop', () => {
  it('is null for a press that never became a drag', () => {
    expect(mindDrop(press())).toBeNull()
    expect(mindDrop(null)).toBeNull()
  })

  it('is null over open canvas', () => {
    const s = moveMindDrag(press(), { x: 500, y: 300 }, { x: 900, y: 900 }, ZONES)
    expect(isMindDragging(s)).toBe(true)
    expect(mindDrop(s)).toBeNull()
  })

  it('carries the entry, the node and where it came from', () => {
    const drop = mindDrop(draggedOnto(ZONES[1] as MindDropZone))
    expect(drop).toEqual({
      entryId: 'e1',
      nodeId: 'root/track:trk-1/group:new/entry:e1',
      fromNodeId: 'root/track:trk-1/group:new',
      overNodeId: 'trk-2',
    })
  })

  it('RETURNS a release over the branch it started on — unlike dnd.ts', () => {
    // dnd.ts's dropOf() nulls this case out, because for a board "same column"
    // and "nothing happened" are the same statement. Here they are not: whether
    // a drop is a no-op is decided by dropRules.ts against the ROW's own
    // columns, and a second module quietly deciding it first is how the two come
    // to disagree on the path that writes to the database.
    const s = startMindDrag({
      pointerId: 1,
      entryId: 'e1',
      nodeId: 'leaf',
      fromNodeId: 'trk-2',
      client: { x: 400, y: 20 },
      at: { x: 400, y: 20 },
    })
    const dragged = moveMindDrag(s, { x: 500, y: 300 }, { x: 184, y: 78 }, ZONES)
    expect(mindDrop(dragged)).toMatchObject({ fromNodeId: 'trk-2', overNodeId: 'trk-2' })
  })
})

// ── zones from a real layout ───────────────────────────────────────────────

/** root → two tracks → two groups each → one leaf each. */
const TREE: LayoutInputNode = {
  id: 'root',
  children: [
    {
      id: 'root/track:trk-1',
      children: [
        { id: 'root/track:trk-1/group:new', children: [{ id: 'root/track:trk-1/group:new/entry:e1' }] },
        { id: 'root/track:trk-1/group:blocked', children: [{ id: 'root/track:trk-1/group:blocked/entry:e2' }] },
      ],
    },
    {
      id: 'root/track:trk-2',
      children: [
        { id: 'root/track:trk-2/group:new', children: [{ id: 'root/track:trk-2/group:new/entry:e3' }] },
      ],
    },
  ],
}

/** The mindtree's own rule: tracks and groups are buckets, leaves are not. */
function isBucket(node: LayoutInputNode): boolean {
  return node.id !== 'root' && !node.id.includes('/entry:')
}

describe('dropZonesFrom', () => {
  it('takes only what the caller accepts, in pre-order', () => {
    const zones = dropZonesFrom(layoutMindtree(TREE), isBucket)
    expect(zones.map((z) => z.nodeId)).toEqual([
      'root/track:trk-1',
      'root/track:trk-1/group:new',
      'root/track:trk-1/group:blocked',
      'root/track:trk-2',
      'root/track:trk-2/group:new',
    ])
  })

  it('carries the laid-out rectangle unchanged', () => {
    const layout = layoutMindtree(TREE)
    for (const zone of dropZonesFrom(layout, isBucket)) {
      const node = layout.byId.get(zone.nodeId)
      expect(node, zone.nodeId).toBeDefined()
      expect({ x: zone.x, y: zone.y, width: zone.width, height: zone.height }).toEqual({
        x: node?.x,
        y: node?.y,
        width: node?.width,
        height: node?.height,
      })
    }
  })

  it('makes a leaf un-hittable, so a pointer over one arms nothing', () => {
    const layout = layoutMindtree(TREE)
    const zones = dropZonesFrom(layout, isBucket)
    const leafNode = layout.byId.get('root/track:trk-1/group:new/entry:e1')
    expect(leafNode).toBeDefined()
    if (!leafNode) return
    const centre = { x: leafNode.x + leafNode.width / 2, y: leafNode.y + leafNode.height / 2 }
    expect(nodeAt(zones, centre)).toBeNull()
  })
})

// ── RTL ────────────────────────────────────────────────────────────────────
//
// The whole point: there is no direction parameter anywhere in drag.ts. layout.ts
// mirrors the geometry (`width - x - w`) and SVG user space is never mirrored by
// `dir`, so the Arabic map is hit tested by the identical code. These assertions
// are what makes that claim checkable rather than a comment.

describe('RTL hit testing', () => {
  const ltr = layoutMindtree(TREE, { direction: 'ltr' })
  const rtl = layoutMindtree(TREE, { direction: 'rtl' })
  const ltrZones = dropZonesFrom(ltr, isBucket)
  const rtlZones = dropZonesFrom(rtl, isBucket)
  const W = ltr.bounds.width

  it('lays the same tree out to the same size', () => {
    expect(rtl.bounds.width).toBe(W)
    expect(rtl.bounds.height).toBe(ltr.bounds.height)
    expect(rtlZones.map((z) => z.nodeId)).toEqual(ltrZones.map((z) => z.nodeId))
  })

  it('hits every node at its MIRRORED x, with no direction flag in the drag', () => {
    for (const zone of ltrZones) {
      const cx = zone.x + zone.width / 2
      const cy = zone.y + zone.height / 2
      expect(nodeAt(ltrZones, { x: cx, y: cy }), zone.nodeId).toBe(zone.nodeId)
      // The mirror of a point about the drawing's centre line.
      expect(nodeAt(rtlZones, { x: W - cx, y: cy }), zone.nodeId).toBe(zone.nodeId)
    }
  })

  it('does NOT hit the un-mirrored x — the mirror is real, not cosmetic', () => {
    // Without this the test above would pass on a layout that ignored direction
    // entirely, since `nodeAt` would then find the node at either x.
    //
    // The filter keeps the zones the mirror actually MOVES off themselves: a
    // node straddling the drawing's centre line maps back inside its own
    // rectangle, and asserting it misses would be asserting the mirror is wrong.
    // Stated as containment rather than a distance, so it stays true whatever
    // the column widths become.
    const offCentre = ltrZones.filter((z) => {
      const back = W - (z.x + z.width / 2)
      return back < z.x || back > z.x + z.width
    })
    expect(offCentre.length).toBeGreaterThan(2)
    for (const zone of offCentre) {
      const cx = zone.x + zone.width / 2
      const cy = zone.y + zone.height / 2
      expect(nodeAt(rtlZones, { x: cx, y: cy }), zone.nodeId).not.toBe(zone.nodeId)
    }
  })

  it('drags to the same node from a mirrored CLIENT point, end to end', () => {
    // Through clientToLayout, which is the path a real pointer takes: an <svg>
    // 800 wide showing the whole drawing, a finger at the same visual place on
    // an Arabic screen as on an English one.
    const canvas: Rect = { x: 0, y: 0, width: 800, height: 400 }
    const view: Rect = { x: 0, y: 0, width: W, height: ltr.bounds.height }
    const target = ltrZones.find((z) => z.nodeId === 'root/track:trk-2/group:new')
    expect(target).toBeDefined()
    if (!target) return

    const cx = target.x + target.width / 2
    const cy = target.y + target.height / 2
    const toClientX = (x: number): number => (x * canvas.width) / view.width
    const toClientY = (y: number): number => (y * canvas.height) / view.height

    const ltrDrop = mindDrop(
      moveMindDrag(
        press(),
        { x: 500, y: 300 },
        clientToLayout({ x: toClientX(cx), y: toClientY(cy) }, canvas, view),
        ltrZones,
      ),
    )
    const rtlDrop = mindDrop(
      moveMindDrag(
        press(),
        { x: 500, y: 300 },
        clientToLayout({ x: toClientX(W - cx), y: toClientY(cy) }, canvas, view),
        rtlZones,
      ),
    )
    expect(ltrDrop?.overNodeId).toBe('root/track:trk-2/group:new')
    expect(rtlDrop?.overNodeId).toBe('root/track:trk-2/group:new')
  })
})
