// The Mindtree — the shape of the workload, as a map.
//
// /tracks answers "what is open, and who has it?" — a working list. This
// answers the question an ops lead asks in the ninety seconds before a steering
// meeting: WHERE IS THE MASS. Which track is bloated, who is carrying it, what
// has gone red. One glance, no rows read. It is a sibling of /tracks, not a
// replacement, which is why the handoff proposes a List | Map switcher on that
// screen rather than a sixth nav destination.
//
// THIS FILE COMPOSES; IT DOES NOT COMPUTE. Eleven modules own the hard parts and
// almost none of them knows about the others:
//
//   lib/mindtree/model.ts    entries + tracks + vocabulary → a MindNode tree.
//                            Filters FIRST, then buckets, so a branch labelled
//                            12 is showing 12. Every count rolls up exactly.
//   lib/mindtree/layout.ts   the tidy-tree geometry, mirrored for RTL inside
//                            the module, so nothing here multiplies an x by a
//                            direction. Deterministic — no force simulation.
//   lib/mindtree/export.ts   the deck-ready SVG and PNG.
//   lib/mindtree/drag.ts     where the pointer is, in layout units, and which
//                            branch it is over.
//   lib/mindtree/dropRules.ts what a drop MEANS — the patch, the no-op, or the
//                            refusal, folded over the WHOLE root-to-target path.
//   lib/mindtree/actions.ts  what a node OFFERS, and the sentence naming every
//                            refusal. Pure; it takes the root-to-node path.
//   lib/mindtree/focus.ts    the drill-in model and the URL codec.
//   lib/mindtree/pulse.ts    which change is worth a mark, and for how long.
//   store/mindtree.ts        the screen's own state: dimension, view, density,
//                            focus, collapse, hover, selection, drag.
//   components/mindtree/*    the node, the edge, the table, and the five
//                            interactive layers (drag, menu, quick-add, card,
//                            pulses).
//
// What is left for this file is the four things that are genuinely a screen's
// job: reading the stores, resolving labels against the live locale, holding the
// interaction state the store does not (zoom, pan, the roving cursor), and
// wiring the keyboard.
//
// ── THE THREE READINGS, AND WHERE EACH ONE LIVES ───────────────────────────
//
// The owner asked for the map to be worked IN, explored, and watched, and chose
// all three. They are not three features bolted together; they are three layers
// over one tree, and each one is a module this file mounts:
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
// ── THE KEYBOARD IS THE FEATURE, NOT THE FALLBACK ──────────────────────────
//
// The drawing is `role="tree"` with `role="treeitem"` nodes carrying
// `aria-level`/`aria-posinset`/`aria-setsize`, a roving tabindex, and the APG
// tree walk: Down/Up move to the next and previous VISIBLE node (not the next
// sibling — that is the pattern every tree widget a user has met behaves like),
// Right opens a branch and then steps into it, Left closes it and then steps
// out, Home/End jump to the ends, Enter opens an entry. RIGHT AND LEFT SWAP IN
// ARABIC, because "toward the children" is an inline-end concept and the
// drawing already mirrored; an arrow key that pointed at the trunk in one
// language and at the leaves in the other would be the single most disorienting
// thing on this screen.
//
// The nodes are rendered FLAT — every treeitem is a direct child of the tree,
// with `aria-level` carrying the structure. That is a supported ARIA tree
// shape, and it is the only one available here: the drawing is positioned
// absolutely in one coordinate space, so a DOM nesting that mirrored the tree
// would require nested transforms whose geometry the layout module does not
// (and should not) emit.
//
// ── SPACE AND ENTER: THE ONE COLLISION, RESOLVED BY NODE KIND ──────────────
//
// This is the decision the interactive build could most easily have got wrong,
// so it is stated before the code that implements it.
//
// Two standards meet on this screen and both are right. The APG TREE pattern
// says Space and Enter both activate the focused item. The APG DRAG-AND-DROP
// pattern says Space picks the focused item up. Before this build, Space and
// Enter were synonyms here (`case 'Enter': case ' ':`). They can no longer be.
//
// THE RULE IS THE NODE'S KIND, NOT THE READER'S PERMISSIONS:
//
//   on a BRANCH (root, track, group, "+N more")   Space === Enter === open or
//                                                 close this branch. Space never
//                                                 grabs, because dropRules
//                                                 refuses a branch drag by name
//                                                 — a bulk re-file with no undo.
//   on an ITEM (an entry leaf)                    Enter opens it. Space GRABS
//                                                 it, always — and when this
//                                                 reader may not move this item,
//                                                 Space says why in the live
//                                                 region and does nothing else.
//
// The "and does nothing else" is the load-bearing half, and it is this file's
// addition rather than DragLayer's. DragLayer's `handleKeyDown` returns false on
// an item it cannot lift, which would have left the key falling through to
// "open the entry" — and THAT is the shape the brief rules out: a key that moves
// an item you own and opens an item you do not. So a leaf swallows Space
// whatever the answer, and the reader hears the same refusal the node menu and
// the drag badge show, from `actions.ts`'s exported WHY_* constants. One wall,
// one sentence, three ways of meeting it.
//
// Everything else is additive and collides with nothing. While something IS
// lifted, DragLayer consumes the arrows, Enter and Escape — it is asked first,
// and it answers true only when a lift is in flight or beginning. ContextMenu
// and Shift+F10 (`isMenuKey`) open the node menu; neither key did anything on
// this screen before. Ctrl+Space toggles the selection, which is the APG
// multi-select tree's own binding for exactly that.
//
// ESCAPE IS A STACK, and its order is: cancel the lift → dismiss the hover card
// → step out one ring. The card's dismissal is a direct call
// (`dismissMindNodeCard`) rather than an overlay-stack subscription, for the
// ordering reason NodeCard.tsx's header gives: React's handler on the <svg>
// fires before lib/overlayStack's document listener, so the page's own Escape
// would otherwise always win and the card would be the one thing on this screen
// Escape could not close.
//
// ── ZOOM IS A viewBox, NEVER A CSS TRANSFORM ───────────────────────────────
//
// A `scale()` on the <svg> resamples text (it blurs) and, worse, moves
// hit-testing away from where the marks appear at fractional scales. So zoom
// and pan are arithmetic on the viewBox, exactly as lib/mindtree/layout's
// `fitToViewBox` is written to support. `pan === null` means "stay fitted",
// which is why expanding a branch re-fits the map for free and a user who has
// panned is never yanked back.
//
// ── THE SMALL SCREEN, HONESTLY ─────────────────────────────────────────────
//
// MINDTREE-SPEC asks for root + tracks + groups under 768px and says, in the
// same breath, that a cramped map is worse than an honest one. It is worth
// reading those two sentences together, because the first one loses.
//
// MEASURED, not judged by eye: a five-track workspace laid out for the 341x422
// canvas a 375px phone actually gives you comes to 464x584 drawing units at
// three rings, `fitToViewBox` returns 0.66, and the 12.5px label renders at
// 8.2px. Shrinking the node to its narrowest legible width (108px) only buys
// 8.5px, because what binds is three rings across the inline axis, not the
// size of the boxes. At ONE ring the same workspace is 298x260, the scale is
// 0.96, and the label is 12.0px — full size.
//
// So the phone gets one ring per screen and every tap goes one ring deeper:
// tracks, then that track's groups, then that group's items, with a breadcrumb
// back and pinch/pan throughout. It is a genuinely good one-handed experience
// rather than a bad small map, which is the outcome the spec asked for when it
// said to choose. `mindtree.mobileHint` says so on the screen.
//
// ── AND THE BIG SCREEN, FOR THE SAME REASON ────────────────────────────────
//
// The desktop had the identical defect and nobody had measured it, because a
// desktop map "fits". The first cut opened every branch through ring 3 and gave
// `fitToViewBox` no floor, so a six-track workspace with 31 open items fitted at
// 0.23: every node on the map was 10 CSS px tall — under WCAG 2.5.8's 24, under
// the app's own 44 — and the 12.5px label rendered at 2.9px. The zoom could not
// rescue it either, because the ceiling was a multiple OF THE FIT.
//
// Three numbers fix it and all three are derived rather than chosen. The map
// OPENS AT THE TRACK RING (`OPEN_DEPTH`), which fits at 1:1. The fit REFUSES to
// shrink past a 24px node (`MIN_TARGET_PX`) and overflows into the pan that was
// already built. And the zoom is bounded on the EFFECTIVE scale, so + always
// reaches 1:1 however large the tree is.
//
// ── EVERY WRITE IS THE STORE'S WRITE ───────────────────────────────────────
//
// A drag is a mutation of real work, and so is a menu item. Both go through
// `store/entries.patchEntry` — the optimistic-write-plus-rollback path the board
// and the entry sheet already use — and neither goes anywhere else. This file
// owns no request, no retry and no rollback of its own. That is what makes "a
// mis-drop is undoable" true without an undo stack: the tree is rebuilt from the
// store, so putting an entry back is not an action this file performs, it is the
// absence of a change this file never made. A failure surfaces as the store's own
// `pgErrorKey` sentence, in a toast, with the map already back where it was.
//
// The bulk arm runs through `lib/pooled` at the shared write concurrency rather
// than firing eighteen requests at once. THE CONFIRMATION IS NOT THIS FILE'S:
// `MIND_BULK_CONFIRM_AT` is applied inside NodeMenu and inside DragLayer, each
// beside the gesture it guards, and both hand this file a run that has already
// been agreed to. A page that asked as well would ask twice.
//
// ── THE FOCUS IS IN THE URL ────────────────────────────────────────────────
//
// `?focus=root/track:<id>/group:<key>` and `?group=<dimension>`, through
// focus.ts's codec. A node id IS its path (model.ts builds it that way), so the
// param needs no second field to say where it sits, and a link survives a regroup
// because the `root/track:X` prefix still names the same track after every
// `group:` segment has been rewritten.
//
// The STORE remains the source of truth and the URL is its mirror, seeded from
// it on first paint and written with `replace` thereafter — Board.tsx and
// FollowUps.tsx's reasoning, which is that a history entry per interaction makes
// Back unusable. The URL wins only when it arrives with an opinion this session
// did not put there, which is exactly the paste-a-link case it exists for.
//
// ── WHAT IT DOES NOT DO ────────────────────────────────────────────────────
//
// It reads the entries store like every other screen and never runs its own
// query, so PostgREST's 1000-row clamp is honoured by inheritance and the
// truncation notice is the store's own flag. It picks no colour: every hue
// arrives as the `--track-c-*` pair the model stapled on. It adds no
// dependency: the whole map is hand-rolled SVG.

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react'
import { useSearchParams } from 'react-router-dom'
import FilterBar, { type FilterFacet } from '../components/FilterBar'
import { EmptyState, Skeleton } from '../components/shared'
import { IconChart, IconLayers } from '../components/icons'
import { toast } from '../components/toast'
import MindEdge from '../components/mindtree/MindEdge'
import MindNode, { type MindNodeView } from '../components/mindtree/MindNode'
import MindtreeTable, {
  filterForCell,
  type MindtreeTableRow,
} from '../components/mindtree/MindtreeTable'
import Breadcrumb from '../components/mindtree/Breadcrumb'
import NodeCard, { dismissMindNodeCard, NODE_CARD_ID } from '../components/mindtree/NodeCard'
import NodeMenu, {
  isMenuKey,
  type MindMenuChoice,
  type MindMenuChoices,
  type MindMenuRun,
} from '../components/mindtree/NodeMenu'
import QuickAdd from '../components/mindtree/QuickAdd'
import PulseLayer, { useMindPulses } from '../components/mindtree/PulseLayer'
import {
  MindDragLayer,
  MindDropTargets,
  useMindDragLayer,
} from '../components/mindtree/DragLayer'
import { canNudge, askOffer, outstandingAsk } from '../components/entry/NudgeButton'
import { isolate } from '../lib/bidi'
import { formatTimestamp } from '../lib/dates'
import { EMPTY_FILTER, isFilterEmpty, type FilterState } from '../lib/entryFilter'
import { t, useLocale } from '../lib/i18n'
import { useTrackLabel } from '../lib/labels'
import { canEditEntry } from '../lib/permissions'
import { pooled } from '../lib/pooled'
import {
  DEFAULT_GAP,
  DEFAULT_NODE_SIZE,
  fitToViewBox,
  layoutMindtree,
  sizeForCount,
  zoomLimits,
  type Gap,
  type NodeSize,
  type PositionedNode,
} from '../lib/mindtree/layout'
import {
  MIND_DIMENSIONS,
  ROOT_ID,
  buildMindtree,
  groupTotals,
  type MindDimension,
  type MindLabel,
  type MindNode as MindNodeModel,
  type MindTrack,
  type MindVocabOption,
} from '../lib/mindtree/model'
import {
  MINDTREE_MIME,
  copyPngToClipboard,
  downloadBlob,
  mindtreeFilename,
  serializeMindtreeSvg,
  svgToPngBlob,
} from '../lib/mindtree/export'
import {
  WHY_GONE,
  WHY_NOT_YOURS,
  WHY_SIGNED_OUT,
  type MindActionCtx,
  type MindNudgeVerdict,
} from '../lib/mindtree/actions'
import { NO_VALUE, NAME_PREFIX, DROP_UNCHANGED_KEY } from '../lib/mindtree/dropRules'
import {
  dimensionStableId,
  refocusTarget,
  resolveFocus,
  trailTo,
  viewFromParams,
  viewToParams,
} from '../lib/mindtree/focus'
import {
  loadEntries,
  loadTrackSlas,
  patchEntry,
  refreshEntries,
  useEntriesError,
  useEntriesLoading,
  useEntriesLoadedOnce,
  useEntriesTruncated,
  useEntryList,
  useEntryMap,
  useFilterContext,
  useHealthMap,
} from '../store/entries'
import {
  clearMindSelection,
  collapseMindAll,
  expandMindAll,
  expandMindNode,
  pruneMindSelection,
  setMindCollapsed,
  setMindDensity,
  setMindDimension,
  setMindFocus,
  setMindHovered,
  setMindView,
  toggleMindSelected,
  useMindCollapsedIds,
  useMindDensity,
  useMindDimension,
  useMindExpandedIds,
  useMindFocus,
  useMindHoveredId,
  useMindIsDragging,
  useMindSelection,
  useMindSelectionCount,
  useMindView,
  type MindtreeView,
} from '../store/mindtree'
import { useTracks } from '../store/config'
import { useMemberMap, useMembers, memberLabel } from '../store/members'
import { readLocalAsk, sendNudge } from '../store/nudges'
import { useVocabAll, useVocabLabel } from '../store/vocab'
import { useAuth } from '../store/auth'
import { openEntry } from '../store/entrySheet'
import type { Entry, UserRole } from '../types'
import './mindtree.css'

