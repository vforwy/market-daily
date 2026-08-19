interface SpreadMonth {
  month: string
}

export function defaultSpreadMonth(
  structure: ReadonlyArray<SpreadMonth>,
  monthSeries: ReadonlyArray<SpreadMonth>,
): string | undefined {
  return structure[0]?.month ?? monthSeries.at(-1)?.month
}
