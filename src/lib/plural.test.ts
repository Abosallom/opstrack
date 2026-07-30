// The CLDR table's own test.
//
// lib/plural.ts is the one module in the repo whose failure mode is a
// CONFIDENT WRONG ANSWER. Everything else that goes wrong with a string renders
// a dot path, an empty span or a literal `{count}` — visible in review, visible
// in the reachability gate. Picking `many` where CLDR says `few` renders a
// fluent Arabic sentence with the wrong noun form, which nothing catches and no
// English-reading reviewer can see.
//
// localeParity.test.ts checks the DATA against this module; this file checks
// the module. The boundaries below are the CLDR cardinal rules for `ar` and
// `en` verbatim, written as the numbers either side of each edge — a rule
// written `3..10` and implemented `>= 3 && < 10` passes any test that only
// samples the middle.

import { describe, expect, it } from 'vitest'
import { EXACT_CATEGORIES, isPluralNode, pluralCategory, selectPlural } from './plural'

describe('pluralCategory (en)', () => {
  it('distinguishes exactly one from everything else', () => {
    expect(pluralCategory('en', 1)).toBe('one')
    expect(pluralCategory('en', 0)).toBe('other')
    expect(pluralCategory('en', 2)).toBe('other')
    expect(pluralCategory('en', 11)).toBe('other')
    expect(pluralCategory('en', 100)).toBe('other')
  })

  it('reaches only `one` and `other`, ever', () => {
    // The property localeParity's "no unreachable form" check leans on: an
    // English `few` is a string no reader can ever be shown.
    const seen = new Set<string>()
    for (let n = 0; n <= 1000; n++) seen.add(pluralCategory('en', n))
    expect([...seen].sort()).toEqual(['one', 'other'])
  })
})

describe('pluralCategory (ar)', () => {
  it('names the three exact categories', () => {
    expect(pluralCategory('ar', 0)).toBe('zero')
    expect(pluralCategory('ar', 1)).toBe('one')
    expect(pluralCategory('ar', 2)).toBe('two')
  })

  it('puts n%100 of 3–10 in `few`, on both edges', () => {
    expect(pluralCategory('ar', 3)).toBe('few')
    expect(pluralCategory('ar', 10)).toBe('few')
    expect(pluralCategory('ar', 103)).toBe('few')
    expect(pluralCategory('ar', 110)).toBe('few')
    expect(pluralCategory('ar', 1010)).toBe('few')
  })

  it('puts n%100 of 11–99 in `many`, on both edges', () => {
    expect(pluralCategory('ar', 11)).toBe('many')
    expect(pluralCategory('ar', 99)).toBe('many')
    expect(pluralCategory('ar', 111)).toBe('many')
    expect(pluralCategory('ar', 199)).toBe('many')
  })

  it('leaves the round hundreds and 1–2 mod 100 in `other`', () => {
    expect(pluralCategory('ar', 100)).toBe('other')
    expect(pluralCategory('ar', 101)).toBe('other')
    expect(pluralCategory('ar', 102)).toBe('other')
    expect(pluralCategory('ar', 200)).toBe('other')
  })

  it('reaches all six categories', () => {
    const seen = new Set<string>()
    for (let n = 0; n <= 1000; n++) seen.add(pluralCategory('ar', n))
    expect([...seen].sort()).toEqual(['few', 'many', 'one', 'other', 'two', 'zero'])
  })
})

