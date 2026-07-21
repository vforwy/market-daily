import { useQuery } from '@tanstack/react-query'
import { api, type SpreadSeasonalChart } from '../../api'
import FixedContractSpreadCard from './FixedContractSpreadCard'
import SpreadSeasonalityCard from './SpreadSeasonalityCard'
import styles from './SpreadSeasonalityPanel.module.css'

interface Props {
  variety: string
}

export default function SpreadSeasonalityPanel({ variety }: Props) {
  const { data: fixedData, isLoading: fixedLoading } = useQuery({
    queryKey: ['fixedContractSpreads', variety],
    queryFn: () => api.fixedContractSpreads(variety),
    staleTime: 600_000,
    enabled: Boolean(variety),
  })
  const { data: seasonalData, isLoading: seasonalLoading } = useQuery({
    queryKey: ['spreadSeasonal', variety, 5, 'raw'],
    queryFn: () => api.spreadSeasonal(variety, 5, 'raw', true),
    staleTime: 600_000,
    enabled: Boolean(variety),
  })

  const fixedCharts = fixedData?.charts ?? []
  const specialSpreads = seasonalData?.specialSpreads ?? []
  const isLoading = fixedLoading || seasonalLoading
  const hasSpreads = fixedCharts.length > 0 || specialSpreads.length > 0

  const renderGrid = (items: SpreadSeasonalChart[], className = styles.grid) => (
    <div className={className}>
      {items.map(item => (
        <SpreadSeasonalityCard
          key={item.spreadCode}
          item={item}
          years={seasonalData?.years ?? []}
        />
      ))}
    </div>
  )

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <span>月差结构</span>
        <span className={styles.headerNote}>近月-远月 · 上行正套走强 / 下行反套走强</span>
      </div>
      {isLoading && <div className={styles.state}>价差数据加载中...</div>}
      {!isLoading && !hasSpreads && (
        <div className={styles.state}>暂无价差数据</div>
      )}
      {!isLoading && hasSpreads && (
        <div className={styles.groups}>
          {fixedCharts.length > 0 && (
            <section className={styles.group}>
              <div className={styles.groupHeader}>
                固定合约月差（{fixedData?.historyStart.slice(0, 4)}年以来）
              </div>
              <div className={styles.monthlyGrid}>
                {fixedCharts.map(item => (
                  <FixedContractSpreadCard
                    key={item.nearCode}
                    item={item}
                    dominantCode={fixedData?.dominantCode ?? ''}
                  />
                ))}
              </div>
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
