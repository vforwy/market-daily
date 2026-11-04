import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type CommodityConfigItem, type HoldingSeatBoard, type HoldingSeatChangeRow, type HoldingSeatMember, type HoldingSeatRankHistory } from '../../api'
import { useEChart } from '../../hooks/useEChart'
import { sharedHandMax } from '../../lib/holdingCharts'
import { contractBandSeries } from '../../lib/contractBand'
import { usePersistentState } from '../../hooks/usePersistentState'
import styles from './HoldingSeatPanel.module.css'

type PageId = 'holdings' | 'changes'
type ScopeId = 'combined' | 'seats' | 'contracts'
type SeatMetric = 'net' | 'contractLong' | 'contractShort'
type ChangeSide = 'long' | 'short'

const RED = '#e84545'
const GREEN = '#2eaa6a'
const BLUE = '#599ce7'
const PALETTE = ['#599ce7', '#e0b96a', '#a78bda', '#5cc5b5', '#dd8790', '#84ad64', '#d9935e', '#8aabcc']
const SEAT_GROUP_CLASS = {
  机构: styles.groupInstitution,
  家人: styles.groupRetail,
  产业: styles.groupIndustry,
  外资: styles.groupForeign,
} as const
const TOP_NS = [5, 10, 20] as const

const axis = {
  axisLine: { lineStyle: { color: '#555' } },
  axisTick: { show: false },
  axisLabel: { fontSize: 10, color: '#aaa' },
  splitLine: { lineStyle: { color: '#333', type: 'dashed' as const } },
}

function fmt(value: number | null | undefined, digits = 0): string {
  if (value == null || Number.isNaN(value)) return '—'
  return Number(value).toLocaleString('zh-CN', { maximumFractionDigits: digits })
}

function signed(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—'
  return `${value > 0 ? '+' : ''}${fmt(value)}`
}

function windowOf(dates: string[], selected: string, range: number): [number, number] {
  const end = Math.max(0, dates.indexOf(selected))
  const resolvedEnd = dates.includes(selected) ? end : dates.length - 1
  const start = range >= 999 ? 0 : Math.max(0, resolvedEnd + 1 - range)
  return [start, resolvedEnd]
}

function slice<T>(values: T[], start: number, end: number): T[] {
  return values.slice(start, end + 1)
}

function seatValue(seat: HoldingSeatMember, metric: SeatMetric): Array<number | null> {
  if (metric === 'contractLong') return seat.contractLong
  if (metric === 'contractShort') return seat.contractShort
  return seat.net
}

function metricName(metric: SeatMetric): string {
  if (metric === 'contractLong') return '合约净多腿'
  if (metric === 'contractShort') return '合约净空腿'
  return '抵消后净仓'
}

function eventText(event: HoldingSeatChangeRow['event'], topN: number): string {
  const label = {
    entry: `进入前 ${topN}`,
    exit: `退出前 ${topN}`,
    stay: '继续在榜',
    outside: `前 ${topN} 以外`,
  }[event]
  return label
}

function handAxisLabel(value: number): string {
  return Math.abs(value) >= 10000 ? `${(value / 10000).toFixed(0)}万` : String(value)
}

function chartBands(height: number, bars: boolean) {
  const legendH = 22
  const titleH = 16
  const sliderH = 22
  const labelH = 18
  const gutter = bars ? 32 : 40
  const priceGutter = 40
  const usable = Math.max(bars ? 640 : 240, height - legendH - titleH - priceGutter - gutter * (bars ? 2 : 1) - sliderH - labelH)
  const priceH = Math.round(usable * (bars ? 0.28 : 0.4))
  const middleH = Math.round(usable * (bars ? 0.26 : 0.3))
  const ratioH = Math.max(72, usable - priceH - middleH * (bars ? 2 : 1))
  const priceTop = legendH + titleH
  const middleTop = priceTop + priceH + priceGutter
  const shortTop = middleTop + middleH + gutter
  const ratioTop = bars ? shortTop + middleH + gutter : shortTop
  return { priceTop, priceH, middleTop, middleH, shortTop, ratioTop, ratioH }
}

function panelGrid(grid: Record<string, unknown>, tone: 'main' | 'sub' = 'main') {
  return {
    outerBoundsMode: 'none',
    show: true,
    borderColor: '#4a4a4a',
    borderWidth: 1,
    backgroundColor: tone === 'sub' ? '#141414' : 'transparent',
    ...grid,
  }
}

function panelTitle(text: string, top: number, left: number | string = 4) {
  return {
    text,
    left,
    top,
    textStyle: { color: '#c8c8c8', fontSize: 12, fontWeight: 600 as const },
  }
}

