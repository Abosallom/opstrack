// The minutes document: a finished meeting, turned into something a person can
// read and send.
//
// PURE, AND THAT IS THE WHOLE DESIGN. Nothing here touches React, a store, an
// api module or the global locale. `buildMinutes()` takes the three row sets a
// meeting produces (the meeting, its captured lines, the entries triage created
// from them) and returns a MinutesModel in which EVERY STRING IS ALREADY
// RESOLVED for one explicitly requested locale. The two renderers below turn
// that model into text; `pages/meetings/MeetingMinutes.tsx` maps the SAME model
// into DOM. So the document on screen and the text on the clipboard cannot
// drift — there is one model and three presentations of it, not three
// implementations of the same document.
//
// WHY THE LOCALE IS A PARAMETER AND t() IS NEVER CALLED. t() resolves against
// lib/i18n's module-global current locale, so a builder that used it would
// ignore its own argument — and the point of the language switch on the minutes
// screen is to produce an ARABIC minutes document while the UI is in English
// (an Arabic-speaking team sending a record to an English-speaking vendor, or
// the reverse). lib/dates.ts made the same call for the same reason and its
// header spells out the rest of the argument; this module reads its own
// namespace files the same way that one reads `date.*`.
//
// WHY IT IMPORTS THE TWO JSON FILES DIRECTLY INSTEAD OF `../locales`.
// `src/locales/index.ts` is integrator-owned after Wave 1 (§1.0.2), so the
// `minutes` namespace is registered in the merged bundles by the wave
// integrator, not by this worker. Reading `locales/{en,ar}/minutes.json`
// directly makes this module — and its test — correct on both sides of that
// registration, with no second copy of any string: the JSON files are the one
// source, and t('minutes.…') in the page reads the very same content through
// the merged bundle once it is registered. The import graph stays JSON-only, so
// this file remains vitest-testable with zero mocking and pulls in no DOM.
//
// WHY THERE IS NO INJECTED `now`. Minutes are a RECORD, not a dashboard: every
// date in them is absolute ("03/08/2026"), never relative ("in 3 days"), so the
// document reads identically the day it is written and six months later when
// someone digs it out of an email. That also means this module has no clock to
// stub and no test that can rot on a Tuesday.
//
// RESOLVERS, NOT ROW ARRAYS. Owner names live behind `api/members.Member` and
// vocabulary labels behind `store/vocab`, and contracts rule 2 forbids
// `src/lib/**` from importing either. So the caller hands in three small
// functions instead. That is not a workaround — it is what keeps this file
// testable from a fixture with no Supabase, no zustand and no React, which is
// the property the whole `lib/` layer is organised around.

import { formatDate, formatDateLong, instantToIsoDate } from './dates'
import type { Locale } from './i18n'
import type { LocaleTree } from '../locales'
import arMinutes from '../locales/ar/minutes.json'
import enMinutes from '../locales/en/minutes.json'
import type { Entry, EntryType, Meeting, MeetingLine, VocabKind } from '../types'

/* ─────────────────────────────── the model ─────────────────────────────── */

export type MinutesFormat = 'markdown' | 'plain'

/**
 * The five bands of a minutes document, in the order they are rendered.
 *
 * `items` is everything that is neither a decision nor an action — an issue
 * raised, a request logged, an escalation. They are NOT folded into Actions:
 * "who owes what" is the question the Actions band answers, and an issue
 * somebody merely reported is not an answer to it.
 *
 * `notes` are the lines triage DISCARDED. They survive as notes by spec §4.6
 * rather than being deleted, because "we discussed it and decided it was
 * nothing" is a fact the next reader of these minutes needs.
 *
 * `untriaged` is the honest state of a meeting that was ended without finishing
 * triage. Hiding those lines would make the document quietly incomplete.
 */
export type MinutesSectionKind = 'decisions' | 'actions' | 'items' | 'notes' | 'untriaged'

/** Which header row this is, so the page can style/label rows individually. */
export type MinutesFieldKey = 'date' | 'time' | 'track' | 'attendees' | 'recordedBy'

