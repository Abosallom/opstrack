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
// A LINK THAT SAYS NOTHING ABOUT THE STAGE DOES NOT DECIDE THE STAGE.
// `mapLensFromParams` RESOLVES a stage for every lens it accepts — it has to,
// because the pair is written as a pair — but a resolved stage is an INFERENCE,
// and writing an inference into `view` destroyed the ledger of every reader who
// followed a bare `?lens=` link. `table` is the accessible, drag-free, low-motion
// reading mode and it is a PREFERENCE, not a view state. `mapUrlStage` answers
// the narrower question the store actually needs — what did the link SPELL OUT —
// and the claim carries `stage: null` for a link that spelled out nothing, so the
// mirror is held over the lens alone. That is `absorbed()`'s own rule (only the
// fields the URL claimed are compared) applied to the other pair.
//
// ── AND THE PORTFOLIO'S TWO CONTROLS RIDE NEITHER EFFECT ───────────────────
//
// `?by=` and `?risk=` are the sixth lens's whole interface, and they are URL-ONLY
// state: no store, no persistence, and therefore NO THIRD EFFECT. There is
// nothing to mirror — the address bar is the record — and the pair above carries
// them through untouched, because both mirrors COPY the params they are handed
// and set only their own names. The one writer that could drop them is the
// filter, whose fresh-params rule is stated in rule 1 below; it re-applies them
// off `setParams`'s `prev`. See "the portfolio half of the codec".
//
// ── THE FILTER IS WIRED NOW, AND THREE RULES CAME WITH IT ──────────────────
//
// `useMapUrlFilter` was exported and called by nobody, so a filtered map could
// not be pasted as a link at all — a regression against /followups, which put
// its filter in the URL deliberately. The shell now calls it, and three things
// follow that a filter held in `useState` never had to answer:
//
//  1. ONE WRITE CARRIES EVERY PARAM. `filterToParams` builds a FRESH params
//     object, so a filter change written on its own deletes `?lens=`, `?stage=`,
//     `?focus=` and `?dim=` and the mirror below has to put them back a render
//     later — a window in which a copied address bar is the wrong view, and, for
//     the lens, a window in which the INBOUND effect reads the params the
//     keystroke just wrote and hands the store back the lens it just left.
//     `mapParamsForAll` composes all three codecs, and the writer reads the
//     store through `getMindtreeState()` AT THE MOMENT OF THE WRITE rather than
//     off the render — `onJump` sets the lens and the filter in one event, and a
//     lens read from the render that scheduled the handler is the lens BEFORE
//     that tap.
//
//  2. ONE OBJECT PER SET OF FACETS. `filter` is memoised on a CANONICAL
//     ENCODING of the facets, not on `params`: every drill-in, lens or stage
//     write mints a new `params` object, and a `FilterState` minted with it
//     would re-run `buildMindtree` — the most expensive thing on this screen —
//     on a change that touched no facet at all.
//
//  3. THE INBOUND EFFECT NOW RUNS ON EVERY KEYSTROKE, because the search box
//     writes the URL. Everything it does to the store is idempotent
//     (`updatePrefs` returns the same state when nothing moved), with one
//     exception that is NOT: opening the panel. See `arrived` below.
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
  DEFAULT_PORTFOLIO_BY,
  DEFAULT_PORTFOLIO_RISK,
  allowedStages,
  isMapLens,
  isMapStage,
  isPortfolioBy,
  stageForLens,
  stageWithTable,
  subjectForLens,
  type MapLens,
  type MapStage,
  type PortfolioBy,
  isPortfolioAs,
  DEFAULT_PORTFOLIO_AS,
  type PortfolioAs,
} from '../../lib/mindtree/lens'
import type { MindDimension } from '../../lib/mindtree/model'
import {
  getMindtreeState,
  setMindDimension,
  setMindLens,
  setMindPanelOpen,
  setMindView,
  useMindLens,
  useMindView,
} from '../../store/mindtree'

