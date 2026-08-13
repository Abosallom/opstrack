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
// So this file was a boundary, not a redesign: the page rendered exactly what it
// rendered before, one component deeper. Moving `pan` and `zoom` down here — so
// that a pointermove stops re-rendering the filter bar, the toolbar and the
// summary — was named here as the change this boundary EXISTS to make possible.
//
// WAVE 9 MADE IT. The camera arrives through `mapCameraContext` instead of
// through four props, and `pages/Mindtree.tsx` holds the filter bar, the toolbar
// and the summary in memos whose dependency lists provably exclude it — see that
// module's header for what the split does and does not buy.
//
// `.mtree-canvas` carries `touch-action: none` and a `block-size: clamp()`; the
// element's identity is load-bearing for the pan gesture and it must not become
// a plain div.

import {
  useMemo,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type RefObject,
} from 'react'
import '../mindtree/mind-ring.css'
import MindEdge from '../mindtree/MindEdge'
import MindNode, { type MindNodePos, type MindNodeView } from '../mindtree/MindNode'
import MindWorldRim from '../mindtree/MindWorldRim'
import { apparentOf, bandBlend, DOM_HORIZON_PX, type Band } from '../../lib/mindtree/lod'
import NodeCard, { NODE_CARD_ID, type NodeCardProps } from '../mindtree/NodeCard'
import PulseLayer, { type PulseLayerProps } from '../mindtree/PulseLayer'
import { MindDropTargets, type MindDragController } from '../mindtree/DragLayer'
import { t } from '../../lib/i18n'
import { reachesCamera, useMapCamera } from '../../pages/map/mapCameraContext'
import type { DrawnLayout, PositionedNode } from '../../lib/mindtree/layout'
import type { MindDimension, MindNode as MindNodeModel } from '../../lib/mindtree/model'
import type { Entry } from '../../types'
import type { Member } from '../../store/members'

/** One wedge on a world's rim, radians, in the layout's already-mirrored space. */
export interface MatchWedge {
  readonly start: number
  readonly end: number
}

/** Shared empty array, so a world with no matches does not remount its rim. */
const EMPTY_WEDGES: readonly MatchWedge[] = Object.freeze([])

export interface MapCanvasProps {
  canvasRef: (el: HTMLDivElement | null) => void
  svgRef: RefObject<SVGSVGElement | null>
  layout: DrawnLayout<MindNodeModel>
  order: readonly MindNodePos[]
  /** Per world: how many marked items are in its subtree. 0 draws no match rim. */
  matchesById: ReadonlyMap<string, number>
  /** Per world: the wedge each marked child occupies, radians, already mirrored. */
  matchWedgesById: ReadonlyMap<string, readonly MatchWedge[]>
  /**
   * ONE NODE'S VIEW MODEL, ON DEMAND — wave 9's 5d.
   *
   * A FUNCTION AND NOT A MAP, because the map cost ~6 `t()` calls per node ×
   * 3,200 nodes on every rebuild and this component draws a couple of hundred of
   * them. `useMapModel` memoises what it hands back, so an id asked for twice is
   * built once and `MindNode`'s `memo()` still sees a stable `view` identity.
   * `undefined` means "no such node", exactly as `Map.get` did.
   */
  getView: (id: string) => MindNodeView | undefined
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
  matchesById,
  matchWedgesById,
  getView,
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
  /**
   * The ring radii and the hub they are struck from — both undefined on the
   * linear layout, in which case no guide is drawn at all.
   *
   * DESTRUCTURED INTO CONSTS rather than read as `layout.rings` at the use
   * site, because the `.map()` callback below is a function boundary: TypeScript
   * keeps a narrowing on a `const` across one and drops a narrowing on a
   * property access.
   */
  const { rings, hub } = layout

  /**
   * THE CAMERA, READ RATHER THAN TAKEN. See `mapCameraContext.tsx`'s header for
   * why it is a context: the three props these four values replaced are what
   * kept the filter bar, the toolbar and the summary re-rendering on every wheel
   * notch, because a subtree that has to LIST them in a memo is a subtree that
   * cannot be memoised.
   */
  const { camera, scale, viewportMinPx, viewBox } = useMapCamera()

