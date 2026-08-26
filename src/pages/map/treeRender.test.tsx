/**
 * THE TIDY TREE, PHOTOGRAPHED — the picture harness the renderer revision is
 * judged against.
 *
 * ── WHY A SECOND RENDER FILE AND NOT A CAMERA IN `mapRender.test.tsx` ──────
 *
 * `mapRender.test.tsx` is the blocking gate on the CONTAINMENT drawing: it lays
 * a fixture out with `layoutWorlds`, aims five cameras at four worlds, and
 * measures ink in CSS pixels because the whole question there is which of five
 * band drawings a node lands in. Every one of its 15 renders, every stat line
 * and every assertion is a claim about `worlds.ts`. The drawing this file
 * photographs is the other one: `layoutMindtree` with
 * `{ orientation: 'vertical', wrap: true }` — a vertical top-down tidy tree of
 * uniform cards, no hub, no rings, no `worldD`, and TWO bands rather than seven:
 * `MapCanvas` is handed `flat`, which draws no world rim, drops the chevron disc
 * and replaces the per-child connectors with BLOCK CONTAINERS.
 *
 * ⚠ THIS PARAGRAPH USED TO SAY "no bands at all", and that stopped being true.
 *   `flat` pinned every node to `card` at an INFINITE apparent size, which also
 *   pinned the drawing to one rendering at every camera — the owner's "still i
 *   can not zoom in details in the maps". A flat node is now banded from its own
 *   drawn width by `lod.flatBandFor`, which returns `card` or `opening` and
 *   nothing else: it can never degrade to the small marks `flat` exists to
 *   suppress, and it can never reach `frame`, which would delete the card.
 *
 *   The three framings below are all at scale 1 — apparent 200 against an
 *   opening edge of 380 — so every existing picture is byte-identical, and that
 *   is the regression gate rather than a coincidence worth relying on quietly. The `flat` this file passes is the
 * same `flat` `pages/Mindtree.tsx` passes, so these are pictures of the app's
 * drawing and not of a path only a test can reach.
 * Folding a sixth camera into that file would have made the two
 * drawings share a stat table in which half the columns are meaningless for
 * whichever drawing you are reading, and would have put a rendering question
 * about the tidy tree inside a gate that goes red for reasons about the ring.
 *
 * So this file borrows `mapRender.test.tsx`'s MECHANISM — the same
 * `renderToStaticMarkup` of the same real `MapCanvas` under the same
 * `MapCameraContext`, the same three stylesheets inlined into a standalone SVG,
 * the same `<rect>` ground placed from the viewBox rather than at `100%` — and
 * points it at the other layout. Mechanism copied, subject changed. Where a
 * helper of that file is EXPORTED (`viewsFor`, `breachedCounts` in
 * `mapRenderFixtures.ts`) it is imported rather than re-typed, because a second
 * hand-written view model is a second thing that can drift away from what the
 * app actually hands `MindNode`.
 *
 * ── WHY THE PICTURES COME FIRST ────────────────────────────────────────────
 *
 * The renderer revision this harness exists for is a SUBTRACTION: the band
 * machinery in `MindNode.tsx` swaps a card for a disc when a node's apparent
 * size falls, which contradicts the owner's rule that every detail is visible at
 * every zoom. A subtraction cannot be reviewed from a diff — the question is not
 * "did the lines go" but "does the drawing look right afterwards", and nothing
 * can answer that but a picture. Pictures of the drawing BEFORE it are the
 * baseline the loop measured against, which is why this file was written and run
 * against the unchanged renderer first.
 *
 * AND THE BASELINE IS WHAT FOUND THE ACTUAL DEFECT, which is the whole argument
 * for taking the picture before writing the fix. "The circles" turned out NOT to
 * be the grain and state discs: on this layout every node reports `band: 'card'`
 * (no `worldD`), so those branches were unreachable and neither SVG contained a
 * single `mring-grain` or `mring-state-*` mark. The circles in the picture were
 * the CHEVRON discs — `r={7}`, drawn at the linear fallback `{ x: width + 9 }`,
 * hanging off the inline-end edge of every parent card, outside the box, beside
 * a card whose children are below it. One on the root, two on the directorates,
 * six on the books, twenty-four on the types. A revision written from the
 * complaint alone would have deleted the right machinery for the wrong reason
 * and left every one of them on the glass.
 *
 * ── WHY IT IS INERT WITHOUT `TREESHOT=1` ───────────────────────────────────
 *
 * The suite is 5,241 tests and is run on every change; a harness that rendered
 * 153 nodes twice through `renderToStaticMarkup` and read three stylesheets off
 * the disk on every one of those runs would be a tax paid by everybody for a
 * picture almost nobody is looking at. Every heavy thing here — the React
 * imports, the layout, the two renders, the file writes — lives inside the
 * `if (SHOOTING)` block at module scope, so an ordinary `npx vitest run` reaches
 * exactly one pure assertion about the fixture's shape and stops.
 *
 * That one assertion is not filler. Every picture this harness writes is a
 * picture OF the fixture, so a fixture that silently changed shape would turn
 * every committed comparison into a comparison of two different workspaces
 * without anything going red. Pinning the shape is what makes the pictures
 * evidence rather than decoration.
 *
 * ── HOW TO GET THE PICTURES ────────────────────────────────────────────────
 *
 *     bash /Users/aziz/.claude/jobs/ad71690d/tmp/loop/shoot.sh
 *
 * which runs this file with `TREESHOT=1` and then rasterises every SVG it wrote
 * to a PNG with headless Chrome at 1600×900 — the same rasterisation
 * `scripts/lookat-png.mjs` performs on the committed `__lookat` pictures, and
 * for the same measured reason: librsvg resolves none of the `var(--token)`
 * colours these sheets are built out of, and Chrome resolves all of them.
 */

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

