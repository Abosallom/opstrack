// THE one filter model. `FilterState` has exactly one import path — this file —
// and every screen that filters entries uses it: follow-ups, board, timeline,
// dashboard, digest, the shared FilterBar. Two filter shapes would mean two URL
// round-trips and two definitions of "mine".
//
// This is client-side filtering over one working-set fetch, not a query builder.
// The decision is in EXECUTION-PLAN §2.3 and it is what stops five agents
// writing five query builders: the dataset is a small trusted team's ops log
// with full read visibility under RLS, so `api/entries.ts` exposes loaders and
// nothing takes a filter.
//
// PURE BY CONSTRUCTION. Nothing here reads a store, a clock or a locale — `meId`
// and `today` arrive in FilterContext precisely so this module stays testable
// with zero mocking, which is the whole reason the layering rule exists.

import type { Entry, EntryHealth, EntryPriority, EntryStatus, EntryType, HealthLevel } from '../types'
import { instantToIsoDate, parseIsoDate, type IsoDate } from './dates'
import { isOpen } from './health'
import { normalizeSearch } from './text'

export type OwnerFilter =
  | { kind: 'any' }
  | { kind: 'me' }
  | { kind: 'unassigned' }
  | { kind: 'id'; id: string }
  | { kind: 'name'; name: string }

export type EntryScope = 'open' | 'closed' | 'all'
export type EntrySort = 'activity' | 'due' | 'priority' | 'created' | 'title'

export interface FilterState {
  /**
   * [] = all groups — `track_groups` (0018), the level above tracks.
   *
   * ITS OWN DIMENSION, NOT A SHORTHAND FOR A SET OF TRACK IDS. Expanding a
   * group into `trackIds` at the control would have needed no model change at
   * all, and it is wrong in three ways that only surface later: a shared link
   * would read `track=a,b,c` and could never say "Technical"; picking a track
   * after a group would silently clear the group, because one field cannot hold
   * two questions; and a saved link would keep filtering to the membership the
   * group had on the day it was copied.
   *
   * An entry's group is its TRACK's group, which is a fact this module cannot
   * know — see `FilterContext.groupOfTrack`.
   */
  groupIds: string[]
  /** [] = all tracks. */
  trackIds: string[]
  /**
   * [] = the whole map — `map_nodes` (0023), the hierarchy BELOW tracks.
   *
   * ITS OWN DIMENSION, NOT A SHORTHAND FOR A SET OF TRACK IDS, and every word of
   * `groupIds`' paragraph above applies one level down. Resolving the chosen
   * node to its track at the control would have needed no model change at all,
   * and it is wrong in the same three ways: a shared link would read `track=UHR`
   * and could never say "Org1"; picking a track after an organization would
   * silently clear the organization, because one field cannot hold two
   * questions; and — the one this level adds — a link saved while OB held four
   * organizations would still be filtering to those four after the fifth was
   * onboarded.
   *
   * IT NAMES WHAT THE READER PICKED, NEVER THE EXPANSION OF IT. `node=OB` means
   * "OB and everything filed underneath it", resolved against the tree AS IT IS
   * WHEN THE LINK IS OPENED. Writing the descendants into this array instead
   * would freeze that membership into the URL, which is the third failure above
   * wearing a different hat. Which node sits under which is a fact this module
   * cannot know — see `FilterContext.ancestryOfNode`.
   */
  mapNodeIds: string[]
  /**
   * [] = every integrator. The company delivering an organization's work —
   * `map_nodes.vendor` (0023), free text, `not null default ''`.
   *
   * ITS OWN DIMENSION FOR THE THIRD TIME, and here the temptation was sharper
   * than at the two levels above: a vendor IS a set of organizations, so the
   * vendor control could have written their ids into `mapNodeIds` and this
   * field need not exist. That version cannot survive a week. The URL would read
   * `node=<uuid>,<uuid>,<uuid>` and could never say "Acme"; the organization
   * facet and the vendor facet would be one field holding two questions, so
   * picking a branch would silently drop the vendor; and the day Acme takes on a
   * twelfth hospital, every link anybody saved would still be reporting on
   * eleven. Aziz asked to filter the map by vendor — a link that cannot say
   * which vendor is not that feature.
   *
   * MATCHED FOLDED, like `tags`: 'Acme' and 'acme ' are one integrator, and the
   * column is free text a person types. Which vendor is behind an entry is a
   * fact this module cannot know — see `FilterContext.vendorOfNode`.
   */
  vendors: string[]
  statuses: EntryStatus[]
  priorities: EntryPriority[]
  types: EntryType[]
  owner: OwnerFilter
  /** AND semantics — a row must carry EVERY listed tag, not any of them. */
  tags: string[]
  health: HealthLevel[]
  /** Folded match over title + description + tags, via lib/text.normalizeSearch. */
  search: string
  scope: EntryScope
  /** owner_id = me OR created_by = me. Independent of `owner`, deliberately. */
  mine: boolean
  from: IsoDate | null
  to: IsoDate | null
  sort: EntrySort
}

