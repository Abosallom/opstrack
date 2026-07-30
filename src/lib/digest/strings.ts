// `digest.*` lookup against an EXPLICITLY REQUESTED locale.
//
// WHY THIS EXISTS RATHER THAN t(). `t()` resolves against the GLOBAL current
// locale, and this feature's defining requirement is that an Arabic digest can
// be produced while the UI is in English (plan §2.16; Wave-3 gate d). A builder
// built on t() would silently ignore its own `locale` argument, and the failure
// would be invisible in every test written by someone whose UI was already in
// the locale they were testing.
//
// WHY IT IS A COPY OF lib/dates.ts's PRIVATE `s()`. That function is exactly
// this, thirty lines up the layer, and it is private for a reason: exporting it
// would widen the contract of a keystone-owned module that the whole repo
// depends on, and `dates.ts` is scoped to `date.*` in a way its callers rely on.
// Twenty lines of lookup duplicated with the reason written down beats an
// import that makes two modules share a surface neither wanted. The DEDUPE is
// recorded as an extension slot in this worker's handoff: if the integrator
// exports `s()` from lib/dates.ts, this file becomes a one-line re-export.
//
// THE IMPORT GRAPH IS JSON ONLY. `../../locales` imports nothing but its own
// JSON files, `../plural` imports nothing at runtime, and `Locale` comes in as a
// TYPE (erased under verbatimModuleSyntax) — so nothing here drags React or
// localStorage into a pure module's graph. Same arrangement lib/dates.ts uses,
// and for the same reason.

import { ar, en } from '../../locales'
import arDigest from '../../locales/ar/digest.json'
import enDigest from '../../locales/en/digest.json'
import { isPluralNode, selectPlural } from '../plural'
import type { LocaleTree } from '../../locales'
import type { Locale } from '../i18n'

/**
 * The merged bundle, with the `digest` namespace spread over it explicitly.
 *
 * WHY THE SPREAD. `src/locales/index.ts` is integrator-only after Wave 1
 * (§1.0.2), so this worker ships `{en,ar}/digest.json` and hands the integrator
 * two imports. Until those land, `en`/`ar` do not contain a `digest` root and
 * every string in this feature would resolve to its own dot path — including in
 * the tests, which would then be asserting about dot paths and passing.
 *
 * Once the integrator registers the namespace this spread becomes a NO-OP: it
 * is the same object under the same root key, so the merge is idempotent and
 * nothing changes. It is deliberately not a workaround with a lifetime — the
 * line is safe to leave and safe to delete, and the handoff records both.
 *
 * It does NOT make the SCREEN work before registration: `Digest.tsx` calls
 * `t()` like every other page, and `t()` reads `lib/i18n`'s bundles. The
 * registration is a required integration step, not an optional one.
 */
const BUNDLES: Record<Locale, LocaleTree> = {
  en: { ...en, ...enDigest },
  ar: { ...ar, ...arDigest },
}

/**
 * Resolve one key in one locale, with `{token}` interpolation and CLDR plural
 * selection on `{count}`.
 *
 * Fallback order mirrors `t()` exactly — Arabic falls back to the English
 * string, an unknown key falls back to the key itself — so a missing digest
 * translation reads the same way a missing UI string does, and shows up in
 * review as a visible dot path rather than as blank space in a report someone
 * has already sent.
 *
 * The English fallback is selected with ENGLISH plural rules: the form being
 * read is an English sentence, so asking it for Arabic's `few` asks a bundle a
 * question it was never written to answer.
 */
export function ds(
  locale: Locale,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const raw = lookup(BUNDLES[locale], key, locale, vars) ?? lookup(BUNDLES.en, key, 'en', vars) ?? key
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
