import { RetryablePromiseCache } from '../lib/retryablePromiseCache'

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

export interface FixedContractSpreadPoint {
  d: string
  v: number | null
  nearPrice: number | null
  farPrice: number | null
}

export interface FixedContractSpreadSeries {
  farCode: string
  farLabel: string
  label: string
  points: FixedContractSpreadPoint[]
}

export interface FixedContractSpreadChart {
  nearCode: string
  nearLabel: string
  series: FixedContractSpreadSeries[]
}

export interface FixedContractSpreadResponse {
  variety: string
  latestDate: string
  historyStart: string
  dominantCode: string
  priceBasis: 'raw_settle'
  charts: FixedContractSpreadChart[]
}

export interface CrossSpreadPoint {
  d: string
  v: number | null
  instance: string
  leg1: string
  leg2: string
  leg1Price: number | null
  leg2Price: number | null
}

export interface CrossSpreadLatestPoint {
  v: number | null
  instance: string
  leg1: string
  leg2: string
  leg1Price: number | null
  leg2Price: number | null
}

export interface CrossSpreadOverviewChart {
  code: string
  name: string
  group: string
  latestDate: string
  currentMonth: number | null
  currentMonthLabel: string
  latestFixed: CrossSpreadLatestPoint | null
  latestDominant: CrossSpreadLatestPoint | null
  fixedSeries: CrossSpreadPoint[]
  dominantSeries: CrossSpreadPoint[]
}

export interface CrossSpreadOverviewResponse {
  latestDate: string
  charts: CrossSpreadOverviewChart[]
}

export interface CrossSpreadStructurePoint extends CrossSpreadLatestPoint {
  month: string
  label: string
}

export interface CrossSpreadMonthSeries {
  month: string
  label: string
  points: CrossSpreadPoint[]
}

export interface CrossSpreadDetailResponse {
  code: string
  name: string
  group: string
  formulaLabel: string
  latestDate: string
  structure: CrossSpreadStructurePoint[]
  monthSeries: CrossSpreadMonthSeries[]
  dominantSeries: CrossSpreadPoint[]
}

type StaticSpreadPayload = Record<SpreadPriceMode, SpreadSeasonalResponse> & {
  fixedContract: FixedContractSpreadResponse
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

interface StaticVarietyKlines extends KLineOptionsResponse {
  contracts: Record<string, Bar[]>
}

const snapshotPromises = new RetryablePromiseCache<string, StaticSnapshot>()
const spreadPromises = new RetryablePromiseCache<string, StaticSpreadPayload>()
const klinePromises = new RetryablePromiseCache<string, StaticVarietyKlines>()
const crossSpreadOverviewPromises = new RetryablePromiseCache<string, CrossSpreadOverviewResponse>()
const crossSpreadDetailPromises = new RetryablePromiseCache<string, CrossSpreadDetailResponse>()

function loadSnapshot(): Promise<StaticSnapshot> {
  return snapshotPromises.get('snapshot', () => {
    const url = `${import.meta.env.BASE_URL}data/snapshot.json`
    return fetch(url).then(async response => {
      if (!response.ok) throw new Error(`静态数据加载失败 (${response.status})`)
      return response.json() as Promise<StaticSnapshot>
    })
  })
}

function loadSpreads(variety: string): Promise<StaticSpreadPayload> {
  const key = variety.toUpperCase()
  return spreadPromises.get(key, () => {
    const url = `${import.meta.env.BASE_URL}data/spreads/${encodeURIComponent(key)}.json`
    return fetch(url).then(async response => {
      if (!response.ok) throw new Error(`价差数据加载失败 (${response.status})`)
      return response.json() as Promise<StaticSpreadPayload>
    })
  })
}

function loadVarietyKlines(variety: string): Promise<StaticVarietyKlines> {
  const key = variety.toUpperCase()
  return klinePromises.get(key, () => {
    const url = `${import.meta.env.BASE_URL}data/klines/${encodeURIComponent(key)}.json`
    return fetch(url).then(async response => {
      if (!response.ok) throw new Error(`合约 K 线数据加载失败 (${response.status})`)
      return response.json() as Promise<StaticVarietyKlines>
    })
  })
}

function loadCrossSpreadOverview(): Promise<CrossSpreadOverviewResponse> {
  return crossSpreadOverviewPromises.get('overview', () => {
    const url = `${import.meta.env.BASE_URL}data/cross-spreads/overview.json`
    return fetch(url).then(async response => {
      if (!response.ok) throw new Error(`跨品种价差数据加载失败 (${response.status})`)
      return response.json() as Promise<CrossSpreadOverviewResponse>
    })
  })
}

function loadCrossSpreadDetail(code: string): Promise<CrossSpreadDetailResponse> {
  const key = code.toUpperCase()
  return crossSpreadDetailPromises.get(key, () => {
    const url = `${import.meta.env.BASE_URL}data/cross-spreads/${encodeURIComponent(key)}.json`
    return fetch(url).then(async response => {
      if (!response.ok) throw new Error(`跨品种价差详情加载失败 (${response.status})`)
      return response.json() as Promise<CrossSpreadDetailResponse>
    })
  })
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
    _specialOnly = false,
  ) => {
    void _years
    void _specialOnly
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
  fixedContractSpreads: async (variety: string): Promise<FixedContractSpreadResponse> => {
    const payload = await loadSpreads(variety)
    return payload.fixedContract ?? {
      variety: variety.toUpperCase(),
      latestDate: '',
      historyStart: '2026-01-01',
      dominantCode: '',
      priceBasis: 'raw_settle',
      charts: [],
    }
  },
  crossSpreadOverview: loadCrossSpreadOverview,
  crossSpreadDetail: loadCrossSpreadDetail,
  klinesBatch: async (days = 60, kind: KlineBatchKind = 'contract') => {
    const snapshot = await loadSnapshot()
    return sliceBatch(snapshot.klineBatches[kind], days)
  },
  kline: async (params: { code?: string; kind?: KlineBatchKind; variety?: string }) => {
    if (params.kind === 'dominant_continuous') {
      const snapshot = await loadSnapshot()
      return snapshot.klineBatches.dominant_continuous[params.variety?.toUpperCase() ?? '']?.bars ?? []
    }
    if (!params.code) return []
    const variety = params.variety?.toUpperCase() || varietyFromCode(params.code)
    const payload = await loadVarietyKlines(variety)
    return payload.contracts[params.code.toUpperCase()] ?? []
  },
  klineOptions: async (code: string): Promise<KLineOptionsResponse> => {
    const variety = varietyFromCode(code)
    const payload = await loadVarietyKlines(variety)
    const selected = payload.options.find(
      option => option.kind === payload.selected.kind && option.value === payload.selected.value,
    ) ?? payload.selected
    return { variety: payload.variety, selected, options: payload.options }
  },
}