/**
 * What the filter needs that the filter cannot know. Passed explicitly so
 * selectEntries stays pure and testable with zero mocking — `me` and `today`
 * are the two values that would otherwise drag a store and a clock into lib/.
 */
export interface FilterContext {
  meId: string | null
  today: IsoDate
  weekStartsOn?: 0 | 1 | 6
  /**
   * track id → the group it sits under, or null when it sits under none —
   * `tracks.group_id` (0018). `store/entries.useFilterContext()` builds it from
   * the config store, so every screen gets it without knowing it exists.
   *
   * OPTIONAL, so that adding the group dimension changed no call site: every
   * existing caller keeps compiling and keeps behaving identically, because a
   * filter with `groupIds: []` never reads this map.
   *
   * WHEN IT IS ABSENT AND `groupIds` IS NOT EMPTY, NOTHING MATCHES. That is the
   * strict reading of the question — "restrict to entries in this group", asked
   * of a caller that cannot say which group anything is in — and it is the
   * failure worth having: an empty list is visible in the first five seconds of
   * testing, while quietly ignoring the facet ships a filter that does nothing
   * and looks like it worked.
   */
  groupOfTrack?: ReadonlyMap<string, string | null>
  /**
   * node id → that node and every node ABOVE it, nearest first —
   * `[self, parent, …, depth-0]`. `store/entries.useFilterContext()` builds it
   * from the config store's `mapNodeById`, so every screen gets it without
   * knowing it exists.
   *
   * THIS IS WHERE THE DESCENDANT EXPANSION LIVES, and it lives in the caller
   * because this module holds no tree and must not grow one — `matchesFilter`
   * is called once per row per keystroke and a tree walk per row is a different
   * function with a different cost. Expressed as ANCESTRY rather than as "the
   * ids under the chosen node" for one reason that matters: a descendant set
   * would have to be keyed on the current selection, so every click on the
   * filter would rebuild it, and every memo downstream of `FilterContext` with
   * it. Ancestry depends on the tree alone, so it is built once when the config
   * lands and survives every change to the filter.
   *
   * SELF IS INCLUDED, and it is not a convenience: `node=Org1` has to keep the
   * work filed directly ON Org1, which is most of it.
   *
   * WHEN IT IS ABSENT AND `mapNodeIds` IS NOT EMPTY, NOTHING MATCHES — the
   * strict reading `groupOfTrack` takes, for its reason. A partial answer is
   * available here and is the worse failure: without this map a filter on Org1
   * could still match rows whose `node_id` IS Org1, so the list would look
   * right, be wrong for every branch above a leaf, and nobody would find out
   * until an executive asked why OB was empty.
   */
  ancestryOfNode?: ReadonlyMap<string, readonly string[]>
  /**
   * node id → the integrator delivering it, `''` when nobody has recorded one.
   *
   * THE EFFECTIVE VENDOR, INHERITED DOWNWARD by the caller: an entry filed on a
   * node beneath an organization answers that organization's vendor, because
   * "Acme's work" means everything inside Acme's organizations and a reader
   * filing an issue one level deeper did not mean to leave the vendor behind.
   * Resolving the nearest self-or-ancestor with a non-empty vendor needs the
   * tree, so it happens where the tree is — beside `ancestryOfNode`, from the
   * same walk.
   *
   * `''` ANSWERS NO VENDOR FILTER, exactly as an ungrouped track answers no
   * group filter: "not recorded" is the absence of an answer, not a twelfth
   * integrator, and passing it through would put every phase's work into
   * whichever vendor was asked about first.
   *
   * Absent map, non-empty `vendors` ⇒ nothing matches, for `groupOfTrack`'s
   * reason.
   */
  vendorOfNode?: ReadonlyMap<string, string>
}

