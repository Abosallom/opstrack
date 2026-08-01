// R3-I18N-1. The four counted English strings, rendered.
//
// WHAT SHIPPED. `followups.total` was `"{count} items need attention"` — a plain
// string, so isPluralNode() was false, selectPlural() never ran, and a morning
// with exactly one thing on it opened with "1 items need attention". It is the
// app's landing route (App.tsx sends `/` to `/followups`), the label sits in an
// `aria-live="polite"` region, and FilterBar re-announces it on every keystroke
// of a search. Three more were the same bug: `dashboard.trackSummary` ("1
// tracks. Most open work on …", read aloud as the chart's <desc>),
// `mindtree.summary` ("1 tracks, 7 open, …", which is also the exported map's
// description and therefore leaves the app), and `admin.tracks.deleteBodyInUse`
// ("still holds 1 entries") on a screen whose own usage line two rows above
// said "1 entry" correctly, from a plural node.
//
// WHY NOTHING CAUGHT IT. localeParity compares the two trees to each other, and
// the Arabic twin of each of the four had been written as an INVARIANT —
// `بنود تحتاج انتباهك: {count}`, noun before the number, nothing to inflect.
// That is correct Arabic AND a perfect token-set match for a broken English
// string, so all four passed. The counted-noun gate that exists precisely for
// this class was built as `describe('ar locale tree — counted nouns')` and had
// no English half at all. It does now, and that is the structural fix.
//
// WHAT THIS FILE ADDS THAT THE GATE CANNOT. The gate reads the TREE: it proves
// no plural noun trails a non-`count` token. It cannot prove the node is
// REACHED — a plural node whose call site passes `{ n: 1 }` instead of
// `{ count: 1 }` resolves to `other` and renders "1 items" while satisfying
// every structural assertion in the file. So these go through the real t(),
// with the real bundles, and pin the sentence.
//
// The last block is the other half of `deleteBodyInUse`: its three counts cannot
// come from one `{count}` — selectPlural inflects on exactly one number — so the
// nouns were moved OUT of the sentence and the call site now composes it from
// the three plural nodes the same screen already uses. That is a property of
// TracksAdmin.tsx, not of the tree, so it is asserted against the source.

import { describe, expect, it, vi } from 'vitest'

// lib/i18n reads localStorage and lib/theme reads document, both at IMPORT
// time, so the shims cannot wait for a beforeAll(). Dashboard.test.tsx opens
// with the same paragraph; vitest.config.ts is `environment: 'node'` by design.
vi.hoisted(() => {
  const mem = new Map<string, string>()
  const g = globalThis as unknown as Record<string, unknown>
  g.localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() {
      return mem.size
    },
  }
  g.document = { documentElement: { dir: 'ltr', lang: 'en' } }
})

const { setLocale, t } = await import('./i18n')

/**
 * The AI settings screen's source, for the call-site half of its counter.
 *
 * Same mechanism and same reason as the TracksAdmin glob at the foot of this
 * file: the tree can prove the node is well formed, only the source can prove
 * the number is handed to it as `count` instead of printed beside it.
 */
const AI_SETTINGS: Record<string, string> = import.meta.glob(
  '../pages/settings/AiSettings.tsx',
  { query: '?raw', import: 'default', eager: true },
)

/** The four keys, with a full variable set for each. */
const COUNTED: readonly { key: string; vars: (n: number) => Record<string, string | number> }[] = [
  { key: 'followups.total', vars: (n) => ({ count: n }) },
  { key: 'dashboard.trackSummary', vars: (n) => ({ count: n, top: 'Network', topCount: 4 }) },
  { key: 'mindtree.summary', vars: (n) => ({ count: n, open: 7, breached: 2 }) },
]

describe('the follow-ups counter', () => {
  it('agrees its noun and its verb with the number', () => {
    setLocale('en')
    // The headline defect, on the screen the app opens on.
    expect(t('followups.total', { count: 1 })).toBe('1 item needs attention')
    expect(t('followups.total', { count: 2 })).toBe('2 items need attention')
    // Zero is English `other`, and "0 items need attention" is right.
    expect(t('followups.total', { count: 0 })).toBe('0 items need attention')
  })

  it('still reads correctly in Arabic, where the noun precedes the number', () => {
    setLocale('ar')
    // Unchanged and deliberately not a plural node: `بنود تحتاج انتباهك: 1`
    // needs no inflection, which is exactly why the English half rode along
    // broken for so long.
    expect(t('followups.total', { count: 1 })).toContain('1')
    setLocale('en')
  })
})

describe('the two chart summaries', () => {
  it('say "1 track", not "1 tracks"', () => {
    setLocale('en')
    // Read aloud as the <desc> of the dashboard's track chart, and as the
    // Mindtree map's summary — which is also the description the export carries
    // out of the app.
    expect(t('dashboard.trackSummary', { count: 1, top: 'Network', topCount: 4 })).toContain(
      '1 track. Most open work on',
    )
    expect(t('dashboard.trackSummary', { count: 3, top: 'Network', topCount: 4 })).toContain(
      '3 tracks. Most open work on',
    )
    expect(t('mindtree.summary', { count: 1, open: 7, breached: 2 })).toBe(
      '1 track, 7 open, 2 past deadline.',
    )
    expect(t('mindtree.summary', { count: 3, open: 7, breached: 2 })).toBe(
      '3 tracks, 7 open, 2 past deadline.',
    )
  })
})