  /**
   * WHICH OF THE FIVE DRAWINGS EACH NODE RENDERS, COMPUTED ONCE PER CAMERA.
   *
   * IN A MEMO AND NOT INLINE, and that is the whole reason a pure camera change
   * is cheap: `MindNode` is `memo()`d and `band`/`bandOut` are primitives, so a
   * pan that moves nothing across a band edge re-renders ZERO nodes. Computed
   * inline in the `.map()` it would still be correct and every node would still
   * take a new prop object every frame.
   *
   * A NODE WITH NO WORLD IS `card`, WHICH IS TODAY'S DRAWING. The tidy tree and
   * the ring emit `PositionedNode`s with no `worldD`, so they keep rendering
   * exactly what they rendered before rather than being culled to nothing by an
   * apparent size of zero.
   *
   * ── WAVE 9's 5b, MEASURED AND CUT ──────────────────────────────────────────
   *
   * The design's fourth performance item was to replace this `Map` of 3,200
   * small objects with a `useRef`-held `Uint8Array`/`Float32Array` pair
   * rewritten in place. Benchmarked at both sizes, 400 camera changes each
   * (node 24, this machine):
   *
   *     3,200 nodes   Map 66.5-69.5 µs   typed arrays 12.9-13.1 µs   5.1-5.4x
   *       424 nodes   Map      10.1 µs   typed arrays       1.7 µs   6.0x
   *
   * A five-fold win on a pass that costs 57 µs — 0.34% of a 16.7 ms frame — and
   * that does not run on a PAN at all, because this memo depends on `scale` and
   * not on where the camera is. Against that: a mutable buffer written during
   * render (which React may run twice), a second id→index map for the edge
   * layer, and a band that arrives as a number and has to be turned back into
   * the string `MindNode` takes. The cull above removed ~2,900 SVG elements from
   * the same render; that is the millisecond. So 5b is CUT, with its number, per
   * the plan's own rule for a change that measures as a wash.
   */
  const bands = useMemo(() => {
    const out = new Map<string, { band: Band; out: number; apparent: number }>()
    for (const pos of order) {
      if (pos.worldD === undefined) {
        out.set(pos.id, { band: 'card', out: 0, apparent: Number.POSITIVE_INFINITY })
        continue
      }
      const apparent = apparentOf(pos.worldD, scale)
      const read = bandBlend(apparent, viewportMinPx)
      out.set(pos.id, { band: read.band, out: read.out, apparent })
    }
    return out
  }, [order, scale, viewportMinPx])