/**
 * One `Label: value` row of the document header. Absent fields are omitted.
 *
 * `parts` and `value` carry the same content twice on purpose. The DOM gets
 * `value` and lets the browser's own bidi algorithm handle it; the TEXT
 * renderers walk `parts` and fence each one separately, because a LIST of Latin
 * names joined by Arabic commas is the one header row that reorders visibly —
 * fencing the joined string would keep the punctuation inside the isolate and
 * change nothing at all. Every field but `attendees` has exactly one part.
 */
export interface MinutesField {
  key: MinutesFieldKey
  label: string
  parts: string[]
  /** What `parts` were joined with. '' when there is only one. */
  sep: string
  /** `parts.join(sep)` — the convenience form, for rendering into the DOM. */
  value: string
}

export type MinutesMetaKind = 'owner' | 'due' | 'status' | 'priority' | 'track' | 'type'

/** One `Owner: Sara` fragment trailing an item. Label and value are resolved. */
export interface MinutesMeta {
  kind: MinutesMetaKind
  label: string
  value: string
}

export interface MinutesItem {
  /** Stable across rebuilds — the entry id, or the meeting-line id for a note. */
  key: string
  /** Set when this item is a real entry, so the page can link to it. */
  entryId: string | null
  /** The entry title, or the raw captured line for a note. Never empty. */
  text: string
  /** The entry description, trimmed. '' when there is none. */
  detail: string
  meta: MinutesMeta[]
  /** status = done. Drives the Markdown task-list checkbox. */
  done: boolean
  /** status = cancelled. Rendered struck through, never dropped. */
  cancelled: boolean
}

export interface MinutesSection {
  kind: MinutesSectionKind
  heading: string
  /** Rendered as a numbered list — items get a reference number people cite. */
  ordered: boolean
  items: MinutesItem[]
}

export interface MinutesModel {
  locale: Locale
  dir: 'ltr' | 'rtl'
  /** The meeting title, or a localized "Untitled meeting". Never empty. */
  title: string
  /** The meeting's local calendar date, for filenames and grouping. '' if unknown. */
  isoDate: string
  header: MinutesField[]
  /** The attendee list unjoined, for chip rendering. Trimmed, deduped, ordered. */
  attendees: string[]
  /** `meetings.notes` — what was typed when the meeting was ended. '' when none. */
  closingNotes: string
  /** Heading for the closing-notes band, resolved so renderers hold no strings. */
  closingNotesHeading: string
  sections: MinutesSection[]
  /** No sections and no closing notes: the document has nothing but a header. */
  empty: boolean
  /** The line rendered in place of a body when `empty`. */
  emptyText: string
}

/* ──────────────────────────── caller-supplied ──────────────────────────── */

export interface MinutesInput {
  meeting: Meeting
  /** Every line of the meeting, in any order — sorted by `seq` here. */
  lines: readonly MeetingLine[]
  /** The entries this meeting produced (`entries.meeting_id = meeting.id`). */
  entries: readonly Entry[]
}

/**
 * The three lookups this module may not perform for itself.
 *
 * Each is expected to answer IN THE SAME LOCALE the context asks for — the page
 * builds them from `vocabLabel(getVocabSnapshot(), …, locale)` and
 * `trackLabel(track, locale)`, both of which take an explicit locale for
 * exactly this reason.
 */
export interface MinutesContext {
  locale: Locale
  /** Localized label for a frozen vocabulary key. Never returns empty. */
  vocabLabel: (kind: VocabKind, key: string) => string
  /**
   * A person's display name.
   *
   * Returns NULL when there is nobody — not a localized "Unassigned". The
   * fallback belongs to this module, because the caller's resolver
   * (`store/members.memberLabel`) answers through t() in the UI's locale, and
   * an English "Unassigned" inside an Arabic document is precisely the failure
   * the explicit-locale rule exists to prevent.
   */
  personName: (id: string | null, fallback?: string | null) => string | null
  /** Localized track name, or null for "no track" / "track since deleted". */
  trackName: (trackId: string | null) => string | null
}