function tooltipNumber(value: unknown): number | null {
  if (value == null || Array.isArray(value) || typeof value === 'object') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function tooltipPosition(
  point: number[],
  _params: unknown,
  _dom: unknown,
  _rect: unknown,
  size: { contentSize: number[]; viewSize: number[] },
): number[] {
  const [x, y] = point
  const [boxWidth, boxHeight] = size.contentSize
  const [viewWidth, viewHeight] = size.viewSize
  const pad = 10
  const left = x < viewWidth / 2 ? viewWidth - boxWidth - pad : pad
  const top = y > viewHeight * 0.55 ? pad : viewHeight - boxHeight - 26
  return [
    Math.max(pad, Math.min(left, viewWidth - boxWidth - pad)),
    Math.max(pad, Math.min(top, viewHeight - boxHeight - pad)),
  ]
}

const PAGES_TOOLTIP = {
  trigger: 'axis' as const,
  confine: true,
  backgroundColor: '#1e1e1e',
  borderColor: '#333',
  borderWidth: 1,
  padding: [6, 8] as [number, number],
  textStyle: { color: '#e4e4e4', fontSize: 12, lineHeight: 16 },
  extraCssText: 'border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.35); pointer-events: none;',
  position: tooltipPosition,
}

function MainChart({
  board,
  start,
  end,
  scope,
  topN,
  seatMetric,
  selectedSeats,
  mergeSeats,
  selectedContracts,
}: {
  board: HoldingSeatBoard
  start: number
  end: number
  scope: ScopeId
  topN: number
  seatMetric: SeatMetric
  selectedSeats: string[]
  mergeSeats: boolean
  selectedContracts: string[]
}) {
  const ref = useRef<HTMLDivElement>(null)
  const renderChart = useEChart(ref)
  const [plotSize, setPlotSize] = useState({ width: 0, height: 0 })
  const split = scope === 'contracts'

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => {
      const next = { width: element.clientWidth, height: element.clientHeight }
      setPlotSize(current => (
        current.width === next.width && current.height === next.height ? current : next
      ))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (plotSize.height < 80 || plotSize.width < 200) return
    const dates = slice(board.dates, start, end)
    const bands = chartBands(plotSize.height, split)
    const ratioGrid = split ? 3 : 2
    const middle: Array<Record<string, unknown>> = []
    const bottom: Array<Record<string, unknown>> = []
    const line = (name: string, values: Array<number | null>, color: string, grid = 1, id = name, tag = name) => ({
      id,
      name,
      type: 'line',
      data: values,
      xAxisIndex: grid,
      yAxisIndex: grid,
      showSymbol: false,
      connectNulls: false,
      lineStyle: { width: 1.65, color },
      itemStyle: { color },
      clip: false,
      endLabel: {
        show: true,
        formatter: tag,
        color,
        fontSize: 11,
        fontWeight: 600,
        distance: 8,
        offset: tag === '净多' ? [0, 9] : tag === '净空' ? [0, -9] : [0, 0],
        backgroundColor: 'rgba(15,15,15,0.82)',
        padding: [1, 4],
        borderRadius: 2,
      },
      labelLayout: { moveOverlap: 'shiftY' },
    })
    const stackedBar = (code: string, name: string, color: string, side: 'long' | 'short', values: Array<number | null>) => ({
      id: `${code}-${side}`,
      name,
      type: 'bar',
      stack: side,
      barMaxWidth: 7,
      barCategoryGap: '45%',
      xAxisIndex: side === 'long' ? 1 : 2,
      yAxisIndex: side === 'long' ? 1 : 2,
      data: values,
      itemStyle: { color },
    })
    if (scope === 'combined') {
      middle.push(
        line(`前${topN}净多`, slice(board.combined.longSum, start, end), RED, 1, 'top-long', '净多'),
        line(`前${topN}净空`, slice(board.combined.shortSum, start, end), GREEN, 1, 'top-short', '净空'),
      )
    }
    if (scope === 'seats') {
      const chosen = board.seats.filter(seat => selectedSeats.includes(seat.broker))
      if (mergeSeats) {
        const values = dates.map((_, index) => chosen.some(seat => seatValue(seat, seatMetric)[start + index] == null) ? null : chosen.reduce((sum, seat) => sum + (seatValue(seat, seatMetric)[start + index] ?? 0), 0))
        middle.push(line(`所选席位 · ${metricName(seatMetric)}`, chosen.length ? values : [], BLUE))
      } else {
        chosen.forEach(seat => {
          middle.push(line(seat.broker, slice(seatValue(seat, seatMetric), start, end), PALETTE[board.seats.findIndex(item => item.broker === seat.broker) % PALETTE.length]))
        })
      }
    }
    const longStacks: Array<Array<number | null>> = []
    const shortStacks: Array<Array<number | null>> = []
    if (split) {
      selectedContracts.forEach(code => {
        const contract = board.contracts.find(item => item.code === code)
        if (!contract) return
        const color = PALETTE[board.contracts.findIndex(item => item.code === code) % PALETTE.length]
        const name = code.split('.')[0]
        const longValues = slice(contract.longSum, start, end)
        const shortValues = slice(contract.shortSum, start, end)
        longStacks.push(longValues)
        shortStacks.push(shortValues)
        middle.push(
          stackedBar(code, name, color, 'long', longValues),
          stackedBar(code, name, color, 'short', shortValues),
        )
        const ratioLine = line(name, slice(contract.ratio, start, end), color, ratioGrid, `${code}-ratio`)
        ratioLine.endLabel.show = contract.ratio[end] != null
        bottom.push(ratioLine)
      })
    } else {
      bottom.push(line(`前${topN}多空比`, slice(board.combined.ratio, start, end), BLUE, ratioGrid, 'product-ratio', '多空比'))
    }
    if (bottom[0]) {
      bottom[0].markLine = {
        symbol: 'none',
        silent: true,
        label: { show: true, formatter: '1', color: '#777' },
        lineStyle: { color: '#666', type: 'dashed' },
        data: [{ yAxis: 1 }],
      }
    }
    const dominant = slice(board.dominant, start, end)
    const candles = slice(board.ohlc, start, end)
    const rolls = dates.flatMap((day, index) => (
      index && dominant[index] && dominant[index] !== dominant[index - 1] ? [{ xAxis: day }] : []
    ))
    const xIndexes = split ? [0, 1, 2, 3] : [0, 1, 2]
    const handMax = split ? sharedHandMax(longStacks, shortStacks) : null
    // Align plotting bounds, leaving ticks and line-end labels outside the grids.
    const plotLeft = split ? 58 : 8
    const plotRight = 116
    const yHand = (gridIndex: number, position: 'left' | 'right', fromZero: boolean) => ({
      splitNumber: split ? 3 : 5,
      scale: !fromZero && handMax == null,
      min: handMax == null ? undefined : 0,
      max: handMax ?? undefined,
      position,
      gridIndex,
      splitLine: { lineStyle: { color: '#333', type: 'dashed' as const } },
      axisLine: { show: false },
      axisTick: { length: 4, lineStyle: { color: '#555' } },
      axisLabel: {
        color: '#bbb',
        fontSize: 11,
        margin: split ? 8 : 68,
        formatter: handAxisLabel,
      },
    })
    const middleTitle = split ? `前 ${topN} 净多` : scope === 'seats' ? metricName(seatMetric) : `前 ${topN} 净多 / 净空`
    const ratioTitle = split ? `各合约前 ${topN} 多空比` : `前 ${topN} 多空比`
    renderChart({
      animation: false,
      title: [
        panelTitle('主连', bands.priceTop - 16, split ? plotLeft : 4),
        panelTitle(middleTitle, bands.middleTop - 16, split ? plotLeft : 4),
        ...(split ? [panelTitle(`前 ${topN} 净空`, bands.shortTop - 16, plotLeft)] : []),
        panelTitle(ratioTitle, bands.ratioTop - 16, split ? plotLeft : 4),
      ],
      legend: {
        type: 'scroll',
        top: 0,
        left: 52,
        right: 8,
        itemWidth: 16,
        itemHeight: 6,
        itemGap: 10,
        data: [...new Set(middle.map(item => String(item.name)))],
        textStyle: { color: '#aeb4bd', fontSize: 11 },
      },
      grid: split
        ? [
            panelGrid({ left: plotLeft, right: plotRight, top: bands.priceTop, height: bands.priceH }),
            panelGrid({ left: plotLeft, right: plotRight, top: bands.middleTop, height: bands.middleH }, 'sub'),
            panelGrid({ left: plotLeft, right: plotRight, top: bands.shortTop, height: bands.middleH }, 'sub'),
            panelGrid({ left: plotLeft, right: plotRight, top: bands.ratioTop, height: bands.ratioH }, 'sub'),
          ]
        : [
            panelGrid({ left: plotLeft, right: plotRight, top: bands.priceTop, height: bands.priceH }),
            panelGrid({ left: plotLeft, right: plotRight, top: bands.middleTop, height: bands.middleH }, 'sub'),
            panelGrid({ left: plotLeft, right: plotRight, top: bands.ratioTop, height: bands.ratioH }, 'sub'),
          ],
      axisPointer: {
        link: [{ xAxisIndex: 'all' }],
        lineStyle: { color: 'rgba(255,255,255,0.18)', width: 1 },
        crossStyle: { color: 'rgba(255,255,255,0.18)', width: 1 },
        label: { backgroundColor: '#333', color: '#e4e4e4', fontSize: 10 },
      },
      tooltip: {
        ...PAGES_TOOLTIP,
        axisPointer: { type: 'cross' },
        formatter(params: unknown) {
          const rows = (Array.isArray(params) ? params : [params]) as Array<{
            seriesName?: string
            seriesId?: string
            seriesType?: string
            axisValue?: string
            data?: unknown
            value?: unknown
            color?: string
          }>
          const date = String(rows[0]?.axisValue ?? '')
          const index = dates.indexOf(date)
          const bar = index >= 0 ? candles[index] : null
          const contract = index >= 0 ? dominant[index] : ''
          let quote = ''
          if (bar) {
            const [open, close, low, high] = bar
            const tone = close >= open ? RED : GREEN
            quote = `<div style="color:#9a9a9a;font-size:11px;margin-bottom:6px">开 <b style="color:${tone}">${fmt(open)}</b>&emsp;高 ${fmt(high)}&emsp;低 ${fmt(low)}&emsp;收 <b style="color:${tone}">${fmt(close)}</b></div>`
          }
          const lines = rows.flatMap(row => {
            if (row.seriesType === 'candlestick') return []
            const value = tooltipNumber(row.data ?? row.value)
            if (value == null) return []
            const id = String(row.seriesId ?? '')
            const tone = id.endsWith('-short') ? GREEN : id.endsWith('-long') ? RED : String(row.color ?? '#e4e4e4')
            const text = id.endsWith('ratio') ? fmt(value, 2) : `${fmt(value)} 手`
            return [`<div style="display:flex;justify-content:space-between;gap:16px;line-height:1.5">
              <span style="color:${tone}">${row.seriesName ?? ''}</span>
              <span style="color:#f2f2f2;font-variant-numeric:tabular-nums">${text}</span>
            </div>`]
          })
          return `<div style="min-width:148px">
            <div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:4px">
              <span style="color:#f4f4f4;font-weight:600">${date}</span>
              <span style="color:#8a8a8a;font-size:10px">${contract ?? ''}</span>
            </div>
            ${quote}${lines.join('')}
          </div>`
        },
      },
      xAxis: xIndexes.map(grid => ({
        type: 'category',
        gridIndex: grid,
        data: dates,
        boundaryGap: true,
        axisLine: { show: true, lineStyle: { color: '#3a3a3a', width: 1 } },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: grid === ratioGrid, color: '#aaa', fontSize: 11, formatter: (value: string) => value.slice(5) },
      })),
      yAxis: [
        {
          scale: true,
          position: 'right',
          gridIndex: 0,
          splitLine: { lineStyle: { color: '#333', type: 'dashed' } },
          axisLine: { show: false },
          axisTick: { length: 4, lineStyle: { color: '#555' } },
          axisLabel: { color: '#bbb', fontSize: 11, margin: split ? 8 : 68 },
        },
        ...(split
          ? [yHand(1, 'right', true), yHand(2, 'right', true)]
          : [yHand(1, 'right', false)]),
        {
          scale: true,
          position: 'right',
          gridIndex: ratioGrid,
          splitNumber: 3,
          splitLine: { lineStyle: { color: '#333', type: 'dashed' } },
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: '#bbb', fontSize: 11, margin: 68, formatter: (value: number) => fmt(value, 2) },
        },
      ],
      // Keep zoom on the slider so wheel events can scroll the page.
      dataZoom: [
        {
          type: 'slider',
          xAxisIndex: xIndexes,
          left: plotLeft,
          right: plotRight,
          filterMode: 'weakFilter',
          height: 18,
          bottom: 2,
          borderColor: '#2a2a2a',
          fillerColor: '#599ce720',
          handleStyle: { color: '#599ce7' },
          textStyle: { color: '#555', fontSize: 10 },
        },
      ],
      series: [
        contractBandSeries(dominant),
        {
          name: '主连价格',
          type: 'candlestick',
          data: candles,
          xAxisIndex: 0,
          yAxisIndex: 0,
          itemStyle: { color: RED, color0: GREEN, borderColor: RED, borderColor0: GREEN },
          markLine: { symbol: 'none', silent: true, label: { show: false }, lineStyle: { color: '#666', type: 'dashed' }, data: rolls },
        },
        ...middle,
        ...bottom,
      ],
    })
  }, [board, end, mergeSeats, plotSize, renderChart, scope, seatMetric, selectedContracts, selectedSeats, split, start, topN])

  return <div ref={ref} className={split ? `${styles.chart} ${styles.contractChart}` : styles.chart} />
}

