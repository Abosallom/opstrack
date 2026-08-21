// The wording pass as a file, both directions.
//
// WHAT THIS SUITE IS FOR. `src/lib/labelIO.ts` is the only place in the feature
// where a set of labels arrives from OUTSIDE the app — a file on a disk, edited
// in an editor by hand, possibly written for a different build of this product
// and possibly not written by a friend. Everywhere else the validator is fed by
// a text box the owner is looking at; here it is fed by whatever was in the
// file. So the checks below are less about the happy path than about the
// promise attached to it: NOTHING PARTIALLY APPLIES, and nothing unrecognised
// is ever written.
//
// TWO KINDS OF LOOKUP, deliberately. Most cases run against a FIXTURE bundle
// (`lookup` below) so that a case says what it is about — a dropped `{name}`, a
// plural node with the wrong form — and does not break the day somebody rewords
// `nav.map`. The last block runs against the REAL `shippedNode` from
// lib/i18n.ts, because the fixture cannot prove the one thing that matters most
// at the seam: that the function the component actually passes in has the shape
// this module expects, over the bundles the app actually ships.

import { describe, expect, it } from 'vitest'
import {
  LABEL_FILE_FORMAT,
  LABEL_FILE_MAX_BYTES,
  LABEL_FILE_VERSION,
  buildLabelFile,
  labelFileMimeType,
  labelFileName,
  planLabelImport,
  serializeLabelFile,
  type LabelPair,
  type ShippedLookup,
} from './labelIO'
import { overrideKey } from './labelOverrides'
import { shippedNode } from './i18n'
import { FSI, PDI } from './bidi'
import type { PluralNode } from './plural'

/* ───────────────────────────────── fixtures ─────────────────────────────── */

/**
 * A miniature bundle with one of each thing that can go wrong.
 *
 * `board.total` is the divergence lib/plural.ts's header describes and this
 * module has to survive: a plural node in English, an invariant string in
 * Arabic. `entry.createdBy` carries a FENCED token, so a candidate that arrives
 * bare must come back fenced — the proof that the plan does not bypass
 * lib/labelOverrides.ts on its way through.
 */
const EN: Record<string, string | PluralNode> = {
  'nav.map': 'Map',
  'entry.createdBy': `Created by ${FSI}{name}${PDI}`,
  'board.total': { one: '{count} item', other: '{count} items' },
}

const AR: Record<string, string | PluralNode> = {
  'nav.map': 'الخريطة',
  'entry.createdBy': `أنشأه ${FSI}{name}${PDI}`,
  'board.total': 'عدد البنود: {count}',
}

const lookup: ShippedLookup = (key, locale) => (locale === 'en' ? EN[key] : AR[key])

/**
 * The row keys for one plural node's forms, BUILT rather than spelled out.
 *
 * `overrideKey()` is the one place the `key.category` format is written
 * (lib/labelOverrides.ts), so a test that spelled a form path out by hand
 * would be asserting against a format it had just re-implemented — and would
 * still pass on the day the two disagreed, which is the failure that format
 * exists to prevent. It also keeps this file honest with
 * src/lib/localeReach.test.ts, which flattens a plural node as ONE key: a
 * quoted form path is key-shaped and resolves to nothing.
 */
const TOTAL = 'board.total'
const TOTAL_ONE = overrideKey(TOTAL, 'one')
const TOTAL_OTHER = overrideKey(TOTAL, 'other')
const TOTAL_FEW = overrideKey(TOTAL, 'few')

/**
 * A key no build of this app has ever had.
 *
 * Under a namespace that does not exist, deliberately: `nav.gone` would be
 * key-shaped under a REAL root and localeReach.test.ts would report it as a
 * string the app asks for and cannot resolve — which is exactly the defect that
 * gate is for, and exactly not what this fixture is.
 */
const RETIRED = 'retired.badge'

/** One form of a REAL plural node, for the block that runs on the real bundles. */
const CHANGED_ONE = overrideKey('terminology.changedCount', 'one')

const META = { exportedAt: '2026-07-31T18:22:04.123Z', appVersion: '1.0.1' }

/** A file body from a `key → {en, ar}` map, the way the app writes one. */
function fileOf(labels: Record<string, unknown>): string {
  return JSON.stringify({
    format: LABEL_FILE_FORMAT,
    version: LABEL_FILE_VERSION,
    ...META,
    locales: ['en', 'ar'],
    count: Object.keys(labels).length,
    labels,
  })
}

