// The VISIBLE half of dragging work around the map — and the keyboard half,
// which is the same feature reached with two hands on the home row.
//
// THREE MODULES ALREADY DECIDED EVERYTHING THIS FILE DRAWS, and none of them
// knows about the other two:
//
//   lib/dnd.ts                  when a press becomes a drag (threshold, hold,
//                               abandon) and how fast an edge auto-scrolls.
//   lib/mindtree/drag.ts        where the pointer is, in layout units, and which
//                               branch it is over.
//   lib/mindtree/dropRules.ts   what a drop MEANS — the patch, the no-op, or the
//                               refusal, folded over the WHOLE root-to-target
//                               path rather than the node under the pointer.
//
// What is left for this file is the part a person can see and hear: the ghost
// that follows the finger, the branch that lights up, the sentence that says why
// a branch will not take the work, the write, and the announcement. It computes
// no policy of its own. Every refusal it shows is a key one of those three
// modules returned, which is what stops the picture and the database from
// disagreeing about what a drop does.
//
// ── THE RULE THAT PROTECTS EVERYTHING ──────────────────────────────────────
//
// A DRAG IS A MUTATION OF REAL WORK, so a drop goes through `patchEntry` — the
// same optimistic-write-plus-rollback path the board, the tree and the node menu
// use — and NEVER through a bespoke write. The store owns the optimistic row, the
// rollback and the `pgErrorKey` toast; this file owns the gesture and the
// sentence. That division is why a failed drop puts the entry back where it was
// with a reason on screen, and why nothing here can lose an entry: the tree is
// rebuilt from the store, so "put it back" is not an undo this file performs, it
// is the absence of a change this file never made.
//
// `setStatus()` is deliberately NOT used for a status drop, even though the board
// routes its status moves through it. A drop on a group folds its ancestry, so
// one drop can write `trackId` AND `status` (see dropRules' header); `setStatus`
// is a one-column convenience over `patchEntry` and cannot express that. Both are
// the same seam — `setStatus` IS `patchEntry(id, { status })` — so nothing is
// routed around, and `api/entries.updateEntry()` still appends the transition row
// itself, which is why no `postUpdate()` appears anywhere below.
//
// ── THE GHOST IS NOT THE NODE ──────────────────────────────────────────────
//
// The lifted card is a SEPARATE HTML element following the pointer, and the node
// stays exactly where the layout put it, wearing a dashed outline. Moving the
// real node would mean re-running `layoutMindtree` on every pointer move — a
// tidy tree is a global arrangement, so dragging one leaf would reflow every
// sibling under it, and the branch a reader was aiming at would walk away from
// the finger. The map holds still; only the ghost travels.
//
// It is HTML rather than SVG because it must escape the canvas: `.mtree-canvas`
// is `overflow: hidden`, and a ghost drawn inside the drawing would be clipped at
// the exact moment a reader drags toward the edge to make the map auto-pan. A
// `position: fixed` element is in the viewport's coordinate space, which is also
// the space `PointerEvent.clientX` is already in — no conversion, and none of the
// staleness a converted copy would carry.
//
// ITS POSITION IS WRITTEN STRAIGHT TO THE DOM, not held in state. lib/dnd.ts's
// header states the rule for the board — "a drag across 400 pixels re-renders on
// the two or three moves that change a column, not on all 400" — and it binds
// harder here, because a re-render of this screen is a re-render of every node in
// the map. So `ghostRef.current.style.transform` is set in the move handler, and
// React is told about a drag exactly twice: when it starts and when it ends.
//
// ── ONE SOURCE OF TRUTH FOR WHAT IS UNDER THE POINTER ──────────────────────
//
// `store/mindtree`'s `MindDrag` is it. `setMindDragOver` is called with the node
// and the refusal, `useMindDrag()` reads them back here and in any other surface
// that cares, and the store returns the SAME state when nothing changed — which
// is what keeps hundreds of pointer moves at zero renders. Nothing in this file
// keeps a second copy of the target, so the highlight, the chip, the announcement
// and the write cannot drift apart.
//
// A "no-op" target — the branch a row is already filed under — is published as a
// refusal key too (`DROP_UNCHANGED_KEY`), because from the store's point of view
// the question is "will this drop write anything", and the answer is no. The
// styling tells the two apart by comparing against that one key: landing where
// you started is not an error and must not be painted as one.
//
// ── THE KEYBOARD IS THE FEATURE, NOT THE FALLBACK ──────────────────────────
//
// Space picks the focused item up, the arrow keys walk the candidate branches
// exactly as they walk the tree when nothing is lifted (Down/Up for the next and
// previous branch, inline-forward to step into a ring, inline-backward to step
// out — mirrored in Arabic, like everything else on this screen), Enter drops,
// Escape puts it back. Every step is announced, every step highlights the branch
// in the picture, and a candidate outside the current view PANS THE MAP to bring
// itself into it — a keyboard user who cannot see where the work went has not
// been given the feature, only told about it.
//
// Focus does NOT move to the candidate. The lifted node keeps it, so Escape and
// Enter keep arriving at the element the reader is on, and the page's roving
// tabindex is left exactly as it was — a drag that ends must not have moved the
// reader's place in the tree as a side effect.
//
// ── WHAT IT REFUSES TO DO ──────────────────────────────────────────────────
//
// It does not lift a branch (dropRules: a bulk re-file with no undo, and ring-1
// order is an admin setting). It does not lift an entry the reader may not edit
// (`canEditEntry`, imported and never restated — lib/permissions.ts's whole
// argument is that a card which moves 300px and springs back has told a bigger
// lie than a control that was never armed). It does not lift anything when the
// picture is showing no droppable branch at all, which is the phone's one-ring
// drill-in: a gesture whose every outcome is "nowhere to put it" is worse than no
// gesture, and the pan it would steal is how a phone reads this screen.

import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type RefObject,
} from 'react'
import { confirm } from '../Confirm'
import { toast } from '../toast'
import { t, useLocale } from '../../lib/i18n'
import { pooled } from '../../lib/pooled'
import { canEditEntry } from '../../lib/permissions'
import type { DndBox } from '../../lib/dnd'
import {
  HOLD_MS,
  clientToLayout,
  dragPan,
  dropZonesFrom,
  holdMindDrag,
  isMindDragging,
  isMindHoldGesture,
  layoutSlop,
  mindDrop,
  moveMindDrag,
  startMindDrag,
  type MindDragSession,
  type MindDropZone,
  type Rect,
} from '../../lib/mindtree/drag'
import {
  DROP_UNCHANGED_KEY,
  closesEntry,
  evaluateDrop,
  isDropZoneKind,
} from '../../lib/mindtree/dropRules'
import { MIND_BULK_CONFIRM_AT } from '../../lib/mindtree/actions'
import { trailTo } from '../../lib/mindtree/focus'
import type { DrawnLayout, PositionedNode } from '../../lib/mindtree/layout'
import type { MindDimension, MindNode } from '../../lib/mindtree/model'
import {
  beginMindDrag,
  endMindDrag,
  getMindtreeState,
  setMindDragOver,
  useMindDrag,
} from '../../store/mindtree'
import { patchEntry } from '../../store/entries'
import type { Entry, EntryPatch, UserRole } from '../../types'
import './drag-layer.css'

/* ───────────────────────────────── constants ─────────────────────────────── */

/**
 * How long after a drag a click still belongs to that drag, in ms.
 *
 * pages/Board.tsx's number, and it must stay the board's number: the event being
 * suppressed is the browser's, not the app's — the `click` that every engine
 * synthesises from the `pointerup` that ended the gesture. On this screen it
 * would land on the node under the pointer and open that entry's sheet, one
 * frame after the reader deliberately dropped something onto it.
 */
const CLICK_SUPPRESS_MS = 400