/**
 * `node:fs` through a VARIABLE specifier, exactly as `mapRender.test.tsx` and
 * `styles/contrast.test.ts` reach it: `tsconfig.app.json` pins
 * `types: ["vite/client"]` and must not gain `"node"`, or node's globals leak
 * into the type space of every application file. The three methods are
 * hand-typed because that is the whole surface this file uses.
 */
const NODE_FS = 'node:fs'
const fs = (await import(NODE_FS)) as {
  readFileSync: (path: URL, encoding: 'utf8') => string
  writeFileSync: (path: URL, data: string) => void
  mkdirSync: (path: URL, options: { recursive: boolean }) => void
}

// `lib/i18n` reads localStorage and `store/config` adds a window listener, both
// at IMPORT time, so the shims cannot wait for a `beforeAll()`. Lifted from
// `mapRender.test.tsx` unchanged, which lifted it from `mapZoomReach.test.tsx`
// unchanged: three copies of one shim beat a shared helper that would make
// import ORDER load-bearing across three files.
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

// Types are erased, so they come through static `import type` while every VALUE
// comes through a dynamic import that runs after the shims above.
import type { CSSProperties, ReactElement } from 'react'
import type { MindDragController } from '../../components/mindtree/DragLayer'
import type { MindNodeView } from '../../components/mindtree/MindNode'
import type { PulseLayerProps } from '../../components/mindtree/PulseLayer'
import type { MindNode as MindNodeModel } from '../../lib/mindtree/model'

/**
 * `process` WITHOUT `@types/node`, for the same reason `NODE_FS` is a variable:
 * this file genuinely runs on node (`environment: 'node'`), so the value is
 * there at run time, and reaching it through `globalThis` keeps the app's type
 * space free of it.
 */
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env

/** The one switch. Everything expensive in this file hangs off it. */
const SHOOTING = env?.TREESHOT === '1'

/* ════════════════════════ 1. the workspace, hand-built ════════════════════ */

/**
 * A track colour pair, exactly as `trackStyle.trackVars()` produces it and
 * `model.ts` staples it on. THE ONLY WAY A HUE ENTERS THE DRAWING, so a fixture
 * that left `colourVars` empty would render every card and every connector in
 * the fallback border colour — and "can a reader tell one directorate's subtree
 * from the other's" is one of the questions these pictures exist to answer.
 */
function ink(dark: string, light: string): CSSProperties {
  return { '--track-c-dark': dark, '--track-c-light': light } as CSSProperties
}

/**
 * ONE PAIR PER DIRECTORATE, inherited downward.
 *
 * `MapCanvas` wraps every connector in a `<g>` carrying the CHILD's
 * `colourVars`, so a branch reads as one family only if the family shares a
 * pair. Picking a fresh hue per level would make the same subtree change colour
 * as it descends, which is precisely the thing a hierarchy drawing must not do.
 */
const NORTH = ink('#9884d6', '#6b5bb5')
const SOUTH = ink('#6fb1c9', '#3d7f97')

interface NodeSpec {
  readonly id: string
  readonly kind: MindNodeModel['kind']
  readonly label: string
  readonly children?: readonly MindNodeModel[]
  /** Open items at or under this node. 0 makes it an EMPTY organization. */
  readonly count?: number
  readonly breached?: boolean
  readonly colourVars?: CSSProperties
}

/**
 * One node, with the roll-up done here rather than by a caller.
 *
 * `count` sums the children when it is not stated, which is `model.ts`'s own
 * rule ("a parent labelled 12 whose children sum to 9 is worse than a greyed-out
 * branch") and is what makes the count chip in the picture checkable against the
 * fixture that produced it. The SLA breach rolls up the same way, because
 * `MindNode` draws its breach mark off the node it is handed and has no way to
 * look down the tree for one.
 */
function node(spec: NodeSpec): MindNodeModel {
  const children = [...(spec.children ?? [])]
  const rolled = children.reduce((sum, child) => sum + child.count, 0)
  const breachedBelow = children.some((child) => child.health.slaBreached)
  return {
    id: spec.id,
    kind: spec.kind,
    label: { kind: 'text', text: spec.label },
    count: spec.count ?? (children.length === 0 ? 1 : rolled),
    colourVars: spec.colourVars ?? NORTH,
    health: {
      levels: { ok: 1, stale: 0, overdue: 0, critical: 0 },
      slaBreached: spec.breached === true || breachedBelow,
    },
    children,
    collapsed: false,
    depth: 0,
    entryId: null,
    bucketKey: spec.id,
    entityType: null,
    retired: false,
  }
}

