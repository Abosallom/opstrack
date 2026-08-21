// THE BRANCH PANEL — one branch's open work, and that track's history.
//
// TWO SCREENS COLLAPSE INTO THIS SURFACE. `/tracks` (the distribution tree) and
// `/tracks/:id` (the track timeline) are both answers about ONE BRANCH, and the
// map already knows which branch the reader is looking at. So the tree's
// delegation cockpit becomes this panel's WORK band and the timeline becomes its
// HISTORY band (MapBranchHistory.tsx — split out for size alone; see its header).
//
// THE GAIN, and it is the largest in the whole collapse: `/tracks/:id` had NO
// LINK FROM ANYWHERE. Reaching it cost Cmd+K, typing the track name and Enter —
// and Cmd+K does not exist on a phone. Here it is one tap on the node.
//
// THE RISK, and it is the largest in the whole collapse: `/tracks` is where a
// whole track's open work gets handed to one person in THREE CLICKS — one tick
// on the section heading, two in the bulk Assign select (+1 confirm at ten rows
// or more). A panel with no multi-select turns a three-click hand-off of thirty
// items into sixty clicks. Every part of that machinery is reproduced here: the
// tri-state heading checkbox, the ADDITIVE Shift-range, the row's own owner
// <select>, the 25-row fold, the Unassigned-only chip, pooled writes six at a
// time, one summary toast, and failed rows left selected so retry is one click.
//
// ── THE TWO NUMBER SOURCES, AND WHY THEY MUST STAY APART ───────────────────
//
// The band under the trail reads the LIVE store and is labelled "As it stands
// today" (`track.now`). Everything in the history band reads the DATE WINDOW the
// reader chose. Merging them into one source is the obvious simplification and
// it produces a header that silently changes meaning the moment somebody drags a
// date — which is the whole reason `/tracks/:id` carried that label. They stay
// separate, and the band NAMES the scope it counts so the label cannot be read
// against the wrong thing.
//
// THE BAND IS SCOPED TO THE TRACK, NOT TO THE RING-2 GROUP. "As it stands today"
// is a question about a track, independent of the filter and of the dates. A
// ring-2 bucket is a slice of the CURRENT filtered view, and its number is
// already on screen twice — on the node's chip and on the section heading — both
// following the filter, as they should. A third number, scoped to a bucket and
// following neither, is the confusion this paragraph exists to prevent.
//
// ── SELECTION IS THIS PANEL'S OWN, AND THAT IS NOT A SECOND STORE ──────────
//
// `store/mindtree` holds a selection too, and it is a DIFFERENT CONCEPT: what
// the canvas has drawn and what a drag would carry. `useMapCursor` prunes it to
// `drawnEntryIdSet` — the entry nodes the LAYOUT emitted — on every rebuild, and
// the canvas draws ring 1 at `OPEN_DEPTH = 1`, so almost none of this panel's
// rows are ever in that set. Routing the bulk bar through the store would have
// the map empty the selection one commit after every tick, silently. Two
// concepts, two pieces of state, and this one is local.
//
// THE FOLD STATE IS NOT LOCAL, for the mirror-image reason. A section here IS a
// branch of the map, so its open/closed state is `store/mindtree`'s — read off
// the node `buildMindtree` already computed, written with `toggleMindCollapsed`.
// A second record would disagree with the picture beside it within a day.
// `nphiescore_tree_v1` (the deleted `/tracks` screen's own fold record) is NOT
// read, NOT written and NOT cleared.
//
// SELECTION IS PRUNED TO WHAT IS VISIBLE, and the two folds are coupled to it:
// `flatIds` is what the reader can SEE, the pruning effect drops anything not in
// it, and therefore ticking a section heading has to open BOTH the collapsed
// branch AND the 25-row fold, or the selection empties itself one tick later
// with no feedback at all.
//
// THE UNASSIGNED CHIP DOES NOT WRITE `FilterState.owner`. `/tracks` withheld the
// owner facet so its toggle could own that field; the shell OFFERS that facet to
// four other panel subjects and this unit cannot take it away. So the chip
// filters the rows it renders instead — one predicate, no field to fight over,
// and an inherited `?owner=` can no longer be smuggled past a control that
// claims to own it. `?unassigned=1` stays the pasteable link either way.
//
// ROW MACHINERY IS THE KIT'S, and `show={{ owner: false }}` is deliberate: the
// <select> IS the owner display. A badge beside a control that changes the same
// fact is two controls telling one thing, and the read-only-looking one is the
// one people tap.

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react'
import { useSearchParams } from 'react-router-dom'
import MapBranchHistory from './MapBranchHistory'
import MapBranchDetail, { MapBranchGoals } from './MapBranchDetail'
import Breadcrumb from '../mindtree/Breadcrumb'
import { EntryRow, TrackDot, type EntryRowShow } from '../entry'
import { IconChevronDown } from '../fields/glyphs'
import { IconLayers } from '../icons'
import { EmptyState } from '../shared'
import { confirm } from '../Confirm'
import { toast } from '../toast'
import { EMPTY_FILTER, isFilterEmpty, type FilterState } from '../../lib/entryFilter'
import { entityIdOf } from '../../lib/mapNodes'
import { t, useLocale } from '../../lib/i18n'
import { useTrackLabel } from '../../lib/labels'
import type { MindDimension, MindLabel, MindNode } from '../../lib/mindtree/model'
import { canEditEntry } from '../../lib/permissions'
import { pooled } from '../../lib/pooled'
import { useAuth } from '../../store/auth'
import { useActiveTracks } from '../../store/config'
import {
  loadEntries,
  patchEntry,
  refreshEntries,
  useEntriesTruncated,
  useEntryCounts,
  useEntryFlash,
  useFilteredEntries,
  useHealthMap,
  usePendingOp,
} from '../../store/entries'
import { openEntry } from '../../store/entrySheet'
import { useMemberMap, useMembers } from '../../store/members'
import { toggleMindCollapsed } from '../../store/mindtree'
import { useVocab } from '../../store/vocab'
import type { Member } from '../../api/members'
import type { ApiResult } from '../../api/result'
import type { Entry, EntryHealth, EntryPatch, EntryPriority, UserRole } from '../../types'
import './map-branch.css'

