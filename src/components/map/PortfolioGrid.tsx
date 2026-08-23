// THE HEAT GRID — every organization against every capability, in one table.
//
// 161 organizations × 15 capabilities = 2,415 cells, and 1,700 of them are
// EMPTY. That number is the whole reason this view exists. The table, the bars
// and the cards all answer "how far has this organization got"; only the grid
// answers "which capabilities has nobody anywhere even been asked about", and
// it answers it by shape rather than by a sentence: a wall of hollow squares
// with a column of colour down one side is a picture of a question nobody has
// put, and no summary line makes that visible the way the field of absence does.
//
// ── THE FOURTH STATE IS DRAWN AS THE GROUND, NOT AS A FOURTH COLOUR ────────
//
// `status === null` is NOT "planned". Planned means somebody looked at this
// capability, at this organization, and said "we intend to". Null means the
// question has never been asked. house law 1 gives the idiom for a dense cell:
// the container's own ground plus a hairline — so `planned` is a SOLID square in
// `var(--border)` and unrecorded is a HOLLOW one, the surface showing through a
// 1px ring of the same token. Fill versus outline is a difference in FORM, not
// in hue, which is what makes the pair legible to a reader who cannot separate
// the three colours at all (WCAG 1.4.1) — and every cell carries its state as an
// `.sr-only` word besides, so the colour is decoration over a fact that is
// already written. That is `portfolio.css`'s sentence, applied 2,415 times.
//
// A FIFTH THING EXISTS AND IS NOT ANY OF THE FOUR. `row.progress === null` means
// the links store has not landed — nobody has LOOKED, as opposed to nobody
// having SAID. Drawing that as the fourth state would report 2,415 unasked
// questions every time the page mounts, which is a measurement nobody took
// (house law 3's rule, one layer up). It gets its own quiet dashed cell and its
// own word, and when it is true of every row the grid does not draw at all.
//
// ── FIFTEEN COLUMNS DO NOT FIT 375px AND ARE NOT MADE TO ───────────────────
//
// `.pf-wrap`'s pattern exactly, and for the reason stated there: the wrapper
// scrolls along the inline axis and is a real tab stop with a name, so a reader
// who cannot use a pointer still reaches the fifteenth column. Nothing is
// dropped on a phone. The organization column is sticky at the INLINE START —
// `inset-inline-start`, which is why the Arabic build pins it to the right with
// no second rule.
//
// The column headings are NUMBERS with the capability name as their `.sr-only`
// text, and the numbers are decoded by a key that is on the page above the grid.
// Rotated headings were the alternative and were not taken: a `writing-mode`
// heading needs a fixed block-size to reserve, that block-size is a function of
// the longest capability name, and the longest capability name is whatever an
// admin last typed — in either script. A number is one character wide in both
// languages forever, and the key costs one list.
//
// ── RANKED BY WHAT IS LIVE, NEVER ALPHABETICALLY ───────────────────────────
//
// Live descending, then testing descending, then the tree's own walk order as
// the total tiebreak. Alphabetical rows would scatter the colour uniformly and
// the grid would read as noise; ranked, the same 715 marks pool at the top and
// the absence below them becomes a shape with an edge. The sort is this view's
// own and deliberately not the table's `?sort=` — the grid is a picture, and a
// picture whose rows the reader can reorder is four pictures.
//
// ── THE ROW HEADER IS A CONTROL; THE 2,415 CELLS ARE NOT ───────────────────
//
// A cell is not a control unless it needs to be, and a capability cell has
// nothing to open — the link it stands for is edited in the organization panel.
// The organization NAME is a button, because "this row is empty, show me it" is
// the move the picture provokes. ⚠ `overflow-x: auto` clips a `.tap-44`
// `::after` at the padding edge, so the sticky header cell pays `padding-block:
// 7px` for the overlay exactly as `.chip-row` does.

import { useMemo, type ReactElement } from 'react'
import { isolate } from '../../lib/bidi'
import { t } from '../../lib/i18n'
import { useCapabilityLabel } from '../../lib/labels'
import type { PortfolioGroupRow, PortfolioRow } from '../../lib/portfolio/rows'
import type { UseCase, UseCaseStatus } from '../../types'
import './portfolio-grid.css'

/** What a single square can say. The fifth is not a state, it is a wait. */
type CellKind = UseCaseStatus | 'none' | 'pending'

/** The dash a reader sees where the word is for a screen reader alone. */
const EM_DASH = '—'

/**
 * The four states, in the order the key lists them and the order the eye should
 * learn them: what is finished, what is nearly, what is intended, and what
 * nobody has said. `none` last because it is the largest of the four and the
 * point of the view.
 */
