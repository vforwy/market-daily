import assert from 'node:assert/strict'
import test from 'node:test'

import { createStaticSnapshotAdapter } from '../src/api/staticSnapshotAdapter.ts'
import type { Bar, BatchKlines, CommodityConfig, TermStructureMatrix } from '../src/api/index.ts'

const meta = { latestDate: '2026-10-08', generatedAt: '2026-10-08T17:00:00+08:00' }
const commodityConfig: CommodityConfig = {
  items: [{ rowIndex: 1, cate: '能源', section: '石油', stage: '', code: 'BU', name: '沥青', enabled: true, note: '' }],
}
const bars: Bar[] = [
  { d: '2026-07-01', o: 100, h: 110, l: 90, c: 105, v: 20 },
  { d: '2026-08-20', o: 110, h: 120, l: 100, c: 115, v: 30 },
  { d: '2026-10-08', o: 120, h: 130, l: 110, c: 125, v: 40, s: 126 },
]
const contract: BatchKlines = { 'BU2611.SHF': { name: '沥青', bars, change_pct: 1.25, variety: 'BU' } }
const dominant: BatchKlines = { BU: { name: '沥青', bars, dominant_code: 'BU2611.SHF', change_pct: null } }
const term: TermStructureMatrix = {
  latestDate: meta.latestDate,
  days: 5,
  charts: [{
    cate: '能源', section: '石油', stage: '', code: 'BU', name: '沥青', months: ['202611'],
    dates: [meta.latestDate], latestDate: meta.latestDate,
    seriesByDate: { [meta.latestDate]: { '202611': 126 } }, latestVolume: { '202611': 40 },
  }],
}
const manifest = { formatVersion: 2, meta, commodityConfig }
const legacy = { meta, commodityConfig, klineBatches: { contract, dominant_continuous: dominant }, termStructureMatrix: term }

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

type RecordedRequest = { url: URL; options: RequestInit | undefined }

function fakeFetch(handler: (request: RecordedRequest) => Response | Promise<Response>) {
  const requests: RecordedRequest[] = []
  const fetcher: typeof fetch = async (input, options) => {
    const request = { url: new URL(String(input), 'https://example.test'), options }
    requests.push(request)
    return handler(request)
  }
  return { fetcher, requests }
}

function fixtureResponse(request: RecordedRequest): Response {
  if (request.url.pathname.endsWith('/manifest.json')) return json(manifest)
  if (request.url.pathname.endsWith('/snapshot.json')) return json(legacy)
  if (request.url.pathname.endsWith('/kline-batches/contract.json')) return json({ meta, data: contract })
  if (request.url.pathname.endsWith('/kline-batches/dominant_continuous.json')) return json({ meta, data: dominant })
  if (request.url.pathname.endsWith('/term-structure.json')) return json({ meta, data: term })
  return json({}, 404)
}

test('first-screen metadata and config share a tiny manifest, with only the selected batch loaded', async () => {
  const { fetcher, requests } = fakeFetch(fixtureResponse)
  const api = createStaticSnapshotAdapter('/market-daily/', fetcher)
  const [actualMeta, config, batch] = await Promise.all([api.meta(), api.commodityConfig(), api.klinesBatch(90)])
  assert.deepEqual(actualMeta, meta)
  assert.deepEqual(config, commodityConfig)
  assert.equal(batch['BU2611.SHF'].bars.length, 2)
  assert.deepEqual(requests.map(item => item.url.pathname), [
    '/market-daily/data/manifest.json', '/market-daily/data/kline-batches/contract.json',
  ])
  assert.equal(requests[0].options?.cache, 'no-cache')
  assert.equal(requests[1].url.searchParams.get('v'), meta.generatedAt)
})

test('batches and term structure stay lazy and preserve the old public responses', async () => {
  const { fetcher, requests } = fakeFetch(fixtureResponse)
  const api = createStaticSnapshotAdapter('/market-daily', fetcher)
  await api.meta()
  assert.equal(requests.length, 1)
  assert.deepEqual(await api.dominantBars('bu'), bars)
  assert.deepEqual(await api.dominantBars('missing'), [])
  assert.equal(requests.length, 2)
  assert.deepEqual(await api.termStructureMatrix(), term)
  assert.deepEqual(await api.termStructure('bu'), { latestDate: meta.latestDate, days: 5, chart: term.charts[0] })
  assert.deepEqual(await api.termStructure('missing'), { latestDate: meta.latestDate, days: 5, chart: null })
  assert.equal(requests.length, 3)
  assert.equal(requests.some(item => item.url.pathname.endsWith('snapshot.json')), false)
})

