// Settings › Structure (/settings/structure) — the tree beneath every track.
//
// WHAT THIS SCREEN IS FOR, in one sentence: this is where `UHR > OB > Org1,
// Org2` gets built. Migration 0023 gives the workspace `map_nodes` — a
// self-referencing tree hanging under each track, capped at six levels — and
// this is the only place a person can create, name, re-parent, reorder, staff or
// put away one of them. Everything else in the app READS that decision: the
// map's rings (`lib/mindtree/model.ts`'s recursive `structuralNode`), the branch
// panel, `entries.node_id`, and the filter's `mapNodeIds` dimension. Nothing
// else writes it.
//
// AN INDENTED LIST, NOT A CANVAS, and that is a decision rather than a fallback.
// A drag-and-drop tree on a canvas is unreachable by keyboard, unusable
// one-handed on the 375px phone this app is primarily read on, and untestable
// under `renderToStaticMarkup` — which is the only kind of render test this
// repo has (vitest runs `environment: 'node'`, there is no jsdom). The reorder
// and re-parent controls that already work — up/down buttons and a `<select>` —
// come straight from `GroupsAdmin.tsx`, one level up the same tree.
//
// INDENTATION IS `padding-inline-start`, BOUND TO A CUSTOM PROPERTY. The row
// sets `--depth` inline and structure.css multiplies it; `padding-left` would
// unindent the entire tree in Arabic, where the reading start is on the right.
// That is the one rule in this file that cannot be relaxed for any reason.
//
// A CROSS-TRACK MOVE SHOWS ITS COUNTS BEFORE THE CLICK, NOT AFTER. `moveMapNode`
// reports what it moved, and reporting it afterwards is reporting a thing that
// has already happened — the argument api/tracks.ts:350-357 makes about the
// deliberately-missing `deleteGroup`. So "Move under…" is a DISCLOSURE, not a
// live `<select>`: opening it counts the subtree through `getMapNodeUsage`,
// names how many items and how much work would change track, and only then
// offers the button. See `openMove` for the one hazard in that plan.
//
// THE DEPTH CAP IS REFUSED HERE, WITH A REASON. 0023's deferred constraint
// trigger raises `map_node_depth` at level 7 and `pgErrorKey` renders it as
// `mapadmin.errTooDeep` — correct, but arriving after the person has typed a
// name and pressed Add. "Add child" is therefore disabled at level 6 with the
// sentence next to it, and a parent that would push the branch past six is not
// offered by "Move under…" at all.
//
// READS THROUGH api/ DIRECTLY, not through store/config, for the reason
// TracksAdmin.tsx and GroupsAdmin.tsx both give: this screen must list ARCHIVED
// rows (they are restored from here and nowhere else) and must show its own
// writes on the next paint. `store/config.ts` deliberately drops archived nodes
// AND the children of archived parents, which is right for the map and would
// make this screen the one place a put-away branch is invisible. Every mutation
// still calls `invalidateConfig()` so the rest of the app re-reads.
//
// WHAT THIS SCREEN DOES NOT DO. There is no Delete. 0023's guard refuses to
// delete a node while anything at all still points at it, so a Delete button
// would be a control that fails for every node worth deleting; Archive is the
// reversible operation an admin actually wants, and `deleteMapNode` stays for
// the row typed by mistake this morning, from the SQL editor. There is also no
// description field: 0023 carries `description`/`description_ar` and nothing in
// the app renders them yet, so offering two textareas would be asking for prose
// no reader will ever see.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from 'react'
import { Link, Navigate } from 'react-router-dom'
import { IconArrowStart, IconChevronEnd, IconLayers } from '../../components/icons'
import { EmptyState, Skeleton } from '../../components/shared'
import { confirm } from '../../components/Confirm'
import { toast } from '../../components/toast'
import {
  createMapNode,
  getMapNodeUsage,
  listMapNodeKinds,
  listMapNodes,
  moveMapNode,
  reorderMapNodes,
  setMapNodeArchived,
  updateMapNode,
} from '../../api/map'
import { listTracks } from '../../api/tracks'
import { t, useLocale, type Locale } from '../../lib/i18n'
import { useTrackLabel } from '../../lib/labels'
import { trackIcon } from '../../lib/trackIcons'
import { trackVars } from '../../lib/trackStyle'
import { invalidateConfig } from '../../store/config'
import { useMembers } from '../../store/members'
import { useAuth } from '../../store/auth'
import type { MapNode, MapNodeKind, Track } from '../../types'
import './structure.css'

/**
 * Cosmetic admin gate. The real authority is `is_admin()` in 0023's `map_nodes`
 * RLS policies — every write on this screen fails with 42501 for a member
 * whatever this returns; hiding the screen only avoids offering an action that
 * cannot succeed.
 *
 * THE SEVENTH COPY OF THIS HOOK (TracksAdmin, TrackEditor, VocabularyAdmin,
 * Members, Terminology, GroupsAdmin). Copied rather than shared for the reason
 * GroupsAdmin records: the one place it could live is `store/auth.ts`, since
 * `src/lib/**` may not import a store, and that file is not this worker's to
 * edit. The seven are byte-identical today and a copy is exactly the thing that
 * drifts — flagged in the handoff again, now with a seventh caller behind it.
 *
 * `?shell` mirrors App.tsx's dev-only preview flag, so this screen stays
 * reachable in a build with no Supabase project — which is where the layout and
 * the RTL mirror get reviewed. `import.meta.env.DEV` is the literal `false` in a
 * production build, so Vite tree-shakes the whole expression out and this cannot
 * become a way in.
 */
function useIsAdmin(): boolean {
  const { profile } = useAuth()
  if (profile?.role === 'admin') return true
  return import.meta.env.DEV && new URLSearchParams(window.location.search).has('shell')
}

/**
 * The deepest a node may sit below its track — `v_max_depth` in 0023's
 * `map_nodes_check_tree()`, mirrored here and not owned here.
 *
 * IT IS 1-BASED, LIKE THE TRIGGER. A node hanging directly off a track is at
 * level 1, and the trigger's message says "would sit at level %". Keeping the
 * same numbering means the sentence this screen refuses with and the sentence
 * the database refuses with describe the same thing, which matters the first
 * time somebody compares them.
 *
 * The value is duplicated rather than derived because there is nothing to derive
 * it from: the cap lives in a plpgsql constant. `structure.depthCap` states the
 * number in prose for the same reason `mapadmin.errTooDeep` does — a `{max}`
 * token in front of a counted noun is the one arrangement the locale gate
 * refuses, since it cannot inflect.
 */
export const MAX_LEVEL = 6

/** `map_nodes_name_len_chk` — 1..60 on the trimmed name. Mirrored, not owned. */
const NAME_MAX = 60

