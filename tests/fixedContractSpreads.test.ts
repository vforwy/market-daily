import assert from 'node:assert/strict'
import test from 'node:test'

import { fixedContractNearCode } from '../src/lib/fixedContractSpreads.ts'

const charts = ['BU2601.SHF', 'BU2605.SHF', 'BU2609.SHF'].map(nearCode => ({ nearCode }))

test('fixed contract explorer keeps the saved expired historical near leg', () => {
  assert.equal(fixedContractNearCode(charts, 'BU2605.SHF'), 'BU2605.SHF')
})

test('fixed contract explorer defaults to the latest historical near leg', () => {
  assert.equal(fixedContractNearCode(charts, ''), 'BU2609.SHF')
  assert.equal(fixedContractNearCode(charts, 'BU2702.SHF'), 'BU2609.SHF')
})

test('fixed contract explorer handles empty options', () => {
  assert.equal(fixedContractNearCode([], ''), '')
})
