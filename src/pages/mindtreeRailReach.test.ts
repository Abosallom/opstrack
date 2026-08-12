// THE PINNED BARS MUST NEVER COVER SOMETHING NOTHING CAN SCROLL OUT FROM UNDER.
//
// Two elements leave the flow on a compact screen and paint over the block end
// of it: the lens rail (`.mlens[data-compact]`, map-lens.css, z-index 71) and the
// composer (`.mcap[data-compact]`, z-index 75). Both are gated on `data-compact`,
// which React sets from `useIsCompact` — a WIDTH test, `(max-width: 767px)`, with
// no height term at all. Everything they cover has to be reserved by the layout
// underneath them, because an out-of-flow box contributes nothing to the
// scrollable area its content needs.
//
// WHAT THIS FILE WAS WRITTEN FOR, measured in Chrome at 375×420 with `?shell` and
// the document at `scrollTop === scrollHeight - clientHeight`:
//
//   .mlens  fixed 272→321 · .mcap fixed 321→420 · .mtree padding-block-end: 0px
//   three .mtree-legend-item 258→328, .mtree-hint 328→382, .mtree-note 382→400
//   elementFromPoint at each → .mlens-chips, .mcap, input.mcap-input
//
// 420px of viewport fails the `min-height: 480px` guard on BOTH of mindtree.css's
// laid-out blocks, so the screen fell back to its document column — which reserved
// nothing — while the bars stayed pinned on their width-only predicate. Five lines
// of the screen, including the only sentence that names the pan-and-pinch gesture
// and the only one that reconciles what the map is drawing, could not be reached
// by any gesture: the page was already at its scroll maximum. That is not a
// degraded layout, it is content that does not exist for the reader.
//
// So the claim below is: BOTH compact blocks reserve BOTH bars, through the tokens
// rather than through a copy of their pixel values, and the reservation is written
// on the width-only predicate as well as on the phone grid. A refactor that
// deletes either one puts those lines back under the chrome with every other test
// in this repo still green — that is what happened once already.
//
// AND THE OPPOSITE MISTAKE, which is why the third claim exists: in the phone GRID
// the same rect dump looks identical and is NOT a bug. `.mtree-foot` is a scroll
// container there (`max-block-size: 7rem; overflow: auto`), its children's rects
// are read through a clip at `scrollTop: 0`, and at its own scroll maximum the last
// line sits above the rail. Padding it to "clear the rail" a second time spends 48
// of its 112 visible pixels on a band `.mtree` has already reserved. The claim
// pins that too, so the strip cannot be quietly halved by a reader who trusts a
// `getBoundingClientRect()` dump over a scroll test.
//
// READS THE SHEETS OFF DISK THROUGH A `node:fs` SPECIFIER HELD IN A VARIABLE,
// which is `styles/contrast.test.ts`'s mechanism and its reasons apply unchanged:
// `import.meta.glob('?raw')` is applied on the file EXTENSION and a `.css` file
// comes back as `''` under this config, so a glob here would make every assertion
// below pass while checking nothing; and a literal `'node:fs'` would force "node"
// into tsconfig.app.json's `types`, which is pinned to `["vite/client"]` on
// purpose. Both sheets are non-empty-checked for the same reason.

import { describe, expect, it } from 'vitest'

const NODE_FS = 'node:fs'
const { readFileSync } = (await import(NODE_FS)) as {
  readFileSync: (path: URL, encoding: 'utf8') => string
}

function sheet(relative: string): string {
  const css = readFileSync(new URL(relative, import.meta.url), 'utf8')
  if (css.trim() === '') throw new Error(`stylesheet is empty: ${relative}`)
  return css
}

const MINDTREE = sheet('./mindtree.css')
const LENS = sheet('../components/map/map-lens.css')

/* ─────────────────────────── the CSS reading ─────────────────────────────── */

/** Comments stripped. Their prose quotes selectors and declarations verbatim —
 *  this whole sheet argues in prose — so every match below would otherwise be
 *  satisfiable by a paragraph describing the rule that was deleted. */
function code(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/**
 * The body of the `@media` block whose condition matches, with braces balanced.
 *
 * NOT the flat rule scanner contrast.test.ts uses: that one unwraps `@media` and
 * returns its rules alongside the top-level ones, which is right for asking "does
 * any rule declare this" and useless here, where the entire claim is about WHICH
 * block a declaration is in. `.mtree` carries a `padding-block-end` in the phone
 * grid already; the defect was that no OTHER block did.
 */
function mediaBody(css: string, condition: string): string {
  const src = code(css)
  const at = src.indexOf(`@media ${condition} {`)
  if (at < 0) throw new Error(`no @media block for: ${condition}`)
  let depth = 0
  for (let i = src.indexOf('{', at); i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') {
      depth -= 1
      if (depth === 0) return src.slice(src.indexOf('{', at) + 1, i)
    }
  }
  throw new Error(`unbalanced @media block: ${condition}`)
}

/**
 * The declaration block of the first rule with EXACTLY this selector, written
 * plainly — the caller passes `.mlens[data-compact]::after`, not an escaped
 * pattern, so a selector in this file reads as the selector it is asserting on.
 * The `\s*\{` tail is what makes it exact: `.mtree` does not match `.mtree-foot`.
 */
function rule(css: string, selector: string): string {
  const literal = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = new RegExp(`(?:^|[};])\\s*${literal}\\s*\\{([^{}]*)\\}`).exec(code(css))
  if (m === null) throw new Error(`no rule for selector: ${selector}`)
  return m[1]
}

