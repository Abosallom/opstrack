// Proof for the sort every table header shares.
//
// PLAIN STATIC IMPORTS, unlike MindtreeTable.test.tsx's dynamic ones: nothing
// under test here reads localStorage, a locale or a clock — `tableSort.ts`
// imports `lib/text` and nothing else — so there is no module-order hazard to
// work around and no shim to install.
//
// WHAT THIS FILE IS FOR. The behaviour was MindtreeTable's and its component
// suite still pins it end-to-end; what that suite cannot see is the property
// that made the extraction worth doing — that the same cycle works over a row
// this file has never heard of. So the assertions below run over BOTH a
// mindtree-shaped row and a portfolio-shaped one, and the two must agree.

import { describe, expect, it } from 'vitest'
import { ariaSort, compareText, nextSort, sortRows, type TableSort } from './tableSort'

/** A row the mindtree table would produce. */
interface Cell {
  order: number
  label: string
  count: number
}

type CellColumn = 'label' | 'count'

const CELLS: readonly Cell[] = [
  { order: 0, label: 'New', count: 3 },
  { order: 1, label: 'Blocked', count: 1 },
  { order: 2, label: 'Done', count: 1 },
]

/** The ASCENDING answer, always: `sortRows` owns the sign. */
function compareCells(a: Cell, b: Cell, column: CellColumn): number {
  return column === 'count' ? a.count - b.count : compareText(a.label, b.label)
}

function sortCells(sort: TableSort<CellColumn> | null): readonly number[] {
  return sortRows(CELLS, sort, compareCells).map((r) => r.order)
}

describe('sortRows', () => {
  it('restores the table own order on null, which is a state and not an absence', () => {
    const scrambled = [...CELLS].reverse()
    expect(sortRows(scrambled, null, compareCells).map((r) => r.order)).toEqual([0, 1, 2])
  })

  it('sorts a copy, so null can restore an order the caller still holds', () => {
    const input = [...CELLS].reverse()
    sortRows(input, { column: 'count', dir: 'desc' }, compareCells)
    expect(input.map((r) => r.order)).toEqual([2, 1, 0])
  })

  it('ends every comparison on order, so a tie cannot reshuffle in either direction', () => {
    // Two rows tie at 1. A sort that leant on Array.prototype.sort's stability
    // alone would keep whatever order the CALLER happened to pass, which changes
    // between renders; `order` is the order that does not move — and it stays
    // ascending under a DESCENDING sort, because the sign is applied to the
    // comparator's answer and not to the tiebreak.
    expect(sortCells({ column: 'count', dir: 'desc' })).toEqual([0, 1, 2])
    expect(sortCells({ column: 'count', dir: 'asc' })).toEqual([1, 2, 0])
    const scrambled = [...CELLS].reverse()
    expect(sortRows(scrambled, { column: 'count', dir: 'desc' }, compareCells).map((r) => r.order)).toEqual(
      [0, 1, 2],
    )
  })

  it('hands the comparator the column that was clicked', () => {
    const seen: string[] = []
    sortRows(CELLS, { column: 'label', dir: 'asc' }, (a, b, column) => {
      seen.push(column)
      return compareCells(a, b, column)
    })
    expect(new Set(seen)).toEqual(new Set(['label']))
    expect(sortCells({ column: 'label', dir: 'asc' })).toEqual([1, 2, 0])
  })

  it('never calls the comparator at all when the sort is null', () => {
    // The tree order is not "sort by nothing", it is a different sort — so a
    // comparator that would throw is proof the null path does not reach it.
    const boom = (): number => {
      throw new Error('the null state must not consult a column')
    }
    expect(sortRows(CELLS, null, boom).map((r) => r.order)).toEqual([0, 1, 2])
  })

  it('sorts a row it has never heard of — the reason it left the component', () => {
    // A portfolio row: one per organization, no group, no count. `order` is the
    // only field this file may read, and it is the only one these two shapes
    // share. If this ever needs a second field, the extraction was wrong.
    interface OrgRow {
      order: number
      org: string
      stalledDays: number | null
    }
    const orgs: readonly OrgRow[] = [
      { order: 0, org: 'Org1', stalledDays: 12 },
      { order: 1, org: 'Org2', stalledDays: null },
      { order: 2, org: 'org0', stalledDays: 12 },
    ]
    const byOrg = sortRows(orgs, { column: 'org', dir: 'asc' }, (a, b) => compareText(a.org, b.org))
    expect(byOrg.map((r) => r.org)).toEqual(['org0', 'Org1', 'Org2'])
    // An absent value sorts below a present one in BOTH directions — the age
    // column's rule, expressed by the caller because it is the caller's rule.
    const stalled = sortRows(orgs, { column: 'stalled', dir: 'desc' }, (a, b) =>
      (a.stalledDays ?? -1) - (b.stalledDays ?? -1),
    )
    expect(stalled.map((r) => r.order)).toEqual([0, 2, 1])
  })
})

