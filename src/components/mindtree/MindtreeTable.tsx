// The Mindtree as a TABLE — the same question, answered without a picture.
//
// NOT A FALLBACK. The map answers "what is the SHAPE of my workload?" by size
// and position; this answers it by number. Both are first-class, and the two
// audiences are real: a screen-reader user who cannot see a node grow, and an
// ops lead who has to paste the answer into an email at 07:40 where a PNG is
// either stripped by the mail client or unreadable on a phone. A "view as
// table" that carried fewer facts than the picture would fail both of them —
// so every number here is taken from the SAME `MindNode` tree the map draws
// (lib/mindtree/model.ts), never recomputed from the working set. Two
// arithmetic paths to one screen is how a branch ends up labelled 12 while its
// table row says 9.
//
// ONE ROW PER `group` NODE, AT ANY DEPTH, and that is the whole design
// decision. The first column is the PATH to that bucket, not a track:
//
//   Path                Group        Open  Unassigned  Past deadline  Age
//   Network             Blocked         2           1              1  31d
//   Network             New             3           3              0   4d
//   UHR, OB, Org1       In progress     8           0              2  12d
//
// The separator is `mindtree.listSep` — the locale's own comma, and the same
// one useMapModel's `trail()` joins a node's ancestry with, so the picture and
// the table punctuate a path identically in both languages.
//
// IT USED TO BE "one row per track × group", which was a two-level assumption
// baked into `buildRows` back when the map was a fixed four-ring tree. The
// hierarchy is arbitrary-depth now — a programme holds phases, a phase holds
// organizations — and a two-level walk would find no groups beneath an Org and
// drop every one of its buckets off the table. That breaks the guarantee three
// paragraphs above (the table would carry FEWER facts than the picture) and it
// breaks the footer, which reconciles the row totals against the root's own
// count. So the walk recurses, the first column accumulates the trail, and an
// Org with nothing on it still gets its "all clear" row for exactly the reason
// an empty track always did.
//
// The map's ring 3 (the entries) is deliberately NOT a third level of rows. A
// row per entry turns a 40-item workspace into a 40-row wall whose numeric
// columns are all 1 or 0 — a list, and /tracks is already the list. What the
// shape question needs is the CELL: how much sits at this intersection, how
// much of it is unclaimed, how much has blown its commitment, and how long the
// oldest thing there has been alive. The entries are still reachable: a cell
// holding exactly one item opens it, and a cell holding many narrows the page's
// shared filter down to itself (see `filterForCell`). Nothing is hidden, and
// the numbers still roll up to the same total the root node carries.
//
// THE TREE IS WALKED WITH `collapsed` IGNORED, on purpose. model.ts's moreNode
// header states the contract from the other side: a "+5 more" keeps its
// children so that "the rows behind the fold" are still in the table. A table
// that only counted what the picture happened to be showing would report a
// different total every time somebody clicked a branch.
//
// COLUMNS ARE SORTABLE BY REAL <button> HEADERS, with `aria-sort` on the <th>.
// The button's accessible name is the column label and nothing else — the sort
// STATE lives in aria-sort, which is the one place assistive tech looks for it,
// and duplicating it into the name ("Open, sorted descending") would announce
// the state twice and go stale the moment a second column is clicked. The third
// click on a column returns to `null`, which is the tree's own reading order —
// track `sort_order` then the vocabulary's order — so the reader can always get
// back to the order the picture is drawn in.
//
// NO CLOCK AND NO STORE READ. `today` arrives as a prop (the page has it from
// `useFilterContext()`), the entries arrive as a map, and the tree arrives
// built. That keeps every number here a pure function of its inputs, which is
// what makes the row builder testable without a DOM, a timer or a mock.
//
// COLOUR COMES FROM `node.colourVars` — the `trackVars()` custom-property pair
// — and never from a hex chosen here. lib/trackStyle.ts's header has the
// argument: a colour picked in JavaScript is picked once, at render, and keeps
// yesterday's value when the `auto` theme flips at sunset.

import { useCallback, useId, useMemo, useState, type CSSProperties, type ReactElement } from 'react'
import { isolate } from '../../lib/bidi'
import { diffDays, formatAge, instantToIsoDate, type IsoDate } from '../../lib/dates'
import { t, useLocale, type Locale } from '../../lib/i18n'
// The generic half of this file's sort, extracted so the portfolio table reuses
// the cycle rather than growing a second one that disagrees on the third click.
// `nextSort` is re-exported below under its own name — see the wrapper.
import {
  ariaSort,
  compareText,
  nextSort as nextSortState,
  sortRows,
  type SortableColumn,
  type SortDir,
  type TableSort,
} from '../../lib/mindtree/tableSort'
import {
  MIND_DIMENSIONS,
  groupTotals,
  type MindDimension,
  type MindLabel,
  type MindNode,
} from '../../lib/mindtree/model'
import { openEntry as openEntryDefault } from '../../store/entrySheet'
import type { FilterState, OwnerFilter } from '../../lib/entryFilter'
import type { Entry, EntryPriority, EntryStatus, HealthLevel } from '../../types'

/**
 * The "no value" bucket key — the untracked pile, the unassigned owner. Mirrors
 * model.ts's private `NO_VALUE` and pages/Board.tsx's, deliberately: three
 * modules bucketing the same rows must agree on the key or they disagree about
 * who owns what.
 */
const NO_VALUE = ''

/** Free-text owner prefix. Mirrors model.ts's `NAME_PREFIX` and Board's. */
const NAME_PREFIX = 'name:'

/** An empty numeric cell. Not `0`: "no items" and "zero of them are late" are
 *  different facts, and a column of 0s hides which rows are which. */
const EM_DASH = '—'

/** How many columns the table has, for the footer's span. */
const COLUMN_COUNT = 6

