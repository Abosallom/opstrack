// The boundary of a world the reader is arriving in — its edge, its name, and
// where the matches are.
//
// A world is drawn as a card until it is 380 CSS px across. Past that it stops
// being a mark and becomes a PLACE: the card dissolves into its children's grain
// (MindNode's `opening` band) and this component draws what is left of the node
// itself — a circle at the world's own boundary, with the name that used to be
// inside the card now sitting on that boundary's block-start edge. The reference
// film's "+1.2s: the mouth has become a frame around the edge".
//
// THE NAME IS NEVER ABSENT AND NEVER DRAWN TWICE. It leaves the card at exactly
// the instant this component starts drawing it, and it leaves this component at
// exactly the instant the breadcrumb takes it (the 0.85V crossing). Both handoffs
// are pure functions of apparent size, so neither can drift and neither needs a
// piece of state to remember which of the two is currently responsible.
//
// AND THE TEXT NEVER TWEENS ITS OPACITY. `fade` drives the RIM and the match
// arcs — non-text ink, in motion, which WCAG 1.4.11 does not measure — while the
// label and the count are drawn at full strength for as long as they are drawn
// at all. mindtree.css measured the alternative: ink at `opacity: .55` falls
// 6.06/5.53 to 3.76/3.20, which is the entire light-theme headroom spent on a
// transition nobody asked for.
//
// ── THE MATCH RIM IS MANDATORY, AND IT IS THE ANSWER TO THIS DESIGN'S OWN
//    BIGGEST WEAKNESS ────────────────────────────────────────────────────────
//
// An infinite-zoom drawing is a superb way to browse a fixed structure and a poor
// way to answer "show me everything at risk": six at-risk Organizations scattered
// across five departments are six grains in five worlds, four octaves apart, and
// there is no single camera that shows all six legibly. The set question belongs
// to the real-DOM list beside the canvas (MAP-CONTRACT §0, and the reason
// `needs-me` is the default landing) — but a map that cannot even POINT at the
// set has lost it. So a world whose subtree contains matches carries an arc over
// each matching child's wedge and the count at its block-start.
//
// "Three matches in there, that way" is not an answer. It is a signpost, and it
// is the difference between a map that has lost the set and a map that knows
// where it is.
//
// ── THE RIM IS CHROME, AND THAT IS WHY IT IS THE ONE EXCEPTION ─────────────
//
// MindNode draws its card in LEAF units inside `scale(cardScale)`: a card is a
// drawing at its own level, so its text, its outline and its dash arrays all
// grow with the world it belongs to. This component does the OPPOSITE, and the
// difference is argued rather than inherited:
//
//  · The rim is the stage's own furniture, not a mark in the drawing. It is on
//    its way to becoming the BREADCRUMB — the handoff at 0.85V hands this exact
//    label to HTML text at a constant CSS size — and a name that grew for half
//    an octave and then snapped to 13px at the crossing would make the handoff
//    the most visible thing on the canvas instead of the least.
//  · There are at most ~3 rims on screen ever: only `opening` and `frame` nodes
//    have one, and MapCanvas draws none at all for a node with no children. So
//    the camera-dependent prop that would be a disaster on 400 memo()'d nodes
//    (a wheel notch re-rendering all of them) costs three re-renders here.
//  · A world's rim is the ONE mark whose apparent size is pinned by definition:
//    the band it is drawn in is a statement about how big this world looks.
//
// So `unitsPerPx` (= 1/scale) arrives as a prop, goes onto the group as
// `--mring-px`, and mind-ring.css multiplies every authored CSS length by it —
// `calc(13px * var(--mring-px, 1))`, `calc(2 * var(--mring-px, 1))`. The two
// drops below take the same multiplication in JS, because they are `y`
// attributes and there is no stylesheet to do it for them.
//
// ── COLOUR, MEASURED ───────────────────────────────────────────────────────
//
// Every figure is in this file's sheet (mind-ring.css), computed over the full
// sRGB cube in BOTH themes, never eyeballed. The one decision worth stating here:
// THE MATCH COUNT IS `--text`, NOT `--accent`, even though the arc it counts is
// `--accent`. Over the worst 16% node fill the accent measures 3.15 dark / 9.39
// light — comfortably past the 3:1 a non-text arc owes, and BELOW the 4.5:1 a
// numeral owes. One token cannot do both jobs, so the arc keeps the accent and
// the numeral takes the ink that is 8.82 / 12.28 on the same surface.

