// The isolate rule, both directions.
//
// The failure being defended against is not a crash — it is a line that renders
// in the wrong ORDER and still reads as a plausible sentence. That can only be
// caught by asserting on the characters, which is what this file does.

import { describe, expect, it } from 'vitest'
import { FSI, PDI, hasLtr, hasRtl, isolate, needsIsolate, stripIsolates } from './bidi'

describe('direction detection', () => {
  it('sees Arabic as strong RTL and Latin as strong LTR', () => {
    expect(hasRtl('الشبكات')).toBe(true)
    expect(hasLtr('الشبكات')).toBe(false)
    expect(hasLtr('Network')).toBe(true)
    expect(hasRtl('Network')).toBe(false)
  })

  it('sees a date, a version and a ticket number as neither', () => {
    for (const neutral of ['2026-08-14', '14/08/2026', '1.2.3', '#4412', '—']) {
      expect(hasRtl(neutral), neutral).toBe(false)
      expect(hasLtr(neutral), neutral).toBe(false)
    }
  })

  it('sees a mixed value as both', () => {
    expect(hasRtl('ترقية switch')).toBe(true)
    expect(hasLtr('ترقية switch')).toBe(true)
  })

  it('does NOT count Arabic punctuation or Arabic-Indic digits as strong', () => {
    // `Intl` puts an Arabic comma in the Arabic timestamp. Treating U+060C as
    // strong RTL would make `29/07/2026، 12:00` skip the isolate that the
    // visually identical range label beside it gets — see RTL_STRONG's note.
    expect(hasRtl('29/07/2026، 12:00')).toBe(false)
    expect(needsIsolate('29/07/2026، 12:00', 'rtl')).toBe(true)
    for (const punctuation of ['،', '؛', '؟', '٪']) {
      expect(hasRtl(punctuation), punctuation).toBe(false)
    }
  })
})

describe('needsIsolate', () => {
  it('leaves pure Latin alone in an LTR digest — the §4.7 sample stays byte-clean', () => {
    expect(needsIsolate('Firewall rule DC2', 'ltr')).toBe(false)
    expect(needsIsolate('14/08/2026', 'ltr')).toBe(false)
  })

  it('wraps Arabic inside an LTR digest', () => {
    expect(needsIsolate('ترقية المحوّل', 'ltr')).toBe(true)
  })

  it('wraps Latin, digits and mixed text inside an RTL digest', () => {
    expect(needsIsolate('Ahmed', 'rtl')).toBe(true)
    expect(needsIsolate('2026-08-14', 'rtl')).toBe(true)
    expect(needsIsolate('ترقية switch', 'rtl')).toBe(true)
  })

  it('leaves pure Arabic alone in an RTL digest', () => {
    expect(needsIsolate('الشبكات', 'rtl')).toBe(false)
  })

  it('never wraps the empty string — an isolate around nothing is two dead bytes', () => {
    expect(needsIsolate('', 'rtl')).toBe(false)
    expect(isolate('', 'rtl')).toBe('')
  })
})

describe('isolate', () => {
  it('wraps with FSI…PDI, not with LRM/RLM marks', () => {
    expect(isolate('Ahmed', 'rtl')).toBe(`${FSI}Ahmed${PDI}`)
    expect(FSI).toBe('⁨')
    expect(PDI).toBe('⁩')
  })

  it('round-trips through stripIsolates', () => {
    const value = 'Core switch firmware upgrade'
    expect(stripIsolates(isolate(value, 'rtl'))).toBe(value)
    expect(stripIsolates(isolate(value, 'ltr'))).toBe(value)
  })

  it('strips LRI and RLI too, so a hand-written locale string can be compared', () => {
    expect(stripIsolates('⁦Teams⁩')).toBe('Teams')
  })
})