/**
 * store/entries.ts's private `QUEUED_KEY`, which is NOT a failure: the write is
 * in the outbox and lands on reconnect.
 *
 * Duplicated as a literal because the store does not export it, exactly as
 * pages/Board.tsx and pages/tracks/TracksIndex.tsx already do. Three copies of
 * one string is a recorded extension-slot gap, not a licence to reach across the
 * module boundary for it.
 */
const QUEUED_ERROR_KEY = 'offline.queued'

/** The node box's corner radius, from MindNode.tsx. The outlines must match. */
const NODE_RX = 10

/** Inset of a candidate outline from the node's own box, in layout units. */
const ZONE_INSET = 3

/* ────────────────────────────────── the API ──────────────────────────────── */

export interface MindDragLayerOptions {
  /**
   * THE WHOLE TREE — never the drilled-in subtree.
   *
   * A drop is the whole path (dropRules' header): the branch labelled "Blocked"
   * under Network means "blocked AND Network", so the patch is folded from the
   * root down. On a phone the DRAWN root is a track, and on a two-step drill-in
   * it is a group — folding the drawn path there would write a status while
   * leaving the row on its old track, which is precisely the "branch labelled 12
   * showing 13" failure the fold exists to prevent. So the trail is taken from
   * the model tree and the drawing is used only for geometry.
   */
  root: MindNode
  /** The drawn layout: the drop zones, and the keyboard's candidate order. */
  layout: DrawnLayout<MindNode>
  dimension: MindDimension
  entryById: ReadonlyMap<string, Entry>
  /** `null` when signed out — never a stand-in id. See pages/Board.tsx. */
  meId: string | null
  role: UserRole
  /** Arabic. The arrow keys mirror; the geometry does not (layout.ts mirrored). */
  rtl: boolean
  /** The page's roving tab stop — what Space picks up. */
  focusedId: string | null
  /** The map's <svg>. Measured live: it carries both the box and the viewBox. */
  svgRef: RefObject<SVGSVGElement | null>
  /** A node's own text, already resolved by the page (`textOf(node.label)`). */
  labelOf: (node: MindNode) => string
  /**
   * Pan the map by a delta in DRAWING UNITS.
   *
   * Drawing units rather than pixels because this file has already converted —
   * it holds the viewBox and the canvas box for the hit test, and handing the
   * page pixels would mean the same ratio were applied in two places. The page
   * must anchor its pan first (`pan ?? centre of fit`), exactly as its zoom
   * buttons do, or the first auto-pan frame re-centres the whole map.
   */
  onPanBy: (dx: number, dy: number) => void
  /**
   * Drop the page's own pan gesture, because this one has taken over.
   *
   * Only ever called for a TOUCH lift. A finger is allowed to pan the map from a
   * node — that is the whole argument for the hold — so the page's pan and this
   * drag are both armed for HOLD_MS, and when the hold lands the page's has to
   * let go or the map slides under the ghost. A mouse press on a draggable node
   * never reaches the page at all (see `onNodePointerDown`), so nothing needs
   * cancelling there.
   */
  onPanCancel: () => void
  /**
   * A hold landed on a leaf that HAS NOWHERE TO GO — open that node's menu.
   *
   * THIS IS THE PHONE'S "WORK IN IT", and without it the small screen is
   * read-only. The compact map draws one ring at a time, so the ring that shows
   * entries shows no branch beside them: `zones` is empty and a drag would be a
   * gesture with no possible outcome. The 400 ms hold is still the right
   * gesture — it is the only one a thumb has spare — so it opens the verbs
   * instead of lifting a ghost. Same node, same `mindActionsFor`, same
   * `patchEntry`; the reader assigns, re-statuses or closes from there.
   *
   * Client (viewport) pixels, the coordinates `NodeMenu` places against.
   */
  onNodeMenu?: (pos: PositionedNode<MindNode>, at: { x: number; y: number }) => void
  /**
   * A write is about to rebuild the tree around `entryId`.
   *
   * Called ONCE per committed drop, immediately before `patchEntry` — the store
   * applies the optimistic row before it awaits the request, so the rebuild is
   * synchronous with the drop and the `<g role="treeitem">` holding DOM focus
   * unmounts. A MindNode id embeds its bucket path, so a successful drop always
   * changes it; nothing re-focuses on its own and the browser drops focus to
   * `<body>`. The surface owns the map's focus, so it is the surface that puts
   * it back — see `pages/Mindtree.tsx`'s `requestRefocus`.
   */
  onWrote?: (entryId: string) => void
  /** Table view, a loading skeleton — anything where the map is not on screen. */
  disabled?: boolean
}

/** What the layer draws while something is lifted. Set twice per drag. */
interface MindLift {
  /** A pointer drag floats a ghost; a keyboard drag shows a status bar. */
  readonly via: 'pointer' | 'key'
  /** The entries travelling, in reading order. */
  readonly entryIds: readonly string[]
  /** The lifted node's own title, for the ghost and the announcements. */
  readonly title: string
  /** Every DRAWN node carrying one of `entryIds` — outlined as "travelling". */
  readonly rects: readonly MindDropZone[]
  /** Where the pointer was at the lift, so the ghost's first paint is correct. */
  readonly at: { readonly x: number; readonly y: number }
}

/** The verdict for one target, over every row being carried. */
interface DropPlan {
  readonly targetId: string
  readonly targetLabel: string
  /** The write, shared by every id below — the fold reads the path, not the row. */
  readonly patch: EntryPatch | null
  /** Rows that would actually change. Empty means the drop writes nothing. */
  readonly ids: readonly string[]
  /** Rows already in this bucket. */
  readonly unchanged: number
  /**
   * The sentence for a drop that writes nothing: a refusal, or "already there".
   * Null exactly when `ids` is non-empty.
   */
  readonly blockedKey: string | null
  /** Does this drop close an entry? Then the reader is asked first. */
  readonly closes: boolean
}

export interface MindDragController {
  /** Something is lifted — a pointer drag or a keyboard move. */
  readonly active: boolean
  /** The id of the <p> carrying the drag's keyboard instructions. */
  readonly hintId: string
  /** Every droppable branch, in layout units. The overlay draws these. */
  readonly zones: readonly MindDropZone[]
  /** Internal: what the two components render. Not for the page to read. */
  readonly lift: MindLift | null
  readonly ghostRef: RefObject<HTMLDivElement | null>
  readonly announcement: { readonly text: string; readonly seq: number }
  readonly rtl: boolean
  /** Put on every node: the press that may become a lift. */
  onNodePointerDown: (pos: PositionedNode<MindNode>, ev: ReactPointerEvent<Element>) => void
  /** Call FIRST from the map's `onKeyDown`. True means the key was consumed. */
  handleKeyDown: (ev: ReactKeyboardEvent<Element>) => boolean
  /** True while a press is armed or live — the page must not pan or tap. */
  isPressing: () => boolean
  /**
   * True while something is IN THE AIR, by either input. Read it after
   * `handleKeyDown` returns false: a lift owns the keyboard until Enter, Escape
   * or Tab ends it, so a key this layer did not consume must still not reach the
   * map's own grammar.
   *
   * A FUNCTION OVER REFS, not the `active` flag, and the difference is
   * load-bearing: `active` is render state, and the one key that ends a lift and
   * deliberately returns false — Tab — has already cleared the refs by the time
   * the caller looks, while `active` still reads true for the rest of the render
   * and would swallow the Tab that is leaving.
   */
  isLifted: () => boolean
  /** True for the one click a finished drag synthesises. Consumes the flag. */
  justDragged: () => boolean
}

/* ──────────────────────────────── measuring ──────────────────────────────── */

/** The two rectangles a hit test needs, read LIVE from the drawing. */
interface MindSpace {
  /** The <svg> in viewport pixels. */
  readonly canvas: Rect
  /** Its viewBox, in drawing units. */
  readonly view: Rect
  /** Pixels per drawing unit — what `layoutSlop` converts against. */
  readonly scale: number
}

