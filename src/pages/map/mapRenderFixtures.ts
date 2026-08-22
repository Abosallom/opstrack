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
import { KIND_ROLE, type MindNode } from '../../lib/mindtree/model'

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

/**
 * THE SEVEN STAGES 0026 SEEDS, plus the pile of organizations nobody has staged.
 *
 * The eighth entry is `''` — `NO_VALUE`, the key `model.ts` buckets "not
 * recorded" under — and it TRAILS the declared rungs exactly as `bucketBy` puts
 * it: an unset stage is a filing gap and filing gaps go last.
 */
const STAGES = [
  'Not started',
  'Kickoff',
  'Integrating',
  'Testing/UAT',
  'Go-live ready',
  'Live',
  'Paused',
  'Unstaged',
] as const

/**
 * The three account managers, plus the organizations no AM has claimed.
 *
 * FIRST NAMES, unlike `largeTree`'s full ones, and the reason is the glyph
 * budget rather than realism: a book cohort is a card INSCRIBED in its
 * children's ring (`room` ≈ 66 units, ~13 glyphs), and it has to carry a stage
 * prefix as well because thirty-two of these labels have to be distinct inside
 * one picture. "S3 Sara Al-Otaibi" clips to "S3 Sara Al-…" and the committed
 * picture stops being one a reviewer can read. `largeTree` already carries the
 * long-label truncation case; this fixture's job is the RING.
 */
const BOOKS_BY_NAME = ['Unclaimed', 'Sara', 'Faisal', 'Nouf'] as const

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
 * THE SAME 400 ORGANIZATIONS UNDER `?by=stage` — the shape `groupEntities`
 * actually produces, drawn so that the wave's rings can be LOOKED AT.
 *
 * ── WHY A FOURTH FIXTURE AND NOT A RELABELLING OF `large` ──────────────────
 *
 * `large` is the hierarchy an admin CONFIGURED: two Associate Directors, three
 * account managers, six kinds, every tier a real `map_nodes` row. This one is
 * what the reader gets when they press a grouping chip, and its rings are
 * SYNTHETIC — `kind: 'cohort'`, no row behind them. The two are different
 * pictures of one portfolio and the gate has to measure both, because the
 * numbers differ in the one direction that matters: eight stage cohorts and
 * four books is a ring of 8 over a ring of 4, where `large` is 2 over 3 over 6.
 * A ring's width is what sets its children's apparent size, so a floor that
 * holds at 6 is not evidence about 13.
 *
 * ── THE SHAPE IS THE MODEL'S, TAKEN FROM THE MODEL ─────────────────────────
 *
 * `model.test.ts`'s 400-organization portfolio under `grouping: 'stage'` at
 * `RING_CAP` produces exactly this: the phase's ring is cut by stage (seven
 * declared rungs plus the unstaged pile), every one of those is still over the
 * cap, so the ladder spends `manager` on each — three account managers plus the
 * unclaimed pile — and the books land at 12-13 organizations, under the cap and
 * named. Two cohort rings, organizations at depth 5. The numbers here are that
 * tree's numbers; the assertion that they stay that tree's numbers lives in
 * `model.test.ts` (`the ring cap holds over EVERY axis and BOTH devices`),
 * because that is a claim about the MODEL and this file must not turn red when
 * the model changes shape — the header's first argument.
 *
 * ── WHAT IT IS EXPECTED TO SHOW, AND WHY THAT IS NOT A DEFECT ──────────────
 *
 * The opening camera does NOT land on an account manager's book here, and it is
 * the grouping that decides that rather than a miss: `defaultFocusFor` descends
 * while one child holds every mark the reader owns, and under `?by=stage` an
 * AM's organizations are scattered across all eight stage rings. So it stops at
 * the phase and the reader opens one ring wider — on the whole stage ladder,
 * which is the picture `?by=stage` was pressed to see. Under `?by=manager` the
 * same walk descends into the reader's own cohort, because every mark is in it.
 */
