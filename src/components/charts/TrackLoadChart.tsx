// Open work per track, stacked by health.
//
// TWO FACTS IN ONE PICTURE, and that is the reason it is stacked rather than
// plain. Bar height answers "where is the work", the bands answer "and is any
// of it in trouble" — a track with forty calm items and a track with twelve of
// which nine are overdue are the same bar in a plain chart and obviously
// different here.
//
// THE BANDS ARE HEALTH, NOT PRIORITY. Priority is what somebody intended;
// health is what actually happened, it is computed by one view the whole app
// agrees on, and its four levels already have colour tokens and translated
// labels. A priority stack would need the vocabulary's colours, which an admin
// can set to anything including four shades of the same blue.
//
// THE TRACK'S OWN COLOUR still appears, as a 3px tick under each bar, because
// the reader recognises tracks by colour everywhere else in the app and an
// axis label alone makes them re-read four names. It is painted through
// `trackVars()` + a CSS rule, never a JS-picked hex — see lib/trackStyle.ts for
// why that distinction is not pedantry.

import type { CSSProperties, ReactElement } from 'react'
import { ChartAxis, ChartCategories, ChartFrame, ChartLegend, ChartMark } from './Chart'
import { bandScale, linearY, maxOf, niceTicks } from './geometry'
import { HEALTH_ORDER } from '../../lib/aggregate'
import { t, useLocale } from '../../lib/i18n'
import type { HealthLevel } from '../../types'

export interface TrackLoadRow {
  /** trackId, or '' for the untracked pile. */
  key: string
  label: string
  count: number
  byHealth: Record<HealthLevel, number>
  /** `trackVars(track.color, track.color_light)`. Absent for the untracked pile. */
  vars?: CSSProperties
}

const HEIGHT = 200

export function TrackLoadChart({
  rows,
  loading = false,
}: {
  rows: readonly TrackLoadRow[]
  loading?: boolean
}): ReactElement {
  useLocale()

  const ticks = niceTicks(maxOf(rows.map((r) => r.count)))
  const total = rows.reduce((sum, r) => sum + r.count, 0)
  const top = rows[0]

  return (
    <ChartFrame
      title={t('dashboard.trackTitle')}
      desc={t('dashboard.trackDesc')}
      summary={
        top
          ? // `count` is the TRACK count, not the busiest track's: selectPlural
            // reads vars.count and nothing else, so the number the sentence
            // inflects on ("1 track" / "6 tracks") has to be the one carrying
            // that name. The busiest track's own total rides as {topCount},
            // where it needs no inflection in either language.
            t('dashboard.trackSummary', {
              count: rows.length,
              top: top.label,
              topCount: top.count,
            })
          : t('dashboard.chartEmpty')
      }
      height={HEIGHT}
      loading={loading}
      empty={total === 0}
      emptyLabel={t('dashboard.trackEmpty')}
      legend={
        <ChartLegend
          items={HEALTH_ORDER.map((level) => ({
            key: level,
            label: t(`health.${level}`),
            tone: `cht-c-${level}`,
          }))}
        />
      }
      columns={[
        { key: 'track', label: t('dashboard.colTrack') },
        { key: 'open', label: t('dashboard.colOpen'), numeric: true },
        ...HEALTH_ORDER.map((level) => ({
          key: level,
          label: t(`health.${level}`),
          numeric: true,
        })),
      ]}
      rows={rows.map((r) => ({
        key: r.key,
        cells: [r.label, r.count, ...HEALTH_ORDER.map((level) => r.byHealth[level])],
      }))}
    >
      {(plot) => {
        const band = bandScale(plot, rows.length, 0.34)
        const y = linearY(plot, ticks.max)
        return (
          <>
            <ChartAxis plot={plot} ticks={ticks.values} y={y} />
            <g className="cht-series">
              {rows.map((row, i) => {
                // Stacked from the baseline up in escalating order, so the
                // worst band is always the cap of the bar and a scan across the
                // chart reads the red line, not four shuffled colours.
                let cursor = 0
                const segments = HEALTH_ORDER.map((level) => {
                  const value = row.byHealth[level]
                  const from = cursor
                  cursor += value
                  return { level, value, from, to: cursor }
                }).filter((s) => s.value > 0)

                const detail = segments
                  .map((s) => t('dashboard.healthPart', { count: s.value, health: t(`health.${s.level}`) }))
                  .join(t('dashboard.listSep'))

                return (
                  <ChartMark
                    key={row.key}
                    label={t('dashboard.trackMark', {
                      track: row.label,
                      count: row.count,
                      detail,
                    })}
                  >
                    {segments.map((s) => (
                      <rect
                        key={s.level}
                        // `cht-band` is the stacked-segment hairline: adjacent
                        // health colours are as close as 1.10:1, so the edge
                        // between two bands is drawn in the surface colour
                        // rather than left to the fills. See charts.css.
                        className={`cht-bar cht-band cht-c-${s.level}`}
                        x={band.x(i)}
                        y={y(s.to)}
                        width={band.bandWidth}
                        height={Math.max(1, y(s.from) - y(s.to))}
                      />
                    ))}
                    {/* The identity tick. Drawn even for a zero-height bar so
                        an empty track still reads as that track. */}
                    <rect
                      className={row.vars ? 'cht-trackmark' : 'cht-trackmark is-none'}
                      style={row.vars}
                      x={band.x(i)}
                      y={plot.bottom + 2}
                      width={band.bandWidth}
                      height={3}
                      rx={1.5}
                    />
                  </ChartMark>
                )
              })}
            </g>
            <ChartCategories
              plot={plot}
              labels={rows.map((r) => r.label)}
              center={band.center}
            />
          </>
        )
      }}
    </ChartFrame>
  )
}
