// The Mindtree's WATCH layer — the map saying what moved while you were reading
// something else.
//
// Aziz leaves this screen open. Two interns and a business team move work all
// day across five domains, and the promise of a live map is that it tells him
// the shape changed WITHOUT him re-reading it. This file is the eyes: it watches
// the entries store, asks `lib/mindtree/pulse.ts` what is worth saying, and
// draws the answer.
//
// ── IT IS A SEPARATE <g>, AND THAT IS THE WHOLE ARCHITECTURE ────────────────
//
// The obvious build is a `data-pulse` attribute on MindNode. It is the wrong
// one, twice over. MindNode is `memo`ised precisely so that a pan, a zoom or a
// hover re-renders ZERO nodes (its header says so, and pages/Mindtree.tsx builds
// its view models in one memo to keep that true); threading a pulse through it
// would re-render a node on every realtime batch, and on a busy afternoon that
// is the entire map re-rendering twice a second for decoration. And it would put
// a temporal concern inside the component whose contract is "IT DECIDES
// NOTHING". An overlay keeps the cost proportional to what is actually lit —
// six rectangles, worst case — and keeps the map itself unaware that time
// exists.
//
// The layer is `aria-hidden` and carries NO STRINGS. Nothing here is knowable
// only from the animation: the count is on the node, the breach is on the node's
// own mark, and the whole picture is in the table view. A pulse is a pointer to
// information that is already on screen, which is the only kind of animation
// that may be skipped without loss — see `useReducedMotion` below, and pulse.ts's
// header for the same decision taken one layer down.
//
// ── FOUR RULES THE BRIEF SET, AND WHERE EACH ONE IS ENFORCED ────────────────
//
//  1. NOTHING PULSES LONGER THAN A COUPLE OF SECONDS. pulse.ts's `PULSE_MS`
//     tops out at 2 400 ms and `PULSE_CEILING_MS` at 3 000. This file adds the
//     half that a decision module cannot own: a ring's element is keyed BY NODE
//     ID ALONE, so it mounts once, animates once, and is never restarted while
//     it is still on screen. A branch taking an edit every 300 ms therefore
//     shows ONE ring per cycle rather than a strobe — the anti-annoyance
//     guarantee, and it falls out of React's own mount semantics rather than
//     out of a timer somebody has to maintain.
//  2. NOTHING PULSES WHILE DRAGGING — OR BECAUSE OF THE DROP. `paused` clears
//     the map and keeps the baselines advancing, so a drag accumulates no
//     backlog that fires all at once on release. And `leftTheMap` below stops
//     the drop ITSELF being announced: re-bucketing an item destroys its node id
//     and looks exactly like a close to a tree diff, so without that guard the
//     one gesture this screen exists for would light the branch it came from,
//     every time.
//  3. A BUSY MINUTE DEGRADES INTO ONE CALM REDRAW. Three caps stack: realtime
//     coalesces a burst into one store commit (api/realtime.ts, 120 ms), pulse.ts
//     raises a burst up the rings until it fits under six, and `isViewChange`
//     below refuses to read a WHOLESALE redraw as news at all.
//  4. REDUCED MOTION IS INSTANT STATE, NOT FAST MOTION. `useReducedMotion`
//     gates the JS so nothing is rendered at all, and pulse-layer.css keeps its
//     own `@media` block so the guarantee survives a caller who forgets. Two
//     independent kills, because global.css's app-wide 0.01 ms flattening is NOT
//     one: an animation flattened to nothing still mounts, still fires, and
//     still paints its first frame.
//
// ── WHAT THIS FILE DOES NOT DO ─────────────────────────────────────────────
//
// It never writes. It has no timers other than the two that clear its own
// decorations, no fetch, and no opinion about what a change MEANS — `closed`
// versus `updated` is pulse.ts's judgement, and "who may change this" is
// actions.ts's. A watch layer that could mutate is a watch layer that can lose
// work, and the drag rule ("every drop goes through the same optimistic path")
// exists one file over precisely so that nothing else invents a write.

