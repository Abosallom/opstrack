// The quick-capture parser: one typed line in, a structured entry out.
//
// PURE, and deliberately so. It imports `../dates`, `../text` and `../../types`
// — no api, no store, no i18n, no React, no I/O. Errors come back as i18n KEYS in `problems` and
// the caller translates them, because a parser that renders sentences cannot be
// tested without a language, and the meeting-mode triage screen needs to parse
// forty lines a minute without touching a store.
//
// TOTALITY IS THE CONTRACT. parse() never throws, for any string, ever. It runs
// on every keystroke of a live capture box; an exception there does not produce
// an error message, it produces a blank screen mid-sentence. Every branch below
// that could fail returns a token marked `ok: false` with an error key instead.
//
// THE CONSUME RULE, stated once because everything else follows from it.
// Open-vocabulary sigils (`#` `@` `+`) and keyed tokens (`due:` `fu:` `every:`)
// are ALWAYS removed from the title: the sigil is unambiguous intent, and
// leaving `due:asdf` in a title is noise the user has to clean up by hand.
// Closed-vocabulary sigils (`!` `/`) are removed ONLY when the value resolves,
// because `Ship it!` and `read/write` are ordinary title text and a parser that
// ate them would be unusable. Nothing the user typed is ever silently lost:
// anything not consumed is still in the title.
//
// WHY grammar.ts DOES NOT EXIST. Plan §2.13 names `lib/capture/grammar.ts`
// alongside this file, but the addendum records that it has no frozen signature
// to build against, and this worker's ownership list does not include it. The
// alias tables therefore live here, in one clearly fenced section, and can be
// lifted into a grammar.ts later without changing one line of this file's
// public API. See the W1-PARSE handoff note.

import { isoWeekday, parseIsoDate, parseRelativeDate, todayIso } from '../dates'
import { foldKey, isSubsequence, stemArabic } from '../text'
import type { IsoDate } from '../dates'
import type { Locale } from '../i18n'
// NewEntry sits in types.ts rather than being re-declared here because it
// describes the exact field set the DB will reject if it drifts, and a
// structural copy in lib/ would drift silently the first time a field is added.
// It used to be imported from `../../api/entries`, which had this pure module
// reaching across the layer boundary contracts rule 2 draws; the Wave-1
// integrator hoisted the type, which is what plan §2.13's permitted-import list
// had assumed all along.
import type { Cadence, EntryPriority, EntryType, NewEntry } from '../../types'

// ── the frozen contract (plan §2.13) ───────────────────────────────────────

export type TokenKind =
  | 'track'
  | 'owner'
  | 'priority'
  | 'type'
  | 'due'
  | 'followUp'
  | 'tag'
  | 'recurring'
  | 'unknown'

export interface ParseTrack {
  id: string
  name: string
  nameAr: string
  aliases?: string[]
}

export interface ParseMember {
  id: string
  displayName: string
  aliases?: string[]
}

/**
 * Everything the parser needs to resolve a name into an id, supplied by the
 * caller. NO STORE DEPENDENCY: the capture screen reads `useTracks()` and
 * `useMembers()` and hands the arrays in. That is what lets meeting triage
 * re-parse a persisted line months later against the track list as it is TODAY,
 * and what lets every test below run with six literals and no mocking.
 */
export interface ParseContext {
  tracks: readonly ParseTrack[]
  members: readonly ParseMember[]
  /** Injected, never `new Date()` — every relative date is relative to THIS. */
  now: Date
  locale: Locale
  /** Default 0 (Sunday), the Saudi work week. Only `eow` reads it. */
  weekStartsOn?: 0 | 1 | 6
  /**
   * Admin-renamed vocabulary labels, so `!عاجل جدا` resolves once an admin has
   * called `critical` that. The parser cannot read store/vocab (layering), so
   * the capture screen passes a snapshot down. `status` is accepted for shape
   * compatibility and is unused: the grammar has no status sigil, because
   * capture always creates at `new` and a status is a later decision.
   */
  vocabAliases?: Partial<Record<'status' | 'priority' | 'type', Record<string, string[]>>>
  defaults?: { trackId?: string | null; priority?: EntryPriority; type?: EntryType }
}

export interface ParsedToken {
  kind: TokenKind
  /** `input.slice(start, end)` — byte-for-byte, always. The chip renderer
   *  highlights this span, so a mismatch would underline the wrong words. */
  raw: string
  start: number
  end: number
  ok: boolean
  /** The RESOLVED value: 'high', '2026-07-30', 'portal', a track name. */
  value?: string
  /** Track or member id when the token resolved to one. */
  refId?: string | null
  /** Ambiguous track ids, for the two-option picker the chip renders. */
  candidates?: string[]
  /** i18n key, set whenever `ok` is false. */
  error?: string
}

export interface ParseProblem {
  key: string
  token?: ParsedToken
  vars?: Record<string, string | number>
}

export interface ParsedRecurrence {
  cadence: Cadence
  customIntervalDays: number | null
  dayOfWeek: number | null
  dayOfMonth: number | null
  firstRunOn: IsoDate
}

