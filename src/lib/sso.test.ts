// Entra SSO, the parts a node environment can prove — plus the locale check that
// the two new namespaces cannot get from the shared gates yet.
//
// THE REDIRECT IS THE POINT. Everything else in the SSO path fails loudly; the
// redirect fails by SUCCEEDING at Microsoft and then silently producing no
// session, because a fragment in `redirectTo` collides with the fragment GoTrue
// appends. `redirectFromBase` is the whole defence and it is asserted here
// against every URL shape this app is served from.

import { describe, expect, it } from 'vitest'
import { AZURE_PROVIDER, parseAuthSettings, providerEnabled, redirectFromBase } from './sso'
import enPush from '../locales/en/push.json'
import arPush from '../locales/ar/push.json'
import enSso from '../locales/en/sso.json'
import arSso from '../locales/ar/sso.json'

describe('redirectFromBase', () => {
  it('drops the hash route, which is the bug that loses the session', () => {
    // `…/opstrack/#/signin` + GoTrue's `#access_token=…` would be ONE fragment
    // reading `/signin#access_token=…`, which supabase-js parses as a parameter
    // named `/signin#access_token` and therefore finds no session at all.
    expect(redirectFromBase('https://abosallom.github.io/opstrack/#/signin')).toBe(
      'https://abosallom.github.io/opstrack/',
    )
  })

  it('keeps the GitHub Pages subpath', () => {
    // A bare origin lands on the user's Pages root, which is a different site.
    expect(redirectFromBase('https://abosallom.github.io/opstrack/')).toBe(
      'https://abosallom.github.io/opstrack/',
    )
  })

  it('drops a filename', () => {
    expect(redirectFromBase('https://abosallom.github.io/opstrack/index.html')).toBe(
      'https://abosallom.github.io/opstrack/',
    )
  })

  it('handles the dev server and a deep hash route together', () => {
    expect(redirectFromBase('http://localhost:5173/#/settings/notifications')).toBe(
      'http://localhost:5173/',
    )
  })

  it('drops a query string as well as the fragment', () => {
    expect(redirectFromBase('https://host.example/app/?shell#/board')).toBe(
      'https://host.example/app/',
    )
  })

  it('answers empty for an unparseable base instead of throwing', () => {
    // An empty redirectTo makes Supabase fall back to the project's Site URL,
    // which for this app is the correct destination anyway.
    expect(redirectFromBase('not a url')).toBe('')
  })
})

describe('parseAuthSettings', () => {
  it('reads the provider map from the real settings shape', () => {
    // Trimmed copy of the live /auth/v1/settings body for this project.
    const body = {
      external: { azure: false, email: true, google: false },
      disable_signup: true,
      saml_enabled: false,
    }
    const settings = parseAuthSettings(body)
    expect(providerEnabled(settings, AZURE_PROVIDER)).toBe(false)
    expect(providerEnabled(settings, 'email')).toBe(true)
  })

  it('sees azure once the dashboard toggle is on', () => {
    expect(providerEnabled(parseAuthSettings({ external: { azure: true } }), 'azure')).toBe(true)
  })

  it.each([[null], [undefined], [42], ['nope'], [{}], [{ external: null }], [{ external: 7 }]])(
    'answers "nothing enabled" for %j rather than throwing',
    (body) => {
      // This runs on the sign-in screen. A parse error there would replace the
      // only way into the app with an error boundary.
      expect(providerEnabled(parseAuthSettings(body), 'azure')).toBe(false)
    },
  )

  it('ignores non-boolean provider values', () => {
    const settings = parseAuthSettings({ external: { azure: 'true' } })
    expect(providerEnabled(settings, 'azure')).toBe(false)
  })
})

/* ───────────────── the two namespaces the shared gates cannot see yet ─────── */
//
// WHY THIS BLOCK IS HERE. `localeParity.test.ts` and `localeReach.test.ts` walk
// `src/locales/index.ts`, and that file is INTEGRATOR-ONLY (plan §1.0.2) — so
// until it registers `push` and `sso`, neither gate reads a single one of these
// strings and both stay green while the screens render dot paths. That is exactly
// the failure localeReach.test.ts's own header describes: the Wave-2 SLA keys sat
// in an unregistered namespace and rode a truncated handoff note into production.
//
// So these files are imported DIRECTLY here, and the checks below are the two the
// shared gates would apply. The moment the integrator adds the four lines to
// index.ts, both namespaces come under the real gates and this block becomes a
// duplicate — and harmless.

