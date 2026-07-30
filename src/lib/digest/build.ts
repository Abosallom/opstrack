// buildDigestModel() — the whole of the digest's thinking, in one pure function.
//
// PURE BY CONTRACT. No store, no api, no `new Date()`, no `getLocale()`. Rows
// come in, options come in (including the locale and the clock), a finished
// model comes out. That is what lets the Wave-3 gate generate an ARABIC digest
// while the UI sits in ENGLISH, and what lets every test below run with no
// mocking at all.
//
// EVERYTHING USER-VISIBLE IS RESOLVED HERE. The three renderers receive
// sentences, never keys, ids or dates. See types.ts for why.
//
// ── the four rules this file must not get wrong ──────────────────────────
//
// 1. WINDOW MEMBERSHIP is frozen by plan §2.16 and is stated once so the
//    dashboard and the digest cannot disagree: an entry is in [from,to] if
//    `closed_at ∈ window` OR `created_at ∈ window` OR (open AND
//    `last_activity_at ∈ window`) OR (open AND overdue as of `to`). The last
//    clause is the one people drop, and it is the important one — an item that
//    went silent in March and is three months late is the single most important
//    row in a status report, and every other clause excludes it.
//
// 2. ONE SECTION PER ENTRY, in CLASSIFY_ORDER. Same rule bucketFollowUps holds,
//    same reason: a row counted twice makes the section counts stop adding up.
//
// 3. OVERDUE MEANS WHAT FOLLOW-UPS MEANS. `overdueAt()` below is
//    bucketFollowUps' first branch — the view's `days_overdue` when it has
//    spoken, a local date comparison when it has not, and `follow_up_date`
//    lapse counting too — evaluated at `to` instead of at today. If this file
//    invented its own "overdue", the list a person triages in the morning and
//    the digest they send at noon would disagree about what is late.
//
// 4. TOGGLING A SECTION OFF REMOVES ITS ROWS; it does not spill them into
//    another section. Classification runs over the full fixed order first and
//    the selection is applied afterwards, so turning "Overdue" off makes the
//    report shorter rather than quietly swelling "In progress" with late work.
//    `totals.bySection` still counts every kind, which is what lets the screen
//    show the reader exactly how many rows a toggle is costing them.

import { isolate } from './bidi'
import { ds } from './strings'
import {
  CLASSIFY_ORDER,
  type DigestItem,
  type DigestModel,
  type DigestOptions,
  type DigestRows,
  type DigestSection,
  type DigestSectionKind,
  type DigestStrings,
  type DigestTagRow,
  type DigestTotals,
  type DigestTrack,
} from './types'
import {
  diffDays,
  formatDate,
  formatDateRange,
  formatTimestamp,
  formatWeekday,
  instantToIsoDate,
  type IsoDate,
} from '../dates'
import { isOpen } from '../health'
import { truncate } from '../text'
import type { Entry, EntryHealth, Track } from '../../types'
import type { Locale } from '../i18n'

/**
 * How long a range may be before closed rows stop being labelled by weekday.
 *
 * "closed Tue" is the §4.7 sample and is how people talk about a week they just
 * lived through. Past eight days a weekday is ambiguous — "Tue" of which week? —
 * so the label becomes an unambiguous date. The default digest is seven days and
 * therefore always reads the way the spec shows it.
 */
const WEEKDAY_RANGE_DAYS = 8

/** Quoted update bodies, including the ellipsis. A digest is a summary. */
const NOTE_CHARS = 160

/* ───────────────────────────── entry point ──────────────────────────── */

