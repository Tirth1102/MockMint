'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { ResultSummary } from '@mockmint/shared';
import { api } from '@/lib/api';
import { useSearch } from '@/lib/search';
import ui from '@/components/ui/ui.module.css';
import styles from './results.module.css';

export default function ResultsPage() {
  const [items, setItems] = useState<ResultSummary[] | null>(null);
  const { query } = useSearch();

  useEffect(() => {
    api
      .get<{ items: ResultSummary[] }>('/api/results')
      // Newest first here; the API returns oldest-first for the trend chart.
      .then((data) => setItems(data.items.slice().reverse()))
      .catch(() => setItems([]));
  }, []);

  if (!items) return <div className={ui.loading}>Loading results…</div>;

  const search = query.trim().toLowerCase();
  const visible = search
    ? items.filter((item) => item.name.toLowerCase().includes(search))
    : items;

  if (items.length === 0) {
    return (
      <div className={ui.empty}>
        <div className={ui.emptyIcon}>◫</div>
        <div className={ui.emptyTitle}>No results yet</div>
        <div className={ui.emptyBody}>
          Finish a paper and its full analysis lands here.
        </div>
      </div>
    );
  }

  return (
    <div className={`${ui.cardFlush} ${ui.tableScroll}`} style={{ animation: 'catfade .3s ease' }}>
      <div className={`${ui.tableHead} ${styles.row}`}>
        <div>Paper</div>
        <div>Date</div>
        <div>Score</div>
        <div>%ile</div>
        <div>Accuracy</div>
        <div />
      </div>

      {visible.map((item) => (
        <div key={item.attemptId} className={`${ui.tableRow} ${styles.row}`}>
          <div>
            <div className={styles.name}>{item.name}</div>
            <div className={styles.meta}>66 questions · 120 min</div>
          </div>
          <div className={styles.date}>{item.date}</div>
          <div className={styles.score}>{item.score}</div>
          <div className={styles.pct}>{item.percentile}</div>
          <div className={styles.acc}>{item.accuracy}%</div>
          <Link
            href={`/app/results/${item.attemptId}`}
            className={ui.btn}
            style={{ padding: '7px 12px', fontSize: 12, textAlign: 'center' }}
          >
            Open
          </Link>
        </div>
      ))}

      {visible.length === 0 ? (
        <div className={ui.loading} style={{ animation: 'none' }}>
          Nothing matches “{query}”.
        </div>
      ) : null}
    </div>
  );
}
