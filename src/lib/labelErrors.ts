// One refusal, in the words the owner has already been shown.
//
// WHY THIS IS NOT JUST `t(error, vars)`. lib/labelOverrides.ts is pure — it
// cannot import lib/i18n as a value without putting React and `localStorage` in
// the import graph of every pure suite in the repo — so its refusals travel as
// an i18n KEY plus variables, and whoever renders them resolves both. Two places
// do: the row editor (pages/settings/Terminology.tsx) and the import report
// (components/settings/LabelIO.tsx). They must say the same thing, so the
// resolution lives here rather than twice over there.
//
// THE ONE VARIABLE THAT IS NOT ALREADY DISPLAY TEXT is `category`. It arrives as
// the raw CLDR identifier — `few`, `many`, `other` — because that is what the
// validator reasons about and what lib/plural.ts's table is keyed by. Dropped
// into the sentence as-is it produced `صيغة ⁦few⁩ تغطّي أكثر من عدد` : an
// untranslated Latin word inside an Arabic sentence, naming the field by a word
// that appears nowhere else in the UI. Three lines above the input, the SAME
// form is called `A few (3–10)` / `قليل (⁦3–10⁩)`, and that is the name the
// refusal has to use.

import { t } from './i18n'
import { FORM_LABEL_KEYS } from './labelOverrides'
import { PLURAL_CATEGORIES, type PluralCategory } from './plural'

function isCategory(value: string): value is PluralCategory {
  return (PLURAL_CATEGORIES as readonly string[]).includes(value)
}

/**
 * Render a `validateOverride()` refusal for a reader.
 *
 * Every other variable is passed through untouched — `{token}` is already the
 * literal text the owner has to type, braces and all.
 */
export function overrideErrorText(
  error: string,
  vars?: Readonly<Record<string, string>>,
): string {
  if (vars === undefined) return t(error)
  const category = vars.category
  if (category === undefined || !isCategory(category)) return t(error, vars)
  return t(error, { ...vars, category: t(FORM_LABEL_KEYS[category]) })
}