/**
 * The neutral filter. Frozen so a screen cannot mutate the shared default into
 * its own state and quietly change every other screen's starting point.
 */
export const EMPTY_FILTER: Readonly<FilterState> = Object.freeze({
  groupIds: [],
  trackIds: [],
  mapNodeIds: [],
  vendors: [],
  statuses: [],
  priorities: [],
  types: [],
  owner: { kind: 'any' },
  tags: [],
  health: [],
  search: '',
  scope: 'open',
  mine: false,
  from: null,
  to: null,
  sort: 'activity',
} satisfies FilterState)

// ── frozen-union guards ────────────────────────────────────────────────────
//
// A filter can arrive from a hand-edited URL, so filterFromParams validates
// every closed-vocabulary value instead of casting it. These are written as
// exhaustive `Record<Union, true>` literals ON PURPOSE rather than as string
// arrays: adding a member to one of the four frozen unions in types.ts reds THIS
// FILE at compile time. A string array would silently accept the new value
// nowhere and drop it from every URL — a bug that presents as "my saved view
// lost a status" three waves later.
//
// Object.hasOwn, not `in`: `in` walks the prototype chain, so a URL carrying
// `status=toString` would pass.

const STATUS_KEYS: Readonly<Record<EntryStatus, true>> = {
  new: true,
  in_progress: true,
  blocked: true,
  waiting_on: true,
  done: true,
  cancelled: true,
}

const PRIORITY_KEYS: Readonly<Record<EntryPriority, true>> = {
  low: true,
  medium: true,
  high: true,
  critical: true,
}

const TYPE_KEYS: Readonly<Record<EntryType, true>> = {
  action: true,
  decision: true,
  issue: true,
  request: true,
  change: true,
  escalation: true,
  note: true,
}

const HEALTH_KEYS: Readonly<Record<HealthLevel, true>> = {
  ok: true,
  stale: true,
  overdue: true,
  critical: true,
}

const SCOPE_KEYS: Readonly<Record<EntryScope, true>> = { open: true, closed: true, all: true }

const SORT_KEYS: Readonly<Record<EntrySort, true>> = {
  activity: true,
  due: true,
  priority: true,
  created: true,
  title: true,
}

/** Rank for the `priority` sort. Descending — critical first. */
const PRIORITY_RANK: Readonly<Record<EntryPriority, number>> = {
  critical: 3,
  high: 2,
  medium: 1,
  low: 0,
}

// ── matching ───────────────────────────────────────────────────────────────

/** True when the entry carries an owner of any kind. Free text counts. */
function hasOwner(e: Entry): boolean {
  return e.owner_id !== null || (e.owner_name ?? '').trim() !== ''
}

function matchesOwner(e: Entry, owner: OwnerFilter, meId: string | null): boolean {
  switch (owner.kind) {
    case 'any':
      return true
    case 'me':
      return meId !== null && e.owner_id === meId
    case 'unassigned':
      return !hasOwner(e)
    case 'id':
      return e.owner_id === owner.id
    case 'name': {
      // Folded EQUALITY, not substring: the picker emits a name it read off an
      // entry, so this is an identity test between two spellings of one person,
      // not a search. Substring matching here would quietly collect "Ali
      // Hassan" and "Alia" under a facet labelled "Ali".
      const wanted = normalizeSearch(owner.name)
      if (wanted === '') return false
      return normalizeSearch(e.owner_name ?? '') === wanted
    }
  }
}

