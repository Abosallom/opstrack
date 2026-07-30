// The ONE relative-date and date-formatting implementation.
//
// Every timestamp in this app is either an ISO DATE (`YYYY-MM-DD`, a Postgres
// `date`) or an ISO INSTANT (a `timestamptz`). The two never share a parameter,
// and this is the only module that knows the difference.
//
// TWO TRAPS THIS MODULE EXISTS TO CENTRALISE.
//
// 1. Calendar. `Intl` with `'ar'` defaults to the ISLAMIC calendar and
//    Arabic-Indic numerals, both forbidden by the spec. Every formatter here
//    builds its Intl.DateTimeFormat with 'ar-u-ca-gregory-nu-latn' (EN uses
//    'en-GB', day-first). That is hard-coded in ONE private fmt() helper, and
//    NO OTHER FILE IN THE REPO MAY CONSTRUCT AN Intl.DateTimeFormat. A
//    component calling toLocaleDateString() is a bug, not a shortcut.
//
// 2. UTC drift. `v_entry_health` counts days against the server's UTC
//    current_date; this module uses LOCAL dates, because "due today" has to
//    mean the user's today. Near midnight the two disagree by a day. That is
//    ACCEPTED, not a defect — the age pill is an ageing signal, not an SLA, and
//    0001's own comment says so. Do not "fix" it by switching the client to
//    UTC. Tests assert on a fixed injected `now`; the live comparison in the
//    Wave-1 gate tolerates ±1 day and says so in its header.
//
// parseIsoDate is the specific landmine: `new Date('2026-08-14')` is UTC
// midnight and reads back as Aug 13 anywhere west of Greenwich. Every parse
// below goes through the local-components constructor instead.
//
// WHY THIS FILE READS THE LOCALE BUNDLES DIRECTLY INSTEAD OF CALLING t().
// Every formatter here takes an EXPLICIT `locale` parameter, and `t()` resolves
// against the GLOBAL current locale — so a formatter built on t() would ignore
// its own argument. That is not a theoretical objection: plan §2.16 freezes
// "no digest renderer calls t()", and the Wave-3 gate generates an ARABIC
// digest while the UI is in ENGLISH. Reading `date.*` out of the requested
// bundle keeps the strings in the one place W1-I18N owns (no shadow string
// table to drift) while honouring the argument. The import is JSON only — no
// store, no api, no cycle: locales/index.ts imports nothing but its own files.

import { ar, en } from '../locales'
// lib/plural.ts is a LEAF: it imports nothing at runtime, so this stays a JSON-
// only import graph. The plural rules are shared rather than reimplemented
// because t() and s() must agree on which form a count selects, and two copies
// of a CLDR table is two tables to drift. Importing them from lib/i18n.ts —
// where they briefly lived — is what this arrangement exists to avoid: that
// module reads localStorage at module scope, which is a DOM dependency in the
// import graph of every pure test that touches a date.
import { isPluralNode, selectPlural } from './plural'
import { normalizeSearch } from './text'
import type { LocaleTree } from '../locales'
import type { Locale } from './i18n'

export type IsoDate = string
export type IsoInstant = string

/**
 * The invisible bidi controls an Arabic keyboard, a paste from Word, or a
 * right-to-left chat client sprinkles through typed text: LRM, RLM, ALM, the
 * zero-width joiners, and a stray BOM.
 *
 * They must never block a match — `due:‏غدا` with an RLM after the colon is the
 * same intent as `due:غدا`, and the user cannot see the difference to fix it.
 *
 * BELONGS IN lib/text.ts alongside the other folds; it is duplicated here and
 * in lib/capture/parse.ts because text.ts is keystone-owned and was published
 * complete before this was needed. Extension slot — see the W1-PARSE handoff.
 *
 * Written as \u escapes for the reason lib/text.ts's header spells out: these
 * characters are invisible, several of them reorder the line they appear in,
 * and the endpoints of a range spelled with glyphs cannot be checked in a diff.
 */
