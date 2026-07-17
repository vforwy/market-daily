import { useQuery } from '@tanstack/react-query'
import { Fragment } from 'react'
import { api } from '../../api'
import TermStructureCard from './TermStructureCard'
import styles from './TermStructureMatrix.module.css'

export default function TermStructureMatrix() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['termStructureMatrix'],
    queryFn: api.termStructureMatrix,
  })

  if (isLoading) return <div className={styles.state}>加载中...</div>
  if (error) return <div className={styles.state}>加载失败：{(error as Error).message}</div>

  return (
    <div className={styles.wrap}>
      <div className={styles.grid}>
        {(data?.charts ?? []).map((item, index, charts) => {
          const prev = charts[index - 1]
          const showCateHeader = !prev || item.cate !== prev.cate
          const showSectionHeader = showCateHeader || !prev || item.section !== prev.section
          return (
            <Fragment key={item.code}>
              {showCateHeader && (
                <div key={`cate:${item.cate}`} className={styles.cateHeader}>
                  <span>{item.cate || '未分类'}</span>
                  <span className={styles.cateLine} />
                </div>
              )}
              {showSectionHeader && (
                <div key={`section:${item.cate}:${item.section}`} className={styles.sectionHeader}>
                  {item.section || '未分板块'}
                </div>
              )}
              <TermStructureCard key={item.code} item={item} boxClass={styles.cardMatrix} />
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}
