'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { fmtClock, type AttemptPayload, type DashboardPayload } from '@mockmint/shared';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { TrendChart } from '@/components/charts/TrendChart';
import { Heatmap } from '@/components/charts/Heatmap';
import ui from '@/components/ui/ui.module.css';
import styles from './dashboard.module.css';

/** Resume banner state, derived from the live attempt the API reports (if any). */
interface ActiveAttempt {
  id: string;
  label: string;
  progress: string;
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [active, setActive] = useState<ActiveAttempt | null>(null);
  const [error, setError] = useState('');
  const router = useRouter();
  const { flash } = useToast();

  useEffect(() => {
    api
      .get<DashboardPayload>('/api/me/dashboard')
      .then(setData)
      .catch(() => setError('Could not load your dashboard.'));

    // A 204 means nothing to resume; the endpoint auto-submits anything already expired.
    api
      .get<AttemptPayload | { expired: true } | undefined>('/api/attempts/active')
      .then((payload) => {
        if (!payload || 'expired' in payload) return;
        const answered = payload.responses.filter((r) => r.answer !== null).length;
        const deadline = payload.attempt.sectionDeadlines[payload.attempt.currentSection];
        const remaining = deadline
          ? Math.max(0, (new Date(deadline).getTime() - Date.now()) / 1000)
          : 0;
        setActive({
          id: payload.attempt.id,
          label: payload.attempt.paper.title,
          progress: `${answered} answered · ${fmtClock(remaining)} left in the current section`,
        });
      })
      .catch(() => undefined);
  }, []);

  async function discard() {
    if (!active) return;
    try {
      await api.post(`/api/attempts/${active.id}/submit`, { reason: 'manual' });
      setActive(null);
      flash('Unfinished attempt submitted and scored');
    } catch {
      flash('Could not close that attempt');
    }
  }

  if (error) return <div className={ui.errorBox}>{error}</div>;
  if (!data) return <div className={ui.loading}>Loading your dashboard…</div>;

  return (
    <div className={ui.page}>
      <div className={styles.intro}>
        <h1>{data.greeting}</h1>
        <p>{data.line}</p>
      </div>

      {active ? (
        <div className={styles.resume}>
          <div className={styles.resumeIcon} aria-hidden>
            ◷
          </div>
          <div>
            <div className={styles.resumeTitle}>Unfinished test — {active.label}</div>
            <div className={styles.resumeSub}>{active.progress}</div>
          </div>
          <div className={styles.resumeActions}>
            <button type="button" className={ui.btn} onClick={() => void discard()}>
              Submit now
            </button>
            <button
              type="button"
              className={ui.btnPrimary}
              onClick={() => router.push(`/exam/${active.id}`)}
            >
              Resume test
            </button>
          </div>
        </div>
      ) : null}

      <div className={styles.statGrid}>
        {data.statCards.map((card) => (
          <div key={card.label} className={styles.statCard}>
            <div className={styles.statLabel}>{card.label}</div>
            <div className={styles.statValueRow}>
              <div className={styles.statValue}>{card.value}</div>
              <div className={styles.statUnit}>{card.unit}</div>
            </div>
            <div className={styles.statDelta} data-tone={card.deltaTone}>
              {card.delta}
            </div>
          </div>
        ))}
      </div>

      <div className={styles.split}>
        <div className={ui.card}>
          <div className={styles.trendHead}>
            <div className={ui.cardTitle}>Score trend</div>
            <div className={styles.trendCount}>last {data.trend.length} attempts</div>
          </div>
          <TrendChart points={data.trend} />
        </div>

        <div className={ui.card}>
          <div className={ui.cardTitle} style={{ marginBottom: 16 }}>
            Section strength
          </div>
          <div className={styles.strengthList}>
            {data.strength.map((bar) => (
              <div key={bar.label}>
                <div className={ui.meterLabel}>
                  <span>{bar.label}</span>
                  <span className={ui.mono} style={{ color: 'var(--ink2)' }}>
                    {bar.pct}%
                  </span>
                </div>
                <div className={ui.meterTrack}>
                  <div
                    className={ui.meterFill}
                    style={{
                      width: `${bar.pct}%`,
                      background:
                        bar.pct > 55 ? 'var(--ok)' : bar.pct > 40 ? 'var(--warn)' : 'var(--bad)',
                    }}
                  />
                </div>
                <div className={styles.strengthNote}>{bar.note}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.split}>
        <div className={ui.cardFlush}>
          <div className={ui.cardHead}>
            Recent tests
            <Link href="/app/results" className={ui.headLink}>
              All results →
            </Link>
          </div>
          {data.recent.length === 0 ? (
            <div className={ui.loading} style={{ animation: 'none' }}>
              No attempts yet — start with any paper.
            </div>
          ) : (
            data.recent.map((test) => (
              <div key={test.attemptId} className={styles.recentRow}>
                <div className={styles.recentBadge}>
                  {String(test.year).slice(2)}·{test.slot}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className={styles.recentName}>{test.name}</div>
                  <div className={styles.recentMeta}>
                    {test.date} · accuracy {test.accuracy}%
                  </div>
                </div>
                <div className={styles.recentScore}>
                  <div className={styles.recentScoreValue}>{test.score}</div>
                  <div className={styles.recentPct}>{test.percentile} %ile</div>
                </div>
                <Link
                  href={`/app/results/${test.attemptId}`}
                  className={`${ui.btn} ${ui.btnSmall}`}
                  style={{ padding: '7px 12px', fontSize: 12 }}
                >
                  Analysis
                </Link>
              </div>
            ))
          )}
        </div>

        <div className={styles.sideColumn}>
          <div className={styles.coach}>
            <div className={styles.coachEyebrow}>Coach</div>
            <div className={styles.coachHeadline}>{data.coach.headline}</div>
            <div className={styles.coachBody}>{data.coach.body}</div>
            <Link href="/app/papers" className={styles.coachCta}>
              Start a paper
            </Link>
          </div>

          <div className={styles.streakCard}>
            <div className={styles.streakTitle}>Practice streak</div>
            <Heatmap cells={data.heat} columns={14} />
            <div className={styles.streakLine}>{data.streakLine}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
