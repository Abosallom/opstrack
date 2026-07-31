// One label override, checked before it is allowed anywhere near t().
//
// THE FEATURE THIS GUARDS. Settings › Terminology lets an admin rename anything
// a person reads, in both languages, without a deploy. That is the point of it —
// and it is also a text box wired directly to every string in the product, so
// the only thing standing between the owner and an unreadable app is this file.
//
// PURE, AND IT HAS TO BE. No store, no api, no React, no bundles. It is handed
// the SHIPPED value and a CANDIDATE and answers with a value to store or a
// reason not to; lib/i18n.ts owns the bundles and the resolution, store/ owns
// the row. That split is what lets this run in vitest's `node` environment, and
// it is why `Locale` below is an `import type` — a value import of lib/i18n.ts
// would drag React and `localStorage` into a pure suite (see lib/plural.ts's
// header, which is the same rule for the same reason).
//
// THE FOUR THINGS THAT CAN GO WRONG, and where each is answered:
//
//   1. A DROPPED PLACEHOLDER silently deletes information. `entry.createdBy` is
//      `Created by ⁨{name}⁩`; an override of `Created by` renders a sentence that
//      is grammatical, confident and missing the only fact in it. An INVENTED
//      placeholder is the mirror — `{foo}` has no variable behind it, so
//      interpolate() leaves the braces verbatim and the UI shows `{foo}`. The
//      token set must therefore match exactly, and the refusal NAMES the token,
//      because "invalid placeholder" is not something an ops lead can act on.
//
//   2. A PLURAL KEY IS NOT ONE STRING. Arabic selects up to six forms and the
//      shipped nodes carry the ones it can reach. Overriding such a key as a
//      single string would freeze one grammatical number for every count — the
//      exact defect lib/plural.ts exists to have removed. So a plural key is
//      overridden ONE FORM AT A TIME, at `key.category`, and each form goes
//      through the rule lib/plural.ts already states: `{count}` is required in a
//      category that covers many numbers and optional in one that pins a single
//      number (EXACT_CATEGORIES). That constant is imported, not restated; a
//      second copy of the rule is a second thing to drift.
//
//   3. DIRECTION. Under `dir="rtl"` a bare `{title}` next to a neutral character
//      reorders its own sentence — `{from} → {to}` with two Arabic labels shows
//      the status change BACKWARDS. src/lib/bidi.test.ts gates every shipped
//      string on this, in both trees. An override has to clear the same bar, and
//      asking the owner to type U+2068 is not a plan, so the fences are applied
//      here on the way in, through lib/bidi.ts.
//
//      THE RULE IS "MIRROR THE SHIPPED STRING", not "isolate everything in
//      Arabic", and the difference is not pedantry. The shipped string already
//      passes the gate, so it is the exact statement of which tokens need
//      fencing and with which control: `{title}` is fenced because a title can
//      start with a Latin letter; `{count}` deliberately is NOT, because a bare
//      number beside Arabic already reads correctly and fencing one detaches the
//      `٪` that belongs to it — bidi.test.ts's NUMERIC_TOKENS documents that
//      case in full, and a blanket "Arabic gets FSI" rule would reintroduce it
//      on every counted string in the product. Copying the shipped answer per
//      token is right in both languages and cannot invent a fence the gate
//      itself calls a mistake. TWO things are added on top: a token the
//      CANDIDATE newly puts in quotes — `«{count}»` swaps its own guillemets
//      even though `{count}` needed nothing before — and a DIGIT RANGE typed
//      into an Arabic label, `3–10`, which the UBA lays out as `10–3` and which
//      no token pass can see because it is a literal. Nothing else is touched:
//      the note this screen shows above the inputs promises exactly that much
//      and no more, because an isolator clever enough to guess at the rest would
//      be rewriting the owner's words on a heuristic nobody can review.
//
//   4. BLANK MEANS DEFAULT. An empty input CLEARS the override; it never stores
//      an empty label. `ok: true, value: null` is that answer, and it is a
//      success rather than a refusal because clearing is the escape hatch the
//      whole feature depends on — including for the admin who just blanked a nav
//      label and needs it back. "Empty" is isBlankLabel() below, and it is wider
//      than `String.trim()`: an invisible format character — a pasted zero-width
//      space, a right-to-left mark — is empty to the reader and non-empty to
//      trim(), and every layer of this feature used to disagree about that.