/**
 * A node's name in the given locale — `lib/labels.trackLabel`'s rule, one level
 * down, including its fallback: `name_ar` is `not null default ''`, so the test
 * is for EMPTY rather than null and an untranslated node shows its English name
 * instead of a blank row.
 *
 * LOCAL, AND IT SHOULD NOT STAY THAT WAY. This belongs beside `trackLabel` in
 * `src/lib/labels.ts` — that file's whole subject is localised display names for
 * database rows — and it is the same twelve-line consolidation GroupsAdmin's
 * `groupLabelIn` is already waiting on. Duplicated here because labels.ts is not
 * this worker's file. Carried in the handoff.
 */
export function nodeLabelIn(node: Pick<MapNode, 'name' | 'name_ar'>, locale: Locale): string {
  if (locale === 'ar') return node.name_ar.trim() || node.name
  return node.name
}

/** The same rule for a kind. Same consolidation, same handoff. */
function kindLabelIn(kind: Pick<MapNodeKind, 'name' | 'name_ar'>, locale: Locale): string {
  if (locale === 'ar') return kind.name_ar.trim() || kind.name
  return kind.name
}

/* ───────────────────────────── the tree, purely ──────────────────────────── */
//
// Everything below this line is a pure function of the rows the screen loaded.
// They are exported and unit-tested rather than proved through the markup,
// because the two rules that matter — "a node may not move under itself or
// anything beneath it" and "no branch may be pushed past six levels" — are the
// two the DATABASE also enforces, and a UI that offers an illegal option is a UI
// that turns a considered refusal into a raw Postgres error.

/** One row of the flattened tree, with everything the row needs to draw itself. */
export interface TreeRow {
  node: MapNode
  /** 1-based, matching 0023's trigger: a node hanging off a track is level 1. */
  level: number
  /** Position among its siblings, 0-based — what up/down move. */
  index: number
  /** How many siblings it has, so the last row can disable Down. */
  siblingCount: number
  /** The node above it, or null when its parent is the track. */
  parent: MapNode | null
}

/** Sibling buckets, built once from a flat list of rows. */
export interface TreeIndex {
  byId: Map<string, MapNode>
  /** parent id → its children, in display order. */
  childrenByParent: Map<string, MapNode[]>
  /** track id → its level-1 nodes, in display order. */
  rootsByTrack: Map<string, MapNode[]>
}

/**
 * Display order within one sibling set: `sort_order`, then name.
 *
 * The tie break is `listMapNodes`' own second sort key and exists for its
 * reason: `sort_order` defaults to 0 and `reorder_map_nodes` only rewrites the
 * ids it was handed, so without a total order two loads of the same data render
 * differently — which reads as data loss rather than as a sort. Compared with
 * `<`/`>` rather than `localeCompare` deliberately: this order has to be stable
 * across the language toggle, and an ICU collation would reshuffle the tree the
 * moment somebody switched to Arabic.
 */
function byDisplayOrder(a: MapNode, b: MapNode): number {
  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
  if (a.name !== b.name) return a.name < b.name ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Bucket a flat list of nodes into sibling sets.
 *
 * ARCHIVED NODES ARE KEPT, AND SO ARE THE CHILDREN OF ARCHIVED PARENTS. That is
 * the one place this differs from `store/config.ts`'s `deriveMap`, which drops
 * both — correctly, because the map cannot draw a phase that is put away and
 * five organizations that are not. Here the opposite is true: a subtree that
 * vanished from the only screen that can restore or re-file it is a subtree
 * nobody can reach.
 *
 * A node whose `parent_id` names a row this screen did not load falls back to
 * its track's root bucket rather than disappearing — the third case
 * `GroupsAdmin`'s bucketing note is about, and the reason it is worth repeating
 * is that it is the case where a row is invisible in every list at once.
 */
export function buildIndex(nodes: MapNode[]): TreeIndex {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const childrenByParent = new Map<string, MapNode[]>()
  const rootsByTrack = new Map<string, MapNode[]>()

  for (const node of nodes) {
    const parent = node.parent_id !== null ? byId.get(node.parent_id) : undefined
    if (node.parent_id !== null && parent !== undefined) {
      const list = childrenByParent.get(node.parent_id)
      if (list) list.push(node)
      else childrenByParent.set(node.parent_id, [node])
      continue
    }
    const roots = rootsByTrack.get(node.track_id)
    if (roots) roots.push(node)
    else rootsByTrack.set(node.track_id, [node])
  }

  for (const list of childrenByParent.values()) list.sort(byDisplayOrder)
  for (const list of rootsByTrack.values()) list.sort(byDisplayOrder)
  return { byId, childrenByParent, rootsByTrack }
}

/**
 * One track's tree, depth-first, in display order.
 *
 * THE `seen` SET IS NOT DEFENSIVE PROGRAMMING FOR ITS OWN SAKE. 0023 forbids
 * cycles with a deferred constraint trigger, so a loop cannot be committed —
 * but this function also runs against rows held optimistically in component
 * state between a write and its reply, and an unguarded depth-first walk over a
 * cycle does not render a wrong tree, it hangs the tab. A bounded walk that
 * renders a slightly wrong tree is recoverable; a frozen renderer is not.
 */
export function flattenTrack(index: TreeIndex, trackId: string): TreeRow[] {
  const out: TreeRow[] = []
  const seen = new Set<string>()

  const walk = (siblings: MapNode[], level: number, parent: MapNode | null): void => {
    if (level > MAX_LEVEL + 1) return
    siblings.forEach((node, i) => {
      if (seen.has(node.id)) return
      seen.add(node.id)
      out.push({ node, level, index: i, siblingCount: siblings.length, parent })
      walk(index.childrenByParent.get(node.id) ?? [], level + 1, node)
    })
  }

  walk(index.rootsByTrack.get(trackId) ?? [], 1, null)
  return out
}

/**
 * Every node beneath `id`, not including `id` itself.
 *
 * This is the set "Move under…" subtracts, and it is the whole cycle rule: a
 * node put under one of its own descendants makes an ancestry that loops, which
 * 0023 raises `map_node_cycle` for. Computing it client-side is what turns that
 * refusal into an option that was never offered.
 */
export function descendantIds(index: TreeIndex, id: string): Set<string> {
  const out = new Set<string>()
  const stack = [id]
  while (stack.length > 0) {
    const current = stack.pop() as string
    for (const child of index.childrenByParent.get(current) ?? []) {
      if (out.has(child.id)) continue
      out.add(child.id)
      stack.push(child.id)
    }
  }
  return out
}

/**
 * How many levels the subtree rooted at `id` occupies — 1 for a leaf.
 *
 * The number "Move under…" needs, because the cap applies to the DEEPEST row of
 * the branch and not to the row being dragged: a two-level branch moved under a
 * level-5 parent lands its leaves at level 7, and 0023 refuses the whole
 * transaction. `level(parent) + height(subtree) <= MAX_LEVEL` is the exact test.
 */
export function subtreeHeight(index: TreeIndex, id: string): number {
  let height = 1
  const stack: { id: string; depth: number }[] = [{ id, depth: 1 }]
  const seen = new Set<string>([id])
  while (stack.length > 0) {
    const current = stack.pop() as { id: string; depth: number }
    if (current.depth > height) height = current.depth
    if (current.depth > MAX_LEVEL) continue
    for (const child of index.childrenByParent.get(current.id) ?? []) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      stack.push({ id: child.id, depth: current.depth + 1 })
    }
  }
  return height
}

