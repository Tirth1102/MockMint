'use client';

import { useEffect, useState } from 'react';
import type { AdminAnalytics } from '@mockmint/shared';
import { api } from '@/lib/api';
import ui from '@/components/ui/ui.module.css';
import charts from '@/components/charts/charts.module.css';
import styles from '../admin.module.css';

export default function AdminAnalyticsPage() {
  const [data, setData] = useState<AdminAnalytics | null>(null);

  useEffect(() => {
    api
      .get<AdminAnalytics>('/api/admin/analytics')
      .then(setData)
      .catch(() => undefined);
  }, []);

  if (!data) return <div className={ui.loading}>Loading analytics…</div>;

  const dauMax = Math.max(1, ...data.dau) * 1.15;
  const dauDots = data.dau.map((value, i) => ({
    x: Math.round(20 + i * (420 / Math.max(1, data.dau.length - 1))),
    y: Math.round(140 - (value / dauMax) * 120),
    value,
  }));
  const yearMax = Math.max(1, ...data.yearAverages.map((y) => y.avg)) * 1.1;

  return (
    <div className={styles.half} style={{ animation: 'catfade .3s ease' }}>
      <div className={ui.card}>
        <div className={ui.cardTitle} style={{ marginBottom: 18 }}>
          Daily active users · last 14 days
        </div>
        <svg viewBox="0 0 460 160" style={{ width: '100%', height: 160 }} role="img" aria-label="Daily active users">
          <polyline
            points={dauDots.map((d) => `${d.x},${d.y}`).join(' ')}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2.4"
            strokeLinejoin="round"
          />
          {dauDots.map((dot, i) => (
            <circle key={i} cx={dot.x} cy={dot.y} r="3" fill="var(--accent)">
              <title>{`${dot.value} active`}</title>
            </circle>
          ))}
        </svg>
      </div>

      <div className={ui.card}>
        <div className={ui.cardTitle} style={{ marginBottom: 18 }}>
          Completion rate by section
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
          {data.completion.map((entry) => (
            <div key={entry.label}>
              <div className={ui.meterLabel}>
                <span>{entry.label}</span>
                <span className={ui.mono} style={{ color: 'var(--ink2)' }}>
                  {entry.pct}%
                </span>
              </div>
              <div className={ui.meterTrack} style={{ height: 9, borderRadius: 5 }}>
                <div
                  className={ui.meterFill}
                  style={{
                    width: `${entry.pct}%`,
                    background:
                      entry.pct > 75 ? 'var(--ok)' : entry.pct > 55 ? 'var(--accent)' : 'var(--warn)',
                    borderRadius: 5,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className={`${ui.card} ${styles.spanAll}`}>
        <div className={ui.cardTitle} style={{ marginBottom: 18 }}>
          Average score by paper year
        </div>
        <div className={charts.barColumns} style={{ height: 170, gap: 14 }}>
          {data.yearAverages.map((entry) => (
            <div key={entry.year} className={charts.barColumn} style={{ gap: 8 }}>
              <div className={charts.barValue}>{entry.avg}</div>
              <div
                className={charts.bar}
                style={{
                  height: `${Math.round((entry.avg / yearMax) * 100)}%`,
                  background:
                    entry.avg >= yearMax * 0.85
                      ? 'var(--accent)'
                      : 'color-mix(in oklab, var(--accent) 40%, var(--surface2))',
                }}
              />
              <div className={charts.barLabel} style={{ fontFamily: 'var(--font-mono)' }}>
                {String(entry.year).slice(2)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
