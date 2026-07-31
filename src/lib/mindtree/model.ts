// The Mindtree's MODEL: the working set in, one `MindNode` tree out.
//
// The map answers a different question from /tracks. The list asks "what is
// open, and who has it?"; the map asks "what is the SHAPE of my workload?" —
// where the mass sits, which track is bloated, what is going red. That question
// is answered entirely by COUNTS AND A ROLL-UP, which is why this module exists
// separately from anything that draws: the arithmetic is the feature, and it is
// testable without a pixel, a store or a clock.
//
// PURE BY CONSTRUCTION, the same contract lib/entryFilter.ts and lib/health.ts
// hold. Nothing here reads a store, a clock, a locale or `t()`. Every input
// arrives as plain data, including the labels that had to be resolved against a
// locale (track names, vocabulary labels, member names) — those are resolved by
// the CALLER, inside React, where `useLocale()` has a subscription to hang the
// re-render off. `lib/**` may not import `src/store/**` or `src/api/**`, so the
// three input shapes below are declared structurally rather than imported;
// `Track`-shaped and `Member`-shaped rows are assignable to them after the small
// mapping the page performs (see the handoff note).
//
// The only React in the import graph is `CSSProperties`, a TYPE, erased under
// verbatimModuleSyntax — `lib/trackStyle.ts` does the same. Nothing here renders.
//
// TWO RULES THAT DRIVE EVERY DECISION BELOW:
//
//  1. THE FILTER IS APPLIED BEFORE GROUPING. `buildMindtree` filters the working
//     set itself (through the shared `selectEntries`, so leaf order follows the
//     sort the user chose in the FilterBar) and then buckets what survives. A
//     caller must therefore hand over the RAW list, never a pre-filtered one.
//     Grouping first and filtering the leaves afterwards is how a branch ends up
//     labelled 12 while showing 3, which is the single worst thing a map like
//     this can do: the whole point is that the number is trustworthy at a glance.
//
//  2. COUNTS ROLL UP AND SO DOES THE BREACH. Every branch's `count` is exactly
//     the sum of its children's, all the way to the root, and a branch is
//     `slaBreached` when ANY descendant entry is. A breach hidden behind a
//     "+5 more" still marks the branch — an escalation that only becomes visible
//     once you expand the right node is an escalation nobody sees.
//
// COLOUR IS INHERITED, NEVER PICKED. A node carries `colourVars` — the custom
// property pair from `trackVars()` — and every descendant of a track carries the
// same pair, so a whole branch reads as one colour family. There is no JS colour
// pick anywhere in this file and there must never be one: lib/trackStyle.ts's
// header documents why (a hex chosen in JavaScript is chosen once, at render,
// and keeps yesterday's colour when the `auto` theme flips at sunset). The
// dimension ring does NOT introduce a second colour: the spec's budget is two
// visual variables — size for count, a mark for the breach — and a third would
// turn a map you can read in one glance into a legend you have to study.

import type { CSSProperties } from 'react'
import { HEALTH_ORDER } from '../aggregate'
import { selectEntries, type FilterContext, type FilterState } from '../entryFilter'
import { normalizeSearch } from '../text'
import { trackVars } from '../trackStyle'
import type { Entry, EntryHealth, HealthLevel } from '../../types'

// ── the axis ───────────────────────────────────────────────────────────────

/**
 * Ring 2's cut. `track` is deliberately absent — it is already ring 1, and an
 * axis that repeated it would produce a tree one node wide.
 */
export type MindDimension = 'status' | 'owner' | 'priority' | 'health'

/**
 * The switcher's rows, in reading order, with their labels.
 *
 * It lives here rather than in the page because the union lives here: a fifth
 * dimension has to be a member, a row and a `groupsFor` case, and keeping the
 * first two in one file is what makes the third impossible to forget. Written as
 * literal keys rather than `t(\`mindtree.dim${key}\`)` so lib/localeReach.test.ts
 * can see them — a template literal has no key until it runs.
 */
export const MIND_DIMENSIONS: readonly { key: MindDimension; labelKey: string }[] = [
  { key: 'status', labelKey: 'mindtree.dimStatus' },
  { key: 'owner', labelKey: 'mindtree.dimOwner' },
  { key: 'priority', labelKey: 'mindtree.dimPriority' },
  { key: 'health', labelKey: 'mindtree.dimHealth' },
]

/**
 * The guard a persisted preference must pass. `localStorage` is user-writable
 * and outlives a schema change, so a stale `dimension: 'assignee'` from a future
 * build has to degrade to the default rather than render an empty ring — the
 * same reasoning pages/Board.tsx's `isDim` is built on.
 */