/**
 * Every whitespace-separated term must appear somewhere in title + description +
 * tags, ANDed. Two terms narrow rather than widen, which is what a person typing
 * a second word means; a whole-phrase match would make `network outage` miss
 * "outage on the network".
 */
function matchesSearch(e: Entry, search: string): boolean {
  const terms = normalizeSearch(search).split(' ').filter(Boolean)
  if (terms.length === 0) return true
  const haystack = normalizeSearch([e.title, e.description, e.tags.join(' ')].join(' '))
  return terms.every((term) => haystack.includes(term))
}

function matchesTags(e: Entry, tags: string[]): boolean {
  if (tags.length === 0) return true
  // Folded on both sides so an Arabic tag typed with a different hamza carrier
  // still matches. normalizeSearch, not foldKey: a hyphen is meaningful inside a
  // tag (`direct-integration` is one tag, and foldKey would merge it with
  // `directintegration`).
  const carried = new Set(e.tags.map((tag) => normalizeSearch(tag)))
  return tags.every((tag) => carried.has(normalizeSearch(tag)))
}

function matchesScope(e: Entry, scope: EntryScope): boolean {
  if (scope === 'all') return true
  // isOpen(), never a local status list — lib/health.CLOSED_STATUSES is the one
  // definition of closed in the repo.
  return scope === 'open' ? isOpen(e.status) : !isOpen(e.status)
}

export function matchesFilter(
  e: Entry,
  f: FilterState,
  h: EntryHealth | undefined,
  c: FilterContext,
): boolean {
  if (!matchesScope(e, f.scope)) return false

  // Group before track: it is the coarser cut, so on a filter carrying both it
  // rejects more rows per test. An entry with no track has no group either —
  // "unfiled" is not a third group, and passing it through would put every
  // untracked row into both halves of a "my half vs theirs" report.
  if (f.groupIds.length > 0) {
    const group = e.track_id === null ? null : (c.groupOfTrack?.get(e.track_id) ?? null)
    if (group === null || !f.groupIds.includes(group)) return false
  }

  if (f.trackIds.length > 0 && (e.track_id === null || !f.trackIds.includes(e.track_id)))
    return false

  // Then the finer grain INSIDE the track. An entry with no `node_id` is filed
  // on its track and nowhere else — it is not "at the root of the hierarchy",
  // so it answers no question about a place in it, which is the group facet's
  // "unfiled is not a third group" one level down.
  //
  // ANDed with the track facet rather than replacing it, and the pair is never
  // contradictory by accident: `entries_map_sync` derives `track_id` from the
  // node, so a filter naming a track and a node under a different one returns
  // nothing because that is the truth, not because the two facets fought.
  if (f.mapNodeIds.length > 0) {
    if (e.node_id === null) return false
    const ancestry = c.ancestryOfNode?.get(e.node_id)
    if (ancestry === undefined || !ancestry.some((id) => f.mapNodeIds.includes(id))) return false
  }

  // Vendor is an attribute of a place, so it is asked of the entry's place —
  // which is why it sits here and not beside `owner`. `owner_name` free text
  // naming the same company is a DIFFERENT question ("who is chasing this")
  // and deliberately does not answer this one.
  if (f.vendors.length > 0) {
    const vendor = e.node_id === null ? '' : (c.vendorOfNode?.get(e.node_id) ?? '')
    // Folded on both sides, like tags: the column is free text a person types,
    // and 'Acme' typed on one organization and 'acme ' on the next is one
    // integrator to everybody except a string comparison.
    const carried = normalizeSearch(vendor)
    if (carried === '' || !f.vendors.some((v) => normalizeSearch(v) === carried)) return false
  }

  if (f.statuses.length > 0 && !f.statuses.includes(e.status)) return false
  if (f.priorities.length > 0 && !f.priorities.includes(e.priority)) return false
  if (f.types.length > 0 && !f.types.includes(e.type)) return false
  if (!matchesOwner(e, f.owner, c.meId)) return false

  // `mine` is deliberately not an owner kind: "assigned to me" and "anything I
  // touched" are different questions, and the follow-ups screen asks the second
  // while the owner picker asks the first. Signed out, `mine` matches nothing
  // rather than everything — meId === null must not make `null === null` true
  // for every unassigned, unattributed row.
  if (f.mine && (c.meId === null || !(e.owner_id === c.meId || e.created_by === c.meId)))
    return false

  if (!matchesTags(e, f.tags)) return false

  // A health facet is a question about OPEN work — v_entry_health has no row for
  // anything else. An entry with no health row therefore cannot answer it and is
  // excluded rather than silently passed, so `scope: all` + `health: [overdue]`
  // returns overdue open items instead of those plus every closed one.
  if (f.health.length > 0 && (h === undefined || !f.health.includes(h.health))) return false

  // The date range is over LAST ACTIVITY, not creation. Every screen that shows
  // a range asks "what moved in this window" — the digest is "since Sunday", the
  // timeline is activity in a period, the dashboard is a reporting window — and
  // a month-old item worked on yesterday belongs in all three.
  if (f.from !== null || f.to !== null) {
    const day = instantToIsoDate(e.last_activity_at)
    if (f.from !== null && day < f.from) return false
    if (f.to !== null && day > f.to) return false
  }

  return matchesSearch(e, f.search)
}

