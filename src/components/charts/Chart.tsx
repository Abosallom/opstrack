// The frame every chart on the dashboard is drawn inside.
//
// It owns the four things that are identical across charts and easy to get
// subtly wrong once per chart: the accessibility wiring, the table fallback,
// the empty/loading states, and the measured plot rectangle. A chart component
// supplies data and a draw function; it never touches an id, a <details>, or a
// ResizeObserver.
//
// THE ACCESSIBILITY CONTRACT, stated once here because it is the same on all
// five:
//
//  · The <svg> is `role="group"`, named by its own <title> and described by its
//    own <desc>. `role="img"` would be the usual choice and is WRONG here — it
//    makes the whole subtree presentational, and the data marks inside are
//    focusable. A group can contain focusable children; an image cannot.
//  · <desc> carries a SHAPE SUMMARY ("5 tracks, most open work on Network with
//    12"), not a repeat of the title. A description that restates the caption
//    is a description a screen-reader user has to sit through twice for
//    nothing.
//  · Every data mark is ONE tab stop per CATEGORY, not per segment. A stacked
//    bar with four health bands is one stop announcing all four; an eight-week
//    throughput chart is eight stops, not sixteen. The alternative buries the
//    next control on the page behind forty presses.
//  · The <details> table is the authoritative representation. It is not a
//    consolation prize for screen readers — it is where anyone goes to read an
//    exact number off a chart, which is why it is a plain disclosure any reader
//    can open rather than an sr-only block.
//
// MOTION. Bars grow from the baseline on mount, 180ms, via a CSS transform on
// the <g>; global.css's prefers-reduced-motion block flattens it to 0.01ms, so
// nothing here needs its own query. There is deliberately no transition on
// data CHANGE: a filter that re-animates every bar makes a dashboard feel like
// it is thinking rather than answering.

import { useId, type ReactElement, type ReactNode } from 'react'
import { Skeleton } from '../shared'
import { isolate } from '../../lib/bidi'
import { t, useLocale } from '../../lib/i18n'
import { DEFAULT_INSETS, plotArea, useChartSize, type Insets, type Plot } from './geometry'
import './charts.css'

export interface ChartColumn {
  key: string
  label: string
  /** Right-aligned in LTR, left in RTL — `.cht-num` is a logical alignment. */
  numeric?: boolean
}

export interface ChartRow {
  key: string
  cells: readonly (string | number)[]
}

export interface ChartFrameProps {
  /** The caption, and the <svg>'s accessible name. */
  title: string
  /** One visible line naming the window and the clock this chart reads. */
  desc?: string
  /** The <desc> shape summary. Falls back to `desc` when a chart has nothing
   *  sharper to say, which is still better than repeating the title. */
  summary?: string
  /** Plot height in CSS pixels, excluding the gutters. */
  height: number
  insets?: Insets
  /** Controls that belong to this chart alone (a basis switch). */
  toolbar?: ReactNode
  legend?: ReactNode
  columns: readonly ChartColumn[]
  rows: readonly ChartRow[]
  /** True when there is genuinely nothing to draw — not when it is still loading. */
  empty?: boolean
  emptyLabel?: string
  loading?: boolean
  className?: string
  children: (plot: Plot) => ReactNode
}

