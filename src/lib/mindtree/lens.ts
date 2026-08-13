// THE LENS — one chip that decides what the shell is FOR, resolved into a stage
// and a panel subject by total functions over three closed unions.
//
// A LENS IS NOT A DIMENSION. The map's five dimensions partition the SAME open
// work five ways, totally — every item drawn exactly once, which is what makes a
// node's count trustworthy and a drag meaningful. A lens changes what is on the
// screen at all. Folding "what needs me" into a ring-2 axis would destroy that
// partition and take the drag off the default view, so the two stay orthogonal
// and the dimension chips are untouched.
//
// DEFAULT_LENS IS 'needs-me' BECAUSE THE APP LANDS ON /followups TODAY. Landing
// anywhere else is a day-one regression for the job its owner does most. The
// lens is persisted (store/mindtree.ts), so a reader who prefers `shape` gets
// `shape` back; the default decides only what a device that never chose sees.
//
// PanelSubject IS A CLOSED UNION SWITCHED ON IN EXACTLY ONE PLACE — the shell's
// panel renderer in pages/Mindtree.tsx. That is what stops a sixth panel kind
// ever shipping half-wired: adding a member breaks the switch, and no function
// here has a `default:` to swallow it. None of them may grow one.
//
// PURE, and it may not import store/** or api/** (§3.7). `stageWithTable` takes
// the table view as a BOOLEAN rather than reading store/mindtree's `view`, which
// keeps that rule and lets every decision below be asserted with plain values.
// THE KEY TABLES ARE LITERALS: localeReach.test.ts scans source for quoted
// dotted strings, and a `t(\`mindtree.lens${x}\`)` ships missing in one language.

/** One chip. Sets a stage and a panel subject together, and rides the URL. */
export type MapLens = 'needs-me' | 'shape' | 'portfolio' | 'by-status' | 'what-changed' | 'numbers'

/**
 * What draws where the canvas is.
 *
 * `board` and `numbers` REPLACE the map rather than overlaying it: both answer
 * questions about CLOSED work, and closed work has no node — `useMapModel` pins
 * `scope: 'open'` and `buildMindtree` emits nothing for a closed entry. `table`
 * is the same open tree, rendered as the sortable ledger that is also the
 * low-motion, drag-free reading mode.
 *
 * `portfolio` is the sixth chip's surface: one row per ORGANIZATION, off the
 * same MindNode tree the map draws, grouped by `?by=` and cut by `?risk=`. It is
 * its own stage rather than a third way of drawing the open tree because its
 * rows are structural nodes, not entries — `table` is `map`'s ledger and the two
 * must not be offered as alternatives to each other (`allowedStages` below).
 *
 * ⚠ THIS TYPE OWNS THE WORD "STAGE" FOR THE SURFACE, NOT FOR THE LADDER. The
 * lifecycle ladder an account manager moves an organization along is a different
 * concept with its own module (lib/lifecycle.ts), its own table
 * (`map_node_stages`) and its own keys (`mindtree.colStage`). Never borrow this
 * name for it.
 */
export type MapStage = 'map' | 'board' | 'numbers' | 'table' | 'portfolio'

/** How much of a phone the panel takes. Meaningless above 768px, where the
 *  panel is an inline-end rail. */
export type PanelDetent = 'peek' | 'half' | 'full'

export type PanelSubject =
  | { readonly kind: 'none' }
  | { readonly kind: 'needsMe' }
  | { readonly kind: 'branch'; readonly nodeId: string }
  | { readonly kind: 'changes' }
  | { readonly kind: 'numbers' }

export const MAP_LENSES: readonly MapLens[] = Object.freeze([
  'needs-me',
  'shape',
  // READING ORDER, NOT ARRIVAL ORDER: what needs me → where is the mass → where
  // is each organization → where is everything → what happened → how are we
  // trending. The portfolio sits beside `shape` because both are questions about
  // the hierarchy rather than about the reader's own queue.
  'portfolio',
  'by-status',
  'what-changed',
  'numbers',
] as const)

export const MAP_STAGES: readonly MapStage[] = Object.freeze([
  'map',
  'board',
  'numbers',
  'table',
  'portfolio',
] as const)

/** Ordered smallest first, so a detent control can step through them. */
export const MAP_DETENTS: readonly PanelDetent[] = Object.freeze(['peek', 'half', 'full'] as const)

export const DEFAULT_LENS: MapLens = 'needs-me'

export function isMapLens(v: unknown): v is MapLens {
  return typeof v === 'string' && (MAP_LENSES as readonly string[]).includes(v)
}

