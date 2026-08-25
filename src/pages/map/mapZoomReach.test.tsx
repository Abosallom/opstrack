// U5 — THE PROOF THAT THE REDESIGN DID NOT SPEND ANYTHING IT WAS NOT ALLOWED TO.
//
// `docs/MAP-ZOOM.md` §U5 is a list of contracts the continuous dive must not
// cost: the roving tabindex and its `role="tree"` grammar, the model-sourced
// `aria-posinset`/`aria-setsize`, the Arabic mirror, the accessible table, the
// phone's shipped layout, and WCAG 1.4.10's 320×256 fallback. Every one of them
// is the kind of thing that fails silently — nothing throws, nothing looks
// wrong in a screenshot, and the failure is only visible to a reader who cannot
// tell you about it. So each is asserted here rather than asserted in prose.
//
// ── WHAT THIS FILE CAN AND CANNOT SEE ──────────────────────────────────────
//
// `vitest.config.ts` is `environment: 'node'` and jsdom is not in the
// dependency budget (`MapBranchDetail.test.tsx` opens with the same paragraph).
// So the keyboard is exercised the way it is actually shaped: `useMapKeyboard`
// is a pure grammar over `order` and six injected verbs, and a probe component
// rendered through `renderToStaticMarkup` hands back its `onKeyDown` and
// `activate` for direct calls with plain objects. That is not a compromise —
// it is why the camera arrives as `MapDive` instead of being reached for.
//
// THREE THINGS ARE ASSERTED AGAINST SOURCE TEXT RATHER THAN BEHAVIOUR, and
// each says why in its own block: an import graph (the table's independence
// from the geometry), an SVG mirror rule (there are no logical properties
// inside `<svg>`, so the mirror is arithmetic and arithmetic can be read), and
// a stylesheet (a media guard has no runtime in `node`). A source assertion is
// weaker than a behavioural one and is used only where the alternative is no
// assertion at all.
//
// WHAT IS DELIBERATELY NOT HERE: anything importing `worlds.ts`, `lod.ts` or
// the camera's new surface. Those are U1/U2/U3 and are not in the tree as this
// is written; a test that imports a module that does not exist is a red gate,
// not a contract. The integrator's list at the foot of this file names the four
// assertions that belong to those units' own suites and cannot be written here.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { KeyboardEvent as ReactKeyboardEvent, MutableRefObject } from 'react'

const NODE_FS = 'node:fs'
const { readFileSync } = (await import(NODE_FS)) as {
  readFileSync: (path: URL, encoding: 'utf8') => string
}

// lib/i18n reads localStorage and store/config adds a window listener, both at
// IMPORT time, so the shims cannot wait for a beforeAll().
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

// Types are erased, so they come through a static `import type` while the
// VALUES come through the dynamic import that runs after the shims above.
import type { MapDive, MapKeyboardOptions } from './useMapKeyboard'

const { useMapKeyboard, isDiveTarget, ZOOM_STEP } = await import('./useMapKeyboard')
const { pendingLanding } = await import('./useMapCursor')
const { phoneDetentFor, MAP_DETENTS } = await import('../../lib/mindtree/lens')
const { MIND_DIMENSIONS } = await import('../../lib/mindtree/model')
type MindNodeModel = import('../../lib/mindtree/model').MindNode
type Positioned = import('../../lib/mindtree/layout').PositionedNode<MindNodeModel>

/* ─────────────────────────────── fixtures ─────────────────────────────────── */

/**
 * A three-tier DEPARTMENT tree with an Organization leaf, which is the shape the
 * owner's correction is about: workspace → programme → department →
 * ORGANIZATION, and under the Organization only content (a status bucket with a
 * row in it). Hand-built rather than taken from `buildMindtree` so this file
 * asserts the keyboard and nothing else — a model change must not turn a
 * keyboard test red.
 */
function node(
  id: string,
  kind: MindNodeModel['kind'],
  children: MindNodeModel[] = [],
  /**
   * THE `map_nodes` ROW BEHIND THE CARD, and it stopped being decoration when
   * the tidy tree's tap started asking `entityIdOf` whether this node has
   * details of its own (§8). An `entity` fixture minted with `null` here is a
   * node the panel could not address, so leaving the default on ORG and DEPT
   * would have made §8's central assertion pass for the wrong reason.
   */
  bucketKey: string | null = null,
): MindNodeModel {
  return {
    id,
    kind,
    label: { kind: 'text', text: id },
    count: 1,
    colourVars: {},
    health: { levels: { ok: 1, stale: 0, overdue: 0, critical: 0 }, slaBreached: false },
    children,
    collapsed: false,
    depth: 0,
    entryId: kind === 'entry' ? id : null,
    bucketKey,
    entityType: null,
    retired: false,
  } as MindNodeModel
}

