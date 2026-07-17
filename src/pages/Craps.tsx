import { useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type CrapsAccount, type CrapsArticle } from '../api'
import styles from './Craps.module.css'

const KEYWORD_SPLIT_RE = /[\s,，;；]+/
const PAGE_SIZE = 80
const TIME_FILTERS = [
  { label: '全部', value: 0 },
  { label: '过去24h', value: 1 },
  { label: '近三天', value: 3 },
  { label: '近一周', value: 7 },
] as const

function parseKeywords(value: string) {
  return [...new Set(
    value
      .split(KEYWORD_SPLIT_RE)
      .map(keyword => keyword.trim().toLocaleLowerCase())
      .filter(Boolean),
  )]
}

function formatPublishTime(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date).replaceAll('/', '-')
}

function publishDate(value: string | null) {
  return formatPublishTime(value).slice(0, 10) || '未知日期'
}

function groupByDate(articles: CrapsArticle[]) {
  const groups = new Map<string, CrapsArticle[]>()
  for (const article of articles) {
    const date = publishDate(article.publishTime)
    groups.set(date, [...(groups.get(date) ?? []), article])
  }
  return [...groups.entries()].map(([date, items]) => ({ date, items }))
}

function groupAccounts(accounts: CrapsAccount[]) {
  const groups = new Map<number, CrapsAccount[]>()
  for (const account of accounts) {
    groups.set(account.starred, [...(groups.get(account.starred) ?? []), account])
  }
  return [...groups.entries()]
    .sort(([left], [right]) => right - left)
    .map(([starred, items]) => ({
      starred,
      items: items.sort((left, right) => left.accountName.localeCompare(right.accountName, 'zh-CN')),
    }))
}

function starLabel(starred: number) {
  return starred > 0 ? `${'★'.repeat(starred)} ${starred} 星` : '未分级'
}

