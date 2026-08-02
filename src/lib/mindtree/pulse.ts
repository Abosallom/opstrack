// The Mindtree's WATCH layer: what just changed, and where to say so.
//
// The map is a screen somebody leaves open. Two interns and a business team move
// work all day, and the whole promise of a live map is that it tells you when
// the shape changed WITHOUT you having to re-read it. This module decides that;
// the component only renders what it decides.
//
// PURE BY CONSTRUCTION, and more aggressively than its neighbours because this
// is the one part of the feature that is about TIME. No clock (`now` arrives as
// an argument), no timers, no `matchMedia`, no store, no DOM. Every decision an
// animation layer normally makes at 60fps inside a browser is made here, once,
// against plain numbers — which is why the interesting cases below are unit
// tests rather than something you catch by staring at a screen and hoping a
// realtime event arrives while you are looking.
//
// ── WHAT MAKES THIS DIFFERENT FROM THE BOARD'S ARRIVAL ANIMATION ───────────
//
// pages/Board.tsx animates a CARD that moved column. Every card is on screen, so
// the thing that changed is the thing that animates. A tree is not like that.
// The map opens at the TRACK ring (model.ts's `openDepth` explains why: ring 2
// at real volume renders labels at 3.9px), so the entry that actually changed is
// usually inside a collapsed branch and has no pixels at all. Pulsing its node
// id would be pulsing nothing.
//
// So the core of this module is a RESOLUTION step, not a filter: every change is
// carried outward to the nearest node the surface is actually drawing. That is
// also, for free, most of the coalescing the brief asks for — twenty entries
// changing under one collapsed track is ONE pulse on that track, because all
// twenty resolve to the same node. The tree does the work the board had to do
// with a burst counter.
//
// ── THE FOUR THINGS WORTH INTERRUPTING SOMEBODY FOR ────────────────────────
//
// `breached` · `added` · `closed` · `updated`, and nothing else. A pulse is an
// interruption; a vocabulary of fifteen would be a screen that flickers
// constantly and means nothing. When several land on one node the highest
// precedence wins — escalation, then new load, then progress, then chatter.
//
// ── THE CAP, AND WHY IT RAISES BEFORE IT GIVES UP ──────────────────────────
//
// Board.tsx caps arrival animations at 6 and, past the cap, animates NOTHING:
// "a filter change, an axis switch or a first load. Not an event." That
// judgement is exactly right and is inherited here. But a flat list has only the
// two options — animate each, or animate none — while a tree has a third that is
// strictly better: RAISE. Ten items changing across two tracks, drawn expanded,
// is ten pulses (over cap, board would show nothing) or two (their tracks), and
// two is both under the cap and a truer description of what happened. So the cap
// is enforced by climbing one ring at a time until the burst fits, and only
// gives up if it still does not fit at the top. Never at the root: a pulse on
// the root is the entire map convulsing, which is the thing the cap exists to
// prevent.
//
// ── REDUCED MOTION ─────────────────────────────────────────────────────────
//
// `reducedMotion: true` returns an EMPTY map — no pulses, no exceptions. The
// flag is passed IN rather than read from `matchMedia` so this stays testable
// without a browser, and so the surface owns the one subscription. See
// `planPulses` for what a reduced-motion reader gets instead, and the handoff
// note for why that is deliberately not this module's decision to make.

import { ancestorIdsOf, drawnIds, nearestId } from './focus'
import { ROOT_ID, type MindNode } from './model'

// ── the output ─────────────────────────────────────────────────────────────

/**
 * Why a node is lit. Ordered by precedence in `RANK` below, not here.
 *
 * `closed` is the one that needs saying: an entry that closes LEAVES the map
 * (the working set is open work), so this never marks the entry — it marks the
 * branch the entry left, which is the only node still on screen to mark.
 */
export type PulseKind = 'breached' | 'added' | 'closed' | 'updated'

export interface Pulse {
  readonly kind: PulseKind
  /**
   * Epoch ms. The surface clears the pulse at or after this instant — pass it
   * back through `expirePulses(map, now)` on a frame or a timeout.
   *
   * An absolute deadline rather than a duration because this module is called
   * again on every batch: a duration would have to be re-based against an
   * elapsed time nobody is tracking, and the second batch would silently restart
   * every pulse the first one started.
   */
  readonly until: number
}