import {
  FSI,
  LRI,
  RLI,
  isolate,
  isolatesBalanced,
  ltrIsolate,
  rtlIsolate,
  stripInvisible,
  stripIsolates,
} from './bidi'
import {
  EXACT_CATEGORIES,
  PLURAL_CATEGORIES,
  isPluralNode,
  pluralCategory,
  type PluralCategory,
  type PluralNode,
} from './plural'
import type { Locale } from './i18n'

/**
 * The answer for one candidate.
 *
 * Shaped like `api/result.ts`'s ApiResult on purpose, down to `error` being an
 * i18n KEY rather than a sentence — lib/ may not import api/, but a second
 * result convention in the same codebase is a cost with no payer. `vars` carries
 * the offending token or category so the caller renders `t(error, vars)` and the
 * owner is told WHICH placeholder they dropped.
 *
 * `value: null` on the success branch means CLEAR the override, not "store an
 * empty string" — see rule 4 in the header.
 */
export type OverrideCheck =
  | { readonly ok: true; readonly value: string | null }
  | { readonly ok: false; readonly error: string; readonly vars?: Readonly<Record<string, string>> }

/**
 * Every refusal this module can return, so the two locale bundles can be checked
 * against one list instead of against a grep. Each is a `t()` key; the ones
 * carrying a variable name it in the trailing comment.
 */
export const OVERRIDE_ERROR_KEYS: readonly string[] = [
  'terminology.errUnknownKey',
  'terminology.errPluralWhole',
  'terminology.errUnreachableCategory', // {category}
  'terminology.errTokenMissing', //        {token}
  'terminology.errTokenUnknown', //        {token}
  'terminology.errCountMissing', //        {category}
]

/**
 * The row key for an override: the plain dot path, or `path.category` for one
 * form of a plural node.
 *
 * THE ONE PLACE THIS FORMAT IS WRITTEN. lib/i18n.ts calls it when it overlays a
 * plural node and the admin screen calls it when it saves a row; if the two ever
 * disagreed, the override would be stored under a key nothing reads — the worst
 * failure this feature has, because it is silent and indistinguishable from "the
 * save did not work".
 */
export function overrideKey(base: string, category?: PluralCategory): string {
  return category === undefined ? base : `${base}.${category}`
}

/**
 * IS THIS EMPTY TO THE PERSON LOOKING AT IT? The one definition of blank the
 * whole feature runs on, and the reason it is exported from a pure module rather
 * than written out four times.
 *
 * Spec rule 5 is "blank means default, never an empty label", and it has four
 * keepers: this validator refuses to PRODUCE a blank override, api/labels.ts
 * refuses to SEND one, 0016's `label_overrides_touch()` refuses to STORE one and
 * lib/i18n.ts's overrideFor() refuses to RENDER one. Four tests of emptiness in
 * four layers is four chances to disagree, and they did: every one of them was
 * `String.trim() === ''`, which is blind to the invisible format characters —
 * U+200B, the LRM/RLM/ALM bidi marks, the word joiner, the soft hyphen. An
 * override of a single one of those passed all four and rendered a genuinely
 * empty label, including on this screen's own Reset buttons. They are not
 * exotic: they are what a paste out of Word, Outlook or a web page carries.
 *
 * `stripInvisible()` before `trim()` is the whole fix — see lib/bidi.ts, which
 * owns the character class so that this file cannot spell it differently.
 */
export function isBlankLabel(value: string | null | undefined): boolean {
  return value === null || value === undefined || stripInvisible(value).trim() === ''
}

