// The board's column model, as values.
//
// THE COLUMN AXIS IS A CHOICE, NOT A CONSTANT. Status is what everybody means
// by "kanban", but the same cards band by track, by owner or by priority, and a
// drag along each of those axes is a re-file, a re-assignment or a
// re-prioritisation. Exactly ONE function here knows which — `patchFor()`.
// Everything else is written against an opaque column key, which is why a fifth
// axis is a row in BOARD_DIMENSIONS plus a case in three switches rather than a
// second board.
//
// WHY THIS IS A PURE MODULE. `pages/Board.tsx` held all of it inline and could
// only be tested through a server render, so the axis had to be reached by
// seeding localStorage and the arrival diff could not be reached at all. §3.7
// — `src/lib/**` may not import `src/store/**` or `src/api/**`; the LABELS
// therefore arrive as arguments, because they come from the vocabulary, the
// track list and the member list, all of which live in stores.
//
// COLUMNS COME FROM THE VOCABULARY, not from the frozen unions, so an admin's
// rename and reorder cost nothing. Options they retired, tracks they archived
// and free-text owners who were never members all leave the board — but only
// as COLUMNS: a bucket that still holds entries goes to the overflow rail,
// because hiding an option must never hide data. You can drag work OUT of a
// retired bucket; you cannot drag it in, which is the point of retiring one.

import type { CSSProperties } from 'react'
import type { Entry, EntryPatch, EntryPriority, EntryStatus, NewEntry } from '../../types'

/** Which dimension the columns are cut along. */
export type BoardDim = 'status' | 'track' | 'owner' | 'priority'

export type BoardDensity = 'comfortable' | 'compact'

/**
 * How far back the Done and Cancelled columns reach.
 *
 * Everything ever closed would grow without bound on a log nothing deletes,
 * and a Done column showing two years is an archive rather than a board. Two
 * weeks is "what this team finished recently", and it is read under every
 * axis: "what did Layla finish this fortnight" is the owner columns' version
 * of the same question.
 */
export const CLOSED_WINDOW_DAYS = 14

/**
 * Cards rendered per column before the fold, per density.
 *
 * A column with 300 items is not read, it is scrolled past — and rendering all
 * of them costs a phone its frame budget on every drag. The header count is
 * always the TRUE total, so the fold hides cards, never facts.
 */
export const MAX_CARDS: Readonly<Record<BoardDensity, number>> = Object.freeze({
  comfortable: 25,
  compact: 40,
})

/** The bucket key for "no value" — untracked, unassigned. Never a real id. */
export const NO_VALUE = ''

/**
 * Prefix for an owner bucket that is free text rather than a member.
 *
 * Vendors own real work, so it stays visible and draggable onto a teammate;
 * the bucket never accepts a drop, because assigning TO a vendor means typing
 * a name and a board has nowhere to type.
 */
export const NAME_PREFIX = 'name:'

/** localStorage record of the three choices that outlive a reload. */
export const BOARD_PREFS_KEY = 'nphiescore_board_v1'

export const BOARD_DIMENSIONS: readonly { key: BoardDim; labelKey: string }[] = Object.freeze([
  { key: 'status', labelKey: 'board.groupStatus' },
  { key: 'track', labelKey: 'board.groupTrack' },
  { key: 'owner', labelKey: 'board.groupOwner' },
  { key: 'priority', labelKey: 'board.groupPriority' },
] as const)

export const BOARD_DENSITIES: readonly { key: BoardDensity; labelKey: string }[] = Object.freeze([
  { key: 'comfortable', labelKey: 'board.densityComfortable' },
  { key: 'compact', labelKey: 'board.densityCompact' },
] as const)

/**
 * The overflow rail's heading, per axis, and what an empty column says.
 *
 * Literal Records rather than a template literal, which has no key until it
 * runs and so ships missing in one language. The empty lines cannot be one
 * shared sentence either: "Nothing in Blocked" reads, "Nothing in Layla" does
 * not — which is why the owner line drops the name.
 */
export const OVERFLOW_TITLE: Readonly<Record<BoardDim, string>> = Object.freeze({
  status: 'board.overflowStatus',
  track: 'board.overflowTrack',
  owner: 'board.overflowOwner',
  priority: 'board.overflowPriority',
})

