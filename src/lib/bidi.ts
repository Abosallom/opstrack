// Unicode bidi isolates. The other half of lib/text.ts: that module makes
// Arabic *match*, this one makes mixed Arabic/Latin text *read*.
//
// THE FAILURE THIS EXISTS FOR. lib/i18n.ts sets `dir="rtl"` on <html> for the
// whole Arabic UI, so every Arabic string is laid out by the Unicode
// Bidirectional Algorithm with a right-to-left paragraph direction. The UBA
// resolves NEUTRAL characters — spaces, punctuation, `#`, `:`, `\`, `/`, the
// guillemets — from the direction of the strong characters on either side. That
// rule is right for prose and wrong for tokens:
//
//   'أدخل لونًا مثل #22b8d6.'   the `#` sits between Arabic and a hex run, so it
//                               resolves RTL and lands on the far side of the
//                               digits: the user is shown `22b8d6 #`.
//   'due:غدًا'                   `due` is a left-to-right run, `غدًا` a
//                               right-to-left one, and the neutral `:` between
//                               them goes to the paragraph direction — the token
//                               renders as `غدًا:due`, back to front.
//   'لا يوجد مسار يطابق «Core».'  the value is Latin, the guillemets are neutral
//                               and mirrored, and they end up swapped.
//
// None of these are translation errors. The Arabic is correct; the *order* is
// not, and no amount of rewording fixes it — only an isolate does.
//
// THE TWO CHARACTERS THAT FIX IT. An isolate opens a run whose direction is
// decided independently of its surroundings, and which the surroundings then
// treat as a single neutral object — so nothing leaks in either direction.
//
//   FSI (First Strong Isolate) for values whose direction is UNKNOWN at write
//   time: entry titles, track names, member names, emails, formatted dates. The
//   run takes the direction of its own first strong character, which is exactly
//   the question "is this title Arabic or Latin?" answered at render time.
//
//   LRI (Left-to-Right Isolate) for literals KNOWN to be left-to-right: the
//   parser's keyed prefixes, hex colours, URLs, ISO dates, product names. Their
//   direction is a property of the string, not of the data.
//
//   RLI is the mirror of LRI, for an Arabic literal inside an English sentence.
//   The en/ tree needs it for the same reason the ar/ tree needs LRI.
//
// WHERE TO PUT THEM. For a string that interpolates, the isolate belongs in the
// LOCALE FILE, around the `{var}`, because t() interpolates into the template
// and never sees the call site: `'يستحق ⁨{date}⁩'`. This module is for the other
// half — values assembled in TypeScript (a range, a joined list, an aria-label
// built from two fields), where there is no template to annotate.
//
// The controls are U+2066–U+2069. They are invisible, they are not whitespace
// (String.trim() will not remove them), and they must never reach the database:
// strip with stripIsolates() before persisting anything a user typed.

/** U+2066 — direction of the run is left-to-right. */
export const LRI = '⁦'

/** U+2067 — direction of the run is right-to-left. */
export const RLI = '⁧'

/** U+2068 — direction of the run is that of its first strong character. */
export const FSI = '⁨'

/** U+2069 — closes the innermost open isolate. */
export const PDI = '⁩'

/** All four controls, for stripping. */
const ISOLATES = /[⁦-⁩]/g

/**
 * Close what the value left open, drop what it never opened.
 *
 * A value is user data — an entry title pasted out of Outlook can carry a stray
 * PDI, and one unmatched PDI inside our wrapper closes OUR isolate early and
 * lets the rest of the value bleed into the sentence. That is the exact bug the
 * wrapper exists to prevent, arriving through the wrapper.
 *
 * Balancing rather than stripping, because a caller composing an already
 * isolated fragment (a range inside a label) is legitimate and nesting is legal
 * up to 125 deep.
 */
function balance(value: string): string {
  let depth = 0
  let out = ''
  for (const ch of value) {
    if (ch === LRI || ch === RLI || ch === FSI) depth += 1
    else if (ch === PDI) {
      if (depth === 0) continue
      depth -= 1
    }
    out += ch
  }
  return depth > 0 ? out + PDI.repeat(depth) : out
}

/**
 * Wrap in FSI…PDI: "render this by its own first strong character".
 *
 * The default for anything that came out of the database or off a keyboard.
 * Empty in, empty out — two invisible controls around nothing would defeat an
 * `=== ''` check at the call site and render as a stray space to nobody's
 * benefit.
 */
export function isolate(value: string): string {
  return value === '' ? '' : FSI + balance(value) + PDI
}

/** Wrap in LRI…PDI: "this literal is left-to-right". `#22b8d6`, `due:`, a URL. */
export function ltrIsolate(value: string): string {
  return value === '' ? '' : LRI + balance(value) + PDI
}

/** Wrap in RLI…PDI: an Arabic literal quoted inside an English sentence. */
export function rtlIsolate(value: string): string {
  return value === '' ? '' : RLI + balance(value) + PDI
}

/**
 * A numeric range as ONE isolated unit — `1–10`, `14/8 – 21/8`, `3 of 200`.
 *
 * Not two isolated numbers with a separator between them, which is the tempting
 * and wrong fix. Digits are European Numbers, the UBA resolves a neutral
 * BETWEEN two numbers to the paragraph direction, and under `dir="rtl"` that
 * turns `5–10` into `10–5` — a different, entirely plausible range. Isolating
 * each side leaves the separator outside both isolates and changes nothing. The
 * whole range has to be one run.
 *
 * FSI, not LRI, so a range of Arabic month names still reads right-to-left.
 */
export function isolateRange(from: string, to: string, separator = '–'): string {
  return isolate(`${from}${separator}${to}`)
}

/**
 * Isolate the left-to-right tokens of a capture line, for DISPLAY only.
 *
 * The capture examples (`capture.exampleFull` and friends) are inserted into
 * the input verbatim when tapped, so they are stored isolate-free — putting the
 * controls in those locale strings would feed U+2066 to lib/capture/parse.ts,
 * whose BIDI_MARKS class covers U+200B–U+200F and U+061C and would carry the
 * isolate into the token as a literal character. A component rendering such a
 * line calls this instead, and passes the raw string to setText().
 *
 * Splits on whitespace and isolates every token containing an ASCII letter or
 * digit, so `@ahmed`, `due:+7d` and `+portal` become units while `#الشبكات` and
 * `!عالية` are left to the paragraph direction, where they already read
 * correctly. A quoted value with a space inside (`#"IT Operations"`) is two
 * tokens to this function and is isolated as two — acceptable, because both
 * halves are Latin and land in the right order anyway.
 */
export function isolateTokens(line: string): string {
  return line.replace(/\S+/g, (token) => (/[A-Za-z0-9]/.test(token) ? ltrIsolate(token) : token))
}

/**
 * Remove every isolate control.
 *
 * For anything crossing a boundary that does not lay text out: a value on its
 * way to the database, a `copy to clipboard`, a filename, a test comparison.
 */
export function stripIsolates(value: string): string {
  return value.replace(ISOLATES, '')
}

/**
 * Does every isolate in the string get closed, and does no PDI close an isolate
 * that was never opened?
 *
 * The one property of a hand-written locale string that a machine can check:
 * an unbalanced isolate silently reorders the REST OF THE SENTENCE, not just
 * the token it was meant to fix.
 */
export function isolatesBalanced(value: string): boolean {
  let depth = 0
  for (const ch of value) {
    if (ch === LRI || ch === RLI || ch === FSI) depth += 1
    else if (ch === PDI) {
      if (depth === 0) return false
      depth -= 1
    }
  }
  return depth === 0
}