// ── the row ────────────────────────────────────────────────────────────────

/**
 * One path × group cell, with everything the six columns need already
 * resolved. Exported because the page may want to feed the same rows to the
 * export, and because every assertion in the test file is about this shape.
 */
export interface MindtreeTableRow {
  /** The group node's own id — React key, and unique by construction (every
   *  dynamic segment of a node id is percent-encoded, so two buckets under two
   *  different Orgs cannot collide). An "all clear" row keys off its node. */
  key: string
  /** Position in the TREE's order, kept so every sort has a total tiebreak and
   *  so "no sort" can be restored without rebuilding. */
  order: number
  /** The track's bucket key — a track id, or `''` for the untracked pile.
   *  STILL THE TRACK, at every depth: `entries.track_id` is derived from the
   *  node by a trigger, so everything under an Org belongs to the Org's track
   *  and `filterForCell` has something it can actually express. */
  trackKey: string
  /**
   * The trail from the track down to this row's parent, one resolved label per
   * step, track first — `['UHR', 'OB', 'Org1']`. Kept as PARTS rather than as
   * one string because the renderer has to isolate each component separately
   * (useMapModel's `trail()` says why: the separator is the locale's own comma
   * and it belongs to the sentence, not to either label).
   */
  pathParts: readonly string[]
  /** Those parts joined with `mindtree.listSep` and NO isolates — the sort key,
   *  and the `{track}` the accessible name interpolates (the bundle owns the
   *  isolate there, and nesting one inside it would be two invisible controls
   *  around the same run). Never rendered raw: the cell isolates part by part. */
  pathLabel: string
  /**
   * The deepest STRUCTURAL node between the track and this row — an Org's
   * `map_nodes.id` — or null when the row sits directly under its track.
   *
   * READ BY `filterForCell`, which puts it in `FilterState.mapNodeIds` so a
   * drill-down lands on the set the cell counted rather than on the whole track
   * above it. It is `map_nodes.id` and not a label because that facet is matched
   * against `FilterContext.ancestryOfNode`, which is keyed on ids.
   */
  nodeKey: string | null
  /** `trackVars()`'s pair, straight off the TRACK node. Never a hex picked here.
   *  Every descendant of a track carries the same pair (model.ts inherits it),
   *  so a row under an Org reads in its programme's colour family. */
  trackVars: CSSProperties
  /**
   * ANY step of the path is retired — an archived track, or an archived Org
   * inside a live programme. Rendered, never dropped.
   *
   * It is the whole path rather than the track alone because the path is now
   * the unit the cell names: model.ts marks an archived entity that still holds
   * work `retired` for exactly the reason it marks an archived track (hiding an
   * option must never hide data, and a parent labelled 12 whose children sum to
   * 9 is worse than a greyed-out branch), and a table that showed the pill for
   * one and not the other would be silently under-reporting the second.
   */
  pathRetired: boolean
  /** The group's bucket key, or null when the track holds nothing at all. */
  groupKey: string | null
  /** The group's label, or the "all clear" line for an empty track. */
  groupLabel: string
  /** A hidden vocabulary option, or an owner the roster no longer explains. */
  groupRetired: boolean
  /** True when this row stands for a STRUCTURAL node with no buckets under it —
   *  a clear track, or an Org nobody has filed anything against yet. */
  empty: boolean
  /** Entries at this intersection, AFTER the page's filter. From the node. */
  count: number
  /** How many of them nobody owns — the most actionable number on the screen. */
  unassigned: number
  /** How many are past their track × priority SLA. */
  breached: number
  /** Days since the OLDEST of them was raised, or null for an empty cell. */
  oldestDays: number | null
  /** The entry id when the cell holds exactly one; null otherwise. */
  soleEntryId: string | null
  /** That entry's title, already fallen back to "Untitled" when it is blank. */
  soleTitle: string
}

export type MindtreeSortColumn = 'track' | 'group' | 'count' | 'unassigned' | 'breached' | 'age'

/** ALIASES, NOT SECOND DECLARATIONS. The shapes are tableSort's; naming them
 *  here keeps every existing import path and every existing annotation exactly
 *  as it was, while there stays one definition of what a sort is. */
export type MindtreeSortDir = SortDir
export type MindtreeSort = TableSort<MindtreeSortColumn>

/** A column of THIS table: tableSort's `{ key, numeric }` plus the label only
 *  this table has. Passed to `nextSort` unchanged — the shared cycle reads the
 *  two fields it declares and ignores the rest. */
interface ColumnDef extends SortableColumn<MindtreeSortColumn> {
  /** Written as a literal so lib/localeReach.test.ts can see it. */
  labelKey: string
  /** Numbers open DESCENDING (the biggest pile is the question), text ASCENDING. */
  numeric: boolean
}

/**
 * The six columns, in reading order.
 *
 * `dashboard.colAge` rather than a mindtree key of its own: it is the same
 * word, already translated, already reviewed, and a second "Age" string is a
 * second thing to keep in step. model.ts reuses `entry.noTrack` and `health.*`
 * across namespaces for the same reason.
 */
const COLUMNS: readonly ColumnDef[] = [
  // Still `colTrack` — "Track" — now that the column holds a PATH, because the
  // path's FIRST step is always the track and a heading that named the deepest
  // step instead would be wrong for every row that has only one. Renaming it is
  // a three-file locale change (en, ar, labelSections) that buys a better word
  // and nothing else; it is written up in the handoff rather than smuggled in
  // here, where a key this file cannot add to the bundles would render as its
  // own dot path.
  { key: 'track', labelKey: 'mindtree.colTrack', numeric: false },
  { key: 'group', labelKey: 'mindtree.colGroup', numeric: false },
  { key: 'count', labelKey: 'mindtree.colOpen', numeric: true },
  { key: 'unassigned', labelKey: 'mindtree.colUnassigned', numeric: true },
  { key: 'breached', labelKey: 'mindtree.colBreached', numeric: true },
  { key: 'age', labelKey: 'dashboard.colAge', numeric: true },
]

