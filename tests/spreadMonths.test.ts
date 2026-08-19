import assert from 'node:assert/strict'
import test from 'node:test'

import { defaultSpreadMonth } from '../src/lib/spreadMonths.ts'

test('defaultSpreadMonth prefers the nearest current structure month over retained history', () => {
  const month = defaultSpreadMonth(
    [{ month: '202611' }, { month: '202612' }],
    [{ month: '202605' }, { month: '202606' }, { month: '202611' }],
  )

  assert.equal(month, '202611')
})