export function isMindDimension(v: unknown): v is MindDimension {
  return MIND_DIMENSIONS.some((d) => d.key === v)
}

// ── the node ───────────────────────────────────────────────────────────────

export type MindNodeKind = 'root' | 'track' | 'group' | 'entry' | 'more'

/**
 * A node's label is EITHER an i18n key the renderer passes through `t()`, OR a
 * literal that came out of the database — a track name, a person's name, an
 * entry title — which must never be translated and must be wrapped in a bidi
 * isolate (`lib/bidi.isolate`) before it lands next to a number or a count.
 *
 * A discriminated union rather than two optional fields, because "which of these
 * two is set" is a question a renderer must not be able to get wrong: an Arabic
 * track name accidentally handed to `t()` renders as its own text (t() echoes an
 * unknown key), and an English key accidentally rendered raw shows a dot path.
 */
export type MindLabel =
  | { readonly kind: 'key'; readonly key: string; readonly vars?: Readonly<Record<string, string | number>> }
  | { readonly kind: 'text'; readonly text: string }

/**
 * The health verdict for a whole subtree.
 *
 * `levels` is a counter per HealthLevel and sums to the node's `count`, so a
 * branch can be drawn as a stacked mark without a second pass over the entries.
 * A `Record<HealthLevel, number>` rather than four named fields for the reason
 * lib/aggregate.ts uses the same shape: the union is frozen in types.ts, and a
 * fifth member should red this file at compile time rather than silently drop a
 * segment.
 */
export interface MindHealth {
  levels: Record<HealthLevel, number>
  /**
   * True when ANY descendant entry is past its SLA — see rule 2 in the header.
   * Never a count: the mark is binary, and "3 breached" is a number the table
   * carries, not a thing the map has budget to draw.
   */
  slaBreached: boolean
}

export interface MindNode {
  /**
   * A path — `root/track:<id>/group:<key>/entry:<id>`. Stable across rebuilds
   * for the same data, which is what lets it key React children, address a
   * `collapsedIds` entry that outlives a reload, and serve as a DOM id for
   * `aria-activedescendant`.
   *
   * Every dynamic segment is percent-encoded, because a free-text owner is
   * arbitrary user text: a name containing a space would be an invalid DOM id,
   * and one containing a `/` would forge a path that collides with a real node.
   */
  id: string
  kind: MindNodeKind
  label: MindLabel
  /** Entries at or under this node, AFTER the filter. Sums the children's. */
  count: number
  /** The branch's track colour pair. `{}` for the root and the untracked pile. */
  colourVars: CSSProperties
  health: MindHealth
  /**
   * ALWAYS the full child list, even when `collapsed`. Collapsing is a RENDERING
   * decision, not a pruning one: the accessible table walks this tree and must
   * carry the same numbers as the picture, and `aria-expanded` on a branch is
   * only meaningful if the branch still knows it has children. Renderers call
   * `visibleChildren()`; nobody else reads `collapsed` at all.
   */
  children: MindNode[]
  /** False whenever `children` is empty — a leaf must not claim to be collapsed. */
  collapsed: boolean
  /** 0 root · 1 track · 2 group · 3 entry or "+N more" · 4 an entry under it. */
  depth: number
  /** `kind: 'entry'` only — the id `openEntry()` wants. Null everywhere else. */
  entryId: string | null
  /** The raw bucket value behind a track or group node (a track id, a status
   *  key, an owner key). Null for root, entry and more. Lets a caller turn a
   *  clicked branch into a filter facet without parsing the id back apart. */
  bucketKey: string | null
  /**
   * A bucket the workspace has retired — a hidden vocabulary option, an archived
   * track, an owner id no longer in the roster — that STILL HOLDS WORK.
   *
   * It is rendered, and that is not a bug. store/vocab.ts's frozen rule is that
   * hiding an option must never hide data, and this tree has a second reason of
   * its own: dropping a populated bucket would break the roll-up, and a parent
   * labelled 12 whose children sum to 9 is worse than a greyed-out branch.
   */
  retired: boolean
}

/**
 * What a renderer, a layout pass and a keyboard walker must all agree to show.
 *
 * One line, exported, because four consumers deriving "collapsed means no
 * children" independently is four chances to disagree about it — and a tree
 * whose picture, layout and arrow keys disagree about which nodes exist is
 * unusable in exactly the way a screen reader exposes first.
 */
