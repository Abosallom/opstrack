// The validator's own test.
//
// PURE, AND SO IS THE FIXTURE. `shipped` is a parameter, not a bundle lookup, so
// every case below states its own shipped string inline — which is both faster
// to read and immune to a reword landing in src/locales. lib/i18n.test.ts covers
// the other half, where the real bundles and the real resolution meet.
//
// The cases are chosen for what they PROTECT, not for coverage. Each one is a
// way an admin with good intentions makes the app worse: a sentence that drops
// the only fact in it, a plural key frozen into one grammatical number, an
// Arabic label that renders back to front, and a blank field that means "put it
// back" being read as "make the label empty".

import { describe, expect, it } from 'vitest'
import { FSI, LRI, PDI, isolatesBalanced, stripIsolates } from './bidi'
import {
  OVERRIDE_ERROR_KEYS,
  overrideKey,
  selectableCategories,
  validateOverride,
} from './labelOverrides'
import type { PluralNode } from './plural'

/** The shipped `entry.createdBy`, verbatim — a token the tree fences with FSI. */
const CREATED_BY = `Created by ${FSI}{name}${PDI}`

/** Shipped `admin.tracks.usageEntries`, English: two forms, `{count}` in both. */
const EN_COUNT: PluralNode = { one: '{count} entry', other: '{count} entries' }

/** The Arabic of the same key: six forms, and `{count}` absent from the three
 *  that pin a single number, because "بند واحد" is how the language says it. */
const AR_COUNT: PluralNode = {
  zero: 'لا بنود',
  one: 'بند واحد',
  two: 'بندان',
  few: '{count} بنود',
  many: '{count} بندًا',
  other: '{count} بند',
}

