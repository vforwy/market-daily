import { useEffect, useRef } from 'react'
import type { EChartsCoreOption } from 'echarts/core'
import type { FixedContractSpreadChart, FixedContractSpreadPoint } from '../../api'
import { echarts } from '../../lib/echarts'
import {
  FIXED_SPREAD_COLORS,
  FIXED_SPREAD_CURVE_STYLES,
  sharedSpreadAxis,
  type FixedSpreadView,
  type SpreadAxisBounds,
} from '../../lib/fixedSpreadOverview'
import { tradingDates } from '../../lib/tradingAxis'
import styles from './FixedSpreadPair.module.css'

interface Props {
  charts: FixedContractSpreadChart[]
  dominantCode: string
  latestDate: string
  days: number
  resetVersion: number
  unit: string
  active?: boolean
}

interface Settings {
  latestDate: string
  days: number
  resetVersion: number
}

interface PairRuntime {
  updateWindow: (settings: Settings) => void
}

interface TooltipRow {
  seriesName: string
  color: string
  axisValueLabel?: string
  data?: { value: [string, number | null]; point?: FixedContractSpreadPoint }
}

interface ZoomRange {
  startValue?: string | number
  endValue?: string | number
  start?: number
  end?: number
}

function fmt(value: number | null | undefined): string {
  return value == null ? '--' : value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char] ?? char)
}

function initialView(dates: string[], { latestDate, days }: Settings): FixedSpreadView {
  let startDate = dates[0] ?? ''
  if (days > 0 && latestDate) {
    const date = new Date(`${latestDate}T00:00:00Z`)
    date.setUTCDate(date.getUTCDate() - days)
    const floor = date.toISOString().slice(0, 10)
    startDate = dates.find(value => value >= floor) ?? dates.at(-1) ?? ''
  }
  return { startDate, endDate: dates.at(-1) ?? '', selected: {} }
}

function zoomDate(dates: string[], value: string | number | undefined, percent: number): string {
  if (typeof value === 'string' && dates.includes(value)) return value
  const index = typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value)
    : Math.round(percent * (dates.length - 1) / 100)
  return dates[Math.max(0, Math.min(dates.length - 1, index))] ?? ''
}

function chartOption(
  item: FixedContractSpreadChart,
  dates: string[],
  view: FixedSpreadView,
  axis: SpreadAxisBounds,
  unit: string,
): EChartsCoreOption {
  const zoom = { startValue: view.startDate, endValue: view.endDate }
  return {
    backgroundColor: 'transparent', animation: false, color: FIXED_SPREAD_COLORS,
    textStyle: { fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif' },
    legend: {
      type: 'scroll', top: 1, left: 8, right: 8,
      itemWidth: 15, itemHeight: 7, itemGap: 8,
      textStyle: { color: '#aeb4bd', fontSize: 9 },
    },
    tooltip: {
      trigger: 'axis', confine: true,
      backgroundColor: '#1e1e1e', borderColor: '#444', padding: [7, 9],
      textStyle: { color: '#e4e4e4', fontSize: 11, lineHeight: 16 },
      formatter(params: unknown) {
        const rows = (Array.isArray(params) ? params : []) as TooltipRow[]
        const date = rows[0]?.axisValueLabel ?? rows[0]?.data?.value[0] ?? ''
        const lines = rows.filter(row => row.data?.point?.v != null).map(row => {
          const point = row.data?.point
          return `<span style="color:${row.color}">${escapeHtml(row.seriesName)}</span>：${fmt(point?.v)}`
            + ` <span style="color:#777">近 ${fmt(point?.nearPrice)} / 远 ${fmt(point?.farPrice)}</span>`
        })
        return `${escapeHtml(date)} · ${escapeHtml(unit)}<br/>${lines.join('<br/>')}`
      },
    },
    grid: { left: 54, right: 16, top: 54, bottom: 60 },
    xAxis: {
      type: 'category', data: dates, boundaryGap: false, axisTick: { show: false },
      axisLine: { lineStyle: { color: '#3b3f45' } },
      axisLabel: { color: '#8f98a5', fontSize: 9, hideOverlap: true, formatter: (value: string) => value.slice(5) },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value', scale: true, ...axis, name: unit, nameGap: 10,
      nameTextStyle: { color: '#777', fontSize: 9 },
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: '#8f98a5', fontSize: 9, formatter: fmt },
      splitLine: { lineStyle: { color: '#2f343a', type: 'dashed', opacity: 0.8 } },
    },
    dataZoom: [
      { type: 'inside', filterMode: 'none', ...zoom },
      {
        type: 'slider', filterMode: 'none', ...zoom,
        height: 16, bottom: 12, borderColor: '#333', backgroundColor: '#171717',
        fillerColor: 'rgba(89,156,231,.18)', handleStyle: { color: '#599ce7' },
        textStyle: { color: '#777', fontSize: 9 }, showDataShadow: false, brushSelect: false,
      },
    ],
    series: item.series.map((entry, index) => {
      const byDate = new Map(entry.points.map(point => [point.d, point]))
      const color = FIXED_SPREAD_COLORS[index % FIXED_SPREAD_COLORS.length]
      const style = FIXED_SPREAD_CURVE_STYLES[Math.min(index, FIXED_SPREAD_CURVE_STYLES.length - 1)]
      return {
        name: entry.label, type: 'line', showSymbol: false, symbol: 'circle', symbolSize: 4,
        sampling: 'lttb', connectNulls: false, clip: true, z: 10 - index,
        lineStyle: { ...style, color }, itemStyle: { color, opacity: style.opacity },
        emphasis: {
          focus: 'series', lineStyle: { width: Math.max(2.8, style.width + 0.5), opacity: 1 },
          itemStyle: { opacity: 1 },
        },
        data: dates.map(date => {
          const point = byDate.get(date)
          return { value: [date, point?.v ?? null], point }
        }),
        markLine: index === 0 ? {
          silent: true, symbol: 'none', label: { show: false },
          lineStyle: { color: '#555', width: 1 }, data: [{ yAxis: 0 }],
        } : undefined,
      }
    }),
  }
}

