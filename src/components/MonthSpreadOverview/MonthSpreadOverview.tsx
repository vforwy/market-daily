import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type CommodityConfigItem } from '../../api'
import { usePersistentState } from '../../hooks/usePersistentState'
import { MANUAL_REFRESH_STALE_TIME, MARKET_DATA_GC_TIME } from '../../lib/queryFreshness'
import { fixedSpreadCategories, fixedSpreadPriceUnit, fixedSpreadProducts } from '../../lib/fixedSpreadOverview'
import FixedSpreadPair from './FixedSpreadPair'
import styles from './MonthSpreadOverview.module.css'

const WINDOWS = [
  { label: '全部', days: 0 },
  { label: '近半年', days: 180 },
  { label: '近三月', days: 90 },
  { label: '近一月', days: 30 },
]

interface ProductProps {
  item: CommodityConfigItem
  days: number
  resetVersion: number
  scrollRoot: RefObject<HTMLDivElement | null>
}

function ProductSection({ item, days, resetVersion, scrollRoot }: ProductProps) {
  const sectionRef = useRef<HTMLElement>(null)
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    const element = sectionRef.current
    if (!element) return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setEntered(true)
        observer.disconnect()
      }
    }, { root: scrollRoot.current, rootMargin: '350px 0px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [scrollRoot])

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['fixedContractSpreads', item.code],
    queryFn: () => api.fixedContractSpreads(item.code),
    enabled: entered,
    staleTime: MANUAL_REFRESH_STALE_TIME,
    gcTime: MARKET_DATA_GC_TIME,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const pairs = useMemo(() => {
    const charts = data?.charts ?? []
    return [charts.slice(0, 2), charts.slice(2, 4)].filter(pair => pair.length)
  }, [data])
  const unit = fixedSpreadPriceUnit(item.code)

  return (
    <section
      ref={sectionRef}
      id={`month-spread-${item.code}`}
      data-variety={item.code}
      className={styles.product}
      aria-label={`${item.name}固定合约月差`}
    >
      <div className={styles.productHeader}>
        <div className={styles.productTitle}>
          <span className={styles.code}>{item.code}</span>
          <h2>{item.name}</h2>
          <span className={styles.category}>
            {item.cate} / {item.section === 'others' ? '其他' : item.section}
          </span>
        </div>
        <span className={styles.productMeta}>
          {data?.dominantCode && `主力 ${data.dominantCode.split('.')[0]} · `}
          {data?.latestDate}
        </span>
      </div>
      {isError ? (
        <div className={styles.productState}>
          <span>月差数据加载失败</span>
          <button type="button" onClick={() => void refetch()}>重试</button>
        </div>
      ) : isPending ? (
        <div className={styles.productState}>月差数据加载中...</div>
      ) : pairs.length ? (
        <div className={styles.pairs}>
          {pairs.map(pair => (
            <FixedSpreadPair
              key={pair[0].nearCode}
              charts={pair}
              dominantCode={data.dominantCode}
              latestDate={data.latestDate}
              days={days}
              resetVersion={resetVersion}
              unit={unit}
            />
          ))}
        </div>
      ) : (
        <div className={styles.productState}>暂无固定合约月差数据</div>
      )}
    </section>
  )
}

interface Props {
  scrollPositionRef: RefObject<number>
}