const BIDI_MARKS = /[\u200B-\u200F\u061C\uFEFF]/g

/** ISO date, and nothing else: no timestamps, no partial dates, no slop. */
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

const MS_PER_DAY = 86_400_000

const EM_DASH = '—'

// ── locale strings ─────────────────────────────────────────────────────────

const BUNDLES: Record<Locale, LocaleTree> = { en, ar }

/**
 * `date.*` lookup against an EXPLICITLY REQUESTED locale.
 *
 * Mirrors lib/i18n.ts's resolution rules exactly — Arabic falls back to the
 * English string, an unknown key falls back to the key itself — so a missing
 * translation reads the same way here as it does everywhere else in the app.
 *
 * INCLUDING PLURALS, which is why lib/plural.ts is shared rather than
 * reimplemented: nearly every string this module reads is a day or minute
 * count, and `متأخّر 2 يوم` — `date.overdueByDays` before it was pluralized —
 * is exactly the failure the plural node exists to stop. The English fallback is
 * selected with English rules for the reason t() states: the form being read is
 * an English sentence, so asking for its `few` asks a bundle a question it was
 * never written to answer.
 */
function s(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  const raw =
    lookup(BUNDLES[locale], key, locale, vars) ?? lookup(BUNDLES.en, key, 'en', vars) ?? key
  if (!vars) return raw
  return raw.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  )
}

function lookup(
  tree: LocaleTree,
  key: string,
  locale: Locale,
  vars?: Record<string, string | number>,
): string | undefined {
  let node: string | LocaleTree | undefined = tree
  for (const part of key.split('.')) {
    if (typeof node !== 'object') return undefined
    node = node[part]
  }
  if (typeof node === 'string') return node
  if (!isPluralNode(node)) return undefined
  return selectPlural(node, locale, vars?.count)
}

// ── the Intl monopoly ──────────────────────────────────────────────────────

/**
 * `'ar'` alone would give an Islamic calendar and Arabic-Indic digits. Both are
 * forbidden by spec §5: the workspace runs on the Gregorian calendar and
 * renders Latin numerals in both languages, because the entries carry Postgres
 * `date` values that a reader has to be able to match against a ticket.
 */
const INTL_LOCALE: Record<Locale, string> = {
  en: 'en-GB', // day-first; 'en-US' would render 07/29/2026 and mislead half the team
  ar: 'ar-u-ca-gregory-nu-latn',
}

// Intl.DateTimeFormat construction is the expensive half of formatting, and
// these render inside lists of 200 rows. Keyed by locale + options so the cache
// can never hand back a formatter configured for a different call site.
const FORMATTERS = new Map<string, Intl.DateTimeFormat>()

function fmt(locale: Locale, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(opts)}`
  const cached = FORMATTERS.get(key)
  if (cached) return cached
  const made = new Intl.DateTimeFormat(INTL_LOCALE[locale], opts)
  FORMATTERS.set(key, made)
  return made
}

// ── the calendar primitives ────────────────────────────────────────────────

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

export function toIsoDate(d: Date): IsoDate {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function todayIso(now: Date = new Date()): IsoDate {
  return toIsoDate(now)
}

/**
 * LOCAL-calendar parse. Returns null on anything malformed; never throws.
 *
 * Strict on purpose. `new Date('2026-08-14')` is UTC midnight and reads back as
 * Aug 13 west of Greenwich, and `new Date('14/8/2026')` is a browser-specific
 * coin flip — so neither is used. The round-trip check at the end is what
 * rejects 2026-02-30, which the Date constructor would silently roll to Mar 2.
 */
export function parseIsoDate(str: string | null | undefined): Date | null {
  if (typeof str !== 'string') return null
  const m = ISO_DATE_RE.exec(str.trim())
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const d = new Date(year, month - 1, day)
  d.setHours(0, 0, 0, 0)
  // setFullYear, not the constructor's two-digit-year special case: `new
  // Date(26, 0, 1)` is 1926 and would round-trip clean without this.
  d.setFullYear(year)
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null
  return d
}

