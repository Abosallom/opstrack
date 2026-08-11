// Render proof for /settings/catalogue — the admin gate, the shell the screen
// first paints, and the two locale bundles it is made of.
//
// WHY renderToStaticMarkup AND NOT A DOM: the reason every sibling page test
// gives. vitest.config.ts is `environment: 'node'`, there is no jsdom and no
// testing-library, and react-dom/server runs the real component, the real
// hooks, the real class names and the real translator.
//
// A server render runs no effects and dispatches no events, so this file sees
// the screen EXACTLY as it first appears: the gate, the intro block, the live
// region and the loading skeleton that stands in for two lists the effect has
// not fetched yet. The rows, the editors and the add forms are behind state
// that only a fetch or a click produces, so they are OUT OF REACH here and
// claimed about nowhere below. Their interactive proof is a browser pass.
//
// ── WHY THE LOCALE HALF READS THE JSON FILES DIRECTLY ──────────────────────
//
// `catalogue` is a NEW namespace. `src/locales/index.ts` is not this worker's
// file, so until the integrator adds the two imports the merged bundles this
// screen's `t()` reads do not contain it — and every assertion of the shape
// every assertion of the shape "the key must not resolve to its own dot path"
// would fail for a reason that has nothing
// to do with whether the strings are right. So the parity, plural, bidi and
// reach gates below are run against `en/catalogue.json` and `ar/catalogue.json`
// themselves. That is strictly MORE than routing through t() would prove: it is
// the same set of properties, minus a dependency on a wiring step this unit
// does not own.
//
// AND IT IS NOT REDUNDANT WITH THE TREE-WIDE GATES, which was the assumption
// worth checking rather than believing: `localeParity.test.ts` and
// `bidi.test.ts` do NOT glob the locale directories — they import
// `EN_NAMESPACES` / `AR_NAMESPACES` from `src/locales/index.ts`, which are two
// hand-written maps. A namespace file that exists on disk and is not listed
// there is invisible to every one of them, silently. So until the integrator
// wires it, THIS FILE is the only thing checking these two bundles at all, and
// it therefore has to check the whole set of properties rather than the few
// that are convenient.
//
// THE PROPERTY WORTH THE MOST HERE is the last block: this screen exists
// because Settings › Vocabulary refuses Add and Delete and this one must not,
// and the header has to say WHY in words a reader meets before the buttons.
// A screen that quietly dropped that paragraph would look finished.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { isPluralNode, PLURAL_CATEGORIES } from '../../lib/plural'

const fx = vi.hoisted(() => {
  // lib/i18n reads localStorage at module scope, store/config adds a window
  // focus listener at module scope, and `useIsAdmin` reads
  // window.location.search at RENDER time for the `?shell` preview flag — all
  // at import or render time, so the shims cannot wait for a beforeAll().
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
  g.addEventListener = () => {}
  g.removeEventListener = () => {}
  g.window = globalThis
  g.location = { search: '', href: 'http://localhost/' }
  g.matchMedia = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  })
  g.document = { documentElement: { dir: 'ltr', lang: 'en' } }

  const state = { role: 'admin' as 'admin' | 'member', calls: [] as string[] }
  return { state }
})

vi.mock('../../api/supabase', () => ({ isConfigured: () => true, supabase: null }))

vi.mock('../../store/auth', () => ({
  useAuth: () => ({ profile: { id: 'me', role: fx.state.role } }),
}))

vi.mock('../../store/config', () => ({ invalidateConfig: () => {} }))

// Recording stubs, so a render that reached the network would be visible as a
// call rather than as a silent request in a test run.
vi.mock('../../api/map', () => {
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      fx.state.calls.push(`${name}(${args.join(',')})`)
      return Promise.resolve({ ok: false as const, error: 'common.error' })
    }
  return {
    listUseCases: record('listUseCases'),
    listMapNodeKinds: record('listMapNodeKinds'),
    listNodeUseCases: record('listNodeUseCases'),
    listMapNodes: record('listMapNodes'),
    createUseCase: record('createUseCase'),
    updateUseCase: record('updateUseCase'),
    deleteUseCase: record('deleteUseCase'),
    createMapNodeKind: record('createMapNodeKind'),
    updateMapNodeKind: record('updateMapNodeKind'),
    deleteMapNodeKind: record('deleteMapNodeKind'),
    reorderMapNodeKinds: record('reorderMapNodeKinds'),
  }
})

const CatalogueAdmin = (await import('./CatalogueAdmin')).default

