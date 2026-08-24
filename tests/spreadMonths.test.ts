import assert from 'node:assert/strict'
import test from 'node:test'

import { defaultSpreadMonth, spreadMonthColor } from '../src/lib/spreadMonths.ts'

test('defaultSpreadMonth prefers the nearest current structure month over retained history', () => {
  const month = defaultSpreadMonth(
    [{ month: '202611' }, { month: '202612' }],
    [{ month: '202605' }, { month: '202606' }, { month: '202611' }],
  )

  assert.equal(month, '202611')
})

test('spreadMonthColor is stable when the selected contract set changes', () => {
  const firstSelection = Object.fromEntries(
    ['202611', '202612'].map(month => [month, spreadMonthColor(month)]),
  )
  const secondSelection = Object.fromEntries(
    ['202609', '202610', '202611', '202612'].map(month => [month, spreadMonthColor(month)]),
  )

  assert.equal(firstSelection['202611'], secondSelection['202611'])
  assert.notEqual(spreadMonthColor('202611'), spreadMonthColor('202612'))
  assert.notEqual(spreadMonthColor('202611'), spreadMonthColor('202711'))
})

test('spreadMonthColor uses the comma-separated HSL syntax supported by zrender', () => {
  assert.match(spreadMonthColor('202611'), /^hsl\(\d+, 68%, 62%\)$/)
})