/**
 * Both rectangles, from the element itself.
 *
 * READ FROM THE DOM RATHER THAN FROM PROPS, and that is the difference between a
 * hit test that is right and one that is right most of the time. The page holds
 * the viewBox as a string built from four pieces of state, and the auto-pan below
 * changes one of them on every frame of a drag toward the edge; a copy passed
 * down as a prop is one render behind for exactly as long as the pointer is
 * moving. `svg.viewBox.baseVal` is the parsed attribute, so it is whatever is on
 * screen this instant.
 *
 * `preserveAspectRatio="xMidYMid meet"` letterboxes a viewBox whose aspect
 * differs from its element's — which would put every hit a few pixels out — and
 * it does not happen here: `fitToViewBox` derives the box from the measured
 * viewport (`viewWidth / scale` on both axes), so the two aspects agree up to the
 * rounding of one drawing unit. The only window where they do not is the frame
 * between a resize and the ResizeObserver that answers it, and `DROP_SLOP_PX`
 * covers more than that.
 */
function readSpace(svg: SVGSVGElement | null): MindSpace | null {
  if (svg === null) return null
  const canvas = svg.getBoundingClientRect()
  const view = svg.viewBox.baseVal
  if (!(canvas.width > 0) || !(canvas.height > 0)) return null
  if (!(view.width > 0) || !(view.height > 0)) return null
  return {
    canvas,
    view: { x: view.x, y: view.y, width: view.width, height: view.height },
    scale: canvas.width / view.width,
  }
}

/** A DOMRect as lib/dnd's box. Named x0/x1 so the physical-property grep stays
 *  quiet — the same reason that file gives. */
function boxOf(rect: Rect): DndBox {
  return { x0: rect.x, x1: rect.x + rect.width, y0: rect.y, y1: rect.y + rect.height }
}

/* ─────────────────────────────── the controller ──────────────────────────── */

/** What the gesture is carrying: the rows, and the boxes drawn for them. */
interface MindCarry {
  readonly ids: readonly string[]
  readonly rects: readonly MindDropZone[]
}

const NO_CARRY: MindCarry = Object.freeze({ ids: Object.freeze([]), rects: Object.freeze([]) })

