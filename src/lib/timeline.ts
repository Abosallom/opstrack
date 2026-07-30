// The track timeline, as pure functions: interleave, window, search, break down
// by tag.
//
// THIS IS NOT api/timeline.ts, and that is deliberate rather than a naming
// accident (EXECUTION-PLAN §2.17.1 settles it explicitly). That module asks
// PostgREST a question; this one takes the answer apart. Keeping them separate
// is what makes every ordering, windowing and matching rule below testable with
// no mocking, no fixtures beyond plain objects, and no network — which matters
// because "the timeline interleaves entries and updates in the correct order
// under a date range + search" is a named Wave-3 acceptance criterion (gate e),
// verified against SQL.
//
// THREE RULES THIS FILE OWNS, stated once so the screen never re-decides them:
//
//  1. AN UPDATE'S PARENT IS LOOKED UP BEFORE THE WINDOW IS APPLIED. An entry
//     raised in January with an update posted in July belongs on the July page
//     as "an update on ⟨the January item⟩" — so the parent map is built from
//     EVERY entry handed in, and only then are items dropped for falling
//     outside [from, to]. Filtering first would leave July's updates orphaned
//     and the timeline would read as a list of sentences with no subject.
//  2. ORDER IS BY PARSED INSTANT, NEVER BY STRING. PostgREST renders a
//     timestamptz as `…354186+00:00` and an optimistic row is `new
//     Date().toISOString()` → `…354Z`; the two sort formats interleave wrongly
//     under a lexicographic compare ('1' < 'Z' at the offset position), so a
//     locally-posted update would jump to the bottom of its own day. Every
//     comparison here goes through Date.parse().
//  3. SEARCH IS AND-OVER-TERMS, matching lib/entryFilter's matchesSearch
//     exactly. Two words narrow; they never widen. A second definition of
//     "matches" is the thing this repo spends most of its rules avoiding.
//
// Windowing compares LOCAL calendar days (instantToIsoDate), because the two
// date inputs on the screen are the user's own calendar. api/timeline.ts bounds
// its query in UTC, so the client narrowing can differ by one day at the very
// edge of the range — the same ±1 drift lib/dates.ts documents and accepts for
// every other age question in the app. Never "fix" it by switching this side to
// UTC: that makes "today" wrong for the person reading the screen.

import { instantToIsoDate } from './dates'
import { isOpen } from './health'
import { normalizeSearch } from './text'
import type { IsoDate, IsoInstant } from './dates'
import type { Entry, EntryUpdate } from '../types'

/**
 * One thing that happened, in the track, at a moment.
 *
 * The shape is EXECUTION-PLAN §2.16's, unchanged. `entry` on an update item is
 * optional because a truncated read can return an update whose parent fell off
 * the end of the entries page — the renderer says so rather than crashing.
 */
export type TimelineItem =
  | { kind: 'entry'; at: IsoInstant; entry: Entry }
  | { kind: 'update'; at: IsoInstant; update: EntryUpdate; entry: Entry | undefined }

export type TimelineKind = TimelineItem['kind']

export interface BuildTimelineOptions {
  /** Free text, ANDed over whitespace-separated terms. */
  search?: string
  /** Inclusive local calendar bounds. Null/absent ⇒ unbounded on that side. */
  from?: IsoDate | null
  to?: IsoDate | null
  /** Which kinds to keep. Absent ⇒ both. */
  kinds?: readonly TimelineKind[]
}

export interface TagBreakdownRow {
  tag: string
  open: number
  closed: number
}

/** Open/closed split for the rows carrying no tag at all. */
export interface UntaggedCount {
  open: number
  closed: number
}

/** Items sharing one local calendar day, in the order they will render. */
export interface TimelineDay {
  day: IsoDate
  items: TimelineItem[]
}

/* ══════════════════════════ the interleave ══════════════════════════ */

/**
 * Entries and their thread rows as one newest-first stream.
 *
 * An ENTRY item is stamped at `created_at` — the moment the item was raised,
 * which is the event a timeline is recording. It is deliberately NOT
 * `last_activity_at`: that would move the item every time anything happened to
 * it, so a January request touched yesterday would file itself under yesterday
 * and the history would rewrite itself on every read.
 *
 * The tiebreak, for two events at the same instant: updates first, then
 * entries, then id ascending. In a newest-first list "first" means "later", and
 * an update stamped at its parent's creation instant is the transition the
 * create wrote — it did happen after. Total order, so two loads of the same
 * data can never render in two orders.
 */
