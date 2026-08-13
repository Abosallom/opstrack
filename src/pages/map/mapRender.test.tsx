// THE PERMANENT RENDER GATE — the map may never again ship unseen.
//
// This repo has twice shipped a map that typechecked, linted, passed every test
// and was illegible on the glass. The reason is structural rather than careless:
// every existing suite asserts A NUMBER IN A MODULE — a world diameter, a band
// name, a camera width — and not one of them asserts what a reader's eye
// receives. A 12.5px font inside a card authored at 1,564 drawing units, seen
// through a camera at 0.0066 CSS px per unit, is 0.086 px of ink. Every module
// involved is correct. The screen is blank.
//
// So this file renders the REAL `MapCanvas` with the REAL `MindNode` and
// `MindWorldRim` over three fixtures at five cameras, parses the SVG it actually
// emitted, resolves each mark's effective size by walking the `<g>` transform
// chain out to the camera, and asserts a table of CSS PIXELS.
//
// ── WHAT THIS FILE CAN AND CANNOT SEE ──────────────────────────────────────
//
// `vitest.config.ts` is `environment: 'node'` and jsdom is not in the dependency
// budget (`mapZoomReach.test.tsx` and `MapBranchDetail.test.tsx` open with the
// same paragraph), so there is no layout engine here and no `getComputedStyle`.
// Two consequences, both stated rather than worked around:
//
//  · THE CASCADE IS NOT EVALUATED. The two stylesheets are read off disk and the
//    handful of declarations this gate measures — five font sizes, four stroke
//    widths, one dash — are pulled out by `declaration()`, which reads flat rule
//    blocks and nothing else. `styles/contrast.test.ts` set that precedent and
//    its header argues it: it is not a CSS parser, it is a reader of the
//    specific facts the claim needs, and it THROWS when a fact goes missing
//    rather than substituting a default.
//  · TEXT IS NOT MEASURED, ONLY SIZED. Whether "Directorate North" fits inside
//    its card is `CHAR_PX`'s budget and `MindNode`'s own concern; whether the
//    glyphs land at 9 px or at 0.086 px is this file's.
//
// What that leaves is exactly the failure class that shipped: a mark whose
// authored size is right, whose position is right, and whose EFFECTIVE size on
// the glass is not. It is asserted in numbers, so a failure names the pixel
// instead of showing a picture somebody has to interpret.
//
// ── HOW A MARK'S EFFECTIVE SIZE IS COMPUTED ────────────────────────────────
//
//     css px = authored value × Π(scale on every ancestor <g>) × cameraScale
//
// where `cameraScale = viewport.width / camera.width` — the same
// `stageWidthPx / camera.width` the page hands `MapCanvas` as `scale`, and the
// only thing that turns a drawing unit into a pixel. At HEAD 10ebeb0 `Π(scale)`
// was 1 for every mark on the canvas, because nothing in `MindNode` emitted a
// `scale()`; the whole of wave 1's card fix is that it starts to, and this file
// is the thing that can tell the difference.
//
// ── THE TWO FLOORS, AND WHY THERE ARE TWO ──────────────────────────────────
//
// A mark drawn INSIDE A CARD is authored in leaf units, so it owes a PROPORTION:
//
//     css px  ≥  authored × (that card's own drawn width) / 168
//
// Every glyph must be the fraction of its card it was authored at. That is
// the written contract in `worlds.ts`'s "A NODE'S CARD IS AUTHORED AT ITS
// WORLD'S SCALE" paragraph, one level in — a card occupies the same
// share of its world at every depth, so a glyph occupies the same share of its
// card at every depth — and it is the exact statement of defect 1: marks
// authored in leaf units, cards scaled in world units. Measured on the small
// fixture at the opening camera, before the fix: 1.85 px of label in a 277 px
// card, which is 0.089× what it owes.
//
// THE DENOMINATOR IS THE CARD'S OWN WIDTH AND NOT A BAND EDGE, and that is a
// correction with a number behind it. `authored × BAND_EDGES[band] / D_LEAF`
// assumes `cardScale = worldD / D_LEAF`, which defect 6 breaks by design: a
// parent's card is inscribed in the hole its children's ring leaves, so it is
// about a third of that size and every mark in it fails a floor that has nothing
// to do with the bug. On this worktree that misfired at 8.081 px against 8.75,
// on a card that was drawn correctly.
//
// A mark that is CHROME — the world rim, which is on its way to becoming the
// breadcrumb — is camera-pinned instead, and owes the design's ABSOLUTE floor:
// 9.0 px of text, 0.75 px of stroke. `MindWorldRim.tsx` prescribes the mechanism
// as `--mring-rim-font`; the canvas design's §2 replaces it with `--mring-px`;
// `resolveLength` below reads both spellings AND a bare length, so the gate is
// green on whichever wave 1 chose and throws by name on any fourth.
//
// WHAT THE PROPORTION FLOOR DOES NOT SAY is how many pixels that is. It is
// scale-free, so it cannot be satisfied by zooming and it cannot be violated by
// pulling back — which is right for the defect it measures and leaves the
// absolute CSS-pixel claim inside a card unasserted. The `it.todo` at the foot
// of this file carries that gap with the arithmetic that forces it.
//
// ── THE PICTURE THIS GATE ALSO WRITES ──────────────────────────────────────
//
// With `LOOKAT=1` every render here is also written to `public/__lookat/` as a
// standalone SVG with its stylesheets inlined, plus the stat lines and an index.
// `scripts/lookat.mjs` is the front door (`npm run lookat`). The writing happens
// BEFORE the assertions, deliberately: the picture is most needed on the day the
// gate is red, and a generator that only runs once everything passes is one
// nobody ever sees output from.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const NODE_FS = 'node:fs'
const fs = (await import(NODE_FS)) as {
  readFileSync: (path: URL, encoding: 'utf8') => string
  writeFileSync: (path: URL, data: string) => void
  mkdirSync: (path: URL, options: { recursive: boolean }) => void
}

// `lib/i18n` reads localStorage and `store/config` adds a window listener, both
// at IMPORT time, so the shims cannot wait for a beforeAll(). Lifted from
// mapZoomReach.test.tsx unchanged: two copies of one shim beat a shared helper
// that makes import ORDER load-bearing across files.
vi.hoisted(() => {
  const mem = new Map<string, string>()
  const g = globalThis as unknown as Record<string, unknown>
  g.localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() {
      return mem.size
    },
  }
  g.addEventListener = () => {}
  g.removeEventListener = () => {}
  g.window = globalThis
  g.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
  g.document = { documentElement: { dir: 'ltr', lang: 'en' } }
})

// Types are erased, so they come through static `import type` while the VALUES
// come through the dynamic imports that run after the shims above.
import type { ReactElement } from 'react'
import type { MindDragController } from '../../components/mindtree/DragLayer'
import type { MindNodeView } from '../../components/mindtree/MindNode'
import type { PulseLayerProps } from '../../components/mindtree/PulseLayer'
import type { Band } from '../../lib/mindtree/lod'
import type { MindNode as MindNodeModel } from '../../lib/mindtree/model'
import type { CameraSpec, Fixture } from './mapRenderFixtures'

const { default: MapCanvas } = await import('../../components/map/MapCanvas')
const { D_LEAF, layoutWorlds } = await import('../../lib/mindtree/worlds')
const { apparentOf, bandFor, bandFloorPx, BAND_EDGES, FLOOR: INK } = await import(
  '../../lib/mindtree/lod'
)
const { DEFAULT_NODE_SIZE } = await import('../../lib/mindtree/layout')
const { frameCamera, viewBoxOf } = await import('./mapMotion')
const { CAMERAS, MAP_READER, breachedCounts, emptyOrgIds, fixtures, viewsFor } = await import(
  './mapRenderFixtures'
)

type WorldLayout = ReturnType<typeof layoutWorlds<MindNodeModel>>

/* ═══════════════════════════ 0. the stylesheets ═══════════════════════════ */

/** One stylesheet, as text. Empty would make every assertion below vacuous. */
function sheet(relative: string): string {
  const text = fs.readFileSync(new URL(relative, import.meta.url), 'utf8')
  if (text.trim() === '') throw new Error(`stylesheet is empty: ${relative}`)
  return text
}

/**
 * The same text with its comments removed.
 *
 * BOTH SHEETS ARGUE IN PROSE INSIDE THEIR OWN RULES — `mindtree.css` quotes
 * `position: fixed` in a paragraph explaining why the rail is NOT fixed, and
 * `mind-ring.css` quotes `stroke-width` while arguing the rim's units — so a
 * reader that measured a comment would fire on a rewrite of the argument.
 * `mapZoomReach.test.tsx` learned it the same way and says so at its §7.
 */
