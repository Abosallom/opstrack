// The override layer's test: what t() answers once an admin has renamed things.
//
// THE FIRST SUITE THAT VALUE-IMPORTS lib/i18n.ts. Every other test in the repo
// takes `Locale` from it as an `import type`, which is erased — so this file is
// the first thing to load the module under vitest's `node` environment, where
// there is no `localStorage` and no `document`. That is why readStored() and
// applyLocale() are guarded; store/vocab.ts's readCache() carries the same guard
// for the same reason.
//
// THE SHIPPED STRINGS ARE READ, NEVER TYPED. Every assertion compares against
// shippedNode(), so a reword landing in src/locales/** cannot turn this suite
// red for a reason that has nothing to do with overrides. The three fixture keys
// are asserted to still have the SHAPE the cases need, because a suite that
// silently stopped testing plurals would be worse than one that failed.

import { afterEach, describe, expect, it } from 'vitest'
import {
  getLabelRevision,
  setLocale,
  setOverrides,
  shippedNode,
  subscribeLocale,
  t,
  type Locale,
} from './i18n'
import { validateOverride } from './labelOverrides'
import { isPluralNode, type PluralNode } from './plural'
import type { LabelOverrideMap } from '../types'

/** A plain string in both trees. */
const PLAIN = 'nav.map'
/** A string carrying one fenced placeholder in both trees. */
const TOKEN = 'entry.createdBy'
/** A plural node in both trees — two forms in English, six in Arabic. */
const COUNTED = 'admin.tracks.usageEntries'
/** A plural node in ENGLISH and an invariant string in Arabic. */
const SPLIT_SHAPE = 'board.total'
/** An Arabic node with no `zero` form: 0 falls back to `other` until one is added. */
const NO_ZERO = 'admin.tracks.slaEffectiveOwn'

function str(key: string, locale: Locale): string {
  const node = shippedNode(key, locale)
  if (typeof node !== 'string') throw new Error(`${key} is not a plain string in ${locale}`)
  return node
}

function node(key: string, locale: Locale): PluralNode {
  const found = shippedNode(key, locale)
  if (typeof found !== 'object') throw new Error(`${key} is not a plural node in ${locale}`)
  return found
}

/**
 * The map store/labels.ts's buildMap() projects its rows into, written here as
 * one `key → string` record per language because that is how the cases read.
 */
function overrides(
  en: Record<string, string> = {},
  ar: Record<string, string> = {},
): LabelOverrideMap {
  return { en, ar }
}

/**
 * Back to the shipped strings, through the SAME door store/labels.ts uses.
 *
 * There is deliberately no clearOverrides() to call — see the note in i18n.ts:
 * a second way to empty this layer is a second writer, and the store's optimistic
 * rollback depends on being the only one.
 */
function noOverrides(): void {
  setOverrides(overrides())
}

afterEach(() => {
  noOverrides()
  setLocale('en')
})

describe('the fixtures still have the shapes these cases need', () => {
  // Without this, a reword that turned COUNTED into a plain string would leave
  // every plural assertion below passing and testing nothing.
  it('are plain, tokened, plural and shape-split as named', () => {
    expect(typeof shippedNode(PLAIN, 'en')).toBe('string')
    expect(typeof shippedNode(PLAIN, 'ar')).toBe('string')
    expect(str(TOKEN, 'en')).toContain('{name}')
    expect(str(TOKEN, 'ar')).toContain('{name}')
    expect(isPluralNode(shippedNode(COUNTED, 'en'))).toBe(true)
    expect(isPluralNode(shippedNode(COUNTED, 'ar'))).toBe(true)
    expect(isPluralNode(shippedNode(SPLIT_SHAPE, 'en'))).toBe(true)
    expect(typeof shippedNode(SPLIT_SHAPE, 'ar')).toBe('string')
    expect(node(NO_ZERO, 'ar').zero).toBeUndefined()
  })
})

