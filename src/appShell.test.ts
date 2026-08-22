// CAN EVERY DESTINATION BE REACHED, AT EVERY WIDTH.
//
// ⚠ THE REGRESSION THIS EXISTS FOR, AND IT SHIPPED. Under 768px the sidebar is
// `display: none` and the bottom tab bar was deleted — correctly: it landed on
// top of `MapCapture`, the one input the mobile design exists to put under a
// thumb. Its deletion note says "what was deleted is the SWITCHING, not the
// destinations", and that was true, because `NAV` held exactly one destination.
//
// Then `/pmo` was added. `NAV` held two, the switching was still gone, and the
// PMO Dashboard — a page built FOR a director who reads it on a phone — could
// not be opened on a phone at all. Not hidden behind a gesture: absent. Neither
// the lens chips nor `MapModeBar` nor the header gear lead there.
//
// Nothing failed. No test knew that "a route exists" and "a person can get to
// it" are different claims. This file holds the second one.
//
// It reads SOURCE rather than rendering, because the fact under test is a
// media-query boundary and `vitest.config.ts` is `environment: 'node'` — there
// is no layout here to measure. What can be checked is that the markup and the
// sheet agree about which width shows what, which is where the defect was.

import { describe, expect, it } from 'vitest'

/**
 * Source through `import.meta.glob('?raw')` rather than `node:fs`, for the
 * reason lib/localeReach.test.ts spells out: tsconfig.app.json pins
 * `types: ["vite/client"]`, and adding "node" would leak node globals into the
 * type space of every app file. `tsc -b` catches the shortcut; its incremental
 * cache can hide it for a while first, which is how it reached a commit here.
 */
const SOURCES: Record<string, string> = import.meta.glob(['./App.tsx', './app-shell.css'], {
  query: '?raw',
  import: 'default',
  eager: true,
})
function source(suffix: string): string {
  const hit = Object.entries(SOURCES).find(([path]) => path.endsWith(suffix))?.[1]
  if (hit === undefined) throw new Error(`${suffix} not found by import.meta.glob`)
  return hit
}
const app = source('/App.tsx')
const shell = source('/app-shell.css')

describe('every NAV destination is reachable under 768px', () => {
  it('renders the destinations in the header, from NAV rather than by hand', () => {
    // FROM THE TABLE, so a third destination appears the day it is added rather
    // than the day somebody remembers this file. A hardcoded pair of links here
    // would pass every assertion below and still strand destination four.
    const header = app.slice(app.indexOf('function AppHeader'), app.indexOf('/* ---------- app ---------- */'))
    expect(header, 'the header does not map over NAV').toContain('{NAV.map(')
    expect(header).toContain('app-header-dest')
    // Labelled: they are icon-only, so without this they announce as nothing.
    expect(header).toMatch(/app-header-dest[\s\S]{0,200}aria-label=\{t\(navKey\)\}/)
  })

  it('hides them from 768px up, where the sidebar carries the same list', () => {
    // Two controls for one destination on one screen is a second mark in one
    // place — the rule the fold chevron and the caption legend are both cut on.
    const wide = shell.slice(shell.indexOf('@media (min-width: 768px)'))
    const rule = wide.slice(wide.indexOf('.app-header-dest'))
    expect(wide, 'the desktop block never mentions .app-header-dest').toContain('.app-header-dest')
    expect(rule.slice(0, 80)).toContain('display: none')
  })

  it('keeps the sidebar off below 768px, which is what makes the header the ONLY route', () => {
    // If this ever flips, the header links become the duplicate rather than the
    // lifeline, and the assertion above starts guarding the wrong thing.
    const base = shell.slice(shell.indexOf('.sidebar {'), shell.indexOf('.sidebar-brand'))
    expect(base).toContain('display: none')
    expect(shell.slice(shell.indexOf('@media (min-width: 768px)'))).toMatch(
      /\.sidebar\s*\{\s*display:\s*flex/,
    )
  })

  it('does not treat "/" as the full-bleed map any more', () => {
    // ⚠ THE DEFECT THIS CAUGHT, one render after it was written. `isMapRoute`
    // listed `/` because `/` used to REDIRECT to `/mindtree`, and the comment
    // said so. The moment `/` started rendering `pages/Home.tsx` that sentence
    // became false and the shell handed a scrolling reading column the canvas's
    // treatment: no inline padding, a fixed height, `overflow: hidden`. At
    // 375px the text sat hard against both edges and every row's figure was
    // clipped off the inline end.
    //
    // The general shape is worth stating: `data-fullbleed` is a claim about
    // what a route RENDERS, and it silently rots whenever a route's content
    // changes without its predicate being re-read.
    const body = app.slice(app.indexOf('function isMapRoute'), app.indexOf('function Shell'))
    expect(body).not.toMatch(/pathname === '\/'[^\w]/)
    expect(body).toContain("pathname === '/mindtree'")
  })

  it('has not quietly reinstated the tab bar over the composer', () => {
    // The bar is gone on purpose and the reason is geometric, not aesthetic:
    // it covered `MapCapture`. Solving a future reachability problem by putting
    // it back would re-break the thing its deletion fixed.
    expect(shell).not.toMatch(/^\.tabbar\b/m)
    expect(app).not.toContain('className="tabbar"')
  })
})
