// SLA compliance — what share of the work we finished met the commitment we had
// made about it.
//
// THE HEADLINE IS HTML, THE BREAKDOWN IS SVG. A 42px number is the one piece of
// this dashboard someone reads from across a room, and text scaled inside an
// <svg> is text that stops matching the rest of the page's type ramp. The bars
// underneath are geometry and belong in the svg.
//
// THE DENOMINATOR IS STATED, ALWAYS. "94%" over sixteen items and "94%" over
// two hundred are different facts, and a compliance figure with no denominator
// is the classic way a dashboard becomes something nobody trusts twice. So the
// caption under the number is `met of measured`, and items that were resolved
// with NO SLA armed at either level get their own line rather than quietly
// vanishing from the maths.
//
// WHAT IS BEING MEASURED, precisely, because a percentage invites assumptions:
// entries whose status is `done`, whose `closed_at` falls in the window, and
// for which lib/health.resolveSlaDays() found a number at the track level or
// the priority level. Cancelled work is not counted either way — see
// lib/aggregate.slaCompliance's note on why that is not a rounding decision.

import type { ReactElement } from 'react'
import { ChartFrame, ChartMark } from './Chart'
import { spanX, type Insets } from './geometry'
import { t, useLocale } from '../../lib/i18n'
import type { SlaCompliance } from '../../lib/aggregate'
import type { EntryPriority } from '../../types'

/** Wider start gutter than the column charts: this axis is priority NAMES. */
const INSETS: Insets = { top: 6, bottom: 20, start: 78, end: 10 }
const ROW_HEIGHT = 26
const BAR_HEIGHT = 12
const GRID: readonly number[] = [0, 25, 50, 75, 100]

function percent(part: number, whole: number): number {
  return whole <= 0 ? 0 : Math.round((part / whole) * 100)
}

export function SlaChart({
  compliance,
  priorityLabel,
  loading = false,
}: {
  compliance: SlaCompliance
  priorityLabel: (p: EntryPriority) => string
  loading?: boolean
}): ReactElement {
  useLocale()

  const { measured, met, unmeasured, rate, byPriority } = compliance
  const overall = rate === null ? null : Math.round(rate * 100)
  const height = Math.max(ROW_HEIGHT, byPriority.length * ROW_HEIGHT) + INSETS.top + INSETS.bottom

  return (
    <ChartFrame
      title={t('dashboard.slaTitle')}
      desc={t('dashboard.slaDesc')}
      summary={
        overall === null
          ? t('dashboard.slaNone', { count: unmeasured })
          : t('dashboard.slaSummary', { pct: overall, met, measured })
      }
      height={height}
      insets={INSETS}
      loading={loading}
      empty={measured === 0}
      emptyLabel={
        unmeasured > 0 ? t('dashboard.slaNone', { count: unmeasured }) : t('dashboard.slaEmpty')
      }
      columns={[
        { key: 'priority', label: t('dashboard.colPriority') },
        { key: 'met', label: t('dashboard.colMet'), numeric: true },
        { key: 'measured', label: t('dashboard.colResolved'), numeric: true },
        { key: 'pct', label: t('dashboard.colCompliance'), numeric: true },
      ]}
      rows={byPriority.map((row) => ({
        key: row.priority,
        cells: [
          priorityLabel(row.priority),
          row.met,
          row.measured,
          t('dashboard.pct', { value: percent(row.met, row.measured) }),
        ],
      }))}
    >
      {(plot) => (
        <g className="cht-series cht-h">
          {/* Gridlines first, so a bar always sits on top of them. */}
          <g className="cht-axis" aria-hidden="true">
            {GRID.map((value) => {
              const at = spanX(plot, 100, 0, value)
              const x = plot.rtl ? at.x : at.x + at.width
              return (
                <g key={value}>
                  <line
                    className={value === 0 ? 'cht-baseline' : 'cht-gridline'}
                    x1={x}
                    x2={x}
                    y1={plot.top}
                    y2={plot.bottom}
                  />
                  <text
                    className="cht-tick"
                    x={x}
                    y={plot.bottom + 14}
                    textAnchor="middle"
                  >
                    {value}
                  </text>
                </g>
              )
            })}
          </g>

          {byPriority.map((row, i) => {
            const pct = percent(row.met, row.measured)
            const y = plot.top + i * ROW_HEIGHT + (ROW_HEIGHT - BAR_HEIGHT) / 2
            const track = spanX(plot, 100, 0, 100)
            const fill = spanX(plot, 100, 0, pct)
            return (
              <ChartMark
                key={row.priority}
                label={t('dashboard.slaMark', {
                  priority: priorityLabel(row.priority),
                  pct,
                  met: row.met,
                  measured: row.measured,
                })}
              >
                <rect
                  className="cht-track"
                  x={track.x}
                  y={y}
                  width={track.width}
                  height={BAR_HEIGHT}
                  rx={BAR_HEIGHT / 2}
                />
                <rect
                  className={`cht-bar ${pct >= 90 ? 'cht-c-good' : pct >= 70 ? 'cht-c-warn' : 'cht-c-bad'}`}
                  x={fill.x}
                  y={y}
                  width={Math.max(fill.width, pct > 0 ? 2 : 0)}
                  height={BAR_HEIGHT}
                  rx={BAR_HEIGHT / 2}
                />
                <text
                  className="cht-rowlabel"
                  x={plot.rtl ? plot.right + 8 : plot.left - 8}
                  y={y + BAR_HEIGHT / 2}
                  textAnchor={plot.rtl ? 'start' : 'end'}
                  dominantBaseline="middle"
                >
                  {priorityLabel(row.priority)}
                </text>
              </ChartMark>
            )
          })}
        </g>
      )}
    </ChartFrame>
  )
}

/**
 * The headline figure, rendered beside the chart rather than inside it.
 *
 * Exported separately so the dashboard can place it in the card header — a
 * number this large inside the <figure> would fight the chart's own caption for
 * the top of the card.
 */
export function SlaHeadline({ compliance }: { compliance: SlaCompliance }): ReactElement {
  useLocale()
  const { measured, met, breached, unmeasured, rate } = compliance
  const overall = rate === null ? null : Math.round(rate * 100)
  const tone = overall === null ? 'is-none' : overall >= 90 ? 'is-good' : overall >= 70 ? 'is-warn' : 'is-bad'

  return (
    <div className={`cht-headline ${tone}`}>
      <p className="cht-headline-value tabular">
        {overall === null ? t('dashboard.noValue') : t('dashboard.pct', { value: overall })}
      </p>
      <p className="cht-headline-note">
        {overall === null
          ? t('dashboard.slaNoneShort')
          : t('dashboard.slaOf', { met, measured, breached })}
      </p>
      {unmeasured > 0 && measured > 0 && (
        <p className="cht-headline-note cht-headline-aside">
          {t('dashboard.slaUnmeasured', { count: unmeasured })}
        </p>
      )}
    </div>
  )
}
