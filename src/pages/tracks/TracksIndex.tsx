// The distribution tree — every active track with the work still open on it.
//
// THIS IS A DELEGATION COCKPIT, NOT A LISTING (WAVE3-NOTES §2). The question it
// answers is "who takes this", so the owner control is ON THE ROW rather than
// two taps away in the sheet, and the selection machinery exists so that answer
// can be given once for twenty rows. Everything else here — the counts, the
// unassigned toggle, the expand state — is in service of finding the rows that
// still need an answer.
//
// ONE OWNER AFFORDANCE PER ROW. EntryRow renders an OwnerBadge by default and
// this screen switches it off (`show.owner: false`), because a badge that
// displays the owner beside a select that changes it is two controls telling the
// same fact, and the one that looks read-only is the one people tap. The select
// IS the display: it carries the name, and it goes loud (`data-unassigned`) when
// there is nobody in it. `show.track` is off for the same reason — the node
// heading three rows up already said which track this is.
//
// THE NOTIFICATION IS SERVER-SIDE, and that is why this file writes nothing but
// `patchEntry`. 0004's `entries_notify_trg` inserts the `assigned` row when
// `owner_id` changes to somebody who is not the actor, so re-assigning from here
// notifies the teammate with zero plumbing on this screen — and adding a client
// insert would either duplicate the row or fail the guard. Same argument the
// board makes about transition rows.
//
// OPTIMISM AND ROLLBACK COME FROM THE STORE. `patchEntry()` applies locally,
// re-derives, and restores its own columns if the write fails (revertMine), so
// "per-row rollback" for a bulk run is the sum of twenty independent rollbacks
// and this file holds no shadow copy of anything. What it adds is the SUMMARY:
// one toast for the run, rather than the user counting toasts.
//
// SELECTION IS PRUNED TO WHAT IS VISIBLE. Collapsing a node or tightening a
// filter drops its rows from the selection, because a bulk bar reading "18
// selected" while six of them are behind a collapsed node is an action nobody
// can review before taking it. The rule is: you can only act on rows you can
// see.
//
// SCOPE IS FORCED TO 'open' AND THE OWNER FACET IS NOT OFFERED. The tree is
// about work that still needs doing, and the unassigned toggle owns the owner
// dimension — a second owner control in the filter panel would fight it and win
// silently, since both write the same field of FilterState.

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from 'react'
import { useSearchParams } from 'react-router-dom'
import FilterBar, { type FilterFacet } from '../../components/FilterBar'
import { EmptyState, Skeleton } from '../../components/shared'
import { EntryRow, TrackDot } from '../../components/entry'
import { IconChevronDown } from '../../components/fields'
import { IconLayers } from '../../components/icons'
import { confirm } from '../../components/Confirm'
import { toast } from '../../components/toast'
import {
  EMPTY_FILTER,
  filterFromParams,
  filterToParams,
  isFilterEmpty,
  type FilterState,
} from '../../lib/entryFilter'
import { t, useLocale } from '../../lib/i18n'
import { useTrackLabel } from '../../lib/labels'
import { canEditEntry } from '../../lib/permissions'
import { trackVars } from '../../lib/trackStyle'
import { useAuth } from '../../store/auth'
import { useActiveTracks, useTrackMap } from '../../store/config'
import {
  loadEntries,
  patchEntry,
  refreshEntries,
  useEntriesError,
  useEntriesLoading,
  useEntriesTruncated,
  useEntryFlash,
  useFilteredEntries,
  useHealthMap,
  usePendingOp,
} from '../../store/entries'
import { openEntry } from '../../store/entrySheet'
import { useMemberMap, useMembers } from '../../store/members'
import { useVocab } from '../../store/vocab'
import type { Member } from '../../api/members'
import type {
  Entry,
  EntryHealth,
  EntryPatch,
  EntryPriority,
  UserRole,
} from '../../types'
import './tree.css'

/** The node key for entries with no track. Never a real uuid. */
const NO_TRACK = ''

/** The owner select's value for "nobody". Never a real uuid. */
const OWNER_NONE = ''