// ── sorting ────────────────────────────────────────────────────────────────

/**
 * Sorts a COPY. `list` in store/entries is reference-stable and shared by every
 * screen; sorting it in place would reorder the board while the dashboard was
 * reading it.
 *
 * Every comparator ends on `id` so the order is TOTAL. Array.prototype.sort is
 * stable in every engine that matters, but stability only preserves an order the
 * caller already had — two rows with the same last_activity_at arriving from two
 * fetches in two orders would render in two orders, which reads as the list
 * jumping for no reason.
 */
export function sortEntries(e: Entry[], s: EntrySort): Entry[] {
  const copy = [...e]
  copy.sort((a, b) => compareBy(a, b, s) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return copy
}

function compareBy(a: Entry, b: Entry, s: EntrySort): number {
  switch (s) {
    case 'activity':
      return Date.parse(b.last_activity_at) - Date.parse(a.last_activity_at)
    case 'created':
      return Date.parse(b.created_at) - Date.parse(a.created_at)
    case 'due':
      // Nulls LAST under an ascending sort: "no due date" is the absence of an
      // answer, and floating it to the top buries the one item due tomorrow
      // under fifty that are never due at all.
      if (a.due_date === b.due_date) return 0
      if (a.due_date === null) return 1
      if (b.due_date === null) return -1
      return a.due_date < b.due_date ? -1 : 1
    case 'priority':
      return (
        PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] ||
        Date.parse(b.last_activity_at) - Date.parse(a.last_activity_at)
      )
    case 'title': {
      // Folded, then compared by code point rather than through localeCompare:
      // the result has to be identical in the test runner and in the browser,
      // and localeCompare with no explicit locale is host-dependent. Folding is
      // what makes code-point order sane in both languages — case, tashkeel and
      // Arabic-Indic digits are all gone before the comparison.
      const x = normalizeSearch(a.title)
      const y = normalizeSearch(b.title)
      return x < y ? -1 : x > y ? 1 : 0
    }
  }
}

export function selectEntries(
  e: Entry[],
  f: FilterState,
  h: ReadonlyMap<string, EntryHealth>,
  c: FilterContext,
): Entry[] {
  return sortEntries(
    e.filter((entry) => matchesFilter(entry, f, h.get(entry.id), c)),
    f.sort,
  )
}

// ── facets ─────────────────────────────────────────────────────────────────

