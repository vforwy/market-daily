import assert from 'node:assert/strict'
import test from 'node:test'

import { RetryablePromiseCache } from '../src/lib/retryablePromiseCache.ts'

test('rejected loads are evicted so a later request can retry', async () => {
  const cache = new RetryablePromiseCache<string, string>()
  let loads = 0

  await assert.rejects(
    cache.get('snapshot', async () => {
      loads += 1
      throw new Error('503')
    }),
    /503/,
  )

  const recovered = await cache.get('snapshot', async () => {
    loads += 1
    return 'ok'
  })

  assert.equal(recovered, 'ok')
  assert.equal(loads, 2)
})

test('successful concurrent loads still share one promise', async () => {
  const cache = new RetryablePromiseCache<string, string>()
  let loads = 0
  const load = async () => {
    loads += 1
    return 'ok'
  }

  const first = cache.get('snapshot', load)
  const second = cache.get('snapshot', load)

  assert.equal(first, second)
  assert.equal(await second, 'ok')
  assert.equal(loads, 1)
})