export const COLUMN_EMPTY: Readonly<Record<BoardDim, string>> = Object.freeze({
  status: 'board.columnEmptyStatus',
  track: 'board.columnEmptyTrack',
  owner: 'board.columnEmptyOwner',
  priority: 'board.columnEmptyPriority',
})

export function isBoardDim(v: unknown): v is BoardDim {
  return BOARD_DIMENSIONS.some((d) => d.key === v)
}

/** One declared column, before its entries are hung on it. */
export interface BoardColumnDef {
  /** The dimension value. `NO_VALUE` for the untracked/unassigned bucket. */
  readonly key: string
  readonly label: string
  /** Inline custom properties painting this column's accent, or `{}`. */
  readonly vars: CSSProperties
  /** Source only. Lives in the overflow rail and never accepts a drop. */
  readonly retired: boolean
}

export interface BoardColumn extends BoardColumnDef {
  readonly entries: readonly Entry[]
  /** How many of this column's cards are past their SLA. */
  readonly breached: number
}

export interface BoardSplit {
  readonly live: readonly BoardColumn[]
  readonly overflow: readonly BoardColumn[]
  /** entry id → the column key it is in. The input to `enterDiff`. */
  readonly membership: ReadonlyMap<string, string>
}

/** Which column an entry belongs to, on a given axis. */
export function bucketOf(e: Entry, dim: BoardDim): string {
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
export function patchFor(dim: BoardDim, key: string): EntryPatch | null {
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
export function seedFor(dim: BoardDim, key: string): Partial<NewEntry> {
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
 * Hang the entries on the declared columns, and rescue whatever they do not
 * declare — an archived track, a deleted member, a free-text vendor, a key
 * from a build that knew one more option. All source-only: a retired bucket
 * with work goes to the overflow rail, and one holding nothing is genuinely
 * gone.
 */
export function splitColumns(input: {
  entries: readonly Entry[]
  dim: BoardDim
  defs: readonly BoardColumnDef[]
  /** Is this entry past its SLA? Read from the health map by the caller. */
  isBreached: (entryId: string) => boolean
  residual: (key: string) => { label: string; vars: CSSProperties }
}): BoardSplit {
  const buckets = new Map<string, Entry[]>()
  const membership = new Map<string, string>()
  for (const entry of input.entries) {
    const key = bucketOf(entry, input.dim)
    membership.set(entry.id, key)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(entry)
    else buckets.set(key, [entry])
  }

  const defs: BoardColumnDef[] = [...input.defs]
  const declared = new Set(defs.map((d) => d.key))
  for (const key of buckets.keys()) {
    if (declared.has(key)) continue
    const { label, vars } = input.residual(key)
    defs.push({ key, label, vars, retired: true })
  }

  const live: BoardColumn[] = []
  const overflow: BoardColumn[] = []
  for (const def of defs) {
    const held = buckets.get(def.key) ?? NO_ENTRIES
    let breached = 0
    for (const entry of held) if (input.isBreached(entry.id)) breached += 1
    const column: BoardColumn = { ...def, entries: held, breached }
    if (!def.retired) live.push(column)
    else if (held.length > 0) overflow.push(column)
  }
  return { live, overflow, membership }
}

/** Nothing is ever pushed into this; one shared empty array keeps deps stable. */
const NO_ENTRIES: readonly Entry[] = Object.freeze([])

/* ────────────────────────────── preferences ────────────────────────────── */

export interface BoardPrefs {
  readonly dimension: BoardDim
  readonly density: BoardDensity
  /**
   * Collapsed column keys, PER DIMENSION. A track id means nothing to the
   * status axis, and one flat list would produce phantom collapsed columns the
   * first time the reader switched axis and back.
   */
  readonly collapsed: Readonly<Record<string, readonly string[]>>
}

export const DEFAULT_BOARD_PREFS: BoardPrefs = Object.freeze({
  dimension: 'status',
  density: 'comfortable',
  collapsed: Object.freeze({}),
})

/**
 * Read the persisted choices out of whatever storage handed back.
 *
 * Every field is validated rather than trusted: user-writable storage outlives
 * a schema, and a stale `dimension: 'assignee'` must degrade to the default
 * rather than render zero columns. Takes the RAW STRING, so the module stays
 * pure and a test needs no shim.
 */
export function parseBoardPrefs(raw: string | null): BoardPrefs {
  if (raw === null) return DEFAULT_BOARD_PREFS
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // A half-written value. A board that throws on mount because a preference
    // is malformed is worse than a default board.
    return DEFAULT_BOARD_PREFS
  }
  if (typeof parsed !== 'object' || parsed === null) return DEFAULT_BOARD_PREFS
  const rec = parsed as Record<string, unknown>
  const collapsed: Record<string, string[]> = {}
  if (typeof rec.collapsed === 'object' && rec.collapsed !== null) {
    for (const [dim, keys] of Object.entries(rec.collapsed as Record<string, unknown>)) {
      if (Array.isArray(keys)) collapsed[dim] = keys.filter((k): k is string => typeof k === 'string')
    }
  }
  return {
    dimension: isBoardDim(rec.dimension) ? rec.dimension : DEFAULT_BOARD_PREFS.dimension,
    density: rec.density === 'compact' ? 'compact' : 'comfortable',
    collapsed,
  }
}

/** Collapse or expand one column ON ONE AXIS, leaving every other axis alone. */
export function toggleCollapsed(prefs: BoardPrefs, dim: BoardDim, key: string): BoardPrefs {
  const current = prefs.collapsed[dim] ?? []
  const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key]
  return { ...prefs, collapsed: { ...prefs.collapsed, [dim]: next } }
}

export function collapsedFor(prefs: BoardPrefs, dim: BoardDim): ReadonlySet<string> {
  return new Set(prefs.collapsed[dim] ?? [])
}

/* ─────────────────────────── the arrival motion ────────────────────────── */

/** One card's arrival animation, resolved by the board and read by CSS. */
export interface CardEnter {
  readonly kind: 'new' | 'moved' | 'landed'
  /** Physical px offset to slide in from. 0 for a card that did not travel. */
  readonly slide: number
}

/**
 * Above this many cards changing column at once, nothing animates. A filter
 * change, a first load or an axis switch re-buckets everything, and forty
 * animating cards is a screen that convulses on every keystroke.
 */
export const ENTER_BURST_MAX = 6

/** How far a card slides in from, in px. Physical — the sign is `rtl`. */
export const ENTER_SLIDE_PX = 14

export interface EnterDiff {
  readonly enter: ReadonlyMap<string, CardEnter>
  /** Too many at once to be an event. The caller animates nothing. */
  readonly burst: boolean
}

/**
 * Which cards arrived somewhere new, and how each should read. `landed` is
 * this reader's own move and springs; `moved` is somebody else's and slides in
 * from the direction it came from; `new` did not exist a moment ago. Two
 * membership snapshots, one Map walk, no layout read.
 *
 * `sign` is the direction multiplier (-1 in RTL): CSS has no logical
 * transform, so the slide is physical and the caller already holds the fact.
 */
export function enterDiff(input: {
  prev: ReadonlyMap<string, string>
  next: ReadonlyMap<string, string>
  /** column key → its index in the live order. */
  order: ReadonlyMap<string, number>
  sign: 1 | -1
  /** Ids this reader moved. Read only — the caller clears its own set. */
  mine: ReadonlySet<string>
}): EnterDiff {
  const enter = new Map<string, CardEnter>()
  for (const [id, key] of input.next) {
    const was = input.prev.get(id)
    if (was === key) continue
    if (was === undefined) {
      enter.set(id, { kind: 'new', slide: 0 })
      continue
    }
    const from = input.order.get(was)
    const to = input.order.get(key)
    const travel = from === undefined || to === undefined ? 0 : Math.sign(to - from) * input.sign
    enter.set(id, {
      kind: input.mine.has(id) ? 'landed' : 'moved',
      // `travel === 0` spelled out rather than left to arithmetic: `-0 * n` is
      // negative zero, which reads as a direction in a snapshot and is not one.
      slide: travel === 0 ? 0 : -travel * ENTER_SLIDE_PX,
    })
  }
  return { enter, burst: enter.size > ENTER_BURST_MAX }
}
