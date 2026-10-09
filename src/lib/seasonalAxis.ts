export interface SeasonalAxisPoint {
  x: string
  d: string
}

export type SeasonalAxis = 'delivery-year' | undefined

export type SeasonalWindow = {
  nearMonth: number
  farMonth: number
  farYearOffset: 0 | 1
  startYearOffset: -1 | 0
}

export function calendarSeasonalWindow(
  nearMonth?: string,
  farMonth?: string,
  farYearOffset?: number,
): SeasonalWindow | undefined {
  if (typeof nearMonth !== 'string' || !/^[0-9]{1,2}$/.test(nearMonth)
    || typeof farMonth !== 'string' || !/^[0-9]{1,2}$/.test(farMonth)) return undefined
  const near = Number(nearMonth)
  const far = Number(farMonth)
  if (near < 1 || near > 12 || far < 1 || far > 12 || near === far) return undefined
  const expectedOffset = near < far ? 0 : 1
  if (farYearOffset !== expectedOffset) return undefined
  return {
    nearMonth: near,
    farMonth: far,
    farYearOffset: expectedOffset,
    startYearOffset: expectedOffset === 0 ? -1 : 0,
  }
}

function isCalendarSeasonalWindow(window?: SeasonalWindow): window is SeasonalWindow {
  if (!window) return false
  const validated = calendarSeasonalWindow(String(window.nearMonth), String(window.farMonth), window.farYearOffset)
  return Boolean(validated && validated.startYearOffset === window.startYearOffset)
}

export function seasonalWindowLabel(window: SeasonalWindow): string {
  return `${window.farMonth}月—${window.startYearOffset === -1 ? '次年' : ''}${window.nearMonth}月底`
}

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
  window?: SeasonalWindow,
): string[] {
  const axisKeys = new Set<string>()
  if (seasonAxis === 'delivery-year' && isCalendarSeasonalWindow(window)) {
    // Only the display axis is bounded; source quotations are never cropped or filled.
    for (const year of years) {
      const lastDay = Date.UTC(year, window.nearMonth, 0)
      for (let day = Date.UTC(year + window.startYearOffset, window.farMonth - 1, 1); day <= lastDay; day += 86_400_000) {
        const date = new Date(day)
        axisKeys.add(`${date.getUTCFullYear() - year}:${date.toISOString().slice(5, 10)}`)
      }
    }
  } else {
    for (const year of years) {
      for (const point of seriesByYear[String(year)] ?? []) {
        axisKeys.add(seasonalPointKey(point, year, seasonAxis))
      }
    }
  }
  const keys = [...axisKeys]
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
  window?: SeasonalWindow,
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
  if (isCalendarSeasonalWindow(window)) return `${month}月`
  return offset !== previousOffset
    ? `${relativeYearLabel(Number(offset))}\n${month}月`
    : `${month}月`
}

export function seasonalAxisTooltipLabel(
  axisKey: string,
  seasonAxis: SeasonalAxis,
  window?: SeasonalWindow,
): string {
  if (seasonAxis !== 'delivery-year' || !axisKey) return axisKey
  const [offset, date] = axisKey.split(':')
  if (isCalendarSeasonalWindow(window)) return date
  return `${relativeYearLabel(Number(offset))} ${date}`
}
