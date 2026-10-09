import { RetryablePromiseCache } from '../lib/retryablePromiseCache'
import { createStaticSnapshotAdapter } from './staticSnapshotAdapter'

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
  seasonAxis?: 'delivery-year'
  nearMonth?: string
  farMonth?: string
  farYearOffset?: 0 | 1
  priceBasis?: 'raw_close'
  seriesMetaByYear?: Record<string, {
    instance: string
    leg1: string
    leg2: string
    firstDate: string
    lastDate: string
    pointCount: number
  }>
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
  priceBasis: 'raw_close'
  charts: FixedContractSpreadChart[]
  selectableCharts?: FixedContractSpreadChart[]
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
  priceBasis: 'raw_close'
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
  priceBasis: 'raw_close'
  charts: CrossSpreadOverviewChart[]
}

export interface CrossSpreadStructurePoint extends CrossSpreadLatestPoint {
  month: string
  label: string
}

export interface CrossSpreadStructureHistory {
  date: string
  points: CrossSpreadStructurePoint[]
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
  priceBasis: 'raw_close'
  formulaLabel: string
  latestDate: string
  structure: CrossSpreadStructurePoint[]
  structureHistory?: CrossSpreadStructureHistory[]
  monthSeries: CrossSpreadMonthSeries[]
  dominantSeries: CrossSpreadPoint[]
  adjustedDominantSeries?: CrossSpreadPoint[]
  adjustedDominantPriceBasis?: 'forward_adjusted_close'
}

type StaticSpreadPayload = Record<SpreadPriceMode, SpreadSeasonalResponse> & {
  fixedContract: FixedContractSpreadResponse
}

export interface SnapshotMeta {
  generatedAt: string
  latestDate: string
}

interface StaticVarietyKlines extends KLineOptionsResponse {
  contracts: Record<string, Bar[]>
}

const snapshotAdapter = createStaticSnapshotAdapter(import.meta.env.BASE_URL)
const spreadPromises = new RetryablePromiseCache<string, StaticSpreadPayload>()
const klinePromises = new RetryablePromiseCache<string, StaticVarietyKlines>()
const crossSpreadOverviewPromises = new RetryablePromiseCache<string, CrossSpreadOverviewResponse>()
const crossSpreadDetailPromises = new RetryablePromiseCache<string, CrossSpreadDetailResponse>()

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

export const api = {
  meta: snapshotAdapter.meta,
  commodityConfig: snapshotAdapter.commodityConfig,
  termStructureMatrix: snapshotAdapter.termStructureMatrix,
  termStructure: snapshotAdapter.termStructure,
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
      priceBasis: 'raw_close',
      charts: [],
    }
  },
  crossSpreadOverview: loadCrossSpreadOverview,
  crossSpreadDetail: loadCrossSpreadDetail,
  klinesBatch: snapshotAdapter.klinesBatch,
  kline: async (params: { code?: string; kind?: KlineBatchKind; variety?: string }) => {
    if (params.kind === 'dominant_continuous') {
      return snapshotAdapter.dominantBars(params.variety ?? '')
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
