import { Suspense, lazy, useState } from 'react'
import Header from './components/Header/Header'
import { usePersistentState } from './hooks/usePersistentState'
import Commodities from './pages/Commodities'
import './App.css'

const Craps = lazy(() => import('./pages/Craps'))
const HoldingSeatPanel = lazy(() => import('./components/HoldingSeat/HoldingSeatPanel'))
type MainTab = 'commodities' | 'holdings' | 'craps'

export default function App() {
  const [storedTab, setStoredTab] = usePersistentState<MainTab>('fom:main-tab', 'commodities')
  const [activeTab, setCurrentTab] = useState<MainTab>(() => {
    const route = new URLSearchParams(window.location.search).get('page')
    return route === 'holdings' || route === 'commodities' || route === 'craps' ? route : storedTab
  })
  function setActiveTab(tab: MainTab) {
    const url = new URL(window.location.href)
    url.searchParams.set('page', tab)
    window.history.replaceState(null, '', url)
    setCurrentTab(tab)
    setStoredTab(tab)
  }

  return (
    <>
      <Header activeTab={activeTab} onTabChange={setActiveTab} />
      {activeTab === 'commodities' ? (
        <Commodities />
      ) : activeTab === 'holdings' ? (
        <main className="holdingsPage">
          <Suspense fallback={<div className="snapshotError">加载持仓页面中...</div>}>
            <HoldingSeatPanel />
          </Suspense>
        </main>
      ) : (
        <Suspense fallback={<div className="snapshotError">加载 Craps 栏目中...</div>}>
          <Craps />
        </Suspense>
      )}
    </>
  )
}
