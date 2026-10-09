import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'
import {
  calendarSeasonalWindow,
  seasonalAxisKeys,
  seasonalPointKey,
  seasonalYears,
} from '../src/lib/seasonalAxis.ts'
import type { SpreadSeasonalChart, SpreadSeasonalPoint } from '../src/api/index.ts'

test('published fixed-pair seasonals retain their source history and leave unquoted window boundaries blank', () => {
  const directory = new URL('../public/data/spreads/', import.meta.url)
  const templates = new Set<string>()
  for (const file of readdirSync(directory).filter(file => file.endsWith('.json'))) {
    const charts: SpreadSeasonalChart[] = JSON.parse(readFileSync(new URL(file, directory), 'utf8')).raw.specialSpreads
    for (const chart of charts) {
      if (chart.seasonAxis !== 'delivery-year') continue
      const before = JSON.stringify(chart)
      const window = calendarSeasonalWindow(chart.nearMonth, chart.farMonth, chart.farYearOffset)
      assert.ok(window, chart.spreadCode)
      templates.add(`${chart.nearMonth}-${chart.farMonth}`)
      const years = seasonalYears(chart.seriesByYear, [], chart.seasonAxis)
      const axis = seasonalAxisKeys(chart.seriesByYear, years, chart.seasonAxis, window)
      assert.equal(axis[0], `${window.startYearOffset}:${chart.farMonth}-01`)
      assert.match(axis.at(-1) ?? '', new RegExp(`^0:${chart.nearMonth}-(28|29|30|31)$`))
      for (const year of years) {
        const points = chart.seriesByYear[String(year)]
        const byX = new Map(points.map(point => [seasonalPointKey(point, year, chart.seasonAxis), point]))
        const plotted: (SpreadSeasonalPoint | null)[] = axis.map(key => byX.get(key) ?? null)
        // The same source objects/values are plotted, never filled or extrapolated.
        assert.equal(plotted[0], byX.get(axis[0]) ?? null)
        assert.equal(plotted.at(-1), byX.get(axis.at(-1)!) ?? null)
        for (const point of plotted) {
          if (point !== null) assert.ok(points.includes(point))
        }
      }
      assert.equal(JSON.stringify(chart), before)
    }
  }
  for (const template of ['01-05', '05-09', '05-10', '09-01', '09-11', '10-01']) {
    assert.ok(templates.has(template), `missing representative ${template}`)
  }
})
