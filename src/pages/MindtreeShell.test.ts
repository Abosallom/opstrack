// THE SHELL'S LAYOUT CONTRACT — the four things a fixed stage with floating
// chrome can break silently, asserted so that they cannot.
//
// A NOTE ON OWNERSHIP, because this file is a fourth file in a three-file unit.
// U6 owns `pages/Mindtree.tsx`, `pages/mindtree.css` and
// `pages/map/useMapToolbar.ts`. MAP-REDESIGN §3 gate 5 requires the Tab order to
// be "ASSERTED IN A TEST, not inherited", and no unit owns a test file that
// could carry it — `pages/Mindtree.test.ts` is the shared wiring suite and
// widening it would put U6's edits in a file three other units also grep. So
// this is a NEW file named after this unit, colliding with nobody, and the
// departure is reported rather than assumed.
//
// WHY IT READS SOURCE INSTEAD OF RENDERING, which `pages/Mindtree.test.ts`
// opens by saying and this file inherits: vitest.config.ts is
// `environment: 'node'` and jsdom is not in the dependency budget. A grep is a
// weak assertion and it is stronger than the nothing that was there when the
// screen shipped with no map on it at 375×812. Each assertion below names the
// MEASURED defect it stands guard over.

import { describe, expect, it } from 'vitest'

/**
 * Source through `import.meta.glob('?raw')` rather than `node:fs`:
 * tsconfig.app.json pins `types: ["vite/client"]`, and adding "node" would leak
 * node globals into the type space of every app file.
 */
const SOURCES: Record<string, string> = import.meta.glob(
  ['./Mindtree.tsx', './mindtree.css'],
  { query: '?raw', import: 'default', eager: true },
)

function source(suffix: string): string {
  const hit = Object.entries(SOURCES).find(([path]) => path.endsWith(suffix))?.[1]
  if (hit === undefined) throw new Error(`${suffix} not found by import.meta.glob`)
  return hit
}

const page = (): string => source('/Mindtree.tsx')
const sheet = (): string => source('/mindtree.css')

/** Where a needle first appears, failing by name rather than by `-1 < 0`. */
function at(src: string, needle: string, where: string): number {
  const i = src.indexOf(needle)
  expect(i, `${needle} not found in ${where}`).toBeGreaterThan(-1)
  return i
}