const KEY_STATES: readonly CellKind[] = Object.freeze(['live', 'testing', 'planned', 'none'])

/** The `.sr-only` word each square carries. Literal keys — localeReach scans. */
const CELL_WORD: Readonly<Record<CellKind, string>> = Object.freeze({
  live: 'mindtree.portfolioGridLive',
  testing: 'mindtree.portfolioGridTesting',
  planned: 'mindtree.portfolioGridPlanned',
  none: 'mindtree.portfolioGridNone',
  pending: 'mindtree.portfolioGridPending',
})

export interface PortfolioGridProps {
  rows: readonly PortfolioRow[]
  groups: readonly PortfolioGroupRow[]
  showsRows: boolean
  catalogue: readonly UseCase[]
  compact: boolean
  managerNameOf: (id: string | null) => string | null
  onOpenNode: (nodeId: string) => void
  captionId: string
}

/** One square: which capability it stands under, and what it says. */
interface GridCell {
  /** `use_cases.id` — the React key, so a reordered catalogue moves the square. */
  id: string
  kind: CellKind
}

/** One organization's fifteen squares, plus the three counts the ranking uses. */
interface GridRow {
  row: PortfolioRow
  cells: readonly GridCell[]
  live: number
  testing: number
  /** Squares anybody has said anything about — NOT a zero when nobody has. */
  recorded: number
}

/* ══════════════════════════ the arithmetic ══════════════════════════ */

/**
 * A row's squares, one per capability, in catalogue order.
 *
 * `progress.rows` is ALREADY in catalogue order and the same length on every
 * organization, so index i is the same capability on every line — that is the
 * invariant the whole grid stands on and it is asserted in mapNodes.ts rather
 * than re-derived here. The index guard is for the one case it does not cover:
 * a catalogue that grew between the links read and this render.
 */
function cellsFor(row: PortfolioRow, catalogue: readonly UseCase[]): GridCell[] {
  // `cap`, never `useCase`: `react-hooks/rules-of-hooks` reads a `use`-prefixed
  // identifier as a hook, which is the trap lib/labels.ts wrote down when it
  // named `capabilityLabel`.
  if (row.progress === null) {
    return catalogue.map((cap) => ({ id: cap.id, kind: 'pending' as const }))
  }
  return catalogue.map((cap, i) => ({
    id: cap.id,
    kind: row.progress?.rows[i]?.status ?? ('none' as const),
  }))
}

/**
 * Live descending, testing descending, tree order last.
 *
 * The third key is not decoration: without a total tiebreak two organizations
 * with identical squares would swap places between renders on any engine whose
 * sort is not stable for the shape, and a picture that reshuffles under a reader
 * is a different picture each time they look at it.
 */
function rank(a: GridRow, b: GridRow): number {
  if (a.live !== b.live) return b.live - a.live
  if (a.testing !== b.testing) return b.testing - a.testing
  return a.row.order - b.row.order
}

function buildGridRows(
  rows: readonly PortfolioRow[],
  catalogue: readonly UseCase[],
): GridRow[] {
  return rows
    .map((row) => {
      const cells = cellsFor(row, catalogue)
      return {
        row,
        cells,
        live: cells.filter((c) => c.kind === 'live').length,
        testing: cells.filter((c) => c.kind === 'testing').length,
        recorded: cells.filter((c) => c.kind !== 'none' && c.kind !== 'pending').length,
      }
    })
    .sort(rank)
}

/** Every square on the grid, counted once. The sentence above the table. */
interface GridTotals {
  cells: number
  recorded: number
  live: number
  testing: number
  planned: number
  unrecorded: number
  /** Rows whose links have not landed. `=== rows.length` is the loading state. */
  pending: number
}

function totalsOf(grid: readonly GridRow[], columns: number): GridTotals {
  let live = 0
  let testing = 0
  let planned = 0
  let pending = 0
  for (const line of grid) {
    live += line.live
    testing += line.testing
    planned += line.cells.filter((c) => c.kind === 'planned').length
    if (line.row.progress === null) pending += 1
  }
  const cells = grid.length * columns
  const recorded = live + testing + planned
  return {
    cells,
    recorded,
    live,
    testing,
    planned,
    // Cells nobody has RECORDED, which is not the same as cells nobody has READ:
    // a row still waiting on the links store contributes to neither.
    unrecorded: cells - recorded - pending * columns,
    pending,
  }
}

/* ══════════════════════════ the view ══════════════════════════ */

