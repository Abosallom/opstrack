// The arithmetic behind every hand-rolled chart on the dashboard.
//
// NO CHART LIBRARY, by directive, so this is the part a library would have
// given us: a plot rectangle, a band scale, a linear scale, a tick generator,
// and the one hook that measures the container. It is deliberately a `.ts`
// file with no JSX — every function here is pure except `useChartSize`, and
// none of them knows what a track or an entry is.
//
// SVG HAS NO LOGICAL PROPERTIES, AND THAT IS THE WHOLE REASON THIS MODULE
// EXISTS. Everywhere else in this repo, RTL costs nothing because the CSS is
// written in `inline-start`/`inline-end`. Inside an <svg> there is only `x`,
// and a chart drawn left-to-right in an Arabic layout reads backwards: the
// oldest week lands where the reader's eye finishes. So DIRECTION IS AN INPUT
// HERE, resolved once into `plotArea()`, and every scale below is built from
// the resolved rectangle. No component multiplies an x by anything.
//
// THE BLOCK AXIS NEVER MIRRORS. Arabic reverses the inline direction, not
// gravity — a bar chart's zero line stays at the bottom and taller still means
// more. Only `bandScale` and `linearX` flip; `linearY` is direction-blind.
//
// UNITS ARE CSS PIXELS, 1:1. The svg is sized in px from a measured container
// rather than scaled from a fixed viewBox, because a viewBox that stretches
// scales the TEXT with it — an 11px axis label becomes 7px on a 343px phone
// card and 14px on a desktop one, from the same source. Measuring costs one
// ResizeObserver per chart and buys type that is the size it says it is.

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

/** Space reserved outside the plot, in reading terms rather than physical ones. */
export interface Insets {
  top: number
  bottom: number
  /** Toward the reading start — the axis-label gutter. */
  start: number
  end: number
}

/**
 * The resolved drawing rectangle, in physical coordinates.
 *
 * `left`/`right` are already direction-corrected: `start` inset lands on the
 * right in Arabic. Consumers read this and never look at `rtl` again, except
 * for text anchoring, which is why the flag rides along.
 */
export interface Plot {
  width: number
  height: number
  left: number
  right: number
  top: number
  bottom: number
  innerWidth: number
  innerHeight: number
  rtl: boolean
  /** Where the value axis lives: the reading-start edge, physically resolved. */
  axisX: number
}

/**
 * The gutters a column chart needs: `start` holds the value-axis labels,
 * `bottom` the category labels. Lives here rather than beside ChartFrame so
 * that file exports components and nothing else — otherwise React Fast Refresh
 * gives up on it, which is a real cost every time a chart is being tuned.
 */
export const DEFAULT_INSETS: Insets = { top: 10, bottom: 26, start: 30, end: 8 }

export function plotArea(width: number, height: number, insets: Insets, rtl: boolean): Plot {
  const left = rtl ? insets.end : insets.start
  const right = width - (rtl ? insets.start : insets.end)
  const top = insets.top
  const bottom = height - insets.bottom
  return {
    width,
    height,
    left,
    right,
    top,
    bottom,
    // Clamped at zero: a container measured mid-transition can be narrower than
    // its own gutters, and a negative width paints an inverted rect that Chrome
    // renders as a full-bleed smear for one frame.
    innerWidth: Math.max(0, right - left),
    innerHeight: Math.max(0, bottom - top),
    rtl,
    axisX: rtl ? right : left,
  }
}

/** Where each category sits along the inline axis. */
export interface Band {
  /** Physical x of slot `i`'s leading edge. */
  x: (i: number) => number
  center: (i: number) => number
  step: number
  bandWidth: number
}

/**
 * One slot per category, evenly spaced, mirrored in Arabic so slot 0 is always
 * the one the reader meets first.
 *
 * `pad` is the share of a step left as gutter. 0.3 is the default because a
 * bar chart with no gap reads as an area chart, and a gap wider than a third
 * makes eight weekly bars look like eight unrelated events.
 */