function bare(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/**
 * The same, with `@import` dropped — for the standalone pictures only.
 *
 * `global.css` opens with `@import './fonts.css'`, and a relative import inside
 * an SVG that has been moved to `public/__lookat/` is a 404 in the console of
 * whoever opens it. The face falls back to `system-ui` either way, which is what
 * the picture is for: geometry, not typography.
 */
function withoutImports(css: string): string {
  return bare(css).replace(/@import[^;]*;/g, '')
}

const MINDTREE_RAW = sheet('../mindtree.css')
const RING_RAW = sheet('../../components/mindtree/mind-ring.css')
const MINDTREE_CSS = bare(MINDTREE_RAW)
const RING_CSS = bare(RING_RAW)

/**
 * One declaration's VALUE TEXT, off one resting class selector.
 *
 * "Resting" means the bare class, never a `[data-…]` state qualifier and never a
 * pseudo-class: `[data-current] .mtree-node-box` widens the stroke to 2 and
 * measuring THAT would make the gate pass on a state no fixture is in. The last
 * matching block wins, which is the cascade's own rule for equal specificity.
 *
 * It THROWS rather than defaulting. A missing declaration means the sheet was
 * rewritten under this gate, and a gate that quietly substitutes a number for
 * one it can no longer find is the vacuous-green failure this file exists to
 * prevent.
 */
function declaration(css: string, selector: string, property: string): string {
  let found: string | null = null
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (rule[1] as string).split(',').map((s) => s.trim())
    if (!selectors.includes(selector)) continue
    const decl = new RegExp(`(?:^|;)\\s*${property}\\s*:([^;]+)`).exec(rule[2] as string)
    if (decl !== null) found = (decl[1] as string).trim()
  }
  if (found === null) throw new Error(`no resting ${property} on ${selector}`)
  return found
}

/**
 * A CSS length in USER UNITS, given whatever custom properties the emitting
 * group set on itself.
 *
 * THREE SPELLINGS, AND THE THIRD IS THE ONE THAT DOES NOT EXIST YET:
 *
 *   13px                            a constant
 *   var(--mring-rim-font, 13px)     MindWorldRim's documented escape hatch
 *   calc(13px * var(--mring-px, 1)) the canvas design's §2 replacement
 *
 * All three are read, because the rim's pin is a WAVE-1 DECISION this gate must
 * not pre-empt and must not be blind to. Anything else throws with the text it
 * could not read — which is the right failure: a fourth spelling means the rim
 * changed mechanism, and the gate has to be taught, not bypassed.
 */
function resolveLength(value: string, vars: ReadonlyMap<string, string>): number {
  const px = (raw: string): number | null => {
    const m = /^(-?[0-9.]+)(px)?$/.exec(raw.trim())
    return m === null ? null : Number(m[1])
  }
  const direct = px(value)
  if (direct !== null) return direct

  const variable = /var\(\s*(--[a-z-]+)\s*(?:,\s*([^)]*))?\)/.exec(value)
  const calc = /^calc\(\s*(-?[0-9.]+)(?:px)?\s*\*\s*(.+)\)$/.exec(value)

  if (calc !== null && variable !== null) {
    const set = vars.get(variable[1] as string)
    const factor = set !== undefined ? px(set) : px((variable[2] ?? '1').trim())
    if (factor !== null) return Number(calc[1]) * factor
  }
  if (variable !== null && calc === null) {
    const set = vars.get(variable[1] as string)
    const resolved = set !== undefined ? px(set) : px((variable[2] ?? '').trim())
    if (resolved !== null) return resolved
  }
  throw new Error(`unreadable length: ${value}`)
}

/** Every authored size this gate measures, as the sheets state it. */
const CSS = Object.freeze({
  nodeLabel: declaration(MINDTREE_CSS, '.mtree-node-label', 'font-size'),
  nodeCount: declaration(MINDTREE_CSS, '.mtree-node-count', 'font-size'),
  chevronCount: declaration(MINDTREE_CSS, '.mtree-chevron-count', 'font-size'),
  nodeBoxStroke: declaration(MINDTREE_CSS, '.mtree-node-box', 'stroke-width'),
  chevronStroke: declaration(MINDTREE_CSS, '.mtree-chevron-glyph', 'stroke-width'),
  secondary: declaration(RING_CSS, '.mring-secondary', 'font-size'),
  rimLabel: declaration(RING_CSS, '.mring-world-label', 'font-size'),
  rimCount: declaration(RING_CSS, '.mring-world-matches', 'font-size'),
  rimEdgeStroke: declaration(RING_CSS, '.mring-world-edge', 'stroke-width'),
  rimMatchStroke: declaration(RING_CSS, '.mring-world-match', 'stroke-width'),
})

/**
 * The ink half of the empty organization's `2 4` dash.
 *
 * `mindtree.css`'s `.mtree-node[data-empty] .mtree-node-box` draws an
 * organization with nothing filed under it as a TRANSPARENT box with a dash — "`transparent`, NEVER `none`", so it
 * still hit-tests — which means the dash IS the mark. At the shipped card scale
 * the 2-unit ink lands at 0.008 CSS px and the organization renders as nothing
 * at all, indistinguishable from one that does not exist. That is defect 5.
 *
 * READ OFF `--mtree-dash-on` RATHER THAN OUT OF THE SHORTHAND, because wave 5
 * floors the dash with the stroke that draws it and a shorthand carrying two
 * `calc()`s is a list this file has no business parsing. The sheet publishes the
 * two halves as custom properties for exactly that reason, and `resolveLength`
 * — which already reads `calc(N px * var(...))` — does the rest.
 */
const EMPTY_DASH_ON = declaration(
  MINDTREE_CSS,
  '.mtree-node[data-empty] .mtree-node-box',
  '--mtree-dash-on',
)

/* ═════════════════════════════ 1. the floors ══════════════════════════════ */

/**
 * THE DESIGN'S TABLE, absolute, and owed by EVERY MARK ON THE CANVAS — chrome
 * and card alike. Until wave 5 the card half of it was a proportion and a note
 * at the foot of this file; `lib/mindtree/lod.ts` now owns the two numbers, cuts
 * `BAND_EDGES.card` on them (157, from `9 x 200 / 11.5`) and hands `MindNode`
 * the same `bandFloorPx` this file measures against, so a glyph a card cannot
 * pay for is not drawn at all rather than drawn small.
 *
 * IMPORTED, NOT RESTATED: `INK` is `lod.FLOOR`. A second copy of 9.0 in the
 * gate is how a renderer and its gate come to disagree about what legible means.
 * 0.02 is this file's own — the corner radius as a share of the card's width:
 * `rx: 10` on a 168-unit card is 0.06 and reads as a rounded box; the same
 * `rx: 10` on a 1,564-unit card is 0.0064 and reads as a rectangle, which is
 * defect 1 seen from the side.
 */
const FLOOR = Object.freeze({ ...INK, RADIUS_SHARE: 0.02 })

/**
 * WHAT A MARK INSIDE A CARD MUST MEASURE, given how wide that card actually
 * landed on the glass:
 *
 *     authored × cardWidthPx / LEAF_WIDTH
 *
 * ── WHY THE CARD'S OWN WIDTH AND NOT THE BAND'S BOTTOM EDGE ────────────────
 *
 * The first cut of this floor was `authored × BAND_EDGES[band] / D_LEAF`, which
 * assumes `cardScale = worldD / D_LEAF`. That assumption is defect 6's to break:
 * once a parent's card is inscribed in the HOLE its children's ring leaves
 * (`cardScale = HOLE_FRACTION × worldD / leafDiagonal`), a parent's card is
 * about a third of the size that formula predicts and every mark in it fails a
 * floor that has nothing to do with the bug being measured. Measured on this
 * worktree: the small fixture's Onboarding label came to 8.081 px against a
 * band floor of 8.75, with the card drawn correctly.
 *
 * The card's own drawn width is the honest denominator, and it makes this the
 * exact statement of defect 1 — "marks authored in leaf units, cards scaled in
 * world units" — rather than a proxy for it: EVERY MARK MUST BE THE SAME
 * FRACTION OF ITS CARD THAT IT WAS AUTHORED AT. It is the written contract in
 * `worlds.ts`'s "A NODE'S CARD IS AUTHORED AT ITS WORLD'S SCALE" paragraph, one
 * level in: a card occupies the same share of its world at every depth, so a
 * glyph occupies the same share of its card at every depth.
 *
 * It is scale-free, which is the point — it holds at every camera and cannot be
 * satisfied by zooming. The CSS-pixel half of the claim is the absolute floor
 * the rim owes, plus the `it.todo` at the foot of this file.
 */
const LEAF_WIDTH = DEFAULT_NODE_SIZE.width

function shareFloorPx(authored: number, cardWidthPx: number): number {
  return (authored * cardWidthPx) / LEAF_WIDTH
}

/*
 * The bottom edge of each band, in apparent CSS px — the smallest a world can be
 * while still rendering that drawing — is `bandFloorPx`, and it is IMPORTED from
 * `lod.ts` above rather than restated here. It used to be a private copy in this
 * file. `MindNode` now decides whether to draw a glyph by asking that same
 * function the same question, so the copy became the one thing it could not be
 * allowed to remain: a second opinion about which drawing is on screen.
 */

/* ════════════════════════ 2. the render harness ═══════════════════════════ */

/**
 * No change rings. `PulseLayer`'s watch layer is a function of TIME — it marks
 * what changed in the last few seconds — and time is the one input a
 * deterministic picture cannot have. The layer is still rendered, empty, because
 * the gate must exercise the component tree the page actually mounts.
 */
const NO_PULSES: PulseLayerProps['pulses'] = new Map()

/** Everything MapCanvas needs that this gate does not measure. */
const DRAG = {
  active: false,
  hintId: 'drag-hint',
  zones: [],
  lift: null,
  ghostRef: { current: null },
  announcement: { text: '', seq: 0 },
  rtl: false,
  onNodePointerDown: () => {},
  handleKeyDown: () => false,
  isPressing: () => false,
  isLifted: () => false,
  justDragged: () => false,
} as unknown as MindDragController