export function PortfolioGrid({
  rows,
  groups,
  showsRows,
  catalogue,
  compact,
  managerNameOf,
  onOpenNode,
  captionId,
}: PortfolioGridProps): ReactElement {
  const capabilityLabel = useCapabilityLabel()

  const grid = useMemo(() => buildGridRows(rows, catalogue), [rows, catalogue])
  const totals = useMemo(() => totalsOf(grid, catalogue.length), [grid, catalogue.length])

  /**
   * The buckets, each holding its own members in the same ranking.
   *
   * `?by=` groups the SAME organizations rather than replacing them, because a
   * bucket has no per-capability status of its own — `UseCaseProgressRow`'s
   * header says so outright ("a single word cannot summarise three of them") and
   * a cell that averaged four organizations into one square would be inventing a
   * reading. So the roll-up sections the grid; every one of the 2,415 squares is
   * still on the page, under a heading naming the bucket it belongs to.
   */
  const sections = useMemo(() => {
    if (showsRows) return null
    const byId = new Map(grid.map((line) => [line.row.nodeId, line]))
    return groups.map((group) => ({
      group,
      lines: group.nodeIds
        .map((id) => byId.get(id))
        .filter((line): line is GridRow => line !== undefined)
        .sort(rank),
    }))
  }, [showsRows, groups, grid])

  if (catalogue.length === 0) {
    return (
      <section className="pfg" aria-labelledby={captionId}>
        <p className="pfg-blank" id={captionId}>
          {t('mindtree.portfolioGridNoCatalogue')}
        </p>
        <p className="pfg-blank-hint">{t('mindtree.portfolioGridNoCatalogueHint')}</p>
      </section>
    )
  }

  if (rows.length === 0) {
    return (
      <section className="pfg" aria-labelledby={captionId}>
        <p className="pfg-blank" id={captionId}>
          {t('mindtree.portfolioGridEmpty')}
        </p>
        <p className="pfg-blank-hint">{t('mindtree.portfolioGridEmptyHint')}</p>
      </section>
    )
  }

  // NOBODY HAS LOOKED — every row is waiting on the links store. A grid of 2,415
  // hollow squares here would say "nobody has recorded any of this", which is a
  // claim about the workspace made from the absence of a fetch.
  if (totals.pending === grid.length) {
    return (
      <section className="pfg" aria-labelledby={captionId}>
        <p className="pfg-loading" id={captionId} role="status">
          {t('mindtree.portfolioGridLoading')}
        </p>
      </section>
    )
  }

  return (
    <section className="pfg" data-compact={compact ? '1' : undefined}>
      {/* THE TOTALS IN WORDS, ABOVE THE PICTURE. house law 2: counted out of
          their denominator, never as a share. "715 of 2,415" is a fact a
          director can act on; "30%" is a fact about arithmetic. */}
      <p className="pfg-totals">
        {t('mindtree.portfolioGridTotals', {
          recorded: totals.recorded,
          total: totals.cells,
          live: totals.live,
        })}
      </p>
      <p className="pfg-absence">
        {t('mindtree.portfolioGridUnrecorded', { count: totals.unrecorded })}
      </p>
      {totals.pending > 0 && (
        <p className="pfg-absence" role="status">
          {t('mindtree.portfolioGridPendingRows', { count: totals.pending })}
        </p>
      )}

      {/* THE KEY FOR THE COLOURS. The squares repeat the shapes the cells use —
          the fourth one hollow — so the difference between "planned" and
          "nobody has said" is legible before the reader reaches the grid. */}
      <ul className="pfg-key">
        {KEY_STATES.map((kind) => (
          <li className="pfg-key-item" key={kind} data-k={kind}>
            {t(CELL_WORD[kind])}
          </li>
        ))}
      </ul>

      {/* THE KEY FOR THE COLUMNS, which is what makes numbered headings
          honest. `isolate()` after nothing is truncated — the name is whole
          here, and this is the one place it is. */}
      <ol className="pfg-cols">
        {catalogue.map((cap, i) => (
          <li className="pfg-cols-item" key={cap.id}>
            <span className="pfg-cols-n" aria-hidden="true">
              {i + 1}
            </span>
            {isolate(capabilityLabel(cap))}
          </li>
        ))}
      </ol>

      <div className="pfg-wrap" role="region" aria-labelledby={captionId} tabIndex={0}>
        <table className="pfg-tbl">
          <caption className="pfg-caption">
            <span className="pfg-caption-title" id={captionId}>
              {t('mindtree.portfolioGridLabel')}
            </span>{' '}
            <span className="pfg-caption-desc">
              {t('mindtree.portfolioGridCaption', {
                orgs: rows.length,
                caps: catalogue.length,
              })}
            </span>
          </caption>

          <thead>
            <tr>
              <th scope="col" className="pfg-corner">
                {t('mindtree.portfolioGridOrg')}
              </th>
              {catalogue.map((cap, i) => (
                <th scope="col" className="pfg-colhead" key={cap.id}>
                  <span aria-hidden="true">{i + 1}</span>
                  <span className="sr-only">{isolate(capabilityLabel(cap))}</span>
                </th>
              ))}
              <th scope="col" className="pfg-tally">
                {t('mindtree.portfolioGridRowHead')}
              </th>
              <th scope="col" className="pfg-owner">
                {t('mindtree.portfolioGridOwnerHead')}
              </th>
            </tr>
          </thead>

          {sections === null ? (
            <tbody>
              {grid.map((line) => (
                <Line
                  key={line.row.key}
                  line={line}
                  managerNameOf={managerNameOf}
                  onOpenNode={onOpenNode}
                />
              ))}
            </tbody>
          ) : (
            sections.map((section) => (
              <tbody key={section.group.key} className="pfg-group">
                <tr className="pfg-grouprow">
                  <th scope="rowgroup" className="pfg-grouphead" colSpan={catalogue.length + 3}>
                    {section.group.unnamed
                      ? t('mindtree.portfolioGridUnnamed')
                      : isolate(section.group.label)}{' '}
                    <span className="pfg-groupn">
                      {t('mindtree.portfolioTotal', { count: section.group.orgs })}
                    </span>
                  </th>
                </tr>
                {section.lines.map((line) => (
                  <Line
                    key={line.row.key}
                    line={line}
                    managerNameOf={managerNameOf}
                    onOpenNode={onOpenNode}
                  />
                ))}
              </tbody>
            ))
          )}
        </table>
      </div>
    </section>
  )
}