/** The four organization types each book is split by in this workspace. */
const TYPES = ['Hospitals', 'Polyclinics', 'Labs', 'Pharmacies'] as const

/** The two directorates and the three account managers filed under each. */
const DIRECTORATES: readonly {
  readonly label: string
  readonly ink: CSSProperties
  readonly books: readonly string[]
}[] = [
  // THE TWO LABELS ARE THE WORKSPACE'S OWN AND THEY ARE 27 GLYPHS ON PURPOSE.
  // They were "Directorate North" / "Directorate South" and the picture was
  // quietly easy: seventeen glyphs is inside the budget of any card this drawing
  // has ever had. The names the owner actually onboards under are these, and
  // they are the ones that came back from the live site as "Associate …" — so
  // the fixture carries the length that produced the defect, and every picture
  // this harness writes from here on answers the question at that length.
  {
    label: 'Associate Directorate Alpha',
    ink: NORTH,
    books: ['Sara Al-Otaibi', 'Faisal Al-Harbi', 'Nouf Al-Qahtani'],
  },
  {
    label: 'Associate Directorate Beta',
    ink: SOUTH,
    books: ['Hessa Al-Dosari', 'Turki Al-Shammari', 'Lama Al-Ghamdi'],
  },
]

/**
 * THE 120-ORGANIZATION WORKSPACE — root, 2 directorates, 3 books each, 4 types
 * each, 5 organizations each. 153 nodes, five levels, `aria-level` 1 through 5.
 *
 * ── WHY IT IS HAND-BUILT AND NOT `buildMindtree`'d ─────────────────────────
 *
 * `mapRenderFixtures.ts` opens with this same paragraph and it is the same
 * reason: a MODEL change must not turn a RENDERING harness into a picture of
 * something else. What these pictures are of is the drawing — card geometry,
 * connector shape, the wrapped block under a parent, whether a glyph survives —
 * and every one of those is a fact about `layout.ts` + `MindNode` + the two
 * stylesheets. Handing them a tree built by `model.ts` from a fake entry list
 * would put a second, unrelated source of change inside every picture.
 *
 * ── WHAT IS DELIBERATELY IN THE DATA ───────────────────────────────────────
 *
 *  · EMPTY ORGANIZATIONS (`count: 0`). `mindtree.css`'s
 *    `.mtree-node[data-empty] .mtree-node-box` draws them as a transparent box
 *    with a `2 4` dash. An organization nobody has filed anything under must
 *    still be findable in the picture, so the fixture contains some.
 *  · BREACHED ORGANIZATIONS, which roll a breach up the whole spine and are what
 *    put `.mtree-breach` marks on cards at four different levels.
 *  · UNIQUE LABELS, every node. Nothing in an SVG says which fixture node drew a
 *    given `<text>`; the label IS the identity when a picture is being read, and
 *    two nodes sharing one makes a doubled name unreadable as a defect.
 *  · EVERY SIXTH ORGANIZATION EMPTY AND EVERY ELEVENTH BREACHED, BY INDEX rather
 *    than by a random draw, so the same fixture produces the same picture on
 *    every machine and a PNG diff means a code change and nothing else.
 *  · BOOK IDS OF THE FORM `am:<n>`, because `viewsFor` keys the Organization's
 *    second line ("account manager, vendor") off exactly that prefix. Naming the
 *    books anything else would silently drop the two-line card from every
 *    picture, and the two-line card is one of the things being judged.
 */
function treeFixture(): MindNodeModel {
  let serial = 1
  let bookIndex = 0
  const directorates = DIRECTORATES.map((directorate, dIndex) => {
    const books = directorate.books.map((am) => {
      const bookId = `am:${bookIndex}`
      bookIndex += 1
      const types = TYPES.map((typeLabel, tIndex) => {
        const typeId = `${bookId}:type:${tIndex}`
        const orgs: MindNodeModel[] = []
        for (let i = 0; i < 5; i += 1) {
          const n = serial
          serial += 1
          orgs.push(
            node({
              id: `${typeId}:org:${n}`,
              kind: 'entity',
              label: `Org ${String(n).padStart(3, '0')}`,
              count: n % 6 === 0 ? 0 : 1 + (n % 4),
              breached: n % 11 === 0,
              colourVars: directorate.ink,
            }),
          )
        }
        // The type label leads with the book's initials for the reason
        // `mapRenderFixtures.ts` states at length: `MindNode` truncates by GLYPH
        // COUNT, so "Hospitals — Sara Al-Otaibi" and "Hospitals — Faisal
        // Al-Harbi" would clip to the same string and the picture would show two
        // cards a reader cannot tell apart. The distinguishing characters go
        // FIRST.
        const initials = am
          .split(/[\s-]+/)
          .map((part) => part[0] ?? '')
          .join('')
          .slice(0, 2)
        return node({
          id: typeId,
          kind: 'entity',
          label: `${initials} ${typeLabel}`,
          children: orgs,
          colourVars: directorate.ink,
        })
      })
      return node({ id: bookId, kind: 'entity', label: am, children: types, colourVars: directorate.ink })
    })
    return node({
      id: `ad:${dIndex}`,
      kind: 'track',
      label: directorate.label,
      children: books,
      colourVars: directorate.ink,
    })
  })
  return node({
    id: 'root',
    kind: 'root',
    label: 'NphiesCore',
    colourVars: {},
    children: directorates,
  })
}