function ChangeCharts({ rows, history, rankBrokers, rankMessage, deltaMessage, previousDate, date, side, topN }: {
  rows: HoldingSeatChangeRow[]
  history: HoldingSeatRankHistory | undefined
  rankBrokers: string[]
  rankMessage: string | undefined
  deltaMessage: string | undefined
  previousDate: string | null
  date: string
  side: ChangeSide
  topN: number
}) {
  const rankRef = useRef<HTMLDivElement>(null)
  const deltaRef = useRef<HTMLDivElement>(null)
  const renderRank = useEChart(rankRef)
  const renderDelta = useEChart(deltaRef)
  useEffect(() => {
    const shown = rows.slice(0, 20)
    const dates = history?.dates ?? []
    const ranks = new Map(history?.seats.map(seat => [seat.broker, seat.ranks]))
    if (!rankMessage) renderRank({
      animation: false,
      tooltip: {
        ...PAGES_TOOLTIP,
        trigger: 'axis',
        formatter(params: unknown) {
          const points = (Array.isArray(params) ? params : [params]) as Array<{ seriesName?: string; axisValue?: string; value?: unknown; color?: string }>
          return `<div style="color:#999;font-size:11px;margin-bottom:3px">${points[0]?.axisValue ?? ''}</div>` + points.flatMap(point => {
            const value = tooltipNumber(point.value)
            return value == null ? [] : [`<div style="color:${point.color ?? '#bbb'}">${point.seriesName ?? ''} <span style="color:#ddd">第 ${value} 名</span></div>`]
          }).join('')
        },
      },
      grid: { left: 48, right: 96, top: 24, bottom: 54, outerBoundsMode: 'none' },
      xAxis: { type: 'category', data: dates, boundaryGap: false, ...axis, axisLabel: { ...axis.axisLabel, formatter: (day: string) => day.slice(5) } },
      yAxis: { type: 'value', inverse: true, min: 1, minInterval: 1, name: side === 'long' ? '净多名次' : '净空名次', ...axis },
      dataZoom: [
        { type: 'slider', left: 48, right: 96, bottom: 2, height: 14, start: 0, end: 100, borderColor: '#333', fillerColor: '#599ce720', textStyle: { color: '#777' } },
      ],
      series: rankBrokers.map((broker, index) => ({
        name: broker,
        type: 'line',
        data: ranks.get(broker) ?? dates.map(() => null),
        connectNulls: false,
        showSymbol: dates.length < 3,
        symbolSize: 4,
        clip: false,
        endLabel: {
          show: true,
          formatter: broker,
          distance: 8,
          color: PALETTE[index % PALETTE.length],
          fontSize: 10,
        },
        labelLayout: { moveOverlap: 'shiftY' },
        lineStyle: { width: 1.6, color: PALETTE[index % PALETTE.length] },
        itemStyle: { color: PALETTE[index % PALETTE.length] },
        markLine: index === 0 ? {
          silent: true,
          symbol: 'none',
          lineStyle: { color: '#888', type: 'dashed' },
          label: { formatter: `前 ${topN}`, position: 'insideStartTop' },
          data: [{ yAxis: topN + 0.5 }],
        } : undefined,
      })),
    })
    if (!deltaMessage) renderDelta({
      animation: false,
      tooltip: {
        ...PAGES_TOOLTIP,
        formatter(params: unknown) {
          const row = (Array.isArray(params) ? params[0] : params) as { name?: string; value?: unknown; color?: string }
          const value = tooltipNumber(row.value)
          const color = value != null && value < 0 ? GREEN : RED
          return `<div style="color:#777;font-size:11px;margin-bottom:3px">${row.name ?? ''}</div><div style="color:${color}">净仓 ${value == null ? '—' : signed(value)} 手</div>`
        },
      },
      grid: { left: 100, right: 60, top: 16, bottom: 40 },
      xAxis: { type: 'value', name: '净仓变化（手）', nameLocation: 'middle', nameGap: 25, ...axis },
      yAxis: { type: 'category', inverse: true, data: shown.map(row => row.broker), ...axis, axisLabel: { fontSize: 10, color: '#aaa' } },
      series: [{
        type: 'bar',
        barMaxWidth: 14,
        label: { show: true, formatter: (item: { value: number }) => signed(item.value), color: '#bbb', fontSize: 10 },
        data: shown.map(row => ({ value: row.delta, itemStyle: { color: row.delta >= 0 ? RED : GREEN }, label: { position: row.delta < 0 ? 'insideLeft' : 'right', color: row.delta < 0 ? '#f0f0f0' : '#bbb' } })),
      }],
    })
  }, [deltaMessage, history, rankBrokers, rankMessage, renderDelta, renderRank, rows, side, topN])

  return (
    <div className={styles.pair}>
      <section className={styles.pairPane}>
        <div className={styles.pairHead}>
          <h2>排名变化</h2>
          <p>{history ? `${history.startDate} → ${history.endDate} · ` : ''}每日实际名次 · 虚线为前 {topN} 边界 · 最多 20 家</p>
        </div>
        <div className={styles.chartStage}>
          <div ref={rankRef} className={styles.smallChart} style={{ visibility: rankMessage ? 'hidden' : 'visible' }} />
          {rankMessage && <div className={styles.chartState}>{rankMessage}</div>}
        </div>
      </section>
      <section className={styles.pairPane}>
        <div className={styles.pairHead}>
          <h2>单日净仓变化</h2>
          <p>{previousDate ?? '—'} → {date} · 同一批席位的净仓增减</p>
        </div>
        <div className={styles.chartStage}>
          <div ref={deltaRef} className={styles.smallChart} style={{ height: Math.max(240, Math.min(rows.length, 20) * 22 + 56), visibility: deltaMessage ? 'hidden' : 'visible' }} />
          {deltaMessage && <div className={styles.chartState}>{deltaMessage}</div>}
        </div>
      </section>
    </div>
  )
}