export default function Craps() {
  const { data, isLoading, error } = useQuery({ queryKey: ['crapsSnapshot'], queryFn: api.craps })
  const [days, setDays] = useState(0)
  const [selectedAccounts, setSelectedAccounts] = useState<number[]>([])
  const [keywordInput, setKeywordInput] = useState('')
  const [submittedInput, setSubmittedInput] = useState('')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const listRef = useRef<HTMLDivElement>(null)

  const keywords = useMemo(() => parseKeywords(submittedInput), [submittedInput])
  const accountGroups = useMemo(() => groupAccounts(data?.accounts ?? []), [data?.accounts])
  const filteredArticles = useMemo(() => {
    if (!data) return []
    const generatedAt = Date.parse(data.meta.generatedAt)
    const cutoff = Number.isFinite(generatedAt) && days > 0
      ? generatedAt - days * 86_400_000
      : null

    return data.articles.filter(article => {
      if (selectedAccounts.length > 0 && (
        article.accountId === null || !selectedAccounts.includes(article.accountId)
      )) return false
      if (keywords.length > 0) {
        const title = article.title.toLocaleLowerCase()
        return keywords.some(keyword => title.includes(keyword))
      }
      if (cutoff !== null) {
        const publishTime = article.publishTime ? Date.parse(article.publishTime) : Number.NaN
        return Number.isFinite(publishTime) && publishTime >= cutoff
      }
      return true
    })
  }, [data, days, keywords, selectedAccounts])

  const visibleArticles = filteredArticles.slice(0, visibleCount)
  const articleGroups = useMemo(() => groupByDate(visibleArticles), [visibleArticles])

  const resetList = () => {
    setVisibleCount(PAGE_SIZE)
    listRef.current?.scrollTo({ top: 0 })
  }

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmittedInput(keywordInput)
    resetList()
  }

  const clearSearch = () => {
    setKeywordInput('')
    setSubmittedInput('')
    resetList()
  }

  const toggleAccount = (id: number) => {
    setSelectedAccounts(current => (
      current.includes(id) ? current.filter(item => item !== id) : [...current, id]
    ))
    resetList()
  }

  if (isLoading) return <div className={styles.state}>加载 Craps 静态索引中...</div>
  if (error || !data) return <div className={styles.state}>{error instanceof Error ? error.message : 'Craps 数据不可用'}</div>

  return (
    <main className={styles.shell}>
      <div className={styles.manifesto} tabIndex={0}>
        <span className={styles.manifestoLabel}>Craps Manifesto</span>
        <span className={styles.manifestoText}>
          Craps 的最终目标不是回答“发生了什么”，而是从海量一阶解释中，逐步逼近市场预期、定价权切换与纠偏时刻。
        </span>
      </div>

      <div className={styles.content}>
        <aside className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            <span>发布时间</span>
            <small>{keywords.length > 0 ? '全部历史' : TIME_FILTERS.find(item => item.value === days)?.label}</small>
          </div>
          <div className={styles.filterButtons}>
            {TIME_FILTERS.map(filter => (
              <button
                key={filter.value}
                type="button"
                className={days === filter.value ? styles.activeFilter : ''}
                disabled={keywords.length > 0}
                onClick={() => {
                  setDays(filter.value)
                  resetList()
                }}
              >
                {filter.label}
              </button>
            ))}
          </div>

          <div className={styles.sidebarHeader}>
            <span>公众号</span>
            <small>{selectedAccounts.length > 0 ? `${selectedAccounts.length} 个` : '全部'}</small>
          </div>
          <button
            type="button"
            className={styles.allAccounts}
            onClick={() => {
              setSelectedAccounts([])
              resetList()
            }}
          >
            全部
          </button>
          <div className={styles.accountList}>
            {accountGroups.map(group => (
              <section key={group.starred} className={styles.accountGroup}>
                <div className={styles.accountGroupTitle}>
                  <span>{starLabel(group.starred)}</span>
                  <small>{group.items.length}</small>
                </div>
                {group.items.map(account => (
                  <label key={account.id} className={styles.accountOption}>
                    <input
                      type="checkbox"
                      checked={selectedAccounts.includes(account.id)}
                      onChange={() => toggleAccount(account.id)}
                    />
                    <span>{account.accountName}</span>
                  </label>
                ))}
              </section>
            ))}
          </div>
        </aside>

        <section className={styles.articlePane}>
          <form className={styles.searchBar} onSubmit={submitSearch}>
            <input
              type="search"
              value={keywordInput}
              onChange={event => setKeywordInput(event.target.value)}
              placeholder="搜索历史标题，多个关键词用空格或逗号分隔"
              aria-label="搜索历史文章标题"
            />
            <button type="submit" disabled={!keywordInput.trim()}>搜索</button>
            {keywordInput.trim() && <button type="button" onClick={clearSearch}>清空</button>}
          </form>
          <div className={styles.resultMeta}>
            <span>
              {keywords.length > 0 ? `标题检索：${keywords.join(' / ')} · 任一命中 · 全部历史` : '静态文章索引'}
            </span>
            <span>{filteredArticles.length.toLocaleString('zh-CN')} / {data.meta.total.toLocaleString('zh-CN')}</span>
          </div>

          <div ref={listRef} className={styles.list}>
            {articleGroups.map(group => (
              <section key={group.date}>
                <div className={styles.dateDivider}>
                  <span />
                  <time>{group.date}</time>
                  <span />
                </div>
                {group.items.map(article => (
                  <article key={article.articleId} className={styles.article}>
                    <time>{formatPublishTime(article.publishTime)}</time>
                    <p>
                      <strong>{article.accountName}</strong>
                      <span>：</span>
                      <a href={article.url} target="_blank" rel="noreferrer">{article.title}</a>
                    </p>
                  </article>
                ))}
              </section>
            ))}

            {filteredArticles.length === 0 && (
              <div className={styles.empty}>{keywords.length > 0 ? '没有匹配标题' : '当前条件下没有文章'}</div>
            )}
            {visibleCount < filteredArticles.length && (
              <button
                type="button"
                className={styles.loadMore}
                onClick={() => setVisibleCount(count => count + PAGE_SIZE)}
              >
                显示更多（剩余 {(filteredArticles.length - visibleCount).toLocaleString('zh-CN')}）
              </button>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}