/** Every node in the fixture, pre-order — the denominator of everything below. */
function flatten(root: MindNodeModel): readonly MindNodeModel[] {
  const out: MindNodeModel[] = []
  const walk = (n: MindNodeModel): void => {
    out.push(n)
    for (const child of n.children) walk(child)
  }
  walk(root)
  return out
}

/**
 * The same fixture with every BOOK collapsed — the state a reader of this map
 * spends most of their time in, because `foldOnActivate` (Mindtree.tsx) makes a
 * tap on a branch that holds MORE BRANCHES fold it. (A tap on an organization
 * opens its details panel instead; `useMapKeyboard`'s `activate` says why the
 * two differ, and a book is the first kind — its children are types and
 * organizations, so it folds.)
 *
 * ON THE ID, NOT ON THE KIND. A book and an organization are both
 * `kind: 'entity'` in this workspace — the level is carried by the `am:` id
 * prefix the fixture assigns (see `bookId`) — and folding on the kind would
 * collapse all 120 organizations too, which are leaves and draw nothing.
 *
 * `collapsed` is what `layoutMindtree` reads; the children stay on the model, so
 * `hiddenChildCount` has something to count.
 */
function foldBooks(n: MindNodeModel): MindNodeModel {
  return n.id.startsWith('am:')
    ? { ...n, collapsed: true }
    : { ...n, children: n.children.map(foldBooks) }
}

/* ══════════════════════ 2. the pictures, on request ═══════════════════════ */