export function visibleChildren(node: MindNode): readonly MindNode[] {
  return node.collapsed ? EMPTY_CHILDREN : node.children
}

const EMPTY_CHILDREN: readonly MindNode[] = Object.freeze([])

/** The root's id, and the anchor every other id hangs off. */
export const ROOT_ID = 'root'

// ── inputs ─────────────────────────────────────────────────────────────────
//
// Structural shapes, not imports. `lib/**` may not reach into `store/**` or
// `api/**`, and the labels have to be resolved against the active locale by a
// caller that React can re-render — so the page maps its rows down to these.

/**
 * One track, with its name ALREADY resolved for the locale.
 *
 * `archived` arrives rather than being filtered out by the caller because both
 * halves matter here: active tracks are ring 1 whether or not they hold work,
 * and an archived track that still holds work has to appear as a retired branch
 * or its entries vanish from a map that claims to total the workspace.
 */
export interface MindTrack {
  id: string
  /** `lib/labels.trackLabel(track, locale)` — never the raw `name` column. */
  label: string
  /** `tracks.color` — the dark-theme hex. */
  color: string
  /** `tracks.color_light`, nullable; `trackVars()` falls back to `color`. */
  colorLight: string | null
  sortOrder: number
  archived: boolean
}

/**
 * One vocabulary option for the ACTIVE dimension, already resolved for the
 * locale — pass `useVocabAll(dimension)`, not `useVocab(dimension)`.
 *
 * The `All` matters: `useVocab` drops hidden options, and an entry still holding
 * a hidden status would then arrive here as an undeclared value and render as
 * "Unknown". Hidden options are handled below, by name.
 *
 * `store/vocab.VocabItem` is assignable as-is; the extra fields are ignored.
 */
export interface MindVocabOption {
  key: string
  label: string
  hidden: boolean
}

/**
 * One member of the roster. `api/members.Member` is assignable as-is.
 *
 * Only the id and the name: this module decides which BUCKET an entry lands in
 * and what order the buckets read in, and nothing else about a person.
 */
export interface MindMember {
  id: string
  displayName: string
}

export interface MindtreeInput {
  /** The RAW working set — `useEntryList()`. Filtering happens here (rule 1). */
  entries: Entry[]
  /** `useHealthMap()`. A missing row reads as 'ok'; see levelOf(). */
  health: ReadonlyMap<string, EntryHealth>
  /** EVERY track, archived included — `useTracks()`. */
  tracks: readonly MindTrack[]
  /** The active dimension's options, or `[]` for owner and health. */
  vocab: readonly MindVocabOption[]
  /** The roster, in display order — `useMembers()`. */
  members: readonly MindMember[]
  dimension: MindDimension
  filter: FilterState
  /**
   * `me` and `today`, the two values a filter needs and cannot know. Present
   * because `matchesFilter` needs them and this module must stay clockless —
   * `useFilterContext()` supplies it.
   */
  ctx: FilterContext
  /** Node ids the user has EXPLICITLY closed. Persisted per dimension by the
   *  caller, and the higher authority: it beats `openDepth` below. */
  collapsedIds: ReadonlySet<string>
  /** How many leaves a group shows before a "+N more" node takes the tail. */
  leafThreshold: number
  /** Node ids the user has EXPLICITLY opened — a "+N more" fold, or a branch
   *  that `openDepth` would otherwise have started closed. */
  expandedIds?: ReadonlySet<string>
  /**
   * THE RING THE MAP OPENS AT, and the single most consequential number in this
   * module. A branch at depth >= `openDepth` starts CLOSED unless the reader
   * opened it; omit it (the default) and every branch starts open, which is
   * what the first cut shipped.
   *
   * It shipped that way because MINDTREE-SPEC's "collapsed by default beyond a
   * threshold" reads as a statement about ring 3, and at fixture volume it is.
   * At real volume it is not, and the arithmetic is not close. The map is
   * fitted into a canvas roughly 520 CSS px tall; the tidy tree stacks siblings
   * along that axis at `nodeSize.height + gap.sibling` = 56 units each. Six
   * tracks × five populated statuses is thirty group nodes = 1680 units, which
   * fits at 0.31 — and 0.31 renders the 12.5px label at 3.9 px. Opening at the
   * TRACK ring instead is six nodes = 336 units, which fits at 1:1 with
   * full-size labels, and six size-encoded cards with their counts IS the shape
   * answer the screen exists to give. Ring 2 is one keystroke away.
   *
   * A depth, not a set of ids, because the caller cannot enumerate the ids it
   * would need: they come out of this function. (Collapsing changes no ids —
   * `children` is always the full list — but a caller deriving the set would
   * still have to build the tree twice.)
   */
  openDepth?: number
}

