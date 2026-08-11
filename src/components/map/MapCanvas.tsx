// THE DRAWING SURFACE — the canvas element, the <svg>, the edges, the nodes,
// the two SVG overlays and the hover card that sits beside them.
//
// Extracted from pages/Mindtree.tsx unchanged, as a RENDER cut: not one piece
// of state moved down with it. `svgRef`, `nodeRefs`, `cursorId`, `treeFocused`,
// `draggedRef` and the `refocusRef`/`layoutRef` pair all stay at page level and
// arrive as props, because the map's four documented entanglements run straight
// through them — `svgRef` alone is read by the pan handlers, by the focus
// repair's `svg.contains(activeElement)`, by the drag layer's pointer→layout
// conversion and by the export, which serialises the LIVE element. Moving one
// consumer to the other side of that ref breaks export or focus repair silently.
//
// So this file is a boundary, not a redesign: the page renders exactly what it
// rendered before, one component deeper. Moving `pan` and `zoom` down here — so
// that a pointermove stops re-rendering the filter bar, the toolbar and the
// summary — is the change this boundary EXISTS to make possible, and it is a
// behavioural change, so it is not made here.
//
// `.mtree-canvas` carries `touch-action: none` and a `block-size: clamp()`; the
// element's identity is load-bearing for the pan gesture and it must not become
// a plain div.

import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement,
  RefObject,
} from 'react'
import MindEdge from '../mindtree/MindEdge'
import MindNode, { type MindNodeView } from '../mindtree/MindNode'
import NodeCard, { NODE_CARD_ID, type NodeCardProps } from '../mindtree/NodeCard'
import PulseLayer, { type PulseLayerProps } from '../mindtree/PulseLayer'
import { MindDropTargets, type MindDragController } from '../mindtree/DragLayer'
import { t } from '../../lib/i18n'
import type { MindtreeLayout, PositionedNode } from '../../lib/mindtree/layout'
import type { MindDimension, MindNode as MindNodeModel } from '../../lib/mindtree/model'
import type { Entry } from '../../types'
import type { Member } from '../../store/members'

export interface MapCanvasProps {
  canvasRef: (el: HTMLDivElement | null) => void
  svgRef: RefObject<SVGSVGElement | null>
  layout: MindtreeLayout<MindNodeModel>
  order: readonly PositionedNode<MindNodeModel>[]
  views: ReadonlyMap<string, MindNodeView>
  viewBox: string
  rtl: boolean
  hintId: string
  dimensionLabel: string
  motion: boolean
  pulses: PulseLayerProps['pulses']
  dragController: MindDragController
  activeId: string | null
  currentId: string | null
  cardPos: PositionedNode<MindNodeModel> | null
  cardAnchor: NodeCardProps['anchor'] | null
  box: NodeCardProps['canvas']
  dragging: boolean
  entryById: ReadonlyMap<string, Entry>
  memberById: ReadonlyMap<string, Member>
  vocabLabel: NodeCardProps['vocabLabel']
  dimension: MindDimension
  today: NodeCardProps['today']
  onActivate: (node: MindNodeModel, event: ReactMouseEvent<SVGGElement>) => void
  onNodeFocus: (id: string) => void
  registerRef: (id: string, el: SVGGElement | null) => void
  onHover: (id: string | null) => void
  onMenu: (pos: PositionedNode<MindNodeModel>, at: { x: number; y: number }) => void
  onTreeFocus: (focused: boolean) => void
  onKeyDown: (event: ReactKeyboardEvent<SVGSVGElement>) => void
  onPointerDown: (event: ReactPointerEvent<SVGSVGElement>) => void
  onPointerMove: (event: ReactPointerEvent<SVGSVGElement>) => void
  onPointerEnd: (event: ReactPointerEvent<SVGSVGElement>) => void
}

