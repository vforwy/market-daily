import { useQuery } from '@tanstack/react-query'
import { api } from '../../api'
import styles from './Header.module.css'

export default function Header({
  activeTab,
  onTabChange,
}: {
  activeTab: 'commodities' | 'craps'
  onTabChange: (tab: 'commodities' | 'craps') => void
}) {
  const { data } = useQuery({ queryKey: ['snapshotMeta'], queryFn: api.meta })

  return (
    <header className={styles.bar}>
      <div className={styles.brand}>
        <span className={styles.logo}>Fragments of Market</span>
        <span className={styles.badge}>DAILY SNAPSHOT</span>
      </div>
      <nav className={styles.nav} aria-label="主导航">
        <button
          type="button"
          className={activeTab === 'commodities' ? styles.navActive : ''}
          onClick={() => onTabChange('commodities')}
        >
          商品
        </button>
        <button
          type="button"
          className={activeTab === 'craps' ? styles.navActive : ''}
          onClick={() => onTabChange('craps')}
        >
          Craps
        </button>
      </nav>
      <div className={styles.meta}>
        <span>{data?.latestDate || '—'}</span>
        <span className={styles.dot}>·</span>
        <span>生成于 {data?.generatedAt ? new Date(data.generatedAt).toLocaleString('zh-CN', { hour12: false }) : '—'}</span>
      </div>
    </header>
  )
}
