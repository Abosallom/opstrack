// THE ZOOM CONTROL — the map's only VISIBLE way to change how much of the
// drawing is on the screen, and the only place on that screen where the answer
// is written down.
//
// ── THE DEFECT THIS EXISTS FOR ─────────────────────────────────────────────
//
// `MapDiveRail` is not mounted. `Mindtree.tsx` calls that "A DEBT WITH A PRICE,
// NOT A DELETION" and it is right about the price: the rail carried the whole
// zoom surface, so switching it off took Fit, the +/− targets and the readout
// with it in one move. What is left is the wheel, the pinch, the `+`/`-` keys
// and `Home` — four gestures, none of which is drawn anywhere, none of which is
// named anywhere, and none of which a reader who has not read the source can
// guess. The report that produced this file is three words long: "I get lost".
//
// So this is deliberately NOT the rail rebuilt. It is the smallest thing that
// answers the two questions a lost reader is actually asking — *how far in am
// I* and *how do I get back* — and it answers the second one with a button
// rather than a keystroke.
//
// ── IT SAYS A WORD, NOT A PERCENTAGE ───────────────────────────────────────
//
// `MapDiveRail`'s header already argued this and the argument outlives the
// component: "Zoom 100%" answered the question "100% of what?", and a map whose
// world size is the admin's department depth has no 100% to be. The readout is
// therefore a NAMED STEP — "Wide view", "Closer in" — plus the shape of the
// range it sits in, which is what turns one word into a position. `zoomPercent`
// still exists elsewhere and is still printed on the export caption, because
// that is a fact about a FILE rather than about a view.
//
// The five steps are this component's own, not the workspace's tiers. That is a
// departure from the rail, and it is deliberate: the rail's ticks were rungs on
// the CURRENT PATH and moved as you dived, which is right for a control you drag
// and wrong for a two-button nudge — a label that renames itself when you press
// `+` teaches nothing. Five fixed words over a continuous range are stable, and
// the caller's `progress` is already normalised to that range.
//
// ── WHAT IS NOT HERE, AND WHY ──────────────────────────────────────────────
//
// NO SLIDER. The rail had one and it earned its place by being draggable; two
// buttons and a Fit do not, and an `<input type="range">` beside them would be a
// third way to do the same thing in a plate this small.
//
// NO LIVE REGION. `MapAnnouncer` owns the page's one `aria-live` region, and its
// own header records why there is exactly one: two polite regions on a screen
// interrupt each other. The readout here carries a full sentence in an `sr-only`
// span instead, which a reader reaches by focus rather than by interruption.
//
// NO MOUNT. This unit is handed to the integrator unmounted, on purpose. Where
// it goes is a stage-layout decision (see the sheet's positioning contract), and
// wiring it from here would mean editing `Mindtree.tsx`, which this unit does
// not own.
//
// ── WHY renderToStaticMarkup CAN PROVE ALL OF IT ───────────────────────────
//
// Everything above is markup: three buttons, their labels, their disabled ends
// and one readout. There is no effect, no measurement and no state, which is
// what lets the test file be a static render in `environment: 'node'` — the same
// bargain `MapAnnouncer.test.tsx` and `MapBranchDetail.test.tsx` strike.

import { type ReactElement } from 'react'
import { t, useLocale } from '../../lib/i18n'
import './map-zoom.css'

export interface MapZoomControlProps {
  /** 0..1 across the usable zoom range, for the readout. */
  progress: number
  onZoomIn: () => void
  onZoomOut: () => void
  /** Frame the whole drawing. */
  onFit: () => void
  atMin: boolean
  atMax: boolean
  compact: boolean
}

/**
 * The five words, from the widest view to the closest.
 *
 * LITERAL KEYS IN AN ARRAY, never `` t(`mindtree.zoomStep${n}`) ``. A template
 * literal has no key until it runs, which is precisely the shape
 * `localeReach.test.ts` cannot see — its header names four families that had to
 * be enumerated by hand for exactly that reason, and this is one array away from
 * being a fifth. Written out, the reachability gate finds all five and a missing
 * Arabic twin is a red test here instead of a dot path on a user's screen.
 *
 * The ORDER is the contract: index 0 is `progress === 0` is the widest view.
 */
const STEP_KEYS = [
  'mindtree.zoomStepWhole',
  'mindtree.zoomStepWide',
  'mindtree.zoomStepMid',
  'mindtree.zoomStepClose',
  'mindtree.zoomStepClosest',
] as const

/**
 * Which of the five words `progress` lands on.
 *
 * Exported for the test, because the rounding is the only arithmetic in the file
 * and the two ENDS are the part that matters: a reader at the widest possible
 * view must be told "Whole map" and not "Wide view", or the readout disagrees
 * with the button that has just gone dead beside it.
 *
 * `Math.round`, not `Math.floor`: with four gaps between five words, floor gives
 * the last word a range of exactly one point (`progress === 1`) and the first
 * one a quarter of the range, so "Closest" would be unreachable at any zoom the
 * wheel actually stops on. Round gives every word an eighth at the ends and a
 * quarter in the middle, which is the even split the pips draw.
 *
 * NaN is floored to 0 rather than thrown: `progress` arrives from a camera whose
 * span can be zero (a single-node workspace frames one rectangle, and a division
 * by that span is NaN). Zero is the honest answer there — nothing to dive into —
 * and it is also what the two disabled buttons will be saying.
 */