export function buildDigestModel(rows: DigestRows, o: DigestOptions): DigestModel {
  const dir: 'ltr' | 'rtl' = o.locale === 'ar' ? 'rtl' : 'ltr'
  const wrap = (value: string): string => isolate(value, dir)

  // `health` arrives as an array because that is the shape the view returns.
  // Keyed on `entry_id` — the view exposes the id under both names and the
  // other one is the join column, so keying on `id` would work today and break
  // the day someone widens the view.
  const health = new Map<string, EntryHealth>()
  for (const h of rows.health) health.set(h.entry_id ?? h.id, h)

  const owners = new Map<string, string>()
  for (const m of rows.members) {
    const name = m.displayName.trim()
    if (name !== '') owners.set(m.id, name)
  }

  const strings = buildStrings(o.locale, rows.truncated)
  const selected = dedupe(o.sections)
  const weekdayLabels = diffDays(o.from, o.to) <= WEEKDAY_RANGE_DAYS

  // Tracks in their configured order, narrowed to the selection. The synthetic
  // "no track" group rides at the end and only when the user asked for
  // everything — having picked specific tracks, they did not pick that one.
  const wanted = new Set(o.trackIds)
  const orderedTracks = wanted.size === 0 ? rows.tracks : rows.tracks.filter((t) => wanted.has(t.id))
  const known = new Set(rows.tracks.map((t) => t.id))

  // trackId (or '' for none) → the entries of that track that are in the window.
  const grouped = new Map<string, Entry[]>()
  for (const e of rows.entries) {
    if (!inWindow(e, health.get(e.id), o)) continue
    const key = e.track_id !== null && known.has(e.track_id) ? e.track_id : ''
    if (key === '' && wanted.size > 0) continue
    if (key !== '' && wanted.size > 0 && !wanted.has(key)) continue
    const bucket = grouped.get(key)
    if (bucket) bucket.push(e)
    else grouped.set(key, [e])
  }

  const bySection = emptyCounts()
  const tracks: DigestTrack[] = []

  const push = (id: string | null, name: string, entries: Entry[]): void => {
    const classified = classifyAll(entries, health, o)
    for (const kind of CLASSIFY_ORDER) bySection[kind] += classified[kind].length

    const sections: DigestSection[] = []
    for (const kind of selected) {
      const bucket = classified[kind]
      if (bucket.length === 0) continue
      sections.push({
        kind,
        heading: ds(o.locale, `digest.section${capitalize(kind)}`),
        count: bucket.length,
        items: bucket.map((e) =>
          toItem(e, kind, health.get(e.id), rows, o, owners, wrap, weekdayLabels),
        ),
      })
    }

    const count = sections.reduce((n, s) => n + s.count, 0)
    if (count === 0 && !o.includeEmptyTracks) return
    tracks.push({
      id,
      name: wrap(name),
      sections,
      tagBreakdown: buildTagRows(entries, tagsFor(id, rows, o), o, wrap),
      count,
    })
  }

  for (const track of orderedTracks) {
    push(track.id, trackName(track, o.locale), grouped.get(track.id) ?? [])
  }
  const untracked = grouped.get('')
  if (untracked !== undefined && untracked.length > 0) {
    push(null, ds(o.locale, 'digest.noTrack'), untracked)
  }

  const totals: DigestTotals = {
    bySection,
    entries: tracks.reduce((n, t) => n + t.count, 0),
    tracks: tracks.filter((t) => t.count > 0).length,
  }

  return {
    locale: o.locale,
    dir,
    from: o.from,
    to: o.to,
    title: ds(o.locale, 'digest.docTitle'),
    rangeLabel: ds(o.locale, 'digest.rangeLabel', {
      range: wrap(formatDateRange(o.from, o.to, o.locale)),
    }),
    generatedLabel: ds(o.locale, 'digest.generatedLabel', {
      at: wrap(formatTimestamp(o.now.toISOString(), o.locale)),
    }),
    summaryLine: buildSummary(selected, bySection, totals.entries, o.locale),
    sections: selected,
    tracks,
    totals,
    strings,
    empty: totals.entries === 0,
  }
}

/* ─────────────────────────── window and buckets ─────────────────────── */

/**
 * Plan §2.16's frozen membership rule, verbatim.
 *
 * Compared as ISO DATE STRINGS. Every bound in this file is a calendar day and
 * ISO dates compare correctly lexicographically, so no parse anywhere here can
 * get a timezone wrong — the trap lib/dates.ts's header is written around.
 */
function inWindow(e: Entry, h: EntryHealth | undefined, o: DigestOptions): boolean {
  const from = o.from
  const to = o.to
  if (e.closed_at !== null && within(instantToIsoDate(e.closed_at), from, to)) return true
  if (within(instantToIsoDate(e.created_at), from, to)) return true
  if (!isOpen(e.status)) return false
  if (within(instantToIsoDate(e.last_activity_at), from, to)) return true
  return overdueAt(e, h, to)
}

function within(day: IsoDate, from: IsoDate, to: IsoDate): boolean {
  return day >= from && day <= to
}

/**
 * bucketFollowUps' overdue branch, evaluated at `asOf` instead of at today.
 *
 * The view is authoritative WHEN IT HAS SPOKEN — but only for "today", because
 * `days_overdue` is computed against the server's `current_date`. A digest of a
 * past window has to ask about that window's end instead, so the view's answer
 * is used as a floor (it knows about rows this client has never fetched) and the
 * local comparison does the arithmetic. `follow_up_date` is never in the view at
 * all, so that half is always local — and it counts, because a lapsed follow-up
 * is a promise to look again that nobody kept.
 */