if (SHOOTING) {
  /**
   * Values, imported here rather than at the top of the file, because THIS is
   * what makes the harness free for the normal suite: `MapCanvas` pulls in
   * eleven components, two stylesheets, `lib/i18n` and the camera context, and
   * none of that should be parsed by a run that is not taking a picture.
   */
  const { default: MapCanvas } = await import('../../components/map/MapCanvas')
  const { MapCameraContext } = await import('./mapCameraContext')
  const { layoutMindtree } = await import('../../lib/mindtree/layout')
  const { blocksOf } = await import('../../lib/mindtree/blocks')
  const { viewBoxOf } = await import('./mapMotion')
  const { breachedCounts, viewsFor } = await import('./mapRenderFixtures')

  /**
   * WHERE THE PICTURES GO. Outside the repository on purpose: these are the
   * working images of one revision loop, regenerated dozens of times, and a
   * scratch directory is the honest place for a file whose whole value is that
   * it is younger than the last edit. `TREESHOT_OUT` overrides it so the same
   * harness can be pointed at a directory a reviewer keeps.
   */
  const outDir = env?.TREESHOT_OUT ?? '/Users/aziz/.claude/jobs/ad71690d/tmp/loop/'
  const dir = new URL(outDir.endsWith('/') ? outDir : `${outDir}/`, 'file://')
  fs.mkdirSync(dir, { recursive: true })

  /**
   * One stylesheet, read off the disk relative to THIS file.
   *
   * It throws on an empty read rather than defaulting, because a sheet that
   * silently resolved to `''` produces a picture in which every colour, every
   * stroke width and every font size is the browser's default — a picture that
   * looks like a rendering catastrophe and is in fact a missing file.
   */
  const sheet = (relative: string): string => {
    const css = fs.readFileSync(new URL(relative, import.meta.url), 'utf8')
    if (css.trim() === '') throw new Error(`stylesheet ${relative} read as empty`)
    return css
  }

  /**
   * Comments stripped, `@import` dropped.
   *
   * The three sheets are ~160 KB of which the overwhelming majority is prose,
   * and it is inlined into every picture; and `global.css` opens with
   * `@import './fonts.css'`, which from a scratch directory is a 404 in the
   * console of whoever opens the SVG. The face falls back to `system-ui`, which
   * is what the picture is for: geometry, not typography.
   */
  const strip = (css: string): string =>
    css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import[^;]*;/g, '')

  // `global.css` comes along because its `:root` tokens are what every colour in
  // the other two resolves against — and inside a standalone SVG, `:root` IS the
  // `<svg>` element, so they resolve.
  const STYLE = strip(
    `${sheet('../../styles/global.css')}\n${sheet('../mindtree.css')}\n${sheet(
      '../../components/mindtree/mind-ring.css',
    )}`,
  )

  const tree = treeFixture()

  /**
   * THE LAYOUT UNDER TEST, and the only options it is ever asked for.
   *
   * `{ orientation: 'vertical', wrap: true }` is the owner's decided drawing: a
   * vertical top-down tidy tree whose children wrap into a block under their
   * parent rather than trailing off in one long row. No `sizeOf` is passed, so
   * every card is the SAME size at every level, which is rule one of the design
   * and the thing a picture of uniform cards is meant to show.
   *
   * ⚠ THE SIZE AND THE GAPS ARE THE APP'S, COPIED FROM `pages/Mindtree.tsx`'s
   * one `layoutMindtree` call, and until this line existed they were NOT. The
   * harness took the defaults — 168 × 44 with `{ depth: 56, sibling: 12 }` —
   * while the app drew 132 × 54 with `{ depth: 46, sibling: 14 }`, and this
   * file's own header claimed in the same breath that "these are pictures of the
   * app's drawing". They were pictures of a drawing nobody ships: cards a
   * quarter wider than the real ones, which is exactly the dimension every
   * question about label truncation turns on. The label defect that sent this
   * wave — "Associate Directorate Alpha" drawn as "Associate …" — was INVISIBLE
   * here for that reason.
   *
   * Keep the two in step. If the page's call changes, this changes with it, or
   * the pictures stop being evidence about the product.
   */
  const layout = layoutMindtree<MindNodeModel>(tree, {
    orientation: 'vertical',
    wrap: true,
    direction: 'ltr',
    nodeSize: { width: 168, height: 54 },
    gap: { depth: 46, sibling: 14 },
  })

  const views = viewsFor(tree)
  const matchesById = breachedCounts(tree)
  /** No wedges: a wedge is a rim decoration and the tidy tree draws no rims. */
  const EMPTY_WEDGES: ReadonlyMap<string, readonly { start: number; end: number }[]> = new Map()
  const NO_PULSES: PulseLayerProps['pulses'] = new Map()
  // A stub, cast: `MindDropTargets` reads nothing off it while no drag is in
  // flight, and the layer is still MOUNTED so the picture is of the real tree.
  const DRAG = {
    hintId: 'tree-drag-hint',
    dragging: null,
    over: null,
    targets: [],
  } as unknown as MindDragController

  interface Framing {
    readonly id: string
    /**
     * The layout this picture is of. Present because the folded framing below is
     * a picture of a DIFFERENT TREE — same fixture, some branches collapsed —
     * and a shot that silently reused the open layout would be a picture of the
     * thing it is meant to prove is different.
     */
    readonly layout: typeof layout
    /** The frustum, drawing units. */
    readonly camera: { cx: number; cy: number; width: number; height: number }
    /** CSS px per drawing unit — the camera context's `scale`. */
    readonly scale: number
    readonly viewport: { readonly width: number; readonly height: number }
    readonly note: string
  }

  // The rasteriser's page, and therefore the only viewport any of these
  // pictures is ever seen at.
  const VIEWPORT = { width: 1600, height: 900 } as const
  const ASPECT = VIEWPORT.width / VIEWPORT.height

  /**
   * FRAMING ONE — THE WHOLE TREE.
   *
   * The question it answers is the structural one: does the drawing read as a
   * hierarchy at all. Are a parent's children visibly ONE block rather than a
   * band continuous with the next parent's, do the two directorates separate,
   * does the wrap produce rows a reader can follow.
   *
   * The camera is grown to the viewport's 16:9 rather than left at the bounds'
   * own aspect, because `.mtree-svg` carries `preserveAspectRatio="xMidYMid
   * meet"`: a camera of a different shape would be letterboxed inside the page
   * and `scale` — which this file has to state, since nothing measures the
   * element — would then be a number the drawing does not actually use.
   */
  const margin = 96
  const boundsW = layout.bounds.width + margin * 2
  const boundsH = layout.bounds.height + margin * 2
  const wholeW = Math.max(boundsW, boundsH * ASPECT)
  const wholeH = wholeW / ASPECT
  const whole: Framing = {
    id: 'tree-whole',
    layout,
    camera: {
      cx: layout.bounds.minX + layout.bounds.width / 2,
      cy: layout.bounds.minY + layout.bounds.height / 2,
      width: wholeW,
      height: wholeH,
    },
    scale: VIEWPORT.width / wholeW,
    viewport: VIEWPORT,
    note: 'the whole tree, fitted to 1600×900',
  }

  /**
   * FRAMING TWO — 1600 × 900 AT 1:1.
   *
   * One drawing unit per CSS pixel, which is the zoom at which every constant in
   * `MindNode` and `mindtree.css` was authored: a 168 × 44 card is 168 × 44 px,
   * a 12.5-unit label is 12.5 px of type, a 1-unit stroke is one pixel of ink.
   * This is the framing that answers the owner's actual complaint — what is
   * drawn ON a card when a card is big enough to read — and the one where a
   * stray disc, a missing name or a connector that misses its face is visible
   * rather than inferred.
   *
   * Aimed at the TOP of the drawing, not its centre: the root, the two
   * directorates and as much of the first book's block as 900 px holds is the
   * region where every level, every connector run and the wrap boundary are all
   * in one picture. A camera centred on the bounds would land inside the
   * organization rows, where every card has the same parent and the picture says
   * nothing about hierarchy.
   */
  const root = layout.byId.get(tree.id)
  if (root === undefined) throw new Error('the layout has no root')
  const oneToOne: Framing = {
    id: 'tree-1to1',
    layout,
    camera: {
      cx: root.x + root.width / 2,
      cy: root.y + VIEWPORT.height / 2 - 48,
      width: VIEWPORT.width,
      height: VIEWPORT.height,
    },
    scale: 1,
    viewport: VIEWPORT,
    note: '1600×900 at 1:1, aimed at the crown of the tree',
  }

  /**
   * FRAMING THREE — THE FOLDED BRANCH, which is the gesture the tidy tree is
   * actually driven by.
   *
   * `foldOnActivate` (Mindtree.tsx) makes a TAP on a branch that holds more
   * branches fold it — a book, a directorate, a type — so a reader working this
   * map spends most of their time looking at collapsed cards. The
   * first two framings both picture a fully expanded tree and therefore could
   * not answer the one question that matters about that state: does a card with
   * a hundred organizations inside it look any different from a card with none?
   *
   * It did not. Until the mark below a folded card was added, a collapsed branch
   * drew NO container (the container is what it is hiding) and NO chevron (gated
   * off with the radial drawing's inline-end disc, correctly, for a drawing whose
   * children are below rather than beside) — so it was pixel-for-pixel a leaf.
   * This picture is the evidence for that fix and the thing that catches its
   * removal.
   *
   * WHAT IS COLLAPSED: every book. That leaves both directorates open, so one
   * picture holds the two states side by side — an open branch with its
   * container, and its siblings' folded cards with their counts — which is the
   * comparison a reviewer actually needs to make.
   */
  const foldedTree = foldBooks(tree)
  const foldedLayout = layoutMindtree<MindNodeModel>(foldedTree, {
    orientation: 'vertical',
    wrap: true,
    direction: 'ltr',
    nodeSize: { width: 168, height: 54 },
    gap: { depth: 46, sibling: 14 },
  })
  const foldedRoot = foldedLayout.byId.get(foldedTree.id)
  if (foldedRoot === undefined) throw new Error('the folded layout has no root')
  const folded: Framing = {
    id: 'tree-folded',
    layout: foldedLayout,
    camera: {
      cx: foldedRoot.x + foldedRoot.width / 2,
      cy: foldedRoot.y + VIEWPORT.height / 2 - 48,
      width: VIEWPORT.width,
      height: VIEWPORT.height,
    },
    // 1:1, because the mark is authored in drawing units and 19 of them below a
    // card is a claim about PIXELS that only this scale can be read off.
    scale: 1,
    viewport: VIEWPORT,
    note: '1600×900 at 1:1, every book folded — the mark under a collapsed card',
  }

  const shoot = (framing: Framing): { name: string; bytes: number; nodes: number } => {
    let asked = 0
    const getView = (id: string): MindNodeView | undefined => {
      asked += 1
      return views.get(id)
    }
    const element: ReactElement = (
      <MapCameraContext.Provider
        value={{
          camera: framing.camera,
          scale: framing.scale,
          viewportMinPx: Math.min(framing.viewport.width, framing.viewport.height),
          viewBox: viewBoxOf(framing.camera),
        }}
      >
        <MapCanvas
          canvasRef={() => {}}
          svgRef={{ current: null }}
          layout={framing.layout}
          order={framing.layout.nodes}
          matchesById={matchesById}
          matchWedgesById={EMPTY_WEDGES}
          getView={getView}
          // THE DRAWING UNDER TEST. `pages/Mindtree.tsx` passes exactly this
          // for the tidy tree, so the pictures are of what the app renders and
          // not of a rendering path only this file can reach.
          flat
          rtl={false}
          hintId="tree-hint"
          dimensionLabel="Status"
          motion={false}
          pulses={NO_PULSES}
          dragController={DRAG}
          activeId={null}
          currentId={null}
          cardPos={null}
          cardAnchor={null}
          box={framing.viewport}
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
      </MapCameraContext.Provider>
    )

    // `renderToStaticMarkup` returns the wrapping `.mtree-canvas` div as well;
    // the standalone document is the `<svg>` alone, and the `xmlns` is what makes
    // it a document rather than an inline fragment.
    const markup = renderToStaticMarkup(element)
    const open = markup.indexOf('<svg')
    const close = markup.lastIndexOf('</svg>') + '</svg>'.length
    const body = markup
      .slice(open, close)
      .replace(/^<svg /, '<svg xmlns="http://www.w3.org/2000/svg" ')

    // THE GROUND IS THE viewBox, NOT `100% × 100%`. Both cameras here have a
    // negative minX — the drawing is centred on the tree, not on the origin —
    // and a rect at (0,0) leaves a hard-edged unpainted band down one side of the
    // picture that reads as a rendering bug in the map rather than as a missing
    // background. `:root` inside a standalone SVG IS the `<svg>` element, so
    // `global.css`'s tokens resolve and `var(--bg)` is the app's own ground.
    const view = /viewBox="([^"]+)"/.exec(body)?.[1] ?? '0 0 100 100'
    const [vx, vy, vw, vh] = view.split(/\s+/)
    const first = body.indexOf('>') + 1
    const svg =
      `${body.slice(0, first)}<style>${STYLE}</style>` +
      `<rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="var(--bg)"/>` +
      body.slice(first)
    const name = `${framing.id}.svg`
    fs.writeFileSync(new URL(name, dir), svg)
    return { name, bytes: svg.length, nodes: asked }
  }

  const written = [whole, oneToOne, folded].map((framing) => ({ framing, ...shoot(framing) }))

  /**
   * The stat sheet, one line per picture — the numbers a reviewer would
   * otherwise have to measure off the image by eye, and the ones that say
   * whether a change moved the DRAWING or only the camera.
   */
  const stats = [
    `fixture      nodes=${flatten(tree).length}  orgs=${
      flatten(tree).filter((n) => n.children.length === 0).length
    }  depth=${layout.maxDepth}`,
    `bounds       ${layout.bounds.width.toFixed(0)} × ${layout.bounds.height.toFixed(0)} units`,
    // EDGES ARE NOT DRAWN ANY MORE and the count stays in the sheet anyway: it
    // is the number of per-child connectors the block containers replaced, and
    // the ratio between the two columns is the whole point of the change.
    `edges        ${layout.edges.length}  (laid out, NOT drawn — replaced by containers)`,
    `containers   ${blocksOf(layout).length}  one per parent, enclosing its whole subtree`,
    ...written.map((w) =>
      [
        w.framing.id.padEnd(12),
        `scale=${w.framing.scale.toFixed(4).padStart(8)}`,
        `camera=${w.framing.camera.width.toFixed(0).padStart(6)}×${w.framing.camera.height
          .toFixed(0)
          .padStart(6)}`,
        `views=${String(w.nodes).padStart(4)}`,
        `svg=${String(Math.round(w.bytes / 1024)).padStart(5)}KB`,
        w.framing.note,
      ].join('  '),
    ),
  ].join('\n')
  fs.writeFileSync(new URL('stats.txt', dir), `${stats}\n`)

  // A contact sheet, so the two pictures can be compared side by side without a
  // file manager. Dark ground because the app's default theme is dark and a
  // picture judged on a white page is a picture judged in the wrong light.
  fs.writeFileSync(
    new URL('index.html', dir),
    [
      '<!doctype html><meta charset="utf-8"><title>tree shots — the tidy tree, as drawn</title>',
      '<style>body{background:#0f1117;color:#e6e8ef;font:14px/1.6 system-ui;margin:24px;max-width:1700px}',
      'figure{margin:0 0 32px}img{width:100%;border:1px solid #2a2f3d}',
      'pre{background:#171a23;padding:12px;overflow:auto;font-size:12px}</style>',
      '<h1>the vertical tidy tree, as the renderer draws it</h1>',
      '<p>Regenerated by <code>shoot.sh</code> from the real <code>MapCanvas</code>,',
      ' <code>MindNode</code> and <code>MindEdge</code> under',
      ' <code>layoutMindtree({ orientation: "vertical", wrap: true })</code>.</p>',
      `<pre>${stats}</pre>`,
      ...written.map(
        (w) =>
          `<figure><figcaption><code>${w.name.replace(/\.svg$/, '.png')}</code> — ${
            w.framing.note
          }</figcaption><img src="${w.name.replace(/\.svg$/, '.png')}" alt=""></figure>`,
      ),
    ].join('\n'),
  )
}

