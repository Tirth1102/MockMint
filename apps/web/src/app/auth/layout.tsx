import styles from './auth.module.css';

/**
 * The dark hero is identical across login / signup / forgot, so it lives in the layout
 * and only the right-hand pane swaps per route.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.shell}>
      <aside className={styles.hero}>
        <div className={styles.brand}>
          <div className={styles.mark} aria-hidden>
            M
          </div>
          <div className={styles.brandName}>MockMint</div>
        </div>

        <div className={styles.heroBody}>
          <div className={styles.eyebrow}>Previous year papers · 2015—2025</div>
          <h1 className={styles.heroTitle}>
            Sit the paper
            <br />
            under real pressure.
            <br />
            <em>Then read the pattern.</em>
          </h1>
          <p className={styles.heroLead}>
            A full-length CAT environment with sectional timers, a live question palette, and
            post-test analysis that goes down to the question.
          </p>
        </div>

        <div className={styles.heroStats}>
          <div>
            <div className={styles.heroStatValue}>28</div>
            <div className={styles.heroStatLabel}>Papers &amp; slots</div>
          </div>
          <div>
            <div className={styles.heroStatValue}>1,848</div>
            <div className={styles.heroStatLabel}>Questions</div>
          </div>
          <div>
            <div className={styles.heroStatValue}>66</div>
            <div className={styles.heroStatLabel}>Questions per paper</div>
          </div>
        </div>
      </aside>

      <main className={styles.formPane}>{children}</main>
    </div>
  );
}
