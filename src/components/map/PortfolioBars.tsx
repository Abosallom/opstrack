// RANKED BARS — one horizontal bar per row, longest first, so the eye can
// compare ACROSS rows instead of reading a column of numbers down one.
//
// This is the `?as=bars` drawing of the same two shapes the portfolio table
// draws, and it takes them already built: `rows` when the reader has narrowed to
// organizations, `groups` when they are looking at the `?by=` roll-up. It builds
// nothing, fetches nothing and asks no store a question — every number below is
// read off the props, which is what lets the whole surface be proved by a static
// render at a fixed instant.
//
// ── WHAT A BAR IS, IN EACH SHAPE ───────────────────────────────────────────
//
//   BUCKETS (`showsRows === false`) — the bar is the bucket's capability
//   progress, `done` of `total`, and `total` is capability × organization pairs.
//   Its remainder is NOT drawn as a segment: what is left over is testing plus
//   planned plus never-recorded mixed together, and painting one hairline across
//   three different facts would name a state that does not exist. The ground
//   simply shows through, and the at-risk reading sits beside it in words.
//
//   ORGANIZATIONS (`showsRows === true`) — the bar is that organization's own
//   fifteen capabilities, stacked live · testing · planned · nobody-has-said, in
//   that order, and the whole width is the CATALOGUE. That is the only scale on
//   which two organizations can be compared: normalising each bar to the
//   capabilities somebody happened to record would make an organization with one
//   live link out of one recorded look finished beside one with nine of fifteen.
//
// ── THE FOURTH SEGMENT IS NOT A FILL, AND THAT IS THE WHOLE POINT ──────────
//
// 1,700 of this workspace's 2,415 cells are cells NOBODY HAS RECORDED. That is
// not "planned" — planned is a claim somebody made — and drawing it as a fourth
// colour would turn the largest fact on the screen into a decision that was
// never taken. So the fourth run of the bar is the BAR'S OWN GROOVE showing
// through, exactly as `.home-bar` describes it ("the ground shows through where
// the three segments do not reach 100%"), plus a hairline on its leading edge so
// it reads as a segment of the bar rather than as the bar having stopped early.
// `.pfb-gap` paints no background at all; `.pfb-seg[data-k='planned']` paints
// `var(--border)`. Those are two different rules on two different class names,
// which is what makes the difference assertable in a test rather than a matter
// of how the two greys look side by side.
//
// And the difference is never colour ALONE: the reading under every bar states
// all four numbers in words — "9 live, 2 testing, 1 planned, 3 not recorded" —
// so a reader who cannot tell the groove from the quietest fill still has the
// count. That is WCAG 1.4.1 and it is portfolio.css's own sentence: the drawing
// is decoration over a fact that is already written.
//
// THREE ZEROES, THREE DIFFERENT SENTENCES, and they are three different facts:
//
//   progress === null      nobody has LOOKED — the links store has not landed.
//                          Quiet line, NO BAR. Drawing an empty groove here
//                          would claim a measurement of zero.
//   progress.linked === 0  somebody looked and this organization has nothing
//                          recorded. The bar is drawn and it is ALL groove,
//                          which is the honest picture, and the reading says
//                          "nothing recorded of 15" rather than "0 live".
//   live === 0             people recorded things and none of them is live. The
//                          four-part reading says so.
//
// ── BARS ARE BOXES, NOT SVG ────────────────────────────────────────────────
//
// home.css's rule, for home.css's reason: an SVG bar needs its width in user
// units before it can draw, and a width that must be measured is what breaks
// between a 375px phone and a rotated one. Percentage-width spans, `--w` inline,
// every property logical, and every bar `aria-hidden="true"`.
//
// ── 161 ORGANIZATIONS, AND NO WINDOW ───────────────────────────────────────
//
// Nothing in this app is virtualised and the repo says so, so this does not
// window either — a windowed list breaks Ctrl-F, breaks the screen reader's
// count and breaks the print/export path all at once. What it does instead is
// draw the first screenful and SAY, on screen and in words, how many rows are
// behind the button. The cap is a first paint, not a limit: one tap renders
// every remaining row into the same list, with no scroll position to restore.

import { useMemo, useState, type CSSProperties, type ReactElement } from 'react'
import { isolate } from '../../lib/bidi'
import { t } from '../../lib/i18n'
import type { PortfolioGroupRow, PortfolioRow } from '../../lib/portfolio/rows'
import type { UseCase } from '../../types'
import './portfolio-bars.css'

const EM_DASH = '—'

