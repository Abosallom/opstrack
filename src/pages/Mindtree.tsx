// THE MAP SHELL — one route, one screen, and every surface the product has.
//
// It began as the map alone. It is now the app: a LENS is one chip that sets a
// STAGE (what draws where the canvas is) and a PANEL SUBJECT (what works beside
// it) together, and the five lenses replace five tabs — /followups, /mindtree,
// /board, /notifications, /dashboard. The finding the whole collapse rests on is
// that the map is the thing its owner SHOWS people and the panel is the thing he
// WORKS in, so the daily job does not go on the canvas: a real-DOM list sits
// BESIDE it, in one shell, at one URL.
//
//   STAGE     map | board | numbers | table        PANEL   needsMe | branch |
//                                                          changes | numbers
//   COMPOSER  MapCapture — always mounted, never remounted
//
// THE SCREEN IS A STAGE, NOT A DOCUMENT COLUMN. It was measured at 1600×900
// before this rewrite: three stacked rows of chrome — a title, a filter bar, a
// lens row and a toolbar row — pushed the canvas to 54% down the viewport and a
// docked rail took a quarter of what was left, so the drawing got 0.47M px² of a
// 1.44M px² screen. At 375×812 it was worse than bad, it was ABSENT: the sheet
// opens at `full` for `needs-me`, and the lens chips it was supposed to leave
// visible were the THIRD block in this page's flow, ~380px below the fold under
// a fixed sheet. A screen called Mindtree that showed no tree.
//
// So `.mtree` is now a fixed grid — `100dvh` minus the app header — with ONE
// in-flow column of stage, caption and composer, and the whole of the chrome
// lifted out of the flow into FOUR FLOATING ISLANDS over the picture:
//
//   top-start     the filter rail — search · Mine · Filter (n)
//   top-end       the lens chips · Meetings · the export menu
//   canvas-start  the group-by chips · the drill-in trail
//   canvas-end    the altitude ladder — four stops · Fit · Table
//
// FLOATING CHROME OVER A CANVAS IS A HIT-TESTING AND FOCUS-ORDER HAZARD the old
// column did not have, and it is handled rather than hoped away. `.mtree-isles`
// is one `inset: 0` layer at `pointer-events: none` and every island inside it
// turns pointers back on for itself, so the canvas underneath keeps every press
// that is not on a control. And because visual order and DOM order now diverge,
// the DOM order is islands-then-canvas-then-panel-then-composer, which makes the
// Tab order search → Mine → Filter → lens chips → Meetings → export → group-by →
// ladder → the tree's ONE stop → the panel → the composer. That order is
// ASSERTED in MindtreeShell.test.ts rather than inherited from a layout.
//
// THE PHONE IS THE SAME IDEA WITH THE ROWS SWAPPED. `.mtree` is a `100dvh` grid
// of `auto | 1fr | auto`, so the canvas is the largest region on the screen BY
// CONSTRUCTION rather than by a `clamp()` a scroll position can defeat, and
// `.mtree-shellbar` — the lens rail — leaves the flow for `position: fixed` at
// z-index 71, ONE ABOVE the sheet's 70, in the thumb zone. That is the entire
// fix for "no way back to the map": the sheet may own the screen and the five
// destinations are still one tap away, always.
//
// THE PANEL IS A SIBLING OF THE CANVAS, NEVER A CHILD. `.mtree-canvas` is
// `overflow: hidden; touch-action: none`, and `touch-action` intersects DOWN the
// ancestor chain — a list rendered inside the canvas cannot be scrolled with a
// finger, silently, on the device this shell is for. `.mpan-split` keeps them
// apart. The composer is a sibling too, and outside the `<svg>` subtree, so the
// map's React `onKeyDown` never sees a keystroke meant for the box.
//
// THE PANEL SUBJECT IS SWITCHED ON IN EXACTLY ONE PLACE — `panelFor` below. A
// closed union with no `default:` is what stops a sixth panel kind ever shipping
// half-wired.
//
// /tracks answered "what is open, and who has it?" — a working list. The map
// answers the question an ops lead asks in the ninety seconds before a steering
// meeting: WHERE IS THE MASS. Which track is bloated, who is carrying it, what
// has gone red. One glance, no rows read. Both live here now.
//
// THIS FILE COMPOSES; IT DOES NOT COMPUTE, and after the decomposition it does
// not even wire. Eleven pure modules own the hard parts (lib/mindtree/*), the
// hooks own the wiring (pages/map/*), and the components own the chrome
// (components/map/*). What is left here is the ORDER they are called in, which
// is the one thing none of them can state for itself:
//
//   useMapViewport   is the screen small, and how big is the canvas
//   useMapUrlFilter  the FACETS, read straight off the address bar — FIRST,
//                    because the tree is built from them. It holds no effect,
//                    so it reorders none of the eleven below it
//   useMapModel      every store read, the one buildMindtree, the counts, the
//                    labels, the three summary sentences
//   useMapFocus      the drill-in, its reconciler, and the two collapse writes
//   useMapGeometry   node sizes, the tidy layout, the fit, the viewBox, and the
//                    zoom/pan/pinch gestures that move it
//   useMapCursor     the roving tab stop and the focus repair — BEFORE the drag
//                    layer, because the layer takes `requestRefocus` as onWrote
//   useMapOverlays   the two panels, the action context, the hover anchor
//   useMapDrag       the one useMindDragLayer call — and the order above and
//                    below it is that call's own requirement
//   useMapKeyboard   activate() and onKeyDown — AFTER the layer, because they
//                    ask the controller first
//   useMapWrites     runMenu, the only write this composition owns
//   useMapToolbar    what the toolbar's buttons do, including the export
//   useMapLens       the lens, the derived stage, the panel subject and the
//                    phone's detent — INSERTED between the toolbar and the
//                    pulses, which reorders none of the eleven: it needs the
//                    resolved drill-in (useMapFocus) and the pulses need the
//                    stage it derives
//   useMapUrl        ?focus=, ?dim=, ?lens= and ?stage=, called late so its two
//                    effects keep the position they had in the undivided file.
//                    The pair with useMapUrlFilter above is what makes the whole
//                    view — facets, drill-in, lens and stage — one link
//
// THE THREE READINGS, each a module this file mounts:
//
//   WORK IN IT     drag a leaf onto a branch and the work moves — through the
//                  same optimistic-write-plus-rollback path the board uses, never
//                  a bespoke write (DragLayer.tsx). Tick several and they travel
//                  together. Right-click or Shift+F10 opens the same verbs the
//                  drag performs (NodeMenu.tsx), and "Add an item here" files a
//                  new one straight into the branch it was opened on
//                  (QuickAdd.tsx).
//   EXPLORE IT     focus a branch and the map becomes that branch, with a trail
//                  back (focus.ts + Breadcrumb.tsx). Hovering — or arrowing onto
//                  — a node opens a card with the detail the drawing cannot hold
//                  (NodeCard.tsx). The filter bar and the group-by chips were
//                  already here and are unchanged.
//   WATCH IT       a realtime patch marks the branch it landed in, a departing
//                  card dissolves where it stood, and the drawing tweens between
//                  two deterministic layouts (pulse.ts + PulseLayer.tsx). Every
//                  one of those is off under prefers-reduced-motion, and off
//                  again on a map too big to tween honestly.
//
// It adds no dependency: the whole map is hand-rolled SVG.

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react'
import FilterBar, { type FilterFacet } from '../components/FilterBar'
import { EmptyState, Skeleton } from '../components/shared'
import MindtreeTable, {
  filterForCell,
  type MindtreeTableRow,
} from '../components/mindtree/MindtreeTable'
import Breadcrumb from '../components/mindtree/Breadcrumb'
import NodeMenu from '../components/mindtree/NodeMenu'
import QuickAdd from '../components/mindtree/QuickAdd'
import { useMindPulses, useReducedMotion } from '../components/mindtree/PulseLayer'
import { MindDragLayer } from '../components/mindtree/DragLayer'
import BoardStage from '../components/map/BoardStage'
import MapBranch from '../components/map/MapBranch'
import MapCanvas from '../components/map/MapCanvas'
import MapCapture from '../components/map/MapCapture'
import MapChanges, { useChangesCount } from '../components/map/MapChanges'
import MapDiveRail, { type DiveRung } from '../components/map/MapDiveRail'
import MapLensBar from '../components/map/MapLensBar'
import MapList, { useAttentionCount } from '../components/map/MapList'
import MapModeBar from '../components/map/MapModeBar'
import MapPanel from '../components/map/MapPanel'
import MapSummary from '../components/map/MapSummary'
import MapToolbar from '../components/map/MapToolbar'
import NumbersPanel from '../components/map/NumbersPanel'
import NumbersStage from '../components/map/NumbersStage'
import { EMPTY_FILTER, isFilterEmpty, type FilterState } from '../lib/entryFilter'
import { t, useLocale } from '../lib/i18n'
import { findNode, trailTo } from '../lib/mindtree/focus'
import {
  allowedStages,
  stageForLens,
  subjectForLens,
  type MapLens,
  type PanelSubject,
} from '../lib/mindtree/lens'
import { ancestorWorlds, layoutWorlds, worldAt } from '../lib/mindtree/worlds'
import type { MindNode as MindNodeModel } from '../lib/mindtree/model'
import {
  anchoredZoom,
  cameraAtWidth,
  frameCamera,
  octavesOf,
  FRAME_FILL_DESKTOP,
  FRAME_FILL_PHONE,
} from './map/mapMotion'
import { refreshEntries } from '../store/entries'
import { useMapLens } from './map/useMapLens'
import { useMapCursor } from './map/useMapCursor'
import { useMapDrag, useMapDragPressing } from './map/useMapDrag'
import { useMapFocus } from './map/useMapFocus'
import { useMapGeometry } from './map/useMapGeometry'
import { useMapKeyboard } from './map/useMapKeyboard'
import { useMapModel } from './map/useMapModel'
import { useMapOverlays } from './map/useMapOverlays'
import { useMapToolbarActions } from './map/useMapToolbar'
import { useMapUrl, useMapUrlFilter } from './map/useMapUrl'
import { useIsCompact } from './map/useMapViewport'
import { useMapWrites } from './map/useMapWrites'
import './mindtree.css'