/**
 * Plural category → the `t()` key that NAMES that form for a reader.
 *
 * Here rather than in the screen because two places render a refusal that talks
 * about a form — the row editor and the import report — and because the refusal
 * itself is raised in this file. A message that said `few` would be naming the
 * field by a word that appears nowhere in the UI and is not even in the reader's
 * language; three lines above the input, the same form is called `A few (3–10)`
 * / `قليل (⁦3–10⁩)`. The map is exported as KEYS, not text, so this module stays
 * pure and the sentence flips language with everything else.
 */
export const FORM_LABEL_KEYS: Readonly<Record<PluralCategory, string>> = {
  zero: 'terminology.formZero',
  one: 'terminology.formOne',
  two: 'terminology.formTwo',
  few: 'terminology.formFew',
  many: 'terminology.formMany',
  other: 'terminology.formOther',
}

const SELECTABLE = new Map<Locale, readonly PluralCategory[]>()

/**
 * The plural categories this language can actually select — two in English, six
 * in Arabic.
 *
 * Exported because the admin screen needs exactly this list to decide how many
 * inputs a plural row gets: offering an English `few` field would invite the
 * owner to write a string no reader can ever be shown, which is the same defect
 * localeParity.test.ts refuses in the shipped tree ("ship no form this language
 * can never select"). Derived by sampling `pluralCategory`, not by a second
 * hand-written table — that function is the only place the CLDR rules live.
 */
export function selectableCategories(locale: Locale): readonly PluralCategory[] {
  const cached = SELECTABLE.get(locale)
  if (cached !== undefined) return cached
  const seen = new Set<PluralCategory>()
  // 0–200 covers every boundary either rule has: ar's mod-100 bands repeat, and
  // en distinguishes only 1. plural.test.ts walks 0–1000 and finds no more.
  for (let n = 0; n <= 200; n++) seen.add(pluralCategory(locale, n))
  const out = PLURAL_CATEGORIES.filter((c) => seen.has(c))
  SELECTABLE.set(locale, out)
  return out
}

/** `{name}` — the same shape lib/i18n.ts's interpolate() replaces. */
const PLACEHOLDER = /\{(\w+)\}/g

/** An isolate opener immediately before `{`, PDI immediately after `}`. */
const FENCED = /([⁦⁧⁨])\{(\w+)\}⁩/g

/** The quote characters src/lib/bidi.test.ts watches for around a token. */
const QUOTES = /[«»“”"']/

/**
 * A digit range the owner typed — `3–10`, `11 - 99`, `0 — 5`.
 *
 * The one literal (as opposed to `{placeholder}`) that reorders itself in
 * Arabic, and it does so silently: digits are European Numbers, the UBA resolves
 * a neutral BETWEEN two numbers to the paragraph direction, and under `dir=rtl`
 * `3–10` is laid out as `10–3` — a different, entirely plausible range.
 * lib/bidi.ts's isolateRange() documents the case in full and exists for it; the
 * shipped tree is held to it by bidi.test.ts. An override is typed into a box
 * with no gate behind it, so the fence is applied here instead.
 */
const NUMERIC_RANGE = /\d+\s*[-–—]\s*\d+/g

/** Opener character → the lib/bidi.ts wrapper that produces it. */
const WRAPPERS = new Map<string, (value: string) => string>([
  [LRI, ltrIsolate],
  [RLI, rtlIsolate],
  [FSI, isolate],
])

function tokensOf(value: string): Set<string> {
  return new Set([...value.matchAll(PLACEHOLDER)].map((m) => m[1]))
}

/** token → the isolate opener the reference fences it with, where it does. */
function fencesOf(reference: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of reference.matchAll(FENCED)) out.set(m[2], m[1])
  return out
}

/**
 * Re-fence the candidate's placeholders the way the reference fences them.
 *
 * Unfence-then-fence rather than fence-whatever-is-bare, so it is idempotent:
 * the owner's most likely starting point is the shipped string itself, copied
 * out of the "default" line above the input, invisible controls and all.
 */