export default function MapCanvas({
  canvasRef,
  svgRef,
  layout,
  order,
  views,
  viewBox,
  rtl,
  hintId,
  dimensionLabel,
  motion,
  pulses,
  dragController,
  activeId,
  currentId,
  cardPos,
  cardAnchor,
  box,
  dragging,
  entryById,
  memberById,
  vocabLabel,
  dimension,
  today,
  onActivate,
  onNodeFocus,
  registerRef,
  onHover,
  onMenu,
  onTreeFocus,
  onKeyDown,
  onPointerDown,
  onPointerMove,
  onPointerEnd,
}: MapCanvasProps): ReactElement {
  return (
    <div
      className="mtree-canvas"
      ref={canvasRef}
      // The pointer left the drawing entirely. Without this, walking off the
      // edge of a node and out of the canvas in one motion leaves the last
      // hover published, and the card stays open over a map nobody is
      // pointing at.
      onPointerLeave={() => onHover(null)}
    >
      <svg
        ref={svgRef}
        className="mtree-svg"
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        role="tree"
        // MULTI-SELECTABLE, because entry leaves can be ticked — and the
        // items that can carry `aria-selected` are exactly the ones this
        // promises. MindNode puts the attribute on leaves only.
        aria-multiselectable
        aria-label={t('mindtree.treeLabel', { label: dimensionLabel })}
        // The keyboard contract, POINTED AT rather than left at the bottom
        // of the document for a reader to stumble over after walking the
        // whole map. Two paragraphs now: the tree walk, and the drag layer's
        // own (`controller.hintId`), which is rendered inside MindDragLayer
        // and describes Space, Enter and Escape while something is lifted.
        aria-describedby={`${hintId} ${dragController.hintId}`}
        // THE RELAYOUT TWEEN'S KILL SWITCH, written from
        // `useMindPulses().motion` — false under prefers-reduced-motion and
        // on a map too big to tween honestly. mindtree.css does the rest;
        // see its MOTION paragraph.
        data-motion={motion ? undefined : 'off'}
        tabIndex={-1}
        // React's onFocus/onBlur ARE focusin/focusout — they bubble, unlike
        // the native DOM events of the same name — so these fire when focus
        // lands on any treeitem inside, which is exactly the question asked.
        onFocus={() => onTreeFocus(true)}
        onBlur={() => onTreeFocus(false)}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        {/* Decorative, once, for all of them — see MindEdge.tsx's header.
            Each connector is wrapped in the CHILD's colour pair so a whole
            branch reads as one family; the pair is inherited, never picked. */}
        <g className="mtree-edges" aria-hidden="true">
          {layout.edges.map((edge) => {
            const child = layout.byId.get(edge.childId)
            return (
              <g key={edge.id} style={child?.node.colourVars}>
                <MindEdge edge={edge} active={edge.childId === currentId} />
              </g>
            )
          })}
        </g>

        {order.map((pos) => {
          const nodeView = views.get(pos.id)
          if (nodeView === undefined) return null
          return (
            <MindNode
              key={pos.id}
              pos={pos}
              view={nodeView}
              rtl={rtl}
              focused={pos.id === activeId}
              current={pos.id === currentId}
              onActivate={onActivate}
              onFocus={onNodeFocus}
              registerRef={registerRef}
              onPointerDown={dragController.onNodePointerDown}
              onHover={onHover}
              onMenu={onMenu}
              describedBy={pos.id === cardPos?.id ? NODE_CARD_ID : undefined}
            />
          )
        })}

        {/* BOTH OVERLAYS AFTER THE NODES, because SVG has no z-index and
            paint order is document order. The pulses first and the drop
            targets last: a ring marking a change must not sit over the
            outline saying "this branch will take it", and the two are never
            on screen together anyway — the watch layer is paused for the
            length of every drag. */}
        <PulseLayer layout={layout} pulses={pulses} />
        <MindDropTargets controller={dragController} />
      </svg>

      {/* The hover card, mounted only while there IS a target — which is
          what makes "no delay out, a delay in on first appearance" fall out
          of mounting rather than out of a second timer. Inside the canvas
          and after the <svg>, so it is positioned in the canvas's own CSS
          pixel space, which is what `cardAnchor` converts into. */}
      {cardPos !== null && cardAnchor !== null && (
        <NodeCard
          node={cardPos.node}
          anchor={cardAnchor}
          canvas={box}
          dragging={dragging}
          entryById={entryById}
          memberById={memberById}
          vocabLabel={vocabLabel}
          dimension={dimension}
          today={today}
        />
      )}
    </div>
  )
}
