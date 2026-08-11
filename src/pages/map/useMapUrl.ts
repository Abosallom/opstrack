// THE WHOLE VIEW, IN THE URL — `?focus=`, `?dim=`, and every facet
// lib/entryFilter already names, through the two codecs that already exist.
//
// TWO HOOKS, ONE FILE, AND THEY MUST BE CALLED AT DIFFERENT DEPTHS. That is the
// only reason this is not one hook:
//
//   useMapUrlFilter()  holds NO effect. It derives `filter` from the params and
//                      hands back a setter. Called FIRST — before useMapModel,
//                      which consumes the filter to build the tree.
//   useMapUrl(...)     holds the two effects that mirror the drill-in. Called
//                      LAST, after the geometry and the keyboard, because that
//                      is where the pair sat in the undivided file, effects fire
//                      in declaration order, and useMapFocus's reconciler must
//                      get its say about a vanished branch before the URL does.
//
// Folding them together would drag the effects to the top of the composition and
// re-order three writers of one piece of state. Splitting them costs one extra
// `useSearchParams()`, which is a memo over `location.search` and therefore free.
//
// ── WHY THE FILTER IS HERE AT ALL ──────────────────────────────────────────
//
// It was `useState(EMPTY_FILTER)` and the map is the screen App.tsx lands admins
// on: the least shareable screen in the app, and the only filtering screen that
// did not survive a reload. FollowUps.tsx, Board.tsx and TracksIndex.tsx all
// round-trip through `filterToParams`/`filterFromParams`, and FollowUps.tsx's
// header gives both halves of the reason — a lazy route resets its filter on
// every trip to another tab, and a triage view is worth pasting into a chat.
//
// ONE CODEC, NOT TWO. `filterToParams` writes the facets, `viewToParams` writes
// the drill-in into the SAME params object — focus.ts:381 says it takes "the one
// `filterToParams(filter)` just produced", which is the composition this file
// finally performs. Nothing here re-implements either.
//
// ── THE STORE IS THE SOURCE OF TRUTH; THE URL IS ITS MIRROR ────────────────
//
// Seeded from the store on first paint, written with `replace` thereafter —
// Board.tsx and FollowUps.tsx's reasoning, which is that a history entry per
// interaction makes Back unusable and Back should leave this screen rather than
// walk its rings. The URL wins only when it arrives with an opinion this session
// did not put there, which is exactly the paste-a-link case it exists for.
//
// THE URL ONLY WINS WHEN IT HAS AN OPINION. `viewFromParams` returns null for
// "the URL says nothing", which is NOT the same as "show the whole map": a
// reader arriving from the nav bar keeps the drill-in they left yesterday, and
// only a link that actually carries `?focus=` overrides it. That is the
// asymmetry that makes a persisted preference and a shareable link coexist.
//
// A node id IS its path (model.ts builds it that way), so the param needs no
// second field to say where it sits, and a link survives a regroup because the
// `root/track:X` prefix still names the same track after every `group:` segment
// has been rewritten.
//
// ── THE CLAIM, AND THE LOOP IT ENDS ────────────────────────────────────────
//
// The two effects were written to converge, and for `?focus=` alone they nearly
// did — one wasted `replace` and back. For `?dim=` they did not converge at all,
// and the failure is an INFINITE RENDER LOOP on the one case the feature exists
// for: a pasted link whose dimension differs from the recipient's persisted one.
//
//   render 1  params say owner, store says status
//             inbound  writes owner to the store
//             outbound reads `dimension` OFF THIS RENDER — still status — and
//                      writes status to the URL, and deletes the `focus` the
//                      link arrived with for the same stale-closure reason
//   render 2  params say status, store says owner … and it alternates forever,
//             because the two writers are permanently one render out of phase.
//
// An effect closes over the values of the render that scheduled it; a store
// write from the effect ABOVE it lands in the next render, not this one. So the
// inbound effect records what it just handed the store as a CLAIM, and the
// outbound effect refuses to write over a claim the store has not absorbed yet.
// The claim is cleared after exactly one pass, so nothing can wedge: a focus the
// reconciler repairs to an ancestor, or a store that rejects an over-long id,
// costs one skipped mirror and no more.
//
// ── THE LENS AND THE STAGE RIDE THE SAME TWO EFFECTS ───────────────────────
//
// `?lens=` and `?stage=` are two more MIRRORED params, in the shape of `?dim=`
// rather than in a second pair of effects: two effects calling `setParams` on
// one render both start from the same `params` snapshot, so the second drops the
// first's contribution and the pair costs an extra replace per navigation. One
// inbound, one outbound, and TWO CLAIMS — per concern, because a link carrying
// `?lens=` and no `?focus=` must not hold the drill-in's mirror shut.
//
// THE LIVE LENS IS READ FROM THE STORE HERE rather than taken as a parameter:
// `dimension` is half of `MindtreeUrlView`, which the composition already holds,
// while the lens belongs to no other caller. The inbound effect's dependency
// array is still `[params]` alone.
//
// THE STAGE IS DERIVED, NOT STORED — `stageWithTable(lens, view === 'table')`,
// because `view` has held map⇄table since before lenses existed. So the only
// stage the URL ever spells out is the one that disagrees with the lens's own,
// and a hand-edited `?stage=board` under `?lens=shape` is normalised rather than
// obeyed: obeying it draws a board with no chip lit to explain it.
//
// A NOTE FOR WHOEVER WIRES `useMapUrlFilter`: it is exported and called by
// nobody — `useMapModel` still holds the filter in `useState`, so the map's
// FACETS do not round-trip through the URL today. When that is fixed,
// `mapParamsFor` must be composed with `mapParamsForLens` at the call site, or
// the first keystroke strips `?lens=` off the link until the mirror restores it.
//
// THE DECISIONS ARE PURE AND EXPORTED, because vitest.config.ts is
// `environment: 'node'` and effects do not run in a server render — the same
// reason PulseLayer.tsx exports `ghostsFor` and `isViewChange`. The test drives
// `mapUrlInbound` and `mapMirrorParams` in the order this file calls them, which
// is the only way a cold-load deep link can be proven in this repo at all.

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  EMPTY_FILTER,
  filterFromParams,
  filterToParams,
  type FilterState,
} from '../../lib/entryFilter'
import {
  viewFromParams,
  viewToParams,
  type MindtreeUrlView,
} from '../../lib/mindtree/focus'
import {
  allowedStages,
  isMapLens,
  isMapStage,
  stageForLens,
  stageWithTable,
  type MapLens,
  type MapStage,
} from '../../lib/mindtree/lens'
import type { MindDimension } from '../../lib/mindtree/model'
import {
  setMindDimension,
  setMindLens,
  setMindView,
  useMindDimension,
  useMindFocus,
  useMindLens,
  useMindView,
} from '../../store/mindtree'

