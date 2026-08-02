// The Mindtree's drag GESTURE and hit test — coordinates in, node ids out.
//
// No React, no DOM, no store, no model semantics. This module knows rectangles
// and a pointer; `dropRules.ts` knows what a drop MEANS; the page composes them.
// The split is the same one layout.ts states for not importing model.ts: nothing
// about where a rectangle is depends on whether it is a status or a person, and
// a hit test that needed a `MindNode` could not be tested without building one.
//
// ── WHAT IS REUSED FROM lib/dnd.ts, AND WHY THE REST IS NOT ────────────────
//
// The gesture STATE MACHINE is dnd.ts's, imported outright: `startDrag`,
// `moveDrag`, `holdDrag` and the three constants that tune them
// (DRAG_THRESHOLD_PX, HOLD_MS, HOLD_SLOP_PX). Re-deriving a tap/drag threshold
// or a hold window here would mean the board and the map disagreed about when a
// finger has committed — the same card, two different gestures, on one phone.
// `edgeScrollRange` is reused too, for the auto-pan below.
//
// What is NOT reused is `zoneAt`, and the reason is specific rather than
// stylistic. `zoneAt`'s second pass matches on the INLINE AXIS ALONE, which is
// exactly right for a kanban — a card dragged above a column's header is still
// unmistakably aimed at that column, because a column is a tall thin strip that
// owns its whole x range. In a tidy tree, EVERY node at a given depth shares one
// x range, so that pass would resolve "somewhere in the track column" to
// whichever track happens to be first in pre-order, no matter how far away it
// is. Forgiveness that helpful in one layout is a lottery in the other. So the
// hit test here is strict containment with a BOUNDED slop (see `nodeAt`), which
// is the same intent — be kind near an edge — expressed in a way that cannot
// snap a drop onto a branch the reader never went near.
//
// ── TWO COORDINATE SPACES, ON PURPOSE ──────────────────────────────────────
//
// The gesture is in PHYSICAL VIEWPORT PIXELS, because the thresholds are
// physical: six pixels of finger travel is six pixels whether the map is fitted
// at 1.0 or at 0.31, and measuring the threshold in drawing units would arm a
// drag after 6 units — twenty screen pixels at that fit — on the very view where
// a shaky hand needs MORE tolerance, not less.
//
// The hit test is in LAYOUT UNITS, because that is the space `layoutMindtree`
// returns and the space the <svg> viewBox draws. `clientToLayout` is the one
// bridge, and it is the same arithmetic pages/Mindtree.tsx already uses to turn
// a pan delta into drawing units, written once here instead of twice there.
//
// SO A SESSION CARRIES BOTH, and neither is derived from the other during a
// move: the caller has `clientX/clientY` and a `getBoundingClientRect()` in
// hand at every pointermove, so converting once and passing both is cheaper and
// more honest than storing a scale that could go stale mid-pinch.
//
// ── RTL NEEDS NOTHING HERE ─────────────────────────────────────────────────
//
// layout.ts mirrors the geometry itself (`width - x - w`) and returns `x` as the
// physical inline-start corner in BOTH directions; SVG user space is never
// mirrored by `dir`. So a pointer at client x maps to the same layout x either
// way, and there is no direction parameter in this file — the Arabic map is hit
// tested by the identical code path, which is precisely what drag.test.ts
// asserts by laying the same tree out twice and hitting the mirrored positions.

import { DRAG_THRESHOLD_PX, HOLD_MS, HOLD_SLOP_PX, edgeScrollRange, holdDrag, moveDrag, startDrag } from '../dnd'
import type { DndBox, DndSession, DndZone } from '../dnd'
import type { LayoutInputNode, MindtreeLayout, Point, PositionedNode } from './layout'

// Re-exported rather than redeclared, so a surface tuning the hold (or a test
// asserting on it) reaches the board's numbers and not a copy of them.
export { DRAG_THRESHOLD_PX, HOLD_MS, HOLD_SLOP_PX }

