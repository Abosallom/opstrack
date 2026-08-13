// The map's own interaction state — what is focused, hovered, ticked, in flight,
// and what the reader wants remembered next time.
//
// WHY THE SCREEN NEEDS A STORE AT ALL, when pages/Mindtree.tsx has held its
// state in `useState` since it shipped. Because the map stopped being one
// component. A node knows whether it is hovered, a node menu knows what it can
// do, a drag knows what it is carrying, a bulk bar knows what is ticked, and the
// table view has to agree with the picture about every one of those — and
// threading five pieces of state through a tree of positioned nodes as props is
// how a 60 fps hover becomes a full re-layout of the workspace. Narrow selectors
// are the point: `useMindIsSelected(id)` re-renders one node.
//
// IT OWNS `opstrack_mindtree_v1` OUTRIGHT. That key already exists — Mindtree.tsx
// wrote `{ dimension, view, collapsed, opened }` into it — and TWO writers on one
// localStorage key is not a merge, it is whichever ran last. So this module
// ABSORBS that shape rather than inventing a second key: every field the page
// persisted is still read, still written, and still means what it meant, and the
// page's own `readPrefs`/`writePrefs`/`PREFS_KEY` are deleted in the same change.
// A reader who collapsed nine branches yesterday still finds them collapsed.
//
// EVERY FIELD IS VALIDATED ON READ, and that is not defensiveness for its own
// sake. `localStorage` is user-writable storage that outlives a schema change: a
// `dimension: 'assignee'` written by a future build, a `focus` naming a track
// deleted last month, a `collapsed` that is a string instead of an array. Each
// one has to cost the reader A PREFERENCE and never a screen — the rule
// model.ts's `isMindDimension` was exported for, and the reason `readPrefs`
// below returns a whole default rather than throwing.
//
// THE TWO DERIVED SETS ARE STATE, NOT A SELECTOR. `collapsedIds` and
// `expandedIds` are the active dimension's slice of the two persisted records,
// as Sets. Building them inside a selector would return a NEW Set on every
// render, and under `useSyncExternalStore` a new reference reads as "the
// snapshot changed" — forever. store/entrySheet.ts's header documents the same
// hazard for the same reason and solves it the same way: derive once per write,
// hand out by reference.
//
// THE DRAG SESSION IS NOT IN HERE, deliberately, and this is the one shape rule
// a surface must not relax. `lib/dnd.ts`'s header says the board "keeps it in a
// ref and mirrors only the two fields it renders into React state, so a drag
// across 400 pixels re-renders on the two or three moves that change a column,
// not on all 400". Same rule: the `DndSession` stays in the page's ref, and only
// `MindDrag` — what is being carried, where it came from, what it is over, and
// why that node refuses it — lands here. `setMindDragOver` returns the identical
// state when nothing changed, so hundreds of pointer moves cost no renders.
//
// NOTHING HERE FETCHES OR WRITES. A drop is a mutation of real work and goes
// through `store/entries.patchEntry` — the same optimistic-write-plus-rollback
// path the board and the tree already use. This store records the INTENT; it
// must never grow a request, or there would be two write paths on one screen and
// only one of them would roll back.

import { create } from 'zustand'
import { DEFAULT_LENS, isMapLens, type MapLens } from '../lib/mindtree/lens'
import { isMindDimension, ROOT_ID, type MindDimension } from '../lib/mindtree/model'

/* ─────────────────────────────── the shapes ──────────────────────────────── */

/** The picture, or the table that carries the same numbers. */
export type MindtreeView = 'map' | 'table'

/**
 * How much room a node gets.
 *
 * Two values, not a slider. `compact` is what makes a nine-track workspace fit a
 * laptop without panning; `comfortable` is what keeps a 44 px touch target under
 * a thumb (WCAG 2.5.8, which `layout.ts`'s fit floor already refuses to go
 * below). A third value would be a preference nobody could describe.
 */
export type MindDensity = 'comfortable' | 'compact'

export function isMindtreeView(v: unknown): v is MindtreeView {
  return v === 'map' || v === 'table'
}