/* ═══════════════════════════ 3. the standing gate ═════════════════════════ */

/**
 * THE ONE ASSERTION THE NORMAL SUITE PAYS FOR.
 *
 * It is about the FIXTURE and nothing else, which is the only thing that can be
 * checked in the milliseconds a 5,241-test suite can spare. Its value is that
 * every picture the harness writes is a picture of this workspace: a fixture
 * that drifted — a level lost, a book renamed out of the `am:` prefix that
 * `viewsFor` keys the second line off, a duplicate label — would turn every
 * before/after comparison into a comparison of two different trees, and nothing
 * else in the repository would go red.
 */
describe('treeRender fixture', () => {
  const tree = treeFixture()
  const all = flatten(tree)
  const leaves = all.filter((n) => n.children.length === 0)

  it('is the 120-organization workspace the pictures are of', () => {
    expect(tree.children).toHaveLength(2)
    expect(tree.children.every((d) => d.children.length === 3)).toBe(true)
    expect(tree.children.flatMap((d) => d.children).every((b) => b.children.length === 4)).toBe(true)
    expect(leaves).toHaveLength(120)
    expect(all).toHaveLength(153)
  })

  it('gives every node a label of its own, because the label is the identity in an SVG', () => {
    const labels = all.map((n) => (n.label.kind === 'text' ? n.label.text : n.id))
    expect(new Set(labels).size).toBe(labels.length)
  })

  /**
   * THE GATE THE FOLD MARK IS DRAWN ON, proved against the real layout.
   *
   * A folded branch on the tidy tree draws no container — the container is the
   * thing it is hiding — and the disclosure chevron is gated off for this
   * drawing (MindNode.tsx), so for several commits a collapsed card was
   * pixel-for-pixel a leaf: a book holding twenty organizations looked exactly
   * like an organization holding none. That is the whole of "I cannot tell what
   * is clickable", and it had no test because nothing in the drawing was WRONG
   * — something was missing, and a missing mark asserts nothing.
   *
   * WHAT IS CHECKED HERE IS THE INPUT, not the pixels: that folding a branch
   * really does produce the three facts MindNode's gate reads. The pixels are
   * the harness's job (`tree-folded`, 1:1), because "does this read as openable"
   * is a question about a picture.
   */
  it('gives a folded branch the three facts the fold mark is gated on', async () => {
    const { layoutMindtree } = await import('../../lib/mindtree/layout')
    const folded = layoutMindtree<MindNodeModel>(foldBooks(tree), {
      // The app's own call — see the layout in the shooting block.
      orientation: 'vertical',
      wrap: true,
      direction: 'ltr',
      nodeSize: { width: 168, height: 54 },
      gap: { depth: 46, sibling: 14 },
    })

    const books = ['am:0', 'am:1', 'am:2', 'am:3', 'am:4', 'am:5']
    for (const id of books) {
      const pos = folded.byId.get(id)
      expect(pos, `${id} is not in the folded layout`).toBeDefined()
      if (pos === undefined) continue
      // 1. `hasChildren` — there is something inside.
      expect(pos.hasChildren, `${id} lost hasChildren when folded`).toBe(true)
      // 2. NOT expanded. `MindNode` reads this as `childIds.length > 0`, so a
      //    folded node must draw none of its children.
      expect(pos.childIds, `${id} still draws children when folded`).toHaveLength(0)
      // 3. A hidden count above zero — the gate's last term. Without it the mark
      //    is suppressed, which is right for a leaf and wrong for this.
      expect(pos.hiddenChildCount, `${id} hides nothing`).toBe(4)
    }

    // FOLDING REALLY REMOVES THEM FROM THE DRAWING, which is what makes the
    // mark necessary rather than decorative: with every book folded the layout
    // holds nine nodes — the root, two directorates, six books — and not one of
    // the 120 organizations. There is nothing else on the screen to tell a
    // reader those twenty rows exist.
    expect(folded.nodes).toHaveLength(9)
    expect(folded.byId.has(leaves[0]?.id ?? '')).toBe(false)

    // AND A LEAF STAYS UNMARKED WHEN IT IS DRAWN, which is the other half of the
    // claim: a mark every card carries says nothing. Read off the OPEN layout,
    // because that is the only one an organization appears in.
    const open = layoutMindtree<MindNodeModel>(tree, {
      orientation: 'vertical',
      wrap: true,
      direction: 'ltr',
      nodeSize: { width: 168, height: 54 },
      gap: { depth: 46, sibling: 14 },
    })
    const org = open.byId.get(leaves[0]?.id ?? '')
    expect(org, 'the open layout must draw the organizations').toBeDefined()
    expect(org?.hasChildren, 'an organization must not be marked as openable').toBe(false)
  })

  it('keeps the book ids `viewsFor` reads the second line off', () => {
    const books = tree.children.flatMap((d) => d.children)
    expect(books.map((b) => b.id)).toEqual(['am:0', 'am:1', 'am:2', 'am:3', 'am:4', 'am:5'])
  })

  /**
   * THE GUARD THAT WOULD HAVE CAUGHT THE UNDERSCORE.
   *
   * `viewsFor` decided who gets a progress pair by CHILD COUNT, under a comment
   * claiming `useMapModel` does the same. It does not: `collectProgress` pushes
   * a node's own `entityIdOf` into `nodeIds` before it walks any children, so an
   * Organization is a place holding one organization — itself — and the app
   * draws it a bar. The paraphrase silently withheld that mark from all 120
   * leaves, which is to say from every card in the picture that a reader spends
   * their day looking at, and the only thing that noticed was a typographer
   * reading a 6x crop.
   *
   * SO THE ASSERTION IS ABOUT THE DRAWING, NOT ABOUT THE HELPER'S IMPLEMENTATION.
   * "Every organization with items on it has a length to draw" is a sentence
   * about what the pictures show; re-stating `KIND_ROLE[kind] === 'place'` here
   * would only prove the helper agrees with itself, and would have passed just
   * as happily on the day the rule was wrong.
   *
   * The import is deferred for the reason section 2's is: it keeps the module
   * out of this file's static graph. It is cheap — `mapRenderFixtures` pulls one
   * frozen table and a type — but the discipline is what stops the next helper
   * from being the expensive one.
   */
  it('gives every organization in the picture a progress underscore to draw', async () => {
    const { viewsFor } = await import('./mapRenderFixtures')
    const views = viewsFor(tree)
    const held = leaves.filter((n) => n.count > 0)
    expect(held.length).toBeGreaterThan(90)
    expect(held.every((n) => (views.get(n.id)?.progress?.total ?? 0) > 0)).toBe(true)
    // And an EMPTY organization still draws nothing, by arithmetic rather than
    // by a branch: 0 items is a total of 0, and `MindNode` requires `total > 0`.
    // The hollow dashed card is the one card in the drawing with no bar, and it
    // has to stay that way or "nothing here yet" acquires a mark.
    const empty = leaves.filter((n) => n.count === 0)
    expect(empty.length).toBeGreaterThan(0)
    expect(empty.every((n) => views.get(n.id)?.progress?.total === 0)).toBe(true)
  })

  it('carries the empty and the breached organizations the drawing has to show', () => {
    expect(leaves.some((n) => n.count === 0)).toBe(true)
    expect(leaves.some((n) => n.health.slaBreached)).toBe(true)
    // The breach rolls all the way up, or the higher cards carry no mark and the
    // picture cannot answer "where is the trouble".
    expect(tree.health.slaBreached).toBe(true)
  })
})
