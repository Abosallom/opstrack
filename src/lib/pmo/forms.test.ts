// THE ONE RULE THIS WHOLE SCHEMA WAS SHAPED AROUND, pinned.
//
// 0031 makes `actual_pct`, `planned_pct`, `budget`, `achieved`, `current_value`,
// every date and every manager nullable, and its comments say why at length: "a
// project at 0% because nothing has happened and one at 0% because nobody has
// updated it are different sentences". A form is the one place that distinction
// is easy to destroy — `Number('')` is `0`, and the shape a hurried edit reaches
// for (`+form.actual || 0`) turns every cleared box into a claim nobody made.
//
// So the first block below is not a parser test. It is the assertion that an
// empty box round-trips as `null` and NOT as zero, stated once per shape it
// could go wrong in.

import { describe, expect, it } from 'vitest'
import {
  blankToNull,
  dateValue,
  doneStamp,
  jiraPatch,
  jiraValue,
  parseNumber,
  parseRequiredNumber,
  trimmed,
} from './forms'

describe('parseNumber', () => {
  it('reads an empty box as null, which is NOT zero', () => {
    // The assertion this file exists for. Both are `ok` — clearing a field is a
    // legitimate thing to do and must not be reported as a mistake — but the
    // value is null, so the PATCH carries "nobody has said" rather than a
    // measurement of nought.
    expect(parseNumber('')).toEqual({ ok: true, value: null })
    expect(parseNumber('   ')).toEqual({ ok: true, value: null })
    // Said the other way round, because `toEqual` on the object above would
    // still pass if `value` were `0` in some future refactor that also changed
    // the shape.
    expect((parseNumber('') as { value: number | null }).value).not.toBe(0)
  })

  it('reads a typed zero as zero, because somebody meant it', () => {
    // The mirror of the rule. Refusing to store a deliberate 0% would be the
    // same failure pointing the other way.
    expect(parseNumber('0')).toEqual({ ok: true, value: 0 })
  })

  it('does not answer null for a mistake', () => {
    // `parseNumber('abc')` and `parseNumber('')` must not be the same thing:
    // one is a sentence the form has to print, the other is a fact to store.
    expect(parseNumber('abc')).toEqual({ ok: false })
    expect(parseNumber('Infinity')).toEqual({ ok: false })
  })

  it('refuses rather than clamps, so a typo cannot be stored as a number', () => {
    // A silent clamp turns 1000 into 100 and the reader never learns they
    // mistyped — the percentage is then wrong and looks deliberate.
    expect(parseNumber('101', { min: 0, max: 100 })).toEqual({ ok: false })
    expect(parseNumber('-1', { min: 0, max: 100 })).toEqual({ ok: false })
    expect(parseNumber('50.5', { integer: true })).toEqual({ ok: false })
    expect(parseNumber('100', { min: 0, max: 100, integer: true })).toEqual({ ok: true, value: 100 })
  })

  it('keeps a large amount exact — this is money', () => {
    // 0031 stores budgets as `numeric(14,2)` precisely so 54,848,411 comes back
    // as 54,848,411.
    expect(parseNumber('54848411.25')).toEqual({ ok: true, value: 54848411.25 })
  })
})

describe('parseRequiredNumber', () => {
  it('refuses the blank a nullable column would accept', () => {
    // `pmo_key_results.target_value` and `pmo_revenue.year` are NOT NULL. There
    // is no "nobody has said" state for a measure a key result exists to reach.
    expect(parseRequiredNumber('')).toEqual({ ok: false })
    expect(parseRequiredNumber('0')).toEqual({ ok: true, value: 0 })
  })
})

describe('blankToNull and trimmed', () => {
  it('sends an unselected option to null rather than dropping it', () => {
    // `''` is what `<option value="">` produces. It has to become `null` — a
    // key left OFF the patch means "do not touch", which is the opposite of
    // what clearing the field said.
    expect(blankToNull('')).toBe(null)
    expect(blankToNull('  ')).toBe(null)
    expect(blankToNull(' m1 ')).toBe('m1')
  })

  it('keeps the empty string for the columns 0031 declares NOT NULL DEFAULT ""', () => {
    // `note`, `mitigation`, `period`. A three-state string/null/'' on those is
    // "a bug waiting for the first filter" — `map_nodes.vendor`'s reasoning.
    expect(trimmed('  ')).toBe('')
    expect(trimmed(' hello ')).toBe('hello')
  })
})

describe('jiraPatch', () => {
  it('moves BOTH halves when a key is set', () => {
    expect(jiraPatch(' NPH-123 ')).toEqual({ source: 'jira', external_ref: 'NPH-123' })
  })

  it('moves BOTH halves back when it is cleared', () => {
    // A row that says it is local while pointing at Jira, or one that claims to
    // mirror an issue it can no longer name, are both reachable the moment
    // these two columns are written separately.
    expect(jiraPatch('')).toEqual({ source: 'local', external_ref: null })
    expect(jiraPatch('   ')).toEqual({ source: 'local', external_ref: null })
  })

  it('shows a stored key back to the reader, and a null as an empty box', () => {
    expect(jiraValue('NPH-9')).toBe('NPH-9')
    expect(jiraValue(null)).toBe('')
  })
})

describe('dateValue', () => {
  it('passes a date column straight through, and null as empty', () => {
    expect(dateValue('2026-03-31')).toBe('2026-03-31')
    expect(dateValue(null)).toBe('')
  })
})

describe('doneStamp', () => {
  it('stamps the moment an open action is first closed', () => {
    expect(doneStamp(true, null, '2026-08-22T10:00:00.000Z')).toBe('2026-08-22T10:00:00.000Z')
  })

  it('KEEPS the original stamp when a closed action is edited again', () => {
    // The failure this exists to prevent: re-stamping `now()` on every save
    // would quietly move every closed action into the current week, and 0031
    // stores a timestamp rather than a boolean precisely so "closed this week"
    // can be asked later.
    expect(doneStamp(true, '2026-01-05T09:00:00.000Z', '2026-08-22T10:00:00.000Z')).toBe(
      '2026-01-05T09:00:00.000Z',
    )
  })

  it('reopens to null rather than to a zero time', () => {
    expect(doneStamp(false, '2026-01-05T09:00:00.000Z', '2026-08-22T10:00:00.000Z')).toBe(null)
  })
})
