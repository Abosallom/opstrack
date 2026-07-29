// The board — every item the filter admits, in a column per status.
//
// COLUMNS COME FROM THE VOCABULARY, not from the EntryStatus union. An admin who
// renamed `waiting_on` to "Awaiting vendor" and reordered the statuses sees that
// here, at zero cost, because the keys are frozen and the labels are resolved at
// render (store/vocab.ts's header). Hidden statuses leave the board — but only
// as COLUMNS: a hidden status still holding entries gets a strip in the retired
// rail below, because "hiding an option must never hide data". You can drag work
// OUT of a retired status; you cannot drag it in, which is the whole point of
// retiring one.
//
// SCOPE IS FORCED TO 'all' AND `statuses` IS FORCED EMPTY. The board's columns
// ARE the status axis, so a status facet would be a second control fighting the
// first, and the default 'open' scope would leave the Done and Cancelled columns
// permanently, inexplicably empty. The board therefore also asks for a window of
// recently-closed rows on mount — see CLOSED_WINDOW_DAYS.
//
// TWO PATHS TO ONE STORE CALL. A drag, the arrow keys, and the card's own move
// menu all end in `move()`, which is the only place in this file that writes.
// The keyboard path is not a fallback bolted on for an audit: EntryCard renders
// its move menu unconditionally (its own header says why), the arrow and digit
// shortcuts are delegated from the board root so they work wherever focus sits
// inside a card, and every move — pointer or key — announces itself in the live
// region. A board that only works for a mouse is a board half this team cannot
// use on the day they most need it.
//
// THE TRANSITION ROW COMES FROM THE API LAYER. `api/entries.updateEntry()` reads
// the previous status and appends the `status_from`/`status_to` thread row
// itself, so a move made here is attributable in the entry's thread without this
// screen writing anything extra — and writing it here as well would produce two
// rows for one move. See move()'s comment.
//
// OPTIMISM COMES FROM THE STORE, NOT FROM HERE. `setStatus()` applies locally,
// re-derives, and rolls the row back itself if the write fails; the card is in
// its new column before the request leaves. So this file holds no shadow copy of
// the board — the one thing that would guarantee a divergence between what the
// screen shows and what the store believes. A member who has lost permission
// sees the card snap back (store) and a toast naming the reason (store), plus
// the positional sentence in the live region (here).

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react'
import { useSearchParams } from 'react-router-dom'
import FilterBar, { type FilterFacet } from '../components/FilterBar'
import { EmptyState, Skeleton } from '../components/shared'
import { EntryCard } from '../components/entry'
import { IconColumns } from '../components/icons'
import { toast } from '../components/toast'
import {
  arrowStep,
  dropOf,
  edgeScroll,
  indexFromDigit,
  isDragging,
  moveDrag,
  moveIndex,
  startDrag,
  type DndSession,
  type DndZone,
} from '../lib/dnd'
import { addDays, todayIso } from '../lib/dates'
import {
  EMPTY_FILTER,
  filterFromParams,
  filterToParams,
  isFilterEmpty,
  type FilterState,
} from '../lib/entryFilter'
import { t, useLocale } from '../lib/i18n'
import { useTrackLabel } from '../lib/labels'
import { canEditEntry } from '../lib/permissions'
import { vocabVars } from '../lib/vocabStyle'
import { useAuth } from '../store/auth'
import { useActiveTracks, useTrackMap } from '../store/config'
import {
  loadClosedSince,
  loadEntries,
  refreshEntries,
  setStatus,
  useEntriesError,
  useEntriesLoading,
  useEntryFlash,
  useEntryMap,
  useFilteredEntries,
  useHealthMap,
  usePendingOp,
} from '../store/entries'
import { openEntry } from '../store/entrySheet'
import { useMemberMap } from '../store/members'
import { useVocabAll, useVocabLabel } from '../store/vocab'
import type { Entry, EntryHealth, EntryStatus, Track, UserRole } from '../types'
import './board.css'