export function useMindDragLayer(options: MindDragLayerOptions): MindDragController {
  // Only the three that are read DURING RENDER are destructured. Everything a
  // window handler needs at event time comes off `ctxRef` below instead — see
  // the comment on it.
  const { layout, root, rtl } = options

  const hintId = useId()
  const [lift, setLift] = useState<MindLift | null>(null)
  const [announcement, setAnnouncement] = useState({ text: '', seq: 0 })

  /**
   * Everything a window handler must read AT THE MOMENT THE EVENT FIRES, in one
   * ref refreshed on every render.
   *
   * The handlers below are bound to `window` for the length of a gesture and
   * must not be re-bound when a store update changes an unrelated prop — a
   * listener swapped mid-drag is a `pointerup` delivered to the handler that is
   * no longer listening. So they close over nothing but this ref, which is the
   * pattern pages/Board.tsx uses for the same four values.
   */
  const ctxRef = useRef(options)
  ctxRef.current = options

  const sessionRef = useRef<MindDragSession | null>(null)
  /**
   * Decided ONCE, at the press, and not re-derived at the lift.
   *
   * Four hundred milliseconds separate a touch press from its hold, and a
   * realtime patch inside that window can rebuild the tree — so asking twice
   * would risk writing a set of rows the reader never picked up.
   */
  const carriedRef = useRef<MindCarry>(NO_CARRY)
  const listeningRef = useRef(false)
  const holdTimerRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)
  const draggedAtRef = useRef(0)
  const lastClientRef = useRef({ x: 0, y: 0 })
  const ghostRef = useRef<HTMLDivElement | null>(null)
  /**
   * The keyboard move: what is carried, and which candidate is armed.
   *
   * THE TARGET IS A NODE ID, NEVER AN INDEX. `candidates` is rebuilt from
   * `layout` on every tree rebuild, and the tree is rebuilt on every realtime
   * batch — a colleague filing one item into a previously-empty bucket INSERTS a
   * candidate (`model.vocabGroups` only emits populated groups), and everything
   * after it shifts by one. An index armed before that patch and read at the
   * Enter therefore names a different branch than the one the highlight frames
   * and the announcement said: the reader aims at Network › Blocked and writes
   * "move to Network", silently dropping the status. A removal shifts the other
   * way and can land the drop on a different track AND a different status.
   *
   * The pointer path was never exposed: `MindDragSession.overNodeId` is an id
   * re-resolved against fresh geometry on every move. This makes the keyboard
   * path say the same thing — the store already carries the id in
   * `drag.overNodeId`, so the highlight, the sentence and the write are now
   * provably one node.
   */
  const keyRef = useRef<{
    entryIds: readonly string[]
    title: string
    /** Null before the first candidate is armed. */
    nodeId: string | null
  } | null>(null)

  const announce = useCallback((text: string) => {
    // `seq` keys the rendered child so an identical consecutive sentence still
    // re-announces: stepping across two branches that refuse for the same reason
    // produces the same string twice, and a region that only reacts to text
    // CHANGES swallows the second one. pages/Board.tsx's live region does the
    // same, for the same reason.
    setAnnouncement((prev) => ({ text, seq: prev.seq + 1 }))
  }, [])

  /* ── the drawn geometry ─────────────────────────────────────────────── */

  /**
   * THE DRAWN ROOT IS NOT A DROP TARGET, and excluding it is a correctness fix
   * rather than a tidy-up.
   *
   * Everything drawn is INSIDE the drawn root by construction, so a drop onto it
   * folds to a patch every drawn row already satisfies — `evaluateDrop` answers
   * `noop` every single time. On a desktop that is one keyboard candidate that
   * can only ever say "it is already there". On a PHONE it was fatal: the
   * one-ring drill-in draws a group and its entries, so the root was the only
   * zone, `zones.length` was 1 rather than 0, and `onNodePointerDown`'s
   * "nowhere to drop" guard never fired — every hold lifted a ghost, stole the
   * pan, and announced a no-op. The guard was right; the set it measured was not.
   *
   * `depth > 0` rather than an id comparison because the layout already
   * normalises the drawn root to depth zero, whether it is the workspace root, a
   * track two rings in, or a group on a phone.
   */
  const zones = useMemo(
    () =>
      dropZonesFrom(
        layout,
        (node: MindNode, positioned) => isDropZoneKind(node.kind) && positioned.depth > 0,
      ),
    [layout],
  )
  const zonesRef = useRef(zones)
  zonesRef.current = zones

  /**
   * The keyboard's candidate list — the same nodes as `zones`, still positioned,
   * because stepping in and out of a ring needs `parentId` and `childIds`.
   *
   * PRE-ORDER, inherited from `layout.nodes`, so Down/Up walks the branches in
   * the order the tree itself reads. A separate ordering here would mean the
   * arrow keys meant one thing while reading and another while moving.
   */
  const candidates = useMemo(
    // Same set as `zones`, drawn root excluded for the same reason.
    () => layout.nodes.filter((pos) => isDropZoneKind(pos.node.kind) && pos.depth > 0),
    [layout],
  )
  const candidatesRef = useRef(candidates)
  candidatesRef.current = candidates

  /**
   * Where the armed candidate sits in the CURRENT list, or -1 when it is gone.
   *
   * Resolved at use time rather than stored — see `keyRef`. The arrow keys step
   * from here; -1 means the branch the reader was aiming at no longer exists,
   * and every caller treats that as "nothing armed" rather than as an offset
   * into a list that changed shape underneath them.
   */
  const armedIndex = useCallback(
    (): number => armedIndexIn(candidatesRef.current, keyRef.current?.nodeId ?? null),
    [],
  )

  /**
   * Root-to-node trails, memoised for one tree.
   *
   * `trailTo` is a walk of the whole model, and the hover path calls it every
   * time the pointer crosses into a new branch. The cache is dropped whenever the
   * tree is rebuilt, which is exactly when a trail could have gone stale.
   *
   * Seeded with the root's own trail, which is both true (`trailTo(root,
   * root.id)` is `[root]`) and the one entry that needs no walk to know.
   */
  const trails = useMemo(
    () => new Map<string, readonly MindNode[] | null>([[root.id, [root]]]),
    [root],
  )

  const pathOf = useCallback(
    (nodeId: string): readonly MindNode[] | null => {
      const held = trails.get(nodeId)
      if (held !== undefined) return held
      const trail = trailTo(root, nodeId)
      trails.set(nodeId, trail)
      return trail
    },
    [root, trails],
  )

  /* ── the verdict ────────────────────────────────────────────────────── */

  /**
   * What dropping `entryIds` onto `targetId` would do — ONE call to
   * `evaluateDrop` per row, and no second opinion anywhere.
   *
   * Called on hover as well as on release, which is what makes the highlight and
   * the write incapable of disagreeing: the branch lights up green because this
   * function said `patch`, and the patch that lands is the one it returned.
   *
   * THE PATCH IS SHARED. `foldPath` reads the PATH and the dimension and nothing
   * else, so every row that is not a no-op resolves to the identical write —
   * which is why the bulk arm below can pass one `EntryPatch` to `pooled` instead
   * of pairing a patch with each id.
   */
  const planDrop = useCallback(
    (targetId: string, entryIds: readonly string[]): DropPlan | null => {
      const { entryById, dimension, labelOf } = ctxRef.current
      const path = pathOf(targetId)
      const target = path === null ? undefined : path[path.length - 1]
      // The branch left the tree between the hover and the release — a realtime
      // close, a filter keystroke, a rebuild. There is nothing to fold.
      if (path === null || target === undefined) return null

      let patch: EntryPatch | null = null
      let refusalKey: string | null = null
      let closes = false
      let unchanged = 0
      const ids: string[] = []

      for (const entryId of entryIds) {
        const outcome = evaluateDrop({
          source: { kind: 'entry', entryId },
          entry: entryById.get(entryId),
          path,
          dimension,
        })
        if (outcome.kind === 'patch') {
          patch = outcome.patch
          ids.push(entryId)
          if (closesEntry(outcome)) closes = true
        } else if (outcome.kind === 'noop') {
          unchanged += 1
        } else if (refusalKey === null) {
          // The FIRST refusal, not the last: a mixed selection is refused for
          // whichever reason the reading order meets first, which is the row the
          // reader is most likely to be looking at.
          refusalKey = outcome.reasonKey
        }
      }

      return {
        targetId,
        targetLabel: labelOf(target),
        patch,
        ids,
        unchanged,
        // A drop that writes nothing still has to SAY something. A refusal wins
        // over "already there" when the two are mixed, because a reader who is
        // told nothing moved will try again; one who is told why will not.
        blockedKey: ids.length > 0 ? null : (refusalKey ?? DROP_UNCHANGED_KEY),
        closes,
      }
    },
    [pathOf],
  )

  /** Publish the target — the ONE write to the shared drag state. */
  const paintTarget = useCallback(
    (targetId: string | null): DropPlan | null => {
      if (targetId === null) {
        setMindDragOver(null, null)
        return null
      }
      const plan = planDrop(targetId, carriedRef.current.ids)
      setMindDragOver(targetId, plan === null ? 'mindtree.dropRefusedUnknown' : plan.blockedKey)
      return plan
    },
    [planDrop],
  )

  /* ── the write ──────────────────────────────────────────────────────── */

  const commitDrop = useCallback(
    async (targetId: string, via: 'pointer' | 'key', entryIds: readonly string[]): Promise<void> => {
      const { entryById } = ctxRef.current
      const plan = planDrop(targetId, entryIds)
      if (plan === null) {
        // SAID ONCE, SEEN ONCE. Every toast below is `silent` because the
        // sentence beside it has already gone into this layer's own live region,
        // and `components/toast.tsx`'s host is itself `aria-live="polite"` — so
        // an ordinary toast here would make a screen reader read the whole move
        // twice. The toast stays because it is the VISIBLE half: a finger that
        // has let go is looking at a node that snapped back for no visible
        // reason. See ToastOptions.silent.
        announce(t('mindtree.dropRefusedUnknown'))
        toast(t('mindtree.dropRefusedUnknown'), { tone: 'error', silent: true })
        return
      }

      // Nothing to write: a refusal, or the row is already there.
      if (plan.patch === null || plan.ids.length === 0) {
        const key = plan.blockedKey ?? DROP_UNCHANGED_KEY
        announce(t(key))
        // A REFUSAL IS NEVER SILENT. The chip said it while the finger was down,
        // but a finger that has already let go is looking at a node that snapped
        // back for no visible reason. "Already there" gets no toast on the
        // pointer path — the node visibly returned to the branch it came from,
        // which is the whole message — but it does on the keyboard path, which
        // has no motion to read.
        if (key !== DROP_UNCHANGED_KEY) toast(t(key), { tone: 'error', silent: true })
        else if (via === 'key') toast(t(key), { silent: true })
        return
      }

      const patch = plan.patch
      const single = plan.ids.length === 1
      const firstId = plan.ids[0] as string
      const title = entryById.get(firstId)?.title ?? ''

      // THE TWO DROPS THAT ARE ASKED ABOUT FIRST. Closing takes work off every
      // open list on this screen — the one drop that REMOVES rather than moves —
      // and a bulk re-file has no undo, which is the number
      // pages/tracks/TracksIndex.tsx settled on and actions.ts exports.
      if (plan.closes || plan.ids.length >= MIND_BULK_CONFIRM_AT) {
        const ok = await confirm(
          plan.closes && single
            ? {
                title: t('mindtree.confirmCloseTitle', { title, label: plan.targetLabel }),
                body: t('mindtree.confirmCloseBody'),
                confirmLabel: t('mindtree.confirmMove'),
                cancelLabel: t('common.cancel'),
                danger: true,
              }
            : {
                title: t('mindtree.confirmBulkTitle', { count: plan.ids.length }),
                body: t('mindtree.confirmBulkBody', { label: plan.targetLabel }),
                confirmLabel: t('mindtree.confirmMove'),
                cancelLabel: t('common.cancel'),
                danger: plan.closes,
              },
        )
        if (!ok) {
          announce(t('mindtree.dragCancelled'))
          return
        }
      }

      // Announced BEFORE the write settles, like the board's: the optimistic
      // apply has already moved the row by the time the request answers, and a
      // reader waiting on a round trip to hear that their drop landed would be
      // told about it a second after it happened. A failure replaces this
      // sentence with `dragFailed`.
      announce(
        single
          ? t('mindtree.dragMoved', { title, label: plan.targetLabel })
          : t('mindtree.dragMovedMany', { count: plan.ids.length, label: plan.targetLabel }),
      )

      // BEFORE the write, because the write is what destroys the focused node:
      // `patchEntry` commits the optimistic row before it awaits the request, so
      // by the first `await` the tree has already been rebuilt and the element
      // holding focus has already unmounted. The surface queues the repair and
      // performs it in a layout effect on the new layout.
      ctxRef.current.onWrote?.(firstId)

      // Six at a time, never all at once and never one after another — the whole
      // argument is in lib/pooled.ts's header, and re-deciding it here would give
      // this screen a different answer to "how much of the request budget may one
      // gesture spend" than the bulk bar has.
      const results = await pooled(plan.ids, (id) => patchEntry(id, patch))
      let failed = 0
      for (const result of results) {
        // Queued is outstanding, not failed: the outbox replays it on reconnect.
        if (!result.ok && result.error !== QUEUED_ERROR_KEY) failed += 1
      }

      if (failed > 0) {
        // The store has already rolled each failed row back and toasted its
        // REASON (`entry.errNotYours` for an RLS refusal, and so on). This is the
        // other half: what happened to the work.
        announce(t('mindtree.dragFailed'))
        return
      }

      // A pointer drag has its own motion for feedback; a keypress has none.
      if (via === 'key') {
        toast(
          single
            ? t('mindtree.dragMoved', { title, label: plan.targetLabel })
            : t('mindtree.dragMovedMany', { count: plan.ids.length, label: plan.targetLabel }),
          // The same sentence went into this layer's region above, before the
          // write settled. Announced once; seen once.
          { silent: true },
        )
      }
    },
    [announce, planDrop],
  )

  /* ── who travels ────────────────────────────────────────────────────── */

  /**
   * The rows this gesture carries, and the drawn nodes standing for them.
   *
   * THE BOARD'S RULE, stated in store/mindtree's `MindDrag`: if the lifted item
   * is part of the current selection the whole selection travels; otherwise only
   * the lifted one does. It is a rule about the GESTURE — "I meant these" — which
   * is why it lives here and not in the store.
   *
   * Filtered to what this reader may actually edit, in READING ORDER rather than
   * in the Set's insertion order, so the announcement counts what will move and
   * the ghost outlines the same rows the write will touch.
   */
  const carriedFor = useCallback(
    (entryId: string): { ids: readonly string[]; rects: readonly MindDropZone[] } => {
      const { entryById, meId, role, layout: drawn } = ctxRef.current
      const selection = getMindtreeState().selection
      const editable = (id: string): boolean => {
        const entry = entryById.get(id)
        return entry !== undefined && canEditEntry(entry, meId, role)
      }

      if (!selection.has(entryId)) {
        const pos = drawn.nodes.filter((p) => p.node.entryId === entryId)
        return { ids: [entryId], rects: pos.map(rectOf) }
      }

      const ids: string[] = []
      const rects: MindDropZone[] = []
      for (const pos of drawn.nodes) {
        const id = pos.node.entryId
        if (id === null || !selection.has(id) || !editable(id)) continue
        // A leaf can be drawn once per branch it belongs to; the id list must not
        // repeat it, but every drawn copy is outlined.
        if (!ids.includes(id)) ids.push(id)
        rects.push(rectOf(pos))
      }
      // The lifted row is always in, even if the selection has gone stale under
      // a rebuild: the reader is holding it.
      if (!ids.includes(entryId)) ids.unshift(entryId)
      return { ids, rects }
    },
    [],
  )

  /* ── the pointer gesture ────────────────────────────────────────────── */

  const endRef = useRef<(commit: boolean) => void>(() => {})

  const moveGhost = useCallback((x: number, y: number) => {
    const el = ghostRef.current
    // Written straight to the DOM: the ghost tracks the pointer at the frame
    // rate, and routing that through state would re-render the map on every move.
    if (el !== null) el.style.transform = `translate3d(${x}px, ${y}px, 0)`
  }, [])

  /** The auto-pan loop. Runs only while a pointer drag is live. */
  const tick = useCallback(() => {
    rafRef.current = null
    const session = sessionRef.current
    if (session === null || !isMindDragging(session)) return

    const space = readSpace(ctxRef.current.svgRef.current)
    if (space !== null) {
      const client = lastClientRef.current
      const pan = dragPan(client, boxOf(space.canvas))
      if (pan.x !== 0 || pan.y !== 0) {
        ctxRef.current.onPanBy(
          (pan.x * space.view.width) / space.canvas.width,
          (pan.y * space.view.height) / space.canvas.height,
        )
        // The map has moved under a stationary finger, so the branch under the
        // pointer is not the branch that was under it a frame ago. Re-testing
        // here is what makes "drag to the edge and wait" a real gesture rather
        // than a scroll that arrives at a target the drop never notices.
        const at = clientToLayout(client, space.canvas, space.view)
        const next = moveMindDrag(session, client, at, zonesRef.current, layoutSlop(space.scale))
        sessionRef.current = next
        if (next.overNodeId !== session.overNodeId) paintTarget(next.overNodeId)
      }
    }

    rafRef.current = requestAnimationFrame(tick)
  }, [paintTarget])

  /**
   * The item is lifted — by distance under a mouse, or by the hold under a
   * finger. Both paths arrive here so the announcement, the auto-pan loop and the
   * rendering cannot drift apart between them.
   */
  const beginLift = useCallback(
    (session: MindDragSession) => {
      const { entryById } = ctxRef.current
      draggedAtRef.current = Date.now()
      const { ids, rects } = carriedRef.current
      const first = ids[0] ?? session.entryId
      const title = entryById.get(session.entryId)?.title ?? entryById.get(first)?.title ?? ''

      beginMindDrag({
        entryIds: ids,
        fromNodeId: session.fromNodeId ?? '',
        overNodeId: session.overNodeId,
        refusalKey: null,
      })
      setLift({
        via: 'pointer',
        entryIds: ids,
        title,
        rects,
        at: lastClientRef.current,
      })
      announce(
        ids.length > 1
          ? t('mindtree.dragGrabbedMany', { count: ids.length })
          : t('mindtree.dragGrabbed', { title }),
      )
      // The page's pan and this gesture were both armed for the length of the
      // hold; only one of them may own the finger from here.
      ctxRef.current.onPanCancel()
      paintTarget(session.overNodeId)
      if (rafRef.current === null) rafRef.current = requestAnimationFrame(tick)
    },
    [announce, paintTarget, tick],
  )

  const onWindowMove = useCallback(
    (ev: PointerEvent) => {
      const session = sessionRef.current
      if (session === null || ev.pointerId !== session.gesture.pointerId) return

      const client = { x: ev.clientX, y: ev.clientY }
      lastClientRef.current = client
      const space = readSpace(ctxRef.current.svgRef.current)
      // The map is not measurable — mid-teardown, or hidden. Leaving the session
      // armed means the pointerup still ends it cleanly.
      if (space === null) return

      const at = clientToLayout(client, space.canvas, space.view)
      const next = moveMindDrag(session, client, at, zonesRef.current, layoutSlop(space.scale))
      sessionRef.current = next
      if (next === session) return

      if (next.gesture.phase === 'abandoned') {
        // A finger that panned before its hold landed. Nothing was ever claimed,
        // so there is nothing to give back.
        endRef.current(false)
        return
      }
      if (next.gesture.phase !== 'dragging') return

      // Stops the native text-drag on a mouse. The canvas is already
      // `touch-action: none`, so a finger has no browser pan to cancel — which is
      // why this file has none of the board's non-passive touchmove machinery.
      if (ev.cancelable) ev.preventDefault()

      if (session.gesture.phase !== 'dragging') {
        beginLift(next)
        return
      }

      moveGhost(client.x, client.y)
      if (next.overNodeId !== session.overNodeId) paintTarget(next.overNodeId)
    },
    [beginLift, moveGhost, paintTarget],
  )

  const onWindowUp = useCallback((ev: PointerEvent) => {
    if (sessionRef.current?.gesture.pointerId !== ev.pointerId) return
    endRef.current(true)
  }, [])

  const onWindowCancel = useCallback(() => {
    endRef.current(false)
  }, [])

  const onWindowKey = useCallback((ev: KeyboardEvent) => {
    if (ev.key !== 'Escape') return
    ev.preventDefault()
    // Stopped as well as prevented: Escape also clears the map's drill-in, and a
    // reader cancelling a drag has not asked to leave the branch they are in.
    ev.stopPropagation()
    endRef.current(false)
  }, [])

  /**
   * A long press on a phone otherwise means "select this text" and, on Android,
   * "open the context menu" at around 500 ms — which is why the lift at 420 ms
   * wins that race and this is the belt to those braces. Suppressed for the whole
   * touch gesture rather than only once the hold has landed: a caret that appears
   * at 300 ms and is dismissed at 420 ms is a flicker nobody asked for.
   */
  const onWindowSuppress = useCallback((ev: Event) => {
    if (!isMindHoldGesture(sessionRef.current)) return
    ev.preventDefault()
  }, [])

  const endGesture = useCallback(
    (commit: boolean) => {
      if (!listeningRef.current) return
      listeningRef.current = false
      window.removeEventListener('pointermove', onWindowMove)
      window.removeEventListener('pointerup', onWindowUp)
      window.removeEventListener('pointercancel', onWindowCancel)
      window.removeEventListener('keydown', onWindowKey, true)
      window.removeEventListener('selectstart', onWindowSuppress)
      window.removeEventListener('contextmenu', onWindowSuppress)
      if (holdTimerRef.current !== null) {
        // A press that ended — by release, by pan, or by the route unmounting —
        // must not lift an item four hundred milliseconds after it is over.
        window.clearTimeout(holdTimerRef.current)
        holdTimerRef.current = null
      }
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }

      const session = sessionRef.current
      const carried = carriedRef.current.ids
      sessionRef.current = null
      carriedRef.current = NO_CARRY
      setLift(null)
      endMindDrag()
      if (!isMindDragging(session)) return

      // A real drag just ended, so the click the browser is about to synthesise
      // from this pointerup belongs to the drag and not to the node under it.
      draggedAtRef.current = Date.now()

      const drop = commit ? mindDrop(session) : null
      if (drop === null) {
        announce(t('mindtree.dragCancelled'))
        return
      }
      void commitDrop(drop.overNodeId, 'pointer', carried)
    },
    [announce, commitDrop, onWindowCancel, onWindowKey, onWindowMove, onWindowSuppress, onWindowUp],
  )
  endRef.current = endGesture

  /* ── the keyboard gesture ───────────────────────────────────────────── */

  const endKeyDrag = useCallback(() => {
    keyRef.current = null
    setLift(null)
    endMindDrag()
  }, [])

  /**
   * Bring a candidate into view, by panning the map the shortest distance that
   * puts its whole box inside the viewBox.
   *
   * Not a nicety. The map overflows on purpose — the fit refuses to shrink past a
   * tappable node — so a keyboard reader stepping through branches would
   * otherwise hear a target the picture never shows, which is the difference
   * between an accessible feature and a described one.
   */
  const revealZone = useCallback((zone: MindDropZone) => {
    const space = readSpace(ctxRef.current.svgRef.current)
    if (space === null) return
    const { view } = space
    const pad = 12
    let dx = 0
    let dy = 0
    if (zone.x - pad < view.x) dx = zone.x - pad - view.x
    else if (zone.x + zone.width + pad > view.x + view.width) {
      dx = zone.x + zone.width + pad - (view.x + view.width)
    }
    if (zone.y - pad < view.y) dy = zone.y - pad - view.y
    else if (zone.y + zone.height + pad > view.y + view.height) {
      dy = zone.y + zone.height + pad - (view.y + view.height)
    }
    if (dx !== 0 || dy !== 0) ctxRef.current.onPanBy(dx, dy)
  }, [])

  /**
   * Arm candidate `index`: publish it, pan to it, and say what it would do.
   *
   * `lead` IS PART OF THE SAME SENTENCE, not a second announcement, and that is
   * a bug fix rather than a flourish. The pick-up arms its first candidate in the
   * same tick it says "Picked up X" — two `announce()` calls in one React batch,
   * of which only the last is ever rendered, so the reader would be told where
   * the item could go and never told that they had picked anything up.
   */
  const armCandidate = useCallback(
    (index: number, lead?: string) => {
      const held = keyRef.current
      const list = candidatesRef.current
      const pos = list[index]
      if (held === null || pos === undefined) return
      keyRef.current = { ...held, nodeId: pos.id }
      const plan = paintTarget(pos.id)
      revealZone(rectOf(pos))
      // `nodeName` — the map's OWN "⟨label⟩, detail" sentence, the one every
      // branch is already announced with. A second key with the same shape is
      // the collision `lib/labelSections.test.ts` fails on, and it would also
      // put two indistinguishable rows in front of the owner in Settings ›
      // Terminology. One sentence, one row, whichever gesture reached it.
      const said = t('mindtree.nodeName', {
        label: ctxRef.current.labelOf(pos.node),
        detail: plan === null ? t('mindtree.dropRefusedUnknown') : detailOf(plan),
      })
      announce(lead === undefined ? said : `${lead} ${said}`)
    },
    [announce, paintTarget, revealZone],
  )

  const handleKeyDown = useCallback(
    (ev: ReactKeyboardEvent<Element>): boolean => {
      if (ev.defaultPrevented || ev.altKey || ev.ctrlKey || ev.metaKey) return false
      const { rtl: isRtl, entryById, meId, role, focusedId, layout: drawn, disabled } = ctxRef.current
      if (disabled === true) return false

      const held = keyRef.current
      const list = candidatesRef.current

      /* the lift */
      if (held === null) {
        if (ev.key !== ' ' && ev.key !== 'Spacebar') return false
        if (list.length === 0) return false
        if (focusedId === null) return false
        const pos = drawn.byId.get(focusedId)
        const entryId = pos?.node.entryId ?? null
        if (pos === undefined || pos.node.kind !== 'entry' || entryId === null) return false
        const entry = entryById.get(entryId)
        // Not draggable, so Space stays the map's own "activate this node". The
        // refusal is not announced here: an item somebody else owns is not a
        // failed drag, it is a control that was never offered.
        if (entry === undefined || !canEditEntry(entry, meId, role)) return false

        ev.preventDefault()
        const carry = carriedFor(entryId)
        const { ids, rects } = carry
        carriedRef.current = carry
        keyRef.current = { entryIds: ids, title: entry.title, nodeId: null }
        beginMindDrag({
          entryIds: ids,
          fromNodeId: pos.parentId ?? '',
          overNodeId: null,
          refusalKey: null,
        })
        setLift({ via: 'key', entryIds: ids, title: entry.title, rects, at: { x: 0, y: 0 } })
        const lead =
          ids.length > 1
            ? t('mindtree.dragGrabbedMany', { count: ids.length })
            : t('mindtree.dragGrabbed', { title: entry.title })
        // Start on the branch the item is already under when that branch is a
        // candidate — the reader's own place in the map, not the top of it. The
        // lift and the first candidate are ONE sentence; see `armCandidate`.
        const from = pos.parentId === null ? -1 : list.findIndex((c) => c.id === pos.parentId)
        armCandidate(from >= 0 ? from : 0, lead)
        return true
      }

      /* the move */
      // RESOLVED FROM THE ID, every time — see `keyRef`. -1 means the branch the
      // reader armed has left the tree since they armed it.
      const at = armedIndex()
      const forward = isRtl ? 'ArrowLeft' : 'ArrowRight'
      const backward = isRtl ? 'ArrowRight' : 'ArrowLeft'

      if (ev.key === 'Escape') {
        ev.preventDefault()
        ev.stopPropagation()
        carriedRef.current = NO_CARRY
        endKeyDrag()
        announce(t('mindtree.dragCancelled'))
        return true
      }
      if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
        ev.preventDefault()
        // The ID, not the slot. `at` is -1 exactly when the armed branch has
        // left the tree — a realtime close emptied it, or a filter narrowed past
        // it — and the honest answer there is to refuse rather than to write to
        // whatever now occupies the position it used to hold.
        const target = at < 0 ? undefined : list[at]
        const ids = held.entryIds
        carriedRef.current = NO_CARRY
        endKeyDrag()
        if (target === undefined) {
          announce(t('mindtree.dropRefusedTarget'))
          return true
        }
        void commitDrop(target.id, 'key', ids)
        return true
      }
      if (ev.key === 'Tab') {
        // Focus is leaving the map. A lift that outlived the element it started
        // on would be a gesture with no way to finish it, so it ends here — said
        // out loud, because the reader did not ask for it.
        carriedRef.current = NO_CARRY
        endKeyDrag()
        announce(t('mindtree.dragCancelled'))
        return false
      }
      if (ev.key === 'ArrowDown') {
        ev.preventDefault()
        armCandidate(Math.min(list.length - 1, at + 1))
        return true
      }
      if (ev.key === 'ArrowUp') {
        ev.preventDefault()
        armCandidate(Math.max(0, at - 1))
        return true
      }
      if (ev.key === 'Home') {
        ev.preventDefault()
        armCandidate(0)
        return true
      }
      if (ev.key === 'End') {
        ev.preventDefault()
        armCandidate(list.length - 1)
        return true
      }
      if (ev.key === forward) {
        ev.preventDefault()
        // Into the ring below: the first candidate whose parent is this one.
        const current = list[at]
        if (current !== undefined) {
          const into = list.findIndex((c) => c.parentId === current.id)
          if (into >= 0) armCandidate(into)
        }
        return true
      }
      if (ev.key === backward) {
        ev.preventDefault()
        const current = list[at]
        if (current !== undefined && current.parentId !== null) {
          const out = list.findIndex((c) => c.id === current.parentId)
          if (out >= 0) armCandidate(out)
        }
        return true
      }
      return false
    },
    [announce, armCandidate, armedIndex, carriedFor, commitDrop, endKeyDrag],
  )

  /* ── the press ──────────────────────────────────────────────────────── */

  const onNodePointerDown = useCallback(
    (pos: PositionedNode<MindNode>, ev: ReactPointerEvent<Element>) => {
      const { entryById, meId, role, disabled } = ctxRef.current
      if (disabled === true) return
      // Right and middle buttons are a context menu and a paste, not a drag.
      if (ev.pointerType === 'mouse' && ev.button !== 0) return
      // v1: leaves move, branches do not — dropRules refuses the rest by name.
      const entryId = pos.node.entryId
      if (pos.node.kind !== 'entry' || entryId === null) return

      /**
       * NOWHERE TO DROP — the phone's one-ring drill-in draws entries with no
       * branch beside them (the drawn root is excluded from `zones`, and it is
       * the only branch on that ring). A drag with no possible outcome is worse
       * than none: it steals the pan that IS how that screen is read, and every
       * release lands on "it is already there".
       *
       * So the hold is spent on the verbs instead. A mouse already has
       * right-click and needs no hold, so it simply gets nothing here.
       */
      const menuOnly = zonesRef.current.length === 0
      const held = ev.pointerType !== 'mouse'
      if (menuOnly && (!held || ctxRef.current.onNodeMenu === undefined)) return

      const entry = entryById.get(entryId)
      if (entry === undefined || !canEditEntry(entry, meId, role)) return

      // A keyboard lift and a pointer lift are one gesture with two inputs; the
      // second one to start wins.
      if (keyRef.current !== null) {
        carriedRef.current = NO_CARRY
        endKeyDrag()
      }

      const stale = sessionRef.current
      if (stale !== null) {
        // A gesture whose pointerup never arrived must not wedge the map for the
        // rest of the session. A fresh press from the SAME pointer is proof the
        // old one is over; a different id is a second finger, which is a pinch.
        if (stale.gesture.pointerId !== ev.pointerId) return
        endRef.current(false)
      }

      const space = readSpace(ctxRef.current.svgRef.current)
      if (space === null) return
      const client = { x: ev.clientX, y: ev.clientY }
      lastClientRef.current = client

      // Everything that is not a mouse pans the map, so the item has to be
      // EARNED with a hold — `held` above. lib/dnd.ts's header has the full
      // argument; HOLD_MS is its number, imported rather than copied.
      carriedRef.current = carriedFor(entryId)
      sessionRef.current = startMindDrag({
        pointerId: ev.pointerId,
        entryId,
        nodeId: pos.id,
        fromNodeId: pos.parentId,
        client,
        at: clientToLayout(client, space.canvas, space.view),
        requireHold: held,
      })

      // A MOUSE PRESS ON A DRAGGABLE ITEM IS NOT A PAN, and stopping it here is
      // the only way to say so: the page's pan listener is on the <svg>, an
      // ancestor, and it arms at 4px while this gesture commits at 6. Two pixels
      // of map slide at the start of every drag is a picture that flinches. A
      // FINGER is left alone deliberately — it may still pan from a node until
      // the hold lands, and `onPanCancel` hands the gesture over at that moment.
      if (!held) ev.stopPropagation()

      listeningRef.current = true
      // On WINDOW, not on the node: an optimistic patch can re-parent the node
      // mid-gesture, and a listener bound to the old element would stop hearing a
      // finger that is still moving.
      window.addEventListener('pointermove', onWindowMove, { passive: false })
      window.addEventListener('pointerup', onWindowUp)
      window.addEventListener('pointercancel', onWindowCancel)
      // CAPTURE PHASE: the map's own Escape (clear the drill-in) is bound to the
      // <svg> and would otherwise run first on a bubbling listener.
      window.addEventListener('keydown', onWindowKey, true)

      if (!held) return

      window.addEventListener('selectstart', onWindowSuppress)
      window.addEventListener('contextmenu', onWindowSuppress)
      holdTimerRef.current = window.setTimeout(() => {
        holdTimerRef.current = null
        const session = sessionRef.current
        if (session === null) return

        if (menuOnly) {
          // The hold landed and there is nothing to lift, so it opens the verbs.
          // `draggedAtRef` FIRST: the pointerup that follows synthesises a click
          // on this node, and without the stamp the map would open the entry
          // behind the menu one frame later. `endGesture` sets the same stamp,
          // but only for a gesture that reached `dragging` — this one never does.
          draggedAtRef.current = Date.now()
          // The page's pan was armed for the length of the hold; the menu owns
          // the finger now, exactly as a lift would.
          ctxRef.current.onPanCancel()
          if (typeof navigator.vibrate === 'function') navigator.vibrate(8)
          const at = lastClientRef.current
          endRef.current(false)
          ctxRef.current.onNodeMenu?.(pos, { x: at.x, y: at.y })
          return
        }

        const space2 = readSpace(ctxRef.current.svgRef.current)
        const next = holdMindDrag(
          session,
          zonesRef.current,
          space2 === null ? 0 : layoutSlop(space2.scale),
        )
        // Same reference: the finger panned away, or this is not the gesture the
        // timer was set for. Either way there is nothing to lift.
        if (next === session) return
        sessionRef.current = next
        // Feedback for a hand that is looking at the map, not at the screen.
        // Guarded because iOS has no Vibration API at all and Firefox gates it
        // behind a setting — the lift must not depend on a buzz nobody gets.
        if (typeof navigator.vibrate === 'function') navigator.vibrate(8)
        beginLift(next)
      }, HOLD_MS)
    },
    [
      beginLift,
      carriedFor,
      endKeyDrag,
      onWindowCancel,
      onWindowKey,
      onWindowMove,
      onWindowSuppress,
      onWindowUp,
    ],
  )

  const isPressing = useCallback(() => sessionRef.current !== null, [])

  const isLifted = useCallback(
    () => keyRef.current !== null || isMindDragging(sessionRef.current),
    [],
  )

  const justDragged = useCallback(() => {
    if (Date.now() - draggedAtRef.current > CLICK_SUPPRESS_MS) return false
    draggedAtRef.current = 0
    return true
  }, [])

  /** Leaving the route mid-drag must not leave four window listeners, a timer
   *  and an animation frame behind — nor a drag state nothing can clear. */
  useEffect(
    () => () => {
      endRef.current(false)
      keyRef.current = null
      endMindDrag()
    },
    [],
  )

  /**
   * MEMOISED, so the object's IDENTITY only changes when something it carries
   * does.
   *
   * `MindDropTargets` is `memo()`d and lives inside the map's <svg>, which
   * re-renders on every frame of a pan — the page holds the viewBox in state.
   * A controller rebuilt on each of those renders would defeat that memo and
   * re-render one <rect> per branch, sixty times a second, to draw the same
   * outlines. Every field below is either state or a stable callback, so this
   * changes exactly twice per drag.
   */
  return useMemo(
    () => ({
      active: lift !== null,
      hintId,
      zones,
      lift,
      ghostRef,
      announcement,
      rtl,
      onNodePointerDown,
      handleKeyDown,
      isPressing,
      isLifted,
      justDragged,
    }),
    [
      announcement,
      handleKeyDown,
      hintId,
      isLifted,
      isPressing,
      justDragged,
      lift,
      onNodePointerDown,
      rtl,
      zones,
    ],
  )
}

