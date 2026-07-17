export interface Bar {
  d: string
  o: number
  h: number
  l: number
  c: number
  v: number
  s?: number
}

export interface KLineOption {
  kind: 'contract' | 'dominant_continuous'
  value: string
  label: string
}

export interface KLineOptionsResponse {
  variety: string
  selected: KLineOption
  options: KLineOption[]
}

export type KlineBatchKind = 'contract' | 'dominant_continuous'

export interface KLineEntry {
  name: string
  bars: Bar[]
  change_pct?: number | null
  variety?: string
  dominant_code?: string
}

export type BatchKlines = Record<string, KLineEntry>

export interface CommodityConfigItem {
  rowIndex: number
  cate: string
  section: string
  stage: string
  code: string
  name: string
  enabled: boolean
  note: string
}

export interface CommodityConfig {
  items: CommodityConfigItem[]
}

export interface TermStructureChart {
  cate: string
  section: string
  stage: string
  code: string
  name: string
  months: string[]
  dates: string[]
  latestDate: string
  seriesByDate: Record<string, Record<string, number | null>>
  settleSeriesByDate?: Record<string, Record<string, number | null>>
  closeSeriesByDate?: Record<string, Record<string, number | null>>
  latestVolume: Record<string, number>
}

export interface TermStructureMatrix {
  latestDate: string
  days: number
  charts: TermStructureChart[]
}

export interface TermStructureSingle {
  latestDate: string
  days: number
  chart: TermStructureChart | null
}

export interface SpreadSeasonalPoint {
  x: string
  d: string
  v: number | null
  ratio?: number | null
  instance: string
  leg1?: string
  leg2?: string
  leg1Price?: number | null
  leg2Price?: number | null
}

export interface SpreadSeasonalChart {
  spreadCode: string
  spreadName: string
  spreadType: string
  latestDate: string
  latestInstance: string
  seriesByYear: Record<string, SpreadSeasonalPoint[]>
}

export type SpreadPriceMode = 'raw' | 'adjusted'

export interface SpreadSeasonalResponse {
  variety: string
  priceMode: SpreadPriceMode
  years: number[]
  spreads: SpreadSeasonalChart[]
  monthlySpreads: SpreadSeasonalChart[]
  specialSpreads: SpreadSeasonalChart[]
}

interface SnapshotMeta {
  generatedAt: string
  latestDate: string
}

interface StaticSnapshot {
  meta: SnapshotMeta
  commodityConfig: CommodityConfig
  klineBatches: Record<KlineBatchKind, BatchKlines>
  termStructureMatrix: TermStructureMatrix
}

let snapshotPromise: Promise<StaticSnapshot> | null = null
const spreadPromises = new Map<string, Promise<Record<SpreadPriceMode, SpreadSeasonalResponse>>>()

function loadSnapshot(): Promise<StaticSnapshot> {
  if (!snapshotPromise) {
    const url = `${import.meta.env.BASE_URL}data/snapshot.json`
    snapshotPromise = fetch(url).then(async response => {
      if (!response.ok) throw new Error(`静态数据加载失败 (${response.status})`)
      return response.json() as Promise<StaticSnapshot>
    })
  }
  return snapshotPromise
}

function loadSpreads(variety: string): Promise<Record<SpreadPriceMode, SpreadSeasonalResponse>> {
  const key = variety.toUpperCase()
  let promise = spreadPromises.get(key)
  if (!promise) {
    const url = `${import.meta.env.BASE_URL}data/spreads/${encodeURIComponent(key)}.json`
    promise = fetch(url).then(async response => {
      if (!response.ok) throw new Error(`价差数据加载失败 (${response.status})`)
      return response.json() as Promise<Record<SpreadPriceMode, SpreadSeasonalResponse>>
    })
    spreadPromises.set(key, promise)
  }
  return promise
}

function varietyFromCode(code: string): string {
  const match = code.toUpperCase().match(/^([A-Z]+)(?:\d{3,4})?\./)
  return match?.[1] ?? code.split('.')[0].toUpperCase()
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

function findContract(snapshot: StaticSnapshot, code: string): KLineEntry | undefined {
  const direct = snapshot.klineBatches.contract[code]
  if (direct) return direct
  const variety = varietyFromCode(code)
  return Object.entries(snapshot.klineBatches.contract)
    .find(([candidate]) => varietyFromCode(candidate) === variety)?.[1]
}

export const api = {
  meta: async () => (await loadSnapshot()).meta,
  commodityConfig: async () => (await loadSnapshot()).commodityConfig,
  termStructureMatrix: async () => (await loadSnapshot()).termStructureMatrix,
  termStructure: async (variety: string): Promise<TermStructureSingle> => {
    const snapshot = await loadSnapshot()
    const chart = snapshot.termStructureMatrix.charts.find(item => item.code === variety.toUpperCase()) ?? null
    return {
      latestDate: snapshot.termStructureMatrix.latestDate,
      days: snapshot.termStructureMatrix.days,
      chart,
    }
  },
  spreadSeasonal: async (
    variety: string,
    _years = 5,
    priceMode: SpreadPriceMode = 'raw',
  ) => {
    void _years
    const modes = await loadSpreads(variety)
    return modes[priceMode] ?? {
      variety: variety.toUpperCase(),
      priceMode,
      years: [],
      spreads: [],
      monthlySpreads: [],
      specialSpreads: [],
    }
  },
  klinesBatch: async (days = 60, kind: KlineBatchKind = 'contract') => {
    const snapshot = await loadSnapshot()
    return sliceBatch(snapshot.klineBatches[kind], days)
  },
  kline: async (params: { code?: string; kind?: KlineBatchKind; variety?: string }) => {
    const snapshot = await loadSnapshot()
    if (params.kind === 'dominant_continuous') {
      return snapshot.klineBatches.dominant_continuous[params.variety?.toUpperCase() ?? '']?.bars ?? []
    }
    return params.code ? findContract(snapshot, params.code)?.bars ?? [] : []
  },
  klineOptions: async (code: string): Promise<KLineOptionsResponse> => {
    const snapshot = await loadSnapshot()
    const variety = varietyFromCode(code)
    const contractCode = Object.keys(snapshot.klineBatches.contract)
      .find(candidate => varietyFromCode(candidate) === variety) ?? code
    const selected = { kind: 'contract' as const, value: contractCode, label: `主力合约 ${contractCode}` }
    return {
      variety,
      selected,
      options: [
        selected,
        { kind: 'dominant_continuous', value: variety, label: `主力连续 ${variety}` },
      ],
    }
  },
}
