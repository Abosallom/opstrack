// EVERYTHING UNDER THE DRAWING — the legend, the gesture hint, the screen's
// three summary sentences, and the page's live region.
//
// Extracted from pages/Mindtree.tsx unchanged, including which parts are
// map-only and which are not: the legend, the pan/mobile hint and the sr-only
// keyboard contract belong to the picture and disappear in table view; the
// summary sentences and the live region describe the WORKSPACE and stay.
//
// THE SUMMARY IS NOT DECORATION. Its third sentence — the biggest ring-2 bucket
// across every track — is the only place "who is overloaded across four tracks"
// is answerable without opening the table, because ring 2 sits inside ring 1 and
// a person working across four tracks is four nodes carrying four numbers. It is
// computed in pages/map/useMapModel.ts, beside the tree it walks, and handed
// here and to the export, which paints the same three sentences into its
// caption.

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
  live: { text: string; seq: number }
}

export default function MapSummary({
  showMapChrome,
  compact,
  hintId,
  summary,
  busiest,
  topGroup,
  live,
}: MapSummaryProps): ReactElement {
  return (
    <>
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
          </ul>
          <p className="mtree-hint">{compact ? t('mindtree.mobileHint') : t('mindtree.panHint')}</p>
          {/* Inside the map branch and carrying the id the <svg> points at.
              It sat outside both before: unreferenced, so a reader only met it
              by walking past the entire map to the foot of the document, and
              still rendered in TABLE view, where it described the arrow-key
              behaviour of a widget that is not on the screen. sr-only because
              it is the picture's instructions and a sighted user has buttons. */}
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
    </>
  )
}