export interface ParsedEntry {
  title: string
  trackId: string | null
  ownerId: string | null
  ownerName: string | null
  priority: EntryPriority | null
  type: EntryType | null
  dueDate: IsoDate | null
  followUpDate: IsoDate | null
  tags: string[]
  recurrence: ParsedRecurrence | null
  tokens: ParsedToken[]
  problems: ParseProblem[]
  /** Nothing visible was typed. NOT an error — an empty box never toasts. */
  isEmpty: boolean
}

export interface NewTemplate {
  title: string
  trackId: string | null
  type: EntryType
  priority: EntryPriority
  ownerId: string | null
  ownerName: string | null
  cadence: Cadence
  customIntervalDays: number | null
  dayOfWeek: number | null
  dayOfMonth: number | null
  nextRunOn: IsoDate
  leadDays: number
}

/**
 * Every i18n key parse() can put in `problems`, in one place.
 *
 * Exported because the `capture` namespace belongs to W2-CAPTURE, a wave later:
 * this is the list of strings that screen owes, and a typo on either side would
 * render the raw key to a user rather than failing anything. `err*` blocks a
 * field, `warn*` is a non-blocking notice, `newOwner` is informational — the
 * naming follows plan §4.3.
 */
export const PROBLEM_KEYS = {
  trackUnknown: 'capture.errTrackUnknown',
  trackAmbiguous: 'capture.errTrackAmbiguous',
  newOwner: 'capture.newOwner',
  ownerAmbiguous: 'capture.warnOwnerAmbiguous',
  priority: 'capture.errPriority',
  type: 'capture.errType',
  date: 'capture.errDate',
  // `errRecurrence`, not `errCadence`: the token kind is 'recurring', the parsed
  // shape is ParsedRecurrence, and the failure covers the whole `every:` value
  // including a bad custom interval — not just the cadence word. The integrator
  // reconciled the parser to the shipped string rather than the reverse, since
  // three names already voted for "recurrence" and only one for "cadence".
  recurrence: 'capture.errRecurrence',
  duplicate: 'capture.warnDuplicate',
  // An opening `"` with no closing one. Only raised where the absorbed text
  // would otherwise leave NO signal at all — see the `unterminated` handling in
  // parse(). Non-blocking: the value still parses, because a live capture box
  // has to say something useful while the quote is still open.
  unterminatedQuote: 'capture.warnUnterminatedQuote',
} as const

// ── grammar tables ─────────────────────────────────────────────────────────
//
// Written with real glyphs and folded ONCE at module init by aliasMap(). Hand-
// folding them would make the Arabic unreviewable — nobody can confirm that
// `ملاحظه` was meant to be `ملاحظة` at a glance — and it would let the tables
// drift the day foldArabic() changes. Both sides of every comparison go through
// foldKey(), so they cannot.
//
// Arabic entries are listed in the spellings people actually type, including
// the masculine/feminine pairs that fold to different strings (`متوسط` /
// `متوسطة` → `متوسط` / `متوسطه`) — the fold normalises ة→ه, not the ending
// itself.

const PRIORITY_ALIASES: ReadonlyArray<readonly [EntryPriority, readonly string[]]> = [
  ['critical', ['critical', 'crit', 'urgent', 'p1', 'عاجل', 'عاجلة', 'حرج', 'حرجة']],
  ['high', ['high', 'hi', 'p2', 'عالي', 'عالية', 'مرتفع', 'مرتفعة', 'مهم']],
  ['medium', ['medium', 'med', 'normal', 'p3', 'متوسط', 'متوسطة', 'عادي', 'عادية']],
  ['low', ['low', 'p4', 'منخفض', 'منخفضة', 'بسيط', 'بسيطة']],
]

const TYPE_ALIASES: ReadonlyArray<readonly [EntryType, readonly string[]]> = [
  ['action', ['action', 'act', 'task', 'todo', 'إجراء', 'مهمة', 'عمل']],
  ['decision', ['decision', 'dec', 'قرار']],
  ['issue', ['issue', 'bug', 'problem', 'مشكلة', 'عطل']],
  ['request', ['request', 'req', 'ask', 'طلب']],
  ['change', ['change', 'chg', 'cr', 'تغيير']],
  ['escalation', ['escalation', 'esc', 'تصعيد']],
  ['note', ['note', 'info', 'ملاحظة', 'ملحوظة']],
]

const CADENCE_ALIASES: ReadonlyArray<readonly [Cadence, readonly string[]]> = [
  ['daily', ['daily', 'day', 'd', 'يومي', 'يوميا', 'كل يوم']],
  ['weekly', ['weekly', 'week', 'w', 'أسبوعي', 'اسبوعيا', 'كل أسبوع']],
  ['biweekly', ['biweekly', 'fortnightly', '2w', 'كل أسبوعين', 'أسبوعين', 'نصف شهري']],
  ['monthly', ['monthly', 'month', 'm', 'شهري', 'شهريا', 'كل شهر']],
  ['quarterly', ['quarterly', 'quarter', 'q', 'ربع سنوي', 'ربعي', 'كل ربع']],
]

function aliasMap<T extends string>(
  table: ReadonlyArray<readonly [T, readonly string[]]>,
): Map<string, T> {
  const out = new Map<string, T>()
  for (const [key, words] of table) {
    out.set(foldKey(key), key)
    for (const word of words) out.set(foldKey(word), key)
  }
  return out
}