export function zoomStepOf(progress: number): number {
  const last = STEP_KEYS.length - 1
  if (!Number.isFinite(progress)) return 0
  return Math.min(last, Math.max(0, Math.round(progress * last)))
}

export default function MapZoomControl({
  progress,
  onZoomIn,
  onZoomOut,
  onFit,
  atMin,
  atMax,
  compact,
}: MapZoomControlProps): ReactElement {
  // Subscribed so a language switch — and a Terminology rename — re-renders the
  // three labels and the readout. Every t() below reads lib/i18n's MODULE-level
  // locale, which React cannot watch on its own.
  useLocale()

  const index = zoomStepOf(progress)
  // The array is `as const` and `index` is clamped to its bounds above, so the
  // fallback is unreachable; it is here because `noUncheckedIndexedAccess` is on
  // and an assertion would be a lie about what the compiler knows.
  const stepName = t(STEP_KEYS[index] ?? STEP_KEYS[0])

  return (
    // `data-compact` rather than a modifier class: the sheet's phone rule is a
    // POSITION, not a variant, and `.mdive[data-compact]` one file over spells
    // the same idea the same way. `undefined` and not `false` — React drops the
    // attribute entirely, and `[data-compact]` must not match "no".
    <div className="mzc" data-compact={compact ? '' : undefined}>
      {/* A group, not a toolbar. `role="toolbar"` claims the arrow keys, and the
          map canvas — which owns ArrowUp/ArrowDown/Home/End for its roving
          tabindex — is one Tab away. `MapDiveRail` made this argument first and
          the reasoning survives the component. */}
      <div className="mzc-plate" role="group" aria-label={t('mindtree.zoomLabel')}>
        {/* DISABLED *AND* aria-disabled, which is belt and braces with a cost
            worth stating. `disabled` is what stops the click and what greys the
            control for everyone; `aria-disabled` is what several screen readers
            actually announce, and it is also what survives if a later hand
            replaces these with divs. The cost is that a `disabled` button is not
            focusable, so a keyboard reader at the far end of the range cannot Tab
            onto the dead control to hear why — they land on Fit instead, which is
            the button that gets them out. That trade was chosen over
            `aria-disabled` alone, which leaves a control that announces itself as
            unavailable and then fires anyway. */}
        <button
          type="button"
          className="mzc-btn tap-44"
          aria-label={t('mindtree.zoomOut')}
          aria-disabled={atMin}
          disabled={atMin}
          onClick={onZoomOut}
        >
          {/* U+2212 MINUS SIGN, not a hyphen: a hyphen renders as a short tick
              that does not optically match the `+` beside it. `aria-hidden`
              because the button's whole meaning is on its `aria-label` — a glyph
              announced as "minus" is worse than one announced as nothing. */}
          <span className="mzc-glyph" aria-hidden="true">
            −
          </span>
        </button>

        <button
          type="button"
          className="mzc-btn tap-44"
          aria-label={t('mindtree.zoomIn')}
          aria-disabled={atMax}
          disabled={atMax}
          onClick={onZoomIn}
        >
          <span className="mzc-glyph" aria-hidden="true">
            +
          </span>
        </button>

        {/* NEVER DISABLED, at either end. "Fit" is the way out of being lost,
            and the moment a reader most wants it is the moment they have pinched
            all the way in — which is exactly when `atMax` is true. It is also
            not a no-op there: fitting from the closest step is the largest move
            this control makes. */}
        <button
          type="button"
          className="mzc-fit tap-44"
          aria-label={t('mindtree.zoomFit')}
          onClick={onFit}
        >
          {t('mindtree.zoomFitShort')}
        </button>

        <p className="mzc-readout">
          <span className="mzc-step">{stepName}</span>

          {/* THE SHAPE OF THE RANGE, and it is decoration in the strict sense:
              every word it could speak is already in the two spans either side
              of it, so announcing it would repeat the readout twice. It is a
              staircase rather than five equal dots because the ramp itself says
              which end is which — colour alone would not (1.4.1), and this plate
              floats over a drawing whose colours are the tracks'. */}
          <span className="mzc-range" aria-hidden="true">
            {STEP_KEYS.map((key, i) => (
              <span key={key} className="mzc-pip" data-on={i <= index ? '' : undefined} />
            ))}
          </span>

          {/* The whole sentence, for the reader who cannot see the staircase.
              NO BIDI ISOLATES around these three: `{step}` is a t() result, so
              it is always the paragraph's own language and an FSI would be a
              no-op; `{index}` and `{total}` are bare numbers, which lib/bidi's
              own rule says already read correctly beside Arabic and are made
              WORSE by a fence that detaches the punctuation belonging to them. */}
          <span className="sr-only">
            {t('mindtree.zoomReadout', {
              step: stepName,
              index: index + 1,
              total: STEP_KEYS.length,
            })}
          </span>
        </p>
      </div>
    </div>
  )
}