export default function FixedSpreadPair({
  charts, dominantCode, latestDate, days, resetVersion, unit, active = true,
}: Props) {
  const elementsRef = useRef<Array<HTMLDivElement | null>>([])
  const runtimeRef = useRef<PairRuntime | null>(null)
  const settingsRef = useRef<Settings>({ latestDate, days, resetVersion })

  useEffect(() => {
    const settings = { latestDate, days, resetVersion }
    settingsRef.current = settings
    runtimeRef.current?.updateWindow(settings)
  }, [latestDate, days, resetVersion])

  useEffect(() => {
    if (!active || !charts.length) return
    const elements = charts.map((_, index) => elementsRef.current[index])
    if (elements.some(element => !element)) return
    const settings = settingsRef.current
    const datesByChart = charts.map(item => tradingDates(item.series.map(series => series.points)))
    const views = datesByChart.map(dates => initialView(dates, settings))
    const instances = elements.map(element => echarts.init(element!))
    let axis = sharedSpreadAxis(charts, views)
    let lastResetVersion = settings.resetVersion

    const align = () => {
      axis = sharedSpreadAxis(charts, views, axis)
      instances.forEach((instance, index) => {
        instance.setOption({ yAxis: axis }, { silent: true })
        const card = elements[index]?.parentElement
        if (card) {
          card.dataset.axisMin = String(axis.min)
          card.dataset.axisMax = String(axis.max)
          card.dataset.axisInterval = String(axis.interval)
        }
      })
    }

    instances.forEach((instance, index) => {
      const dates = datesByChart[index]
      instance.setOption(chartOption(charts[index], dates, views[index], axis, unit))
      instance.on('datazoom', () => {
        const zooms = instance.getOption().dataZoom as ZoomRange[] | undefined
        const zoom = zooms?.[0]
        if (!zoom) return
        views[index].startDate = zoomDate(dates, zoom.startValue, zoom.start ?? 0)
        views[index].endDate = zoomDate(dates, zoom.endValue, zoom.end ?? 100)
        align()
      })
      const updateLegend = (event: unknown) => {
        const selected = (event as { selected?: Record<string, boolean> }).selected
        if (selected) views[index].selected = { ...selected }
        align()
      }
      instance.on('legendselectchanged', updateLegend)
      instance.on('legendselectall', updateLegend)
      instance.on('legendinverseselect', updateLegend)
    })

    const runtime: PairRuntime = {
      updateWindow(next) {
        const reset = next.resetVersion !== lastResetVersion
        lastResetVersion = next.resetVersion
        views.forEach((view, index) => {
          const window = initialView(datesByChart[index], next)
          view.startDate = window.startDate
          view.endDate = window.endDate
          if (reset) view.selected = {}
        })
        instances.forEach((instance, index) => {
          if (reset) instance.dispatchAction({ type: 'legendAllSelect' })
          instance.dispatchAction({
            type: 'dataZoom', startValue: views[index].startDate, endValue: views[index].endDate,
          })
        })
        align()
      },
    }
    runtimeRef.current = runtime
    align()
    const observer = new ResizeObserver(() => instances.forEach(instance => instance.resize()))
    elements.forEach(element => observer.observe(element!))
    return () => {
      observer.disconnect()
      instances.forEach(instance => instance.dispose())
      if (runtimeRef.current === runtime) runtimeRef.current = null
    }
  }, [charts, active, unit])

  return (
    <div className={styles.pair}>
      {charts.map((item, index) => (
        <article className={styles.card} key={item.nearCode} data-near-code={item.nearCode}>
          <div className={styles.header}>
            <h3 className={styles.title}>近月 {item.nearCode.split('.')[0]}</h3>
            <span className={styles.meta}>主力 {dominantCode.split('.')[0]}</span>
          </div>
          <div
            ref={element => { elementsRef.current[index] = element }}
            className={styles.chart}
            role="img"
            aria-label={`${item.nearCode.split('.')[0]} 固定合约月差，单位${unit}`}
          />
        </article>
      ))}
    </div>
  )
}
