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
//   HEADER    FilterBar · MapToolbar · MapLensBar · MapModeBar
//   STAGE     map | board | numbers | table        PANEL   needsMe | branch |
//                                                          changes | numbers
//   COMPOSER  MapCapture — always mounted, never remounted
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
//                    effects keep the position they had in the undivided file
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

import { useCallback, useId, useRef, useState, type ReactElement, type ReactNode } from 'react'
import FilterBar, { type FilterFacet } from '../components/FilterBar'
import { EmptyState, Skeleton } from '../components/shared'
import MindtreeTable, {
  filterForCell,
  type MindtreeTableRow,
} from '../components/mindtree/MindtreeTable'
import Breadcrumb from '../components/mindtree/Breadcrumb'
import NodeMenu from '../components/mindtree/NodeMenu'
import QuickAdd from '../components/mindtree/QuickAdd'
import { useMindPulses } from '../components/mindtree/PulseLayer'
import { MindDragLayer } from '../components/mindtree/DragLayer'
import BoardStage from '../components/map/BoardStage'
import MapBranch from '../components/map/MapBranch'
import MapCanvas from '../components/map/MapCanvas'
import MapCapture from '../components/map/MapCapture'
import MapChanges, { useChangesCount } from '../components/map/MapChanges'
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
import type { MapLens, PanelSubject } from '../lib/mindtree/lens'
import { refreshEntries } from '../store/entries'
import { useMapLens } from './map/useMapLens'
import { useMapCursor } from './map/useMapCursor'
import { useMapDrag, useMapDragPressing } from './map/useMapDrag'
import { useMapFocus } from './map/useMapFocus'
import { useMapGeometry, ZOOM_STEP } from './map/useMapGeometry'
import { useMapKeyboard } from './map/useMapKeyboard'
import { useMapModel } from './map/useMapModel'
import { useMapOverlays } from './map/useMapOverlays'
import { useMapToolbarActions } from './map/useMapToolbar'
import { useMapUrl } from './map/useMapUrl'
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
  'mine',
  // Above `track`, per FilterBar's DEFAULT_FACETS. On this screen it is also the
  // cheapest way to halve the map: ring 1 is one node per track, so narrowing to
  // one group is the difference between nine branches and six on the phone,
  // where the header explains one ring has to fit a 375px viewport.
  'group',
  'track',
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

  const model = useMapModel(compact, locale)

  const focus = useMapFocus({
    tree: model.tree,
    focusPref: model.focusPref,
    entriesLoaded: model.entriesLoaded,
    expandedIds: model.expandedIds,
    textOf: model.textOf,
    setLive,
  })

  const geo = useMapGeometry({
    drawnRoot: focus.drawnRoot,
    compact,
    density: model.density,
    rtl,
    svgRef,
    setLive,
    isPressing,
  })

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
    filter: model.filter,
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
   * WHAT THE SHELL IS FOR — and, from it, which stage draws and what the panel
   * is about.
   *
   * Called HERE, between the toolbar and the pulses, and the position is
   * argued rather than convenient: it needs `focus.focusView.focusId` — the
   * drill-in as RESOLVED, not as persisted, so the branch panel can never
   * address a node the canvas is not drawing — and the pulses below need the
   * stage it derives. It reorders none of the eleven.
   */
  const lens = useMapLens({
    focusNodeId: focus.focusView.focusId,
    compact,
    announce: setLive,
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
  const attentionCount = useAttentionCount(model.filter)
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
  const filtered = !isFilterEmpty(model.filter)

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
   */
  const onJump = useCallback(
    (next: MapLens, patch: Partial<FilterState>) => {
      lens.setLens(next)
      model.setFilter({ ...model.filter, ...patch })
    },
    [lens, model],
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
    const subject: PanelSubject = lens.subject
    switch (subject.kind) {
      case 'none':
        return null
      case 'needsMe':
        return {
          title: t('mindtree.panelNeedsMe'),
          body: (
            <MapList
              filter={model.filter}
              scope={focus.drawnRoot}
              textOf={model.textOf}
              onFocus={focus.focusBranch}
              compact={compact}
              announce={setLive}
              // WITHOUT THIS PROP THE PANEL HAS NO Everyone/Mine PAIR. MapList
              // renders the segment only when it is given a writer, precisely so
              // it can never hold a second, private copy of `mine` that would
              // disagree with the FilterBar above it the first time either was
              // touched alone. The shell owns the filter; the panel writes to it.
              onFilter={model.setFilter}
            />
          ),
        }
      case 'branch':
        return {
          title: t('mindtree.panelBranch', { label: model.textOf(focus.drawnRoot.label) }),
          body: (
            <MapBranch
              node={focus.drawnRoot}
              path={focus.focusView.trail}
              filter={model.filter}
              dimension={model.dimension}
              textOf={model.textOf}
              onFocus={focus.focusBranch}
              compact={compact}
              announce={setLive}
            />
          ),
        }
      case 'changes':
        return {
          title: t('mindtree.panelChanges'),
          body: <MapChanges compact={compact} announce={setLive} />,
        }
      case 'numbers':
        return {
          title: t('mindtree.panelNumbers'),
          body: <NumbersPanel filter={model.filter} compact={compact} onJump={onJump} />,
        }
    }
  })()

  /**
   * The open tree's own chrome — the toolbar, the trail and the bulk bar. None
   * of the three means anything over a board or a chart: there is no ring to
   * zoom, no branch to be inside, and nothing on those surfaces that the map's
   * selection can carry.
   */
  const onTree = lens.stage === 'map' || lens.stage === 'table'

  return (
    <div className="mtree">
      <header>
        <h1 className="page-title">{t('mindtree.title')}</h1>
        <p className="page-subtitle mtree-sub">{t('mindtree.subtitle')}</p>
      </header>

      <FilterBar
        value={model.filter}
        onChange={model.setFilter}
        facets={lens.lens === 'numbers' ? NUMBERS_FACETS : FACETS}
        tags={model.tags}
        count={model.tree.count}
        resultLabel={(n) => t('mindtree.countOpen', { count: n })}
      />

      {/* THE FIVE DESTINATIONS AND THE TWO MODES, in one row, at every width and
          never behind a disclosure. Each chip replaces a tab-bar slot, and a tab
          tap costs one interaction — so must a chip. */}
      <div className="mtree-shellbar">
        <MapLensBar
          lens={lens.lens}
          onLens={lens.setLens}
          stage={lens.stage}
          onStage={lens.setStage}
          compact={compact}
          counts={{ 'needs-me': attentionCount, 'what-changed': changesCount }}
        />
        <MapModeBar compact={compact} />
      </div>

      {onTree && (
        <MapToolbar
          dimension={model.dimension}
          onDimension={toolbar.chooseDimension}
          view={model.view}
          compact={compact}
          density={model.density}
          onDensity={toolbar.chooseDensity}
          onExpandAll={toolbar.expandAll}
          onCollapseAll={toolbar.collapseAll}
          zoomPercent={geo.zoomPercent}
          zoomStep={ZOOM_STEP}
          onZoom={geo.zoomBy}
          onFit={geo.resetView}
          exporting={toolbar.exporting}
          onExport={toolbar.runExport}
        />
      )}

      {model.truncated && <p className="mtree-note">{t('mindtree.truncated')}</p>}

      {/* The trail, INCLUSIVE of where you are — Breadcrumb renders the tail as
          a heading and everything before it as links, and draws nothing at all
          for a trail of one (the unfocused map). Only in map view: the table is
          the whole workspace's ledger and is not drilled into. */}
      {onMap && <Breadcrumb trail={focus.focusView.trail} onFocus={focus.focusBranch} />}

      {/* THE BULK BAR, and it must not lie: `pruneMindSelection` has already
          dropped anything the reader can no longer see, so this count is a count
          of rows on the screen. It is the other half of the redistribution
          gesture — tick six, then drag one and all six travel, or open the menu
          on the person who should take them and apply. */}
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

      {/* THE PANEL IS OFFERED BACK IN ONE TAP. Closing it is how a reader gives
          the picture the whole width; needing to hunt for the way back would
          make that a decision rather than a glance. */}
      {panel !== null && !lens.panelOpen && (
        <button
          type="button"
          className="btn btn-sm btn-ghost mtree-panel-show"
          onClick={() => lens.setPanelOpen(true)}
        >
          {t('mindtree.panelShow')}
        </button>
      )}

      {/* THE SPLIT. The panel is a SIBLING of the canvas — `.mtree-canvas` is
          `overflow: hidden; touch-action: none`, and `touch-action` intersects
          down the ancestor chain, so a list rendered inside it could not be
          scrolled with a finger at all. */}
      <div className="mpan-split">
        <div className="mpan-stage">
          {lens.stage === 'board' ? (
            <BoardStage filter={model.filter} compact={compact} rtl={rtl} announce={setLive} />
          ) : lens.stage === 'numbers' ? (
            <NumbersStage filter={model.filter} compact={compact} rtl={rtl} announce={setLive} />
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
                  onClick={() => model.setFilter({ ...EMPTY_FILTER })}
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
                model.setFilter(filterForCell(model.filter, model.dimension, row))
              }
            />
          ) : (
            <MapCanvas
              canvasRef={geo.canvasRef}
              svgRef={svgRef}
              layout={geo.layout}
              order={geo.order}
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
            nothing focused is `none`, and the map takes the whole width. */}
        {panel !== null && (
          <MapPanel
            open={lens.panelOpen}
            compact={compact}
            detent={lens.detent}
            onDetent={lens.setDetent}
            onClose={() => lens.setPanelOpen(false)}
            title={panel.title}
          >
            {panel.body}
          </MapPanel>
        )}
      </div>

      <MapSummary
        showMapChrome={onMap}
        compact={compact}
        hintId={hintId}
        summary={model.summary}
        busiest={model.busiest}
        topGroup={model.topGroup}
        live={live}
      />

      {/* THE GHOST, THE REASON AND THE DRAG'S OWN LIVE REGION — outside the
          <svg>, as a sibling of the canvas. `.mtree-canvas` is `overflow:
          hidden`, so a ghost drawn inside the drawing would be clipped at the
          exact moment a reader drags toward the edge to make the map auto-pan.
          It carries its own polite region rather than borrowing MapSummary's:
          this screen's region is the map's commentary ("Zoom 140%") and a drag
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
