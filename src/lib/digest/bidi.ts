// Bidi isolation for interpolated values.
//
// THE BUG THIS PREVENTS, which the Wave-2 audit found shipped across the whole
// Arabic tree: a Latin run dropped into an Arabic sentence drags the NEUTRAL
// characters beside it — the em dash, the parentheses, the slashes in a date —
// to the wrong side of itself. `المسار — Ahmed — due 14/08` renders with the
// dashes in the wrong places and `2026-08-14` renders as `14-08-2026`, which is
// not a broken string but a DIFFERENT, PLAUSIBLE one. Nobody files that bug;
// they just read the wrong date.
//
// The fix is U+2068 FIRST STRONG ISOLATE … U+2069 POP DIRECTIONAL ISOLATE around
// the value. FSI, not LRI/RLI: it takes its direction from the value's own first
// strong character, so one wrapper is correct for an English name, an Arabic
// name and a mixed one. The isolate also stops the value's direction leaking
// into the neutrals around it, which is the half that RLM/LRM marks never fix.
//
// WHY THIS IS NOT APPLIED UNCONDITIONALLY. The output of this module is pasted
// into WhatsApp, committed to a repo, and diffed against the §4.7 sample in the
// Wave-3 gate. Wrapping a pure-Latin name inside a pure-Latin sentence would put
// two invisible code points into every line of every English digest for no
// benefit, and make the gate's diff unreadable. So the rule is: isolate a value
// only when it is NOT unambiguously the paragraph's own direction.
//
//   rtl paragraph → isolate unless the value is Arabic-only
//                   (Latin, digits, dates and mixed all get wrapped)
//   ltr paragraph → isolate only when the value contains Arabic
//
// An English digest of English data therefore comes out byte-clean, and every
// mixed-direction case in either language is wrapped.
//
// PURE, and imports nothing. Both renderers and the builder may call it, though
// in practice only the builder does — a renderer that had to decide about
// direction would be deciding about language, which §2.16 forbids.

/** U+2068 FIRST STRONG ISOLATE. */
export const FSI = '⁨'
/** U+2069 POP DIRECTIONAL ISOLATE. */
export const PDI = '⁩'

/**
 * Strong right-to-left LETTERS: Hebrew, Arabic, Syriac, Thaana, NKo, plus the
 * Arabic presentation forms a paste from Word can carry.
 *
 * THE SUB-RANGES MATTER. A blanket `؀-ۿ` would also catch the Arabic
 * comma (U+060C), the Arabic question mark (U+061F) and the Arabic-Indic digits
 * (U+0660–0669) — none of which is strong RTL under UAX #9. That is not
 * pedantry: `Intl` renders an Arabic timestamp as `29/07/2026، 12:00`, and a
 * blanket range calls that string "already Arabic" and leaves it unwrapped
 * while wrapping the visually identical `23/07/2026–29/07/2026` beside it. Two
 * dates, one line, one isolated and one not, for a reason no reader could
 * guess. Excluding the punctuation makes both take the same path.
 *
 * Written as escapes, per lib/text.ts's rule: the endpoints of a range spelled
 * with glyphs cannot be checked in a diff, and several of these characters
 * reorder the line they appear in.
 */
const RTL_STRONG =
  /[\u05D0-\u05EA\u05EF-\u05F4\u0620-\u064A\u066E-\u06D3\u06D5\u06E5-\u06E6\u06EE-\u06EF\u06FA-\u06FF\u0710-\u072F\u0750-\u077F\u0780-\u07A5\u07CA-\u07EA\u0860-\u086A\u08A0-\u08BD\uFB1D-\uFDFF\uFE70-\uFEFC]/

/**
 * Strong left-to-right letters. Latin, Greek and Cyrillic cover every case this
 * workspace produces (vendor names, hostnames, ticket ids); CJK is left out
 * because it is strong-LTR too but never appears here, and a wider class only
 * costs precision.
 */
const LTR_STRONG = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]/

export function hasRtl(value: string): boolean {
  return RTL_STRONG.test(value)
}

export function hasLtr(value: string): boolean {
  return LTR_STRONG.test(value)
}

/**
 * True when `value` cannot be trusted to sit in a `dir` paragraph unwrapped.
 *
 * The `!hasRtl` half of the RTL branch is what catches dates, versions, ticket
 * numbers and any other digit-and-punctuation run — they have no strong
 * direction of their own and take the paragraph's, which is exactly the
 * `2026-08-14` → `14-08-2026` failure.
 */
export function needsIsolate(value: string, dir: 'ltr' | 'rtl'): boolean {
  if (value === '') return false
  return dir === 'rtl' ? hasLtr(value) || !hasRtl(value) : hasRtl(value)
}

/**
 * Wrap when it matters, leave alone when it does not.
 *
 * Idempotent in practice: a value already wrapped by a caller still tests the
 * same way, and double-wrapping is harmless — but do not rely on that. Isolate
 * once, at the point the value is interpolated into a sentence.
 */
export function isolate(value: string, dir: 'ltr' | 'rtl'): string {
  return needsIsolate(value, dir) ? `${FSI}${value}${PDI}` : value
}

/** Every isolate control back out — for tests, and for a plain-text fallback. */
export function stripIsolates(value: string): string {
  return value.replace(/[\u2066-\u2069]/g, '')
}