export function isMindDensity(v: unknown): v is MindDensity {
  return v === 'comfortable' || v === 'compact'
}

/**
 * A drag in flight, as the SCREEN renders it — never the gesture itself.
 *
 * See this file's header: `lib/dnd.DndSession` lives in the page's ref, and only
 * these four fields, which actually change what is drawn, reach React.
 */
export interface MindDrag {
  /**
   * The entries being moved, in the order they will be written.
   *
   * The surface decides membership with the board's rule — if the lifted node is
   * in the selection the whole selection travels, otherwise just the lifted one
   * — because that rule is about the gesture, not about the state.
   */
  readonly entryIds: readonly string[]
  /** The node the drag lifted from. A drop back onto it is not a move. */
  readonly fromNodeId: string
  /** The node under the pointer, or null. */
  readonly overNodeId: string | null
  /**
   * Why the node under the pointer refuses this drop — an i18n key from
   * `lib/mindtree/actions.ts`, or null when it accepts.
   *
   * CARRIED RATHER THAN RECOMPUTED AT DROP TIME. `dnd.zoneAt()` skips
   * non-accepting zones so the pointer glides over them, and its header says why:
   * "feedback the user cannot act on is worse than no feedback". A map cannot
   * skip a branch the same way — the branch is drawn where it is — so the
   * refusal is shown INSTEAD, on the node, while the finger is still down.
   */
  readonly refusalKey: string | null
}

/* ──────────────────────────────── the prefs ──────────────────────────────── */

/**
 * The one key. Already in the field on every device that has opened this screen
 * — see the header on why this module absorbs it rather than adding a second.
 */
const PREFS_KEY = 'nphiescore_mindtree_v1'

/**
 * How many node ids one dimension may remember, and how many dimensions.
 *
 * A CAP ON A PERSISTED ARRAY, because `localStorage` is user-writable and the
 * value is read synchronously on the module's first import — before a single
 * frame is painted. An unbounded array is a first-paint the reader watches; a
 * hand-edited or corrupted blob is a first-paint they never get. Both bounds are
 * far above any real use (a workspace would need 2 000 branches closed by hand),
 * so the truncation is unreachable in practice and total in principle.
 */
const MAX_IDS_PER_DIM = 2000
const MAX_DIMS = 16

/**
 * Node ids are paths, so this bounds a PATH — and the tree stopped being four
 * rings when the hierarchy landed beneath the tracks.
 *
 * `root/track:UHR/entity:OB/entity:Org1/group:blocked/entry:X` is a real id, and
 * 0023 caps the hierarchy at six levels below the track, so eleven segments is
 * the deepest the schema can produce — AND WAVE 6 ADDED `cohort:` SEGMENTS ON
 * TOP OF THOSE ELEVEN, up to 28 of them at ~62 characters each (the arithmetic
 * is written out at `lib/mindtree/focus.MAX_FOCUS_LEN`). THE SAME NUMBER AS
 * `lib/mindtree/focus.MAX_FOCUS_LEN`, deliberately and not by coincidence: that
 * constant bounds the id arriving from the URL and this one bounds the id
 * arriving from `localStorage`, and they are the same ids. A device that
 * remembers a deep branch as collapsed and then loads the map from a link would
 * otherwise disagree with itself about which ids exist — silently, because both
 * failure modes are a DROPPED preference and neither says anything. Move them
 * together.
 *
 * Still a cap rather than no cap: `localStorage` is user-writable and this value
 * is read synchronously before the first frame.
 */
const MAX_NODE_ID = 4096

