// How old the open work is, in four buckets.
//
// THE CHART NAMES ITS OWN CLOCK, because "age" is two different questions and
// the wrong assumption makes the picture actively misleading. `created` is the
// backlog aging report — how long has this been alive. `activity` is silence —
// how long since anyone touched it, which is the clock `v_entry_health` runs
// and the number the age pill on every row already shows. The switch is a chart
// control rather than a page control on purpose: it changes what THIS picture
// means and nothing else on the screen.
//
// THE BUCKET EDGES ARE lib/dates.bucketAge's, not this file's. A chart that
// drew its own 0-3/4-7/8-14/15+ would eventually put an item in a column the
// pill beside it disagrees with.
//
// The ramp darkens with age rather than using four unrelated hues: the buckets
// are ordered, and an ordered scale drawn in categorical colours makes the
// reader look for a meaning in the colours that is not there.

import type { ReactElement } from 'react'
import { ChartAxis, ChartCategories, ChartFrame, ChartMark } from './Chart'
import { bandScale, linearY, maxOf, niceTicks } from './geometry'
import { t, useLocale } from '../../lib/i18n'
import type { AgeBasis } from '../../lib/aggregate'
import type { AgeBucket } from '../../lib/dates'

const BUCKETS: readonly AgeBucket[] = ['0-3', '4-7', '8-14', '15+']

/** `dashboard.age0_3` … — the dot path cannot hold a `-`. */
const BUCKET_KEY: Readonly<Record<AgeBucket, string>> = {
  '0-3': 'dashboard.age0_3',
  '4-7': 'dashboard.age4_7',
  '8-14': 'dashboard.age8_14',
  '15+': 'dashboard.age15',
}

const HEIGHT = 190

export function AgingChart({
  histogram,
  basis,
  onBasis,
  loading = false,
}: {
  histogram: Record<AgeBucket, number>
  basis: AgeBasis
  onBasis: (next: AgeBasis) => void
  loading?: boolean
}): ReactElement {
  useLocale()

  const values = BUCKETS.map((b) => histogram[b])
  const total = values.reduce((sum, v) => sum + v, 0)
  const ticks = niceTicks(maxOf(values))
  const oldest = histogram['15+']

  return (
    <ChartFrame
      title={t('dashboard.ageTitle')}
      desc={basis === 'created' ? t('dashboard.ageDescCreated') : t('dashboard.ageDescActivity')}
      summary={t('dashboard.ageSummary', { total, oldest })}
      height={HEIGHT}
      loading={loading}
      empty={total === 0}
      emptyLabel={t('dashboard.ageEmpty')}
      toolbar={
        <div className="chip-row cht-seg" role="group" aria-label={t('dashboard.ageBasis')}>
          {(['created', 'activity'] as const).map((option) => (
            <button
              key={option}
              type="button"
              className="chip"
              aria-pressed={basis === option}
              onClick={() => onBasis(option)}
            >
              {option === 'created' ? t('dashboard.ageSinceRaised') : t('dashboard.ageSinceUpdate')}
            </button>
          ))}
        </div>
      }
      columns={[
        { key: 'bucket', label: t('dashboard.colAge') },
        { key: 'count', label: t('dashboard.colItems'), numeric: true },
      ]}
      rows={BUCKETS.map((bucket) => ({
        key: bucket,
        cells: [t(BUCKET_KEY[bucket]), histogram[bucket]],
      }))}
    >
      {(plot) => {
        const band = bandScale(plot, BUCKETS.length, 0.38)
        const y = linearY(plot, ticks.max)
        return (
          <>
            <ChartAxis plot={plot} ticks={ticks.values} y={y} />
            <g className="cht-series">
              {BUCKETS.map((bucket, i) => (
                <ChartMark
                  key={bucket}
                  label={t('dashboard.ageMark', {
                    bucket: t(BUCKET_KEY[bucket]),
                    count: histogram[bucket],
                  })}
                >
                  <rect
                    className={`cht-bar cht-c-a${i + 1}`}
                    x={band.x(i)}
                    y={y(histogram[bucket])}
                    width={band.bandWidth}
                    height={Math.max(histogram[bucket] > 0 ? 1 : 0, plot.bottom - y(histogram[bucket]))}
                  />
                  {/* The count sits above its own bar: with four columns there
                      is room, and it removes the "read across to the axis" step
                      that makes a small chart annoying to use. */}
                  <text
                    className="cht-value"
                    x={band.center(i)}
                    y={y(histogram[bucket]) - 5}
                    textAnchor="middle"
                  >
                    {histogram[bucket]}
                  </text>
                </ChartMark>
              ))}
            </g>
            <ChartCategories
              plot={plot}
              labels={BUCKETS.map((b) => t(BUCKET_KEY[b]))}
              center={band.center}
            />
          </>
        )
      }}
    </ChartFrame>
  )
}