import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactElement,
} from 'react'
import { drawnIds } from '../../lib/mindtree/focus'
import type { MindtreeLayout } from '../../lib/mindtree/layout'
import type { MindNode } from '../../lib/mindtree/model'
import {
  breachChanges,
  closedChanges,
  entryChange,
  expirePulses,
  planPulses,
  pulseKindFromFlash,
  EMPTY_PULSES,
  PULSE_MS,
  type PulseChange,
  type PulseKind,
  type PulseMap,
} from '../../lib/mindtree/pulse'
import { useEntryFlashes } from '../../store/entries'
import './pulse-layer.css'

/* ─────────────────────────────── the numbers ─────────────────────────────── */

/**
 * How far outside a node's box the ring is drawn, in layout units.
 *
 * Outside rather than on the edge, because the node already OWNS its outline —
 * `[data-current]` marks the reader's place by taking that outline from 1 to 2 —
 * and a highlight drawn in the same place would be two marks fighting over one
 * stroke. 5 units clears the 1px node stroke at every fit this screen allows.
 */
const RING_INSET = 5

/** Matches `.mtree-node-box`'s `rx`, plus the inset, so the ring stays parallel. */
const RING_RADIUS = 10 + RING_INSET

/**
 * How long a departing card stays on screen after the tree stopped containing
 * it, in ms.
 *
 * Shorter than the shortest pulse and just longer than the relayout tween, so
 * the card is visibly GONE before its neighbours finish sliding into the gap it
 * left. Any longer and the ghost is still there when the layout settles, which
 * reads as a duplicate rather than as a departure.
 */
export const MIND_EXIT_MS = 320

/**
 * The most departing cards drawn at once.
 *
 * Deliberately tiny. One or two cards dissolving is a close; five is a filter,
 * a regroup or a refetch — and Board.tsx's rule, inherited by every layer of
 * this feature, is that a bulk redraw is not an event. Past the cap this file
 * draws NOTHING rather than drawing four of the forty.
 */
export const MIND_EXIT_MAX = 4

/**
 * Above this many drawn nodes the geometry tween is dropped.
 *
 * An SVG transform transition is not composited — the browser re-rasterises
 * every animating node on every frame — so the cost is linear in what is on
 * screen and the map is the one screen in this app that can put four hundred
 * marks on it. A big map therefore SNAPS between layouts, which is honest:
 * nobody can follow four hundred cards moving at once anyway, and a redraw at
 * 12 fps is worse than an instant one.
 *
 * 160 is measured, not guessed — see the handoff note. It is comfortably above
 * a real workspace opened at the track ring (nine tracks, ~40 nodes) and below
 * the expand-everything case.
 */
export const MIND_TWEEN_MAX = 160

/**
 * How many drawn nodes may appear or disappear before a rebuild stops counting
 * as news.
 *
 * THE MOST IMPORTANT NUMBER IN THIS FILE, because without it the tree diffs lie
 * about time. `breachChanges` counts a node that is new AND already breached as
 * a branch that just went red — correct for one item arriving, catastrophic for
 * a rebuild that replaces the whole drawing. Four ordinary acts do exactly that:
 * switching dimension (every `group:` id is replaced), loosening a filter
 * (hidden branches return), expanding a branch (its children appear), and
 * drilling out of a focus. Every one of them would otherwise light up every
 * breached branch on screen and claim it just happened.
 *
 * So a rebuild that moves more than this many nodes is read as a VIEW CHANGE:
 * the baseline is replaced and nothing is announced. Set to pulse.ts's own
 * `PULSE_MAX` on purpose — the number of simultaneous signals a reader can take
 * is also the number of node-level changes that can plausibly be one event.
 */
const VIEW_CHANGE_NODES = 6

/* ───────────────────────────── reduced motion ────────────────────────────── */

const REDUCE_QUERY = '(prefers-reduced-motion: reduce)'

function mediaList(): MediaQueryList | null {
  // `typeof` on an undeclared identifier does not throw, which is what keeps
  // this importable from vitest's `node` environment — store/mindtree.ts guards
  // localStorage the same way and for the same reason.
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  return window.matchMedia(REDUCE_QUERY)
}

function subscribeMotion(onChange: () => void): () => void {
  const mql = mediaList()
  if (mql === null) return () => {}
  mql.addEventListener('change', onChange)
  return () => {
    mql.removeEventListener('change', onChange)
  }
}