function overdueAt(e: Entry, h: EntryHealth | undefined, asOf: IsoDate): boolean {
  if (e.due_date !== null && e.due_date < asOf) return true
  if (e.follow_up_date !== null && e.follow_up_date < asOf) return true
  return h !== undefined && h.days_overdue > 0 && (e.due_date === null || e.due_date < asOf)
}

type Classified = Record<DigestSectionKind, Entry[]>

function classifyAll(
  entries: Entry[],
  health: ReadonlyMap<string, EntryHealth>,
  o: DigestOptions,
): Classified {
  const out: Classified = {
    closed: [],
    inProgress: [],
    blocked: [],
    overdue: [],
    slaBreached: [],
  }
  for (const e of entries) out[classify(e, health.get(e.id), o.to)].push(e)
  return out
}

/** CLASSIFY_ORDER as code. Keep the two in step — types.ts documents the order. */
function classify(e: Entry, h: EntryHealth | undefined, asOf: IsoDate): DigestSectionKind {
  if (!isOpen(e.status)) return 'closed'
  if (overdueAt(e, h, asOf)) return 'overdue'
  if (h?.sla_breached === true) return 'slaBreached'
  if (e.status === 'blocked' || e.status === 'waiting_on') return 'blocked'
  return 'inProgress'
}

/* ───────────────────────────────── items ────────────────────────────── */

function toItem(
  e: Entry,
  kind: DigestSectionKind,
  h: EntryHealth | undefined,
  rows: DigestRows,
  o: DigestOptions,
  owners: ReadonlyMap<string, string>,
  wrap: (v: string) => string,
  weekdayLabels: boolean,
): DigestItem {
  return {
    id: e.id,
    title: wrap(e.title.trim() === '' ? ds(o.locale, 'digest.untitled') : e.title.trim()),
    owner: wrap(ownerOf(e, owners, o.locale)),
    detail: detailOf(e, kind, h, o, wrap, weekdayLabels),
    note: o.includeNotes ? noteOf(e, rows, wrap) : null,
    flag: kind === 'overdue' || kind === 'blocked' || kind === 'slaBreached',
  }
}

/**
 * owner_id → owner_name → "Unassigned", in an EXPLICIT locale.
 *
 * store/members' `memberLabel()` is the same chain and is deliberately NOT used:
 * its last step is `t('entry.unassigned')`, which resolves in the UI's locale
 * and would put one English word in the middle of an Arabic report. (It is also
 * in store/, which lib/ may not import.) A member row with a blank display name
 * falls through for the reason that function documents — a name-shaped hole is
 * worse than the honest "Unassigned".
 */
function ownerOf(e: Entry, owners: ReadonlyMap<string, string>, locale: Locale): string {
  const named = e.owner_id !== null ? owners.get(e.owner_id) : undefined
  if (named !== undefined) return named
  const free = e.owner_name?.trim()
  if (free) return free
  return ds(locale, 'digest.unassigned')
}

function detailOf(
  e: Entry,
  kind: DigestSectionKind,
  h: EntryHealth | undefined,
  o: DigestOptions,
  wrap: (v: string) => string,
  weekdayLabels: boolean,
): string {
  switch (kind) {
    case 'closed': {
      // closed_at is maintained in both directions by 0001's trigger, but an
      // entry can be `done` with a null closed_at on a row written before that
      // trigger existed; updated_at is the honest second best.
      const iso = instantToIsoDate(e.closed_at ?? e.updated_at)
      const when = weekdayLabels ? formatWeekday(iso, o.locale, 'short') : formatDate(iso, o.locale)
      return ds(o.locale, 'digest.detailClosed', {
        when: wrap(when === '' ? formatDate(iso, o.locale) : when),
      })
    }
    case 'overdue':
      return ds(o.locale, 'digest.detailOverdue', { count: overdueDays(e, h, o.to) })
    case 'slaBreached': {
      const due = h?.sla_due_at
      if (!due) return ds(o.locale, 'digest.detailSlaNoDate')
      return ds(o.locale, 'digest.detailSla', {
        date: wrap(formatDate(instantToIsoDate(due), o.locale)),
      })
    }
    case 'blocked': {
      // The status word, not a hardcoded "Blocked": `blocked` and `waiting_on`
      // both land here, an admin may have renamed either, and the reader needs
      // to know which of the two it is.
      const status = wrap(o.vocabLabel('status', e.status))
      const days = quietDays(e, h, o)
      return days === 0
        ? ds(o.locale, 'digest.detailBlockedToday', { status })
        : ds(o.locale, 'digest.detailBlocked', { status, count: days })
    }
    case 'inProgress': {
      if (e.due_date !== null) {
        return ds(o.locale, 'digest.detailDue', { date: wrap(formatDate(e.due_date, o.locale)) })
      }
      // Zero gets its own sentence rather than a plural form: English has no
      // CLDR `zero` category, so "0 days without an update" is the only thing a
      // plural node could say about an item touched this morning.
      const days = quietDays(e, h, o)
      return days === 0
        ? ds(o.locale, 'digest.detailQuietToday')
        : ds(o.locale, 'digest.detailQuiet', { count: days })
    }
  }
}

