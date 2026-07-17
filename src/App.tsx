import { Suspense, lazy } from 'react'
import Header from './components/Header/Header'
import { usePersistentState } from './hooks/usePersistentState'
import Commodities from './pages/Commodities'
import './App.css'

const Craps = lazy(() => import('./pages/Craps'))

export default function App() {
  const [activeTab, setActiveTab] = usePersistentState<'commodities' | 'craps'>('fom:main-tab', 'commodities')

  return (
    <>
      <Header activeTab={activeTab} onTabChange={setActiveTab} />
      {activeTab === 'commodities' ? (
        <Commodities />
      ) : (
        <Suspense fallback={<div className="snapshotError">加载 Craps 静态索引中...</div>}>
          <Craps />
        </Suspense>
      )}
    </>
  )
}