export default function MonthSpreadOverview({ scrollPositionRef }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [category, setCategory] = usePersistentState('fom:month-spread-category', '全部')
  const [days, setDays] = usePersistentState('fom:month-spread-days', 0)
  const [search, setSearch] = usePersistentState('fom:month-spread-search', '')
  const [activeCode, setActiveCode] = useState('')
  const [resetVersion, setResetVersion] = useState(0)
  const { data: config, isPending, isError, refetch } = useQuery({
    queryKey: ['commodityConfig'],
    queryFn: api.commodityConfig,
    staleTime: MANUAL_REFRESH_STALE_TIME,
  })
  const products = useMemo(() => fixedSpreadProducts(config?.items ?? []), [config])
  const categories = useMemo(() => fixedSpreadCategories(products), [products])
  const selectedCategory = categories.includes(category) ? category : '全部'
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase()
    return products.filter(item => (selectedCategory === '全部' || item.cate === selectedCategory)
      && `${item.code} ${item.name} ${item.section}`.toLowerCase().includes(query))
  }, [products, selectedCategory, search])

  useLayoutEffect(() => {
    if (!isPending && scrollRef.current) scrollRef.current.scrollTop = scrollPositionRef.current
  }, [isPending, scrollPositionRef])

  const resetScroll = () => {
    scrollPositionRef.current = 0
    if (scrollRef.current) scrollRef.current.scrollTop = 0
    setActiveCode('')
  }
  const reset = () => {
    setCategory('全部')
    setDays(0)
    setSearch('')
    setResetVersion(version => version + 1)
    resetScroll()
  }

  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar} aria-label="月差品种导航">
        <div className={styles.sidebarTitle}>品种导航</div>
        <div className={styles.sidebarMeta}>{products.length} 个品种 · 每品种四图</div>
        <nav className={styles.navigation}>
          {categories.slice(1).map(cate => {
            const items = visible.filter(item => item.cate === cate)
            if (!items.length) return null
            return (
              <div key={cate}>
                <div className={styles.navGroup}>{cate}</div>
                {items.map(item => (
                  <button
                    key={item.code}
                    type="button"
                    className={`${styles.navItem} ${(activeCode || visible[0]?.code) === item.code ? styles.navActive : ''}`}
                    aria-current={(activeCode || visible[0]?.code) === item.code ? 'location' : undefined}
                    onClick={() => {
                      setActiveCode(item.code)
                      document.getElementById(`month-spread-${item.code}`)?.scrollIntoView({ block: 'start' })
                    }}
                  >
                    <span className={styles.navCode}>{item.code}</span>
                    <span>{item.name}</span>
                  </button>
                ))}
              </div>
            )
          })}
        </nav>
        <div className={styles.sidebarFooter}>近月 − 远月<br />未复权收盘价</div>
      </aside>
      <div className={styles.main}>
        <div className={styles.toolbar}>
          <div className={`${styles.segmented} ${styles.categories}`} role="group" aria-label="月差品种分类">
            {categories.map(cate => (
              <button
                key={cate}
                type="button"
                aria-pressed={selectedCategory === cate}
                className={selectedCategory === cate ? styles.selected : ''}
                onClick={() => { setCategory(cate); resetScroll() }}
              >
                {cate}{cate !== '全部' && ` ${products.filter(item => item.cate === cate).length}`}
              </button>
            ))}
          </div>
          <div className={styles.controls}>
            <input
              className={styles.search}
              type="search"
              aria-label="搜索月差品种"
              placeholder="搜索名称 / 代码"
              value={search}
              onChange={event => { setSearch(event.target.value); resetScroll() }}
            />
            <span className={styles.count}>{visible.length} 品种 / {visible.length * 4} 图</span>
          </div>
          <div className={styles.controls}>
            <div className={styles.segmented} role="group" aria-label="月差显示区间">
              {WINDOWS.map(window => (
                <button
                  key={window.days}
                  type="button"
                  aria-pressed={days === window.days}
                  className={days === window.days ? styles.selected : ''}
                  onClick={() => setDays(window.days)}
                >{window.label}</button>
              ))}
            </div>
            <button type="button" className={styles.reset} onClick={reset}>重置</button>
          </div>
        </div>
        <div
          ref={scrollRef}
          className={styles.scroller}
          role="region"
          aria-label="固定合约月差图表"
          onScroll={event => {
            const scroller = event.currentTarget
            scrollPositionRef.current = scroller.scrollTop
            const top = scroller.getBoundingClientRect().top
            const sections = [...scroller.querySelectorAll<HTMLElement>('[data-variety]')]
            const current = sections.find(section => section.getBoundingClientRect().bottom > top + 20)
            if (current?.dataset.variety) setActiveCode(current.dataset.variety)
          }}
        >
          {isError ? (
            <div className={styles.state}>
              <span>品种配置加载失败</span>
              <button type="button" onClick={() => void refetch()}>重试</button>
            </div>
          ) : isPending ? (
            <div className={styles.state}>加载品种配置中...</div>
          ) : !visible.length ? (
            <div className={styles.state}>没有匹配的品种</div>
          ) : visible.map(item => (
            <ProductSection
              key={item.code}
              item={item}
              days={days}
              resetVersion={resetVersion}
              scrollRoot={scrollRef}
            />
          ))}
          <div className={styles.note}>
            同排左右图共用 Y 轴刻度。近端曲线加粗，远端曲线逐步减淡；悬停查看两腿原价。
          </div>
        </div>
      </div>
    </div>
  )
}
