import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calendarSeasonalWindow,
  pointAtSeasonAxisKey,
  seasonalAxisKeys,
  seasonalAxisLabel,
  seasonalAxisTooltipLabel,
  seasonalPointKey,
  seasonalYears,
  seasonalWindowLabel,
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

test('calendar window metadata requires valid months and consistent delivery-year offset', () => {
  assert.deepEqual(calendarSeasonalWindow('01', '05', 0), {
    nearMonth: 1, farMonth: 5, farYearOffset: 0, startYearOffset: -1,
  })
  assert.deepEqual(calendarSeasonalWindow('9', '1', 1), {
    nearMonth: 9, farMonth: 1, farYearOffset: 1, startYearOffset: 0,
  })
  for (const [near, far, offset] of [
    [undefined, '05', 0], ['01', undefined, 0], ['01', '05', undefined],
    ['00', '05', 0], ['01', '13', 0], ['1.5', '05', 0], ['01 ', '05', 0],
    ['01', '01', 0], ['01', '05', 1], ['09', '01', 0], ['09', '01', 2],
  ] as const) {
    assert.equal(calendarSeasonalWindow(near, far, offset), undefined)
  }
})

const windowCases = [
  { near: '01', far: '05', offset: 0, first: '-1:05-01', last: '0:01-31', label: '5月—次年1月底', months: [5, 6, 7, 8, 9, 10, 11, 12, 1] },
  { near: '05', far: '09', offset: 0, first: '-1:09-01', last: '0:05-31', label: '9月—次年5月底', months: [9, 10, 11, 12, 1, 2, 3, 4, 5] },
  { near: '09', far: '01', offset: 1, first: '0:01-01', last: '0:09-30', label: '1月—9月底', months: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
  { near: '05', far: '10', offset: 0, first: '-1:10-01', last: '0:05-31', label: '10月—次年5月底', months: [10, 11, 12, 1, 2, 3, 4, 5] },
  { near: '10', far: '01', offset: 1, first: '0:01-01', last: '0:10-31', label: '1月—10月底', months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
  { near: '09', far: '11', offset: 0, first: '-1:11-01', last: '0:09-30', label: '11月—次年9月底', months: [11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
]

for (const entry of windowCases) {
  test(`calendar window ${entry.near}-${entry.far} includes all UTC days and correct month-end boundaries`, () => {
    const window = calendarSeasonalWindow(entry.near, entry.far, entry.offset)
    assert.ok(window)
    const axis = seasonalAxisKeys({ '2026': [] }, [2026], deliveryAxis, window)
    assert.equal(axis[0], entry.first)
    assert.equal(axis.at(-1), entry.last)
    assert.equal(new Set(axis).size, axis.length)
    const firstDays = axis.filter(key => key.endsWith('-01'))
    assert.deepEqual(firstDays.map(key => Number(key.split(':')[1].slice(0, 2))), entry.months)
    assert.equal(seasonalWindowLabel(window), entry.label)
    assert.equal(seasonalAxisLabel(axis[0], undefined, deliveryAxis, window), `${entry.far}月`)
    for (let index = 1; index < axis.length; index += 1) {
      const toDate = (key: string) => {
        const [offset, date] = key.split(':')
        return Date.parse(`${2026 + Number(offset)}-${date}T00:00:00Z`)
      }
      assert.equal(toDate(axis[index]) - toDate(axis[index - 1]), 86_400_000)
    }
  })
}

test('complete calendar windows preserve actual leap days and 28/29-day February month ends', () => {
  const window = calendarSeasonalWindow('02', '05', 0)
  assert.ok(window)
  const nonLeapAxis = seasonalAxisKeys({ '2023': [] }, [2023], deliveryAxis, window)
  const leapAxis = seasonalAxisKeys({ '2024': [] }, [2024], deliveryAxis, window)
  const combinedAxis = seasonalAxisKeys({ '2023': [], '2024': [] }, [2023, 2024], deliveryAxis, window)
  assert.equal(nonLeapAxis.at(-1), '0:02-28')
  assert.equal(leapAxis.at(-1), '0:02-29')
  assert.equal(nonLeapAxis.includes('0:02-29'), false)
  assert.equal(leapAxis.length, nonLeapAxis.length + 1)
  assert.deepEqual(combinedAxis, leapAxis)
  const crossYearWindow = calendarSeasonalWindow('09', '01', 1)
  assert.ok(crossYearWindow)
  assert.equal(seasonalAxisKeys({ '2024': [] }, [2024], deliveryAxis, crossYearWindow).includes('0:02-29'), true)
})

test('calendar window leaves unquoted edges and calendar-day gaps null without mutating original quotes', () => {
  const points = Object.freeze([
    Object.freeze({ x: '04-30', d: '2025-04-30', v: 9, instance: '2601-2605' }),
    Object.freeze({ x: '05-15', d: '2025-05-15', v: 10, instance: '2601-2605' }),
    Object.freeze({ x: '01-14', d: '2026-01-14', v: 20, instance: '2601-2605' }),
  ])
  const series = { '2026': [...points] }
  const original = structuredClone(series)
  const window = calendarSeasonalWindow('01', '05', 0)
  assert.ok(window)
  const axis = seasonalAxisKeys(series, [2026], deliveryAxis, window)
  const plotted = axis.map(key => pointAtSeasonAxisKey(points, key, 2026, deliveryAxis))
  assert.equal(axis.includes('-1:04-30'), false)
  assert.equal(plotted[0], null)
  assert.equal(plotted.at(-1), null)
  assert.equal(plotted[axis.indexOf('-1:05-16')], null)
  assert.equal(plotted[axis.indexOf('-1:05-15')], points[1])
  assert.equal(plotted[axis.indexOf('0:01-14')], points[2])
  assert.deepEqual(series, original)
  assert.equal(pointAtSeasonAxisKey(points, '-1:04-30', 2026, deliveryAxis), points[0])
})

test('calendar labels use months and month-day only while keeping the complete relative axis key', () => {
  const window = calendarSeasonalWindow('01', '05', 0)
  assert.ok(window)
  assert.equal(seasonalAxisLabel('-1:05-01', undefined, deliveryAxis, window), '05月')
  assert.equal(seasonalAxisLabel('-1:05-02', '-1:05-01', deliveryAxis, window), '')
  assert.equal(seasonalAxisLabel('0:01-01', '-1:12-31', deliveryAxis, window), '01月')
  assert.equal(seasonalAxisTooltipLabel('-1:12-31', deliveryAxis, window), '12-31')
  assert.equal(seasonalAxisTooltipLabel('0:01-01', deliveryAxis, window), '01-01')
  assert.equal(seasonalAxisTooltipLabel('', deliveryAxis, window), '')
})

test('missing or invalid windows and ordinary charts retain the original observed-axis behavior', () => {
  const series = { '2026': [{ x: '10-09', d: '2025-10-09' }, { x: '01-14', d: '2026-01-14' }] }
  const window = calendarSeasonalWindow('01', '05', 0)
  assert.ok(window)
  assert.deepEqual(seasonalAxisKeys(series, [2026], undefined, window), ['01-14', '10-09'])
  assert.equal(seasonalAxisLabel('01-14', '12-31', undefined, window), '01')
  assert.equal(seasonalAxisTooltipLabel('01-14', undefined, window), '01-14')
  assert.deepEqual(seasonalAxisKeys(series, [2026], deliveryAxis), ['-1:10-09', '0:01-14'])
  assert.deepEqual(seasonalAxisKeys(series, [2026], deliveryAxis, { ...window, startYearOffset: 0 }), ['-1:10-09', '0:01-14'])
  assert.deepEqual(seasonalAxisKeys(series, [], deliveryAxis, window), [])
})