/**
 * Does the reader want less motion, RIGHT NOW?
 *
 * Exported and non-reactive so the rule can be asserted without a renderer: this
 * one boolean decides whether the whole watch layer exists, and "we set a media
 * query in a stylesheet" is not evidence that it does. A missing `matchMedia`
 * answers `false` — the honest default for an environment that cannot express a
 * preference, and what keeps this module importable under vitest's `node`.
 */
export function prefersReducedMotion(): boolean {
  return mediaList()?.matches ?? false
}

/**
 * `prefers-reduced-motion: reduce`, LIVE.
 *
 * Live rather than read-once because the setting is a system preference a reader
 * can flip while this tab is open — lib/theme.ts already treats the theme's
 * `auto` the same way, and for the same reason: nothing re-renders on its own,
 * so a value sampled at mount is a value that stays wrong until navigation.
 *
 * It exists AT ALL because pulse.ts takes `reducedMotion` as an argument rather
 * than reading the browser — a decision that makes the model testable without a
 * DOM and leaves exactly one subscription, here, on the surface that owns it.
 */
export function useReducedMotion(): boolean {
  // The server snapshot is `false` and never runs: this app has no SSR. It is
  // supplied because useSyncExternalStore's third argument is not optional in
  // React 19 typings when the first two can run in a non-browser environment.
  return useSyncExternalStore(subscribeMotion, prefersReducedMotion, () => false)
}

/* ──────────────────────────────── the hook ───────────────────────────────── */

export interface MindPulseInput {
  /**
   * The tree AS DRAWN — the post-focus subtree handed to `layoutMindtree`, not
   * the model root. pulse.ts reads `collapsed` off it to decide which node
   * actually represents a change, and a change resolved against a tree the
   * reader is not looking at lands on a node that is not there.
   */
  tree: MindNode | null
  /**
   * True while a drag is in flight. Clears the map and keeps it clear.
   *
   * Not merely "do not add": a ring already running when the gesture starts is
   * removed too. A node lighting up under a finger that is carrying work reads
   * as feedback about the DRAG, which it is not.
   */
  paused?: boolean
  /** The reader's toggle. False renders nothing and costs nothing. */
  enabled?: boolean
  /** Overrides pulse.ts's `PULSE_MAX`. Tests and a future density preference. */
  max?: number
}

export interface MindPulseState {
  /** nodeId → pulse. Empty whenever the layer is off, paused or reduced. */
  readonly pulses: PulseMap
  /**
   * May the drawing animate BETWEEN LAYOUTS? False under reduced motion and on a
   * map too big to tween honestly.
   *
   * Separate from `pulses` because the two degrade in opposite directions: a
   * four-hundred-node map is the one that most needs to be told what changed and
   * least survives four hundred simultaneous transitions. The surface writes it
   * to `data-motion` on the <svg>; mindtree.css does the rest.
   */
  readonly motion: boolean
}

interface Baseline {
  readonly tree: MindNode
  readonly drawn: ReadonlySet<string>
  /** Every entry the map held — see `leftTheMap`. */
  readonly entryIds: ReadonlySet<string>
  /** entryId → the `at` of the flash mark already accounted for. */
  readonly flashAt: ReadonlyMap<string, number>
}

/** Every `entries.id` under this tree, drawn or behind a collapsed branch. */
function entryIdsOf(root: MindNode): Set<string> {
  const out = new Set<string>()
  const stack: MindNode[] = [root]
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (node.entryId !== null) out.add(node.entryId)
    for (const child of node.children) stack.push(child)
  }
  return out
}

/**
 * Did any entry actually LEAVE the working set?
 *
 * THE GUARD THAT STOPS THE MAP NARRATING THE READER'S OWN DRAG. `closedChanges`
 * compares NODE ids, and a node id contains its bucket — so moving one item from
 * "blocked" to "in progress" destroys `…/group:blocked/entry:x` and creates
 * `…/group:in_progress/entry:x`, which is indistinguishable from a close to a
 * diff over ids. Without this, every status change, every reassignment and every
 * successful DROP would light the branch it came from with a pulse that means
 * "this closed". A drop is the gesture this whole screen exists for; having the
 * map comment on it is the definition of the annoyance the brief warns about.
 *
 * An entry that is still SOMEWHERE on the map did not close — it moved, and the
 * move is already announced where it lands (a flash mark on the row, or the
 * reader's own hand). Only a genuine departure opens the gate.
 *
 * Exported for its test: "the map must not react to my own drop" is a product
 * rule, and a product rule with no assertion behind it is a comment.
 */
