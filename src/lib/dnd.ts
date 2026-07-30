// The board's drag gesture, as pure arithmetic.
//
// WHY THIS IS IN lib/ WHEN useSwipeActions IS NOT. Nothing here is a hook and
// nothing here touches the DOM. The screen measures its own columns, hands this
// module numbers, and gets numbers back — so the parts of a drag that are
// genuinely fiddly (the tap/drag threshold, the axis lock, which column a point
// is over, edge auto-scroll, the keyboard equivalent) are testable with zero
// mocking and zero jsdom. `useSwipeActions` holds state and returns event
// handlers, which is why it lives in the entry kit instead.
//
// NO DND LIBRARY, and no HTML5 drag events either. The native drag API cannot
// be styled, does not fire on touch at all, and insists on a text/plain payload
// nobody wanted; every library that repairs it is a runtime dependency the plan
// forbids. Pointer events cover mouse, touch and pen in one path, and the whole
// gesture is the handful of pure functions below.
//
// THE SESSION IS A VALUE, NOT A CONTROLLER. moveDrag() returns the next session
// rather than mutating one, and returns the SAME REFERENCE while a gesture is
// still under the threshold. The board keeps it in a ref and mirrors only the
// two fields it renders (`itemId`, `overId`) into React state, so a drag across
// 400 pixels re-renders on the two or three moves that change a column, not on
// all 400.
//
// A TOUCH DRAG IS A HOLD, NOT A SWIPE, and that is the correction that made
// this board usable on a phone at all. The first cut claimed any mostly-inline
// finger movement on a card as a drag and left the browser only the vertical
// axis (`touch-action: pan-y`). On a 375px screen a column IS the screen and a
// card IS the column, so the only surface left that could pan the board
// sideways was the 8px gutter between two cards: the second column was, in
// practice, unreachable with a thumb. The rule now is the one every mobile
// kanban converged on — the browser owns every pan until a finger has RESTED
// on a card for HOLD_MS without drifting HOLD_SLOP_PX, and only then does the
// card belong to the gesture. Nothing is claimed speculatively, so nothing has
// to be given back.
//
// WHICH IS WHY THE AXIS LOCK IS GONE. It was the mitigation for claiming a
// touch gesture too early: guess from the first few pixels whether the finger
// meant "scroll" or "drag". A hold does not guess — by the time the card lifts,
// the intent is not in doubt and a drag may travel in any direction (a phone
// board drags toward the edge and waits for the auto-scroll). The caller passes
// `requireHold` for touch and pen and nothing for a mouse, where a held button
// is already unambiguous.
//
// COORDINATES ARE PHYSICAL AND VIEWPORT-RELATIVE, because that is exactly what
// `PointerEvent.clientX` and `getBoundingClientRect()` hand you, and converting
// them into logical space would mean re-deriving a direction the browser has
// already applied. Direction matters in precisely ONE place — a person pressing
// ArrowRight in Arabic means "the column after this one" — and arrowStep() takes
// `dir` as a parameter rather than reading `document.dir`, which is the same
// trick that keeps this file pure.
//
// Box fields are named x0/x1/y0/y1 rather than left/right/top/bottom so that the
// standing grep for physical CSS properties stays quiet over the source tree,
// and so nobody reads them as layout instructions.

/** Travel, in px, that turns a press into a drag rather than a tap. */
export const DRAG_THRESHOLD_PX = 6

/**
 * How long a finger must rest on a card before the card is its to move, in ms.
 *
 * 420ms is the window every touch platform already trained people on: iOS's own
 * drag-and-drop lift and Android's long-press both sit between 400 and 500ms.
 * Shorter and a slow tap steals the card; longer and the gesture feels broken
 * before it starts. It is also comfortably under Android's ~500ms context-menu
 * timer, so the lift wins that race rather than fighting a menu.
 */
export const HOLD_MS = 420

/**
 * How far a finger may drift during the hold before the gesture is a pan, in px.
 *
 * Deliberately larger than DRAG_THRESHOLD_PX: a thumb resting on glass is not
 * still, and a 6px budget would make the hold unreachable for anyone whose
 * hands shake. A real pan clears 10px within a frame or two of starting.
 */
export const HOLD_SLOP_PX = 10

/** How close to a scroller's inline edge auto-scroll starts, in px. */
export const EDGE_SCROLL_ZONE_PX = 64

/** Fastest auto-scroll step, in px per animation frame. */
export const EDGE_SCROLL_MAX_PX = 22

/** Digit shortcuts are 1–9: past that a keyboard "move to column N" is fiction. */
export const MAX_DIGIT_COLUMNS = 9

/** A measured rectangle in viewport pixels. Structurally a DOMRect subset. */
export interface DndBox {
  x0: number
  x1: number
  y0: number
  y1: number
}

/**
 * One measured drop target.
 *
 * `accepts` is carried on the zone rather than checked by the caller afterwards
 * so that a rejected column is invisible to the hit test — the pointer glides
 * over a retired status onto the next real column instead of arming a drop that
 * would be refused on release. Feedback the user cannot act on is worse than no
 * feedback.
 */
