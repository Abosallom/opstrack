// THE MODEL LAYER — every store this screen reads, the inputs it folds them
// into, the one `buildMindtree` call, and the three derivations that hang off
// the resulting tree: the rolled-up counts, the per-node view models, and the
// summary sentences.
//
// Extracted from pages/Mindtree.tsx unchanged. It computes no policy:
// lib/mindtree/model.ts owns the tree, and what is here is the wiring that
// decides what to hand it.
//
// EVERY PERSISTED CHOICE LIVES IN `store/mindtree.ts`, under the SAME
// localStorage key the page used to own (`opstrack_mindtree_v1`). It was moved
// rather than duplicated, and the difference matters: two modules validating one
// key is two schemas that drift, and the store's version is strictly the better
// one — it bounds the persisted arrays (a hand-edited blob cannot make the first
// paint interesting), it keeps unknown dimension keys instead of destroying a
// newer build's state, and it clears on sign-out, which a module-level
// `readPrefs()` in a page could never do.
//
// WHAT IT DOES NOT DO. It reads the entries store like every other screen and
// never runs its own query, so PostgREST's 1000-row clamp is honoured by
// inheritance and the truncation notice is the store's own flag. It picks no
// colour: every hue arrives as the `--track-c-*` pair the model stapled on.

import { useCallback, useEffect, useMemo } from 'react'
import type { MindNodeView } from '../../components/mindtree/MindNode'
import { isolate } from '../../lib/bidi'
import type { FilterState } from '../../lib/entryFilter'
import { t } from '../../lib/i18n'
import { useTrackLabel } from '../../lib/labels'
import {
  MIND_DIMENSIONS,
  ROOT_ID,
  buildMindtree,
  groupTotals,
  type MindLabel,
  type MindNode as MindNodeModel,
  type MindTrack,
  type MindVocabOption,
} from '../../lib/mindtree/model'
import {
  loadEntries,
  loadTrackSlas,
  useEntriesError,
  useEntriesLoading,
  useEntriesLoadedOnce,
  useEntriesTruncated,
  useEntryList,
  useEntryMap,
  useFilterContext,
  useHealthMap,
} from '../../store/entries'
import {
  useMindCollapsedIds,
  useMindDensity,
  useMindDimension,
  useMindExpandedIds,
  useMindFocus,
  useMindHoveredId,
  useMindIsDragging,
  useMindSelection,
  useMindSelectionCount,
  useMindView,
} from '../../store/mindtree'
import { useTracks } from '../../store/config'
import { useMemberMap, useMembers, memberLabel } from '../../store/members'
import { useVocabAll, useVocabLabel } from '../../store/vocab'
import { useAuth } from '../../store/auth'
import type { UserRole } from '../../types'

/* ───────────────────────────────── the tree ──────────────────────────────── */

/** The two counts the model does not carry, derived once for both views. */
export interface NodeStats {
  breached: number
  unassigned: number
}

export const NO_STATS: NodeStats = Object.freeze({ breached: 0, unassigned: 0 })

/**
 * Roll `breached` and `unassigned` up the tree, in one post-order pass.
 *
 * The model carries `slaBreached` as a BOOLEAN on every branch — deliberately,
 * because the map's budget is a binary mark and "3 breached" is a number the
 * table carries. Both accessible names need the number, so it is counted here,
 * once, and handed to the picture and the table together. Two passes would be
 * two arithmetics that disagree under exactly the conditions nobody tests.
 *
 * `unassigned` needs the Entry itself (the model deals in counts, not columns),
 * which is why `entryById` is threaded in rather than the whole working set:
 * the tree already decided which rows survived the filter.
 */
export function collectStats(
  node: MindNodeModel,
  entryById: ReadonlyMap<string, unknown>,
  isUnassigned: (id: string) => boolean,
  out: Map<string, NodeStats>,
): NodeStats {
  if (node.kind === 'entry') {
    const id = node.entryId
    const stats: NodeStats = {
      breached: node.health.slaBreached ? 1 : 0,
      unassigned: id !== null && entryById.has(id) && isUnassigned(id) ? 1 : 0,
    }
    out.set(node.id, stats)
    return stats
  }
  let breached = 0
  let unassigned = 0
  for (const child of node.children) {
    const stats = collectStats(child, entryById, isUnassigned, out)
    breached += stats.breached
    unassigned += stats.unassigned
  }
  const stats: NodeStats = { breached, unassigned }
  out.set(node.id, stats)
  return stats
}