export function ChartFrame({
  title,
  desc,
  summary,
  height,
  insets = DEFAULT_INSETS,
  toolbar,
  legend,
  columns,
  rows,
  empty = false,
  emptyLabel,
  loading = false,
  className,
  children,
}: ChartFrameProps): ReactElement {
  const locale = useLocale()
  const ids = useId()
  const { ref, width } = useChartSize()
  const plot = plotArea(width, height, insets, locale === 'ar')

  return (
    <figure className={className ? `cht ${className}` : 'cht'}>
      <figcaption className="cht-head">
        <h3 className="cht-title" id={`${ids}-cap`}>
          {title}
        </h3>
        {toolbar && <div className="cht-tools">{toolbar}</div>}
      </figcaption>

      {desc && <p className="cht-desc">{desc}</p>}

      {loading ? (
        <div className="cht-plot" style={{ blockSize: height }}>
          <Skeleton height={height} />
        </div>
      ) : empty ? (
        <p className="cht-empty" style={{ minBlockSize: height }}>
          {emptyLabel ?? t('dashboard.chartEmpty')}
        </p>
      ) : (
        <>
          <div className="cht-plot" ref={ref}>
            <svg
              className="cht-svg"
              width={width}
              height={height}
              viewBox={`0 0 ${width} ${height}`}
              role="group"
              aria-labelledby={`${ids}-t`}
              aria-describedby={`${ids}-d`}
            >
              <title id={`${ids}-t`}>{title}</title>
              <desc id={`${ids}-d`}>{summary ?? desc ?? title}</desc>
              {children(plot)}
            </svg>
          </div>

          {legend}

          <details className="cht-fallback">
            <summary className="cht-fallback-toggle">{t('dashboard.showData')}</summary>
            <div className="cht-tablewrap">
              <table className="cht-table">
                <caption className="sr-only">{title}</caption>
                <thead>
                  <tr>
                    {columns.map((c) => (
                      <th key={c.key} scope="col" className={c.numeric ? 'cht-num' : undefined}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key}>
                      {row.cells.map((cell, i) => {
                        const column = columns[i]
                        // The first cell is the row's own name, so it is a
                        // header cell — that is what lets a screen reader say
                        // "Network, closed, 4" instead of reading three
                        // unattached numbers.
                        return i === 0 ? (
                          <th key={column?.key ?? i} scope="row">
                            {cell}
                          </th>
                        ) : (
                          <td
                            key={column?.key ?? i}
                            className={column?.numeric ? 'cht-num tabular' : undefined}
                          >
                            {cell}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </figure>
  )
}

/**
 * One category = one tab stop, named in full.
 *
 * `role="img"` is correct HERE, unlike on the <svg> itself: a mark is a leaf
 * with no focusable children, and a name that already states every number in
 * it. `<title>` rides along for the native hover tooltip; `aria-label` is what
 * the accessible name actually resolves to, so the two are deliberately the
 * same string.
 */
export function ChartMark({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: ReactNode
}): ReactElement {
  return (
    <g
      className={className ? `cht-mark ${className}` : 'cht-mark'}
      role="img"
      tabIndex={0}
      aria-label={label}
    >
      <title>{label}</title>
      {children}
    </g>
  )
}

export interface LegendItem {
  key: string
  label: string
  /** The `.cht-c-*` class carrying this series' colour. */
  tone: string
  value?: string
}

/**
 * The colour key. `aria-hidden` on the swatch only — the label is real text and
 * every number it explains is in the table below, so the legend adds nothing an
 * assistive user needs to hear twice.
 */
export function ChartLegend({ items }: { items: readonly LegendItem[] }): ReactElement {
  return (
    <ul className="cht-legend">
      {items.map((item) => (
        <li key={item.key} className="cht-legend-item">
          <span className={`cht-swatch ${item.tone}`} aria-hidden="true" />
          <span className="cht-legend-label">{item.label}</span>
          {item.value !== undefined && (
            <span className="cht-legend-value tabular">{item.value}</span>
          )}
        </li>
      ))}
    </ul>
  )
}

/**
 * Value-axis gridlines and their labels.
 *
 * The lines run the full plot width and the labels sit in the `start` gutter,
 * anchored at the reading END so they hug the axis in both directions. The zero
 * line is drawn stronger than the rest: it is the baseline every bar is
 * measured from, not a gridline.
 */
export function ChartAxis({
  plot,
  ticks,
  y,
}: {
  plot: Plot
  ticks: readonly number[]
  y: (v: number) => number
}): ReactElement {
  return (
    <g className="cht-axis" aria-hidden="true">
      {ticks.map((value) => {
        const at = y(value)
        return (
          <g key={value}>
            <line
              className={value === 0 ? 'cht-baseline' : 'cht-gridline'}
              x1={plot.left}
              x2={plot.right}
              y1={at}
              y2={at}
            />
            <text
              className="cht-tick"
              x={plot.rtl ? plot.right + 6 : plot.left - 6}
              y={at}
              textAnchor={plot.rtl ? 'start' : 'end'}
              dominantBaseline="middle"
            >
              {value}
            </text>
          </g>
        )
      })}
    </g>
  )
}

/**
 * Category labels under the plot.
 *
 * Truncation is by character count rather than by measuring: a track called
 * "Infrastructure and Facilities" is 29 characters into a 60px slot, and
 * measuring text inside an SVG means a second layout pass per render for a
 * label whose full text is one row away in the table.
 *
 * THE LABEL IS ISOLATED, because it is a track name and a track name is
 * whatever an admin typed. SVG <text> is laid out by the same bidi algorithm as
 * everything else and inherits `direction: rtl` from <html>, so under Arabic a
 * label of `2026 Refresh` renders `Refresh 2026` and `شبكة / Network` renders
 * `Network / شبكة` — reordered, not broken, which is the kind nobody reports.
 * Isolate AFTER truncating: slicing a string that already carries an FSI cuts
 * the control off and leaves the run open over the rest of the group.
 */
export function ChartCategories({
  plot,
  labels,
  center,
}: {
  plot: Plot
  labels: readonly string[]
  center: (i: number) => number
}): ReactElement {
  const budget = Math.max(3, Math.floor(plot.innerWidth / Math.max(1, labels.length) / 7))
  return (
    <g className="cht-cats" aria-hidden="true">
      {labels.map((label, i) => (
        <text
          key={`${label}-${i}`}
          className="cht-cat"
          x={center(i)}
          y={plot.bottom + 16}
          textAnchor="middle"
        >
          {isolate(label.length > budget ? `${label.slice(0, Math.max(1, budget - 1))}…` : label)}
        </text>
      ))}
    </g>
  )
}