/**
 * Drives the "3 filters" pill. Counts FACETS, not values — three selected
 * priorities are ONE narrowing decision the user made, and reporting "3" next to
 * a Clear button that removes all three at once is a lie about what the button
 * does.
 *
 * `from`/`to` count as one facet for the same reason: two ends of one date-range
 * control. `sort` counts as none — ordering a list is not filtering it, and a
 * sort that lit the pill would make "clear filters" look broken when the order
 * stayed put.
 */
export function countActiveFacets(f: FilterState): number {
  let n = 0
  // Counted separately from `track`, because they ARE separate decisions: a
  // person who narrowed to Technical and then to Infrastructure made two, and
  // Clear removes both.
  if (f.groupIds.length > 0) n += 1
  if (f.trackIds.length > 0) n += 1
  // Three counters for three questions, and the badge is the only thing that
  // tells a reader their list is narrowed before they open the panel. A facet
  // wired into `matchesFilter` and left out of here is worse than one that does
  // not exist: the list is short, the badge says nothing is filtering it, and
  // Clear all — which is defined through this function — is offered or withheld
  // on the strength of that same lie.
  if (f.mapNodeIds.length > 0) n += 1
  if (f.vendors.length > 0) n += 1
  if (f.statuses.length > 0) n += 1
  if (f.priorities.length > 0) n += 1
  if (f.types.length > 0) n += 1
  if (f.owner.kind !== 'any') n += 1
  if (f.tags.length > 0) n += 1
  if (f.health.length > 0) n += 1
  if (f.search.trim() !== '') n += 1
  if (f.scope !== EMPTY_FILTER.scope) n += 1
  if (f.mine) n += 1
  if (f.from !== null || f.to !== null) n += 1
  return n
}

/** Defined through countActiveFacets so the pill and the empty state can never disagree. */
export function isFilterEmpty(f: FilterState): boolean {
  return countActiveFacets(f) === 0
}

/**
 * A stable useMemo dependency for a filter object.
 *
 * NEVER JSON.stringify a filter at a call site: key order is not guaranteed
 * across construction paths, so two identical filters can produce two different
 * strings and re-run every memo on every render.
 *
 * The multi-value facets are SORTED before joining, so a filter assembled by the
 * FilterBar and the same filter restored from a URL key identically even though
 * their arrays came out in different orders. `search` is folded and placed last:
 * folded so a stray capital does not invalidate a memo the filter did not
 * change, last so a `|` typed into it cannot shift the meaning of a later field.
 */
export function filterKey(f: FilterState): string {
  return [
    [...f.groupIds].sort().join(','),
    [...f.trackIds].sort().join(','),
    [...f.mapNodeIds].sort().join(','),
    // FOLDED before sorting, because matching folds too: `vendor=Acme` and
    // `vendor=acme` select the same rows, so they must key the same memo. A raw
    // join would re-run selectEntries over the whole working set for a filter
    // that cannot return a different answer.
    [...f.vendors].map(normalizeSearch).sort().join(','),
    [...f.statuses].sort().join(','),
    [...f.priorities].sort().join(','),
    [...f.types].sort().join(','),
    ownerKey(f.owner),
    [...f.tags].sort().join(','),
    [...f.health].sort().join(','),
    f.scope,
    f.mine ? '1' : '0',
    f.from ?? '',
    f.to ?? '',
    f.sort,
    normalizeSearch(f.search),
  ].join('|')
}

function ownerKey(owner: OwnerFilter): string {
  switch (owner.kind) {
    case 'any':
      return ''
    case 'me':
      return 'me'
    case 'unassigned':
      return 'none'
    case 'id':
      return `id:${owner.id}`
    case 'name':
      return `name:${normalizeSearch(owner.name)}`
  }
}

// ── URL round-trip ─────────────────────────────────────────────────────────
//
// One object names the params, because filterToParams and filterFromParams are
// two halves of one contract and a typo in either is a saved view that silently
// loses a facet.