/**
 * Every facet except `scope`, which useMapModel pins — see `applied` there.
 *
 * THE NUMBERS LENS TAKES TWO OF THEM AWAY, and the reason is not tidiness: three
 * of that stage's panels MEASURE status and health (the SLA bars, the aging
 * histogram, the health-stacked track load). A reader who can filter by status
 * while looking at a status measurement can filter the answer out of its own
 * question, and the number left on the screen is then true of a subset nobody
 * named. pages/Dashboard.tsx withheld the same two facets for the same reason;
 * the suppression is done HERE rather than inside FilterBar because this file
 * owns the facet list and FilterBar is shared with four other screens.
 */
const FACETS: readonly FilterFacet[] = [
  'search',
  /**
   * `mine` IS STILL HERE, AND THE CHIP IT USED TO RENDER IS NOT.
   *
   * The redesign's handoff asked for this key to be deleted so that "only my
   * work" stopped being one of ~20 same-weight persistent targets over the
   * picture. Deleting it does not do that — it deletes the CAPABILITY, because
   * `has('mine')` gates the control wherever it is drawn, panel included. What
   * cuts the target count is where the control lives, so `FilterBar` moved it
   * out of `.flt-rail` and into `.flt-panel` as its first facet, and this list
   * is unchanged. One control, one fact, one fewer thing over the map.
   */
  'mine',
  // Above `track`, per FilterBar's DEFAULT_FACETS. On this screen it is also the
  // cheapest way to halve the map: ring 1 is one node per track, so narrowing to
  // one group is the difference between nine branches and six on the phone,
  // where the header explains one ring has to fit a 375px viewport.
  'group',
  'track',
  // Below `track` and continuing the same coarse-to-fine reading: a branch is
  // the tree BENEATH a track (0023), and a vendor is who is doing the work on
  // it. `branch` reaches every descendant through `FilterContext.ancestryOfNode`,
  // so picking OB includes every organization under it.
  'branch',
  'vendor',
  'status',
  'priority',
  'type',
  'owner',
  'tag',
  'health',
]

/** The same list with the two facets the numbers stage measures removed. */
const NUMBERS_FACETS: readonly FilterFacet[] = FACETS.filter(
  (facet) => facet !== 'status' && facet !== 'health',
)

/**
 * How much of the stage the panel is covering, in CSS px.
 *
 * ONE FROZEN OBJECT rather than a fresh `{ inlineEnd: 0, blockEnd: 0 }` per
 * reset: the value is a `useState` cell that `useMapGeometry` memoises the fit
 * on, so handing it a new identity every render would recompute the fit — and
 * therefore the viewBox — on every keystroke in the filter box.
 */
const NO_OCCLUSION: { readonly inlineEnd: number; readonly blockEnd: number } = Object.freeze({
  inlineEnd: 0,
  blockEnd: 0,
})

