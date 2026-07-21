import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  api,
  type CrossSpreadDetailResponse,
  type CrossSpreadPoint,
} from '../../api'
import { echarts } from '../../lib/echarts'
import styles from './CrossSpreadStructure.module.css'

const DOMINANT_KEY = 'dominant'
const COLORS = ['#18a0ff', '#9b8afb', '#32c5a2', '#e88c5c', '#d4c15f', '#e56b9f', '#8fc35d']

interface TooltipParam {
  seriesName: string
  color: string
  value: [string, number]
}

function formatValue(value: number | null | undefined): string {
  if (value == null) return '--'
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

function StructureChart({ data }: { data: CrossSpreadDetailResponse }) {
  const elRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ReturnType<typeof echarts.init> | null>(null)

  useEffect(() => {
    if (!elRef.current) return
    if (!chartRef.current) chartRef.current = echarts.init(elRef.current)
    const dominantLatest = data.dominantSeries.at(-1)?.v
    const byLabel = new Map(data.structure.map(point => [point.label, point]))
    chartRef.current.setOption({
      backgroundColor: 'transparent',
      animation: false,
      grid: { left: 68, right: 28, top: 36, bottom: 48 },
      tooltip: {
        trigger: 'axis',
        confine: true,
        backgroundColor: '#202020',
        borderColor: '#444',
        textStyle: { color: '#ddd', fontSize: 12 },
        formatter: (raw: TooltipParam | TooltipParam[]) => {
          const param = Array.isArray(raw) ? raw[0] : raw
          const label = String(param?.value?.[0] ?? '')
          const point = byLabel.get(label)
          if (!point) return label
          return [
            `${label} · ${formatValue(point.v)}`,
            `<span style="color:#999">${point.instance}</span>`,
            `${point.leg1}：${formatValue(point.leg1Price)}`,
            `${point.leg2}：${formatValue(point.leg2Price)}`,
          ].join('<br/>')
        },
      },
      xAxis: {
        type: 'category',
        data: data.structure.map(point => point.label),
        axisTick: { show: false },
        axisLine: { lineStyle: { color: '#444' } },
        axisLabel: { color: '#999', fontSize: 11, interval: 0, rotate: data.structure.length > 10 ? 35 : 0 },
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLabel: {
          color: '#999',
          fontSize: 10,
          formatter: (value: number) => Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 0 }),
        },
        splitLine: { lineStyle: { color: '#303030', type: 'dashed' } },
      },
      series: [{
        name: '同月价差',
        type: 'line',
        symbol: 'circle',
        symbolSize: 7,
        lineStyle: { color: '#18a0ff', width: 2.2 },
        itemStyle: { color: '#18a0ff' },
        data: data.structure.map(point => [point.label, point.v]),
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: '#f0ad4e', type: 'solid', width: 1.2 },
          label: {
            show: dominantLatest != null,
            color: '#c9a15c',
            fontSize: 10,
            formatter: `主力未复权 ${formatValue(dominantLatest)}`,
          },
          data: dominantLatest == null ? [] : [{ yAxis: dominantLatest }],
        },
      }],
    }, true)
    chartRef.current.resize()
  }, [data])

  useEffect(() => {
    const observer = new ResizeObserver(() => chartRef.current?.resize())
    if (elRef.current) observer.observe(elRef.current)
    return () => {
      observer.disconnect()
      chartRef.current?.dispose()
      chartRef.current = null
    }
  }, [])

  return <div ref={elRef} className={styles.structureChart} />
}

