import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef } from 'react'
import {
  api,
  type CrossSpreadDetailResponse,
  type CrossSpreadPoint,
} from '../../api'
import { echarts } from '../../lib/echarts'
import { usePersistentState } from '../../hooks/usePersistentState'
import { defaultSpreadMonth, spreadMonthColor } from '../../lib/spreadMonths'
import { tradingDates } from '../../lib/tradingAxis'
import { crossSpreadDisplayName } from './display'
import styles from './CrossSpreadStructure.module.css'

const DOMINANT_KEY = 'dominant'
const DOMINANT_COLOR = '#f0ad4e'

interface TooltipParam {
  seriesName: string
  color: string
  value: [string, number | null]
}

interface SeasonalTooltipParam {
  seriesName: string
  color: string
  data?: {
    value: [string, number | null]
    source: CrossSpreadPoint
  }
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
    const history = data.structureHistory?.length
      ? data.structureHistory
      : [{ date: data.latestDate, points: data.structure }]
    const labels = Array.from(new Set(history.flatMap(item => item.points.map(point => point.label)))).sort()
    const pointMaps = new Map(
      history.map(item => [item.date, new Map(item.points.map(point => [point.label, point]))]),
    )
    const latestDate = history.at(-1)?.date
    const historicalColors = ['#8f9aa7', '#f0ad4e', '#b279d6', '#35b779']
    chartRef.current.setOption({
      backgroundColor: 'transparent',
      animation: false,
      grid: { left: 68, right: 28, top: 62, bottom: 48 },
      legend: {
        type: 'scroll',
        top: 8,
        left: 18,
        right: 18,
        itemWidth: 18,
        itemHeight: 8,
        textStyle: { color: '#aaa', fontSize: 10 },
        data: history.map(item => item.date),
        formatter: (name: string) => name === latestDate ? `${name} 当日` : name,
      },
      tooltip: {
        trigger: 'axis',
        confine: true,
        backgroundColor: '#202020',
        borderColor: '#444',
        textStyle: { color: '#ddd', fontSize: 12 },
        formatter: (raw: TooltipParam | TooltipParam[]) => {
          const params = Array.isArray(raw) ? raw : [raw]
          const label = String(params[0]?.value?.[0] ?? '')
          const lines = params.map(param => {
            const point = pointMaps.get(param.seriesName)?.get(label)
            return [
              `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${param.color};margin-right:5px"></span>${param.seriesName}${param.seriesName === latestDate ? '（当日）' : ''}：${formatValue(point?.v)}`,
              point?.instance ? `<span style="color:#888">${point.instance}</span>` : '',
            ].filter(Boolean).join('<br/>')
          })
          return `${label}<br/>${lines.join('<br/>')}`
        },
      },
      xAxis: {
        type: 'category',
        data: labels,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: '#444' } },
        axisLabel: { color: '#999', fontSize: 11, interval: 0, rotate: labels.length > 10 ? 35 : 0 },
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
      series: history.map((item, index) => {
        const isLatest = index === history.length - 1
        const color = isLatest ? '#18a0ff' : historicalColors[index % historicalColors.length]
        return {
          name: item.date,
          type: 'line',
          symbol: isLatest ? 'circle' : 'none',
          symbolSize: isLatest ? 8 : 5,
          connectNulls: false,
          z: isLatest ? 3 : 1,
          lineStyle: { color, width: isLatest ? 3 : 1.7, opacity: isLatest ? 1 : .92 },
          itemStyle: { color },
          data: labels.map(label => [label, pointMaps.get(item.date)?.get(label)?.v ?? null]),
          markLine: isLatest ? {
            silent: true,
            symbol: 'none',
            lineStyle: { color: DOMINANT_COLOR, type: 'solid', width: 1.2 },
            label: {
              show: dominantLatest != null,
              color: '#c9a15c',
              fontSize: 10,
              position: 'insideEndTop',
              distance: 6,
              padding: [2, 4],
              backgroundColor: 'rgba(23,23,23,.86)',
              formatter: `主力未复权 ${formatValue(dominantLatest)}`,
            },
            data: dominantLatest == null ? [] : [{ yAxis: dominantLatest }],
          } : undefined,
        }
      }),
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

function AdjustedSeasonalChart({ data }: { data: CrossSpreadDetailResponse }) {
  const elRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ReturnType<typeof echarts.init> | null>(null)
  const yearlySeries = useMemo(() => {
    const grouped = new Map<string, CrossSpreadPoint[]>()
    for (const point of data.adjustedDominantSeries ?? []) {
      const year = point.d.slice(0, 4)
      grouped.set(year, [...(grouped.get(year) ?? []), point])
    }
    return Array.from(grouped, ([year, points]) => ({ year, points })).sort((a, b) => a.year.localeCompare(b.year))
  }, [data.adjustedDominantSeries])

  useEffect(() => {
    if (!elRef.current) return
    if (!chartRef.current) chartRef.current = echarts.init(elRef.current)
    const latestYear = yearlySeries.at(-1)?.year
    const historicalColors = ['#f0ad4e', '#b279d6', '#35b779', '#ef6f6c', '#8f9df4', '#d6c562']
    chartRef.current.setOption({
      backgroundColor: 'transparent',
      animation: false,
      grid: { left: 68, right: 28, top: 62, bottom: 48 },
      legend: {
        type: 'scroll',
        top: 8,
        left: 18,
        right: 18,
        itemWidth: 18,
        itemHeight: 8,
        textStyle: { color: '#aaa', fontSize: 10 },
        data: yearlySeries.map(series => series.year),
      },
      tooltip: {
        trigger: 'axis',
        confine: true,
        backgroundColor: '#202020',
        borderColor: '#444',
        textStyle: { color: '#ddd', fontSize: 12 },
        formatter: (raw: SeasonalTooltipParam | SeasonalTooltipParam[]) => {
          const params = Array.isArray(raw) ? raw : [raw]
          const firstPoint = params.find(param => param.data?.source)?.data?.source
          const monthDay = firstPoint?.d.slice(5) ?? ''
          const lines = params.map(param => {
            const point = param.data?.source
            return [
              `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${param.color};margin-right:5px"></span>${param.seriesName}：${formatValue(point?.v)}`,
              point?.instance ? `<span style="color:#888">${point.instance}</span>` : '',
            ].filter(Boolean).join('<br/>')
          })
          return `${monthDay}<br/>${lines.join('<br/>')}`
        },
      },
      xAxis: {
        type: 'time',
        min: '2000-01-01',
        max: '2000-12-31',
        boundaryGap: false,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: '#444' } },
        axisLabel: {
          color: '#888',
          fontSize: 10,
          hideOverlap: true,
          formatter: (value: number) => `${String(new Date(value).getMonth() + 1).padStart(2, '0')}月`,
        },
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
      series: yearlySeries.map((series, index) => {
        const isLatest = series.year === latestYear
        const color = isLatest ? '#18a0ff' : historicalColors[index % historicalColors.length]
        return {
          name: series.year,
          type: 'line',
          showSymbol: false,
          connectNulls: false,
          lineStyle: { color, width: isLatest ? 2.8 : 1.8, opacity: isLatest ? 1 : .95 },
          itemStyle: { color },
          data: series.points.map(point => ({
            value: [`2000-${point.d.slice(5)}`, point.v],
            source: point,
          })),
          markLine: index === 0 ? {
            silent: true,
            symbol: 'none',
            label: { show: false },
            lineStyle: { color: '#3a3a3a' },
            data: [{ yAxis: 0 }],
          } : undefined,
        }
      }),
    }, true)
    chartRef.current.resize()
  }, [yearlySeries])

  useEffect(() => {
    const observer = new ResizeObserver(() => chartRef.current?.resize())
    if (elRef.current) observer.observe(elRef.current)
    return () => {
      observer.disconnect()
      chartRef.current?.dispose()
      chartRef.current = null
    }
  }, [])

  return <div ref={elRef} className={styles.seasonalChart} />
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
  const dates = useMemo(
    () => tradingDates(selectedSeries.map(series => series.points)),
    [selectedSeries],
  )

  useEffect(() => {
    if (!elRef.current) return
    if (!chartRef.current) chartRef.current = echarts.init(elRef.current)
    const pointMaps = new Map(
      selectedSeries.map(series => [series.label, new Map(series.points.map(point => [point.d, point]))]),
    )
    chartRef.current.setOption({
      backgroundColor: 'transparent',
      animation: false,
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
        type: 'category',
        data: dates,
        boundaryGap: false,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: '#444' } },
        axisLabel: {
          color: '#888',
          fontSize: 10,
          hideOverlap: true,
          formatter: (value: string) => value.slice(5),
        },
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
      series: selectedSeries.map((series, index) => {
        const color = series.key === DOMINANT_KEY
          ? DOMINANT_COLOR
          : spreadMonthColor(series.key)
        return {
          name: series.label,
          type: 'line',
          showSymbol: false,
          sampling: 'lttb',
          connectNulls: false,
          lineStyle: {
            width: series.key === DOMINANT_KEY ? 1.8 : 2,
            type: series.key === DOMINANT_KEY ? 'dashed' : 'solid',
            color,
          },
          itemStyle: { color },
          data: series.points.map((point: CrossSpreadPoint) => [point.d, point.v]),
          markLine: index === 0 ? {
            silent: true,
            symbol: 'none',
            label: { show: false },
            lineStyle: { color: '#3a3a3a' },
            data: [{ yAxis: 0 }],
          } : undefined,
        }
      }),
    }, true)
    chartRef.current.resize()
  }, [dates, selectedSeries])

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
  const currentMonth = defaultSpreadMonth(data.structure, data.monthSeries)
  const [selected, setSelected] = usePersistentState<string[]>(
    `fom:cross-spread-selected:${data.code}`,
    [currentMonth, DOMINANT_KEY].filter(Boolean) as string[],
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
          <div className={styles.detailTitle}>{crossSpreadDisplayName(data.name)}</div>
          <div className={styles.detailMeta}>{data.group} · 同月/历史为原始结算价 · 季节图为主力前复权收盘价 · 数据日期 {data.latestDate}</div>
          <div className={styles.detailFormula}>
            <span>计算公式</span>
            <code>{data.formulaLabel}</code>
          </div>
        </div>
        <div className={styles.detailLegend}>
          <span><i className={styles.fixedDot} />年月合约</span>
          <span><i className={styles.dominantDot} />主力未复权</span>
        </div>
      </div>

      <div className={styles.topCharts}>
        <section className={styles.detailSection}>
          <div className={styles.sectionTitleRow}>
            <div>
              <h3>同月价差结构</h3>
              <p>最近 5 个交易日 · 当前主力月份及往后的共同交割月</p>
            </div>
          </div>
          <StructureChart data={data} />
        </section>

        <section className={styles.detailSection}>
          <div className={styles.sectionTitleRow}>
            <div>
              <h3>主力连续复权季节图</h3>
              <p>主力前复权收盘价 · 按自然日对齐，不填补非交易日</p>
            </div>
          </div>
          {data.adjustedDominantSeries?.length
            ? <AdjustedSeasonalChart data={data} />
            : <div className={styles.chartEmpty}>暂无主力连续复权数据</div>}
        </section>
      </div>

      <section className={styles.detailSection}>
        <div className={styles.sectionTitleRow}>
          <div>
            <h3>历史走势</h3>
            <p>固定年月互不拼接；主力换月不复权</p>
          </div>
          <div className={styles.quickActions}>
            <button onClick={() => setSelected([currentMonth, DOMINANT_KEY].filter(Boolean) as string[])}>最近月 + 主力</button>
            <button onClick={() => setSelected([...data.monthSeries.map(item => item.month), DOMINANT_KEY])}>全部口径</button>
          </div>
        </div>
        <div className={styles.contractPicker}>
          {data.monthSeries.map(series => {
            const color = spreadMonthColor(series.month)
            return (
              <button
                key={series.month}
                className={selected.includes(series.month) ? styles.contractSelected : ''}
                onClick={() => toggle(series.month)}
              >
                <i aria-hidden="true" className={styles.contractColorDot} style={{ backgroundColor: color }} />
                {series.label}
              </button>
            )
          })}
          <button
            className={`${styles.dominantChoice} ${selected.includes(DOMINANT_KEY) ? styles.contractSelected : ''}`}
            onClick={() => toggle(DOMINANT_KEY)}
          >
            <i aria-hidden="true" className={styles.contractColorDot} style={{ backgroundColor: DOMINANT_COLOR }} />
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