describe('nextSort', () => {
  const count = { key: 'count' as const, numeric: true }
  const label = { key: 'label' as const, numeric: false }

  it('opens a number column descending and a text column ascending', () => {
    // "Biggest pile first" is what a reader means by clicking a number column;
    // an alphabetical column read backwards is nobody's first question.
    expect(nextSort(null, count)).toEqual({ column: 'count', dir: 'desc' })
    expect(nextSort(null, label)).toEqual({ column: 'label', dir: 'asc' })
  })

  it('cycles back to the table own order on the third press', () => {
    const one = nextSort(null, count)
    const two = nextSort(one, count)
    expect(two).toEqual({ column: 'count', dir: 'asc' })
    expect(nextSort(two, count)).toBeNull()
  })

  it('starts a different column fresh rather than inheriting a direction', () => {
    expect(nextSort({ column: 'count', dir: 'asc' }, label)).toEqual({ column: 'label', dir: 'asc' })
    expect(nextSort({ column: 'label', dir: 'desc' }, count)).toEqual({ column: 'count', dir: 'desc' })
  })

  it('reads only key and numeric, so a table passes its own column definition', () => {
    // The mindtree's ColumnDef carries a labelKey; the portfolio's will carry
    // more. Structural compatibility is what keeps the two tables from
    // maintaining a second, parallel list of column keys.
    const withExtras = { key: 'count' as const, numeric: true, labelKey: 'mindtree.colOpen' }
    expect(nextSort(null, withExtras)).toEqual({ column: 'count', dir: 'desc' })
  })
})

describe('ariaSort', () => {
  it('reports none for an unsorted table and for every column but the sorted one', () => {
    // `none` rather than an absent attribute: absent says "this column is not
    // sortable", which is a different claim and a false one on this table.
    expect(ariaSort(null, 'count')).toBe('none')
    expect(ariaSort({ column: 'label', dir: 'asc' }, 'count')).toBe('none')
  })

  it('spells the direction the way assistive tech reads it', () => {
    expect(ariaSort({ column: 'count', dir: 'asc' }, 'count')).toBe('ascending')
    expect(ariaSort({ column: 'count', dir: 'desc' }, 'count')).toBe('descending')
  })
})

describe('compareText', () => {
  it('folds case, so a capital does not sort a whole block away from its word', () => {
    expect(compareText('org1', 'Org2')).toBe(-1)
    expect(compareText('Org2', 'org1')).toBe(1)
    expect(compareText('ORG1', 'org1')).toBe(0)
  })

  it('folds Arabic digits and tashkeel before comparing', () => {
    // '١٠' folds to '10', which sorts before '9' as TEXT — the same answer the
    // Latin string would give, which is the whole point of folding first.
    expect(compareText('١٠', '9')).toBe(-1)
    // The harakat carry no lexical weight; two spellings of one word are one
    // string here, so the caller's tiebreak decides between them.
    expect(compareText('شَبَكة', 'شبكة')).toBe(0)
  })

  it('compares by code point, never by localeCompare', () => {
    // The discriminator: every ICU host orders 'ä' with 'a' and answers -1 here,
    // while the code points put U+00E4 after 'b'. Which of the two a table used
    // would be invisible in the test runner and visible in a browser — and
    // `localeCompare` with no explicit locale is the host's choice, not ours.
    expect(compareText('ä', 'b')).toBe(1)
  })

  it('answers 0 for strings that fold together, rather than guessing', () => {
    expect(compareText(' New  ', 'new')).toBe(0)
  })
})
