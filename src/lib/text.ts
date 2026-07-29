// String folding for an app that has to match Arabic as well as it matches
// English. Pure, dependency-free, and imported by the parser, the entry filter,
// the digest and every search box — so it ships COMPLETE in the keystone rather
// than as a skeleton: lib/entryFilter.ts needs normalizeSearch() the same day.
//
// The problem this module exists for: Arabic is written with optional vowel
// marks, five spellings of alef that users treat as one letter, and three digit
// sets. The singular and plural of "network", and the same word with its vowels
// written in, are one word to a human and three different strings to `===`.
// Every comparison a user could plausibly expect to match goes through a fold.
//
// EVERY RANGE BELOW IS WRITTEN AS \u ESCAPES, and that is not a style
// preference. The readable-looking version of the marks class spells a range
// from the first harakat to the superscript alef — U+064B to U+0670 — a span
// that swallows U+0660–U+0669, the Arabic-Indic DIGITS. Folding would then
// delete every Arabic numeral in the string, and a `due:` token written with
// Arabic numerals would parse with its number gone. At these code points the
// glyphs are unreadable in a diff, several of them are invisible, and RTL
// reordering makes the endpoints of a range hard to even identify; the escapes
// are checkable. Single-character folds keep their glyphs, because there is no
// range to get wrong and the glyph IS the documentation.
//
// Nothing here is locale-switched. Folding runs the same in both languages
// because the DATA is bilingual regardless of the UI language — an English UI
// still has to find an Arabic track name.

/**
 * Combining marks: harakat (fathatan…sukun), the extended set, the superscript
 * alef and the Quranic annotations. All are optional in ordinary writing, so
 * any of them present in the data and absent in the query (or the reverse) must
 * not block a match.
 */
const MARKS = /[\u064B-\u065F\u0670\u06D6-\u06ED]/g

/** Tatweel, the decorative letter-stretcher. Carries no meaning at all. */
const TATWEEL = /\u0640/g

/**
 * The alef family, plus the four letters users interchange freely.
 *
 * The taa-marbuta → haa and alef-maqsura → yaa folds are the two that actually
 * matter in practice: writing a feminine ending as a plain haa, or a final
 * alef-maqsura as a yaa, are typos nobody considers typos.
 */
const LETTER_FOLDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/[آأإٱ]/g, 'ا'], // آ أ إ ٱ → ا
  [/ى/g, 'ي'], //                     ى → ي
  [/ة/g, 'ه'], //                     ة → ه
  [/ؤ/g, 'و'], //                     ؤ → و
  [/ئ/g, 'ي'], //                     ئ → ي
]

/** Arabic-Indic ٠–٩ and Eastern Arabic / Persian ۰–۹. */
const DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/g

/**
 * Suffixes stemArabic() strips, longest first.
 *
 * Longest-first is not cosmetic: a word ending in the sound-plural ون would
 * lose only its final ن under a shortest-first pass and stop matching its own
 * singular.
 */
const STEM_SUFFIXES: readonly string[] = ['ات', 'ين', 'ون', 'ه'] // ات ين ون ه

/** Below this, stripping a suffix destroys the word rather than stemming it. */
const MIN_STEM_LENGTH = 5

/**
 * Strip the marks that carry no lexical weight and normalise the
 * interchangeable letters.
 *
 * NFC runs first so a decomposed alef + hamza-above composes to a single أ and
 * then folds to ا — otherwise the same word typed on two keyboards folds to two
 * different strings, which is exactly the silent-Arabic-failure class this
 * whole module defends against.
 */
export function foldArabic(s: string): string {
  let out = s.normalize('NFC').replace(MARKS, '').replace(TATWEEL, '')
  for (const [pattern, replacement] of LETTER_FOLDS) out = out.replace(pattern, replacement)
  return out
}

/**
 * Arabic-Indic and Eastern Arabic digits → Latin.
 *
 * A relative date typed with Arabic numerals has to parse. The app renders
 * Latin numerals in both languages by spec, but an Arabic keyboard produces
 * these, and refusing them would make the parser feel broken to exactly the
 * users it was translated for.
 */