/**
 * Days added to a calendar date, DST-safe.
 *
 * Arithmetic runs on a UTC anchor rather than on the local Date, because
 * `setDate(getDate() + 1)` across a spring-forward boundary can land on the
 * same calendar day in a zone with a 23-hour day. The result is converted back
 * through local components, so the returned string is still a local calendar
 * date. An unparseable input is returned verbatim — a formatter that mangles
 * bad data into a plausible-looking date is worse than one that passes it
 * through visibly.
 */
export function addDays(iso: IsoDate, n: number): IsoDate {
  const d = parseIsoDate(iso)
  if (!d) return iso
  const anchor = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) + n * MS_PER_DAY
  const out = new Date(anchor)
  return `${out.getUTCFullYear()}-${pad2(out.getUTCMonth() + 1)}-${pad2(out.getUTCDate())}`
}

/**
 * Months added, CLAMPED to the target month's length: Jan 31 + 1 month is
 * Feb 28 (or 29), never Mar 3.
 *
 * The clamp is what makes a monthly recurrence anchored on the 31st behave —
 * the naive version silently migrates such a template to the 3rd of March and
 * then to the 3rd of every following month.
 */
export function addMonths(iso: IsoDate, n: number): IsoDate {
  const d = parseIsoDate(iso)
  if (!d) return iso
  const year = d.getFullYear()
  const month = d.getMonth() + n
  const targetYear = year + Math.floor(month / 12)
  const targetMonth = ((month % 12) + 12) % 12
  const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate()
  const day = Math.min(d.getDate(), lastDay)
  return `${targetYear}-${pad2(targetMonth + 1)}-${pad2(day)}`
}

/** `b - a`, in whole days. 0 when either side is unparseable. */
export function diffDays(a: IsoDate, b: IsoDate): number {
  const from = parseIsoDate(a)
  const to = parseIsoDate(b)
  if (!from || !to) return 0
  const fromUtc = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())
  const toUtc = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.round((toUtc - fromUtc) / MS_PER_DAY)
}

/** 0 = Sunday, matching the Saudi work week the pickers default to. */
export function isoWeekday(iso: IsoDate): number {
  const d = parseIsoDate(iso)
  return d ? d.getDay() : 0
}

export function clampIso(iso: IsoDate, min?: IsoDate, max?: IsoDate): IsoDate {
  let out = iso
  if (min && parseIsoDate(min) && diffDays(min, out) < 0) out = min
  if (max && parseIsoDate(max) && diffDays(out, max) < 0) out = max
  return out
}

/**
 * The LOCAL calendar date an instant falls on.
 *
 * Not `ts.slice(0, 10)`: a `timestamptz` comes back from PostgREST in UTC, so
 * slicing gives the UTC date and an activity at 02:00 Riyadh reads as
 * yesterday. Returns '' on an unparseable instant so callers get an obviously
 * empty label rather than 'Invalid Date'.
 */
export function instantToIsoDate(ts: IsoInstant): IsoDate {
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? '' : toIsoDate(d)
}

/**
 * Whole CALENDAR days between an instant and now — not elapsed 24-hour periods.
 *
 * Calendar days is what `v_entry_health.days_since_activity` counts and what a
 * human means by "two days without an update", so an entry touched at 23:50
 * last night is one day old this morning, not zero.
 */
export function daysSince(ts: IsoInstant, now: Date = new Date()): number {
  const on = instantToIsoDate(ts)
  if (!on) return 0
  return diffDays(on, toIsoDate(now))
}

// ── relative-date parsing ──────────────────────────────────────────────────

export interface RelativeDateOptions {
  now: Date
  locale: Locale
  weekStartsOn?: 0 | 1 | 6
}

