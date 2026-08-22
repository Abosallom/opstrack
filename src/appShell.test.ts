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
import fs from 'node:fs'

const app = fs.readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
const shell = fs.readFileSync(new URL('./app-shell.css', import.meta.url), 'utf8')

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

  it('has not quietly reinstated the tab bar over the composer', () => {
    // The bar is gone on purpose and the reason is geometric, not aesthetic:
    // it covered `MapCapture`. Solving a future reachability problem by putting
    // it back would re-break the thing its deletion fixed.
    expect(shell).not.toMatch(/^\.tabbar\b/m)
    expect(app).not.toContain('className="tabbar"')
  })
})
