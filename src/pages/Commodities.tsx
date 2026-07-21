import { Suspense, lazy, useEffect } from 'react'
import SubTabBar, { type SubTabItem } from '../components/Layout/SubTabBar'
import { usePersistentState } from '../hooks/usePersistentState'
import styles from './Commodities.module.css'

const ChartGrid = lazy(() => import('../components/ChartGrid/ChartGrid'))
const KLinePanel = lazy(() => import('../components/KLinePanel/KLinePanel'))
const TermStructureMatrix = lazy(() => import('../components/TermStructureMatrix/TermStructureMatrix'))
const CrossSpreadMatrix = lazy(() => import('../components/CrossSpreadStructure/CrossSpreadMatrix'))
const CrossSpreadDetail = lazy(() => import('../components/CrossSpreadStructure/CrossSpreadDetail'))

const BASE_TABS: SubTabItem[] = [
  { id: 'charts', label: 'K线图' },
  { id: 'termStructure', label: '期限结构' },
  { id: 'crossSpread', label: '价差结构' },
]

interface DetailTab {
  id: string
  code: string
  name: string
  kind?: 'contract' | 'crossSpread'
}
interface SelectTarget { code: string; name: string }

export default function Commodities() {
  const [activeTab, setActiveTab] = usePersistentState('fom:commodity-active-tab', 'charts')
  const [detailTabs, setDetailTabs] = usePersistentState<DetailTab[]>('fom:commodity-detail-tabs', [])

  useEffect(() => {
    const validTabs = new Set([...BASE_TABS.map(tab => tab.id), ...detailTabs.map(tab => tab.id)])
    if (!validTabs.has(activeTab)) {
      setActiveTab('charts')
    }
  }, [activeTab, detailTabs, setActiveTab])

  const openContractDetail = (target: SelectTarget) => {
    const id = `detail:contract:${target.code}`
    setDetailTabs(tabs => (
      tabs.some(tab => tab.id === id)
        ? tabs
        : [...tabs, { id, code: target.code, name: target.name, kind: 'contract' }]
    ))
    setActiveTab(id)
  }

  const openCrossSpreadDetail = (target: SelectTarget) => {
    const id = `detail:cross-spread:${target.code}`
    setDetailTabs(tabs => (
      tabs.some(tab => tab.id === id)
        ? tabs
        : [...tabs, { id, code: target.code, name: target.name, kind: 'crossSpread' }]
    ))
    setActiveTab(id)
  }

  const closeDetailTab = (id: string) => {
    const closingTab = detailTabs.find(tab => tab.id === id)
    setDetailTabs(tabs => tabs.filter(tab => tab.id !== id))
    setActiveTab(current => current === id
      ? (closingTab?.kind === 'crossSpread' ? 'crossSpread' : 'charts')
      : current)
  }

  const activeDetail = detailTabs.find(tab => tab.id === activeTab)
  const tabs: SubTabItem[] = [
    ...BASE_TABS,
    ...detailTabs.map(tab => ({
      id: tab.id,
      label: tab.name,
      closable: true,
    })),
  ]

  return (
    <>
      <SubTabBar
        tabs={tabs}
        active={activeTab}
        onChange={setActiveTab}
        onClose={closeDetailTab}
      />
      <div className={styles.content}>
        {activeTab === 'charts' && (
          <Suspense fallback={<div className={styles.empty}>加载K线图中...</div>}>
            <ChartGrid onSelect={openContractDetail} />
          </Suspense>
        )}
        {activeTab === 'termStructure' && (
          <Suspense fallback={<div className={styles.empty}>加载期限结构中...</div>}>
            <TermStructureMatrix />
          </Suspense>
        )}
        {activeTab === 'crossSpread' && (
          <Suspense fallback={<div className={styles.empty}>加载价差结构中...</div>}>
            <CrossSpreadMatrix onSelect={openCrossSpreadDetail} />
          </Suspense>
        )}
        {activeDetail && activeDetail.kind === 'crossSpread' && (
          <Suspense fallback={<div className={styles.empty}>加载组合详情中...</div>}>
            <CrossSpreadDetail code={activeDetail.code} />
          </Suspense>
        )}
        {activeDetail && activeDetail.kind !== 'crossSpread' && (
          <div className={styles.detail}>
            <div className={styles.detailPanel}>
              <Suspense fallback={<div className={styles.empty}>加载图表中...</div>}>
                <KLinePanel code={activeDetail.code} name={activeDetail.name} />
              </Suspense>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