// ── building the rows ──────────────────────────────────────────────────────

/**
 * A node's label as text.
 *
 * The `key` variant goes through t(); the `text` variant is database text and
 * must NOT — model.ts's MindLabel header explains why the union is
 * discriminated rather than two optional fields (t() echoes an unknown key, so
 * an Arabic track name handed to it renders as itself and hides the bug).
 */
function labelText(label: MindLabel): string {
  return label.kind === 'key' ? t(label.key, label.vars) : label.text
}

interface CellStats {
  unassigned: number
  breached: number
  oldestDays: number | null
  soleEntryId: string | null
  leaves: number
}

/** True when nothing and nobody owns this row. Mirrors entryFilter's hasOwner. */
function isUnassigned(e: Entry): boolean {
  return e.owner_id === null && (e.owner_name ?? '').trim() === ''
}

/**
 * Walk every entry under a node — collapsed branches included, "+N more" tails
 * included — and total the three facts the tree does not already carry.
 *
 * The BREACH is read off the leaf node (`health.slaBreached`), not off a health
 * map passed in beside it: model.ts already resolved it there, and reading it
 * twice from two sources is how the map's breach mark and the table's breach
 * count come to disagree about the same item. The other two need the row
 * itself, because the tree carries a title and a count and deliberately nothing
 * else about an entry.
 *
 * An id the map does not explain contributes nothing rather than throwing. The
 * only way it happens is a tree built from a working set that has since been
 * pruned mid-render, and a missing row must cost that row its ownership fact,
 * not the whole screen.
 */
function collectStats(
  node: MindNode,
  entryById: ReadonlyMap<string, Entry>,
  today: IsoDate,
): CellStats {
  let unassigned = 0
  let breached = 0
  let oldestDays: number | null = null
  let firstEntryId: string | null = null
  let leaves = 0

  const walk = (n: MindNode): void => {
    if (n.kind === 'entry') {
      leaves += 1
      if (firstEntryId === null) firstEntryId = n.entryId
      if (n.health.slaBreached) breached += 1
      const entry = n.entryId === null ? undefined : entryById.get(n.entryId)
      if (entry !== undefined) {
        if (isUnassigned(entry)) unassigned += 1
        // Age is measured from the day the item was RAISED, matching the
        // dashboard's `ageDescCreated`. Not from last_activity_at: that is
        // SILENCE, which lib/health.ts keeps as a separate question, and an
        // item updated hourly for a month is not young.
        const age = Math.max(0, diffDays(instantToIsoDate(entry.created_at), today))
        if (oldestDays === null || age > oldestDays) oldestDays = age
      }
      return
    }
    // `children`, never visibleChildren(): see the file header. A collapsed
    // branch and an unopened "+N more" are still in the table.
    for (const child of n.children) walk(child)
  }
  walk(node)

  return { unassigned, breached, oldestDays, soleEntryId: leaves === 1 ? firstEntryId : null, leaves }
}

/**
 * Is this node part of the SHAPE of the map rather than a bucket, an item or a
 * fold — a track, an organization, whatever the hierarchy grows next?
 *
 * WRITTEN AS A NEGATIVE, and that is the point. model.ts's tree gains kinds as
 * the hierarchy gains levels (`entity`, for an Organization, is the first of
 * them), and a positive list of structural kinds would have to be edited in
 * step with it — the day a new one lands, a positive list silently stops
 * recursing into it and every bucket beneath it drops out of this table while
 * the picture beside it keeps drawing them. That is the exact failure the file
 * header's guarantee forbids, and it fails SILENTLY. The negative fails the
 * other way: an unknown kind is walked, and a walk that finds no groups under
 * it costs one "all clear" row and nothing else.
 */
function isStructural(node: MindNode): boolean {
  return node.kind !== 'group' && node.kind !== 'entry' && node.kind !== 'more'
}

/** The track half of a row, resolved once per track and carried down the walk.
 *  Every descendant inherits the SAME colour pair and the SAME track key —
 *  `entries.track_id` is derived from the node, so there is one filing axis. */
interface TrackRef {
  key: string
  vars: CSSProperties
}

/**
 * The tree, flattened to one row per `group` node at any depth.
 *
 * A STRUCTURAL NODE WITH NO BUCKETS still produces a row — one row, marked
 * `empty`. "Which track is clear?" is one of the questions this screen exists
 * to answer, and a track that simply vanished when its last item closed would
 * answer it by looking identical to a track nobody ever configured. The same
 * sentence now reads "which Org has nothing on it", which is the question the
 * onboarding hierarchy exists to answer, and model.ts draws structural nodes
 * whether or not they are populated for exactly this reason.
 *
 * THE RECURSION IS ONE PASS IN THE TREE'S OWN CHILD ORDER, not "groups first,
 * then children". A track can hold both — items filed at the track itself and
 * organizations beneath it — and reordering them here would make the table read
 * in an order the picture is not drawn in, which is the one thing `order` and
 * the third click on a sort header exist to preserve.
 *
 * PURE GIVEN THE ACTIVE LOCALE. The only impurity is `t()` for key-shaped
 * labels, which is what the memo below re-runs on a language switch.
 */
