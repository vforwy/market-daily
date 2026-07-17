import { useEffect, useRef, useState } from 'react'
import { echarts } from '../../lib/echarts'
import type { TermStructureChart } from '../../api'
import styles from './TermStructureMatrix.module.css'

const DATE_STYLES = [
  { color: '#8aa0b8', width: 1.5, opacity: 0.86, symbolSize: 4, type: 'dotted' },
  { color: '#88add4', width: 1.6, opacity: 0.9, symbolSize: 4, type: 'dashed' },
  { color: '#7fb8e8', width: 1.8, opacity: 0.94, symbolSize: 5, type: 'dashed' },
  { color: '#72c2ff', width: 2.2, opacity: 0.98, symbolSize: 6, type: 'solid' },
  { color: '#18a0ff', width: 3.0, opacity: 1.0, symbolSize: 7, type: 'solid' },
]

function legendLabel(date: string): string {
  if (date.length >= 10) return date.slice(5)
  if (date.length === 8) return `${date.slice(4, 6)}-${date.slice(6, 8)}`
  return date
}

interface Props {
  item: TermStructureChart
  compact?: boolean
  boxClass?: string
  priceField?: 'settle' | 'close'
}

export default function TermStructureCard({ item, compact = false, boxClass, priceField = 'settle' }: Props) {
  const elRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ReturnType<typeof echarts.init> | null>(null)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    if (!elRef.current || !isVisible) return
    if (!chartRef.current) {
      chartRef.current = echarts.init(elRef.current)
    }
    const chart = chartRef.current
    const oldToNew = [...item.dates].reverse()
    const legendNames = oldToNew.map(legendLabel)
    const topGridTop = compact ? 48 : 54
    const topGridBottom = compact ? '28%' : '36%'
    const volumeGridTop = compact ? '70%' : '64%'
    const volumeGridBottom = compact ? 24 : 68
    const xLabelRotate = compact ? 0 : 90
    const xLabelMargin = compact ? 10 : 8
    const xLabelFontSize = compact ? 10 : 9
    const seriesByDate = priceField === 'close'
      ? item.closeSeriesByDate ?? item.seriesByDate
      : item.settleSeriesByDate ?? item.seriesByDate
    const lines = oldToNew.map((d, idx) => {
      const dateStyle = DATE_STYLES[Math.min(idx, DATE_STYLES.length - 1)]
      return {
      name: legendNames[idx],
      type: 'line',
      symbol: 'circle',
      symbolSize: dateStyle.symbolSize,
      lineStyle: {
        width: dateStyle.width,
        color: dateStyle.color,
        opacity: dateStyle.opacity,
        type: dateStyle.type,
      },
      itemStyle: {
        color: dateStyle.color,
        opacity: dateStyle.opacity,
      },
      emphasis: {
        disabled: true,
      },
      data: item.months.map(m => seriesByDate[d]?.[m] ?? null),
      connectNulls: false,
      silent: true,
      }
    })

    chart.setOption({
      backgroundColor: 'transparent',
      animation: false,
      color: DATE_STYLES.map(style => style.color),
      legend: {
        show: true,
        type: 'scroll',
        top: 2,
        left: 8,
        right: 8,
        itemWidth: 14,
        itemHeight: 8,
        itemGap: 8,
        data: legendNames,
        textStyle: { color: '#bbb', fontSize: 10 },
        pageIconColor: '#888',
        pageTextStyle: { color: '#888' },
      },
      tooltip: { show: false },
      grid: [
        { left: 58, right: 18, top: topGridTop, bottom: topGridBottom },
        { left: 58, right: 18, top: volumeGridTop, bottom: volumeGridBottom },
      ],
      xAxis: [
        {
          type: 'category',
          data: item.months,
          axisTick: { show: false },
          axisLine: { lineStyle: { color: '#444' } },
          axisLabel: { show: false },
          splitLine: { show: false },
        },
        {
          type: 'category',
          gridIndex: 1,
          data: item.months,
          axisTick: { show: false },
          axisLine: { lineStyle: { color: '#444' } },
          axisLabel: {
            color: '#aaa',
            fontSize: xLabelFontSize,
            margin: xLabelMargin,
            interval: 0,
            rotate: xLabelRotate,
          },
          splitLine: { show: false },
        },
      ],
      yAxis: [
        {
          type: 'value',
          scale: true,
          position: 'left',
          axisLabel: {
            color: '#bbb',
            fontSize: 10,
            formatter: (v: number) => Number(v).toLocaleString(),
          },
          splitLine: { lineStyle: { color: '#333', type: 'dashed' } },
        },
        {
          type: 'value',
          gridIndex: 1,
          scale: true,
          position: 'left',
          axisLabel: {
            color: '#bbb',
            fontSize: 9,
            hideOverlap: true,
            formatter: (v: number) => v >= 10000 ? `${(v / 10000).toFixed(0)}万` : String(v),
          },
          splitNumber: 2,
          splitLine: { lineStyle: { color: '#333', type: 'dashed' } },
        },
      ],
      series: [
        ...lines,
        {
          name: `${legendLabel(item.latestDate)} 成交量`,
          type: 'bar',
          xAxisIndex: 1,
          yAxisIndex: 1,
          silent: true,
          legendHoverLink: false,
          barMaxWidth: compact ? 18 : 22,
          itemStyle: { color: '#8d95a3', opacity: 0.62 },
          data: item.months.map(m => item.latestVolume[m] || 0),
        },
      ],
    }, true)
    chart.resize()
  }, [compact, item, isVisible, priceField])

  useEffect(() => {
    if (!elRef.current) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '300px 0px' },
    )
    observer.observe(elRef.current)
    return () => observer.disconnect()
  }, [])

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
    <div className={[styles.card, compact ? styles.cardCompact : '', boxClass].filter(Boolean).join(' ')}>
      <div className={styles.header}>
        <span className={styles.title}>{item.code} {item.name}</span>
        <span className={styles.date}>{priceField === 'close' ? 'close' : 'settle'} · {item.latestDate.slice(5)}</span>
      </div>
      <div ref={elRef} className={styles.chart} />
    </div>
  )
}