/** nodeId → pulse. The whole contract with the renderer. */
export type PulseMap = ReadonlyMap<string, Pulse>

/** One shared empty map, so "nothing is pulsing" is reference-stable. */
export const EMPTY_PULSES: PulseMap = new Map<string, Pulse>()

// ── the numbers ────────────────────────────────────────────────────────────

/**
 * How long each kind stays lit, in ms. mindtree.css's animation durations must
 * match these; they are exported so the surface can drive them as custom
 * properties rather than duplicating four magic numbers in a stylesheet.
 *
 * A breach outlasts the rest by design. It is the only one of the four that
 * needs ACTING on, and it is the one a reader is most likely to miss because it
 * arrives without anybody having done anything — nobody moved an item, a
 * deadline simply passed.
 */
export const PULSE_MS: Readonly<Record<PulseKind, number>> = {
  breached: 2400,
  added: 1200,
  closed: 1200,
  updated: 900,
}

/**
 * Precedence when several changes land on one node. Higher wins.
 *
 * Escalation over load over progress over chatter. The case that settles the
 * order: a busy branch where somebody posts an update in the same second an item
 * breaches must read as the breach — the update will still be there when the
 * reader looks, the breach is the thing that was going to be missed.
 */
const RANK: Readonly<Record<PulseKind, number>> = {
  breached: 3,
  added: 2,
  closed: 1,
  updated: 0,
}

/**
 * The most nodes that may pulse at once — Board.tsx's `ENTER_BURST_MAX`, same
 * number for the same reason. Six simultaneous signals is a screen you can read;
 * a dozen is a screen that is having an episode.
 */
export const PULSE_MAX = 6

/**
 * A node may not stay lit longer than this no matter how much traffic it takes.
 *
 * Without it, a branch under sustained edits (a meeting bulk-commit, an intern
 * working through a backlog) re-extends its own deadline on every batch and
 * glows indefinitely — which stops reading as "something happened" and starts
 * reading as a broken stylesheet.
 */
export const PULSE_CEILING_MS = 3000

/**
 * Changes older than this are ignored.
 *
 * THE RESYNC GUARD, and the reason it is not optional: api/realtime.ts emits a
 * resync after a reconnect or a tab hidden longer than a minute, and
 * store/entries.ts answers it with a full refetch. Every row then lands at once
 * carrying its real timestamp. Without a staleness floor, coming back to a tab
 * after lunch would light up the entire workspace — which is precisely the
 * "first load is not an event" rule Board.tsx states, arriving through a
 * different door.
 */
export const PULSE_STALE_MS = 5000

// ── the input ──────────────────────────────────────────────────────────────

/**
 * One thing that happened, aimed at either an entry or a node.
 *
 * TWO TARGET KINDS because the four pulse reasons genuinely have two sources.
 * An add or an update is a fact about a ROW — the store knows it, the tree is
 * only asked where that row is drawn. A breach is a fact about a SUBTREE —
 * `MindHealth.slaBreached` rolls up, so it belongs to a node and no single entry
 * owns it. Forcing both through an entry id would mean inventing a
 * representative entry for a branch-level event.
 */
export interface PulseChange {
  readonly kind: PulseKind
  /** Epoch ms the change landed — `FlashMark.at` for store-sourced changes. */
  readonly at: number
  readonly target:
    | { readonly kind: 'entry'; readonly id: string }
    | { readonly kind: 'node'; readonly id: string }
}

/** A change about a row. The id is an `entries.id`, not a node id. */
export function entryChange(entryId: string, kind: PulseKind, at: number): PulseChange {
  return { kind, at, target: { kind: 'entry', id: entryId } }
}

/** A change about a branch. The id is a `MindNode.id`. */
export function nodeChange(nodeId: string, kind: PulseKind, at: number): PulseChange {
  return { kind, at, target: { kind: 'node', id: nodeId } }
}

/**
 * store/entries.ts's `FlashMark`, structurally.
 *
 * Declared rather than imported: `lib/**` may not reach into `store/**`, the
 * same rule model.ts's input shapes are declared under. A `FlashMark` is
 * assignable as-is; the actor fields are ignored here because a pulse says
 * SOMETHING CHANGED, and who changed it is the flash mark's own job on the
 * entry row.
 */