/** The two params this file adds. `dim` and `focus` are named by focus.ts. */
const P_LENS = 'lens'
const P_STAGE = 'stage'

/* ── the pure decisions ─────────────────────────────────────────────────── */

/**
 * The filter this screen will actually apply, read off whatever is in the
 * address bar.
 *
 * SCOPE IS NORMALISED AWAY, and it is not tidiness. useMapModel pins
 * `scope: 'open'` in `applied` rather than holding it in the filter, and states
 * why: `countActiveFacets` counts a non-default scope as a facet the reader
 * chose, so a `?scope=closed` inherited from the board — or hand-typed — would
 * make the filter bar claim "1 filter" on a map nobody has filtered, put the
 * "clear the filter" empty state in front of a reader who cannot see what to
 * clear, and change nothing about the drawing, because `applied` overrides it
 * anyway. FollowUps.tsx drops the same param for the same reason.
 *
 * `sort` is deliberately KEPT. model.ts:684 filters through `selectEntries`
 * first, so ring 3 reads in the order the FilterBar's sort chose and the tail
 * that falls behind "+N more" follows from it. It is part of what the sender
 * saw.
 *
 * Everything else is `filterFromParams`, which is already total over hostile
 * input and already constructs freshly rather than spreading the frozen default.
 */
export function mapFilterFromParams(p: URLSearchParams): FilterState {
  const parsed = filterFromParams(p)
  // Returned unchanged on the ordinary path so the caller's memo keeps a stable
  // reference for as long as `params` does.
  if (parsed.scope === EMPTY_FILTER.scope) return parsed
  return { ...parsed, scope: EMPTY_FILTER.scope }
}

/**
 * The params for a filter the reader just changed, WITH the drill-in still on
 * them.
 *
 * Composed rather than concatenated: `filterToParams` produces the facets and
 * `viewToParams` writes the view into that same object, which is the shape
 * focus.ts's codec was written for. Written this way round — filter first — the
 * two can never disagree about a param name, because only one function owns
 * each name.
 *
 * ANYTHING ELSE ON THE URL IS DROPPED. That is `filterToParams`'s doing and it
 * is what FollowUps.tsx and Board.tsx already do; this route carries no other
 * param (the entry sheet is component state, not a link), and the alternative —
 * preserving unknown params — would carry a stale `?scope=closed` around
 * forever rather than clearing it the first time the reader touches a facet.
 */
