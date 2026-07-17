import { Fragment } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from '../../api'
import type { CommodityConfigItem, KLineEntry, KlineBatchKind } from '../../api'
import { usePersistentState } from '../../hooks/usePersistentState'
import { MANUAL_REFRESH_STALE_TIME, MARKET_DATA_GC_TIME } from '../../lib/queryFreshness'
import KLineCard from './KLineCard'
import styles from './ChartGrid.module.css'

const DAYS_OPTIONS = [
  { label: '1M', value: 30 },
  { label: '3M', value: 90 },
  { label: '6M', value: 180 },
  { label: 'ALL', value: 999 },
]

interface Props {
  onSelect: (target: { code: string; name: string; klineKind?: KlineBatchKind }) => void
}

function varietyFromCode(code: string): string {
  const match = code.toUpperCase().match(/^([A-Z]+)(\d{3,4})?\./)
  return match?.[1] ?? code.split('.')[0].toUpperCase()
}

export default function ChartGrid({ onSelect }: Props) {
  const [days, setDays] = usePersistentState('fom:chart-grid-days', 90)
  const [klineKind, setKlineKind] = usePersistentState<KlineBatchKind>(
    'fom:chart-grid-kline-kind',
    'contract',
  )

  const { data = {}, isLoading: isBatchLoading, isFetching: isBatchFetching } = useQuery<Record<string, KLineEntry>>({
    queryKey: ['klinesBatch', days, klineKind],
    queryFn: () => api.klinesBatch(days, klineKind),
    staleTime: MANUAL_REFRESH_STALE_TIME,
    gcTime: MARKET_DATA_GC_TIME,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    placeholderData: keepPreviousData,
  })

  const { data: config, isLoading: isConfigLoading } = useQuery({
    queryKey: ['commodityConfig'],
    queryFn: api.commodityConfig,
    staleTime: MANUAL_REFRESH_STALE_TIME,
  })
  const isLoading = isBatchLoading || isConfigLoading

  const dataByVariety = new Map<string, { code: string; entry: KLineEntry }>()
  Object.entries(data).forEach(([key, entry]) => {
    const lookupKey = klineKind === 'dominant_continuous'
      ? (entry.variety ?? key).toUpperCase()
      : varietyFromCode(key)
    const openCode = klineKind === 'dominant_continuous'
      ? (entry.dominant_code ?? key)
      : key
    dataByVariety.set(lookupKey, { code: openCode, entry })
  })

  const configuredItems: CommodityConfigItem[] = config?.items ?? []
  const configuredCards = configuredItems
    .map(item => {
      const matched = dataByVariety.get(item.code)
      return matched ? { item, ...matched } : null
    })
    .filter((row): row is { item: CommodityConfigItem; code: string; entry: KLineEntry } => Boolean(row))

  const fallbackCards = configuredItems.length
    ? []
    : Object.keys(data)
        .sort()
        .map(code => ({ item: null, code, entry: data[code] }))

  const cards = configuredCards.length ? configuredCards : fallbackCards

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <div className={styles.group}>
          <button
            type="button"
            className={`${styles.btn} ${klineKind === 'contract' ? styles.active : ''}`}
            disabled={isBatchFetching && klineKind !== 'contract'}
            onClick={() => setKlineKind('contract')}
          >
            当前主力
          </button>
          <button
            type="button"
            className={`${styles.btn} ${klineKind === 'dominant_continuous' ? styles.active : ''}`}
            disabled={isBatchFetching && klineKind !== 'dominant_continuous'}
            onClick={() => setKlineKind('dominant_continuous')}
          >
            主力连续
          </button>
        </div>
        <div className={styles.group}>
          {DAYS_OPTIONS.map(o => (
            <button
              key={o.label}
              className={`${styles.btn} ${days === o.value ? styles.active : ''}`}
              disabled={isBatchFetching && days !== o.value}
              onClick={() => setDays(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className={styles.state}>加载中...</div>
      ) : (
        <div className={styles.grid}>
          {cards.map((row, idx) => {
            const prevItem = cards[idx - 1]?.item
            const prevCate = prevItem?.cate ?? ''
            const prevSection = prevItem?.section ?? ''
            const cate = row.item?.cate ?? ''
            const section = row.item?.section ?? ''
            const showCateHeader = row.item && cate !== prevCate
            const showSectionHeader = row.item && (showCateHeader || section !== prevSection)
            const baseName = row.item?.name ?? row.entry?.name ?? row.code.split('.')[0]
            const name = klineKind === 'dominant_continuous'
              ? `${baseName} 主连`
              : baseName
            return (
              <Fragment key={`row:${row.code}`}>
                {showCateHeader && (
                  <div key={`cate:${cate}`} className={styles.cateHeader}>
                    <span>{cate || '未分类'}</span>
                    <span className={styles.cateLine} />
                  </div>
                )}
                {showSectionHeader && (
                  <div key={`section:${cate}:${section}`} className={styles.sectionHeader}>
                    {section || '未分板块'}
                  </div>
                )}
                <div className={styles.cardSlot}>
                  <KLineCard
                    code={row.code}
                    name={name}
                    bars={row.entry?.bars ?? []}
                    changePct={row.entry?.change_pct}
                    onOpen={() => {
                      const variety = row.item?.code ?? varietyFromCode(row.code)
                      if (klineKind === 'dominant_continuous') {
                        window.localStorage.setItem(
                          `fom:kline-selected:${row.code}`,
                          `dominant_continuous:${variety}`,
                        )
                      }
                      onSelect({ code: row.code, name, klineKind })
                    }}
                  />
                </div>
              </Fragment>
            )
          })}
        </div>
      )}
    </div>
  )
}
