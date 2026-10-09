import type {
  Bar,
  BatchKlines,
  CommodityConfig,
  KlineBatchKind,
  SnapshotMeta,
  TermStructureMatrix,
  TermStructureSingle,
} from './index.ts'
import { RetryablePromiseCache } from '../lib/retryablePromiseCache.ts'

interface StaticSnapshot {
  meta: SnapshotMeta
  commodityConfig: CommodityConfig
  klineBatches: Record<KlineBatchKind, BatchKlines>
  termStructureMatrix: TermStructureMatrix
}

interface SnapshotManifest {
  formatVersion: 2
  meta: SnapshotMeta
  commodityConfig: CommodityConfig
}

interface LegacyManifest {
  formatVersion: 1
  meta: SnapshotMeta
  commodityConfig: CommodityConfig
}

interface DataEnvelope<Data> {
  meta: SnapshotMeta
  data: Data
}

class StaticDataHttpError extends Error {
  readonly status: number

  constructor(status: number, label: string) {
    super(`${label} (${status})`)
    this.status = status
  }
}

function validMeta(meta: SnapshotMeta | undefined): meta is SnapshotMeta {
  return Boolean(meta && typeof meta.generatedAt === 'string' && meta.generatedAt
    && typeof meta.latestDate === 'string' && meta.latestDate)
}

function sliceBatch(batch: BatchKlines, days: number): BatchKlines {
  if (days >= 999) return batch
  const timestamps = Object.values(batch)
    .flatMap(entry => entry.bars.slice(-1).map(bar => Date.parse(bar.d)))
    .filter(Number.isFinite)
  const latest = timestamps.length ? Math.max(...timestamps) : Date.now()
  const cutoff = latest - days * 86_400_000
  return Object.fromEntries(
    Object.entries(batch).map(([code, entry]) => [
      code,
      { ...entry, bars: entry.bars.filter(bar => Date.parse(bar.d) >= cutoff) },
    ]),
  )
}

/** The same public responses, backed by generation-scoped lazy static slices. */
export function createStaticSnapshotAdapter(baseUrl: string, fetcher: typeof fetch = fetch) {
  const manifests = new RetryablePromiseCache<string, SnapshotManifest | LegacyManifest>()
  const legacySnapshots = new RetryablePromiseCache<string, StaticSnapshot>()
  const batches = new RetryablePromiseCache<string, BatchKlines>()
  const terms = new RetryablePromiseCache<string, TermStructureMatrix>()
  const dataRoot = `${baseUrl.replace(/\/?$/, '/')}data/`

  async function fetchJson<Data>(path: string, label: string, generation?: string): Promise<Data> {
    const query = generation ? `?v=${encodeURIComponent(generation)}` : ''
    const response = await fetcher(`${dataRoot}${path}${query}`, generation ? undefined : { cache: 'no-cache' })
    if (!response.ok) throw new StaticDataHttpError(response.status, label)
    return response.json() as Promise<Data>
  }

  function loadLegacy(): Promise<StaticSnapshot> {
    return legacySnapshots.get('snapshot', () => fetchJson<StaticSnapshot>('snapshot.json', '静态数据加载失败'))
  }

  function loadManifest(): Promise<SnapshotManifest | LegacyManifest> {
    return manifests.get('manifest', async () => {
      let manifest: SnapshotManifest
      try {
        manifest = await fetchJson<SnapshotManifest>('manifest.json', '静态数据索引加载失败')
      } catch (error) {
        if (!(error instanceof StaticDataHttpError) || error.status !== 404) throw error
        const snapshot = await loadLegacy()
        if (!validMeta(snapshot?.meta) || !Array.isArray(snapshot.commodityConfig?.items)) {
          legacySnapshots.invalidate('snapshot')
          throw new Error('旧版静态快照格式无效', { cause: error })
        }
        return { formatVersion: 1, meta: snapshot.meta, commodityConfig: snapshot.commodityConfig }
      }
      if (manifest?.formatVersion !== 2 || !validMeta(manifest.meta)
        || !Array.isArray(manifest.commodityConfig?.items)) {
        throw new Error('静态数据索引格式无效')
      }
      return manifest
    })
  }

  async function loadEnvelope<Data extends object>(path: string, manifest: SnapshotManifest, label: string): Promise<Data> {
    let envelope: DataEnvelope<Data>
    try {
      envelope = await fetchJson<DataEnvelope<Data>>(path, label, manifest.meta.generatedAt)
    } catch (error) {
      // A rollback to a V1 deployment removes the slice files too. Do not hide
      // this error, but allow the next request to discover its missing manifest.
      if (error instanceof StaticDataHttpError && error.status === 404) manifests.invalidate('manifest')
      throw error
    }
    if (!validMeta(envelope?.meta)
      || envelope.meta.generatedAt !== manifest.meta.generatedAt
      || envelope.meta.latestDate !== manifest.meta.latestDate) {
      // A deployment can change between manifest and detail requests. Evict the
      // successful old manifest too, so a retry can discover the current generation.
      manifests.invalidate('manifest')
      throw new Error('静态数据版本不一致，请重试加载')
    }
    if (!envelope.data || typeof envelope.data !== 'object' || Array.isArray(envelope.data)) {
      throw new Error('静态数据切片格式无效')
    }
    return envelope.data
  }

  async function loadBatch(kind: KlineBatchKind): Promise<BatchKlines> {
    const manifest = await loadManifest()
    if (manifest.formatVersion === 1) return (await loadLegacy()).klineBatches[kind]
    const key = `${manifest.meta.generatedAt}:${kind}`
    return batches.get(key, () => loadEnvelope<BatchKlines>(`kline-batches/${kind}.json`, manifest, 'K 线数据加载失败'))
  }

  async function termStructureMatrix(): Promise<TermStructureMatrix> {
    const manifest = await loadManifest()
    if (manifest.formatVersion === 1) return (await loadLegacy()).termStructureMatrix
    return terms.get(manifest.meta.generatedAt,
      () => loadEnvelope<TermStructureMatrix>('term-structure.json', manifest, '期限结构数据加载失败'))
  }

  return {
    meta: async (): Promise<SnapshotMeta> => (await loadManifest()).meta,
    commodityConfig: async (): Promise<CommodityConfig> => (await loadManifest()).commodityConfig,
    termStructureMatrix,
    termStructure: async (variety: string): Promise<TermStructureSingle> => {
      const matrix = await termStructureMatrix()
      return {
        latestDate: matrix.latestDate,
        days: matrix.days,
        chart: matrix.charts.find(item => item.code === variety.toUpperCase()) ?? null,
      }
    },
    klinesBatch: async (days = 60, kind: KlineBatchKind = 'contract'): Promise<BatchKlines> => sliceBatch(await loadBatch(kind), days),
    dominantBars: async (variety: string): Promise<Bar[]> => (await loadBatch('dominant_continuous'))[variety.toUpperCase()]?.bars ?? [],
  }
}