/**
 * THE WAVE-5 SEAM, resolved in one place.
 *
 * `defaultFocusFor(meId, role, tree)` belongs to wave 5 and `focus.ts` does not
 * export it at this commit. It is reached through an OPTIONAL PROPERTY READ
 * rather than a `try { await import }`, because importing a module that does not
 * exist is a red gate and not a contract (`mapZoomReach.test.tsx`'s own rule) —
 * `focus.ts` does exist, and only the export is in question.
 *
 * The fallback is the drawn root, which is what `useMapFocus` resolves to today.
 * That is the whole reason the opening histogram is red now and green after
 * wave 5: the assertion never changes, the world the camera is aimed at does.
 * If wave 5 lands a different signature, THIS is the line to update and the
 * histogram is what will say so.
 */
const focusModule = (await import('../../lib/mindtree/focus')) as {
  defaultFocusFor?: (meId: string, role: string, tree: MindNodeModel) => string | null
}

function openingWorldOf(fixture: Fixture, layout: WorldLayout): string {
  const resolve = focusModule.defaultFocusFor
  if (typeof resolve === 'function') {
    const id = resolve(MAP_READER.meId, MAP_READER.role, fixture.tree)
    if (id !== null && layout.byId.has(id)) return id
  }
  return fixture.tree.id
}

interface Render {
  readonly fixture: Fixture
  readonly camera: CameraSpec
  readonly svg: string
  readonly layout: WorldLayout
  /** CSS px per drawing unit — `MapCanvas`'s `scale` prop, and the whole ballgame. */
  readonly cameraScale: number
  readonly viewportMinPx: number
  readonly framedId: string
  readonly views: ReadonlyMap<string, MindNodeView>
  readonly matchWorlds: number
}

function render(fixture: Fixture, camera: CameraSpec): Render {
  const layout = layoutWorlds<MindNodeModel>(fixture.tree, {
    direction: fixture.rtl ? 'rtl' : 'ltr',
  })
  const framedId =
    camera.aim === 'opening'
      ? openingWorldOf(fixture, layout)
      : camera.aim === 'reader'
        ? fixture.anchors.reader
        : camera.aim === 'dived'
          ? fixture.anchors.dived
          : camera.aim === 'org'
            ? fixture.anchors.org
            : fixture.tree.id
  const world = layout.byId.get(framedId)
  if (world === undefined) throw new Error(`fixture ${fixture.id} has no world ${framedId}`)

  // NO OCCLUSION: the panel is shut, which is the state all five of these
  // pictures are of. Occlusion is `frameCamera`'s own unit and is asserted in
  // `mapMotion.test.ts`, where the camera is the subject rather than the vehicle.
  const cam = frameCamera(world, {
    viewport: camera.viewport,
    frameFill: camera.frameFill,
    occlusion: { inlineEnd: 0, blockEnd: 0 },
    rtl: fixture.rtl,
  })
  const cameraScale = camera.viewport.width / cam.width
  const viewportMinPx = Math.min(camera.viewport.width, camera.viewport.height)

  const views = viewsFor(fixture.tree)
  const breached = breachedCounts(fixture.tree)

  // The match rim, folded exactly as `Mindtree.tsx`'s own
  // `matchesById`/`matchWedgesById` memo folds it. COPIED
  // RATHER THAN IMPORTED because that memo lives inside a component needing four
  // stores; it is six lines, and drift in it would show up as a wedge in the
  // wrong place — which the committed picture is there to catch.
  const matchesById = new Map<string, number>()
  const matchWedgesById = new Map<string, readonly { start: number; end: number }[]>()
  for (const w of layout.nodes) {
    const count = breached.get(w.id) ?? 0
    if (count <= 0) continue
    matchesById.set(w.id, count)
    const marked: { start: number; end: number }[] = []
    for (const childId of w.childIds) {
      const child = layout.byId.get(childId)
      if (child === undefined || (breached.get(childId) ?? 0) <= 0) continue
      marked.push({ start: child.wedgeStart, end: child.wedgeEnd })
    }
    if (marked.length > 0) matchWedgesById.set(w.id, marked)
  }

  const element: ReactElement = (
    <MapCanvas
      canvasRef={() => {}}
      svgRef={{ current: null }}
      layout={layout}
      order={layout.nodes}
      scale={cameraScale}
      viewportMinPx={viewportMinPx}
      matchesById={matchesById}
      matchWedgesById={matchWedgesById}
      views={views}
      viewBox={viewBoxOf(cam)}
      rtl={fixture.rtl}
      hintId="map-hint"
      dimensionLabel="Status"
      motion={false}
      pulses={NO_PULSES}
      dragController={DRAG}
      activeId={null}
      currentId={null}
      cardPos={null}
      cardAnchor={null}
      box={camera.viewport}
      dragging={false}
      entryById={new Map()}
      memberById={new Map()}
      vocabLabel={() => ''}
      dimension="status"
      today="2026-01-01"
      onActivate={() => {}}
      onNodeFocus={() => {}}
      registerRef={() => {}}
      onHover={() => {}}
      onMenu={() => {}}
      onTreeFocus={() => {}}
      onKeyDown={() => {}}
      onPointerDown={() => {}}
      onPointerMove={() => {}}
      onPointerEnd={() => {}}
    />
  )

  return {
    fixture,
    camera,
    svg: renderToStaticMarkup(element),
    layout,
    cameraScale,
    viewportMinPx,
    framedId,
    views,
    matchWorlds: matchWedgesById.size,
  }
}

/* ════════════════════════════ 3. the SVG reader ═══════════════════════════ */

interface Mark {
  readonly tag: string
  readonly className: string
  readonly attrs: ReadonlyMap<string, string>
  /** Text content, for `<text>` and `<title>`. */
  readonly text: string
  /** Π of every `scale()` on the ancestor `<g>` chain, this element included. */
  readonly chain: number
  /** Absolute x of this group's origin, drawing units — translations composed. */
  readonly originX: number
  /** `data-band` of the nearest ancestor carrying one. */
  readonly band: Band | null
  /** `aria-label` of the nearest ancestor treeitem — unique per fixture node. */
  readonly owner: string | null
  /** `data-empty` on the nearest ancestor treeitem. */
  readonly empty: boolean
  /** Custom properties set by this element or any ancestor, innermost wins. */
  readonly vars: ReadonlyMap<string, string>
  /** Inside a `visibility: hidden` group, so it paints nothing at all. */
  readonly hidden: boolean
}

function attrsOf(raw: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of raw.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) out.set(m[1] as string, m[2] as string)
  return out
}

