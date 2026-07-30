// The chart kit's public surface. Import from here, never from a file inside.
//
// Same reason components/entry/index.ts exists: the dashboard should not have
// to know that the frame and the mark live in Chart.tsx while the scales live
// in geometry.ts, and a future sixth chart should be able to move code between
// those two files without touching a page.

export { ChartAxis, ChartCategories, ChartFrame, ChartLegend, ChartMark } from './Chart'
export type { ChartColumn, ChartFrameProps, ChartRow, LegendItem } from './Chart'

export { AgingChart } from './AgingChart'
export { OwnerLoadTable } from './OwnerLoadTable'
export type { OwnerLoadRow } from './OwnerLoadTable'
export { SlaChart, SlaHeadline } from './SlaChart'
export { ThroughputChart } from './ThroughputChart'
export { TrackLoadChart } from './TrackLoadChart'
export type { TrackLoadRow } from './TrackLoadChart'

export {
  DEFAULT_INSETS,
  bandScale,
  linearY,
  maxOf,
  niceTicks,
  plotArea,
  spanX,
  useChartSize,
} from './geometry'
export type { Band, Insets, Plot, Ticks } from './geometry'