describe('resolution order', () => {
  it('renders the shipped string when nothing is overridden', () => {
    expect(t(PLAIN)).toBe(str(PLAIN, 'en'))
    setLocale('ar')
    expect(t(PLAIN)).toBe(str(PLAIN, 'ar'))
  })

  it('prefers the override to the shipped string', () => {
    setOverrides(overrides({ [PLAIN]: 'Wall' }))
    expect(t(PLAIN)).toBe('Wall')
  })

  it('falls back to the key when nothing carries it', () => {
    expect(t('no.such.key')).toBe('no.such.key')
  })

  it('applies an ar-only override to Arabic and leaves English alone', () => {
    // The partial case, and the one that matters most: `en` and `ar` are both
    // nullable because rewording one language only is a real request.
    setOverrides(overrides({}, { [PLAIN]: 'الحائط' }))
    expect(t(PLAIN)).toBe(str(PLAIN, 'en'))
    setLocale('ar')
    expect(t(PLAIN)).toBe('الحائط')
  })

  it('applies an en-only override to English and leaves Arabic alone', () => {
    // The mirror, and the rule store/vocab.ts's header calls the one that
    // bites: an English rename must NEVER become the Arabic label. Falling back
    // to the English override here would switch half a screen's language.
    setOverrides(overrides({ [PLAIN]: 'Wall' }))
    setLocale('ar')
    expect(t(PLAIN)).toBe(str(PLAIN, 'ar'))
  })

  it('carries the English OVERRIDE into the English fallback', () => {
    // A key the ar tree does not carry falls through to English — and it should
    // land on what the workspace calls the thing, not on the name it shipped
    // with and has since been renamed away from.
    setOverrides(overrides({ 'absent.from.both.trees': 'Renamed' }))
    setLocale('ar')
    expect(t('absent.from.both.trees')).toBe('Renamed')
  })

  it('never renders an empty label for a blank override', () => {
    // Spec rule 5, at the last line of defence: store/labels.ts drops blanks on
    // the way in and lib/labelOverrides.ts refuses to produce one, and a row
    // hand-edited into the table still cannot blank a nav label.
    //
    // THE LIST IS MOSTLY INVISIBLE CHARACTERS, and that is the part that was
    // broken: none of them is whitespace, so `String.trim()` keeps every one and
    // this backstop used to hand them straight to the reader as a label with
    // nothing in it. They are what a paste out of Word or Outlook carries — and
    // the same override applied to `terminology.resetAll` would have emptied the
    // escape hatch's own button.
    const blanks = [
      '',
      '   ',
      '\t\n',
      '\u200B',
      '\u200E',
      '\u200F',
      '\u061C',
      '\u2060',
      '\u00AD',
      '\uFEFF',
      '\u2068\u2069',
    ]
    for (const blank of blanks) {
      setOverrides(overrides({ [PLAIN]: blank }))
      expect(t(PLAIN)).toBe(str(PLAIN, 'en'))
      // The screen's own escape hatch is a label like any other — deliberately,
      // per the spec — so it has to survive the same paste.
      setOverrides(overrides({ 'terminology.resetAll': blank }))
      expect(t('terminology.resetAll')).toBe(str('terminology.resetAll', 'en'))
    }
  })

  it('interpolates through an override', () => {
    setOverrides(overrides({ [TOKEN]: 'Raised by {name}' }))
    expect(t(TOKEN, { name: 'Aziz' })).toBe('Raised by Aziz')
  })
})

describe('plural forms', () => {
  it('overrides one form and leaves the others shipped', () => {
    setOverrides(overrides({ [`${COUNTED}.other`]: '{count} actions' }))
    expect(t(COUNTED, { count: 5 })).toBe('5 actions')
    expect(t(COUNTED, { count: 1 })).toBe(node(COUNTED, 'en').one?.replace('{count}', '1'))
  })

  it('selects the overridden Arabic form the CLDR rule names', () => {
    setLocale('ar')
    setOverrides(overrides({}, { [`${COUNTED}.few`]: '{count} إجراءات' }))
    expect(t(COUNTED, { count: 5 })).toBe('5 إجراءات')
    // 2 is `two`, which was not overridden, so it stays shipped.
    expect(t(COUNTED, { count: 2 })).toBe(node(COUNTED, 'ar').two)
  })

  it('adds a form the shipped node does not carry', () => {
    // An Arabic node that never needed `zero` and now does. Before the
    // override, 0 falls back to `other`.
    setLocale('ar')
    const fallback = node(NO_ZERO, 'ar').other.replace('{count}', '0')
    expect(t(NO_ZERO, { count: 0 })).toBe(fallback)
    setOverrides(overrides({}, { [`${NO_ZERO}.zero`]: 'هذا المسار: بلا مهلة' }))
    expect(t(NO_ZERO, { count: 0 })).toBe('هذا المسار: بلا مهلة')
  })

  it('ignores a bare-key override on a plural key', () => {
    // Storing one string against the base key would freeze one grammatical
    // number for every count — wrong four times out of six in Arabic.
    // lib/labelOverrides.ts refuses to produce such a row; this is the other
    // half of that guarantee, for a row hand-edited into the table.
    setOverrides(overrides({ [COUNTED]: 'Frozen' }))
    expect(t(COUNTED, { count: 5 })).not.toBe('Frozen')
    expect(t(COUNTED, { count: 1 })).not.toBe('Frozen')
  })

  it('reads a shape-split key by the shape THAT locale ships', () => {
    // `board.total` is `{one, other}` in English and an invariant string in
    // Arabic. The English override is per form; the Arabic one is whole.
    setOverrides(
      overrides(
        { [`${SPLIT_SHAPE}.other`]: '{count} cards' },
        { [SPLIT_SHAPE]: 'البطاقات: {count}' },
      ),
    )
    expect(t(SPLIT_SHAPE, { count: 7 })).toBe('7 cards')
    setLocale('ar')
    expect(t(SPLIT_SHAPE, { count: 7 })).toBe('البطاقات: 7')
  })
})

