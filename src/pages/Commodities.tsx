import { Suspense, lazy, useEffect } from 'react'
import SubTabBar, { type SubTabItem } from '../components/Layout/SubTabBar'
import { usePersistentState } from '../hooks/usePersistentState'
import styles from './Commodities.module.css'

const ChartGrid = lazy(() => import('../components/ChartGrid/ChartGrid'))
const KLinePanel = lazy(() => import('../components/KLinePanel/KLinePanel'))
const TermStructureMatrix = lazy(() => import('../components/TermStructureMatrix/TermStructureMatrix'))

const BASE_TABS: SubTabItem[] = [
  { id: 'charts', label: 'K线图' },
  { id: 'termStructure', label: '期限结构' },
]

interface DetailTab { id: string; code: string; name: string }
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

  const openDetailTab = (target: SelectTarget) => {
    const id = `detail:${target.code}`
    setDetailTabs(tabs => (
      tabs.some(tab => tab.id === id)
        ? tabs
        : [...tabs, { id, code: target.code, name: target.name }]
    ))
    setActiveTab(id)
  }

  const closeDetailTab = (id: string) => {
    setDetailTabs(tabs => tabs.filter(tab => tab.id !== id))
    setActiveTab(current => current === id ? 'charts' : current)
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
            <ChartGrid onSelect={openDetailTab} />
          </Suspense>
        )}
        {activeTab === 'termStructure' && (
          <Suspense fallback={<div className={styles.empty}>加载期限结构中...</div>}>
            <TermStructureMatrix />
          </Suspense>
        )}
        {activeDetail && (
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
