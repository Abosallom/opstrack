// THE DIVE RAIL — one continuous control where seven buttons were, and the one
// place on this screen that says WHERE YOU ARE as a word.
//
// ── WHAT IT REPLACES, AND THE MECHANISM THAT REPLACED EACH ─────────────────
//
// `MapAltitude` rendered six targets — four named stops, `Fit`, and the ledger
// toggle — and `MapToolbar` rendered `Zoom −`, `Zoom 100%`, `Zoom +`, `Expand
// all` and `Collapse all` before that. Eleven controls between them, all saying
// one thing: HOW MUCH OF THE ORGANISATION AM I LOOKING AT. This file is the
// answer to all of it except the ledger toggle, which rides along because
// burying an accessibility mode is not available to us.
//
//   · Zoom − / Zoom +      the wheel and the pinch ARE the control (U3). They
//                          survive as +/− KEYS (U5): deleting a button must
//                          never delete keyboard reach.
//   · "Zoom 100%"          it answered "100% of what?". `zoomPercent` still
//                          exists, and is still printed by the export caption,
//                          because that is a fact about a FILE.
//   · The four altitude    REQUIRED, not preferred. The owner's correction is
//     stops                that the number of levels is the DEPTH OF THE
//                          DEPARTMENT TREE THE ADMIN CONFIGURES. Four frozen
//                          English words in an `Object.freeze`d `Record` is
//                          exactly the hard-coded ladder that forbids. Here the
//                          ladder's length is `rungs.length` and its words are
//                          `rungs[i].label` — DATABASE TEXT out of
//                          `map_node_kinds`, which is already bilingual, which
//                          is precisely why the admin's depth can be the ladder.
//                          A workspace with two tiers gets two ticks; one with
//                          seven gets seven.
//   · Fit to view          the rail's ZERO RUNG. `Home` on the slider frames the
//                          root, and `Escape` does the same from the canvas (U5).
//   · Expand / Collapse     every child is already in the drawing, waiting at its
//     all                   own distance — there is no fold to open. The two
//                           verbs stay EXPORTED from `useMapToolbar` for the node
//                           menu and the table stage, which still mean something
//                           by them.
//
// ── WHY A `<input type="range">` AND NOT A CUSTOM WIDGET ───────────────────
//
// One node in the accessibility tree; natively keyboard reachable; natively
// draggable with a finger or a mouse; announces its own value changes without a
// live region. Dragging the thumb IS the continuous zoom for a reader who cannot
// wheel and for a one-handed touch reader who finds a pinch awkward, and it is
// continuous in the same units the wheel writes — `step` is 0.02 octaves, which
// is a hundredth of a tier at the shallowest fan-out this map produces.
//
// AND IT SPEAKS A WORD, NEVER A NUMBER. `aria-valuetext` is the WORLD THE
// CAMERA CURRENTLY FRAMES. "2.4" is not an answer to "where am I"; "Onboarding"
// is. This is the single most important line in the file and it is the reason
// the rail can replace a named ladder without losing the naming.
//
// ── `aria-pressed`, NEVER `role="radiogroup"` ──────────────────────────────
//
// A radio group takes the arrow keys away from everything inside it, and the
// map's canvas — which owns ArrowUp / ArrowDown / Home / End for its roving
// tabindex — is ONE TAB STOP AWAY. Toggle buttons keep Tab as the only
// navigation here and let the browser announce the state without this component
// owning a roving tabindex of its own. `MapAltitude` made this argument first;
// the component is gone and the reasoning is not.
//
// ── THE TICKS ARE MARKS, NOT CONTROLS ──────────────────────────────────────
//
// Deliberately `aria-hidden` and `pointer-events: none`. Making each tick a
// button would put the depth of the admin's tree into the persistent target
// count — the exact thing this unit exists to cut — and it would be a SECOND
// answer to "take me to that world", which the breadcrumb already answers with a
// 44px tap per hop. What the ticks do is show that the tiers are UNEVENLY
// SPACED, which is a true and useful fact about the workspace: a department with
// two hundred children is three octaves deep and a three-child sibling is one
// and a half. `docs/MAP-ZOOM.md §9.1` names that asymmetry as a weakness; the
// ticks are what convert it from a mystery into a measurement.
//
// ── ORIENTATION IS A WRITING MODE, WHICH IS WHY THERE IS NO SECOND LAYOUT ──
//
// Vertical 44×308 at the canvas inline-end on the desktop; horizontal and full
// width immediately above the pinned lens rail on a phone, because a vertical
// rail at the inline end collides with the thumb's natural arc and with the
// sheet's drag handle. That is ONE rule set in map-altitude.css switched by
// `writing-mode` alone: the slider is 44px on its BLOCK axis and long on its
// INLINE axis in both cases, and the ticks are placed with `inset-inline-start`.
// No physical property, no second layout, and the Arabic mirror is free — see
// that sheet's header for what the mirror actually does to a vertical rail.