/**
 * The owner select's value for a free-text owner — a vendor, a contractor,
 * somebody outside the workspace.
 *
 * A synthetic key with a leading space, so it cannot collide with a uuid. It is
 * a SOURCE value only: the option exists so a row owned by "Acme Support" shows
 * that name instead of a blank control, and selecting it is impossible (a
 * <select> fires no change for the value it already holds). Typing a new
 * external name is the entry sheet's OwnerPicker; a tree row has nowhere to
 * type.
 */
const OWNER_NAME = ' name'

/**
 * The URL flag for the unassigned-only view — `/tracks?unassigned=1`.
 *
 * Deliberately NOT `filterToParams`'s `owner=unassigned`, even though the two
 * mean the same thing to `selectEntries`. WAVE3-NOTES §2 specifies this exact
 * link because it is the one people paste into a chat, and a screen-owned flag
 * is also what lets the toggle survive every other filter edit — `setFilter`
 * re-writes the whole query string from the filter model, which knows nothing
 * about it.
 */
const UNASSIGNED_PARAM = 'unassigned'

/** localStorage record of which nodes are folded shut. */
const PREFS_KEY = 'opstrack_tree_v1'

/**
 * store/entries.ts's private QUEUED_KEY, which is not a failure: the write is in
 * the outbox and lands on reconnect. Duplicated as a literal because the store
 * does not export it — recorded as an extension-slot gap rather than reached for
 * across the module boundary. Board.tsx carries the same literal.
 */
const QUEUED_ERROR_KEY = 'offline.queued'

/**
 * Above this many rows, a bulk action asks first.
 *
 * A shift-range is one keystroke away from forty rows, and re-filing forty items
 * by hand is the cost of getting it wrong — there is no bulk undo. Below the
 * threshold the cockpit stays a two-click loop, which is the whole point of it.
 */
const BULK_CONFIRM_AT = 10

/**
 * The facets this screen offers.
 *
 * No `scope` (forced to open), no `owner` (the unassigned toggle owns it), no
 * `track` (the tree IS the track axis — a track facet would empty five of the
 * six nodes it is drawn beside).
 */
const TREE_FACETS: readonly FilterFacet[] = ['search', 'mine', 'status', 'priority', 'tag']

/** What a bulk control writes. One shape so `applyBulk` needs no switch. */
type BulkKind = 'owner' | 'priority' | 'track'

interface TreeNode {
  /** Track id, or NO_TRACK. */
  key: string
  label: string
  /** The track's colour pair, for `.track-bar`. `{}` for the untracked node. */
  vars: CSSProperties
  /** Holds work but is not an active track — archived, or deleted outright. */
  residual: boolean
  entries: Entry[]
  unassigned: number
  breached: number
}

interface TreePrefs {
  /**
   * COLLAPSED, not expanded. A tree of six tracks is meant to be read open —
   * that is the "all tracks with their tasks" the directive asks for — and
   * storing the negative means a track created next month arrives expanded
   * instead of invisible.
   */
  collapsed: string[]
}

const DEFAULT_PREFS: TreePrefs = { collapsed: [] }

function readPrefs(): TreePrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (raw === null) return DEFAULT_PREFS
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_PREFS
    const rec = parsed as Record<string, unknown>
    if (!Array.isArray(rec.collapsed)) return DEFAULT_PREFS
    return { collapsed: rec.collapsed.filter((k): k is string => typeof k === 'string') }
  } catch {
    // Private mode, a quota wall, a hand-edited value. A tree that throws on
    // mount because a preference is malformed is worse than a fully open one.
    return DEFAULT_PREFS
  }
}

function writePrefs(prefs: TreePrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Preferences are a convenience; losing them must never break an assignment.
  }
}

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
      // ownerName is cleared alongside, because types.ts declares the two
      // mutually exclusive — leaving a vendor's name on a row now owned by a
      // teammate makes every reader that falls back to owner_name (the digest,
      // the CSV export) disagree with this screen.
      return { ownerId: value === OWNER_NONE ? null : value, ownerName: null }
    case 'priority':
      return value === '' ? null : { priority: value as EntryPriority }
    case 'track':
      return { trackId: value === NO_TRACK ? null : value }
  }
}