/** `translate(a b) scale(s)` → s. An absent scale is 1, which is today. */
function scaleOf(transform: string | undefined): number {
  if (transform === undefined) return 1
  const m = /scale\(\s*([-0-9.eE+]+)/.exec(transform)
  return m === null ? 1 : Number(m[1])
}

function translateXOf(transform: string | undefined): number {
  if (transform === undefined) return 0
  const m = /translate\(\s*([-0-9.eE+]+)/.exec(transform)
  return m === null ? 0 : Number(m[1])
}

/** The `--custom: value` pairs off an inline `style` attribute. */
function varsOf(style: string | undefined): Map<string, string> {
  const out = new Map<string, string>()
  if (style === undefined) return out
  for (const m of style.matchAll(/(--[a-z-]+)\s*:\s*([^;]+)/g)) {
    out.set(m[1] as string, (m[2] as string).trim())
  }
  return out
}

/**
 * Every element in the emitted SVG, with its ancestor context resolved.
 *
 * A TAG SCANNER, NOT AN XML PARSER, and the input is not arbitrary: it is
 * `renderToStaticMarkup`'s output, which closes every element explicitly and
 * double-quotes every attribute. The one thing it must get right is the STACK,
 * because the transform chain is the whole point of this file — so the stack is
 * pushed for every non-void element and popped on every close tag, with no
 * shortcuts for elements that "cannot" have children.
 */
function marksOf(svg: string): readonly Mark[] {
  interface Frame {
    readonly chain: number
    readonly originX: number
    readonly band: Band | null
    readonly owner: string | null
    readonly empty: boolean
    readonly vars: Map<string, string>
    readonly hidden: boolean
  }
  const stack: Frame[] = []
  const out: Mark[] = []
  const tags = /<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>/g
  let match: RegExpExecArray | null
  while ((match = tags.exec(svg)) !== null) {
    if (match[1] === '/') {
      stack.pop()
      continue
    }
    const tag = match[2] as string
    const attrs = attrsOf(match[3] as string)
    const selfClosing = match[4] === '/'
    const top = stack[stack.length - 1]
    const className = attrs.get('class') ?? ''
    const transform = attrs.get('transform')
    const treeitem = attrs.get('role') === 'treeitem'
    const vars = new Map(top?.vars ?? [])
    for (const [k, v] of varsOf(attrs.get('style'))) vars.set(k, v)
    const frame: Frame = {
      chain: (top?.chain ?? 1) * scaleOf(transform),
      originX: (top?.originX ?? 0) + translateXOf(transform) * (top?.chain ?? 1),
      band: (attrs.get('data-band') as Band | undefined) ?? top?.band ?? null,
      owner: treeitem ? (attrs.get('aria-label') ?? null) : (top?.owner ?? null),
      empty: treeitem ? attrs.has('data-empty') : (top?.empty ?? false),
      vars,
      hidden: (top?.hidden ?? false) || className.split(/\s+/).includes('mring-absent'),
    }
    let text = ''
    if (tag === 'text' || tag === 'title') {
      const close = svg.indexOf(`</${tag}>`, tags.lastIndex)
      text = close === -1 ? '' : svg.slice(tags.lastIndex, close)
    }
    out.push({ tag, className, attrs, text, ...frame })
    if (!selfClosing) stack.push(frame)
  }
  return out
}

/** Does this mark carry the class, exactly? `class="a b"` is two classes. */
function has(mark: Mark, className: string): boolean {
  return mark.className.split(/\s+/).includes(className)
}

/* ══════════════════════ 4. what each render measures ══════════════════════ */

/** Which classes this gate knows how to size, and where they are authored. */
type Authored = 'card' | 'chrome'

interface Sized {
  readonly mark: Mark
  readonly authored: Authored
  /** The value the stylesheet states, in SVG user units. */
  readonly authoredPx: number
  /** What it measures on the glass: authored × chain × cameraScale. */
  readonly css: number
  readonly label: string
}

/** The font a text mark is drawn at, in user units, or null if it is not text. */
function textSizeOf(mark: Mark): { value: number; authored: Authored } | null {
  if (mark.tag !== 'text') return null
  const card = (value: string): { value: number; authored: Authored } => ({
    value: resolveLength(value, mark.vars),
    authored: 'card',
  })
  const chrome = (value: string): { value: number; authored: Authored } => ({
    value: resolveLength(value, mark.vars),
    authored: 'chrome',
  })
  if (has(mark, 'mtree-node-label')) return card(CSS.nodeLabel)
  if (has(mark, 'mtree-node-count')) return card(CSS.nodeCount)
  if (has(mark, 'mtree-chevron-count')) return card(CSS.chevronCount)
  if (has(mark, 'mring-secondary')) return card(CSS.secondary)
  if (has(mark, 'mring-world-label')) return chrome(CSS.rimLabel)
  if (has(mark, 'mring-world-matches')) return chrome(CSS.rimCount)
  // A text class this gate has never sized is not a pass. It is a new mark
  // nobody measured, which is the exact way the last two regressions arrived.
  throw new Error(`unmeasured text class: "${mark.className}"`)
}

/**
 * The stroke a mark is drawn with, in user units, or null when the stroke is not
 * what makes the mark visible.
 *
 * WHAT IS OUT OF SCOPE, AND THE ARGUMENT FOR IT. `.mring-grain` and
 * `.mring-state-*` are not measured and cannot be: their radii are authored as
 * FRACTIONS OF `worldD` (`GRAIN_DISC = 0.42`), so their apparent size is the
 * band's own definition and is correct by construction, and their 1-unit outline
 * is decoration on a filled disc. Demanding 0.75 px there would mean scaling the
 * disc, which would change what the band MEANS — and a floor nothing can ever
 * meet is the second-worst kind of gate. `.mtree-breach circle` and
 * `.mtree-chevron circle` are filled discs for the same reason.
 */
function strokeSizeOf(mark: Mark): { value: number; authored: Authored } | null {
  const of = (value: string, authored: Authored): { value: number; authored: Authored } => ({
    value: resolveLength(value, mark.vars),
    authored,
  })
  if (has(mark, 'mtree-node-box')) return of(CSS.nodeBoxStroke, 'card')
  if (has(mark, 'mtree-chevron-glyph')) return of(CSS.chevronStroke, 'card')
  if (has(mark, 'mring-world-edge')) return of(CSS.rimEdgeStroke, 'chrome')
  if (has(mark, 'mring-world-match')) return of(CSS.rimMatchStroke, 'chrome')
  return null
}

interface Measured {
  readonly render: Render
  readonly marks: readonly Mark[]
  readonly texts: readonly Sized[]
  readonly strokes: readonly Sized[]
  /** How wide each node's card actually landed, CSS px, keyed by its own name. */
  readonly cardWidthPx: ReadonlyMap<string, number>
  /** Band histogram over the framed world's OWN children. */
  readonly childBands: ReadonlyMap<Band, number>
  readonly childCount: number
}

function measure(r: Render): Measured {
  const marks = marksOf(r.svg)
  // THE DENOMINATOR, INDEXED FIRST. `.mtree-node-box` is a SIBLING of every mark
  // this gate sizes and a child of the same treeitem, so one pass over the boxes
  // gives every later mark the width of the card it is drawn in.
  const cardWidthPx = new Map<string, number>()
  for (const mark of marks) {
    if (!has(mark, 'mtree-node-box') || mark.owner === null) continue
    cardWidthPx.set(
      mark.owner,
      Number(mark.attrs.get('width') ?? '0') * mark.chain * r.cameraScale,
    )
  }
  const texts: Sized[] = []
  const strokes: Sized[] = []
  for (const mark of marks) {
    if (mark.hidden) continue
    const font = textSizeOf(mark)
    if (font !== null) {
      texts.push({
        mark,
        authored: font.authored,
        authoredPx: font.value,
        css: font.value * mark.chain * r.cameraScale,
        label: `${mark.className} [${mark.band ?? 'rim'}] "${mark.text}"`,
      })
    }
    const stroke = strokeSizeOf(mark)
    if (stroke !== null) {
      strokes.push({
        mark,
        authored: stroke.authored,
        authoredPx: stroke.value,
        css: stroke.value * mark.chain * r.cameraScale,
        label: `${mark.className} [${mark.band ?? 'rim'}]`,
      })
    }
  }

  const framed = r.layout.byId.get(r.framedId)
  const childBands = new Map<Band, number>()
  let childCount = 0
  for (const childId of framed?.childIds ?? []) {
    const child = r.layout.byId.get(childId)
    if (child === undefined) continue
    const band = bandFor(apparentOf(child.worldD, r.cameraScale), r.viewportMinPx)
    childBands.set(band, (childBands.get(band) ?? 0) + 1)
    childCount += 1
  }

  return { render: r, marks, texts, strokes, cardWidthPx, childBands, childCount }
}

/**
 * EVERY FIXTURE AT EVERY CAMERA, rendered ONCE at module scope and shared by
 * every assertion below.
 *
 * Fifteen renders of a 400-organization tree is the expensive part of this file
 * (about a second); doing it per-`it()` would be nine seconds and would tempt
 * the next author to drop a camera. Nothing here mutates a render, so sharing
 * them is safe in the way a `const` is safe.
 */
const ALL: readonly Measured[] = fixtures().flatMap((fixture) =>
  CAMERAS.map((camera) => measure(render(fixture, camera))),
)

function at(fixtureId: string, cameraId: string): Measured {
  const found = ALL.find((m) => m.render.fixture.id === fixtureId && m.render.camera.id === cameraId)
  if (found === undefined) throw new Error(`no render ${fixtureId} @ ${cameraId}`)
  return found
}

/** One line per render — what `npm run lookat` prints and what a PR reads. */
function statLine(m: Measured): string {
  const min = (xs: readonly Sized[]): string =>
    xs.length === 0 ? '   n/a' : `${Math.min(...xs.map((x) => x.css)).toFixed(3)}px`
  const bands = [...m.childBands].map(([band, n]) => `${band}=${n}`).join(' ')
  return [
    `${m.render.fixture.id.padEnd(10)} ${m.render.camera.id.padEnd(11)}`,
    `scale=${m.render.cameraScale.toExponential(3)}`,
    `marks=${String(m.marks.length).padStart(5)}`,
    `minText=${min(m.texts).padStart(9)}`,
    `minStroke=${min(m.strokes).padStart(9)}`,
    `framed=${m.render.framedId.padEnd(22)}`,
    `children[${m.childCount}]: ${bands}`,
  ].join('  ')
}

const STATS = ALL.map(statLine).join('\n')

/* ═══════════════════════ 5. the picture, on request ═══════════════════════ */

/**
 * `process` WITHOUT `@types/node`, on purpose.
 *
 * `tsconfig.app.json` pins `types: ["vite/client"]`, and widening it to "node"
 * would leak node globals into the type space of every app file — the exact
 * thing that array is pinned to prevent, which `localeReach.test.ts`'s header
 * and `contrast.test.ts`'s `NODE_FS` variable both work around the same way.
 * This file genuinely does run on node (`environment: 'node'`), so the value is
 * there at run time; it is reached through `globalThis` so the app's types never
 * see it.
 */
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env

if (env?.LOOKAT === '1') {
  const dir = new URL('../../../public/__lookat/', import.meta.url)
  fs.mkdirSync(dir, { recursive: true })
  // COMMENTS STRIPPED, and it is a size decision with a number behind it: the
  // three sheets are 160 KB of which 129 KB is prose, and inlining all of it
  // into six committed files costs 780 KB of repository for an argument that is
  // one click away in the source. `global.css` comes along because its `:root`
  // tokens are what every colour in the other two resolves against — and inside
  // a standalone SVG, `:root` IS the `<svg>` element, so they resolve.
  const style = withoutImports(`${sheet('../../styles/global.css')}\n${MINDTREE_RAW}\n${RING_RAW}`)
  const written: string[] = []
  for (const m of ALL) {
    // ONLY THE 400-ORGANIZATION WORKSPACE IS COMMITTED, plus its Arabic opening
    // and the two cameras that show wave 6's cohort rings. The pictures are
    // review evidence, and eight diffs a human will actually look at beat twenty
    // nobody opens. `small` is still rendered and still measured — it is in the
    // stat lines above, and it is what catches a fix that only works at 400.
    //
    // `large-grouped` COMMITS THREE OF ITS FIVE, and the choice is the wave's
    // own question rather than a size budget: `opening` is what a reader gets
    // when they press the Stage chip, `dived-two` is what they get one dive in
    // (the rung's books, named) — the two halves of "is this legible" — and
    // `phone` is where the ring cap is 16 and both floors are closest. Its
    // `zoomed-in` is 450 KB of one organization and says nothing about the
    // grouping that `large`'s does not already say.
    const wanted =
      m.render.fixture.id === 'large' ||
      (m.render.fixture.id === 'large-rtl' && m.render.camera.id === 'opening') ||
      (m.render.fixture.id === 'large-grouped' &&
        (m.render.camera.id === 'opening' ||
          m.render.camera.id === 'dived-two' ||
          m.render.camera.id === 'phone')) ||
      (m.render.fixture.id === 'large-grouped-rtl' && m.render.camera.id === 'opening')
    if (!wanted) continue
    const suffix = m.render.fixture.id.startsWith('large-grouped') ? '-grouped' : ''
    const name = `${m.render.camera.id}${suffix}${m.render.fixture.rtl ? '-rtl' : ''}.svg`
    const open = m.render.svg.indexOf('<svg')
    const close = m.render.svg.lastIndexOf('</svg>') + '</svg>'.length
    const body = m.render.svg.slice(open, close).replace(
      /^<svg /,
      '<svg xmlns="http://www.w3.org/2000/svg" ',
    )
    // A standalone file has no app shell behind it, so the picture paints its own
    // ground: without it every mark sits on transparency and every measured
    // contrast ratio in those sheets is a claim about nothing. `:root` inside a
    // standalone SVG IS the <svg> element, so global.css's tokens resolve.
    //
    // THE GROUND IS THE viewBox, NOT `100% × 100%`. Every camera here has a
    // NEGATIVE minX or minY — the drawing is centred on a world, not on the
    // origin — and a rect at (0,0) leaves a hard-edged unpainted band down the
    // side of the picture that reads as a rendering bug in the map.
    const view = /viewBox="([^"]+)"/.exec(body)?.[1] ?? '0 0 100 100'
    const [vx, vy, vw, vh] = view.split(/\s+/)
    const first = body.indexOf('>') + 1
    fs.writeFileSync(
      new URL(name, dir),
      `${body.slice(0, first)}<style>${style}</style>` +
        `<rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="var(--bg)"/>` +
        body.slice(first),
    )
    written.push(name)
  }
  fs.writeFileSync(new URL('stats.txt', dir), `${STATS}\n`)
  fs.writeFileSync(
    new URL('index.html', dir),
    [
      '<!doctype html><meta charset="utf-8"><title>__lookat — the map, as drawn</title>',
      '<style>body{background:#0f1117;color:#e6e8ef;font:14px/1.6 system-ui;margin:24px;max-width:1200px}',
      'figure{margin:0 0 32px}img{width:100%;border:1px solid #2a2f3d}',
      'pre{background:#171a23;padding:12px;overflow:auto;font-size:12px}</style>',
      '<h1>__lookat — the 400-organization workspace, as the renderer draws it</h1>',
      '<p>Regenerated by <code>npm run lookat</code> from the same fixtures and the same',
      ' real components as <code>src/pages/map/mapRender.test.tsx</code>. Committed on',
      ' purpose: a geometry change shows up here as a reviewable diff.</p>',
      `<pre>${STATS}</pre>`,
      ...written.map(
        (name) => `<figure><figcaption><code>${name}</code></figcaption><img src="${name}" alt=""></figure>`,
      ),
    ].join('\n'),
  )
}