export function buildTableRows(
  root: MindNode,
  entryById: ReadonlyMap<string, Entry>,
  today: IsoDate,
): MindtreeTableRow[] {
  const rows: MindtreeTableRow[] = []
  const sep = t('mindtree.listSep')

  const walk = (
    node: MindNode,
    track: TrackRef,
    parts: readonly string[],
    nodeKey: string | null,
    retired: boolean,
  ): void => {
    // A blank step is dropped rather than rendered as an empty pair of isolates
    // and a stray comma — useMapModel's `trail()` filters for the same reason,
    // and doing it once here keeps the sort key and the visible cell agreeing
    // about how many steps the path has.
    const pathLabel = parts.filter((part) => part !== '').join(sep)
    let emitted = false

    for (const child of node.children) {
      if (child.kind === 'group') {
        const stats = collectStats(child, entryById, today)
        const sole = stats.soleEntryId
        rows.push({
          key: child.id,
          order: rows.length,
          trackKey: track.key,
          pathParts: parts,
          pathLabel,
          nodeKey,
          trackVars: track.vars,
          pathRetired: retired,
          groupKey: child.bucketKey ?? NO_VALUE,
          groupLabel: labelText(child.label),
          groupRetired: child.retired,
          empty: false,
          // Off the NODE, not off the walk: `count` is what the picture drew,
          // and the two must be the same number or the toggle changes the
          // answer.
          count: child.count,
          unassigned: stats.unassigned,
          breached: stats.breached,
          oldestDays: stats.oldestDays,
          soleEntryId: sole,
          soleTitle: sole === null ? '' : titleOf(sole, child, entryById),
        })
        emitted = true
        continue
      }

      if (!isStructural(child)) continue

      // A structural node's own bucket key is its map-node id; it inherits the
      // one above it only if it somehow has none, so `nodeKey` is always the
      // DEEPEST answer to "which Org is this row under".
      // `retired || child.retired` — the flag ACCUMULATES down the path: an
      // archived Org inside a live programme marks its own rows, and a live Org
      // under an archived track keeps its track's mark.
      walk(
        child,
        track,
        [...parts, labelText(child.label)],
        child.bucketKey ?? nodeKey,
        retired || child.retired,
      )
      emitted = true
    }

    if (emitted) return

    // Nothing under this node but (at most) bare leaves. In every shape model.ts
    // produces that means nothing at all — a node holding work holds buckets —
    // so the stats below are all zero and this is today's "All clear" row. They
    // are still COMPUTED rather than hard-coded, because a row that asserted
    // zero over a node that held something would be the one lie this table
    // cannot afford. `soleEntryId` stays null regardless: "All clear" is not the
    // name of an item, and a button offering to open one under that label would
    // be lying about what it does.
    const stats = collectStats(node, entryById, today)
    rows.push({
      key: `${node.id}|`,
      order: rows.length,
      trackKey: track.key,
      pathParts: parts,
      pathLabel,
      nodeKey,
      trackVars: track.vars,
      pathRetired: retired,
      groupKey: null,
      groupLabel: t('mindtree.branchEmpty'),
      groupRetired: false,
      empty: true,
      count: node.count,
      unassigned: stats.unassigned,
      breached: stats.breached,
      oldestDays: stats.oldestDays,
      soleEntryId: null,
      soleTitle: '',
    })
  }

  for (const track of root.children) {
    walk(
      track,
      { key: track.bucketKey ?? NO_VALUE, vars: track.colourVars },
      [labelText(track.label)],
      null,
      track.retired,
    )
  }

  return rows
}

/** The sole entry's title, from the row if we hold it and from the leaf label
 *  if we do not — falling back to "Untitled" rather than an empty control. */
function titleOf(id: string, group: MindNode, entryById: ReadonlyMap<string, Entry>): string {
  const stored = entryById.get(id)?.title.trim() ?? ''
  if (stored !== '') return stored
  const leaf = findLeaf(group, id)
  const fromLabel = leaf === null ? '' : labelText(leaf.label).trim()
  return fromLabel === '' ? t('mindtree.untitled') : fromLabel
}

function findLeaf(node: MindNode, entryId: string): MindNode | null {
  if (node.kind === 'entry') return node.entryId === entryId ? node : null
  for (const child of node.children) {
    const found = findLeaf(child, entryId)
    if (found !== null) return found
  }
  return null
}

// ── the second block: one row per group, across every track ────────────────

/**
 * A ring-2 bucket totalled across ring 1 — one person, one status, one health
 * level, summed over the whole workspace.
 */
export interface MindtreeGroupRow {
  key: string
  label: string
  /** Retired in every track that holds it. Rendered, never dropped. */
  retired: boolean
  count: number
  unassigned: number
  breached: number
}

/**
 * THE ANSWER THE MAP CANNOT DRAW, and the reason this block exists at all.
 *
 * Ring 2 sits inside ring 1, so with `Group by = Owner` a person working across
 * four tracks is four nodes carrying four numbers, and "who is overloaded" —
 * one of the three questions MINDTREE-SPEC names the feature for — is a sum the
 * reader does by eye. The big table above does not rescue it either: it is one
 * row per track × group, with only a grand total in the footer.
 *
 * The right long-term fix is to let the reader swap the ring order (dimension
 * as ring 1, track as ring 2); the layout and the model are already generic
 * over which bucket comes first, and the handoff proposes it. This is the
 * honest cheap one, and it is exact rather than approximate.
 *
 * `count` comes from `groupTotals()`, which reads the group NODES — the same
 * numbers the picture drew and the same numbers the cells above carry. The
 * other two are summed off the ROWS above for the same reason: one arithmetic
 * path per number, or the two tables on one screen disagree.
 *
 * IT INHERITS `groupTotals()`'s DEPTH, and that is why the depth fix belongs
 * there rather than here. The function used to walk exactly two levels, which
 * was the whole tree when it was written; with organizations between a track and
 * its buckets it now recurses, so this block reaches the same rows the table
 * above does. It is deliberately NOT reimplemented locally: useMapModel's
 * ranking sentence under the map reads the same function, and two
 * implementations of one ranking is precisely the split this file exists to
 * prevent.
 */
