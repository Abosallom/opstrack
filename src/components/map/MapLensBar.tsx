// THE LENS CHIPS — five destinations that used to be five tabs, and the one
// switch that says how the open tree is drawn.
//
// FIVE CHIPS, ALWAYS ALL FIVE, NEVER BEHIND A DISCLOSURE. Each one replaces a
// tab-bar slot: attention was /followups, the board was /board, the numbers were
// /dashboard, the activity record was /notifications. A tab tap costs one
// interaction and so must a chip, which is the whole of the killer test for this
// component — if any of these ever moves into a "More" menu it has become two.
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

import { type ReactElement } from 'react'
import { t } from '../../lib/i18n'
import {
  LENS_KEY,
  MAP_LENSES,
  STAGE_KEY,
  allowedStages,
  type MapLens,
  type MapStage,
} from '../../lib/mindtree/lens'
import './map-lens.css'

export interface MapLensBarProps {
  lens: MapLens
  onLens: (next: MapLens) => void
  stage: MapStage
  onStage: (next: MapStage) => void
  compact: boolean
  /** null = not computed for that lens. Rendered as a badge on the chip. */
  counts: Readonly<Partial<Record<MapLens, number>>>
}

export default function MapLensBar({
  lens,
  onLens,
  stage,
  onStage,
  compact,
  counts,
}: MapLensBarProps): ReactElement {
  const stages = allowedStages(lens)

  return (
    <div
      className="mlens"
      role="group"
      aria-label={t('mindtree.lensLabel')}
      // The presentation, from the shell's one reading of `(max-width: 767px)`
      // rather than a second breakpoint in CSS that could disagree with it.
      data-compact={compact ? '' : undefined}
    >
      <span className="mlens-label" aria-hidden="true">
        {t('mindtree.lensLabel')}
      </span>

      {/* The scroller, on a phone only: five chips do not fit 375px, and the
          alternative — shrinking them — is the one thing rule 4 forbids. Every
          chip keeps its full target and the row pans. */}
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

      {/* Only where there is something to switch: the board and the numbers are
          not the open tree and have no ledger form. Rendering a one-option
          switch would be a control that cannot do anything. */}
      {stages.length > 1 && (
        <div className="mlens-stages" role="group" aria-label={t('mindtree.stageLabel')}>
          {stages.map((value) => (
            <button
              key={value}
              type="button"
              className="mlens-stage tap-44"
              aria-pressed={value === stage}
              onClick={() => onStage(value)}
            >
              {t(STAGE_KEY[value])}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
