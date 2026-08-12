// THE THREE WORKSPACES THE RENDER GATE LOOKS AT, and the five cameras it looks
// at them from. Pure data and pure builders: no `Date.now()`, no `Math.random()`,
// no store, no `t()`, no DOM. Two consumers read this file — `mapRender.test.tsx`
// (the blocking gate) and `scripts/lookat.mjs` through it (the committed
// pictures) — and they must be looking at the SAME workspace, or a green gate and
// an ugly picture are both true at once and neither is evidence.
//
// ── WHY THE TREES ARE HAND-BUILT AND NOT `buildMindtree`'d ─────────────────
//
// `mapZoomReach.test.tsx` opens with this same paragraph and it is the same
// reason: a model change must not turn a RENDERING test red. What this gate
// measures is the drawing — how big a glyph lands on the glass, whether a stroke
// survives the camera, whether a name is drawn twice — and every one of those is
// a fact about `worlds.ts` + `MindNode` + `MindWorldRim` + the two stylesheets.
// Handing them a tree built by `model.ts` from a fake entry list would put a
// second, unrelated failure mode inside every assertion.
//
// ── THE SHAPE, AND WHY IT IS THIS SHAPE ────────────────────────────────────
//
// The plan's own default at 400 organizations:
//
//     root → Onboarding → AD (2) → AM (3) → type (6) → org (~22)
//
// Depth 5, which is inside the frozen depth cap of 6 with one tier to spare —
// the tier the `'cohort'` kind will take in wave 6. `small` is the same shape
// with the two people tiers collapsed out: it is the workspace Aziz actually has
// today, and it is here so that a fix which only works at 400 organizations is
// visible as one that broke 19.
//
// ── WHAT IS DELIBERATELY IN THE DATA ───────────────────────────────────────
//
//  · EMPTY ORGANIZATIONS (`count: 0`). `mindtree.css`'s `.mtree-node[data-empty] .mtree-node-box` draws them as a
//    transparent box with a `2 4` dash, and defect 5 is that at the shipped
//    card scale the dash is 0.008 CSS px of ink — an organization nobody has
//    filed anything under renders as NOTHING, which is indistinguishable from
//    one that does not exist. The gate counts their ink.
//  · BREACHED SUBTREES. `MindWorldRim`'s match arc is the map's one answer to
//    "where is the trouble", and defect 14 is that its 4-unit stroke renders at
//    0.016 px. There is no way to assert an arc that is never asked for, so two
//    of the three fixtures carry breaches.
//  · UNIQUE LABELS, every node. The double-label check (defect 7) has no node id
//    to work with — `MindWorldRim` draws a name and does not say whose it is —
//    so the label text IS the identity, and two nodes sharing one would make
//    that check report a defect the drawing does not have.

import type { CSSProperties } from 'react'
import type { MindNodeView } from '../../components/mindtree/MindNode'
import type { MindNode } from '../../lib/mindtree/model'

/**
 * A track colour pair, exactly as `trackStyle.trackVars()` produces it and
 * `model.ts` staples it on. THE ONLY WAY A HUE ENTERS THE DRAWING — so a
 * fixture that left it `{}` would render the whole map in the fallback border
 * colour and defect 8 (every track landing on the same slate) would be
 * unobservable by construction.
 */
function ink(dark: string, light: string): CSSProperties {
  return { '--track-c-dark': dark, '--track-c-light': light } as CSSProperties
}

const ONBOARDING = ink('#9884d6', '#6b5bb5')