export function buildGroupRows(
  root: MindNode,
  rows: readonly MindtreeTableRow[],
): MindtreeGroupRow[] {
  const extra = new Map<string, { unassigned: number; breached: number }>()
  for (const row of rows) {
    if (row.groupKey === null) continue
    const held = extra.get(row.groupKey) ?? { unassigned: 0, breached: 0 }
    held.unassigned += row.unassigned
    held.breached += row.breached
    extra.set(row.groupKey, held)
  }
  return groupTotals(root).map((total) => {
    const held = extra.get(total.key)
    return {
      key: total.key,
      label: labelText(total.label),
      retired: total.retired,
      count: total.count,
      unassigned: held?.unassigned ?? 0,
      breached: held?.breached ?? 0,
    }
  })
}

// ── sorting ────────────────────────────────────────────────────────────────
//
// THE GENERIC HALF LIVES IN lib/mindtree/tableSort.ts — the three-state cycle,
// the copy-and-total sort, `aria-sort`, and the folded code-point text
// comparison. It moved unchanged when the portfolio table needed the same
// headers over a different row; what stays here is the only part that is about
// THIS table, which is what a column MEANS. The two exports below keep their
// names and their exact signatures so no import anywhere else changed.

/**
 * An empty cell has no age. It sorts BELOW a zero-day-old item in both
 * directions, so "oldest first" never opens with a row that holds nothing.
 */
function ageValue(row: MindtreeTableRow): number {
  return row.oldestDays ?? -1
}

function compareRows(a: MindtreeTableRow, b: MindtreeTableRow, column: MindtreeSortColumn): number {
  switch (column) {
    case 'track':
      // The group is the secondary key under a path sort: two rows of one
      // branch would otherwise be ordered by whichever way `sort` happened to
      // land, which reads as the table shuffling under the reader's finger.
      //
      // `pathLabel` and not the parts array, so a sort compares what the column
      // SHOWS — and it carries no isolates, which would otherwise fold into the
      // comparison as invisible characters that order two identical paths
      // differently depending on how deep they sit.
      return compareText(a.pathLabel, b.pathLabel) || compareText(a.groupLabel, b.groupLabel)
    case 'group':
      return compareText(a.groupLabel, b.groupLabel)
    case 'count':
      return a.count - b.count
    case 'unassigned':
      return a.unassigned - b.unassigned
    case 'breached':
      return a.breached - b.breached
    case 'age':
      return ageValue(a) - ageValue(b)
  }
}

/**
 * This table's rows, sorted — `sortRows` with this table's comparator bound to
 * it. `null` means the tree's own reading order, which is the order the picture
 * is drawn in; it is a real state, not "unsorted".
 *
 * KEPT AS A NAMED EXPORT WITH THIS EXACT SIGNATURE rather than re-exporting the
 * generic. Callers pass `MindtreeSort | null` and get rows back with no
 * comparator in hand, which is what makes the sort one decision rather than a
 * choice every caller re-makes — and it is why the extraction changed no import
 * and no test outside this file.
 */
export function sortTableRows(
  rows: readonly MindtreeTableRow[],
  sort: MindtreeSort | null,
): MindtreeTableRow[] {
  return sortRows(rows, sort, compareRows)
}

/** The header cycle: unsorted → the column's natural direction → the other →
 *  unsorted. tableSort's, narrowed to this table's column union so a typo in a
 *  column key is a compile error here rather than a sort that never fires. */
export function nextSort(current: MindtreeSort | null, column: ColumnDef): MindtreeSort | null {
  return nextSortState(current, column)
}

// ── drilling down ──────────────────────────────────────────────────────────

/**
 * The filter that shows exactly what one cell counts.
 *
 * Exported and pure so the page can hand the result straight to its FilterBar's
 * `onChange` — the same `FilterState` every other screen uses, so a drilled-down
 * mindtree is a URL somebody can paste. The bucket keys it reads are model.ts's,
 * which are Board's, which are lib/aggregate's.
 *
 * THE UNTRACKED PILE CANNOT BE NARROWED, and that is a gap in FilterState, not
 * an oversight here: `trackIds: []` means "every track", and there is no facet
 * for "no track at all". Rather than silently filter to nothing, the track half
 * is left alone and only the group half is applied. The handoff proposes the
 * facet; until it exists, this is the honest behaviour.
 *
 * A ROW UNDER AN ORG NOW NARROWS TO THE ORG. It shipped narrowing to the TRACK,
 * because `FilterState` had no node facet and the finest thing this function
 * could say about a row under `UHR › OB › Org1` was "the UHR track, blocked" —
 * a SUPERSET of what the cell counted, so the reader clicked 3 and landed on 12.
 * `mapNodeIds` exists now (entryFilter.ts:69), the row has carried `nodeKey`
 * against this day since the walk went recursive, and the cell finally filters
 * to what it counted. Two facts make the one line below true and both live in
 * other files: `nodeKey` is `map_nodes.id` (model.ts's entity node sets
 * `bucketKey: entity.id`), and the facet reaches every DESCENDANT of that id
 * through `FilterContext.ancestryOfNode`, which store/entries.ts builds over the
 * whole tree — so "Org1, blocked" is Org1 and everything filed beneath it, which
 * is exactly the set the cell walked.
 *
 * A ROW WITH NO NODE LEAVES THE FACET ALONE, which is the untracked pile's rule
 * one ring down and not an oversight either. `mapNodeIds: []` means "the whole
 * map", not "filed under no organization", so clearing it would WIDEN a filter
 * the reader is narrowing. The rows this can reach are the ones filed at a track
 * itself, and under an active branch filter they are empty by construction.
 */
