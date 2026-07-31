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
}

/**
 * Memoised because a pan or a zoom re-renders the canvas without changing a
 * single edge: the viewBox moves, the drawing does not. `edge` objects come
 * straight out of the layout memo and are reference-stable between those
 * renders, so the default shallow compare is exactly right here.
 */
export const MindEdge = memo(function MindEdge({ edge, active = false }: MindEdgeProps): ReactElement {
  return (
    <path
      className="mtree-edge"
      d={edgePath(edge)}
      data-depth={edge.depth}
      data-active={active ? '' : undefined}
    />
  )
})

export default MindEdge