/**
 * How far back the Done and Cancelled columns reach.
 *
 * The store's working set is OPEN entries; closed rows arrive only when a screen
 * asks for them. Asking for everything ever closed would grow without bound on a
 * log nothing deletes, and a Done column showing two years of history is not a
 * board, it is an archive. Two weeks is "what this team finished recently",
 * which is the question a board answers.
 */
const CLOSED_WINDOW_DAYS = 14

/**
 * Cards rendered per column before the fold.
 *
 * A column with 300 items is not read, it is scrolled past — and rendering all
 * of them costs a phone its frame budget on every drag. The count in the header
 * is always the true total, so the fold hides cards, never facts.
 */
const MAX_CARDS_PER_COLUMN = 25

/**
 * The facets the board offers.
 *
 * No `status` — the columns are the status axis (FilterBar's own header names
 * the board as the reason facets are opt-in). No `scope` either: see the file
 * header. What is left is the four the brief names, plus the two that live on
 * the always-visible rail and cost nothing.
 */
const BOARD_FACETS: readonly FilterFacet[] = ['search', 'mine', 'track', 'owner', 'priority', 'tag']

/** Cards within a column can be banded by track or by owner. */
type Grouping = 'none' | 'track' | 'owner'

const GROUPINGS: readonly { key: Grouping; labelKey: string }[] = [
  { key: 'none', labelKey: 'board.swimlaneNone' },
  { key: 'track', labelKey: 'board.swimlaneTrack' },
  { key: 'owner', labelKey: 'board.swimlaneOwner' },
]

/**
 * store/entries.ts's private QUEUED_KEY, which is not a failure: the write is
 * sitting in the outbox and will land on reconnect. Duplicated as a literal here
 * because the store does not export it — recorded as an extension-slot gap
 * rather than reached for across the module boundary.
 */
const QUEUED_ERROR_KEY = 'offline.queued'

/** How long after a drag a click is still that drag's mouseup, in ms. */
const CLICK_SUPPRESS_MS = 400

interface BoardColumn {
  key: EntryStatus
  label: string
  color: string | null
  /** Hidden in the vocabulary but still holding entries. Source only, never a target. */
  retired: boolean
  entries: Entry[]
}

interface Lane {
  key: string
  name: string
  entries: Entry[]
}

/** Nothing is ever pushed into this; one shared empty array keeps deps stable. */
const NO_ENTRIES: readonly Entry[] = Object.freeze([])

/**
 * Resolved at the moment of the key press rather than from the locale, which is
 * the choice useSwipeActions makes for the same reason: `dir` on <html> is what
 * the browser actually laid the columns out with, and it is one read instead of
 * a second copy of the locale-to-direction map.
 */
