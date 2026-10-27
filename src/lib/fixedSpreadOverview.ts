import type { FixedContractSpreadChart } from '../api/index.ts'

export interface SpreadAxisBounds {
  min: number
  max: number
  interval: number
}

export interface FixedSpreadView {
  startDate: string
  endDate: string
  selected: Record<string, boolean>
}

export const FIXED_SPREAD_COLORS = ['#18a0ff', '#f0ad4e', '#9b8afb', '#32c5a2', '#e56b9f']

export const FIXED_SPREAD_CURVE_STYLES = [
  { width: 3, opacity: 1 },
  { width: 2.3, opacity: 0.95 },
  { width: 1.8, opacity: 0.85 },
  { width: 1.5, opacity: 0.74 },
  { width: 1.3, opacity: 0.65 },
]

/** Share one scale across the pair's visible dates and selected spread curves. */
export function sharedSpreadAxis(
  charts: readonly FixedContractSpreadChart[],
  views: readonly FixedSpreadView[],
  fallback: SpreadAxisBounds = { min: -1, max: 1, interval: 0.5 },
): SpreadAxisBounds {
  let low = Infinity
  let high = -Infinity

  charts.forEach((chart, index) => {
    const view = views[index]
    for (const series of chart.series) {
      if (view?.selected[series.label] === false) continue
      for (const point of series.points) {
        if (point.v == null || !Number.isFinite(point.v)) continue
        if (view?.startDate && point.d < view.startDate) continue
        if (view?.endDate && point.d > view.endDate) continue
        low = Math.min(low, point.v)
        high = Math.max(high, point.v)
      }
    }
  })

  // Hiding every curve or selecting an empty date range must not reset the scale.
  if (!Number.isFinite(low)) return fallback

  const padding = high > low ? (high - low) * 0.04 : Math.max(Math.abs(low) * 0.04, 1)
  const approximateStep = (high - low + padding * 2) / 5
  const power = 10 ** Math.floor(Math.log10(approximateStep))
  const multiplier = [1, 2, 2.5, 5, 10].find(value => value >= approximateStep / power) ?? 10
  const interval = multiplier * power
  const clean = (value: number) => Number(value.toPrecision(12))

  return {
    min: clean(Math.floor((low - padding) / interval) * interval),
    max: clean(Math.ceil((high + padding) / interval) * interval),
    interval: clean(interval),
  }
}