export function mapParamsFor(filter: FilterState, view: MindtreeUrlView): URLSearchParams {
  return viewToParams(filterToParams(filter), view)
}

/**
 * What the URL is telling the store, or null when it is telling it nothing.
 *
 * Null and "an empty view" are different answers and the difference is the
 * whole asymmetry above: no opinion means the reader keeps the drill-in they
 * left yesterday. It is also what stops an ordinary navigation from recording a
 * claim it never made.
 */
export function mapUrlInbound(p: URLSearchParams): MindtreeUrlView | null {
  const url = viewFromParams(p)
  if (url.focusId === null && url.dimension === null) return null
  return url
}

/**
 * Has the store absorbed the opinion the inbound effect handed it one render
 * ago?
 *
 * Only the fields the URL actually claimed are compared. A link carrying
 * `?dim=` and no `?focus=` says nothing about the drill-in, and holding the
 * mirror shut until an unclaimed field "matches" would wedge it forever.
 */
function absorbed(claim: MindtreeUrlView, store: MindtreeUrlView): boolean {
  if (claim.focusId !== null && store.focusId !== claim.focusId) return false
  if (claim.dimension !== null && store.dimension !== claim.dimension) return false
  return true
}

/**
 * The params to write for the store's current view, or null for "leave the URL
 * alone".
 *
 * Two ways to answer null, and they are different refusals:
 *  · the claim is outstanding — `view` is a stale render's reading of the store
 *    and writing it would strip the link that is still being applied (see the
 *    header);
 *  · the URL already says exactly this. Compared as STRINGS because
 *    URLSearchParams has no equality, and a fresh object every render would
 *    otherwise write on every render.
 */
export function mapMirrorParams(
  current: URLSearchParams,
  view: MindtreeUrlView,
  claim: MindtreeUrlView | null,
): URLSearchParams | null {
  if (claim !== null && !absorbed(claim, view)) return null
  const next = viewToParams(current, view)
  return next.toString() === current.toString() ? null : next
}

/* ── the lens half of the codec ─────────────────────────────────────────── */

/** What the shell is for, as the URL carries it. */
export interface MapUrlLens {
  lens: MapLens
  stage: MapStage
}

/**
 * The lens the URL is asking for, or null when it is asking for nothing.
 *
 * NULL MEANS "KEEP THE PERSISTED LENS", never "take the default" — the same
 * asymmetry `mapUrlInbound` runs on, and what lets a reader who prefers `shape`
 * keep it while a pasted attention link still works.
 *
 * `?stage=` ALONE IS NOT AN OPINION: the mirror never writes one without a lens,
 * and a bare stage lights no chip. A stage this lens cannot show is normalised
 * to the lens's own rather than obeyed, for the same reason.
 */
export function mapLensFromParams(p: URLSearchParams): MapUrlLens | null {
  const rawLens = p.get(P_LENS)
  if (!isMapLens(rawLens)) return null
  const rawStage = p.get(P_STAGE)
  const stage =
    isMapStage(rawStage) && allowedStages(rawLens).includes(rawStage)
      ? rawStage
      : stageForLens(rawLens)
  return { lens: rawLens, stage }
}

/**
 * Write the lens into an existing params object — `viewToParams`'s shape, so the
 * two compose without either owning the other's names.
 *
 * THE STAGE IS WRITTEN ONLY WHEN IT DISAGREES WITH THE LENS. Every lens implies
 * its stage; the one exception is the ledger, which is a way of drawing the open
 * tree rather than a lens. Writing `stage=map` on every link would put a
 * redundant param in front of every reader for a case that round-trips anyway.
 */
export function mapParamsForLens(p: URLSearchParams, v: MapUrlLens): URLSearchParams {
  const next = new URLSearchParams(p)
  next.set(P_LENS, v.lens)
  if (v.stage === stageForLens(v.lens)) next.delete(P_STAGE)
  else next.set(P_STAGE, v.stage)
  return next
}

/**
 * The params for the lens the store currently holds, or null for "leave the URL
 * alone" — `mapMirrorParams`'s two refusals, for the other concern. The claim is
 * compared on BOTH fields because the pair is written as a pair:
 * `mapLensFromParams` resolves a stage for every lens it accepts.
 */
export function mapLensMirror(
  current: URLSearchParams,
  live: MapUrlLens,
  claim: MapUrlLens | null,
): URLSearchParams | null {
  if (claim !== null && (claim.lens !== live.lens || claim.stage !== live.stage)) return null
  const next = mapParamsForLens(current, live)
  return next.toString() === current.toString() ? null : next
}