const ENTRY = node('entry:1', 'entry')
const BUCKET = node('group:open', 'group', [ENTRY], 'open')
/** An ORGANIZATION: structural, but every child of it is CONTENT. */
const ORG = node('org', 'entity', [BUCKET], 'org-uuid')
/** A DEPARTMENT: structural, with a structural child. */
const DEPT = node('dept', 'entity', [ORG], 'dept-uuid')
const PROGRAMME = node('track:uhr', 'track', [DEPT])
const ROOT = node('root', 'root', [PROGRAMME])

function positioned(n: MindNodeModel, depth: number, parentId: string | null): Positioned {
  return {
    id: n.id,
    node: n,
    depth,
    x: 0,
    y: 0,
    width: 168,
    height: 44,
    parentId,
    childIds: n.children.map((k) => k.id),
    index: 0,
    siblingCount: 1,
    hasChildren: n.children.length > 0,
    hasHiddenChildren: false,
    hiddenChildCount: 0,
    collapsed: false,
  }
}

const FULL_ORDER: Positioned[] = [
  positioned(ROOT, 0, null),
  positioned(PROGRAMME, 1, 'root'),
  positioned(DEPT, 2, 'track:uhr'),
  positioned(ORG, 3, 'dept'),
  positioned(BUCKET, 4, 'org'),
  positioned(ENTRY, 5, 'group:open'),
]

/** Every call the hook made, in order, as `verb:argument`. */
interface Log {
  readonly calls: string[]
  readonly dive: MapDive
}

function spyDive(surfaces = true): Log {
  const calls: string[] = []
  return {
    calls,
    dive: {
      into: (id) => calls.push(`into:${id}`),
      details: (id) => calls.push(`details:${id}`),
      follow: (id) => calls.push(`follow:${id}`),
      zoomBy: (r) => calls.push(`zoomBy:${r}`),
      home: () => calls.push('home'),
      surface: () => {
        calls.push('surface')
        return surfaces
      },
    },
  }
}

interface Harness {
  readonly onKeyDown: (event: ReactKeyboardEvent<SVGSVGElement>) => void
  readonly activate: (node: MindNodeModel) => void
  readonly moved: string[]
  readonly pending: string[]
  readonly live: string[]
}

/**
 * The hook, run for real, with the drag controller and the stores stubbed at
 * the seam they already have. Hooks run under `renderToStaticMarkup` —
 * `useState`, `useMemo`, `useCallback` and `useRef` all behave; only effects do
 * not, and this hook has none.
 */
function harness(over: Partial<MapKeyboardOptions> = {}): Harness {
  const moved: string[] = []
  const pending: string[] = []
  const live: string[] = []
  let taken: ReturnType<typeof useMapKeyboard> | null = null

  const options: MapKeyboardOptions = {
    dragController: {
      active: false,
      hintId: 'hint',
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
    },
    order: FULL_ORDER,
    activeId: 'dept',
    drawnRoot: ROOT,
    focusView: { node: ROOT, trail: [ROOT], focusId: null, missingId: null },
    drawnEntryIds: [],
    compact: false,
    rtl: false,
    dragging: false,
    entryById: new Map(),
    selection: new Set(),
    meId: 'u1',
    role: 'admin',
    draggedRef: { current: false } as MutableRefObject<boolean>,
    moveCursor: (id) => void (id !== undefined && moved.push(id)),
    setCurrentId: () => {},
    toggleFold: () => {},
    focusBranch: () => {},
    openMenuFor: () => {},
    textOf: () => 'label',
    setLive: (text) => void live.push(text),
    requestPendingFocus: (id) => void pending.push(id),
    ...over,
  }

  function Probe() {
    taken = useMapKeyboard(options)
    return null
  }
  renderToStaticMarkup(<Probe />)
  const api = taken as unknown as ReturnType<typeof useMapKeyboard>
  return { onKeyDown: api.onKeyDown, activate: api.activate, moved, pending, live }
}

interface Key {
  readonly key: string
  readonly ctrlKey?: boolean
  readonly metaKey?: boolean
  readonly altKey?: boolean
  readonly shiftKey?: boolean
}

/** Press one key. Returns whether the map claimed it. */
function press(h: Harness, key: Key): boolean {
  let prevented = false
  h.onKeyDown({
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...key,
    preventDefault: () => void (prevented = true),
  } as unknown as ReactKeyboardEvent<SVGSVGElement>)
  return prevented
}

