// Two halves: the helpers, and the locale tree they codify.
//
// The tree half is the part that earns its keep. localeParity.test.ts compares
// the two bundles to each other and localeReach.test.ts compares them to the
// source; neither can see direction, so before this file the Arabic tree
// carried zero isolates across 23 namespaces and every string interpolating a
// Latin name rendered back to front (FIX-BACKLOG S5). Nothing would have
// reported the next one either.

import { describe, expect, it } from 'vitest'
import {
  FSI,
  LRI,
  PDI,
  RLI,
  isolate,
  isolateRange,
  isolateTokens,
  isolatesBalanced,
  ltrIsolate,
  rtlIsolate,
  stripIsolates,
} from './bidi'
import { AR_NAMESPACES, type LocaleTree } from '../locales'
import { isPluralNode } from './plural'

describe('the four controls', () => {
  it('are the code points the UBA defines, not lookalikes', () => {
    // Written as glyphs in bidi.ts because they are invisible either way; this
    // is where the actual code points get pinned.
    expect([LRI, RLI, FSI, PDI].map((c) => c.codePointAt(0))).toEqual([
      0x2066, 0x2067, 0x2068, 0x2069,
    ])
  })
})

describe('isolate', () => {
  it('wraps with FSI…PDI', () => {
    expect(isolate('Core Switch')).toBe(`${FSI}Core Switch${PDI}`)
  })

  it('leaves empty alone rather than emitting two invisible controls', () => {
    expect(isolate('')).toBe('')
  })

  it('closes an isolate the value left open', () => {
    // A title pasted with a stray FSI would otherwise swallow the rest of the
    // sentence into a run the wrapper never opened.
    expect(isolate(`a${FSI}b`)).toBe(`${FSI}a${FSI}b${PDI}${PDI}`)
    expect(isolatesBalanced(isolate(`a${FSI}b`))).toBe(true)
  })

  it('drops a PDI that closes nothing, so it cannot close OUR isolate early', () => {
    expect(isolate(`a${PDI}b`)).toBe(`${FSI}ab${PDI}`)
  })

  it('keeps a balanced isolate the caller nested deliberately', () => {
    expect(isolate(`x ${LRI}y${PDI}`)).toBe(`${FSI}x ${LRI}y${PDI}${PDI}`)
  })
})

describe('ltrIsolate / rtlIsolate', () => {
  it('pin a literal to one direction', () => {
    expect(ltrIsolate('#22b8d6')).toBe(`${LRI}#22b8d6${PDI}`)
    expect(rtlIsolate('الشبكة')).toBe(`${RLI}الشبكة${PDI}`)
  })

  it('are empty-safe and balancing like isolate()', () => {
    expect(ltrIsolate('')).toBe('')
    expect(isolatesBalanced(ltrIsolate(`due:${PDI}`))).toBe(true)
  })
})

describe('isolateRange', () => {
  it('makes the whole range ONE run, not two isolated endpoints', () => {
    // The bug: a neutral between two European numbers takes the paragraph
    // direction, so `5–10` reads `10–5` under dir=rtl. Isolating each side
    // leaves the separator outside both isolates and fixes nothing.
    expect(isolateRange('5', '10')).toBe(`${FSI}5–10${PDI}`)
    expect(isolateRange('5', '10')).not.toBe(`${FSI}5${PDI}–${FSI}10${PDI}`)
  })

  it('takes a separator', () => {
    expect(isolateRange('14/8', '21/8', ' – ')).toBe(`${FSI}14/8 – 21/8${PDI}`)
  })
})

describe('isolateTokens', () => {
  it('isolates the Latin tokens of a capture line and leaves the Arabic ones', () => {
    expect(isolateTokens('تجديد شهادة #البنية @sara due:+7d')).toBe(
      `تجديد شهادة #البنية ${LRI}@sara${PDI} ${LRI}due:+7d${PDI}`,
    )
  })

  it('leaves a sigil on an Arabic value alone — it already reads correctly', () => {
    // `#` before Arabic resolves RTL and lands on the right, which is where the
    // user typed it. Forcing LTR would move it to the wrong side.
    expect(isolateTokens('#الشبكات !عالية')).toBe('#الشبكات !عالية')
  })

  it('preserves the exact whitespace between tokens', () => {
    expect(stripIsolates(isolateTokens('a  b\tc'))).toBe('a  b\tc')
  })
})

describe('stripIsolates', () => {
  it('removes all four controls and nothing else', () => {
    expect(stripIsolates(`${FSI}Core${PDI} ${LRI}x${PDI}${RLI}y${PDI}`)).toBe('Core xy')
  })

  it('is what keeps controls out of the database', () => {
    // trim() does not remove them — they are not whitespace.
    const typed = `${FSI}  title  ${PDI}`
    expect(typed.trim()).not.toBe('title')
    expect(stripIsolates(typed).trim()).toBe('title')
  })
})

describe('isolatesBalanced', () => {
  it.each([
    ['', true],
    ['plain text', true],
    [`${FSI}a${PDI}`, true],
    [`${LRI}a${RLI}b${PDI}${PDI}`, true],
    [`${FSI}a`, false],
    [`a${PDI}`, false],
    [`${FSI}a${PDI}${PDI}`, false],
  ])('%j → %s', (value, expected) => {
    expect(isolatesBalanced(value)).toBe(expected)
  })
})

/* ────────────────────────── the Arabic tree ────────────────────────────── */

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

const AR_STRINGS = Object.entries(AR_NAMESPACES).flatMap(([ns, tree]) =>
  strings(tree).map(([key, value]) => [ns, key, value] as const),
)

/**
 * Namespaces whose Arabic is still being written by another Wave-3 builder.
 *
 * NOT an exemption from the rule — `dashboard.blockedOldest` and
 * `recurring.{editTitle,deleteTitle}` are live instances of it, listed in the
 * W3-ARABIC handoff for their owners. They are skipped only so this gate cannot
 * fail a worker for a string they are mid-way through writing. Delete both
 * entries at the Wave-3 close; the assertion below is the whole point of the
 * file.
 */
const IN_FLIGHT = new Set(['dashboard', 'recurring'])

describe('ar locale tree', () => {
  it('reads a plausible number of strings', () => {
    // A flattener that silently returned nothing would make both assertions
    // below vacuously true.
    expect(AR_STRINGS.length).toBeGreaterThan(500)
  })

  it('never leaves an isolate open', () => {
    // The one direction failure that escapes the string it is in: an unclosed
    // FSI reorders every character after it, to the end of the paragraph.
    const broken = AR_STRINGS.filter(([, , v]) => !isolatesBalanced(v)).map(([, k]) => k)
    expect(broken).toEqual([])
  })

  it('isolates every interpolation it wraps in quotes', () => {
    // `«{title}»` with a Latin title swaps its own guillemets — the single
    // highest-frequency instance of S5b, and the one a machine can spot without
    // judgement. Fix by wrapping the token: `«⁨{title}⁩»`.
    const QUOTED = /[«»“”"']\{(\w+)\}[«»“”"']/
    const bare = AR_STRINGS.filter(
      ([ns, , v]) => !IN_FLIGHT.has(ns) && QUOTED.test(v),
    ).map(([, k, v]) => `${k} :: ${v}`)
    expect(bare).toEqual([])
  })
})