/** One destination "Move under…" is willing to offer. */
export interface ParentChoice {
  /** The `<option>` value, `${trackId}:${parentId ?? ''}`. */
  value: string
  trackId: string
  /** Null means "directly under the track", which is level 1. */
  parentId: string | null
  /** The level the moved node would land at. */
  level: number
}

/** The `<option>` value for a destination. Parsed back by `parseParentChoice`. */
export function parentChoiceValue(trackId: string, parentId: string | null): string {
  return `${trackId}:${parentId ?? ''}`
}

/** The inverse. Returns null for a value this screen did not write. */
export function parseParentChoice(value: string): { trackId: string; parentId: string | null } | null {
  const at = value.indexOf(':')
  if (at <= 0) return null
  const trackId = value.slice(0, at)
  const parentId = value.slice(at + 1)
  return { trackId, parentId: parentId === '' ? null : parentId }
}

/**
 * Every place `nodeId` may legally go, across every track, in display order.
 *
 * THREE EXCLUSIONS, ALL CLIENT-SIDE, ALL MIRRORING A DATABASE REFUSAL:
 *
 *   the node itself      — `map_node_cycle`
 *   its descendants      — `map_node_cycle`
 *   anything that would  — `map_node_depth`
 *   push it past level 6
 *
 * Nothing here mirrors `map_node_cross_track`: a cross-track destination is
 * LEGAL and is exactly the move that needs describing beforehand, which is the
 * counts panel's job rather than this function's. `move_map_node` rewrites the
 * whole subtree's `track_id` in one statement, so the invariant holds across the
 * move and not merely at each end of it.
 *
 * Archived nodes ARE offered as parents. Filing a branch under a put-away phase
 * is a legal and occasionally deliberate act — it is how a whole programme is
 * mothballed — and the row says it is archived, so the choice is informed rather
 * than hidden.
 */
export function legalParents(index: TreeIndex, tracks: Track[], nodeId: string): ParentChoice[] {
  const blocked = descendantIds(index, nodeId)
  blocked.add(nodeId)
  const height = subtreeHeight(index, nodeId)

  const out: ParentChoice[] = []
  for (const track of tracks) {
    // Level 1 puts the branch's own root at 1 and its deepest row at `height`.
    // Unreachable today — nothing can be taller than the cap it already fits
    // inside — but written as the same inequality as the loop below so the two
    // cannot drift apart if the cap ever moves.
    if (height <= MAX_LEVEL) {
      out.push({
        value: parentChoiceValue(track.id, null),
        trackId: track.id,
        parentId: null,
        level: 1,
      })
    }
    for (const row of flattenTrack(index, track.id)) {
      if (blocked.has(row.node.id)) continue
      if (row.level + height > MAX_LEVEL) continue
      out.push({
        value: parentChoiceValue(track.id, row.node.id),
        trackId: track.id,
        parentId: row.node.id,
        level: row.level + 1,
      })
    }
  }
  return out
}

/** Is anything above this node archived? Decides the "still hidden" note. */
export function hasArchivedAncestor(index: TreeIndex, node: MapNode): boolean {
  let current = node.parent_id
  const seen = new Set<string>([node.id])
  while (current !== null && !seen.has(current)) {
    seen.add(current)
    const parent = index.byId.get(current)
    if (parent === undefined) return false
    if (parent.archived) return true
    current = parent.parent_id
  }
  return false
}

/** Move `index` by `delta`, returning a new array. Out-of-range is a no-op. */
function moved<T>(rows: T[], index: number, delta: number): T[] {
  const target = index + delta
  if (target < 0 || target >= rows.length) return rows
  const next = rows.slice()
  const [row] = next.splice(index, 1)
  next.splice(target, 0, row)
  return next
}

/* ──────────────────────────────── the forms ─────────────────────────────── */

/** The edit disclosure's draft. Never written until Save. */
interface EditForm {
  name: string
  nameAr: string
  kindId: string
  vendor: string
}

function editFormOf(node: MapNode): EditForm {
  return {
    name: node.name,
    nameAr: node.name_ar,
    // '' is the <select>'s spelling of "no kind"; `kind_id` is legally null and
    // clearing it is a real instruction, which updateMapNode distinguishes from
    // "leave it alone" by `!== undefined`.
    kindId: node.kind_id ?? '',
    vendor: node.vendor,
  }
}

function editDirty(a: EditForm, b: EditForm): boolean {
  return a.name !== b.name || a.nameAr !== b.nameAr || a.kindId !== b.kindId || a.vendor !== b.vendor
}

/** The add disclosure's draft. Deliberately three fields, not seven. */
interface AddForm {
  name: string
  nameAr: string
  kindId: string
}

const EMPTY_ADD: AddForm = { name: '', nameAr: '', kindId: '' }

/** What a move would touch, counted before the move is offered. */
interface MoveUsage {
  /** Rows in `map_nodes` — the subtree, including the node itself. */
  nodes: number
  /** Rows in `entries` filed anywhere in that subtree. */
  entries: number
}

/* ─────────────────────────────── the screen ─────────────────────────────── */