/* ══════════════════════════ one organization ══════════════════════════ */

function Line({
  line,
  managerNameOf,
  onOpenNode,
}: {
  line: GridRow
  managerNameOf: (id: string | null) => string | null
  onOpenNode: (nodeId: string) => void
}): ReactElement {
  const { row } = line
  const owner = managerNameOf(row.managerId)
  const waiting = row.progress === null

  return (
    <tr className="pfg-row">
      <th scope="row" className="pfg-org">
        <button
          type="button"
          className="pfg-org-btn tap-44"
          onClick={() => onOpenNode(row.nodeId)}
        >
          {isolate(row.name)}
        </button>
        {row.retired && (
          <span className="pfg-retired">{t('mindtree.portfolioGridRetired')}</span>
        )}
      </th>

      {line.cells.map((cell) => (
        // NO VISIBLE TEXT IN THE SQUARE, and the word is not optional for that
        // reason: 2,415 dashes would drown the picture the grid exists to draw,
        // so the state is carried by form for the eye and by the `.sr-only` word
        // for everybody else. The capability itself comes from the column header.
        <td className="pfg-cell" key={cell.id} data-k={cell.kind}>
          <span className="sr-only">{t(CELL_WORD[cell.kind])}</span>
        </td>
      ))}

      <td className="pfg-tally">
        {waiting ? (
          <Blank word={t('mindtree.portfolioGridPending')} />
        ) : line.recorded === 0 ? (
          // TWO ZEROES ARE DIFFERENT FACTS — house law 3. "0 live of 0 recorded"
          // would print a measurement nobody took; this row is the one the grid
          // exists to show, and its tally is an absence, not a zero.
          <Blank word={t('mindtree.portfolioGridNothingRecorded')} />
        ) : (
          t('mindtree.portfolioGridRowCount', { live: line.live, recorded: line.recorded })
        )}
      </td>

      <td className="pfg-owner">
        {owner === null ? (
          <Blank word={t('mindtree.portfolioGridNoOwner')} />
        ) : (
          isolate(owner)
        )}
      </td>
    </tr>
  )
}

/**
 * A cell with nothing in it — the dash for the eye, the word for the reader.
 *
 * `PortfolioStage`'s `Blank` and `MapBranchDetail`'s `NotRecorded`, copied
 * rather than imported: both are private to their file, and an `aria-label` on a
 * plain `<span>` would be neither of the two things this renders, because ARIA
 * 1.2 prohibits naming a generic element.
 */
function Blank({ word }: { word: string }): ReactElement {
  return (
    <>
      <span aria-hidden="true">{EM_DASH}</span>
      <span className="sr-only">{word}</span>
    </>
  )
}
