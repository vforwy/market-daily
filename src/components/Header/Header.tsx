import { useQuery } from '@tanstack/react-query'
import { api } from '../../api'
import styles from './Header.module.css'

export default function Header() {
  const { data } = useQuery({ queryKey: ['snapshotMeta'], queryFn: api.meta })

  return (
    <header className={styles.bar}>
      <div className={styles.brand}>
        <span className={styles.logo}>Fragments of Market</span>
        <span className={styles.badge}>DAILY SNAPSHOT</span>
      </div>
      <div className={styles.meta}>
        <span>{data?.latestDate || '—'}</span>
        <span className={styles.dot}>·</span>
        <span>生成于 {data?.generatedAt ? new Date(data.generatedAt).toLocaleString('zh-CN', { hour12: false }) : '—'}</span>
      </div>
    </header>
  )
}