/**
 * The screen's own source and its sheet, as text.
 *
 * `?raw` for the component (localeReach reads source the same way) but
 * `readFileSync` for the CSS: vitest stubs `.css` modules whatever query they
 * carry, so `import './catalogue.css?raw'` resolves to the empty string and
 * every assertion about the sheet passes vacuously. `NudgeButton.test.tsx` hit
 * this first and reads its sheet from disk for the same reason.
 *
 * The import specifier is a VARIABLE, exactly as NudgeButton.test.tsx and
 * mapMotion.test.ts write it: `tsconfig.app.json` carries no `node` types, so a
 * literal `import … from 'node:fs'` is a `tsc -b` error even though vitest runs
 * the file under Node.
 */
const NODE_FS = 'node:fs'
const { readFileSync } = (await import(NODE_FS)) as {
  readFileSync: (path: URL, encoding: 'utf8') => string
}
const SOURCE: string = (await import('./CatalogueAdmin.tsx?raw')).default
const SHEET: string = readFileSync(new URL('./catalogue.css', import.meta.url), 'utf8')

const EN = (await import('../../locales/en/catalogue.json')).default as Record<string, unknown>
const AR = (await import('../../locales/ar/catalogue.json')).default as Record<string, unknown>

const render = (role: 'admin' | 'member' = 'admin'): string => {
  fx.state.role = role
  fx.state.calls = []
  return renderToStaticMarkup(
    <MemoryRouter>
      <CatalogueAdmin />
    </MemoryRouter>,
  )
}

/* ─────────────────────────────── the gate ──────────────────────────────── */

describe('the admin gate', () => {
  it('renders nothing editable for a member', () => {
    const html = render('member')
    // The route is gated too (App.tsx bounces a member back to /settings); this
    // is the screen's own second copy, and the one that survives a deep link
    // arriving before the profile has loaded.
    expect(html).not.toContain('class="cat"')
    expect(html).not.toContain('cat-section')
    expect(html).not.toContain('cat-why')
  })

  it('renders the screen for an admin', () => {
    const html = render('admin')
    expect(html).toContain('class="cat"')
  })
})

/* ───────────────────────── the shell it first paints ───────────────────── */

describe('the first paint', () => {
  it('offers a way back, which is the only chrome linking these screens', () => {
    // /settings/catalogue is in neither nav — App.tsx's header names it and
    // this link is how a thumb gets out.
    const html = render()
    expect(html).toContain('href="/settings"')
  })

  it('carries no heading of its own', () => {
    // App.tsx's header already renders catalogue.title as the document h1 for
    // this route; a second copy is noise in the heading outline.
    expect(render()).not.toContain('<h1')
  })

  it('shows a skeleton, not an empty state, before the reads have answered', () => {
    // The difference matters: "no capabilities yet" is a claim about the
    // workspace, and making it while the request is still in flight tells an
    // admin their migration did not run.
    const html = render()
    expect(html).toContain('skeleton')
    expect(html).not.toContain('cat-list')
  })

  it('ships the live region before there is anything to announce', () => {
    // An aria-live region has to be in the accessibility tree BEFORE its
    // content changes; one that appears together with its first message is not
    // announced at all. Polite, because every message here follows a deliberate
    // action.
    const html = render()
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('role="status"')
  })

  it('reads nothing during render — the four fetches belong to an effect', () => {
    render()
    expect(fx.state.calls).toEqual([])
  })

  it('explains itself before it has any data to show', () => {
    // The intro sits OUTSIDE the loading guard on purpose: the paragraph that
    // says why this screen may delete when Vocabulary may not is the first
    // thing a reader needs, and gating it behind a fetch means the one reader
    // who arrives on a broken project never sees it.
    const html = render()
    expect(html).toContain('cat-why')
    expect(html).toContain('cat-intro-lead')
  })
})

/* ───────────────────────── the locale bundles ──────────────────────────── */

type Leaf = { plural: boolean; forms: Record<string, string> }

/** dot path → leaf. Nested objects recurse UNLESS they are plural nodes. */
function flatten(tree: Record<string, unknown>, prefix = '', out = new Map<string, Leaf>()) {
  for (const [k, v] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') out.set(path, { plural: false, forms: { other: v } })
    else if (isPluralNode(v)) out.set(path, { plural: true, forms: v as Record<string, string> })
    else flatten(v as Record<string, unknown>, path, out)
  }
  return out
}

const FLAT_EN = flatten(EN)
const FLAT_AR = flatten(AR)

