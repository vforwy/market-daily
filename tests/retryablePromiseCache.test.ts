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

test('a successful entry can be invalidated when the dataset generation changes', async () => {
  const cache = new RetryablePromiseCache<string, string>()
  assert.equal(await cache.get('manifest', async () => 'old'), 'old')
  cache.invalidate('manifest')
  assert.equal(await cache.get('manifest', async () => 'new'), 'new')
})

test('an invalidated pending rejection cannot evict its successful replacement', async () => {
  const cache = new RetryablePromiseCache<string, string>()
  let rejectOld: (error: Error) => void = () => {}
  const old = cache.get('manifest', () => new Promise<string>((_resolve, reject) => {
    rejectOld = reject
  }))
  cache.invalidate('manifest')
  const replacement = cache.get('manifest', async () => 'new')
  assert.equal(await replacement, 'new')
  rejectOld(new Error('obsolete'))
  await assert.rejects(old, /obsolete/)
  assert.equal(cache.get('manifest', async () => 'unexpected'), replacement)
})
