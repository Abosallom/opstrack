// The wording pass as a FILE — Settings › Terminology's download and load.
//
// WHY A FILE EXISTS AT ALL. The row editor is the right tool for renaming three
// things; it is the wrong one for going through the app's vocabulary in an
// evening. A wording pass is drafted the way people actually draft one — sitting
// with the whole list, offline, in a text editor, over more than one sitting —
// and then applied in a single act. This module is the two halves of that: what
// the app writes out, and what it is willing to read back.
//
// IT IS ALSO HOW THIS WORKSPACE'S VOCABULARY REACHES THE NEXT ONE. The same
// product is going to stand up a second workspace (NphiesCore), and the wording
// the owner settles on here is most of the work. A file that is portable and
// self-describing carries it across; a screen-only editor makes somebody retype
// four hundred strings. That is the whole reason the envelope names its own
// format and version instead of being a bare map — a reader six months and one
// workspace away has to be able to tell what it is holding.
//
// PURE, AND IT HAS TO BE. No store, no api, no React, no `document`, no clock.
// The clock and the file picker are the component's (`components/settings/
// LabelIO.tsx`); everything interesting — the envelope, the ordering, the
// parsing, the validation, the diff against what is already stored — is here,
// where vitest's `node` environment can reach it. lib/export.ts made the same
// split for the same reason and its header states it at length.
//
// ── THE ONE RULE THIS MODULE IS FOR ────────────────────────────────────────
//
// A MALFORMED OR HOSTILE FILE MUST NEVER PARTIALLY APPLY. Every entry is
// validated — through lib/labelOverrides.ts's `validateOverride()`, the SAME
// validator the row editor uses, never a second copy of the rules — before any
// of them is offered for writing, and one rejection empties the whole apply
// list. That last part is STRUCTURAL, not a convention the caller is trusted to
// follow: `planLabelImport()` returns `apply: []` whenever `rejected` is
// non-empty, so a component that forgot to check cannot write half a file. The
// alternative — applying the good rows and reporting the bad ones — leaves the
// owner with a vocabulary that is neither the old one nor the one in the file,
// spread across seven screens, with no way to tell which is which.
//
// AN UNKNOWN KEY IS NOT A MALFORMED ONE, and the difference decides whether
// this feature travels. A file written against another build — an older tag, the
// next release, the other workspace — carries keys this app has never heard of.
// Refusing the file for that would mean a wording pass could only ever be
// applied to the exact build it came from, which is the opposite of portable. So
// an unknown key is SKIPPED, reported by name in the count the screen shows, and
// never written: storing it would silently pre-override a key that a future
// release might introduce with an entirely different meaning.
//
// ── WHAT THE FILE LOOKS LIKE ───────────────────────────────────────────────
//
//   {
//     "format": "coretrack-terminology",
//     "version": 1,
//     "exportedAt": "2026-07-31T18:22:04.123Z",
//     "appVersion": "1.0.1",
//     "locales": ["en", "ar"],
//     "count": 2,
//     "labels": {
//       "entry.title": { "en": "Action", "ar": "الإجراء" },
//       "nav.board":   { "en": "Wall",   "ar": null }
//     }
//   }
//
// KEY ORDER IS SORTED AND THE FIELD ORDER IS FIXED, so two exports of the same
// overrides differ only in `exportedAt`. That is not tidiness: the file is going
// to be diffed — in an editor, in an email thread, in a chat — and a set that
// reshuffles on every download makes a two-line change look like a rewrite.
//
// EVERY ENTRY CARRIES BOTH LANGUAGES, `null` included. A file that omitted the
// language it did not touch would be shorter and would read as "leave the Arabic
// alone", which is exactly what it does NOT mean — see BLANK MEANS DEFAULT
// below. Writing the null out makes the file say what it does.

import { isBlankLabel, validateOverride, type OverrideCheck } from './labelOverrides'
import { PLURAL_CATEGORIES, isPluralNode, type PluralNode } from './plural'
import type { Locale } from './i18n'

/* ─────────────────────────────── the envelope ───────────────────────────── */

/**
 * The magic string a reader matches on.
 *
 * NOT the same value as lib/export.ts's `format: 'opstrack-export'`, and
 * deliberately spelled with the current brand: that tag is frozen because files
 * carrying it already exist in people's folders, and this format has no history
 * to keep faith with. brand.test.ts pins the distinction from the other side.
 */