  /**
   * WHAT IS ACTUALLY ON SCREEN — wave 9's 5a, and the reason the 400-organization
   * budget in `mapRender.test.tsx` is meetable at all.
   *
   * MEASURED BEFORE: `large @ zoomed-in` emitted 2,953 marks, because the only
   * cull this file had tested APPARENT SIZE — and at that camera all 400
   * organizations are the same size as the one being framed. They were simply
   * somewhere else. Every one of them was an SVG element.
   *
   * ── LEGALITY ───────────────────────────────────────────────────────────────
   *
   * `aria-posinset`/`aria-setsize` come from the MODEL — `pos.siblingCount` and
   * `pos.index`, written by `layout.ts` off the node's parent — so removing a
   * mark from this list cannot renumber the set a screen reader hears. That is
   * asserted, as the SHAPE of the two expressions, in `mapZoomReach.test.tsx`
   * ("leaves aria-posinset and aria-setsize sourced from the MODEL, never from
   * the cull"). The precedent for a mark that is off the `role="tree"` DOM
   * entirely is older than this cull: `grain` and `state` worlds have never been
   * in it, reachable "three other ways: zoom to them, the accessible table, or
   * search". An off-screen world is the same class of thing.
   *
   * The predicate itself is `reachesCamera`, next to the camera it tests
   * against — `mapCameraContext.ts` argues the geometry, including why an
   * ancestor of the framed world cannot be culled by it.
   *
   * ── WHAT IS NEVER CULLED, AND WHY THE LIST IS THIS SHORT ───────────────────
   *
   * `activeId` — the roving tab stop. `useMapCursor`'s `activeId` falls back to
   * `order[0]` when the cursor names a node that is not drawn, so a cull that
   * could take the tab stop would move the reader's place on a pan. It cannot.
   * `currentId` — the node the dive is on. Same argument, one gesture later.
   * Everything else the design listed — the framed world, every ancestor of it,
   * the crumb's whole spine — is kept by the GEOMETRY, because worlds nest and
   * an ancestor contains the camera (see `reachesCamera`).
   *
   * ── THE SEAM THIS WIDENS, NAMED RATHER THAN QUIETLY CROSSED ────────────────
   *
   * `useMapKeyboard`'s header says its `order` "is the CULLED, drawn list", and
   * `pages/Mindtree.tsx` hands it `geo.order` — the LAID-OUT list. That gap is
   * older than this cull (the DOM horizon already opened it: at `zoomed-out` the
   * drawing has held 31 groups against 424 laid-out nodes since wave 1), and
   * this wave deliberately does not close it, because closing it changes what an
   * arrow key does — `reach()` would park-and-fly instead of moving, for every
   * off-screen sibling. What keeps the keyboard whole meanwhile is the keep-list
   * above: the tab stop is never the thing that disappears.
   *
   * ── A SEPARATE MEMO FROM `bands`, DELIBERATELY ─────────────────────────────
   *
   * `bands` depends on `scale` and not on where the camera IS, so a PAN does not
   * rebuild it and no node's `band`/`bandOut` prop changes across one. Folding
   * the frustum test into that memo would have made every pan frame rebuild
   * 3,200 entries to answer a question about which ~200 to draw. This memo
   * allocates one array and one set of the SURVIVORS instead, which is the size
   * that changed.
   */
  const drawn = useMemo(() => {
    const list: MindNodePos[] = []
    const ids = new Set<string>()
    for (const pos of order) {
      if (!reachesCamera(pos, camera) && pos.id !== activeId && pos.id !== currentId) continue
      list.push(pos)
      ids.add(pos.id)
    }
    return { list, ids }
  }, [order, camera, activeId, currentId])

  /**
   * DRAWING UNITS PER CSS PIXEL — the reciprocal of the camera scale, computed
   * ONCE here and handed to every rim.
   *
   * IT IS THE RIM'S NUMBER AND NOTHING ELSE'S. A card is drawn at its own
   * world's scale (MindNode's `scale(cardScale)`), so it needs nothing from the
   * camera at all and stays memo-stable across a zoom; the rim is CHROME and is
   * pinned to the screen, so it needs exactly this. Two rules, each argued
   * where it applies — MindNode.tsx's header and MindWorldRim.tsx's.
   *
   * `scale` is guarded again inside MindWorldRim; the division is written here
   * because this is the one place the camera number lives.
   */
  const unitsPerPx = scale > 0 && Number.isFinite(scale) ? 1 / scale : 1

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
          {/* THE RING GUIDES — one circle per drawn ring, struck from the hub,
              inside the decorative group and BEFORE the edges so a connector
              is never crossed out by the guide it runs through.

              DECORATIVE AND NON-INFORMATIONAL: a node's ring membership is
              already carried by where the node IS, and by `aria-level` for a
              reader who is not looking. Nothing here is knowable only from the
              circles, which is why the group they live in is `aria-hidden` and
              why no locale key was spent on them.

              They are drawn anyway rather than dropped: `mind-ring.css` gives
              them `.mtree-edge`'s own ink, which measures 10.53 / 9.81 against
              the canvas (dark / light) and 8.43 / 9.04 against the most
              elevated surface a node can put behind them — so the house rule
              that every non-text mark clears 3:1 is met outright, and the
              "drop the circles rather than invent a colour" branch in
              MAP-REDESIGN §U3 never had to fire.

              NOTHING AT ALL ON THE LINEAR LAYOUT, which emits no rings. */}
          {rings !== undefined &&
            hub !== undefined &&
            rings.map((radius, depth) =>
              // The hub's own ring has radius 0. It is a point, not a circle,
              // and the pill under it is already the mark for "here".
              radius > 0 ? (
                <circle
                  key={`mring-${depth}`}
                  className="mring-guide"
                  data-depth={depth}
                  cx={hub.x}
                  cy={hub.y}
                  r={radius}
                  fill="none"
                />
              ) : null,
            )}