export default function TracksIndex(): ReactElement {
  useLocale()
  const { profile } = useAuth()
  // `null`, never a stand-in: canEditEntry() answers false for a signed-out id,
  // which is what keeps the owner control disabled in the moment between mount
  // and the profile landing. A placeholder would satisfy the open branch's
  // `!!meId` and hand out an affordance the server would then refuse.
  const meId = profile?.id ?? null
  const role: UserRole = profile?.role ?? 'member'

  // ── filter + the unassigned flag, both in the URL ────────────────────────

  const [params, setParams] = useSearchParams()
  const unassignedOnly = params.get(UNASSIGNED_PARAM) === '1'

  const filter = useMemo<FilterState>(() => {
    const parsed = filterFromParams(params)
    // A hand-edited or inherited URL can carry a scope and an owner this screen
    // has no control for. Normalising HERE rather than only in `effective` is
    // what stops the facet-count pill counting a filter the user can neither see
    // nor switch off.
    if (parsed.scope === 'open' && parsed.owner.kind === 'any') return parsed
    return { ...parsed, scope: 'open', owner: EMPTY_FILTER.owner }
  }, [params])

  const setFilter = useCallback(
    (next: FilterState) => {
      const p = filterToParams(next)
      // The flag is this screen's, not the filter model's, so it has to be
      // re-attached every time the query string is rebuilt.
      if (unassignedOnly) p.set(UNASSIGNED_PARAM, '1')
      // `replace`, not push: search is not debounced (FilterBar's header says
      // why) and a history entry per keystroke makes Back unusable.
      setParams(p, { replace: true })
    },
    [setParams, unassignedOnly],
  )

  const toggleUnassigned = useCallback(() => {
    const p = filterToParams(filter)
    if (!unassignedOnly) p.set(UNASSIGNED_PARAM, '1')
    setParams(p, { replace: true })
  }, [filter, unassignedOnly, setParams])

  const effective = useMemo<FilterState>(
    () => (unassignedOnly ? { ...filter, owner: { kind: 'unassigned' } } : filter),
    [filter, unassignedOnly],
  )

  // ── data ─────────────────────────────────────────────────────────────────

  const entries = useFilteredEntries(effective)
  const healthMap = useHealthMap()
  const loading = useEntriesLoading()
  const errorKey = useEntriesError()
  const truncated = useEntriesTruncated()
  const activeTracks = useActiveTracks()
  const trackMap = useTrackMap()
  const trackLabel = useTrackLabel()
  const members = useMembers()
  const memberMap = useMemberMap()
  const priorities = useVocab('priority')

  useEffect(() => {
    void loadEntries()
  }, [])

  // ── nodes ────────────────────────────────────────────────────────────────

  const nodes = useMemo<TreeNode[]>(() => {
    const buckets = new Map<string, Entry[]>()
    for (const entry of entries) {
      const key = entry.track_id ?? NO_TRACK
      const held = buckets.get(key)
      if (held) held.push(entry)
      else buckets.set(key, [entry])
    }

    const defs: Omit<TreeNode, 'entries' | 'unassigned' | 'breached'>[] = []

    // The untracked bucket LEADS, and only exists when it holds something:
    // work with no track is the queue, and a queue belongs at the front of the
    // reading order. An empty one is not a fact anybody needs.
    if ((buckets.get(NO_TRACK)?.length ?? 0) > 0) {
      defs.push({ key: NO_TRACK, label: t('entry.noTrack'), vars: {}, residual: false })
    }

    for (const track of activeTracks) {
      defs.push({
        key: track.id,
        label: trackLabel(track),
        vars: trackVars(track.color, track.color_light),
        residual: false,
      })
    }

    // Anything the data holds that the active list does not declare: a track
    // archived while work was still open on it, or one deleted outright. It gets
    // a node at the end rather than disappearing — otherwise that work is
    // stranded, visible nowhere, and quietly stops being anybody's problem.
    const declared = new Set(defs.map((d) => d.key))
    for (const key of buckets.keys()) {
      if (declared.has(key)) continue
      const track = trackMap.get(key)
      defs.push({
        key,
        label: track ? trackLabel(track) : t('tree.unknownTrack'),
        vars: track ? trackVars(track.color, track.color_light) : {},
        residual: true,
      })
    }

    return defs.map((def) => {
      const held = buckets.get(def.key) ?? []
      let unassigned = 0
      let breached = 0
      for (const entry of held) {
        if (isUnassigned(entry)) unassigned += 1
        if (healthMap.get(entry.id)?.sla_breached) breached += 1
      }
      return { ...def, entries: held, unassigned, breached }
    })
  }, [entries, activeTracks, trackMap, trackLabel, healthMap])

  const tagOptions = useMemo(() => {
    const tags = new Set<string>()
    for (const entry of entries) for (const tag of entry.tags) tags.add(tag)
    // The vocabulary the team agreed on per track, offered before anyone has
    // typed it even once.
    for (const track of activeTracks) for (const tag of track.suggested_tags) tags.add(tag)
    // An applied tag always stays offered, or a filter that empties the tree
    // would take its own off-switch with it.
    for (const tag of filter.tags) tags.add(tag)
    return [...tags].sort()
  }, [entries, activeTracks, filter.tags])

  // ── fold state ───────────────────────────────────────────────────────────

  const [prefs, setPrefs] = useState<TreePrefs>(readPrefs)
  useEffect(() => {
    writePrefs(prefs)
  }, [prefs])

  const collapsed = useMemo(() => new Set(prefs.collapsed), [prefs.collapsed])

  const toggleNode = useCallback((key: string) => {
    setPrefs((p) => {
      const next = p.collapsed.includes(key)
        ? p.collapsed.filter((k) => k !== key)
        : [...p.collapsed, key]
      return { collapsed: next }
    })
  }, [])

  const nodeKeys = useMemo(() => nodes.map((n) => n.key), [nodes])
  const expandAll = useCallback(() => setPrefs({ collapsed: [] }), [])
  const collapseAll = useCallback(() => setPrefs({ collapsed: [...nodeKeys] }), [nodeKeys])
  const allCollapsed = nodeKeys.length > 0 && nodeKeys.every((k) => collapsed.has(k))

  /** Every row the reader can currently see, in reading order. */
  const flatIds = useMemo(() => {
    const out: string[] = []
    for (const node of nodes) {
      if (collapsed.has(node.key)) continue
      for (const entry of node.entries) out.push(entry.id)
    }
    return out
  }, [nodes, collapsed])

  const flatRef = useRef(flatIds)
  flatRef.current = flatIds

  // ── selection ────────────────────────────────────────────────────────────

  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  /** The last row ticked by hand — where a shift-range measures from. */
  const anchorRef = useRef<string | null>(null)
  /** The tree root, so focus restoration can scope its lookup to this screen. */
  const treeRef = useRef<HTMLDivElement>(null)

  /**
   * The bulk bar's real height, published to CSS as `--tree-bulk-h`.
   *
   * On a phone the bar is `position: fixed` above the tab bar, and the sheet
   * reserves room for it at the end of the tree so the last row is not parked
   * underneath. That reservation was a hardcoded 84px against a bar that wraps
   * to 166px in English and more in Arabic — so the last row, the one a
   * distribution pass ends on, was always unreachable. Measuring is the only
   * honest answer: the height depends on the wrap, which depends on the
   * language, the width and how many controls the bar is showing.
   */
  const [bulkHeight, setBulkHeight] = useState(0)
  const bulkObserver = useRef<ResizeObserver | null>(null)
  const registerBulk = useCallback((el: HTMLDivElement | null) => {
    bulkObserver.current?.disconnect()
    bulkObserver.current = null
    if (el === null) {
      setBulkHeight(0)
      return
    }
    setBulkHeight(el.offsetHeight)
    // Guarded because the render tests run in node, where the constructor does
    // not exist; the CSS fallback covers that case and every other one where a
    // measurement has not landed yet.
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setBulkHeight(el.offsetHeight))
    observer.observe(el)
    bulkObserver.current = observer
  }, [])

  useEffect(
    () => () => {
      bulkObserver.current?.disconnect()
      bulkObserver.current = null
    },
    [],
  )

  // Prune to what is on screen. See the file header: a bulk bar counting rows
  // behind a collapsed node offers an action nobody can review.
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
      const order = flatRef.current
      const anchor = anchorRef.current
      if (shift && anchor !== null && anchor !== id) {
        const from = order.indexOf(anchor)
        const to = order.indexOf(id)
        if (from >= 0 && to >= 0) {
          const next = new Set(prev)
          // A range ADDS. Shift-clicking a second stretch must not throw away
          // the first — collecting two clusters of work for one person is the
          // motion this screen exists for.
          for (let i = Math.min(from, to); i <= Math.max(from, to); i += 1) next.add(order[i])
          return next
        }
      }
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      anchorRef.current = id
      return next
    })
  }, [])

  const toggleNodeSelection = useCallback((node: TreeNode, on: boolean) => {
    // Selecting a FOLDED node opens it, and that is not a courtesy — it is what
    // keeps the control from being dead. Rows behind a fold are not in
    // `flatIds`, so the pruning effect above would drop every id this just
    // added, one tick later, with no feedback at all. Expanding first makes the
    // selection legal and shows the reader what they are about to act on.
    if (on) {
      setPrefs((p) => (p.collapsed.includes(node.key)
        ? { collapsed: p.collapsed.filter((k) => k !== node.key) }
        : p))
    }
    setSelected((prev) => {
      const next = new Set(prev)
      for (const entry of node.entries) {
        if (on) next.add(entry.id)
        else next.delete(entry.id)
      }
      return next
    })
    anchorRef.current = null
  }, [])

  // ── the live region ──────────────────────────────────────────────────────
  //
  // `seq` keys the child so an identical consecutive sentence still re-announces
  // — assigning two rows to the same person produces the same string, and a
  // region that only reacts to text CHANGES swallows the second one.
  const [announcement, setAnnouncement] = useState({ text: '', seq: 0 })
  const announce = useCallback((text: string) => {
    setAnnouncement((prev) => ({ text, seq: prev.seq + 1 }))
  }, [])

  const clearSelection = useCallback(() => {
    // FOCUS FIRST. The Clear button lives inside the bulk bar, and the bar is
    // rendered only while something is selected — so this call unmounts the
    // control that made it, and focus falls to <body> with the next Tab
    // restarting at the top of the document (WCAG 2.4.3). The row last ticked
    // by hand is where the reader's attention already is, and its checkbox is
    // still mounted at this point: React batches the re-render to the end of
    // the handler, so focusing now means the bar unmounts from an element that
    // is no longer focused. No anchor (a whole-track tick) leaves focus alone
    // rather than guessing at a row nobody pointed at.
    const back = anchorRef.current
    if (back !== null) {
      treeRef.current
        ?.querySelector<HTMLInputElement>(`.tree-row[data-entry="${back}"] .tree-check`)
        ?.focus()
    }
    setSelected(new Set())
    anchorRef.current = null
    announce(t('tree.selectionCleared'))
  }, [announce])

  // ── writes ───────────────────────────────────────────────────────────────

  const memberMapRef = useRef(memberMap)
  memberMapRef.current = memberMap

  /** One row's owner, changed from the row. The store owns optimism and rollback. */
  const setRowOwner = useCallback(
    (entry: Entry, value: string) => {
      // Unreachable through the UI — the option carrying it is already selected,
      // so the control cannot fire for it — but a value with no patch must never
      // reach the store as a blank update.
      if (value === OWNER_NAME) return
      const patch = bulkPatch('owner', value)
      if (patch === null) return
      // Announced BEFORE the await: the optimistic apply has already landed by
      // the time this returns, and a screen-reader user should hear the change
      // at the same moment a sighted one sees it. A failure toasts from the
      // store and rolls the row back.
      const name = value === OWNER_NONE ? null : (memberMapRef.current.get(value)?.displayName ?? null)
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
   * Sequential rather than parallel, for the reason store/entries.bulkCreate
   * gives: twenty simultaneous requests is twenty sessions' worth of load from
   * one click, and nothing here is faster for it.
   *
   * Partial success is REPORTED, not rolled back — discarding nine accepted
   * writes because the tenth failed is a worse outcome than saying which failed.
   * The rows that failed stay selected, so the retry is one more click.
   */
  const applyBulk = useCallback(
    async (kind: BulkKind, value: string): Promise<void> => {
      if (busy) return
      const patch = bulkPatch(kind, value)
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
      let done = 0
      let queued = 0
      const failedIds: string[] = []
      for (const id of ids) {
        const result = await patchEntry(id, patch)
        if (result.ok) {
          done += 1
        } else if (result.error === QUEUED_ERROR_KEY) {
          // Outstanding, not failed: the outbox replays it on reconnect.
          queued += 1
          done += 1
        } else {
          failedIds.push(id)
        }
      }
      setBusy(false)

      const failed = failedIds.length
      // Exactly one sentence for the run. The store also toasts each individual
      // failure — see the handoff's extension-slot note asking for a `silent`
      // option on patchEntry — so this is the summary above that noise, not
      // instead of it.
      if (failed === 0 && queued > 0) toast(t('tree.bulkQueued', { count: queued }))
      else if (failed === 0) toast(t('tree.bulkDone', { count: done }), { tone: 'success' })
      else if (done === 0) toast(t('tree.bulkFailed', { count: failed }), { tone: 'error' })
      else toast(t('tree.bulkPartial', { done, failed }), { tone: 'error' })

      setSelected(new Set(failedIds))
      anchorRef.current = null
    },
    [busy, selected],
  )

  // ── row plumbing ─────────────────────────────────────────────────────────

  const handleOpen = useCallback((id: string) => {
    // The tree's own order as the sibling list, so the sheet's prev/next walks
    // what the reader is looking at rather than the store's canonical ordering.
    // store/entrySheet takes the list from the caller precisely for this.
    openEntry(id, { list: flatRef.current })
  }, [])

  const canEdit = useCallback(
    (entry: Entry) => canEditEntry(entry, meId, role),
    [meId, role],
  )

  // ── render ───────────────────────────────────────────────────────────────

  const filtered = !isFilterEmpty(filter) || unassignedOnly
  const showEmpty = !loading && errorKey === null && nodes.length === 0
  const selectedCount = selected.size

  const renderNode = (node: TreeNode): ReactElement => {
    const open = !collapsed.has(node.key)
    const total = node.entries.length
    const picked = node.entries.reduce((n, e) => (selected.has(e.id) ? n + 1 : n), 0)

    return (
      <li
        key={node.key}
        className="tree-node track-bar"
        style={node.vars}
        data-open={open ? 'true' : undefined}
        data-residual={node.residual ? 'true' : undefined}
      >
        <div className="tree-node-head">
          {/* Outside the toggle button: a checkbox inside a <button> is invalid
              HTML, and nesting it there would make every attempt to tick it
              fold the node instead. */}
          <TriCheckbox
            className="tree-check tree-check-node"
            checked={total > 0 && picked === total}
            indeterminate={picked > 0 && picked < total}
            disabled={total === 0}
            label={t('tree.selectTrack', { track: node.label })}
            onToggle={(on) => toggleNodeSelection(node, on)}
          />
          <button
            type="button"
            className="tree-node-toggle"
            aria-expanded={open}
            onClick={() => toggleNode(node.key)}
          >
            <IconChevronDown size={16} className="tree-caret" />
            {/* aria-hidden: TrackDot labels itself for a standalone mark, and
                inside a button that label would be read a second time in front
                of the name the button already carries. */}
            <span className="tree-node-mark" aria-hidden="true">
              <TrackDot trackId={node.key === NO_TRACK ? null : node.key} variant="glyph" />
            </span>
            <span className="tree-node-name">{node.label}</span>
            <span className="pill tree-count tabular">{t('tree.countOpen', { count: total })}</span>
            {/* Suppressed under the unassigned-only view, where it can only ever
                repeat the open count back at the reader. */}
            {node.unassigned > 0 && !unassignedOnly ? (
              <span className="pill warn tree-count tabular">
                {t('tree.countUnassigned', { count: node.unassigned })}
              </span>
            ) : null}
            {node.breached > 0 ? (
              <span className="pill danger tree-count tabular">
                {t('tree.countBreached', { count: node.breached })}
              </span>
            ) : null}
            {node.residual ? (
              <span className="pill tree-archived" title={t('tree.archivedHint')}>
                {t('tree.archived')}
              </span>
            ) : null}
          </button>
        </div>

        {open ? (
          total === 0 ? (
            <div className="tree-clear">
              {filtered ? (
                <p className="tree-clear-title">{t('tree.noMatch')}</p>
              ) : (
                <>
                  <p className="tree-clear-title">{t('tree.allClear')}</p>
                  <p className="tree-clear-hint">{t('tree.allClearHint')}</p>
                </>
              )}
            </div>
          ) : (
            <ul className="tree-rows">
              {node.entries.map((entry) => (
                <TreeRow
                  key={entry.id}
                  entry={entry}
                  health={healthMap.get(entry.id)}
                  members={members}
                  memberMap={memberMap}
                  canEdit={canEdit(entry)}
                  selected={selected.has(entry.id)}
                  onToggle={toggleRow}
                  onOpen={handleOpen}
                  onOwner={setRowOwner}
                />
              ))}
            </ul>
          )
        ) : null}
      </li>
    )
  }

  return (
    <div
      className="tree"
      ref={treeRef}
      data-picking={selectedCount > 0 ? 'true' : undefined}
      style={
        bulkHeight > 0 ? ({ '--tree-bulk-h': `${bulkHeight}px` } as CSSProperties) : undefined
      }
    >
      <p className="tree-sub">{t('tree.subtitle')}</p>

      <FilterBar
        value={filter}
        onChange={setFilter}
        facets={TREE_FACETS}
        tags={tagOptions}
        count={entries.length}
        resultLabel={(n) => t('tree.total', { count: n })}
        tagHint={t('tree.tagHint')}
      />

      <div className="tree-bar">
        <button
          type="button"
          className="chip tree-unassigned"
          aria-pressed={unassignedOnly}
          onClick={toggleUnassigned}
        >
          {t('tree.unassignedOnly')}
        </button>

        <div className="chip-row tree-folds">
          <button
            type="button"
            className="btn btn-sm btn-ghost tree-fold"
            onClick={allCollapsed ? expandAll : collapseAll}
          >
            {allCollapsed ? t('tree.expandAll') : t('tree.collapseAll')}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost tree-fold"
            onClick={() => void refreshEntries()}
          >
            {t('tree.refresh')}
          </button>
        </div>
      </div>

      <p className="tree-hint">{t('tree.hint')}</p>
      {truncated ? (
        <p className="tree-hint tree-hint-warn">{t('tree.truncated')}</p>
      ) : null}

      {/* Polite, not assertive: an assignment run announces once per row, and
          assertive would interrupt a screen-reader user mid-sentence. */}
      <p className="sr-only" role="status" aria-live="polite">
        <span key={announcement.seq}>{announcement.text}</span>
      </p>

      {errorKey !== null ? (
        <div className="card tree-error" role="alert">
          <p className="tree-error-title">{t('tree.errLoad')}</p>
          <p className="muted">{t(errorKey)}</p>
          <button type="button" className="btn btn-sm" onClick={() => void refreshEntries()}>
            {t('common.retry')}
          </button>
        </div>
      ) : null}

      {loading && nodes.length === 0 ? (
        <div className="tree-skeleton" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="tree-node tree-node-skeleton track-bar">
              <Skeleton height={18} width="42%" />
              <Skeleton height={54} count={2} radius={8} />
            </div>
          ))}
        </div>
      ) : showEmpty ? (
        <EmptyState
          icon={<IconLayers size={30} />}
          title={filtered ? t('tree.emptyFiltered') : t('tree.empty')}
          description={filtered ? t('tree.emptyFilteredHint') : t('tree.emptyHint')}
          action={
            filtered ? (
              <button
                type="button"
                className="btn btn-sm"
                // Wipes the whole query string, unassigned flag included —
                // wider than FilterBar's own clear-all, which only owns its
                // facets. This is the dead-end escape hatch: the mode is one of
                // the things that emptied the screen, so leaving it on would
                // hand back the same empty screen.
                onClick={() => {
                  setParams(new URLSearchParams(), { replace: true })
                }}
              >
                {t('filter.clearAll')}
              </button>
            ) : undefined
          }
        />
      ) : (
        <ul className="tree-nodes" aria-label={t('tree.trackTree')}>
          {nodes.map(renderNode)}
        </ul>
      )}

      {selectedCount > 0 ? (
        <div className="tree-bulk" ref={registerBulk} role="region" aria-label={t('tree.bulkTitle')}>
          <p className="tree-bulk-count tabular" aria-live="polite">
            {t('tree.selected', { count: selectedCount })}
          </p>

          {/* The first option is the label AND the placeholder: a floating bar
              has no room for a caption above every control, and a select that
              reads "Assign to" collapsed is clearer than one reading "Choose…"
              beside two identical siblings. */}
          <select
            className="select tree-bulk-select"
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
            className="select tree-bulk-select"
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
            className="select tree-bulk-select"
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

          {busy ? <span className="tree-bulk-busy">{t('tree.bulkBusy')}</span> : null}

          <button
            type="button"
            className="btn btn-sm btn-ghost tree-bulk-clear"
            onClick={clearSelection}
          >
            {t('tree.bulkClear')}
          </button>
        </div>
      ) : null}
    </div>
  )
}