/** One source file, as text. Empty would make every assertion over it vacuous. */
function source(relative: string): string {
  const text = readFileSync(new URL(relative, import.meta.url), 'utf8')
  if (text.trim() === '') throw new Error(`source is empty: ${relative}`)
  return text
}

/* ───────────────────── 1. the dive is a keyboard gesture ──────────────────── */

describe('the keyboard dives', () => {
  it('Enter on a DEPARTMENT frames it, and on an ORGANIZATION opens the sidebar without moving the camera', () => {
    const dept = spyDive()
    harness({ dive: dept.dive }).activate(DEPT)
    expect(dept.calls).toEqual(['into:dept'])

    // THE LINE THE OWNER CORRECTED. An Organization is a LEAF you arrive at,
    // not a level you enter: the panel opens and the camera does not move by one
    // unit. `calls` holding exactly one entry is that claim — any fly, any
    // follow, any zoom would be a second entry.
    const org = spyDive()
    harness({ dive: org.dive }).activate(ORG)
    expect(org.calls).toEqual(['details:org'])
  })

  it('classifies by STRUCTURE, never by the configured entity name', () => {
    expect(isDiveTarget(PROGRAMME)).toBe(true)
    expect(isDiveTarget(DEPT)).toBe(true)
    // Structural, but its children are all content — the terminus.
    expect(isDiveTarget(ORG)).toBe(false)
    // Content is never a world, whatever it holds. §3's TERMINUS rule.
    expect(isDiveTarget(BUCKET)).toBe(false)
    expect(isDiveTarget(ENTRY)).toBe(false)

    // An admin who adds a tier gets one more dive level with no code change,
    // which is the whole of "the number of zoom levels is the depth of the
    // department tree the admin configures".
    const deeper = node('org', 'entity', [node('sub', 'entity', []), BUCKET])
    expect(isDiveTarget(deeper)).toBe(true)

    // A COHORT IS A WORLD YOU FLY INTO, not a leaf that opens the sidebar.
    // `?by=` puts one between a department and its organizations, and it is the
    // BIGGEST ring on a grouped screen — under the old three-way `root|track|
    // entity` comparison it answered false, so Enter on it called
    // `dive.details()` and handed `cohort:manager:<uuid>` to a panel whose id is
    // a `map_nodes` uuid. Structural in, structural children: both halves.
    const COHORT = node('cohort:cohort%3Amanager%3Asara', 'cohort', [ORG])
    expect(isDiveTarget(COHORT)).toBe(true)
    const cohort = spyDive()
    harness({ dive: cohort.dive }).activate(COHORT)
    expect(cohort.calls).toEqual(['into:cohort:cohort%3Amanager%3Asara'])

    // And it is not reading `entityType`. model.ts forbids it by name: "what a
    // Phase shows and what an Org shows is configuration, not code."
    expect(source('./useMapKeyboard.ts')).not.toMatch(/\.entityType/)
  })

  it('arrows move focus and the camera FOLLOWS — by the minimum move, never a fit', () => {
    const log = spyDive()
    const h = harness({ dive: log.dive })
    expect(press(h, { key: 'ArrowDown' })).toBe(true)
    expect(h.moved).toEqual(['org'])
    expect(log.calls).toEqual(['follow:org'])
  })

  it('Home frames the ROOT world and puts the tab stop on it — one act, two readings', () => {
    const log = spyDive()
    const h = harness({ dive: log.dive })
    press(h, { key: 'Home' })
    expect(h.moved).toEqual(['root'])
    // `home`, not `follow`: "take me back to the top" asks to see the whole
    // thing, not to keep the current magnification.
    expect(log.calls).toEqual(['home'])
  })

  it('keeps the stepped zoom the deleted buttons had — and leaves the browser its own', () => {
    expect(ZOOM_STEP).toBe(1.25)
    const log = spyDive()
    const h = harness({ dive: log.dive })
    expect(press(h, { key: '+' })).toBe(true)
    press(h, { key: '=' })
    press(h, { key: '-' })
    press(h, { key: '_' })
    expect(log.calls).toEqual(['zoomBy:1.25', 'zoomBy:1.25', 'zoomBy:0.8', 'zoomBy:0.8'])

    // Ctrl/Cmd +/− is the BROWSER's page zoom. A map that swallowed it would
    // take away the one magnification a low-vision reader already knows.
    const guarded = spyDive()
    const g = harness({ dive: guarded.dive })
    expect(press(g, { key: '+', ctrlKey: true })).toBe(false)
    expect(press(g, { key: '-', metaKey: true })).toBe(false)
    expect(guarded.calls).toEqual([])
  })

  it('does nothing new when no camera is wired — every key falls back to what it did', () => {
    const h = harness()
    expect(press(h, { key: '+' })).toBe(false)
    expect(press(h, { key: 'ArrowDown' })).toBe(true)
    expect(h.moved).toEqual(['org'])
  })
})