/** The plan, or a thrown assertion — every caller below wants the happy branch. */
function plan(source: string, current: readonly LabelPair[] = []) {
  const result = planLabelImport(source, lookup, current)
  if (!result.ok) throw new Error(`expected a readable file, got ${result.error}`)
  return result.plan
}

/* ──────────────────────────────── the export ────────────────────────────── */

describe('buildLabelFile', () => {
  it('names its own format and version, so a file found later identifies itself', () => {
    const file = buildLabelFile([{ key: 'nav.map', en: 'Wall', ar: null }], META)
    expect(file.format).toBe(LABEL_FILE_FORMAT)
    expect(file.version).toBe(LABEL_FILE_VERSION)
    expect(file.exportedAt).toBe(META.exportedAt)
    expect(file.appVersion).toBe(META.appVersion)
    expect(file.locales).toEqual(['en', 'ar'])
    expect(file.count).toBe(1)
  })

  it('sorts its keys, so two exports of one set differ only in the stamp', () => {
    const pairs: LabelPair[] = [
      { key: 'nav.map', en: 'Wall', ar: null },
      { key: TOTAL_ONE, en: '{count} thing', ar: null },
      { key: 'entry.createdBy', en: null, ar: 'كتبه {name}' },
    ]
    const forward = serializeLabelFile(buildLabelFile(pairs, META))
    const backward = serializeLabelFile(buildLabelFile([...pairs].reverse(), META))
    expect(forward).toBe(backward)
    expect(Object.keys(buildLabelFile(pairs, META).labels)).toEqual([
      TOTAL_ONE,
      'entry.createdBy',
      'nav.map',
    ])
  })

  it('writes both languages on every entry, null included', () => {
    const file = buildLabelFile([{ key: 'nav.map', en: 'Wall', ar: null }], META)
    // Not `toEqual({en: 'Wall'})`: an absent `ar` would read as "leave the
    // Arabic alone", which is the one thing it does not mean.
    expect(file.labels['nav.map']).toEqual({ en: 'Wall', ar: null })
    expect(serializeLabelFile(file)).toContain('"ar": null')
  })

  it('drops a pair that overrides nothing rather than writing two nulls', () => {
    const file = buildLabelFile(
      [
        { key: 'nav.map', en: '   ', ar: '' },
        { key: 'entry.createdBy', en: 'Written by {name}', ar: null },
      ],
      META,
    )
    expect(Object.keys(file.labels)).toEqual(['entry.createdBy'])
    expect(file.count).toBe(1)
  })

  it('trims, and treats a blank as no wording at all', () => {
    const file = buildLabelFile([{ key: 'nav.map', en: '  Wall  ', ar: '   ' }], META)
    expect(file.labels['nav.map']).toEqual({ en: 'Wall', ar: null })
  })

  it('cannot have its prototype replaced by a hostile key', () => {
    // `labels[key] = …` would go through the inherited setter for `__proto__`
    // and swap the object's prototype instead of storing a property. The build
    // uses Object.fromEntries, which defines own properties.
    const file = buildLabelFile([{ key: '__proto__', en: 'x', ar: null }], META)
    expect(Object.getPrototypeOf(file.labels)).toBe(Object.prototype)
    expect(({} as Record<string, unknown>).en).toBeUndefined()
    expect(JSON.parse(serializeLabelFile(file)).labels.__proto__).toEqual({ en: 'x', ar: null })
  })

  it('emits Arabic as literal UTF-8, not \\u escapes', () => {
    const text = serializeLabelFile(buildLabelFile([{ key: 'nav.map', en: null, ar: 'اللوحة' }], META))
    expect(text).toContain('اللوحة')
    expect(text.endsWith('\n')).toBe(true)
  })
})