/**
 * The gesture machine is driven with NO zones at all.
 *
 * dnd.ts resolves `overId` inside `moveDrag` using its own kanban hit test; this
 * module resolves it with `nodeAt` instead (see the header). Handing `moveDrag`
 * an empty list is what lets the phase/hold half be reused verbatim while the
 * targeting half is replaced — rather than forking the state machine and
 * inheriting every future divergence between the two.
 */
const NO_ZONES: readonly DndZone[] = Object.freeze([])

/**
 * How far outside a node a pointer may be and still hit it, in SCREEN pixels.
 *
 * SCREEN, not layout units, because that is the axis forgiveness is needed on: a
 * 44-unit node at a 0.31 fit is 13 physical pixels tall, and a slop measured in
 * layout units would shrink with it — least forgiving exactly where a finger has
 * the least to aim at. Callers convert with `layoutSlop(scale)`.
 *
 * Deliberately smaller than HOLD_SLOP_PX: that number is about a resting thumb's
 * tremor, this one is about aim, and a slop wide enough to cover the sibling gap
 * (12 units) would make the node above a target as likely as the target.
 */
export const DROP_SLOP_PX = 8

/** A rectangle in whatever space its user is working in. `DOMRect` is assignable. */
export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** One droppable branch, in LAYOUT units. */
export interface MindDropZone {
  readonly nodeId: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * The move a release would perform.
 *
 * `fromNodeId` is carried so the surface can put the node back exactly where it
 * was when a write fails — the rollback half of the rule that a mis-drop must
 * never lose an entry.
 */
export interface MindDrop {
  readonly entryId: string
  readonly nodeId: string
  readonly fromNodeId: string | null
  readonly overNodeId: string
}

/**
 * A drag in flight.
 *
 * A VALUE, not a controller, exactly as `DndSession` is: every function below
 * returns the next session instead of mutating one, and returns the SAME
 * REFERENCE while nothing the caller renders has changed. The page keeps it in a
 * ref and mirrors only `nodeId` and `overNodeId` into state — a map that
 * re-rendered every branch on all four hundred moves of a drag would drop frames
 * on the screen the drag exists to make fast.
 */
export interface MindDragSession {
  /** dnd.ts's gesture, in physical viewport px. Owns phase, threshold and hold. */
  readonly gesture: DndSession
  /** The entry being moved — the thing a drop actually patches. */
  readonly entryId: string
  /** The leaf node's id, for lifting it visually. */
  readonly nodeId: string
  /** The branch it was sitting under when it lifted. Null if it had no parent. */
  readonly fromNodeId: string | null
  /** The pointer in LAYOUT units — what `nodeAt` reads. */
  readonly at: Point
  /** The droppable branch under the pointer, or null. */
  readonly overNodeId: string | null
}

// ── zones ──────────────────────────────────────────────────────────────────

/**
 * Every laid-out node the caller accepts, as a zone.
 *
 * `accepts` takes the SOURCE node (not the positioned wrapper) because the
 * decision is semantic — "is this kind a bucket" — and lives in dropRules.ts.
 * Passing it in rather than importing it keeps this module free of the model,
 * and keeps the test fixtures below to bare rectangles.
 *
 * PRE-ORDER IS PRESERVED, which is what makes `nodeAt`'s tiebreak total: the
 * layout's `nodes` array is pre-order, and two zones that somehow tied on
 * distance resolve to the one nearer the root, the same way every other ordering
 * decision in this directory ends in a deterministic tiebreak.
 */
export function dropZonesFrom<N extends LayoutInputNode>(
  layout: MindtreeLayout<N>,
  accepts: (node: N, positioned: PositionedNode<N>) => boolean,
): MindDropZone[] {
  const zones: MindDropZone[] = []
  for (const p of layout.nodes) {
    if (!accepts(p.node, p)) continue
    zones.push({ nodeId: p.id, x: p.x, y: p.y, width: p.width, height: p.height })
  }
  return zones
}

/** `DROP_SLOP_PX` converted into layout units at an on-screen scale. */
export function layoutSlop(scale: number, slopPx: number = DROP_SLOP_PX): number {
  // A zero or non-finite scale means the map is not on screen yet; no slop is
  // the only answer that cannot produce an Infinity and hit every node at once.
  if (!Number.isFinite(scale) || scale <= 0) return 0
  return slopPx / scale
}

/**
 * Which zone a LAYOUT-space point is over.
 *
 * Two passes, and unlike dnd.ts's the second one is BOUNDED (see the header):
 *
 *  1. Strict containment, edges INCLUSIVE. The tidy tree never overlaps two
 *     rectangles, so at most one zone can win — but a point landing exactly on a
 *     shared edge must still land somewhere, and inclusive bounds plus pre-order
 *     make which one deterministic.
 *  2. Otherwise the nearest zone within `slop`, by rectangle distance. A pointer
 *     in the sibling gap or just past a node's inline edge lands on the node it
 *     is plainly aimed at; a pointer in open canvas lands on nothing.
 *
 * `slop` is in LAYOUT units — `layoutSlop(scale)`. Zero (the default) is strict.
 */
export function nodeAt(zones: readonly MindDropZone[], p: Point, slop = 0): string | null {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null

  for (const z of zones) {
    if (p.x >= z.x && p.x <= z.x + z.width && p.y >= z.y && p.y <= z.y + z.height) return z.nodeId
  }

  if (!(slop > 0)) return null

  let bestId: string | null = null
  let bestDistance = slop
  for (const z of zones) {
    const d = rectDistance(z, p)
    // Strictly less than, so the first zone in pre-order keeps a tie.
    if (d < bestDistance) {
      bestDistance = d
      bestId = z.nodeId
    }
  }
  return bestId
}

/** Euclidean distance from a point to a rectangle; 0 inside it. */
function rectDistance(z: MindDropZone, p: Point): number {
  const dx = z.x - p.x > 0 ? z.x - p.x : p.x - (z.x + z.width) > 0 ? p.x - (z.x + z.width) : 0
  const dy = z.y - p.y > 0 ? z.y - p.y : p.y - (z.y + z.height) > 0 ? p.y - (z.y + z.height) : 0
  return Math.hypot(dx, dy)
}

// ── coordinates ────────────────────────────────────────────────────────────

/**
 * A viewport point → layout units, through the <svg>'s box and its viewBox.
 *
 * The same arithmetic pages/Mindtree.tsx's pan uses, and for the same stated
 * reason: the drawing's x axis is NOT mirrored by `dir` — layout.ts mirrored the
 * geometry instead — so this is identical in both reading directions.
 *
 * TOTAL over every input. A canvas measured at zero (the map is display:none, or
 * this ran before first paint) would divide by zero and hand `nodeAt` a NaN,
 * which compares false against everything and would silently make the whole tree
 * un-droppable rather than fail. Returning the view's origin is a point inside
 * the drawing, so the caller gets "no useful target" instead of a poisoned one —
 * the same totality rule layout.ts's `sanitizeSize` is written to.
 */
export function clientToLayout(client: Point, canvas: Rect, view: Rect): Point {
  if (
    !Number.isFinite(client.x) ||
    !Number.isFinite(client.y) ||
    !(canvas.width > 0) ||
    !(canvas.height > 0)
  ) {
    return { x: view.x, y: view.y }
  }
  return {
    x: view.x + ((client.x - canvas.x) * view.width) / canvas.width,
    y: view.y + ((client.y - canvas.y) * view.height) / canvas.height,
  }
}

/**
 * Auto-pan speed while a drag sits near the canvas edges, in SCREEN px per frame.
 *
 * `edgeScrollRange` outright, on both axes — a mind map pans in two dimensions
 * where a board pans in one, and that is the only difference. The caller turns
 * these into drawing units with the `viewWidth / box.width` ratio it already
 * computes for the pan gesture, so the conversion lives in exactly one place.
 */
export function dragPan(client: Point, canvas: DndBox): { x: number; y: number } {
  return {
    x: edgeScrollRange(client.x, canvas.x0, canvas.x1),
    y: edgeScrollRange(client.y, canvas.y0, canvas.y1),
  }
}

// ── the session ────────────────────────────────────────────────────────────

export function startMindDrag(init: {
  pointerId: number
  /** The entry the leaf stands for. */
  entryId: string
  /** The leaf's node id. */
  nodeId: string
  /** The leaf's parent branch, from `PositionedNode.parentId`. */
  fromNodeId: string | null
  /** Viewport pixels. */
  client: Point
  /** The same press, in layout units. */
  at: Point
  /** Touch and pen — a mouse press is already unambiguous. See dnd.ts. */
  requireHold?: boolean
}): MindDragSession {
  return {
    gesture: startDrag({
      pointerId: init.pointerId,
      itemId: init.entryId,
      // dnd.ts's `fromId` is a column; here the branch id plays that part. It is
      // never read for the drop decision (dropRules compares the ROW's columns,
      // not the tree's shape — see its header), only carried for the rollback.
      fromId: init.fromNodeId ?? '',
      x: init.client.x,
      y: init.client.y,
      requireHold: init.requireHold,
    }),
    entryId: init.entryId,
    nodeId: init.nodeId,
    fromNodeId: init.fromNodeId,
    at: init.at,
    overNodeId: null,
  }
}

/**
 * Advance to a new pointer position.
 *
 * Returns the SAME session while dnd.ts's machine says nothing has changed —
 * under the threshold on a mouse, or inside HOLD_SLOP_PX while a finger waits
 * out the hold. That is what lets the caller do `if (next !== prev)` and skip a
 * render for the dozens of sub-threshold moves a resting hand produces.
 */
export function moveMindDrag(
  s: MindDragSession,
  client: Point,
  at: Point,
  zones: readonly MindDropZone[],
  slop = 0,
): MindDragSession {
  const gesture = moveDrag(s.gesture, client.x, client.y, NO_ZONES)
  if (gesture === s.gesture) return s

  // The gesture turned out to be a pan. Terminal in dnd.ts, and the target has
  // to go with it or the map would keep a branch highlighted under a finger that
  // is now scrolling.
  if (gesture.phase !== 'dragging') {
    return { ...s, gesture, at, overNodeId: null }
  }

  return { ...s, gesture, at, overNodeId: nodeAt(zones, at, slop) }
}

/**
 * The hold landed: lift the leaf where the finger already is.
 *
 * Driven from a timer, so it resolves the target itself — the pointer has not
 * moved since the press, and a first drag frame showing no target under a node
 * the finger is plainly sitting on reads as the lift having failed.
 *
 * A no-op (same reference) for any session that was not waiting, which is what
 * lets the caller fire the timer without first re-testing what it fired for.
 */
export function holdMindDrag(
  s: MindDragSession,
  zones: readonly MindDropZone[],
  slop = 0,
): MindDragSession {
  const gesture = holdDrag(s.gesture, NO_ZONES)
  if (gesture === s.gesture) return s
  return { ...s, gesture, overNodeId: nodeAt(zones, s.at, slop) }
}

/**
 * The move a release would perform, or null.
 *
 * DELIBERATELY UNLIKE dnd.ts's `dropOf`, which returns null when a card is
 * released over the column it started in. Here that case is returned, because
 * "released where it already was" is a verdict dropRules.ts owns
 * (`{kind:'noop'}`) and having two modules decide it is how they come to
 * disagree — one of them silently, on the path that writes to the database.
 * Null here means only "no drag, or no branch under the pointer".
 */
export function mindDrop(s: MindDragSession | null): MindDrop | null {
  if (s === null || s.gesture.phase !== 'dragging' || s.overNodeId === null) return null
  return {
    entryId: s.entryId,
    nodeId: s.nodeId,
    fromNodeId: s.fromNodeId,
    overNodeId: s.overNodeId,
  }
}

/** Committed — the leaf is lifted and a release will land somewhere. */
export function isMindDragging(s: MindDragSession | null): boolean {
  return s !== null && s.gesture.phase === 'dragging'
}

/** A touch press, waiting out its hold or past it. Suppress caret and menu. */
export function isMindHoldGesture(s: MindDragSession | null): boolean {
  return s !== null && s.gesture.hold !== 'off'
}

/** The hold landed. Only now may the caller cancel the browser's own panning. */
export function isMindHeld(s: MindDragSession | null): boolean {
  return s !== null && s.gesture.hold === 'held'
}