/* ─────────────────────────────── preferences ─────────────────────────────── */

/**
 * EVERY PERSISTED CHOICE NOW LIVES IN `store/mindtree.ts`, under the SAME
 * localStorage key this file used to own (`opstrack_mindtree_v1`).
 *
 * It was moved rather than duplicated, and the difference matters: two modules
 * validating one key is two schemas that drift, and the store's version is
 * strictly the better one — it bounds the persisted arrays (a hand-edited blob
 * cannot make the first paint interesting), it keeps unknown dimension keys
 * instead of destroying a newer build's state, and it clears on sign-out, which
 * a module-level `readPrefs()` in a page could never do. `focus` and `density`
 * are new fields; a device that persisted before this build simply takes their
 * defaults, which is the ordinary case rather than the exceptional one.
 *
 * What is left in this file is the state that is genuinely this screen's and
 * nobody else's: the zoom, the pan, the roving cursor, and the two overlays.
 */

/* ────────────────────────────── the small screen ─────────────────────────── */

const COMPACT_QUERY = '(max-width: 767px)'

function subscribeCompact(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const mq = window.matchMedia(COMPACT_QUERY)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

function readCompact(): boolean {
  // Guarded because the page tests in this repo render through
  // renderToStaticMarkup under vitest's `node` environment, where matchMedia
  // does not exist. Defaulting to the wide layout there is the honest choice:
  // the full map is the screen, and the drill-in is its small-screen shape.
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(COMPACT_QUERY).matches
}

function useIsCompact(): boolean {
  return useSyncExternalStore(subscribeCompact, readCompact, readCompact)
}

/* ──────────────────────────── measuring the canvas ───────────────────────── */

interface Box {
  width: number
  height: number
}

/**
 * The canvas rectangle in CSS pixels, tracked live.
 *
 * charts/geometry.ts's `useChartSize` measures the inline axis only, because a
 * chart's height is a prop. A map is fitted in BOTH axes — `fitToViewBox` takes
 * the min of the two ratios — so this one has to watch the block axis too. The
 * fallback is what the first frame and every non-browser render use: an
 * unmeasured container is 0×0, and `fitToViewBox` would divide by it.
 */
function useBoxSize(fallback: Box): { ref: (el: HTMLDivElement | null) => void; box: Box } {
  const [box, setBox] = useState<Box>(fallback)
  const observed = useRef<ResizeObserver | null>(null)

  const ref = useCallback((el: HTMLDivElement | null) => {
    observed.current?.disconnect()
    observed.current = null
    if (el === null) return

    const measure = (): void => {
      const width = Math.round(el.clientWidth)
      const height = Math.round(el.clientHeight)
      if (width <= 0 || height <= 0) return
      // Guarded on an actual change: ResizeObserver fires on every reflow, and
      // writing the same numbers back would re-render the whole map on a
      // sibling's animation frame.
      setBox((prev) => (prev.width === width && prev.height === height ? prev : { width, height }))
    }

    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    observed.current = observer
  }, [])

  useEffect(() => () => observed.current?.disconnect(), [])

  return { ref, box }
}

/* ───────────────────────────────── the tree ──────────────────────────────── */

/** The two counts the model does not carry, derived once for both views. */
interface NodeStats {
  breached: number
  unassigned: number
}

const NO_STATS: NodeStats = Object.freeze({ breached: 0, unassigned: 0 })

/**
 * Roll `breached` and `unassigned` up the tree, in one post-order pass.
 *
 * The model carries `slaBreached` as a BOOLEAN on every branch — deliberately,
 * because the map's budget is a binary mark and "3 breached" is a number the
 * table carries. Both accessible names need the number, so it is counted here,
 * once, and handed to the picture and the table together. Two passes would be
 * two arithmetics that disagree under exactly the conditions nobody tests.
 *
 * `unassigned` needs the Entry itself (the model deals in counts, not columns),
 * which is why `entryById` is threaded in rather than the whole working set:
 * the tree already decided which rows survived the filter.
 */
function collectStats(
  node: MindNodeModel,
  entryById: ReadonlyMap<string, unknown>,
  isUnassigned: (id: string) => boolean,
  out: Map<string, NodeStats>,
): NodeStats {
  if (node.kind === 'entry') {
    const id = node.entryId
    const stats: NodeStats = {
      breached: node.health.slaBreached ? 1 : 0,
      unassigned: id !== null && entryById.has(id) && isUnassigned(id) ? 1 : 0,
    }
    out.set(node.id, stats)
    return stats
  }
  let breached = 0
  let unassigned = 0
  for (const child of node.children) {
    const stats = collectStats(child, entryById, isUnassigned, out)
    breached += stats.breached
    unassigned += stats.unassigned
  }
  const stats: NodeStats = { breached, unassigned }
  out.set(node.id, stats)
  return stats
}

/*
 * The two tree walks this file used to carry — `findNode` and `pathTo` — now
 * live in lib/mindtree/focus.ts, as `findNode` and `trailTo`.
 *
 * Moved rather than kept, because the drill-in, the drop rules, the node menu
 * and this file all need the root-to-node path and four copies of a four-line
 * walk is four chances for one of them to stop honouring `collapsed` the same
 * way. focus.ts's version also answers `null` for "no such node" where this
 * one answered an empty array, which is the distinction a caller folding a path
 * into a patch has to be able to make.
 */

/* ─────────────────────────────── the screen ──────────────────────────────── */

/** Every facet except `scope`, which this screen pins — see `applied` below. */
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

/**
 * Zoom bounds, IN EFFECTIVE SCALE — drawing units per CSS pixel on screen —
 * rather than in multiples of the fit.
 *
 * The first cut clamped the MULTIPLIER at 4, which reads as generous and is
 * not: on-screen scale is `fit.scale × zoom`, so a map that fits at 0.15 had a
 * ceiling of 0.6 and could not be magnified to a legible size at all, however
 * many times the reader pressed +. The bound has to be on the number the reader
 * can actually see. `zoomLimits()` (lib/mindtree/layout) turns these two into
 * multiplier bounds against the current fit, and always leaves 1 — the fit
 * itself — reachable.
 */
const SCALE_MIN = 0.25
const SCALE_MAX = 3
const ZOOM_STEP = 1.25

/**
 * WCAG 2.5.8's target minimum, in CSS pixels, and the floor under the fit.
 *
 * A node is at least `nodeSize.height` DRAWING units tall, which is 44 — but
 * drawing units are not pixels, and `fitToViewBox` exists to shrink them. With
 * no floor the desktop fit took a six-track workspace to 0.23 and every node on
 * the map to 10 px: under 2.5.8's 24 px, under the app's own 44, and with 2.9px
 * labels. Nor is the spacing exception available, because stacked entry nodes
 * are ~10px apart and their 24px circles would intersect.
 *
 * So the map REFUSES to shrink past a tappable node and overflows instead. The
 * pan is already built and paid for (`touch-action: none`, the pointer drag),
 * the fit-to-view button is one press away, and the default collapse below
 * means the common case never overflows at all.
 */
const MIN_TARGET_PX = 24

/**
 * The ring the map opens at: root + tracks, every track closed.
 *
 * See model.ts's `openDepth` for the arithmetic. The short version is that the
 * canvas is bound on the BLOCK axis — a tidy tree stacks every visible node
 * down it — so ring 2 costs one row per populated track × group cell, and
 * thirty of those do not fit above 0.31. Six track cards do, at 1:1.
 */
const OPEN_DEPTH = 1

/** A pointer that moved further than this was a pan, not a tap. */
const DRAG_SLOP = 4

/**
 * store/entries.ts's private `QUEUED_KEY`, which is NOT a failure: the write is
 * in the outbox and lands on reconnect.
 *
 * Duplicated as a literal because the store does not export it, exactly as
 * pages/Board.tsx, pages/tracks/TracksIndex.tsx and
 * components/mindtree/DragLayer.tsx already do. Four copies of one string is a
 * recorded extension-slot gap, not a licence to reach across the module boundary
 * — and reading it as an error here would tell a reader on a train that the six
 * items they just reassigned went nowhere.
 */
const QUEUED_ERROR_KEY = 'offline.queued'

/** One frozen empty set, so the memo below has a stable reference to return. */
const EMPTY_IDS: ReadonlySet<string> = new Set<string>()

const WIDE_NODE: NodeSize = DEFAULT_NODE_SIZE
const COMPACT_NODE: NodeSize = { width: 132, height: 44 }
const COMPACT_GAP: Gap = { depth: 34, sibling: 10 }

/**
 * The `density: 'compact'` desktop node, and the number that is NOT reduced.
 *
 * The inline axis shrinks (fewer characters of label per card, which the hover
 * card and the table both make good) and the depth gap tightens, because what
 * binds a wide map is rings across. THE BLOCK SIZE STAYS AT 44 — the same 44 the
 * comfortable node uses, and the same 44 `MIN_TARGET_PX / nodeSize.height` builds
 * the fit floor from. A density preference that shrank the touch target would be
 * a preference for failing WCAG 2.5.8, which is not a preference this app offers;
 * what it buys instead is roughly a third more branches on a laptop before the
 * map overflows into the pan.
 */
const DENSE_NODE: NodeSize = { width: 132, height: 44 }
const DENSE_GAP: Gap = { depth: 44, sibling: 12 }

export default function Mindtree(): ReactElement {
  const locale = useLocale()
  const rtl = locale === 'ar'
  const compact = useIsCompact()

  /* ── the persisted half, from the store ─────────────────────────────── */

  const dimension = useMindDimension()
  const view = useMindView()
  const density = useMindDensity()
  /** The DRILL-IN root's node id, or null for the whole map. Not the cursor. */
  const focusPref = useMindFocus()
  const collapsedPref = useMindCollapsedIds()
  const expandedIds = useMindExpandedIds()

  /* ── the session half, which is this screen's alone ─────────────────── */

  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER)
  const [zoom, setZoom] = useState(1)
  /** Bumped by every zoom press; the announcement effect hangs off it. */
  const [zoomTick, setZoomTick] = useState(0)
  /** null = "stay fitted". See the viewBox note in this file's header. */
  const [pan, setPan] = useState<{ x: number; y: number } | null>(null)
  /**
   * THE ROVING TAB STOP — which node the keyboard is on.
   *
   * Named `cursorId` and not `focusId`, which is what it was called before this
   * build. `focus` now means the DRILL-IN (store/mindtree's `focus`,
   * `?focus=` in the URL, `resolveFocus`, the breadcrumb), and two unrelated
   * things called focus in one 1800-line file is how a reader ends up wiring the
   * breadcrumb to the arrow keys.
   */
  const [cursorId, setCursorId] = useState<string | null>(null)
  /**
   * Is the keyboard actually INSIDE the drawing?
   *
   * Only the hover card reads it, and only to answer a question a roving
   * tabindex cannot: `activeId` is never null, because it falls back to the first
   * node so a Tab into the map always lands somewhere — but "where focus WOULD
   * go" is not "where focus IS". See `cardPos`.
   */
  const [treeFocused, setTreeFocused] = useState(false)
  const [currentId, setCurrentId] = useState<string | null>(null)
  /**
   * The page's live region: the sentence AND a counter.
   *
   * The counter keys the rendered child so that saying the same thing twice in a
   * row still mutates the DOM — see the region's own comment. `setLive` keeps
   * its `(text: string) => void` signature because it is handed to `QuickAdd`
   * as `announce`.
   */
  const [live, setLiveState] = useState<{ text: string; seq: number }>({ text: '', seq: 0 })
  const setLive = useCallback((text: string) => {
    setLiveState((prev) => ({ text, seq: prev.seq + 1 }))
  }, [])
  const [exporting, setExporting] = useState(false)
  /** The open node menu — its path is a memo slice, so the component's memo holds. */
  const [menuAt, setMenuAt] = useState<{ nodeId: string; x: number; y: number } | null>(null)
  /** The open quick-add form, same shape and the same reference discipline. */
  const [addAt, setAddAt] = useState<{ nodeId: string; x: number; y: number } | null>(null)

  const entries = useEntryList()
  const health = useHealthMap()
  const entryById = useEntryMap()
  const tracks = useTracks()
  const members = useMembers()
  const memberById = useMemberMap()
  const ctx = useFilterContext()
  const loading = useEntriesLoading()
  const error = useEntriesError()
  const truncated = useEntriesTruncated()
  /**
   * Has the working set landed once? Gates the drill-in reconciler below — see
   * there, and `store/entries.useEntriesLoadedOnce` for why `!loading` is not
   * the same question.
   */
  const entriesLoaded = useEntriesLoadedOnce()
  const trackLabelOf = useTrackLabel()
  const vocabLabelOf = useVocabLabel()
  const { profile } = useAuth()
  /**
   * `null`, never a stand-in id — pages/Board.tsx's rule, restated because the
   * consequence here is a drag rather than a card: `canEditEntry` tests the
   * signed-out case FIRST and answers false, which is what keeps a leaf
   * un-liftable in the moment between mount and the profile arriving. A
   * placeholder would satisfy the open branch's `!!meId` and hand out a gesture
   * the server would then refuse.
   */
  const meId = profile?.id ?? null
  const role: UserRole = profile?.role ?? 'member'

  const hoveredId = useMindHoveredId()
  const selection = useMindSelection()
  const selectionCount = useMindSelectionCount()
  const dragging = useMindIsDragging()

  // Both are read unconditionally — hooks cannot be called in a branch — and
  // the active one is picked below. `useVocabAll`, not `useVocab`: the hidden
  // options matter here, because an entry still holding a retired status must
  // land in its own branch rather than arriving as an undeclared value.
  const statusVocab = useVocabAll('status')
  const priorityVocab = useVocabAll('priority')

  const hintId = useId()
  const svgRef = useRef<SVGSVGElement | null>(null)
  const exportRef = useRef<HTMLDetailsElement | null>(null)
  const nodeRefs = useRef(new Map<string, SVGGElement>())
  /** Set while a pan is in flight, so the click that ends it is not a tap. */
  const draggedRef = useRef(false)
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  const panStartRef = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null)
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null)

  useEffect(() => {
    void loadEntries()
    // Deduped in the store: the Shell warms both on sign-in, and a second call
    // from a screen that genuinely needs them costs nothing.
    void loadTrackSlas()
  }, [])

  /**
   * ESCAPE AND LIGHT-DISMISS FOR THE EXPORT PANEL, because `<details>` provides
   * NEITHER.
   *
   * The first cut chose a `<details>` on the stated grounds that it "gets the
   * disclosure semantics, Escape-to-close and the button role from the
   * platform". Two of those three are true. Only `<dialog>` and the `popover`
   * attribute get Escape and outside-click from the platform; a `<details>`
   * that has been opened stays open forever, and this one is an absolutely
   * positioned panel sitting over the toolbar it was opened from.
   *
   * `<details>` is still the right element — it is a disclosure, not a dialog,
   * and it must not trap focus or make the map inert. So the two behaviours are
   * added rather than the element being swapped, and focus is returned to the
   * summary on Escape, which is the half a naive `el.open = false` gets wrong.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      const el = exportRef.current
      if (el === null || !el.open) return
      el.open = false
      el.querySelector<HTMLElement>('summary')?.focus()
    }
    // pointerdown, not click: a pointer that goes down outside the panel is
    // already a dismissal, and waiting for the click lets a drag that started
    // on the canvas pan the map underneath an open menu.
    const onDown = (event: PointerEvent): void => {
      const el = exportRef.current
      if (el === null || !el.open) return
      if (event.target instanceof Node && el.contains(event.target)) return
      el.open = false
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [])

  /* ── inputs to the model ────────────────────────────────────────────── */

  const mindTracks = useMemo<MindTrack[]>(
    () =>
      tracks.map((track) => ({
        id: track.id,
        // The localised name, never the raw column — lib/labels.trackLabel.
        label: trackLabelOf(track),
        color: track.color,
        colorLight: track.color_light,
        sortOrder: track.sort_order,
        archived: track.archived,
      })),
    [tracks, trackLabelOf],
  )

  const vocab = useMemo<readonly MindVocabOption[]>(() => {
    // Owner and health have no vocabulary: the roster and the four computed
    // levels are the axis, and model.ts takes an empty list for both.
    if (dimension === 'status') return statusVocab
    if (dimension === 'priority') return priorityVocab
    return []
  }, [dimension, statusVocab, priorityVocab])

  /**
   * The filter as the model sees it: SCOPE PINNED OPEN.
   *
   * Pinned here rather than held in `filter` itself, and the difference is not
   * cosmetic — `countActiveFacets()` counts a non-default scope as a facet the
   * reader chose, so holding it in state would make the filter bar claim "1
   * filter" on a screen nobody has filtered, and its Clear-all would then reset
   * the scope and change what the map is about. pages/Dashboard.tsx pins the
   * other direction for the same reason.
   *
   * Open, not all: "the shape of my workload" is a question about work that is
   * still work. Closed items belong to the dashboard's throughput panels.
   */
  const applied = useMemo<FilterState>(() => ({ ...filter, scope: 'open' }), [filter])

  /**
   * COLLAPSE IS MEANINGLESS ON A PHONE, and passing it through anyway is a
   * bug rather than a harmless no-op. The small screen draws ONE ring at a time
   * and every tap drills rather than expands, so there is nothing to collapse —
   * but a branch the reader closed on a desktop is still in this list, and
   * `layoutMindtree` honours `collapsed` as well as `depthLimit`. Drilling into
   * such a track would draw the track and nothing under it: a blank ring with
   * no control on the screen able to un-blank it.
   */
  const collapsedIds = compact ? EMPTY_IDS : collapsedPref

  /**
   * How many leaves a group shows before the tail folds behind "+N more".
   *
   * Tighter on a phone for the obvious reason and because the drill-in is the
   * small-screen path anyway; on a desktop six is where a group stops reading
   * as a shape and starts reading as a list, which is /tracks' job.
   */
  const leafThreshold = compact ? 3 : 6

  const tree = useMemo(
    () =>
      buildMindtree({
        entries,
        health,
        tracks: mindTracks,
        vocab,
        members,
        dimension,
        filter: applied,
        ctx,
        collapsedIds,
        leafThreshold,
        expandedIds,
        // No default collapse on a phone: `depthLimit: 1` below already draws
        // one ring, and a branch marked collapsed under it would draw nothing.
        openDepth: compact ? undefined : OPEN_DEPTH,
      }),
    [
      entries,
      health,
      mindTracks,
      vocab,
      members,
      dimension,
      applied,
      ctx,
      collapsedIds,
      leafThreshold,
      expandedIds,
      compact,
    ],
  )

  const stats = useMemo(() => {
    const out = new Map<string, NodeStats>()
    const isUnassigned = (id: string): boolean => {
      const entry = entryById.get(id)
      if (entry === undefined) return false
      return entry.owner_id === null && (entry.owner_name ?? '').trim() === ''
    }
    collectStats(tree, entryById, isUnassigned, out)
    return out
  }, [tree, entryById])

  /* ── labels ─────────────────────────────────────────────────────────── */

  /**
   * A node's own text.
   *
   * The discriminated `MindLabel` is what makes this safe to write once: a
   * `key` label goes through t() and a `text` label — a track name, a person's
   * name, an entry title — never does. Handing database text to t() renders it
   * back verbatim (t() echoes an unknown key), so the bug would be invisible in
   * English and catastrophic in Arabic, where the untranslated string is the
   * one thing that had to keep its own direction.
   */
  const textOf = useCallback((label: MindLabel): string => {
    if (label.kind === 'key') return t(label.key, label.vars ? { ...label.vars } : undefined)
    const trimmed = label.text.trim()
    return trimmed === '' ? t('mindtree.untitled') : trimmed
  }, [])

  const dimensionLabel = t(
    MIND_DIMENSIONS.find((d) => d.key === dimension)?.labelKey ?? 'mindtree.dimStatus',
  )

  /**
   * One view model per node: the display label, the accessible name, the count
   * chip and the two tooltips.
   *
   * Built in a single walk rather than inside the node component, because a
   * filtered-to-everything workspace is several hundred nodes and every one of
   * them would otherwise re-resolve its own label on every pan frame. `locale`
   * is a dependency even though nothing below reads it directly: t() reads
   * lib/i18n's MODULE state, which React cannot watch, so without it here a
   * language switch would re-render the map around a memo full of English.
   */
  const views = useMemo(() => {
    const out = new Map<string, MindNodeView>()

    const sep = t('mindtree.listSep')

    /**
     * The chain of ancestor labels, isolated and joined — "Network, Blocked".
     *
     * It exists for the folds. A "+N more" node's accessible name used to be
     * `showMore` with its GROUP's label alone, which is not unique: "On track"
     * repeats under every track, so two folds hiding 8 items and 3 items shared
     * one byte-identical name and a screen-reader user listing the controls saw
     * the same button twice. Each component is isolated separately rather than
     * the joined string being isolated once, because the separator is the
     * locale's own comma and it belongs to the SENTENCE, not to either label.
     */
    const trail = (ancestry: readonly string[]): string =>
      ancestry.filter((text) => text !== '').map(isolate).join(sep)

    const visit = (node: MindNodeModel, ancestry: readonly string[]): void => {
      const raw = textOf(node.label)
      const stat = stats.get(node.id) ?? NO_STATS

      let name: string
      if (node.kind === 'entry') {
        const entry = node.entryId === null ? undefined : entryById.get(node.entryId)
        const detail: string[] = []
        if (entry !== undefined) {
          // Rendered directly from the live vocabulary, so an admin's rename
          // reaches this sentence with zero writes — the frozen-key payoff.
          detail.push(vocabLabelOf('status', entry.status))
          const owner = memberLabel(memberById, entry.owner_id, entry.owner_name)
          if (entry.owner_id !== null || (entry.owner_name ?? '').trim() !== '') {
            detail.push(t('mindtree.leafOwner', { owner }))
          }
        }
        if (node.health.slaBreached) detail.push(t('mindtree.leafBreached'))
        name = t('mindtree.leafName', { title: raw, detail: detail.join(sep) })
      } else if (node.kind === 'more') {
        // THE VISIBLE LABEL LEADS, then the action. `raw` is "+8 more items",
        // which is what the reader can see and therefore what a voice-control
        // user will say (WCAG 2.5.3, Label in Name) and what carries the count;
        // the `showMore`/`showFewer` clause says what pressing Enter does and
        // names the ancestry that makes this fold different from the other four
        // on screen. The first cut had the action alone, and dropped all three.
        name = t('mindtree.nodeName', {
          label: raw,
          detail: node.collapsed
            ? t('mindtree.showMore', { label: trail(ancestry) })
            : t('mindtree.showFewer', { label: trail(ancestry) }),
        })
      } else {
        const detail = [t('mindtree.countOpen', { count: node.count })]
        if (stat.breached > 0) detail.push(t('mindtree.countBreached', { count: stat.breached }))
        if (stat.unassigned > 0) {
          detail.push(t('mindtree.countUnassigned', { count: stat.unassigned }))
        }
        // Nothing about expansion is appended: `aria-expanded` on the treeitem
        // already announces it, and a name that repeated it would say it twice.
        name = t('mindtree.nodeName', { label: raw, detail: detail.join(sep) })
      }

      out.set(node.id, {
        // Isolated for DISPLAY only. The accessible names above pass `raw`,
        // because the locale templates isolate their own interpolations —
        // `"⁨{label}⁩, {detail}"` — and isolating twice would nest two runs
        // around one value for no benefit.
        label: isolate(raw),
        name,
        count: node.kind === 'entry' ? null : String(node.count),
        toggleHint:
          node.children.length === 0
            ? null
            : node.collapsed
              ? t('mindtree.expandNode', { label: raw })
              : t('mindtree.collapseNode', { label: raw }),
        breachHint: node.health.slaBreached ? t('mindtree.breachHint') : null,
      })

      // The root is the workspace and adds nothing to a fold's ancestry, so it
      // seeds an empty trail rather than "CoreTrack, Network, Blocked".
      const below = node.kind === 'root' ? [] : [...ancestry, raw]
      for (const child of node.children) visit(child, below)
    }

    visit(tree, [])
    return out
    // `locale` is a dependency the rule cannot see the use of, and the same
    // one store/entries.ts and MindtreeTable.tsx suppress for the same reason:
    // every t() above reads lib/i18n's MODULE-level current locale rather than
    // an argument, so without it here a language switch would re-render the map
    // around a memo still holding English labels.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, stats, entryById, memberById, vocabLabelOf, textOf, locale])

  /* ── geometry ───────────────────────────────────────────────────────── */

  /**
   * The drill-in, resolved against the tree AS IT IS RIGHT NOW.
   *
   * `resolveFocus` is total: it answers the subtree, the trail the breadcrumb
   * renders, the id ACTUALLY focused after any fallback, and — when a fallback
   * was taken — the id that was asked for and is gone. The fallback is the
   * DEEPEST SURVIVING ANCESTOR rather than "give up and show everything", which
   * is what makes a focus survive a regroup: switching status→owner rewrites
   * every `group:` segment of the id, but the `root/track:X` prefix still names
   * the same track.
   *
   * A focus can vanish under the reader for four ordinary reasons — the track was
   * archived, a filter keystroke narrowed past it, the last item under it closed,
   * or the dimension changed — and every one of them would otherwise draw an
   * empty canvas with the breadcrumb pointing at a node that is not there.
   */
  const focusView = useMemo(() => resolveFocus(tree, focusPref), [tree, focusPref])
  const drawnRoot = focusView.node

  /**
   * PUT THE STORE BACK IN STEP WITH WHAT IS DRAWN, and say so out loud.
   *
   * store/mindtree's `ensureMindFocus` is the handshake its header asks a surface
   * to call on every rebuild, and this is that call made one step better: it
   * would clear a stale focus to null, and `resolveFocus` has already found the
   * nearest ancestor that is still worth drawing. Writing the resolved id back
   * keeps the persisted preference, the URL and the canvas describing one place;
   * writing null would drop a reader who was two rings deep all the way out
   * because the innermost ring emptied.
   *
   * `missingId !== null` is exactly "a fallback was taken", so the ordinary
   * rebuild — several a second on a live map — does nothing at all here.
   */
  useEffect(() => {
    if (focusView.missingId === null) return
    // NOT BEFORE THE DATA. On a cold load the store is empty for a frame or two,
    // so EVERY focus id resolves to nothing and this would "repair" a perfectly
    // good drill-in to null — which the URL effect then writes back, stripping
    // `?focus=` from the link that was just opened. A shared deep link landed on
    // the whole map with no breadcrumb and no way to tell it had happened. The
    // repair is for a branch that vanished UNDER the reader; until the working
    // set has landed once there is nothing to have vanished from.
    if (!entriesLoaded) return
    setMindFocus(focusView.focusId)
    setLive(
      focusView.focusId === null
        ? t('mindtree.focusGone')
        : t('mindtree.focusGoneTo', { label: textOf(focusView.node.label) }),
    )
  }, [focusView, textOf, entriesLoaded, setLive])

  /**
   * The node box, from the viewport AND the reader's density choice.
   *
   * The phone's size wins outright: it is not a preference there, it is what
   * makes one ring fit 375px at a legible label size (see `depthLimit` below),
   * and offering a "comfortable" that does not fit would be offering a worse
   * screen. On a desktop the two are a real choice and the store remembers it.
   */
  const dense = !compact && density === 'compact'
  const nodeSize = compact ? COMPACT_NODE : dense ? DENSE_NODE : WIDE_NODE
  const gap = compact ? COMPACT_GAP : dense ? DENSE_GAP : DEFAULT_GAP

  /**
   * The busiest branch in the current picture, which is what the area encoding
   * is scaled against. Relative to the workload ON SCREEN rather than to a
   * constant, so a quiet week still shows a shape instead of six identical
   * minimum-size cards.
   */
  const fullAt = useMemo(() => {
    let max = 1
    for (const child of drawnRoot.children) if (child.count > max) max = child.count
    return max
  }, [drawnRoot])

  const sizeOf = useCallback(
    (node: MindNodeModel, depth: number): NodeSize | undefined => {
      // The drawn root is the frame of reference and is not part of the
      // encoding — sizing it by its own total would make it the biggest thing
      // on screen in every workspace, which says nothing.
      if (depth === 0) return undefined
      if (node.kind === 'entry' || node.kind === 'more') {
        // A leaf is one item by definition, so it is never in the encoding
        // either. It gets extra inline room instead, because it carries a
        // sentence-shaped title rather than a one-word bucket name.
        return { width: nodeSize.width * 1.5, height: nodeSize.height }
      }
      return sizeForCount(node.count, {
        min: nodeSize,
        max: { width: nodeSize.width * 1.35, height: nodeSize.height * 1.45 },
        fullAt,
      })
    },
    [nodeSize, fullAt],
  )

  const layout = useMemo(
    () =>
      layoutMindtree(drawnRoot, {
        nodeSize,
        gap,
        sizeOf,
        // ONE RING PER SCREEN ON A PHONE, and this number is measured rather
        // than chosen. MINDTREE-SPEC asks for root + tracks + groups (a limit of
        // 2); laid out for a 341x422 canvas with the tightest node size that
        // still holds a label, a five-track workspace comes to 464x584 drawing
        // units and `fitToViewBox` returns a scale of 0.66 — which renders the
        // 12.5px label at 8.2px. Squeezing the node to 108px only reaches 8.5px,
        // because the binding constraint is the three rings across, not the box.
        // At a limit of 1 the same workspace is 298x260, the scale is 0.96, and
        // the label lands at 12.0px: full size. So the small screen shows one
        // ring at a time and every tap goes one ring deeper, with the breadcrumb
        // as the way back. The handoff states this trade and the numbers behind
        // it plainly; a map whose labels are 8px is the "cramped and unusable"
        // outcome the spec warns against, not a smaller version of this one.
        depthLimit: compact ? 1 : undefined,
        direction: rtl ? 'rtl' : 'ltr',
      }),
    [drawnRoot, nodeSize, gap, sizeOf, compact, rtl],
  )

  const { ref: canvasRef, box } = useBoxSize({ width: 960, height: 520 })

  /**
   * The floor under the fit, DERIVED rather than chosen.
   *
   * `nodeSize.height` is the smallest node the encoding can produce, so
   * `MIN_TARGET_PX / nodeSize.height` is exactly the scale at which the
   * smallest node is still a 24px target. The phone keeps its own, higher floor
   * — 0.62 puts the 12.5px label at 7.8px, which is the point past which a
   * one-handed reader is not reading anything.
   *
   * Below the floor the map overflows and the reader pans. That is the honest
   * outcome and it is now the rare one: `OPEN_DEPTH` means the map opens at the
   * track ring, which fits at 1:1 in every workspace measured.
   */
  const minScale = Math.max(compact ? 0.62 : 0, MIN_TARGET_PX / nodeSize.height)

  const fit = useMemo(
    () =>
      fitToViewBox(layout.bounds, box, {
        padding: 28,
        // Never magnify: text scaled past 1:1 inside a viewBox is text rendered
        // at a size nobody chose.
        maxScale: 1,
        minScale,
      }),
    [layout.bounds, box, minScale],
  )

  /**
   * The window that holds the WHOLE drawing, with no floor and no zoom.
   *
   * Only the export reads it. The on-screen `fit` above refuses to shrink past
   * a tappable node and therefore crops a big map on purpose; a file does not
   * get tapped, so the picture that leaves the app is the whole picture. Same
   * bounds, same padding, same viewport aspect — so the exported frame is the
   * one the reader would see after pressing "Fit to view" on a big enough
   * screen, rather than a different composition.
   */
  const wholeMapFit = useMemo(
    () => fitToViewBox(layout.bounds, box, { padding: 28, maxScale: 1, minScale: 0 }),
    [layout.bounds, box],
  )

  /** The multiplier bounds, against THIS fit — see SCALE_MIN/SCALE_MAX. */
  const zoomBounds = useMemo(
    () => zoomLimits(fit.scale, { minScale: SCALE_MIN, maxScale: SCALE_MAX }),
    [fit.scale],
  )

  /**
   * The zoom, held inside the bounds the CURRENT fit implies.
   *
   * Clamped on read rather than only on write, because the bounds move: an
   * expand, a filter keystroke or a window resize changes `fit.scale`, and a
   * multiplier stored under the old bounds would otherwise strand the reader
   * outside the new ones with the buttons unable to walk back.
   */
  const heldZoom = Math.min(zoomBounds.max, Math.max(zoomBounds.min, zoom))

  const viewWidth = fit.width / heldZoom
  const viewHeight = fit.height / heldZoom
  const centerX = pan?.x ?? fit.x + fit.width / 2
  const centerY = pan?.y ?? fit.y + fit.height / 2
  const viewBox = `${centerX - viewWidth / 2} ${centerY - viewHeight / 2} ${viewWidth} ${viewHeight}`
  const zoomPercent = Math.round(fit.scale * heldZoom * 100)

  /* ── the keyboard walk ──────────────────────────────────────────────── */

  const order = layout.nodes
  const activeId = cursorId !== null && layout.byId.has(cursorId) ? cursorId : (order[0]?.id ?? null)

  const registerRef = useCallback((id: string, el: SVGGElement | null) => {
    if (el === null) nodeRefs.current.delete(id)
    else nodeRefs.current.set(id, el)
  }, [])

  /**
   * Does the map hold real DOM focus right now?
   *
   * `treeFocused` is state and therefore one render behind the unmount it is
   * being asked about; this reads the document. Used only to decide whether a
   * repair is OWED — a rebuild caused by somebody else's realtime patch must
   * never pull focus out of the filter box or off another screen.
   */
  const treeHasFocus = useCallback((): boolean => {
    const svg = svgRef.current
    const active = document.activeElement
    return svg !== null && active !== null && svg.contains(active)
  }, [])

  /**
   * Is the reader's keyboard still ON THIS SCREEN'S gesture?
   *
   * `treeHasFocus()` plus the overlays this page itself raises. A destructive
   * act is confirmed first, and `components/Confirm.tsx` resolves its promise
   * BEFORE the effect that restores focus runs — so at the moment the write is
   * requested, `activeElement` is the dialog's own button and a bare
   * `treeHasFocus()` would decline to repair anything. The reader then lands on
   * `<main>`, which is Confirm's honest fallback for a trigger that unmounted,
   * and not where they were.
   *
   * Safe to widen this far because `requestRefocus` is only ever called from
   * this page's own write paths — a drop and a menu verb — so the dialog or menu
   * holding focus is always the one this gesture opened.
   */
  const gestureHasFocus = useCallback((): boolean => {
    if (treeHasFocus()) return true
    const active = document.activeElement
    return active !== null && active.closest('[role="dialog"], [role="menu"]') !== null
  }, [treeHasFocus])

  /**
   * A WRITE IS ABOUT TO REBUILD THE TREE AROUND THIS ENTRY — put focus back on
   * it afterwards.
   *
   * THE PROBLEM THIS SOLVES. A MindNode id IS its bucket path
   * (`root/track:T/group:G/entry:E`), so ANY successful drop or menu act rewrites
   * the id of the row it moved: a status change rewrites the `group:` segment, a
   * track change rewrites `track:`. Nodes are keyed on that id, so the
   * `<g role="treeitem">` carrying DOM focus UNMOUNTS, and the browser resets
   * `activeElement` to `<body>`. `store/entries.patchEntry` commits the
   * optimistic row before it awaits the request, so this happens synchronously
   * with the gesture — the reader presses Enter to drop and lands at the top of
   * the document. That directly contradicts the drag's own rule: a drag that
   * ends must not have moved the reader's place in the tree as a side effect.
   *
   * THE SHAPE. Requested BEFORE the write (while the old layout is still the
   * one on screen, so the node's outgoing id can be recorded) and performed in a
   * layout effect on the NEW layout, which is the first moment the destination
   * element exists. Three answers, in order: the node now drawing that entry;
   * the nearest surviving ancestor of where it used to be (a close removes the
   * row from the map entirely, and its old branch is still the reader's place);
   * and finally the top of the map, which is where the browser would have put
   * them anyway.
   */
  const refocusRef = useRef<{ entryId: string; fromId: string | null } | null>(null)
  const layoutRef = useRef(layout)
  layoutRef.current = layout

  const requestRefocus = useCallback(
    (entryId: string) => {
      if (!gestureHasFocus()) return
      const fromId = layoutRef.current.nodes.find((p) => p.node.entryId === entryId)?.id ?? null
      refocusRef.current = { entryId, fromId }
    },
    [gestureHasFocus],
  )

  useLayoutEffect(() => {
    const want = refocusRef.current
    if (want === null) return
    refocusRef.current = null
    // `refocusTarget` is the ordering rule and it lives in lib/mindtree/focus.ts
    // beside `nearestId`, where it can be exercised — this file cannot be, in a
    // `node` test environment. Null means "your own fallback", which is the top
    // of the map: where the browser would have left the reader anyway.
    const id =
      refocusTarget(
        order.map((p) => ({ id: p.id, entryId: p.node.entryId })),
        want,
        (c) => layout.byId.has(c),
      ) ??
      order[0]?.id ??
      null
    if (id === null) return
    setCursorId(id)
    nodeRefs.current.get(id)?.focus()
  }, [layout, order])

  useEffect(() => {
    // Keep the roving tab stop on a node that still exists. A filter keystroke
    // can delete the focused branch out from under the reader, and a tabindex
    // pointing at nothing drops them back to the top of the document.
    if (cursorId === null || layout.byId.has(cursorId)) return
    const next = order[0]?.id ?? null
    setCursorId(next)
    // AND THE FOCUS, not only the tab stop. Repairing `tabindex` alone leaves
    // real DOM focus on `<body>` whenever the vanished node was the one carrying
    // it — the tab stop is correct and the reader is nowhere. Guarded on the map
    // ACTUALLY having held focus (`treeFocused`, and the document re-checked
    // because the unmount may already have blurred), so a background rebuild
    // never steals the keyboard from somewhere else on the page.
    if (next === null || !treeFocused || treeHasFocus()) return
    nodeRefs.current.get(next)?.focus()
  }, [layout, cursorId, order, treeFocused, treeHasFocus])

  const moveCursor = useCallback((id: string | undefined) => {
    if (id === undefined) return
    setCursorId(id)
    // Real DOM focus, not just a tabindex change: `aria-activedescendant` is
    // the alternative and it is the weaker one here, because the nodes are
    // genuinely focusable elements and a reader's virtual cursor should land on
    // the mark itself.
    nodeRefs.current.get(id)?.focus()
  }, [])

  /**
   * Both records move on every toggle, and `store/mindtree.setMindCollapsed`
   * owns that rule now — its header states it: an explicit close beats an
   * explicit open beats `openDepth`'s default, so closing a branch must REMOVE
   * it from `opened` or a branch the reader opened could never be closed again.
   *
   * This file used to hold that arithmetic. It was moved rather than wrapped,
   * because the drag layer and the node menu also close branches, and three
   * copies of a two-set invariant is how the two sets end up disagreeing.
   */
  const toggleFold = useCallback((id: string) => {
    // A fold has no closed record to clear — it is closed BY DEFAULT, always —
    // so opening one records the open and closing one removes it. That is
    // `expandMindNode` and `setMindCollapsed(id, true)` respectively, and the
    // store's `expandedIds` is the set to ask.
    if (expandedIds.has(id)) setMindCollapsed(id, true)
    else expandMindNode(id)
  }, [expandedIds])

  /** Every entry currently drawn, in reading order — the sheet's prev/next. */
  const drawnEntryIds = useMemo(
    () =>
      order
        .map((pos) => pos.node.entryId)
        .filter((id): id is string => id !== null),
    [order],
  )

  /**
   * THE BULK BAR MUST NOT LIE, so anything the reader can no longer see is
   * unticked on every rebuild.
   *
   * pages/tracks/TracksIndex.tsx states the rule and a map has three more ways to
   * hide a row than a list does: collapsing a branch, drilling into a different
   * one, and tightening a filter. `pruneMindSelection` returns the same reference
   * when nothing was dropped, so the ordinary rebuild costs no render anywhere.
   */
  const drawnEntryIdSet = useMemo(() => new Set(drawnEntryIds), [drawnEntryIds])
  useEffect(() => {
    pruneMindSelection(drawnEntryIdSet)
  }, [drawnEntryIdSet])

  /* ── what a node offers ─────────────────────────────────────────────── */

  /**
   * The nudge verdict, SUPPLIED rather than computed by `lib/mindtree/actions`.
   *
   * That module's header says why it cannot work this out for itself: `canNudge`
   * / `outstandingAsk` / `askOffer` are documented in
   * components/entry/NudgeButton.tsx as "PURE, EXPORTED, AND THE ONLY
   * DEFINITION", and `src/lib/**` may import neither a component nor a store.
   * The screen already holds all three, so the screen answers.
   *
   * `readLocalAsk` and not `useLocalAsk`: this is a plain function called once
   * per row while a menu is being built, and a hook cannot be called in a loop.
   * The cost is that an ask made in this session while the menu is ALREADY open
   * does not re-grey the row — which cannot happen, because sending one closes
   * the menu.
   */
  const nudgeVerdict = useCallback(
    (entry: Entry): MindNudgeVerdict => {
      // Unassigned, or already yours. `actions.ts`'s own WHY_NO_NUDGE says
      // exactly that, so `null` accepts it rather than restating it here.
      if (!canNudge(entry, meId)) return { offer: null, blockedKey: null }
      const offer = askOffer(outstandingAsk(entry, readLocalAsk(entry.id)))
      // Inside the 24-hour window migration 0019 enforces. The generic sentence
      // would be wrong — there IS somebody to ask — so the precise one is named.
      return { offer, blockedKey: offer === null ? 'nudge.errTooSoon' : null }
    },
    [meId],
  )

  /**
   * The context every action decision is made against — the node menu's, and the
   * keyboard's refusal sentences.
   *
   * MEMOISED BECAUSE `NodeMenu` REQUIRES IT TO BE: its props say `ctx` must be
   * reference-stable while the menu is open, since it keys the memo that builds
   * the rows. Everything in it is either a store value or a stable callback, so
   * it changes when the workspace does and not when the pointer moves.
   */
  const mindCtx = useMemo<MindActionCtx>(
    () => ({
      meId,
      role,
      entryById,
      selection,
      dimension,
      focusedId: focusView.focusId,
      nudge: nudgeVerdict,
    }),
    [meId, role, entryById, selection, dimension, focusView.focusId, nudgeVerdict],
  )

  /* ── the drag ───────────────────────────────────────────────────────── */

  /**
   * Pan by a delta in DRAWING UNITS — what the drag layer's auto-pan and its
   * keyboard reveal both call.
   *
   * ANCHORED IN THE SAME UPDATER, not in a second `setPan` beside it. While `pan`
   * is null the viewBox is recomputed from the fit on every render, so a delta
   * applied to "nothing" would be discarded; and anchoring in a separate write
   * would leave one render between the two in which the map re-centres. One
   * functional updater does both and stays pure, which `zoomBy` below explains
   * at length for the same reason.
   */
  const panBy = useCallback(
    (dx: number, dy: number) => {
      setPan((current) => {
        const base = current ?? { x: fit.x + fit.width / 2, y: fit.y + fit.height / 2 }
        return { x: base.x + dx, y: base.y + dy }
      })
    },
    [fit],
  )

  /**
   * Drop the page's own pan gesture, because the drag has taken it over.
   *
   * Only ever called for a TOUCH lift: a finger is allowed to pan the map from a
   * node until the hold lands (that is the whole argument for the hold), so both
   * gestures are armed for HOLD_MS and one of them has to let go. A mouse press
   * on a draggable node never reaches this component at all — DragLayer stops it
   * — so nothing needs cancelling there.
   */
  const cancelPan = useCallback(() => {
    panStartRef.current = null
    pinchRef.current = null
    pointersRef.current.clear()
    svgRef.current?.removeAttribute('data-panning')
  }, [])

  const labelOf = useCallback((node: MindNodeModel) => textOf(node.label), [textOf])

  /**
   * Open the actions menu on a node.
   *
   * The pointer path passes the gesture's own client coordinates; the KEYBOARD
   * path has none, so it hangs the panel off the node's own box — the corner a
   * click on that card would have landed near. `menuPlacement` flips and clamps
   * from there, so a node at the block-end edge still gets a panel on screen.
   *
   * DECLARED ABOVE THE DRAG CONTROLLER, not beside the other menu code, because
   * the layer takes it as an option: a hold on a phone, where there is nowhere
   * to drop, opens this instead of lifting a ghost.
   */
  const openMenuFor = useCallback(
    (pos: PositionedNode<MindNodeModel>, at?: { x: number; y: number }) => {
      if (at !== undefined) {
        setMenuAt({ nodeId: pos.id, x: at.x, y: at.y })
        return
      }
      const rect = nodeRefs.current.get(pos.id)?.getBoundingClientRect()
      setMenuAt({
        nodeId: pos.id,
        x: rect === undefined ? 0 : rtl ? rect.right : rect.left,
        y: rect === undefined ? 0 : rect.bottom,
      })
    },
    [rtl],
  )


  const dragController = useMindDragLayer({
    // THE WHOLE TREE, never `drawnRoot` — the option's own doc says why: a drop
    // folds the ROOT-to-target path, and on a phone (or two rings into a
    // drill-in) the drawn root is a track, so folding the drawn path would write
    // a status while leaving the row on its old track.
    root: tree,
    layout,
    dimension,
    entryById,
    meId,
    role,
    rtl,
    focusedId: activeId,
    svgRef,
    labelOf,
    onPanBy: panBy,
    onPanCancel: cancelPan,
    // THE PHONE'S WAY TO WORK IN IT. The compact map draws one ring, so the ring
    // that shows items shows no branch to drop onto and the layer refuses to
    // start a drag at all. It spends the hold on the node's own verbs instead —
    // assign, re-status, close — which are the same acts a drop performs and go
    // down the same `patchEntry` path.
    onNodeMenu: openMenuFor,
    onWrote: requestRefocus,
    // The table has no nodes to press and no <svg> to measure. Guarding here is
    // cheaper than every handler inside the layer asking.
    disabled: view !== 'map',
  })

  /* ── the node menu, the tick, and the hover ─────────────────────────── */

  /**
   * Focus a branch — and OPEN it on the way in.
   *
   * The expand is the whole point and it was learned in the browser. Collapse and
   * focus are independent states: a reader closes Infrastructure on the map, then
   * later asks to see Infrastructure on its own, and the drill-in faithfully
   * draws one card with nothing under it. Recoverable (the inline-forward arrow,
   * the menu's Expand, the trail back) but absurd — "show me this branch" and
   * "show me nothing" cannot be the same gesture.
   *
   * pages/Mindtree's own compact path already documented this hazard for the
   * phone, where it is fatal rather than merely silly; the fix belongs on both,
   * because the two states can disagree on any screen size.
   *
   * `null` clears the focus and touches no collapse: leaving a branch is not an
   * opinion about whether that branch is open.
   */
  const focusBranch = useCallback((nodeId: string | null) => {
    if (nodeId !== null) setMindCollapsed(nodeId, false)
    setMindFocus(nodeId)
  }, [])

  const toggleSelect = useCallback(
    (entryId: string, label: string) => {
      // Read BEFORE the write: `selection` is this render's set, so `has` still
      // answers the question the reader just asked, and the announcement names
      // the state they are moving TO.
      const adding = !selection.has(entryId)
      toggleMindSelected(entryId)
      setLive(
        adding
          ? t('mindtree.selectedOne', { label })
          : t('mindtree.deselectedOne', { label }),
      )
    },
    [selection, setLive],
  )

  const clearSelection = useCallback(() => {
    clearMindSelection()
    setLive(t('mindtree.selectionCleared'))
  }, [setLive])

  /**
   * Hover, published to the store so the card and the node styling read one
   * value.
   *
   * Dropped while a drag is in flight: the pointer is carrying work, and a
   * detail card opening under the ghost is the map talking about the wrong
   * thing. The card component takes `dragging` as well and cancels its own
   * timer, so this is the belt to its braces — a hover published mid-drag would
   * still be there when the gesture ended.
   */
  const onNodeHover = useCallback(
    (id: string | null) => {
      if (dragging && id !== null) return
      setMindHovered(id)
    },
    [dragging],
  )

  /**
   * PERFORM a decided act — the menu's write path, and the only one this file
   * owns.
   *
   * `NodeMenu` has already decided everything: `targetIds` is filtered to rows
   * this reader may write AND that the act actually changes, `patch` is the one
   * `dropRules` built, and `confirmed` says the reader was asked and said yes.
   * Nothing is recomputed here — a surface that re-derived the patch would be a
   * second policy, and the first thing to drift.
   *
   * EVERY WRITE IS `patchEntry`, through `pooled` at the shared concurrency, for
   * the reason this file's header states: the store owns the optimistic row, the
   * rollback and the `pgErrorKey` sentence, so a failure puts the map back
   * without this function performing an undo.
   */
  const runMenu = useCallback(
    (run: MindMenuRun, path: readonly MindNodeModel[], at: { x: number; y: number }) => {
      const node = path[path.length - 1]
      if (node === undefined) return
      const label = textOf(node.label)

      switch (run.kind) {
        case 'open':
          if (node.entryId !== null) openEntry(node.entryId, { list: drawnEntryIds })
          return
        case 'focus':
          focusBranch(node.id)
          setLive(t('mindtree.focused', { label }))
          return
        case 'collapse':
          if (node.kind === 'more') toggleFold(node.id)
          else setMindCollapsed(node.id, !node.collapsed)
          return
        case 'addHere':
          // The form opens where the menu was, so the reader's eye does not have
          // to travel. It is a second overlay rather than a field inside the
          // menu because it owns a text input, a submit and a "keep it open for
          // the next one" loop — QuickAdd.tsx's whole argument.
          setAddAt({ nodeId: node.id, x: at.x, y: at.y })
          return
        case 'nudge': {
          // An RPC, not a patch: `nudge_entry()` (migration 0019) writes the
          // notification, the audit row and the stamp in one transaction, which
          // is why `actions.ts` hands this verb a null patch. `sendNudge` is the
          // store's wrapper and owns the optimistic overlay.
          const entryId = run.targetIds[0]
          const entry = entryId === undefined ? undefined : entryById.get(entryId)
          if (entry === undefined || meId === null) {
            setLive(t(WHY_GONE))
            return
          }
          const owner = memberLabel(memberById, entry.owner_id, entry.owner_name)
          void sendNudge(entry.id, meId).then((result) => {
            // Names the PERSON and the ITEM, because that is what makes a
            // mis-click visible now rather than tomorrow. Every refusal 0019
            // raises has its own sentence and arrives as a KEY.
            if (result.ok) {
              toast(t('nudge.sent', { name: owner, title: entry.title }), { tone: 'success' })
            } else {
              toast(t(result.error), { tone: 'error' })
            }
          })
          return
        }
        default:
          break
      }

      const patch = run.patch
      if (patch === null || run.targetIds.length === 0) {
        // A no-op — the row is already in the bucket the reader picked. Silence
        // after a deliberate choice reads as a dropped gesture, so the sentence
        // `dropRules` names for exactly this is spoken. A drop onto the branch
        // the row is already under says the same words.
        if (run.outcome !== null && run.outcome.kind === 'noop') setLive(t(DROP_UNCHANGED_KEY))
        return
      }

      const ids = run.targetIds
      // The same repair the drag asks for, and for the same reason: this write
      // rewrites the moved row's node id, `NodeMenu.dismiss()` has just put
      // focus back on the node that is about to unmount, and nothing else would
      // move it. See `requestRefocus`.
      const moved = ids[0]
      if (moved !== undefined) requestRefocus(moved)
      void (async () => {
        const results = await pooled(ids, (id) => patchEntry(id, patch))
        // `offline.queued` is NOT a failure: the write is in the outbox and lands
        // on reconnect, and the optimistic row is already on the map. Treating it
        // as an error would tell a reader on a train that nothing happened.
        const failed = results.filter(
          (r): r is { ok: false; error: string } => !r.ok && r.error !== QUEUED_ERROR_KEY,
        )
        const wrote = ids.length - failed.length
        if (wrote > 0) {
          setLive(
            wrote === 1
              ? t('mindtree.appliedOne', { label })
              : t('mindtree.appliedMany', { count: wrote, label }),
          )
        }
        const first = failed[0]
        if (first !== undefined) toast(t(first.error), { tone: 'error' })
      })()
    },
    [
      drawnEntryIds,
      entryById,
      memberById,
      meId,
      requestRefocus,
      setLive,
      textOf,
      toggleFold,
      focusBranch,
    ],
  )

  const activate = useCallback(
    (node: MindNodeModel, event?: { ctrlKey: boolean; metaKey: boolean }) => {
      // A pan that happens to end over a node is not a tap on it.
      if (draggedRef.current) return
      // Neither is the click every engine synthesises from the pointerup that
      // ENDED a drag. Without this, dropping an item onto a branch would open
      // that branch one frame later — `justDragged()` consumes the flag, so it
      // suppresses exactly one click and not the reader's next real tap.
      if (dragController.justDragged()) return

      // CTRL/CMD+CLICK TICKS A LEAF — the pointer half of Ctrl+Space, and the
      // only pointer gesture that reaches the selection at all. Without it the
      // bulk bar, the drag-many and every "…the selected items here" verb are
      // keyboard-only: `toggleMindSelected` had exactly one call site in the
      // whole app and it was behind a key chord. Tested BEFORE anything else a
      // click does, because a modifier is the only thing separating "mark this"
      // from "open this", and it is deliberately the same chord APG names for a
      // multi-selectable tree.
      const ticking = event !== undefined && (event.ctrlKey || event.metaKey)
      if (ticking && node.kind === 'entry' && node.entryId !== null) {
        setCurrentId(node.id)
        toggleSelect(node.entryId, textOf(node.label))
        return
      }

      setCurrentId(node.id)

      if (node.kind === 'entry' && node.entryId !== null) {
        openEntry(node.entryId, { list: drawnEntryIds })
        return
      }
      if (node.kind === 'more') {
        toggleFold(node.id)
        return
      }
      if (node.id === drawnRoot.id) {
        // The drawn root is the way back OUT, one ring at a time — the inverse
        // of the tap that got here. The whole-map root is never collapsible: a
        // collapsed root is a blank screen with no affordance left to un-blank
        // it.
        //
        // `trail.at(-2)` is "up one ring", which is exactly what focus.ts's
        // FocusView header names it: the trail is INCLUSIVE of the focused node,
        // so its last element is where we are and the one before it is where
        // "out" goes.
        if (focusView.focusId === null) return
        const parent = focusView.trail[focusView.trail.length - 2]
        const up = parent === undefined || parent.id === ROOT_ID ? null : parent.id
        setMindFocus(up)
        setLive(
          up === null || parent === undefined
            ? t('mindtree.clearFocus')
            : t('mindtree.focused', { label: textOf(parent.label) }),
        )
        return
      }
      if (compact && node.children.length > 0) {
        // The small-screen drill: the tapped branch becomes the drawn root and
        // the ring under it appears. Collapse/expand is not offered here — with
        // one ring drawn there is nothing to collapse, and a control that did
        // nothing would be worse than its absence.
        focusBranch(node.id)
        setLive(t('mindtree.focused', { label: textOf(node.label) }))
        return
      }
      if (node.children.length > 0) setMindCollapsed(node.id, !node.collapsed)
    },
    [
      drawnEntryIds,
      toggleFold,
      drawnRoot.id,
      focusView,
      compact,
      textOf,
      dragController,
      focusBranch,
      toggleSelect,
      setLive,
    ],
  )

  /**
   * Why Space could not be lifted on this leaf — the SAME sentence the node menu
   * and the drag badge show for the same wall.
   *
   * The three keys are `lib/mindtree/actions.ts`'s own exported constants, and
   * its header says they are exported for exactly this: "so that the same refusal
   * reads identically from the menu, the drag's refusal badge and the keyboard
   * path — three places a reader can meet the same wall, and three chances to
   * word it three ways".
   *
   * `null` means the gesture is genuinely unavailable rather than refused (the
   * phone's one-ring drill-in has no branch to drop onto), which the caller
   * answers with its own sentence.
   */
  const whyNotLiftable = useCallback(
    (entryId: string | null): string | null => {
      if (meId === null) return WHY_SIGNED_OUT
      if (entryId === null) return WHY_GONE
      const entry = entryById.get(entryId)
      if (entry === undefined) return WHY_GONE
      if (!canEditEntry(entry, meId, role)) return WHY_NOT_YOURS
      return null
    },
    [entryById, meId, role],
  )

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<SVGSVGElement>) => {
      // FIRST, ALWAYS — its own contract. It answers true when it consumed the
      // key, which is: Space that began a lift, and (while something IS lifted)
      // the arrows, Enter and Escape. Everything below therefore runs only when
      // no drag is in flight, which is what keeps the two grammars from ever
      // being live at the same time.
      if (dragController.handleKeyDown(event)) return

      // A LIFT OWNS THE KEYBOARD until Enter, Escape or Tab ends it. The layer
      // consumed everything inside its own grammar; everything else must still
      // not reach the map's, because both would then be live at once. Two keys
      // made that visible: Shift+F10 opened the node menu and moved focus into
      // it with a live, now-unreachable drag still on screen, and Ctrl+Space
      // ticked a row that the frozen carry (decided at the lift, deliberately)
      // was never going to carry — so the marks and the set about to be written
      // disagreed for the rest of the gesture.
      //
      // `isLifted()` and not `dragController.active`: Tab ends a lift and
      // returns false on purpose so focus can leave, and the render flag still
      // reads true at that moment. The refs do not.
      if (dragController.isLifted()) return

      if (activeId === null) return
      const at = order.findIndex((pos) => pos.id === activeId)
      if (at < 0) return
      const pos = order[at] as PositionedNode<MindNodeModel>
      const node = pos.node
      const drawn = pos.childIds.length > 0
      const isItem = node.kind === 'entry'

      // The node menu, on the two keys every platform offers for it. Neither did
      // anything on this screen before, so there is nothing to reconcile — and
      // both are checked before the switch because `isMenuKey` reads `shiftKey`,
      // which a bare `event.key` switch cannot see.
      if (isMenuKey(event)) {
        event.preventDefault()
        openMenuFor(pos)
        return
      }

      // Ctrl+Space toggles the tick, which is the APG multi-select tree's own
      // binding for exactly this. Tested before the plain-Space branch below
      // because that branch is about a GRAB and this one is about a SELECTION,
      // and a modifier is the only thing separating them.
      if ((event.ctrlKey || event.metaKey) && (event.key === ' ' || event.key === 'Spacebar')) {
        if (!isItem || node.entryId === null) return
        event.preventDefault()
        toggleSelect(node.entryId, textOf(node.label))
        return
      }

      // "Toward the children" is an inline-end concept. The drawing is already
      // mirrored by the layout module, so the KEYS have to mirror too or the
      // arrow that opens a branch in English closes it in Arabic.
      const forward = rtl ? 'ArrowLeft' : 'ArrowRight'
      const backward = rtl ? 'ArrowRight' : 'ArrowLeft'

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault()
          moveCursor(order[at + 1]?.id)
          return
        case 'ArrowUp':
          event.preventDefault()
          moveCursor(order[at - 1]?.id)
          return
        case 'Home':
          event.preventDefault()
          moveCursor(order[0]?.id)
          return
        case 'End':
          event.preventDefault()
          moveCursor(order[order.length - 1]?.id)
          return
        case 'Enter':
          // ENTER IS UNCONDITIONAL and always has been: open the item, or open
          // and close the branch. Nothing about this build changes it, which is
          // half of what makes the Space rule below safe to introduce.
          event.preventDefault()
          activate(node)
          return
        case ' ':
        case 'Spacebar':
          event.preventDefault()
          // THE ONE COLLISION, resolved by the node's KIND — see this file's
          // header for the full argument. On a branch, Space is Enter's synonym,
          // exactly as it was. On an ITEM it is the grab key, and reaching this
          // line at all means the drag layer declined the lift: this reader may
          // not move this row, or there is nowhere on screen to move it to.
          //
          // Either way the key is SWALLOWED rather than falling through to
          // "open the entry". A key that moves the items you own and opens the
          // ones you do not is the shape the brief rules out, and the fall-through
          // is how a build gets there without anybody deciding to.
          if (!isItem) {
            activate(node)
            return
          }
          setLive(t(whyNotLiftable(node.entryId) ?? 'mindtree.dragNoTarget'))
          return
        case 'Escape':
          // THE ESCAPE STACK, outermost first. A lift outranks everything and has
          // already been handled above by `handleKeyDown`; the hover card is
          // next, because it is the thing most recently raised and the reader can
          // see it; stepping out of a drill-in is last, because it changes what
          // the whole screen is about.
          //
          // The card is dismissed by a direct call rather than through
          // lib/overlayStack, and NodeCard.tsx's header gives the ordering
          // reason: React's listener on this <svg> is below `document`, so with
          // focus on a treeitem — which is exactly where it is when the card was
          // raised BY that focus — the page's Escape would always win and the
          // card would be the one thing on this screen Escape could not close.
          if (dismissMindNodeCard()) {
            event.preventDefault()
            return
          }
          if (focusView.focusId !== null) {
            event.preventDefault()
            setMindFocus(null)
            setLive(t('mindtree.clearFocus'))
          }
          return
        default:
          break
      }

      if (event.key === forward) {
        event.preventDefault()
        if (pos.hasChildren && !drawn) {
          if (node.kind === 'more') toggleFold(node.id)
          // On a phone every branch sits on the depth limit, so "open it" and
          // "drill into it" are the same gesture — which is what keeps the
          // arrow key and the tap doing the same thing.
          else if (compact) focusBranch(node.id)
          else setMindCollapsed(node.id, false)
        } else if (drawn) {
          moveCursor(pos.childIds[0])
        }
        return
      }

      if (event.key === backward) {
        event.preventDefault()
        if (drawn) {
          if (node.kind === 'more') toggleFold(node.id)
          else setMindCollapsed(node.id, true)
        } else if (pos.parentId !== null) {
          moveCursor(pos.parentId)
        }
      }
    },
    [
      dragController,
      activeId,
      order,
      rtl,
      moveCursor,
      activate,
      focusView.focusId,
      compact,
      toggleFold,
      openMenuFor,
      toggleSelect,
      textOf,
      whyNotLiftable,
      focusBranch,
      setLive,
    ],
  )

  /* ── what the two overlays are attached to ──────────────────────────── */

  /**
   * The root-to-node path for the open menu, and for the open quick-add.
   *
   * MEMOISED ON THE NODE ID, because both components require a reference-stable
   * `path` while they are open — it keys the memo that builds their rows, and a
   * fresh array on every render would rebuild every row and re-register the
   * Escape handler on every frame of a pan. `trailTo` walks the WHOLE tree, not the
   * drawn subtree, because an act on a group means the intersection of it and
   * its ancestors and the drill-in root would drop the track.
   */
  const menuPath = useMemo(
    () => (menuAt === null ? null : trailTo(tree, menuAt.nodeId)),
    [tree, menuAt],
  )
  const addPath = useMemo(
    () => (addAt === null ? null : trailTo(tree, addAt.nodeId)),
    [tree, addAt],
  )

  /**
   * The values each sub-menu offers, with the bucket key `model.ts` spells.
   *
   * Built here rather than read inside NodeMenu for the reason that component's
   * props give: this page already holds both stores and already resolves their
   * labels, and a menu that subscribed itself would re-render under the reader's
   * finger on any roster change.
   *
   * RETIRED OPTIONS ARE INCLUDED AND MARKED. `useVocabAll` is what the tree is
   * built from, so an entry still holding a hidden status has a branch — and a
   * menu that omitted the value would offer no way to see, or leave, the bucket
   * the map is drawing. `dropRules` refuses to MOVE work into one; the menu says
   * so rather than pretending it does not exist.
   */
  const menuChoices = useMemo<MindMenuChoices>(() => {
    const owner: MindMenuChoice[] = [
      { value: NO_VALUE, label: t('entry.unassigned') },
      ...members.map((m) => ({ value: m.id, label: memberLabel(memberById, m.id, null) })),
    ]
    // An owner the roster has forgotten but the work still names — model.ts
    // buckets those under `name:<text>`, so the menu can offer them back.
    const freeNames = new Set<string>()
    for (const entry of entries) {
      const name = (entry.owner_name ?? '').trim()
      if (entry.owner_id === null && name !== '') freeNames.add(name)
    }
    for (const name of [...freeNames].sort((a, b) => a.localeCompare(b, locale))) {
      owner.push({ value: `${NAME_PREFIX}${name}`, label: name, retired: true })
    }
    // `o.label` is already resolved for the live locale — `useVocabAll` builds
    // its items through the store's own resolver, so calling `vocabLabelOf` here
    // would be the same lookup done twice.
    const toChoice = (o: MindVocabOption): MindMenuChoice => ({
      value: o.key,
      label: o.label,
      retired: o.hidden ? true : undefined,
    })
    return {
      owner,
      status: statusVocab.map(toChoice),
      priority: priorityVocab.map(toChoice),
    }
  }, [members, memberById, entries, locale, statusVocab, priorityVocab])

  /* ── the hover card ─────────────────────────────────────────────────── */

  /**
   * Which node the card describes: the POINTER's node, or the keyboard's — but
   * the keyboard's ONLY WHILE THE TREE ACTUALLY HAS FOCUS.
   *
   * That last clause is the whole rule and it was learned the hard way. `activeId`
   * is the roving tab stop, which is never null: it falls back to the first node
   * so that a Tab into the map always lands somewhere. Keying the card on it
   * directly put a card on the root node on FIRST PAINT, covering the middle of a
   * map nobody had touched yet. A roving tabindex means "this is where focus
   * would go", not "this is where focus is".
   *
   * So the card follows real attention: `hoveredId` for a pointer, and the cursor
   * only once `focusin` has actually fired inside the drawing. Hover wins over
   * focus when both are live, because a pointer is a deliberate momentary
   * question and the cursor is a persistent place.
   */
  const cardPos = useMemo(() => {
    const id = hoveredId ?? (treeFocused ? cursorId : null)
    if (id === null) return null
    return layout.byId.get(id) ?? null
  }, [hoveredId, treeFocused, cursorId, layout])

  /**
   * The node's box in CSS pixels, relative to the canvas — the space the card is
   * positioned in.
   *
   * `preserveAspectRatio="xMidYMid meet"` is honoured explicitly rather than
   * assumed away: the effective scale is the MIN of the two ratios and the
   * remainder is split as a centring offset. The two ratios agree here to within
   * one drawing unit (`fitToViewBox` derives the box from the measured viewport),
   * but writing the general form costs two lines and means a card cannot drift
   * off its node in the one frame between a resize and the ResizeObserver.
   */
  const cardAnchor = useMemo(() => {
    if (cardPos === null || box.width <= 0 || box.height <= 0) return null
    if (viewWidth <= 0 || viewHeight <= 0) return null
    const scale = Math.min(box.width / viewWidth, box.height / viewHeight)
    const offX = (box.width - viewWidth * scale) / 2
    const offY = (box.height - viewHeight * scale) / 2
    const viewX = centerX - viewWidth / 2
    const viewY = centerY - viewHeight / 2
    return {
      x: offX + (cardPos.x - viewX) * scale,
      y: offY + (cardPos.y - viewY) * scale,
      width: cardPos.width * scale,
      height: cardPos.height * scale,
    }
  }, [cardPos, box, viewWidth, viewHeight, centerX, centerY])

  /* ── the watch layer ────────────────────────────────────────────────── */

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
  const { pulses, motion } = useMindPulses({
    tree: view === 'map' ? drawnRoot : null,
    paused: dragging,
    enabled: view === 'map',
  })

  /* ── zoom, pan, pinch ───────────────────────────────────────────────── */

  const clampZoom = useCallback(
    (next: number): number => Math.min(zoomBounds.max, Math.max(zoomBounds.min, next)),
    [zoomBounds],
  )

  const zoomBy = useCallback(
    (factor: number) => {
      // Two independent writes, NOT a setPan nested inside setZoom's updater —
      // an updater must be pure, React may run it twice in development, and a
      // state write from inside one is a side effect that fires as many times
      // as the updater does.
      //
      // Anchoring the pan first is what keeps the picture put: while `pan` is
      // null the viewBox is recomputed from the fit on every render, so zooming
      // without anchoring would re-centre the map on the whole drawing at every
      // press instead of magnifying what the reader is looking at.
      setPan((current) => current ?? { x: fit.x + fit.width / 2, y: fit.y + fit.height / 2 })
      // A FUNCTIONAL UPDATER, not `clampZoom(heldZoom * factor)`. React batches
      // every update raised inside one task, so a value computed from the
      // rendered `heldZoom` is the same value for every press in the batch —
      // measured: fifteen programmatic clicks moved the readout one step. Real
      // clicks land in separate tasks and would have hidden it.
      setZoom((prev) => clampZoom(prev * factor))
      // ANNOUNCED, like every other control on this screen. The two most-used
      // buttons on the map used to be the only ones that said nothing: "Fit to
      // view" called setLive and these did not, and the visible readout is
      // deliberately `aria-live="off"` so it could not stand in. A low-vision
      // user pressing + got no confirmation that anything had happened.
      //
      // Through a counter rather than from here, because the number to announce
      // is the POST-CLAMP one and this function cannot know it — see the effect.
      setZoomTick((n) => n + 1)
    },
    [fit, clampZoom],
  )

  /**
   * The zoom announcement, raised once per press-or-batch, after the clamp.
   *
   * Keyed on the TICK and not on the percentage: pressing + at the ceiling
   * changes nothing, and a reader who hears silence cannot tell "it did not
   * work" from "there is no more". `zoomPercent` is read rather than watched,
   * so a window resize — which moves the fit and therefore the percentage —
   * does not speak.
   */
  useEffect(() => {
    if (zoomTick === 0) return
    setLive(t('mindtree.zoomLevel', { pct: zoomPercent }))
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomTick])

  const resetView = useCallback(() => {
    setZoom(1)
    setPan(null)
    setLive(t('mindtree.zoomLevel', { pct: Math.round(fit.scale * 100) }))
  }, [fit.scale, setLive])

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      // A press the drag layer has already claimed is not a pan. A MOUSE press
      // on a draggable node never reaches this handler at all (DragLayer stops
      // it), but a FINGER does — deliberately, so the map can still be panned
      // from a node until the hold lands — and this is the second half of that:
      // once the hold HAS landed, `onPanCancel` has cleared the pan and this
      // guard keeps a second finger from starting a new one under the ghost.
      if (dragController.isPressing()) return
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      draggedRef.current = false
      if (pointersRef.current.size === 1) {
        panStartRef.current = {
          x: event.clientX,
          y: event.clientY,
          cx: centerX,
          cy: centerY,
        }
        event.currentTarget.setPointerCapture(event.pointerId)
      } else if (pointersRef.current.size === 2) {
        const [a, b] = [...pointersRef.current.values()]
        // `heldZoom`, not the raw state: a resize or an expand moves the fit and
        // therefore the bounds, and a pinch anchored on an out-of-bounds
        // multiplier would jump the moment the second finger lands.
        if (a && b) pinchRef.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: heldZoom }
        panStartRef.current = null
      }
    },
    [centerX, centerY, heldZoom, dragController],
  )

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (!pointersRef.current.has(event.pointerId)) return
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

      const pinch = pinchRef.current
      if (pointersRef.current.size >= 2 && pinch !== null) {
        const [a, b] = [...pointersRef.current.values()]
        if (!a || !b) return
        const distance = Math.hypot(a.x - b.x, a.y - b.y)
        if (pinch.distance > 0) {
          draggedRef.current = true
          setZoom(clampZoom(pinch.zoom * (distance / pinch.distance)))
          setPan((current) => current ?? { x: fit.x + fit.width / 2, y: fit.y + fit.height / 2 })
        }
        return
      }

      const start = panStartRef.current
      if (start === null || box.width <= 0 || box.height <= 0) return
      const dx = event.clientX - start.x
      const dy = event.clientY - start.y
      if (!draggedRef.current && Math.hypot(dx, dy) < DRAG_SLOP) return
      // Written straight to the DOM rather than held in state. The grab cursor
      // is the one thing on this screen that has to change on the first pixel
      // of a drag, and routing it through a re-render would re-render every
      // node in the map to change a CSS cursor. `draggedRef` is a ref for the
      // same reason — a ref read during render would never repaint anyway,
      // which is what made the first cut's `data-panning` prop dead code.
      draggedRef.current = true
      svgRef.current?.setAttribute('data-panning', '')
      // Pixels → drawing units. The drawing's x axis is NOT mirrored by `dir`
      // (SVG coordinates never are — the layout module mirrored the geometry
      // instead), so this arithmetic is identical in both directions.
      setPan({
        x: start.cx - (dx * viewWidth) / box.width,
        y: start.cy - (dy * viewHeight) / box.height,
      })
    },
    [box, viewWidth, viewHeight, fit, clampZoom],
  )

  const endPointer = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    pointersRef.current.delete(event.pointerId)
    if (pointersRef.current.size < 2) pinchRef.current = null
    if (pointersRef.current.size === 0) {
      panStartRef.current = null
      svgRef.current?.removeAttribute('data-panning')
      // Cleared on the next frame, not now: the synthetic click that follows a
      // pointerup fires after this handler, and clearing it here would let a
      // drag that ended over a node open that node's entry.
      window.setTimeout(() => {
        draggedRef.current = false
      }, 0)
    }
  }, [])

  /* ── the toolbar's actions ──────────────────────────────────────────── */

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

  const chooseDimension = useCallback((next: MindDimension) => {
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
  }, [focusPref, setLive])

  const chooseView = useCallback((next: MindtreeView) => {
    setMindView(next)
    // The whole content region is swapped — a role="tree" for a <table> — and
    // every other state change on this screen announces. The toggle's own label
    // flips while it holds focus, which screen readers do not reliably re-read.
    setLive(
      t('mindtree.viewChanged', {
        label: next === 'table' ? t('mindtree.tableLabel') : t('mindtree.title'),
      }),
    )
  }, [setLive])

  const chooseDensity = useCallback(() => {
    const next = density === 'compact' ? 'comfortable' : 'compact'
    setMindDensity(next)
    setLive(
      t('mindtree.densityChanged', {
        label: t(next === 'compact' ? 'mindtree.densityCompact' : 'mindtree.densityComfortable'),
      }),
    )
  }, [density, setLive])

  /* ── the view, in the URL ───────────────────────────────────────────── */

  /**
   * `?focus=` and `?group=`, through lib/mindtree/focus.ts's codec.
   *
   * TWO EFFECTS, EACH GUARDED, and they converge rather than loop: the first
   * applies an opinion the URL holds and the store does not, the second writes
   * the store's values back when the URL does not already say them. When the two
   * agree — which is every render after the first — both do nothing.
   *
   * THE URL ONLY WINS WHEN IT HAS AN OPINION. `viewFromParams` returns null for
   * "the URL says nothing", which is NOT the same as "show the whole map": a
   * reader arriving from the nav bar keeps the drill-in they left yesterday,
   * and only a link that actually carries `?focus=` overrides it. That is the
   * asymmetry that makes a persisted preference and a shareable link coexist.
   */
  const [params, setParams] = useSearchParams()

  useEffect(() => {
    const url = viewFromParams(params)
    if (url.dimension !== null) setMindDimension(url.dimension)
    // `focusBranch`, not `setMindFocus`: a pasted link to a branch must show
    // what is under it, and the recipient's own collapse state — persisted from
    // some earlier session — has no business deciding whether the link works.
    if (url.focusId !== null) focusBranch(url.focusId)
    // The params only. Reading the store here would re-run this on every focus
    // change and hand the URL's stale opinion back to the store it just left.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  useEffect(() => {
    const next = viewToParams(params, { focusId: focusPref, dimension })
    // Compared as strings because URLSearchParams has no equality and a fresh
    // object every render would push a history entry per render. `replace`, for
    // Board.tsx and FollowUps.tsx's reason: an entry per interaction makes Back
    // unusable, and Back should leave this screen rather than walk its rings.
    if (next.toString() === params.toString()) return
    setParams(next, { replace: true })
  }, [focusPref, dimension, params, setParams])

  /* ── the summary, which is also the export's description ────────────── */

  const summary = useMemo(() => {
    const rootStats = stats.get(ROOT_ID) ?? NO_STATS
    // `count` is the TRACK count: it is the only noun in this sentence that
    // inflects ("1 track" / "6 tracks"), and selectPlural reads vars.count and
    // nothing else. The open and breached totals ride as {open}/{breached},
    // which sit beside adjectives rather than nouns in both languages.
    return t('mindtree.summary', {
      count: tree.children.length,
      open: tree.count,
      breached: rootStats.breached,
    })
  }, [stats, tree])

  const busiest = useMemo(() => {
    let top: MindNodeModel | null = null
    for (const child of tree.children) if (top === null || child.count > top.count) top = child
    if (top === null || top.count === 0) return null
    return t('mindtree.summaryTop', { track: textOf(top.label), count: top.count })
  }, [tree, textOf])

  /**
   * The biggest ring-2 bucket ACROSS every track — the sentence the picture
   * cannot draw.
   *
   * Ring 2 is nested inside ring 1, so with `Group by = Owner` a person working
   * across four tracks is four nodes and four numbers, and "who is overloaded"
   * — one of the three questions MINDTREE-SPEC names — is a sum the reader has
   * to do by eye. Nesting is right for the map; this is the one number that
   * cannot be recovered from it, so it is stated. The table carries the whole
   * ranking (`MindtreeTable`'s second block).
   *
   * Suppressed under a single track, where it is the same fact as the map.
   */
  const topGroup = useMemo(() => {
    if (tree.children.length < 2) return null
    const totals = groupTotals(tree)
    const top = totals[0]
    if (top === undefined || top.count === 0) return null
    return t('mindtree.summaryGroup', { label: textOf(top.label), count: top.count })
  }, [tree, textOf])

  /* ── export ─────────────────────────────────────────────────────────── */

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
    [exporting, summary, busiest, topGroup, rtl, locale, filter, wholeMapFit],
  )

  /* ── the shared tag vocabulary ──────────────────────────────────────── */

  const tags = useMemo(() => {
    const held = new Set<string>()
    for (const entry of entries) for (const tag of entry.tags) held.add(tag)
    return [...held].sort((a, b) => a.localeCompare(b, locale))
  }, [entries, locale])

  /* ── render ─────────────────────────────────────────────────────────── */

  const showSkeleton = loading && entries.length === 0
  const showError = error !== null && entries.length === 0
  const noTracks = tracks.length === 0 && entries.length === 0
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
  const nothing = tree.count === 0
  const filtered = !isFilterEmpty(filter)

  return (
    <div className="mtree">
      <header>
        <h1 className="page-title">{t('mindtree.title')}</h1>
        <p className="page-subtitle mtree-sub">{t('mindtree.subtitle')}</p>
      </header>

      <FilterBar
        value={filter}
        onChange={setFilter}
        facets={FACETS}
        tags={tags}
        count={tree.count}
        resultLabel={(n) => t('mindtree.countOpen', { count: n })}
      />

      <div className="mtree-bar">
        <div className="mtree-bar-group" role="group" aria-label={t('mindtree.groupBy')}>
          <span className="mtree-bar-label" id="mtree-groupby">
            {t('mindtree.groupBy')}
          </span>
          <div className="chip-row" role="group" aria-labelledby="mtree-groupby">
            {MIND_DIMENSIONS.map((d) => (
              <button
                key={d.key}
                type="button"
                className="chip"
                aria-pressed={dimension === d.key}
                onClick={() => chooseDimension(d.key)}
              >
                {t(d.labelKey)}
              </button>
            ))}
          </div>
        </div>

        <div className="mtree-bar-group">
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => chooseView(view === 'map' ? 'table' : 'map')}
          >
            {view === 'map' ? (
              <IconChart size={16} aria-hidden="true" />
            ) : (
              <IconLayers size={16} aria-hidden="true" />
            )}
            {view === 'map' ? t('mindtree.tableToggle') : t('mindtree.mapToggle')}
          </button>

          {view === 'map' && (
            <>
              {/* Absent on a phone: one ring is drawn at a time there, so there
                  is nothing for either of these to open or close. */}
              {!compact && (
                <>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={expandAll}>
                    {t('mindtree.expandAll')}
                  </button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={collapseAll}>
                    {t('mindtree.collapseAll')}
                  </button>
                  {/* A toggle rather than a slider or a third value: `compact`
                      is what fits a nine-track workspace on a laptop and
                      `comfortable` is what keeps a card comfortable to read.
                      `aria-pressed` because it is a state, not a navigation —
                      and the label names the state it would MOVE to, which is
                      what the pressed attribute is for. Absent on a phone,
                      where the node size is not a preference at all. */}
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    aria-pressed={density === 'compact'}
                    onClick={chooseDensity}
                  >
                    {t('mindtree.densityCompact')}
                  </button>
                </>
              )}
              <button
                type="button"
                className="btn btn-sm btn-icon"
                aria-label={t('mindtree.zoomOut')}
                onClick={() => zoomBy(1 / ZOOM_STEP)}
              >
                −
              </button>
              <span className="mtree-zoom tabular" aria-live="off">
                {t('mindtree.zoomLevel', { pct: zoomPercent })}
              </span>
              <button
                type="button"
                className="btn btn-sm btn-icon"
                aria-label={t('mindtree.zoomIn')}
                onClick={() => zoomBy(ZOOM_STEP)}
              >
                +
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={resetView}>
                {t('mindtree.fit')}
              </button>

              {/* A <details> rather than a hand-rolled popover: it is a
                  disclosure, not a dialog — it must not trap focus or make the
                  map inert — and it gets the open/closed semantics and the
                  button role from the platform. Escape and light-dismiss are
                  NOT among them and are added in an effect above. */}
              <details className="mtree-export" ref={exportRef}>
                <summary className="btn btn-sm">{t('mindtree.export')}</summary>
                <div className="mtree-export-menu">
                  <p className="mtree-export-hint">{t('mindtree.exportHint')}</p>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={exporting}
                    onClick={() => runExport('svg')}
                  >
                    {t('mindtree.exportSvg')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={exporting}
                    onClick={() => runExport('png')}
                  >
                    {t('mindtree.exportPng')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    disabled={exporting}
                    onClick={() => runExport('copy')}
                  >
                    {t('mindtree.copyImage')}
                  </button>
                  {exporting && <p className="mtree-export-hint">{t('mindtree.exporting')}</p>}
                </div>
              </details>
            </>
          )}
        </div>
      </div>

      {truncated && <p className="mtree-note">{t('mindtree.truncated')}</p>}

      {/* The trail, INCLUSIVE of where you are — Breadcrumb renders the tail as
          a heading and everything before it as links, and draws nothing at all
          for a trail of one (the unfocused map). Only in map view: the table is
          the whole workspace's ledger and is not drilled into. */}
      {view === 'map' && <Breadcrumb trail={focusView.trail} onFocus={focusBranch} />}

      {/* THE BULK BAR, and it must not lie: `pruneMindSelection` has already
          dropped anything the reader can no longer see, so this count is a count
          of rows on the screen. It is the other half of the redistribution
          gesture — tick six, then drag one and all six travel, or open the menu
          on the person who should take them and apply. */}
      {view === 'map' && selectionCount > 0 && (
        <div className="mtree-selbar" role="group" aria-label={t('mindtree.selectionLabel')}>
          <span className="mtree-selbar-count tabular">
            {t('mindtree.selectionCount', { count: selectionCount })}
          </span>
          <span className="mtree-selbar-hint">{t('mindtree.selectionHint')}</span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={clearSelection}>
            {t('mindtree.clearSelection')}
          </button>
        </div>
      )}

      {showSkeleton ? (
        <div className="mtree-canvas">
          <Skeleton height={320} />
        </div>
      ) : showError ? (
        <EmptyState
          title={t('mindtree.errLoad')}
          description={error ?? undefined}
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
            <button type="button" className="btn" onClick={() => setFilter({ ...EMPTY_FILTER })}>
              {t('mindtree.clearFilters')}
            </button>
          }
        />
      ) : tree.count === 0 && !filtered ? (
        <EmptyState title={t('mindtree.empty')} description={t('mindtree.emptyHint')} />
      ) : view === 'table' ? (
        <MindtreeTable
          root={tree}
          dimension={dimension}
          entryById={entryById}
          today={ctx.today}
          onFilterCell={(row: MindtreeTableRow) =>
            setFilter(filterForCell(filter, dimension, row))
          }
        />
      ) : (
        <div
          className="mtree-canvas"
          ref={canvasRef}
          // The pointer left the drawing entirely. Without this, walking off the
          // edge of a node and out of the canvas in one motion leaves the last
          // hover published, and the card stays open over a map nobody is
          // pointing at.
          onPointerLeave={() => onNodeHover(null)}
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
            onFocus={() => setTreeFocused(true)}
            onBlur={() => setTreeFocused(false)}
            onKeyDown={onKeyDown}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endPointer}
            onPointerCancel={endPointer}
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
                  onActivate={activate}
                  onFocus={setCursorId}
                  registerRef={registerRef}
                  onPointerDown={dragController.onNodePointerDown}
                  onHover={onNodeHover}
                  onMenu={openMenuFor}
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
              vocabLabel={vocabLabelOf}
              dimension={dimension}
              today={ctx.today}
            />
          )}
        </div>
      )}

      {view === 'map' && (
        <>
          <ul className="mtree-legend" aria-label={t('mindtree.legend')}>
            <li className="mtree-legend-item">
              <span className="mtree-legend-size" aria-hidden="true" />
              {t('mindtree.legendSize')}
            </li>
            <li className="mtree-legend-item">
              <span className="mtree-legend-breach" aria-hidden="true" />
              {t('mindtree.legendBreach')}
            </li>
          </ul>
          <p className="mtree-hint">{compact ? t('mindtree.mobileHint') : t('mindtree.panHint')}</p>
          {/* Inside the map branch and carrying the id the <svg> points at.
              It sat outside both before: unreferenced, so a reader only met it
              by walking past the entire map to the foot of the document, and
              still rendered in TABLE view, where it described the arrow-key
              behaviour of a widget that is not on the screen. sr-only because
              it is the picture's instructions and a sighted user has buttons. */}
          {/* TWO SENTENCES, ONE ELEMENT, because `aria-describedby` resolves an
              id to one node and the walk and the tick are one contract: how to
              move around the map, and how to mark several items so they travel
              together. The DRAG's own grammar is a third sentence and lives in
              MindDragLayer (`controller.hintId`), beside the gesture it
              describes — the <svg> points at both ids. */}
          <p className="sr-only" id={hintId}>
            {t('mindtree.keyboardHint')} {t('mindtree.selectHint')}
          </p>
        </>
      )}

      <p className="mtree-note">
        {summary}
        {busiest !== null && ` ${busiest}`}
        {topGroup !== null && ` ${topGroup}`}
      </p>

      {/* polite, not assertive: the filter's own count already announces on
          every keystroke through FilterBar, and two assertive regions on one
          screen interrupt each other. */}
      <p className="sr-only" role="status" aria-live="polite">
        {/* KEYED ON A COUNTER, so an identical consecutive sentence is still
            announced. A plain string is a React bail-out when the value has not
            changed, which produces no DOM mutation and therefore no
            announcement — and this region says the same words twice all the
            time: Space on a second item you may not move, "Collapse all"
            pressed twice, "Fit to view" already fitted. `MindDragLayer`'s own
            region solved this first and states the reason; this is the same
            answer. */}
        <span key={live.seq}>{live.text}</span>
      </p>

      {/* THE GHOST, THE REASON AND THE DRAG'S OWN LIVE REGION — outside the
          <svg>, as a sibling of the canvas. `.mtree-canvas` is `overflow:
          hidden`, so a ghost drawn inside the drawing would be clipped at the
          exact moment a reader drags toward the edge to make the map auto-pan.
          It carries its own polite region rather than borrowing the one above:
          this screen's region is the map's commentary ("Zoom 140%") and a drag
          is a stream of short sentences that must arrive in order. */}
      {view === 'map' && <MindDragLayer controller={dragController} />}

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
          ctx={mindCtx}
          choices={menuChoices}
          anchorEl={nodeRefs.current.get(menuAt.nodeId) ?? null}
          onRun={(run) => {
            runMenu(run, menuPath, { x: menuAt.x, y: menuAt.y })
          }}
          onClose={() => setMenuAt(null)}
        />
      )}

      {addAt !== null && addPath !== null && addPath.length > 0 && (
        <QuickAdd
          path={addPath}
          label={textOf(addPath[addPath.length - 1].label)}
          dimension={dimension}
          at={{ x: addAt.x, y: addAt.y }}
          rtl={rtl}
          meId={meId}
          anchorEl={nodeRefs.current.get(addAt.nodeId) ?? null}
          announce={setLive}
          onClose={() => setAddAt(null)}
        />
      )}
    </div>
  )
}
