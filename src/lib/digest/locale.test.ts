// Parity for the `digest` namespace, checked HERE rather than only in
// src/lib/localeParity.test.ts.
//
// WHY IT EARNS ITS KEEP. `src/locales/index.ts` is integrator-only after Wave 1
// (§1.0.2), so this worker ships `{en,ar}/digest.json` and the integrator adds
// the two imports. Until that lands, the repo-wide parity test cannot see these
// files at all — `NAMESPACES` is derived from `EN_NAMESPACES`, so an unregistered
// pair is invisible and every assertion about it passes vacuously. That is the
// exact failure localeReach.test.ts's header describes from the Wave-2 SLA keys,
// arriving from the other direction.
//
// So the two files are imported DIRECTLY and checked against each other before
// the handoff, and once the integrator registers them the repo-wide test checks
// them again. Two mechanisms for one rule is normally a smell; here the second
// one covers a window the first one structurally cannot see.
//
// This file asserts NOTHING the repo-wide test asserts about other namespaces —
// it is scoped to `digest` and deletes cleanly if the integrator would rather
// have one gate.

import { describe, expect, it } from 'vitest'
import { AR_NAMESPACES, EN_NAMESPACES } from '../../locales'
import ar from '../../locales/ar/digest.json'
import en from '../../locales/en/digest.json'
import { ds } from './strings'
import { hasLtr, hasRtl, stripIsolates } from './bidi'
import { PLURAL_CATEGORIES, isPluralNode } from '../plural'
import { SECTION_ORDER } from './types'

type Tree = { [k: string]: unknown }

function flatten(tree: Tree, prefix = '', out = new Map<string, unknown>()): Map<string, unknown> {
  for (const [k, v] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string' || isPluralNode(v)) out.set(path, v)
    else flatten(v as Tree, path, out)
  }
  return out
}

function tokensOf(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
}

/** A leaf's `other` form, which both languages always have. */
function otherOf(leaf: unknown): string {
  if (typeof leaf === 'string') return leaf
  return isPluralNode(leaf) ? leaf.other : ''
}

const EN = flatten(en as Tree)
const AR = flatten(ar as Tree)

describe('digest namespace', () => {
  /**
   * THE INTEGRATION TRIPWIRE, and it is RED until the integrator acts.
   *
   * `src/locales/index.ts` is integrator-only (§1.0.2), so this worker ships the
   * two JSON files and cannot register them. Unregistered, `t('digest.title')`
   * renders the string `digest.title` on the screen, in both languages, with
   * every other test in the repo green — the parity gate derives its namespace
   * list FROM index.ts, so a file it does not know about is a file it cannot
   * check. A note in a handoff is exactly what that failure rode to production
   * last time (see localeReach.test.ts's header on the Wave-2 SLA keys), so the
   * requirement is a failing assertion instead.
   *
   * Fix: two imports and two entries in each of the four maps in
   * `src/locales/index.ts`. This test then passes and is worth keeping — it
   * fails again the day someone removes them.
   */
  it('is registered in src/locales/index.ts', () => {
    expect(Object.keys(EN_NAMESPACES)).toContain('digest')
    expect(Object.keys(AR_NAMESPACES)).toContain('digest')
  })

  it('has exactly one root key per file, matching the filename', () => {
    expect(Object.keys(en)).toEqual(['digest'])
    expect(Object.keys(ar)).toEqual(['digest'])
  })

  it('holds identical key sets', () => {
    const enKeys = [...EN.keys()].sort()
    const arKeys = [...AR.keys()].sort()
    expect(enKeys.filter((k) => !arKeys.includes(k))).toEqual([])
    expect(arKeys.filter((k) => !enKeys.includes(k))).toEqual([])
  })

  it('has no empty value in either language', () => {
    const empties: string[] = []
    for (const [flat, lang] of [
      [EN, 'en'],
      [AR, 'ar'],
    ] as const) {
      for (const [key, leaf] of flat) {
        const forms = typeof leaf === 'string' ? [leaf] : Object.values(leaf as object)
        for (const form of forms) {
          if (typeof form === 'string' && form.trim() === '') empties.push(`${lang}:${key}`)
        }
      }
    }
    expect(empties).toEqual([])
  })

  it('uses the same interpolation tokens in both languages', () => {
    const mismatched: string[] = []
    for (const [key, leaf] of EN) {
      const a = tokensOf(otherOf(leaf))
      const b = tokensOf(otherOf(AR.get(key)))
      if (a.join(',') !== b.join(',')) mismatched.push(`${key}: en{${a}} ar{${b}}`)
    }
    expect(mismatched).toEqual([])
  })

  it('ships only legal plural categories', () => {
    const bad: string[] = []
    for (const [flat, lang] of [
      [EN, 'en'],
      [AR, 'ar'],
    ] as const) {
      for (const [key, leaf] of flat) {
        if (typeof leaf === 'string') continue
        for (const category of Object.keys(leaf as object)) {
          if (!(PLURAL_CATEGORIES as readonly string[]).includes(category)) {
            bad.push(`${lang}:${key}.${category}`)
          }
        }
      }
    }
    expect(bad).toEqual([])
  })

  it('ships no English `few`/`many`/`two` — forms English can never select', () => {
    const unreachable: string[] = []
    for (const [key, leaf] of EN) {
      if (typeof leaf === 'string') continue
      for (const category of Object.keys(leaf as object)) {
        if (category !== 'one' && category !== 'other') unreachable.push(`${key}.${category}`)
      }
    }
    expect(unreachable).toEqual([])
  })

  it('carries {count} in every range form', () => {
    const missing: string[] = []
    for (const [flat, lang] of [
      [EN, 'en'],
      [AR, 'ar'],
    ] as const) {
      for (const [key, leaf] of flat) {
        if (typeof leaf === 'string') continue
        for (const [category, form] of Object.entries(leaf as Record<string, string>)) {
          if (category === 'zero' || category === 'one' || category === 'two') continue
          if (!form.includes('{count}')) missing.push(`${lang}:${key}.${category}`)
        }
      }
    }
    expect(missing).toEqual([])
  })

  it('keeps every non-count token of `other` in every plural form', () => {
    // `digest.detailBlocked` interpolates {status} as well as {count}; a form
    // that drops it renames the row's status for one particular day count.
    const dropped: string[] = []
    for (const [flat, lang] of [
      [EN, 'en'],
      [AR, 'ar'],
    ] as const) {
      for (const [key, leaf] of flat) {
        if (typeof leaf === 'string') continue
        const required = tokensOf(otherOf(leaf)).filter((tok) => tok !== 'count')
        for (const [category, form] of Object.entries(leaf as Record<string, string>)) {
          for (const tok of required) {
            if (!form.includes(`{${tok}}`)) dropped.push(`${lang}:${key}.${category} {${tok}}`)
          }
        }
      }
    }
    expect(dropped).toEqual([])
  })
})