/* ──────────────────── 2. the DOM horizon must not be a wall ───────────────── */

describe('an arrow past the DOM horizon', () => {
  /** ORG culled: it is laid out, it is not drawn. */
  const CULLED = FULL_ORDER.filter((p) => p.id !== 'org')

  it('parks the id and asks the camera to open the way in — it does NOT fit the map', () => {
    const log = spyDive()
    const h = harness({ dive: log.dive, order: CULLED, activeId: 'dept' })
    // `dept`'s only child is `org`, which is past the horizon.
    press(h, { key: 'ArrowRight' })
    expect(h.pending).toEqual(['org'])
    expect(log.calls).toEqual(['into:org'])
    // THE WRONG ANSWER, ASSERTED AS ABSENT: focus did not land on something
    // else, and the camera was not sent to a picture of everything. A reader
    // who asked for one item gets that item.
    expect(h.moved).toEqual([])
    expect(log.calls).not.toContain('home')
  })

  it('lands only on the node itself, and waits otherwise — pendingLanding never falls back', () => {
    expect(pendingLanding(CULLED, 'org')).toBe(null)
    expect(pendingLanding(FULL_ORDER, 'org')).toBe('org')
    expect(pendingLanding(FULL_ORDER, null)).toBe(null)
    // Not "the nearest thing", not "the first row". Null means keep waiting.
    expect(pendingLanding([], 'org')).toBe(null)
  })

  it('walks the shorter array with order[at ± 1] unchanged', () => {
    const log = spyDive()
    const h = harness({ dive: log.dive, order: CULLED, activeId: 'dept' })
    press(h, { key: 'ArrowDown' })
    // `org` is culled, so the next DRAWN node is the bucket. The walk is the
    // same expression over a shorter list — nothing about the grammar changed.
    expect(h.moved).toEqual(['group:open'])
  })
})

/* ─────────────── 3. the grammar the redesign is not allowed to spend ──────── */

describe('the role="tree" contract survives', () => {
  it('swaps Right and Left under rtl, and the swap is the only difference', () => {
    const ltr = spyDive()
    const l = harness({ dive: ltr.dive, activeId: 'dept', rtl: false })
    press(l, { key: 'ArrowRight' })
    expect(ltr.calls).toEqual(['follow:org'])

    const rtl = spyDive()
    const r = harness({ dive: rtl.dive, activeId: 'dept', rtl: true })
    press(r, { key: 'ArrowLeft' })
    expect(rtl.calls).toEqual(['follow:org'])

    // And the mirror is exact: the OTHER arrow steps out, in both languages.
    const back = spyDive()
    const b = harness({ dive: back.dive, activeId: 'dept', rtl: true })
    press(b, { key: 'ArrowRight' })
    expect(back.calls).toEqual(['follow:track:uhr'])
  })

  it('keeps Space as the grab on an item and as Enter’s synonym on a branch', () => {
    // On a BRANCH, Space is still Enter: it dives, exactly as Enter did.
    const branch = spyDive()
    const b = harness({ dive: branch.dive, activeId: 'dept' })
    press(b, { key: ' ' })
    expect(branch.calls).toEqual(['into:dept'])

    // On an ITEM the drag layer declined the lift, so the key is SWALLOWED
    // rather than falling through to "open the entry" — a key that moves the
    // rows you own and opens the ones you do not is the shape ruled out.
    const item = spyDive()
    const i = harness({ dive: item.dive, activeId: 'entry:1', drawnEntryIds: ['entry:1'] })
    expect(press(i, { key: ' ' })).toBe(true)
    expect(item.calls).toEqual([])
    expect(i.live).toHaveLength(1)
  })

  it('keeps Escape a STACK, with the panel third and the world last', () => {
    const closed: string[] = []
    const log = spyDive()
    const h = harness({
      dive: log.dive,
      closePanel: () => {
        closed.push('panel')
        return true
      },
    })
    // The panel is open: Escape closes it and STOPS. Surfacing a world as well
    // would answer one press with two acts.
    expect(press(h, { key: 'Escape' })).toBe(true)
    expect(closed).toEqual(['panel'])
    expect(log.calls).toEqual([])

    // The panel is shut: the next rung is one world out.
    const next = spyDive()
    const n = harness({ dive: next.dive, closePanel: () => false })
    expect(press(n, { key: 'Escape' })).toBe(true)
    expect(next.calls).toEqual(['surface'])
  })

  it('leaves aria-posinset and aria-setsize sourced from the MODEL, never from the cull', () => {
    // THE ONE WAY A DOM HORIZON COULD LIE TO A SCREEN READER: renumbering the
    // set when a sibling is culled — "2 of 2" on a branch that has nine
    // children. It cannot happen while the numbers come from the layout's
    // model-sourced fields and the cull is a filter applied AFTER, so that is
    // what is asserted: the shape of the two expressions, in the two files that
    // own them. Behavioural coverage is impossible without a document; this is
    // the assertion that survives without one.
    const layout = source('../../lib/mindtree/layout.ts')
    expect(layout).toMatch(/siblingCount:\s*node\.parent === null \? 1 : node\.parent\.children\.length/)

    const mindNode = source('../../components/mindtree/MindNode.tsx')
    expect(mindNode).toMatch(/aria-setsize=\{pos\.siblingCount\}/)
    expect(mindNode).toMatch(/aria-posinset=\{pos\.index \+ 1\}/)
    // Not from the drawn list, under any spelling.
    expect(mindNode).not.toMatch(/aria-setsize=\{[^}]*order/)
    expect(mindNode).not.toMatch(/aria-setsize=\{[^}]*drawn/)
  })
})