import { memo, type CSSProperties, type ReactElement } from 'react'

export interface MindWorldRimProps {
  readonly world: {
    readonly worldX: number
    readonly worldY: number
    readonly worldD: number
  }
  /** The world's name, already `isolate()`d by the caller. */
  readonly label: string
  /**
   * The branch's `--track-c-dark` / `--track-c-light` pair, exactly as
   * `trackStyle.trackVars()` produced it and `model.ts` stapled it onto the
   * node. THE ONLY WAY A HUE ENTERS THIS DRAWING.
   *
   * Any other custom property set here is honoured too. It used to be the
   * escape hatch for the camera as well — a caller could pass
   * `--mring-rim-font` to pin the label — and that hatch is GONE, because the
   * pinning is no longer optional: `unitsPerPx` does it for every caller and
   * `--mring-px` carries it to the sheet. An escape hatch nobody may decline is
   * a prop.
   */
  readonly ink: CSSProperties
  /**
   * DRAWING UNITS PER CSS PIXEL — `1 / scale`, the reciprocal of the camera
   * number MapCanvas already holds.
   *
   * WHY THE RECIPROCAL AND NOT `scale`: every use of it here is a
   * MULTIPLICATION of an authored CSS length, in JS below and in `calc()` in
   * the sheet, and `calc(13px / var(--mring-scale))` is a division inside a
   * custom property — legal, but it puts the one arithmetic step that can
   * divide by zero inside a stylesheet, where there is no place to guard it.
   * The guard lives in one line of this component instead.
   *
   * REQUIRED, with no default. A missing value would silently restore the
   * defect this prop exists to fix — a rim label authored at 13 USER units,
   * which on a 98,360-unit world rasterises at 0.05 px — and this component has
   * exactly one caller, so there is nobody for a default to rescue.
   */
  readonly unitsPerPx: number
  /** Matches in this world's subtree. 0 draws no match rim at all. */
  readonly matches: number
  /**
   * One wedge per matching child, in RADIANS, in the SAME already-mirrored space
   * as `world` — the geometry module's single θ → π − θ reflection statement is
   * the only place direction is resolved, and this component does not re-resolve
   * it. `end` is the wedge's counter-clockwise extremity in LTR.
   */
  readonly matchWedges: readonly { readonly start: number; readonly end: number }[]
  readonly rtl: boolean
  /**
   * The rim's own opacity, 0..1, from `lod.bandBlend` — `out` while the world is
   * opening (the rim arriving as the card leaves) and `1 - out` while it is the
   * frame past 1.6V (the rim leaving as the stage border takes over). Both
   * resolve inside 0.3 octaves; neither is a resting state.
   *
   * At 0 the component renders NOTHING — not a transparent group. A fully faded
   * mark left in the DOM is ink at a ratio nobody measured, sitting on top of its
   * own children's targets.
   */
  readonly fade: number
}

/**
 * Where the label sits below the rim's block-start edge, in CSS PIXELS.
 *
 * IT USED TO BE DRAWING UNITS and the number is unchanged, because at
 * `cardScale = 1` — a leaf's own world — the two are the same thing. What
 * changed is that it now means the same distance on the screen at every
 * altitude: multiplied by `unitsPerPx` below, 18 is 18 px under the rim
 * whether the world is the workspace or an Organization. Left in units, it was
 * 18/98,360 of the root's radius, i.e. the label sat ON the boundary line.
 */
const LABEL_DROP = 18
/** And the match count below it, on the same centre line. Same units. */
const COUNT_DROP = 40

/** Path data is rounded so a pan does not rewrite every arc with float noise. */
function r2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * One wedge of the rim, as an SVG arc.
 *
 * THE SWEEP FLAG FLIPS UNDER RTL AND THAT IS NOT COSMETIC. The layout's mirror
 * maps θ → π − θ, which turns clockwise into anticlockwise — so an arc drawn with
 * a fixed sweep flag takes the LONG way round in Arabic and, on any directional
 * mark, reads as counting DOWN. The endpoints alone do not carry the fix: two
 * points on a circle admit four arcs, and the flag is which one.
 */
