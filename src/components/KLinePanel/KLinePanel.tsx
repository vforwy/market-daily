import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { echarts } from '../../lib/echarts'
import { barsToChartOhlc, volumeBarIsUp } from '../../lib/klineOhlc'
import { MANUAL_REFRESH_STALE_TIME, MARKET_DATA_GC_TIME } from '../../lib/queryFreshness'
import { api, type KLineOption } from '../../api'
import SpreadSeasonalityPanel from '../SpreadSeasonalityPanel/SpreadSeasonalityPanel'
import TermStructureCard from '../TermStructureMatrix/TermStructureCard'
import styles from './KLinePanel.module.css'

const UP = '#e84545', DN = '#2eaa6a'

function getNumericValue(value: unknown): number {
  if (Array.isArray(value)) return Number(value[value.length - 1] ?? 0)
  return Number(value ?? 0)
}

interface Props {
  code: string
  name: string
}

function fmtXLabel(d: string, i: number, all: string[]): string {
  if (d.length <= 10) return d
  const time = d.slice(11, 16)
  if (i === 0) return d.slice(5, 10).replace('-', '/') + '\n' + time
  const prevDate = all[i - 1].slice(0, 10)
  const curDate  = d.slice(0, 10)
  if (curDate !== prevDate) return curDate.slice(5).replace('-', '/') + '\n' + time
  return time
}

function varietyFromContract(code: string): string {
  const match = code.toUpperCase().match(/^([A-Z]+)\d+\./)
  return match?.[1] ?? code.split('.')[0].toUpperCase()
}