/** How many rows the first paint draws. See the header — a cap, not a window. */
const CAP_WIDE = 40
const CAP_COMPACT = 20

interface Props {
  /** One per organization, already filtered and sorted by the caller. */
  rows: readonly PortfolioRow[]
  /** The `?by=` roll-up, already sorted by the caller. */
  groups: readonly PortfolioGroupRow[]
  /** True = draw organizations; false = draw buckets. */
  showsRows: boolean
  /** The catalogue, in order — the scale every organization's bar is drawn on. */
  catalogue: readonly UseCase[]
  /** Under 768px. */
  compact: boolean
  managerNameOf: (id: string | null) => string | null
  onOpenNode: (nodeId: string) => void
  /** The caption this region is named by. */
  captionId: string
}

/** The four counts a stacked organization bar is made of. */
interface Split {
  live: number
  testing: number
  planned: number
  /** `status === null` — nobody has recorded this capability here. */
  unrecorded: number
  /** The catalogue rows this organization was measured against. */
  total: number
  /** Capabilities anybody has said anything about at all. */
  linked: number
}

/**
 * Count the four states off one organization's capability rows.
 *
 * `progress.rows` is already in catalogue order and the same length for every
 * organization, so this is a straight tally and index `i` is the same capability
 * on every row. `status === null` is counted as its OWN state and never folded
 * into `planned`.
 */
function splitOf(row: PortfolioRow): Split | null {
  if (row.progress === null) return null
  let live = 0
  let testing = 0
  let planned = 0
  let unrecorded = 0
  for (const cell of row.progress.rows) {
    if (cell.status === 'live') live += 1
    else if (cell.status === 'testing') testing += 1
    else if (cell.status === 'planned') planned += 1
    else unrecorded += 1
  }
  return {
    live,
    testing,
    planned,
    unrecorded,
    total: row.progress.rows.length,
    linked: row.progress.linked,
  }
}

/** `n` of `total` as a CSS percentage. Never NaN — a zero denominator is 0%. */
function pct(n: number, total: number): string {
  return total <= 0 ? '0%' : `${((n / total) * 100).toFixed(3)}%`
}

export function PortfolioBars({
  rows,
  groups,
  showsRows,
  catalogue,
  compact,
  managerNameOf,
  onOpenNode,
  captionId,
}: Props): ReactElement {
  const [all, setAll] = useState(false)

  /**
   * RANKED HERE, NOT BY THE CALLER. The props arrive in the table's sort order,
   * and a ranked bar chart whose bars are not in rank order is a bar chart
   * lying about what it is for: the whole reason to draw bars instead of a
   * column of numbers is that the eye reads LENGTH, and length out of order is
   * noise. Organizations rank by live, then by testing — "furthest along" — and
   * buckets by how much is done. The tiebreak is the tree's own walk order, so
   * the ranking is total and two runs cannot disagree.
   */
  const ranked = useMemo(() => {
    const copy = [...rows]
    copy.sort((a, b) => {
      const sa = splitOf(a)
      const sb = splitOf(b)
      // An organization nobody has read yet cannot be ranked against one that
      // has been: it goes last, rather than being ranked as a zero it never
      // measured.
      if (sa === null || sb === null) {
        if (sa === sb) return a.order - b.order
        return sa === null ? 1 : -1
      }
      return sb.live - sa.live || sb.testing - sa.testing || a.order - b.order
    })
    return copy
  }, [rows])

  const rankedGroups = useMemo(() => {
    const copy = [...groups]
    copy.sort((a, b) => (b.done ?? -1) - (a.done ?? -1) || a.order - b.order)
    return copy
  }, [groups])

  const list: readonly unknown[] = showsRows ? ranked : rankedGroups
  const cap = compact ? CAP_COMPACT : CAP_WIDE
  const shown = all ? list.length : Math.min(cap, list.length)
  const hidden = list.length - shown

  if (list.length === 0) {
    return (
      <section className="pfb" role="region" aria-labelledby={captionId}>
        <div className="pfb-empty">
          <p className="pfb-empty-title">{t('mindtree.portfolioBarsEmpty')}</p>
          <p className="pfb-empty-hint">{t('mindtree.portfolioBarsEmptyHint')}</p>
        </div>
      </section>
    )
  }

  return (
    <section className="pfb" role="region" aria-labelledby={captionId}>
      {/* WHAT THE FULL WIDTH MEANS, stated before the first bar. Without it the
          groove at the end of every bar is unreadable: a reader cannot tell "we
          have not got there" from "the bar is as long as it goes". Only the
          organization bars are drawn on the catalogue's scale, so only they
          carry the sentence. */}
      {showsRows && (
        <p className="pfb-scale">{t('mindtree.portfolioBarsScale', { count: catalogue.length })}</p>
      )}

      {showsRows && (
        <ul className="pfb-key" aria-label={t('mindtree.portfolioBarsKey')}>
          <li className="pfb-key-item" data-k="live">
            {t('mapnode.statusLive')}
          </li>
          <li className="pfb-key-item" data-k="testing">
            {t('mapnode.statusTesting')}
          </li>
          <li className="pfb-key-item" data-k="planned">
            {t('mapnode.statusPlanned')}
          </li>
          {/* The fourth key swatch is the GROOVE with its hairline, drawn by the
              same rule the bar's fourth run uses — so the key is a sample of the
              thing rather than a second drawing of it. */}
          <li className="pfb-key-item" data-k="unrecorded">
            {t('mapnode.notRecorded')}
          </li>
        </ul>
      )}

      <ol className="pfb-list">
        {showsRows
          ? ranked
              .slice(0, shown)
              .map((row, i) => (
                <OrgBar
                  key={row.key}
                  row={row}
                  rank={i + 1}
                  managerName={managerNameOf(row.managerId)}
                  onOpen={onOpenNode}
                />
              ))
          : rankedGroups
              .slice(0, shown)
              .map((group, i) => <BucketBar key={group.key} group={group} rank={i + 1} />)}
      </ol>

      {/* HOW MANY ARE BEHIND THE BUTTON, IN WORDS, ON SCREEN — a cap that does
          not say what it is hiding is a list that is quietly wrong. */}
      {hidden > 0 && (
        <div className="pfb-more">
          <p className="pfb-more-count">{t('mindtree.portfolioBarsHidden', { count: hidden })}</p>
          <button
            type="button"
            className="btn btn-sm btn-ghost tap-44 pfb-more-btn"
            onClick={() => setAll(true)}
          >
            {t('mindtree.portfolioBarsShowAll')}
          </button>
        </div>
      )}
    </section>
  )
}