/* ────────────────────────────── row ────────────────────────────── */

interface TreeRowProps {
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
 * One entry as a tree row: a checkbox, the kit's EntryRow, and the owner select.
 *
 * The two per-entry store subscriptions live HERE rather than in EntryRow,
 * because the kit's connectedness rule (plan §2.5) forbids a row reading
 * store/entries: two hundred rows each subscribing to the LIST would re-render
 * the whole tree on one realtime patch. `usePendingOp` and `useEntryFlash` are
 * the narrow per-id selectors published for exactly this case — a Map lookup, so
 * only the row whose value changed re-renders. BoardCard does the same, for the
 * same reason.
 *
 * memo() with reference-stable props is what keeps a selection change cheap:
 * ticking one row changes `selected` on one row.
 */
const TreeRow = memo(function TreeRow({
  entry,
  health,
  members,
  memberMap,
  canEdit,
  selected,
  onToggle,
  onOpen,
  onOwner,
}: TreeRowProps): ReactElement {
  // SUBSCRIBED TO THE LOCALE, because this row calls t() directly and memo()
  // would otherwise never re-run it. Every prop above is reference-stable
  // across a language switch — the entry and health come from the store, the
  // members from theirs, `selected` is a boolean and the three callbacks have
  // no locale in their deps — so the shallow compare passes and the row keeps
  // its previous-language strings. The <EntryRow> child does subscribe, but the
  // owner <select> reaches it as a pre-built element, and React's identity
  // bailout means that subtree is not re-rendered either: the amber
  // "Unassigned" option on exactly the rows this screen exists to fix would
  // stay in the old language. lib/labels.ts's header names this hazard.
  useLocale()
  const pending = usePendingOp(entry.id)
  const flash = useEntryFlash(entry.id)

  const value = ownerValueOf(entry)
  const unassigned = value === OWNER_NONE
  // An owner_id pointing at a profile that is gone (or has not loaded yet) would
  // otherwise select nothing at all and render a blank control on a row that
  // does have an owner — an empty select reads as "unassigned", which is a lie
  // about the data and a trap for the next person to touch it.
  const orphan = entry.owner_id !== null && !memberMap.has(entry.owner_id)

  return (
    // `data-entry` is how the bulk bar's Clear finds this row's checkbox to
    // hand focus back to — see clearSelection().
    <li className="tree-row" data-entry={entry.id} data-selected={selected ? 'true' : undefined}>
      <TriCheckbox
        className="tree-check"
        checked={selected}
        disabled={!canEdit}
        label={t('tree.selectRow', { title: entry.title })}
        title={canEdit ? undefined : t('entry.cannotEdit')}
        onToggle={(_on, shift) => onToggle(entry.id, shift)}
      />
      <div className="tree-row-body">
        <EntryRow
          entry={entry}
          health={health}
          density="compact"
          // owner: the select below IS the owner control — see the file header.
          // track: the node heading already said which one.
          show={{ owner: false, track: false }}
          flash={flash}
          pending={pending}
          canEdit={canEdit}
          onOpen={onOpen}
          actions={
            <select
              className="select tree-owner"
              data-unassigned={unassigned ? 'true' : undefined}
              value={value}
              disabled={!canEdit}
              title={canEdit ? undefined : t('entry.cannotEdit')}
              aria-label={t('tree.ownerFor', { title: entry.title })}
              onChange={(ev) => onOwner(entry, ev.target.value)}
            >
              <option value={OWNER_NONE}>{t('entry.unassigned')}</option>
              {orphan && entry.owner_id !== null ? (
                <option value={entry.owner_id}>{t('tree.unknownOwner')}</option>
              ) : null}
              {/* A free-text owner is shown, never silently overwritten. It is a
                  source value only; the entry sheet's OwnerPicker is where a new
                  external name is typed. */}
              {value === OWNER_NAME && entry.owner_name !== null ? (
                <option value={OWNER_NAME}>{entry.owner_name}</option>
              ) : null}
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

/* ─────────────────────────── checkbox ─────────────────────────── */

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
 * should rest on. Reading the modifier from the event that actually carries it
 * is one line and cannot rot.
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