/**
 * Fold a user-typed date phrase to its canonical comparison form.
 *
 * Bidi controls first, because normalizeSearch would happily carry an invisible
 * RLM into the middle of `الخميس` and turn a match into a miss.
 */
function foldPhrase(input: string): string {
  return normalizeSearch(input.replace(BIDI_MARKS, ''))
}

/**
 * The alias tables are written with real glyphs and folded ONCE at module init.
 *
 * Writing them pre-folded would be unreadable and unreviewable — nobody can
 * check that `الجمعه` was meant to be `الجمعة` at a glance. Folding here means
 * both sides of every comparison go through the same function, so a change to
 * foldArabic() can never leave the tables behind.
 */
function foldedSet(words: readonly string[]): ReadonlySet<string> {
  return new Set(words.map(foldPhrase))
}

const TODAY_WORDS = foldedSet(['today', 'tod', 'اليوم'])
const TOMORROW_WORDS = foldedSet(['tomorrow', 'tmr', 'غدا', 'غداً', 'بكرة'])
const YESTERDAY_WORDS = foldedSet(['yesterday', 'أمس'])
const EOW_WORDS = foldedSet(['eow', 'نهاية الأسبوع', 'اخر الأسبوع'])
const EOM_WORDS = foldedSet(['eom', 'نهاية الشهر', 'اخر الشهر'])

/**
 * Weekday aliases → 0-6 with Sunday at 0.
 *
 * Arabic weekday names are listed with AND without the definite article,
 * because both are ordinary written forms and a user typing `due:خميس` is not
 * making a mistake. `الأربعاء` folds to `الاربعاء` on the way in, so only one
 * spelling of each needs to be listed.
 */
const WEEKDAY_WORDS: ReadonlyArray<readonly [number, readonly string[]]> = [
  [0, ['sun', 'sunday', 'الأحد', 'أحد']],
  [1, ['mon', 'monday', 'الاثنين', 'الإثنين', 'اثنين']],
  [2, ['tue', 'tues', 'tuesday', 'الثلاثاء', 'ثلاثاء']],
  [3, ['wed', 'weds', 'wednesday', 'الأربعاء', 'أربعاء']],
  [4, ['thu', 'thur', 'thurs', 'thursday', 'الخميس', 'خميس']],
  [5, ['fri', 'friday', 'الجمعة', 'جمعة']],
  [6, ['sat', 'saturday', 'السبت', 'سبت']],
]

const WEEKDAY_INDEX: ReadonlyMap<string, number> = new Map(
  WEEKDAY_WORDS.flatMap(([index, words]) => words.map((w) => [foldPhrase(w), index] as const)),
)

/** `+3d` `+2w` `-1m`. The sign is REQUIRED — see parseRelativeDate's comment. */
const OFFSET_RE = /^([+-])(\d{1,4})([dwm])$/

/** Day-first only: `14/8` and `14/8/2026` (or `/26`). See the comment below. */
const SLASH_RE = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/

/**
 * The parser's entire date vocabulary, in both languages. Returns null on no
 * match and NEVER throws — `due:someday` is a token the user typed, not an
 * exception, and the capture screen renders it as a red chip.
 *
 * WEEKDAY RULE, FROZEN: a bare weekday means the next STRICTLY FUTURE
 * occurrence. `thu` typed on a Thursday is +7, never today. Someone typing a
 * weekday name is scheduling ahead; if they meant today they have `today`.
 *
 * DAY-FIRST ONLY. `14/8` is 14 August. The American month-first order is not
 * accepted in any form, because the two are indistinguishable for the first
 * twelve days of every month and a parser that guesses wrong on `5/6` puts an
 * item a month out of place with no visible error. A two-digit year maps to
 * 2000+; a bare `14/8` stays in the CURRENT year rather than rolling forward,
 * so the value is always the one the user can predict from what they typed.
 */
