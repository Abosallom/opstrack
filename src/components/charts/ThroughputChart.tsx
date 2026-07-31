// Created vs closed, one pair of columns per week.
//
// WEEKS, NOT DAYS, and lib/aggregate.throughputByWeek is where that choice is
// implemented. The §2.16 contract also ships a per-day series and it is the
// right shape for a future range picker; it is not the right shape for eight
// weeks on a 343px phone card, where 56 columns leaves six pixels each.
//
// PAIRED COLUMNS, NOT TWO LINES. The question is "did we close as much as we
// took on", which is a comparison of two magnitudes inside one period — that is
// what adjacent bars are for. Two lines invite the reader to interpolate
// between weekly samples, and nothing happened between them.
//
// READING ORDER INSIDE A PAIR MIRRORS. `created` is the first thing a reader
// meets in both directions, so in Arabic it is the RIGHT-hand column of each
// pair. Getting this wrong is invisible in English and reverses the story in
// Arabic — a week that took on four and closed one would read as the opposite.

import type { ReactElement } from 'react'
import { ChartAxis, ChartCategories, ChartFrame, ChartLegend, ChartMark } from './Chart'
import { bandScale, linearY, maxOf, niceTicks } from './geometry'
import { formatDate } from '../../lib/dates'
import { t, useLocale } from '../../lib/i18n'
import type { ThroughputPoint } from '../../lib/aggregate'

const HEIGHT = 200

/**
 * `12/05` — day and month, Latin digits in both languages, sliced off the ISO
 * string rather than run through Intl.
 *
 * `formatDate()` would give `12/05/2026`, which is three columns wide in a slot
 * that is forty pixels. The year is in the chart's own description and every
 * full date is one row away in the table, so it is not lost. Slicing is also
 * what guarantees the digits are Latin — spec §5 — without a NumberFormat
 * option to get wrong.
 */
function shortDay(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
}

export function ThroughputChart({
  points,
  loading = false,
}: {
  points: readonly ThroughputPoint[]
  loading?: boolean
}): ReactElement {
  const locale = useLocale()

  const created = points.reduce((sum, p) => sum + p.created, 0)
  const closed = points.reduce((sum, p) => sum + p.closed, 0)
  const ticks = niceTicks(maxOf(points.flatMap((p) => [p.created, p.closed])))

  return (
    <ChartFrame
      title={t('dashboard.flowTitle')}
      desc={t('dashboard.flowDesc', { count: points.length })}
      summary={t('dashboard.flowSummary', { created, closed, count: points.length })}
      height={HEIGHT}
      loading={loading}
      empty={created === 0 && closed === 0}
      emptyLabel={t('dashboard.flowEmpty')}
      legend={
        <ChartLegend
          items={[
            { key: 'created', label: t('dashboard.created'), tone: 'cht-c-created', value: String(created) },
            { key: 'closed', label: t('dashboard.closed'), tone: 'cht-c-closed', value: String(closed) },
          ]}
        />
      }
      columns={[
        { key: 'week', label: t('dashboard.colWeek') },
        { key: 'created', label: t('dashboard.created'), numeric: true },
        { key: 'closed', label: t('dashboard.closed'), numeric: true },
      ]}
      rows={points.map((p) => ({
        key: p.day,
        cells: [formatDate(p.day, locale), p.created, p.closed],
      }))}
    >
      {(plot) => {
        const band = bandScale(plot, points.length, 0.32)
        const y = linearY(plot, ticks.max)
        // One pixel of air between the two columns of a pair, so they read as
        // a pair rather than as one two-tone bar.
        const half = Math.max(1, band.bandWidth / 2 - 1)
        return (
          <>
            <ChartAxis plot={plot} ticks={ticks.values} y={y} />
            <g className="cht-series">
              {points.map((point, i) => {
                const slot = band.x(i)
                const far = slot + band.bandWidth - half
                const createdX = plot.rtl ? far : slot
                const closedX = plot.rtl ? slot : far
                return (
                  <ChartMark
                    key={point.day}
                    label={t('dashboard.flowMark', {
                      week: t('date.weekStart', { from: formatDate(point.day, locale) }),
                      created: point.created,
                      closed: point.closed,
                    })}
                  >
                    <rect
                      className="cht-bar cht-c-created"
                      x={createdX}
                      y={y(point.created)}
                      width={half}
                      height={Math.max(point.created > 0 ? 1 : 0, plot.bottom - y(point.created))}
                    />
                    <rect
                      className="cht-bar cht-c-closed"
                      x={closedX}
                      y={y(point.closed)}
                      width={half}
                      height={Math.max(point.closed > 0 ? 1 : 0, plot.bottom - y(point.closed))}
                    />
                  </ChartMark>
                )
              })}
            </g>
            <ChartCategories
              plot={plot}
              labels={points.map((p) => shortDay(p.day))}
              center={band.center}
            />
          </>
        )
      }}
    </ChartFrame>
  )
}