export interface MindtreePrefs {
  dimension: MindDimension
  view: MindtreeView
  density: MindDensity
  /**
   * WHAT THE SHELL IS FOR — the chip that picks the stage and the panel subject
   * together (lib/mindtree/lens.ts).
   *
   * PERSISTED, and the asymmetry with the URL matters: a link carrying `?lens=`
   * wins, a link that says nothing leaves this alone, and DEFAULT_LENS applies
   * only to a device that has never chosen. That is what lets a reader who
   * prefers `shape` keep it while a pasted attention link still works.
   *
   * THE STAGE IS NOT PERSISTED BESIDE IT. `view` above already holds map⇄table
   * and MapToolbar's switch already writes it; a second `stage` field would be
   * two records of one idea, and they would disagree the first time either
   * writer ran alone. `lens.stageWithTable(lens, view === 'table')` derives it.
   */
  lens: MapLens
  /**
   * Is the dock showing? Persisted because closing it is a deliberate act — a
   * reader who wants the whole width for the picture should still have it
   * tomorrow — and re-opening is one tap on the lens chip either way.
   *
   * The DETENT is deliberately NOT persisted: `lens.phoneDetentFor` decides it
   * per subject, so a phone reader who taps the attention lens always gets the
   * full-height list the contract requires rather than whatever height they last
   * dragged the sheet to on some other lens.
   */
  panelOpen: boolean
  /**
   * The drill-in root, as a node id — which IS the path, because model.ts builds
   * ids as `root/track:<id>/group:<key>`. Persisting the id therefore persists
   * the whole path for free, and restoring it needs no second field.
   *
   * A PERSISTED FOCUS CAN GO STALE in a way a persisted collapse cannot: the
   * track it names may have been archived, or the filter narrowed until the node
   * is gone, and a drill-in root that is not in the tree draws NOTHING with no
   * control on screen able to un-blank it. `ensureMindFocus` is the handshake
   * that closes it and the surface must call it on every rebuild.
   */
  focus: string | null
  /** Branch ids the reader EXPLICITLY closed, keyed by dimension — the rings
   *  differ per axis. */
  collapsed: Record<string, string[]>
  /** Branch ids and "+N more" folds the reader EXPLICITLY opened, keyed the same
   *  way. Both sets exist because neither default is universal: a branch starts
   *  closed at `openDepth` and a fold always does. */
  opened: Record<string, string[]>
}

const DEFAULT_PREFS: MindtreePrefs = {
  dimension: 'status',
  view: 'map',
  density: 'comfortable',
  lens: DEFAULT_LENS,
  panelOpen: true,
  focus: null,
  collapsed: {},
  opened: {},
}

function storage(): Storage | null {
  // `typeof` on an undeclared identifier does not throw, which is what makes
  // this safe under vitest's `node` environment — where this module is imported
  // by its own test and there is no localStorage at all.
  if (typeof localStorage === 'undefined') return null
  return localStorage
}

function nodeIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const v of value) {
    if (typeof v !== 'string' || v.length === 0 || v.length > MAX_NODE_ID) continue
    out.push(v)
    if (out.length >= MAX_IDS_PER_DIM) break
  }
  return out
}

/**
 * The per-dimension records, validated.
 *
 * UNKNOWN DIMENSION KEYS ARE KEPT, not dropped, and that is a deliberate
 * asymmetry with `dimension` itself. A stale `dimension: 'assignee'` has to
 * degrade because it decides what is drawn RIGHT NOW; a stale `collapsed.assignee`
 * decides nothing until that axis exists, and deleting it would mean an older
 * build silently destroys a newer build's state every time the two share a
 * browser. Bounded rather than filtered.
 */
function idMap(value: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return out
  let dims = 0
  for (const [key, ids] of Object.entries(value as Record<string, unknown>)) {
    if (dims >= MAX_DIMS) break
    const list = nodeIdList(ids)
    if (list.length === 0) continue
    out[key] = list
    dims += 1
  }
  return out
}

/**
 * A persisted focus, or null.
 *
 * The prefix test is the only structural claim a node id makes that this module
 * can check without a tree: model.ts anchors every id at `ROOT_ID`. It rejects
 * the corrupted and the hostile; `ensureMindFocus` rejects the merely stale,
 * because only the tree knows that.
 */
function focusOf(value: unknown): string | null {
  if (typeof value !== 'string') return null
  if (value.length === 0 || value.length > MAX_NODE_ID) return null
  if (value !== ROOT_ID && !value.startsWith(`${ROOT_ID}/`)) return null
  return value
}