          {/* A CONNECTOR IS ONLY DRAWN WHERE BOTH ENDS ARE BOXES. Below `chip`
              a spoke is a hairline between two textures and reads as noise; at
              `card` and above it is the honest reading of a ring's structure.
              The `state` band is where it arrives, so that is where it fades. */}
          {layout.edges.map((edge) => {
            // A CONNECTOR TO A MARK THAT IS NOT DRAWN IS A LINE TO NOWHERE. The
            // frustum cull takes the spoke with the node, which is also what
            // keeps the edge layer from being the thing that blows the budget:
            // there are as many edges as there are nodes.
            if (!drawn.ids.has(edge.childId)) return null
            const child = layout.byId.get(edge.childId)
            const read = bands.get(edge.childId)
            const fade =
              read === undefined
                ? 1
                : read.band === 'absent' || read.band === 'grain'
                  ? 0
                  : read.band === 'state'
                    ? read.out
                    : 1
            if (fade <= 0) return null
            return (
              <g key={edge.id} style={child?.node.colourVars}>
                <MindEdge edge={edge} active={edge.childId === currentId} fade={fade} />
              </g>
            )
          })}
        </g>

        {/* THE RIM LAYER, BEFORE THE NODES. SVG has no z-index and paint order
            is document order, so a world's boundary has to be laid down under
            the marks that live inside it. A rim only exists for a world that is
            OPENING (the card dissolving, the boundary arriving) or that IS the
            frame (the boundary leaving as the stage border takes over).

            AND THAT PAINT ORDER IS ALSO A CONTRAST FACT, which is why it is
            restated here rather than left as a layering note: the rim's label
            and its match count are laid down UNDER every node mark, so where a
            descendant's disc meets them the disc is the foreground. No text in
            this drawing is ever composited over the 44% grain/state fill —
            mind-ring.css's matrix carries the measurement and cites this line
            for why the composite does not occur. Move this block after the
            nodes and that certification is void. */}
        {drawn.list.map((pos) => {
          const read = bands.get(pos.id)
          if (read === undefined) return null
          if (read.band !== 'opening' && read.band !== 'frame') return null
          // A NODE WITH NO CHILDREN HAS NO RIM, and this one line is the whole
          // of defect 7 — the double label at zoom-in. `MindNode`'s `holding`
          // branch keeps a terminal card AND its label past 380px, deliberately
          // (an Organization is the only thing on the canvas with nothing
          // beneath it competing for the room). Drawing a rim for it as well
          // put the same name on the card and on the boundary at the same
          // instant, which is the one thing the handoff rule forbids: a name is
          // never absent and NEVER DRAWN TWICE. There is also nothing for such
          // a rim to be the boundary of — the dive stops here.
          if (!pos.hasChildren) return null
          if (pos.worldX === undefined || pos.worldY === undefined || pos.worldD === undefined) {
            return null
          }
          return (
            <MindWorldRim
              key={`rim-${pos.id}`}
              world={{ worldX: pos.worldX, worldY: pos.worldY, worldD: pos.worldD }}
              label={getView(pos.id)?.label ?? ''}
              ink={pos.node.colourVars}
              matches={matchesById.get(pos.id) ?? 0}
              matchWedges={matchWedgesById.get(pos.id) ?? EMPTY_WEDGES}
              rtl={rtl}
              fade={read.band === 'opening' ? read.out : 1 - read.out}
              unitsPerPx={unitsPerPx}
            />
          )
        })}

        {drawn.list.map((pos) => {
          const read = bands.get(pos.id)
          if (read === undefined) return null
          // THE SECOND CULL — the SIZE one, over the survivors of the frustum's.
          // One band deeper than the eye's, so a keyboard walk never waits on a
          // repaint and `aria-posinset` / `aria-setsize` — which come from the
          // MODEL, never from this list — are never renumbered by it.
          if (read.apparent < DOM_HORIZON_PX) return null
          // ASKED AFTER BOTH CULLS, and that ordering IS wave 9's 5d: a view
          // model costs ~6 `t()` calls to build, and the ones nobody is looking
          // at now cost nothing at all.
          const nodeView = getView(pos.id)
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
              band={read.band}
              bandOut={read.out}
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
