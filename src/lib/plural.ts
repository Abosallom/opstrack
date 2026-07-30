// CLDR cardinal plural selection. The whole of it, and nothing else.
//
// WHY THIS IS ITS OWN MODULE AND NOT PART OF i18n.ts. Two callers need the same
// table: `t()` in lib/i18n.ts, which answers for the GLOBAL current locale, and
// `s()` in lib/dates.ts, which answers for an EXPLICITLY REQUESTED one (plan
// §2.16 — a digest renderer produces Arabic while the UI is English, so it can
// never call t()). Two copies of a CLDR table is two tables to drift.
//
// It cannot live in either of them. lib/dates.ts is a pure module by contract —
// its header freezes "no store, no api, no cycle" — and lib/i18n.ts reads
// `localStorage` at module scope and imports React, so a value import of i18n
// from dates puts a DOM dependency in the import graph of every pure test in the
// repo. This file imports NOTHING at runtime; the `Locale` import is
// `import type` and is erased (verbatimModuleSyntax), so there is no cycle.
//
// A key whose value is an OBJECT of CLDR plural categories instead of a string
// is a plural node, and `{count}` picks the form:
//
//   "usageEntries": { "one": "{count} entry", "other": "{count} entries" }
//
// WHY THIS EXISTS. Until this landed, every counted string in the app was
// written in one hardcoded grammatical number, which produced "1 entries" and
// "This track: 1 days" in English and — far worse — `متأخّر 9 يوم` and
// `2 يوم` in Arabic, where the singular is ungrammatical for 2 and for 3–10.
// Arabic is not a language you can fake with an `s`.
//
// CATEGORIES ARE PER LANGUAGE, and that is why the two bundles are allowed to
// disagree about the shape of one key. English distinguishes two forms; Arabic
// distinguishes up to six; a string that needs no inflection in one language and
// does in the other stays a plain string on the side that does not care —
// `board.total` is `{one, other}` in English and the invariant "عدد البنود: {count}"
// in Arabic, and both are right. `other` is the only required form; a missing
// category falls back to it, the same contract ICU MessageFormat states.
// localeParity.test.ts enforces the rest — see EXACT_CATEGORIES below.

import type { Locale } from './i18n'

/** CLDR cardinal categories, in the canonical order. */
export const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const

export type PluralCategory = (typeof PLURAL_CATEGORIES)[number]

/**
 * The categories that match EXACTLY ONE number, in both languages this app
 * ships: `zero` is only 0, `one` is only 1, `two` is only 2.
 *
 * This is the distinction the parity gate is built on. A form in one of these
 * categories may omit `{count}` — the category already pins the value, and
 * every natural language spells it out instead: "Every day", not "Every 1 day";
 * `بند واحد`, not `1 بند واحد`. A form in a RANGE category (`few`, `many`,
 * `other`) covers many numbers, so dropping `{count}` there loses information
 * the reader needs and is always a bug — that is the check worth having, and
 * blanket-requiring `{count}` everywhere would forbid correct Arabic instead.
 */
export const EXACT_CATEGORIES: readonly PluralCategory[] = ['zero', 'one', 'two']

/**
 * A well-formed plural node: any subset of the categories, and always `other`.
 *
 * `other` is required in the TYPE and not merely by convention, so that every
 * selection below is total — a caller can never be handed `undefined` for a
 * count the node happens not to name.
 */
export type PluralNode = Partial<Record<PluralCategory, string>> & { other: string }

/**
 * Is this node a plural node rather than a nested namespace?
 *
 * Structural, not by naming convention: every own key must be a legal category
 * and `other` must be present. A namespace that happened to hold a key called
 * `one` would need to hold NOTHING else and an `other` as well before it could
 * be mistaken for one, which no namespace in the tree does.
 */
export function isPluralNode(node: unknown): node is PluralNode {
  if (typeof node !== 'object' || node === null) return false
  const entries = Object.entries(node as Record<string, unknown>)
  if (entries.length === 0) return false
  if (typeof (node as Record<string, unknown>).other !== 'string') return false
  return entries.every(
    ([k, v]) => (PLURAL_CATEGORIES as readonly string[]).includes(k) && typeof v === 'string',
  )
}

/**
 * The CLDR cardinal category for `n` in this locale.
 *
 * Hand-written rather than taken from `Intl.PluralRules` on purpose. The rules
 * for the two languages this app ships are short, frozen and testable, and
 * Intl.PluralRules('ar') answers for the language in general while the strings
 * here are written against these exact boundaries — a mismatch between the rule
 * that PICKS a form and the rule the translator WROTE to is the one failure
 * mode that produces confident, wrong grammar. Non-integers fall to `other`.
 */
export function pluralCategory(locale: Locale, n: number): PluralCategory {
  if (!Number.isFinite(n)) return 'other'
  const abs = Math.abs(n)
  if (!Number.isInteger(abs)) return 'other'
  if (locale === 'ar') {
    // CLDR ar: 0 → zero, 1 → one, 2 → two, n%100 3–10 → few,
    // n%100 11–99 → many, everything else (100, 101, 200…) → other.
    if (abs === 0) return 'zero'
    if (abs === 1) return 'one'
    if (abs === 2) return 'two'
    const mod100 = abs % 100
    if (mod100 >= 3 && mod100 <= 10) return 'few'
    if (mod100 >= 11 && mod100 <= 99) return 'many'
    return 'other'
  }
  return abs === 1 ? 'one' : 'other'
}

/**
 * The form `count` selects out of an already-identified plural node.
 *
 * Shared by t() and dates.ts's s() so the two cannot disagree about which form
 * a number picks. A node with NO usable count resolves to `other` rather than
 * failing: the caller gets a readable sentence with a literal `{count}` in it,
 * which is the same failure interpolation already chose for a missing variable,
 * instead of a dot path.
 */
export function selectPlural(
  node: PluralNode,
  locale: Locale,
  count: string | number | undefined,
): string {
  if (count === undefined) return node.other
  const n = typeof count === 'number' ? count : Number(count)
  if (!Number.isFinite(n)) return node.other
  return node[pluralCategory(locale, n)] ?? node.other
}
