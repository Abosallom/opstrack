// THE BOARD, AS A STAGE OF THE MAP — every item the filter admits, in a column
// per whatever the reader is grouping by.
//
// A RE-HOST, NOT A REWRITE. This is `pages/Board.tsx` mounted where the canvas
// used to draw, under the `by-status` lens. The gesture, the four move paths,
// the overflow rail, the fold, the composer and the announcements are the same
// ones that shipped; the pure half now lives in `lib/board/columns.ts` where it
// can be tested without a render, and the parts that were page furniture — the
// route, the URL codec, its own FilterBar — belong to the shell now.
//
// WHY THE BOARD IS A STAGE AND NOT AN OVERLAY. Its Done and Cancelled columns
// are a question about CLOSED work, and closed work has no node: `useMapModel`
// pins `scope: 'open'` and `buildMindtree` emits nothing for a closed entry. So
// the board REPLACES the canvas, and it reads the closed window ITSELF —
// `loadClosedSince(today − CLOSED_WINDOW_DAYS)` on mount, under every axis,
// exactly as the page did. The scope pin is NOT moved to make that happen: it
// lives outside filter state so Clear-all cannot change what the map is about
// (contract risk 9), and a board that reached for it would take "what did the
// team finish this fortnight" away from every other surface the day somebody
// pressed Clear.
//
// THE STATUS FACET AND THE STATUS COLUMNS. The page dropped the facet from its
// own FilterBar whenever status was the axis, because a status filter fighting
// status columns leaves Done and Cancelled permanently, inexplicably empty. The
// shell owns the FilterBar now and this component cannot remove a facet from
// it, so the rule survives where it can: the filter's statuses are dropped from
// what the board APPLIES under the status axis, and a note says so in place,
// beside the axis switch that resolves it. Silently applying it would empty
// half the columns; silently ignoring it with the chip still lit would be a
// control that lies. The note is the third option, and it is one line.
//
// FOUR INDEPENDENT MOVE PATHS, ALL FIRST-CLASS. Mouse drag past a 6px
// threshold; touch drag after a 420ms hold; the arrow keys with a card focused
// (one column per press, clamped); the digits 1–9 (straight to column N). Plus
// the card's own status <select>, which is ALWAYS a status menu whatever the
// axis is — making it mean "owner" because the columns happen to be owners
// would be a control that lies.
//
// THE DIGIT NEGOTIATION, RESOLVED. Two other layers could want 1–9. (1) The
// map's own grammar (`useMapKeyboard`) is a React `onKeyDown` on the `<svg>`,
// and React events bubble through the SVG subtree only — under this lens the
// canvas is not mounted at all, and it claims no digits in any case. (2) The
// global layer (`lib/hotkeys.ts`) binds 1–4 to the OPEN ENTRY's status, on the
// document's bubble phase, and bails on `defaultPrevented`; this board calls
// `preventDefault()` on every digit and arrow it acts on, so it wins the same
// way it did as a page. No edit to either file was needed, and none was made.
//
// ESCAPE, IN THE ORDER MapPanel's HEADER DECLARES IT. A lifted card is claim
// (1) — the innermost thing on the screen and the only one the reader is
// physically holding. The page bound its Escape on `window`, which bubbles
// LAST, so an open overlay's document listener would have dismissed itself
// first and the drag would have been cancelled as well: two things for one key.
// The listener is on `document` in the CAPTURE phase now, registered only for
// the length of a gesture, and it stops the event only while a card is actually
// in the air. An armed press that never became a drag has claimed nothing and
// lets Escape through.
//
// ONE LIVE REGION, AND IT IS THE SHELL'S. The page carried its own polite
// region keyed on a counter so that two identical consecutive sentences both
// announce. The shell's region (MapSummary) is keyed the same way and is
// rendered under every stage, so this component announces THROUGH it via the
// `announce` prop — the guarantee is kept and there are not two polite regions
// on one screen talking over each other.
//
// OPTIMISM AND THE TRANSITION ROW BOTH COME FROM BELOW.
// `setStatus()`/`patchEntry()` apply locally and roll the row back themselves
// if the write fails, so this file holds no shadow copy of the board; and
// `api/entries.updateEntry()` appends the `status_from`/`status_to` thread row
// itself, so writing one here would produce two rows for one move.

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import { EmptyState, Skeleton } from '../shared'
import { EntryCard, OwnerBadge, TrackDot } from '../entry'
import { IconChevronDown, IconPlus } from '../fields'
import { IconColumns } from '../icons'
import { toast } from '../toast'
import {
  BOARD_DENSITIES,
  BOARD_DIMENSIONS,
  BOARD_PREFS_KEY,
  CLOSED_WINDOW_DAYS,
  COLUMN_EMPTY,
  DEFAULT_BOARD_PREFS,
  MAX_CARDS,
  NAME_PREFIX,
  NO_VALUE,
  OVERFLOW_TITLE,
  bucketOf,
  collapsedFor,
  enterDiff,
  parseBoardPrefs,
  patchFor,
  seedFor,
  splitColumns,
  toggleCollapsed,
  type BoardColumn,
  type BoardColumnDef,
  type BoardDensity,
  type BoardDim,
  type BoardPrefs,
  type CardEnter,
} from '../../lib/board/columns'
import {
  HOLD_MS,
  arrowStep,
  dropOf,
  edgeScroll,
  edgeScrollBlock,
  holdDrag,
  indexFromDigit,
  isDragging,
  isHeld,
  isHoldGesture,
  moveDrag,
  moveIndex,
  startDrag,
  type DndSession,
  type DndZone,
} from '../../lib/dnd'
import { addDays, todayIso } from '../../lib/dates'
import { isFilterEmpty, type FilterState } from '../../lib/entryFilter'
import { t, useLocale } from '../../lib/i18n'
import { useTrackLabel } from '../../lib/labels'
import { canEditEntry } from '../../lib/permissions'
import { trackVars } from '../../lib/trackStyle'
import { vocabVars } from '../../lib/vocabStyle'
import { useAuth } from '../../store/auth'
import { useActiveTracks, useTrackMap } from '../../store/config'
import {
  createEntryOptimistic,
  loadClosedSince,
  loadEntries,
  patchEntry,
  refreshEntries,
  setStatus,
  useClosedEntriesError,
  useEntriesError,
  useEntriesLoading,
  useEntryFlash,
  useEntryMap,
  useFilteredEntries,
  useHealthMap,
  usePendingOp,
} from '../../store/entries'
import { openEntry } from '../../store/entrySheet'
import { useMemberLabel, useMemberMap, useMembers } from '../../store/members'
import { useVocabAll, useVocabLabel } from '../../store/vocab'
import type { Entry, EntryHealth, EntryStatus, NewEntry, UserRole } from '../../types'
import './map-board.css'