type Tree = { [k: string]: string | Tree }

function flatten(tree: Tree, prefix = '', out: Map<string, string> = new Map()) {
  for (const [k, v] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') out.set(path, v)
    else flatten(v, path, out)
  }
  return out
}

const tokensOf = (value: string): string[] =>
  [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe.each([
  ['push', enPush as Tree, arPush as Tree],
  ['sso', enSso as Tree, arSso as Tree],
])('%s locale files', (ns, en, ar) => {
  it('each contain exactly their own root key', () => {
    expect(Object.keys(en)).toEqual([ns])
    expect(Object.keys(ar)).toEqual([ns])
  })

  it('hold identical key sets', () => {
    const enKeys = [...flatten(en).keys()].sort()
    const arKeys = [...flatten(ar).keys()].sort()
    expect(enKeys.filter((k) => !arKeys.includes(k))).toEqual([])
    expect(arKeys.filter((k) => !enKeys.includes(k))).toEqual([])
  })

  it('have no empty values', () => {
    for (const [lang, tree] of [
      ['en', en],
      ['ar', ar],
    ] as const) {
      expect(
        [...flatten(tree)].filter(([, v]) => v.trim() === '').map(([k]) => `${lang}:${k}`),
      ).toEqual([])
    }
  })

  it('use the same interpolation tokens in both languages', () => {
    const arFlat = flatten(ar)
    const mismatched: string[] = []
    for (const [key, value] of flatten(en)) {
      const other = arFlat.get(key)
      if (other === undefined) continue
      if (tokensOf(value).join(',') !== tokensOf(other).join(',')) mismatched.push(key)
    }
    expect(mismatched).toEqual([])
  })

  it('fence every user-value interpolation with bidi isolates', () => {
    // The rule bidi.test.ts applies to the registered tree, applied here to the
    // unregistered one: `{email}`, `{name}` and `{date}` all carry values whose
    // first strong character can disagree with the sentence around them. A bare
    // `{email}` in an Arabic sentence renders the address on the wrong side of
    // its own punctuation.
    const FENCED = new Set(['date', 'name', 'email'])
    const bare: string[] = []
    for (const [lang, tree] of [
      ['en', en],
      ['ar', ar],
    ] as const) {
      for (const [key, value] of flatten(tree)) {
        for (const m of value.matchAll(/\{(\w+)\}/g)) {
          if (!FENCED.has(m[1])) continue
          const before = value.slice(0, m.index)
          const after = value.slice(m.index + m[1].length + 2)
          if (!/[⁦-⁨]$/.test(before) || !after.startsWith('⁩')) {
            bare.push(`${lang}:${key} {${m[1]}}`)
          }
        }
      }
    }
    expect(bare).toEqual([])
  })
})

describe('the keys the new screens ask for', () => {
  // The localeReach check, scoped to the files that own these two namespaces.
  // Source is read through import.meta.glob('?raw') for the reason that test
  // states: tsconfig.app.json pins `types: ["vite/client"]`, and reaching for
  // node:fs would leak node globals into every app file's type space.
  const SOURCES: Record<string, string> = import.meta.glob(
    [
      '../components/SsoButtons.tsx',
      '../pages/settings/NotificationPrefs.tsx',
      '../store/push.ts',
      './push.ts',
      './sso.ts',
    ],
    { query: '?raw', import: 'default', eager: true },
  )

  const KEYISH = /(['"])((?:push|sso)(?:\.[A-Za-z0-9_]+)+)\1/g

  it('scans the files it claims to scan', () => {
    // A glob that resolved to nothing would make the assertion below vacuous.
    expect(Object.keys(SOURCES).length).toBe(5)
  })

  it('all resolve in both languages', () => {
    const en = new Map([...flatten(enPush as Tree), ...flatten(enSso as Tree)])
    const ar = new Map([...flatten(arPush as Tree), ...flatten(arSso as Tree)])
    const missing: string[] = []
    for (const [path, src] of Object.entries(SOURCES)) {
      for (const m of src.matchAll(KEYISH)) {
        const key = m[2]
        if (!en.has(key)) missing.push(`en:${key} (${path})`)
        if (!ar.has(key)) missing.push(`ar:${key} (${path})`)
      }
    }
    expect([...new Set(missing)].sort()).toEqual([])
  })
})