describe('the Tab order is DOM order, and DOM order is chosen', () => {
  it('puts every island before the canvas, the canvas before the panel, and the composer last', () => {
    // THE DEFECT THIS GUARDS. Visual order and DOM order used to be the same
    // thing here, because everything was a block in one column. The stage makes
    // them diverge — four islands are `position: absolute` over a canvas that
    // comes AFTER them in the markup — and at that point the reading order a
    // keyboard gets is whatever the JSX happens to say. It has to be said on
    // purpose.
    //
    // The order, and it is the one MAP-REDESIGN §U6 names:
    //   search → Mine → Filter → lens chips → Meetings → export → group-by →
    //   ladder → the tree's ONE stop → the panel → the composer.
    const src = page()
    const order = [
      '<FilterBar', // search · Mine · Filter (n) — one component, three controls
      '<MapLensBar', // the five destinations
      '<MapModeBar', // Meetings, then the export disclosure inside it
      '<MapToolbar', // the group-by disclosure
      // `<MapDiveRail` STOOD HERE — the continuous dive, and Table at its foot.
      // It is not mounted: the camera rewrite onto rectangles deleted the two
      // numbers it rendered (`octaves` / `octaveSpan` measured doublings of a
      // root WORLD's diameter, and a tidy tree has no worlds), and the rail
      // comes back as a DEPTH rail rather than as a dive one. Asserted below,
      // rather than dropped in silence, so that its return lands here.
      '<div className="mpan-split">', // the stage: the canvas is one tab stop
      '<MapPanel', // the floating card, a SIBLING of the canvas
      '<MapCapture />', // the composer, always last and always mounted
    ]
    const seen = order.map((needle) => at(src, needle, 'Mindtree.tsx'))
    expect(seen, order.join(' → ')).toEqual([...seen].sort((a, b) => a - b))
  })

  it('does not mount a rail whose numbers no longer exist — and says where it returns', () => {
    // THE DEFECT THIS GUARDS, and it is the one the rail's absence prevents: a
    // slider on the glass whose value means nothing. `geo.octaves` and
    // `geo.octaveSpan` are gone from `useMapGeometry`, so a call site that
    // rendered `MapDiveRail` again with them would not compile — but one that
    // rendered it with a plausible-looking substitute would, and would ship a
    // control that moves the camera to coordinates nobody chose.
    //
    // WHEN THE DEPTH RAIL LANDS: put `<MapDiveRail` back into the `order` list
    // above, between `<MapToolbar` and `<div className="mpan-split">`, and
    // delete this test. That position is the Tab order §U6 names — after the
    // group-by disclosure, before the tree's one stop — and it is the whole
    // reason this is asserted rather than left to a memory.
    // COMMENTS STRIPPED, because the page EXPLAINS the withdrawal at length and
    // quotes the very expressions it no longer evaluates. A grep that could not
    // tell code from prose would forbid the page from saying why.
    const src = page()
    const written = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(written, 'the dive rail must not be mounted with dive numbers').not.toContain(
      '<MapDiveRail',
    )
    expect(written, 'octaves are not a reading a tidy tree can produce').not.toContain('geo.octave')
    // The container is kept, and so is the component and its own test file:
    // nothing the depth rail needs has been deleted, only withdrawn.
    expect(src).toContain('mtree-ladder')
  })

  it('renders the islands inside one layer that refuses pointers', () => {
    // THE DEFECT THIS GUARDS. A transparent box over a canvas eats the
    // pointerdown that starts a pan, and nothing anywhere reports it: the map
    // simply stops being draggable. The layer must refuse pointers and each
    // island must take them back for its own box only.
    //
    // STILL ASSERTED AFTER THE LAYER CAME BACK INTO THE FLOW (see the test
    // below): the layer spans the whole inline axis and its plates do not, so
    // the empty half of the control row is still a transparent box, and the pair
    // — refuse, then take back — is still the only thing that says what a press
    // there does. Written as the two declarations rather than as
    // `position: absolute`, which was never the guarantee, only where it was
    // being kept.
    expect(page()).toContain('<div className="mtree-isles">')
    const css = sheet()
    const layer = css.indexOf('.mtree-isles {')
    expect(layer).toBeGreaterThan(-1)
    const block = css.slice(layer, css.indexOf('}', layer))
    expect(css).toMatch(/\.mtree-isles\s*\{[^}]*pointer-events:\s*none/s)
    expect(css).toMatch(/\.mtree-isle\s*,\s*\.mtree-shellbar\s*\{[^}]*pointer-events:\s*auto/s)
    expect(block.length).toBeGreaterThan(0)
  })

  it('gives the chrome a grid row instead of the top of the picture', () => {
    // THE MEASURED DEFECT, driven at 1491x812. `.mtree-isles` was
    // `position: absolute; inset: 0` over a stage whose first row was the
    // canvas, so the lens rail was painted ACROSS the root card, and on the
    // portfolio lens across that table's own control row — "Only past their s…"
    // and "…Set how lon…" read as truncations and were collisions.
    //
    // The fix is structural and the assertion is too: a leading `auto` track for
    // the chrome, and no absolute layer to put back over the stage. `auto` and
    // never a number — the rail's height is a function of its content (the chips
    // wrap, Arabic runs wider, the trail appears on a drill-in), and every
    // constant this sheet ever wrote for it (`68px`, `136px`) shipped either a
    // gap or an overlap.
    const css = sheet()
    const stage = css.indexOf('@media (min-width: 768px) and (min-height: 480px)')
    expect(stage, 'the guarded desktop block').toBeGreaterThan(-1)
    const block = css.slice(stage, css.indexOf('/* ---------- the phone', stage))
    expect(block).toContain('grid-template-rows: auto minmax(0, 1fr) auto auto;')
    expect(block, 'the island layer is IN the flow').not.toMatch(
      /\.mtree-isles\s*\{[^}]*position:\s*absolute/s,
    )
    // …and the one island that is still out of flow is still the facet panel,
    // which has to grow OVER the canvas rather than push it down.
    expect(block).toMatch(/\.mtree-find\s*\{[^}]*position:\s*absolute/s)
    // The trail came into the flow with the rail: an indicator that hung at
    // `inset-block-start: 100%` is chrome painting on the drawing, one island
    // smaller. It claims a whole flex line instead.
    expect(block).toMatch(/\.mtree-work\s*\{[^}]*flex-basis:\s*100%/s)
    expect(block, 'the empty state no longer dodges a float').not.toContain(
      'padding-block-start: 136px',
    )
  })
})