/* ─────────────────────────── 4. Arabic equals English ─────────────────────── */

describe('the SVG mirror', () => {
  // THERE ARE NO LOGICAL PROPERTIES INSIDE <svg>. Every mark is hand-written x
  // arithmetic, so the mirror is a property of the source and can be read off
  // it. These gates are cheap and they are the ones that catch the two mistakes
  // this codebase has already made once each.
  const MIND = [
    'MindNode.tsx',
    'MindEdge.tsx',
    'PulseLayer.tsx',
    'DragLayer.tsx',
  ] as const

  it('never multiplies text-anchor by the direction — the double-mirror bug is not re-committed', () => {
    // MindNode.tsx:359-368 records it: under `direction: rtl` the anchor
    // keywords ALREADY resolve the other way, so flipping them as well mirrors
    // twice and lands back where it started. `direction` goes on the <g>;
    // `text-anchor` stays constant.
    for (const file of MIND) {
      const text = source(`../../components/mindtree/${file}`)
      expect(text, file).not.toMatch(/textAnchor=\{[^}]*\brtl\b[^}]*\}/)
      expect(text, file).not.toMatch(/text-anchor:\s*\$\{[^}]*\brtl\b/)
    }
    // …and the one place direction IS stated is the group, from `rtl`.
    expect(source('../../components/mindtree/MindNode.tsx')).toMatch(
      /direction=\{rtl \? 'rtl' : 'ltr'\}/,
    )
  })

  it('keeps the outside label’s anchor correct in all four side × direction cases', () => {
    // The CHIP band's label sits outside the box along the ray, so which end of
    // the run is the "outward" end depends on BOTH which side of the hub the
    // node is on AND the reading direction. `(outward.x > cx) !== rtl` is that
    // four-case table as one expression.
    expect(source('../../components/mindtree/MindNode.tsx')).toMatch(
      /\(\s*outward\.x > cx\s*\)\s*!==\s*rtl/,
    )
  })

  it('flips any directional arc’s sweep under rtl — armed before the first arc exists', () => {
    // VACUOUS TODAY AND SAID SO: no component draws an elliptical arc yet. The
    // θ → π − θ mirror turns clockwise into anticlockwise, so a FIXED sweep
    // flag makes a progress arc read as counting DOWN in Arabic — the defect
    // `strip` caught and the one nobody would see in an English screenshot.
    // U2's rim and any progress arc land in these files; this fires the day one
    // of them arrives without the flip.
    for (const file of [...MIND, 'MindWorldRim.tsx'] as const) {
      let text: string
      try {
        text = source(`../../components/mindtree/${file}`)
      } catch {
        continue // not written yet — U2's file, and its absence is not a failure
      }
      const arcs = /\bsweepFlag\b|\bsweep-flag\b|[Aa]\s?\d[\d.]*[ ,]\d[\d.]*[ ,][01][ ,][01]/.test(
        text,
      )
      if (!arcs) continue
      expect(text, `${file} draws an arc and must mirror its sweep`).toMatch(/\brtl\b/)
    }
  })
})

/* ───────────────────────────── 5. the accessible table ────────────────────── */