describe('labelFileName', () => {
  const at = new Date(2026, 6, 31, 20, 45)

  it('stamps local time, sortable first', () => {
    expect(labelFileName(at)).toBe('nphiescore-terminology-2026-07-31-2045.json')
  })

  it('carries nothing a Windows share or a foreign keyboard would mangle', () => {
    // The rule brand.test.ts holds every generated filename to: ASCII, digits
    // and the three separators, in either UI language.
    expect(labelFileName(at)).toMatch(/^[a-z0-9.-]+$/)
    expect(labelFileName(new Date(2026, 0, 5, 9, 7))).toBe(
      'nphiescore-terminology-2026-01-05-0907.json',
    )
  })

  it('states its encoding rather than leaving it to be guessed', () => {
    expect(labelFileMimeType()).toBe('application/json;charset=utf-8')
  })
})

/* ──────────────────────────────── the import ────────────────────────────── */

describe('planLabelImport — what it refuses to read at all', () => {
  it('answers a non-JSON file with the parse error', () => {
    const result = planLabelImport('this is not json', lookup, [])
    expect(result).toEqual({ ok: false, error: 'terminology.errImportParse' })
  })

  it('refuses a file larger than a wording pass could honestly be', () => {
    const huge = `"${'a'.repeat(LABEL_FILE_MAX_BYTES)}"`
    expect(planLabelImport(huge, lookup, [])).toEqual({
      ok: false,
      error: 'terminology.errImportParse',
    })
  })

  it('refuses JSON that is not an object of keys', () => {
    for (const body of ['[]', '"a string"', '42', 'null']) {
      expect(planLabelImport(body, lookup, [])).toEqual({
        ok: false,
        error: 'terminology.errImportShape',
      })
    }
  })

  it('refuses a file that says it is some other document', () => {
    const body = JSON.stringify({ format: 'opstrack-export', labels: { 'nav.map': { en: 'x' } } })
    expect(planLabelImport(body, lookup, [])).toEqual({
      ok: false,
      error: 'terminology.errImportShape',
    })
  })

  it('refuses a version from the future rather than reading it under this one’s rules', () => {
    const body = JSON.stringify({
      format: LABEL_FILE_FORMAT,
      version: LABEL_FILE_VERSION + 1,
      labels: { 'nav.map': { en: 'Wall', ar: null } },
    })
    expect(planLabelImport(body, lookup, [])).toEqual({
      ok: false,
      error: 'terminology.errImportShape',
    })
  })

  it('reads a bare key→pair map, because that is what a person writes by hand', () => {
    const result = plan(JSON.stringify({ 'nav.map': { en: 'Wall' } }))
    expect(result.apply).toEqual([{ key: 'nav.map', en: 'Wall', ar: null }])
  })
})

describe('planLabelImport — the round trip', () => {
  it('reads back exactly what the app wrote', () => {
    const pairs: LabelPair[] = [
      { key: 'nav.map', en: 'Wall', ar: 'الحائط' },
      { key: TOTAL_ONE, en: 'one item', ar: null },
    ]
    const text = serializeLabelFile(buildLabelFile(pairs, META))
    expect(plan(text).apply).toEqual([
      { key: TOTAL_ONE, en: 'one item', ar: null },
      { key: 'nav.map', en: 'Wall', ar: 'الحائط' },
    ])
  })

  it('applies nothing when the file is already what the app is using', () => {
    // The owner loading the same file twice — the case that decides whether the
    // confirmation says "12 labels will change" or tells the truth.
    const stored: LabelPair[] = [{ key: 'nav.map', en: 'Wall', ar: 'الحائط' }]
    const text = serializeLabelFile(buildLabelFile(stored, META))
    const result = plan(text, stored)
    expect(result.apply).toEqual([])
    expect(result.unchanged).toBe(1)
    expect(result.total).toBe(1)
  })

  it('counts only the entries that would really change', () => {
    const stored: LabelPair[] = [{ key: 'nav.map', en: 'Wall', ar: null }]
    const result = plan(
      fileOf({
        'nav.map': { en: 'Wall', ar: null },
        'entry.createdBy': { en: 'Raised by {name}', ar: null },
      }),
      stored,
    )
    expect(result.apply.map((e) => e.key)).toEqual(['entry.createdBy'])
    expect(result.unchanged).toBe(1)
  })
})