/**
 * How late, in days, as of the window's end.
 *
 * The view's count is preferred when it agrees that the item is late TODAY and
 * the window ends today; otherwise the arithmetic is local, against whichever of
 * the two dates actually lapsed. Never negative — a zero here would read as "0
 * days overdue" on a row the classifier already decided is late.
 */
function overdueDays(e: Entry, h: EntryHealth | undefined, asOf: IsoDate): number {
  const lapsed: IsoDate[] = []
  if (e.due_date !== null && e.due_date < asOf) lapsed.push(e.due_date)
  if (e.follow_up_date !== null && e.follow_up_date < asOf) lapsed.push(e.follow_up_date)
  if (lapsed.length > 0) {
    const oldest = lapsed.reduce((a, b) => (a < b ? a : b))
    return Math.max(1, diffDays(oldest, asOf))
  }
  return Math.max(1, h?.days_overdue ?? 1)
}

/**
 * Days since anything happened to this entry.
 *
 * The view's `days_since_activity` when it has one (it counts against the
 * server's UTC current_date, the ±1 day drift lib/dates.ts documents and
 * accepts), otherwise the local count against the window's end. Used for
 * blocked and for undated in-progress rows, which are the two cases where "how
 * long has this been sitting there" is the only useful thing left to say.
 */
function quietDays(e: Entry, h: EntryHealth | undefined, o: DigestOptions): number {
  if (h !== undefined) return Math.max(0, h.days_since_activity)
  return Math.max(0, diffDays(instantToIsoDate(e.last_activity_at), o.to))
}

function noteOf(e: Entry, rows: DigestRows, wrap: (v: string) => string): string | null {
  const body = rows.lastUpdate.get(e.id)?.body.replace(/\s+/g, ' ').trim() ?? ''
  return body === '' ? null : wrap(truncate(body, NOTE_CHARS))
}

/* ──────────────────────────── tag breakdown ─────────────────────────── */

/**
 * ONE MECHANISM, NOT TWO (plan §2.16 / §7's tag-breakdown row).
 *
 * `options.tagBreakdown` undefined → each track breaks out its OWN
 * `suggested_tags`, which is how Onboarding gets `direct-integration` and
 * `portal` (0004) with nothing in the codebase naming a track. An explicit array
 * overrides that for every track; an explicit EMPTY array is the off switch.
 */
function tagsFor(id: string | null, rows: DigestRows, o: DigestOptions): string[] {
  if (o.tagBreakdown !== undefined) return o.tagBreakdown
  if (id === null) return []
  return rows.tracks.find((t) => t.id === id)?.suggested_tags ?? []
}

function buildTagRows(
  entries: Entry[],
  tags: string[],
  o: DigestOptions,
  wrap: (v: string) => string,
): DigestTagRow[] {
  if (tags.length === 0 || entries.length === 0) return []

  const rows: DigestTagRow[] = tags.map((tag) => ({
    kind: 'tag',
    tag,
    label: wrap(tag),
    open: 0,
    closed: 0,
    total: 0,
  }))
  const other: DigestTagRow = {
    kind: 'other',
    tag: '',
    label: ds(o.locale, 'digest.tagOther'),
    open: 0,
    closed: 0,
    total: 0,
  }

  // Open vs closed only: `isOpen()` is the frozen definition and the health row
  // adds nothing a tag breakdown asks about. A row carrying two of the listed
  // tags is counted under BOTH — the columns answer "how much of this track is
  // portal work", not "how do these rows partition", and the `other` row exists
  // to keep the reader from reading them as a partition.
  for (const e of entries) {
    const open = isOpen(e.status)
    let matched = false
    for (const row of rows) {
      if (!e.tags.includes(row.tag)) continue
      matched = true
      row.total += 1
      if (open) row.open += 1
      else row.closed += 1
    }
    if (matched) continue
    other.total += 1
    if (open) other.open += 1
    else other.closed += 1
  }

  // The catch-all earns its line only when it has rows; a breakdown that always
  // ends in "Other 0" trains the reader to stop looking at the last line.
  return other.total > 0 ? [...rows, other] : rows
}