export function parseRelativeDate(input: string, o: RelativeDateOptions): IsoDate | null {
  const q = foldPhrase(input)
  if (!q) return null

  const today = toIsoDate(o.now)

  if (TODAY_WORDS.has(q)) return today
  if (TOMORROW_WORDS.has(q)) return addDays(today, 1)
  if (YESTERDAY_WORDS.has(q)) return addDays(today, -1)
  if (EOW_WORDS.has(q)) return weekBounds(o.now, o.weekStartsOn).to
  if (EOM_WORDS.has(q)) return endOfMonth(today)

  const weekday = WEEKDAY_INDEX.get(q)
  if (weekday !== undefined) {
    const delta = (weekday - o.now.getDay() + 7) % 7
    return addDays(today, delta === 0 ? 7 : delta)
  }

  const offset = OFFSET_RE.exec(q)
  if (offset) {
    const sign = offset[1] === '-' ? -1 : 1
    const n = sign * Number(offset[2])
    if (offset[3] === 'd') return addDays(today, n)
    if (offset[3] === 'w') return addDays(today, n * 7)
    return addMonths(today, n)
  }

  // ISO first: it is the only unambiguous written form and the one the DB uses.
  if (ISO_DATE_RE.test(q)) return parseIsoDate(q) ? q : null

  const slash = SLASH_RE.exec(q)
  if (slash) {
    const day = Number(slash[1])
    const month = Number(slash[2])
    const rawYear = slash[3]
    const year =
      rawYear === undefined
        ? o.now.getFullYear()
        : rawYear.length === 2
          ? 2000 + Number(rawYear)
          : Number(rawYear)
    const iso = `${year}-${pad2(month)}-${pad2(day)}`
    return parseIsoDate(iso) ? iso : null
  }

  return null
}

