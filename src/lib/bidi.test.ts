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

// THE GATE BELOW IS UNCONDITIONAL, and it took a wave to get there. Wave 3
// shipped with a `IN_FLIGHT = new Set(['dashboard', 'recurring'])` mute in front
// of it, written as a courtesy so the gate could not fail a worker mid-sentence
// and annotated "delete both entries at the Wave-3 close". The wave closed with
// the mute — and the three strings it was hiding — still in place, which is the
// whole failure mode of a switchable gate: it is invisible once it is off, and
// green means nothing over the namespaces it covers. There is no skip list any
// more. A string being written is not a reason to stop checking it; the check
// takes microseconds and the fix is two characters.

/**
 * Placeholder names whose VALUE is user data, or is otherwise not known to be
 * Arabic at the moment the sentence is written.
 *
 * This is the generalisation the quoted-interpolation gate could not be. A
 * token only reorders its sentence when a NEUTRAL sits beside it, and a quote
 * is one neutral out of many: `{track}: {count} مفتوحة` has no quotes anywhere
 * and still puts the colon on the wrong side of a Latin track name, rendering
 * `Network Ops: 12` where the reader needs `12 :Network Ops`. Same defect, and
 * only a name list sees both.
 *
 * MEMBERSHIP RULE: a name belongs here if a real value for it can begin with a
 * Latin letter or a digit. Entry and template titles; track, column, section
 * and vocabulary labels, since an admin renames those to anything; member
 * names; free-text owners; parser tokens and tags; and every formatted date,
 * time, range and timestamp, because `Intl` writes those with Latin digits and
 * ASCII separators even under the `ar` locale.
 *
 * Pure counts are deliberately absent — `{count}`, `{days}`, `{total}`,
 * `{position}`. A bare number beside Arabic already reads correctly, and
 * fencing one only detaches the punctuation that belongs to it; see
 * NUMERIC_TOKENS for the case that proves it.
 */
const USER_VALUE_TOKENS: ReadonlySet<string> = new Set([
  'actor',
  'at',
  'author',
  'column',
  'date',
  'email',
  'from',
  'kind',
  'label',
  'name',
  'owner',
  'priority',
  'range',
  'section',
  'status',
  'tag',
  'target',
  'time',
  'title',
  'to',
  'token',
  'top',
  'track',
  'type',
  'username',
  'value',
  'week',
])

/**
 * The one namespace whose bare tokens are correct, because something else
 * fences them.
 *
 * The digest is not the UI. lib/digest/build.ts passes every interpolated value
 * through its own direction-aware isolate() first, so that an English digest of
 * English data comes out with no invisible controls in it at all — that module's
 * header explains why the artifact has to stay byte-clean. Fencing in the locale
 * file as well would double-wrap the Arabic and defeat the English half.
 */
const CALLER_ISOLATES: ReadonlySet<string> = new Set(['digest'])

/**
 * `namespace.key:token` for a number wearing a user-value name.
 *
 * `dashboard.pct` is `{value}٪`. The value is a percentage and U+066A is a
 * European Terminator, which the UBA glues to the digits beside it — exactly
 * how `Intl.NumberFormat('ar', { style: 'percent' })` renders `82٪`, sign
 * trailing and LRM-pinned. An FSI cuts that tie, the sign resolves to the
 * paragraph instead, and the number reads `٪82`.
 */
const NUMERIC_TOKENS: ReadonlySet<string> = new Set(['dashboard.pct:value'])

/**
 * Is this token FENCED — isolate opener immediately before `{`, PDI immediately
 * after `}`?
 *
 * Strict on purpose. A wider isolate that merely contains the token is usually
 * a mistake, because it hands the direction of the Arabic around the token to
 * whatever the value turns out to be. The one legitimate nesting — a value that
 * already arrived isolated, as `dashboard.flowMark`'s week label does — still
 * fences its own token, so it needs no exception.
 */
function fenced(value: string, token: string, at: number): boolean {
  return /[⁦-⁨]$/.test(value.slice(0, at)) && value.startsWith(PDI, at + token.length + 2)
}

describe('ar locale tree', () => {
  it('reads a plausible number of strings', () => {
    // A flattener that silently returned nothing would make every assertion
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
    const bare = AR_STRINGS.filter(([, , v]) => QUOTED.test(v)).map(([, k, v]) => `${k} :: ${v}`)
    expect(bare).toEqual([])
  })

  it('isolates every interpolation whose value can be Latin', () => {
    // The gate the wave actually needed. `dashboard.blockedOldest` was only one
    // of twenty-two bare tokens across those two namespaces; the other
    // nineteen carry no quotes and the check above could never have seen them.
    // Neither could localeParity (it compares tokens to tokens) nor
    // localeReach (it compares keys to source) — direction is nobody else's
    // job.
    const bare: string[] = []
    for (const [ns, key, value] of AR_STRINGS) {
      if (CALLER_ISOLATES.has(ns)) continue
      for (const m of value.matchAll(/\{(\w+)\}/g)) {
        const token = m[1]
        if (!USER_VALUE_TOKENS.has(token)) continue
        // Plural forms flatten to `ns.key.one`; the exemption is per key.
        if (NUMERIC_TOKENS.has(`${key.split('.').slice(0, 2).join('.')}:${token}`)) continue
        if (!fenced(value, token, m.index)) bare.push(`${key} {${token}} :: ${value}`)
      }
    }
    expect(bare.sort()).toEqual([])
  })

  it('isolates every literal numeric range', () => {
    // `0–3 يوم` interpolates nothing, so no token list can reach it. The UBA
    // resolves a neutral BETWEEN two European numbers to the paragraph
    // direction, and under dir="rtl" that reverses the range: the dashboard's
    // three age buckets rendered `3–0`, `7–4` and `14–8` — not broken strings,
    // but three different and entirely plausible ones. Fence the RANGE rather
    // than each endpoint (`⁦0–3⁩`); isolating the two numbers separately leaves
    // the separator outside both and changes nothing, which is what
    // isolateRange() exists to say.
    const RANGE = /\d\s*[–—-]\s*\d/g
    const bare: string[] = []
    for (const [, key, value] of AR_STRINGS) {
      for (const m of value.matchAll(RANGE)) {
        if (!/[⁦-⁨][^⁩]*$/.test(value.slice(0, m.index))) bare.push(`${key} :: ${value}`)
      }
    }
    expect(bare.sort()).toEqual([])
  })
})
