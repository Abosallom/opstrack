// The board — every item the filter admits, in a column per whatever the reader
// is currently grouping by.
//
// THE COLUMN AXIS IS A CHOICE, NOT A CONSTANT (WAVE3-NOTES §1). Status is the
// default and the one everybody means by "kanban", but the same card machinery
// bands by track, by owner or by priority, and a drag along each of those axes
// is a re-file, a re-assignment or a re-prioritisation. There is exactly ONE
// place in this file that knows which: `patchFor()`. Everything else — the
// bucketing, the hit test, the keyboard path, the announcements, the quick-add
// seed — is written against an opaque column key, which is why a fifth
// dimension would be a row in `DIMENSIONS` plus a case in three switches rather
// than a second board.
//
// COLUMNS COME FROM THE VOCABULARY (and the track list, and the member list),
// not from the frozen unions. An admin who renamed `waiting_on` to "Awaiting
// vendor" and reordered the statuses sees that here, at zero cost, because the
// keys are frozen and the labels are resolved at render (store/vocab.ts's
// header). Options an admin retired, tracks they archived, and free-text
// owners who were never members all leave the board — but only as COLUMNS: a
// bucket that still holds entries gets a strip in the overflow rail below,
// because "hiding an option must never hide data". You can drag work OUT of a
// retired bucket; you cannot drag it in, which is the whole point of retiring
// one. Free-text owners are permanently in that rail, because a board has no
// control for typing a vendor's name and an affordance that cannot be honoured
// is worse than none.
//
// SCOPE IS FORCED TO 'all', AND THE STATUS FACET IS DROPPED ONLY WHEN STATUS IS
// THE AXIS. A status facet fighting status columns would leave Done and
// Cancelled permanently, inexplicably empty; a status facet over OWNER columns
// is the useful question "who is sitting on the blocked work". The board also
// asks for a window of recently-closed rows on mount either way — see
// CLOSED_WINDOW_DAYS.
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
// ON A PHONE, A DRAG STARTS WITH A HOLD — and the pan belongs to the browser
// until it does. The first cut of this screen gave cards `touch-action: pan-y`
// and claimed any sideways finger as a drag, which on a 375px screen left the
// 8px gutter between two cards as the only surface that could swipe to the next
// column. Now a card is `touch-action: manipulation` (the page and the board
// pan from anywhere, as they should), and the card is only lifted after
// HOLD_MS of a finger resting on it — at which point this screen cancels the
// browser's scrolling for the rest of the gesture by preventing the first
// touchmove, which is the only moment at which that is still possible. The
// press itself is visible while the clock runs (`data-press`), so the hold is
// an affordance rather than a secret. lib/dnd.ts's header has the full
// argument, and dnd.test.ts asserts both halves of the handshake.
//
// THE CARD'S OWN MENU IS ALWAYS A STATUS MENU, whatever the column axis is. It
// is a StatusPill; it is labelled with statuses; making it mean "owner" when
// the board happens to be grouped by owner would be a control that lies. So
// under a non-status axis the pill still moves the card WITHIN its column, and
// the arrow/digit keys are the axis-aware path. Both are first-class, and the
// keyboard hint says so.
//
// THE TRANSITION ROW COMES FROM THE API LAYER. `api/entries.updateEntry()` reads
// the previous status and appends the `status_from`/`status_to` thread row
// itself, so a move made here is attributable in the entry's thread without this
// screen writing anything extra — and writing it here as well would produce two
// rows for one move. See move()'s comment.
//
// OPTIMISM COMES FROM THE STORE, NOT FROM HERE. `setStatus()`/`patchEntry()`
// apply locally, re-derive, and roll the row back themselves if the write
// fails; the card is in its new column before the request leaves. So this file
// holds no shadow copy of the board — the one thing that would guarantee a
// divergence between what the screen shows and what the store believes. A
// member who has lost permission sees the card snap back (store) and a toast
// naming the reason (store), plus the positional sentence in the live region
// (here).

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
import { useSearchParams } from 'react-router-dom'
import FilterBar, { type FilterFacet } from '../components/FilterBar'
import { EmptyState, Skeleton } from '../components/shared'
import { EntryCard, OwnerBadge, TrackDot } from '../components/entry'
import { IconChevronDown, IconPlus } from '../components/fields'
import { IconColumns } from '../components/icons'
import { toast } from '../components/toast'
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
import { trackVars } from '../lib/trackStyle'
import { vocabVars } from '../lib/vocabStyle'
import { useAuth } from '../store/auth'
import { useActiveTracks, useTrackMap } from '../store/config'
import {
  createEntryOptimistic,
  loadClosedSince,
  loadEntries,
  patchEntry,
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
import { useMemberLabel, useMemberMap, useMembers } from '../store/members'
import { useVocabAll, useVocabLabel } from '../store/vocab'
import type {
  Entry,
  EntryHealth,
  EntryPatch,
  EntryPriority,
  EntryStatus,
  NewEntry,
  Track,
  UserRole,
} from '../types'
import './board.css'

/**
 * How far back the Done and Cancelled columns reach.
 *
 * The store's working set is OPEN entries; closed rows arrive only when a screen
 * asks for them. Asking for everything ever closed would grow without bound on a
 * log nothing deletes, and a Done column showing two years of history is not a
 * board, it is an archive. Two weeks is "what this team finished recently",
 * which is the question a board answers — and it is loaded under every axis,
 * because "what did Layla finish this fortnight" is the same question asked of
 * the owner columns.
 */
const CLOSED_WINDOW_DAYS = 14

/**
 * Cards rendered per column before the fold, per density.
 *
 * A column with 300 items is not read, it is scrolled past — and rendering all
 * of them costs a phone its frame budget on every drag. The count in the header
 * is always the true total, so the fold hides cards, never facts.
 */
const MAX_CARDS: Readonly<Record<Density, number>> = { comfortable: 25, compact: 40 }

/**
 * The facets the board offers under every axis.
 *
 * No `scope` — see the file header. `status` is appended when status is NOT the
 * column axis, which is the one facet whose usefulness depends on the grouping.
 */
// `group` sits above `track` for the reason FilterBar's DEFAULT_FACETS gives:
// it is the coarser cut and the one somebody reaches for first. On a board it
// earns its place twice over — "the technical half, by owner" is the standing
// question this screen was built for, and before 0018 it took selecting six
// tracks by hand.
const BOARD_FACETS: readonly FilterFacet[] = [
  'search',
  'mine',
  'group',
  'track',
  'owner',
  'priority',
  'tag',
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

/** How long a card wears its arrival animation. Matches board.css's 180ms. */
const ENTER_MS = 240

/**
 * Above this many cards changing column at once, nothing animates.
 *
 * A teammate moving one card is an event worth showing. A filter change, a
 * first load or an axis switch re-buckets everything at once, and animating
 * forty cards is not "livelier", it is a screen that convulses every time
 * somebody types in the search box.
 */
const ENTER_BURST_MAX = 6

/** How far a card slides in from, in px. Physical — the sign is resolved by dir. */
const ENTER_SLIDE_PX = 14

/** The bucket key for "no value" — untracked, unassigned. Never a real id. */
const NO_VALUE = ''

/**
 * Prefix for an owner bucket that is free text rather than a member.
 *
 * `entries.owner_name` holds vendors and other people outside the workspace,
 * and they own real work. They get a column so that work is visible and can be
 * dragged onto a teammate; they never accept a drop, because assigning TO a
 * vendor means typing a name and a board has nowhere to type.
 */
const NAME_PREFIX = 'name:'

/** localStorage record of the three choices that should outlive a reload. */
const PREFS_KEY = 'nphiescore_board_v1'

/** Which dimension the columns are cut along. */
type BoardDim = 'status' | 'track' | 'owner' | 'priority'

type Density = 'comfortable' | 'compact'

const DIMENSIONS: readonly { key: BoardDim; labelKey: string }[] = [
  { key: 'status', labelKey: 'board.groupStatus' },
  { key: 'track', labelKey: 'board.groupTrack' },
  { key: 'owner', labelKey: 'board.groupOwner' },
  { key: 'priority', labelKey: 'board.groupPriority' },
]

const DENSITIES: readonly { key: Density; labelKey: string }[] = [
  { key: 'comfortable', labelKey: 'board.densityComfortable' },
  { key: 'compact', labelKey: 'board.densityCompact' },
]

/**
 * The overflow rail's heading, per axis.
 *
 * Written as a literal Record rather than `t(\`board.overflow${dim}\`)` because
 * lib/localeReach.test.ts finds keys by scanning for quoted dotted strings — a
 * template literal has no key until it runs, and the four families that are
 * built that way have to be enumerated in the test itself. A lookup table costs
 * three lines and stays inside the mechanism.
 */
const OVERFLOW_TITLE: Readonly<Record<BoardDim, string>> = {
  status: 'board.overflowStatus',
  track: 'board.overflowTrack',
  owner: 'board.overflowOwner',
  priority: 'board.overflowPriority',
}

/**
 * What an empty column says, per axis. Same lookup-table reason as above, plus
 * one of its own: one shared sentence cannot be written. "Nothing in Blocked"
 * and "Nothing on Network" both read; "Nothing in Layla" and "Nothing in High"
 * do not. The owner line deliberately drops the name — the column header is
 * three centimetres above it, and "Nothing assigned to Unassigned" is the
 * sentence a shared template produces.
 */
const COLUMN_EMPTY: Readonly<Record<BoardDim, string>> = {
  status: 'board.columnEmptyStatus',
  track: 'board.columnEmptyTrack',
  owner: 'board.columnEmptyOwner',
  priority: 'board.columnEmptyPriority',
}

interface BoardColumn {
  /** The dimension value. `NO_VALUE` for the untracked/unassigned bucket. */
  key: string
  label: string
  /** Inline custom properties painting this column's accent, or `{}`. */
  vars: CSSProperties
  /** Source only. Lives in the overflow rail and never accepts a drop. */
  retired: boolean
  entries: Entry[]
  /** How many of this column's cards are past their SLA. */
  breached: number
}

/** One card's arrival animation, resolved by the board and read by CSS. */
interface CardEnter {
  kind: 'new' | 'moved' | 'landed'
  /** Physical px offset to slide in from. 0 for a card that did not travel. */
  slide: number
}

interface BoardPrefs {
  dimension: BoardDim
  density: Density
  /** Collapsed column keys, per dimension — a track id means nothing to the status axis. */
  collapsed: Record<string, string[]>
}

const DEFAULT_PREFS: BoardPrefs = { dimension: 'status', density: 'comfortable', collapsed: {} }

/** Nothing is ever pushed into this; one shared empty array keeps deps stable. */
const NO_ENTRIES: readonly Entry[] = Object.freeze([])
const NO_ENTER: ReadonlyMap<string, CardEnter> = new Map()

function isDim(v: unknown): v is BoardDim {
  return DIMENSIONS.some((d) => d.key === v)
}

/**
 * Read the persisted choices.
 *
 * Every field is validated rather than trusted: this is user-writable storage
 * that survives a schema change, and a stale `dimension: 'assignee'` from a
 * future build must degrade to the default rather than render zero columns.
 */
function readPrefs(): BoardPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (raw === null) return DEFAULT_PREFS
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_PREFS
    const rec = parsed as Record<string, unknown>
    const collapsed: Record<string, string[]> = {}
    if (typeof rec.collapsed === 'object' && rec.collapsed !== null) {
      for (const [dim, keys] of Object.entries(rec.collapsed as Record<string, unknown>)) {
        if (Array.isArray(keys)) collapsed[dim] = keys.filter((k): k is string => typeof k === 'string')
      }
    }
    return {
      dimension: isDim(rec.dimension) ? rec.dimension : DEFAULT_PREFS.dimension,
      density: rec.density === 'compact' ? 'compact' : 'comfortable',
      collapsed,
    }
  } catch {
    // Private mode, a quota wall, or a half-written value. A board that throws
    // on mount because a preference is malformed is worse than a default board.
    return DEFAULT_PREFS
  }
}