/* ──────────────────────────── locale strings ───────────────────────────── */

const BUNDLES: Record<Locale, LocaleTree> = { en: enMinutes, ar: arMinutes }

/**
 * `minutes.*` against an EXPLICITLY requested locale.
 *
 * Mirrors t()'s resolution rules — Arabic falls back to the English string, an
 * unknown key falls back to the key itself — so a gap here reads the same way
 * it does everywhere else in the app. No plural handling: this namespace
 * deliberately contains no counted sentences (the counts ride beside a heading
 * as a bare number, which needs no grammar in either language), so importing
 * lib/plural.ts would be dead weight.
 */
function s(locale: Locale, key: string): string {
  return lookup(BUNDLES[locale], key) ?? lookup(BUNDLES.en, key) ?? key
}

function lookup(tree: LocaleTree, key: string): string | undefined {
  let node: string | LocaleTree | undefined = tree
  for (const part of key.split('.')) {
    if (typeof node !== 'object') return undefined
    node = node[part]
  }
  return typeof node === 'string' ? node : undefined
}

/**
 * Section kind → locale key, as a literal map rather than a template literal.
 *
 * `s(locale, `minutes.sec${kind}`)` would be shorter and INVISIBLE to
 * `lib/localeReach.test.ts`, which finds keys by scanning the source for quoted
 * dotted strings. A key that gate cannot see is a key that ships as a dot path
 * in the UI — the exact Wave-2 failure that test was written after. Every key
 * in this file is a literal for that reason.
 */
const SECTION_KEY: Readonly<Record<MinutesSectionKind, string>> = {
  decisions: 'minutes.secDecisions',
  actions: 'minutes.secActions',
  items: 'minutes.secItems',
  notes: 'minutes.secNotes',
  untriaged: 'minutes.secUntriaged',
}

const META_KEY: Readonly<Record<MinutesMetaKind, string>> = {
  owner: 'minutes.metaOwner',
  due: 'minutes.metaDue',
  status: 'minutes.metaStatus',
  priority: 'minutes.metaPriority',
  track: 'minutes.metaTrack',
  type: 'minutes.metaType',
}

const FIELD_KEY: Readonly<Record<MinutesFieldKey, string>> = {
  date: 'minutes.fieldDate',
  time: 'minutes.fieldTime',
  track: 'minutes.fieldTrack',
  attendees: 'minutes.fieldAttendees',
  recordedBy: 'minutes.fieldRecordedBy',
}

/* ─────────────────────────────── the build ─────────────────────────────── */

/** Statuses that close an entry. Mirrors lib/health's CLOSED set by value. */
const DONE_STATUS = 'done'
const CANCELLED_STATUS = 'cancelled'

/** Priorities loud enough to belong in a written record. */
const LOUD_PRIORITIES: ReadonlySet<string> = new Set(['high', 'critical'])

/** Lines triage kept as prose rather than turning into work. */
const NOTE_STATES: ReadonlySet<MeetingLine['state']> = new Set(['discarded', 'note'])

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/**
 * The 24-hour local clock time of an instant: `14:05`.
 *
 * NOT built with Intl, and that is deliberate on both counts. lib/dates.ts
 * holds the repo's Intl monopoly ("NO OTHER FILE IN THE REPO MAY CONSTRUCT AN
 * Intl.DateTimeFormat") and publishes no time-only formatter; slicing one out
 * of `formatTimestamp()`'s output would depend on a locale-specific separator
 * and ordering. Hand-assembling two zero-padded numbers needs no locale at all
 * — the app renders Latin numerals and a 24-hour clock in BOTH languages by
 * spec §5, which `formatTimestamp`'s `hour12: false` already encodes.
 *
 * EXTENSION SLOT (§1.0.4): this belongs in lib/dates.ts as
 * `formatTime(ts, locale)`. It is duplicated here because that file is not this
 * worker's to edit — same arrangement, and same reasoning, as the BIDI_MARKS
 * copy dates.ts itself carries. See the handoff note.
 */
