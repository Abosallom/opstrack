// The locale REACHABILITY gate — the other half of localeParity.test.ts.
//
// WHY BOTH TESTS EXIST, AND WHY PARITY ALONE IS NOT ENOUGH.
//
// localeParity.test.ts compares the two trees to each other: same keys, same
// tokens, no empties. It is blind to the one failure that actually reaches a
// user, because that failure is symmetric — a screen asking for a key that
// exists in NEITHER tree. Parity is delighted; t() falls back to echoing its own
// argument; and the release ships a fieldset legend reading
// "admin.tracks.slaOverrides" in both languages.
//
// That is not hypothetical. It is exactly what the Wave-2 SLA work shipped:
// eight `admin.tracks.sla*` keys were written into TrackEditor.tsx while
// `admin.json` sat in the integrator-owned namespace set (§1.0.2), so the
// worker correctly did not add them and the gap rode a truncated handoff note
// all the way to the integration pass. Parity was green the whole time. This
// test is the mechanism that would have caught it on the worker's own machine.
//
// HOW IT LOOKS FOR KEYS. Not by matching `t('…')` — that regex misses every
// interesting case: the ternary inside a t() call, the key held in a
// `Record<Tone, string>` map, the array of problem keys the parser returns for
// its caller to translate later. Instead it takes EVERY quoted dotted string in
// the source tree whose first segment is a real namespace root, which catches
// all of those and costs one allowlist entry for the rare non-key that happens
// to look like one.
//
// WHAT IT CANNOT SEE: `t(`health.${level}`)`. A template literal has no key
// until it runs, so the four families built that way are enumerated explicitly
// in the second block below, from the frozen unions in types.ts. Adding a
// member to one of those unions without adding its label is the same bug in a
// shape this file's regex can never find, so the enumeration is checked in both
// directions — a locale entry with no union member behind it is dead weight and
// fails too.
//
// Source is read through import.meta.glob('?raw'), not node:fs, on purpose:
// tsconfig.app.json pins `types: ["vite/client"]`, and widening it to include
// "node" would leak node globals into the type space of every app file — the
// thing W1-I18N set that array to prevent.

import { describe, expect, it } from 'vitest'
import { ar, en, type LocaleTree } from '../locales'
import { isPluralNode } from './plural'
import { TRACK_ICON_NAMES } from './trackIcons'

/* ─────────────────────────── the two key sets ─────────────────────────── */

/**
 * Every path a caller may ask t() for.
 *
 * A PLURAL NODE TERMINATES THE WALK. `t('offline.pending', { count })` asks for
 * that path, never for `offline.pending.one` — the form is chosen at runtime by
 * lib/plural.ts. Recursing into the node instead would record six keys nobody
 * asks for and, fatally, would NOT record the one key everybody does, so every
 * pluralized string in the app would report as missing.
 */
function flatten(tree: LocaleTree, prefix = '', out: Set<string> = new Set()): Set<string> {
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string' || isPluralNode(v)) out.add(key)
    else flatten(v, key, out)
  }
  return out
}

const EN_KEYS = flatten(en)
const AR_KEYS = flatten(ar)
const ROOTS = new Set([...EN_KEYS].map((k) => k.slice(0, k.indexOf('.'))))

/* ───────────────────────────── the source scan ────────────────────────── */

// Eager + ?raw: the whole app as text, at module scope, once. `import` picks the
// default export of the ?raw module, which is the file's contents.
const SOURCES: Record<string, string> = import.meta.glob('../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
})

/**
 * Quoted strings shaped like `namespace.some.key`.
 *
 * Anchored with the quote on both ends so a sentence containing a full stop
 * cannot match, and the first segment must be lowerCamel — every namespace root
 * is, and requiring it drops URLs, file paths and `Object.keys` chains.
 */