export function leftTheMap(before: ReadonlySet<string>, after: ReadonlySet<string>): boolean {
  for (const id of before) if (!after.has(id)) return true
  return false
}

/**
 * Watch the store, and decide what the map should say about it.
 *
 * THE FIRST PLAN IS ALWAYS SILENT. A tree that was not there a moment ago has
 * not "changed", and neither has a flash mark that was already sitting in the
 * store when the reader arrived from another screen. Both are absorbed into the
 * baseline and announced to nobody — Board.tsx's "a first load is not an event",
 * arriving through the two doors this screen has.
 */
export function useMindPulses({
  tree,
  paused = false,
  enabled = true,
  max,
}: MindPulseInput): MindPulseState {
  const flash = useEntryFlashes()
  const reduced = useReducedMotion()
  const [pulses, setPulses] = useState<PulseMap>(EMPTY_PULSES)

  /**
   * The last state the tree diffs were taken against, plus the flash marks
   * already spent.
   *
   * A ref rather than state because writing it must NOT re-render: it is updated
   * on every store commit, including the ones that turn out to say nothing.
   */
  const baseline = useRef<Baseline | null>(null)
  /**
   * What was last handed to the renderer.
   *
   * Mirrored out of React so the planning effect does not have to depend on
   * `pulses` — an effect that both reads and writes one piece of state re-runs
   * on its own output, which here would mean re-planning every batch twice.
   */
  const live = useRef<PulseMap>(EMPTY_PULSES)

  // Two walks of the tree, taken once per rebuild rather than once per use: the
  // drawn set sizes the tween AND tells a view change from an event, and the
  // entry set is the close guard. The tree is rebuilt on every commit anyway, so
  // this is two linear passes over a structure four rings deep.
  const drawn = useMemo(() => (tree === null ? null : drawnIds(tree)), [tree])
  const entryIds = useMemo(() => (tree === null ? null : entryIdsOf(tree)), [tree])
  const off = reduced || !enabled

  useEffect(() => {
    if (tree === null || drawn === null || entryIds === null) {
      baseline.current = null
      return
    }

    const spent = new Map<string, number>()
    for (const [id, mark] of flash) spent.set(id, mark.at)
    const next: Baseline = { tree, drawn, entryIds, flashAt: spent }

    const clear = (): void => {
      if (live.current !== EMPTY_PULSES) {
        live.current = EMPTY_PULSES
        setPulses(EMPTY_PULSES)
      }
    }

    // Off, mid-drag, or looking at this tree for the first time. In all three
    // the baseline still advances, so switching back on — or letting go of a
    // drag — does not fire everything that happened in the meantime.
    if (off || paused || baseline.current === null) {
      baseline.current = next
      if (off || paused) clear()
      return
    }

    const before = baseline.current
    baseline.current = next

    const now = Date.now()
    const changes: PulseChange[] = []
    for (const [id, mark] of flash) {
      if (before.flashAt.get(id) === mark.at) continue
      changes.push(entryChange(id, pulseKindFromFlash(mark.kind), mark.at))
    }
    // The two tree-derived kinds, and ONLY when the two trees describe the same
    // view — see VIEW_CHANGE_NODES.
    if (!isViewChange(before.drawn, drawn)) {
      for (const change of breachChanges(before.tree, tree, now)) changes.push(change)
      // …and only when something genuinely left. See `leftTheMap`.
      if (leftTheMap(before.entryIds, entryIds)) {
        for (const change of closedChanges(before.tree, tree, now)) changes.push(change)
      }
    }

    const planned = planPulses({ changes, tree, now, active: live.current, max })
    // planPulses answers by reference when nothing moved, which is what makes
    // this cheap enough to run on every commit.
    if (planned !== live.current) {
      live.current = planned
      setPulses(planned)
    }
  }, [tree, drawn, entryIds, flash, paused, off, max])

  /**
   * Clear the map when the last deadline passes.
   *
   * Necessary because a quiet map gets no further commits: without this the
   * final ring's element would stay mounted, invisible (its animation over,
   * its base style transparent) but forever pending, and the next real change
   * would find the node already in the map and decline to re-mount it — a pulse
   * silently swallowed minutes later. One timeout at a time, not one per pulse.
   */
  useEffect(() => {
    if (pulses.size === 0) return
    let earliest = Number.POSITIVE_INFINITY
    for (const pulse of pulses.values()) earliest = Math.min(earliest, pulse.until)
    const timer = setTimeout(
      () => {
        const settled = expirePulses(live.current, Date.now())
        if (settled !== live.current) {
          live.current = settled
          setPulses(settled)
        }
      },
      // A floor, so a deadline already in the past cannot spin.
      Math.max(16, earliest - Date.now()),
    )
    return () => {
      clearTimeout(timer)
    }
  }, [pulses])

  const motion = !reduced && (drawn?.size ?? 0) <= MIND_TWEEN_MAX
  return useMemo(() => ({ pulses, motion }), [pulses, motion])
}