/**
 * Fence a digit range in an ARABIC value, unless it is already fenced.
 *
 * Idempotent by inspecting the character in front of the match rather than by
 * tracking state: the owner's most likely starting point is the shipped string
 * copied out of the "default" line above the input, invisible controls and all,
 * and re-saving what this function produced must not nest a second isolate on
 * every pass. FSI rather than LRI, following isolateRange(): a range is one run,
 * and its own first strong character is the right thing to take the direction
 * from.
 *
 * ARABIC ONLY. An English label renders in an LTR paragraph, where a digit range
 * already reads correctly and a fence would be two invisible characters bought
 * for nothing.
 */
function fenceRanges(value: string): string {
  return value.replace(NUMERIC_RANGE, (match: string, at: number, whole: string) => {
    const before = whole.charAt(at - 1)
    const already = before === LRI || before === RLI || before === FSI
    return already ? match : isolate(match)
  })
}

function refence(candidate: string, reference: string): string {
  const fences = fencesOf(reference)
  const bare = candidate.replace(FENCED, '{$2}')
  return bare.replace(PLACEHOLDER, (match: string, token: string, at: number, whole: string) => {
    // A token the candidate newly wraps in quotes needs FSI even where the
    // reference left it bare: the quotes are neutrals and swap around a value
    // that runs the other way.
    const quoted =
      QUOTES.test(whole.slice(Math.max(0, at - 1), at)) &&
      QUOTES.test(whole.slice(at + match.length, at + match.length + 1))
    const opener = fences.get(token) ?? (quoted ? FSI : undefined)
    const wrap = opener === undefined ? undefined : WRAPPERS.get(opener)
    return wrap === undefined ? match : wrap(match)
  })
}

/**
 * Which plural form is `key` naming, if any?
 *
 * Read off the END OF THE KEY rather than passed as a fifth argument, so that
 * the key handed to this function is byte-for-byte the key the row is stored
 * under and lib/i18n.ts looks up. One string, one meaning — and lib/i18n.ts's
 * setOverrides() derives its plural index by this same lexical rule, so the two
 * cannot read the same row differently.
 *
 * PURELY LEXICAL, AND THE AMBIGUITY IS THE CALLER'S TO RESOLVE, not this
 * function's. `nav.one` is a plural form if `nav` is a plural node and a plain
 * key if `nav.one` is a string — and the caller already knows which, because it
 * had to look the key up to pass `shipped` at all. So this is consulted only
 * when `shipped` IS a node; a plain string is overridden as itself whatever its
 * last segment happens to spell.
 */
function categoryOf(key: string): PluralCategory | undefined {
  const dot = key.lastIndexOf('.')
  if (dot <= 0) return undefined
  const tail = key.slice(dot + 1)
  return (PLURAL_CATEGORIES as readonly string[]).includes(tail)
    ? (tail as PluralCategory)
    : undefined
}

function fail(error: string, vars?: Readonly<Record<string, string>>): OverrideCheck {
  return vars === undefined ? { ok: false, error } : { ok: false, error, vars }
}

/**
 * Is this candidate a legal override of `shipped`, and what should be stored?
 *
 * @param key       the ROW key — `entry.createdBy`, or `board.total.few` for one
 *                  form of a plural node. `overrideKey()` builds it.
 * @param shipped   what the bundle holds at the BASE key IN THIS LOCALE: a
 *                  string, the plural node, or `undefined` when the locale has
 *                  no such key. Per locale, deliberately — `board.total` is a
 *                  plural node in English and an invariant string in Arabic, and
 *                  the screen must offer several inputs on one side and one on
 *                  the other.
 * @param candidate what the owner typed, verbatim.
 * @param locale    which column the value is bound for.
 */
