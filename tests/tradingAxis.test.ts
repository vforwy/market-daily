import assert from 'node:assert/strict'
import test from 'node:test'

import { tradingDates } from '../src/lib/tradingAxis.ts'

test('tradingDates uses only observed dates and keeps them ordered', () => {
  const dates = tradingDates([
    [{ d: '2026-08-11' }, { d: '2026-08-07' }],
    [{ d: '2026-08-10' }, { d: '2026-08-11' }],
  ])

  assert.deepEqual(dates, ['2026-08-07', '2026-08-10', '2026-08-11'])
})