function groupedTree(): MindNode {
  // 400 organizations over eight stages and four books, RAGGED ON PURPOSE: the
  // real ladder has a fat middle (most work is Integrating) and a thin top, and
  // a fixture that divided 400 by 32 would draw a ring of identical marks and
  // hide the case where one cohort's children are twice another's.
  // Unclaimed · Sara · Faisal · Nouf, per rung. They sum to 400, and the widest
  // book is 24 — the cap EXACTLY, which is the ring `model.ts` leaves as
  // organizations rather than cutting again ("a small group never cohorts"), so
  // this fixture draws the boundary case rather than a comfortable margin.
  const PER_STAGE: readonly (readonly number[])[] = [
    [4, 12, 12, 12], // Not started      40
    [3, 14, 15, 13], // Kickoff          45
    [6, 24, 24, 24], // Integrating      78 — the fat rung, and the cap exactly
    [6, 19, 18, 17], // Testing/UAT      60
    [4, 13, 12, 11], // Go-live ready    40
    [4, 18, 18, 17], // Live             57
    [1, 9, 8, 7], //    Paused           25
    [10, 16, 15, 14], // Unstaged        55 — the filing gap, and it is not small
  ]
  let serial = 1
  const stages = STAGES.map((stage, stageIndex) => {
    const books = BOOKS_BY_NAME.map((book, bookIndex) => {
      const count = PER_STAGE[stageIndex]?.[bookIndex] ?? 0
      // THE STAGE NUMBER LEADS EVERY LABEL, for `largeTree`'s reason spelled
      // out there: `MindNode` truncates by GLYPH COUNT, so "Sara" under eight
      // different stages would clip to eight identical strings and the
      // double-label check — which has only the text to go on — would report a
      // defect the drawing does not have. The distinguishing characters go
      // FIRST, and here that is the rung the book is standing on.
      const prefix = `cohort:st:${stageIndex}:mgr:${bookIndex}`
      const kids = orgs(prefix, serial, count)
      serial += count
      return node({
        id: prefix,
        kind: 'cohort',
        label: `S${stageIndex + 1} ${book}`,
        children: kids,
      })
    })
    return node({
      id: `cohort:st:${stageIndex}`,
      kind: 'cohort',
      label: `${stageIndex + 1}. ${stage}`,
      children: books,
    })
  })
  // THE PHASE IS STILL AN `entity`, and that is the seam this fixture is for:
  // a cohort ring hangs off a REAL node, so the drawing has to carry both kinds
  // in one branch. `groupEntities` runs at `structuralNode`'s plans walk, which
  // is every structural node, so a cohort's parent is always one of these.
  const phase = node({ id: 'ob', kind: 'entity', label: 'Onboarding', children: stages })
  return node({
    id: 'root',
    kind: 'root',
    label: 'NphiesCore',
    colourVars: {},
    children: [node({ id: 'track:ob', kind: 'track', label: 'Onboarding programme', children: [phase] })],
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
  /**
   * ORGANIZATIONS STRICTLY BELOW EVERY NODE — `useMapModel.collectStats`'s
   * `orgsBelow` fold, reproduced here for the reason the whole file exists: that
   * one lives inside a hook that needs four stores, and a picture of the card
   * has to show the numeral the card actually draws.
   *
   * The rule is `collectStats`' rule, not a paraphrase of it: an entity with no
   * entity beneath it IS an organization and counts ONE for its parent; an
   * entity with organizations beneath it is a place and contributes THEIRS.
   * A directorate is a `map_nodes` row too, so counting it among the things it
   * holds is what turns eighteen hospitals into nineteen.
   */
  const orgsBelow = new Map<string, number>()
  const fold = (n: MindNode): number => {
    let total = 0
    for (const child of n.children) {
      const kids = fold(child)
      total += child.kind === 'entity' && kids === 0 ? 1 : kids
    }
    orgsBelow.set(n.id, total)
    return total
  }
  fold(tree)
  const walk = (n: MindNode, manager: string | null): void => {
    const text = n.label.kind === 'text' ? n.label.text : n.id
    const live = Math.min(n.count, Math.max(0, n.count - (n.health.slaBreached ? 2 : 1)))
    out.set(n.id, {
      label: text,
      name: `${text}, ${n.count} open`,
      count: String(n.count),
      // The numeral a card that HOLDS organizations draws instead of its open
      // count — null on an organization, an entry, a bucket and a fold, which is
      // `useMapModel`'s own `stat.orgsBelow > 0` test.
      orgs: (orgsBelow.get(n.id) ?? 0) > 0 ? String(orgsBelow.get(n.id)) : null,
      toggleHint: n.children.length === 0 ? null : `Collapse ${text}`,
      breachHint: n.health.slaBreached ? 'Past deadline' : null,
      // WHO GETS AN UNDERSCORE — `KIND_ROLE[kind] === 'place'`, which is
      // `useMapModel.collectProgress`'s own guard copied verbatim rather than
      // paraphrased, because the paraphrase was WRONG and the pictures were
      // wrong with it.
      //
      // It read `children.length === 0 ? null : …`, with a comment claiming that
      // "the roll-up covers every structural node and no leaf" and that
      // `useMapModel` returns null for the rest. It does not. `collectProgress`
      // pushes the node's OWN `entityIdOf` into `nodeIds` before it walks any
      // children, so an Organization with nothing under it is still a place
      // holding one organization — itself — and the app draws it a bar. What is
      // actually skipped is a `bucket` (a "+N more" fold, a group) and a `leaf`
      // (an `entry` is an ISSUE, and "3 of 9 live" under one bug report is a
      // category error), and both of those are kinds, not child counts.
      //
      // The cost of the paraphrase was 120 organizations drawn without a mark
      // they carry in the product, in the only pictures anyone judges the tidy
      // tree from — so the one thing every leaf card in the drawing has, its
      // underscore, was the one thing no picture had ever tested for fit.
      //
      // An EMPTY organization still draws nothing, and by arithmetic rather than
      // by a branch: `count` 0 makes `total` 0, and `MindNode` requires
      // `total > 0`. The hollow dashed card stays hollow.
      progress: KIND_ROLE[n.kind] === 'place' ? { done: live, total: n.count } : null,
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
 * The four workspaces. `large-rtl` is `large`'s TREE — the identical object
 * graph, built twice from the same builder — laid out with `direction: 'rtl'`,
 * so any difference the gate finds between them is the mirror and cannot be the
 * data.
 *
 * `large-grouped` IS THE SAME 400 ORGANIZATIONS UNDER `?by=stage` — wave 6's
 * ring, with `kind: 'cohort'` tiers where `large` has configured ones. It is a
 * fourth workspace rather than a fifth camera on `large` because the TREE is
 * what differs: eight stage cohorts over four books is a different packing from
 * two directorates over three managers over six kinds, and a floor that holds
 * at a fan-out of 6 is not evidence about one of 13.
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
    {
      id: 'large-grouped',
      rtl: false,
      orgCount: 400,
      tree: groupedTree(),
      // `reader` IS THE PHASE, not a book, and that is the fixture's own
      // finding rather than a shortcut: under `?by=stage` an account manager's
      // organizations are spread across all eight rungs, so `defaultFocusFor`
      // finds no single child holding every mark and stops one ring out. The
      // opening camera lands here, on the whole ladder — see `groupedTree`.
      // `dived` is the fat rung, which is where a reader goes first; `org` is
      // one organization inside Sara's book on it.
      anchors: {
        reader: 'ob',
        dived: 'cohort:st:2',
        org: 'cohort:st:2:mgr:1:org:92',
      },
    },
    {
      // The same grouped tree in Arabic. `large-rtl` proves the mirror over a
      // CONFIGURED hierarchy; this one proves it over a SYNTHETIC ring, which is
      // a different claim only because nothing should make it one — `worlds.ts`
      // reads `kind` in exactly one place (`STRUCTURAL_KINDS`, which admits a
      // cohort) and the mirror is arithmetic below that. Asserting it is how
      // "nothing should" stops being an argument.
      id: 'large-grouped-rtl',
      rtl: true,
      orgCount: 400,
      tree: groupedTree(),
      anchors: {
        reader: 'ob',
        dived: 'cohort:st:2',
        org: 'cohort:st:2:mgr:1:org:92',
      },
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