/* ───────────────────────────── fixed strings ────────────────────────── */

function buildStrings(locale: Locale, truncated: boolean): DigestStrings {
  return {
    tagHeading: ds(locale, 'digest.tagHeading'),
    tagColumn: ds(locale, 'digest.tagColumn'),
    openColumn: ds(locale, 'digest.openColumn'),
    closedColumn: ds(locale, 'digest.closedColumn'),
    totalColumn: ds(locale, 'digest.totalColumn'),
    trackAllClear: ds(locale, 'digest.trackAllClear'),
    empty: ds(locale, 'digest.emptyWindow'),
    notePrefix: ds(locale, 'digest.notePrefix'),
    truncatedNote: truncated ? ds(locale, 'digest.truncatedNote') : '',
    footer: ds(locale, 'digest.footer'),
  }
}

/**
 * "3 closed · 5 in progress · 1 blocked" — only the sections that were emitted,
 * only the ones with rows, in the emitted order.
 *
 * A count of zero is dropped rather than printed: a summary line reading
 * "0 blocked" invites the reader to congratulate themselves on a section that
 * was empty because nobody looked, and the section itself is already omitted.
 */
function buildSummary(
  selected: readonly DigestSectionKind[],
  bySection: Record<DigestSectionKind, number>,
  total: number,
  locale: Locale,
): string {
  if (total === 0) return ds(locale, 'digest.summaryEmpty')
  const parts = selected
    .filter((kind) => bySection[kind] > 0)
    .map((kind) => ds(locale, `digest.sum${capitalize(kind)}`, { count: bySection[kind] }))
  return parts.join(ds(locale, 'digest.sep'))
}

/* ──────────────────────────────── helpers ───────────────────────────── */

function emptyCounts(): Record<DigestSectionKind, number> {
  return { closed: 0, inProgress: 0, blocked: 0, overdue: 0, slaBreached: 0 }
}

/**
 * Section keys are camelCase and their locale keys are `digest.sectionClosed` /
 * `digest.sumSlaBreached`, so the first letter is uppercased rather than the
 * whole key being repeated in a lookup table nobody would keep in step.
 */
function capitalize(kind: DigestSectionKind): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1)
}

/**
 * `lib/labels.trackLabel()`, restated — the ONE place this module departs from
 * its consumed-contracts list, and the reason is mechanical, not stylistic.
 *
 * `lib/labels.ts` imports `useLocale` from `lib/i18n` as a VALUE (it also
 * exports the `useTrackLabel` hook), and `lib/i18n.ts` reads `localStorage` at
 * MODULE SCOPE. Importing `trackLabel` therefore puts a DOM dependency in the
 * import graph of this file, and every digest test dies with
 * `ReferenceError: localStorage is not defined` under vitest's node environment
 * — the environment `vitest.config.ts`'s header picks precisely because "every
 * module the plan puts under test … including the digest renderers … is pure by
 * construction". A test that needs a document is a sign the logic is in the
 * wrong layer, and the layer that is wrong here is not this one.
 *
 * The rule is copied exactly, including the part that matters: `name_ar` is
 * `not null default ''`, so the fallback tests for EMPTY, not null — a track
 * created before anyone typed an Arabic name shows its English name rather than
 * a blank heading.
 *
 * EXTENSION SLOT (handoff): move `trackLabel` into a pure module — or make
 * `labels.ts`'s i18n import type-only by relocating `useTrackLabel` — and this
 * function becomes one import.
 */
function trackName(track: Track, locale: Locale): string {
  if (locale === 'ar') return track.name_ar.trim() || track.name
  return track.name
}

/** Selection order is honoured verbatim; a repeated kind is not printed twice. */
function dedupe(kinds: readonly DigestSectionKind[]): DigestSectionKind[] {
  return [...new Set(kinds)]
}