/**
 * Where an armed keyboard target sits in the candidate list AS IT IS NOW, or -1
 * when it is no longer in it.
 *
 * A THREE-LINE FUNCTION WITH A REASON TO BE EXPORTED. The rule it encodes —
 * resolve the armed branch from its NODE ID, never from a remembered slot — is
 * the whole of a defect that could not be seen from outside: `candidates` is
 * rebuilt from the layout on every tree rebuild, and the tree is rebuilt on
 * every realtime batch, so a stored index silently re-aims at whatever moved
 * into that position. A colleague filing one item into a previously-empty bucket
 * INSERTS a candidate (`model.vocabGroups` emits populated groups only) and
 * shifts everything after it by one. The suite in this component's test file is
 * a single server render and cannot re-render a hook, so the rule is pinned here
 * against real `buildMindtree` + `layoutMindtree` output instead.
 */
export function armedIndexIn(
  list: readonly { readonly id: string }[],
  nodeId: string | null,
): number {
  if (nodeId === null) return -1
  return list.findIndex((c) => c.id === nodeId)
}

/** A positioned node as a bare rectangle. */
function rectOf(pos: PositionedNode<MindNode>): MindDropZone {
  return { nodeId: pos.id, x: pos.x, y: pos.y, width: pos.width, height: pos.height }
}