interface NodeSpec {
  readonly id: string
  readonly kind: MindNode['kind']
  readonly label: string
  readonly children?: readonly MindNode[]
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
 * fixture that produced it.
 */
function node(spec: NodeSpec): MindNode {
  const children = [...(spec.children ?? [])]
  const rolled = children.reduce((sum, child) => sum + child.count, 0)
  const breachedBelow = children.some((child) => child.health.slaBreached)
  return {
    id: spec.id,
    kind: spec.kind,
    label: { kind: 'text', text: spec.label },
    count: spec.count ?? (children.length === 0 ? 1 : rolled),
    colourVars: spec.colourVars ?? ONBOARDING,
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

/** The six organization types every account manager's book is split by. */
const TYPES = ['Hospitals', 'Polyclinics', 'Labs', 'Pharmacies', 'Dental', 'Optical'] as const

/**
 * `n` organizations under one type, numbered from `from` so every label in the
 * whole workspace is unique — see the header on why that is load-bearing.
 *
 * EVERY SIXTH ONE IS EMPTY and every eleventh is breached, by index rather than
 * by a random draw, so the same fixture produces the same picture on every
 * machine and a committed SVG diff means a code change and nothing else.
 */
function orgs(prefix: string, from: number, n: number): MindNode[] {
  const out: MindNode[] = []
  for (let i = 0; i < n; i += 1) {
    const serial = from + i
    out.push(
      node({
        id: `${prefix}:org:${serial}`,
        kind: 'entity',
        label: `Org ${String(serial).padStart(3, '0')}`,
        count: serial % 6 === 0 ? 0 : 1 + (serial % 4),
        breached: serial % 11 === 0,
      }),
    )
  }
  return out
}

/** THE 19-ORGANIZATION WORKSPACE — what Aziz has on the live project today. */
function smallTree(): MindNode {
  let serial = 1
  const types = TYPES.slice(0, 3).map((label, index) => {
    const count = [7, 7, 5][index] as number
    const kids = orgs(`type:${index}`, serial, count)
    serial += count
    return node({ id: `type:${index}`, kind: 'entity', label, children: kids })
  })
  return node({
    id: 'root',
    kind: 'root',
    label: 'NphiesCore',
    colourVars: {},
    children: [node({ id: 'track:ob', kind: 'track', label: 'Onboarding', children: types })],
  })
}

/**
 * THE 400-ORGANIZATION WORKSPACE — 2 Associate Directors, 3 account managers,
 * six types each, ~22 organizations per type.
 *
 * The counts are stated rather than computed to a round number, because the real
 * portfolio will not divide evenly either and a fixture that does hides the
 * ragged-ring case entirely.
 */
function largeTree(): MindNode {
  // `short` leads every type label, and that is not decoration: `MindNode`
  // truncates by GLYPH COUNT against `CHAR_PX`, so "Polyclinics — Sara
  // Al-Otaibi" and "Polyclinics — Faisal Al-Harbi" both clip to
  // "Polyclinics —…" and the double-label check — which has only the text to go
  // on — would report a defect the drawing does not have. The distinguishing
  // characters go FIRST.
  const BOOKS: readonly {
    readonly ad: string
    readonly am: string
    readonly short: string
    readonly per: readonly number[]
  }[] = [
    { ad: 'Directorate North', am: 'Sara Al-Otaibi', short: 'SA', per: [23, 22, 22, 22, 22, 22] },
    { ad: 'Directorate North', am: 'Faisal Al-Harbi', short: 'FH', per: [23, 22, 22, 22, 22, 22] },
    { ad: 'Directorate South', am: 'Nouf Al-Qahtani', short: 'NQ', per: [23, 22, 22, 22, 22, 22] },
  ]
  let serial = 1
  const byDirectorate = new Map<string, MindNode[]>()
  for (const [bookIndex, book] of BOOKS.entries()) {
    const types = TYPES.map((label, typeIndex) => {
      const count = book.per[typeIndex] as number
      const prefix = `am:${bookIndex}:type:${typeIndex}`
      const kids = orgs(prefix, serial, count)
      serial += count
      return node({ id: prefix, kind: 'entity', label: `${book.short} ${label}`, children: kids })
    })
    const am = node({ id: `am:${bookIndex}`, kind: 'entity', label: book.am, children: types })
    const list = byDirectorate.get(book.ad) ?? []
    list.push(am)
    byDirectorate.set(book.ad, list)
  }
  const ads = [...byDirectorate].map(([label, ams], index) =>
    node({ id: `ad:${index}`, kind: 'entity', label, children: ams }),
  )
  return node({
    id: 'root',
    kind: 'root',
    label: 'NphiesCore',
    colourVars: {},
    children: [node({ id: 'track:ob', kind: 'track', label: 'Onboarding', children: ads })],
  })
}

/**
 * The view models, built the way `useMapModel`'s `views` memo builds them —
 * label, name, count, the two tooltips, the second line and the progress pair —
 * but WITHOUT `t()` and without a store.
 *
 * NOT ISOLATED, and that is deliberate: `isolate()` wraps every label in FSI/PDI,
 * and the gate reads label text back out of the emitted SVG to answer "is this
 * name drawn twice". Two invisible controls around every comparison would make
 * every mismatch a puzzle, and the isolation is `lib/bidi`'s contract, asserted
 * in `lib/bidi.test.ts` where the string is the subject rather than the vehicle.
 */
export function viewsFor(tree: MindNode): ReadonlyMap<string, MindNodeView> {
  const out = new Map<string, MindNodeView>()
  const walk = (n: MindNode, manager: string | null): void => {
    const text = n.label.kind === 'text' ? n.label.text : n.id
    const live = Math.min(n.count, Math.max(0, n.count - (n.health.slaBreached ? 2 : 1)))
    out.set(n.id, {
      label: text,
      name: `${text}, ${n.count} open`,
      count: String(n.count),
      toggleHint: n.children.length === 0 ? null : `Collapse ${text}`,
      breachHint: n.health.slaBreached ? 'Past deadline' : null,
      // The underscore only means anything where the roll-up covers the node,
      // which is every structural node and no leaf — `useMapModel` returns null
      // for the rest and this does the same.
      progress: n.children.length === 0 ? null : { done: live, total: n.count },
      // An Organization's second line: account manager, then vendor. Null on
      // every department, exactly as `secondaryOf` returns null off a row it
      // cannot find.
      secondary: n.children.length === 0 && manager !== null ? `${manager}, Vendor A` : null,
    })
    const below = n.kind === 'entity' && n.children.length > 0 && n.id.startsWith('am:') && !n.id.includes('type')
      ? text
      : manager
    for (const child of n.children) walk(child, below)
  }
  walk(tree, null)
  return out
}

/**
 * Breached items at or under every node — `useMapModel`'s `stats.breached`
 * roll-up, which is what `Mindtree.tsx`'s `matchesById`/`matchWedgesById` memo turns into the rim's match count
 * and its wedges. Reproduced here rather than imported because that fold lives
 * inside a hook that needs four stores to exist.
 */
export function breachedCounts(tree: MindNode): ReadonlyMap<string, number> {
  const out = new Map<string, number>()
  const walk = (n: MindNode): number => {
    let total = n.children.length === 0 && n.health.slaBreached ? 1 : 0
    for (const child of n.children) total += walk(child)
    out.set(n.id, total)
    return total
  }
  walk(tree)
  return out
}

/** Every organization the fixture filed nothing under — defect 5's subjects. */
export function emptyOrgIds(tree: MindNode): readonly string[] {
  const out: string[] = []
  const walk = (n: MindNode): void => {
    if (n.children.length === 0 && n.count === 0) out.push(n.id)
    for (const child of n.children) walk(child)
  }
  walk(tree)
  return out
}

/**
 * The four worlds every camera is aimed at, per fixture.
 *
 * `reader` WAS THE WAVE-5 SEAM AND IS NOW THE CLAIM. `focus.defaultFocusFor(meId,
 * role, tree)` exists, and the gate asserts that the OPENING camera — resolved
 * through it — frames exactly this world for `MAP_READER`. It is still named
 * separately because the two answer different questions: `reader` proves the
 * GEOMETRY can deliver six cards, `opening` proves the CAMERA chooses that
 * world, and a wave that broke only the second would otherwise look like a wave
 * that broke the packing.
 *
 * `small` HAS NO ACCOUNT MANAGERS IN IT — it is the 19-organization workspace
 * Aziz has today — so `defaultFocusFor` falls back to the workspace opening
 * there and the gate asserts the fallback rather than this anchor. `type:0` is
 * still the world its six-card claim is measured on.
 */
export interface FixtureAnchors {
  /** The world an account manager's map must open on. */
  readonly reader: string
  /** Two dives in from the workspace — a Directorate. */
  readonly dived: string
  /** One Organization: the terminus, where the dive stops. */
  readonly org: string
}

/** The reader the opening camera is resolved for: an account manager. */
export const MAP_READER: Readonly<{ meId: string; role: string }> = Object.freeze({
  meId: 'am:1',
  role: 'member',
})

export interface Fixture {
  readonly id: string
  readonly rtl: boolean
  readonly orgCount: number
  readonly tree: MindNode
  readonly anchors: FixtureAnchors
}

/**
 * The three workspaces. `large-rtl` is `large`'s TREE — the identical object
 * graph, built twice from the same builder — laid out with `direction: 'rtl'`,
 * so any difference the gate finds between them is the mirror and cannot be the
 * data.
 */
export function fixtures(): readonly Fixture[] {
  const small = smallTree()
  return [
    {
      id: 'small',
      rtl: false,
      orgCount: 19,
      tree: small,
      anchors: { reader: 'type:0', dived: 'track:ob', org: 'type:0:org:1' },
    },
    {
      id: 'large',
      rtl: false,
      orgCount: 400,
      tree: largeTree(),
      anchors: { reader: 'am:1', dived: 'ad:0', org: 'am:1:type:0:org:134' },
    },
    {
      id: 'large-rtl',
      rtl: true,
      orgCount: 400,
      tree: largeTree(),
      anchors: { reader: 'am:1', dived: 'ad:0', org: 'am:1:type:0:org:134' },
    },
  ]
}

/**
 * Which world a camera is aimed at.
 *
 * `opening` is resolved by the caller through `defaultFocusFor` and falls back to
 * the drawn root only where the reader owns nothing. `reader` names the same
 * world DIRECTLY. The gate uses both: `reader` proves the geometry can deliver
 * the histogram, `opening` proves the camera chooses that world.
 */
export type CameraAim = 'opening' | 'reader' | 'dived' | 'org' | 'root'

export interface CameraSpec {
  readonly id: string
  /** The canvas element, CSS px. The shell's own two sizes. */
  readonly viewport: { readonly width: number; readonly height: number }
  /**
   * `frameCamera`'s fill. `apparent = frameFill × min(viewport)`, exactly — which
   * is why a fill is the honest way to name a camera: it says how big the framed
   * world lands on the glass, in the same units the LOD bands are cut in.
   */
  readonly frameFill: number
  readonly aim: CameraAim
}

/**
 * THE FIVE CAMERAS — the render harness's own five, restated as arithmetic.
 *
 * `zoomed-in`'s fill is 0.62 rather than the desktop 0.87 for a reason worth
 * stating: at 0.87 an Organization's world lands at 727 CSS px, past the
 * `0.85 × V = 710` frame edge, and `MindNode` draws NOTHING at `frame` — the
 * world is the stage by then. 0.62 puts it at 518 px, inside the `opening` band,
 * which is the one camera where a terminal card is still drawn AND its world's
 * rim is drawn over it. That coincidence is defect 7, and this is the only
 * camera that can see it.
 */
export const CAMERAS: readonly CameraSpec[] = Object.freeze([
  { id: 'opening', viewport: { width: 1600, height: 835 }, frameFill: 0.87, aim: 'opening' },
  { id: 'dived-two', viewport: { width: 1600, height: 835 }, frameFill: 0.87, aim: 'dived' },
  { id: 'phone', viewport: { width: 375, height: 587 }, frameFill: 1.25, aim: 'opening' },
  { id: 'zoomed-out', viewport: { width: 1600, height: 835 }, frameFill: 0.4, aim: 'root' },
  { id: 'zoomed-in', viewport: { width: 1600, height: 835 }, frameFill: 0.62, aim: 'org' },
])
