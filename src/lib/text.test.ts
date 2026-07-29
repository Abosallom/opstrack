// text.ts is the one Wave-1 keystone module that ships COMPLETE rather than as
// a skeleton, so it is the one that needs its own tests today — the parser and
// the entry filter are built on top of it a wave-hour later and inherit every
// bug in it silently.
//
// Fixtures use the REAL seed values from supabase/migrations/0001_opstrack_core.sql
// (the Network track's Arabic name is the plural). The previous design's fixture
// list used the singular, so its tests agreed with its implementation and both
// were wrong — that is the failure this file is written against.

import { describe, expect, it } from 'vitest'
import {
  escapeHtml,
  foldArabic,
  foldDigits,
  foldKey,
  initials,
  isSubsequence,
  normalizeSearch,
  stemArabic,
  truncate,
} from './text'

/** As seeded by 0001, byte-for-byte. */
const NETWORK_AR = 'الشبكات'
const IT_OPS_AR = 'عمليات تقنية المعلومات'

describe('foldArabic', () => {
  it('strips harakat without touching the letters', () => {
    expect(foldArabic('الشَّبَكَات')).toBe(NETWORK_AR)
  })

  it('strips tatweel', () => {
    expect(foldArabic('الشبــكات')).toBe(NETWORK_AR)
  })

  it('folds the alef family to a bare alef', () => {
    expect(foldArabic('أحمد')).toBe('احمد')
    expect(foldArabic('إدارة')).toBe('اداره')
    expect(foldArabic('آلي')).toBe('الي')
  })

  it('folds taa-marbuta, alef-maqsura and the hamza carriers', () => {
    expect(foldArabic('شبكة')).toBe('شبكه')
    expect(foldArabic('على')).toBe('علي')
    expect(foldArabic('مسؤول')).toBe('مسوول') // hamza-on-waw carrier folds to a bare waw
    expect(foldArabic('مسائل')).toBe('مسايل')
  })

  it('NEVER eats Arabic-Indic digits — the character-range trap this module documents', () => {
    // U+0660–U+0669 sit between the harakat and the superscript alef. A marks
    // class written as a single glyph range swallows them and every Arabic
    // numeral in the app silently disappears.
    expect(foldArabic('٣ أيام')).toBe('٣ ايام')
    expect(foldArabic('٠١٢٣٤٥٦٧٨٩')).toBe('٠١٢٣٤٥٦٧٨٩')
  })

  it('leaves Latin text alone', () => {
    expect(foldArabic('IT Operations')).toBe('IT Operations')
  })
})

describe('foldDigits', () => {
  it('converts Arabic-Indic digits', () => {
    expect(foldDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789')
  })

  it('converts Eastern Arabic / Persian digits', () => {
    expect(foldDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789')
  })

  it('handles a real capture token', () => {
    expect(foldDigits('due:+٣d')).toBe('due:+3d')
  })

  it('leaves Latin digits and everything else alone', () => {
    expect(foldDigits('2026-08-14 #network')).toBe('2026-08-14 #network')
  })
})

describe('stemArabic', () => {
  it('collapses the seeded plural and the singular users type onto one stem', () => {
    // The whole reason this function exists. Both sides go through foldArabic
    // first, exactly as matchTrack() will.
    const seeded = stemArabic(foldArabic(NETWORK_AR)) // plural, from 0001
    const typed = stemArabic(foldArabic('الشبكة')) // singular, from a keyboard
    expect(seeded).toBe(typed)
    expect(seeded).toBe('الشبك')
  })

  it('strips only ONE suffix', () => {
    expect(stemArabic('المعلومات')).toBe('المعلوم')
  })

  it('prefers the longer suffix', () => {
    expect(stemArabic('مسؤولون')).toBe('مسؤول')
  })

  it('refuses to stem a short word into nothing', () => {
    expect(stemArabic('شبكة')).toBe('شبكة') // 4 chars — under the floor
    expect(stemArabic('ماه')).toBe('ماه')
  })

  it('leaves words with no matching suffix untouched', () => {
    expect(stemArabic('البنية')).toBe('البنية')
    expect(stemArabic('Network')).toBe('Network')
  })
})

describe('normalizeSearch', () => {
  it('lowercases, folds and collapses whitespace', () => {
    expect(normalizeSearch('  IT   Operations  ')).toBe('it operations')
  })

  it('keeps word boundaries so prose search cannot glue words together', () => {
    expect(normalizeSearch('net work')).toBe('net work')
  })

  it('folds Arabic and digits together', () => {
    expect(normalizeSearch('تَرقية ٣ سويتشات')).toBe('ترقيه 3 سويتشات')
  })
})

describe('foldKey', () => {
  it('erases the separators users type inconsistently', () => {
    expect(foldKey('it-ops')).toBe('itops')
    expect(foldKey('it_ops')).toBe('itops')
    expect(foldKey('ITOPS')).toBe('itops')
  })

  it('still keeps spaces, so a two-word name folds to a two-word key', () => {
    expect(foldKey(IT_OPS_AR)).toBe('عمليات تقنيه المعلومات')
  })
})

describe('isSubsequence', () => {
  it('matches the parser third tier', () => {
    expect(isSubsequence('itops', foldKey('IT Operations'))).toBe(true)
  })

  it('respects order', () => {
    expect(isSubsequence('spoti', 'it operations')).toBe(false)
  })

  it('is true for the empty needle and false for an over-long one', () => {
    expect(isSubsequence('', 'anything')).toBe(true)
    expect(isSubsequence('abc', 'ab')).toBe(false)
  })
})

describe('initials', () => {
  it('takes the first letter of the first two words', () => {
    expect(initials('Ahmed Al-Otaibi')).toBe('AA')
    expect(initials('Sara')).toBe('S')
  })

  it('keeps the hamza on an Arabic initial rather than folding it away', () => {
    expect(initials('أحمد العتيبي')).toBe('أا')
  })

  it('survives extra whitespace and an empty name', () => {
    expect(initials('   Ali   Hassan  ')).toBe('AH')
    expect(initials('   ')).toBe('')
  })
})

describe('escapeHtml', () => {
  it('escapes every character that could break out of an email body', () => {
    expect(escapeHtml('<b>"A" & \'B\'</b>')).toBe(
      '&lt;b&gt;&quot;A&quot; &amp; &#39;B&#39;&lt;/b&gt;',
    )
  })

  it('escapes the ampersand first, so entities are not double-escaped', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;')
  })
})

describe('truncate', () => {
  it('leaves a short string alone', () => {
    expect(truncate('short', 10)).toBe('short')
    expect(truncate('exactly10!', 10)).toBe('exactly10!')
  })

  it('counts the ellipsis inside the budget', () => {
    expect(truncate('abcdefghij', 5)).toBe('abcd…')
    expect([...truncate('abcdefghij', 5)]).toHaveLength(5)
  })

  it('never splits a surrogate pair', () => {
    const emoji = '🚨🚨🚨🚨'
    expect(truncate(emoji, 3)).toBe('🚨🚨…')
  })

  it('returns empty for a non-positive budget', () => {
    expect(truncate('anything', 0)).toBe('')
    expect(truncate('anything', -1)).toBe('')
  })
})
