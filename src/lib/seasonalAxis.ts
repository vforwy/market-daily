export interface SeasonalAxisPoint {
  x: string
  d: string
}

export type SeasonalAxis = 'delivery-year' | undefined

/** Ordinary seasonal charts still use the response's calendar-year selection. */
export function seasonalYears<T>(
  seriesByYear: Record<string, T[]>,
  years: number[],
  seasonAxis: SeasonalAxis,
): number[] {
  const availableYears = seasonAxis === 'delivery-year'
    ? Object.keys(seriesByYear).map(Number).filter(Number.isInteger).sort((a, b) => a - b)
    : years
  return availableYears.slice(-5)
}

export function seasonalPointKey(
  point: SeasonalAxisPoint,
  deliveryYear: number,
  seasonAxis: SeasonalAxis,
): string {
  if (seasonAxis !== 'delivery-year') return point.x
  return `${Number(point.d.slice(0, 4)) - deliveryYear}:${point.d.slice(5)}`
}

export function seasonalAxisKeys<T extends SeasonalAxisPoint>(
  seriesByYear: Record<string, T[]>,
  years: number[],
  seasonAxis: SeasonalAxis,
): string[] {
  const keys = [...new Set(years.flatMap(year => (
    seriesByYear[String(year)] ?? []
  ).map(point => seasonalPointKey(point, year, seasonAxis))))]
  if (seasonAxis !== 'delivery-year') return keys.sort()
  return keys.sort((a, b) => {
    const [aOffset, aDate] = a.split(':')
    const [bOffset, bDate] = b.split(':')
    return Number(aOffset) - Number(bOffset) || aDate.localeCompare(bDate)
  })
}

export function pointAtSeasonAxisKey<T extends SeasonalAxisPoint>(
  points: ReadonlyArray<T>,
  axisKey: string,
  deliveryYear: number,
  seasonAxis: SeasonalAxis,
): T | null {
  return points.find(point => seasonalPointKey(point, deliveryYear, seasonAxis) === axisKey) ?? null
}

function relativeYearLabel(offset: number): string {
  if (offset === 0) return '交割年'
  if (offset === -1) return '前一年'
  return offset < 0 ? `前${-offset}年` : `后${offset}年`
}

export function seasonalAxisLabel(
  axisKey: string,
  previousKey: string | undefined,
  seasonAxis: SeasonalAxis,
): string {
  if (seasonAxis !== 'delivery-year') {
    return !previousKey || previousKey.slice(0, 2) !== axisKey.slice(0, 2)
      ? axisKey.slice(0, 2)
      : ''
  }
  const [offset, date] = axisKey.split(':')
  const [previousOffset, previousDate] = previousKey?.split(':') ?? []
  const month = date.slice(0, 2)
  if (offset === previousOffset && month === previousDate?.slice(0, 2)) return ''
  return offset !== previousOffset
    ? `${relativeYearLabel(Number(offset))}\n${month}月`
    : `${month}月`
}

export function seasonalAxisTooltipLabel(axisKey: string, seasonAxis: SeasonalAxis): string {
  if (seasonAxis !== 'delivery-year' || !axisKey) return axisKey
  const [offset, date] = axisKey.split(':')
  return `${relativeYearLabel(Number(offset))} ${date}`
}