export default function HoldingSeatPanel() {
  const [variety, setVariety] = usePersistentState('fom:holding-seat-variety', 'RB')
  const [page, setPage] = useState<PageId>('holdings')
  const [scope, setScope] = useState<ScopeId>('combined')
  const [topN, setTopN] = useState<(typeof TOP_NS)[number]>(5)
  const [range, setRange] = useState(999)
  const [date, setDate] = useState('')
  const [side, setSide] = useState<ChangeSide>('long')
  const [seatMetric, setSeatMetric] = useState<SeatMetric>('net')
  const [selectedSeats, setSelectedSeats] = useState<string[]>([])
  const [mergeSeats, setMergeSeats] = useState(false)
  const [selectedContracts, setSelectedContracts] = useState<string[]>([])
  const [rankContract, setRankContract] = useState('')
  const [rankMonths, setRankMonths] = useState(1)
  const [eventFilter, setEventFilter] = useState('top')
  const [search, setSearch] = useState('')
  const [seatQuery, setSeatQuery] = useState('')

  const configQuery = useQuery({
    queryKey: ['commodityConfig'],
    queryFn: api.commodityConfig,
    staleTime: 300_000,
  })
  const boardQuery = useQuery({
    queryKey: ['holdingSeat', variety, topN],
    queryFn: () => api.holdingSeat(variety, topN),
    staleTime: 300_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const board = boardQuery.data
  const activeDate = board?.dates.includes(date) ? date : (board?.latestHoldingDate ?? board?.dates.at(-1) ?? '')
  const seededFor = useRef('')
  const changesQuery = useQuery({
    queryKey: ['holdingSeatChanges', variety, activeDate, topN, side, rankContract],
    queryFn: () => api.holdingSeatChanges(variety, activeDate, topN, side, rankContract),
    enabled: page === 'changes' && Boolean(activeDate),
    staleTime: 300_000,
    refetchOnWindowFocus: false,
  })
  const rankHistoryQuery = useQuery({
    queryKey: ['holdingSeatRanks', variety, activeDate, side, rankContract, rankMonths],
    queryFn: () => api.holdingSeatRanks(variety, activeDate, side, rankContract, rankMonths),
    enabled: page === 'changes' && Boolean(activeDate),
    staleTime: 300_000,
    refetchOnWindowFocus: false,
  })

  useEffect(() => {
    if (!board || !activeDate) return
    const key = `${variety}:${topN}:${board.dates.length}:${board.dates.at(-1) ?? ''}`
    if (seededFor.current === key) return
    seededFor.current = key
    const index = board.dates.indexOf(activeDate)
    setSelectedSeats(board.seats.filter(seat => {
      const rank = seat.longRank[index]
      return rank != null && rank <= topN
    }).map(seat => seat.broker))
    setSelectedContracts(board.contracts.map(contract => contract.code))
    setRankContract('')
  }, [activeDate, board, topN, variety])

  const products = useMemo(() => {
    const items = (configQuery.data?.items ?? []).filter(item => item.enabled)
    const groups = new Map<string, CommodityConfigItem[]>()
    for (const item of items) {
      const list = groups.get(item.cate) ?? []
      list.push(item)
      groups.set(item.cate, list)
    }
    return [...groups.entries()]
  }, [configQuery.data])

  if (boardQuery.isLoading) return <div className={styles.state}>席位计算结果加载中...</div>
  if (boardQuery.isError || !board || !board.dates.length) {
    return (
      <section className={styles.panel}>
        <div className={styles.controls}>
          <label>品种<select aria-label="品种" value={variety} onChange={event => setVariety(event.target.value)}>
            {products.flatMap(([, items]) => items.map(item => <option key={item.code} value={item.code}>{item.code} · {item.name}</option>))}
          </select></label>
          <button type="button" className={styles.plain} onClick={() => { void boardQuery.refetch() }}>重试</button>
        </div>
        <div className={styles.state}>{boardQuery.isError ? '席位数据加载失败，请重试或切换品种。' : '该品种暂无席位数据，可切换其他品种。'}</div>
      </section>
    )
  }

  const [start, end] = windowOf(board.dates, activeDate, range)
  const dateIndex = board.dates.indexOf(activeDate)
  const dominant = board.dominant[dateIndex]
  const scopeName = { combined: '品种合并', seats: '分席位', contracts: '分合约' }[scope]
  const changeRows = (changesQuery.data?.rows ?? []).filter(row => {
    if (search && !row.broker.includes(search)) return false
    if (eventFilter === 'all') return true
    if (eventFilter === 'top') return row.event !== 'outside'
    return row.event === eventFilter
  })
  const rankBrokers = changesQuery.data?.ready
    ? changeRows.slice(0, 20).map(row => row.broker)
    : (rankHistoryQuery.data?.seats ?? []).filter(seat => (
        (!search || seat.broker.includes(search)) && seat.ranks.some(rank => rank != null && rank <= topN)
      )).slice(0, 20).map(seat => seat.broker)
  const rankMessage = rankHistoryQuery.isLoading ? '读取排名历史…' : rankHistoryQuery.isError ? '排名历史加载失败' : !rankBrokers.length ? '当前名单暂无排名数据' : undefined
  const deltaMessage = changesQuery.isLoading ? '读取单日净仓变化…' : changesQuery.isError ? '净仓变化加载失败' : !changesQuery.data?.ready ? '两日计算结果不全，暂不能比较。' : !changeRows.length ? '当前筛选下没有席位' : undefined

  const shiftDate = (step: number) => {
    const index = board.dates.indexOf(activeDate)
    const next = board.dates[index + step]
    if (next) setDate(next)
  }

  return (
    <section className={styles.panel}>
      <div className={styles.freshness} role="status">
        <strong>席位 {board.latestHoldingDate ?? '—'}</strong>
        <span>行情 {board.latestPriceDate ?? '—'}</span>
        <span>Tushare {board.metadata?.sourceDates?.tushare ?? '—'} · 新浪 {board.metadata?.sourceDates?.sina ?? '—'}</span>
        {board.missingHoldingDates?.includes(activeDate) && <span className={styles.note}>本交易日席位未更新，曲线保留空缺</span>}
        <button type="button" className={styles.refresh} disabled={boardQuery.isFetching} onClick={() => { void boardQuery.refetch(); if (page === 'changes') { void changesQuery.refetch(); void rankHistoryQuery.refetch() } }}>{boardQuery.isFetching ? '刷新中…' : '刷新'}</button>
      </div>
      <div className={styles.controls}>
        <div className={styles.tabs}>
          <button type="button" className={page === 'holdings' ? styles.active : ''} onClick={() => setPage('holdings')}>每日持仓</button>
          <button type="button" className={page === 'changes' ? styles.active : ''} onClick={() => setPage('changes')}>排名与持仓变动</button>
        </div>
        <label>
          品种
          <select aria-label="品种" value={variety} onChange={event => setVariety(event.target.value)}>
            {products.map(([cate, items]) => (
              <optgroup key={cate} label={cate}>
                {items.map(item => <option key={item.code} value={item.code}>{item.code} · {item.name}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <label>
          日期
          <select aria-label="日期" value={activeDate} onChange={event => setDate(event.target.value)}>
            {[...board.dates].reverse().map(day => <option key={day} value={day}>{day}</option>)}
          </select>
        </label>
        <div className={styles.segmented}>
          {TOP_NS.map(value => (
            <button key={value} type="button" className={topN === value ? styles.active : ''} onClick={() => setTopN(value)}>前 {value}</button>
          ))}
        </div>
        <button type="button" className={styles.plain} aria-label="上一交易日" onClick={() => shiftDate(-1)}>←</button>
        <button type="button" className={styles.plain} aria-label="下一交易日" onClick={() => shiftDate(1)}>→</button>
        {page === 'holdings' && (
          <label className={styles.spacer}>
            区间
            <select aria-label="区间" value={range} onChange={event => setRange(Number(event.target.value))}>
              <option value={30}>近 30 日</option>
              <option value={60}>近 60 日</option>
              <option value={999}>全部</option>
            </select>
          </label>
        )}
      </div>

      {page === 'holdings' && (
        <>
          <div className={styles.scopebar}>
            <div className={styles.segmented}>
              <button type="button" className={scope === 'combined' ? styles.active : ''} onClick={() => setScope('combined')}>合并数据</button>
              <button type="button" className={scope === 'seats' ? styles.active : ''} onClick={() => setScope('seats')}>分席位数据</button>
              <button type="button" className={scope === 'contracts' ? styles.active : ''} onClick={() => setScope('contracts')}>分合约数据</button>
            </div>
            <span className={styles.hint}>
              {scope === 'combined' && '每个交易日独立排序，席位名单动态变化'}
              {scope === 'seats' && '固定所选席位，汇总其全部合约后追踪'}
              {scope === 'contracts' && '每个合约、每个交易日分别排名'}
            </span>
          </div>
          {scope === 'seats' && (
            <>
              <div className={styles.pickers}>
                <span className={styles.hint}>指标</span>
                <div className={styles.segmented}>
                  {([['net', '抵消后净仓'], ['contractLong', '合约净多腿'], ['contractShort', '合约净空腿']] as const).map(([key, label]) => (
                    <button key={key} type="button" className={seatMetric === key ? styles.active : ''} onClick={() => setSeatMetric(key)}>{label}</button>
                  ))}
                </div>
                <button type="button" className={styles.preset} onClick={() => setSelectedSeats(board.seats.filter(seat => (seat.longRank[dateIndex] ?? 99) <= topN).map(seat => seat.broker))}>前{topN}净多</button>
                <button type="button" className={styles.preset} onClick={() => setSelectedSeats(board.seats.filter(seat => (seat.shortRank[dateIndex] ?? 99) <= topN).map(seat => seat.broker))}>前{topN}净空</button>
                <button type="button" className={styles.plain} onClick={() => setSelectedSeats([])}>清空选择</button>
                <button type="button" className={mergeSeats ? styles.active : styles.plain} onClick={() => setMergeSeats(value => !value)}>{mergeSeats ? '所选席位合并显示' : '各席位分别显示'}</button>
              </div>
              <div className={styles.seatGroups}>
                {(['机构', '家人', '产业', '外资'] as const).map(label => {
                  const members = board.seats.filter(seat => seat.seatLabel === label)
                  if (!members.length) return null
                  return (
                    <div key={label} className={styles.seatRow}>
                      <span className={`${styles.seatRowLabel} ${SEAT_GROUP_CLASS[label]}`}>{label}</span>
                      <div className={styles.seatRowChips}>
                        {members.map(seat => {
                          const on = selectedSeats.includes(seat.broker)
                          return (
                            <button
                              key={seat.broker}
                              type="button"
                              className={[styles.chip, SEAT_GROUP_CLASS[label], on ? styles.chipOn : ''].filter(Boolean).join(' ')}
                              aria-pressed={on}
                              onClick={() => setSelectedSeats(current => (
                                on ? current.filter(name => name !== seat.broker) : [...current, seat.broker]
                              ))}
                            >
                              {seat.broker}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
                <div className={styles.seatRow}>
                  <span className={styles.seatRowLabel}>其他</span>
                  <div className={styles.seatRowChips}>
                    <input
                      className={styles.seatSearch}
                      aria-label="搜索其他席位"
                      placeholder="搜索其他席位"
                      value={seatQuery}
                      onChange={event => setSeatQuery(event.target.value.trimStart())}
                    />
                    {board.seats.filter(seat => {
                      if (seat.seatLabel) return false
                      const query = seatQuery.trim()
                      return selectedSeats.includes(seat.broker) || (query.length > 0 && seat.broker.includes(query))
                    }).slice(0, 16).map(seat => {
                      const on = selectedSeats.includes(seat.broker)
                      return (
                        <button
                          key={seat.broker}
                          type="button"
                          className={on ? `${styles.chip} ${styles.chipOn} ${styles.groupOther}` : styles.chip}
                          aria-pressed={on}
                          onClick={() => setSelectedSeats(current => (
                            on ? current.filter(name => name !== seat.broker) : [...current, seat.broker]
                          ))}
                        >
                          {seat.broker}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            </>
          )}
          {scope === 'contracts' && (
            <div className={styles.chips}>
              <div className={styles.contractActions}>
                <span>合约 {selectedContracts.length}/{board.contracts.length}</span>
                <button type="button" className={styles.plain} onClick={() => setSelectedContracts(board.contracts.map(item => item.code))}>全选</button>
                <button type="button" className={styles.plain} onClick={() => setSelectedContracts(board.contracts.filter(item => item.longSum[dateIndex] != null || item.shortSum[dateIndex] != null).map(item => item.code))}>仅当日</button>
                <button type="button" className={styles.plain} onClick={() => setSelectedContracts([])}>清空</button>
              </div>
              {board.contracts.map(contract => {
                const on = selectedContracts.includes(contract.code)
                return (
                  <button
                    key={contract.code}
                    type="button"
                    className={on ? `${styles.chip} ${styles.chipOn} ${styles.groupContract}` : styles.chip}
                    aria-pressed={on}
                    onClick={() => setSelectedContracts(current => (
                      on ? current.filter(code => code !== contract.code) : [...current, contract.code]
                    ))}
                  >
                    {contract.code}{dominant === contract.code ? ' · 主力' : ''}
                  </button>
                )
              })}
            </div>
          )}
          <div className={styles.body}>
            <div className={styles.chartHead}>
              <h2>{board.varietyName} {board.variety} · {scopeName} · 前 {topN}</h2>
              <p>
                {scope === 'contracts' && '净多、净空上下分图，各自按合约堆叠。比值按各合约自己的前 N 计算。'}
                {scope === 'seats' && '固定所选席位。底图仍是品种每日前 N 多空比。'}
                {scope === 'combined' && '每日重新排序。前 N 净多 ÷ 前 N 净空，1 是参考线。'}
              </p>
            </div>
            <MainChart
              board={board}
              start={start}
              end={end}
              scope={scope}
              topN={topN}
              seatMetric={seatMetric}
              selectedSeats={selectedSeats}
              mergeSeats={mergeSeats}
              selectedContracts={selectedContracts}
            />
            <p className={styles.meta}>持仓单位：手 · 空仓合计取绝对值 · 席位标签沿用自定义分组</p>
          </div>
        </>
      )}

      {page === 'changes' && (
        <>
          <div className={styles.rankControls}>
            <label>
              范围
              <select aria-label="范围" value={rankContract} onChange={event => setRankContract(event.target.value)}>
                <option value="">品种合并</option>
                {board.contracts.map(contract => <option key={contract.code} value={contract.code}>{contract.code}</option>)}
              </select>
            </label>
            <div className={styles.segmented}>
              <button type="button" className={side === 'long' ? styles.active : ''} onClick={() => setSide('long')}>净多榜</button>
              <button type="button" className={side === 'short' ? styles.active : ''} onClick={() => setSide('short')}>净空榜</button>
            </div>
            <label>
              排名区间
              <select aria-label="排名区间" value={rankMonths} onChange={event => setRankMonths(Number(event.target.value))}>
                <option value={1}>近 1 个月</option>
                <option value={3}>近 3 个月</option>
                <option value={6}>近 6 个月</option>
              </select>
            </label>
            <label>
              名单
              <select aria-label="名单" value={eventFilter} onChange={event => setEventFilter(event.target.value)}>
                <option value="top">两日前 N 并集</option>
                <option value="entry">进入前 N</option>
                <option value="exit">退出前 N</option>
                <option value="all">全部席位</option>
              </select>
            </label>
            <input className={`${styles.search} ${styles.spacer}`} aria-label="搜索席位" placeholder="搜索席位" value={search} onChange={event => setSearch(event.target.value)} />
          </div>
          <div className={`${styles.body} ${styles.changesBody}`}>
            <p className={styles.summary}>
              {board.varietyName} · {changesQuery.data?.previousDate ?? '—'} → {activeDate} · 前 {topN} {side === 'long' ? '净多' : '净空'}
              {changesQuery.data?.ready ? ` · 进入 ${changesQuery.data.entryCount ?? 0} 家 / 退出 ${changesQuery.data.exitCount ?? 0} 家` : ''}
            </p>
            <ChangeCharts rows={changeRows} history={rankHistoryQuery.data} rankBrokers={rankBrokers}
              rankMessage={rankMessage} deltaMessage={deltaMessage}
              previousDate={changesQuery.data?.previousDate ?? null} date={activeDate} side={side} topN={topN} />
            {changesQuery.data?.ready && changesQuery.data.sameContracts === false && (
              <p className={styles.note}>两日已披露合约范围有变化。</p>
            )}
            {changesQuery.data?.ready && (
              <details className={styles.details}>
                <summary>席位明细：名次与持仓</summary>
                <div className={styles.tableWrap}>
                  <table>
                    <thead>
                      <tr>
                        <th>席位</th><th>标签</th><th>昨日名次</th><th>今日名次</th><th>名次变化</th><th>前 N 状态</th><th>昨日净仓</th><th>今日净仓</th><th>净仓变化</th>
                      </tr>
                    </thead>
                    <tbody>
                      {changeRows.map(row => (
                        <tr key={row.broker}>
                          <td>{row.broker}</td>
                          <td>{row.seatLabel ?? '—'}</td>
                          <td>{row.previousRank ?? '—'}</td>
                          <td>{row.rank ?? '—'}</td>
                          <td className={row.rankDelta == null ? '' : row.rankDelta > 0 ? styles.up : row.rankDelta < 0 ? styles.down : ''}>
                            {row.rankDelta == null ? '—' : row.rankDelta > 0 ? `↑ ${row.rankDelta}` : row.rankDelta < 0 ? `↓ ${-row.rankDelta}` : '持平'}
                          </td>
                          <td>{eventText(row.event, topN)}{row.sideChanged ? ' · 多空翻转' : ''}</td>
                          <td>{fmt(row.previousNet)}</td>
                          <td>{fmt(row.net)}</td>
                          <td className={row.delta > 0 ? styles.up : row.delta < 0 ? styles.down : ''}>{signed(row.delta)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className={styles.tableSummary}>{changeRows.length} 家席位。名次和净仓来自合表计算结果。</p>
              </details>
            )}
          </div>
        </>
      )}
    </section>
  )
}
