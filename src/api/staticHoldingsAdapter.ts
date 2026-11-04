import type { HoldingSeatBoard, HoldingSeatChanges, HoldingSeatChangeRow, HoldingSeatRankHistory } from './index.ts'
import { RetryablePromiseCache } from '../lib/retryablePromiseCache.ts'

interface Asset { file: string; sha256: string }
interface HoldingsIndex {
  formatVersion: 1
  quoteDate: string
  latestDate: string | null
  tradingDates: string[]
  varieties: Record<string, Asset & { latestDate: string | null; members: Record<string, Asset> }>
}
interface BoardArchive {
  formatVersion: 1
  common: Omit<HoldingSeatBoard, 'topN' | 'combined' | 'contracts'>
  topN: Record<string, Pick<HoldingSeatBoard, 'combined' | 'contracts'>>
}
interface MembersArchive {
  formatVersion: 1
  variety: string
  scopeCode: string
  brokers: Array<[string, string | null, string | null]>
  rows: Array<[number, number, number, number | null, number | null]>
}
interface Member { broker: string; seatGroup: string | null; seatLabel: string | null; net: number; longRank: number | null; shortRank: number | null }

function code(value: string): string {
  const result = value.toUpperCase()
  if (!/^[A-Z]+$/.test(result)) throw new Error('无效品种')
  return result
}
function selectedDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new Error('无效日期')
}
function monthsBefore(day: string, months: number): string {
  const [year, month, date] = day.split('-').map(Number)
  const first = new Date(Date.UTC(year, month - 1 - months, 1))
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  first.setUTCDate(Math.min(date, last))
  return first.toISOString().slice(0, 10)
}
const lex = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0