export interface FlashLike {
  readonly kind: 'new' | 'edit' | 'update'
  readonly at: number
}

/**
 * The store's three flash kinds folded onto this module's four.
 *
 * `edit` (the entries row changed) and `update` (a follow-up was posted) both
 * become `updated`, and that collapse is deliberate: on a map at track-ring zoom
 * the two are the same event — somebody touched work under this branch. The
 * distinction is real and is drawn where it can be read, on the entry row.
 *
 * Note what is NOT derivable here: `closed` and `breached`. Neither is a
 * property of a flash mark — a close is only visible as a row LEAVING the open
 * working set, and a breach is a roll-up. `closedChanges` and `breachChanges`
 * below cover them, from the tree.
 */
export function pulseKindFromFlash(kind: FlashLike['kind']): PulseKind {
  return kind === 'new' ? 'added' : 'updated'
}

export interface PulseInput {
  /** What happened since the last call. */
  readonly changes: readonly PulseChange[]
  /** The tree AS DRAWN — `collapsed` is read, so pass the post-focus subtree. */
  readonly tree: MindNode
  /** Epoch ms. The only clock this module has. */
  readonly now: number
  /** Pulses still running from earlier batches. */
  readonly active?: PulseMap
  /** `prefers-reduced-motion: reduce`. True kills every pulse. */
  readonly reducedMotion?: boolean
  /** Overrides `PULSE_MAX`. For tests and for a future density preference. */
  readonly max?: number
}

// ── the decision ───────────────────────────────────────────────────────────

/**
 * Fold a batch of changes into the pulse map the surface should render next.
 *
 * Returns `active` BY REFERENCE when nothing changes, so a component holding
 * this in state can bail out of a re-render on identity. That matters more here
 * than it looks: this runs on every realtime batch, and a new Map every time
 * would re-render every node on the map twice a second on a busy afternoon.
 *
 * WHAT A REDUCED-MOTION READER GETS INSTEAD: nothing from this module, and that
 * is the honest answer rather than a gap. The counts on every branch are live —
 * they are re-derived from the same batch that produced these changes — so the
 * map still updates under them; what it does not do is move. Anything more (a
 * static "changed" marker that persists) is a real design decision about a
 * second visual variable on a map whose budget is two, and it belongs to
 * whoever owns the picture, not to a module that was asked to time animations.
 */
export function planPulses(input: PulseInput): PulseMap {
  if (input.reducedMotion === true) return EMPTY_PULSES
  const max = Math.max(0, Math.floor(input.max ?? PULSE_MAX))
  if (max === 0) return EMPTY_PULSES

  const live = expirePulses(input.active ?? EMPTY_PULSES, input.now)
  if (input.changes.length === 0) return live

  const drawn = drawnIds(input.tree)
  const entryAt = entryNodeIndex(input.tree)

  // 1. Resolve every change to a node that is actually on screen.
  const burst = new Map<string, PulseKind>()
  for (const change of input.changes) {
    // Stale, or dated in the future by a clock that disagrees with ours. Both
    // are dropped: see PULSE_STALE_MS for the resync case this exists for.
    const age = input.now - change.at
    if (!Number.isFinite(age) || age > PULSE_STALE_MS || age < -PULSE_STALE_MS) continue

    const seed =
      change.target.kind === 'entry' ? entryAt.get(change.target.id) : change.target.id
    if (seed === undefined) continue
    const node = nearestId(seed, (id) => drawn.has(id))
    // Resolved to the root, or to nothing at all. The root is the whole picture
    // and is never pulsed — see the header.
    if (node === null || node === ROOT_ID || node === input.tree.id) continue
    merge(burst, node, change.kind)
  }
  if (burst.size === 0) return live

  // 2. Climb until the burst fits under the cap.
  const fitted = fit(burst, max, input.tree.id)
  if (fitted.size === 0) return live

  // 3. Merge onto what is already running, then trim to the cap.
  return commit(live, fitted, input.now, max)
}

/**
 * Drop pulses whose deadline has passed.
 *
 * Exported because the surface needs it on a timeout as well: a quiet map gets
 * no further batches, so nothing would otherwise call `planPulses` again to
 * clear the last pulse and it would stay lit until the next edit.
 *
 * Returns the SAME map when nothing expired — see `planPulses` on identity.
 */
