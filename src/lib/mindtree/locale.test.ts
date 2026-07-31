// The mindtree namespace's own locale gate.
//
// WHY IT EXISTS AT ALL, given that the repo already has three locale gates.
// Because none of them can see this namespace yet. `localeParity`,
// `localeReach` and `bidi.test.ts` all read `src/locales/index.ts`, and
// `mindtree` is not spread into it — that one line is part of the handoff diff
// the orchestrator lands. localeReach in particular SKIPS any key whose root is
// not a registered namespace (`if (!ROOTS.has(...)) continue`), so its "every
// key the app asks for resolves in BOTH bundles" assertion is currently vacuous
// over every string this feature ships.
//
// That is not a theoretical hole. `model.ts` emits `mindtree.unknownTrack` and
// `mindtree.unknownGroup` for the two cases where a row references a bucket
// nothing explains, and both keys were absent from both bundles — so t() fell
// through to echoing its own argument (lib/i18n:116) and a track node rendered
// the literal string `mindtree.unknownTrack`, wrapped in a bidi isolate, where
// a track name belongs. Every gate was green, because the gates were not
// looking. It would have landed as a red build on the ORCHESTRATOR, one file
// away from anyone who could fix it.
//
// So this file runs the same four rules the shipped gates run, against the two
// JSON files DIRECTLY, and it keeps running after the namespace is registered —
// where it is then redundant with them and costs four milliseconds. Redundancy
// at a seam is not duplication; it is the seam being checked from both sides.

import { describe, expect, it } from 'vitest'
import ar from '../../locales/ar/mindtree.json'
import en from '../../locales/en/mindtree.json'
import { PDI } from '../bidi'
import { isolatesBalanced } from '../bidi'
import { EXACT_CATEGORIES, PLURAL_CATEGORIES, isPluralNode, pluralCategory } from '../plural'
import type { Locale } from '../i18n'

type Tree = { [k: string]: string | Tree }

const EN_FILE = en as unknown as Tree
const AR_FILE = ar as unknown as Tree

/**
 * The namespace's contents, unwrapped.
 *
 * Every walk below runs over this rather than over the file, so a path reads
 * `showMore` — which is what a call site asks for after `mindtree.` and what
 * `requested()` below produces. Walking the file instead would prefix every
 * key with `mindtree.` on one side of every comparison and nothing on the
 * other, and the whole file would assert the difference between two spellings.
 */
const EN = EN_FILE.mindtree as Tree
const AR = AR_FILE.mindtree as Tree

/** Every leaf, as `dot.path → value`, plural forms flattened one level. */
function strings(tree: Tree, prefix = '', out: [string, string][] = []): [string, string][] {
  for (const [k, v] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') out.push([path, v])
    else if (isPluralNode(v)) for (const [c, form] of Object.entries(v)) out.push([`${path}.${c}`, form])
    else strings(v, path, out)
  }
  return out
}

/** Every path a caller may ask t() for — a plural node TERMINATES the walk. */
function keys(tree: Tree, prefix = '', out: Set<string> = new Set()): Set<string> {
  for (const [k, v] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string' || isPluralNode(v)) out.add(path)
    else keys(v, path, out)
  }
  return out
}

const EN_KEYS = keys(EN)
const AR_KEYS = keys(AR)

/* ─────────────────────────── what the code asks for ────────────────────── */

/**
 * The whole app as text, at module scope, once — the same `?raw` trick
 * localeReach.test.ts uses and for the same reason (tsconfig.app.json pins
 * `types: ["vite/client"]`, and widening it for node:fs would leak node globals
 * into every app file's type space).
 *
 * TWO GLOBS, NOT ONE, and the second is a bug fix rather than belt-and-braces.
 * Vite normalises a glob result to the shortest relative specifier, so this
 * file's own siblings — `lib/mindtree/model.ts` and `layout.ts`, which between
 * them ask for `more`, `unknownTrack`, `unknownGroup`, `unknownOwner` and all
 * four `dim*` labels — resolve as `./model.ts` and never match a pattern
 * starting `../../`. With one glob the scan silently skipped the module that
 * emits the keys this file exists to check.
 */