export function readMindtreePrefs(): MindtreePrefs {
  try {
    const store = storage()
    if (store === null) return DEFAULT_PREFS
    const raw = store.getItem(PREFS_KEY)
    if (raw === null) return DEFAULT_PREFS
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_PREFS
    const rec = parsed as Record<string, unknown>
    return {
      dimension: isMindDimension(rec.dimension) ? rec.dimension : DEFAULT_PREFS.dimension,
      view: isMindtreeView(rec.view) ? rec.view : DEFAULT_PREFS.view,
      // Absent on every device that persisted before this shipped, which is the
      // ordinary case rather than the exceptional one — a missing field takes
      // the default exactly as a malformed one does.
      density: isMindDensity(rec.density) ? rec.density : DEFAULT_PREFS.density,
      // Absent on every device that persisted before the lenses shipped, which
      // is the ordinary case: a missing field takes the default — and the
      // default is the attention lens, which is the screen those devices are
      // being redirected away from.
      lens: isMapLens(rec.lens) ? rec.lens : DEFAULT_PREFS.lens,
      panelOpen: typeof rec.panelOpen === 'boolean' ? rec.panelOpen : DEFAULT_PREFS.panelOpen,
      focus: focusOf(rec.focus),
      collapsed: idMap(rec.collapsed),
      opened: idMap(rec.opened),
    }
  } catch {
    // Private mode, a quota wall, or a half-written value. A map that throws on
    // mount because a preference is malformed is worse than a default map.
    return DEFAULT_PREFS
  }
}

function writePrefs(prefs: MindtreePrefs): void {
  try {
    storage()?.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Preferences are a convenience; losing them must never break the screen.
  }
}

/* ─────────────────────────────── the store ───────────────────────────────── */

const EMPTY_SET: ReadonlySet<string> = Object.freeze(new Set<string>()) as ReadonlySet<string>
const EMPTY_IDS: readonly string[] = Object.freeze([])

interface MindtreeState {
  /* persisted */
  dimension: MindDimension
  view: MindtreeView
  density: MindDensity
  lens: MapLens
  panelOpen: boolean
  focus: string | null
  collapsedByDim: Readonly<Record<string, string[]>>
  openedByDim: Readonly<Record<string, string[]>>

  /* derived from the two records above, for the ACTIVE dimension — see header */
  collapsedIds: ReadonlySet<string>
  expandedIds: ReadonlySet<string>

  /* session only */
  hoveredNodeId: string | null
  selection: ReadonlySet<string>
  drag: MindDrag | null
}

function setsFor(
  dimension: MindDimension,
  collapsedByDim: Readonly<Record<string, string[]>>,
  openedByDim: Readonly<Record<string, string[]>>,
): { collapsedIds: ReadonlySet<string>; expandedIds: ReadonlySet<string> } {
  const collapsed = collapsedByDim[dimension]
  const opened = openedByDim[dimension]
  return {
    // The shared frozen empty set rather than `new Set()`, so the common case —
    // a reader who has collapsed nothing on this axis — hands `buildMindtree`
    // the same reference every render and does not re-memo the whole tree.
    collapsedIds: collapsed === undefined || collapsed.length === 0 ? EMPTY_SET : new Set(collapsed),
    expandedIds: opened === undefined || opened.length === 0 ? EMPTY_SET : new Set(opened),
  }
}

function initialState(): MindtreeState {
  const prefs = readMindtreePrefs()
  return {
    dimension: prefs.dimension,
    view: prefs.view,
    density: prefs.density,
    lens: prefs.lens,
    panelOpen: prefs.panelOpen,
    focus: prefs.focus,
    collapsedByDim: prefs.collapsed,
    openedByDim: prefs.opened,
    ...setsFor(prefs.dimension, prefs.collapsed, prefs.opened),
    hoveredNodeId: null,
    selection: EMPTY_SET,
    drag: null,
  }
}

const useMindtreeStore = create<MindtreeState>(() => initialState())

