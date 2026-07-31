// The Mindtree — the shape of the workload, as a map.
//
// /tracks answers "what is open, and who has it?" — a working list. This
// answers the question an ops lead asks in the ninety seconds before a steering
// meeting: WHERE IS THE MASS. Which track is bloated, who is carrying it, what
// has gone red. One glance, no rows read. It is a sibling of /tracks, not a
// replacement, which is why the handoff proposes a List | Map switcher on that
// screen rather than a sixth nav destination.
//
// THIS FILE COMPOSES; IT DOES NOT COMPUTE. Four modules already own the hard
// parts and none of them knows about the other three:
//
//   lib/mindtree/model.ts    entries + tracks + vocabulary → a MindNode tree.
//                            Filters FIRST, then buckets, so a branch labelled
//                            12 is showing 12. Every count rolls up exactly.
//   lib/mindtree/layout.ts   the tidy-tree geometry, mirrored for RTL inside
//                            the module, so nothing here multiplies an x by a
//                            direction. Deterministic — no force simulation.
//   lib/mindtree/export.ts   the deck-ready SVG and PNG.
//   components/mindtree/*    one node, one edge, and the table equivalent.
//
// What is left for this file is the four things that are genuinely a screen's
// job: reading the stores, resolving labels against the live locale, holding
// the interaction state (dimension, collapse, zoom, pan, drill), and wiring the
// keyboard.
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
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react'
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
import { isolate } from '../lib/bidi'
import { formatTimestamp } from '../lib/dates'
import { EMPTY_FILTER, isFilterEmpty, type FilterState } from '../lib/entryFilter'
import { t, useLocale } from '../lib/i18n'
import { useTrackLabel } from '../lib/labels'
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
  isMindDimension,
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
  loadEntries,
  loadTrackSlas,
  refreshEntries,
  useEntriesError,
  useEntriesLoading,
  useEntriesTruncated,
  useEntryList,
  useEntryMap,
  useFilterContext,
  useHealthMap,
} from '../store/entries'
import { useTracks } from '../store/config'
import { useMemberMap, useMembers, memberLabel } from '../store/members'
import { useVocabAll, useVocabLabel } from '../store/vocab'
import { openEntry } from '../store/entrySheet'
import './mindtree.css'

/* ─────────────────────────────── preferences ─────────────────────────────── */

const PREFS_KEY = 'opstrack_mindtree_v1'

type MindtreeView = 'map' | 'table'

interface MindtreePrefs {
  dimension: MindDimension
  view: MindtreeView
  /** Branch ids the reader EXPLICITLY closed, keyed by dimension — the rings
   *  differ per axis. */
  collapsed: Record<string, string[]>
  /** Branch ids and "+N more" folds the reader EXPLICITLY opened, keyed the
   *  same way. Both sets exist because neither default is universal: a branch
   *  starts closed at `OPEN_DEPTH` and a fold always does. */
  opened: Record<string, string[]>
}

const DEFAULT_PREFS: MindtreePrefs = {
  dimension: 'status',
  view: 'map',
  collapsed: {},
  opened: {},
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

function idMap(value: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  if (typeof value !== 'object' || value === null) return out
  for (const [key, ids] of Object.entries(value as Record<string, unknown>)) {
    const list = stringList(ids)
    if (list.length > 0) out[key] = list
  }
  return out
}

/**
 * Read the persisted choices, validating EVERY field.
 *
 * `localStorage` is user-writable storage that outlives a schema change, so a
 * stale `dimension: 'assignee'` from a future build has to degrade to the
 * default rather than render an empty ring — the same reasoning behind
 * pages/Board.tsx's `readPrefs` and behind model.ts exporting `isMindDimension`
 * at all. A malformed value must cost the reader a preference, never a screen.
 */
function readPrefs(): MindtreePrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (raw === null) return DEFAULT_PREFS
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_PREFS
    const rec = parsed as Record<string, unknown>
    return {
      dimension: isMindDimension(rec.dimension) ? rec.dimension : DEFAULT_PREFS.dimension,
      view: rec.view === 'table' ? 'table' : 'map',
      collapsed: idMap(rec.collapsed),
      opened: idMap(rec.opened),
    }
  } catch {
    // Private mode, a quota wall, or a half-written value. A map that throws on
    // mount because a preference is malformed is worse than a default map.
    return DEFAULT_PREFS
  }
}

function writePrefs(prefs: MindtreePrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Preferences are a convenience; losing them must never break the screen.
  }
}

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