/* ══════════════════════════════════════════════════════════════════════════
   THE ASSERTIONS
   ══════════════════════════════════════════════════════════════════════════ */

/** The first `limit` failures, joined — an empty string is the passing value. */
function report(failures: readonly string[], limit = 10): string {
  if (failures.length === 0) return ''
  const shown = failures.slice(0, limit).join('\n')
  return failures.length > limit ? `${shown}\n…and ${failures.length - limit} more` : shown
}

describe('a card is drawn at its own world’s scale', () => {
  /**
   * Every mark authored inside a card, against the width of the card it landed
   * in. One loop for glyphs and strokes alike, because they are the same claim:
   * they are all authored in leaf units and all carried by the same ONE
   * transform, which is precisely why wave 1 is one attribute and not fourteen.
   */
  function outOfProportion(pick: (m: Measured) => readonly Sized[]): string[] {
    const failures: string[] = []
    for (const m of ALL) {
      for (const sized of pick(m)) {
        if (sized.authored !== 'card') continue
        const owner = sized.mark.owner
        const cardWidth = owner === null ? undefined : m.cardWidthPx.get(owner)
        if (cardWidth === undefined || !(cardWidth > 0)) continue
        const floor = shareFloorPx(sized.authoredPx, cardWidth)
        // A HAIR OF TOLERANCE, RELATIVE: the two sides are the same product in a
        // different order, so they agree to the last bit or they disagree by an
        // order of magnitude. 1e-9 relative is far tighter than any real defect
        // and far looser than float noise.
        if (sized.css < floor * (1 - 1e-9)) {
          failures.push(
            `${m.render.fixture.id}@${m.render.camera.id} ${sized.label} ` +
              `= ${sized.css.toFixed(4)}px, card ${cardWidth.toFixed(1)}px wide owes ` +
              `${floor.toFixed(4)}px (${(sized.css / floor).toFixed(3)}× short)`,
          )
        }
      }
    }
    return failures
  }

  it('keeps every glyph the fraction of its card it was authored at', () => {
    expect(report(outOfProportion((m) => m.texts))).toBe('')
  })

  it('keeps every stroke the fraction of its card it was authored at', () => {
    expect(report(outOfProportion((m) => m.strokes))).toBe('')
  })

  it('keeps a card a rounded box rather than a rectangle', () => {
    // rx / width is SCALE-FREE — both are in the same local units — so this one
    // needs no camera at all, and it is true or false before any camera looks.
    // THE DRAWN ROOT IS EXEMPT BY CONSTRUCTION, not by value: `MindNode` gives
    // depth 0 `rx = height / 2`, a PILL, because it is the origin the rings are
    // struck from rather than the first of a list.
    const failures: string[] = []
    for (const m of ALL) {
      for (const mark of m.marks) {
        if (!has(mark, 'mtree-node-box') || mark.hidden) continue
        const rx = Number(mark.attrs.get('rx') ?? '0')
        const width = Number(mark.attrs.get('width') ?? '0')
        const height = Number(mark.attrs.get('height') ?? '0')
        if (!(width > 0) || rx === height / 2) continue
        const share = rx / width
        if (share + 1e-12 < FLOOR.RADIUS_SHARE) {
          failures.push(
            `${m.render.fixture.id}@${m.render.camera.id} ${mark.owner ?? '?'} ` +
              `rx/width = ${share.toExponential(2)} (< ${FLOOR.RADIUS_SHARE})`,
          )
        }
      }
    }
    expect(report(failures)).toBe('')
  })
})