/** Mirror the persisted half of the state back to disk. */
function persist(s: MindtreeState): void {
  writePrefs({
    dimension: s.dimension,
    view: s.view,
    density: s.density,
    lens: s.lens,
    panelOpen: s.panelOpen,
    focus: s.focus,
    collapsed: s.collapsedByDim,
    opened: s.openedByDim,
  })
}

/**
 * Apply a change to the persisted half, recompute the derived sets, and write.
 *
 * ONE FUNNEL, so "the sets always match the records" and "the disk always
 * matches the store" are properties of this module rather than of every caller
 * remembering two extra lines. Returning the same state when nothing moved keeps
 * a no-op setter (choosing the dimension that is already chosen) from writing to
 * localStorage on a synchronous path.
 */
function updatePrefs(patch: Partial<MindtreeState>): void {
  useMindtreeStore.setState((s) => {
    const next: MindtreeState = { ...s, ...patch }
    if (
      next.dimension === s.dimension &&
      next.view === s.view &&
      next.density === s.density &&
      next.lens === s.lens &&
      next.panelOpen === s.panelOpen &&
      next.focus === s.focus &&
      next.collapsedByDim === s.collapsedByDim &&
      next.openedByDim === s.openedByDim
    ) {
      return s
    }
    const derived = setsFor(next.dimension, next.collapsedByDim, next.openedByDim)
    const settled: MindtreeState = { ...next, ...derived }
    persist(settled)
    return settled
  })
}

/* ───────────────────────────── the preferences ───────────────────────────── */

export function setMindDimension(dimension: MindDimension): void {
  updatePrefs({ dimension })
}

export function setMindView(view: MindtreeView): void {
  updatePrefs({ view })
}

export function setMindDensity(density: MindDensity): void {
  updatePrefs({ density })
}

/**
 * Choose the lens — what the shell is FOR.
 *
 * IT DOES NOT TOUCH `view`. The stage is derived from the two
 * (`lens.stageWithTable`), so a reader who was reading the ledger and switches
 * to the board and back finds the ledger again. It does not touch the drill-in
 * either: `shape` and `needs-me` are two questions about the same branch, and
 * clearing the focus on a lens change would make the chips destructive.
 */
export function setMindLens(lens: MapLens): void {
  updatePrefs({ lens })
}

/** Show or hide the dock. Closing it gives the picture the whole width. */
export function setMindPanelOpen(panelOpen: boolean): void {
  updatePrefs({ panelOpen })
}

/**
 * Drill into a branch, or (with null) show the whole map again.
 *
 * The selection is NOT cleared. A reader ticks six items, drills into the person
 * who should take them, and applies — that is the redistribution gesture this
 * screen exists for, and clearing on focus would break it in the middle. The
 * bulk bar's own honesty rule is enforced separately, by `pruneMindSelection`.
 */
export function setMindFocus(nodeId: string | null): void {
  updatePrefs({ focus: nodeId === null ? null : focusOf(nodeId) })
}

/**
 * Drop a focus the tree no longer contains. THE HANDSHAKE — call it after every
 * rebuild, with a predicate over the tree that was just built.
 *
 * A drill-in root can vanish for four ordinary reasons: the track was archived,
 * the filter narrowed past it, the last item under it closed, or the reader
 * switched dimension so the group ids changed shape. In every one of them the
 * canvas would otherwise render nothing at all, with the breadcrumb pointing at
 * a node that is not there — the one failure a persisted preference must never
 * be able to cause. It is a separate call rather than a check inside a selector
 * because only the caller holds the tree, and a selector may not do work.
 */
export function ensureMindFocus(exists: (nodeId: string) => boolean): void {
  const { focus } = useMindtreeStore.getState()
  if (focus === null || exists(focus)) return
  updatePrefs({ focus: null })
}

/* ──────────────────────────── collapse and expand ────────────────────────── */

function withId(list: readonly string[] | undefined, id: string, present: boolean): string[] | null {
  const held = list ?? EMPTY_IDS
  const has = held.includes(id)
  if (has === present) return null
  if (present) return held.length >= MAX_IDS_PER_DIM ? [...held.slice(1), id] : [...held, id]
  return held.filter((v) => v !== id)
}