function clockTime(ts: string): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** Collapse the newline zoo and trim, so a pasted description cannot break a list. */
function cleanBlock(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim()
}

/** Titles arrive from free text; a line break inside one would split the item. */
function cleanLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Which band an entry belongs to, by its frozen type key.
 *
 * The mapping is deliberately narrow: only `decision` and `action` have a
 * dedicated band, and everything else lands in "Other items" WITH its type
 * label attached, so the reader can see that a row is an escalation rather than
 * an action somebody forgot to assign.
 */
export type MinutesEntryBand = Extract<MinutesSectionKind, 'decisions' | 'actions' | 'items'>

export function sectionForType(type: EntryType): MinutesEntryBand {
  if (type === 'decision') return 'decisions'
  if (type === 'action') return 'actions'
  return 'items'
}

/**
 * Build the whole document model.
 *
 * ORDER IS THE ORDER IT WAS SAID IN. The walk is over the LINES, by `seq`, not
 * over the entries: minutes follow the conversation, and a bulk commit writes
 * every entry inside the same second, so `created_at` is a coin flip for exactly
 * the rows that matter most. Entries with no line behind them (captured straight
 * against the meeting, or materialized into it later) come after the transcript,
 * by creation time, with the id as the final tiebreak so two rows written in the
 * same millisecond cannot swap places between renders.
 *
 * A COMMITTED LINE WHOSE ENTRY IS NOT IN `entries` STILL RENDERS, as its own raw
 * text under "Other items". That case is real and not an error: the caller
 * resolves entries out of the working set, which holds OPEN entries, so an
 * action closed during the meeting is exactly the row that can be missing. A
 * minutes document that silently omits a line somebody watched being captured is
 * the worst available outcome — worse than one that shows the line without its
 * owner and due date. It self-heals the moment the entry lands.
 */
export function buildMinutes(input: MinutesInput, ctx: MinutesContext): MinutesModel {
  const { meeting, lines, entries } = input
  const { locale } = ctx
  const dir = locale === 'ar' ? 'rtl' : 'ltr'

  const ordered = [...lines].sort((a, b) => a.seq - b.seq)
  const entryById = new Map(entries.map((e) => [e.id, e]))

  const buckets: Record<MinutesEntryBand, MinutesItem[]> = {
    decisions: [],
    actions: [],
    items: [],
  }
  const notes: MinutesItem[] = []
  const untriaged: MinutesItem[] = []
  const placed = new Set<string>()

  const file = (entry: Entry): void => {
    const kind = sectionForType(entry.type)
    buckets[kind].push(entryItem(entry, kind, meeting, ctx))
    placed.add(entry.id)
  }

  for (const line of ordered) {
    if (line.state === 'committed') {
      const entry = line.entry_id === null ? undefined : entryById.get(line.entry_id)
      if (entry) file(entry)
      else pushIf(buckets.items, lineItem(line))
      continue
    }
    if (NOTE_STATES.has(line.state)) pushIf(notes, lineItem(line))
    else pushIf(untriaged, lineItem(line))
  }

  const loose = entries
    .filter((e) => !placed.has(e.id))
    .sort((a, b) =>
      a.created_at !== b.created_at
        ? a.created_at < b.created_at
          ? -1
          : 1
        : a.id < b.id
          ? -1
          : 1,
    )
  for (const entry of loose) file(entry)

  const sections: MinutesSection[] = []
  pushSection(sections, 'decisions', buckets.decisions, true, locale)
  pushSection(sections, 'actions', buckets.actions, true, locale)
  pushSection(sections, 'items', buckets.items, true, locale)
  pushSection(sections, 'notes', notes, false, locale)
  pushSection(sections, 'untriaged', untriaged, false, locale)

  const attendees = dedupe(meeting.attendees.map(cleanLine).filter((a) => a !== ''))
  const closingNotes = cleanBlock(meeting.notes)

  return {
    locale,
    dir,
    title: cleanLine(meeting.title) || s(locale, 'minutes.untitled'),
    isoDate: instantToIsoDate(meeting.started_at),
    header: headerFields(meeting, attendees, ctx),
    attendees,
    closingNotes,
    closingNotesHeading: s(locale, 'minutes.secClosingNotes'),
    sections,
    empty: sections.length === 0 && closingNotes === '',
    emptyText: s(locale, 'minutes.emptyBody'),
  }
}

