// WHICH DRAWING, at this distance — and nothing else.
//
// This module is the selector for the five authored renderings. It is pure: no
// React, no DOM, no store, no `t()`. Everything it needs arrives as an argument
// and the same arguments always produce the same answer, which is what lets the
// whole level-of-detail contract be asserted without mounting anything.
//
// ── THE IDEA, AND IT IS THE WHOLE BRIEF ────────────────────────────────────
//
// A node is NOT one component that scales. It is a component that renders
// DIFFERENTLY at each distance, showing what is legible and useful there and
// nothing else. Scale the reference video's first frame 20x and you get a blurry
// blue blob; instead every level was authored at its own scale, and what is a
// texture at one distance is a drawn skyline at the next.
//
// So the selector is APPARENT DIAMETER IN CSS PIXELS — `a = worldD x scale` —
// and nothing else. Not depth, not the camera's "level", not a tier counter.
// Depth cannot be the selector: the whole point of a containment drawing is that
// four or five renderings coexist on screen at every instant (the framed world's
// children are cards, THEIR children are chips, the next tier is grain), and a
// per-frame tier index can only name one of them. Apparent size names all of
// them at once, per node, for free. That is what fifteen nested worlds actually
// looks like.
//
// ── WHY THE EDGES ARE ABSOLUTE PIXELS, EXCEPT THE LAST ONE ─────────────────
//
// LEGIBILITY IS ABSOLUTE. A 14-glyph label at `MindNode`'s measured
// `CHAR_PX = 6.2` is 87px of ink whether it is drawn on a 375px phone or a 1600px
// desktop, and a numeral inside a 30px disc renders at 3px on both. So `grain`,
// `state`, `chip`, `card` and `opening` are plain CSS pixels and are IDENTICAL on
// every screen — which is also what makes the phone the same map through a
// smaller window rather than a reduced one.
//
// "IS THIS THING THE FRAME" IS NOT ABSOLUTE. It is a question about the window,
// so `frame` alone is a fraction of the viewport's smaller dimension.
//
// ── MONOTONICITY IS A REQUIREMENT, NOT A HAPPY ACCIDENT ────────────────────
//
// `bandFor` must never move DOWN a band as `apparentPx` grows, or a continuous
// pinch would make a node flicker between two drawings. The only way the fixed
// edges and the viewport-relative one can disagree is a viewport small enough
// that `0.85V < 380`, so `frameStartOf` floors the frame edge at the opening
// edge. Below a 447px stage the `opening` band is simply empty — a card becomes
// the frame directly — which is correct and is not a special case anywhere else.

/** The five authored drawings, plus the two states that are not drawings. */
export type Band = 'absent' | 'grain' | 'state' | 'chip' | 'card' | 'opening' | 'frame'

/**
 * Absolute CSS px, except `frame`, a fraction of the viewport's smaller
 * dimension — legibility is absolute; "is this the frame" is not.
 *
 * Each number is derived, not chosen:
 *
 *  ·   7 — below this a mark is smaller than the 1px outline that would bound
 *          it, so it is not a texture, it is noise.
 *  ·  26 — a disc large enough to carry a second mark (the rim, the breach dot)
 *          without the two touching.
 *  ·  52 — where a 14-glyph outside label (87px at `CHAR_PX = 6.2`) has daylight
 *          on both sides of the tightest ring the packing produces.
 *  · 140 — where `168 - PAD*2 - COUNT_SLOT` px of inside room holds a word
 *          rather than a word with an elision in it (`LABEL_INSIDE_MIN = 96`).
 *  · 380 — where a world is wide enough that its children are themselves at
 *          least `grain`, so there is something inside to dissolve INTO.
 *  · 0.85 — the world fills the stage bar a margin; past it, it IS the stage.
 */
export const BAND_EDGES: Readonly<{
  grain: 7
  state: 26
  chip: 52
  card: 140
  opening: 380
  frame: 0.85
}> = Object.freeze({ grain: 7, state: 26, chip: 52, card: 140, opening: 380, frame: 0.85 })

/**
 * How much of a band's width the cross-fade occupies at its top edge.
 *
 * A FRACTION OF THE BAND, capped by `FADE_OCTAVES` below — because the bands are
 * geometric (7 -> 26 is 1.9 octaves, 140 -> 380 is 1.44) and a fixed pixel blend
 * would be a flicker at the bottom of the ladder and a two-second smear at the
 * top.
 */
export const BAND_BLEND = 0.18

/**
 * The DOM horizon — one band deeper than the eye's, so keyboard reach never
 * waits on a repaint.
 *
 * A node between this and `BAND_EDGES.grain` is IN the DOM (so the `role="tree"`
 * walk is complete and `aria-posinset`/`aria-setsize` are never renumbered by a
 * cull) and is drawn `visibility: hidden`. Below it the page culls entirely.
 */
export const DOM_HORIZON_PX = 4

/**
 * The longest any cross-fade may run, in octaves of apparent size.
 *
 * OPACITY IS NEVER A RESTING STATE. `mindtree.css` measured the cost: edge ink at
 * `opacity: .55` falls 6.06/5.53 to 3.76/3.20, spending the entire light-theme
 * headroom on decoration. A mark IN MOTION is not a resting UI component under
 * WCAG 1.4.11; a permanently half-faded one is. So every fade this module
 * describes resolves — to fully opaque or fully absent — within 0.3 octaves of
 * apparent size, which at the reference's ~2.6 octaves/second is about 115ms.
 */