export function validateOverride(
  key: string,
  shipped: string | PluralNode | undefined,
  candidate: string,
  locale: Locale,
): OverrideCheck {
  // A key the bundles do not carry cannot be validated against anything, and an
  // override of it could never render — resolution reaches the bundle first.
  if (shipped === undefined) return fail('terminology.errUnknownKey')

  // Blank clears. Checked before ANY other rule, because "give me the shipped
  // string back" must never be refused for a missing placeholder — that is
  // precisely the state an admin is trying to escape from. isBlankLabel() is
  // the shared rule, and it is wider than trim(): a box holding nothing but a
  // pasted zero-width space or a right-to-left mark is empty to the person
  // looking at it, and storing it would render a label as blank space.
  if (isBlankLabel(candidate)) return { ok: true, value: null }

  const plural = isPluralNode(shipped)
  const category = plural ? categoryOf(key) : undefined

  if (plural) {
    // Rule 2: never as one string. The screen offers a field per form, so a key
    // that names no form means the caller has not — and freezing one
    // grammatical number for every count is the defect lib/plural.ts exists to
    // have removed.
    if (category === undefined) return fail('terminology.errPluralWhole')
    // English reaches `one` and `other` and nothing else; a form outside that
    // set is a string no reader of this language can ever be shown, which is
    // what localeParity.test.ts refuses in the shipped tree.
    if (!selectableCategories(locale).includes(category)) {
      return fail('terminology.errUnreachableCategory', { category })
    }
  }

  // THE REFERENCE IS `other`, NOT THE SAME FORM. That is the rule the shipped
  // tree is already held to (localeParity.test.ts: "never invent a token their
  // `other` form lacks", "keep every non-`count` token of `other` in every
  // form"), and it is the only choice that works for a category the node does
  // not currently carry — an admin adding a `zero` form to an Arabic node has no
  // same-category string to be measured against, and `other` is always there.
  const reference = plural ? shipped.other : shipped
  const allowed = tokensOf(reference)
  // A plural form may ALWAYS show the number it counts, whatever `other` does
  // with it; whether it MUST is the category's business, two blocks down.
  if (plural) allowed.add('count')
  const exact = category !== undefined && (EXACT_CATEGORIES as readonly string[]).includes(category)
  const typed = tokensOf(candidate)

  // Sorted so a candidate missing two tokens always names the same one first —
  // an error message that reshuffles between saves reads as a second problem.
  for (const token of [...allowed].sort()) {
    // `{count}` inside a plural node is the one token whose requirement depends
    // on the CATEGORY rather than on `other`, so it is left to the check below,
    // which can say "this form covers many numbers" instead of "you dropped a
    // token". Outside a plural node — `board.total` is the plain string
    // "عدد البنود: {count}" in Arabic — it is required like any other.
    if (token === 'count' && plural) continue
    // NAMED WITH ITS BRACES. `tokensOf()` collects the identifier alone, and a
    // message that says `name` is telling the owner to type the wrong text —
    // doubly so for errTokenUnknown, which ends "braces and all" while showing
    // none. The locale strings wrap this in LRI…PDI, so the braces land inside
    // the fence and the whole token reads correctly in Arabic too.
    if (!typed.has(token)) return fail('terminology.errTokenMissing', { token: `{${token}}` })
  }
  for (const token of [...typed].sort()) {
    if (!allowed.has(token)) return fail('terminology.errTokenUnknown', { token: `{${token}}` })
  }
  // A range category covers many numbers, so a form without `{count}` loses the
  // number the reader came for. An exact category needs no such thing: "بند
  // واحد", not "1 بند واحد" — EXACT_CATEGORIES, imported rather than restated.
  if (category !== undefined && !exact && !typed.has('count')) {
    return fail('terminology.errCountMissing', { category })
  }

  // Unbalanced isolates reorder the REST OF THE SENTENCE, not just the token
  // they were meant to fix, and nobody types them on purpose — they arrive by
  // paste. Strip the lot and let refence() put back exactly the ones the shipped
  // string justifies, rather than refusing for a reason nobody can see.
  const sane = isolatesBalanced(candidate) ? candidate : stripIsolates(candidate)
  const fenced = refence(sane.trim(), reference)
  // The one literal the token pass cannot reach. Everything else the owner types
  // is left exactly as typed — see the note this screen shows above the inputs,
  // which promises precisely this and no more.
  return { ok: true, value: locale === 'ar' ? fenceRanges(fenced) : fenced }
}
