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
export type MapLens = 'needs-me' | 'shape' | 'by-status' | 'what-changed' | 'numbers'

/**
 * What draws where the canvas is.
 *
 * `board` and `numbers` REPLACE the map rather than overlaying it: both answer
 * questions about CLOSED work, and closed work has no node — `useMapModel` pins
 * `scope: 'open'` and `buildMindtree` emits nothing for a closed entry. `table`
 * is the same open tree, rendered as the sortable ledger that is also the
 * low-motion, drag-free reading mode.
 */
export type MapStage = 'map' | 'board' | 'numbers' | 'table'

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
  'by-status',
  'what-changed',
  'numbers',
] as const)

export const MAP_STAGES: readonly MapStage[] = Object.freeze([
  'map',
  'board',
  'numbers',
  'table',
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
 *  and what a hand-edited `?stage=` is normalised against. */
export function allowedStages(lens: MapLens): readonly MapStage[] {
  return stageForLens(lens) === 'map' ? (['map', 'table'] as const) : [stageForLens(lens)]
}

/**
 * What the panel is about.
 *
 * `shape` is the one lens whose subject depends on the map: with nothing focused
 * the panel is `none` and the canvas is the whole width, which is today's screen
 * exactly. Focus a node and the branch panel opens beside it.
 */
export function subjectForLens(lens: MapLens, focusNodeId: string | null): PanelSubject {
  switch (lens) {
    case 'needs-me':
      return { kind: 'needsMe' }
    case 'shape':
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
  'by-status': 'mindtree.lensByStatus',
  'what-changed': 'mindtree.lensWhatChanged',
  numbers: 'mindtree.lensNumbers',
})

export const STAGE_KEY: Readonly<Record<MapStage, string>> = Object.freeze({
  map: 'mindtree.stageMap',
  board: 'mindtree.stageBoard',
  numbers: 'mindtree.stageNumbers',
  table: 'mindtree.stageTable',
})

export const DETENT_KEY: Readonly<Record<PanelDetent, string>> = Object.freeze({
  peek: 'mindtree.detentPeek',
  half: 'mindtree.detentHalf',
  full: 'mindtree.detentFull',
})
