import { useEffect, useMemo, useRef } from 'react'
import { useEChart } from '../../hooks/useEChart'
import {
  calendarSeasonalWindow,
  pointAtSeasonAxisKey,
  seasonalAxisKeys,
  seasonalAxisLabel,
  seasonalAxisTooltipLabel,
  seasonalPointKey,
  seasonalYears,
  seasonalWindowLabel,
} from '../../lib/seasonalAxis'
import type { SpreadSeasonalChart, SpreadSeasonalPoint } from '../../api'
import styles from './SpreadSeasonalityPanel.module.css'

const YEAR_STYLES = [
  { color: '#9b5de5', opacity: 0.6, width: 1.3 },
  { color: '#00b4d8', opacity: 0.68, width: 1.4 },
  { color: '#6aa878', opacity: 0.72, width: 1.4 },
  { color: '#d6aa5c', opacity: 0.88, width: 1.7 },
  { color: '#e35b55', opacity: 1, width: 3 },
]

interface TooltipRow {
  seriesName: string
  axisValue?: string
  data?: {
    point?: SpreadSeasonalPoint
  } | null
}

interface Props {
  item: SpreadSeasonalChart
  years: number[]
}

function fmt(value: number | null | undefined): string {
  if (value == null) return '-'
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })
}

export default function SpreadSeasonalityCard({ item, years }: Props) {
  const elRef = useRef<HTMLDivElement>(null)
  const renderChart = useEChart(elRef, 'dark')
  const window = useMemo(() => item.seasonAxis === 'delivery-year'
    ? calendarSeasonalWindow(item.nearMonth, item.farMonth, item.farYearOffset)
    : undefined, [item.seasonAxis, item.nearMonth, item.farMonth, item.farYearOffset])

  useEffect(() => {
    if (!elRef.current) return

    const orderedYears = seasonalYears(item.seriesByYear, years, item.seasonAxis)
    const xLabels = seasonalAxisKeys(
      item.seriesByYear,
      item.seasonAxis === 'delivery-year' ? orderedYears : years,
      item.seasonAxis,
      window,
    )
    const pointsByYear = new Map(
      orderedYears.map(year => [year, item.seriesByYear[String(year)] ?? []]),
    )
    const series = orderedYears.map((year, index) => {
      const points = pointsByYear.get(year) ?? []
      const byX = new Map(points.map(point => [seasonalPointKey(point, year, item.seasonAxis), point]))
      const style = YEAR_STYLES[index] ?? YEAR_STYLES[YEAR_STYLES.length - 1]
      return {
        name: String(year),
        type: 'line',
        showSymbol: false,
        symbol: 'circle',
        symbolSize: index === orderedYears.length - 1 ? 5 : 3,
        connectNulls: true,
        z: index + 1,
        data: xLabels.map(x => {
          const point = byX.get(x)
          return point ? {
            value: point.v,
            point,
          } : null
        }),
        lineStyle: {
          width: style.width,
          color: style.color,
          opacity: style.opacity,
          type: 'solid',
        },
        itemStyle: {
          color: style.color,
          opacity: style.opacity,
        },
      }
    })

    renderChart({
      backgroundColor: 'transparent',
      animation: false,
      legend: {
        top: -2,
        data: orderedYears.map(String),
        right: 6,
        itemWidth: 16,
        itemHeight: 6,
        itemGap: 8,
        lineStyle: { width: 2 },
        textStyle: { color: '#aeb4bd', fontSize: 10 },
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#1e1e1e',
        borderColor: '#333',
        padding: [6, 8],
        textStyle: { color: '#e4e4e4', fontSize: 12, lineHeight: 16 },
        formatter(params: unknown) {
          const rows = params as TooltipRow[]
          const firstPoint = rows[0]?.data?.point
          const x = rows[0]?.axisValue ?? (firstPoint
            ? seasonalPointKey(firstPoint, Number(rows[0].seriesName), item.seasonAxis)
            : '')
          let html = `<div style="color:#777;font-size:11px;margin-bottom:4px">${seasonalAxisTooltipLabel(x, item.seasonAxis, window)}</div>`
          orderedYears.forEach((year, index) => {
            const point = pointAtSeasonAxisKey(pointsByYear.get(year) ?? [], x, year, item.seasonAxis)
            if (!point) return
            const color = YEAR_STYLES[index]?.color ?? YEAR_STYLES[0].color
            html += `<div style="white-space:nowrap;margin-bottom:1px">`
            html += `<span style="color:${color};font-weight:600">${year}: ${fmt(point.v)}</span>`
            html += ` <span style="color:#7a7f87">${item.seasonAxis === 'delivery-year' ? `${point.d} · ` : ''}${point.instance || ''}</span>`
            html += `</div>`
          })
          return html
        },
      },
      grid: { left: 48, right: 14, top: 30, bottom: 28 },
      xAxis: {
        type: 'category',
        data: xLabels,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: '#3b3f45' } },
        axisLabel: {
          color: '#8f98a5',
          fontSize: 10,
          hideOverlap: item.seasonAxis === 'delivery-year',
          interval: 0,
          formatter(value: string, index: number) {
            return seasonalAxisLabel(value, xLabels[index - 1], item.seasonAxis, window)
          },
        },
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: '#8f98a5', fontSize: 10 },
        splitLine: { lineStyle: { color: '#2f343a', type: 'dashed', opacity: 0.8 } },
      },
      series,
    })
  }, [item, years, renderChart, window])

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <span className={styles.title}>{item.spreadName}</span>
        <span className={styles.meta}>{item.latestInstance}</span>
      </div>
      {item.seasonAxis === 'delivery-year' && (
        <div className={styles.seasonNote}>
          {window ? seasonalWindowLabel(window) : '固定合约历史'} · 固定合约对{item.priceBasis === 'raw_close' ? ' · 未复权收盘价' : ''}
        </div>
      )}
      <div ref={elRef} className={styles.chart} />
    </div>
  )
}