/** The clause a candidate announcement ends with — what dropping here would do. */
function detailOf(plan: DropPlan): string {
  if (plan.blockedKey !== null) return t(plan.blockedKey)
  return plan.ids.length > 1
    ? t('mindtree.dragTargetMany', { count: plan.ids.length })
    : t('mindtree.dragTargetOne')
}

/* ─────────────────────────── the drawing's overlay ───────────────────────── */

/**
 * The drop targets, drawn INSIDE the <svg> — mount it after the nodes.
 *
 * ABOVE THE NODES, and stroke-only for that reason: a highlight painted under a
 * node is hidden by that node's own fill, and one painted over it as a wash would
 * take contrast away from the label at the exact moment the reader is reading it
 * to decide whether to let go. So the target is framed rather than filled, which
 * costs nothing measured — mindtree.css makes the same argument for cueing depth
 * with stroke width instead of opacity.
 *
 * `pointer-events: none` throughout: the hit test is arithmetic over the layout
 * (drag.ts), never the DOM, so an overlay that could be hit would only ever
 * intercept the gesture it exists to describe.
 */
export const MindDropTargets = memo(function MindDropTargets({
  controller,
}: {
  controller: MindDragController
}): ReactElement | null {
  const drag = useMindDrag()
  const lift = controller.lift
  if (lift === null || drag === null) return null

  const state =
    drag.refusalKey === null ? 'ok' : drag.refusalKey === DROP_UNCHANGED_KEY ? 'same' : 'no'

  return (
    <g className="mtree-drag-overlay" aria-hidden="true">
      {controller.zones.map((zone) => (
        <rect
          key={zone.nodeId}
          className="mtree-drag-zone"
          x={zone.x + ZONE_INSET}
          y={zone.y + ZONE_INSET}
          width={Math.max(0, zone.width - ZONE_INSET * 2)}
          height={Math.max(0, zone.height - ZONE_INSET * 2)}
          rx={NODE_RX}
          ry={NODE_RX}
          data-over={zone.nodeId === drag.overNodeId ? '' : undefined}
          data-state={zone.nodeId === drag.overNodeId ? state : undefined}
        />
      ))}
      {lift.rects.map((rect) => (
        <rect
          key={`lift-${rect.nodeId}`}
          className="mtree-drag-lifted"
          x={rect.x}
          y={rect.y}
          width={rect.width}
          height={rect.height}
          rx={NODE_RX}
          ry={NODE_RX}
        />
      ))}
    </g>
  )
})