describe('the accessible table costs this redesign nothing', () => {
  it('reads the MODEL and not the geometry — asserted as an import graph', () => {
    // This is the MITIGATION, not a coincidence. §9 names this design's biggest
    // weakness — a static geometry cannot bring a filtered SET together on the
    // canvas — and the answer is that the table is the honest answer to a set
    // question at every camera position, on every device, with the drag layer
    // off. It can only be that if it does not know where the camera is.
    const table = source('../../components/mindtree/MindtreeTable.tsx')
    const specs = [...table.matchAll(/from '([^']+)'/g)].map((m) => m[1] as string)
    for (const spec of specs) {
      expect(spec, `MindtreeTable must not import ${spec}`).not.toMatch(
        /worlds|\/lod$|mapMotion|useMapGeometry|useMapViewport|camera/,
      )
    }
    // Every NAME it pulls in, so "walks at full depth" is checked at the import
    // rather than in a comment: `visibleChildren()` is the renderers' collapse
    // filter and the table must never take it.
    const imports = [...table.matchAll(/^import[\s\S]*?from '[^']+'/gm)]
      .join('\n')
      .replace(/[{},]/g, ' ')
      .split(/\s+/)
    // What it DOES read is the model, at full depth. `groupTotals` is the same
    // roll-up the picture is drawn from — "two arithmetic paths to one screen is
    // how a branch ends up labelled 12 while its table row says 9" — and the
    // absence of `visibleChildren` is the walk ignoring `collapsed`, which is
    // what keeps the total the same every time somebody clicks a branch.
    expect(table).toMatch(/groupTotals/)
    expect(imports).not.toContain('visibleChildren')
    // The reader's own controls — the depth limit, the folds, the density value
    // — reach it through the TREE the page hands it, which is precisely why a
    // camera position cannot reach it at all.
    expect(table).toMatch(/root: MindNode/)
    expect(MIND_DIMENSIONS.length).toBeGreaterThan(0)
  })
})

/* ────────────────────────────────── 6. the phone ──────────────────────────── */

describe('the phone keeps what already ships', () => {
  const SHEET = source('../mindtree.css')
  const PANEL = source('../../components/map/map-panel.css')
  const CAPTURE = source('../../components/map/map-capture.css')

  it('makes the canvas the largest region BY CONSTRUCTION, not by a scroll position', () => {
    const phone = SHEET.slice(SHEET.indexOf('@media (max-width: 767px) and (min-height: 480px)'))
    expect(phone).toMatch(/grid-template-rows:\s*auto minmax\(0, 1fr\) auto/)
    expect(phone).toMatch(/block-size:\s*calc\(100dvh - var\(--app-header-block-size, 65px\)\)/)
    expect(phone).toMatch(/overflow:\s*hidden/)
  })

  it('reserves the two fixed rails — which is what makes useBoxSize honest', () => {
    // Zero here is the tempting value and it is wrong: with `box-sizing:
    // border-box` and a fixed `100dvh` it puts the last 112px of canvas behind
    // two fixed bars. Reserving them makes the canvas exactly the band the
    // reader can see, and therefore makes the measurement the camera frames
    // against a measurement of something real.
    expect(SHEET).toMatch(
      /padding-block-end:\s*calc\(\s*var\(--map-lens-rail-block-size, 48px\) \+ var\(--map-composer-block-size, 0px\)\s*\)/,
    )
  })

  it('keeps the way back to the map one tap under the thumb: 70 < 71 < 75', () => {
    // The original phone failure was never the sheet's height — it was that at
    // `full` there was no way back to the map. The rail is that way back, and
    // the whole guarantee is three numbers in three files.
    expect(PANEL).toMatch(/z-index:\s*70/)
    expect(SHEET).toMatch(/\.mtree-shellbar\s*\{[^}]*z-index:\s*71/)
    expect(CAPTURE).toMatch(/z-index:\s*75/)
  })

  it('does not downgrade the needs-me landing detent, which §1 prices as paid for', () => {
    expect(phoneDetentFor({ kind: 'needsMe' })).toBe('full')
    // …and an Org tap opens at half, with the map still above it: the context
    // that made the reader tap the node.
    expect(phoneDetentFor({ kind: 'branch', nodeId: 'org' })).toBe('half')
    expect(MAP_DETENTS).toEqual(['peek', 'half', 'full'])
  })

  it('keeps the pan-and-pinch hint, because a thumb has no cursor', () => {
    const en = JSON.parse(source('../../locales/en/mindtree.json')) as {
      mindtree: Record<string, unknown>
    }
    const ar = JSON.parse(source('../../locales/ar/mindtree.json')) as {
      mindtree: Record<string, unknown>
    }
    expect(en.mindtree.mobileHint).toBeTypeOf('string')
    expect(ar.mindtree.mobileHint).toBeTypeOf('string')
  })
})

/* ─────────────────────── 7. WCAG 1.4.10 — the 320×256 case ────────────────── */

describe('reflow at 320×256', () => {
  const SHEET = source('../mindtree.css')

  it('fails BOTH guards there, so the base rule — a document column — is what renders', () => {
    // 400% zoom on 1280×1024 gives a 320×256 CSS viewport. `min-width: 768px`
    // fails; `max-width: 767px` matches but `min-height: 480px` fails. What is
    // left is `.mtree`'s own declaration, and "it falls back" is what everyone
    // says about the path nobody exercises — so the path is read here.
    const stage = '@media (min-width: 768px) and (min-height: 480px)'
    const phone = '@media (max-width: 767px) and (min-height: 480px)'
    expect(SHEET).toContain(stage)
    expect(SHEET).toContain(phone)

    // `indexOf` from the RULE, not from the top of the file: both guard strings
    // are quoted in this sheet's own header prose, and searching from zero would
    // measure a comment.
    const at = SHEET.indexOf('\n.mtree {')
    expect(at).toBeGreaterThan(0)
    const base = SHEET.slice(at, SHEET.indexOf(stage, at))
    // COMMENTS STRIPPED FIRST. This sheet argues in prose inside its own rules —
    // the paragraph under `.mtree` quotes `position: fixed` while explaining why
    // the rail is not fixed here — and a gate that reads an argument instead of
    // a declaration is a gate that fires on a rewrite of the argument.
    const bare = base.replace(/\/\*[\s\S]*?\*\//g, '')
    const decl = bare.slice(0, bare.indexOf('}'))
    expect(decl).toMatch(/display:\s*flex/)
    expect(decl).toMatch(/flex-direction:\s*column/)
    // A fixed-height layout has nowhere to reflow to. Neither of the two ways
    // of writing one may appear in the fallback.
    expect(decl).not.toMatch(/100dvh/)
    expect(decl).not.toMatch(/position:\s*fixed/)
  })

  it('states the phone guard on min-height as well, or 320×256 gets the phone grid', () => {
    // The departure from the contract, kept because it was measured: without
    // `min-height` on the PHONE block, 320×256 matches `max-width: 767px` and
    // lands in the `100dvh` grid — the exact thing the release valve avoids.
    const phoneGuards = [...SHEET.matchAll(/@media \(max-width: 767px\)([^{]*)\{/g)].map(
      (m) => m[1] as string,
    )
    expect(phoneGuards.some((g) => g.includes('min-height: 480px'))).toBe(true)
  })
})

/* ──────────────────── 8. the tidy tree's tap: fold or details ─────────────── */

describe('a tap on the tidy tree', () => {
  /** The tree drawing's activate, with every fold recorded. */
  function tree(over: Partial<MapKeyboardOptions> = {}): {
    readonly h: Harness
    readonly folds: string[]
  } {
    const folds: string[] = []
    const h = harness({ foldOnActivate: true, toggleFold: (id) => void folds.push(id), ...over })
    return { h, folds }
  }

  it('OPENS AN ORGANIZATION’S PANEL, which is the gesture that was unreachable', () => {
    // ⚠ THE BUG, AND IT WAS ONE LINE. `activate`'s tree arm read "a branch with
    //   children folds and returns", and an organization ALWAYS has children —
    //   its status buckets, its rows. So the `dive.details` arm three lines
    //   below it was dead code for every organization on the workspace, the
    //   owner reported "tapping an org only collapses it", and the node menu's
    //   "Open its details" row was left as the sole route to a panel that
    //   docs/MAP-ZOOM.md had specified as a TAP and called "zero new wiring".
    //
    //   ORG here has a child (BUCKET). That is the whole point of the fixture:
    //   a childless organization took the correct arm even before this fix, so
    //   a test written on one would have been green through the entire defect.
    const org = spyDive()
    const { h, folds } = tree({ dive: org.dive })
    h.activate(ORG)
    expect(org.calls).toEqual(['details:org'])
    // AND NOTHING FOLDED. Two acts on one tap — a panel opening while the card
    // under the finger collapses — would be worse than either alone.
    expect(folds).toEqual([])
    // `calls` holding exactly one entry is also the "camera does not move by one
    // unit" claim: any into/follow/zoom would be a second entry.
    expect(h.live).toHaveLength(1)
    expect(h.live[0]).toContain('label')
  })

  it('gives a DEPARTMENT the fold AND its details, because the owner said any cell', () => {
    // THE FOLD IS NOT NEGOTIABLE, and that is why this is an "and" rather than a
    // swap. `openDepthFor` opens one rung shallower than the deepest entity
    // (useMapModel.ts), so the opening frame is a row of CLOSED departments; the
    // chevron under a card measures about 3px at map scale, well under
    // MindNode's own audit rule. Answer a department's tap with a sidebar
    // INSTEAD and the reader has no gesture left for reaching the organizations
    // underneath — the map would have no way in.
    //
    // But six of the seven cards on that opening frame ARE departments, and the
    // owner's sentence was "if i clicked any cell in the map, a side opens with
    // details of that cell". Fold-only made "any cell" false for almost every
    // cell a reader meets first.
    //
    // So: both. They do not compete for anything — one writes the canvas, the
    // other fills the card at the side, and neither moves the camera.
    const dept = spyDive()
    const { h, folds } = tree({ dive: dept.dive })
    h.activate(DEPT)
    expect(folds).toEqual(['dept'])
    expect(dept.calls).toEqual(['details:dept'])
    // ONE ENTRY, and it is `details`. An `into` or a `follow` beside it would be
    // the camera moving, which a tap on a tidy tree must never do.
    expect(dept.calls).toHaveLength(1)
    // `panelBranch`, not `panelOrg`: you are INSIDE a department and you ARRIVE
    // AT an organization, and `Mindtree.tsx` titles the two surfaces by exactly
    // that split — so the announcement cannot drift from the heading.
    expect(h.live).toHaveLength(1)
    expect(h.live[0]).toContain('label')
    // The fold itself stays unannounced: `aria-expanded` changes with it and IS
    // the announcement, so only the panel — which a reader cannot infer — speaks.
  })

  it('folds every branch with nothing behind it — bucket, cohort, "+N more"', () => {
    // THE TEST IS `entityIdOf`, NOT A KIND NAME. A group's `bucketKey` is a
    // status key and a cohort's is synthetic (`manager:<uuid>`), so neither can
    // address a `map_nodes` row and neither has a panel to open — which is the
    // same refusal, made in the same place, that keeps a synthetic key away from
    // a uuid column.
    const COHORT = node('cohort:manager', 'cohort', [ORG], 'manager:sara')
    for (const branch of [BUCKET, COHORT]) {
      const log = spyDive()
      const { h, folds } = tree({ dive: log.dive })
      h.activate(branch)
      expect(folds, branch.id).toEqual([branch.id])
      expect(log.calls, branch.id).toEqual([])
    }

    // "+N more" is answered above this arm entirely and must stay that way: it
    // is a drawing artefact standing for hidden siblings, not a node.
    const { h, folds } = tree()
    h.activate(node('more:1', 'more', [ENTRY]))
    expect(folds).toEqual(['more:1'])
  })

  it('falls back to the fold when no camera is wired, for organizations too', () => {
    // The hook's standing promise: `dive` absent, every gesture behaves exactly
    // as it did before the camera existed. There is no panel to open without
    // it, so the fold is the best a tap can honestly do.
    const { h, folds } = tree({ dive: undefined })
    h.activate(ORG)
    expect(folds).toEqual(['org'])
  })

  it('leaves the CONTAINMENT drawing’s tap exactly where it was', () => {
    // `foldOnActivate` off is the radial build, and this fix must not touch it:
    // there a department is a world you fly into and an organization is a leaf
    // whose panel opens without the camera moving. Section 1 asserts both; this
    // is the guard that the new arm is gated on the flag rather than replacing
    // them.
    const org = spyDive()
    harness({ dive: org.dive }).activate(ORG)
    expect(org.calls).toEqual(['details:org'])
    const dept = spyDive()
    harness({ dive: dept.dive }).activate(DEPT)
    expect(dept.calls).toEqual(['into:dept'])
  })
})

/* ──────────────────────────────────────────────────────────────────────────────
   FOUR ASSERTIONS THIS FILE CANNOT WRITE, AND WHOSE SUITE THEY BELONG IN.

   Each needs a module that is not in the tree as this is written. They are
   listed rather than stubbed, because a test importing a module that does not
   exist is a red gate and not a contract.

   · `layoutWorlds(tree, {direction:'rtl'})` is the EXACT reflection of the ltr
     layout about the hub, with BYTE equality on the root's x — U1's
     `worlds.test.ts`. The symmetric padding at radial.ts:275-294 is what makes
     byte equality possible rather than equality to nine places, so the
     assertion belongs beside it.
   · The CARD progress underscore's fill grows from the READING start —
     `x = rtl ? width - PAD - fillW : PAD` — U2's `MindNode` suite, where the
     mark is drawn.
   · The MATCH RIM arc's `sweep-flag` flips under rtl — U2's
     `MindWorldRim.test.tsx`. §4 gate above is armed for it and will fire the
     day the arc lands unmirrored in a file this test can see.
   · The camera's return framing after a dive-and-surface equals the departure
     framing TO THE UNIT — U3's `mapMotion.test.ts`. That equality is the whole
     payoff of absolute coordinates and it is a property of `frameCamera`, not
     of anything reachable from here.
   ────────────────────────────────────────────────────────────────────────── */