describe('pluralCategory (both)', () => {
  it('reads a negative count by its magnitude', () => {
    // `formatDue` passes `-delta` for an overdue item; "متأخّر -2 يوم" would be
    // selected as `other` and read as the wrong noun form.
    expect(pluralCategory('en', -1)).toBe('one')
    expect(pluralCategory('ar', -2)).toBe('two')
    expect(pluralCategory('ar', -7)).toBe('few')
  })

  it('sends every non-integer to `other`', () => {
    expect(pluralCategory('en', 1.5)).toBe('other')
    expect(pluralCategory('ar', 2.5)).toBe('other')
    expect(pluralCategory('en', Number.NaN)).toBe('other')
    expect(pluralCategory('ar', Number.POSITIVE_INFINITY)).toBe('other')
  })

  it('agrees with EXACT_CATEGORIES about which categories pin one number', () => {
    // The parity gate exempts these from the {count} requirement, so if this
    // ever stops holding, that exemption starts hiding real dropped tokens.
    for (const locale of ['en', 'ar'] as const) {
      for (const [n, category] of [
        [0, 'zero'],
        [1, 'one'],
        [2, 'two'],
      ] as const) {
        const selected = pluralCategory(locale, n)
        if (selected === category) expect(EXACT_CATEGORIES).toContain(category)
      }
      // …and no exact category is ever selected for a number other than its own.
      for (let n = 3; n <= 500; n++) {
        expect(EXACT_CATEGORIES).not.toContain(pluralCategory(locale, n))
      }
    }
  })
})

describe('isPluralNode', () => {
  it('accepts a node whose every key is a category and which has `other`', () => {
    expect(isPluralNode({ other: 'x' })).toBe(true)
    expect(isPluralNode({ one: 'x', other: 'y' })).toBe(true)
    expect(isPluralNode({ zero: 'a', one: 'b', two: 'c', few: 'd', many: 'e', other: 'f' })).toBe(
      true,
    )
  })

  it('rejects anything that is not one', () => {
    expect(isPluralNode({ one: 'x' })).toBe(false) // no `other`
    expect(isPluralNode({ othr: 'x', other: 'y' })).toBe(false) // typo'd category
    expect(isPluralNode({ other: 1 })).toBe(false) // not a string
    expect(isPluralNode({})).toBe(false)
    expect(isPluralNode('a string')).toBe(false)
    expect(isPluralNode(null)).toBe(false)
    expect(isPluralNode(undefined)).toBe(false)
  })

  it('rejects a namespace that merely CONTAINS a category-shaped key', () => {
    // The structural test's whole risk: `{ one: …, title: … }` is a namespace,
    // not a plural node, and treating it as one would swallow `title`.
    expect(isPluralNode({ one: 'x', other: 'y', title: 'Board' })).toBe(false)
    expect(isPluralNode({ few: 'x', hint: 'y' })).toBe(false)
  })
})

describe('selectPlural', () => {
  const ar = { zero: 'z', one: '1', two: '2', few: 'f', many: 'm', other: 'o' }

  it('picks the form the locale rule names', () => {
    expect(selectPlural(ar, 'ar', 0)).toBe('z')
    expect(selectPlural(ar, 'ar', 2)).toBe('2')
    expect(selectPlural(ar, 'ar', 5)).toBe('f')
    expect(selectPlural(ar, 'ar', 20)).toBe('m')
    expect(selectPlural(ar, 'en', 1)).toBe('1')
    expect(selectPlural(ar, 'en', 5)).toBe('o')
  })

  it('falls back to `other` for a category the node does not carry', () => {
    expect(selectPlural({ one: 'x', other: 'y' }, 'ar', 7)).toBe('y')
    expect(selectPlural({ one: 'x', other: 'y' }, 'ar', 0)).toBe('y')
  })

  it('falls back to `other` when there is no usable count', () => {
    // A caller that forgot the variable gets a readable sentence with a literal
    // `{count}` in it, which is the failure interpolation already chose — not a
    // dot path, and not a crash.
    expect(selectPlural(ar, 'ar', undefined)).toBe('o')
    expect(selectPlural(ar, 'ar', 'not a number')).toBe('o')
  })

  it('reads a numeric string, because JSX hands t() strings', () => {
    expect(selectPlural(ar, 'ar', '2')).toBe('2')
    expect(selectPlural(ar, 'ar', '5')).toBe('f')
  })
})
