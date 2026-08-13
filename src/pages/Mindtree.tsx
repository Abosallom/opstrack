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
// lifted out of the flow into ONE FLOATING CONTROL RAIL over the picture, plus
// the two indicators that belong to the drawing rather than to the reader:
//
//   the rail        search · Mine · Filter (n)   ‖   the lens chips · Meetings ·
//                   the export menu · Grouped by … — ONE row, one block start,
//                   laid out by flexbox rather than by three absolute boxes
//                   that were hoped to miss each other
//   under the rail  the drill-in trail and the truncation note
//   canvas-end      the altitude ladder — four stops · Fit · Table
//
// THE RAIL IS ONE ROW BECAUSE THE BROWSER SHOWED THREE. Every island used to
// place ITSELF with `inset-block-start: 12px` or `68px` and a max-inline-size
// budgeted against a stage width that measured wrong, so "Grouped by …" landed
// on an orphan second row aligned to nothing and the filter rail's scrollbar
// pushed it 2px into the island above. A flex row cannot produce either: the
// only number left is the rail's own inset, and what does not fit is resolved
// by wrapping INSIDE the island that overflowed.
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
// The terminal capability status, imported from the ONE place that owns the
// literal — lib/mapNodes.ts's header refuses a second copy of `'live'`.
// `managerLabel` rides in beside it for the portfolio's AM column: an id the
// roster does not know is a person who LEFT, not nobody, and that rule lives in
// exactly one function.
import { managerLabel, TERMINAL_STATUS } from '../components/map/MapBranchDetail'
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
import PortfolioStage, { useAtRiskCount } from '../components/map/PortfolioStage'
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
import {
  MIND_GROUPINGS,
  type MindGrouping,
  type MindNode as MindNodeModel,
} from '../lib/mindtree/model'
import {
  anchoredZoom,
  cameraAtWidth,
  frameCamera,
  octavesOf,
} from './map/mapMotion'
import { refreshEntries } from '../store/entries'
import { useMapNodes, useMapNodesTruncated } from '../store/config'
import { loadPortfolio, usePortfolioLinks } from '../store/portfolio'
import { useMapLens } from './map/useMapLens'
import { useMapCursor } from './map/useMapCursor'
import { useMapDrag, useMapDragPressing } from './map/useMapDrag'
import { useMapFocus } from './map/useMapFocus'
import { useMapGeometry } from './map/useMapGeometry'
import { isDiveTarget, useMapKeyboard } from './map/useMapKeyboard'
import {
  BY_FOR_GROUPING,
  CANVAS_GROUPINGS,
  useMapModel,
  type MapProgressSource,
} from './map/useMapModel'
import { useMapOverlays } from './map/useMapOverlays'
import { useMapToolbarActions } from './map/useMapToolbar'
import { useMapUrl, useMapUrlFilter, useMapUrlPortfolio } from './map/useMapUrl'
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
  // After `vendor`, and the pair reads as one sentence in the order it narrows:
  // who is DOING the work, then who is ACCOUNTABLE for it. It is NOT withheld
  // the way `NUMBERS_FACETS` withholds status and health — the argument for that
  // asymmetry is the `PORTFOLIO_FACETS` paragraph below, which exists so nobody
  // "fixes" this line by symmetry with the one under it.
  'manager',
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
 * ⚠ THERE IS NO `PORTFOLIO_FACETS`, AND THE ABSENCE IS ARGUED RATHER THAN
 *   FORGOTTEN — say so here, or the next reader "fixes" it.
 *
 * The numbers stage drops `status` and `health` because three of its panels
 * MEASURE those two, so a reader could filter the answer out of its own
 * question and be left with a number that is true of a subset nobody named. The
 * portfolio measures neither. Its grouping control (`?by=`) and the facets are
 * ORTHOGONAL: filtering to one account manager while grouped BY account manager
 * is a legitimate narrowing to one book — it is how an AD gets from "the five of
 * them" to "Sara's eighty" — and filtering to one vendor while grouped by vendor
 * is how a cohort is inspected. Neither collapses a measurement onto itself.
 *
 * Withholding them would also break the one drill this screen has: every
 * roll-up row narrows `mapNodeIds`, and a facet the bar refuses to render is a
 * facet the reader cannot then clear.
 */

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

  /**
   * `?by=` AND `?risk=` — the portfolio's two controls, in the address bar
   * beside the facets rather than in this component's state.
   *
   * Called here and threaded down rather than read inside `PortfolioStage`, for
   * the reason `useMapUrlFilter` is called here: the badge on the lens chip is
   * counted at THIS level, under every lens, so the shell needs the same answer
   * the stage does and two `useSearchParams()` readings of one pair is two
   * chances to disagree about what the reader is looking at.
   *
   * It holds no effect (see its header), so calling it here reorders none of the
   * eleven hooks below.
   */
  const { portfolio, setPortfolio } = useMapUrlPortfolio()

  /**
   * THE PROGRESS UNDERSCORE'S SOURCE — the one read wave 5 left unwired, and the
   * decision it was waiting on.
   *
   * `map_node_use_cases` is 400 organizations × ~10 capabilities ≈ 4,000 rows,
   * which store/config.ts refuses to hold ("That is DATA, not configuration")
   * and api/map.ts's `listNodeUseCasesFor` refuses to fire on boot. This screen
   * IS where the app lands, so the honest reading of "not on boot" here is not
   * "never" — it is "not on the path that gates first paint, and not from a
   * store that every other screen pays for".
   *
   * SO IT IS AN EFFECT, AFTER PAINT, THROUGH A LAZY STORE. The map draws its
   * first frame from store/config alone; the links land a moment later and the
   * underscore appears on the repaint. store/portfolio.ts fetches nothing until
   * somebody calls it, and this is the caller — the canvas wants EVERY
   * organization's links (the mark is on every card and rolls up every ring),
   * unlike the branch panel, which reads one node's on open and is unaffected.
   *
   * `null` UNTIL THEY LAND, NEVER `[]`. An empty array means "no organization
   * has integrated anything", which draws an empty underscore on every card and
   * announces "0 of 90 live"; null means nobody has looked and both the mark and
   * its spoken clause are absent. That is why `MapProgressSource` is nullable.
   *
   * Memoised because the object's identity is a dependency of the roll-up, and
   * `TERMINAL_STATUS` is IMPORTED rather than restated: lib/mapNodes.ts's header
   * is explicit that the literal `'live'` lives at exactly one call site.
   */
  const portfolioLinks = usePortfolioLinks()
  const progressSource = useMemo<MapProgressSource | null>(
    () =>
      portfolioLinks === null
        ? null
        : {
            links: portfolioLinks,
            terminalKey: TERMINAL_STATUS,
            terminalWordKey: 'mapnode.wordLive',
          },
    [portfolioLinks],
  )

  /**
   * WHICH ORGANIZATIONS TO ASK ABOUT — every active node, because the mark is on
   * every card and a ring's roll-up sums the ones beneath it.
   *
   * Archived nodes are left out: they are absent from the tree the canvas draws
   * (store/config's `mapChildren` drops them), so their links would be rows
   * nothing could render.
   *
   * THE EMPTY LIST IS NOT A LOAD. `mapNodes` is empty for the first tick of
   * every cold start, and `loadPortfolio` refuses that call rather than stamping
   * its clock on an answer about nothing — otherwise the map would keep the
   * underscore off until the tab was reopened.
   */
  const mapNodes = useMapNodes()
  const portfolioIds = useMemo(
    () => mapNodes.filter((node) => !node.archived).map((node) => node.id),
    [mapNodes],
  )
  useEffect(() => {
    // Unawaited on purpose: this must not block the frame it is fired from, and
    // loadPortfolio never rejects. A second call while one is in flight awaits
    // the first rather than issuing a second 4,000-row read.
    //
    // THE PORTFOLIO STAGE ADDS NO SECOND CALLER, and that is the point of it
    // being here rather than inside `PortfolioStage`: this effect already asks
    // for every organization's links (the underscore is on every card), the
    // store dedupes a concurrent call onto the same promise, and a stage that
    // fired its own would be a second 4,000-row read on the tab that opens it.
    // `store/portfolio` stays lazy in the only sense that matters — nothing in
    // it runs at import time and nobody outside this screen pays for it.
    void loadPortfolio(portfolioIds)
  }, [portfolioIds])

  // `portfolio.by` IS THE FIFTH ARGUMENT, and it is the whole of this wave's
  // shell work: the same value the table's rows are built from decides what the
  // rings are made of. One reading, two consumers — never two `useSearchParams()`
  // that can disagree about which question the reader is asking.
  const model = useMapModel(compact, locale, filter, progressSource, portfolio.by)
  // TWO TRUNCATIONS, TWO SENTENCES, and they are not the same fact. `model.truncated`
  // is the ENTRIES clamp (useMapModel.ts:187's `useEntriesTruncated()`) — the work
  // filed under the map is a window, so the counts are low. This one is the
  // HIERARCHY clamp (store/config.ts's `mapNodesTruncated`, set from api/map.ts's
  // paged read): organizations themselves are missing, so rings a reader is looking
  // for are not drawn at all. Collapsing them into one sentence would tell somebody
  // hunting a named org that the numbers are approximate.
  const nodesTruncated = useMapNodesTruncated()

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
    // WHO IS LOOKING — the two facts the opening camera is chosen from, and
    // both are already in `useMapModel`'s return block (`meId`, `role`), so
    // nothing new is computed here. Unwired, `useMapFocus` defaults them to
    // `null`/`'member'` and every reader gets the workspace opening world;
    // wired, an account manager lands on their own book.
    meId: model.meId,
    role: model.role,
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
  /**
   * ⚠ NO `sizeOf`, 2026-08-13, AND IT IS A MEASUREMENT THAT SAYS SO.
   *
   * `useMapModel`'s `collectSizes` is built, pure and tested
   * (`useMapModel.test.ts`), and the design's §3.1 asks for a memo over it plus
   * exactly one more line here:
   *
   *     sizeOf: (node, depth) => (depth === 0 ? undefined : sizes.get(node.id))
   *
   * That line turns the permanent render gate RED on two of its fifteen
   * assertions, and the reason is structural rather than a tuning problem.
   * `MindNode` authors EVERY mark — the 12.5px label, the count, the 0.5px box
   * stroke, the chevron — in the units of a 168-wide leaf, and carries them on
   * the ONE `scale(cardScale)` transform wave 1 introduced. Resizing a card's
   * authored box to 252 does not resize anything inside it, so the glyph stops
   * being the fraction of its card it was authored at:
   *
   *   small@opening  "Hospitals"  4.5067px in a 90.9px card; the contract owes
   *                  12.5 x 90.9 / 168 = 6.7601px  →  0.667x short, which is
   *                  exactly 168/252.
   *
   * And the cost is not only the gate's arithmetic. A bigger card is a bigger
   * world (`worlds.ts` makes a world proportional to its card's diagonal), a
   * bigger world is a bigger ring, and a bigger ring is a camera that pulls
   * back — so `npm run lookat` measured the SMALLEST text on the glass falling
   * 3.738px → 2.748px on the 19-org fixture and 4.184px → 2.807px on the
   * 400-org one, for a channel worth 2.25x in area. This map's founding defect
   * was 1.85px of label; spending a third of every glyph to encode a magnitude
   * is the same trade in the same direction.
   *
   * AND THE GATE'S OWN ARITHMETIC IS ONLY HALF OF IT. `shareFloorPx` denominates
   * in the constant `LEAF_WIDTH = 168`, which is correct for every card today and
   * becomes a fiction the moment one card is authored at another width; the
   * handoff carries a verified patch that reads the card's OWN authored width
   * instead, changes no number the gate has ever measured, and takes all fifteen
   * assertions green WITH the encoding on. It was run, and it is still not
   * enough: at 375px the phone's framed ring goes from `card=3` to
   * `card=2 chip=1`, so one of three organizations loses its NAME to pay for the
   * magnitude. That is the trade refused here.
   *
   * THE FIX IS THEREFORE NOT A GATE EDIT. The encoding has to grow the node's
   * WORLD and let `cardScale = worldD / ownD` carry the marks with it, which is
   * `worlds.ts`'s two card rules — wave 1's frozen contract and a different
   * unit's change.
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
  // ONE DERIVATION POINT, AND IT IS THE CAMERA'S. `useMapGeometry` derives the
  // fill from the framed world's own fan-out (`frameFillFor`) rather than from
  // the device; a second copy here would make the rail's rungs report where the
  // camera WOULD sit using a number the camera no longer uses, so the tick you
  // drag to would not be the framing you land in.
  const frameFill = geo.frameFill
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
          // ONE ACT, ONE SENTENCE. `setSubject`'s branch case opens the panel
          // itself (`applyLens` → `setMindPanelOpen(true)`), so a second
          // `setPanelOpen(true)` here would only add a second announcement —
          // "The panel is showing." — that the keyboard's own sentence then
          // overwrites in the same tick.
          lens.setSubject(subjectForLens('shape', id))
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
   * THE GROUPING CHIP'S WRITE — one tap, one `setParams`, and the table follows.
   *
   * It lives here rather than in `useMapToolbarActions` because that hook's
   * verbs all write the STORE (`setMindDimension`, `setMindFocus`, the density),
   * and this one writes the ADDRESS BAR: `?by=` has no store by design, and the
   * setter it needs is the shell's own `useMapUrlPortfolio`. Putting a URL write
   * inside a store-writing hook would give that hook a router dependency its
   * suite (node environment, no router) cannot mount.
   *
   * `BY_FOR_GROUPING` IS TOTAL OVER WHAT THE TOOLBAR OFFERS — the chips are
   * built from `CANVAS_GROUPINGS`, which is defined as the groupings that have
   * a `?by=` spelling — so the `undefined` arm is unreachable and returns
   * without writing rather than writing a default. A chip that silently moved
   * the reader to a different grouping than the one they pressed is worse than
   * one that does nothing, and the compiler cannot rule it out through a
   * `Partial` record.
   *
   * NO FOCUS TRIM HERE, unlike `chooseDimension`. A drill-in below a cohort is
   * an id with a `cohort:` segment in it and the regroup invalidates it; the
   * trim is pure string arithmetic over the id grammar, which lives in
   * lib/mindtree/focus.ts and is wave 6's model unit — see the seam note in the
   * handoff. Until it lands, `resolveFocus` recovers the reader to the nearest
   * surviving ancestor, which is correct and merely less quiet.
   */
  const chooseGrouping = useCallback(
    (next: MindGrouping) => {
      const by = BY_FOR_GROUPING[next]
      if (by === undefined) return
      setPortfolio({ ...portfolio, by })
      // The live region gets the STATE, not the button: "no longer grouped" is
      // what changed about the picture, where "grouped by None" is a sentence
      // about a chip. MapToolbar's summary draws the same distinction.
      setLive(
        next === 'none'
          ? t('mindtree.groupingNoneChanged')
          : t('mindtree.groupingChanged', {
              label: t(MIND_GROUPINGS.find((g) => g.key === next)?.labelKey ?? 'common.none'),
            }),
      )
    },
    [portfolio, setPortfolio, setLive],
  )

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
   * THE THIRD BADGE, AND IT IS THE WHOLE OF BUDGET E1.
   *
   * "How many organizations are stuck" is the morning question, and a number on
   * the chip is what makes it cost ZERO interactions: the reader does not open
   * the portfolio to find out whether it is worth opening. It is counted from
   * `model.tree` — the same tree the portfolio's rows are built from, through
   * the same `stageReading` in lib/portfolio/rows.ts — so the badge and the row
   * count are provably one number rather than two folds that agree today.
   *
   * IT RESPECTS THE FILTER, AND IT TAKES IT EXPLICITLY — `model.tree` is NOT
   * enough, which is the correction this line carries. lib/mindtree/model.ts
   * draws a track and an organization whether or not they are populated, on
   * purpose, so a filter naming a set of organizations changes the WORK under
   * them and not which of them the tree holds. The count therefore narrows
   * through the same `inPortfolioScope` the table's rows do, which is what keeps
   * the badge and the row count one number under a filter as well as without
   * one. `useAttentionCount` takes the filter one chip over for its own reason.
   */
  const atRiskCount = useAtRiskCount(model.tree, filter)

  /**
   * The account manager's name for a node, through the roster — memoised so the
   * portfolio's row memo (one pass over ~400 organizations) is not rebuilt by an
   * inline arrow on every render of this shell.
   */
  const portfolioManagerName = useCallback(
    (id: string | null) => managerLabel(model.memberById, id),
    [model.memberById],
  )

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
          // "INSIDE" IS THE ONE PREPOSITION THE OWNER'S CORRECTION RULES OUT for
          // an Organization. For a DEPARTMENT you dove into it is exactly right —
          // you are inside that world and the map re-rooted to say so. An
          // Organization is a LEAF you ARRIVE AT: nothing re-roots, nothing
          // zooms, and the panel is a description of one thing rather than a
          // view from within it. `isDiveTarget` is the same test `activate` uses
          // to choose between the two gestures, so the title cannot disagree
          // with the gesture that opened it.
          title: isDiveTarget(node)
            ? t('mindtree.panelBranch', { label: model.textOf(node.label) })
            : t('mindtree.panelOrg', { label: model.textOf(node.label) }),
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
        {/* THE CONTROL RAIL — one row, three groups, and flexbox rather than
            three absolute boxes budgeted against each other. It carries every
            control the shell has: the filter group at the reading start, the
            destinations and the modes at the reading end, and the group-by
            disclosure beside them. Nothing on this screen is a control and NOT
            on this row.

            Measured at 1600x900 after the change: the rail is 1344 and the
            three groups are 384 + 726 + 147, so all three sit on one line with
            63px to spare (1250 and 94px to spare in Arabic). Below that the row
            still does not wrap and no group is pushed off it — the lens island
            shrinks and wraps INSIDE ITS OWN PLATE, which is the failure mode
            `mindtree.css` already prices at 44px and the only one that leaves
            every group where the reader last saw it. */}
        <div className="mtree-rail">
          {/* THE FILTER GROUP, at the reading start. Its `Mine` chip is the
            SINGLE owner of "only my work" now — MapList no longer renders a
            second one — and its facets open as a panel over the picture rather
            than as a row that pushes the picture down. That is why it is the
            one group the rail takes OUT of its flow (see `.mtree-find`): opened,
            this island measures 722px tall at 1600x900, and in the rail's flow
            it would carry the trail that far down the picture with it. Measured
            open: the other two groups stay at y=77, h=38, unmoved. */}
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
              /* FINDING ONE OF FOUR HUNDRED ORGANIZATIONS BY NAME — budget E3,
                 and the screen's half of it. FilterBar matches the typed words
                 against every node's `name` AND `name_ar`, folded; WHERE a pick
                 lands is this file's decision, because only this file has a
                 camera and a panel.

                 BOTH VERBS, IN ONE TAP. `setSubject` opens that organization's
                 panel — the same branch panel a portfolio row tap opens, and
                 through `subjectForLens` it KEEPS the lens the reader is in
                 rather than throwing them onto `shape`. Then, only where a
                 canvas is actually drawn, the camera makes the minimum move to
                 it: `flyToId` frames a world by id and is a NO-OP for a node
                 that is not in the current drawing, which is the honest answer
                 for an organization inside a collapsed branch — the panel still
                 opened, so the reader still arrived.

                 The stage test is `lens.stage`, not the lens: `board`, `numbers`
                 and `portfolio` have no camera to move, and calling `flyToId`
                 under them would be a claim about a picture that is not on
                 screen. Supplying this handler also replaces FilterBar's own
                 fallback (narrow `mapNodeIds` to the node), which is the right
                 answer for a screen with no camera and the wrong one here: it
                 would leave a filter behind that the reader never set. */
              onPickNode={(nodeId) => {
                lens.setSubject({ kind: 'branch', nodeId })
                if (lens.stage === 'map') flyToId(nodeId)
              }}
            />
          </div>

          {/* THE FIVE DESTINATIONS AND THE TWO MODES, at the reading end of the
              same row, at every width and never behind a disclosure. Each chip
              replaces a tab-bar slot, and a tab tap costs one interaction — so
              must a chip. Below 768px this element leaves the rail entirely and
              becomes the pinned bar at the block end, one z-index above the
              sheet, which is why it is a `position: fixed` element that happens
              to be parented here: its DOM seat is what keeps the Tab order. */}
          <div className="mtree-shellbar">
            <MapLensBar
              lens={lens.lens}
              onLens={lens.setLens}
              compact={compact}
              counts={{
                'needs-me': attentionCount,
                'what-changed': changesCount,
                portfolio: atRiskCount,
              }}
            />
            <MapModeBar
              compact={compact}
              exporting={toolbar.exporting}
              onExport={toolbar.runExport}
            />
          </div>

          {/* WHAT THE RINGS ARE MADE OF — on the control row with every other
              control, and no longer alone on a second row at the opposite edge
              of the screen from the row it belongs to. It sits AFTER the modes
              because Tab order is DOM order here (MindtreeShell.test.ts asserts
              it) and a control that reads before the lens chips but focuses
              after them is worse than one placed a group late. */}
          {onTree && (
            <div className="mtree-isle mtree-group">
              <MapToolbar
                dimension={model.dimension}
                onDimension={toolbar.chooseDimension}
                grouping={model.grouping}
                onGrouping={chooseGrouping}
                /* NULL WHEN THERE IS NOTHING TO GROUP — a workspace with no
                   organizations drawn gets the one control it has always had.
                   `hasEntities` is counted off the tree as drawn, so a filter
                   that hides every organization takes the chip with it rather
                   than leaving a control that changes nothing. */
                groupings={model.hasEntities ? CANVAS_GROUPINGS : null}
                compact={compact}
              />
            </div>
          )}

          {/* WHERE THE READER IS INSIDE THE RINGS, and whether what is drawn is
              all of it. Both are INDICATORS rather than controls — the trail is
              the way back out of a drill-in, the note is a fact about the
              drawing — so they sit under the rail rather than on it, at the
              canvas's reading start. A child of the rail and not a sibling,
              because on a phone the whole rail is one inline scroller and the
              trail scrolls with it rather than costing the map a second row.

              THE TRAIL'S SOURCE IS THE CAMERA, NOT A DRILL-IN. `diveTrail` is
              `ancestorWorlds(layout, worldAt(camera))` — root first, where you
              are LAST, inclusive — which is `FocusView.trail`'s shape exactly,
              so nothing inside the component changes. It is DERIVED, so it
              cannot drift from the picture: there is no state for it to drift
              from, and the name hands off from the rim label to the crumb at
              the 0.85V crossing and at no other instant. A crumb press is a
              fly, not a re-root.

              `diveTrail.length > 1` AND NOT `onMap`, and the difference is one
              empty plate: `Breadcrumb` returns null at the root world (a trail
              of one is not a trail), so a plate opened on `onMap` alone drew an
              18x6px box of border and background at the canvas's start corner —
              measured in the browser at 1600x900 with no tracks. The island and
              the component must agree about having nothing to say. */}
          {(onMap && diveTrail.length > 1) || model.truncated || nodesTruncated ? (
            <div className="mtree-isle mtree-work">
              {onMap && <Breadcrumb trail={diveTrail} onFocus={flyToId} />}

              {model.truncated && <p className="mtree-note">{t('mindtree.truncated')}</p>}
              {nodesTruncated && <p className="mtree-note">{t('mindtree.nodesPartial')}</p>}
            </div>
          ) : null}
        </div>
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
          ) : lens.stage === 'portfolio' ? (
            /* THE PORTFOLIO, AND IT SITS ABOVE THE THREE NON-DRAWING GUARDS ON
               PURPOSE — beside `board` and `numbers` rather than below them.
               Those guards (`showSkeleton`, `showError`, `noTracks`) are about
               THE ENTRIES: the map cannot draw until the working set lands and
               says so. This table's rows come from the hierarchy — an
               organization with nothing filed against it is a row, and the
               exception list exists to show exactly those — so a portfolio held
               behind "no entries yet" would blank the one surface that has an
               answer in a workspace nobody has filed anything in.

               `onOpenNode` is `setSubject`, not `focusBranch`: tapping an
               organization opens the panel beside the table and MOVES NOTHING
               on the canvas, which is the owner's own correction. `setSubject`'s
               branch arm keeps the current lens through `subjectForLens`, so the
               tap does not throw the reader back to `shape`. */
            <PortfolioStage
              root={model.tree}
              filter={filter}
              onNarrow={setFilter}
              view={portfolio}
              onView={setPortfolio}
              textOf={model.textOf}
              // THE TWO POLICIES THE TABLE MUST NOT OWN, handed down from the
              // one place that already holds them. `TERMINAL_STATUS` is
              // lib/mapNodes.ts's "the terminal status is a parameter, never the
              // literal" — this file already imports it for the canvas's
              // underscore — and `managerLabel` is MapBranchDetail's roster rule
              // ("an id the roster does not know is a person who left, not
              // nobody"). Passing both also keeps the import graph acyclic: the
              // org panel mounts this file's stage picker.
              terminalKey={TERMINAL_STATUS}
              managerNameOf={portfolioManagerName}
              onOpenNode={(nodeId) => lens.setSubject({ kind: 'branch', nodeId })}
              compact={compact}
              announce={setLive}
            />
          ) : lens.stage === 'numbers' ? (
            <NumbersStage filter={filter} compact={compact} rtl={rtl} announce={setLive} />
          ) : showSkeleton ? (
            <div className="mtree-canvas">
              <Skeleton height={320} />
            </div>
          ) : showError ? (
            /* WHEN THERE IS NO DRAWING, WHAT THE CANVAS SAYS IS THE SCREEN, and
               the floating rail may not land on it. `.empty-state` is a column
               with 48px of block-start padding, so on a full-bleed stage the
               sentence began at the same block start as the chrome floating over
               it: at 1600x900 the lens island covered "An admin creates tracks
               from Settings…" from the word "adm" onward, which reads as a
               truncation bug rather than as an occlusion.

               `.mtree-blank` is the fix, and it is the one that does not cost a
               word: the sentence is not shortened, not shrunk and not moved off
               the centre line — it is centred in THE SPACE THE RAIL LEAVES
               instead of in the whole stage, which is a block-start reserve and
               nothing else (mindtree.css). Every non-drawing state gets it, so
               a failed load and a filtered-to-nothing map are placed by the same
               rule as an empty workspace. */
            <div className="mtree-blank">
              <EmptyState
                title={t('mindtree.errLoad')}
                description={model.error ?? undefined}
                action={
                  <button type="button" className="btn" onClick={() => void refreshEntries()}>
                    {t('mindtree.refresh')}
                  </button>
                }
              />
            </div>
          ) : noTracks ? (
            <div className="mtree-blank">
              <EmptyState
                title={t('mindtree.emptyTracks')}
                description={t('mindtree.emptyTracksHint')}
              />
            </div>
          ) : nothing && filtered ? (
            <div className="mtree-blank">
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
            </div>
          ) : model.tree.count === 0 && !filtered ? (
            <div className="mtree-blank">
              <EmptyState title={t('mindtree.empty')} description={t('mindtree.emptyHint')} />
            </div>
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
          // NO `countLabel`. It used to arrive here as `mindtree.countOpen` with
          // `model.tree.count`, which is the SAME number the summary sentence
          // already carries in its `{open}` slot from the same expression — so
          // the screen read "0 open" twice, the second time on its own line and
          // larger than the sentence containing it. The fragment is gone; the
          // sentence, which also carries the tracks and the breaches, stays.
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
          mode={addAt.mode}
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