/** A line that carried no text is not a bullet; it is nothing. */
function pushIf(out: MinutesItem[], item: MinutesItem | null): void {
  if (item !== null) out.push(item)
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)]
}

/** Empty sections are absent, never rendered as a heading over nothing. */
function pushSection(
  out: MinutesSection[],
  kind: MinutesSectionKind,
  items: MinutesItem[],
  isOrdered: boolean,
  locale: Locale,
): void {
  if (items.length === 0) return
  out.push({ kind, heading: s(locale, SECTION_KEY[kind]), ordered: isOrdered, items })
}

function headerFields(
  meeting: Meeting,
  attendees: string[],
  ctx: MinutesContext,
): MinutesField[] {
  const { locale } = ctx
  const out: MinutesField[] = []

  const isoDate = instantToIsoDate(meeting.started_at)
  if (isoDate !== '') push(out, 'date', [formatDateLong(isoDate, locale)], '', locale)

  const start = clockTime(meeting.started_at)
  if (start !== '') {
    const end = meeting.ended_at === null ? '' : clockTime(meeting.ended_at)
    const time =
      end === ''
        ? `${start}${s(locale, 'minutes.metaSep')}${s(locale, 'minutes.inProgress')}`
        : `${start}${s(locale, 'minutes.timeSep')}${end}`
    push(out, 'time', [time], '', locale)
  }

  const track = ctx.trackName(meeting.track_id)
  if (track !== null && track !== '') push(out, 'track', [track], '', locale)

  if (attendees.length > 0) {
    push(out, 'attendees', attendees, s(locale, 'minutes.listSep'), locale)
  }

  const recorder = ctx.personName(meeting.created_by)
  if (recorder !== null && recorder !== '') push(out, 'recordedBy', [recorder], '', locale)

  return out
}

function push(
  out: MinutesField[],
  key: MinutesFieldKey,
  parts: string[],
  sep: string,
  locale: Locale,
): void {
  out.push({ key, label: s(locale, FIELD_KEY[key]), parts, sep, value: parts.join(sep) })
}

/**
 * One committed entry as a document row.
 *
 * WHAT EARNS A META FRAGMENT is a judgement about a written record, not about a
 * list UI: an unowned ACTION says "Unassigned" out loud because that is the
 * hole a reader must see, while an unowned decision says nothing (a decision
 * belongs to the room). Status appears only once it has moved off `new`,
 * priority only when it is high or critical, and the track only when the entry
 * was filed somewhere other than the meeting's own track — otherwise every row
 * would repeat the header.
 */
function entryItem(
  entry: Entry,
  kind: MinutesEntryBand,
  meeting: Meeting,
  ctx: MinutesContext,
): MinutesItem {
  const { locale } = ctx
  const meta: MinutesMeta[] = []

  if (kind === 'items') {
    meta.push(metaOf('type', ctx.vocabLabel('type', entry.type), locale))
  }

  const owner = ctx.personName(entry.owner_id, entry.owner_name)
  if (owner !== null && owner !== '') {
    meta.push(metaOf('owner', owner, locale))
  } else if (kind === 'actions') {
    meta.push(metaOf('owner', s(locale, 'minutes.unassigned'), locale))
  }

  if (entry.due_date !== null) {
    meta.push(metaOf('due', formatDate(entry.due_date, locale), locale))
  }

  if (entry.status !== 'new') {
    meta.push(metaOf('status', ctx.vocabLabel('status', entry.status), locale))
  }

  if (LOUD_PRIORITIES.has(entry.priority)) {
    meta.push(metaOf('priority', ctx.vocabLabel('priority', entry.priority), locale))
  }

  if (entry.track_id !== null && entry.track_id !== meeting.track_id) {
    const track = ctx.trackName(entry.track_id)
    if (track !== null && track !== '') meta.push(metaOf('track', track, locale))
  }

  return {
    key: entry.id,
    entryId: entry.id,
    text: cleanLine(entry.title),
    detail: cleanBlock(entry.description),
    meta,
    done: entry.status === DONE_STATUS,
    cancelled: entry.status === CANCELLED_STATUS,
  }
}