describe('every counted string, both languages', () => {
  it('leaves no placeholder unreplaced', () => {
    // The failure mode of renaming an interpolation in one tree and not the
    // other: interpolate() leaves an unknown `{token}` verbatim, so the UI shows
    // literal braces. Cheap, and it covers the halves of these sentences that
    // the assertions above pin only loosely.
    const stray: string[] = []
    for (const locale of ['en', 'ar'] as const) {
      setLocale(locale)
      for (const { key, vars } of COUNTED) {
        for (const n of [0, 1, 2, 3, 11, 100]) {
          const rendered = t(key, vars(n))
          if (rendered.includes('{') || rendered === key) stray.push(`${locale} ${key}: ${rendered}`)
        }
      }
    }
    setLocale('en')
    expect(stray).toEqual([])
  })
})

/* ───────────────────── "Used today", on Settings › AI assist ───────────────────── */

// THE SAME CLASS, ONE SPAN FURTHER OUT. `ai.usageCalls` was not a broken plural
// node — it was a FROZEN NOUN in its own <span>, with the number in the span
// beside it: `<span>{usage.calls}</span><span>{t('ai.usageCalls')}</span>`. So
// selectPlural() could never run, because there was no `count` to run on.
//
// English read "1 suggestions" on the most common day of use. Arabic read
// «1 اقتراحًا» — the accusative tamyīz, which is correct for 11–99 and wrong for
// every number below it («اقتراح واحد» at 1, «اقتراحان» at 2, «3 اقتراحات» at 3).
//
// The counted-noun gate was blind to it TWICE: the number was not an
// interpolation at all, so its regex had nothing to anchor on, and neither
// `suggestion` nor «اقتراح» was in COUNTED_NOUNS. Both lists have them now; this
// pins the sentences the gate still cannot see, through the real t().
describe('the AI usage counter', () => {
  it('agrees its noun with the number in English', () => {
    setLocale('en')
    expect(t('ai.usageCalls', { count: 1 })).toBe('1 suggestion')
    expect(t('ai.usageCalls', { count: 2 })).toBe('2 suggestions')
    // The empty state of the card, which is what most days start as.
    expect(t('ai.usageCalls', { count: 0 })).toBe('0 suggestions')
  })

  it('walks all six Arabic categories', () => {
    setLocale('ar')
    expect(t('ai.usageCalls', { count: 0 })).toBe('لا اقتراحات')
    expect(t('ai.usageCalls', { count: 1 })).toBe('اقتراح واحد')
    expect(t('ai.usageCalls', { count: 2 })).toBe('اقتراحان')
    expect(t('ai.usageCalls', { count: 3 })).toBe('3 اقتراحات')
    expect(t('ai.usageCalls', { count: 11 })).toBe('11 اقتراحًا')
    expect(t('ai.usageCalls', { count: 100 })).toBe('100 اقتراح')
    setLocale('en')
  })

  it('is rendered with the number INSIDE the string, not in a span beside it', () => {
    // The regression the tree cannot see, and the exact shape that shipped.
    // A screen that goes back to printing the count itself would satisfy every
    // structural assertion in localeParity while rendering "1 suggestions".
    const src = Object.values(AI_SETTINGS)[0]
    expect(src, 'AiSettings.tsx not found by the glob').toBeTypeOf('string')
    expect(src).toMatch(/t\('ai\.usageCalls',\s*\{\s*count:/)
    expect(src).not.toMatch(/\{usage \? usage\.calls : 0\}<\/span>/)
  })
})

/* ────────────────── the track-deletion body, and its call site ────────────────── */

// Read through import.meta.glob('?raw') — tsconfig.app.json pins
// `types: ["vite/client"]`, and localeReach.test.ts reads the source tree the
// same way rather than widening it to include "node".
const SOURCE: Record<string, string> = import.meta.glob('../pages/settings/TracksAdmin.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
})

describe('"this track is still in use"', () => {
  const compose = (entries: number, meetings: number, templates: number): string =>
    t('admin.tracks.deleteBodyInUse', {
      name: 'Network',
      entries: t('admin.tracks.usageEntries', { count: entries }),
      meetings: t('admin.tracks.usageMeetings', { count: meetings }),
      templates: t('admin.tracks.usageTemplates', { count: templates }),
    })

  it('inflects all three nouns independently', () => {
    setLocale('en')
    // One number cannot inflect three nouns, which is why the sentence stopped
    // carrying them. Before the fix this read "1 entries, 1 meetings and 1
    // templates" — beside a usage line reading "1 entry".
    expect(compose(1, 1, 1)).toContain('still holds 1 entry, 1 meeting and 1 template.')
    expect(compose(3, 1, 0)).toContain('still holds 3 entries, 1 meeting and 0 templates.')
  })

  it('picks the right Arabic form for each noun', () => {
    setLocale('ar')
    // Arabic has six, and the three counts land in three different categories
    // here — which is the case the composed form exists to make possible.
    const body = compose(1, 2, 5)
    expect(body).toContain('بند واحد')
    expect(body).toContain('اجتماعان')
    expect(body).toContain('{count} قوالب'.replace('{count}', '5'))
    setLocale('en')
  })

  it('is composed at the call site, not handed three bare numbers', () => {
    // The regression the tree cannot see. Passing the raw counts again would
    // render "still holds 1, 1 and 1" — grammatical, and useless. The locale
    // gate would stay green, because the nouns are gone from the string.
    const src = Object.values(SOURCE)[0]
    expect(src, 'TracksAdmin.tsx not found by the glob').toBeTypeOf('string')
    expect(src).toMatch(/entries:\s*t\('admin\.tracks\.usageEntries'/)
    expect(src).toMatch(/meetings:\s*t\('admin\.tracks\.usageMeetings'/)
    expect(src).toMatch(/templates:\s*t\('admin\.tracks\.usageTemplates'/)
  })
})