export function buildTimeline(
  entries: Entry[],
  updates: EntryUpdate[],
  opts?: BuildTimelineOptions,
): TimelineItem[] {
  // Built from EVERY entry, before any filtering — see rule 1 in the header.
  const parents = new Map<string, Entry>()
  for (const entry of entries) parents.set(entry.id, entry)

  const terms = searchTerms(opts?.search)
  const from = opts?.from ?? null
  const to = opts?.to ?? null
  const kinds = opts?.kinds

  const items: TimelineItem[] = []

  if (wants(kinds, 'entry')) {
    for (const entry of entries) {
      if (!inWindow(entry.created_at, from, to)) continue
      if (!matchesEntry(entry, terms)) continue
      items.push({ kind: 'entry', at: entry.created_at, entry })
    }
  }

  if (wants(kinds, 'update')) {
    for (const update of updates) {
      if (!inWindow(update.created_at, from, to)) continue
      const parent = parents.get(update.entry_id)
      if (!matchesUpdate(update, parent, terms)) continue
      items.push({ kind: 'update', at: update.created_at, update, entry: parent })
    }
  }

  items.sort(compareItems)
  return items
}

/**
 * A stable React key. Entry ids and update ids are both uuids from different
 * tables, so the kind prefix is what stops a (theoretically) shared uuid
 * collapsing two rows into one.
 */
export function timelineKey(item: TimelineItem): string {
  return item.kind === 'entry' ? `e:${item.entry.id}` : `u:${item.update.id}`
}

/** The LOCAL calendar day an item files under. '' for an unparseable instant. */
export function timelineDay(item: TimelineItem): IsoDate {
  return instantToIsoDate(item.at)
}

/**
 * Consecutive runs of one day, in the order the items already have.
 *
 * Runs, not a group-by-map: the list is already sorted, so a day can be closed
 * the moment the next item disagrees with it, and the result inherits the
 * ordering rather than needing to be re-sorted by key.
 */
export function groupByDay(items: TimelineItem[]): TimelineDay[] {
  const days: TimelineDay[] = []
  for (const item of items) {
    const day = timelineDay(item)
    const last = days[days.length - 1]
    if (last !== undefined && last.day === day) last.items.push(item)
    else days.push({ day, items: [item] })
  }
  return days
}

/* ══════════════════════════ the tag breakdown ══════════════════════════ */

/**
 * How a set of entries splits across a list of tags — the question
 * `tracks.suggested_tags` exists to answer.
 *
 * Onboarding is the motivating case and the one the digest samples: the track
 * suggests `direct-integration` and `portal`, and the useful fact about it is
 * never "18 open items", it is "11 direct-integration, 7 portal". The tag list
 * is an ARGUMENT rather than something derived here, because the caller decides
 * whether it is the track's own suggestions, everything present in the data, or
 * both — and the digest passes a different list from this screen.
 *
 * COUNTS OVERLAP BY DESIGN. An entry carrying both tags is counted under both,
 * so the column does not sum to the window's size. That is the honest reading of
 * a tag, and the screen says so in one line rather than inventing a primary tag.
 *
 * Matching is folded on both sides (normalizeSearch, not foldKey) so an Arabic
 * tag typed with a different hamza carrier still matches, while the hyphen in
 * `direct-integration` stays meaningful — exactly the rule lib/entryFilter's
 * matchesTags uses, so a tag row and a tag filter can never disagree.
 */
export function tagBreakdown(entries: Entry[], tags: string[]): TagBreakdownRow[] {
  const wanted = dedupeTags(tags)
  if (wanted.length === 0) return []

  const rows = wanted.map((tag) => ({ tag, open: 0, closed: 0 }))
  const index = new Map(wanted.map((tag, i) => [normalizeSearch(tag), i]))

  for (const entry of entries) {
    const open = isOpen(entry.status)
    // Per ENTRY, not per tag occurrence: a row that somehow carries the same
    // tag twice must count once.
    const seen = new Set<number>()
    for (const raw of entry.tags) {
      const at = index.get(normalizeSearch(raw))
      if (at === undefined || seen.has(at)) continue
      seen.add(at)
      if (open) rows[at].open += 1
      else rows[at].closed += 1
    }
  }

  return rows
}

/** The rows the breakdown above cannot see, because they carry no tag at all. */
export function countUntagged(entries: readonly Entry[]): UntaggedCount {
  const out: UntaggedCount = { open: 0, closed: 0 }
  for (const entry of entries) {
    if (entry.tags.length > 0) continue
    if (isOpen(entry.status)) out.open += 1
    else out.closed += 1
  }
  return out
}

/**
 * The tag vocabulary a track view offers: the track's own suggestions first, in
 * the admin's order, then everything else the data actually holds, alphabetical.
 *
 * The order is the point. A suggested tag with zero items still earns a row —
 * "nothing came through the portal this month" is an answer, and a breakdown
 * that hid it would leave the reader unable to tell that from "we do not track
 * that". Tags only present in the data come after, because they were typed
 * rather than agreed.
 */