function ok(result: ReturnType<typeof validateOverride>): string | null {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`)
  return result.value
}

function err(result: ReturnType<typeof validateOverride>): string {
  if (result.ok) throw new Error(`expected a refusal, got ${JSON.stringify(result.value)}`)
  return result.error
}

describe('overrideKey', () => {
  it('is the plain path for a plain key and path.category for a form', () => {
    expect(overrideKey('nav.board')).toBe('nav.board')
    expect(overrideKey('zz.counted', 'few')).toBe('zz.counted.few')
  })
})

describe('selectableCategories', () => {
  it('names the two forms English distinguishes and the six Arabic does', () => {
    expect(selectableCategories('en')).toEqual(['one', 'other'])
    expect(selectableCategories('ar')).toEqual(['zero', 'one', 'two', 'few', 'many', 'other'])
  })

  it('returns the same array twice, so a render can depend on it', () => {
    expect(selectableCategories('ar')).toBe(selectableCategories('ar'))
  })
})

describe('blank means default', () => {
  // Spec rule 5, and the reason it is checked FIRST: an admin escaping a bad
  // rename must never be refused for the placeholder the bad rename dropped.
  //
  // THE INVISIBLE HALF OF THIS LIST IS THE POINT. Every case below the first
  // four is a character that `String.trim()` does NOT remove and that renders as
  // nothing at all — they are what a paste out of Word, Outlook or a web page
  // carries. Before isBlankLabel() they passed every one of this feature's four
  // emptiness tests and were STORED, so a nav label, a Save button or this
  // screen's own "Reset every change" could be reduced to a genuinely empty
  // label with no way to see what had happened.
  it.each([
    ['empty', ''],
    ['spaces', '   '],
    ['a tab and a newline', '\t\n'],
    ['nothing but an isolate', `${FSI}${PDI}`],
    ['a zero-width space', '\u200B'],
    ['a left-to-right mark', '\u200E'],
    ['a right-to-left mark', '\u200F'],
    ['an Arabic letter mark', '\u061C'],
    ['a word joiner', '\u2060'],
    ['a soft hyphen', '\u00AD'],
    ['a byte order mark', '\uFEFF'],
    ['a non-breaking space', '\u00A0'],
    ['a zero-width space between two spaces', ' \u200B '],
  ])('clears the override when the field holds %s', (_name, candidate) => {
    expect(validateOverride('entry.createdBy', CREATED_BY, candidate, 'en')).toEqual({
      ok: true,
      value: null,
    })
  })

  it('clears a plural form too, without asking about {count}', () => {
    // `board.total.few` blanked has no `{count}` in it, and refusing that would
    // trap the form in whatever was typed before.
    expect(ok(validateOverride('x.y.few', AR_COUNT, '  ', 'ar'))).toBeNull()
  })
})

describe('placeholders', () => {
  it('accepts a rewording that carries the same tokens', () => {
    const value = ok(validateOverride('entry.createdBy', CREATED_BY, 'Raised by {name}', 'en'))
    expect(stripIsolates(value ?? '')).toBe('Raised by {name}')
  })

  // NAMED WITH ITS BRACES, in every one of these cases. `{name}` is what the
  // owner has to type back into the box; `name` is a word from the sentence
  // around it, and a refusal that says "put `name` back" is an instruction to
  // type the wrong thing. errTokenUnknown makes it plainer still — it ends
  // "braces and all".
  it('refuses a dropped token and NAMES it', () => {
    const result = validateOverride('entry.createdBy', CREATED_BY, 'Raised by', 'en')
    expect(result).toEqual({
      ok: false,
      error: 'terminology.errTokenMissing',
      vars: { token: '{name}' },
    })
  })

  it('refuses an invented token and NAMES it', () => {
    // `{foo}` has no variable behind it: interpolate() leaves the braces
    // verbatim and the UI shows `{foo}` to whoever opens the screen.
    const result = validateOverride('entry.createdBy', CREATED_BY, 'By {name} of {foo}', 'en')
    expect(result).toEqual({
      ok: false,
      error: 'terminology.errTokenUnknown',
      vars: { token: '{foo}' },
    })
  })

  it('names the same token every time when two are missing', () => {
    // An error message that reshuffles between saves reads as a second problem.
    const shipped = '{alpha} then {beta}'
    for (let i = 0; i < 3; i++) {
      expect(validateOverride('k.x', shipped, 'neither', 'en')).toEqual({
        ok: false,
        error: 'terminology.errTokenMissing',
        vars: { token: '{alpha}' },
      })
    }
  })

  it('refuses a key the bundles do not carry', () => {
    expect(err(validateOverride('made.up', undefined, 'anything', 'en'))).toBe(
      'terminology.errUnknownKey',
    )
  })
})

describe('plural nodes', () => {
  it('refuses to override the whole node as one string', () => {
    // The defect lib/plural.ts exists to have removed: one grammatical number
    // frozen for every count, which in Arabic is wrong four times out of six.
    expect(err(validateOverride('zz.counted', EN_COUNT, '{count} cards', 'en'))).toBe(
      'terminology.errPluralWhole',
    )
  })

  it('refuses a key whose last segment is not a CLDR category', () => {
    // Same refusal as the bare key, and deliberately: `board.total.plural` and
    // `board.total` are both "this key names no form of the node", and there is
    // no honest way to tell them apart without being told the base key.
    expect(err(validateOverride('zz.counted.plural', EN_COUNT, '{count} cards', 'en'))).toBe(
      'terminology.errPluralWhole',
    )
  })

  it('refuses a category this language can never select', () => {
    // English reaches `one` and `other` and nothing else, so an English `few`
    // is a string no reader can be shown — the same rule localeParity.test.ts
    // applies to the shipped tree.
    expect(validateOverride('zz.counted.few', EN_COUNT, '{count} cards', 'en')).toEqual({
      ok: false,
      error: 'terminology.errUnreachableCategory',
      vars: { category: 'few' },
    })
    expect(ok(validateOverride('zz.counted.few', AR_COUNT, '{count} بطاقات', 'ar'))).toBe(
      '{count} بطاقات',
    )
  })

  it('requires {count} in a category that covers many numbers', () => {
    expect(validateOverride('x.y.many', AR_COUNT, 'بنود كثيرة', 'ar')).toEqual({
      ok: false,
      error: 'terminology.errCountMissing',
      vars: { category: 'many' },
    })
    expect(err(validateOverride('x.y.other', AR_COUNT, 'بنود', 'ar'))).toBe(
      'terminology.errCountMissing',
    )
  })

  it('lets an exact category drop {count}, because the language does', () => {
    // EXACT_CATEGORIES, imported from lib/plural.ts rather than restated here.
    expect(ok(validateOverride('x.y.one', AR_COUNT, 'عنصر واحد', 'ar'))).toBe('عنصر واحد')
    expect(ok(validateOverride('x.y.two', AR_COUNT, 'عنصران', 'ar'))).toBe('عنصران')
    expect(ok(validateOverride('x.y.zero', AR_COUNT, 'لا عناصر', 'ar'))).toBe('لا عناصر')
  })

  it('accepts a category the shipped node does not carry', () => {
    // An Arabic node that never needed `zero` and now does. selectPlural()
    // already falls back to `other` for anything absent, so adding one is a
    // real edit rather than a shape change.
    const noZero: PluralNode = { one: 'يوم واحد', few: '{count} أيام', other: '{count} يوم' }
    expect(ok(validateOverride('x.y.zero', noZero, 'لا أيام', 'ar'))).toBe('لا أيام')
  })

  it('measures every form against `other`, not against its own category', () => {
    // The rule the shipped tree is already held to: a `{column}` that survives
    // in `other` and vanishes from `one` renames the control for exactly one
    // card count.
    const node: PluralNode = { one: '{column}: one card', other: '{column}: {count} cards' }
    expect(validateOverride('x.y.one', node, 'a single card', 'en')).toEqual({
      ok: false,
      error: 'terminology.errTokenMissing',
      vars: { token: '{column}' },
    })
    expect(ok(validateOverride('x.y.one', node, '{column}: a single card', 'en'))).toBe(
      '{column}: a single card',
    )
  })

  it('treats a plain key as plain however its last segment is spelled', () => {
    // `nav.one` is a form of `nav` if `nav` is a plural node and a key in its
    // own right if it is a string. The caller has already resolved that — it
    // had to, to pass `shipped` — so a string here is never reinterpreted as a
    // form and the key stays overridable.
    expect(ok(validateOverride('zz.nav.one', 'Home', 'Start', 'en'))).toBe('Start')
    const total = 'عدد البنود: {count}'
    expect(ok(validateOverride('board.total', total, 'المجموع: {count}', 'ar'))).toBe(
      'المجموع: {count}',
    )
  })

  it('requires {count} in a plain string that carries it', () => {
    // The Arabic `board.total` is an invariant string, not a node, so `{count}`
    // is an ordinary token there and dropping it drops the number.
    expect(validateOverride('board.total', 'عدد البنود: {count}', 'المجموع', 'ar')).toEqual({
      ok: false,
      error: 'terminology.errTokenMissing',
      vars: { token: '{count}' },
    })
  })
})

describe('bidi', () => {
  it('fences a token the shipped string fences, so the owner need not type it', () => {
    const value = ok(validateOverride('entry.createdBy', CREATED_BY, 'أنشأه {name}', 'ar'))
    expect(value).toBe(`أنشأه ${FSI}{name}${PDI}`)
  })

  it('is idempotent, because the owner starts from the shipped string', () => {
    const once = ok(validateOverride('entry.createdBy', CREATED_BY, 'أنشأه {name}', 'ar')) ?? ''
    const twice = ok(validateOverride('entry.createdBy', CREATED_BY, once, 'ar'))
    expect(twice).toBe(once)
  })

  it('leaves a token the shipped string leaves bare', () => {
    // `{count}` beside Arabic already reads correctly, and fencing one detaches
    // the `٪` that belongs to it — bidi.test.ts's NUMERIC_TOKENS. A blanket
    // "Arabic gets FSI" rule would reintroduce that on every counted string.
    const value = ok(validateOverride('x.y.other', AR_COUNT, 'عدد البنود {count}', 'ar'))
    expect(value).toBe('عدد البنود {count}')
    expect(stripIsolates(value ?? '')).toBe(value)
  })

  it('copies the OPENER the shipped string used, not always FSI', () => {
    // LRI where the value's direction is a property of the string — a URL, a
    // hex colour, a product name.
    const shipped = `Open ${LRI}{url}${PDI} to continue`
    const value = ok(validateOverride('k.x', shipped, 'Go to {url}', 'en'))
    expect(value).toBe(`Go to ${LRI}{url}${PDI}`)
  })

  it('fences a token the candidate newly puts in quotes', () => {
    // `«{count}»` swaps its own guillemets even though `{count}` needed nothing
    // before — the highest-frequency case bidi.test.ts's QUOTED check names.
    const value = ok(validateOverride('x.y.other', AR_COUNT, 'البنود «{count}»', 'ar'))
    expect(value).toBe(`البنود «${FSI}{count}${PDI}»`)
  })

  it('repairs unbalanced isolates instead of refusing for an invisible reason', () => {
    // They arrive by paste, nobody types them, and "your text contains an
    // unbalanced U+2068" is not something an ops lead can act on.
    const value = ok(validateOverride('entry.createdBy', CREATED_BY, `${FSI}أنشأه {name}`, 'ar'))
    expect(isolatesBalanced(value ?? '')).toBe(true)
    expect(value).toBe(`أنشأه ${FSI}{name}${PDI}`)
  })

  it('trims the ends but keeps the inside verbatim', () => {
    expect(ok(validateOverride('nav.board', 'Board', '  Wall  chart ', 'en'))).toBe('Wall  chart')
  })

  // THE ONE LITERAL THE TOKEN PASS CANNOT SEE. A digit range is not a
  // placeholder, so mirroring the shipped string's fences leaves it bare — and
  // under dir=rtl the UBA resolves the dash between two European Numbers to the
  // paragraph direction and lays `3–10` out as `10–3`. lib/bidi.ts's
  // isolateRange() exists for exactly this and the shipped tree is held to it by
  // bidi.test.ts; an override is typed into a box with no gate behind it.
  it('fences a digit range typed into an Arabic label', () => {
    const value = ok(validateOverride('terminology.formFew', 'قليل (٣)', 'قليل (3–10)', 'ar'))
    expect(value).toBe(`قليل (${FSI}3–10${PDI})`)
    expect(isolatesBalanced(value ?? '')).toBe(true)
  })

  it('leaves the same range alone in English, where it already reads correctly', () => {
    expect(ok(validateOverride('terminology.formFew', 'A few', 'A few (3–10)', 'en'))).toBe(
      'A few (3–10)',
    )
  })

  it('does not fence a range twice, however often it is re-saved', () => {
    const once = ok(validateOverride('terminology.formFew', 'قليل', 'قليل 11 - 99', 'ar')) ?? ''
    expect(once).toBe(`قليل ${FSI}11 - 99${PDI}`)
    const twice = ok(validateOverride('terminology.formFew', 'قليل', once, 'ar'))
    expect(twice).toBe(once)
    // And the shipped string copied out of the "default" line, which carries an
    // LRI rather than an FSI, is left exactly as it is.
    const shipped = `قليل (${LRI}3–10${PDI})`
    expect(ok(validateOverride('terminology.formFew', shipped, shipped, 'ar'))).toBe(shipped)
  })
})

describe('OVERRIDE_ERROR_KEYS', () => {
  it('lists every error this module can return', () => {
    // The list exists so the locale bundles can be checked against one constant
    // instead of against a grep. If a refusal is added without an entry here,
    // the screen renders a dot path at the owner.
    const returned = new Set<string>([
      err(validateOverride('made.up', undefined, 'x', 'en')),
      err(validateOverride('zz.counted', EN_COUNT, '{count} c', 'en')),
      err(validateOverride('zz.counted.few', EN_COUNT, '{count} c', 'en')),
      err(validateOverride('entry.createdBy', CREATED_BY, 'Raised by', 'en')),
      err(validateOverride('entry.createdBy', CREATED_BY, 'By {name} {foo}', 'en')),
      err(validateOverride('x.y.many', AR_COUNT, 'كثير', 'ar')),
    ])
    expect([...returned].sort()).toEqual([...OVERRIDE_ERROR_KEYS].sort())
  })
})
