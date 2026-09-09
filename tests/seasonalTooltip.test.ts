import assert from 'node:assert/strict'
import test from 'node:test'

import { pointAtMonthDay } from '../src/lib/seasonalTooltip.ts'

test('seasonal tooltip only returns a point for the selected month and day', () => {
  const points = [
    { x: '09-07', d: '2026-09-07', v: -181 },
    { x: '09-08', d: '2026-09-08', v: -175 },
  ]

  assert.equal(pointAtMonthDay(points, '09-08')?.v, -175)
  assert.equal(pointAtMonthDay(points, '12-31'), null)
})
