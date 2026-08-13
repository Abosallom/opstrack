// THE LENS CHIPS — six destinations, five of which used to be five tabs, and
// the one switch that says how the open tree is drawn.
//
// EVERY CHIP, ALWAYS ALL OF THEM, NEVER BEHIND A DISCLOSURE. Each of the first
// five replaces a tab-bar slot: attention was /followups, the board was /board,
// the numbers were /dashboard, the activity record was /notifications. A tab tap
// costs one interaction and so must a chip, which is the whole of the killer
// test for this component — if any of these ever moves into a "More" menu it has
// become two.
//
// ── THE SIXTH CHIP, AND THE CEILING IT PUTS ON THE SEVENTH ─────────────────
//
// `portfolio` is one chip for FOUR questions — stalled, workload, vendor
// cohorts, progress — because they are one dataset (the ~400 organizations)
// grouped four ways, with one exception cut on top. Four chips would have taken
// this row to nine, which on a 375px phone is a two-screen pan: the guarantee
// above would still be technically true and would have stopped being true in
// practice, which is the worst way for a rule to die. The four live as `?by=`
// chips on the portfolio's own surface and as four Command Palette rows, so each
// is still one interaction from anywhere.
//
// SO THE NEXT PROPOSED CHIP HAS A QUESTION TO ANSWER FIRST: is it a new question
// about a new dataset, or the same rows read another way? If it is the second,
// it is a `?by=` value on a lens that already exists.
//
// THEY ARE NOT THE DIMENSION CHIPS and must never be mistaken for them.
// MapToolbar's dimension chips re-partition the SAME work; these change what
// work is on the screen at all. They are rendered as a separate labelled group,
// above the toolbar's own, for that reason.
//
// aria-pressed, NOT role="radiogroup" + aria-checked, and not a `<select>`. A
// radio group takes the arrow keys away from anything inside it and the map's
// canvas is one Tab stop away; toggle buttons keep Tab as the only navigation
// and let the browser announce state without a roving tabindex this component
// would then have to own. FilterBar's own segmented pairs made the same choice.
//
// THE COUNT IS PART OF THE NAME. A badge rendered as bare text would be read as
// a number floating after the label ("attention 12"), so the number goes into
// the button's `aria-label` as a counted sentence through the plural node, and
// the visible badge is `aria-hidden`. `null`/absent means the count is not
// computed for that lens — which is not the same as zero and must not draw a
// zero badge implying an empty list.
//
// THE PORTFOLIO'S COUNT IS THE AT-RISK COUNT, and that is what makes the morning
// answer cost zero interactions: the badge says how many organizations are past
// their stage threshold, and the list behind the chip is already sorted longest-
// stuck first. It is the same `counts` prop and needed no new one — the shell
// computes the number, this row only renders it.
//
// ── ONE FILLED PILL IN A ROW OF LABELS ─────────────────────────────────────
//
// The measured complaint about this screen was never the control COUNT: it was
// that "every control is the same size, the same weight and the same colour, so
// nothing leads the eye." Equally-outlined chips are equal buttons. The pressed
// chip keeps the filled recipe; the rest lose their outline and become
// `--text-dim` text (map-lens.css). Their `.tap-44` overlays are untouched, so
// nothing about the targets changes — only what the eye lands on.
//
// ── THE MAP|TABLE PAIR HAS LEFT ────────────────────────────────────────────
//
// It is the Table toggle at MapAltitude's foot now — still one tap, because the
// ledger is the low-motion, drag-free reading mode and burying an accessibility
// mode is not available to us. `stage`/`onStage` are gone from the props; the
// shell decides whether to render that toggle at all, from `allowedStages`.

import { type ReactElement } from 'react'
import { t } from '../../lib/i18n'
import { LENS_KEY, MAP_LENSES, type MapLens } from '../../lib/mindtree/lens'
import './map-lens.css'

export interface MapLensBarProps {
  lens: MapLens
  onLens: (next: MapLens) => void
  compact: boolean
  /**
   * Absent = not computed for that lens. Rendered as a badge on the chip.
   *
   * KEYED ON `MapLens`, so the sixth chip's at-risk count needed no widening
   * here at all — `portfolio` became a legal key the moment the union gained it.
   * Absent is NOT zero: a lens whose count nobody computed must not draw a `0`
   * that reads as "nothing to see".
   */
  counts: Readonly<Partial<Record<MapLens, number>>>
}

export default function MapLensBar({ lens, onLens, compact, counts }: MapLensBarProps): ReactElement {
  return (
    <div
      className="mlens"
      role="group"
      aria-label={t('mindtree.lensLabel')}
      // The presentation, from the shell's one reading of `(max-width: 767px)`
      // rather than a second breakpoint in CSS that could disagree with it.
      data-compact={compact ? '' : undefined}
    >
      {/* The `.mlens-label` span that stood here is DELETED. It was already
          `aria-hidden` and already hidden at `[data-compact]`, and the group's
          own `aria-label` carries the same words to the same readers — so it
          was a small-caps heading spending desktop width to repeat what the
          chips beside it already say. `mindtree.lensLabel` is NOT retired: it is
          this group's accessible name, above. */}

      {/* The scroller, on a phone only: the chips do not fit 375px — five did
          not and six do not — and the alternative, shrinking them, is the one
          thing rule 4 forbids. Every chip keeps its full target and the row
          pans. This is also the reason the four portfolio questions are ONE
          chip: the pan is affordable for six and is a two-screen hunt at nine. */}
      <div className="mlens-chips">
        {MAP_LENSES.map((value) => {
          const label = t(LENS_KEY[value])
          const count = counts[value]
          return (
            <button
              key={value}
              type="button"
              className="mlens-chip tap-44"
              aria-pressed={value === lens}
              aria-label={
                count === undefined ? label : `${label} — ${t('mindtree.lensCount', { count })}`
              }
              onClick={() => onLens(value)}
            >
              <span className="mlens-chip-text">{label}</span>
              {count !== undefined && count > 0 && (
                <span className="mlens-badge tabular" aria-hidden="true">
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