test('concurrent batch consumers share data while their calendar-day slices remain independent', async () => {
  const { fetcher, requests } = fakeFetch(fixtureResponse)
  const api = createStaticSnapshotAdapter('/', fetcher)
  const [all, recent, empty] = await Promise.all([api.klinesBatch(999), api.klinesBatch(), api.klinesBatch(0)])
  assert.deepEqual(all, contract)
  assert.deepEqual(recent['BU2611.SHF'], { ...contract['BU2611.SHF'], bars: bars.slice(1) })
  assert.deepEqual(empty['BU2611.SHF'].bars, bars.slice(-1))
  assert.equal(requests.length, 2)
  assert.equal(all['BU2611.SHF'].bars.length, 3)
})

test('only a missing manifest falls back to the old snapshot, and concurrent fallback is shared', async () => {
  const { fetcher, requests } = fakeFetch(request => request.url.pathname.endsWith('/manifest.json')
    ? json({}, 404) : fixtureResponse(request))
  const api = createStaticSnapshotAdapter('/', fetcher)
  const [actualMeta, config, batch, matrix, dominantBars] = await Promise.all([
    api.meta(), api.commodityConfig(), api.klinesBatch(999), api.termStructureMatrix(), api.dominantBars('BU'),
  ])
  assert.deepEqual(actualMeta, meta)
  assert.deepEqual(config, commodityConfig)
  assert.deepEqual(batch, contract)
  assert.deepEqual(matrix, term)
  assert.deepEqual(dominantBars, bars)
  assert.deepEqual(requests.map(item => item.url.pathname), ['/data/manifest.json', '/data/snapshot.json'])
})

for (const status of [401, 500]) {
  test(`manifest HTTP ${status} never falls back and remains retryable`, async () => {
    let failed = false
    const { fetcher, requests } = fakeFetch(request => {
      if (!failed) { failed = true; return json({}, status) }
      return fixtureResponse(request)
    })
    const api = createStaticSnapshotAdapter('/', fetcher)
    await assert.rejects(api.meta(), new RegExp(String(status)))
    assert.deepEqual(await api.meta(), meta)
    assert.deepEqual(requests.map(item => item.url.pathname), ['/data/manifest.json', '/data/manifest.json'])
  })
}

test('network errors and invalid JSON do not mask errors with legacy fallback', async () => {
  for (const failure of [new TypeError('offline'), new SyntaxError('bad JSON')]) {
    let failed = false
    const { fetcher, requests } = fakeFetch(request => {
      if (!failed) { failed = true; throw failure }
      return fixtureResponse(request)
    })
    const api = createStaticSnapshotAdapter('/', fetcher)
    await assert.rejects(api.meta(), failure)
    assert.deepEqual(await api.meta(), meta)
    assert.equal(requests.every(item => item.url.pathname.endsWith('/manifest.json')), true)
  }
})

test('invalid manifest schema is not cached or treated as an older deployment', async () => {
  let attempt = 0
  const { fetcher, requests } = fakeFetch(() => json(++attempt === 1 ? { ...manifest, formatVersion: 3 } : manifest))
  const api = createStaticSnapshotAdapter('/', fetcher)
  await assert.rejects(api.meta(), /索引格式无效/)
  assert.deepEqual(await api.meta(), meta)
  assert.equal(requests.length, 2)
})

test('failed slice requests retry without reloading a successfully read manifest', async () => {
  let sliceAttempts = 0
  const { fetcher, requests } = fakeFetch(request => {
    if (request.url.pathname.endsWith('/contract.json') && ++sliceAttempts === 1) return json({}, 503)
    return fixtureResponse(request)
  })
  const api = createStaticSnapshotAdapter('/', fetcher)
  await assert.rejects(api.klinesBatch(999), /503/)
  assert.deepEqual(await api.klinesBatch(999), contract)
  assert.equal(requests.filter(item => item.url.pathname.endsWith('/manifest.json')).length, 1)
  assert.equal(sliceAttempts, 2)
})