describe('planLabelImport — blank means default', () => {
  it('turns a blanked entry into a reset of a key that IS overridden', () => {
    const stored: LabelPair[] = [{ key: 'nav.map', en: 'Wall', ar: 'الحائط' }]
    const result = plan(fileOf({ 'nav.map': { en: '', ar: '   ' } }), stored)
    expect(result.apply).toEqual([{ key: 'nav.map', en: null, ar: null }])
  })

  it('does not write a reset for a key that was never overridden', () => {
    const result = plan(fileOf({ 'nav.map': { en: '', ar: null } }))
    expect(result.apply).toEqual([])
    expect(result.unchanged).toBe(1)
  })

  it('never lets a blank be the reason a file is refused', () => {
    // `board.total.one` is a legal English row and an unknown Arabic one, because
    // `board.total` is an invariant string in Arabic. A blank on the unknown side
    // stores nothing, so there is nothing to refuse.
    const result = plan(fileOf({ [TOTAL_ONE]: { en: 'one item', ar: '' } }))
    expect(result.rejected).toEqual([])
    expect(result.apply).toEqual([{ key: TOTAL_ONE, en: 'one item', ar: null }])
  })
})

describe('planLabelImport — an unknown key is skipped, never written', () => {
  it('skips a key this build does not have', () => {
    const result = plan(fileOf({ 'nav.map': { en: 'Wall' }, [RETIRED]: { en: 'Ghost' } }))
    expect(result.skipped).toEqual([RETIRED])
    expect(result.apply.map((e) => e.key)).toEqual(['nav.map'])
    expect(result.rejected).toEqual([])
    expect(result.total).toBe(2)
  })

  it('skips rather than refuses, so a file from another build still applies', () => {
    // The portability promise: a wording pass drafted against the next release
    // must not be rejected wholesale by this one.
    const result = plan(fileOf({ 'future.thing': { en: 'x' }, 'nav.map': { en: 'Wall' } }))
    expect(result.apply).toHaveLength(1)
  })

  it('refuses a value written for a language that cannot hold it', () => {
    // Arabic has no `board.total.one` — the key is a plain string there. A
    // wording written into that box would never reach a reader, and saying so is
    // the whole reason the report is per language.
    const result = plan(fileOf({ [TOTAL_ONE]: { en: 'one item', ar: 'بند واحد' } }))
    expect(result.rejected).toEqual([
      { key: TOTAL_ONE, locale: 'ar', error: 'terminology.errUnknownKey', vars: undefined },
    ])
    expect(result.apply).toEqual([])
  })
})

describe('planLabelImport — every entry goes through the shared validator', () => {
  it('names the placeholder an entry dropped', () => {
    const result = plan(fileOf({ 'entry.createdBy': { en: 'Created by the owner' } }))
    expect(result.rejected).toEqual([
      {
        key: 'entry.createdBy',
        locale: 'en',
        error: 'terminology.errTokenMissing',
        vars: { token: '{name}' },
      },
    ])
  })

  it('names a placeholder an entry invented', () => {
    const result = plan(fileOf({ 'nav.map': { en: 'Board of {foo}' } }))
    expect(result.rejected[0]).toMatchObject({
      locale: 'en',
      error: 'terminology.errTokenUnknown',
      vars: { token: '{foo}' },
    })
  })

  it('refuses a plural key written as one sentence', () => {
    const result = plan(fileOf({ 'board.total': { en: 'lots of items' } }))
    expect(result.rejected[0]).toMatchObject({ error: 'terminology.errPluralWhole' })
  })

  it('refuses a range form that drops the number', () => {
    const result = plan(fileOf({ [TOTAL_OTHER]: { en: 'several items' } }))
    expect(result.rejected[0]).toMatchObject({
      error: 'terminology.errCountMissing',
      vars: { category: 'other' },
    })
  })

  it('allows an exact form to leave the number out', () => {
    const result = plan(fileOf({ [TOTAL_ONE]: { en: 'a single item' } }))
    expect(result.rejected).toEqual([])
    expect(result.apply).toEqual([{ key: TOTAL_ONE, en: 'a single item', ar: null }])
  })

  it('refuses a form this language never selects', () => {
    const result = plan(fileOf({ [TOTAL_FEW]: { en: '{count} items' } }))
    expect(result.rejected[0]).toMatchObject({
      error: 'terminology.errUnreachableCategory',
      vars: { category: 'few' },
    })
  })

  it('fences a token the shipped string fences, without being asked', () => {
    // Rule 3 of the spec, arriving through a file instead of through a text box:
    // nobody types U+2068 into an editor, and an unfenced `{name}` in Arabic
    // reorders the sentence around it.
    const result = plan(fileOf({ 'entry.createdBy': { ar: 'كتبه {name}' } }))
    expect(result.apply).toEqual([
      { key: 'entry.createdBy', en: null, ar: `كتبه ${FSI}{name}${PDI}` },
    ])
  })

  it('reports both languages of one entry, not just the first', () => {
    const result = plan(fileOf({ 'entry.createdBy': { en: 'Created by', ar: 'كتبه' } }))
    expect(result.rejected.map((r) => r.locale)).toEqual(['en', 'ar'])
  })
})

