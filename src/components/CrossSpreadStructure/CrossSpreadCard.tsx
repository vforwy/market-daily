import { useEffect, useMemo, useRef } from 'react'
import type { CrossSpreadOverviewChart, CrossSpreadPoint } from '../../api'
import { echarts } from '../../lib/echarts'
import styles from './CrossSpreadStructure.module.css'

export type CrossSpreadViewMode = 'both' | 'fixed' | 'dominant'
export type CrossSpreadRange = '1y' | '3y' | 'all'

interface TooltipParam {
  seriesName: string
  color: string
  value: [string, number]
}

interface Props {
  item: CrossSpreadOverviewChart
  mode: CrossSpreadViewMode
  range: CrossSpreadRange
  onOpen: (item: CrossSpreadOverviewChart) => void
}

function formatValue(value: number | null | undefined): string {
  if (value == null) return '--'
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

function rangeStart(latestDate: string, range: CrossSpreadRange): string {
  if (range === 'all' || !latestDate) return ''
  const date = new Date(`${latestDate}T00:00:00`)
  date.setFullYear(date.getFullYear() - (range === '1y' ? 1 : 3))
  return date.toISOString().slice(0, 10)
}

function filterPoints(points: CrossSpreadPoint[], cutoff: string): CrossSpreadPoint[] {
  return cutoff ? points.filter(point => point.d >= cutoff) : points
}

export default function CrossSpreadCard({ item, mode, range, onOpen }: Props) {
  const elRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ReturnType<typeof echarts.init> | null>(null)
  const cutoff = rangeStart(item.latestDate, range)
  const fixed = useMemo(() => filterPoints(item.fixedSeries, cutoff), [cutoff, item.fixedSeries])
  const dominant = useMemo(
    () => filterPoints(item.dominantSeries, cutoff),
    [cutoff, item.dominantSeries],
  )

  useEffect(() => {
    if (!elRef.current) return
    if (!chartRef.current) chartRef.current = echarts.init(elRef.current)
    const chart = chartRef.current
    const fixedByDate = new Map(fixed.map(point => [point.d, point]))
    const dominantByDate = new Map(dominant.map(point => [point.d, point]))
    const series = []

    if (mode !== 'dominant') {
      series.push({
        name: item.currentMonthLabel || '当前主力同月',
        type: 'line',
        showSymbol: false,
        symbol: 'circle',
        sampling: 'lttb',
        connectNulls: false,
        lineStyle: { width: 1.8, color: '#18a0ff' },
        itemStyle: { color: '#18a0ff' },
        data: fixed.map(point => [point.d, point.v]),
        markLine: {
          silent: true,
          symbol: 'none',
          label: { show: false },
          lineStyle: { color: '#3a3a3a', width: 1 },
          data: [{ yAxis: 0 }],
        },
      })
    }
    if (mode !== 'fixed') {
      series.push({
        name: '主力未复权',
        type: 'line',
        showSymbol: false,
        symbol: 'circle',
        sampling: 'lttb',
        connectNulls: false,
        lineStyle: { width: 1.8, type: 'solid', color: '#f0ad4e', opacity: 0.92 },
        itemStyle: { color: '#f0ad4e' },
        data: dominant.map(point => [point.d, point.v]),
      })
    }

    chart.setOption({
      backgroundColor: 'transparent',
      animation: false,
      grid: { left: 54, right: 14, top: 30, bottom: 30 },
      legend: {
        top: 0,
        right: 8,
        itemWidth: 16,
        itemHeight: 7,
        textStyle: { color: '#999', fontSize: 9 },
      },
      tooltip: {
        trigger: 'axis',
        confine: true,
        backgroundColor: '#202020',
        borderColor: '#444',
        textStyle: { color: '#ddd', fontSize: 11 },
        formatter: (raw: TooltipParam | TooltipParam[]) => {
          const params = Array.isArray(raw) ? raw : [raw]
          const date = params[0]?.value?.[0] ?? ''
          const lines = params.map(param => {
            const point = param.seriesName === '主力未复权'
              ? dominantByDate.get(date)
              : fixedByDate.get(date)
            const contract = point?.instance ? `<br/><span style="color:#888">${point.instance}</span>` : ''
            return `${param.seriesName}：${formatValue(point?.v)}${contract}`
          })
          return `${date}<br/>${lines.join('<br/>')}`
        },
      },
      xAxis: {
        type: 'time',
        axisTick: { show: false },
        axisLine: { lineStyle: { color: '#444' } },
        axisLabel: { color: '#777', fontSize: 9, hideOverlap: true },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLabel: {
          color: '#888',
          fontSize: 9,
          formatter: (value: number) => Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 0 }),
        },
        splitLine: { lineStyle: { color: '#2d2d2d', type: 'dashed' } },
      },
      series,
    }, true)
    chart.resize()
  }, [dominant, fixed, item.currentMonthLabel, mode])

  useEffect(() => {
    const observer = new ResizeObserver(() => chartRef.current?.resize())
    if (elRef.current) observer.observe(elRef.current)
    return () => {
      observer.disconnect()
      chartRef.current?.dispose()
      chartRef.current = null
    }
  }, [])

  return (
    <article
      className={styles.card}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(item)}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') onOpen(item)
      }}
    >
      <div className={styles.cardHeader}>
        <div>
          <div className={styles.cardTitle}>{item.name}</div>
          <div className={styles.cardMeta}>当前同月 {item.currentMonthLabel || '--'}</div>
        </div>
        <span className={styles.openHint}>详情 ›</span>
      </div>
      <div className={styles.latestStrip}>
        {mode !== 'dominant' && (
          <span><i className={styles.fixedDot} />{item.currentMonthLabel || '同月'} {formatValue(item.latestFixed?.v)}</span>
        )}
        {mode !== 'fixed' && (
          <span><i className={styles.dominantDot} />主力 {formatValue(item.latestDominant?.v)}</span>
        )}
      </div>
      <div ref={elRef} className={styles.cardChart} />
    </article>
  )
}