export function foldDigits(s: string): string {
  return s.replace(DIGITS, (d) => {
    const code = d.charCodeAt(0)
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660
    return String(code - base)
  })
}

/**
 * Strip ONE trailing plural/feminine suffix, when the word can afford it.
 *
 * Deliberately crude — this is not a morphological analyser, it is the second
 * tier of a track-name matcher. It exists because migration 0001 seeds the
 * Network track under its Arabic PLURAL and users type the singular: under the
 * taa-marbuta fold those two become strings that fail exact match, fail prefix
 * match in both directions, and fail subsequence match because the singular's
 * final haa does not appear in the plural at all. Stemming both to a shared
 * three-letter root is what makes the Arabic half of the parser work. Verified
 * against the real seed values in 0001, not against the fixture list that got
 * this wrong the first time and shipped green.
 */
export function stemArabic(s: string): string {
  if (s.length < MIN_STEM_LENGTH) return s
  for (const suffix of STEM_SUFFIXES) {
    if (s.endsWith(suffix)) return s.slice(0, -suffix.length)
  }
  return s
}

/**
 * The canonical form for free-text search: lowercased, digit- and
 * Arabic-folded, whitespace collapsed.
 *
 * Word boundaries SURVIVE (spaces are collapsed, not removed) because search is
 * matched against prose — titles, descriptions, tags — where `network` must not
 * match `netbackupwork`. foldKey() is the variant for identifier matching.
 */
export function normalizeSearch(s: string): string {
  return foldArabic(foldDigits(s.toLowerCase())).replace(/\s+/g, ' ').trim()
}

/**
 * The canonical form for matching a NAME against a query: normalizeSearch plus
 * the separators people type inconsistently.
 *
 * `#it-ops`, `#it_ops` and `#itops` are one intent. Kept distinct from
 * normalizeSearch so prose search does not silently glue words together.
 */
export function foldKey(s: string): string {
  return normalizeSearch(s).replace(/[-_]/g, '')
}

/**
 * Do `needle`'s characters appear in `haystack` in order, not necessarily
 * adjacent? The parser's third and loosest match tier — `itops` finding
 * `IT Operations`.
 *
 * BOTH ARGUMENTS MUST ALREADY BE FOLDED. This function does not fold, because
 * the caller is matching one query against a whole list and folding the query
 * once outside the loop is the entire point.
 */
export function isSubsequence(needle: string, haystack: string): boolean {
  if (needle === '') return true
  let i = 0
  for (const ch of haystack) {
    if (ch === needle[i]) i += 1
    if (i === needle.length) return true
  }
  return false
}

/**
 * Up to two initials for an avatar, from the first two words.
 *
 * Marks are stripped so an initial is never a bare combining mark rendering as
 * a dotted circle, but the letters are NOT folded: a name beginning with a
 * hamza-carrying alef should show that alef, not a plain one. Arabic has no
 * case, so toUpperCase() is a no-op there and correct here.
 */
export function initials(name: string): string {
  const words = name.replace(MARKS, '').replace(TATWEEL, '').trim().split(/\s+/).filter(Boolean)
  return words
    .slice(0, 2)
    .map((word) => [...word][0] ?? '')
    .join('')
    .toUpperCase()
}

/**
 * Escape for interpolation into HTML.
 *
 * The one caller that must never forget: the digest's HTML renderer, which
 * builds an email body as a string because there is no DOM and no stylesheet on
 * the other side. Entry titles are user input and go straight into it.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Hard-truncate to `n` CHARACTERS INCLUDING the ellipsis.
 *
 * Iterated as code points, so a truncation never lands between the halves of a
 * surrogate pair and renders as a replacement character — the failure mode that
 * only shows up once someone puts an emoji in a title.
 */
export function truncate(s: string, n: number): string {
  if (n <= 0) return ''
  const chars = [...s]
  if (chars.length <= n) return s
  return chars.slice(0, n - 1).join('') + '…'
}