/** Presentation of persisted ranks/net positions; never merge or rerank raw sources. */
export function createStaticHoldingsAdapter(baseUrl: string, fetcher: typeof fetch = fetch) {
  const root = `${baseUrl.replace(/\/?$/, '/')}data/holdings/`
  const assets = new RetryablePromiseCache<string, unknown>()
  let pendingIndex: Promise<HoldingsIndex> | null = null
  function index(): Promise<HoldingsIndex> {
    if (!pendingIndex) {
      const pending = fetcher(`${root}index.json`, { cache: 'no-cache' }).then(async response => {
        if (!response.ok) throw new Error(`持仓索引加载失败 (${response.status})`)
        const data = await response.json() as HoldingsIndex
        if (data.formatVersion !== 1 || !data.varieties || !Array.isArray(data.tradingDates)) throw new Error('持仓索引格式无效')
        return data
      })
      pendingIndex = pending
      void pending.finally(() => { if (pendingIndex === pending) pendingIndex = null }).catch(() => {})
    }
    return pendingIndex
  }
  function asset<T>(ref: Asset): Promise<T> {
    if (!/^[A-Z0-9./a-z_-]+$/.test(ref.file) || ref.file.includes('..') || !/^[0-9a-f]{64}$/.test(ref.sha256)) throw new Error('无效持仓文件路径')
    return assets.get(`${ref.file}:${ref.sha256}`, async () => {
      const response = await fetcher(`${root}${ref.file}?v=${ref.sha256}`)
      if (!response.ok) throw new Error(`持仓数据加载失败 (${response.status})`)
      const body = await response.text()
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))
      const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
      if (hash !== ref.sha256) throw new Error('持仓数据正在更新，请刷新后重试')
      return JSON.parse(body) as T
    }) as Promise<T>
  }
  async function context(variety: string, contract = '') {
    const varietyCode = code(variety)
    const scope = contract.toUpperCase() || varietyCode
    if (!/^[A-Z0-9.]+$/.test(scope)) throw new Error('无效合约')
    const manifest = await index()
    const entry = manifest.varieties[varietyCode]
    if (!entry) throw new Error('该品种未包含在持仓快照中')
    const board = await asset<BoardArchive>(entry)
    const ref = entry.members[scope]
    const members = ref ? await asset<MembersArchive>(ref) : { formatVersion: 1, variety: varietyCode, scopeCode: scope, brokers: [], rows: [] } satisfies MembersArchive
    return { variety: varietyCode, scope, manifest, board, members }
  }
  function membersOn(archive: MembersArchive, days: string[], day: string | null): Map<string, Member> {
    const position = day ? days.indexOf(day) : -1
    const result = new Map<string, Member>()
    if (position < 0) return result
    for (const [dateIndex, brokerIndex, net, longRank, shortRank] of archive.rows) {
      if (dateIndex !== position) continue
      const [broker, seatGroup, seatLabel] = archive.brokers[brokerIndex]
      result.set(broker, { broker, seatGroup, seatLabel, net, longRank, shortRank })
    }
    return result
  }
  return {
    async holdingSeat(variety: string, topN = 5): Promise<HoldingSeatBoard> {
      if (![5, 10, 20].includes(topN)) throw new Error('无效前 N')
      const manifest = await index()
      const entry = manifest.varieties[code(variety)]
      if (!entry) throw new Error('该品种未包含在持仓快照中')
      const archive = await asset<BoardArchive>(entry)
      return { ...archive.common, topN, ...archive.topN[String(topN)] }
    },
    async holdingSeatChanges(variety: string, date: string, topN: number, side: 'long' | 'short', contract = ''): Promise<HoldingSeatChanges> {
      selectedDate(date)
      if (![5, 10, 20].includes(topN) || !['long', 'short'].includes(side)) throw new Error('无效持仓参数')
      const { variety: varietyCode, scope, manifest, board, members } = await context(variety, contract)
      const previousDate = manifest.tradingDates.filter(day => day < date).at(-1) ?? null
      const today = membersOn(members, board.common.dates, date)
      const previous = membersOn(members, board.common.dates, previousDate)
      const response: HoldingSeatChanges = { variety: varietyCode, varietyName: board.common.varietyName, date, previousDate, topN, side, scopeCode: scope, ready: false, rows: [] }
      if (!today.size || !previous.size || !previousDate) return response
      const rankOf = (member: Member | undefined) => member?.[side === 'long' ? 'longRank' : 'shortRank'] ?? null
      const rows: HoldingSeatChangeRow[] = [...new Set([...today.keys(), ...previous.keys()])].map(broker => {
        const current = today.get(broker)
        const prior = previous.get(broker)
        const rank = rankOf(current)
        const previousRank = rankOf(prior)
        const inside = rank != null && rank <= topN
        const wasInside = previousRank != null && previousRank <= topN
        const net = current?.net ?? 0
        const previousNet = prior?.net ?? 0
        return { broker, seatGroup: (current ?? prior)?.seatGroup ?? null, seatLabel: (current ?? prior)?.seatLabel ?? null,
          rank, previousRank, rankDelta: rank != null && previousRank != null ? previousRank - rank : null,
          net, previousNet, delta: net - previousNet, sideChanged: net * previousNet < 0,
          event: inside ? wasInside ? 'stay' : 'entry' : wasInside ? 'exit' : 'outside' }
      })
      rows.sort((a, b) => Number(a.event === 'outside') - Number(b.event === 'outside') || (a.rank ?? 9999) - (b.rank ?? 9999) || lex(a.broker, b.broker))
      const contractsOn = (day: string) => board.topN[String(topN)].contracts.filter(row => {
        const i = board.common.dates.indexOf(day)
        return i >= 0 && (row.longSum[i] != null || row.shortSum[i] != null)
      }).map(row => row.code).sort()
      return { ...response, ready: true, rows, entryCount: rows.filter(row => row.event === 'entry').length,
        exitCount: rows.filter(row => row.event === 'exit').length,
        sameContracts: Boolean(contract) || JSON.stringify(contractsOn(date)) === JSON.stringify(contractsOn(previousDate)) }
    },
    async holdingSeatRanks(variety: string, date: string, side: 'long' | 'short', contract = '', months = 1): Promise<HoldingSeatRankHistory> {
      selectedDate(date)
      if (![1, 3, 6].includes(months) || !['long', 'short'].includes(side)) throw new Error('无效排名参数')
      const { variety: varietyCode, scope, manifest, board, members } = await context(variety, contract)
      const startDate = monthsBefore(date, months)
      const observed = members.rows.filter(row => {
        const day = board.common.dates[row[0]]
        return day >= startDate && day <= date && row[side === 'long' ? 3 : 4] != null
      })
      const dates = [...new Set([...manifest.tradingDates.filter(day => day >= startDate && day <= date), ...observed.map(row => board.common.dates[row[0]])])].sort()
      const positions = new Map(dates.map((day, i) => [day, i]))
      const ranks = new Map<string, Array<number | null>>()
      for (const row of observed) {
        const broker = members.brokers[row[1]][0]
        const values = ranks.get(broker) ?? Array<number | null>(dates.length).fill(null)
        values[positions.get(board.common.dates[row[0]])!] = row[side === 'long' ? 3 : 4]
        ranks.set(broker, values)
      }
      return { variety: varietyCode, scopeCode: scope, side, startDate, endDate: date, dates,
        seats: [...ranks.entries()].sort(([a], [b]) => lex(a, b)).map(([broker, values]) => ({ broker, ranks: values })) }
    },
  }
}
