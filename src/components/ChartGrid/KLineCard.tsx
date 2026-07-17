import { useEffect, useRef, useState } from 'react'
import { echarts } from '../../lib/echarts'
import { barsToChartOhlc, volumeBarIsUp } from '../../lib/klineOhlc'
import type { Bar } from '../../api'
import styles from './KLineCard.module.css'

const UP = '#e84545', DN = '#2eaa6a'

interface Props {
  code: string
  name: string
  bars: Bar[]
  changePct?: number | null
  onOpen: () => void
}

export default function KLineCard({ name, bars, changePct, onOpen }: Props) {
  const elRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ReturnType<typeof echarts.init> | null>(null)
  const [isVisible, setIsVisible] = useState(false)

  const latest = bars[bars.length - 1]
  const hasPct = changePct != null && !Number.isNaN(changePct)
  const isUp = hasPct && changePct >= 0

  useEffect(() => {
    if (!elRef.current || !bars.length || !isVisible) return
    if (!chartRef.current) {
      chartRef.current = echarts.init(elRef.current, 'dark')
    }
    const chart = chartRef.current
    const dates = bars.map(b => b.d)
    const ohlc  = barsToChartOhlc(bars)
    const vols  = bars.map(b => b.v)

    chart.setOption({
      backgroundColor: 'transparent',
      animation: false,
      title: [
        {
          text: 'VOL',
          top: '73%', left: 10,
          textStyle: { color: '#555', fontSize: 9, fontWeight: 'normal' },
        },
      ],
      grid: [
        { left: 10, right: 40, top: 2, bottom: '30%' },
        { left: 10, right: 40, top: '74%', bottom: 2 },
      ],
      xAxis: [
        {
          type: 'category', data: dates, gridIndex: 0,
          axisLine: { show: true, lineStyle: { color: '#3a3a3a', width: 1 } },
          axisTick: { show: false },
          axisLabel: { show: false },
          splitLine: { show: false },
        },
        { type: 'category', data: dates, gridIndex: 1, show: false },
      ],
      yAxis: [
        {
          scale: true, gridIndex: 0,
          position: 'right',
          axisLine: { show: false },
          axisTick: { length: 3, lineStyle: { color: '#444' } },
          splitLine: { lineStyle: { color: '#ffffff10', type: 'dashed' } },
          axisLabel: { color: '#777', fontSize: 9, margin: 4 },
        },
        {
          scale: true, gridIndex: 1,
          position: 'right',
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { show: false },
          splitNumber: 2,
        },
      ],
      series: [
        {
          type: 'candlestick',
          xAxisIndex: 0, yAxisIndex: 0,
          data: ohlc,
          itemStyle: { color: UP, color0: DN, borderColor: UP, borderColor0: DN, borderWidth: 1 },
        },
        {
          type: 'bar',
          xAxisIndex: 1, yAxisIndex: 1,
          data: vols.map((v, i) => ({
            value: v,
            itemStyle: { color: volumeBarIsUp(bars[i]) ? UP + '99' : DN + '99' },
          })),
          barMaxWidth: 6,
        },
      ],
      tooltip: { show: false },
    }, true)
  }, [bars, isVisible])

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
    <div className={styles.card} onClick={onOpen}>
      <div className={styles.header}>
        <span className={styles.code}>{name}</span>
        {latest && (
          <span className={`${styles.price} ${hasPct ? (isUp ? styles.up : styles.dn) : ''}`}>
            {latest.c.toLocaleString()}
            <span className={styles.pct}>
              {hasPct ? `${isUp ? '+' : ''}${changePct.toFixed(2)}%` : '-'}
            </span>
          </span>
        )}
      </div>
      <div ref={elRef} className={styles.chart} />
    </div>
  )
}
