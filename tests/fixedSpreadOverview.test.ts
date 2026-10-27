import assert from 'node:assert/strict'
import test from 'node:test'
import type { FixedContractSpreadChart } from '../src/api/index.ts'
import {
  sharedSpreadAxis,
  type FixedSpreadView,
} from '../src/lib/fixedSpreadOverview.ts'

function chart(
  series: { label: string; values: [string, number | null][] }[],
): FixedContractSpreadChart {
  return {
    nearCode: 'FU2701.SHF',
    nearLabel: '2027-01',
    series: series.map(({ label, values }) => ({
      label,
      farCode: label,
      farLabel: label,
      points: values.map(([d, v]) => ({ d, v, nearPrice: null, farPrice: null })),
    })),
  }
}

const all: FixedSpreadView = { startDate: '', endDate: '', selected: {} }

test('one shared scale includes both charts and has matching regular ticks', () => {
  const left = chart([{ label: 'near', values: [['2026-10-26', -40], ['2026-10-27', 60]] }])
  const right = chart([{ label: 'far', values: [['2026-10-27', 160]] }])
  const axis = sharedSpreadAxis([left, right], [all, all])
  assert.ok(axis.min <= -40)
  assert.ok(axis.max >= 160)
  assert.ok(axis.interval > 0)
  assert.ok(Number.isInteger((axis.max - axis.min) / axis.interval))
  assert.deepEqual(axis, sharedSpreadAxis([right, left], [all, all]))
})

test('date ranges and selected curves remove historical or hidden outliers from the pair', () => {
  const left = chart([
    { label: 'near', values: [['2026-01-05', 5000], ['2026-10-27', 10]] },
    { label: 'hidden', values: [['2026-10-27', -5000]] },
  ])
  const right = chart([{ label: 'far', values: [['2026-10-27', 25], ['2026-10-28', 9000]] }])
  const view: FixedSpreadView = {
    startDate: '2026-10-01', endDate: '2026-10-27', selected: { hidden: false },
  }
  const axis = sharedSpreadAxis([left, right], [view, view])
  assert.ok(axis.min > 0 && axis.min <= 10)
  assert.ok(axis.max >= 25 && axis.max < 100)
})

test('null and non-finite observations do not become a zero spread', () => {
  const values: [string, number | null][] = [
    ['2026-10-23', null], ['2026-10-26', NaN], ['2026-10-27', 100],
  ]
  const axis = sharedSpreadAxis([chart([{ label: 'spread', values }])], [all])
  assert.ok(axis.min > 0)
  assert.ok(axis.min < 100 && axis.max > 100)
})

test('constant and zero spreads retain a finite, non-zero axis span', () => {
  for (const value of [0, 0.05, -100]) {
    const axis = sharedSpreadAxis([
      chart([{ label: 'spread', values: [['2026-10-27', value]] }]),
    ], [all])
    assert.ok(Number.isFinite(axis.min) && Number.isFinite(axis.max))
    assert.ok(axis.min < value && axis.max > value)
    assert.ok(axis.interval > 0)
  }
})

test('all-hidden, absent and empty-window data preserve the previous pair scale', () => {
  const previous = { min: -50, max: 100, interval: 25 }
  const item = chart([{ label: 'spread', values: [['2026-10-27', 10]] }])
  assert.deepEqual(sharedSpreadAxis([item], [{ ...all, selected: { spread: false } }], previous), previous)
  assert.deepEqual(sharedSpreadAxis([item], [{ ...all, endDate: '2026-10-26' }], previous), previous)
  assert.deepEqual(sharedSpreadAxis([], [], previous), previous)
  assert.deepEqual(sharedSpreadAxis([], []), { min: -1, max: 1, interval: 0.5 })
})