export function expirePulses(active: PulseMap, now: number): PulseMap {
  let stale = false
  for (const pulse of active.values()) {
    if (pulse.until <= now) {
      stale = true
      break
    }
  }
  if (!stale) return active

  const next = new Map<string, Pulse>()
  for (const [id, pulse] of active) if (pulse.until > now) next.set(id, pulse)
  return next.size === 0 ? EMPTY_PULSES : next
}

/** Keep the higher-precedence kind for a node. */
function merge(into: Map<string, PulseKind>, id: string, kind: PulseKind): void {
  const held = into.get(id)
  if (held === undefined || RANK[kind] > RANK[held]) into.set(id, kind)
}

/**
 * Climb one ring at a time until the burst is at or under the cap.
 *
 * Each pass replaces every node with its parent and re-merges, so siblings
 * collapse into one pulse on the branch that holds them. A pulse whose parent is
 * the drawn root is DROPPED rather than raised — the alternative is lighting the
 * whole map, which is worse than saying nothing.
 *
 * TERMINATES ON ID LENGTH, not on whether the count went down. Every pass
 * replaces each id with a strict prefix of itself, so the longest id shortens
 * every time and the loop is bounded by the tree's depth — four rings. The
 * count is NOT a valid termination signal, and assuming it was is a bug worth
 * naming: where a ring is 1:1 with the ring below it (a group holding a single
 * entry, which is most groups on a quiet week) one climb moves eight entries
 * onto eight groups and looks like no progress at all. Bailing there would give
 * up one ring short of the two tracks that would have fitted comfortably.
 *
 * The real floor is the root. When every remaining pulse is already a direct
 * child of it there is nowhere left to climb, the pass yields nothing, and
 * Board.tsx's judgement applies unchanged: this is a bulk event, not an event.
 */
function fit(burst: Map<string, PulseKind>, max: number, rootId: string): Map<string, PulseKind> {
  let held = burst
  while (held.size > max) {
    const up = new Map<string, PulseKind>()
    for (const [id, kind] of held) {
      const parent = ancestorIdsOf(id)[0]
      if (parent === undefined || parent === rootId || parent === ROOT_ID) continue
      merge(up, parent, kind)
    }
    if (up.size === 0) return new Map<string, PulseKind>()
    held = up
  }
  return held
}

/**
 * Apply the fitted burst to the running map, then hold the whole thing to the
 * cap.
 *
 * A node already lit keeps the higher-precedence kind and takes the LATER
 * deadline, so a branch under sustained traffic stays lit rather than
 * re-triggering — bounded by `PULSE_CEILING_MS` so it cannot glow forever.
 *
 * The trim keeps the freshest pulses (latest deadline first, id as the total
 * tiebreak so the result is deterministic and two renders of the same batch
 * never disagree).
 */
function commit(live: PulseMap, burst: Map<string, PulseKind>, now: number, max: number): PulseMap {
  const next = new Map(live)
  for (const [id, kind] of burst) {
    const held = next.get(id)
    const winner = held === undefined || RANK[kind] > RANK[held.kind] ? kind : held.kind
    const fresh = now + PULSE_MS[winner]
    const until = Math.min(
      held === undefined ? fresh : Math.max(held.until, fresh),
      now + PULSE_CEILING_MS,
    )
    next.set(id, { kind: winner, until })
  }

  if (next.size <= max) return next
  const ranked = [...next].sort((a, b) => b[1].until - a[1].until || (a[0] < b[0] ? -1 : 1))
  return new Map(ranked.slice(0, max))
}

// ── deriving changes from two trees ────────────────────────────────────────
//
// `added` and `updated` come off the store's flash marks. The other two do not
// exist at row level and have to be read off the picture itself — which is
// cheap, because the tree is rebuilt on every batch anyway and these are two
// walks over a structure four deep.
//
// BOTH REFUSE TO FIRE ON FIRST PAINT (`previous === null` → no changes). Nothing
// "happened" on a map that was not there a moment ago; Board.tsx states the same
// rule for the same reason, and here it is what stops a cold load — or a route
// change back onto /mindtree — from lighting every breached branch at once.

