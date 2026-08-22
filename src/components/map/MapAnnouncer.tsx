// THE MAP'S TWO INVISIBLE NODES: the description the <svg> points at, and the
// region that speaks what just happened. Nothing here draws a pixel.
//
// ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
//
// Both of these used to live inside `MapSummary`, the caption strip — and when
// the chrome around the picture was quieted to `{false && summaryIsle}`, they
// went out with the legend. That was a taste decision about VISIBLE furniture
// that silently took two things with it which have no visible form at all:
//
//   1. THE PAGE'S ONLY LIVE REGION. `setLive` is called from about twenty
//      places in Mindtree.tsx — every node-menu outcome, every QuickAdd, every
//      stage change, every refused Space, "Collapse all", "Fit to view" — and
//      `live` had exactly ONE consumer. With that consumer unmounted, every one
//      of those sentences was being announced to nobody. The calls all still
//      ran; the state still updated; there was simply no element to speak it.
//
//   2. A DANGLING `aria-describedby`. MapCanvas.tsx points the <svg> at
//      `hintId`, and the element carrying that id was inside the same gate. An
//      `aria-describedby` that resolves to no node is not a degraded
//      description, it is no description — and it fails silently, which is why
//      it survived the commit that caused it.
//
// So the split is along the axis that actually matters: VISIBLE furniture stays
// in `MapSummary` and stays gated off, INVISIBLE contract moves here and mounts
// unconditionally. There is no way to make the second one "disturbing" — the
// complaint that quieted the chrome was about things standing on the picture,
// and `.sr-only` stands on nothing.
//
// ── WHAT IS STILL CONDITIONAL, AND WHY ────────────────────────────────────
//
// `onMap` gates the KEYBOARD CONTRACT only. That sentence describes the
// arrow-key behaviour of the tree widget, and in table view (`?stage=table`)
// that widget is not on the screen — describing it there was a bug the original
// `showMapChrome` branch existed to fix, and dropping the gate would reintroduce
// it. The LIVE REGION has no such gate: it describes the WORKSPACE, and the
// table stage announces through the same `setLive` the map does.

import { type ReactElement } from 'react'
import { t } from '../../lib/i18n'

export interface MapAnnouncerProps {
  /** Map view. Gates the keyboard contract — see this file's header. */
  onMap: boolean
  /** The id the <svg>'s `aria-describedby` points at. */
  hintId: string
  /** The sentence AND its counter — see the region below for why the counter. */
  live: { text: string; seq: number }
}

export default function MapAnnouncer({ onMap, hintId, live }: MapAnnouncerProps): ReactElement {
  return (
    <>
      {/* CARRYING THE ID THE <svg> POINTS AT. sr-only because it is the
          picture's instructions and a sighted user has gestures.

          IT KEEPS ITS ID. MapCanvas's `aria-describedby` resolves to this node;
          renaming it or dropping it from the tree breaks the map's description
          with no visible symptom at all, which is exactly how it broke before.

          TWO SENTENCES, ONE ELEMENT, because `aria-describedby` resolves an id
          to one node and the walk and the tick are one contract: how to move
          around the map, and how to mark several items so they travel together.
          The DRAG's own grammar is a third sentence and lives in DragLayer
          (`controller.hintId`), beside the gesture it describes — the <svg>
          points at both ids. */}
      {onMap && (
        <p className="sr-only" id={hintId}>
          {t('mindtree.keyboardHint')} {t('mindtree.selectHint')}
        </p>
      )}

      {/* polite, not assertive: the filter's own count announces on every
          keystroke through FilterBar, and two assertive regions on one screen
          interrupt each other. */}
      <p className="sr-only" role="status" aria-live="polite">
        {/* KEYED ON A COUNTER, so an identical consecutive sentence is still
            announced. A plain string is a React bail-out when the value has not
            changed, which produces no DOM mutation and therefore no
            announcement — and this region says the same words twice all the
            time: Space on a second item you may not move, "Collapse all"
            pressed twice, "Fit to view" already fitted. `DragLayer`'s own
            region solved this first and states the reason; this is the same
            answer. */}
        <span key={live.seq}>{live.text}</span>
      </p>
    </>
  )
}