/* ────────────────────────────── the HTML layer ───────────────────────────── */

/**
 * The ghost, the reason, the keyboard bar and the live region — mount it OUTSIDE
 * the <svg>, as a sibling of the canvas.
 *
 * IT CARRIES ITS OWN LIVE REGION rather than borrowing the page's. The page's
 * region is the map's own commentary — "Zoom 140%", "Grouped by owner" — and a
 * drag is a stream of short sentences that must arrive in order and stop when the
 * gesture does. Both are `polite`, so they queue rather than interrupt; two
 * ASSERTIVE regions would be the mistake pages/Mindtree.tsx warns about.
 */
export function MindDragLayer({ controller }: { controller: MindDragController }): ReactElement {
  // t() reads lib/i18n's MODULE state, which React cannot watch: without this a
  // language switch would leave the hint and the chip in the old language until
  // something else re-rendered them.
  useLocale()
  const drag = useMindDrag()
  const { lift, announcement, rtl } = controller

  const blockedKey = drag?.refusalKey ?? null
  const state = blockedKey === null ? 'ok' : blockedKey === DROP_UNCHANGED_KEY ? 'same' : 'no'
  const count = lift?.entryIds.length ?? 0

  return (
    <div className="mtree-drag-layer">
      {lift !== null && lift.via === 'pointer' && (
        <div
          className="mtree-drag-ghost"
          ref={controller.ghostRef}
          // The FIRST paint's position. Every later one is written straight to
          // this element's style by the move handler — see the file header.
          style={{ transform: `translate3d(${lift.at.x}px, ${lift.at.y}px, 0)` }}
          aria-hidden="true"
        >
          {/* The anchor above is a zero-sized point AT the pointer; this box is
              what hangs off it, offset by percentages of its own size so the
              card is centred on the finger and clear of it. */}
          <div className="mtree-drag-hold" dir={rtl ? 'rtl' : 'ltr'}>
            <div className="mtree-drag-card" data-state={state}>
              <span className="mtree-drag-title">
                <bdi>{lift.title}</bdi>
              </span>
              {count > 1 && <span className="mtree-drag-count tabular">{count}</span>}
            </div>
            {blockedKey !== null && (
              <p className="mtree-drag-why" data-state={state}>
                {t(blockedKey)}
              </p>
            )}
          </div>
        </div>
      )}

      {lift !== null && lift.via === 'key' && (
        <div className="mtree-drag-bar" dir={rtl ? 'rtl' : 'ltr'} data-state={state} aria-hidden="true">
          <span className="mtree-drag-title">
            <bdi>{lift.title}</bdi>
          </span>
          {count > 1 && <span className="mtree-drag-count tabular">{count}</span>}
          <span className="mtree-drag-why" data-state={state}>
            {blockedKey === null ? t('mindtree.dragTargetOne') : t(blockedKey)}
          </span>
        </div>
      )}

      {/* The gesture's instructions. Pointed at by the map through
          `aria-describedby` when the page wires `controller.hintId`, and still
          rendered — and therefore still reachable — when it does not. */}
      <p className="sr-only" id={controller.hintId}>
        {t('mindtree.dragKeyboardHint')}
      </p>

      {/* polite, and keyed on a sequence so an identical consecutive sentence
          still speaks — two branches refusing for the same reason produce the
          same string twice. */}
      <p className="sr-only" role="status" aria-live="polite">
        <span key={announcement.seq}>{announcement.text}</span>
      </p>
    </div>
  )
}

export default MindDragLayer