/* ══════════════════════════ constants ══════════════════════════ */

/** The owner select's value for "nobody". Never a real uuid. */
const OWNER_NONE = ''

/**
 * The owner select's value for a free-text owner — a vendor, a contractor.
 *
 * A synthetic key with a leading space, so it cannot collide with a uuid. It is
 * a SOURCE value only: the option exists so a row owned by "Acme Support" shows
 * that name instead of a blank control, and selecting it is impossible (a
 * <select> fires no change for the value it already holds). Typing a new
 * external name is the entry sheet's OwnerPicker; a panel row has nowhere to
 * type.
 */
const OWNER_NAME = ' name'

/** store/entries.ts's private QUEUED_KEY. Not a failure: the outbox replays it. */
const QUEUED_ERROR_KEY = 'offline.queued'

/**
 * Above this many rows a bulk action asks first.
 *
 * A Shift-range is one keystroke away from forty rows, and re-filing forty items
 * by hand is the cost of getting it wrong — there is no bulk undo. Below the
 * threshold the cockpit stays a two-click loop, which is the point of it.
 */
const BULK_CONFIRM_AT = 10

/**
 * Rows mounted per section before the fold. `/tracks`' MAX_ROWS, unchanged.
 *
 * A panel row is the most expensive in the app — a checkbox, a compact EntryRow
 * and a <select> carrying one <option> per member, measured at 38 DOM elements
 * with an eight-person roster and 50 with twenty. The fold hides ROWS, never
 * facts: the section heading keeps the true total and the button says how many
 * are behind it.
 */
const MAX_ROWS = 25

/** The screen-owned flag `/tracks?unassigned=1` used, kept so the link still works. */
const P_UNASSIGNED = 'unassigned'

/** Hoisted: an object literal in JSX is a fresh identity that defeats memo(). */
const SHOW_WORK: EntryRowShow = { owner: false, track: false }

/** What a bulk control writes. One shape, so `applyBulk` needs no switch. */
type BulkKind = 'owner' | 'priority' | 'track'

/* ══════════════════════════ pure helpers ══════════════════════════ */

function isUnassigned(e: Entry): boolean {
  return e.owner_id === null && (e.owner_name === null || e.owner_name.trim() === '')
}

/** Which select value describes this row's owner right now. */
function ownerValueOf(e: Entry): string {
  if (e.owner_id !== null) return e.owner_id
  return isUnassigned(e) ? OWNER_NONE : OWNER_NAME
}

/** The patch a bulk control's value produces. Null for a value with no meaning. */
function bulkPatch(kind: BulkKind, value: string): EntryPatch | null {
  switch (kind) {
    case 'owner':
      // ownerName is cleared alongside: types.ts declares the two mutually
      // exclusive, and leaving a vendor's name on a row now owned by a teammate
      // makes every reader that falls back to owner_name — the digest, the CSV
      // export — disagree with this panel.
      return { ownerId: value === OWNER_NONE ? null : value, ownerName: null }
    case 'priority':
      return value === '' ? null : { priority: value as EntryPriority }
    case 'track':
      return { trackId: value === '' ? null : value }
  }
}

/**
 * Every entry id at or under a node, in tree order.
 *
 * FOLDS ARE WALKED THROUGH. A `more` node keeps its children (model.ts says so),
 * so the rows behind the picture's "+N more" are in this list exactly as they
 * are in the accessible table — the panel's own fold is the only one that hides
 * a row from the panel.
 */
function entryIdsOf(node: MindNode, out: string[] = []): string[] {
  if (node.entryId !== null) out.push(node.entryId)
  for (const child of node.children) entryIdsOf(child, out)
  return out
}

/**
 * The track a branch sits under, or null for the root and the untracked pile.
 *
 * `bucketKey` on a `track` node is the track id — model.ts publishes it so a
 * caller can turn a clicked branch into a facet without parsing the id apart.
 * The untracked pile's key is `''`, which is not a track and cannot be made one:
 * `FilterState.trackIds` has no way to say "track_id IS NULL", so that branch
 * gets no band and no history, and its section count is the whole answer.
 */
function trackIdOf(node: MindNode, path: readonly MindNode[]): string | null {
  for (const step of [...path, node]) {
    if (step.kind !== 'track') continue
    return step.bucketKey !== null && step.bucketKey !== '' ? step.bucketKey : null
  }
  return null
}

/** What one bulk run did. `done` counts `queued` — an outbox write is not a loss. */
export interface BulkOutcome {
  done: number
  queued: number
  failedIds: string[]
}

/**
 * Apply one patch to many rows and count what happened.
 *
 * SIX WRITES IN FLIGHT, NOT ONE, and the measurement is why: a non-status patch
 * is exactly ONE PostgREST request (api/entries.ts short-circuits its pre-read
 * when `patch.status === undefined`, and none of the three bulk kinds sets
 * status), so a sequential run pays the full round trip per row. At the 253 ms
 * measured against the live project, ticking a heading and assigning its thirty
 * open rows froze the old screen for seven and a half seconds; a hundred rows
 * took twenty-five. `pooled()` never exceeds WRITE_CONCURRENCY, so the load
 * argument that produced the sequential loop is preserved and the latency is not.
 *
 * IT IS SAFE TO OVERLAP THESE: `patchEntry`'s optimistic prefix — read the
 * store, apply locally, commit, mark pending — is synchronous before its first
 * await, the ids are distinct so the per-id pending guards never collide, and
 * each row's rollback is its own.
 *
 * `apply` is a parameter so the pooling can be tested: the bulk bar only exists
 * behind a live selection, which a node-environment render cannot make.
 */