// ── bucket keys ────────────────────────────────────────────────────────────

/**
 * The "no value" bucket — untracked, unassigned. Never a real id, because every
 * id in this schema is a uuid. The same stand-in pages/Board.tsx uses (NO_VALUE)
 * and lib/aggregate.ts uses in `loadPerOwner`, deliberately: three modules
 * bucketing the same rows must produce the same keys or the board, the dashboard
 * and the map disagree about who owns what.
 */
const NO_VALUE = ''

/** Prefix for an owner bucket that is free text rather than a member. Mirrors
 *  Board's NAME_PREFIX and `loadPerOwner`'s key shape. */
const NAME_PREFIX = 'name:'

/** i18n keys for the health axis. A lookup table, not `health.${level}`, so
 *  localeReach.test.ts can see the four keys without enumerating a family. */
const HEALTH_LABEL: Readonly<Record<HealthLevel, string>> = {
  ok: 'health.ok',
  stale: 'health.stale',
  overdue: 'health.overdue',
  critical: 'health.critical',
}

// ── small helpers ──────────────────────────────────────────────────────────

function keyLabel(key: string, vars?: Record<string, string | number>): MindLabel {
  return vars ? { kind: 'key', key, vars } : { kind: 'key', key }
}

function textLabel(text: string): MindLabel {
  return { kind: 'text', text }
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const held = map.get(key)
  if (held) held.push(value)
  else map.set(key, [value])
}

/**
 * A node id. Every dynamic segment is percent-encoded — see MindNode.id for the
 * two failures that prevents (an invalid DOM id, and a forged path).
 */
function nodeId(parent: string, kind: string, key: string): string {
  return `${parent}/${kind}:${encodeURIComponent(key)}`
}

/**
 * The health verdict for a row, defaulting to 'ok'.
 *
 * A missing map entry is 'ok' rather than a fifth "unknown" level, exactly as
 * lib/aggregate.healthOf decides it: the view returns no row for a closed entry
 * and has not yet answered for an optimistic one, and inventing an unknown
 * bucket would put a grey branch on the map for the 300 ms before the first
 * fetch lands.
 */
function levelOf(health: ReadonlyMap<string, EntryHealth>, id: string): HealthLevel {
  return health.get(id)?.health ?? 'ok'
}

function emptyLevels(): Record<HealthLevel, number> {
  return { ok: 0, stale: 0, overdue: 0, critical: 0 }
}

function emptyHealth(): MindHealth {
  return { levels: emptyLevels(), slaBreached: false }
}

/** Sum a set of children into one verdict. THE roll-up — rule 2 of the header. */
function rollUp(children: readonly MindNode[]): MindHealth {
  const levels = emptyLevels()
  let slaBreached = false
  for (const child of children) {
    for (const level of HEALTH_ORDER) levels[level] += child.health.levels[level]
    if (child.health.slaBreached) slaBreached = true
  }
  return { levels, slaBreached }
}

/**
 * A whole leaf's threshold, floored at zero.
 *
 * Total over anything a caller can pass, because this number reaches here from a
 * persisted preference in one direction and a viewport measurement in the other:
 * a NaN would make every comparison below false and silently render every entry
 * in the workspace at once.
 */
function clampThreshold(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0
}

/**
 * Is this branch drawn closed?
 *
 * THREE INPUTS, IN THIS ORDER, and the order is the whole contract: an explicit
 * close beats an explicit open beats the default. That is what lets the two
 * persisted sets mean exactly "the reader closed this" and "the reader opened
 * this" rather than "the reader disagreed with whatever the default happened to
 * be on the build that wrote the preference" — a distinction that only shows up
 * when the default changes, which is precisely what this ships.
 *
 * A leaf is never collapsed: the caller passes `hasChildren`, because a node
 * claiming `aria-expanded="false"` with nothing under it promises a subtree the
 * reader can never reach.
 */
function startsCollapsed(
  input: MindtreeInput,
  id: string,
  depth: number,
  hasChildren: boolean,
): boolean {
  if (!hasChildren) return false
  if (input.collapsedIds.has(id)) return true
  if (input.expandedIds?.has(id) === true) return false
  const openDepth = input.openDepth
  return typeof openDepth === 'number' && Number.isFinite(openDepth) && depth >= openDepth
}

// ── ring 1: tracks ─────────────────────────────────────────────────────────