/** Depth-first search by id. The tree is four deep; a Map would be overkill. */
function findNode(node: MindNodeModel, id: string): MindNodeModel | null {
  if (node.id === id) return node
  for (const child of node.children) {
    const hit = findNode(child, id)
    if (hit !== null) return hit
  }
  return null
}

/** The chain from the root down to `id`, inclusive. Empty when there is no path. */
function pathTo(node: MindNodeModel, id: string, trail: MindNodeModel[] = []): MindNodeModel[] {
  trail.push(node)
  if (node.id === id) return trail
  for (const child of node.children) {
    const hit = pathTo(child, id, trail)
    if (hit.length > 0) return hit
  }
  trail.pop()
  return []
}

/* ─────────────────────────────── the screen ──────────────────────────────── */

/** Every facet except `scope`, which this screen pins — see `applied` below. */
const FACETS: readonly FilterFacet[] = [
  'search',
  'mine',
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

/** One frozen empty set, so the memo below has a stable reference to return. */
const EMPTY_IDS: ReadonlySet<string> = new Set<string>()

const WIDE_NODE: NodeSize = DEFAULT_NODE_SIZE
const COMPACT_NODE: NodeSize = { width: 132, height: 44 }
const COMPACT_GAP: Gap = { depth: 34, sibling: 10 }

export default function Mindtree(): ReactElement {
  const locale = useLocale()
  const rtl = locale === 'ar'
  const compact = useIsCompact()

  const [prefs, setPrefs] = useState<MindtreePrefs>(readPrefs)
  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER)
  const [zoom, setZoom] = useState(1)
  /** Bumped by every zoom press; the announcement effect hangs off it. */
  const [zoomTick, setZoomTick] = useState(0)
  /** null = "stay fitted". See the viewBox note in this file's header. */
  const [pan, setPan] = useState<{ x: number; y: number } | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [drillId, setDrillId] = useState<string | null>(null)
  const [live, setLive] = useState('')
  const [exporting, setExporting] = useState(false)

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
  const trackLabelOf = useTrackLabel()
  const vocabLabelOf = useVocabLabel()

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

  const dimension = prefs.dimension

  useEffect(() => {
    void loadEntries()
    // Deduped in the store: the Shell warms both on sign-in, and a second call
    // from a screen that genuinely needs them costs nothing.
    void loadTrackSlas()
  }, [])

  useEffect(() => {
    writePrefs(prefs)
  }, [prefs])

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
  const collapsedIds = useMemo(
    () => (compact ? EMPTY_IDS : new Set(prefs.collapsed[dimension] ?? [])),
    [prefs.collapsed, dimension, compact],
  )
  const openedIds = useMemo(() => new Set(prefs.opened[dimension] ?? []), [prefs.opened, dimension])

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
        expandedIds: openedIds,
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
      openedIds,
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

  /** The subtree actually drawn — the whole map, or one drill-in. */
  const drawnRoot = useMemo(() => {
    if (drillId === null) return tree
    // A drill target can vanish under the reader: a filter keystroke, a
    // realtime close, a dimension switch. Falling back to the whole map is the
    // only recovery that leaves something on screen.
    return findNode(tree, drillId) ?? tree
  }, [tree, drillId])

  const nodeSize = compact ? COMPACT_NODE : WIDE_NODE
  const gap = compact ? COMPACT_GAP : DEFAULT_GAP

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
  const activeId = focusId !== null && layout.byId.has(focusId) ? focusId : (order[0]?.id ?? null)

  useEffect(() => {
    // Keep the roving tab stop on a node that still exists. A filter keystroke
    // can delete the focused branch out from under the reader, and a tabindex
    // pointing at nothing drops them back to the top of the document.
    if (focusId !== null && !layout.byId.has(focusId)) setFocusId(order[0]?.id ?? null)
  }, [layout, focusId, order])

  const registerRef = useCallback((id: string, el: SVGGElement | null) => {
    if (el === null) nodeRefs.current.delete(id)
    else nodeRefs.current.set(id, el)
  }, [])

  const moveFocus = useCallback((id: string | undefined) => {
    if (id === undefined) return
    setFocusId(id)
    // Real DOM focus, not just a tabindex change: `aria-activedescendant` is
    // the alternative and it is the weaker one here, because the nodes are
    // genuinely focusable elements and a reader's virtual cursor should land on
    // the mark itself.
    nodeRefs.current.get(id)?.focus()
  }, [])

  /**
   * BOTH SETS ARE WRITTEN, every time, and that is what makes the default
   * changeable. `collapsed` means "the reader closed this" and `opened` means
   * "the reader opened this"; a branch in neither takes `OPEN_DEPTH`'s answer.
   * Recording only the closes — which is what a build with no default needs —
   * would make an expand indistinguishable from never having been touched, so
   * every track the reader opened would slam shut on the next render.
   */
  const setCollapsed = useCallback(
    (id: string, collapsed: boolean) => {
      setPrefs((prev) => {
        const closed = new Set(prev.collapsed[dimension] ?? [])
        const open = new Set(prev.opened[dimension] ?? [])
        if (collapsed) {
          closed.add(id)
          open.delete(id)
        } else {
          closed.delete(id)
          open.add(id)
        }
        return {
          ...prev,
          collapsed: { ...prev.collapsed, [dimension]: [...closed] },
          opened: { ...prev.opened, [dimension]: [...open] },
        }
      })
    },
    [dimension],
  )

  const toggleFold = useCallback(
    (id: string) => {
      setPrefs((prev) => {
        const held = new Set(prev.opened[dimension] ?? [])
        if (held.has(id)) held.delete(id)
        else held.add(id)
        return { ...prev, opened: { ...prev.opened, [dimension]: [...held] } }
      })
    },
    [dimension],
  )

  /**
   * The chain from the whole-map root down to the branch the reader has drilled
   * into, EXCLUDING that branch itself.
   *
   * Declared above `activate` rather than beside the breadcrumb it renders,
   * because `activate` needs it to step back OUT one ring and a `useCallback`
   * dependency array is evaluated where it is written — a `crumbs` declared
   * further down would be a temporal-dead-zone ReferenceError on first render,
   * not a stale value.
   */
  const crumbs = useMemo(() => {
    if (drillId === null) return []
    return pathTo(tree, drawnRoot.id).slice(0, -1)
  }, [drillId, tree, drawnRoot.id])

  /** Every entry currently drawn, in reading order — the sheet's prev/next. */
  const drawnEntryIds = useMemo(
    () =>
      order
        .map((pos) => pos.node.entryId)
        .filter((id): id is string => id !== null),
    [order],
  )

  const activate = useCallback(
    (node: MindNodeModel) => {
      // A pan that happens to end over a node is not a tap on it.
      if (draggedRef.current) return
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
        if (drillId === null) return
        const parent = crumbs[crumbs.length - 1]
        const up = parent === undefined || parent.id === ROOT_ID ? null : parent.id
        setDrillId(up)
        setLive(up === null ? t('mindtree.clearFocus') : t('mindtree.focused', { label: textOf(parent.label) }))
        return
      }
      if (compact && node.children.length > 0) {
        // The small-screen drill: the tapped branch becomes the drawn root and
        // the ring under it appears. Collapse/expand is not offered here — with
        // one ring drawn there is nothing to collapse, and a control that did
        // nothing would be worse than its absence.
        setDrillId(node.id)
        setLive(t('mindtree.focused', { label: textOf(node.label) }))
        return
      }
      if (node.children.length > 0) setCollapsed(node.id, !node.collapsed)
    },
    [drawnEntryIds, toggleFold, drawnRoot.id, drillId, crumbs, compact, setCollapsed, textOf],
  )

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<SVGSVGElement>) => {
      if (activeId === null) return
      const at = order.findIndex((pos) => pos.id === activeId)
      if (at < 0) return
      const pos = order[at] as PositionedNode<MindNodeModel>
      const node = pos.node
      const drawn = pos.childIds.length > 0

      // "Toward the children" is an inline-end concept. The drawing is already
      // mirrored by the layout module, so the KEYS have to mirror too or the
      // arrow that opens a branch in English closes it in Arabic.
      const forward = rtl ? 'ArrowLeft' : 'ArrowRight'
      const backward = rtl ? 'ArrowRight' : 'ArrowLeft'

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault()
          moveFocus(order[at + 1]?.id)
          return
        case 'ArrowUp':
          event.preventDefault()
          moveFocus(order[at - 1]?.id)
          return
        case 'Home':
          event.preventDefault()
          moveFocus(order[0]?.id)
          return
        case 'End':
          event.preventDefault()
          moveFocus(order[order.length - 1]?.id)
          return
        case 'Enter':
        case ' ':
          event.preventDefault()
          activate(node)
          return
        case 'Escape':
          if (drillId !== null) {
            event.preventDefault()
            setDrillId(null)
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
          else if (compact) setDrillId(node.id)
          else setCollapsed(node.id, false)
        } else if (drawn) {
          moveFocus(pos.childIds[0])
        }
        return
      }

      if (event.key === backward) {
        event.preventDefault()
        if (drawn) {
          if (node.kind === 'more') toggleFold(node.id)
          else setCollapsed(node.id, true)
        } else if (pos.parentId !== null) {
          moveFocus(pos.parentId)
        }
      }
    },
    [activeId, order, rtl, moveFocus, activate, drillId, compact, toggleFold, setCollapsed],
  )

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
  }, [fit.scale])

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
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
    [centerX, centerY, heldZoom],
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
    setPrefs((prev) => ({
      ...prev,
      collapsed: { ...prev.collapsed, [dimension]: [] },
      // BRANCHES AS WELL AS FOLDS. Clearing `collapsed` alone was enough while
      // every branch opened by default; with `OPEN_DEPTH` closing the track
      // ring, "Expand all" has to say so explicitly or it opens nothing.
      opened: { ...prev.opened, [dimension]: [...branchIds, ...foldIds] },
    }))
    setLive(t('mindtree.expandedAll'))
  }, [dimension, branchIds, foldIds])

  const collapseAll = useCallback(() => {
    setPrefs((prev) => ({
      ...prev,
      collapsed: { ...prev.collapsed, [dimension]: branchIds },
      opened: { ...prev.opened, [dimension]: [] },
    }))
    setLive(t('mindtree.collapsedAll'))
  }, [dimension, branchIds])

  const chooseDimension = useCallback((next: MindDimension) => {
    setPrefs((prev) => (prev.dimension === next ? prev : { ...prev, dimension: next }))
    setDrillId(null)
    setLive(
      t('mindtree.groupChanged', {
        label: t(MIND_DIMENSIONS.find((d) => d.key === next)?.labelKey ?? 'mindtree.dimStatus'),
      }),
    )
  }, [])

  const setView = useCallback((next: MindtreeView) => {
    setPrefs((prev) => (prev.view === next ? prev : { ...prev, view: next }))
    // The whole content region is swapped — a role="tree" for a <table> — and
    // every other state change on this screen announces. The toggle's own label
    // flips while it holds focus, which screen readers do not reliably re-read.
    setLive(
      t('mindtree.viewChanged', {
        label: next === 'table' ? t('mindtree.tableLabel') : t('mindtree.title'),
      }),
    )
  }, [])

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
            onClick={() => setView(prefs.view === 'map' ? 'table' : 'map')}
          >
            {prefs.view === 'map' ? (
              <IconChart size={16} aria-hidden="true" />
            ) : (
              <IconLayers size={16} aria-hidden="true" />
            )}
            {prefs.view === 'map' ? t('mindtree.tableToggle') : t('mindtree.mapToggle')}
          </button>

          {prefs.view === 'map' && (
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

      {crumbs.length > 0 && (
        <nav className="mtree-crumbs" aria-label={t('mindtree.breadcrumb')}>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDrillId(null)}>
            {t('mindtree.backToRoot')}
          </button>
          {crumbs.slice(1).map((node) => (
            <span key={node.id} className="mtree-crumbs">
              <span className="mtree-crumb-sep" aria-hidden="true">
                ›
              </span>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setDrillId(node.id)}
              >
                {t('mindtree.backTo', { label: textOf(node.label) })}
              </button>
            </span>
          ))}
        </nav>
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
      ) : prefs.view === 'table' ? (
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
        <div className="mtree-canvas" ref={canvasRef}>
          <svg
            ref={svgRef}
            className="mtree-svg"
            viewBox={viewBox}
            preserveAspectRatio="xMidYMid meet"
            role="tree"
            aria-label={t('mindtree.treeLabel', { label: dimensionLabel })}
            // The keyboard contract, POINTED AT rather than left at the bottom
            // of the document for a reader to stumble over after walking the
            // whole map. See the paragraph it names.
            aria-describedby={hintId}
            tabIndex={-1}
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
              const view = views.get(pos.id)
              if (view === undefined) return null
              return (
                <MindNode
                  key={pos.id}
                  pos={pos}
                  view={view}
                  rtl={rtl}
                  focused={pos.id === activeId}
                  current={pos.id === currentId}
                  onActivate={activate}
                  onFocus={setFocusId}
                  registerRef={registerRef}
                />
              )
            })}
          </svg>
        </div>
      )}

      {prefs.view === 'map' && (
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
          <p className="sr-only" id={hintId}>
            {t('mindtree.keyboardHint')}
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
        {live}
      </p>
    </div>
  )
}
