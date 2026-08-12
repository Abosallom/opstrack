// The one rule every label in this file shares, and the one property that makes
// it safe to have four copies of it.
//
// WHY THIS FILE EXISTS NOW. labels.ts had no suite: `name_ar.trim() || name` is
// three tokens and reads as obviously correct, which is exactly the shape of rule
// that goes wrong silently. The failure is not a crash — it is a blank chip where
// an organization's name should be, in Arabic only, on a workspace where somebody
// has not typed the translation yet. That is the ORDINARY state of `map_node_stages`
// the day 0026 applies: all seven rungs ship with `name_ar` deliberately blank,
// because those words are the programme's own vocabulary and Aziz translates them
// himself.
//
// THE HOOKS ARE NOT TESTED HERE, and that is a limit rather than an omission: this
// repo has no DOM environment and no renderer, so `useStageLabel` is covered by
// the bare function it delegates to plus tsc. What a renderer would add — that the
// hook re-subscribes on a language toggle — is the reason the hooks exist at all
// and is asserted nowhere; it is named in the handoff rather than left implied.

import { describe, expect, it } from 'vitest'
import { kindLabel, nodeLabel, stageLabel, trackLabel } from './labels'
import type { Locale } from './i18n'
import type { Track } from '../types'

/** A two-column row, which is all any of the four functions reads. */
interface Named {
  name: string
  name_ar: string
}

const LIVE: Named = { name: 'Live', name_ar: 'تشغيل' }
const UNTRANSLATED: Named = { name: 'Go-live ready', name_ar: '' }

describe('stageLabel', () => {
  it('answers the English name in English', () => {
    expect(stageLabel(LIVE, 'en')).toBe('Live')
  })

  it('answers the Arabic name in Arabic', () => {
    expect(stageLabel(LIVE, 'ar')).toBe('تشغيل')
  })

  it('falls back to the English name for an untranslated rung', () => {
    // 0026 seeds ALL SEVEN rungs with name_ar blank on purpose. Without this
    // fallback the entire ladder renders as empty chips in Arabic on the day the
    // migration lands — every picker, every portfolio column.
    expect(stageLabel(UNTRANSLATED, 'ar')).toBe('Go-live ready')
  })

  it('treats whitespace as untranslated', () => {
    // '   ' is an empty name wearing a hat. The database says so too:
    // map_node_stages_name_ar_uidx is `where btrim(name_ar) <> ''`, so a rung
    // whose Arabic name is three spaces is one the database calls untranslated.
    expect(stageLabel({ name: 'Kickoff', name_ar: '   ' }, 'ar')).toBe('Kickoff')
  })

  it('trims the Arabic name it does return', () => {
    expect(stageLabel({ name: 'Kickoff', name_ar: '  انطلاق  ' }, 'ar')).toBe('انطلاق')
  })

  it('never consults the English name when an Arabic one exists', () => {
    // The tell for a fallback written the other way round (`name || name_ar`),
    // which passes every test above and is wrong for every translated row.
    expect(stageLabel({ name: '', name_ar: 'تشغيل' }, 'ar')).toBe('تشغيل')
  })
})

describe('the four labels agree on the rule', () => {
  // FOUR COPIES OF ONE RULE IS THE DESIGN — each takes a different row type, so
  // there is no shared function to call — and this table is what keeps the copies
  // honest. A fifth label that tested `name_ar !== null` instead of EMPTY would
  // pass its own tests and fail here.
  const labels: ReadonlyArray<[string, (row: Named, locale: Locale) => string]> = [
    // trackLabel is the one that takes a WHOLE row rather than a Pick, so its
    // fixture is cast: the other columns are irrelevant to the rule and inventing
    // a colour and a sort order here would suggest they were not.
    ['trackLabel', (row, locale) => trackLabel(row as unknown as Track, locale)],
    ['nodeLabel', nodeLabel],
    ['kindLabel', kindLabel],
    ['stageLabel', stageLabel],
  ]

  it.each(labels)('%s: English locale takes the English name', (_name, label) => {
    expect(label(LIVE, 'en')).toBe('Live')
  })

  it.each(labels)('%s: Arabic locale takes the Arabic name', (_name, label) => {
    expect(label(LIVE, 'ar')).toBe('تشغيل')
  })

  it.each(labels)('%s: an EMPTY Arabic name falls back, it does not blank', (_name, label) => {
    expect(label(UNTRANSLATED, 'ar')).toBe('Go-live ready')
  })

  it.each(labels)('%s: the English name is never the Arabic one', (_name, label) => {
    // The English side has no fallback and must not grow one: an English name is
    // `not null` on every one of these tables, so an empty one is a row somebody
    // should fix, not a row to paper over with Arabic in an LTR layout.
    expect(label({ name: '', name_ar: 'تشغيل' }, 'en')).toBe('')
  })
})