export function isMapStage(v: unknown): v is MapStage {
  return typeof v === 'string' && (MAP_STAGES as readonly string[]).includes(v)
}

export function isPanelDetent(v: unknown): v is PanelDetent {
  return typeof v === 'string' && (MAP_DETENTS as readonly string[]).includes(v)
}

/** The stage a lens is ABOUT. `map` here means "the open tree", which the
 *  reader may still be showing as the table — see `stageWithTable`. */
export function stageForLens(lens: MapLens): MapStage {
  switch (lens) {
    case 'needs-me':
    case 'shape':
    case 'what-changed':
      return 'map'
    case 'portfolio':
      return 'portfolio'
    case 'by-status':
      return 'board'
    case 'numbers':
      return 'numbers'
  }
}

/**
 * The stage actually drawn, given the reader's map⇄table choice.
 *
 * ONE CONCEPT, ONE STORE. `store/mindtree`'s `view` has held map⇄table since
 * before lenses existed; MapToolbar's switch writes it and `useMapModel`,
 * `useMapToolbar` and the pulse gate read it. A second persisted `stage` would
 * be two stores for one idea and they would disagree within a day, so the stage
 * is DERIVED: the lens picks the surface, `view` picks how the open tree draws.
 */
export function stageWithTable(lens: MapLens, table: boolean): MapStage {
  const stage = stageForLens(lens)
  return stage === 'map' && table ? 'table' : stage
}

/** Which stages this lens can legitimately show — what the stage switch offers,
 *  and what a hand-edited `?stage=` is normalised against.
 *
 *  UNCHANGED BY THE PORTFOLIO, deliberately: `stageForLens('portfolio')` is not
 *  `map`, so the ladder is not offered — and it must not be. The portfolio IS a
 *  table; a Map|Table pair over it would offer to redraw a list of organizations
 *  as a canvas that has no such drawing. */
export function allowedStages(lens: MapLens): readonly MapStage[] {
  return stageForLens(lens) === 'map' ? (['map', 'table'] as const) : [stageForLens(lens)]
}

/**
 * What the panel is about.
 *
 * `shape` is the one lens whose subject depends on the map: with nothing focused
 * the panel is `none` and the canvas is the whole width, which is today's screen
 * exactly. Focus a node and the branch panel opens beside it.
 *
 * `portfolio` SHARES THAT ARM RATHER THAN COPYING IT, and the sharing is the
 * decision. A portfolio row tap has to open the panel the org panel already is —
 * detail band, stats band, work band with bulk assign, history band — so the
 * sixth lens ships with ZERO new `PanelSubject`: no edit to `phoneDetentFor`, no
 * edit to the shell's one exhaustive panel switch, and no second place where a
 * panel kind is decided. Written as a fall-through so the two arms cannot drift:
 * separating them later is then a deliberate act with a diff, rather than a
 * copy that silently stops matching.
 */
export function subjectForLens(lens: MapLens, focusNodeId: string | null): PanelSubject {
  switch (lens) {
    case 'needs-me':
      return { kind: 'needsMe' }
    case 'shape':
    case 'portfolio':
      return focusNodeId === null ? { kind: 'none' } : { kind: 'branch', nodeId: focusNodeId }
    case 'by-status':
      return { kind: 'none' }
    case 'what-changed':
      return { kind: 'changes' }
    case 'numbers':
      return { kind: 'numbers' }
  }
}

/**
 * Does this lens need entries the map never loads?
 *
 * The map pins `scope: 'open'` and never calls `loadClosedSince`, so the board's
 * Done/Cancelled columns and every throughput/SLA figure must be read by the
 * stage that draws them. The pin is NOT moved to satisfy this: it lives outside
 * filter state so Clear-all cannot change what the map is about.
 */
export function lensNeedsClosedWork(lens: MapLens): boolean {
  switch (lens) {
    case 'by-status':
    case 'numbers':
      return true
    case 'needs-me':
    case 'shape':
    // The portfolio asks where each ORGANIZATION has got to and how much open
    // work sits under it. Both are properties of the open tree, so the pin
    // holds: reading closed rows for it would buy nothing and would put four
    // more round trips behind the chip the morning starts on.
    case 'portfolio':
    case 'what-changed':
      return false
  }
}

/**
 * The detent a phone opens this subject at — a requirement, not a taste.
 * `needsMe`, `changes` and `numbers` open at `full`, because anything less shows
 * a phone reader fewer rows than /followups does today, which is the regression
 * the whole collapse exists to avoid. A branch opens at `half`: the map above it
 * is the context that made the reader tap the node.
 */