test('mixed deployment generations invalidate the manifest and cannot reuse an old successful slice', async () => {
  const newMeta = { ...meta, generatedAt: '2026-10-08T18:00:00+08:00' }
  const newDominant: BatchKlines = { BU: { ...dominant.BU, bars: [{ ...bars[2], c: 999 }] } }
  let manifestRequests = 0
  const { fetcher, requests } = fakeFetch(request => {
    if (request.url.pathname.endsWith('/manifest.json')) {
      manifestRequests += 1
      return json({ ...manifest, meta: manifestRequests === 1 ? meta : newMeta })
    }
    if (request.url.pathname.endsWith('/dominant_continuous.json')) {
      const oldGeneration = request.url.searchParams.get('v') === meta.generatedAt
      return json({ meta: oldGeneration ? meta : newMeta, data: oldGeneration ? dominant : newDominant })
    }
    if (request.url.pathname.endsWith('/contract.json')) return json({ meta: newMeta, data: contract })
    return json({}, 404)
  })
  const api = createStaticSnapshotAdapter('/', fetcher)
  assert.deepEqual(await api.dominantBars('BU'), bars)
  await assert.rejects(api.klinesBatch(999), /版本不一致/)
  assert.deepEqual(await api.klinesBatch(999), contract)
  assert.deepEqual(await api.meta(), newMeta)
  assert.deepEqual(await api.dominantBars('BU'), newDominant.BU.bars)
  assert.equal(manifestRequests, 2)
  assert.deepEqual(requests.filter(item => item.url.pathname.endsWith('/dominant_continuous.json'))
    .map(item => item.url.searchParams.get('v')), [meta.generatedAt, newMeta.generatedAt])
})

test('the latest date must match even if a detail claims the same generation', async () => {
  let sliceAttempts = 0
  const { fetcher, requests } = fakeFetch(request => {
    if (request.url.pathname.endsWith('/term-structure.json') && ++sliceAttempts === 1) {
      return json({ meta: { ...meta, latestDate: '2026-10-07' }, data: term })
    }
    return fixtureResponse(request)
  })
  const api = createStaticSnapshotAdapter('/', fetcher)
  await assert.rejects(api.termStructureMatrix(), /版本不一致/)
  assert.deepEqual(await api.termStructureMatrix(), term)
  assert.equal(requests.filter(item => item.url.pathname.endsWith('/manifest.json')).length, 2)
})

test('a missing slice after a rollback rejects once then rediscovers the legacy deployment', async () => {
  let manifestRequests = 0
  const { fetcher, requests } = fakeFetch(request => {
    if (request.url.pathname.endsWith('/manifest.json')) return ++manifestRequests === 1 ? json(manifest) : json({}, 404)
    if (request.url.pathname.endsWith('/contract.json')) return json({}, 404)
    if (request.url.pathname.endsWith('/snapshot.json')) return json(legacy)
    return json({}, 404)
  })
  const api = createStaticSnapshotAdapter('/', fetcher)
  assert.deepEqual(await api.meta(), meta)
  await assert.rejects(api.klinesBatch(999), /404/)
  assert.deepEqual(await api.klinesBatch(999), contract)
  assert.equal(manifestRequests, 2)
  assert.deepEqual(requests.map(item => item.url.pathname), [
    '/data/manifest.json', '/data/kline-batches/contract.json', '/data/manifest.json', '/data/snapshot.json',
  ])
})

test('a malformed slice body can recover on retry without poisoning the successful manifest', async () => {
  let sliceAttempts = 0
  const { fetcher, requests } = fakeFetch(request => {
    if (request.url.pathname.endsWith('/contract.json') && ++sliceAttempts === 1) return json({ meta, data: null })
    return fixtureResponse(request)
  })
  const api = createStaticSnapshotAdapter('/', fetcher)
  await assert.rejects(api.klinesBatch(999), /切片格式无效/)
  assert.deepEqual(await api.klinesBatch(999), contract)
  assert.equal(requests.filter(item => item.url.pathname.endsWith('/manifest.json')).length, 1)
})

test('malformed fallback snapshots also evict their cache so a repaired old deployment can recover', async () => {
  let snapshotAttempts = 0
  const { fetcher, requests } = fakeFetch(request => {
    if (request.url.pathname.endsWith('/manifest.json')) return json({}, 404)
    if (++snapshotAttempts === 1) return json({ ...legacy, meta: null })
    return json(legacy)
  })
  const api = createStaticSnapshotAdapter('/', fetcher)
  await assert.rejects(api.meta(), /旧版静态快照格式无效/)
  assert.deepEqual(await api.meta(), meta)
  assert.equal(snapshotAttempts, 2)
  assert.equal(requests.length, 4)
})