describe('clearing', () => {
  it('restores the shipped string', () => {
    setOverrides(overrides({ [PLAIN]: 'Wall' }, { [PLAIN]: 'الحائط' }))
    expect(t(PLAIN)).toBe('Wall')
    noOverrides()
    expect(t(PLAIN)).toBe(str(PLAIN, 'en'))
    setLocale('ar')
    expect(t(PLAIN)).toBe(str(PLAIN, 'ar'))
  })

  it('restores an overridden plural form too', () => {
    setOverrides(overrides({ [`${COUNTED}.other`]: '{count} actions' }))
    expect(t(COUNTED, { count: 5 })).toBe('5 actions')
    noOverrides()
    expect(t(COUNTED, { count: 5 })).toBe(node(COUNTED, 'en').other.replace('{count}', '5'))
  })
})

describe('notification', () => {
  // useLocale() is useSyncExternalStore(subscribeLocale, getLabelRevision).
  // BOTH halves have to move: a listener that fires while the snapshot compares
  // equal re-renders nothing, and every label in the app would keep its old
  // wording until something else happened to re-render it.
  it('fires the listeners and moves the snapshot when overrides are installed', () => {
    let fired = 0
    const before = getLabelRevision()
    const unsubscribe = subscribeLocale(() => {
      fired += 1
    })
    setOverrides(overrides({ [PLAIN]: 'Wall' }))
    unsubscribe()
    expect(fired).toBe(1)
    expect(getLabelRevision()).not.toBe(before)
  })

  it('fires on clear, and on a language switch, through the same listener set', () => {
    setOverrides(overrides({ [PLAIN]: 'Wall' }))
    let fired = 0
    const unsubscribe = subscribeLocale(() => {
      fired += 1
    })
    noOverrides()
    setLocale('ar')
    unsubscribe()
    expect(fired).toBe(2)
  })

  it('stops firing once unsubscribed', () => {
    let fired = 0
    subscribeLocale(() => {
      fired += 1
    })()
    setOverrides(overrides({ [PLAIN]: 'Wall' }))
    expect(fired).toBe(0)
  })

  // INSTALLING A LAYER ALWAYS MOVES THE SNAPSHOT, even when the map that lands
  // is empty or identical to the one before it. There used to be a
  // clearOverrides() that skipped the notify when the layer was already empty,
  // and skipping is the wrong instinct here: store/labels.ts is the only writer
  // and it rebuilds the map from its rows on every apply, including on a
  // ROLLBACK — where the map really can be equal to the one two calls ago, and
  // where a suppressed re-render would leave the app showing the wording of a
  // save that was refused.
  it('bumps the snapshot even for an empty or unchanged map', () => {
    setOverrides(overrides({ [PLAIN]: 'Wall' }))
    const afterInstall = getLabelRevision()
    noOverrides()
    expect(getLabelRevision()).not.toBe(afterInstall)
    const afterClear = getLabelRevision()
    noOverrides()
    expect(getLabelRevision()).not.toBe(afterClear)
  })
})

describe('a refused override never reaches a reader', () => {
  it('leaves the shipped string in place when the save path rejects it', () => {
    // The whole pipeline in one case: the screen validates, stores only on
    // `ok`, and a dropped `{name}` therefore never becomes a label that has
    // quietly deleted the only fact in its sentence.
    const shipped = shippedNode(TOKEN, 'en')
    const result = validateOverride(TOKEN, shipped, 'Created by', 'en')
    expect(result).toEqual({
      ok: false,
      error: 'terminology.errTokenMissing',
      vars: { token: '{name}' },
    })
    if (result.ok && result.value !== null) setOverrides(overrides({ [TOKEN]: result.value }))
    expect(t(TOKEN, { name: 'Aziz' })).toBe(str(TOKEN, 'en').replace('{name}', 'Aziz'))
  })

  it('stores the accepted one, fences and all', () => {
    const result = validateOverride(TOKEN, shippedNode(TOKEN, 'ar'), 'سجّله {name}', 'ar')
    expect(result.ok).toBe(true)
    if (!result.ok || result.value === null) throw new Error('expected a value')
    setOverrides(overrides({}, { [TOKEN]: result.value }))
    setLocale('ar')
    // The isolate the shipped string carries around {name} survives into the
    // rendered label — it is what keeps a Latin name from reordering the
    // sentence around it.
    expect(t(TOKEN, { name: 'Aziz' })).toBe('سجّله ⁨Aziz⁩')
  })
})

describe('shippedNode', () => {
  it('answers with the shipped value, overrides installed or not', () => {
    setOverrides(overrides({ [PLAIN]: 'Wall' }))
    expect(shippedNode(PLAIN, 'en')).toBe(str(PLAIN, 'en'))
  })

  it('is undefined for a key no bundle carries', () => {
    expect(shippedNode('no.such.key', 'en')).toBeUndefined()
  })

})