export const LABEL_FILE_FORMAT = 'coretrack-terminology'

/**
 * The document version.
 *
 * Bump it when the SHAPE changes — a renamed field, a moved value, a new meaning
 * for `null`. Adding a field beside the existing ones is not a bump, because
 * `parseLabelFile` ignores fields it does not know. A file whose version is
 * HIGHER than this is REFUSED rather than read optimistically: a v2 that gave
 * `null` a new meaning would otherwise be applied under v1's rules, silently.
 */
export const LABEL_FILE_VERSION = 1

/**
 * The largest file this screen will read, in bytes/characters.
 *
 * The whole key space is ~1,600 keys; a file that overrode every one of them in
 * both languages, generously, is a few hundred kilobytes. Two megabytes is well
 * clear of any honest wording pass and stops a 400 MB file — picked by accident
 * or on purpose — from locking the tab up in `JSON.parse` on a phone. Checked
 * here AND against `File.size` in the component, so neither path is the only
 * guard.
 */
export const LABEL_FILE_MAX_BYTES = 2_000_000

/**
 * One key's wording in both languages — the shape this module reads, writes and
 * hands back.
 *
 * DELIBERATELY NARROWER THAN `LabelOverrideRow`, which also carries `updated_by`
 * and `updated_at`. A row assigns to this structurally, so callers pass their
 * rows unchanged, and this module never has to import src/types.ts to name a
 * database shape it does not care about. It cuts the other way too: the page can
 * synthesise pairs for keys that have NO row — every key in
 * lib/labelSections.listLabels(), say — and get a blank template to draft in,
 * without this module needing a second entry point for it.
 */
export interface LabelPair {
  readonly key: string
  readonly en: string | null
  readonly ar: string | null
}

/** One entry's two values, as the file holds them. */
export interface LabelFileEntry {
  readonly en: string | null
  readonly ar: string | null
}

/** What the caller knows and this module must not go and find out. */
export interface LabelFileMeta {
  /** ISO instant — `new Date().toISOString()`. Provenance, never read back. */
  readonly exportedAt: string
  /** `__APP_VERSION__`, so a file found later can be placed against a build. */
  readonly appVersion: string
}

/** The whole document. */
export interface LabelFile extends LabelFileMeta {
  readonly format: typeof LABEL_FILE_FORMAT
  readonly version: number
  /**
   * The languages this app renders. Informational, and it earns its place: it is
   * what tells someone opening the file in another workspace which columns they
   * are allowed to fill in, before they have found the app.
   */
  readonly locales: readonly Locale[]
  /** `Object.keys(labels).length`, so the size is legible without parsing. */
  readonly count: number
  readonly labels: Readonly<Record<string, LabelFileEntry>>
}

/**
 * Blank and null are the same answer everywhere in this feature, and
 * `isBlankLabel()` is the one place that decides which values are blank — a
 * pasted zero-width space is one, and `String.trim()` alone disagrees.
 */
function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return isBlankLabel(trimmed) ? null : trimmed
}