export default function Mindtree(): ReactElement {
  const locale = useLocale()
  const rtl = locale === 'ar'
  const compact = useIsCompact()

  const hintId = useId()
  /**
   * ONE REF, FOUR CONSUMERS, and they do not overlap: the pan handlers
   * (`data-panning`), the focus repair's `svg.contains(activeElement)`, the drag
   * layer's pointer→layout conversion, and the export, which serialises the LIVE
   * element. It is held here because no one of the four owns it.
   */
  const svgRef = useRef<SVGSVGElement | null>(null)
  /** Breaks the geometry ⇄ drag-controller knot — see useMapDrag's header. */
  const { isPressing, attach } = useMapDragPressing()

  /**
   * The page's live region: the sentence AND a counter.
   *
   * The counter keys the rendered child so that saying the same thing twice in a
   * row still mutates the DOM — see MapSummary. `setLive` keeps its
   * `(text: string) => void` signature because it is handed to `QuickAdd` as
   * `announce`.
   */
  const [live, setLiveState] = useState<{ text: string; seq: number }>({ text: '', seq: 0 })
  const setLive = useCallback((text: string) => {
    setLiveState((prev) => ({ text, seq: prev.seq + 1 }))
  }, [])

  /**
   * THE FILTER, AND IT IS THE ADDRESS BAR'S — not this component's.
   *
   * Called FIRST, before `useMapModel`, because the tree is built FROM it. It
   * holds no effect (see its header), so calling it here reorders none of the
   * eleven hooks below.
   *
   * The map is the screen App.tsx lands admins on, and it was the only filtering
   * screen in the app whose filter did not survive a reload or a paste. That was
   * a regression rather than an omission: /followups put its filter in the URL
   * deliberately, and the collapse dropped it on the floor when this screen
   * absorbed that one. `useMapUrlFilter` was written for this and called by
   * nobody.
   */
  const { filter, setFilter } = useMapUrlFilter()

  const model = useMapModel(compact, locale, filter)

  /**
   * The reader asked for less motion. Read ONCE, here, and threaded down —
   * `PulseLayer` owns the one `matchMedia` subscription in this feature, and a
   * second one would be a second source of truth for the same question.
   */
  const reducedMotion = useReducedMotion()

  /**
   * HOW MUCH OF THE STAGE THE PANEL IS COVERING, MEASURED — not assumed.
   *
   * The panel is a floating card over the canvas now, and the canvas is
   * `inset: 0`, so `useBoxSize` measures a box that does NOT shrink when the
   * panel opens. Without this the fit would centre the drawing in the element
   * and the busiest branch would sit behind the card on every open; on a phone
   * the ring would centre in the element and half of it would be behind the
   * sheet. `MapPanel` reports its own root through a ResizeObserver, so the
   * number is what is actually on the glass rather than what the CSS intended.
   *
   * NO FEEDBACK LOOP: this moves `fit` only, never `layout.bounds`, and the
   * canvas it is subtracted from does not resize when the panel opens over it.
   */
  const [occlusion, setOcclusion] = useState(NO_OCCLUSION)

  const focus = useMapFocus({
    tree: model.tree,
    focusPref: model.focusPref,
    entriesLoaded: model.entriesLoaded,
    expandedIds: model.expandedIds,
    textOf: model.textOf,
    setLive,
  })

  /**
   * WHAT THE SHELL IS FOR — and, from it, which stage draws and what the panel
   * is about.
   *
   * MOVED UP FROM BELOW THE TOOLBAR, and the move is forced rather than
   * cosmetic: the keyboard's `dive.details` — the Organization tap that opens
   * the info sidebar — has to call `lens.setSubject`, and `useMapKeyboard` is
   * called several hooks above where this used to sit. Its own precondition is
   * unchanged and still met: it needs `focus.focusView.focusId`, the drill-in as
   * RESOLVED rather than as persisted, and `useMapFocus` is immediately above.
   */
  const lens = useMapLens({
    focusNodeId: focus.focusView.focusId,
    compact,
    announce: setLive,
  })

  /**
   * THE DRAWING. ONE ARROW, AND IT IS BUILT HERE RATHER THAN IN THE CAMERA.
   *
   * `layoutWorlds` takes no camera argument by construction, so there is no
   * expression anywhere in this render path whose value depends on both the
   * camera and the drawing's extent — which is the structural reason the old
   * `depthLimit → layout → bounds → fit → zoom → depthLimit` cycle cannot come
   * back. The geometry is a pure function of the DEPARTMENT TREE and the reading
   * direction and of nothing else: not the zoom, not the viewport, not the
   * panel, not the filter, not the reader's folds.
   */
  const layout = useMemo(
    () => layoutWorlds<MindNodeModel>(focus.drawnRoot, { direction: rtl ? 'rtl' : 'ltr' }),
    [focus.drawnRoot, rtl],
  )

  const geo = useMapGeometry({
    layout,
    focusWorldId: focus.focusView.node.id,
    reducedMotion,
    compact,
    rtl,
    svgRef,
    isPressing,
    occludeInline: occlusion.inlineEnd,
    occludeBlockEnd: occlusion.blockEnd,
  })

  /**
   * DESTRUCTURED, and not for brevity: `geo` is a fresh object literal on every
   * render, so a callback that closed over `geo` would be a new function on
   * every render and the memoised `dive` below would be rebuilt on every render
   * — which is exactly what its memo exists to prevent. `flyTo`, `setCamera` and
   * `flyTo`'s siblings are `useCallback`s with stable identities; `camera` is
   * the one that genuinely changes when the camera moves, and it is read where
   * it is genuinely needed.
   */
  const { camera, flyTo, setCamera } = geo

  /**
   * V — THE SMALLER SIDE OF THE STAGE THE READER CAN ACTUALLY SEE THROUGH.
   *
   * The canvas is `inset: 0` and does not shrink when the panel floats over it,
   * so the measured box is the ELEMENT and this is the WINDOW. It drives one
   * question and one only — "is this world the frame" — which is the single
   * level-of-detail edge that is relative rather than absolute: a 14-glyph label
   * is 87px of ink on a phone and on a desktop alike, but whether a world fills
   * the screen is a question about the screen.
   */
  const viewportMinPx = Math.max(
    1,
    Math.min(
      Math.max(1, geo.box.width - occlusion.inlineEnd),
      Math.max(1, geo.box.height - occlusion.blockEnd),
    ),
  )

  /**
   * WHICH WORLD THE CAMERA IS IN — derived, never stored.
   *
   * `worldAt` is a pure function of the camera and the drawing, so the crumb bar
   * and the rail cannot drift from the picture: there is no state for them to
   * drift from. It only ever answers with a STRUCTURAL node — a department tier
   * — which is the owner's correction made mechanical. Null means the reader is
   * above the workspace, and the drawn root is the honest answer there.
   */
  const framedWorld = worldAt(layout, camera, geo.scale, viewportMinPx)
  const framedId = framedWorld?.id ?? focus.drawnRoot.id

  /**
   * THE PATH FROM THE WORKSPACE TO WHERE THE READER IS, root first and target
   * last — `FocusView.trail`'s shape exactly, so `Breadcrumb` renders it with no
   * adapter and nothing inside that component changes.
   */
  const diveWorlds = useMemo(() => ancestorWorlds(layout, framedId), [layout, framedId])
  const diveTrail = useMemo(() => diveWorlds.map((w) => w.node), [diveWorlds])

  /**
   * Fly the camera to a world by id — the crumb, the rail's Home, and the
   * keyboard's four dive verbs all end here. A world that is not in the drawing
   * is a no-op rather than a guess.
   */
  const flyToId = useCallback(
    (id: string | null) => {
      const world = layout.byId.get(id ?? focus.drawnRoot.id)
      if (world !== undefined) flyTo(world)
    },
    [layout, flyTo, focus.drawnRoot.id],
  )

  /**
   * THE RAIL'S TICKS, AND THERE IS NO LADDER CONSTANT ANYWHERE.
   *
   * One rung per world on the current path, so the rail's LENGTH is the depth
   * the admin configured: two tiers give two ticks, seven give seven. Each
   * rung's position is where the camera would sit if that world were framed,
   * expressed in the same zeroed octaves `geo.octaves` reports — a difference of
   * two `octavesOf` readings rather than a second formula, so the tick and the
   * fly cannot disagree about what an octave is.
   *
   * The label is the world's own name out of the database, resolved for the
   * locale by `model.textOf`. It is `isolate()`d by the rail and must never be
   * handed to `t()`.
   */
  const frameFill = compact ? FRAME_FILL_PHONE : FRAME_FILL_DESKTOP
  const vMinRaw = Math.max(1, Math.min(geo.box.width, geo.box.height))
  const octaveFloor = octavesOf(
    cameraAtWidth(camera, geo.cameraBounds.maxWidth),
    layout.rootD,
    vMinRaw,
  )
  const diveRungs = useMemo<readonly DiveRung[]>(
    () =>
      diveWorlds.map((world) => ({
        id: world.id,
        label: model.textOf(world.node.label),
        octaves:
          octavesOf(
            frameCamera(world, {
              viewport: geo.box,
              frameFill,
              occlusion: { inlineEnd: occlusion.inlineEnd, blockEnd: occlusion.blockEnd },
              rtl,
            }),
            layout.rootD,
            vMinRaw,
          ) - octaveFloor,
      })),
    // `model.textOf` and `geo.box` are the only two that move without the path
    // moving; both are stable identities between resizes and locale switches.
    [diveWorlds, model, geo.box, frameFill, occlusion, rtl, layout.rootD, vMinRaw, octaveFloor],
  )

  /**
   * THE MATCH RIM — the one thing a containment drawing genuinely cannot do,
   * answered as a signpost rather than as a set.
   *
   * WHAT COUNTS AS A MATCH HERE IS A BREACH, and the choice is argued rather
   * than assumed: the tree is built FROM the filter (`useMapModel` takes it), so
   * a rim counting "filter matches" would count every node in the drawing and
   * say nothing. What the reader cannot see from a wide camera is WHERE THE
   * TROUBLE IS — six items past their deadline scattered across five departments
   * are six grains in five worlds, four octaves apart, and no single camera
   * shows all six legibly. `model.stats` already carries a subtree roll-up of
   * exactly that, so the arc costs one walk and no new read.
   *
   * The set question itself still belongs to the real-DOM list beside the
   * canvas. This is a signpost — "three in there, that way" — and the difference
   * between a map that has lost the set and a map that knows where it is.
   */
  const { matchesById, matchWedgesById } = useMemo(() => {
    const matches = new Map<string, number>()
    const wedges = new Map<string, readonly { start: number; end: number }[]>()
    const breachedIn = (id: string): number => model.stats.get(id)?.breached ?? 0
    for (const world of layout.nodes) {
      const count = breachedIn(world.id)
      if (count <= 0) continue
      matches.set(world.id, count)
      const marked: { start: number; end: number }[] = []
      for (const childId of world.childIds) {
        const child = layout.byId.get(childId)
        if (child === undefined || breachedIn(childId) <= 0) continue
        marked.push({ start: child.wedgeStart, end: child.wedgeEnd })
      }
      if (marked.length > 0) wedges.set(world.id, marked)
    }
    return { matchesById: matches, matchWedgesById: wedges }
  }, [layout, model.stats])

  const cursor = useMapCursor({ layout: geo.layout, order: geo.order, svgRef })

  const overlays = useMapOverlays({
    tree: model.tree,
    layout: geo.layout,
    nodeRefs: cursor.nodeRefs,
    rtl,
    locale,
    meId: model.meId,
    role: model.role,
    entryById: model.entryById,
    entries: model.entries,
    members: model.members,
    memberById: model.memberById,
    selection: model.selection,
    dimension: model.dimension,
    focusedId: focus.focusView.focusId,
    statusVocab: model.statusVocab,
    priorityVocab: model.priorityVocab,
    hoveredId: model.hoveredId,
    treeFocused: cursor.treeFocused,
    cursorId: cursor.cursorId,
    box: geo.box,
    viewWidth: geo.viewWidth,
    viewHeight: geo.viewHeight,
    centerX: geo.centerX,
    centerY: geo.centerY,
  })

  const textOf = model.textOf

  const dragController = useMapDrag({
    tree: model.tree,
    layout: geo.layout,
    dimension: model.dimension,
    entryById: model.entryById,
    meId: model.meId,
    role: model.role,
    rtl,
    view: model.view,
    activeId: cursor.activeId,
    svgRef,
    textOf,
    panBy: geo.panBy,
    cancelPan: geo.cancelPan,
    openMenuFor: overlays.openMenuFor,
    requestRefocus: cursor.requestRefocus,
  })
  attach(dragController)

  const keyboard = useMapKeyboard({
    dragController,
    order: geo.order,
    activeId: cursor.activeId,
    drawnRoot: focus.drawnRoot,
    focusView: focus.focusView,
    drawnEntryIds: cursor.drawnEntryIds,
    compact,
    rtl,
    dragging: model.dragging,
    entryById: model.entryById,
    selection: model.selection,
    meId: model.meId,
    role: model.role,
    draggedRef: geo.draggedRef,
    moveCursor: cursor.moveCursor,
    setCurrentId: cursor.setCurrentId,
    toggleFold: focus.toggleFold,
    focusBranch: focus.focusBranch,
    openMenuFor: overlays.openMenuFor,
    textOf: model.textOf,
    setLive,
    /**
     * PARK AN ID THAT IS NOT IN THE DOM. An arrow onto a node past the DOM
     * horizon asks the camera to open the way in and lands the tab stop on the
     * commit that brings it back — never on "the nearest thing instead", which
     * is how a keyboard reader loses their place.
     */
    requestPendingFocus: cursor.requestPendingFocus,
    /** Escape's third rung. TRUE means "I closed something, stop here". */
    closePanel: useCallback(
      () => (lens.panelOpen ? (lens.setPanelOpen(false), true) : false),
      [lens],
    ),
    /**
     * THE CAMERA, AS SIX VERBS. Memoised because an unstable object would
     * re-create `onKeyDown` on every render, and `onKeyDown` is a prop on the
     * <svg> that every node lives under.
     */
    dive: useMemo(
      () => ({
        into: (id: string) => flyToId(id),
        /**
         * THE OWNER'S OWN CORRECTION. An Organization is a LEAF you arrive at,
         * not a level you enter: the info sidebar opens beside the map and THE
         * CAMERA DOES NOT MOVE BY ONE UNIT. No re-root, no zoom, no relayout.
         */
        details: (id: string) => {
          lens.setSubject(subjectForLens('shape', id))
          lens.setPanelOpen(true)
        },
        /**
         * Focus moved — follow it by the MINIMUM MOVE. `flyTo` frames the
         * world, and for a node already at least a card wide that is a pan of a
         * few units at most.
         */
        follow: (id: string) => flyToId(id),
        /** `+` / `-`, about the centre of the frame: a keyboard has no cursor. */
        zoomBy: (ratio: number) =>
          setCamera(anchoredZoom(camera, { x: camera.cx, y: camera.cy }, ratio)),
        home: () => flyToId(null),
        surface: (): boolean => {
          const up = diveWorlds[diveWorlds.length - 2]
          if (up === undefined) return false
          flyTo(up)
          return true
        },
      }),
      [flyToId, lens, camera, setCamera, flyTo, diveWorlds],
    ),
  })

  const { runMenu } = useMapWrites({
    drawnEntryIds: cursor.drawnEntryIds,
    entryById: model.entryById,
    memberById: model.memberById,
    meId: model.meId,
    requestRefocus: cursor.requestRefocus,
    setLive,
    textOf: model.textOf,
    toggleFold: focus.toggleFold,
    focusBranch: focus.focusBranch,
    openAdd: overlays.setAddAt,
  })

  const toolbar = useMapToolbarActions({
    tree: model.tree,
    focusPref: model.focusPref,
    density: model.density,
    filter,
    rtl,
    locale,
    svgRef,
    wholeMapFit: geo.wholeMapFit,
    summary: model.summary,
    busiest: model.busiest,
    topGroup: model.topGroup,
    setLive,
  })

  /**
   * The two badges on the chips, from the units that own the panels behind
   * them. Both are hooks over the entries and notifications stores, so they are
   * called unconditionally and at the top level, like everything else here.
   *
   * A count is what makes a chip worth looking at rather than worth clicking:
   * "needs me 12" is the sentence that stops a reader opening the list to find
   * out there is nothing in it.
   */
  const attentionCount = useAttentionCount(filter)
  const changesCount = useChangesCount()

  /**
   * The pulses, and whether the drawing may tween between layouts.
   *
   * `tree` here is the DRAWN root, not the model root — pulse.ts reads
   * `collapsed` off it to decide which node actually REPRESENTS a change, and a
   * change resolved against a tree the reader is not looking at lands on a node
   * that is not on the screen.
   *
   * PAUSED WHILE A DRAG IS IN FLIGHT, and that is not merely "do not add": a ring
   * already running when the gesture starts is removed too, because a node
   * lighting up under a finger carrying work reads as feedback about the drag,
   * which it is not.
   */
  const onMap = lens.stage === 'map'
  const { pulses, motion } = useMindPulses({
    // `lens.stage`, not `model.view`: the ledger was the only other thing the
    // canvas could become when this was written, and there are now three. A
    // watch layer over a board is a ring drawn on a node nobody is looking at.
    tree: onMap ? focus.drawnRoot : null,
    paused: model.dragging,
    enabled: onMap,
  })

  useMapUrl(model.focusPref, model.dimension, focus.focusBranch)

  /* ── render ───────────────────────────────────────────────────────────── */

  const showSkeleton = model.loading && model.entries.length === 0
  const showError = model.error !== null && model.entries.length === 0
  const noTracks = model.tracks.length === 0 && model.entries.length === 0
  /**
   * `count`, and NOT `children.length` as well.
   *
   * The second half made the filtered-to-nothing state unreachable in any
   * configured workspace: `buildMindtree` emits a node per ACTIVE track whether
   * or not it holds work — deliberately, because "which track is clear" is a
   * question this screen answers — so `children.length` is never 0 once an
   * admin has created a track. A search that matched nothing therefore left a
   * ghost map of empty dashed cards reading "0 open", with the offer to clear
   * the filter three keys away in dead code. The never-configured case is the
   * `noTracks` branch above, which is what the second half was reaching for.
   */
  const nothing = model.tree.count === 0
  const filtered = !isFilterEmpty(filter)

  /**
   * Destructured for the JSX below, and not merely for brevity: TypeScript
   * narrows a `const` binding through the `!== null` guard and into the `onRun`
   * closure, where it will not narrow `overlays.menuPath` — a property read is
   * re-widened inside a callback because something could have reassigned it.
   */
  const { menuAt, addAt, menuPath, addPath } = overlays

  /**
   * A number on the numbers stage, and the list that acts on it — ONE
   * interaction, and a URL you can paste. The tile was a real `<Link>` on the
   * dashboard; this is what keeps its cost.
   *
   * TWO WRITES, ONE URL, AND THE ORDER IS LOAD BEARING. `setLens` writes the
   * store synchronously and `setFilter` reads the store back — through
   * `getMindtreeState()`, not off this render — so the single `?…` this pair
   * produces carries the NEW lens beside the new facets. Written the other way
   * round, or read off the render, the address bar would carry the lens the
   * reader just left and the inbound effect would hand it straight back.
   */
  const onJump = useCallback(
    (next: MapLens, patch: Partial<FilterState>) => {
      lens.setLens(next)
      setFilter({ ...filter, ...patch })
    },
    [lens, filter, setFilter],
  )

  /**
   * THE ONE EXHAUSTIVE SWITCH OVER `PanelSubject`, and the reason the union is
   * closed: a sixth panel kind cannot ship half-wired, because adding a member
   * breaks this function and there is no `default:` to swallow it.
   *
   * `none` returns null and the panel does not render at all — that is `shape`
   * with nothing focused, and it is today's screen exactly: the map at the full
   * width of the shell.
   *
   * The branch case reads `focus.drawnRoot` rather than `subject.nodeId`
   * because they are the same node by construction — `subjectForLens` is handed
   * `focusView.focusId`, which is the id `drawnRoot` actually carries after any
   * repair — and the panel needs the NODE, which only the focus hook holds.
   */
  const panel = ((): { title: string; body: ReactNode } | null => {
    /**
     * ONE EMPTY STATE, NOT TWO. A never-configured workspace used to answer a
     * question nobody asked, twice and in two places: the canvas said "No
     * tracks yet" and the panel said "Nothing needs you right now", side by
     * side. There is nothing that CAN need you in a workspace with no tracks,
     * so the panel does not render at all and the canvas gets one state across
     * the whole stage.
     *
     * BEFORE the switch, deliberately: the exhaustive switch over
     * `PanelSubject` has no `default:` and must keep having none, so a guard
     * that belongs to the workspace rather than to the subject cannot live
     * inside it.
     */
    if (noTracks) return null

    const subject: PanelSubject = lens.subject
    switch (subject.kind) {
      case 'none':
        return null
      case 'needsMe':
        return {
          title: t('mindtree.panelNeedsMe'),
          body: (
            <MapList
              filter={filter}
              scope={focus.drawnRoot}
              textOf={model.textOf}
              onFocus={focus.focusBranch}
              compact={compact}
              announce={setLive}
              // NO `onFilter`, AND THAT IS THE POINT. `Mine` used to exist twice
              // — once in the FilterBar and once inside this list — which is two
              // `role="group"`s with one accessible name and two pressed states
              // for one fact: a defect for a screen reader even when it looks
              // right. The single owner is now the filter rail's own chip, which
              // is also reachable at `shape` with nothing focused, where there is
              // no panel at all. One control, one fact.
            />
          ),
        }
      case 'branch': {
        /**
         * THE SUBJECT'S OWN NODE, RESOLVED AGAINST THE MODEL — not the drawn
         * root.
         *
         * It used to read `focus.drawnRoot`, and that was correct exactly while
         * the only way to open this panel was to DRILL IN, which made the two
         * the same node by construction. The camera breaks that: tapping an
         * Organization opens this panel and deliberately does NOT re-root the
         * map, so the subject and the drawn root are now different nodes and
         * reading the wrong one would show the workspace's detail under an
         * Organization's name. Falls back to the drawn root when the node has
         * left the tree between the tap and this render — a realtime close, a
         * filter keystroke — which is the same node the panel used to show.
         */
        const node = findNode(model.tree, subject.nodeId) ?? focus.drawnRoot
        return {
          title: t('mindtree.panelBranch', { label: model.textOf(node.label) }),
          body: (
            <MapBranch
              node={node}
              path={trailTo(model.tree, node.id) ?? focus.focusView.trail}
              filter={filter}
              dimension={model.dimension}
              textOf={model.textOf}
              onFocus={focus.focusBranch}
              compact={compact}
              announce={setLive}
            />
          ),
        }
      }
      case 'changes':
        return {
          title: t('mindtree.panelChanges'),
          body: <MapChanges compact={compact} announce={setLive} />,
        }
      case 'numbers':
        return {
          title: t('mindtree.panelNumbers'),
          body: <NumbersPanel filter={filter} compact={compact} onJump={onJump} />,
        }
    }
  })()

  /**
   * The open tree's own chrome — the group-by chips, the ladder, the trail and
   * the bulk bar. None of the four means anything over a board or a chart:
   * there is no ring to climb, no branch to be inside, and nothing on those
   * surfaces that the map's selection can carry.
   */
  const onTree = lens.stage === 'map' || lens.stage === 'table'

  /**
   * The ladder carries the map⇄ledger toggle at its foot, so it renders wherever
   * that toggle would have something to switch. `allowedStages` is asked rather
   * than `onTree` being reused, because it is the same predicate `MapLensBar`
   * used to gate the `Map | Table` pair this replaces — one question, one
   * answer, and it stays right if a sixth lens ever earns a third stage.
   */
  const showLadder = onTree && allowedStages(lens.lens).length > 1

  /**
   * The occlusion is reported by the panel and RETRACTED here.
   *
   * `MapPanel` reports `{0,0}` when it unmounts, but it is also possible for it
   * to stop being visible without unmounting — the reader closes it, the lens
   * changes to one whose subject is `none`, the workspace turns out to have no
   * tracks — and in each of those the last measurement would stand and the fit
   * would keep reserving a card that is no longer on the glass. The identity
   * check is what stops this being a render loop: `NO_OCCLUSION` is one frozen
   * object, so the second pass is a no-op and React stops.
   */
  const panelVisible = panel !== null && lens.panelOpen
  useEffect(() => {
    if (panelVisible) return
    setOcclusion((prev) => (prev === NO_OCCLUSION ? prev : NO_OCCLUSION))
  }, [panelVisible])

  return (
    <div
      className="mtree"
      /**
       * THE LADDER'S OWN CLEARANCE, published rather than guessed. The ladder is
       * pinned to the canvas's inline-end and the panel floats over the same
       * edge, so the one number that keeps them apart is the width the panel is
       * actually taking — which is measured, not a copy of `map-panel.css`'s
       * `clamp(20rem, 26vw, 26rem)` that would drift the first time either side
       * was retuned. 0 when there is no panel, and the ladder returns to the
       * edge.
       */
      style={{ '--map-occlude-inline': `${occlusion.inlineEnd}px` } as CSSProperties}
    >
      {/* THE DOCUMENT OUTLINE SURVIVES AND THE PIXELS DO NOT. The app header
          already says which screen this is, in the same words, one row above —
          so a drawn `<h1>` plus a subtitle was 90px of viewport spent repeating
          it. sr-only keeps the heading a screen reader and a landmark walk both
          need; `page-subtitle` is deleted outright. */}
      <h1 className="sr-only">{t('mindtree.title')}</h1>

      {/* THE ISLAND LAYER. One `inset: 0` sheet over the stage at
          `pointer-events: none`, with every island turning pointers back on for
          itself — so the canvas beneath keeps every press that is not on a
          control, and the drag/pan gesture is not quietly eaten by a transparent
          box. On a phone this layer stops being a layer and becomes the top
          rail: the grid's leading `auto` row. */}
      <div className="mtree-isles">
        {/* ISLAND 1, top-start: the filter rail. Its `Mine` chip is the SINGLE
            owner of "only my work" now — MapList no longer renders a second one
            — and its facets open as a panel over the picture rather than as a
            row that pushes the picture down. */}
        <div className="mtree-isle mtree-find">
          <FilterBar
            value={filter}
            onChange={setFilter}
            facets={lens.lens === 'numbers' ? NUMBERS_FACETS : FACETS}
            tags={model.tags}
            // A HOOK FOR ONE DECLARATION, and `className` is the prop that
            // exists for exactly this: `.flt` carries a 14px `margin-block-end`
            // that is right in a document and wrong inside a 44px island, where
            // it measured as 14px of empty plate that pushed the rail into the
            // group-by chips below it. See `.mtree-filter` in mindtree.css.
            className="mtree-filter"
          />
        </div>

        {/* ISLAND 2, top-end: THE FIVE DESTINATIONS AND THE TWO MODES, in one
            row, at every width and never behind a disclosure. Each chip replaces
            a tab-bar slot, and a tab tap costs one interaction — so must a chip.
            Below 768px this element leaves the flow entirely and becomes the
            pinned rail at the block end, one z-index above the sheet. */}
        <div className="mtree-shellbar">
          <MapLensBar
            lens={lens.lens}
            onLens={lens.setLens}
            compact={compact}
            counts={{ 'needs-me': attentionCount, 'what-changed': changesCount }}
          />
          <MapModeBar
            compact={compact}
            exporting={toolbar.exporting}
            onExport={toolbar.runExport}
          />
        </div>

        {/* ISLAND 3, canvas-start: what the rings are made of, and where the
            reader is inside them. The two belong together — the trail is the way
            back OUT of a drill-in and the chips are what the drill-in is
            partitioned by — and stacking them costs one island rather than two.
            `truncated` rides along because it is a fact about the same drawing. */}
        {(onTree || model.truncated) && (
          <div className="mtree-isle mtree-work">
            {onTree && (
              <MapToolbar
                dimension={model.dimension}
                onDimension={toolbar.chooseDimension}
                compact={compact}
              />
            )}

            {/* THE TRAIL'S SOURCE IS THE CAMERA, NOT A DRILL-IN. `diveTrail` is
                `ancestorWorlds(layout, worldAt(camera))` — root first, where you
                are LAST, inclusive — which is `FocusView.trail`'s shape exactly,
                so nothing inside the component changes. It is DERIVED, so it
                cannot drift from the picture: there is no state for it to drift
                from, and the name hands off from the rim label to the crumb at
                the 0.85V crossing and at no other instant. A crumb press is a
                fly, not a re-root. */}
            {onMap && <Breadcrumb trail={diveTrail} onFocus={flyToId} />}

            {model.truncated && <p className="mtree-note">{t('mindtree.truncated')}</p>}
          </div>
        )}
      </div>

      {/* ISLAND 4, canvas inline-end: THE DIVE RAIL, which is what eleven
          controls became. `Zoom −`, `Zoom 100%`, `Zoom +`, `Expand all`,
          `Collapse all`, the four named altitude stops and `Fit to view` are all
          answered here — as ONE continuous slider whose TICKS ARE THE ADMIN'S
          OWN DEPARTMENT TIERS and whose `aria-valuetext` is the NAME of the
          world the camera is framing. There is no ladder constant anywhere and
          there must not be one: `rungs.length` is the depth of the configured
          tree, so a workspace with two tiers gets two ticks and one with seven
          gets seven.

          A SIBLING OF THE ISLAND LAYER RATHER THAN A CHILD OF IT, and the
          difference is not cosmetic: the rail positions ITSELF inside its
          containing block, and on a phone the island layer is a horizontal
          scroller, which would both clip it and give it the wrong shape.
          `.mtree-ladder` is that containing block and nothing else: a
          transparent frame, inset from the inline end by however much the panel
          is measured to be covering. Its DOM position keeps the Tab order —
          after the group-by chips, before the tree's single stop. */}
      {showLadder && (
        <div className="mtree-ladder">
          <MapDiveRail
            value={geo.octaves}
            max={geo.octaveSpan}
            rungs={diveRungs}
            worldLabel={diveRungs[diveRungs.length - 1]?.label ?? t('app.name')}
            // A RAIL DRAG IS A WIDTH, not a fly: the reader is holding the
            // control, so the camera must follow the thumb rather than tween
            // towards it. `maxWidth / 2^octaves` is the exact inverse of the
            // reading `geo.octaves` published, so releasing the thumb where it
            // was picked up moves nothing.
            onChange={(octaves) =>
              setCamera(cameraAtWidth(camera, geo.cameraBounds.maxWidth / 2 ** octaves))
            }
            // HOME IS FIT. It has to re-FRAME the root — a centre as well as a
            // width — which a value write cannot say.
            onHome={() => flyToId(null)}
            table={lens.stage === 'table'}
            // `stageForLens` and not the literal `'map'`: the lens decides what
            // the open tree IS, and turning the ledger off has to return the
            // reader to that rather than to a stage this call site guessed.
            onTable={(next) => lens.setStage(next ? 'table' : stageForLens(lens.lens))}
            compact={compact}
          />
        </div>
      )}

      {/* THE SPLIT. The panel is a SIBLING of the canvas — `.mtree-canvas` is
          `overflow: hidden; touch-action: none`, and `touch-action` intersects
          down the ancestor chain, so a list rendered inside it could not be
          scrolled with a finger at all. That is unchanged by the panel becoming
          a floating card: it floats as a sibling, never as a child. */}
      <div className="mpan-split">
        <div className="mpan-stage">
          {lens.stage === 'board' ? (
            <BoardStage filter={filter} compact={compact} rtl={rtl} announce={setLive} />
          ) : lens.stage === 'numbers' ? (
            <NumbersStage filter={filter} compact={compact} rtl={rtl} announce={setLive} />
          ) : showSkeleton ? (
            <div className="mtree-canvas">
              <Skeleton height={320} />
            </div>
          ) : showError ? (
            <EmptyState
              title={t('mindtree.errLoad')}
              description={model.error ?? undefined}
              action={
                <button type="button" className="btn" onClick={() => void refreshEntries()}>
                  {t('mindtree.refresh')}
                </button>
              }
            />
          ) : noTracks ? (
            <EmptyState title={t('mindtree.emptyTracks')} description={t('mindtree.emptyTracksHint')} />
          ) : nothing && filtered ? (
            <EmptyState
              title={t('mindtree.emptyFiltered')}
              description={t('mindtree.emptyFilteredHint')}
              action={
                <button
                  type="button"
                  className="btn"
                  onClick={() => setFilter({ ...EMPTY_FILTER })}
                >
                  {t('mindtree.clearFilters')}
                </button>
              }
            />
          ) : model.tree.count === 0 && !filtered ? (
            <EmptyState title={t('mindtree.empty')} description={t('mindtree.emptyHint')} />
          ) : lens.stage === 'table' ? (
            <MindtreeTable
              root={model.tree}
              dimension={model.dimension}
              entryById={model.entryById}
              today={model.ctx.today}
              onFilterCell={(row: MindtreeTableRow) =>
                setFilter(filterForCell(filter, model.dimension, row))
              }
            />
          ) : (
            <MapCanvas
              canvasRef={geo.canvasRef}
              svgRef={svgRef}
              layout={geo.layout}
              order={geo.order}
              // THE FOUR THE LEVEL-OF-DETAIL NEEDS. `scale` is the only thing
              // that turns an authored world diameter into an apparent size, and
              // therefore the only thing that decides which of the five drawings
              // each node renders; `viewportMinPx` answers the one question that
              // is about the window rather than about legibility.
              scale={geo.scale}
              viewportMinPx={viewportMinPx}
              matchesById={matchesById}
              matchWedgesById={matchWedgesById}
              views={model.views}
              viewBox={geo.viewBox}
              rtl={rtl}
              hintId={hintId}
              dimensionLabel={model.dimensionLabel}
              motion={motion}
              pulses={pulses}
              dragController={dragController}
              activeId={cursor.activeId}
              currentId={cursor.currentId}
              cardPos={overlays.cardPos}
              cardAnchor={overlays.cardAnchor}
              box={geo.box}
              dragging={model.dragging}
              entryById={model.entryById}
              memberById={model.memberById}
              vocabLabel={model.vocabLabelOf}
              dimension={model.dimension}
              today={model.ctx.today}
              onActivate={keyboard.activate}
              onNodeFocus={cursor.setCursorId}
              registerRef={cursor.registerRef}
              onHover={keyboard.onNodeHover}
              onMenu={overlays.openMenuFor}
              onTreeFocus={cursor.setTreeFocused}
              onKeyDown={keyboard.onKeyDown}
              onPointerDown={geo.onPointerDown}
              onPointerMove={geo.onPointerMove}
              onPointerEnd={geo.endPointer}
            />
          )}
        </div>

        {/* The dock. Rendered only when the subject is something — `shape` with
            nothing focused is `none`, and the map takes the whole width; and a
            workspace with no tracks, where the canvas's own empty state is the
            single answer. */}
        {panel !== null && (
          <MapPanel
            open={lens.panelOpen}
            compact={compact}
            detent={lens.detent}
            onDetent={lens.setDetent}
            onClose={() => lens.setPanelOpen(false)}
            title={panel.title}
            onOcclude={setOcclusion}
          >
            {panel.body}
          </MapPanel>
        )}
      </div>

      {/* THE BLOCK-END STRIP — the bulk bar and the caption, in the grid's own
          `auto` row and never over the drawing.

          The bulk bar is here rather than floating for the reason it has always
          carried: it is the other half of the redistribution gesture, and a bar
          that floats over a map you are dragging work across is a bar that
          covers the branch you are aiming at. It must not lie either —
          `pruneMindSelection` has already dropped anything the reader can no
          longer see, so this is a count of rows on the screen. */}
      <div className="mtree-foot">
        {onMap && model.selectionCount > 0 && (
          <div className="mtree-selbar" role="group" aria-label={t('mindtree.selectionLabel')}>
            <span className="mtree-selbar-count tabular">
              {t('mindtree.selectionCount', { count: model.selectionCount })}
            </span>
            <span className="mtree-selbar-hint">{t('mindtree.selectionHint')}</span>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={keyboard.clearSelection}
            >
              {t('mindtree.clearSelection')}
            </button>
          </div>
        )}

        <MapSummary
          showMapChrome={onMap}
          compact={compact}
          hintId={hintId}
          summary={model.summary}
          busiest={model.busiest}
          topGroup={model.topGroup}
          // THE RESULT COUNT ARRIVES HERE instead of being a standalone chip in
          // the header. It was one of ~20 same-weight controls in a row that had
          // nothing to do with it; beside the summary sentences it is the same
          // kind of statement as the ones either side of it.
          countLabel={t('mindtree.countOpen', { count: model.tree.count })}
          live={live}
        />
      </div>

      {/* THE GHOST, THE REASON AND THE DRAG'S OWN LIVE REGION — outside the
          <svg>, as a sibling of the canvas. `.mtree-canvas` is `overflow:
          hidden`, so a ghost drawn inside the drawing would be clipped at the
          exact moment a reader drags toward the edge to make the map auto-pan.
          It carries its own polite region rather than borrowing MapSummary's:
          this screen's region is the map's commentary ("Delivery") and a drag
          is a stream of short sentences that must arrive in order. */}
      {onMap && <MindDragLayer controller={dragController} />}

      {/* THE COMPOSER, ALWAYS MOUNTED AND NEVER REMOUNTED, at every lens and
          every stage — capture is the app's reason to exist and the second line
          of a session must cost N characters and Enter with no navigation at
          all.

          A SIBLING OF THE CANVAS AND OUTSIDE THE `<svg>` SUBTREE, which is what
          makes its keystrokes inert to the map: `useMapKeyboard`'s onKeyDown is
          a React handler on the <svg> and React events bubble through the SVG
          subtree only, while `lib/hotkeys.isTypingTarget()` is a structural test
          that a real <input> anywhere passes. Enter in the box therefore reaches
          neither the map's grammar nor the global hotkeys.

          Because it is `position: fixed` at the block end on a phone, it also
          publishes its height to the sheet — see `--map-composer-block-size` in
          mindtree.css. */}
      <MapCapture />

      {/* Both portal to document.body and both are dismissed through
          lib/overlayStack, so they compose with the entry sheet and the confirm
          dialog rather than each binding `document` for themselves. Rendered
          only when a path RESOLVED: a node can leave the tree between the
          gesture and this render — a realtime close, a filter keystroke — and an
          overlay hanging off a node that is gone is the one thing neither
          component can recover from. */}
      {menuAt !== null && menuPath !== null && menuPath.length > 0 && (
        <NodeMenu
          path={menuPath}
          label={textOf(menuPath[menuPath.length - 1].label)}
          at={{ x: menuAt.x, y: menuAt.y }}
          rtl={rtl}
          ctx={overlays.mindCtx}
          choices={overlays.menuChoices}
          anchorEl={cursor.nodeRefs.current.get(menuAt.nodeId) ?? null}
          onRun={(run) => {
            runMenu(run, menuPath, { x: menuAt.x, y: menuAt.y })
          }}
          onClose={() => overlays.setMenuAt(null)}
        />
      )}

      {addAt !== null && addPath !== null && addPath.length > 0 && (
        <QuickAdd
          path={addPath}
          label={textOf(addPath[addPath.length - 1].label)}
          dimension={model.dimension}
          at={{ x: addAt.x, y: addAt.y }}
          rtl={rtl}
          meId={model.meId}
          anchorEl={cursor.nodeRefs.current.get(addAt.nodeId) ?? null}
          announce={setLive}
          onClose={() => overlays.setAddAt(null)}
        />
      )}
    </div>
  )
}