/** The five params this file adds. `dim` and `focus` are named by focus.ts. */
const P_LENS = 'lens'
const P_STAGE = 'stage'
const P_BY = 'by'
const P_RISK = 'risk'
const P_AS = 'as'

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
 * THE FACETS OF THIS URL, AND NOTHING ELSE — a canonical string, so that "did
 * the filter change?" is a question about the FILTER rather than about the
 * address bar.
 *
 * Every drill-in, lens and stage write mints a new `params` object. Memoising
 * the `FilterState` on `params` would therefore mint a new filter for each of
 * them, and `useMapModel`'s `applied` → `buildMindtree` chain is keyed on that
 * object: drilling into a branch would rebuild the entire tree to produce a
 * byte-identical one. Keyed on this string instead, the filter object survives
 * every write that touched no facet.
 *
 * It is `filterToParams` of the PARSED filter rather than a slice of the raw
 * search string, so two URLs that mean the same filter — `?scope=closed&q=vpn`
 * and `?q=vpn`, `?status=toString` and nothing — produce the same key.
 */
export function mapFilterKey(p: URLSearchParams): string {
  return filterToParams(mapFilterFromParams(p)).toString()
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
 * THE WHOLE ADDRESS BAR, FROM THE WHOLE STATE — the three codecs composed in the
 * one order that lets each own its own names.
 *
 * The filter writer is the only caller, and it is the only writer that starts
 * from a FRESH params object rather than from the live one: `filterToParams`
 * builds its own, which is what drops an inherited `?scope=`, and what would
 * otherwise drop `?lens=`, `?stage=`, `?focus=` and `?dim=` with it. A keystroke
 * that dropped `?lens=` would not merely leave the link wrong for a render — the
 * inbound effect would read the lens-less params it just wrote and, one pass
 * later, the mirror would put back the lens the reader had ALREADY left.
 *
 * ⚠ THE PORTFOLIO'S `?by=`/`?risk=` ARE NOT IN HERE, AND MUST NOT BE. This
 * function takes the whole STORE-BACKED state and can therefore build its answer
 * from arguments alone; those two live only in the address bar, so the only
 * honest source for them is the address bar itself. The one caller re-applies
 * them with `mapParamsForPortfolio` off `setParams`'s `prev` — see
 * `useMapUrlFilter`. A second caller that forgets is a reader thrown back to the
 * stalled list, so add the same composition rather than a fourth argument that
 * defaults to something.
 */
export function mapParamsForAll(
  filter: FilterState,
  view: MindtreeUrlView,
  lens: MapUrlLens,
): URLSearchParams {
  return mapParamsForLens(mapParamsFor(filter, view), lens)
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
 * The stage this URL actually SPELLED OUT, or null when it spelled out nothing
 * this lens can show.
 *
 * The narrower half of `mapLensFromParams`, and the whole difference between the
 * two is what a reader's persisted ledger is worth. That function must resolve a
 * stage for every lens, because the pair is written as a pair and a chip has to
 * light; this one refuses to INFER, because the only consumer that follows is
 * `setMindView`, and a bare `?lens=needs-me` inferring `stage: 'map'` silently
 * turned the ledger back into the map for a reader who chose it.
 *
 * Null for all three "said nothing" cases, which are one case to the store: no
 * lens, no stage, or a stage this lens cannot show (hand-edited, or inherited
 * from a link written under another lens — normalised, never obeyed).
 */
export function mapUrlStage(p: URLSearchParams): MapStage | null {
  const rawLens = p.get(P_LENS)
  if (!isMapLens(rawLens)) return null
  const rawStage = p.get(P_STAGE)
  if (!isMapStage(rawStage) || !allowedStages(rawLens).includes(rawStage)) return null
  return rawStage
}

/**
 * Does a lens ARRIVING in the URL have anything to put in the panel?
 *
 * `?lens=` set the lens and left the dock shut, so "See all" on the bell, the
 * Settings › Notifications row and all five palette rows landed on a map with
 * nothing visibly different about it — the link named a destination and the
 * destination did not appear. An arriving lens must therefore open its panel.
 *
 * Asked through `subjectForLens` rather than by listing the lenses, so the
 * closed union stays the one place a panel kind is decided: `by-status` has no
 * panel at all and `shape` has one only when something is focused, and forcing
 * `panelOpen` for either would flip a persisted preference to describe a dock
 * this shell does not render.
 */
export function mapLensOpensPanel(lens: MapLens, focusId: string | null): boolean {
  return subjectForLens(lens, focusId).kind !== 'none'
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
 * What the inbound effect handed the store about the lens pair, until the mirror
 * has seen the store catch up.
 *
 * `stage: null` IS THE POINT, and it is `absorbed()`'s rule for the other pair:
 * a claim may hold the mirror shut only over a field the URL actually claimed. A
 * bare `?lens=needs-me` says nothing about the stage, the store keeps the ledger
 * it was already showing, and a claim asserting the lens's inferred `map` would
 * be a claim the store is never going to satisfy.
 */
export interface MapLensClaim {
  lens: MapLens
  stage: MapStage | null
}

/**
 * The params for the lens the store currently holds, or null for "leave the URL
 * alone" — `mapMirrorParams`'s two refusals, for the other concern.
 *
 * The stage is compared only when the claim carries one. When it does not, the
 * mirror is free to write the stage the reader is ACTUALLY on in the same pass,
 * which is how `?lens=needs-me` arriving at a ledger ends up spelled out as
 * `?lens=needs-me&stage=table` rather than quietly disagreeing with the screen.
 */
export function mapLensMirror(
  current: URLSearchParams,
  live: MapUrlLens,
  claim: MapLensClaim | null,
): URLSearchParams | null {
  if (claim !== null && claim.lens !== live.lens) return null
  if (claim !== null && claim.stage !== null && claim.stage !== live.stage) return null
  const next = mapParamsForLens(current, live)
  return next.toString() === current.toString() ? null : next
}

/* ── the portfolio half of the codec ────────────────────────────────────── */
//
// `?by=` AND `?risk=` ARE URL-ONLY STATE, AND THAT IS WHY THIS SECTION HOLDS NO
// EFFECT AND NO CLAIM.
//
// `lens`, `stage`, `focus` and `dim` all live in store/mindtree — persisted
// preferences a reader carries between sessions — so each needs the inbound /
// outbound pair above and the claim that makes the two converge instead of
// alternate. The portfolio's two controls are not preferences: they are WHICH
// QUESTION the reader is asking right now, and the answer to "what was I looking
// at" for them is the link itself. So the address bar is their only home, the
// reader's own default is `stage` + the risk cut (budget E1: the morning answer
// costs zero interactions after open), and there is nothing for a mirror to
// mirror.
//
// A SECOND `setParams` EFFECT IS THEREFORE NOT MERELY UNNECESSARY, IT IS THE
// BUG THE HEADER WARNS ABOUT: two effects calling `setParams` on one render both
// start from the same `params` snapshot and the second silently drops the
// first's contribution. The pair above is untouched, and it carries these two
// params through for free — `viewToParams` and `mapParamsForLens` both COPY the
// params they are handed and set only their own names.
//
// THE ONE WRITER THAT COULD DROP THEM IS THE FILTER, and it is handled where it
// happens rather than here: `mapParamsForAll` starts from a FRESH object
// (`filterToParams` builds its own, which is what clears an inherited `?scope=`),
// so `useMapUrlFilter`'s setter re-applies the portfolio pair read off the LIVE
// params through `setParams`'s functional form. Without that, typing one
// character into the search box would throw a reader who was looking at the
// vendor cohorts back to the stalled list.
//
// THEY ARE NOT STRIPPED UNDER THE OTHER FIVE LENSES, deliberately. A `?by=` on a
// `needs-me` link is inert — nothing reads it — and keeping it means the reader
// who taps away from the portfolio and back finds the grouping they left, which
// is the same courtesy `view` extends to the ledger. Stripping it would also
// cost a write on every render under every other lens, for no reader's benefit.

/** The portfolio's two controls, as the URL carries them. */
export interface MapUrlPortfolio {
  by: PortfolioBy
  risk: boolean
  /** How the rows are DRAWN. A second axis over the same data — see lens.ts. */
  as: PortfolioAs
}

/**
 * `?risk=` is `1`/`0` and NOTHING ELSE resolves to an opinion.
 *
 * `Boolean('0')` is `true` and `'false'` is a perfectly ordinary string, so a
 * loose read here turns a hand-edited or hand-copied param into the opposite of
 * what it says. Anything unrecognised falls to the default rather than to
 * `false`: the reader who pastes a mangled link should land on the morning
 * answer, not on an unfiltered list of 400 organizations.
 */
function riskFromParam(raw: string | null): boolean {
  if (raw === '1') return true
  if (raw === '0') return false
  return DEFAULT_PORTFOLIO_RISK
}

/**
 * What the portfolio is showing, read off whatever is in the address bar.
 *
 * TOTAL, and it answers with the DEFAULTS rather than with null — the asymmetry
 * that governs `?lens=` (null means "keep what you had") does not apply, because
 * there is nothing to keep. A URL that says nothing is a reader who has just
 * arrived, and what they get is the stalled list.
 */
export function mapPortfolioFromParams(p: URLSearchParams): MapUrlPortfolio {
  const rawBy = p.get(P_BY)
  const rawAs = p.get(P_AS)
  return {
    by: isPortfolioBy(rawBy) ? rawBy : DEFAULT_PORTFOLIO_BY,
    risk: riskFromParam(p.get(P_RISK)),
    as: isPortfolioAs(rawAs) ? rawAs : DEFAULT_PORTFOLIO_AS,
  }
}

/**
 * Write the portfolio into an existing params object — `viewToParams`'s and
 * `mapParamsForLens`'s shape, so all three compose without either owning the
 * other's names.
 *
 * ⚠ `?by=` IS ALWAYS SPELLED, AND `?risk=` IS NOT. That asymmetry is deliberate
 * and it is the whole of wave 8's fix to budget E9. `?risk=` has two states and
 * the absent one is the default, so suppressing it loses nothing. `?by=` has
 * THREE: the reader chose `stage`, the reader chose something else, and the
 * reader has not chosen at all — and the third is not a spelling of the first.
 * The canvas reads an unchosen `?by=` as UNGROUPED (Mindtree.tsx's `canvasBy`)
 * while the table keeps its stalled-by-stage opening, so collapsing "chose
 * stage" and "chose nothing" into one address is what made a pressed `Stage`
 * chip die on reload. Every call here is a reader's own choice — a chip, a
 * palette row — so every call spells it. The one writer that must NOT invent a
 * choice is the filter keystroke, and it has its own function below.
 *
 * `mapPortfolioFromParams` still reads either form back identically, which is
 * what lets the palette's rows spell them out in full and still round-trip.
 */
export function mapParamsForPortfolio(
  p: URLSearchParams,
  v: MapUrlPortfolio,
): URLSearchParams {
  const next = new URLSearchParams(p)
  next.set(P_BY, v.by)
  if (v.risk === DEFAULT_PORTFOLIO_RISK) next.delete(P_RISK)
  else next.set(P_RISK, v.risk ? '1' : '0')
  // ⚠ SUPPRESSED AT ITS DEFAULT, which is `?risk=`'s rule and NOT `?by=`'s.
  //   `?by=` spells itself always because it has three states — chose stage,
  //   chose something else, and has not chosen — and the canvas reads the third
  //   differently. `?as=` has no such third state: the table is what a reader
  //   who has expressed no opinion gets, and writing `as=table` on every link
  //   would put a param in front of every reader for a case that round-trips
  //   anyway.
  if (v.as === DEFAULT_PORTFOLIO_AS) next.delete(P_AS)
  else next.set(P_AS, v.as)
  return next
}

/**
 * DID THE READER CHOOSE A GROUPING, OR DID THEY JUST ARRIVE?
 *
 * The third state `mapPortfolioFromParams` cannot express, because that reader
 * is total by design and answers with the default. Read off the RAW param: a
 * spelled, recognised `?by=` is a choice; absent, blank or hostile is not. It is
 * the same predicate `mapPortfolioFromParams` uses to accept the value, so the
 * two cannot disagree about what counts as spelled.
 *
 * Only the canvas asks. The table's default IS `stage` either way, so nothing
 * downstream of the portfolio rows reads this.
 */
export function mapPortfolioChosen(p: URLSearchParams): boolean {
  return isPortfolioBy(p.get(P_BY))
}

/**
 * CARRY THE PORTFOLIO'S TWO PARAMS THROUGH A WRITE THAT DID NOT TOUCH THEM —
 * absence included, which is the reason this is not `mapParamsForPortfolio`.
 *
 * `mapPortfolioFromParams` is total: handed a URL with no `?by=` it answers
 * `stage`, and writing THAT back through the chooser would tell the canvas the
 * reader had pressed `Stage`. One character typed into the search box would
 * regroup 400 organizations into stage rings nobody asked for. So the raw pair
 * is copied instead, normalised only enough that a hostile value cannot survive
 * as a choice.
 */
function carryPortfolioParams(next: URLSearchParams, prev: URLSearchParams): URLSearchParams {
  const out = carryChoiceOnly(next, prev)
  const rawRisk = prev.get(P_RISK)
  if (riskFromParam(rawRisk) === DEFAULT_PORTFOLIO_RISK) out.delete(P_RISK)
  else out.set(P_RISK, riskFromParam(rawRisk) ? '1' : '0')
  return out
}

/**
 * The `?by=` half of the carry, on its own — because the exception cut needs it
 * without the rest.
 *
 * `?risk=` and `?by=` ride in one setter (the table hands both down in one
 * object), so a reader toggling `At risk` while having chosen no grouping would
 * otherwise have `by=stage` written underneath them by the very write that was
 * about something else, and watch the canvas fall into stage rings. Toggling the
 * exception cut is not an opinion about how the rings should be cut.
 */
function carryChoiceOnly(next: URLSearchParams, prev: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams(next)
  const rawBy = prev.get(P_BY)
  if (isPortfolioBy(rawBy)) out.set(P_BY, rawBy)
  else out.delete(P_BY)
  return out
}

/**
 * THE PORTFOLIO OF THIS URL, AND NOTHING ELSE — `mapFilterKey`'s move, for the
 * other pair.
 *
 * Every filter keystroke, drill-in, lens and stage write mints a new `params`
 * object. Memoising the `MapUrlPortfolio` on `params` would mint a new object
 * for each of them, and the row fold downstream of it — one pass over ~400
 * organizations — is keyed on that object. Keyed on this canonical string
 * instead, it survives every write that touched neither control, and two URLs
 * that mean the same thing (`?by=stage&risk=1` and nothing at all) produce the
 * same key.
 */
export function mapPortfolioKey(p: URLSearchParams): string {
  return mapParamsForPortfolio(new URLSearchParams(), mapPortfolioFromParams(p)).toString()
}

/**
 * THE WHOLE ADDRESS BAR FOR A FILTER THE READER JUST CHANGED — the four codecs,
 * composed in the one order that lets each own its own names.
 *
 * EXPORTED AND PURE BECAUSE THAT IS THE ONLY WAY IT CAN BE PROVEN. This file's
 * header says it for the effects and it is just as true here: vitest.config.ts
 * is `environment: 'node'`, so nothing drives the hook below, and a composition
 * written inline inside `setFilter` is a composition no test can see. It is the
 * shape of write that has already gone wrong once on this screen — a keystroke
 * that dropped `?lens=` did not merely leave the link wrong for a render, it
 * handed the store back the lens the reader had already left — so the writer is
 * a function with a name.
 *
 * `prev` IS THE LIVE PARAMS AT THE MOMENT OF THE WRITE, not the render that
 * scheduled the handler. `mapParamsForAll` starts from a fresh object, which is
 * what clears an inherited `?scope=` and would equally clear the portfolio's two
 * controls; they live nowhere else, so they are read back off `prev` and put
 * on again. Without that, one character typed into the search box throws a
 * reader looking at the vendor cohorts back to the stalled list mid-word.
 *
 * ⚠ IT CARRIES, IT DOES NOT CHOOSE — `carryPortfolioParams`, never
 * `mapParamsForPortfolio`. A keystroke is not a grouping decision, and since
 * wave 8 a spelled `?by=` IS one.
 */
export function mapParamsForFilterWrite(
  prev: URLSearchParams,
  filter: FilterState,
  view: MindtreeUrlView,
  lens: MapUrlLens,
): URLSearchParams {
  return carryPortfolioParams(mapParamsForAll(filter, view, lens), prev)
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
 * The rest of the view is read from the STORE rather than from the params, and
 * that is the ordering fix in miniature: on the first paint the URL has not been
 * seeded yet, so composing with `viewFromParams(params)` would write a filter
 * change with no `?focus=` on it and leave the link wrong for exactly as long as
 * it takes the mirror below to put it back. A reader who types into the search
 * box and immediately copies the address bar gets the drill-in they are looking
 * at.
 *
 * READ AT THE MOMENT OF THE WRITE, through `getMindtreeState()` and not through
 * the four hooks this used to subscribe to. A handler that changes two things at
 * once is the reason: `onJump` — a number on the numbers stage, and the list
 * that acts on it — sets the LENS and then the FILTER in one event, and a lens
 * read off the render that scheduled the handler is the lens BEFORE the tap. The
 * URL would then carry the old lens, the inbound effect would read it back, and
 * the one-tap jump the contract costs at "1 interaction" would land on the stage
 * it started from. The store is already the source of truth here; this reads it
 * late enough to be true.
 *
 * `replace`, not push: FilterBar's search is not debounced (its header says
 * why), so a history entry per keystroke would make Back unusable.
 */
export function useMapUrlFilter(): MapUrlFilter {
  const [params, setParams] = useSearchParams()

  /**
   * TWO PARSES, ONE OBJECT PER FILTER. The key is a canonical encoding of the
   * facets (see `mapFilterKey`), so this memo — and therefore `buildMindtree`
   * downstream of it — survives every `?focus=`, `?dim=`, `?lens=` and `?stage=`
   * write the two effects below make. The second parse is over that canonical
   * string, which `mapParamsFor`'s round-trip test proves is lossless.
   */
  const key = useMemo(() => mapFilterKey(params), [params])
  const filter = useMemo(() => mapFilterFromParams(new URLSearchParams(key)), [key])

  const setFilter = useCallback(
    (next: FilterState) => {
      const live = getMindtreeState()
      /**
       * THE FUNCTIONAL FORM, FOR THE ONE PIECE OF STATE THAT IS NOT IN A STORE.
       * `prev` is the params at the moment of the WRITE, which is where the
       * portfolio's two controls live — see `mapParamsForFilterWrite`. It also
       * keeps this callback's dependency array at `[setParams]` rather than
       * re-minting the handler on every param change the map makes.
       */
      setParams(
        (prev) =>
          mapParamsForFilterWrite(prev, next, { focusId: live.focus, dimension: live.dimension }, {
            lens: live.lens,
            stage: stageWithTable(live.lens, live.view === 'table'),
          }),
        { replace: true },
      )
    },
    [setParams],
  )

  return { filter, setFilter }
}

export interface MapUrlPortfolioState {
  portfolio: MapUrlPortfolio
  /**
   * Whether the `?by=` in the address bar was spelled by somebody, as opposed to
   * defaulted by the reader above. The canvas's opening grouping turns on it;
   * see `mapPortfolioChosen` and Mindtree.tsx's `canvasBy`.
   */
  chosen: boolean
  /**
   * `chose` IS NOT OPTIONAL AND HAS NO DEFAULT. Both controls ride in one
   * object, so the setter cannot tell a grouping press from a risk toggle by
   * looking at the value; every caller says which it is, and a caller that says
   * `false` leaves `?by=`'s spelled/unspelled state exactly as it found it.
   */
  setPortfolio: (next: MapUrlPortfolio, chose: boolean) => void
}

/**
 * THE PORTFOLIO'S TWO CONTROLS, IN THE URL. No effect, so it is safe to call
 * anywhere in the composition — and, like `useMapUrlFilter`, it costs one extra
 * `useSearchParams()`, which is a memo over `location.search` and therefore free.
 *
 * The setter starts from `prev` rather than from a fresh object, so a chip tap
 * carries the filter, the drill-in, the dimension and the lens through untouched:
 * one write, in the reader's own tap, and the address bar is a link to exactly
 * what they are looking at (budget E9).
 *
 * `replace`, not push — the whole screen's rule. Back should leave the map
 * rather than walk the reader backwards through four groupings they tried.
 */
export function useMapUrlPortfolio(): MapUrlPortfolioState {
  const [params, setParams] = useSearchParams()

  // TWO PARSES, ONE OBJECT PER STATE. See `mapPortfolioKey` — the second parse
  // is over the canonical string, which the round-trip case proves is lossless.
  const key = useMemo(() => mapPortfolioKey(params), [params])
  const portfolio = useMemo(() => mapPortfolioFromParams(new URLSearchParams(key)), [key])
  // NOT off `key`. The key is canonical, and canonicalising is exactly what
  // erases the difference between a spelled `by=stage` and no `by=` at all.
  const chosen = useMemo(() => mapPortfolioChosen(params), [params])

  const setPortfolio = useCallback(
    (next: MapUrlPortfolio, chose: boolean) => {
      setParams(
        (prev) => {
          const written = mapParamsForPortfolio(prev, next)
          return chose ? written : carryChoiceOnly(written, prev)
        },
        { replace: true },
      )
    },
    [setParams],
  )

  return { portfolio, chosen, setPortfolio }
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
  const lensClaim = useRef<MapLensClaim | null>(null)
  /**
   * Has this effect run at all yet? The one thing the panel rule needs that no
   * pure function can answer.
   *
   * A LENS IN THE ADDRESS BAR IS NOT PROOF THAT SOMEBODY JUST ASKED FOR IT. The
   * mirror below seeds `?lens=` from the store on the first paint, and every
   * filter keystroke rewrites the params with the same lens on them — so
   * "params carry a lens" is true almost all the time, and opening the dock on
   * it would re-open a panel the reader closed, on the next keystroke, forever.
   *
   * The arrival is the FIRST pass (whatever the pasted URL says, said by
   * somebody else) or a pass where the lens DISAGREES with the store as of the
   * render that scheduled it (a palette row, "See all", a `?lens=` typed in).
   * Everything else is this session's own mirror coming back around.
   */
  const arrived = useRef(false)

  useEffect(() => {
    const url = mapUrlInbound(params)
    const wanted = mapLensFromParams(params)
    if (wanted !== null) {
      setMindLens(wanted.lens)
      // Only the open tree has two ways to be drawn, so only those two stages
      // say anything about `view`. `board` and `numbers` follow from the lens
      // and must leave a reader's ledger preference where it was — and so must a
      // link that SPELLED OUT no stage at all, which is why this asks
      // `mapUrlStage` rather than reading `wanted.stage`.
      const spelled = mapUrlStage(params)
      if (spelled === 'table' || spelled === 'map') setMindView(spelled)
      // The focus the LINK carries wins over the persisted one for this
      // question too: `?lens=shape&focus=X` arrives with a branch panel to show,
      // where `?lens=shape` alone may have nothing.
      if (
        (!arrived.current || wanted.lens !== lens) &&
        /*
         * ⚠ THE LINK'S FOCUS ONLY — NOT THE PERSISTED ONE, AND THE COMMENT
         *   ABOVE ALREADY SAID SO: "`?lens=shape` alone may have nothing".
         *   With `?? focusPref` it always had something, because the reader's
         *   remembered focus supplied a subject the link never named. So
         *   opening `/mindtree` — no query, no intent — swung the details card
         *   open over the drawing every time, covering a third of it including
         *   two of the six departments.
         *
         *   The owner's word for that was "garbage". The map is the thing he
         *   SHOWS people (docs/MAP-CONTRACT.md §0); a panel that opens itself
         *   over the picture is the opposite of showing it.
         *
         *   A link that names a node still opens onto it, which is the whole
         *   reason this branch exists — "See all" on the bell and the five
         *   palette rows must land somewhere visibly different.
         */
        mapLensOpensPanel(wanted.lens, url?.focusId ?? null)
      ) {
        setMindPanelOpen(true)
      }
      lensClaim.current = { lens: wanted.lens, stage: spelled }
    }
    arrived.current = true
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