/**
 * Did the drawing change WHOLESALE?
 *
 * Counts the symmetric difference of the two drawn sets and stops early — the
 * question is never "how different", only "more than six". See
 * VIEW_CHANGE_NODES for the four ordinary acts this exists to catch.
 *
 * Exported for its test: it is one boolean standing between a live map and a map
 * that shouts every time somebody presses a chip.
 */
export function isViewChange(
  before: ReadonlySet<string>,
  after: ReadonlySet<string>,
): boolean {
  let moved = 0
  for (const id of after) {
    if (!before.has(id) && ++moved > VIEW_CHANGE_NODES) return true
  }
  for (const id of before) {
    if (!after.has(id) && ++moved > VIEW_CHANGE_NODES) return true
  }
  return false
}

/* ─────────────────────────────── the exits ───────────────────────────────── */

/**
 * A card that has left the tree, drawn one last time where it was.
 *
 * Geometry only: no label, no count, no colour decision. It is the node's own
 * box, dissolving.
 */
export interface MindGhost {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly vars: CSSProperties
}

const NO_GHOSTS: readonly MindGhost[] = Object.freeze([])

/**
 * The entry cards present in `before` and absent from `after`.
 *
 * FOUR GATES, and each one is a way a rebuild can remove cards without anything
 * having closed:
 *
 *  · a different drawn root — the reader drilled in or out;
 *  · a parent that also went — the branch was filtered away, not emptied;
 *  · more than `MIND_EXIT_MAX` — a filter, a regroup, a refetch;
 *  · non-entry nodes are never ghosted — a group or a track disappearing is a
 *    structural change, and a dissolving branch would imply the work under it
 *    went with it.
 *
 * Which is why this does NOT consult the pulse map, though "closed" is exactly
 * what it is drawing. The pulse map is computed in an effect and therefore
 * arrives a frame after the layout that caused it; gating on it would mean the
 * card is already gone by the time the gate opens. The four rules above are the
 * same judgement made from the same evidence, one frame earlier.
 *
 * Pure and exported: this is the interesting half, and it is testable with two
 * layouts and no DOM.
 */
export function ghostsFor(
  before: MindtreeLayout<MindNode>,
  after: MindtreeLayout<MindNode>,
): readonly MindGhost[] {
  const beforeRoot = before.nodes[0]
  const afterRoot = after.nodes[0]
  if (beforeRoot === undefined || afterRoot === undefined) return NO_GHOSTS
  if (beforeRoot.id !== afterRoot.id) return NO_GHOSTS

  const out: MindGhost[] = []
  // Pre-order, so the result is in the tree's own reading order without a sort.
  for (const pos of before.nodes) {
    if (pos.node.entryId === null) continue
    if (after.byId.has(pos.id)) continue
    if (pos.parentId === null || !after.byId.has(pos.parentId)) continue
    if (out.length === MIND_EXIT_MAX) return NO_GHOSTS
    out.push({
      id: pos.id,
      x: pos.x,
      y: pos.y,
      width: pos.width,
      height: pos.height,
      vars: pos.node.colourVars,
    })
  }
  return out.length === 0 ? NO_GHOSTS : out
}

/**
 * Hold the departing cards for `MIND_EXIT_MS`.
 *
 * THE TIMER IS A REF, NOT AN EFFECT CLEANUP, and the difference is a bug worth
 * naming: this effect re-runs on every layout identity change, which on a live
 * map is several a second. A cleanup-owned timeout would be cancelled by the
 * very next rebuild and never re-armed — the ghosts would stay on screen
 * forever, over a map that had moved on without them.
 */