function endOfMonth(iso: IsoDate): IsoDate {
  const d = parseIsoDate(iso)
  if (!d) return iso
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(last)}`
}

// ── ranges and buckets ─────────────────────────────────────────────────────

/**
 * The calendar week containing `now`, inclusive at both ends.
 *
 * Sunday-first by default, which is the Saudi work week rather than an
 * ISO-8601 preference — the team's week runs Sunday to Thursday and a Monday
 * anchor would split every one of them across two "weeks" in the digest.
 */
export function weekBounds(now: Date, weekStartsOn: 0 | 1 | 6 = 0): { from: IsoDate; to: IsoDate } {
  const today = toIsoDate(now)
  const back = (now.getDay() - weekStartsOn + 7) % 7
  const from = addDays(today, -back)
  return { from, to: addDays(from, 6) }
}

/** The last `n` days INCLUDING today: lastNDays(7) is today and the six before. */
export function lastNDays(n: number, now: Date = new Date()): { from: IsoDate; to: IsoDate } {
  const to = toIsoDate(now)
  return { from: addDays(to, -(Math.max(1, n) - 1)), to }
}

export type DueBucket = 'none' | 'overdue' | 'today' | 'week' | 'later'

/**
 * Which pile a due date lands in.
 *
 * 'week' means "inside the current calendar week", not "within seven days" —
 * the follow-ups screen groups by the week the team actually plans in, so a
 * Thursday item stops being "this week" at the weekend rather than 168 hours
 * after it was looked at.
 */
export function dueBucket(
  iso: IsoDate | null,
  now: Date = new Date(),
  weekStartsOn: 0 | 1 | 6 = 0,
): DueBucket {
  if (!iso || !parseIsoDate(iso)) return 'none'
  const today = toIsoDate(now)
  const delta = diffDays(today, iso)
  if (delta < 0) return 'overdue'
  if (delta === 0) return 'today'
  return diffDays(iso, weekBounds(now, weekStartsOn).to) >= 0 ? 'week' : 'later'
}

export type AgeBucket = '0-3' | '4-7' | '8-14' | '15+'

/** The aging histogram's four columns. Shared so the chart and the pill agree. */
export function bucketAge(days: number): AgeBucket {
  if (days <= 3) return '0-3'
  if (days <= 7) return '4-7'
  if (days <= 14) return '8-14'
  return '15+'
}

// ── formatting ─────────────────────────────────────────────────────────────

/**
 * `29/07/2026` in both languages — day-first, Latin numerals, Gregorian.
 *
 * A null date renders as an em dash rather than an empty string so an empty
 * cell is visibly empty rather than looking like a layout bug. An UNPARSEABLE
 * date is returned verbatim, on purpose: silently dashing out bad data hides
 * the one case worth seeing in a bug report.
 */
export function formatDate(iso: IsoDate | null, locale: Locale): string {
  if (!iso) return EM_DASH
  const d = parseIsoDate(iso)
  if (!d) return iso
  return fmt(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d)
}

/** `29 July 2026` / `29 يوليو 2026` — for headers, where the month is read. */
export function formatDateLong(iso: IsoDate | null, locale: Locale): string {
  if (!iso) return EM_DASH
  const d = parseIsoDate(iso)
  if (!d) return iso
  return fmt(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(d)
}

export function formatDateRange(from: IsoDate, to: IsoDate, locale: Locale): string {
  return `${formatDate(from, locale)}${s(locale, 'date.rangeSep')}${formatDate(to, locale)}`
}

/** Date plus 24-hour clock. Never 12-hour: the team writes times as 14:05. */
export function formatTimestamp(ts: IsoInstant, locale: Locale): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts
  return fmt(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d)
}

/**
 * `Just now` / `12 min ago` / `3 h ago` / `2 d ago`, falling back to an absolute
 * date past a week.
 *
 * The fallback is the point: "47 d ago" is a number nobody converts back into a
 * date, and the update thread is read as a record.
 */
export function formatRelativeTime(ts: IsoInstant, locale: Locale, now: Date = new Date()): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts
  const seconds = Math.round((now.getTime() - d.getTime()) / 1000)
  if (seconds < 0) {
    const ahead = daysSince(ts, now)
    return ahead >= 0 ? s(locale, 'date.justNow') : s(locale, 'date.inDays', { count: -ahead })
  }
  if (seconds < 60) return s(locale, 'date.justNow')
  if (seconds < 3600) return s(locale, 'date.minutesAgo', { count: Math.floor(seconds / 60) })
  if (seconds < 86400) return s(locale, 'date.hoursAgo', { count: Math.floor(seconds / 3600) })
  const days = daysSince(ts, now)
  if (days <= 7) return s(locale, 'date.daysAgo', { count: days })
  return formatDate(instantToIsoDate(ts), locale)
}

/**
 * The age pill: `14d` / `14ي`. LATIN NUMERALS IN BOTH LANGUAGES, per spec §5 —
 * the digits come from the interpolated count, never from Intl, which is
 * exactly why this does not go through a NumberFormat.
 */
export function formatAge(days: number, locale: Locale): string {
  return s(locale, 'date.daysShort', { count: Math.max(0, Math.round(days)) })
}

/**
 * A due date as a human reads it: overdue by n, today, tomorrow, due in n, or
 * the plain date once it is far enough out that the count stops meaning
 * anything.
 */
export function formatDue(iso: IsoDate | null, locale: Locale, now: Date = new Date()): string {
  if (!iso || !parseIsoDate(iso)) return EM_DASH
  const delta = diffDays(toIsoDate(now), iso)
  if (delta < 0) return s(locale, 'date.overdueByDays', { count: -delta })
  if (delta === 0) return s(locale, 'date.today')
  if (delta === 1) return s(locale, 'date.tomorrow')
  if (delta <= 7) return s(locale, 'date.dueInDays', { count: delta })
  return formatDate(iso, locale)
}

export function formatWeekday(iso: IsoDate, locale: Locale, style: 'short' | 'long' = 'short'): string {
  const d = parseIsoDate(iso)
  if (!d) return ''
  return fmt(locale, { weekday: style }).format(d)
}