/** Sorted by code unit — total, locale-independent, and the same on every run. */
function byKey(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * The override set as a document.
 *
 * A pair that overrides NOTHING is dropped rather than written as two nulls. It
 * cannot normally exist — 0016's prune trigger deletes a row the moment both
 * languages go blank — but the localStorage cache can hold one for the instant
 * before a refetch, and "here is a change" is not a true thing for a file to say
 * about it. The IMPORTER is deliberately not symmetrical about this: an entry
 * whose two languages are blank is a RESET instruction there, because blanking
 * the boxes in the file is the obvious way to ask for the built-in wording back,
 * and refusing to understand it would be a trap.
 *
 * `Object.fromEntries`, not a `labels[key] = …` loop: assignment to the key
 * `__proto__` goes through the inherited setter and replaces the object's
 * prototype instead of storing a property, so one hostile row could corrupt the
 * document being built. `fromEntries` defines own properties and cannot.
 */
export function buildLabelFile(pairs: readonly LabelPair[], meta: LabelFileMeta): LabelFile {
  const collected = new Map<string, LabelFileEntry>()
  for (const pair of pairs) {
    const key = pair.key.trim()
    if (key === '') continue
    const en = text(pair.en)
    const ar = text(pair.ar)
    if (en === null && ar === null) continue
    collected.set(key, { en, ar })
  }
  const labels = Object.fromEntries(
    [...collected.keys()].sort(byKey).map((key) => [key, collected.get(key)] as const),
  ) as Record<string, LabelFileEntry>

  // Field order is the order of this literal, and JSON.stringify preserves it.
  // Identity first, provenance second, payload last — the order someone reading
  // the top of the file in a diff needs them in.
  return {
    format: LABEL_FILE_FORMAT,
    version: LABEL_FILE_VERSION,
    exportedAt: meta.exportedAt,
    appVersion: meta.appVersion,
    locales: ['en', 'ar'],
    count: Object.keys(labels).length,
    labels,
  }
}

/**
 * The document as bytes.
 *
 * Indented, because this file is written FOR a person to edit — that is the
 * whole feature — and a single-line JSON object of four hundred keys is not
 * something anyone drafts in. `JSON.stringify` emits Arabic as literal UTF-8
 * rather than `\u` escapes, so the file opens as Arabic in any editor and the
 * round trip is byte-clean. The trailing newline is for every text tool that
 * assumes one.
 */
export function serializeLabelFile(file: LabelFile): string {
  return `${JSON.stringify(file, null, 2)}\n`
}

/** Two digits for the filename stamp. */
function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/**
 * `coretrack-terminology-2026-07-31-2045.json`.
 *
 * LOCAL time, sortable-first, no colons and no spaces — the same three rules
 * lib/export.ts's `exportFilename()` states, for the same three reasons: the
 * stamp exists so a person can tell two drafts apart in a Downloads folder, the
 * folder should sort chronologically by name, and a colon does not survive the
 * trip to a Windows share. ASCII only, in both languages: brand.test.ts holds
 * every generated filename to that, because a filename travels to people who do
 * not read the language it was written in.
 */
export function labelFileName(at: Date): string {
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}-${pad(
    at.getHours(),
  )}${pad(at.getMinutes())}`
  return `coretrack-terminology-${stamp}.json`
}

/** The download's Content-Type, encoding stated rather than guessed. */
export function labelFileMimeType(): string {
  return 'application/json;charset=utf-8'
}

/* ──────────────────────────────── the import ────────────────────────────── */

/**
 * What the app SHIPS for a key in a locale — `lib/i18n.ts`'s `shippedNode`,
 * passed in rather than imported.
 *
 * INJECTED FOR THE LAYERING, not for testability alone: i18n.ts reads
 * `localStorage` at module scope and imports React, so a value import of it here
 * would drag a DOM dependency into the import graph of every pure suite in the
 * repo — the rule lib/plural.ts's and lib/labelSections.ts's headers both state.
 * The signature is `shippedNode`'s exactly, so the component passes the function
 * itself with no adapter.
 */
export type ShippedLookup = (key: string, locale: Locale) => string | PluralNode | undefined

/** One entry that will be written. Assigns to api/labels.ts's LabelOverrideInput. */
export type LabelImportEntry = LabelPair

/** One reason the file cannot be applied. */
export interface LabelImportRejection {
  readonly key: string
  /**
   * Which language's value is wrong, or `null` when the ENTRY itself is
   * malformed — not an object, or a value that is neither a string nor null.
   * The screen renders it as the field's own name, so the owner is told which
   * box to go and fix rather than being handed a key and left to guess.
   */
  readonly locale: Locale | null
  /** A `t()` key — every one of them is in lib/labelOverrides.OVERRIDE_ERROR_KEYS
      or is `terminology.errImportShape`. */
  readonly error: string
  /** The offending token or category, for the message that names it. */
  readonly vars?: Readonly<Record<string, string>>
}

/**
 * What loading this file would do, decided before anything is written.
 *
 * `apply` IS EMPTY WHENEVER `rejected` IS NOT. See the header: all-or-nothing is
 * a property of this object, not a rule the caller has to remember.
 */
export interface LabelImportPlan {
  /** Entries that would be written, in key order, already validated and fenced. */
  readonly apply: readonly LabelImportEntry[]
  /** Valid entries that match what is stored already — nothing to do for them. */
  readonly unchanged: number
  /** Keys this build does not have. Reported, never written. */
  readonly skipped: readonly string[]
  /** Everything wrong with the file. Non-empty means nothing will be applied. */
  readonly rejected: readonly LabelImportRejection[]
  /** Entries in the file, whatever became of them. */
  readonly total: number
}

/** A file that could be read, or the reason it could not be. */
export type LabelImportResult =
  | { readonly ok: true; readonly plan: LabelImportPlan }
  | { readonly ok: false; readonly error: string }

/** Not JSON at all, or too big to be an honest wording pass. */
const ERR_PARSE = 'terminology.errImportParse'

/** JSON, but not this document — or one entry that is not a pair of strings. */
const ERR_SHAPE = 'terminology.errImportShape'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The `labels` map, from either the envelope or a bare `key → pair` object.
 *
 * THE BARE FORM IS ACCEPTED ON PURPOSE. The point of the format is that a person
 * can produce one, and the shortest thing a person produces by hand — or a
 * script, or the next workspace's tooling — is the map itself. The envelope is
 * what the app WRITES, because a file found later has to identify itself; it is
 * not a toll on what the app will read.
 *
 * `undefined` means "this is not a wording file". A `format` that names some
 * other document and a `version` from the future are both refused here rather
 * than read hopefully: a v2 that gave `null` a new meaning would otherwise be
 * applied under v1's rules, and the failure would be silent and wrong.
 */
function readLabels(parsed: unknown): Record<string, unknown> | undefined {
  if (!isRecord(parsed)) return undefined

  const format = parsed.format
  if (format !== undefined && format !== LABEL_FILE_FORMAT) return undefined

  const version = parsed.version
  if (version !== undefined && (typeof version !== 'number' || version > LABEL_FILE_VERSION)) {
    return undefined
  }

  const labels = parsed.labels
  if (labels !== undefined) return isRecord(labels) ? labels : undefined

  // No `labels` field: read the object itself as the map. An envelope with a
  // misspelled field lands here and every one of its keys is reported as unknown
  // — visible, counted, and harmless, because nothing unknown is ever written.
  return parsed
}

/**
 * One entry's two values, or `undefined` when the entry is not a pair.
 *
 * A missing language and an explicit `null` are the same thing: no wording for
 * that language. Fields other than `en` and `ar` are IGNORED rather than
 * refused, so a future version that adds one — or a person who left a "note" to
 * themselves beside a row — does not make the file unreadable.
 *
 * A bare string (`"nav.board": "Wall"`) is refused rather than guessed at: there
 * is no honest answer to which of the two languages it meant.
 */
function readPair(value: unknown): LabelFileEntry | undefined {
  if (!isRecord(value)) return undefined
  const en = readValue(value.en)
  const ar = readValue(value.ar)
  if (en === undefined || ar === undefined) return undefined
  return { en, ar }
}

function readValue(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null
  return typeof value === 'string' ? value : undefined
}

/**
 * What the bundles ship for this ROW key, in this locale — the `shipped`
 * argument `validateOverride()` measures a candidate against.
 *
 * A row key is either a plain dot path or `path.category` for one form of a
 * plural node, and telling them apart is LEXICAL: try the key itself first, and
 * only if the bundle has nothing there read a trailing plural category off it
 * and look up the base. That is the same rule `lib/labelOverrides.ts`'s
 * `categoryOf()` and `lib/i18n.ts`'s `setOverrides()` apply, and it has to be —
 * three places deciding a key's shape differently is how an override ends up
 * stored under a key nothing reads.
 *
 * PER LOCALE, because the two bundles are allowed to disagree about a key's
 * SHAPE: `board.total` is a plural node in English and an invariant string in
 * Arabic (lib/plural.ts's header). So `board.total.few` is a legitimate English
 * row and an unknown Arabic one, and the report says exactly that.
 */
function shippedFor(
  key: string,
  locale: Locale,
  lookup: ShippedLookup,
): string | PluralNode | undefined {
  const direct = lookup(key, locale)
  if (direct !== undefined) return direct
  const dot = key.lastIndexOf('.')
  if (dot <= 0) return undefined
  if (!(PLURAL_CATEGORIES as readonly string[]).includes(key.slice(dot + 1))) return undefined
  const base = lookup(key.slice(0, dot), locale)
  return isPluralNode(base) ? base : undefined
}

/**
 * One language of one entry, through the shared validator.
 *
 * BLANK IS ANSWERED BEFORE THE KEY IS EVEN CHECKED, and that ordering is the
 * point: a blank stores nothing, so a language the file left empty can never be
 * the reason a file is refused — including for a key that only exists on the
 * other side of the bundle divide. `isBlankLabel()` rather than a trim, because
 * no invisible format character is whitespace and `String.trim()` removes none
 * of them: a cell holding nothing but a stray isolate, a zero-width space or a
 * right-to-left mark is empty to the person looking at it, and a file full of
 * them must clear labels rather than blank them.
 */
function checkSide(
  key: string,
  locale: Locale,
  value: string | null,
  shipped: string | PluralNode | undefined,
): OverrideCheck {
  // `value === null` first only so tsc narrows the argument below; isBlankLabel
  // answers for null too.
  if (value === null || isBlankLabel(value)) return { ok: true, value: null }
  if (shipped === undefined) return { ok: false, error: 'terminology.errUnknownKey' }
  return validateOverride(key, shipped, value, locale)
}

/**
 * What loading this text would do.
 *
 * @param source  the file, verbatim.
 * @param lookup  `shippedNode` from lib/i18n.ts.
 * @param current what is stored right now, so the plan can say what would
 *                actually CHANGE rather than how many lines the file has. The
 *                two are different numbers whenever a file is loaded twice, and
 *                the second one is the one to put in front of somebody before
 *                they change the words the whole workspace reads.
 */
export function planLabelImport(
  source: string,
  lookup: ShippedLookup,
  current: readonly LabelPair[],
): LabelImportResult {
  if (source.length > LABEL_FILE_MAX_BYTES) return { ok: false, error: ERR_PARSE }

  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    return { ok: false, error: ERR_PARSE }
  }

  const labels = readLabels(parsed)
  if (labels === undefined) return { ok: false, error: ERR_SHAPE }

  const stored = new Map(current.map((pair) => [pair.key.trim(), pair]))
  const apply: LabelImportEntry[] = []
  const skipped: string[] = []
  const rejected: LabelImportRejection[] = []
  let unchanged = 0

  const keys = Object.keys(labels)
  // Sorted, so the report and the write order are the file's own order rather
  // than the object's — two loads of the same file read the same way, and a
  // rejection list that reshuffles reads as a second problem.
  for (const raw of [...keys].sort(byKey)) {
    const key = raw.trim()
    if (key === '') {
      rejected.push({ key: raw, locale: null, error: ERR_SHAPE })
      continue
    }

    const pair = readPair(labels[raw])
    if (pair === undefined) {
      rejected.push({ key, locale: null, error: ERR_SHAPE })
      continue
    }

    const shippedEn = shippedFor(key, 'en', lookup)
    const shippedAr = shippedFor(key, 'ar', lookup)
    // Unknown in BOTH languages: not this app's key. Skipped, never written —
    // see the header. A key unknown in only ONE language is a real key with a
    // different shape on the other side, and its value there is validated.
    if (shippedEn === undefined && shippedAr === undefined) {
      skipped.push(key)
      continue
    }

    const en = checkSide(key, 'en', pair.en, shippedEn)
    const ar = checkSide(key, 'ar', pair.ar, shippedAr)
    // BOTH sides are reported, not just the first: a row with two problems
    // fixed one at a time is two round trips through a file the owner is
    // editing in another window.
    if (!en.ok) rejected.push({ key, locale: 'en', error: en.error, vars: en.vars })
    if (!ar.ok) rejected.push({ key, locale: 'ar', error: ar.error, vars: ar.vars })
    if (!en.ok || !ar.ok) continue

    const existing = stored.get(key)
    // Nothing to write, and that includes "reset a key that is not overridden".
    // Sending it anyway would stamp `updated_at` and `updated_by` on rows nobody
    // changed, and the audit trail is there to answer who reworded what.
    if (text(existing?.en) === en.value && text(existing?.ar) === ar.value) {
      unchanged += 1
      continue
    }
    apply.push({ key, en: en.value, ar: ar.value })
  }

  return {
    ok: true,
    plan: {
      // ALL OR NOTHING, structurally. See the header — a caller that forgets to
      // check `rejected` still cannot write half a file.
      apply: rejected.length > 0 ? [] : apply,
      unchanged,
      skipped,
      rejected,
      total: keys.length,
    },
  }
}