function metaOf(kind: MinutesMetaKind, value: string, locale: Locale): MinutesMeta {
  return { kind, label: s(locale, META_KEY[kind]), value }
}

/**
 * A line rendered as itself: discarded, still pending, or committed into an
 * entry the caller could not supply. Null when the line carries no text.
 *
 * `entryId` is carried through rather than nulled, so the third case still
 * links: the entry exists, this render just does not have the row.
 */
function lineItem(line: MeetingLine): MinutesItem | null {
  const text = cleanLine(line.raw)
  if (text === '') return null
  return {
    key: line.id,
    entryId: line.entry_id,
    text,
    detail: '',
    meta: [],
    done: false,
    cancelled: false,
  }
}

/* ────────────────────────────── bidi safety ────────────────────────────── */
//
// Minutes leave the app as TEXT — pasted into WhatsApp, Outlook, a ticket — so
// there is no `dir` attribute downstream to lean on, only the Unicode
// bidirectional algorithm and whatever the receiving app does with it. In an
// Arabic document the line
//
//   • ترقية الجدار الناري — المسؤول: Sara · الاستحقاق: 03/08/2026
//
// contains three left-to-right runs (a Latin name, a date, and the separators
// around them). Without isolation the algorithm resolves the neutral characters
// BETWEEN those runs against the paragraph, and the trailing date and its label
// visibly swap ends — the classic "the date jumped to the wrong side" bug that
// makes an otherwise correct Arabic export look broken.
//
// FSI…PDI (U+2068…U+2069) fences each interpolated value so its internal
// direction cannot leak into the line around it. They are invisible, they
// survive a copy/paste, and every modern renderer honours them.

// Written as \u escapes, not glyphs: these two characters are INVISIBLE and
// they reorder the text around them, so a literal in the source is
// unreviewable in a diff and unsearchable in an editor. lib/text.ts's header
// makes that argument at length for the same class of character.
const FSI = '\u2068' // FIRST STRONG ISOLATE
const PDI = '\u2069' // POP DIRECTIONAL ISOLATE

/**
 * Strong right-to-left letters: Hebrew, Arabic, Syriac, Thaana, N'Ko and the
 * Arabic Extended blocks, plus the two Arabic presentation-forms ranges a paste
 * out of Word can carry. Escaped for the reason above — the endpoints of an RTL
 * range cannot be checked by eye once the editor has reordered them.
 *
 * Digits are deliberately NOT here. They are bidi-WEAK, which is exactly why
 * the RTL branch below fences every value rather than testing for content.
 */
const RTL_STRONG = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/

/**
 * Fence a value against the paragraph direction around it.
 *
 * In an RTL document EVERY interpolated value is isolated, including bare
 * numbers and dates: digits are WEAK, so `03/08/2026` takes its direction from
 * its neighbours and is exactly the run that misplaces itself. In an LTR
 * document the isolate is added only when the value actually contains RTL
 * letters, so an all-English document stays byte-for-byte plain — no invisible
 * characters in a file nobody expected them in.
 *
 * ONLY VALUES THAT SHARE A LINE WITH OTHER TEXT ARE FENCED — a header value
 * after its label, an item title before its meta, a meta value between two
 * separators. Whole-line content (the document title, a section heading, a
 * description paragraph) is left alone: it has no neighbours to reorder
 * against, so an isolate there would buy nothing and cost two invisible
 * characters in every heading of every exported document.
 */