function wedgePath(
  cx: number,
  cy: number,
  radius: number,
  start: number,
  end: number,
  rtl: boolean,
): string | null {
  if (!Number.isFinite(start) || !Number.isFinite(end) || !(radius > 0)) return null
  const span = Math.abs(end - start)
  if (!(span > 1e-6)) return null
  // A full turn has no two endpoints, so it is clamped just short of one rather
  // than degenerating into an invisible zero-length arc.
  const limited = Math.min(span, Math.PI * 2 - 1e-3)
  const to = start + Math.sign(end - start) * limited
  const x0 = r2(cx + radius * Math.cos(start))
  const y0 = r2(cy + radius * Math.sin(start))
  const x1 = r2(cx + radius * Math.cos(to))
  const y1 = r2(cy + radius * Math.sin(to))
  const large = limited > Math.PI ? 1 : 0
  const sweep = rtl ? 0 : 1
  return `M ${x0} ${y0} A ${r2(radius)} ${r2(radius)} 0 ${large} ${sweep} ${x1} ${y1}`
}

/**
 * Memoised, though `unitsPerPx` now changes on every zoom frame, so a rim DOES
 * re-render on a pure camera change — and it must: being pinned to the camera
 * is the whole point of it. What the memo still buys is a PAN, where the scale
 * does not move and nothing here re-renders at all. The cost of the zoom case
 * is bounded by construction rather than by hope: only `opening` and `frame`
 * nodes have a rim, MapCanvas draws none for a node with no children, and at
 * 2.22 octaves per tier that is at most a handful on screen. The same prop on
 * MindNode would re-render four hundred cards a notch, which is exactly why
 * a card is scaled by its world instead.
 */
export const MindWorldRim = memo(function MindWorldRim({
  world,
  label,
  ink,
  matches,
  matchWedges,
  rtl,
  fade,
  unitsPerPx,
}: MindWorldRimProps): ReactElement | null {
  if (!(fade > 0)) return null
  const radius = world.worldD / 2
  if (!Number.isFinite(radius) || radius <= 0) return null
  const opacity = fade >= 1 ? undefined : fade
  /**
   * THE ONE GUARD, and it is here rather than in the sheet because a stylesheet
   * has no `else`. A camera scale of 0 (the first frame before the stage has
   * been measured) or a NaN would otherwise put `Infinity` into a `y` attribute
   * and `calc(13px * NaN)` into a font size — one of which draws nothing and
   * the other of which draws at the browser's default. 1 is the identity: the
   * drawing this component made before the camera existed.
   */
  const px = Number.isFinite(unitsPerPx) && unitsPerPx > 0 ? unitsPerPx : 1

  return (
    <g
      className="mring-world"
      // `--mring-px` IS THE WHOLE CAMERA PIN. mind-ring.css multiplies both
      // font sizes and both stroke widths by it; the two `y` drops below do the
      // same multiplication in JS, because an attribute has no cascade. Written
      // as a string deliberately: it is a unitless <number>, and a bare JS
      // number is one React release away from being serialised as `1234px`,
      // which would make every `calc()` that reads it invalid and silently drop
      // the declaration.
      style={{ ...ink, '--mring-px': String(px) } as CSSProperties}
      // The world's identity belongs to its treeitem while it still has one and
      // to the breadcrumb after that. A third announcement of the same name,
      // from a decorative circle, would say it twice to the one reader who
      // cannot skim past the repetition.
      aria-hidden="true"
    >
      <circle
        className="mring-world-edge"
        cx={r2(world.worldX)}
        cy={r2(world.worldY)}
        r={r2(radius)}
        opacity={opacity}
      />

      {matches > 0 &&
        matchWedges.map((wedge, index) => {
          const d = wedgePath(world.worldX, world.worldY, radius, wedge.start, wedge.end, rtl)
          if (d === null) return null
          return (
            <path
              // Wedges arrive positionally from the page's memo and have no id
              // of their own; the index IS their identity here, and the list is
              // never reordered — it is rebuilt whole whenever the filter moves.
              key={index}
              className="mring-world-match"
              d={d}
              opacity={opacity}
            />
          )
        })}

      {/* THE NAME, at the boundary's block-start. `middle` needs no mirror: it
          is the geometric centre of the world in both scripts, and the block
          axis is the one axis SVG and the reader agree about. */}
      <text
        className="mring-world-label"
        x={r2(world.worldX)}
        y={r2(world.worldY - radius + LABEL_DROP * px)}
        textAnchor="middle"
        dominantBaseline="central"
      >
        {label}
      </text>

      {matches > 0 && (
        <text
          className="mring-world-matches tabular"
          x={r2(world.worldX)}
          y={r2(world.worldY - radius + COUNT_DROP * px)}
          textAnchor="middle"
          dominantBaseline="central"
        >
          {matches}
        </text>
      )}
    </g>
  )
})

export default MindWorldRim
