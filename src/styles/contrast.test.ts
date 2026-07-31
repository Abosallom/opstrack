// The contrast gate for inks a PAGE stylesheet sets.
//
// WHY THIS FILE EXISTS, and why global.css's own annotations were not enough.
// Every ratio in global.css is measured at FULL ALPHA — that is what makes the
// per-token matrix in its header checkable at all. A page stylesheet that
// multiplies one of those tokens downstream (`opacity`, a `color-mix`, a tint)
// produces a foreground/background pair the matrix has never seen, and it will
// pass every review because the token it cites is genuinely fine. That is
// exactly how `.fu-act { opacity: 0.62 }` shipped: --text-dim measures 7.04:1
// light on --bg-elev, and the composited button measured 2.89:1, on the primary
// actions of the screen the app opens on, as the RESTING state of every row.
//
// So this file asserts two different things, and the second is the one that
// lasts:
//
//   1. the inks `.fu-act` actually resolves to clear 4.5:1 — WCAG 1.4.3 for
//      normal text, which .btn-sm's 13px is — against BOTH surfaces a row can
//      sit on (--bg-elev is `.entry-row`, --bg-elev-2 is the `.fu-swipe`
//      wrapper behind it), in BOTH themes;
//   2. no rule targeting `.fu-act` declares `opacity` at all.
//
// (2) is not redundant with (1). An opacity is the one transform this test
// cannot follow to a number without evaluating the cascade, so it is banned
// outright on this class rather than measured. `.btn:disabled { opacity: .5 }`
// in global.css is untouched by that ban and stays correct: a disabled control
// is exempt from 1.4.3, and every `.fu-act` rule here is scoped `:not(:disabled)`
// precisely so the two do not collide.
//
// NOT A GENERAL CSS PARSER, deliberately. It reads flat top-level rule blocks
// and a `--token: value` map, which is all these two files contain and all the
// claim needs. A `@media` block's contents are read as ordinary rules, which is
// what makes the `(hover: none)` branch — the touch resting state — checkable.
//
// THE ONE FILE IN src/** THAT READS ITS SOURCE OFF DISK, and the exception is
// forced. Every other source-reading test here — localeReach, export,
// migrationContract, outbox — uses `import.meta.glob('?raw')`, and that is the
// right mechanism for a .ts or .sql file. It cannot work for a stylesheet:
// vitest.config.ts leaves `css` at its default of DISABLED (correctly — nothing
// in this suite renders to a document, so processing stylesheets would be pure
// cost), and Vitest applies that stub on the file EXTENSION, before the `?raw`
// query is looked at. A glob here returns '' and every assertion below would
// pass while checking nothing, which is strictly worse than having no test.
//
// The `node:fs` specifier is therefore held in a variable rather than written as
// a literal. tsconfig.app.json pins `types: ["vite/client"]`, and widening it to
// "node" would leak node globals into the type space of every app file — the
// thing that array is pinned to prevent (localeReach.test.ts's header says so).
// A computed specifier is resolved at run time, where this file genuinely does
// run on node (`environment: 'node'`), and is invisible to the app's types. If
// vitest ever gains a document, delete this and read computed styles instead.

import { describe, expect, it } from 'vitest'

const NODE_FS = 'node:fs'
const { readFileSync } = (await import(NODE_FS)) as {
  readFileSync: (path: URL, encoding: 'utf8') => string
}

/** One stylesheet, as text. Empty would make every assertion below vacuous. */
function sheet(relative: string): string {
  const css = readFileSync(new URL(relative, import.meta.url), 'utf8')
  if (css.trim() === '') throw new Error(`stylesheet is empty: ${relative}`)
  return css
}

const GLOBAL = sheet('./global.css')
const FOLLOWUPS = sheet('../pages/followups.css')

/* ────────────────────────── the colour arithmetic ────────────────────────── */

type Rgb = readonly [number, number, number]

function parseHex(hex: string): Rgb {
  const h = hex.trim().replace('#', '')
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ] as const
}

