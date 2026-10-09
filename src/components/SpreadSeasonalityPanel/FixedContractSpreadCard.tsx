import { useEffect, useMemo, useRef } from 'react'
import type {
  FixedContractSpreadChart,
  FixedContractSpreadPoint,
} from '../../api'
import { useEChart } from '../../hooks/useEChart'
import { tradingDates } from '../../lib/tradingAxis'
import styles from './SpreadSeasonalityPanel.module.css'

const SERIES_COLORS = ['#18a0ff', '#f0ad4e', '#9b8afb', '#32c5a2', '#e56b9f']

interface TooltipRow {
  seriesName: string
  color: string
  data?: {
    value: [string, number | null]
    point: FixedContractSpreadPoint
  }
}

function fmt(value: number | null | undefined): string {
  if (value == null) return '--'
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

interface Props {
  item: FixedContractSpreadChart
  dominantCode: string
}

export default function FixedContractSpreadCard({ item, dominantCode }: Props) {
  const elRef = useRef<HTMLDivElement>(null)
  const renderChart = useEChart(elRef, undefined, true)
  const dates = useMemo(
    () => tradingDates(item.series.map(entry => entry.points)),
    [item.series],
  )

  useEffect(() => {
    if (!elRef.current) return

    const series = item.series.map((entry, index) => ({
      name: entry.label,
      type: 'line',
      showSymbol: false,
      symbol: 'circle',
      sampling: 'lttb',
      connectNulls: false,
      lineStyle: { width: 1.8, type: 'solid', color: SERIES_COLORS[index] },
      itemStyle: { color: SERIES_COLORS[index] },
      data: entry.points.map(point => ({
        value: [point.d, point.v],
        point,
      })),
      markLine: index === 0 ? {
        silent: true,
        symbol: 'none',
        label: { show: false },
        lineStyle: { color: '#555', width: 1 },
        data: [{ yAxis: 0 }],
      } : undefined,
    }))

    renderChart({
      backgroundColor: 'transparent',
      animation: false,
      color: SERIES_COLORS,
      legend: {
        type: 'scroll',
        top: 1,
        left: 8,
        right: 8,
        itemWidth: 15,
        itemHeight: 7,
        itemGap: 8,
        textStyle: { color: '#aeb4bd', fontSize: 9 },
      },
      tooltip: {
        trigger: 'axis',
        confine: true,
        backgroundColor: '#1e1e1e',
        borderColor: '#444',
        padding: [7, 9],
        textStyle: { color: '#e4e4e4', fontSize: 11, lineHeight: 16 },
        formatter(params: unknown) {
          const rows = params as TooltipRow[]
          const date = String(rows[0]?.data?.value?.[0] ?? '')
          const lines = rows.map(row => {
            const point = row.data?.point
            return [
              `<span style="color:${row.color}">${row.seriesName}</span>：${fmt(point?.v)}`,
              `<span style="color:#777">近 ${fmt(point?.nearPrice)} / 远 ${fmt(point?.farPrice)}</span>`,
            ].join(' ')
          })
          return `${date}<br/>${lines.join('<br/>')}`
        },
      },
      grid: { left: 54, right: 16, top: 54, bottom: 60 },
      xAxis: {
        type: 'category',
        data: dates,
        boundaryGap: false,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: '#3b3f45' } },
        axisLabel: {
          color: '#8f98a5',
          fontSize: 9,
          hideOverlap: true,
          formatter: (value: string) => value.slice(5),
        },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: '#8f98a5',
          fontSize: 9,
          formatter: (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 0 }),
        },
        splitLine: { lineStyle: { color: '#2f343a', type: 'dashed', opacity: 0.8 } },
      },
      dataZoom: [
        { type: 'inside', filterMode: 'none' },
        {
          type: 'slider',
          height: 16,
          bottom: 12,
          borderColor: '#333',
          backgroundColor: '#171717',
          fillerColor: 'rgba(89,156,231,.18)',
          handleStyle: { color: '#599ce7' },
          textStyle: { color: '#777', fontSize: 9 },
          showDataShadow: false,
        },
      ],
      series,
    })

  }, [dates, item, renderChart])

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <span className={styles.title}>近月 {item.nearCode.split('.')[0]}</span>
        <span className={styles.meta}>主力 {dominantCode.split('.')[0]}</span>
      </div>
      <div ref={elRef} className={styles.chart} />
    </div>
  )
}
