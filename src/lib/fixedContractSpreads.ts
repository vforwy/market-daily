export function fixedContractNearCode(
  charts: readonly { nearCode: string }[],
  preferredCode: string,
): string {
  if (charts.some(chart => chart.nearCode === preferredCode)) return preferredCode
  // Historical options arrive in maturity order; start with the most recent one.
  return charts.at(-1)?.nearCode ?? ''
}