describe('every mark on the canvas owes the absolute floor', () => {
  /**
   * NO `authored` FILTER — and its removal is the whole of wave 5 seen from this
   * file. Until then these two loops skipped `'card'` and measured the rim
   * alone, because a card's marks could not clear 9.0 px at their own band's
   * bottom edge and a floor set to what the code did would be a gate that can
   * only ever be green. `BAND_EDGES.card = 157` and `MindNode`'s per-glyph
   * `pays()` closed that; the loops now see every glyph and every stroke the
   * renderer emits, at every camera, and the note that carried the gap is gone
   * from the foot of this file.
   */
  it('draws every glyph at 9 CSS px or more, at every camera', () => {
    const failures: string[] = []
    let seen = 0
    for (const m of ALL) {
      for (const text of m.texts) {
        seen += 1
        if (text.css + 1e-9 < FLOOR.TEXT_PX) {
          failures.push(
            `${m.render.fixture.id}@${m.render.camera.id} ${text.label} = ${text.css.toFixed(3)}px`,
          )
        }
      }
    }
    // The loop is only as good as what it walked: at HEAD~1 it saw 1,268 card
    // glyphs and the smallest was 1.250 px.
    expect(seen).toBeGreaterThan(100)
    expect(report(failures)).toBe('')
  })

  it('draws every stroke at 0.75 CSS px or more, at every camera', () => {
    const failures: string[] = []
    let seen = 0
    for (const m of ALL) {
      for (const stroke of m.strokes) {
        seen += 1
        if (stroke.css + 1e-9 < FLOOR.STROKE_PX) {
          failures.push(
            `${m.render.fixture.id}@${m.render.camera.id} ${stroke.label} = ${stroke.css.toFixed(4)}px`,
          )
        }
      }
    }
    expect(seen).toBeGreaterThan(100)
    expect(report(failures)).toBe('')
  })

  it('has a floor that the drawing this wave replaced would have failed', () => {
    // THE PROOF THAT THE TWO LOOPS ABOVE CAN GO RED, stated as the arithmetic
    // rather than as a mutation: at the edge `BAND_EDGES.card` carried until
    // this wave, a card paid 8.75 px for its label, 8.05 px for its count and
    // 0.70 px for its outline. Three marks under the floor at the band's own
    // bottom edge — measured, not estimated, and the reason the edge moved.
    // `authored x apparent / D_LEAF` — the identity `MindNode`'s
    // `--mtree-world` makes true for every node in every role, and the one
    // `lod.ts` cuts the band edges on. D_LEAF, not LEAF_WIDTH: 200 is the
    // world a leaf card fills, 168 is the card inside it.
    const at = (edge: number, authored: number): number => (authored * edge) / D_LEAF
    expect(at(140, 12.5)).toBeCloseTo(8.75, 6)
    expect(at(140, 11.5)).toBeCloseTo(8.05, 6)
    expect(at(140, 1)).toBeCloseTo(0.7, 6)
    expect(at(140, 12.5)).toBeLessThan(FLOOR.TEXT_PX)
    expect(at(140, 11.5)).toBeLessThan(FLOOR.TEXT_PX)
    expect(at(140, 1)).toBeLessThan(FLOOR.STROKE_PX)
    // …and that the edge it moved to is the SMALLEST one that clears it, which
    // is what makes 157 derived rather than padded: one pixel lower and the
    // count is under the floor again.
    expect(at(BAND_EDGES.card, 11.5)).toBeGreaterThanOrEqual(FLOOR.TEXT_PX)
    expect(at(BAND_EDGES.card - 1, 11.5)).toBeLessThan(FLOOR.TEXT_PX)
    expect(at(BAND_EDGES.card, 12.5)).toBeGreaterThanOrEqual(FLOOR.TEXT_PX)
    expect(at(BAND_EDGES.card, 1)).toBeGreaterThanOrEqual(FLOOR.STROKE_PX)
  })

  it('points at the trouble — a breached subtree draws arcs that exist', () => {
    // THE ASSERTION THAT WOULD BE VACUOUS IF THE FIXTURE HAD NO BREACHES, and
    // that is why two of the three carry them. `MindWorldRim`'s match arc is the
    // map's one answer to "where is the trouble" (its own header calls it the
    // answer to this design's biggest weakness), and defect 14 is not that it
    // never fires — it fires, at 0.016 px, which is the same thing.
    const m = at('large', 'dived-two')
    expect(m.render.matchWorlds).toBeGreaterThan(0)
    const arcs = m.marks.filter((mark) => has(mark, 'mring-world-match') && !mark.hidden)
    expect(arcs.length).toBeGreaterThan(0)
    const widths = arcs.map(
      (mark) => resolveLength(CSS.rimMatchStroke, mark.vars) * mark.chain * m.render.cameraScale,
    )
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(FLOOR.STROKE_PX)
  })
})

describe('an organization nobody has filed anything under is still a mark', () => {
  it('gives every empty organization visible ink', () => {
    // `[data-empty]` is `fill: transparent` plus a `2 4` dash, so the DASH is the
    // mark. Ink means both halves: a stroke thick enough to survive the
    // rasteriser, and a dash segment long enough to be a dash rather than a
    // rounding error. Both are measured; either one failing renders the
    // organization as nothing, which is indistinguishable from one that does not
    // exist — and "which of my organizations is empty" is one of the four
    // questions this screen exists to answer.
    const failures: string[] = []
    let seen = 0
    for (const m of ALL) {
      for (const mark of m.marks) {
        if (!has(mark, 'mtree-node-box') || mark.hidden || !mark.empty) continue
        if (mark.band === 'absent' || mark.band === null) continue
        // ONLY WHERE THE DRAWING CLAIMS TO BE A CARD. Below `card` an
        // organization is a chip, a state disc or a grain by design, and the
        // dash is not the mark any more.
        if (bandFloorPx(mark.band, m.render.viewportMinPx) < BAND_EDGES.card) continue
        seen += 1
        const stroke = resolveLength(CSS.nodeBoxStroke, mark.vars) * mark.chain * m.render.cameraScale
        const dash = resolveLength(EMPTY_DASH_ON, mark.vars) * mark.chain * m.render.cameraScale
        if (dash + 1e-9 < FLOOR.STROKE_PX) {
          failures.push(
            `${m.render.fixture.id}@${m.render.camera.id} ${mark.owner ?? '?'} [${mark.band}] ` +
              `dash ink = ${dash.toFixed(4)}px, stroke = ${stroke.toFixed(4)}px ` +
              `(floor ${FLOOR.STROKE_PX}px)`,
          )
        }
      }
    }
    // The gate is only as good as the fixture: if no empty organization was ever
    // drawn, every line above passed over an empty list.
    expect(seen).toBeGreaterThan(0)
    expect(report(failures)).toBe('')
  })

  it('has empty organizations to draw in the first place', () => {
    for (const fixture of fixtures()) {
      expect(emptyOrgIds(fixture.tree).length, fixture.id).toBeGreaterThan(0)
    }
  })
})

/**
 * WAVE 6 — A COHORT RING IS A RING OF NAMES, and it is measured here rather
 * than argued.
 *
 * `model.ts` promises that no ring is ever wider than the cap and that no row is
 * ever dropped to keep it; `model.test.ts` holds that promise over the model.
 * This block holds the DRAWING's half of it, which is a different claim and the
 * one the reader actually experiences: a ring at the cap has to arrive on the
 * glass as marks that carry names. A grouping that met the cap and rendered
 * thirteen unnamed dots would satisfy every assertion in `model.test.ts`.
 */
describe('the cohort rings `?by=` draws are legible where the reader lands', () => {
  const GROUPED = 'large-grouped'

  it('never packs a ring wider than the desktop cap, anywhere in the grouped tree', () => {
    // THE FIXTURE'S OWN CONTRACT, and it is asserted because everything below it
    // is conditional on it: a fixture that quietly grew a ring of sixty would
    // make "the floors hold at 400 grouped organizations" a claim about a
    // workspace nobody ships. `RING_CAP` is not imported — this file is the
    // RENDERER's gate and must not turn red on a model constant — so the number
    // is stated, with the model's own name for it beside it.
    const CAP = 24 // model.ts's RING_CAP
    const widest: { id: string; n: number } = { id: '', n: 0 }
    const walk = (n: MindNodeModel): void => {
      if (n.children.length > widest.n) {
        widest.id = n.id
        widest.n = n.children.length
      }
      for (const child of n.children) walk(child)
    }
    const grouped = fixtures().find((f) => f.id === GROUPED) as Fixture
    walk(grouped.tree)
    expect(widest.n, `widest ring is ${widest.id}`).toBeLessThanOrEqual(CAP)
    // …and it REACHES the cap, so the assertion above is about the boundary
    // rather than about a comfortable fixture.
    expect(widest.n).toBe(CAP)
  })

  it('names every ring the camera frames — no child falls to `absent`', () => {
    // `absent` is the band at which `MindNode` draws NOTHING. A framed ring with
    // one child in it is a ring the reader is looking at and cannot read, which
    // is defect 1 of the fifteen and the reason the cap exists at all. Asserted
    // at every camera of the grouped workspace, not only the opening one: the
    // phone's cap is 16 and its ring is the tightest picture this gate has.
    for (const m of ALL) {
      if (m.render.fixture.id !== GROUPED) continue
      // `zoomed-in` frames one organization, which has no children by
      // construction — there is no ring to be legible.
      if (m.childCount === 0) continue
      expect(m.childBands.get('absent') ?? 0, statLine(m)).toBe(0)
    }
  })

  it('opens on the whole stage ladder, as eight named marks', () => {
    // WHAT `?by=stage` ACTUALLY SHOWS AT 400 ORGANIZATIONS, pinned as the number
    // it is. Eight rungs — seven the admin declared plus the pile nobody has
    // staged — every one of them a card or a chip with its name and its count,
    // at a camera the reader did not have to touch.
    //
    // AND IT IS NOT THE READER'S OWN BOOK, which is the honest consequence of
    // the axis rather than a miss: `defaultFocusFor` descends only while ONE
    // child holds every mark the reader owns, and grouping by stage scatters an
    // account manager's organizations across all eight rungs. So the map opens
    // one ring wider than it does under `?by=manager`, on the ladder that was
    // asked for. `mapRenderFixtures.groupedTree` argues it at length.
    const opening = at(GROUPED, 'opening')
    expect(opening.render.framedId).toBe('ob')
    expect(opening.childCount).toBe(8)
    expect(opening.childBands.get('absent') ?? 0).toBe(0)
    expect((opening.childBands.get('chip') ?? 0) + (opening.childBands.get('card') ?? 0)).toBe(8)
    const phone = at(GROUPED, 'phone')
    expect(phone.childCount).toBe(8)
    expect((phone.childBands.get('chip') ?? 0) + (phone.childBands.get('card') ?? 0)).toBe(8)
  })

  it('names ONE of those eight, and that is the measured cost of the axis', () => {
    // ⚠ THE NUMBER THIS BLOCK EXISTS TO MAKE VISIBLE, pinned so that a change to
    // it lands in a diff instead of in a screenshot nobody took.
    //
    // A chip draws NO WORDS. `MindNode`'s `showText` is `band === 'card' ||
    // holding` and wave 5 removed the chip's outside label deliberately (a name
    // there is 3.25-9.8 px). So a ring whose children land in `chip` is a ring of
    // unnamed marks — pointable, diveable, counted on the rim once you fly to
    // one, and anonymous until then.
    //
    // At `?by=stage` on 400 organizations exactly one cohort — the fat rung — is
    // wide enough for its world to reach `card`. The ungrouped workspace beside
    // it names all six of its children at the same camera, because the reader
    // lands one ring deeper. THIS IS A COST OF THE AXIS, not a defect in the
    // cap: `?by=manager` puts every mark the reader owns inside one cohort, so
    // `defaultFocusFor` descends into it and the six type cards come back
    // (`focus.test.ts`, "where the map opens depends on which axis `?by=` cut").
    //
    // It is asserted as `toBe` rather than as a floor on purpose. A wave that
    // improved it — a bigger `frameFill`, a size encoding, a chip label at a
    // measured size — SHOULD turn this red and rewrite the number.
    const grouped = at(GROUPED, 'opening')
    expect(grouped.childBands.get('card') ?? 0).toBe(1)
    expect(grouped.childBands.get('chip') ?? 0).toBe(7)
    // The ungrouped 400-organization workspace, at the same camera, for contrast
    // — and it is the frozen wave-5 floor, restated here as the comparison.
    const plain = at('large', 'opening')
    expect(plain.childBands.get('card') ?? 0).toBe(6)
    expect(plain.childBands.get('chip') ?? 0).toBe(0)
  })

  it('draws a cohort as a node of its own kind, so the sheet can see it', () => {
    // `MindNode` writes `data-kind={node.kind}` and nothing in the drawing
    // branches on the value today. That is the POINT of asserting it: the kind
    // reaches the DOM, so a later wave that wants a cohort to read differently
    // has a hook, and a refactor that dropped `data-kind` would take the hook
    // with it silently. It also proves the fixture's cohorts survived layout as
    // cohorts rather than being flattened into their organizations.
    const opening = at(GROUPED, 'opening')
    const kinds = new Set(
      opening.marks.map((mark) => mark.attrs.get('data-kind')).filter((k) => k !== undefined),
    )
    expect(kinds.has('cohort')).toBe(true)
    // …and the ungrouped workspace still draws none, so the attribute is
    // reporting the tree rather than being written unconditionally.
    const plain = at('large', 'opening')
    const plainKinds = new Set(
      plain.marks.map((mark) => mark.attrs.get('data-kind')).filter((k) => k !== undefined),
    )
    expect(plainKinds.has('cohort')).toBe(false)
    expect(plainKinds.has('entity')).toBe(true)
  })
})

