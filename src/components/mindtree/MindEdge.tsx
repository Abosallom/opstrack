// One connector between a parent node and a child.
//
// A whole file for eleven lines of JSX, and it earns it three times over.
//
// 1. THE GEOMETRY IS NOT HERE. `lib/mindtree/layout.ts` already resolved the
//    four points — post-mirror, so RTL is drawn, not computed — and exports
//    `edgePath()` so the on-screen connector, the exported SVG and the PNG
//    raster all draw the identical curve from the identical numbers. A
//    component that built its own `d` string would be a second implementation
//    of the same curve, and the two would drift the first time somebody tuned
//    the handles.
//
// 2. IT IS DECORATIVE, AND SAYING SO ONCE IS WORTH A FILE. Every edge is inside
//    an `aria-hidden` group: the tree relationship is already carried by
//    `role="tree"` + `aria-level` + `aria-expanded` on the nodes, and a screen
//    reader that also announced 400 unnamed paths would bury it. This is the
//    one place that decision is written down.
//
// 3. THE DEPTH RIDES ALONG AS DATA, NOT AS A COLOUR. `data-depth` lets
//    mindtree.css fade the deeper rings so the eye reads the trunk first, in
//    CSS, where the theme can re-cascade it. There is no colour in this file
//    and there must not be one — an edge inherits its branch's
//    `--track-color` from the group it is rendered inside.

import { memo, type ReactElement } from 'react'
import { edgePath, type MindtreeEdge } from '../../lib/mindtree/layout'

export interface MindEdgeProps {
  edge: MindtreeEdge
  /**
   * The connector into the branch the reader is currently walking. Drawn a
   * touch stronger — one visual variable spent on "where am I", which the map's
   * two-variable budget (size for count, a mark for the breach) does not cover
   * because it is about the CURSOR rather than about the data.
   */
  active?: boolean
  /**
   * The connector's own opacity, 0..1 — the band cross-fade, handed down from
   * `lod.bandBlend` by the page, defaulting to a fully drawn edge.
   *
   * A CONNECTOR IS ONLY WORTH DRAWING WHERE THE THINGS IT CONNECTS ARE BOXES.
   * Below CHIP a node is a grain on a ring inside its parent's world, and
   * containment has ALREADY said which parent it belongs to — far more plainly
   * than a line could, because the line would have to cross every sibling to get
   * there. So the page fades connectors out as their child drops below CHIP and
   * this component draws nothing at all at 0: a fully transparent path is ink at
   * a ratio nobody measured, and it is one more thing for the rasteriser to walk
   * on every frame of a pinch.
   *
   * IT IS NEVER A RESTING HALF-VALUE. Like every other fade in this drawing it
   * resolves inside 0.3 octaves of apparent size, so an edge at rest is either
   * fully drawn — at the 6.06 / 5.53 mindtree.css measured — or absent.
   */
  fade?: number
}

/**
 * Memoised because a pan or a zoom re-renders the canvas without changing a
 * single edge: the viewBox moves, the drawing does not. `edge` objects come
 * straight out of the layout memo and are reference-stable between those
 * renders, so the default shallow compare is exactly right here.
 */
export const MindEdge = memo(function MindEdge({
  edge,
  active = false,
  fade = 1,
}: MindEdgeProps): ReactElement | null {
  if (!(fade > 0)) return null
  return (
    <path
      className="mtree-edge"
      d={edgePath(edge)}
      data-depth={edge.depth}
      data-active={active ? '' : undefined}
      opacity={fade >= 1 ? undefined : fade}
    />
  )
})

export default MindEdge