function writePrefs(prefs: BoardPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Preferences are a convenience; losing them must never break a move.
  }
}

/** Which column an entry belongs to, on a given axis. */
function bucketOf(e: Entry, dim: BoardDim): string {
  if (dim === 'status') return e.status
  if (dim === 'priority') return e.priority
  if (dim === 'track') return e.track_id ?? NO_VALUE
  if (e.owner_id !== null) return e.owner_id
  const name = (e.owner_name ?? '').trim()
  return name === '' ? NO_VALUE : NAME_PREFIX + name
}

/**
 * The write a drop onto `key` performs — THE ONE PLACE the axis becomes a
 * mutation. Null for a bucket that cannot be a target.
 *
 * The owner case clears `owner_name` alongside setting `owner_id`, because
 * types.ts declares the two mutually exclusive: leaving a vendor's name behind
 * on a row now owned by a teammate makes every reader that falls back to
 * owner_name (the digest, the CSV export) disagree with the board.
 */
function patchFor(dim: BoardDim, key: string): EntryPatch | null {
  if (key.startsWith(NAME_PREFIX)) return null
  switch (dim) {
    case 'status':
      return { status: key as EntryStatus }
    case 'priority':
      return { priority: key as EntryPriority }
    case 'track':
      return { trackId: key === NO_VALUE ? null : key }
    case 'owner':
      return { ownerId: key === NO_VALUE ? null : key, ownerName: null }
  }
}

