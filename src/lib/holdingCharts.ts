/** Each panel stacks contracts; the two panels share a peak, not their sum. */
export function stackedPeak(stacks: ReadonlyArray<ReadonlyArray<number | null>>): number {
  const length = Math.max(0, ...stacks.map(values => values.length))
  let peak = 0
  for (let index = 0; index < length; index++) {
    const total = stacks.reduce((sum, values) => {
      const value = values[index]
      return sum + (value != null && Number.isFinite(value) ? Math.max(0, value) : 0)
    }, 0)
    peak = Math.max(peak, total)
  }
  return peak
}

export function sharedHandMax(
  longs: ReadonlyArray<ReadonlyArray<number | null>>,
  shorts: ReadonlyArray<ReadonlyArray<number | null>>,
): number {
  return Math.max(1, stackedPeak(longs), stackedPeak(shorts))
}
