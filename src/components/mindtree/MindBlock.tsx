// One parent's block container — the rounded rectangle that holds everything
// beneath a card, and the single stub that joins the card to it.
//
// A WHOLE FILE FOR TWO SHAPES, and it earns it for the three reasons
// MindEdge.tsx earns its own, restated about the mark that replaces it.
//
// 1. THE GEOMETRY IS NOT HERE. `lib/mindtree/blocks.ts` resolved the rectangle,
//    its corner radius and the stub's two points — post-mirror, so RTL is drawn
//    and not computed — and this component turns them into marks. A component
//    that inflated its own bounds would be a second implementation of the
//    padding ladder, and the two would drift the first time somebody tuned it.
//
// 2. IT IS DECORATIVE, AND SAYING SO ONCE IS WORTH A FILE. A container carries
//    no fact a reader cannot already get: the tree relationship is on the nodes
//    (`role="tree"` + `aria-level` + `aria-expanded`), and a screen reader that
//    also announced a hundred and fifty unnamed rectangles would bury it. So
//    every container lives inside `MapCanvas`'s `aria-hidden` group and carries
//    nothing of its own. This is the one place that decision is written down.
//
// 3. THE DEPTH RIDES ALONG AS DATA, NOT AS A COLOUR OR AN OPACITY. `data-depth`
//    lets `mindtree.css` thin the border on the inner containers so the eye
//    reads the outermost boundary first — by WIDTH, which is that sheet's
//    standing rule and the reason the connectors it replaces were never faded.
//    There is no colour in this file and there must not be one: a container
//    inherits its branch's `--track-c-*` pair from the group it is rendered
//    inside, exactly as an edge did.
//
// THE STUB IS DRAWN AFTER THE RECTANGLE, and the order is load-bearing rather
// than incidental: the stub lands ON the container's face, and a rectangle
// painted over it would clip the last unit of the only mark that says which
// card this container belongs to.

import { memo, type CSSProperties, type ReactElement } from 'react'
import type { MindBlock as MindBlockGeometry } from '../../lib/mindtree/blocks'

export interface MindBlockProps {
  block: MindBlockGeometry
  /**
   * The branch's colour pair (`node.colourVars`), from the PARENT — the node
   * whose descendants this contains. A container is that node's territory, so
   * it takes that node's hue, which is also the hue every card inside it
   * carries: a whole subtree then reads as one family, which is the property
   * the per-child connectors had and the thing that must survive their removal.
   */
  ink?: CSSProperties
}

/**
 * Memoised, and the comparison that matters is the default one: `block` comes
 * out of the layout memo in `MapCanvas` and is reference-stable across a pan or
 * a zoom, so moving the camera re-renders zero containers. Without this, every
 * frame of a drag would rebuild a hundred and fifty rectangles that did not
 * move.
 */
export const MindBlock = memo(function MindBlock({ block, ink }: MindBlockProps): ReactElement {
  return (
    <g className="mtree-block" style={ink} data-depth={block.depth}>
      <rect
        className="mtree-block-box"
        x={block.x}
        y={block.y}
        width={block.width}
        height={block.height}
        rx={block.rx}
        // STATED EXPLICITLY, so it does not default to `rx`. It happens to be
        // the same number here, and MindNode.tsx's pill learned the hard way
        // that leaving `ry` implicit is one attribute away from an ellipse the
        // day somebody makes the radius a function of the box.
        ry={block.rx}
      />
      {block.stub !== null && (
        <path
          className="mtree-block-stub"
          d={`M ${block.stub.x1} ${block.stub.y1} L ${block.stub.x2} ${block.stub.y2}`}
        />
      )}
    </g>
  )
})

export default MindBlock