export default function KLinePanel({ code, name }: Props) {
  const panelRef   = useRef<HTMLElement>(null)
  const elRef      = useRef<HTMLDivElement>(null)
  const chartRef   = useRef<ReturnType<typeof echarts.init> | null>(null)
  const selectedStorageKey = `fom:kline-selected:${code}`
  const scrollStorageKey = `fom:kline-scroll:${code}`
  const [selectedState, setSelectedState] = useState(() => ({
    code,
    key: window.localStorage.getItem(selectedStorageKey) ?? `contract:${code}`,
  }))
  const selectedKey = selectedState.code === code
    ? selectedState.key
    : window.localStorage.getItem(selectedStorageKey) ?? `contract:${code}`

  useEffect(() => {
    window.localStorage.setItem(selectedStorageKey, selectedKey)
  }, [selectedKey, selectedStorageKey])

  const { data: optionData } = useQuery({
    queryKey: ['klineOptions', code],
    queryFn: () => api.klineOptions(code),
    staleTime: MANUAL_REFRESH_STALE_TIME,
    gcTime: MARKET_DATA_GC_TIME,
  })

  const selectedOption = optionData?.options.find(
    (option) => `${option.kind}:${option.value}` === selectedKey,
  ) ?? optionData?.selected

  const queryCode = selectedOption?.kind === 'contract' ? selectedOption.value : undefined
  const queryVariety = selectedOption?.kind === 'dominant_continuous'
    ? selectedOption.value
    : optionData?.variety ?? varietyFromContract(code)

  const { data: bars = [], isLoading } = useQuery({
    queryKey: ['kline', selectedOption?.kind ?? 'contract', queryCode ?? '', queryVariety ?? ''],
    queryFn: () => api.kline({
      code: queryCode,
      kind: selectedOption?.kind ?? 'contract',
      variety: queryVariety,
    }),
    staleTime: MANUAL_REFRESH_STALE_TIME,
    gcTime: MARKET_DATA_GC_TIME,
    enabled: Boolean(queryCode || queryVariety),
  })

  const variety = optionData?.variety ?? varietyFromContract(code)
  const { data: termData, isLoading: isTermLoading } = useQuery({
    queryKey: ['termStructure', variety],
    queryFn: () => api.termStructure(variety),
    staleTime: MANUAL_REFRESH_STALE_TIME,
    gcTime: MARKET_DATA_GC_TIME,
  })

  useEffect(() => {
    if (!elRef.current || !bars.length) return

    if (!chartRef.current) {
      chartRef.current = echarts.init(elRef.current, 'dark')
    }
    const chart = chartRef.current
    const dates = bars.map(b => b.d)
    const ohlc  = barsToChartOhlc(bars)
    const vols  = bars.map(b => b.v)
    const xLabels = dates.map((d, i) => fmtXLabel(d, i, dates))
    const zoomStart = 50
    const dayBoundaries: number[] = []

    chart.setOption({
      backgroundColor: 'transparent',
      animation: false,
      title: [
        {
          text: '成交量',
          top: '71%', left: 28,
          textStyle: { color: '#999', fontSize: 11, fontWeight: 'normal' },
        },
      ],
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        backgroundColor: '#1e1e1e',
        borderColor: '#333',
        textStyle: { color: '#e4e4e4', fontSize: 12 },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter(params: any) {
          const p0 = (params as { dataIndex?: number }[])[0]
          const d = p0?.dataIndex != null ? dates[p0.dataIndex] : ''
          let html = `<div style="color:#666;font-size:11px;margin-bottom:3px">${d}</div>`
          ;(params as { seriesName: string; value: unknown }[]).forEach(p => {
            if (p.seriesName === 'K线') {
              const bar = p0?.dataIndex != null ? bars[p0.dataIndex] : null
              if (!bar) return
              const { o, c, l, h } = bar
              const col = c >= (o > 0 ? o : c) ? UP : DN
              html += `<div style="color:${col}">开 ${o.toLocaleString()} &nbsp;高 ${h.toLocaleString()} &nbsp;低 ${l.toLocaleString()} &nbsp;收 ${c.toLocaleString()}</div>`
            } else if (p.seriesName === '成交量') {
              html += `<div style="color:#666;font-size:11px">量 ${getNumericValue(p.value).toLocaleString()}</div>`
            }
          })
          return html
        },
      },
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      dataZoom: [
        { type: 'inside', xAxisIndex: [0, 1], start: zoomStart, end: 100 },
        {
          type: 'slider', xAxisIndex: [0, 1], height: 20, bottom: 4,
          start: zoomStart, end: 100,
          borderColor: '#2a2a2a', fillerColor: '#599ce720',
          handleStyle: { color: '#599ce7' },
          textStyle: { color: '#555', fontSize: 10 },
        },
      ],
      grid: [
        { left: 28, right: 54, top: 12, bottom: '36%' },
        { left: 28, right: 54, top: '72%', bottom: 60 },
      ],
      xAxis: [
        {
          type: 'category', data: xLabels, gridIndex: 0,
          axisLine: { show: true, lineStyle: { color: '#555', width: 1 } },
          axisTick: { show: false },
          axisLabel: { show: false },
          splitLine: { show: false },
        },
        {
          type: 'category', data: xLabels, gridIndex: 1,
          axisLine: { lineStyle: { color: '#444' } },
          axisTick: { show: false },
          axisLabel: {
            rich: { day: { color: '#e0b96a', fontSize: 11, lineHeight: 16 } },
            fontSize: 11, lineHeight: 16, color: '#aaa',
            formatter: (value: string) =>
              value.includes('/') ? `{day|${value}}` : value,
          },
          splitLine: { show: false },
        },
      ],
      yAxis: [
        {
          scale: true, gridIndex: 0,
          position: 'right',
          splitLine: { lineStyle: { color: '#333', type: 'dashed' } },
          axisLine: { show: false },
          axisTick: { length: 4, lineStyle: { color: '#555' } },
          axisLabel: { color: '#bbb', fontSize: 11 },
        },
        {
          scale: true, gridIndex: 1,
          position: 'right',
          splitLine: { lineStyle: { color: '#333', type: 'dashed' } },
          axisLine: { show: false },
          axisTick: { length: 4, lineStyle: { color: '#555' } },
          axisLabel: {
            color: '#bbb', fontSize: 11,
            formatter: (v: number) => v >= 10000 ? (v / 10000).toFixed(0) + '万' : String(v),
          },
          splitNumber: 3,
        },
      ],
      series: [
        {
          name: 'K线',
          type: 'candlestick',
          xAxisIndex: 0, yAxisIndex: 0,
          data: ohlc,
          itemStyle: { color: UP, color0: DN, borderColor: UP, borderColor0: DN, borderWidth: 1 },
          markLine: dayBoundaries.length ? {
            silent: true,
            symbol: ['none', 'none'],
            lineStyle: { color: '#e0b96a', type: 'dashed', width: 1, opacity: 0.5 },
            label: { show: false },
            data: dayBoundaries.map(idx => ({ xAxis: idx })),
          } : undefined,
        },
        {
          name: '成交量',
          type: 'bar',
          xAxisIndex: 1, yAxisIndex: 1,
          barMaxWidth: 8,
          data: vols.map((v, i) => ({
            value: v,
            itemStyle: { color: volumeBarIsUp(bars[i]) ? UP + '99' : DN + '99' },
          })),
          markLine: dayBoundaries.length ? {
            silent: true,
            symbol: ['none', 'none'],
            lineStyle: { color: '#e0b96a', type: 'dashed', width: 1, opacity: 0.5 },
            label: { show: false },
            data: dayBoundaries.map(idx => ({ xAxis: idx })),
          } : undefined,
        },
      ],
    }, true)
  }, [bars])

  useEffect(() => {
    const observer = new ResizeObserver(() => chartRef.current?.resize())
    if (elRef.current) observer.observe(elRef.current)
    return () => {
      observer.disconnect()
      chartRef.current?.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const savedTop = Number(window.localStorage.getItem(scrollStorageKey) ?? 0)
    if (savedTop > 0) {
      requestAnimationFrame(() => {
        panel.scrollTop = savedTop
      })
    }
    const onScroll = () => {
      window.localStorage.setItem(scrollStorageKey, String(panel.scrollTop))
    }
    panel.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      panel.removeEventListener('scroll', onScroll)
    }
  }, [scrollStorageKey])

  return (
    <section ref={panelRef} className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>
          {name && <span>{name}</span>}
          <span className={styles.titleCode}>
            {selectedOption?.kind === 'dominant_continuous'
              ? `${variety} 主力连续`
              : (queryCode ?? code)}
          </span>
        </span>
        <div className={styles.controls}>
          <label className={styles.selectLabel}>
            <span>合约</span>
            <select
              className={styles.select}
              value={selectedOption ? `${selectedOption.kind}:${selectedOption.value}` : selectedKey}
              onChange={(event) => setSelectedState({ code, key: event.target.value })}
            >
              {(optionData?.options ?? [{ kind: 'contract', value: code, label: `主力合约 ${code}` } as KLineOption]).map((option) => (
                <option key={`${option.kind}:${option.value}`} value={`${option.kind}:${option.value}`}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <div className={styles.chartWrap}>
        {isLoading && <div className={styles.loading}>加载中...</div>}
        {!isLoading && bars.length === 0 && <div className={styles.loading}>暂无数据</div>}
        <div ref={elRef} className={styles.chart}
             style={{ visibility: isLoading || bars.length === 0 ? 'hidden' : 'visible' }} />
      </div>
      <div className={styles.bottomRow}>
        <div className={styles.termWrap}>
          <div className={styles.termHeader}>期限结构（{variety}）</div>
          <div className={styles.termSplit}>
            <div className={styles.termContent}>
              {isTermLoading && <div className={styles.termState}>期限结构加载中...</div>}
              {!isTermLoading && !termData?.chart && <div className={styles.termState}>暂无期限结构数据</div>}
              {!isTermLoading && termData?.chart && (
                <TermStructureCard item={termData.chart} compact priceField="settle" boxClass={styles.termCardFill} />
              )}
            </div>
            <div className={styles.termContentRight}>
              {isTermLoading && <div className={styles.termState}>期限结构加载中...</div>}
              {!isTermLoading && !termData?.chart && <div className={styles.termState}>暂无期限结构数据</div>}
              {!isTermLoading && termData?.chart && (
                <TermStructureCard item={termData.chart} compact priceField="close" boxClass={styles.termCardFill} />
              )}
            </div>
          </div>
        </div>
        <SpreadSeasonalityPanel variety={variety} />
      </div>
    </section>
  )
}