/** WCAG 2.x relative luminance. The 0.03928 knee is the spec's, not sRGB's. */
function luminance([r, g, b]: Rgb): number {
  const lin = (c: number): number => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrast(fg: Rgb, bg: Rgb): number {
  const a = luminance(fg)
  const b = luminance(bg)
  const [hi, lo] = a > b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}

/* ───────────────────────────── the CSS reading ───────────────────────────── */

/**
 * The `--token: #hex` pairs inside the first block whose selector matches.
 *
 * `:root` and `:root[data-theme='light']` are the two theme declarations, and
 * the light one redeclares every token rather than inheriting — global.css says
 * why, and this function relies on it: a token missing from the light block
 * would be a missing key here rather than a silently inherited dark value.
 */
function tokensIn(css: string, selector: string): Map<string, Rgb> {
  // EVERY block with this selector, not just the first. global.css declares
  // `:root` more than once — the design tokens near the top, the swatch palette
  // further down — which is ordinary CSS and exactly how the cascade is meant to
  // work. Reading only the first block silently returned a partial token map,
  // and the brand assertions below passed by iterating nothing until a
  // deliberate `length` guard turned that into a failure.
  const out = new Map<string, Rgb>()
  let from = 0
  let found = false
  for (;;) {
    const at = css.indexOf(`\n${selector} {`, from)
    if (at < 0) break
    found = true
    const open = css.indexOf('{', at)
    const close = css.indexOf('\n}', open)
    from = close + 1
    collectTokens(css.slice(open, close), out)
  }
  if (!found) throw new Error(`no such block: ${selector}`)
  return out
}

function collectTokens(body: string, out: Map<string, Rgb>): void {
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    // 8-digit hex carries alpha and none of the tokens read here use one; skip
    // rather than mis-parse it as an opaque colour.
    if (m[2].length === 9) continue
    out.set(m[1], parseHex(m[2]))
  }
}

const THEMES: readonly { name: string; selector: string }[] = [
  { name: 'dark', selector: ':root' },
  { name: 'light', selector: ":root[data-theme='light']" },
]

/**
 * Every top-level rule in a stylesheet as `{ selector, body }`.
 *
 * Comments are stripped first — followups.css's prose contains braces and
 * colons and would otherwise read as a dozen malformed rules — and an `@media`
 * wrapper is unwrapped so the rules inside it are returned alongside the rest.
 * That is what puts the `(hover: none)` resting state in scope.
 */
function rules(css: string): { selector: string; body: string }[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: { selector: string; body: string }[] = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  for (const m of stripped.matchAll(re)) {
    const selector = m[1].trim().replace(/\s+/g, ' ')
    if (selector.startsWith('@')) continue
    if (selector === '') continue
    out.push({ selector, body: m[2] })
  }
  return out
}

/** The value of one property in a declaration block, last-wins. */
function declared(body: string, property: string): string | null {
  let value: string | null = null
  for (const m of body.matchAll(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'g'))) {
    value = m[1].trim()
  }
  return value
}

const FU_RULES = rules(FOLLOWUPS)

/** Rules whose selector targets .fu-act (including .fu-act-done and friends). */
function fuActRules(): { selector: string; body: string }[] {
  return FU_RULES.filter((r) => /\.fu-act\b/.test(r.selector))
}

/* ─────────────────────────────── the claims ──────────────────────────────── */

describe('the follow-up row actions', () => {
  it('never expresses its quiet state as an opacity', () => {
    // The regression this file was written for. An opacity on a control that
    // carries text is a contrast multiplier no per-token matrix can see; the
    // quiet state has to be a token that was measured at full alpha.
    const offenders = fuActRules()
      .filter((r) => declared(r.body, 'opacity') !== null)
      .map((r) => r.selector)
    expect(offenders).toEqual([])
  })

  it('inks every state at 4.5:1 or better, both themes, on both row surfaces', () => {
    const inks = fuActRules()
      .map((r) => ({ selector: r.selector, color: declared(r.body, 'color') }))
      .filter((r): r is { selector: string; color: string } => r.color !== null)

    // Guard the guard: a rename that stopped these rules from matching would
    // otherwise make this test pass by checking nothing at all.
    expect(inks.length).toBeGreaterThanOrEqual(4)

    const failures: string[] = []
    for (const { name, selector } of THEMES) {
      const tokens = tokensIn(GLOBAL, selector)
      // `.entry-row` fills with --bg-elev and the `.fu-swipe` wrapper behind it
      // with --bg-elev-2; a button can be read against either, so the smaller
      // ratio is the one that counts.
      for (const surfaceName of ['--bg-elev', '--bg-elev-2'] as const) {
        const surface = tokens.get(surfaceName)
        expect(surface, `${name} ${surfaceName}`).toBeDefined()
        for (const ink of inks) {
          const token = /var\((--[\w-]+)\)/.exec(ink.color)?.[1]
          expect(token, `${ink.selector} must ink with a token, not a literal`).toBeDefined()
          const fg = tokens.get(token as string)
          expect(fg, `${name} ${token}`).toBeDefined()
          const ratio = contrast(fg as Rgb, surface as Rgb)
          if (ratio < 4.5) {
            failures.push(
              `${name} ${ink.selector} → ${token} on ${surfaceName} = ${ratio.toFixed(2)}:1`,
            )
          }
        }
      }
    }
    expect(failures).toEqual([])
  })
})