import {
  useCallback,
  useMemo,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from 'react'
import { isolate } from '../../lib/bidi'
import { t, useLocale } from '../../lib/i18n'
import './map-altitude.css'

/** One world boundary on the current path. */
export interface DiveRung {
  readonly id: string
  /**
   * The world's own name, or its kind name from `map_node_kinds` — already
   * resolved for the locale by the caller. DATABASE TEXT: it is `isolate()`d
   * here and must NEVER be handed to `t()`, which echoes an unknown key and
   * would render an Arabic department name as itself in English and as an
   * English dot path in Arabic.
   */
  readonly label: string
  /**
   * Octaves from the root world's framing. Ticks are UNEVENLY SPACED and that
   * is a fact about the workspace, not a bug.
   */
  readonly octaves: number
}

export interface MapDiveRailProps {
  /** Current position, octaves. CONTINUOUS — not a rung index. */
  value: number
  max: number
  /** Rungs on the CURRENT PATH only. Length is the admin's depth, never four. */
  rungs: readonly DiveRung[]
  /** The world currently framed — becomes `aria-valuetext`. */
  worldLabel: string
  onChange: (octaves: number) => void
  /** Home. The rail's zero rung IS "fit to view". */
  onHome: () => void
  table: boolean
  onTable: (next: boolean) => void
  compact: boolean
}

/**
 * The smallest travel the rail will accept as a range.
 *
 * A workspace of one tier has no dive: `max` is 0, and an `<input type="range">`
 * whose min equals its max is a control the browser renders but cannot move,
 * with no announced value. Flooring the span keeps the element valid and keeps
 * `aria-valuetext` — the world's NAME — reachable, which is the part of this
 * control that still means something when there is nowhere to go.
 */
const MIN_SPAN = 0.02

/**
 * Slack on the rung comparisons.
 *
 * `value` is the product of an unbounded number of wheel multiplications, so a
 * value that landed one ulp under its own rung would make an arrow press a
 * no-op — the reader presses again, and the second press works. Both
 * comparisons are widened in the direction of MOVING, which is the side a
 * navigation key should err on.
 */
const RUNG_EPSILON = 1e-6

/**
 * The rung an arrow press lands on.
 *
 * Exported because it is the only DECISION in this file and `environment:
 * 'node'` cannot press a key to observe it. Total: an empty `rungs`, a NaN
 * `value` and a rung list in any order all return a number in `[0, max]`.
 *
 * `direction` is +1 for DEEPER and −1 for SHALLOWER, already resolved from the
 * key and the reading direction by the caller.
 */
export function rungStep(
  value: number,
  max: number,
  rungs: readonly DiveRung[],
  direction: 1 | -1,
): number {
  const span = Math.max(max, MIN_SPAN)
  const here = Number.isFinite(value) ? Math.min(Math.max(value, 0), span) : 0
  const stops = rungs
    .map((r) => r.octaves)
    .filter((o) => Number.isFinite(o) && o >= 0 && o <= span)
    .sort((a, b) => a - b)

  if (direction === 1) {
    for (const o of stops) if (o > here + RUNG_EPSILON) return o
    return span
  }
  for (let i = stops.length - 1; i >= 0; i -= 1) {
    const o = stops[i]
    if (o !== undefined && o < here - RUNG_EPSILON) return o
  }
  return 0
}

export default function MapDiveRail({
  value,
  max,
  rungs,
  worldLabel,
  onChange,
  onHome,
  table,
  onTable,
  compact,
}: MapDiveRailProps): ReactElement {
  // Subscribed so a language switch re-renders the label, the value text and
  // the tick words. Every t() below reads lib/i18n's MODULE-level locale, which
  // React cannot watch on its own.
  const rtl = useLocale() === 'ar'

  const span = Math.max(max, MIN_SPAN)
  const pos = Number.isFinite(value) ? Math.min(Math.max(value, 0), span) : 0

  /**
   * THE TICKS ARE SORTED AND CLAMPED HERE, ONCE.
   *
   * The caller hands them in path order, which is already ascending — but a
   * rung past `max` would place a label outside the track, and a rung the
   * layout produced as NaN (an area encoding on a zero count can) would place
   * one at `calc(NaN * 100%)`, which the engine drops silently and which reads
   * as a missing tier rather than as a bug.
   */
  const ticks = useMemo(
    () =>
      rungs
        .filter((r) => Number.isFinite(r.octaves) && r.octaves >= 0 && r.octaves <= span)
        .slice()
        .sort((a, b) => a.octaves - b.octaves),
    [rungs, span],
  )

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>): void => {
      // HOME IS "FIT TO VIEW", and it is a fly rather than a value write: the
      // camera has to re-FRAME the root, which is a centre as well as a width,
      // and `onChange(0)` can only say the width. Same reasoning `Escape` uses
      // from the canvas.
      if (event.key === 'Home') {
        event.preventDefault()
        onHome()
        return
      }
      if (event.key === 'End') {
        event.preventDefault()
        onChange(span)
        return
      }

      // ARROWS STEP A TIER, and that is why the default is prevented. `step` is
      // 0.02 octaves so a native arrow press would move the camera by a
      // hundredth of a tier — indistinguishable from nothing, and forty presses
      // to cross one department. The pointer keeps the fine step; the keyboard
      // gets the meaningful one, which is the same split `MindNode`'s roving
      // tabindex makes between a drag and an arrow.
      //
      // RIGHT/LEFT SWAP UNDER RTL AND UP/DOWN DO NOT — the repo's standing
      // convention (MapCanvas's roving tabindex, and `radial.ts`'s one
      // reflection statement). The inline axis mirrors; the block axis is not a
      // reading direction and mirroring it would make Arabic disagree with
      // every other list in the app.
      const deeper =
        event.key === 'ArrowDown' ||
        event.key === 'PageDown' ||
        event.key === (rtl ? 'ArrowLeft' : 'ArrowRight')
      const shallower =
        event.key === 'ArrowUp' ||
        event.key === 'PageUp' ||
        event.key === (rtl ? 'ArrowRight' : 'ArrowLeft')
      if (!deeper && !shallower) return

      event.preventDefault()
      onChange(rungStep(pos, span, ticks, deeper ? 1 : -1))
    },
    [onChange, onHome, pos, rtl, span, ticks],
  )

  return (
    <div className="mdive" data-compact={compact ? '' : undefined}>
      {/* THE PLATE IS OPAQUE, AND THAT IS A REQUIREMENT RATHER THAN A TASTE.
          This floats over the drawing, so its backdrop is not the canvas colour
          — it is whatever node happens to be under it. `--bg-elev` + a
          `--border` hairline is `.mpan`'s plate verbatim; see map-altitude.css
          for the measured pairs. */}
      <div className="mdive-plate">
        <div className="mdive-track">
          {/* Marks, not controls. `aria-hidden` because the slider already
              speaks the world it frames and a screen reader reading the whole
              path twice per press is noise; `pointer-events: none` in the
              sheet, so the drag that starts on a label still reaches the
              thumb. */}
          <ul className="mdive-ticks" aria-hidden="true">
            {ticks.map((rung) => (
              <li
                key={rung.id}
                className="mdive-tick"
                style={{ '--mdive-at': `${(rung.octaves / span) * 100}%` } as CSSProperties}
              >
                <span className="mdive-tick-mark" />
                <span className="mdive-tick-label">{isolate(rung.label)}</span>
              </li>
            ))}
          </ul>

          <input
            className="mdive-range"
            type="range"
            min={0}
            max={span}
            step={0.02}
            value={pos}
            aria-label={t('mindtree.diveLabel')}
            // THE WHOLE POINT OF THE CONTROL. Never a number, never a
            // percentage — the name of the world the camera is framing right
            // now. The bidi isolate lives in the LOCALE STRING (`⁨{world}⁩`,
            // exactly as `mindtree.backTo` carries it) rather than being
            // applied here, so the two spellings of the same idea cannot drift.
            aria-valuetext={t('mindtree.diveValue', { world: worldLabel })}
            aria-orientation={compact ? 'horizontal' : 'vertical'}
            onChange={(event) => onChange(Number(event.target.value))}
            onKeyDown={onKeyDown}
          />
        </div>

        {/* The ledger toggle. Not a dive position — it is which renderer draws
            the open tree — so a hairline says so, and it is `aria-pressed` for
            a state it actually holds. */}
        <button
          type="button"
          className="mdive-table tap-44"
          aria-pressed={table}
          onClick={() => onTable(!table)}
        >
          {t('mindtree.stageTable')}
        </button>
      </div>
    </div>
  )
}
