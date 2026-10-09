import assert from 'node:assert/strict'
import test from 'node:test'
import {
  pointAtSeasonAxisKey,
  seasonalAxisKeys,
  seasonalAxisLabel,
  seasonalAxisTooltipLabel,
  seasonalPointKey,
  seasonalYears,
} from '../src/lib/seasonalAxis.ts'

const deliveryAxis = 'delivery-year'

test('ordinary seasonality keeps calendar years, month-day order and exact tooltip matches', () => {
  const series = {
    '2025': [{ x: '10-02', d: '2025-10-02', v: 10 }],
    '2026': [{ x: '01-02', d: '2026-01-02', v: 20 }],
  }
  assert.deepEqual(seasonalYears(series, [2024, 2025, 2026], undefined), [2024, 2025, 2026])
  assert.deepEqual(seasonalAxisKeys(series, [2025, 2026], undefined), ['01-02', '10-02'])
  assert.equal(seasonalPointKey(series['2025'][0], 2025, undefined), '10-02')
  assert.equal(pointAtSeasonAxisKey(series['2025'], '10-02', 2025, undefined)?.v, 10)
  assert.equal(pointAtSeasonAxisKey(series['2025'], '10-01', 2025, undefined), null)
  assert.equal(seasonalAxisLabel('10-02', '09-30', undefined), '10')
  assert.equal(seasonalAxisLabel('10-02', '10-01', undefined), '')
  assert.equal(seasonalAxisTooltipLabel('10-02', undefined), '10-02')
})

test('fixed delivery-year pairs keep the full previous-year common quotation window before January', () => {
  const series = {
    '2025': [
      { x: '10-09', d: '2024-10-09', instance: '2501-2505' },
      { x: '12-31', d: '2024-12-31', instance: '2501-2505' },
      { x: '01-02', d: '2025-01-02', instance: '2501-2505' },
    ],
    '2026': [
      { x: '10-10', d: '2025-10-10', instance: '2601-2605' },
      { x: '01-05', d: '2026-01-05', instance: '2601-2605' },
    ],
  }
  assert.deepEqual(seasonalAxisKeys(series, [2025, 2026], deliveryAxis), [
    '-1:10-09', '-1:10-10', '-1:12-31', '0:01-02', '0:01-05',
  ])
  assert.equal(pointAtSeasonAxisKey(series['2026'], '-1:10-10', 2026, deliveryAxis)?.d, '2025-10-10')
  assert.equal(pointAtSeasonAxisKey(series['2026'], '-1:10-09', 2026, deliveryAxis), null)
})

test('the same month-day in different quotation years has distinct axis and tooltip keys', () => {
  const points = [
    { x: '01-05', d: '2025-01-05', v: 101, instance: '2601-2605' },
    { x: '01-05', d: '2026-01-05', v: 202, instance: '2601-2605' },
  ]
  assert.deepEqual(seasonalAxisKeys({ '2026': points }, [2026], deliveryAxis), ['-1:01-05', '0:01-05'])
  assert.equal(pointAtSeasonAxisKey(points, '-1:01-05', 2026, deliveryAxis)?.v, 101)
  assert.equal(pointAtSeasonAxisKey(points, '0:01-05', 2026, deliveryAxis)?.v, 202)
})

test('relative-year sorting handles longer listing windows numerically without a 365-day shortcut', () => {
  const points = [
    { x: '01-02', d: '2026-01-02' },
    { x: '12-31', d: '2024-12-31' },
    { x: '10-09', d: '2025-10-09' },
    { x: '10-09', d: '2024-10-09' },
  ]
  assert.deepEqual(seasonalAxisKeys({ '2026': points }, [2026], deliveryAxis), [
    '-2:10-09', '-2:12-31', '-1:10-09', '0:01-02',
  ])
})

test('leap-day observations remain distinct and March aligns by month-day across delivery years', () => {
  const series = {
    '2025': [{ x: '02-29', d: '2024-02-29' }, { x: '03-01', d: '2024-03-01' }],
    '2026': [{ x: '03-01', d: '2025-03-01' }],
  }
  assert.deepEqual(seasonalAxisKeys(series, [2025, 2026], deliveryAxis), ['-1:02-29', '-1:03-01'])
  assert.equal(seasonalPointKey(series['2025'][1], 2025, deliveryAxis), seasonalPointKey(series['2026'][0], 2026, deliveryAxis))
})

test('delivery-year curves use actual per-chart years including next-year contracts, capped at five', () => {
  const series = Object.fromEntries(Array.from({ length: 7 }, (_, index) => {
    const year = 2021 + index
    return [String(year), [{ x: '10-09', d: `${year - 1}-10-09` }]]
  }))
  assert.deepEqual(seasonalYears(series, [2022, 2023, 2024, 2025, 2026], deliveryAxis), [2023, 2024, 2025, 2026, 2027])
  assert.deepEqual(seasonalYears({}, [2026], deliveryAxis), [])
})

test('axis labels show the relative-year transition and tooltip retains the exact relative date', () => {
  assert.equal(seasonalAxisLabel('-1:10-09', undefined, deliveryAxis), '前一年\n10月')
  assert.equal(seasonalAxisLabel('-1:10-10', '-1:10-09', deliveryAxis), '')
  assert.equal(seasonalAxisLabel('-1:11-02', '-1:10-31', deliveryAxis), '11月')
  assert.equal(seasonalAxisLabel('0:01-02', '-1:12-31', deliveryAxis), '交割年\n01月')
  assert.equal(seasonalAxisLabel('-2:10-09', undefined, deliveryAxis), '前2年\n10月')
  assert.equal(seasonalAxisTooltipLabel('-1:10-09', deliveryAxis), '前一年 10-09')
  assert.equal(seasonalAxisTooltipLabel('0:01-02', deliveryAxis), '交割年 01-02')
  assert.equal(seasonalAxisTooltipLabel('', deliveryAxis), '')
})