function readDir(): 'ltr' | 'rtl' {
  if (typeof document === 'undefined') return 'ltr'
  return document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr'
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
 * Band a column's cards by track or owner.
 *
 * Lanes are ordered by FIRST APPEARANCE in the already-sorted card list, so the
 * band holding the most recent activity leads. Ordering them by the track's own
 * sort order instead would be defensible, but it parks a silent, empty-looking
 * band at the top of a column whose only work is in the last track.
 */
function laneize(entries: readonly Entry[], keyOf: (e: Entry) => [string, string]): Lane[] {
  const lanes: Lane[] = []
  const index = new Map<string, Lane>()
  for (const entry of entries) {
    const [key, name] = keyOf(entry)
    const found = index.get(key)
    if (found) {
      found.entries.push(entry)
      continue
    }
    const lane: Lane = { key, name, entries: [entry] }
    index.set(key, lane)
    lanes.push(lane)
  }
  return lanes
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

export default function Board(): ReactElement {
  useLocale()
  const { profile } = useAuth()
  // `null`, never a stand-in id: canEditEntry() tests the signed-out case FIRST
  // and answers false, which is what keeps a card un-draggable in the moment
  // between mount and the profile arriving. A placeholder would satisfy the open
  // branch's `!!meId` and hand out an affordance the server would then refuse —
  // the exact "moves, snaps back, reads as broken" sequence lib/permissions.ts
  // exists to prevent. EntrySheet and FollowUps resolve it the same way.
  const meId = profile?.id ?? null
  const role: UserRole = profile?.role ?? 'member'

  // ── filter, in the URL ───────────────────────────────────────────────────
  //
  // The board's filter round-trips through the address bar, so a triage view is
  // a link someone can paste into a chat. `replace` rather than push: search is
  // not debounced (FilterBar's header says why), and a history entry per
  // keystroke would make the back button unusable.
  const [params, setParams] = useSearchParams()
  const filter = useMemo(() => {
    const parsed = filterFromParams(params)
    // A hand-edited or inherited URL can carry a status facet and a scope this
    // screen has no control for. Dropping them HERE rather than only in
    // `effective` is what stops the facet pill counting a filter the user can
    // neither see nor switch off.
    if (parsed.statuses.length === 0 && parsed.scope === EMPTY_FILTER.scope) return parsed
    return { ...parsed, statuses: [], scope: EMPTY_FILTER.scope }
  }, [params])
  const onFilterChange = useCallback(
    (next: FilterState) => {
      setParams(filterToParams(next), { replace: true })
    },
    [setParams],
  )
  const effective = useMemo<FilterState>(() => ({ ...filter, scope: 'all' }), [filter])

  const entries = useFilteredEntries(effective)
  const entryMap = useEntryMap()
  const healthMap = useHealthMap()
  const loading = useEntriesLoading()
  const errorKey = useEntriesError()
  const statusOptions = useVocabAll('status')
  const vocabLabel = useVocabLabel()
  const trackLabel = useTrackLabel()
  const trackMap = useTrackMap()
  const activeTracks = useActiveTracks()
  const memberMap = useMemberMap()

  const [grouping, setGrouping] = useState<Grouping>('none')
  const [expandedRetired, setExpandedRetired] = useState<ReadonlySet<string>>(() => new Set())
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(() => new Set())

  useEffect(() => {
    void loadEntries()
    // Without this the Done and Cancelled columns are empty forever: the working
    // set is open rows only.
    void loadClosedSince(addDays(todayIso(), -CLOSED_WINDOW_DAYS))
  }, [])

  // ── columns ──────────────────────────────────────────────────────────────

  const { live, retired } = useMemo(() => {
    const buckets = new Map<string, Entry[]>()
    for (const entry of entries) {
      const bucket = buckets.get(entry.status)
      if (bucket) bucket.push(entry)
      else buckets.set(entry.status, [entry])
    }
    const liveCols: BoardColumn[] = []
    const retiredCols: BoardColumn[] = []
    for (const option of statusOptions) {
      const held = buckets.get(option.key) ?? (NO_ENTRIES as Entry[])
      const column: BoardColumn = {
        // The cast is the boundary between a string-keyed store and the frozen
        // union, and it is sound in one direction only: every key here came from
        // useVocabAll(), which walks FROZEN_KEYS.status — the same list
        // EntryStatus is declared from. FilterBar makes the identical cast for
        // the identical reason.
        key: option.key as EntryStatus,
        label: option.label,
        color: option.color,
        retired: option.hidden,
        entries: held,
      }
      if (!option.hidden) liveCols.push(column)
      // A retired status with nothing in it is genuinely gone; one still holding
      // work has to stay reachable or that work is stranded.
      else if (held.length > 0) retiredCols.push(column)
    }
    return { live: liveCols, retired: retiredCols }
  }, [entries, statusOptions])

  const tagOptions = useMemo(() => {
    const tags = new Set<string>()
    for (const entry of entries) for (const tag of entry.tags) tags.add(tag)
    // The suggested tags of whatever track is in view — the vocabulary the team
    // agreed on for that track, offered before anyone has typed it even once.
    const inView: Track[] =
      filter.trackIds.length > 0
        ? filter.trackIds
            .map((id) => trackMap.get(id))
            .filter((track): track is Track => track !== undefined)
        : activeTracks
    for (const track of inView) for (const tag of track.suggested_tags) tags.add(tag)
    // An applied tag always stays offered, or a filter that empties the board
    // would take its own off-switch with it.
    for (const tag of filter.tags) tags.add(tag)
    return [...tags].sort()
  }, [entries, filter.trackIds, filter.tags, trackMap, activeTracks])

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
  const labelRef = useRef(vocabLabel)
  labelRef.current = vocabLabel

  const canEdit = useCallback((entry: Entry) => canEditEntry(entry, meId, role), [meId, role])
  const canEditRef = useRef(canEdit)
  canEditRef.current = canEdit

  const columnEls = useRef(new Map<string, HTMLElement>())
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const boardRef = useRef<HTMLDivElement | null>(null)
  const sessionRef = useRef<DndSession | null>(null)
  const listeningRef = useRef(false)
  const rafRef = useRef<number | null>(null)
  const draggedAtRef = useRef(0)
  const focusAfterMove = useRef<string | null>(null)
  const announceAfterMove = useRef<{ id: string; status: EntryStatus } | null>(null)

  const [dragView, setDragView] = useState<{ itemId: string; overId: string | null } | null>(null)

  // ── the live region ──────────────────────────────────────────────────────
  //
  // `seq` keys the child so an identical consecutive sentence still re-announces
  // — moving two cards into the same column in a row produces the same string,
  // and a region that only reacts to text CHANGES swallows the second one.
  const [announcement, setAnnouncement] = useState({ text: '', seq: 0 })
  const announce = useCallback((text: string) => {
    setAnnouncement((prev) => ({ text, seq: prev.seq + 1 }))
  }, [])

  // ── the one write ────────────────────────────────────────────────────────

  const move = useCallback(
    async (id: string, to: EntryStatus, via: 'drag' | 'key'): Promise<void> => {
      const entry = entryMapRef.current.get(id)
      if (!entry || entry.status === to) return
      if (!canEditRef.current(entry)) {
        // Should be unreachable — a card the user cannot edit is not draggable
        // and its move menu is disabled — so this is the belt to that braces,
        // not the affordance. lib/permissions.ts's header has the argument.
        toast(t('board.moveDisabled'), { tone: 'error' })
        announce(t('board.moveDisabledHint'))
        return
      }

      // Announced once the optimistic apply has landed and the card's real
      // position in its new column is knowable — see the effect below.
      if (via === 'key') announceAfterMove.current = { id, status: to }

      const result = await setStatus(id, to)

      // A queued write is outstanding, not failed: the outbox replays it, and
      // the transition row queues behind it in dependency order.
      if (!result.ok && result.error !== QUEUED_ERROR_KEY) {
        announceAfterMove.current = null
        // The store has already rolled the card back and toasted the REASON
        // (`entry.errNotYours` for an RLS refusal, and so on). This sentence is
        // the other half: what happened to the card.
        announce(t('board.errMove'))
        return
      }

      // THE TRANSITION ROW IS NOT WRITTEN HERE, and that is deliberate.
      // `api/entries.updateEntry()` reads the previous status before its PATCH
      // and appends the `status_from`/`status_to` row itself, so every writer in
      // the app gets an attributable transition without knowing to ask for one.
      // A second `postUpdate()` from this screen would produce TWO rows for one
      // move — precisely what 0001's comment ("a trigger would race the client's
      // own insert and produce two rows for one transition") exists to prevent.
      // Verified against the running app, not assumed.

      if (via === 'key') {
        // A drag has its own motion for feedback; a keypress has none, so it
        // gets the toast.
        toast(t('board.moved', { title: entry.title, status: labelRef.current('status', to) }))
      }
    },
    [announce],
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
    const column = live.find((c) => c.key === target.status)
    if (!column) return
    const at = column.entries.findIndex((e) => e.id === target.id)
    if (at < 0) return
    announceAfterMove.current = null
    announce(
      t('board.moveAnnounce', {
        title: entryMap.get(target.id)?.title ?? '',
        status: column.label,
        position: at + 1,
        total: column.entries.length,
      }),
    )
  }, [live, entryMap, announce])

  /** Focus follows a keyboard move: the card is re-mounted in its new column. */
  useEffect(() => {
    const id = focusAfterMove.current
    if (id === null) return
    const card = boardRef.current?.querySelector<HTMLElement>(
      `[data-entry-id="${CSS.escape(id)}"]`,
    )
    if (!card) return
    focusAfterMove.current = null
    card.focus()
  }, [live])

  // ── pointer drag ─────────────────────────────────────────────────────────

  const measureZones = useCallback((): DndZone[] => {
    const zones: DndZone[] = []
    for (const column of liveRef.current) {
      const el = columnEls.current.get(column.key)
      // Only live columns ever register an element, so a retired strip cannot
      // become a drop target by accident.
      if (el) zones.push({ id: column.key, box: boxOf(el), accepts: true })
    }
    return zones
  }, [])

  const tick = useCallback(() => {
    rafRef.current = null
    const session = sessionRef.current
    const el = scrollerRef.current
    if (!session || session.phase !== 'dragging' || !el) return
    const delta = edgeScroll(session.x, boxOf(el))
    // `scrollLeft` is physical, and so is edgeScroll's answer — see its header.
    // In RTL the browser reports a negative range and this arithmetic still
    // holds, because both sides of it live in the same physical space.
    if (delta !== 0) el.scrollLeft += delta
    rafRef.current = requestAnimationFrame(tick)
  }, [])

  const endRef = useRef<(commit: boolean) => void>(() => {})

  const onWindowMove = useCallback(
    (ev: PointerEvent) => {
      const session = sessionRef.current
      if (!session || ev.pointerId !== session.pointerId) return
      const next = moveDrag(session, ev.clientX, ev.clientY, measureZones())
      sessionRef.current = next
      if (next === session) return

      if (next.phase === 'abandoned') {
        endRef.current(false)
        return
      }
      if (next.phase !== 'dragging') return

      // Held card, still page. `touch-action: pan-y` on the card already leaves
      // vertical scrolling to the browser; this stops the rubber-banding a
      // horizontal drag produces at the ends of the scroller.
      if (ev.cancelable) ev.preventDefault()

      if (session.phase !== 'dragging') {
        draggedAtRef.current = Date.now()
        const entry = entryMapRef.current.get(next.itemId)
        announce(t('board.grabbed', { title: entry?.title ?? '' }))
        if (rafRef.current === null) rafRef.current = requestAnimationFrame(tick)
      }

      setDragView((prev) =>
        prev && prev.itemId === next.itemId && prev.overId === next.overId
          ? prev
          : { itemId: next.itemId, overId: next.overId },
      )
    },
    [announce, measureZones, tick],
  )

  const onWindowUp = useCallback((ev: PointerEvent) => {
    if (sessionRef.current?.pointerId !== ev.pointerId) return
    endRef.current(true)
  }, [])

  const onWindowCancel = useCallback(() => {
    endRef.current(false)
  }, [])

  const onWindowKey = useCallback((ev: KeyboardEvent) => {
    if (ev.key !== 'Escape') return
    ev.preventDefault()
    endRef.current(false)
  }, [])

  const endGesture = useCallback(
    (commit: boolean) => {
      if (!listeningRef.current) return
      listeningRef.current = false
      window.removeEventListener('pointermove', onWindowMove)
      window.removeEventListener('pointerup', onWindowUp)
      window.removeEventListener('pointercancel', onWindowCancel)
      window.removeEventListener('keydown', onWindowKey)
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }

      const session = sessionRef.current
      sessionRef.current = null
      setDragView(null)
      if (!isDragging(session)) return
      // A real drag just ended, so the click that follows this mouseup is the
      // drag's, not a tap on the card title.
      draggedAtRef.current = Date.now()

      const drop = commit ? dropOf(session) : null
      if (drop === null) {
        announce(t('board.dragCancelled'))
        return
      }
      // Announced at RELEASE rather than after the store settles: the motion is
      // the feedback for everyone who can see it, and this is the sentence for
      // everyone who cannot. A failure replaces it with errMove.
      announce(t('board.dropped', { status: labelRef.current('status', drop.toId) }))
      void moveRef.current(drop.itemId, drop.toId as EntryStatus, 'drag')
    },
    [announce, onWindowCancel, onWindowKey, onWindowMove, onWindowUp],
  )
  endRef.current = endGesture

  useEffect(
    () => () => {
      // Leaving the route mid-drag must not leave four window listeners and an
      // animation frame behind.
      endRef.current(false)
    },
    [],
  )

  const onDragStart = useCallback(
    (id: string, ev: ReactPointerEvent<HTMLElement>) => {
      // Right and middle buttons are a context menu and a paste, not a drag.
      if (ev.pointerType === 'mouse' && ev.button !== 0) return

      // THE CARD'S OWN CONTROLS KEEP THEIR OWN GESTURES. `dragHandleProps` is
      // spread on the card ROOT (EntryCard's header says why it is not a grip),
      // so a press on the status <select> — the keyboard move path, which
      // entry.css deliberately lifts above the title's stretched overlay —
      // bubbles here too. Claiming it is not a cosmetic problem: opening a
      // native select popup swallows the pointerup that would have ended the
      // gesture, leaving a session that never finishes and, on the next mouse
      // move, becomes a phantom drag of the card the user was only relabelling.
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

      sessionRef.current = startDrag({
        pointerId: ev.pointerId,
        itemId: id,
        fromId: entry.status,
        x: ev.clientX,
        y: ev.clientY,
        // Touch and pen only: on a phone a mostly-vertical drag is the column
        // being scrolled, and claiming it makes the board unreadable.
        lockToInlineAxis: ev.pointerType !== 'mouse',
      })
      listeningRef.current = true
      // On WINDOW, not on the card: an optimistic move re-parents the card into
      // another column mid-gesture, and a listener bound to the old node would
      // stop hearing the finger that is still moving.
      window.addEventListener('pointermove', onWindowMove, { passive: false })
      window.addEventListener('pointerup', onWindowUp)
      window.addEventListener('pointercancel', onWindowCancel)
      window.addEventListener('keydown', onWindowKey)
    },
    [onWindowCancel, onWindowKey, onWindowMove, onWindowUp],
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
    // The card's own move menu is a <select>; its arrow keys and its type-ahead
    // digits belong to it.
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
    const at = columns.findIndex((c) => c.key === entry.status)
    const step = arrowStep(ev.key, readDir())
    // A card parked in a retired status has no position on the live axis, so
    // the arrows have nothing to step from. Its move menu still works, and a
    // digit still names a column outright.
    if (step !== 0 && at < 0) return

    const index = step !== 0 ? moveIndex(at, step, columns.length) : indexFromDigit(ev.key, columns.length)
    if (index === null || index === at) return
    const to = columns[index]
    if (!to) return

    ev.preventDefault()
    focusAfterMove.current = id
    void moveRef.current(id, to.key, 'key')
  }, [])

  const handleOpen = useCallback((id: string) => {
    openEntryFrom(liveRef.current, id)
  }, [])

  const handleMenuMove = useCallback((id: string, status: EntryStatus) => {
    focusAfterMove.current = id
    void moveRef.current(id, status, 'key')
  }, [])

  // ── lanes ────────────────────────────────────────────────────────────────

  const laneKey = useCallback(
    (entry: Entry): [string, string] => {
      if (grouping === 'track') {
        const track = entry.track_id === null ? undefined : trackMap.get(entry.track_id)
        return track ? [track.id, trackLabel(track)] : ['', t('board.noTrackLane')]
      }
      if (entry.owner_id !== null) {
        return [
          entry.owner_id,
          memberMap.get(entry.owner_id)?.displayName ?? t('board.unassignedLane'),
        ]
      }
      const name = (entry.owner_name ?? '').trim()
      return name === '' ? ['', t('board.unassignedLane')] : [`name:${name}`, name]
    },
    [grouping, memberMap, trackLabel, trackMap],
  )

  // ── render ───────────────────────────────────────────────────────────────

  const registerColumn = useCallback((key: string, el: HTMLElement | null) => {
    if (el) columnEls.current.set(key, el)
    else columnEls.current.delete(key)
  }, [])

  const renderCards = (column: BoardColumn): ReactElement => {
    const total = column.entries.length
    const open = unfolded.has(column.key)
    const shown = open ? column.entries : column.entries.slice(0, MAX_CARDS_PER_COLUMN)
    const hidden = total - shown.length

    const cards = (list: readonly Entry[]): ReactElement[] =>
      list.map((entry) => (
        <BoardCard
          key={entry.id}
          entry={entry}
          health={healthMap.get(entry.id)}
          canEdit={canEdit(entry)}
          dragging={dragView?.itemId === entry.id}
          onOpen={handleOpen}
          onMove={handleMenuMove}
          onDragStart={onDragStart}
        />
      ))

    return (
      <>
        <ul className="bd-cards">
          {grouping === 'none'
            ? cards(shown)
            : laneize(shown, laneKey).map((lane) => (
                <li key={lane.key} className="bd-lane">
                  <h4 className="bd-lane-title">{lane.name}</h4>
                  <ul className="bd-cards">{cards(lane.entries)}</ul>
                </li>
              ))}
        </ul>
        {total > MAX_CARDS_PER_COLUMN ? (
          <button
            type="button"
            className="btn btn-sm btn-ghost bd-fold"
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

  const showEmpty = !loading && errorKey === null && entries.length === 0

  return (
    <div className="bd" ref={boardRef} onKeyDown={onBoardKeyDown} onClickCapture={onClickCapture}>
      <p className="bd-sub">{t('board.subtitle')}</p>

      <FilterBar
        value={filter}
        onChange={onFilterChange}
        facets={BOARD_FACETS}
        tags={tagOptions}
        count={entries.length}
        resultLabel={(n) => t('board.total', { count: n })}
        tagHint={t('board.closedWindow', { days: CLOSED_WINDOW_DAYS })}
      />

      <div className="bd-bar">
        <div className="chip-row bd-group" role="group" aria-label={t('board.swimlanes')}>
          {GROUPINGS.map((option) => (
            <button
              key={option.key}
              type="button"
              className="chip"
              aria-pressed={grouping === option.key}
              onClick={() => setGrouping(option.key)}
            >
              {t(option.labelKey)}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn btn-sm btn-ghost bd-refresh"
          onClick={() => void refreshEntries()}
        >
          {t('board.refresh')}
        </button>
      </div>

      <p className="bd-hint">{t('board.dragHint')}</p>
      <p className="sr-only">{t('board.keyboardHint')}</p>

      {/* One polite region for every move, however it was made. Assertive would
          interrupt a screen-reader user mid-sentence on a board where several
          cards move in a row. */}
      <p className="sr-only" role="status" aria-live="polite">
        <span key={announcement.seq}>{announcement.text}</span>
      </p>

      {errorKey !== null ? (
        <div className="card bd-error" role="alert">
          <p className="bd-error-title">{t('board.errLoad')}</p>
          <p className="muted">{t(errorKey)}</p>
          <button type="button" className="btn btn-sm" onClick={() => void refreshEntries()}>
            {t('common.retry')}
          </button>
        </div>
      ) : null}

      {loading && entries.length === 0 ? (
        <div className="bd-scroller" aria-hidden="true">
          <div className="bd-cols">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="bd-col bd-col-skeleton">
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
          action={
            isFilterEmpty(filter) ? null : (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => onFilterChange({ ...EMPTY_FILTER })}
              >
                {t('filter.clearAll')}
              </button>
            )
          }
        />
      ) : (
        <>
          <div className="bd-scroller" ref={scrollerRef}>
            <div className="bd-cols" role="group" aria-label={t('board.title')}>
              {live.map((column) => (
                <section
                  key={column.key}
                  ref={(el) => {
                    registerColumn(column.key, el)
                  }}
                  className="bd-col"
                  style={vocabVars(column.color)}
                  data-over={dragView?.overId === column.key ? 'true' : undefined}
                  aria-label={t('board.column', { status: column.label })}
                >
                  <header className="bd-col-head">
                    <h3 className="bd-col-title">{column.label}</h3>
                    {/* The digit is for the eye; the label is for everyone else.
                        A bare "2" beside a heading announces as "2" and means
                        nothing — `role="img"` + aria-label is the same trick the
                        entry kit's own pills use to give a glyph a sentence. */}
                    <span
                      className="pill bd-col-count tabular"
                      role="img"
                      aria-label={t('board.columnCountLabel', { count: column.entries.length })}
                    >
                      {t('board.columnCount', { count: column.entries.length })}
                    </span>
                  </header>
                  {dragView !== null && dragView.overId === column.key ? (
                    <p className="bd-drop">{t('board.dropHere', { status: column.label })}</p>
                  ) : null}
                  {column.entries.length === 0 ? (
                    <div className="bd-col-empty">
                      <p className="bd-col-empty-title">
                        {t('board.columnEmpty', { status: column.label })}
                      </p>
                      <p className="bd-col-empty-hint">{t('board.columnEmptyHint')}</p>
                    </div>
                  ) : (
                    renderCards(column)
                  )}
                </section>
              ))}
            </div>
          </div>

          {retired.length > 0 ? (
            <section className="bd-retired" aria-label={t('board.hiddenColumns')}>
              <h3 className="bd-retired-title">{t('board.hiddenColumns')}</h3>
              <p className="bd-retired-hint">{t('board.hiddenColumnsHint')}</p>
              <ul className="bd-retired-list">
                {retired.map((column) => {
                  const open = expandedRetired.has(column.key)
                  return (
                    <li
                      key={column.key}
                      className="bd-retired-item"
                      style={vocabVars(column.color)}
                    >
                      <button
                        type="button"
                        className="bd-retired-toggle"
                        aria-expanded={open}
                        // The count is INSIDE the label because an aria-label on
                        // a button replaces its contents wholesale — without it
                        // the "2" in the pill is announced to nobody, and how
                        // much work is stranded in a retired status is the one
                        // fact this rail exists to report.
                        aria-label={
                          open
                            ? t('board.collapseColumn', {
                                status: column.label,
                                count: column.entries.length,
                              })
                            : t('board.expandColumn', {
                                status: column.label,
                                count: column.entries.length,
                              })
                        }
                        onClick={() =>
                          setExpandedRetired((prev) => {
                            const next = new Set(prev)
                            if (!next.delete(column.key)) next.add(column.key)
                            return next
                          })
                        }
                      >
                        <span className="bd-retired-label">{column.label}</span>
                        <span className="pill tabular">
                          {t('board.columnCount', { count: column.entries.length })}
                        </span>
                      </button>
                      {open ? <div className="bd-retired-cards">{renderCards(column)}</div> : null}
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
  onOpen: (id: string) => void
  onMove: (id: string, status: EntryStatus) => void
  onDragStart: (id: string, ev: ReactPointerEvent<HTMLElement>) => void
}

/**
 * One card, plus the two per-entry subscriptions the kit's connectedness rule
 * keeps out of EntryCard itself.
 *
 * That rule says a ROW must not read store/entries, because sixty rows each
 * subscribing to the LIST would re-render the whole board on one realtime patch.
 * These two hooks are the narrow per-id selectors the store publishes for
 * exactly this case: `s.pending.get(id)` is a Map lookup, and only the card
 * whose value actually changed re-renders. There is no map-shaped equivalent
 * (`usePendingMap`/`useFlashMap` do not exist), so the alternative would be the
 * board subscribing to two whole Maps and re-rendering every column whenever any
 * single write starts or settles — strictly worse. Recorded as an extension-slot
 * gap.
 *
 * memo() with primitive props is what keeps a drag cheap: `entry` and `health`
 * are reference-stable store values, and a drag changes `dragging` on one card.
 */
const BoardCard = memo(function BoardCard({
  entry,
  health,
  canEdit,
  dragging,
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
    <li className="bd-card" data-entry-id={entry.id} tabIndex={-1}>
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