export interface DndZone {
  id: string
  box: DndBox
  accepts: boolean
}

/**
 * `armed` — pressed, not yet a drag: under the threshold (mouse) or still
 * waiting out the hold (touch).
 * `dragging` — committed; the card is lifted and a drop will land.
 * `abandoned` — the gesture turned out to be a scroll. Terminal: it is never
 * re-tested, because a wobbly finger must not hand control back and forth
 * mid-swipe (the same rule useSwipeActions' axis lock follows).
 */
export type DndPhase = 'armed' | 'dragging' | 'abandoned'

/**
 * `off` — a mouse. Distance alone decides, and the browser is not panning
 * anything with a button held down.
 * `waiting` — a finger is down and the clock is running. The BROWSER still owns
 * this gesture: any real travel is a pan and the session abandons itself.
 * `held` — the hold landed, the card is lifted, and the caller may now cancel
 * the browser's own scrolling for the rest of the gesture.
 */
export type DndHold = 'off' | 'waiting' | 'held'

export interface DndSession {
  readonly pointerId: number
  /** The entry being dragged. */
  readonly itemId: string
  /** The column it started in — a drop back onto it is not a move. */
  readonly fromId: string
  readonly startX: number
  readonly startY: number
  readonly x: number
  readonly y: number
  readonly phase: DndPhase
  /** The accepting column under the pointer, or null. */
  readonly overId: string | null
  /** Where this gesture sits in the long-press handshake. See DndHold. */
  readonly hold: DndHold
}

export interface DndDrop {
  itemId: string
  fromId: string
  toId: string
}

export function startDrag(init: {
  pointerId: number
  itemId: string
  fromId: string
  x: number
  y: number
  /** Touch and pen. A mouse press is already unambiguous — see the header. */
  requireHold?: boolean
}): DndSession {
  return {
    pointerId: init.pointerId,
    itemId: init.itemId,
    fromId: init.fromId,
    startX: init.x,
    startY: init.y,
    x: init.x,
    y: init.y,
    phase: 'armed',
    overId: null,
    hold: init.requireHold === true ? 'waiting' : 'off',
  }
}

/**
 * Advance a session to a new pointer position.
 *
 * Returns the SAME session object while the press is still within the threshold
 * — that is what lets the caller do `if (next !== prev)` and skip a render for
 * the dozens of sub-threshold moves a resting finger produces.
 */
export function moveDrag(
  s: DndSession,
  x: number,
  y: number,
  zones: readonly DndZone[],
  threshold: number = DRAG_THRESHOLD_PX,
): DndSession {
  if (s.phase === 'abandoned') return s

  // A finger that moves before the hold lands was panning all along, and the
  // browser has been panning with it — nothing was ever claimed, so there is
  // nothing to give back. Terminal, like every other abandon: a finger that
  // wanders and then stops must not lift the card out from under a scroll
  // already in flight.
  if (s.hold === 'waiting') {
    if (Math.abs(x - s.startX) < HOLD_SLOP_PX && Math.abs(y - s.startY) < HOLD_SLOP_PX) return s
    return { ...s, x, y, phase: 'abandoned', overId: null }
  }

  if (s.phase === 'armed') {
    const dx = x - s.startX
    const dy = y - s.startY
    if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return s
    return { ...s, x, y, phase: 'dragging', overId: zoneAt(zones, x, y) }
  }

  return { ...s, x, y, overId: zoneAt(zones, x, y) }
}

/**
 * The hold landed: lift the card where the finger already is.
 *
 * Called from a timer, so it takes the zones rather than reading them — the
 * pointer has not moved since the press and `overId` still has to be resolved,
 * or the first frame of the drag would show no target under a card that is
 * plainly sitting in one.
 *
 * A no-op (same reference) for every other session, which is what lets the
 * caller fire the timer without first re-testing what it fired for.
 */
export function holdDrag(s: DndSession, zones: readonly DndZone[]): DndSession {
  if (s.hold !== 'waiting' || s.phase !== 'armed') return s
  return { ...s, hold: 'held', phase: 'dragging', overId: zoneAt(zones, s.x, s.y) }
}

/**
 * Is this gesture a touch press — waiting out its hold, or past it?
 *
 * The caller uses it for the two suppressions a long press needs on a phone:
 * no text-selection caret and no context menu on a card somebody is picking up.
 */
export function isHoldGesture(s: DndSession | null): boolean {
  return s !== null && s.hold !== 'off'
}

/** Has the hold landed? Only then may the caller cancel the browser's pan. */
export function isHeld(s: DndSession | null): boolean {
  return s !== null && s.hold === 'held'
}

/**
 * Which accepting zone a point is over.
 *
 * TWO PASSES, and the second one is the whole reason this is a function rather
 * than an `.find()` at the call site. A kanban column is a tall thin strip, and
 * a card dragged above the column header or below its last card is still
 * unmistakably aimed at that column; strict containment would drop it nowhere
 * and read as the board refusing the move. So containment wins if it can, and
 * the inline axis alone decides otherwise.
 */