export function windowTags(entries: readonly Entry[], suggested: readonly string[]): string[] {
  const out = dedupeTags(suggested)
  const known = new Set(out.map((tag) => normalizeSearch(tag)))

  const found: string[] = []
  for (const entry of entries) {
    for (const raw of entry.tags) {
      const tag = raw.trim()
      if (tag === '') continue
      const folded = normalizeSearch(tag)
      if (folded === '' || known.has(folded)) continue
      known.add(folded)
      found.push(tag)
    }
  }

  found.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return [...out, ...found]
}

/* ══════════════════════════ merging ══════════════════════════ */

/**
 * A fetched window, refreshed by whatever the live store already knows.
 *
 * The timeline reads its own window through api/timeline.ts rather than through
 * store/entries, so nothing about it is realtime on its own. Overlaying the
 * store's rows costs one pass and buys the whole live half back: an item
 * retitled, closed or captured in another tab while this screen is open shows
 * its current state instead of the state it had when the range was chosen.
 *
 * The OVERLAY WINS on a shared id — it is the newer of the two by construction
 * (the store is fed by realtime and by this client's own settled writes). Rows
 * only the overlay has are appended: they are usually a capture that landed
 * after the fetch, and buildTimeline's window filter decides whether they
 * actually belong on screen.
 */
export function mergeEntriesById(base: readonly Entry[], overlay: readonly Entry[]): Entry[] {
  if (overlay.length === 0) return [...base]
  const byId = new Map<string, Entry>()
  for (const entry of base) byId.set(entry.id, entry)
  for (const entry of overlay) byId.set(entry.id, entry)
  return [...byId.values()]
}

/* ══════════════════════════ internals ══════════════════════════ */

function wants(kinds: readonly TimelineKind[] | undefined, kind: TimelineKind): boolean {
  return kinds === undefined || kinds.includes(kind)
}

/**
 * Newest first, with the total tiebreak this file's header promises.
 *
 * An unparseable instant sorts to the very end rather than poisoning the
 * comparator with NaN — a NaN comparison makes Array.sort's result
 * implementation-defined for the WHOLE array, so one bad row would scramble a
 * page of good ones.
 */
function compareItems(a: TimelineItem, b: TimelineItem): number {
  const ta = instantMs(a.at)
  const tb = instantMs(b.at)
  if (ta !== tb) return tb - ta
  if (a.kind !== b.kind) return a.kind === 'update' ? -1 : 1
  const ia = itemId(a)
  const ib = itemId(b)
  return ia < ib ? -1 : ia > ib ? 1 : 0
}

function itemId(item: TimelineItem): string {
  return item.kind === 'entry' ? item.entry.id : item.update.id
}

/** Epoch ms, with an unparseable instant pushed to the bottom of the list. */
function instantMs(at: IsoInstant): number {
  const ms = Date.parse(at)
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms
}

function inWindow(at: IsoInstant, from: IsoDate | null, to: IsoDate | null): boolean {
  if (from === null && to === null) return true
  const day = instantToIsoDate(at)
  // An instant that will not parse has no day, so it cannot be shown to be
  // inside a window. Dropping it is the conservative half of the two options.
  if (day === '') return false
  if (from !== null && day < from) return false
  if (to !== null && day > to) return false
  return true
}

function searchTerms(search: string | undefined): string[] {
  if (search === undefined) return []
  return normalizeSearch(search).split(' ').filter(Boolean)
}

function matchesEntry(entry: Entry, terms: readonly string[]): boolean {
  if (terms.length === 0) return true
  const haystack = normalizeSearch([entry.title, entry.description, entry.tags.join(' ')].join(' '))
  return terms.every((term) => haystack.includes(term))
}

/**
 * An update matches on its own body OR on its parent's title and tags.
 *
 * Searching a timeline for a project name has to surface the conversation about
 * it, not only the line that happens to repeat the name — an update reading
 * "vendor confirmed Thursday" is exactly what the searcher wants and contains
 * none of their words. The status transition is NOT part of the haystack: the
 * two labels are resolved from the vocabulary store at render, and a pure
 * function that guessed at them would drift the day an admin renamed a status.
 */
function matchesUpdate(
  update: EntryUpdate,
  parent: Entry | undefined,
  terms: readonly string[],
): boolean {
  if (terms.length === 0) return true
  const parts = [update.body]
  if (parent) parts.push(parent.title, parent.tags.join(' '))
  const haystack = normalizeSearch(parts.join(' '))
  return terms.every((term) => haystack.includes(term))
}

/** Trim, drop blanks, dedupe on the folded form, keep the first spelling seen. */
function dedupeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of tags) {
    const tag = raw.trim()
    if (tag === '') continue
    const folded = normalizeSearch(tag)
    if (folded === '' || seen.has(folded)) continue
    seen.add(folded)
    out.push(tag)
  }
  return out
}
