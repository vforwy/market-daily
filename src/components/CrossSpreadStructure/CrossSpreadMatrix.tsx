import { useQuery } from '@tanstack/react-query'
import { Fragment } from 'react'
import { api, type CrossSpreadOverviewChart } from '../../api'
import { usePersistentState } from '../../hooks/usePersistentState'
import CrossSpreadCard, {
  type CrossSpreadRange,
  type CrossSpreadViewMode,
} from './CrossSpreadCard'
import styles from './CrossSpreadStructure.module.css'

const GROUP_ORDER = ['油品', '烯烃', '聚酯芳烃', '橡胶', '纯碱玻璃']

interface Props {
  onSelect: (target: { code: string; name: string }) => void
}

function groupCharts(charts: CrossSpreadOverviewChart[]) {
  const byGroup = new Map<string, CrossSpreadOverviewChart[]>()
  charts.forEach(chart => {
    const group = chart.group || '未分类'
    byGroup.set(group, [...(byGroup.get(group) ?? []), chart])
  })
  return [...byGroup.entries()].sort(([left], [right]) => {
    const leftIndex = GROUP_ORDER.indexOf(left)
    const rightIndex = GROUP_ORDER.indexOf(right)
    return (leftIndex < 0 ? 999 : leftIndex) - (rightIndex < 0 ? 999 : rightIndex)
  })
}

export default function CrossSpreadMatrix({ onSelect }: Props) {
  const [mode, setMode] = usePersistentState<CrossSpreadViewMode>('fom:cross-spread-view-mode', 'both')
  const [range, setRange] = usePersistentState<CrossSpreadRange>('fom:cross-spread-range', '3y')
  const { data, isLoading, error } = useQuery({
    queryKey: ['crossSpreadOverview'],
    queryFn: api.crossSpreadOverview,
    staleTime: 10 * 60 * 1000,
  })

  if (isLoading) return <div className={styles.state}>加载跨品种价差中...</div>
  if (error) return <div className={styles.state}>加载失败：{(error as Error).message}</div>
  if (!data?.charts.length) return <div className={styles.state}>暂无跨品种价差数据</div>

  return (
    <div className={styles.matrixWrap}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarLead}>
          <span className={styles.toolbarTitle}>跨品种价差</span>
          <span className={styles.toolbarDate}>数据日期 {data.latestDate}</span>
        </div>
        <div className={styles.toolbarControls}>
          <div className={styles.segmented} aria-label="展示口径">
            <button className={mode === 'fixed' ? styles.selected : ''} onClick={() => setMode('fixed')}>当前主力同月</button>
            <button className={mode === 'dominant' ? styles.selected : ''} onClick={() => setMode('dominant')}>主力未复权</button>
            <button className={mode === 'both' ? styles.selected : ''} onClick={() => setMode('both')}>两者对比</button>
          </div>
          <div className={styles.segmented} aria-label="时间范围">
            <button className={range === '1y' ? styles.selected : ''} onClick={() => setRange('1y')}>1年</button>
            <button className={range === '3y' ? styles.selected : ''} onClick={() => setRange('3y')}>3年</button>
            <button className={range === 'all' ? styles.selected : ''} onClick={() => setRange('all')}>全部</button>
          </div>
        </div>
      </div>

      <div className={styles.grid}>
        {groupCharts(data.charts).map(([group, charts]) => (
          <Fragment key={group}>
            <div className={styles.groupHeader}>
              <span>{group}</span>
              <span className={styles.groupCount}>{charts.length}</span>
              <span className={styles.groupLine} />
            </div>
            {charts.map(item => (
              <CrossSpreadCard
                key={item.code}
                item={item}
                mode={mode}
                range={range}
                onOpen={() => onSelect({ code: item.code, name: item.name })}
              />
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  )
}
