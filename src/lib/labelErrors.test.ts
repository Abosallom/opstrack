// What a refusal SAYS, in both languages.
//
// The validator's own suite pins which refusal is raised; this one pins that the
// sentence an ops lead reads is made of words he has seen before. Two variables
// reach these strings and they had opposite problems: `{token}` arrived without
// the braces the owner has to type, and `{category}` arrived as the raw CLDR
// identifier — `few` — which is not a word in either of this app's languages.

import { afterEach, describe, expect, it } from 'vitest'
import { LRI } from './bidi'
import { setLocale, setOverrides, t } from './i18n'
import { overrideErrorText } from './labelErrors'
import { validateOverride } from './labelOverrides'
import type { PluralNode } from './plural'

/** Six Arabic forms, `{count}` in the three that cover a range of numbers. */
const AR_COUNT: PluralNode = {
  zero: 'لا بنود',
  one: 'بند واحد',
  two: 'بندان',
  few: '{count} بنود',
  many: '{count} بندًا',
  other: '{count} بند',
}

afterEach(() => {
  setOverrides({ en: {}, ar: {} })
  setLocale('en')
})

describe('the plural form is named, not spelled in CLDR', () => {
  it('uses the same name the field carries three lines above the input', () => {
    const bad = validateOverride('x.y.few', AR_COUNT, 'بنود كثيرة', 'ar')
    expect(bad.ok).toBe(false)
    if (bad.ok) return

    // What the validator raises: the identifier, because that is what it
    // reasons about.
    expect(bad.vars).toEqual({ category: 'few' })

    for (const locale of ['en', 'ar'] as const) {
      setLocale(locale)
      const sentence = overrideErrorText(bad.error, bad.vars)
      // The form's own name, exactly as terminology.formFew renders it.
      expect(sentence).toContain(t('terminology.formFew'))
      // And never the CLDR word in the slot the sentence fences. In Arabic that
      // was a Latin word dropped into an Arabic sentence; in English it was
      // jargon for a grammatical class. (`A few (3–10)` legitimately contains
      // the substring, which is why the fence is what is asserted.)
      expect(sentence).not.toContain(`${LRI}few`)
      expect(sentence).not.toBe(t(bad.error, bad.vars))
    }
  })

  it('names an unreachable form the same way', () => {
    // Offering an English `few` box would collect a string no reader can ever
    // be shown; the refusal has to say WHICH form it means.
    const bad = validateOverride('x.y.few', { one: '{count} item', other: '{count} items' }, '3 items', 'en')
    expect(bad.ok).toBe(false)
    if (bad.ok) return
    expect(bad.error).toBe('terminology.errUnreachableCategory')
    expect(overrideErrorText(bad.error, bad.vars)).toContain(t('terminology.formFew'))
  })

  it('follows a rename of the form name itself, like every other string', () => {
    // The screen's own labels are overridable — the spec is explicit about it —
    // so the name used in the refusal has to come through t() rather than be
    // baked in when the message is built.
    setOverrides({ en: { 'terminology.formFew': 'Three to ten' }, ar: {} })
    const bad = validateOverride('x.y.few', AR_COUNT, 'بنود كثيرة', 'ar')
    if (bad.ok) throw new Error('expected a refusal')
    expect(overrideErrorText(bad.error, bad.vars)).toContain('Three to ten')
  })
})

describe('every other variable is passed through untouched', () => {
  it('shows a placeholder with the braces the owner has to type', () => {
    const bad = validateOverride('entry.createdBy', 'Created by {name}', 'Raised by', 'en')
    if (bad.ok) throw new Error('expected a refusal')
    expect(bad.vars).toEqual({ token: '{name}' })
    const sentence = overrideErrorText(bad.error, bad.vars)
    expect(sentence).toContain('{name}')
  })

  it('renders a refusal that carries no variables at all', () => {
    const bad = validateOverride('x.y', AR_COUNT, 'بند', 'ar')
    if (bad.ok) throw new Error('expected a refusal')
    expect(bad.error).toBe('terminology.errPluralWhole')
    expect(overrideErrorText(bad.error, bad.vars)).toBe(t('terminology.errPluralWhole'))
  })

  it('leaves a `category` that is not a CLDR category alone', () => {
    // Defensive: the map is keyed by the six categories and an unknown value
    // must render as itself rather than as `undefined`.
    expect(overrideErrorText('terminology.errCountMissing', { category: 'sideways' })).toContain(
      'sideways',
    )
  })
})
