// THE CAPTION STRIP AT THE STAGE'S BLOCK END — the legend, the gesture hint,
// the screen's three summary sentences, the filter's result count, and the
// page's live region. One row, ~24px tall, beside the composer.
//
// WHY IT IS ONE ROW NOW. These same nodes used to render as a stack of
// paragraphs BELOW the canvas, in document flow, after a `clamp(22rem, 62vh,
// 45rem)` drawing that itself started 486px down the viewport. Opened at
// 1600×900 that put every one of them under the fold: the three summary
// sentences have been shipping for months and nobody has ever seen them. The
// stage is a fixed-height region now (U6), so "below the canvas" is a place on
// the screen rather than a place in a scroll nobody performs.
//
// THE SUMMARY IS NOT DECORATION. Its third sentence — the biggest ring-2 bucket
// across every track — is the only place "who is overloaded across four tracks"
// is answerable without opening the table, because ring 2 sits inside ring 1 and
// a person working across four tracks is four nodes carrying four numbers. It is
// computed in pages/map/useMapModel.ts, beside the tree it walks, and handed
// here and to the export, which paints the same three sentences into its
// caption.
//
// WHAT IS MAP-ONLY AND WHAT IS NOT is unchanged and still the reason this file
// has a `showMapChrome` branch at all: the legend, the hint and the sr-only
// keyboard contract belong to the PICTURE and disappear in table view; the
// summary sentences, the count and the live region describe the WORKSPACE and
// stay.

import type { ReactElement } from 'react'
import { t } from '../../lib/i18n'

export interface MapSummaryProps {
  /** Map view — the legend, the hint and the keyboard contract are the picture's. */
  showMapChrome: boolean
  compact: boolean
  /** The id the <svg>'s `aria-describedby` points at. */
  hintId: string
  summary: string
  busiest: string | null
  topGroup: string | null
  /**
   * The filter's own result count — `t('mindtree.countOpen', { count })`,
   * previously a standalone chip in the header rail. It is a READING of the
   * picture, so it belongs in the picture's caption and not in a third row of
   * chrome above it.
   */
  countLabel: string
  live: { text: string; seq: number }
}

export default function MapSummary({
  showMapChrome,
  compact,
  hintId,
  summary,
  busiest,
  topGroup,
  countLabel,
  live,
}: MapSummaryProps): ReactElement {
  return (
    <div className="mtree-cap">
      {showMapChrome && (
        <>
          <ul className="mtree-legend" aria-label={t('mindtree.legend')}>
            <li className="mtree-legend-item">
              <span className="mtree-legend-size" aria-hidden="true" />
              {t('mindtree.legendSize')}
            </li>
            <li className="mtree-legend-item">
              <span className="mtree-legend-breach" aria-hidden="true" />
              {t('mindtree.legendBreach')}
            </li>
            {/* THE LEGEND LINE THAT SAYS WHAT IS *NOT* ENCODED, and it earns its
                place in a row this tight. A radial map invites a reader to
                decide that 3 o'clock is important, or that two branches near
                each other are related — and neither is true: ANGLE CARRIES TREE
                ORDER AND PACKING ONLY, never data. Size and colour are the two
                channels that mean something and the two above name them; this
                is the third channel a circle appears to offer and does not. It
                has no swatch because there is no mark to show — that is the
                point. */}
            <li className="mtree-legend-item">{t('mindtree.legendAngle')}</li>
          </ul>

          {/* KEPT ON THE PHONE, DROPPED ON THE DESKTOP. Drag-to-pan is
              discoverable with a mouse — the cursor is over the thing, the
              thing moves — and a sentence explaining it spent a row of a
              1600px caption saying so. With a thumb it is not discoverable at
              all: nothing on a touch screen says a one-finger drag pans and a
              two-finger pinch zooms until you have already tried it. */}
          {compact ? <p className="mtree-hint">{t('mindtree.mobileHint')}</p> : null}

          {/* Inside the map branch and carrying the id the <svg> points at.
              It sat outside both before: unreferenced, so a reader only met it
              by walking past the entire map to the foot of the document, and
              still rendered in TABLE view, where it described the arrow-key
              behaviour of a widget that is not on the screen. sr-only because
              it is the picture's instructions and a sighted user has buttons.
              IT DOES NOT MOVE AND IT KEEPS ITS ID: the <svg>'s
              `aria-describedby` resolves to this node, and relocating or
              renaming it breaks the map's description with no visible symptom
              at all. */}
          {/* TWO SENTENCES, ONE ELEMENT, because `aria-describedby` resolves an
              id to one node and the walk and the tick are one contract: how to
              move around the map, and how to mark several items so they travel
              together. The DRAG's own grammar is a third sentence and lives in
              MindDragLayer (`controller.hintId`), beside the gesture it
              describes — the <svg> points at both ids. */}
          <p className="sr-only" id={hintId}>
            {t('mindtree.keyboardHint')} {t('mindtree.selectHint')}
          </p>
        </>
      )}

      <p className="mtree-note">
        {summary}
        {busiest !== null && ` ${busiest}`}
        {topGroup !== null && ` ${topGroup}`}
      </p>

      <p className="mtree-cap-count tabular">{countLabel}</p>

      {/* polite, not assertive: the filter's own count already announces on
          every keystroke through FilterBar, and two assertive regions on one
          screen interrupt each other. */}
      <p className="sr-only" role="status" aria-live="polite">
        {/* KEYED ON A COUNTER, so an identical consecutive sentence is still
            announced. A plain string is a React bail-out when the value has not
            changed, which produces no DOM mutation and therefore no
            announcement — and this region says the same words twice all the
            time: Space on a second item you may not move, "Collapse all"
            pressed twice, "Fit to view" already fitted. `MindDragLayer`'s own
            region solved this first and states the reason; this is the same
            answer. */}
        <span key={live.seq}>{live.text}</span>
      </p>
    </div>
  )
}