describe('the phone gets a map at all', () => {
  it('pins the lens rail ONE z-index above the sheet', () => {
    // THE MEASURED DEFECT. At 375×812 the map was not small, it was ABSENT:
    // `needs-me` lands the sheet at `full`, the sheet is fixed at z-index 70,
    // and `.mtree-shellbar` was the third block of a scrolling column — so the
    // five lens chips were ~380px below the fold UNDER it and there was no way
    // back to the map at all. 71 is the whole fix, and if it ever drops to 70 or
    // below, the landing screen has no tree on it again.
    const css = sheet()
    const rail = css.indexOf('.mtree-shellbar {\n    position: fixed;')
    expect(rail, 'the pinned rail rule').toBeGreaterThan(-1)
    const block = css.slice(rail, css.indexOf('\n  }', rail))
    expect(block).toContain('z-index: 71;')
    expect(block).toContain('inset-block-end: var(--map-composer-block-size, 0px);')
    // …and it publishes its own height so `map-panel.css` can stop the sheet
    // above it rather than under it.
    expect(css).toContain('--map-lens-rail-block-size: 48px;')
  })

  it('makes the canvas the largest region by construction, not by a clamp', () => {
    // A `clamp(18rem, 52vh, 30rem)` canvas in a scrolling column is only the
    // biggest thing on the screen at the scroll positions where it is. A `1fr`
    // row of a `100dvh` grid is the biggest thing on the screen, full stop.
    const css = sheet()
    const phone = css.indexOf('@media (max-width: 767px) and (min-height: 480px)')
    expect(phone, 'the guarded phone block').toBeGreaterThan(-1)
    const block = css.slice(phone)
    expect(block).toContain('grid-template-rows: auto minmax(0, 1fr) auto;')
    // The two fixed rails are out of flow, so the grid is told not to lay
    // anything under them — otherwise the last 112px of the map and the whole
    // caption row sit behind two `position: fixed` bars.
    expect(block).toMatch(/padding-block-end:\s*calc\(\s*var\(--map-lens-rail-block-size/)
  })

  it('stops reserving a strip of page for chips that are pinned now', () => {
    // `--map-shell-chrome-block-size` was `header + 64px`, and 56 of those were
    // reserved for "one lens row of live page" that the old comment admitted in
    // its own text it did not deliver. The chips are pinned above the sheet now,
    // so the variable is back to meaning "do not paint over the app header".
    expect(sheet()).toContain(
      '--map-shell-chrome-block-size: calc(var(--app-header-block-size, 65px) + 8px);',
    )
  })
})

describe('the fixed stage has somewhere to reflow to', () => {
  it('guards BOTH layouts on min-height, so 320x256 gets the document column', () => {
    // WCAG 1.4.10. At 400% zoom on a 1280×1024 viewport the CSS viewport is
    // 320×256. A `100dvh` grid has nowhere to reflow to, so the release valve is
    // that neither guarded block matches there and what is left is the base
    // rule: a `flex-direction: column` document that scrolls in one direction.
    //
    // The `min-height` on the PHONE block is the half that is easy to forget —
    // 320px matches `max-width: 767px`, so without it the smallest viewport in
    // the audit gets the phone's fixed grid, which is the exact failure the
    // valve exists to prevent.
    const css = sheet()
    expect(css).toContain('@media (min-width: 768px) and (min-height: 480px)')
    expect(css).toContain('@media (max-width: 767px) and (min-height: 480px)')
    // The fallback is a real declaration and not an absence: the base `.mtree`
    // is still the column it has always been.
    expect(css).toMatch(/\.mtree\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column/s)
  })

  it('keeps the canvas an element with a claimed gesture in every layout', () => {
    // `.mtree-canvas` loses its border, its radius and its clamp — it must NOT
    // lose `overflow: hidden` or `touch-action: none`. Four mechanisms hang off
    // this element (the fit's measurement, the pan claim, the drag layer's
    // coordinate conversion, and the ghost being rendered outside it on purpose)
    // and flattening it into a plain div breaks all four with no error.
    const css = sheet()
    expect(css).toMatch(/\.mtree-canvas\s*\{[^}]*touch-action:\s*none/s)
    expect(css).toMatch(/\.mtree-canvas\s*\{[^}]*overflow:\s*hidden/s)
  })

  it('uses logical properties only, including inside the two new layouts', () => {
    // The standing grep, aimed at this sheet, because a stage built out of
    // insets is exactly where a `left:`/`right:` slips in and Arabic mirrors
    // wrong. `inset-inline-*` / `inset-block-*` / `margin-inline` only.
    const css = sheet()
    // `env(safe-area-inset-left/right)` describes a hardware notch and does not
    // follow the writing direction — app-shell.css sets that precedent and this
    // sheet does not use them at all, so the match set must be empty either way.
    const physical = css.match(/(^|[\s;{])(left|right|top|bottom)\s*:/g) ?? []
    expect(physical).toEqual([])
    const physicalBox =
      css.match(/(padding|margin|border)-(left|right|top|bottom)\s*:/g) ?? []
    expect(physicalBox).toEqual([])
  })
})

describe('a workspace with no tracks gets ONE answer', () => {
  it('returns null from the panel IIFE before the exhaustive switch', () => {
    // It used to answer a question nobody asked, twice and side by side: the
    // canvas said "No tracks yet" and the panel said "Nothing needs you right
    // now". The guard is BEFORE the switch on purpose — the switch over
    // `PanelSubject` has no `default:` and must keep having none, so a condition
    // about the WORKSPACE cannot live inside a switch about the SUBJECT.
    const src = page()
    const guard = at(src, 'if (noTracks) return null', 'Mindtree.tsx')
    const branch = at(src, 'switch (subject.kind)', 'Mindtree.tsx')
    expect(guard).toBeLessThan(branch)
    // The union stays closed.
    expect(src).not.toMatch(/switch \(subject\.kind\)[\s\S]{0,2000}default:/)
  })

  it('leaves Mine with exactly one owner', () => {
    // Two `role="group"`s with one accessible name and two pressed states for
    // one fact is a defect for a screen reader even when it looks right. The
    // FilterBar's chip is the single owner; MapList is no longer given a writer.
    expect(page()).not.toContain('onFilter={setFilter}')
  })
})