describe('every key the builder and the renderers ask for exists', () => {
  // The template-literal families — `digest.section${Kind}` and
  // `digest.sum${Kind}` — cannot be found by localeReach.test.ts's regex, so
  // they are enumerated from the frozen kind list here, in both directions.
  it('covers section and summary keys for exactly the five kinds', () => {
    for (const [flat, lang] of [
      [EN, 'ar'],
      [AR, 'en'],
    ] as const) {
      for (const prefix of ['section', 'sum'] as const) {
        const present = [...flat.keys()].filter((k) => k.startsWith(`digest.${prefix}`)).sort()
        const expected = SECTION_ORDER.map(
          (kind) => `digest.${prefix}${kind.charAt(0).toUpperCase()}${kind.slice(1)}`,
        )
        // `digest.sectionsLegend`/`sectionsHint` and `digest.summaryEmpty` share
        // these prefixes and are not per-kind keys, so they are excluded by name
        // rather than the filter being loosened — a loose filter is how a
        // missing key hides.
        const kinds = present.filter(
          (k) => !k.startsWith('digest.sections') && !k.startsWith('digest.summary'),
        )
        expect(kinds.sort(), lang).toEqual(expected.sort())
      }
    }
  })
})

describe('Arabic quality', () => {
  it('isolates every literal Latin token that sits inside an Arabic sentence', () => {
    const unwrapped: string[] = []
    for (const [key, leaf] of AR) {
      // `{count}` and `{status}` are Latin-lettered PLACEHOLDERS, not literal
      // Latin text — the builder isolates the values it substitutes into them
      // (see build.ts's `wrap`), so counting them here would demand an isolate
      // around every interpolation site and make the check meaningless.
      const value = otherOf(leaf).replace(/\{\w+\}/g, '')
      // A value that is ONLY Latin is a standalone label (a format name, a
      // language name) and needs no isolate — it is its own paragraph.
      if (!hasRtl(value) || !hasLtr(value)) continue
      if (stripIsolates(value) === value) unwrapped.push(key)
    }
    expect(unwrapped).toEqual([])
  })

  it('renders Arabic through ds() without falling back to English', () => {
    for (const key of ['digest.docTitle', 'digest.sectionOverdue', 'digest.tagOther']) {
      const value = ds('ar', key)
      expect(hasRtl(value), key).toBe(true)
    }
  })

  it('selects the right Arabic plural form for 1, 2, 3 and 11', () => {
    expect(ds('ar', 'digest.sumClosed', { count: 1 })).toBe('بند مُغلق واحد')
    expect(ds('ar', 'digest.sumClosed', { count: 2 })).toBe('بندان مُغلقان')
    expect(ds('ar', 'digest.sumClosed', { count: 3 })).toBe('3 بنود مُغلقة')
    expect(ds('ar', 'digest.sumClosed', { count: 11 })).toBe('11 بندًا مُغلقًا')
  })

  it('falls back to the key, not to blank, when a key does not exist', () => {
    expect(ds('ar', 'digest.nope')).toBe('digest.nope')
  })
})
