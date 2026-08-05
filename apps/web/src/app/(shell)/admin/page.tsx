'use client';

import { useEffect, useState } from 'react';
import type { AdminOverview } from '@mockmint/shared';
import { api } from '@/lib/api';
import ui from '@/components/ui/ui.module.css';
import charts from '@/components/charts/charts.module.css';
import styles from './admin.module.css';

export default function AdminOverviewPage() {
  const [data, setData] = useState<AdminOverview | null>(null);

  useEffect(() => {
    api
      .get<AdminOverview>('/api/admin/overview')
      .then(setData)
      .catch(() => undefined);
  }, []);

  if (!data) return <div className={ui.loading}>Loading platform health…</div>;

  const growthMax = Math.max(1, ...data.growth.map((g) => g.value));
  const topMax = Math.max(1, ...data.topPapers.map((p) => p.attempts));

  return (
    <div className={ui.page} style={{ gap: 18 }}>
      <div className={styles.statGrid}>
        {data.stats.map((stat) => (
          <div key={stat.label} className={styles.statCard}>
            <div className={styles.statLabel}>{stat.label}</div>
            <div className={styles.statValue}>{stat.value}</div>
            <div className={styles.statDelta} data-tone={stat.tone}>
              {stat.delta}
            </div>
          </div>
        ))}
      </div>

      <div className={styles.split}>
        <div className={ui.card}>
          <div className={ui.cardTitle}>User growth</div>
          <div className={ui.cardSub} style={{ marginBottom: 20 }}>
            New registrations per month
          </div>
          <div className={charts.barColumns}>
            {data.growth.map((bar, i) => (
              <div key={`${bar.label}-${i}`} className={charts.barColumn}>
                <div
                  className={charts.bar}
                  style={{
                    height: `${Math.round((bar.value / growthMax) * 100)}%`,
                    background:
                      i === data.growth.length - 1
                        ? 'var(--accent)'
                        : 'color-mix(in oklab, var(--accent) 45%, var(--surface2))',
                  }}
                  title={`${bar.value} registrations`}
                />
                <div className={charts.barLabel}>{bar.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className={ui.card}>
          <div className={ui.cardTitle} style={{ marginBottom: 16 }}>
            Most attempted papers
          </div>
          <div className={styles.barList}>
            {data.topPapers.map((paper) => (
              <div key={paper.name}>
                <div className={ui.meterLabel}>
                  <span>{paper.name}</span>
                  <span className={ui.mono} style={{ color: 'var(--ink2)' }}>
                    {paper.attempts.toLocaleString('en-IN')}
                  </span>
                </div>
                <div className={ui.meterTrack} style={{ height: 7 }}>
                  <div
                    className={ui.meterFill}
                    style={{
                      width: `${Math.round((paper.attempts / topMax) * 100)}%`,
                      background: 'var(--accent)',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className={ui.card}>
        <div className={ui.cardTitle} style={{ marginBottom: 16 }}>
          Difficulty-wise accuracy across all attempts
        </div>
        <div className={styles.diffGrid}>
          {data.difficulty.map((entry) => {
            const color =
              entry.pct > 65 ? 'var(--ok)' : entry.pct > 45 ? 'var(--warn)' : 'var(--bad)';
            return (
              <div key={entry.label} className={styles.diffCard}>
                <div className={styles.diffHead}>
                  <div style={{ font: '700 13px var(--font-sans)' }}>{entry.label}</div>
                  <div className={styles.diffPct} style={{ color }}>
                    {entry.pct}%
                  </div>
                </div>
                <div className={ui.meterTrack} style={{ marginTop: 11 }}>
                  <div
                    className={ui.meterFill}
                    style={{ width: `${entry.pct}%`, background: color }}
                  />
                </div>
                <div className={styles.diffNote}>{entry.note}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
