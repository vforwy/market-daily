import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')

test('all raw spread contracts and the empty static fallback declare closing-price basis', () => {
  const api = source('api/index.ts')
  assert.doesNotMatch(api, /raw_settle/)
  assert.match(api, /priceBasis\?: 'raw_close'/)
  assert.match(api, /priceBasis: 'raw_close'/)
  assert.match(api, /adjustedDominantPriceBasis\?: 'forward_adjusted_close'/)
})

test('fixed and special spread annotations identify unadjusted close without changing adjusted seasonals', () => {
  for (const path of [
    'components/SpreadSeasonalityPanel/SpreadSeasonalityCard.tsx',
    'components/SpreadSeasonalityPanel/SpreadSeasonalityPanel.tsx',
    'components/SpreadSeasonalityPanel/FixedContractSpreadExplorer.tsx',
    'components/CrossSpreadStructure/CrossSpreadDetail.tsx',
  ]) {
    const component = source(path)
    assert.match(component, /未复权收盘价/, path)
    assert.doesNotMatch(component, /结算价|raw_settle/, path)
  }
  assert.match(source('components/CrossSpreadStructure/CrossSpreadDetail.tsx'), /季节图为主力前复权收盘价/)
})
