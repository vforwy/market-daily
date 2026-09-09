import styles from './Craps.module.css'

export default function Craps() {
  return (
    <main className={styles.shell}>
      <div className={styles.manifesto} tabIndex={0}>
        <span className={styles.manifestoLabel}>Craps Manifesto</span>
        <span className={styles.manifestoText}>
          Craps 的最终目标不是回答“发生了什么”，而是从海量一阶解释中，逐步逼近市场预期、定价权切换与纠偏时刻。
        </span>
      </div>

      <section className={styles.placeholder} aria-labelledby="craps-placeholder-title">
        <span className={styles.eyebrow}>Craps</span>
        <h1 id="craps-placeholder-title">内容整理中</h1>
        <p>Craps 栏目继续保留，后续内容将在这里呈现。</p>
      </section>
    </main>
  )
}