const P = {
  group: 'group',
  track: 'track',
  // `node` and `vendor` are free: focus.ts owns `focus` and `dim`, and
  // pages/map/useMapUrl.ts owns `lens` and `stage`. A collision would not be a
  // compile error — it would be a drill-in and a filter overwriting each other
  // in the address bar.
  node: 'node',
  vendor: 'vendor',
  status: 'status',
  priority: 'priority',
  type: 'type',
  owner: 'owner',
  tag: 'tag',
  health: 'health',
  q: 'q',
  scope: 'scope',
  mine: 'mine',
  from: 'from',
  to: 'to',
  sort: 'sort',
} as const

/**
 * Neutral facets are OMITTED, so a clean list has a clean URL and a shared link
 * carries only what the sender actually chose.
 *
 * Tags are repeated params (`tag=a&tag=b`) rather than a comma list: a tag is
 * free-form user text, and the day someone creates `q3,q4` a comma list becomes
 * two tags that match nothing. The closed unions stay comma-joined — their
 * values cannot contain a comma, and one short param reads better in an address
 * bar.
 */
export function filterToParams(f: FilterState): URLSearchParams {
  const p = new URLSearchParams()
  // Comma-joined like the other id list: a uuid cannot contain a comma, which is
  // the property that makes `tag` a repeated param and this one not.
  if (f.groupIds.length > 0) p.set(P.group, f.groupIds.join(','))
  if (f.trackIds.length > 0) p.set(P.track, f.trackIds.join(','))
  // Comma-joined for the group facet's reason — these are uuids and a uuid
  // cannot contain a comma.
  if (f.mapNodeIds.length > 0) p.set(P.node, f.mapNodeIds.join(','))
  // A REPEATED PARAM, like `tag` and unlike every id list above it, and the
  // rule is the same one: a vendor is free-form text somebody typed into an
  // admin form, so the day a company is filed as "Acme, Inc." a comma list
  // becomes two integrators that match nothing and a link that silently reports
  // on neither.
  for (const vendor of f.vendors) p.append(P.vendor, vendor)
  if (f.statuses.length > 0) p.set(P.status, f.statuses.join(','))
  if (f.priorities.length > 0) p.set(P.priority, f.priorities.join(','))
  if (f.types.length > 0) p.set(P.type, f.types.join(','))
  if (f.health.length > 0) p.set(P.health, f.health.join(','))
  for (const tag of f.tags) p.append(P.tag, tag)
  // The `name` variant is written RAW rather than folded: a URL is where a
  // person reads their own filter back, and `owner=name:Ali Hassan` beats
  // `owner=name:ali hassan`. Matching folds both sides anyway.
  if (f.owner.kind === 'name') p.set(P.owner, `name:${f.owner.name}`)
  else {
    const owner = ownerKey(f.owner)
    if (owner !== '') p.set(P.owner, owner)
  }
  if (f.search.trim() !== '') p.set(P.q, f.search.trim())
  if (f.scope !== EMPTY_FILTER.scope) p.set(P.scope, f.scope)
  if (f.mine) p.set(P.mine, '1')
  if (f.from !== null) p.set(P.from, f.from)
  if (f.to !== null) p.set(P.to, f.to)
  if (f.sort !== EMPTY_FILTER.sort) p.set(P.sort, f.sort)
  return p
}

/**
 * Total over any URLSearchParams — an unparseable value is DROPPED, never thrown
 * on and never passed through. This runs on every route render with whatever is
 * in the address bar, including whatever a user pasted into it.
 *
 * The result is freshly constructed rather than spread from EMPTY_FILTER:
 * Object.freeze is SHALLOW, so a spread would hand the caller EMPTY_FILTER's own
 * arrays, and the first screen to push a track id into its filter state would
 * corrupt the shared default for the entire app.
 */
