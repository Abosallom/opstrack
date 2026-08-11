// WHAT THE TOOLBAR'S BUTTONS DO — the five shape controls and the export.
//
// Extracted from pages/Mindtree.tsx unchanged. `components/map/MapToolbar.tsx`
// is the chrome; this is the behaviour behind it, held at page level because
// every one of these needs something the chrome cannot see: the whole tree (the
// two id walks), the persisted focus (the dimension trim), or the LIVE <svg>
// element (the export serialises it, it does not re-render it).

import { useCallback, useMemo, useState } from 'react'
import type { RefObject } from 'react'
import { toast } from '../../components/toast'
import { formatTimestamp } from '../../lib/dates'
import { isFilterEmpty, type FilterState } from '../../lib/entryFilter'
import { t } from '../../lib/i18n'
import { dimensionStableId } from '../../lib/mindtree/focus'
import type { ViewBoxFit } from '../../lib/mindtree/layout'
import {
  MIND_DIMENSIONS,
  type MindDimension,
  type MindNode as MindNodeModel,
} from '../../lib/mindtree/model'
import {
  MINDTREE_MIME,
  copyPngToClipboard,
  downloadBlob,
  mindtreeFilename,
  serializeMindtreeSvg,
  svgToPngBlob,
} from '../../lib/mindtree/export'
import {
  collapseMindAll,
  expandMindAll,
  setMindDensity,
  setMindDimension,
  setMindFocus,
  setMindView,
  type MindtreeView,
} from '../../store/mindtree'

export interface MapToolbarActionsOptions {
  tree: MindNodeModel
  focusPref: string | null
  density: 'compact' | 'comfortable'
  filter: FilterState
  rtl: boolean
  locale: string
  svgRef: RefObject<SVGSVGElement | null>
  wholeMapFit: ViewBoxFit
  summary: string
  busiest: string | null
  topGroup: string | null
  setLive: (text: string) => void
}