const SOURCES: Record<string, string> = {
  ...import.meta.glob<string>('../../**/*.{ts,tsx}', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
  ...import.meta.glob<string>('./*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
}

/**
 * Every file that may ASK for one of these keys — which is not the same set as
 * the files this feature owns.
 *
 * This used to admit by PATH (`/mindtree|Mindtree/`), on the assumption that
 * only the feature's own seven files request its namespace. The wiring diff
 * broke that assumption the moment it landed: `pages/tracks/TracksIndex.tsx`
 * asks for the three `view*` keys and `lib/routeTitle.ts` asks for `title`, and
 * neither path carries the word. Under the old rule both were invisible, so the
 * dead-key assertion below would have called three live keys rot.
 *
 * Admission is by CONTENT instead, which is what the rule always meant:
 * `KEYISH` only matches a quoted `mindtree.*` literal, and a file containing
 * one is asking for it whatever it is called. Two exclusions remain — the
 * bundles themselves are the answer rather than the question, and this file's
 * own prose is full of key-shaped strings.
 */
function mine(path: string): boolean {
  if (path.includes('/locales/')) return false
  return !path.endsWith('locale.test.ts')
}

/** Quoted `mindtree.some.key` literals. Same shape localeReach.test.ts uses. */
const KEYISH = /(['"])(mindtree\.[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)\1/g

function requested(): Map<string, Set<string>> {
  const asked = new Map<string, Set<string>>()
  for (const [path, src] of Object.entries(SOURCES)) {
    if (!mine(path)) continue
    for (const m of src.matchAll(KEYISH)) {
      const key = (m[2] as string).slice('mindtree.'.length)
      const where = asked.get(key) ?? new Set<string>()
      where.add(path)
      asked.set(key, where)
    }
  }
  return asked
}

/**
 * Keys that exist for a diff nobody has landed yet.
 *
 * Empty, and kept empty on purpose. It held `viewSwitch` / `viewList` /
 * `viewMap` while the List | Map switcher lived only in docs/MINDTREE-HANDOFF
 * §2.4; all three are now requested by `pages/tracks/TracksIndex.tsx` and the
 * scan above sees them. The hook stays so that "shipped ahead of its call site"
 * remains a state with an owner rather than something tolerated silently — but
 * an entry here is a debt, and the empty set is the correct resting state.
 */
const PENDING: ReadonlySet<string> = new Set<string>()

/* ────────────────────────────── the four rules ─────────────────────────── */

describe('mindtree locale — reachability', () => {
  it('scans a plausible amount of source', () => {
    // A glob that silently resolved to nothing makes every assertion below
    // vacuously true, which is the classic way a static gate rots into a no-op.
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50)
    expect(requested().size).toBeGreaterThan(40)
  })

  it('every key the feature asks for resolves in BOTH bundles', () => {
    const unresolved: string[] = []
    for (const [key, where] of requested()) {
      const missing = [!EN_KEYS.has(key) && 'en', !AR_KEYS.has(key) && 'ar'].filter(Boolean)
      if (missing.length > 0) {
        unresolved.push(`${key} — missing from ${missing.join('+')} — used in ${[...where].join(', ')}`)
      }
    }
    expect(unresolved.sort()).toEqual([])
  })

  it('names the two buckets model.ts invents when the data explains nothing', () => {
    // Pinned by name, not merely covered by the scan above: these are the two
    // that shipped missing, and the call sites are error paths nobody exercises
    // by hand — a first-paint entry cache one deploy older than the track list.
    for (const key of ['unknownTrack', 'unknownGroup', 'unknownOwner']) {
      expect(EN_KEYS.has(key), `en:${key}`).toBe(true)
      expect(AR_KEYS.has(key), `ar:${key}`).toBe(true)
    }
  })

  it('carries no string nothing asks for', () => {
    const asked = requested()
    const dead = [...EN_KEYS].filter((k) => !asked.has(k) && !PENDING.has(k))
    expect(dead.sort()).toEqual([])
  })
})

describe('mindtree locale — parity', () => {
  it('holds the same key set in both languages', () => {
    expect([...EN_KEYS].sort()).toEqual([...AR_KEYS].sort())
  })

  it('is one file, one root', () => {
    // The invariant src/locales/index.ts's flat spread depends on: a second
    // root here would silently win or lose by import order.
    expect(Object.keys(EN_FILE)).toEqual(['mindtree'])
    expect(Object.keys(AR_FILE)).toEqual(['mindtree'])
  })

  it('has no blank value in either tree', () => {
    for (const [lang, tree] of [
      ['en', EN],
      ['ar', AR],
    ] as const) {
      const blank = strings(tree).filter(([, v]) => v.trim() === '')
      expect(blank, lang).toEqual([])
    }
  })

  it('interpolates the same tokens on both sides of a key', () => {
    // A token present in one language and absent in the other is a sentence
    // that silently drops a number, which no structural check upstream sees.
    const tokens = (v: string): string[] => [...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    const enMap = new Map(strings(EN))
    const mismatched: string[] = []
    for (const [key, value] of strings(AR)) {
      const twin = enMap.get(key)
      // Plural shapes legitimately differ (en has no `few`), so only compare
      // where both languages actually wrote the same form.
      if (twin === undefined) continue
      const a = tokens(value)
      const b = tokens(twin)
      // `{count}` may be dropped in an EXACT category — see lib/plural.ts.
      const exact = EXACT_CATEGORIES.some((c) => key.endsWith(`.${c}`))
      const drop = (list: string[]): string[] => (exact ? list.filter((x) => x !== 'count') : list)
      if (drop(a).join() !== drop(b).join()) mismatched.push(`${key} :: ar[${a}] en[${b}]`)
    }
    expect(mismatched.sort()).toEqual([])
  })
})

describe('mindtree locale — plural nodes', () => {
  /** Every object trying to be a plural node, well-formed or not. */
  function candidates(tree: Tree, prefix = '', out: [string, Tree][] = []): [string, Tree][] {
    for (const [k, v] of Object.entries(tree)) {
      if (typeof v === 'string') continue
      const path = prefix ? `${prefix}.${k}` : k
      const looksPlural = Object.keys(v).some((c) =>
        (PLURAL_CATEGORIES as readonly string[]).includes(c),
      )
      if (looksPlural) out.push([path, v])
      else candidates(v, path, out)
    }
    return out
  }

  function selectable(locale: Locale): Set<string> {
    const seen = new Set<string>()
    for (let n = 0; n <= 200; n += 1) seen.add(pluralCategory(locale, n))
    return seen
  }

  it.each([
    ['en', EN],
    ['ar', AR],
  ] as const)('%s: every plural-shaped node is well formed and reachable', (locale, tree) => {
    const found = candidates(tree)
    expect(found.length).toBeGreaterThan(0)
    const reachable = selectable(locale)
    for (const [path, node] of found) {
      // A typo'd category (`othr`) makes isPluralNode false, and the whole node
      // is then walked as a NAMESPACE — so `t('mindtree.more')` returns the dot
      // path and every count in the map renders as a key.
      expect(isPluralNode(node), path).toBe(true)
      for (const category of Object.keys(node)) {
        expect(reachable.has(category), `${path}.${category}`).toBe(true)
      }
    }
  })

  it.each([
    ['en', EN],
    ['ar', AR],
  ] as const)('%s: every RANGE form carries its count', (_locale, tree) => {
    // `few`, `many` and `other` each cover many numbers, so dropping {count}
    // there loses information the reader needs. `zero`, `one` and `two` pin the
    // value themselves and every natural language spells it out instead.
    const bare: string[] = []
    for (const [path, node] of candidates(tree)) {
      for (const [category, form] of Object.entries(node)) {
        if ((EXACT_CATEGORIES as readonly string[]).includes(category)) continue
        if (typeof form === 'string' && !form.includes('{count}')) bare.push(`${path}.${category}`)
      }
    }
    expect(bare.sort()).toEqual([])
  })
})

describe('mindtree locale — direction', () => {
  /**
   * Placeholder names whose value can begin with a Latin letter or a digit —
   * the same membership rule lib/bidi.test.ts states, narrowed to the tokens
   * this namespace actually uses.
   */
  const USER_VALUE = new Set(['at', 'label', 'name', 'owner', 'title', 'track'])

  /** Isolate opener immediately before `{`, PDI immediately after `}`. */
  function fenced(value: string, token: string, at: number): boolean {
    return /[⁦-⁨]$/.test(value.slice(0, at)) && value.startsWith(PDI, at + token.length + 2)
  }

  it.each([
    ['en', EN],
    ['ar', AR],
  ] as const)('%s: never leaves an isolate open', (_locale, tree) => {
    // The one direction failure that escapes the string it is in: an unclosed
    // FSI reorders every character after it, to the end of the paragraph.
    const broken = strings(tree).filter(([, v]) => !isolatesBalanced(v)).map(([k]) => k)
    expect(broken).toEqual([])
  })

  it.each([
    ['en', EN],
    ['ar', AR],
  ] as const)('%s: fences every interpolation that can run the other way', (_locale, tree) => {
    // BOTH trees, because the rule is about the direction of the VALUE and this
    // app's data is bilingual in one set of columns: an Arabic track name in an
    // English sentence is exactly as common as the mirror.
    const bare: string[] = []
    for (const [key, value] of strings(tree)) {
      for (const m of value.matchAll(/\{(\w+)\}/g)) {
        const token = m[1] as string
        if (!USER_VALUE.has(token)) continue
        if (!fenced(value, token, m.index)) bare.push(`${key} {${token}} :: ${value}`)
      }
    }
    expect(bare.sort()).toEqual([])
  })

  it('never says the retired product name', () => {
    // lib/brand.test.ts is the gate and cannot see this namespace either, for
    // the same reason as everything else in this file.
    for (const tree of [EN, AR]) {
      for (const [key, value] of strings(tree)) {
        expect(value.toLowerCase().includes('opstrack'), key).toBe(false)
      }
    }
  })
})
