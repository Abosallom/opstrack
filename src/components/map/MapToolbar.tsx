// THE TOOLBAR — the group-by chips, the map ⇄ table toggle, the shape controls,
// the zoom and the export disclosure.
//
// Extracted from pages/Mindtree.tsx unchanged. Every prop is a scalar or a
// stable callback and nothing here touches a ref except the export `<details>`'s
// own, which came down with it because the element and the two document
// listeners that make it dismissible are one thing.
//
// THE ACTIONS THEMSELVES stay at page level (pages/map/useMapToolbar.ts): the
// two "expand/collapse all" walks need the whole tree, the dimension trim needs
// the persisted focus, and the export serialises the LIVE <svg>. What this file
// owns is the chrome.

import { useEffect, useRef, type ReactElement } from 'react'
import { t } from '../../lib/i18n'
import { MIND_DIMENSIONS, type MindDimension } from '../../lib/mindtree/model'
import type { MindtreeView } from '../../store/mindtree'

export interface MapToolbarProps {
  dimension: MindDimension
  onDimension: (next: MindDimension) => void
  /**
   * READ ONLY, and there is no `onView` beside it any more.
   *
   * The map⇄ledger switch moved to `MapLensBar`, which owns the STAGE — this
   * bar rendered a second `View: Map | Table` pair that wrote the same store
   * value. Two controls telling one fact cannot disagree, but they can confuse,
   * and only one of them can sit next to the lens chips that decide the rest of
   * what is on screen. This prop stays because the bar still has to know which
   * of its own groups apply: zoom, expand/collapse and the export menu are
   * about a picture and mean nothing over a table.
   */
  view: MindtreeView
  compact: boolean
  density: 'compact' | 'comfortable'
  onDensity: () => void
  onExpandAll: () => void
  onCollapseAll: () => void
  zoomPercent: number
  zoomStep: number
  onZoom: (factor: number) => void
  onFit: () => void
  exporting: boolean
  onExport: (mode: 'svg' | 'png' | 'copy') => void
}

export default function MapToolbar({
  dimension,
  onDimension,
  view,
  compact,
  density,
  onDensity,
  onExpandAll,
  onCollapseAll,
  zoomPercent,
  zoomStep,
  onZoom,
  onFit,
  exporting,
  onExport,
}: MapToolbarProps): ReactElement {
  const exportRef = useRef<HTMLDetailsElement | null>(null)

  /**
   * ESCAPE AND LIGHT-DISMISS FOR THE EXPORT PANEL, because `<details>` provides
   * NEITHER.
   *
   * The first cut chose a `<details>` on the stated grounds that it "gets the
   * disclosure semantics, Escape-to-close and the button role from the
   * platform". Two of those three are true. Only `<dialog>` and the `popover`
   * attribute get Escape and outside-click from the platform; a `<details>`
   * that has been opened stays open forever, and this one is an absolutely
   * positioned panel sitting over the toolbar it was opened from.
   *
   * `<details>` is still the right element — it is a disclosure, not a dialog,
   * and it must not trap focus or make the map inert. So the two behaviours are
   * added rather than the element being swapped, and focus is returned to the
   * summary on Escape, which is the half a naive `el.open = false` gets wrong.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      const el = exportRef.current
      if (el === null || !el.open) return
      el.open = false
      el.querySelector<HTMLElement>('summary')?.focus()
    }
    // pointerdown, not click: a pointer that goes down outside the panel is
    // already a dismissal, and waiting for the click lets a drag that started
    // on the canvas pan the map underneath an open menu.
    const onDown = (event: PointerEvent): void => {
      const el = exportRef.current
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

  return (
    <div className="mtree-bar">
      <div className="mtree-bar-group" role="group" aria-label={t('mindtree.groupBy')}>
        <span className="mtree-bar-label" id="mtree-groupby">
          {t('mindtree.groupBy')}
        </span>
        <div className="chip-row" role="group" aria-labelledby="mtree-groupby">
          {MIND_DIMENSIONS.map((d) => (
            <button
              key={d.key}
              type="button"
              className="chip"
              aria-pressed={dimension === d.key}
              onClick={() => onDimension(d.key)}
            >
              {t(d.labelKey)}
            </button>
          ))}
        </div>
      </div>

      <div className="mtree-bar-group">
        {view === 'map' && (
          <>
            {/* Absent on a phone: one ring is drawn at a time there, so there
                is nothing for either of these to open or close. */}
            {!compact && (
              <>
                <button type="button" className="btn btn-sm btn-ghost" onClick={onExpandAll}>
                  {t('mindtree.expandAll')}
                </button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={onCollapseAll}>
                  {t('mindtree.collapseAll')}
                </button>
                {/* A toggle rather than a slider or a third value: `compact`
                    is what fits a nine-track workspace on a laptop and
                    `comfortable` is what keeps a card comfortable to read.
                    `aria-pressed` because it is a state, not a navigation —
                    and the label names the state it would MOVE to, which is
                    what the pressed attribute is for. Absent on a phone,
                    where the node size is not a preference at all. */}
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  aria-pressed={density === 'compact'}
                  onClick={onDensity}
                >
                  {t('mindtree.densityCompact')}
                </button>
              </>
            )}
            <button
              type="button"
              className="btn btn-sm btn-icon"
              aria-label={t('mindtree.zoomOut')}
              onClick={() => onZoom(1 / zoomStep)}
            >
              −
            </button>
            <span className="mtree-zoom tabular" aria-live="off">
              {t('mindtree.zoomLevel', { pct: zoomPercent })}
            </span>
            <button
              type="button"
              className="btn btn-sm btn-icon"
              aria-label={t('mindtree.zoomIn')}
              onClick={() => onZoom(zoomStep)}
            >
              +
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={onFit}>
              {t('mindtree.fit')}
            </button>

            {/* A <details> rather than a hand-rolled popover: it is a
                disclosure, not a dialog — it must not trap focus or make the
                map inert — and it gets the open/closed semantics and the
                button role from the platform. Escape and light-dismiss are
                NOT among them and are added in the effect above. */}
            <details className="mtree-export" ref={exportRef}>
              <summary className="btn btn-sm">{t('mindtree.export')}</summary>
              <div className="mtree-export-menu">
                <p className="mtree-export-hint">{t('mindtree.exportHint')}</p>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={exporting}
                  onClick={() => onExport('svg')}
                >
                  {t('mindtree.exportSvg')}
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={exporting}
                  onClick={() => onExport('png')}
                >
                  {t('mindtree.exportPng')}
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  disabled={exporting}
                  onClick={() => onExport('copy')}
                >
                  {t('mindtree.copyImage')}
                </button>
                {exporting && <p className="mtree-export-hint">{t('mindtree.exporting')}</p>}
              </div>
            </details>
          </>
        )}
      </div>
    </div>
  )
}