describe('planLabelImport — all or nothing', () => {
  it('applies NOTHING when any entry is rejected, however good the rest are', () => {
    const result = plan(
      fileOf({
        'nav.map': { en: 'Wall' },
        'entry.createdBy': { en: 'Created by nobody' },
      }),
    )
    expect(result.rejected).toHaveLength(1)
    // The structural half of the promise: a caller that never looks at
    // `rejected` still cannot write half a file.
    expect(result.apply).toEqual([])
  })

  it('reports a malformed entry against its key and both languages at once', () => {
    const result = plan(
      JSON.stringify({ labels: { 'nav.map': 'Wall', 'entry.createdBy': ['x'] } }),
    )
    expect(result.rejected).toEqual([
      { key: 'entry.createdBy', locale: null, error: 'terminology.errImportShape' },
      { key: 'nav.map', locale: null, error: 'terminology.errImportShape' },
    ])
    expect(result.apply).toEqual([])
  })

  it('refuses a value that is neither a string nor null', () => {
    const result = plan(fileOf({ 'nav.map': { en: 42 } }))
    expect(result.rejected[0]).toMatchObject({ locale: null, error: 'terminology.errImportShape' })
  })

  it('refuses a blank key rather than storing a row nothing can read', () => {
    const result = plan(fileOf({ '   ': { en: 'x' } }))
    expect(result.rejected).toHaveLength(1)
    expect(result.apply).toEqual([])
  })

  it('ignores a field it does not know instead of failing on it', () => {
    // Forward compatibility, and the note somebody left themselves beside a row.
    const result = plan(fileOf({ 'nav.map': { en: 'Wall', ar: null, note: 'ask Aziz' } }))
    expect(result.apply).toEqual([{ key: 'nav.map', en: 'Wall', ar: null }])
  })

  it('reports in key order, so a second read of one file reads the same', () => {
    const result = plan(
      fileOf({
        'nav.map': { en: 'Board of {foo}' },
        'board.total': { en: 'lots' },
        'entry.createdBy': { en: 'Created by' },
      }),
    )
    expect(result.rejected.map((r) => r.key)).toEqual([
      'board.total',
      'entry.createdBy',
      'nav.map',
    ])
  })
})

/* ─────────────────────── against the bundles we ship ────────────────────── */

describe('the real seam', () => {
  // `shippedNode` is what components/settings/LabelIO.tsx passes as the lookup.
  // Nothing else in this file would catch a change to its signature or to the
  // shape of a real key, and a mismatch there would make every entry in every
  // file "unknown" — a screen that silently skips everything and reports success.
  it('accepts a wording pass written against the shipped bundles', () => {
    const text = serializeLabelFile(
      buildLabelFile(
        [
          { key: 'nav.map', en: 'Wall', ar: 'الحائط' },
          { key: CHANGED_ONE, en: 'one renamed', ar: null },
        ],
        META,
      ),
    )
    const result = planLabelImport(text, shippedNode, [])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.rejected).toEqual([])
    expect(result.plan.skipped).toEqual([])
    expect(result.plan.apply).toHaveLength(2)
  })

  it('still refuses a real key whose real placeholder was dropped', () => {
    const body = JSON.stringify({ 'terminology.collapseSection': { en: 'Collapse' } })
    const result = planLabelImport(body, shippedNode, [])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.rejected[0]).toMatchObject({
      error: 'terminology.errTokenMissing',
      vars: { token: '{section}' },
    })
  })

  it('reaches this screen’s own strings — they are not special-cased', () => {
    const body = JSON.stringify({ 'terminology.importApply': { en: 'Do it' } })
    const result = planLabelImport(body, shippedNode, [])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.apply).toEqual([
      { key: 'terminology.importApply', en: 'Do it', ar: null },
    ])
  })
})