export function filterFromParams(p: URLSearchParams): FilterState {
  return {
    // Not validated against the workspace's groups, exactly as `trackIds` is
    // not validated against its tracks: this module is pure and holds no config,
    // and an id that names nothing simply matches nothing — which is the honest
    // rendering of a link to a group somebody deleted.
    groupIds: splitList(p.get(P.group)),
    trackIds: splitList(p.get(P.track)),
    // Not validated against the workspace's nodes either, for the same reason
    // and with a sharper payoff: a link to an organization somebody archived
    // this morning matches nothing and says so in the facet, rather than being
    // silently dropped into "the whole map" — which would show a reader a full
    // list under a link that promised one branch.
    mapNodeIds: splitList(p.get(P.node)),
    // Blank-only values are dropped rather than kept: `vendor=%20` is not an
    // integrator, and it would fold to '' and match nothing while lighting the
    // badge — an active facet nobody can see or explain.
    vendors: p.getAll(P.vendor).filter((vendor) => vendor.trim() !== ''),
    statuses: splitList(p.get(P.status)).filter(isStatus),
    priorities: splitList(p.get(P.priority)).filter(isPriority),
    types: splitList(p.get(P.type)).filter(isType),
    owner: parseOwner(p.get(P.owner)),
    tags: p.getAll(P.tag).filter((tag) => tag !== ''),
    health: splitList(p.get(P.health)).filter(isHealth),
    search: p.get(P.q) ?? EMPTY_FILTER.search,
    scope: parseScope(p.get(P.scope)),
    mine: p.get(P.mine) === '1',
    from: parseIso(p.get(P.from)),
    to: parseIso(p.get(P.to)),
    sort: parseSort(p.get(P.sort)),
  }
}

function splitList(raw: string | null): string[] {
  if (raw === null || raw === '') return []
  return raw.split(',').filter((v) => v !== '')
}

function isStatus(v: string): v is EntryStatus {
  return Object.hasOwn(STATUS_KEYS, v)
}

function isPriority(v: string): v is EntryPriority {
  return Object.hasOwn(PRIORITY_KEYS, v)
}

function isType(v: string): v is EntryType {
  return Object.hasOwn(TYPE_KEYS, v)
}

function isHealth(v: string): v is HealthLevel {
  return Object.hasOwn(HEALTH_KEYS, v)
}

function parseScope(raw: string | null): EntryScope {
  return raw !== null && Object.hasOwn(SCOPE_KEYS, raw) ? (raw as EntryScope) : EMPTY_FILTER.scope
}

function parseSort(raw: string | null): EntrySort {
  return raw !== null && Object.hasOwn(SORT_KEYS, raw) ? (raw as EntrySort) : EMPTY_FILTER.sort
}

/**
 * A calendar-real `YYYY-MM-DD`, or null.
 *
 * THE SHAPE IS NOT THE CHECK. This used to test `/^\d{4}-\d{2}-\d{2}$/` and
 * hand the string straight back, so `from=2026-13-99` — month 13, day 99 —
 * was accepted as a filter bound. Nothing downstream re-validates it:
 * matchesFilter() compares `day < f.from` as STRINGS, every real date sorts
 * below "2026-13-99", and the list silently emptied with the filter bar showing
 * an active range the user could not tell was nonsense. `2026-02-30` did the
 * same thing more quietly.
 *
 * lib/dates.parseIsoDate is the strict parser — it range-checks and then
 * round-trips through a Date to reject the days that do not exist in that
 * month. Using it here is also what keeps ONE definition of a valid date in the
 * app rather than a shape test that drifts from it.
 */
function parseIso(raw: string | null): IsoDate | null {
  if (raw === null) return null
  // The trimmed form, because parseIsoDate accepts surrounding whitespace and
  // the value is about to be compared with `<` against an exact ISO string.
  const trimmed = raw.trim()
  return parseIsoDate(trimmed) === null ? null : trimmed
}

function parseOwner(raw: string | null): OwnerFilter {
  if (raw === null || raw === '') return { kind: 'any' }
  if (raw === 'me') return { kind: 'me' }
  if (raw === 'none') return { kind: 'unassigned' }
  if (raw.startsWith('id:')) {
    const id = raw.slice(3)
    return id === '' ? { kind: 'any' } : { kind: 'id', id }
  }
  if (raw.startsWith('name:')) {
    const name = raw.slice(5)
    return name === '' ? { kind: 'any' } : { kind: 'name', name }
  }
  return { kind: 'any' }
}
