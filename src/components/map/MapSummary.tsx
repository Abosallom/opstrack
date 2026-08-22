// THE CAPTION STRIP AT THE STAGE'S BLOCK END — the legend, the gesture hint and
// the screen's three summary sentences. One row, ~24px tall, beside the
// composer. Everything here DRAWS; nothing here is sr-only.
//
// THE TWO INVISIBLE NODES ARE NOT HERE ANY MORE. The page's live region and the
// element the <svg>'s `aria-describedby` points at used to sit in this file, and
// when the visible chrome was quieted to `{false && summaryIsle}` they were
// unmounted along with it — twenty announcement call sites speaking to nobody,
// and a dangling `aria-describedby`. They live in `MapAnnouncer` now, which
// mounts unconditionally because `.sr-only` cannot stand on the picture. See
// that file's header. What is left here is furniture, and furniture is what the
// gate was actually about.
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
// WHAT IS MAP-ONLY AND WHAT IS NOT is still the reason this file has a
// `showMapChrome` branch at all: the legend and the gesture hint belong to the
// PICTURE and disappear in table view; the summary sentences describe the
// WORKSPACE and stay. `MapAnnouncer` splits its own two nodes on the same axis
// and for the same reason.
//
// ── THE COUNT IS GONE, BECAUSE THE SUMMARY ALREADY SAID IT ────────────────
//
// `mindtree.countOpen` is `"{count} open"` and its count is `model.tree.count`.
// `mindtree.summary` is `"{count} tracks, {open} open, {breached} past
// deadline."` and its `{open}` is `model.tree.count` — THE SAME NUMBER FROM THE
// SAME EXPRESSION (pages/map/useMapModel.ts). Rendering both put "0 open" on
// the screen twice, the second time on its own line and at a larger size than
// the sentence that contains it, which reads as a defect and was one.
//
// The one that goes is the COUNT, not the sentence: the sentence is the reading
// of the picture — how many tracks, how much open, how much late — and the count
// is a fragment of it that used to be a chip in a header rail that no longer
// exists. Deleting the fragment loses nothing; deleting the sentence would lose
// the tracks and the breaches.
//
// THE `countLabel` PROP IS GONE WITH IT. It survived one commit as a prop the
// component accepted and did not render, so that the call site — owned by
// another unit — kept type-checking; both halves are deleted together here.
// `mindtree.countOpen` is NOT orphaned by this: pages/map/useMapModel.ts still
// builds a node's detail line from it, which is where the string earns its keep.
//
// ── AND IT PUBLISHES ITS OWN HEIGHT, WHICH IS A COLLISION FIX ─────────────
//
// On a phone the dive rail is a horizontal plate pinned above the two fixed
// rails, and its containing block reaches the block END of the stage — so it
// floated ON TOP of this strip, opaque, with a third legend line running under
// it visible only as clipped single characters. The rail cannot be told how much
// to clear at author time: this strip is two sentences in English and three
// lines in Arabic, and it grows with a selection bar above it. So it MEASURES
// itself and publishes the number, exactly as MapCapture publishes
// `--map-composer-block-size` for the sheet, and map-altitude.css adds it to the
// rail's own block-end margin. One number, measured once, nothing to keep in
// step, and no feedback loop: the rail is out of flow, so where it sits cannot
// change how tall this is.

import { useEffect, useRef, type ReactElement } from 'react'
import { t } from '../../lib/i18n'

export interface MapSummaryProps {
  /** Map view — the legend, the hint and the keyboard contract are the picture's. */
  showMapChrome: boolean
  compact: boolean
  summary: string
  busiest: string | null
  topGroup: string | null
}

export default function MapSummary({
  showMapChrome,
  compact,
  summary,
  busiest,
  topGroup,
}: MapSummaryProps): ReactElement {
  const capRef = useRef<HTMLDivElement | null>(null)

  /**
   * HOW TALL THIS STRIP IS, published to the dive rail.
   *
   * PHONE ONLY, and the property is REMOVED above 768px: on the desktop the rail
   * is block-centred against the canvas's inline end and this strip is in the
   * grid's own block-end row, so they cannot meet and a number the sheet does
   * not read is a number that can go stale.
   *
   * The element measured is `.mtree-foot` — this strip AND the selection bar
   * that shares its row — because the rail has to clear the row, not the
   * paragraph. It is clipped (`max-block-size: 7rem; overflow: auto`), so the
   * rect is what the reader can SEE rather than what the text would need, which
   * is the number the rail wants. Falling back to this element keeps a
   * restructured foot honest: the caption is the row's LAST child, so clearing
   * it clears everything above it too.
   *
   * NOT A DOCUMENT OR WINDOW LISTENER, and disconnected with the property it
   * set: the rule MapCapture's own publisher states and keeps.
   */
  useEffect(() => {
    const el = capRef.current
    if (!compact || el === null || typeof ResizeObserver === 'undefined') return
    const host = el.closest<HTMLElement>('.mtree') ?? document.documentElement
    const box = el.closest<HTMLElement>('.mtree-foot') ?? el
    let last = ''
    const publish = (): void => {
      const size = Math.round(box.getBoundingClientRect().height)
      const next = size > 0 ? `${size}px` : ''
      if (next === last) return
      last = next
      if (next === '') host.style.removeProperty('--map-caption-block-size')
      else host.style.setProperty('--map-caption-block-size', next)
    }
    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(box)
    return () => {
      observer.disconnect()
      host.style.removeProperty('--map-caption-block-size')
    }
  }, [compact])

  return (
    <div className="mtree-cap" ref={capRef}>
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

        </>
      )}

      <p className="mtree-note">
        {summary}
        {busiest !== null && ` ${busiest}`}
        {topGroup !== null && ` ${topGroup}`}
      </p>

      {/* THE RESULT COUNT USED TO BE HERE and is deleted rather than restyled —
          it was `{count} open` beside a sentence that already reads `{count}
          tracks, {open} open, {breached} past deadline.` with the SAME count in
          the `{open}` slot. See this file's header for why the fragment goes and
          the sentence stays. */}

    </div>
  )
}
