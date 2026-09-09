export interface SeasonalTooltipPoint {
  x: string
}

export function pointAtMonthDay<T extends SeasonalTooltipPoint>(
  points: ReadonlyArray<T>,
  monthDay: string,
): T | null {
  return points.find(point => point.x === monthDay) ?? null
}
