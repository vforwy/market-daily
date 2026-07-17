import styles from './SubTabBar.module.css'

export interface SubTabItem {
  id: string
  label: string
  closable?: boolean
}

interface Props {
  tabs: SubTabItem[]
  active: string
  onChange: (tabId: string) => void
  onClose?: (tabId: string) => void
}

export default function SubTabBar({ tabs, active, onChange, onClose }: Props) {
  return (
    <div className={styles.bar}>
      {tabs.map(t => (
        <div
          key={t.id}
          className={`${styles.tab} ${active === t.id ? styles.active : ''}`}
        >
          <button
            className={styles.main}
            onClick={() => onChange(t.id)}
          >
            {t.label}
          </button>
          {t.closable && (
            <button
              className={styles.close}
              aria-label={`关闭 ${t.label}`}
              onClick={() => {
                onClose?.(t.id)
              }}
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