function setMembership(record: Readonly<Record<string, string[]>>, dimension: MindDimension, id: string, present: boolean): Readonly<Record<string, string[]>> | null {
  const next = withId(record[dimension], id, present)
  if (next === null) return null
  const out = { ...record }
  if (next.length === 0) delete out[dimension]
  else out[dimension] = next
  return out
}

/**
 * Close a branch, or open it.
 *
 * BOTH RECORDS MOVE, and that is the whole contract model.ts's `startsCollapsed`
 * depends on: an explicit close beats an explicit open beats the default. Closing
 * a branch has to REMOVE it from `opened`, or a reader who opened a branch that
 * `openDepth` would have closed can never close it again — the two sets would
 * disagree and the older one would win forever.
 */
export function setMindCollapsed(nodeId: string, collapsed: boolean): void {
  const s = useMindtreeStore.getState()
  const collapsedByDim = setMembership(s.collapsedByDim, s.dimension, nodeId, collapsed)
  const openedByDim = setMembership(s.openedByDim, s.dimension, nodeId, !collapsed)
  if (collapsedByDim === null && openedByDim === null) return
  updatePrefs({
    collapsedByDim: collapsedByDim ?? s.collapsedByDim,
    openedByDim: openedByDim ?? s.openedByDim,
  })
}

export function toggleMindCollapsed(nodeId: string): void {
  const s = useMindtreeStore.getState()
  setMindCollapsed(nodeId, !s.collapsedIds.has(nodeId))
}

/**
 * Open a "+N more" fold.
 *
 * Distinct from `setMindCollapsed(id, false)` because a fold has no closed
 * record to clear: it is closed BY DEFAULT, always, so the only thing to record
 * is that the reader opened this one.
 */
export function expandMindNode(nodeId: string): void {
  const s = useMindtreeStore.getState()
  const openedByDim = setMembership(s.openedByDim, s.dimension, nodeId, true)
  if (openedByDim === null) return
  updatePrefs({ openedByDim })
}

/**
 * Close every branch named, in one write.
 *
 * The caller passes the ids because only it has walked the tree — and passing
 * them keeps this module free of the tree, which is what lets it be tested with
 * plain strings.
 */
export function collapseMindAll(nodeIds: readonly string[]): void {
  const s = useMindtreeStore.getState()
  const held = new Set(s.collapsedByDim[s.dimension] ?? EMPTY_IDS)
  for (const id of nodeIds) held.add(id)
  const list = [...held].slice(0, MAX_IDS_PER_DIM)
  updatePrefs({
    collapsedByDim: { ...s.collapsedByDim, [s.dimension]: list },
    // Everything the reader had explicitly opened on this axis is now
    // explicitly closed; leaving the stale opens behind would make the next
    // single toggle read the wrong default.
    openedByDim: dropDim(s.openedByDim, s.dimension),
  })
}

/** Open every branch on this axis — both records clear for this dimension. */
export function expandMindAll(nodeIds: readonly string[]): void {
  const s = useMindtreeStore.getState()
  const list = [...new Set(nodeIds)].slice(0, MAX_IDS_PER_DIM)
  updatePrefs({
    collapsedByDim: dropDim(s.collapsedByDim, s.dimension),
    openedByDim: list.length === 0 ? dropDim(s.openedByDim, s.dimension) : { ...s.openedByDim, [s.dimension]: list },
  })
}

function dropDim(record: Readonly<Record<string, string[]>>, dimension: MindDimension): Readonly<Record<string, string[]>> {
  if (record[dimension] === undefined) return record
  const out = { ...record }
  delete out[dimension]
  return out
}

/* ───────────────────────────────── hover ─────────────────────────────────── */

export function setMindHovered(nodeId: string | null): void {
  useMindtreeStore.setState((s) => (s.hoveredNodeId === nodeId ? s : { hoveredNodeId: nodeId }))
}