/** The `{token}` set in a value. Order-independent — only membership matters. */
const tokensOf = (value: string): string[] =>
  [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('the catalogue namespace', () => {
  it('contains exactly its own root key, in both languages', () => {
    // The invariant src/locales/index.ts's flat spread depends on: a root
    // claimed by two files would be spread over and vanish with no error.
    expect(Object.keys(EN)).toEqual(['catalogue'])
    expect(Object.keys(AR)).toEqual(['catalogue'])
  })

  it('holds identical key sets in en and ar', () => {
    const en = [...FLAT_EN.keys()].sort()
    const ar = [...FLAT_AR.keys()].sort()
    // Reported as two diffs rather than one so a failure names the missing keys
    // instead of dumping both lists side by side.
    expect(en.filter((k) => !ar.includes(k))).toEqual([])
    expect(ar.filter((k) => !en.includes(k))).toEqual([])
  })

  it('has no empty value in either language', () => {
    const blank: string[] = []
    for (const [lang, flat] of [
      ['en', FLAT_EN],
      ['ar', FLAT_AR],
    ] as const) {
      for (const [key, leaf] of flat) {
        for (const [form, value] of Object.entries(leaf.forms)) {
          if (value.trim() === '') blank.push(`${lang}:${key}.${form}`)
        }
      }
    }
    expect(blank).toEqual([])
  })

  it('uses the same interpolation tokens in both languages', () => {
    // A `{name}` renamed on one side renders as literal braces at the user, in
    // one language only — the failure a native reader finds and a reviewer of
    // the other tree never can.
    const drifted: string[] = []
    for (const [key, en] of FLAT_EN) {
      const ar = FLAT_AR.get(key)
      if (!ar) continue
      const enTokens = [...new Set(Object.values(en.forms).flatMap(tokensOf))].sort()
      const arTokens = [...new Set(Object.values(ar.forms).flatMap(tokensOf))].sort()
      if (enTokens.join(',') !== arTokens.join(',')) {
        drifted.push(`${key}: en[${enTokens}] vs ar[${arTokens}]`)
      }
    }
    expect(drifted).toEqual([])
  })
})

describe('plural nodes', () => {
  // The catalogue counts three things — untranslated capabilities, the
  // organizations recorded against a capability, and the nodes carrying a kind
  // — and every one of them can legitimately be 1. "1 capabilities" is the
  // defect R3-I18N-1 found four live instances of.
  const EXPECTED: Readonly<Record<string, readonly string[]>> = {
    en: ['one', 'other'],
    ar: ['zero', 'one', 'two', 'few', 'many', 'other'],
  }

  it.each([
    ['en', FLAT_EN],
    ['ar', FLAT_AR],
  ] as const)('%s: ships exactly the forms the language can select', (lang, flat) => {
    const wrong: string[] = []
    for (const [key, leaf] of flat) {
      if (!leaf.plural) continue
      const forms = PLURAL_CATEGORIES.filter((c) => leaf.forms[c] !== undefined)
      if (forms.join(',') !== EXPECTED[lang].join(',')) wrong.push(`${key}: ${forms.join(',')}`)
    }
    expect(wrong).toEqual([])
  })

  it('carries {count} in every form that covers more than one number', () => {
    // ar `zero`/`one`/`two` each cover exactly one value and may write the word
    // out; `few` (3–10), `many` (11–99) and `other` cover ranges, so a form
    // without the number is a sentence that cannot say which.
    const RANGED: Readonly<Record<string, readonly string[]>> = {
      en: ['other'],
      ar: ['few', 'many', 'other'],
    }
    const bare: string[] = []
    for (const [lang, flat] of [
      ['en', FLAT_EN],
      ['ar', FLAT_AR],
    ] as const) {
      for (const [key, leaf] of flat) {
        if (!leaf.plural) continue
        for (const form of RANGED[lang]) {
          const value = leaf.forms[form]
          if (value !== undefined && !value.includes('{count}')) bare.push(`${lang}:${key}.${form}`)
        }
      }
    }
    expect(bare).toEqual([])
  })

  it('finds plural nodes at all, so the two assertions above are not vacuous', () => {
    expect([...FLAT_EN.values()].filter((l) => l.plural).length).toBeGreaterThanOrEqual(3)
  })
})

describe('bidi', () => {
  const FSI = '⁨'
  const PDI = '⁩'

  it('fences every {name} in BOTH trees', () => {
    // `{name}` is a use case or a kind, which an admin names in either script,
    // dropped into a sentence written in the other. Unfenced, a Latin name in
    // an Arabic sentence drags the comma and the full stop to the wrong side —
    // and, per bidi.test.ts, the en tree needs the same fence for the mirror
    // case. `name` is in that file's USER_VALUE_TOKENS, so this is the local
    // half of a gate that already runs tree-wide.
    const bare: string[] = []
    for (const [lang, flat] of [
      ['en', FLAT_EN],
      ['ar', FLAT_AR],
    ] as const) {
      for (const [key, leaf] of flat) {
        for (const [form, value] of Object.entries(leaf.forms)) {
          for (const m of value.matchAll(/\{name\}/g)) {
            const before = value.slice(0, m.index)
            const okBefore = /[⁦-⁨]$/.test(before)
            const okAfter = value.startsWith(PDI, m.index + '{name}'.length)
            if (!okBefore || !okAfter) bare.push(`${lang}:${key}.${form} :: ${value}`)
          }
        }
      }
    }
    expect(bare).toEqual([])
  })

  it('never leaves an isolate open', () => {
    // An unclosed FSI reorders every character after it, to the end of the
    // paragraph — the one direction failure that escapes the string it is in.
    const broken: string[] = []
    for (const [lang, flat] of [
      ['en', FLAT_EN],
      ['ar', FLAT_AR],
    ] as const) {
      for (const [key, leaf] of flat) {
        for (const value of Object.values(leaf.forms)) {
          let depth = 0
          for (const ch of value) {
            if (ch >= '⁦' && ch <= '⁨') depth += 1
            else if (ch === PDI) depth -= 1
            if (depth < 0) break
          }
          if (depth !== 0) broken.push(`${lang}:${key}`)
        }
      }
    }
    expect(broken).toEqual([])
  })

  it('fences the Latin runs inside the Arabic prose', () => {
    // Not machine-derivable in general, so it is pinned where it matters: the
    // use-case hint is the one Arabic sentence carrying Latin capability names,
    // and unfenced they reorder the guillemets around them.
    const hint = (FLAT_AR.get('catalogue.useCasesHint') as Leaf).forms.other
    expect(hint).toContain(`${FSI}HL7/FHIR${PDI}`)
    expect(hint).toContain(`${FSI}Medication Prescribe V2${PDI}`)
  })
})

/* ─────────────── the strings the screen actually asks for ──────────────── */

/** Every quoted `catalogue`-namespace literal in the component's own source. */
const REQUESTED = [...new Set([...SOURCE.matchAll(/'(catalogue\.[A-Za-z0-9_.]+)'/g)].map((m) => m[1]))]

describe('reach', () => {
  it('asks for a plausible number of keys, so the scan cannot pass by matching nothing', () => {
    expect(REQUESTED.length).toBeGreaterThan(30)
  })

  it('every key the screen asks for exists in BOTH bundles', () => {
    // localeReach.test.ts cannot see this yet — its ROOTS set comes from the
    // MERGED bundles, and `catalogue` joins them when the integrator wires
    // src/locales/index.ts. Until then this is the gate.
    const missing = REQUESTED.filter((k) => !FLAT_EN.has(k) || !FLAT_AR.has(k)).sort()
    expect(missing).toEqual([])
  })

  it('ships no string the screen never renders', () => {
    // The other direction, which localeReach does not check for any namespace:
    // a key nobody asks for is a sentence the Terminology screen offers an
    // admin to rename with no effect anywhere.
    //
    // THREE EXEMPTIONS, named rather than pattern-matched, because each is read
    // by a file this worker does not own and would otherwise have to live in a
    // namespace somebody else owns instead — which is worse, since a `settings`
    // key describing this screen drifts the moment this screen changes.
    //
    //   title        — the route's document title (src/lib/routeTitle.ts,
    //                  rendered as the h1 by src/App.tsx).
    //   settingsHint — the line under the Settings card (src/pages/Settings.tsx).
    //   manage       — that card's link label. `groups.settingsHint` and
    //                  `groups.manage` are the precedent, key for key.
    //
    // If the integrator does not wire the route and the card, these three go
    // unread — and localeParity's orphan rule is where that shows up once the
    // namespace is registered, not here.
    const ELSEWHERE = ['catalogue.title', 'catalogue.settingsHint', 'catalogue.manage']
    const orphans = [...FLAT_EN.keys()]
      .filter((k) => !ELSEWHERE.includes(k) && !REQUESTED.includes(k))
      .sort()
    expect(orphans).toEqual([])
  })
})

/* ────────────────── the decisions this screen encodes ──────────────────── */

describe('the two lists are asymmetrical, and deliberately so', () => {
  it('offers no reorder on use cases, because 0024 ships no RPC for it', () => {
    // api/map.ts's own header records the gap and names
    // `reorder_use_cases(p_ids uuid[])` in the handoff. Up/down here would have
    // to be N PATCHes, and a half-applied reorder leaves two rows sharing a
    // position — the argument every reorder in this codebase rests on. When the
    // RPC lands, this is the line that changes.
    expect(SOURCE).toContain('onMove: null')
    expect(SOURCE).toContain("catalogue.useCasesOrderNote")
  })

  it('offers no Hide on kinds, because map_node_kinds has no such column', () => {
    expect(SOURCE).toContain('onHide: null')
    expect(SOURCE).toContain("catalogue.kindsNoHide")
  })

  it('counts a use case’s organizations before offering the delete', () => {
    // The requirement in one line: the refusal must arrive as a sentence naming
    // how many organizations still have it, not as a raw 23503 after the click.
    expect(SOURCE).toContain('catalogue.inUseBlocks')
    expect(SOURCE).toContain('catalogue.inUse')
    // And the server error is still mapped, for the delete that raced another
    // session between the count and the click.
    expect(SOURCE).toContain('failRow(id, result.error)')
  })

  it('treats an uncounted usage as unknown, never as zero', () => {
    // A failed count that degraded to 0 would offer a Delete on a capability
    // twelve hospitals are recorded against.
    expect(SOURCE).toContain('catalogue.usageUnknown')
    expect(SOURCE).toContain('setUseCaseUsage(null)')
    expect(SOURCE).toContain('setKindUsage(null)')
  })
})

describe('the header says why this screen may delete', () => {
  it('renders the paragraph, and the paragraph names the other screen', () => {
    // Without this sentence the next reader assumes one of the two admin
    // screens is wrong. It has to name Vocabulary AND the reason — the
    // append-only update thread — or it is a claim rather than an argument.
    const why = (FLAT_EN.get('catalogue.whyEditable') as Leaf).forms.other
    expect(why).toContain('Vocabulary')
    expect(why.toLowerCase()).toContain('append-only')
    expect(render()).toContain('cat-why')
  })

  it('says that hiding is not deleting, and what hiding leaves alone', () => {
    const hide = (FLAT_EN.get('catalogue.hideVsDelete') as Leaf).forms.other
    expect(hide.toLowerCase()).toContain('pickers')
    expect(hide.toLowerCase()).toContain('keeps it')
  })

  it('says a blank Arabic name is a job rather than a fault', () => {
    // Ten seeded capabilities ship with name_ar = '' on purpose. Left
    // unexplained, an empty field reads as a failed read.
    const hint = (FLAT_EN.get('catalogue.needsArabicHint') as Leaf).forms.other
    expect(hint.toLowerCase()).toContain('on purpose')
    expect(SOURCE).toContain('catalogue.arabicPending')
    expect(SOURCE).toContain('catalogue.needsArabic')
  })
})

/* ─────────────────────────────── the sheet ─────────────────────────────── */

// The title is NOT the bare sheet filename: `catalogue` is a locale root now,
// so the quoted filename is key-shaped and localeReach.test.ts would ask both
// bundles for it. The parenthesised form is not a match for that scan.
describe('the stylesheet (catalogue css)', () => {
  it('uses logical properties only, so the Arabic mirror comes free', () => {
    // The standing grep, scoped to this sheet and including comments: a rule
    // written with a physical inline edge unindents in Arabic.
    const physical = SHEET.match(
      /(padding|margin|border)-(left|right)\s*:|(^|[{;\s])(left|right)\s*:/gm,
    )
    expect(physical).toBeNull()
  })

  it('claims the .cat- prefix and nothing else', () => {
    // §1.0.7: each co-located sheet owns exactly one prefix and may not style
    // another's, nor a global.css primitive.
    const foreign = [...SHEET.matchAll(/^\.([a-z][a-z0-9-]*)/gm)]
      .map((m) => m[1])
      .filter((c) => c !== 'cat' && !c.startsWith('cat-'))
    expect([...new Set(foreign)]).toEqual([])
  })

  it('keeps every reorder control at a 44px touch target', () => {
    expect(SHEET).toContain('min-inline-size: 44px')
  })
})