/**
 * One organization: name and figure on one line, the bar underneath.
 *
 * A TWO-ROW GRID rather than the three-column table this would be on a desktop —
 * home.css's rule and its reason: at 375px an organization's name, a reading and
 * a bar cannot share a line without the name truncating, and the name is the one
 * part a reader cannot reconstruct. The four-part reading takes a third row of
 * its own because it is a sentence, not a figure, and a sentence that has to fit
 * in an `auto` column is a sentence that will be cut.
 *
 * THE WHOLE ROW IS THE TAP TARGET and it opens the panel — `onOpenNode`, the
 * verb the table's own organization button uses. Nothing here drills the filter:
 * a bar chart is a thing you read and then point at.
 *
 * ⚠ AND IT CARRIES NO `aria-label`. The table's organization button does, and it
 *   is right there: the numbers beside it are in table cells a reader can
 *   navigate to one at a time, so the button only has to name the organization.
 *   Here the whole row IS the button, an `aria-label` REPLACES its content in
 *   the accessible name, and the content is the entire reading — so a label
 *   naming the organization would hide, from exactly the readers who cannot see
 *   the bar, the four numbers this view exists to state. The name is therefore
 *   the row's own words, and the verb is carried by a trailing `.sr-only` phrase
 *   rather than by wrapping the whole sentence in one.
 */
function OrgBar({
  row,
  rank,
  managerName,
  onOpen,
}: {
  row: PortfolioRow
  rank: number
  managerName: string | null
  onOpen: (nodeId: string) => void
}): ReactElement {
  const split = splitOf(row)
  return (
    <li className="pfb-item">
      <button type="button" className="pfb-row" onClick={() => onOpen(row.nodeId)}>
        <span className="pfb-name">
          <span className="pfb-rank tabular" aria-hidden="true">
            {rank}
          </span>
          {isolate(row.name)}
          {row.retired && <span className="pill pfb-flag">{t('mindtree.archived')}</span>}
          <span className="pfb-owner">
            <span className="sr-only">{t('mapnode.accountManager')}</span>{' '}
            {managerName === null ? <Blank /> : isolate(managerName)}
          </span>
        </span>

        <span className="pfb-fig tabular">
          {split === null || split.total === 0 || split.linked === 0 ? (
            <Blank />
          ) : (
            t('mapnode.progress', {
              done: split.live,
              total: split.total,
              status: t('mapnode.wordLive'),
            })
          )}
        </span>

        {split !== null && split.total > 0 && <StackedBar split={split} />}

        <span className="pfb-read">
          {split === null || split.total === 0 ? (
            <span className="pfb-quiet">{t('mindtree.portfolioBarsUnread')}</span>
          ) : split.linked === 0 ? (
            <span className="pfb-quiet">
              {t('mindtree.portfolioBarsNone', { total: split.total })}
            </span>
          ) : (
            t('mindtree.portfolioBarsRow', {
              live: split.live,
              testing: split.testing,
              planned: split.planned,
              unrecorded: split.unrecorded,
            })
          )}
        </span>

        {/* The verb, last, so it closes the sentence the row already reads as. */}
        <span className="sr-only">{t('mindtree.portfolioBarsOpen')}</span>
      </button>
    </li>
  )
}