/** What a quick-add in `key`'s column pre-fills. Mirrors `patchFor`. */
function seedFor(dim: BoardDim, key: string): Partial<NewEntry> {
  switch (dim) {
    case 'status':
      return { status: key as EntryStatus }
    case 'priority':
      return { priority: key as EntryPriority }
    case 'track':
      return { trackId: key === NO_VALUE ? null : key }
    case 'owner':
      return { ownerId: key === NO_VALUE ? null : key }
  }
}

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
  // Every signed-in member may insert (0001's entries_insert), so quick-add is
  // gated on a session and nothing else. There is no per-column variant of this
  // question: a column is a value, not a permission.
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
  const setDensity = useCallback((next: Density) => {
    setPrefs((p) => (p.density === next ? p : { ...p, density: next }))
  }, [])
  const toggleCollapsed = useCallback((dim: BoardDim, key: string) => {
    setPrefs((p) => {
      const current = p.collapsed[dim] ?? []
      const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key]
      return { ...p, collapsed: { ...p.collapsed, [dim]: next } }
    })
  }, [])
  const collapsedSet = useMemo(
    () => new Set(prefs.collapsed[dimension] ?? []),
    [prefs.collapsed, dimension],
  )

  // ── filter, in the URL ───────────────────────────────────────────────────
  //
  // The board's filter round-trips through the address bar, so a triage view is
  // a link someone can paste into a chat. `replace` rather than push: search is
  // not debounced (FilterBar's header says why), and a history entry per
  // keystroke would make the back button unusable.
  const [params, setParams] = useSearchParams()
  const filter = useMemo(() => {
    const parsed = filterFromParams(params)
    // A hand-edited or inherited URL can carry a scope this screen has no
    // control for, and — when status is the axis — a status facet that would
    // fight the columns. Dropping them HERE rather than only in `effective` is
    // what stops the facet pill counting a filter the user can neither see nor
    // switch off.
    const dropStatus = dimension === 'status' && parsed.statuses.length > 0
    if (!dropStatus && parsed.scope === EMPTY_FILTER.scope) return parsed
    return { ...parsed, statuses: dropStatus ? [] : parsed.statuses, scope: EMPTY_FILTER.scope }
  }, [params, dimension])
  const onFilterChange = useCallback(
    (next: FilterState) => {
      setParams(filterToParams(next), { replace: true })
    },
    [setParams],
  )
  const effective = useMemo<FilterState>(() => ({ ...filter, scope: 'all' }), [filter])
  const facets = useMemo<readonly FilterFacet[]>(
    () => (dimension === 'status' ? BOARD_FACETS : [...BOARD_FACETS, 'status']),
    [dimension],
  )

  const entries = useFilteredEntries(effective)
  const entryMap = useEntryMap()
  const healthMap = useHealthMap()
  const loading = useEntriesLoading()
  const errorKey = useEntriesError()
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

  useEffect(() => {
    void loadEntries()
    // Without this the Done and Cancelled columns are empty forever: the working
    // set is open rows only.
    void loadClosedSince(addDays(todayIso(), -CLOSED_WINDOW_DAYS))
  }, [])

  // ── columns ──────────────────────────────────────────────────────────────

  const { live, overflow, membership } = useMemo(() => {
    const buckets = new Map<string, Entry[]>()
    const membershipMap = new Map<string, string>()
    for (const entry of entries) {
      const key = bucketOf(entry, dimension)
      membershipMap.set(entry.id, key)
      const bucket = buckets.get(key)
      if (bucket) bucket.push(entry)
      else buckets.set(key, [entry])
    }

    // The declared columns, in the order the axis defines. `retired` marks the
    // ones that exist as buckets but must never be targets.
    const defs: { key: string; label: string; vars: CSSProperties; retired: boolean }[] = []

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

    const residualVars = (key: string): CSSProperties => {
      if (dimension !== 'track') return {}
      const track = trackMap.get(key)
      return track ? trackVars(track.color, track.color_light) : {}
    }

    if (dimension === 'status' || dimension === 'priority') {
      // The cast is the boundary between a string-keyed store and the frozen
      // unions, and it is sound in one direction only: every key here came from
      // useVocabAll(), which walks FROZEN_KEYS — the same list EntryStatus and
      // EntryPriority are declared from. FilterBar makes the identical cast for
      // the identical reason.
      for (const option of dimension === 'status' ? statusOptions : priorityOptions) {
        defs.push({
          key: option.key,
          label: option.label,
          vars: vocabVars(option.color),
          retired: option.hidden,
        })
      }
    } else if (dimension === 'track') {
      // The residual bucket LEADS on both of the assignment axes: untracked and
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

    // Anything the data holds that the axis does not declare: an archived
    // track, a deleted member, a free-text vendor, a key from a build that
    // knew one more option than this one does. All source-only.
    const declared = new Set(defs.map((d) => d.key))
    for (const key of buckets.keys()) {
      if (declared.has(key)) continue
      defs.push({ key, label: residualLabel(key), vars: residualVars(key), retired: true })
    }

    const liveCols: BoardColumn[] = []
    const overflowCols: BoardColumn[] = []
    for (const def of defs) {
      const held = buckets.get(def.key) ?? (NO_ENTRIES as Entry[])
      let breached = 0
      for (const entry of held) if (healthMap.get(entry.id)?.sla_breached) breached += 1
      const column: BoardColumn = { ...def, entries: held, breached }
      if (!def.retired) liveCols.push(column)
      // A retired bucket with nothing in it is genuinely gone; one still holding
      // work has to stay reachable or that work is stranded.
      else if (held.length > 0) overflowCols.push(column)
    }
    return { live: liveCols, overflow: overflowCols, membership: membershipMap }
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
  const dimRef = useRef(dimension)
  dimRef.current = dimension

  const labelOf = useCallback(
    (key: string): string =>
      live.find((c) => c.key === key)?.label ??
      overflow.find((c) => c.key === key)?.label ??
      key,
    [live, overflow],
  )
  const labelRef = useRef(labelOf)
  labelRef.current = labelOf

  const canEdit = useCallback((entry: Entry) => canEditEntry(entry, meId, role), [meId, role])
  const canEditRef = useRef(canEdit)
  canEditRef.current = canEdit

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
   * RENDERED state of one memoised card (board.css turns it into the squeeze
   * that makes the hold discoverable), and reaching into the DOM to paint it
   * would put the board's appearance in two places.
   */
  const [pressId, setPressId] = useState<string | null>(null)

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
    async (id: string, toKey: string, via: 'drag' | 'key'): Promise<void> => {
      const entry = entryMapRef.current.get(id)
      if (!entry) return
      const dim = dimRef.current
      if (bucketOf(entry, dim) === toKey) return
      if (!canEditRef.current(entry)) {
        // Should be unreachable — a card the user cannot edit is not draggable
        // and its move menu is disabled — so this is the belt to that braces,
        // not the affordance. lib/permissions.ts's header has the argument.
        toast(t('board.moveDisabled'), { tone: 'error' })
        announce(t('board.moveDisabledHint'))
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
      // The same applies to a re-assignment: the assigned-notification trigger
      // is server-side, so a drag onto a teammate's column notifies them with
      // zero plumbing on this screen.

      if (via === 'key') {
        // A drag has its own motion for feedback; a keypress has none, so it
        // gets the toast.
        toast(t('board.moved', { title: entry.title, column: labelRef.current(toKey) }))
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
    const column = live.find((c) => c.key === target.key)
    if (!column) return
    const at = column.entries.findIndex((e) => e.id === target.id)
    if (at < 0) return
    announceAfterMove.current = null
    announce(
      t('board.moveAnnounce', {
        title: entryMap.get(target.id)?.title ?? '',
        column: column.label,
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

  // ── arrival motion ───────────────────────────────────────────────────────
  //
  // A card that changed column since the last render animates INTO its new one:
  // a spring if this reader moved it, a directional slide if somebody else did
  // (carrying the kit's own updated-by flash, which the store sets), a fade-up
  // if it is new. Computed by comparing two membership snapshots rather than by
  // measuring the DOM, so it costs one Map walk and needs no layout read.
  //
  // The slide's SIGN is physical and resolved here from `dir`, for the reason
  // lib/dnd.ts's header gives: CSS has no logical transform, and direction is
  // something this screen already knows.

  const prevMembership = useRef<ReadonlyMap<string, string> | null>(null)
  const [enter, setEnter] = useState<ReadonlyMap<string, CardEnter>>(NO_ENTER)

  useEffect(() => {
    const prev = prevMembership.current
    prevMembership.current = membership
    // First paint is not an event. Nothing "arrived" on a board that was not
    // there a moment ago.
    if (prev === null) return

    const order = new Map(live.map((c, i) => [c.key, i]))
    const sign = readDir() === 'rtl' ? -1 : 1
    const next = new Map<string, CardEnter>()
    for (const [id, key] of membership) {
      const was = prev.get(id)
      if (was === key) continue
      if (was === undefined) {
        next.set(id, { kind: 'new', slide: 0 })
        continue
      }
      const mine = mineRef.current.delete(id)
      const from = order.get(was)
      const to = order.get(key)
      const travel = from === undefined || to === undefined ? 0 : Math.sign(to - from) * sign
      next.set(id, { kind: mine ? 'landed' : 'moved', slide: -travel * ENTER_SLIDE_PX })
    }

    if (next.size === 0) return
    if (next.size > ENTER_BURST_MAX) {
      // A filter change, an axis switch or a first load. Not an event.
      mineRef.current.clear()
      return
    }
    setEnter(next)
    const timer = window.setTimeout(() => setEnter(NO_ENTER), ENTER_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [membership, live])

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
      announce(t('board.grabbed', { title: entry?.title ?? '' }))
      if (rafRef.current === null) rafRef.current = requestAnimationFrame(tick)
      setPressId(null)
      setDragView({ itemId: session.itemId, overId: session.overId })
    },
    [announce, tick],
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
   * THE ONE CALL THAT MAKES A TOUCH DRAG POSSIBLE.
   *
   * `touch-action: manipulation` on a card means the browser is willing to pan
   * from it — which is the whole point of the hold, and is also why it would
   * happily pan out from under a card that has just been lifted. A touchmove is
   * cancelable only until the pan actually begins, and the pan cannot have
   * begun yet: the finger has been still for HOLD_MS. So the FIRST move after
   * the lift is both the last chance to say no and a guaranteed one.
   *
   * Non-passive by necessity, and registered only for the length of a touch
   * gesture, so the board never taxes ordinary scrolling with a listener.
   */
  const onWindowTouchMove = useCallback((ev: TouchEvent) => {
    if (!isHeld(sessionRef.current)) return
    if (ev.cancelable) ev.preventDefault()
  }, [])

  /**
   * A long press on a phone otherwise means "select this text" (both engines)
   * and "open the context menu" (Android, at around 500ms — which is why the
   * lift at 420ms wins the race and this is the belt to that braces).
   *
   * Both are suppressed for the whole touch gesture rather than only once the
   * hold has landed: a caret that appears at 300ms and is dismissed at 420ms is
   * a flicker, and the user pressing a card never meant either of them.
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
      window.removeEventListener('touchmove', onWindowTouchMove)
      window.removeEventListener('selectstart', onWindowSuppress)
      window.removeEventListener('contextmenu', onWindowSuppress)
      if (holdTimerRef.current !== null) {
        // A press that ended — by release, by pan, or by the route unmounting —
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
        announce(t('board.dragCancelled'))
        return
      }
      // Announced at RELEASE rather than after the store settles: the motion is
      // the feedback for everyone who can see it, and this is the sentence for
      // everyone who cannot. A failure replaces it with errMove.
      announce(t('board.dropped', { column: labelRef.current(drop.toId) }))
      void moveRef.current(drop.itemId, drop.toId, 'drag')
    },
    [
      announce,
      onWindowCancel,
      onWindowKey,
      onWindowMove,
      onWindowSuppress,
      onWindowTouchMove,
      onWindowUp,
    ],
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
      window.addEventListener('keydown', onWindowKey)

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
        // behind a setting — a board must not depend on a buzz nobody gets, and
        // the card's own squeeze-then-lift is the feedback that always lands.
        if (typeof navigator.vibrate === 'function') navigator.vibrate(8)
        beginDrag(next)
      }, HOLD_MS)
    },
    [
      beginDrag,
      measureZones,
      onWindowCancel,
      onWindowKey,
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
    const step = arrowStep(ev.key, readDir())
    // A card parked in a retired bucket has no position on the live axis, so
    // the arrows have nothing to step from. A digit still names a column
    // outright, which is how you get such a card back onto the board.
    if (step !== 0 && at < 0) return

    const index =
      step !== 0 ? moveIndex(at, step, columns.length) : indexFromDigit(ev.key, columns.length)
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

  /**
   * The card's own StatusPill. ALWAYS a status change, whatever the column axis
   * is — see the file header. Under the status axis it is the accessible move
   * path; under the others it edits a field without leaving the column.
   */
  const handleMenuMove = useCallback((id: string, status: EntryStatus) => {
    focusAfterMove.current = id
    void moveRef.current(id, status, 'key')
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
   *
   * Esc and Cancel both unmount the <form> the focused <input> lives in. The
   * button that opened it stays mounted, but nothing was refocusing it, so
   * focus fell to <body> and the next Tab restarted at the top of the document
   * — WCAG 2.4.3, and a direct contradiction of the success path two callbacks
   * down, which refocuses on purpose so the next card can be typed straight in.
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
   * Close it and give the keyboard somewhere to be.
   *
   * The focus call comes BEFORE the state change on purpose: React batches the
   * re-render to the end of the event handler, so the `+` button is still the
   * live DOM node here and focusing it now means the input unmounts from an
   * element that is no longer focused. Nothing flickers and no effect is needed.
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
      // is the whole point of a composer that lives in the column. The explicit
      // refocus is for the CLICK path — the submit button disables itself the
      // moment the draft empties, and a disabled control drops focus to the
      // body, which is where a keyboard user would then be stranded.
      setDraft('')
      composerRef.current?.focus()
      announce(t('board.quickAddDone', { title, column: column.label }))
    },
    [adding, draft, announce],
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
  const draggedTitle =
    dragView === null ? '' : (entryMap.get(dragView.itemId)?.title ?? '')

  const renderCards = (column: BoardColumn, slot: ReactNode): ReactElement => {
    const total = column.entries.length
    const open = unfolded.has(column.key)
    const shown = open ? column.entries : column.entries.slice(0, maxCards)
    const hidden = total - shown.length

    return (
      <>
        <ul
          className="bd-cards"
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

  /** The count pill and the SLA badge — the two facts a column header carries. */
  const renderCounts = (column: BoardColumn): ReactElement => (
    <>
      {/* The digit is for the eye; the label is for everyone else. A bare "2"
          beside a heading announces as "2" and means nothing — `role="img"` +
          aria-label is the same trick the entry kit's own pills use to give a
          glyph a sentence. */}
      <span
        className="pill bd-col-count tabular"
        role="img"
        aria-label={t('board.columnCountLabel', { count: column.entries.length })}
      >
        {t('board.columnCount', { count: column.entries.length })}
      </span>
      {column.breached > 0 ? (
        <span
          className="pill bd-sla tabular"
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
        className="bd-col"
        data-dim={dimension}
        data-over={over ? 'true' : undefined}
        data-collapsed={collapsed ? 'true' : undefined}
        style={column.vars}
        aria-label={t('board.column', { column: column.label })}
      >
        {collapsed ? (
          <button
            type="button"
            className="bd-rail"
            aria-expanded={false}
            // The label is rotated to fit a 56px rail, which is legible but not
            // comfortable; the tooltip is the sighted reader's equivalent of the
            // aria-label everyone else already gets.
            title={column.label}
            // The count rides IN the label because an aria-label on a button
            // replaces its contents wholesale — the pill inside would otherwise
            // be announced to nobody.
            aria-label={t('board.expandColumn', {
              column: column.label,
              count: column.entries.length,
            })}
            onClick={() => toggleCollapsed(dimension, column.key)}
          >
            <span className="pill bd-col-count tabular" aria-hidden="true">
              {t('board.columnCount', { count: column.entries.length })}
            </span>
            <span className="bd-rail-label" aria-hidden="true">
              {column.label}
            </span>
          </button>
        ) : (
          <>
            <header className="bd-col-head">
              <button
                type="button"
                className="bd-col-fold"
                aria-expanded
                aria-label={t('board.collapseColumn', {
                  column: column.label,
                  count: column.entries.length,
                })}
                onClick={() => toggleCollapsed(dimension, column.key)}
              >
                <IconChevronDown size={16} className="bd-caret" />
              </button>
              {columnMark(column)}
              <h3 className="bd-col-title">{column.label}</h3>
              {renderCounts(column)}
              {canCreate ? (
                <button
                  ref={(el) => {
                    registerAdd(column.key, el)
                  }}
                  type="button"
                  className="bd-col-add"
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
                className="bd-add"
                onSubmit={(ev) => {
                  ev.preventDefault()
                  void submitAdd(column)
                }}
              >
                <input
                  ref={composerRef}
                  className="input bd-add-input"
                  type="text"
                  value={draft}
                  maxLength={200}
                  aria-label={t('board.quickAdd', { column: column.label })}
                  placeholder={t('board.quickAddPlaceholder')}
                  onChange={(ev) => setDraft(ev.target.value)}
                  onKeyDown={(ev) => {
                    if (ev.key !== 'Escape') return
                    // Stopped, not just prevented: Escape also cancels a drag
                    // from the window listener, and closing a composer must not
                    // read as abandoning a gesture nobody started.
                    ev.stopPropagation()
                    closeComposer(column.key)
                  }}
                />
                <div className="bd-add-row">
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
                <p className="bd-add-hint">{t('board.quickAddHint')}</p>
              </form>
            ) : null}

            {column.entries.length === 0 && !over ? (
              <div className="bd-col-empty">
                <p className="bd-col-empty-title">
                  {t(COLUMN_EMPTY[dimension], { column: column.label })}
                </p>
                <p className="bd-col-empty-hint">{t('board.columnEmptyHint')}</p>
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
                  <li className="bd-slot" aria-hidden="true">
                    <span className="bd-slot-title">{draggedTitle}</span>
                    <span className="bd-slot-hint">{t('board.dropTop')}</span>
                  </li>
                ) : null,
              )
            )}
          </>
        )}
      </section>
    )
  }

  // A filtered board that admits nothing needs a way back out; an EMPTY
  // workspace needs the columns, because the quick-add composer lives in them
  // and an empty state would be a dead end on day one.
  const filtered = !isFilterEmpty(filter)
  const showEmpty = !loading && errorKey === null && entries.length === 0 && filtered

  return (
    <div
      className="bd"
      data-density={density}
      // Read by board.css for exactly one rule: a mandatory scroll-snap and a
      // per-frame `scrollLeft` are two things steering one scroller, and the
      // snap wins — the phone's edge auto-scroll would be dragged back to the
      // nearest column every frame. Snapping resumes the moment the card lands.
      data-dragging={dragView !== null ? 'true' : undefined}
      ref={boardRef}
      onKeyDown={onBoardKeyDown}
      onClickCapture={onClickCapture}
    >
      <p className="bd-sub">{t('board.subtitle')}</p>

      <FilterBar
        value={filter}
        onChange={onFilterChange}
        facets={facets}
        tags={tagOptions}
        count={entries.length}
        resultLabel={(n) => t('board.total', { count: n })}
        tagHint={t('board.closedWindow', { count: CLOSED_WINDOW_DAYS })}
      />

      <div className="bd-bar">
        <div className="chip-row bd-group" role="group" aria-label={t('board.groupBy')}>
          <span className="bd-group-label" aria-hidden="true">
            {t('board.groupBy')}
          </span>
          {DIMENSIONS.map((option) => (
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

        <div className="chip-row bd-group bd-density" role="group" aria-label={t('board.density')}>
          <span className="bd-group-label" aria-hidden="true">
            {t('board.density')}
          </span>
          {DENSITIES.map((option) => (
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
          className="btn btn-sm btn-ghost bd-refresh"
          onClick={() => void refreshEntries()}
        >
          {t('board.refresh')}
        </button>
      </div>

      {/* Two sentences, one shown: the gesture a phone offers is not the
          gesture a mouse offers, and a hint that describes the wrong one is
          worse than none. The choice is a media query rather than a matchMedia
          read because it must survive a window being dragged onto a touch
          screen mid-session, and because `display: none` is the one way to
          hide a string from a screen reader as well as from an eye. */}
      <p className="bd-hint bd-hint-fine">{t('board.dragHint')}</p>
      <p className="bd-hint bd-hint-touch">{t('board.holdHint')}</p>
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
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => onFilterChange({ ...EMPTY_FILTER })}
            >
              {t('filter.clearAll')}
            </button>
          }
        />
      ) : (
        <>
          <div className="bd-scroller" ref={scrollerRef}>
            <div className="bd-cols" role="group" aria-label={t('board.title')}>
              {live.map(renderColumn)}
            </div>
          </div>

          {overflow.length > 0 ? (
            <section className="bd-overflow" aria-label={t(OVERFLOW_TITLE[dimension])}>
              <h3 className="bd-overflow-title">{t(OVERFLOW_TITLE[dimension])}</h3>
              <p className="bd-overflow-hint">{t('board.overflowHint')}</p>
              <ul className="bd-overflow-list">
                {overflow.map((column) => {
                  const open = expandedOverflow.has(column.key)
                  return (
                    <li key={column.key} className="bd-overflow-item" style={column.vars}>
                      <button
                        type="button"
                        className="bd-overflow-toggle"
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
                        <span className="bd-overflow-label">{column.label}</span>
                        {renderCounts(column)}
                      </button>
                      {open ? (
                        <div className="bd-overflow-cards">{renderCards(column, null)}</div>
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
      className="bd-card"
      data-entry-id={entry.id}
      data-enter={enter?.kind}
      // The grab cursor is the pointer half of "this card can be moved", and it
      // has to be conditional for the same reason the drag handler is: a card
      // this reader may not edit must not advertise a gesture the server would
      // refuse. On touch the same fact is carried by the press animation.
      data-draggable={canEdit ? 'true' : undefined}
      data-press={pressed ? 'true' : undefined}
      // Physical, and resolved from `dir` by the board — CSS has no logical
      // transform, and the sign is a fact this screen already holds.
      style={enter && enter.slide !== 0 ? ({ '--bd-slide': `${enter.slide}px` } as CSSProperties) : undefined}
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