export function zoneAt(zones: readonly DndZone[], x: number, y: number): string | null {
  for (const z of zones) {
    if (!z.accepts) continue
    if (x >= z.box.x0 && x <= z.box.x1 && y >= z.box.y0 && y <= z.box.y1) return z.id
  }
  for (const z of zones) {
    if (!z.accepts) continue
    if (x >= z.box.x0 && x <= z.box.x1) return z.id
  }
  return null
}

/**
 * The move a release would perform, or null.
 *
 * Null covers all three nothing-happened cases — never committed, released over
 * no column, released over the column it started in — because every one of them
 * ends the same way: the card stays put and no request is sent.
 */
export function dropOf(s: DndSession | null): DndDrop | null {
  if (s === null || s.phase !== 'dragging') return null
  if (s.overId === null || s.overId === s.fromId) return null
  return { itemId: s.itemId, fromId: s.fromId, toId: s.overId }
}

export function isDragging(s: DndSession | null): boolean {
  return s !== null && s.phase === 'dragging'
}

/**
 * Auto-scroll speed for a coordinate near the two ends of ONE axis, in px per
 * frame. Negative scrolls toward the start of the scroll range.
 *
 * AXIS-AGNOSTIC, because a kanban has two scrollers under one finger: the
 * board pans sideways between columns and the hovered column pans down through
 * its own cards. Both are the same arithmetic over a different pair of numbers,
 * and writing it twice is how the two drift.
 *
 * A pointer dragged clean off the end saturates rather than accelerating
 * without limit — `max` is a speed cap, not a slope.
 */
export function edgeScrollRange(
  pos: number,
  start: number,
  end: number,
  zone: number = EDGE_SCROLL_ZONE_PX,
  max: number = EDGE_SCROLL_MAX_PX,
): number {
  if (zone <= 0) return 0
  // A scroller shorter than two dead zones would have every point in both of
  // them, and the first branch would win permanently — a column 80px tall that
  // scrolls itself upward forever the moment a card passes over it.
  if (end - start < zone * 2) return 0
  const fromStart = pos - start
  const fromEnd = end - pos
  if (fromStart < zone) return -Math.round(max * ramp((zone - fromStart) / zone))
  if (fromEnd < zone) return Math.round(max * ramp((zone - fromEnd) / zone))
  return 0
}

/**
 * Auto-scroll speed for a pointer near a scroller's INLINE edges — the board's
 * own column pan.
 *
 * PHYSICAL, deliberately: the caller writes it into `scrollLeft`, which is
 * itself physical (and negative in RTL on every current engine). Translating to
 * a logical axis here would mean the caller had to translate it straight back.
 */
export function edgeScroll(
  x: number,
  box: DndBox,
  zone: number = EDGE_SCROLL_ZONE_PX,
  max: number = EDGE_SCROLL_MAX_PX,
): number {
  return edgeScrollRange(x, box.x0, box.x1, zone, max)
}

/**
 * Auto-scroll speed for a pointer near a scroller's BLOCK edges — the hovered
 * column's own card list. Written into `scrollTop`.
 */
export function edgeScrollBlock(
  y: number,
  box: DndBox,
  zone: number = EDGE_SCROLL_ZONE_PX,
  max: number = EDGE_SCROLL_MAX_PX,
): number {
  return edgeScrollRange(y, box.y0, box.y1, zone, max)
}

function ramp(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

// ── the keyboard path ──────────────────────────────────────────────────────
//
// Not a fallback. A board that only works for a pointer is a board half the
// audit fails, and these three functions are what make the arrow keys and the
// digit shortcuts land on exactly the same store call a drop does.

/**
 * How far ArrowLeft/ArrowRight moves along the column list, in the reading
 * direction. Any other key is 0.
 *
 * `dir` is a parameter, not a `document.documentElement.dir` read, so this stays
 * pure — and so a test can assert the Arabic behaviour without a DOM.
 */
export function arrowStep(key: string, dir: 'ltr' | 'rtl'): -1 | 0 | 1 {
  if (key === 'ArrowRight') return dir === 'rtl' ? -1 : 1
  if (key === 'ArrowLeft') return dir === 'rtl' ? 1 : -1
  return 0
}

/**
 * Step a column index, CLAMPED — no wrap.
 *
 * store/entrySheet.ts's stepEntry() gives the same reasoning for the same
 * decision: a radio group wraps because it is a closed set of options, while a
 * board is a position someone is reading across, and jumping from the last
 * column back to the first reads as a bug rather than a convenience.
 */
export function moveIndex(from: number, step: number, count: number): number {
  if (count <= 0) return 0
  const next = from + step
  return next < 0 ? 0 : next > count - 1 ? count - 1 : next
}

/** '1'–'9' → a zero-based column index, or null when there is no such column. */
export function indexFromDigit(key: string, count: number): number | null {
  if (key.length !== 1 || key < '1' || key > '9') return null
  const index = key.charCodeAt(0) - '1'.charCodeAt(0)
  if (index >= count || index >= MAX_DIGIT_COLUMNS) return null
  return index
}