function bidi(value: string, dir: 'ltr' | 'rtl'): string {
  if (value === '') return value
  if (dir === 'rtl') return `${FSI}${value}${PDI}`
  return RTL_STRONG.test(value) ? `${FSI}${value}${PDI}` : value
}

/**
 * Strong left-to-right letters: Latin, Latin-1 Supplement through IPA, Greek,
 * Cyrillic and Armenian. Digits are absent for the same reason as above.
 */
const LTR_STRONG = /[A-Za-z\u00C0-\u02FF\u0370-\u058F]/

/**
 * Fence a value that OWNS ITS LINE — a title, a heading, a description
 * paragraph.
 *
 * Fenced only when the value runs against the document's direction, and then
 * for one specific reason: TRAILING PUNCTUATION. An English sentence on its own
 * line inside an Arabic document resolves its letters left-to-right correctly
 * and then hands its final full stop to the paragraph, which parks it at the
 * far end — ".The vendor confirmed the window" is what the reader actually
 * sees. Same-direction content has no such hazard and is left untouched, which
 * is why an all-Arabic heading in an Arabic document carries no invisible
 * characters at all.
 */
function bidiLine(value: string, dir: 'ltr' | 'rtl'): string {
  if (value === '') return value
  const foreign = dir === 'rtl' ? LTR_STRONG : RTL_STRONG
  return foreign.test(value) ? `${FSI}${value}${PDI}` : value
}

/* ─────────────────────────────── renderers ─────────────────────────────── */

/**
 * Characters that change meaning in Markdown.
 *
 * Escaped as a set rather than a blanket `\`-before-punctuation pass, because
 * over-escaping produces `some\.file\.name` in the raw text a plain-text reader
 * sees, and the raw text is half of what this format is for. These six are the
 * ones that actually damage a document: a title containing `**` or `_` silently
 * re-styles the line, `[` starts a link, a backtick opens code, and a leading
 * `#` promotes the fragment to a heading. Backslash goes first so the escapes
 * this function adds are not themselves escaped.
 */
