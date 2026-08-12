// WHAT THE MAP'S BUTTONS DO — the group-by trim, the two id walks, and the
// export.
//
// Extracted from pages/Mindtree.tsx unchanged. `components/map/MapToolbar.tsx`
// is the chrome; this is the behaviour behind it, held at page level because
// every one of these needs something the chrome cannot see: the whole tree (the
// two id walks), the persisted focus (the dimension trim), or the LIVE <svg>
// element (the export serialises it, it does not re-render it).
//
// THREE OF THESE NOW HAVE NO CONTROL, AND THEY STAY ANYWAY — AND KEEPING THEM
// IS THE FAILURE MODE THIS UNIT WAS WARNED ABOUT, NOT AN OVERSIGHT.
//
// The toolbar is now ONE group-by menu. `Expand all`, `Collapse all` and the
// `Compact` density toggle are rendered by nothing, and each was cut with a
// mechanism named against it rather than on taste:
//
//   · Expand all / Collapse all — every child is already in the drawing, waiting
//     at its own distance (docs/MAP-ZOOM.md §2: the geometry is a pure function
//     of the department tree, laid out once at full depth). There is no fold to
//     open. A button meaning "make the drawing as large as it can possibly be"
//     is also the one thing a depth cap exists to prevent.
//   · Compact — the LOD bands are absolute CSS pixels, so density is a CAMERA
//     POSITION now rather than a preference.
//
// DELETING THE FUNCTIONS WOULD LOOK LIKE TIDYING AND WOULD COST THREE THINGS
// THAT ARE NOT FREE. `expandMindAll`/`collapseMindAll` would lose their only
// typed caller — and the node menu and the table stage still mean something by
// both verbs. The `mindtree.expandedAll`/`collapsedAll`/`densityChanged`
// announcements would stop being reachable and would have to be re-added as
// orphan keys. And the density VALUE is still LIVE: `useMapGeometry` reads it
// for the node box on the linear/table path, and `MindtreeTable` reads the MODEL
// rather than the geometry, so it keeps its own node box at every camera
// position. The functions are cheap, they are correct, and the surface that
// offers them again — a command palette, a keyboard verb — is a call site away
// rather than a rewrite away.
//
// `zoomPercent` IS THE SAME KIND OF SURVIVAL, one file over. It is no longer a
// readout on any screen and `useMapGeometry` still returns it, because
// `runExport` below prints it in the caption: that is a fact about a FILE — the
// scale the picture in a steering deck was taken at — and not a control.
//
// `runExport` MOVED HOUSE WITHOUT MOVING FILE. The export disclosure it drives
// is `MapModeBar`'s now rather than `MapToolbar`'s, which changes nothing here:
// this hook was always the behaviour and never the markup, and it still needs
// the live <svg>, the whole-map fit and the three summary sentences that only
// the composition holds.
//
// THE MAP⇄TABLE SWITCH IS NOT HERE ANY MORE and must not come back. The collapse
// moved it onto MapLensBar's stage group, so `useMapLens.setStage` is now the
// single writer of `view` from the chrome — and it announces the swap on the
// page's polite region exactly as the toolbar's `chooseView` used to, which is
// why deleting that function cost a screen reader nothing. MapToolbar still
// READS `view` (it hides the shape controls the table has no use for) and has no
// `onView` beside it; a second writer here would let the chip bar and the canvas
// disagree about what the screen is.

import { useCallback, useMemo, useState } from 'react'
import type { RefObject } from 'react'
import { toast } from '../../components/toast'
import { formatTimestamp } from '../../lib/dates'
import { isFilterEmpty, type FilterState } from '../../lib/entryFilter'
import { t, type Locale } from '../../lib/i18n'
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
} from '../../store/mindtree'

export interface MapToolbarActionsOptions {
  tree: MindNodeModel
  focusPref: string | null
  density: 'compact' | 'comfortable'
  filter: FilterState
  rtl: boolean
  locale: Locale
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
    chooseDensity,
    exporting,
    runExport,
  }
}
