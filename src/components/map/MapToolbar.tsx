// THE GROUP-BY MENU — ONE target where there were four, at every width.
//
// WHAT LEFT, AND WHERE IT WENT. This file used to be the map's whole toolbar
// row: four group-by chips, Expand all, Collapse all, Compact, three zoom
// controls, Fit, and the export disclosure — twelve controls in one line of
// chrome above a canvas that then started 54% of the way down a 900px viewport.
//   · Expand all / Collapse all / Zoom − / "Zoom 100%" / Zoom + / Fit
//     -> `MapDiveRail`. One continuous control, and Fit is its zero rung. The
//        two batch verbs are not replaced, they are RETIRED: every child is
//        already in the drawing, waiting at its own distance, so there is no
//        fold to open. `useMapToolbar` keeps both exported for the node menu and
//        the table stage, which still mean something by them.
//   · Compact -> DELETED. The LOD bands are absolute CSS pixels, so density is a
//     camera position now rather than a preference. The store value survives for
//     the linear/table path.
//   · The export <details> -> MapModeBar, which is where the two things that
//     leave the map already live.
//
// ── AND NOW THE FOUR CHIPS COLLAPSE AT EVERY WIDTH, WHICH REVERSES THIS
//    FILE'S OWN EARLIER ARGUMENT. THE REVERSAL IS DELIBERATE. ──────────────
//
// What this file used to say, and it was a good argument: `lib/mindtree/
// dropRules.ts` writes A DIFFERENT PATCH PER DIMENSION — a drag onto a status
// ring sets the status, onto an owner ring reassigns — so the row is the map's
// MODE SELECTOR FOR EDITING, and a mode selector is the last control you bury.
// A comparison sweep costs 3 taps with the chips out and 6 with them in a menu.
//
// All of that is still true and it is now OUTWEIGHED, for a reason that is a
// measurement rather than a preference. The unit's budget is 12 persistent
// targets on a canvas the reader is trying to read; four chips is a third of it
// spent on a control whose own case is "a comparison sweep costs three taps
// instead of six". The summary NAMES THE ACTIVE DIMENSION, so the mode is not
// invisible — which was the actual failure mode the argument was defending
// against — and the sweep is three extra taps, not a lost capability.
//
// So the phone path is not a phone path any more: it is THE path, and the
// desktop's `.chip-row` is deleted. The compact flag survives only as a
// placement hint on the wrapper, so the shell can put the summary where the
// width allows without this file growing a second breakpoint.
//
// THE `GROUP BY` LABEL IS DELETED, AND THAT IS A WIRING CHANGE RATHER THAN A CSS
// ONE. The `.mtree-bar-label` span carried `id="mtree-groupby"` and the chip row
// pointed at it with `aria-labelledby`. Deleting the span alone would have left
// the group silently nameless — an `aria-labelledby` pointing at nothing
// contributes NO name, it does not fall back. So the group takes the same words
// as a direct `aria-label` from the same key, and `mindtree.groupBy` is NOT
// retired.
//
// THE ACTIONS THEMSELVES stay at page level (pages/map/useMapToolbar.ts): the
// dimension trim needs the persisted focus. What this file owns is the chrome.

import { useEffect, useRef, type ReactElement } from 'react'
import { t } from '../../lib/i18n'
import { MIND_DIMENSIONS, type MindDimension } from '../../lib/mindtree/model'
import './map-altitude.css'

export interface MapToolbarProps {
  dimension: MindDimension
  onDimension: (next: MindDimension) => void
  /**
   * Placement only. The CONTROL is the same object at every width now; this
   * decides where the shell's sheet puts it, from the shell's ONE reading of
   * `(max-width: 767px)` rather than a second breakpoint in CSS that could
   * disagree with it — MapLensBar, MapModeBar and MapPanel take the same value
   * from the same place.
   */
  compact: boolean
}

export default function MapToolbar({
  dimension,
  onDimension,
  compact,
}: MapToolbarProps): ReactElement {
  const menuRef = useRef<HTMLDetailsElement | null>(null)

  /**
   * ESCAPE AND LIGHT-DISMISS, because `<details>` provides NEITHER — the same
   * two behaviours, added the same way, that the export disclosure has carried
   * since it lived in this file. Only `<dialog>` and the `popover` attribute get
   * them from the platform; an opened `<details>` stays open forever, and this
   * one floats over a map the reader is about to pan. Focus returns to the
   * summary on Escape, which is the half a bare `el.open = false` gets wrong.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      const el = menuRef.current
      if (el === null || !el.open) return
      el.open = false
      el.querySelector<HTMLElement>('summary')?.focus()
    }
    // pointerdown, not click: a pointer that goes down outside the panel is
    // already a dismissal, and waiting for the click lets a drag that started on
    // the canvas pan the map underneath an open menu.
    const onDown = (event: PointerEvent): void => {
      const el = menuRef.current
      if (el === null || !el.open) return
      if (event.target instanceof Node && el.contains(event.target)) return
      el.open = false
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [])

  const active = MIND_DIMENSIONS.find((d) => d.key === dimension) ?? MIND_DIMENSIONS[0]

  return (
    <div className="mtree-bar" data-compact={compact ? '' : undefined}>
      <details className="malt-menu" ref={menuRef}>
        {/* The summary NAMES THE ACTIVE DIMENSION rather than saying "Group by":
            a collapsed mode selector that does not say which mode it is in has
            made the mode invisible, which is worse than the row it replaced. */}
        <summary className="malt-current tap-44">
          {t('mindtree.groupByCurrent', { label: t(active.labelKey) })}
        </summary>
        <div className="malt-pop" role="group" aria-label={t('mindtree.groupBy')}>
          {MIND_DIMENSIONS.map((d) => (
            <button
              key={d.key}
              type="button"
              className="malt-stop tap-44"
              aria-pressed={dimension === d.key}
              onClick={() => {
                const el = menuRef.current
                if (el !== null) el.open = false
                onDimension(d.key)
              }}
            >
              {t(d.labelKey)}
            </button>
          ))}
        </div>
      </details>
    </div>
  )
}
