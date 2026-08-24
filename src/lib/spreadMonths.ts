interface SpreadMonth {
  month: string
}

const FALLBACK_MONTH_COLOR = '#8f98a5'
const GOLDEN_ANGLE = 137.508

export function spreadMonthColor(monthKey: string): string {
  const match = /^(\d{4})(\d{2})$/.exec(monthKey)
  if (!match) return FALLBACK_MONTH_COLOR
  const year = Number(match[1])
  const month = Number(match[2])
  if (month < 1 || month > 12) return FALLBACK_MONTH_COLOR
  const monthIndex = year * 12 + month - 1
  const hue = Math.round((monthIndex * GOLDEN_ANGLE) % 360)
  return `hsl(${hue}, 68%, 62%)`
}

export function defaultSpreadMonth(
  structure: ReadonlyArray<SpreadMonth>,
  monthSeries: ReadonlyArray<SpreadMonth>,
): string | undefined {
  return structure[0]?.month ?? monthSeries.at(-1)?.month
}