/**
 * The four runs, in order, as percentage-width boxes.
 *
 * The fourth is `.pfb-gap` and NOT a `.pfb-seg`: see the header. Its width is
 * computed as the remainder rather than from its own count, so the three fills
 * and the groove always meet exactly and a rounding fraction cannot open a crack
 * the hairline would then sit inside.
 */
function StackedBar({ split }: { split: Split }): ReactElement {
  const { live, testing, planned, unrecorded, total } = split
  const gap = 100 - ((live + testing + planned) / total) * 100
  return (
    <span className="pfb-bar" aria-hidden="true">
      {live > 0 && (
        <span className="pfb-seg" data-k="live" style={{ '--w': pct(live, total) } as CSSProperties} />
      )}
      {testing > 0 && (
        <span
          className="pfb-seg"
          data-k="testing"
          style={{ '--w': pct(testing, total) } as CSSProperties}
        />
      )}
      {planned > 0 && (
        <span
          className="pfb-seg"
          data-k="planned"
          style={{ '--w': pct(planned, total) } as CSSProperties}
        />
      )}
      {unrecorded > 0 && (
        <span
          className="pfb-gap"
          data-k="unrecorded"
          style={{ '--w': `${gap.toFixed(3)}%` } as CSSProperties}
        />
      )}
    </span>
  )
}

/**
 * One bucket: `done` of `total` live, with the at-risk count beside it.
 *
 * NOT A CONTROL. A bucket's drill needs a filter this component was not given,
 * and a bar that looked like a button and did nothing is worse than a bar. The
 * table two files over owns that verb.
 */
function BucketBar({ group, rank }: { group: PortfolioGroupRow; rank: number }): ReactElement {
  const label = group.unnamed ? t('mapnode.notRecorded') : group.label
  const total = group.total
  const done = group.done
  // `total === 0` and `total === null` render alike, which is the same call
  // PortfolioStage's own bucket row makes: with no capability slots at all there
  // is nothing anybody could have read.
  const measured = total !== null && total > 0 && done !== null
  return (
    <li className="pfb-item">
      <div className="pfb-row pfb-static">
        <span className="pfb-name">
          <span className="pfb-rank tabular" aria-hidden="true">
            {rank}
          </span>
          {isolate(label)}
          <span className="pfb-owner">{t('mindtree.portfolioTotal', { count: group.orgs })}</span>
        </span>

        <span className="pfb-fig tabular">
          {measured ? (
            t('mapnode.progress', { done, total, status: t('mapnode.wordLive') })
          ) : (
            <Blank />
          )}
        </span>

        {/* ONE SEGMENT, and the remainder is left as bare ground on purpose:
            what is not live in a bucket is testing, planned and never-recorded
            together, and a hairline across the three would name a fourth state
            this shape does not have. */}
        {measured && (
          <span className="pfb-bar" aria-hidden="true">
            <span
              className="pfb-seg"
              data-k="live"
              style={{ '--w': pct(done, total) } as CSSProperties}
            />
          </span>
        )}

        <span className="pfb-read">
          {measured ? (
            t('mindtree.portfolioBarsRisk', { count: group.atRisk, orgs: group.orgs })
          ) : (
            <span className="pfb-quiet">{t('mindtree.portfolioBarsUnread')}</span>
          )}
        </span>
      </div>
    </li>
  )
}

/**
 * Nothing here — the dash a reader sees and the word a screen reader says.
 *
 * MapBranchDetail's `NotRecorded` and PortfolioStage's `Blank`, third copy, same
 * two elements: an `aria-label` on a plain span would be neither, because ARIA
 * 1.2 prohibits naming a generic element.
 */
function Blank(): ReactElement {
  return (
    <>
      <span aria-hidden="true">{EM_DASH}</span>
      <span className="sr-only">{t('mapnode.notRecorded')}</span>
    </>
  )
}
