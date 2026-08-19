export interface DatedPoint {
  d: string
}

export function tradingDates(
  series: ReadonlyArray<ReadonlyArray<DatedPoint>>,
): string[] {
  const observed = new Set<string>()
  for (const points of series) {
    for (const point of points) {
      if (point.d) observed.add(point.d)
    }
  }
  return [...observed].sort()
}
