// The brand gate.
//
// WHAT WENT WRONG WITHOUT IT. The OpsTrack → CoreTrack rename shipped in two
// halves. The first commit did `app.name`, `index.html` and the PWA manifest and
// stopped there, so the sign-in screen rendered its own brand row from
// `t('app.name')` as **CoreTrack** and its `<h2>` from `signin.heading` as
// **"Sign in to OpsTrack"** — two different product names, eight pixels apart, on
// the first screen anyone sees. Eleven more strings were stranded the same way
// across `push`, `digest` and `sso`, in both languages. (`sso` no longer exists:
// WAVE5-NOTES §2 cancelled the Microsoft Entra path in the same wave, and its four
// stranded strings left with the namespace rather than being fixed twice. The
// other seven are why the two `it.each(FORBIDDEN)` cases below are worth having.)
//
// Nothing reported it. localeParity compares the two trees to each other and both
// were wrong identically; localeReach compares keys to call sites and every key
// was reached; bidi.test.ts reads direction, not words. A rename is invisible to
// every gate that inspects STRUCTURE, because a half-renamed tree is structurally
// perfect. Only a check that reads the VALUES can see it, which is this file.
//
// WHY IT IS PERMANENT rather than a one-off script. The rename is not finished —
// docs/WAVE5-NOTES.md §1 defers a second, larger cut to launch, when the repo, the
// Pages URL, the storage keys, the CSS prefixes, the bundle id and the
// `@opstrack.internal` auth domain all move together under the launch name. That
// cut will strand strings in exactly the same way unless something is standing
// here when it lands.
//
// SCOPE: the shipped locale trees, which is every string a user can read. The old
// slug survives on purpose in identifiers that are not strings a user reads —
// `opstrack_*` cache keys, the `opstrack-live` realtime channel, the export
// envelope's `format`, the `opstrack` notification tag, applied migrations. Those
// are deliberately out of scope; see §1 of the notes for why each one waits.

import { describe, expect, it } from 'vitest'
import { AR_NAMESPACES, EN_NAMESPACES, type LocaleTree } from '../locales'
import { isPluralNode } from './plural'

/** The name the product ships under today. */
const BRAND = 'CoreTrack'

/**
 * Names that must not appear in any user-visible string.
 *
 * `OpsTrack` is the retired one. The launch name is the more interesting entry:
 * WAVE5-NOTES §1 says it arrives with the launch cut and must not be used
 * anywhere before then, and a name that is written down in a spec but forbidden
 * in the product is precisely the kind of instruction that leaks in by accident
 * — one worker reads "the official launch name is X" and helpfully uses X. It is
 * matched case-insensitively so a stylisation cannot slip past.
 */
const FORBIDDEN: readonly string[] = ['OpsTrack', 'NphiesCore']

/** Every leaf string in a namespace, as `key → value`, plural forms included. */
function strings(tree: LocaleTree, prefix = '', out: [string, string][] = []): [string, string][] {
  for (const [k, v] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') out.push([path, v])
    else if (isPluralNode(v)) for (const [c, form] of Object.entries(v)) out.push([`${path}.${c}`, form])
    else strings(v, path, out)
  }
  return out
}

function flatten(namespaces: Readonly<Record<string, LocaleTree>>): [string, string][] {
  return Object.values(namespaces).flatMap((tree) => strings(tree))
}

const AR_STRINGS = flatten(AR_NAMESPACES)
const EN_STRINGS = flatten(EN_NAMESPACES)

const TREES = [
  ['ar', AR_STRINGS],
  ['en', EN_STRINGS],
] as const

/**
 * One key's value, or `undefined` if it does not resolve.
 *
 * Read out of the flattened list rather than off the imported bundle, because
 * `LocaleTree` is `string | LocaleTree` at every level and `en.app.name` does
 * not typecheck without a cast. A cast here would be a cast around the exact
 * thing this file is asserting.
 */
function valueAt(strings: readonly [string, string][], key: string): string | undefined {
  return strings.find(([k]) => k === key)?.[1]
}

describe.each(TREES)('%s locale tree', (_locale, STRINGS) => {
  it('reads a plausible number of strings', () => {
    // A flattener that silently returned nothing would make the assertions below
    // vacuously true — the failure mode that would let a half-renamed tree ship
    // behind a green gate, which is the exact thing this file exists to stop.
    expect(STRINGS.length).toBeGreaterThan(500)
  })

  it.each(FORBIDDEN)('never says %s', (name) => {
    const needle = name.toLowerCase()
    const found = STRINGS.filter(([, v]) => v.toLowerCase().includes(needle)).map(
      ([k, v]) => `${k} :: ${v}`,
    )
    expect(found.sort()).toEqual([])
  })

  it('says CoreTrack wherever it names the product at all', () => {
    // The mirror of the check above, and not redundant with it: a rename that
    // DELETED the product name instead of replacing it would pass "never says
    // OpsTrack" while leaving `signin.heading` as a bare "Sign in". At least the
    // sign-in heading, the push subtitle and the digest footer name the product,
    // and those three are the surfaces the split rename actually stranded.
    const named = STRINGS.filter(([, v]) => v.includes(BRAND)).map(([k]) => k)
    expect(named).toContain('signin.heading')
    expect(named).toContain('push.subtitle')
    expect(named).toContain('digest.footer')
  })
})

describe('app.name', () => {
  it('is CoreTrack in both bundles', () => {
    // The one key the whole shell renders its brand row from, pinned by value
    // rather than by parity — parity would be satisfied by both bundles being
    // wrong together, which is how the mixed-brand screen shipped.
    expect(valueAt(EN_STRINGS, 'app.name')).toBe(BRAND)
    expect(valueAt(AR_STRINGS, 'app.name')).toBe(BRAND)
  })

  it('is not translated', () => {
    // A product name is a proper noun. The Arabic bundle transliterating it
    // would give the app two names in one release, which is the failure this
    // whole file is about, arriving through the translation rather than the
    // rename.
    expect(valueAt(AR_STRINGS, 'app.name')).toBe(valueAt(EN_STRINGS, 'app.name'))
  })
})