export function bandScale(p: Plot, count: number, pad = 0.3): Band {
  const n = Math.max(1, count)
  const step = p.innerWidth / n
  const bandWidth = Math.max(1, step * (1 - pad))
  const offset = (step - bandWidth) / 2
  const x = (i: number): number =>
    p.rtl ? p.right - (i + 1) * step + offset : p.left + i * step + offset
  return { x, center: (i) => x(i) + bandWidth / 2, step, bandWidth }
}

/**
 * Value → physical y. Never mirrored: see this file's header.
 *
 * `max` of zero yields a flat baseline rather than a division by zero, which is
 * the honest picture of a workspace with nothing in it.
 */
export function linearY(p: Plot, max: number): (v: number) => number {
  if (max <= 0) return () => p.bottom
  return (v) => p.bottom - (Math.max(0, v) / max) * p.innerHeight
}

/**
 * A horizontal magnitude, as `{ x, width }` ready for a <rect>.
 *
 * This one DOES mirror: a horizontal bar grows away from the reading-start
 * edge, so in Arabic it grows leftwards from the right. `from`/`to` are values
 * on the same scale, which is what lets a stacked segment be placed by its two
 * cumulative bounds without the caller knowing which way is forward.
 */
export function spanX(
  p: Plot,
  max: number,
  from: number,
  to: number,
): { x: number; width: number } {
  if (max <= 0) return { x: p.axisX, width: 0 }
  const unit = p.innerWidth / max
  const a = Math.max(0, Math.min(from, to)) * unit
  const b = Math.max(0, Math.max(from, to)) * unit
  return p.rtl ? { x: p.right - b, width: b - a } : { x: p.left + a, width: b - a }
}

/** The value-axis ticks, and the rounded ceiling they were chosen for. */
export interface Ticks {
  max: number
  values: number[]
}

/**
 * A "nice" ceiling and evenly spaced ticks, in WHOLE ITEMS.
 *
 * Everything this dashboard counts is a countable thing, so a gridline at 2.5
 * items is noise. The step walks 1, 2, 5, 10, 20, 50 … which is the standard
 * decade ladder and the reason a chart of 7 items gets ticks at 0/2/4/6/8
 * rather than 0/1.75/3.5.
 *
 * An empty dataset returns a 0–1 axis rather than 0–0: one gridline at the top
 * gives the empty plot a shape, and every bar in it is legitimately zero-high.
 */
export function niceTicks(max: number, target = 4): Ticks {
  if (!Number.isFinite(max) || max <= 0) return { max: 1, values: [0, 1] }
  const rough = max / Math.max(1, target)
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const normalized = rough / magnitude
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  const step = Math.max(1, factor * magnitude)
  const ceiling = Math.ceil(max / step) * step
  const values: number[] = []
  for (let v = 0; v <= ceiling + step / 2; v += step) values.push(Math.round(v))
  return { max: ceiling, values }
}

/** Highest total across a set of series, for a shared axis. */
export function maxOf(values: readonly number[]): number {
  let max = 0
  for (const v of values) if (v > max) max = v
  return max
}

/**
 * The container's inline size in CSS pixels, tracked live.
 *
 * `fallback` is what the first render and every non-browser render use — the
 * page tests in this repo run through `renderToStaticMarkup` under vitest's
 * node environment, where there is no layout and no ResizeObserver, and a
 * chart that rendered nothing until measured would make every one of those
 * tests assert on an empty <svg>. So a chart is always drawable; it is simply
 * drawn at a default width until the browser says otherwise.
 *
 * The observer is torn down with the element, and the state write is guarded on
 * an actual change: ResizeObserver fires on every reflow, and setting the same
 * number back would re-render the whole chart on a sibling's animation frame.
 */
export function useChartSize(fallback = 340): {
  ref: RefObject<HTMLDivElement | null>
  width: number
} {
  const ref = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(fallback)

  const measure = useCallback((el: HTMLDivElement) => {
    const next = Math.round(el.clientWidth)
    if (next > 0) setWidth((prev) => (prev === next ? prev : next))
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    measure(el)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      measure(el)
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
    }
  }, [measure])

  return { ref, width }
}