describe('a name is drawn once', () => {
  it('never emits one node’s label as both a card and a rim', () => {
    // DEFECT 7, AND WHY IT IS DETECTED BY TEXT RATHER THAN BY ID. `MapCanvas`
    // draws a rim for EVERY node in the `opening` or `frame` band, while
    // `MindNode`'s `holding` branch keeps a TERMINAL card — with its label —
    // through the whole of `opening`. So an Organization at the top of its
    // opening band carries its name twice, 40 units apart. `MindWorldRim` is
    // `aria-hidden` and carries no id, so the label text IS the identity here —
    // which is exactly why every fixture label is unique (see the fixtures'
    // header).
    const failures: string[] = []
    for (const m of ALL) {
      const cards = new Set<string>()
      const rims = new Set<string>()
      for (const text of m.texts) {
        if (has(text.mark, 'mtree-node-label')) cards.add(text.mark.text)
        if (has(text.mark, 'mring-world-label')) rims.add(text.mark.text)
      }
      for (const name of cards) {
        if (rims.has(name)) failures.push(`${m.render.fixture.id}@${m.render.camera.id} "${name}"`)
      }
    }
    expect(report(failures)).toBe('')
  })

  it('never emits one node’s label twice within a layer', () => {
    const failures: string[] = []
    for (const m of ALL) {
      for (const layer of ['mtree-node-label', 'mring-world-label'] as const) {
        const seen = new Set<string>()
        for (const text of m.texts) {
          if (!has(text.mark, layer)) continue
          if (seen.has(text.mark.text)) {
            failures.push(`${m.render.fixture.id}@${m.render.camera.id} ${layer} "${text.mark.text}"`)
          }
          seen.add(text.mark.text)
        }
      }
    }
    expect(report(failures)).toBe('')
  })
})

describe('the opening camera lands the reader somewhere legible', () => {
  it('shows an account manager’s own world as six named cards', () => {
    // THE GEOMETRY HALF, AIMED DIRECTLY. Framing `am:1` by name — the world
    // `defaultFocusFor` resolves to — its six type children come up as cards
    // with nothing culled. That is the histogram the design promises, and it
    // proves THE PACKING can deliver it.
    //
    // KEPT SEPARATE FROM THE CAMERA HALF BELOW now that both are green, because
    // the two answer different questions and a wave that broke only the second
    // would otherwise read as a wave that broke the packing. This one is aimed
    // by id and cannot move when the resolver does.
    const m = measure(
      render(
        fixtures().filter((f) => f.id === 'large')[0] as Fixture,
        { id: 'reader-world', viewport: { width: 1600, height: 835 }, frameFill: 0.87, aim: 'reader' },
      ),
    )
    expect(m.childCount).toBe(6)
    expect(m.childBands.get('card') ?? 0).toBeGreaterThanOrEqual(6)
    expect(m.childBands.get('absent') ?? 0).toBe(0)
  })

  /**
   * WAVE 5, LANDED — `focus.defaultFocusFor(meId, role, tree)`.
   *
   * THE ASSERTION IS THE ONE ABOVE WITH `aim: 'opening'`, and nothing else
   * changed, which was always the point: the geometry already worked and the
   * camera was pointed at the wrong world. `aim: 'opening'` resolves through
   * `openingWorldOf` — i.e. through the real `defaultFocusFor` — so this fails
   * the moment that resolver stops returning an account manager's own book.
   *
   * MEASURED BEFORE AND AFTER, so the promotion is not a guess. Before: the
   * opening camera fell back to the drawn root, `children[1]: card=1`, and the
   * six type cards were four tiers below the frame at 0.086 px of text. After:
   * `framed=am:1`, `children[6]: card=6`, the six type worlds landing at
   * 185.8-193.3 px — which is also the measurement that caps `BAND_EDGES.card`
   * (see `lod.ts`'s header: any edge above 185.8 turns this picture into six
   * unnamed chips, and this test is what would say so).
   */
  it('points the OPENING camera at that world, through defaultFocusFor', () => {
    for (const fixture of fixtures()) {
      const m = at(fixture.id, 'opening')
      // NEVER THE DRAWN ROOT, in any workspace. That is the whole of defect 3:
      // a camera that shows the workspace cannot show an organization, because
      // five tiers span eleven octaves.
      expect(m.render.framedId, `${fixture.id}: the opening camera's world`).not.toBe(
        fixture.tree.id,
      )
      // AND THE READER'S OWN BOOK WHERE THE READER HAS ONE. `small` is the
      // 19-organization workspace Aziz has today and has no account managers in
      // it at all, so `defaultFocusFor` falls back to the workspace opening —
      // which is the documented fallback and not a miss, and asserting the
      // anchor there would be asserting a book that does not exist.
      if (!m.render.layout.byId.has(MAP_READER.meId)) continue
      expect(m.render.framedId, `${fixture.id}: the reader's own world`).toBe(
        fixture.anchors.reader,
      )
    }
    const large = at('large', 'opening')
    expect(large.childCount).toBe(6)
    expect(large.childBands.get('card') ?? 0).toBeGreaterThanOrEqual(6)
    expect(large.childBands.get('absent') ?? 0).toBe(0)
  })
})

