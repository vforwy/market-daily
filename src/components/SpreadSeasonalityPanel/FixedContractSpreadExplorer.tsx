import type { FixedContractSpreadChart } from '../../api'
import { usePersistentState } from '../../hooks/usePersistentState'
import { fixedContractNearCode } from '../../lib/fixedContractSpreads'
import FixedContractSpreadCard from './FixedContractSpreadCard'
import styles from './SpreadSeasonalityPanel.module.css'

interface Props {
  variety: string
  charts: FixedContractSpreadChart[]
  dominantCode: string
}

export default function FixedContractSpreadExplorer({ variety, charts, dominantCode }: Props) {
  const [preferredNearCode, setPreferredNearCode] = usePersistentState(
    `fom:fixed-spread-near:${variety}`,
    '',
  )
  const nearCode = fixedContractNearCode(charts, preferredNearCode)
  const selectedChart = charts.find(chart => chart.nearCode === nearCode)

  return (
    <section className={`${styles.group} ${styles.explorer}`} aria-label="自选固定月差">
      <div className={styles.explorerToolbar}>
        <div className={styles.groupHeader}>历史合约月差（2026 年以来）</div>
        <label className={styles.nearLegSelector}>
          <span>近月腿</span>
          <select
            aria-label="固定月差近月合约"
            className={styles.nearLegSelect}
            value={nearCode}
            disabled={!charts.length}
            onChange={event => setPreferredNearCode(event.target.value)}
          >
            {charts.map(chart => (
              <option key={chart.nearCode} value={chart.nearCode}>
                {chart.nearCode.split('.')[0]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={styles.explorerNote}>选择上方图组之前的历史近月合约 · 近月－后续最多 5 个远月 · 未复权收盘价口径</div>
      {selectedChart && (
        <FixedContractSpreadCard item={selectedChart} dominantCode={dominantCode} />
      )}
    </section>
  )
}