/* ── the hooks ──────────────────────────────────────────────────────────── */

export interface MapUrlFilter {
  filter: FilterState
  setFilter: (next: FilterState) => void
}

/**
 * THE FILTER, IN THE URL. No effect, so it is safe to call first — which it
 * must be, since useMapModel takes the filter and builds the tree from it.
 *
 * The view is read from the STORE rather than from the params, and that is the
 * ordering fix in miniature: on the first paint the URL has not been seeded yet,
 * so composing with `viewFromParams(params)` would write a filter change with no
 * `?focus=` on it and leave the link wrong for exactly as long as it takes the
 * mirror below to put it back. A reader who types into the search box and
 * immediately copies the address bar gets the drill-in they are looking at.
 *
 * `replace`, not push: FilterBar's search is not debounced (its header says
 * why), so a history entry per keystroke would make Back unusable.
 */
export function useMapUrlFilter(): MapUrlFilter {
  const [params, setParams] = useSearchParams()
  const dimension = useMindDimension()
  const focusId = useMindFocus()

  const filter = useMemo(() => mapFilterFromParams(params), [params])

  const setFilter = useCallback(
    (next: FilterState) => {
      setParams(mapParamsFor(next, { focusId, dimension }), { replace: true })
    },
    [setParams, focusId, dimension],
  )

  return { filter, setFilter }
}

/**
 * THE DRILL-IN, IN THE URL — the two effects, and the claim that makes them
 * converge instead of alternate.
 *
 * Called LAST in the composition. See the header for why the position is load
 * bearing rather than incidental.
 */
export function useMapUrl(
  focusPref: string | null,
  dimension: MindDimension,
  focusBranch: (nodeId: string | null) => void,
): void {
  const [params, setParams] = useSearchParams()
  const lens = useMindLens()
  // The other half of the derived stage — see the header. `view` is the store's
  // own map⇄table preference, which MapToolbar's switch has always written.
  const stage = stageWithTable(lens, useMindView() === 'table')
  /**
   * What the effect below just handed the store, until the effect after it has
   * seen the store catch up. A ref and not state: nothing renders differently
   * because of it, and a state write here would be a render per navigation.
   *
   * TWO CLAIMS, ONE PER CONCERN. A link carrying `?lens=` and no `?focus=` says
   * nothing about the drill-in, and one shared claim would hold the drill-in's
   * mirror shut for a pass on every lens chip.
   */
  const claim = useRef<MindtreeUrlView | null>(null)
  const lensClaim = useRef<MapUrlLens | null>(null)

  useEffect(() => {
    const wanted = mapLensFromParams(params)
    if (wanted !== null) {
      setMindLens(wanted.lens)
      // Only the open tree has two ways to be drawn, so only those two stages
      // say anything about `view`. `board` and `numbers` follow from the lens
      // and must leave a reader's ledger preference where it was.
      if (wanted.stage === 'table' || wanted.stage === 'map') setMindView(wanted.stage)
      lensClaim.current = wanted
    }
    const url = mapUrlInbound(params)
    if (url === null) return
    if (url.dimension !== null) setMindDimension(url.dimension)
    // `focusBranch`, not `setMindFocus`: a pasted link to a branch must show
    // what is under it, and the recipient's own collapse state — persisted from
    // some earlier session — has no business deciding whether the link works.
    if (url.focusId !== null) focusBranch(url.focusId)
    claim.current = url
    // The params only. Reading the store here would re-run this on every focus
    // change and hand the URL's stale opinion back to the store it just left.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  useEffect(() => {
    // Read AND cleared, always: the claim buys the inbound write exactly one
    // pass to land. Holding it until it matches would wedge the mirror shut
    // whenever the store settles on something else — useMapFocus's reconciler
    // repairing a dead branch to its surviving ancestor is the ordinary case —
    // and the URL would then stop tracking the map altogether.
    const outstanding = claim.current
    claim.current = null
    const lensOutstanding = lensClaim.current
    lensClaim.current = null
    // COMPOSED, NOT TWO WRITES. Each mirror answers null for "leave this half
    // alone", so the other half's params are the base for the next, and the one
    // string comparison at the end is what stops a write that changes nothing.
    const view = mapMirrorParams(params, { focusId: focusPref, dimension }, outstanding)
    const base = view ?? params
    const next = mapLensMirror(base, { lens, stage }, lensOutstanding) ?? base
    if (next.toString() === params.toString()) return
    setParams(next, { replace: true })
  }, [focusPref, dimension, lens, stage, params, setParams])
}