function HistoryChart({ data, selected }: { data: CrossSpreadDetailResponse; selected: string[] }) {
  const elRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ReturnType<typeof echarts.init> | null>(null)
  const selectedSeries = useMemo(() => {
    const fixed = data.monthSeries
      .filter(series => selected.includes(series.month))
      .map(series => ({ key: series.month, label: series.label, points: series.points }))
    if (selected.includes(DOMINANT_KEY)) {
      fixed.push({ key: DOMINANT_KEY, label: '主力未复权', points: data.dominantSeries })
    }
    return fixed
  }, [data.dominantSeries, data.monthSeries, selected])

  useEffect(() => {
    if (!elRef.current) return
    if (!chartRef.current) chartRef.current = echarts.init(elRef.current)
    const pointMaps = new Map(
      selectedSeries.map(series => [series.label, new Map(series.points.map(point => [point.d, point]))]),
    )
    chartRef.current.setOption({
      backgroundColor: 'transparent',
      animation: false,
      color: [...COLORS, '#f0ad4e'],
      grid: { left: 68, right: 28, top: 52, bottom: 68 },
      legend: {
        type: 'scroll',
        top: 8,
        left: 18,
        right: 18,
        itemWidth: 18,
        itemHeight: 8,
        textStyle: { color: '#aaa', fontSize: 11 },
        data: selectedSeries.map(series => series.label),
      },
      tooltip: {
        trigger: 'axis',
        confine: true,
        backgroundColor: '#202020',
        borderColor: '#444',
        textStyle: { color: '#ddd', fontSize: 12 },
        formatter: (raw: TooltipParam | TooltipParam[]) => {
          const params = Array.isArray(raw) ? raw : [raw]
          const date = String(params[0]?.value?.[0] ?? '')
          const lines = params.map(param => {
            const point = pointMaps.get(param.seriesName)?.get(date)
            return `${param.seriesName}：${formatValue(point?.v)}${point?.instance ? `<br/><span style="color:#888">${point.instance}</span>` : ''}`
          })
          return `${date}<br/>${lines.join('<br/>')}`
        },
      },
      xAxis: {
        type: 'time',
        axisTick: { show: false },
        axisLine: { lineStyle: { color: '#444' } },
        axisLabel: { color: '#888', fontSize: 10, hideOverlap: true },
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLabel: {
          color: '#999',
          fontSize: 10,
          formatter: (value: number) => Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 0 }),
        },
        splitLine: { lineStyle: { color: '#303030', type: 'dashed' } },
      },
      dataZoom: [
        { type: 'inside', filterMode: 'none' },
        {
          type: 'slider',
          height: 18,
          bottom: 18,
          borderColor: '#333',
          backgroundColor: '#171717',
          fillerColor: 'rgba(89,156,231,.18)',
          handleStyle: { color: '#599ce7' },
          textStyle: { color: '#777', fontSize: 9 },
        },
      ],
      series: selectedSeries.map((series, index) => ({
        name: series.label,
        type: 'line',
        showSymbol: false,
        sampling: 'lttb',
        connectNulls: false,
        lineStyle: {
          width: series.key === DOMINANT_KEY ? 1.8 : 2,
          type: 'solid',
          color: series.key === DOMINANT_KEY ? '#f0ad4e' : COLORS[index % COLORS.length],
        },
        itemStyle: { color: series.key === DOMINANT_KEY ? '#f0ad4e' : COLORS[index % COLORS.length] },
        data: series.points.map((point: CrossSpreadPoint) => [point.d, point.v]),
        markLine: index === 0 ? {
          silent: true,
          symbol: 'none',
          label: { show: false },
          lineStyle: { color: '#3a3a3a' },
          data: [{ yAxis: 0 }],
        } : undefined,
      })),
    }, true)
    chartRef.current.resize()
  }, [selectedSeries])

  useEffect(() => {
    const observer = new ResizeObserver(() => chartRef.current?.resize())
    if (elRef.current) observer.observe(elRef.current)
    return () => {
      observer.disconnect()
      chartRef.current?.dispose()
      chartRef.current = null
    }
  }, [])

  return <div ref={elRef} className={styles.historyChart} />
}

function LoadedCrossSpreadDetail({ data }: { data: CrossSpreadDetailResponse }) {
  const [selected, setSelected] = useState<string[]>(
    () => [data.monthSeries[0]?.month, DOMINANT_KEY].filter(Boolean) as string[],
  )

  const toggle = (key: string) => {
    setSelected(current => current.includes(key)
      ? current.filter(item => item !== key)
      : [...current, key])
  }

  return (
    <div className={styles.detailWrap}>
      <div className={styles.detailHeader}>
        <div>
          <div className={styles.detailTitle}>{data.name}</div>
          <div className={styles.detailMeta}>{data.group} · 原始结算价 · 数据日期 {data.latestDate}</div>
        </div>
        <div className={styles.detailLegend}>
          <span><i className={styles.fixedDot} />年月合约</span>
          <span><i className={styles.dominantDot} />主力未复权</span>
        </div>
      </div>

      <section className={styles.detailSection}>
        <div className={styles.sectionTitleRow}>
          <div>
            <h3>同月价差结构</h3>
            <p>当前主力月份及往后的共同交割月</p>
          </div>
        </div>
        <StructureChart data={data} />
      </section>

      <section className={styles.detailSection}>
        <div className={styles.sectionTitleRow}>
          <div>
            <h3>历史走势</h3>
            <p>固定年月互不拼接；主力换月不复权</p>
          </div>
          <div className={styles.quickActions}>
            <button onClick={() => setSelected([data.monthSeries[0]?.month, DOMINANT_KEY].filter(Boolean) as string[])}>最近月 + 主力</button>
            <button onClick={() => setSelected([...data.monthSeries.map(item => item.month), DOMINANT_KEY])}>全部口径</button>
          </div>
        </div>
        <div className={styles.contractPicker}>
          {data.monthSeries.map(series => (
            <button
              key={series.month}
              className={selected.includes(series.month) ? styles.contractSelected : ''}
              onClick={() => toggle(series.month)}
            >
              {series.label}
            </button>
          ))}
          <button
            className={`${styles.dominantChoice} ${selected.includes(DOMINANT_KEY) ? styles.contractSelected : ''}`}
            onClick={() => toggle(DOMINANT_KEY)}
          >
            主力未复权
          </button>
        </div>
        {selected.length
          ? <HistoryChart data={data} selected={selected} />
          : <div className={styles.chartEmpty}>请选择至少一个合约口径</div>}
      </section>
    </div>
  )
}

export default function CrossSpreadDetail({ code }: { code: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['crossSpreadDetail', code],
    queryFn: () => api.crossSpreadDetail(code),
    staleTime: 10 * 60 * 1000,
  })

  if (isLoading) return <div className={styles.state}>加载组合详情中...</div>
  if (error) return <div className={styles.state}>加载失败：{(error as Error).message}</div>
  if (!data) return <div className={styles.state}>暂无组合数据</div>
  return <LoadedCrossSpreadDetail key={data.code} data={data} />
}