/* ─────────────────────────────── selection ───────────────────────────────── */

export function toggleMindSelected(entryId: string): void {
  useMindtreeStore.setState((s) => {
    const next = new Set(s.selection)
    if (!next.delete(entryId)) next.add(entryId)
    return { selection: next.size === 0 ? EMPTY_SET : next }
  })
}

export function setMindSelection(entryIds: readonly string[]): void {
  useMindtreeStore.setState((s) => {
    if (entryIds.length === 0) return s.selection === EMPTY_SET ? s : { selection: EMPTY_SET }
    return { selection: new Set(entryIds) }
  })
}

export function clearMindSelection(): void {
  useMindtreeStore.setState((s) => (s.selection === EMPTY_SET ? s : { selection: EMPTY_SET }))
}

/**
 * Drop everything the reader cannot currently see.
 *
 * THE BULK BAR MUST NOT LIE. `pages/tracks/TracksIndex.tsx` states the rule
 * first — "a bulk bar reading '18 selected' while six of them are behind a fold
 * is a lie" — and a map has three more ways to hide a row than a list does:
 * collapsing a branch, drilling into a different one, and tightening a filter.
 * Called on every rebuild with the entry ids the tree actually rendered.
 *
 * Same-reference when nothing was pruned, so the ordinary rebuild — where
 * everything ticked is still on screen — costs no render anywhere.
 */
export function pruneMindSelection(visibleEntryIds: ReadonlySet<string>): void {
  useMindtreeStore.setState((s) => {
    if (s.selection.size === 0) return s
    let dropped = false
    const next = new Set<string>()
    for (const id of s.selection) {
      if (visibleEntryIds.has(id)) next.add(id)
      else dropped = true
    }
    if (!dropped) return s
    return { selection: next.size === 0 ? EMPTY_SET : next }
  })
}

/* ───────────────────────────────── the drag ──────────────────────────────── */

/**
 * A gesture has committed and is carrying work.
 *
 * Called on `dnd.moveDrag`'s transition to `phase: 'dragging'` — NOT on the
 * press. An armed gesture is still a tap, and publishing it here would light
 * every drop target on the map under a finger that is about to lift.
 */
export function beginMindDrag(drag: MindDrag): void {
  useMindtreeStore.setState({ drag })
}

/**
 * The pointer moved over a node — or off every node.
 *
 * SAME REFERENCE WHEN NOTHING CHANGED, which is the whole reason this is a
 * function rather than a `setState` at the call site: `lib/dnd.moveDrag` is
 * called on every pointermove and answers on all of them, and a map has hundreds
 * of them between two nodes.
 */
export function setMindDragOver(overNodeId: string | null, refusalKey: string | null): void {
  useMindtreeStore.setState((s) => {
    const drag = s.drag
    if (drag === null) return s
    if (drag.overNodeId === overNodeId && drag.refusalKey === refusalKey) return s
    return { drag: { ...drag, overNodeId, refusalKey } }
  })
}

/**
 * The gesture ended — dropped, cancelled, or abandoned.
 *
 * IT DOES NOT WRITE ANYTHING. The caller reads the descriptor, performs the
 * patch through `store/entries`, and calls this; clearing here and writing there
 * keeps the rollback path identical to the board's, where the store owns the
 * optimistic row and this module owns nothing durable at all.
 */
export function endMindDrag(): void {
  useMindtreeStore.setState((s) => (s.drag === null ? s : { drag: null }))
}

/* ──────────────────────────────── selectors ──────────────────────────────── */

export function useMindDimension(): MindDimension {
  return useMindtreeStore((s) => s.dimension)
}

export function useMindView(): MindtreeView {
  return useMindtreeStore((s) => s.view)
}

export function useMindDensity(): MindDensity {
  return useMindtreeStore((s) => s.density)
}

export function useMindLens(): MapLens {
  return useMindtreeStore((s) => s.lens)
}

export function useMindPanelOpen(): boolean {
  return useMindtreeStore((s) => s.panelOpen)
}