export async function runBulk(
  ids: readonly string[],
  patch: EntryPatch,
  apply: (id: string, patch: EntryPatch) => Promise<ApiResult<Entry>>,
): Promise<BulkOutcome> {
  const results = await pooled(ids, (id) => apply(id, patch))

  let done = 0
  let queued = 0
  const failedIds: string[] = []
  // Indexed back into `ids`, because pooled() answers in INPUT order — which is
  // what makes "these are the rows that failed" true.
  results.forEach((result, i) => {
    if (result.ok) done += 1
    else if (result.error === QUEUED_ERROR_KEY) {
      // Outstanding, not failed: the outbox replays it on reconnect.
      queued += 1
      done += 1
    } else failedIds.push(ids[i])
  })

  return { done, queued, failedIds }
}

/* ══════════════════════════ the panel ══════════════════════════ */

export interface MapBranchProps {
  /** The focused node. `kind === 'root'` means the whole workspace. */
  node: MindNode
  /** Root-to-node trail, for the "as it stands" heading and the way out. */
  path: readonly MindNode[]
  filter: FilterState
  dimension: MindDimension
  textOf: (label: MindLabel) => string
  onFocus: (nodeId: string | null) => void
  compact: boolean
  announce: (text: string) => void
}

/** A section of the work band: one child branch, or the focused node itself. */
interface BranchSection {
  node: MindNode
  label: string
  /** Every entry id under it that survived the filter and the chip, store order. */
  ids: string[]
  unassigned: number
  breached: number
  /** The map's own collapse state for this branch. */
  collapsed: boolean
  /** A section that IS the focused node has nothing to collapse into. */
  foldable: boolean
}

interface StatSpec {
  key: string
  labelKey: string
  value: number
  /** A danger tone for the two facts that mean a promise was missed. */
  tone?: 'danger' | 'warn'
}