const PRIORITY_MAP = aliasMap(PRIORITY_ALIASES)
const TYPE_MAP = aliasMap(TYPE_ALIASES)
const CADENCE_MAP = aliasMap(CADENCE_ALIASES)

/** `Nd` → a custom cadence of N days. Checked AFTER the alias table, so bare
 *  `d` still means daily and only a number in front makes it an interval. */
const CUSTOM_CADENCE_RE = /^(\d{1,4})d$/

/**
 * The keyed tokens. Longest alternative first: `due` has to win over `d`, `fu`
 * over `f` and `every` over `ev`, or `due:thu` parses as `d` with the value
 * `ue:thu`.
 */
const KEYED_RE = /^(due|d|fu|f|every|ev):/i

const KEYED_KIND: Readonly<Record<string, TokenKind>> = {
  due: 'due',
  d: 'due',
  fu: 'followUp',
  f: 'followUp',
  every: 'recurring',
  ev: 'recurring',
}

/**
 * The SHORT keys, which are only keys when they work.
 *
 * `d:` and `f:` are also Windows drive letters, and this is an IT-operations
 * tracker: `Restore D:\backup to F:\data` was parsed as two failed date tokens
 * and STORED AS "Restore to", because a failed keyed date token is consumed
 * anyway (that rule is right for `due:someday` — see the case below). The same
 * shape hit `Set F:1 flag` → "Set flag" and `check ev:1 ratio` → "check ratio".
 * Deleting typed text is the worst thing this module can do, and it was doing
 * it silently, in the one product where drive letters are everywhere.
 *
 * So the abbreviations carry a burden of proof that the spelled-out keys do
 * not: `d:`, `f:`, `fu:` and `ev:` are a token only if their value RESOLVES. If
 * it does not, the whole thing was never a token — the text stays in the title
 * and no problem is reported, because there is no failed intent to report.
 * `due:` and `every:` are unambiguous, so they keep the old behaviour: consumed
 * and marked red, since a user who typed six letters of `due:` meant a date.
 *
 * The rule a reader needs is one sentence: an abbreviation is a keyword only
 * when it works. Dropping `d`/`f` from KEYED_RE was the other candidate fix; it
 * loses two documented shorthands and still leaves `ev:1` eating text.
 */
const SHORT_KEYS: ReadonlySet<string> = new Set(['d', 'f', 'fu', 'ev'])

const SIGIL_KIND: Readonly<Record<string, TokenKind>> = {
  '#': 'track',
  '@': 'owner',
  '!': 'priority',
  '+': 'tag',
  '/': 'type',
}