interface TrackDef {
  key: string
  label: MindLabel
  vars: CSSProperties
  retired: boolean
}

function bySortOrder(a: MindTrack, b: MindTrack): number {
  // The id tiebreak is what makes the order TOTAL. `sort_order` ties are real —
  // it defaults to 0 and a reorder only rewrites the rows it was handed — and
  // without a second key two tracks swap places between renders, which reads as
  // the map rearranging itself for no reason.
  return a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/**
 * Ring 1, in reading order: every ACTIVE track (whether or not it holds work),
 * then the untracked pile if there is one, then anything retired that still
 * holds work.
 *
 * AN EMPTY ACTIVE TRACK IS A NODE, NOT AN ABSENCE. "Which track has nothing on
 * it" is one of the questions the map exists to answer, and a track that simply
 * disappeared when its last item closed would answer it by looking identical to
 * a track that was never configured.
 *
 * THE UNTRACKED PILE COMES LAST, which is the opposite of the board. The board
 * leads with it because untracked work is a QUEUE and a queue belongs at the
 * front of a triage screen. This is not a triage screen: it is an ordered
 * overview, and lib/aggregate.openPerTrack pins the untracked pile last for the
 * reason that applies here too — "No track" is not a track, and letting it float
 * among the real ones makes the ranking of the real ones harder to read.
 */
function trackDefs(tracks: readonly MindTrack[], byTrack: ReadonlyMap<string, Entry[]>): TrackDef[] {
  const defs: TrackDef[] = []
  const declared = new Set<string>([NO_VALUE])

  const sorted = [...tracks].sort(bySortOrder)
  for (const track of sorted) {
    if (track.archived) continue
    declared.add(track.id)
    defs.push({
      key: track.id,
      label: textLabel(track.label),
      vars: trackVars(track.color, track.colorLight),
      retired: false,
    })
  }

  if (byTrack.has(NO_VALUE)) {
    defs.push({ key: NO_VALUE, label: keyLabel('entry.noTrack'), vars: {}, retired: false })
  }

  // An archived track holding work: its entries did not move when it was
  // archived (`tracks.archived` is a flag, not a cascade), so the branch stays
  // reachable and marked rather than deleting nine items from the total.
  for (const track of sorted) {
    if (!track.archived || !byTrack.has(track.id)) continue
    declared.add(track.id)
    defs.push({
      key: track.id,
      label: textLabel(track.label),
      vars: trackVars(track.color, track.colorLight),
      retired: true,
    })
  }

  // A track_id no row in `tracks` explains. The FK is `on delete set null`, so
  // this should be unreachable from the server — it is reachable from the
  // first-paint entry cache, which can be one deploy older than the track list.
  const unknown = [...byTrack.keys()].filter((key) => !declared.has(key)).sort()
  for (const key of unknown) {
    defs.push({ key, label: keyLabel('mindtree.unknownTrack'), vars: {}, retired: true })
  }

  return defs
}

// ── ring 2: the dimension ──────────────────────────────────────────────────

interface GroupDef {
  key: string
  label: MindLabel
  retired: boolean
  entries: Entry[]
}

/**
 * ONLY POPULATED GROUPS APPEAR, and that is the one place this ring differs from
 * ring 1 above.
 *
 * A track with nothing on it is a fact worth drawing once. Six statuses × six
 * tracks, thirty of them empty, is not a fact — it is a grid, and it buries the
 * three branches that actually carry the workload. The spec's own sketch shows
 * three statuses under a twelve-item track for the same reason.
 *
 * That rule is also what makes "a hidden vocabulary option never appears" true:
 * hiding an option empties it from every picker, so the only way one survives
 * here is if entries STILL HOLD IT — which is exactly the case store/vocab.ts
 * freezes ("hiding an option must never hide data") and this file marks
 * `retired` rather than dropping.
 */
function groupsFor(entries: Entry[], input: MindtreeInput): GroupDef[] {
  if (input.dimension === 'owner') return ownerGroups(entries, input.members)
  if (input.dimension === 'health') return healthGroups(entries, input.health)
  return vocabGroups(entries, input.dimension, input.vocab)
}

function vocabGroups(
  entries: Entry[],
  dimension: 'status' | 'priority',
  vocab: readonly MindVocabOption[],
): GroupDef[] {
  const buckets = new Map<string, Entry[]>()
  for (const entry of entries) {
    push(buckets, dimension === 'status' ? entry.status : entry.priority, entry)
  }

  const defs: GroupDef[] = []
  // The vocabulary's own order, which is the admin's order — the same list and
  // the same sequence the board's columns and every picker in the app use, so a
  // workspace that reordered its statuses sees that order here too.
  for (const option of vocab) {
    const held = buckets.get(option.key)
    if (!held) continue
    buckets.delete(option.key)
    defs.push({
      key: option.key,
      label: textLabel(option.label),
      retired: option.hidden,
      entries: held,
    })
  }

  // A value no option declared. Unreachable when the caller passes
  // `useVocabAll()` as documented, because that walks FROZEN_KEYS — the same
  // list `EntryStatus` and `EntryPriority` are declared from. Sorted, so a
  // build that somehow produces two of them still renders them the same way
  // twice in a row.
  for (const key of [...buckets.keys()].sort()) {
    const held = buckets.get(key)
    if (held) defs.push({ key, label: keyLabel('mindtree.unknownGroup'), retired: true, entries: held })
  }

  return defs
}

/**
 * The owner axis, in reading order: Unassigned, then the roster, then free-text
 * owners, then ids the roster does not explain.
 *
 * UNASSIGNED LEADS, and here it does lead — unlike the untracked pile in ring 1.
 * The difference is what the two piles mean. "No track" is a filing gap. "No
 * owner" is unclaimed work, which is the single most actionable thing an ops
 * lead can see on this screen, and burying it behind eight people's names is
 * burying the answer.
 *
 * A FREE-TEXT OWNER IS ITS OWN BUCKET, never merged into a member's. Vendors and
 * people outside the workspace own real work; `entries.owner_name` is where it
 * lives, and `owner_id`/`owner_name` are mutually exclusive by construction
 * (types.ts). Two spellings of one vendor stay two buckets, deliberately —
 * guessing that "Acme" and "ACME Ltd" are one company is a guess this module has
 * no business making, and lib/entryFilter's owner matching makes the same call.
 */
function ownerGroups(entries: Entry[], members: readonly MindMember[]): GroupDef[] {
  const buckets = new Map<string, Entry[]>()
  for (const entry of entries) push(buckets, ownerBucket(entry), entry)

  const defs: GroupDef[] = []
  const take = (key: string): Entry[] | undefined => {
    const held = buckets.get(key)
    if (held) buckets.delete(key)
    return held
  }

  const unassigned = take(NO_VALUE)
  if (unassigned) {
    defs.push({ key: NO_VALUE, label: keyLabel('entry.unassigned'), retired: false, entries: unassigned })
  }

  for (const member of members) {
    const held = take(member.id)
    if (!held) continue
    const name = member.displayName.trim()
    defs.push({
      key: member.id,
      // A blank display name falls through to "Unknown" rather than rendering a
      // name-shaped hole or a raw uuid — store/members.memberLabel makes the
      // same call for the same half-provisioned account.
      label: name === '' ? keyLabel('mindtree.unknownOwner') : textLabel(name),
      retired: false,
      entries: held,
    })
  }

  // Free text and unexplained ids are both leftovers, but they are different
  // leftovers: a vendor is a legitimate owner, an id the roster has forgotten is
  // a deleted profile. Only the second is retired.
  const free: string[] = []
  const unknown: string[] = []
  for (const key of buckets.keys()) (key.startsWith(NAME_PREFIX) ? free : unknown).push(key)

  // Folded first so two spellings that differ only in case or hamza carrier sort
  // next to each other, then by the raw key so the order is TOTAL — code points,
  // never localeCompare, which is host-dependent and would order the map
  // differently in the test runner and the browser (lib/entryFilter's title sort
  // documents the same choice).
  free.sort((a, b) => {
    const x = normalizeSearch(a.slice(NAME_PREFIX.length))
    const y = normalizeSearch(b.slice(NAME_PREFIX.length))
    return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0
  })
  for (const key of free) {
    const held = buckets.get(key)
    if (held) {
      defs.push({ key, label: textLabel(key.slice(NAME_PREFIX.length)), retired: false, entries: held })
    }
  }
  for (const key of unknown.sort()) {
    const held = buckets.get(key)
    if (held) defs.push({ key, label: keyLabel('mindtree.unknownOwner'), retired: true, entries: held })
  }

  return defs
}

/** Which owner bucket a row lands in. Mirrors Board's `bucketOf` exactly. */
function ownerBucket(entry: Entry): string {
  if (entry.owner_id !== null) return entry.owner_id
  const name = (entry.owner_name ?? '').trim()
  return name === '' ? NO_VALUE : NAME_PREFIX + name
}

/**
 * The health axis. Not a vocabulary kind and never will be — store/vocab.ts's
 * header freezes that: the four levels are computed by `v_entry_health`, and
 * making them configurable is one step from configuring the algorithm. The order
 * is lib/aggregate.HEALTH_ORDER, the same escalating ramp every chart legend in
 * the app reads in.
 */
function healthGroups(entries: Entry[], health: ReadonlyMap<string, EntryHealth>): GroupDef[] {
  const buckets = new Map<string, Entry[]>()
  for (const entry of entries) push(buckets, levelOf(health, entry.id), entry)

  const defs: GroupDef[] = []
  for (const level of HEALTH_ORDER) {
    const held = buckets.get(level)
    if (!held) continue
    defs.push({ key: level, label: keyLabel(HEALTH_LABEL[level]), retired: false, entries: held })
  }
  return defs
}

// ── assembly ───────────────────────────────────────────────────────────────

/**
 * The whole map, root first.
 *
 * Deterministic end to end: no clock, no `Math.random`, no force simulation, and
 * every ordering decision above ends in a total tiebreak. The same inputs
 * produce a byte-identical tree, which is what makes the layout reproducible
 * between renders and the export reproducible between machines.
 */
export function buildMindtree(input: MindtreeInput): MindNode {
  // Rule 1: filter FIRST. `selectEntries` also sorts, so ring 3 reads in the
  // order the FilterBar's sort chose — and a "+N more" therefore hides the tail
  // of that order rather than an arbitrary slice.
  const entries = selectEntries(input.entries, input.filter, input.health, input.ctx)

  const byTrack = new Map<string, Entry[]>()
  for (const entry of entries) push(byTrack, entry.track_id ?? NO_VALUE, entry)

  const children = trackDefs(input.tracks, byTrack).map((def) =>
    trackNode(def, byTrack.get(def.key) ?? [], input),
  )

  return {
    id: ROOT_ID,
    kind: 'root',
    // The workspace itself. `app.name` rather than a mindtree key of its own, so
    // the brand gate (lib/brand.test.ts) covers the root of this map too.
    label: keyLabel('app.name'),
    count: entries.length,
    colourVars: {},
    health: rollUp(children),
    children,
    // The root is never collapsible. A collapsed root is a blank screen with no
    // affordance left to un-blank it.
    collapsed: false,
    depth: 0,
    entryId: null,
    bucketKey: null,
    retired: false,
  }
}

/**
 * One ring-2 bucket, TOTALLED ACROSS EVERY TRACK.
 *
 * The map cannot draw this and never will: ring 2 sits INSIDE ring 1, so a
 * person working across four tracks is four nodes carrying four numbers, and
 * "who is overloaded" — one of the three questions MINDTREE-SPEC names — is a
 * sum the reader is left to do by eye. Nesting is the right call for the
 * picture (it is what makes a track's mass legible), so the sum is provided
 * beside it rather than instead of it: one sentence under the map, one small
 * table under the big one.
 *
 * `count` is taken off the group NODES, which is the same number the picture
 * drew and the same number the big table's cells carry. There is no second
 * arithmetic path to this screen.
 */
export interface MindGroupTotal {
  /** The bucket key — a status key, a member id, `name:Acme`, a health level. */
  key: string
  label: MindLabel
  count: number
  /** True when EVERY track that holds this bucket has it retired. */
  retired: boolean
  /** First appearance in the tree's own reading order — the total tiebreak. */
  order: number
}

/**
 * Ring 2 summed across ring 1, biggest first.
 *
 * Ordered by count descending because the question is "where is the mass", and
 * tied on the tree's own reading order so the result is TOTAL — two buckets of
 * eight must not swap places between renders.
 *
 * Empty groups do not exist (groupsFor only emits populated buckets), so every
 * row here holds work. A workspace with one track produces the same numbers as
 * the tree's own ring 2 and the caller is expected to skip it.
 */
export function groupTotals(root: MindNode): MindGroupTotal[] {
  const held = new Map<string, MindGroupTotal>()
  let order = 0
  for (const track of root.children) {
    for (const group of track.children) {
      const key = group.bucketKey ?? NO_VALUE
      const seen = held.get(key)
      if (seen === undefined) {
        held.set(key, {
          key,
          label: group.label,
          count: group.count,
          retired: group.retired,
          order: order++,
        })
        continue
      }
      seen.count += group.count
      // Retired only if NOBODY has it live: a status hidden in one workspace-wide
      // vocabulary is hidden everywhere, but an owner absent from the roster can
      // still be a legitimate free-text owner under another track.
      seen.retired = seen.retired && group.retired
    }
  }
  return [...held.values()].sort((a, b) => b.count - a.count || a.order - b.order)
}

function trackNode(def: TrackDef, held: Entry[], input: MindtreeInput): MindNode {
  const id = nodeId(ROOT_ID, 'track', def.key)
  const children = held.length === 0 ? [] : groupsFor(held, input).map((g) => groupNode(g, id, def.vars, input))
  return {
    id,
    kind: 'track',
    label: def.label,
    // Off the entries, not off the children — they must agree, and the test that
    // says so is the one that would catch a grouping pass dropping a row.
    count: held.length,
    colourVars: def.vars,
    health: children.length === 0 ? emptyHealth() : rollUp(children),
    children,
    collapsed: startsCollapsed(input, id, 1, children.length > 0),
    depth: 1,
    entryId: null,
    bucketKey: def.key,
    retired: def.retired,
  }
}

function groupNode(
  def: GroupDef,
  parentId: string,
  vars: CSSProperties,
  input: MindtreeInput,
): MindNode {
  const id = nodeId(parentId, 'group', def.key)
  const threshold = clampThreshold(input.leafThreshold)
  const overflow = def.entries.length - threshold

  // A "+1 more" is never worth a node: it occupies the row the entry itself
  // would have occupied, so it costs a click and saves nothing. Two is where
  // folding starts paying.
  const folds = overflow > 1
  const shown = folds ? def.entries.slice(0, threshold) : def.entries
  const tail = folds ? def.entries.slice(threshold) : []

  const children = shown.map((entry) => entryNode(entry, id, 3, vars, input.health))
  if (tail.length > 0) children.push(moreNode(id, tail, vars, input))

  return {
    id,
    kind: 'group',
    label: def.label,
    count: def.entries.length,
    colourVars: vars,
    health: rollUp(children),
    children,
    collapsed: startsCollapsed(input, id, 2, children.length > 0),
    depth: 2,
    entryId: null,
    bucketKey: def.key,
    retired: def.retired,
  }
}

/**
 * The overflow node — "+5 more".
 *
 * IT KEEPS ITS ENTRIES AS CHILDREN and is merely collapsed, rather than standing
 * in for rows the tree does not hold. Two reasons, and both are hard
 * requirements rather than preferences:
 *
 *  · A node that DISAPPEARS when you activate it destroys keyboard focus. The
 *    tree is `role="tree"` with roving tabindex; pressing Enter on "+5 more" and
 *    having the focused element cease to exist drops the user back to the top of
 *    the document. Expanding in place is what `aria-expanded` means.
 *  · The accessible table walks `children` and ignores `collapsed`, so every
 *    entry is in the table whether or not the picture is currently showing it.
 *    A blind user must be able to answer the same question the picture answers,
 *    and "the rows behind the fold" is part of the answer.
 *
 * It is collapsed unless the user opened it — which is why it reads
 * `expandedIds` DIRECTLY rather than going through `startsCollapsed()`. A fold
 * is closed by default at every `openDepth`, including none: it exists because
 * its group already overflowed, so a build that omitted `openDepth` would
 * otherwise open every tail in the workspace at once.
 */
function moreNode(
  parentId: string,
  tail: Entry[],
  vars: CSSProperties,
  input: MindtreeInput,
): MindNode {
  const id = `${parentId}/more`
  const children = tail.map((entry) => entryNode(entry, id, 4, vars, input.health))
  return {
    id,
    kind: 'more',
    label: keyLabel('mindtree.more', { count: tail.length }),
    count: tail.length,
    colourVars: vars,
    health: rollUp(children),
    children,
    collapsed: !(input.expandedIds?.has(id) ?? false),
    depth: 3,
    entryId: null,
    bucketKey: null,
    retired: false,
  }
}

function entryNode(
  entry: Entry,
  parentId: string,
  depth: number,
  vars: CSSProperties,
  health: ReadonlyMap<string, EntryHealth>,
): MindNode {
  const levels = emptyLevels()
  levels[levelOf(health, entry.id)] = 1
  return {
    id: nodeId(parentId, 'entry', entry.id),
    kind: 'entry',
    // The title is database text. It goes through a bidi isolate at render and
    // never through t().
    label: textLabel(entry.title),
    count: 1,
    colourVars: vars,
    health: { levels, slaBreached: health.get(entry.id)?.sla_breached ?? false },
    children: [],
    collapsed: false,
    depth,
    entryId: entry.id,
    bucketKey: null,
    retired: false,
  }
}