const KEYISH = /(['"])([a-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)\1/g

/**
 * Dotted literals that are deliberately NOT keys.
 *
 * Keep this list at zero-or-near-zero. Every entry is a place where a reader
 * has to know that a key-shaped string is not a key, so a new one needs a
 * reason written next to it.
 */
const NOT_KEYS = new Set<string>([
  // A prefix test, not a lookup: Capture.tsx tints a parser problem red when
  // its key starts with 'capture.err' and grey otherwise.
  'capture.err',
])

/** Files whose key-shaped strings are documentation rather than requests. */
function scanned(path: string): boolean {
  if (path.startsWith('../locales/')) return false
  // This file's own allowlist and prose are full of key-shaped strings.
  if (path.endsWith('/localeReach.test.ts')) return false
  // The parity test carries all 213 baseline keys as a fixture; they are
  // already asserted there, and re-scanning them here proves nothing.
  if (path.endsWith('/localeParity.test.ts')) return false
  return true
}

function requestedKeys(): Map<string, Set<string>> {
  const asked = new Map<string, Set<string>>()
  for (const [path, src] of Object.entries(SOURCES)) {
    if (!scanned(path)) continue
    for (const m of src.matchAll(KEYISH)) {
      const key = m[2]
      if (NOT_KEYS.has(key)) continue
      if (!ROOTS.has(key.slice(0, key.indexOf('.')))) continue
      const where = asked.get(key) ?? new Set<string>()
      where.add(path.replace('../', 'src/'))
      asked.set(key, where)
    }
  }
  return asked
}

describe('locale reachability', () => {
  it('scans a plausible amount of source', () => {
    // A glob that silently resolved to nothing would make every assertion below
    // vacuously true — the classic way a static-analysis test rots into a no-op.
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50)
    expect(requestedKeys().size).toBeGreaterThan(300)
  })

  it('every key the app asks for resolves in BOTH bundles', () => {
    const unresolved: string[] = []
    for (const [key, where] of requestedKeys()) {
      const missing = [!EN_KEYS.has(key) && 'en', !AR_KEYS.has(key) && 'ar'].filter(Boolean)
      if (missing.length > 0) {
        unresolved.push(`${key} — missing from ${missing.join('+')} — used in ${[...where].join(', ')}`)
      }
    }
    expect(unresolved.sort()).toEqual([])
  })
})

/* ──────────────────── families built by template literal ──────────────── */

/**
 * key → the exact member list, mirroring the frozen unions in types.ts.
 *
 * These are the four `t(\`ns.${value}\`)` call sites in the app. The unions are
 * frozen by contract (0003's vocabulary tables rename the LABELS, never the
 * keys), so a hardcoded list here is a faithful mirror rather than a
 * duplication that can drift silently — and the exact-match assertion below
 * fails the moment it does drift in either direction.
 */
const FAMILIES: Record<string, readonly string[]> = {
  // t(`${kind}.${key}`) in store/vocab.ts
  status: ['new', 'in_progress', 'blocked', 'waiting_on', 'done', 'cancelled'],
  priority: ['low', 'medium', 'high', 'critical'],
  type: ['action', 'decision', 'issue', 'request', 'change', 'escalation', 'note'],
  // t(`health.${level}`) in components/entry/atoms.tsx and components/FilterBar.tsx
  health: ['ok', 'stale', 'overdue', 'critical'],
}

describe('dynamic key families', () => {
  for (const [ns, members] of Object.entries(FAMILIES)) {
    it(`${ns}.* covers exactly its union, in both languages`, () => {
      for (const [lang, keys] of [
        ['en', EN_KEYS],
        ['ar', AR_KEYS],
      ] as const) {
        const present = [...keys].filter((k) => k.startsWith(`${ns}.`)).sort()
        expect(present, lang).toEqual(members.map((m) => `${ns}.${m}`).sort())
      }
    })
  }

  it('every track icon has a name in both languages', () => {
    // t(`admin.tracks.icon_${name}`) in pages/settings/TrackEditor.tsx — the
    // picker's only accessible label, so an unnamed icon is a radio announced
    // as its own identifier.
    const missing: string[] = []
    for (const name of TRACK_ICON_NAMES) {
      const key = `admin.tracks.icon_${name}`
      if (!EN_KEYS.has(key)) missing.push(`en:${key}`)
      if (!AR_KEYS.has(key)) missing.push(`ar:${key}`)
    }
    expect(missing).toEqual([])
  })

  it('every follow-ups section has a heading and a hint in both languages', () => {
    // t(`followups.${s.key}`) + t(`followups.${s.key}Hint`) in pages/FollowUps.tsx,
    // keyed by FollowUpSections in lib/entrySections.ts.
    const sections = ['overdue', 'slaBreach', 'dueSoon', 'stale', 'blocked', 'unassigned']
    const missing: string[] = []
    for (const s of sections) {
      for (const key of [`followups.${s}`, `followups.${s}Hint`]) {
        if (!EN_KEYS.has(key)) missing.push(`en:${key}`)
        if (!AR_KEYS.has(key)) missing.push(`ar:${key}`)
      }
    }
    expect(missing).toEqual([])
  })
})