export default function MapBranch({
  node,
  path,
  filter,
  dimension,
  textOf,
  onFocus,
  compact,
  announce,
}: MapBranchProps): ReactElement {
  useLocale()
  const { profile } = useAuth()
  // `null`, never a stand-in: canEditEntry() answers false for a signed-out id,
  // which keeps the owner control disabled between mount and the profile landing
  // rather than handing out an affordance RLS would then refuse.
  const meId = profile?.id ?? null
  const role: UserRole = profile?.role ?? 'member'

  /* ── the chip, in the URL ─────────────────────────────────────────── */

  const [params, setParams] = useSearchParams()
  const unassignedOnly = params.get(P_UNASSIGNED) === '1'

  const toggleUnassigned = useCallback(() => {
    // A COPY of the live params, never a rebuild: `?focus=`, `?dim=`, `?lens=`
    // and the history band's four names belong to other writers and must survive
    // this one. `replace`, not push: no history entry per toggle.
    const p = new URLSearchParams(params)
    if (unassignedOnly) p.delete(P_UNASSIGNED)
    else p.set(P_UNASSIGNED, '1')
    setParams(p, { replace: true })
  }, [params, setParams, unassignedOnly])

  /* ── data ─────────────────────────────────────────────────────────── */

  const trackId = useMemo(() => trackIdOf(node, path), [node, path])
  const healthMap = useHealthMap()
  const truncated = useEntriesTruncated()
  const members = useMembers()
  const memberMap = useMemberMap()
  const activeTracks = useActiveTracks()
  const trackLabel = useTrackLabel()
  const priorities = useVocab('priority')

  useEffect(() => {
    void loadEntries()
  }, [])

  /**
   * The rows, in the STORE's order rather than the tree's.
   *
   * `scope` is pinned open exactly as `useMapModel` pins it — outside `filter`,
   * so Clear-all cannot change what this panel is about — which makes this set
   * and the tree's the same set. Intersecting the two is what makes a section
   * heading here and a node's chip over there two readings of one number.
   */
  const applied = useMemo<FilterState>(() => ({ ...filter, scope: 'open' }), [filter])
  const rows = useFilteredEntries(applied)

  /** id → position in `rows`, with the chip applied. One pass, not a scan each. */
  const order = useMemo(() => {
    const map = new Map<string, number>()
    rows.forEach((entry, i) => {
      if (unassignedOnly && !isUnassigned(entry)) return
      map.set(entry.id, i)
    })
    return map
  }, [rows, unassignedOnly])

  const entryById = useMemo(() => new Map(rows.map((e) => [e.id, e])), [rows])

  /**
   * The sections.
   *
   * A branch with branch children shows one section per child — which is
   * `/tracks`' node list exactly, one ring deeper. A branch whose children are
   * entries (a ring-2 bucket, or a leaf) is its own single section, so the panel
   * has one shape at every depth of the map.
   *
   * A BRANCH CHILD IS ANYTHING THAT IS NOT AN ITEM OR A FOLD. It used to read
   * `kind === 'track' || kind === 'group'`, which was every branch kind the tree
   * had; with organizations in it, a positive list finds ZERO branch children
   * under a phase, falls through to the single section below, and renders one
   * flattened list of every descendant's entries beside a picture showing five
   * Orgs. The negative degrades the other way — a structural kind nobody has
   * invented yet is still a section.
   */
  const sections = useMemo<BranchSection[]>(() => {
    const branches = node.children.filter((c) => c.kind !== 'entry' && c.kind !== 'more')
    const defs: { node: MindNode; foldable: boolean }[] =
      branches.length > 0
        ? branches.map((c) => ({ node: c, foldable: true }))
        : [{ node, foldable: false }]

    return defs.map((def) => {
      const ids = entryIdsOf(def.node)
        .filter((id) => order.has(id))
        .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
      let unassigned = 0
      let breached = 0
      for (const id of ids) {
        const entry = entryById.get(id)
        if (entry !== undefined && isUnassigned(entry)) unassigned += 1
        if (healthMap.get(id)?.sla_breached === true) breached += 1
      }
      return {
        node: def.node,
        label: textOf(def.node.label),
        ids,
        unassigned,
        breached,
        collapsed: def.foldable && def.node.collapsed,
        foldable: def.foldable,
      }
    })
  }, [node, order, entryById, healthMap, textOf])

  /* ── the folds ────────────────────────────────────────────────────── */

  /**
   * Sections showing every row rather than the first MAX_ROWS.
   *
   * Session state, deliberately not persisted: the fold is a "let me see the
   * rest of this one" answer to a long list, not a preference worth restoring on
   * a phone next Monday — restoring it would put the mount cost the fold exists
   * to avoid back on the first paint.
   */
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(() => new Set())

  const toggleFold = useCallback((key: string) => {
    setUnfolded((prev) => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      return next
    })
  }, [])

  const shownIds = useCallback(
    (section: BranchSection): string[] =>
      unfolded.has(section.node.id) ? section.ids : section.ids.slice(0, MAX_ROWS),
    [unfolded],
  )

  /** Every row the reader can currently see, in reading order. */
  const flatIds = useMemo(() => {
    const out: string[] = []
    for (const section of sections) {
      if (section.collapsed) continue
      // Sliced the same way the render is, because everything downstream —
      // pruning, a Shift-range, the sheet's prev/next — means "what the reader
      // can see". A row behind the fold is as invisible as one behind a
      // collapsed branch.
      for (const id of shownIds(section)) out.push(id)
    }
    return out
  }, [sections, shownIds])

  const flatRef = useRef(flatIds)
  flatRef.current = flatIds

  /* ── selection ────────────────────────────────────────────────────── */

  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  /** The last row ticked by hand — where a Shift-range measures from. */
  const anchorRef = useRef<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  // Prune to what is on screen: a bulk bar reading "18 selected" while six are
  // behind a fold offers an action nobody can review before taking it.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev
      const visible = new Set(flatIds)
      const next = new Set<string>()
      for (const id of prev) if (visible.has(id)) next.add(id)
      return next.size === prev.size ? prev : next
    })
  }, [flatIds])

  const toggleRow = useCallback((id: string, shift: boolean) => {
    setSelected((prev) => {
      const list = flatRef.current
      const anchor = anchorRef.current
      if (shift && anchor !== null && anchor !== id) {
        const from = list.indexOf(anchor)
        const to = list.indexOf(id)
        if (from >= 0 && to >= 0) {
          const next = new Set(prev)
          // A range ADDS. Shift-clicking a second stretch must not throw away
          // the first — collecting two clusters of work for one person is the
          // motion this panel exists for.
          for (let i = Math.min(from, to); i <= Math.max(from, to); i += 1) next.add(list[i])
          return next
        }
      }
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      anchorRef.current = id
      return next
    })
  }, [])

  const toggleSection = useCallback((section: BranchSection, on: boolean) => {
    // TICKING A SECTION OPENS BOTH FOLDS, and that is not a courtesy — it is
    // what keeps the control from being dead. Rows behind either fold are not in
    // `flatIds`, so the pruning effect above would drop every id this just added
    // one tick later, with no feedback at all. And a heading reading "60 open"
    // while 25 are mounted would otherwise select 25, so the count on the bar
    // would disagree with the count on the heading the reader just clicked.
    if (on) {
      if (section.collapsed) toggleMindCollapsed(section.node.id)
      if (section.ids.length > MAX_ROWS) {
        setUnfolded((prev) =>
          prev.has(section.node.id) ? prev : new Set(prev).add(section.node.id),
        )
      }
    }
    setSelected((prev) => {
      const next = new Set(prev)
      for (const id of section.ids) {
        if (on) next.add(id)
        else next.delete(id)
      }
      return next
    })
    anchorRef.current = null
  }, [])

  const clearSelection = useCallback(() => {
    // FOCUS FIRST. The Clear button lives inside the bulk bar and the bar exists
    // only while something is selected, so this call unmounts the control that
    // made it and focus would fall to <body>, with the next Tab restarting at
    // the top of the document (WCAG 2.4.3). The row last ticked by hand is where
    // attention already is and its checkbox is still mounted at this point —
    // React batches the re-render to the end of the handler. No anchor (a
    // whole-section tick) leaves focus alone rather than guessing at a row.
    const back = anchorRef.current
    if (back !== null) {
      rootRef.current
        ?.querySelector<HTMLInputElement>(`.mbr-row[data-entry="${back}"] .mbr-check`)
        ?.focus()
    }
    setSelected(new Set())
    anchorRef.current = null
    announce(t('tree.selectionCleared'))
  }, [announce])

  /* ── writes ───────────────────────────────────────────────────────── */

  const memberMapRef = useRef(memberMap)
  memberMapRef.current = memberMap

  /**
   * One row's owner, changed from the row. The store owns optimism and rollback,
   * and 0004's `entries_notify_trg` inserts the `assigned` row server-side, so
   * this writes nothing but `patchEntry`.
   */
  const setRowOwner = useCallback(
    (entry: Entry, value: string) => {
      // Unreachable through the UI — the option carrying it is already selected
      // — but a value with no patch must never reach the store as a blank write.
      if (value === OWNER_NAME) return
      const patch = bulkPatch('owner', value)
      if (patch === null) return
      // Announced BEFORE the await: the optimistic apply has already landed by
      // the time this returns, and a screen-reader user should hear the change
      // at the same moment a sighted one sees it.
      const name =
        value === OWNER_NONE ? null : (memberMapRef.current.get(value)?.displayName ?? null)
      announce(
        name === null
          ? t('tree.cleared', { title: entry.title })
          : t('tree.assigned', { title: entry.title, name }),
      )
      void patchEntry(entry.id, patch)
    },
    [announce],
  )

  const [busy, setBusy] = useState(false)

  /**
   * One bulk run: N independent optimistic patches, ONE summary.
   *
   * Partial success is REPORTED, not rolled back — discarding nine accepted
   * writes because the tenth failed is worse than saying which failed. The rows
   * that failed stay selected, so the retry is one more click.
   */
  const applyBulk = useCallback(
    async (bulk: BulkKind, value: string): Promise<void> => {
      if (busy) return
      const patch = bulkPatch(bulk, value)
      if (patch === null) return
      const ids = flatRef.current.filter((id) => selected.has(id))
      if (ids.length === 0) return

      if (ids.length >= BULK_CONFIRM_AT) {
        const ok = await confirm({
          title: t('tree.confirmTitle'),
          body: t('tree.confirmBody', { count: ids.length }),
          confirmLabel: t('common.apply'),
          cancelLabel: t('common.cancel'),
        })
        if (!ok) return
      }

      setBusy(true)
      const { done, queued, failedIds } = await runBulk(ids, patch, patchEntry)
      setBusy(false)

      const failed = failedIds.length
      // Exactly one sentence for the run. The store also toasts each individual
      // failure, so this is the summary above that noise, not instead of it.
      if (failed === 0 && queued > 0) toast(t('tree.bulkQueued', { count: queued }))
      else if (failed === 0) toast(t('tree.bulkDone', { count: done }), { tone: 'success' })
      else if (done === 0) toast(t('tree.bulkFailed', { count: failed }), { tone: 'error' })
      else toast(t('tree.bulkPartial', { done, failed }), { tone: 'error' })

      setSelected(new Set(failedIds))
      anchorRef.current = null
    },
    [busy, selected],
  )

  const handleOpen = useCallback((id: string) => {
    // The panel's own order as the sibling list, so the sheet's prev/next walks
    // what the reader is looking at rather than the store's canonical ordering.
    openEntry(id, { list: flatRef.current })
  }, [])

  const canEdit = useCallback((entry: Entry) => canEditEntry(entry, meId, role), [meId, role])

  /* ── the band: as it stands today ─────────────────────────────────── */

  /**
   * The live scope — NOT the filter and NOT the window. See the header: this
   * band answers "how does this track stand right now", a different question
   * from every other number on the panel, and it has to stay one.
   */
  const entityId = useMemo(() => entityIdOf(node), [node])
  const bandFilter = useMemo<FilterState>(
    () => ({
      ...EMPTY_FILTER,
      scope: 'open',
      trackIds: trackId === null ? [] : [trackId],
      // "Outstanding issues" is a question about the ORGANIZATION the reader
      // clicked, not about the whole track it sits under. `mapNodeIds` reaches
      // every descendant through FilterContext.ancestryOfNode, which
      // store/entries.ts builds over the whole tree — so this is the Org and
      // everything filed beneath it, and nothing else on the track.
      mapNodeIds: entityId === null ? [] : [entityId],
    }),
    [trackId, entityId],
  )
  const counts = useEntryCounts(bandFilter)
  const bandEntries = useFilteredEntries(bandFilter)

  /**
   * SLA is off until an admin arms it (0005 ships every priority NULL), so the
   * tile is absent rather than reading "0 past SLA" — a number nobody set is not
   * a reassurance, it is noise that trains people to ignore the row.
   */
  const sla = useMemo(() => {
    let armed = false
    let breached = 0
    for (const entry of bandEntries) {
      const row: EntryHealth | undefined = healthMap.get(entry.id)
      if (row?.sla_due_at != null) armed = true
      if (row?.sla_breached === true) breached += 1
    }
    return { armed, breached }
  }, [bandEntries, healthMap])

  const stats = useMemo<StatSpec[]>(() => {
    const list: StatSpec[] = [
      { key: 'open', labelKey: 'track.statOpen', value: counts.open },
      { key: 'overdue', labelKey: 'track.statOverdue', value: counts.overdue, tone: 'danger' },
      { key: 'stale', labelKey: 'track.statStale', value: counts.stale, tone: 'warn' },
      { key: 'blocked', labelKey: 'track.statBlocked', value: counts.blocked, tone: 'warn' },
      { key: 'unassigned', labelKey: 'track.statUnassigned', value: counts.unassigned },
    ]
    if (sla.armed) {
      list.push({ key: 'sla', labelKey: 'track.statSla', value: sla.breached, tone: 'danger' })
    }
    return list
  }, [counts, sla])

  /* ── render ───────────────────────────────────────────────────────── */

  const filtered = !isFilterEmpty(filter) || unassignedOnly
  const total = sections.reduce((n, s) => n + s.ids.length, 0)
  const selectedCount = selected.size
  // The band's scope, named so "As it stands today" cannot be read against the
  // wrong thing: the whole workspace at the root, otherwise the track.
  //
  // KINDS BY NAME, NOT `KIND_ROLE[kind] === 'place'`, and a COHORT is the reason
  // to say so out loud. A cohort is a `place` — the camera stops on one, the dive
  // enters one — but it has no `map_nodes` row for the band to read, so it takes
  // the track arm exactly as a `group` does. Widening this to the role row would
  // scope "outstanding issues" to a node that does not exist.
  const bandScope =
    node.kind === 'root' || node.kind === 'entity'
      ? node
      : (path.find((s) => s.kind === 'track') ?? node)

  return (
    <div
      className="mbr"
      ref={rootRef}
      // The axis the sections are cut on: they ARE the dimension's buckets below
      // ring 1, and a stylesheet or a test that needs to know which axis it is
      // reading has it here rather than parsing a node id apart.
      data-dim={dimension}
      data-compact={compact ? '' : undefined}
      data-picking={selectedCount > 0 ? 'true' : undefined}
    >
      {/* THE WAY OUT, inside the panel — the SAME control the shell draws above
          the canvas, not a second one. At the `full` detent on a phone the
          canvas is off screen, and a panel with no trail is a room with no door;
          re-implementing the trail here would be two breadcrumbs that could
          disagree about where the reader is. Breadcrumb draws nothing for a
          trail of one, which is the unfocused map. */}
      <Breadcrumb trail={path} onFocus={onFocus} />

      {/* Renders nothing unless the focused branch is an entity — a fourth
          empty band above the stats teaches nothing. `entityIdOf` reads
          `bucketKey` WITH `kind`, which is the only safe way to read it. */}
      <MapBranchDetail nodeId={entityId} kindName={node.entityType} />

      {/* WHAT THIS BRANCH PROMISED, under what it IS and above what is open on
          it — the order a reader asks in.

          GATED HERE RATHER THAN INSIDE, unlike the detail band one line up, and
          the difference is a fetch: this band opens a request on mount, and
          goals hang off a map node, so mounting it for a track or a status
          bucket would be one request per focus change that can never return a
          row. `MapBranchDetail` decides internally because it is cheap to
          decide there and the two bands share nothing but the id.

          `readings` IS NOT PASSED, AND THE REASON IS NOT A MISSING READ.
          `goalProgress` (lib/mapNodes.ts) needs the stage ladder and the
          descendant walk, and both are in store/config already — what this
          component does not have is the GOALS. The band fetches them itself,
          `readings` is keyed by goal id, and lifting that fetch up here so a
          parent could key a map by it would make the panel read one node's
          goals twice. So the fold belongs where the portfolio's own goal read
          lands (wave 4), and until then every goal renders its promise with an
          em-dash where the number goes — which is "nobody has folded this", a
          different fact from zero. See `GoalReading` in MapBranchDetail.tsx. */}
      {entityId !== null && <MapBranchGoals nodeId={entityId} />}

      {(trackId !== null || node.kind === 'root') && (
        <section className="mbr-band mbr-stats" aria-label={t('track.now')}>
          <p className="mbr-stats-label">{t('track.now')}</p>
          <p className="mbr-stats-scope">{textOf(bandScope.label)}</p>
          <ul className="mbr-stat-list">
            {stats.map((s) => (
              <li key={s.key} className="mbr-stat" data-tone={s.tone}>
                <span className="mbr-stat-n tabular">{s.value}</span>
                <span className="mbr-stat-k">{t(s.labelKey)}</span>
              </li>
            ))}
          </ul>
          <p className="mbr-stats-hint">{t('track.statsHint')}</p>
          {/* Not a failure and not decoration: past PostgREST's ceiling the
              working set is a window, so every number above counts what loaded. */}
          {truncated && (
            <p className="mbr-note" role="status">
              {t('track.statsPartial')}
            </p>
          )}
        </section>
      )}

      {/* `.mbr-work` carries no rule and must not be swept away for that: like
          `.mbr-history` in MapBranchHistory.tsx (see its header) it is an
          IDENTITY, the twin that names this band apart from the history band
          the test slices the document at. An empty rule would be a lie. */}
      <section className="mbr-band mbr-work" aria-label={t('tree.openWork')}>
        <div className="mbr-band-head">
          <h3 className="section-title">{t('tree.openWork')}</h3>
          <span className="pill mbr-band-count tabular">{t('tree.total', { count: total })}</span>
        </div>

        <div className="mbr-tools">
          <button
            type="button"
            className="chip tap-44"
            aria-pressed={unassignedOnly}
            onClick={toggleUnassigned}
          >
            {t('tree.unassignedOnly')}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost tap-44"
            onClick={() => void refreshEntries()}
          >
            {t('tree.refresh')}
          </button>
        </div>

        <p className="mbr-hint">{t('tree.hint')}</p>

        {total === 0 ? (
          // Two different nothings: an empty branch under a filter has not been
          // cleared, it has been hidden, and telling somebody their work is done
          // when it is merely filtered is the worst possible empty state.
          <EmptyState
            icon={<IconLayers size={26} />}
            title={filtered ? t('tree.emptyFiltered') : t('tree.allClear')}
            description={filtered ? t('tree.emptyFilteredHint') : t('tree.allClearHint')}
          />
        ) : (
          <ul
            className="mbr-nodes"
            aria-label={node.kind === 'root' ? t('tree.trackTree') : t('tree.openWork')}
          >
            {sections.map((section) => {
              const shown = section.collapsed ? [] : shownIds(section)
              const picked = section.ids.reduce((n, id) => (selected.has(id) ? n + 1 : n), 0)
              const hidden = section.ids.length - shown.length
              return (
                <li
                  key={section.node.id}
                  className="mbr-node track-bar"
                  style={section.node.colourVars}
                  data-open={section.collapsed ? undefined : 'true'}
                  data-retired={section.node.retired ? 'true' : undefined}
                >
                  <div className="mbr-node-head">
                    {/* Outside the toggle: a checkbox inside a <button> is
                        invalid HTML, and nesting it would make every attempt to
                        tick it fold the section instead. */}
                    <TriCheckbox
                      className="mbr-check mbr-check-node"
                      checked={section.ids.length > 0 && picked === section.ids.length}
                      indeterminate={picked > 0 && picked < section.ids.length}
                      disabled={section.ids.length === 0}
                      label={t('tree.selectTrack', { track: section.label })}
                      onToggle={(on) => toggleSection(section, on)}
                    />
                    {section.foldable ? (
                      <button
                        type="button"
                        className="mbr-node-toggle tap-44"
                        aria-expanded={!section.collapsed}
                        onClick={() => toggleMindCollapsed(section.node.id)}
                      >
                        <IconChevronDown size={16} className="mbr-caret" />
                        {/* aria-hidden: TrackDot labels itself for a standalone
                            mark, and inside a button that label would be read a
                            second time in front of the name. */}
                        <span className="mbr-node-mark" aria-hidden="true">
                          <TrackDot
                            // `trackIdOf`, not the section's own bucket key: an
                            // Org has no track id of its own, it INHERITS one —
                            // the payoff of "tracks stay". Reading the key
                            // directly gave every non-track section the neutral
                            // mark, whose tooltip says "No track" about a branch
                            // that plainly has one. The helper still answers
                            // null for the untracked pile, whose `''` is not a
                            // track id and must not be looked up as one.
                            trackId={trackIdOf(section.node, path)}
                            variant="glyph"
                          />
                        </span>
                        <span className="mbr-node-name">{section.label}</span>
                        <SectionCounts section={section} chip={unassignedOnly} />
                      </button>
                    ) : (
                      <p className="mbr-node-plain">
                        <span className="mbr-node-name">{section.label}</span>
                        <SectionCounts section={section} chip={unassignedOnly} />
                      </p>
                    )}
                  </div>

                  {!section.collapsed && (
                    <>
                      <ul className="mbr-rows">
                        {shown.map((id) => {
                          const entry = entryById.get(id)
                          return entry === undefined ? null : (
                            <BranchRow
                              key={id}
                              entry={entry}
                              health={healthMap.get(id)}
                              members={members}
                              memberMap={memberMap}
                              canEdit={canEdit(entry)}
                              selected={selected.has(id)}
                              onToggle={toggleRow}
                              onOpen={handleOpen}
                              onOwner={setRowOwner}
                            />
                          )
                        })}
                      </ul>
                      {section.ids.length > MAX_ROWS && (
                        // Named after its section, because several are on screen
                        // at once and "Show all" on its own says nothing about
                        // which list grows.
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost mbr-more tap-44"
                          onClick={() => toggleFold(section.node.id)}
                          aria-label={
                            hidden > 0
                              ? t('tree.showAllIn', { track: section.label })
                              : t('tree.showLessIn', { track: section.label })
                          }
                        >
                          {hidden > 0 ? t('tree.showAll') : t('tree.showLess')}
                          {hidden > 0 && (
                            <span className="pill tabular">
                              {t('tree.rowsHidden', { count: hidden })}
                            </span>
                          )}
                        </button>
                      )}
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <MapBranchHistory trackId={trackId} />

      {selectedCount > 0 && (
        <div className="mbr-bulk" role="region" aria-label={t('tree.bulkTitle')}>
          <p className="mbr-bulk-count tabular" aria-live="polite">
            {t('tree.selected', { count: selectedCount })}
          </p>

          {/* The first option is the label AND the placeholder: a floating bar
              has no room for a caption above every control, and a select reading
              "Assign to" collapsed is clearer than one reading "Choose…" beside
              two identical siblings. */}
          <select
            className="select mbr-bulk-select"
            aria-label={t('tree.bulkAssign')}
            disabled={busy}
            value=""
            onChange={(ev) => void applyBulk('owner', ev.target.value)}
          >
            <option value="">{t('tree.bulkAssign')}</option>
            <option value={OWNER_NONE}>{t('entry.unassigned')}</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </select>

          <select
            className="select mbr-bulk-select"
            aria-label={t('tree.bulkPriority')}
            disabled={busy}
            value=""
            onChange={(ev) => void applyBulk('priority', ev.target.value)}
          >
            <option value="">{t('tree.bulkPriority')}</option>
            {priorities.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>

          <select
            className="select mbr-bulk-select"
            aria-label={t('tree.bulkTrack')}
            disabled={busy}
            value=""
            onChange={(ev) => void applyBulk('track', ev.target.value)}
          >
            <option value="">{t('tree.bulkTrack')}</option>
            {activeTracks.map((track) => (
              <option key={track.id} value={track.id}>
                {trackLabel(track)}
              </option>
            ))}
          </select>

          {busy && <span className="mbr-bulk-busy">{t('tree.bulkBusy')}</span>}

          <button
            type="button"
            className="btn btn-sm btn-ghost mbr-bulk-clear tap-44"
            onClick={clearSelection}
          >
            {t('tree.bulkClear')}
          </button>
        </div>
      )}
    </div>
  )
}

/* ══════════════════════════ a section's counts ══════════════════════════ */

function SectionCounts({ section, chip }: { section: BranchSection; chip: boolean }): ReactElement {
  useLocale()
  return (
    <>
      <span className="pill mbr-count tabular">
        {t('tree.countOpen', { count: section.ids.length })}
      </span>
      {/* Suppressed under the unassigned-only chip, where it can only ever
          repeat the open count back at the reader. */}
      {section.unassigned > 0 && !chip && (
        <span className="pill warn mbr-count tabular">
          {t('tree.countUnassigned', { count: section.unassigned })}
        </span>
      )}
      {section.breached > 0 && (
        <span className="pill danger mbr-count tabular">
          {t('tree.countBreached', { count: section.breached })}
        </span>
      )}
      {/* Retired — an archived track, a hidden vocabulary option — and still
          holding work. Marked rather than hidden: hiding it strands the work. */}
      {section.node.retired && (
        <span className="pill mbr-retired" title={t('tree.archivedHint')}>
          {t('tree.archived')}
        </span>
      )}
    </>
  )
}

/* ══════════════════════════ one work row ══════════════════════════ */

interface BranchRowProps {
  entry: Entry
  health: EntryHealth | undefined
  members: Member[]
  memberMap: ReadonlyMap<string, Member>
  canEdit: boolean
  selected: boolean
  onToggle: (id: string, shift: boolean) => void
  onOpen: (id: string) => void
  onOwner: (entry: Entry, value: string) => void
}

/**
 * One entry as a work row: a checkbox, the kit's EntryRow, and the owner select.
 *
 * The two per-entry store subscriptions live HERE rather than in EntryRow,
 * because the kit's connectedness rule forbids a row reading store/entries: two
 * hundred rows each subscribing to the LIST would re-render the whole panel on
 * one realtime patch. `usePendingOp` and `useEntryFlash` are the narrow per-id
 * selectors published for exactly this case — a Map lookup, so only the row
 * whose value changed re-renders.
 *
 * SUBSCRIBED TO THE LOCALE, because this row calls t() directly and memo() would
 * otherwise never re-run it. Every prop above is reference-stable across a
 * language switch, and the owner <select> reaches EntryRow as a pre-built
 * element, so React's identity bailout means the amber "Unassigned" option on
 * exactly the rows this panel exists to fix would keep its old language.
 */
const BranchRow = memo(function BranchRow({
  entry,
  health,
  members,
  memberMap,
  canEdit,
  selected,
  onToggle,
  onOpen,
  onOwner,
}: BranchRowProps): ReactElement {
  useLocale()
  const pending = usePendingOp(entry.id)
  const flash = useEntryFlash(entry.id)

  const value = ownerValueOf(entry)
  const unassigned = value === OWNER_NONE
  // An owner_id pointing at a profile that is gone (or has not loaded yet) would
  // otherwise select nothing and render a blank control on a row that DOES have
  // an owner — an empty select reads as "unassigned", which is a lie about the
  // data and a trap for the next person to touch it.
  const orphan = entry.owner_id !== null && !memberMap.has(entry.owner_id)

  return (
    // `data-entry` is how the bulk bar's Clear finds this row's checkbox to hand
    // focus back to — see clearSelection().
    <li className="mbr-row" data-entry={entry.id} data-selected={selected ? 'true' : undefined}>
      <TriCheckbox
        className="mbr-check"
        checked={selected}
        disabled={!canEdit}
        label={t('tree.selectRow', { title: entry.title })}
        title={canEdit ? undefined : t('entry.cannotEdit')}
        onToggle={(_on, shift) => onToggle(entry.id, shift)}
      />
      <div className="mbr-row-body">
        <EntryRow
          entry={entry}
          health={health}
          density="compact"
          // owner: the select below IS the owner control — see the file header.
          // track: the section heading already said which one.
          show={SHOW_WORK}
          flash={flash}
          pending={pending}
          canEdit={canEdit}
          onOpen={onOpen}
          actions={
            <select
              className="select mbr-owner"
              data-unassigned={unassigned ? 'true' : undefined}
              value={value}
              disabled={!canEdit}
              title={canEdit ? undefined : t('entry.cannotEdit')}
              aria-label={t('tree.ownerFor', { title: entry.title })}
              onChange={(ev) => onOwner(entry, ev.target.value)}
            >
              <option value={OWNER_NONE}>{t('entry.unassigned')}</option>
              {orphan && entry.owner_id !== null && (
                <option value={entry.owner_id}>{t('tree.unknownOwner')}</option>
              )}
              {/* A free-text owner is shown, never silently overwritten. It is a
                  source value only; the entry sheet's OwnerPicker is where a new
                  external name is typed. */}
              {value === OWNER_NAME && entry.owner_name !== null && (
                <option value={OWNER_NAME}>{entry.owner_name}</option>
              )}
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                </option>
              ))}
            </select>
          }
        />
      </div>
    </li>
  )
})

/* ══════════════════════════ the checkbox ══════════════════════════ */

interface TriCheckboxProps {
  checked: boolean
  indeterminate?: boolean
  disabled?: boolean
  /** The accessible name. Icon-only controls get one or they announce as "checkbox". */
  label: string
  title?: string
  className?: string
  onToggle: (on: boolean, shift: boolean) => void
}

/**
 * A checkbox that can also be partly on, and that reports whether Shift was down.
 *
 * `indeterminate` is a DOM property with no attribute, so it can only be set
 * through a ref — React does not forward it.
 *
 * Shift is captured on pointerdown/keydown rather than read off the change
 * event: React routes checkbox `onChange` through the native `click` event
 * today, so `nativeEvent.shiftKey` happens to work, but that is an
 * implementation detail of the event plugin and not something a range selection
 * should rest on.
 */
function TriCheckbox({
  checked,
  indeterminate = false,
  disabled = false,
  label,
  title,
  className,
  onToggle,
}: TriCheckboxProps): ReactElement {
  const ref = useRef<HTMLInputElement | null>(null)
  const shiftRef = useRef(false)

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate])

  return (
    <input
      ref={ref}
      type="checkbox"
      className={className}
      checked={checked}
      disabled={disabled}
      aria-label={label}
      title={title}
      onPointerDown={(ev) => {
        shiftRef.current = ev.shiftKey
      }}
      onKeyDown={(ev) => {
        shiftRef.current = ev.shiftKey
      }}
      onChange={(ev) => {
        const shift = shiftRef.current
        shiftRef.current = false
        onToggle(ev.target.checked, shift)
      }}
    />
  )
}