function mdEscape(text: string): string {
  return text.replace(/([\\`*_[\]#])/g, '\\$1')
}

function heading(section: MinutesSection): string {
  return `${section.heading} (${section.items.length})`
}

function metaLine(item: MinutesItem, m: MinutesModel, escape: (s: string) => string): string {
  const sep = s(m.locale, 'minutes.metaSep')
  return item.meta
    .map((meta) => `${escape(meta.label)}: ${bidi(escape(meta.value), m.dir)}`)
    .join(sep)
}

/** A header value, fenced part by part. See MinutesField for why per-part. */
function fieldValue(field: MinutesField, m: MinutesModel, escape: (s: string) => string): string {
  return field.parts.map((part) => bidi(escape(part), m.dir)).join(escape(field.sep))
}

/**
 * The continuation indent for a list item's description, aligned under the
 * item's own text rather than fixed at two spaces.
 *
 * CommonMark measures a lazy continuation against the width of the marker plus
 * its trailing space, so `1. ` needs three and `- ` needs two; a fixed two
 * would dedent the tenth item of a numbered list out of its own bullet. Task
 * list items measure as `- ` — the checkbox is content, not marker.
 */
function contIndent(marker: string, isTask: boolean): string {
  return ' '.repeat(isTask ? 2 : marker.length + 1)
}

/**
 * Markdown, for pasting into a ticket, a wiki or a chat that renders it.
 *
 * The header is a BULLET LIST rather than a run of bold lines: consecutive
 * lines inside one Markdown paragraph collapse into a single wrapped line, so
 * "**Date:** …\n**Track:** …" renders as one run-on sentence in every renderer
 * that follows the spec. A list keeps one field per line everywhere, including
 * in the raw text.
 *
 * Actions are a TASK LIST (`- [ ]` / `- [x]`), which is the one piece of
 * Markdown that carries meaning rather than styling: the reader of a minutes
 * document is looking for what is still outstanding, and GitHub, Notion,
 * Obsidian and Slack canvases all render it as a real checkbox. A cancelled
 * item is checked AND struck through — dropping it would rewrite history.
 */
export function renderMinutesMarkdown(m: MinutesModel): string {
  const out: string[] = []

  out.push(`# ${bidiLine(mdEscape(m.title), m.dir)}`, '')

  for (const field of m.header) {
    out.push(`- **${mdEscape(field.label)}:** ${fieldValue(field, m, mdEscape)}`)
  }
  if (m.header.length > 0) out.push('')

  if (m.empty) {
    out.push(m.emptyText, '')
    return out.join('\n')
  }

  for (const section of m.sections) {
    out.push(`## ${bidiLine(mdEscape(heading(section)), m.dir)}`, '')
    section.items.forEach((item, i) => {
      const isTask = section.kind === 'actions'
      const marker = isTask
        ? item.done || item.cancelled
          ? '- [x]'
          : '- [ ]'
        : section.ordered
          ? `${i + 1}.`
          : '-'
      const text = bidi(mdEscape(item.text), m.dir)
      const body = item.cancelled ? `~~${text}~~` : text
      const meta = metaLine(item, m, mdEscape)
      out.push(`${marker} ${body}${meta === '' ? '' : ` — ${meta}`}`)
      const indent = contIndent(marker, isTask)
      for (const paragraph of item.detail.split('\n')) {
        if (paragraph.trim() !== '') out.push(`${indent}${bidiLine(mdEscape(paragraph.trim()), m.dir)}`)
      }
    })
    out.push('')
  }

  if (m.closingNotes !== '') {
    out.push(`## ${bidiLine(mdEscape(m.closingNotesHeading), m.dir)}`, '')
    for (const paragraph of m.closingNotes.split('\n')) {
      if (paragraph.trim() !== '') out.push(bidiLine(mdEscape(paragraph.trim()), m.dir))
    }
    out.push('')
  }

  return out.join('\n')
}

/**
 * Plain text, for pasting into a chat that renders nothing.
 *
 * Structure comes from BLANK LINES AND INDENTATION, never from punctuation
 * scaffolding: an ASCII rule under a heading cannot line up under Arabic
 * (different glyph widths), and UPPERCASING a heading — the usual plain-text
 * trick — does nothing at all in a script that has no case. Indentation is the
 * one structural signal that works identically in both directions, and it
 * mirrors correctly on its own in an RTL renderer.
 */
export function renderMinutesPlain(m: MinutesModel): string {
  const out: string[] = []
  const identity = (text: string): string => text

  out.push(bidiLine(m.title, m.dir))
  for (const field of m.header) {
    out.push(`${field.label}: ${fieldValue(field, m, identity)}`)
  }

  if (m.empty) {
    out.push('', m.emptyText, '')
    return out.join('\n')
  }

  for (const section of m.sections) {
    out.push('', bidiLine(heading(section), m.dir))
    section.items.forEach((item, i) => {
      const marker = section.ordered ? `${i + 1}.` : '•'
      const meta = metaLine(item, m, identity)
      out.push(`  ${marker} ${bidi(item.text, m.dir)}${meta === '' ? '' : ` — ${meta}`}`)
      const indent = `  ${contIndent(marker, false)}`
      for (const paragraph of item.detail.split('\n')) {
        if (paragraph.trim() !== '') out.push(`${indent}${bidiLine(paragraph.trim(), m.dir)}`)
      }
    })
  }

  if (m.closingNotes !== '') {
    out.push('', bidiLine(m.closingNotesHeading, m.dir))
    for (const paragraph of m.closingNotes.split('\n')) {
      if (paragraph.trim() !== '') out.push(`  ${bidiLine(paragraph.trim(), m.dir)}`)
    }
  }

  out.push('')
  return out.join('\n')
}

export function renderMinutes(m: MinutesModel, format: MinutesFormat): string {
  return format === 'markdown' ? renderMinutesMarkdown(m) : renderMinutesPlain(m)
}