/** One property's value in a declaration block, whitespace collapsed, last wins. */
function declared(body: string, property: string): string | null {
  let value: string | null = null
  for (const m of body.matchAll(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'g'))) {
    value = m[1].trim().replace(/\s+/g, ' ')
  }
  return value
}

const RAIL_TOKEN = '--map-lens-rail-block-size'
const COMPOSER_TOKEN = '--map-composer-block-size'
const WIDTH_ONLY = '(max-width: 767px)'
const PHONE_GRID = '(max-width: 767px) and (min-height: 480px)'

/* ─────────────────────────────── the claims ──────────────────────────────── */

describe('the compact map reserves the two pinned bars', () => {
  it('publishes the rail height unconditionally, on .mtree', () => {
    // Guard the guard, twice over. If this token is ever moved to `:root`, or
    // made conditional, the reservations below still MATCH as text while
    // resolving to their fallbacks — and the fallback is the same 48px only
    // until someone retunes the rail. Every claim here is about the token being
    // the single place that number lives.
    expect(declared(rule(MINDTREE, '.mtree'), RAIL_TOKEN)).toBe('48px')
    expect(declared(rule(MINDTREE, '.mtree'), COMPOSER_TOKEN)).toContain(
      'env(safe-area-inset-bottom',
    )
  })

  for (const condition of [WIDTH_ONLY, PHONE_GRID]) {
    it(`reserves rail + composer at the block end of .mtree in @media ${condition}`, () => {
      // BOTH, and the width-only one is the one that was missing. `data-compact`
      // reads width alone, so a viewport that fails `min-height: 480px` still
      // gets both fixed bars — with the fallback document column underneath them.
      const body = mediaBody(MINDTREE, condition)
      const padding = declared(rule(body, '.mtree'), 'padding-block-end')
      expect(padding, `.mtree has no padding-block-end in @media ${condition}`).not.toBeNull()
      expect(padding).toContain(`var(${RAIL_TOKEN}`)
      expect(padding).toContain(`var(${COMPOSER_TOKEN}`)
      // No third term. The composer's own floor already carries
      // `env(safe-area-inset-bottom)` and MapCapture's published height includes
      // the padding it draws over the home indicator, so a safe-area term here
      // reserves the notch twice — which is invisible on a desktop browser and
      // wrong on the phone this app is read on.
      expect(padding).not.toContain('safe-area-inset')
    })
  }

  it('does not reserve the rail a second time inside the caption strip', () => {
    // The measurement that makes this an assertion rather than a preference:
    // at 375×812 `.mtree-foot` is 553→665 with the rail pinned at 664→713, and
    // at its own scroll maximum (51px of 163 into 112) `.mtree-note` sits at
    // 645→663 and hit-tests to itself. Its children's rects at `scrollTop: 0`
    // read 641→695 and 695→713 and look exactly like the bug above; they are
    // clipped, not covered. A `padding-block-end` here would cost 48 of the 112
    // pixels this strip has and reveal nothing.
    const foot = rule(mediaBody(MINDTREE, PHONE_GRID), '.mtree-foot')
    expect(declared(foot, 'padding-block-end')).toBeNull()
    expect(declared(foot, 'margin-block-end')).toBeNull()
  })

  it('keeps the caption cap and the dive rail’s floor in step', () => {
    // `--map-caption-block-size` is the floor `map-altitude.css` adds to the dive
    // rail's block-end margin, and mindtree.css's own essay says it IS the strip's
    // cap ("if that cap moves, this moves with it"). Nothing enforced that. If the
    // cap grows and the floor does not, the plate lands on the legend again for
    // every host without a ResizeObserver, and permanently.
    const cap = declared(rule(mediaBody(MINDTREE, PHONE_GRID), '.mtree-foot'), 'max-block-size')
    const floor = declared(rule(MINDTREE, '.mtree'), '--map-caption-block-size')
    expect(cap).toBe('7rem')
    expect(floor).toBe(cap)
  })
})

describe('the lens rail’s scroll fade', () => {
  const compact = rule(LENS, '.mlens[data-compact]')

  it('states its width once, and the scroller lands on the same number', () => {
    // Two declarations, one token. The fade is painted over the inline end of the
    // chip scroller; `scroll-padding-inline`'s END term is what stops a chip the
    // browser scrolled into view — a Tab, a snap — from coming to rest under it.
    // Drift between them is a focus ring nobody can see.
    const width = declared(compact, '--mlens-fade-inline-size')
    expect(width).toBe('32px')

    const after = rule(LENS, '.mlens[data-compact]::after')
    expect(declared(after, 'inline-size')).toBe('var(--mlens-fade-inline-size)')

    const chips = rule(LENS, '.mlens[data-compact] .mlens-chips')
    expect(declared(chips, 'scroll-padding-inline')).toBe('8px var(--mlens-fade-inline-size)')
  })

  it('is drawn in the rail’s own colour, in both directions', () => {
    // A gradient has no logical direction, so the LTR rule and its `[dir='rtl']`
    // mirror are one declaration written twice and neither is complete without the
    // other — an Arabic reader would get the fade on the wrong end, over the chip
    // that is fully visible, with the sheared one left bare.
    const after = rule(LENS, '.mlens[data-compact]::after')
    const mirror = rule(LENS, "[dir='rtl'] .mlens[data-compact]::after")
    expect(declared(after, 'background')).toBe(
      'linear-gradient(to right, transparent, var(--bg-elev))',
    )
    expect(declared(mirror, 'background')).toBe(
      'linear-gradient(to left, transparent, var(--bg-elev))',
    )
    // It may not take a tap. The chips scroll under it and every one keeps 44px.
    expect(declared(after, 'pointer-events')).toBe('none')
  })
})