export function useMindFocus(): string | null {
  return useMindtreeStore((s) => s.focus)
}

export function useMindCollapsedIds(): ReadonlySet<string> {
  return useMindtreeStore((s) => s.collapsedIds)
}

export function useMindExpandedIds(): ReadonlySet<string> {
  return useMindtreeStore((s) => s.expandedIds)
}

/** One boolean per node — the selector a rendered node subscribes with. */
export function useMindIsHovered(nodeId: string): boolean {
  return useMindtreeStore((s) => s.hoveredNodeId === nodeId)
}

export function useMindHoveredId(): string | null {
  return useMindtreeStore((s) => s.hoveredNodeId)
}

/**
 * NARROW ON PURPOSE — one Set lookup per node, so ticking entry A re-renders A's
 * checkbox and nothing else. store/nudges.ts's `useLocalAsk` gives the same
 * reasoning: a selector returning the whole collection re-renders every mounted
 * node on every change, which on this screen is the entire workspace.
 */
export function useMindIsSelected(entryId: string): boolean {
  return useMindtreeStore((s) => s.selection.has(entryId))
}

/** The bulk bar's count. A number, so the bar does not re-render on a reorder. */
export function useMindSelectionCount(): number {
  return useMindtreeStore((s) => s.selection.size)
}

/** The whole set — for the bulk bar's own act, not for a node. */
export function useMindSelection(): ReadonlySet<string> {
  return useMindtreeStore((s) => s.selection)
}

export function useMindDrag(): MindDrag | null {
  return useMindtreeStore((s) => s.drag)
}

export function useMindIsDragging(): boolean {
  return useMindtreeStore((s) => s.drag !== null)
}

/** Is this node the current drop target? One boolean, per node. */
export function useMindIsDragOver(nodeId: string): boolean {
  return useMindtreeStore((s) => s.drag !== null && s.drag.overNodeId === nodeId)
}

/* ───────────────────────────── non-React reads ───────────────────────────── */

/**
 * The whole state, outside React.
 *
 * vitest runs `environment: 'node'`, so a hook is a value no test in this repo
 * can observe — and the persistence and pruning rules above are the behaviour
 * most worth pinning. The keyboard layer needs it for the same reason
 * `store/entrySheet.getOpenEntryId` exists: a global hotkey handler lives outside
 * the component tree.
 */
export function getMindtreeState(): Readonly<MindtreeState> {
  return useMindtreeStore.getState()
}

/* ──────────────────────────────── sign-out ───────────────────────────────── */

/**
 * Drop everything this session knew.
 *
 * IT NAMES REAL WORK. The selection is a list of entry ids and the focus is a
 * track — both are another account's business the moment the session ends, and
 * `store/entries.resetEntries` is cleared on sign-out for exactly that reason.
 *
 * THE PREFERENCES GO TOO, and that is the deliberate part: `focus` addresses a
 * specific track's node, and restoring it under the NEXT account would drill a
 * different person into a branch they did not choose. Re-reading the key would
 * restore the same values, so this resets to the module's DEFAULTS and writes
 * them, which is the only version of "cleared" that survives a reload.
 *
 * `store/signOutReset.test.ts` asserts that every `reset*` under `src/store` is
 * actually called from Shell's teardown in `src/App.tsx` — a reset that exists
 * and is never called is the bug that test was written to catch (R3-SEC-2). The
 * call is added in the same change as this function.
 */
export function resetMindtree(): void {
  writePrefs(DEFAULT_PREFS)
  useMindtreeStore.setState({
    dimension: DEFAULT_PREFS.dimension,
    view: DEFAULT_PREFS.view,
    density: DEFAULT_PREFS.density,
    lens: DEFAULT_PREFS.lens,
    panelOpen: DEFAULT_PREFS.panelOpen,
    focus: DEFAULT_PREFS.focus,
    collapsedByDim: {},
    openedByDim: {},
    collapsedIds: EMPTY_SET,
    expandedIds: EMPTY_SET,
    hoveredNodeId: null,
    selection: EMPTY_SET,
    drag: null,
  })
}