export default function StructureAdmin(): ReactElement {
  const locale = useLocale()
  const isAdmin = useIsAdmin()
  const trackLabel = useTrackLabel()
  const members = useMembers()
  // Memoised on locale so passing it into a callback does not invalidate one on
  // every render — useTrackLabel's own reasoning.
  const nodeLabel = useCallback((node: MapNode) => nodeLabelIn(node, locale), [locale])

  const [tracks, setTracks] = useState<Track[] | null>(null)
  const [nodes, setNodes] = useState<MapNode[]>([])
  const [kinds, setKinds] = useState<MapNodeKind[]>([])
  const [errorKey, setErrorKey] = useState<string | null>(null)

  /** The node whose edit disclosure is open, and the draft it is editing. */
  const [editing, setEditing] = useState<{ id: string; form: EditForm } | null>(null)
  const [savedForm, setSavedForm] = useState<EditForm | null>(null)
  /** Where a new node is being typed: a parent id, or null for a track root. */
  const [adding, setAdding] = useState<{ trackId: string; parentId: string | null } | null>(null)
  const [addForm, setAddForm] = useState<AddForm>(EMPTY_ADD)
  /** The node whose "Move under…" panel is open, with its chosen destination. */
  const [movingNode, setMovingNode] = useState<{ id: string; target: string } | null>(null)
  /** null while counting, 'failed' when the counts could not be read. */
  const [moveUsage, setMoveUsage] = useState<MoveUsage | 'failed' | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  /** The node whose account manager is being written, so its select goes quiet. */
  const [staffingId, setStaffingId] = useState<string | null>(null)
  const [liveMessage, setLiveMessage] = useState('')

  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const load = useCallback(async () => {
    setErrorKey(null)
    // Three reads in parallel: none depends on another, and the screen is
    // unusable without the first two.
    const [trackResult, nodeResult, kindResult] = await Promise.all([
      listTracks(true),
      listMapNodes(true),
      listMapNodeKinds(),
    ])
    if (!alive.current) return
    if (!trackResult.ok) {
      setErrorKey(trackResult.error)
      setTracks([])
      return
    }
    setTracks(trackResult.data)
    if (!nodeResult.ok) {
      setErrorKey(nodeResult.error)
      return
    }
    setNodes(nodeResult.data)
    // A failed KIND read is not a failed screen. The kinds are a chip and a
    // picker; the tree is the point, and refusing to draw it because the
    // vocabulary above it did not load would be the wrong trade.
    if (kindResult.ok) setKinds(kindResult.data)
  }, [])

  useEffect(() => {
    if (isAdmin) void load()
  }, [isAdmin, load])

  const index = useMemo(() => buildIndex(nodes), [nodes])

  /**
   * The cards, in order: every active track, then any archived track that still
   * has something filed under it.
   *
   * The second half is `GroupsAdmin`'s "not in a group" section wearing a
   * different hat, and it exists for exactly its reason. Nine of this
   * workspace's ten tracks are archived; a branch left under one of them is
   * drawn by nothing, counted by nothing, and — without this — listed by
   * nothing either. An archived track with an empty tree is left out, because
   * there is nothing to rescue and a card per retired track is noise.
   */
  const cards = useMemo(() => {
    const all = tracks ?? []
    const active = all.filter((track) => !track.archived)
    const stranded = all.filter(
      (track) => track.archived && (index.rootsByTrack.get(track.id)?.length ?? 0) > 0,
    )
    return { active, stranded }
  }, [tracks, index])

  // ---- reorder ------------------------------------------------------------

  const moveButtons = useRef(new Map<string, HTMLButtonElement>())
  /** Which move button to focus after the next paint, as `${id}:up|down`. */
  const focusAfterMove = useRef<string | null>(null)
  /**
   * Reorder writes are fire-and-forget and a person moving a row twice clicks
   * twice in under a second, so a stale reply must not report a failure the
   * newer write already fixed. Same guard as TracksAdmin and GroupsAdmin.
   */
  const orderSeq = useRef(0)

  useEffect(() => {
    const key = focusAfterMove.current
    if (!key) return
    focusAfterMove.current = null
    moveButtons.current.get(key)?.focus()
  })

  const persistOrder = useCallback(
    async (trackId: string, parentId: string | null, ids: string[]) => {
      const seq = ++orderSeq.current
      const result = await reorderMapNodes(trackId, parentId, ids)
      if (!alive.current || seq !== orderSeq.current) return
      if (!result.ok) {
        toast(t(result.error), { tone: 'error' })
        // Re-read rather than restore a captured snapshot: after two rapid moves
        // the snapshot is itself stale, and the server order is the only
        // description of the list that is certainly true.
        void load()
        return
      }
      invalidateConfig()
      // The move itself is visible; what the toast adds is that it PERSISTED.
      // Without it a rejected write and an accepted one look identical.
      toast(t('structure.reordered'))
    },
    [load],
  )

  function reorderSibling(row: TreeRow, delta: number): void {
    const siblings =
      row.parent === null
        ? (index.rootsByTrack.get(row.node.track_id) ?? [])
        : (index.childrenByParent.get(row.parent.id) ?? [])
    const next = moved(siblings, row.index, delta)
    if (next === siblings) return

    const landed = row.index + delta
    // Focus moving with the row says WHICH row is still selected but not where
    // it landed — order is the one thing this control edits and the one thing
    // focus cannot convey. The live region announces the position.
    setLiveMessage(
      t('structure.movedTo', {
        name: nodeLabel(row.node),
        position: landed + 1,
        total: next.length,
      }),
    )
    const pressed = delta < 0 ? 'up' : 'down'
    const stillEnabled = delta < 0 ? landed > 0 : landed < next.length - 1
    const twin = pressed === 'up' ? 'down' : 'up'
    focusAfterMove.current = `${row.node.id}:${stillEnabled ? pressed : twin}`

    // Renumber LOCALLY rather than swapping array positions. `buildIndex` sorts
    // each bucket by `sort_order`, so the optimistic tree is only correct if the
    // optimistic rows carry the order the RPC is about to write — which is the
    // 1-based index of the new arrangement, exactly what `reorder_map_nodes`
    // stores.
    const renumbered = new Map(next.map((node, i) => [node.id, i + 1]))
    setNodes((current) =>
      current.map((node) => {
        const order = renumbered.get(node.id)
        return order === undefined ? node : { ...node, sort_order: order }
      }),
    )
    void persistOrder(
      row.node.track_id,
      row.parent === null ? null : row.parent.id,
      next.map((node) => node.id),
    )
  }

  // ---- account manager ----------------------------------------------------

  async function setManager(node: MapNode, memberId: string): Promise<void> {
    const from = node.account_manager_id
    const to = memberId === '' ? null : memberId
    if (to === from) return
    // Optimistic: the select is the whole interaction, and a control that waits
    // for a round trip before showing the value the user picked reads as broken.
    setNodes((current) =>
      current.map((row) => (row.id === node.id ? { ...row, account_manager_id: to } : row)),
    )
    setStaffingId(node.id)
    const result = await updateMapNode(node.id, { accountManagerId: to })
    if (!alive.current) return
    setStaffingId(null)
    if (!result.ok) {
      // Put the row back rather than re-reading: the previous value is known
      // exactly, and a re-read would also discard any OTHER row edited while
      // this request was in flight.
      setNodes((current) =>
        current.map((row) => (row.id === node.id ? { ...row, account_manager_id: from } : row)),
      )
      toast(t(result.error), { tone: 'error' })
      return
    }
    setNodes((current) => current.map((row) => (row.id === node.id ? result.data : row)))
    invalidateConfig()
    const member = members.find((m) => m.id === to)
    const message =
      to === null || member === undefined
        ? t('structure.managerCleared', { name: nodeLabel(node) })
        : t('structure.managerSet', { owner: member.displayName, name: nodeLabel(node) })
    // Announced AND toasted: on a phone the row that changed may have scrolled
    // out from under the thumb that changed it.
    setLiveMessage(message)
    toast(message)
  }

  // ---- edit ---------------------------------------------------------------

  const setEditField = useCallback((key: keyof EditForm, value: string): void => {
    setEditing((current) =>
      current ? { ...current, form: { ...current.form, [key]: value } } : current,
    )
  }, [])

  function openEdit(node: MapNode): void {
    const form = editFormOf(node)
    setEditing({ id: node.id, form })
    setSavedForm(form)
  }

  function closeEdit(): void {
    setEditing(null)
    setSavedForm(null)
  }

  async function saveEdit(node: MapNode): Promise<void> {
    if (!editing || editing.id !== node.id) return
    const name = editing.form.name.trim()
    if (name === '' || name.length > NAME_MAX) {
      toast(t('structure.nameRequired'), { tone: 'error' })
      return
    }
    setBusyId(node.id)
    const result = await updateMapNode(node.id, {
      name,
      nameAr: editing.form.nameAr.trim(),
      kindId: editing.form.kindId === '' ? null : editing.form.kindId,
      vendor: editing.form.vendor.trim(),
    })
    if (!alive.current) return
    setBusyId(null)
    if (!result.ok) {
      // result.error is an i18n KEY from pgErrorKey — `mapadmin.errNameTaken`,
      // not a constraint identifier. t() returns an unknown key verbatim, so
      // even the one path that still yields a sentence renders.
      toast(t(result.error), { tone: 'error' })
      return
    }
    setNodes((current) => current.map((row) => (row.id === node.id ? result.data : row)))
    closeEdit()
    invalidateConfig()
    toast(t('structure.saved', { name: nodeLabel(result.data) }))
  }

  // ---- add ----------------------------------------------------------------

  function openAdd(trackId: string, parentId: string | null): void {
    setAdding({ trackId, parentId })
    setAddForm(EMPTY_ADD)
  }

  async function submitAdd(): Promise<void> {
    if (!adding) return
    const name = addForm.name.trim()
    if (name === '' || name.length > NAME_MAX) {
      toast(t('structure.nameRequired'), { tone: 'error' })
      return
    }
    setBusyId(adding.parentId ?? adding.trackId)
    const result = await createMapNode({
      parentId: adding.parentId,
      // The track is sent even with a parent, on purpose: 0023 derives it and
      // `map_node_cross_track` rejects a value that disagrees, so sending it
      // makes this screen's belief checkable rather than assumed. api/map.ts's
      // `createMapNode` header is the long version.
      trackId: adding.trackId,
      name,
      nameAr: addForm.nameAr.trim(),
      description: '',
      descriptionAr: '',
      kindId: addForm.kindId === '' ? null : addForm.kindId,
      accountManagerId: null,
      vendor: '',
    })
    if (!alive.current) return
    setBusyId(null)
    if (!result.ok) {
      toast(t(result.error), { tone: 'error' })
      return
    }
    setNodes((current) => [...current, result.data])
    setAdding(null)
    setAddForm(EMPTY_ADD)
    invalidateConfig()
    const message = t('structure.created', { name: nodeLabel(result.data) })
    setLiveMessage(message)
    toast(message)
  }

  // ---- move ---------------------------------------------------------------

  /** Mirror of `movingNode.id`, readable from an async reply one render early. */
  const movingRef = useRef<string | null>(null)

  /**
   * Open "Move under…" and count what the move would touch.
   *
   * THE COUNT IS THE POINT, AND IT HAS TO ARRIVE FIRST. `moveMapNode` reports
   * how many nodes and entries it moved, but a destructive-shaped action that
   * explains itself afterwards has already happened — api/tracks.ts:350-357
   * argues exactly this about the `deleteGroup` that does not exist. So the
   * subtree is enumerated client-side (the rows are already loaded) and every
   * node in it is asked for its usage before the button is offered.
   *
   * ⚠ ONE HAZARD, AND IT IS NOT THIS FILE'S TO FIX. `getMapNodeUsage` degrades a
   * FAILED count to 0 — api/map.ts's `countReferencing` catches the error,
   * console.warns and returns 0 — so a request that fails and a node with no
   * work look identical from here. The 'failed' branch below is therefore only
   * reachable when Supabase is not configured at all. Carried in the handoff:
   * the fix is for `countReferencing` to propagate, since a confirmation that
   * quietly says "0 items of work" when it does not know is the exact failure
   * this panel exists to prevent.
   *
   * Depth-first over the loaded rows rather than a recursive server query: the
   * tree is capped at six levels and is already in memory, so a round trip per
   * level would be slower AND would disagree with the rows on screen.
   */
  async function openMove(node: MapNode): Promise<void> {
    const current = parentChoiceValue(node.track_id, node.parent_id)
    movingRef.current = node.id
    setMovingNode({ id: node.id, target: current })
    setMoveUsage(null)

    const ids = [node.id, ...descendantIds(index, node.id)]
    const results = await Promise.all(ids.map((id) => getMapNodeUsage(id)))
    if (!alive.current || movingRef.current !== node.id) return
    if (results.some((r) => !r.ok)) {
      setMoveUsage('failed')
      return
    }
    let entries = 0
    for (const result of results) if (result.ok) entries += result.data.entries
    setMoveUsage({ nodes: ids.length, entries })
  }

  function closeMove(): void {
    movingRef.current = null
    setMovingNode(null)
    setMoveUsage(null)
  }

  async function submitMove(node: MapNode): Promise<void> {
    if (!movingNode || movingNode.id !== node.id) return
    const choice = parseParentChoice(movingNode.target)
    if (choice === null) return
    if (choice.parentId === node.parent_id && choice.trackId === node.track_id) return

    setBusyId(node.id)
    // `trackId` only for a move to level 1, where there is no parent to derive
    // it from. With a parent, null lets the database derive it — asserting a
    // track that disagrees is what `map_node_cross_track` exists to reject.
    const result = await moveMapNode(
      node.id,
      choice.parentId,
      choice.parentId === null ? choice.trackId : null,
    )
    if (!alive.current) return
    setBusyId(null)
    if (!result.ok) {
      toast(t(result.error), { tone: 'error' })
      return
    }
    closeMove()
    // The move rewrote every descendant's track_id in one statement; nothing
    // client-side can reproduce that faithfully, so this is the one action on
    // the screen that re-reads instead of patching state.
    await load()
    invalidateConfig()
    const destination =
      choice.parentId === null
        ? t('structure.moveRoot', { track: trackNameOf(choice.trackId) })
        : (nodeName(choice.parentId) ?? t('structure.kindNone'))
    const message = t('structure.moved', { name: nodeLabel(node), target: destination })
    setLiveMessage(
      result.data.entries > 0
        ? `${message}. ${t('structure.movedWork', { count: result.data.entries })}`
        : message,
    )
    toast(message)
    // A second toast rather than a longer first one: the number of items that
    // changed track is the consequence, and it is worth its own line even
    // though the panel already said it would happen.
    if (result.data.entries > 0) {
      toast(t('structure.movedWork', { count: result.data.entries }))
    }
  }

  // ---- archive ------------------------------------------------------------

  async function toggleArchived(node: MapNode): Promise<void> {
    if (!node.archived) {
      const ok = await confirm({
        title: t('structure.archiveTitle', { name: nodeLabel(node) }),
        body: t('structure.archiveBody'),
        confirmLabel: t('structure.archiveConfirm'),
        cancelLabel: t('structure.cancel'),
        danger: true,
      })
      if (!ok || !alive.current) return
    }
    setBusyId(node.id)
    const result = await setMapNodeArchived(node.id, !node.archived)
    if (!alive.current) return
    setBusyId(null)
    if (!result.ok) {
      toast(t(result.error), { tone: 'error' })
      return
    }
    setNodes((current) => current.map((row) => (row.id === node.id ? result.data : row)))
    invalidateConfig()
    const name = nodeLabel(result.data)
    // Restoring a node whose parent is still archived puts it back in this list
    // and nowhere else — store/config.ts drops the children of an archived
    // parent, so the map still will not draw it. Saying so is the difference
    // between a restore that looks broken and one that is half-finished.
    const message = result.data.archived
      ? t('structure.archivedToast', { name })
      : hasArchivedAncestor(index, result.data)
        ? t('structure.restoredHidden', { name })
        : t('structure.restoredToast', { name })
    setLiveMessage(message)
    toast(message)
  }

  // ---- naming helpers -----------------------------------------------------

  function trackNameOf(trackId: string): string {
    const track = (tracks ?? []).find((row) => row.id === trackId)
    return track ? trackLabel(track) : trackId
  }

  function nodeName(id: string): string | null {
    const node = index.byId.get(id)
    return node ? nodeLabel(node) : null
  }

  if (!isAdmin) return <Navigate to="/settings" replace />

  const loading = tracks === null

  // ---- one row ------------------------------------------------------------

  const renderRow = (row: TreeRow): ReactElement => {
    const { node, level } = row
    const label = nodeLabel(node)
    // Always the OTHER language, never a repeat of the primary line: in Arabic,
    // nodeLabel() already returns name_ar, so keying this to name_ar
    // unconditionally would print the same name twice.
    const altLang = locale === 'ar' ? 'en' : 'ar'
    const alt = (locale === 'ar' ? node.name : node.name_ar).trim()
    const secondary = alt && alt !== label ? alt : ''
    const kind = kinds.find((k) => k.id === node.kind_id)
    const editOpen = editing?.id === node.id
    const addOpen = adding !== null && adding.parentId === node.id
    const moveOpen = movingNode?.id === node.id
    const busy = busyId === node.id
    const atCap = level >= MAX_LEVEL

    return (
      <li
        key={node.id}
        className={`str-row${level > 1 ? ' str-row-nested' : ''}${
          node.archived ? ' str-row-archived' : ''
        }`}
        // THE ONE RULE THAT CANNOT BE RELAXED. structure.css multiplies this by
        // 1.25rem into `padding-inline-start`; a physical `padding-left` here or
        // there would unindent the whole tree in Arabic.
        style={{ '--depth': level - 1 } as CSSProperties}
      >
        <div className="str-line">
          <div className="str-names">
            <p className="str-name">{label}</p>
            {/* The other language always shows beneath the current one: an admin
                naming forty organizations needs both halves of the pair at once,
                and `lang` gives the Arabic line an Arabic face while the UI is
                English. */}
            {secondary && (
              <p className="str-alt" lang={altLang} dir={altLang === 'ar' ? 'rtl' : 'ltr'}>
                {secondary}
              </p>
            )}
            {/* A flat list cannot convey nesting to a screen reader, and the
                indentation is purely visual. This says out loud what the padding
                says visually — the row's parent, which is the fact a reader
                actually needs and the one an `aria-level` on a plain <li> would
                not give them. */}
            <span className="sr-only">
              {row.parent === null
                ? t('structure.moveRoot', { track: trackNameOf(node.track_id) })
                : t('structure.underParent', { target: nodeLabel(row.parent) })}
            </span>
          </div>

          <div className="str-marks">
            <span className="pill str-kind">
              {kind ? kindLabelIn(kind, locale) : t('structure.kindNone')}
            </span>
            {node.vendor.trim() !== '' && <span className="pill str-vendor">{node.vendor}</span>}
            {node.archived && <span className="pill warn">{t('structure.archived')}</span>}
          </div>

          {/* The select carries its own accessible name rather than a visible
              label: one label per row, repeated forty times, is forty copies of
              the same word down the page — and the row already says which node
              this is. */}
          <select
            className="select str-manager"
            aria-label={t('structure.managerLabel', { name: label })}
            value={node.account_manager_id ?? ''}
            disabled={staffingId === node.id}
            onChange={(e) => void setManager(node, e.target.value)}
          >
            {/* NOT disabled, unlike GroupsAdmin's placeholder: clearing the
                account manager is a real instruction here — `account_manager_id`
                is nullable and "nobody is named on this yet" is the ordinary
                state of a node the day it is created. */}
            <option value="">{t('structure.managerNone')}</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.displayName}
              </option>
            ))}
          </select>

          <div className="row-actions str-actions">
            <button
              type="button"
              className="btn btn-sm btn-icon str-move"
              aria-label={t('structure.moveUp', { name: label })}
              disabled={row.index === 0}
              ref={(el) => {
                if (el) moveButtons.current.set(`${node.id}:up`, el)
                else moveButtons.current.delete(`${node.id}:up`)
              }}
              onClick={() => reorderSibling(row, -1)}
            >
              {/* A chevron rotated in CSS rather than a new glyph. Up and down
                  are axis-neutral, so this deliberately does NOT get
                  icon-directional — mirroring it would point it sideways in
                  Arabic. */}
              <IconChevronEnd className="str-move-icon str-move-up" size={16} />
            </button>
            <button
              type="button"
              className="btn btn-sm btn-icon str-move"
              aria-label={t('structure.moveDown', { name: label })}
              disabled={row.index === row.siblingCount - 1}
              ref={(el) => {
                if (el) moveButtons.current.set(`${node.id}:down`, el)
                else moveButtons.current.delete(`${node.id}:down`)
              }}
              onClick={() => reorderSibling(row, 1)}
            >
              <IconChevronEnd className="str-move-icon str-move-down" size={16} />
            </button>
            <button
              type="button"
              className="btn btn-sm"
              aria-expanded={moveOpen}
              onClick={() => {
                if (moveOpen) closeMove()
                else void openMove(node)
              }}
            >
              {t(moveOpen ? 'structure.moveClose' : 'structure.moveUnder')}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              aria-expanded={addOpen}
              // Refused HERE, with a reason, rather than left to 0023's trigger:
              // the database is right to raise `map_node_depth`, but it raises
              // it after a name has been typed and Add has been pressed.
              disabled={atCap}
              onClick={() => (addOpen ? setAdding(null) : openAdd(node.track_id, node.id))}
            >
              {t(addOpen ? 'structure.addClose' : 'structure.addChild')}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              aria-expanded={editOpen}
              onClick={() => (editOpen ? closeEdit() : openEdit(node))}
            >
              {t(editOpen ? 'structure.editDone' : 'structure.edit')}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy}
              aria-label={t(node.archived ? 'structure.restoreLabel' : 'structure.archiveLabel', {
                name: label,
              })}
              onClick={() => void toggleArchived(node)}
            >
              {t(node.archived ? 'structure.restore' : 'structure.archive')}
            </button>
          </div>
        </div>

        {atCap && <p className="str-hint str-cap">{t('structure.depthCap')}</p>}
        {node.archived && <p className="str-hint">{t('structure.archivedHint')}</p>}

        {editOpen && editing && (
          <div className="str-panel">
            <div className="str-fields">
              <div className="field">
                <label className="field-label" htmlFor={`str-name-${node.id}`}>
                  {t('structure.nameEn')}
                </label>
                <input
                  id={`str-name-${node.id}`}
                  className="input"
                  lang="en"
                  dir="ltr"
                  maxLength={NAME_MAX}
                  value={editing.form.name}
                  onChange={(e) => setEditField('name', e.target.value)}
                />
              </div>
              <div className="field">
                <label className="field-label" htmlFor={`str-name-ar-${node.id}`}>
                  {t('structure.nameAr')}
                </label>
                {/* lang + dir on the field itself: an Arabic name typed into an
                    LTR box has its punctuation resolved against the wrong
                    paragraph direction WHILE it is being typed, which is the one
                    place the user sees the bug and not the cause. */}
                <input
                  id={`str-name-ar-${node.id}`}
                  className="input"
                  lang="ar"
                  dir="rtl"
                  maxLength={NAME_MAX}
                  value={editing.form.nameAr}
                  onChange={(e) => setEditField('nameAr', e.target.value)}
                />
              </div>
              <div className="field">
                <label className="field-label" htmlFor={`str-kind-${node.id}`}>
                  {t('structure.kind')}
                </label>
                <select
                  id={`str-kind-${node.id}`}
                  className="select"
                  value={editing.form.kindId}
                  onChange={(e) => setEditField('kindId', e.target.value)}
                >
                  <option value="">{t('structure.kindNone')}</option>
                  {kinds.map((k) => (
                    <option key={k.id} value={k.id}>
                      {kindLabelIn(k, locale)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="field-label" htmlFor={`str-vendor-${node.id}`}>
                  {t('structure.vendor')}
                </label>
                <input
                  id={`str-vendor-${node.id}`}
                  className="input"
                  value={editing.form.vendor}
                  onChange={(e) => setEditField('vendor', e.target.value)}
                />
              </div>
            </div>
            <p className="str-hint">{t('structure.nameArHint')}</p>
            <p className="str-hint">{t('structure.vendorHint')}</p>
            <div className="row-actions">
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={busy || editing.form.name.trim() === ''}
                onClick={() => void saveEdit(node)}
              >
                {t('structure.save')}
              </button>
              <button type="button" className="btn btn-sm" disabled={busy} onClick={closeEdit}>
                {t('structure.discard')}
              </button>
              {/* The badge is what makes Discard legible: "Discard" with nothing
                  changed is a control with no referent. */}
              {savedForm !== null && editDirty(editing.form, savedForm) && (
                <span className="pill warn">{t('structure.unsaved')}</span>
              )}
            </div>
          </div>
        )}

        {moveOpen && movingNode && renderMovePanel(node)}
        {addOpen && renderAddPanel(label)}
      </li>
    )
  }

  // ---- the move panel -----------------------------------------------------

  const renderMovePanel = (node: MapNode): ReactElement => {
    const choices = legalParents(index, tracks ?? [], node.id)
    const current = parentChoiceValue(node.track_id, node.parent_id)
    const currentLabel =
      node.parent_id === null
        ? t('structure.moveRoot', { track: trackNameOf(node.track_id) })
        : (nodeName(node.parent_id) ?? t('structure.kindNone'))
    const target = movingNode?.target ?? current
    const chosen = parseParentChoice(target)
    const crossTrack = chosen !== null && chosen.trackId !== node.track_id
    const unchanged =
      chosen === null || (chosen.parentId === node.parent_id && chosen.trackId === node.track_id)
    // Narrowed once, so the three sentences below read the counts rather than
    // re-testing the union. `null` is "still counting", `'failed'` is "could not
    // be counted"; only an object means the panel may describe the move.
    const usage: MoveUsage | null = moveUsage === null || moveUsage === 'failed' ? null : moveUsage

    return (
      <div className="str-panel">
        {choices.length === 0 ? (
          <p className="str-hint">{t('structure.moveNowhere')}</p>
        ) : (
          <>
            <div className="field">
              <label className="field-label" htmlFor={`str-move-${node.id}`}>
                {t('structure.moveTargetLabel', { name: nodeLabel(node) })}
              </label>
              <select
                id={`str-move-${node.id}`}
                className="select"
                value={target}
                onChange={(e) =>
                  setMovingNode((currentMove) =>
                    currentMove ? { ...currentMove, target: e.target.value } : currentMove,
                  )
                }
              >
                {/* The current position is offered as the selected value even
                    when it is not a legal DESTINATION, so the control opens
                    saying where the node is now rather than proposing a move
                    nobody asked for. Move stays disabled until it changes. */}
                {!choices.some((c) => c.value === current) && (
                  <option value={current}>{currentLabel}</option>
                )}
                {(tracks ?? []).map((track) => {
                  const forTrack = choices.filter((c) => c.trackId === track.id)
                  if (forTrack.length === 0) return null
                  return (
                    <optgroup key={track.id} label={trackLabel(track)}>
                      {forTrack.map((choice) => (
                        <option key={choice.value} value={choice.value}>
                          {choice.parentId === null
                            ? t('structure.moveRoot', { track: trackLabel(track) })
                            : (nodeName(choice.parentId) ?? choice.parentId)}
                        </option>
                      ))}
                    </optgroup>
                  )
                })}
              </select>
            </div>

            {/* THE COUNTS, BEFORE THE CLICK. Polite and atomic: the panel
                rewrites the whole paragraph when the destination changes, and a
                reader must hear the new sentence rather than the two words that
                differ from the old one. */}
            <div className="str-counts" role="status" aria-live="polite" aria-atomic="true">
              {moveUsage === null && <p className="str-hint">{t('structure.moveCounting')}</p>}
              {moveUsage === 'failed' && (
                <p className="str-hint str-warn">{t('structure.moveCountFailed')}</p>
              )}
              {usage !== null && (
                <>
                  <p className="str-hint">
                    {t('structure.moveCountNodes', { count: usage.nodes })}
                  </p>
                  <p className="str-hint">
                    {usage.entries === 0
                      ? t('structure.moveNoEntries')
                      : t('structure.moveCountEntries', { count: usage.entries })}
                  </p>
                  <p className={crossTrack ? 'str-hint str-warn' : 'str-hint'}>
                    {crossTrack && chosen !== null
                      ? t('structure.moveCrossTrack', {
                          from: trackNameOf(node.track_id),
                          to: trackNameOf(chosen.trackId),
                        })
                      : t('structure.moveSameTrack', { track: trackNameOf(node.track_id) })}
                  </p>
                </>
              )}
            </div>

            <div className="row-actions">
              <button
                type="button"
                className="btn btn-sm btn-primary"
                // Never offered before the counts land. A cross-track move whose
                // consequences could not be read is refused outright rather than
                // offered with an apology beside it.
                disabled={busyId === node.id || unchanged || usage === null}
                onClick={() => void submitMove(node)}
              >
                {t('structure.moveConfirm')}
              </button>
              <button type="button" className="btn btn-sm" onClick={closeMove}>
                {t('structure.moveClose')}
              </button>
            </div>
          </>
        )}
      </div>
    )
  }

  // ---- the add panel ------------------------------------------------------

  const renderAddPanel = (targetName: string): ReactElement => (
    <div className="str-panel">
      <p className="str-panel-title">{t('structure.addUnder', { target: targetName })}</p>
      <div className="str-fields">
        <div className="field">
          <label className="field-label" htmlFor="str-add-name">
            {t('structure.nameEn')}
          </label>
          <input
            id="str-add-name"
            className="input"
            lang="en"
            dir="ltr"
            maxLength={NAME_MAX}
            value={addForm.name}
            onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="str-add-name-ar">
            {t('structure.nameAr')}
          </label>
          <input
            id="str-add-name-ar"
            className="input"
            lang="ar"
            dir="rtl"
            maxLength={NAME_MAX}
            value={addForm.nameAr}
            onChange={(e) => setAddForm((f) => ({ ...f, nameAr: e.target.value }))}
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="str-add-kind">
            {t('structure.kind')}
          </label>
          <select
            id="str-add-kind"
            className="select"
            value={addForm.kindId}
            onChange={(e) => setAddForm((f) => ({ ...f, kindId: e.target.value }))}
          >
            <option value="">{t('structure.kindNone')}</option>
            {kinds.map((k) => (
              <option key={k.id} value={k.id}>
                {kindLabelIn(k, locale)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="str-hint">{t('structure.nameArHint')}</p>
      <div className="row-actions">
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={addForm.name.trim() === ''}
          onClick={() => void submitAdd()}
        >
          {t('structure.add')}
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setAdding(null)}>
          {t('structure.addClose')}
        </button>
      </div>
    </div>
  )

  // ---- one track card -----------------------------------------------------

  const renderTrackCard = (track: Track): ReactElement => {
    const Icon = trackIcon(track.icon)
    const rows = flattenTrack(index, track.id)
    const addOpen = adding !== null && adding.trackId === track.id && adding.parentId === null

    return (
      <li key={track.id} className="card str-track">
        <div className="str-track-head">
          <div className="track-bar str-track-text" style={trackVars(track.color, track.color_light)}>
            <p className="str-track-name">
              <span className="track-glyph str-track-mark" aria-hidden="true">
                <Icon size={16} />
              </span>
              {trackLabel(track)}
            </p>
            <p className="str-track-meta">
              <span className="pill tabular">{t('structure.nodeCount', { count: rows.length })}</span>
              {track.archived && <span className="pill warn">{t('structure.trackArchived')}</span>}
            </p>
          </div>
          <div className="row-actions">
            <button
              type="button"
              className="btn btn-sm"
              aria-expanded={addOpen}
              onClick={() => (addOpen ? setAdding(null) : openAdd(track.id, null))}
            >
              {t(addOpen ? 'structure.addClose' : 'structure.addRoot')}
            </button>
          </div>
        </div>

        {track.archived && <p className="str-hint str-warn">{t('structure.trackArchivedHint')}</p>}
        {addOpen && renderAddPanel(trackLabel(track))}

        {rows.length === 0 ? (
          <p className="str-hint">{t('structure.emptyTrack')}</p>
        ) : (
          <ul className="str-tree" aria-label={t('structure.treeLabel', { track: trackLabel(track) })}>
            {rows.map(renderRow)}
          </ul>
        )}
      </li>
    )
  }

  return (
    <div className="str">
      <div className="str-bar">
        <Link to="/settings" className="btn btn-ghost btn-sm">
          {/* icon-directional: a back arrow points at the reading start, so it
              mirrors in Arabic. */}
          <IconArrowStart className="icon-directional" size={16} />
          {t('common.back')}
        </Link>
      </div>

      {/* No page heading: App.tsx's header already renders this route's title as
          the document h1, and a second copy is noise in the heading outline. */}
      <p className="str-intro">{t('structure.subtitle')}</p>

      {/* Polite, not assertive: every message here follows an action the user
          just took deliberately, so it should queue behind whatever is being
          read rather than interrupt it. */}
      <p className="sr-only" role="status" aria-live="polite">
        {liveMessage}
      </p>

      {loading && <Skeleton height={180} count={2} />}

      {!loading && errorKey && (
        <div className="card str-error" role="alert">
          {/* pgErrorKey's catch-all says less than this screen's own headline
              does; anything more specific — a 42501, or the PGRST205 that means
              0023 has not been applied to this project — is worth showing. */}
          <p>{t(errorKey === 'common.error' ? 'structure.loadFailed' : errorKey)}</p>
          <button type="button" className="btn btn-sm" onClick={() => void load()}>
            {t('common.retry')}
          </button>
        </div>
      )}

      {!loading && !errorKey && cards.active.length === 0 && cards.stranded.length === 0 && (
        <EmptyState
          icon={<IconLayers size={30} />}
          title={t('structure.empty')}
          description={t('structure.emptyHint')}
        />
      )}

      {!loading && !errorKey && cards.active.length > 0 && (
        <ul className="str-tracks">{cards.active.map(renderTrackCard)}</ul>
      )}

      {!loading && !errorKey && cards.stranded.length > 0 && (
        <ul className="str-tracks str-stranded">{cards.stranded.map(renderTrackCard)}</ul>
      )}
    </div>
  )
}