/** The sigils `\` escapes to a literal, per plan §2.13. */
const ESCAPED_SIGIL_RE = /\\([#@!+/])/g

/**
 * The invisible bidi controls an Arabic keyboard, a paste from Word, or an RTL
 * chat client sprinkles through typed text: ZWSP, ZWNJ, ZWJ, LRM, RLM, ALM and
 * a stray BOM.
 *
 * They are stripped from token VALUES before matching and from the emptiness
 * test, never from the input before scanning — every token's [start, end) has
 * to slice back to its `raw`, which is only true if the string being indexed is
 * the one the user typed.
 *
 * Duplicated from lib/dates.ts, which needs the same set for the same reason.
 * Both belong in lib/text.ts; it is keystone-owned and shipped complete before
 * this was needed. Extension slot — see the handoff. Written as \u escapes for
 * the reason lib/text.ts's header spells out: these characters are invisible
 * and several of them reorder the line they appear in, so a range written with
 * glyphs cannot be checked in a diff.
 */
const BIDI_MARKS = /[\u200B-\u200F\u061C\uFEFF]/g

/**
 * Whitespace OR an invisible mark: what a title may not begin or end with.
 *
 * String.trim() does not remove bidi controls — they are not whitespace — so a
 * line of nothing but an RLM would produce a title that LOOKS empty, reports
 * isEmpty, and still passes canSubmit(). That is a row in the database whose
 * title renders as a blank space in every list, created by a user who thought
 * they had typed nothing. Interior marks survive, because they are what makes
 * a mixed Arabic/Latin title read the right way round.
 */
const TITLE_EDGE = /^[\s\u200B-\u200F\u061C\uFEFF]+|[\s\u200B-\u200F\u061C\uFEFF]+$/g

/** At least one letter or digit, in any script. See "bare sigil" below. */
const HAS_WORD_CHAR = /[\p{L}\p{N}]/u

// ── scanner ────────────────────────────────────────────────────────────────

interface RawToken {
  kind: TokenKind
  start: number
  end: number
  raw: string
  /** Bidi-stripped and trimmed; quotes removed when the value was quoted. */
  value: string
  quoted: boolean
  /** Opened with `"` and never closed — the value ran to end of input. */
  unterminated: boolean
  /** Written with a SHORT_KEYS abbreviation, which must resolve to survive. */
  shortKey: boolean
}

function isSpace(ch: string): boolean {
  return /\s/.test(ch)
}

function isInvisible(ch: string): boolean {
  BIDI_MARKS.lastIndex = 0
  return BIDI_MARKS.test(ch)
}

/**
 * Split the input into tokens, leaving everything else alone.
 *
 * A token starts ONLY at the string start or after whitespace. That single rule
 * is what makes `https://jira.corp/x#INC-42` survive intact — the `#` is
 * mid-word, so it is never even considered — and it is why `and/or` and
 * `read/write` are not type tokens.
 *
 * A leading run of invisible bidi marks is folded INTO the token's span rather
 * than skipped: an RTL keyboard emits an RLM before punctuation, so `‏#الشبكات`
 * is what the user actually typed, and leaving the mark behind when the token
 * is consumed would strand an invisible character in the middle of the title.
 */
function scan(input: string, tracks: readonly ParseTrack[]): RawToken[] {
  const out: RawToken[] = []
  const n = input.length
  const trackWords = maxTrackWords(tracks)
  let i = 0

  while (i < n) {
    if (isSpace(input[i])) {
      i += 1
      continue
    }

    const wordStart = i
    let p = i
    while (p < n && isInvisible(input[p])) p += 1

    const found = tokenAt(input, p)
    if (found) {
      // MULTI-WORD TRACK NAMES, UNQUOTED. `#IT Operations` used to resolve the
      // track off `IT` alone (tier 2, prefix) and consume only `#IT`, stranding
      // `Operations` in the stored title — "Renew cert Operations", with no
      // problem reported and a corrupted row in the database. Quoting is the
      // documented workaround and stays the recommendation; it cannot be the
      // requirement, because the failure is silent and looks like success.
      //
      // Done HERE rather than in parse() so the extension moves the token's
      // `end` before the scan continues. Consumed spans must not overlap —
      // buildTitle walks them in one pass — and the only way to guarantee that
      // is for the scanner to own the boundary.
      if (found.kind === 'track' && !found.quoted) {
        const wider = extendTrack(input, found.end, found.value, tracks, trackWords)
        if (wider) {
          found.end = wider.end
          found.value = wider.value
        }
      }
      out.push({
        kind: found.kind,
        start: wordStart,
        end: found.end,
        raw: input.slice(wordStart, found.end),
        value: found.value,
        quoted: found.quoted,
        unterminated: found.unterminated,
        shortKey: found.shortKey,
      })
      i = found.end
      continue
    }

    // Not a token — skip the whole word, so a `#` or `!` inside it can never
    // start one on the next iteration.
    while (i < n && !isSpace(input[i])) i += 1
  }

  return out
}

interface FoundToken {
  kind: TokenKind
  end: number
  value: string
  quoted: boolean
  unterminated: boolean
  shortKey: boolean
}

function tokenAt(input: string, p: number): FoundToken | null {
  if (p >= input.length) return null

  const ch = input[p]
  let kind = SIGIL_KIND[ch]
  let valueStart = p + 1
  let shortKey = false

  if (!kind) {
    const keyed = KEYED_RE.exec(input.slice(p))
    if (!keyed) return null
    const key = keyed[1].toLowerCase()
    kind = KEYED_KIND[key]
    shortKey = SHORT_KEYS.has(key)
    valueStart = p + keyed[0].length
  }

  const read = readValue(input, valueStart)

  // A BARE SIGIL IS NOT A TOKEN. `####`, `@@`, `+` and a lone `due:` carry no
  // value, and treating them as failed tokens would strip `####` out of a title
  // that is deliberately shouting. A QUOTED empty value is different: the quote
  // marks are unambiguous intent, so it is consumed and classified 'unknown'.
  if (!HAS_WORD_CHAR.test(read.value)) {
    if (!read.quoted) return null
    return {
      kind: 'unknown',
      end: read.end,
      value: read.value,
      quoted: true,
      unterminated: read.unterminated,
      shortKey: false,
    }
  }

  return {
    kind,
    end: read.end,
    value: read.value,
    quoted: read.quoted,
    unterminated: read.unterminated,
    shortKey,
  }
}

/** The most words any configured track name spends on itself. */
function maxTrackWords(tracks: readonly ParseTrack[]): number {
  let max = 1
  for (const track of tracks) {
    for (const form of [track.name, track.nameAr, ...(track.aliases ?? [])]) {
      const words = (form ?? '').trim().split(/\s+/).filter(Boolean).length
      if (words > max) max = words
    }
  }
  return max
}

/**
 * Grow an unquoted `#track` token rightwards while that makes it an EXACT name.
 *
 * Greedy: the longest extension that lands on a tier-1 match wins, so a
 * workspace holding both `IT` and `IT Operations` reads `#IT Operations` as the
 * longer one. Only exact matches extend — a prefix or subsequence hit on the
 * wider string would let `#Net work order` swallow two words of title on the
 * strength of a fuzzy match, which is the opposite of the bug being fixed.
 *
 * Lookahead stops at the first word that starts a token of its own, so
 * `#IT due:fri` can never absorb the date even if some track were named for it.
 */
function extendTrack(
  input: string,
  from: number,
  base: string,
  tracks: readonly ParseTrack[],
  maxWords: number,
): { value: string; end: number } | null {
  if (maxWords < 2) return null

  const words: Array<{ text: string; end: number }> = []
  let i = from
  while (words.length < maxWords - 1) {
    let p = i
    while (p < input.length && (isSpace(input[p]) || isInvisible(input[p]))) p += 1
    if (p >= input.length) break
    if (tokenAt(input, p)) break
    let e = p
    while (e < input.length && !isSpace(input[e])) e += 1
    words.push({ text: input.slice(p, e), end: e })
    i = e
  }

  for (let k = words.length; k >= 1; k -= 1) {
    const value = clean([base, ...words.slice(0, k).map((w) => w.text)].join(' '))
    if (matchTrackTiers(value, tracks).exact) return { value, end: words[k - 1].end }
  }
  return null
}

/**
 * Read a token's value: to the next whitespace, or to the closing quote.
 *
 * An UNTERMINATED quote runs to the end of the input rather than falling back
 * to whitespace. Capture is a live single-line box: the user is mid-typing
 * `#"IT Oper` and the chip should already say what they mean. The alternative
 * turns the same keystrokes into an unknown-track error that resolves itself
 * one character later, which reads as the parser flickering.
 */
function readValue(
  input: string,
  start: number,
): { value: string; end: number; quoted: boolean; unterminated: boolean } {
  const n = input.length
  if (input[start] === '"') {
    const close = input.indexOf('"', start + 1)
    const inner = close === -1 ? input.slice(start + 1) : input.slice(start + 1, close)
    return {
      value: clean(inner),
      end: close === -1 ? n : close + 1,
      quoted: true,
      // Reported, not corrected. The run-to-end behaviour above is deliberate;
      // what was missing is that the caller had no way to KNOW it happened, so
      // `@"Ahmed due:thu !high #network` swallowed a date, a priority and a
      // track into an owner name and reported nothing red.
      unterminated: close === -1,
    }
  }
  let e = start
  while (e < n && !isSpace(input[e])) e += 1
  return { value: clean(input.slice(start, e)), end: e, quoted: false, unterminated: false }
}

function clean(s: string): string {
  return s.replace(BIDI_MARKS, '').trim()
}

// ── resolvers ──────────────────────────────────────────────────────────────

interface Match {
  id: string | null
  candidates: string[]
}

function foldedForms(primary: string, secondary: string, aliases?: string[]): string[] {
  const out: string[] = []
  for (const raw of [primary, secondary, ...(aliases ?? [])]) {
    const folded = foldKey(raw ?? '')
    if (folded && !out.includes(folded)) out.push(folded)
  }
  return out
}

/**
 * Three tiers, first tier with any hit wins; exactly one hit inside that tier
 * resolves, anything else is ambiguous.
 *
 * TIER 2 CARRIES A STEM CLAUSE, AND IT IS LOAD-BEARING. Migration 0001 seeds
 * Network as `الشبكات`, the PLURAL, and users type the singular `الشبكة`. Under
 * the ة→ه fold that is `الشبكه`, which fails tier 1, fails tier 2's prefix in
 * both directions (`الشبكات` does not start with `الشبكه`) and fails tier 3
 * because the singular's final ه does not appear in the plural at all. Stemming
 * both to `الشبك` is the only thing that matches them. Without this clause the
 * Arabic half of the parser ships broken AND GREEN, because the contracts
 * document's fixtures used the singular as the seed value and the tests would
 * have been written from the same wrong list.
 *
 * Candidates keep the caller's track order rather than being sorted, so the
 * ambiguity picker lists tracks the way the rest of the app does.
 */
export function matchTrack(
  q: string,
  tracks: readonly ParseTrack[],
): { id: string | null; candidates: string[] } {
  const { id, candidates } = matchTrackTiers(q, tracks)
  return { id, candidates }
}

/**
 * matchTrack, plus WHICH tier answered.
 *
 * `exact` means a single tier-1 hit — the needle IS one of the track's names.
 * extendTrack() needs that distinction and matchTrack()'s two-field result
 * cannot carry it: growing a token on a fuzzy match would eat title words.
 */
function matchTrackTiers(
  q: string,
  tracks: readonly ParseTrack[],
): { id: string | null; candidates: string[]; exact: boolean } {
  const needle = foldKey(clean(q))
  if (!needle) return { id: null, candidates: [], exact: false }
  const stem = stemArabic(needle)

  const exact: string[] = []
  const near: string[] = []
  const loose: string[] = []

  for (const track of tracks) {
    const forms = foldedForms(track.name, track.nameAr, track.aliases)
    if (forms.includes(needle)) {
      exact.push(track.id)
    } else if (forms.some((f) => f.startsWith(needle) || stemArabic(f) === stem)) {
      near.push(track.id)
    } else if (forms.some((f) => isSubsequence(needle, f))) {
      loose.push(track.id)
    }
  }

  const hits = exact.length > 0 ? exact : near.length > 0 ? near : loose
  const resolved = hits.length === 1
  return {
    id: resolved ? hits[0] : null,
    candidates: resolved ? [] : hits,
    exact: resolved && exact.length === 1,
  }
}

/**
 * Members match on tiers 1 and 2 ONLY — never subsequence.
 *
 * Silently assigning work to the wrong person is worse than leaving free text,
 * and `@as` should not become "Ahmed Al-Otaibi" because the letters happen to
 * appear in order. An unmatched handle becomes `ownerName`, which the DB models
 * as a first-class case: an owner is either a provisioned teammate or a name.
 *
 * `profiles` has no `display_name_ar`, so `@أحمد` will NOT match
 * `Ahmed Al-Otaibi` and becomes free text. ParseMember.aliases exists so a
 * one-column migration or an admin-typed alias list fixes that without
 * reopening this file.
 */
function matchMemberTiers(q: string, members: readonly ParseMember[]): Match {
  const needle = foldKey(clean(q))
  if (!needle) return { id: null, candidates: [] }
  const stem = stemArabic(needle)

  const exact: string[] = []
  const near: string[] = []

  for (const member of members) {
    const forms = foldedForms(member.displayName, '', member.aliases)
    if (forms.includes(needle)) {
      exact.push(member.id)
    } else if (forms.some((f) => f.startsWith(needle) || stemArabic(f) === stem)) {
      near.push(member.id)
    }
  }

  const hits = exact.length > 0 ? exact : near
  return hits.length === 1 ? { id: hits[0], candidates: [] } : { id: null, candidates: hits }
}

export function matchMember(q: string, members: readonly ParseMember[]): string | null {
  return matchMemberTiers(q, members).id
}

/**
 * Closed-vocabulary lookup: EXACT fold-equality against the alias table, with
 * the admin's renamed labels overlaid.
 *
 * Exact rather than prefix on purpose. `!urgent-ish` must NOT become
 * `critical` — the user is qualifying, not choosing — and the same looseness
 * that would resolve `!hig` would resolve half the adjectives in an English
 * title into a priority the user never picked.
 */
function resolveVocab<T extends string>(
  value: string,
  base: ReadonlyMap<string, T>,
  overrides: Record<string, string[]> | undefined,
): T | null {
  const needle = foldKey(clean(value))
  if (!needle) return null
  if (overrides) {
    for (const [key, aliases] of Object.entries(overrides)) {
      if (aliases.some((alias) => foldKey(alias) === needle)) return key as T
    }
  }
  return base.get(needle) ?? null
}

function resolveCadence(value: string): { cadence: Cadence; interval: number | null } | null {
  const needle = foldKey(clean(value))
  if (!needle) return null
  const named = CADENCE_MAP.get(needle)
  if (named) return { cadence: named, interval: null }
  const custom = CUSTOM_CADENCE_RE.exec(needle)
  if (custom) {
    const days = Number(custom[1])
    if (days > 0) return { cadence: 'custom', interval: days }
  }
  return null
}

/**
 * Tags are lowercased and deduped, and that is ALL the normalisation they get.
 *
 * They are not Arabic-folded, because a tag is stored verbatim and matched with
 * `=` by the filter's AND semantics: folding on the way in would write
 * `الشبكه` into the column and then never match the `الشبكة` an admin typed
 * into a track's suggested_tags.
 */
function normalizeTag(value: string): string {
  return clean(value).toLowerCase()
}

// ── parse ──────────────────────────────────────────────────────────────────

/**
 * Total over any string: never throws, for any input, in any language.
 *
 * Partial-parse semantics are the whole point. A line that half-resolves still
 * produces an entry — unknown tokens stay in the title, failed closed-vocabulary
 * sigils stay in the title, and every failure is reported as a chip the user can
 * click rather than a modal that blocks the capture. The one thing that never
 * happens is losing text the user typed.
 */
/**
 * Would this short-key token's value actually resolve?
 *
 * Asked BEFORE the token is admitted, and it must ask the same question the
 * dispatch below asks — same resolver, same arguments — or `d:tomorrow` would
 * be rejected here and accepted there, or worse the reverse.
 */
function shortKeyResolves(raw: RawToken, ctx: ParseContext): boolean {
  if (raw.kind === 'recurring') return resolveCadence(raw.value) !== null
  return (
    parseRelativeDate(raw.value, {
      now: ctx.now,
      locale: ctx.locale,
      weekStartsOn: ctx.weekStartsOn,
    }) !== null
  )
}

export function parse(input: string, ctx: ParseContext): ParsedEntry {
  const isEmpty = clean(input) === ''

  const tokens: ParsedToken[] = []
  const problems: ParseProblem[] = []
  const consumed: Array<readonly [number, number]> = []
  const tags: string[] = []
  const seen = new Set<TokenKind>()

  let trackId: string | null = null
  let ownerId: string | null = null
  let ownerName: string | null = null
  let priority: EntryPriority | null = null
  let type: EntryType | null = null
  let dueDate: IsoDate | null = null
  let followUpDate: IsoDate | null = null
  let cadence: Cadence | null = null
  let customIntervalDays: number | null = null

  /** A second ACCEPTED token of the same kind: last wins, and the user is told.
   *  A second FAILED token is reported as its own failure and never as a
   *  duplicate — `!high !urgent-ish` set the priority once. */
  const noteDuplicate = (token: ParsedToken): void => {
    if (seen.has(token.kind)) {
      problems.push({ key: PROBLEM_KEYS.duplicate, token, vars: { kind: token.kind } })
    }
    seen.add(token.kind)
  }

  const fail = (token: ParsedToken, key: string, vars?: Record<string, string | number>): void => {
    token.ok = false
    token.error = key
    problems.push(vars ? { key, token, vars } : { key, token })
  }

  for (const raw of scan(input, ctx.tracks)) {
    // A SHORT KEY THAT DID NOT RESOLVE WAS NEVER A TOKEN. Checked before the
    // token object exists, so `D:\backup` leaves no chip, no problem and — the
    // point — no consumed span: the text stays in the title exactly as typed.
    // See SHORT_KEYS. The spelled-out `due:`/`every:` never take this path.
    if (raw.shortKey && !shortKeyResolves(raw, ctx)) continue

    const token: ParsedToken = {
      kind: raw.kind,
      raw: raw.raw,
      start: raw.start,
      end: raw.end,
      ok: true,
    }
    tokens.push(token)

    // AN OPEN QUOTE SWALLOWED THE REST OF THE LINE. Raised only for owner and
    // tag, which is where it costs the user something: every other kind runs
    // its value through a resolver that already reports a miss, but `@` treats
    // free text as a success and `+` accepts anything, so
    // `Call @"Ahmed due:thu !high #network` filed an owner literally named
    // "Ahmed due:thu !high #network" and reported nothing. The value is still
    // used — `#"IT Oper` mid-keystroke has to keep resolving — this only adds
    // the signal that was missing.
    if (raw.unterminated && (raw.kind === 'owner' || raw.kind === 'tag')) {
      problems.push({
        key: PROBLEM_KEYS.unterminatedQuote,
        token,
        vars: { value: raw.value },
      })
    }

    switch (raw.kind) {
      case 'track': {
        const hit = matchTrack(raw.value, ctx.tracks)
        token.value = raw.value
        token.refId = hit.id
        if (hit.id) {
          noteDuplicate(token)
          trackId = hit.id
        } else if (hit.candidates.length > 0) {
          token.candidates = hit.candidates
          fail(token, PROBLEM_KEYS.trackAmbiguous, { value: raw.value })
        } else {
          token.candidates = []
          fail(token, PROBLEM_KEYS.trackUnknown, { value: raw.value })
        }
        // Consumed either way: the chip renders as unknown and is clickable.
        consumed.push([raw.start, raw.end])
        break
      }

      case 'owner': {
        const hit = matchMemberTiers(raw.value, ctx.members)
        const member = hit.id ? ctx.members.find((m) => m.id === hit.id) : undefined
        token.refId = hit.id
        token.value = member ? member.displayName : raw.value
        noteDuplicate(token)
        if (member) {
          ownerId = member.id
          ownerName = member.displayName
        } else {
          ownerId = null
          ownerName = raw.value
          // Free text is a SUCCESS, not a failure — vendors and people outside
          // the workspace are owners the schema models on purpose. The problem
          // is informational so the capture screen can offer "invite" without
          // marking the chip red.
          if (hit.candidates.length > 0) {
            token.candidates = hit.candidates
            problems.push({
              key: PROBLEM_KEYS.ownerAmbiguous,
              token,
              vars: { name: raw.value },
            })
          } else {
            problems.push({ key: PROBLEM_KEYS.newOwner, token, vars: { name: raw.value } })
          }
        }
        consumed.push([raw.start, raw.end])
        break
      }

      case 'priority': {
        const hit = resolveVocab(raw.value, PRIORITY_MAP, ctx.vocabAliases?.priority)
        if (hit) {
          token.value = hit
          noteDuplicate(token)
          priority = hit
          consumed.push([raw.start, raw.end])
        } else {
          token.value = raw.value
          fail(token, PROBLEM_KEYS.priority, { value: raw.value })
          // NOT consumed: `Ship it!` and `!urgent-ish` are title text.
        }
        break
      }

      case 'type': {
        const hit = resolveVocab(raw.value, TYPE_MAP, ctx.vocabAliases?.type)
        if (hit) {
          token.value = hit
          noteDuplicate(token)
          type = hit
          consumed.push([raw.start, raw.end])
        } else {
          token.value = raw.value
          fail(token, PROBLEM_KEYS.type, { value: raw.value })
          // NOT consumed: `read/write` is title text.
        }
        break
      }

      case 'tag': {
        const tag = normalizeTag(raw.value)
        token.value = tag
        // Tags ACCUMULATE and dedupe rather than last-wins, so no duplicate
        // warning: typing `+portal +portal` is a stutter, not a contradiction.
        if (tag && !tags.includes(tag)) tags.push(tag)
        consumed.push([raw.start, raw.end])
        break
      }

      case 'due':
      case 'followUp': {
        const iso = parseRelativeDate(raw.value, {
          now: ctx.now,
          locale: ctx.locale,
          weekStartsOn: ctx.weekStartsOn,
        })
        if (iso) {
          token.value = iso
          noteDuplicate(token)
          if (raw.kind === 'due') dueDate = iso
          else followUpDate = iso
        } else {
          token.value = raw.value
          fail(token, PROBLEM_KEYS.date, { value: raw.value })
        }
        // Always consumed, resolved or not: `due:someday` in a title is noise.
        consumed.push([raw.start, raw.end])
        break
      }

      case 'recurring': {
        const hit = resolveCadence(raw.value)
        if (hit) {
          token.value = hit.cadence
          noteDuplicate(token)
          cadence = hit.cadence
          customIntervalDays = hit.interval
        } else {
          token.value = raw.value
          fail(token, PROBLEM_KEYS.recurrence, { value: raw.value })
        }
        consumed.push([raw.start, raw.end])
        break
      }

      default: {
        // 'unknown' — a quoted empty value. Consumed (the quotes were intent)
        // but attached to no field.
        token.value = raw.value
        consumed.push([raw.start, raw.end])
        break
      }
    }
  }

  return {
    title: buildTitle(input, consumed),
    trackId,
    ownerId,
    ownerName,
    priority,
    type,
    dueDate,
    followUpDate,
    tags,
    recurrence: cadence
      ? buildRecurrence(cadence, customIntervalDays, dueDate ?? todayIso(ctx.now))
      : null,
    tokens,
    problems,
    isEmpty,
  }
}

/**
 * Everything the tokens did not eat, with the escapes unescaped and the holes
 * closed up.
 *
 * The spans arrive in scan order and never overlap, so this is one pass. The
 * whitespace collapse at the end is what turns `a  b` — the gap a removed token
 * left behind — back into `a b`; without it every consumed token would leave a
 * double space in the stored title.
 */
function buildTitle(input: string, consumed: ReadonlyArray<readonly [number, number]>): string {
  let out = ''
  let cursor = 0
  for (const [start, end] of consumed) {
    out += input.slice(cursor, start)
    cursor = end
  }
  out += input.slice(cursor)
  return out.replace(ESCAPED_SIGIL_RE, '$1').replace(/\s+/g, ' ').replace(TITLE_EDGE, '')
}

/**
 * Anchor a recurrence to a real date.
 *
 * `every:weekly` alone anchors dayOfWeek to today; `every:monthly` anchors
 * dayOfMonth; a `due:` in the same line overrides both by supplying the first
 * run. That last rule is what makes "every month on the 1st" expressible in one
 * line — `#pmo Monthly report every:monthly due:2026-08-01` — without a second
 * screen. The anchors mirror what advance_recurrence() reads in 0001, so a
 * template created here and advanced by the database agree on the same day.
 */
function buildRecurrence(
  cadence: Cadence,
  customIntervalDays: number | null,
  firstRunOn: IsoDate,
): ParsedRecurrence {
  const weekly = cadence === 'weekly' || cadence === 'biweekly'
  const monthly = cadence === 'monthly' || cadence === 'quarterly'
  const anchor = parseIsoDate(firstRunOn)
  return {
    cadence,
    customIntervalDays: cadence === 'custom' ? customIntervalDays : null,
    dayOfWeek: weekly ? isoWeekday(firstRunOn) : null,
    dayOfMonth: monthly && anchor ? anchor.getDate() : null,
    firstRunOn,
  }
}

// ── outputs ────────────────────────────────────────────────────────────────

/** A title is the one required field. Everything else can be filled in later. */
export function canSubmit(p: ParsedEntry): boolean {
  return p.title.trim() !== ''
}

/**
 * ParsedEntry → the create payload, applying the context defaults.
 *
 * Null when the line describes a RECURRENCE — that is a template, not an entry,
 * and silently creating a one-off from `every:weekly` would be the wrong row in
 * the wrong table. Callers branch on `p.recurrence` and call
 * toRecurringTemplateInput() instead.
 *
 * `ownerName` is cleared whenever `ownerId` is set: the two are mutually
 * exclusive by CHECK constraint, and an entry reassigned from a vendor to a
 * teammate must not end up showing two owners. `description` is '' and never
 * null — the column is NOT NULL and `?? null` there is a guaranteed 23502.
 * `status` is not set at all: capture always creates at the default, because
 * deciding an item is already in progress is a second thought, not a first one.
 */
export function toNewEntry(p: ParsedEntry, ctx: ParseContext): NewEntry | null {
  if (p.recurrence || !canSubmit(p)) return null
  return {
    title: p.title,
    trackId: p.trackId ?? ctx.defaults?.trackId ?? null,
    description: '',
    type: p.type ?? ctx.defaults?.type ?? 'action',
    priority: p.priority ?? ctx.defaults?.priority ?? 'medium',
    ownerId: p.ownerId,
    ownerName: p.ownerId ? null : p.ownerName,
    dueDate: p.dueDate,
    followUpDate: p.followUpDate,
    tags: p.tags,
  }
}

/**
 * ParsedEntry → the recurring-template payload. Null unless the line actually
 * carries a cadence.
 *
 * `leadDays: 0` because one line of text has nowhere to express "create it
 * three days early"; the templates screen edits it afterwards. Defaulting it to
 * anything else would silently backdate every template captured this way.
 */
export function toRecurringTemplateInput(p: ParsedEntry, ctx: ParseContext): NewTemplate | null {
  if (!p.recurrence || !canSubmit(p)) return null
  const r = p.recurrence
  return {
    title: p.title,
    trackId: p.trackId ?? ctx.defaults?.trackId ?? null,
    type: p.type ?? ctx.defaults?.type ?? 'action',
    priority: p.priority ?? ctx.defaults?.priority ?? 'medium',
    ownerId: p.ownerId,
    ownerName: p.ownerId ? null : p.ownerName,
    cadence: r.cadence,
    customIntervalDays: r.customIntervalDays,
    dayOfWeek: r.dayOfWeek,
    dayOfMonth: r.dayOfMonth,
    nextRunOn: r.firstRunOn,
    leadDays: 0,
  }
}