export function phoneDetentFor(subject: PanelSubject): PanelDetent {
  switch (subject.kind) {
    case 'needsMe':
    case 'changes':
    case 'numbers':
      return 'full'
    case 'branch':
      return 'half'
    case 'none':
      return 'peek'
  }
}

/** Literal key tables — localeReach.test.ts must see every key as a string. */
export const LENS_KEY: Readonly<Record<MapLens, string>> = Object.freeze({
  'needs-me': 'mindtree.lensNeedsMe',
  shape: 'mindtree.lensShape',
  portfolio: 'mindtree.lensPortfolio',
  'by-status': 'mindtree.lensByStatus',
  'what-changed': 'mindtree.lensWhatChanged',
  numbers: 'mindtree.lensNumbers',
})

export const STAGE_KEY: Readonly<Record<MapStage, string>> = Object.freeze({
  map: 'mindtree.stageMap',
  board: 'mindtree.stageBoard',
  numbers: 'mindtree.stageNumbers',
  table: 'mindtree.stageTable',
  portfolio: 'mindtree.stagePortfolio',
})

export const DETENT_KEY: Readonly<Record<PanelDetent, string>> = Object.freeze({
  peek: 'mindtree.detentPeek',
  half: 'mindtree.detentHalf',
  full: 'mindtree.detentFull',
})

/* ───────────────────── the portfolio's two controls ────────────────────── */
//
// FOUR QUESTIONS, TWO CONTROLS, ONE CHIP. Stalled, workload, vendor cohorts and
// progress-against-goal are not four datasets: they are the SAME ~400
// organizations grouped four ways, with one exception cut on top. Four chips
// would build the same table four times and would take the lens bar to nine
// destinations, at which point the row's own killer test — one interaction per
// destination, never behind a "More" menu — dies on a 375px phone.
//
// SO THEY ARE A FOURTH CLOSED UNION, DECLARED HERE. It lives beside MapLens
// rather than in the component that renders the chips, for the two reasons the
// key tables above already give: pages/map/useMapUrl.ts must parse it out of a
// hostile address bar, and components/CommandPalette.tsx must build links to it
// WITHOUT importing that hook (its suite runs with no DOM and no router). A
// union both of them can see, in the one pure module neither can avoid, is what
// stops the palette's links and the chips' state spelling the same idea two
// ways.

/** What the portfolio's rows ARE. Rides the URL as `?by=`. */
export type PortfolioBy = 'stage' | 'manager' | 'vendor' | 'phase'

export const PORTFOLIO_BYS: readonly PortfolioBy[] = Object.freeze([
  'stage',
  'manager',
  'vendor',
  'phase',
] as const)

/**
 * THE STALLED LIST IS WHAT THE CHIP GIVES YOU, WITH NO SECOND TAP. `by=stage`
 * with the risk cut on is the morning answer, so it is the default rather than
 * a state the reader has to reach — which is the whole of budget E1 (the morning
 * answer costs zero interactions after open) expressed as two constants.
 */
export const DEFAULT_PORTFOLIO_BY: PortfolioBy = 'stage'

/** `?risk=` — the exception cut. On by default; see `DEFAULT_PORTFOLIO_BY`. */
export const DEFAULT_PORTFOLIO_RISK = true

export function isPortfolioBy(v: unknown): v is PortfolioBy {
  return typeof v === 'string' && (PORTFOLIO_BYS as readonly string[]).includes(v)
}

/**
 * HUMAN WORDS, NOT THE PARAM VALUES — budget E5: `?by=` renders as chips a
 * person reads, never as a dropdown and never as its own machine spelling. The
 * words deliberately do not echo the keys: `manager` reads "Team" because the
 * question is whose book this is, and `phase` reads "Progress" because the
 * question is how far along the programme is, not which phase row it sits in.
 *
 * LITERALS, like every other key table here: localeReach.test.ts scans source
 * for quoted dotted strings, and a `t(\`mindtree.portfolioBy${x}\`)` ships
 * missing in one language.
 */
export const PORTFOLIO_BY_KEY: Readonly<Record<PortfolioBy, string>> = Object.freeze({
  stage: 'mindtree.portfolioByStage',
  manager: 'mindtree.portfolioByManager',
  vendor: 'mindtree.portfolioByVendor',
  phase: 'mindtree.portfolioByPhase',
})
