import { useQuery } from '@tanstack/react-query'
import { api, type SpreadPriceMode, type SpreadSeasonalChart } from '../../api'
import { usePersistentState } from '../../hooks/usePersistentState'
import SpreadSeasonalityCard from './SpreadSeasonalityCard'
import styles from './SpreadSeasonalityPanel.module.css'

interface Props {
  variety: string
}

export default function SpreadSeasonalityPanel({ variety }: Props) {
  const [priceMode, setPriceMode] = usePersistentState<SpreadPriceMode>(
    'fom:spread-price-mode',
    'adjusted',
  )
  const { data, isLoading } = useQuery({
    queryKey: ['spreadSeasonal', variety, 5, priceMode],
    queryFn: () => api.spreadSeasonal(variety, 5, priceMode),
    staleTime: 600_000,
    enabled: Boolean(variety),
  })

  const monthlySpreads = data?.monthlySpreads ?? []
  const specialSpreads = data?.specialSpreads ?? []
  const hasSpreads = monthlySpreads.length > 0 || specialSpreads.length > 0

  const renderGrid = (items: SpreadSeasonalChart[], className = styles.grid) => (
    <div className={className}>
      {items.map(item => (
        <SpreadSeasonalityCard
          key={`${priceMode}:${item.spreadCode}`}
          item={item}
          years={data?.years ?? []}
        />
      ))}
    </div>
  )

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <span>价差季节图（近 5 年）</span>
        <div className={styles.segmented} aria-label="价差价格口径">
          <button
            type="button"
            className={`${styles.segmentButton} ${priceMode === 'raw' ? styles.segmentActive : ''}`}
            onClick={() => setPriceMode('raw')}
          >
            原始
          </button>
          <button
            type="button"
            className={`${styles.segmentButton} ${priceMode === 'adjusted' ? styles.segmentActive : ''}`}
            onClick={() => setPriceMode('adjusted')}
          >
            前复权
          </button>
        </div>
      </div>
      {isLoading && <div className={styles.state}>价差数据加载中...</div>}
      {!isLoading && (!data || !hasSpreads) && (
        <div className={styles.state}>暂无价差数据</div>
      )}
      {!isLoading && data && hasSpreads && (
        <div className={styles.groups}>
          {monthlySpreads.length > 0 && (
            <section className={styles.group}>
              <div className={styles.groupHeader}>月差</div>
              {renderGrid(monthlySpreads, styles.monthlyGrid)}
            </section>
          )}
          {specialSpreads.length > 0 && (
            <section className={styles.group}>
              <div className={styles.groupHeader}>特殊价差</div>
              {renderGrid(specialSpreads)}
            </section>
          )}
        </div>
      )}
    </section>
  )
}