export function useMapToolbarActions({
  tree,
  focusPref,
  density,
  filter,
  rtl,
  locale,
  svgRef,
  wholeMapFit,
  summary,
  busiest,
  topGroup,
  setLive,
}: MapToolbarActionsOptions) {
  const [exporting, setExporting] = useState(false)

  const branchIds = useMemo(() => {
    const ids: string[] = []
    const walk = (node: MindNodeModel): void => {
      for (const child of node.children) {
        if (child.children.length > 0 && child.kind !== 'more') ids.push(child.id)
        walk(child)
      }
    }
    walk(tree)
    return ids
  }, [tree])

  const foldIds = useMemo(() => {
    const ids: string[] = []
    const walk = (node: MindNodeModel): void => {
      for (const child of node.children) {
        if (child.kind === 'more') ids.push(child.id)
        walk(child)
      }
    }
    walk(tree)
    return ids
  }, [tree])

  const expandAll = useCallback(() => {
    // BRANCHES AS WELL AS FOLDS. Clearing `collapsed` alone was enough while
    // every branch opened by default; with `OPEN_DEPTH` closing the track ring,
    // "Expand all" has to name what it opens or it opens nothing.
    expandMindAll([...branchIds, ...foldIds])
    setLive(t('mindtree.expandedAll'))
  }, [branchIds, foldIds, setLive])

  const collapseAll = useCallback(() => {
    collapseMindAll(branchIds)
    setLive(t('mindtree.collapsedAll'))
  }, [branchIds, setLive])

  const chooseDimension = useCallback(
    (next: MindDimension) => {
      setMindDimension(next)
      // THE FOCUS IS TRIMMED, NOT DROPPED. A `group:` segment is spelled from the
      // axis, so every drill-in below ring 1 names a bucket that does not exist on
      // the new one — but ring 1 is tracks and survives any axis. Clearing to null
      // and clearing to the track prefix are NOT the same answer: they differ by
      // exactly one ring, and focus.ts's header names the wrong one out loud
      // ("rather than on a blank screen or back at the top of the map"). Drilling
      // into SRE › Aziz and flipping the axis to see status used to throw the
      // reader back across all five tracks with no breadcrumb and no sentence.
      //
      // Trimming here rather than leaning on `resolveFocus`'s fallback also keeps
      // the change SILENT: the fallback reports itself in `missingId`, and being
      // told "that branch is no longer here" about a change you just asked for
      // reads as an error. `dimensionStableId` is the pure trim.
      setMindFocus(dimensionStableId(focusPref))
      setLive(
        t('mindtree.groupChanged', {
          label: t(MIND_DIMENSIONS.find((d) => d.key === next)?.labelKey ?? 'mindtree.dimStatus'),
        }),
      )
    },
    [focusPref, setLive],
  )

  const chooseView = useCallback(
    (next: MindtreeView) => {
      setMindView(next)
      // The whole content region is swapped — a role="tree" for a <table> — and
      // every other state change on this screen announces. The toggle's own label
      // flips while it holds focus, which screen readers do not reliably re-read.
      setLive(
        t('mindtree.viewChanged', {
          label: next === 'table' ? t('mindtree.tableLabel') : t('mindtree.title'),
        }),
      )
    },
    [setLive],
  )

  const chooseDensity = useCallback(() => {
    const next = density === 'compact' ? 'comfortable' : 'compact'
    setMindDensity(next)
    setLive(
      t('mindtree.densityChanged', {
        label: t(next === 'compact' ? 'mindtree.densityCompact' : 'mindtree.densityComfortable'),
      }),
    )
  }, [density, setLive])

  /* ── export ───────────────────────────────────────────────────────────── */

  const runExport = useCallback(
    (mode: 'svg' | 'png' | 'copy') => {
      const svg = svgRef.current
      if (svg === null || exporting) return
      setExporting(true)

      const finish = (): void => setExporting(false)

      // An async IIFE with its own catch, `void`-ed at the call site: every
      // path settles, and there is no floating promise for the runtime to
      // report as unhandled.
      void (async (): Promise<void> => {
        try {
          const at = new Date()
          const file = serializeMindtreeSvg(svg, {
            title: t('mindtree.title'),
            desc: [summary, busiest, topGroup].filter((s): s is string => s !== null).join(' '),
            direction: rtl ? 'rtl' : 'ltr',
            // THE WHOLE MAP, NOT THE CURRENT WINDOW. The live viewBox is the
            // reader's zoom and pan, and a large map is only readable zoomed —
            // so the previous behaviour was to export a crop of exactly the
            // picture the reader had just magnified in order to read it.
            viewBox: wholeMapFit.viewBox,
            // PAINTED, not just <title>/<desc>. Metadata is invisible the
            // moment the picture is on a slide, and an unlabelled, undated,
            // silently-filtered diagram in a steering deck is a claim its
            // audience cannot check.
            caption: {
              heading: `${t('app.name')} — ${t('mindtree.title')}`,
              lines: [
                t('mindtree.exportCaptionAt', { at: formatTimestamp(at.toISOString(), locale) }),
                [summary, busiest, topGroup].filter((s): s is string => s !== null).join(' '),
                ...(isFilterEmpty(filter) ? [] : [t('mindtree.exportCaptionFiltered')]),
              ],
            },
          })

          if (mode === 'svg') {
            const name = mindtreeFilename('svg', at)
            downloadBlob(new Blob([file.document], { type: MINDTREE_MIME.svg }), name)
            toast(t('mindtree.downloadedToast', { name }))
            return
          }

          const blob = await svgToPngBlob(file.document, {
            width: file.width,
            height: file.height,
          })

          if (mode === 'png') {
            const name = mindtreeFilename('png', at)
            downloadBlob(blob, name)
            toast(t('mindtree.downloadedToast', { name }))
            return
          }

          try {
            await copyPngToClipboard(blob)
            toast(t('mindtree.copiedToast'))
          } catch {
            // Firefox has no image ClipboardItem, and Safari rejects a write
            // that did not originate in the gesture — which this one, having
            // awaited a raster, no longer does. Neither is a bug and both have
            // the same answer: offer the file instead.
            toast(t('mindtree.errCopy'))
          }
        } catch {
          toast(t('mindtree.errExport'))
        } finally {
          finish()
        }
      })()
    },
    [exporting, summary, busiest, topGroup, rtl, locale, filter, wholeMapFit, svgRef],
  )

  return {
    expandAll,
    collapseAll,
    chooseDimension,
    chooseView,
    chooseDensity,
    exporting,
    runExport,
  }
}