export function filterForCell(
  base: FilterState,
  dimension: MindDimension,
  row: MindtreeTableRow,
): FilterState {
  const next: FilterState = {
    ...base,
    trackIds: row.trackKey === NO_VALUE ? base.trackIds : [row.trackKey],
    mapNodeIds: row.nodeKey === null ? base.mapNodeIds : [row.nodeKey],
    // A cell is a path × group intersection, so any other facet on those same
    // axes would fight it. Everything else the reader chose — search, tags,
    // date range, sort — survives, because those narrow WITHIN the cell.
    statuses: [],
    priorities: [],
    health: [],
    owner: { kind: 'any' } satisfies OwnerFilter,
  }
  const key = row.groupKey
  if (key === null) return next

  switch (dimension) {
    case 'status':
      // The cast is the boundary between a string-keyed bucket and the frozen
      // union — the same one Board and FilterBar make, and sound in the only
      // direction that matters: the key came off an entry's own column, so
      // `statuses.includes(e.status)` matches the rows this cell counted even
      // if a future build declared one more member than this one knows.
      return { ...next, statuses: [key as EntryStatus] }
    case 'priority':
      return { ...next, priorities: [key as EntryPriority] }
    case 'health':
      return { ...next, health: [key as HealthLevel] }
    case 'owner':
      return { ...next, owner: ownerFilterFor(key) }
  }
}

function ownerFilterFor(key: string): OwnerFilter {
  if (key === NO_VALUE) return { kind: 'unassigned' }
  // A free-text owner is its own bucket and its own facet — a vendor owns real
  // work, and merging them into a member's id would filter to the wrong person.
  if (key.startsWith(NAME_PREFIX)) return { kind: 'name', name: key.slice(NAME_PREFIX.length) }
  return { kind: 'id', id: key }
}

// ── the component ──────────────────────────────────────────────────────────

export interface MindtreeTableProps {
  /** The SAME tree the map draws — `buildMindtree()`'s root. */
  root: MindNode
  /** Ring 2's axis, for the caption and for `filterForCell`. */
  dimension: MindDimension
  /** `useEntryMap()`. Read for ownership and age only; never for a count. */
  entryById: ReadonlyMap<string, Entry>
  /** `useFilterContext().today` — passed so this component holds no clock. */
  today: IsoDate
  /**
   * Narrow the page's filter to one cell. Omitted (or absent on a page with no
   * FilterBar) the cell renders as text rather than as a control that does
   * nothing.
   */
  onFilterCell?: (row: MindtreeTableRow) => void
  /** Defaults to store/entrySheet's openEntry — the same overlay every other
   *  screen opens. Injectable so a test can watch it without a DOM. */
  onOpenEntry?: (entryId: string) => void
  className?: string
}