describe('Arabic is the exact mirror of English', () => {
  /**
   * THE MIRROR IS ARITHMETIC AND ARITHMETIC CAN BE READ. There are no logical
   * properties inside `<svg>`, so `worlds.ts` resolves direction ONCE — θ → π−θ
   * about a hub that is the exact centre of the bounds — and every mark's x is
   * `hubX ± wx`. The claim is therefore `x_rtl = boundsWidth − x_ltr` for every
   * world centre, in both fixtures, at every camera.
   *
   * ⚠ ASSERTED TO 1e-9 DRAWING UNITS RATHER THAN BYTE-EQUAL, AND THE TOLERANCE
   * IS MEASURED RATHER THAN GUESSED. `fl(h+w) + fl(h−w)` is not exactly `2h` for
   * every float pair — the two roundings do not have to cancel. Run at
   * `MIRROR_EPS = 0` over all five cameras and all 451 node boxes the
   * 400-organization fixture draws across them, EXACTLY ONE has a non-zero
   * residue and it is 1.46e-11 drawing units; every other one is
   * byte-identical — `x_ltr + x_rtl + width` IS the bounds width, to the bit.
   * So 1e-9 is
   * sixty-eight times the worst case this drawing produces and roughly a
   * hundred-millionth of the smallest card on screen — far too tight for a real
   * mirror bug (those arrive as a sign flip or a whole card width) and far too
   * loose to fail on rounding.
   *
   * `worlds.ts`'s own BYTE-equality claim is narrower: it is about the ROOT,
   * whose `wx` is 0 and whose mirror is therefore its own fixed point. That one
   * is asserted with no epsilon at all, below.
   */
  const MIRROR_EPS = 1e-9

  it('mirrors every node’s box about the hub, at every camera', () => {
    // TWO PAIRS, and the second is wave 6's: `large`/`large-rtl` is the mirror
    // over a hierarchy the admin CONFIGURED, and `large-grouped`/…`-rtl` is the
    // same mirror over the SYNTHETIC ring `?by=` cuts. The pairing is a list
    // rather than two literals so a third workspace joins by naming its twin.
    const PAIRS: readonly (readonly [string, string])[] = [
      ['large', 'large-rtl'],
      ['large-grouped', 'large-grouped-rtl'],
    ]
    const failures: string[] = []
    for (const [ltrId, rtlId] of PAIRS)
    for (const camera of CAMERAS) {
      const ltr = at(ltrId, camera.id)
      const rtl = at(rtlId, camera.id)
      const width = ltr.render.layout.bounds.width
      expect(rtl.render.layout.bounds.width, 'the two layouts must be the same size').toBe(width)

      const boxOf = (m: Measured): Map<string, { x: number; w: number }> => {
        const out = new Map<string, { x: number; w: number }>()
        for (const mark of m.marks) {
          if (!has(mark, 'mtree-node-box') || mark.owner === null) continue
          out.set(mark.owner, {
            x: mark.originX,
            w: Number(mark.attrs.get('width') ?? '0') * mark.chain,
          })
        }
        return out
      }
      const a = boxOf(ltr)
      const b = boxOf(rtl)
      expect(b.size, `${camera.id}: both directions must draw the same nodes`).toBe(a.size)
      for (const [owner, left] of a) {
        const right = b.get(owner)
        if (right === undefined) {
          failures.push(`${camera.id} "${owner}" drawn in ltr and not in rtl`)
          continue
        }
        // x_rtl = W − (x_ltr + width): the mirror sends a box's inline-START
        // corner to its inline-END corner, which is why the width is in the sum.
        const residue = Math.abs(right.x + left.x + left.w - width)
        if (residue > MIRROR_EPS) {
          failures.push(
            `${camera.id} "${owner}" x_ltr=${left.x} x_rtl=${right.x} w=${left.w} ` +
              `residue=${residue.toExponential(2)}`,
          )
        }
      }
    }
    expect(report(failures)).toBe('')
  })

  it('leaves the hub its own exact fixed point — the same float in both scripts', () => {
    // `worlds.ts`'s ── RTL ── paragraph, verbatim: "the hub is its own fixed point
    // EXACTLY — `hubX - 0 === hubX + 0` — which is what makes the root's x
    // byte-identical in both directions". Byte equality, no epsilon.
    const ltr = at('large', 'zoomed-out').render.layout
    const rtl = at('large-rtl', 'zoomed-out').render.layout
    const a = ltr.byId.get('root')
    const b = rtl.byId.get('root')
    expect(a?.worldX).toBe(b?.worldX)
    expect(a?.worldY).toBe(b?.worldY)
  })
})

describe('the gate itself', () => {
  it('rendered all twenty-five pictures, and read a real stylesheet to do it', () => {
    expect(ALL.length).toBe(fixtures().length * CAMERAS.length)
    // FIVE FIXTURES × FIVE CAMERAS. It was fifteen until wave 6 added
    // `large-grouped` and its Arabic twin — the same 400 organizations under
    // `?by=stage`, with `kind: 'cohort'` rings where `large` has configured
    // ones. The literal is spelled out rather than derived so that a fixture
    // SILENTLY DROPPED is a red gate: the product above it would happily agree
    // with itself at three.
    expect(ALL.length).toBe(25)
    // If the sheets ever stop declaring what this gate measures, `declaration`
    // throws at import and the suite fails to collect. These four are the ones a
    // reviewer should see the value of when that happens.
    // THE SHEET'S SIDE OF WAVE 5, pinned as the literal AND as what it resolves
    // to. The literal proves the mechanism is still the two custom properties
    // `MindNode` writes; the resolved value proves the authored number under
    // them is unchanged (12.5 / 1 / 2, exactly what this gate pinned before) and
    // that BOTH default to 1 for a caller that sets neither — the tidy tree, the
    // phone's ring, `export.ts`'s serialiser.
    expect(CSS.nodeLabel).toBe('calc(12.5px * var(--mtree-world, 1))')
    expect(CSS.nodeBoxStroke).toBe('calc(1px * var(--mtree-hair, 1))')
    expect(EMPTY_DASH_ON).toBe('calc(2px * var(--mtree-hair, 1))')
    expect(resolveLength(CSS.nodeLabel, new Map())).toBe(12.5)
    expect(resolveLength(CSS.nodeBoxStroke, new Map())).toBe(1)
    expect(resolveLength(EMPTY_DASH_ON, new Map())).toBe(2)
    // …and that the factor is READ when it is set. 2.5539 is
    // `leafDiag / (HOLE_FRACTION x D_LEAF)`, the one a card inscribed in its
    // children's ring carries.
    expect(resolveLength(CSS.nodeLabel, new Map([['--mtree-world', '2.5539']]))).toBeCloseTo(31.92, 2)
    // THE SECOND COPY OF FOUR NUMBERS, PINNED EQUAL. `MindNode` decides whether
    // to draw a glyph by arithmetic on the type sizes this sheet authors, so the
    // two copies must agree or the renderer gates on a size it is not drawing.
    expect(resolveLength(CSS.nodeCount, new Map())).toBe(11.5)
    expect(resolveLength(CSS.chevronCount, new Map())).toBe(9.5)
    expect(resolveLength(CSS.secondary, new Map())).toBe(11)
    // THE RIM'S PIN. WAVE 1 CHOSE: `calc(13px * var(--mring-px, 1))` is what
    // mind-ring.css:372 ships, and `--mring-rim-font` appears nowhere in the
    // sheet — MindWorldRim.tsx:92 records the hatch as gone. The bare-`var()`
    // spelling is asserted anyway, on a LITERAL rather than on `CSS.rimLabel`,
    // because it is a `resolveLength` arm and not a claim about the sheet: the
    // parser must keep reading the spelling a later wave is likeliest to reach
    // for. What all three pin together is that the rim is MEASURED rather than
    // skipped, whichever mechanism is live.
    expect(resolveLength('13px', new Map())).toBe(13)
    expect(resolveLength('var(--mring-rim-font, 13px)', new Map())).toBe(13)
    const pinned = new Map([['--mring-rim-font', '73.5px']])
    expect(resolveLength('var(--mring-rim-font, 13px)', pinned)).toBe(73.5)
    expect(resolveLength('calc(13px * var(--mring-px, 1))', new Map())).toBe(13)
    expect(resolveLength('calc(13px * var(--mring-px, 1))', new Map([['--mring-px', '4']]))).toBe(52)
    // …and that a fourth spelling is a loud failure, never a silent default.
    expect(() => resolveLength('clamp(9px, 2vw, 13px)', new Map())).toThrow(/unreadable length/)
  })

  /**
   * WAVE 9 — the frustum cull, and the budget that becomes checkable with it.
   *
   * MEASURED AT THIS COMMIT: `large @ zoomed-in` emits 2,953 marks, because
   * `MapCanvas`'s only cull tests APPARENT SIZE and every one of the 400
   * organizations is the same size as the one being framed — they are simply
   * off screen. `statLine`'s `marks=` column is already the number this will
   * assert; the design's budget is ≤ 400 groups, and it cannot be met before
   * the cull that makes it meetable exists.
   */
  it.todo('draws no more than the frustum holds, at 400 organizations (wave 9)')

  it('measured marks at every camera, and none of them silently', () => {
    for (const m of ALL) {
      expect(m.marks.length, statLine(m)).toBeGreaterThan(0)
      expect(m.texts.length, statLine(m)).toBeGreaterThan(0)
      expect(m.strokes.length, statLine(m)).toBeGreaterThan(0)
    }
  })
})

/* ──────────────────────────────────────────────────────────────────────────────
   WHAT THIS GATE CANNOT ASSERT YET, AND WHOSE WAVE OWNS EACH.

   Listed rather than stubbed with a weaker number, because a floor set to what
   the code currently does is a gate that can only ever be green.

   · THE `<g>` BUDGET AT 400 ORGANIZATIONS. `zoomed-in` on the large fixture
     currently emits marks for every organization in the workspace, because
     `MapCanvas`'s only cull
     (`read.apparent < DOM_HORIZON_PX`) tests APPARENT SIZE ONLY and there is no frustum
     test. The budget (≤ 400 groups) belongs with the cull that makes it
     achievable — wave 9, per the plan's own table — and `statLine`'s `marks=`
     column is already the number it will assert.
   · CONTRAST. Every ratio in these two sheets is measured in
     `styles/contrast.test.ts` and in the sheets' own matrices, at full alpha.
     This file resolves no colours and must not start: `color-mix` and
     `var(--track-c-*)` need a cascade, and a second half-implemented colour
     engine is how a matrix and a screen come to disagree.
   ────────────────────────────────────────────────────────────────────────── */
