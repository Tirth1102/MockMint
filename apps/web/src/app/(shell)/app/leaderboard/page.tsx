'use client';

import { useEffect, useState } from 'react';
import type { LeaderboardRow } from '@mockmint/shared';
import { api } from '@/lib/api';
import ui from '@/components/ui/ui.module.css';
import styles from './leaderboard.module.css';

export default function LeaderboardPage() {
  const [items, setItems] = useState<LeaderboardRow[] | null>(null);
  const [window, setWindow] = useState<'month' | 'all'>('month');

  useEffect(() => {
    setItems(null);
    api
      .get<{ items: LeaderboardRow[] }>(`/api/leaderboard?window=${window}`)
      .then((data) => setItems(data.items))
      .catch(() => setItems([]));
  }, [window]);

  return (
    <div className={ui.page}>
      <div className={ui.filterRow}>
        <button
          type="button"
          className={ui.filter}
          data-active={window === 'month'}
          onClick={() => setWindow('month')}
        >
          This month
        </button>
        <button
          type="button"
          className={ui.filter}
          data-active={window === 'all'}
          onClick={() => setWindow('all')}
        >
          All time
        </button>
      </div>

      {!items ? (
        <div className={ui.loading}>Loading leaderboard…</div>
      ) : items.length === 0 ? (
        <div className={ui.empty}>
          <div className={ui.emptyIcon}>▲</div>
          <div className={ui.emptyTitle}>No ranked attempts in this window</div>
          <div className={ui.emptyBody}>Submit a paper to appear here.</div>
        </div>
      ) : (
        <div className={ui.cardFlush}>
          {items.map((row) => (
            <div
              key={`${row.rank}-${row.name}`}
              className={styles.row}
              data-self={row.isSelf}
            >
              <div className={styles.rank} data-top={row.rank <= 3}>
                #{row.rank}
              </div>
              <div className={styles.avatar} aria-hidden>
                {row.initials}
              </div>
              <div className={styles.name}>{row.name}</div>
              <div className={styles.stats}>
                <div className={styles.statBlock}>
                  <div className={styles.statValue}>{row.score}</div>
                  <div className={styles.statLabel}>best score</div>
                </div>
                <div className={`${styles.statBlock} ${styles.pctBlock}`}>
                  <div className={styles.pctValue}>{row.percentile}</div>
                  <div className={styles.statLabel}>%ile</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