// ── the brand palette ───────────────────────────────────────────────────────
//
// Added when the nphies identity was adopted. The brand colours CANNOT be used
// raw and the arithmetic is why: the navy is 1.37:1 on the dark background and
// the cyan is 2.29:1 on the light one, so every brand token ships as a per-theme
// PAIR — hue and saturation held, lightness moved until it clears the bar
// against the worst surface of its own theme.
//
// That derivation is exactly the kind of work that rots. Somebody re-picks a
// hex to match a logo more closely, the app still looks broadly right, and a
// track bar quietly drops to 3:1. These assertions recompute it from the
// stylesheet on every run so the palette cannot drift back toward the raw brand
// values without a red test.
//
// --track-* and --swatch-* are checked at 3:1, not 4.5:1, and the distinction is
// deliberate: they are rendered as BARS, dots and chip fills — WCAG 1.4.11
// non-text contrast — never as body text. --accent IS used as link and control
// text, so it carries the full 4.5:1. Where a hue is used as ink the app mixes
// it into --text first (see --vocab-ink), which is a different token and a
// different check.
describe('the nphies brand palette', () => {
  const SURFACES = ['--bg', '--bg-elev', '--bg-elev-2'] as const

  for (const theme of THEMES) {
    const tokens = tokensIn(GLOBAL, theme.selector)

    it(`${theme.name}: --accent clears 4.5:1 on every surface it can sit on`, () => {
      const accent = tokens.get('--accent')
      expect(accent, `--accent missing from ${theme.selector}`).toBeDefined()
      for (const surface of SURFACES) {
        const bg = tokens.get(surface)
        expect(bg, `${surface} missing`).toBeDefined()
        expect(
          contrast(accent!, bg!),
          `--accent on ${surface} (${theme.name})`,
        ).toBeGreaterThanOrEqual(4.5)
      }
    })

    it(`${theme.name}: --accent-ink is readable ON the filled accent`, () => {
      const ink = tokens.get('--accent-ink')
      const accent = tokens.get('--accent')
      expect(ink).toBeDefined()
      expect(contrast(ink!, accent!)).toBeGreaterThanOrEqual(4.5)
    })

    it(`${theme.name}: every --track-* clears 3:1 as a bar on every surface`, () => {
      const tracks = [...tokens.keys()].filter((k) => k.startsWith('--track-'))
      // A guard against the failure mode this whole file exists to prevent:
      // a selector typo would make the loop below iterate nothing and pass.
      expect(tracks.length, 'no --track-* tokens found — check the selector').toBeGreaterThanOrEqual(5)
      for (const key of tracks) {
        for (const surface of SURFACES) {
          expect(
            contrast(tokens.get(key)!, tokens.get(surface)!),
            `${key} on ${surface} (${theme.name})`,
          ).toBeGreaterThanOrEqual(3)
        }
      }
    })

  }
})

// The swatch presets are NOT theme-scoped: `--swatch-cyan-dark` and
// `--swatch-cyan-light` are BOTH declared in `:root`, and a component picks the
// pair member that matches the active theme. So each suffix has to be measured
// against the OTHER theme's surfaces — which is why this cannot live inside the
// per-theme loop above, and why the first version of it found nothing.
describe('the swatch presets', () => {
  const ROOT = tokensIn(GLOBAL, ':root')
  const SURFACES = ['--bg', '--bg-elev', '--bg-elev-2'] as const

  for (const theme of THEMES) {
    const surfaces = tokensIn(GLOBAL, theme.selector)
    it(`${theme.name}: every --swatch-*-${theme.name} clears 3:1 as a fill`, () => {
      const keys = [...ROOT.keys()].filter(
        (k) => k.startsWith('--swatch-') && k.endsWith(`-${theme.name}`),
      )
      expect(keys.length, 'no --swatch-* tokens found — check the selector').toBeGreaterThanOrEqual(8)
      for (const key of keys) {
        for (const surface of SURFACES) {
          expect(
            contrast(ROOT.get(key)!, surfaces.get(surface)!),
            `${key} on ${surface} (${theme.name})`,
          ).toBeGreaterThanOrEqual(3)
        }
      }
    })
  }
})