/**
 * Branches that have crossed INTO SLA breach since the previous tree.
 *
 * Reports the DEEPEST nodes that flipped, not every node on the chain. A leaf
 * going red flips its group, its track and the root too (the roll-up is rule 2
 * of model.ts), and pulsing all four for one event is four times the
 * interruption for the same fact. Emitting the deepest and letting `planPulses`
 * carry it outward to whatever is drawn gives exactly one pulse, on the right
 * node for the current zoom.
 *
 * A node that is NEW and already breached counts. That is a breached item
 * arriving on a branch, which is a branch that just went red — the fact the
 * reader needs, whether it went red by aging or by arriving.
 */
export function breachChanges(
  previous: MindNode | null,
  next: MindNode,
  at: number,
): PulseChange[] {
  if (previous === null) return []
  const before = new Map<string, boolean>()
  indexBreach(previous, before)

  const out: PulseChange[] = []
  walkBreach(next, before, out, at)
  return out
}

/** True when this node flipped, so the caller can skip its ancestors. */
function walkBreach(
  node: MindNode,
  before: ReadonlyMap<string, boolean>,
  out: PulseChange[],
  at: number,
): boolean {
  let deeper = false
  for (const child of node.children) {
    if (walkBreach(child, before, out, at)) deeper = true
  }
  if (deeper) return true
  if (!node.health.slaBreached) return false
  if (before.get(node.id) === true) return false
  // Flipped, and nothing under it flipped — this is the deepest report.
  out.push(nodeChange(node.id, 'breached', at))
  return true
}

function indexBreach(node: MindNode, into: Map<string, boolean>): void {
  into.set(node.id, node.health.slaBreached)
  for (const child of node.children) indexBreach(child, into)
}

/**
 * Branches that LOST an entry since the previous tree.
 *
 * "Closed" is the honest reading only most of the time, and this function does
 * not pretend otherwise — an entry also leaves the map when the filter narrows,
 * when the search box takes another keystroke, or when the dimension switches.
 * What makes that acceptable rather than a lie is the cap: those three cases
 * remove entries in BULK, `fit` cannot squeeze a workspace-wide exodus under six
 * pulses, and the burst is dropped exactly as Board.tsx drops a filter change.
 * One item vanishing is a close; forty vanishing is a filter, and neither
 * animates as the other.
 *
 * The pulse is aimed at the PARENT the entry left, because the entry's own node
 * no longer exists to aim at. Where that parent has also gone — a group emptied
 * of its last item disappears with it — `planPulses` walks outward to the track,
 * which is the branch that visibly just got lighter.
 */
export function closedChanges(previous: MindNode | null, next: MindNode, at: number): PulseChange[] {
  if (previous === null) return []
  const survives = new Set<string>()
  indexEntryNodes(next, survives)

  const gone = new Set<string>()
  collectLeft(previous, survives, gone)

  const out: PulseChange[] = []
  for (const id of [...gone].sort()) out.push(nodeChange(id, 'closed', at))
  return out
}

/** Collect the PARENT ids of entry nodes that are no longer in the new tree. */
function collectLeft(node: MindNode, survives: ReadonlySet<string>, into: Set<string>): void {
  for (const child of node.children) {
    if (child.entryId !== null) {
      if (!survives.has(child.id)) into.add(node.id)
      continue
    }
    collectLeft(child, survives, into)
  }
}

function indexEntryNodes(node: MindNode, into: Set<string>): void {
  if (node.entryId !== null) into.add(node.id)
  for (const child of node.children) indexEntryNodes(child, into)
}

/**
 * entryId → the id of the node the surface is DRAWING for that entry.
 *
 * An entry inside a collapsed branch maps to the branch, which is the whole
 * reason this index exists rather than a plain search for the entry's own node —
 * see the header. Entries under a collapsed node are still walked, because
 * `MindNode.children` is always complete (collapsing is a rendering decision)
 * and every one of them has to resolve to something on screen.
 */
function entryNodeIndex(root: MindNode): Map<string, string> {
  const out = new Map<string, string>()
  walkIndex(root, null, out)
  return out
}

function walkIndex(node: MindNode, owner: string | null, out: Map<string, string>): void {
  // Once inside a collapsed branch, everything below belongs to that branch.
  const held = owner ?? (node.collapsed ? node.id : null)
  if (node.entryId !== null) out.set(node.entryId, held ?? node.id)
  for (const child of node.children) walkIndex(child, held, out)
}