/** One frozen empty set, so the memo below has a stable reference to return. */
const EMPTY_IDS: ReadonlySet<string> = new Set<string>()

/**
 * The ring the map opens at: root + tracks, every track closed.
 *
 * See model.ts's `openDepth` for the arithmetic. The short version is that the
 * canvas is bound on the BLOCK axis — a tidy tree stacks every visible node
 * down it — so ring 2 costs one row per populated track × group cell, and
 * thirty of those do not fit above 0.31. Six track cards do, at 1:1.
 */
const OPEN_DEPTH = 1

/**
 * INFERRED, not declared. Every field here is a store's own type and this hook
 * narrows none of them; writing the shape by hand would be a second copy of
 * eight stores' signatures, and the first place a `Member` or a `FilterContext`
 * would drift from the module that owns it.
 */
export type MapModel = ReturnType<typeof useMapModel>

export function useMapModel(compact: boolean, locale: string, filter: FilterState) {
  /* ── the persisted half, from the store ───────────────────────────────── */

  const dimension = useMindDimension()
  const view = useMindView()
  const density = useMindDensity()
  const focusPref = useMindFocus()
  const collapsedPref = useMindCollapsedIds()
  const expandedIds = useMindExpandedIds()

  /* ── the session half, which is the ADDRESS BAR's ─────────────────────── */
  //
  // THE FILTER IS A PARAMETER, NOT STATE. It is read from the URL by
  // `useMapUrlFilter`, which the shell calls before this hook for exactly this
  // reason: a `useState` copy here is a second writer of one value, and while
  // it held one the map was the only filtering screen in the app whose filter
  // did not survive a reload or a paste.

  const entries = useEntryList()
  const health = useHealthMap()
  const entryById = useEntryMap()
  const tracks = useTracks()
  const members = useMembers()
  const memberById = useMemberMap()
  const ctx = useFilterContext()
  const loading = useEntriesLoading()
  const error = useEntriesError()
  const truncated = useEntriesTruncated()
  /**
   * Has the working set landed once? Gates the drill-in reconciler in
   * useMapFocus — see there, and `store/entries.useEntriesLoadedOnce` for why
   * `!loading` is not the same question.
   */
  const entriesLoaded = useEntriesLoadedOnce()
  const trackLabelOf = useTrackLabel()
  const vocabLabelOf = useVocabLabel()
  const { profile } = useAuth()
  /**
   * `null`, never a stand-in id — pages/Board.tsx's rule, restated because the
   * consequence here is a drag rather than a card: `canEditEntry` tests the
   * signed-out case FIRST and answers false, which is what keeps a leaf
   * un-liftable in the moment between mount and the profile arriving. A
   * placeholder would satisfy the open branch's `!!meId` and hand out a gesture
   * the server would then refuse.
   */
  const meId = profile?.id ?? null
  const role: UserRole = profile?.role ?? 'member'

  const hoveredId = useMindHoveredId()
  const selection = useMindSelection()
  const selectionCount = useMindSelectionCount()
  const dragging = useMindIsDragging()

  // Both are read unconditionally — hooks cannot be called in a branch — and
  // the active one is picked below. `useVocabAll`, not `useVocab`: the hidden
  // options matter here, because an entry still holding a retired status must
  // land in its own branch rather than arriving as an undeclared value.
  const statusVocab = useVocabAll('status')
  const priorityVocab = useVocabAll('priority')

  useEffect(() => {
    void loadEntries()
    // Deduped in the store: the Shell warms both on sign-in, and a second call
    // from a screen that genuinely needs them costs nothing.
    void loadTrackSlas()
  }, [])

  /* ── inputs to the model ──────────────────────────────────────────────── */

  const mindTracks = useMemo<MindTrack[]>(
    () =>
      tracks.map((track) => ({
        id: track.id,
        // The localised name, never the raw column — lib/labels.trackLabel.
        label: trackLabelOf(track),
        color: track.color,
        colorLight: track.color_light,
        sortOrder: track.sort_order,
        archived: track.archived,
      })),
    [tracks, trackLabelOf],
  )

  const vocab = useMemo<readonly MindVocabOption[]>(() => {
    // Owner and health have no vocabulary: the roster and the four computed
    // levels are the axis, and model.ts takes an empty list for both.
    if (dimension === 'status') return statusVocab
    if (dimension === 'priority') return priorityVocab
    return []
  }, [dimension, statusVocab, priorityVocab])

  /**
   * The filter as the model sees it: SCOPE PINNED OPEN.
   *
   * Pinned here rather than held in `filter` itself, and the difference is not
   * cosmetic — `countActiveFacets()` counts a non-default scope as a facet the
   * reader chose, so holding it in state would make the filter bar claim "1
   * filter" on a screen nobody has filtered, and its Clear-all would then reset
   * the scope and change what the map is about. pages/Dashboard.tsx pins the
   * other direction for the same reason.
   *
   * Open, not all: "the shape of my workload" is a question about work that is
   * still work. Closed items belong to the dashboard's throughput panels.
   */
  const applied = useMemo<FilterState>(() => ({ ...filter, scope: 'open' }), [filter])

  /**
   * COLLAPSE IS MEANINGLESS ON A PHONE, and passing it through anyway is a
   * bug rather than a harmless no-op. The small screen draws ONE ring at a time
   * and every tap drills rather than expands, so there is nothing to collapse —
   * but a branch the reader closed on a desktop is still in this list, and
   * `layoutMindtree` honours `collapsed` as well as `depthLimit`. Drilling into
   * such a track would draw the track and nothing under it: a blank ring with
   * no control on the screen able to un-blank it.
   */
  const collapsedIds = compact ? EMPTY_IDS : collapsedPref

  /**
   * How many leaves a group shows before the tail folds behind "+N more".
   *
   * Tighter on a phone for the obvious reason and because the drill-in is the
   * small-screen path anyway; on a desktop six is where a group stops reading
   * as a shape and starts reading as a list, which is /tracks' job.
   */
  const leafThreshold = compact ? 3 : 6

  const tree = useMemo(
    () =>
      buildMindtree({
        entries,
        health,
        tracks: mindTracks,
        // ⚠ WAVE A INTERIM, AND THE ONE PRODUCTION CALL SITE. An empty list
        // reproduces today's four-ring tree exactly — which is the invariant this
        // wave is gated on — but it also means the hierarchy never renders. The
        // map-node store is Wave B; when it lands, this becomes its list, or
        // every Org Aziz enters stays invisible with nothing complaining.
        entities: [],
        vocab,
        members,
        dimension,
        filter: applied,
        ctx,
        collapsedIds,
        leafThreshold,
        expandedIds,
        // No default collapse on a phone: `depthLimit: 1` in useMapGeometry
        // already draws one ring, and a branch marked collapsed under it would
        // draw nothing.
        openDepth: compact ? undefined : OPEN_DEPTH,
      }),
    [
      entries,
      health,
      mindTracks,
      vocab,
      members,
      dimension,
      applied,
      ctx,
      collapsedIds,
      leafThreshold,
      expandedIds,
      compact,
    ],
  )

  const stats = useMemo(() => {
    const out = new Map<string, NodeStats>()
    const isUnassigned = (id: string): boolean => {
      const entry = entryById.get(id)
      if (entry === undefined) return false
      return entry.owner_id === null && (entry.owner_name ?? '').trim() === ''
    }
    collectStats(tree, entryById, isUnassigned, out)
    return out
  }, [tree, entryById])

  /* ── labels ───────────────────────────────────────────────────────────── */

  /**
   * A node's own text.
   *
   * The discriminated `MindLabel` is what makes this safe to write once: a
   * `key` label goes through t() and a `text` label — a track name, a person's
   * name, an entry title — never does. Handing database text to t() renders it
   * back verbatim (t() echoes an unknown key), so the bug would be invisible in
   * English and catastrophic in Arabic, where the untranslated string is the
   * one thing that had to keep its own direction.
   */
  const textOf = useCallback((label: MindLabel): string => {
    if (label.kind === 'key') return t(label.key, label.vars ? { ...label.vars } : undefined)
    const trimmed = label.text.trim()
    return trimmed === '' ? t('mindtree.untitled') : trimmed
  }, [])

  const dimensionLabel = t(
    MIND_DIMENSIONS.find((d) => d.key === dimension)?.labelKey ?? 'mindtree.dimStatus',
  )

  /**
   * One view model per node: the display label, the accessible name, the count
   * chip and the two tooltips.
   *
   * Built in a single walk rather than inside the node component, because a
   * filtered-to-everything workspace is several hundred nodes and every one of
   * them would otherwise re-resolve its own label on every pan frame. `locale`
   * is a dependency even though nothing below reads it directly: t() reads
   * lib/i18n's MODULE state, which React cannot watch, so without it here a
   * language switch would re-render the map around a memo full of English.
   */
  const views = useMemo(() => {
    const out = new Map<string, MindNodeView>()

    const sep = t('mindtree.listSep')

    /**
     * The chain of ancestor labels, isolated and joined — "Network, Blocked".
     *
     * It exists for the folds. A "+N more" node's accessible name used to be
     * `showMore` with its GROUP's label alone, which is not unique: "On track"
     * repeats under every track, so two folds hiding 8 items and 3 items shared
     * one byte-identical name and a screen-reader user listing the controls saw
     * the same button twice. Each component is isolated separately rather than
     * the joined string being isolated once, because the separator is the
     * locale's own comma and it belongs to the SENTENCE, not to either label.
     */
    const trail = (ancestry: readonly string[]): string =>
      ancestry.filter((text) => text !== '').map(isolate).join(sep)

    const visit = (node: MindNodeModel, ancestry: readonly string[]): void => {
      const raw = textOf(node.label)
      const stat = stats.get(node.id) ?? NO_STATS

      let name: string
      if (node.kind === 'entry') {
        const entry = node.entryId === null ? undefined : entryById.get(node.entryId)
        const detail: string[] = []
        if (entry !== undefined) {
          // Rendered directly from the live vocabulary, so an admin's rename
          // reaches this sentence with zero writes — the frozen-key payoff.
          detail.push(vocabLabelOf('status', entry.status))
          const owner = memberLabel(memberById, entry.owner_id, entry.owner_name)
          if (entry.owner_id !== null || (entry.owner_name ?? '').trim() !== '') {
            detail.push(t('mindtree.leafOwner', { owner }))
          }
        }
        if (node.health.slaBreached) detail.push(t('mindtree.leafBreached'))
        name = t('mindtree.leafName', { title: raw, detail: detail.join(sep) })
      } else if (node.kind === 'more') {
        // THE VISIBLE LABEL LEADS, then the action. `raw` is "+8 more items",
        // which is what the reader can see and therefore what a voice-control
        // user will say (WCAG 2.5.3, Label in Name) and what carries the count;
        // the `showMore`/`showFewer` clause says what pressing Enter does and
        // names the ancestry that makes this fold different from the other four
        // on screen. The first cut had the action alone, and dropped all three.
        name = t('mindtree.nodeName', {
          label: raw,
          detail: node.collapsed
            ? t('mindtree.showMore', { label: trail(ancestry) })
            : t('mindtree.showFewer', { label: trail(ancestry) }),
        })
      } else {
        const detail = [t('mindtree.countOpen', { count: node.count })]
        if (stat.breached > 0) detail.push(t('mindtree.countBreached', { count: stat.breached }))
        if (stat.unassigned > 0) {
          detail.push(t('mindtree.countUnassigned', { count: stat.unassigned }))
        }
        // Nothing about expansion is appended: `aria-expanded` on the treeitem
        // already announces it, and a name that repeated it would say it twice.
        name = t('mindtree.nodeName', { label: raw, detail: detail.join(sep) })
      }

      out.set(node.id, {
        // Isolated for DISPLAY only. The accessible names above pass `raw`,
        // because the locale templates isolate their own interpolations —
        // `"⁨{label}⁩, {detail}"` — and isolating twice would nest two runs
        // around one value for no benefit.
        label: isolate(raw),
        name,
        count: node.kind === 'entry' ? null : String(node.count),
        toggleHint:
          node.children.length === 0
            ? null
            : node.collapsed
              ? t('mindtree.expandNode', { label: raw })
              : t('mindtree.collapseNode', { label: raw }),
        breachHint: node.health.slaBreached ? t('mindtree.breachHint') : null,
      })

      // The root is the workspace and adds nothing to a fold's ancestry, so it
      // seeds an empty trail rather than "NphiesCore, Network, Blocked".
      const below = node.kind === 'root' ? [] : [...ancestry, raw]
      for (const child of node.children) visit(child, below)
    }

    visit(tree, [])
    return out
    // `locale` is a dependency the rule cannot see the use of, and the same
    // one store/entries.ts and MindtreeTable.tsx suppress for the same reason:
    // every t() above reads lib/i18n's MODULE-level current locale rather than
    // an argument, so without it here a language switch would re-render the map
    // around a memo still holding English labels.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, stats, entryById, memberById, vocabLabelOf, textOf, locale])

  /* ── the summary, which is also the export's description ──────────────── */

  const summary = useMemo(() => {
    const rootStats = stats.get(ROOT_ID) ?? NO_STATS
    // `count` is the TRACK count: it is the only noun in this sentence that
    // inflects ("1 track" / "6 tracks"), and selectPlural reads vars.count and
    // nothing else. The open and breached totals ride as {open}/{breached},
    // which sit beside adjectives rather than nouns in both languages.
    return t('mindtree.summary', {
      count: tree.children.length,
      open: tree.count,
      breached: rootStats.breached,
    })
  }, [stats, tree])

  const busiest = useMemo(() => {
    let top: MindNodeModel | null = null
    for (const child of tree.children) if (top === null || child.count > top.count) top = child
    if (top === null || top.count === 0) return null
    return t('mindtree.summaryTop', { track: textOf(top.label), count: top.count })
  }, [tree, textOf])

  /**
   * The biggest ring-2 bucket ACROSS every track — the sentence the picture
   * cannot draw.
   *
   * Ring 2 is nested inside ring 1, so with `Group by = Owner` a person working
   * across four tracks is four nodes and four numbers, and "who is overloaded"
   * — one of the three questions MINDTREE-SPEC names — is a sum the reader has
   * to do by eye. Nesting is right for the map; this is the one number that
   * cannot be recovered from it, so it is stated. The table carries the whole
   * ranking (`MindtreeTable`'s second block).
   *
   * Suppressed under a single track, where it is the same fact as the map.
   */
  const topGroup = useMemo(() => {
    if (tree.children.length < 2) return null
    const totals = groupTotals(tree)
    const top = totals[0]
    if (top === undefined || top.count === 0) return null
    return t('mindtree.summaryGroup', { label: textOf(top.label), count: top.count })
  }, [tree, textOf])

  /* ── the shared tag vocabulary ────────────────────────────────────────── */

  const tags = useMemo(() => {
    const held = new Set<string>()
    for (const entry of entries) for (const tag of entry.tags) held.add(tag)
    return [...held].sort((a, b) => a.localeCompare(b, locale))
  }, [entries, locale])

  return {
    dimension,
    view,
    density,
    focusPref,
    expandedIds,
    entries,
    entryById,
    tracks,
    members,
    memberById,
    ctx,
    loading,
    error,
    truncated,
    entriesLoaded,
    vocabLabelOf,
    statusVocab,
    priorityVocab,
    meId,
    role,
    hoveredId,
    selection,
    selectionCount,
    dragging,
    tree,
    stats,
    views,
    textOf,
    dimensionLabel,
    summary,
    busiest,
    topGroup,
    tags,
  }
}