const FADE_OCTAVES = 0.3

/**
 * Where the FRAME fade begins, as a multiple of the viewport.
 *
 * The stage border does not start dissolving the instant the world becomes the
 * frame — it holds while the reader is still arriving, and only leaves once the
 * rim is comfortably outside the window. 1.6x is that point.
 */
const FRAME_FADE_AT = 1.6

/** NaN, -Infinity and undefined-shaped arithmetic all collapse to 0. Total. */
function px(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * The apparent diameter of a world, in CSS pixels.
 *
 * ONE MULTIPLICATION, and it is exported so that every consumer — the page's
 * band memo, the cull, the tests — asks the identical question. A second copy of
 * `worldD * scale` somewhere else is how a cull and a renderer end up
 * disagreeing about which nodes exist.
 */
export function apparentOf(worldD: number, scale: number): number {
  return px(px(worldD) * px(scale))
}

/**
 * The frame edge in CSS pixels, floored at the opening edge so `bandFor` is
 * monotone on every viewport. See the header.
 */
function frameStartOf(viewportMinPx: number): number {
  return Math.max(BAND_EDGES.opening, BAND_EDGES.frame * px(viewportMinPx))
}

/**
 * The drawing to use at this apparent size. Total and monotone in `apparentPx`.
 */
export function bandFor(apparentPx: number, viewportMinPx: number): Band {
  const a = px(apparentPx)
  if (a < BAND_EDGES.grain) return 'absent'
  if (a < BAND_EDGES.state) return 'grain'
  if (a < BAND_EDGES.chip) return 'state'
  if (a < BAND_EDGES.card) return 'chip'
  if (a < BAND_EDGES.opening) return 'card'
  return a < frameStartOf(viewportMinPx) ? 'opening' : 'frame'
}

/**
 * Progress through a fade window, in OCTAVES rather than pixels, clamped to
 * [0,1]. Log space is what makes a fade look the same at every depth: the camera
 * moves at a uniform rate in octaves, so a window measured in pixels would take
 * six times longer to cross at the bottom of the ladder than at the top.
 */
function fadeOut(a: number, from: number, to: number): number {
  if (!(to > from) || !Number.isFinite(to)) return a >= to ? 1 : 0
  const p = Math.log2(a / from) / Math.log2(to / from)
  if (!Number.isFinite(p) || p <= 0) return 0
  return p >= 1 ? 1 : p
}

/** Where a band's top-edge fade starts, given the band's two edges. */
function blendFrom(lo: number, hi: number): number {
  const span = Math.log2(hi / lo)
  const width = Math.min(BAND_BLEND * span, FADE_OCTAVES)
  return hi / 2 ** width
}

/**
 * The band plus its fade progress, 0 -> 1. `out === 0` means fully in this band;
 * `out === 1` means the fade is over.
 *
 * THE FADE WINDOW IS THE TOP OF THE BAND FOR EVERY BAND BUT TWO, and both
 * exceptions are the contract's, not a convenience:
 *
 *  · `opening` fades at its BOTTOM. The opening band IS the dissolve — the card
 *    crossing out as its children's grain crosses in, ONE dissolve rather than
 *    two fades — and §4 puts the crossing at ~450px. `380 x 2^0.3 = 468`, so the
 *    dissolve is over by the time the world is half a screen wide and the rest
 *    of the band is a settled picture. A fade spread over the whole band would
 *    be 2.2 octaves on a desktop: a permanently half-faded mark, which is
 *    exactly what 1.4.11 forbids.
 *  · `frame` fades above `1.6 x V`, because the mark it drives is the stage's own
 *    2px border and that border must not start leaving while the reader is still
 *    arriving in the world it belongs to.
 */
export function bandBlend(
  apparentPx: number,
  viewportMinPx: number,
): { readonly band: Band; readonly out: number } {
  const a = px(apparentPx)
  const band = bandFor(a, viewportMinPx)
  switch (band) {
    case 'absent':
      return { band, out: fadeOut(a, blendFrom(DOM_HORIZON_PX, BAND_EDGES.grain), BAND_EDGES.grain) }
    case 'grain':
      return { band, out: fadeOut(a, blendFrom(BAND_EDGES.grain, BAND_EDGES.state), BAND_EDGES.state) }
    case 'state':
      return { band, out: fadeOut(a, blendFrom(BAND_EDGES.state, BAND_EDGES.chip), BAND_EDGES.chip) }
    case 'chip':
      return { band, out: fadeOut(a, blendFrom(BAND_EDGES.chip, BAND_EDGES.card), BAND_EDGES.card) }
    case 'card':
      return { band, out: fadeOut(a, blendFrom(BAND_EDGES.card, BAND_EDGES.opening), BAND_EDGES.opening) }
    case 'opening': {
      // Bottom-anchored, and capped by the band's own top so a stage too small
      // to hold an opening band never reports a fade it has no room to run.
      const top = Math.min(frameStartOf(viewportMinPx), BAND_EDGES.opening * 2 ** FADE_OCTAVES)
      return { band, out: fadeOut(a, BAND_EDGES.opening, top) }
    }
    case 'frame': {
      const from = Math.max(frameStartOf(viewportMinPx), FRAME_FADE_AT * px(viewportMinPx))
      return { band, out: fadeOut(a, from, from * 2 ** FADE_OCTAVES) }
    }
  }
}