/**
 * store/entries.ts's private QUEUED_KEY, which is not a failure: the write is
 * sitting in the outbox and will land on reconnect. Duplicated as a literal
 * because the store does not export it — an extension-slot gap rather than a
 * reach across the module boundary.
 */
const QUEUED_ERROR_KEY = 'offline.queued'

/** How long after a drag a click is still that drag's mouseup, in ms. */
const CLICK_SUPPRESS_MS = 400

/** How long a card wears its arrival animation. Matches map-board.css's 180ms. */
const ENTER_MS = 240

const NO_ENTER: ReadonlyMap<string, CardEnter> = new Map()

export interface BoardStageProps {
  filter: FilterState
  compact: boolean
  rtl: boolean
  announce: (text: string) => void
}

function readPrefs(): BoardPrefs {
  try {
    return parseBoardPrefs(localStorage.getItem(BOARD_PREFS_KEY))
  } catch {
    // Private mode or a quota wall. A stage that throws on mount because a
    // preference could not be read is worse than a default board.
    return DEFAULT_BOARD_PREFS
  }
}

function writePrefs(prefs: BoardPrefs): void {
  try {
    localStorage.setItem(BOARD_PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Preferences are a convenience; losing them must never break a move.
  }
}

/** A keystroke inside a field belongs to the field. */
function isTypingTarget(el: HTMLElement | null): boolean {
  if (el === null) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

function boxOf(el: Element): DndZone['box'] {
  const r = el.getBoundingClientRect()
  return { x0: r.left, x1: r.right, y0: r.top, y1: r.bottom }
}

/**
 * Open the sheet with the column's own order as the sibling list.
 *
 * store/entrySheet.ts takes the list from the CALLER precisely for this: prev
 * and next have to walk the column the user is looking at, not the store's
 * canonical last_activity_at ordering.
 */
function openEntryFrom(columns: readonly BoardColumn[], id: string): void {
  const column = columns.find((c) => c.entries.some((e) => e.id === id))
  openEntry(id, { list: column ? column.entries.map((e) => e.id) : [] })
}

export default function BoardStage({
  filter,
  compact,
  rtl,
  announce,
}: BoardStageProps): ReactElement {
  useLocale()
  const { profile } = useAuth()
  // `null`, never a stand-in id: canEditEntry() tests the signed-out case FIRST
  // and answers false, which is what keeps a card un-draggable in the moment
  // between mount and the profile arriving. A placeholder would hand out an
  // affordance the server would then refuse.
  const meId = profile?.id ?? null
  const role: UserRole = profile?.role ?? 'member'
  // Every signed-in member may insert (0001's entries_insert), so quick-add is
  // gated on a session and nothing else. A column is a value, not a permission.
  const canCreate = meId !== null

  // ── the three persisted choices ──────────────────────────────────────────

  const [prefs, setPrefs] = useState<BoardPrefs>(readPrefs)
  const { dimension, density } = prefs
  useEffect(() => {
    writePrefs(prefs)
  }, [prefs])

  const setDimension = useCallback((next: BoardDim) => {
    setPrefs((p) => (p.dimension === next ? p : { ...p, dimension: next }))
  }, [])
  const setDensity = useCallback((next: BoardDensity) => {
    setPrefs((p) => (p.density === next ? p : { ...p, density: next }))
  }, [])
  const collapse = useCallback((dim: BoardDim, key: string) => {
    setPrefs((p) => toggleCollapsed(p, dim, key))
  }, [])
  const collapsedSet = useMemo(() => collapsedFor(prefs, dimension), [prefs, dimension])

  // ── the filter the shell hands down ──────────────────────────────────────
  //
  // `scope: 'all'` because Done and Cancelled are the point; the map's own pin
  // is 'open' and is not touched. The status facet is dropped only when status
  // is the AXIS — over owner columns "who is sitting on the blocked work" is
  // the useful question, and the facet stays live. See the file header for why
  // the drop is announced rather than silent.
  const statusFought = dimension === 'status' && filter.statuses.length > 0
  const effective = useMemo<FilterState>(
    () => ({
      ...filter,
      scope: 'all',
      statuses: dimension === 'status' ? [] : filter.statuses,
    }),
    [filter, dimension],
  )

  const entries = useFilteredEntries(effective)
  const entryMap = useEntryMap()
  const healthMap = useHealthMap()
  const loading = useEntriesLoading()
  const errorKey = useEntriesError()
  const closedErrorKey = useClosedEntriesError()
  const statusOptions = useVocabAll('status')
  const priorityOptions = useVocabAll('priority')
  const vocabLabel = useVocabLabel()
  const trackLabel = useTrackLabel()
  const trackMap = useTrackMap()
  const activeTracks = useActiveTracks()
  const members = useMembers()
  const memberMap = useMemberMap()
  const memberLabel = useMemberLabel()

  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(() => new Set())
  const [expandedOverflow, setExpandedOverflow] = useState<ReadonlySet<string>>(() => new Set())
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    void loadEntries()
    // Without this the Done and Cancelled columns are empty forever: the map's
    // working set is open rows only, and nothing else on this screen asks.
    void loadClosedSince(addDays(todayIso(), -CLOSED_WINDOW_DAYS))
  }, [])

  // ── columns ──────────────────────────────────────────────────────────────

  const { live, overflow, membership } = useMemo(() => {
    const residualLabel = (key: string): string => {
      if (dimension === 'track') {
        const track = trackMap.get(key)
        return track ? trackLabel(track) : t('board.unknownColumn')
      }
      if (dimension === 'owner') {
        if (key.startsWith(NAME_PREFIX)) return key.slice(NAME_PREFIX.length)
        return memberMap.has(key) ? memberLabel(key, null) : t('board.unknownColumn')
      }
      return vocabLabel(dimension, key)
    }

    const residual = (key: string): { label: string; vars: CSSProperties } => {
      const track = dimension === 'track' ? trackMap.get(key) : undefined
      return {
        label: residualLabel(key),
        vars: track ? trackVars(track.color, track.color_light) : {},
      }
    }

    const defs: BoardColumnDef[] = []
    if (dimension === 'status' || dimension === 'priority') {
      // The cast is the boundary between a string-keyed store and the frozen
      // unions, and it is sound in one direction only: every key here came from
      // useVocabAll(), which walks FROZEN_KEYS — the same list EntryStatus and
      // EntryPriority are declared from. FilterBar makes the identical cast.
      for (const option of dimension === 'status' ? statusOptions : priorityOptions) {
        defs.push({
          key: option.key,
          label: option.label,
          vars: vocabVars(option.color),
          retired: option.hidden,
        })
      }
    } else if (dimension === 'track') {
      // The residual bucket LEADS on both assignment axes: untracked and
      // unassigned work is the queue, and a queue belongs at the front of the
      // reading order, not past six columns of work that already has a home.
      defs.push({ key: NO_VALUE, label: t('entry.noTrack'), vars: {}, retired: false })
      for (const track of activeTracks) {
        defs.push({
          key: track.id,
          label: trackLabel(track),
          vars: trackVars(track.color, track.color_light),
          retired: false,
        })
      }
    } else {
      defs.push({ key: NO_VALUE, label: memberLabel(null, null), vars: {}, retired: false })
      for (const member of members) {
        defs.push({ key: member.id, label: memberLabel(member.id, null), vars: {}, retired: false })
      }
    }

    return splitColumns({
      entries,
      dim: dimension,
      defs,
      isBreached: (id) => healthMap.get(id)?.sla_breached === true,
      residual,
    })
  }, [
    entries,
    dimension,
    statusOptions,
    priorityOptions,
    activeTracks,
    members,
    trackMap,
    memberMap,
    healthMap,
    trackLabel,
    memberLabel,
    vocabLabel,
  ])

  // ── refs the gesture layer reads ─────────────────────────────────────────
  //
  // The window listeners below are registered once per gesture and must not be
  // re-created on every render, so everything they need arrives through a ref.
  // Assigning during render is the pattern useSwipeActions uses, for this
  // reason.

  const entryMapRef = useRef(entryMap)
  entryMapRef.current = entryMap
  const liveRef = useRef(live)
  liveRef.current = live
  const dimRef = useRef(dimension)
  dimRef.current = dimension
  const rtlRef = useRef(rtl)
  rtlRef.current = rtl

  const labelOf = useCallback(
    (key: string): string =>
      live.find((c) => c.key === key)?.label ?? overflow.find((c) => c.key === key)?.label ?? key,
    [live, overflow],
  )
  const labelRef = useRef(labelOf)
  labelRef.current = labelOf

  const canEdit = useCallback((entry: Entry) => canEditEntry(entry, meId, role), [meId, role])
  const canEditRef = useRef(canEdit)
  canEditRef.current = canEdit

  const announceRef = useRef(announce)
  announceRef.current = announce
  /** Stable for the length of the component, so no listener re-binds on it. */
  const say = useCallback((text: string) => {
    announceRef.current(text)
  }, [])

  const columnEls = useRef(new Map<string, HTMLElement>())
  const cardEls = useRef(new Map<string, HTMLElement>())
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const boardRef = useRef<HTMLDivElement | null>(null)
  const sessionRef = useRef<DndSession | null>(null)
  const listeningRef = useRef(false)
  const holdTimerRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)
  const draggedAtRef = useRef(0)
  const focusAfterMove = useRef<string | null>(null)
  const announceAfterMove = useRef<{ id: string; key: string } | null>(null)
  /** Ids this reader moved, so their arrival springs instead of sliding in. */
  const mineRef = useRef(new Set<string>())

  const [dragView, setDragView] = useState<{ itemId: string; overId: string | null } | null>(null)
  /**
   * The card a finger is currently resting on, while its hold clock runs.
   *
   * One id in state rather than a class written onto the node: the press is a
   * RENDERED state of one memoised card (map-board.css turns it into the
   * squeeze that makes the hold discoverable), and reaching into the DOM to
   * paint it would put the board's appearance in two places.
   */
  const [pressId, setPressId] = useState<string | null>(null)

  // ── the one write ────────────────────────────────────────────────────────

  const move = useCallback(
    async (id: string, toKey: string, via: 'drag' | 'key'): Promise<void> => {
      const entry = entryMapRef.current.get(id)
      if (!entry) return
      const dim = dimRef.current
      if (bucketOf(entry, dim) === toKey) return
      if (!canEditRef.current(entry)) {
        // Should be unreachable — a card the user cannot edit is not draggable
        // and its move menu is disabled — so this is the belt to that braces.
        toast(t('board.moveDisabled'), { tone: 'error' })
        say(t('board.moveDisabledHint'))
        return
      }
      const patch = patchFor(dim, toKey)
      // A free-text owner column is a source, never a target. The hit test
      // already refuses it (`accepts: false`) and no keyboard path indexes it,
      // so this is the third guard on the same rule.
      if (patch === null) return

      // Announced once the optimistic apply has landed and the card's real
      // position in its new column is knowable — see the effect below.
      if (via === 'key') announceAfterMove.current = { id, key: toKey }
      mineRef.current.add(id)

      // `setStatus` for the status axis is not ceremony: it is the documented
      // seam every other screen uses for a transition, and routing around it
      // would mean two call paths for one event the day it grows a side effect.
      const result =
        patch.status !== undefined ? await setStatus(id, patch.status) : await patchEntry(id, patch)

      // A queued write is outstanding, not failed: the outbox replays it, and
      // the transition row queues behind it in dependency order.
      if (!result.ok && result.error !== QUEUED_ERROR_KEY) {
        announceAfterMove.current = null
        mineRef.current.delete(id)
        // The store has already rolled the card back and toasted the REASON
        // (`entry.errNotYours` for an RLS refusal, and so on). This sentence is
        // the other half: what happened to the card.
        say(t('board.errMove'))
        return
      }

      if (via === 'key') {
        // A drag has its own motion for feedback; a keypress has none, so it
        // gets the toast.
        toast(t('board.moved', { title: entry.title, column: labelRef.current(toKey) }))
      }
    },
    [say],
  )
  const moveRef = useRef(move)
  moveRef.current = move

  /**
   * The positional announcement, made once the store's optimistic apply has
   * re-bucketed the card — the first moment at which "position 3 of 11" is a
   * fact rather than a guess.
   */
  useEffect(() => {
    const target = announceAfterMove.current
    if (target === null) return
    const column = live.find((c) => c.key === target.key)
    if (!column) return
    const at = column.entries.findIndex((e) => e.id === target.id)
    if (at < 0) return
    announceAfterMove.current = null
    say(
      t('board.moveAnnounce', {
        title: entryMap.get(target.id)?.title ?? '',
        column: column.label,
        position: at + 1,
        total: column.entries.length,
      }),
    )
  }, [live, entryMap, say])

  /** Focus follows a keyboard move: the card is re-mounted in its new column. */
  useEffect(() => {
    const id = focusAfterMove.current
    if (id === null) return
    const card = boardRef.current?.querySelector<HTMLElement>(`[data-entry-id="${CSS.escape(id)}"]`)
    if (!card) return
    focusAfterMove.current = null
    card.focus()
  }, [live])

  // ── arrival motion ───────────────────────────────────────────────────────

  const prevMembership = useRef<ReadonlyMap<string, string> | null>(null)
  const [enter, setEnter] = useState<ReadonlyMap<string, CardEnter>>(NO_ENTER)

  useEffect(() => {
    const prev = prevMembership.current
    prevMembership.current = membership
    // First paint is not an event. Nothing "arrived" on a board that was not
    // there a moment ago.
    if (prev === null) return

    const diff = enterDiff({
      prev,
      next: membership,
      order: new Map(live.map((c, i) => [c.key, i])),
      // Physical, and resolved from the direction the shell already knows —
      // CSS has no logical transform. The page read `document.dir`; the prop is
      // the same fact, handed down rather than re-derived.
      sign: rtl ? -1 : 1,
      mine: mineRef.current,
    })
    if (diff.enter.size === 0) return
    if (diff.burst) {
      // A filter change, an axis switch or a first load. Not an event.
      mineRef.current.clear()
      return
    }
    for (const id of diff.enter.keys()) mineRef.current.delete(id)
    setEnter(diff.enter)
    const timer = window.setTimeout(() => setEnter(NO_ENTER), ENTER_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [membership, live, rtl])

  // ── pointer drag ─────────────────────────────────────────────────────────

  const measureZones = useCallback((): DndZone[] => {
    const zones: DndZone[] = []
    for (const column of liveRef.current) {
      const el = columnEls.current.get(column.key)
      // Only live columns ever register an element, so an overflow strip cannot
      // become a drop target by accident. A COLLAPSED column still registers —
      // dropping onto a slim rail is how you file something out of sight.
      if (el) zones.push({ id: column.key, box: boxOf(el), accepts: true })
    }
    return zones
  }, [])

  const tick = useCallback(() => {
    rafRef.current = null
    const session = sessionRef.current
    const el = scrollerRef.current
    if (!session || session.phase !== 'dragging' || !el) return
    const dx = edgeScroll(session.x, boxOf(el))
    // `scrollLeft` is physical, and so is edgeScroll's answer — see its header.
    // In RTL the browser reports a negative range and this arithmetic still
    // holds, because both sides of it live in the same physical space.
    if (dx !== 0) el.scrollLeft += dx
    // …and the hovered column pans DOWN under the same finger, so a card can be
    // dropped past the fold of a long column without letting go first.
    const over = session.overId === null ? null : cardEls.current.get(session.overId)
    if (over && over.scrollHeight > over.clientHeight) {
      const dy = edgeScrollBlock(session.y, boxOf(over))
      if (dy !== 0) over.scrollTop += dy
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [])

  const endRef = useRef<(commit: boolean) => void>(() => {})

  /**
   * The card has just been lifted — by distance under a mouse, or by the hold
   * under a finger. Both paths arrive here so the announcement, the auto-scroll
   * loop and the lifted rendering cannot drift apart between them.
   */
  const beginDrag = useCallback(
    (session: DndSession) => {
      draggedAtRef.current = Date.now()
      const entry = entryMapRef.current.get(session.itemId)
      say(t('board.grabbed', { title: entry?.title ?? '' }))
      if (rafRef.current === null) rafRef.current = requestAnimationFrame(tick)
      setPressId(null)
      setDragView({ itemId: session.itemId, overId: session.overId })
    },
    [say, tick],
  )

  const onWindowMove = useCallback(
    (ev: PointerEvent) => {
      const session = sessionRef.current
      if (!session || ev.pointerId !== session.pointerId) return
      const next = moveDrag(session, ev.clientX, ev.clientY, measureZones())
      sessionRef.current = next
      if (next === session) return

      if (next.phase === 'abandoned') {
        // Either a mouse gesture that was never a drag, or — far more often — a
        // finger that panned before its hold landed. In the second case the
        // browser is ALREADY scrolling and this is simply the board letting go.
        endRef.current(false)
        return
      }
      if (next.phase !== 'dragging') return

      // Held card, still page. On a mouse this is what stops the native
      // text-drag and the rubber-band at the ends of the scroller; on a finger
      // the scroll is cancelled at `onWindowTouchMove` instead, because
      // pointermove cannot cancel a pan and touchmove can.
      if (ev.cancelable) ev.preventDefault()

      if (session.phase !== 'dragging') {
        beginDrag(next)
        return
      }

      setDragView((prev) =>
        prev && prev.itemId === next.itemId && prev.overId === next.overId
          ? prev
          : { itemId: next.itemId, overId: next.overId },
      )
    },
    [beginDrag, measureZones],
  )

  /**
   * THE ONE CALL THAT MAKES A TOUCH DRAG POSSIBLE. A touchmove is cancelable
   * only until the pan begins, and the pan cannot have begun yet — the finger
   * has been still for HOLD_MS. So the first move after the lift is both the
   * last chance to stop the browser panning out from under the card and a
   * guaranteed one. lib/dnd.ts's header has the full argument.
   */
  const onWindowTouchMove = useCallback((ev: TouchEvent) => {
    if (!isHeld(sessionRef.current)) return
    if (ev.cancelable) ev.preventDefault()
  }, [])

  /**
   * A long press otherwise means "select this text" and, on Android at ~500ms,
   * "open the context menu". Both are suppressed for the WHOLE touch gesture
   * rather than only once the hold lands: a caret that appears at 300ms and is
   * dismissed at 420ms is a flicker, and the user meant neither.
   */
  const onWindowSuppress = useCallback((ev: Event) => {
    if (!isHoldGesture(sessionRef.current)) return
    ev.preventDefault()
  }, [])

  const onWindowUp = useCallback((ev: PointerEvent) => {
    if (sessionRef.current?.pointerId !== ev.pointerId) return
    endRef.current(true)
  }, [])

  const onWindowCancel = useCallback(() => {
    endRef.current(false)
  }, [])

  /**
   * Escape, claim (1) of MapPanel's five.
   *
   * CAPTURE PHASE ON `document`, and only while a card is genuinely in the air:
   * a lifted card outranks the phone sheet, an open overlay and the drill-in,
   * and `lib/overlayStack`'s listener is on the document's BUBBLE phase, so a
   * `window` listener (which bubbles last of all) would have let an overlay
   * dismiss itself on the same keypress that cancelled the drag. An ARMED press
   * has claimed nothing and does not stop the event.
   */
  const onDocKey = useCallback((ev: KeyboardEvent) => {
    if (ev.key !== 'Escape') return
    if (!isDragging(sessionRef.current)) {
      endRef.current(false)
      return
    }
    ev.preventDefault()
    ev.stopPropagation()
    endRef.current(false)
  }, [])

  const endGesture = useCallback(
    (commit: boolean) => {
      if (!listeningRef.current) return
      listeningRef.current = false
      window.removeEventListener('pointermove', onWindowMove)
      window.removeEventListener('pointerup', onWindowUp)
      window.removeEventListener('pointercancel', onWindowCancel)
      document.removeEventListener('keydown', onDocKey, true)
      window.removeEventListener('touchmove', onWindowTouchMove)
      window.removeEventListener('selectstart', onWindowSuppress)
      window.removeEventListener('contextmenu', onWindowSuppress)
      if (holdTimerRef.current !== null) {
        // A press that ended — by release, by pan, or by the lens changing —
        // must not lift a card four hundred milliseconds after it is over.
        window.clearTimeout(holdTimerRef.current)
        holdTimerRef.current = null
      }
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }

      const session = sessionRef.current
      sessionRef.current = null
      setPressId(null)
      setDragView(null)
      if (!isDragging(session)) return
      // A real drag just ended, so the click that follows this mouseup is the
      // drag's, not a tap on the card title.
      draggedAtRef.current = Date.now()

      const drop = commit ? dropOf(session) : null
      if (drop === null) {
        say(t('board.dragCancelled'))
        return
      }
      // Announced at RELEASE rather than after the store settles: the motion is
      // the feedback for everyone who can see it, and this is the sentence for
      // everyone who cannot. A failure replaces it with errMove.
      say(t('board.dropped', { column: labelRef.current(drop.toId) }))
      void moveRef.current(drop.itemId, drop.toId, 'drag')
    },
    [
      say,
      onDocKey,
      onWindowCancel,
      onWindowMove,
      onWindowSuppress,
      onWindowTouchMove,
      onWindowUp,
    ],
  )
  endRef.current = endGesture

  useEffect(
    () => () => {
      // Leaving the stage mid-drag — a lens chip, a mode, a sign-out — must not
      // leave four listeners and an animation frame behind.
      endRef.current(false)
    },
    [],
  )

  const onDragStart = useCallback(
    (id: string, ev: ReactPointerEvent<HTMLElement>) => {
      // Right and middle buttons are a context menu and a paste, not a drag.
      if (ev.pointerType === 'mouse' && ev.button !== 0) return

      // THE CARD'S OWN CONTROLS KEEP THEIR OWN GESTURES. `dragHandleProps` is
      // spread on the card ROOT, so a press on the status <select> bubbles here
      // too — and a native select popup swallows the pointerup that would have
      // ended the gesture, leaving a session that becomes a phantom drag on the
      // next mouse move.
      const origin = ev.target instanceof Element ? ev.target : null
      if (origin?.closest('select, input, textarea, a[href]')) return

      const stale = sessionRef.current
      if (stale !== null) {
        // A gesture whose pointerup never arrived must not wedge the board for
        // the rest of the session. A fresh press from the SAME pointer is proof
        // the old one is over; a different pointer id is a second finger, which
        // is a pinch rather than a second drag, and is ignored.
        if (stale.pointerId !== ev.pointerId) return
        endRef.current(false)
      }

      const entry = entryMapRef.current.get(id)
      if (!entry || !canEditRef.current(entry)) return

      // Everything that is not a mouse pans the page and the board, so the card
      // has to be EARNED with a hold. See the file header and lib/dnd.ts's.
      const held = ev.pointerType !== 'mouse'

      sessionRef.current = startDrag({
        pointerId: ev.pointerId,
        itemId: id,
        fromId: bucketOf(entry, dimRef.current),
        x: ev.clientX,
        y: ev.clientY,
        requireHold: held,
      })
      listeningRef.current = true
      // On WINDOW, not on the card: an optimistic move re-parents the card into
      // another column mid-gesture, and a listener bound to the old node would
      // stop hearing the finger that is still moving.
      window.addEventListener('pointermove', onWindowMove, { passive: false })
      window.addEventListener('pointerup', onWindowUp)
      window.addEventListener('pointercancel', onWindowCancel)
      document.addEventListener('keydown', onDocKey, true)

      if (!held) return

      window.addEventListener('touchmove', onWindowTouchMove, { passive: false })
      window.addEventListener('selectstart', onWindowSuppress)
      window.addEventListener('contextmenu', onWindowSuppress)
      setPressId(id)
      holdTimerRef.current = window.setTimeout(() => {
        holdTimerRef.current = null
        const session = sessionRef.current
        if (session === null) return
        const next = holdDrag(session, measureZones())
        // Same reference: the finger panned away, or this is not the gesture
        // the timer was set for. Either way there is no card to lift.
        if (next === session) return
        sessionRef.current = next
        // Feedback for a hand that is looking at the card, not at the screen.
        // Guarded because iOS has no Vibration API at all and Firefox gates it
        // behind a setting — the card's own squeeze-then-lift is the feedback
        // that always lands.
        if (typeof navigator.vibrate === 'function') navigator.vibrate(8)
        beginDrag(next)
      }, HOLD_MS)
    },
    [
      beginDrag,
      measureZones,
      onDocKey,
      onWindowCancel,
      onWindowMove,
      onWindowSuppress,
      onWindowTouchMove,
      onWindowUp,
    ],
  )

  const onClickCapture = useCallback((ev: ReactMouseEvent<HTMLElement>) => {
    if (Date.now() - draggedAtRef.current > CLICK_SUPPRESS_MS) return
    draggedAtRef.current = 0
    // The mouseup that ends a drag also fires a click on whatever is under it,
    // which on a card is the title — so a successful drag would also open the
    // entry it just moved.
    ev.preventDefault()
    ev.stopPropagation()
  }, [])

  // ── keyboard moves ───────────────────────────────────────────────────────

  const onBoardKeyDown = useCallback((ev: ReactKeyboardEvent<HTMLElement>) => {
    if (ev.defaultPrevented || ev.altKey || ev.ctrlKey || ev.metaKey) return
    const target = ev.target as HTMLElement | null
    // The card's own move menu is a <select>, and the quick-add composer is an
    // <input>; their arrow keys and their digits belong to them.
    if (isTypingTarget(target)) return
    const host = target?.closest<HTMLElement>('[data-entry-id]') ?? null
    const id = host?.dataset.entryId
    if (id === undefined) return

    if (ev.key === 'Enter' && target === host) {
      // Only when the card WRAPPER itself holds focus — otherwise this would
      // fire alongside the title button's own activation.
      ev.preventDefault()
      openEntryFrom(liveRef.current, id)
      return
    }

    const entry = entryMapRef.current.get(id)
    if (!entry) return
    const columns = liveRef.current
    const at = columns.findIndex((c) => c.key === bucketOf(entry, dimRef.current))
    const step = arrowStep(ev.key, rtlRef.current ? 'rtl' : 'ltr')
    // A card parked in a retired bucket has no position on the live axis, so
    // the arrows have nothing to step from. A digit still names a column
    // outright, which is how you get such a card back onto the board.
    if (step !== 0 && at < 0) return

    const index =
      step !== 0 ? moveIndex(at, step, columns.length) : indexFromDigit(ev.key, columns.length)
    if (index === null || index === at) return
    const to = columns[index]
    if (!to) return

    // The global layer bails on `defaultPrevented` (lib/hotkeys.ts, rule 1), so
    // this call is also what keeps 1–9 here from setting a status there.
    ev.preventDefault()
    focusAfterMove.current = id
    void moveRef.current(id, to.key, 'key')
  }, [])

  const handleOpen = useCallback((id: string) => {
    openEntryFrom(liveRef.current, id)
  }, [])

  /**
   * The card's own StatusPill. ALWAYS a status change, whatever the column axis
   * is — see the file header. Under the status axis it is the accessible move
   * path; under the others it edits a field without leaving the column.
   */
  const handleMenuMove = useCallback((id: string, status: EntryStatus) => {
    focusAfterMove.current = id
    void moveRef.current(id, status, 'key')
  }, [])

  const handleRefresh = useCallback(() => {
    // FollowUps' refresh, not the page's bare `refreshEntries()`: a control
    // that does nothing visible while it works is a control people press twice.
    setRefreshing(true)
    void refreshEntries().then(() => {
      setRefreshing(false)
      toast(t('board.refreshed'))
    })
  }, [])

  // ── quick add ────────────────────────────────────────────────────────────

  const [composeIn, setComposeIn] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)
  const composerRef = useRef<HTMLInputElement | null>(null)

  /** The single track the filter is pinned to, if it is pinned to exactly one. */
  const filterTrackRef = useRef<string | null>(null)
  filterTrackRef.current = filter.trackIds.length === 1 ? filter.trackIds[0] : null

  /**
   * The `+` button of each column, so closing a composer can hand focus back.
   * Esc and Cancel unmount the <form> the focused <input> lives in, and without
   * this focus falls to <body> and the next Tab restarts at the top of the
   * document — WCAG 2.4.3.
   */
  const addEls = useRef(new Map<string, HTMLButtonElement>())

  const registerAdd = useCallback((key: string, el: HTMLButtonElement | null) => {
    if (el) addEls.current.set(key, el)
    else addEls.current.delete(key)
  }, [])

  const openComposer = useCallback((key: string) => {
    setComposeIn((prev) => (prev === key ? null : key))
    setDraft('')
  }, [])

  /**
   * Close it and give the keyboard somewhere to be. The focus call comes BEFORE
   * the state change on purpose: React batches the re-render to the end of the
   * handler, so the `+` button is still the live node and the input unmounts
   * from an element that is no longer focused. No flicker, no effect.
   */
  const closeComposer = useCallback((key: string) => {
    addEls.current.get(key)?.focus()
    setComposeIn(null)
  }, [])

  useEffect(() => {
    if (composeIn !== null) composerRef.current?.focus()
  }, [composeIn])

  const submitAdd = useCallback(
    async (column: BoardColumn): Promise<void> => {
      const title = draft.trim()
      if (title === '' || adding) return
      setAdding(true)
      const input: NewEntry = {
        title,
        ...seedFor(dimRef.current, column.key),
        // A board filtered to one track is a board ABOUT that track, so a card
        // added to it belongs to it — unless track is the axis, in which case
        // the column already said so and wins.
        ...(dimRef.current !== 'track' && filterTrackRef.current !== null
          ? { trackId: filterTrackRef.current }
          : {}),
      }
      const result = await createEntryOptimistic(input)
      setAdding(false)
      // The store toasts its own failure and removes the optimistic row; a
      // queued write is a success that has not left the building yet.
      if (!result.ok && result.error !== QUEUED_ERROR_KEY) return
      // Cleared, not closed: "Enter adds it and keeps focus for the next one"
      // is the whole point of a composer in the column. The explicit refocus is
      // for the CLICK path — the submit button disables itself as the draft
      // empties, and a disabled control drops focus to the body.
      setDraft('')
      composerRef.current?.focus()
      say(t('board.quickAddDone', { title, column: column.label }))
    },
    [adding, draft, say],
  )

  // ── render ───────────────────────────────────────────────────────────────

  const registerColumn = useCallback((key: string, el: HTMLElement | null) => {
    if (el) columnEls.current.set(key, el)
    else columnEls.current.delete(key)
  }, [])

  const registerCards = useCallback((key: string, el: HTMLElement | null) => {
    if (el) cardEls.current.set(key, el)
    else cardEls.current.delete(key)
  }, [])

  const maxCards = MAX_CARDS[density]
  const draggedTitle = dragView === null ? '' : (entryMap.get(dragView.itemId)?.title ?? '')

  const renderCards = (column: BoardColumn, slot: ReactNode): ReactElement => {
    const total = column.entries.length
    const open = unfolded.has(column.key)
    const shown = open ? column.entries : column.entries.slice(0, maxCards)
    const hidden = total - shown.length

    return (
      <>
        <ul
          className="mbd-cards"
          ref={(el) => {
            registerCards(column.key, el)
          }}
        >
          {slot}
          {shown.map((entry) => (
            <BoardCard
              key={entry.id}
              entry={entry}
              health={healthMap.get(entry.id)}
              canEdit={canEdit(entry)}
              dragging={dragView?.itemId === entry.id}
              pressed={pressId === entry.id}
              enter={enter.get(entry.id)}
              onOpen={handleOpen}
              onMove={handleMenuMove}
              onDragStart={onDragStart}
            />
          ))}
        </ul>
        {total > maxCards ? (
          <button
            type="button"
            className="btn btn-sm btn-ghost mbd-fold"
            onClick={() =>
              setUnfolded((prev) => {
                const next = new Set(prev)
                if (!next.delete(column.key)) next.add(column.key)
                return next
              })
            }
          >
            {open ? t('board.showLess') : t('board.showAll')}
            {hidden > 0 ? (
              <span className="pill tabular">{t('board.cardsHidden', { count: hidden })}</span>
            ) : null}
          </button>
        ) : null}
      </>
    )
  }

  /** The count pill and the SLA badge — the two facts a column header carries. */
  const renderCounts = (column: BoardColumn): ReactElement => (
    <>
      {/* The digit is for the eye; the label is for everyone else. A bare "2"
          beside a heading announces as "2" and means nothing — `role="img"` +
          aria-label is the same trick the entry kit's own pills use. */}
      <span
        className="pill mbd-col-count tabular"
        role="img"
        aria-label={t('board.columnCountLabel', { count: column.entries.length })}
      >
        {t('board.columnCount', { count: column.entries.length })}
      </span>
      {column.breached > 0 ? (
        <span
          className="pill mbd-sla tabular"
          role="img"
          aria-label={t('board.slaBadgeLabel', { count: column.breached })}
        >
          {t('board.slaBadge', { count: column.breached })}
        </span>
      ) : null}
    </>
  )

  /** The track glyph or owner disc that makes a column recognisable at a glance. */
  const columnMark = (column: BoardColumn): ReactNode => {
    if (dimension === 'track') return <TrackDot trackId={column.key || null} variant="glyph" />
    if (dimension === 'owner' && !column.key.startsWith(NAME_PREFIX)) {
      return <OwnerBadge ownerId={column.key || null} showName={false} />
    }
    return null
  }

  const renderColumn = (column: BoardColumn): ReactElement => {
    const collapsed = collapsedSet.has(column.key)
    const over = dragView !== null && dragView.overId === column.key
    const composing = composeIn === column.key

    return (
      <section
        key={column.key}
        ref={(el) => {
          registerColumn(column.key, el)
        }}
        className="mbd-col"
        data-dim={dimension}
        data-over={over ? 'true' : undefined}
        data-collapsed={collapsed ? 'true' : undefined}
        style={column.vars}
        aria-label={t('board.column', { column: column.label })}
      >
        {collapsed ? (
          <button
            type="button"
            className="mbd-rail"
            aria-expanded={false}
            // The label wraps to fit a 64px rail, which is legible but not
            // comfortable; the tooltip is the sighted reader's equivalent of
            // the aria-label everyone else already gets.
            title={column.label}
            // The count rides IN the label because an aria-label on a button
            // replaces its contents wholesale — the pill inside would otherwise
            // be announced to nobody.
            aria-label={t('board.expandColumn', {
              column: column.label,
              count: column.entries.length,
            })}
            onClick={() => collapse(dimension, column.key)}
          >
            <span className="pill mbd-col-count tabular" aria-hidden="true">
              {t('board.columnCount', { count: column.entries.length })}
            </span>
            <span className="mbd-rail-label" aria-hidden="true">
              {column.label}
            </span>
          </button>
        ) : (
          <>
            <header className="mbd-col-head">
              <button
                type="button"
                className="mbd-col-fold"
                aria-expanded
                aria-label={t('board.collapseColumn', {
                  column: column.label,
                  count: column.entries.length,
                })}
                onClick={() => collapse(dimension, column.key)}
              >
                <IconChevronDown size={16} className="mbd-caret" />
              </button>
              {columnMark(column)}
              <h3 className="mbd-col-title">{column.label}</h3>
              {renderCounts(column)}
              {canCreate ? (
                <button
                  ref={(el) => {
                    registerAdd(column.key, el)
                  }}
                  type="button"
                  className="mbd-col-add"
                  aria-expanded={composing}
                  aria-label={t('board.quickAdd', { column: column.label })}
                  onClick={() => openComposer(column.key)}
                >
                  <IconPlus size={16} />
                </button>
              ) : null}
            </header>

            {composing ? (
              <form
                className="mbd-add"
                onSubmit={(ev) => {
                  ev.preventDefault()
                  void submitAdd(column)
                }}
              >
                <input
                  ref={composerRef}
                  className="input mbd-add-input"
                  type="text"
                  value={draft}
                  maxLength={200}
                  aria-label={t('board.quickAdd', { column: column.label })}
                  placeholder={t('board.quickAddPlaceholder')}
                  onChange={(ev) => setDraft(ev.target.value)}
                  onKeyDown={(ev) => {
                    if (ev.key !== 'Escape') return
                    // Stopped, not just prevented: Escape also cancels a drag
                    // from the document listener, and closing a composer must
                    // not read as abandoning a gesture nobody started.
                    ev.stopPropagation()
                    closeComposer(column.key)
                  }}
                />
                <div className="mbd-add-row">
                  <button
                    type="submit"
                    className="btn btn-sm"
                    aria-busy={adding}
                    disabled={draft.trim() === '' || adding}
                  >
                    {t('board.quickAddSubmit')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => closeComposer(column.key)}
                  >
                    {t('common.cancel')}
                  </button>
                </div>
                <p className="mbd-add-hint">{t('board.quickAddHint')}</p>
              </form>
            ) : null}

            {column.entries.length === 0 && !over ? (
              <div className="mbd-col-empty">
                <p className="mbd-col-empty-title">
                  {t(COLUMN_EMPTY[dimension], { column: column.label })}
                </p>
                <p className="mbd-col-empty-hint">{t('board.columnEmptyHint')}</p>
              </div>
            ) : (
              renderCards(
                column,
                over ? (
                  // The DROP PREVIEW, and it sits at the TOP because that is
                  // where the card will actually be: every write bumps
                  // last_activity_at, and every list in this app is ordered by
                  // it. A placeholder promising the position under the pointer
                  // would be a preview of something that never happens.
                  <li className="mbd-slot" aria-hidden="true">
                    <span className="mbd-slot-title">{draggedTitle}</span>
                    <span className="mbd-slot-hint">{t('board.dropTop')}</span>
                  </li>
                ) : null,
              )
            )}
          </>
        )}
      </section>
    )
  }

  // A filtered board that admits nothing needs saying so; an EMPTY workspace
  // needs the columns, because the quick-add composer lives in them and an
  // empty state would be a dead end on day one. The way OUT of a filter is the
  // shell's own FilterBar, one tap above this stage and always visible — which
  // is why this empty state carries no Clear-all of its own to disagree with.
  const filtered = !isFilterEmpty(filter)
  const showEmpty = !loading && errorKey === null && entries.length === 0 && filtered

  return (
    <div
      className="mbd"
      data-density={density}
      data-compact={compact ? 'true' : undefined}
      // Read by map-board.css for exactly one rule: a mandatory scroll-snap and
      // a per-frame `scrollLeft` are two things steering one scroller, and the
      // snap wins — the phone's edge auto-scroll would be dragged back to the
      // nearest column every frame. Snapping resumes the moment the card lands.
      data-dragging={dragView !== null ? 'true' : undefined}
      ref={boardRef}
      onKeyDown={onBoardKeyDown}
      onClickCapture={onClickCapture}
    >
      <p className="mbd-sub">{t('board.subtitle')}</p>

      <div className="mbd-bar">
        <div className="chip-row mbd-group" role="group" aria-label={t('board.groupBy')}>
          <span className="mbd-group-label" aria-hidden="true">
            {t('board.groupBy')}
          </span>
          {BOARD_DIMENSIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              className="chip"
              aria-pressed={dimension === option.key}
              onClick={() => setDimension(option.key)}
            >
              {t(option.labelKey)}
            </button>
          ))}
        </div>

        <div className="chip-row mbd-group mbd-density" role="group" aria-label={t('board.density')}>
          <span className="mbd-group-label" aria-hidden="true">
            {t('board.density')}
          </span>
          {BOARD_DENSITIES.map((option) => (
            <button
              key={option.key}
              type="button"
              className="chip"
              aria-pressed={density === option.key}
              onClick={() => setDensity(option.key)}
            >
              {t(option.labelKey)}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="btn btn-sm btn-ghost mbd-refresh"
          onClick={handleRefresh}
          disabled={refreshing}
          aria-busy={refreshing}
        >
          {t('board.refresh')}
        </button>
      </div>

      {/* The two facts about the window this stage reads, and the one facet it
          cannot honour. Both are one line and both name the fix. */}
      <p className="mbd-hint mbd-window">{t('board.closedWindow', { count: CLOSED_WINDOW_DAYS })}</p>
      {statusFought ? (
        <p className="mbd-note" role="status">
          {t('board.statusAxisNote')}
        </p>
      ) : null}

      {/* Two sentences, one shown: the gesture a phone offers is not the
          gesture a mouse offers, and a hint that describes the wrong one is
          worse than none. The choice is a media query rather than a matchMedia
          read because it must survive a window being dragged onto a touch
          screen mid-session, and because `display: none` is the one way to hide
          a string from a screen reader as well as from an eye. */}
      <p className="mbd-hint mbd-hint-fine">{t('board.dragHint')}</p>
      <p className="mbd-hint mbd-hint-touch">{t('board.holdHint')}</p>
      <p className="sr-only">{t('board.keyboardHint')}</p>

      {errorKey !== null ? (
        <div className="card mbd-error" role="alert">
          <p className="mbd-error-title">{t('board.errLoad')}</p>
          <p className="muted">{t(errorKey)}</p>
          <button type="button" className="btn btn-sm" onClick={handleRefresh} disabled={refreshing}>
            {t('common.retry')}
          </button>
        </div>
      ) : null}

      {/* The closed window is a SEPARATE read and only this stage and the
          numbers stage make it. Its failure used to be indistinguishable from a
          quiet fortnight: Done and Cancelled simply came up short, with nothing
          on screen saying why. */}
      {closedErrorKey !== null ? (
        <p className="mbd-note" role="status">
          {t('board.errClosed')}{' '}
          <button type="button" className="btn btn-sm" onClick={handleRefresh} disabled={refreshing}>
            {t('common.retry')}
          </button>
        </p>
      ) : null}

      {loading && entries.length === 0 ? (
        <div className="mbd-scroller" aria-hidden="true">
          <div className="mbd-cols">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="mbd-col mbd-col-skeleton">
                <Skeleton height={18} width="60%" />
                <Skeleton height={92} count={3} radius={8} />
              </div>
            ))}
          </div>
        </div>
      ) : showEmpty ? (
        <EmptyState
          icon={<IconColumns size={30} />}
          title={t('board.empty')}
          description={t('board.emptyHint')}
        />
      ) : (
        <>
          <div className="mbd-scroller" ref={scrollerRef}>
            <div className="mbd-cols" role="group" aria-label={t('board.title')}>
              {live.map(renderColumn)}
            </div>
          </div>

          {overflow.length > 0 ? (
            <section className="mbd-overflow" aria-label={t(OVERFLOW_TITLE[dimension])}>
              <h3 className="mbd-overflow-title">{t(OVERFLOW_TITLE[dimension])}</h3>
              <p className="mbd-overflow-hint">{t('board.overflowHint')}</p>
              <ul className="mbd-overflow-list">
                {overflow.map((column) => {
                  const open = expandedOverflow.has(column.key)
                  return (
                    <li key={column.key} className="mbd-overflow-item" style={column.vars}>
                      <button
                        type="button"
                        className="mbd-overflow-toggle"
                        aria-expanded={open}
                        aria-label={
                          open
                            ? t('board.collapseColumn', {
                                column: column.label,
                                count: column.entries.length,
                              })
                            : t('board.expandColumn', {
                                column: column.label,
                                count: column.entries.length,
                              })
                        }
                        onClick={() =>
                          setExpandedOverflow((prev) => {
                            const next = new Set(prev)
                            if (!next.delete(column.key)) next.add(column.key)
                            return next
                          })
                        }
                      >
                        <span className="mbd-overflow-label">{column.label}</span>
                        {renderCounts(column)}
                      </button>
                      {open ? (
                        <div className="mbd-overflow-cards">{renderCards(column, null)}</div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  )
}

interface BoardCardProps {
  entry: Entry
  health: EntryHealth | undefined
  canEdit: boolean
  dragging: boolean
  /** A finger is resting on this card and its hold clock is running. */
  pressed: boolean
  enter: CardEnter | undefined
  onOpen: (id: string) => void
  onMove: (id: string, status: EntryStatus) => void
  onDragStart: (id: string, ev: ReactPointerEvent<HTMLElement>) => void
}

/**
 * One card, plus the two per-entry subscriptions the kit's connectedness rule
 * keeps out of EntryCard itself: a ROW must not read the entries LIST, or
 * sixty rows re-render the whole board on one realtime patch. These two hooks
 * are the narrow per-id selectors published for exactly this case. memo() with
 * primitive props is what keeps a drag cheap.
 */
const BoardCard = memo(function BoardCard({
  entry,
  health,
  canEdit,
  dragging,
  pressed,
  enter,
  onOpen,
  onMove,
  onDragStart,
}: BoardCardProps): ReactElement {
  const pending = usePendingOp(entry.id)
  const flash = useEntryFlash(entry.id)

  const dragHandleProps = useMemo<HTMLAttributes<HTMLElement>>(
    () =>
      canEdit
        ? {
            onPointerDown: (ev: ReactPointerEvent<HTMLElement>) => {
              onDragStart(entry.id, ev)
            },
          }
        : {},
    [canEdit, entry.id, onDragStart],
  )

  return (
    // tabIndex -1, not 0: Tab already reaches the title and the move menu inside
    // the card, and a third stop per card would triple the tab count of a
    // 60-card board. This exists so focus can be RESTORED here after a keyboard
    // move re-mounts the card in another column.
    <li
      className="mbd-card"
      data-entry-id={entry.id}
      data-enter={enter?.kind}
      // The grab cursor is the pointer half of "this card can be moved", and it
      // has to be conditional for the same reason the drag handler is: a card
      // this reader may not edit must not advertise a gesture the server would
      // refuse. On touch the same fact is carried by the press animation.
      data-draggable={canEdit ? 'true' : undefined}
      data-press={pressed ? 'true' : undefined}
      // Physical, and resolved from the shell's `rtl` — CSS has no logical
      // transform, and the sign is a fact this screen already holds.
      style={
        enter && enter.slide !== 0
          ? ({ '--mbd-slide': `${enter.slide}px` } as CSSProperties)
          : undefined
      }
      tabIndex={-1}
    >
      <EntryCard
        entry={entry}
        health={health}
        flash={flash}
        pending={pending}
        dragging={dragging}
        canEdit={canEdit}
        onOpen={onOpen}
        onMove={onMove}
        dragHandleProps={dragHandleProps}
      />
    </li>
  )
})
