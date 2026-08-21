// The three-state column sort, without the table it grew up in.
//
// A MOVE, NOT A REWRITE. Every line here was MindtreeTable.tsx's — `sortTableRows`,
// `nextSort`, `ariaSort` and the folded text comparison under them — and the
// behaviour is byte-for-byte the one that shipped, which is why that component's
// suite is untouched and still green. What forced the move is the SECOND table:
// the portfolio row builder needs the same headers over a different row, and the
// alternative to sharing this file is a second three-state cycle whose third
// click does something slightly else, in a product where the two tables sit one
// lens apart. A sort that disagrees with itself between two screens is not a
// sort, it is a bug the reader has to learn.
//
// GENERIC OVER `{ order: number }` AND NOTHING ELSE. `order` is the row's place
// in the TREE — the order the picture is drawn in — and this file needs exactly
// that one field, for the two things it does with it: restore it when the sort
// is null, and end every comparison on it so the result is TOTAL. Array sort is
// stable everywhere that matters, but stability only preserves an order the
// caller already had, and a re-render can hand the sort a different starting
// array. `order` is the order that cannot move.
//
// THE COMPARATOR IS INJECTED, rather than this file reading a value off the row
// by column key. A column's meaning belongs to its own table and refuses to be
// data: `track` falls back to the group label so two rows of one branch cannot
// shuffle, and `age` sorts an empty cell BELOW a zero-day-old one in both
// directions. Expressing those as an accessor map would either lose them or
// grow this file a vocabulary of special cases per table — which is how the
// sort ends up knowing what an Org is.
//
// PURE, AND IT MAY NOT IMPORT store/** OR api/** (§3.7). It reads no locale
// either: the only text it touches goes through `normalizeSearch`, which folds
// rather than translates.

import { normalizeSearch } from '../text'

/** Which way a column reads. Numbers open DESCENDING (the biggest pile is the
 *  question being asked), text ascending — see `nextSort`. */
export type SortDir = 'asc' | 'desc'

/** A sorted column and its direction. `null` — never a member here — is the
 *  third state: the table's own order. */
export interface TableSort<C extends string> {
  column: C
  dir: SortDir
}

/**
 * What `nextSort` needs to know about a column: its key, and whether it holds
 * numbers.
 *
 * Deliberately a SUBSET of what a real column definition carries (a label key,
 * a class, an alignment). Each table keeps its own `ColumnDef` and passes it
 * straight in — structurally compatible, no adapter, no second list to keep in
 * step with the first.
 */
export interface SortableColumn<C extends string> {
  key: C
  numeric: boolean
}

/** `aria-sort`'s three values. `'none'` is rendered rather than omitted: an
 *  absent attribute says "not sortable", which is a different claim. */
export type AriaSortState = 'ascending' | 'descending' | 'none'

/**
 * Folded, then compared by CODE POINT — never `localeCompare`, which with no
 * explicit locale is host-dependent and would order a table differently in the
 * test runner and in the browser. lib/entryFilter's title sort documents the
 * same choice, and folding is what makes code-point order sane in both
 * languages (case, tashkeel and Arabic-Indic digits are gone first).
 */
export function compareText(a: string, b: string): number {
  const x = normalizeSearch(a)
  const y = normalizeSearch(b)
  return x < y ? -1 : x > y ? 1 : 0
}

/**
 * Sorts a COPY, with `order` as the last word of every comparison.
 *
 * `null` means the table's own reading order — for the mindtree that is the
 * order the map is drawn in, for the portfolio it is the tree walk. It is a
 * REAL STATE, not "unsorted", which is the whole reason the header cycle has
 * three positions instead of two.
 *
 * The caller's comparator is asked for the ASCENDING answer and the sign is
 * applied here, so a table cannot accidentally implement its two directions
 * with two different tiebreaks.
 */
export function sortRows<R extends { order: number }, C extends string>(
  rows: readonly R[],
  sort: TableSort<C> | null,
  compare: (a: R, b: R, column: C) => number,
): R[] {
  const copy = [...rows]
  if (sort === null) return copy.sort((a, b) => a.order - b.order)
  const sign = sort.dir === 'asc' ? 1 : -1
  return copy.sort((a, b) => sign * compare(a, b, sort.column) || a.order - b.order)
}

/** The header cycle: unsorted → the column's natural direction → the other →
 *  unsorted. Three states, because the tree's order is worth getting back to.
 *
 *  A DIFFERENT COLUMN STARTS FRESH rather than inheriting the current
 *  direction: "biggest first" is what a reader means by clicking a number
 *  column, whatever the text column beside it was doing. */
export function nextSort<C extends string>(
  current: TableSort<C> | null,
  column: SortableColumn<C>,
): TableSort<C> | null {
  const first: SortDir = column.numeric ? 'desc' : 'asc'
  if (current === null || current.column !== column.key) return { column: column.key, dir: first }
  if (current.dir === first) return { column: column.key, dir: first === 'asc' ? 'desc' : 'asc' }
  return null
}

/**
 * The `<th>`'s `aria-sort`.
 *
 * THE SORT STATE LIVES HERE AND NOWHERE ELSE — not in the header button's
 * accessible name. It is the one place assistive tech looks for it, and
 * duplicating it into the name ("Open, sorted descending") would announce the
 * state twice and go stale the moment a second column is clicked.
 */
export function ariaSort<C extends string>(
  sort: TableSort<C> | null,
  column: C,
): AriaSortState {
  if (sort === null || sort.column !== column) return 'none'
  return sort.dir === 'asc' ? 'ascending' : 'descending'
}