export default function MindtreeTable({
  root,
  dimension,
  entryById,
  today,
  onFilterCell,
  onOpenEntry,
  className,
}: MindtreeTableProps): ReactElement {
  // Both halves of this call are load-bearing: it re-renders the table on a
  // language switch (t() is a plain function React cannot watch), and it is the
  // tag lib/dates' formatters take explicitly.
  const locale = useLocale()
  const captionId = useId()
  const groupCaptionId = useId()
  const [sort, setSort] = useState<MindtreeSort | null>(null)

  // `locale` is a dependency even though buildTableRows does not take it, which
  // is why the rule is silenced rather than obeyed: the key-shaped labels
  // inside it resolve through t(), which reads the GLOBAL locale rather than an
  // argument the linter can see. Without it a language switch would re-render
  // the table around a memo still holding the previous language's labels —
  // pages/Board.tsx silences the same rule where `filterKey` stands in for a
  // filter object for the mirror-image reason.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  const rows = useMemo(() => buildTableRows(root, entryById, today), [root, entryById, today, locale])
  const sorted = useMemo(() => sortTableRows(rows, sort), [rows, sort])

  /**
   * The second block's rows. Suppressed under a single track, where every
   * group appears exactly once above and the block would be the same table
   * twice.
   */
  const groupRows = useMemo(
    () => (root.children.length > 1 ? buildGroupRows(root, rows) : []),
    [root, rows],
  )

  /**
   * The footer. `count` comes from the ROOT rather than from summing the rows,
   * so the total can never disagree with the number the map's root node draws;
   * the other three are sums because no node carries them.
   */
  const totals = useMemo(() => {
    let unassigned = 0
    let breached = 0
    let oldestDays: number | null = null
    for (const row of rows) {
      unassigned += row.unassigned
      breached += row.breached
      if (row.oldestDays !== null && (oldestDays === null || row.oldestDays > oldestDays)) {
        oldestDays = row.oldestDays
      }
    }
    return { count: root.count, unassigned, breached, oldestDays }
  }, [rows, root.count])

  const openOne = useCallback(
    (id: string) => {
      ;(onOpenEntry ?? openEntryDefault)(id)
    },
    [onOpenEntry],
  )

  const dimensionLabel = t(
    MIND_DIMENSIONS.find((d) => d.key === dimension)?.labelKey ?? 'mindtree.dimStatus',
  )

  // A workspace with no tracks at all has no rows to draw and nothing to total.
  // Every OTHER emptiness — a filter that matched nothing, a workspace that is
  // simply clear — still renders the table, because "every row reads 0" is the
  // answer to the shape question rather than the absence of one.
  if (root.children.length === 0) {
    return (
      <p className={className === undefined ? 'mtree-tbl-blank' : `mtree-tbl-blank ${className}`}>
        {t('mindtree.emptyTracks')}
      </p>
    )
  }

  return (
    <>
    {/* A scroll container needs to be reachable by keyboard, or a reader who
        cannot use a pointer cannot see the last two columns at 375px. role +
        aria-labelledby is what stops the tab stop being an unlabelled mystery. */}
    <div
      className={className === undefined ? 'mtree-tblwrap' : `mtree-tblwrap ${className}`}
      role="region"
      aria-labelledby={captionId}
      tabIndex={0}
    >
      <table className="mtree-tbl">
        <caption className="mtree-tbl-caption">
          <span className="mtree-tbl-captiontitle" id={captionId}>
            {t('mindtree.tableLabel')}
          </span>{' '}
          <span className="mtree-tbl-captiondesc">
            {t('mindtree.treeLabel', { label: dimensionLabel })}
          </span>
        </caption>
        <thead>
          <tr>
            {COLUMNS.map((column) => {
              const state = ariaSort(sort, column.key)
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={state}
                  className={column.numeric ? 'mtree-tbl-num' : undefined}
                >
                  {/* A real button, not a th with a click handler: the sort has
                      to be reachable by Tab and activated by Enter AND Space,
                      and only a button gets all three for free. Its name is the
                      column label alone — aria-sort above carries the state. */}
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost mtree-tbl-sortbtn"
                    onClick={() => setSort((prev) => nextSort(prev, column))}
                  >
                    <span>{t(column.labelKey)}</span>
                    <SortMark state={state} />
                  </button>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <Row key={row.key} row={row} locale={locale} onOpen={openOne} onFilter={onFilterCell} />
          ))}
        </tbody>
        <tfoot>
          <tr className="mtree-tbl-total">
            {/* One header spanning the two label columns: the totals belong to
                the whole table, not to a track or a group. */}
            <th scope="row" colSpan={COLUMN_COUNT - 4}>
              {t('mindtree.rowTotal')}
            </th>
            <td className="mtree-tbl-num tabular">{totals.count}</td>
            <td className="mtree-tbl-num tabular">{totals.unassigned}</td>
            <td className="mtree-tbl-num tabular">{totals.breached}</td>
            <td className="mtree-tbl-num tabular">{ageCell(totals.oldestDays, locale)}</td>
          </tr>
        </tfoot>
      </table>
    </div>

    {groupRows.length > 0 && (
      <div
        className="mtree-tblwrap mtree-tbl-plain"
        role="region"
        aria-labelledby={groupCaptionId}
        tabIndex={0}
      >
        <table className="mtree-tbl">
          <caption className="mtree-tbl-caption">
            <span className="mtree-tbl-captiontitle" id={groupCaptionId}>
              {t('mindtree.byGroup', { label: dimensionLabel })}
            </span>{' '}
            <span className="mtree-tbl-captiondesc">{t('mindtree.byGroupHint')}</span>
          </caption>
          <thead>
            <tr>
              {/* No sort buttons here. The order IS the answer — biggest first —
                  and three extra tab stops that can only make the ranking
                  harder to read is not a feature. */}
              <th scope="col">{t('mindtree.colGroup')}</th>
              <th scope="col" className="mtree-tbl-num">
                {t('mindtree.colOpen')}
              </th>
              <th scope="col" className="mtree-tbl-num">
                {t('mindtree.colUnassigned')}
              </th>
              <th scope="col" className="mtree-tbl-num">
                {t('mindtree.colBreached')}
              </th>
            </tr>
          </thead>
          <tbody>
            {groupRows.map((row) => (
              <tr key={row.key} className="mtree-tbl-row">
                <th scope="row" className="mtree-tbl-groupcell">
                  <span className="mtree-tbl-group">{isolate(row.label)}</span>
                  {row.retired ? (
                    <span className="pill mtree-tbl-flag">{t('vocabadmin.hidden')}</span>
                  ) : null}
                </th>
                <td className="mtree-tbl-num tabular">{row.count}</td>
                <td
                  className={
                    row.unassigned > 0 ? 'mtree-tbl-num tabular is-warn' : 'mtree-tbl-num tabular'
                  }
                >
                  {row.unassigned}
                </td>
                <td
                  className={
                    row.breached > 0 ? 'mtree-tbl-num tabular is-bad' : 'mtree-tbl-num tabular'
                  }
                >
                  {row.breached}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
    </>
  )
}

/**
 * The sort arrow. Hand-rolled SVG rather than a glyph character: a triangle
 * from a font is a bidi-neutral character whose placement depends on the
 * paragraph direction, and this one has to sit at the inline end of its label
 * in both. Rotated by CSS class, aria-hidden because aria-sort already said it.
 */
function SortMark({ state }: { state: 'ascending' | 'descending' | 'none' }): ReactElement | null {
  if (state === 'none') return null
  return (
    <svg
      className={state === 'ascending' ? 'mtree-tbl-mark' : 'mtree-tbl-mark is-desc'}
      viewBox="0 0 10 10"
      width="10"
      height="10"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5 2 L9 8 L1 8 Z" fill="currentColor" />
    </svg>
  )
}

/**
 * `14d`, or the dash for a cell with nothing in it.
 *
 * `formatAge` takes the locale EXPLICITLY (every formatter in lib/dates does —
 * its header explains why: a formatter built on t() would ignore its own
 * argument, and the digest renders Arabic while the UI is English). So the tag
 * is threaded down from `useLocale()` rather than read again here.
 */
function ageCell(days: number | null, locale: Locale): string {
  return days === null ? EM_DASH : formatAge(days, locale)
}

/**
 * The path cell's text — `⁨UHR⁩, ⁨OB⁩, ⁨Org1⁩`.
 *
 * EACH COMPONENT IS ISOLATED SEPARATELY, not the joined string once, and it is
 * the same decision useMapModel's `trail()` documents: every step is database
 * text of unknown direction, and the separator between them is the locale's own
 * comma, which belongs to the ROW's reading direction rather than to either
 * label. Isolate the whole path instead and an Arabic Org under a Latin
 * programme drags the comma to the wrong side of itself.
 *
 * `row.pathLabel` is the same list without the isolates, and that is the one
 * the sort and the accessible name use — a comparison must not fold invisible
 * controls, and `mindtree.cellFilter` already wraps its `{track}` in the bundle.
 */
function pathText(parts: readonly string[], sep: string): string {
  return parts
    .filter((part) => part !== '')
    .map(isolate)
    .join(sep)
}

function Row({
  row,
  locale,
  onOpen,
  onFilter,
}: {
  row: MindtreeTableRow
  locale: Locale
  onOpen: (entryId: string) => void
  onFilter?: (row: MindtreeTableRow) => void
}): ReactElement {
  const sole = row.soleEntryId
  // Read here rather than threaded down from the memo, because it is the same
  // t() call the row builder made and it must give the same answer: the builder
  // and the renderer punctuate one path, not two. `locale` above is what makes
  // the whole component re-render when that answer changes.
  const sep = t('mindtree.listSep')
  // A cell with one item opens it; a cell with many narrows the page to it; a
  // structural node with nothing under it has neither, and gets text rather
  // than a dead control.
  const action: 'open' | 'filter' | null =
    sole !== null ? 'open' : row.count > 0 && onFilter !== undefined ? 'filter' : null

  // `nodeName` rather than a template literal, and it is a bidi fix rather than
  // a tidy-up: the group label is DATABASE TEXT, so a Latin status under an
  // Arabic UI (or the reverse) has to carry its own isolate or it swaps sides
  // with the sentence around it — the same reason the visible label below goes
  // through isolate(). `nodeName` is "⁨{label}⁩, {detail}" and already owns both
  // the isolate and the locale's own comma, which is why the separator is not
  // concatenated here. pages/Mindtree.tsx composes the MAP's node names from the
  // same key: the picture and the table announce a cell identically, or the
  // "view as table" toggle changes what a screen-reader user is told.
  //
  // THE FILTER BRANCH NAMES BOTH HEADERS AND SAYS WHAT IT DOES. It shipped as
  // `focusNode` with the group label alone, which was wrong twice. Wrong on
  // uniqueness: a group repeats under every track, so a fifteen-button table
  // collapsed into four distinct names — "Focus on ⁨Blocked⁩" three times over —
  // and this is the view a screen-reader user is given INSTEAD of the picture,
  // where the elements list is the navigation. And wrong on the verb: "focus"
  // is the map's drill-in vocabulary (`mindtree.focused` = "Showing X on its
  // own"), while the button rewrites the page's FilterBar. It promised the
  // map's behaviour and delivered the filter's. The single-entry branch is
  // untouched: `openEntry` already carries the item's unique title.
  const name =
    action === 'open'
      ? t('mindtree.nodeName', {
          label: row.groupLabel,
          detail: t('mindtree.openEntry', { title: row.soleTitle }),
        })
      : // `pathLabel`, so the name says WHICH ⁨Blocked⁩ this is all the way down
        // — "Show only ⁨UHR, OB, Org1⁩, ⁨Blocked⁩". Under an arbitrary-depth
        // hierarchy the track alone stopped being unique: five Orgs under one
        // programme would have produced five identically-named buttons, which
        // is the exact collapse the track was added to this name to fix.
        t('mindtree.cellFilter', { track: row.pathLabel, label: row.groupLabel })

  const groupBody = (
    <>
      <span className="mtree-tbl-group">{isolate(row.groupLabel)}</span>
      {sole !== null ? <span className="mtree-tbl-sole">{isolate(row.soleTitle)}</span> : null}
      {row.groupRetired ? <span className="pill mtree-tbl-flag">{t('vocabadmin.hidden')}</span> : null}
    </>
  )

  return (
    <tr className={row.empty ? 'mtree-tbl-row is-empty' : 'mtree-tbl-row'}>
      {/* TWO row headers, deliberately. A data cell in this table means nothing
          without both — "3" is the answer to "Network, Blocked, past deadline"
          and to nothing shorter — and scope="row" on each is how a screen
          reader announces the pair with every number in the row. */}
      <th scope="row" className="mtree-tbl-track">
        {/* The colour is the track's own pair, resolved in CSS by theme — one
            mark for the whole path, because every step under a track inherits
            that track's colour family and a second dot would encode nothing. */}
        <span className="track-dot" style={row.trackVars} aria-hidden="true" />
        {/* Database text next to numbers: isolated, or an Arabic track name and
            a Latin count trade places under dir="rtl". */}
        <span className="mtree-tbl-tracklabel">{pathText(row.pathParts, sep)}</span>
        {row.pathRetired ? (
          <span className="pill mtree-tbl-flag">{t('mindtree.archived')}</span>
        ) : null}
      </th>
      <th scope="row" className="mtree-tbl-groupcell">
        {action === null ? (
          groupBody
        ) : (
          <button
            type="button"
            className="btn btn-sm btn-ghost mtree-tbl-cellbtn"
            // The visible label is inside the name in both branches — WCAG
            // 2.5.3, so a voice user can say what they can read.
            aria-label={name}
            onClick={() => {
              if (action === 'open' && sole !== null) onOpen(sole)
              else if (onFilter !== undefined) onFilter(row)
            }}
          >
            {groupBody}
          </button>
        )}
      </th>
      <td className="mtree-tbl-num tabular">{row.count}</td>
      <td className={row.unassigned > 0 ? 'mtree-tbl-num tabular is-warn' : 'mtree-tbl-num tabular'}>
        {row.unassigned}
      </td>
      <td className={row.breached > 0 ? 'mtree-tbl-num tabular is-bad' : 'mtree-tbl-num tabular'}>
        {row.breached}
      </td>
      <td className="mtree-tbl-num tabular">{ageCell(row.oldestDays, locale)}</td>
    </tr>
  )
}