function useExitGhosts(
  layout: MindtreeLayout<MindNode>,
  reduced: boolean,
): readonly MindGhost[] {
  const [ghosts, setGhosts] = useState<readonly MindGhost[]>(NO_GHOSTS)
  const previous = useRef<MindtreeLayout<MindNode> | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const before = previous.current
    previous.current = layout
    if (reduced || before === null || before === layout) return
    const leaving = ghostsFor(before, layout)
    if (leaving.length === 0) return
    if (timer.current !== null) clearTimeout(timer.current)
    setGhosts(leaving)
    timer.current = setTimeout(() => {
      timer.current = null
      setGhosts(NO_GHOSTS)
    }, MIND_EXIT_MS)
  }, [layout, reduced])

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )

  return reduced ? NO_GHOSTS : ghosts
}

/* ────────────────────────────── the component ────────────────────────────── */

export interface PulseLayerProps {
  /** The layout the map is drawing. Positions come from here, never recomputed. */
  layout: MindtreeLayout<MindNode>
  /** `useMindPulses().pulses`. */
  pulses: PulseMap
}

interface Ring {
  readonly id: string
  readonly kind: PulseKind
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly style: CSSProperties
}

/**
 * Render the marks. Nothing is decided here — every ring is a node pulse.ts
 * named and a position layout.ts computed.
 *
 * MOUNT SEMANTICS ARE THE ANIMATION CONTROLLER. A ring is keyed by node id
 * alone, so it animates once on mount and is never restarted while it is lit,
 * however much traffic the branch takes; it re-animates only after the pulse has
 * expired, been removed, and a genuinely new change has arrived. That is the
 * anti-strobe guarantee, and it needs no timer.
 *
 * IT MUST RENDER INSIDE THE SAME <svg> AS THE NODES, after them in document
 * order — SVG has no z-index, so paint order is document order and a ring
 * rendered first would sit under the card it is marking.
 */
export const PulseLayer = memo(function PulseLayer({
  layout,
  pulses,
}: PulseLayerProps): ReactElement {
  const reduced = useReducedMotion()
  const ghosts = useExitGhosts(layout, reduced)

  const rings = useMemo<readonly Ring[]>(() => {
    if (reduced || pulses.size === 0) return []
    const out: Ring[] = []
    for (const [id, pulse] of pulses) {
      const pos = layout.byId.get(id)
      // A pulse can outlive the node it names by a frame — the tree rebuilds,
      // the map is planned against the tree that caused it. Skipping is right:
      // the next plan resolves the change onto whatever is drawn now.
      if (pos === undefined) continue
      out.push({
        id,
        kind: pulse.kind,
        x: pos.x - RING_INSET,
        y: pos.y - RING_INSET,
        width: pos.width + RING_INSET * 2,
        height: pos.height + RING_INSET * 2,
        style: {
          ...pos.node.colourVars,
          // The one number CSS cannot know: each kind holds for its own time,
          // and the four are pulse.ts's to choose.
          '--mtree-pulse-ms': `${PULSE_MS[pulse.kind]}ms`,
        } as CSSProperties,
      })
    }
    // Map order is insertion order and therefore stable, but the DOM order of a
    // decoration should not depend on the order events happened to arrive in.
    out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    return out
  }, [layout, pulses, reduced])

  return (
    <g className="mtree-pulses" aria-hidden="true">
      {ghosts.map((ghost) => (
        <rect
          key={`gone:${ghost.id}`}
          className="mtree-ghost"
          style={
            {
              ...ghost.vars,
              // Same rule as the ring's duration: the number lives in the module
              // that can be tested, and CSS is told.
              '--mtree-exit-ms': `${MIND_EXIT_MS}ms`,
            } as CSSProperties
          }
          x={ghost.x}
          y={ghost.y}
          width={ghost.width}
          height={ghost.height}
          rx={10}
          ry={10}
        />
      ))}
      {rings.map((ring) => (
        <rect
          key={ring.id}
          className="mtree-pulse"
          data-kind={ring.kind}
          style={ring.style}
          x={ring.x}
          y={ring.y}
          width={ring.width}
          height={ring.height}
          rx={RING_RADIUS}
          ry={RING_RADIUS}
        />
      ))}
    </g>
  )
})

export default PulseLayer
